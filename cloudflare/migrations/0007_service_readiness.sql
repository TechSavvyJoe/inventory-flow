-- App-owned manager attestations. A missing row has no manager attestation;
-- readiness is resolved separately from durable intake or the existing-inventory baseline.
CREATE TABLE IF NOT EXISTS vehicle_service_events (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('unknown', 'needs_service', 'in_service', 'serviced')),
  service_entered_at TEXT,
  completed_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_user_id TEXT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('manager', 'group_manager')),
  store_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (vin, version),
  UNIQUE (vin, idempotency_key)
);
CREATE INDEX IF NOT EXISTS vehicle_service_events_vin_idx ON vehicle_service_events(vin, version DESC);
CREATE TRIGGER IF NOT EXISTS vehicle_service_events_no_update
BEFORE UPDATE ON vehicle_service_events BEGIN
  SELECT RAISE(ABORT, 'Service history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS vehicle_service_events_no_delete
BEFORE DELETE ON vehicle_service_events BEGIN
  SELECT RAISE(ABORT, 'Service history is append-only');
END;
