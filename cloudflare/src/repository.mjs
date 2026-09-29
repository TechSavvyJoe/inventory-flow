import { SERVICE_EVENT_COLUMNS } from '../../server/service-readiness.mjs'
import { DISPOSITION_EVENT_COLUMNS } from '../../server/vehicle-disposition.mjs'
import { VEHICLE_ISSUE_COLUMNS, VEHICLE_ISSUE_EVENT_COLUMNS } from '../../server/vehicle-issues.mjs'
import { WorkflowError } from '../../server/workflow.mjs'

/**
 * D1 adapter for the platform-neutral, synchronous Inventory Flow service.
 * Each request reads one consistent ledger snapshot, stages its mutations,
 * then commits them atomically with optimistic concurrency protection.
 * Source evidence stays in the encrypted release; only app-owned workflow
 * state and its immutable audit trail are written to D1 here.
 */

const clone = (value) => structuredClone(value)
const json = (value) => JSON.stringify(value ?? null)
const nullable = (value) => value || null
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const TRANSFER_COLUMNS = [
  'id', 'vin', 'stock_at_request', 'vehicle_name_at_request', 'home_store_id',
  'home_store_confirmed', 'requesting_store_id', 'destination_store_id',
  'requested_by', 'requested_at', 'needed_by', 'reason', 'customer_reference',
  'customer_appointment', 'approval_owner', 'approved_by', 'priority', 'status',
  'movement_status', 'deal_status', 'delivery_status', 'current_location_id',
  'current_custodian', 'transport_assignee', 'transport_assignee_user_id', 'next_action', 'next_action_owner',
  'due_at', 'return_required', 'return_due_at', 'last_confirmed_at',
  'location_confidence', 'closed_at', 'created_at', 'updated_at', 'idempotency_key',
]
const TRANSFER_EVENT_COLUMNS = [
  'id', 'transfer_request_id', 'event_type', 'label', 'actor', 'actor_user_id', 'actor_role', 'store_id',
  'from_location_id', 'to_location_id', 'driver_or_porter', 'driver_or_porter_user_id', 'occurred_at',
  'expected_arrival_at', 'confirmed_by', 'note', 'created_at', 'idempotency_key',
]
const ATTENTION_COLUMNS = [
  'attention_key', 'source_type', 'source_id', 'status', 'priority', 'assigned_to',
  'assigned_role', 'follow_up_at', 'resolution_code', 'resolution_note',
  'created_at', 'updated_at', 'last_actor', 'last_actor_role', 'last_store_id',
]
const ATTENTION_EVENT_COLUMNS = [
  'id', 'attention_key', 'event_type', 'label', 'actor', 'actor_role', 'store_id',
  'occurred_at', 'assignee', 'follow_up_at', 'priority', 'resolution_code',
  'note', 'created_at', 'idempotency_key', 'input_hash',
]
const TRANSFER_PATCH_COLUMNS = new Set([
  'approved_by', 'status', 'movement_status', 'deal_status', 'delivery_status',
  'current_location_id', 'current_custodian', 'transport_assignee', 'transport_assignee_user_id', 'next_action',
  'next_action_owner', 'due_at', 'return_due_at', 'last_confirmed_at',
  'location_confidence', 'closed_at', 'updated_at',
])

export class RepositoryConflictError extends Error {
  constructor() {
    super('The shared workflow changed. Reload and retry this action.')
    this.name = 'RepositoryConflictError'
    this.code = 'REPOSITORY_CONFLICT'
    this.status = 409
  }
}

function sourceRow(source, loadedAt) {
  if (!source) return null
  return {
    id: `${source.type}:${source.reportDate}:${source.sha256.slice(0, 20)}`,
    source_type: source.type,
    report_date: source.reportDate,
    extracted_at: nullable(source.extractedAt),
    loaded_at: loadedAt,
    snapshot_path: '',
    content_sha256: source.sha256,
    content_bytes: source.bytes,
    schema_version: source.schemaVersion,
    status: source.status,
    stale_reason: nullable(source.staleReason),
    row_count: source.rowCount,
    metadata: source.metadata ?? {},
    manifest_path: '',
  }
}

/** Preserve the exact database row/payload shapes expected by the service. */
export function datasetFromRelease(release, homeAssignments = [], { loadedAt } = {}) {
  if (!release) {
    return { state: {}, sourceRuns: {}, publicRows: [], crmRows: [], holdRows: [], resourceRows: [], homeAssignments: clone(homeAssignments) }
  }
  // The encrypted archive also retains full raw source snapshots. The service
  // consumes only this normalized projection; cloning those unused archives
  // duplicates several megabytes on every request without adding isolation.
  const evidence = clone({
    vehicles: release.vehicles,
    sourceRuns: release.sourceRuns,
    manifest: release.manifest,
    warnings: release.warnings,
    publicChangeEvents: release.publicChangeEvents,
    releasedHoldHistory: release.releasedHoldHistory ?? [],
    managerDispositionOverlay: release.managerDispositionOverlay,
    completedAt: release.completedAt,
    reportDate: release.reportDate,
  })
  if (!Array.isArray(evidence.vehicles) || !evidence.sourceRuns?.public || !evidence.sourceRuns?.dealerMail) {
    throw new Error('The private release is missing normalized source evidence')
  }
  const sourceRuns = {
    public: sourceRow(evidence.sourceRuns.public, loadedAt || evidence.completedAt || ''),
    dealerMail: sourceRow(evidence.sourceRuns.dealerMail, loadedAt || evidence.completedAt || ''),
    resources: sourceRow(evidence.sourceRuns.resources, loadedAt || evidence.completedAt || ''),
    managerDisposition: sourceRow(evidence.sourceRuns.managerDisposition, loadedAt || evidence.completedAt || ''),
  }
  const state = {
    current_public_source_run_id: sourceRuns.public.id,
    current_dealermail_source_run_id: sourceRuns.dealerMail.id,
    current_resource_source_run_id: sourceRuns.resources?.id || '',
    current_manager_disposition_source_run_id: sourceRuns.managerDisposition?.id || '',
    current_report_date: evidence.reportDate,
    current_manifest_path: '',
    current_manifest_json: json(evidence.manifest),
    current_release_warnings_json: json(evidence.warnings),
    current_public_change_events_json: json(evidence.publicChangeEvents ?? []),
    current_released_hold_history_json: json(evidence.releasedHoldHistory),
    current_public_change_baseline_json: json(evidence.sourceRuns.public.metadata?.changeBaseline ?? null),
    current_manager_disposition_overlay_json: json(evidence.managerDispositionOverlay ?? null),
  }
  const dataset = { state, sourceRuns, publicRows: [], crmRows: [], holdRows: [], resourceRows: [], homeAssignments: clone(homeAssignments) }
  const seen = new Set()
  for (const vehicle of evidence.vehicles) {
    if (!vehicle.vin || seen.has(vehicle.vin)) throw new Error('The private release contains duplicate or missing vehicle identities')
    seen.add(vehicle.vin)
    const { vin, publicRecord, crmRecord, holdRecord, cdkRecord, resourceRecord } = vehicle
    if (publicRecord) dataset.publicRows.push({
      source_run_id: sourceRuns.public.id, vin,
      stock_number: String(publicRecord.stock_number ?? ''),
      physical_store_id: publicRecord.store,
      actual_location_raw: nullable(publicRecord.actual_location),
      listing_url: nullable(publicRecord.listing_url),
      listed_price: publicRecord.listed_price ?? null,
      mileage: publicRecord.mileage ?? null,
      inventory_date: nullable(publicRecord.inventory_date),
      payload: publicRecord,
    })
    if (crmRecord) dataset.crmRows.push({
      source_run_id: sourceRuns.dealerMail.id, vin,
      stock_number: String(crmRecord.stockNumber ?? ''), crm_store_id: crmRecord.storeName,
      hold_state: crmRecord.holdStateFromRowClass || 'unknown',
      payload: crmRecord,
    })
    if (holdRecord) {
      const active = (holdRecord.holdDetailRows ?? []).filter((row) => row?.lifecycleStatus === 'active')
      const primary = active.find((row) => row?.holdPosition === 'primary' || Number(row?.holdOrderNumber) === 1)
      const backups = active.filter((row) => row?.holdPosition === 'backup' || Number(row?.holdOrderNumber) > 1)
      const comments = (holdRecord.comments ?? []).reduce((total, group) => total + (Array.isArray(group?.rows) ? group.rows.length : 0), 0)
      dataset.holdRows.push({
        source_run_id: sourceRuns.dealerMail.id, vin,
        stock_number: String(holdRecord.mainRow?.stockNumber ?? crmRecord?.stockNumber ?? ''),
        crm_store_id: holdRecord.store?.name, active_hold_count: active.length, backup_count: backups.length,
        primary_salesperson: nullable(primary?.salespersonRaw), expected_date: nullable(primary?.expectedDeliveryDateRaw),
        comments_count: comments, alerts_count: (holdRecord.alerts ?? []).length,
        payload: holdRecord,
        cdk: cdkRecord ?? null,
      })
    }
    if (sourceRuns.resources && resourceRecord) dataset.resourceRows.push({
      source_run_id: sourceRuns.resources.id, vin, payload: resourceRecord,
    })
  }
  return dataset
}

function stage(database, sql, params) {
  if (database.closed) throw new Error('This request repository has already committed or failed')
  database.pending.push({ sql, params })
}

function insert(database, table, columns, row) {
  // Table and column names are constants from this module, never user inputs.
  stage(database, `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map((name) => row[name] ?? null))
}

function transferRequestRow(request) {
  return {
    id: request.id || crypto.randomUUID(), vin: request.vin,
    stock_at_request: request.stockAtRequest, vehicle_name_at_request: request.vehicleNameAtRequest,
    home_store_id: request.homeStoreId, home_store_confirmed: request.homeStoreConfirmed ? 1 : 0,
    requesting_store_id: request.requestingStoreId, destination_store_id: request.destinationStoreId,
    requested_by: request.requestedBy, requested_at: request.requestedAt, needed_by: nullable(request.neededBy),
    reason: request.reason, customer_reference: nullable(request.customerReference),
    customer_appointment: request.customerAppointment ? 1 : 0, approval_owner: nullable(request.approvalOwner),
    approved_by: nullable(request.approvedBy), priority: request.priority, status: request.status,
    movement_status: request.movementStatus, deal_status: request.dealStatus, delivery_status: request.deliveryStatus,
    current_location_id: request.currentLocationId, current_custodian: nullable(request.currentCustodian),
    transport_assignee: nullable(request.transportAssignee),
    transport_assignee_user_id: nullable(request.transportAssigneeUserId), next_action: request.nextAction,
    next_action_owner: nullable(request.nextActionOwner), due_at: nullable(request.dueAt),
    return_required: request.returnRequired ? 1 : 0, return_due_at: nullable(request.returnDueAt),
    last_confirmed_at: nullable(request.lastConfirmedAt), location_confidence: request.locationConfidence,
    closed_at: nullable(request.closedAt), created_at: request.createdAt, updated_at: request.updatedAt,
    idempotency_key: nullable(request.idempotencyKey),
  }
}

function transferEventRow(transferId, event) {
  return {
    id: event.id || crypto.randomUUID(), transfer_request_id: transferId,
    event_type: event.eventType, label: event.label, actor: event.actor,
    actor_user_id: nullable(event.actorUserId), actor_role: event.actorRole,
    store_id: nullable(event.storeId), from_location_id: nullable(event.fromLocationId),
    to_location_id: nullable(event.toLocationId), driver_or_porter: nullable(event.driverOrPorter),
    driver_or_porter_user_id: nullable(event.driverOrPorterUserId),
    occurred_at: event.occurredAt, expected_arrival_at: nullable(event.expectedArrivalAt),
    confirmed_by: nullable(event.confirmedBy), note: nullable(event.note),
    created_at: event.createdAt, idempotency_key: nullable(event.idempotencyKey),
  }
}

function attentionRow(workflow) {
  return {
    attention_key: workflow.attentionKey, source_type: workflow.sourceType, source_id: nullable(workflow.sourceId),
    status: workflow.status, priority: workflow.priority, assigned_to: nullable(workflow.assignedTo),
    assigned_role: nullable(workflow.assignedRole), follow_up_at: nullable(workflow.followUpAt),
    resolution_code: nullable(workflow.resolutionCode), resolution_note: nullable(workflow.resolutionNote),
    created_at: workflow.createdAt, updated_at: workflow.updatedAt, last_actor: workflow.lastActor,
    last_actor_role: workflow.lastActorRole, last_store_id: nullable(workflow.lastStoreId),
  }
}

function attentionEventRow(key, event) {
  return {
    id: event.id || crypto.randomUUID(), attention_key: key, event_type: event.eventType,
    label: event.label, actor: event.actor, actor_role: event.actorRole, store_id: nullable(event.storeId),
    occurred_at: event.occurredAt, assignee: nullable(event.assignee), follow_up_at: nullable(event.followUpAt),
    priority: nullable(event.priority), resolution_code: nullable(event.resolutionCode),
    note: nullable(event.note), created_at: event.createdAt, idempotency_key: nullable(event.idempotencyKey), input_hash: nullable(event.inputHash),
  }
}

// Bootstrap builds a view for every visible transfer and each view needs that
// transfer's events, so filtering the whole ledger per transfer is quadratic —
// and this Worker runs under a 1,000 ms CPU cap. The snapshot is per request,
// so one grouping pass is built on first use and kept in step with appends.
function transferEventsById(database) {
  if (!database.transferEventsById) {
    const index = new Map()
    for (const row of database.transferEvents) {
      const existing = index.get(row.transfer_request_id)
      if (existing) existing.push(row)
      else index.set(row.transfer_request_id, [row])
    }
    database.transferEventsById = index
  }
  return database.transferEventsById
}
function recordTransferEvent(database, row) {
  database.transferEvents.push(row)
  const index = database.transferEventsById
  if (!index) return
  const existing = index.get(row.transfer_request_id)
  if (existing) existing.push(row)
  else index.set(row.transfer_request_id, [row])
}

export const d1SnapshotRepository = Object.freeze({
  vehicleIssuesEnabled(database) { return database.vehicleIssuesEnabled === true },
  listVehicleIssueRows(database) { return (database.vehicleIssues ?? []).map(clone) },
  listVehicleIssueEvents(database) { return (database.vehicleIssueEvents ?? []).map(clone) },
  insertVehicleIssue(database, issue, event) {
    if (!database.vehicleIssuesEnabled) throw new WorkflowError('Vehicle issue storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
    insert(database, 'vehicle_issues', VEHICLE_ISSUE_COLUMNS, issue)
    insert(database, 'vehicle_issue_events', VEHICLE_ISSUE_EVENT_COLUMNS, event)
    database.vehicleIssues.push(clone(issue))
    database.vehicleIssueEvents.push(clone(event))
  },
  appendVehicleIssueEvent(database, event) {
    if (!database.vehicleIssuesEnabled) throw new WorkflowError('Vehicle issue storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
    const rows = database.vehicleIssueEvents.filter((row) => row.issue_id === event.issue_id)
    if (rows.at(-1)?.version !== event.version - 1) throw new RepositoryConflictError()
    insert(database, 'vehicle_issue_events', VEHICLE_ISSUE_EVENT_COLUMNS, event)
    database.vehicleIssueEvents.push(clone(event))
  },
  listServiceEvents(database) {
    return [...database.serviceEvents].sort((a, b) => compare(a.vin, b.vin) || a.version - b.version).map(clone)
  },
  insertServiceEvent(database, row) {
    insert(database, 'vehicle_service_events', SERVICE_EVENT_COLUMNS, row)
    database.serviceEvents.push(clone(row))
    return clone(row)
  },
  dispositionsEnabled(database) { return database.dispositionsEnabled === true },
  listDispositionEvents(database) {
    return [...(database.dispositionEvents ?? [])].sort((a, b) => compare(a.vin, b.vin) || a.version - b.version).map(clone)
  },
  insertDispositionEvent(database, row) {
    if (!database.dispositionsEnabled) throw new WorkflowError('Disposition storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
    insert(database, 'vehicle_disposition_events', DISPOSITION_EVENT_COLUMNS, row)
    database.dispositionEvents.push(clone(row))
    return clone(row)
  },
  getCurrentDataset(database) { return database.dataset },
  listTransferRows(database, { vin, status, store } = {}) {
    return database.transfers.filter((row) => (!vin || row.vin === String(vin).toUpperCase()) && (!status || row.status === status) &&
      (!store || [row.home_store_id, row.requesting_store_id, row.destination_store_id, row.current_location_id].includes(store)))
      .sort((a, b) => compare(b.updated_at, a.updated_at) || compare(a.id, b.id)).map(clone)
  },
  getTransferRow(database, id) { return clone(database.transfers.find((row) => row.id === id) ?? null) },
  getTransferEvents(database, id) {
    // Input order is SQLite rowid order and stable sort preserves insertion
    // order when multiple events have exactly the same timestamps.
    return [...(transferEventsById(database).get(id) ?? [])]
      .sort((a, b) => compare(a.occurred_at, b.occurred_at) || compare(a.created_at, b.created_at)).map(clone)
  },
  insertTransferRequest(database, request, initialEvent) {
    const existing = request.idempotencyKey && database.transfers.find((row) => row.idempotency_key === request.idempotencyKey)
    if (existing) return { row: clone(existing), created: false }
    const row = transferRequestRow(request)
    const event = transferEventRow(row.id, initialEvent)
    insert(database, 'transfer_requests', TRANSFER_COLUMNS, row)
    insert(database, 'transfer_events', TRANSFER_EVENT_COLUMNS, event)
    database.transfers.push(row)
    recordTransferEvent(database, event)
    return { row: clone(row), created: true }
  },
  supersedeTransferRequest(database, supersededId, expectedUpdatedAt, supersedeEvent, request, initialEvent) {
    const existing = request.idempotencyKey && database.transfers.find((row) => row.idempotency_key === request.idempotencyKey)
    if (existing) return { row: clone(existing), created: false }
    const current = database.transfers.find((row) => row.id === supersededId)
    const hasDirectOrigin = (transferEventsById(database).get(supersededId) ?? [])
      .some((event) => event.event_type === 'direct_move_recorded')
    if (!current || current.updated_at !== expectedUpdatedAt ||
        ['declined', 'canceled', 'closed'].includes(current.status) ||
        !hasDirectOrigin) {
      throw new RepositoryConflictError()
    }
    const overlap = database.transfers.find((row) => row.vin === request.vin && row.id !== supersededId &&
      !['declined', 'canceled', 'closed'].includes(row.status) &&
      !(row.status === 'returned_home' && row.movement_status === 'returned_home' && row.current_location_id === row.home_store_id))
    if (overlap) throw new RepositoryConflictError()

    const supersedeRow = transferEventRow(supersededId, supersedeEvent)
    insert(database, 'transfer_events', TRANSFER_EVENT_COLUMNS, supersedeRow)
    stage(database, `UPDATE transfer_requests
      SET status = 'canceled', next_action = ?, next_action_owner = NULL, closed_at = ?, updated_at = ?
      WHERE id = ?`, ['Superseded by a newer direct move', supersedeEvent.occurredAt, supersedeEvent.createdAt, supersededId])
    Object.assign(current, {
      status: 'canceled', next_action: 'Superseded by a newer direct move', next_action_owner: null,
      closed_at: supersedeEvent.occurredAt, updated_at: supersedeEvent.createdAt,
    })
    recordTransferEvent(database, supersedeRow)

    const row = transferRequestRow(request)
    const event = transferEventRow(row.id, initialEvent)
    insert(database, 'transfer_requests', TRANSFER_COLUMNS, row)
    insert(database, 'transfer_events', TRANSFER_EVENT_COLUMNS, event)
    database.transfers.push(row)
    recordTransferEvent(database, event)
    return { row: clone(row), created: true }
  },
  appendTransferEvent(database, id, event, requestPatch) {
    const current = database.transfers.find((row) => row.id === id)
    if (!current) return { row: null, created: false }
    if (event.idempotencyKey && (transferEventsById(database).get(id) ?? []).some((row) => row.idempotency_key === event.idempotencyKey)) {
      return { row: clone(current), created: false }
    }
    const row = transferEventRow(id, event)
    insert(database, 'transfer_events', TRANSFER_EVENT_COLUMNS, row)
    const entries = Object.entries(requestPatch).filter(([key]) => TRANSFER_PATCH_COLUMNS.has(key)).map(([key, value]) => [key, value ?? null])
    if (entries.length) stage(database, `UPDATE transfer_requests SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([, value]) => value), id])
    Object.assign(current, Object.fromEntries(entries))
    recordTransferEvent(database, row)
    return { row: clone(current), created: true }
  },
  listAttentionWorkflowRows(database) {
    return [...database.attention].sort((a, b) => compare(b.updated_at, a.updated_at) || compare(a.attention_key, b.attention_key)).map(clone)
  },
  getAttentionWorkflowRow(database, key) { return clone(database.attention.find((row) => row.attention_key === key) ?? null) },
  getAttentionEvents(database, key) {
    // Input order is SQLite rowid order and stable sort preserves insertion
    // order when multiple events have exactly the same timestamps.
    return database.attentionEvents.filter((row) => row.attention_key === key)
      .sort((a, b) => compare(a.occurred_at, b.occurred_at) || compare(a.created_at, b.created_at)).map(clone)
  },
  upsertAttentionWorkflow(database, workflow, event) {
    const existing = database.attention.find((row) => row.attention_key === workflow.attentionKey)
    if (event.idempotencyKey && database.attentionEvents.some((row) => row.attention_key === workflow.attentionKey && row.idempotency_key === event.idempotencyKey)) {
      return { row: clone(existing ?? null), created: false }
    }
    const row = attentionRow(workflow)
    if (existing) row.created_at = existing.created_at
    const updates = ATTENTION_COLUMNS.filter((key) => !['attention_key', 'created_at'].includes(key))
    stage(database, `INSERT INTO attention_work_items (${ATTENTION_COLUMNS.join(', ')}) VALUES (${ATTENTION_COLUMNS.map(() => '?').join(', ')}) ON CONFLICT(attention_key) DO UPDATE SET ${updates.map((key) => `${key} = excluded.${key}`).join(', ')}`, ATTENTION_COLUMNS.map((key) => row[key] ?? null))
    const audit = attentionEventRow(workflow.attentionKey, event)
    insert(database, 'attention_events', ATTENTION_EVENT_COLUMNS, audit)
    if (existing) Object.assign(existing, row)
    else database.attention.push(row)
    database.attentionEvents.push(audit)
    return { row: clone(row), created: true }
  },
})

/** D1 batch executes this read set against a single consistent transaction. */
export async function loadD1Repository(d1, release, options = {}) {
  // Migrations are an operator-owned step. Existing inventory remains readable
  // while a newer feature's table is absent: that feature reads empty and
  // refuses writes (503 MIGRATION_REQUIRED). Never create production schema here.
  const capability = await d1.batch([d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('vehicle_issues', 'vehicle_issue_events', 'vehicle_disposition_events')")])
  if (capability.length !== 1 || capability[0].success === false || !Array.isArray(capability[0].results)) {
    throw new Error('Unable to read workflow storage capabilities')
  }
  const tables = new Set(capability[0].results.map((row) => row?.name))
  const issuesEnabled = tables.has('vehicle_issues') && tables.has('vehicle_issue_events')
  const dispositionsEnabled = tables.has('vehicle_disposition_events')
  // Each read is keyed by name, so an optional table never shifts another's result.
  const reads = [
    ['revision', 'SELECT revision FROM cloud_app_revision WHERE id = 1'],
    ['transfers', 'SELECT * FROM transfer_requests ORDER BY updated_at DESC, id'],
    ['transferEvents', 'SELECT * FROM transfer_events ORDER BY occurred_at, created_at, rowid'],
    ['attention', 'SELECT * FROM attention_work_items ORDER BY updated_at DESC, attention_key'],
    ['attentionEvents', 'SELECT * FROM attention_events ORDER BY occurred_at, created_at, rowid'],
    ['homeAssignments', 'SELECT * FROM home_assignments WHERE effective_to IS NULL ORDER BY effective_from DESC'],
    ['serviceEvents', 'SELECT * FROM vehicle_service_events ORDER BY vin, version'],
    ['serviceIntake', 'SELECT * FROM vehicle_service_intake'],
    ...(issuesEnabled ? [
      ['vehicleIssues', 'SELECT * FROM vehicle_issues ORDER BY created_at DESC, id'],
      ['vehicleIssueEvents', 'SELECT * FROM vehicle_issue_events ORDER BY issue_id, version'],
    ] : []),
    ...(dispositionsEnabled ? [
      ['dispositionEvents', 'SELECT * FROM vehicle_disposition_events ORDER BY vin, version'],
    ] : []),
  ]
  const results = await d1.batch(reads.map(([, sql]) => d1.prepare(sql)))
  if (results.length !== reads.length || results.some((result) => result.success === false || !Array.isArray(result.results))) {
    throw new Error('Unable to read the shared workflow snapshot')
  }
  const rows = Object.fromEntries(reads.map(([key], index) => [key, results[index].results]))
  const revision = rows.revision[0]?.revision
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('The shared workflow revision is not initialized')
  const database = {
    dataset: { ...datasetFromRelease(release, rows.homeAssignments, options), serviceIntake: rows.serviceIntake },
    transfers: rows.transfers, transferEvents: rows.transferEvents,
    attention: rows.attention, attentionEvents: rows.attentionEvents,
    serviceEvents: rows.serviceEvents,
    vehicleIssuesEnabled: issuesEnabled,
    vehicleIssues: rows.vehicleIssues ?? [],
    vehicleIssueEvents: rows.vehicleIssueEvents ?? [],
    dispositionsEnabled,
    dispositionEvents: rows.dispositionEvents ?? [],
    pending: [], closed: false,
  }
  return {
    database,
    repository: d1SnapshotRepository,
    revision,
    async commit(authorization) {
      if (database.closed) throw new Error('This request repository has already committed or failed')
      database.closed = true
      const mutation = database.pending.length > 0
      if (!mutation && !authorization) return { committed: false, revision }
      const conditions = ['revision = ?']
      const params = [revision]
      if (authorization) {
        const { email, context } = authorization
        // Check the exact server-owned identity used to authorize and audit
        // this attempt inside the write transaction, not in a separate read.
        // Membership changes need not bump the ledger revision to be caught.
        conditions.push(`EXISTS (
          SELECT 1 FROM cloud_memberships AS member
          WHERE member.email = ? AND member.user_id = ? AND member.enabled = 1
            AND member.name = ? COLLATE BINARY AND member.role = ? AND member.home_store = ?
            AND (? = 0 OR (SELECT COUNT(*) FROM cloud_memberships AS candidate
              WHERE candidate.enabled = 1 AND candidate.role IN ('porter', 'driver')
                AND candidate.name = member.name COLLATE BINARY) = 1)
        )`)
        params.push(email, context.userId, context.user, context.authenticatedRole, context.authenticatedStore,
          context.allowLegacyTransportAssignmentByName === true ? 1 : 0)
      }
      // A replay with no new rows still checks authorization before returning
      // its protected record, but does not advance the workflow revision.
      const guard = d1.prepare(`UPDATE cloud_app_revision SET revision = CASE WHEN ${conditions.join(' AND ')} THEN revision + ${mutation ? 1 : 0} ELSE NULL END WHERE id = 1`).bind(...params)
      try {
        const writes = await d1.batch([guard, ...database.pending.map(({ sql, params }) => d1.prepare(sql).bind(...params))])
        if (writes.some((result) => result.success === false)) throw new Error('Shared workflow transaction failed')
      } catch (error) {
        // Do not leak the database error, values, or SQL to API clients. A stale
        // revision or changed membership is safe to replay only after the
        // Worker reloads membership and the service authorizes the action again.
        const message = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`
        if (/NOT NULL constraint failed:\s*cloud_app_revision\.revision/i.test(message)) throw new RepositoryConflictError()
        throw new Error('Unable to save the shared workflow transaction')
      }
      return { committed: mutation, revision: revision + (mutation ? 1 : 0) }
    },
  }
}
