# Overview — executable spec (replaces Group operations) — revision 2

_For Joe (owner-maintainer). Written 2026-09-23 against branch `plan/phase-1-safety-hygiene` (HEAD d72342b). Revision 2 applies the gate critique in full; every statement below is grounded in the files named, and line numbers are anchors (±10), not a contract. This spec composes with the improvement plan (`~/.claude/plans/can-you-go-through-glittery-graham.md`): plan L105 keeps the Inventory updates page; L106 makes M12 "replace Group operations with Overview"; Overview lands after M11 (single filter state) and M13 PR B (ScopeSwitch, vocabulary) and before M17 (docs). Moves are O1–O9 and ship in two slices (§17)._

---

## 0. One-paragraph summary

One page, `/overview`, scoped by the existing role/store context, that answers "where is every unit, what state is it in, what has and has not been serviced, and what needs a decision" for the whole group (group manager / GM / owner), for one store (store manager) and — read-only — for salespeople and transport roles. The server computes one `overview` projection per bootstrap from the same snapshot it already builds (`server/service-core.mjs` `bootstrap()` L1892), role-filtered like everything else, day-granular so the existing ETag/304 keeps working. Every number on the page is a link to the filtered list behind it (Inventory, Vehicle moves, Action center, Service status). A schematic SVG "store board" shows the four stores with counts on pins and arrows for moves in progress; it is configuration, not a map. A new app-owned, append-only **disposition ledger** (D1 migration `0010`, mirroring `vehicle_service_events`) lets managers record keep / sold pending / delivered / wholesale / transfer out per vehicle, shown beside — never replacing — the imported manager-log evidence. `/manager` redirects to `/overview`; `src/features/manager/*` is deleted. **Slice A** (O1, O3, O4, O7, O9) ships the overview, deep links, service metrics, print and the redirect with no D1 change and no product-rule re-pin; **Slice B** (O2, O5, O6, O8) carries the ledger, the dialog, the board and the approvals they need.

---

## 1. Goals and non-goals

### Goals
1. Group leadership sees inventory at each store, where it physically is (by the app's own custody ledger, with confidence), hold state, service state, dispositions and key exceptions on one page, at 1440/1320/1024/390.
2. A store manager sees, in the first mobile viewport, their store's counts and the units that are away from home with **days away**, **custody**, **return due/overdue** and **unaccounted** flags.
3. A salesperson sees the same picture without write controls; transport roles see a movement-only variant.
4. Service reporting per store and group: what is Ready / In service / Waiting; days since receipt; receipt → service start; time in service; receipt → Ready; aged waiting list; one click to the vehicle's Records tab (AutoCheck, OASIS, sticker, invoice, Ford service history) from every service row **and every where-list row**, plus a per-vehicle "records captured" count.
5. Managers record dispositions in the app (audited, idempotent, versioned); the imported manager log stays visible as separate evidence.
6. Printable one-page daily snapshot.
7. Numbers are deep links; the Inventory, Moves, Action center and Service lists accept the new filters.

### Non-goals (explicit)
- No per-vehicle map, GPS, telematics or map tiles. The board is a schematic with configured positions.
- No write to DealerMail, CDK, DealerOn, AutoCheck, OASIS or the public site. Dispositions are the app's own record and are never inferred from a listing disappearing, from a `sale_confirmed`/`delivery_confirmed` move event, or from the imported manager log.
- No new runtime dependency, no new global CSS layer, no state/fetch library, no client persistence of the bootstrap.
- No change to hold semantics: `No current DealerMail hold found` (pinned in `src/features/inventory/inventory-utils.ts` L261) is never rendered as a count label and never treated as "available".
- No integrations-API exposure of dispositions or the overview in this workstream (open question 9).
- No change to the `/` landing route (open question 3).

---

## 2. Role matrix

Roles (`src/types.ts` `UserRole`; `server/workflow.mjs` L4 `USER_ROLES`, L6 `HOLD_EVIDENCE_ROLES = {sales, manager, group_manager}`): `sales`, `manager`, `coordinator`, `porter`, `driver`, `group_manager`. Facts the server already enforces and that the Overview inherits unchanged:

| Fact | Source | Rule |
|---|---|---|
| Private hold evidence (`privateEvidence`, `hold.reason`, `loaner.rawAlert`, service `notes`, service `history`) | `roleContext.canViewPrivateEvidence` = `HOLD_EVIDENCE_ROLES` | Never reaches coordinator/porter/driver. |
| `hold.primarySalesperson` | `holdSummary` (service-core L317-360) | Withheld from driver/porter/coordinator. |
| Transfer visibility | `transferVisible` (L1259-1266) | group_manager: all; manager/coordinator/sales: rows related to their store; porter/driver: only assigned. |
| Group physical location without transfer link | `vehicleView` `groupLocationVisible = simple && role in {sales, manager, group_manager}` (L886-888) → `physicalLocationAuthority` over all rows | sales/manager/group_manager get `movement.{state, currentLocation, lastConfirmedAt, locationConfidence, departedAt}` for every vehicle; transport roles only for visible transfers. |
| Service write | `serviceReadinessView.canManage` = group_manager or manager whose store === `serviceStore(vehicle)` (`server/service-readiness.mjs` L94-104) | reused verbatim. |
| Attention actionability | `attentionActionability` (L1475) | other store → informational; identity review → managers only. |
| Ford invoice | `canViewFordInvoice = authenticatedRole in {sales, manager, group_manager}` | unchanged. |

**Viewer-relative counts.** `bootstrap()` builds `stores`, `transfers` and (in this spec) `overview` from `visibleTransferRows` (L1904, filtered by `transferVisible`). A Howell manager sees Fowlerville's `returnOverdue`, `inTransit`, board flows and return verification only for rows related to Howell, so their Fowlerville card can show fewer moves than Fowlerville's own manager sees — exactly as today's stores summary does. Group-scope cards for stores other than the viewer's carry the label **"Moves as visible to you"** under the movement counts; group_manager cards carry no label (they see all rows).

Overview matrix (what each role gets; **W** = may write):

| Section | group_manager | manager | sales | coordinator | porter / driver |
|---|---|---|---|---|---|
| Scope switch (My store / All stores) | default All stores | default My store; All stores allowed | default My store; All stores allowed | My store only (their related moves) | My store only (their assigned moves) |
| Store cards (all 4 in group scope) | full | full | full | movement-only card set (On lot / Away / Visiting / In transit / Return overdue / Unaccounted) | movement-only card set |
| Return-home verification on the home store card | yes, action link | yes (own store), action link | yes, read-only | read-only | read-only, only assigned |
| Store board | yes | yes | yes | yes (arrows only for visible moves) | yes (assigned moves) |
| Where-is-my-inventory list (with Records link per row) | all vehicles | all vehicles in scope (other-store rows carry no transfer link when withheld) | same as manager | visible moves only | assigned moves only |
| Exceptions | all kinds | all kinds; identity review actionable only for own store | all kinds read-only; identity review informational | movement kinds only | movement kinds only |
| Service metrics + aged list | all stores | all stores (write only own store via Service page) | all stores read-only | not rendered | not rendered |
| Dispositions | read all incl. note/updatedBy, **W** any vehicle | read all incl. note/updatedBy, **W** vehicles whose owner store === own store | read all incl. note/updatedBy (same rule as hold evidence: `canViewPrivateEvidence`), no write | code + date only (no note, no actor name) | code + date only |
| Print daily snapshot | yes | yes | yes | yes (movement-only) | yes |

Decision (was contradictory in revision 1): **sales sees disposition notes and `updatedBy`**, consistent with `HOLD_EVIDENCE_ROLES` — `dispositionView` gates both on `context.canViewPrivateEvidence`, and the dialog helper text says "Notes are visible to sales and managers." The note is manager-to-manager operational text; the server guard in §6.2 keeps customer names out.

Redaction rule for the projection: the projection is built from the role-filtered `vehicles` and `visibleTransferRows` that `bootstrap()` already produced, never from `state.allTransferRows`, so it cannot carry more than the vehicles/transfers arrays already do. No free text from any source ever appears in the projection: only codes, dates, counts, store names, VINs and stock numbers.

---

## 3. Information architecture and layout

### Route, nav, redirect
- New lazy route `/overview` → `src/features/overview/OverviewPage.tsx` (register in `src/app/routeModules.ts` next to `loadAttentionPage` L53; add to `preloadRoute`; `src/App.tsx` L24-33 `<Route path="/overview" element={<OverviewPage key={`${currentUser}:${role}:${homeStore}`} />} />`). Available to every role.
- `/manager` → `<Navigate to="/overview" replace />` (`src/App.tsx` L31 replaces the `ManagerPage` element; keep the route for one release so bookmarks work; drop the `ManagerPage` import at L5). `workspaceReturnLabel` in `src/features/inventory/inventory-navigation.ts` L111: replace the `/manager` → 'Back to group operations' case with `/overview` → 'Back to Overview'.
- Nav (`src/app/AppShell.tsx` `NAV_ITEMS` L41-46 + `ADMIN_NAV_ITEM` L50-55): desktop rail order for every role, in full: **Overview · Inventory · Vehicle moves · Action center · Inventory updates · Service status** (· **Control center** for group_manager). Inventory updates stays per plan L105. Icon: `LayoutDashboard` is Control center's; use `Gauge` for Overview (lucide, already bundled via `VehicleWorkspace.tsx` L39). Mobile rail (`mobileNavigationIds` L121-123, today `['admin','inventory','moves','service']` for group_manager and `['inventory','moves','today','updates']` otherwise): **Overview · Inventory · Moves · Actions · More** for every role; **Inventory updates, Service status and Control center all live under More** (`mobileUtilityItems` L127 already collects whatever is not in the rail). This amends M13's "Inventory, Moves, Actions, More" by adding Overview first — open question 4. Delete the `utility-manager-link` block (L293-295) and `canSeeManager` (L118). Update `src/app/AppShell.test.tsx`: L162 (Manager overview link → remove or assert absent), L189/L215 (Inventory updates href stays `/updates`; the L208 comment about which roles omit it from the rail changes to "every role"), L235 and L284 (`/manager` entries → `/overview`).
- Delete: `src/features/manager/GroupOperations.tsx` (776), `ManagerPage.tsx` (69), `manager.css` (290), `types.ts`, `index.ts`, `GroupOperations.test.tsx`; in `src/styles/pages.css` L1-7 the rule `.manager-page, .transfers-page, .transfer-request-page { min-width: 0; max-width: 1540px; margin: 0 auto }` is shared — **remove only the `.manager-page` selector, keep the rule**; the `"src/features/manager/manager.css": { "smallText": 0, "rawColors": 79 }` entry at `scripts/design-system-baseline.json` L33 (same commit, per M12); `loadManagerPage` at `routeModules.ts` L54.

### Page skeleton (one component tree, one stylesheet `src/features/overview/overview.css`, class prefix `ov-`)
```
<section class="ov-page" aria-labelledby="ov-title">
  <header class="ov-header">
    <h1 id="ov-title">Overview</h1>
    <ScopeSwitch homeStoreName value onChange />          ← M13 PR B component (does not exist yet: grep finds no export); until it lands, copy the local pattern at ServicePage.tsx L259 (`role="group"`, two aria-pressed buttons)
    <p class="ov-asof" role="status">As of 09/23/2026 · Holds current · Website current · Locations from the move ledger</p>
    <button type="button" class="ov-print">Print daily snapshot</button>
  </header>
  <SourceWarning meta />                                    ← existing src/components/SourceWarning.tsx
  <section class="ov-stores" aria-label="Store summary">   ← 1 card (My store) or 4 cards (All stores)
  <section class="ov-board" aria-labelledby="ov-board-title">   ← SVG schematic + filters (Slice B; Slice A renders the section with the filter chips only)
  <section class="ov-where" aria-labelledby="ov-where-title">    ← Where is my inventory (list)
  <section class="ov-exceptions" aria-labelledby="ov-exceptions-title">
  <section class="ov-service" aria-labelledby="ov-service-title"> ← hidden for transport roles
  <section class="ov-dispositions" aria-labelledby="ov-dispositions-title"> ← Slice B; managers: ledger summary + recent; others: counts only
  <footer class="ov-print-only">…</footer>
</section>
```

### Viewports (canonical list: 390×844, 1024×768, 1320×820, 1440×900)
- **1440×900** (nav rail 188px, `--nav-width` in `src/styles/tokens.css`): content width ~1180. Store cards 4-up (grid `repeat(4, minmax(0,1fr))`, gap `var(--ifx-space-4)`). Row 2: board (col 1, 40%) beside "Where is my inventory" (60%). Row 3: exceptions (1/3) beside service metrics (2/3). Row 4: dispositions full width. Cards ≤ 300px tall; ≥ 5 rows of the away list visible without scrolling the page past the second row.
- **1320×820**: same as 1440; card counts wrap to a 2-column dl inside each card.
- **1024×768**: cards 2×2; board full width above the list; exceptions above service; no page-level horizontal scroll (use `@media (max-width: 1180px)`, the existing tablet switch in `shell.css`).
- **390×844**: single column in this order: header (h1 + ScopeSwitch under it, 44px targets) → as-of line → SourceWarning → the home store card (group scope: four cards stacked, home store first) → "Where is my inventory" (first 5 rows, "Show all n") → `<details class="ov-board-details">` "Store board" (closed by default; the SVG scales to 100% width, `viewBox="0 0 100 70"`) → exceptions → service (counts row + aged list first 5) → dispositions. **First mobile viewport (≈700px of content after the 72px top bar and 70px bottom rail)** must contain: title, scope switch, as-of line, the home store card with all eight core counts as a 2-column list (On lot, Away, Visiting, In transit, Holds, Waiting for service, Unaccounted, Return overdue), and the first two rows of the away list with vehicle name, "n days away", custody, return due and the Records link. Card body text 15px; metadata 12–13px; every number is an `<a>` with min-height 44px (padding, not font size).

### Store card content (all counts are links; see §8 for hrefs)
```
Howell                                   Home store · 1 of 4
On lot 41 (source-reported 12) · Away 3 · Visiting 2 · In transit 1
Holds 6 (2 past expected) · Waiting for service 9 · In service 2 · Ready 33
Listed 60+ days 5 · 90+ days 2 · Unaccounted 1 · Return overdue 1
Records incomplete 8
Dispositions · Sold pending 2 · Wholesale 1 · Transfer out 0        ← managers/sales; hidden for transport roles; Slice B
Return-home verification
  ● 2024 F-150 Lariat · #W5863Q · returning from Fowlerville · due 09/22 · Overdue → Confirm back home
  ✓ Back home 09/21 · 2 more this week → Vehicle moves
Moves as visible to you                                              ← only on other stores' cards for non-group_manager viewers
```
Numbers never carry a color as the only signal; "Overdue"/"past expected" are text. A zero renders as "0" (link disabled, `aria-disabled="true"`), never hidden, so the eye can scan columns. **The basis word is always rendered**: "On lot 41 (source-reported 12)" means 12 of the 41 have no move ledger and rest on the website's store (`sourceReportedLocation` = `publicStore`, service-core L1026); "Away"/"Visiting" rows with `custodyBasis: 'source_reported'` show "source-reported" in the row so a listing store is never read as physical location.

---

## 4. Store board (SVG schematic) — Slice B (O5)

- Component `src/features/overview/StoreBoard.tsx`; config `src/features/overview/store-board-config.ts`:
  ```ts
  export interface StoreBoardPosition { store: StoreName; x: number; y: number; anchor: 'start' | 'middle' | 'end' }
  /** Approximate relative positions on an abstract board (viewBox 0 0 100 70). Not geographic coordinates. Joe confirms. */
  export const STORE_BOARD_POSITIONS: readonly StoreBoardPosition[] = [
    { store: 'Fowlerville', x: 16, y: 28, anchor: 'start' },
    { store: 'Howell',      x: 36, y: 24, anchor: 'start' },
    { store: 'Ford Detroit', x: 78, y: 52, anchor: 'end' },
    { store: 'Lincoln',     x: 86, y: 62, anchor: 'end' },
  ]
  ```
  Defaults encode only "Fowlerville west of Howell; the two Detroit-area stores south-east". No addresses, no distances, no basemap. `InventoryGroupStore.distanceMiles?` exists in `src/features/inventory/types.ts` L30 but `groupStores()` (`adapters.ts` L772-776) never fills it; if Joe later supplies distances they may annotate the arrows — out of scope now.
- Rendering: inline `<svg role="img" aria-labelledby="ov-board-title ov-board-desc" viewBox="0 0 100 70">`, stroke `var(--ifx-border-control)`, pins as SVG `<a href>` (react-router `<Link>` cannot wrap SVG children; a delegated `onClick` calls `navigate` for same-origin hrefs) containing a `<circle r="5">` filled `var(--ifx-neutral-0)` with stroke `var(--ifx-oem-accent)` for the home store and `var(--ifx-neutral-500)` otherwise, and a `<text>` count. Each pin has `<title>Howell · 41 on lot · 3 away · 1 in transit</title>`.
- Arrows: one `<path>` per `overview.board.flows[]` entry with `marker-end` arrowhead; outbound solid, return dashed (`stroke-dasharray="2 1.5"`), planned (approved, not departed) dotted; a `<text>` count at the midpoint; `<title>` "2 vehicles Howell → Fowlerville · in transit". Filter chips above the board (Counts on pins: On lot | Away | Holds | Waiting for service | Unaccounted) change the pin number; the chip state is local and also applied to the "Where is my inventory" list (one `OverviewFilter` state shared by board + list; Slice A ships the chips and the list, Slice B adds the SVG).
- Accessibility: a visually hidden `<table class="sr-only">` (the existing utility at `src/styles/global.css` L491; **do not add** an `.ifx-sr-only`) mirrors pins and flows; the SVG is not the only representation. Pin hit area: an invisible `<circle r="9">` (~44px at 1440) behind each pin. No hover-only information.
- Mobile: the board lives inside `<details>`; when opened it renders at 100% width; SVG text `font-size: 4` in viewBox units scales — assert ≥ 12px rendered at 390 (viewBox width 100 → 358px wide → 4 units ≈ 14px).

---

## 5. Metric definitions (exact, with source fields and events)

All durations are whole days between calendar days in `meta.timezone` (`dateInTimeZone` L142, `daysBetween` L153 in service-core; both exported via `serviceInternals`). `asOfDay = dateInTimeZone(currentNow, meta.timezone)`. `daysBetween` **clamps at 0 and returns `null` for non-`YYYY-MM-DD` input** (L154-162), so every "ordered" check below compares ISO-day strings first (`a <= b`) and never relies on a negative difference. No metric depends on the minute of `now`, so the bootstrap ETag (`jsonRevalidated` worker.mjs L266, `sendJsonRevalidated` api.mjs L55) stays stable within a day unless the ledger or a source changes. The only instant-level comparisons are the existing `return_due_at < now` (`storeSummaries` L1386-1394) and `dueAt < now` flags.

### 5.1 Custody and location (per vehicle)
Inputs: `vehicle.homeStore`, `vehicle.sourceReportedLocation` (= `publicStore`, L1026), `vehicle.crmStore`, `vehicle.movement.{state, currentLocation, locationConfidence, departedAt, lastConfirmedAt, returnDueAt, transferId}` as produced by `vehicleView`.

| custody | rule |
|---|---|
| `conflict` | `movement.locationConfidence === 'conflicting'` or `movement.state === 'location_exception'` (physicalLocationAuthority tie) |
| `in_transit` | `movement.currentLocation === 'In transit'` |
| `away` | ledger state (`movement.state !== 'source_reported'`) and `currentLocation` is a store ≠ `homeStore`; **or** `movement.state === 'source_reported'` and `sourceReportedLocation !== homeStore` (`custodyBasis: 'source_reported'`) |
| `on_lot` | ledger says `currentLocation === homeStore` (`custodyBasis: 'ledger'`), or no ledger and `sourceReportedLocation === homeStore` (`custodyBasis: 'source_reported'`) |

`visiting` is a store-perspective count, not a custody value: vehicles whose `currentLocation` (ledger) or `sourceReportedLocation` (no ledger) equals the card's store while `homeStore` ≠ that store. `returnLeg: 'return'` when `movement` derives from a row with `movement_status === 'return_in_transit'` (set by `return_started`, workflow.mjs L543-552); otherwise `'outbound'`.

### 5.2 Days away
`daysAway = daysBetween(dateInTimeZone(new Date(movement.departedAt), tz), asOfDay)` when custody ∈ {away, in_transit} and `departedAt` is present; otherwise `null` with `daysAwayBasis: 'unknown'`.
`movement.departedAt` comes from `movementDepartureAt(row, events)` (service-core L666-683): the earliest event after the last `returned_home` among `direct_move_recorded`, `vehicle_departed`, `picked_up`, `in_transit`, a destination-tagged simple outcome (`customer_showing`, `sale_outcome_pending`, `sale_confirmed`, `not_sold` with `to_location_id === destination_store_id`), or `return_started` from the destination. It is `undefined` for a request that is only `requested`/`approved` (no physical evidence yet), for unknown/conflicting confidence, and while the vehicle is home. **Receipt back home is `returned_home`** (`workflowPatch` L702-713: `current_location_id = home`, `movement_status = 'returned_home'`, simple mode also `status = 'closed'`); it resets the departure clock. Nothing else resets it.

### 5.3 Unaccounted
`unaccounted: null | { reason, days? }`, first matching rule wins; `N = thresholds.unaccountedAfterDays` (default **7**; one threshold, the separate `staleConfirmationDays` of revision 1 is dropped), server constant `OVERVIEW_THRESHOLDS` in `server/overview-summary.mjs`, published in the payload so client copy can say "not confirmed for 7+ days":
1. `location_conflict` — custody `conflict`.
2. `source_conflict` — `vehicle.crmStore && vehicle.crmStore !== vehicle.publicStore` (the rule `storeSummaries` already counts as `locationExceptions`, L1396-1398).
3. `no_app_record` — custody `away` with `custodyBasis: 'source_reported'` (the website lists the unit at another store and the app has no move for it).
4. `stale_confirmation` — custody ∈ {away, in_transit} and `daysBetween(dateInTimeZone(new Date(movement.lastConfirmedAt ?? row.requested_at), tz), asOfDay) >= N`; `days` carries that number.
Vehicles on their home lot with no ledger are **not** unaccounted (the app has nothing to contradict; the card shows them inside "On lot · source-reported n").

### 5.4 Return due / overdue
`returnDueAt = movement.returnDueAt` (present only when the transfer is visible to the caller). `returnOverdue` uses the exact rule from `storeSummaries` (L1386-1394): `isActiveTransfer(row)`, `return_required`, `return_due_at` and `new Date(return_due_at) < now`, `status` not in `RETURN_COMPLETE_STATES` {returned_home, closed} (L28) nor `RETURN_PAUSED_STATES` {sale_confirmed, delivery_confirmed} (L32), `movement_status` not in `RETURN_COMPLETE_STATES`. Attributed to the **home** store. `receivedHomeAt` (ISO day) is emitted when the latest `returned_home` event is within `thresholds.recentReceiptDays` (7) of `asOfDay`, so the card's "Back home 09/21" line and the return-verification list are derived client-side (§7.4) without a second server list.

### 5.5 Holds
Two computations exist today and disagree: `storeSummaries.currentHolds` (L1402) counts every `hold_vehicle_snapshots` row for the store, while `holdSignalSummaries` (L1683-1710) skips rows with `active_hold_count <= 0`; the importer writes a row for every vehicle with a `holdRecord` and `active_hold_count = active.length` (`server/database.mjs` L407-421), which can be 0. **Definition: `holds` per store = `holdSignals[store].activeHoldVins`** (rows with `crm_store_id === store` and `active_hold_count > 0`), so the card equals the Action center. `holdsPastExpected` = `holdSignals[store].pastExpected` (same rows, `dateIsBeforeReport(expected_date, reportDate)` L164). Per vehicle the projection emits `holdActive: true` / `holdPastExpected: true` from **the same rows** (not from `hold.state`), so the Inventory `view=holds` list (§8) equals the card by construction. Per-row chips render the server's `hold.label` verbatim (`holdSummary` L317-360; states `primary | multiple | none_observed | stale | unknown`); `none_observed` is never counted anywhere as "available" and no count is ever derived from label text. Caveat shared with `meta.heldVinCount` (`dataset.holdRows.length`, L1311): it counts rows, not active holds, and the Overview never displays it.

### 5.6 Service
Inputs: `vehicle.serviceReadiness` (`serviceReadinessView`, service-readiness.mjs L106-129): `status`, `readinessBasis`, `updatedAt`, `store`, `readinessEvidence`; the manager row itself `state.serviceEventsByVin.get(vin)?.at(-1)` (`service_entered_at`, `completed_at`, `updated_at`); `state.serviceIntakeByVin.get(vin)?.first_arrival_date` (D1 `vehicle_service_intake`, migration 0008; Node SQLite same table, database.mjs L255); `vehicle.inventoryDate`.

**Date source rule (fixes the revision-1 gating bug).** `serviceReadinessView` falls back to Ford/AutoCheck evidence dates for `serviceEnteredAt`/`completedAt` (L115-116) *even when* a manager row records `needs_service` with null dates, so the view's dates cannot be used blindly. The projection uses:
- `readinessBasis === 'manager_updated'` → **only the row's dates**: `enteredAt = isoDay(row.service_entered_at)`, `completedAt = isoDay(row.completed_at)`.
- `readinessBasis ∈ {ford_service_history_inspection, autocheck_post_intake_inspection}` → `readinessEvidence.inServiceDate` / `readinessEvidence.readyDate ?? readinessEvidence.inspectionDate`.
- any other basis → no dates.

Then, **gated on status, not on date presence**:
- `arrivalDate = earliest(isoDay(intake.first_arrival_date), isoDay(vehicle.inventoryDate))` (same rule as `intakeDay`, L36-46); `arrivalBasis = 'intake' | 'listing_date' | 'unknown'`.
- `serviceStatus = status` normalized to `needs_service | in_service | serviced` (`src/lib/service-readiness.ts` `serviceWorkflowStatus`).
- `waitingDays` (status `needs_service` only) = `daysBetween(arrivalDate, asOfDay)`.
- `receiptToStartDays` (status ∈ {in_service, serviced} only) = `daysBetween(arrivalDate, enteredAt)` when both present and `arrivalDate <= enteredAt`; else null.
- `inServiceDays`: status `in_service` → `daysBetween(enteredAt, asOfDay)`; status `serviced` → `daysBetween(enteredAt, completedAt)` when both present and `enteredAt <= completedAt`; else null.
- `receiptToReadyDays` (status `serviced` only) = `daysBetween(arrivalDate, completedAt)` when both present and `arrivalDate <= completedAt`; else null.
- `sinceServiceUpdateDays` = `daysBetween(dateInTimeZone(new Date(row.updated_at), tz), asOfDay)` when a manager row exists (`updated_at` is an ISO timestamp, never a bare day).
- `dateOrderIssue: true` when any of `enteredAt < arrivalDate`, `completedAt < arrivalDate`, `completedAt < enteredAt` holds as an ISO-day string comparison (the clamp in `daysBetween` would otherwise read a reversed pair as 0).
- Store attribution: `serviceReadiness.store` (`serviceStore()` L94-101: verified current location if a store, else home store).
- Aggregates per store and group: counts by status; counts by `readinessBasis` (`manager_updated`, `ford_service_history_inspection`, `autocheck_post_intake_inspection`, `new_arrival`, `unconfirmed`, `legacy_review`); **medians** (not means) of `receiptToStartDays`, `inServiceDays` (in_service vehicles only, i.e. "currently in service"), `receiptToReadyDays`, each with `n`; `agedWaiting14`, `agedWaiting30` counts (`thresholds.serviceWaitingDays = [14, 30]`); `arrivalBasis` distribution so the page can say "12 of 41 arrival dates are listing dates, not intake".
- **M15 invariant (O1 and a note on M15):** readiness is evaluated on the **full** vehicle view before any list projection. `fordServiceReadinessEvidence` reads `fordOasis.serviceHistory.{certifiedInspection, recentInspection, recentRepairOrders}` (service-readiness.mjs L65-84) and `vehicleFromSnapshot` computes `vehicleView(source, …, options)` *then* `serviceReadinessView(vehicle, …)` (service-core L1825-1830). M15's `listProjection: true` cuts exactly those bodies, so either (a) `vehicleFromSnapshot` computes readiness first and applies the projection cut afterwards (recommended: move the cut out of `vehicleView` into a `projectListView(vehicle)` step after L1830), or (b) M15's keep-list includes the inspection metadata. Test: a Ford vehicle with a confirmed Certified Blue Oval order keeps `status: 'serviced'` and `readinessBasis: 'ford_service_history_inspection'` under `listProjection: true`, and the Overview counts it as Ready.
- **Honest limits (rendered as a footnote on the section):** intake dates exist only for vehicles whose `new_arrival` was observed after migration 0008 shipped; older inventory falls back to the public listing date, which can lag physical receipt; evidence-based Ready (Certified Blue Oval / AutoCheck post-intake inspection) carries the source's dates, not the store's; the app never invents a service date; `daysListed` is listing age, not lot age.

### 5.7 Aged
`vehicle.daysListed` is `daysBetween(publicRecord.inventory_date, reportDate)` for public rows but `crmRecord.inventoryAgeNumber` (CRM age, not listing age) for CRM-only rows (L1000-1002). **`agedBucket` (60 | 90) is emitted only when `vehicle.publicListing === 'listed'`** (the code, never a label; `PublicListingCode` `src/types.ts` L12), from `daysListed >= 90 ? 90 : daysListed >= 60 ? 60 : null`. Pre-listing / CRM-only rows are excluded from "Listed 60+ days" and carry `agedBasis: 'crm_age'` with no bucket, so the card label is true.

### 5.8 Records captured (Joe's "data pulled on each vehicle")
Per vehicle `records: { autoCheck, oasis, sticker, invoice, fordHistory }` booleans from `vehicle.autoCheckReport?.dataState === 'current'`, `vehicle.fordOasis?.dataState === 'current'`, `vehicle.windowSticker?.dataState === 'current'`, `vehicle.fordInvoice?.dataState === 'current'` (`src/types.ts` L50-54, L544), `vehicle.fordOasis?.serviceHistory?.historyCaptured === true` (L235, L282). `recordsApplicable` = 5 for Ford/Lincoln makes (`/^(ford|linc|lincoln)$/i`, the test service-readiness.mjs L48/L66 already uses), else 3 (autoCheck, sticker, invoice). `recordsCaptured` = count of true among applicable. Store card "Records incomplete n" = vehicles with `recordsCaptured < recordsApplicable`; every where-list and service row shows "Records 4/5" and links to the workspace Records tab (`WorkspacePanel id="data"`, `VehicleWorkspace.tsx` L2492).

### 5.9 Dispositions (Slice B)
Per vehicle `vehicle.appDisposition` (§6). Counts per store by **owner store** (§6.2 `dispositionOwnerStore(source)`): `keep`, `sold_pending`, `delivered`, `wholesale`, `transfer_out`, `none`.

### 5.10 Exceptions (server list, §11)
Kinds and rules: `location_conflict`, `source_conflict`, `no_app_record`, `stale_confirmation` (all from §5.3), `return_overdue` (§5.4), `hold_past_expected` (§5.5), `identity_review` (`managerIdentityReviewRecord` L242, count only), `records_incomplete` (§5.8), `service_date_order` (§5.6 `dateOrderIssue`; data-quality), and in Slice B `listed_but_delivered` (`appDisposition.code === 'delivered'` and `vehicle.publicListing === 'listed'` and `daysBetween(effectiveDate, asOfDay) >= thresholds.listedAfterDeliveredDays` default **3**) and `delivered_move_no_disposition` (a visible transfer with `delivery_status === 'delivery_confirmed'` and `appDisposition.code !== 'delivered'`; managers only; **a prompt to record, never an inference**).

---

## 6. Disposition ledger — Slice B (O2, O6)

### 6.1 Migration `cloudflare/migrations/0010_vehicle_dispositions.sql` (single file, applied remotely by itself per `docs/DEPLOY_CHECKLIST.md` L17-24; never via `wrangler d1 migrations apply`)
```sql
-- App-owned manager dispositions. A row is the app's own recorded decision;
-- it never changes DealerMail, CDK, the public listing, the imported manager
-- log or physical location, and is never inferred from any of them.
CREATE TABLE IF NOT EXISTS vehicle_disposition_events (
  id TEXT PRIMARY KEY,
  vin TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  disposition TEXT NOT NULL CHECK (disposition IN ('keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out')),
  effective_date TEXT,                       -- YYYY-MM-DD, never in the future
  destination_store TEXT CHECK (destination_store IS NULL OR destination_store IN ('Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln')),
  note TEXT,                                 -- private; no customer names (policy + server guard + redaction)
  updated_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_user_id TEXT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('manager', 'group_manager')),
  store_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (vin, version),
  UNIQUE (vin, idempotency_key)
);
CREATE INDEX IF NOT EXISTS vehicle_disposition_events_vin_idx ON vehicle_disposition_events(vin, version DESC);
CREATE TRIGGER IF NOT EXISTS vehicle_disposition_events_no_update
BEFORE UPDATE ON vehicle_disposition_events BEGIN SELECT RAISE(ABORT, 'Disposition history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS vehicle_disposition_events_no_delete
BEFORE DELETE ON vehicle_disposition_events BEGIN SELECT RAISE(ABORT, 'Disposition history is append-only'); END;
```
Add `vehicle_disposition_events` to the required-table loop in `scripts/validate-cloud-release.mjs` L28 (`['cloud_app_revision', 'vehicle_service_events', 'vehicle_service_intake']`). `scripts/run-recovery-drill.mjs` L52-53 applies every `^\d+.*\.sql$` file in `cloudflare/migrations/` and exports every table, so it picks the new table up. `scripts/verify-d1-recovery-export.mjs` L13 `requiredTriggers` never listed the 0007 service triggers either; adding trigger names is **optional** — if you add them, add both pairs (`vehicle_service_events_no_update/no_delete`, `vehicle_disposition_events_no_update/no_delete`). Node SQLite: add the same DDL to `migrate()` in `server/database.mjs` next to `vehicle_service_events` (L246-262) so `pnpm dev:demo` (`:memory:`) has it — that is what "the Node demo server does in memory": the same table in the in-memory SQLite, seeded by `scripts/start-synthetic-demo.mjs` (§6.7).

### 6.2 Server module `server/vehicle-disposition.mjs` (mirrors `server/service-readiness.mjs`)
```js
export const DISPOSITION_CODES = Object.freeze(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out'])
export const DISPOSITION_EVENT_COLUMNS = Object.freeze([
  'id', 'vin', 'version', 'disposition', 'effective_date', 'destination_store', 'note',
  'updated_at', 'actor', 'actor_user_id', 'actor_role', 'store_id', 'input_hash', 'idempotency_key',
])
// Allowed transitions (from → to). Key `none` = no row yet (a string key, never a literal null key).
export const DISPOSITION_TRANSITIONS = Object.freeze({
  none:          new Set(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out']),
  keep:          new Set(['sold_pending', 'delivered', 'wholesale', 'transfer_out']),
  sold_pending:  new Set(['delivered', 'keep', 'wholesale', 'transfer_out']),   // keep = deal fell through; wholesale / transfer_out = deal collapsed and the unit was re-dispositioned
  delivered:     new Set(['keep']),                        // correction only; note required
  wholesale:     new Set(['keep']),                        // correction only; note required
  transfer_out:  new Set(['keep', 'sold_pending']),
})
export function dispositionOwnerStore(source)             // role-independent, see below
export function dispositionView(source, vehicle, row, context, { includeNote = false } = {})
export function buildDispositionEvent(source, vehicle, rows, input, context, { now, today, idempotencyKey })
```
**Owner store is role-independent.** `vehicle.homeStore` depends on the caller: `groupLocationVisible` (service-core L886-888) gates whether `location.row.home_store_id` participates, and advanced mode skips it. For an authorization decision define `dispositionOwnerStore(source) = source.homeAssignment?.home_store_id || publicStore` where `publicStore = source.publicRecord?.store || source.crmRecord?.storeName` (the same first and last terms of `homeStore` at L882/L889 without the context-dependent middle term). The card counts (§5.9) group by this owner store too, so the writer's permission and the card agree for every viewer.

`dispositionView` returns
```ts
{ vin, code: 'keep'|'sold_pending'|'delivered'|'wholesale'|'transfer_out'|null, version: number,
  effectiveDate: string|null, destinationStore: StoreName|null, updatedAt: string|null,
  updatedByRole: 'manager'|'group_manager'|null, store: StoreName|null /* store_id of the writer */,
  ownerStore: StoreName, canManage: boolean,
  updatedBy?: string, note?: string|null }           // the last two only when includeNote && context.canViewPrivateEvidence (sales, manager, group_manager)
```
`canManage = context.role === 'group_manager' || (context.role === 'manager' && context.store === ownerStore)`.
`buildDispositionEvent` validation (each a `WorkflowError` (`server/workflow.mjs` L159) with `status` and `code`):
- `!view.canManage` → 403 `DISPOSITION_MANAGER_REQUIRED` ("Only this vehicle's home-store manager can record a disposition.")
- input not an object / unknown keys (allowed: `disposition`, `effectiveDate`, `destinationStore`, `note`, `expectedVersion`; `actor`, `actorRole`, `store` and every identity field are unknown keys) → 422 `INVALID_DISPOSITION_INPUT`
- `disposition` not in codes → 422 `INVALID_DISPOSITION`
- `expectedVersion` not a safe integer ≥ 0 → 422 `DISPOSITION_VERSION_REQUIRED`
- idempotency key missing/invalid (same rule as service) → 422 `IDEMPOTENCY_KEY_REQUIRED`
- `effectiveDate` present but not a valid ISO day or after `today` (in `meta.timezone`, same check as `serviceDate` L131-138) → 422 `INVALID_DISPOSITION_DATE`; required for `delivered` and `wholesale`
- `destinationStore` required for `transfer_out`, must be a store ≠ `ownerStore`; forbidden otherwise → 422 `DESTINATION_STORE_REQUIRED` / `INVALID_DESTINATION_STORE`
- `note` > 500 chars or control chars → 422 `INVALID_DISPOSITION_NOTE`; required (≥ 3 chars) when the transition is a correction (`delivered → keep`, `wholesale → keep`)
- **hold-evidence guard**: the note, lower-cased and split on non-alphanumerics, must contain no token of ≥ 4 characters that also occurs in the same VIN's `source.holdRecord.holdDetailRows[*].{customerOrReasonRaw, salespersonRaw}` (active and deleted history) or `source.releasedHoldHistory` rows — all already in memory on `source` — else 422 `DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE` ("Notes cannot repeat names or reasons from the DealerMail hold."). Cheap, deterministic, and it makes "no customer names" more than policy.
- transition not allowed → 422 `INVALID_DISPOSITION_TRANSITION` with `details: { from, to, allowed: [...] }`
- replay: same `idempotency_key` with equal `input_hash` → `{ row: replay, created: false }`; different hash → 409 `IDEMPOTENCY_CONFLICT`
- `expectedVersion !== view.version` → 409 `DISPOSITION_VERSION_CONFLICT` ("Another manager updated this vehicle's disposition. Review the latest and save again.")
`input_hash = sha256({ disposition, effectiveDate, destinationStore, note, expectedVersion, actor: context.userId || context.user, role: context.role, store: context.store })`. `actor = context.user`, `actor_user_id = context.userId`, `actor_role = context.authenticatedRole || context.role`, `store_id = context.store` — all from the server-resolved context (on the Worker, the D1 membership), never from the body.

### 6.3 Repository
- `server/repository-dispatch.mjs`: add `listDispositionEvents`, `insertDispositionEvent` to `REQUIRED_METHODS` (L6-20, beside `listServiceEvents`/`insertServiceEvent` L16-17) and export wrappers.
- `server/database.mjs`: `listDispositionEvents(database)` (`SELECT * FROM vehicle_disposition_events ORDER BY vin, version`), `insertDispositionEvent(database, row)` (parameterised insert of `DISPOSITION_EVENT_COLUMNS`), exported like `listServiceEvents`/`insertServiceEvent`.
- `cloudflare/src/repository.mjs`: import `DISPOSITION_EVENT_COLUMNS`; `loadD1Repository` `statements` (L369-377, today eight: revision, transfer_requests, transfer_events, attention_work_items, attention_events, home_assignments, vehicle_service_events, vehicle_service_intake) gains a 9th entry `'SELECT * FROM vehicle_disposition_events ORDER BY vin, version'` → `dispositionEvents: results[8].results` (L386-389); `d1SnapshotRepository` (L257) gets `listDispositionEvents` (sorted clone) and `insertDispositionEvent` (stage insert + push clone). **The batch fails loudly if 0010 is not applied — and `loadD1Repository` is imported by both `cloudflare/src/worker.mjs` and `cloudflare/src/integration-worker.mjs` L3/L57**, hence the deploy order in §6.9.

### 6.4 Core (`server/service-core.mjs`)
- `snapshot()` (L1788-1824): build `dispositionEventsByVin` from `listDispositionEvents(database)` next to `serviceEventsByVin`.
- `vehicleFromSnapshot()` (L1825): `vehicle.appDisposition = dispositionView(source, vehicle, rows.at(-1), state.context)` (no note in list views).
- New methods: `getDisposition(vin, context)` → `{ ...dispositionView(includeNote), history: canViewPrivateEvidence ? rows.reverse().map(view with note) : [] }` (mirror `serviceDetail` L1835); `updateDisposition(vin, input, context, idempotencyKey)` → `{ created, record }` exactly like `updateServiceReadiness` (L1958+; insert when `created`, then re-view).
- Control center: `server/admin-control-center.mjs` gets `DISPOSITION_AUDIT_ACTIVITY` beside `SERVICE_AUDIT_ACTIVITY` (L58-62): `keep: 'Disposition: keep'`, `sold_pending: 'Disposition: sold pending'`, `delivered: 'Disposition: delivered'`, `wholesale: 'Disposition: wholesale'`, `transfer_out: 'Disposition: transfer out'`; `adminOverview` (L318-345) takes `dispositionEvents = []` and adds `dispositionAuditEntries(dispositionEvents)` to `audit` — actor, role, store, time; **never the note** (`auditEntry` only carries `activity`, L204-215).

### 6.5 API
Worker `cloudflare/src/worker.mjs` `appApi`: extend the route allow-list regex at L337 `/^\/vehicles\/[^/]+\/(?:service|invoice)$/` → `(?:service|invoice|disposition)`; add `else if(read && /^\/vehicles\/[^/]+\/disposition$/.test(route)) result=service.getDisposition(identifier,context)` after L368 and, **immediately after the service write branch at L369**, `else if(write && /^\/vehicles\/[^/]+\/disposition$/.test(route)) {result=service.updateDisposition(identifier,input,context,idempotency);mutation=true}` (source order matters for the write-surface pin, §6.8). Writes keep: same-origin check, `Idempotency-Key` required, 64 KB JSON (L348), D1 revision retry. Node `server/api.mjs`: `const dispositionMatch = route.match(/^\/vehicles\/([^/]+)\/disposition$/)` with GET/POST mirroring the `serviceMatch` block (L261-268), placed **directly after it** so the Node source-order pin reads service, disposition, attention, transfers, events.
Request (POST): `{ "disposition": "sold_pending", "effectiveDate": "2026-09-22", "destinationStore": null, "note": "Deposit taken; delivery Friday", "expectedVersion": 0 }`; response 201 on create, 200 on replay, body = `getDisposition` shape. Error body: `{ error, code, details? }` (existing `errorPayload` api.mjs L71 / Worker `json(...)` L24).
Client `src/lib/api.ts`: `getDisposition(vin, role, store)` and `updateDisposition(vin, input, role, store)` using `request()` (L151; POST → automatic `Idempotency-Key`, L158), beside `getServiceReadiness`/`updateServiceReadiness` (L293-303). `AppDataContext`: no new context method; the dialog calls the API and then `refresh()` (`AppDataContext.tsx` L40/L232, the pattern `ServiceEditor.onSaved` uses). No offline queue.

### 6.6 Types (`src/types.ts`)
```ts
export type AppDispositionCode = 'keep' | 'sold_pending' | 'delivered' | 'wholesale' | 'transfer_out'
export interface AppDisposition { vin: string; code: AppDispositionCode | null; version: number; effectiveDate: string | null; destinationStore: StoreName | null; updatedAt: string | null; updatedByRole: 'manager' | 'group_manager' | null; store: StoreName | null; ownerStore: StoreName; canManage: boolean; updatedBy?: string; note?: string | null }
export interface AppDispositionDetail extends AppDisposition { history: AppDisposition[] }
export interface AppDispositionInput { disposition: AppDispositionCode; effectiveDate?: string; destinationStore?: StoreName; note?: string; expectedVersion: number }   // mirrors ServiceReadinessInput L485-490
// VehicleRecord (L492): appDisposition?: AppDisposition | null
```
`src/features/inventory/types.ts` `InventoryVehicle.appDisposition?: AppDisposition | null` (pass-through in `toInventoryVehicle`, adapters.ts L524). `src/app/adapters.custody.test.ts` and `src/app/adapters.listing.test.ts` are PRODUCT-RULE tests over `toInventoryVehicle`: **cases added, none changed.**

### 6.7 Demo seed (`scripts/start-synthetic-demo.mjs`, inside `seedSyntheticWorkflow` L39-104)
`TESTDATAFWELL0002` → `sold_pending` (effective 2026-08-29, Fowlerville manager, note "Synthetic deposit — training data only"); `TESTDATADETRT0002` → `wholesale` (effective 2026-08-28, group manager); `TESTDATAHWELL0002` → `keep`. Idempotency keys `synthetic-demo-disposition-*`. All synthetic; no customer names. (The departed-move seeds that Slice A needs are in §15.8 and ride with O4.)

### 6.8 Product-rule re-pins this slice requires (Joe's approval per AGENTS.md L36)
- `tests/unit/write-surface.contract.test.ts` pins exactly five employee POST branches: `WRITE_BRANCHES` (L29) and exact source-substring assertions on `cloudflare/src/worker.mjs` and `server/api.mjs` (L71-95). `POST /api/vehicles/:vin/disposition` is a sixth branch, so **`pnpm check` goes red the moment O2 lands unless the pin is changed in the same commit**. The re-pin: header comment and test titles say six; `WRITE_BRANCHES` gains `'/api/vehicles/:vin/disposition'`; `validWrite` gains `case '/api/vehicles/:vin/disposition': return { as: 'howell', path: branch.replace(':vin', SERVICE_VIN), body: { disposition: 'keep', expectedVersion: 0 } }` (SERVICE_VIN is a Howell unit; the Howell manager owns it); the Worker expectation array becomes `['else if(write && /^\\/vehicles\\/[^/]+\\/service$/.test(route)) {', 'else if(write && /^\\/vehicles\\/[^/]+\\/disposition$/.test(route)) {', "else if(write && route==='/transfers') {", 'else if(write && /^\\/(transfers|attention)\\/[^/]+\\/events$/.test(route)) {']`; the Node expectation array gains `"request.method === 'POST' && dispositionMatch)"` after `serviceMatch`; the `tables` snapshot (L100) gains `vehicle_disposition_events`. The commit message says why the old pin was wrong (a sixth documented app-owned write exists).
- `tests/unit/cloud-write-identity.test.ts` (PRODUCT-RULE): add `it('persists the disposition actor from the D1 membership and rejects claimed identity fields')`: POST `/api/vehicles/TESTDATAFWELL0001/disposition` as the Fowlerville manager with `{ disposition: 'keep', expectedVersion: 0, actorRole: 'group_manager' }` → 422 `INVALID_DISPOSITION_INPUT` and zero rows; a clean POST → 201 and `SELECT actor, actor_user_id, actor_role, store_id FROM vehicle_disposition_events` equals `{ manager.name, manager.userId, 'manager', 'Fowlerville' }` despite the harness's forged `x-inventory-authenticated-*` headers and group-manager token claims; the Howell manager on the same Fowlerville VIN → 403 `DISPOSITION_MANAGER_REQUIRED`.
- `tests/unit/role-matrix-canary.test.ts`: cases added (§15.3), none loosened.

### 6.9 Deploy order (both Workers)
`docs/DEPLOY_CHECKLIST.md` L3 requires the app Worker and the integrations Worker to ship from one commit, and both import `loadD1Repository` (`worker.mjs`; `integration-worker.mjs` L3/L57), whose batch gains the 9th SELECT. Order: (1) apply `0010_vehicle_dispositions.sql` remotely as its own single file; (2) confirm `vehicle_disposition_events` in `sqlite_master`; (3) `pnpm cloud:validate`; (4) deploy the app Worker, then the integrations Worker from the same commit (checklist L35-36). Deploying **either** Worker before step 1 makes every `/api/*` **and** every `/api/v1/*` request fail with the D1 batch error. Rollback: both Workers to their recorded version IDs; the table can stay (no reader before this commit selects it).

### 6.10 UI (`src/features/overview/DispositionDialog.tsx`, one component, two entry points) — O6
- Entry points: (a) "Record disposition" on an away-list / dispositions-section row (managers with `canManage`), (b) a "Disposition" control in the VehicleWorkspace Operations block (`VehicleWorkspace.tsx` L2450, the block M13 moves ahead of the gallery) showing the current code and a "Change" button. Both open the same dialog.
- Dialog: `role="dialog" aria-modal aria-labelledby`; focus trapped with `useContainedFocus` (`src/lib/useContainedFocus.ts`), Escape closes, background scroll locked with `useModalBackgroundIsolation` (`src/lib/useModalBackgroundIsolation.ts`), focus returns to the opener. Fields: radio group of the allowed transitions only (client mirror of `DISPOSITION_TRANSITIONS`; the server remains authoritative), date input (required for delivered/wholesale; default `meta.reportDate` for `TESTDATA` VINs, local today otherwise, same as ServiceEditor), destination store select (transfer_out only), note textarea (500 chars; helper text "No customer names. Notes are visible to sales and managers."), Save (primary, Ford blue) / Cancel. On 409 `DISPOSITION_VERSION_CONFLICT`: keep the draft, load the latest, show "Another manager updated this vehicle. Review and save again." On 422 `DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE`: keep the draft, show the server message under the note. On success: `refresh()`, status message "Sold pending recorded for #W5863Q."
- Beside the control, always, the imported evidence line when present: "Sold — manager log · Fowlerville · 2026-08" (`vehicle.managerDisposition.{soldLabel, deliveryLabel, sourceStore, sourcePeriod}`, `src/types.ts` L53-70), so the two sources sit side by side with distinct labels.
- Vocabulary: "Disposition · recorded in Inventory Flow" for the app ledger; "manager log" for the import. Labels: Keep · Sold pending · Delivered · Wholesale · Transfer out.

---

## 7. Server-side overview projection — O1

### 7.1 Where it is computed and attached
New pure module `server/overview-summary.mjs`: `export function buildOverviewSummary({ context, meta, asOfDay, now, vehicles, visibleTransferRows, transferEventsById, stores, holdRows, holdSignals, serviceRowByVin, serviceIntakeByVin, managerDispositionRecords })` returning the shape in §7.2. Called once from `bootstrap()` (service-core L1892) after `stores`/`transfers` are built (L1917) and attached as `overview`. `bootstrap(contextInput = {}, { overview = true } = {})` gains an options object (M15 adds `listProjection` to the same object). **The integrations Worker calls `service.bootstrap(principal)` at `integration-worker.mjs` L60**, so the projection *is* computed there today; change that call to `service.bootstrap(principal, { overview: false })`. `integrationBootstrapFromSource` and its `vehicle()` mapper are allowlist `pick()`s (`server/integrations/source-bootstrap.mjs` L11, L148-178), so `overview` and `appDisposition` cannot leak without an explicit add — no strip line is needed; the canary asserts it (§15.3). Not called from `listVehicles`, `getVehicle`, `health`, `appReadiness`. Thresholds live in the module as `OVERVIEW_THRESHOLDS = { unaccountedAfterDays: 7, agedListingDays: [60, 90], serviceWaitingDays: [14, 30], listedAfterDeliveredDays: 3, recentReceiptDays: 7 }` and are published in the payload.

### 7.2 Shape (`src/types.ts` `OverviewSummary`, `BootstrapData.overview?: OverviewSummary`)
```ts
export interface OverviewSummary {
  asOfDay: string                               // YYYY-MM-DD in meta.timezone
  scopeStore: StoreName                         // context.store
  role: UserRole
  thresholds: { unaccountedAfterDays: number; agedListingDays: [number, number]; serviceWaitingDays: [number, number]; listedAfterDeliveredDays: number; recentReceiptDays: number }
  stores: OverviewStoreCounts[]                 // always 4, STORE_NAMES order (server/constants.mjs L2)
  group: OverviewStoreCounts                    // field `store` omitted
  board: { flows: OverviewBoardFlow[] }
  vehicleFacts: Record<string, OverviewVehicleFacts>   // keyed by VIN; keys with default values omitted
  service?: OverviewServiceMetrics              // omitted for coordinator/porter/driver
  exceptions: OverviewException[]
}
export interface OverviewStoreCounts {
  store?: StoreName
  onLot: number; onLotSourceReported: number; away: number; visiting: number; inTransit: number; conflict: number
  holds: number; holdsPastExpected: number      // = holdSignals[store].activeHoldVins / pastExpected
  waitingForService: number; inService: number; ready: number
  aged60: number; aged90: number                // listed vehicles only
  unaccounted: number; returnOverdue: number
  recordsIncomplete: number
  listed: number; preListing: number
  dispositions?: { keep: number; sold_pending: number; delivered: number; wholesale: number; transfer_out: number; none: number }   // Slice B; omitted for transport roles
}
export interface OverviewBoardFlow { from: StoreName; to: StoreName; kind: 'outbound' | 'return' | 'planned'; count: number; vins: string[] }
export interface OverviewVehicleFacts {
  custody: 'on_lot' | 'away' | 'in_transit' | 'conflict'
  custodyBasis: 'ledger' | 'source_reported'
  currentStore?: StoreName                      // when currentLocation is a store
  returnLeg?: 'return'                          // movement_status === 'return_in_transit'
  daysAway?: number; departedAt?: string; lastConfirmedAt?: string
  returnDueAt?: string; returnOverdue?: true; receivedHomeAt?: string   // receivedHomeAt only within recentReceiptDays
  unaccounted?: { reason: 'location_conflict' | 'source_conflict' | 'no_app_record' | 'stale_confirmation'; days?: number }
  holdActive?: true; holdPastExpected?: true    // from hold rows with active_hold_count > 0, never from hold.state
  agedBucket?: 60 | 90; agedBasis?: 'crm_age'   // bucket only for publicListing === 'listed'
  records: { autoCheck: boolean; oasis: boolean; sticker: boolean; invoice: boolean; fordHistory: boolean }
  recordsCaptured: number; recordsApplicable: 3 | 5
  service?: { status: ServiceWorkflowStatus; basis: NonNullable<ServiceReadiness['readinessBasis']>; store: StoreName | null; arrivalDate?: string; arrivalBasis: 'intake' | 'listing_date' | 'unknown'; waitingDays?: number; receiptToStartDays?: number; inServiceDays?: number; receiptToReadyDays?: number; sinceServiceUpdateDays?: number; dateOrderIssue?: true }
  disposition?: AppDispositionCode              // Slice B
  holdState?: HoldSummary['state']
}
export interface OverviewServiceMetrics {
  perStore: Array<OverviewServiceStoreMetrics & { store: StoreName }>
  group: OverviewServiceStoreMetrics
  agedWaiting: Array<{ vin: string; store: StoreName | null; waitingDays: number; arrivalBasis: 'intake' | 'listing_date' | 'unknown' }>   // sorted desc, ≤ 100
}
export interface OverviewServiceStoreMetrics {
  counts: { waitingForService: number; inService: number; ready: number }
  basis: Record<'manager_updated' | 'ford_service_history_inspection' | 'autocheck_post_intake_inspection' | 'new_arrival' | 'unconfirmed' | 'legacy_review', number>
  arrivalBasis: { intake: number; listing_date: number; unknown: number }
  medians: { receiptToStartDays: { value: number | null; n: number }; inServiceDays: { value: number | null; n: number }; receiptToReadyDays: { value: number | null; n: number } }
  agedWaiting14: number; agedWaiting30: number
}
export interface OverviewException { kind: 'location_conflict' | 'source_conflict' | 'no_app_record' | 'stale_confirmation' | 'return_overdue' | 'hold_past_expected' | 'identity_review' | 'records_incomplete' | 'service_date_order' | 'listed_but_delivered' | 'delivered_move_no_disposition'; store: StoreName; count: number; vins: string[] /* ≤ 50 */; transferIds?: string[] }
```
Freshness is **not** duplicated: the client already has `meta.publicFreshness`, `dealerMailFreshness`, `managerDispositionFreshness`, `completedAt`; `metaView` also emits `resourceFreshness` (service-core L1282, L1304) that the client `SourceMeta` (`src/types.ts` L24-45) lacks — **add `resourceFreshness?: SourceFreshness` to `SourceMeta`** and read it there (§12).

Bytes: facts are emitted only for non-default keys; an at-home, no-ledger, no-service-record vehicle contributes `{ custody:'on_lot', custodyBasis:'source_reported', records:{…}, recordsCaptured, recordsApplicable, service:{status:'needs_service', basis:'unconfirmed', store, arrivalBasis:'listing_date', waitingDays } }` ≈ 220 B raw. Budget: ≤ 5 % raw growth of a 226-vehicle bootstrap, measured by the test in §15.1 (no committed harness exists today; that test becomes the harness M15 can reuse).

### 7.3 Caching
Nothing new. The projection is part of the bootstrap body, so `jsonRevalidated`/`sendJsonRevalidated` hash it and answer 304 unchanged. Test: two `bootstrap()` calls with `now` five minutes apart on the same local day and the same ledger must serialize identically (O1 unit test); one call across midnight in `America/New_York` must differ only in `asOfDay`-derived fields.

### 7.4 Client adapter and selectors
`src/app/adapters.ts` `toInventoryVehicle(vehicle, data, transfer)` (L524): add `overview: data.overview?.vehicleFacts[vehicle.vin] ?? null` and `appDisposition: vehicle.appDisposition ?? null` to the returned `InventoryVehicle` (cases added to the two PRODUCT-RULE adapter tests, none changed). New `src/features/overview/overview-selectors.ts` with pure functions used by the page and by tests: `storeCard(data, store)`, `awayRows(data, filter)`, `returnVerification(data, store)` (client-derived: facts with `custody === 'in_transit' && returnLeg === 'return'` for the store, plus facts with `receivedHomeAt` — no server list), `exceptionRows(data)`, `serviceRows(data)`, `dispositionRows(data)`; every function joins `overview.vehicleFacts` to `data.vehicles` by VIN and never re-derives a count the server already published.

---

## 8. Deep-link contract (Inventory, Moves, Action center, Service) — O3

### 8.1 Inventory query params (today: `scope`, `vin`, `tab`, `returnTo`; legacy `q` is consumed and stripped — `InventoryPage.tsx` L27-50, L73-88)
New, all optional, read **on entry** and then stripped with `navigate({...}, { replace: true })` exactly like `q`, so Back returns to `/overview` and the URL stays clean; applied through `initialFilters` (`InventoryExperience.tsx` L369-398) and a `filterRequestKey = location.key` folded into the `<Experience key=…>` so a second deep link re-initialises:

| param | values | maps to |
|---|---|---|
| `store` | a `StoreName` | `filters.storeId = inventoryStore(store).id` for home-based views; the card's store for `visiting`/`in-transit` |
| `view` | `on-lot`, `away`, `visiting`, `in-transit`, `conflict`, `unaccounted`, `return-overdue`, `aged-60`, `aged-90`, `holds`, `holds-past-expected`, `records-incomplete`, and in Slice B `disposition-keep`, `disposition-sold-pending`, `disposition-delivered`, `disposition-wholesale`, `disposition-transfer-out`, `disposition-none` | `filters.overviewView = { view, store }` (new optional field on `InventoryFilters`, `src/features/inventory/types.ts` L505-515) |
| `service` | `needs_service`, `in_service`, `serviced` | `filters.serviceReadiness` (existing, L511) |
| `vins` | comma-separated VINs (≤ 50) | `filters.vins: string[]` (new; used by exception drill-downs where no single predicate exists, e.g. `service_date_order`, `source_conflict`) |
Unknown values are ignored. `scope=group` is set by every overview link so other stores' vehicles are in range. The revision-1 `hold=` and `moves=` params are **dropped**: no link in §8.2 consumes them (holds link to `view=holds`, which is fact-based and equals the card).
`src/features/inventory/inventory-utils.ts` `vehicleMatchesFilters` (L273): add the `overviewView` predicate (`vehicleMatchesOverviewView(vehicle, view, store)` reading `vehicle.overview` and `vehicle.appDisposition`; **`vehicle.location.homeStore` is an `InventoryStore` object `{ id, name }` (`adapters.ts` L27-29, L702-703) — compare `vehicle.location.homeStore.name === store`**, likewise `vehicle.overview.currentStore === store`; a vehicle with no facts matches only `on-lot` when its home store name is `store`), and the `vins` predicate. `activeFilterCount` (L509) counts them; the chip row shows "View: Away from home · Howell" / "Vehicles: 4 selected" with a clear button. This composes with M11's single filter state (`overviewView` is one more key in that state, not a second state).

### 8.2 Moves (`/transfers`) params
`TransfersPage.tsx` persists `queueView` (`'active' | 'needs-action' | 'history'`, key `transfers.view`, L313) separately from `queueFilter` (L314, values L47-61) and `storeScope` (`'home' | 'group'`, L315). URL params (read on entry, applied once, not persisted):
- `view` maps to **`queueFilter`** and leaves `queueView = 'active'`: `moving` → `'moving'`; `planned` → `'ready-to-collect'`; `return-due` → `'return-due'`; `sold-pending` → `'sold-pending'`; `issues` → `'issues'`; and a **new** `queueFilter` value `'return-overdue'` with the exact server rule on `TransferRecord` (`src/types.ts` L565-600): `record.returnRequired && record.returnDueAt && Date.parse(record.returnDueAt) < Date.now() && !['returned_home','closed','sale_confirmed','delivery_confirmed'].includes(record.requestStatus) && !['returned_home','closed'].includes(record.movementStatus) && !isTerminalTransfer(record)`. The existing client `needsReturnAttention` (L160-169) is broader (any `returnDueAt` or a `return`/`not-sold` status), so the card number must **not** link to `'return-due'`.
- `store=<S>` → `storeScope = S === homeStore ? 'home' : 'group'` plus a one-shot predicate `record.homeStore === S`.
- `from=<A>&to=<B>` (board arrows; Slice B) → predicate: outbound/planned `record.homeStore === A && record.destination === B`; return `record.destination === A && record.homeStore === B && record.movementStatus === 'return_in_transit'`.
- `id=` and `vin=` already exist (L310).

### 8.3 Action center and Service params
- `/attention?category=<all|moves|holds|inventory|service>` → `OperationsQueue.tsx` `category` state (`useWorkspaceState`, L94, type `ActionCategory` `action-center.ts` L10); read on entry, applied once.
- `/service?status=<needs_service|in_service|serviced>` exists (`ServicePage.tsx` L243, L261); `?vin=` exists (L245). O3 adds `?store=<S>` → `scope = S === homeStore ? 'my_store' : 'all'` plus a one-shot store filter on `serviceReadiness.store` (open question 13).

### 8.4 Link table (all hrefs built by `src/features/overview/overview-links.ts`, unit-tested)
| number | href |
|---|---|
| On lot / Away / In transit / Conflict / Unaccounted / Aged 60 / Aged 90 / Holds / Holds past expected / Records incomplete / Dispositions (store card) | `/inventory?scope=group&store=<S>&view=<v>` |
| Visiting | `/inventory?scope=group&store=<S>&view=visiting` |
| Waiting for service / In service / Ready | `/service?status=<needs_service|in_service|serviced>&store=<S>` |
| Return overdue | `/transfers?view=return-overdue&store=<S>` |
| Identity review | `/attention?category=inventory` |
| Board pin (Slice B) | same as the store card's active count |
| Board arrow (Slice B) | `/transfers?view=<moving|planned>&from=<A>&to=<B>` (return arrows: `view=moving&from=<dest>&to=<home>`) |
| Where-list row | transfer visible → `/transfers?id=<transferId>&returnTo=<overview>`; else `vehicleWorkspacePath(vin, { tab: 'movement', returnTo })`; **plus, on every row, "Records" → `vehicleWorkspacePath(vin, { tab: 'data', returnTo })`** (`inventory-navigation.ts` L82-90) |
| Service aged row / medians `n` | `vehicleWorkspacePath(vin, { tab: 'data', returnTo })` (Records tab: AutoCheck, OASIS, sticker, invoice, Ford service history — `VehicleWorkspace.tsx` L2492); the row also links `/service?vin=<vin>` |
| Exception count | the matching Inventory `view`, or `/transfers?view=return-overdue&store=`, or `vins=` list; `hold_past_expected` also carries a secondary "Open in Action center" (`/attention?category=holds`, no count claim) |
`returnTo` is always `currentWorkspaceReturnPath(location)` (L78) from `/overview` so every workspace shows "Back to Overview".

---

## 9. Service metrics section and report — O7

- Section header "Service" with a per-store table (desktop) / stacked cards (≤ 760px): columns Store · Waiting · In service · Ready · Median receipt → start (n) · Median in service (n) · Median receipt → Ready (n) · Waiting 14+ / 30+ · Arrival dates from intake %. Group row last, bold. Every count links per §8.4; medians are not links (they have no list); the `n` beside a median links to the vehicles that contributed (`vins=`).
- Basis strip under the table: "Ready basis: 21 manager-recorded · 9 Ford Certified Blue Oval · 3 AutoCheck inspection · Waiting basis: 4 new arrival · 5 unconfirmed · 0 legacy review".
- Aged waiting list: top 10 (Show all → `/service?status=needs_service`), each row: vehicle name, #stock, store, "Waiting 23 days · arrived 08/31 (intake)" or "(listing date)", "Records 4/5" link (Records tab) and "Update service" (`/service?vin=`; managers).
- "Open report" button toggles a print-oriented layout of this section only (same stylesheet; `.ov-service.is-report` shows all rows and the footnote) and calls `window.print()`.
- Footnote (verbatim): "Arrival is the earliest verified arrival or public listing date; listing dates can lag physical receipt. Ready from Ford or AutoCheck evidence uses the source's dates. Days listed is listing age, not lot age. No service date is ever inferred from a listing, a hold, or a delivery."
- **Demo fixture:** the synthetic Ford service history uses inspection type `'Used-car inspection'` (`fixtures/synthetic-release.mjs` L400-418), which `isCertifiedBlueOvalInspection` (service-readiness.mjs L59-62) rejects, so the demo has **no** evidence-based Ready and the basis strip's Certified Blue Oval column reads 0 in every screenshot. O7 adds one confirmed `'Certified Blue Oval Inspection'` order to one Ford VIN that has no manager service row (e.g. `TESTDATAFWELL0002` — not `TESTDATAHWELL0001`/`0002`/`FWELL0001`, which the demo seeds with manager rows), with `openDate`/`closeDate` on or after that vehicle's `inventory_date`; `tests/unit/service-readiness.test.ts` gains a case for it (none changed). If Joe prefers the fixture untouched, O7's verification notes the 0 instead.

---

## 10. Printable daily snapshot — O4

`overview.css` `@media print` (ID selectors and `!important` are permitted here by AGENTS.md L30; keep them to this block). Class names verified in `AppShell.tsx`: `.desktop-nav` (L319), `.top-bar` and `.mobile-bottom-nav` (template-literal classNames), `.app-main` (L428), `.synthetic-preview-notice` (L430).
```css
@media print {
  @page { size: letter; margin: 12mm; }
  .desktop-nav, .top-bar, .mobile-bottom-nav, .ov-print, .ov-board-controls, .ov-where-controls, .ov-show-all, .synthetic-preview-notice { display: none !important; }
  .app-main { padding: 0 !important; }
  .ov-page { display: block; }
  .ov-print-only { display: block; }
  .ov-stores { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; break-inside: avoid; }
  .ov-board svg { max-height: 60mm; }
  .ov-where table, .ov-service table { font-size: 11pt; }  /* pt, not px: scripts/check-design-system.mjs L29-30 counts font-size:…px only */
  .ov-where tbody tr:nth-child(n+16) { display: none; }   /* one page: first 15 away rows; footer says how many more */
  .ov-exceptions, .ov-service, .ov-dispositions { break-inside: avoid; }
}
```
`.ov-print-only` header: "Inventory Flow · Daily snapshot · {Howell | All stores} · As of {reportDate} · Printed {date time} · {Role} · Holds {freshness} · Website {freshness}". Footer: "Counts are app records and source evidence as of the times shown. Nothing here asserts availability; confirm holds and location with the home store." Notes, hold reasons and customer references never render on this page, so the printout is safe by construction (component test asserts no `note` field text appears in the DOM).

---

## 11. Exceptions list

Rendered as a definition list grouped by kind, each row: label · store · count (link) · "Why it matters" one-liner (fixed copy, not source text). **Keep the copy verbatim**; `listed_but_delivered` and `delivered_move_no_disposition` are prompts, never inferences.

| kind | label | copy | link |
|---|---|---|---|
| location_conflict | Location needs checking | "The app's own move records disagree about where this vehicle is." | Inventory `view=conflict` |
| source_conflict | Website and DealerMail disagree on store | "The public feed and the CRM list different stores; confirm which lot has it." | Inventory `vins=` |
| no_app_record | Listed at another store · no move recorded | "The website lists it away from its home store and Inventory Flow has no move for it." | Inventory `view=unaccounted` |
| stale_confirmation | Not confirmed for 7+ days | "Away from home with no custody confirmation for {N}+ days." | Inventory `view=unaccounted` |
| return_overdue | Return overdue | "Due back and not confirmed received." | Moves `view=return-overdue&store=` |
| hold_past_expected | Hold past expected date | "The DealerMail expected date has passed; a review signal, not proof of sale or release." | Inventory `view=holds-past-expected` (+ secondary "Open in Action center") |
| identity_review | Manager log needs an exact VIN | "A sold-board row could not be placed on a VIN." | Action center `category=inventory` |
| records_incomplete | Records not all captured | "One or more of AutoCheck, OASIS, sticker, invoice or Ford service history has not been captured for this unit." | Inventory `view=records-incomplete` |
| service_date_order | Service dates before arrival | "A recorded service date is earlier than the arrival date; check the record." | Inventory `vins=` |
| listed_but_delivered (Slice B) | Recorded delivered · still listed | "Delivered in Inventory Flow {n} days ago; the website still lists it. Confirm with the store; the listing is not changed here." | Inventory `view=disposition-delivered` |
| delivered_move_no_disposition (Slice B) | Move says delivered · no disposition | "A move records customer delivery; no disposition has been recorded." (managers only) | Moves `id=` |

---

## 12. Freshness

No `overview.freshness` object. The as-of line and section footers read `data.meta` directly: `publicFreshness`, `dealerMailFreshness`, `managerDispositionFreshness`, `completedAt` (existing) and `resourceFreshness` (added to `SourceMeta` in O1, §7.2). Words: the existing chip words (`Current`, `Refresh incomplete`, `Check data`) and the M13 rule "state word, time-only when today". Section footers: Holds "as of {completedAt} · DealerMail {state}"; Locations "Inventory Flow move ledger · live"; Service "Inventory Flow service ledger · live; Ford/AutoCheck evidence {resourceFreshness}"; Records "captures {resourceFreshness}"; Dispositions "Inventory Flow · live; manager log {managerDispositionFreshness}". When `dealerMailFreshness !== 'current'`, hold counts render with the suffix "(last verified)" and the `SourceWarning` shows at the top (existing component).

---

## 13. Copy and vocabulary (aligned with M13 "one vocabulary")

Nav: **Overview**, Inventory, Vehicle moves (mobile: Moves), Action center (mobile: Actions), Inventory updates (mobile: Updates, under More), Service status (mobile: Service, under More). Scope: "My store · {name}" / "All stores" (ScopeSwitch). Custody words: **On lot**, **Away**, **Visiting**, **In transit**, **Location needs checking** (existing conflicting label); basis words **ledger** / **source-reported** are always rendered next to a location that rests on the website store. Time: "{n} days away · since {date}", "Not confirmed for {n} days", "Return due {date}", "Overdue". Holds: the server's `hold.label` verbatim; count label "Holds"; "past expected"; the not-held chip is exactly `No current DealerMail hold found` and never a count label. Service: Waiting for service / In service / Ready (exact `SERVICE_STATUS_OPTIONS`, `src/lib/service-readiness.ts` L3-7). Aging: "Listed 60+ days" (listed vehicles only). Records: "Records 4/5". Dispositions: Keep · Sold pending · Delivered · Wholesale · Transfer out, qualifier "· recorded in Inventory Flow"; imported: "Sold — manager log", "Delivered — manager log", "Not marked delivered — manager log" (existing literals, `src/types.ts` L67-68). Other stores' movement counts for non-group viewers: "Moves as visible to you". Never: "Available", "Free", "Sold" without a source qualifier, "Missing" (use Unaccounted), "Map".

---

## 14. Accessibility

- Landmarks: one `<h1>`; each section `aria-labelledby` its `<h2>`; store cards are `<section>` with `<h3>`; counts in `<dl>` with `<dt>` label and `<dd><a>` value; link names read as "Howell: 3 vehicles away from home" (`aria-label` = `${store}: ${n} ${label}`).
- 44px targets on every link/button (min-height + padding), including SVG pins (hidden 9-unit hit circle) and table row links.
- No color-only status: "Overdue", "past expected", "Unaccounted" are words; `.ov-tone-*` classes add color only.
- Board: `role="img"` + `<title>`/`<desc>` + visually-hidden table (`.sr-only`); arrows carry `<title>`; the details toggle on mobile has `aria-expanded`.
- Dialog: focus trap, Escape, focus return, scroll lock (existing hooks); errors in `role="alert"`; success in `role="status"`.
- Filter changes announce via `role="status"` result count ("12 vehicles shown").
- Print: no interaction lost; hidden-on-screen print header uses `display:none` not `visibility`.
- `prefers-reduced-motion`: no animation on this page anyway.

---

## 15. Test plan

Unit (vitest, node env, synthetic fixture — `fixtures/synthetic-release.mjs`, `SYNTHETIC_NOW = 2026-08-30T10:15-04:00` L13, `SYNTHETIC_REPORT_DATE = '2026-08-30'` L12):
1. `tests/unit/overview-summary.test.ts` — one case per metric in §5: daysAway from `direct_move_recorded`; from `vehicle_departed`; from a destination-tagged `not_sold`; `null` while only `requested`/`request_approved`; reset by `returned_home`; custody table (all four values, both bases); `visiting` from the other store's perspective; `returnLeg` after `return_started`; unaccounted rules 1–4 in precedence order with N=7 boundary (6 days → null, 7 → stale); return overdue paused by `sale_confirmed`; `receivedHomeAt` within 7 days only; holds = `activeHoldVins` (a hold row with `active_hold_count = 0` is not counted and carries no `holdActive` fact); service: arrival from intake vs listing date (`arrivalBasis`), waitingDays; **status gating** — a manager row `needs_service` with null dates on a Ford vehicle with a Certified Blue Oval order yields no `receiptToStartDays`/`inServiceDays`/`receiptToReadyDays`; `manager_updated` uses row dates only; evidence basis uses evidence dates; in_service uses asOfDay; serviced uses both dates; `dateOrderIssue` from a reversed pair (not 0); medians even/odd n, nulls skipped, `n` reported; aged 60/90 boundaries and CRM-only rows excluded (`agedBasis: 'crm_age'`); records bitmap and `recordsApplicable` 5 vs 3; flows (outbound/return/planned) with counts; exceptions list; **ETag stability**: same day + same ledger → identical JSON; transport role → no `service`, no `dispositions`, facts only for visible transfers; **payload budget**: a helper clones fixture vehicles to 226 unique VINs, asserts `JSON.stringify(bootstrap(ctx))` grows ≤ 5 % over `bootstrap(ctx, { overview: false })`; **M15 invariant**: a Ford vehicle with a confirmed Certified Blue Oval order stays `serviced` under `listProjection: true` (add when M15 lands; assert today that readiness runs on the full view).
2. `tests/unit/vehicle-disposition.test.ts` (Slice B; mirror `service-readiness.test.ts` L4-28: local SQLite + D1 adapter via `applySyntheticSchema`/`sqliteD1`): create, replay (same key/hash → created:false), key reuse with different hash → 409, version conflict → 409, every allowed transition incl. `sold_pending → wholesale` / `transfer_out`, every disallowed transition → 422, correction requires note, transfer_out requires destination ≠ owner, future date → 422, note containing a hold-evidence token → 422 `DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE`, manager of another store → 403, sales → 403, group_manager anywhere, `ownerStore` identical for a manager, a driver and a group_manager context on the same VIN, note/updatedBy hidden without `canViewPrivateEvidence` and present for sales, history empty for transport roles, append-only triggers abort UPDATE/DELETE, Control center audit lists the event without the note, **never inferred in both directions**: (a) a release that drops the vehicle leaves the ledger untouched; (b) appending `sale_confirmed` then `delivery_confirmed` move events never creates or changes a disposition row (row count and latest version unchanged).
3. `tests/unit/role-matrix-canary.test.ts` (PRODUCT-RULE; add cases, never loosen): seed a marker into a disposition **note** and use a **dedicated identity** `{ role: 'manager', store: 'Howell', user: marker('disposition actor') }` that posts *only* dispositions (an identity that also posts service or move events would leak its name through `serviceReadiness.updatedBy` — not role-gated, service-readiness.mjs L117 — and through transfer `requestedBy`/custodian to transport roles, which would be a false positive); `readEverything` (L172-193) gains `/api/vehicles/:vin/disposition`; assert transport roles get no marker in `bootstrap.overview`, `bootstrap.vehicles[*].appDisposition` or the disposition read, evidence roles do (positive control), and the integration projection (`integrationBootstrapFromSource`) has no `overview` key and no `appDisposition` on any vehicle.
4. `tests/unit/write-surface.contract.test.ts` and `tests/unit/cloud-write-identity.test.ts` (PRODUCT-RULE, Slice B): re-pinned exactly as §6.8; `tests/unit/server-api.test.ts` / `tests/unit/cloud-release-worker.test.ts`: `GET/POST /api/vehicles/:vin/disposition` accepted, other methods 405, `Idempotency-Key` and same-origin required on the Worker, unknown route still 404.
5. `src/features/overview/overview-links.test.ts`: every href in §8.4; `src/features/inventory/inventory-utils.test.ts`: `overviewView` (comparing `location.homeStore.name`) and `vins` predicates; `src/features/inventory/InventoryPage.lifecycle.test.tsx`: params consumed, stripped, chip shown, Back returns to `/overview`; TransfersPage test: `view=return-overdue&store=` yields exactly the server rule's rows and leaves `queueView` at `active`.
6. Component tests per role (`src/features/overview/OverviewPage.test.tsx`, RTL, query by role/name only): group_manager (4 cards, no "Moves as visible to you" label, service section, dispositions section with Record button in Slice B); manager (home card first, other-store cards labelled "Moves as visible to you", Record only for own-store vehicles, other-store rows have no transfer link when withheld); sales (no Record/Update buttons, notes visible in the disposition detail); coordinator/driver (movement-only cards, no service section, no disposition note/actor); zero states ("No vehicles away from home"); every where-list row has a Records link; the basis word renders for source-reported rows; no literal "Available" and `No current DealerMail hold found` never appears as a count label; print header present in DOM but hidden; `DispositionDialog.test.tsx` (Slice B: focus trap, Escape, 409 handling, 422 note guard message, transition list).
7. `AppShell.test.tsx`: full rail order per role (Overview · Inventory · Vehicle moves · Action center · Inventory updates · Service status · Control center); mobile rail Overview · Inventory · Moves · Actions · More with Updates/Service/Control center under More; `/manager` redirect (`App` route test).
8. E2E (`tests/e2e/overview.spec.ts`, Playwright, four viewports via `page.setViewportSize` inside one spec, demo server). **The demo seed today has no vehicle physically away** (`scripts/start-synthetic-demo.mjs` L39-104: one approved-not-departed request on `TESTDATAHWELL0001`, one pending request on `TESTDATALNCN00002`), so O4 extends `seedSyntheticWorkflow` with two departed moves, relative to the demo's fixed now: (a) a direct move `{ vin: 'TESTDATAFWELL0002', intent: 'direct', requestingStore: 'Fowlerville', destinationStore: 'Ford Detroit', movedAt: now − 9 days, returnRequired: true, returnDueAt: now − 2 days }` by the Fowlerville manager (pattern: `tests/unit/simple-moves-workflow.test.ts` L90-98; `movedAt` must be ≤ 90 days back, workflow.mjs L380) → custody `away`, `daysAway` 9 from `direct_move_recorded`, return overdue, unaccounted `stale_confirmation` (9 ≥ 7); (b) a direct move `{ vin: 'TESTDATALNCN00001', intent: 'direct', requestingStore: 'Lincoln', destinationStore: 'Howell', movedAt: now − 3 days, returnRequired: true, returnDueAt: now + 2 days }` by the Lincoln manager, followed by `return_started` (allowed from the arrived state, `SIMPLE_EVENT_FROM.return_started` workflow.mjs L32) at now − 1 day → custody `in_transit`, `returnLeg: 'return'`, a return arrow Howell → Lincoln and a return-verification row on Lincoln's card. Assertions: first mobile viewport contents (§3) including two away rows with days away; each store-card number navigates to Inventory with the chip and the right rows (compare counts); Return overdue → Moves shows exactly one row; aged row → Records tab; every where-list Records link opens the Records tab; print emulation (`page.emulateMedia({ media: 'print' })`) hides nav and shows the snapshot header; `/manager` → `/overview`; no horizontal scroll at 390 (`document.documentElement.scrollWidth <= 390`). Slice B adds: board pin and arrow links (the arrow uses seed (b)); manager records `sold_pending` on `TESTDATAHWELL0001` and the card count updates after refresh.
9. Product-rule assertions (in 1, 3, 6): counts never derive from `hold.label` text; `publicListing` code (not label) decides "listed"; disposition never written by any import or move event; overview and `appDisposition` absent from the integration projection; the not-held chip string is exactly `No current DealerMail hold found`.
10. Design ratchet: `overview.css` has 0 raw colors and 0 sub-12px `font-size:…px` declarations (`scripts/check-design-system.mjs` L29-36 counts px only; print uses pt); `manager.css` baseline entry removed; no new global import in `src/main.tsx` (L10-21 list stays as is).

---

## 16. Performance budget
- No new dependency (`package.json` unchanged; framer-motion removal is M12's).
- One stylesheet `src/features/overview/overview.css` ≤ 450 lines, imported by `OverviewPage.tsx` only. **Tokens: only the `--ifx-*` family** (the only shared family — 111 tokens in `src/design-system/tokens.css`; M10 consolidates everything to it): `--ifx-neutral-0…950`, `--ifx-oem-accent(-strong)`, `--ifx-border-subtle`/`--ifx-border-control`, `--ifx-space-*`, `--ifx-text-xs…h1`, `--ifx-radius-*`, `--ifx-danger`/`--ifx-warning`/`--ifx-success`/`--ifx-info` (+ `-surface`), `--ifx-hold(-surface)`, `--ifx-focus-ring`, `--ifx-font-*`, `--ifx-weight-*`, `--ifx-leading-*`. **No `--ink-*`, `--surface*`, `--border` custom properties exist anywhere in `src/**/*.css`** (revision 1 named them; following it literally ships unstyled `var(--ink-900)` text). The only non-`ifx` shared names are `--blue-*` (`shell.css`) and `--nav-width` (`styles/tokens.css`); use `--nav-width` for layout only. Reuse `.sr-only` (`global.css` L491).
- Projection computed once per bootstrap; O(vehicles + visible transfers + their events); no per-request re-read of events beyond what `bootstrap()` already does (pass the `transfers` views it built, not re-queried rows).
- Bootstrap growth ≤ 5 % raw on a 226-vehicle synthetic bootstrap (the §15.1 measurement test; no other harness is committed); ETag stable within a day.
- `/overview` chunk ≤ 25 KB gz; away list renders ≤ 50 rows before "Show all"; SVG ≤ 4 pins + ≤ 12 arrows; no virtualization.
- Keystroke on the list filter ≤ 50 ms at 226 vehicles (pure filter over `vehicleFacts`).

---

## 17. Moves, effort, sequencing (two slices)

Land after M11 and M13 PR B (ScopeSwitch), before M17. O1/O3 can start after M13 PR A in parallel with M11. Tier per the routing policy: server/product judgment at opus/high; mechanical UI at sonnet/high; review at the next tier up; final gate fable/xhigh.

**Slice A — no D1 change, no product-rule re-pin, every metric Joe asked for (≈ 7 engineer-days, first value in ~6 with O1‖O3):**

| id | move | effort | depends on |
|---|---|---|---|
| O1 | Server overview projection (`server/overview-summary.mjs`, types incl. `SourceMeta.resourceFreshness`, `bootstrap(context, { overview })`, integrations path `{ overview: false }`, adapter fields, M15 readiness invariant, payload-size test) | opus/high · 1.5 d | M13 PR A optional; none hard |
| O3 | Deep-link contract (Inventory `store/view/service/vins`; Moves `view/store/from/to` + `return-overdue` filter; Action center `category`; Service `store`; link builder) | sonnet/high · 1 d | O1, M11 |
| O4 | Overview page (cards with basis words and Records incomplete, where-list with Records link, exceptions, freshness, print, `overview.css`, route/nav/redirect, delete manager feature, board chips without SVG, departed-move demo seed) | opus/high · 3 d | O1, O3, M13 PR B |
| O7 | Service metrics section + report + aged list + Certified Blue Oval fixture order | sonnet/high · 1 d | O1, O4 |
| O9 | Docs + manual steps (DESIGN_SPEC IA line, DEPLOY_CHECKLIST 0010 + both-Workers order, SERVICE_READINESS metrics note, AGENTS product-rule test list) | sonnet/medium · 0.5 d | O4, O6 (the DEPLOY/AGENTS parts land with Slice B) |

**Slice B — ledger, dialog, board; carries the migration, the write-surface and write-identity re-pins, the canary cases (≈ 5.5 engineer-days; its approvals stop gating Slice A):**

| id | move | effort | depends on |
|---|---|---|---|
| O2 | Disposition ledger (migration 0010, repositories, core, routes, client api, demo seed, Control center audit, note guard, write-surface + write-identity re-pins, tests) | opus/high · 2 d | none (may start alongside Slice A; merges after Joe's approval) |
| O5 | Store board SVG + config + arrow links | sonnet/high · 1 d (opus review) | O1, O4 |
| O6 | Disposition UI (dialog, workspace Operations control, list entry points, card counts) | sonnet/high · 1 d | O2, O4 |
| O8 | Tests: canary extension, per-role component tests for B surfaces, e2e board/disposition at four viewports, ratchet | sonnet/high · 1.5 d, gate fable/xhigh | O2, O5, O6 |

Total ≈ 12.5 engineer-days; O1‖O3 and O2‖(Slice A) parallel.

---

## 18. Manual steps for Joe
1. **Slice B only:** apply `cloudflare/migrations/0010_vehicle_dispositions.sql` to the live D1 **as its own single file** before deploying **either** Worker (the app Worker and the integrations Worker both load the D1 batch that gains the new SELECT; DEPLOY_CHECKLIST L3 requires both from one commit); verify with the `sqlite_master` query in `docs/DEPLOY_CHECKLIST.md` L17-20 that `vehicle_disposition_events` exists. Deploying first makes every `/api/*` and `/api/v1/*` request fail.
2. **Slice B only:** run `pnpm cloud:validate` (it now requires the new table) and the recovery drill once after the migration.
3. Confirm the four store positions in `src/features/overview/store-board-config.ts` (edit x/y; no addresses are stored).
4. Confirm thresholds in `server/overview-summary.mjs` `OVERVIEW_THRESHOLDS` (defaults: unaccounted 7 days, aged listing 60/90, service waiting 14/30, listed-after-delivered 3, recent receipt 7).
5. Approve the mobile rail change (Overview · Inventory · Moves · Actions · More; Updates, Service and Control center under More) that amends M13, and the `AppShell.test.tsx` updates.
6. **Approve the product-rule test changes (AGENTS.md L36) before Slice B merges:** the `write-surface.contract.test.ts` re-pin from five to six employee write branches (§6.8), the `cloud-write-identity.test.ts` disposition case, and the `role-matrix-canary.test.ts` additions (cases added, none loosened).
7. Confirm disposition vocabulary (Keep / Sold pending / Delivered / Wholesale / Transfer out), the two extra transitions `sold_pending → wholesale | transfer_out`, and who may correct a Delivered/Wholesale row (default: same writers, note required).
8. Decide whether O7 may add one Certified Blue Oval order to the synthetic fixture (default yes; one VIN, one test case added).
9. After the Slice B deploy: record one disposition on a real unit as group manager, confirm it appears in Control center audit without the note, that the imported manager-log line still shows beside it, and that a note containing a hold's customer/reason text is refused.

---

## 19. Open questions (recommended default in bold)
1. Unaccounted N days — **7** (one threshold for stale confirmation).
2. Aged thresholds — listing **60/90** (listed vehicles only; CRM-only rows excluded, labelled by basis); service waiting **14/30**.
3. Landing route — **keep `/` = Inventory**; Overview is the first rail item; revisit after two weeks of use.
4. Mobile rail — **Overview · Inventory · Moves · Actions · More** (Updates, Service and Control center under More); amends M13.
5. Disposition corrections — **any closing state → Keep with a required note**; `sold_pending → wholesale | transfer_out` allowed directly (a collapsed deal); no deletes ever.
6. Does a `delivered` disposition hide the vehicle like the imported manager log does — **no**; it is a chip plus the `listed_but_delivered` exception after 3 days; only sources remove a vehicle.
7. Store board positions — **approximate defaults in config; Joe confirms**; distances/tiles later, if ever.
8. Transport roles get `/overview` — **yes, movement-only variant**.
9. Dispositions/overview in the integrations API / extension — **no, out of scope**; the integrations path calls `bootstrap(principal, { overview: false })` and the allowlist projection never picks either field.
10. Medians vs averages — **medians with n**.
11. Separate `GET /api/overview` vs bootstrap field — **bootstrap field** (one fetch, ETag/304, one computation); revisit if growth exceeds 5 %.
12. Print length — **one page for My store; up to two for All stores**.
13. Service page store parameter — **add `?store=<S>` to `/service` in O3** so store-card service counts open the Service page filtered to that store.
14. Should sales see disposition notes — **yes** (same rule as hold evidence, `canViewPrivateEvidence`; the server guard rejects hold-evidence tokens in notes).
15. Ship order — **Slice A first** (O1, O3, O4, O7, O9); Slice B (O2, O5, O6, O8) after Joe signs the product-rule re-pins and applies 0010.
