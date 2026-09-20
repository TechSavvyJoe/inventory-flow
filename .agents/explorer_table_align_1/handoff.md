# Handoff Report: InventoryTableV2 Column Alignment & Layout Architecture

**Target**: `src/features/inventory/InventoryTableV2.tsx` & `src/features/inventory/InventoryTableV2.css`  
**Explorer**: Table Alignment Explorer (`explorer_table_align_1`)  
**Mission**: Column Alignment, Table Layout, Sticky Headers, and Inner Wrapper Preservation  
**Date**: 2026-09-18T02:35:00Z  

---

## 1. Observation

### 1.1 Source Files & Current Implementation
- **Component File**: `src/features/inventory/InventoryTableV2.tsx`
- **Stylesheet**: `src/features/inventory/InventoryTableV2.css`
- **Parent Container**: `src/features/inventory/InventoryExperienceV2.tsx`

### 1.2 Table Grid Structure & Inner Wrapper Pattern
In `src/features/inventory/InventoryTableV2.tsx` (lines 142–329):
Every data cell (`<td>`) in `VehicleRow` wraps its content inside an inner `<div>`:
- Column 1: `<td><div className="inv-v2-vehicle-cell">...</div></td>`
- Column 2: `<td><div className="inv-v2-id-cell">...</div></td>`
- Column 3: `<td><div className="inv-v2-pricing-cell">...</div></td>`
- Column 4: `<td><div className="inv-v2-location-cell">...</div></td>`
- Column 5: `<td><div className="inv-v2-status-cell">...</div></td>`
- Column 6: `<td><div className="inv-v2-actions-cell">...</div></td>`

In `src/features/inventory/InventoryTableV2.css`:
- Line 82–85:
  ```css
  .inventory-table-v2 td {
    padding: 8px 12px;
    vertical-align: middle;
  }
  ```
  `<td>` tags do **not** have `display: flex`. They retain standard `display: table-cell`.
- Lines 88, 149, 166, 193, 218, 275: `display: flex` is strictly applied to the inner `.inv-v2-*-cell` `<div>` containers.

### 1.3 Missing Column Widths & Layout Properties
- **Table Layout Property**: In `InventoryTableV2.css` lines 18–25:
  ```css
  .inventory-table-v2 {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 13px;
    line-height: 1.4;
    color: var(--v10-ink);
  }
  ```
  `table-layout` is not defined (defaults to `auto`).
  No `min-width` is defined on `.inventory-table-v2`.
- **Header Cell Classes**: In `InventoryTableV2.tsx` line 69, `SortableHeaderCell` assigns:
  ```tsx
  className={`inventory-table-v2-th inventory-table-v2-th--${column.id}`}
  ```
  The column IDs are `vehicle`, `identifiers`, `pricing`, `location`, `status`, `actions`.
- **Missing CSS Selectors**: In `InventoryTableV2.css`, there are **zero** CSS rules for any `.inventory-table-v2-th--*` or `.inventory-table-v2-col--*` classes. Header widths are completely unassigned.
- **Missing Data Cell Classes**: In `InventoryTableV2.tsx`, `<td>` tags have no class names indicating column identity (only the inner `<div>` has a class).
- **Missing `<colgroup>`**: `InventoryTableV2.tsx` (line 350) renders `<table><thead>...</thead><tbody>...</tbody></table>` with no `<colgroup>`.

### 1.4 Sticky Headers & Border Collapse Issue
- In `InventoryTableV2.css` line 20: `border-collapse: collapse;`.
- In `InventoryTableV2.css` lines 27–40:
  ```css
  .inventory-table-v2 thead th {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--v10-surface-header);
    ...
    border-bottom: 1px solid var(--v10-border);
    padding: 10px 12px;
    white-space: nowrap;
  }
  ```
  With `border-collapse: collapse;`, browser table rendering models detach or suppress cell `border-bottom` on sticky `<th>` elements during vertical scrolling.
- In `InventoryTableV2.css` lines 67–70:
  ```css
  .inventory-table-v2 tbody tr {
    background: var(--v10-surface);
    border-bottom: 1px solid var(--v10-border-soft);
    transition: background-color 0.12s ease;
  }
  ```
  Row divider borders are placed on `tr` instead of `td`.

### 1.5 Scroll Containers & Overflow Hierarchy
- In `InventoryTableV2.css` lines 3–17:
  ```css
  .inventory-table-v2-wrapper {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--v10-border);
    border-radius: var(--radius-card, 8px);
    background: var(--v10-surface);
    box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
  }

  .inventory-table-v2-container {
    max-height: calc(100vh - 240px);
    overflow-y: auto;
    position: relative;
  }
  ```
  Two nested elements manage scrolling (`.inventory-table-v2-wrapper` has `overflow-x: auto;` while `.inventory-table-v2-container` has `overflow-y: auto;`).

### 1.6 Cell Minimum Widths vs Action Column Sizing
In `InventoryTableV2.css`:
- `.inv-v2-vehicle-cell`: `min-width: 260px;`
- `.inv-v2-id-cell`: `min-width: 140px;`
- `.inv-v2-pricing-cell`: `min-width: 110px;`
- `.inv-v2-location-cell`: `min-width: 130px;`
- `.inv-v2-status-cell`: `min-width: 130px;`
- `.inv-v2-actions-cell`: `min-width: 190px;`
However, the Actions column contains up to 4 interactive elements:
1. Shortlist heart toggle: ~30px
2. View button: ~48px
3. Move button: ~52px
4. Request button: ~64px
5. Flex gaps (3 × 6px): 18px
Total content footprint: `30 + 48 + 52 + 64 + 18 = 212px`. At `min-width: 190px`, the 4 action buttons overflow the inner container if the column is narrowed.

### 1.7 Current Build and Test State
- `npm run build`: Exit code 0, 0 errors.
- `npx vitest run tests/unit/Milestone3PagesV2.test.tsx`: 22/22 tests passed (including all 6 `InventoryTableV2` tests).
- `npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx`: 24/24 tests passed (including responsive viewport tests and ARIA keyboard tests).
- `node scripts/check-design-system.mjs`: Exit code 0 (0 sub-12px text, 0 raw hex colors added).
- `node scripts/check-repo-safety.mjs`: Exit code 0 (all V1 baseline files strictly intact).

---

## 2. Logic Chain

### Step 1: Root Cause of Table Header to Data Column Misalignment
1. In standard CSS, when `table-layout` is not specified, `table-layout: auto` is used.
2. In `table-layout: auto`, the browser calculates column widths dynamically by reading cell text length across rendered rows.
3. Because `<th>` tags have no assigned widths and `<td>` tags have no assigned widths, the browser stretches or shrinks columns whenever row data changes (different search queries, filtering, sorting, or pagination).
4. When `vehicles.length === 0` (empty search result), the `<tbody>` contains only `<td colSpan={6} className="inventory-table-v2-empty">`. Without row cells to set width cues, all 6 `<th>` elements collapse into small text widths on the far left, abandoning the rest of the table header.
5. **Deduction**: The table requires `table-layout: fixed;` with explicit percentage column widths defined on `th`/`col` elements so headers and data columns remain permanently locked together regardless of cell contents or empty states.

### Step 2: Prevention of Cell Content Overflow & Squishing
1. The sum of minimum readable widths for all 6 columns is:
   `260px (Vehicle) + 140px (IDs) + 110px (Price) + 130px (Location) + 140px (Status) + 210px (Actions) = 990px`.
2. Accounting for 12px horizontal padding on both sides of 6 columns (`12 × 2 × 6 = 144px`), the table requires a minimum width of `990px + 144px = 1134px` (or at least `1080px`).
3. Currently, `.inventory-table-v2` has no `min-width`. When the browser window is below 1100px (or when the Shortlist Drawer opens), the table shrinks, causing inner `<div>` min-widths to exceed their parent `<td>` boundaries.
4. **Deduction**: Applying `min-width: 1080px;` to `.inventory-table-v2` prevents column squishing and allows the table container to scroll horizontally smoothly on narrower screens.

### Step 3: Confirmation of Inner `<div>` Wrapper Rule (Requirement R2)
1. User requirement states: *"Maintain the fix where `display: flex` is applied to inner `<div>` wrappers inside `<td>` elements, rather than the `<td>` tags themselves, to prevent the table grid from breaking."*
2. Applying `display: flex` directly to `<td>` overrides `display: table-cell`. This removes the element from the CSS table formatting context, breaking column alignment, borders, and `colSpan`.
3. Inspection confirmed that `VehicleRow` in `InventoryTableV2.tsx` already wraps all 6 cells in `<div>` tags (`inv-v2-*-cell`).
4. **Deduction**: The Worker must preserve every inner `<div>` wrapper and keep `<td>` as `display: table-cell`. Additionally, adding explicit `inventory-table-v2-td inventory-table-v2-td--${column.id}` classes to `<td>` provides semantic styling hooks without touching `display`.

### Step 4: Sticky Header Border Flickering Resolution
1. With `border-collapse: collapse`, sticky `<th>` borders are rendered as part of the shared table grid, causing borders to vanish or background colors to bleed through during scrolling.
2. Switching `.inventory-table-v2` to `border-collapse: separate; border-spacing: 0;` gives each cell its own border box.
3. Placing `box-shadow: inset 0 -1px 0 var(--v10-border);` on `thead th` guarantees a persistent, crisp bottom border that never detaches during fast vertical scrolling.
4. Placing `border-bottom: 1px solid var(--v10-border-soft);` directly on `.inventory-table-v2 td` ensures consistent row dividers across all browsers.

### Step 5: Unified Single-Scrollport Architecture
1. Having `overflow-x: auto` on `.inventory-table-v2-wrapper` and `overflow-y: auto` on `.inventory-table-v2-container` creates two competing scroll containers, which can cause sticky headers to lose sync during horizontal scroll.
2. Configuring `.inventory-table-v2-wrapper` with `overflow: hidden; min-width: 0;` preserves the rounded border card.
3. Configuring `.inventory-table-v2-container` with `overflow: auto; max-height: calc(100vh - 240px);` establishes a single, unified scrollport for both axes.

---

## 3. Caveats

1. **V1 Baseline Preservation**: Baseline components (`InventoryTable.tsx`, `InventoryTable.desk.css`, `InventoryExperience.tsx`) must remain 100% untouched. All changes are confined to `InventoryTableV2.tsx` and `InventoryTableV2.css`.
2. **Top Metrics Scope**: The metrics area, search input, and filter pills belong to `InventoryExperienceV2.tsx` and are handled by the companion Explorer (`explorer_top_section_1`). The table changes here are completely modular and do not conflict with the top section layout.
3. **Mobile Viewports (<1080px)**: Because dealership inventory tables require 6 dense operational columns (Vehicle, Identifiers, Pricing, Location, Status, and Actions), retaining `min-width: 1080px` with container horizontal scroll is the established pattern verified in `tests/unit/AdversarialM4A11yMotion.test.tsx`.

---

## 4. Conclusion & Concrete Recommendations

### Summary Table of Column Width Distribution

| Column ID | Label | Proposed Width (%) | Minimum Content Width | Content Description |
|:---|:---|:---:|:---:|:---|
| `vehicle` | **Vehicle** | **27%** | 260px | Thumbnail (54×40px), Title link, Specs subtitle |
| `identifiers` | **Stock / VIN** | **14%** | 140px | `#STK` chip, 17-char VIN chip, Copy buttons |
| `pricing` | **Price & Miles** | **12%** | 110px | Sale price, MSRP delta, Mileage, Days listed |
| `location` | **Location & Move** | **13%** | 130px | Home store label, Movement status pill |
| `status` | **Hold & Service** | **14%** | 140px | Hold badge, Service readiness badge, Recall icon |
| `actions` | **Actions** | **20%** | 210px | Shortlist (♥), View, Move, Request buttons |
| **Total** | | **100%** | **990px** (+ paddings = ~1080px) | Balanced, high-density, no dead space |

---

### Concrete Implementation Proposals for the Worker

#### Change A: `src/features/inventory/InventoryTableV2.tsx`

1. **Add `<colgroup>` declaration immediately before `<thead>`**:
```tsx
<table
  className="inventory-table-v2"
  role="table"
  aria-label="Inventory vehicles"
>
  <colgroup>
    <col className="inventory-table-v2-col inventory-table-v2-col--vehicle" />
    <col className="inventory-table-v2-col inventory-table-v2-col--identifiers" />
    <col className="inventory-table-v2-col inventory-table-v2-col--pricing" />
    <col className="inventory-table-v2-col inventory-table-v2-col--location" />
    <col className="inventory-table-v2-col inventory-table-v2-col--status" />
    <col className="inventory-table-v2-col inventory-table-v2-col--actions" />
  </colgroup>
  <thead>
```

2. **Add column class names to `<td>` while strictly maintaining inner `<div>` wrappers**:
```tsx
{/* 1. Vehicle info */}
<td className="inventory-table-v2-td inventory-table-v2-td--vehicle">
  <div className="inv-v2-vehicle-cell">
    ...
  </div>
</td>

{/* 2. Stock / VIN chips */}
<td className="inventory-table-v2-td inventory-table-v2-td--identifiers">
  <div className="inv-v2-id-cell">
    ...
  </div>
</td>

{/* 3. Pricing & Mileage */}
<td className="inventory-table-v2-td inventory-table-v2-td--pricing">
  <div className="inv-v2-pricing-cell">
    ...
  </div>
</td>

{/* 4. Location & Movement */}
<td className="inventory-table-v2-td inventory-table-v2-td--location">
  <div className="inv-v2-location-cell">
    ...
  </div>
</td>

{/* 5. Status Badges */}
<td className="inventory-table-v2-td inventory-table-v2-td--status">
  <div className="inv-v2-status-cell">
    ...
  </div>
</td>

{/* 6. Quick Actions */}
<td className="inventory-table-v2-td inventory-table-v2-td--actions">
  <div className="inv-v2-actions-cell">
    ...
  </div>
</td>
```

---

#### Change B: `src/features/inventory/InventoryTableV2.css`

Replace the table setup and column definition sections with the following hardened CSS:

```css
/* High-Density Inventory Table V2 Stylesheet */

.inventory-table-v2-wrapper {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--v10-border);
  border-radius: var(--radius-card, 8px);
  background: var(--v10-surface);
  box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
}

.inventory-table-v2-container {
  width: 100%;
  max-height: calc(100vh - 240px);
  overflow: auto;
  position: relative;
  overscroll-behavior: contain;
}

.inventory-table-v2 {
  width: 100%;
  min-width: 1080px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  text-align: left;
  font-size: 13px;
  line-height: 1.4;
  color: var(--v10-ink);
}

/* Explicit Column Width Allocations (Total = 100%) */
.inventory-table-v2-th--vehicle,
.inventory-table-v2-col--vehicle {
  width: 27%;
  min-width: 260px;
}

.inventory-table-v2-th--identifiers,
.inventory-table-v2-col--identifiers {
  width: 14%;
  min-width: 140px;
}

.inventory-table-v2-th--pricing,
.inventory-table-v2-col--pricing {
  width: 12%;
  min-width: 110px;
}

.inventory-table-v2-th--location,
.inventory-table-v2-col--location {
  width: 13%;
  min-width: 130px;
}

.inventory-table-v2-th--status,
.inventory-table-v2-col--status {
  width: 14%;
  min-width: 140px;
}

.inventory-table-v2-th--actions,
.inventory-table-v2-col--actions {
  width: 20%;
  min-width: 210px;
}

/* Sticky Header Cells */
.inventory-table-v2 thead th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--v10-surface-header);
  color: var(--v10-support);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 10px 12px;
  white-space: nowrap;
  box-shadow: inset 0 -1px 0 var(--v10-border);
  border: none;
}

/* Data Cells */
.inventory-table-v2 td {
  padding: 8px 12px;
  vertical-align: middle;
  border-bottom: 1px solid var(--v10-border-soft);
  background: var(--v10-surface);
}

.inventory-table-v2 tbody tr {
  transition: background-color 0.12s ease;
}

.inventory-table-v2 tbody tr:hover td {
  background: var(--v10-surface-subtle);
}

.inventory-table-v2 tbody tr.is-selected td {
  background: var(--v10-surface-active);
  box-shadow: inset 0 1px 0 var(--v10-blue), inset 0 -1px 0 var(--v10-blue);
}

.inventory-table-v2 tbody tr.is-selected td:first-child {
  box-shadow: inset 1px 1px 0 var(--v10-blue), inset 0 -1px 0 var(--v10-blue);
}

.inventory-table-v2 tbody tr.is-selected td:last-child {
  box-shadow: inset -1px 1px 0 var(--v10-blue), inset 0 -1px 0 var(--v10-blue);
}

/* Actions Cell Adjustments */
.inv-v2-actions-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 210px;
  flex-wrap: nowrap;
}

/* Vehicle Cell Detail Shrink Safety */
.inv-v2-vehicle-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
```

---

## 5. Verification Method

To independently verify these recommendations once implemented by the Worker:

1. **Unit Test Suite**:
   ```bash
   npx vitest run tests/unit/Milestone3PagesV2.test.tsx
   ```
   *Expected*: All 22 tests pass, including all 6 table tests (`renders table with sticky header columns`, `renders monospace Stock and VIN chips`, etc.).

2. **Adversarial & Responsive Viewport Test**:
   ```bash
   npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx
   ```
   *Expected*: All 24 tests pass, confirming responsive wrapper scrolling at 390px and ARIA sort attributes.

3. **Design System Token Check**:
   ```bash
   node scripts/check-design-system.mjs
   ```
   *Expected*: Exit code 0 with message:
   `Design-system guard passed. Legacy debt did not increase (596 sub-12px declarations; 2681 raw colors outside token files).`

4. **Repository Baseline Integrity Check**:
   ```bash
   node scripts/check-repo-safety.mjs
   ```
   *Expected*: Exit code 0, 0 baseline files modified.

5. **Production Build Compilation**:
   ```bash
   npm run build
   ```
   *Expected*: Exit code 0 with 0 TypeScript and 0 Vite bundle errors.

### Invalidation Conditions
The solution would be invalidated if:
- Any `display: flex` is added directly to `<td>` or `<tr>`.
- `table-layout: fixed` is removed, allowing columns to shift on query changes.
- Sum of percentage widths fails to equal 100%.
- Raw hex colors or font sizes `< 12px` are introduced into `InventoryTableV2.css`.
