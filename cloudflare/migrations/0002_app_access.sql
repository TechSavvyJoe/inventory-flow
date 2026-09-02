-- Server-owned app memberships. Access authenticates an email; this table,
-- never browser headers or query parameters, assigns its role and home store.
CREATE TABLE IF NOT EXISTS cloud_memberships (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  role TEXT NOT NULL CHECK (role IN ('sales', 'manager', 'coordinator', 'porter', 'driver', 'group_manager')),
  home_store TEXT NOT NULL CHECK (home_store IN ('Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A per-request snapshot may stage changes synchronously, but its writes only
-- commit if this revision still matches. The NOT NULL constraint makes a stale
-- writer abort the complete D1 batch, including every audit event.
CREATE TABLE IF NOT EXISTS cloud_app_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT OR IGNORE INTO cloud_app_revision (id, revision) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS cloud_app_revision_no_delete
BEFORE DELETE ON cloud_app_revision BEGIN
  SELECT RAISE(ABORT, 'App revision cannot be deleted');
END;

-- Operational history is append-only. Corrections are new events, not edits.
CREATE TRIGGER IF NOT EXISTS transfer_events_no_update
BEFORE UPDATE ON transfer_events BEGIN
  SELECT RAISE(ABORT, 'Transfer history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS transfer_events_no_delete
BEFORE DELETE ON transfer_events BEGIN
  SELECT RAISE(ABORT, 'Transfer history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS attention_events_no_update
BEFORE UPDATE ON attention_events BEGIN
  SELECT RAISE(ABORT, 'Attention history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS attention_events_no_delete
BEFORE DELETE ON attention_events BEGIN
  SELECT RAISE(ABORT, 'Attention history is append-only');
END;
