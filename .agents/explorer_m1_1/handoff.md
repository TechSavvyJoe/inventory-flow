# Handoff Report — Milestone 1: Foundational Setup & Baseline Integrity

**Agent**: `explorer_m1_1` (Explorer 1, Milestone 1)  
**Date**: 2026-09-17T05:01:00Z  
**Recipient**: `parent` (`733c9114-e55f-4ccc-9c6e-1f3aefd4368b`)  
**Mission**: Investigate `src/features/inventory/InventoryExperience.tsx` line 21 restoration to pure V1, and design the non-destructive dynamic routing seam in `src/app/routeModules.ts` and `src/App.tsx` with `?v=1` fallback.

---

## 1. Observation

### 1.1 `src/features/inventory/InventoryExperience.tsx` Line 21
- Direct inspection of `src/features/inventory/InventoryExperience.tsx` (lines 20–22):
  ```tsx
  import { InventoryMobileList, InventoryTable, inventorySortSummary } from "./InventoryTable";
  import { VehicleWorkspace } from "./VehicleWorkspace";
  import { useInventoryDisclosure } from "./useInventoryDisclosure";
  ```
- Line 21 verbatim is:
  `import { VehicleWorkspace } from "./VehicleWorkspace";`
- Git status verification:
  `GIT_CONFIG_GLOBAL=/dev/null git diff src/features/inventory/InventoryExperience.tsx` produces zero diff (clean working tree).
- Test execution with pure V1 baseline:
  Running `vitest run` via `npx pnpm test` (or `vitest run --run`):
  ```
  Test Files  106 passed (106)
       Tests  1349 passed (1349)
    Duration  23.72s - 33.08s
  ```
  All 106 test files and 1349 tests pass with 100% success.
- Direct test consumers of `InventoryExperience.tsx`:
  - `src/features/inventory/InventoryExperience.modern.test.tsx` (16 tests)
  - `tests/unit/inventory-modern-ui.test.tsx` (8 tests)
  - `src/features/inventory/InventoryPage.tsx` (which is in turn tested by `tests/unit/inventory-search-privacy.test.tsx`)
- Direct test consumers of `VehicleWorkspace.tsx`:
  - `src/features/inventory/VehicleWorkspace.documents.test.tsx` (14 tests)
  - `src/features/inventory/TakeHomeSheet.test.tsx` (3 tests)
  - `src/app/adapters.custody.test.ts` (9 tests)

### 1.2 `src/app/routeModules.ts` and `src/App.tsx`
- Direct inspection of `src/app/routeModules.ts`:
  - Currently loads only V1 modules:
    ```ts
    const loadInventoryPage = () => import('../features/inventory/InventoryPage')
    const loadTransfersPage = () => import('../features/transfers/TransfersPage')
    const loadAttentionPage = () => import('../features/attention/AttentionPage')
    const loadManagerPage = () => import('../features/manager/ManagerPage')
    const loadInventoryUpdatesPage = () => import('../features/attention/InventoryUpdatesPage')
    const loadServicePage = () => import('../features/service/ServicePage')
    const loadAdminPage = () => import('../features/admin/AdminPage')
    ```
  - Exports static `React.lazy` definitions:
    ```ts
    export const InventoryPage = lazy(() =>
      loadInventoryPage().then((module) => ({ default: module.InventoryPage })),
    )
    export const TransfersPage = lazy(() =>
      loadTransfersPage().then((module) => ({ default: module.TransfersPage })),
    )
    export const ServicePage = lazy(() =>
      loadServicePage().then((module) => ({ default: module.ServicePage })),
    )
    ```
  - `preloadRoute(pathname: string)` takes only `pathname` and preloads the hardcoded V1 loaders.
- Direct inspection of `src/App.tsx`:
  - Imports:
    ```tsx
    import { AdminPage, AttentionPage, InventoryPage, InventoryUpdatesPage, ServicePage, ManagerPage, preloadRoute, TransfersPage } from './app/routeModules'
    ```
  - Renders inside `<RouteLoadBoundary>` and `<Suspense fallback={<RouteLoadingState />}>`:
    ```tsx
    <Route path="/" element={<InventoryPage homeMode />} />
    <Route path="/inventory" element={<InventoryPage />} />
    <Route path="/transfers" element={<TransfersPage />} />
    <Route path="/transfers/new" element={<TransfersPage />} />
    <Route path="/service" element={<ServicePage key={`${currentUser}:${role}:${homeStore}`} />} />
    ```
- Test isolation observation:
  - Searching all 106 test files for `routeModules`: **0 matches**.
  - `routeModules.ts` is ONLY imported by `src/App.tsx`.
  - Therefore, changing `routeModules.ts` has **zero impact** on the 106 unit test suites, because unit tests import feature pages or components directly.
- Package manager and build observation:
  - `package.json` specifies `"packageManager": "pnpm@11.19.0"`.
  - Running `npx pnpm build` runs `tsc -b && vite build && node scripts/package-extension.mjs` and completes with 0 errors (`built in 3.96s`, 45 reviewed extension files verified).
  - Any dynamic `import(...)` in `routeModules.ts` is statically analyzed by Vite and TypeScript (`tsc -b`). If target files (`InventoryPageV2.tsx`, `TransfersPageV2.tsx`, `ServicePageV2.tsx`) do not exist on disk, `tsc -b` and `vite build` will fail with module resolution errors.

---

## 2. Logic Chain

### 2.1 Preserving Pure V1 in `InventoryExperience.tsx`
1. Observation 1.1 establishes that line 21 currently imports `./VehicleWorkspace` directly:
   `import { VehicleWorkspace } from "./VehicleWorkspace";`.
2. Observation 1.1 confirms that running vitest against this configuration produces a 100% pass across all 106 test files and 1349 tests.
3. In earlier exploratory experiments (documented in `patch_workspace.cjs` and the untracked `VehicleWorkspaceV2.tsx`), developers contemplated or tested importing `VehicleWorkspaceV2` into `InventoryExperience.tsx`.
4. If `InventoryExperience.tsx` were to import `VehicleWorkspaceV2`, the 24 tests in `InventoryExperience.modern.test.tsx` and `inventory-modern-ui.test.tsx` would execute against V2 instead of V1, violating Guardrail G1 (Strict Code Preservation) and risking immediate regressions while V2 is undergoing redesign.
5. Therefore, `InventoryExperience.tsx` must strictly retain `import { VehicleWorkspace } from "./VehicleWorkspace";`.
6. To support V2, a parallel file `InventoryExperienceV2.tsx` (and `InventoryPageV2.tsx`) must be used, completely separating V1 and V2 component trees.

### 2.2 Designing the Non-Destructive Routing Seam
1. Observation 1.2 demonstrates that `routeModules.ts` is only imported by `src/App.tsx`, and never imported by any of the 106 unit test suites.
2. Hence, `routeModules.ts` is the ideal architectural seam: modifying its behavior allows dev/demo runtime to switch dynamically between V1 and V2 without touching V1 source files or breaking tests.
3. React's `lazy(() => import(...))` resolves once and caches the module instance. If `lazy` were bound at module scope to only one version, runtime switching via URL parameter `?v=1` would require full page reloads and could not respond to in-app URL changes.
4. By creating dynamic component wrappers in `routeModules.ts` (`InventoryPage`, `TransfersPage`, `ServicePage`) that read the URL query parameters via React Router's `useLocation()`, the application can:
   - Default to the V2 page component (`LazyInventoryPageV2`, `LazyTransfersPageV2`, `LazyServicePageV2`).
   - Dynamically switch to the V1 baseline component when `?v=1` or `?version=1` is present in the URL.
   - Re-evaluate reactively whenever the user navigates or changes query params.
5. Because `AppRoutes` in `App.tsx` already wraps `<Routes>` in `<Suspense fallback={<RouteLoadingState />}>`, both lazy components suspend cleanly without needing redundant suspense wrappers.
6. To fulfill the contract in `PROJECT.md` line 97–103:
   `export const loadInventoryPage: () => Promise<{ default: React.ComponentType<{ homeMode?: boolean }> }>;`
   `export const loadTransfersPage: () => Promise<{ default: React.ComponentType }>;`
   `export const loadServicePage: () => Promise<{ default: React.ComponentType }>;`
   these functions can be exported from `routeModules.ts` to allow programmatic preloading and direct contract satisfaction.
7. To avoid TypeScript and Vite build breakages during Milestone 1, initial stub/wrapper files for `InventoryPageV2.tsx`, `TransfersPageV2.tsx`, and `ServicePageV2.tsx` must be created so that `import(...)` resolves successfully during `pnpm build`.

---

## 3. Concrete Code Diffs and Implementation Steps

### 3.1 Diff: Pure V1 Restoration in `InventoryExperience.tsx`
Ensure line 21 strictly matches pure V1:

```diff
--- a/src/features/inventory/InventoryExperience.tsx
+++ b/src/features/inventory/InventoryExperience.tsx
@@ -18,7 +18,7 @@
 import { runInterfaceTransition } from "../../lib/interfaceTransition";
 import { useModalBackgroundIsolation } from "../../lib/useModalBackgroundIsolation";
 import { InventoryMobileList, InventoryTable, inventorySortSummary } from "./InventoryTable";
-import { VehicleWorkspace } from "./VehicleWorkspaceV2";
+import { VehicleWorkspace } from "./VehicleWorkspace";
 import { useInventoryDisclosure } from "./useInventoryDisclosure";
 import {
```

### 3.2 Diff: Dynamic Routing Seam in `src/app/routeModules.ts`
Implement the version detector, split V1/V2 loaders, fallback catch handlers, dynamic component wrappers, and updated `preloadRoute`:

```diff
--- a/src/app/routeModules.ts
+++ b/src/app/routeModules.ts
@@ -1,37 +1,93 @@
-import { lazy } from 'react'
+import { lazy, type ComponentType } from 'react'
+import { useLocation } from 'react-router-dom'

-const loadInventoryPage = () => import('../features/inventory/InventoryPage')
-const loadTransfersPage = () => import('../features/transfers/TransfersPage')
+// ============================================================================
+// Version Fallback Detection Seam
+// ============================================================================
+
+export function isV1Requested(search?: string): boolean {
+  if (typeof window === 'undefined' && !search) return false
+  const queryString = search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : '')
+  const params = new URLSearchParams(queryString)
+  return params.get('v') === '1' || params.get('version') === '1'
+}
+
+// ============================================================================
+// V1 Baseline Route Loaders
+// ============================================================================
+
+export const loadInventoryPageV1 = () =>
+  import('../features/inventory/InventoryPage').then((module) => ({ default: module.InventoryPage }))
+export const loadTransfersPageV1 = () =>
+  import('../features/transfers/TransfersPage').then((module) => ({ default: module.TransfersPage }))
+export const loadServicePageV1 = () =>
+  import('../features/service/ServicePage').then((module) => ({ default: module.ServicePage }))
+
+// ============================================================================
+// V2 Redesign Route Loaders (with graceful fallback to V1 during rollout)
+// ============================================================================
+
+export const loadInventoryPageV2 = () =>
+  import('../features/inventory/InventoryPageV2')
+    .then((module) => ({ default: module.InventoryPageV2 }))
+    .catch((err) => {
+      console.warn('Falling back to V1 InventoryPage:', err)
+      return loadInventoryPageV1()
+    })
+export const loadTransfersPageV2 = () =>
+  import('../features/transfers/TransfersPageV2')
+    .then((module) => ({ default: module.TransfersPageV2 }))
+    .catch((err) => {
+      console.warn('Falling back to V1 TransfersPage:', err)
+      return loadTransfersPageV1()
+    })
+export const loadServicePageV2 = () =>
+  import('../features/service/ServicePageV2')
+    .then((module) => ({ default: module.ServicePageV2 }))
+    .catch((err) => {
+      console.warn('Falling back to V1 ServicePage:', err)
+      return loadServicePageV1()
+    })
+
+// Shared Route Loaders (Untouched between V1 and V2)
 const loadAttentionPage = () => import('../features/attention/AttentionPage')
 const loadManagerPage = () => import('../features/manager/ManagerPage')
 const loadInventoryUpdatesPage = () => import('../features/attention/InventoryUpdatesPage')
-const loadServicePage = () => import('../features/service/ServicePage')
 const loadAdminPage = () => import('../features/admin/AdminPage')

+// Contract Route Loaders (satisfies PROJECT.md Route Modules Contract)
+export const loadInventoryPage = () => (isV1Requested() ? loadInventoryPageV1() : loadInventoryPageV2())
+export const loadTransfersPage = () => (isV1Requested() ? loadTransfersPageV1() : loadTransfersPageV2())
+export const loadServicePage = () => (isV1Requested() ? loadServicePageV1() : loadServicePageV2())
+
 function warmRoute(loader: () => Promise<unknown>): void {
-  // The route boundary owns any user-facing load failure once React renders
-  // the lazy module. Intentional preloading must not create an unhandled
-  // rejection before that boundary is mounted.
   void loader().catch(() => undefined)
 }

-export const InventoryPage = lazy(() =>
-  loadInventoryPage().then((module) => ({ default: module.InventoryPage })),
-)
-export const TransfersPage = lazy(() =>
-  loadTransfersPage().then((module) => ({ default: module.TransfersPage })),
-)
-export const AttentionPage = lazy(() =>
-  loadAttentionPage().then((module) => ({ default: module.AttentionPage })),
-)
-export const ManagerPage = lazy(() =>
-  loadManagerPage().then((module) => ({ default: module.ManagerPage })),
-)
-export const InventoryUpdatesPage = lazy(() => loadInventoryUpdatesPage().then(module => ({ default: module.InventoryUpdatesPage })))
-export const ServicePage = lazy(() => loadServicePage().then(module => ({ default: module.ServicePage })))
-export const AdminPage = lazy(() => loadAdminPage().then(module => ({ default: module.AdminPage })))
+// Lazy instances
+const LazyInventoryPageV1 = lazy(loadInventoryPageV1)
+const LazyInventoryPageV2 = lazy(loadInventoryPageV2)
+const LazyTransfersPageV1 = lazy(loadTransfersPageV1)
+const LazyTransfersPageV2 = lazy(loadTransfersPageV2)
+const LazyServicePageV1 = lazy(loadServicePageV1)
+const LazyServicePageV2 = lazy(loadServicePageV2)
+
+// ============================================================================
+// Dynamic Routing Components for App.tsx
+// ============================================================================
+
+export function InventoryPage(props: { homeMode?: boolean }) {
+  const location = useLocation()
+  const isV1 = isV1Requested(location.search)
+  const Component = isV1 ? LazyInventoryPageV1 : LazyInventoryPageV2
+  return <Component {...props} />
+}
+
+export function TransfersPage() {
+  const location = useLocation()
+  const isV1 = isV1Requested(location.search)
+  const Component = isV1 ? LazyTransfersPageV1 : LazyTransfersPageV2
+  return <Component />
+}
+
+export function ServicePage() {
+  const location = useLocation()
+  const isV1 = isV1Requested(location.search)
+  const Component = isV1 ? LazyServicePageV1 : LazyServicePageV2
+  return <Component />
+}
+
+export const AttentionPage = lazy(() => loadAttentionPage().then((module) => ({ default: module.AttentionPage })))
+export const ManagerPage = lazy(() => loadManagerPage().then((module) => ({ default: module.ManagerPage })))
+export const InventoryUpdatesPage = lazy(() => loadInventoryUpdatesPage().then((module) => ({ default: module.InventoryUpdatesPage })))
+export const AdminPage = lazy(() => loadAdminPage().then((module) => ({ default: module.AdminPage })))

-export function preloadRoute(pathname: string): void {
+export function preloadRoute(pathname: string, search?: string): void {
+  const isV1 = isV1Requested(search)
   if (pathname === '/' || pathname.startsWith('/inventory')) {
-    warmRoute(loadInventoryPage)
+    warmRoute(isV1 ? loadInventoryPageV1 : loadInventoryPageV2)
   } else if (pathname.startsWith('/transfers')) {
-    warmRoute(loadTransfersPage)
+    warmRoute(isV1 ? loadTransfersPageV1 : loadTransfersPageV2)
+  } else if (pathname.startsWith('/service')) {
+    warmRoute(isV1 ? loadServicePageV1 : loadServicePageV2)
   } else if (pathname.startsWith('/attention')) {
     warmRoute(loadAttentionPage)
   } else if (pathname.startsWith('/manager')) {
     warmRoute(loadManagerPage)
   } else if (pathname.startsWith('/updates')) {
     warmRoute(loadInventoryUpdatesPage)
-  } else if (pathname.startsWith('/service')) {
-    warmRoute(loadServicePage)
   } else if (pathname.startsWith('/admin')) {
     warmRoute(loadAdminPage)
   }
 }
```

### 3.3 Diff: `src/App.tsx`
Update `preloadRoute` invocation in `App.tsx` to pass the query string:

```diff
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -37,9 +37,9 @@
 }
 
 export default function App() {
-  const { pathname } = useLocation()
+  const { pathname, search } = useLocation()
 
   useEffect(() => {
-    preloadRoute(pathname)
-  }, [pathname])
+    preloadRoute(pathname, search)
+  }, [pathname, search])
 
   return (
```

### 3.4 Implementation Steps for Milestone 1 Implementer
1. **Verify `InventoryExperience.tsx`**:
   - Ensure line 21 remains `import { VehicleWorkspace } from "./VehicleWorkspace";`.
   - Run `npx pnpm test` to verify 106/106 test files pass.
2. **Scaffold Initial V2 Page Files**:
   - Create `src/features/inventory/InventoryPageV2.tsx`:
     ```tsx
     import { InventoryPage as V1InventoryPage } from './InventoryPage'
     export function InventoryPageV2(props: { homeMode?: boolean }) {
       return <V1InventoryPage {...props} />
     }
     ```
     *(In M2 and M3, this will be replaced with the full V2 layout and `VehicleWorkspaceV2`)*.
   - Create `src/features/service/ServicePageV2.tsx`:
     ```tsx
     import { ServicePage as V1ServicePage } from './ServicePage'
     export function ServicePageV2() {
       return <V1ServicePage />
     }
     ```
     *(In M3, this will be replaced with `ServiceBoardV2`)*.
   - Create `src/features/transfers/TransfersPageV2.tsx`:
     ```tsx
     import { TransfersPage as V1TransfersPage } from './TransfersPage'
     export function TransfersPageV2() {
       return <V1TransfersPage />
     }
     ```
     *(In M3, this will be replaced with `TransfersMovementViewV2`)*.
3. **Apply `src/app/routeModules.ts` and `src/App.tsx` Diffs**:
   - Apply the diff in Section 3.2 and Section 3.3.
4. **Harden Design System CSS Tokens (Feature 3)**:
   - In `src/features/inventory/VehicleWorkspaceV2.css`:
     - Change line 424 and 507 from `font-size: 11px;` to `font-size: 12px;`.
     - Change line 450 from `color: #fff;` to `color: var(--v10-surface);` or `color: var(--ifx-white, #ffffff)`.
   - Run `node scripts/check-design-system.mjs` to ensure 0 failures.
5. **Verify Full Build and Tests**:
   - Run `npx pnpm build` (must complete with 0 TypeScript and 0 Vite errors).
   - Run `npx pnpm test` (all 106 test files, 1349 tests pass).

---

## 4. Caveats

1. **No Source Modifications Made by Explorer 1**: In accordance with the Read-Only Investigation mandate, Explorer 1 did not directly edit files under `src/`. All proposals are provided as exact diffs and implementation steps for the Milestone 1 Implementer.
2. **`pnpm` vs `npm` Execution**: Node module resolution in this project uses `pnpm@11.19.0`. Running raw `npm test` or `npm run build` encounters hoisted symlink differences, whereas `npx pnpm test` and `npx pnpm build` resolve cleanly.
3. **V2 Stubs Prerequisite**: `routeModules.ts` dynamic imports require `InventoryPageV2.tsx`, `ServicePageV2.tsx`, and `TransfersPageV2.tsx` to exist on the filesystem at build time. Creating initial wrapper stubs in Step 2 prevents any `tsc -b` or Vite bundler failures.

---

## 5. Conclusion

- `InventoryExperience.tsx` line 21 is currently intact as pure V1 (`import { VehicleWorkspace } from "./VehicleWorkspace";`). Keeping it isolated from V2 ensures that all 106 V1 baseline test files and 1349 tests pass with 100% reliability.
- `src/app/routeModules.ts` can be safely transformed into a non-destructive routing seam by exporting dynamic wrapper components that detect `?v=1` or `?version=1` via React Router's `useLocation()`.
- Because no unit tests import `routeModules.ts` or `App.tsx`, this routing seam provides an instantaneous runtime toggle between V2 and V1 without breaking any existing unit tests.
- All implementation steps and concrete code diffs are ready for execution by the Milestone 1 Implementer.

---

## 6. Verification Method

To independently verify these findings:

1. **Verify V1 Baseline Test Pass**:
   ```bash
   npx pnpm test
   ```
   *Expected Output*: 106 passed test files, 1349 passed tests.

2. **Verify Design System Baseline Check**:
   ```bash
   node scripts/check-design-system.mjs
   ```
   *Note*: Will show 2 `smallText` and 1 `rawColors` in `VehicleWorkspaceV2.css` until the 3-line token hardening is applied.

3. **Verify Build After Applying Seam & Stubs**:
   ```bash
   npx pnpm build
   ```
   *Expected Output*: Exit code 0, Vite build passes, extension packager passes.

4. **Verify Runtime Version Switching**:
   Start dev demo server:
   ```bash
   npm run dev:demo
   ```
   Open `http://127.0.0.1:4173/` -> renders V2 experience.  
   Open `http://127.0.0.1:4173/?v=1` -> renders original V1 experience.
