-- Inventory Flow private production schema. This migration is intentionally
-- data-free. Source releases remain encrypted in the private R2 bucket; D1
-- stores release metadata plus the shared operational/audit ledger.

CREATE TABLE IF NOT EXISTS cloud_release_versions (
  release_id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  object_bytes INTEGER NOT NULL,
  public_source_sha256 TEXT NOT NULL,
  dealermail_source_sha256 TEXT NOT NULL,
  public_row_count INTEGER NOT NULL,
  dealermail_row_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'superseded', 'rejected')),
  published_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE (report_date, bundle_sha256)
);

CREATE TABLE IF NOT EXISTS cloud_release_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cloud_release_versions_report_date_idx
  ON cloud_release_versions(report_date DESC, published_at DESC);

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
  actor_role TEXT NOT NULL,
  store_id TEXT,
  from_location_id TEXT,
  to_location_id TEXT,
  driver_or_porter TEXT,
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
