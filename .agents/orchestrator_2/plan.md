# Execution Plan: Inventory Experience & Table V2 Layout Fixes

## Objectives
1. **R1. Restore Top Section Layout**:
   - Fix styling in `InventoryExperienceV2.tsx` so metrics ("Public units", "Current holds", etc.), search input with helper text, and filter pills are in a clean, polished, horizontal, high-density layout.
   - Eliminate raw vertical stacking.
2. **R2. Fix Table Column Alignment**:
   - Align table headers and data columns in `InventoryTableV2.tsx` and `InventoryTableV2.css`.
   - Maintain the structural pattern where `display: flex` is applied to inner `<div>` wrappers inside `<td>` cells (never on `<td>` itself).
   - Ensure header cells visually match width and alignment of body cells.
3. **R3. Safe V2 Isolation**:
   - Strict isolation: Only touch V2 files (`InventoryExperienceV2.tsx`, `InventoryTableV2.tsx`, `InventoryTableV2.css`, and related V2 assets/tests).
   - Never mutate original V1 baseline files (`InventoryExperience.tsx`, `InventoryTable.tsx`, `InventoryPage.tsx`, `VehicleWorkspace.tsx`, etc.).
4. **Verification & Quality**:
   - Zero design token violations (no sub-12px fonts, no raw hex colors outside tokens.css).
   - `npm run build` passes with 0 errors.
   - `npm run test:unit` passes.

## Execution Phases (Iteration Loop 2B)
- [ ] **Phase 1: Multi-Angle Technical Exploration (3 Explorers)**
  - Explorer 1: Inspect `InventoryExperienceV2.tsx`, existing CSS/styles, metrics bar, search input, and filter pills layout.
  - Explorer 2: Inspect `InventoryTableV2.tsx` and `InventoryTableV2.css`, table headers vs body columns, inner cell div wrapper pattern, and alignment.
  - Explorer 3: Inspect design system constraints (`tokens.css`, `scripts/check-design-system.mjs`), unit tests (`tests/unit/`), and V1 baseline safety.
- [ ] **Phase 2: Implementation (Worker)**
  - Dispatch dedicated worker with synthesized explorer findings.
  - Apply layout fixes to `InventoryExperienceV2.tsx`, `InventoryTableV2.tsx`, and `InventoryTableV2.css`.
  - Worker runs builds (`npm run build`), unit tests (`npm run test:unit`), and design system checks (`node scripts/check-design-system.mjs`).
- [ ] **Phase 3: Review & Verification (2 Reviewers)**
  - Reviewer 1: Visual layout inspection, code quality, design token adherence, V1 baseline non-mutation.
  - Reviewer 2: Functional verification, responsiveness, search/filter interactions, test execution.
- [ ] **Phase 4: Adversarial Stress Testing (2 Challengers)**
  - Challenger 1: DOM structure & CSS audit, table grid integrity under dynamic data / text lengths, inner cell wrapper validation.
  - Challenger 2: Responsive viewport scaling, edge cases, rapid filtering, build & regression verification.
- [ ] **Phase 5: Forensic Integrity Audit (1 Auditor)**
  - Verify authenticity of implementation, absence of hardcoded bypasses/facades/cheats, check git status for V1 purity.
- [ ] **Phase 6: Gate & Final Report**
  - Synthesize verdicts in `GATE_STATUS.md`.
  - If all pass: Send final completion report to Sentinel.
