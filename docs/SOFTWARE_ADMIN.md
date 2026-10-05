# Software administration

Inventory Flow now has a separate software-owner control plane at `/platform`.
It is independent of the dealership **Control center** at `/admin`. An enabled
group manager cannot become a software owner, grant that role, or access these
endpoints. The implementation is prepared on a branch; it has not been activated
in production. No existing account has been promoted.

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
in-flight request may finish. Owner revocation, a sign-in redirect or an owner
refresh that cannot verify access clears the console's protected views and open
edits, and aborts pending reads. A failed write with an uncertain outcome keeps
its retry key while owner access is still verified. Platform administration uses
no browser storage.

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

This separate owner-only Worker adds four app-owned administrative write paths;
it does not modify the existing employee/integration write-surface contract.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/platform` | Owner, groups, dealerships, aggregate health and platform audit |
| GET | `/api/platform/groups/:id/members` | One verified connected group's employee directory/history |
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

1. Record the current Worker versions, configuration/bindings and D1 backups.
   Use a fresh isolated staging control-plane DB first. Review the four new
   owner-only write routes and configure an owner Access application with its
   own audience and an explicitly permitted owner identity.
2. Apply only `cloudflare/platform-migrations/0001_platform.sql` to the new
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

## Synthetic development

`pnpm dev:demo` serves `/platform` using fabricated Northside and Lakeside account
records and in-memory owner/tenant databases. Its fixed demo owner is not a
production authentication path. Nothing reads live workspace files or browser
profiles. Restarting the demo discards changes.
