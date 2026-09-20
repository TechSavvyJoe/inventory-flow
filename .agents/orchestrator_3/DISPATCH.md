## 2026-09-18T17:46:05Z

You are the Project Orchestrator for Inventory Flow V2.
Your working directory is: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/orchestrator_3

The user has requested a full-scale visual and UX design overhaul of the Inventory Flow V2 platform:
"Requested team: Full team of specialized UI/UX, Motion, and Frontend agents
Full-scale visual and UX design overhaul of the Inventory Flow V2 platform, transforming it into a sleek, high-density, Apple- and Stripe-inspired enterprise dealership operating system.

Working directory: /Users/joegallant/Documents/GitHub/inventory-flow
Integrity mode: development

Requirements:
R1. Apple/Stripe-Inspired Design System & Visual Hierarchy:
- Refined color system: subtle slate/neutral tints, crisp borders (rgba(0,0,0,0.06) - rgba(0,0,0,0.12)), soft multi-layer box shadows, purposeful status accents (emerald green for ready, amber for warning, royal indigo/blue for info, ruby red for urgent/recall).
- Modern typography: deliberate scale and weight contrast (Inter/system-ui), tabular figures (font-variant-numeric: tabular-nums) for currency, VINs, miles, and dates, crisp pill badges with subtle border rings.
- Clean container surfaces: replace raw gray boxes with polished white cards featuring subtle inset borders, smooth corner radii (8px - 12px), and organized content grouping.

R2. Complete V2 Screen Polish (Inventory, VDP, Service, Transfers, Shortlist):
- Main Inventory View: Compact top decision rail with metric cards, unified search & filter bar with integrated pill toggles, and a clean data table with sticky header, elegant hover states, thumbnail styling, and aligned quick-action button groups.
- VDP Operational Cockpit: Eliminate dead whitespace and vertical scrolling with an organized 3-column dashboard; specs, financials, hold evidence, documents, and movement tracking organized in compact, proportional cards.
- Service & Transfers Screens: Elevate Kanban columns, SLA badges, route indicators, and custodian tags to match the new high-polish aesthetic.
- Customer Interest Shortlist & Comparison Tray: Refine the floating drawer with a frosted glass / sleek card preview design, quick comparison indicators, and smooth collapse/expand triggers.

R3. Fluid Motion & Tactile Micro-Interactions:
- Use Framer Motion spring physics (damping: 24, stiffness: 280) for opening/closing modals, drawer reveals, tab switches, and filter transitions.
- Interactive controls with subtle hover elevation (scale: 1.02), tap feedback (scale: 0.98), and animated status changes.
- Contextual quick-action popovers for common operations (holds, transfers, notes) with smooth backdrop fade and entry spring.

R4. Strict V1 Isolation & Baseline Protection:
- All modifications must remain strictly confined to V2 components and stylesheets (src/features/**/V2*, InventoryExperienceV2*, etc.).
- Original V1 baseline components (VehicleWorkspace.tsx, InventoryTable.tsx, InventoryPage.tsx, etc.) must remain untouched.

Acceptance Criteria:
Visual & UX Polish:
- [ ] Top metrics bar displays as a row of distinct, polished metric cards with icon accents and clear value-to-label proportions.
- [ ] Inventory table columns align with headers, feature crisp row separation, and display actions cleanly without visual clutter.
- [ ] VDP modal opens with a fluid spring animation and displays key specs, financials, and equipment without awkward overflow or massive empty gaps.
- [ ] Customer shortlist tray displays as a sleek bottom drawer with card previews and responsive interactions.
- [ ] Consistent color tokens, typography scales, and border-radius tokens applied across Inventory V2, Service V2, and Transfers V2.

Technical & Quality Guardrails:
- [ ] npm run build succeeds with 0 TypeScript and 0 Vite bundle errors.
- [ ] Automated test suites (npm run test:unit) pass with 100% success rate.
- [ ] Zero modifications to baseline V1 files (git status shows only V2 assets modified or added)."

Read the authoritative record at /Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md.
Maintain plan.md, progress.md, and BRIEFING.md in your working directory. Assemble your team of specialized UI/UX, Motion, and Frontend agents (explorers, workers, reviewers, challengers).
When complete, write handoff.md in your working directory and notify the sentinel with your completion report for Victory Audit.
