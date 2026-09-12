-- Audit eviction is per client, so the trimming subquery must be able to reach
-- one client's oldest rows without scanning the whole table on every request.
CREATE INDEX IF NOT EXISTS integration_access_audit_client_time_idx
  ON integration_access_audit(client_id, occurred_at DESC, id DESC);
