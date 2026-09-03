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
refuses to overwrite non-empty cloud activity. A local
runtime/cloud-cutover.json marker prevents reopening the retired SQLite
ledger for live writes. The retained database is a recovery copy.
In-memory pnpm dev:demo is unaffected.

## Identity and access

Employee Access and upload-only Access use separate audiences. Employee routes
require signature, issuer, audience, expiry, and enabled D1 membership checks.
User-supplied role/store headers are ignored. Membership determines the employee
identity, role, and home store. Sales/manager evidence permissions differ from
transport permissions; free-form notes are withheld from transport roles.

The current access policy is a single-account pilot, not an open employee
rollout. Adding staff requires both an explicitly approved Access allowlist and
an enabled D1 membership with the correct role/store. Do not grant elevated roles
merely to make a demonstration work. GitHub access grants no live app access,
and no general-purpose AI data connector was created.

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

From the app repository, on an explicitly authorized deployment host:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm cloud:d1:migrate
pnpm cloud:validate
pnpm cloud:deploy
```

Both migrations are required. The Worker bundles the shared platform-neutral
service core, D1 repository, strict release validation, and static frontend.
The same core is tested against local SQLite and D1-shaped transactional
storage. Deployment must retain the existing secret bindings.

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
pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Run -Script scripts/publish-cloud-release.mjs
pwsh -NoProfile -File scripts/cloud-secret-store.ps1 -Mode Run -Script scripts/verify-cloud-deployment.mjs
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

Success is published or already_published for the expected report date,
followed by ready: true and matching source counts from the protected status
endpoint. Publishing checks full snapshots, exact VIN/store sets, raw row
evidence, primary/backups/deleted records, and source hashes. It uses a stable
content hash and fresh encryption nonce. Invalid/incomplete/older releases do
not advance the current pointer. Same-day ordering compares completion instants,
not timestamp strings. A failed scheduled attempt preserves the prior release.

Resource-link availability and parsed AutoCheck/equipment-summary completeness
are separate. Missing or partial resources remain explicitly flagged; a
successful core inventory publication is not a claim that every document exists.

## Saved activity and recovery

D1 is the sole writable production ledger. New daily releases never replace
requests, events, attention assignments, or history. Do not copy local SQLite
over cloud state or re-run migration as a daily job.

The one-time migration utilities are:
scripts/export-cloud-ledger.mjs and scripts/verify-cloud-deployment.mjs ledger.
They read the old database without changing it and use a separate encrypted
ledger envelope. The cloud endpoint rejects a different import once state exists.

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

Still required before a broader production rollout:

- Complete signed-in browser acceptance with the authorized user on desktop
  and mobile; unauthenticated redirect checks alone do not prove the full UI.
- Approve and test each employee role/store assignment and access revocation.
- Run a documented disaster-recovery exercise, key escrow/rotation exercise,
  and retention-policy review.
- Observe a subsequent scheduled scan-to-cloud run; a successful manual publish
  proves the mechanism, not that a future source login will succeed.
- Review performance, monitoring, accessibility, and operational adoption with
  the pilot users. Do not claim that cloud deployment makes every UI perfect.
