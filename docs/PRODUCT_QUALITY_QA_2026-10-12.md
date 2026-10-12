# Compact inventory and shared interface quality — October 12, 2026

## Scope

The inventory ledger opens in a compact view with price, identity, copyable Stock/VIN/Base MSRP/mileage, operational states, source qualifications and direct actions still visible. Each vehicle has a keyboard-accessible natural-height disclosure. Expand all / Collapse all remembers only the global presentation preference; per-VIN overrides reset with employee/store access context.

Shared controls and surfaces use solid product navy, local Inter typography, subtle button shadows and neutral evidence bands without increasing touch-target padding. The global header and sidebar share the same blue; the later October 12 direction supersedes the earlier gradient and bevel treatment. The toolbar distinguishes Saved lists from Saved only. Service has a bounded selector with concise visible labels and complete accessible names. Refine vehicles uses a compact responsive field grid and keeps Clear all and Show vehicles in its footer. Filters remains highlighted while open or active. Query results reuse the facet-filtered vehicle set instead of repeating the predicate scan. Vehicle-workspace actions distinguish Hold evidence from the app-owned Inventory Flow hold.

This pass also preserves rename drafts during saved-list polling, resumes interrupted clear operations against their original vehicle set, preserves Service/Moves return context, and resets scroll on explicit navigation to a root page without discarding return navigation.

## Synthetic rendering evidence

These images were captured from the repository's isolated synthetic demo used by Playwright at `127.0.0.1:4473`, not an authenticated dealership host. They contain synthetic records and AI vehicle illustrations.

Every image below uses one output pixel per CSS pixel (`scale: 'css'`). A phone emulator's higher device-pixel ratio must not inflate the displayed evidence image. The application was also inspected in the user's actual in-app browser without a viewport override; the final filter inspection reported 90% page zoom, following the user's own zoom change. Browser zoom was not changed by this pass.

| Viewport | Evidence | Observed result |
| --- | --- | --- |
| 390×844 | `inventory-compact-390.png` | Single-column reading order; full VIN, copy controls, service/hold signals and direct actions remain readable. |
| 1024×768 | `inventory-compact-1024.png` | Copy values stay on one line; toolbar wraps into functional rows without document overflow. |
| 1320×820 | `inventory-compact-1320.png` | Expand all remains with the toolbar controls; the third vehicle enters the viewport. |
| 1440×900 | `inventory-compact-1440.png` | Three complete ordinary compact vehicle groups fit, including their action strips. Rich warnings remain uncapped and may increase row height. |

Raster screenshots stay outside Git under the repository safety policy. Playwright writes these to `/tmp/inventory-flow-qa/e2e/inventory-expansion-*/`; the reviewed copies are retained in the Codex task's `solid-blue-qa` artifact directory and linked in its handoff. The policy was not loosened to commit screenshots.

An independent GPT-6 Astra/high reviewer inspected all four compact inventory renders, all four final filter renders, and the state/accessibility changes with no confirmed P1/P2 blocker. This is a scoped review, not a claim that every visual preference or production integration is complete.

## Validation before the solid-blue and filter refinement

- Final `pnpm check:repo-safety` and `pnpm check`, including the neutral-text contrast adjustment: **257 test files passed; 4,806 tests passed and 3 skipped**. Type, safety, design ratchet, production build and companion packaging passed. The companion archive verified 88 reviewed files. Existing build size warnings remain informational.
- Eight-spec Playwright suite: **78 passed, 4 intentionally skipped, 0 failed** in desktop and mobile contexts. The four skips prevent duplicate Records captures in the wrong viewport project. Command: `pnpm exec playwright test tests/e2e/inventory-expansion.spec.ts tests/e2e/ui-readability.spec.ts tests/e2e/operational-relevance.spec.ts tests/e2e/saved-vehicles.spec.ts tests/e2e/records-clarity.spec.ts tests/e2e/transfer-start.spec.ts tests/e2e/manual-inventory-controls.spec.ts tests/e2e/inventory-documents.spec.ts`.
- Browser coverage includes inventory search/sort/copy, independent/global disclosure and reload persistence, Enter/Space focus, inert closed regions, reduced motion, Records dialogs, saved-list popover positioning, workspace tabs, hold permissions and vehicle-move paths.
- The browser check caught secondary text at 4.48:1 on the darker canvas in Action center and Inventory updates. The neutral text token was darkened to `#4b6072`, providing 4.97:1 on that canvas. Contrast thresholds were retained.
- The new density test explicitly sorts by Vehicle through the real interface. Other workflow specs create synthetic moves; relying on default Last movement ordering had incorrectly treated the fourth vehicle as the third.

## Solid-blue and compact-filter refinement

- The full local check after the theme and filter-layout changes passed: 257 test files, 4,806 tests passed and 3 skipped; type, safety, design ratchet, build and companion archive checks passed. After concise option-label refinements, the 45 inventory component/privacy tests passed independently with one worker. A later full-suite rerun was stopped after broad timing failures while macOS reported load averages above 370; it is not recorded as a second clean full pass. Its separate outdated service-label assertion was corrected while adding exact accessible-name coverage. Fresh CI remains required for the final commit.
- Current browser coverage passed all 44 distinct cases: 36 route/header contrast, saved-list overlay and expansion checks, plus 8 compact-filter cases. The filter cases cover input target sizes, price filtering, result counts, closing and focus restoration at all four canonical viewports in desktop and mobile contexts. The new phone filter assertion initially used a desktop-only vehicle button name; querying the shared Records action fixed that test without changing product behavior.
- The first browser pass caught a mobile stacking regression: the new solid mobile heading surface trapped the Sort popup beneath row copy controls. Raising the toolbar stacking context above the ledger fixed pointer access; app dialogs remain above it.
- Focused Chromium/WebKit verification passed five cases with one intentional desktop skip. The 320px check caught a real layout issue: a separate age row and extra identifier padding pushed the first vehicle's actions beneath the navigation dock. Removing those narrow-only spacing overrides restored above-dock access without reducing type sizes, facts or 44px targets. Records opening, vehicle switching, closing, focus restoration and keyboard-sized/rotated layouts passed.
- Desktop Service and primary filter labels are checked at their bounded widths. Concise visible labels retain the complete accessible status description.
- At the user's actual wide desktop viewport, Refine vehicles measured about 171 CSS pixels high with seven primary fields in one row and integrated footer actions. The 1024px and 1320px layouts use two field rows. Phone fields remain 44px high in two columns.
- Screenshots use one output pixel per CSS pixel and include the surrounding interface. No browser zoom setting was changed by the agent.
- After the final narrow-phone correction, repository safety, the design-system ratchet, TypeScript, production build, companion archive verification and `git diff --check` passed. The accessible-name unit assertions use Testing Library's exact string matching.

## CI follow-up

The preceding PR head's ordinary browser suite passed 122 cases with four intentional skips. Its combined CI job then reached the 25-minute job limit during cross-browser acceptance. Three older acceptance cases referenced the pre-disclosure mobile source sections, four actions rather than five, or a CSS nowrap implementation detail. The updated contracts preserve reading order, complete facts, 44px actions, above-dock access, actual text bounds and Records-sheet focus behavior. Snapshot comparisons still use the earlier reviewed visual baseline; the deliberate redesign needs reviewed replacement baselines rather than relaxed thresholds.

## Boundaries

No production deployment, D1 migration, live inventory ingestion, authenticated OEM/DealerMail action or customer communication was performed. Public listing, hold evidence, physical location, movement and service states remain independent. Ford/OASIS and other provider facts shown here are captured synthetic evidence; no FMCDealer sign-in was attempted. Changes are proposed through a branch and pull request, not merged to production.
