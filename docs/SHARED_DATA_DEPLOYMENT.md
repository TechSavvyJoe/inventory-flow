# Shared data deployment and activation checklist

## Current status — September 10, 2026

**Latest owner decision:** Workers Paid ($5/month minimum plus applicable usage) and the one-second CPU cap are approved. The authenticated Cloudflare checkout is open with the saved payment method, but its required Terms of Service/Privacy Policy and recurring-usage agreement checkboxes remain unchecked. Action-time acceptance was requested; do not purchase or claim activation until it is confirmed. No charge or plan upgrade has occurred. This supersedes the earlier pending-plan-approval wording in the diagnostic history below.

Implemented: read-only REST, official SDK2 remote MCP (modern and legacy clients), shared validated-source projection, explicit scope/store grants, hashed app keys, per-employee Managed OAuth, fixed-window quotas, bounded metadata-only auditing, signed snapshot-bound pagination, OpenAPI contract, backend JavaScript client, and owner-only provisioning/revocation tools.

Provisioned separately from the existing app:

- Worker: `inventory-flow-integrations`; host `inventory-data.joegallant.me`; no workers.dev or preview URLs.
- Existing encrypted R2 release and D1 workflow sources are reused; no new scan, alternate source pointer, or raw-data Git export.
- Only `0004_integrations.sql` was executed remotely. Existing migrations were not replayed. The older migrations are not recorded in the live Wrangler migration ledger; do not blindly run `migrations apply` over that database.
- Separate MCP Access application `8ae25338-9c2b-4cc1-a602-8dd8166560cb` protects the exact `/mcp` route, approves only the existing owner's email, and uses the existing Google/email identity providers. Main app and publisher Access policies were not changed.
- Dynamic OAuth registration permits only `https://claude.ai/api/mcp/auth_callback`; localhost/loopback wildcards are disabled. A ChatGPT callback has not been guessed or enabled.
- Owner grants were created with four read scopes, four stores, 60 requests/minute, and 30-day expiry. API key is stored only in the owner's ignored `runtime/integration-credentials/joe-app-development.json` file. Use a separate key for each eventual production app; do not reuse this development key in browser code.

**Not ready for clients:** live requests hit Cloudflare error 1102. Privacy-filtered runtime diagnostics confirmed `exceededCpu` at 29 ms. On September 10 the owner approved a bounded processing-limit increase, explicitly reserving any paid upgrade for separate cost confirmation. The attempted `limits.cpu_ms=1000` deployment was rejected by Cloudflare with code `100328`: CPU limits are unsupported on this account's Free plan. No new version, CPU-limit increase, or billing upgrade occurred. Remote settings were rechecked: no custom CPU limit and both `INTEGRATIONS_ENABLED=false` and `INTEGRATION_MANAGED_OAUTH_ENABLED=false`. Local config matches that disabled state. Activation is awaiting explicit Workers Paid approval, not another processing-limit approval. Existing Inventory Flow remains separate and unchanged; read-only readiness still serves 226 vehicles from the September 9 release, SHA `95ed40203d3ac90009d31413de81055f8b5e0a1edd9aece7a77d740b7b59748e`.

## Activation after owner approval

September 10 verification: `pnpm check` passed all 734 tests across 61 files, repository-safety/design guards, TypeScript and the production build. An initially intermittent recovery test was repaired only in its synthetic SQL fixture: explicit exported membership timestamps replace clock-dependent defaults. A regression verifies identical restore evidence under two different SQLite clocks. Production recovery validation was not weakened or changed. The CPU-limited Worker dry-run passed; actual deployment failed at the plan gate above, so live API/MCP acceptance remains outstanding.

1. Obtain explicit approval for Workers Paid before any billing change. The one-second CPU budget is already authorized; the account's Free plan is now confirmed by deployment error `100328`. [Current Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) is a $5 USD monthly minimum plus applicable usage, account-wide, not a fixed $5 total bill. Reconfirm current pricing before purchase. [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Do not claim encryption alone certifies legal compliance.
2. Set an approved bounded `limits.cpu_ms` if supported, then enable the two integration flags. Keep all host checks, separate audiences, readonly scopes, secret bindings, callback restrictions, and preview restrictions.
3. `pnpm check`; `pnpm exec wrangler deploy --dry-run --config cloudflare/integrations.wrangler.jsonc`; then deploy only the integrations Worker.
4. `node scripts/verify-integration-deployment.mjs runtime/integration-credentials/joe-app-development.json --expected runtime/integration-expected-release.json` must pass all-page inventory reconciliation, safe fields, detail, changes, holds, unauthorized access, and OAuth discovery. Prepare the independent expected file with only `bundleSha256`, `total`, and all four `byStore` counts from validated source metadata, never a credential or source snapshot. The verifier now exits nonzero unless REST and all four OAuth protection/discovery/S256/registration gates pass; it reports those outcomes separately. Supplying `--expected` additionally gates the release hash and exact store totals. The internal API health count alone is not independent reconciliation. Twenty-six synthetic verifier tests pass. Keep actual hosted-client sign-in and calls unverified until step 6/7 succeeds.
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
