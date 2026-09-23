# Cross-browser acceptance

Run from the application directory:

```sh
pnpm exec playwright install chromium webkit firefox
pnpm exec playwright test --config playwright.cross-browser.config.ts
```

The suite starts its own synthetic API on port 4274 and Vite on 4273. Both ports
must be free: it never reuses an existing server. Each browser context is new,
and source assertions require the eight fabricated `TESTDATA` vehicles. A
48-vehicle response fixture exercises pagination without writing to the ledger.
The main local demo or cloud application is not changed.

The config defines five projects: Chromium at 1440 × 900 (`chromium-desktop`),
Chromium with a Pixel 7 emulation (`chromium-android`), Firefox at 1440 × 900
(`firefox-desktop`), WebKit at 1440 × 900 (`webkit-desktop`), and WebKit with a
390 × 844 mobile viewport and touch input (`webkit-mobile`). A local run of the
command above executes all five. In CI, the per-push/PR `e2e` job
(`.github/workflows/ci.yml`) runs only `chromium-desktop` and `webkit-mobile`
to keep per-push time down; `cross-browser-nightly` (schedule or
`workflow_dispatch`) runs the remaining three — `chromium-android`,
`webkit-desktop`, and `firefox-desktop` — once a night, or on demand.
WebKit and Firefox here are real browser engines, but this is **not** a
physical Mac Safari, Android, or iPhone test. Real device acceptance,
production sign-in, and authorized live-data checks remain separate release
requirements.

The suite covers:

- Inventory home/group scope, selected-label contrast, literal search,
  multi-level sorting, persisted row count, pagination, and expanding results.
- VDP overview, hold/backup information, movement, expanded equipment, no
  horizontal overflow, and focus restored after both Close and Escape.
- Move search/status/sort controls and the request-vehicle entry point.
- Attention search/scope, detail actions, changes navigation, and mobile focus.
- No browser errors, console warnings/errors, or development error overlay.
- Actual regular/bold font raster contrast. This catches a reproduced Windows
  WebKit variable-font weight failure that computed CSS alone did not reveal.

Screenshots and font-raster evidence are written outside the repository to
`../../work/qa/cross-browser-acceptance`. A run replaces that directory's previous
test output. Failed tests retain traces. No retries or skipped failures are used.

The interface uses self-hosted static Inter weights 400–900. Separate weight
files preserve the Inter design while making real bold glyphs consistent across
the tested engines; no external font service or credential is required.
