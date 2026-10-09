# Workflow clarity and integrated vehicle overview QA

Branch: `codex/workflow-clarity`, based on `c89cb89` and stacked on PR #73.
Evidence uses the deterministic synthetic demo. No production deployment,
source request, task, credential, migration or Access setting was changed.

## Behavior

- The vehicle overview uses a continuous vibrant blue masthead with an inline
  price and one consistent hierarchy of attached headings and bordered white
  data ledgers. The requested restrained fade is scoped to this workspace.
- History sits beside specifications on large desktop screens. Key equipment
  and original/base MSRP reference facts span the context width rather than
  wrapping in the narrow gallery column. Source labels and coverage estimates
  remain explicit. These MSRP values stay in internal vehicle views.
- The mobile reading order exposes identity, operational status, decisive
  actions and active section first. Long hold text remains in the accessible
  content while its header summary is visually bounded; service status wraps
  without being crowded out. Reference labels sit above values on mobile.
- Expanded record subsection titles and counts use a solid neutral background
  with contrasting blue/dark text, avoiding white text in a fading-white area.
- Account setup points to the next permitted action. Publication shows
  allowlisted aggregate counts and exact registered-store coverage. A reported
  zero remains zero; unknown or invalid counts remain unreported. Stored
  publication does not verify source sign-in, executor activation or availability.
- Service status, allowed actions and the current note appear before reference
  details. A saved write remains successful if the shared bootstrap refresh
  fails; the shared warning provides retry without resubmitting the write.
  A version conflict keeps the editor busy until the latest state is loaded.
- Issue actions reflect status and allowed actions, with a safe View fallback.
  URL action hints are allowlisted and do not submit changes or grant permission.
  Empty update filters have a direct reset action.
- Focus containment handles a focused dialog heading/container outside the
  normal tab sequence while retaining nested-dialog, Escape and return-focus
  behavior.

## Validation

The initial full check passed 239 test files: 3,716 tests passed, three existing
skips, zero failures, with type checking, repository safety, design guard,
production build and companion packaging. The final two-rule record contrast
correction passed the safety/design guards and production build, followed by
the focused browser suite: 34 passed and four expected project/viewport skips.
The subsequent full `pnpm check` on the exact final source also passed: 239 test
files, 3,716 tests passed, three existing skips, zero failures, followed by the
production build and companion archive verification. The existing large-chunk
build advisory remains. This QA document was written after code validation;
repository safety was rerun with the document included.

Validation ran in an isolated temporary Intel Mac checkout under heavy M1 load,
using the frozen lockfile, Node 24.16.0, pnpm 11.19.0 and temporary verified
PowerShell 7.6.6. All 836 source inputs matched by SHA-256; no operational data
or runtime directories were transferred. No time limit or assertion was relaxed.

The browser suite covered `platform-data`, `vehicle-issues`,
`operational-relevance` and `records-clarity` on desktop and mobile. It exercised
guided setup, responsive source inspection, issue report/work/review flows,
inventory context and expanded captured records. Unit regressions additionally
exercise successful service/issue saves followed by shared bootstrap failure
and recovery with a single write.

Actual synthetic Chrome QA covered 390x844, 1024x768, 1320x820 and 1440x900,
with expanded records, reference facts, setup and publication states. Final
captures were reviewed for readable headings/counts, status wrapping, bounded
content, visible actions and coherent desktop/mobile order.
All 16 final captures reported zero navigation errors, zero captured errors and
zero horizontal page overflow. The vehicle workspace outer scroll remained zero.

A bounded native-focus check focused a deep reference action, then traversed
lower content into footer actions with real Tab input. The outer workspace
remained at scrollTop 0, with mobile header/tabs/footer at y=0/96/795. Only the
content pane scrolled. An earlier capture using `scrollIntoView` had scrolled
the outer overflow-hidden frame; corrected captures scroll the content pane
only. No application frame change was indicated by the actual keyboard check.

An independent review caught the expanded-record contrast defect, verified its
source correction and reviewed the final evidence. Product-rule files are
unchanged. The layout test now checks history beside specifications and the
full-width equipment/reference order because the former narrow-gallery layout
caused avoidable wrapping and scrolling. The design ratchet was tightened from
449 to 447 legacy ID selectors in the focused stylesheet; new publication CSS
has zero debt.

Screenshots, source manifest and full/browser logs stay outside Git under
`/Users/joegallant/Downloads/InventoryFlow-Workflow-Clarity-2026-10-08/`.
The final focused stylesheet SHA-256 is
`cef83638984c1835a686088f6a8b17feca9b46f81ea335976cee7731c2e39154`.

## Boundary

This pass improves presentation and existing app-owned workflows. Provider
profiles/configuration remain distinct from working vendor integrations and
collectors. Synthetic tests do not establish live inventory accuracy, real
source authentication, tenant activation, production availability or employee
acceptance. No production merge or deployment is included.
