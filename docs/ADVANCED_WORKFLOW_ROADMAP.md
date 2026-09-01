# Inventory Flow phased product roadmap

Inventory Flow is being introduced with an adoption-first interface: salespeople and managers should immediately see the vehicle, who owns the next action, what must happen, and when it is due. The application keeps the more advanced data and workflow foundations so later releases can add depth without redesigning the underlying model.

## Phase 1 — current operating experience

- Five visible vehicle-move stages: salesperson request, requesting-store manager approval, requesting manager's call to the Home Store manager and recorded release decision, movement after release, and sell-or-return outcome.
- One next action, one assigned owner, and one due time shown prominently.
- Salesperson and manager assignments are the primary operating model.
- Needs Attention is a real work queue, not a dashboard of decorative totals.
- Technical source names stay out of primary screens; their data informs plain-language status and exceptions.
- Complete vehicle, hold, equipment, movement, issue, return, and history data remains available through progressive disclosure.

## Advanced foundations retained now

- Detailed request, manager review, home-store release, driver, pickup, arrival, outcome, return, and home-receipt states.
- Requesting-manager approval plus the named Home Store manager's verbal grant or decline recorded as separate evidence.
- Driver assignment, pickup timing, custodian, current location, and return due dates.
- Separate hold, deal, delivery, movement, and return states.
- Vehicle-condition issues, safe-to-drive evidence, exceptions, escalation, and complete activity history.
- Full public-inventory, DealerMail, AutoCheck, sticker, vAuto, equipment, and provenance fields in the data model.
- Authorized action lists and server-side workflow transitions.
- Responsive master-detail layouts and reduced-motion support.

## Phase 2 — advanced operations mode

- Optional dispatch board for coordinators with driver capacity, pickup windows, route grouping, and aging.
- Independently authenticated Home Store manager acknowledgment when the team is ready to add a second digital approval without making the initial rollout harder to adopt.
- Structured home-store acknowledgment and resolution of vehicle-condition issues, including actor and time, safe-to-drive changes, repair or return disposition, reopening, and closure evidence.
- Rules-based alert routing, assignment policies, reminders, and escalation histories.
- Role-specific saved views for salesperson, store manager, used-car manager, and group manager.
- Advanced filters and bulk review without adding complexity to the default experience.

## Phase 3 — inventory intelligence

- Authorized read-only vAuto Factory Equipment enrichment for vehicles with missing or incomplete online stickers. Capture only VIN-specific structured equipment facts and an approved read-only source URL; never retain the generated image, credentials, cookies, autofill contents, or browser-session material.
- CRM-only vehicle resource enrichment for AutoCheck, sticker, and VIN-specific equipment.
- VIN-document coverage reconciliation for public-only and CRM-only vehicles, including exact-VIN validation, freshness, incomplete-document flags, richer parsed AutoCheck and sticker facts, and visible coverage gaps on the inventory table and vehicle details.
- Cross-OEM capability normalization that keeps the exact OEM name and evidence while mapping common customer questions such as adaptive cruise, lane centering, blind-spot monitoring, trailer packages, and upgraded option groups.
- Explainable alerts for pricing, aging, location disagreement, missing documents, equipment gaps, and hold/movement conflicts.

## Phase 4 — production platform

- Verified SSO identity and server-owned store/role permissions.
- Shared encrypted database for PC, Mac, and multi-user collaboration.
- Server-side field restrictions for customer names, hold reasons, comments, alerts, and CRM evidence; redacted logs, browser-secret isolation, and minimum-scope AI access.
- Immutable action audit, backups, retention, monitoring, and rollback.
- Approved notification delivery with retry and audit controls.
- Resilient scheduled ingestion and release health: the 9:00 AM scan, idempotent recovery runs, per-source completion manifests, latest-successful protection, stale/incomplete-source handling, app-cache refresh, and visible freshness without false removals or partial releases.
- Licensed local brand assets and a controlled release process.

## Release and collaboration workstream

- Reproducible Windows and Apple-silicon Mac setup with safe alternate-port handling.
- Git branches and reviewed pull requests, automated checks, current desktop/mobile visual acceptance, versioned database migrations, deployment, and rollback.
- Protected dealership runtime data remains outside Git; approved AI collaborators receive source code and synthetic fixtures, never live DealerMail records or customer data.
- A shared design-system migration will consolidate button, icon, typography, spacing, and action patterns; remove conflicting legacy style layers; enforce readable minimum text; and balance table density with scanability.
- Visual acceptance covers Inventory, vehicle details, Vehicle Moves, and Needs Attention at 1440×900, 1366×768, 390×844, and 320×568 before a production release.

## Product guardrails

- Default screens stay action-first and use dealership language, not source-system jargon.
- Advanced controls appear only when a role needs them or a user deliberately opens them.
- No hold, customer-contact, DealerMail, or external-system write is added without an approved API, verified authorization, and an audit trail.
- A hold, listing, expected date, or internal status code never proves availability, sale, delivery, funding, or physical custody.
- Rich motion remains restrained and optional; readability, speed, and reduced-motion accessibility take priority.

## Current implementation anchors

- `src/features/transfers/TransferTracker.tsx`
- `src/features/transfers/TransferRequestWorkspace.tsx`
- `src/features/transfers/types.ts`
- `src/features/attention/OperationsQueue.tsx`
- `src/features/inventory/VehicleWorkspace.tsx`
- `src/features/inventory/vehicle-feature-utils.ts`
- `server/workflow.mjs`
- `server/attention-workflow.mjs`
- `docs/SHARED_DATA_ARCHITECTURE.md`
