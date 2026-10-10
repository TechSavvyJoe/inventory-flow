# Completion and release boundaries — October 10, 2026

This continues the conversation reconciliation and the PR76 panel/workflow release.
It describes code changes on `codex/completion-readiness`, based on
`5d50ee4e1279aa8392210f06489f381adac5090f`. It is not a production activation
receipt or a claim that every dealership integration has been commissioned.

## Repairs in this candidate

| Area | Result | Verification required before handoff |
| --- | --- | --- |
| Hosted collector | Compatible queued requests share one frozen, bounded cohort. Claims, retries, cancellation, publication fencing and reconciliation keep the same request membership. Canceling an expired retry cohort cannot strand the dealership queue. | Collector execution, publication, lifecycle and coalescing tests; independent adversarial review. |
| Publication recovery | Same-date pending follow-ups are reconciled before another capture; a missing receipt fails closed, and `--no-publish` cannot invoke a publisher. Document and integration follow-ups use the retained, receipt-bound release, and foreign uncertainty cannot be replaced by an older successful receipt. | Invoice, orchestrator and PowerShell publication tests, including failure/retry cases; independent review. |
| Sign-in and action permissions | Initial bootstrap uses the authenticated identity without an implicit preview selection. An explicitly scoped, post-authentication action denial keeps the workspace available; authentication loss and unknown denials still clear protected state. | Bootstrap, API/session, Node/Worker identity and revocation tests. |
| Legacy service evidence | Structurally valid stored evidence with bounded unsupported service narrative remains readable. The read projection drops the entire unsupported narrative, keeps validated mechanical fields and labels affected current evidence incomplete. Malformed structure and new imports retain their strict validator. | Provider evidence and role/integration privacy regressions. |
| Inventory and movement | Hold and movement filters remain independent; counts reflect the prospective result of each control. Completed direct arrival is labeled correctly, and overdue ownership identifies the store responsible. | Adapter, inventory interaction and transfer tests; rendered workflows. |
| Inventory row controls | Larger previews share the identity area with stock, VIN, mileage and source-backed base MSRP. Base MSRP and mileage copy as raw numbers. A stable Records, Request/Track, Save, Listing action area and explicit report destinations make the controls predictable on desktop and mobile. | Clipboard, authorization, source-destination and sort tests; canonical viewport and keyboard checks. |
| Visual consistency | Operational headers, tabs, buttons and links share the sidebar brand blue. Primary and secondary actions have defined borders, restrained elevation and a pressed state. Move-filter count badges have their own gap and cannot shrink into the label. | Contrast, canonical viewport inspection, one-, two- and three-digit count probes, reduced-motion checks and design-system guard. |
| Mobile reading order | Inventory puts its operational ledger and stable action grid ahead of supporting evidence. The VDP puts one shared photo block before statuses and actions in DOM order, and the service summary groups specifications and copyable identifiers in compact bordered fields. Overview, action and movement facts share visible cell boundaries. No operational evidence is clipped to force a row height. | Fresh phone and canonical viewport renders, full identifiers and copy targets, source/conflict cases and keyboard order. |
| Vehicle actions | The VDP shows permitted operational actions directly in a stable order, beneath a compact status summary. Mobile actions use two columns; no operational More disclosure is required. White data panels have tinted headers and defined separators. | Direct-action visibility, order and permission regressions; rendered keyboard, tablet and phone flows. |
| Source capture and monitoring | Offline OASIS input validates structure and VIN before persistence. Keeper probes try other bounded candidates after ambiguous failures. Early intraday receipts do not erase retained alerts or recovery timestamps. | Offline parser, keeper, read-only source contract and monitor tests. No live source access is needed. |
| Scanner | One lazy OCR worker serves successive live frames, with immediate owner cancellation, bounded idle release and safe replacement. Only versioned model data is cached. Tablet entry is available at 1024px. | Engine/live/dialog tests; packaged OCR cold/warm browser proof; canonical viewport inspection. |
| Take-home sheets | Detailed preview and native printing replace failed photos with surviving images or the labeled placeholder; a failed dealership logo falls back to text. PDF image failures remain explicitly labeled. | App and companion image-error regressions; customer-sheet browser flows. |
| Demo source links | Reserved synthetic vehicle identifiers cannot open the live Ford OEM portal. Raw fixture URLs retain the validated release contract, while browser-facing projections suppress fabricated external listing destinations. Captured sample facts remain labeled and viewable; genuine dealership integrations retain their own authorized links. | Synthetic fixture, document/workspace, inventory/transfer projection and resource-link regressions. |
| Repository/release guards | The design baseline cannot accept a new `!important` or ID selector. A supplied D1 migration ledger must contain every expected migration exactly once. | Design-ratchet and D1 verifier tests; repository safety and full checks. No migration is applied by these checks. |

## Acceptance procedure

Use a deterministic synthetic checkout with `pnpm install --frozen-lockfile`.
Run `pnpm check:repo-safety`, `pnpm check`, and `pnpm cloud:validate` on the
final source snapshot. Exercise inventory search/filter/sort, saved-list naming
and overlay behavior, VDP tabs and keyboard handling, service actions and
transfer workflows. Inspect the rendered product at 390×844, 1024×768,
1320×820 and 1440×900. Test receipts and synthetic screenshots are kept outside
Git; the pull request records their actual results, including any failures.

## Separate external acceptance

- Cloudflare Access, deployment, D1 migrations, publisher tasks and collector
  activation need the named-release checklist and controlled-host verification.
  The collector remains disabled until that commissioning is authorized.
- Revoked FMCDealer access stays excluded. Public, CRM, history, equipment and
  OEM sources remain read-only; provider permission and current credentials
  must be checked per dealership before a live pull.
- Physical camera performance, installed extension behavior, physical print,
  native PDF sharing, real photo CORS, two-employee saved state and current
  production authorization need their own acceptance evidence.
- OEM original stickers, reference-knowledge APIs/MCP, clean-clone Windows
  pipeline provisioning and later bulk/dispatch features are distinct proposed
  work. They must not be advertised as implemented integrations based on
  configuration screens or synthetic fixtures.

Historical reconciliation documents remain dated evidence. Their old finding
counts are not a current backlog count and are not silently rewritten as a
claim that all external setup or future features are complete.
