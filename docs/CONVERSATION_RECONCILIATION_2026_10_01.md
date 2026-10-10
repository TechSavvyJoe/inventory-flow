# Conversation, Claude and GitHub reconciliation — October 1, 2026

> **Historical status — October 1, 2026.** This report preserves the candidate
> audit and explicit unfinished workstreams as they were recorded on that date.
> [PR76](https://github.com/TechSavvyJoe/inventory-flow/pull/76) contains subsequent source changes that may implement some listed fixes,
> but this report does not reconcile all later work or verify any current
> release, production, host, employee, or physical-device state. The unfinished
> workstreams and evidentiary gaps below are dated findings; do not treat them
> as either current status or resolved by code changes alone. Recheck the
> relevant current source, evidence, and acceptance before changing their
> disposition.

At the time, this was a current implementation audit, not a claim that every historical plan or physical-device acceptance step was finished. The comparison used the supplied conversation, both pasted Claude transcripts, the dated Claude recovery/carryover reports, GitHub PRs 1–62 and all 127 fetched review threads, source/tests then available, and read-only Joe-PC/Cloudflare observations. The earlier September 25 report covered the original 2,796-line transcript; the later 1,103-line transcript and recovery checkpoints were reviewed again. Bounded Nowledge Mem and Pieces searches provided additional recovery context; they were not an exhaustive export of either memory service. Old reports describe their own dates and do not override current evidence.

Baseline: merged main `0d67e32c7f72eec675b447ca0d4441b70a8f14f2`, with exact-commit CI [36858281580](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36858281580) green. The 24 repaired review findings below are additional branch changes, not merged or deployed software. Production was still on 1.4.0 when this audit began; the release record must establish any later deployment separately.

## Missed GitHub findings repaired in this candidate

[PR58](https://github.com/TechSavvyJoe/inventory-flow/pull/58) had four review findings. Owner isolation was repaired by [PR59](https://github.com/TechSavvyJoe/inventory-flow/pull/59); the other three remained in main:

| Finding | Concrete correction | Evidence |
| --- | --- | --- |
| Disposition dates use the device calendar and may become tomorrow in the dealership timezone | Both Overview and vehicle workspace use the release timezone for the default date and input maximum | New timezone regressions, including UTC execution and winter/summer boundaries |
| Disposition writers appear in the Control center audit despite the documented detail-only rule | The disposition audit projects a null actor; the original actor remains in the disposition record/detail | New synthetic private-writer/note regression; existing detail and persisted-identity coverage retained |
| Ordinary API requests load unused private saved-list rows | Only saved-list routes supply an owner for row loading; bootstrap checks schema capability without reading list rows | Real Worker/SQLite query regression across bootstrap, detail, transfers and attention, with a positive saved-list read control |
| Employee switching can retain another employee's lists | Already repaired: stable server-owned employee IDs, immediate reset and late-response fences in both clients | PR59; saved-list owner isolation and delayed-request tests |

The new regressions failed on the previous implementation and passed after repair (35 focused tests for the initial three findings). No hold permissions/redaction or pinned product-rule expectations were changed.

The broader review repaired another 21 findings, covering:

- Overview/service links and store scope, target-store permissions, current Ford-history evidence, cross-brand document coverage, legacy return labels and mobile More selection.
- Waiting-for-service normalization, shared kilometre-to-mile conversion and token-based service action sizing.
- Diagnostic Authorization redaction, narrowly limited legacy sold-log checksum recovery, the external snapshot builder's working directory, and accurate OASIS warning wording.
- Best-effort duplicate-tab cleanup, sign-in alerts that wait for confirmed recovery, recognition of a recovered browser, avoiding immediate duplicate messages after ambiguous SSH exit, and guarded temporary-file cleanup.
- Clearing shortlist-only mode when clearing filters, including empty-result recovery and pagination state.

The [complete review ledger](GITHUB_REVIEW_RECONCILIATION_2026_10_01.md) accounts for every fetched thread: 24 candidate repairs, 38 findings accounted for by current source, 25 historical GitHub resolutions, three explicit user decisions and **37 open follow-ups**. Historical resolution is not new live acceptance evidence. No GitHub review thread was silently marked resolved by this audit.

Pieces preserved Joe's September 29 approval of the PR50 test change before its merge. That specific approval resolves the historical authorization question; it is not permission to change protected tests in this candidate. Nowledge supplied earlier release/receipt recovery context that was checked against current source and host observations.

## Planned work accounted for

“Implemented” means code and automated coverage exist; it does not mean a physical iPhone, printer, every employee account or every real document was exercised.

| Request / Claude workstream | Current disposition |
| --- | --- |
| Selectively port PR27 release safeguards | Implemented: clean fetched-main guard, checkout-change detection, build provenance, exact migration ledger, paired Worker receipts, partial-failure reporting, private immutable assets and readable errors. The old branch was not replayed wholesale. |
| Vehicle issues attached to a vehicle, photos, updates and assignments | Implemented in Node/Worker services and app. Manager confirmation requires completion evidence; completed/reopened history remains. |
| Manager vehicle-issue list at the top of Action center | Implemented in PR61: always-visible Vehicle issues option, Open/Review/Completed/All and vehicle context. |
| Manager/store Overview, dispositions and drilldowns | Implemented; PR61 changes presentation to sales-first for salespeople and operations-first for managers without changing data permissions. Store board is removed from the overview presentation. |
| Stable detail retention and shared app/companion rules | Published evidence survives transient refresh failure with retained/stale labeling. Warranty rules are shared with parity coverage; independent hold/listing/location/service meanings remain. |
| Compact header and useful SRP/VDP facts | Implemented in PR58/61: full identity, captured powertrain, colors, equipment, history, certification, source actions and compact status context. Subjective design acceptance remains Joe's decision. |
| Original MSRP and copyable base MSRP for plate-fee work | Internal SRP/VDP only; document-sourced, before options/destination. Informational vAuto fallback is labeled; listed MSRP is not a fabricated discount anchor. |
| Remove report/capture dates from sales scanning surfaces | Repeated timestamps removed from ordinary rows/overview; evidence freshness remains where it explains reliability. Listing age is explicitly distinct from physical lot age. |
| Branded Ford/Lincoln, Blue Certified, AutoCheck actions | Existing usable sources have branded links or captured-record fallback actions; installed equipment is not inferred from a badge. |
| OEM-first equipment with vAuto fallback | Implemented for the existing verified OEM source. vAuto supplementary evidence is collapsed when OEM is usable and primary when it is absent. The new provenance channel described below is still missing. |
| More relevant information throughout operational pages | PR61 shares compact vehicle facts across attention, service and sales overview; service cards have vehicle/records/service actions. Canonical viewport and interaction tests cover the candidate; this is not a claim of subjective perfection. |
| Daily-first navigation and other-store Request | Implemented: staff phone rail Overview/Inventory/Actions/Service/More; moves are secondary, eligible other-store Request remains prominent under existing permissions. |
| Smaller copy controls and less scrolling | Fine-pointer copy controls are compact while coarse-pointer targets remain 44px. Shortlist is a fixed corner popup with progressive list management, not content that adds page height. |
| Chrome companion redesign and useful features high in the panel | Implemented in the paired 1.4.1 package, with shared facts and warranty/manufacturer references. Installing/reloading it in a real Chrome profile is a separate acceptance boundary. |
| Private separate customer lists across devices/app/companion | Central authenticated employee-owned lists are implemented. Customer labels/VIN references stay out of external integration clients; stale/late owner responses are discarded. |
| Save/print/share real PDFs | Implemented in both clients: embedded fonts, photo-fetch/embedding support, actual application/pdf file sharing where supported, download fallback, safe cancellation and retry. Customer-safe data only. Real dealer-photo CORS remains an open finding; synthetic PDF success does not prove every live photo can be embedded. |
| Multi-vehicle detailed and comparison sheets | Implemented: existing detailed sheets plus a landscape comparison option with aligned facts, photos, locally generated printable QR codes and continuation for long content. Original/base MSRP stay out. |
| iPhone home-screen logo | Touch icon/manifest assets are on main; physical add-to-home-screen verification remains separate. |
| Faster navigation and interactions | Immediate state changes, removed whole-page/table animation work, 80/120ms motion and lazy PDF renderer. No universal live-network latency guarantee. |
| Sales-data research and useful equipment knowledge | Research/source mapping is in SALES_INFORMATION_REVIEW.md. Shared manufacturer references are a limited exact-year starter, not a complete option database. |
| Release and recovery safeguards | PR62 fixes an equal-baseline rewrite that could dirty the release checkout. Backup, matching live counts/pointer/revision, rollback points and exact-main CI are recorded independently. |
| OASIS/invoice per-vehicle failures and delivery/count fixes | PR34–47 are merged, including OASIS warning-only gaps, retained release paths, invoice continuation/upload handling, schema verifier, sealed secret handoff and sign-in alert fixes. This does not prove today's source authentication or receipt. |

## Work that is still unfinished

1. **Broader Ford/Lincoln knowledgebase and its Cloudflare API/MCP service.** `MANUFACTURER_KNOWLEDGE_ARCHITECTURE.md` is a proposal. The local shared library covers limited model/year references; there is no deployed knowledge schema, reviewed complete-stock package bundle, `knowledge.read` scope, knowledge API or knowledge MCP tools. Existing VIN-resource API/MCP is a different service. Exact-year/market source review and a separately authorized cloud/schema release remain.
2. **Verified OEM-original window stickers supplied through vAuto, including additional manufacturer logos.** Current informational factory-equipment records explicitly require `isOriginalWindowSticker = false`. A make, hostname or vAuto PDF cannot prove OEM originality. A verified capture/provenance path, validators, adapters and brand mapping remain; do not flip the flag.
3. **Scanner performance follow-through.** Local barcode/OCR, cancellation, retry and authorized matching exist. Photo OCR still creates/initializes a new worker, disables the Tesseract cache and uses unversioned scanner asset paths. Reusable initialization, explicit cache/version behavior and cold-device performance work remain. Exact barcode matches exist; the dedicated distinction between barcode-only matching and OCR correction candidates remains a follow-up, rather than a claim that no barcode matching exists.
4. **A reproducible clean-clone publisher setup.** The orchestrator still invokes external Python/JavaScript builders in workspace `work/`. The PC transfer and workspace-root fixes do not turn those builders/dependencies into a versioned, synthetic-testable source distribution. General resume/publish-only recovery controls also remain incomplete. Preserve Claude's Joe-PC path fixes; do not copy older DT files over them.
5. **Morning publication reliability and the requested ready-by-8-AM target.** Joe-PC recovered later on October 1: DailyRun's 11:30 run returned 0, the daily manifest was complete, and publication was verified at 11:56:03 EDT. DailyRun's next trigger was confirmed as October 2 at 05:30. The noon DealerMail expiry and 12:20 Ford-invoice error subsequently cleared: the 13:00 keeper reports browser, DealerMail, FMCDealer, Ford invoices and vAuto all OK. The 12:55 IntradayHolds task returned 0; the 13:04 read-only check found `intraday_holds_published_and_verified` and today's receipt `published_and_verified` at 12:56:04 EDT. These results do not establish publication by 8 AM today or fresh successful capture of every authenticated source. No task, browser or source session was changed by this audit. DT-4094's current fallback-disabled state was not reverified because that host was unavailable.
6. **Physical-device and actual employee acceptance.** iPhone camera cold-start, native PDF Share, physical print output, icon installation, real extension reload, private-photo behavior and two real employee accounts have not all been verified in this audit. PDFs have selectable text but are not structurally tagged. Sign-in alert code is merged, but end-to-end Mac Messages delivery/timing was not retested here.
7. **External hosted-client onboarding.** The existing read-only REST/MCP service and OAuth discovery can be verified; a successful live connection in every desired ChatGPT/Claude/third-party client remains distinct. The earlier Claude MCP sign-in was explicitly parked, not completed.

The advanced workflow roadmap's bulk operations, saved views and future dispatch features are marked future work in their own document. They should not be confused with implemented release capabilities or silently added to a production release.

## Remaining review risks

The review ledger contains the exact source and discussion link for each of the 37 open follow-ups. They include OASIS response identity and malformed-record handling, keeper deadlines, invoice recovery/receipt binding, published follow-up resumption, access-revocation versus operation-denial handling, disposition conflict evidence, inventory facet semantics, cross-store issue actions, migration-verifier evidence, real PDF photo delivery and CSS/selector cleanup. Some are source-confirmed gaps; others still need the specified executable regression or real-device acceptance. None is represented as fixed merely because an older PR was merged.

In particular, the OASIS requested-VIN binding, authenticated-source reliability, public-count fallback when the release manifest is absent, and real-photo PDF behavior must be resolved or explicitly bounded before an unqualified production-ready claim. The existing generic 403 revocation protection must remain fail-closed while any server-owned distinction for operation denial is designed.

## GitHub and recovered workspace cleanup

- PRs 27/30/31/32 were already closed after their needed changes were reconciled. PRs 34–54 and 58–62 are merged.
- PRs 55/56/57 were stale duplicates: every commit returned patch-equivalent (`-`) in `git cherry` against current main. They are now closed with an explanation; no branch was deleted or replayed. No open PRs or GitHub issues remained at that check; that does not mean the unfinished feature list above is empty.
- The old `slice-b` dirty tree matches recovered commit `97b476c` in 19 of 20 files. Its only further change removes a single old service explanatory paragraph, not a missing feature. The later service presentation supersedes that layout. The original tree is preserved.
- `batch2-leftovers` contains extensive tracked deletions and remains untouched. Rejected header experiments and unrelated worktrees are also preserved.
- The old September 29 release worktree contains an uncommitted deployment entry for `728d382` (app `a4a7f794-c78c-471b-afbe-2e72c7ee1158`, integrations `e8c28a80-90ca-42e4-bbd5-97644219edd4`). It was absent from the main deployment log; this candidate restores it with its historical provenance rather than deleting the old worktree.
- Historical DT branch/stash/uncommitted inventory and the archive branch are separate from merging product features. The archive branch `archive/dt4094-052a24a` was verified on origin at `052a24a472efb2b1dddca6c74c09aa049e926aad`. This audit does not certify the offline PC's current Git state or infer who pushed a commit from its author name. The local scanner-reading-recovery branch's two commits are also patch-equivalent to main.

## Release boundary

The named 1.4.1 release is paused. This candidate is a review branch with additional fixes and reconciliation evidence; it is not a new authorized production deployment. No new knowledge schema, source-system write, task reconfiguration or replacement publication pipeline is included. A deployment attempt at `0d67e32` was stopped after additional findings; static assets had uploaded, but both serving Worker versions were verified unchanged and integrations was not attempted. The last verified serving versions were app `f1d51344-f960-41de-9988-6459cb72a7c6` and integrations `b5b8b31c-0b03-43b8-8a6f-e97863b7d9cc`. Any later release needs its exact commit checks, applicable release acceptance, fresh rollback evidence and named authorization, followed by actual paired deployment proof.

## Candidate validation

- `pnpm install --frozen-lockfile`: dependency setup checked without changing the lockfile.
- `pnpm check:repo-safety` and `pnpm check`: passed. Type checking, repository safety, design-system ratchet, 217 unit test files (3,261 passed, three skipped), production app build and verified companion 1.4.1 archive passed. The build retains its existing large-chunk warning; passing the build is not a latency measurement.
- Synthetic Overview browser suite: nine passed. Canonical 390×844, 1024×768, 1320×820 and 1440×900 screenshots were inspected, with overflow, touch targets, drilldowns, printing, focus, keyboard and dialog recovery checks.
- Additional synthetic inventory/service browser suite: three passed. Responsive inventory/filter/shortlist geometry, service progression and permission rejection, captured service references, expandable photos and draft retention were exercised.
- Exact-commit GitHub build/unit/contracts and full Chromium/WebKit browser jobs passed at `7029e29` in [run 36892589446](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36892589446). Its visual job correctly rejected ten intentional differences from the previous references. Each difference was inspected: mobile More selection, cross-brand document counts and service actions using existing design tokens.
- The documented manual workflow generated 40 synthetic reference screenshots from `7029e29` in [run 36894027136](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36894027136). Thirty remain unchanged under the existing comparator; the other ten match the inspected changes. The exact validated bundle is retained in a [private CI reference release](https://github.com/TechSavvyJoe/inventory-flow/releases/tag/ci-baseline-pr63-7029e29), SHA-256 `a7579778967ad75fba1ab7284323887c0f9d906bd5fb0d402e6657158f22894c`. The metadata-only pin changed; threshold 0.05 and zero allowed differing pixels remain unchanged. The old reference is preserved. This is a synthetic test artifact, not a production software release; final branch CI must validate the new pin.
- `git diff --check`: passed. No protected hold/redaction role or product-rule expectation was loosened; the existing daily-orchestrator product-rule file only receives additional checks.

These are synthetic code/browser checks on the candidate. The 37 remaining review findings, historical production state and physical-device/source-authentication limits above remain separate acceptance boundaries. Logs and screenshots are held outside Git in Joe's local audit directory; no live vehicle data or authenticated captures were committed.
