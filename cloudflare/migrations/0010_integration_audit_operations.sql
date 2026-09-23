-- Widen the metadata-only audit CHECK to every read operation the integration
-- Worker records. The MCP tools added after 0005 (operational inventory search,
-- vehicle resources, daily operations, data quality, reconciliation) failed
-- their audit INSERT against the old list, so those tool calls always answered
-- AUDIT_UNAVAILABLE. Apply as a single file, like 0005; the table rebuild must
-- recreate both audit indexes (0005's time index and 0006's per-client index).
DROP TABLE IF EXISTS integration_access_audit_next;
CREATE TABLE integration_access_audit_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL REFERENCES integration_clients(client_id),
  operation TEXT NOT NULL CHECK (operation IN ('health', 'inventory_list', 'inventory_get', 'operational_inventory_search', 'vehicle_resources_get', 'changes_list', 'daily_operations_get', 'data_quality_get', 'reconciliation_get', 'holds_summary', 'manager_dispositions_list', 'mcp_initialize', 'mcp_tools_list', 'mcp_tools_call', 'mcp_notification', 'other')),
  status INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
  result_count INTEGER NOT NULL CHECK (result_count BETWEEN 0 AND 1000),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0)
);

INSERT INTO integration_access_audit_next (id, client_id, operation, status, result_count, occurred_at)
SELECT id, client_id, operation, status, result_count, occurred_at FROM integration_access_audit;

DROP TABLE integration_access_audit;
ALTER TABLE integration_access_audit_next RENAME TO integration_access_audit;
CREATE INDEX integration_access_audit_time_idx ON integration_access_audit(occurred_at DESC, id DESC);
CREATE INDEX integration_access_audit_client_time_idx
  ON integration_access_audit(client_id, occurred_at DESC, id DESC);
