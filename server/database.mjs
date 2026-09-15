import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WorkflowError } from './workflow.mjs'
import { SERVICE_EVENT_COLUMNS } from './service-readiness.mjs'
import { serviceIntakeRows } from './service-intake.mjs'

function assertDatabasePath(databasePath, runtimeDir) {
  if (databasePath === ':memory:') return databasePath
  if (!runtimeDir) throw new Error('A runtime directory is required for a file-backed database')
  const resolvedRuntime = path.resolve(runtimeDir)
  const resolvedDatabase = path.resolve(databasePath)
  const relative = path.relative(resolvedRuntime, resolvedDatabase)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Inventory Ops may only write its database inside the app runtime directory')
  }
  mkdirSync(resolvedRuntime, { recursive: true })
  return resolvedDatabase
}

function withTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function sourceRunId(source) {
  return `${source.type}:${source.reportDate}:${source.sha256.slice(0, 20)}`
}

function json(value) {
  return JSON.stringify(value ?? null)
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function openInventoryDatabase({ databasePath = ':memory:', runtimeDir } = {}) {
  const safePath = assertDatabasePath(databasePath, runtimeDir)
  const database = new DatabaseSync(safePath)
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  if (safePath !== ':memory:') database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  migrate(database)
  return database
}

export function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS source_runs (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      report_date TEXT NOT NULL,
      extracted_at TEXT,
      loaded_at TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      content_bytes INTEGER NOT NULL,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('current', 'stale_unverified', 'incomplete')),
      stale_reason TEXT,
      row_count INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      manifest_path TEXT NOT NULL,
      UNIQUE (source_type, report_date, content_sha256)
    );

    CREATE TABLE IF NOT EXISTS public_vehicle_snapshots (
      source_run_id TEXT NOT NULL REFERENCES source_runs(id),
      vin TEXT NOT NULL,
      stock_number TEXT NOT NULL,
      physical_store_id TEXT NOT NULL,
      actual_location_raw TEXT,
      listing_url TEXT,
      listed_price REAL,
      mileage INTEGER,
      inventory_date TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (source_run_id, vin)
    );

    CREATE TABLE IF NOT EXISTS crm_vehicle_snapshots (
      source_run_id TEXT NOT NULL REFERENCES source_runs(id),
      vin TEXT NOT NULL,
      stock_number TEXT NOT NULL,
      crm_store_id TEXT NOT NULL,
      hold_state TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (source_run_id, vin)
    );

    CREATE TABLE IF NOT EXISTS hold_vehicle_snapshots (
      source_run_id TEXT NOT NULL REFERENCES source_runs(id),
      vin TEXT NOT NULL,
      stock_number TEXT NOT NULL,
      crm_store_id TEXT NOT NULL,
      active_hold_count INTEGER NOT NULL,
      backup_count INTEGER NOT NULL,
      primary_salesperson TEXT,
      expected_date TEXT,
      comments_count INTEGER NOT NULL,
      alerts_count INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      cdk_json TEXT,
      PRIMARY KEY (source_run_id, vin)
    );

    CREATE TABLE IF NOT EXISTS vehicle_resource_snapshots (
      source_run_id TEXT NOT NULL REFERENCES source_runs(id),
      vin TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (source_run_id, vin)
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS home_assignments (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      home_store_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      assignment_source TEXT NOT NULL,
      assigned_by TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS home_assignments_one_current
      ON home_assignments(vin) WHERE effective_to IS NULL;

    CREATE TABLE IF NOT EXISTS transfer_requests (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      stock_at_request TEXT NOT NULL,
      vehicle_name_at_request TEXT NOT NULL,
      home_store_id TEXT NOT NULL,
      home_store_confirmed INTEGER NOT NULL DEFAULT 0,
      requesting_store_id TEXT NOT NULL,
      destination_store_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      needed_by TEXT,
      reason TEXT NOT NULL,
      customer_reference TEXT,
      customer_appointment INTEGER NOT NULL DEFAULT 0,
      approval_owner TEXT,
      approved_by TEXT,
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      status TEXT NOT NULL,
      movement_status TEXT NOT NULL,
      deal_status TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      current_location_id TEXT NOT NULL,
      current_custodian TEXT,
      transport_assignee TEXT,
      transport_assignee_user_id TEXT,
      next_action TEXT NOT NULL,
      next_action_owner TEXT,
      due_at TEXT,
      return_required INTEGER NOT NULL,
      return_due_at TEXT,
      last_confirmed_at TEXT,
      location_confidence TEXT NOT NULL,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      idempotency_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS transfer_events (
      id TEXT PRIMARY KEY,
      transfer_request_id TEXT NOT NULL REFERENCES transfer_requests(id),
      event_type TEXT NOT NULL,
      label TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_user_id TEXT,
      actor_role TEXT NOT NULL,
      store_id TEXT,
      from_location_id TEXT,
      to_location_id TEXT,
      driver_or_porter TEXT,
      driver_or_porter_user_id TEXT,
      occurred_at TEXT NOT NULL,
      expected_arrival_at TEXT,
      confirmed_by TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      idempotency_key TEXT,
      UNIQUE (transfer_request_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS attention_work_items (
      attention_key TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'in_progress', 'waiting', 'resolved')),
      priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      assigned_to TEXT,
      assigned_role TEXT,
      follow_up_at TEXT,
      resolution_code TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_actor TEXT NOT NULL,
      last_actor_role TEXT NOT NULL,
      last_store_id TEXT
    );

    CREATE TABLE IF NOT EXISTS attention_events (
      id TEXT PRIMARY KEY,
      attention_key TEXT NOT NULL REFERENCES attention_work_items(attention_key) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      label TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      store_id TEXT,
      occurred_at TEXT NOT NULL,
      assignee TEXT,
      follow_up_at TEXT,
      priority TEXT,
      resolution_code TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      idempotency_key TEXT,
      UNIQUE (attention_key, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS vehicle_service_events (
      id TEXT PRIMARY KEY, vin TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
      status TEXT NOT NULL CHECK (status IN ('unknown', 'needs_service', 'in_service', 'serviced')),
      service_entered_at TEXT, completed_at TEXT, notes TEXT, updated_at TEXT NOT NULL,
      actor TEXT NOT NULL, actor_user_id TEXT,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('manager', 'group_manager')),
      store_id TEXT NOT NULL, input_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      UNIQUE (vin, version), UNIQUE (vin, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS vehicle_service_intake (
      vin TEXT PRIMARY KEY, first_arrival_date TEXT NOT NULL, observed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vehicle_service_events_vin_idx ON vehicle_service_events(vin, version DESC);
    CREATE TRIGGER IF NOT EXISTS vehicle_service_events_no_update
    BEFORE UPDATE ON vehicle_service_events BEGIN SELECT RAISE(ABORT, 'Service history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vehicle_service_events_no_delete
    BEFORE DELETE ON vehicle_service_events BEGIN SELECT RAISE(ABORT, 'Service history is append-only'); END;

    CREATE INDEX IF NOT EXISTS public_snapshot_store_idx
      ON public_vehicle_snapshots(source_run_id, physical_store_id);
    CREATE INDEX IF NOT EXISTS crm_snapshot_store_idx
      ON crm_vehicle_snapshots(source_run_id, crm_store_id);
    CREATE INDEX IF NOT EXISTS hold_snapshot_store_idx
      ON hold_vehicle_snapshots(source_run_id, crm_store_id);
    CREATE INDEX IF NOT EXISTS vehicle_resource_snapshot_vin_idx
      ON vehicle_resource_snapshots(source_run_id, vin);
    CREATE INDEX IF NOT EXISTS transfer_requests_vin_idx
      ON transfer_requests(vin, updated_at DESC);
    CREATE INDEX IF NOT EXISTS transfer_requests_status_idx
      ON transfer_requests(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS transfer_events_request_idx
      ON transfer_events(transfer_request_id, occurred_at, created_at);
    CREATE INDEX IF NOT EXISTS attention_work_items_queue_idx
      ON attention_work_items(status, priority, follow_up_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS attention_events_item_idx
      ON attention_events(attention_key, occurred_at, created_at, id);
  `)

  // Existing local ledgers predate immutable transport principal IDs. Keep the
  // display-name columns for UI/history and add nullable identity columns
  // without rewriting any saved operational records.
  const requestColumns = new Set(database.prepare('PRAGMA table_info(transfer_requests)').all().map((row) => row.name))
  if (!requestColumns.has('transport_assignee_user_id')) {
    database.exec('ALTER TABLE transfer_requests ADD COLUMN transport_assignee_user_id TEXT')
  }
  const eventColumns = new Set(database.prepare('PRAGMA table_info(transfer_events)').all().map((row) => row.name))
  if (!eventColumns.has('actor_user_id')) {
    database.exec('ALTER TABLE transfer_events ADD COLUMN actor_user_id TEXT')
  }
  if (!eventColumns.has('driver_or_porter_user_id')) {
    database.exec('ALTER TABLE transfer_events ADD COLUMN driver_or_porter_user_id TEXT')
  }
}

function setState(database, key, value, updatedAt) {
  database
    .prepare(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .run(key, String(value), updatedAt)
}

export function importRelease(database, release, { loadedAt = new Date().toISOString() } = {}) {
  const publicRun = release.sourceRuns.public
  const dealerRun = release.sourceRuns.dealerMail
  const resourceRun = release.sourceRuns.resources ?? null
  const managerDispositionRun = release.sourceRuns.managerDisposition ?? null
  const publicId = sourceRunId(publicRun)
  const dealerId = sourceRunId(dealerRun)
  const resourceId = resourceRun ? sourceRunId(resourceRun) : null
  const managerDispositionId = managerDispositionRun ? sourceRunId(managerDispositionRun) : null

  return withTransaction(database, () => {
    const intake = database.prepare('INSERT OR IGNORE INTO vehicle_service_intake (vin, first_arrival_date, observed_at) VALUES (?, ?, ?)')
    for (const row of serviceIntakeRows(release, loadedAt)) intake.run(row.vin, row.first_arrival_date, row.observed_at)
    const insertRun = database.prepare(`
      INSERT OR IGNORE INTO source_runs (
        id, source_type, report_date, extracted_at, loaded_at, snapshot_path,
        content_sha256, content_bytes, schema_version, status, stale_reason,
        row_count, metadata_json, manifest_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const [id, source] of [
      [publicId, publicRun],
      [dealerId, dealerRun],
      ...(resourceId && resourceRun ? [[resourceId, resourceRun]] : []),
      ...(managerDispositionId && managerDispositionRun ? [[managerDispositionId, managerDispositionRun]] : []),
    ]) {
      insertRun.run(
        id,
        source.type,
        source.reportDate,
        source.extractedAt || null,
        loadedAt,
        source.snapshotPath,
        source.sha256,
        source.bytes,
        source.schemaVersion,
        source.status,
        source.staleReason || null,
        source.rowCount,
        json(source.metadata),
        release.manifestPath,
      )
    }

    const insertPublic = database.prepare(`
      INSERT OR REPLACE INTO public_vehicle_snapshots (
        source_run_id, vin, stock_number, physical_store_id, actual_location_raw,
        listing_url, listed_price, mileage, inventory_date, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertCrm = database.prepare(`
      INSERT OR REPLACE INTO crm_vehicle_snapshots (
        source_run_id, vin, stock_number, crm_store_id, hold_state, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertHold = database.prepare(`
      INSERT OR REPLACE INTO hold_vehicle_snapshots (
        source_run_id, vin, stock_number, crm_store_id, active_hold_count,
        backup_count, primary_salesperson, expected_date, comments_count,
        alerts_count, payload_json, cdk_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertResource = database.prepare(`
      INSERT OR REPLACE INTO vehicle_resource_snapshots (
        source_run_id, vin, payload_json
      ) VALUES (?, ?, ?)
    `)

    for (const vehicle of release.vehicles) {
      const publicRecord = vehicle.publicRecord
      if (publicRecord) {
        insertPublic.run(
          publicId,
          vehicle.vin,
          String(publicRecord.stock_number ?? ''),
          publicRecord.store,
          publicRecord.actual_location || null,
          publicRecord.listing_url || null,
          publicRecord.listed_price ?? null,
          publicRecord.mileage ?? null,
          publicRecord.inventory_date || null,
          json(publicRecord),
        )
      }

      const crmRecord = vehicle.crmRecord
      if (crmRecord) {
        insertCrm.run(
          dealerId,
          vehicle.vin,
          String(crmRecord.stockNumber ?? ''),
          crmRecord.storeName,
          crmRecord.holdStateFromRowClass || 'unknown',
          json(crmRecord),
        )
      }

      const holdRecord = vehicle.holdRecord
      if (holdRecord) {
        const active = (holdRecord.holdDetailRows ?? []).filter((row) => row?.lifecycleStatus === 'active')
        const primary = active.find((row) => row?.holdPosition === 'primary' || Number(row?.holdOrderNumber) === 1)
        const backups = active.filter((row) => row?.holdPosition === 'backup' || Number(row?.holdOrderNumber) > 1)
        const commentsCount = (holdRecord.comments ?? []).reduce(
          (total, commentGroup) => total + (Array.isArray(commentGroup?.rows) ? commentGroup.rows.length : 0),
          0,
        )
        insertHold.run(
          dealerId,
          vehicle.vin,
          String(holdRecord.mainRow?.stockNumber ?? crmRecord?.stockNumber ?? ''),
          holdRecord.store?.name,
          active.length,
          backups.length,
          primary?.salespersonRaw || null,
          primary?.expectedDeliveryDateRaw || null,
          commentsCount,
          (holdRecord.alerts ?? []).length,
          json(holdRecord),
          vehicle.cdkRecord ? json(vehicle.cdkRecord) : null,
        )
      }

      if (resourceId && vehicle.resourceRecord) {
        insertResource.run(resourceId, vehicle.vin, json(vehicle.resourceRecord))
      }
    }

    setState(database, 'current_public_source_run_id', publicId, loadedAt)
    setState(database, 'current_dealermail_source_run_id', dealerId, loadedAt)
    setState(database, 'current_resource_source_run_id', resourceId || '', loadedAt)
    setState(database, 'current_manager_disposition_source_run_id', managerDispositionId || '', loadedAt)
    setState(database, 'current_report_date', release.reportDate, loadedAt)
    setState(database, 'current_manifest_path', release.manifestPath, loadedAt)
    setState(database, 'current_manifest_json', json(release.manifest), loadedAt)
    setState(database, 'current_release_warnings_json', json(release.warnings), loadedAt)
    setState(database, 'current_public_change_events_json', json(release.publicChangeEvents ?? []), loadedAt)
    setState(database, 'current_released_hold_history_json', json(release.releasedHoldHistory ?? []), loadedAt)
    setState(database, 'current_manager_disposition_overlay_json', json(release.managerDispositionOverlay ?? null), loadedAt)
    setState(
      database,
      'current_public_change_baseline_json',
      json(release.sourceRuns.public?.metadata?.changeBaseline ?? null),
      loadedAt,
    )

    return {
      publicSourceRunId: publicId,
      dealerMailSourceRunId: dealerId,
      resourceSourceRunId: resourceId,
      managerDispositionSourceRunId: managerDispositionId,
    }
  })
}

function stateMap(database) {
  return Object.fromEntries(database.prepare('SELECT key, value FROM app_state').all().map((row) => [row.key, row.value]))
}

export function getCurrentDataset(database) {
  const state = stateMap(database)
  const publicId = state.current_public_source_run_id
  const dealerId = state.current_dealermail_source_run_id
  const resourceId = state.current_resource_source_run_id
  const managerDispositionId = state.current_manager_disposition_source_run_id
  if (!publicId && !dealerId) {
    return {
      state,
      sourceRuns: {},
      publicRows: [],
      crmRows: [],
      holdRows: [],
      resourceRows: [],
      homeAssignments: [],
    }
  }

  const getRun = database.prepare('SELECT * FROM source_runs WHERE id = ?')
  const sourceRuns = {
    public: publicId ? hydrateSourceRun(getRun.get(publicId)) : null,
    dealerMail: dealerId ? hydrateSourceRun(getRun.get(dealerId)) : null,
    resources: resourceId ? hydrateSourceRun(getRun.get(resourceId)) : null,
    managerDisposition: managerDispositionId ? hydrateSourceRun(getRun.get(managerDispositionId)) : null,
  }
  const publicRows = publicId
    ? database.prepare('SELECT * FROM public_vehicle_snapshots WHERE source_run_id = ?').all(publicId).map(hydrateSnapshotRow)
    : []
  const crmRows = dealerId
    ? database.prepare('SELECT * FROM crm_vehicle_snapshots WHERE source_run_id = ?').all(dealerId).map(hydrateSnapshotRow)
    : []
  const holdRows = dealerId
    ? database.prepare('SELECT * FROM hold_vehicle_snapshots WHERE source_run_id = ?').all(dealerId).map(hydrateHoldRow)
    : []
  const resourceRows = resourceId
    ? database.prepare('SELECT * FROM vehicle_resource_snapshots WHERE source_run_id = ?').all(resourceId).map(hydrateSnapshotRow)
    : []
  const homeAssignments = database
    .prepare('SELECT * FROM home_assignments WHERE effective_to IS NULL ORDER BY effective_from DESC')
    .all()

  const serviceIntake = database.prepare('SELECT * FROM vehicle_service_intake').all()
  return { state, sourceRuns, publicRows, crmRows, holdRows, resourceRows, homeAssignments, serviceIntake }
}

function hydrateSourceRun(row) {
  if (!row) return null
  return {
    ...row,
    metadata: parseJson(row.metadata_json, {}),
  }
}

function hydrateSnapshotRow(row) {
  return {
    ...row,
    payload: parseJson(row.payload_json, {}),
  }
}

function hydrateHoldRow(row) {
  return {
    ...hydrateSnapshotRow(row),
    cdk: parseJson(row.cdk_json, null),
  }
}

export function countTransfers(database) {
  return Number(database.prepare('SELECT COUNT(*) AS count FROM transfer_requests').get()?.count ?? 0)
}

export function listTransferRows(database, { vin, status, store } = {}) {
  const clauses = []
  const values = []
  if (vin) {
    clauses.push('vin = ?')
    values.push(String(vin).toUpperCase())
  }
  if (status) {
    clauses.push('status = ?')
    values.push(status)
  }
  if (store) {
    clauses.push('(home_store_id = ? OR requesting_store_id = ? OR destination_store_id = ? OR current_location_id = ?)')
    values.push(store, store, store, store)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return database.prepare(`SELECT * FROM transfer_requests ${where} ORDER BY updated_at DESC, id`).all(...values)
}

export function getTransferRow(database, id) {
  return database.prepare('SELECT * FROM transfer_requests WHERE id = ?').get(id) ?? null
}

export function getTransferEvents(database, transferId) {
  return database
    .prepare('SELECT * FROM transfer_events WHERE transfer_request_id = ? ORDER BY occurred_at, created_at, id')
    .all(transferId)
}

export function insertTransferRequest(database, request, initialEvent) {
  return withTransaction(database, () => {
    if (request.idempotencyKey) {
      const existing = database.prepare('SELECT * FROM transfer_requests WHERE idempotency_key = ?').get(request.idempotencyKey)
      if (existing) return { row: existing, created: false }
    }

    // The service performs this check for a clear error; repeat it under the
    // write transaction so a second local process cannot create an overlap.
    if (request.enforceSingleActive && database.prepare(`
      SELECT id FROM transfer_requests WHERE vin = ? AND status NOT IN ('declined', 'canceled', 'closed')
      AND NOT (status = 'returned_home' AND movement_status = 'returned_home' AND current_location_id = home_store_id)
      LIMIT 1
    `).get(request.vin)) {
      throw new WorkflowError('This vehicle already has an open move request. Review its location and ask your manager before starting another.', {
        status: 409, code: 'ACTIVE_TRANSFER_EXISTS',
      })
    }

    const id = request.id || randomUUID()
    database
      .prepare(`
        INSERT INTO transfer_requests (
          id, vin, stock_at_request, vehicle_name_at_request, home_store_id,
          home_store_confirmed, requesting_store_id, destination_store_id,
          requested_by, requested_at, needed_by, reason, customer_reference,
          customer_appointment, approval_owner, approved_by, priority, status,
          movement_status, deal_status, delivery_status, current_location_id,
          current_custodian, transport_assignee, transport_assignee_user_id, next_action, next_action_owner,
          due_at, return_required, return_due_at, last_confirmed_at,
          location_confidence, closed_at, created_at, updated_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        request.vin,
        request.stockAtRequest,
        request.vehicleNameAtRequest,
        request.homeStoreId,
        request.homeStoreConfirmed ? 1 : 0,
        request.requestingStoreId,
        request.destinationStoreId,
        request.requestedBy,
        request.requestedAt,
        request.neededBy || null,
        request.reason,
        request.customerReference || null,
        request.customerAppointment ? 1 : 0,
        request.approvalOwner || null,
        request.approvedBy || null,
        request.priority,
        request.status,
        request.movementStatus,
        request.dealStatus,
        request.deliveryStatus,
        request.currentLocationId,
        request.currentCustodian || null,
        request.transportAssignee || null,
        request.transportAssigneeUserId || null,
        request.nextAction,
        request.nextActionOwner || null,
        request.dueAt || null,
        request.returnRequired ? 1 : 0,
        request.returnDueAt || null,
        request.lastConfirmedAt || null,
        request.locationConfidence,
        request.closedAt || null,
        request.createdAt,
        request.updatedAt,
        request.idempotencyKey || null,
      )

    insertTransferEventRow(database, id, initialEvent)
    return { row: getTransferRow(database, id), created: true }
  })
}

function insertTransferEventRow(database, transferId, event) {
  database
    .prepare(`
      INSERT INTO transfer_events (
        id, transfer_request_id, event_type, label, actor, actor_user_id, actor_role, store_id,
        from_location_id, to_location_id, driver_or_porter, driver_or_porter_user_id, occurred_at,
        expected_arrival_at, confirmed_by, note, created_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      event.id || randomUUID(),
      transferId,
      event.eventType,
      event.label,
      event.actor,
      event.actorUserId || null,
      event.actorRole,
      event.storeId || null,
      event.fromLocationId || null,
      event.toLocationId || null,
      event.driverOrPorter || null,
      event.driverOrPorterUserId || null,
      event.occurredAt,
      event.expectedArrivalAt || null,
      event.confirmedBy || null,
      event.note || null,
      event.createdAt,
      event.idempotencyKey || null,
    )
}

export function appendTransferEvent(database, transferId, event, requestPatch) {
  return withTransaction(database, () => {
    const current = getTransferRow(database, transferId)
    if (!current) return { row: null, created: false }
    if (event.idempotencyKey) {
      const existing = database
        .prepare('SELECT * FROM transfer_events WHERE transfer_request_id = ? AND idempotency_key = ?')
        .get(transferId, event.idempotencyKey)
      if (existing) return { row: current, created: false }
    }

    insertTransferEventRow(database, transferId, event)
    const allowedColumns = new Set([
      'approved_by',
      'status',
      'movement_status',
      'deal_status',
      'delivery_status',
      'current_location_id',
      'current_custodian',
      'transport_assignee',
      'transport_assignee_user_id',
      'next_action',
      'next_action_owner',
      'due_at',
      'return_due_at',
      'last_confirmed_at',
      'location_confidence',
      'closed_at',
      'updated_at',
    ])
    const entries = Object.entries(requestPatch).filter(([column]) => allowedColumns.has(column))
    if (entries.length) {
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
      database
        .prepare(`UPDATE transfer_requests SET ${assignments} WHERE id = ?`)
        .run(...entries.map(([, value]) => value ?? null), transferId)
    }
    return { row: getTransferRow(database, transferId), created: true }
  })
}

export function listAttentionWorkflowRows(database) {
  return database.prepare('SELECT * FROM attention_work_items ORDER BY updated_at DESC, attention_key').all()
}

export function getAttentionWorkflowRow(database, attentionKey) {
  return database.prepare('SELECT * FROM attention_work_items WHERE attention_key = ?').get(attentionKey) ?? null
}

export function getAttentionEvents(database, attentionKey) {
  return database
    .prepare('SELECT * FROM attention_events WHERE attention_key = ? ORDER BY occurred_at, created_at, rowid')
    .all(attentionKey)
}

export function upsertAttentionWorkflow(database, workflow, event) {
  return withTransaction(database, () => {
    if (event.idempotencyKey) {
      const existing = database
        .prepare('SELECT * FROM attention_events WHERE attention_key = ? AND idempotency_key = ?')
        .get(workflow.attentionKey, event.idempotencyKey)
      if (existing) {
        return { row: getAttentionWorkflowRow(database, workflow.attentionKey), created: false }
      }
    }

    database
      .prepare(`
        INSERT INTO attention_work_items (
          attention_key, source_type, source_id, status, priority, assigned_to,
          assigned_role, follow_up_at, resolution_code, resolution_note,
          created_at, updated_at, last_actor, last_actor_role, last_store_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attention_key) DO UPDATE SET
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          status = excluded.status,
          priority = excluded.priority,
          assigned_to = excluded.assigned_to,
          assigned_role = excluded.assigned_role,
          follow_up_at = excluded.follow_up_at,
          resolution_code = excluded.resolution_code,
          resolution_note = excluded.resolution_note,
          updated_at = excluded.updated_at,
          last_actor = excluded.last_actor,
          last_actor_role = excluded.last_actor_role,
          last_store_id = excluded.last_store_id
      `)
      .run(
        workflow.attentionKey,
        workflow.sourceType,
        workflow.sourceId || null,
        workflow.status,
        workflow.priority,
        workflow.assignedTo || null,
        workflow.assignedRole || null,
        workflow.followUpAt || null,
        workflow.resolutionCode || null,
        workflow.resolutionNote || null,
        workflow.createdAt,
        workflow.updatedAt,
        workflow.lastActor,
        workflow.lastActorRole,
        workflow.lastStoreId || null,
      )

    database
      .prepare(`
        INSERT INTO attention_events (
          id, attention_key, event_type, label, actor, actor_role, store_id,
          occurred_at, assignee, follow_up_at, priority, resolution_code,
          note, created_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id || randomUUID(),
        workflow.attentionKey,
        event.eventType,
        event.label,
        event.actor,
        event.actorRole,
        event.storeId || null,
        event.occurredAt,
        event.assignee || null,
        event.followUpAt || null,
        event.priority || null,
        event.resolutionCode || null,
        event.note || null,
        event.createdAt,
        event.idempotencyKey || null,
      )

    return { row: getAttentionWorkflowRow(database, workflow.attentionKey), created: true }
  })
}

export function listServiceEvents(database) {
  return database.prepare('SELECT * FROM vehicle_service_events ORDER BY vin, version').all()
}

export function insertServiceEvent(database, row) {
  return withTransaction(database, () => {
    const latest = database.prepare('SELECT MAX(version) AS version FROM vehicle_service_events WHERE vin = ?').get(row.vin)
    if ((latest.version ?? 0) + 1 !== row.version) throw new WorkflowError('Another manager updated this vehicle. Reload and try again.', { status: 409, code: 'SERVICE_VERSION_CONFLICT' })
    database.prepare(`INSERT INTO vehicle_service_events (${SERVICE_EVENT_COLUMNS.join(', ')}) VALUES (${SERVICE_EVENT_COLUMNS.map(() => '?').join(', ')})`)
      .run(...SERVICE_EVENT_COLUMNS.map((key) => row[key] ?? null))
    return row
  })
}

export const databaseInternals = Object.freeze({
  parseJson,
  sourceRunId,
  withTransaction,
})
