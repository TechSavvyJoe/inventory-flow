# Store brand assets

Inventory Flow uses the dealership-neutral Flowline “F” assets under `public/brand-kit` for its product logo, favicon, iPhone Home Screen icon, and extension icons. The selected Home Store adds its dealership/manufacturer treatment and a restrained contextual accent color. Dealer and OEM logos are account context, never the product identity. See [Brand architecture](BRAND_ARCHITECTURE.md) for the separable product, dealer-group, OEM, and store layers.

The current locally bundled assets were retrieved from official dealership sites on August 29, 2026:

- Howell: `public/brands/bob-maxey-ford.png` from `https://www.bobmaxeyfordhowell.com/static/dealer-21521/logo.png`
- Ford Detroit: the same local Ford asset; the official Detroit file is byte-identical and came from `https://www.bobmaxeyford.com/static/dealer-21520/logo.png`
- Fowlerville: `public/brands/bob-maxey-fowlerville.png` from `https://www.bobmaxeyfordinfowlerville.com/static/dealer-23328/logo.png`
- Lincoln: `public/brands/lincoln.png` from `https://www.bobmaxeylincoln.com/static/industry-automotive/logos/supp/lincoln/transparent/lincoln.png`

These assets belong to the current dealership account and are locally bundled rather than hotlinked so a website path change cannot break the app header. A new dealership supplies its own approved assets; the Inventory Flow product mark remains independent of dealership and OEM logos.
