#!/usr/bin/env node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { createInventoryFlowClient, InventoryFlowError } from '../clients/inventory-flow.mjs'

const DEFAULT_REMOTE_MCP_URL = 'https://inventory-data.joegallant.me/mcp'
const DEFAULT_REST_API_URL = 'https://inventory-data.joegallant.me/api/v1/'
const STORE_NAMES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const shortText = z.string().max(256)
const store = z.enum(STORE_NAMES)
const amount = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)
const limit = z.number().int().min(1).max(100)
const cursor = z.string().min(1).max(8192)
const inventorySchema = z.strictObject({
  q: shortText.optional(), store: store.optional(), make: shortText.optional(), model: shortText.optional(),
  year: z.number().int().min(1886).max(2200).optional(),
  minPrice: amount.optional(), maxPrice: amount.optional(), minMileage: amount.optional(), maxMileage: amount.optional(),
  holdState: z.enum(['primary', 'backup', 'multiple', 'none_observed', 'stale', 'unknown']).optional(),
  sort: z.enum(['vehicleName', 'stockNumber', 'year', 'listedPrice', 'mileage', 'daysListed', 'make', 'model', 'publicStore', 'homeStore']).optional(),
  direction: z.enum(['asc', 'desc']).optional(), limit: limit.optional(), cursor: cursor.optional(),
})
const vinSchema = z.strictObject({ vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i) })
const changesSchema = z.strictObject({
  q: shortText.optional(), store: store.optional(),
  type: z.enum(['new_arrival', 'removed', 'price_change', 'mileage_change', 'website_status_change', 'stock_correction', 'store_transfer']).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(), limit: limit.optional(), cursor: cursor.optional(),
})
const managerDispositionSchema = z.strictObject({
  q: shortText.optional(), store: store.optional(), delivered: z.boolean().optional(),
  review: z.boolean().optional(), limit: limit.optional(), cursor: cursor.optional(),
})

function readConfiguration(environment = process.env) {
  const token = environment.INVENTORY_FLOW_MCP_TOKEN || environment.INVENTORY_FLOW_API_KEY
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    throw new Error('INVENTORY_FLOW_MCP_TOKEN_REQUIRED')
  }
  const remoteUrl = environment.INVENTORY_FLOW_MCP_URL || DEFAULT_REMOTE_MCP_URL
  let url
  try {
    url = new URL(remoteUrl)
  } catch {
    throw new Error('INVENTORY_FLOW_MCP_URL_INVALID')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('INVENTORY_FLOW_MCP_URL_INVALID')
  }
  return { token, url }
}

function readRestConfiguration(environment = process.env) {
  const token = environment.INVENTORY_FLOW_MCP_TOKEN || environment.INVENTORY_FLOW_API_KEY
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    throw new Error('INVENTORY_FLOW_MCP_TOKEN_REQUIRED')
  }
  const baseUrl = environment.INVENTORY_FLOW_API_URL || DEFAULT_REST_API_URL
  return { token, baseUrl }
}

function safeError(error) {
  const code = error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : 'INVENTORY_FLOW_MCP_BRIDGE_FAILED'
  return new Error(code)
}

export async function createPerplexityInventoryMcpServer({ remoteClient, serverInfo = { name: 'inventory-flow-perplexity-bridge', version: '1.0.0' } } = {}) {
  if (!remoteClient || typeof remoteClient.listTools !== 'function' || typeof remoteClient.callTool !== 'function') {
    throw new TypeError('REMOTE_MCP_CLIENT_REQUIRED')
  }
  const listing = await remoteClient.listTools()
  if (!Array.isArray(listing?.tools)) throw new Error('REMOTE_MCP_TOOLS_UNAVAILABLE')

  const server = new McpServer(serverInfo)
  for (const tool of listing.tools) {
    if (!tool || typeof tool.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tool.name)) continue
    const schema = tool.inputSchema && typeof tool.inputSchema === 'object'
      ? fromJsonSchema(tool.inputSchema)
      : fromJsonSchema({ type: 'object', properties: {}, additionalProperties: false })
    server.registerTool(tool.name, {
      title: typeof tool.title === 'string' ? tool.title : undefined,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: schema,
      annotations: tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : undefined,
      icons: Array.isArray(tool.icons) ? tool.icons : undefined,
      _meta: tool._meta && typeof tool._meta === 'object' ? tool._meta : undefined,
    }, async (args) => {
      try {
        return await remoteClient.callTool({ name: tool.name, arguments: args ?? {} })
      } catch {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: { code: 'REMOTE_INVENTORY_MCP_UNAVAILABLE' } }) }],
          structuredContent: { error: { code: 'REMOTE_INVENTORY_MCP_UNAVAILABLE' } },
        }
      }
    })
  }
  return server
}

export async function createRemoteInventoryMcpClient(environment = process.env) {
  const { token, url } = readConfiguration(environment)
  const client = new Client({ name: 'inventory-flow-perplexity-local-bridge', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: { token: async () => token },
    onInsufficientScope: 'throw',
  })
  await client.connect(transport)
  return { client, close: () => client.close() }
}

function toolResult(value, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
}

function restFailure(error) {
  const code = error instanceof InventoryFlowError && /^[A-Z0-9_]{3,80}$/.test(error.code) ? error.code : 'INVENTORY_FLOW_API_UNAVAILABLE'
  return toolResult({ error: { code } }, true)
}

export function createPerplexityInventoryRestMcpServer({ inventoryClient, serverInfo = { name: 'inventory-flow-perplexity-bridge', version: '1.0.0' } } = {}) {
  if (!inventoryClient || typeof inventoryClient.inventory !== 'function') throw new TypeError('INVENTORY_FLOW_CLIENT_REQUIRED')
  const server = new McpServer(serverInfo)
  const register = (name, description, inputSchema, run) => {
    server.registerTool(name, {
      description,
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args) => {
      try { return toolResult(await run(args ?? {})) } catch (error) { return restFailure(error) }
    })
  }
  register('search_inventory', 'Search permitted Inventory Flow vehicles in the current verified release.', inventorySchema, args => inventoryClient.inventory(args))
  register('get_vehicle', 'Read one permitted Inventory Flow vehicle by full VIN.', vinSchema, args => inventoryClient.vehicle(args.vin))
  register('get_inventory_changes', 'Read validated public inventory changes in the current verified release.', changesSchema, args => inventoryClient.changes(args))
  register('get_data_health', 'Read selected-release completion, freshness, and visible inventory counts.', z.strictObject({}), () => inventoryClient.dataHealth())
  register('get_hold_summary', 'Read non-sensitive hold totals for permitted publicly listed vehicles.', z.strictObject({ store: store.optional() }), args => inventoryClient.holdSummary(args))
  register('list_manager_dispositions', 'Read redacted manager-supplied sold and delivered operational signals.', managerDispositionSchema, args => inventoryClient.managerDispositions(args))
  register('get_inventory_capabilities', 'Read this integration grant capability summary.', z.strictObject({}), () => inventoryClient.capabilities())
  return server
}

export function createRestInventoryClient(environment = process.env) {
  const { token, baseUrl } = readRestConfiguration(environment)
  return createInventoryFlowClient({ token, baseUrl })
}

export async function main() {
  try {
    const server = createPerplexityInventoryRestMcpServer({ inventoryClient: createRestInventoryClient() })
    const handle = serveStdio(() => server, {
      legacy: 'serve',
      onerror(error) {
        process.stderr.write(`${safeError(error).message}\n`)
      },
    })
    const shutdown = async () => {
      await handle.close().catch(() => {})
    }
    process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
    process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
  } catch (error) {
    process.stderr.write(`${safeError(error).message}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('perplexity-inventory-mcp.mjs')) {
  await main()
}
