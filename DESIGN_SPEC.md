# Inventory Flow — implementation design specification

## Product point of view

Inventory Flow is an operations surface for dealership teams, with independent product branding and separate dealership account branding. The current account is configured for a four-store group. It is not a replacement for DealerMail, CDK, DealerOn, or the audited daily workbook. It answers a narrower set of operational questions quickly:

1. What inventory should I work from my home store today?
2. What matching vehicles can the group reach when my store does not have the right unit?
3. Where is a moved vehicle, who has custody, what happens next, and when is it due?

The home-store view opens with **No hold** selected for salespeople and managers. It uses reported or confirmed physical location and the latest complete hold snapshot, including retained observations explicitly labeled with their as-of date. **All**, **Held**, and **Offsite** remain one tap away; no hold observation promises availability. The home location scope includes assigned vehicles and positively located visitors, while Offsite includes owned vehicles known elsewhere or in transit. Unknown/conflicting locations stay in All. The last selected view is preserved within the authorized session. Group inventory is a deliberate expansion. Group Operations is a manager surface.

## Accepted concept references

- `design/concept-home-desktop.png` — final home-store desktop surface.
- `design/concept-request-desktop.png` — all-store vehicle detail and request workflow.
- `design/concept-manager-desktop.png` — group movement and exception queue.
- `design/concept-home-mobile.png` — salesperson mobile inventory view.

The generated concepts establish layout, density, component anatomy, and visual language. Source-backed implementation values replace all illustrative concept values. Semantically unsafe illustrative copy is prohibited even if it appeared in an earlier draft concept.

## Information architecture

- **Home**: home-store summary, attention queue, compact inventory list, group-reach expansion.
- **Inventory**: full searchable inventory table, home-store-first scope, advanced sorting/filtering, selected vehicle drawer.
- **Transfers**: requests, transport/custody stages, outcome and return tasks.
- **Attention**: one actionable queue ordered by due time and risk.
- **Overview** (`/overview`, replaces Group operations): salespeople default to a sales workspace with their employee-owned customer lists, relevant vehicle facts, independent hold/location/service signals, and their reported issues. Managers default to the operations work queue, store summaries, location evidence, service metrics and dispositions. Both presentations remain reachable without changing permissions. Personal ownership uses authenticated employee IDs, never display-name matching. Each vehicle preview retains identity and a direct next action.

## Source and status boundaries

Never collapse these into one status:

- public listing / Website Status;
- DealerOn in-stock, in-transit, and in-production flags;
- DealerMail primary/backup hold and exact free-form evidence;
- app request status;
- app movement/custody status;
- customer/deal outcome;
- explicit delivery confirmation;
- raw CDK evidence;
- Home Store, current source-reported store, CRM store, app-confirmed physical location, and custodian.

Never display **Available** solely because a public listing exists, DealerOn says in stock, or no DealerMail hold was found. Preferred action copy is **Confirm with home store** or **Availability not confirmed**.

## Layout and container model

- Desktop: fixed navy navigation rail, compact top bar, cool recessed work canvas with white working surfaces, table/list as the dominant surface, optional right detail workspace.
- Tablet: collapsible navigation, table with prioritized columns, detail drawer overlays the content.
- Mobile: compact top bar, search and scope controls, list rows, bottom navigation, selected-vehicle bottom sheet; no horizontal scrolling.
- Do not turn table-driven screens into card grids. Cards are limited to the small decision rail and empty/onboarding states.

## Design tokens

- Canvas: `--ifx-canvas` (`#d7e2ed`); working panels remain white.
- Navigation, selected tabs and primary actions: the approved sidebar navy `#062b50`. OEM brand colours belong to genuine identity assets, not operational controls.
- Workspace headers use the white workspace-header tokens. True ledger headers use sidebar navy; local section headings use `--ifx-panel-header` (`#dfe8f1`). Evidence ledgers use `--ifx-evidence-surface` (`#e9f0f6`); action strips use `--ifx-action-well` (`#e0e9f2`).
- Text: `#102238`; secondary `#536579`; muted `#728195`.
- Outer panel borders: `--ifx-panel-border` (`#91a8bd`); internal fact separators: `--ifx-ledger-line` (`#d5e0eb`). Strong outer boundaries and lighter internal separators make dense records easy to scan. Secondary neutral text uses `--ifx-neutral-600` (`#4b6072`), keeping at least 4.97:1 contrast on the canvas.
- Success: `#147a3d`; warning: `#b85b00`; danger: `#c93434`; location violet: `#7655d8`; neutral: `#69798a`.
- Typography: Inter when available, then `Segoe UI`, Arial, sans-serif. Body 14px desktop/15px mobile; controls 13–14px; table secondary 12px; page title 28px/700.
- Radius: 8px controls, 10px panels/drawers, 12px selected mobile sheet.
- Elevation: Joe's repeated October 12, 2026 direction calls for clearly visible physical depth throughout the app. Raised white work panels sit above a cool recessed canvas with a 2px top highlight, firm 3px base edge and layered cast shadows through `--ifx-panel-shadow`. Primary navy actions use a gentle brighter-navy-to-brand-navy tonal fill, 2px inner highlight, 3px dark base and a visible soft cast shadow; secondary actions use a white-to-cool-grey fill and 2px base edge. Header bands use their own tonal fill and bevel; joined evidence bands use one recessed inset shadow, never separate shadows on each fact. Keep outer surfaces raised once, quiet tabs/copy controls unelevated, dense geometry and all 44px targets. Hover lifts remain 1px; presses use inset shading; anchored popover launchers stay fixed. Reduced motion suppresses lifts and presses. Print and forced colors remove gradients and shadows while retaining readable boundaries. Avoid glass, cartoon effects, extra padding and nested shadow stacks. Inventory and vehicle identity bands use the strong navy masthead, white titles and pale metadata; search remains a recessed white field. Use locally bundled Inter with deliberate bold heading weights, tight heading tracking and tabular counts. Integrated controls retain real existing functions and explicit labels rather than adding decorative or fictional advanced features.
- Motion: apply selection, tab and store changes immediately. Use the shared 80ms/120ms tokens for brief feedback and the 180ms scene token for natural-height vehicle detail disclosure; avoid animating the whole inventory table or taking a full-page view-transition snapshot. Respect `prefers-reduced-motion`.

## Component families

- App shell, navigation rail, top bar, store switcher, freshness indicator.
- Scope switch (`My store`, `All stores`) and manager quick views.
- Decision rail with distinct headline metrics.
- Search, faceted filters, saved views, multi-sort summary, column visibility.
- Inventory and movement tables with sticky headers and selected-row treatment.
- Vehicle row/mobile row, source-status label, location treatment, next-action label.
- Vehicle workspace/drawer with Overview, Movement, Hold evidence, Timeline.
- Transfer request form, handoff/accountability preview, confirmation state.
- Overview vehicle work queue, store summaries, exceptions, and the disposition dialog (one dialog, opened from the Overview or the vehicle workspace's Operations block).
- Custody timeline, manager actions.
- Empty, stale-source, conflict, permission-redaction, and offline states.

## Icon inventory

Use one consistent 1.75px rounded-outline family for navigation, search, filter, location, vehicle, transfer arrows, clock, alert, user/custodian, check, and external link. Icons supplement text and never carry status meaning alone.

## Allowed first-viewport copy

- Inventory Flow
- Home store
- Howell / Fowlerville / Ford Detroit / Lincoln
- Search stock, VIN, model, or feature
- My store
- All stores
- Public units
- Current holds
- Away from home
- Return overdue
- Attention
- Filters
- Group reach
- Search all stores
- Confirm with home store
- Availability not confirmed
- View vehicle
- Request vehicle
- Open source record

No marketing eyebrow, tagline, fake performance claim, or customer-sensitive text appears above the fold.

## Core interaction path

1. User opens on their configured Home Store.
2. Search and filters operate across the current scope; multi-sort is visible and reversible.
3. User deliberately expands to All Stores or Group Reach.
4. Selecting a vehicle opens the workspace without losing list context.
5. Request Vehicle records an internal movement request only; it never writes to DealerMail/CDK or asserts availability.
6. The requesting-store manager checks availability with the Home Store, then records one approval or decline. There is no second in-app approval, driver/dispatch assignment, collection checklist, or destination-arrival checklist in the everyday workflow.
7. Sales can record the showing outcome or start the return. An authorized manager can record a direct move with its actual destination and time; an approval alone does not establish physical custody.
8. A not-sold outcome returns the vehicle to the return path. A Home Store manager records receipt back home, which closes the move without a separate Close step. Sold pending remains open until an authorized manager explicitly records delivery or a failed deal; it is not a delivery or closure inference.

The shared service defaults to `workflowMode: 'simple'`. Earlier dual-approval and dispatch flows are advanced foundations, not current release requirements; see [Operating model](docs/OPERATING_MODEL.md) and [Advanced workflow roadmap](docs/ADVANCED_WORKFLOW_ROADMAP.md).

## Privacy and role rules

- No customer name, exact reason, comment, or alert text on dashboards, movement tables, driver views, or notifications.
- Authorized salespeople and managers can open exact DealerMail hold owner/reason, salesperson, expected date, comments, alerts, and backup evidence in the vehicle workspace; do not hide these existing role-authorized facts behind a manager-only rule.
- Drivers, porters, and coordinators receive logistics with customer-sensitive fields redacted by the server. Frontend hiding is not the privacy boundary.
- Store and role membership comes from the server. Revocation clears protected workspaces and caches; a temporary refresh failure retains the last verified data with its as-of date.
- The frontend never receives raw DealerMail arrays or unrestricted snapshot files.
- A disposition is recorded in Inventory Flow only: it never changes DealerMail, CDK, the listing or the manager log, is never inferred from them or from a move, and never hides a vehicle. Its note and writer's name reach sales and managers only in the disposition detail — never the Overview page, its print, list views or the Control center audit — and the server refuses a note that repeats the vehicle's hold names or reasons.

## Responsive acceptance

Inspect at the viewports listed in [AGENTS.md](AGENTS.md); the width-specific criteria below apply at those sizes.

- 1440×900 desktop: no page-level horizontal scrolling; table may use controlled internal overflow only below 1180px.
- 1024px tablet: use a compact 64px navigation rail and a wide vehicle reference region beside an independent operations rail. Source evidence follows in a joined band; do not squeeze configuration, history and operations into independent narrow report columns.
- 390×844 mobile: no horizontal scrolling, 44px touch targets, bottom navigation, status text alongside color/icon.
- Judge density using an unfiltered, multi-vehicle list as well as the default No hold view. Measure the complete vehicle group, including provider summaries. Main facts remain 15px; labels, dates and provenance may use 12–13px. Budget roughly 320px for an ordinary complete record, allowing for font metrics and full source text. Acceptance is measured by useful content in the viewport: two complete ordinary records at 1440×900 and the second vehicle’s meaningful identity, pricing and operational content at 1320×820 and 1024×768. Do not substitute a fixed record-height threshold for these visible-content checks. Rich or held records and complete warnings can grow. Do not clip evidence, shrink values or hide actions to meet density targets. Phone identity, operational facts and first actions must appear before the bottom navigation; supporting facts follow without an arbitrary total-record cap.
- Desktop inventory uses one continuous vehicle ledger with two primary regions: a wide photo/identity reference area and an independent operations rail. Rows open collapsed to show more vehicles at once. Keep price, the copy ledger, operational states, material source qualifications and direct actions visible in the compact view. The Details button reveals configuration and the complete source band through one natural-height disclosure; Enter and Space work, closed content is inert and excluded from the accessibility tree, and reduced motion disables the transition. Keep the vehicle image unobscured; certification artwork belongs with identity metadata. A stable copy ledger spans the reference region for Stock, full VIN, Base MSRP and mileage. Factory, history and OEM evidence share a joined source band beneath the primary facts; each real source mark and explicit destination sits beside its associated facts. One compact footer groups Records, Save, Listing and Details, then permitted Request/Track/Move actions. Missing actions leave no reserved slot, and additional genuine actions stay direct. Phone records follow the same hierarchy: image/identity/price, four copy fields, independent operational state, direct actions, then configuration and source evidence. Preserve full values and all source qualifications.
- Inventory controls occupy two compact functional rows where space permits: title/count/location scope, dominant search and Saved lists first; labeled Hold choices, a Service selector, Filters, Sort and Saved only second. Search uses the placeholder “Search stock, VIN, vehicle or equipment” and retains at least 300px at desktop widths. Saved lists opens list management; Saved only filters the ledger. Phones use five tight functional rows: identity/scope/Saved lists; full-width search; utilities; Hold; Service with Expand all / Collapse all beside it. The expansion control uses one shared state and remembers only the global expanded/collapsed presentation preference; per-vehicle expansion resets with employee access context. Do not squeeze search between duplicate unlabeled heart controls. Every choice and count remains available. The global Sort interface retains all supported sort fields and active priorities. The vehicle ledger keeps semantic column headers without repeating a second row of interactive sorting controls. Secondary actions use one consistent button treatment; copy controls remain quiet.
- The vehicle workspace uses one reference panel for its photo, published price, mileage, age, copyable Stock/VIN, and original/base MSRP. Source notes remain attached to their prices. Independent operational facts follow a full-width hold evidence row, with service, movement and ready actions first in the action strip. A hairline separates these workflow actions from quieter evidence and Inventory Flow hold/disposition controls. Hold evidence opens the Holds & moves ledger; Inventory Flow hold opens the app-owned hold dialog. Permission-aware manage/request/approve controls retain their original actions. On phones, copy controls share a compact row with their label and value while retaining a 44px target. Changing tabs retains an immediately reachable price, detailed service status and Stock/VIN reference strip; it must not remove quick-copy identity access. Detail section headings and source panels use the same neutral surfaces and separators as the inventory records.
- The customer shortlist uses a clearly labeled Saved lists toolbar launcher beside inventory search on desktop and beside title/scope on phones and a small anchored, nonmodal popover. The closed launcher never covers vehicle data; the expanded popover stays outside document flow and within the viewport. Opening it must not add document height, move inventory scroll position, dim the whole page or block other inventory controls. Customer management is progressive; compact photo rows retain vehicle identity and quick actions. Nested vehicle and customer-sheet dialogs remain modal and return focus to their exact launch controls.
- Service list cards provide explicit Open vehicle, Records and permission-aware Update service / View service actions outside the card's selection button. These open existing workflows and never save a new status by themselves.
- Overview has one Show details / Hide details control for all captured documents and records. They expand together, retain their source links, and reset to summaries when another vehicle opens. Full records remains a separate action.
- Full Records uses up to two report columns on desktop and a single report sequence on phones. Reports flow in reading order with compact gaps, without reserving space to match a taller neighboring report; a lone report uses the full width. Keep labels near values and source details with their report. The phone report-navigation row may scroll horizontally; report bodies and the page must not.


## Vehicle scanning acceptance

- Scan is a phone/tablet action and is hidden in the desktop toolbar. Choosing it starts the camera immediately in a compact viewfinder without opening the keyboard. The same camera view attempts VIN barcodes and local stock-tag OCR automatically, with no mode selection. An employee-selected photo and manual entry remain fallbacks; recognition must not upload photos or customer information to an external service.
- Match the decoded VIN or stock number against the employee's authorized inventory. A unique, exact barcode match fills the existing inventory search and shows that vehicle. Live-camera and photo OCR readings are reviewed before applying the search. Saving uses the existing result's session shortlist control; scanning does not silently save or create an inventory record.
- Uncertain OCR, multiple candidates, and unmatched text remain reviewable. Let the employee correct or choose the identifier before changing search; never choose a likely vehicle silently.
- Keep manual VIN/stock search available when permission is denied, camera/barcode support is missing, or recognition fails. Stop camera tracks when the scanner closes, the page leaves the flow, or access is revoked; do not persist photos or video frames.
- A scan identifies a vehicle only. Listing, holds, service, movement, and source freshness remain separate; a match never promises availability.
- Synthetic browser tests cover recognition results, selection, fallback, and cleanup. Real windshield barcodes, stock-tag print quality, camera focus, lighting, and physical phones require separate dealership acceptance and remain unverified until exercised.
