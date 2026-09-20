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
const TOOL_OPERATIONS = {
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

export async function loadIntegrationReadService(env, principal) {
  const selected = await readReleaseWithIdentity(env)
  const repo = await loadD1Repository(env.INVENTORY_DB, selected.release)
  const service = createInventoryServiceCore({ database: repo.database, repository: repo.repository, initialLoadStatus: { status: 'loaded' } })
  return createIntegrationReadService({
    bootstrap: integrationBootstrapFromSource(service.bootstrap(principal), selected.release), principal, bundleSha256: selected.bundleSha256,
    cursorSecret: env.INTEGRATION_CURSOR_SECRET,
  })
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
        // A new selected release/principal for every request. No cross-client cache.
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
