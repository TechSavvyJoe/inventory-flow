# Reviewer 2 Context: Functional, Table Semantics & Test Review

Target files:
- `src/features/inventory/InventoryExperienceV2.tsx`
- `src/features/inventory/InventoryExperienceV2.css`
- `src/features/inventory/InventoryTableV2.tsx`
- `src/features/inventory/InventoryTableV2.css`

Focus:
- Table DOM semantics: Verify `display: flex` is applied to inner `<div>` wrappers inside `<td>` and NOT to `<td>` itself.
- Verify sticky headers behavior and border collapse separation.
- Verify search functionality, shortlist actions, quick view filter switching.
- Run builds and tests (unit tests and E2E tests).
- Review code quality, potential regressions, and give APPROVE / REQUEST_CHANGES verdict.
