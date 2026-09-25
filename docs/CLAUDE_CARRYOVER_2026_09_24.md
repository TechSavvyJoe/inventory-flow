# Completed Claude work carried into the current app

This review branch combines `origin/main` at `4cdf3b0`, the repository and
layout fixes through `39e5d74`, and the completed release-lane code through
`a061d30`. The original release branch remains available unchanged.

## What was already present

- PRs #22 and #24 contain the completed Phase 1/2 cleanup and the useful
  audit fixes from PR #23. The Phase 2 branch name does not establish that
  every move in the larger plan was implemented.
- The manager, review, integration and production-readiness branch content
  was already represented by PR #20's squash merge. See
  `BRANCH_RECONCILIATION_2026_09_24.md` for the tree comparison.
- The referenced Work PC task's named commits `eef9a29`, `bd89780`,
  `1bb9433`, `1d3ddb7`, `d8de0cc`, `484dbf4`, `8c642e7`, and `737d415`
  are ancestors of `4cdf3b0`. Its service history, OASIS, document fallback,
  and manifest-validation changes therefore do not need to be reapplied.

## Release-lane carryover

M14 contributes the release-command flow, readable Worker errors, private
immutable asset caching, removal of redundant repository serialization, and
real release-cache tests. Integration keeps main's current-release retry,
early method rejection, and Windows junction entry-point fixes.

Review found defects in the original M14 command and response handling.
The integrated version rejects unsupported CLI arguments before commands,
runs pnpm through Node on Windows, compares the migration ledger against
the actual SQL filenames, and verifies machine-readable deployment receipts.
It stops on incomplete deployment outcomes instead of reporting unknown
versions as successful. Worker logs use route templates without record IDs,
query values, or exception text. Case-insensitive `Headers.set` replaces
upstream cache directives rather than appending contradictory values.

## Work that remains separate

The `handoff/` documents are the preserved plan, not evidence of implementation.
M10-M13, M15-M18, and the Overview/data work remain pending except where a
later, specifically verified commit records completion. The historical
progress notes also record reverted stub work; those stubs are not restored.

Cloudflare deployment, D1 ledger backfill, and tunnel/domain changes remain
Joe-only operations. No production change or live-source collection is
performed by this carryover. The local preview uses synthetic demo records.

Claude Desktop's local metadata and transcript confirm the cleanup session
and its PRs; local handoff messages also identify the completed M14 branch.
Incidental sidebar references to another Claude session are not treated as
that session's full transcript. This is an inventory of verified source work,
not a claim that every cloud-hosted conversation was recovered locally.
