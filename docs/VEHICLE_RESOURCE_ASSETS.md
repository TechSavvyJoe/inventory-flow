# Vehicle resource identity

The resource cards identify the actual read-only provider. AutoCheck is not CARFAX; vAuto's informational equipment profile is not an original factory window sticker. Ford OASIS and invoice controls are exact-VIN dealer lookups that may require an authorized DealerConnection sign-in, not a claim that the source has already been captured.

The following official artwork was retrieved on September 14, 2026 and is bundled under `public/resource-brands/` and `extension/resource-brands/`:

| File | Official source | Treatment |
| --- | --- | --- |
| `autocheck.svg` | https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg | Unchanged AutoCheck by Experian SVG. |
| `vauto.svg` | https://www.vauto.com/wp-content/uploads/2024/01/logo.jpg | Original vAuto by Cox Automotive wordmark JPEG embedded unchanged in an SVG container; visually verified against the official source. |
| `ford.svg` | https://www.bobmaxeyfordhowell.com/assets/logos/transparent/Ford.png | Original Ford oval PNG embedded unchanged in an SVG container. The viewport removes empty vertical margins; the artwork is not redrawn or recolored. |
| `carfax.svg` | https://static.carfax.com/global-header/imgs/logo.svg | Unchanged artwork linked by the CARFAX home page. Reserved, not displayed: the current vehicle model has no CARFAX record or source link. |

These files identify third-party source destinations; they are not Inventory Flow product marks and do not imply provider endorsement. Confirm external/public trademark usage with the rights holder before public distribution. Do not synthesize provider logos or replace the source with a similarly named provider.

The synthetic sticker helper is separate from the production document URL guards. It requires an allowlisted synthetic VIN and its matching `/demo-vehicles/` illustration. Its viewer and preview are explicitly non-official demo material. Source-backed price and equipment facts remain code-native, correctly currency-labeled, and separate from any illustrative preview.
