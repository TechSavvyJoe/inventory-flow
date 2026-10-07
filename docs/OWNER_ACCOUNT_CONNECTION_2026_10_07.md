# Software Admin account connection — October 7, 2026

This release connects the existing four-store account to Joe's separate Software
Admin console. The main app exposes **Software Admin** in its account menu only
when the authenticated employee is also an enabled software owner. An active,
verified dealership account exposes **Open dealership app** in the owner console.
These navigation hints grant no authentication or additional employee role.

The existing account was registered in Setup with its four store keys and an
attributed audit through the normal platform service. Tenant identity activation
and deployment require the release gates below; registration alone is not a
working connection. The retained inventory publication is dated October 1, 2026.

## Deployed release

PR [#70](https://github.com/TechSavvyJoe/inventory-flow/pull/70) merged at
`108305e2a07c631a165eb13d2fb4a085629d911e`. The
[exact-main CI](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/37669316118)
passed test/build, end-to-end, Chromium/WebKit and strict visual checks. The
paired release command passed 3,531 tests with three skipped across 228 files,
typecheck, repository safety, design-system checks, build, Companion packaging,
Cloudflare validation and the read-only existing migration-ledger check.

All four deployments used that clean main commit, tag `108305e`, and were
independently read back at 100% traffic:

| Target | Version |
| --- | --- |
| Software Admin staging | `077c44a2-b14d-417d-8c30-a7f6bd56e88a` |
| Software Admin production | `fb81437b-9334-45e6-8cfb-e7d6bbbf0aa5` |
| App | `669625d0-c502-4c0c-9419-6008e2269ac1` |
| Integrations | `aee172fa-13b8-488e-a66f-19a3f8363bd9` |

The paired receipt is `release-JsrbeB`. The 900-second connected monitor passed
for the three production versions: 49 app, 15 integration and one owner event,
all HTTP 200 with `ok` outcomes. There were no Worker exceptions, console-error
events, 5xx responses or disconnected streams; all six streams drained cleanly.
This observation does not establish source freshness or fleet-scale capacity.

The additive tenant identity table and its two immutable triggers were verified
against the reviewed SQL. The normal attributed owner controls registered and
activated the account; before deployment it read back active and connected with
four enabled stores and two active employees. Configured data connections and
feed pull requests remain empty, with scheduling disabled and no Cron triggers.

Independent integration reconciliation passed at `2026-10-07T19:50:23Z`: 235
public records, with Howell 83, Fowlerville 46, Ford Detroit 65 and Lincoln 41.
The October 1 report date and retained release hash matched the independently
prepared expectation. The one-hour read-only verification grant was revoked by
its exact client ID, subsequent access returned HTTP 403, and its exact local
credential file was removed. An earlier creation attempt failed without retaining
its underlying error; read-only checks found no residual matching grant or file.
One reviewed retry added fixed-code diagnostics and passed. The original cause
remains unknown; no source or release code was changed for that retry.

Authenticated owner/employee browser acceptance passed at `2026-10-07T19:52:26Z`.
The app returned HTTP 200 with the deployed version and Joe's actual group-manager
role, without role/store preview. Its account menu rendered **Software Admin**;
the connected owner account rendered **Open dealership app**. Both destinations
loaded in guarded verification tabs. The Other disposition option was visible.
Manual controls and Issues/report controls were visible at all four canonical
viewports.
Browser QA attempted no writes and blocked off-origin requests. Native new-window
click behavior and a hosted OAuth client's real sign-in remain unverified.

The final Windows readback at `2026-10-07T19:52:53Z` confirmed DailyRun,
DailyPublish, IntradayHolds and DealerMailKeeper disabled, with no publisher
running. AutomationBrowser and IntradayHolds-Monitor remained Ready; this is not
a claim that every legacy task is inactive. The legacy checkout remained clean
at `0e48dd66ac6998e35a10d146469a10417e0b4367`. Inventory remains the stale
October 1 publication. Private exports, operation receipts and diagnostic
helpers remain outside Git.

## Scope and validation

- App and integrations receive the same immutable tenant identity and platform
  control binding. Partial configuration fails closed. Suspended groups are
  refused across employee, publisher and integration routes.
- Saved-list rows are loaded for their authenticated CRUD routes, avoiding the
  extra list queries on ordinary inventory requests. Other writes preserve them.
- Immutable manager-disposition snapshots fail checksum validation when changed;
  the explicit legacy mutable monthly fallback remains supported.
- Service controls respect the server's permission result and the vehicle's
  verified store. Missing service evidence receives review attention without
  claiming a confirmed service state. Disposition dates use the dealership timezone.
- Overview document counts require current, make-appropriate evidence. Ford
  history must be both captured and current; other makes use factory-equipment
  coverage rather than a Ford invoice. Saved reports remain available to inspect.
- OASIS warning progress does not claim publication prematurely, and credential
  lines are redacted before error text is shortened.

Synthetic acceptance exercised 96 HTTP probes across Setup, Active, Suspended
and Recovered states using an isolated remote staging database. This is local
HTTP against remote D1, not proof of Cloudflare edge Access. It preserved the
tenant identity, fabricated membership and empty source/publication data.

Synthetic browser checks exercised the account links, focus restoration and
layout at 390×844, 1024×768, 1320×820 and 1440×900. Full local validation on the
reviewed connection tree passed 3,531 tests with three skipped across 228 files,
including the exact fixed inventory/control binding guard. Require CI on the
exact merged commit before deployment.

## Production gates

1. Preserve and verify private exports of both databases, the three serving
   Worker versions, and their complete previous bindings/variables.
2. Apply only `cloudflare/tenant-migrations/0001_tenant_identity.sql` to the
   existing inventory database. Compare the exact table and two immutable
   triggers, then bind the registered group ID using the reviewed trusted
   operator. Do not use generic migration application or alter the existing
   inventory migration ledger.
3. Verify the four enabled stores, existing employee memberships, retained
   publication and zero configured connections/pull requests before activation.
4. Activate the registered group through the normal audited owner control.
   Read back that it is active and connected with four enabled stores and two
   employees before deploying any tenant-gated Workers.
5. Release the owner Worker and the paired app/integration Workers from the same
   reviewed main commit. Use `pnpm cloud:release` for the app/integration pair.
6. Verify actual owner/employee navigation, publisher readiness, independent
   integration reconciliation and the 15-minute monitoring window. Record the
   results and new versions in the deployment log.

The scheduler stays disabled and there are no Cron triggers. This release does
not activate collectors or source pulls, configure vendor credentials, or request
revoked FMCDealer access. Feed scheduling and queue management do not constitute
an implemented collector executor. Device-specific sharing, hosted MCP clients
and a real second employee's acceptance remain separate verification boundaries.

## Recorded rollback

Pre-release serving versions:

| Worker | Version |
| --- | --- |
| App | `d6614de9-4eb4-4aee-a8eb-2d96d0c16192` |
| Integrations | `572a82ac-939b-490f-a33b-903956787ddb` |
| Software Admin | `95df6c58-4654-499f-8014-50668fe202c3` |

Rollback restores each recorded version with its matching prior bindings and
variables as one configuration unit. Wrangler takes the version ID positionally:
`pnpm exec wrangler rollback <version-id> --config <matching-config>`.
If settings were changed separately, restore the saved configuration through the
reviewed corresponding Worker configuration; private copied configs have relative
source paths and must not be deployed directly from their backup directory.

Keep the additive identity table and owner audit. Do not restore older database
exports over newer employee events or saved lists. Older Workers do not enforce
the new tenant suspension gate, which must be accounted for before rollback.
Private exports, configuration backups and operation receipts remain outside Git.
