# Cross-browser readability and interaction acceptance

## Scope

The dedicated suite in `tests/e2e/cross-browser` uses fabricated data and its own
4273/4274 servers. It covers Chrome desktop, Playwright WebKit desktop, and
Playwright WebKit with an iPhone-sized viewport. This is browser-engine testing
on Windows, not a claim of physical Mac Safari or iPhone certification.

Run instructions and the six acceptance flows are in
`tests/e2e/cross-browser/README.md`. Screenshots, traces, and JSON font evidence
stay outside the application repository under
`../../work/qa/cross-browser-acceptance`.

## Reproduced defects and fixes

1. **Weak bold text in WebKit:** Inter Variable's computed weight was 700, yet
   its bold glyph raster contained almost the same ink as regular text. A
   40-pixel `MMMMM` canvas measurement gave alpha totals of 511,122 (regular)
   and 511,097 (bold). Self-hosted static Inter preserves the design and gives
   511,122 and 794,230 respectively. Chrome's corresponding static values are
   502,768 and 791,575. The regression requires bold ink to exceed regular by
   20%; CSS `font-weight` alone is deliberately insufficient evidence.
2. **Selected store label:** legacy text-color rules left dark text on the blue
   active scope button. Its label is now white and its count retains blue ink
   on white. The browser test requires at least 4.5:1 label contrast for both
   home-store and group selections.
3. **Focus after closing the VDP:** a Safari-style pointer click could leave
   focus on the previous control. Fallback restoration also selected an
   unfocusable table row. The fallback now selects the vehicle's visible
   button; tests close by both button and Escape and assert restored focus.
4. **Missing photos:** dark placeholder copy was painted on the dark photo
   stage. It now uses light ink with a readable 12-pixel minimum caption;
   browser checks require at least 4.5:1 contrast for both lines.
5. **Sidebar footer:** a shared light-surface support-text rule overrode the
   navy sidebar's light text. The footer now has its own light token and a
   desktop browser check requiring at least 4.5:1 contrast.
6. **Mobile price/mileage spacing:** a legacy 2-pixel gap made neighboring
   values touch visually. A scoped 10-pixel column / 4-pixel row gap preserves
   wrapping and readable sizes. A geometry regression checks real separation
   between price, mileage, and certification, not merely the CSS declaration.
7. **DealerMail handoff:** the rebuilt panel uses aligned stock/VIN rows, a
   single explicit open-and-copy button, and separate saved comment/alert views.
   Its own button styles avoid legacy white-on-white primary-button rules.
   Browser checks require 4.5:1 button contrast, aligned identifiers without
   overflow, and padding between the heading and border. The compact mobile
   summary no longer places a copy icon over mileage.

## Verification on September 9, 2026

- Final dedicated run: **18 passed**, no retries or skipped tests (3.5 minutes).
- Chrome desktop: six flows passed at 1440 × 900.
- WebKit desktop: six flows passed at 1440 × 900.
- WebKit mobile: six flows passed at 390 × 844, touch input and mobile viewport.
- Regular/bold font raster values above were measured in all three projects.
- Screenshots of inventory, VDP overview/equipment/hold, moves, and attention
  were visually inspected. No horizontal overflow or cropped VDP status fields
  were found in these fixtures; longer equipment lists remain scrollable.
- Dedicated config/test TypeScript check and the design-system guard passed.
- Following the scoped mobile-gap fix, its affected WebKit mobile inventory
  test passed independently (1/1, 21.2 seconds); screenshots are in
  `../../work/qa/mobile-valuation-spacing`. The prior 18-test evidence is
  preserved. No full browser rerun was needed for this spacing-only rule.
- The final application regression passed **433 tests across 51 files**. After
  the DealerMail redesign, the affected VDP flow also passed in Chrome desktop,
  WebKit desktop and WebKit mobile, with screenshots inspected for actual button
  visibility and identifier alignment.

Earlier runs exposed the defects above and desktop WebKit action/screenshot
timeouts while the host was under concurrent test load. The final isolated
single-worker run passed with the same timeout and contrast thresholds. Failed
traces were retained in `../../work/qa/cross-browser-contention-evidence` rather
than presented as successful runs. Two separate unit attempts could not start
their workers during that contention; the release owner runs the full unit
suite separately with constrained workers.

## Release boundaries

These checks do not exercise live customer data, identity-provider sign-in,
external DealerMail/vAuto/FMC actions, or destructive production workflows.
They must be combined with the repository's unit/build/security checks and
separate authorized production smoke tests. A passing suite is evidence for
these defined flows, not a guarantee that the application has no defects.
