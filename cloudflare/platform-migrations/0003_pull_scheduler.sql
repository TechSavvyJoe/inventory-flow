-- Separate control plane only. Scheduled requests contain no source data/secrets.
-- Preserve owner-attributed requests while allowing a trusted scheduler actor.
CREATE TABLE platform_pull_requests_next (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES platform_groups(id),
  connection_id TEXT NOT NULL REFERENCES platform_data_connections(id),
  state TEXT NOT NULL CHECK(state IN ('queued','cancelled')),
  request_kind TEXT NOT NULL CHECK(request_kind IN ('manual','scheduled')),
  requested_by TEXT REFERENCES platform_owners(id), requested_name TEXT NOT NULL,
  schedule_slot TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((request_kind='manual' AND requested_by IS NOT NULL AND schedule_slot='')
     OR (request_kind='scheduled' AND requested_by IS NULL AND schedule_slot<>''))
);
INSERT INTO platform_pull_requests_next
 SELECT id,group_id,connection_id,state,'manual',requested_by,requested_name,'',created_at,updated_at
 FROM platform_pull_requests;
DROP TABLE platform_pull_requests;
ALTER TABLE platform_pull_requests_next RENAME TO platform_pull_requests;
CREATE UNIQUE INDEX platform_pull_one_queued ON platform_pull_requests(connection_id) WHERE state='queued';
CREATE UNIQUE INDEX platform_pull_one_slot ON platform_pull_requests(connection_id,schedule_slot) WHERE request_kind='scheduled';
CREATE INDEX platform_pull_group_recent ON platform_pull_requests(group_id,created_at DESC,id DESC);
CREATE TABLE platform_schedule_checks (
  connection_id TEXT PRIMARY KEY REFERENCES platform_data_connections(id),
  checked_at TEXT NOT NULL, last_slot TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('queued','waiting','already_planned','not_due','disabled','invalid','failed'))
);
CREATE INDEX platform_schedule_fairness ON platform_schedule_checks(checked_at,connection_id);
CREATE TABLE platform_scheduler_state (
  id INTEGER PRIMARY KEY CHECK(id=1), checked_at TEXT NOT NULL,
  checked INTEGER NOT NULL, queued INTEGER NOT NULL, waiting INTEGER NOT NULL, failed INTEGER NOT NULL
);
