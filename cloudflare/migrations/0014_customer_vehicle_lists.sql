-- Employee-owned saved VIN references. Vehicle facts remain in the current
-- authorized release projection and are never copied into these tables.
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
