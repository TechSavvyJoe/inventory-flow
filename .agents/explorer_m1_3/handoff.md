# Handoff Report: CSS Design System Compliance & Token Hardening (Milestone 1)

**Agent**: Explorer 3 (`explorer_m1_3`)  
**Milestone**: Milestone 1 — Foundational Setup & Baseline Integrity  
**Date**: 2026-09-17  
**Working Directory**: `/Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_m1_3`  
**Target Files Analyzed**:
- `scripts/check-design-system.mjs`
- `scripts/design-system-baseline.json`
- `src/features/inventory/VehicleWorkspaceV2.css`
- `src/design-system/tokens.css`
- `src/styles/tokens.css`
- `src/styles/inventory-production-v10.css`

---

## 1. Observation

### 1.1 Direct Tool Execution & Verbatim Error Output
Running `node scripts/check-design-system.mjs` from the repository root produced an exit code of `1` with the following verbatim terminal output:

```
Design-system regression check failed:
- src/features/inventory/VehicleWorkspaceV2.css: smallText increased from 0 to 2
- src/features/inventory/VehicleWorkspaceV2.css: rawColors increased from 0 to 1
```

### 1.2 Inspection of `scripts/check-design-system.mjs` Measurement Logic
Inspection of `scripts/check-design-system.mjs` (lines 27–55) revealed how CSS compliance is measured:

```javascript
// scripts/check-design-system.mjs lines 27-37:
function measureCss(content, filePath) {
  const smallText = Array.from(
    content.matchAll(/font-size\s*:\s*(\d*\.?\d+)px/gi),
    (match) => Number(match[1]),
  ).filter((size) => size < 12).length
  const rawColors = filePath.endsWith('/tokens.css')
    ? 0
    : Array.from(content.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)).length

  return { smallText, rawColors }
}
```

Lines 45–54 enforce regression allowances against `scripts/design-system-baseline.json`:
```javascript
const allowance = baseline.files[filePath] ?? { smallText: 0, rawColors: 0 }
measurements[filePath] = measurement

for (const metric of ['smallText', 'rawColors']) {
  if (measurement[metric] > allowance[metric]) {
    failures.push(
      `${filePath}: ${metric} increased from ${allowance[metric]} to ${measurement[metric]}`,
    )
  }
}
```

Because `src/features/inventory/VehicleWorkspaceV2.css` (and any future V2 CSS files such as `InventoryTableV2.css`, `ServicePageV2.css`, `TransfersPageV2.css`) are new files not present in `baseline.files`, their allowance defaults strictly to `{ smallText: 0, rawColors: 0 }`. Any occurrence of `font-size < 12px` or raw `#hex` color triggers an immediate build-blocking failure.

### 1.3 Exact Violations in `src/features/inventory/VehicleWorkspaceV2.css`
A targeted scan of `src/features/inventory/VehicleWorkspaceV2.css` identified exactly 3 violating lines:

1. **Line 424 — `smallText` violation (11px < 12px)**:
   ```css
   423: .vdp-header-persistent-rail .vdp-focus-identifiers dt {
   424:   font-size: 11px;
   425:   text-transform: uppercase;
   426:   letter-spacing: 0.5px;
   427:   color: var(--v10-support);
   428:   font-weight: 600;
   429: }
   ```

2. **Line 450 — `rawColors` violation (raw hex `#fff`)**:
   ```css
   448:   padding: 6px 14px;
   449:   background: var(--v10-ink-strong);
   450:   color: #fff;
   451:   border-radius: 6px;
   452:   font-weight: 600;
   453:   font-size: 13px;
   ```

3. **Line 507 — `smallText` violation (11px < 12px)**:
   ```css
   506: .vdp-dense-grid .inventory-workspace-fact dt {
   507:   font-size: 11px;
   508:   color: var(--v10-support);
   509:   text-transform: uppercase;
   510:   letter-spacing: 0.3px;
   511:   margin-bottom: 2px;
   512: }
   ```

No other violations exist anywhere in `VehicleWorkspaceV2.css`.

---

## 2. Logic Chain

1. **Measurement Rules**:
   - `smallText` matches any `font-size: <N>px` where `N < 12`.
   - `rawColors` matches any hex literal `#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b` unless the file path ends with `/tokens.css`.
   - The file `src/features/inventory/VehicleWorkspaceV2.css` has `allowance = { smallText: 0, rawColors: 0 }`.

2. **Line 424 & Line 507 (`font-size: 11px;`)**:
   - Both are definition-term labels (`dt`) for uppercase metadata (Stock #/VIN identifiers in the persistent rail and specifications in the dense grid).
   - In `VehicleWorkspaceV2.css`, all other secondary metadata and label selectors use `font-size: 12px;` (e.g. lines 124, 133, 144, 147, 160, 169, 178, 184, 197, 215, 223, 225, 230, 234, 237, 239, 240, 265, 303, 306, 310, 313, 317, 320, 335).
   - Changing `font-size: 11px;` to `font-size: 12px;` satisfies `N >= 12`, reducing `smallText` count from 2 to 0.
   - Visually, at `12px` with `text-transform: uppercase`, `font-weight: 600`, and `letter-spacing: 0.3px-0.5px`, the labels remain crisp, high-density, and significantly more legible on all displays.

3. **Line 450 (`color: #fff;`)**:
   - The selector `.vdp-action-dock button, .vdp-action-dock a.vdp-action-dock-btn` defines white text against a dark background (`background: var(--v10-ink-strong)`).
   - In `src/styles/inventory-production-v10.css` (line 16), `--v10-surface` is mapped to `var(--ifx-neutral-0)`, which is defined in `src/design-system/tokens.css` as `#fff`.
   - Throughout `VehicleWorkspaceV2.css` (e.g. lines 53 and 83) and `inventory-production-v10.css` (lines 129–130), white text on dark or blue buttons is styled using `color: var(--v10-surface);`.
   - Replacing `color: #fff;` with `color: var(--v10-surface);` eliminates the raw hex literal, reducing `rawColors` from 1 to 0 while preserving exact rendering.

4. **Post-Fix In-Memory Verification**:
   - Simulating these three replacements against `measureCss` yielded `{ smallText: 0, rawColors: 0 }`.
   - Running the full validation loop of `scripts/check-design-system.mjs` with this fix resulted in exit code 0:
     `Design-system guard passed. Legacy debt did not increase (596 sub-12px declarations; 2681 raw colors outside token files).`

---

## 3. Proposed Fix & Unified Diff Patch

The exact diff to fix `src/features/inventory/VehicleWorkspaceV2.css`:

```diff
--- a/src/features/inventory/VehicleWorkspaceV2.css
+++ b/src/features/inventory/VehicleWorkspaceV2.css
@@ -421,7 +421,7 @@
   gap: 2px;
 }
 .vdp-header-persistent-rail .vdp-focus-identifiers dt {
-  font-size: 11px;
+  font-size: 12px;
   text-transform: uppercase;
   letter-spacing: 0.5px;
   color: var(--v10-support);
@@ -447,7 +447,7 @@
   gap: 6px;
   padding: 6px 14px;
   background: var(--v10-ink-strong);
-  color: #fff;
+  color: var(--v10-surface);
   border-radius: 6px;
   font-weight: 600;
   font-size: 13px;
@@ -504,7 +504,7 @@
   margin: 0;
 }
 .vdp-dense-grid .inventory-workspace-fact dt {
-  font-size: 11px;
+  font-size: 12px;
   color: var(--v10-support);
   text-transform: uppercase;
   letter-spacing: 0.3px;
```

A patch file containing this change is stored at:
`/Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_m1_3/vehicle-workspace-v2-token-fixes.patch`

---

## 4. Comprehensive Design System Guidelines & Token Map for V2 CSS

All subsequent V2 CSS files (`VehicleWorkspaceV2.css`, `InventoryTableV2.css`, `ServicePageV2.css`, `TransfersPageV2.css`) **must strictly adhere** to these rules. Because none of these files will be grandfathered into `scripts/design-system-baseline.json`, any deviation will immediately fail CI.

### 4.1 Core Authoring Rules

1. **Rule 1: Absolute Floor of 12px for Typography**
   - **Never write** `font-size: 11px`, `10px`, `9px`, or any value `< 12px`.
   - Smallest allowed font size is `12px` (or `var(--ifx-text-xs)` / `0.75rem`).
   - For high-density labels, pills, timestamps, and table headers: use `font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;`.

2. **Rule 2: Zero Raw Hex Colors (`#...`)**
   - **Never write** hex values (`#fff`, `#102238`, `#0759bd`, etc.) in any V2 stylesheet — **not even in CSS comments**! (The linter uses a global regex across the entire file content).
   - Use CSS custom property tokens (`var(--...)`) or standard `rgb(...)` / `color-mix(...)` when opacity is needed.
   - Do not use CSS ID selectors whose names match hex values (e.g., `#dad`, `#bad`).

3. **Rule 3: Local Scoping Only — No Global Imports in `src/main.tsx`**
   - Import V2 CSS files inside their corresponding component files (e.g. `import './InventoryTableV2.css'`).
   - Do **not** add imports to `src/main.tsx` (which would trigger the `unreviewed global CSS layers` linter error).

---

### 4.2 Universal Token Map Reference

#### Surface & Background Tokens
| Role / Intent | Preferred Token | Fallback / Alternative | Resolved Value |
|---|---|---|---|
| Card / Modal / Table Row Background | `var(--v10-surface)` | `var(--ifx-neutral-0)`, `var(--surface)` | Pure white (`#ffffff`) |
| Subtle Card / Table Header / Striping | `var(--v10-surface-subtle)` | `var(--ifx-neutral-50)`, `var(--surface-soft)` | Off-white tint (`#f6fafd` / `#f5f8fb`) |
| Column / Panel Header Background | `var(--v10-surface-header)` | `var(--ifx-neutral-100)`, `var(--surface-muted)`| Soft grayish blue (`#edf3f7`) |
| Active / Selected Row or Card | `var(--v10-surface-active)` | `var(--blue-050)`, `var(--ifx-info-surface)` | Light blue tint (`#edf5ff`) |
| Primary Dark Fill (Dock / Header Rail)| `var(--v10-ink-strong)` | `var(--navy-900)`, `var(--ifx-neutral-900)` | Dark navy ink (`#0a1d2e` / `#062a4d`) |
| Primary Accent Button Fill | `var(--v10-blue)` | `var(--ifx-product-flow)`, `var(--blue-600)` | Accent blue (`#4c5eff` / `#0759bd`) |
| Primary Accent Button Hover | `var(--v10-blue-strong)` | `var(--ifx-product-flow-strong)`, `var(--blue-700)` | Deep accent blue (`#3546db` / `#064b9f`) |
| Modal Scrim / Backdrop | `rgb(3 18 33 / 55%)` | `rgb(7 23 34 / 60%)` | Semi-transparent navy scrim |

#### Text & Foreground Tokens
| Role / Intent | Preferred Token | Fallback / Alternative | Resolved Value |
|---|---|---|---|
| High-Contrast Titles / Prices / Bold Values | `var(--v10-ink-strong)` | `var(--ink-900)`, `var(--navy-900)` | Deep ink (`#102238` / `#0a1d2e`) |
| Standard Body Text / Table Data | `var(--v10-ink)` | `var(--ink-700)`, `var(--ifx-neutral-800)` | Dark neutral text (`#34485e`) |
| Secondary Labels / Metadata / Descriptions | `var(--v10-support)` | `var(--ink-600)`, `var(--ifx-neutral-600)` | Medium neutral slate (`#526778` / `#536579`) |
| Muted Hints / Captions / Disabled Text | `var(--v10-muted)` | `var(--ink-500)`, `var(--ifx-neutral-400)` | Tertiary neutral (`#8ea2b0` / `#617287`) |
| Inverted White Text (on Dark / Blue buttons) | `var(--v10-surface)` | `var(--ifx-neutral-0)`, `var(--surface)` | Pure white (`#ffffff`) |
| Accent Link / Interactive Text | `var(--v10-blue)` | `var(--blue-600)`, `var(--ifx-info)` | Accent blue (`#0759bd` / `#1263bf`) |

#### Border & Divider Tokens
| Role / Intent | Preferred Token | Fallback / Alternative | Resolved Value |
|---|---|---|---|
| Soft Internal Dividers / Sub-card Lines | `var(--v10-border-soft)` | `var(--ifx-neutral-200)`, `var(--ifx-border-subtle)` | Soft light border (`#d8e3ea`) |
| Standard Card / Table / Modal Borders | `var(--v10-border)` | `var(--border)`, `var(--ifx-neutral-300)` | Standard border (`#bbcad4` / `#dce4ed`) |
| Strong Inputs / Hover Borders | `var(--border-strong)` | `var(--ifx-neutral-400)`, `var(--ifx-border-control)` | Strong border (`#c8d4e1`) |
| Active Selection / Focus Border | `var(--v10-blue)` | `var(--blue-600)`, `var(--focus)` | Accent border (`#0759bd` / `#4c96ea`) |
| Focus Ring Outline | `var(--ifx-focus-ring)`| `0 0 0 3px color-mix(in srgb, var(--ifx-info) 24%, transparent)` | Focus outline |

#### Operational Status Tokens (Badges, Kanban Columns, Indicator Pills)
| State | Foreground Text Token | Background Surface Token | Border Accent Token |
|---|---|---|---|
| **Ready / Serviced / Pass** | `var(--ifx-success)` or `var(--green)` | `var(--ifx-success-surface)` or `var(--green-bg)` | `color-mix(in srgb, var(--ifx-success) 30%, transparent)` |
| **Needs Service / Warning** | `var(--ifx-warning)` or `var(--amber)` | `var(--ifx-warning-surface)` or `var(--amber-bg)` | `color-mix(in srgb, var(--ifx-warning) 30%, transparent)` |
| **Danger / Stop / Recall** | `var(--ifx-danger)` or `var(--red)` | `var(--ifx-danger-surface)` or `var(--red-bg)` | `color-mix(in srgb, var(--ifx-danger) 30%, transparent)` |
| **In Transit / Movement / Info**| `var(--ifx-info)` or `var(--blue-700)` | `var(--ifx-info-surface)` or `var(--blue-050)` | `color-mix(in srgb, var(--ifx-info) 30%, transparent)` |
| **DealerMail / Active Hold** | `var(--ifx-hold)` or `var(--violet)` | `var(--ifx-hold-surface)` or `var(--violet-bg)` | `color-mix(in srgb, var(--ifx-hold) 30%, transparent)` |

#### Typography Scale
| Hierarchy Level | Allowed px | Allowed Token | Recommended Usage |
|---|---|---|---|
| **Micro (MINIMUM)** | `12px` | `var(--ifx-text-xs)` (0.75rem) | `dt` labels, badge pills, timestamps, table sub-lines |
| **Small** | `13px` | `var(--ifx-text-sm)` (0.8125rem) | Quick-action buttons, chips, filter dropdowns |
| **Base** | `14px` | `var(--ifx-text-md)` (0.875rem) | Form inputs, table cells, definition values (`dd`), tabs |
| **Large** | `15px` - `16px` | `var(--ifx-text-body)` / `var(--ifx-text-lg)` | Card section titles, summary lines |
| **Subheading** | `18px` - `20px` | `var(--ifx-text-xl)` | Modal titles, column headers, panel titles |
| **Display / Hero**| `24px` - `32px` | `var(--ifx-text-h3)` / `var(--ifx-text-h2)` | Cockpit hero price, vehicle title in header rail |

---

### 4.3 Specific Implementation Playbook for Each V2 Feature File

#### 1. `VehicleWorkspaceV2.css` (M1 Fix & M2 Refinements)
- Apply the 3-line patch to lines 424, 450, 507.
- Use `var(--v10-surface-subtle)` for the 3-column cockpit grid background cards.
- Ensure the 2x2 document cards grid uses `min-width: 0; overflow: hidden;` and `font-size: 12px;` for document timestamps and status indicators.
- In-card quick action buttons (Hold, Service, Move, Take-Home):
  - `font-size: 13px; font-weight: 600; min-height: 36px; padding: 6px 12px; border-radius: var(--radius-control);`
  - Hover states: `transition: background 0.15s ease, transform 0.1s ease;`

#### 2. `InventoryTableV2.css` (M3 High-Density Table)
- **Do not copy legacy classes** from `InventoryTable.compact-v3.css` or `InventoryTable.flow.css` without purging raw hex colors (`#dce4ed`, `#edf5ff`, `#102238`, `#0759bd`).
- Sticky table header:
  ```css
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
    border-bottom: 1px solid var(--v10-border);
    padding: 8px 12px;
  }
  ```
- Compact rows:
  ```css
  .inventory-table-v2 tbody tr {
    background: var(--v10-surface);
    border-bottom: 1px solid var(--v10-border-soft);
  }
  .inventory-table-v2 tbody tr:hover {
    background: var(--v10-surface-subtle);
  }
  ```
- Monospace VIN / Stock pills:
  ```css
  .inventory-table-v2 .vehicle-id-badge {
    font-family: var(--ifx-font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--v10-ink);
    background: var(--v10-surface-subtle);
    border: 1px solid var(--v10-border-soft);
    border-radius: var(--ifx-radius-xs);
    padding: 2px 6px;
  }
  ```

#### 3. `ServicePageV2.css` (M3 Service Kanban Board)
- Kanban 3-column layout:
  ```css
  .service-board-v2 {
    display: grid;
    grid-template-columns: repeat(3, minmax(300px, 1fr));
    gap: 16px;
    align-items: start;
  }
  ```
- Column header styling:
  - Needs Service: `color: var(--ifx-warning); background: var(--ifx-warning-surface); border: 1px solid color-mix(in srgb, var(--ifx-warning) 30%, transparent);`
  - In Service: `color: var(--ifx-info); background: var(--ifx-info-surface); border: 1px solid color-mix(in srgb, var(--ifx-info) 30%, transparent);`
  - Serviced / Ready: `color: var(--ifx-success); background: var(--ifx-success-surface); border: 1px solid color-mix(in srgb, var(--ifx-success) 30%, transparent);`
- Quick status advance button:
  ```css
  .service-quick-advance-btn {
    font-size: 12px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: var(--radius-control);
    background: var(--v10-surface);
    border: 1px solid var(--v10-border);
    color: var(--v10-ink);
    cursor: pointer;
  }
  .service-quick-advance-btn:hover {
    border-color: var(--v10-blue);
    color: var(--v10-blue);
    background: var(--v10-surface-subtle);
  }
  ```

#### 4. `TransfersPageV2.css` (M3 Movement Board)
- Movement cards and timeline nodes:
  - Route header (Origin -> Destination): `font-size: 13px; font-weight: 700; color: var(--v10-ink-strong);`
  - ETA / Elapsed timer pill: `font-size: 12px; font-weight: 600; background: var(--ifx-info-surface); color: var(--ifx-info); border-radius: var(--ifx-radius-full); padding: 2px 8px;`
  - Custodian tag: `font-size: 12px; color: var(--v10-support);`
- Transfer action modal dialog:
  - Replace legacy V1 raw hex colors (`#d4dee9`, `#0759bd`, `#062a4d`, `#536579`) with:
    - Dialog border: `var(--v10-border)`
    - Title: `var(--v10-ink-strong)`
    - Subtitle: `var(--v10-support)`
    - Primary button: `background: var(--v10-blue); color: var(--v10-surface);`

---

## 5. Caveats

1. **Read-Only Explorer Role Constraint**:
   - In accordance with the Explorer archetype constraints, this agent did not directly edit `src/features/inventory/VehicleWorkspaceV2.css`.
   - The verified unified diff patch has been generated, tested in-memory, and saved to `.agents/explorer_m1_3/vehicle-workspace-v2-token-fixes.patch` ready for the Milestone 1 implementer.
2. **Pre-existing Legacy CSS Debt**:
   - Older V1 files (e.g. `inventory-modern.css`, `transfer-workspace-v3.css`) contain hundreds of sub-12px declarations and raw hex values grandfathered in `scripts/design-system-baseline.json`.
   - The design system guard strictly ensures that **debt does not increase**. V2 files must have 0 violations.
3. **No ID Selectors Matching Hex Digits**:
   - CSS ID selectors that happen to be valid 3, 4, 6, or 8-character hex words (e.g. `#b8cee0`, `#c0ffee`, `#fade`) will trigger false positives in `measureCss`. Standard class-based selectors (`.class-name`) or non-hex ID names must always be used.

---

## 6. Conclusion

1. **Root Cause**: The failure of `node scripts/check-design-system.mjs` is isolated entirely to three lines in `src/features/inventory/VehicleWorkspaceV2.css`:
   - Line 424: `font-size: 11px`
   - Line 450: `color: #fff`
   - Line 507: `font-size: 11px`
2. **Direct Fix**:
   - Update line 424 to `font-size: 12px;`
   - Update line 450 to `color: var(--v10-surface);`
   - Update line 507 to `font-size: 12px;`
3. **Exit Code 0**: Once applied, `node scripts/check-design-system.mjs` exits with code 0 (`Design-system guard passed. Legacy debt did not increase`).
4. **Actionable Token Map**: Section 4 provides a comprehensive token mapping and development standard that guarantees zero linter regressions across all upcoming V2 CSS assets (`VehicleWorkspaceV2.css`, `InventoryTableV2.css`, `ServicePageV2.css`, `TransfersPageV2.css`).

---

## 7. Verification Method

### 7.1 How to Apply & Verify the Fix
1. Apply the patch to `src/features/inventory/VehicleWorkspaceV2.css`:
   ```bash
   patch -p1 < .agents/explorer_m1_3/vehicle-workspace-v2-token-fixes.patch
   ```
   Or manually replace the three lines in `src/features/inventory/VehicleWorkspaceV2.css` as documented in Section 3.
2. Run the design system check:
   ```bash
   node scripts/check-design-system.mjs
   ```
   **Expected output**:
   ```
   Design-system guard passed. Legacy debt did not increase (596 sub-12px declarations; 2681 raw colors outside token files).
   ```
   **Expected exit code**: `0`
3. Verify zero TypeScript or build regressions:
   ```bash
   npm run build
   ```
   (or `npx tsc -b && npx vite build`)

### 7.2 Invalidation Conditions
- Any future edit to any V2 CSS file introducing `font-size: < 12px` or a `#hex` literal outside `tokens.css`.
- Any addition of a global stylesheet import to `src/main.tsx` not registered in `scripts/design-system-baseline.json`.
