# Release lane carried into the current app

This branch (`release/m14-paired-release`) starts from `origin/main` at
`e80782b` and merges the completed release-lane work (`a061d30`, plan move
M14) together with the review fixes that were first made on PR #27 at
`3c4f037`. It contains no layout or visual-baseline change; those parts of
PR #27 are re-derived separately on current `main`.

## What the branch adds

- One release command, `pnpm cloud:release` (`cloud:deploy` and
  `integrations:deploy` are aliases). It takes no target: the app Worker and
  the integrations Worker always deploy together from one commit. It refuses
  unsupported arguments before running anything, refuses a dirty tree or a
  HEAD that is not `origin/main` (`--allow-branch` tags the build
  `<sha>-branch`), runs `pnpm check` and `pnpm cloud:validate` through Node,
  refuses a checkout that changed during validation, writes and re-reads
  `dist/build.json`, verifies the D1 migration ledger with one read-only
  query against the exact filenames in `cloudflare/migrations/`, and records
  machine-readable version receipts. A failed step is named
  (`RELEASE_COMMAND_FAILED: <step>`); an absent ledger is reported as
  `D1_MIGRATION_LEDGER_ABSENT` after one further read-only probe.
- `pnpm cloud:d1:migrate` stays blocked; the generic apply path is never used.
- Readable Worker errors (`cloudflare/src/error-messages.mjs`) covering every
  code the Worker and access layer throw, pinned by a coverage test.
- Private immutable caching for hashed `/assets/*` files only. A single-page
  fallback document served under `/assets/` is answered 404 and never cached.
- Structured error logs with route templates only (no VIN, record ID, query
  value, or exception text); vehicle-issue routes included.
- Removal of the redundant per-row `payload_json`/`cdk_json` and source-row
  `metadata_json` strings in the release dataset. The `state.current_*_json`
  strings stay because service-core parses them.
- Real release-cache tests and the retired single-target wrapper's valid
  cases ported into `tests/unit/deploy-worker-runner.test.ts`.

## What was deliberately not carried

- Single-Worker deploy targets and `--allow-dirty`: a paired release from
  `origin/main` is the only supported path.
- PR #27's second visual-baseline system: `main`'s pinned-asset procedure
  stays the only one.
- The layout hunks (`e2e4f48`): re-derived on `main` with four-viewport QA.

## Boundaries

Cloudflare deployment, the D1 ledger backfill (including `0011` and `0012`
as single files), and the tunnel/custom-domain move remain Joe-only. Nothing
here changes production or reads a live source; the tests use the synthetic
fixture. M10-M13, M15-M18 and the Overview work remain pending.
