# Daily automation runbook (the automation PC)

Set up 09/11/2026, rewritten 09/14/2026 after the browser moved to Comet, the
capture steps became scripted, and the multi-service keeper became a Windows task. Companion to
CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md, which covers the publish mechanics; this
file covers *what runs, when, on which machine, and how to fix or undo each
piece*. Dates in this file are MM/DD/YYYY; internal file names and JSON keys
stay ISO on purpose (the pipeline matches on them).

## Repository scripts reference (`scripts/*.mjs`)

Every script this repository tracks, where it actually runs, and what it does.
"CI" means `.github/workflows/ci.yml` runs it on every push/PR; "local" means a
developer or Joe runs it by hand or via a `pnpm` script on a Mac or the
Windows automation host; "Windows host" means only the scheduled tasks above
run it, against authenticated dealer sources, over CDP.

| Script | Runs where | Purpose |
|---|---|---|
| `archive-inventory-history.mjs` | local | Archives a dated inventory-history snapshot into the append-only history schema. |
| `block-generic-d1-migrate.mjs` | local/CI (`cloud:d1:migrate`) | Refuses a generic `wrangler d1 migrations apply`; this D1 database predates Wrangler's migration ledger. |
| `build-demo-documents.mjs` | local | Generates synthetic static demo-document data from the fixture release; never opens live data. |
| `build-extension-icons.mjs` | local (`extension:icons`) | Renders the Chrome extension's toolbar/store icons from the brand mark. |
| `capture-dealermail.mjs` | Windows host | Deterministic, resumable read-only DealerMail deep capture over CDP. |
| `capture-demo-documents.mjs` | local | Renders synthetic HTML documents against the local preview server only; never captures live vehicle data. |
| `capture-invoices.mjs` | Windows host | Ford/Lincoln factory invoice PDF capture over CDP through the FMCDealer/Entra SSO session. |
| `capture-oasis.mjs` | Windows host | Deterministic, read-only Ford OASIS build/warranty/recall capture over CDP. |
| `capture-service-history.mjs` | Windows host | Deterministic, read-only Ford PTS Retail Service Repair History capture over CDP. |
| `capture-ui.mjs` | local (`qa:visual`) | Captures UI screenshots from the demo app for design review. |
| `capture-vauto-autocheck.mjs` | Windows host | Exact-VIN AutoCheck fallback captured from vAuto's own read-only report API. |
| `capture-warranty.mjs` | Windows host | Remaining factory warranty per VIN (Ford OASIS, else AutoCheck estimate) at the vehicle's actual listed mileage. |
| `check-design-system.mjs` | local/CI (`check:design-system`) | The design-system ratchet: sub-12px text and raw-color counts must not regress. |
| `check-repo-safety.mjs` | local/CI (`check:repo-safety`) | The repository safety gate documented above. |
| `configure-integration-secrets.mjs` | local, owner-run | Configures the integrations Worker's Wrangler secrets through the protected secret-store wrapper. |
| `deploy-worker.mjs` | local, owner-run (`cloud:release`; `cloud:deploy` and `integrations:deploy` are aliases) | Paired release of both Workers from `origin/main`: runs `pnpm check` and `pnpm cloud:validate`, verifies the D1 ledger read-only, deploys with one tag, and records version receipts. See [Deploy checklist](DEPLOY_CHECKLIST.md). |
| `dryrun_manager_disposition_check.mjs` | Windows host | Dry-run oracle: runs the manager-disposition overlay through the real importer/validators without publishing. |
| `dryrun_manifest_check.mjs` | Windows host | Dry-run oracle: verifies a run-status manifest passes the real gate functions before the scheduled publish attempts it. |
| `dryrun_resource_enrichment_check.mjs` | Windows host | Dry-run oracle: exercises the real resource-enrichment validators end-to-end on a candidate file. |
| `keep-dealermail-alive.mjs` | Windows host | The `BobMaxey-DealerMailKeeper` task: pings DealerMail/FMCDealer/vAuto over CDP every 10 min to keep sessions warm. |
| `manage-integration-client.mjs` | local, owner-run (`integrations:client`) | Inspects or narrowly updates the dedicated MCP Access application; never part of the public API. |
| `merge-ford-service-history.mjs` | Windows host | Merges exact-VIN Ford PTS service history into the daily resource-enrichment file. |
| `merge-invoice-metadata.mjs` | Windows host | Attaches exact-VIN Ford/Lincoln invoice availability to the daily resource-enrichment file. |
| `merge-vauto-autocheck.mjs` | Windows host | Merges exact-VIN vAuto AutoCheck fallback facts into the daily resource-enrichment file. |
| `package-extension.mjs` | local/CI (part of `build`) | Packages exactly the reviewed, tracked extension source into the build output. |
| `perplexity-inventory-mcp.mjs` | local (`integrations:perplexity-mcp`) | Runs the Perplexity inventory MCP bridge against the local integration credential file. |
| `prepare-cloud-assets.mjs` | local/Windows host | Hashes and stages `dist/` assets for the cloud release's asset store. |
| `preview-extension.mjs` | local (`extension:preview`) | Serves the side panel as a plain page for design review and screenshots. |
| `publish-cloud-release.mjs` | local/Windows host (`cloud:publish-release`) | Builds, validates, encrypts, and publishes the daily release bundle to the private Worker. |
| `publish-invoice-documents.mjs` | Windows host | Uploads exact-VIN Ford/Lincoln invoice PDFs to the app's private R2 store. |
| `publish-vauto-documents.mjs` | Windows host (`daily-cloud-publish.ps1`) | Stages the VIN-bound, hash-checked vAuto equipment PDFs from `work\vauto-documents\` in the app's private R2 store before a release publishes; posts only to the app's own Worker. |
| `report-dead-css.mjs` | local (`report:dead-css`) | Read-only report of CSS selectors under `src/` that need a class no source file renders; judges each selector of a rule separately. |
| `run-inventory-flow-daily.mjs` | Windows host (`daily:run`) | The daily pipeline orchestrator invoked by the Windows scheduled publish task. |
| `run-recovery-drill.mjs` | local/CI | Exercises the real D1 recovery/decrypt paths against a synthetic release bundle; `pnpm cloud:validate`'s companion in CI. |
| `start-synthetic-demo.mjs` | local/CI (`dev:demo`, `start:demo`, Playwright `webServer`) | The synthetic-demo-only Node server; refuses a file-backed database outside demo identity. |
| `sync-cloud-release.mjs` | Windows host | Orchestrates build/validate/encrypt/publish/re-verify for the scheduled daily publish task. |
| `upload-cloud-assets.mjs` | Windows host/local | Uploads the assets `prepare-cloud-assets.mjs` staged to the cloud release's asset store. |
| `validate-cloud-release.mjs` | local/CI (`cloud:validate`) | Offline Cloudflare release gate; opens only an in-memory database, never a live one. |
| `vauto-factory-equipment.mjs` | Windows host | vAuto Factory Equipment capture over the read-only `WindowStickers` JSON endpoint; no appraisal form involved. |
| `verify-cloud-deployment.mjs` | local/Windows host, owner-run | `status`/`readiness`/`equipment-status` read-only checks against the deployed private Worker. |
| `verify-d1-recovery-export.mjs` | local, owner-run | Validates an explicitly supplied D1 SQL export locally; never connects to D1. |
| `verify-integration-deployment.mjs` | local, owner-run (`integrations:verify`) | Read-only live smoke test of the integrations Worker; local credentials are consumed, never displayed. |

Scripts under `scripts/lib/` are shared helpers imported by the table above,
not entry points run on their own.

## The morning, unattended

| Local time | What | Runs where | Owned by |
|---|---|---|---|
| 07:30 | Public inventory + resource enrichment, Vehicle Resources sheet, scripted DealerMail deep capture + snapshot build/finalize, scripted Ford OASIS and invoice capture, workbook merge/tidy/validate, complete the manifest, verify (never run) the publish, vAuto backup, message Joe | Claude scheduled task `Bob Maxey Used Inventory - Daily Report`, prompt `outputs\bob_maxey_task_prompt_2026-09-14.txt` | Claude Cowork |
| 08:45, 09:45, 10:45 | Idempotent recovery: follow the same 09/14 prompt only when today's verified receipt is absent; defer to an active writer | Codex heartbeat `Daily Bob Maxey Used Inventory Report` | Codex recovery |
| 09:15, then every 30 min to 15:15 | Build/reuse resource cache, publish to Cloudflare, verify live | Windows task `BobMaxey-InventoryFlow-DailyPublish` | Task Scheduler |
| 09:25, then every 30 min to 19:25 | After the morning release is verified, archive the prior DealerMail revision, refresh current holds/comments/alerts, rebuild and validate the release, and republish through the same protected publisher | Windows task `BobMaxey-InventoryFlow-IntradayHolds` | Task Scheduler |
| every 15 min, all day | Relaunch the isolated automation **Comet** if it is not running | Windows task `BobMaxey-AutomationBrowser` | Task Scheduler |
| every 10 min, all day | Keep DealerMail, FMCDealer/OASIS, Ford invoices and vAuto sessions warm; recreate missing read-only service tabs and report each service's real failure signature | Windows task `BobMaxey-DealerMailKeeper` | Task Scheduler |

The Claude and Codex tasks never publish. The publish is a production deploy and is
refused inside unattended AI sessions, so it lives in a Windows task that has no
such gate and runs as the automation account (which is what lets the DPAPI secret bundle
decrypt). The Claude task only *verifies* the publish by reading the receipt and
the Windows task's log, and may `Start-ScheduledTask` it once if the manifest
completed after the last scheduled slot.

The intraday hold task is deliberately narrower than the morning run. It does not
recapture OASIS, Ford service history, invoices, stickers, vAuto, warranty, or
public inventory, and it does not re-upload saved invoice or vAuto PDF documents.
It validates the existing resource bundle before every publication. It requires
the same-date `published_and_verified` receipt and proves that the reused public
snapshot, current canonical DealerMail snapshot, resource-enrichment file, and
manager-disposition source and sanitized projection still match that receipt
before any file is archived or replaced. Only a newly captured DealerMail hash
may then change. It
archives each prior DealerMail revision under
`work\dealermail-history\intraday\YYYY-MM-DD\`. The candidate manifest, release
bundle, and DealerMail files are transactional: a capture, validation, or
prepublication failure restores the last verified copies. A new receipt is
never rolled back merely because a later integration, pointer, document, or
archive follow-up failed.

The daily publisher and intraday orchestrator hold the same
`work\app-feed-status\.publication.lock` for their entire pipeline. A child
publisher may reuse the lock only with the exact inherited random owner ID, and
the cloud-sync process rechecks every expected source hash immediately before
publication. An overlapping intraday slot records `waiting_for_pipeline_writer`
and lets the next scheduled slot retry; it never starts a second writer.

The saved release artifact and encrypted POST share one immutable manifest
projection. It retains source hashes, counts, change evidence, warnings, and QA
validation, while excluding local release-path/hash fields, delivery receipts,
latest-pointer state, and mutable pipeline-step logs. Those excluded fields may
be recorded after a publish attempt without changing the candidate bundle hash.
After a POST, only an allowlisted structured rejection known to occur before a
commit is treated as definite; malformed, internal, or unrecognized responses
require exact-hash reconciliation.

The separate intraday monitor may start the existing hold-refresh task once for
a newly observed ordinary task or receipt failure. If either the hold status or
dated run manifest says reconciliation is required or the publication outcome
is unknown, the monitor never starts that task. The manifest remains
authoritative when the later status write is missing or unreadable. On its
first observation the monitor writes one active and historical alert containing
the exact candidate bundle SHA-256 and the protected status/readiness
reconciliation action; identical later observations are deduplicated.

The intraday writer also enforces this stop before reading the prior receipt or
starting any capture. A later 30-minute scheduled invocation returns attention
required and leaves the reconciliation status, candidate hashes, and manifest
unchanged until an operator completes the exact-hash reconciliation.

`work\hold-refresh-status\{date}.json` uses these operator-facing states:

- `intraday_holds_published_and_verified`: the exact success contract. Its
  `receipt` object contains `bundleSha256`, `verifiedAt`, and
  `dealerMailSha256`, which link it to the corresponding
  `work\app-feed-status\{date}.json` `published_and_verified` receipt.
- `intraday_holds_published_followups_pending`: the new hold release is already
  live and verified, but a post-publication follow-up failed. Retry the existing
  Windows task; do not describe the prior cloud release as still live.
- `intraday_holds_publication_outcome_unknown`: the publish request was accepted
  or may have completed, but two exact-hash status/readiness checks or the local
  receipt handoff could not prove the final cloud state. The locally validated
  candidate remains canonical and the status records its `bundleSha256` and
  `dealerMailSha256`. Do not start another capture or publication. Compare that
  exact bundle hash with the protected `/internal/status` and
  `/internal/readiness` responses through the existing owner-authorized
  verification procedure, then either finish the receipt/follow-ups for that
  candidate or document that a different verified release superseded it.
- `publish_failed_last_verified_release_preserved` or
  `intraday_refresh_failed_last_verified_release_preserved`: no matching new
  receipt was written and the canonical local files were restored.
- `failed_receipt_bound_source_validation`: a supposedly unchanged public,
  resource, or manager input no longer matches the verified receipt; operator
  review is required rather than silently broadening the refresh.

## Windows scheduled tasks

All scheduled tasks are registered for the automation account with logon type **Interactive**: they
run while Joe is logged on (a locked screen is fine; a full log-off or a reboot
to the login screen is not). To run logged-off, open Task Scheduler, tick
*Run whether user is logged on or not*, and enter the Windows password. DPAPI
keeps working in that mode. Only Joe can do that step.

### BobMaxey-InventoryFlow-DailyPublish

- Action: `scripts\daily-cloud-publish.ps1 -WorkspaceRoot <reporting-workspace>`
  (cwd `apps\inventory-ops`). The explicit root is required when the app folder
  is a Windows junction.
- Trigger: daily 09:15, repeat every 30 min for 6 h (last slot 15:15). Covers
  the 9:15/9:45/10:15/10:45 cadence in the Cloudflare runbook and keeps going
  as insurance.
- Report date: `-ReportDate`, else the newest `work\inventory-history\snapshots\*-public.json`.
- Idempotent: once `work\app-feed-status\{date}.json` shows
  `published_and_verified`, it does not scrape or republish unless the completed
  dated manifest now binds a manager-disposition overlay whose SHA is absent or
  different in that receipt. That one drift case rebuilds through this protected
  Windows publisher so a manager log added after the first publish is not silently
  missed. Otherwise it refreshes the safe hash/count-only integration expectation,
  runs the authenticated read-only REST plus OAuth/MCP discovery smoke test, and
  exits `SKIPPED (already current)`. `-Force` remains an operator-only republish.
- Photo cache: tries `build_photo_cache.py --reuse-snapshot-resources` first.
  Falls back to a fresh VDP extraction ONLY on a clean zero (snapshot has no
  embedded resources). A non-zero exit from the reuse path aborts with
  `PHOTO_CACHE_REUSE_FAILED` rather than overwriting anything, per the
  runbook's "never overwrite manually recovered resources" rule.
- Then `sync-cloud-release.mjs`: build, validate, encrypt, publish, re-verify
  against `/internal/status` and `/internal/readiness`. Finally it verifies the
  same report date, bundle hash, total and all four store counts through the
  private integration API and verifies protected OAuth discovery/PKCE for MCP.
- After every verified publish it runs the guarded latest-pointer helper and
  records the verified receipt hash/time plus `latest_pointers_advanced: true`
  back into the dated manifest. This removes the former manual post-publish step.
- Log: `work\app-feed-status\auto-publish-{date}.log`. Secret VALUES are never
  written; only key names and counts.
- Re-register or change the schedule: edit and run
  `scripts\register-daily-publish-task.ps1 -WorkspaceRoot <reporting-workspace>`.
- Remove: `Unregister-ScheduledTask -TaskName BobMaxey-InventoryFlow-DailyPublish`

Error codes the log can end with, and what they mean:

| Code | Meaning | Clears itself? |
|---|---|---|
| `Traceback (most recent call last)` | `build_photo_cache.py` raised before the cache step - on 09/12/2026 the cause was its manifest gate, `No completed dated run manifest was found` (the 07:37 run had skipped DealerMail, so `work\run-status\{date}.json` was not `complete`) | Yes, once the manifest is completed |
| `SOURCE_NOT_CURRENT` | Day's public+DealerMail release not complete yet | Usually, on a later retry |
| `PHOTO_CACHE_FAILED` | Fresh VDP extraction failed | Retry; check dealer sites |
| `PHOTO_CACHE_REUSE_FAILED` | Embedded resources exist but failed validation; refused to overwrite | **No** - needs a person |
| `CLOUD_PUBLISH_FAILED` | `sync-cloud-release.mjs` exited non-zero; the real code is in the log line above it (`PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW`, `HOLD_REFRESH_SOURCE_BINDING_MISMATCH`, `CLOUD_*_MISMATCH`, `CLOUD_NOT_READY`) | Depends on the inner code |
| `HOLD_REFRESH_SOURCE_BINDINGS_REQUIRED` | A hold-only publish was invoked outside the receipt-bound intraday orchestrator. Nothing was published. | Run the existing intraday scheduled task instead |
| `HOLD_REFRESH_SOURCE_BINDING_MISMATCH` | One of the public, DealerMail, resource, or manager hashes changed after the intraday candidate was built. Nothing was published. | No - inspect the named source lane |
| `CLOUD_PUBLICATION_OUTCOME_UNKNOWN` | The release POST was attempted and may have been accepted, but its response was lost/malformed or two exact candidate-hash status/readiness checks did not establish the final cloud state. The validated candidate and its exact POST-envelope hash are retained. | No - reconcile the recorded candidate hash before any new capture or publish |
| `CLOUD_PUBLICATION_VERIFIED_RECEIPT_NOT_RECORDED` | The exact candidate was verified in cloud, but its local app-feed receipt could not be written. The orchestrator treats this as reconciliation-required rather than rolling back or claiming the prior release stayed live. | No - repair local receipt storage and reconcile the recorded candidate hash |
| `CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED` | The new hold release and matching receipt are already published, but integration verification, latest-pointer advancement, or archiving failed. The candidate remains canonical. | Retry the existing intraday task; do not recapture other sources |
| `POST_PUBLISH_STATE_RECORD_FAILED` | Cloud publication and publisher follow-ups completed, but the orchestrator could not finish its local manifest/status recording. The published candidate remains canonical. | Retry the existing intraday task; inspect local disk/status-file errors if it persists |
| `PUBLICATION_NOT_VERIFIED` | The bundle did not pass the stricter Cloudflare validator, so nothing verified. Real causes seen: (1) the manifest is not `complete: true`, or (2) `dealermail_snapshot_path` points at the `-deep.json` instead of the `-deep-cloud-ready.json` - i.e. `finalize_cloud_snapshot.mjs` was skipped, so every row is missing the dual 22-cell arrays (`rawCellInnerText` / `rawCellControlValues`) and the `excludeActiveHoldsValidationSet`. 09/12/2026: 10:43 and 10:45 failed this way; 10:47 succeeded two minutes after finalize ran | Yes, once finalize has run and the manifest names the cloud-ready file |
| `INTEGRATION_VERIFICATION_FAILED` | The main release is published, but the private REST API or protected OAuth/MCP discovery did not return the same hash, total and four store counts. The publisher preserves the verified release and retries this read-only check later. | Often; deploy the current integration Worker if a new validated release schema was added |
| `INTEGRATION_CREDENTIAL_MISSING` | The owner-only local development verification key is missing, so the task cannot prove an authenticated API read. The release and cloud access controls are not weakened. | No - restore or replace the scoped key through the owner provisioning workflow |
| `SECRET_STORE_MISSING` | `runtime\cloud-secrets\publisher.dpapi` missing | No |

Never delete `work\app-feed-status\.publication.lock` to force a run. See the
Cloudflare runbook's lock rules.

### BobMaxey-AutomationBrowser

- Action: `scripts\start-automation-browser.ps1` (hidden PowerShell window).
- Trigger: daily 00:05, repeat every 15 min for 23h45m. (An at-logon trigger
  needs elevation to register, so the 15-minute watchdog covers logon instead.)
- Launches **Perplexity Comet** (`comet.exe`, found under
  `%LOCALAPPDATA%\Perplexity\Comet` or Program Files) with
  `--user-data-dir=%LOCALAPPDATA%\BobMaxeyAutomation\CometProfile`,
  `--remote-debugging-port=9222` (bound to 127.0.0.1 only - that is what the
  keeper talks to), `--restore-last-session`, minimized, with the DealerMail
  inventory grid open. Idempotent only when both the isolated profile processes
  and the localhost CDP endpoint are healthy. Leftover renderer processes with
  a dead CDP endpoint are stopped and relaunched automatically. `-Restart` forces
  the same profile-only relaunch.
- Log: `%LOCALAPPDATA%\BobMaxeyAutomation\automation-browser.log`
- Why Comet and not Chrome: this PC's IT policy sets
  `HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist = *` with a
  3-ID allowlist, and Microsoft Edge is locked down identically, so the Claude
  in Chrome extension cannot be installed in ANY Chrome or Edge profile here.
  Comet is Chromium with no policy key at all, so extensions install normally.
  The old Chrome launcher has been removed from the repo; do not switch back.
- Purpose: a browser Joe never works in, so nothing he does during the day
  (closing tabs, restarting his own Comet, logging out of sites) can disturb
  the sessions the pipeline depends on. It has its own cookies, saved logins and
  extensions.

State as of 09/12/2026: the Claude in Chrome extension is installed in that
profile and the browser is registered to Joe's Claude account as **"Work PC
Automation Browser"**, deviceId `<automation-browser-device-id>` (a placeholder
the operator fills in with the real deviceId). The daily task selects it by that
deviceId and never acts in any other connected browser (the others are Joe's
personal ones, two of them on a Mac). DealerMail, vAuto/Provision and FMCDealer
are signed in inside it; Comet holds those credentials in this profile's own
password store. If DealerMail or FMCDealer expires, Joe signs in again in that
window - nothing else ever logs in.

Do NOT try DealerMail in Claude's built-in browser pane: tested 09/11/2026, it
is bounced back to the login screen. DealerMail sits behind Cloudflare bot
management (`cdn-cgi/challenge-platform` JSD) and binds sessions to a trusted
device fingerprint; the login form also posts into a named popup window
(`target="newLogIn"`) the pane cannot show. The automation Comet is the trusted
device.

### BobMaxey-DealerMailKeeper

- Action: `%USERPROFILE%\AppData\Local\OpenClaw\deps\portable-node\node.exe scripts\keep-dealermail-alive.mjs --workspace-root <reporting-workspace>`
  (cwd `apps\inventory-ops`). The explicit workspace protects snapshots and
  status files when the app folder is reached through a Windows junction.
- Trigger: registered 09/12/2026 11:50 as a one-shot that repeats every 10 min
  for 3650 days, i.e. indefinitely.
- What it does: connects to the automation Comet over the Chrome DevTools
  Protocol on `127.0.0.1:9222`, ensures read-only tabs exist for DealerMail,
  FMCDealer/OASIS and Ford invoices, and runs one service-specific authenticated
  probe inside each tab. It also uses vAuto's own read-only session ping. The
  browser makes requests with its own session; the script reads no cookies and
  no credentials, stores no protected data, and never logs in. Because it does
  not rely on an in-page timer it survives Comet restarts.
- Expected tabs: three persistent keeper tabs (DealerMail, OASIS, and Ford
  invoices). The vAuto API ping reuses an existing vAuto tab when available; if
  it must create one, the ping closes only that script-owned tab afterward.
- Output: `work\app-feed-status\dealermail-keeper.json` with a separate status
  for `dealermail`, `fmcdealer`, `fordvisions`, and `vauto`, plus one line per run appended to
  `work\app-feed-status\dealermail-keeper.log`.
- Exit codes: 0 = every required service is `OK` (or deliberately `SKIPPED`
  because there is no Ford worklist). 1 = `ATTENTION`; read the per-service
  status. Each service is checked by its real signature: DealerMail's
  `Session Ended` body and grid function, FMCDealer's OASIS result and SSO
  bounce, Ford invoice PDF/legitimate refusal after MSAL renewal, and vAuto's
  authenticated endpoint. `SESSION_EXPIRED` means Joe signs into only the named
  service in the Work PC Automation Browser.
- Remove: `Unregister-ScheduledTask -TaskName BobMaxey-DealerMailKeeper`

## DealerMail session keeper

DealerMail's timeout is activity-based. Two keepers now overlap on purpose:

1. **Durable (authoritative):** the `BobMaxey-DealerMailKeeper` task above,
   every 10 minutes over CDP. Check `dealermail-keeper.json`; `OK` means the
   session is alive right now.
2. **In-page (belt and braces):** the daily task's STEP 3.5 still sets a
   `window.__bmKeeper` interval in the DealerMail tab that does the same
   credentialed no-store fetch every 4 minutes and logs `[BMKEEPER] ping#N`.
   It dies if that tab is navigated, reloaded or closed, which is exactly why
   the Windows task exists.

Neither ever logs in or touches credentials. `SESSION_EXPIRED` means Joe has
to sign in to DealerMail in the automation Comet again; the next keeper run
turns `OK` by itself.

## The daily Cowork task, step by step

The authoritative prompt is `outputs\bob_maxey_task_prompt_2026-09-14.txt`. It runs
unattended, never asks a question, and records anything undecidable in the
manifest warnings. In order:

| Step | What it does | Notes |
|---|---|---|
| 0 Idempotency | If `work\app-feed-status\{date}.json` is already `published_and_verified`, message Joe the counts and stop. | |
| 1 Browser | `list_connected_browsers`, then `select_browser` deviceId `<automation-browser-device-id>` ("Work PC Automation Browser"). If absent, run `start-automation-browser.ps1`, wait 60 s, retry once; if still absent, skip every browser step (3, 3.7, 3.8, 7) and still finish 2/4/5. | Never picks another browser, never uses Chrome. |
| 2 Public inventory + resource enrichment | Produces `snapshots\{date}-public.json` and the base workbook. AutoCheck, photos and window stickers come from the dealer VDP/API feeds. | Ford placeholder PDFs ("not yet been released") are labelled `not_released_by_ford`, not failures. |
| 2.5 Vehicle Resources | `python work\add_resources_sheet.py --report-date {date}` | Run, do not edit. |
| 3 DealerMail capture | `node apps\inventory-ops\scripts\capture-dealermail.mjs run {date} --budget-ms 900000` performs the complete read-only grid, exclude-holds, live-holds, detail, comment/alert and CDK capture over localhost CDP and writes the five raw files the existing builder consumes. | Never submits, holds, releases or comments. `SESSION_EXPIRED` is detected from DealerMail's actual `Session Ended` signature, not a password field. |
| 3.2 Build + finalize snapshot | `node build_v2_snapshot.mjs {date}` **from `work\`** (its paths are cwd-relative) -> `-complete-used-inventory-deep.json`, must print `VALIDATION PASSED`. Then `node work\finalize_cloud_snapshot.mjs {date}` **from the workspace root** -> `-deep-cloud-ready.json`. | **New 09/12.** Finalize is REQUIRED: it adds the dual 22-cell arrays and the exclude-holds validation set the Cloudflare validator demands. Skipping it = `PUBLICATION_NOT_VERIFIED`. The manifest must name the CLOUD-READY file. |
| 3.5 Session keeper | Arms the in-page `window.__bmKeeper` (see above). | Belt and braces; the Windows task is the real keeper. |
| 3.7 Ford OASIS | `node apps\inventory-ops\scripts\capture-oasis.mjs run {date} --budget-ms 1800000` captures read-only Ford/Lincoln build, warranty and field-service-action data over localhost CDP. | Prior-owner names on extended-coverage blocks are NEVER captured - category and expiration only. |
| 3.8 Ford invoice | `node apps\inventory-ops\scripts\capture-invoices.mjs run {date} --budget-ms 1800000`, then `extract_invoice_text.py` and `parse_ford_invoice.py`, captures entitled invoice PDFs and printed fields. | "Document Type is not retail" and "VIN not found" are normal per-VIN outcomes. The script performs the required Entra/MSAL navigation handshake without entering credentials. |
| 4 Workbook | If DealerMail was captured: `python work\merge_dealermail.py {date}` -> `work\staging\{date}-with-dealermail.xlsx`, copied over `outputs\Bob_Maxey_Used_Inventory_{date}.xlsx`. Either way: `python work\tidy_workbook.py --workbook ...`. | If DealerMail was skipped the workbook stays 10-sheet and the manifest says so. `add_oasis_sheet.py` / `add_invoice_sheet.py` add the optional trailing Ford OASIS / Ford Invoice sheets - run them here, before the file is hashed. |
| 5 Validate | 13-sheet: `final_check12.py <xlsx> work\run-status\{date}.json`; 10-sheet: `final_check.py <xlsx>`. Always `excel_open_test2.ps1 -Path <xlsx>`. | Run, do not edit. Fix the DATA, not the validator. |
| 5.5 Complete the manifest | Real counts, `dealermail_snapshot_path` = cloud-ready file, `final_workbook_sha256/bytes/sheets`, evidence, `"complete": true`. | The publish gate refuses an incomplete manifest - the single most common cause of a failed morning. |
| 6 Publish: verify only | Read `app-feed-status\{date}.json` and `auto-publish-{date}.log`; report the code. May `Start-ScheduledTask BobMaxey-InventoryFlow-DailyPublish` once if the manifest completed after the last slot. | Never runs the publish, never touches secrets, never removes the lock. |
| 3.95 vAuto Factory Equipment (API) | `python work\build_vauto_worklist.py --report-date {date}` then `node apps\inventory-ops\scripts\vauto-factory-equipment.mjs run work\vauto-history\worklist-{date}.json work\vauto-history\{date}-factory-equipment.json`. Every feed VIN not already OK, any make; ~0.2 s per VIN; resumable. | **Rewritten 09/12 (PM).** No form, no clicks, no popup, nothing on screen: the script calls vAuto's own `factoryequipment/WindowStickers/{VIN}` endpoint from inside the authenticated tab. `[]` = `NO_BUILD_DATA` (Euro/import makes), re-checked after 7 days. `SESSION_EXPIRED` = sign in to vAuto again in the automation Comet. The daily publish task runs this same pair as its Step 1.4, so the Cowork run is a second, harmless pass. |
| 7 (removed) | The old vAuto appraisal-form driver was deleted. `--ui` is rejected before browser access. | Only the read-only Factory Equipment API path is supported. |
| 8 Finish | Message Joe: public / DealerMail / held counts, publish status, failures and why, vehicles needing manual review; attach the workbook. Dates MM/DD/YYYY. | A VIN that dropped off the public feed is a Removed change, not active inventory. |

Public VDP links are still checked daily. An exact-VIN original sticker whose
URL and validated current facts match the prior completed snapshot reuses
those facts instead of downloading the same PDF again. AutoCheck remains a
fresh daily check because service evidence can change.

Two things happen alongside the prompt rather than inside it:

- **Manager disposition overlay.** When the manager's handwritten monthly
  sold/delivered log arrives (transcribed to `work\sold-delivered\{date}.csv`),
  `python work\ingest_sold_delivered.py --report-date {date} --csv ...` writes
  the allow-listed `work\manager-supplied\sold-logs\{YYYY-MM}-{store}-operational.json`
  (the only file the pipeline reads), the local-only `-restricted.json`, and
  binds `manifest.manager_disposition_overlay` (path + sha256 + counts). It
  runs the pipeline's own sanitizer and manifest-bound loader via
  `ingest_sold_delivered_helper.mjs`, never publishes, and backs the manifest
  up first. Pink/highlighted rows are explicit manager evidence that delivery
  is complete; unhighlighted rows remain sold / delivery pending even when a
  handwritten date is present. The app's active view removes a delivered VIN
  only when the log row named that exact VIN, without deleting its public/CRM
  audit evidence, and never revives a VIN that has left both source feeds. A
  row without a VIN matches only a unique stock number the reporting store
  itself lists; such a delivered row, like a pending row without a verified
  VIN, stays in inventory as a high-priority identity-review alert and is never
  silently removed or called delivered. The publish receipt's
  `managerDeliveredListedExclusionCount` (and the Node `/api/health`
  `managerDeliveredHiddenWhileListed` count) reports VINs hidden by the log
  while the public feed still lists them. Re-run the protected daily publisher
  after ingest so the redacted overlay and active membership reach the app/API.
- **Baseline pointer advance.** See the next section. Run it after
  `published_and_verified`; it is not yet in the prompt as of 09/12/2026 -
  add it as STEP 6.5.

## Baseline pointers and the Daily Changes sheet

`work\inventory-history\latest.json` and `work\dealermail-history\latest.json`
are not small pointer files: each is a byte-for-byte copy of the last
validated snapshot (public schema `bob-maxey-public-inventory-snapshot-v2`
with a `vehicles` dict keyed by VIN; DealerMail
`dealermail-used-holds-and-complete-inventory-v2`). The public one is the
"prior day" that `run_public_inventory_only.py` / `inventory_report.build_changes()`
diff tomorrow's scan against, and the DealerMail one is what
`run_manager_daily_build.source_preflight` requires to be strict-complete and
older than the report. The app server never reads them - it works from the
dated manifests and the snapshots folder.

Only `publish_validated_daily_report.py` advanced them, and it last ran on
09/10/2026. The 09/11 and 09/12 runs completed outside it, so both pointers
stayed on 09/10 and the Daily Changes sheet kept diffing against 09/10 -
that is why changes were accumulating (62 events on 09/12 were 09/10 -> 09/12,
not one day). Joe's decision 09/12/2026: advance them daily.

`python work\advance_latest_pointer.py --report-date {date} [--dry-run]`
advances BOTH to that day's validated files (`{date}-public.json`;
`{date}-complete-used-inventory-deep-cloud-ready.json`, or `-deep.json` if the
cloud-ready file is missing) only when `work\run-status\{date}.json` is
`complete: true` AND `work\app-feed-status\{date}.json` is
`published_and_verified`; it also checks the manifest paths, the app-feed
`sourceHashes`, and refuses to roll back to an older date. Otherwise it prints
why and exits 2, touching nothing. Each pointer is backed up first as
`latest.json.bak-{timestamp}`; before/after are printed. Run for real on
09/12/2026 at 12:22: both pointers now hold the 09/12 snapshots (226 vehicles;
30 held), so the next report's Daily Changes will be 09/12 -> 09/13 only.

## Scripts changed or added

### 09/11/2026

| Path | Change |
|---|---|
| `work\add_resources_sheet.py` | Now parameterized (`--report-date`, `--workbook`, `--snapshot`, `--output`); defaults to in-place. Picks the snapshot that actually contains enrichment; exits `RESOURCE_ENRICHMENT_EMPTY` rather than writing blank rows. Adds **MI Plate Base Price** as column H (the Monroney BASE PRICE line, as printed, before options and destination - the Michigan plate-fee basis). Dates are real Excel date cells formatted `mm/dd/yyyy`. |
| `work\finalize_audited_report.mjs` | Data Quality "Report date" cell displays MM/DD/YYYY. |
| `work\build_vin_document_enrichment.py` | NEW, dormant. Generates `data\vin-document-enrichment.json` `factoryEquipment` records from parsed stickers. Valid on both validators, but the Inventory Flow UI only renders factory equipment when it carries a vAuto/CAI image URL, so URL-less records count toward `resourceRecordCount` without displaying. Joe reverted the data file to the original single record on 09/11/2026 (backup: `work\vin-document-enrichment.backup-2026-09-11.json`). Re-enable only once the vAuto capture supplies real CAI URLs. |
| `apps\inventory-ops\scripts\daily-cloud-publish.ps1` | NEW. See above. |
| `apps\inventory-ops\scripts\register-daily-publish-task.ps1` | NEW. Registers the publish task. |
| `work\vauto-factory-options-worklist-2026-09-11.csv` | NEW. 92 VINs (46 with no sticker at all, 46 with a link the Ford parser cannot read) for the vAuto step. Superseded in practice by STEP 3.8 invoices + STEP 7. |
| `work\tidy_workbook.py` | NEW. Last cosmetic step before validation. Collapses 28 plumbing columns on Master Inventory + store sheets into outline groups (16 visible), collapses Photo URLs on Vehicle Resources, currency/thousands formats, tab colors, hides Data Quality + Hold Detail History (still present, still validated), Dashboard opens first. Validator-safe by construction: no sheet or column added/removed/moved, no value changed. **Never add a sheet-level AutoFilter to Master Inventory or the store sheets** - they are Excel Tables and the overlap makes Excel refuse the file (bisected and proven 09/11/2026). Proven: Excel COM opens the result with no repair. |

### 09/12/2026

| Path | Change |
|---|---|
| `apps\inventory-ops\scripts\start-automation-browser.ps1` | Rewritten for Comet (see the task above); adds `--remote-debugging-port=9222`. Old version removed from the repo. |
| `apps\inventory-ops\scripts\keep-dealermail-alive.mjs` | NEW. Durable DealerMail keeper: one credentialed grid fetch inside the authenticated Comet tab over CDP on 127.0.0.1:9222, every 10 min from the Windows task; writes `dealermail-keeper.json` + `.log`; exit 1 = `SESSION_EXPIRED`/`ERROR`. Reads no credentials. |
| `apps\inventory-ops\scripts\dryrun_manager_disposition_check.mjs` | NEW. Dry-run oracle: loads the release through the REAL importer (manifest gate + the exact manifest-bound `*-operational.json` loader), builds the same cloud bundle `publish-cloud-release.mjs` builds, runs the real `validateReleaseBundle`, prints the manager-disposition counts. `node scripts\dryrun_manager_disposition_check.mjs [date]`. Never publishes. |
| `work\build_v2_snapshot.mjs` | Now takes the report date as argv[2] (was hardcoded to 09/11). Builds the v2 DealerMail snapshot from the three raw captures and validates it with the real `importer.mjs validateDealerMailSnapshot()`. Its data paths are relative to the cwd: **run it from `work\`**. |
| `work\finalize_cloud_snapshot.mjs` | Now takes the report date as argv[2]. Adds the dual 22-cell `rawCellInnerText` / `rawCellControlValues` arrays from `-complete-list-raw-cells.json`, the `excludeActiveHoldsValidationSet` and `crmInventoryControlValidation` totals that `release-validation.mjs` requires; throws on any 22/22 or hold-state mismatch. Paths are relative to the workspace root: **run it from there**. |
| `work\merge_dealermail.py` | Now takes the report date as argv[1] (was hardcoded). Reads the published public workbook + `-complete-inventory-raw` + `-hold-details-raw`, adds DealerMail Inventory / Hold Reconciliation / Hold Detail History to `work\staging\{date}-with-dealermail.xlsx`. Dates are real Excel dates formatted `mm/dd/yyyy`. |
| `work\excel_open_test2.ps1` | Now requires `-Path` (was hardcoded). Opens the workbook in real Excel COM, reports sheet count/names, VBProject absence, and SHA-256 before/after open+close. |
| `work\final_check12.py` | Takes the workbook as argv[1] and the manifest as optional argv[2] (else located from the date in the filename). Expects the 13-sheet list as an exact prefix; Ford OASIS / Ford Invoice may trail. Cross-checks Master Inventory vs `public_unique_vins`, Hold Reconciliation vs `active_held_vins` and vs the grid's Hold Status column. No day-specific numbers inside. |
| `work\final_check.py` | Same for the 10-sheet (DealerMail-skipped) workbook: argv[1] only; optional trailing Ford OASIS / Ford Invoice allowed. |
| `work\parse_ford_invoice.py` | NEW. Parses the pypdf text of Ford/Lincoln dealer invoices into structured JSON **as printed** - nothing computed; unrecognised = null; `NC` = no charge. `--report-date` writes `work\invoice-history\{date}\parsed.json`; also importable (`parse_invoice_text`). Handles the layout variations seen 09/12. |
| `work\add_oasis_sheet.py` | NEW. `--report-date` (+ optional `--workbook/--oasis/--worklist/--snapshot/--output`). Adds/replaces the trailing "Ford OASIS" sheet from `oasis-history\{date}-oasis.json`, in place by default; run before the file is hashed. Reads only allow-listed vehicle fields - never an owner/customer column. |
| `work\add_invoice_sheet.py` | NEW. `--report-date` (+ same optionals, `--invoices`). Adds/replaces the trailing "Ford Invoice" sheet from `invoice-history\{date}\parsed.json` (parses on the fly if missing); every worklist VIN gets a row, with the reason when no invoice was retrievable. In place by default; run before hashing. |
| `work\ingest_sold_delivered.py` + `work\ingest_sold_delivered_helper.mjs` | NEW. Ingests the manager's sold/delivered CSV into the manager-disposition channel (operational + restricted JSON, manifest binding, timestamped manifest backup). The helper runs the pipeline's own sanitizer (`sanitize`) and the real manifest-bound loader (`verify`); exit 2 on rejection. Nothing here publishes. |
| `work\advance_latest_pointer.py` | NEW. See "Baseline pointers" above. |

Git: only `apps\inventory-ops` is a repository; `work\` is not under version
control. The old Chrome launcher has been removed from the repository, and as
of this writing the Comet launcher edit, `keep-dealermail-alive.mjs` and
`dryrun_manager_disposition_check.mjs` are uncommitted there - commit them when
convenient so a `git checkout .` cannot wipe them.

## Known data facts (verified 09/12/2026)

- Window-sticker "failures" are mostly Ford placeholder PDFs that read "The
  window sticker has not yet been released for this vehicle." That is Ford not
  having published the Monroney yet, not a parser bug. They are labelled
  `not_released_by_ford`; do not "fix" the parser for them. 09/12: Fowlerville
  44 of 46 sticker links were this.
- The dealer-site sticker path is **Ford/Lincoln only** (`parse_window_sticker_text`
  parses Ford/Lincoln Monroney facts; DealerMail's button is `openFordSticker`).
  Every off-brand trade falls through it.
- Ford invoices are entitlement-gated per VIN: "Document Type is not retail"
  (units this dealer did not retail) and "VIN not found in our system" (older
  units) are normal, not retryable. Hit rate about 70% (131 of 179 on 09/12).
- OASIS extended-coverage pages contain the **prior owner's name**. It is never
  captured, stored, published or messaged - coverage category and expiration
  only. `add_oasis_sheet.py` reads an allow-list of vehicle fields for the same
  reason.
- vAuto/Provision *Factory Equipment* is captured through vAuto's own
  WindowStickers API (see below), no UI involved; most European and some
  import makes have no build data (`NO_BUILD_DATA`). Never save an appraisal.
- AutoCheck is already fully captured through the dealer VDPs (226 of 226 on
  09/12) via `publicRecord`. No further AutoCheck work is needed. DealerMail's
  own AUTOCHECK button opens whatever report is loaded in the dealership's
  shared seat, not the row's VIN (tested: clicked one row and got an unrelated
  vehicle's report) - not safe to automate.
- `resourceRecord.autoCheckReport.url` must be a canonical `autocheck.com`
  report link and `factoryEquipment.url` must be an `assets.cai-media-management.com`
  image. Dealer-hosted proxy links never pass, by design. Do not widen either
  validator; those two `resourceRecord` fields are a separate, narrower channel
  from `publicRecord`.
- One 2025 Aviator Reserve: feed MSRP $29,995 is a DealerOn error;
  sticker MSRP is $78,630. Preserved and flagged in Data Quality, not corrected.
- ~40 Ford stickers overstate *Total Options* by the package discount. Base
  price and total MSRP are correct as printed. Left alone at Joe's request.
- The 09/12 published workbook is the 13-sheet build (the hash recorded in
  the publish receipt); the Ford OASIS and Ford Invoice sheets were written
  after that publish and first ship with the next run.

## vAuto / Provision factory equipment (STEP 3.95 of the daily task, and Step 1.4 of the publish)

What the *Factory Equipment* button actually does is one authenticated GET to
`https://slot1.bff.megazord.vauto.app.coxautoinc.com/api/factoryequipment/WindowStickers/{VIN}`
carrying three identity headers whose values are the tab's own cookies
(`caPlatformUserId` -> `platformuserid`, `CurrentEntity` -> `currententityid` and
`appraisalentityid`). The response is `[{type:"JPG",resourceUrl:<CAI jpg>},{type:"PDF",
resourceUrl:<CAI pdf>}]`, or `[]` when vAuto has no build data. So
`scripts\vauto-factory-equipment.mjs run` makes that call from inside the
automation Comet's vAuto tab for every feed VIN not already captured - no
appraisal form, no VIN entry, no Go, no popup, nothing on screen, ~0.2 s per
VIN (216 of 226 on 09/12; the 9 misses are VW/Honda/Audi/Land Rover/BMW-type
units with no build data). It never creates, opens, saves or finalizes an
appraisal. `SESSION_EXPIRED` (HTTP 401 "Entity and/or User is Null.") means
sign in to vAuto again in the Work PC Automation Browser; the 10-minute keeper
task also pings this endpoint and logs `vauto=SESSION_EXPIRED` in
`work\app-feed-status\dealermail-keeper.log` the moment it happens.

`work\build_vauto_worklist.py --report-date {date}` builds the worklist from the
day's public snapshot: every VIN, any make, minus VINs OK in any prior capture
(CAI URLs are stable) and minus `NO_BUILD_DATA` VINs checked in the last 7 days.

`scripts\cache-vauto-equipment-pdfs.py` keeps one content-hashed, VIN-linked
printable PDF under `work\vauto-documents\objects\` and an index at
`work\vauto-documents\index.json`. A dated VIN-to-hash snapshot under
`work\vauto-documents\snapshots\` is copied into the historical reporting
archive; the content-addressed PDF objects remain in the controlled cache.
The approved vAuto PDF is preferred; a
JPEG-only source becomes a labeled printable PDF. A confirmed 404 is recorded
and skipped for the rest of that report day; a transient connection error can
retry. These are informational vAuto equipment references, never verified
original stickers. The Windows publisher stages active VIN PDFs in private R2
only when `runtime\vauto-pdf-enabled.flag` exists after the Worker endpoint is
deployed and verified. A staging failure blocks the new release and leaves the
last verified release in place. The PDF cache is a best-effort source capture;
its individual failures do not convert missing documents into current data.

The old appraisal-form UI path has been removed. Passing `--ui` fails before
browser access; the capture supports only the read-only Factory Equipment API.

## Remaining factory warranty (STEP 1.45 of the publish; `capture-warranty.mjs`)

Answers the question a salesperson actually asks: *how much factory warranty is left
on this car right now?* One row per coverage, figured at that vehicle's own listed
odometer.

Two sources, in priority order:

1. **Ford OASIS** (Ford/Lincoln only, authoritative). Fetched through the already
   authenticated FMCDealer tab in the automation browser and parsed server-side.
   Supplies the real **WARRANTY START DATE** (the in-service date), **MONTHS IN
   SERVICE**, and each coverage's printed term ("3 years / 36,000 Miles (whichever
   occurs first)").
2. **Experian AutoCheck** (every make, estimate). The dealer report page carries the
   whole Warranty Check table in its HTML - `data-warranty-age` (months in service),
   `data-default-mileage`, and per row `data-warranty-miles` / `data-warranty-months`.
   The "Enter Mileage -> Show My Coverage" button is **pure client-side arithmetic**
   (`recalculateWarrantyTable()` in `autocheck.com/reportservice/report/fullReport/js/main.js`),
   so the script reproduces that function exactly against the real odometer. No
   browser, no clicking, no login - the report URL is already in the public snapshot.

**Why OASIS wins for Ford/Lincoln:** AutoCheck's term table is generic. On
one 2024 Escape it lists Basic as *60 months*, so it reports 45 months left; Ford's
actual bumper-to-bumper is 3yr/36k, so the true figure is **22 months**. Miles agree
(both cap at 36,000) but time does not. Quoting the AutoCheck number on a Ford would
overstate coverage by two years. Ford and Lincoln factory coverage transfers to the
next owner at no cost, which is what makes the remaining figure worth quoting at all.

Remaining time/miles are necessarily **computed** (term minus age, term minus
odometer); every term, date and months-in-service is carried through verbatim. Status
is ACTIVE / EXPIRED / N/A using AutoCheck's own expiry rules for both sources.

Output `work\warranty-history\{date}-warranty.json` ->
`build_vin_document_enrichment.py` attaches it as the `warrantyCheck` resource ->
"Remaining factory warranty" card in the vehicle workspace, and the **Warranty** sheet
in the workbook. The sheet no longer depends on a run remembering to call
`add_warranty_sheet.py`: `work\tidy_workbook.py` (STEP 4, unconditional) calls
`ensure_optional_sheets()`, which builds any of Ford OASIS / Ford Invoice / Warranty whose
capture exists but whose tab is missing. `final_check.py` and `final_check12.py` accept all
three as optional trailing sheets. Non-fatal everywhere: warranty figures never block a
publish.

**The session state is load-bearing - read it (fixed 09/14/2026).** FMCDealer bounces an
expired session to `login.microsoftonline.com`. That cross-origin SSO hop fails CORS, so the
in-tab `fetch` throws (`status: 0`, "Failed to fetch") and no body ever comes back to sniff
for a password field. Until 09/14 that path returned without setting a state, so an expired
session reported as `oasisSession: not_needed` - indistinguishable from "no Ford unit needed
OASIS" - and every Ford/Lincoln unit silently fell through to the AutoCheck estimate. That is
how 09/14 produced Ford/Lincoln units on AutoCheck terms behind a clean-looking status line.
Every response is now bound to the requested VIN and classified as `ok`, `no_record`,
`unparsed`, `session_expired`, or `browser_unavailable`. A Ford/Lincoln row is complete only
with a parsed OASIS factory record or a VIN-bound definitive no-record response. AutoCheck-only
Ford rows are `OASIS_UNAVAILABLE`, carry no publishable source label, remain retryable, and are
reported as `fordOasisPending: {n}`. Anything above 0 means sign in to FMCDealer in the Work PC
Automation Browser and run the next capture.

The Windows publisher is idempotent after a verified release: the next scheduled publish slot
will verify and exit before any capture step. To replace warranty evidence after that point,
run `capture-warranty.mjs ... --refresh` (or `--vin VIN` for an upsert), then explicitly run the
publisher with `-Force` so the rebuilt evidence is published and verified.

The warranty parser ignores the entire OASIS extended-service-plan block, whose layout can
contain prior-owner data. Only a closed vocabulary of factory coverage rows, strict printed
factory terms, VIN-bound dates, and FSA codes can enter this channel.

## Ford OASIS capture (`capture-oasis.mjs`, new 09/14/2026)

    node apps\\inventory-ops\\scripts\\capture-oasis.mjs run {date} [--max N] [--budget-ms N] [--refresh]

Like DealerMail, this was hand-run through `javascript_tool` every morning, which is why
09/13 and 09/14/2026 have no OASIS file at all. Read-only, inside the authenticated
FMCDealer tab over CDP. Builds `work\\oasis-vin-worklist-{date}.json` and writes
`work\\oasis-history\\{date}-oasis.json`. Resumable; `--refresh` recomputes.

**PRIVACY:** extended-coverage blocks carry the PRIOR OWNER'S NAME. This captures coverage
category and expiration date only - no owner name is ever parsed or stored.

**Parsing.** Once tags are stripped, a value runs straight into the next label
("...SERIES 00 PAINT COLOR: ..."). A lookahead for "next ALL-CAPS run + colon" does NOT
work: the caps class must allow spaces, so it bridges across the value and matches a colon
much further on - that truncated `2022 F-SUPER DUTY` to `2022` and `Oxford White WB C/C` to
`Oxford`. The script scans the known label set and takes each value as the text between its
own colon and the next label. Verified field-for-field against the 09/12 hand-run capture:
everything matches except two fields where the OLD capture was wrong (`engineCalibration`
was the artifact `AXLE CODE:8L`, `saleMileage` was the literal string `None`).

## Ford invoice capture (`capture-invoices.mjs` + `extract_invoice_text.py`, new 09/14/2026)

    node apps\\inventory-ops\\scripts\\capture-invoices.mjs run {date} [--refresh]
    python work\\extract_invoice_text.py --report-date {date}
    python work\\parse_ford_invoice.py --report-date {date}

**The SSO handshake is the whole trick.** fordvisions sits behind Entra/MSAL. A cold in-tab
`fetch` only returns the `msal-browser` HTML shell, and the site root answers `403 Forbidden`
even when signed in - so every prior run recorded "fordvisions unavailable" or a pile of
`FETCH_ERROR TypeError: Failed to fetch` (48 of them on 09/12/2026) and the day lost its
invoice data. NAVIGATING the tab once lets the MSAL javascript run and complete the silent
SSO against the live FMCDealer session (it lands on `/FordEntraDealer/callback.html`, then on
the real document). After that handshake, in-tab fetches return PDF bytes.

The capture first checks prior dated `work\invoice-history\` folders for a
parsed, exact-VIN invoice with a bounded, hash-checked PDF. It copies verified
PDFs into today's dated archive while preserving the original capture time;
only missing or damaged VINs enter the browser queue. If the queue is empty,
the Fordvisions tab and SSO handshake are not opened. `--refresh` deliberately
bypasses reuse. The release still stages date-scoped private R2 invoice copies
for its own VINs; local PDF reuse does not treat old source data as a fresh
verification of service readiness.

09/14/2026 result: 178 Ford/Lincoln VINs, 131 PDFs, 47 unavailable (38 "Document Type is not
retail", 9 "VIN not found"), **zero fetch errors**, 103 seconds. `extract_invoice_text.py`
writes the `{VIN}.txt` files `parse_ford_invoice.py` reads (PyMuPDF, falling back to pypdf).

## CDP_TIMEOUT means a wedged tab, not a dead browser

`Page.enable: CDP_TIMEOUT` killed the 09/14 morning vAuto step and later blocked OASIS. Port
9222 was listening and `/json/version` answered fine - the automation browser simply had a
stale tab whose renderer was wedged, and `getOriginTab` attaches to the FIRST tab matching the
origin. Closing that origin's tabs fixed it instantly (vAuto then finished in 2 seconds).
`capture-oasis.mjs` does this automatically on CDP_TIMEOUT and retries once. Manually:
list `http://127.0.0.1:9222/json`, `POST /json/close/{id}` for the stale tabs. Do NOT restart
the browser - that costs the logins.

## The baseline pointer survives a locked `latest.json`

`advance_latest_pointer.py` used `os.replace`, which needs delete rights on the destination.
Something local on the automation PC keeps an open handle on `work\\inventory-history\\latest.json`
that permits WRITES but blocks the delete a rename implies, so `os.replace` raised
`PermissionError/WinError 5` while the file was perfectly writable. That blocked the 09/14
advance even though the publish had succeeded, which would have left the next day's Daily
Changes diffing against a stale snapshot. (The workspace is NOT in a OneDrive sync root -
`Documents` is redirected, but this tree lives in the non-redirected `%USERPROFILE%\\Documents`
with no reparse point - so the holder is one of the local agents, not OneDrive.)
It now falls back to writing the bytes in place. Not atomic, but the temp file is byte-verified
against the source first and the existing post-write check re-verifies the pointer's date key
AND full sha256, so a torn write raises instead of being silently accepted. Verified on this
machine with a handle that shares read/write but not delete: rename raised WinError 5, the
fallback wrote, sha matched.

## DealerMail deep capture (`capture-dealermail.mjs`, new 09/14/2026)

For three days this was the only capture in the pipeline with no script - it was hand-run
through `javascript_tool` every morning. That is why a lapsed session cost a whole day
instead of producing a warning.

    node apps\\inventory-ops\\scripts\\capture-dealermail.mjs run {date} [--budget-ms N]

Everything happens inside the automation browser's already-authenticated DealerMail tab over
CDP (127.0.0.1:9222). Every request is a GET; it never submits a form, never places or
releases a hold, never adds a comment, and reads no credential. It writes the same five files
`build_v2_snapshot.mjs` already consumes, and emits one JSON line:
`{sessionStatus, rows, held, excludeView, reconciles, comments, alerts, cdk, holdsParsed}`.
`reconciles` is `rows - held === excludeView`; if it is false the capture is not trustworthy.

**Session detection, the whole point.** DealerMail does NOT return a login form when the
session dies. It returns HTTP 200 with a body reading "Session Ended - Please Refresh (F5)".
A status check or a password-field check calls that healthy. Authenticated here means all of:
no "Session Ended" text, `typeof showModels === 'function'`, and >100 rows of exactly 22 cells
after `showModels('ALL')`. Held rows are `onHold` - matching lowercase `onhold` with a
case-sensitive `includes` silently finds zero holds.

**Why this matters more than it looks.** No DealerMail capture means the manifest cannot be
`complete: true`; `build_photo_cache.py` then aborts with "No completed dated run manifest was
found" and the Cloudflare publish dies at step one. On 09/13 and 09/14/2026 that ran three
times a day and published nothing, while the app kept serving 09/12 - silently. Any morning
that skips DealerMail must say so as the FIRST line of the finish message.

## CRM / public drift is normal - `final_check12.py` no longer treats it as fatal

The DealerMail Inventory sheet is built straight from the CRM grid capture
(`merge_dealermail.py` iterates `dm_inv["rows"]`), so it is NOT a set reconciled to the public
feed, despite what the old comment claimed. The CRM and the public DealerOn feed drift: a unit
can be sold in the CRM before it leaves the website, or be entered before it is published.

`final_check12.py` asserted `dealermail_rows == master_rows` exactly. On 09/14/2026 an ordinary
three-VIN skew (two VINs public but not in the CRM and one in the CRM but no
longer public) made that fatal and blocked the publish,
while both captures had passed their own validators. It now prints `crm_public_drift:` and
fails only beyond `max(5, 2% of master)` - a real capture failure rather than operational skew.
Tighten the tolerance if the two systems are ever expected to agree exactly.

## Ford OASIS in the app - deploy gate

`build_vin_document_enrichment.py` only emits `fordOasis` blocks when
`apps\inventory-ops\runtime\oasis-enabled.flag` exists (or `--include-oasis` is
passed). The deployed Cloudflare Worker must carry `validateFordOasis()`
(`cloudflare/src/release-validation.mjs`) before that marker is created, or the
9:15 publish is rejected server-side with an unknown-key error. Order of
operations, once: `npx wrangler login --browser=false` (Joe authorizes in any
browser) -> `pnpm build` -> `pnpm cloud:validate` -> `pnpm cloud:deploy` ->
`New-Item apps\inventory-ops\runtime\oasis-enabled.flag` -> `daily-cloud-publish.ps1 -Force`.
Until then OASIS lives in the workbook sheet and `work\oasis-history\` only.

**Done 09/12/2026 (PM).** The OASIS-aware Worker is deployed (version
`0ebf1f83-54e9-4835-a733-e0e96dd16949`), the marker exists, and the release published
and verified with 179 OASIS records / 99 units carrying open recalls. The same deploy
carries `validateWarrantyCheck()`, so the warranty channel above needs no further gate.

## Standing rules from Joe

- Every date a human reads (messages, workbook cells, report text): MM/DD/YYYY
  or MM/DD/YY. File names and JSON keys stay ISO.
- Read values as printed on the source document; never calculate, derive or
  infer a price, MSRP, option total or fee.
- Never store or type his credentials. He signs in himself, in the automation
  Comet; it saves them. Nothing in the pipeline logs in.
- Never fabricate or infer resource data to make a count look complete.
- Never save a vAuto appraisal.
- Never capture owner or customer names (OASIS, DealerMail comments, manager
  logs alike).
- Never run the Cloudflare publish from an AI session; never touch
  `.publication.lock`; never touch `work\app-feed-status\` by hand.
