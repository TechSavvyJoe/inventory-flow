# Design System & QA Explorer Investigation Report

## 1. Observation

### 1.1 Design System Checker Rules (`scripts/check-design-system.mjs`)
- **Script Location**: `scripts/check-design-system.mjs` (Lines 27–55, 57–68).
- **Enforcement Rules**:
  1. **Sub-12px Font Size (`smallText`)**:
     - Measured using regex: `/font-size\s*:\s*(\d*\.?\d+)px/gi` (Line 29). Matches any pixel value where `Number(size) < 12` (Line 31).
  2. **Raw Hex Color Literals (`rawColors`)**:
     - Measured using regex: `/#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi` (Line 34). Files ending in `/tokens.css` are exempt (`smallText` and `rawColors` set to 0, Line 33). All other `.css` files under `src/` are checked.
  3. **Zero-Tolerance for Unlisted / New Files**:
     - Baseline lookup: `const allowance = baseline.files[filePath] ?? { smallText: 0, rawColors: 0 }` (Line 45).
     - Any new `.css` file or file not in `scripts/design-system-baseline.json` has `allowance: { smallText: 0, rawColors: 0 }`.
     - Regression trigger: `if (measurement[metric] > allowance[metric])` pushes failure and sets `process.exitCode = 1` (Lines 49–54, 81).
  4. **Global Stylesheet Import Prohibition in `src/main.tsx`**:
     - Scans `src/main.tsx` imports: `mainSource.matchAll(/^import\s+['"](.+\.css)['"]/gm)` (Lines 58–61).
     - Any stylesheet import not in `baseline.globalStyleImports` immediately causes failure: `src/main.tsx adds unreviewed global CSS layers: ...` (Lines 66–68).
- **Current Linter Execution Result**:
  - Command: `node scripts/check-design-system.mjs`
  - Output: `Design-system guard passed. Legacy debt did not increase (596 sub-12px declarations; 2681 raw colors outside token files).` (Exit code: 0).

### 1.2 Design System Tokens
- **`src/design-system/tokens.css`**:
  - Palette tokens: `--ifx-neutral-0` (#fff) to `--ifx-neutral-950` (#071722).
  - Status tokens: `--ifx-success` (#087a58), `--ifx-success-surface` (#e8f8f2), `--ifx-warning` (#986000), `--ifx-warning-surface` (#fff4d6), `--ifx-danger` (#b92f3d), `--ifx-danger-surface` (#ffecef), `--ifx-info` (#1263bf), `--ifx-info-surface` (#eaf4ff), `--ifx-hold` (#6941c6), `--ifx-hold-surface` (#f2edff).
  - Typography scale: `--ifx-text-xs` (0.75rem / 12px), `--ifx-text-sm` (0.8125rem / 13px), `--ifx-text-md` (0.875rem / 14px), `--ifx-text-body` (0.9375rem / 15px), `--ifx-text-lg` (1rem / 16px).
  - Shape & Radii: `--ifx-radius-xs` (5px), `--ifx-radius-sm` (8px), `--ifx-radius-md` (12px), `--ifx-radius-full` (999px).
- **`src/styles/tokens.css`**:
  - Palette: `--navy-950`, `--navy-900`, `--navy-800`, `--blue-700`, `--blue-600`, `--blue-500`, `--blue-100`, `--blue-050`, `--ink-900`, `--ink-700`, `--ink-600`, `--ink-500`, `--border`, `--border-strong`, `--surface`, `--surface-soft`, `--surface-muted`, `--green`, `--green-bg`, `--amber`, `--amber-bg`, `--red`, `--red-bg`, `--violet`, `--violet-bg`, `--focus`.
  - Control radius: `--radius-control: 8px`, `--radius-panel: 10px`.
- **`src/styles/inventory-production-v10.css`**:
  - Variables scoped under `:is(#root .inventory-page, #root .inventory-experience--modern, body > .inventory-workspace--compact-v3)`:
    - `--v10-ink`, `--v10-ink-strong`, `--v10-support`, `--v10-muted`, `--v10-border`, `--v10-border-soft`, `--v10-surface`, `--v10-surface-subtle`, `--v10-surface-header`, `--v10-blue`, `--v10-blue-strong`.

### 1.3 Root Cause of Unstyled Top Section in `InventoryExperienceV2.tsx`
- In `src/features/inventory/InventoryExperienceV2.tsx`:
  - Line 297 renders `{metrics ? <InventoryDecisionRail metrics={metrics} /> : null}`.
  - Line 310 renders `<InventoryPredictiveSearch ... />`.
  - Line 20 imports only `./InventoryTableV2.css`.
- In `src/features/inventory/InventoryDecisionRail.tsx`:
  - Renders `<section className="inventory-decision-rail" aria-label="Inventory decisions">` with items `<div className="inventory-metric">` containing `.inventory-metric__icon`, `.inventory-tone--blue|orange|violet|red`, `.inventory-metric__copy`, `.inventory-metric__label`, and `.inventory-metric__value`.
- Styling gap:
  - Styles for `.inventory-decision-rail` and `.inventory-metric` exist solely in `src/features/inventory/inventory.css` (Lines 400–460), which is a 2051-line legacy V1 stylesheet NOT imported by `InventoryExperienceV2.tsx`.
  - `src/features/inventory/InventoryTableV2.css` contains 0 rules for `.inventory-decision-rail` or `.inventory-metric`.
  - Result: The `<section>` and child `<div>`s render with default browser `display: block`, causing the four metric cards to stack vertically with unstyled borders, giant raw SVGs, and broken spacing.
  - Similarly, `.inventory-primary-search` inside `InventoryPredictiveSearch` was only styled under `.inventory-experience--modern` in `src/styles/inventory-experience-final.css`, which is not applied to `.inventory-experience-v2`.

### 1.4 Table Column Alignment Mechanism in `InventoryTableV2.tsx`
- In `src/features/inventory/InventoryTableV2.tsx`:
  - Table has 6 columns: `vehicle` (Vehicle), `identifiers` (Stock / VIN), `pricing` (Price & Miles), `location` (Location & Move), `status` (Hold & Service), `actions` (Actions).
  - Headers are rendered with class `inventory-table-v2-th inventory-table-v2-th--${column.id}` (Line 69).
  - Data cells render inner wrappers: `<div className="inv-v2-vehicle-cell">`, `<div className="inv-v2-id-cell">`, `<div className="inv-v2-pricing-cell">`, `<div className="inv-v2-location-cell">`, `<div className="inv-v2-status-cell">`, `<div className="inv-v2-actions-cell">`.
  - `display: flex` is applied strictly to these inner wrapper `<div>`s (e.g. `InventoryTableV2.css` Lines 88, 149, 166, 193, 220, 275), preserving standard table cell semantics on `<td>`.
  - However, `InventoryTableV2.css` does NOT define widths or min-widths for the `<th>` classes (`.inventory-table-v2-th--*`), meaning column widths vary dynamically based on row contents and can misalign with headers, especially in empty states or upon viewport changes.

### 1.5 Existing Tests Relevant to V2 Components
- **Unit Test Coverage**:
  1. `tests/unit/Milestone3PagesV2.test.tsx` (22 tests passing):
     - Lines 287–449: `InventoryTableV2 Component` (headers, CopyableValue chips, status badges, quick actions, disabled request button, empty state).
  2. `tests/unit/VehicleWorkspaceV2.test.tsx` (15 tests passing):
     - Lines 294–326: `InventoryExperienceV2 Integration` (mounting experience container, selecting vehicle opens VDP workspace modal).
  3. `tests/unit/AdversarialM4Stress.test.tsx` (14 tests passing):
     - Lines 466–505: High-frequency concurrent clicking across rows in `InventoryTableV2`.
     - Lines 514–560: Rendering vehicles with 0 photos gracefully in `InventoryTableV2`.
     - Lines 562–600: High-density dataset rendering.
  4. `tests/unit/AdversarialM4A11yMotion.test.tsx` (24 tests passing):
     - Lines 659–680: Responsive 390px mobile viewport rendering for `InventoryTableV2`.
     - Lines 762–790: Header cell `aria-sort` attributes and keyboard activation.
- **E2E / Integration Test Coverage**:
  1. `tests/e2e/tier1-feature-coverage.test.tsx` (145 tests passing):
     - Lines 880–908: Feature 21: High-Density Inventory Table V2 (`ServiceStatusLink`, accessible aria-label, tone modifier).
     - Lines 911–946: Feature 22: Inventory Table Micro-Actions (`CopyableValue`, listing URL, invoice URL, full record callback).

### 1.6 Verification of Baseline V1 Preservation & Isolation (Guardrail G1)
- Baseline V1 Files:
  - `src/features/inventory/VehicleWorkspace.tsx`
  - `src/features/inventory/InventoryExperience.tsx`
  - `src/features/inventory/InventoryPage.tsx`
  - `src/features/transfers/TransfersPage.tsx`
  - `src/features/service/ServicePage.tsx`
- Observation Results:
  - `git diff HEAD -- src/features/inventory/InventoryExperience.tsx src/features/inventory/InventoryTable.tsx src/features/inventory/InventoryPage.tsx src/features/inventory/VehicleWorkspace.tsx`: 0 diff lines (clean).
  - Ripgrep search for `V2` in baseline V1 files: 0 matches (zero cross-contamination).
  - Automated tests in `tests/unit/AdversarialM4A11yMotion.test.tsx` (Lines 837–904, Section 5: Guardrail G1):
    - `verifies all baseline V1 files exist on disk`: PASSED.
    - `verifies none of the baseline V1 files are modified in git status/diff`: PASSED.
    - `verifies baseline V1 files do not import V2 components`: PASSED.
    - `verifies baseline V1 files retain their original exports`: PASSED.
  - Automated tests in `tests/e2e/tier1-feature-coverage.test.tsx` (Lines 21–60, Feature 1: Baseline V1 Code Preservation): PASSED.

---

## 2. Logic Chain

1. **Step 1 (Design System Constraints)**: `scripts/check-design-system.mjs` strictly evaluates every `.css` file in `src/`. Because `InventoryTableV2.css` (or any new CSS file) is not in `baseline.files`, its allowance for sub-12px text and raw hex colors is `{ smallText: 0, rawColors: 0 }`. Therefore, any style rule written must:
   - Use `font-size >= 12px` or CSS tokens like `var(--ifx-text-xs)`.
   - Never use raw hex colors (`#...`). All colors must use CSS variables (`var(--v10-*)`, `var(--ifx-*)`, `var(--surface)`, `var(--border)`, `var(--amber)`, `var(--red)`, etc.).
   - Never import new stylesheets into `src/main.tsx` because `baseline.globalStyleImports` has a zero-tolerance policy for unreviewed global layers.
2. **Step 2 (Top Section Breakdown & Remedy)**:
   - `InventoryExperienceV2.tsx` renders `InventoryDecisionRail` and `InventoryPredictiveSearch`.
   - `inventory.css` contains legacy styles for these components but is deliberately isolated to V1.
   - Adding dedicated CSS rules for `.inventory-decision-rail`, `.inventory-metric`, `.inventory-metric__*`, and `.inventory-primary-search` into `InventoryTableV2.css` (or a dedicated `InventoryExperienceV2.css` imported in `InventoryExperienceV2.tsx`) will immediately restore horizontal grid alignment (e.g. `grid-template-columns: repeat(4, minmax(0, 1fr))`), compact metric icons, and high-density search/pills layout without importing legacy debt or violating design system guards.
3. **Step 3 (Table Grid Alignment & Flex Separation)**:
   - `InventoryTableV2.tsx` currently applies `display: flex` to inner `<div>` containers (`.inv-v2-*-cell`) rather than `<td>` elements. This correctly preserves table cell semantics.
   - However, the absence of matching column width definitions on `<th>` and `<td>` permits the table columns to misalign or reflow unevenly.
   - Defining proportional column widths and minimum widths on the `<th>` classes (`.inventory-table-v2-th--vehicle`, `.inventory-table-v2-th--identifiers`, etc.) and matching `<td>` nth-child rules will lock in the alignment across both filled and empty states.
4. **Step 4 (Baseline Integrity Guarantee)**:
   - `git diff` confirms all V1 files are untouched at HEAD.
   - Dynamic routing in `src/app/routeModules.ts` provides clean seam isolation.
   - Automated tests in `AdversarialM4A11yMotion.test.tsx` (Section 5) and `tier1-feature-coverage.test.tsx` guarantee continuous verification that V1 remains 100% pristine.

---

## 3. Caveats

1. **JSDOM vs Real Browser Layout Engine**: Unit and E2E tests run under JSDOM (`environment: 'jsdom'`). JSDOM does not compute real layout geometry (`getBoundingClientRect`, layout reflow). Visual alignment verification must also be confirmed via build and visual check or Playwright E2E where relevant.
2. **Global CSS Precedence**: When using CSS variables like `--v10-surface` or `--v10-ink`, verify that the root container matches `#root .inventory-page` or explicitly declare fallbacks (e.g. `var(--v10-surface, var(--surface, #ffffff))` -> note: no raw hex! Use `var(--v10-surface, var(--ifx-neutral-0))`).

---

## 4. Conclusion

- **Design System Rules**: Zero tolerance for `font-size < 12px` and zero tolerance for raw hex colors outside `tokens.css`. No new CSS imports in `src/main.tsx`.
- **Top Metrics & Search Layout**: Requires styling `.inventory-decision-rail` (4-column responsive grid on desktop, compact horizontal cards) and `.inventory-primary-search` directly in the V2 stylesheet using token variables.
- **Table Grid Alignment**: Must preserve `display: flex` on inner `<div>` wrappers inside `<td>` elements and specify explicit column widths on `th` and `td` to ensure pixel-perfect column alignment.
- **V1 Isolation**: Baseline V1 files (`InventoryExperience.tsx`, `InventoryTable.tsx`, `InventoryPage.tsx`, `VehicleWorkspace.tsx`, `TransfersPage.tsx`, `ServicePage.tsx`) are verified 100% untouched and must remain completely unmodified.

---

## 5. Verification Method & Recommended Commands

### 5.1 Worker (Implementation Phase)
1. **Target Files Only**:
   - `src/features/inventory/InventoryExperienceV2.tsx`
   - `src/features/inventory/InventoryTableV2.tsx`
   - `src/features/inventory/InventoryTableV2.css` (or new `InventoryExperienceV2.css` imported locally)
   - **NEVER** edit any V1 file.
2. **Style Authoring Rules**:
   - Verify zero raw hex colors: run `grep -E "#[0-9a-fA-F]{3,8}" src/features/inventory/InventoryTableV2.css` (must return 0 matches).
   - Verify zero sub-12px font sizes: run `grep -E "font-size\s*:\s*(1[01]|[0-9])px" src/features/inventory/InventoryTableV2.css` (must return 0 matches).
   - Ensure `display: flex` remains on inner `<div>` elements and is NOT placed on `<td>` or `<tr>`.
3. **Execution Commands**:
   ```bash
   node scripts/check-design-system.mjs
   node scripts/check-repo-safety.mjs
   npx vitest run tests/unit/Milestone3PagesV2.test.tsx
   npm run build
   ```

### 5.2 Reviewers (Review Phase)
1. **Pristine Baseline Check**:
   ```bash
   git diff HEAD -- src/features/inventory/InventoryExperience.tsx src/features/inventory/InventoryTable.tsx src/features/inventory/InventoryPage.tsx src/features/inventory/VehicleWorkspace.tsx
   ```
   *Expected*: Completely empty output (0 lines changed).
2. **Main File Integrity Check**:
   ```bash
   git diff HEAD -- src/main.tsx
   ```
   *Expected*: Completely empty output.
3. **Design System Lint**:
   ```bash
   pnpm check:design-system
   ```
   *Expected*: "Design-system guard passed. Legacy debt did not increase".

### 5.3 Challengers (QA / Adversarial Hardening Phase)
1. **Baseline Integrity & A11y Suite**:
   ```bash
   npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx
   ```
   *Expected*: 24/24 passed.
2. **Stress & Concurrency Suite**:
   ```bash
   npx vitest run tests/unit/AdversarialM4Stress.test.tsx
   ```
   *Expected*: 14/14 passed.
3. **Feature Coverage Suite**:
   ```bash
   npx vitest run tests/e2e/tier1-feature-coverage.test.tsx
   ```
   *Expected*: 145/145 passed.
4. **Full Verification Suite**:
   ```bash
   pnpm check
   ```
   *Expected*: safety check passed, design-system guard passed, vitest passed, build passed.
