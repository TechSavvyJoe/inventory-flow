# Predictive inventory search

The Inventory screen builds a fast client-side index from the `InventoryVehicle[]` already returned for the active access context. It does not fetch or reveal a broader record when the user types.

## Behavior

- Partial stock numbers and VINs are first-class, high-priority matches.
- Punctuation and numeric formatting are folded for comparison (`F-150` / `F150`, `$20,988` / `20988`, and `123,328` / `123328`).
- Multiple terms use AND matching across vehicle identity, specifications, features, store/location, price, mileage, public status, movement, and authorized hold fields.
- Exact, identifier-prefix, identifier-substring, token, prefix, and substring matches rank ahead of typo-tolerant matches.
- Fuzzy matching is limited to meaningful alphabetic tokens. Numeric/identifier tokens are never fuzzed into a different VIN, stock, price, or mileage.
- `*`, `?`, `~`, and `|` are literal characters, not wildcard or regular-expression instructions.
- Suggestions show the vehicle, stock/VIN tail, Home Store, price, mileage, and a safe matched-field category. They never render hidden customer, reason, comment, alert, or CDK substrings.
- Recent searches are session-only, separated by role and Home Store, and shown only while they still match the current authorized records. They are not stored in `localStorage` or added to the URL.

## Privacy boundary

The server's `VehicleRecord.searchText` is copied to `InventoryVehicle.authorizedSearchText` as a matching-only field. The server excludes private hold evidence for transport-only roles; the UI cannot make absent private text searchable. Role changes remount the inventory experience and clear an active URL search.

This remains a local prototype boundary: role and Home Store are currently preview controls rather than claims from production authentication. A production release must derive user, role, store access, and search fields on the server from authenticated claims. Client-side role controls alone are not an authorization mechanism.

CRM-only rows are intentionally not mixed into the default public-inventory browser or described as available. A future CRM-only search mode must be explicit, separately labeled `CRM only — no current public listing`, and keep CRM/public/hold/CDK states distinct.
