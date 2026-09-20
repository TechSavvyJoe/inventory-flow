## 2026-09-17T14:09:33Z

You are Worker 1 for Milestone 3 (worker_m3_1).
Working directory: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/worker_m3_1
Authoritative requirements document: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md
Project plan: /Users/joegallant/Documents/GitHub/inventory-flow/PROJECT.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Milestone 3 Scope: App-Wide Page Upgrades: Inventory, Service & Transfers (R3, R2, R4).

Your exclusive write boundaries:
- `src/features/inventory/InventoryTableV2.tsx` & `InventoryTableV2.css`
- `src/features/inventory/InventoryExperienceV2.tsx` & `InventoryPageV2.tsx`
- `src/features/service/ServicePageV2.tsx` & `ServicePageV2.css`
- `src/features/transfers/TransfersPageV2.tsx` & `TransfersPageV2.css`
- Unit tests for V2 pages in `tests/unit/`

DO NOT modify V1 baseline components (Guardrail G1):
- `src/features/inventory/VehicleWorkspace.tsx`
- `src/features/inventory/InventoryExperience.tsx`
- `src/features/inventory/InventoryPage.tsx`
- `src/features/service/ServicePage.tsx`
- `src/features/transfers/TransfersPage.tsx`

Implementation Requirements:
1. Inventory Table V2 (`src/features/inventory/InventoryTableV2.tsx` & `InventoryTableV2.css`):
   - Dense, high-utility table with sticky header (`position: sticky; top: 0; z-index: 10; background: var(--v10-surface-header); font-size: 12px; font-weight: 600; text-transform: uppercase;`).
   - Compact rows with monospace VIN/Stock chips using `CopyableValue` (with animated checkmark feedback).
   - Inline status badges (hold status, service readiness stage).
   - Quick action shortcuts in Actions column ("View", "Move", "Request") with Framer Motion hover/tap response.
   - Connected into `InventoryExperienceV2.tsx` and `InventoryPageV2.tsx`.
2. Service Board V2 (`src/features/service/ServicePageV2.tsx` & `ServicePageV2.css`):
   - Multi-column readiness Kanban board ("Needs Service", "In Service", "Ready for Delivery") alongside list view toggle.
   - 1-click quick action buttons directly on cards: "Start Service" on waiting cards, "Mark Ready" on in-service cards with optimistic status transitions and animated badge morphing.
3. Transfers Movement View V2 (`src/features/transfers/TransfersPageV2.tsx` & `TransfersPageV2.css`):
   - High-utility movement tracking view with route (Origin -> Destination), custodian, countdown timer, and overdue highlights.
   - Inline action progression buttons on queue cards.
4. Framer Motion Integration:
   - Smooth view cross-fade transitions and micro-interactions (`whileHover`, `whileTap`, `AnimatePresence`).
5. Strict Design System Compliance:
   - All font sizes must be >= 12px (NO 11px or smaller).
   - Zero raw hex colors (`#...`). Use CSS variables (`var(--v10-surface)`, `var(--v10-border)`, `var(--v10-ink-strong)`, `var(--ifx-success)`, `var(--ifx-warning)`, etc.).
6. Run verification commands and document exact outputs in your handoff report:
   - `node scripts/check-design-system.mjs`
   - `node scripts/check-repo-safety.mjs`
   - `node ./node_modules/typescript/bin/tsc -p tsconfig.app.json`
   - `node ./node_modules/vite/bin/vite.js build`
   - `node ./node_modules/vitest/vitest.mjs run tests/e2e`
   - `node ./node_modules/vitest/vitest.mjs run tests/unit`
7. Write your complete handoff report to /Users/joegallant/Documents/GitHub/inventory-flow/.agents/worker_m3_1/handoff.md.
8. When done, send a concise completion message back to the orchestrator.
