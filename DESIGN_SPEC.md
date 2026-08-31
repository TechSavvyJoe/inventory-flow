# Maxey Inventory Flow — implementation design specification

## Product point of view

Maxey Inventory Flow is an internal operations surface for a four-store dealership group. It is not a replacement for DealerMail, CDK, DealerOn, or the audited daily workbook. It answers a narrower set of operational questions quickly:

1. What inventory should I work from my home store today?
2. What matching vehicles can the group reach when my store does not have the right unit?
3. Where is a moved vehicle, who has custody, what happens next, and when is it due?

The home-store view is the default for salespeople and managers. Group inventory is a deliberate expansion. Group Operations is a manager surface.

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
- **Manager**: group operations table, saved views, exceptions, next-action ownership.

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
- Motion: 160–220ms for drawer, selection, and disclosure transitions; respect `prefers-reduced-motion`.

## Component families

- App shell, navigation rail, top bar, store switcher, freshness indicator.
- Scope switch (`My store`, `All stores`) and manager quick views.
- Decision rail with distinct headline metrics.
- Search, faceted filters, saved views, multi-sort summary, column visibility.
- Inventory and movement tables with sticky headers and selected-row treatment.
- Vehicle row/mobile row, source-status label, location treatment, next-action label.
- Vehicle workspace/drawer with Overview, Movement, Hold evidence, Timeline.
- Transfer request form, handoff/accountability preview, confirmation state.
- Group Operations queue, custody timeline, manager actions.
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
6. Home-store manager approves/declines; requesting manager accepts custody responsibility.
7. Transport and both handoffs record custody, time, location, and next owner.
8. A not-sold outcome creates a return task; closure requires home-store receipt or explicit authorized disposition.

## Privacy and role rules

- No customer name, exact reason, comment, or alert text on dashboards, movement tables, driver views, or notifications.
- Salespeople see the minimum needed for their store/request.
- Drivers see logistics, keys/condition, and handoff data—not customer details.
- Authorized managers may open exact DealerMail evidence in the detail workspace.
- The frontend never receives raw DealerMail arrays or unrestricted snapshot files.

## Responsive acceptance

- 1440×900 desktop: no page-level horizontal scrolling; table may use controlled internal overflow only below 1180px.
- 1024px tablet: priority columns remain, secondary fields move into the drawer.
- 390×844 mobile: no horizontal scrolling, 44px touch targets, bottom navigation, status text alongside color/icon.

