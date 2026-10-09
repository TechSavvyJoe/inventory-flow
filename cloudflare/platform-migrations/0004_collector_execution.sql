-- Separate owner control-plane execution ledger. No source rows or credentials.
CREATE TABLE platform_pull_requests_next (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES platform_groups(id),
 connection_id TEXT NOT NULL REFERENCES platform_data_connections(id),
 state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed','cancelled','reconciliation_required')),
 request_kind TEXT NOT NULL CHECK(request_kind IN ('manual','scheduled')),
 requested_by TEXT REFERENCES platform_owners(id), requested_name TEXT NOT NULL,
 schedule_slot TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((request_kind='manual' AND requested_by IS NOT NULL AND schedule_slot='') OR (request_kind='scheduled' AND requested_by IS NULL AND schedule_slot<>''))
);
INSERT INTO platform_pull_requests_next SELECT * FROM platform_pull_requests;
DROP TABLE platform_pull_requests;
ALTER TABLE platform_pull_requests_next RENAME TO platform_pull_requests;
CREATE UNIQUE INDEX platform_pull_one_queued ON platform_pull_requests(connection_id) WHERE state IN ('queued','running','reconciliation_required');
CREATE UNIQUE INDEX platform_pull_one_slot ON platform_pull_requests(connection_id,schedule_slot) WHERE request_kind='scheduled';
CREATE INDEX platform_pull_group_recent ON platform_pull_requests(group_id,created_at DESC,id DESC);
CREATE TABLE platform_collectors (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES platform_groups(id), access_client_id TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, adapter_id TEXT NOT NULL CHECK(adapter_id='dealermail-hold-refresh'), adapter_version TEXT NOT NULL CHECK(adapter_version='1'),
 profile_id TEXT NOT NULL, profile_sha256 TEXT NOT NULL CHECK(length(profile_sha256)=64), scope_sha256 TEXT NOT NULL CHECK(length(scope_sha256)=64),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), generation INTEGER NOT NULL CHECK(generation>=1),
 revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT
);
CREATE TABLE platform_collector_grants (
 collector_id TEXT NOT NULL REFERENCES platform_collectors(id), connection_id TEXT NOT NULL REFERENCES platform_data_connections(id),
 dealership_id TEXT NOT NULL REFERENCES platform_dealerships(id), group_id TEXT NOT NULL REFERENCES platform_groups(id),
 PRIMARY KEY(collector_id,connection_id), UNIQUE(collector_id,dealership_id)
);
CREATE TRIGGER platform_collector_grant_scope BEFORE INSERT ON platform_collector_grants
WHEN NOT EXISTS(SELECT 1 FROM platform_collectors h JOIN platform_data_connections c ON c.id=NEW.connection_id JOIN platform_dealerships d ON d.id=NEW.dealership_id WHERE h.id=NEW.collector_id AND h.group_id=NEW.group_id AND c.group_id=NEW.group_id AND c.dealership_id=d.id AND d.group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'Collector grant scope mismatch'); END;
CREATE TRIGGER platform_collector_immutable BEFORE UPDATE ON platform_collectors
WHEN OLD.group_id<>NEW.group_id OR OLD.access_client_id<>NEW.access_client_id OR OLD.adapter_id<>NEW.adapter_id OR OLD.profile_id<>NEW.profile_id OR OLD.profile_sha256<>NEW.profile_sha256 OR OLD.scope_sha256<>NEW.scope_sha256
BEGIN SELECT RAISE(ABORT,'Re-enroll a changed collector identity or profile'); END;
CREATE TABLE platform_collector_attempts (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES platform_pull_requests(id), collector_id TEXT NOT NULL REFERENCES platform_collectors(id),
 group_id TEXT NOT NULL REFERENCES platform_groups(id), profile_id TEXT NOT NULL, grant_generation INTEGER NOT NULL, fence INTEGER NOT NULL CHECK(fence>=1),
 claim_key TEXT NOT NULL, config_json TEXT NOT NULL, config_sha256 TEXT NOT NULL, scope_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL, lease_until TEXT NOT NULL, hard_deadline TEXT NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN ('claimed','captured','publishing','completed','failed','cancelled','expired','reconciliation_required')),
 captured_at TEXT, source_sha256 TEXT, capture_counts_json TEXT, expected_bundle_sha256 TEXT, report_date TEXT NOT NULL, failure_code TEXT, completed_at TEXT,
 UNIQUE(collector_id,claim_key), UNIQUE(request_id,fence)
);
CREATE UNIQUE INDEX platform_collector_one_profile ON platform_collector_attempts(group_id,profile_id) WHERE stage IN ('claimed','captured','publishing','reconciliation_required');
CREATE INDEX platform_collector_attempt_recent ON platform_collector_attempts(group_id,created_at DESC,id DESC);
CREATE TABLE platform_collector_receipts (
 attempt_id TEXT NOT NULL REFERENCES platform_collector_attempts(id), sequence INTEGER NOT NULL CHECK(sequence>=1),
 kind TEXT NOT NULL CHECK(kind IN ('capture','failure','publication')), payload_sha256 TEXT NOT NULL,
 sanitized_json TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(attempt_id,sequence)
);
CREATE TRIGGER platform_collector_receipt_no_update BEFORE UPDATE ON platform_collector_receipts BEGIN SELECT RAISE(ABORT,'Collector receipts are append-only'); END;
CREATE TRIGGER platform_collector_receipt_no_delete BEFORE DELETE ON platform_collector_receipts BEGIN SELECT RAISE(ABORT,'Collector receipts are append-only'); END;
