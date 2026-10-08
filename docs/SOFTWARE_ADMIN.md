# Software administration

Inventory Flow now has a separate software-owner control plane at `/platform`.
It is independent of the dealership **Control center** at `/admin`. An enabled
group manager cannot become a software owner, grant that role, or access these
endpoints. The owner service has its own hostname, Access audience and database;
employee membership does not grant ownership. The
[October 7 owner-only activation](OWNER_CONSOLE_ACTIVATION_2026_10_07.md) records
the live owner address and verified account. Dealership connections and source
execution remain separate activation steps.

## Account workspace and data controls

The owner console has a searchable account directory, account/publication
filters, a compact Overview inspector, setup-readiness checks, an employee
search/access filter, and drill-down audit entries showing the actual before
and after values. Editing uses a contained dialog with Escape dismissal and
focus restoration. Account selection follows the filters: an excluded group’s
records are not left in the inspector.

Dealer groups opens a full-width account workspace with a compact group picker
and optional group filters. Dealerships, employees, source configuration and
health keep the selected account context. Owner and audit directories have their
own search and structured ledgers.

The account workspace exposes **Setup**, **Dealerships**, **Data connections**,
**People & access** and **Publication** in the selected account's navigation.
Data connections combines a source ledger and inspector with **Evidence & OEM
coverage**, **Provider directory** and **Pull requests**. Sources can be filtered
together by dealership, provider, OEM
family, enabled preference and name/vendor. A selected-source inspector exposes
its scope, method, endpoint, credential reference, local schedule and
configuration checks. On smaller screens it replaces the directory until
**Back to sources** is selected, rather than appending a detail panel below the
list. Configuration uses three steps: Source & scope, Connection, and Schedule
& review. Only the final Save persists the draft. New connections start paused.
The readiness strip separates executor connectivity from planner activation,
last tick and checked/queued/waiting/failed counters.

**Evidence & OEM coverage** separates stored publication counters and exact
registered-store totals from manufacturer source planning. App membership is
the derived public/DealerMail VIN union excluding manager-reported deliveries;
it does not establish availability, physical location or sale status. Unknown
coverage remains unreported. Manufacturer planning counts saved configurations
and enabled/paused preferences for each dealership, not successful captures.
A dealership's
**Add source** action preselects its store and the selected OEM family. OEM scope
can also be recorded for equipment, history, CRM and other provider categories;
changing the category retains that explicit choice. The guide identifies
factory/package data, original and base MSRP, warranty/in-service fields and
recall/campaign provenance to map with an authorized provider. It is planning
guidance, not proof of an installed adapter. Ford's customer-consented
[vehicle APIs](https://developer.ford.com/apis) are separate products from an
OASIS evidence source; access to one does not establish access to another.

Each dealership can register authorized sources independently. Supported source
labels are public inventory, DealerMail, vAuto, AutoCheck, CARFAX, another CRM,
another equipment provider, OEM evidence, DMS and another explicitly authorized
source. Each connection stores its actual vendor name and optional OEM family.
OEM evidence requires an explicit OEM choice. Ford/Lincoln portals are not
assumed for other manufacturers, and no source is enabled implicitly because a
vehicle belongs to a certain brand. These choices do not assert that a capture
adapter or vendor integration has been implemented. Connection methods are dealership collectors,
permitted direct APIs and HTTPS file feeds. The registry stores the dealership,
source name, method, public feed URL, enabled/paused preference, manual/daily/
hourly cadence, local start time and IANA timezone. For hourly cadence, the
configured local start time is the first daily slot. The opt-in scheduler plans
queue entries from these settings; it does not execute them. Collector
configuration uses no URL and no browser profile
contents. Secret reference names must begin with `CREDENTIAL_`; the registry
never accepts a token/password field. API/file URLs cannot include user-info,
query strings, fragments, non-HTTPS schemes or literal/private-network hosts.
The control plane never fetches these URLs. A future executor must independently
validate DNS, redirect destinations, provider authorization and tenant scope.

**Execution is not connected in this implementation.** Saving a connection does
not verify credentials or a source session. The screen therefore reports
**Not verified** and **Executor not connected**, including in the synthetic
demo. New source forms default to **paused**; existing preferences are preserved.
Enabling/pausing a source saves an app-owned preference; it does not stop
or start Windows tasks or an existing collector. Sources remain read-only.

**Request pull** creates an attributed, idempotent queue record; it never runs a
capture or publishes inventory. An active group and enabled source are required,
and each source can have only one waiting request. A waiting request must be
cancelled before its source configuration can be changed. Queued requests have
no automatic expiry, and there is deliberately no execution/claim/complete
endpoint. The console shows every queued request plus the latest 50 cancelled
requests. **Cancel request** cancels a waiting request even if its group has
since been suspended. No arbitrary command, filesystem path, secret transfer,
source write or remote-task route is available.

Connecting execution is a separate integration and release: use each dealer’s
authorized API/file feed or local collector, independently provision its
credentials, and implement authenticated group-bound execution and receipts
before representing any feed as operating. Do not connect these preferences or
queued jobs to the existing production publisher implicitly.

## Daily scheduling across dealerships

`platform-scheduler.mjs` runs only from the owner Worker's trusted `scheduled`
handler, with `PLATFORM_SCHEDULER_ENABLED="true"`. The example configuration
leaves it **false** and registers no Cron trigger. The console shows that
activation boundary, the last planner tick/counts, each source's local target,
and a dealership schedule ledger. There is no browser-callable tick, dispatch,
execution or secret endpoint.

The planner isolates jobs by group, dealership and connection. Only active
groups and enabled sources are eligible; employee-assignment preferences do not
control source collection. It checks routing/configuration again inside the
enqueue transaction. A deterministic local-date/time slot has a unique queue
identity, audit event and revision change. Repeated/concurrent ticks cannot
duplicate it. Cancelling a scheduled request preserves that slot's identity,
so it does not silently reappear in the same slot. An explicit manual request
can still be made after cancellation.

Daily jobs catch up after today's configured local time, without backfilling
past dates. Hourly jobs use the latest due slot after a missed interval, rather
than creating every missed hour. A repeated daylight-saving hour has one slot;
a skipped start time becomes due on the first later local tick. A waiting job
blocks only its own source; no automatic expiry is invented while execution is
unconnected. Operators can cancel it from its account workspace. Paused or
suspended sources get no new scheduled requests.

Batch size is bounded from 1 to 100, default **8**. Least recently checked
sources are considered first, so a waiting or malformed source cannot starve
the others. The default uses at most 42 D1 statements per successful tick and
50 with failure recovery; sizes above 8 need the paid query limit. Failed schedules expose codes/counts only. The
planner neither reads a browser profile nor fetches a vendor URL or publishes
an inventory release.

For a separately authorized activation, apply the control-plane migrations,
provision/test a group-bound executor with authenticated receipts and tenant
credentials, then add a reviewed one-minute Cron trigger to the owner Worker
and enable the flag. Cloudflare Cron ticks use UTC; the planner interprets each
source's IANA timezone itself. See [Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [D1 invocation limits](https://developers.cloudflare.com/d1/platform/limits/).
Choose batch size and monitor tick failures/queue depth against the account's
limits. Scheduling is **at or after** the target time, not a guarantee that
collection finishes then. With N eligible sources and batch size B, a full
rotation needs roughly ceil(N/B) ticks; verify that delay at the intended fleet
size before promising a dealership's publication deadline. The current demo
has neither an active Cron trigger nor a connected executor.

## Implemented controls

- Create dealership groups in **Setup**, name them, activate verified connected
  accounts, and suspend/resume them with an attributed reason.
- Maintain each group's dealership names, public websites and immutable
  deployment store keys. **Allow employee assignments** controls new employee
  assignment choices; it does not remove historical inventory or revoke
  existing employees. Disable an employee or suspend the group for that.
- Add and edit employees in a connected group's own database, with the existing
  employee roles, immutable emails, concurrency/retry protection, and protection
  for the final group manager. Adding app membership does not invite the user or
  change Cloudflare Access sign-in policy.
- Manage software owners. Another owner must disable your own account; the
  database protects the final enabled owner.
- Inspect stored publication status/date/time, employee counts and connection
  health. A publication older than 26 hours is overdue. This is an observation
  from the database, not proof of authenticated source sessions, complete OASIS
  capture, background collector health, or disaster-recovery readiness.
- Review the latest 50 platform account/owner events and the latest 30 employee
  access events per group. Full append-only history stays in the databases.

No customer holds, VIN lists, source reports, credentials, publisher secrets,
remote task controls, automatic billing, or source-system write controls appear
in the software-owner console. Suspending an account blocks application access
and publisher uploads **on deployments with the tenant gate enabled**. It does
not stop Windows tasks or collection requests; those remain separate operational
controls. The integration API/MCP Worker uses the same opt-in tenant gate and
must receive the same bindings in the activation release.

## Isolation and authorization

The separate `cloudflare/src/platform-worker.mjs` verifies signed Cloudflare
Access JWT issuer/audience/expiry, requires the configured private owner
hostname, and resolves an enabled `platform_owners` row from the verified email
on every request. JWT role claims, preview headers, employee roles and browser
identity fields cannot grant ownership. Assets are authenticated too. There is
no public first-owner/bootstrap route. Responses use `private, no-store`.

The platform Worker binds a **separate control-plane D1 database**, plus explicit
connections to isolated tenant D1 databases. The server-managed
`PLATFORM_TENANT_BINDINGS` variable maps immutable group IDs to D1 bindings named
`TENANT_..._DB`. Forms cannot select a database, upload a token, configure an
arbitrary health URL or point at another group's data. Binding names may not be
reused. Each tenant database carries one immutable `inventory_tenant_identity`
row; a mismatch fails closed before reading employees or publication metadata.

Tenant inventory/R2 data, release encryption keys, publisher identities and
integration credentials stay isolated per deployment. The platform service has
no R2 binding and exposes no inventory/evidence endpoint. Deployments must not
reuse tenant D1/R2 resources or publisher identities across groups. An owner has
explicit authority to administer every *connected* group; ordinary employees
remain confined to their deployment's normal role and store rules.

For connected inventory and integration Workers, bind `PLATFORM_CONTROL_DB` to the control-plane
database and set `PLATFORM_TENANT_ID` to that database's immutable group ID.
Configuring just one setting fails closed. Both absent preserves current
single-account operation. The tenant gate runs after authentication and before
inventory, integration/MCP or publisher handlers. There is no request-supplied tenant selector.
Suspension and revocation are checked on each new request; an already accepted
in-flight request may finish. Owner revocation, an authentication refusal, a
sign-in redirect, or a sign-in HTML response clears the console's protected
views and open edits, and aborts pending reads. A transient network failure or
502/503 response preserves the last verified view and any open draft for retry;
each write still reauthorizes the owner before saving. A failed write with an
uncertain outcome keeps its retry key while owner access is still verified.
Platform administration uses no browser storage.

## New dealership onboarding boundary

The group/dealership registry is generic. It does not provision Cloudflare
resources or install collectors. Connecting another operational dealership still
requires its own deployment, store configuration, authorized source adapters,
isolated data and secrets, sign-in policy, and acceptance checks. The existing
inventory app/source adapters still contain the original account's store and
provider configuration; this change does not claim they are a turnkey shared
multi-tenant SaaS. Do not point a new customer at the existing production
database or reuse another dealership's source permissions.

## API contract

This separate owner-only Worker adds six app-owned administrative write paths;
it does not modify the existing employee/integration write-surface contract.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/platform` | Owner, groups, dealerships, aggregate health and platform audit |
| GET | `/api/platform/groups/:id/members` | One verified connected group's employee directory/history |
| GET | `/api/platform/groups/:id/connections` | Group-scoped configuration, waiting/cancelled requests and executor boundary |
| GET | `/api/platform/audit/:id` | Allowlisted before/after values for an administrative change |
| POST | `/api/platform/groups/:id/connections` | Create/update one dealership’s source configuration |
| POST | `/api/platform/groups/:id/pulls` | Request/cancel a waiting read-only pull; never executes it |
| POST | `/api/platform/groups` | Create/update group; new groups start in Setup |
| POST | `/api/platform/dealerships` | Create/update a dealership within its original group |
| POST | `/api/platform/owners` | Create/update software-owner access |
| POST | `/api/platform/groups/:id/members` | Create/update that group's employee membership |

All writes require same origin, JSON (maximum 8 KiB), an `Idempotency-Key`, a
reason, and `expectedRevision` from the relevant directory. IDs/emails/store keys
remain immutable. No delete route exists. Stale or conflicting writes return
409 without a partial membership or audit update. Platform saves atomically
recheck the owner and revision in the control-plane transaction. Tenant saves
recheck the owner before their separate tenant transaction and use that
tenant's directory revision. Employee audit actors are `platform:<owner-id>`
and the name from the trusted owner record, never client-provided identity.

## Activation checklist — separate named release required

This is a deployment plan, not authorization to execute it.

An **owner-only activation** uses steps 1–4 and the applicable owner checks in
step 7, with an empty account directory, `PLATFORM_TENANT_BINDINGS="{}"`, no tenant
database bindings, scheduler disabled and no Cron. Steps 5–6 are a separate
dealership-onboarding release; they are not prerequisites for signing in to an
otherwise empty owner console. Never implicitly connect an existing dealership
or enable its tenant gate while activating the first owner.

1. Record the current Worker versions, configuration/bindings and D1 backups.
   Use a fresh isolated staging control-plane DB first. Review the six new
   owner-only write routes and configure an owner Access application with its
   own audience and an explicitly permitted owner identity.
2. Apply `cloudflare/platform-migrations/0001_platform.sql`, followed by
   `cloudflare/platform-migrations/0002_data_connections.sql` and
   `cloudflare/platform-migrations/0003_pull_scheduler.sql` to the new
   control-plane DB. Never apply it to `INVENTORY_DB`, and never run the generic
   inventory migrations against that new database. It creates no owner.
3. Resolve Joe's exact verified Access email. A trusted database operator must
   insert the first enabled owner, with a fresh immutable ID and Joe's name,
   using bound parameters. No email or owner identity is guessed by this code.
   Record that bootstrap in the release evidence; browser inputs cannot perform
   it. Test a different authenticated employee and a publisher identity are
   refused by the owner API and owner assets.
4. Build/check the branch and deploy the separate owner Worker using a reviewed
   configuration based on `cloudflare/platform.wrangler.example.jsonc`. The
   example has placeholder IDs/hostname/audience and cannot serve as a live
   production configuration. Keep the owner service hostname distinct from the
   dealership app. Verify the actual Access policy, custom domain and version.
5. Add the existing account as a Setup group and its actual dealership/store
   records. Preserve every employee role, database and secret. Back up its DB,
   then apply only `cloudflare/tenant-migrations/0001_tenant_identity.sql` there
   and insert `(singleton=1, group_id=<this group's immutable ID>)` through a
   trusted operator. The identity is immutable; use a different database for a
   different group. Add its explicit D1 binding/map to the owner service.
6. Verify the owner console sees only aggregate publication health and the
   intended employee directory. Activate the registry account, then release the
   inventory Worker with the two tenant-gate settings. Existing employee access
   and uploads must work. Suspend the staging account and verify both employee
   reads and publisher uploads fail; restore it and verify recovery. Check any
   separately deployed integration service uses the gate before claiming complete suspension.
7. Confirm Joe's live owner login and test ordinary employee, group-manager,
   disabled-owner, stale-editor and wrong-tenant refusal. Confirm published data
   remains unchanged. Production acceptance requires these live checks.

Rollback: restore the recorded Worker versions and their previous bindings/vars
as a unit. The additive identity table can remain in place unused. Preserve
the new control-plane database and append-only audit for recovery; do not delete
customer or tenant data. Restoring an older inventory Worker without the tenant
gate restores its previous access behavior, so document that consequence before
using the rollback. Do not roll a database backup over newer employee changes.

## Navigation between the services

The employee bootstrap may include `access.softwareAdminUrl`. The server derives
it from `SOFTWARE_ADMIN_HOSTNAME` only after checking the authenticated employee's
email against an enabled `platform_owners` record. Role previews and group-manager
permissions never grant software ownership. The URL is part of bootstrap's
conditional-response validator, so revoking ownership removes the shortcut even
when inventory has not changed. The owner service still authenticates every visit.

The owner directory may include `group.appUrl` for an active, connected group.
`PLATFORM_TENANT_APP_HOSTNAMES` maps its immutable group ID to the reviewed public
application hostname; form inputs cannot supply this map. The UI accepts only
public HTTPS URLs with the exact `/platform` or `/inventory` path. These are
navigation links, not shared sessions or authorization grants.

Adding `PLATFORM_CONTROL_DB` to an employee deployment also activates its tenant
configuration checks. Ship that binding together with the matching
`PLATFORM_TENANT_ID`, after the immutable tenant identity and active registry group
have been verified. Apply the same pair to the integrations Worker. Adding the
binding only to provide a shortcut would make the application fail closed.

## Synthetic development

`pnpm dev:demo` serves `/platform` using fabricated Northside and Lakeside account
records and in-memory owner/tenant databases. The launcher’s showcase also
includes Harbor (overdue publication) and Redwood (suspended), four dealerships,
six enabled employees and three explicitly unverified Northside sources. Its fixed demo owner is not a
production authentication path. Nothing reads live workspace files or browser
profiles. Restarting the demo discards changes.
