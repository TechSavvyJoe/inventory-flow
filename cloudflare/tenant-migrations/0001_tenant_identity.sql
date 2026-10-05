-- Opt-in tenant identity, applied separately to each isolated inventory DB.
-- A trusted operator inserts exactly one group ID before enabling the gate.
CREATE TABLE inventory_tenant_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), group_id TEXT NOT NULL UNIQUE
);
CREATE TRIGGER inventory_tenant_identity_no_update BEFORE UPDATE ON inventory_tenant_identity BEGIN
  SELECT RAISE(ABORT,'Tenant identity is immutable'); END;
CREATE TRIGGER inventory_tenant_identity_no_delete BEFORE DELETE ON inventory_tenant_identity BEGIN
  SELECT RAISE(ABORT,'Tenant identity is immutable'); END;
