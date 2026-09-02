import { STORE_NAMES } from '../../server/constants.mjs'

export const LEDGER_FORMAT = 'inventory-flow-private-ledger-v1'
const MAX_LEDGER_BYTES = 4 * 1024 * 1024
const MAX_LEDGER_ROWS = 10000
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const ATTENTION_STATES = new Set(['open', 'acknowledged', 'in_progress', 'waiting', 'resolved'])
const HASH_STATE_KEY = 'initial_ledger_import_sha256'
const COUNTS_STATE_KEY = 'initial_ledger_import_counts'

// These are schema-owned identifiers, never identifiers received from a caller.
export const LEDGER_COLUMNS = Object.freeze({
  home_assignments: Object.freeze(['id', 'vin', 'home_store_id', 'effective_from', 'effective_to', 'assignment_source', 'assigned_by', 'note', 'created_at']),
  transfer_requests: Object.freeze([
    'id', 'vin', 'stock_at_request', 'vehicle_name_at_request', 'home_store_id', 'home_store_confirmed',
    'requesting_store_id', 'destination_store_id', 'requested_by', 'requested_at', 'needed_by', 'reason',
    'customer_reference', 'customer_appointment', 'approval_owner', 'approved_by', 'priority', 'status',
    'movement_status', 'deal_status', 'delivery_status', 'current_location_id', 'current_custodian',
    'transport_assignee', 'next_action', 'next_action_owner', 'due_at', 'return_required', 'return_due_at',
    'last_confirmed_at', 'location_confidence', 'closed_at', 'created_at', 'updated_at', 'idempotency_key',
  ]),
  transfer_events: Object.freeze([
    'id', 'transfer_request_id', 'event_type', 'label', 'actor', 'actor_role', 'store_id', 'from_location_id',
    'to_location_id', 'driver_or_porter', 'occurred_at', 'expected_arrival_at', 'confirmed_by', 'note',
    'created_at', 'idempotency_key',
  ]),
  attention_work_items: Object.freeze([
    'attention_key', 'source_type', 'source_id', 'status', 'priority', 'assigned_to', 'assigned_role',
    'follow_up_at', 'resolution_code', 'resolution_note', 'created_at', 'updated_at', 'last_actor',
    'last_actor_role', 'last_store_id',
  ]),
  attention_events: Object.freeze([
    'id', 'attention_key', 'event_type', 'label', 'actor', 'actor_role', 'store_id', 'occurred_at',
    'assignee', 'follow_up_at', 'priority', 'resolution_code', 'note', 'created_at', 'idempotency_key',
  ]),
})
export const LEDGER_TABLE_NAMES = Object.freeze(Object.keys(LEDGER_COLUMNS))

const REQUIRED = Object.freeze({
  home_assignments: ['id', 'vin', 'home_store_id', 'effective_from', 'assignment_source', 'assigned_by', 'created_at'],
  transfer_requests: ['id', 'vin', 'stock_at_request', 'vehicle_name_at_request', 'home_store_id', 'home_store_confirmed', 'requesting_store_id', 'destination_store_id', 'requested_by', 'requested_at', 'reason', 'customer_appointment', 'priority', 'status', 'movement_status', 'deal_status', 'delivery_status', 'current_location_id', 'next_action', 'return_required', 'location_confidence', 'created_at', 'updated_at'],
  transfer_events: ['id', 'transfer_request_id', 'event_type', 'label', 'actor', 'actor_role', 'occurred_at', 'created_at'],
  attention_work_items: ['attention_key', 'source_type', 'status', 'priority', 'created_at', 'updated_at', 'last_actor', 'last_actor_role'],
  attention_events: ['id', 'attention_key', 'event_type', 'label', 'actor', 'actor_role', 'occurred_at', 'created_at'],
})
const INTEGER_COLUMNS = new Set(['home_store_confirmed', 'customer_appointment', 'return_required'])
const STORE_COLUMNS = new Set(['home_store_id', 'requesting_store_id', 'destination_store_id', 'store_id', 'last_store_id'])

export class LedgerImportError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'LedgerImportError'
    this.code = code
    this.status = status
  }
}

function reject(condition, message) {
  if (!condition) throw new LedgerImportError('INVALID_LEDGER', message)
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

/** Strictly allowlist the five app-owned tables and preserve every stored value. */
export function validateLedgerBundle(bundle) {
  reject(exactKeys(bundle, ['schemaVersion', 'reportDate', 'tables']), 'Ledger payload shape is invalid')
  reject(bundle.schemaVersion === LEDGER_FORMAT, 'Ledger format is unsupported')
  reject(typeof bundle.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bundle.reportDate) &&
    !Number.isNaN(Date.parse(`${bundle.reportDate}T00:00:00Z`)) &&
    new Date(`${bundle.reportDate}T00:00:00Z`).toISOString().slice(0, 10) === bundle.reportDate, 'Ledger date is invalid')
  reject(exactKeys(bundle.tables, LEDGER_TABLE_NAMES), 'Ledger must contain only the five app-owned tables')
  const tables = {}
  let rowCount = 0
  for (const table of LEDGER_TABLE_NAMES) {
    const columns = LEDGER_COLUMNS[table]
    const rows = bundle.tables[table]
    reject(Array.isArray(rows), 'Ledger table rows must be arrays')
    rowCount += rows.length
    reject(rowCount <= MAX_LEDGER_ROWS, 'Ledger exceeds the single-import row limit')
    const primaryKeys = new Set()
    const idempotencyKeys = new Set()
    tables[table] = rows.map((row) => {
      reject(exactKeys(row, columns), 'Ledger row columns do not match the app-owned schema')
      const normalized = {}
      for (const column of columns) {
        const value = row[column]
        if (INTEGER_COLUMNS.has(column)) reject(value === 0 || value === 1, 'Ledger Boolean flags must be zero or one')
        else reject(value === null || (typeof value === 'string' && value.length <= 32768), 'Ledger column type or length is invalid')
        if (REQUIRED[table].includes(column)) reject(value !== null && value !== '', 'Ledger has a missing required value')
        if (STORE_COLUMNS.has(column) && value !== null) reject(STORE_NAMES.includes(value), 'Ledger contains an unknown store')
        if (column === 'vin') reject(/^[A-HJ-NPR-Z0-9]{17}$/.test(value), 'Ledger contains an invalid vehicle identity')
        normalized[column] = value
      }
      const primaryKey = table === 'attention_work_items' ? row.attention_key : row.id
      reject(!primaryKeys.has(primaryKey), 'Ledger contains a duplicate row identity')
      primaryKeys.add(primaryKey)
      if (row.idempotency_key !== null && row.idempotency_key !== undefined) {
        const scope = table === 'transfer_events' ? row.transfer_request_id : table === 'attention_events' ? row.attention_key : ''
        const key = JSON.stringify([scope, row.idempotency_key])
        reject(!idempotencyKeys.has(key), 'Ledger contains a duplicate action key')
        idempotencyKeys.add(key)
      }
      if (row.priority !== null && row.priority !== undefined) reject(PRIORITIES.has(row.priority), 'Ledger priority is invalid')
      if (table === 'attention_work_items') reject(ATTENTION_STATES.has(row.status), 'Ledger attention status is invalid')
      return normalized
    })
  }
  const transferIds = new Set(tables.transfer_requests.map((row) => row.id))
  const attentionIds = new Set(tables.attention_work_items.map((row) => row.attention_key))
  const transfersWithEvents = new Set()
  const attentionWithEvents = new Set()
  for (const row of tables.transfer_events) {
    reject(transferIds.has(row.transfer_request_id), 'Ledger contains an orphan transfer event')
    transfersWithEvents.add(row.transfer_request_id)
  }
  for (const row of tables.attention_events) {
    reject(attentionIds.has(row.attention_key), 'Ledger contains an orphan attention event')
    attentionWithEvents.add(row.attention_key)
  }
  reject([...transferIds].every((id) => transfersWithEvents.has(id)), 'Ledger transfer audit history is missing')
  reject([...attentionIds].every((id) => attentionWithEvents.has(id)), 'Ledger attention audit history is missing')
  const currentHomes = new Set()
  for (const row of tables.home_assignments) {
    if (row.effective_to !== null) continue
    reject(!currentHomes.has(row.vin), 'Ledger contains conflicting current home assignments')
    currentHomes.add(row.vin)
  }
  const normalized = { schemaVersion: LEDGER_FORMAT, reportDate: bundle.reportDate, tables }
  reject(new TextEncoder().encode(JSON.stringify(normalized)).byteLength <= MAX_LEDGER_BYTES, 'Ledger exceeds the single-import byte limit')
  return normalized
}

export function ledgerCounts(bundle) {
  return Object.fromEntries(LEDGER_TABLE_NAMES.map((table) => [table, bundle.tables[table].length]))
}

async function ledgerHash(bundle) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(bundle)))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function insertionStatements(d1, table, rows) {
  const columns = LEDGER_COLUMNS[table]
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.map((column) => `json_extract(value, '$.${column}')`).join(', ')} FROM json_each(?) ORDER BY CAST(key AS INTEGER)`
  const statements = []
  let chunk = []
  let bytes = 2
  const flush = () => {
    if (chunk.length) statements.push(d1.prepare(sql).bind(JSON.stringify(chunk)))
    chunk = []
    bytes = 2
  }
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1
    if (bytes + size > 512 * 1024) flush()
    chunk.push(row)
    bytes += size
  }
  flush()
  return statements
}

/** One initial atomic import. Existing cloud activity is never overwritten or merged. */
export async function importLedger(input, env) {
  const bundle = validateLedgerBundle(input)
  const hash = await ledgerHash(bundle)
  const counts = ledgerCounts(bundle)
  const d1 = env.INVENTORY_DB
  const readStatements = [
    d1.prepare('SELECT revision FROM cloud_app_revision WHERE id = 1'),
    d1.prepare('SELECT key, value FROM cloud_release_state WHERE key IN (?, ?)').bind(HASH_STATE_KEY, COUNTS_STATE_KEY),
    ...LEDGER_TABLE_NAMES.map((table) => d1.prepare(`SELECT COUNT(*) AS count FROM ${table}`)),
  ]
  const result = await d1.batch(readStatements)
  if (result.length !== readStatements.length || result.some((row) => row.success === false || !Array.isArray(row.results))) {
    throw new LedgerImportError('LEDGER_IMPORT_UNAVAILABLE', 'Unable to verify the destination ledger', 503)
  }
  const state = Object.fromEntries(result[1].results.map((row) => [row.key, row.value]))
  if (state[HASH_STATE_KEY]) {
    if (state[HASH_STATE_KEY] === hash) return { status: 'already_imported', reportDate: bundle.reportDate, counts }
    throw new LedgerImportError('LEDGER_ALREADY_IMPORTED', 'The initial ledger import has already completed; no data was changed', 409)
  }
  if (result.slice(2).some((row) => !Number.isSafeInteger(row.results[0]?.count) || row.results[0].count !== 0)) {
    throw new LedgerImportError('LEDGER_NOT_EMPTY', 'The cloud ledger already contains activity; no data was changed', 409)
  }
  const revision = result[0].results[0]?.revision
  if (!Number.isSafeInteger(revision) || revision < 0) throw new LedgerImportError('LEDGER_IMPORT_UNAVAILABLE', 'The shared ledger revision is unavailable', 503)
  const now = new Date().toISOString()
  const emptyChecks = LEDGER_TABLE_NAMES.map((table) => `NOT EXISTS (SELECT 1 FROM ${table})`).join(' AND ')
  const guard = d1.prepare(`UPDATE cloud_app_revision SET revision = CASE WHEN revision = ? AND ${emptyChecks} AND NOT EXISTS (SELECT 1 FROM cloud_release_state WHERE key = ?) THEN revision + 1 ELSE NULL END WHERE id = 1`).bind(revision, HASH_STATE_KEY)
  const writes = [guard,
    ...LEDGER_TABLE_NAMES.flatMap((table) => insertionStatements(d1, table, bundle.tables[table])),
    d1.prepare('INSERT INTO cloud_release_state (key, value, updated_at) VALUES (?, ?, ?)').bind(HASH_STATE_KEY, hash, now),
    d1.prepare('INSERT INTO cloud_release_state (key, value, updated_at) VALUES (?, ?, ?)').bind(COUNTS_STATE_KEY, JSON.stringify(counts), now),
  ]
  try {
    const written = await d1.batch(writes)
    if (written.length !== writes.length || written.some((row) => row.success === false)) throw new Error('Import transaction failed')
  } catch {
    // Keep SQL, account identifiers, notes, and parameter values out of errors.
    throw new LedgerImportError('LEDGER_IMPORT_CONFLICT', 'The initial ledger import could not commit; reload before retrying', 409)
  }
  return { status: 'imported', reportDate: bundle.reportDate, counts }
}
