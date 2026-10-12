# Compact inventory and shared interface quality — October 12, 2026

## Scope

The inventory ledger opens in a compact view with price, identity, copyable Stock/VIN/Base MSRP/mileage, operational states, source qualifications and direct actions still visible. Each vehicle has a keyboard-accessible natural-height disclosure. Expand all / Collapse all remembers only the global presentation preference; per-VIN overrides reset with employee/store access context.

Shared controls and surfaces use stronger navy depth, local Inter typography, raised actions and recessed evidence bands without increasing touch-target padding. The toolbar distinguishes Saved lists from Saved only. Vehicle-workspace actions distinguish Hold evidence from the app-owned Inventory Flow hold.

This pass also preserves rename drafts during saved-list polling, resumes interrupted clear operations against their original vehicle set, preserves Service/Moves return context, and resets scroll on explicit navigation to a root page without discarding return navigation.

## Synthetic rendering evidence

These images were captured from the repository's isolated synthetic demo used by Playwright at `127.0.0.1:4473`, not an authenticated dealership host. They contain synthetic records and AI vehicle illustrations.

Every image below uses one output pixel per CSS pixel (`scale: 'css'`). A phone emulator's higher device-pixel ratio must not inflate the displayed evidence image. The application was also inspected in the user's actual in-app browser without a viewport override; that browser reported 120% page zoom at the time of inspection. Browser zoom was not changed by this pass.

| Viewport | Evidence | Observed result |
| --- | --- | --- |
| 390×844 | `inventory-compact-390.png` | Single-column reading order; full VIN, copy controls, service/hold signals and direct actions remain readable. |
| 1024×768 | `inventory-compact-1024.png` | Copy values stay on one line; toolbar wraps into functional rows without document overflow. |
| 1320×820 | `inventory-compact-1320.png` | Expand all remains with the toolbar controls; the third vehicle enters the viewport. |
| 1440×900 | `inventory-compact-1440.png` | Three complete ordinary compact vehicle groups fit, including their action strips. Rich warnings remain uncapped and may increase row height. |

Raster screenshots stay outside Git under the repository safety policy. Playwright writes these to `/tmp/inventory-flow-qa/e2e/inventory-expansion-*/`; the reviewed copies are retained in the Codex task's `product-quality-qa` artifact directory and linked in its handoff. The policy was not loosened to commit screenshots.

An independent GPT-6 Astra/high reviewer inspected all four renders and the state/accessibility changes with no confirmed P1/P2 blocker. This is a scoped review, not a claim that every visual preference or production integration is complete.

## Validation

- Final `pnpm check:repo-safety` and `pnpm check`, including the neutral-text contrast adjustment: **257 test files passed; 4,806 tests passed and 3 skipped**. Type, safety, design ratchet, production build and companion packaging passed. The companion archive verified 88 reviewed files. Existing build size warnings remain informational.
- Eight-spec Playwright suite: **78 passed, 4 intentionally skipped, 0 failed** in desktop and mobile contexts. The four skips prevent duplicate Records captures in the wrong viewport project. Command: `pnpm exec playwright test tests/e2e/inventory-expansion.spec.ts tests/e2e/ui-readability.spec.ts tests/e2e/operational-relevance.spec.ts tests/e2e/saved-vehicles.spec.ts tests/e2e/records-clarity.spec.ts tests/e2e/transfer-start.spec.ts tests/e2e/manual-inventory-controls.spec.ts tests/e2e/inventory-documents.spec.ts`.
- Browser coverage includes inventory search/sort/copy, independent/global disclosure and reload persistence, Enter/Space focus, inert closed regions, reduced motion, Records dialogs, saved-list popover positioning, workspace tabs, hold permissions and vehicle-move paths.
- The browser check caught secondary text at 4.48:1 on the darker canvas in Action center and Inventory updates. The neutral text token was darkened to `#4b6072`, providing 4.97:1 on that canvas. Contrast thresholds were retained.
- The new density test explicitly sorts by Vehicle through the real interface. Other workflow specs create synthetic moves; relying on default Last movement ordering had incorrectly treated the fourth vehicle as the third.

## Boundaries

No production deployment, D1 migration, live inventory ingestion, authenticated OEM/DealerMail action or customer communication was performed. Public listing, hold evidence, physical location, movement and service states remain independent. Ford/OASIS and other provider facts shown here are captured synthetic evidence; no FMCDealer sign-in was attempted. Changes are proposed through a branch and pull request, not merged to production.
