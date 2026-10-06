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
- Initial implementation gate at `32c42ce`: `VITEST_MAX_WORKERS=1 pnpm check`
  passed (exit 0): 223 test files,
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

## Acceptance repair review

- Corrected the mobile Decision row overlap, tablet VIN/copy spacing and
  Base MSRP label/value overlap. Stock, VIN and colors use the full vehicle
  column instead of the narrow title area beside the photo.
- The Overview uses equal-width ledgers to keep its expanded store counts
  inside the page at 1320px. Actual expanded disclosures were inspected at
  1024x768, 1320x820 and 1440x900.
- Vehicle workspace actions wrap inside a bounded column. Service status and
  backup hold dates remain readable at all four canonical sizes. Removing a
  blocking ID selector lets the intended responsive backup-fact grid apply;
  the design-system ratchet tightened by two ID selectors.
- Mobile results reserve the fixed saved-list launcher's 44px clearance above
  the bottom navigation. The original WebKit pagination test reproduced the
  covered Next button before the repair and passed afterward; Chrome passed
  that same unchanged pagination test.
- Scanner and cross-browser saves complete the name-before-save prompt;
  the Overview assertion distinguishes the saved-disposition confirmation
  from a separate conflicting-evidence status.
- GitHub run `37508772752` at `f1ec994` passed all 223 test files (3,371 tests,
  three existing skips), the build/recovery gates and 88 standard browser tests.
  Its remaining cross-browser failures prompted the pagination and naming
  repairs above. Its old-reference visual comparisons are not an acceptance
  result for the updated interface.
- Subsequent local runs were not full passes: repeated unit runs hit unchanged
  test timeouts; the isolated PDF stress case still exceeded 15 seconds. The
  local saved-pop-up rerun passed seven of eight cases, with the eighth timing
  out at screenshot attachment; Chrome's many-width reflow timed out during
  screenshot capture. WebKit's full reflow passed. No assertion, timeout or
  screenshot threshold was weakened. Final CI and reviewed Linux references
  must be recorded before this follow-up is handed off.
- Run `37517650583` at `fdcdd04` passed its unit/build and browser acceptance
  jobs. The candidate from `37518243882` was nevertheless rejected after all
  40 images were inspected: desktop header copy icons overlapped identifier
  text by 4px, and the phone's stacked pager was partly covered. Copy targets
  now have their own 44px space; the phone footer uses two rows with arrows
  on the left and row size on the right. New browser regressions check these
  specific bounds without forced clicks or longer timeouts.
- Source run `37521342464` exposed shared fixture contamination in the new
  phone pager test: an earlier transfer test moved its only unheld vehicle
  away from the home store. The pager test now isolates that vehicle's
  synthetic location and joined movement rows in its bootstrap response.
  The original home-page geometry, controls, assertions and timeout remain
  unchanged; no shared ledger reset or application change is required.
  The bounded desktop-pager, direct-move, mobile-pager, direct-move sequence
  passed all four tests, including the contaminated mobile case.

## Reviewed visual references

All 40 fresh Linux images from source `6dc788d` and candidate run
`37521342464` were accepted after inspection at all four canonical viewports.
The earlier `f1ec994` and `fdcdd04` candidates were rejected and never pinned.
The final images resolve header copy overlap, initial phone pager obstruction,
wrapped service/hold facts and stock/VIN legibility.

The exact reviewed bundle is stored as asset `616504177` in the private
`ci-baseline-pr67-6dc788d` test-reference prerelease. Its SHA-256 is
`8992043eef55de8a2f5f82ff0bab1a805b67d49bebc3b4ac21704cb514114f98`.
Only provenance/asset metadata is committed in `tests/visual/baseline-pin.json`;
no screenshot or encoded image bytes are in Git. The normal CI comparison
uses the existing read-only token and forbids snapshot updates. The current
[PR checks](https://github.com/TechSavvyJoe/inventory-flow/pull/67/checks)
record the ordinary comparisons and final unit/build/browser gates.

Eight delegated specialists used Codex GPT-6 Luna/medium for the completion audit,
GPT-6.1 Sol/medium for browser repairs, visual review and two frontend repair lanes,
GPT-6.1 Sol/high for patch-risk review and backend readiness repairs,
and GPT-6 Astra/high for the independent final gate.
Their relevant skills covered frontend testing, React, interface design and
patch-risk assessment. Visual acceptance is synthetic; it is not production
authentication, physical-device acceptance or deployment authorization.

## GitHub review corrections

The final review sweep confirmed and repaired nine unresolved findings:

- Overview hold totals and their drilldown both use imported DealerMail evidence;
  manual holds remain visible through Held and the inventory-decision filters.
- No hold stays independent of app dispositions. The old non-protected expectation
  excluding Other was wrong because a disposition does not change hold evidence.
  Recorded Keep is shown by desktop and mobile Decision controls; comparison
  conflicts retain their separate warning.
- The manual-hold dialog compares its freshly loaded manual record with the
  independently retained imported observation. A concurrent completed release
  resets the draft and action to a usable form with explicit feedback.
- Legacy generic customer lists cannot bypass naming through the existing-list
  selector or companion command. Failed follow-up adds after a replay keep the
  naming prompt open, with an actionable error and deliberate retry.
- Pull cancellation audit changes contain only the state transition. Historical
  raw snapshots are interpreted accurately without rewriting append-only events.
- Protected release readiness reports `manualHoldStorage` and requires it in
  addition to disposition and saved-list storage. All eight schema partitions
  and healthy Node/Worker manual-hold HTTP parity are covered by tests.

The frontend repair lanes passed their focused suites (77 saved-list tests and
120 hold/UI tests). The backend lane passed 582 tests across nine files, including
readiness, cancellation audit, write identity, source privacy and migration parity.
These focused counts include overlapping reruns and are not a distinct-test total.
The current PR checks remain the evidence for the final immutable commit.

## Release boundaries

Manual controls need reviewed inventory migration `0015_manual_inventory_controls.sql`
and a separately authorized Worker release. The schema verifier continues to demand
data-review attestation for its history-preserving INSERT; no live migration ran.
The owner service needs its separate control-plane migrations, verified owner Access
configuration, isolated tenant mapping and staged live acceptance. The queue planner
ships disabled and no Cron trigger is registered. Vendor authentication, execution,
completion receipts and end-to-end multi-dealership publishing remain separate work.
