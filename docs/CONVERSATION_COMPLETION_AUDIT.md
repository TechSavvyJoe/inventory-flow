# Conversation completion audit

Snapshot: September 20, 2026, during final integration. **Not release approval.**

This checklist reconciles the requested product improvements with the shared
working tree and recorded validation. “Implemented” means the behavior or
presentation exists in source; it does not mean every screen has received final
visual approval. The Service implementation, final combined check and browser
corrections are complete. The current browser evidence includes a complete
all-green matrix with five intentional skips. No browser or test suite was run
solely to produce this document.

The accepted direction is the professional V1 navy/white/blue application,
improved information density and workflow clarity, with matching improvements
to the Chrome companion. The rejected V2 visual style is not the target.

## Requested work and current implementation

| User request | Status | Implementation and evidence |
| --- | --- | --- |
| Continue the interrupted work without losing existing workflows | Implemented; final integration acceptance pending | V2 inventory, vehicle and transfer entry points reuse shared workflows. Source-backed state, permissions and existing operations are preserved. See [InventoryExperienceV2](../src/features/inventory/InventoryExperienceV2.tsx), [VehicleWorkspaceV2](../src/features/inventory/VehicleWorkspaceV2.tsx) and [TransfersPageV2](../src/features/transfers/TransfersPageV2.tsx). |
| Professional, useful inventory rows; more vehicles visible on a phone | Implemented; final rendered matrix pending | Shared table keeps identity, copyable stock/VIN, mileage, equipment, operational context, source signals and actions together. Phone results use compact scan rows; opening Records does not stretch the result into several screens. See [InventoryTable](../src/features/inventory/InventoryTable.tsx), [mobile scan styles](../src/features/inventory/InventoryMobile.scan.css) and [desktop table styles](../src/features/inventory/InventoryTable.desk.css). |
| Three short, centered VDP facts with numeric dates and no USD prefix | Implemented; desktop layout inspected | One In-service/Est. in-service, Base MSRP and Inventory date group sits under Vehicle details beside the desktop photo and spans the phone surface. Duplicate overview date/MSRP rows were removed. OASIS dates take precedence; AutoCheck estimates fill missing dates for any make. Explicit USD displays as $, while unknown currency is not invented. Loaner dates also use MM/DD/YYYY. Capture 65 confirms the centered desktop composition without overflow. See [VehicleWorkspace](../src/features/inventory/VehicleWorkspace.tsx), [focused styles](../src/features/inventory/VehicleWorkspace.focused.css), [date resolver](../src/features/inventory/vehicle-in-service.ts) and [dense workspace tests](../src/features/inventory/VehicleWorkspace.dense.test.tsx). |
| Larger usable photos, clickable gallery, swipe and pinch | Implemented; final engine/device acceptance pending | Vehicle image is contained rather than cropped. The viewer supports thumbnails, previous/next, keyboard navigation, swipe, bounded pinch/zoom/pan, failure handling, Escape and focus restoration. See [VehicleGallery](../src/features/inventory/VehicleGallery.tsx) and [gallery tests](../src/features/inventory/VehicleGallery.test.tsx). Synthetic gesture tests do not certify a physical phone. |
| Clear location/hold/service context and consistent actions | Implemented; final visual acceptance pending | Overview operations use segmented facts and aligned action groups. Current location, expected destination and hold uncertainty remain distinct. Service navigation preserves its origin. See [VehicleWorkspace](../src/features/inventory/VehicleWorkspace.tsx), [focused styles](../src/features/inventory/VehicleWorkspace.focused.css) and [WorkspaceLink](../src/components/WorkspaceLink.tsx). |
| More Key equipment, specifications near the top, less scrolling and repetition | Implemented | Overview uses up to twelve available equipment highlights. Equipment places specifications before the finder; compact labels omit scan-only price/code clutter while full Records retains it. See [VehicleWorkspace](../src/features/inventory/VehicleWorkspace.tsx) and [shared equipment collection](../src/features/inventory/vehicle-equipment.ts). Inventory and the finder use the same deduplicated collection, yielding the same 19 items for the representative fixture. |
| Interactive equipment search with categories that can be skimmed together | Implemented | Search matches feature/package names and original codes. Default All displays all category sections together; category filters narrow them, and clear restores All. Long groups disclose their remaining items. No horizontal topic strip or per-feature source text is required to browse. Phone category controls are at least 44px. See [VehicleWorkspace](../src/features/inventory/VehicleWorkspace.tsx), [focused styles](../src/features/inventory/VehicleWorkspace.focused.css) and [finder regressions](../src/features/inventory/VehicleWorkspace.dense.test.tsx). |
| One sticker/equipment area, with group contents separate from optional upgrades | Implemented | A usable official sticker is preferred; vAuto equipment is an attributed fallback. Explicit equipment-group contents and group price are separate from optional equipment. Legacy flat lists are not assigned invented group membership. Ordered child features, prices, no-charge and trial qualifiers remain available. See [resource catalog](../src/features/inventory/vehicle-resource-catalog.ts), [VehicleResourceCards](../src/features/inventory/VehicleResourceCards.tsx) and the raw Records rendering in [VehicleWorkspace](../src/features/inventory/VehicleWorkspace.tsx). |
| Readable AutoCheck and complete material warnings | Implemented | Score/range, owners/use and key checks have structured presentation. Captured recall, insurance, title, accident and other material exceptions remain visible in compact previews; absent checks are not labeled clear. Full captured detail remains reachable. See [VehicleResourceCards](../src/features/inventory/VehicleResourceCards.tsx), [resource tests](../src/features/inventory/VehicleResourceCards.test.tsx) and [Records styles](../src/features/inventory/VehicleWorkspace.records.css). |
| Useful OASIS warranty/actions without misleading recalls or false zeroes | App implemented; external publisher delivery remains open | All captured actions, conditions and coverage types are retained. Partial positives are qualified; an empty legacy array does not prove no actions. In-service date precedence is explicit. See [resource catalog](../src/features/inventory/vehicle-resource-catalog.ts), [date resolver](../src/features/inventory/vehicle-in-service.ts) and the publisher gate below. |
| More useful OASIS technical data in Service | Implemented locally; external emission/rollout remains open | Fourteen optional source-text fields now survive parser/importer, raw app/resource types, adapter and integration projections: body/drive, paint/color code, engine/calibration, transmission, axle ratio/code, GVW, wheel/tire, SYNC and fuel. No unit or missing-value inference is added. See [parser](../scripts/lib/oasis-parser.mjs), [importer](../server/importer.mjs), [adapter](../src/app/adapters.ts) and [ServiceVehicleContext](../src/features/service/ServiceVehicleContext.tsx). |
| Desktop VDP sources available together without expanding each separately | Implemented | At desktop widths of 1100px and above, summary source sections open together and omit individual expand controls. Phone summaries retain compact disclosure. See [VehicleResourceCards](../src/features/inventory/VehicleResourceCards.tsx) and [component tests](../src/features/inventory/VehicleResourceCards.test.tsx). |
| Records that support quick comparison without repeated opening and excessive list growth | Implemented; targeted Firefox correction verified, final matrix pending | Records opens a desktop inspector or phone sheet beside the current vehicle context. Previous/Next changes the inspected vehicle while inventory rows remain stationary. Full vehicle, source selection and Close remain available. The focus correction passed 21 focused unit tests and three repeated Firefox checks. This supersedes the earlier inline expansion design. See [InventoryRecordsPanel](../src/features/inventory/InventoryRecordsPanel.tsx), [panel styles](../src/features/inventory/InventoryRecordsPanel.css) and [InventoryTable](../src/features/inventory/InventoryTable.tsx). |
| Rich Records Overview using available space | Implemented | Overview shows all three captured sources together: sticker MSRP/group plus six included highlights and up to three optional parent upgrades; AutoCheck score/range, owners, important checks and all material exceptions; OASIS actions, dates and captured coverage. Additional content remains in the full source. Highlights use full panel width on phones; a lone coverage term spans its row. See [VehicleResourceCards](../src/features/inventory/VehicleResourceCards.tsx), [styles](../src/features/inventory/VehicleResourceCards.css) and [tests](../src/features/inventory/VehicleResourceCards.test.tsx). |
| Coherent Service screen, clear actions, captured OASIS context | Implemented; final layout inspected and geometry checks pass | Larger shared gallery and compact identity header; opened from inventory, desktop status/history share a row with a full-width reference below. Raw coverage notes and typed warranty-check terms/status/remaining results stay distinct and visible. Waiting/In service/Ready, confirmed saves, dates, notes, conflicts, permissions and history remain supported. Ten browser cases passed across five projects; three engine projects passed the final geometry case at 320/390/1440px. Final desktop/mobile and 150% photo zoom captures were inspected without overflow. See [ServicePage](../src/features/service/ServicePage.tsx), [ServiceVehicleContext](../src/features/service/ServiceVehicleContext.tsx), [ServiceDesk styles](../src/features/service/ServiceDesk.css), [Service tests](../src/features/service/ServicePage.test.tsx) and [readiness policy](SERVICE_READINESS.md). |
| Useful manager views and correct Needs me ownership | Implemented; mobile preset selector inspected | Group operations uses authenticated identity, retained search/scope/sort, operational summaries and actionable destinations. Current location, requesting store and return destination are distinguished. The saved-view preset selector remains visible and wraps on phones with 44px targets, as inspected in capture 66. It selects existing presets; personal saved-view creation is not implemented or claimed. See [GroupOperations](../src/features/manager/GroupOperations.tsx) and [tests](../src/features/manager/GroupOperations.test.tsx). |
| Clear Moves workflow and reliable return to the originating task | Implemented; final acceptance pending | Queue/detail, searchable vehicle picker, direct/request workflows, authorized primary actions and return context are implemented. Next actions have stronger text hierarchy. Actual departure/custody evidence is distinguished from approvals, notes and estimates. See [TransfersPage](../src/features/transfers/TransfersPage.tsx), [TransferRequestWorkspace](../src/features/transfers/TransferRequestWorkspace.tsx), [TransferActionDialog](../src/features/transfers/TransferActionDialog.tsx) and [workspace tests](../src/features/transfers/TransferWorkspaceV3.test.tsx). |
| Compact Action center with purposeful next actions | Implemented; final acceptance pending | Task rows show relevant operational facts, direct next destinations and compact follow-up controls. Related tasks remain individually reachable, and server action permissions remain authoritative. See [OperationsQueue](../src/features/attention/OperationsQueue.tsx) and [tests](../src/features/attention/OperationsQueue.test.tsx). |
| Useful Updates, search and scope retention | Implemented; current mobile predictive search inspected | Updates shows actual before/after values, scoped counts, meaningful vehicle/service destinations and retained search/scope. Capture 67 shows a Howell-scoped Bronco suggestion with useful metadata, 44px result controls and no clipping. Missing or mismatched comparisons are not represented as zero change. See [InventoryUpdatesPage](../src/features/attention/InventoryUpdatesPage.tsx) and [tests](../src/features/attention/InventoryUpdatesPage.test.tsx). |
| Consistent navigation, search, shortlist and recovery across the app | Implemented; final regression matrix pending | Origin-aware links, URL-backed vehicle selection, access-scoped workspace memory, unsaved-edit protection, predictive search and retained verified data after refresh failure are implemented. Authorization failures clear protected state. The release log links these corrections to focused evidence; final combined verification remains separate. See [release defect log](RELEASE_1_3_0.md#defects-found-during-review) and [PredictiveSearchInput](../src/components/PredictiveSearchInput.tsx). |
| Upgrade the Chrome companion alongside the app | Implemented source changes; final companion inspection pending | Shared visual tokens, compact source signals, separate group/optional equipment, numeric dates and honest OASIS/source qualifications are present. See [companion panel](../extension/sidepanel/panel.js), [resources](../extension/sidepanel/lib/resources.mjs), [equipment](../extension/sidepanel/lib/equipment.mjs) and [tokens](../extension/sidepanel/tokens.css). App-only evidence does not establish companion acceptance. |

## Evidence boundary

- The final `pnpm check` after all layout changes passed repository/design
  guards, **141 unit/component files / 1,874 tests**, production build and
  companion archive. Output: `/tmp/inventory-conversation-final-check.log`.
- The final reference-facts/date/control patch passed 57 focused workspace,
  document and date-resolver tests plus TypeScript. Resource highlights had
  46 focused source-component tests. These do not establish visual approval.
- The latest complete cross-browser matrix recorded **120 passes and five
  intentional skips** across Chromium desktop/Android, Firefox desktop/narrow
  and WebKit desktop/mobile. It covers responsive inventory, quick Records,
  equipment filters, gallery swipe/pinch paths, Service/OASIS setup, errors and
  recovery, drafts, native Back/Forward, Moves and Action center workflows.
  Service also passed ten cases across five projects; the final full-width
  geometry case passed Chromium/Firefox/WebKit, each checking 320/390/1440px
  (`/tmp/inventory-service-full-width-check.log`). See
  [release evidence](RELEASE_1_3_0.md#current-validation-evidence).
- The technical OASIS pipeline passed 141 tests across five focused suites and
  TypeScript, including bounded text, short codes, absent values and exclusion
  of unsupported owner/raw fields. Demo illustrations and source values are
  explicitly synthetic.
- Actual synthetic screenshots have informed the implementation. Superseded
  inline-record screenshots are not evidence for the current inspector. A
  source or test audit cannot approve uninspected screens, physical-device
  behavior, employee sign-in or real source integrations.
- Final inspected captures:
  Service desktop composition, 68,
  full-width reference body, 62,
  Service mobile, 63,
  verified 150% photo zoom, 64,
  centered desktop facts, 65,
  manager presets on mobile, 66
  and Updates predictive search, 67.
  No overflow/clipping was observed in these captures. They remain local
  artifacts. Capture 57 was at 100% and is not zoom evidence; earlier desktop
  side-column layouts and phone captures are superseded.

## Remaining completion and delivery gates

- [x] Complete the Service structure and OASIS context implementation, including
  the larger shared gallery, compact header and full-width desktop reference.
- [x] Correct Firefox focus timing and pass the focused unit/repeated-browser
  regressions.
- [x] Record the passing post-layout combined check, Service geometry cases and
  complete cross-browser matrix. Preserve the five intentional skipped cases as
  exclusions from coverage.
- [ ] Complete the remaining rendered screen/state checklist, including shell,
  inventory/VDP, Moves, Control center feeds/audit, companion and resilience.
  The centered VDP facts, loaner dates, shared equipment counts, Updates search,
  touch targets and manager preset visibility are implemented; reconcile their
  final rendered evidence rather than treating them as missing functionality.
  Earlier completed inspections are listed in the
  [release screen matrix](RELEASE_1_3_0.md#screen-and-workflow-review-matrix).
- [ ] Complete PR review and exact-commit CI, including acceptance of the
  recorded browser evidence and remaining screen/state review boundaries.
- [ ] Deliver and verify the compatible OASIS capture-evidence fix in the
  separate `inventory-scripts` Windows publisher. The isolated branch is
  `codex/oasis-capture-evidence`; the deployed copy is not yet verified or
  updated. Until then, the app intentionally treats legacy empty action arrays
  as unconfirmed. Also verify/update emission of the fourteen technical fields,
  deploy compatible validators and rebuild/republish; local capture retention
  alone does not prove production delivery.
- [ ] Complete authorized deployment of both Workers and monitored live checks,
  retaining existing access restrictions and rollback preparation. Local
  implementation is not production deployment.
- [ ] Before broader employee rollout, complete signed-in desktop/phone
  acceptance, approved role/store assignments and revocation checks,
  independent account/key-loss recovery and key/retention review, observation
  of a subsequent scheduled source-to-cloud publication, and pilot operational,
  accessibility/performance and monitoring review. Full accessibility and
  physical-device signed-in acceptance are not established by emulation. These are existing
  [private-release runbook requirements](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md),
  not new product modules.

This bounded audit found no additional confirmed missing product request beyond
the completion/delivery gates above. That is not a
claim that every screen is visually approved or that the software is ready for
unrestricted production use. Final proof belongs in
[RELEASE_1_3_0.md](RELEASE_1_3_0.md) after the integration owner finishes validation.
