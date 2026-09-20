# BRIEFING — 2026-09-17T04:52:00Z

## Mission
Discover and document all explicit and implicit specifications, requirements, guardrails, and acceptance criteria for Inventory Flow V2 redesign.

## 🔒 My Identity
- Archetype: Specification Miner
- Roles: Specification Mining, Requirements Analysis, Quality Checklist Definition
- Working directory: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/spec_miner_survey_1
- Original parent: 733c9114-e55f-4ccc-9c6e-1f3aefd4368b
- Milestone: Requirements Survey & Spec Mining

## 🔒 Key Constraints
- Read-only on implementation code: Do NOT implement anything — only probe and document.
- Strict G1 preservation: Baseline V1 code must remain completely intact.
- Communication via send_message to caller (id: 733c9114-e55f-4ccc-9c6e-1f3aefd4368b, name: parent).
- Write handoff report to /Users/joegallant/Documents/GitHub/inventory-flow/.agents/spec_miner_survey_1/handoff.md.

## Current Parent
- Conversation ID: 733c9114-e55f-4ccc-9c6e-1f3aefd4368b
- Updated: 2026-09-17T04:50:40Z

## Task Summary
- **What to build**: Specification inventory, gap analysis, acceptance criteria checklist, and non-destructive routing strategy for V2 redesign.
- **Success criteria**: Comprehensive handoff report detailing features, non-functional requirements, guardrails, edge cases, testability, and routing design.
- **Interface contracts**: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md
- **Code layout**: Root project structure, Vite/React/TypeScript setup.

## Key Decisions Made
- Discovered G1 baseline regression in InventoryExperience.tsx; documented recommendation to revert line 21 and introduce InventoryExperienceV2.tsx to preserve existing tests.
- Discovered sandbox proxy 403 on external npm registry; recommended vendored/local package for framer-motion in node_modules/framer-motion.
- Identified non-destructive routing seam via src/app/routeModules.ts.
- Documented design-system check rules (no sub-12px, no raw hex outside tokens).

## Artifact Index
- /Users/joegallant/Documents/GitHub/inventory-flow/.agents/spec_miner_survey_1/handoff.md — Complete specification inventory and analysis report.
- /Users/joegallant/Documents/GitHub/inventory-flow/.agents/spec_miner_survey_1/progress.md — Liveness heartbeat.
- /Users/joegallant/Documents/GitHub/inventory-flow/.agents/spec_miner_survey_1/DISPATCH.md — Recorded communications.
