# Deploy checklist — app Worker and integrations Worker

Use this before every production deploy of `inventory-ops-production` (app) and/or `inventory-flow-integrations` (integrations). Both Workers must ship from the **same commit**; do not deploy one ahead of the other except for an intentional rollback. Background on the current deployed state, prior version IDs, and known gaps is in [Shared-data deployment log](SHARED_DATA_DEPLOYMENT.md) — append to that log after every deploy covered by this checklist. Architecture context is in [Shared-data architecture](SHARED_DATA_ARCHITECTURE.md).

Both `wrangler.jsonc` files now configure a [`version_metadata`](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/) binding (`CF_VERSION_METADATA`), and `pnpm cloud:deploy` / `pnpm integrations:deploy` run `scripts/deploy-worker.mjs`, which resolves the git short SHA in node — not in the shell, because the deployment host is PowerShell — and passes it to `wrangler deploy --tag`. Every future deployment therefore carries its source commit on the Cloudflare dashboard and in `/api/health` / `/api/v1/data-health`'s `version` field — the "no version_metadata binding configured" gap noted in the deployment log for earlier releases no longer applies going forward.

**A deploy from a dirty working tree is refused.** The tag would name a commit the deployed bundle does not match, so commit or set aside your changes first. `node scripts/deploy-worker.mjs app --allow-dirty` overrides it and tags the version `<sha>-dirty`; use that only for a deliberate hotfix, and record in the deployment log what the tree actually contained.

## Pre-deploy

- [ ] `pnpm check` passes on a quiet machine (repo-safety guard, design-system ratchet, full test suite, production build). Do not skip it for a "small" change — the September 16 deploy history shows small unmerged changes are exactly what leak to production by accident.
- [ ] CI is green **on the exact commit being deployed**, not just on an earlier pre-merge tip with byte-identical content claimed by inspection. If `main` has moved since CI last ran, re-run CI on the merged commit before deploying it.
- [ ] `git log` confirms the app Worker and integrations Worker will be deployed from the same commit (same `git rev-parse HEAD` for both `pnpm cloud:deploy` and `pnpm integrations:deploy` runs).
- [ ] Migrations `0001`-`0009` are already applied to the live D1 database as single files, each run individually (never via `wrangler d1 migrations apply` / `pnpm cloud:d1:migrate` - `d1_migrations` stays empty by design and an apply run fails loudly on `0003`'s bare `ALTER TABLE ADD COLUMN`). Verify the expected tables exist before trusting a migration is live:
  ```sh
  wrangler d1 execute inventory-ops-production --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --config cloudflare/wrangler.jsonc
  ```
  Release 1.2.1 requires `0009_membership_admin.sql` to already be applied. If a new migration ships with this deploy, apply it remotely as its own single file first and confirm it here before deploying Worker code that depends on it.
- [ ] No known critical bugs in the release; changes reviewed.
- [ ] Rollback plan is written down **before** deploying, not improvised after: record the current (pre-deploy) version IDs for both Workers.
  ```sh
  wrangler deployments list --config cloudflare/wrangler.jsonc
  wrangler deployments list --config cloudflare/integrations.wrangler.jsonc
  ```
  As of September 19, 2026 the rollback targets are the ones shown by `wrangler deployments list` - confirm these are still current before relying on them; they go stale the moment another deploy happens. `wrangler rollback` takes the version ID as a **positional argument**, not a `--version-id` flag:
  ```sh
  wrangler rollback <version-id> --config cloudflare/wrangler.jsonc
  wrangler rollback <version-id> --config cloudflare/integrations.wrangler.jsonc
  ```
- [ ] `pnpm cloud:validate` passes. It is the offline release gate both runbooks require between build and deploy: it checks the Worker modules parse and applies every numbered migration to an in-memory SQLite database. It contacts nothing and is not covered by `pnpm check`.
- [ ] On-call: this is a single-owner project - the person deploying is the on-call. Confirm you have time to watch the 15-minute post-deploy window before starting.

## Deploy

- [ ] Deploy the app Worker: `pnpm cloud:deploy`
- [ ] Deploy the integrations Worker from the **same commit**: `pnpm integrations:deploy`
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
