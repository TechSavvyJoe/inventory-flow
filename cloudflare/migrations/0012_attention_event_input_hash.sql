-- Bind attention retries to the complete normalized semantic request.
-- Older audit rows remain immutable and have no recoverable full request.
ALTER TABLE attention_events ADD COLUMN input_hash TEXT;
