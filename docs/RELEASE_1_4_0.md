# Inventory Flow 1.4.0 — release evidence

Released September 30, 2026 from `e5f2ae4f1afa0fc8e41ce09381ca2642c804d34a`, including [PR #58](https://github.com/TechSavvyJoe/inventory-flow/pull/58) and [PR #59](https://github.com/TechSavvyJoe/inventory-flow/pull/59). Joe authorized this release and the PR #59 merge in the release conversation. Both Workers were deployed once through `pnpm cloud:release` from the same clean, reviewed main commit.

## What shipped

Inventory rows and vehicle workspaces retain full vehicle context, source branding, certification, equipment highlights and recognizable quick actions. Overview document summaries expand together; records use compact columns. The vehicle photo opens a keyboard-accessible, swipeable gallery. The companion places standout factory options and the expandable warranty calculator near the top. Available original OEM stickers take precedence over explicitly branded vAuto fallback information.

Private employee-owned customer lists synchronize through the central app service between the web app and companion. Customer labels use initials or nicknames; contacts remain in DealerMail. Single- and multi-vehicle customer documents combine larger photos, public specifications, deduplicated features and dealership branding, with print/PDF, HTML save and share actions. The release also includes the recovered manager Overview/disposition work, stock-tag scanning and iPhone home-screen icon.

PR #59 fixes a confirmed synthetic employee-switch leak: two memberships with identical displayed name, role and store could retain the previous person's list view. Server-owned membership identity now keys bootstrap validators, employee UI state and companion requests. Saved-list requests carry an original-owner rejection fence; delayed reads, writes and create/add continuations cannot populate another employee's view. Hold roles/redaction and read-only source/integration boundaries were preserved. This reproduction was not a claim of a live customer-data incident.

## Validation

- Frozen-lockfile installation, repository safety, type checking, design-system ratchet, full tests and production build passed on the exact released commit: 205 test files, 3,130 tests passed, 3 skipped.
- Cloud validation applied all 14 migrations to synthetic in-memory SQLite. The offline recovery drill passed all 24 role/store projections and integrity, audit, identity, idempotency and encryption checks.
- Desktop/mobile Playwright: 64 passed, 4 skipped. Full Chromium desktop/Android, Firefox desktop and WebKit desktop/phone acceptance: 118 passed, 7 skipped.
- Synthetic create/save/reload/customer-document flows were inspected at 390×844, 1024×768, 1320×820 and 1440×900. Screenshots and PDFs stayed outside Git.
- All 40 pixel comparisons passed in the prescribed Linux CI renderer. No baseline was changed to make this repair pass.
- [Exact merged-commit CI run 36756286063](https://github.com/TechSavvyJoe/inventory-flow/actions/runs/36756286063) completed successfully, including build/tests/cloud/recovery, browser acceptance and visual comparisons. The E2E job budget increased from 15 to 25 minutes for cold browser installation; test timeouts and coverage were unchanged.
- Independent review approved the owner-isolation repair with 43 focused tests passing. Review/repair model mix: GPT-5.6 Sol/high; independent final review: GPT-6 Astra/high.

## Production activation

| Worker | Serving version, tag `e5f2ae4` | Previous version for rollback |
| --- | --- | --- |
| `inventory-ops-production` | `f1d51344-f960-41de-9988-6459cb72a7c6` | `a4a7f794-c78c-471b-afbe-2e72c7ee1158` |
| `inventory-flow-integrations` | `b5b8b31c-0b03-43b8-8a6f-e97863b7d9cc` | `e8c28a80-90ca-42e4-bbd5-97644219edd4` |

Both versions were independently confirmed at 100% traffic. Before applying migrations, the publisher was idle and its enabled states were preserved. The operator recorded a Time Travel bookmark and verified an encrypted, access-restricted SQL backup on Joe-PC. Local restore checks and independent live table counts, revision and release-pointer comparisons matched; plaintext exports were removed. Live Time Travel restore and independent key escrow were not exercised.

`0013_vehicle_dispositions.sql` and `0014_customer_vehicle_lists.sql` were applied individually, then verified against their complete expected tables, indexes and triggers. Only their exact verified filenames were recorded in the existing migration ledger. The final schema and ledger matched all 14 migrations; no generic migration replay occurred. Rollback keeps the additive tables and user records, reverting both Workers to the recorded previous version IDs if needed.

Publisher-authenticated readiness passed with `ready`, `dispositionStorage` and `savedListsStorage` all true. Joe supplied signed-in browser health showing the exact app version and source tag and reported that Inventory and vehicle details seemed to load normally. A temporary four-store integration grant independently reconciled the September 30 release hash and all 235 public vehicles: Howell 82, Fowlerville 46, Ford Detroit 64 and Lincoln 43. Anonymous denial, paginated inventory, detail/change/hold reads and OAuth protection/discovery/S256/registration checks passed. A separate health-only probe confirmed the exact integrations version. All temporary grants were revoked and their credential files deleted.

The first health-version helper incorrectly read `data.version`; the live contract places `version` at the response root. The corrected probe passed without a code or deployment change. The first tail helper ended before 15 minutes of confirmed connected time; the replacement observation completed the full interval.

The replacement observation completed at 19:17:41 UTC with at least 900 seconds of confirmed connected monitoring on each exact deployed version. All 23 app events and both integration events completed successfully; the integration 401 was the expected anonymous-denial probe. There were no exceptions, resource-limit outcomes or 5xx responses. Observed maximum CPU/wall time was 664/1,404 ms for the app and 1,408/2,514 ms for integrations. This was a limited-traffic observation, not a capacity/load test. The integration CPU peak exceeded its configured 1,000 ms value without a failed execution; Cloudflare documents occasional per-isolate CPU flexibility, so this result does not establish margin under sustained load ([CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)). No limit or billing setting was changed.

Joe-PC's four previously enabled publication-related tasks were restored at 19:00:38 UTC. DT-4094 remains disabled. The 14:55 EDT refresh fell within the release pause; the last verified release stayed available.

The 15:25 EDT scheduled IntradayHolds run completed with LastTaskResult `0`. Its status is `intraday_holds_published_and_verified`; the complete September 30 app receipt and run-manifest publication both report `published_and_verified` at **19:26:18.444 UTC / 15:26:18 EDT**. Hold and app receipts match bundle `1aaac5aa98c69daebd21bd031b5d6f1af7980ca50363f8771b001159d8bebd03`. The publication lock cleared, no reconciliation marker remained, and the 15:27 EDT scheduled monitor also returned `0`. All four restored tasks are enabled; DailyRun remains scheduled for 05:30 EDT. This is evidence from the scheduled task, not a substitute foreground publisher run. Protected readiness was checked again after this scheduled publication and matched its new report date and bundle hash, with both storage families still ready.

## Acceptance boundaries

The matching companion 1.4.0 archive is bundled with the app at `/downloads/inventory-flow-deal-desk.zip`. This is an unpacked Chrome release: installed copies need their files updated and the extension reloaded. It is not a Chrome Web Store automatic update.

Installed companion operation, physical iPhone scanning/home-screen behavior, native sharing/printing, production employee switching/revocation and actual hosted MCP-client sign-in remain separately unverified. Real employee writes, including customer-list use, issue completion and sold-pending/return/closure workflows, were covered synthetically but were not performed in production for this release. Synthetic browser checks and REST/OAuth discovery do not establish those acceptance boundaries. No fake production lists, vehicle movements or source-system writes were created for release testing.

During backup handling, Wrangler's temporary signed SQL download URL appeared in tool output. The saved log was redacted, both plaintext exports were removed after encrypted verification, and the URL expires at 19:30 UTC on September 30. No persistent credential was printed or committed. This handling error is recorded separately from the successful backup verification.
