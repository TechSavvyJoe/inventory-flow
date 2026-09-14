# Daily automation runbook (dt-4094)

Set up 09/11/2026, rewritten 09/12/2026 after the browser moved to Comet and
the DealerMail keeper became a Windows task. Companion to
CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md, which covers the publish mechanics; this
file covers *what runs, when, on which machine, and how to fix or undo each
piece*. Dates in this file are MM/DD/YYYY; internal file names and JSON keys
stay ISO on purpose (the pipeline matches on them).

## The morning, unattended

| Local time | What | Runs where | Owned by |
|---|---|---|---|
| 07:30 | Public inventory + resource enrichment, Vehicle Resources sheet, DealerMail deep capture + snapshot build/finalize, Ford OASIS, Ford invoices, workbook merge/tidy/validate, complete the manifest, verify (never run) the publish, vAuto backup, message Joe | Claude scheduled task `Bob Maxey Used Inventory - Daily Report`, prompt `outputs\bob_maxey_task_prompt_2026-09-12.txt` | Claude Cowork |
| 09:15, then every 30 min to 15:15 | Build/reuse resource cache, publish to Cloudflare, verify live | Windows task `BobMaxey-InventoryFlow-DailyPublish` | Task Scheduler |
| every 15 min, all day | Relaunch the isolated automation **Comet** if it is not running | Windows task `BobMaxey-AutomationBrowser` | Task Scheduler |
| every 10 min, all day | Ping the DealerMail grid inside the authenticated tab so the session never idles out | Windows task `BobMaxey-DealerMailKeeper` | Task Scheduler |

The Claude task never publishes. The publish is a production deploy and is
refused inside unattended AI sessions, so it lives in a Windows task that has no
such gate and runs as JoeGallant (which is what lets the DPAPI secret bundle
decrypt). The Claude task only *verifies* the publish by reading the receipt and
the Windows task's log, and may `Start-ScheduledTask` it once if the manifest
completed after the last scheduled slot.

## Windows scheduled tasks

All three are registered for JoeGallant with logon type **Interactive**: they
run while Joe is logged on (a locked screen is fine; a full log-off or a reboot
to the login screen is not). To run logged-off, open Task Scheduler, tick
*Run whether user is logged on or not*, and enter the Windows password. DPAPI
keeps working in that mode. Only Joe can do that step.

### BobMaxey-InventoryFlow-DailyPublish

- Action: `scripts\daily-cloud-publish.ps1` (cwd `apps\inventory-ops`)
- Trigger: daily 09:15, repeat every 30 min for 6 h (last slot 15:15). Covers
  the 9:15/9:45/10:15/10:45 cadence in the Cloudflare runbook and keeps going
  as insurance.
- Report date: `-ReportDate`, else the newest `work\inventory-history\snapshots\*-public.json`.
- Idempotent: exits `SKIPPED (already current)` in under a second once
  `work\app-feed-status\{date}.json` shows `published_and_verified` for that
  date, so the extra slots cost nothing. `-Force` republishes.
- Photo cache: tries `build_photo_cache.py --reuse-snapshot-resources` first.
  Falls back to a fresh VDP extraction ONLY on a clean zero (snapshot has no
  embedded resources). A non-zero exit from the reuse path aborts with
  `PHOTO_CACHE_REUSE_FAILED` rather than overwriting anything, per the
  runbook's "never overwrite manually recovered resources" rule.
- Then `sync-cloud-release.mjs`: build, validate, encrypt, publish, re-verify
  against `/internal/status` and `/internal/readiness`.
- Log: `work\app-feed-status\auto-publish-{date}.log`. Secret VALUES are never
  written; only key names and counts.
- Re-register or change the schedule: edit and run
  `scripts\register-daily-publish-task.ps1`.
- Remove: `Unregister-ScheduledTask -TaskName BobMaxey-InventoryFlow-DailyPublish`

Error codes the log can end with, and what they mean:

| Code | Meaning | Clears itself? |
|---|---|---|
| `Traceback (most recent call last)` | `build_photo_cache.py` raised before the cache step - on 09/12/2026 the cause was its manifest gate, `No completed dated run manifest was found` (the 07:37 run had skipped DealerMail, so `work\run-status\{date}.json` was not `complete`) | Yes, once the manifest is completed |
| `SOURCE_NOT_CURRENT` | Day's public+DealerMail release not complete yet | Usually, on a later retry |
| `PHOTO_CACHE_FAILED` | Fresh VDP extraction failed | Retry; check dealer sites |
| `PHOTO_CACHE_REUSE_FAILED` | Embedded resources exist but failed validation; refused to overwrite | **No** - needs a person |
| `CLOUD_PUBLISH_FAILED` | `sync-cloud-release.mjs` exited non-zero; the real code is in the log line above it (`WRITER_LOCKED`, `PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW`, `CLOUD_*_MISMATCH`, `CLOUD_NOT_READY`) | Depends on the inner code |
| `PUBLICATION_NOT_VERIFIED` | The bundle did not pass the stricter Cloudflare validator, so nothing verified. Real causes seen: (1) the manifest is not `complete: true`, or (2) `dealermail_snapshot_path` points at the `-deep.json` instead of the `-deep-cloud-ready.json` - i.e. `finalize_cloud_snapshot.mjs` was skipped, so every row is missing the dual 22-cell arrays (`rawCellInnerText` / `rawCellControlValues`) and the `excludeActiveHoldsValidationSet`. 09/12/2026: 10:43 and 10:45 failed this way; 10:47 succeeded two minutes after finalize ran | Yes, once finalize has run and the manifest names the cloud-ready file |
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
  inventory grid open. Idempotent: exits immediately if a `comet.exe` with that
  profile dir is already running. `-Restart` kills and relaunches it.
- Log: `%LOCALAPPDATA%\BobMaxeyAutomation\automation-browser.log`
- Why Comet and not Chrome: this PC's IT policy sets
  `HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist = *` with a
  3-ID allowlist, and Microsoft Edge is locked down identically, so the Claude
  in Chrome extension cannot be installed in ANY Chrome or Edge profile here.
  Comet is Chromium with no policy key at all, so extensions install normally.
  The old Chrome launcher is kept as
  `scripts\start-automation-browser.ps1.chrome-backup`; do not switch back.
- Purpose: a browser Joe never works in, so nothing he does during the day
  (closing tabs, restarting his own Comet, logging out of sites) can disturb
  the sessions the pipeline depends on. It has its own cookies, saved logins and
  extensions.

State as of 09/12/2026: the Claude in Chrome extension is installed in that
profile and the browser is registered to Joe's Claude account as
**"Work PC Automation Browser"**, deviceId
`daa0cb94-de65-423f-815f-e1e365b200ed`. The daily task selects it by that
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

- Action: `C:\Users\JoeGallant\AppData\Local\OpenClaw\deps\portable-node\node.exe scripts\keep-dealermail-alive.mjs`
  (cwd `apps\inventory-ops`).
- Trigger: registered 09/12/2026 11:50 as a one-shot that repeats every 10 min
  for 3650 days, i.e. indefinitely.
- What it does: connects to the automation Comet over the Chrome DevTools
  Protocol on `127.0.0.1:9222`, finds the tab whose URL is
  `dealermail.com/prospect_manager` (opens one to the grid if none exists),
  and runs ONE `fetch()` of the inventory grid with `credentials: 'include'`
  **inside that tab**. The browser makes the request with its own session; the
  script reads no cookies and no credentials, stores nothing, and never logs in.
  Because it does not rely on an in-page timer it survives Comet restarts.
- Output: `work\app-feed-status\dealermail-keeper.json`
  (`checkedAt, status, httpStatus, authed, bytes, tab`, plus `openedNewTab` or
  `error` when relevant) and one line per run appended to
  `work\app-feed-status\dealermail-keeper.log`.
- Exit codes: 0 = `OK` (HTTP 200 and no password field in the response).
  1 = `SESSION_EXPIRED` (grid came back as a login form - Joe must sign in to
  DealerMail in the automation Comet again) or `ERROR` (usually port 9222 not
  answering because the automation Comet is not running; the browser watchdog
  fixes that within 15 min).
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

The prompt is `outputs\bob_maxey_task_prompt_2026-09-12.txt`. It runs
unattended, never asks a question, and records anything undecidable in the
manifest warnings. In order:

| Step | What it does | Notes |
|---|---|---|
| 0 Idempotency | If `work\app-feed-status\{date}.json` is already `published_and_verified`, message Joe the counts and stop. | |
| 1 Browser | `list_connected_browsers`, then `select_browser` deviceId `daa0cb94-...` ("Work PC Automation Browser"). If absent, run `start-automation-browser.ps1`, wait 60 s, retry once; if still absent, skip every browser step (3, 3.7, 3.8, 7) and still finish 2/4/5. | Never picks another browser, never uses Chrome. |
| 2 Public inventory + resource enrichment | Produces `snapshots\{date}-public.json` and the base workbook. AutoCheck, photos and window stickers come from the dealer VDP/API feeds. | Ford placeholder PDFs ("not yet been released") are labelled `not_released_by_ford`, not failures. |
| 2.5 Vehicle Resources | `python work\add_resources_sheet.py --report-date {date}` | Run, do not edit. |
| 3 DealerMail capture | Read-only, in the automation Comet: `showModels('ALL')`, one `javascript_tool` capture of ~226 rows (22 cells each), the exclude-active-holds view, CDK lookup + hold-edit for on-hold rows, comments/alerts for flagged rows. Written as five raw files: `-deep-capture-raw`, `-exclude-view-raw`, `-hold-details-raw`, `-complete-list-raw-cells`, `-complete-inventory-raw`. | Never submits, holds, releases or comments. If the grid shows a password field: skip to 4, never log in. |
| 3.2 Build + finalize snapshot | `node build_v2_snapshot.mjs {date}` **from `work\`** (its paths are cwd-relative) -> `-complete-used-inventory-deep.json`, must print `VALIDATION PASSED`. Then `node work\finalize_cloud_snapshot.mjs {date}` **from the workspace root** -> `-deep-cloud-ready.json`. | **New 09/12.** Finalize is REQUIRED: it adds the dual 22-cell arrays and the exclude-holds validation set the Cloudflare validator demands. Skipping it = `PUBLICATION_NOT_VERIFIED`. The manifest must name the CLOUD-READY file. |
| 3.5 Session keeper | Arms the in-page `window.__bmKeeper` (see above). | Belt and braces; the Windows task is the real keeper. |
| 3.7 Ford OASIS | Read-only, for every Ford/Lincoln VIN (179 of 226 on 09/12): `fordtechservice.dealerconnection.com/oasis/Index?vin=` from a tab already on that host, 6 workers. Parses build/warranty/field-service-action fields into `work\oasis-history\{date}-oasis.json`. Probes one page first; a login page = skip 3.7 and 3.8 with `fmcdealer_session_expired`. | **New 09/12.** Prior-owner names on extended-coverage blocks are NEVER captured - category and expiration only. |
| 3.8 Ford invoice | Read-only, same VINs: `fordvisions.dealerconnection.com/vinv/GetInvoice.aspx?v=` -> PDF bytes to `work\invoice-history\{date}\{VIN}.pdf` + `index.json`, text via pypdf, `parse_ford_invoice.py` -> `parsed.json`. | **New 09/12.** Entitlement-gated per VIN; "Document Type is not retail" and "VIN not found" are normal outcomes (131 PDFs / 48 unavailable on 09/12). Primary backup when Ford's sticker is not released. |
| 4 Workbook | If DealerMail was captured: `python work\merge_dealermail.py {date}` -> `work\staging\{date}-with-dealermail.xlsx`, copied over `outputs\Bob_Maxey_Used_Inventory_{date}.xlsx`. Either way: `python work\tidy_workbook.py --workbook ...`. | If DealerMail was skipped the workbook stays 10-sheet and the manifest says so. `add_oasis_sheet.py` / `add_invoice_sheet.py` add the optional trailing Ford OASIS / Ford Invoice sheets - run them here, before the file is hashed. |
| 5 Validate | 13-sheet: `final_check12.py <xlsx> work\run-status\{date}.json`; 10-sheet: `final_check.py <xlsx>`. Always `excel_open_test2.ps1 -Path <xlsx>`. | Run, do not edit. Fix the DATA, not the validator. |
| 5.5 Complete the manifest | Real counts, `dealermail_snapshot_path` = cloud-ready file, `final_workbook_sha256/bytes/sheets`, evidence, `"complete": true`. | The publish gate refuses an incomplete manifest - the single most common cause of a failed morning. |
| 6 Publish: verify only | Read `app-feed-status\{date}.json` and `auto-publish-{date}.log`; report the code. May `Start-ScheduledTask BobMaxey-InventoryFlow-DailyPublish` once if the manifest completed after the last slot. | Never runs the publish, never touches secrets, never removes the lock. |
| 3.95 vAuto Factory Equipment (API) | `python work\build_vauto_worklist.py --report-date {date}` then `node apps\inventory-ops\scripts\vauto-factory-equipment.mjs run work\vauto-history\worklist-{date}.json work\vauto-history\{date}-factory-equipment.json`. Every feed VIN not already OK, any make; ~0.2 s per VIN; resumable. | **Rewritten 09/12 (PM).** No form, no clicks, no popup, nothing on screen: the script calls vAuto's own `factoryequipment/WindowStickers/{VIN}` endpoint from inside the authenticated tab. `[]` = `NO_BUILD_DATA` (Euro/import makes), re-checked after 7 days. `SESSION_EXPIRED` = sign in to vAuto again in the automation Comet. The daily publish task runs this same pair as its Step 1.4, so the Cowork run is a second, harmless pass. |
| 7 (retired) | The manual vAuto UI procedure. `--ui` on the driver keeps the old form-driving path as an emergency fallback only. | Never save, never "Temporary Save", never "Copy Information" on the duplicate modal. |
| 8 Finish | Message Joe: public / DealerMail / held counts, publish status, failures and why, vehicles needing manual review; attach the workbook. Dates MM/DD/YYYY. | A VIN that dropped off the public feed is a Removed change, not active inventory. |

Two things happen alongside the prompt rather than inside it:

- **Manager disposition overlay.** When the manager's handwritten monthly
  sold/delivered log arrives (transcribed to `work\sold-delivered\{date}.csv`),
  `python work\ingest_sold_delivered.py --report-date {date} --csv ...` writes
  the allow-listed `work\manager-supplied\sold-logs\{YYYY-MM}-{store}-operational.json`
  (the only file the pipeline reads), the local-only `-restricted.json`, and
  binds `manifest.manager_disposition_overlay` (path + sha256 + counts). It
  runs the pipeline's own sanitizer and manifest-bound loader via
  `ingest_sold_delivered_helper.mjs`, never publishes, and backs the manifest
  up first. 09/12/2026: Howell, 2026-09, 11 sold / 9 delivered, 1 matched a
  current public VIN, 10 for review.
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
| `apps\inventory-ops\scripts\start-automation-browser.ps1` | Rewritten for Comet (see the task above); adds `--remote-debugging-port=9222`. Old version kept as `.chrome-backup`. |
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
control. As of this writing the Comet launcher edit, `keep-dealermail-alive.mjs`,
`dryrun_manager_disposition_check.mjs` and the `.chrome-backup` are uncommitted
there - commit them when convenient so a `git checkout .` cannot wipe them.

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
  shared seat, not the row's VIN (tested: clicked the 2023 Escape, got a 2020
  F-150) - not safe to automate.
- `resourceRecord.autoCheckReport.url` must be a canonical `autocheck.com`
  report link and `factoryEquipment.url` must be an `assets.cai-media-management.com`
  image. Dealer-hosted proxy links never pass, by design. Do not widen either
  validator; those two `resourceRecord` fields are a separate, narrower channel
  from `publicRecord`.
- Stock SGL02594 (2025 Aviator Reserve): feed MSRP $29,995 is a DealerOn error;
  sticker MSRP is $78,630. Preserved and flagged in Data Quality, not corrected.
- ~40 Ford stickers overstate *Total Options* by the package discount. Base
  price and total MSRP are correct as printed. Left alone at Joe's request.
- The 09/12 published workbook is the 13-sheet build (hash
  `827257C6...`); the Ford OASIS and Ford Invoice sheets were written after
  that publish and first ship with the next run.

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

The old UI path (`--ui`) still exists as an emergency fallback only: if it is
ever needed, the rules stand - **Ignore** on the duplicate modal, never "Copy
Information", never save, never "Temporary Save".

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
3FMCR9BN0SRE88025 it lists Basic as *60 months*, so it reports 45 months left; Ford's
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
how 09/14 produced 178 Ford/Lincoln units on AutoCheck terms behind a clean-looking status
line. Every failure path now sets a real state (`session_expired`, `http_{n}`,
`no_oasis_result`, `unavailable`), and a Ford/Lincoln unit carrying only AutoCheck is tagged
`fordWarrantyUnverified` with a source label reading DO NOT QUOTE TO A CUSTOMER - AutoCheck
prints a generic 60-month bumper-to-bumper where Ford's is 36. The final JSON line carries
`fordWarrantyUnverified: {n}`; anything above 0 means sign in to FMCDealer in the Work PC
Automation Browser and re-run the capture.

## Ford OASIS capture (`capture-oasis.mjs`, new 09/14/2026)

    node apps\\inventory-ops\\scripts\\capture-oasis.mjs run {date} [--max N] [--budget-ms N] [--refresh]

Like DealerMail, this was hand-run through `javascript_tool` every morning, which is why
09/13 and 09/14/2026 have no OASIS file at all. Read-only, inside the authenticated
FMCDealer tab over CDP. Builds `work\\oasis-vin-worklist-{date}.json` and writes
`work\\oasis-history\\{date}-oasis.json`. Resumable; `--refresh` recomputes.

**PRIVACY:** extended-coverage blocks carry the PRIOR OWNER'S NAME. This captures coverage
category and expiration date only - no owner name is ever parsed or stored.

**Parsing.** Once tags are stripped, a value runs straight into the next label
("...SERIES 10 PAINT COLOR: ..."). A lookahead for "next ALL-CAPS run + colon" does NOT
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
Something local on dt-4094 keeps an open handle on `work\\inventory-history\\latest.json`
that permits WRITES but blocks the delete a rename implies, so `os.replace` raised
`PermissionError/WinError 5` while the file was perfectly writable. That blocked the 09/14
advance even though the publish had succeeded, which would have left the next day's Daily
Changes diffing against a stale snapshot. (The workspace is NOT in a OneDrive sync root -
`Documents` is redirected, but this tree lives in the non-redirected `C:\\Users\\JoeGallant\\Documents`
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
three-VIN skew (1FTER4FH6MLD87772 and 5LM5J7XC9SGL02594 public but not in the CRM,
2FMPK4K9XGBC64506 in the CRM but no longer public) made that fatal and blocked the publish,
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
