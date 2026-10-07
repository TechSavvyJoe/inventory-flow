# Software-owner console activation — October 7, 2026

On October 7, 2026, the separately authorized owner-only console was activated at
[inventory-admin.joegallant.me/platform](https://inventory-admin.joegallant.me/platform).
Joe's verified Cloudflare Access identity resolves to the enabled **Joe Gallant**
software-owner record. This is separate from the dealership `/admin` Control center.
All deployment versions, settings, and readbacks below record the initial
owner-only activation snapshot at main commit
[`72e4ca4cd61820f843fed9785293264ddfdacd20`](https://github.com/TechSavvyJoe/inventory-flow/tree/72e4ca4cd61820f843fed9785293264ddfdacd20),
tagged `72e4ca4`; they do not describe the current connected-account release.

Joe's instruction to finish the owner console and owner account authorized this
activation. It did not authorize dealership onboarding, tenant gates, collectors,
pull execution, Cron, publisher-task changes or changes to existing Access apps.

## Deployed targets and recovery identifiers

Both initial Workers used the reviewed owner implementation from main commit
`72e4ca4cd61820f843fed9785293264ddfdacd20`, tagged `72e4ca4`.

| Resource | Staging | Production |
| --- | --- | --- |
| Worker | `inventory-flow-software-admin-staging` | `inventory-flow-software-admin-production` |
| Worker version, 100% traffic | `f3d5a956-4104-4fa4-bfc2-6a38e2dc7e4e` | `95df6c58-4654-499f-8014-50668fe202c3` |
| Hostname | `inventory-admin-staging.joegallant.me` | `inventory-admin.joegallant.me` |
| Separate platform D1 | `acc3341e-36da-4903-819e-6bc5b3e240df` | `b0b0b0d0-740c-4052-9ae1-1c57007b5466` |
| New Access application | `21c51c75-4d52-418a-b2cd-c7b534f2c7d7` | `3d49c180-7f7c-4900-9d36-520beacf60e9` |
| New owner-only Allow policy | `fd8dd357-a501-49fd-a422-044f49493fcc` | `358f580c-0bc0-47d8-9add-24d71c748596` |

The immutable configuration sources for that initial snapshot are
[staging](https://github.com/TechSavvyJoe/inventory-flow/blob/72e4ca4cd61820f843fed9785293264ddfdacd20/cloudflare/platform.staging.wrangler.jsonc)
and
[production](https://github.com/TechSavvyJoe/inventory-flow/blob/72e4ca4cd61820f843fed9785293264ddfdacd20/cloudflare/platform.production.wrangler.jsonc).
At that snapshot, each had one D1 binding (`PLATFORM_DB`), authenticated
`ASSETS`, its own hostname/audience, and six reviewed variables. Actual Cloudflare
settings were independently read back:

- `PLATFORM_TENANT_BINDINGS="{}"`; no tenant databases, services, R2 or source bindings.
- `PLATFORM_SCHEDULER_ENABLED="false"`; no Cron triggers.
- `workers_dev=false`, `preview_urls=false`, `run_worker_first=true`.
- One exact custom domain per Worker; distinct owner Access audiences.
- Access allows only the exact verified owner email, with explicit Google and
  One-time PIN providers, an eight-hour session, and no bypass or machine policy.

## Database and authentication verification

Only the new platform databases received `0001_platform.sql`,
`0002_data_connections.sql` and `0003_pull_scheduler.sql`. Their migration ledgers
were read back. Empty pre-bootstrap exports and hashes were preserved privately.

The trusted bootstrap used Wrangler's remote D1 proxy with pinned account/database
IDs and bound SQL parameters. It verified the exact Access identity first,
rejected unexpected owners/revisions, and recorded the owner change and revision
in an atomic batch with append-only audit. Local dotenv/dev-vars loading and
process-variable inclusion were disabled; the proxy was disposed after use.
No public bootstrap endpoint, authentication-token extraction or credential copy
was used.

With Joe's real, verified Access session, staging refused both the API and assets
with `403 SOFTWARE_OWNER_REQUIRED` before ownership existed. A disabled owner
row was then inserted; the same requests still returned 403. After a trusted
bound enable operation, API/page/assets returned 200. The final-owner guard was
not bypassed or disabled.

Production independently read back exactly one enabled Joe owner, revision 1,
one bootstrap audit event, and zero groups, dealerships, connections and pull
requests. The real owner API/page/index assets returned 200, `demo=false`, and
private/no-store directives. No dealership database was consulted or modified.

## Acceptance and limits

The focused owner suite passed 32/32. Full `pnpm check` passed with 3,472 tests
passed and three skipped across 225 files, plus typecheck, repository safety,
design-system checks, build and Companion packaging. Added tests cover the
empty installation, empty-directory UI and disabled-owner asset refusal.

The live production console was inspected at 390×844, 1024×768, 1320×820 and
1440×900: no horizontal overflow, the correct owner/empty directory, and
keyboard dialog opening, Escape dismissal and focus restoration passed. There
were no application exceptions, failed application HTTP responses, non-GET
requests, employee-bootstrap calls or source requests.

Two external injections produced CSP blocks: Cloudflare's optional analytics
beacon and Comet's Perplexity font. Neither is in the application source or built
assets; the application's local Inter fonts loaded. The strict CSP remains in
place. These blocks are recorded, so this is not a zero-console-error claim.

Real different-employee and publisher sign-ins were unavailable for live negative
probes. Signed-JWT tests cover those identities, wrong audiences/issuers,
forgeries and disabled ownership; the actual staging tests exercised the
server-owned owner-row boundary. The independent final review approved this
owner-only activation. Tenant onboarding/suspension, multi-dealer execution,
scheduling and collector acceptance remain outside this release.

The existing app remained on `d6614de9-4eb4-4aee-a8eb-2d96d0c16192` and the
integration service on `572a82ac-939b-490f-a33b-903956787ddb`, each at 100%, tag
`72e4ca4`. No existing publisher tasks, source sessions, Access settings or tenant
data were changed by this activation. Access's API lists nine self-hosted apps
plus a pre-existing WARP app; all seven preflight self-hosted names remained.
A complete earlier configuration snapshot of those seven was unavailable, so
an exact whole-account before/after configuration comparison is not claimed.

The current connected-account configuration is a separate release. See
[Software Admin account connection](OWNER_ACCOUNT_CONNECTION_2026_10_07.md) and
its current [app](../cloudflare/wrangler.jsonc),
[integration](../cloudflare/integrations.wrangler.jsonc), and
[owner platform production](../cloudflare/platform.production.wrangler.jsonc) and
[staging](../cloudflare/platform.staging.wrangler.jsonc) configurations.

## Rollback and subsequent releases

The initial activation had no earlier owner Worker version. To withdraw that
activation, first remove
only the relevant new owner custom domain from its Worker while retaining Access
protection. Alternatively block only that new owner Access policy while arranging
route withdrawal. After routing is off, its new Access application/policy may be
removed if unused. Never disable/delete the sole enabled owner to simulate rollback.

Preserve both new platform databases, their audit and private exports for recovery.
Do not restore an old database over newer owner changes, and do not change the
existing inventory/integration Workers or their settings. Later owner upgrades
must record the previous owner version and its bindings before deployment.

Tenant onboarding follows the separately authorized steps in
[Software administration](SOFTWARE_ADMIN.md); it is not implicit in signing in.
Private identity/readback, bootstrap, backup and browser receipts are retained
under the task's `inventory-flow-owner-activation` state directory and are not
repository fixtures or customer data.
