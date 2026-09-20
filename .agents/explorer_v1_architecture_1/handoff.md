# Architecture & Routing Analysis Handoff Report

**Agent**: `explorer_v1_architecture_1` (V1 Architecture Explorer)  
**Date**: 2026-09-17T04:49:00Z  
**Authoritative Document**: `/Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md`  
**Working Directory**: `/Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_v1_architecture_1`

---

## 1. Observation

### 1.1 Project Structure & Entry Points
- **Entry HTML**: `/Users/joegallant/Documents/GitHub/inventory-flow/index.html` mounts `<div id="root"></div>` and executes `<script type="module" src="/src/main.tsx"></script>`.
- **Root Component (`src/main.tsx:24-30`)**:
  ```tsx
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
  ```
  `main.tsx` imports Fontsource Inter font weights and 12 CSS layers:
  `./design-system/tokens.css`, `./design-system/components.css`, `./styles/tokens.css`, `./styles/global.css`, `./styles/shell.css`, `./styles/premium-refinement.css`, `./styles/vdp-final-refinement.css`, `./styles/typography-hardening.css`, `./styles/app-system-polish.css`, `./styles/inventory-experience-final.css`, `./styles/readability-final.css`, `./styles/inventory-production-v10.css`.
- **Application Routing Core (`src/App.tsx:12-35`)**:
  `<App />` renders `<AppDataProvider><RouteLoadBoundary><AppShell><AppRoutes /></AppShell></RouteLoadBoundary></AppDataProvider>`.
  `AppRoutes` declares routes:
  - `/` -> `<InventoryPage homeMode />`
  - `/inventory` -> `<InventoryPage />`
  - `/transfers` -> `<TransfersPage />`
  - `/transfers/new` -> `<TransfersPage />`
  - `/attention` -> `<AttentionPage />`
  - `/updates` -> `<InventoryUpdatesPage key={`${currentUser}:${role}:${homeStore}`} />`
  - `/service` -> `<ServicePage key={`${currentUser}:${role}:${homeStore}`} />`
  - `/manager` -> `<ManagerPage />` (role-gated: `manager` or `group_manager`)
  - `/admin` -> `<AdminPage />` (role-gated: `group_manager`)
  - `*` -> `<Navigate to="/" replace />`
- **Route Modules & Lazy Loading (`src/app/routeModules.ts:18-50`)**:
  Uses `React.lazy` to load pages asynchronously and exposes `preloadRoute(pathname)` to warm up page bundles upon URL changes.

### 1.2 Dev/Demo Environment & Server Setup
- **Scripts in `package.json`**:
  - `"dev:demo"`: `concurrently -k -n demo,web -c blue,cyan "node --watch scripts/start-synthetic-demo.mjs" "vite --host 127.0.0.1"`
  - `"dev:api"`: `node --watch server/index.mjs`
  - `"dev:web"`: `vite --host 127.0.0.1`
  - `"build"`: `tsc -b && vite build && node scripts/package-extension.mjs`
  - `"test"`: `vitest run`
  - `"check"`: `pnpm check:repo-safety && pnpm check:design-system && pnpm test && pnpm build`
- **Vite Configuration (`vite.config.ts:6-12`)**:
  - Frontend listens on `http://127.0.0.1:4173` (`strictPort: true`).
  - Proxies `/api` -> `http://127.0.0.1:4174`.
- **Synthetic Demo API (`scripts/start-synthetic-demo.mjs:21-38`)**:
  - Runs in-memory SQLite database (`:memory:`) on port 4174.
  - Loads synthetic dataset using `buildSyntheticRelease({ includeDemoChanges: true })` from `fixtures/synthetic-release.mjs`.
  - Wraps bootstrap and vehicle detail handlers with synthetic vehicle illustrations from `fixtures/synthetic-photos.mjs`.
  - Seeds synthetic workflow mutations (`seedSyntheticWorkflow()`) with 3 service readiness records (`TESTDATAHWELL0001`, `TESTDATAHWELL0002`, `TESTDATAFWELL0001`) and 2 cross-store vehicle moves.

### 1.3 State Management & Vehicle Data Flow
- **Global Context (`src/app/AppDataContext.tsx`)**:
  - Provides: `data: BootstrapData | null`, `loading: boolean`, `error: string | null`, `homeStore: StoreName`, `setHomeStore`, `role: UserRole`, `setRole`, `currentUser: string`, `refresh: () => Promise<void>`, `submitTransfer`, `addTransferEvent`, `addAttentionEvent`.
  - `homeStore` defaults to `Howell` (persisted in `localStorage['maxey-home-store']`).
  - `role` defaults to `manager` (persisted in `localStorage['maxey-role']`).
  - Fetch cycle: calls `getBootstrap(homeStore, role)` from `src/lib/api.ts` with demo identity headers (`x-inventory-demo-role`, `x-inventory-demo-store`, `x-inventory-demo-user`).
- **Vehicle Data Adapters (`src/app/adapters.ts:402-530`)**:
  - `toInventoryVehicle(vehicle: VehicleRecord, data: BootstrapData, transfer?: TransferRecord): InventoryVehicle`
  - Combines summary data from `BootstrapData.vehicles` with:
    - Real-time service readiness (`vehicle.serviceReadiness`)
    - Custody state from `data.transfers`
    - DealerMail hold evidence and signals (`vehicle.dealerMailHold`)
    - AutoCheck, Window Sticker, Ford OASIS, and factory equipment
- **Lazy Detail Fetching (`src/features/inventory/InventoryPage.tsx:101-114`)**:
  - Full vehicle detail is fetched on-demand when a VIN is selected:
    `getVehicle(selectedVehicleId, role, homeStore)`
  - Results are cached in `vehicleDetails: Record<string, VehicleRecord>` inside `InventoryPage`.
- **Vehicle Workspace (VDP) Disclosure (`src/features/inventory/InventoryExperience.tsx:734-748`)**:
  - Rendered when `selectedVehicleId` is set:
    ```tsx
    {selectedVehicle ? (
      <VehicleWorkspace
        vehicle={selectedVehicle}
        initialTab={workspaceInitialTab}
        homeStore={homeStore}
        canRequestVehicle={canRequestSelected}
        returnFocusRef={workspaceReturnFocusRef}
        onClose={closeVehicleWorkspace}
        onViewVehicle={onViewVehicle}
        onRequestVehicle={onRequestVehicle}
        onTrackMovement={onTrackMovement}
        onOpenListing={onOpenListing}
        onOpenSourceRecord={onOpenSourceRecord}
      />
    ) : null}
    ```

### 1.4 Baseline Test Suite & In-Place Mutation Failure
- Running `vitest run` on the untouched V1 baseline:
  **Result**: `106 test files passed, 1349 tests passed (0 failed).`
- When `src/features/inventory/InventoryExperience.tsx` line 21 was previously modified in the working copy to:
  `import { VehicleWorkspaceV2 as VehicleWorkspace } from "./VehicleWorkspaceV2";`
  **Result**: 2 test suites failed:
  1. `tests/unit/inventory-modern-ui.test.tsx` (failed at line expecting in-app handoff)
  2. `src/features/inventory/InventoryExperience.modern.test.tsx:219`:
     ```
     expect(within(dialog).getByRole('tab', { name: section, selected: true }))
     ```
- When `src/features/inventory/InventoryExperience.tsx` was restored to its baseline import (`import { VehicleWorkspace } from "./VehicleWorkspace";`), both tests passed immediately (36/36) and the entire suite passed 106/106.

### 1.5 Design System Regression Linter (`scripts/check-design-system.mjs`)
- Running `npm run check:design-system`:
  Detected failures in untracked `VehicleWorkspaceV2.css`:
  - `smallText increased from 0 to 2` (declarations with `font-size: < 12px`)
  - `rawColors increased from 0 to 1` (raw hex color codes outside `tokens.css`)
- Rule: New CSS files for V2 are evaluated against baseline `{ smallText: 0, rawColors: 0 }`. All fonts must be `>= 12px` and colors must use CSS variables (`var(--color-...)` or `var(--token-...)`).

### 1.6 Framer Motion Dependency Status
- `npm list framer-motion`: Returns empty (`framer-motion` is not yet installed in `package.json` / `node_modules`).
- React version in `package.json`: `19.2.8`.
- Note: Installing Framer Motion requires compatibility with React 19 (`framer-motion` v11/v12 or `motion`).

---

## 2. Logic Chain

1. **Premise**: Guardrail G1 strictly dictates that existing V1 baseline components (`VehicleWorkspace.tsx`, `InventoryExperience.tsx`, `InventoryPage.tsx`, etc.) must not be overwritten, altered, or deleted.
2. **Observation**: Directly editing `InventoryExperience.tsx` to substitute `VehicleWorkspaceV2` broke `InventoryExperience.modern.test.tsx` and `inventory-modern-ui.test.tsx`, violating the acceptance criterion that baseline tests pass and V1 baseline files remain intact.
3. **Inference**: V1 baseline files have extensive regression test coverage (1349 tests) that assert exact V1 DOM structures, tabs, and class names.
4. **Resolution**: V2 components must exist as parallel, standalone files:
   - `VehicleWorkspaceV2.tsx` (replaces modal layout with high-density VDP)
   - `InventoryTableV2.tsx` & `InventoryExperienceV2.tsx`
   - `InventoryPageV2.tsx`
   - `TransfersPageV2.tsx`
   - `ServicePageV2.tsx`
5. **Routing Strategy**:
   - The application routing in `App.tsx` (or an `ExperienceVersionContext` / `AppRoutes` layer) can detect the desired experience mode.
   - Defaults to `'v2'` in dev/demo mode (`import.meta.env.DEV` or `?v=2` or `localStorage['maxey-ui-version']`).
   - Supports switching to `'v1'` via URL parameter `?v=1` or UI toggle in `AppShell` or `utilityDialog`.
   - When `'v2'` is active, routes `/`, `/inventory`, `/transfers`, `/service` render their V2 counterparts.
   - When `'v1'` is active, routes render original V1 baseline pages.
   - Dedicated explicit routes `/v2`, `/v2/inventory`, `/v2/transfers`, `/v2/service` can also be registered for unambiguous direct access.
   - Because existing unit tests import `InventoryPage.tsx` and `InventoryExperience.tsx` directly, those tests continue running against V1 with 100% success rate without any mock overrides.
   - Dedicated V2 tests (`VehicleWorkspaceV2.test.tsx`, etc.) can test the V2 experience in isolation.

---

## 3. Caveats

1. **Untracked Workspace Artifacts**: The root directory contains exploratory scripts (`patch_workspace.cjs`, `patch_dashboard.cjs`, etc.) and preliminary `VehicleWorkspaceV2.tsx` / `VehicleWorkspaceV2.css`. These are untracked and currently have design system violations (sub-12px text, hex color) that implementers must fix.
2. **React 19 & Framer Motion**: React is at version `19.2.8`. `framer-motion` package installation must be validated against React 19 peer dependencies (e.g. `--legacy-peer-deps` or installing `motion` / `framer-motion@latest`).
3. **AppShell Navigation**: Links in `AppShell` (`NAV_ITEMS`) point to `/inventory`, `/transfers`, `/service`. Using the mode-aware router in `App.tsx` ensures these links automatically open V2 views without requiring invasive edits to `AppShell.tsx`.

---

## 4. Conclusion

The technical architecture of Inventory Flow allows for a clean, non-destructive V2 experience:
- **Zero V1 regressions**: Keeping `VehicleWorkspace.tsx`, `InventoryExperience.tsx`, `InventoryPage.tsx`, `TransfersPage.tsx`, and `ServicePage.tsx` 100% intact guarantees that all 106 test files and 1349 unit tests pass.
- **Clean Coexistence Routing**: Implementing a lightweight mode selector in `App.tsx` / `routeModules.ts` (defaulting to V2 in development and demo mode, with `?v=1` fallback) satisfies Guardrail G1 completely.
- **Shared Contracts**: V2 components can import existing types (`InventoryVehicle`, `VehicleRecord`, `BootstrapData`, `StoreName`, `UserRole`) from `src/types.ts` and `src/features/inventory/types.ts`, data adapters from `src/app/adapters.ts`, API functions from `src/lib/api.ts`, and accessibility helpers (`useContainedFocus`, `useModalBackgroundIsolation`) from `src/lib/`.
- **CSS Strictness**: All new CSS for V2 (`VehicleWorkspaceV2.css`, etc.) must use CSS variables exclusively and maintain font sizes `>= 12px` to pass `scripts/check-design-system.mjs`.

---

## 5. Verification Method

To independently verify the findings in this report:

1. **Verify Baseline Integrity & Tests**:
   ```bash
   git status --short
   # Verify that no V1 baseline files in src/ are modified
   npm test
   # Expected: 106 passed (106), 1349 passed (1349)
   ```

2. **Verify Production Build**:
   ```bash
   npm run build
   # Expected: tsc -b && vite build succeeds with 0 errors
   ```

3. **Verify Design System Guard**:
   ```bash
   npm run check:design-system
   # Identifies any CSS rule breaches in newly added CSS files
   ```

4. **Verify Demo Execution**:
   ```bash
   npm run dev:demo
   # Spawns synthetic demo API on 4174 and frontend on 4173 with synthetic data
   ```

---

## 6. Shared Resource Inventory for V2 Implementers

### Data Models & Types (`src/types.ts` & `src/features/inventory/types.ts`)
| Type / Interface | Purpose |
|---|---|
| `InventoryVehicle` | Enriched vehicle model containing specs, hold signals, service state, equipment, movement, documents |
| `VehicleRecord` | Raw backend vehicle entity returned from `/api/vehicles/:vin` |
| `BootstrapData` | Top-level payload with `vehicles`, `transfers`, `attention`, `meta`, `access` |
| `StoreName` | `'Howell' \| 'Fowlerville' \| 'Ford Detroit' \| 'Lincoln'` |
| `UserRole` | `'sales' \| 'manager' \| 'group_manager' \| 'coordinator' \| 'porter' \| 'driver'` |
| `VehicleWorkspaceProps` | Standard prop contract for VDP workspace modals/drawers |
| `VehicleWorkspaceTab` | `'overview' \| 'equipment' \| 'movement' \| 'hold' \| 'timeline' \| 'data'` |
| `InventoryFilters`, `InventorySort` | Filter and multi-sort criteria for inventory tables |
| `TransferRecord`, `TransferDetail` | Transfer state, workflow step, allowed actions, timeline events |
| `ServiceReadinessStatus` | `'unknown' \| 'needs_service' \| 'in_service' \| 'serviced'` |

### API Clients (`src/lib/api.ts`)
| Function | Endpoint & Behavior |
|---|---|
| `getBootstrap(store, role)` | `GET /api/bootstrap` — full catalog and operational state |
| `getVehicle(vin, role, store)` | `GET /api/vehicles/:vin` — detailed vehicle records, specs, and documents |
| `updateServiceReadiness(vin, input, role, store)` | `POST /api/vehicles/:vin/service` — manager service confirmation |
| `createTransfer(input, role, store)` | `POST /api/transfers` — initiates vehicle move request |
| `appendTransferEvent(id, input, role, store)` | `POST /api/transfers/:id/events` — advance move lifecycle |
| `appendAttentionEvent(id, input, role, store)` | `POST /api/attention/:id/events` — action item disposition |

### Shared Adapters & Formatters
| Helper | Source File | Purpose |
|---|---|---|
| `toInventoryVehicle` | `src/app/adapters.ts` | Maps raw `VehicleRecord` + `BootstrapData` -> `InventoryVehicle` |
| `inventoryMetrics` | `src/app/adapters.ts` | Computes 4 decision rail metrics for home store |
| `formatCurrency`, `formatNumber`, `formatDate`, `formatDateTime` | `src/lib/format.ts` | Consistent currency, date, and number formatting |
| `serviceWorkflowStatus`, `serviceStatusLabel` | `src/lib/service-readiness.ts` | Normalizes service readiness indicators |
| `useContainedFocus` | `src/lib/useContainedFocus.ts` | Modal/drawer focus trapping and Escape handling |
| `useModalBackgroundIsolation` | `src/lib/useModalBackgroundIsolation.ts` | Scroll locking and accessibility masking |
| `CopyableValue` | `src/components/CopyableValue.tsx` | Interactive animated copy button with visual state feedback |
| `VehicleThumbnail` | `src/components/VehicleThumbnail.tsx` | Responsive photo renderer with fallback icon |
| `SourceWarning` | `src/components/SourceWarning.tsx` | Data freshness notification banner |

### Synthetic Fixtures & Generators (`fixtures/`)
| Fixture | Exports | Role |
|---|---|---|
| `fixtures/synthetic-release.mjs` | `buildSyntheticRelease`, `SYNTHETIC_NOW` | Complete mock vehicle catalog across 4 stores with specs and history |
| `fixtures/synthetic-photos.mjs` | `withSyntheticIllustrations`, `withSyntheticVehicleIllustration` | Attaches demo car photos without external network access |
| `fixtures/synthetic-membership-admin.mjs` | `createSyntheticMembershipAdmin` | Group manager directory mock |
| `scripts/start-synthetic-demo.mjs` | `startInventoryServer` | Harness combining API, SQLite, and demo data |

---

## 7. Recommended V2 Routing Implementation Plan

1. **Step 1: Install Framer Motion**:
   Run `npm install framer-motion` (or `pnpm add framer-motion`) and verify bundle build with `npm run build`.
2. **Step 2: Create V2 Architecture Files**:
   - `src/app/ExperienceVersionContext.tsx` or version detector hook:
     Reads `?v=1` or `?v=2` from `window.location.search`, checks `localStorage['maxey-experience-version']`, defaults to `'v2'` in dev/demo.
   - `src/features/inventory/VehicleWorkspaceV2.tsx` & `VehicleWorkspaceV2.css`:
     The high-density VDP workspace, using Framer Motion (`AnimatePresence`, `motion.div`), quick actions, and compliant design tokens (no sub-12px font, no hex colors).
   - `src/features/inventory/InventoryTableV2.tsx` & `InventoryExperienceV2.tsx`:
     The upgraded inventory view incorporating quick action cards and fluid transitions.
   - `src/features/inventory/InventoryPageV2.tsx`:
     Connects `useAppData`, lazy vehicle detail fetching, and renders `InventoryExperienceV2`.
   - `src/features/transfers/TransfersPageV2.tsx` & `src/features/service/ServicePageV2.tsx`:
     Upgraded moves and service views.
3. **Step 3: Connect in `App.tsx`**:
   In `src/App.tsx`, dynamically render the V2 page components when in V2 mode, or V1 page components when in V1 mode.
   Register explicit routes `/v2`, `/v2/inventory`, `/v2/transfers`, `/v2/service`.
4. **Step 4: Verify**:
   - `npm test`: all 1349 V1 unit tests pass + any newly added V2 tests pass.
   - `npm run check:design-system`: passes with 0 regressions.
   - `npm run build`: passes with 0 errors.
   - `npm run dev:demo`: launches on `127.0.0.1:4173` demonstrating V2.
