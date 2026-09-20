## 2026-09-17T04:41:41Z
You are the V1 Architecture Explorer (explorer_v1_architecture_1).
Working directory: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_v1_architecture_1
Authoritative requirements document: /Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md

Your mission is to map the technical architecture and routing of the Inventory Flow codebase:
1. Read /Users/joegallant/Documents/GitHub/inventory-flow/.agents/ORIGINAL_REQUEST.md.
2. Explore the project structure, entry points (main.tsx/App.tsx/routes), router configuration, demo/dev scripts (npm run dev:demo, server/API setup, mock data).
3. Investigate how views and components are routed, how state is managed (React context, hooks, stores), and how vehicle data flows from mock/server to views.
4. Specifically analyze how a clean V2 routing layer or mode toggle can be introduced without modifying, overwriting, or breaking any V1 baseline files (Guardrail G1).
5. Identify all shared utilities, types/interfaces, API clients, and mock data generators that V2 components will need to use.
6. Write your comprehensive analysis and architectural map to /Users/joegallant/Documents/GitHub/inventory-flow/.agents/explorer_v1_architecture_1/handoff.md.
7. When done, send a concise completion message back to the orchestrator.
