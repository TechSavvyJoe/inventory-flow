-- App-owned approval lifecycle only; imported evidence stays read-only.
-- Preserve every existing active/released event, including trusted identities,
-- version and idempotency constraints. Migration execution is transactional.
CREATE TABLE vehicle_manual_hold_events_next (
  id TEXT PRIMARY KEY, vin TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  state TEXT NOT NULL CHECK (state IN ('requested', 'active', 'released', 'rejected', 'cancelled')),
  customer_label TEXT, expected_delivery_date TEXT, note TEXT,
  owner_user_id TEXT NOT NULL, updated_at TEXT NOT NULL, actor TEXT NOT NULL,
  actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL CHECK (actor_role IN ('sales', 'manager', 'group_manager')),
  store_id TEXT NOT NULL, input_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  UNIQUE (vin, version), UNIQUE (vin, idempotency_key)
);
INSERT INTO vehicle_manual_hold_events_next (id, vin, version, state, customer_label, expected_delivery_date, note, owner_user_id, updated_at, actor, actor_user_id, actor_role, store_id, input_hash, idempotency_key)
SELECT id, vin, version, state, customer_label, expected_delivery_date, note, owner_user_id, updated_at, actor, actor_user_id, actor_role, store_id, input_hash, idempotency_key FROM vehicle_manual_hold_events;
DROP TABLE vehicle_manual_hold_events;
ALTER TABLE vehicle_manual_hold_events_next RENAME TO vehicle_manual_hold_events;
CREATE INDEX IF NOT EXISTS vehicle_manual_hold_events_vin_idx ON vehicle_manual_hold_events(vin, version DESC);
CREATE TRIGGER IF NOT EXISTS vehicle_manual_hold_events_no_update
BEFORE UPDATE ON vehicle_manual_hold_events BEGIN SELECT RAISE(ABORT, 'Manual hold history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vehicle_manual_hold_events_no_delete
BEFORE DELETE ON vehicle_manual_hold_events BEGIN SELECT RAISE(ABORT, 'Manual hold history is append-only'); END;
