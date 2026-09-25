# Inventory Flow plan — handoff (written 2026-09-23 19:30 EDT)

Repo: `/Users/joegallant/inventory-flow`. Rules: read `AGENTS.md` in the repo first; it is binding.
Full plan: `PLAN.md` in this folder. Per-move specs: `specs/*.json` (find the entry by `id`; honor its `amendments`, `depends_on`, `verification`; O-moves also have a section in `specs/OVERVIEW_SPEC.md`).

## Done (do not redo)
- Phase 1 (M01–M05, M08, M09 stage 0) + R1/R2: branch `plan/phase-1-safety-hygiene` (tip e636ca1).
- Phase 2 so far on `plan/phase-2-gates-css-ia`: M07 (0f09560 + 715ea08), M06 (644f304), M09 stage 1 (d4e559d partial + a Claude commit "M09: …" landing tonight). M09 has NOT been reviewed yet.

## Before you start
1. Do not work in `/Users/joegallant/inventory-flow` until `git log -1` there shows a commit starting "M09:" and `git status` is clean. A Claude run is finishing M09 there; it pauses right after.
2. Two ready worktrees (deps installed, based on 644f304, independent of M09): `~/inventory-flow-lanes/data` (branch `plan/overview-data`) and `~/inventory-flow-lanes/release` (branch `plan/phase-3-release-payload-pipeline`). These can start now.
3. Dev servers: never use ports 4173/4174 (a preview runs there). Give each worktree its own pair, e.g. data 4373/4374, release 4473/4474 (`INVENTORY_OPS_PORT=<api> pnpm dev:demo` style; see package.json).

## Remaining moves, by lane
| Lane | Where | Order |
|---|---|---|
| Data | `~/inventory-flow-lanes/data` | O1 → O2 → M16 |
| Release | `~/inventory-flow-lanes/release` | M14 → M15 → M18 |
| UI 1 | main repo, after M09 lands | M11 → M10 |
| UI 2 | new worktree from the M09 commit (branch e.g. `plan/phase-2-ia`) | M12 → M13 |
| Overview UI | after UI 1 + UI 2 + Data are merged into one branch `plan/overview` | O3 → O4 → O5, O6, O7 → O9 → O8 |
| Last | on the merged branch | merge Release lane, then M17 (docs), M19 (synthetic VINs) |

Per move: implement the spec entry fully → `pnpm check:repo-safety` then `pnpm check` green → check UI at 390x844, 1024x768, 1320x820, 1440x900 with `pnpm dev:demo` → commit `"<ID>: <title>"` with before/after numbers in the body. Skip only what is impossible from this Mac (production, Cloudflare, Windows host, account steps) and list it. Never push to `main`; never run wrangler/deploy; never touch `runtime/`, `work/`, `data/`.
Product-rule test re-pins named in the specs are pre-approved by Joe; any other change to a `// PRODUCT-RULE TEST` file needs Joe.

## Also queued
- M09 review (read `git diff 644f304 <M09 commit>` against the M09 entry in `specs/phase2-moves.json`).
- M07 leftovers: (a) `tests/visual/app.visual.spec.ts:28-43, :70, :78` — photo masks paint over live UI at 1024/1320; (b) `scripts/check-design-system.mjs:154-155` skips the first rule after a block-less at-rule (`@import` in `src/styles/tokens.css:1`).
- Merge `main` (737d415, work-PC commit) into the plan branches.
- Port only the unique fixes from branch `claude/trusting-feynman-27xhh8` (cloud session; the rest duplicates Phase 1): move due times as instants, clear recent searches, audit CHECK for newer MCP tools, directory-scoped admin lock, 405 for read-only writes, bounded event times, list every active move, Take-home sheet focus hook.
- Joe's manual steps are listed in `PLAN.md` ("Manual steps for Joe").

## Keep a log
Append one line per finished move to `~/inventory-flow-lanes/handoff/PROGRESS.md` (move, branch, commit, check green y/n, skipped items). Claude reads it on Friday so nothing is redone.

## Update 19:58 EDT — release lane moved to ChatGPT's GitHub connector
Joe is low on Codex/Work weekly usage. The release lane (M14, M15, M18) now runs through ChatGPT's Chat-tab GitHub connector on branch `plan/phase-3-release-payload-pipeline` (pushed to origin, tip 644f304), not the local `~/inventory-flow-lanes/release` worktree. **Do not use that local worktree for this lane while ChatGPT owns it** — its pushes would collide with local commits. If ChatGPT stalls or the connector doesn't work out, switch back to the local worktree, but pull first (`git pull origin plan/phase-3-release-payload-pipeline`) to pick up anything ChatGPT already pushed.
Main repo: M09 landed (90e9382, 63c67ab, 64af1e5 on `plan/phase-2-gates-css-ia`), review still pending before M10/M11 start.
