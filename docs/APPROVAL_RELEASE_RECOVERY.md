# Approval release: paused recovery version and activation

This procedure covers the first production release of manager-approved holds
(`0017_manual_hold_approval.sql`). It supplements the [deploy checklist](DEPLOY_CHECKLIST.md)
and [controlled migration procedure](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md#d1-migration-ledger-backfill).
It is a plan, not a deployment receipt or authorization. Production migrations,
the paused release, activation and incident recovery each require Joe's explicit
authorization for their named targets in the current session.

## Why the old Worker is not a recovery target

Earlier app Workers permit direct salesperson holds. Returning to them after
approval requests exist can both hide requests and restore an approval bypass.
Retain the old version IDs as evidence, but do not designate them as rollback
targets for this change. Never restore an old database over new employee events.

The application now supports a deployment variable, `EMPLOYEE_WRITES_DISABLED`:

- Absent or the exact string `"false"` preserves normal employee writes.
- `"true"` or any other configured value pauses every employee POST, including
  `/api/v1` aliases and membership administration. No browser header or payload
  can override it.
- A paused POST returns HTTP 503, code `EMPLOYEE_WRITES_DISABLED`, with a clear
  message. Route, authentication, membership, origin and saved-list owner checks
  still run first. The body is not parsed and no action or photo is saved.
- Authorized reads retain existing approval history, saved lists and role
  redaction. Publisher and collector authentication are separate; this flag
  neither enables a collector nor pauses its publication transport.
- `/internal/readiness` still exercises the full read pipeline and reports the
  actual storage capabilities. It adds `employeeWritesEnabled`; `ready` is false
  while employee writes are paused. Receipt reconciliation uses its separate
  release-read pipeline and is unaffected by the employee pause.

The checked-in app configuration initially sets the flag to `"true"`. Merging
it does not pause a running Worker. Deploying this candidate creates the paused
recovery version described below. A later reviewed change to `"false"` is the
activation release, not a routine environment tweak.

## Before any production mutation

1. Complete the standard checks and exact-commit CI. Record both currently
   serving Worker version IDs with `wrangler deployments status --json` using
   each Worker config. Identify the exact commit and commands for approval.
2. Re-read the live schema and migration ledger into a private evidence folder.
   For the independently installed tenant identity schema, use
   `node scripts/verify-d1-schema.mjs --live <schema.json> --ledger <ledger.json> --tenant-identity`.
   This requires the exact table and both immutable triggers from
   `cloudflare/tenant-migrations/0001_tenant_identity.sql`. It does not verify
   the singleton's group ID or its control-plane mapping; verify those through
   the separate authorized tenant setup procedure. Never add this tenant
   filename to the inventory `d1_migrations` ledger.
3. Arrange a maintenance window and verify a concrete containment and forward
   repair plan **before applying migrations**. The old Worker has no employee
   pause flag, and the paired release refuses to deploy while required ledger
   entries are missing. Thus the new flag cannot protect the initial migration
   window. A statement that writes are paused is insufficient: the operator
   must verify the chosen containment against existing authenticated sessions,
   name its operator and restoration steps, and account for in-flight writes.
   If that operational plan is not verified, stop before production mutation.
4. Capture and verify the encrypted backup through the existing controlled-host
   [recovery procedure](RECOVERY_DRILL.md#verify-an-actual-exported-database-without-restoring-production).
   Keep private export contents and keys out of Git, logs and chat. Corroborate
   the backup's revision and release pointer; preserve exact legacy hold rows
   for the before/after comparison. Counts alone do not prove preservation.

## Release A: establish the paused recovery version

After explicit authorization of the migration and paused release:

1. Apply only genuinely missing reviewed files, separately. For a database
   verified through `0015`, the commands are:

   ```sh
   pnpm exec wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --file cloudflare/migrations/0016_collector_publication_receipts.sql
   pnpm exec wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --file cloudflare/migrations/0017_manual_hold_approval.sql
   ```

   Inspect each result before proceeding. `0016` adds one receipt table and two
   immutable triggers; it does not authorize collector activation. `0017`
   rebuilds the hold ledger. Compare all 15 original column values for every
   retained row, including owners, actors, versions and idempotency hashes.
   Verify the five-state constraint, both unique constraints, VIN index and two
   append-only triggers. Keep both schemas and all events on recovery.
2. Re-read the schema, complete the required data review, and record only exact
   verified migration filenames using the controlled ledger procedure. Re-run
   the verifier with `--tenant-identity`; require no missing, partial, modified,
   unexpected or duplicate items. Do not use generic migration apply.
3. Run `pnpm cloud:release` once from the reviewed, clean `origin/main` commit
   with `EMPLOYEE_WRITES_DISABLED: "true"`. It deploys the app then integrations;
   deployment is not atomic. Keep maintenance containment until the actual
   paused app version is serving and independently verified.
4. Re-read serving version IDs and the authenticated health endpoints for both
   hosts. Record this pair as **A** only after verification. Exercise existing
   approval-state reads, saved-list reads and role redaction; verify employee
   POSTs return 503 without changing revisions, events, memberships or photos.
5. Run the protected readiness command in the standard runbook. For A, its
   exit status 1 is expected **only** when the complete response has
   `employeeWritesEnabled: false`, `ready: false` and all four capabilities true:
   `dispositionStorage`, `savedListsStorage`, `manualHoldStorage`, and
   `manualHoldApprovalStorage`. Missing fields, failed authentication,
   decryption errors or any false storage capability fail this gate.
   Publication monitors that require full app readiness will also see this
   maintenance state; do not call their runs fully verified or disable their
   checks to hide it. Coordinate their maintenance handling explicitly.

If A cannot be verified, do not activate writes or use the legacy rollback.
Maintain the authorized containment and repair forward from the compatible
source. A verified compatible recovery version does not yet exist. Any new
production command must remain within the explicit incident authorization.

## Release B: activate employee changes

1. Change the app deployment variable to the exact string `"false"` in a
   separately reviewed commit. Repeat required checks and exact-commit CI.
   Record the verified A pair as the recovery target; do not substitute a
   pre-approval version ID from older deployment history.
2. Obtain authorization for this exact activation release, then run the paired
   `pnpm cloud:release` from its clean merged commit. Confirm both serving IDs.
3. Require the standard readiness command to exit 0 with `ready: true`,
   `employeeWritesEnabled: true` and all four storage capabilities true.
4. Complete the normal post-deploy checks and approved acceptance scenarios:
   salesperson request/cancel and crafted self-approval denial, scoped manager
   approval/rejection, retained requester ownership, stale decision conflicts,
   transport redaction, saved-list reopen/edit and refreshed comparison data.
   Never fabricate test customer actions in production without authorization.

If B fails, use the authorized recovery commands with A's **verified version
IDs** as positional arguments:

```sh
pnpm exec wrangler rollback <verified-A-app-version-id> --config cloudflare/wrangler.jsonc
pnpm exec wrangler rollback <verified-A-integrations-version-id> --config cloudflare/integrations.wrangler.jsonc
```

Then verify the serving IDs, paused readiness and employee-write denial again.
Retain every event and receipt written since A. Record results and the recovery
decision in the deployment log. Restoration to A pauses saving; it does not
remove existing requests or silently downgrade their approval rules.
