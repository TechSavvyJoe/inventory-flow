# Original User Request

## Initial Request — 2026-09-17T04:39:47Z

Build a comprehensive V2 experience for the Inventory Flow application, featuring high-density data layouts, contextual interactive quick-action buttons across data cards, and fluid Framer Motion transition animations across all main screens, while keeping the original V1 production code strictly safe and intact.

Working directory: /Users/joegallant/Documents/GitHub/inventory-flow
Integrity mode: demo

## Safety & Non-Destructive Guardrail

### G1. Strict Code Preservation
- Do NOT overwrite, alter, or delete existing V1 baseline components (e.g., `VehicleWorkspace.tsx`, original page files).
- All redesigned components must be created as dedicated V2 implementations (e.g., `VehicleWorkspaceV2.tsx`, `VehicleWorkspaceV2.css`, `InventoryPageV2.tsx`, etc.).
- The dev environment should route to the V2 components cleanly without destructively replacing original baseline assets.

## Requirements

### R1. High-Density VDP Layout (Function Over Form)
- Redesign the Vehicle Detail Page (VDP) workspace (`VehicleWorkspaceV2.tsx`) to eliminate wasted whitespace and prevent excessive vertical scrolling.
- Balance the layout columns so cards (such as document cards, specs, and hold context) are proportional, unclipped, and never awkwardly squeezed or overflowing.
- Present all critical operational data (specs, financials, hold/dealermail context, service readiness, key equipment, and document previews) at a glance without hiding information behind buried tabs.

### R2. Contextual Quick Actions & Micro-Interactions
- Embed functional, animated quick-action buttons and elements directly inside individual data cards (e.g., "Update Hold", "Mark Ready", "Track Movement", "Add Note").
- Provide immediate, polished animated feedback (hover states, click response, status badge transitions) for all interactive elements.

### R3. App-Wide Page Upgrades
- Extend the high-density, high-utility design to the other core screens (Inventory list/table, Service board, Transfers view).
- Ensure consistent styling, dense information hierarchy, and actionable controls across all pages.

### R4. Fluid Transition Animations
- Integrate Framer Motion to create smooth, natural transitions when opening/closing the VDP, switching between views, and updating card states.

## Verification Resources & Environment
- **Dev Command**: Use `npm run dev:demo` to run both the API and frontend with synthetic vehicle data on `http://127.0.0.1:4173`.
- **Build Verification**: Run `npm run build` to ensure all TypeScript and Vite build checks pass.

## Acceptance Criteria

### Automated Verification
- [ ] `npm run build` passes with 0 TypeScript and 0 Vite bundle errors.
- [ ] Framer Motion is installed and imported in V2 components.
- [ ] Original V1 baseline files (`VehicleWorkspace.tsx`, etc.) remain intact and uncorrupted.

### Objective Functional & Visual Criteria
- [ ] **VDP Layout Density**: All primary vehicle information sections (specs, financials, hold/dealermail details, service status, equipment, documents) are visible in the workspace without clipping, squeezed elements, or horizontal container overflow.
- [ ] **Quick Actions**: At least 3 contextual quick-action triggers are present on data cards (e.g., within hold context, service readiness, movement) with distinct hover and click animations.
- [ ] **App-Wide Consistency**: The main inventory table/list and workflow views reflect the upgraded styling and responsive density.
- [ ] **Motion Quality**: Page transitions and modal disclosures animate smoothly using Framer Motion with no jarring layout shifts or console errors.

## Follow-up — 2026-09-18T02:27:53Z

# Teamwork Project Prompt — Draft

> Status: Ready for launch — awaiting user approval
> Goal: Delegate to teamwork_preview
> Requested team: Full team

Fix the CSS and HTML layout issues in the `InventoryExperienceV2` and `InventoryTableV2` components. The top metrics area is currently unstyled and stacked vertically, and the table columns need alignment fixes to restore the high-density design.

Working directory: /Users/joegallant/Documents/GitHub/inventory-flow
Integrity mode: development

## Requirements

### R1. Restore Top Section Layout
Fix the styling in `InventoryExperienceV2` so that the metrics (Public units, Current holds, etc.), the search bar, and the filter pills are arranged in a polished, horizontal, high-density layout. Remove the raw, unstyled vertical stacking.

### R2. Fix Table Column Alignment
Ensure the `InventoryTableV2` columns and rows are perfectly aligned. Maintain the fix where `display: flex` is applied to inner `<div>` wrappers inside `<td>` elements, rather than the `<td>` tags themselves, to prevent the table grid from breaking.

### R3. Safe V2 Isolation
Make changes exclusively to the V2 files (e.g., `InventoryExperienceV2.tsx`, `InventoryTableV2.tsx`, `InventoryTableV2.css`). Do not mutate the original V1 baseline components.

## Acceptance Criteria

### Visual Layout
- [ ] Top metrics (Public units, Current holds, etc.) appear in a proper horizontal grid or row.
- [ ] Search input and its helper text are styled and aligned, not floating awkwardly.
- [ ] Table headers visually match the widths of the data columns below them.

### Code Quality & Tests
- [ ] `npm run build` completes with 0 errors.
- [ ] Existing tests pass (`npm run test:unit`).

## Follow-up — 2026-09-18T17:40:27Z

Requested team: Full team of specialized UI/UX, Motion, and Frontend agents

Full-scale visual and UX design overhaul of the Inventory Flow V2 platform, transforming it into a sleek, high-density, Apple- and Stripe-inspired enterprise dealership operating system.

Working directory: /Users/joegallant/Documents/GitHub/inventory-flow
Integrity mode: development

## Requirements

### R1. Apple/Stripe-Inspired Design System & Visual Hierarchy
Establish a cohesive, modern visual language across all V2 views:
- Refined color system: subtle slate/neutral tints, crisp borders (`rgba(0,0,0,0.06)` - `rgba(0,0,0,0.12)`), soft multi-layer box shadows, and purposeful status accents (emerald green for ready, amber for warning, royal indigo/blue for info, ruby red for urgent/recall).
- Modern typography: deliberate scale and weight contrast (Inter/system-ui), tabular figures (`font-variant-numeric: tabular-nums`) for currency, VINs, miles, and dates, crisp pill badges with subtle border rings.
- Clean container surfaces: replace raw gray boxes with polished white cards featuring subtle inset borders, smooth corner radii (8px - 12px), and organized content grouping.

### R2. Complete V2 Screen Polish (Inventory, VDP, Service, Transfers, Shortlist)
- **Main Inventory View**: Compact top decision rail with metric cards, unified search & filter bar with integrated pill toggles, and a clean data table with sticky header, elegant hover states, thumbnail styling, and aligned quick-action button groups.
- **VDP Operational Cockpit**: Eliminate dead whitespace and vertical scrolling with an organized 3-column dashboard; specs, financials, hold evidence, documents, and movement tracking organized in compact, proportional cards.
- **Service & Transfers Screens**: Elevate Kanban columns, SLA badges, route indicators, and custodian tags to match the new high-polish aesthetic.
- **Customer Interest Shortlist & Comparison Tray**: Refine the floating drawer with a frosted glass / sleek card preview design, quick comparison indicators, and smooth collapse/expand triggers.

### R3. Fluid Motion & Tactile Micro-Interactions
- Use Framer Motion spring physics (`damping: 24, stiffness: 280`) for opening/closing modals, drawer reveals, tab switches, and filter transitions.
- Interactive controls with subtle hover elevation (`scale: 1.02`), tap feedback (`scale: 0.98`), and animated status changes.
- Contextual quick-action popovers for common operations (holds, transfers, notes) with smooth backdrop fade and entry spring.

### R4. Strict V1 Isolation & Baseline Protection
- All modifications must remain strictly confined to V2 components and stylesheets (`src/features/**/V2*`, `InventoryExperienceV2*`, etc.).
- Original V1 baseline components (`VehicleWorkspace.tsx`, `InventoryTable.tsx`, `InventoryPage.tsx`, etc.) must remain untouched.

## Acceptance Criteria

### Visual & UX Polish
- [ ] Top metrics bar displays as a row of distinct, polished metric cards with icon accents and clear value-to-label proportions.
- [ ] Inventory table columns align with headers, feature crisp row separation, and display actions cleanly without visual clutter.
- [ ] VDP modal opens with a fluid spring animation and displays key specs, financials, and equipment without awkward overflow or massive empty gaps.
- [ ] Customer shortlist tray displays as a sleek bottom drawer with card previews and responsive interactions.
- [ ] Consistent color tokens, typography scales, and border-radius tokens applied across Inventory V2, Service V2, and Transfers V2.

### Technical & Quality Guardrails
- [ ] `npm run build` succeeds with 0 TypeScript and 0 Vite bundle errors.
- [ ] Automated test suites (`npm run test:unit`) pass with 100% success rate.
- [ ] Zero modifications to baseline V1 files (`git status` shows only V2 assets modified or added).
