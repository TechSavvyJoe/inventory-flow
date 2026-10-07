# Software Admin source and OEM workbench

Branch: `codex/oem-admin-workbench`, based on `108305e`.
Evidence uses the deterministic synthetic demo only. No dealership source,
credential, publisher, scheduled task or production setting was changed.

## Behavior

- Full-width account workspace with a compact dealership-group picker and
  optional group filters; structured dealership, employee, owner and audit ledgers.
- Source directory with combined search, dealership, provider, OEM and preference
  filters; selected-source configuration and activation requirements.
- Separate source, OEM coverage, schedule and pull-queue views. Counts and targets
  describe stored configuration, not source access or completed captures.
- OEM setup drafts preselect their dealership and manufacturer family. Changing
  the provider category preserves that family. New sources start paused.
- Configuration fields are grouped into identity, connection and schedule
  sections. Credential references remain names rather than secret values.
- Mobile/tablet source inspection replaces the directory. Keyboard activation
  moves focus into the inspector; Back restores the same directory row.

## Browser acceptance

Google Chrome inspected the actual `pnpm dev:demo` at `127.0.0.1:4173/platform`,
using 390x844, 1024x768, 1320x820 and 1440x900 viewports. Browser automation used
Playwright because the Browser plugin was unavailable.

All 42 captured states had zero page-width overflow, console errors and uncaught
page errors. The pages rendered their expected content without sign-in/error
overlays: Overview, Dealerships, People & access, Health & setup, Sources, OEM
coverage, Schedules, Pull queue, Software owners and Audit history. Mobile and
tablet source-directory states were also captured. All images were inspected
across the root and design review lanes.

Review fixes were verified in the actual browser:

- Enter opens a source and focuses its heading; Back returns focus to its row at
  390 and 1024 pixels. The inactive workspace is hidden rather than appended.
- Mobile OEM enabled/paused counts retain visible labels when column headers hide.
- Public website links have 44px hit areas at all four sizes.
- Audit header/data columns align at 1024, 1320 and 1440 pixels.

Synthetic screenshots are outside Git in
`/Users/joegallant/Downloads/InventoryFlow-Admin-Workbench-QA-2026-10-07/`, named
`inventory-admin-final-<section>-<width>.png`. Playwright attachments remain
outside Git as well. The source review has no remaining blockers.

Two additional screenshots, `oem-populated-1440.png` and
`oem-populated-390.png`, show a paused Ford / Lincoln collector registered through
the synthetic demo UI. The displayed counts are one configured, zero enabled
and one paused. No vendor was contacted.

## Validation environment

The M1's loaded test runs timed out in unrelated baseline suites. Their
assertions, timeouts and committed configuration were retained. A temporary
Intel Mac checkout uses the same base and source files; SHA-256 comparisons
verify matching inputs. Its dependency installation uses the frozen lockfile.
Temporary test tools and reports stay outside the repository.

The final Intel run used Node 24.16.0, pnpm 11.19.0 and a temporary PowerShell
7.6.6 runtime verified against Microsoft's published SHA-256. All 18 source,
test and existing-documentation files matched the M1's SHA-256 snapshot before
the run. This QA report was added afterward.

- `pnpm check`: passed, exit 0. All 230 test files passed: 3,538 tests passed,
  three existing skips, zero failures. Type checking, repository safety,
  design-system ratchet, production build and companion archive verification
  passed.
- `pnpm exec playwright test tests/e2e/platform-data.spec.ts`: eight passed,
  zero failures, covering desktop/mobile source setup, OEM scoping, queue
  cancellation, dialog keyboard containment and responsive focus restoration.
- Independent source review: no blockers or follow-ups. Independent design
  review accepted all admin sections after the hit-area and audit-alignment
  fixes listed above.

The final logs are saved beside the screenshots as `full-check.log` and
`platform-browser-tests.log`. They contain synthetic test evidence only.

## Operational boundary

This change adds administration workflows over the existing owner service. It
adds no backend route, migration, vendor adapter, authenticated source probe or
collector executor. The queue is attributed configuration intent. Enabling a
preference does not start collection, and the OEM guide does not establish
vehicle availability, warranty coverage or a working manufacturer integration.
No production release is part of this branch.
