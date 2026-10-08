# Software Admin guided source setup and workbench

Branch: `codex/oem-admin-workbench`, based on `108305e`, PR #72.
Evidence uses the deterministic synthetic demo only. No dealership source,
credential, publisher, scheduled task or production setting was changed.

## Behavior

- Contextual group navigation: Setup, Dealerships, Data connections,
  People & access and Publication. Owners and audit history remain global.
- Setup identifies the next account requirement and its action. Account
  readiness is distinct from source execution and publication readiness.
- A filtered source ledger and focused inspector replace nested setup views.
  Mobile and tablet inspection replaces the list; Back restores row focus.
  OEM View and cancelled-request Inspect move keyboard focus to the inspector
  at every width when their originating panel closes. Direct desktop ledger
  selection retains row focus.
- Opening an account or returning to the platform directory focuses the page
  heading. Global summary actions reset empty directory filters and select a
  registered account; an empty installation stays in the directory.
- Saving OEM/provider planning drafts focuses the resulting source inspector
  after the dialog closes. Coverage labels identify DealerMail specifically,
  rather than implying that other configured CRM providers supplied the counts.
- Source configuration is a three-step dialog: Source & scope, Connection,
  Schedule & review. Only final Save writes configuration. The fixed footer
  stays visible while its body scrolls, with keyboard containment and Escape.
- API and file endpoints require public HTTPS; credential fields accept
  reference names only. OEM, time and zone requirements validate before saving.
  New connections start paused. Retry identity and revision guards remain intact.
- Provider directory includes 55 official-source profiles covering franchise
  and independent CRM, DMS, websites, inventory feeds, history, enrichment and
  OEM data. Salesforce and DealerTeam are excluded. Search by name, segment,
  evidence or delivery method; Configure prefills the source draft.
- Stored publication coverage exposes allowlisted aggregate counters and exact
  registered-store totals. Unknown counts remain unreported. Tenant identity
  is rechecked around reads; raw metadata and vehicle/customer fields stay out.
- Captured totals and manufacturer source planning are separate. Configuration
  counts do not establish provider access, OEM capture, availability or warranty.
- Derived public/DealerMail membership is labeled App membership, with its
  delivery exclusion and availability, location and sale-status limits stated.
- Planner readiness retains its last tick and checked, queued, waiting and
  failed counters. Enabled without a tick is distinct from a reported heartbeat
  or failed batch, and executor connectivity is shown separately.
- Pull requests show attributed intent awaiting an executor. No vendor adapter,
  collector execution, schema migration or new route is added.

Research links and documented access boundaries are in
[AUTOMOTIVE_SOURCE_CATALOG.md](AUTOMOTIVE_SOURCE_CATALOG.md).

## Validation

The final `pnpm check` passed with exit 0: 235 test files, 3,583 tests passed,
three existing skips and zero failures. Type checking, repository safety,
design-system ratchet, production build and companion packaging passed.

The M1 was under heavy load, causing timeouts in unrelated existing tests;
those assertions, timeouts and configuration were retained. The full run used
an isolated temporary Intel Mac checkout with the frozen lockfile, Node
24.16.0, pnpm 11.19.0 and a temporary PowerShell 7.6.6 runtime verified against
Microsoft's SHA-256. All 822 source inputs matched the M1 by SHA-256. A first
Intel run caught one implicit-locale call in the new coverage view; pinning it
to en-US passed five focused checks, followed by the complete successful rerun.
The release review's account-navigation, planning-save focus and coverage-label
regressions were included in a third SHA-matched full run, which passed all
unit checks and the build. The derived-membership and planner-diagnostics review
fixes passed a further matching full run with four additional regression cases.
The documentation was updated afterward.

`pnpm exec playwright test tests/e2e/platform-data.spec.ts` passed all twelve
cases across desktop and mobile: guided setup, OEM scoping, queue cancellation,
contained dialog focus, Escape/restore, responsive inspection, independent
provider prefill and visible wizard actions.
Both desktop and native mobile cases verify focus after OEM and cancelled
request inspection; the unit regression also preserves direct desktop row focus.
The final browser suite also verifies account-row focus, planning-save focus,
and summary navigation after filters return no accounts. Its initial summary
test incorrectly expected Northside instead of Harbor, the first registered
account after an empty selection; correcting that fixture expectation retained
the focus and valid-account assertions. No application fix or timeout change
was needed for that failure.

Actual Chrome QA of `pnpm dev:demo` covered 390x844, 1024x768, 1320x820 and
1440x900. All four sizes had zero page overflow or uncaught page errors, and
visible wizard actions. The 56 captured states include directory, setup,
dealerships, people, publication, sources, stored coverage, OEM planning,
providers, all three wizard steps, owners and audit history. Representative
final states were visually inspected at desktop, tablet and mobile sizes.
The final review delta added 16 screenshots of source readiness, coverage and
a simulated failed planner batch at all four sizes, with no overflow, page
errors or console errors; the membership explanation wrapped readably.

Independent source/design, catalog/footer and final focus delta reviews
reported no blockers or follow-ups. No test contract or visual baseline was
weakened.

Screenshots and logs remain outside Git in
`/Users/joegallant/Downloads/InventoryFlow-Admin-Guided-Setup-2026-10-07/`:
`final-*.png`, `final-qa-results.json`, `validated-source-sha256.json` and
`intel-final-focus-pnpm-check.log` and `intel-final-platform-e2e.log`.
Earlier full-run and failed logs are retained separately.
The final release-delta checks are retained in
`/Users/joegallant/Downloads/InventoryFlow-Production-PR72-2026-10-07/` as
`final-pnpm-check.log`, `final-cloud-validate.log` and
`final-platform-e2e-corrected.log`; the initial browser failure is separate.
The latest review-fix receipts use `review-fixes-*.log` and
`pr72-review-fix-*.png` / `pr72-review-fix-results.json` in that same folder.

## Operational boundary

Provider profiles are planning references, not installed integrations. Saving
configuration does not grant vendor access, provision a deployment, activate
an executor or publish inventory. Stored aggregate coverage comes from an
existing tenant publication and does not prove current source access. No
production release is part of this pull request.
