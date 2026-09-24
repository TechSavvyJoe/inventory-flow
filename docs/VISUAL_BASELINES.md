# Reproducible visual baselines

The visual job renders both the reviewed source and the candidate in the same
`mcr.microsoft.com/playwright:v1.62.1-noble` container using bundled Chromium.
`tests/visual/baseline-source.json` pins a full source commit, Playwright version,
and container image. It never follows a moving branch or the candidate HEAD.

`node scripts/prepare-visual-baselines.mjs` checks the runtime, fetches that exact
commit into a temporary detached worktree, installs its frozen lockfile, builds,
and captures the eight existing synthetic states at all four canonical viewports.
Only a complete set of 32 PNGs is copied into ignored
`test-results/visual-baselines/`. The temporary worktree is removed afterward.
The candidate then runs the ordinary screenshot comparisons. Missing images
fail; the zero-different-pixel budget and 0.05 threshold are unchanged.

The initial source is main commit `4cdf3b0`, whose application code is unchanged
by the reconciliation PR. The prior visual job failed because no baseline PNGs
had ever been committed or downloaded. This approach keeps raster artifacts out
of Git without weakening the repository safety gate or relying on expiring CI
artifacts as permanent expectations.

The downloaded main and initial PR CI captures were compared with Playwright's
existing comparator: all 32 pairs passed at zero counted pixels and threshold
0.05. Small raw-byte differences were within that existing comparison policy;
no threshold or pixel allowance was increased.

For an intentional visual change:

1. Run the existing `update-visual-baselines` workflow dispatch on the candidate
   branch to produce a **review-only** `visual-snapshots` artifact.
2. Review all affected states and viewports against the current expectations.
3. In a reviewed change, update the source pin to that candidate's full commit
   SHA. Keep the rendering runtime consistent; a Playwright/container upgrade
   requires its own reviewed pin update.
4. Run the normal visual gate. The dispatch never pushes, changes the source
   pin, or silently accepts a screenshot difference.

Local screenshots remain useful for inspection, but only the matching Linux
container provides the trusted pixel comparison. All captures use the isolated,
deterministic synthetic demo; no authenticated source or operational data is read.
