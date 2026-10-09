# Integrated pages and vehicle composition — synthetic QA

The inventory phone screenshot exposed a composition defect: identity, valuation,
options, identifiers and operational evidence competed in one text block. This
change separates those fields and applies the same reading order across the app:
vehicle identity, operational state, next action, then labeled supporting facts.

The final visual pass follows Joe's approved reference direction: compact white
headers with blue category icons, aligned navy text, one blue/outlined action
family, and restrained light-blue selection surfaces. Source evidence remains
authoritative; the concept's invented service/location states were not copied.

## Scope

- Inventory desktop/tablet headers and phone rows: separate price/mileage/age,
  equipment and remaining count, full stock/VIN, original/base MSRP, labeled
  colors, source logos and direct actions. The saved-only filter shares the
  search row; it no longer adds a second utility row.
- Vehicle workspace: cohesive photo/specification/history columns, compact
  operational controls, mobile More disclosure, retained deep records/equipment.
- Overview: integrated scope/print controls, role-specific presentation, labeled
  saved-vehicle state before supporting configuration, and a phone identity that
  is not squeezed by its Open vehicle action. Metrics, list controls and actions
  use less height; price/mileage and the primary action share an aligned row.
- Action center, Updates, Service and Moves: task/state/actions precede supporting
  specifications in DOM reading order. Direct Action center entry owns its service-shortcut styles.
- Issues, employee administration and Software Admin: shared page and ledger
  hierarchy, focused work areas and component-owned styles. Source setup displays
  named readiness facts, clearly separates scheduling preferences from access or
  execution, labels the next planned slot, and uses a small checkbox in a full
  touch target. Review fields retain separate names and values.
- Extension: separate price/mileage/age fields, explicit exterior/interior labels,
  and full-width Stock/VIN rows at narrow widths. Source actions remain read-only.
- Vehicle workspace phone facts use named Mileage, Days listed, Engine/drive,
  Transmission/fuel, Exterior and Interior fields. Software Admin explains a
  suspended or setup account using its actual state; unmet requirements are
  labeled as requirements rather than presented as observed facts.

The shared supporting-fact renderer now uses visible labels. Ordinary UI tests
were updated for those labels and the scheduling-preference checkbox. Evidence,
privacy, availability wording, role permissions and API write contracts remain
unchanged. Existing product-rule tests and geometry bounds were not loosened.
An ordinary vehicle-workspace presentation test now queries the labeled mobile
specifications rather than its superseded paragraph layout, retaining all facts
and backup-hold assertions.

## Observed browser evidence

All evidence uses the deterministic synthetic demo. Installed Chrome through
Playwright supplied actual browser captures; no protected dealership captures
were added to Git. Canonical sizes are 390×844, 1024×768, 1320×820 and 1440×900;
320px was additionally checked for the reported narrow-screen defect.

- Inventory: with both All locations and the All quickview selected, the first
  phone record starts at y281px at 320/390. The fresh isolated H01 row without a
  recorded decision is 278.25px tall at both widths. A recorded decision has its
  own full-width row below hold/service, with a 45.984px target; it adds height
  only when that evidence exists. The strict Records browser checks retain their
  390px 280px/y300 limits, report navigation and focus-restoration assertions.
- Saved-list popup: opening it leaves document height/width and scroll position
  unchanged at all four canonical sizes; Escape restores its launcher focus.
- Root composition captures: named source readiness, setup review, role-specific
  Overview, direct Action center service shortcut and task/Updates order checked
  at all canonical sizes plus 320.
- Approved Overview direction: full stock/VIN remain visible at all five widths;
  the first saved-vehicle identity begins at y435px at 390 and y454px at 320.
  Common actions have 44px targets and 8px corners, a 2px keyboard-focus outline,
  and a 100ms one-pixel press response. Escape restores Customer sheet focus;
  reduced motion removes the press displacement.
- Service/Moves: state and primary workflow action precede supporting facts;
  route and current location remain separately labeled. The 320×720 check is an
  additional short-screen check, not a replacement for the canonical viewports.
- Extension: 24 synthetic captures at 320/390/460px; full Stock/VIN fit without
  clipping, valuation fields remain separate, and controls retain 44px targets.

Local evidence, outside Git:

- `/tmp/inventory-flow-pages-qa/composition/QA.md` and `report.json`
- `/tmp/inventory-flow-pages-qa/composition-root/report.json`
- `/tmp/inventory-flow-pages-qa/composition-root/interaction-report.json`
- `/tmp/inventory-flow-pages-qa/composition-root/attention-final-report.json`
- `/tmp/inventory-flow-pages-qa/group-b/`
- `/tmp/inventory-flow-pages-qa/group-c/`
- `/tmp/inventory-flow-pages-qa/vdp-refinement/`
- `/tmp/inventory-flow-pages-qa/extension-composition-refined/QA.md`
- `/tmp/inventory-flow-pages-qa/approved-direction/`
- `/tmp/inventory-flow-pages-qa/inventory-scope-header/`
- `/tmp/inventory-flow-pages-qa/decision-layout/report.json`
- `/tmp/inventory-flow-pages-qa/holds-moves-buttons/`
- `/Users/joegallant/Downloads/InventoryFlow-Integrated-Pages-2026-10-08/`

## Validation and boundaries

Exact candidate source validation passed 239 files and 3,718 tests, with three
existing skips, before the final independent-review corrections. A local Records
browser run had two timeouts and two empty-section failures. All six applicable
Records browser cases subsequently passed in the pinned Linux CI run for
4907cf2; that run separately caught the phone inventory-decision placement
regression. No timeout or geometry assertion was relaxed. Final candidate checks
and reviewed Linux references are recorded in the pull request.

This is a local synthetic UI change. Live source access, real vehicle data,
production Cloudflare Access, collection executors and deployment were not
verified or changed by this design pass. A configured source preference or queued
request is not a successful capture. Extension installation and physical iPhone
behavior require their own controlled-host acceptance.

Software Admin remains a control plane: source settings, scheduling preferences
and queued requests do not activate collection. Its executor reports disconnected
and has no claim/complete route. The separately configured capture/publication
pipeline is not controlled by these registry settings. Self-service dealer feed
activation therefore remains a functional SaaS launch gap, independent of this
interface review.
