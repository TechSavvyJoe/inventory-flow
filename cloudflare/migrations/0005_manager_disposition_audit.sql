-- Preserve the metadata-only audit contract while adding the redacted manager-log read operation.
CREATE TABLE integration_access_audit_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL REFERENCES integration_clients(client_id),
  operation TEXT NOT NULL CHECK (operation IN ('health', 'inventory_list', 'inventory_get', 'changes_list', 'holds_summary', 'manager_dispositions_list', 'mcp_initialize', 'mcp_tools_list', 'mcp_tools_call', 'mcp_notification', 'other')),
  status INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
  result_count INTEGER NOT NULL CHECK (result_count BETWEEN 0 AND 1000),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0)
);

INSERT INTO integration_access_audit_next (id, client_id, operation, status, result_count, occurred_at)
SELECT id, client_id, operation, status, result_count, occurred_at FROM integration_access_audit;

DROP TABLE integration_access_audit;
ALTER TABLE integration_access_audit_next RENAME TO integration_access_audit;
CREATE INDEX integration_access_audit_time_idx ON integration_access_audit(occurred_at DESC, id DESC);
