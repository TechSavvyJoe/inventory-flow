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

## Historical deployed release record

The following preserves the release evidence recorded in PR
[#71](https://github.com/TechSavvyJoe/inventory-flow/pull/71). It describes the
October 7 deployment, not the current serving versions or a new deployment.

PR [#70](https://github.com/TechSavvyJoe/inventory-flow/pull/70) merged at
`108305e2a07c631a165eb13d2fb4a085629d911e`.
[Exact-main CI](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/37669316118)
passed test/build, end-to-end, Chromium/WebKit and strict visuals. The recorded
paired release check passed 3,531 tests (three skipped, 228 files), typecheck,
repository safety, design-system checks, build, Companion packaging, Cloudflare
validation and the read-only migration-ledger check.

| Target | Recorded version |
| --- | --- |
| Software Admin staging | `077c44a2-b14d-417d-8c30-a7f6bd56e88a` |
| Software Admin production | `fb81437b-9334-45e6-8cfb-e7d6bbbf0aa5` |
| App | `669625d0-c502-4c0c-9419-6008e2269ac1` |
| Integrations | `aee172fa-13b8-488e-a66f-19a3f8363bd9` |

The historical record reported 100% traffic on each version and a passed
900-second connected monitor with no Worker exceptions, error events, 5xx
responses or disconnected streams. It recorded verified additive tenant identity
and immutable triggers, audited account activation with four enabled stores and
two active employees, no configured feed connections/pulls, and disabled
scheduling. These observations do not establish source freshness or fleet capacity.

Independent integration reconciliation was recorded at `2026-10-07T19:50:23Z`
against the independently prepared retained October 1 publication expectation.
The temporary read-only verification grant was revoked, subsequent access returned
403, and its local credential file was removed. An earlier grant-creation failure
had an unknown cause; the record found no remaining grant/file from that attempt.

Authenticated reciprocal navigation acceptance was recorded at
`2026-10-07T19:52:26Z` using the actual employee role without preview: the main
app exposed **Software Admin**, and the connected owner account exposed
**Open dealership app**. Both guarded destinations loaded; manual controls and
Issues/report controls were visible at all four canonical viewports. The read-only
QA attempted no writes. Native new-window click behavior and hosted OAuth-client
sign-in remained unverified.

The historical Windows readback recorded paused publisher/source-refresh tasks
and no running publisher. It did not claim all legacy tasks were inactive.
Private exports, raw operation receipts, credential files and diagnostic helpers
remain outside Git. Repeat the applicable gates before any future deployment;
this code-merge task does not refresh or activate that retained dealership data.

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
