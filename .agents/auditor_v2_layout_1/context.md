# Auditor Context: Forensic Integrity Verification

Target:
- Audit changes made to `InventoryExperienceV2.tsx`, `InventoryExperienceV2.css`, `InventoryTableV2.tsx`, `InventoryTableV2.css`.
- Check git status and diff across the entire repository to ensure:
  - Strict V1 baseline purity (zero mutations to original V1 baseline files).
  - No dummy/facade implementations, no hardcoded test strings or mock bypasses.
  - Zero raw hex colors and zero sub-12px font sizes.
  - Genuine CSS and React implementation of the horizontal layout, inner div wrappers, and table column alignment.
- Issue binary verdict: CLEAN or INTEGRITY VIOLATION.
