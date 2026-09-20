# Vehicle resource identity

The resource cards identify the actual read-only provider. AutoCheck is not CARFAX; vAuto's informational equipment profile is not an original factory window sticker. Ford OASIS and invoice controls are exact-VIN dealer lookups that may require an authorized DealerConnection sign-in, not a claim that the source has already been captured.

OASIS zero-action statements require `openActionsCaptured: true`, an explicit action array, and a valid completed capture date. The importer derives this flag from an explicit source array and preserves a prior false flag during revalidation. Missing arrays and legacy saved records without the flag retain their other report facts but say the action result was not captured. This prevents an old normalized empty array from becoming a false clear report. The website and companion extension use the same rule; no database migration or historical report rewrite is required.

The following official artwork was retrieved on September 14, 2026 and is bundled under `public/resource-brands/` and `extension/resource-brands/`:

| File | Official source | Treatment |
| --- | --- | --- |
| `autocheck.svg` | https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg | Unchanged AutoCheck by Experian SVG. |
| `vauto.svg` | https://www.vauto.com/wp-content/uploads/2024/01/logo.jpg | Original vAuto by Cox Automotive wordmark JPEG embedded unchanged in an SVG container; visually verified against the official source. |
| `ford.svg` | https://www.bobmaxeyfordhowell.com/assets/logos/transparent/Ford.png | Original Ford oval PNG embedded unchanged in an SVG container. The viewport removes empty vertical margins; the artwork is not redrawn or recolored. |
| `carfax.svg` | https://static.carfax.com/global-header/imgs/logo.svg | Unchanged artwork linked by the CARFAX home page. Reserved, not displayed: the current vehicle model has no CARFAX record or source link. |

These files identify third-party source destinations; they are not Inventory Flow product marks and do not imply provider endorsement. Confirm external/public trademark usage with the rights holder before public distribution. Do not synthesize provider logos or replace the source with a similarly named provider.

## Units shown to staff

Every distance on screen is US miles. Numbers the app holds are formatted with an explicit `en-US` locale and a `mi` suffix (`formatMileage`); no surface depends on the browser locale.

Captured source prose is a separate case. A Canadian window sticker, a Ford OASIS factory-term row (`60 months / 100,000 kilometres` is valid OASIS grammar) or an AutoCheck detail line can print kilometres, `L/100 km`, or `km/h`. `sourceDistanceText` (`src/lib/source-distance.ts`, mirrored in `extension/sidepanel/lib/source-distance.mjs`, parity tested) rewrites those at render time so the US figure leads and the source figure stays beside it as evidence: `3 years / 37,282 mi (60,000 km in the source)`. The captured record itself is never rewritten — source documents stay read-only evidence in their own words and units. The one computed exception is the warranty capture's term limit: `termFromOasisDescription` (`scripts/capture-warranty.mjs`) reads a kilometre term into a miles limit so the remaining-miles arithmetic runs in the same unit as the listed odometer, while the row's `termText` still carries the printed description verbatim.

No captured *numeric* distance field carries a unit flag. `originalMarket`, `pricingCurrency` and `assemblyCountry` describe the sticker's market, the sticker's currency and the build plant; none of them states what unit an odometer reading was recorded in, and inferring one from another would break the separate-facts rule. Numeric odometer, sale-mileage and entered-mileage values are therefore shown as captured, in miles. If a source ever starts publishing a kilometre odometer, it needs an explicit unit field on the record before the app may convert it.

The synthetic sticker helper is separate from the production document URL guards. It requires an allowlisted synthetic VIN and its matching `/demo-vehicles/` illustration. Its viewer and preview are explicitly non-official demo material. Source-backed price and equipment facts remain code-native, correctly currency-labeled, and separate from any illustrative preview.
