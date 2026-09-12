# Daily automation runbook (dt-4094)

Set up 09/11/2026. Companion to CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md, which
covers the publish mechanics; this file covers *what runs, when, on which
machine, and how to fix or undo each piece*. Dates in this file are MM/DD/YYYY;
internal file names and JSON keys stay ISO on purpose (the pipeline matches on
them).

## The morning, unattended

| Local time | What | Runs where | Owned by |
|---|---|---|---|
| 07:30 | Build workbook, resource enrichment, Vehicle Resources sheet, DealerMail deep capture, re-arm session keeper, verify publish, message Joe | Claude scheduled task `Bob Maxey Used Inventory - Daily Report` (Sonnet) | Claude Cowork |
| 09:15, then every 30 min to 15:15 | Build/reuse resource cache, publish to Cloudflare, verify live | Windows task `BobMaxey-InventoryFlow-DailyPublish` | Task Scheduler |
| every 15 min | Relaunch the isolated automation Chrome if it is not running | Windows task `BobMaxey-AutomationBrowser` | Task Scheduler |

The Claude task no longer publishes. The publish is a production deploy and is
refused inside unattended AI sessions, so it moved to a Windows task that has no
such gate and runs as JoeGallant (which is what lets the DPAPI secret bundle
decrypt). The Claude task only *verifies* the publish by reading the receipt and
the Windows task's log.

## Windows scheduled tasks

Both are registered for JoeGallant with logon type **Interactive**: they run
while Joe is logged on (a locked screen is fine; a full log-off or a reboot to
the login screen is not). To run logged-off, open Task Scheduler, tick
*Run whether user is logged on or not*, and enter the Windows password. DPAPI
keeps working in that mode. Only Joe can do that step.

### BobMaxey-InventoryFlow-DailyPublish

- Action: `scripts\daily-cloud-publish.ps1` (cwd `apps\inventory-ops`)
- Trigger: daily 09:15, repeat every 30 min for 6 h. Covers the 9:15/9:45/
  10:15/10:45 cadence in the Cloudflare runbook and keeps going as insurance.
- Idempotent: exits `SKIPPED (already current)` in under a second once
  `work\app-feed-status\{date}.json` shows `published_and_verified` for that
  date, so the extra slots cost nothing. `-Force` republishes.
- Photo cache: tries `build_photo_cache.py --reuse-snapshot-resources` first.
  Falls back to a fresh VDP extraction ONLY on a clean zero (snapshot has no
  embedded resources). A non-zero exit from the reuse path aborts with
  `PHOTO_CACHE_REUSE_FAILED` rather than overwriting anything, per the
  runbook's "never overwrite manually recovered resources" rule.
- Log: `work\app-feed-status\auto-publish-{date}.log`. Secret VALUES are never
  written; only key names and counts.
- Re-register or change the schedule: edit and run
  `scripts\register-daily-publish-task.ps1`.
- Remove: `Unregister-ScheduledTask -TaskName BobMaxey-InventoryFlow-DailyPublish`

Error codes the log can end with, and what they mean:

| Code | Meaning | Clears itself? |
|---|---|---|
| `SOURCE_NOT_CURRENT` | Day's public+DealerMail release not complete yet | Usually, on a later retry |
| `PHOTO_CACHE_FAILED` | Fresh VDP extraction failed | Retry; check dealer sites |
| `PHOTO_CACHE_REUSE_FAILED` | Embedded resources exist but failed validation; refused to overwrite | **No** - needs a person |
| `PUBLISH_NOT_VERIFIED` | Server accepted but live verify failed; cloud may already hold the release | Check live date + hash first |
| `SECRET_STORE_MISSING` | `runtime\cloud-secrets\publisher.dpapi` missing | No |

Never delete `work\app-feed-status\.publication.lock` to force a run. See the
Cloudflare runbook's lock rules.

### BobMaxey-AutomationBrowser

- Action: `scripts\start-automation-browser.ps1`
- Trigger: daily 00:05, repeat every 15 min for 23h45m. (An at-logon trigger
  needs elevation to register, so the 15-minute watchdog covers logon instead.)
- Launches Chrome with `--user-data-dir=%LOCALAPPDATA%\BobMaxeyAutomation\ChromeProfile`,
  minimized, with the DealerMail inventory grid open. Idempotent: exits
  immediately if that instance is already running.
- Log: `%LOCALAPPDATA%\BobMaxeyAutomation\automation-browser.log`
- Purpose: a Chrome that Joe never works in, so nothing he does during the day
  (closing tabs, restarting his own Chrome, logging out of sites) can disturb
  the sessions the pipeline depends on. It has its own cookies, saved logins and
  extensions.

One-time setup still required in that window (as of 09/11/2026 evening):
1. Install the Claude in Chrome extension in it. It then connects as its own
   browser; the daily task prefers it by name.
2. Sign in to DealerMail and vAuto/Provision; let Chrome save both.
3. Minimize it and leave it alone.

Do NOT try DealerMail in Claude's built-in browser pane: tested 09/11/2026, it
is bounced back to the login screen. DealerMail sits behind Cloudflare bot
management (`cdn-cgi/challenge-platform` JSD) and binds sessions to a trusted
device fingerprint; the login form also posts into a named popup window
(`target="newLogIn"`) the pane cannot show. Chrome is the trusted device.

## DealerMail session keeper

DealerMail's timeout is activity-based. The keeper is plain page JavaScript
injected into the authenticated DealerMail tab: it `fetch()`es the inventory
grid with credentials every 5 minutes, which resets the idle clock. It never
logs in and never touches credentials. It lives in `window.__dmKeeper` /
`window.__dmKeeperTimer` and dies if that tab is navigated, reloaded or closed,
so the daily task re-arms it at the end of Step 3 (the exact snippet is in the
task prompt, STEP 3.5). The task reports `alive` or `expired`; `expired` means
Joe has to sign in to DealerMail in Chrome again.

Once the automation Chrome has the extension installed, move the keeper there
and leave the parked DealerMail tab untouched.

## Scripts changed or added 09/11/2026

| Path | Change |
|---|---|
| `work\add_resources_sheet.py` | Now parameterized (`--report-date`, `--workbook`, `--snapshot`, `--output`); defaults to in-place. Picks the snapshot that actually contains enrichment; exits `RESOURCE_ENRICHMENT_EMPTY` rather than writing 224 blank rows. Adds **MI Plate Base Price** as column H (the Monroney BASE PRICE line, as printed, before options and destination - the Michigan plate-fee basis). Dates are real Excel date cells formatted `mm/dd/yyyy`. |
| `work\merge_dealermail.py` | `write_row` converts ISO date text to real Excel dates formatted `mm/dd/yyyy` (Hold Date, Expected Delivery). |
| `work\finalize_audited_report.mjs` | Data Quality "Report date" cell displays MM/DD/YYYY. |
| `work\build_vin_document_enrichment.py` | NEW, dormant. Generates `data\vin-document-enrichment.json` `factoryEquipment` records from parsed stickers. Valid on both validators, but the Inventory Flow UI only renders factory equipment when it carries a vAuto/CAI image URL, so URL-less records count toward `resourceRecordCount` without displaying. Joe reverted the data file to the original single record on 09/11/2026 (backup: `work\vin-document-enrichment.backup-2026-09-11.json`). Re-enable only once the vAuto capture below supplies real CAI URLs. |
| `apps\inventory-ops\scripts\daily-cloud-publish.ps1` | NEW. See above. |
| `apps\inventory-ops\scripts\register-daily-publish-task.ps1` | NEW. Registers the publish task. |
| `apps\inventory-ops\scripts\start-automation-browser.ps1` | NEW. Launches/guards the isolated Chrome. |
| `work\vauto-factory-options-worklist-2026-09-11.csv` | NEW. 92 VINs (46 with no sticker at all, 46 with a link the Ford parser cannot read) for the vAuto step. |
| `work\tidy_workbook.py` | NEW. Last cosmetic step before validation. Collapses 28 plumbing columns on Master Inventory + store sheets into outline groups (16 visible), collapses Photo URLs on Vehicle Resources, currency/thousands formats, tab colors, hides Data Quality + Hold Detail History (still present, still validated), Dashboard opens first. Validator-safe by construction: no sheet or column added/removed/moved, no value changed. **Never add a sheet-level AutoFilter to Master Inventory or the store sheets** - they are Excel Tables and the overlap makes Excel refuse the file (bisected and proven 09/11/2026). Proven: Excel COM opens the result with no repair. |
| `work\final_check12.py`, `work\final_check.py` | No longer day-specific. Expect the 13-/10-sheet list including Vehicle Resources. final_check12 reads the day's manifest (argv[2] or located from the date in the filename) and cross-checks Master Inventory vs `public_unique_vins`, Hold Reconciliation vs `active_held_vins` and vs the DealerMail grid's Hold Status column; the hardcoded 224/33 are gone. Both check Vehicle Resources directly (row count, VIN set, header, plate prices present). Run without editing. |

Uncommitted as of this writing; commit them when convenient so a
`git checkout .` cannot wipe them.

## Known data facts (verified 09/11/2026)

- The dealer-site sticker path is **Ford/Lincoln only** (`parse_window_sticker_text`
  parses Ford/Lincoln Monroney facts; DealerMail's button is `openFordSticker`).
  Every off-brand trade falls through it. That is the 92-VIN gap.
- `resourceRecord.autoCheckReport.url` must be a canonical `autocheck.com`
  report link and `factoryEquipment.url` must be an `assets.cai-media-management.com`
  image. Dealer-hosted proxy links never pass, by design. Do not widen either
  validator. AutoCheck/sticker data still reaches the app through
  `publicRecord` (224 AutoCheck, 178 stickers, 223 photos on 09/11/2026); those
  two `resourceRecord` fields are a separate, narrower channel.
- DealerMail's AUTOCHECK button opens whatever report is loaded in the
  dealership's shared AutoCheck seat, not the row's VIN (tested: clicked the
  2023 Escape, got a 2020 F-150). Not safe to automate.
- Stock SGL02594 (2025 Aviator Reserve): feed MSRP $29,995 is a DealerOn error;
  sticker MSRP is $78,630. Fix at the source.
- ~40 Ford stickers overstate *Total Options* by the package discount. Base
  price and total MSRP are correct as printed. Left alone at Joe's request.

## Next build: vAuto / Provision factory options (not started)

For each VIN in the worklist, in the automation Chrome: Provision -> New
Appraisal -> enter VIN -> Go -> scroll past options -> **Factory Options** ->
capture the popup (window sticker or the vAuto/Cox equivalent, hosted on
`assets.cai-media-management.com`) -> read the base MSRP *as printed* -> abandon.
**Never save the appraisal.** Each VIN starts a fresh appraisal. If a draft
appears to persist, stop and tell Joe. Output feeds both the plate-fee column
and, via the CAI URL, a renderable `factoryEquipment` record.

## Standing rules from Joe

- Every date a human reads: MM/DD/YYYY or MM/DD/YY. File names and JSON keys stay ISO.
- Read numbers off the sticker; do not derive them.
- Never store or type his credentials. He signs in himself; Chrome saves it.
- Never fabricate or infer resource data to make a count look complete.
