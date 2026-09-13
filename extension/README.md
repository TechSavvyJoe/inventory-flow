# Inventory Flow Deal Desk — Chrome side panel

A companion to Inventory Flow for the moments you are already somewhere else: in DealerMail, CDK, email, or a customer's listing. Open the panel, type a stock number, and see in one glance whether the vehicle is held, where it physically is, what it costs, what it has, and what is happening to it — then copy what you need, print a take-home page, compare it with another, or jump straight to it in the app.

It is deliberately **read-only**. Every action that changes anything (requesting a vehicle, tracking a move) opens the corresponding screen in Inventory Flow, pre-filled, so the app's own validation, role rules, store rules and idempotency apply exactly as they do when you click the same button inside the app.

## Install (unpacked, for the dealership's own Chrome)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** → choose this `extension/` folder.
3. Pin "Inventory Flow Deal Desk" from the extensions menu. Click it, or press **Alt+Shift+V**, to open the side panel.
4. The first time, the panel asks you to sign in. Click **Open Inventory Flow**, sign in through Cloudflare Access as usual, then come back to the panel and press **Retry**. That sign-in is the only credential the panel ever uses.

No build step. Chrome 116 or newer.

## What it does

### Find the vehicle

- **Search as you type** across stock, VIN, vehicle, trim, color, equipment, price ("$51,800" or "51800"), mileage, store, hold state and — only when your role is allowed to see it — the salesperson and reason on a hold. The ranking is a port of the app's own search, so "F150" finds "F-150" and a one-letter slip still lands.
- **Scope** between your working store, all four stores, and vehicles with a current DealerMail hold, with live counts.
- **Filters & sort** (the list button beside the scopes, or `F`): combine make, model, body, drivetrain, fuel, home store, year range, price ceiling, mileage ceiling, certified, listed publicly, "no hold found" and "with photos" to narrow the list to the kind of vehicle a customer is describing; sort by price, mileage, year, time on the lot, or savings under MSRP. The active criteria are summarized under the scopes with a one-tap Clear, and the count updates live inside the sheet. Filters only ever offer values that exist in the current release.
- **Each row** shows a thumbnail, the stock plate, vehicle, price · mileage · age, the hold pill, any active move, a certified mark, and the current location with its provenance (a filled pin is app-confirmed custody; a hollow pin is a source report).

### Work the vehicle

- **Photos first**: a swipeable hero with the store's logo, a counter, arrow keys, and a thumbnail strip. When the listing has no photos the hero collapses to one line rather than a black box.
- **Identity and price**: stock plate, the store's certification badge (Ford Blue Advantage at the Ford stores, Lincoln Certified Pre-Owned at the Lincoln store — for Fords and non-Fords alike), the hold and movement pills, the listed price with a copy button, MSRP and the amount under MSRP.
- **Four status tiles** — DealerMail, Location, Movement, Public listing — each toned by its own evidence and tappable to the section that explains it. They stay separate facts; none is inferred from another.
- **Actions**: Request vehicle, Open in app, Compare, Deal sheet (copies every identifying and pricing fact as text), Take-home page, DealerMail (copies the stock number, then opens DealerMail inventory), Track move.
- **Overview tab**: one-tap document tiles (AutoCheck with its score, window sticker, OASIS and Ford invoice for Ford/Lincoln VINs, the dealer listing, the vAuto equipment label — unavailable ones say why); the **deal sheet** with a copy button on every field (stock, VIN, listed price, MSRP, base MSRP, options total, destination & delivery, sticker total, miles, in-service estimate, colors, engine, transmission, drivetrain, model code, home store — copies are plain digits for money and miles so they paste cleanly into DealerMail, CDK or a worksheet); the **factory warranty** card (below); standout equipment; specifications.
- **Hold & custody tab**: the DealerMail record as one card — position, salesperson, placed/expected dates, reason, backups, CDK, saved comments and alerts (all exactly as the server redacts them for your role) — with its actions underneath, then Location, Movement and the manager log.
- **Equipment tab**: every published item from the website, the vAuto equipment label and any captured original sticker, de-duplicated with the strongest source winning, grouped into the app's categories (packages, driver assistance, towing, comfort, technology, performance) as collapsible lists with a source dot per item; packages with prices; a Copy list button.
- **Records tab**: the AutoCheck report (score, comparison range, owners, use, last odometer, estimated in-service date, and each history check toned clear / review / unknown), the original window sticker pricing (base, options, destination, total — in the sticker's own currency), the equipment label, the public-listing scan (first/last seen, sources), the dealer description, and the last change.
- **Compare** up to three vehicles side by side (the Compare chip, `C`, or the column icon in the toolbar): every deal fact with differences highlighted, and the equipment only one of them has. The set stays until you clear it.
- **Take-home page**: a one-page, branded PDF for the customer — store logo and name, photos, price/MSRP/savings, mileage, stock and VIN, specifications, highlights, equipment, the website description and the certification terms. Nothing operational (holds, custody, moves, manager log, warranty estimates) is on it. It opens in a tab with a Print / Save as PDF button.

### Original in-service date and remaining factory warranty

The **Factory warranty** card on the Overview tab shows the original in-service date and how much of the new-vehicle warranty is likely left. The date is AutoCheck's *estimate*; the authoritative date is the **Warranty Start Date on OASIS** for Ford and Lincoln VINs, and the sale/registration dates on the full AutoCheck report for other makes, so the card links to whichever applies. Bumper-to-bumper, powertrain and (for hybrids and EVs) unique-component and battery terms are computed from the make's published US terms and the vehicle's current miles — edit the odometer field to recalculate, the way AutoCheck's own calculator at the bottom of its report does. Lines printed on a captured window sticker are shown verbatim. The store's certification (Ford Blue Advantage — Blue or Gold tier — at the Ford stores, Lincoln Certified Pre-Owned — Select or Signature — at the Lincoln store) is shown separately because it is separate: an inspection and its own comprehensive limited warranty, not a change to what transfers with the vehicle. The feed only says certified, so both tiers are listed and the inspection sheet settles which applies. Terms that changed by model year (Ram's 10-year powertrain from 2026, Buick's and Volkswagen's shorter terms from 2020, the Toyota/Lexus 10-year hybrid battery from 2020) are picked by the vehicle's model year.

The same outlook appears in the app's vehicle workspace under Records.

- **Right-click any selected text** on any page → "Search Inventory Flow for …" opens the panel with that text as the query.
- **Keyboard:** `/` focuses search, `F` opens filters, `↑`/`↓` move through results, `Enter` opens, `Esc` goes back or clears, `S`/`V` copy stock or VIN, `C` toggles Compare, `1`–`4` jump between a vehicle's tabs, `←`/`→` step through photos when the hero is focused.
- Follows your system theme (with a light/dark override), comfortable or compact density (compact hides thumbnails), and adapts from Chrome's 320 px minimum panel width up.

The footer always shows which release the panel is reading and when it last checked; it re-checks quietly when the panel comes back into view after five minutes.

## How authentication works

The panel calls `GET /api/bootstrap` on the app with `credentials: 'include'`. Chrome treats requests from an extension that holds `host_permissions` for an origin as same-site, so the Cloudflare Access session cookie you already have for Inventory Flow is sent and the app answers exactly as it would for a browser tab. Opening a vehicle fetches `GET /api/vehicles/{vin}` the same way, which is where the role-filtered DealerMail evidence (backups, comments, alerts, CDK), AutoCheck, sticker and equipment-label records come from.

In production the panel always fetches before it shows anything: a shared Chrome profile can change Access users, and a cached document is one user's role-and-store projection. The session cache is only ever displayed for the synthetic demo. Nothing else is stored except your display preferences, the compare set, the active filters, and the take-home model handed to the print tab — all session-scoped.

The panel never sends a `POST`. Chrome stamps extension-originated writes with `Origin: chrome-extension://…`, which the app rejects by design; the panel does not try to work around that. If a future version needs an in-panel write, the app's Worker would have to allowlist a pinned extension ID explicitly — a deliberate product decision, not a switch to flip here.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | The panel is the whole product. |
| `storage` | Display preferences (`sync`); a session-only copy of the inventory document, the compare set, filters and the take-home handoff (`session`). |
| `contextMenus` | The "Search Inventory Flow for …" entry on selected text. |
| `https://inventory-ops.joegallant.me/*` | The only production data source. |
| `http://127.0.0.1:4173/*`, `http://localhost:4173/*` | The synthetic `pnpm dev:demo` server, selectable from Settings for training and development. |

No `tabs`, no `activeTab`, no `<all_urls>`, no content scripts. The panel does not read the pages you are on. Vehicle photos load straight from the dealership websites (the CSP allows `https:` images only).

## Development

```sh
pnpm dev:demo              # synthetic API on 4174, app on 4173
pnpm extension:preview     # serves the panel at http://127.0.0.1:4177/sidepanel/index.html
pnpm extension:icons       # re-render icons from public/brand-kit/inventory-flow-icon.svg (via Playwright's Chromium)
pnpm test                  # includes tests/unit/extension-*.test.ts
```

`extension:preview` serves the panel as a plain page with `/api` proxied to the demo, so the exact UI can be reviewed and screenshotted at any width without loading the extension; the Settings sheet notes when it is running that way. Add `?photos=1` to the preview URL to paint generated placeholder photos, because the synthetic fixture publishes none. Reload the unpacked extension after editing to pick up changes.

The panel is plain ES modules with no bundler. `sidepanel/lib/` holds the pure logic — search ranking, view model, filters, equipment categorization, compare, warranty, take-home model, links, API — each covered by unit tests; `panel.js` is the UI; `print.js` renders the take-home page; `service-worker.js` only opens the panel and forwards a text selection. `equipment.mjs`, `warranty.mjs` and the view model mirror `src/features/inventory/` in the app; keep them in step when the app's rules change.

## Distribution

For the dealership's Chrome fleet, publish as an **unlisted** Chrome Web Store item or push it with the `ExtensionInstallForcelist` policy. Either way, generate a key once (upload a draft to the Developer Dashboard and copy its public key into a `"key"` field in a development copy of `manifest.json`) so the extension ID is stable before the first publish; strip the `"key"` from the uploaded package. Screenshots for a listing must come from `pnpm dev:demo`, never from the protected host.

## Design notes

Plan and self-review, kept so the next change starts from the same intent:

- Grounded in the lot's vernacular: the **stock plate** — a flat bordered tag with tabular numerals — is each row's identity, because staff talk in stock numbers. That and the price are the elements allowed to draw the eye; everything else is hairlines, navy, and a single Ford blue.
- Structure carries meaning: the four status tiles are separate because the app's product rule keeps listing, hold, movement and location separate; tone comes from a left rule and an icon tint, never a filled background. Cards separate sections; tabs cap the scroll.
- Sibling of the app on purpose: same Inter, same tokens (`src/styles/tokens.css`), same hold and location wording, same equipment categories. A companion that looked like a different product would cost trust.
- "No current DealerMail hold found" renders **neutral, never green**; the app's rule is that it is not an availability promise, and the color would say otherwise.
- Motion answers actions only: list→detail→compare push (280 ms, iOS curve), pill and tab indicators slide, tab panels settle in, copy buttons turn into a check, warranty meters fill. Nothing animates on load beyond the first eight rows settling in. `prefers-reduced-motion` turns it all off.
- The take-home page is customer-facing by construction: its model is built from a whitelist of published fields and a test asserts that hold, custody, movement and warranty-estimate data never serialize into it.
- Rejected on review as "the default for this brief": thumbnail cards, ALL-CAPS eyebrows, gradient masthead, a colored status row background, a score dial. Empty and error states name the query and the filters and say what to do next.
