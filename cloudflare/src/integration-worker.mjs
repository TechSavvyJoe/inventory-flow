import { authenticateIntegration, consumeIntegrationQuota, auditIntegrationAccess, IntegrationAccessError } from './integration-access.mjs'
import { readReleaseWithIdentity, readJson, versionMetadata } from './worker.mjs'
import { loadD1Repository } from './repository.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { createIntegrationReadService, IntegrationReadError } from '../../server/integrations/read-service.mjs'
import { createInventoryMcpHandler } from '../../server/integrations/mcp.mjs'
import { integrationBootstrapFromSource } from '../../server/integrations/source-bootstrap.mjs'

const MAX_RESPONSE = 1024 * 1024
const encoder = new TextEncoder()
const SAFE_HEADERS = {
  'Cache-Control': 'private, no-store', 'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
}
export const TOOL_OPERATIONS = {
  inventory: 'inventory_list', vehicle: 'inventory_get', operationalInventory: 'operational_inventory_search', vehicleResources: 'vehicle_resources_get',
  changes: 'changes_list', health: 'health', dailyOperations: 'daily_operations_get', dataQuality: 'data_quality_get', reconciliation: 'reconciliation_get',
  holdSummary: 'holds_summary', managerDispositions: 'manager_dispositions_list',
}
const MCP_METHODS = new Set(['server/discover', 'initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call'])

function response(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...SAFE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra } })
}
function fail(code, status) { throw new IntegrationAccessError(code, status) }
function queryOf(url) {
  const result = Object.create(null)
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key) || key === '__proto__' || key.length > 80 || value.length > 4096) fail('INVALID_QUERY', 400)
    result[key] = value
  }
  return result
}
function noQuery(url) { if (url.search) fail('INVALID_QUERY', 400) }
function routeFor(url) {
  if (url.pathname === '/api/v1/inventory') return { operation: 'inventory_list', method: 'inventory', query: true }
  if (url.pathname === '/api/v1/changes') return { operation: 'changes_list', method: 'changes', query: true }
  if (url.pathname === '/api/v1/data-health') return { operation: 'health', method: 'health' }
  if (url.pathname === '/api/v1/holds/summary') return { operation: 'holds_summary', method: 'holdSummary', query: true }
  if (url.pathname === '/api/v1/manager-dispositions') return { operation: 'manager_dispositions_list', method: 'managerDispositions', query: true }
  if (url.pathname === '/api/v1/capabilities') return { operation: 'other', method: 'capabilities' }
  const match = /^\/api\/v1\/vehicles\/([A-HJ-NPR-Z0-9]{17})$/.exec(url.pathname)
  if (match) return { operation: 'inventory_get', method: 'vehicle', vin: match[1] }
  fail('NOT_FOUND', 404)
}
function resultCount(result) { return Array.isArray(result?.data) ? result.data.length : result?.data ? 1 : 0 }
function errorInfo(error) {
  if (error instanceof IntegrationAccessError || error instanceof IntegrationReadError) return { status: error.status, code: error.code }
  // Release validation, storage and SDK failures can contain source or credential
  // metadata. Expose only fixed failures, never exception messages or stack traces.
  return { status: 503, code: 'INTEGRATION_DATA_UNAVAILABLE' }
}

// The decrypted release is already cached per isolate (worker.mjs), but every
// request still rebuilt the D1 snapshot, the full app bootstrap and the scoped
// projection, nearly all of a page's CPU. Paging the inventory repeated that
// build once per page and could exceed the Worker CPU limit after a publish.
// One built read service is kept per principal, valid only for the same
// decoded release, the same ledger revision (every app write bumps it), the
// same report day (source freshness is judged against it) and the same cursor
// secret; the lifetime bound also caps any input none of those keys cover.
const READ_SERVICE_CACHE_LIMIT = 4
const READ_SERVICE_CACHE_TTL_MS = 60 * 1000
const readServiceCache = new Map()
export function resetIntegrationReadServiceCache() { readServiceCache.clear() }

// Every principal field, lists order-free: a different client, identity, role,
// store, grant or scope set is a different entry and never shares a projection.
function principalKey(principal) {
  return JSON.stringify(Object.keys(principal).sort().map(key => [key, Array.isArray(principal[key]) ? [...principal[key]].sort() : principal[key]]))
}
// Mirrors the service core's freshness clock: the date in the release time zone.
function reportDay(release, now) {
  const timeZone = release?.manifest?.timezone || 'America/New_York'
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
async function ledgerRevision(env) {
  const revision = (await env.INVENTORY_DB.prepare('SELECT revision FROM cloud_app_revision WHERE id = 1').first())?.revision
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('The shared workflow revision is not initialized')
  return revision
}

/** Callers authenticate and charge quota before this and audit after; it never authorizes. */
export async function loadIntegrationReadService(env, principal) {
  const selected = await readReleaseWithIdentity(env)
  const revision = await ledgerRevision(env)
  const now = Date.now()
  const day = reportDay(selected.release, new Date(now))
  // Drop entries for a superseded release first, so its projections are freed
  // before the new release's first build allocates.
  for (const [key, entry] of readServiceCache) if (entry.release !== selected.release || entry.expiresAt <= now) readServiceCache.delete(key)
  const key = principalKey(principal)
  const cached = readServiceCache.get(key)
  if (cached && cached.bundleSha256 === selected.bundleSha256 && cached.revision === revision && cached.day === day && cached.cursorSecret === env.INTEGRATION_CURSOR_SECRET) {
    readServiceCache.delete(key)
    readServiceCache.set(key, cached)
    return cached.service
  }
  const repo = await loadD1Repository(env.INVENTORY_DB, selected.release)
  const service = createInventoryServiceCore({ database: repo.database, repository: repo.repository, initialLoadStatus: { status: 'loaded' } })
  const readService = createIntegrationReadService({
    bootstrap: integrationBootstrapFromSource(service.bootstrap(principal, { overview: false }), selected.release), principal, bundleSha256: selected.bundleSha256,
    cursorSecret: env.INTEGRATION_CURSOR_SECRET,
  })
  // Tagged with the snapshot's own revision, so a write that landed between
  // the two reads is not mistaken for the state it built from.
  readServiceCache.delete(key)
  readServiceCache.set(key, {
    release: selected.release, bundleSha256: selected.bundleSha256, revision: repo.revision, day,
    cursorSecret: env.INTEGRATION_CURSOR_SECRET, expiresAt: now + READ_SERVICE_CACHE_TTL_MS, service: readService,
  })
  while (readServiceCache.size > READ_SERVICE_CACHE_LIMIT) readServiceCache.delete(readServiceCache.keys().next().value)
  return readService
}

/** Separate read-only gateway: never delegates to the app's mutable route handler.
 * Dependencies are injected only by isolated tests; no environment auth bypass.
 */
export function createIntegrationWorker({
  authenticate = authenticateIntegration, quota = consumeIntegrationQuota,
  audit = auditIntegrationAccess, loadReadService = loadIntegrationReadService,
  mcpFactory = createInventoryMcpHandler,
} = {}) {
  return {
    async fetch(request, env) {
      let principal, operation = 'other', audited = false, quotaHeaders = {}, mcpHandler
      try {
        const url = new URL(request.url)
        if (env.INTEGRATIONS_ENABLED !== 'true') fail('INTEGRATIONS_NOT_CONFIGURED', 503)
        if (url.protocol !== 'https:' || !env.INTEGRATION_HOSTNAME || url.hostname !== env.INTEGRATION_HOSTNAME || url.port) fail('INTEGRATION_HOST_NOT_ALLOWED', 403)
        // These credentials belong in backend applications, not arbitrary browser
        // pages. No cross-origin cookie auth or wildcard CORS is offered.
        if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) fail('ORIGIN_NOT_ALLOWED', 403)
        if (url.href.length > 8192) fail('REQUEST_TOO_LARGE', 414)
        const isMcp = url.pathname === '/mcp'
        const route = isMcp ? null : routeFor(url)
        operation = route?.operation ?? 'mcp_initialize'
        if (request.method !== (isMcp ? 'POST' : 'GET')) fail('METHOD_NOT_ALLOWED', 405)
        if (isMcp) noQuery(url)
        principal = await authenticate(request, env)
        const consumed = await quota(env, principal)
        quotaHeaders = { 'RateLimit-Limit': String(consumed.limit), 'RateLimit-Remaining': String(consumed.remaining), 'RateLimit-Reset': String(Math.ceil(consumed.resetAt / 1000)) }
        // Authentication and quota above run on every request before any cached
        // read service is used; that cache is per principal, never shared.
        let readService
        const getReadService = () => readService ??= Promise.resolve(loadReadService(env, principal))
        if (isMcp) {
          let body
          try { body = await readJson(request, 16 * 1024) } catch (error) {
            const known = ['JSON_CONTENT_REQUIRED', 'BODY_TOO_LARGE', 'EMPTY_BODY', 'INVALID_JSON']
            fail(known.includes(error.code) ? error.code : 'INVALID_JSON', error.status === 413 ? 413 : error.status === 415 ? 415 : 400)
          }
          if (body.jsonrpc !== '2.0' || !MCP_METHODS.has(body.method)) fail('MCP_METHOD_NOT_ALLOWED', 400)
          operation = body.method === 'tools/call' ? 'mcp_tools_call' : body.method === 'tools/list' ? 'mcp_tools_list' : body.method.startsWith('notifications/') ? 'mcp_notification' : 'mcp_initialize'
          mcpHandler = mcpFactory({ getReadService, principal, onToolResult: async details => {
            await audit(env, principal, { ...details, operation: TOOL_OPERATIONS[details.operation] ?? 'mcp_tools_call' })
          } })
          const forwarded = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) })
          const result = await mcpHandler.fetch(forwarded)
          const serialized = await result.text()
          if (encoder.encode(serialized).byteLength > MAX_RESPONSE) fail('RESPONSE_TOO_LARGE', 413)
          await audit(env, principal, { operation, status: result.status, resultCount: 0 })
          audited = true
          const resultHeaders = new Headers(result.headers)
          for (const [name, value] of Object.entries({ ...SAFE_HEADERS, ...quotaHeaders })) resultHeaders.set(name, value)
          return new Response([204, 205, 304].includes(result.status) ? null : serialized, { status: result.status, headers: resultHeaders })
        }
        const query = route.query ? queryOf(url) : (noQuery(url), undefined)
        const service = await getReadService()
        const rawData = route.method === 'capabilities' ? service.capabilities : service[route.method](route.vin ?? query)
        const data = route.method === 'health' ? { ...rawData, version: versionMetadata(env) } : rawData
        const serialized = JSON.stringify(data)
        if (encoder.encode(serialized).byteLength > MAX_RESPONSE) fail('RESPONSE_TOO_LARGE', 413)
        await audit(env, principal, { operation, status: 200, resultCount: resultCount(data) })
        audited = true
        return new Response(serialized, { headers: { ...SAFE_HEADERS, ...quotaHeaders, 'Content-Type': 'application/json; charset=utf-8' } })
      } catch (error) {
        let details = errorInfo(error)
        if (principal && !audited) {
          try { await audit(env, principal, { operation, status: details.status, resultCount: 0 }) } catch { details = { status: 503, code: 'INTEGRATION_AUDIT_UNAVAILABLE' } }
        }
        const extra = { ...quotaHeaders }
        if (details.status === 405) extra.Allow = new URL(request.url).pathname === '/mcp' ? 'POST' : 'GET'
        if (details.status === 429) extra['Retry-After'] = String(error.retryAfter ?? 60)
        if (details.status === 401) extra['WWW-Authenticate'] = 'Bearer realm="inventory-flow"'
        return response(details.status, { error: { code: details.code } }, extra)
      } finally {
        // The stateless JSON response is completely consumed before teardown.
        if (mcpHandler) await mcpHandler.close().catch(() => {})
      }
    },
  }
}

export default createIntegrationWorker()
