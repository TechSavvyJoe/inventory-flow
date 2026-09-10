# Inventory Flow shared data API and AI connections

**Release status (September 10, 2026): live read API, access restrictions and OAuth discovery verified; hosted AI connections pending.** Workers Paid purchase is complete after explicit owner approval and checkout agreement acceptance; its account-wide minimum is $5/month plus applicable usage. Only the separate integration Worker was deployed, version `54c9b37a-58e6-432f-b71b-9b21aacf2383`, with the approved 1,000 ms CPU cap and both integration flags enabled. All 760 tests across 62 files passed with two test workers, along with TypeScript and the production build. Live REST checks at `2026-09-10T12:15:15.932Z` reconciled all 226 September 9 vehicles and four store totals to independent source metadata, with unauthorized API access denied. Live store/scope isolation and temporary-key revocation checks passed, and the existing app's readiness and selected data hash remained unchanged. OAuth protection, discovery, S256 PKCE and registration checks passed; actual hosted-client sign-in did not run, and issuer-identification support is not advertised. Neither a completed Claude connection nor a completed ChatGPT connection is claimed. See [deployment evidence, diagnostic history and remaining gates](SHARED_DATA_DEPLOYMENT.md).

The shared service reads the same selected, validated data release used by Inventory Flow. Other applications and approved AI tools receive an explicit read-only projection; they do not receive a database password or access to raw snapshots.

## Two connection types

| Consumer | Connection | Authentication |
| --- | --- | --- |
| Your app's backend, scheduled job, or reporting service | `https://inventory-data.joegallant.me/api/v1` | A separate Bearer application key, kept only in that application's server-side secret store |
| ChatGPT, Claude, or another compatible AI client | `https://inventory-data.joegallant.me/mcp` | The configured managed OAuth sign-in and an approved integration grant |

REST keys and managed AI sign-in are different connection paths. Do **not** assume an API key will authenticate through the Cloudflare edge on `/mcp`. Actual AI-client compatibility requires a completed live OAuth connection test. An AI's ability to call this read-only service does not authorize it to mutate Inventory Flow or DealerMail.

API keys have per-application grants, expiry/revocation controls, store lists, read scopes, quotas, and audit records. Managed OAuth has one approved grant per employee: that employee's AI clients share its scopes, stores, quota, expiry and revocation. It is not per-ChatGPT/Claude-client authorization at the origin. A failed authorization, quota check, or required audit write fails closed. Inventory Flow's existing sign-in and data-publication access remain separate.

## What the first version contains

- The selected current release's **publicly listed vehicles**, identified by valid full VIN, with stock, physical store, home store, price, mileage, dates/aging, colors, model/trim, body, engine, transmission, drivetrain, fuel, MPG, certification flag, published features, permitted photo links, and the VIN/store-correct official listing link.
- Parsed VIN-specific **AutoCheck facts**, original-window-sticker options, standard equipment/warranty, package codes and prices, and informational factory-equipment packages/sections. Exact source terminology is retained. Informational equipment labels are explicitly not original Monroney stickers. Original report files and authenticated document links are not exposed.
- Conservative **hold state** and non-private backup counts; confirmed/reported store-level location and departure/confirmation timestamps. Source listing status, source stock flags, hold state, and app location remain distinct.
- Typed **public change events** recorded with the selected release, their before/after values, and the comparison report dates.
- Selected-release **freshness and provenance**: report date, completion timestamp, content hash, allowed stores and source freshness. Counts always reflect authorized rows, not group-wide totals hidden from that integration.

This version is **not** a full historical database query API or a complete CRM-only inventory endpoint. `/changes?from=...&to=...` filters events already stored with the selected release; it does not fetch past daily snapshots. Hold summaries cover publicly listed vehicles and use public physical store, not a claim of complete CRM hold totals. Historical source files can remain stored securely without being made accessible through this first API contract.

Deliberately excluded: customer and salesperson identities, hold/customer reasons, private comments/alerts, free-form operating notes, raw CDK data, customer outcomes, browser credentials/cookies, raw source objects, source-local file paths, full licensed reports, and authenticated report URLs. There are no API methods to create, approve, release or change holds, transfers, alerts, or source records.

Use parsed licensed-source facts only within your organization's permitted purpose and applicable provider terms; deployment is not a legal/compliance certification.

## Read-only REST endpoints

All endpoints below use `GET`, `Accept: application/json`, and `Authorization: Bearer <server-side integration key>`. Never pass credentials in a URL. The server rejects unknown query fields.

| Path | Required scope | Result |
| --- | --- | --- |
| `/inventory` | `inventory.read` | Rich vehicle rows and cursor pagination |
| `/vehicles/{vin}` | `inventory.read` | One rich vehicle and release metadata |
| `/changes` | `changes.read` | Typed public change events and cursor pagination |
| `/data-health` | `health.read` | Freshness and authorized visible vehicle count |
| `/holds/summary` | `holds.aggregate.read` | Non-private counts for authorized public inventory by physical store |
| `/capabilities` | Active authenticated integration grant | Plain JSON listing granted stores/scopes, limits and supported features |

The four exact store values are `Howell`, `Fowlerville`, `Ford Detroit`, and `Lincoln`. A store filter never expands the key's grant. An inaccessible VIN returns the same not-found response as a missing VIN.

### Inventory query

| Parameter | Behavior |
| --- | --- |
| `q` | Literal partial search over the safe projected fields; at most 256 characters |
| `store` | Public physical store, using the exact values above |
| `make`, `model` | Exact case-insensitive, punctuation-folded matches |
| `year` | Exact integer model year, 1886–2200 |
| `minPrice`, `maxPrice` | Non-negative published-price bounds; missing prices do not match |
| `minMileage`, `maxMileage` | Non-negative mileage bounds; missing mileage does not match |
| `holdState` | `primary`, `backup`, `multiple`, `none_observed`, `stale`, or `unknown` |
| `sort` | `vehicleName` (default), `stockNumber`, `year`, `listedPrice`, `mileage`, `daysListed`, `make`, `model`, `publicStore`, or `homeStore` |
| `direction` | `asc` (default) or `desc`; missing sort values remain last |
| `limit` | Integer 1–100; default 20 |
| `cursor` | Opaque signed `nextCursor` from the preceding page of the same query |

`F150` and `F-150`, `42810` and `$42,810`, `2052` and `2,052`, and readable/ISO date forms use forgiving matching. `*`, `?`, `~`, and `|` remain literal characters, not wildcard or regular-expression instructions. Search does not use the application's private cached search index.

`/changes` accepts only `q`, `store`, `type`, `from`, `to`, `limit`, and `cursor`. Date bounds are inclusive valid `YYYY-MM-DD` dates, with `from <= to`. Types are `new_arrival`, `removed`, `price_change`, `mileage_change`, `website_status_change`, `stock_correction`, and `store_transfer`. `/holds/summary` accepts only `store`; health and capabilities have no query fields.

### Response and cursor handling

Inventory and changes return `{ data: [...], meta: {...}, pagination: { total, limit, returned, nextCursor } }`. Vehicle, health, and hold-summary methods return `{ data, meta }`. Capabilities returns its object directly without a `data` envelope. The complete machine-readable contract is [inventory-flow.openapi.json](inventory-flow.openapi.json).

`meta` includes `schemaVersion`, `reportDate`, `completedAt`, `bundleSha256`, `timezone`, `allowedStores`, `sourceFreshness`, `availabilityCaveat`, `historyCoverage`, and `excludedFields`. Treat freshness and caveats as part of the result, not optional decoration.

Use the **same query and limit** with each `nextCursor`. Cursors bind the query, identity, grants, release and scoped operational data. A new release, relevant move/hold change, changed filters, changed grant, or modified cursor can produce `400 INVALID_CURSOR`. Start a fresh listing and discard/reconcile the earlier partial result; never silently join pages from different snapshots. The JavaScript iterator intentionally throws rather than silently restarting.

Responses are bounded at **1 MiB**. Reduce `limit` if an unusually rich page is too large. String facts are capped at 2,000 characters (features at 65,536); parsed arrays at 2,000 items and photos at 500. This bounded integration projection is not an archival raw-data export.

Handle `401` by fixing credentials, `403` by obtaining the needed approved scope/grant, `404` as not found, `429` by honoring `Retry-After`, and `503` as unavailable—never as zero inventory or released holds. Error bodies contain safe `error` and `code` fields and may include `requestId`. Do not log request Authorization headers, returned private source data from other services, or secret-provider errors.

### Safe interpretation

`none_observed` means **No current DealerMail hold found**, never “available.” For stale/incomplete/unknown DealerMail freshness, current hold Boolean and current aggregate metrics are null where unverified. Source boolean flags are not physical-presence, readiness, sale or delivery evidence. Missing MSRP/MPG sentinels are null; no-price is not a real zero-price vehicle. Sticker prices retain their source currency and are separate from today's asking price. Published aging is tied to the selected report date, not guaranteed acquisition/lot age.

## Use from your application's backend

Copy [clients/inventory-flow.mjs](../clients/inventory-flow.mjs) into your server project, or import it from this repository. It has no third-party dependencies and uses standard `fetch`, `AbortController` and streams available in current supported server runtimes.

```js
import { createInventoryFlowClient } from './inventory-flow.mjs'

const inventory = createInventoryFlowClient({
  token: () => process.env.INVENTORY_FLOW_API_KEY,
  // Live read API; use a separately approved server-side application grant:
  baseUrl: 'https://inventory-data.joegallant.me/api/v1',
})

const result = await inventory.inventory({
  q: 'Trailer Tow', maxPrice: 35000, store: 'Howell',
  sort: 'listedPrice', direction: 'asc', limit: 20,
})

// Show result.meta.sourceFreshness next to the data in your app.
// Build your own authenticated endpoint; never forward the secret to a browser.
```

```js
const controller = new AbortController()
for await (const vehicle of inventory.iterateInventory(
  { store: 'Howell', limit: 20 },
  { signal: controller.signal },
)) {
  await updateMyPrivateReadModel(vehicle)
}
// This reads data; it never changes Inventory Flow source records.
```

Other methods are `vehicle(vin, { signal })`, `changes(query, { signal })`, `dataHealth({ signal })`, `holdSummary(query, { signal })`, and `capabilities({ signal })`. `token` can be a secret string or an asynchronous provider. Providers are resolved per request. Options include `timeoutMs` (default 15,000; maximum 120,000), `maxResponseBytes` (maximum/default 1,048,576), and a server-side `fetch` implementation. The client refuses browser execution, non-HTTPS base URLs, URL credentials, query/hash-bearing base URLs and network redirects; errors deliberately omit raw URLs/provider messages.

Keep each app's key only in its backend environment/secret manager. Do not put it in frontend `VITE_*` variables, localStorage, browser source, screenshots, source control, or an AI conversation. A browser-only basic app needs your own small authenticated backend to call this API safely. Revoking one app should not require rotating every other app's key.

## Connect AI tools

After live deployment and managed OAuth configuration are verified, add the approved `/mcp` URL as a remote connector in a compatible AI client and complete the browser sign-in. The account must have an active approved identity and stores/scopes. MCP uses the same safe read service as REST; changing the client does not bypass field restrictions. An AI can search equipment or price changes but cannot access excluded customer notes or perform vehicle/CRM writes.

If a client cannot complete the managed OAuth flow, report that exact compatibility issue. Do not disable authentication, paste a backend API key into the AI chat, or expose the original Inventory Flow database to work around it.
