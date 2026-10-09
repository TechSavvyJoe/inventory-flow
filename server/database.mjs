import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { WorkflowError } from './workflow.mjs'
import { SERVICE_EVENT_COLUMNS } from './service-readiness.mjs'
import { MANUAL_HOLD_COLUMNS, manualHoldApprovalSchema } from './manual-holds.mjs'
import { DISPOSITION_EVENT_COLUMNS } from './vehicle-disposition.mjs'
import { serviceIntakeRows } from './service-intake.mjs'
import { VEHICLE_ISSUE_COLUMNS, VEHICLE_ISSUE_EVENT_COLUMNS } from './vehicle-issues.mjs'

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

    -- App-owned manager dispositions (cloudflare/migrations/0013). Never
    -- inferred from a source, a move event or the imported manager log.
    CREATE TABLE IF NOT EXISTS vehicle_disposition_events (
      id TEXT PRIMARY KEY, vin TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
      disposition TEXT NOT NULL CHECK (disposition IN ('keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other')),
      effective_date TEXT,
      destination_store TEXT CHECK (destination_store IS NULL OR destination_store IN ('Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln')),
      note TEXT, updated_at TEXT NOT NULL, actor TEXT NOT NULL, actor_user_id TEXT,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('manager', 'group_manager')),
      store_id TEXT NOT NULL, input_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      UNIQUE (vin, version), UNIQUE (vin, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS vehicle_disposition_events_vin_idx ON vehicle_disposition_events(vin, version DESC);
    CREATE TRIGGER IF NOT EXISTS vehicle_disposition_events_no_update
    BEFORE UPDATE ON vehicle_disposition_events BEGIN SELECT RAISE(ABORT, 'Disposition history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vehicle_disposition_events_no_delete
    BEFORE DELETE ON vehicle_disposition_events BEGIN SELECT RAISE(ABORT, 'Disposition history is append-only'); END;
    CREATE TABLE IF NOT EXISTS vehicle_manual_hold_events (
      id TEXT PRIMARY KEY, vin TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
      state TEXT NOT NULL CHECK (state IN ('requested', 'active', 'released', 'rejected', 'cancelled')),
      customer_label TEXT, expected_delivery_date TEXT, note TEXT,
      owner_user_id TEXT NOT NULL, updated_at TEXT NOT NULL, actor TEXT NOT NULL,
      actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL CHECK (actor_role IN ('sales', 'manager', 'group_manager')),
      store_id TEXT NOT NULL, input_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      UNIQUE (vin, version), UNIQUE (vin, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS vehicle_manual_hold_events_vin_idx ON vehicle_manual_hold_events(vin, version DESC);
    CREATE TRIGGER IF NOT EXISTS vehicle_manual_hold_events_no_update
    BEFORE UPDATE ON vehicle_manual_hold_events BEGIN SELECT RAISE(ABORT, 'Manual hold history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vehicle_manual_hold_events_no_delete
    BEFORE DELETE ON vehicle_manual_hold_events BEGIN SELECT RAISE(ABORT, 'Manual hold history is append-only'); END;

    -- App-owned operational reports. Listing, holds, service readiness, and
    -- physical custody remain independent. Reporting and history survive releases.
    CREATE TABLE IF NOT EXISTS vehicle_issues (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      stock_number TEXT NOT NULL,
      vehicle_name TEXT NOT NULL,
      home_store_id TEXT NOT NULL,
      report_store_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('cleaning','fuel','mechanical','damage','other')),
      priority TEXT NOT NULL CHECK (priority IN ('normal','urgent')),
      description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
      reporter TEXT NOT NULL,
      reporter_user_id TEXT NOT NULL,
      reporter_role TEXT NOT NULL CHECK (reporter_role IN ('sales','manager','group_manager')),
      created_at TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      UNIQUE (reporter_user_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS vehicle_issue_events (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES vehicle_issues(id),
      version INTEGER NOT NULL CHECK (version > 0),
      event_type TEXT NOT NULL CHECK (event_type IN ('reported','assign','start_work','request_completion','complete','reopen','add_note')),
      status TEXT NOT NULL CHECK (status IN ('open','in_progress','awaiting_review','completed')),
      assignee TEXT,
      note TEXT,
      actor TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('sales','manager','group_manager')),
      store_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      completed_by TEXT,
      photos_json TEXT NOT NULL DEFAULT '[]',
      input_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      UNIQUE (issue_id, version),
      UNIQUE (issue_id, actor_user_id, idempotency_key),
      CHECK (event_type NOT IN ('assign','complete','reopen') OR actor_role IN ('manager','group_manager')),
      CHECK ((status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL AND completed_by IS NULL))
    );
    CREATE INDEX IF NOT EXISTS vehicle_issues_vin_idx ON vehicle_issues(vin, created_at DESC);
    CREATE INDEX IF NOT EXISTS vehicle_issues_store_idx ON vehicle_issues(report_store_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS vehicle_issue_events_issue_idx ON vehicle_issue_events(issue_id, version DESC);
    CREATE TRIGGER IF NOT EXISTS vehicle_issues_no_update BEFORE UPDATE ON vehicle_issues
    BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vehicle_issues_no_delete BEFORE DELETE ON vehicle_issues
    BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vehicle_issue_events_no_update BEFORE UPDATE ON vehicle_issue_events
    BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vehicle_issue_events_no_delete BEFORE DELETE ON vehicle_issue_events
    BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;

    -- Employee-owned saved VIN references. Source vehicle facts are resolved
    -- at read time and are never copied into this app-owned state.
    CREATE TABLE IF NOT EXISTS saved_vehicle_lists (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS saved_vehicle_list_items (
      list_id TEXT NOT NULL REFERENCES saved_vehicle_lists(id) ON DELETE CASCADE,
      vin TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (list_id, vin)
    );
    CREATE TABLE IF NOT EXISTS saved_vehicle_list_actions (
      owner_user_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create','rename','delete','add','remove')),
      list_id TEXT NOT NULL,
      result_revision INTEGER NOT NULL CHECK (result_revision > 0),
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS saved_vehicle_lists_owner_idx
      ON saved_vehicle_lists(owner_user_id, deleted_at, updated_at DESC, id);
    CREATE INDEX IF NOT EXISTS saved_vehicle_list_items_list_idx
      ON saved_vehicle_list_items(list_id, added_at, vin);
    CREATE TRIGGER IF NOT EXISTS saved_vehicle_list_actions_no_update
    BEFORE UPDATE ON saved_vehicle_list_actions BEGIN SELECT RAISE(ABORT, 'Saved-list action history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS saved_vehicle_list_actions_no_delete
    BEFORE DELETE ON saved_vehicle_list_actions BEGIN SELECT RAISE(ABORT, 'Saved-list action history is append-only'); END;

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
  const attentionColumns = new Set(database.prepare('PRAGMA table_info(attention_events)').all().map((row) => row.name))
  if (!attentionColumns.has('input_hash')) database.exec('ALTER TABLE attention_events ADD COLUMN input_hash TEXT')
  const eventColumns = new Set(database.prepare('PRAGMA table_info(transfer_events)').all().map((row) => row.name))
  if (!eventColumns.has('actor_user_id')) {
    database.exec('ALTER TABLE transfer_events ADD COLUMN actor_user_id TEXT')
  }
  if (!eventColumns.has('driver_or_porter_user_id')) {
    database.exec('ALTER TABLE transfer_events ADD COLUMN driver_or_porter_user_id TEXT')
  }
  const dispositionSchema = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'vehicle_disposition_events'").get()?.sql
  if (!dispositionSchema?.includes("'other'")) {
    withTransaction(database, () => database.exec(readFileSync(new URL('../cloudflare/migrations/0015_manual_inventory_controls.sql', import.meta.url), 'utf8')))
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
  // Two events recorded in the same millisecond (a request and its approval
  // in one action) must come back in the order they were appended; the
  // random UUID id is no tiebreak, rowid is.
  return database
    .prepare('SELECT * FROM transfer_events WHERE transfer_request_id = ? ORDER BY occurred_at, created_at, rowid')
    .all(transferId)
}

function insertTransferRequestRows(database, request, initialEvent) {
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

    return insertTransferRequestRows(database, request, initialEvent)
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

export function supersedeTransferRequest(
  database,
  supersededId,
  expectedUpdatedAt,
  supersedeEvent,
  request,
  initialEvent,
) {
  return withTransaction(database, () => {
    if (request.idempotencyKey) {
      const existing = database.prepare('SELECT * FROM transfer_requests WHERE idempotency_key = ?').get(request.idempotencyKey)
      if (existing) return { row: existing, created: false }
    }
    const current = getTransferRow(database, supersededId)
    const directOrigin = database.prepare(`
      SELECT 1 AS found FROM transfer_events
      WHERE transfer_request_id = ? AND event_type = 'direct_move_recorded'
      LIMIT 1
    `).get(supersededId)
    if (!current || current.updated_at !== expectedUpdatedAt ||
        ['declined', 'canceled', 'closed'].includes(current.status) ||
        !directOrigin) {
      throw new WorkflowError('The active direct move changed. Reload and try the reroute again.', {
        status: 409,
        code: 'ACTIVE_TRANSFER_CHANGED',
      })
    }
    insertTransferEventRow(database, supersededId, supersedeEvent)
    database.prepare(`
      UPDATE transfer_requests
      SET status = 'canceled', next_action = ?, next_action_owner = NULL,
          closed_at = ?, updated_at = ?
      WHERE id = ?
    `).run('Superseded by a newer direct move', supersedeEvent.occurredAt, supersedeEvent.createdAt, supersededId)
    const overlap = database.prepare(`
      SELECT id FROM transfer_requests
      WHERE vin = ? AND id <> ? AND status NOT IN ('declined', 'canceled', 'closed')
      AND NOT (status = 'returned_home' AND movement_status = 'returned_home' AND current_location_id = home_store_id)
      LIMIT 1
    `).get(request.vin, supersededId)
    if (overlap) {
      throw new WorkflowError('This vehicle already has another open move request.', {
        status: 409,
        code: 'ACTIVE_TRANSFER_EXISTS',
      })
    }
    return insertTransferRequestRows(database, request, initialEvent)
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
          note, created_at, idempotency_key, input_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        event.inputHash || null,
      )

    return { row: getAttentionWorkflowRow(database, workflow.attentionKey), created: true }
  })
}

export function listServiceEvents(database) {
  return database.prepare('SELECT * FROM vehicle_service_events ORDER BY vin, version').all()
}

export function vehicleIssuesEnabled() { return true }

export function listVehicleIssueRows(database) {
  return database.prepare('SELECT * FROM vehicle_issues ORDER BY created_at DESC, id').all()
}

export function listVehicleIssueEvents(database) {
  return database.prepare('SELECT * FROM vehicle_issue_events ORDER BY issue_id, version').all()
}

function insertVehicleIssueRow(database, table, columns, row) {
  database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((column) => row[column] ?? null))
}

export function insertVehicleIssue(database, issue, event) {
  return withTransaction(database, () => {
    insertVehicleIssueRow(database, 'vehicle_issues', VEHICLE_ISSUE_COLUMNS, issue)
    insertVehicleIssueRow(database, 'vehicle_issue_events', VEHICLE_ISSUE_EVENT_COLUMNS, event)
  })
}

export function appendVehicleIssueEvent(database, event) {
  return withTransaction(database, () => {
    const latest = database.prepare('SELECT MAX(version) AS version FROM vehicle_issue_events WHERE issue_id = ?').get(event.issue_id)
    if (!latest.version || latest.version + 1 !== event.version) {
      throw new WorkflowError('Another employee updated this issue. Reload and try again.', { status: 409, code: 'ISSUE_VERSION_CONFLICT' })
    }
    insertVehicleIssueRow(database, 'vehicle_issue_events', VEHICLE_ISSUE_EVENT_COLUMNS, event)
  })
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

export function dispositionsEnabled() { return true }

export function listDispositionEvents(database) {
  return database.prepare('SELECT * FROM vehicle_disposition_events ORDER BY vin, version').all()
}

export function insertDispositionEvent(database, row) {
  return withTransaction(database, () => {
    const latest = database.prepare('SELECT MAX(version) AS version FROM vehicle_disposition_events WHERE vin = ?').get(row.vin)
    if ((latest.version ?? 0) + 1 !== row.version) {
      throw new WorkflowError('Another manager updated this vehicle’s disposition. Review the latest and save again.', { status: 409, code: 'DISPOSITION_VERSION_CONFLICT' })
    }
    database.prepare(`INSERT INTO vehicle_disposition_events (${DISPOSITION_EVENT_COLUMNS.join(', ')}) VALUES (${DISPOSITION_EVENT_COLUMNS.map(() => '?').join(', ')})`)
      .run(...DISPOSITION_EVENT_COLUMNS.map((key) => row[key] ?? null))
    return row
  })
}

export function savedVehicleListsEnabled() { return true }

function savedListRaw(database, row) {
  return {
    id: row.id,
    label: row.label,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: database.prepare(`
      SELECT vin, added_at FROM saved_vehicle_list_items
      WHERE list_id = ? ORDER BY added_at, vin
    `).all(row.id).map((item) => ({ vin: item.vin, addedAt: item.added_at })),
  }
}

export function listSavedVehicleLists(database, ownerUserId) {
  return database.prepare(`
    SELECT * FROM saved_vehicle_lists
    WHERE owner_user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id
  `).all(ownerUserId).map((row) => savedListRaw(database, row))
}

export function mutateSavedVehicleList(database, mutation) {
  return withTransaction(database, () => {
    const replay = database.prepare(`
      SELECT input_hash, result_json FROM saved_vehicle_list_actions
      WHERE owner_user_id = ? AND idempotency_key = ?
    `).get(mutation.ownerUserId, mutation.idempotencyKey)
    if (replay) {
      if (replay.input_hash !== mutation.inputHash) {
        throw new WorkflowError('This idempotency key was already used for a different saved-list action.', {
          status: 409, code: 'IDEMPOTENCY_CONFLICT',
        })
      }
      return { replayed: true, result: JSON.parse(replay.result_json) }
    }

    let row
    if (mutation.action === 'create') {
      const total = database.prepare('SELECT COUNT(*) AS total FROM saved_vehicle_lists WHERE owner_user_id = ? AND deleted_at IS NULL').get(mutation.ownerUserId).total
      if (total >= 20) throw new WorkflowError('You can save up to 20 vehicle lists.', { status: 409, code: 'SAVED_LIST_LIMIT_REACHED' })
      database.prepare('INSERT INTO saved_vehicle_lists (id,owner_user_id,label,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(mutation.newId, mutation.ownerUserId, mutation.label, 1, mutation.at, mutation.at)
      row = database.prepare('SELECT * FROM saved_vehicle_lists WHERE id = ?').get(mutation.newId)
    } else {
      row = database.prepare('SELECT * FROM saved_vehicle_lists WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL')
        .get(mutation.listId, mutation.ownerUserId)
      if (!row) throw new WorkflowError('Saved list was not found.', { status: 404, code: 'SAVED_LIST_NOT_FOUND' })
      if (row.revision !== mutation.expectedRevision) {
        throw new WorkflowError('This saved list changed. Reload it and try again.', {
          status: 409, code: 'SAVED_LIST_CONFLICT', details: { currentRevision: row.revision },
        })
      }
      let changed = false
      if (mutation.action === 'rename' && row.label !== mutation.label) {
        database.prepare('UPDATE saved_vehicle_lists SET label = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
          .run(mutation.label, mutation.at, row.id)
        changed = true
      } else if (mutation.action === 'delete') {
        database.prepare('UPDATE saved_vehicle_lists SET revision = revision + 1, updated_at = ?, deleted_at = ? WHERE id = ?')
          .run(mutation.at, mutation.at, row.id)
        database.prepare('DELETE FROM saved_vehicle_list_items WHERE list_id = ?').run(row.id)
        changed = true
      } else if (mutation.action === 'add') {
        const exists = database.prepare('SELECT 1 FROM saved_vehicle_list_items WHERE list_id = ? AND vin = ?').get(row.id, mutation.vin)
        if (!exists) {
          const total = database.prepare('SELECT COUNT(*) AS total FROM saved_vehicle_list_items WHERE list_id = ?').get(row.id).total
          if (total >= 200) throw new WorkflowError('A saved list can contain up to 200 vehicles.', { status: 409, code: 'SAVED_LIST_ITEM_LIMIT_REACHED' })
          database.prepare('INSERT INTO saved_vehicle_list_items (list_id,vin,added_at) VALUES (?,?,?)').run(row.id, mutation.vin, mutation.at)
          changed = true
        }
      } else if (mutation.action === 'remove') {
        changed = database.prepare('DELETE FROM saved_vehicle_list_items WHERE list_id = ? AND vin = ?').run(row.id, mutation.vin).changes > 0
      }
      if (changed && !['rename', 'delete'].includes(mutation.action)) {
        database.prepare('UPDATE saved_vehicle_lists SET revision = revision + 1, updated_at = ? WHERE id = ?').run(mutation.at, row.id)
      }
      row = database.prepare('SELECT * FROM saved_vehicle_lists WHERE id = ?').get(row.id)
    }

    const result = mutation.action === 'delete'
      ? { id: row.id, deleted: true, revision: row.revision }
      : savedListRaw(database, row)
    database.prepare(`
      INSERT INTO saved_vehicle_list_actions
        (owner_user_id,idempotency_key,input_hash,action,list_id,result_revision,result_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(mutation.ownerUserId, mutation.idempotencyKey, mutation.inputHash, mutation.action, row.id, row.revision, JSON.stringify(result), mutation.at)
    return { replayed: false, result }
  })
}

export const databaseInternals = Object.freeze({
  parseJson,
  sourceRunId,
  withTransaction,
})

export function manualHoldsEnabled(database) { return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vehicle_manual_hold_events'").get()) }
export function manualHoldApprovalsEnabled(database) { return manualHoldApprovalSchema(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vehicle_manual_hold_events'").get()?.sql) }
export function listManualHoldEvents(database) {
  if (!manualHoldsEnabled(database)) return []
  return database.prepare('SELECT * FROM vehicle_manual_hold_events ORDER BY vin, version').all()
}
export function insertManualHoldEvent(database, row) {
  if (!manualHoldApprovalsEnabled(database)) throw new WorkflowError('Manual hold approvals require migration 0017 before saving.', { status: 503, code: 'MIGRATION_REQUIRED' })
  return withTransaction(database, () => {
    const latest = database.prepare('SELECT MAX(version) AS version FROM vehicle_manual_hold_events WHERE vin = ?').get(row.vin)
    if ((latest.version ?? 0) + 1 !== row.version) throw new WorkflowError('Another employee updated the hold. Review and save again.', { status: 409, code: 'MANUAL_HOLD_VERSION_CONFLICT' })
    database.prepare(`INSERT INTO vehicle_manual_hold_events (${MANUAL_HOLD_COLUMNS.join(', ')}) VALUES (${MANUAL_HOLD_COLUMNS.map(() => '?').join(', ')})`)
      .run(...MANUAL_HOLD_COLUMNS.map(key => row[key] ?? null))
    return row
  })
}
