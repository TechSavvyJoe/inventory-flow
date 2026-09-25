# Deploy checklist — app Worker and integrations Worker

Use this before every production deploy of `inventory-ops-production` (app) and/or `inventory-flow-integrations` (integrations). Both Workers must ship from the **same commit**; do not deploy one ahead of the other except for an intentional rollback. Background on the current deployed state, prior version IDs, and known gaps is in [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) — append to that log after every deploy covered by this checklist. Architecture context is in [Shared-data architecture](SHARED_DATA_ARCHITECTURE.md).

Both `wrangler.jsonc` files configure the [`version_metadata`](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/) binding (`CF_VERSION_METADATA`). **Run `pnpm cloud:deploy` once to release both Workers.** `pnpm integrations:deploy` is an alias for the same paired command, not a second step. The wrapper invokes pnpm's JavaScript entry through Node on Windows, runs both validation gates, verifies the existing D1 migration ledger, then deploys app followed by integrations with one source tag. Deployment remains Joe-only under `AGENTS.md`.

**The default requires a clean checkout at `origin/main` after fetch.** `pnpm cloud:deploy --allow-branch` is the explicit hotfix override and uses `<sha>-branch`; `dist/build.json` and the local receipt also record whether the tree was dirty. Keep the checkout quiet throughout the run. The only supported option is `--allow-branch`: `--dry-run`, the old `app`/`integrations` positional targets, and `--allow-dirty` are rejected before any command runs. For offline validation use `pnpm check` and `pnpm cloud:validate`.

## Pre-deploy

- [ ] `pnpm check` passes on a quiet machine (repo-safety guard, design-system ratchet, full test suite, production build). Do not skip it for a "small" change — the September 16 deploy history shows small unmerged changes are exactly what leak to production by accident.
- [ ] CI is green **on the exact commit being deployed**, not just on an earlier pre-merge tip with byte-identical content claimed by inspection. If `main` has moved since CI last ran, re-run CI on the merged commit before deploying it.
- [ ] `git log` confirms the intended source commit; the paired command rechecks the checkout before uploading either Worker.
- [ ] Joe has verified the actual schema and backfilled the migration ledger using the [owner-only procedure](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md#d1-migration-ledger-backfill). The wrapper requires every exact filename currently in `cloudflare/migrations/`, including `0010_integration_audit_operations.sql`, and refuses missing, duplicate, unexpected, or unreadable ledger entries. It performs only this read-only query; it never creates the ledger or applies migrations:
  ```sh
  wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY name" --json
  ```
  A recorded filename is not proof that its schema changes happened. Do not fill the ledger merely to make the gate pass, or replay historical migrations with a generic apply command. New migrations require separate owner execution and verification before recording them and releasing dependent code.
- [ ] No known critical bugs in the release; changes reviewed.
- [ ] Rollback plan is written down **before** deploying, not improvised after: record the current (pre-deploy) version IDs for both Workers.
  ```sh
  wrangler deployments status --json --config cloudflare/wrangler.jsonc
  wrangler deployments status --json --config cloudflare/integrations.wrangler.jsonc
  ```
  Record the currently serving **version IDs**, not deployment IDs or the first UUID in a history listing. History can be oldest-first. `wrangler rollback` takes the version ID as a **positional argument**, not a `--version-id` flag:
  ```sh
  wrangler rollback <version-id> --config cloudflare/wrangler.jsonc
  wrangler rollback <version-id> --config cloudflare/integrations.wrangler.jsonc
  ```
- [ ] `pnpm cloud:validate` passes. It is the offline release gate both runbooks require between build and deploy: it checks the Worker modules parse and applies every numbered migration to an in-memory SQLite database. It contacts nothing and is not covered by `pnpm check`.
- [ ] On-call: this is a single-owner project - the person deploying is the on-call. Confirm you have time to watch the 15-minute post-deploy window before starting.

## Deploy

- [ ] Release both Workers with one invocation: `pnpm cloud:deploy`.
- [ ] Confirm the wrapper recorded both `version_id` values from the matching Wrangler deploy receipts and appended them to [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md). Its local `test-results/release-*/release.json` and per-Worker JSONL receipts remain ignored.
- [ ] If a command fails or its receipt cannot be verified, stop and inspect the receipt and current Worker status before retrying. The first Worker may already be deployed; the failing Worker may also have changed. The wrapper neither retries nor rolls back automatically and never calls an unverified version `unknown` success. If both deploys succeeded but the documentation append failed, repair the log from the receipt instead of redeploying.
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
  node scripts/manage-integration-client.mjs create --transport wrangler --confirm --owner-user-id joe-gallant --type api_token --label "Deploy verification" --scopes "inventory.read,health.read,changes.read,holds.aggregate.read" --stores "Howell" --days 1 --secret-output runtime/integration-credentials/deploy-verify.json
  node scripts/verify-integration-deployment.mjs runtime/integration-credentials/deploy-verify.json
  node scripts/manage-integration-client.mjs revoke --transport wrangler --confirm --client-id <client-id-from-create-output>
  ```
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
