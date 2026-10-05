import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream'
import { assertAdminOverviewAccess } from './admin-control-center.mjs'
import { createIdentityResolver, IdentityError } from './identity.mjs'
import { ISSUE_BODY_BYTES, prepareIssuePhotos } from './issue-photos.mjs'
import { WorkflowError } from './workflow.mjs'
import { assertSavedListOwner, SAVED_LIST_BODY_BYTES } from './saved-vehicle-lists.mjs'

const BODY_LIMIT = 64 * 1024
const TRANSPORT_ASSIGNMENT_EVENTS = new Set(['transport_assigned', 'return_assigned'])
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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

// The bootstrap is polled on a timer; an unchanged document answers 304 with
// no body. The validator is derived from the serialized response, so any
// ledger or release change produces a new one. Mirrors the Worker behavior.
function sendJsonRevalidated(request, response, payload) {
  securityHeaders(response)
  const body = JSON.stringify(payload)
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 40)}"`
  response.setHeader('ETag', etag)
  if (request.headers['if-none-match'] === etag) {
    response.statusCode = 304
    response.end()
    return
  }
  response.statusCode = 200
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

async function readJson(request, limit = BODY_LIMIT) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    throw new HttpError('Content-Type must be application/json', 415, 'UNSUPPORTED_MEDIA_TYPE')
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
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

function prepareIssueInput(input) {
  const photos = prepareIssuePhotos(input.photos)
  return {
    input: { ...input, photos: photos.map((photo) => photo.metadata) },
    photos,
  }
}

function assertLocalWriteOrigin(request) {
  const origin = String(request.headers.origin ?? '')
  let originUrl
  try { originUrl = new URL(origin) } catch { throw new HttpError('Use the local demo page to make this change.', 403, 'SAME_ORIGIN_REQUIRED') }
  if (!['127.0.0.1', 'localhost'].includes(originUrl.hostname) ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
    throw new HttpError('Use the local demo page to make this change.', 403, 'SAME_ORIGIN_REQUIRED')
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

export async function readAdminDirectory(adminDirectory) {
  if (!adminDirectory || typeof adminDirectory.listMembers !== 'function') {
    throw new HttpError(
      'The server-owned employee directory is unavailable',
      503,
      'ADMIN_DIRECTORY_UNAVAILABLE',
    )
  }
  let members
  try {
    members = await adminDirectory.listMembers()
  } catch {
    throw new HttpError(
      'The server-owned employee directory is unavailable',
      503,
      'ADMIN_DIRECTORY_UNAVAILABLE',
    )
  }
  if (!Array.isArray(members)) {
    throw new HttpError(
      'The server-owned employee directory is unavailable',
      503,
      'ADMIN_DIRECTORY_UNAVAILABLE',
    )
  }
  return members
}

function apiPath(pathname) {
  const match = pathname.match(/^\/api(?:\/v1)?(?<rest>\/.*|$)/)
  return match?.groups?.rest || null
}

function pathSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new HttpError('Invalid path', 400, 'INVALID_PATH')
  }
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
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; media-src 'self' blob:; connect-src 'self'",
  )
  response.setHeader('Content-Type', MIME_TYPES[path.extname(candidate).toLowerCase()] || 'application/octet-stream')
  response.setHeader('Content-Length', statSync(candidate).size)
  response.statusCode = 200
  if (request.method === 'HEAD') response.end()
  else sendFile(candidate, response)
}

// pipeline() destroys the read stream when the client disconnects and routes a
// late file error to the callback instead of an uncaught exception; a bare
// pipe() leaked one file descriptor per aborted download.
function sendFile(file, response) {
  pipeline(createReadStream(file), response, (error) => {
    if (error && !response.headersSent) {
      response.statusCode = 500
      response.end()
    } else if (error) {
      response.destroy()
    }
  })
}

export function createApiHandler({ service, serveDist = false, distDir, workspaceRoot, identityResolver = createIdentityResolver(), adminDirectory, platformAdmin } = {}) {
  if (!service) throw new Error('service is required')
  if (!identityResolver?.resolve) throw new Error('identityResolver is required')
  const issuePhotos = new Map()
  return async function handler(request, response) {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      const route = apiPath(url.pathname)
      if (route === null) {
        if (serveDist && ['GET', 'HEAD'].includes(request.method)) return serveStatic(request, response, distDir, url)
        return sendJson(response, 404, { error: 'Route not found', code: 'NOT_FOUND' })
      }

      if (request.method === 'GET' && route === '/health') return sendJson(response, 200, service.health())
      if (route === '/platform' || route.startsWith('/platform/')) {
        if (identityResolver.mode !== 'demo' || !platformAdmin) return sendJson(response,404,{code:'NOT_FOUND'})
        const isMutation = !['GET','HEAD'].includes(request.method)
        if (isMutation) assertLocalWriteOrigin(request)
        // Vite rewrites Host for its local API proxy. After validating the
        // loopback write origin, preserve that frontend origin for the shared
        // same-origin Worker handler. This adapter exists only in the demo.
        const requestOrigin = isMutation ? String(request.headers.origin) : `http://${request.headers.host}`
        const platformRequest = new Request(`${requestOrigin}${url.pathname}${url.search}`, {
          method:request.method, headers:request.headers,
          ...(!['GET','HEAD'].includes(request.method) ? {body:request,duplex:'half'} : {}),
        })
        const result = await platformAdmin.fetch(platformRequest)
        return sendJson(response,result.status,await result.json())
      }
      const context = identityResolver.resolve(request, url, { allowQuery: route === '/bootstrap' })
      if (route === '/admin/overview') {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
        }
        // Authorize before touching the employee directory. The core repeats
        // this guard as defense in depth.
        assertAdminOverviewAccess(context)
        const members = await readAdminDirectory(adminDirectory)
        const overview = service.adminOverview(context, members)
        if (identityResolver.mode === 'demo' && typeof adminDirectory?.saveMember === 'function') overview.canManageMembers = true
        return sendJson(response, 200, overview)
      }
      if (route === '/admin/members') {
        assertAdminOverviewAccess(context)
        // Mutations on this Node surface are available only to the isolated
        // synthetic demo adapter. Hosted access uses Access + D1 memberships.
        if (identityResolver.mode !== 'demo' || !adminDirectory?.readMembers || !adminDirectory?.saveMember) throw new HttpError('Employee editing is unavailable on this host.', 503, 'ADMIN_EDITING_UNAVAILABLE')
        if (request.method === 'GET') return sendJson(response, 200, await adminDirectory.readMembers(context))
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
        assertLocalWriteOrigin(request)
        return sendJson(response, 200, await adminDirectory.saveMember(await readJson(request), context, String(request.headers['idempotency-key'] ?? '')))
      }
      if (request.method === 'GET' && route === '/bootstrap') {
        return sendJsonRevalidated(request, response, service.bootstrap(context))
      }
      if (request.method === 'GET' && route === '/saved-lists') {
        assertSavedListOwner(context, request.headers['x-inventory-saved-list-owner'])
        return sendJson(response, 200, service.listSavedVehicleLists(context))
      }
      if (request.method === 'POST' && route === '/saved-lists') {
        assertLocalWriteOrigin(request)
        assertSavedListOwner(context, request.headers['x-inventory-saved-list-owner'])
        const result = service.mutateSavedVehicleList(
          await readJson(request, SAVED_LIST_BODY_BYTES),
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      if (route === '/saved-lists') {
        return sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
      }
      if (request.method === 'GET' && route === '/vehicles') {
        return sendJson(response, 200, service.listVehicles(queryObject(url), context))
      }
      if (request.method === 'GET' && route === '/vehicle-issues') {
        return sendJson(response, 200, service.listVehicleIssues(queryObject(url), context))
      }
      const issueMatch = route.match(/^\/vehicle-issues\/([^/]+)$/)
      if (request.method === 'GET' && issueMatch) {
        return sendJson(response, 200, service.getVehicleIssue(pathSegment(issueMatch[1]), context))
      }
      const issueEventMatch = route.match(/^\/vehicle-issues\/([^/]+)\/events$/)
      if (request.method === 'POST' && issueEventMatch) {
        assertLocalWriteOrigin(request)
        const prepared = prepareIssueInput(await readJson(request, ISSUE_BODY_BYTES))
        const result = service.appendVehicleIssueEvent(
          pathSegment(issueEventMatch[1]),
          prepared.input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        if (result.created) {
          for (const photo of prepared.photos) issuePhotos.set(`${result.record.vin}/${photo.metadata.id}`, photo.bytes)
        }
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const issuePhotoMatch = route.match(/^\/vehicle-issues\/([^/]+)\/photos\/([a-f0-9]{64})$/)
      if (request.method === 'GET' && issuePhotoMatch) {
        const issue = service.getVehicleIssue(pathSegment(issuePhotoMatch[1]), context)
        const photo = issue.photos.find(photo => photo.id === issuePhotoMatch[2])
        if (!photo) throw new HttpError('Photo not found.', 404, 'PHOTO_NOT_FOUND')
        const bytes = issuePhotos.get(`${issue.vin}/${photo.id}`)
        if (!bytes) throw new HttpError('Photo unavailable. Try again.', 503, 'PHOTO_UNAVAILABLE')
        securityHeaders(response)
        response.setHeader('Content-Type', 'image/jpeg')
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        response.end(bytes)
        return
      }
      const vehicleMatch = route.match(/^\/vehicles\/([^/]+)$/)
      if (request.method === 'GET' && vehicleMatch) {
        return sendJson(response, 200, service.getVehicle(pathSegment(vehicleMatch[1]), context))
      }
      const vehicleIssueMatch = route.match(/^\/vehicles\/([^/]+)\/issues$/)
      if (request.method === 'POST' && vehicleIssueMatch) {
        assertLocalWriteOrigin(request)
        const prepared = prepareIssueInput(await readJson(request, ISSUE_BODY_BYTES))
        const result = service.createVehicleIssue(
          pathSegment(vehicleIssueMatch[1]),
          prepared.input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        if (result.created) {
          for (const photo of prepared.photos) issuePhotos.set(`${result.record.vin}/${photo.metadata.id}`, photo.bytes)
        }
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const equipmentPdfMatch = route.match(/^\/vehicles\/([^/]+)\/equipment-pdf$/)
      if (request.method === 'GET' && equipmentPdfMatch) {
        const vin = pathSegment(equipmentPdfMatch[1])
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) || !workspaceRoot) throw new HttpError('Equipment PDF unavailable', 404, 'EQUIPMENT_PDF_NOT_CAPTURED')
        const vehicle = service.getVehicle(vin, context)
        const equipment = vehicle.factoryEquipment
        const sha256 = equipment?.savedPdfSha256
        if (equipment?.dataState !== 'current' || equipment?.isOriginalWindowSticker !== false ||
            !/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new HttpError('Equipment PDF unavailable', 404, 'EQUIPMENT_PDF_NOT_CAPTURED')
        const folder = path.join(workspaceRoot, 'work', 'vauto-documents')
        const indexPath = path.join(folder, 'index.json')
        if (!existsSync(indexPath)) throw new HttpError('Saved equipment PDF unavailable', 503, 'EQUIPMENT_PDF_UNAVAILABLE')
        const index = JSON.parse(readFileSync(indexPath, 'utf8'))
        const entry = index.byVin?.[vin]
        const file = path.join(folder, 'objects', `${sha256}.pdf`)
        if (index.schema !== 'vauto-equipment-pdf-cache-v1' || entry?.sha256 !== sha256 ||
            entry?.sourceUrl !== equipment.url ||
            !['printed_vin', 'vauto_exact_vin_image_only'].includes(entry?.vinVerification) || !existsSync(file)) {
          throw new HttpError('Saved equipment PDF unavailable', 503, 'EQUIPMENT_PDF_UNAVAILABLE')
        }
        const size = statSync(file).size
        const pdf = size <= 8 * 1024 * 1024 ? readFileSync(file) : Buffer.alloc(0)
        if (size < 8 || size > 8 * 1024 * 1024 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-' ||
            !pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1').includes('%%EOF') ||
            createHash('sha256').update(pdf).digest('hex') !== sha256) {
          throw new HttpError('Saved equipment PDF failed integrity check', 503, 'EQUIPMENT_PDF_UNAVAILABLE')
        }
        securityHeaders(response)
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/pdf')
        response.setHeader('Content-Disposition', `inline; filename="${vin}-vauto-equipment.pdf"`)
        response.setHeader('Content-Length', size)
        return sendFile(file, response)
      }
      const serviceMatch = route.match(/^\/vehicles\/([^/]+)\/service$/)
      if (request.method === 'GET' && serviceMatch) {
        return sendJson(response, 200, service.getServiceReadiness(pathSegment(serviceMatch[1]), context))
      }
      if (request.method === 'POST' && serviceMatch) {
        const input = await readJson(request)
        const result = service.updateServiceReadiness(pathSegment(serviceMatch[1]), input, context, String(request.headers['idempotency-key'] ?? '') || undefined)
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      // The app-owned disposition ledger: a manager's own record, never a
      // write to DealerMail, CDK, the listing or the imported manager log.
      const dispositionMatch = route.match(/^\/vehicles\/([^/]+)\/disposition$/)
      if (request.method === 'GET' && dispositionMatch) {
        return sendJson(response, 200, service.getDisposition(pathSegment(dispositionMatch[1]), context))
      }
      if (request.method === 'POST' && dispositionMatch) {
        const input = await readJson(request)
        const result = service.updateDisposition(pathSegment(dispositionMatch[1]), input, context, String(request.headers['idempotency-key'] ?? '') || undefined)
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      if (request.method === 'GET' && route === '/attention') {
        return sendJson(response, 200, service.listAttention(queryObject(url), context))
      }
      const attentionEventMatch = route.match(/^\/attention\/([^/]+)\/events$/)
      if (request.method === 'POST' && attentionEventMatch) {
        const input = await readJson(request)
        const result = service.appendAttentionEvent(
          pathSegment(attentionEventMatch[1]),
          input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const attentionMatch = route.match(/^\/attention\/([^/]+)$/)
      if (request.method === 'GET' && attentionMatch) {
        return sendJson(response, 200, service.getAttention(pathSegment(attentionMatch[1]), context))
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
          pathSegment(eventMatch[1]),
          input,
          context,
          String(request.headers['idempotency-key'] ?? '') || undefined,
        )
        return sendJson(response, result.created ? 201 : 200, result.record)
      }
      const transferMatch = route.match(/^\/transfers\/([^/]+)$/)
      if (request.method === 'GET' && transferMatch) {
        return sendJson(response, 200, service.getTransfer(pathSegment(transferMatch[1]), context))
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
