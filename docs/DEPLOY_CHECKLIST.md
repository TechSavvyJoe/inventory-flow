# Deploy checklist — app Worker and integrations Worker

Use this before every production deploy of `inventory-ops-production` (app) and `inventory-flow-integrations` (integrations). Both Workers must ship from the **same commit**. The release wrapper deploys the app first and integrations second; this is sequential, not an atomic two-Worker operation. A partial failure requires explicit operator recovery. Background on the current deployed state, prior version IDs, and known gaps is in [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) — append to that log after every deploy covered by this checklist. Architecture context is in [Shared-data architecture](SHARED_DATA_ARCHITECTURE.md).

**Production deployment and migration-ledger backfill require Joe's explicit, release-specific authorization.** By default, agents prepare and test changes without changing production. An agent may execute these steps only when Joe authorizes the exact release in the current session and every gate in this checklist is satisfied, including the controlled-host backup and rollback requirements. That authorization expires with the named release; see [`AGENTS.md`](../AGENTS.md#git-collaboration).

Both `wrangler.jsonc` files configure the [`version_metadata`](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/) binding (`CF_VERSION_METADATA`). **Run `pnpm cloud:release` once to release both Workers.** `pnpm cloud:deploy` and `pnpm integrations:deploy` are aliases for the same paired command, not separate steps; one run releases both. The wrapper runs pnpm's own launcher without a shell (its JavaScript entry through Node, or the standalone executable directly; `.cmd`/`.ps1` shims are refused), runs both validation gates, verifies the existing D1 migration ledger with a read-only query, then deploys app followed by integrations with one source tag. Every deployment therefore carries its source commit on the Cloudflare dashboard and in `/api/health` / `/api/v1/data-health`'s `version` field.

**The default requires a clean checkout at `origin/main` after fetch.** `pnpm cloud:release --allow-branch` is the explicit hotfix override and uses `<sha>-branch`; `dist/build.json` and the local receipt also record whether the tree was dirty. Keep the checkout quiet throughout the run. The only supported option is `--allow-branch`: `--dry-run`, the old `app`/`integrations` positional targets, and `--allow-dirty` are rejected before any command runs. For offline validation use `pnpm check` and `pnpm cloud:validate`.

## Pre-deploy

- [ ] `pnpm check` passes on a quiet machine (repo-safety guard, design-system ratchet, full test suite, production build). Do not skip it for a "small" change — the September 16 deploy history shows small unmerged changes are exactly what leak to production by accident.
- [ ] CI is green **on the exact commit being deployed**, not just on an earlier pre-merge tip with byte-identical content claimed by inspection. If `main` has moved since CI last ran, re-run CI on the merged commit before deploying it.
- [ ] `git log` confirms the intended source commit. The paired command deploys both Workers from that one commit and rechecks the checkout before uploading either Worker.
- [ ] The authorized release operator has verified the actual schema and backfilled the migration ledger using the [controlled production procedure](CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md#d1-migration-ledger-backfill). The wrapper requires every exact filename currently in `cloudflare/migrations/` (today `0001` through `0012`) and refuses missing, duplicate, unexpected, or unreadable ledger entries. It performs only this read-only query; it never creates the ledger or applies migrations:
  ```sh
  wrangler d1 execute INVENTORY_DB --remote --config cloudflare/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY name" --json
  ```
  If that read fails, the wrapper runs one more read-only probe of `sqlite_master`: an absent `d1_migrations` table stops the release with `D1_MIGRATION_LEDGER_ABSENT`. When the table exists, a failed read stops it as `RELEASE_COMMAND_FAILED: read-only D1 ledger query` and an answer that is not a successful ledger listing stops it as `MIGRATION_LEDGER_UNVERIFIED`. Historical releases applied schema files outside Wrangler's ledger, so an empty or missing ledger blocks deployment even if the tables exist. Do not run generic `wrangler d1 migrations apply` / `pnpm cloud:d1:migrate` (`0003` includes non-idempotent column additions), and do not fill the ledger merely to make the gate pass. A recorded filename is not proof that its schema changes happened: a required future schema change remains an explicit, reviewed, release-authorized single-file operation with schema verification and an accurate ledger entry before dependent code is released.
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

- [ ] The authorized release operator releases both Workers with one invocation from the reviewed clean commit: `pnpm cloud:release`. The wrapper runs `pnpm check`, then `pnpm cloud:validate`, then the read-only D1 ledger check above; only after every gate passes does it deploy the app and then integrations with the same resolved commit tag. No schema or migration-ledger writes occur in this wrapper.
- [ ] Confirm the wrapper recorded both `version_id` values from the matching Wrangler deploy receipts and wrote them to [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) as a dated entry at the top of that log. Its local `test-results/release-*/release.json` and per-Worker JSONL receipts remain ignored. Commit the log entry and get it onto `main` (Joe pushes it, or merges it through a pull request) before the next release: the wrapper refuses a dirty tree and a HEAD that differs from `origin/main`.
- [ ] If the app deployment fails, integrations is not attempted. If a later command fails or its receipt cannot be verified, stop and inspect the receipt and current Worker status before retrying: the first Worker may already be deployed, and the failing Worker may also have changed. The wrapper neither retries nor rolls back automatically and never calls an unverified version `unknown` success. A Worker skipped because the checkout changed is recorded as `not-attempted`. Recovery is a rerun of the paired command after reading the receipt (redeploying the same commit uploads the same code again under a new version ID); an explicit rollback requires the same release-specific authorization and uses the pre-recorded version IDs. If both deploys succeeded but the documentation append failed, repair the log from the receipt instead of redeploying.
- [ ] Cross-check the recorded version IDs manually:
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

To roll back, use the version ID recorded in the pre-deploy step (or the correct one from `wrangler deployments list` if this deploy has already added a newer entry to the log):

```sh
wrangler rollback <version-id> --config cloudflare/wrangler.jsonc
wrangler rollback <version-id> --config cloudflare/integrations.wrangler.jsonc
```

Record the rollback in [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) the same way a forward deploy is recorded.
