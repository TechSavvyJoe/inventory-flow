# Chrome Web Store Listing — Inventory Flow Deal Desk

> Last Updated: 2026-09-23

This file is the single source of truth for the store listing. Update it whenever
`manifest.json`, permissions, data handling, or user-facing behavior change, and add a
Version History row for every release submitted to the Chrome Web Store.

## Store Listing

**Extension Name**
Inventory Flow Deal Desk

**Short Description** (116 of 132 characters)
Search Maxey inventory, see hold and location status, and request a vehicle from a side panel while you work a deal.

**Detailed Description**
Inventory Flow Deal Desk puts your dealership's inventory one keyboard shortcut away, wherever you're already working — DealerMail, CDK, email, or a customer's online listing.

Search by stock number, VIN, vehicle, trim, color, price, mileage, or equipment and see results ranked the same way as Inventory Flow itself. Each vehicle shows its DealerMail hold status, service status, confirmed or reported location, pricing, equipment, and captured vehicle-history highlights, all kept as separate, clearly labeled facts — nothing is inferred from anything else.

Compare up to three vehicles side by side, print a customer take-home sheet, or copy stock/VIN/deal details with one action. Select any text on any page and right-click to search Inventory Flow for it instantly.

The panel is read-only by design. Any action that changes something — requesting a vehicle transfer, tracking a move — opens the matching screen in Inventory Flow itself, pre-filled, so the app's own sign-in, role rules, and validation apply exactly as if you had clicked the same button inside Inventory Flow. The extension never submits data anywhere on its own.

The panel reuses your existing sign-in: it reads Inventory Flow's own API using the Cloudflare Access session cookie you already have from signing into the app in your browser. It does not collect analytics, does not use tracking, and does not load any code from outside the extension package.

Built for one dealership group's own inventory system; it only talks to that system's production address and, for training, a local development server. It has no use outside that internal system.

Questions or issues: contact your Inventory Flow administrator.

**Category**
Productivity

**Single Purpose**
Let dealership staff search their own store's live inventory and view a vehicle's hold, location, service and pricing status from a Chrome side panel, without leaving the page they're on.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `extension/icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
Capture screenshots only from `pnpm dev:demo` (synthetic data), never from the protected
production host — see `extension/README.md` "Distribution" and the root `AGENTS.md` git rule
against committing authenticated-page captures. Suggested shots: (1) the search list with a
row expanded to show hold/service/location facts, (2) a vehicle detail view's Holds & moves
tab, (3) the compare view with two or three vehicles.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `sidePanel` | permissions | The extension's entire UI is a Chrome side panel; this permission is what lets the extension register and open it. |
| `storage` | permissions | Saves the user's display preferences (theme, density, home store) via `chrome.storage.sync`, and keeps a session-only copy of the fetched inventory list, the compare set, active filters, and a take-home-page handoff via `chrome.storage.session`. Nothing here is synced or sent anywhere outside the user's own Chrome profile. |
| `contextMenus` | permissions | Adds the single "Search Inventory Flow for …" entry that appears when the user selects text and right-clicks, letting them open the panel pre-filled with that selection. |
| `scripting` | permissions | Runs one read-only check inside an already open, signed-in DealerMail inventory tab (`/prospect_manager/`): it fetches the selected stock's hold-detail page and returns only the hold status, the active-order count and the check time. It never submits, holds, releases or comments, and no names, notes, cookies or page HTML leave that tab. |
| `https://inventory-ops.joegallant.me/*` | host_permissions | The dealership group's own production Inventory Flow application — the panel's source for inventory, the daily hold snapshot, and vehicle-status data. |
| `https://www.dealermail.com/*`, `https://dealermail.com/*` | host_permissions | Lets the panel find the user's open DealerMail inventory tab and run the live hold check above there. DealerMail stays read-only evidence. |

No `tabs`, `activeTab`, `<all_urls>`, or declared content scripts are requested. The panel
never reads the content of the page the user is on, except the live hold check above, which
runs only in a DealerMail inventory tab — the context-menu handler only receives the text the
user already selected, via Chrome's built-in `selectionText`.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No.

The extension does not collect, transmit, or store any data of its own. It reads the
dealership's existing Inventory Flow application using the browser's own Cloudflare Access
sign-in session, exactly as a browser tab open to that application would. It sends no
analytics, telemetry, or crash reports, and it never submits (`POST`/`PUT`/`PATCH`/`DELETE`)
data to Inventory Flow or anywhere else — every action that changes something opens the
matching Inventory Flow screen instead, in a normal browser tab, where the app's own sign-in
and validation apply.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No (reused, not collected) | Yes — the existing Cloudflare Access session cookie, sent only to the dealership's own `inventory-ops.joegallant.me` origin, the same way it would be from a browser tab | Lets the panel read inventory data the signed-in user is already authorized to see | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | No | No | The context-menu action reads only text the user has actively selected on the current page, to prefill a search; it is not stored beyond that single search and is never sent anywhere but the extension's own panel. The live hold check reads the selected stock's DealerMail hold-detail page inside the user's own DealerMail tab and returns only the hold status and active-order count to the panel; nothing is sent elsewhere | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes
- [x] Data is NOT used to serve personalized, re-targeted, or interest-based advertisements
- [x] No remote code is loaded, executed, or fetched at runtime — the extension package (this reviewed, tracked `extension/` source) is the entire program

## Privacy Policy

**Privacy Policy URL** [REQUIRED — not yet published]

This is an internal tool distributed to one dealership group's own staff (unlisted listing or
`ExtensionInstallForcelist`, per `extension/README.md` "Distribution"), so a general public
privacy policy has not been published. Before any **public** Chrome Web Store listing, publish
a short policy (see the skill's `references/webstore/privacy-policy.md`) stating plainly: the
extension collects no data of its own; it reuses the browser's existing Cloudflare Access
sign-in to read the dealership's own inventory system; a selected-text search query is read
locally and never leaves the browser except as a search inside the panel; no analytics, no
advertising, no data sale, no remote code. Host it at a stable, publicly reachable URL (e.g. a
page under the dealership's own domain or a GitHub Pages page) and keep this section's URL in
sync with whatever is filed on the Developer Dashboard's data-disclosure form.

## Distribution

**Visibility**: Unlisted (dealership-fleet install), per `extension/README.md` "Distribution" —
not intended for public Chrome Web Store search.
**Regions**: N/A — single dealership group, distributed via `ExtensionInstallForcelist` policy
or an unlisted store link, not general public search.

## Developer Info

**Publisher Name** [REQUIRED — fill in before submission]

**Contact Email** [REQUIRED — fill in before submission]

**Support URL / Email**
Contact your Inventory Flow administrator (internal tool; no public support channel).

**Homepage URL**
`https://inventory-ops.joegallant.me` (Cloudflare Access required; not publicly browsable)

## Version History

<!-- Source: `git log --follow --format='%h %ad %s' --date=short -- extension/manifest.json` -->

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.2.1 | 2026-09-15 | Focus workflows and vehicle records pass (commit `75a3733`) | Not submitted |
| 1.2.0 | 2026-09-15 | Finished workflow and access polish for the 1.2.0 release (commit `d65cb2c`) | Not submitted |
| 1.2.0 | 2026-09-15 | Inventory Flow production redesign the panel mirrors (commit `052f70a`) | Not submitted |
| 1.0.0 | 2026-09-12 | Added the Deal Desk Chrome side panel (commit `2af198b`) | Not submitted |

No version of this extension has been submitted to the Chrome Web Store yet; all rows above
are reconstructed from `extension/manifest.json` history for when a first submission is made.

## Review Notes

### Known Issues / Limitations
- No screenshots exist yet; they must come from `pnpm dev:demo` only (never the protected
  host — see the root `AGENTS.md` git rules and `extension/README.md` "Distribution").
- No public privacy policy is published yet (see "Privacy Policy" above) — required before any
  **public** listing; may be unnecessary for a Forcelist-only internal deployment, but Chrome
  Web Store review still expects the data-disclosure form to be filled in accurately either way.
- Publisher/contact fields above are placeholders; fill in before the Developer Dashboard
  submission.
- `extension/README.md` "Distribution" recommends generating a stable extension key before the
  first publish (upload a draft, copy its public key into a development copy of
  `manifest.json`'s `"key"` field) so the extension ID does not change across reinstalls; strip
  `"key"` from the uploaded package itself.

### Rejection History
None — not yet submitted.

## Policy references consulted (2026-09-19)

- Single purpose: https://developer.chrome.com/docs/webstore/program-policies/policies
- Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- User data / privacy policy requirements: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- 2026 policy updates (user-data-purpose tightening): https://developer.chrome.com/blog/cws-policy-updates-2026
