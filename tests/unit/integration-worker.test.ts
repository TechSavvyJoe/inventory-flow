// @vitest-environment node
// @ts-nocheck -- isolated synthetic gateway tests, never a live credential/store.
import { describe, expect, it, vi } from 'vitest'
import { createIntegrationWorker } from '../../cloudflare/src/integration-worker.mjs'
import { createIntegrationReadService } from '../../server/integrations/read-service.mjs'
import { IntegrationAccessError } from '../../cloudflare/src/integration-access.mjs'

const HOST = 'inventory.test'
const env = { INTEGRATIONS_ENABLED: 'true', INTEGRATION_HOSTNAME: HOST }
const scopes = ['inventory.read', 'health.read', 'changes.read', 'holds.aggregate.read']
const principal = { clientId: 'a'.repeat(32), userId: 'synthetic-user', role: 'sales', stores: ['Howell'], scopes }
const vin = '1FTFW1E50NFA00001'
const canary = 'PRIVATE_CUSTOMER_AND_RAW_CREDENTIAL_CANARY'
function readService(who = principal) {
  return createIntegrationReadService({ principal: who, bundleSha256: 'c'.repeat(64), cursorSecret: 'Synthetic-not-live-cursor-key-with-32-chars', bootstrap: {
    meta: { reportDate: '2026-09-09', completedAt: '2026-09-09T13:00:00Z', publicFreshness: 'current', dealerMailFreshness: 'current', warnings: [canary] },
    vehicles: [
      { vin, stockNumber: '0001TEST', vehicleName: '2024 Ford F-150 XLT', make: 'Ford', model: 'F-150', year: 2024, publicStore: 'Howell', homeStore: 'Howell', listedPrice: 40000, hold: { state: 'none_observed', primarySalesperson: canary }, privateEvidence: { customer: canary }, searchText: canary },
      { vin: '1FTFW1E50NFA00002', stockNumber: '0002TEST', publicStore: 'Lincoln', vehicleName: 'Out of scope' },
    ], publicChanges: [],
  } })
}
function setup(overrides = {}) {
  const authenticate = vi.fn(async () => principal), audit = vi.fn(async () => {}), quota = vi.fn(async () => ({ limit: 60, remaining: 59, resetAt: Date.now() + 60000 }))
  const loadReadService = vi.fn(async (_env, who) => readService(who))
  const deps = { authenticate, audit, quota, loadReadService, ...overrides }
  return { ...deps, worker: createIntegrationWorker(deps) }
}
const request = (path, init = {}) => new Request(`https://${HOST}${path}`, init)

describe('isolated shared data gateway', () => {
  it('returns allowlisted scoped data and security headers; audits before delivery', async () => {
    const test = setup()
    const result = await test.worker.fetch(request('/api/v1/inventory'), env)
    expect(result.status).toBe(200)
    const json = await result.json()
    expect(json.data.map(row => row.vin)).toEqual([vin])
    expect(JSON.stringify(json)).not.toContain(canary)
    expect(result.headers.get('cache-control')).toContain('no-store')
    expect(result.headers.get('access-control-allow-origin')).toBeNull()
    expect(result.headers.get('ratelimit-remaining')).toBe('59')
    expect(test.audit).toHaveBeenCalledWith(env, principal, { operation: 'inventory_list', status: 200, resultCount: 1 })
  })
  it.each(['/api/v1/inventory', `/api/v1/vehicles/${vin}`, '/api/v1/changes', '/api/v1/data-health', '/api/v1/holds/summary', '/api/v1/capabilities'])('serves %s', async path => {
    const test = setup()
    expect((await test.worker.fetch(request(path), env)).status).toBe(200)
  })
  it.each(['/api/bootstrap', '/internal/readiness', '/internal/publish', '/api/v1/transfers', '/api/v1/attention', '/api/v1/sql', '/api/v1/snapshots'])('never exposes app/private/write surface %s', async path => {
    const test = setup()
    expect((await test.worker.fetch(request(path), env)).status).toBe(404)
    expect(test.loadReadService).not.toHaveBeenCalled()
  })
  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('rejects %s API operations', async method => {
    const test = setup()
    const result = await test.worker.fetch(request('/api/v1/inventory', { method }), env)
    expect(result.status).toBe(405)
    expect(result.headers.get('allow')).toBe('GET')
    expect(test.authenticate).not.toHaveBeenCalled()
    expect(test.loadReadService).not.toHaveBeenCalled()
  })
  it('fails closed on disabled, incorrect host, plain HTTP, and cross-origin requests', async () => {
    const test = setup()
    expect((await test.worker.fetch(request('/api/v1/inventory'), { ...env, INTEGRATIONS_ENABLED: 'false' })).status).toBe(503)
    for (const req of [new Request('https://wrong.test/api/v1/inventory'), new Request(`http://${HOST}/api/v1/inventory`), request('/api/v1/inventory', { headers: { Origin: 'https://evil.test' } })]) {
      expect((await test.worker.fetch(req, env)).status).toBe(403)
    }
    expect(test.loadReadService).not.toHaveBeenCalled()
  })
  it.each(['?limit=1&limit=2', '?__proto__=value', '?arbitrarySQL=SELECT', '?q=' + 'a'.repeat(4097)])('rejects invalid query %s', async query => {
    const test = setup()
    expect((await test.worker.fetch(request('/api/v1/inventory' + query), env)).status).toBe(400)
  })
  it.each(['/api/v1/data-health?store=Howell', '/api/v1/capabilities?private=true', `/api/v1/vehicles/${vin}?details=private`])('rejects query on exact route %s', async path => {
    expect((await setup().worker.fetch(request(path), env)).status).toBe(400)
  })
  it('does not decrypt data when authentication or quota fails', async () => {
    const auth = setup({ authenticate: async () => { throw new IntegrationAccessError() } })
    expect((await auth.worker.fetch(request('/api/v1/inventory'), env)).status).toBe(401)
    expect(auth.loadReadService).not.toHaveBeenCalled()
    const limited = setup({ quota: async () => { throw new IntegrationAccessError('INTEGRATION_RATE_LIMITED', 429, 17) } })
    const result = await limited.worker.fetch(request('/api/v1/inventory'), env)
    expect(result.status).toBe(429)
    expect(result.headers.get('retry-after')).toBe('17')
    expect(limited.loadReadService).not.toHaveBeenCalled()
  })
  it('suppresses results if audit fails and never returns storage exception details', async () => {
    const test = setup({ audit: async () => { throw new Error(canary) } })
    const result = await test.worker.fetch(request('/api/v1/inventory'), env)
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain(vin)
    const failure = setup({ loadReadService: async () => { throw new Error(canary) } })
    const failed = await failure.worker.fetch(request('/api/v1/inventory'), env)
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain(canary)
  })
  it('enforces scopes on REST too and avoids cross-principal cache', async () => {
    let who = { ...principal, scopes: ['health.read'] }
    const test = setup({ authenticate: async () => who })
    expect((await test.worker.fetch(request('/api/v1/inventory'), env)).status).toBe(403)
    who = principal
    expect((await test.worker.fetch(request('/api/v1/inventory'), env)).status).toBe(200)
    expect(test.loadReadService).toHaveBeenCalledTimes(2)
  })
  it('bounds response bytes', async () => {
    const test = setup({ loadReadService: async () => ({ inventory: () => ({ data: canary.repeat(100000) }) }) })
    const result = await test.worker.fetch(request('/api/v1/inventory'), env)
    expect(result.status).toBe(413)
    expect(await result.text()).not.toContain(canary)
  })
  it.each([
    ['GET', null, 405],
    ['POST', [{ jsonrpc: '2.0', method: 'tools/list', id: 1 }], 400],
    ['POST', { jsonrpc: '2.0', method: 'resources/subscribe', id: 1 }, 400],
    ['POST', { jsonrpc: '2.0', method: 'tools/call', params: { arguments: { q: 'a'.repeat(17000) } }, id: 1 }, 413],
  ])('bounds MCP request methods/body: %s', async (method, body, status) => {
    const test = setup()
    const req = request('/mcp', { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) })
    expect((await test.worker.fetch(req, env)).status).toBe(status)
    expect(test.loadReadService).not.toHaveBeenCalled()
  })
})
