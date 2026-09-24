# Inventory layout review — 2026-09-24

The inventory header previously squeezed the page title and location controls
into the same narrow grid cell. Heavy filled tabs, repeated button shadows,
vertical table borders and nested panels gave almost every element equal
emphasis. On phones, two narrow report columns made the first vehicle difficult
to scan.

This change keeps the existing screens and interactions. The desktop header
places Inventory, search and location scope in distinct columns. Vehicle identity
facts span their table cell, keeping a VIN readable as one value. The vehicle
workspace has a white identity header, underline navigation and flat sections;
the movement action carries the primary blue emphasis. Phone report summaries
form one source-labeled column, with all captured facts retained. Operational
status, source caveats, redaction and action authorization are unchanged. The
selected workspace tab is revealed within its own scroll strip on direct entry,
section changes and resize; this does not scroll the page or content pane.

## Synthetic browser review

`pnpm dev:demo` served the isolated deterministic fixture. Chromium checks and
direct screenshot inspection covered 390x844, 1024x768, 1320x820 and 1440x900:

- Inventory search, location scope and price sorting.
- Opening the matching vehicle from a row; Overview, Equipment, Records,
  Holds & moves and Activity tabs.
- Dialog Tab/Shift+Tab containment, Escape and restored opener focus.
- Opening and cancelling a cross-store movement request.
- No horizontal page overflow, Vite overlay or browser console errors.

Twenty screenshots remain in ignored
`test-results/layout-qa/{viewport}-{inventory,workspace,request,filters,holds}.png`. They were
captured from the demo and contain synthetic records only. No screenshots or
operational artifacts are added to Git. The existing visual gate separately
captures and compares the production build in its pinned Linux container.

The changes edit existing component styles and tighten the design-system debt
baseline. They add no stylesheet forks, ID selectors, important overrides, source
writes or production deployment. Main and the Phase 3 lane remain untouched.

## Visual source pin

The visual source is the immutable layout commit
`e2e4f489ba405ce79ec9a65577166d43dc3464d8`. This is an intentional replacement of
the old boxed inventory/workspace layout, supported by the synthetic review
above and the review-only capture in GitHub run `36067636723`. The Playwright
version, container image, complete 32-state requirement and pixel comparison
thresholds remain unchanged.
