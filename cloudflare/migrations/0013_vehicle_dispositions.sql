-- App-owned manager dispositions. A row is the app's own recorded decision;
-- it never changes DealerMail, CDK, the public listing, the imported manager
-- log or physical location, and is never inferred from any of them.
CREATE TABLE IF NOT EXISTS vehicle_disposition_events (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  disposition TEXT NOT NULL CHECK (disposition IN ('keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out')),
  effective_date TEXT,
  destination_store TEXT CHECK (destination_store IS NULL OR destination_store IN ('Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln')),
  note TEXT,
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
CREATE INDEX IF NOT EXISTS vehicle_disposition_events_vin_idx ON vehicle_disposition_events(vin, version DESC);
CREATE TRIGGER IF NOT EXISTS vehicle_disposition_events_no_update
BEFORE UPDATE ON vehicle_disposition_events BEGIN SELECT RAISE(ABORT, 'Disposition history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vehicle_disposition_events_no_delete
BEFORE DELETE ON vehicle_disposition_events BEGIN SELECT RAISE(ABORT, 'Disposition history is append-only'); END;
