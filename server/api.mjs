import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { createIdentityResolver, IdentityError } from './identity.mjs'
import { WorkflowError } from './workflow.mjs'

const BODY_LIMIT = 64 * 1024
const TRANSPORT_ASSIGNMENT_EVENTS = new Set(['transport_assigned', 'return_assigned'])
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
})

class HttpError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
}

function sendJson(response, status, payload) {
  securityHeaders(response)
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function errorPayload(error) {
  return {
    error: error?.message || 'Unexpected server error',
    code: error?.code || 'INTERNAL_ERROR',
    ...(error?.details === undefined ? {} : { details: error.details }),
  }
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    throw new HttpError('Content-Type must be application/json', 415, 'UNSUPPORTED_MEDIA_TYPE')
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) {
      throw new HttpError('Request body is too large', 413, 'BODY_TOO_LARGE')
    }
    chunks.push(chunk)
  }
  if (!size) throw new HttpError('JSON request body is required', 400, 'EMPTY_BODY')
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Body must be an object')
    }
    return value
  } catch (error) {
    throw new HttpError('Request body must be valid JSON object', 400, 'INVALID_JSON', { cause: error.message })
  }
}

export function prepareNodeTransferEventInput(input, context) {
  if (Object.hasOwn(input, 'assigneeUserId')) {
    throw new HttpError('Transport assignee identity is server-controlled', 422, 'ASSIGNEE_IDENTITY_CLIENT_CONTROLLED')
  }
  const eventType = String(input?.type ?? '').trim().toLowerCase()
  if (TRANSPORT_ASSIGNMENT_EVENTS.has(eventType) && context?.userId) {
    // The hosted Cloud Worker resolves display labels against the private
    // membership directory. This standalone Node surface has no such trusted
    // resolver, so authenticated production assignments fail closed.
    throw new HttpError(
      'Transport assignment is unavailable without the server-owned membership directory',
      503,
      'ASSIGNEE_DIRECTORY_UNAVAILABLE',
    )
  }
  return input
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries())
}

function apiPath(pathname) {
  const match = pathname.match(/^\/api(?:\/v1)?(?<rest>\/.*|$)/)
  return match?.groups?.rest || null
}

function safeStaticPath(distDir, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const candidate = path.resolve(distDir, relative)
  const rel = path.relative(path.resolve(distDir), candidate)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
  return candidate
}

function serveStatic(request, response, distDir, url) {
  let candidate = safeStaticPath(distDir, url.pathname)
  if (!candidate) {
    sendJson(response, 400, { error: 'Invalid path', code: 'INVALID_PATH' })
    return
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    if (path.extname(candidate)) {
      sendJson(response, 404, { error: 'File not found', code: 'NOT_FOUND' })
      return
    }
    candidate = path.join(distDir, 'index.html')
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    sendJson(response, 503, { error: 'Frontend build is not available', code: 'DIST_UNAVAILABLE' })
    return
  }
  securityHeaders(response)
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
  )
  response.setHeader('Content-Type', MIME_TYPES[path.extname(candidate).toLowerCase()] || 'application/octet-stream')
  response.setHeader('Content-Length', statSync(candidate).size)
  response.statusCode = 200
  if (request.method === 'HEAD') response.end()
  else createReadStream(candidate).pipe(response)
}

export function createApiHandler({ service, serveDist = false, distDir, identityResolver = createIdentityResolver() } = {}) {
  if (!service) throw new Error('service is required')
  if (!identityResolver?.resolve) throw new Error('identityResolver is required')
  return async function handler(request, response) {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      const route = apiPath(url.pathname)
      if (route === null) {
        if (serveDist && ['GET', 'HEAD'].includes(request.method)) return serveStatic(request, response, distDir, url)
        return sendJson(response, 404, { error: 'Route not found', code: 'NOT_FOUND' })
      }

      if (request.method === 'GET' && route === '/health') return sendJson(response, 200, service.health())
      const context = identityResolver.resolve(request, url, { allowQuery: route === '/bootstrap' })
      if (request.method === 'GET' && route === '/bootstrap') {
        return sendJson(response, 200, service.bootstrap(context))
      }
      if (request.method === 'GET' && route === '/vehicles') {
        return sendJson(response, 200, service.listVehicles(queryObject(url), context))
      }
      const vehicleMatch = route.match(/^\/vehicles\/([^/]+)$/)
      if (request.method === 'GET' && vehicleMatch) {
        return sendJson(response, 200, service.getVehicle(decodeURIComponent(vehicleMatch[1]), context))
      }
      if (request.method === 'GET' && route === '/attention') {
        return sendJson(response, 200, service.listAttention(queryObject(url), context))
      }
      const attentionEventMatch = route.match(/^\/attention\/([^/]+)\/events$/)
      if (request.method === 'POST' && attentionEventMatch) {
        const input = await readJson(request)
        const result = service.appendAttentionEvent(
          decodeURIComponent(attentionEventMatch[1]),
          input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const attentionMatch = route.match(/^\/attention\/([^/]+)$/)
      if (request.method === 'GET' && attentionMatch) {
        return sendJson(response, 200, service.getAttention(decodeURIComponent(attentionMatch[1]), context))
      }
      if (request.method === 'GET' && route === '/transfers') {
        return sendJson(response, 200, service.listTransfers(queryObject(url), context))
      }
      if (request.method === 'POST' && route === '/transfers') {
        const input = await readJson(request)
        const result = service.createTransfer(
          input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const eventMatch = route.match(/^\/transfers\/([^/]+)\/events$/)
      if (request.method === 'POST' && eventMatch) {
        const input = prepareNodeTransferEventInput(await readJson(request), context)
        const result = service.appendTransferEvent(
          decodeURIComponent(eventMatch[1]),
          input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const transferMatch = route.match(/^\/transfers\/([^/]+)$/)
      if (request.method === 'GET' && transferMatch) {
        return sendJson(response, 200, service.getTransfer(decodeURIComponent(transferMatch[1]), context))
      }
      return sendJson(response, 404, { error: 'API route not found', code: 'NOT_FOUND' })
    } catch (error) {
      const isKnown = error instanceof WorkflowError || error instanceof HttpError || error instanceof IdentityError
      const status = isKnown ? error.status || 400 : 500
      const safeError = isKnown ? error : new HttpError('Unexpected server error', 500, 'INTERNAL_ERROR')
      return sendJson(response, status, errorPayload(safeError))
    }
  }
}

export function createInventoryServer(options) {
  return createServer(createApiHandler(options))
}

export const apiInternals = Object.freeze({
  BODY_LIMIT,
  apiPath,
  safeStaticPath,
})
