# Inventory Flow Deal Desk — Chrome side panel

A companion to Inventory Flow for the moments you are already somewhere else: in DealerMail, CDK, email, or a customer's listing. Search your store's inventory, see the vehicle's hold and service status, reported or confirmed location, pricing, equipment and captured reports, then copy useful details, compare vehicles, print a customer sheet, or continue in the app. The compact white, navy and blue interface matches Inventory Flow rather than behaving like a separate product.

It is deliberately **read-only**. Every action that changes anything (requesting a vehicle, tracking a move) opens the corresponding screen in Inventory Flow, pre-filled, so the app's own validation, role rules, store rules and idempotency apply exactly as they do when you click the same button inside the app.

## Install (unpacked, for the dealership's own Chrome)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** → choose this `extension/` folder.
3. Pin "Inventory Flow Deal Desk" from the extensions menu. Click it, or press **Alt+Shift+V**, to open the side panel.
4. The first time, the panel asks you to sign in. Click **Open Inventory Flow**, sign in through Cloudflare Access as usual, then come back to the panel and press **Retry**. When DealerMail is open and signed in in another tab, the panel can also check the selected vehicle's current hold directly there. It never reads or stores either site's credentials.

No build step. Chrome 116 or newer.

### Update an unpacked copy, including on a Mac

Editing the repository on another computer does **not** update or install the extension in your Mac's Chrome. Copy or extract the current `extension/` folder onto the Mac first. If Chrome already loads that local folder, replace its contents with the updated files and click **Reload** on the Inventory Flow Deal Desk card at `chrome://extensions`. If the files are in a different folder, use **Load unpacked** to select the new folder and remove the obsolete copy once the new one is working. Close and reopen the side panel after reloading. Refreshing the website or browser preview alone does not update an installed extension.

## What it does

### Find the vehicle

- **Search as you type** across stock, VIN, vehicle, trim, color, equipment, price ("$51,800" or "51800"), mileage, store, hold state and — only when your role is allowed to see it — the salesperson and reason on a hold. The ranking is a port of the app's own search, so "F150" finds "F-150" and a one-letter slip still lands.
- **Your store first**: the home-store selector starts at your signed-in working store. **All**, **Held**, and **Moving** share one compact row beside **Filters**. These views stay inside the selected store; Held and Moving never silently expand to the whole group. Search counts reflect the current query and filters. **All stores +N** beside the result count shows the additional matches and preserves the query, filters and active view; **All stores** is also available in the store selector. All-store results are grouped by home store, with your store first. The return button uses your home store's name, such as **Howell**, rather than a generic My store label.
- **Three service states**: inventory rows, vehicle details, and filters use exactly **Waiting for service**, **In service**, and **Ready**. The Filters sheet starts with direct **All / Waiting for service / In service / Ready** buttons, so ready-only inventory does not require another dropdown or a permanent extra tab row. Service filtering is independent of store and the All/Held/Moving view. A missing service record stays Waiting and is identified as needing manager confirmation. Inventory age and website visibility never establish Ready. Detail shows recorded service dates and opens the exact vehicle in Inventory Flow for a permitted update. See [the shared service contract](../docs/SERVICE_READINESS.md).
- **Filters & sort** (the visible **Filters** button or `F`): service comes first, followed by sorting and make, model, body, drivetrain, fuel, home store, year, price, mileage, certification, public listing, "no hold found" and "with photos" criteria. Sort by relevance, price, mileage, year, time on the lot, or savings under MSRP. Active criteria are summarized below the controls with Clear, and the result count updates inside the sheet. Filter choices come from the current release.
- **Each row** organizes a 4:3 photo, stock, vehicle name and price/mileage/age first; readable specification lines, store/location, hold, service and movement follow in distinct groups. Authorized hold details take priority in Held. Captured report highlights have their own compact area. Comfortable and compact density both retain vehicle photos; compact reduces spacing, not the information hierarchy. A broken first photo falls through to later gallery images.
- **Captured report highlights** appear directly in results: priority history findings, score/owners, original MSRP/equipment, or Ford service actions when captured. Rows keep one keyboard action to open the vehicle; saved details and original-source buttons are separate controls in the detail view. No per-row report request is needed.
- **New**, **Prices**, **Moves**, **Service**, and **Actions** form one five-item navigation row. They open the corresponding New inventory, Price changes, Vehicle moves, Service, and Action center screens in Inventory Flow; there is no extra submenu or duplicate navigation strip.

### Work the vehicle

- **Work first**: vehicle identity, price, a compact service/status line and the main actions lead the detail view. The section strip has four tabs — **Overview**, **Equipment**, **Records**, **Holds & moves** — alongside clearly separate **Service** and **Compare** actions. Selecting a different tab brings its section start into view rather than retaining a deep position from the previous section.
- **Identity and status**: stock and VIN copy controls, listed price, the store's certification badge, hold, service and movement remain easy to find. DealerMail hold, public listing, app movement, physical-location evidence and service readiness stay distinct; a source report or a missing hold never establishes availability. The former four large status tiles are replaced by compact facts and the dedicated Holds & moves section.
- **Actions**: one move action, **Request move** or **View move**, based on the server's current state, plus **Open in app**. **Service** opens the exact vehicle's service screen; **Compare** adds or removes it from comparison. Actions that cannot apply are omitted rather than shown as competing disabled buttons. A persistent utility footer contains **Deal sheet** (copy all identifying/pricing details), **Take-home page**, and **DealerMail** when permitted; there is no Other options menu or large per-field copy ledger in Overview.
- **Overview tab**: a compact photo gallery with store logo, counter, arrow-key navigation and additional thumbnails when available; key specifications; branded document summaries with up to five relevant captured facts each; full vehicle details and equipment highlights. AutoCheck, window sticker, OASIS and vAuto keep their own identities. **View saved details** and **Open original source / Open source document / Open lookup** are separate actions. Ford invoice and dealer listing remain explicit links. Missing photos collapse to a short empty state. The **Warranty calculator** is a named, optional control rather than a large block that must be scrolled past.
- **Holds & moves tab**: the DealerMail record shows position, salesperson, placed/expected dates, reason, backups, CDK, saved comments and alerts only as the server permits for the role. Location, movement and manager-log evidence follow as separate sections, with the relevant actions directly available.
- **Live hold check**: the daily snapshot is labeled with its capture time. With an authenticated DealerMail inventory tab open in the same browser window, opening a vehicle checks that exact stock's hold-detail page without changing any hold. A deleted hold is removed from the panel immediately; a new hold is shown without copying names or reasons from an older snapshot. A missing session, mismatched stock, or unreadable response leaves the hold unverified. The selected vehicle is rechecked while its panel remains open. Other vehicles remain daily-snapshot facts until opened and checked; the full Inventory Flow release still follows its validated daily publication process.
- **Equipment tab**: published website items, vAuto equipment and captured original-sticker items are de-duplicated with the strongest source winning. Readable category ledgers expose the items directly, with source labels, packages/prices where captured, and one **Copy list** action. Categories are not hidden in nested collapsible lists.
- **Records tab**: compact AutoCheck score/owners/use/service/odometer metrics and bordered history checks lead the page. OASIS warranty dates, service actions, and captured coverage follow before sticker and long equipment lists. Original sticker pricing retains its recorded currency; vAuto reference pricing never borrows a sticker currency. Operational facts stay visible, while each provider's **Source details** disclosure holds capture metadata, source limitations and duplicate equipment-label pricing. Source warnings remain signposted before expansion. Named provider jumps and direct report/lookup actions stay available. Empty OASIS data never establishes a clear recall result or service readiness.
- **Compare** up to three vehicles using the visible Compare action, `C`, or the toolbar's column icon. Readable vehicle columns and labeled fact rows expose differences and equipment unique to each vehicle; the set stays until cleared.
- **Take-home page**: a branded customer sheet with store logo/name, photos, price/MSRP/savings, mileage, stock/VIN, specifications, equipment highlights, listing description and certification terms. It opens in a tab with **Print / Save as PDF** and an explicit listing link. The equipment summary identifies omitted items; printed long descriptions and sections can continue onto another page without being clipped to a fixed page height. Nothing operational — holds, custody, moves, manager log or warranty estimates — is included.

### Frequently used vehicle facts

Overview and Records show two bordered shortcuts: **Base MSRP** for registration lookup, and **Warranty in-service**. Base MSRP uses the original sticker price, not a separate fee line or total MSRP; its fallback is marked **reference** with unknown currency preserved. OASIS is identified when it supplies the warranty date; AutoCheck dates are marked as estimates. Missing values say **Not captured**. Inventory date remains in Overview's full vehicle details. Records has named jump buttons, and **View saved details** opens the matching provider section with visible keyboard focus.

### Original in-service date and remaining factory warranty

Open **Warranty calculator** in Overview to see the **Factory warranty estimate** and edit the odometer used for the calculation. It uses AutoCheck's estimated in-service date and the existing make/model-year US term tables; it is not a newly verified manufacturer coverage result. For Ford and Lincoln, the **Warranty Start Date on OASIS** takes precedence over the AutoCheck estimate. When an OASIS start date was captured, the calculator identifies it separately and links to Records; it does not silently substitute it into the AutoCheck calculation. Captured AutoCheck warranty estimates, captured OASIS coverage and printed sticker warranty text remain separately labeled. Use the source lookup for current confirmation.

The store's certification is also separate: Ford Blue Advantage at the Ford stores or Lincoln Certified Pre-Owned at the Lincoln store. The feed only establishes certification, not the precise tier; the inspection sheet and actual coverage documents determine which terms apply. This redesign changes presentation, not the warranty term tables or certification rules.

The same outlook appears in the app's vehicle workspace under Records.

- **Right-click any selected text** on any page → "Search Inventory Flow for …" opens the panel with that text as the query.
- **Keyboard:** `/` focuses search, `F` opens filters, `↑`/`↓` move through results, `Enter` opens, `Esc` goes back or clears, `S`/`V` copy stock or VIN, `C` toggles Compare, `1`–`4` jump between a vehicle's tabs, `←`/`→` step through photos when the hero is focused.
- New installs default to the app-aligned **light** theme. Existing saved light, dark or system preferences are preserved. Comfortable and compact density both keep photos, and the layout adapts from Chrome's 320 px minimum panel width up. Primary navigation, filters and interactive controls use 44 px touch targets.

The footer always shows which release the panel is reading and when it last checked; it re-checks quietly when the panel comes back into view after five minutes.

## How authentication works

The panel calls `GET /api/bootstrap` on the app with `credentials: 'include'`. Chrome treats requests from an extension that holds `host_permissions` for an origin as same-site, so the Cloudflare Access session cookie you already have for Inventory Flow is sent and the app answers exactly as it would for a browser tab. The bootstrap already carries captured AutoCheck, sticker, equipment-label, OASIS and warranty records for visible vehicles. Opening a vehicle fetches `GET /api/vehicles/{vin}` to add public-scan context and role-filtered DealerMail evidence (backups, comments, alerts, CDK).

In production the panel always fetches before it shows anything: a shared Chrome profile can change Access users, and a cached document is one user's role-and-store projection. A failed sign-in/membership refresh clears the prior inventory, detail and compare projection. Changing user, role or store resets search and scope, and a late detail response from the prior identity is discarded. The session cache is only ever displayed for the synthetic demo. Display preferences are sync-scoped; compare, filters, cached demo data and take-home handoffs are session-scoped.

The panel never sends a `POST`. Chrome stamps extension-originated writes with `Origin: chrome-extension://…`, which the app rejects by design; the panel does not try to work around that. If a future version needs an in-panel write, the app's Worker would have to allowlist a pinned extension ID explicitly — a deliberate product decision, not a switch to flip here.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | The panel is the whole product. |
| `storage` | Display preferences (`sync`); a session-only copy of the inventory document, the compare set, filters and the take-home handoff (`session`). |
| `contextMenus` | The "Search Inventory Flow for …" entry on selected text. |
| `https://inventory-ops.joegallant.me/*` | The only production data source. |
| `http://127.0.0.1:4173/*`, `http://localhost:4173/*` | The synthetic `pnpm dev:demo` server, selectable from Settings for training and development. |

No `tabs`, no `activeTab`, no `<all_urls>`, no content scripts. The panel does not read the pages you are on. Production vehicle photos pass the existing HTTPS URL guard and load from their source URLs. The CSP separately permits bundled images, local-demo loopback images and preview placeholders; that does not broaden production source-link validation or give the panel page-reading access.

## Development

```sh
pnpm dev:demo              # synthetic API on 4174, app on 4173
pnpm extension:preview     # serves the panel at http://127.0.0.1:4177/sidepanel/index.html
pnpm extension:icons       # re-render icons from public/brand-kit/inventory-flow-icon.svg (via Playwright's Chromium)
pnpm test                  # includes tests/unit/extension-*.test.ts
```

`extension:preview` serves the panel as a plain page with `/api` proxied only to the synthetic demo, so the UI can be reviewed and screenshotted without loading the extension; Settings identifies preview mode. The exact eight known demo VINs automatically use the same existing 1536 × 1024 generated vehicle illustrations as the main app, served through an allowlisted `/demo-vehicles/` route. These are synthetic illustrations, not photographs or equipment evidence for real inventory. The shared mapping never substitutes photos for a non-fixture VIN, and the browser-preview fallback is inactive in the installed Chrome extension. Production photo guards and permissions are unchanged.

Optional `?photos=1` retains the older drawn placeholders only for preview edge cases with neither a usable source photo nor a mapped synthetic illustration. Normal demo vehicles do not require the flag. Restart the preview server after changing its asset routes; reload an unpacked extension separately after editing or transferring its files.

The panel is plain ES modules with no bundler. `sidepanel/lib/` holds the pure logic — search ranking, view model, filters, equipment categorization, compare, warranty, take-home model, links, API — each covered by unit tests; `panel.js` is the UI; `print.js` renders the take-home page; `service-worker.js` only opens the panel and forwards a text selection. `equipment.mjs`, `warranty.mjs` and the view model mirror `src/features/inventory/` in the app; keep them in step when the app's rules change.

## Distribution

For the dealership's Chrome fleet, publish as an **unlisted** Chrome Web Store item or push it with the `ExtensionInstallForcelist` policy. Either way, generate a key once (upload a draft to the Developer Dashboard and copy its public key into a `"key"` field in a development copy of `manifest.json`) so the extension ID is stable before the first publish; strip the `"key"` from the uploaded package. Screenshots for a listing must come from `pnpm dev:demo`, never from the protected host.

## Design notes

Plan and self-review, kept so the next change starts from the same intent:

- Grounded in the lot's vernacular: the **stock plate** — a flat bordered tag with tabular numerals — is each row's identity, because staff talk in stock numbers. That and the price are the elements allowed to draw the eye; everything else is hairlines, navy, and a single Ford blue.
- Structure carries meaning: grouped row facts, a concise detail status line and four explicit content tabs keep listing, hold, movement, location and service separate without repeating large status cards. Details remain readable; density comes from organization and reduced spacing, not hidden photos or tiny text.
- Sibling of the app on purpose: same Inter, same tokens (`src/styles/tokens.css`), same hold and location wording, same equipment categories. A companion that looked like a different product would cost trust.
- "No current DealerMail hold found" renders **neutral, never green**; the app's rule is that it is not an availability promise, and the color would say otherwise.
- Motion only supports interactions, and `prefers-reduced-motion` is respected. Clear text, visible selection and focus states carry meaning without depending on animated tab indicators or decorative effects.
- The take-home page is customer-facing by construction: its model is built from a whitelist of published fields and a test asserts that hold, custody, movement and warranty-estimate data never serialize into it.
- Rejected on review as "the default for this brief": thumbnail cards, ALL-CAPS eyebrows, gradient masthead, a colored status row background, a score dial. Empty and error states name the query and the filters and say what to do next.
