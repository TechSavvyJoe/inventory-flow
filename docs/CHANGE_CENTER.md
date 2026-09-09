# Today and change center

Today is the operational translation of the daily workbook. It is deliberately not a second spreadsheet.

## What appears up front

- Home Store counts for new arrivals, removed public listings, price changes, and website-status changes, with one-click expansion to all four stores.
- One exact event per VIN and change type, with stock, VIN, physical store, vehicle identity, and before/after values.
- Price direction and exact dollar movement.
- Current DealerMail hold signals for past-expected dates, alert presence, and comment presence.
- Operational transfer work already owned by the application, including next owner and due time.
- Store-scoped pricing and source-health exceptions that require review.

Mileage changes, stock corrections, and public-store transfers use the same event model and appear whenever the certified comparison contains them. A public-store transfer is one event and remains visible to both the prior and current store in Home Store scope.

The action list puts price, website-status, store-transfer, stock, mileage, and new-arrival events before public-feed removals. Safe DealerMail signal totals are calculated from all active hold records by CRM Store, including a held VIN that no longer has a public listing.

## Progressive disclosure

The Today queue never shows customer names, hold reasons, comment text, or alert text. Salespeople and managers can open the authorized vehicle workspace for those exact DealerMail fields and the complete vehicle timeline. Transport-only roles keep logistics without customer-sensitive hold evidence. The raw public and DealerMail evidence remains in the daily workbook and source snapshots.

## Daily comparison rules

- Compare only two completed, validated public-inventory snapshots.
- When the current dated public audit passes independent change reconciliation and matches the exact current snapshot checksum, its `prior_sha256` binds the comparison to those exact prior bytes. An advanced `latest.json` pointer is resolved by checksum against dated snapshot files. A different baseline with coincidentally matching counts is not a substitute.
- The audited prior can be a complete public source from a day whose combined report remained incomplete because of another source. If there is no current public audit, use the most recent earlier completed run manifest's explicit public-snapshot path and matching checksum. Loose pre-manifest snapshots are supported only when no earlier dated manifests exist.
- Emit VIN-level detail only when the generated event counts exactly reconcile to the daily run manifest.
- Normalize supported report labels (for example, `New Arrival` and `Status Change`) and legacy app keys (`new_arrival` and `website_status_change`) in memory. Preserve the raw manifest. Conflicting aliases, invalid totals, or a positive combined `VIN/Stock Correction` total with no separate event types cannot authorize stock-only or VIN-level conclusions.
- A missing audited prior, mismatched current-audit checksum, or failed count reconciliation withholds detailed events and displays a warning. Other verified inventory and unambiguous aggregate totals remain usable.
- Treat a changed physical Store as one transfer rather than a removal plus arrival.
- If a feed is stale, incomplete, unexpectedly empty, or does not reconcile, show the last verified data and suppress unsupported removal or release conclusions.
- DealerMail VIN-level hold additions and releases require compatible structured hold snapshots and the established source-completeness and corroboration checks. Without that evidence, do not claim a specific hold addition or release.

## Status boundaries

- Public listing, DealerOn flags, DealerMail hold position, raw CDK evidence, app-confirmed movement, sale outcome, delivery, and physical location are separate fields.
- No current hold found is not an availability promise.
- A hold is not proof of sale or delivery.
- A public-feed removal is not proof that a unit sold, delivered, was released, or physically left a store.
- Comment and alert presence is not treated as a new daily event until a compatible prior DealerMail snapshot exists.

## Current verified comparison

The 2026-09-09 release compares with the exact audited 2026-09-04 public snapshot and contains 58 certified public events: 16 new arrivals, 9 removals, 17 price changes, 9 mileage changes, and 7 website-status changes. There are no stock-correction or public-store-transfer events in this comparison. Every `(change type, VIN)` pair matches the current certified snapshot's detailed change records.

Audited prior SHA-256: `8332D5864E8357F50E90EC6B93CA1B40154F498739479A4F3528BC15DAE2A5F4`.

The September 9 audit binds this prior checksum to current public-snapshot SHA-256 `ED4E55663E0A12CAC7E95EA7F2BBF987A241DD625448B9BDC275AA154F0997D0`. These checks read the source files without changing the completed manifest, snapshots, or workbook. The Home Store view shows only events relevant to that store; All stores shows the deduplicated group list.
