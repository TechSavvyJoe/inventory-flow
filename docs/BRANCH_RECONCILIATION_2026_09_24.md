# Branch reconciliation — September 24, 2026

Audited against `main` at `4cdf3b0875b134bebf85612037d065ccc19ee308`.
The apparent outstanding manager/review work is already included in main through
PR #20. Do not replay the old commits to resolve their ancestry differences.

## Evidence and disposition

| Original branch | Audited tip | Finding |
| --- | --- | --- |
| `codex/manager-workflow-polish` | `60b8d54` | All 12 commits are represented in the PR #20 release squash. No remaining unique behavior found. |
| `fix/codex-review-pr13` | `e29e062` | Its 12 manager commits, eight review fixes, and merge are represented in the same release. No remaining fix to port. |
| `integration/sep19-stack` | `1223cc8` | Ancestor of the production-readiness tip; its work was included in that release. Retire rather than merge/rebase. |
| `codex/production-readiness` | `5ded330` | Its entire tree exactly equals PR #20 squash `b8a9159`, already an ancestor of current main. No remaining content to salvage. |

[PR #20](https://github.com/TechSavvyJoe/inventory-flow/pull/20) was merged on
September 21. Both original local tips are ancestors of `5ded330`; its tree and
`b8a9159` have the same object ID, `36933a986ab6710277c0f99eafd5a98df1d5d68b`.
Commit counts from `main..branch` and `git cherry` alone cannot recognize this
squash equivalence.

The two local branches were aligned to the audited main commit only after
preserving their original tips under local recovery refs:

- `refs/archive/2026-09-24/manager-workflow-polish` → `60b8d54`
- `refs/archive/2026-09-24/codex-review-pr13` → `e29e062`

These recovery refs are local, contain the old history, and must not be pushed.
A recovery branch can be created with `git branch <recovery-name> <archive-ref>`.
The remote branches were inspected but not deleted or rewritten. The pending
`plan/phase-3-release-payload-pipeline` lane was not changed or merged.

## Current implementations to preserve

- Photo recovery remains in `InventoryTable.tsx`, `src/lib/vehicle-photos.ts`,
  and the public-photo-count fallback in `server/service-core.mjs`.
- The daily orchestrator, manifest bookkeeping, task registration, and
  Perplexity MCP bridge remain under `scripts/`, with their package commands.
- Manager move permissions, loaner redaction, and active-store counts remain
  in the current service, workflow, and release-validation modules.
- Review fixes retain currency-neutral reference amounts, qualified estimated
  in-service dates, safe return URLs, and populated source disclosures.
  Later copy changes are intentional; do not restore the obsolete suffixes.
- M06 (`644f304`) moved `inventory-navigation.ts` and its tests to `src/lib`
  and consolidated the V1/V2 route wrappers. Port any future logic into these
  current files.
- M05 (`8bb8c3c`) deleted unused `TransferStatusLanes.tsx` and
  `WorkflowVehicleResources.tsx`. M03 (`c47e4bc`) deleted the one-off
  `configure-mcp-managed-oauth.mjs`. Preserve those deletions.

## Historical data boundary

The known identifier exposure is not confined to the two stale remote branches.
Commits `5088fa8`, `d8c5d2f`, `5803f96`, `dc42248`, and `ff112fb` are reachable
from main and include historical workstation/account/device or vehicle
identifiers in publish scripts, the automation runbook, or an importer test.
No raw identifiers are reproduced here.

The later scrubs are reflected in the current trees. Targeted probes for those
original values found no tip matches on main or either stale remote branch;
this is not a complete sensitive-data audit. Other operational references remain
in deployment documentation and require a separate review.

Deleting the obsolete branches removes branch clutter; it does not purge main
history, PR refs, tags, forks, or other clones. A repository-wide history cleanup
needs a separate coordinated scope, recovery plan, and explicit authorization
before rewriting shared refs. Do not republish the original branch histories.

## Validation repair

The unchanged-main baseline ran 2,246 tests, with one failure in the employee
role-picker test. It awaited the presence of an already-rendered disabled
button, then clicked before the directory loaded. The test now waits for the
button to become enabled; its role restrictions and assertions are unchanged.
No application behavior, product-rule test, safety gate, or UI was changed.
