# Vehicle issues

Status: active in source for the synthetic Node demo and hosted Worker. Joe
approved the two employee write branches and the manager-confirmed completion
rule. Production `0011_vehicle_issues.sql` was verified on October 7, 2026:
the two tables, three indexes and four append-only triggers match the reviewed
migration. The existing hosted Worker includes the issue workflow; this schema
check does not substitute for persisted employee-write acceptance. An older
schema still exposes inventory while reporting remains unavailable.

Vehicle issues are staff observations about a specific VIN: cleaning, fuel,
mechanical concerns, damage, or another problem. They belong to Inventory
Flow's operational ledger. They do not change a DealerMail hold, public
listing, vehicle location, or the manager's separate service-readiness record.

## Workflow

1. Open the vehicle and choose **Report issue**. Select a category, describe the
   problem, optionally mark it urgent, and attach up to three photos.
2. The report appears on the vehicle's **Issues** tab and in the Action center's
   **Vehicle issues** category. The reporting store owns follow-up.
3. A manager assigns the work to a person or team. Sales staff at that store can
   add notes/photos, record work starting, and request completion review.
4. A manager confirms completion with a note. Completion records who confirmed
   it and when. A manager can reopen it if the problem returns.

Assignment is a descriptive person/team label, not an employee identity or an
access grant. The stored reporting and completion actors always come from the
authenticated membership. Only a manager for the reporting store or a group
manager can assign, confirm completion, or reopen. Transport roles can read
these operational observations but cannot use them to change service status.

The states are **Open**, **In progress**, **Awaiting review**, and **Completed**.
Assignment is shown separately. An urgent observation does not automatically
declare a vehicle unsafe or available; staff must use dealership procedures to
assess it. Completing an issue does not mark the whole vehicle Ready.

## Durability and recovery

Issue identity and history do not depend on a dated inventory release. The
ledger stores the VIN and vehicle identity observed when it was reported.
An issue stays accessible from the Action center after the vehicle leaves the
current inventory feed. A later release cannot close or erase it.

Each update supplies the version the employee viewed. Concurrent changes
return a conflict rather than overwriting newer work. Exact retries reuse an
idempotency key; a changed payload with that key is rejected. Current
membership is rechecked on retries and inside the D1 commit transaction.

Photo processing and failed requests must retain the user's unsaved form.
Do not treat a network timeout as proof that saving failed: the safe retry
confirms the original result. Authentication loss clears protected client data.

## Photos

The browser re-encodes photos to JPEG, at most 1600 pixels on the longest side
and 500 KB per photo. Camera/library selection stays in browser memory; no
photo, issue note, or report draft goes to localStorage or sessionStorage.
The server validates JPEG structure, dimensions, size and canonical base64,
and independently removes application metadata and comments, including EXIF
location fields. SVGs, external photo URLs, and arbitrary documents are refused.

Up to three photos can accompany one report/update, with twelve per issue.
Only attachment metadata belongs in D1. Photo bytes are encrypted with AES-GCM
in the existing private R2 binding, using their object path as authenticated
associated data. The employee API resolves an attachment through its issue
record and checks access before returning it with private/no-store headers.
There are no public or signed sharing URLs. The read-only integration and
companion API do not gain access to staff issue notes or photos.

R2 storage precedes the audited ledger commit. If storage fails, the report is
not committed. If the ledger commit fails after storage, an unreferenced
encrypted object may remain; it cannot be retrieved through the employee API.
Content-addressed object keys make retries safe. Operator cleanup must retain
every object referenced by issue history and allow for in-flight writes. Use
`node scripts/cleanup-issue-photo-orphans.mjs` with saved R2 object and D1
photo-reference JSON exports (list R2 first, then export the ledger so
in-flight commits are visible): dry-run by default, skip objects inside the
grace window, hold objects without a valid upload time for review instead of
deletion, never treat a ledger-referenced key as an orphan, and never call R2
delete from the script itself — it only reports candidate keys for an
authorized follow-up delete.

## API and release boundary

The protected employee API has two issue-specific POST branches:

- `/api/vehicles/:vin/issues`: create a report with optional photos.
- `/api/vehicle-issues/:id/events`: add a versioned update with optional photos.

Read routes list issues, retrieve an issue with its history, and retrieve a
photo attached to that issue. Both Node's synthetic demo and the hosted Worker
use the same domain rules. The Node demo keeps photos and the ledger in memory.
Source systems and publisher upload permissions remain unchanged.

Migration `0011_vehicle_issues.sql` adds the issue ledger. Before that migration,
older D1 schemas must continue serving existing inventory, while issue writes
return a clear unavailable response. Deployment and production migration are
separate Joe-operated steps; local tests and synthetic browser checks do not
establish physical-device, multi-employee or production acceptance.

The two branches are pinned in the product-rule write-surface contract. Adding
another write still requires the explicit approval described in `AGENTS.md`;
the closed allowlist must not be replaced with a permissive route matcher.

## Related review findings

The follow-up began at `8db3cedd17250c3bcbc3cfe640622541ae18e51d`. Three
confirmed Action center defects were repaired during this work:

| Priority | Evidence and affected staff | Repair |
| --- | --- | --- |
| P1 | An assigned hold-review name was hidden in the summary but exposed in `events[].assignee` to drivers, porters and coordinators. A synthetic private marker reproduced the leak through bootstrap, list and detail projections. | Apply the existing role-based assignee rule to event history as well; retain legitimate transport assignments. |
| P1 | Resolving a hold alert, then publishing a different alert on the same day with the same alert count, reused the resolved task identity. Sales and managers could miss the new condition. | Fingerprint relevant source hold/alert evidence before role redaction. Changed evidence creates a new open task; unchanged republication retains its resolution. |
| P2 | Reusing an attention idempotency key with a different note silently returned success for the first note. | Bind the key to normalized semantic input and actor context; changed requests return `409`. Exact retries still return the current record. |

Code evidence: `server/service-core.mjs:1431` projects attention events,
`:1457` captures source evidence, and `:2165` checks replay input;
`server/attention-workflow.mjs:124` defines the request fingerprint.
`tests/unit/attention-regressions.test.ts` contains the reproductions. The
existing role-matrix canary now seeds the assignment marker. Migration
`0012_attention_event_input_hash.sql` adds the durable request fingerprint.
Legacy events have no fingerprint, so a retry using an old key is refused
rather than guessed. No historical audit row is rewritten.

Service-readiness detail now returns archived history when a VIN leaves the
current feed but manager events or durable intake remain
(`archivedFromInventory: true`, `canManage: false`). New service writes still
require a current inventory vehicle. Vehicle issues continue to preserve their
own durable identity and remain accessible after source removal.

The two employee save routes, HTTP upload/failure/retry behavior and the
unmocked synthetic browser workflow are now connected and tested. Physical
camera/library behavior, production authentication, production migration and
deployment, R2 disaster recovery/cleanup and simultaneous multi-employee
operation remain separately unverified.

## Local validation — September 25, 2026

Validated implementation: `131dc51363643cd0219be694212e43f89720929d`.
Later documentation-only commits record the results below.

- Frozen dependency installation passed. The final `VITEST_MAX_WORKERS=2 pnpm
  check` passed 2,488 tests in 175 files, type checking, repository safety,
  the design-system guard, production build and companion packaging.
- `pnpm cloud:validate` applied all 12 migrations to an in-memory database.
  No production migration ran.
- `pnpm test:e2e` passed all 42 existing browser tests.
- `pnpm exec playwright test --config playwright.cross-browser.config.ts`
  passed 110 tests across Chromium desktop/Android, Firefox desktop and WebKit
  desktop/mobile, with 5 intentional layout-specific skips (7.4 minutes).
- Before activation, a fresh production-build synthetic server confirmed that
  the HTTP bootstrap disabled reporting and hid the inactive controls. The
  current bootstrap instead follows the ledger capability: migrated Node and
  Worker schemas enable reporting, while an older Worker schema stays readable
  with `vehicleIssuesEnabled: false`.
- Chromium and WebKit issue previews passed at 390×844, 1024×768, 1320×820 and
  1440×900. Checks exercised photo preparation/rendering, assignment, manager
  review and completion, retained history, dialog layering, keyboard behavior,
  44px action selection and horizontal overflow. Preview writes were intercepted
  into the synthetic domain service, not sent through employee HTTP routes.
- Private Worker photo reads were tested with active membership, denied
  membership and revocation during the object read. These do not establish
  acceptance of the upload routes at that earlier checkpoint.
- Screenshots and browser proof remain outside tracked source at
  `/tmp/inventory-issues-{report,detail,completed}-{chromium,webkit}-{width}.png`
  and `/tmp/inventory-issues-preview-{chromium,webkit}-proof.json`.
- Pixel comparisons were not run at this implementation checkpoint. The later
  [main release check for `e80782b`](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36173966245)
  passed 32 strict Linux pixel comparisons for the core app, resolving the
  earlier missing-baseline gate. This does not establish acceptance of inactive
  issue-reporting uploads or replace the unmocked HTTP/browser checks above.

That review accepted the inactive preparation and the three attention repairs.
The later activation is covered by the current write-surface, adapter and
browser tests; it does not establish production readiness.

## Activation validation — September 25, 2026

- Real Node and Worker HTTP tests create, retry and update issue records; store
  and retrieve sanitized encrypted photos; enforce reporting-store writes and
  manager-only completion; preserve optimistic versions; and prove failed R2
  storage or access revocation cannot commit issue history.
- The protected write-surface test pins exactly seven employee POST branches,
  including the two approved issue branches, and continues rejecting source
  system writes and unsupported methods.
- The unmocked Playwright demo flow passed on desktop and mobile: report with a
  photo, assign the work, and confirm completion as a manager through the real
  Node HTTP routes.
