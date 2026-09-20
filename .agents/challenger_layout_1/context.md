# Challenger 1 Context: Adversarial DOM & Table Grid Integrity Testing

Target:
- `src/features/inventory/InventoryTableV2.tsx`
- `src/features/inventory/InventoryTableV2.css`
- `src/features/inventory/InventoryExperienceV2.tsx`
- `src/features/inventory/InventoryExperienceV2.css`

Mission:
- Empirically verify table column alignment under extreme/adversarial conditions:
  - Empty vehicle lists (colSpan 6 vs column widths)
  - Long strings / extreme pricing values / long VINs / many action buttons
  - Responsive viewport sizes (390px, 768px, 1080px, 1440px)
  - Verify inner `<div>` wrapper pattern is intact and `<td>` is `display: table-cell`.
  - Confirm test results and provide an empirical PASS / FAIL verdict.
