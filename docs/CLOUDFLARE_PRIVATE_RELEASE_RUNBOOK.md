# Private Cloudflare release service

## Purpose

This service replaces the unreliable PC-hosted Cloudflare Tunnel as the source
of truth for Inventory Flow data. It does **not** turn GitHub into a dealer
database and it does not upload DealerMail, customer, hold, comment, alert, or
daily scan data to the repository.

The release path is deliberately one-way:

```text
validated daily public + DealerMail release on authorized work PC
  -> local publisher with a service identity
  -> Cloudflare Access
  -> private Worker validation
  -> encrypted R2 release artifact + D1 release pointer/audit metadata
  -> Access-protected application API
```

The publisher refuses stale or incomplete public/DealerMail releases. The
Worker decrypts and re-validates the envelope before it writes R2 or advances
the D1 `current_release_id` pointer. If a refresh fails, the last verified
current release remains unchanged.

## Resources provisioned

- D1: `inventory-ops-production` (US jurisdiction), for the shared operational
  ledger, release metadata, and audit history.
- R2: `inventory-ops-private-snapshots`, for encrypted immutable release
  artifacts. It has no public bucket/domain binding.

No live dealership data is present in either resource until a successful
private publish completes. The R2 bucket's regional placement must be confirmed
with the deployment owner before its first sensitive release. The encryption
envelope makes stored payloads unreadable without the Worker/publisher key.

## Deployment guardrails

- `cloudflare/wrangler.jsonc` sets `workers_dev: false`; there is no public
  `workers.dev` address.
- The private routes require the exact protected hostname plus a Cloudflare
  Access assertion. The Worker still performs that check so an accidental
  unprotected route returns no release data.
- `/internal/releases` also requires a dedicated bearer publisher secret. A
  Cloudflare Access service token protects the transport through Access.
- Secrets are supplied at runtime only; `.dev.vars` and all `.env.*` files are
  ignored by Git.
- The Worker intentionally logs neither body content nor credentials. Its
  browser/publisher errors contain only a request ID and a non-sensitive code.
- Do not attach a public R2 custom domain, GitHub Pages data bundle, or a
  browser-accessible database credential.

## One-time private setup

Run all commands from `apps/inventory-ops` as the Cloudflare account owner.
Do not paste the resulting secrets into chat, source files, GitHub, or logs.

1. Install repository dependencies and verify the Worker source:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm cloud:validate
   ```

2. Apply the empty D1 schema. It creates tables only; it imports no source
   data:

   ```powershell
   pnpm cloud:d1:migrate
   ```

3. Create two independent secrets in the Cloudflare Worker secret store:

   - `RELEASE_PUBLISHER_TOKEN`: at least 32 random characters.
   - `RELEASE_ENCRYPTION_KEY_BASE64`: base64 for exactly 32 random bytes.

   Use `wrangler secret put` or the Cloudflare dashboard secret control. Keep
   the same encryption key only in the authorized release-publisher machine's
   local secret store. Establish a documented rotation/recovery procedure before
   a second publisher machine is authorized.

4. Create a Cloudflare Access **service token** limited to publishing. Add it to
   a policy for the protected hostname; do not use a personal browser cookie for
   unattended publishing. Store its client ID and secret only in the work PC's
   machine/user secret store.

5. Deploy the Worker, but do not switch the customer-facing hostname yet:

   ```powershell
   pnpm cloud:deploy
   ```

6. Configure the existing Access application for
   `inventory-ops.joegallant.me` before assigning the Worker route. Keep the
   current Joe-only policy until employee roles and server-side field filtering
   are complete. Add the custom Worker route only after the protected staging
   checks below pass.

## Daily publishing on the authorized work PC

The scheduled scan remains the only process permitted to read the public sites
and authenticated DealerMail session. After the workbook/report manifest is
complete and validated, load these values from the PC's secret store into the
publisher process:

- `INVENTORY_OPS_CLOUD_URL=https://inventory-ops.joegallant.me`
- `INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN`
- `INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

Then run:

```powershell
pnpm cloud:publish-release
```

Success prints only `published: YYYY-MM-DD` or `already_published: YYYY-MM-DD`.
It cannot publish an incomplete/stale public or DealerMail source. Do not add
this command to an unattended schedule until the Access service token and both
Worker secrets have been stored on the authorized PC and a complete staged
release has been verified.

## Cutover acceptance checklist

Do not replace the current tunnel DNS target solely to eliminate Error 1033.
The Worker must first provide the full application API and server-enforced role
filtering—not merely a raw release download.

- [ ] D1 migration verified in the intended account.
- [ ] Worker secrets exist and are absent from Git/source/browser bundles.
- [ ] Access service-token publisher works through the exact protected hostname.
- [ ] A complete release uploads, reads back, decrypts, and matches source
      hashes; a stale/incomplete release is rejected.
- [ ] A failed upload leaves the previous D1 current pointer unchanged.
- [ ] The Worker implementation has the existing `/api/bootstrap`, vehicle,
      transfer, and attention behavior backed by D1—not a browser-selected role.
- [ ] Employee identity, role, and home-store mapping are server-enforced;
      customer/reason/comments/alerts are filtered by role.
- [ ] A lower-privilege pilot group completes workflow, audit, backup/restore,
      access-revocation, and accessibility checks.
- [ ] Production route and Access policy are tested from a non-authorized
      account before the tunnel CNAME is removed.

Until every check above is complete, the current application remains a private
prototype and its unreliable tunnel should not be described as production
hosting.
