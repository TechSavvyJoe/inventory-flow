# Reviewed visual baselines

The visual gate compares 32 synthetic screens: eight states at 390×844,
1024×768, 1320×820 and 1440×900. Both generation and comparison run in
`mcr.microsoft.com/playwright:v1.62.1-noble`, using bundled Chromium and the
production build. The fixture clock, locale, timezone and image masks are fixed.
Local Mac screenshots are useful for inspection, but are not Linux references.

Only metadata is tracked in `tests/visual/baseline-pin.json`. The reference
images live in a private GitHub CI-baseline release asset. This is test data,
not an application release or deployment. Durable release storage avoids the
expiry of the short-lived candidate artifacts from Actions.

## Comparison

The visual job downloads the exact asset ID from the pin using its existing
`contents: read` token. `scripts/visual-baselines.mjs` verifies the complete
bundle's SHA-256, source commit/run and renderer, then checks every image's name,
hash, PNG header and viewport dimensions. All 32 expected files must be present;
extra, duplicate and invalid files fail the job before any reference is written.

Validated references are restored to `INVENTORY_VISUAL_BASELINE_DIR` under the
runner's temporary directory. They are outside Git and outside Playwright's
output directory, which is cleared at startup. Neither `.gitignore` nor the
repository safety rules permit screenshot commits as part of this mechanism.

Normal comparison explicitly uses `--update-snapshots=none`. It never selects a
latest artifact, generates missing references, or updates the pin. A missing or
changed asset fails with a restoration error. A visual difference fails the
existing comparison (`maxDiffPixels: 0`, `threshold: 0.05`).

## Deliberate update

1. Dispatch **Validate Inventory Flow** on the reviewed branch with
   `target=update-visual-baselines`. The manual job renders in the prescribed
   container and produces the `visual-baseline-candidate` Actions artifact.
2. Download the candidate outside the checkout. Inspect all 32 images for
   hierarchy, density, readable text, overflow, controls and disclosure state.
   Passing generation only means the images were produced; it is not a passed
   comparison or an approval of their appearance.
3. Publish the exact reviewed `visual-baselines.json` bundle as an asset of a
   uniquely named private CI-baseline prerelease. Keep it separate from product
   releases and do not mark it latest. Preserve the originating commit and run.
4. Update only the metadata pin with the exact asset ID, bundle digest,
   provenance and review timestamp. Submit that change through the normal PR
   review. Do not publish or repin automatically from CI.
5. Run a fresh ordinary visual job. Acceptance requires all 32 comparisons to
   pass without snapshot updates. Actual CI also verifies the read-only token
   can retrieve the private asset; a local owner-token download alone does not.

The JSON bundle carries encoded PNG bytes to avoid archive extraction and path
traversal. It belongs only in external artifact storage. Missing/deleted release
assets require restoring the exact reviewed bytes or deliberately reviewing a
new candidate; there is no automatic fallback.

Validate workflow edits with `actionlint .github/workflows/ci.yml` before
pushing. `pnpm check` does not validate GitHub's expression-context rules.
The temporary path is set at step runtime through `GITHUB_ENV`; the `runner`
context is unavailable in job-level `env` expressions.

Visual checks cover the synthetic fixture. They do not establish production
authentication, live inventory accuracy, physical-device behavior or employee
acceptance.

## September 25 CI repair

[Run 36164618583](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36164618583)
passed unit/build checks but failed two independent gates:

- The Records test completed two full desktop viewport flows, then exhausted
  its shared 45-second test budget during the third. Each canonical viewport
  now owns a separate test. All interactions, assertions and the 45-second
  timeout are preserved; the full local browser suite passed 44 tests with
  four intentional project/viewport skips.
- All 32 visual comparisons lacked expected PNGs. The original manual generator
  produced expiring Actions artifacts, while the comparison job never restored
  them. The external bundle and reviewed pin close that setup gap without
  admitting rasters to Git or relaxing screenshot comparisons.

The initial candidates came from the successful manual generation job in
[run 36166374783](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36166374783),
at `117a242b226328dc9156ab003c2d2de813e181d6`. The CI repair changes tests and
baseline handling; application rendering is unchanged from that source.
The PR's check results record the subsequent ordinary comparison separately.
