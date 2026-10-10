-- Preserve deployed indexes and history. Overlapping active attempts must
-- be separately reconciled; they deliberately make this migration fail.
CREATE UNIQUE INDEX platform_collector_one_group ON platform_collector_attempts(group_id)
WHERE stage IN ('claimed','captured','publishing','reconciliation_required');
