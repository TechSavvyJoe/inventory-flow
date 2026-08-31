# Today and change center

Today is the operational translation of the daily workbook. It is deliberately not a second spreadsheet.

## What appears up front

- Home Store counts for new arrivals, removed public listings, price changes, and website-status changes, with one-click expansion to all four stores.
- One exact event per VIN and change type, with stock, VIN, physical store, vehicle identity, and before/after values.
- Price direction and exact dollar movement.
- Current DealerMail hold signals for past-expected dates, alert presence, and comment presence.
- Operational transfer work already owned by the application, including next owner and due time.
- Store-scoped pricing and source-health exceptions that require review.

Mileage changes, stock corrections, and public-store transfers use the same event model and appear automatically when a future daily comparison contains them. A public-store transfer is one event and remains visible to both the prior and current store in Home Store scope.

The action list puts price, website-status, store-transfer, stock, mileage, and new-arrival events before public-feed removals. Safe DealerMail signal totals are calculated from all active hold records by CRM Store, including a held VIN that no longer has a public listing.

## Progressive disclosure

The Today queue never shows customer names, hold reasons, comment text, or alert text. Salespeople and managers can open the authorized vehicle workspace for those exact DealerMail fields and the complete vehicle timeline. Transport-only roles keep logistics without customer-sensitive hold evidence. The raw public and DealerMail evidence remains in the daily workbook and source snapshots.

## Daily comparison rules

- Compare only two completed, validated public-inventory snapshots.
- Emit VIN-level detail only when the generated event counts exactly reconcile to the daily run manifest.
- Treat a changed physical Store as one transfer rather than a removal plus arrival.
- If a feed is stale, incomplete, unexpectedly empty, or does not reconcile, show the last verified data and suppress unsupported removal or release conclusions.
- DealerMail VIN-level hold additions and releases require two compatible structured hold snapshots. The current release establishes that baseline; it does not claim specific hold adds or releases.

## Status boundaries

- Public listing, DealerOn flags, DealerMail hold position, raw CDK evidence, app-confirmed movement, sale outcome, delivery, and physical location are separate fields.
- No current hold found is not an availability promise.
- A hold is not proof of sale or delivery.
- A public-feed removal is not proof that a unit sold, delivered, was released, or physically left a store.
- Comment and alert presence is not treated as a new daily event until a compatible prior DealerMail snapshot exists.

## Current verified comparison

The 2026-08-29 release compares with 2026-08-28 and contains 38 certified public events: 15 new arrivals, 16 removals, 6 price changes, and 1 website-status change. The Home Store view shows only events relevant to that store; All stores shows the deduplicated group list.
