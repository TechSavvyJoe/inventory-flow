-- Read-only, server-owned integration grants. No credentials or grants are seeded.
-- API secrets are random bearer credentials; only their full-token SHA-256 is stored.
CREATE TABLE IF NOT EXISTS integration_clients (
  client_id TEXT PRIMARY KEY CHECK (length(client_id) = 32 AND client_id NOT GLOB '*[^a-f0-9]*'),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  auth_type TEXT NOT NULL CHECK (auth_type IN ('api_token', 'access_oauth')),
  owner_user_id TEXT NOT NULL REFERENCES cloud_memberships(user_id),
  token_sha256 TEXT UNIQUE,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json) AND json_type(scopes_json) = 'array'),
  stores_json TEXT NOT NULL CHECK (json_valid(stores_json) AND json_type(stores_json) = 'array'),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((auth_type = 'api_token' AND token_sha256 IS NOT NULL AND length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^a-f0-9]*') OR (auth_type = 'access_oauth' AND token_sha256 IS NULL))
);

-- Managed OAuth identifies the employee, not a documented OAuth client ID.
-- One non-revoked grant per employee prevents pretending these are per-AI-client
-- permissions. Revoked history stays intact when a replacement grant is issued.
CREATE UNIQUE INDEX IF NOT EXISTS integration_oauth_owner_idx
  ON integration_clients(owner_user_id) WHERE auth_type = 'access_oauth' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS integration_clients_owner_idx ON integration_clients(owner_user_id);

-- One atomic fixed-window counter per grant, not one ever-growing row per request.
CREATE TABLE IF NOT EXISTS integration_rate_windows (
  client_id TEXT PRIMARY KEY REFERENCES integration_clients(client_id),
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  request_count INTEGER NOT NULL CHECK (request_count >= 1)
);

-- Metadata only: never query strings, prompts, VINs, payloads, names, or tokens.
CREATE TABLE IF NOT EXISTS integration_access_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL REFERENCES integration_clients(client_id),
  operation TEXT NOT NULL CHECK (operation IN ('health', 'inventory_list', 'inventory_get', 'changes_list', 'holds_summary', 'manager_dispositions_list', 'mcp_initialize', 'mcp_tools_list', 'mcp_tools_call', 'mcp_notification', 'other')),
  status INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
  result_count INTEGER NOT NULL CHECK (result_count BETWEEN 0 AND 1000),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0)
);
CREATE INDEX IF NOT EXISTS integration_access_audit_time_idx ON integration_access_audit(occurred_at DESC, id DESC);
