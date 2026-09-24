// @vitest-environment node
// @ts-nocheck -- exercises the local stdio bridge adapter with synthetic remote MCP tools.
import { describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { createPerplexityInventoryMcpServer, createPerplexityInventoryRestMcpServer } from '../../scripts/perplexity-inventory-mcp.mjs'

describe('Perplexity local Inventory Flow MCP bridge', () => {
  it('exposes read-only local tools backed by the REST integration client', async () => {
    const inventoryClient = {
      inventory: vi.fn(async args => ({ data: [{ stockNumber: 'H12345' }], pagination: { total: 1, returned: 1, nextCursor: null }, args })),
      vehicle: vi.fn(async vin => ({ data: { vin, stockNumber: 'H12345' } })),
      changes: vi.fn(async args => ({ data: [], pagination: { total: 0, returned: 0, nextCursor: null }, args })),
      dataHealth: vi.fn(async () => ({ data: { visibleVehicleCount: 226 }, meta: { reportDate: '2026-09-15' } })),
      holdSummary: vi.fn(async args => ({ data: [], meta: {}, args })),
      managerDispositions: vi.fn(async args => ({ data: [], pagination: { total: 0, returned: 0, nextCursor: null }, args })),
      capabilities: vi.fn(async () => ({ scopes: ['inventory.read'], stores: ['Howell'] })),
    }
    const server = createPerplexityInventoryRestMcpServer({ inventoryClient })
    const handler = createMcpHandler(() => server, { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0 })
    const client = new Client({ name: 'perplexity-rest-bridge-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
    const transport = new StreamableHTTPClientTransport(new URL('https://local.inventory.test/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    })
    try {
      await client.connect(transport)
      const listing = await client.listTools()
      expect(listing.tools.map(tool => tool.name)).toEqual(['search_inventory', 'get_vehicle', 'get_inventory_changes', 'get_data_health', 'get_hold_summary', 'list_manager_dispositions', 'get_inventory_capabilities'])
      expect(listing.tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false)).toBe(true)
      const inventory = await client.callTool({ name: 'search_inventory', arguments: { q: 'f-150', limit: 5 } })
      expect(inventory.structuredContent).toMatchObject({ data: [{ stockNumber: 'H12345' }], args: { q: 'f-150', limit: 5 } })
      expect(inventoryClient.inventory).toHaveBeenCalledWith({ q: 'f-150', limit: 5 })
      const vehicle = await client.callTool({ name: 'get_vehicle', arguments: { vin: '1FTFW1E50NFA00001' } })
      expect(vehicle.structuredContent.data.vin).toBe('1FTFW1E50NFA00001')
    } finally {
      await client.close()
      await handler.close()
    }
  })

  it('mirrors remote tool schemas and forwards calls to the hosted MCP client', async () => {
    const remoteClient = {
      listTools: vi.fn(async () => ({
        tools: [{
          name: 'search_inventory',
          description: 'Search permitted inventory.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { q: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
          },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        }],
      })),
      callTool: vi.fn(async ({ name, arguments: args }) => ({
        content: [{ type: 'text', text: JSON.stringify({ data: [{ stockNumber: 'H12345' }], name, args }) }],
        structuredContent: { data: [{ stockNumber: 'H12345' }], name, args },
      })),
    }
    const server = await createPerplexityInventoryMcpServer({ remoteClient })
    const handler = createMcpHandler(() => server, { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0 })
    const client = new Client({ name: 'perplexity-bridge-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
    const transport = new StreamableHTTPClientTransport(new URL('https://local.inventory.test/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    })
    try {
      await client.connect(transport)
      const listing = await client.listTools()
      expect(listing.tools.map(tool => tool.name)).toEqual(['search_inventory'])
      expect(listing.tools[0].inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(listing.tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
      const result = await client.callTool({ name: 'search_inventory', arguments: { q: 'f-150', limit: 5 } })
      expect(result.structuredContent).toMatchObject({ data: [{ stockNumber: 'H12345' }], name: 'search_inventory', args: { q: 'f-150', limit: 5 } })
      expect(remoteClient.callTool).toHaveBeenCalledWith({ name: 'search_inventory', arguments: { q: 'f-150', limit: 5 } })
    } finally {
      await client.close()
      await handler.close()
    }
  })
})

describe('bridge credential file configuration', () => {
  it('reads the token from the credential file that the integration client command writes', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createRestInventoryClient } = await import('../../scripts/perplexity-inventory-mcp.mjs')
    const directory = mkdtempSync(join(tmpdir(), 'inventory-flow-credential-'))
    const credentialFile = join(directory, 'claude.json')
    // SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
    writeFileSync(credentialFile, JSON.stringify({ clientId: 'synthetic', label: 'Synthetic', token: 'iflow_synthetic_test_token', scopes: ['inventory.read'], stores: ['Howell'], expiresAt: '2999-01-01T00:00:00.000Z' }))
    expect(typeof createRestInventoryClient({ INVENTORY_FLOW_MCP_CREDENTIAL_FILE: credentialFile }).inventory).toBe('function')
    // An explicit token still wins over the file.
    expect(typeof createRestInventoryClient({ INVENTORY_FLOW_MCP_TOKEN: 'iflow_explicit', INVENTORY_FLOW_MCP_CREDENTIAL_FILE: join(directory, 'missing.json') }).inventory).toBe('function')
    writeFileSync(credentialFile, JSON.stringify({ token: 'iflow_expired', expiresAt: '2020-01-01T00:00:00.000Z' }))
    expect(() => createRestInventoryClient({ INVENTORY_FLOW_MCP_CREDENTIAL_FILE: credentialFile })).toThrow('INVENTORY_FLOW_MCP_TOKEN_EXPIRED')
    writeFileSync(credentialFile, 'not json')
    expect(() => createRestInventoryClient({ INVENTORY_FLOW_MCP_CREDENTIAL_FILE: credentialFile })).toThrow('INVENTORY_FLOW_MCP_TOKEN_REQUIRED')
    expect(() => createRestInventoryClient({ INVENTORY_FLOW_MCP_CREDENTIAL_FILE: join(directory, 'missing.json') })).toThrow('INVENTORY_FLOW_MCP_TOKEN_REQUIRED')
    expect(() => createRestInventoryClient({})).toThrow('INVENTORY_FLOW_MCP_TOKEN_REQUIRED')
  })
})
