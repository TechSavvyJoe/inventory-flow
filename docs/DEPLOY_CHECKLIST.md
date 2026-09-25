# Deploy checklist — app Worker and integrations Worker

Use this before every production deploy of `inventory-ops-production` (app) and/or `inventory-flow-integrations` (integrations). Both Workers must ship from the **same commit**. The release wrapper deploys the app first and integrations second; this is sequential, not an atomic two-Worker operation. A partial failure requires explicit operator recovery. Background on the current deployed state, prior version IDs, and known gaps is in [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) — append to that log after every deploy covered by this checklist. Architecture context is in [Shared-data architecture](SHARED_DATA_ARCHITECTURE.md).

**Production deployment and migration-ledger backfill are Joe-only operations.** Agents may prepare and test changes locally; they must not execute these production steps.

Both `wrangler.jsonc` files now configure a [`version_metadata`](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/) binding (`CF_VERSION_METADATA`), and `pnpm cloud:release` (both Workers), `pnpm cloud:deploy` (app only), and `pnpm integrations:deploy` (integrations only) run `scripts/deploy-worker.mjs`, which resolves the git short SHA in node — not in the shell, because the deployment host is PowerShell — and passes it to `wrangler deploy --tag`. Every future deployment therefore carries its source commit on the Cloudflare dashboard and in `/api/health` / `/api/v1/data-health`'s `version` field — the "no version_metadata binding configured" gap noted in the deployment log for earlier releases no longer applies going forward.

**A deploy from a dirty working tree is refused.** The tag would name a commit the deployed bundle does not match, so commit or set aside your changes first. `node scripts/deploy-worker.mjs app --allow-dirty` overrides it and tags the version `<sha>-dirty`; use that only for a deliberate hotfix, and record in the deployment log what the tree actually contained.

## Pre-deploy

- [ ] `pnpm check` passes on a quiet machine (repo-safety guard, design-system ratchet, full test suite, production build). Do not skip it for a "small" change — the September 16 deploy history shows small unmerged changes are exactly what leak to production by accident.
- [ ] CI is green **on the exact commit being deployed**, not just on an earlier pre-merge tip with byte-identical content claimed by inspection. If `main` has moved since CI last ran, re-run CI on the merged commit before deploying it.
- [ ] `git log` confirms the app Worker and integrations Worker will be deployed from the same commit (same `git rev-parse HEAD` for both `pnpm cloud:deploy` and `pnpm integrations:deploy` runs).
- [ ] Joe has verified that the live schema and `d1_migrations` ledger match every SQL filename in `cloudflare/migrations/`. The wrapper uses the named `INVENTORY_DB` binding from `cloudflare/wrangler.jsonc` for read-only remote queries: first the ledger table's existence, then its applied migration names. Missing ledger, pending filenames, malformed responses, and command failures all stop deployment before either Worker is changed.
  ```sh
  pnpm exec wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'"
  pnpm exec wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --json --command "SELECT name FROM d1_migrations"
  ```
  Historical releases applied schema files outside Wrangler's ledger. An empty or missing ledger now blocks deployment even if tables exist. Joe must verify the actual schema and complete a separately reviewed ledger backfill; neither the wrapper nor an agent creates/backfills it. Do not run generic `wrangler d1 migrations apply` / `pnpm cloud:d1:migrate`: `0003` includes non-idempotent column additions. A required future schema change remains an explicit, reviewed, Joe-only single-file operation with schema verification and an accurate ledger entry before deployment. The read-only name check cannot prove schema contents; that verification remains the operator's responsibility.
- [ ] No known critical bugs in the release; changes reviewed.
- [ ] Rollback plan is written down **before** deploying, not improvised after: record the current (pre-deploy) version IDs for both Workers.
  ```sh
  wrangler deployments list --config cloudflare/wrangler.jsonc
  wrangler deployments list --config cloudflare/integrations.wrangler.jsonc
  ```
  As of September 19, 2026 the rollback targets are app `09ecac9e-21aa-4e0e-957e-196531c34798` and integrations `9d0ac26c-6dfd-46d9-a33a-4c69c9e74885` - confirm these are still current before relying on them; they go stale the moment another deploy happens. `wrangler rollback` takes the version ID as a **positional argument**, not a `--version-id` flag:
  ```sh
  wrangler rollback <version-id> --config cloudflare/wrangler.jsonc
  wrangler rollback <version-id> --config cloudflare/integrations.wrangler.jsonc
  ```
- [ ] `pnpm cloud:validate` passes. It is the offline release gate both runbooks require between build and deploy: it checks the Worker modules parse and applies every numbered migration to an in-memory SQLite database. It contacts nothing and is not covered by `pnpm check`.
- [ ] On-call: this is a single-owner project - the person deploying is the on-call. Confirm you have time to watch the 15-minute post-deploy window before starting.

## Deploy

- [ ] Joe runs `pnpm cloud:release` from the reviewed clean commit. The wrapper runs `pnpm check`, then `pnpm cloud:validate`, then the read-only remote D1 preflight above. Only after all gates pass does it deploy the app and then integrations with the same resolved commit tag. No schema or migration-ledger writes occur in this wrapper.
- [ ] If the app deployment fails, integrations is not attempted. If integrations fails after the app succeeds, stop and record the mixed version state. The wrapper does **not** automatically roll back the app or database. Joe chooses a reviewed integration retry or an explicit app rollback using the pre-recorded version IDs, then rechecks both health endpoints. Single-Worker commands remain available for deliberate recovery and run the same gates.
- [ ] Capture both new version IDs and append them, with source commit and timestamp, to [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md):
  ```sh
  wrangler deployments list --config cloudflare/wrangler.jsonc
  wrangler deployments list --config cloudflare/integrations.wrangler.jsonc
  ```
- [ ] Smoke test: `node scripts/verify-cloud-deployment.mjs readiness` (drives `/internal/readiness`, the publisher-authenticated deep readiness check - real D1/R2 read path, no browser claims).
- [ ] Monitor both Workers for 15 minutes: `wrangler tail --config cloudflare/wrangler.jsonc` and `wrangler tail --config cloudflare/integrations.wrangler.jsonc`. Watch for elevated error rates or latency.
- [ ] Verify key flows in the live app (see Post-deploy).

## Post-deploy

- [ ] Health endpoints report the version just deployed. Both are read-only and require existing authentication (employee Access for the app, an API/OAuth grant with `health.read` for integrations) - this is intentional; the version fields are never exposed on an anonymous route.
  - App: `GET /api/health` -> `version.versionId` matches the app Worker's new version ID from `wrangler deployments list`.
  - Integrations: `GET /api/v1/data-health` -> `version.versionId` matches the integrations Worker's new version ID.
  - A `version: null` here means the `version_metadata` binding isn't populated for that request (expected in local dev/tests) - investigate if it happens against the deployed Worker.
- [ ] Run `node scripts/verify-integration-deployment.mjs runtime/integration-credentials/<probe-file>.json --expected runtime/integration-expected-release.json` using a **temporary** probe grant created for this deploy. The script drives `dataHealth`, `iterateInventory`, `vehicle`, `changes` and `holdSummary`, so the grant needs all four read scopes — a narrower grant fails the run at the `changes-and-holds` stage rather than proving anything about the deploy. Keep the label free of shell substitution; it is typed on a PowerShell host.
  ```sh
  node scripts/manage-integration-client.mjs create --transport wrangler --confirm --owner-user-id joe-gallant --type api_token --label "Deploy verification" --scopes "inventory.read,health.read,changes.read,holds.aggregate.read" --stores "Howell,Fowlerville,Ford Detroit,Lincoln" --days 1 --secret-output runtime/integration-credentials/deploy-verify.json
  node scripts/verify-integration-deployment.mjs runtime/integration-credentials/deploy-verify.json --expected runtime/integration-expected-release.json
  node scripts/manage-integration-client.mjs revoke --transport wrangler --confirm --client-id <client-id-from-create-output>
  ```
  Use the independently generated expected metadata from the intended verified publication receipt: its bundle hash and public-inventory total/counts for all four stores. Do not substitute the employee app's combined inventory totals or derive expectations from the integration response being checked. The temporary grant above requires an authorized group-manager owner and all four stores to match that full-release projection.
  Require both top-level `verified: true` and `api.independentReconciliation.verified: true`. Separately confirm the returned `api.reportDate` matches the intended receipt and readiness result; the expected-metadata format checks hash/counts, not a date field. Omitting `--expected` permits a narrower connectivity check and does not satisfy this deployment gate.
  Revoke the probe grant immediately after verification, whether it passed or failed. Never leave a probe grant active past the deploy.
- [ ] Spot-check one sold-pending move end to end (mark sold-pending, confirm it drops off the return path, confirm it does not silently resurrect on the Inventory updates page).
- [ ] Spot-check the Inventory updates page for noise (no website-listing-state entries, no sold-pending items reappearing as updates).
- [ ] Confirm metrics are nominal (error rate, latency, D1/R2 request volume) for the monitored window.
- [ ] Update the deployment log ([Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md)) with what shipped, both version IDs, and verification results.
- [ ] Notify stakeholders if this deploy is user-visible; close related tickets.

## Rollback triggers

Roll back immediately if any of the following happen and don't resolve within a few minutes:

- 5xx error rate rises on either Worker (watch via `wrangler tail`).
- Cloudflare Access authentication failures spike on the app host (employee sign-in broken) or the integrations host (client grants failing to authenticate).
- `node scripts/verify-integration-deployment.mjs` fails any gate (unauthenticated-denial, REST reconciliation, or OAuth discovery/PKCE/dynamic-registration).
- A health endpoint's `version.versionId` does not match the version just deployed - the deploy did not take, or traffic is still routing to a stale version.
- A sold-pending or inventory-updates regression is confirmed live (see product rules in [`AGENTS.md`](../AGENTS.md): sold-pending, hold state, listing state, and physical location are separate facts and must never be inferred from one another).

To roll back, use the version ID recorded in the pre-deploy step (or the correct one from `wrangler deployments list` if this deploy has already appended a newer entry to the log):

```sh
wrangler rollback <version-id> --config cloudflare/wrangler.jsonc
wrangler rollback <version-id> --config cloudflare/integrations.wrangler.jsonc
```

Record the rollback in [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) the same way a forward deploy is recorded.
