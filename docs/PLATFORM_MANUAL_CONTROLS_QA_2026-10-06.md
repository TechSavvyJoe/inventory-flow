# Platform setup, manual inventory controls and named customer lists

Branch: `codex/platform-admin-workspace`, stacked on `codex/platform-owner-admin`.
All browser evidence uses deterministic synthetic data. No production release,
source request, scheduled task, secret, migration or Cloudflare setting was changed.

## Implemented behavior

- The software-owner console uses an account directory, selected-account workspace,
  publication health, people/access, source setup and reviewable change history.
- Each source can be configured for its dealership, provider, OEM, collector/API/file
  method, credential reference, cadence, local time and IANA timezone. An opt-in
  planner deduplicates scheduled slots and bounds queue growth. This is configuration
  and queue planning; a live authenticated executor is not connected.
- Employees can place/update/release an app-owned manual hold. Managers retain the
  disposition ledger and can record Other with a required operational explanation.
  Imported CRM holds, manager evidence, public listing and physical movement stay
  separate. Conflicting records are visible and filterable.
- First vehicle Save asks for a customer-list name before creating a record. Cancel
  creates nothing. Existing matching names are reused; generic legacy lists can be
  renamed in place. Manage/Save name remains available later. Both the web app and
  companion preserve the original interrupted action for a deliberate retry.

## Verification

- Focused platform tests: 80 passed across four files.
- Manual ledger, disposition, write contract, readiness and portability tests:
  476 passed across five files.
- Final migration verifier, D1/Node parity, role canary, disposition dialog and
  quick-view regressions: 80 passed across five files.
- Companion customer-list tests: 19 passed, including interrupted first-save add
  retry without a second create and immediate removal of another employee's data.
- Browser tests: platform setup 4 passed, saved-list placement/workspace return
  10 passed, manual hold/disposition lifecycle 2 passed (desktop and phone).
- Inspected actual browser screenshots at 390x844, 1024x768, 1320x820 and 1440x900.
  Name entry, later rename, manual dialog bounds, focus containment, Escape and
  focus restoration passed. Pop-up expansion leaves document height, page scroll
  and launcher position unchanged, including a transformed app container.
- Companion preview: name before Save, later rename, compact name prompt, Escape
  and focus return passed using the synthetic API only.
- Full gate: `VITEST_MAX_WORKERS=1 pnpm check` passed (exit 0): 223 test files,
  3,371 tests passed and three existing skips. Type checking, repository safety,
  design-system ratchet, web production build and companion archive verification
  passed. One worker limits memory use on the loaded Mac; assertions, test
  timeouts and the committed test configuration are unchanged.
- Comparison PDF wrapping reuses exact font measurements within one document.
  The existing PDF content, pagination and stress tests remain unchanged and
  passed as part of the full gate.

Synthetic PNG evidence is kept outside Git in
`/Users/joegallant/Downloads/InventoryFlow-Platform-SaaS-QA/`:
`overview-<width>.png`, `data-connections-desktop.png`,
`name-before-save-<width>.png`, `named-list-<width>.png`,
`manual-hold-<width>.png`, and `extension-name-compact.png`.
Playwright attachments remain in `/tmp/inventory-flow-qa/e2e/`.

## Release boundaries

Manual controls need reviewed inventory migration `0015_manual_inventory_controls.sql`
and a separately authorized Worker release. The schema verifier continues to demand
data-review attestation for its history-preserving INSERT; no live migration ran.
The owner service needs its separate control-plane migrations, verified owner Access
configuration, isolated tenant mapping and staged live acceptance. The queue planner
ships disabled and no Cron trigger is registered. Vendor authentication, execution,
completion receipts and end-to-end multi-dealership publishing remain separate work.
