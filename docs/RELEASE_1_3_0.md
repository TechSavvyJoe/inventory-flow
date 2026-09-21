# Release 1.3.0 validation and interface review

Status: **implementation frozen; local checks and targeted browser corrections complete — release approval pending**.

The accepted direction is a restrained automotive operations application:
V1's navy/blue identity, useful source-backed information, consistent controls,
compact readable layouts, and predictable navigation. A passing unit test or
absence of horizontal overflow does not establish visual quality.

## Defects found during review

| Defect | Correction | Verification |
| --- | --- | --- |
| V2 duplicated workflows and omitted operational behavior | Shared inventory, vehicle, move and service components; optional service board | Targeted behavior checks and final combined check pass |
| Refresh errors discarded the working screen | Retain verified data, explicit retry; clear protected state on access failure | Provider, API and recovery tests pass |
| Internal service anchors reloaded the app and lost working context | Router links with explicit origin and named return actions | Focused tests and Chromium workflow round trips pass |
| Vehicle selection was disconnected from browser history | URL-backed authorized selection and predictable Back/Forward | Focused tests and Chromium Back/Forward checks pass |
| Unsaved edits could disappear on history or programmatic navigation | Shared navigation, history and unload guards installed before the router; stale callbacks rejected | Focused tests and real Chromium declined/accepted Back checks pass |
| A fresh global search could restore a different locally edited query | Navigation request identity overrides cached search only for a new explicit request | Unit regression and Chromium search/return regression pass |
| Shortlist filters disappeared on return, and removing a selected vehicle closed its detail | Access-scoped filter memory; selected vehicle resolves from authorized inventory independently of filters | Focused tests pass; final browser recheck pending |
| Shortlist row pushed useful VDP records below the viewport | Integrated utility, compact facts and task summary | Visual review in progress |
| Source-only links stretched into a large empty vertical area | Compact horizontal source controls; captured records use the space | Visual review in progress |
| Service board reused an editor without its control styles | Scope typography and control styles to the shared editor | Fixed; Service acceptance passed ten cases across five projects and final combined check passes |
| Service board allocated excessive height to empty columns | Natural content height and consistent board controls | Compact board implemented; latest Service acceptance passed ten cases across five projects |
| Service identity, status and source references were fragmented and left unused desktop space | Larger shared gallery and compact identity header; when opened from inventory, status and history share a desktop row and the Service reference spans the full width below them | Captures 62–64 inspected; final geometry case passes Chromium/Firefox/WebKit at 320, 390 and 1440px |
| Service omitted useful captured warranty and technical OASIS information | Show raw coverage notes separately from typed warranty-check results; preserve captured status, term and remaining values. Accept fourteen optional technical OASIS fields through the parser/importer/app/integration pipeline | Technical pipeline: 141 focused tests and TypeScript pass; final full check passes after all layout changes |
| Manager identity was hardcoded | Current authenticated identity and responsible-person matching | Targeted tests pass |
| Summary records were long sentences and omitted useful source fields | Label/value rows for AutoCheck, sticker, vAuto and OASIS; AutoCheck keeps primary checks visible and places the remaining checks in compact “More history checks” rows; optional sticker packages remain separate from group contents and standard equipment | Source details retained; 390px compact-history inspection recorded; final combined check passes |
| Only one demo vehicle had captured source examples | Vehicle-specific, explicitly synthetic source records and matching small sticker previews for all eight fixtures | Fixture and document checks pass |
| Follow-up tasks repeated instructions and created large empty rows | Compact task rows and inline follow-up controls; distinct related tasks remain direct links | Focused tests and phone/desktop inspection pass |
| Service copy treated every Ford action as a recall and implied delivery authorization | Captured open service action counts and “Record service completion” | Focused board checks pass |
| Inventory report expansion pushed the next vehicle far down the page and required repeated clicks | Records beside vehicle identity opens a stable desktop inspector or phone sheet. Previous/Next changes its vehicle without expanding inventory rows. Overview shows sticker highlights, AutoCheck checks and exceptions, and OASIS actions and dates together | Targeted Chromium, Firefox and WebKit checks pass for stationary rows, vehicle switching and close focus; 320/390px and desktop visual review complete |
| Desktop vehicle overview hid each source behind a separate disclosure | Sticker, AutoCheck and OASIS open together at desktop widths; phone disclosures remain compact | Source component checks pass; rendered desktop DOM confirms all three bodies visible with no individual expand controls |
| Equipment stretched across the screen with specifications at the bottom | Compact specifications first, visible category navigation, grouped equipment and search, with optional prices aligned separately | Focused component and Chromium/Firefox/WebKit equipment-filter checks pass |
| Inventory and the equipment finder counted duplicate source packages differently | Shared deduplicated equipment collection; both show 19 items for the representative fixture | Shared collection and focused parity checks implemented; included in the latest passing full check |
| Reference facts were not centered consistently on desktop, and loaner dates used source text | One aligned In-service / Base MSRP / Inventory date group in existing overview space; no duplicate rows; numeric loaner dates | 57 focused workspace/document/date tests and TypeScript pass; desktop capture 65 inspected without overflow |
| Updates search lacked predictive behavior and some portal/mobile controls missed touch targets | Predictive Updates search and 44px controls; visible wrapping manager preset selector; stronger Moves next-action text | Final combined check passes; manager presets (66) and scoped Updates suggestions (67) inspected without overflow/clipping |
| Firefox intermittently returned focus before the vehicle context was ready | Correct focus timing across the Records lifecycle | 21 focused unit tests and three repeated Firefox checks pass after the fix; no uninterrupted all-green matrix is claimed |
| Sticker and vAuto overview panels duplicated equipment | One Sticker & equipment section: official sticker first, attributed equipment-label fallback; equipment-group contents remain separate from optional equipment | Implemented; source details retained; final browser checks pending |
| Displayed dates mixed written months and raw source formats | Shared MM/DD/YYYY display policy; calendar dates do not shift with browser timezone | Targeted app/companion checks and final combined check pass; centered facts inspected in capture 65 |
| Legacy empty OASIS action arrays appeared to confirm no open actions | Explicit capture evidence through parser, external enrichment builder, importer and integration projections; incomplete positives remain qualified | 153 targeted app/pipeline tests pass; external builder delivery remains separate |
| Mobile surfaces accumulated outer page and card gutters | Edge-to-edge mobile surfaces with internal padding and safe-area protection | Implemented and exercised in phone checks; physical-device safe-area verification remains separate |

## Screen and workflow review matrix

Each row requires desktop and phone inspection, including 320px width where
controls are constrained. A row remains pending until rendered evidence and
the relevant workflow checks are complete.

| Surface | States and paths | Status |
| --- | --- | --- |
| Shell | Expanded/collapsed sidebar, mobile navigation, account controls, location changes | Pending |
| Inventory | Search, scopes, sort/filter, pagination, empty results, shortlist, source windows | Compact results and Records inspector inspected; shared equipment count corrected; focus correction has passing targeted Firefox evidence; full-run limits below |
| Vehicle | Overview, equipment, records, holds/moves, activity, source actions, close/Back | Facts/equipment/source/gallery changes implemented and tested; centered desktop facts inspected in capture 65; full-run limits below |
| Service | List, board, selected record, edit/save/cancel, conflict, empty columns | Final desktop/phone/150% photo zoom captures inspected without overflow; ten cross-project cases and three-engine geometry checks pass; affected default desktop/mobile cases pass |
| Moves | Queue, picker, request/direct form, tracker, action dialog, return to origin | Shared workflow and action hierarchy implemented; final acceptance evidence pending |
| Action center | Scope/filter, task detail, follow-up form, return from records/service/move | Desktop and 320/390px inspections complete; browser evidence has the full-run/targeted-rerun limits below |
| Updates | Change types, before/after values, vehicle links, search/scope retention | Desktop/phone inspections recorded; current mobile Howell-scoped Bronco suggestion, metadata and 44px result controls inspected without clipping in capture 67 |
| Group operations | Filters, Needs me, detail destinations, empty states | Desktop/tablet and phone inspections recorded; mobile saved-view preset selector inspected in capture 66, visible and wrapping with 44px controls. This selects existing presets; it does not create personal saved views |
| Control center | People, feeds, audit, employee editor, permission handling | People/editor inspected; feeds/audit and final browser checks in progress |
| Companion | Inventory, source summaries, details, records, compare, settings | In progress |
| Resilience | Loading, failed detail/refresh, 401/403, retries, unsaved work, reduced motion | In progress |

## Current validation evidence

- Four isolated Python cache tests pass without loading the reporting host.
- The final `pnpm check` **after all layout changes** passed repository safety
  and design-system guards, all **141 unit/component files and 1,874 tests**,
  the production build and verified 1.3.0 companion archive. Recorded output:
  `/tmp/inventory-conversation-final-check.log`.
- The latest complete cross-browser matrix then recorded **120 passed and five
  skipped** across Chromium desktop/Android, Firefox desktop/narrow and WebKit
  desktop/mobile. It includes the Records inspector, equipment filters,
  responsive inventory, Service/OASIS setup, gallery gesture paths, draft
  protection, Back/Forward, recovery and operational workflows. The five
  skips are intentional exclusions and remain outside that evidence.
- Service acceptance passed **ten cases across five projects**. The final
  full-width reference geometry case also passed **three engine projects**
  (Chromium, Firefox and WebKit), each checking 320, 390 and 1440px. Recorded
  output: `/tmp/inventory-service-full-width-check.log`.
- The final default browser run recorded **35 passes and one obsolete
  initial-viewport assertion failure**. That assertion was revised to scroll
  to the Service controls and check their 44px targets and fixed-chrome bounds,
  preserving the actual Service workflow assertions. The affected desktop and
  mobile cases both passed on rerun; output:
  `/tmp/inventory-conversation-service-actions-final.log`. This is a full run
  plus targeted correction evidence, not an uninterrupted 36-case green run.
- The inline expansion screenshots are superseded by the Records inspector.
  Current synthetic review captures include `46-records-highlights-mobile.png`
  and `47-records-highlights-desktop.png`; all full reports remain reachable.
- Final inspected Service desktop composition:
  [top layout at 1440×1000, capture 68](/tmp/inventory-skill-audit/68-service-final-desktop.png),
  with a 240px gallery, adjacent status/history and the full-width reference
  immediately below; [reference body, capture 62](/tmp/inventory-skill-audit/62-service-reference-full-width.png).
  Final phone evidence:
  [Service mobile, capture 63](/tmp/inventory-skill-audit/63-service-final-mobile.png)
  and [verified 150% photo zoom, capture 64](/tmp/inventory-skill-audit/64-service-photo-150-percent.png).
  Also inspected: [centered desktop facts, capture 65](/tmp/inventory-skill-audit/65-centered-facts-desktop.png)
  [manager mobile presets, capture 66](/tmp/inventory-skill-audit/66-manager-mobile-saved-views.png)
  and [Updates predictive search, capture 67](/tmp/inventory-skill-audit/67-updates-predictive-mobile.png).
  No overflow was observed in these captures. Captures 59–61 are superseded by
  62; capture 57 showed 100% and is not zoom evidence. Earlier phone captures
  56/58 are superseded by 63 for the final layout.
  These are local synthetic artifacts, not portable repository assets or a
  substitute for final workflow acceptance. Demo illustrations and technical
  values are explicitly synthetic.
- Focused Records source checks pass (46 cases), and inventory panel checks pass
  (43 cases), including VIN-specific source links, material history warnings,
  source changes, navigation, and return focus. The final combined check also
  passes after updating the older tests for the new panel workflow.
- Targeted browser checks cover the new Records panel on Chromium, Firefox and
  WebKit. Firefox desktop verifies keyboard and button zoom because its test
  environment has no Touch constructor; Chromium/WebKit additionally verify
  synthetic swipe and pinch. WebKit's exact unsupported `interactive-widget`
  viewport message is allowlisted; other browser errors remain test failures.
- Offline cloud validation applies all nine migrations to fresh in-memory SQLite.
- Synthetic recovery restores exact schema, rows, audit text and revision,
  rejects incorrect keys/tampering, and checks 24 role/store views.
- The 32-test simple-move suite passed ten consecutive runs after fixing
  same-millisecond event ordering.
- The additive OASIS technical pipeline passed 141 tests across five focused
  suites plus TypeScript. Fourteen source-text fields now survive bounded
  validation and the app/integration projections; short paint/axle codes remain
  intact, while unknown owner/raw fields are rejected or excluded.
- Live D1 table-name inspection confirmed the expected schema without writes.
- Pre-release rollback versions were confirmed: app
  `09ecac9e-21aa-4e0e-957e-196531c34798`; integrations
  `9d0ac26c-6dfd-46d9-a33a-4c69c9e74885`.

## Remaining release gates

Reconcile the remaining rendered screen/state reviews and approve the recorded
browser evidence with its full-run/targeted-rerun and skipped-case limits. The
combined check, Service geometry cases and targeted browser corrections above
are complete; no uninterrupted all-green browser matrix has been produced.
Complete PR review and exact-commit CI, authorized deployment of both Workers,
and monitored live checks. Existing production access restrictions remain
unchanged.

The OASIS enrichment builder is maintained in the separate inventory-scripts
repository. Its compatible fix is isolated on `codex/oasis-capture-evidence`;
the deployed Windows publisher copy has not been verified or updated. The local
capture already retains technical fields, but the external builder's emission
of the fourteen new fields also needs verification or an update. Deploy
compatible publisher/receiving validators and rebuild/republish before claiming
live availability. Until the capture-evidence fix reaches the publisher, legacy
empty action arrays remain unconfirmed rather than being presented as evidence
of zero open actions.

Broader employee rollout still requires the existing
[private-release runbook](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md) gates: signed-in
desktop/physical-phone acceptance, approved role/store and revocation checks,
account/key-loss recovery and retention review, a subsequent scheduled
publication, and pilot accessibility, performance, monitoring and adoption
review. This work has not established full accessibility certification.

Screenshots and runtime outputs are synthetic-only local/CI artifacts, not
production records committed to Git. Browser/device emulation does not verify
physical-device keyboards, Safari chrome, safe areas, or employee sign-in.
