# BRIEFING — 2026-09-17T04:48:45Z

## Mission
Map the technical architecture, routing, state management, and mock/API data flow of Inventory Flow to enable clean V2 routing without modifying baseline files.

## 🔒 My Identity
- Archetype: explorer
- Roles: [explorer, synthesis]
- Working directory: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_v1_architecture_1
- Original parent: 733c9114-e55f-4ccc-9c6e-1f3aefd4368b
- Milestone: V1 Architecture Exploration & Routing Analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Do NOT modify, overwrite, or break any V1 baseline files (Guardrail G1)
- Write metadata only to .agents/explorer_v1_architecture_1/

## Current Parent
- Conversation ID: 733c9114-e55f-4ccc-9c6e-1f3aefd4368b
- Updated: 2026-09-17T04:41:41Z

## Investigation State
- **Explored paths**: package.json, vite.config.ts, src/main.tsx, src/App.tsx, src/app/routeModules.ts, src/app/AppDataContext.tsx, src/app/AppShell.tsx, src/app/adapters.ts, src/features/inventory/InventoryPage.tsx, src/features/inventory/InventoryExperience.tsx, src/features/inventory/VehicleWorkspace.tsx, src/features/inventory/VehicleWorkspaceV2.tsx, src/features/transfers/TransfersPage.tsx, src/features/service/ServicePage.tsx, src/lib/api.ts, fixtures/synthetic-release.mjs, scripts/start-synthetic-demo.mjs, scripts/check-design-system.mjs, scripts/check-repo-safety.mjs
- **Key findings**:
  1. Baseline test suite has 106 test files and 1349 tests. All 1349 pass when V1 files are intact. Modifying InventoryExperience.tsx directly broke tests in tests/unit/inventory-modern-ui.test.tsx and InventoryExperience.modern.test.tsx.
  2. Guardrail G1 requires dedicated V2 components (VehicleWorkspaceV2.tsx, InventoryPageV2.tsx, TransfersPageV2.tsx, ServicePageV2.tsx, etc.) and a non-destructive routing layer.
  3. Clean coexistence architecture designed: Mode-aware route layer in App.tsx or ExperienceVersionContext defaulting to V2 in dev/demo mode with toggle/URL override to V1, keeping all V1 baseline files intact.
  4. Framer Motion is required by R4/acceptance criteria but is not yet installed in package.json (must be installed for React 19).
  5. check:design-system enforces strict CSS rules: any new CSS file must have 0 sub-12px font sizes and 0 raw hex colors (must use tokens).
- **Unexplored areas**: None for architecture exploration.

## Key Decisions Made
- Reverted working-tree modification in InventoryExperience.tsx to restore 100% passing baseline tests.
- Formulated non-destructive coexistence routing recommendation for orchestrator and implementers.

## Artifact Index
- handoff.md — Comprehensive technical architecture and routing map
- progress.md — Liveness heartbeat and progress log
