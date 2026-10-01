# GitHub review reconciliation — October 1, 2026

All 127 fetched review threads across PRs 1–62 are listed below. This is an accounting ledger, not a claim that every open follow-up is fixed. GitHub resolution/outdated markers do not by themselves establish current behavior. The candidate repairs are separate from merged main and production.

| Disposition | Threads |
| --- | ---: |
| Current source accounted for | 38 |
| Historical GitHub resolution | 25 |
| Open follow-up | 37 |
| Candidate repair | 24 |
| Explicit decision | 3 |

Candidate checks and browser evidence are recorded in [the conversation reconciliation](CONVERSATION_RECONCILIATION_2026_10_01.md). Host-only changes are not part of this PR. Follow-ups involving source authentication, publication, access revocation or PDF photo delivery block an unqualified production-ready claim.

## PR 1

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Allow releases with zero active holds](https://github.com/TechSavvyJoe/inventory-flow/pull/1#discussion_r3918265091) | Current source accounted for | Release validation allows zero holds. Source: `cloudflare/src/release-validation.mjs`. |
| [Create the cutover marker during ledger migration](https://github.com/TechSavvyJoe/inventory-flow/pull/1#discussion_r3918265098) | Current source accounted for | Node server now refuses file-backed ledgers and requires an explicit synthetic loader; retired marker design superseded. Source: `server/local-cutover.mjs`. |

## PR 5

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Pass the rollback version as a positional argument](https://github.com/TechSavvyJoe/inventory-flow/pull/5#discussion_r3995674414) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `docs/SHARED_DATA_DEPLOYMENT.md`. |
| [Pass the rollback version as a positional argument](https://github.com/TechSavvyJoe/inventory-flow/pull/5#discussion_r3995674415) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `docs/SHARED_DATA_DEPLOYMENT.md`. |

## PR 7

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Preserve transferless app-confirmed locations](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244730) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/lib/model.mjs`. |
| [Fetch authorized vehicle detail before rendering it](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244732) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/panel.js`. |
| [Retain the window sticker's original currency](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244733) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/lib/model.mjs`. |
| [Revalidate cached production data before displaying it](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244735) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/panel.js`. |
| [Render date-only values without a timezone shift](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244737) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/lib/format.mjs`. |
| [Preserve manager-log freshness in the view model](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244740) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/lib/model.mjs`. |
| [Declare Sharp for the icon-generation command](https://github.com/TechSavvyJoe/inventory-flow/pull/7#discussion_r3997244743) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `scripts/build-extension-icons.mjs`. |

## PR 8

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Use active inventory counts for integration verification](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923794) | Current source accounted for | Old active-count recommendation superseded by the approved public-only external projection; do not restore active counts. Source: `scripts/daily-cloud-publish.ps1`. |
| [Bind each OASIS response to the requested VIN](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923798) | Open follow-up | OASIS capture still calls parseOasisFull without requested-VIN binding. Requires exact response identity regression. Source: `scripts/capture-oasis.mjs`. |
| [Fail when the DealerMail budget truncates capture](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923805) | Current source accounted for | DealerMail capture records budget truncation and fails before writing success outputs. Source: `scripts/capture-dealermail.mjs`. |
| [Make the manifest dry run validate the requested day](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923811) | Current source accounted for | Manifest checker accepts report date, reconciles loaded release date and sets failure exit status. Source: `scripts/dryrun_manifest_check.mjs`. |
| [Keep conflicting manager rows off VIN records](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923823) | Open follow-up | Manager VIN projection accepts valid conflicting matches; hiding logic is stricter than displayed disposition evidence. Source: `server/service-core.mjs`. |
| [Use publish-mode validation in the resource dry run](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923829) | Current source accounted for | Resource dry run uses publish-mode validation. Source: `scripts/dryrun_resource_enrichment_check.mjs`. |
| [Verify the new resource-channel counts](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923834) | Current source accounted for | Publisher count verification includes OASIS/warranty channels. Source: `scripts/sync-cloud-release.mjs`. |
| [Do not treat an unparsed FSA section as clear](https://github.com/TechSavvyJoe/inventory-flow/pull/8#discussion_r4009923841) | Current source accounted for | OASIS parser requires explicit complete action-section evidence before reporting zero. Source: `scripts/capture-oasis.mjs`. |

## PR 10

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Avoid dropping healthy targets after the third candidate](https://github.com/TechSavvyJoe/inventory-flow/pull/10#discussion_r4010026044) | Open follow-up | Keeper still examines only the first three existing candidates. Source: `scripts/keep-dealermail-alive.mjs`. |
| [Abort timed-out probes before retrying another tab](https://github.com/TechSavvyJoe/inventory-flow/pull/10#discussion_r4010026047) | Open follow-up | Keeper evaluation can outlive its CDP response timeout without an in-page abort. Source: `scripts/keep-dealermail-alive.mjs`. |
| [Keep probe timeouts above the service request budget](https://github.com/TechSavvyJoe/inventory-flow/pull/10#discussion_r4010026051) | Open follow-up | Keeper service probes still inherit the short command deadline. Source: `scripts/keep-dealermail-alive.mjs`. |

## PR 11

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Require the service migrations before deployment](https://github.com/TechSavvyJoe/inventory-flow/pull/11#discussion_r4021105765) | Current source accounted for | Release 1.2.0 documentation names migrations 0007, 0008 and 0009. Source: `docs/RELEASE_1_2_0.md`. |
| [Send preview roles only after an explicit choice](https://github.com/TechSavvyJoe/inventory-flow/pull/11#discussion_r4021105771) | Open follow-up | Initial client role defaults to manager and sends preview header before explicit preview selection. Source: `src/lib/api.ts`. |
| [Derive action provenance from the captured section](https://github.com/TechSavvyJoe/inventory-flow/pull/11#discussion_r4021105774) | Current source accounted for | Importer/action parser uses captured action-section provenance. Source: `server/importer.mjs`. |
| [Keep mobile workflow links reachable for group managers](https://github.com/TechSavvyJoe/inventory-flow/pull/11#discussion_r4021105779) | Current source accounted for | Mobile More contains manager and staff workflow destinations. Source: `src/app/AppShell.tsx`. |

## PR 12

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Preserve compound negations when deriving the detail tone](https://github.com/TechSavvyJoe/inventory-flow/pull/12#discussion_r4021485248) | Current source accounted for | Companion preserves compound source negations. Source: `extension/sidepanel/lib/resources.mjs`. |
| [Keep unknown and missing source states visibly signposted](https://github.com/TechSavvyJoe/inventory-flow/pull/12#discussion_r4021485251) | Current source accounted for | Companion exposes missing/unknown source warnings. Source: `extension/sidepanel/panel.js`. |
| [Keep vehicle references available when service detail fails](https://github.com/TechSavvyJoe/inventory-flow/pull/12#discussion_r4021485253) | Current source accounted for | Service retains vehicle references when endpoint detail fails; positive rendered regression. Source: `src/features/service/ServicePage.tsx`. |

## PR 13

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Scope outcome writes to the requesting store](https://github.com/TechSavvyJoe/inventory-flow/pull/13#discussion_r4021984250) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `server/workflow.mjs`. |
| [Preserve an event that starts the away-time clock](https://github.com/TechSavvyJoe/inventory-flow/pull/13#discussion_r4021984254) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `server/service-core.mjs`. |
| [Keep unknown reference prices currency-neutral](https://github.com/TechSavvyJoe/inventory-flow/pull/13#discussion_r4021984259) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `src/features/inventory/VehicleWorkspace.tsx`. |
| [Render the source-detail children](https://github.com/TechSavvyJoe/inventory-flow/pull/13#discussion_r4021984263) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `src/features/inventory/VehicleWorkspace.tsx`. |
| [Reject backslashes in workspace return paths](https://github.com/TechSavvyJoe/inventory-flow/pull/13#discussion_r4021984268) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `src/features/inventory/inventory-navigation.ts`. |
| [Preserve the AutoCheck estimate qualification](https://github.com/TechSavvyJoe/inventory-flow/pull/13#discussion_r4021984276) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `src/features/inventory/VehicleWorkspace.tsx`. |

## PR 15

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Remove the obsolete unmerged-code warning](https://github.com/TechSavvyJoe/inventory-flow/pull/15#discussion_r4054327998) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `docs/SHARED_DATA_DEPLOYMENT.md`. |
| [Record the complete historical Worker version IDs](https://github.com/TechSavvyJoe/inventory-flow/pull/15#discussion_r4054328003) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `docs/SHARED_DATA_DEPLOYMENT.md`. |
| [Build the checked-out commit before redeploying it](https://github.com/TechSavvyJoe/inventory-flow/pull/15#discussion_r4054328007) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `docs/SHARED_DATA_DEPLOYMENT.md`. |

## PR 17

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Allow documentation names that describe backups](https://github.com/TechSavvyJoe/inventory-flow/pull/17#discussion_r4054494398) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `scripts/check-repo-safety.mjs`. |
| [Match slash-separated Windows profile paths](https://github.com/TechSavvyJoe/inventory-flow/pull/17#discussion_r4054494403) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `scripts/check-repo-safety.mjs`. |

## PR 20

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Do not treat every forbidden operation as session revocation](https://github.com/TechSavvyJoe/inventory-flow/pull/20#discussion_r4063837694) | Open follow-up | Generic 403 still invalidates the protected workspace, including operation denial. Preserve fast revocation while designing an explicit server-owned denial distinction. Source: `src/lib/api.ts`. |
| [Run the snapshot builder from its required working directory](https://github.com/TechSavvyJoe/inventory-flow/pull/20#discussion_r4063837710) | Candidate repair | Snapshot builder runs from workspace work directory; finalizer remains at workspace root. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Convert OASIS kilometre terms in the service reference](https://github.com/TechSavvyJoe/inventory-flow/pull/20#discussion_r4063837727) | Candidate repair | Service reference uses shared mile conversion and retains kilometre evidence. Source: `src/features/service/ServiceVehicleContext.tsx`. |
| [Map direct moves to a non-submitted manager status](https://github.com/TechSavvyJoe/inventory-flow/pull/20#discussion_r4063837747) | Open follow-up | Request adapter still maps arrived to submitted, although movement projection handles arrival. Source: `server/workflow.mjs`. |
| [Omit the manager overlay after its validation fails](https://github.com/TechSavvyJoe/inventory-flow/pull/20#discussion_r4063837762) | Current source accounted for | Manifest binding requires current manager-disposition validation success. Source: `scripts/run-inventory-flow-daily.mjs`. |

## PR 21

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Remove generic warranty fields from server search text](https://github.com/TechSavvyJoe/inventory-flow/pull/21#discussion_r4065074558) | Open follow-up | Server search text still includes generic warranty coverage/status terms. Source: `src/app/adapters.ts`. |

## PR 22

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Commit baselines before enabling the visual gate](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4087630430) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `.github/workflows/ci.yml`. |
| [Keep autocomplete matches synchronized with the typed query](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4087630436) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `src/features/inventory/InventoryExperience.tsx`. |
| [Include VIN-less delivered rows in identity review](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4087630450) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `server/service-core.mjs`. |
| [Update the shipped mockup when renaming demo photos](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4087630459) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `extension/sidepanel/lib/synthetic-photos.mjs`. |
| [Keep duplicate-tab cleanup best-effort](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4097259329) | Candidate repair | Duplicate-tab cleanup returns zero if CDP is unavailable. Source: `scripts/lib/cdp.mjs`. |
| [Do not let --accept waive absolute CSS bans](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4097259344) | Open follow-up | Design guard --accept can still increase absolute-ban important/ID metrics. Source: `scripts/check-design-system.mjs`. |
| [Preserve the shortlist launcher as the dialog return target](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4097259360) | Current source accounted for | Shortlist opener follows normal workspace focus capture; nested-modal test verifies restoration. Source: `src/features/inventory/InventoryExperience.tsx`. |
| [Clear the shortlist-only predicate with the other filters](https://github.com/TechSavvyJoe/inventory-flow/pull/22#discussion_r4097259370) | Candidate repair | Clear filters also clears shortlist-only mode and resets its paging state. Source: `src/features/inventory/InventoryExperience.tsx`. |

## PR 29

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Bind invoice retries to the receipt's released metadata](https://github.com/TechSavvyJoe/inventory-flow/pull/29#discussion_r4107481902) | Open follow-up | Invoice uploader still reads mutable app enrichment rather than receipt-bound release metadata. Source: `scripts/daily-cloud-publish.ps1`. |
| [Stop retrying invoices after follow-ups have completed](https://github.com/TechSavvyJoe/inventory-flow/pull/29#discussion_r4107481909) | Open follow-up | Verified-receipt follow-up path can repeatedly invoke invoice uploads; completion marker remains to be verified. Source: `scripts/daily-cloud-publish.ps1`. |

## PR 30

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Bind reused public data to the morning receipt](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108642354) | Current source accounted for | Reused public source is bound to the verified receipt hash. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Preserve the verified manager overlay during hold refreshes](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108642357) | Current source accounted for | Hold refresh binds the verified manager overlay. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Serialize hold refreshes with the daily publisher](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108642359) | Current source accounted for | Shared publication lock wraps daily and intraday writers. Source: `scripts/register-intraday-hold-refresh-task.ps1`. |
| [Report post-publish failures accurately](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108642366) | Current source accounted for | Publication outcome separates verified release from follow-up failure. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Keep unchanged-source timestamps stable](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108642371) | Current source accounted for | Reused source capture timestamps are retained independently. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Bind reused resources to the verified receipt](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108717690) | Current source accounted for | Reused resource hash is checked against the verified receipt. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Preserve the verified manifest until the refresh succeeds](https://github.com/TechSavvyJoe/inventory-flow/pull/30#discussion_r4108717693) | Current source accounted for | Candidate source transaction restores the baseline on failed refresh. Source: `scripts/run-inventory-flow-daily.mjs`. |

## PR 31

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Capture the opener before trapping early Tab input](https://github.com/TechSavvyJoe/inventory-flow/pull/31#discussion_r4108834654) | Historical GitHub resolution | Marked resolved on GitHub; not a new live acceptance claim. Source: `src/lib/useContainedFocus.ts`. |

## PR 33

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Replace hard-coded overview dimensions with tokens](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110110531) | Open follow-up | Overview stylesheet retains raw measurements outside tokens; full token cleanup remains. Source: `src/features/overview/overview.css`. |
| [Attribute open issues to their reporting store](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110110532) | Current source accounted for | Replacement Overview queue scopes issues to reportStore. Source: `src/features/overview/overview-model.ts`. |
| [Invalidate stale source details after a new capture](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110110537) | Current source accounted for | Retained detail overlays scan/private evidence onto current bootstrap fields rather than stale full records. Source: `src/features/inventory/InventoryPage.tsx`. |
| [Restore scanning on tablet widths](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110110541) | Open follow-up | Tablet scan visibility requires canonical 1024px acceptance; stylesheet hides entry outside phone breakpoint. Source: `src/features/inventory/InventoryServiceFilter.css`. |
| [Treat cross-store issues as actionable for group managers](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110110545) | Open follow-up | Client issue classification restricts actionable cross-store issues to local store even for group managers. Source: `server/api.mjs`. |
| [Keep reported stores out of physical-location totals](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110168470) | Current source accounted for | Replacement Overview labels source-reported on-lot counts separately; source totals are not custody proof. Source: `src/features/overview/overview-model.ts`. |
| [Treat pre-release waiting as healthy](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110168472) | Open follow-up | Hold monitor has no explicit healthy waiting-for-morning-release path. Source: `scripts/monitor-intraday-hold-refresh.ps1`. |
| [Compare return deadlines using their full timestamp](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110233324) | Current source accounted for | Shared transferReturnOverdue compares the complete return_due_at timestamp against now; summary and Overview use that result. Source: `src/features/overview/overview-model.ts`. |
| [Keep assigned returns out of the in-transit state](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110233325) | Current source accounted for | Current custody projection uses the actual in-transit location rather than an assigned return alone. Source: `src/features/overview/overview-model.ts`. |
| [Retry published followups without recapturing DealerMail](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110233326) | Open follow-up | Ordinary runner does not explicitly resume published follow-ups before new source capture. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Count the same tasks shown by the Action center](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110233328) | Current source accounted for | Old overview-model raw count was removed; current queue uses shared action classification. Source: `src/features/overview/overview-model.ts`. |
| [Clear the intraday reconciliation status after recovery](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110421324) | Current source accounted for | Publisher clears reconciliation hold status only against the matching verified receipt. Source: `scripts/daily-cloud-publish.ps1`. |
| [Use the DealerMail capture time for pre-listing locations](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110421327) | Open follow-up | Transfer vehicle source-location timestamp falls back to public capture for DealerMail-only units. Source: `src/app/transferAdapters.ts`. |
| [Disclose or paginate vehicles omitted from print](https://github.com/TechSavvyJoe/inventory-flow/pull/33#discussion_r4110421328) | Current source accounted for | Overview print includes an explicit omitted-vehicle count for its 15-row limit. Source: `src/features/overview/overview.css`. |

## PR 34

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Do not fall back to pre-exclusion receipt counts](https://github.com/TechSavvyJoe/inventory-flow/pull/34#discussion_r4113446103) | Open follow-up | Expected public counts retain pre-exclusion receipt counts if dated release is missing. Source: `scripts/daily-cloud-publish.ps1`. |

## PR 37

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Require review when a later migration recreates the same object](https://github.com/TechSavvyJoe/inventory-flow/pull/37#discussion_r4126955297) | Open follow-up | Schema evaluator accepts later recreated definitions as evidence for an earlier migration; review distinction remains. Source: `scripts/verify-d1-schema.mjs`. |
| [Fail verification when the supplied ledger is incomplete](https://github.com/TechSavvyJoe/inventory-flow/pull/37#discussion_r4126955308) | Open follow-up | Schema ok predicate checks supplied ledger anomalies but does not fail for absent applied migration names. Source: `scripts/verify-d1-schema.mjs`. |

## PR 38

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Restrict the checksum fallback to legacy source paths](https://github.com/TechSavvyJoe/inventory-flow/pull/38#discussion_r4127060063) | Candidate repair | Checksum fallback is limited to the legacy mutable sold-log directory. Source: `server/importer.mjs`. |

## PR 39

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Relax the publisher gate for incomplete OASIS captures](https://github.com/TechSavvyJoe/inventory-flow/pull/39#discussion_r4128889510) | Current source accounted for | PR40 publisher preflight allows per-vehicle OASIS gaps while retaining parity validation. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Retry request timeouts instead of expiring the whole session](https://github.com/TechSavvyJoe/inventory-flow/pull/39#discussion_r4128889518) | Open follow-up | OASIS status-zero/network errors still stop capture as session expiry. Source: `scripts/capture-oasis.mjs`. |
| [Defer the publication claim until publishing succeeds](https://github.com/TechSavvyJoe/inventory-flow/pull/39#discussion_r4128889525) | Candidate repair | OASIS warning describes a candidate; publication still requires verification. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Generate the review file before directing operators to it](https://github.com/TechSavvyJoe/inventory-flow/pull/39#discussion_r4128889529) | Candidate repair | Warning no longer promises a review file that may not exist. Source: `scripts/run-inventory-flow-daily.mjs`. |

## PR 40

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Handle malformed OASIS arrays as warnings](https://github.com/TechSavvyJoe/inventory-flow/pull/40#discussion_r4128955998) | Open follow-up | OASIS assessment assumes valid record objects and action arrays; malformed valid JSON may throw. Source: `scripts/lib/oasis-parser.mjs`. |

## PR 41

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Withhold all-clear until every probe succeeds](https://github.com/TechSavvyJoe/inventory-flow/pull/41#discussion_r4129470814) | Candidate repair | All-clear waits for every probe to confirm healthy; pending notice retained. Source: `scripts/lib/signin-alert.mjs`. |
| [Treat a recovered browser as healthy](https://github.com/TechSavvyJoe/inventory-flow/pull/41#discussion_r4129470820) | Candidate repair | Explicit RECOVERED browser status is healthy. Source: `scripts/lib/signin-alert.mjs`. |

## PR 42

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Verify the release before treating a missing parse as empty](https://github.com/TechSavvyJoe/inventory-flow/pull/42#discussion_r4133087258) | Open follow-up | Missing parsed invoices return empty before checking advertised release documents. Source: `scripts/publish-invoice-documents.mjs`. |

## PR 44

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Redact the full Authorization header value](https://github.com/TechSavvyJoe/inventory-flow/pull/44#discussion_r4135176360) | Candidate repair | Full Authorization values are redacted before diagnostic truncation. Source: `scripts/run-inventory-flow-daily.mjs`. |
| [Propagate capture failures into the top-level detail](https://github.com/TechSavvyJoe/inventory-flow/pull/44#discussion_r4135176373) | Open follow-up | DealerMail capture failure detail remains in steps rather than the top-level failure detail. Source: `scripts/run-inventory-flow-daily.mjs`. |

## PR 45

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Clear recovered fetch failures before matching warnings](https://github.com/TechSavvyJoe/inventory-flow/pull/45#discussion_r4135155427) | Open follow-up | Invoice retry recovery/warning bookkeeping needs an executable regression for an earlier FETCH_ERROR. Source: `scripts/capture-invoices.mjs`. |
| [Keep session-expired retries marked unresolved](https://github.com/TechSavvyJoe/inventory-flow/pull/45#discussion_r4135155432) | Open follow-up | Session-expired invoice retry may clear unresolved state before the response is known. Source: `scripts/capture-invoices.mjs`. |

## PR 47

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Avoid retrying the non-idempotent alert command](https://github.com/TechSavvyJoe/inventory-flow/pull/47#discussion_r4135924840) | Candidate repair | No immediate resend after ambiguous SSH exit 255. Source: `scripts/lib/signin-alert.mjs`. |
| [Tolerate failures while deleting the SSH output file](https://github.com/TechSavvyJoe/inventory-flow/pull/47#discussion_r4135924845) | Candidate repair | Temporary-output cleanup failure is caught; completion is settled once. Source: `scripts/lib/signin-alert.mjs`. |

## PR 48

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Propagate ownership into the selected move detail](https://github.com/TechSavvyJoe/inventory-flow/pull/48#discussion_r4136678712) | Open follow-up | Queue owner semantics do not reach TransferTracker; detail computes overdue without viewer ownership. Source: `src/features/transfers/TransfersPage.tsx`. |
| [Replace the new handoff measurements with design tokens](https://github.com/TechSavvyJoe/inventory-flow/pull/48#discussion_r4136678723) | Open follow-up | Focused workspace stylesheet retains raw measurements outside tokens. Source: `src/features/inventory/VehicleWorkspace.focused.css`. |

## PR 49

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Keep the No hold chip synchronized with the select](https://github.com/TechSavvyJoe/inventory-flow/pull/49#discussion_r4136764511) | Open follow-up | No-hold select/chip equivalence is incomplete for no-hold and all selections. Source: `src/features/inventory/inventory-quick-views.ts`. |
| [Keep private held-by evidence out of summary rows](https://github.com/TechSavvyJoe/inventory-flow/pull/49#discussion_r4136764521) | Explicit decision | Joe explicitly clarified that all current sales/manager/group-manager users can see hold customers/reasons. No role/redaction/product-rule change. Source: `src/features/inventory/InventoryTable.tsx`. |
| [Use the same box for both responsive breakpoints](https://github.com/TechSavvyJoe/inventory-flow/pull/49#discussion_r4136764530) | Current source accounted for | Current responsive decision observes the actual surface width and shared card breakpoint. Source: `src/features/inventory/InventoryExperience.tsx`. |
| [Recompute counts without the filter the chip replaces](https://github.com/TechSavvyJoe/inventory-flow/pull/49#discussion_r4136764537) | Open follow-up | Facet counts need replacement-filter semantics rather than retaining the predicate being replaced. Source: `src/features/inventory/inventory-quick-views.ts`. |
| [Preserve independent hold and movement filters](https://github.com/TechSavvyJoe/inventory-flow/pull/49#discussion_r4136764545) | Open follow-up | One quickView slot still conflates simultaneous hold and movement chip selection. Source: `src/features/inventory/inventory-quick-views.ts`. |

## PR 50

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Restore the protected search-privacy cases](https://github.com/TechSavvyJoe/inventory-flow/pull/50#discussion_r4136653836) | Explicit decision | Historical PR50 test exception was explicitly approved before merge; replaced global search with retained local-search privacy coverage. Not a standing permission to alter protected tests. Source: `tests/unit/inventory-search-privacy.test.tsx`. |
| [Label legacy manager returns as Overview](https://github.com/TechSavvyJoe/inventory-flow/pull/50#discussion_r4136653849) | Candidate repair | Legacy /manager return is labeled Back to Overview. Source: `src/lib/inventory-navigation.ts`. |
| [Update the canonical docs for the retired manager surface](https://github.com/TechSavvyJoe/inventory-flow/pull/50#discussion_r4136822190) | Current source accounted for | Canonical specification now documents /overview replacing Group operations. Source: `src/App.tsx`. |
| [Update the canonical docs for the retired manager surface](https://github.com/TechSavvyJoe/inventory-flow/pull/50#discussion_r4136822360) | Current source accounted for | Duplicate of 4136822190; canonical Overview architecture documented. Source: `src/App.tsx`. |
| [Update the canonical docs for the retired manager surface](https://github.com/TechSavvyJoe/inventory-flow/pull/50#discussion_r4136824026) | Current source accounted for | Duplicate of 4136822190; canonical Overview architecture documented. Source: `src/App.tsx`. |

## PR 52

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Keep fine-pointer controls at the required 44px](https://github.com/TechSavvyJoe/inventory-flow/pull/52#discussion_r4137582209) | Explicit decision | Joe explicitly requested compact fine-pointer copy controls; primary/coarse-pointer targets stay 44px. Do not blanket-enlarge copies again. Source: `src/features/inventory/InventoryTable.desk.css`. |
| [Query the Operations cell by role and accessible name](https://github.com/TechSavvyJoe/inventory-flow/pull/52#discussion_r4137821959) | Open follow-up | Inventory table test queries require a role/name audit; no production behavior claim from selector-only coverage. Source: `src/features/inventory/InventoryTable.modern.test.tsx`. |

## PR 53

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Query the new panel test through accessible roles](https://github.com/TechSavvyJoe/inventory-flow/pull/53#discussion_r4137873479) | Open follow-up | Companion panel test still relies on CSS selectors; role/name migration remains. Source: `tests/unit/extension-panel.test.ts`. |
| [Recompute overdue state consistently in the movement filter](https://github.com/TechSavvyJoe/inventory-flow/pull/53#discussion_r4137873488) | Open follow-up | Movement overdue filter uses cached boolean while displayed status recomputes from dueAt. Source: `src/features/inventory/InventoryTable.tsx`. |

## PR 54

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Replace hard-coded dimensions with design tokens](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001669) | Open follow-up | Duplicate Overview token cleanup finding; raw measurement debt remains. Source: `src/features/overview/overview.css`. |
| [Carry all-store scope into group service links](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001676) | Candidate repair | All-store service links carry scope=all, consumed once by Service. Source: `src/features/overview/overview-links.ts`. |
| [Scope identity-review links to the exception store](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001681) | Candidate repair | Identity-review drilldown opens group scope; server retains store classification. Source: `src/features/overview/overview-links.ts`. |
| [Gate manager actions by the target store](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001690) | Candidate repair | Overview service/return actions respect target store and existing canManage flags. Source: `src/features/overview/OverviewPage.tsx`. |
| [Require current Ford history before counting it captured](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001697) | Candidate repair | Ford history counts require current evidence. Source: `server/overview-summary.mjs`. |
| [Count factory equipment for non-Ford record coverage](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001704) | Candidate repair | Non-Ford record coverage includes factory equipment instead of Ford-only documents. Source: `server/overview-summary.mjs`. |
| [Use the DealerMail capture time for hold provenance](https://github.com/TechSavvyJoe/inventory-flow/pull/54#discussion_r4138001713) | Current source accounted for | Replacement Overview shows evidence freshness rather than a false completedAt hold timestamp. Source: `src/features/overview/OverviewPage.tsx`. |

## PR 56

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Keep More selected on hidden move routes](https://github.com/TechSavvyJoe/inventory-flow/pull/56#discussion_r4139466945) | Candidate repair | Mobile More stays selected for secondary workflow routes. Source: `src/app/AppShell.tsx`. |

## PR 58

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Load saved-list rows only for saved-list requests](https://github.com/TechSavvyJoe/inventory-flow/pull/58#discussion_r4146386334) | Candidate repair | Worker reads employee list rows only for saved-list requests; positive and negative SQLite query tests. Source: `cloudflare/src/worker.mjs`. |
| [Derive disposition dates in the server timezone](https://github.com/TechSavvyJoe/inventory-flow/pull/58#discussion_r4146386347) | Candidate repair | Disposition dates use release timezone; UTC and daylight-saving regressions. Source: `src/features/overview/disposition-model.ts`. |
| [Keep disposition writer names out of the audit](https://github.com/TechSavvyJoe/inventory-flow/pull/58#discussion_r4146386364) | Candidate repair | Audit actor is null; disposition record/detail retains its original writer. Source: `server/admin-control-center.mjs`. |
| [Include a stable owner identity before enabling saved lists](https://github.com/TechSavvyJoe/inventory-flow/pull/58#discussion_r4146386374) | Current source accounted for | Merged PR59 adds stable employee ownership and late-response/reset fences in both clients. Source: `server/service-core.mjs`. |

## PR 61

| Review | Disposition | Current evidence / remaining work |
| --- | --- | --- |
| [Replace the new raw CSS dimensions with tokens](https://github.com/TechSavvyJoe/inventory-flow/pull/61#discussion_r4155016465) | Candidate repair | New Service action measurements use existing design tokens. Source: `src/features/service/ServiceDesk.css`. |
| [Route PDF image fetches through an authorized origin](https://github.com/TechSavvyJoe/inventory-flow/pull/61#discussion_r4155016472) | Open follow-up | Real dealer photos may render as img but fail PDF fetch CORS. Requires bounded authorized photo delivery and real-photo PDF acceptance. Source: `extension/sidepanel/lib/takehome-pdf.mjs`. |
| [Normalize missing service records as waiting](https://github.com/TechSavvyJoe/inventory-flow/pull/61#discussion_r4155016477) | Candidate repair | Missing/legacy service is normalized as Waiting in Sales Overview. Source: `src/features/overview/SalesOverview.tsx`. |
