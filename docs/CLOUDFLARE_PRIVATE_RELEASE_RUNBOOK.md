# Private Cloudflare application runbook

## Deployed architecture

The private app at https://inventory-ops.joegallant.me is served by the
inventory-ops-production Worker with bundled static assets. The hostname route
runs the Worker directly; it does not fetch the old PC tunnel origin.
Cloudflare Access protects the employee app, and the Worker independently
verifies the signed assertion and an enabled server-owned D1 membership.

- D1 inventory-ops-production: US-jurisdiction shared workflow ledger, employee
  membership, release pointer, revisions, and append-only event history.
- R2 inventory-ops-private-snapshots: AES-256-GCM-encrypted immutable source
  releases. Public managed domains and custom domains are disabled. The bucket
  uses Cloudflare's default placement; do not describe R2 as US-resident.
- Workers.dev and preview URLs are disabled.
- The repository contains code, tests, schemas, and synthetic examples only.
  No production snapshots, database, login credentials, or customer data belong
  in GitHub, GitHub Pages, or a public asset bundle.

September 2 cutover imported the complete validated source release and the
existing operational ledger. Initial ledger import is hash-idempotent and
refuses to overwrite non-empty cloud activity. The Node server is
synthetic-demo only and refuses any file-backed ledger, so the retired SQLite
ledger cannot be reopened for live writes. The retained database is a recovery
copy. In-memory pnpm dev:demo is unaffected.

## Identity and access

Employee Access and upload-only Access use separate audiences. Employee routes
require signature, issuer, audience, expiry, and enabled D1 membership checks.
User-supplied identity/store headers are ignored. Membership determines the employee
identity, role, and home store. Sales/manager evidence permissions differ from
transport permissions; free-form notes are withheld from transport roles.

An enabled Group manager may request a supported lower role using the dedicated
role-preview header. The Worker rechecks the real membership on every request,
preserves the same employee ID and store, and enforces the previewed role on
reads and writes. Other employees cannot elevate themselves with this header.
Preview actions affect live records; the UI labels this explicitly. Return to
Group manager restores the real account role. See [Admin access](ADMIN_ACCESS.md).

The current access policy is a single-account pilot, not an open employee
rollout. Adding staff requires both an explicitly approved Access allowlist and
an enabled D1 membership with the correct role/store. Do not grant elevated roles
merely to make a demonstration work. GitHub access grants no live app access,
and no general-purpose AI data connector was created.

Google sign-in was added and its provider connection tested on September 9.
It uses the separate Inventory Flow Google Cloud project, not LTV Desking Pro.
The employee app allows Google plus the existing one-time email-code fallback;
the exact-account allowlist, eight-hour session, audience, and D1 membership
requirements were preserved. Provider secrets remain in the identity provider's
configuration, never the repository or frontend. Adding a login method does not
grant another person access or change their app role.

POST actions require same-origin requests and an idempotency key. Operational
state and its audit event commit together with a revision compare-and-swap.
Concurrent conflicts retry from fresh state; they do not silently overwrite
another action. Raw release downloads are not employee API routes.

The publisher uses a purpose-scoped Access service token on /internal/* and an
additional Worker publisher secret. It cannot enter the employee app. No
DealerMail/vAuto cookies are reused or exported as a cloud publishing identity.
Requests and responses are not logged as payloads. Invocation logging is off.
Query strings are redacted from platform error telemetry.

## Deployment

Production Worker deployment and migration-ledger backfill require Joe's explicit authorization for the exact release in the current session. They run only from the reviewed clean app checkout on the controlled deployment host after every checklist gate passes:

```powershell
pnpm install --frozen-lockfile
pnpm cloud:release
```

This is one explicitly authorized paired release (`pnpm cloud:deploy` and `pnpm integrations:deploy`
are aliases for the same pair; do not run both for one release). The wrapper runs
`pnpm check` (including the production build), then `pnpm cloud:validate`, records
the source in `dist/build.json`, then verifies the existing D1 migration ledger with
one read-only `SELECT` through the named `INVENTORY_DB` binding and the app Wrangler
config: every local migration filename must be recorded, and nothing else may be.
A missing ledger, a pending or unexpected filename, malformed output, or a failed
query stops the release before either deploy. It never applies schema files or
backfills the ledger, and a filename check does not replace the authorized operator's verification of
the actual schema.

After those gates, the wrapper deploys the app Worker and then integrations with
the same resolved commit tag and records both `version_id` receipts. The default
requires a clean checkout at fetched `origin/main`; an intentional hotfix may use
`--allow-branch` and is tagged `<sha>-branch`. All other arguments, including
`--dry-run` and single-Worker targets, are rejected before any command runs. A
failed app deploy prevents the integrations attempt; if integrations fails after
the app succeeds, the release is partial and there is no automatic rollback. See
the [deploy checklist](DEPLOY_CHECKLIST.md) for partial-failure handling and the
ignored local receipts.

`pnpm cloud:validate` is offline: it checks the Worker modules and applies the
numbered migration files only to an in-memory SQLite database. It never contacts
Cloudflare or writes to D1.

Do **not** run `pnpm cloud:d1:migrate` or a generic
`wrangler d1 migrations apply` against the current production database. Its
original migrations were applied outside Wrangler's migration ledger. An empty
or absent ledger now intentionally blocks the release wrapper: the authorized operator must verify
the installed schema and complete a separately reviewed ledger backfill first.
This repository change does not claim that production backfill is complete.
In particular,
`0003_transport_assignment_identity.sql` contains non-idempotent column adds;
a generic apply would stop partway through and leave a misleading partial
ledger. The authorized operator must apply a reviewed future schema file as one explicit, authorized
single-file operation, verify the resulting schema and record the exact filename
in the reviewed migration ledger, then deploy. Until the authorized operator completes the verified
backfill below, the release command deliberately refuses to deploy. For the
service-readiness release, apply `0007_service_readiness.sql` first and
`0008_service_intake.sql` second before deploying the Worker that reads them.
The 1.2.0 employee-management release also requires the exact reviewed
`0009_membership_admin.sql` file before deployment. It does not promote users.
No remote migration or production write is performed by local code changes.

The Worker bundles the shared platform-neutral service core, D1 repository,
strict release validation, and static frontend. The same core is tested against
local SQLite and D1-shaped transactional storage. Deployment must retain the
existing secret bindings.

Required Worker secrets: RELEASE_ENCRYPTION_KEY_BASE64,
RELEASE_PUBLISHER_TOKEN, and PUBLISHER_CLIENT_ID. Issuer/audiences, exact private
hostname, and resource bindings are configured in cloudflare/wrangler.jsonc.
Keep secrets in Cloudflare's secret store, not config or build output.

The connected-account deployment can also upload assets through Cloudflare's
short-lived assets session and deploy the bundle using multipart metadata.
scripts/prepare-cloud-assets.mjs and scripts/upload-cloud-assets.mjs support
that path. Temporary upload tokens must travel through the encrypted local
handoff and must never be printed or checked in.

## Daily source publishing

Source collection still runs on the authorized Windows host using its approved
browser session. It is separate from web hosting: the app remains available
when the PC is off, but new collection cannot happen while that host or the
required source authentication is unavailable.

The existing Daily Inventory Ops resource sync schedule follows report
completion at 9:15, 9:45, 10:15, and 10:45 AM America/New_York. It builds or
reuses the exact-date/hash-bound resource cache, then publishes only a complete
public AND DealerMail release. It never re-imports the operational ledger.
The report automation, source snapshots, and external records remain untouched.

Run these commands as the authorized Windows user from this repository:

```powershell
pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Run -Script scripts/sync-cloud-release.mjs
```

When the completed public snapshot already contains audited exact-VIN photos,
AutoCheck and factory-sticker summaries, preserve that enrichment when building
the hash-bound resource cache. Use the currently bundled Python executable:

```powershell
python scripts/build_photo_cache.py --report-date YYYY-MM-DD --reuse-snapshot-resources
```

This explicit reuse mode makes no network requests, retains original sticker
market/currency and placeholder evidence, and still requires the completed
validated manifest and matching snapshot hash. Do not use a fresh extraction to
overwrite manually recovered current-day resources. Without this option the
legacy resource-refresh mode remains available for snapshots without enrichment.

The wrapper reads current-user DPAPI-protected publisher settings from ignored
runtime/cloud-secrets, loads them only into the child process, and restores the
parent environment. That folder has a current-user-only ACL. Never decrypt
settings to the terminal, chat, a log, or a repository file.

The combined sync refuses a prior-day or incomplete release and serializes
writers using work/app-feed-status/.publication.lock. After publication it
independently checks both protected status and full app readiness: exact current
bundle SHA-256, New York report date, public/CRM/store/hold counts and a nonempty
app read model. Date and totals alone cannot certify a same-day release.
Successful verification atomically records work/app-feed-status/YYYY-MM-DD.json.
This count/hash-only receipt is separate from the immutable audited report
manifest: the manifest's historical app_feed value is not the delivery authority.
No receipt is advanced on failure. If a process is forcibly killed, inspect the
recorded PID and ensure it is no longer running before removing its exact lock;
never remove a lock belonging to an active writer.

The receipt verifies the inventory release; private invoice PDF uploads and
completion follow afterward. If an invoice upload fails, `daily-cloud-publish.ps1`
fails without advancing local completion. Its next run loads the publisher
credentials and retries the idempotent invoice uploads from that receipt before
integration verification, latest pointers, and archival. It does not scrape
sources or republish the inventory release on this retry. A receipt alone is
not proof that the full daily publisher finished successfully.
An advertised current invoice missing locally is fatal and requires restoring
its exact-VIN source PDF; legitimate batches with no eligible invoices remain valid.

Publishing checks full snapshots, exact VIN/store sets, raw row
evidence, primary/backups/deleted records, and source hashes. It uses a stable
content hash and fresh encryption nonce. Invalid/incomplete/older releases do
not advance the current pointer. Same-day ordering compares completion instants,
not timestamp strings. Rejected publication leaves the previous release current.
If the server accepted a release but the response or subsequent verification
fails, the cloud may already contain the new release; the delivery receipt is
not advanced. A later retry must verify the actual active date and content hash.

`scripts/sync-cloud-release.mjs` writes a separate verified delivery receipt
under `work/app-feed-status/`, leaving the audited report manifest unchanged.
Both status and full application readiness must identify the exact encrypted
bundle being published. Readiness returns the hash of the same artifact it
decrypted and used to build the bootstrap, without a second release-pointer read.

Publication uses an exclusive writer lock. A recorded positive PID is eligible
for recovery only when the operating system proves that process no longer
exists (`ESRCH`). A separate exclusive recovery guard serializes stale-lock
inspection, identity/content checks, removal and reacquisition. A live or reused
PID, permission denial, empty/malformed lock or abandoned recovery guard remains
blocked for operator review; elapsed time alone never permits lock removal.
After a power loss, inspect that exact owner and file before removing an
ambiguous lock. Do not delete a live writer's lock to force a catch-up run.

Resource-link availability and parsed AutoCheck/equipment-summary completeness
are separate. Missing or partial resources remain explicitly flagged; a
successful core inventory publication is not a claim that every document exists.

### Moving the publisher to another Windows PC

The publisher's settings (`runtime\cloud-secrets\publisher.dpapi`) and its
integration credential files (`runtime\integration-credentials\*.json`) are
protected for one Windows user on one PC, so copying them does not work. Move
them with the sealed handoff. Run every command from the repository folder as
the Windows user who will run the scheduled tasks on that PC.

1. On the new PC, run
   `pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Initialize`.
   It saves `runtime\cloud-secrets\handoff-public.txt` and prints the recipient
   key fingerprint. Copy that public key file to the current publisher PC; it is
   not secret.
2. On the current publisher PC, run
   `pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Export -PublicKeyPath <copied handoff-public.txt> -OutputPath <folder outside the repository>\publisher.handoff.json`.
   Confirm the printed recipient fingerprint matches step 1. Read the transfer
   code off this screen; never send it with the file (say it aloud or look at
   both screens).
3. Move `publisher.handoff.json` to the new PC by any channel. Only the new
   PC's protected key can open it.
4. On the new PC, run
   `pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Accept -InputPath <path>\publisher.handoff.json -TransferCode <code from step 2>`.
   Accept opens the file and compares the code before writing anything.
   Anyone holding the public key could make a handoff, so a mismatch writes
   nothing; delete the file and repeat from step 2.
5. Delete `publisher.handoff.json` from both PCs, and delete
   `runtime\cloud-secrets\handoff-private.dpapi` and `handoff-public.txt` on
   the new PC so an old handoff can never be replayed. At any time,
   `-Mode Check` prints the setting names, credential file names and transfer
   code; the codes on two PCs match while they hold the same values.

The handoff carries the same release encryption key the Worker already holds,
so no Worker secret changes. No mode prints a value. Settings that steer
process startup (such as PATH or NODE_OPTIONS) and Windows device names are refused. Export refuses to write
inside the repository (other than `runtime\`) or to overwrite a file, and Accept
refuses to replace a different credential file.

Moving the scheduled publishing is a separate, explicitly authorized cutover:
only one PC may publish at a time. Disable the tasks on the old PC before
registering them on the new one, confirm one verified publication from the new
PC, and only then remove the old PC's `runtime\cloud-secrets` and
`runtime\integration-credentials`. The new PC also needs the operational
workspace (`work\run-status`, `outputs`, `apps\inventory-ops`) and the host
builder scripts the daily runner calls from `work\`.

## Saved activity and recovery

D1 is the sole writable production ledger. New daily releases never replace
requests, events, attention assignments, or history. Do not copy local SQLite
over cloud state or re-run migration as a daily job.

Initial import completed 2026-09-02; recovery uses D1 Time Travel, see
RECOVERY_DRILL.md.

For an incident:

1. Restrict or disable affected Access memberships; preserve audit history.
2. Keep the last verified source release if a source/publisher fails.
3. For a faulty code release, deploy the previously reviewed Worker/assets
   version while retaining D1, R2, and secrets.
4. Inspect D1 recovery/Time Travel options before any restore. Coordinate an
   explicit recovery point and reconcile actions made after it. Never replace
   the operational ledger as a casual troubleshooting step.
5. Source releases can be recovered from immutable encrypted R2 artifacts,
   subject to retaining their encryption key. Only a validated release may
   become current.
6. Do not remove the hostname route as a routine rollback: its old DNS origin
   still points to the retired tunnel, so doing that can restore Error 1033.

Key rotation and independent recovery escrow require a controlled procedure:
old source artifacts need the matching old key. The current publisher settings
are Windows-user/machine-bound; simply copying the DPAPI file to a Mac is not a
working recovery plan. Do not put plaintext recovery secrets into Git.

## Acceptance boundaries

### DealerMail vehicle handoff

The table's DealerMail control opens the vehicle's Hold tab inside Inventory
Flow. Saved holds, comments and alerts are separate read-only views. One
`Open in DealerMail (copies stock)` control then requests DealerMail's full four-store
inventory screen and copies the displayed stock before the page loses focus.
Users paste it into LAST8 / STOCK, select Search, and verify the full VIN.
DealerMail's top-level `byItem` and hold-edit responses are fragments whose
native controls require the surrounding inventory page; do not claim automatic
vehicle selection or present several action buttons with the same destination.
A null return from `window.open` with `noopener` is not evidence of failure.
Invoice and OASIS keep their independently verified VIN-specific destinations.

### Full-size loading regression

On September 2, the uploaded release was present but the employee bootstrap
failed: Cloudflare recorded `Worker exceeded CPU time limit`. Upload/status
success alone did not exercise the employee loading path. Native Buffer base64
decoding replaces the multi-million-element string-iterator conversion, and
the D1 read model clones only the normalized fields it consumes, not duplicate
raw source archives. Authenticated decryption, content hashing, full source
validation, and defensive isolation remain required.

After every backend deployment, run the machine-authenticated, read-only check:

```powershell
pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Run -Script scripts/verify-cloud-deployment.mjs -ScriptArguments readiness
```

The readiness route must load/decrypt/validate the current release, read the
shared ledger, build the bootstrap, and serialize it. It returns only aggregate
counts and size, never inventory rows or customer evidence, and cannot commit
workflow changes. It does not replace signed-in employee/browser acceptance.

Readiness also reports `employeeWritesEnabled`. A deployment with
`EMPLOYEE_WRITES_DISABLED: "true"` (or an invalid configured value) retains
authorized reads but refuses employee POSTs with `503 EMPLOYEE_WRITES_DISABLED`;
`ready` is false even when storage is healthy. Only the exact string `"false"`
or an absent variable enables writes. The first approval release deliberately
creates a paused recovery version before separately authorized activation; use
[Approval release recovery](APPROVAL_RELEASE_RECOVERY.md) for its acceptance
criteria and compatible rollback. Do not weaken the standard readiness script
or restore an old Worker that permits salesperson self-approval.

Test with production-sized synthetic payloads, not only the eight-vehicle
fixture. Check actual Cloudflare CPU and memory outcomes after deployment:
local timings do not prove that an account's runtime allowance is sufficient.
Do not remove source fields or bypass validation to conceal a resource limit.
Any required paid-plan change needs explicit owner approval.

Implemented and exercised with synthetic tests: identity/audience separation,
role filtering, complete-source validation, read/write parity, duplicate-action
protection, concurrency rollback, append-only audit, initial migration, and
source retention. Live checks verify encrypted publication, source totals,
migration idempotency, Access sign-in gating, and private bucket/Worker routes.

September 9 hardening added [cross-browser readability and interaction
acceptance](CROSS_BROWSER_ACCEPTANCE.md) and an [actual encrypted D1 export
recovery exercise](RECOVERY_DRILL.md). The latter restored all 15 live tables
only in local memory and independently matched remote counts, without restoring
or editing the production database. Google provider sign-in was also tested;
the signed-out app login page exposes Google and the code fallback, not inventory.

Still required before a broader production rollout:

- Complete signed-in browser acceptance with the authorized user on desktop
  and mobile; unauthenticated redirect checks alone do not prove the full UI.
- Approve and test each employee role/store assignment and access revocation.
- Complete independent account/key-loss recovery, key escrow/rotation and a
  retention-policy review. The tested local encrypted-export restore does not
  prove recovery after losing this Windows account or its protected key.
- Observe a subsequent scheduled scan-to-cloud run; a successful manual publish
  proves the mechanism, not that a future source login will succeed.
- Review performance, monitoring, accessibility, and operational adoption with
  the pilot users. Do not claim that cloud deployment makes every UI perfect.

## Infrastructure Migration (Phase 3)

### D1 Migration Ledger Backfill

**Release-authorized production work; not performed by this code change or by the release
wrapper.** Joe must explicitly authorize the exact release in the current session. Historical migrations were applied outside Wrangler's ledger.
Creating ledger rows does not apply or verify their SQL. Never run a blanket
backfill or generic migration apply merely to unblock deployment.

1. Arrange the maintenance/recovery window and preserve a verified database
   backup through the existing owner procedure.
2. Compare each exact file below with the live schema, indexes, constraints, and
   required data changes. Record the evidence of prior application. A table's
   existence alone is insufficient. Apply any genuinely missing migration as
   its separately reviewed single-file operation before marking it complete.
3. After that review, the authorized operator may create the standard `d1_migrations` ledger if it
   is absent and insert **only the filenames individually verified as applied**.
   Resolve unexpected or duplicate entries through the same review. Do not
   record invented names or assume `INSERT OR IGNORE` verifies anything.
4. Re-read the ledger with the query below. The release gate requires exact
   agreement with all `.sql` filenames in `cloudflare/migrations/`; future files
   extend that requirement automatically. Keep the generic apply path unused
   while historic non-idempotent migrations could be replayed.

Read-only schema evidence for step 2. Save both query outputs outside the
repository (they describe the production schema; never commit them). Both are
`SELECT` statements; when the ledger query reports that `d1_migrations` does
not exist, skip it and omit `--ledger`. Run the block from the repository root;
its first line creates a private temporary folder outside the repository for
the evidence:

```sh
EVIDENCE_DIR="$(mktemp -d)"
wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name" > "$EVIDENCE_DIR/d1-live-schema.json"
wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command "SELECT name FROM d1_migrations ORDER BY name" > "$EVIDENCE_DIR/d1-ledger.json"
node scripts/verify-d1-schema.mjs --live "$EVIDENCE_DIR/d1-live-schema.json" --ledger "$EVIDENCE_DIR/d1-ledger.json"
```

`scripts/verify-d1-schema.mjs` never writes. It reads only the files it is
given and `cloudflare/migrations/*.sql`, opens only in-memory SQLite databases,
and never contacts the network, runs Wrangler, or changes D1. It applies the
migrations in order to record each file's delta (tables, indexes, triggers,
views, and `ALTER TABLE` columns), rebuilds the live schema from its `CREATE`
statements, and compares them structurally: column type, `NOT NULL`, default,
and key; table constraints; index columns, uniqueness, and partial `WHERE`;
trigger and view SQL. Each file is reported `APPLIED`, `MISSING`, `PARTIAL`, or
`MODIFIED` with every differing object, and live objects that no migration
creates are listed. Add `--json` for a machine-readable report. Exit 0 means
every migration is `APPLIED` and nothing is modified, unexplained, or
inconsistent with the ledger; 1 means a difference was found; 2 means an input
was unusable, including Wrangler output that is not exactly one successful
result set, or a live schema that has a `d1_migrations` table when `--ledger`
was not supplied (its rows must be checked too).
When ledger rows are supplied, every migration filename must be present exactly
once. An empty or partial ledger fails even when all schema objects are applied;
the read-only backfill plan can still be printed for review.

For a tenant identity installed through the separate tenant setup procedure,
append `--tenant-identity`. This validates the full table and both immutable
triggers against the fixed file
`cloudflare/tenant-migrations/0001_tenant_identity.sql`, independently of the
inventory migrations. Missing, partial or modified tenant objects fail, as do
any additional unexplained objects. Without the flag the original strict
extra-object check remains. The report is explicitly schema-only: it does not
verify the singleton row's group ID or the control-plane relationship. Perform
that identity verification separately. Never add the tenant filename to
`d1_migrations`; the verifier and paired release reject it there.

Schema presence cannot prove data changes. Migrations that contain `INSERT`,
`UPDATE`, or `DELETE` (currently `0002`, `0003`, `0005`, `0010`, `0015`, and `0017`) are
flagged `DATA_REVIEW_REQUIRED`; `0005` also leaves the schema identical to
`0004`, so only data evidence can show that it ran. Review those data changes
with read-only queries before attesting to them. For `0017`, compare all legacy
hold events before and after the rebuild, including owners, actor identities,
versions and idempotency hashes; its five-state schema alone cannot prove that
the copied history was preserved.

The verifier can compare only against the current file text, and `0004`'s
operation `CHECK` was widened in Git (adding `manager_dispositions_list`, in the
same commit that added `0005`) after `0004` was first applied. So if `0004`,
`0005`, and `0010` all show `MODIFIED` with `manager_dispositions_list` absent
from the live `CHECK` on `integration_access_audit.operation`, the original
`0004` is live and `0005` and `0010` have not run: do not re-apply `0004`.
Review and apply `0010` (which supersedes `0005`) as its own single-file
operation, then re-verify.

For step 3, `--print-ledger-sql` prints, for review only, Wrangler's exact
`CREATE TABLE IF NOT EXISTS "d1_migrations"` statement and one
`INSERT INTO d1_migrations (name) VALUES ('<file>');` line for each migration
that is `APPLIED` and not already in the ledger. It leaves out
`DATA_REVIEW_REQUIRED` migrations unless the operator attests to their review
with `--data-reviewed <file>,<file>` (it stops with exit 2 if a named file is
not `DATA_REVIEW_REQUIRED`, so a mistyped attestation is never silently
accepted), and never prints a line for a migration that is not `APPLIED`. Printing executes nothing; running the reviewed
statements remains the Joe-authorized release work described above.

Current filenames (reference list, not an executable backfill):

- `0001_initial.sql`
- `0002_app_access.sql`
- `0003_transport_assignment_identity.sql`
- `0004_integrations.sql`
- `0005_manager_disposition_audit.sql`
- `0006_integration_audit_per_client.sql`
- `0007_service_readiness.sql`
- `0008_service_intake.sql`
- `0009_membership_admin.sql`
- `0010_integration_audit_operations.sql`
- `0011_vehicle_issues.sql`
- `0012_attention_event_input_hash.sql`
- `0013_vehicle_dispositions.sql`
- `0014_customer_vehicle_lists.sql`
- `0015_manual_inventory_controls.sql`
- `0016_collector_publication_receipts.sql`
- `0017_manual_hold_approval.sql`

For the first `0016`/`0017` release, follow [Approval release recovery](APPROVAL_RELEASE_RECOVERY.md).
Its maintenance containment, exact legacy-row preservation, compatible paused
version and separate activation are additional gates. Schema presence and a
ledger entry alone do not satisfy those gates or enable a collector.

`0011`, `0012`, `0013` and `0014` postdate the reviewed backfill. Apply each one as its own
single file (never `wrangler d1 migrations apply`), verify the objects it
creates with a read-only `sqlite_master` query, then record its exact filename
in `d1_migrations` the same way as the backfill. The release gate stops while
any of those names is missing from the ledger. `0013` adds the append-only
`vehicle_disposition_events` table; apply it before releasing the commit that
reads it (see the deploy checklist). `0014` adds employee-owned customer lists; verify all three tables, two indexes and two immutable action triggers before recording it. Protected readiness must verify saved-list storage before launch.

The owner can inspect the existing ledger without creating it:

```sh
wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY name" --json
```

Missing-table, authentication, malformed-output, or filename-mismatch errors
stop the release before either Worker deploys. The wrapper does not use
`wrangler d1 migrations list`, which can initialize the migration table.

### Tunnel Cleanup and Custom Domain Move (explicit authorization required)
Moving `inventory-ops.joegallant.me` to a Workers `custom_domain` is an
account-level change performed only after Joe explicitly authorizes that exact domain move in the current session, in a quiet window, after a
verified paired release. The hostname's DNS still
points at the retired PC tunnel, which is why removing the route is not a
rollback step (see item 6 under Saved activity and recovery: Error 1033).
Order matters: read-only confirmation first, the Worker route second,
deletion last.
1. Log into the Cloudflare dashboard. Confirm, read-only, that the retired PC tunnel and the DNS CNAME for `inventory-ops.joegallant.me` still exist and that the current Worker answers `/api/health`.
2. In `cloudflare/wrangler.jsonc`, configure the environment with a `custom_domain` route:
   ```jsonc
   "routes": [
     { "pattern": "inventory-ops.joegallant.me", "custom_domain": true }
   ]
   ```
3. Deploy the worker to claim the custom domain.
4. Delete the legacy tunnel CNAME and tunnel from the Cloudflare dashboard.
5. Uninstall `cloudflared` on the PC.
6. Re-run the post-deploy verification. If the hostname stops answering, restore the CNAME before anything else; every rollback requires the same move-specific authorization.
