import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { STORE_NAMES } from '../constants.mjs'
import { IntegrationReadError } from './read-service.mjs'

// Leave space for the JSON-RPC envelope. Text and structuredContent both count.
const MAX_TOOL_RESULT_BYTES = 1024 * 1024 - 4096
const encoder = new TextEncoder()
const shortText = z.string().max(256)
const cursor = z.string().min(1).max(8192)
const store = z.enum(STORE_NAMES)
const amount = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)
const limit = z.number().int().min(1).max(100)
const inventorySchema = z.strictObject({
  q: shortText.optional(), store: store.optional(), make: shortText.optional(), model: shortText.optional(),
  year: z.number().int().min(1886).max(2200).optional(),
  minPrice: amount.optional(), maxPrice: amount.optional(), minMileage: amount.optional(), maxMileage: amount.optional(),
  holdState: z.enum(['primary', 'backup', 'multiple', 'none_observed', 'stale', 'unknown']).optional(),
  sort: z.enum(['vehicleName', 'stockNumber', 'year', 'listedPrice', 'mileage', 'daysListed', 'make', 'model', 'publicStore', 'homeStore']).optional(),
  direction: z.enum(['asc', 'desc']).optional(), limit: limit.optional(), cursor: cursor.optional(),
})
const changesSchema = z.strictObject({
  q: shortText.optional(), store: store.optional(),
  type: z.enum(['new_arrival', 'removed', 'price_change', 'mileage_change', 'website_status_change', 'stock_correction', 'store_transfer']).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(), limit: limit.optional(), cursor: cursor.optional(),
})
const TOOLS = [
  { name: 'search_inventory', operation: 'inventory', scope: 'inventory.read', schema: inventorySchema,
    description: 'Search permitted vehicles in the selected verified release. Returns exact equipment, non-sensitive hold and location facts, freshness, and an opaque pagination cursor. Availability still requires store confirmation.' },
  { name: 'get_vehicle', operation: 'vehicle', scope: 'inventory.read', schema: z.strictObject({ vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i) }),
    description: 'Read one permitted vehicle by its full VIN, including captured equipment and report facts. Private customer notes and authenticated report URLs are excluded.' },
  { name: 'get_inventory_changes', operation: 'changes', scope: 'changes.read', schema: changesSchema,
    description: 'Read validated public inventory changes in the selected release. Date filters filter this release only; they do not retrieve historical snapshots.' },
  { name: 'get_data_health', operation: 'health', scope: 'health.read', schema: z.strictObject({}),
    description: 'Read selected-release completion, source freshness, and permitted inventory counts without raw source or customer data.' },
  { name: 'get_hold_summary', operation: 'holdSummary', scope: 'holds.aggregate.read', schema: z.strictObject({ store: store.optional() }),
    description: 'Read non-sensitive hold totals for permitted publicly listed vehicles by physical store. These are not complete CRM inventory totals or availability determinations.' },
]
const SAFE_ERRORS = {
  INVALID_QUERY: [400, 'The query is invalid. Check the supported filters and limits.'],
  INVALID_CURSOR: [400, 'The page cursor is invalid or the data changed. Start from the first page.'],
  INSUFFICIENT_SCOPE: [403, 'This integration is not permitted to use this tool.'],
  FORBIDDEN: [403, 'This integration is not permitted to read this data.'],
  NOT_FOUND: [404, 'Vehicle not found.'],
  SOURCE_DATA_UNAVAILABLE: [503, 'Verified inventory data is temporarily unavailable.'],
}

function toolResult(value, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
}
function safeFailure(error) {
  const code = error instanceof IntegrationReadError && Object.hasOwn(SAFE_ERRORS, error.code) ? error.code : 'SOURCE_DATA_UNAVAILABLE'
  return { status: SAFE_ERRORS[code][0], result: toolResult({ error: { code, message: SAFE_ERRORS[code][1] } }, true) }
}

/**
 * Protocol adapter only. The caller authenticates every HTTP request and passes
 * a server-derived principal. All data authorization/projection remains in the
 * shared read service; no tool can receive SQL, raw release objects or secrets.
 */
export function createInventoryMcpHandler({ getReadService, principal, onToolResult }) {
  if (typeof getReadService !== 'function' || (onToolResult !== undefined && typeof onToolResult !== 'function')) {
    throw new TypeError('Invalid MCP integration configuration')
  }
  // Capture the grants, never a mutable global principal or client-owned role.
  const scopes = new Set(Array.isArray(principal?.scopes) ? principal.scopes.filter(value => typeof value === 'string') : [])
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'inventory-flow', version: '1.0.0' })
    let readService
    for (const tool of TOOLS) {
      if (!scopes.has(tool.scope)) continue
      server.registerTool(tool.name, {
        description: tool.description, inputSchema: tool.schema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, async (args) => {
        let result, status = 200, resultCount = 0
        try {
          readService ??= Promise.resolve().then(() => getReadService())
          const service = await readService
          const value = await service[tool.operation](tool.operation === 'vehicle' ? args.vin : args)
          if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'data')) throw new Error()
          result = toolResult(value)
          if (encoder.encode(JSON.stringify(result)).byteLength > MAX_TOOL_RESULT_BYTES) {
            status = 413
            result = toolResult({ error: { code: 'RESPONSE_TOO_LARGE', message: 'The result is too large. Use narrower filters or a smaller page size.' } }, true)
          } else resultCount = Array.isArray(value.data) ? value.data.length : value.data ? 1 : 0
        } catch (error) {
          const failure = safeFailure(error)
          status = failure.status
          result = failure.result
        }
        // Audit is awaited and fail-closed: failed audit storage cannot release
        // successful data. Never send exception messages or response bodies.
        try { await onToolResult?.({ operation: tool.operation, status, resultCount }) }
        catch { return toolResult({ error: { code: 'AUDIT_UNAVAILABLE', message: 'The request could not be audited. Try again later.' } }, true) }
        return result
      })
    }
    return server
  }, { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0, keepAliveMs: 0 })
}
