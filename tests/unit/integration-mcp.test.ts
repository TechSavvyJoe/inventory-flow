// @vitest-environment node
// @ts-nocheck -- portable ESM adapter; all data and identities below are synthetic.
import { describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createInventoryMcpHandler } from '../../server/integrations/mcp.mjs'
import { createIntegrationReadService, IntegrationReadError } from '../../server/integrations/read-service.mjs'
import { createIntegrationWorker } from '../../cloudflare/src/integration-worker.mjs'

const PRIVATE = 'SYNTHETIC_PRIVATE_CANARY_DO_NOT_EXPORT'
const principal = { userId: 'synthetic-user', clientId: 'synthetic-ai', role: 'sales', stores: ['Howell'], scopes: ['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read'] }
const vinFor = index => `1FTFW1E50NFA${String(index).padStart(5, '0')}`
const bootstrap = {
  meta: { reportDate: '2026-09-09', completedAt: '2026-09-09T13:00:00Z', timezone: 'America/New_York', publicFreshness: 'current', dealerMailFreshness: 'current', managerDispositionFreshness: 'current', managerDispositionCoverageStatus: 'provided', managerDispositionCoveredSourceStores: ['Howell'] },
  vehicles: Array.from({ length: 4 }, (_, i) => ({
    vin: vinFor(i + 1), stockNumber: `000${i}TEST`, year: 2024, make: 'Ford', model: 'F-150', trim: 'XLT', vehicleName: `2024 Ford F-150 XLT ${i}`,
    publicStore: i === 3 ? 'Lincoln' : 'Howell', homeStore: 'Howell', listedPrice: 40000 + i, mileage: 2000 + i, features: 'TRAILER TOW PACKAGE; SYNC 4',
    hold: { state: i ? 'none_observed' : 'primary', backupCount: 0, customerOrReason: PRIVATE, primarySalesperson: PRIVATE },
    privateEvidence: { comments: [{ text: PRIVATE }] }, dealerComments: PRIVATE, raw: { secret: PRIVATE },
  })),
  publicChanges: [{ id: 'synthetic-change', type: 'price_change', field: 'Listed price', reportDate: '2026-09-09', previousReportDate: '2026-09-08', vin: vinFor(1), stockNumber: '0000TEST', vehicleName: '2024 Ford F-150', store: 'Howell', beforeValue: 42000, afterValue: 40000 }],
  managerDispositions: [{ stockNumber: '0000TEST', vin: vinFor(1), vehicleName: '2024 Ford F-150 XLT 0', soldManagerLog: true, deliveredManagerLog: true, deliveryDate: '2026-09-09', confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false, privateNote: PRIVATE }],
}
function readService(who = principal) {
  return createIntegrationReadService({ bootstrap, principal: who, bundleSha256: 'a'.repeat(64), cursorSecret: 'synthetic-cursor-signing-secret-only-0123456789', now: () => new Date('2026-09-09T14:00:00Z') })
}
async function connect({ who = principal, getReadService = () => readService(who), onToolResult, mode = 'auto' } = {}) {
  const handler = createInventoryMcpHandler({ principal: who, getReadService, onToolResult })
  const requests = [], responses = []
  const client = new Client({ name: 'synthetic-test-client', version: '1.0.0' }, { versionNegotiation: { mode } })
  const transport = new StreamableHTTPClientTransport(new URL('https://inventory.test/mcp'), {
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request.method === 'POST' ? await request.clone().json() : request.method)
      const response = await handler.fetch(request)
      responses.push({ status: response.status, contentType: response.headers.get('content-type'), session: response.headers.get('mcp-session-id') })
      return response
    },
  })
  await client.connect(transport)
  return { client, handler, requests, responses, close: async () => { await client.close(); await handler.close() } }
}
const dataOf = result => {
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }])
  return result.structuredContent
}

describe('official SDK2 read-only inventory MCP adapter', () => {
  it.each(['auto', 'legacy'])('supports a real %s discovery/handshake, tool listing and all six tools', async mode => {
    const getReadService = vi.fn(() => readService()), audit = vi.fn()
    const connection = await connect({ mode, getReadService, onToolResult: audit })
    try {
      const { tools } = await connection.client.listTools()
      expect(tools.map(tool => tool.name)).toEqual(['search_inventory', 'get_vehicle', 'get_inventory_changes', 'get_data_health', 'get_hold_summary', 'list_manager_dispositions'])
      expect(getReadService).not.toHaveBeenCalled()
      for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
      const inventory = dataOf(await connection.client.callTool({ name: 'search_inventory', arguments: { q: 'tow', limit: 2, sort: 'mileage', direction: 'desc' } }))
      expect(inventory.data).toHaveLength(2)
      expect(inventory.pagination).toMatchObject({ total: 3, returned: 2 })
      const second = dataOf(await connection.client.callTool({ name: 'search_inventory', arguments: { q: 'tow', limit: 2, sort: 'mileage', direction: 'desc', cursor: inventory.pagination.nextCursor } }))
      expect(second.data).toHaveLength(1)
      expect(second.pagination.nextCursor).toBeNull()
      const vehicle = dataOf(await connection.client.callTool({ name: 'get_vehicle', arguments: { vin: vinFor(1) } }))
      expect(vehicle.data.features).toContain('TRAILER TOW PACKAGE')
      const changes = dataOf(await connection.client.callTool({ name: 'get_inventory_changes', arguments: { type: 'price_change', from: '2026-09-09', to: '2026-09-09', limit: 1 } }))
      expect(changes.pagination.total).toBe(1)
      const health = dataOf(await connection.client.callTool({ name: 'get_data_health', arguments: {} }))
      expect(health.data.visibleVehicleCount).toBe(3)
      const holds = dataOf(await connection.client.callTool({ name: 'get_hold_summary', arguments: { store: 'Howell' } }))
      expect(holds.data[0].currentHeldVins).toBe(1)
      const dispositions = dataOf(await connection.client.callTool({ name: 'list_manager_dispositions', arguments: { store: 'Howell', delivered: true, review: false } }))
      expect(dispositions.pagination).toMatchObject({ total: 1, returned: 1 })
      expect(dispositions.data[0]).toMatchObject({ soldManagerLog: true, deliveredManagerLog: true, sourceStore: 'Howell', physicalStore: 'Howell' })
      expect(JSON.stringify([inventory, second, vehicle, changes, health, holds, dispositions])).not.toContain(PRIVATE)
      expect(audit).toHaveBeenCalledTimes(7)
      expect(audit.mock.calls.every(([record]) => record.status === 200 && !JSON.stringify(record).includes('vin'))).toBe(true)
      expect(audit).toHaveBeenCalledWith({ operation: 'managerDispositions', status: 200, resultCount: 1 })
      expect(connection.responses.every(response => response.session === null)).toBe(true)
      if (mode === 'auto') expect(connection.responses.filter(response => response.status === 200).every(response => response.contentType?.includes('application/json'))).toBe(true)
    } finally { await connection.close() }
  })

  it.each([
    ['inventory.read', ['search_inventory', 'get_vehicle', 'list_manager_dispositions']], ['changes.read', ['get_inventory_changes']],
    ['health.read', ['get_data_health']], ['holds.aggregate.read', ['get_hold_summary']],
  ])('registers only tools granted by %s and denies an unlisted tool', async (scope, names) => {
    const who = { ...principal, scopes: [scope] }, getter = vi.fn(() => readService(who))
    const connection = await connect({ who, getReadService: getter })
    try {
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).toEqual(names)
      const denied = names.includes('get_data_health') ? 'search_inventory' : 'get_data_health'
      await expect(connection.client.callTool({ name: denied, arguments: {} })).rejects.toThrow()
      expect(getter).not.toHaveBeenCalled()
    } finally { await connection.close() }
  })

  it('advertises strict primitive schemas and rejects unsupported, mistyped or unbounded arguments', async () => {
    const getter = vi.fn(() => readService()), connection = await connect({ getReadService: getter })
    try {
      const { tools } = await connection.client.listTools()
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object')
        expect(tool.inputSchema.additionalProperties).toBe(false)
        for (const schema of Object.values(tool.inputSchema.properties)) expect(['string', 'number', 'integer', 'boolean']).toContain(schema.type)
      }
      expect(tools.find(tool => tool.name === 'search_inventory').inputSchema.properties.limit.maximum).toBe(100)
      for (const args of [{ sql: 'SELECT * FROM raw' }, { limit: 101 }, { limit: '2' }, { sort: 'customer' }, { store: 'Unknown' }, { q: 'a'.repeat(257) }, { cursor: 'a'.repeat(8193) }, { minPrice: -1 }, { year: 2024.5 }, { holdState: true }]) {
        expect((await connection.client.callTool({ name: 'search_inventory', arguments: args })).isError).toBe(true)
      }
      expect((await connection.client.callTool({ name: 'get_vehicle', arguments: { vin: 'INVALID' } })).isError).toBe(true)
      expect((await connection.client.callTool({ name: 'get_data_health', arguments: { includePrivate: true } })).isError).toBe(true)
      expect(getter).not.toHaveBeenCalled()
    } finally { await connection.close() }
  })

  it('sanitizes service errors, excludes inaccessible vehicles and audits failures', async () => {
    const audit = vi.fn(), connection = await connect({ onToolResult: audit })
    try {
      const missing = await connection.client.callTool({ name: 'get_vehicle', arguments: { vin: vinFor(4) } })
      expect(missing.isError).toBe(true)
      expect(dataOf(missing).error).toEqual({ code: 'NOT_FOUND', message: 'Vehicle not found.' })
      const badPage = await connection.client.callTool({ name: 'search_inventory', arguments: { cursor: 'not-a-signed-cursor' } })
      expect(badPage.isError).toBe(true)
      expect(dataOf(badPage).error.code).toBe('INVALID_CURSOR')
      expect(audit.mock.calls).toEqual([[{ operation: 'vehicle', status: 404, resultCount: 0 }], [{ operation: 'inventory', status: 400, resultCount: 0 }]])
    } finally { await connection.close() }
    for (const error of [new Error(PRIVATE), new IntegrationReadError(PRIVATE, { code: 'INVALID_QUERY', status: 400 })]) {
      const failing = await connect({ getReadService: () => { throw error } })
      try {
        const result = await failing.client.callTool({ name: 'get_data_health', arguments: {} })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result)).not.toContain(PRIVATE)
      } finally { await failing.close() }
    }
  })

  it('suppresses oversized results and counts both response representations', async () => {
    const audit = vi.fn(), connection = await connect({ onToolResult: audit, getReadService: () => ({ health: () => ({ data: { value: 'x'.repeat(600000) } }) }) })
    try {
      const result = await connection.client.callTool({ name: 'get_data_health', arguments: {} })
      expect(dataOf(result).error.code).toBe('RESPONSE_TOO_LARGE')
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(1024 * 1024)
      expect(audit).toHaveBeenCalledWith({ operation: 'health', status: 413, resultCount: 0 })
    } finally { await connection.close() }
  })

  it('awaits audit and fails closed if audit cannot be stored', async () => {
    let audited = false
    const connection = await connect({ onToolResult: async () => { await Promise.resolve(); audited = true; throw new Error(PRIVATE) } })
    try {
      const result = await connection.client.callTool({ name: 'get_data_health', arguments: {} })
      expect(audited).toBe(true)
      expect(dataOf(result).error.code).toBe('AUDIT_UNAVAILABLE')
      expect(JSON.stringify(result)).not.toContain('visibleVehicleCount')
      expect(JSON.stringify(result)).not.toContain(PRIVATE)
    } finally { await connection.close() }
  })

  it('keeps grants isolated per handler and rechecks the service permission', async () => {
    const who = { ...principal, scopes: ['health.read'] }, noScopes = { ...principal, scopes: [] }
    const connection = await connect({ who, getReadService: () => readService(noScopes) })
    who.scopes.push('inventory.read')
    try {
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).toEqual(['get_data_health'])
      const result = await connection.client.callTool({ name: 'get_data_health', arguments: {} })
      expect(dataOf(result).error.code).toBe('INSUFFICIENT_SCOPE')
    } finally { await connection.close() }
  })

  it('has no legacy session or standing stream endpoint', async () => {
    const handler = createInventoryMcpHandler({ principal, getReadService: () => readService() })
    try {
      for (const method of ['GET', 'DELETE']) {
        const response = await handler.fetch(new Request('https://inventory.test/mcp', { method }))
        expect(response.status).toBe(405)
        expect(response.headers.get('mcp-session-id')).toBeNull()
      }
    } finally { await handler.close() }
  })

  it.each(['auto', 'legacy'])('runs SDK2 %s discovery, listing and calls through the actual gateway and default adapter', async mode => {
    const audit = vi.fn(), authenticate = vi.fn(async () => principal)
    const quota = vi.fn(async () => ({ limit: 60, remaining: 59, resetAt: Date.now() + 60000 }))
    const loadReadService = vi.fn(async () => readService())
    const worker = createIntegrationWorker({ authenticate, quota, audit, loadReadService })
    const env = { INTEGRATIONS_ENABLED: 'true', INTEGRATION_HOSTNAME: 'inventory.test' }
    const requests = [], replies = []
    const client = new Client({ name: 'synthetic-gateway-client', version: '1.0.0' }, { versionNegotiation: { mode } })
    const transport = new StreamableHTTPClientTransport(new URL('https://inventory.test/mcp'), {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        if (request.method === 'POST') requests.push(await request.clone().json())
        const reply = await worker.fetch(request, env)
        replies.push({ status: reply.status, body: await reply.clone().text(), cache: reply.headers.get('cache-control') })
        return reply
      },
    })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools).toHaveLength(6)
      const inventory = dataOf(await client.callTool({ name: 'search_inventory', arguments: { limit: 1 } }))
      expect(inventory.pagination).toMatchObject({ total: 3, returned: 1 })
      expect(dataOf(await client.callTool({ name: 'get_data_health', arguments: {} })).data.visibleVehicleCount).toBe(3)
      expect(dataOf(await client.callTool({ name: 'list_manager_dispositions', arguments: { limit: 1 } })).pagination.total).toBe(1)
      expect(authenticate.mock.calls.length).toBeGreaterThanOrEqual(5)
      expect(quota).toHaveBeenCalledTimes(authenticate.mock.calls.length)
      expect(loadReadService).toHaveBeenCalledTimes(3)
      for (const reply of replies) {
        expect(reply.cache?.split(/,\s*/)).toEqual(expect.arrayContaining(['private', 'no-store']))
        expect(reply.cache).not.toMatch(/public|(?:s-maxage|max-age)\s*=/)
      }
      expect(JSON.stringify(replies)).not.toContain(PRIVATE)
      expect(audit).toHaveBeenCalledWith(env, principal, { operation: 'inventory_list', status: 200, resultCount: 1 })
      expect(audit).toHaveBeenCalledWith(env, principal, { operation: 'manager_dispositions_list', status: 200, resultCount: 1 })
      if (mode === 'auto') {
        expect(requests.some(request => request.method === 'server/discover')).toBe(true)
        expect(replies.some(reply => reply.body.includes('MCP_METHOD_NOT_ALLOWED'))).toBe(false)
      }
    } finally { await client.close() }
  })
})
