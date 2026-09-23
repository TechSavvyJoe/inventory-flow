# Inventory Flow — AI contributor guide

Inventory Flow is a dealership inventory, hold-awareness, and vehicle-movement application. Keep the interface operational, calm, information-dense, and immediately usable by dealership staff on desktop and mobile.

## Start here

1. Read `README.md`, `DESIGN_SPEC.md`, and `docs/AI_COLLABORATION.md`.
2. Run `pnpm install --frozen-lockfile` and `pnpm check` before changing code.
3. Use `pnpm dev:demo`. The web app runs on `127.0.0.1:4173`; the API runs on `127.0.0.1:4174`.
4. Compare visual changes at 390x844, 1024x768, 1320x820, and 1440x900 — the one canonical viewport list; other documents link here (dated QA records are historical).

The demo is deterministic, synthetic, and repository-safe. Never make it conditionally read a developer's live `runtime/`, `data/`, `work/`, browser profile, or report folders.

A remote agent cannot truthfully verify live inventory, live DealerMail holds, cookies/authentication, production Cloudflare Access, real document links, or the local operational ledger. Its valid evidence is source, tests, the synthetic fixture, the build, and synthetic browser QA; any live-source or production claim needs separate authorized verification on the controlled host.

## Non-negotiable product rules

- Keep public listing status, DealerMail hold state, operational movement, CDK evidence, sale, delivery, and physical location separate. Never infer one from another.
- `No current DealerMail hold found` is not an availability promise.
- DealerMail, public inventory, CDK, AutoCheck, factory-equipment, and window-sticker sources are read-only evidence in this app.
- Never implement an undocumented DealerMail write route or automate a hold/comment/delete action without an approved integration and explicit authorization controls.
- Preserve role-based redaction of customer-sensitive hold reasons, comments, and alerts.
- Do not add production credentials, cookies, customer data, CRM snapshots, report workbooks, SQLite files, or runtime logs to Git.
- A private repository is a code-review boundary, not a data vault. Do not commit live VIN lists, hold screenshots, authenticated-page captures, or production API responses.
- Git does not synchronize the app-owned transfer ledger. Shared saved state requires the authenticated central service described in `docs/SHARED_DATA_ARCHITECTURE.md`.
- The integration API stays read-only with customer fields excluded; the panel may split into ES modules or share lib code but gets no framework and no write path; `localStorage`/`sessionStorage` hold UI preferences only.

## Code rules

- CSS: edit the stylesheet co-located with the component that renders the class; never create versioned-name files; delete what you supersede in the same change; no new `!important` or ID selector except reduced-motion/print (delete a blocking override in the same change); colors, sizes, weights, and radii only via tokens; only tokens, base, and shell are global.
- No V1/V2 or `-vN` forks of any component — edit in place.
- Query tests by role and accessible name; never `readFileSync` a `.css` or `.tsx` file.

## Product-rule tests

Never delete, loosen, or re-pin these without Joe's approval — agents may add cases; each file carries a `// PRODUCT-RULE TEST` header: `tests/unit/server-api.test.ts` (`it('serves current source data with full hold evidence for sales and redaction for transport-only roles')`, `it('keeps current DealerMail-only held VINs visible and in the safe Today hold-signal totals')`, and the searchText expectations in `it('shows unheld vehicle alerts and released history only in authorized evidence and search')`), `tests/unit/integration-read-service.test.ts` ("no observed hold distinct from availability"), `src/app/adapters.custody.test.ts`, `tests/unit/inventory-search-privacy.test.tsx`, `tests/unit/service-core-portability.test.ts`, `tests/unit/cloud-access-revocation.test.ts`, `tests/unit/repo-safety.test.ts`, `tests/unit/bootstrap-first-refresh.test.tsx` and `tests/unit/api-client-retry.test.ts` ('bootstrap revalidation') for the ETag/304 path, and the write-surface (M02) and role-matrix canary (M01) tests once they land. A pinned expectation that changes says why the old output was wrong in the commit; product-mandated strings (`No current DealerMail hold found`, `Hold status not verified`, redaction placeholders) stay pinned exactly.

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

- Run `pnpm check:repo-safety` then `pnpm check` before the first push and every pull request; `pnpm check` runs the repository safety gate, design-system ratchet, tests, and production build.
- Exercise inventory search, sorting, row actions, vehicle workspace tabs, dialog keyboard behavior, and transfer workflows.
- Inspect the actual browser at all four target viewports; do not claim a UI fix based only on source or unit tests.
- Report any production boundary that remains simulated, local-only, read-only, or unverified.

## Git collaboration

- Joe may push to `main` only after `pnpm check` passes; AI agents never push to `main` — they work on a branch and open a pull request.
- Keep commits scoped and submit a pull request with commands run and screenshots made from `pnpm dev:demo`.
- Do not use screenshots from the protected host unless they were deliberately redacted and separately approved for repository use.
- Never weaken `.gitignore` or `scripts/check-repo-safety.mjs` to make a failing commit pass.
