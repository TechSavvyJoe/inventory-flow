-- Transport assignment labels remain available for display and history, but
-- authorization binds to the immutable server-owned membership identifier.
ALTER TABLE transfer_requests ADD COLUMN transport_assignee_user_id TEXT;
ALTER TABLE transfer_events ADD COLUMN actor_user_id TEXT;
ALTER TABLE transfer_events ADD COLUMN driver_or_porter_user_id TEXT;

-- Backfill only when an enabled transport member has one unambiguous display
-- name. Duplicate-name and unknown legacy assignments remain NULL and therefore
-- fail closed until a manager reassigns them through the application.
UPDATE transfer_requests
SET transport_assignee_user_id = (
  SELECT member.user_id
  FROM cloud_memberships AS member
  WHERE member.enabled = 1
    AND member.role IN ('porter', 'driver')
    AND member.name = transfer_requests.transport_assignee COLLATE NOCASE
)
WHERE transport_assignee_user_id IS NULL
  AND transport_assignee IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM cloud_memberships AS member
    WHERE member.enabled = 1
      AND member.role IN ('porter', 'driver')
      AND member.name = transfer_requests.transport_assignee COLLATE NOCASE
  ) = 1;

-- Existing event rows remain unchanged and therefore retain NULL principal IDs.
-- New events bind their actor to an immutable ID, while assignment events also
-- record both the canonical assignee display name and immutable assignee ID;
-- the append-only trigger is never disabled.

CREATE INDEX IF NOT EXISTS transfer_requests_transport_assignee_user_idx
  ON transfer_requests(transport_assignee_user_id, movement_status, updated_at DESC);
