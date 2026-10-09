-- Tenant-origin evidence for the optional, fenced collector service binding.
CREATE TABLE collector_publication_receipts (
 attempt_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, collector_id TEXT NOT NULL,
 fence INTEGER NOT NULL, grant_generation INTEGER NOT NULL, config_sha256 TEXT NOT NULL,
 bundle_sha256 TEXT NOT NULL, report_date TEXT NOT NULL, counts_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('published','unchanged')), accepted_at TEXT NOT NULL
);
CREATE TRIGGER collector_publication_receipt_no_update BEFORE UPDATE ON collector_publication_receipts BEGIN SELECT RAISE(ABORT,'Publication receipts are append-only'); END;
CREATE TRIGGER collector_publication_receipt_no_delete BEFORE DELETE ON collector_publication_receipts BEGIN SELECT RAISE(ABORT,'Publication receipts are append-only'); END;
