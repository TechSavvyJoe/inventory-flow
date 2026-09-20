# Project: Inventory Flow V2 Redesign

## Architecture
The Inventory Flow application is a high-performance dealership inventory management system built with React 19, TypeScript, Vite, and CSS tokens.
The V2 redesign introduces a high-density, at-a-glance operational cockpit for the Vehicle Detail Page (VDP), contextual quick actions on data cards, app-wide page upgrades (Inventory table, Service board, Transfers view), and fluid Framer Motion transitions.

### Module Boundaries & Coexistence (Guardrail G1)
To guarantee strict V1 baseline preservation:
- **Baseline V1 Components (UNTOUCHED)**:
  - `src/features/inventory/VehicleWorkspace.tsx`
  - `src/features/inventory/InventoryExperience.tsx`
  - `src/features/inventory/InventoryPage.tsx`
  - `src/features/transfers/TransfersPage.tsx`
  - `src/features/service/ServicePage.tsx`
- **Dedicated V2 Implementations**:
  - `src/features/inventory/VehicleWorkspaceV2.tsx` & `VehicleWorkspaceV2.css`
  - `src/features/inventory/InventoryTableV2.tsx` & `InventoryTableV2.css`
  - `src/features/inventory/InventoryExperienceV2.tsx`
  - `src/features/inventory/InventoryPageV2.tsx`
  - `src/features/service/ServicePageV2.tsx` & `ServicePageV2.css`
  - `src/features/transfers/TransfersPageV2.tsx` & `TransfersPageV2.css`
- **Dynamic Routing Seam**:
  - `src/app/routeModules.ts`: Dynamically imports V2 page components for dev/demo mode (`npm run dev:demo`) while allowing `?v=1` fallback. Because no unit tests import `routeModules.ts`, all existing V1 unit tests (106 files, 1349 tests) continue testing V1 components directly with 100% pass rate.
- **Motion Subsystem**:
  - Self-contained, typed `framer-motion` runtime module in `node_modules/framer-motion` supporting `motion`, `AnimatePresence`, spring transitions, `whileHover`, `whileTap`, and respecting `prefers-reduced-motion`.
- **Design System Rules**:
  - Zero tolerance for `font-size < 12px` and zero raw hex colors outside `tokens.css` (enforced via `scripts/check-design-system.mjs`).

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Baseline V1 Code Preservation | Keep all original V1 files strictly unmodified and revert any prior temporary imports in InventoryExperience.tsx | M1 | ORIGINAL_REQUEST G1 |
| 2 | Framer Motion Runtime Package | Provide self-contained typed framer-motion in node_modules to satisfy build and runtime animations | M1 | ORIGINAL_REQUEST R4, spec_miner |
| 3 | Design System CSS Token Hardening | Fix sub-12px fonts and raw hex colors in V2 CSS to satisfy scripts/check-design-system.mjs | M1 | spec_miner, explorer_v1 |
| 4 | Clean Dynamic Routing Seam | Configure routeModules.ts to route to V2 pages in dev/demo with ?v=1 fallback | M1 | explorer_v1, spec_miner |
| 5 | Persistent Cockpit Header | Fixed top bar with vehicle title, price, MSRP delta, identifiers, and quick action dock | M2 | ORIGINAL_REQUEST R1, mockup |
| 6 | 1-Click Copyable Identifiers | Instant copy for Stock # and 17-char VIN with animated checkmark feedback | M2 | CLAUDE.md, explorer_pages |
| 7 | High-Density 3-Column Cockpit Layout | Proportional 3-column desktop grid (Identity/Specs, Operations/Custody, Equipment/Docs/Activity) without dead whitespace | M2 | ORIGINAL_REQUEST R1, explorer_pages |
| 8 | Responsive Vehicle Media Frame | Primary vehicle thumbnail with photo count badge, thumbnail strip, and graceful fallback when 0 photos | M2 | explorer_pages, mockup |
| 9 | Financials & Pricing Card | Sale price, MSRP, invoice/cost delta, and transaction breakdown with tabular numerals | M2 | ORIGINAL_REQUEST R1, DESIGN_SPEC |
| 10 | Technical Specifications Card | Compact 2-column definition list for powertrain, transmission, drivetrain, exterior/interior colors | M2 | ORIGINAL_REQUEST R1, explorer_pages |
| 11 | Hold & DealerMail Context Card | Active holds, backup holds, expiration timer, salesperson info, and integrated DealerMail handoff | M2 | ORIGINAL_REQUEST R1, explorer_pages |
| 12 | Service Readiness Card | Service stage (needs inspection, in service, serviced ready), inspection date, and technician notes | M2 | ORIGINAL_REQUEST R1, explorer_pages |
| 13 | Key Equipment & Packages Card | Standout factory equipment badges, package groups (FX4, Towing), and CPO warranty outlook | M2 | ORIGINAL_REQUEST R1, explorer_pages |
| 14 | 2x2 Document Cards Hub | Unclipped 2x2 grid for AutoCheck, Window Sticker, vAuto, OASIS preview cards without horizontal squeeze | M2 | ORIGINAL_REQUEST R1, explorer_pages |
| 15 | Quick Action: Update Hold | Direct in-card button to manage or review DealerMail hold | M2 | ORIGINAL_REQUEST R2 |
| 16 | Quick Action: Mark Ready / Start Service | 1-click in-card trigger to advance service readiness state | M2 | ORIGINAL_REQUEST R2 |
| 17 | Quick Action: Track / Request Movement | Direct in-card trigger on custody card to track or initiate vehicle transfer | M2 | ORIGINAL_REQUEST R2 |
| 18 | Quick Action: Take-Home Sheet | Quick button to generate deal desk take-home customer sheet preview | M2 | ORIGINAL_REQUEST R2, CLAUDE.md |
| 19 | Framer Motion VDP Disclosure | Spring scale and fade animation for VDP modal disclosure and backdrop blur | M2 | ORIGINAL_REQUEST R4 |
| 20 | Button & Badge Micro-Interactions | Animated hover lift, tap compression (whileTap), and status badge layout transitions | M2 | ORIGINAL_REQUEST R2, R4 |
| 21 | High-Density Inventory Table V2 | Sticky headers, compact rows, inline status pills, and responsive VDP modal trigger | M3 | ORIGINAL_REQUEST R3 |
| 22 | Inventory Table Micro-Actions | Quick action shortcuts and animated copy buttons in inventory rows | M3 | ORIGINAL_REQUEST R2, R3 |
| 23 | Service Board V2 | Multi-column readiness Kanban board (Needs Service, In Service, Ready for Delivery) with 1-click status triggers | M3 | ORIGINAL_REQUEST R3 |
| 24 | Transfers Movement View V2 | High-utility movement tracking view with route, custodian, countdown, and inline progression triggers | M3 | ORIGINAL_REQUEST R3 |
| 25 | View Switch Cross-Fade Animations | Coordinated Framer Motion transitions when switching views | M3 | ORIGINAL_REQUEST R4 |
| 26 | Mobile & Responsive Density (390px+) | Balanced single-column vertical stack for mobile viewports without horizontal scroll or squeezed cards | M2 | DESIGN_SPEC, spec_miner |
| 27 | Opaque-Box E2E Test Suite (Tiers 1-4) | Comprehensive requirement-driven test suite with >=11xN test cases covering all inventoried features | M4 | ORIGINAL_REQUEST, Project Pattern |
| 28 | Adversarial Coverage Hardening (Tier 5) | White-box challenger verification of edge cases, keyboard traps, and stress scenarios | M4 | Project Pattern |
| 29 | Forensic Integrity Audit | Systematic static and runtime verification that implementation is authentic with zero facades or cheating | M4 | Project Pattern |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Foundational Setup & Baseline Integrity | Restore V1 baseline files (clean InventoryExperience.tsx); install typed framer-motion; harden V2 CSS tokens for design-system linter; set up clean routeModules.ts routing seam. | none | DONE (107/107 test files, 1381 tests pass, framer-motion vendored, route seam live, audit clean) |
| M2 | High-Density VDP Cockpit & Contextual Quick Actions | Implement VehicleWorkspaceV2.tsx & CSS with 3-column cockpit (specs, financials, hold/dealermail, service, equipment, 2x2 docs), in-card quick actions (Hold, Service, Move, Take-Home), and Framer Motion modal & micro-interactions. | M1 | DONE (Gate Passed: 15/15 unit tests, 336/336 E2E tests, 0 design debt, Reviewer APPROVE, Auditor CLEAN) |
| M3 | App-Wide Page Upgrades: Inventory, Service & Transfers | Implement InventoryTableV2, InventoryExperienceV2, InventoryPageV2, ServicePageV2 (Kanban board with 1-click triggers), and TransfersPageV2 with fluid animations and design-system compliance. | M1, M2 | DONE (Gate Passed: 22/22 unit tests, 336/336 E2E tests, 0 design debt, Reviewer APPROVE, Auditor CLEAN) |
| M4 | Final Milestone: Full E2E Verification & Audit | Pass 100% of E2E test suite (Tiers 1-4) published by parallel E2E Testing Track; execute Tier 5 adversarial hardening; pass Forensic Integrity Audit. | M1, M2, M3, TEST_READY | DONE (Victory Gate Passed: 336/336 E2E tests, 38/38 Tier 5 adversarial tests, 1792/1792 full repo tests, 0 design debt, Build passes, Victory Audit CLEAN) |

---

## Interface Contracts

### VDP Workspace Contract (`VehicleWorkspaceV2.tsx`)
```ts
export interface VehicleWorkspaceProps {
  vehicle: InventoryVehicle;
  initialTab?: VehicleWorkspaceTab;
  homeStore: StoreName;
  canRequestVehicle?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onViewVehicle?: (vehicle: InventoryVehicle) => void;
  onRequestVehicle?: (vehicle: InventoryVehicle) => void;
  onTrackMovement?: (vehicle: InventoryVehicle) => void;
  onOpenListing?: (vehicle: InventoryVehicle) => void;
  onOpenSourceRecord?: (vehicle: InventoryVehicle, source: string) => void;
}
```

### Route Modules Contract (`src/app/routeModules.ts`)
```ts
// Clean dynamic route loaders for dev/demo:
export const loadInventoryPage: () => Promise<{ default: React.ComponentType<{ homeMode?: boolean }> }>;
export const loadTransfersPage: () => Promise<{ default: React.ComponentType }>;
export const loadServicePage: () => Promise<{ default: React.ComponentType }>;
```

### Service Action Contract (`src/lib/api.ts`)
```ts
export async function updateServiceReadiness(
  vin: string,
  input: {
    status: 'needs_service' | 'in_service' | 'serviced';
    confirmedBy: string;
    note?: string;
  },
  role?: UserRole,
  store?: StoreName
): Promise<{ success: boolean; vehicle: VehicleRecord }>;
```

---

## Code Layout

- `src/features/inventory/`:
  - `VehicleWorkspace.tsx` (V1 baseline - Read-Only)
  - `VehicleWorkspaceV2.tsx` (V2 high-density VDP)
  - `VehicleWorkspaceV2.css` (V2 VDP styles)
  - `InventoryTable.tsx` (V1 baseline - Read-Only)
  - `InventoryTableV2.tsx` (V2 high-density table)
  - `InventoryTableV2.css` (V2 table styles)
  - `InventoryExperience.tsx` (V1 baseline - Read-Only)
  - `InventoryExperienceV2.tsx` (V2 experience container)
  - `InventoryPage.tsx` (V1 baseline - Read-Only)
  - `InventoryPageV2.tsx` (V2 page container)
- `src/features/service/`:
  - `ServicePage.tsx` (V1 baseline - Read-Only)
  - `ServicePageV2.tsx` (V2 high-density Kanban board)
  - `ServicePageV2.css` (V2 service styles)
- `src/features/transfers/`:
  - `TransfersPage.tsx` (V1 baseline - Read-Only)
  - `TransfersPageV2.tsx` (V2 movement board)
  - `TransfersPageV2.css` (V2 transfers styles)
- `src/app/`:
  - `routeModules.ts` (Dynamic routing seam)
- `tests/e2e/`:
  - E2E Test Suite created by parallel E2E Testing Track
