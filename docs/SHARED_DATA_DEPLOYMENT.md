# Shared data deployment and activation checklist

## Historical deployment — 2026-10-07, 19:18 UTC

- 2026-10-07T19:18:09.574Z | Commit: 108305e2a07c631a165eb13d2fb4a085629d911e | Tag: 108305e | App Version: 669625d0-c502-4c0c-9419-6008e2269ac1 | Integrations Version: aee172fa-13b8-488e-a66f-19a3f8363bd9

The [Software Admin connection record](OWNER_ACCOUNT_CONNECTION_2026_10_07.md)
preserves PR #71's historical owner deployments, activation, rollback versions,
monitoring, independent integration reconciliation, temporary-grant cleanup and
authenticated reciprocal navigation acceptance. The retained inventory publication
was October 1. This record is historical evidence, not current deployment or
source-freshness verification. Native new-window and hosted OAuth-client sign-in
remained unverified.

## Deployment - 2026-10-07 (pnpm cloud:release)

- 2026-10-07T02:15:20.511Z | Commit: 72e4ca4cd61820f843fed9785293264ddfdacd20 | Tag: 72e4ca4 | App Version: d6614de9-4eb4-4aee-a8eb-2d96d0c16192 | Integrations Version: 572a82ac-939b-490f-a33b-903956787ddb

[October 6 local-date release evidence](RELEASE_2026_10_06.md) records the exact
checks, reviewed 0015 migration, preserved history, rollback versions, live
acceptance, publisher states, and separate owner-service activation boundary.

## Deployment - 2026-09-30 (pnpm cloud:release)

- 2026-09-30T18:47:22.792Z | Commit: e5f2ae4f1afa0fc8e41ce09381ca2642c804d34a | Tag: e5f2ae4 | App Version: f1d51344-f960-41de-9988-6459cb72a7c6 | Integrations Version: b5b8b31c-0b03-43b8-8a6f-e97863b7d9cc

Inventory Flow 1.4.0 ships the completed workspaces, companion/customer documents, central customer lists and PR #59 employee-isolation repair. [The release evidence](RELEASE_1_4_0.md) records exact-commit CI, individual verified migrations 0013/0014, the protected backup, authenticated readiness/version checks, independently reconciled integration data, rollback versions and remaining physical-device/employee acceptance boundaries. Joe-PC's publisher tasks were restored. Both Worker versions completed at least 15 minutes of connected monitoring without exceptions or 5xx responses; the scheduled 15:25 EDT hold refresh returned `0` and `published_and_verified` at 15:26:18 EDT, with no pending reconciliation.

## Deployment - September 23, 2026 (DealerMail hold freshness)

Source commit `2f609694fa33cb5881b69ee071b0e8f10de6eaa5` passed [GitHub validation run 35884145372](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/35884145372): tests, build, cloud/recovery checks, browser end-to-end, and mobile/cross-browser acceptance. The CI repair installed Pillow and pypdf for the existing Python document tests. No migration or daily-data republication was part of this code deploy.

| Worker | Previous version (rollback target) | New version (100% deployment, tag `2f60969`) |
| --- | --- | --- |
| `inventory-ops-production` | `abf7caae-7385-412e-b0a9-777be6dc4a92` | `91c1596d-f37b-465f-b131-ec873a727af9` |
| `inventory-flow-integrations` | `e38e9755-bea4-46e1-9e21-08408077c4de` | `7c43bcfa-23e0-48b0-8915-e10846fadfb1` |

The September 23 morning DealerMail capture showed an active hold for F-350 stock `HT1345U`, placed September 17. The live exact-stock DealerMail hold page now has no active order for that stock; the separate Jeep `H13579P` still has two active orders. DealerMail does not expose the F-350 deletion timestamp, so September 17 must not be presented as the deletion date. A comparison of all 30 currently held stocks against their exact live hold pages found no stock/VIN cross-assignment. Among continuing inventory stocks, four morning holds had ended and two new holds appeared after capture; three morning stocks left the inventory grid and one new stock appeared. The 34 morning published holds also had no stock/VIN/detail mismatch. This was a freshness problem, not evidence that the Jeep hold was assigned to the truck. The verified morning release remains the app's daily snapshot until the primary Windows DailyPublish task publishes the next validated release.

Companion 1.3.1 checks the selected stock directly in an authenticated DealerMail inventory tab, rejects an expired or mismatched response, and clears stale owner/reason details. It shows the DealerMail capture time separately from the last live check and rechecks an open vehicle periodically. The app Worker uploaded the matching `inventory-flow-deal-desk.zip`; unpacked browser installations still require a reload after updating their files. Both local checkouts now point to this commit; the GitHub Desktop checkout was fast-forwarded after the push.

Post-deploy machine-authenticated `/internal/readiness` stayed `ready: true` for the September 23 release hash `d3661123349f6a094c6bcab2493598317238a212a0e5ad5ca1963d901dd8480a` (234 active app inventory records). A temporary four-store integration grant passed anonymous denial, inventory pagination, vehicle/change/hold reads, OAuth discovery, and independent reconciliation of the same hash and 232 public VINs across all four stores. The grant was revoked immediately after verification and independently confirmed disabled in D1. Its now-unusable local credential file remains under `runtime/integration-credentials/deploy-verify.json` because the local cleanup command was blocked by policy; it is gitignored and must not be reused. Direct signed-in employee UI and hosted ZIP download checks were unavailable: the browser-control surface failed and the Automation Browser redirected to Cloudflare Access sign-in. Wrangler deployment, authenticated readiness, integration reconciliation, and synthetic browser tests do not substitute for those checks. Error-only tails for both exact Worker versions reported no events over approximately 16:11-16:26 UTC; readiness passed again at the end.

## Deployment - September 22, 2026

Source commit `1d3ddb717420b644cc849c716ad0a6ee6f87a243` was deployed to both production Workers after [GitHub validation run 35794072969](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/35794072969) passed its test/build, browser end-to-end, and mobile/cross-browser jobs on that exact commit. Local checks also passed: 1,941 tests, TypeScript, production build, extension package verification, repository safety, design-system guard, and Cloudflare release validation. No database migration was introduced; the live D1 schema contains the required tables. The working tree was clean before deployment.

| Worker | Previous version (rollback target) | New version (100% deployment, tag `1d3ddb7`) |
| --- | --- | --- |
| `inventory-ops-production` | `294a3886-18dc-4112-b637-0477301d9612` | `3b8d3780-c993-4feb-a3bb-7950f6702f35` |
| `inventory-flow-integrations` | `cd9544be-54d1-4ffe-93c0-960fde73286b` | `e38e9755-bea4-46e1-9e21-08408077c4de` |

The app asset upload included the matching Inventory Flow Deal Desk extension ZIP. A Ford/Lincoln original window-sticker link marked incomplete, unavailable, or unknown no longer opens as a valid sticker; the VIN-matched vAuto equipment source is offered instead and identified as informational, not as a Monroney sticker. This was checked against the current Fowlerville source pattern and regression tests. Today's already verified inventory publication was not replaced by an AI-session publisher run.

Post-deploy, `/internal/readiness` remained `ready: true` on the September 22 release hash `c3ec6cfd34b524df3cb2d71f54f9419066ae05962120909274e5001cb9daade0` (236 active inventory records). A temporary four-store integration grant passed anonymous-denial, inventory pagination, vehicle/change/hold reads, OAuth discovery, and independent reconciliation against 232 public VINs and all four store counts. Both temporary grants were revoked and their local credential files removed immediately after testing. The 15-minute post-deploy observation window included error-filtered tails for both Workers from approximately 23:14 to 23:24 UTC, with no reported error; live readiness passed again at the end. Wrangler shows the new versions at 100%. Direct signed-in employee UI and `/api/health` version-field checks were not completed because the browser-control surface failed to load; do not treat the readiness and synthetic browser suites as those checks.

Operational follow-up: the Work PC's DealerMail keeper repeatedly reported `SESSION_EXPIRED` after deployment. FMCDealer, Ford invoice access, and vAuto were healthy at the same check. Tomorrow's full source pull requires a DealerMail sign-in in the Work PC Automation Browser; the 7:30 daily run and 9:15 publisher remain scheduled and the operational script copies match the repository. The separate ChatGPT daily-task prompt was updated to include the Ford/Lincoln sticker-to-vAuto fallback rule.

## Deployment — September 12, 2026

PR #4 (`claude/premium-production-ready-b1c6e4`, 21 commits: product-rule fixes, integration-contract reconciliation, portable-client hardening, Worker robustness, e2e/UI fixes) was rebase-merged into `main` at `46772c7` with a linear history and a tree byte-identical to the reviewed branch tip. Migration `0006_integration_audit_per_client.sql` (the per-client audit index) was applied to the live D1 database as a single file — `d1_migrations` remains empty by design; see "Recovery and maintenance." Both Workers were redeployed from that commit: integrations Worker `inventory-flow-integrations` (version `90f36975-ffa7-4f06-857d-e86f5474d1cd`) and the app Worker `inventory-ops-production` (version `f9fa3765-5ab2-42dd-8d0c-5f0ba5a486f2`), retaining existing D1/R2 bindings and secrets. Rollback targets if needed: previous integrations version `bf60bd1a-5cef-484c-99d8-6b033e10d947`, previous app version `89bcbe5f-22e9-4344-a82d-56497cedc8fb`. `wrangler rollback` takes the version ID as a positional argument, not a `--version-id` flag (`wrangler rollback [version-id]` per `wrangler rollback --help`): `wrangler rollback bf60bd1a-5cef-484c-99d8-6b033e10d947 --config cloudflare/integrations.wrangler.jsonc` and `wrangler rollback 89bcbe5f-22e9-4344-a82d-56497cedc8fb --config cloudflare/wrangler.jsonc`.

Pre-deploy: `pnpm check` passed locally (repo-safety, design-system ratchet, 836/836 tests, production build) against the merged tree, and CI had already passed on the identical content at the pre-merge PR tip. **Precision on ordering:** the post-merge CI run on `46772c7` (run `34676078400`) started at `05:38:00Z` and finished at `05:39:37Z`; the integrations Worker was deployed at `05:39:17Z` — 20 seconds before that specific run finished — and the app Worker at `05:39:47Z`, 10 seconds after. The deploy was not gated on that post-merge run; it was gated on the pre-merge CI pass plus the local `pnpm check` pass against the byte-identical merged tree. Neither Cloudflare version carries a commit reference (`Tag`/`Message` are blank; no `version_metadata` binding is configured in either `wrangler.jsonc`), so provenance for a future audit is git history plus this note, not the Cloudflare dashboard.

Post-deploy verification (read-only, credential-scoped to a 24-hour temporary probe grant, revoked and deleted immediately after use — see "Creating and revoking app access"): an independent multi-agent adversarial pass covering contract conformance, anonymous-edge robustness, the Access-gated app host, `wrangler tail` on both Workers under live traffic, the D1 audit schema/rows, and a commit-by-commit regression ledger found **zero blocker or fail-verdict findings**. Two items were downgraded from "pass" to a caveat by the adversarial pass and are recorded honestly: (1) unknown-query-parameter rejection is proven only by the shipped JS client's local validation and by source reading, not by an anonymous request that reaches the server-side guard — authenticating first is required to observe it live, and the probe grant used for this pass is now revoked; (2) the current release carries no manager-log source data (`managerDispositionCoverage.status: "not_provided"`), so the manager-disposition endpoint and fields were schema-validated (zero contract gaps) but not data-validated live. Minor/note-level findings from the same pass: no `Strict-Transport-Security` header on either host (pre-existing, not introduced by this deploy); the two Workers use different security-header constants (`cloudflare/src/integration-worker.mjs` vs `cloudflare/src/worker.mjs`), which is an existing code fact, not a regression; `/.well-known/acme-challenge/*` on the integrations host is the one path Cloudflare's Always-Use-HTTPS carve-out lets reach the Worker over plain HTTP, where it correctly fails closed with `403 INTEGRATION_HOST_NOT_ALLOWED` before touching auth or data.

Of the 21 merged commits, roughly a third are observable anonymously right now (contract/schema shape, error codes, the URIError→400 fix's guard existing in source), a third require an authenticated Access session or a specific data condition to exercise live (manager-log coverage, a real 429, transfer-workflow fixes), and the rest are test-infrastructure-only or publish-host-only changes with no live-traffic surface at all. This is expected for a merge of this size, not a gap introduced by rushing.

## Deployments — September 14 to 19, 2026

Recorded on September 19 from `wrangler deployments list` for both Workers plus a symbol-level comparison of the served app bundle against git. None of these versions carries a commit reference (no `version_metadata` binding is configured), so provenance remains git history plus this note.

**App Worker `inventory-ops-production`.** Six deployments on September 16 and four on September 19, listed with the complete version IDs `wrangler rollback` takes as its positional argument:

| Created (UTC) | App Worker version |
|---|---|
| 2026-09-16 02:24 | `c20ca5d8-3eff-4ea6-bae4-014f6f2669ae` |
| 2026-09-16 02:40 | `4b8d8e33-fa82-4d00-b404-38692bc6c983` |
| 2026-09-16 02:43 | `977f948b-4172-4444-849e-dde606fc3799` |
| 2026-09-16 13:51 | `0531217c-7eb5-4985-a05d-9a9107076f4f` |
| 2026-09-16 15:31 | `e80657ba-752f-4a19-8c0f-7d72ad289e51` |
| 2026-09-16 19:26 | `b514d98a-aa97-41c4-b8e1-1f2da71a45af` |
| 2026-09-19 15:50 | `8ecdbea0-ce07-4017-b1b7-503c09cda0dc` |
| 2026-09-19 16:48 | `45d14f01-5aa1-49f3-9bf9-eb7dd0c040af` |
| 2026-09-19 16:54 | `88023fd7-5867-417b-a425-a022422fd72c` |
| 2026-09-19 17:01 | `09ecac9e-21aa-4e0e-957e-196531c34798` (current) |
 `main` has had no commit since `563712c` (release 1.2.1, merged 2026-09-16T00:34Z), so the later September 16 deployments and all four September 19 deployments were built from the open branch `codex/manager-workflow-polish` (PR #13). The current version `09ecac9e-21aa-4e0e-957e-196531c34798` matches that branch's head `15d9365`. Production therefore runs unmerged code until PR #13 merges or the Worker is rolled back; because no version records its commit, pick a rollback target only after confirming its content. To redeploy from a known commit, follow the full sequence in `docs/CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md` — check out the commit, run `pnpm check` (which builds `dist/`), then `pnpm cloud:validate`, then `pnpm cloud:deploy` — never `pnpm cloud:deploy` alone, which only runs `wrangler deploy` and would upload whatever `../dist` a previous checkout left behind.

**Integrations Worker `inventory-flow-integrations`.** Deployed three times on September 14 and three times on September 15:

| Created (UTC) | Integrations Worker version |
|---|---|
| 2026-09-14 17:41 | `7fef7634-2ba3-4077-b821-d1687bab101c` |
| 2026-09-14 19:04 | `5dbec8ad-d65a-4fcd-99f2-bd229bfc52b3` |
| 2026-09-14 21:42 | `4776a35c-c61a-41ac-b71d-dc6552d1f20f` |
| 2026-09-15 14:45 | `aa51f742-5021-40d7-9c2f-02e95b85052b` |
| 2026-09-15 14:49 | `c86d1ab7-7ceb-458c-a3df-86838a88625d` |
| 2026-09-15 14:51 | `9d0ac26c-6dfd-46d9-a33a-4c69c9e74885` (current) |
 The current version `9d0ac26c-6dfd-46d9-a33a-4c69c9e74885` predates every release 1.2.0/1.2.1 commit that touches the modules it bundles (`server/service-core.mjs`, `cloudflare/src/worker.mjs`, `repository.mjs`, `release-validation.mjs`) and the integration read expansion in `d61a5f4`, committed five minutes after that deploy. Treat it as stale: redeploy it from the same commit as the app Worker at the next app deployment (`pnpm cloud:release` now deploys both Workers from one commit and runs `pnpm check` and `pnpm cloud:validate` itself), then run `node scripts/verify-integration-deployment.mjs` as described under the activation gates.

**Migrations.** The live D1 database carries the tables introduced by `0007`–`0009`, applied as single files (the `d1_migrations` table stays empty by design). Release 1.2.1 requires `0009_membership_admin.sql`.

**Follow-ups.** Merge or roll back PR #13; redeploy the integrations Worker from the merged commit; record every future deployment here with its version ID and source commit, and consider a `version_metadata` binding in both `wrangler.jsonc` files so Cloudflare carries the commit itself.

**Update — September 19, 2026.** Both `wrangler.jsonc` files now bind `CF_VERSION_METADATA`, and `pnpm cloud:deploy` / `pnpm integrations:deploy` tag each version with the source git short SHA through `scripts/deploy-worker.mjs` (a dirty tree is refused). The "no version_metadata binding is configured" statements above describe the versions listed in this section and stay true of them; every version deployed from this change onward carries its commit on the Cloudflare dashboard and, for an authenticated caller, in the `version` field of `/api/health` and `/api/v1/data-health`. Those versions are still not deployed — nothing in this note claims a deploy happened. Use [Deploy checklist](DEPLOY_CHECKLIST.md) for the next one.

## Current status — September 10, 2026

**Live API, access restrictions and OAuth discovery verified; hosted-client connections pending:** after the owner's explicit approval of Workers Paid and acceptance of its checkout Terms of Service/Privacy Policy and recurring-usage agreement, Cloudflare confirmed the purchase and active subscription. Workers Paid is a $5/month account-wide minimum plus applicable usage, not a fixed $5 total bill. Only the separate integration Worker was deployed, version `54c9b37a-58e6-432f-b71b-9b21aacf2383`; remote settings confirm the approved `limits.cpu_ms=1000` and both integration flags enabled. Actual Claude/ChatGPT sign-in remains pending; live scope/store/revocation probes and the existing app's post-deployment comparison passed.

Implemented: read-only REST, official SDK2 remote MCP (modern and legacy clients), shared validated-source projection, explicit scope/store grants, hashed app keys, per-employee Managed OAuth, fixed-window quotas, bounded metadata-only auditing, signed snapshot-bound pagination, OpenAPI contract, backend JavaScript client, and owner-only provisioning/revocation tools.

Provisioned separately from the existing app:

- Worker: `inventory-flow-integrations`; host `inventory-data.joegallant.me`; no workers.dev or preview URLs.
- Existing encrypted R2 release and D1 workflow sources are reused; no new scan, alternate source pointer, or raw-data Git export.
- `0004_integrations.sql` and `0006_integration_audit_per_client.sql` (September 12) have been executed remotely as single files, each idempotent (`IF NOT EXISTS` throughout). `0001`–`0003` and `0005` are applied to the live schema but were never run through `migrations apply`, so `d1_migrations` stays empty; do not run `pnpm cloud:d1:migrate` / `wrangler d1 migrations apply` against this database expecting it to reconcile that gap. Confirmed by direct read of Wrangler's apply loop plus a live schema check: `0001`/`0002` would re-run as no-op idempotent statements, but `0003_transport_assignment_identity.sql` opens with three bare `ALTER TABLE ... ADD COLUMN` statements (SQLite has no `IF NOT EXISTS` for columns) against columns the live schema already has — the apply run throws `duplicate column name` on first contact with 0003 and stops. `0004`, `0005`, and `0006` never execute, so `0005`'s `integration_access_audit` rebuild is not triggered and neither audit index is dropped. That makes an accidental `migrations apply` a clean, loud failure rather than a silent one — reassuring, but it is not a reason to run it; the ledger would still end up half-populated (0001/0002 recorded, everything else not) in a way that misrepresents the schema's real history. Apply any future migration the same single-file way.
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
