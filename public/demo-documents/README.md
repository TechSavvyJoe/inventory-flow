# Synthetic document samples

These eight demonstrator documents use only `fixtures/synthetic-release.mjs`. They are **not official manufacturer window stickers**, do not identify real vehicles, and must not be used for operational or customer decisions.

Rebuild `samples.json` with `node scripts/build-demo-documents.mjs`. With the local demo running on port 4173, run `node scripts/capture-demo-documents.mjs` to render all eight PNG previews from the HTML documents. The capture script accepts only a localhost origin (`DEMO_DOCUMENT_ORIGIN` may override the port). The HTML document has an exact fixture-identifier allowlist and uses escaped text. It does not accept arbitrary vehicle content or external document URLs.

Each `window-sticker-TESTDATA*.png` is a browser render of that exact synthetic vehicle's HTML sample, including its own title, equipment, and reconciled pricing. Every preview is visibly labeled DEMO and NOT AN OFFICIAL WINDOW STICKER. No preview is reused for another vehicle. The helper requires both the exact fixture VIN and its matching demo vehicle illustration before exposing the document.

The older `window-sticker-preview.png` AI illustration is retained as an unused legacy asset; current document previews use the deterministic HTML renders above.
