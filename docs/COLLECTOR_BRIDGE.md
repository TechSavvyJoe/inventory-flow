# Dealership-hosted collector bridge

The first adapter connects the existing dealership-hosted **DealerMail hold
refresh** to Software Admin's pull queue. It is a reviewed implementation
candidate, with execution disabled by default. This document does not authorize
a deployment, data pull, credential installation or Windows scheduled task.

## What the first adapter does

- Refreshes DealerMail hold evidence for the exact four-store profile already
  used by the existing pipeline: Howell, Fowlerville, Ford Detroit and Lincoln.
  Every store must have an explicit enrolled dealership and source grant.
- Requires an exact same-day verified local/cloud baseline before browser use.
  Retains that baseline's public inventory, equipment and resource facts. Their
  retained provenance is not presented as a fresh capture.
- Requires an observed DealerMail-origin tab in the dedicated running host
  browser and fixed installed capture/build dependencies. The preflight does not
  prove sign-in or page readiness; the reviewed helper may reopen a stale
  same-origin tab, while the capture itself rejects an unready session. The
  bridge does not launch a browser, automate vendor sign-in, run remote commands,
  write to the source or install a scheduled task.
- Stages, validates and encrypts one immutable candidate. Publication passes
  through the platform's registered tenant service binding. Success requires
  the tenant's exact saved receipt and independent current-release readiness.
- Preserves the last verified inventory when capture, validation or publication
  fails. An uncertain outcome retains the exact encrypted candidate and blocks
  new work until reconciliation.

FMCDealer, DealerConnection, OASIS, PTS, invoices, warranty lookups and Ford merge
builders are excluded. This adapter does **not** run the ordinary daily runner,
refresh public/vAuto/AutoCheck data, implement direct API/file execution, or
cold-start another dealership. A different store/provider setup needs its own
reviewed adapter and permissions.

## Setup in Software Admin

Open **Dealer groups → selected group → Data connections → Collector hosts**.

1. Configure a DealerMail connection for every named dealership, with method
   **Dealership collector**, no remote endpoint and a local credential reference.
   Enabled preference, cadence and schedule remain separate choices.
2. Install and review the fixed local profile on the permitted Windows host.
   Run its local profile check. Enter the service client ID, installed profile ID
   and computed fingerprint in **Register host**. Review all four source grants
   and give an administrative reason. Registration starts paused.
3. Confirm the enrolled identity's separate machine Access audience, local
   protected credentials, vendor session, dependency fingerprints and verified
   baseline. **Enable host** only after that review.
4. Separately activate the execution flag and tenant service binding in the
   authorized pilot release. Planner activation does not enable execution.
5. Request a pull, or use the reviewed daily/hourly planner. Run the installed
   host once or its separately installed daemon. Review capture and publication
   independently in the attempt ledger.

**Host contacted** means the enrolled computer contacted the platform; it does
not verify source sign-in. **Reported complete** means the host submitted its
capture receipt. **Verified exact release** requires the backend's tenant-origin
receipt/readiness proof. **Check saved publication** performs readback only. If
it remains unknown, preserve the candidate and investigate; do not clear or
rebuild it to manufacture success.

## Local installation contract

The bridge CLI is `node scripts/collector-host.mjs`:

```text
doctor --profile group-dealermail-v1
doctor --profile group-dealermail-v1 --remote
run-once --profile group-dealermail-v1
daemon --profile group-dealermail-v1
```

The default doctor performs local checks only. `--remote` explicitly contacts the
enrolled control plane; it does not read DealerMail. Run-once/daemon can collect
and publish when all grants, flags and baseline checks permit them. Do not run
those against a live host before the separately named pilot is authorized.

The profile lives outside Git at
`<approved-workspace>/runtime/collector/profiles/group-dealermail-v1.json`.
It binds schema/adapter version, group/profile identity, exact dealership/source
IDs and legacy store mappings, fixed control-plane origin, workspace root,
credential/key reference names and the three installed capture/build dependency
SHA-256 values. Its computed fingerprint also includes the bridge's installed
code and the resolved relative-import dependency graph. An adapter/dependency
change therefore requires a reviewed new enrollment.
The profile loader rejects unsupported adapters/origins, extra fields, foreign
store sets, path traversal and symlinked required directories/files.

Collector Access credentials and the tenant encryption key are separate local
DPAPI-protected files for the designated Windows account, under
`runtime/collector/credentials/<reference>.dpapi`. Provision them with the
approved local secret-installation process. Never pass secrets as CLI arguments,
put them in a job, paste them into Software Admin, commit them or transfer an
existing browser profile. The host does not hold a tenant publisher token.

Dependency hashes identify the reviewed installed DealerMail capture, snapshot
builder and finalizer. Missing or changed dependencies fail closed. The capture
uses fixed commands without a shell and receives no collector service secret or
encryption key. Cancellation stops only its owned child process; it does not
terminate an employee's browser.

The dependency review follows relative imports recursively, rejects unresolved,
dynamic and bare-package imports, and permits only its reviewed Node built-in
allowlist. It checks nested helpers for excluded source references. This admits
trusted, reviewed installed code; it is not a sandbox for arbitrary or hostile
programs. The operational capture/build files are not shipped in this
repository and must be reviewed and fingerprinted on the authorized host before
enrollment. Synthetic fixtures do not establish their compatibility.

The tracked shared CDP helper has one hash-pinned exception because it also
contains a fixed PTS read-only POST allowlist used by other pipeline paths. Only
the exact hashes of two reviewed revisions (original and best-effort duplicate-tab
cleanup), each in LF and Windows CRLF form, qualify. The installed byte hash remains
part of the enrollment fingerprint. That constant
does not grant this collector a PTS source scope. The installed capture
call graph and its exact helper hashes must still be reviewed on the authorized
host; this repository cannot verify the absent operational bundle.

## Control plane and tenant boundaries

Owner administration continues to use the owner Access audience and enabled
owner record. Machine routes require a separate collector audience and the
enrolled JWT service `common_name`; email/owner identity cannot grant machine
authority. Group, full dealership/source set, installed profile and grant
generation are immutable or fenced server-side. Jobs contain no caller-selected
commands, filesystem paths, browser targets, tenant binding or publication URL.

| Machine path | Purpose |
| --- | --- |
| `/api/collector/contact` | Attest installed hash/version and record sanitized host contact |
| `/api/collector/claim` | Atomically lease eligible queued work in the enrolled scope |
| `/api/collector/heartbeat` | Recheck current authority/configuration and extend a bounded lease |
| `/api/collector/receipts` | Store allowlisted capture or failure evidence; no raw reports/logs |
| `/api/collector/publication` | Submit the retained encrypted candidate to the server-selected tenant |

Lease lifetime is 120 seconds, heartbeat interval 30 seconds and maximum attempt
duration 45 minutes. The platform freezes configuration and scope hashes and
issues a fence. Concurrent claims, duplicate request keys and stale receipts
cannot grant another worker the same active profile. Source edits are blocked
for unresolved work. Group suspension, source pause, host revocation and stale
leases stop further admission. An already admitted publication may finish;
cross-service instantaneous rollback is not promised.

An expired capture can be retried at most twice automatically, for three total
attempts. A tenant publication with an unknown result is never dispatched again.
The bridge may retry the same retained request: the platform publishes only
when its durable state proves that dispatch has not started, otherwise it reads
back the exact candidate's saved result. Neither path performs another capture.

The platform signs short-lived tenant admission/read tickets. The tenant
rechecks its singleton identity, active group, enrollment, grants, configuration,
lease/fence and exact candidate hash/date. Public/resource fields must equal the
verified baseline. Its publication receipt is stored with the tenant release
mutation, then current release/readiness is independently checked. An old
same-date release or a host-reported HTTP success does not satisfy this check.

Control-plane D1 contains sanitized enrollments, jobs, attempts and receipts.
Encrypted candidates are transient at the platform and retained only in the
authorized host/tenant stores. Customer labels, VIN lists, source reports,
credentials, browser cookies and raw error output are excluded from the owner
ledger and audit. Local capture/candidate artifacts remain private and are
deleted only after exact publication verification and verified local promotion.

After the tenant verifies the exact candidate, the host advances its canonical
DealerMail input, release, manifest and existing verified receipt under the same
publication lock. It writes the receipt last and verifies readback. This is the
baseline for the next same-day pull. A private durable backup permits recovery
after a local interruption. If local promotion fails, the previous files are
restored where storage permits, and the exact candidate, backup and pending
marker stay available for a verified retry. An unrelated later local receipt or
unrecoverable storage failure requires review; it is not cleared as success.

If artifact cleanup is interrupted after verification and leaves a pending
marker with missing candidate files, the host stops for reconciliation instead
of recapturing. Recovery requires an operator to compare the exact local and
tenant receipts before removing that attempt's remaining artifacts. This edge
case is not an automatic recovery path or permission to clear unknown outcomes.

## Release and rollback

Use `cloudflare/platform.wrangler.example.jsonc` and
`cloudflare/collector-tenant.wrangler.example.jsonc` as examples, not deployed
configuration. The owner requires separate collector audience/signing key and
an explicit group-to-tenant service-binding map. The tenant requires its
singleton identity, platform D1 gate, bridge verification key and execution flag.
Platform migration `0004_collector_execution.sql` is required before deploying
the collector-capable owner Worker, even with execution disabled: Data
connections reads its collector tables. It does not activate collection. Tenant
migration `0016_collector_publication_receipts.sql` is a separate prerequisite
for the collector pilot. Apply each through the documented migration-ledger
process only in its authorized release. Do not run a generic migration command
or reuse another dealership's database, R2 bucket, credentials or keys.

The named pilot must identify the exact group, all four permitted stores,
Windows host/account, continuing DealerMail permission, local verified baseline,
service identity/audience, dependency/profile hashes and tenant publication
binding. Complete repository checks, synthetic race/failure tests and browser
QA before activation. Then separately verify a permitted live capture, exact
saved tenant release and role-filtered employee readback. Synthetic tests alone
do not prove live vendor sessions or deployment readiness.

Rollback turns bridge execution off, revokes/disables its enrollment and stops
only the new bridge task. Keep the migrations, queued work, audit/receipts and
last verified release. Allow an already admitted publication to reach a known
or unknown result, then reconcile before another attempt. Do not downgrade the
schema, reset the operational ledger, overwrite data or alter legacy publisher
tasks implicitly.

## Current execution limits

This first adapter uses `America/New_York` for its report date and accepts only
connections configured in that timezone. It reads the complete four-store hold
snapshot for each queued connection request. Requests are bounded and isolated,
but simultaneous requests for several stores are not yet coalesced into one pull.
Review cadence before enabling a real group; enrollment and a passing synthetic
check do not establish installed source access or production activation.
