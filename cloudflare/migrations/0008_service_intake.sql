-- Preserve first verified arrival independently of rotating daily change events.
-- This is not a manager attestation and never creates a completion date.
CREATE TABLE IF NOT EXISTS vehicle_service_intake (
  vin TEXT PRIMARY KEY,
  first_arrival_date TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
