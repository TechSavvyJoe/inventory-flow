# Inventory Flow — AI contributor guide

Inventory Flow is a dealership inventory, hold-awareness, and vehicle-movement application. Keep the interface operational, calm, information-dense, and immediately usable by dealership staff on desktop and mobile.

## Start here

1. Read `README.md`, `DESIGN_SPEC.md`, and `docs/AI_COLLABORATION.md`.
2. Run `pnpm install --frozen-lockfile` and `pnpm check` before changing code.
3. Use `pnpm dev:demo` unless you are on the explicitly authorized dealership host. The web app runs on `127.0.0.1:4173`; the API runs on `127.0.0.1:4174`.
4. Compare visual changes at 390x844, 1024x768, 1320x820, and 1440x900.

The demo is deterministic, synthetic, and repository-safe. Never make it conditionally read a developer's live `runtime/`, `data/`, `work/`, browser profile, or report folders.

## Non-negotiable product rules

- Keep public listing status, DealerMail hold state, operational movement, CDK evidence, sale, delivery, and physical location separate. Never infer one from another.
- `No current DealerMail hold found` is not an availability promise.
- DealerMail, public inventory, CDK, AutoCheck, factory-equipment, and window-sticker sources are read-only evidence in this app.
- Never implement an undocumented DealerMail write route or automate a hold/comment/delete action without an approved integration and explicit authorization controls.
- Preserve role-based redaction of customer-sensitive hold reasons, comments, and alerts.
- Do not add production credentials, cookies, customer data, CRM snapshots, report workbooks, SQLite files, or runtime logs to Git.
- A private repository is a code-review boundary, not a data vault. Do not commit live VIN lists, hold screenshots, authenticated-page captures, or production API responses.
- Git does not synchronize the app-owned transfer ledger. Shared saved state requires the authenticated central service described in `docs/SHARED_DATA_ARCHITECTURE.md`.

## Interface standard

- Use flat white surfaces, navy text, hairline separators, and restrained Ford blue for selection and primary actions.
- Avoid gradients, glass effects, oversized pills, card nesting, decorative 3D, cartoonish controls, and excessive whitespace.
- Mobile screens must form a coherent single-column reading order. Do not place a desktop detail panel below a long mobile list.
- Minimum touch target: 44px. Main content text: approximately 15–16px. Metadata: approximately 12–13px.
- Vehicle details should expose identity, status, decisive actions, and the active content section within the first mobile viewport.
- Tables should show useful decision fields, keep headers legible, and use responsive row/detail patterns rather than uncontrolled horizontal overflow.
- Features are organized category ledgers, not a wall of copy buttons. Provide one deliberate copy-all action where useful.
- Every icon-only control needs an accessible name; dialogs must trap focus, close with Escape, restore focus, and lock background scrolling.

## Validation before handoff

- Run `pnpm check`; it includes the repository safety gate, tests, and production build.
- Exercise inventory search, sorting, row actions, vehicle workspace tabs, dialog keyboard behavior, and transfer workflows.
- Inspect the actual browser at all four target viewports; do not claim a UI fix based only on source or unit tests.
- Report any production boundary that remains simulated, local-only, read-only, or unverified.

## Git collaboration

- Work on a branch; do not push directly to `main`.
- Keep commits scoped and submit a pull request with commands run and screenshots made from `pnpm dev:demo`.
- Do not use screenshots from the protected host unless they were deliberately redacted and separately approved for repository use.
- Never weaken `.gitignore` or `scripts/check-repo-safety.mjs` to make a failing commit pass.
