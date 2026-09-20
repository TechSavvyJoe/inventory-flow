## 2026-09-18T02:36:38Z
You are the V2 Layout and Table Worker.
Your working directory is: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/worker_v2_layout_1/

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

You MUST read the original user request before starting work:
/Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md
Also read the project documentation:
/Users/joegallant/Documents/GitHub/inventory-flow/PROJECT.md

Read the three Explorer handoffs:
1. /Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_top_section_1/handoff.md (Top section layout, metrics grid, search sr-only fix, filter pills)
2. /Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_table_align_1/handoff.md (Table column alignment, fixed table layout, colgroup, inner div preservation)
3. /Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_v2_system_1/handoff.md (Design system token rules, test suites, V1 safety)

Write Ownership:
You exclusively own:
- src/features/inventory/InventoryExperienceV2.tsx
- src/features/inventory/InventoryExperienceV2.css
- src/features/inventory/InventoryTableV2.tsx
- src/features/inventory/InventoryTableV2.css
You MUST NOT mutate any V1 baseline files (InventoryExperience.tsx, InventoryTable.tsx, InventoryPage.tsx, VehicleWorkspace.tsx, etc.) or src/main.tsx.

Implementation Requirements:
1. R1: Restore Top Section Layout in InventoryExperienceV2:
   - Create `src/features/inventory/InventoryExperienceV2.css` containing:
     - `.inventory-sr-only` accessible clipping (so the 163-char screen reader hint does not display as visible body copy).
     - `.inventory-decision-rail` as a horizontal 4-column grid with styled `.inventory-metric` cards and tones.
     - `.inventory-primary-search` styled with 38px height, flex row, icon, and transparent input.
     - `.inv-v2-controls-bar` with search on the left and quick-view filter pills on the right.
     - Search popover styles.
   - Update `src/features/inventory/InventoryExperienceV2.tsx` to import `InventoryExperienceV2.css` and use clean semantic class names instead of raw inline styles.
2. R2: Fix Table Column Alignment in InventoryTableV2:
   - In `InventoryTableV2.tsx`, add `<colgroup>` with column classes, and add `inventory-table-v2-td inventory-table-v2-td--${column.id}` classes to `<td>`.
   - Strictly maintain `display: flex` on inner `<div>` wrappers (`inv-v2-*-cell`) inside `<td>` elements (never on `<td>` itself).
   - In `InventoryTableV2.css`, configure `table-layout: fixed; min-width: 1080px; border-collapse: separate; border-spacing: 0;` with explicit percentage column widths (Vehicle 27%, Identifiers 14%, Pricing 12%, Location 13%, Status 14%, Actions 20%). Set `box-shadow: inset 0 -1px 0 var(--v10-border)` on sticky `<th>`.
3. Design System Rules:
   - ZERO font-size < 12px.
   - ZERO raw hex colors outside `tokens.css` (use CSS variables `var(--v10-*)`, `var(--ifx-*)`, etc.).

Verification:
Execute and document the results of:
1. `node scripts/check-design-system.mjs`
2. `node scripts/check-repo-safety.mjs`
3. `npx vitest run tests/unit/Milestone3PagesV2.test.tsx`
4. `npx vitest run tests/unit/AdversarialM4A11yMotion.test.tsx`
5. `npm run test:unit`
6. `npm run build`

Write your completion report to `/Users/joegallant/Documents/GitHub/inventory-flow/.agents/worker_v2_layout_1/handoff.md` and report back via send_message.
