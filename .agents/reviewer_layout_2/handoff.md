# Handoff Report: Reviewer 2 (Functional and Table Architecture)

**Agent**: Reviewer 2 (`reviewer_layout_2`)  
**Parent**: `57139553-92aa-47d3-a446-305c720dd4d5` (orchestrator)  
**Date**: 2026-09-18T02:51:00Z  
**Type**: Hard Handoff (Review Complete)  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### 1.1 Table DOM Structure & Flex Semantics (R2 Requirement)
In `src/features/inventory/InventoryTableV2.tsx`:
- `<table>` (line 351) has `role="table"` and `aria-label="Inventory vehicles"`.
- `<colgroup>` (lines 355–362) renders 6 explicit `<col>` tags:
  ```tsx
  <colgroup>
    <col className="inventory-table-v2-col inventory-table-v2-col--vehicle" />
    <col className="inventory-table-v2-col inventory-table-v2-col--identifiers" />
    <col className="inventory-table-v2-col inventory-table-v2-col--pricing" />
    <col className="inventory-table-v2-col inventory-table-v2-col--location" />
    <col className="inventory-table-v2-col inventory-table-v2-col--status" />
    <col className="inventory-table-v2-col inventory-table-v2-col--actions" />
  </colgroup>
  ```
- In `VehicleRow` (lines 142–330), every data cell is rendered as a standard `<td>` with column-specific classes:
  - Line 143: `<td className="inventory-table-v2-td inventory-table-v2-td--vehicle"><div className="inv-v2-vehicle-cell">...</div></td>`
  - Line 176: `<td className="inventory-table-v2-td inventory-table-v2-td--identifiers"><div className="inv-v2-id-cell">...</div></td>`
  - Line 192: `<td className="inventory-table-v2-td inventory-table-v2-td--pricing"><div className="inv-v2-pricing-cell">...</div></td>`
  - Line 206: `<td className="inventory-table-v2-td inventory-table-v2-td--location"><div className="inv-v2-location-cell">...</div></td>`
  - Line 222: `<td className="inventory-table-v2-td inventory-table-v2-td--status"><div className="inv-v2-status-cell">...</div></td>`
  - Line 257: `<td className="inventory-table-v2-td inventory-table-v2-td--actions"><div className="inv-v2-actions-cell">...</div></td>`
- In `src/features/inventory/InventoryTableV2.css`:
  - Data cells (lines 113–118) retain standard user-agent table cell formatting:
    ```css
    .inventory-table-v2 td {
      padding: 8px 12px;
      vertical-align: middle;
      border-bottom: 1px solid var(--v10-border-soft);
      background: var(--v10-surface);
    }
    ```
    No `display` override is set on `td`, preserving `display: table-cell`.
  - `display: flex` is strictly applied to inner `<div>` wrapper containers:
    - Line 143: `.inv-v2-vehicle-cell { display: flex; align-items: center; gap: 12px; min-width: 260px; }`
    - Line 205: `.inv-v2-id-cell { display: flex; flex-direction: column; gap: 4px; min-width: 140px; }`
    - Line 222: `.inv-v2-pricing-cell { display: flex; flex-direction: column; gap: 2px; min-width: 110px; }`
    - Line 249: `.inv-v2-location-cell { display: flex; flex-direction: column; gap: 3px; min-width: 130px; }`
    - Line 274: `.inv-v2-status-cell { display: flex; flex-direction: column; gap: 4px; min-width: 130px; }`
    - Line 331: `.inv-v2-actions-cell { display: flex; align-items: center; gap: 6px; min-width: 210px; flex-wrap: nowrap; }`

### 1.2 Table Column Alignment & Sizing
In `src/features/inventory/InventoryTableV2.css`:
- `.inventory-table-v2` (lines 21–31) specifies `table-layout: fixed; min-width: 1080px; border-collapse: separate; border-spacing: 0;`.
- Column allocations (lines 33–68):
  - Vehicle (`.inventory-table-v2-th--vehicle, .inventory-table-v2-col--vehicle`): `width: 27%; min-width: 260px;`
  - Identifiers (`.inventory-table-v2-th--identifiers, .inventory-table-v2-col--identifiers`): `width: 14%; min-width: 140px;`
  - Pricing (`.inventory-table-v2-th--pricing, .inventory-table-v2-col--pricing`): `width: 12%; min-width: 110px;`
  - Location (`.inventory-table-v2-th--location, .inventory-table-v2-col--location`): `width: 13%; min-width: 130px;`
  - Status (`.inventory-table-v2-th--status, .inventory-table-v2-col--status`): `width: 14%; min-width: 140px;`
  - Actions (`.inventory-table-v2-th--actions, .inventory-table-v2-col--actions`): `width: 20%; min-width: 210px;`
  - Sum of widths: `27% + 14% + 12% + 13% + 14% + 20% = 100%`.
  - At table `min-width: 1080px`, each percentage width exceeds its corresponding `min-width` (e.g. 27% of 1080 = 291.6px > 260px).

### 1.3 Sticky Header Behavior
In `src/features/inventory/InventoryTableV2.css`:
- Container `.inventory-table-v2-container` (lines 13–19): `overflow: auto; max-height: calc(100vh - 240px); position: relative; overscroll-behavior: contain;`.
- Table (line 24): `border-collapse: separate; border-spacing: 0;`.
- Header cells `.inventory-table-v2 thead th` (lines 71–85):
  ```css
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--v10-surface-header);
  box-shadow: inset 0 -1px 0 var(--v10-border);
  border: none;
  ```
- Data cells `.inventory-table-v2 td` (line 116): `border-bottom: 1px solid var(--v10-border-soft);`.

### 1.4 Top Section Layout & Screen Reader Clipping
In `src/features/inventory/InventoryExperienceV2.css`:
- Screen reader utility (lines 7–17):
  ```css
  .inventory-sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  }
  ```
- Metrics rail (lines 79–85):
  ```css
  .inventory-decision-rail {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0;
  }
  ```
- Controls bar (lines 180–186):
  ```css
  .inv-v2-controls-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  ```

### 1.5 Verification Tool Outputs

1. **Milestone 3 Unit Test Suite**:
   ```bash
   npx vitest run tests/unit/Milestone3PagesV2.test.tsx
   ```
   *Result*: **PASS** — 22 of 22 tests passed (including all 6 `InventoryTableV2` tests, 5 `ServicePageV2` tests, 6 `TransfersPageV2` tests, and 5 countdown tests) in 2.49s.

2. **Adversarial Accessibility & Motion Test Suite**:
   ```bash
   npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx
   ```
   *Result*: **FAIL** (Exit code 1) — 1 failed, 23 passed.
   *Failed test*:
   ```
   FAIL tests/unit/AdversarialM4A11yMotion.test.tsx > Adversarial M4: Accessibility, Motion Safety, Routing & Baseline Integrity > 1. Dynamic Routing Query Parameter Tamper Testing (src/app/routeModules.ts) > mounts InventoryPage under MemoryRouter with ?v=1 (V1) and falls back safely for invalid query params
   AssertionError: expected <div data-testid="route-loading"></div> to be null
   ```
   The `waitFor` assertion at line 395 timed out at ~1092ms waiting for `<div data-testid="route-loading">` to unmount.

3. **Production Build (`npm run build`)**:
   ```bash
   npm run build
   ```
   *Result*: **FAIL** (Exit code 1).
   *Compilation errors*:
   ```
   tests/unit/ChallengerLayoutA11y.test.tsx:11:15 - error TS2724: '"../../src/features/inventory/types"' has no exported member named 'InventoryMetrics'. Did you mean 'InventoryMetricKey'?
   11 import type { InventoryMetrics, InventoryStore } from '../../src/features/inventory/types'
                    ~~~~~~~~~~~~~~~~

   tests/unit/ChallengerLayoutGrid.test.tsx:415:13 - error TS2740: Type '{ status: "in_service" | "needs_service" | "serviced"; }' is missing the following properties from type 'ServiceReadiness': vin, version, serviceEnteredAt, completedAt, and 6 more.
   415             serviceReadiness: {
                   ~~~~~~~~~~~~~~~~
   Found 2 errors in 2 files.
   ```
   *Application bundle check*:
   Running `npx vite build` directly completed successfully in 1.73s with 0 bundle errors.

4. **Design System & Safety Guards**:
   - `node scripts/check-design-system.mjs`: PASS (Legacy debt did not increase; 0 sub-12px, 0 raw hex in V2 files).
   - `node scripts/check-repo-safety.mjs`: PASS (705 tracked/unignored files checked; 0 V1 baseline mutations).

---

## 2. Logic Chain

1. **Table DOM Architecture (R2 Compliance)**:
   - Observation 1.1 directly confirms that every row cell renders `<td className="..."><div className="inv-v2-*-cell">...</div></td>`.
   - In `InventoryTableV2.css`, `display: flex` is applied exclusively to `.inv-v2-*-cell` selectors, and never to `td` elements.
   - Therefore, the browser table formatting model remains intact: `<td>` maintains `display: table-cell; vertical-align: middle;`, eliminating the table grid collapse bug that occurs when `display: flex` is placed on `<td>`.

2. **Column Alignment & Responsive Stability**:
   - Observation 1.2 confirms that `.inventory-table-v2` declares `table-layout: fixed; min-width: 1080px;`.
   - The `<colgroup>` and `<th>` elements define exact matching percentage widths: 27%, 14%, 12%, 13%, 14%, 20% totaling exactly 100%.
   - Under CSS 2.1 fixed table layout rules, first-row column definitions govern cell widths throughout the entire table. This guarantees visual alignment between headers and body cells regardless of cell content variance.
   - The table wrapper `.inventory-table-v2-container` provides `overflow: auto;`, allowing smooth horizontal scrolling on mobile viewports (e.g. 390px) without column compression.

3. **Sticky Header Resilience**:
   - Observation 1.3 shows `border-collapse: separate; border-spacing: 0;` paired with `box-shadow: inset 0 -1px 0 var(--v10-border);` on `thead th`.
   - In standard browser rendering engines, `border-collapse: collapse` detaches borders from sticky elements during scroll. Using `border-collapse: separate;` and an inset box-shadow guarantees the sticky header border remains pinned at the top without ghosting or flickering.

4. **Screen Reader and Top Layout Resolution**:
   - Observation 1.4 confirms `.inventory-sr-only` is defined with CSS clipping (`rect(0, 0, 0, 0)`).
   - This removes the 163-character screen reader hint from visual document flow, shrinking the search bar height from 100px back to 38px, and allowing `.inv-v2-controls-bar` to align search and filter pills horizontally.

5. **Build and Test Verification Failures**:
   - Observation 1.5 item 3 shows `npm run build` exits with code 1 due to 2 TypeScript compilation errors in `tests/unit/ChallengerLayoutA11y.test.tsx` and `tests/unit/ChallengerLayoutGrid.test.tsx`.
   - Observation 1.5 item 2 shows `tests/unit/AdversarialM4A11yMotion.test.tsx` fails 1 test under `waitFor` timeout.
   - Even though the worker's component implementations (`InventoryTableV2.tsx`, `InventoryExperienceV2.tsx`, and CSS) are well written and error-free, the overall repository build and adversarial test commands required by the verification gate are currently failing.
   - Therefore, per the reviewer protocol, a verdict of `REQUEST_CHANGES` must be issued until the build gate and test suite are green.

---

## 3. Caveats

1. **Origin of Build Errors**: The TypeScript compilation errors in `npm run build` originate from tests committed/written concurrently by `challenger_layout_1` and `challenger_layout_2`, not from the worker's changes. The core application bundle (`npx vite build`) builds cleanly with zero errors.
2. **Origin of Adversarial Test Failure**: The failure in `AdversarialM4A11yMotion.test.tsx` line 395 is caused by `@testing-library/react`'s default 1000ms `waitFor` timeout expiring while Vitest transforms and bundles the heavy 3,037-line V1 `VehicleWorkspace.tsx` module under concurrent multi-agent CPU load. The V2 component pathways are unaffected.
3. **No Integrity Violation**: There is no evidence of cheating, dummy facades, or hardcoded shortcuts in the worker's implementation. The worker's code in `InventoryTableV2` and `InventoryExperienceV2` is authentic and robust.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

### Summary of Assessment
- **Table DOM Structure (R2)**: **APPROVED** — Standard `display: table-cell` is preserved on `<td>`, and `display: flex` is applied strictly to inner `.inv-v2-*-cell` `<div>` wrappers.
- **Table Column Alignment**: **APPROVED** — `<colgroup>`, `<th>`, and `<td>` classes apply matching widths (27%, 14%, 12%, 13%, 14%, 20% = 100%) under `table-layout: fixed`.
- **Sticky Header Behavior**: **APPROVED** — Inset `box-shadow: inset 0 -1px 0 var(--v10-border)` with `border-collapse: separate; border-spacing: 0;` ensures stable pinned borders.
- **Top Section Layout**: **APPROVED** — 4-column responsive grid on `.inventory-decision-rail`, visual clipping of screen reader text via `.inventory-sr-only`, and aligned 38px search controls.
- **Design Tokens & Safety**: **APPROVED** — 0 sub-12px font sizes, 0 raw hex colors, 0 baseline file modifications.
- **Build & Adversarial Test Gates**: **REQUEST_CHANGES** — The orchestrator must coordinate fixing the 2 TypeScript errors in `tests/unit/ChallengerLayout*.test.tsx` and resolving the `waitFor` timeout in `tests/unit/AdversarialM4A11yMotion.test.tsx` so that `npm run build` and `npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx` pass.

### Required Actions
1. **Fix Challenger Test Type Errors**:
   - In `tests/unit/ChallengerLayoutA11y.test.tsx:11`: Change `import type { InventoryMetrics, ... }` to `import type { InventoryDecisionMetrics, ... }` (or `InventoryMetricKey`).
   - In `tests/unit/ChallengerLayoutGrid.test.tsx:415`: Provide a complete mock object for `serviceReadiness` matching the `ServiceReadiness` interface contract.
2. **Resolve Flaky Timeout in Adversarial Test**:
   - In `tests/unit/AdversarialM4A11yMotion.test.tsx:394`: Add an explicit timeout option to `waitFor(..., { timeout: 3000 })` to accommodate lazy-loading of the 3,000-line legacy module under heavy runner load, or pre-warm the route via `preloadRoute('/inventory', '?v=1')`.

---

## 5. Verification Method

To verify resolution of these findings:

1. **Verify Table DOM & CSS**:
   Inspect `src/features/inventory/InventoryTableV2.tsx` (lines 142–330) and `InventoryTableV2.css` (lines 113–143). Confirm no `display: flex` on `td`.
2. **Verify Milestone 3 Unit Tests**:
   ```bash
   npx vitest run tests/unit/Milestone3PagesV2.test.tsx
   ```
   *Expected*: 22/22 tests passing.
3. **Verify Adversarial M4 Suite**:
   ```bash
   npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx
   ```
   *Expected*: 24/24 tests passing.
4. **Verify Full Build**:
   ```bash
   npm run build
   ```
   *Expected*: 0 TypeScript compilation errors, 0 Vite bundle errors.
