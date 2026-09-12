# Inventory Flow Deal Desk — Chrome side panel

A companion to Inventory Flow for the moments you are already somewhere else: in DealerMail, CDK, email, or a customer's listing. Open the panel, type a stock number, and see in one glance whether the vehicle is held, where it physically is, what it costs, and what is happening to it — then request it or jump straight to it in the app.

It is deliberately **read-only**. Every action that changes anything (requesting a vehicle, tracking a move) opens the corresponding screen in Inventory Flow, pre-filled, so the app's own validation, role rules, store rules and idempotency apply exactly as they do when you click the same button inside the app.

## Install (unpacked, for the dealership's own Chrome)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** → choose this `extension/` folder.
3. Pin "Inventory Flow Deal Desk" from the extensions menu. Click it, or press **Alt+Shift+V**, to open the side panel.
4. The first time, the panel asks you to sign in. Click **Open Inventory Flow**, sign in through Cloudflare Access as usual, then come back to the panel and press **Retry**. That sign-in is the only credential the panel ever uses.

No build step. Chrome 116 or newer.

## What it does

- **Search as you type** across stock, VIN, vehicle, trim, color, equipment, price ("$51,800" or "51800"), mileage, store, hold state and — only when your role is allowed to see it — the salesperson and reason on a hold. The ranking is a port of the app's own search, so "F150" finds "F-150" and a one-letter slip still lands.
- **Scope** between your working store, all four stores, and vehicles with a current DealerMail hold, with live counts.
- **Each row** shows the stock plate, vehicle, price · mileage · age, the hold pill, any active move, and the current location with its provenance (a filled pin is app-confirmed custody; a hollow pin is a source report).
- **Vehicle view** keeps the four facts the app keeps separate — DealerMail hold, physical location, app movement, and public listing — as separate labeled sections, plus manager-log evidence (flagged when its source is not current), equipment, official documents (original-sticker totals keep their own currency) and photos. Location and movement come from the app's own ledger even when the transfer itself is withheld from your store, which is how the server lets other stores locate a group vehicle.
- **Actions:** Request vehicle (opens `/transfers/new` in the app with the VIN filled in, only when your role may request and the vehicle is not already at your store or in motion), Open in app, Track move, copy stock or VIN, open the dealer listing, open DealerMail inventory (copies the stock number first, the same way the app does), AutoCheck, window sticker and the vAuto equipment label.
- **Right-click any selected text** on any page → "Search Inventory Flow for …" opens the panel with that text as the query.
- **Keyboard:** `/` focuses search, `↑`/`↓` move through results, `Enter` opens, `Esc` goes back or clears, `S`/`V` copy stock or VIN from a vehicle.
- Follows your system theme (with a light/dark override), comfortable or compact density, and adapts from Chrome's 320 px minimum panel width up.

The footer always shows which release the panel is reading and when it last checked; it re-checks quietly when the panel comes back into view after five minutes.

## How authentication works

The panel calls `GET /api/bootstrap` on the app with `credentials: 'include'`. Chrome treats requests from an extension that holds `host_permissions` for an origin as same-site, so the Cloudflare Access session cookie you already have for Inventory Flow is sent and the app answers exactly as it would for a browser tab. Opening a vehicle fetches `GET /api/vehicles/{vin}` the same way, which is where the role-filtered DealerMail evidence (backups, comments, alerts, CDK) and official documents come from.

In production the panel always fetches before it shows anything: a shared Chrome profile can change Access users, and a cached document is one user's role-and-store projection. The session cache is only ever displayed for the synthetic demo. Nothing else is stored except your display preferences.

The panel never sends a `POST`. Chrome stamps extension-originated writes with `Origin: chrome-extension://…`, which the app rejects by design; the panel does not try to work around that. If a future version needs an in-panel write, the app's Worker would have to allowlist a pinned extension ID explicitly — a deliberate product decision, not a switch to flip here.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | The panel is the whole product. |
| `storage` | Display preferences (`sync`) and a session-only copy of the inventory document (`session`). |
| `contextMenus` | The "Search Inventory Flow for …" entry on selected text. |
| `https://inventory-ops.joegallant.me/*` | The only production data source. |
| `http://127.0.0.1:4173/*`, `http://localhost:4173/*` | The synthetic `pnpm dev:demo` server, selectable from Settings for training and development. |

No `tabs`, no `activeTab`, no `<all_urls>`, no content scripts. The panel does not read the pages you are on.

## Development

```sh
pnpm dev:demo              # synthetic API on 4174, app on 4173
pnpm extension:preview     # serves the panel at http://127.0.0.1:4177/sidepanel/index.html
pnpm extension:icons       # re-render icons from public/brand-kit/inventory-flow-icon.svg (via Playwright's Chromium)
pnpm test                  # includes tests/unit/extension-*.test.ts
```

`extension:preview` serves the panel as a plain page with `/api` proxied to the demo, so the exact UI can be reviewed and screenshotted at any width without loading the extension; the Settings sheet notes when it is running that way. Reload the unpacked extension after editing to pick up changes.

The panel is plain ES modules with no bundler. `sidepanel/lib/` holds the pure logic (search ranking, view model, links, API), each covered by unit tests; `panel.js` is the UI; `service-worker.js` only opens the panel and forwards a text selection.

## Distribution

For the dealership's Chrome fleet, publish as an **unlisted** Chrome Web Store item or push it with the `ExtensionInstallForcelist` policy. Either way, generate a key once (upload a draft to the Developer Dashboard and copy its public key into a `"key"` field in a development copy of `manifest.json`) so the extension ID is stable before the first publish; strip the `"key"` from the uploaded package. Screenshots for a listing must come from `pnpm dev:demo`, never from the protected host.

## Design notes

Plan and self-review, kept so the next change starts from the same intent:

- Grounded in the lot's vernacular: the **stock plate** — a flat bordered tag with tabular numerals — is each row's identity, because staff talk in stock numbers. That is the one element allowed to draw the eye; everything else is hairlines, navy, and a single Ford blue.
- Sibling of the app on purpose: same Inter, same tokens (`src/styles/tokens.css`), same hold and location wording. A companion that looked like a different product would cost trust.
- "No current DealerMail hold found" renders **neutral, never green**; the app's rule is that it is not an availability promise, and the color would say otherwise.
- Motion answers actions only: list→detail push (280 ms, iOS curve), pill indicator slides, copy buttons turn into a check. Nothing animates on load beyond the first eight rows settling in. `prefers-reduced-motion` turns it all off.
- Rejected on review as "the default for this brief": thumbnail cards, ALL-CAPS eyebrows, gradient masthead, a colored status row background. Empty and error states name the query and say what to do next.
