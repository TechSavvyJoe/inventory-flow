# Maxey Inventory Flow — implementation design specification

## Product point of view

Maxey Inventory Flow is an internal operations surface for a four-store dealership group. It is not a replacement for DealerMail, CDK, DealerOn, or the audited daily workbook. It answers a narrower set of operational questions quickly:

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

- Desktop: 172px fixed navy navigation rail, 64px top bar, open white work canvas, table/list as the dominant surface, optional 344px right detail workspace.
- Tablet: collapsible navigation, table with prioritized columns, detail drawer overlays the content.
- Mobile: compact top bar, search and scope controls, list rows, bottom navigation, selected-vehicle bottom sheet; no horizontal scrolling.
- Do not turn table-driven screens into card grids. Cards are limited to the small decision rail and empty/onboarding states.

## Design tokens

- Background: true white `#ffffff`.
- Navigation: deep navy `#062a4d`; active navy-blue `#0a4e9b`.
- Primary action: Ford blue `#0759bd`; hover `#064b9f`; focus ring `#8bbcff`.
- Text: `#102238`; secondary `#536579`; muted `#728195`.
- Borders: `#dce4ed`; soft fill `#f5f8fb`; selected row `#edf5ff`.
- Success: `#147a3d`; warning: `#b85b00`; danger: `#c93434`; location violet: `#7655d8`; neutral: `#69798a`.
- Typography: Inter when available, then `Segoe UI`, Arial, sans-serif. Body 14px desktop/15px mobile; controls 13–14px; table secondary 12px; page title 28px/700.
- Radius: 8px controls, 10px panels/drawers, 12px selected mobile sheet.
- Elevation: none for the normal canvas; subtle shadow only for drawers, sheets, and menus.
- Motion: apply selection, tab and store changes immediately. Use the shared 80ms/120ms tokens for brief feedback and disclosure transitions; avoid animating the whole inventory table or taking a full-page view-transition snapshot. Respect `prefers-reduced-motion`.

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

- Maxey Inventory Flow
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
- 1024px tablet: priority columns remain, secondary fields move into the drawer.
- 390×844 mobile: no horizontal scrolling, 44px touch targets, bottom navigation, status text alongside color/icon.
- Judge density using an unfiltered, multi-vehicle list as well as the default No hold view. Include provider summaries in the complete desktop row height; measuring only the primary table row hides wasted space. Typical phone results should be about 200–250px, and complete desktop groups about 240–280px. Long warnings may need more space; do not truncate material evidence to meet a budget.
- Phone results use a compact identity block, location/hold/service facts, and one shared action row. Full provider details are one Records action away. Desktop compares a short set of labeled AutoCheck, sticker, and OASIS facts beneath the main row.
- The customer shortlist uses a fixed launcher and a small anchored, nonmodal popover. Opening it must not add document height, move inventory scroll position, dim the whole page or block other inventory controls. Customer management is progressive; compact photo rows retain vehicle identity and quick actions. Nested vehicle and customer-sheet dialogs remain modal and return focus to their exact launch controls.
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
