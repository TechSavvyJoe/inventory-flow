# Shared data deployment and activation checklist

## Current status — September 10, 2026

**Live API, access restrictions and OAuth discovery verified; hosted-client connections pending:** after the owner's explicit approval of Workers Paid and acceptance of its checkout Terms of Service/Privacy Policy and recurring-usage agreement, Cloudflare confirmed the purchase and active subscription. Workers Paid is a $5/month account-wide minimum plus applicable usage, not a fixed $5 total bill. Only the separate integration Worker was deployed, version `54c9b37a-58e6-432f-b71b-9b21aacf2383`; remote settings confirm the approved `limits.cpu_ms=1000` and both integration flags enabled. Actual Claude/ChatGPT sign-in remains pending; live scope/store/revocation probes and the existing app's post-deployment comparison passed.

Implemented: read-only REST, official SDK2 remote MCP (modern and legacy clients), shared validated-source projection, explicit scope/store grants, hashed app keys, per-employee Managed OAuth, fixed-window quotas, bounded metadata-only auditing, signed snapshot-bound pagination, OpenAPI contract, backend JavaScript client, and owner-only provisioning/revocation tools.

Provisioned separately from the existing app:

- Worker: `inventory-flow-integrations`; host `inventory-data.joegallant.me`; no workers.dev or preview URLs.
- Existing encrypted R2 release and D1 workflow sources are reused; no new scan, alternate source pointer, or raw-data Git export.
- Only `0004_integrations.sql` was executed remotely. Existing migrations were not replayed. The older migrations are not recorded in the live Wrangler migration ledger; do not blindly run `migrations apply` over that database.
- `0006_integration_audit_per_client.sql` adds the index that per-client audit trimming needs and has not been executed remotely. Apply it the same single-file way as `0004`, not through `migrations apply`, which would replay migrations the live ledger does not record — `0005` in particular drops and recreates `integration_access_audit`. The statement is `CREATE INDEX IF NOT EXISTS`, so it is safe to run twice; until it is applied the audit write still trims correctly but scans more rows to do it.
- Separate MCP Access application `8ae25338-9c2b-4cc1-a602-8dd8166560cb` protects the exact `/mcp` route, approves only the existing owner's email, and uses the existing Google/email identity providers. Main app and publisher Access policies were not changed.
- Dynamic OAuth registration permits only `https://claude.ai/api/mcp/auth_callback`; localhost/loopback wildcards are disabled. A ChatGPT callback has not been guessed or enabled.
- Owner grants were created with four read scopes, four stores, 60 requests/minute, and 30-day expiry. API key is stored only in the owner's ignored `runtime/integration-credentials/joe-app-development.json` file. Use a separate key for each eventual production app; do not reuse this development key in browser code.

Live verification at `2026-09-10T12:15:15.932Z` passed anonymous API denial, all-page authorized inventory enumeration, vehicle detail, changes, hold summaries, and OAuth protection/discovery/S256 PKCE/dynamic-registration gates. The API returned 226 September 9 public vehicles: Howell 74, Fowlerville 49, Ford Detroit 60, Lincoln 43; 135 with equipment, 218 with AutoCheck facts, 226 with scan dates, and 58 public changes. The selected release SHA `95ed40203d3ac90009d31413de81055f8b5e0a1edd9aece7a77d740b7b59748e`, total and four store counts match independently prepared source evidence. This is verification of the September 9 release, not a claim that a September 10 scan ran.

Twelve privacy-filtered runtime events reported successful execution without exceptions; data-read CPU time was 258–340 ms, under the 1,000 ms cap. OAuth does **not** advertise issuer-identification support, and `liveClientSignInVerified` remains false. The exact ChatGPT callback must still be obtained before registration; do not substitute the stable callback or claim a completed Claude connection. Existing Inventory Flow remains a separate deployment; the post-deployment read-only readiness check returned `ready=true`, the identical source hash above, and unchanged counts of 226 inventory, 0 transfers and 1 attention record.

A temporary Howell-only grant passed live checks for scoped rows and health count, an empty cross-store list, `404 NOT_FOUND` for an outside-store VIN, and `403 INSUFFICIENT_SCOPE` for changes and hold summaries. The temporary grant was revoked at `2026-09-10T12:17:16.174Z`; inventory and health reads then both returned `403 INTEGRATION_GRANT_INACTIVE`. The owner's normal development key was not revoked. No credentials or vehicle/CRM payloads were logged by these probes.

## Verification and remaining activation gates

September 10 verification: the full suite passed **760 tests across 62 files** with `--maxWorkers 2`; repository-safety/design guards, TypeScript, the production build, and the enabled integration Worker's 1,000 ms CPU-cap dry-run passed. The initial unrestricted test run timed out one OperationsQueue test at 5,000 ms; its unchanged focused rerun passed in 766 ms, and the bounded-worker full rerun passed. No UI behavior or test timeout was changed to obtain that result. Deployment and the REST/OAuth discovery checks subsequently passed as recorded above; actual hosted-client sign-in remains a separate unverified gate.

1. Workers Paid purchase and the one-second integration CPU budget are approved, with checkout completion confirmed. Do not repeat the purchase or broaden the spending authorization. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Encryption alone does not certify legal compliance.
2. Local and deployed configuration confirm `limits.cpu_ms=1000` and both integration flags enabled. Keep all host checks, separate audiences, readonly scopes, secret bindings, callback restrictions, and preview restrictions; do not alter the existing app's CPU budget.
3. The build, full bounded-worker tests, dry-run and deployment of only the integrations Worker passed. Deployed version: `54c9b37a-58e6-432f-b71b-9b21aacf2383`.
4. `node scripts/verify-integration-deployment.mjs runtime/integration-credentials/joe-app-development.json --expected runtime/integration-expected-release.json` must pass all-page inventory reconciliation, safe fields, detail, changes, holds, unauthorized access, and OAuth discovery. Prepare the independent expected file with only `bundleSha256`, `total`, and all four `byStore` counts from validated source metadata, never a credential or source snapshot. The verifier now exits nonzero unless REST and all four OAuth protection/discovery/S256/registration gates pass; it reports those outcomes separately. Supplying `--expected` additionally gates the release hash and exact store totals. The internal API health count alone is not independent reconciliation. Twenty-six synthetic verifier tests pass. Keep actual hosted-client sign-in and calls unverified until step 6/7 succeeds.
5. Live revocation, store/scope denial and before/after existing-app readiness checks passed as recorded above. For future deployments, repeat them using a separate temporary probe grant; do not revoke the user's development key merely to test revocation.
6. Connect Claude through its hosted custom connector flow and the owner's normal sign-in. Test actual tool discovery/calls, reconnect, expiry, and grant revocation; SDK tests alone do not prove hosted-client compatibility.
7. In ChatGPT's MCP management screen, copy its exact production OAuth callback. New clients may require `https://chatgpt.com/connector/oauth/{callback_id}`. The stable callback requires issuer-identification support; do not assume it. Add only the displayed exact URI to the dedicated integration Access application, preserving other settings. Then complete the owner's sign-in and live tool tests.

Relevant official authentication references: [OpenAI callback requirements](https://developers.openai.com/plugins/build/auth#redirect-url), [Claude callbacks](https://claude.com/docs/connectors/building/authentication#callback-urls), [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).

## Diagnostic history — superseded activation blockers

Before the paid purchase, live requests hit Cloudflare error 1102; privacy-filtered diagnostics confirmed `exceededCpu` at 29 ms. The first approved `limits.cpu_ms=1000` deployment was rejected with code `100328` because the account was on Workers Free. That attempt made no plan upgrade or CPU-limit change. The integration flags were disabled, with no custom remote CPU cap. The owner subsequently approved Workers Paid and explicitly accepted the checkout agreements; the purchase confirmation above supersedes this earlier pending-approval/disabled-state history. A paid subscription and successful dry-run do not by themselves prove a successful live deployment.

Earlier recovery-test hardening changed only its synthetic SQL fixture: explicit exported membership timestamps replaced clock-dependent defaults. A regression verifies identical restore evidence under two different SQLite clocks. Production recovery validation was not weakened or changed.

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
