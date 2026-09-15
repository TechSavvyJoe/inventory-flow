-- Employee access changes are atomic, attributed and append-only.
CREATE TABLE IF NOT EXISTS cloud_membership_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  previous_json TEXT,
  next_json TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id, request_key)
);
CREATE TRIGGER IF NOT EXISTS cloud_membership_events_no_update
BEFORE UPDATE ON cloud_membership_events BEGIN
  SELECT RAISE(ABORT, 'Membership history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS cloud_membership_events_no_delete
BEFORE DELETE ON cloud_membership_events BEGIN
  SELECT RAISE(ABORT, 'Membership history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS cloud_memberships_last_admin_update
BEFORE UPDATE ON cloud_memberships
WHEN OLD.enabled=1 AND OLD.role='group_manager'
  AND (NEW.enabled<>1 OR NEW.role<>'group_manager')
  AND (SELECT COUNT(*) FROM cloud_memberships WHERE enabled=1 AND role='group_manager')<=1
BEGIN
  SELECT RAISE(ABORT, 'Keep at least one active group manager');
END;
CREATE TRIGGER IF NOT EXISTS cloud_memberships_last_admin_delete
BEFORE DELETE ON cloud_memberships
WHEN OLD.enabled=1 AND OLD.role='group_manager'
  AND (SELECT COUNT(*) FROM cloud_memberships WHERE enabled=1 AND role='group_manager')<=1
BEGIN
  SELECT RAISE(ABORT, 'Keep at least one active group manager');
END;
