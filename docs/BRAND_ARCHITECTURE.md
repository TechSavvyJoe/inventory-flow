# Brand architecture

The interface uses four separable brand layers. This keeps the software reusable for another dealer group while still making each employee's selected store feel familiar.

## 1. Product layer

The software name is **Inventory Flow**, with the Flowline “F” mark. This layer owns the app title, navigation, install icons, extension identity, document metadata, typography, neutral surfaces, status colors, and interaction patterns. It must remain legible and recognizable regardless of the selected dealer group, OEM, or store.

Dealership names are never appended to the product wordmark or app name. Customer documents retain the dealership name and logo supplied by their store; a comparison spanning different stores uses Inventory Flow as its neutral heading and keeps each vehicle's store attribution. A shared dealership logo appears only when every selected store supplies the same asset.

## 2. Dealer-group layer

The dealer-group layer identifies the authorized dealership account. The current configured account is Bob Maxey. It provides the store roster, operational language, permissions, and group-specific workflow configuration. Its branding belongs in the working-location/account context and store-specific customer documents.

The active group is exposed on the app shell as `data-dealer-group="bob-maxey"`. Product components do not use that key as their name or logo. Branding separation does not implement multi-tenant onboarding or data isolation: the current store roster, document branding, source adapters, and host allowlists still describe the existing account. Supporting another dealership requires its own authorized configuration and a separate tenancy implementation.

## 3. OEM layer

The OEM layer supplies contextual Ford or Lincoln styling. It is exposed as `data-oem="ford"` or `data-oem="lincoln"` and is derived from the selected Home Store, never guessed from a vehicle listing.

OEM styling is deliberately restrained:

- the product masthead and navigation model stay constant;
- the selected-store accent, top-bar rule, active navigation, and contextual wash change;
- Ford contexts use a deep blue operational palette; Lincoln uses a quiet charcoal, silver, and white treatment consistent with its clean monochromatic presentation;
- official locally bundled assets are displayed without recoloring, redrawing, or combining them into the product logo;
- OEM marks never imply that the software itself is an OEM product.

The UI tokens are an internal interface interpretation, not a claim that the exact colors are an OEM-published digital design system. Before an external rollout, the dealer group should replace them with its approved OEM/co-op brand tokens.

## 4. Store layer

The store layer provides the selected store's name, approved local asset, source provenance, and store-specific theme key. The current keys are `ford`, `fowlerville`, and `lincoln`, exposed through `data-store-theme`.

`src/app/storeBranding.ts` configures the current account's shell branding. Customer document names and sites are currently configured in `src/features/sales/customer-summary.ts` and `extension/sidepanel/lib/takehome.mjs`, with extension logos in `extension/sidepanel/lib/brand.mjs`. These are dealership account settings, not Inventory Flow product identity. Every shell store declares:

- dealer-group key;
- OEM key and accessible OEM label;
- store asset path and alternative text;
- store theme key;
- official source URL for asset provenance.

## Store-switch behavior

Changing Home Store updates all three context attributes together. The interface then uses a short accent sweep, contextual navigation wash, logo settle, and a temporary `OEM · Store` confirmation pill. The confirmation is also announced through a polite status region.

The transition does not delay navigation, data loading, or the store selection itself. With `prefers-reduced-motion: reduce`, motion and color transitions are removed while the selected logo, name, and colors update immediately.

## Rules for adding a tenant, OEM, or store

1. Keep the product name and mark separate from tenant and OEM assets.
2. Use a licensed or officially supplied local asset; do not hotlink it.
3. Record its source and usage approval.
4. Add a high-contrast accent, strong accent, soft focus tint, navigation base, and navigation glow.
5. Verify text, focus indicators, charts, badges, and active navigation in light and dark contexts.
6. Test switching at desktop and mobile widths, with reduced motion enabled.
7. Do not recolor or structurally alter an OEM or dealership logo unless the brand owner explicitly permits it.

The existing source inventory is documented in [Store brand assets](BRAND_ASSETS.md).
