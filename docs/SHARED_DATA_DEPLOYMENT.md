# Shared data deployment and activation checklist

## Current status — September 10, 2026

Implemented: read-only REST, official SDK2 remote MCP (modern and legacy clients), shared validated-source projection, explicit scope/store grants, hashed app keys, per-employee Managed OAuth, fixed-window quotas, bounded metadata-only auditing, signed snapshot-bound pagination, OpenAPI contract, backend JavaScript client, and owner-only provisioning/revocation tools.

Provisioned separately from the existing app:

- Worker: `inventory-flow-integrations`; host `inventory-data.joegallant.me`; no workers.dev or preview URLs.
- Existing encrypted R2 release and D1 workflow sources are reused; no new scan, alternate source pointer, or raw-data Git export.
- Only `0004_integrations.sql` was executed remotely. Existing migrations were not replayed. The older migrations are not recorded in the live Wrangler migration ledger; do not blindly run `migrations apply` over that database.
- Separate MCP Access application `8ae25338-9c2b-4cc1-a602-8dd8166560cb` protects the exact `/mcp` route, approves only the existing owner's email, and uses the existing Google/email identity providers. Main app and publisher Access policies were not changed.
- Dynamic OAuth registration permits only `https://claude.ai/api/mcp/auth_callback`; localhost/loopback wildcards are disabled. A ChatGPT callback has not been guessed or enabled.
- Owner grants were created with four read scopes, four stores, 60 requests/minute, and 30-day expiry. API key is stored only in the owner's ignored `runtime/integration-credentials/joe-app-development.json` file. Use a separate key for each eventual production app; do not reuse this development key in browser code.

**Not ready for clients:** live requests hit Cloudflare error 1102. Privacy-filtered runtime diagnostics confirmed `exceededCpu` at 29 ms. The proposed capped CPU-limit change was not authorized by the execution safety review; no CPU-limit increase or billing upgrade occurred. `INTEGRATIONS_ENABLED=false` and `INTEGRATION_MANAGED_OAUTH_ENABLED=false` keep the new gateway fail-closed while approval is pending. Existing Inventory Flow remains separate and unchanged.

## Activation after owner approval

1. Confirm Workers plan and obtain explicit approval for a CPU budget/any billing change. [Current Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Do not claim encryption alone certifies legal compliance.
2. Set an approved bounded `limits.cpu_ms` if supported, then enable the two integration flags. Keep all host checks, separate audiences, readonly scopes, secret bindings, callback restrictions, and preview restrictions.
3. `pnpm check`; `pnpm exec wrangler deploy --dry-run --config cloudflare/integrations.wrangler.jsonc`; then deploy only the integrations Worker.
4. `node scripts/verify-integration-deployment.mjs runtime/integration-credentials/joe-app-development.json` must pass all-page inventory reconciliation, safe fields, detail, changes, holds, unauthorized access, and OAuth discovery. This script never displays credentials or source records.
5. Verify revocation and store/scope denial using a separate temporary probe grant. Do not revoke the user's development key merely to test revocation. Compare the existing app's release hash and read-only readiness before/after.
6. Connect Claude through its hosted custom connector flow and the owner's normal sign-in. Test actual tool discovery/calls, reconnect, expiry, and grant revocation; SDK tests alone do not prove hosted-client compatibility.
7. In ChatGPT's MCP management screen, copy its exact production OAuth callback. New clients may require `https://chatgpt.com/connector/oauth/{callback_id}`. The stable callback requires issuer-identification support; do not assume it. Add only the displayed exact URI to the dedicated integration Access application, preserving other settings. Then complete the owner's sign-in and live tool tests.

Relevant official authentication references: [OpenAI callback requirements](https://developers.openai.com/plugins/build/auth#redirect-url), [Claude callbacks](https://claude.com/docs/connectors/building/authentication#callback-urls), [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).

## Creating and revoking app access

Run on the owner-operated host with its existing Wrangler login. Never extract Wrangler's saved credentials. `--transport api` is also available for properly scoped server-side Cloudflare admin secrets.

```powershell
node scripts/manage-integration-client.mjs list --transport wrangler --owner-user-id joe-gallant
node scripts/manage-integration-client.mjs create --transport wrangler --confirm --owner-user-id joe-gallant --type api_token --label "Specific app name" --scopes "inventory.read,health.read" --stores "Howell" --days 30 --secret-output runtime/integration-credentials/specific-app.json
node scripts/manage-integration-client.mjs revoke --transport wrangler --confirm --client-id EXACT_CLIENT_ID
```

Creation requires explicit scope/store/expiry choices, writes only a hash to D1, and delivers the raw key to an exclusive owner-only local file. Revocation is checked on every request. OAuth grants are per employee, shared across that employee's AI clients; API grants are per app. No data-editing or credential-management HTTP route is exposed.

## Recovery and maintenance

Disable the integration flags to fail closed. Do not change main app Access or publisher credentials. Existing encryption secrets are reused internally, not printed; `scripts/configure-integration-secrets.mjs --confirm` through the protected wrapper configures missing secrets without rotating existing ones. Audit rows contain only grant ID, operation, status, count and time, capped at 30 days/10,000 rows. Original licensed documents and all customer/CRM free text are excluded from these external interfaces.

The selected current release is the only queryable release in v1. Complete historical queries, CRM-only vehicle lists and private employee/customer fields require a separately reviewed schema and permissions expansion. Future daily validated publications become the integration's selected source automatically; this does not guarantee unattended source login or scans succeed.
