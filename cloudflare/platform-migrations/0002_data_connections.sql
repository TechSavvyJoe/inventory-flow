-- Owner-managed source configuration only. No secrets or captured vehicle data.
CREATE TABLE platform_data_connections (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES platform_groups(id),
  dealership_id TEXT NOT NULL REFERENCES platform_dealerships(id),
  name TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('public_inventory','dealermail','vauto','autocheck','carfax','crm','equipment','oem','dms','other')),
  vendor TEXT NOT NULL, oem TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('collector','api','file')),
  endpoint TEXT NOT NULL, credential_ref TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  cadence TEXT NOT NULL CHECK(cadence IN ('manual','daily','hourly')),
  local_time TEXT NOT NULL, timezone TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX platform_connections_group ON platform_data_connections(group_id,dealership_id);
CREATE TABLE platform_pull_requests (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES platform_groups(id),
  connection_id TEXT NOT NULL REFERENCES platform_data_connections(id),
  state TEXT NOT NULL CHECK(state IN ('queued','cancelled')),
  requested_by TEXT NOT NULL REFERENCES platform_owners(id), requested_name TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX platform_pull_one_queued ON platform_pull_requests(connection_id) WHERE state='queued';
