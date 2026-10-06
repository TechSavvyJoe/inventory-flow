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
  now have their own 44px space; the phone footer uses two rows. The final
  populated-launcher repair clusters arrows and row size together on the left. New browser regressions check these
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

All 40 fresh Linux images from source `b66d9b1` and candidate run
`37533677579` were accepted after individual inspection at all four canonical
viewports, together with nine native edge proofs. The prior `6dc788d` references
were accepted for their earlier source; the final patch has its own reviewed set.
The earlier `f1ec994` and `fdcdd04` candidates were rejected and never pinned.
The final images resolve header copy overlap, initial phone pager obstruction,
wrapped service/hold facts and stock/VIN legibility.

The exact reviewed bundle is stored as asset `616724317` in the private
`ci-baseline-pr67-b66d9b1` test-reference prerelease. Its SHA-256 is
`479dd63787474336b20e9893be4788f9b7e9bee51b055d32f16afc6522445fd9`.
Only provenance/asset metadata is committed in `tests/visual/baseline-pin.json`;
no screenshot or encoded image bytes are in Git. The normal CI comparison
uses the existing read-only token and forbids snapshot updates. The current
[PR checks](https://github.com/TechSavvyJoe/inventory-flow/pull/67/checks)
record the ordinary comparisons and final unit/build/browser gates.

Ten delegated specialists used Codex GPT-6 Luna/medium for the completion audit,
GPT-6 Luna/low for the bounded platform token sweep,
GPT-6.1 Sol/medium for browser repairs, visual review and two frontend repair lanes,
GPT-6.1 Sol/high for patch-risk review, backend readiness repairs and note validation,
and GPT-6 Astra/high for the independent final gate.
Their relevant skills covered frontend testing, React, interface design and
patch-risk assessment. Visual acceptance is synthetic; it is not production
authentication, physical-device acceptance or deployment authorization.

## GitHub review corrections

The review sweeps confirmed sixteen actionable findings. The first nine repairs:

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
Source CI `37533677579` at `b66d9b1` passed all 225 unit/component files
(3,437 tests and three existing skips), the production and companion build,
offline migration verification and synthetic recovery. Its browser jobs passed
96 standard and 57 Chromium/WebKit acceptance tests, with four and three existing
project skips respectively. This manual candidate run does not count as an ordinary
visual comparison. Run `37535636346` at `7f4941f` passed its unit/build and all 40
strict visual comparisons, then was canceled when three new review findings arrived.
The current PR checks remain the evidence required for the final immutable patch,
including ordinary visual comparisons without snapshot updates and complete browser
acceptance. Earlier-source passes and a canceled run are not final-head acceptance.

Native browser review exercised legacy naming, interrupted create/rename replay
followed by an add conflict and successful retry, fresh manual-hold comparison,
concurrent release recovery, imported-only drilldown and manual-only Held
visibility at all four canonical sizes. Decision controls now use the existing
opener marker, return focus to the actual opener after Escape and meet the 44px
target requirement. Two focused opener regressions passed.

The populated phone pager uses left-clustered controls and a compact visible
Saved label on mobile, preserving the full accessible name and desktop label.
Native checks with Saved 4 and the maximum Saved 200, Rows 100 and no scrolling
verified readable digits, 44px controls, 44px of minimum horizontal clearance
and an ordinary Next click reaching page two. Both final standard pager tests
passed. The page-scoped synthetic GET fixture covers a populated launcher
without changing the shared saved-list ledger, and all original geometry
assertions and timeouts remain intact.

The latest serial local full check was stopped after two unchanged-limit
timeouts (PDF listing links and inventory row-count controls). Both exact cases
passed an isolated two-test rerun; the production build, companion archive,
15 offline migrations and synthetic recovery drill also passed. This still is
not a complete final-head local `pnpm check` pass.


The next four review corrections restore naming when a selected destination
is deleted or becomes ineligible; reject contact patterns in manual-hold notes
before event creation; keep each manual/imported date and holder with its own
source label; and centralize both new dialogs' border, focus and compact layout
dimensions in shared tokens. The existing 760px shell boundary is defined in
tokens.css because CSS variables cannot serve as media-query conditions.
Desktop Hold and Decision buttons meet 44px in both dimensions. Native mixed-hold
checks passed at all four sizes: each source retains its own date and backups,
no horizontal overflow occurs, both controls accept an ordinary edge click,
Escape returns focus, and the manual dialog stays within bounds and contains
Tab focus. Final local safety, type, design and production-build checks passed.

The naming component passed six tests and eight native recovery flows across
all four canonical sizes. Eight new source-separation cases and two broader
existing cases passed their focused rerun, with all original timeouts retained;
the broader initial table run had two load-related timeouts. Final manual-note
validation passed all 28 tests, including create/edit/release rejection on Node
and Worker with unchanged ledger/history and Worker revision. The guard covers
email, web and phone patterns while permitting ordinary dates, prices and
package codes; it is not a general identity-information classifier and does
not rewrite historical events.

## Latest review repairs

The final three findings cover contact patterns in disposition notes, platform
sizes defined locally instead of in shared tokens, and companion naming recovery
when a generic list disappears. The shared employee-note validator now covers
both hold and disposition writes. Confirmed historical disposition retries return
the original event before the new guard; new requests reject contact patterns
before appending an event. No history is rewritten. All six disposition codes,
Node/Worker rejection without ledger or revision changes, ordinary operational
notes and historical replay passed: 64 tests across the hold and disposition files.

The companion resolves the current generic-list eligibility before naming,
creates a new list when the original disappeared or became ineligible, and reuses
an existing matching name. Pending vehicles survive recovery without duplicate
rename/create actions. An additional adversarial test uncovered a stale completion
that could refresh after revocation; the captured generation now prevents that
refresh and keeps writes unavailable. The final companion suite passed 30 tests,
including all six new recovery and revocation cases.

Platform stroke, focus, press, canvas, inspector, dialog and search dimensions
now consume shared tokens. The initial mechanical substitutions were corrected
before acceptance to preserve the exact original dimensions: 1px stroke, 2px
focus, 1px press, 1600px canvas, 390px inspector, 640px dialog, 180px search basis
and 32px dialog viewport gap. Actual native checks passed at all four canonical
viewports: computed dimensions, 1px pressed transform, dialog bounds, Tab
containment, body-scroll lock, Escape return and no horizontal overflow. Eight
same-browser screenshots (console and dialog at each size) matched the exact
`b66d9b1` stylesheet injected into the same synthetic DOM byte for byte. Evidence
is `/tmp/inventory-pr67-browser-evidence/platform-token-geometry.json` and
`platform-{tokens,b66-css}-<width>x<height>.png` with their dialog equivalents.
This verifies native equivalence; final Linux CI comparisons remain the separate
visual gate and no new reference set was generated.

## Release boundaries

Manual controls need reviewed inventory migration `0015_manual_inventory_controls.sql`
and a separately authorized Worker release. The schema verifier continues to demand
data-review attestation for its history-preserving INSERT; no live migration ran.
The owner service needs its separate control-plane migrations, verified owner Access
configuration, isolated tenant mapping and staged live acceptance. The queue planner
ships disabled and no Cron trigger is registered. Vendor authentication, execution,
completion receipts and end-to-end multi-dealership publishing remain separate work.
