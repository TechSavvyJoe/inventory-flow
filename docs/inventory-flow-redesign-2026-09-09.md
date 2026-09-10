# Inventory Flow: focused inventory and vehicle workspace redesign

Date: September 9, 2026

Status: pre-publication checks passed. Deployment and protected-live verification are recorded separately in the private release receipt after publication; this document does not certify that every production scenario has been tested.

## Scope and information architecture

This is a frontend layout and interaction revision, not a data migration or a change to dealership approval rules. It reduces competing controls and repeated summaries while keeping vehicle information and existing permissions available.

The vehicle workspace uses the same four tabs on desktop and mobile:

| Tab | Purpose |
| --- | --- |
| Overview | Photo gallery, key figures, one hold/location/movement strip, description, specifications, equipment highlights, and a short document summary. |
| Equipment | Exact captured equipment names organized into readable categories. Original build details remain available in a disclosure. |
| Holds & moves | Hold records, permitted saved comments and alerts, DealerMail handoff, and movement details with the applicable Request vehicle or Track movement action. |
| Records | Vehicle documents and chronological changes; complete technical/source details remain available in a disclosure. |

One persistent identity header and one navigation row replace repeated mobile/desktop summaries. Other tabs do not repeat the large gallery. Movement and history entry points still target the relevant section, with keyboard focus managed inside the workspace. DealerMail tools are the primary header action when permitted; supporting links are grouped under More resources.

The inventory table has four main columns: **Vehicle**, **Price & mileage**, **Equipment**, and **Hold & location**. Each vehicle has a separate full-width record strip for stock, VIN, document summaries, and meaningful recent changes. Open/More actions sit with vehicle identity instead of occupying a competing action column. Equipment and change controls open their corresponding workspace sections. Existing sort fields remain available; visible heading actions have stable sort meanings. Desktop rows flow with the page instead of being trapped in a short internal scrolling box.

## Fidelity ledger

| Dimension | Design intent | Implemented interpretation / deliberate difference |
| --- | --- | --- |
| Layout | Clear four-column scan and four task-focused workspace views. | Main desktop column proportions are 32/16/28/24, with one record strip per VIN. Responsive layouts preserve the same information and navigation rather than shrinking the desktop mockup. |
| Typography | Dark, readable text with a restrained hierarchy. | Existing static Inter font files and explicit weights are retained, with font synthesis disabled. Supporting text and headings use consistent scoped sizes; rendering still requires browser/device QA. |
| Palette | Navy identity, white surfaces, quiet borders, blue actions. | Existing application tokens are reused. Status colors retain meaning rather than decorating every equipment item. |
| Spacing | Separate neighboring facts without large empty cards. | Scoped cell padding, wider equipment/financial areas, compact actions, and one content scroller replace repeated boxes and cramped columns. This is responsive implementation, not a pixel-for-pixel screenshot reproduction. |
| Assets and content | Authentic automotive presentation. | Existing dealership branding, real vehicle photos, and captured document assets are retained. Generated concept images, invented vehicle text, and mock data are not shipped as production content. |

## Preserved boundaries

- Exact OEM/source-backed equipment wording, configuration facts, full records, and provenance remain accessible. No equipment is inferred from model year, trim, or a concept image.
- Current, stale, missing, and unverified data retain their distinctions. A listing, absent hold, expected date, or raw system status is not treated as proof of availability, sale, or delivery.
- Hold evidence visibility, management permissions, movement callbacks, and existing resource routes remain intact. This redesign does not independently perform CRM mutations.
- DealerMail is an explicit handoff: the user requests a new interactive inventory tab and stock-number copy, then pastes into LAST8 / STOCK, searches, and verifies the full VIN. Copy/open failures have fallback instructions. Automatic per-vehicle selection and reliable deep links are **not** established.

## Implementation tradeoff

`VehicleWorkspace.flow.css` and `InventoryTable.flow.css` scope the revised presentation to these features. They intentionally override parts of a legacy layered stylesheet cascade. This limits unrelated-page regressions, but does not replace a future consolidation of the global design system or remove all older CSS.

## Verification and release record

Verified September 9, 2026:

- All 439 automated unit/integration tests passed across 51 files.
- TypeScript checking, production build, repository safety and design-system guards passed. The existing global CSS debt did not increase under the guard; it was not eliminated.
- Cross-browser suite: 20 passed, one intentionally skipped desktop-table case on mobile, which uses a dedicated vehicle list. This covers Chromium desktop, WebKit desktop, and WebKit mobile emulation.
- Supplemental final table checks: both desktop engines passed with unusually long equipment labels at 1024, 1280, 1440, and 1800 pixels. Tests check no clipped key labels/identifiers, no nested vertical table scroll, correct section entry, and focus restoration after equipment, history, and hold actions.
- Generated concept and rendered screenshots were compared for hierarchy, spacing, typography, palette, and assets. Wide-table and small-screen workspace screenshots were visually inspected. Synthetic photos are deliberately absent rather than substituting invented vehicle imagery.
- Deployment dry run passed using the existing production hostname and protected database/bucket bindings, without publishing or changing data.
- Pre-release live readiness returned the September 9 release, 226 inventory vehicles and 18 attention items. Post-release checks must confirm the same data fingerprint.

Mobile validation is emulated WebKit, not a physical iPhone. External DealerMail actions, Google login configuration, data collection, and Excel workbook generation are not altered by this release.

The local QA directories `work/qa/inventory-flow-release`, `work/qa/inventory-flow-table-final`, and `work/qa/vdp-flow-final-browser` are under the report workspace root. Their browser fixtures/screenshots use synthetic data; they are not proof of live inventory freshness or real-account permission coverage. Production data quality and the daily reporting workflow require their own evidence. Sensitive live screenshots and release receipts remain outside source control.
