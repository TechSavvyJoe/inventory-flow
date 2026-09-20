# Top Section Layout Investigation & Architecture Report

## 1. Observation

### 1.1 Current Component & CSS Structure
- **`src/features/inventory/InventoryExperienceV2.tsx`**:
  - Line 20 imports:
    ```tsx
    import "./InventoryTableV2.css";
    ```
    There is no `InventoryExperienceV2.css` imported or present in the repository.
  - Line 183-193 sets inline styles on the container:
    ```tsx
    className={`inventory-experience-v2 ${className}`.trim()}
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px 20px",
      background: "var(--v10-surface)",
      minHeight: "100%",
    }}
    ```
  - Lines 195-294 define an inline-styled `<header>` containing title, count subtitle, and scope switcher buttons.
  - Line 297 renders the decision metrics rail:
    ```tsx
    {metrics ? <InventoryDecisionRail metrics={metrics} /> : null}
    ```
  - Lines 300-367 define the controls bar containing `<InventoryPredictiveSearch>` and quick view filter buttons, wrapped in an inline-styled `<div>` (`display: flex; justify-content: space-between; alignItems: center; flexWrap: wrap; gap: 12px;`).

### 1.2 Decision Metrics Rail (`InventoryDecisionRail.tsx`)
- Lines 40-79 output:
  ```tsx
  <section className="inventory-decision-rail" aria-label="Inventory decisions">
    {METRICS.map(({ key, label, Icon, tone }) => {
      ...
      return onSelect ? (
        <button className={`inventory-metric inventory-metric--button${isActive ? " is-active" : ""}`} ...>
      ) : (
        <div className="inventory-metric" key={key}>
          <span className={`inventory-metric__icon inventory-tone--${tone}`} aria-hidden="true">
            <Icon size={22} strokeWidth={1.75} />
          </span>
          <span className="inventory-metric__copy">
            <span className="inventory-metric__label">{label}</span>
            <strong className="inventory-metric__value">{formatNumber(metrics[key])}</strong>
          </span>
        </div>
      );
    })}
  </section>
  ```
- Grep search for `.inventory-decision-rail` across `src/` reveals matches **only** in `src/features/inventory/inventory.css` (lines 400, 1536, 1571, 1835) and `src/features/inventory/InventoryDecisionRail.tsx`.
- `src/features/inventory/inventory.css` is imported **only** by baseline V1 `InventoryExperience.tsx` (line 43: `import "./inventory.css";`).
- `InventoryExperienceV2` does NOT import `inventory.css`.

### 1.3 Search Input & The Missing `.inventory-sr-only` ("Helper Text")
- `src/features/inventory/InventoryPredictiveSearch.tsx`, lines 178-220:
  ```tsx
  return (
    <div className="inventory-predictive-search" ref={rootRef} onBlur={handleBlur}>
      <div className="inventory-primary-search">
        <Search size={19} strokeWidth={1.75} aria-hidden="true" />
        <label className="inventory-sr-only" htmlFor={id}>Search inventory</label>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={hintId}
          ...
        />
        ...
      </div>
      <span className="inventory-sr-only" id={hintId}>
        Search supports partial stock and VIN, multiple terms, punctuation variants, and common spelling mistakes. Use the arrow keys to review suggestions, Enter to choose, and Escape to close.
      </span>
  ```
- Grep search for `inventory-sr-only` across `src/` reveals it is defined **only** in:
  - `src/features/inventory/inventory.css` (line 1496):
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
  - `src/features/inventory/VehicleWorkspace.compact-v3.css` (line 1836, scoped to compact-v3 workspace).
- Neither `main.tsx`, `InventoryTableV2.css`, nor any other V2 stylesheet defines `.inventory-sr-only`.
- Global CSS rules for `.inventory-primary-search` in `src/styles/inventory-experience-final.css` and `inventory-production-v10.css` are scoped exclusively to:
  - `.inventory-experience--modern .inventory-primary-search`
  - `#root .inventory-experience--modern .inventory-primary-search`
  - `.if-srp .inventory-primary-search`
  Because `InventoryExperienceV2.tsx` uses `className="inventory-experience-v2"` (not `inventory-experience--modern`), none of these global rules match.

### 1.4 Test & Design System Constraints
- `node scripts/check-design-system.mjs` checks every CSS file in `src/`:
  - Fails if `font-size < 12px` (smallText) exceeds baseline allowance (0 for new files).
  - Fails if raw hex colors (`#...`) outside `tokens.css` exceed baseline allowance (0 for new files).
  - Fails if `src/main.tsx` adds unreviewed global CSS layers.
- Current test suite status: `npm run test` executes 116 test files (1792 tests) with 100% pass rate.
- Current build status: `npm run build` succeeds in ~380ms with 0 errors.

---

## 2. Logic Chain

1. **Why the Decision Metrics Stack Vertically**:
   - `InventoryDecisionRail` outputs a `<section className="inventory-decision-rail">` containing four `<div className="inventory-metric">` elements.
   - Because `InventoryExperienceV2.tsx` does not import `inventory.css` and does not have its own dedicated stylesheet, no CSS rules apply to `.inventory-decision-rail` or `.inventory-metric`.
   - In browser user-agent stylesheets, `<section>` and `<div>` are default `display: block; width: 100%`.
   - As a direct consequence, each of the four metrics ("Public units", "Current holds", "Away from home", "Return overdue") takes up a full line and stacks vertically downwards instead of forming a horizontal 4-column row.
   - Furthermore, the internal elements (`.inventory-metric__icon`, `.inventory-metric__copy`, `.inventory-metric__label`, `.inventory-metric__value`) lack flexbox positioning, borders, backgrounds, and typography styles, rendering as bare unstyled text lines.

2. **Why the Search Input & "Helper Text" Float Awkwardly**:
   - Inside `InventoryPredictiveSearch.tsx`, the search input is accompanied by a `<label className="inventory-sr-only">Search inventory</label>` and a 163-character accessibility hint: `<span className="inventory-sr-only" id={hintId}>Search supports partial stock and VIN, multiple terms, punctuation variants, and common spelling mistakes. Use the arrow keys to review suggestions, Enter to choose, and Escape to close.</span>`.
   - These elements are designed for screen-reader accessibility via `aria-describedby={hintId}` and `htmlFor={id}`.
   - Because `.inventory-sr-only` is undefined in V2 CSS, browser default inline rendering applies to both elements. The full 163-character paragraph renders as visible body copy directly below the search input in normal document flow.
   - This expands the search container from an expected 38-42px height to ~90-100px.
   - Concurrently, `.inventory-primary-search` lacks `display: flex; align-items: center;` and input border/background styling, leaving the raw `<Search />` icon unaligned next to a default browser input with a gray inset border.
   - The user observed this visible, wrapping accessibility paragraph and described it as "helper text floating awkwardly".

3. **Why the Filter Pills Misalign**:
   - In `InventoryExperienceV2.tsx`, the controls bar wrapper uses `alignItems: "center"` and `flexWrap: "wrap"`.
   - The ballooned search container (due to the visible 163-character helper text) occupies disproportionate vertical space (~100px).
   - The filter pills on the right are vertically centered against this ballooned box, or pushed down to wrap awkwardly beneath it on narrower viewports.
   - Without unified container classes and proper spacing, the search and pills appear haphazardly stacked.

4. **Required Remedy**:
   - Create `src/features/inventory/InventoryExperienceV2.css` (imported in `InventoryExperienceV2.tsx`).
   - Define `.inventory-sr-only` with standard accessible clipping so that screen-reader text is completely hidden from visual view without breaking accessibility.
   - Style `.inventory-decision-rail` as a horizontal 4-column grid (`grid-template-columns: repeat(4, minmax(0, 1fr))`) with compact, high-density card padding, tone icons, and tabular numeral values.
   - Style `.inventory-primary-search` as a compact (38px height) flex row with aligned icon, transparent input, and focus ring.
   - Style `.inventory-search-popover` as an absolute dropdown beneath the input.
   - Structure the controls bar (`.inv-v2-controls-bar`) as a clean horizontal flex container hosting the search container on the left and filter pills on the right.

---

## 3. Caveats

- **No modifications to baseline V1 files**: `InventoryExperience.tsx` and `inventory.css` must remain untouched to satisfy Guardrail G1 and adversarial regression tests (`AdversarialM4A11yMotion.test.tsx`).
- **CSS Token Compliance**: `InventoryExperienceV2.css` will be a new file in `src/`. `scripts/check-design-system.mjs` enforces zero allowance for `font-size < 12px` and zero raw hex colors (`#...`). All colors must use CSS variables (`var(--v10-...)`, `var(--ifx-...)`) or `rgb(...)`/`rgba(...)`.
- **Screen Reader Parity**: The helper text `<span className="inventory-sr-only" id={hintId}>` must NOT be deleted from the JSX (it is bound to `aria-describedby={hintId}` on the combobox input). Styling `.inventory-sr-only` visually hides it while preserving 100% of its accessibility function.

---

## 4. Conclusion & Concrete Recommendation for Worker

The Worker should perform two focused actions:

### Action A: Create `src/features/inventory/InventoryExperienceV2.css`
The stylesheet must contain the following modular sections:

```css
/* ==========================================================================
   Inventory Experience V2 Stylesheet
   High-density top section: Header, Decision Metrics Rail, Search & Filters
   ========================================================================== */

/* 1. Screen-reader accessible utility */
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

/* 2. Page Container */
.inventory-experience-v2 {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  background: var(--v10-surface);
  min-height: 100%;
}

/* 3. Header & Scope Switcher */
.inv-v2-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.inv-v2-title-group h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--v10-ink-strong);
  line-height: 1.2;
}

.inv-v2-title-count {
  font-size: 12px;
  color: var(--v10-support);
  font-weight: 500;
}

.inv-v2-scope-toggle {
  display: inline-flex;
  background: var(--v10-surface-subtle);
  border: 1px solid var(--v10-border);
  border-radius: var(--radius-control, 6px);
  padding: 2px;
}

.inv-v2-scope-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  background: transparent;
  color: var(--v10-support);
  transition: background-color 0.12s ease, color 0.12s ease;
}

.inv-v2-scope-btn.is-active {
  background: var(--v10-surface);
  color: var(--v10-ink-strong);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

/* 4. Decision Metrics Rail (High-Density Horizontal 4-Column Grid) */
.inventory-decision-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
}

.inventory-metric {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  min-height: 54px;
  min-width: 0;
  background: var(--v10-surface);
  border: 1px solid var(--v10-border);
  border-radius: var(--radius-card, 8px);
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
  text-align: left;
}

.inventory-metric--button {
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.inventory-metric--button:hover {
  background: var(--v10-surface-subtle);
  border-color: var(--v10-blue);
}

.inventory-metric--button.is-active {
  background: var(--v10-surface-active);
  border-color: var(--v10-blue);
}

.inventory-metric__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: var(--ifx-radius-xs, 4px);
}

.inventory-tone--blue {
  color: var(--v10-blue);
  background: var(--v10-surface-active);
  border: 1px solid color-mix(in srgb, var(--v10-blue) 22%, transparent);
}

.inventory-tone--orange {
  color: var(--ifx-warning);
  background: var(--ifx-warning-surface);
  border: 1px solid color-mix(in srgb, var(--ifx-warning) 22%, transparent);
}

.inventory-tone--violet {
  color: var(--ifx-hold);
  background: var(--ifx-hold-surface);
  border: 1px solid color-mix(in srgb, var(--ifx-hold) 22%, transparent);
}

.inventory-tone--red {
  color: var(--ifx-danger);
  background: var(--ifx-danger-surface);
  border: 1px solid color-mix(in srgb, var(--ifx-danger) 22%, transparent);
}

.inventory-metric__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.inventory-metric__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--v10-support);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inventory-metric__value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--v10-ink-strong);
  font-variant-numeric: tabular-nums;
}

.inventory-metric__chevron {
  margin-left: auto;
  color: var(--v10-support);
  flex-shrink: 0;
}

/* 5. Controls Bar (Search + Quick View Filter Pills) */
.inv-v2-controls-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.inv-v2-search-wrapper {
  flex: 1 1 320px;
  max-width: 440px;
  position: relative;
}

.inventory-predictive-search {
  position: relative;
  width: 100%;
}

.inventory-primary-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--v10-border);
  border-radius: var(--radius-control, 6px);
  background: var(--v10-surface);
  color: var(--v10-support);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.inventory-primary-search:focus-within {
  border-color: var(--v10-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--v10-blue) 18%, transparent);
}

.inventory-primary-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--v10-ink-strong);
  font-size: 13px;
  font-family: inherit;
  padding: 0;
}

.inventory-primary-search input::placeholder {
  color: var(--v10-support);
}

.inventory-primary-search button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--v10-support);
  cursor: pointer;
  flex-shrink: 0;
}

.inventory-primary-search button:hover {
  background: var(--v10-surface-subtle);
  color: var(--v10-ink);
}

/* 6. Search Popover Dropdown */
.inventory-search-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--v10-surface);
  border: 1px solid var(--v10-border);
  border-radius: var(--radius-card, 8px);
  box-shadow: 0 10px 25px -5px rgb(0 0 0 / 14%), 0 8px 10px -6px rgb(0 0 0 / 8%);
  overflow: hidden;
}

.inventory-search-popover__heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--v10-surface-subtle);
  border-bottom: 1px solid var(--v10-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--v10-support);
}

.inventory-search-popover__heading > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.inventory-search-popover ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
}

.inventory-search-popover li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 20px;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--v10-border-soft);
  cursor: pointer;
  font-size: 13px;
}

.inventory-search-popover li:last-child {
  border-bottom: none;
}

.inventory-search-popover li:hover,
.inventory-search-popover li.is-active {
  background: var(--v10-surface-active);
}

.inventory-search-result__vehicle {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.inventory-search-result__vehicle strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--v10-ink-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inventory-search-result__vehicle small {
  font-size: 12px;
  color: var(--v10-support);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inventory-search-result__numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.inventory-search-result__numbers strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--v10-ink-strong);
}

.inventory-search-result__numbers small {
  font-size: 12px;
  color: var(--v10-support);
}

.inventory-search-result__why {
  grid-column: 1 / -1;
  font-size: 12px;
  font-weight: 600;
  color: var(--v10-blue);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inventory-search-popover li.inventory-search-recent {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inventory-search-recent-label {
  flex: 1;
  font-size: 12px;
  color: var(--v10-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inventory-search-popover__empty,
.inventory-search-popover__footer {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--v10-support);
  margin: 0;
}

.inventory-search-popover__footer {
  border-top: 1px solid var(--v10-border);
  background: var(--v10-surface-subtle);
}

/* 7. Quick View Filter Pills */
.inv-v2-pills-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.inv-v2-pill-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: var(--ifx-radius-full, 9999px);
  border: 1px solid var(--v10-border);
  background: var(--v10-surface);
  color: var(--v10-ink);
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  white-space: nowrap;
}

.inv-v2-pill-btn.is-active {
  border-color: var(--v10-blue);
  background: var(--v10-surface-active);
  color: var(--v10-blue);
}

/* Responsive adjustments */
@media (max-width: 900px) {
  .inventory-decision-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .inventory-decision-rail {
    grid-template-columns: 1fr;
  }
}
```

### Action B: Update `src/features/inventory/InventoryExperienceV2.tsx`
1. Add import:
   ```tsx
   import "./InventoryExperienceV2.css";
   import "./InventoryTableV2.css";
   ```
2. Replace inline styles in `<header>` and controls bar with clean class names:
   ```tsx
   {/* Header & Scope Bar */}
   <header className="inv-v2-header">
     <div className="inv-v2-title-group">
       <h1>{activeScope === "group" ? "All Locations Inventory" : title}</h1>
       <span className="inv-v2-title-count">
         {scopedVehicles.length} {scopedVehicles.length === 1 ? "vehicle" : "vehicles"} available
       </span>
     </div>

     {/* Scope Switcher */}
     <div className="inv-v2-scope-toggle" role="group" aria-label="Inventory location scope">
       <button
         type="button"
         className={`inv-v2-scope-btn${activeScope === "home" ? " is-active" : ""}`}
         aria-pressed={activeScope === "home"}
         onClick={() => handleScopeChange("home")}
       >
         {homeStore.name} Lot
       </button>
       <button
         type="button"
         className={`inv-v2-scope-btn${activeScope === "group" ? " is-active" : ""}`}
         aria-pressed={activeScope === "group"}
         onClick={() => handleScopeChange("group")}
       >
         All Locations
       </button>
     </div>
   </header>

   {/* Decision Metrics Rail */}
   {metrics ? <InventoryDecisionRail metrics={metrics} /> : null}

   {/* Controls Bar: Predictive Search & Quick View Pills */}
   <div className="inv-v2-controls-bar">
     <div className="inv-v2-search-wrapper">
       <InventoryPredictiveSearch
         id="v2-inventory-search"
         vehicles={vehicles}
         value={query}
         onChange={setQuery}
         onSelectVehicle={handleSelectVehicle}
         persistenceKey={searchPersistenceKey}
         placeholder="Search make, model, stock #, VIN..."
       />
     </div>

     {/* Quick View Filter Pills */}
     <div className="inv-v2-pills-group" role="group" aria-label="Quick inventory filters">
       {(
         [
           ["all", "All Vehicles"],
           ["shortlisted", `♥ Interest (${shortlist.count})`],
           ["no-hold", "No Hold"],
           ["new", "New Today"],
           ["price", "Price Changed"],
         ] as const
       ).map(([val, label]) => {
         const active = quickView === val;
         return (
           <motion.button
             key={val}
             type="button"
             whileHover={{ scale: 1.03 }}
             whileTap={{ scale: 0.97 }}
             aria-pressed={active}
             onClick={() => setQuickView(val)}
             className={`inv-v2-pill-btn${active ? " is-active" : ""}`}
           >
             {label}
           </motion.button>
         );
       })}
     </div>
   </div>
   ```

---

## 5. Verification Method

To independently verify the diagnosis and solution:

1. **Design System & Token Verification**:
   ```bash
   node scripts/check-design-system.mjs
   ```
   *Expected outcome*: `Design-system guard passed. Legacy debt did not increase (0 sub-12px declarations; 0 raw colors in new V2 CSS).`

2. **Repository Safety Verification**:
   ```bash
   node scripts/check-repo-safety.mjs
   ```
   *Expected outcome*: `Repository safety check passed.`

3. **Automated Unit & Adversarial Tests**:
   ```bash
   npm run test
   ```
   *Expected outcome*: All 116 test files pass (1792+ tests pass, 0 regressions).

4. **Production Build Verification**:
   ```bash
   npm run build
   ```
   *Expected outcome*: 0 TypeScript errors, 0 Vite bundle errors, complete extension archive verified.

5. **Visual DOM Inspection**:
   Run `npm run dev:demo` and visit `http://127.0.0.1:4173/inventory`:
   - Inspect `.inventory-decision-rail`: Confirm it renders as a single 4-column horizontal grid.
   - Inspect `span.inventory-sr-only#v2-inventory-search-...`: Confirm it has `width: 1px; height: 1px; clip: rect(0,0,0,0)` and is visually invisible.
   - Inspect `.inv-v2-controls-bar`: Confirm search input and filter pills are on a single horizontal row with height ~38px.
