-- Separate control-plane database. Never apply this to an inventory database.
PRAGMA foreign_keys = ON;
CREATE TABLE platform_owners (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
CREATE TABLE platform_groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('setup','active','suspended')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE platform_dealerships (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES platform_groups(id),
  name TEXT NOT NULL, store_key TEXT NOT NULL, website TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  UNIQUE(group_id,store_key)
);
CREATE TABLE platform_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO platform_revision VALUES(1,0);
CREATE TABLE platform_audit (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  entity TEXT NOT NULL, target_id TEXT NOT NULL, action TEXT NOT NULL,
  reason TEXT NOT NULL, previous_json TEXT, next_json TEXT NOT NULL,
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(actor_id,request_key)
);
CREATE INDEX platform_audit_recent ON platform_audit(created_at DESC,id DESC);
CREATE TRIGGER platform_audit_no_update BEFORE UPDATE ON platform_audit BEGIN
  SELECT RAISE(ABORT,'Platform history is append-only'); END;
CREATE TRIGGER platform_audit_no_delete BEFORE DELETE ON platform_audit BEGIN
  SELECT RAISE(ABORT,'Platform history is append-only'); END;
CREATE TRIGGER platform_revision_no_delete BEFORE DELETE ON platform_revision BEGIN
  SELECT RAISE(ABORT,'Platform revision cannot be deleted'); END;
CREATE TRIGGER platform_owners_last_update BEFORE UPDATE ON platform_owners
WHEN OLD.enabled=1 AND NEW.enabled<>1 AND (SELECT COUNT(*) FROM platform_owners WHERE enabled=1)<=1 BEGIN
  SELECT RAISE(ABORT,'Keep at least one software owner'); END;
CREATE TRIGGER platform_owners_last_delete BEFORE DELETE ON platform_owners
WHEN OLD.enabled=1 AND (SELECT COUNT(*) FROM platform_owners WHERE enabled=1)<=1 BEGIN
  SELECT RAISE(ABORT,'Keep at least one software owner'); END;
