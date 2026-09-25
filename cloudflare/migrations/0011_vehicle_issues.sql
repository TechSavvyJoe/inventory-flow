-- App-owned operational reports. Listing, holds, service readiness, and
-- physical custody remain independent. Reporting and history survive releases.
CREATE TABLE IF NOT EXISTS vehicle_issues (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  stock_number TEXT NOT NULL,
  vehicle_name TEXT NOT NULL,
  home_store_id TEXT NOT NULL,
  report_store_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('cleaning','fuel','mechanical','damage','other')),
  priority TEXT NOT NULL CHECK (priority IN ('normal','urgent')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  reporter TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reporter_role TEXT NOT NULL CHECK (reporter_role IN ('sales','manager','group_manager')),
  created_at TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (reporter_user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS vehicle_issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES vehicle_issues(id),
  version INTEGER NOT NULL CHECK (version > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('reported','assign','start_work','request_completion','complete','reopen','add_note')),
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','awaiting_review','completed')),
  assignee TEXT,
  note TEXT,
  actor TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('sales','manager','group_manager')),
  store_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  input_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (issue_id, version),
  UNIQUE (issue_id, actor_user_id, idempotency_key),
  CHECK (event_type NOT IN ('assign','complete','reopen') OR actor_role IN ('manager','group_manager')),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL AND completed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS vehicle_issues_vin_idx ON vehicle_issues(vin, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_issues_store_idx ON vehicle_issues(report_store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_issue_events_issue_idx ON vehicle_issue_events(issue_id, version DESC);
CREATE TRIGGER IF NOT EXISTS vehicle_issues_no_update BEFORE UPDATE ON vehicle_issues
BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vehicle_issues_no_delete BEFORE DELETE ON vehicle_issues
BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vehicle_issue_events_no_update BEFORE UPDATE ON vehicle_issue_events
BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vehicle_issue_events_no_delete BEFORE DELETE ON vehicle_issue_events
BEGIN SELECT RAISE(ABORT, 'Vehicle issue history is append-only'); END;
