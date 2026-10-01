# Customer PDF dependencies

The companion remains plain ES modules. PDF generation runs locally; no customer
sheet is uploaded to a rendering service. The app lazy-loads this same renderer.

- `pdf-lib.js`: `pdf-lib@1.17.1/dist/pdf-lib.esm.min.js` (only the missing source-map comment is removed) from the locked npm package. MIT; adjacent license is copied from the package.
- `fontkit.js`: `@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js` from the locked package, wrapped with local `module`/`exports` bindings and an ES default export. The UMD build includes its dependencies, so the installed extension needs no npm resolution or global variables. The package declares MIT, attributes Devon Govett and Andrew Dillon, and links the MIT text in its README; the adjacent notice reproduces that text and attribution.
- `../../fonts/Inter-{Regular,Bold}.woff`: Latin 400 and 700 font files copied from the locked `@fontsource/inter@5.3.0` package. SIL Open Font License; copied notice in `../../fonts/Inter-LICENSE.txt`.

Sources: https://github.com/Hopding/pdf-lib and https://github.com/Hopding/fontkit.
Keep these files in sync with the lockfile; the PDF tests verify the exact vendor
bytes and the wrapper. All implementation changes belong in `../lib/takehome-pdf.mjs`.

- `qr-encoder.mjs`: browser-only QR writer bundled from locked `@zxing/library@0.23.0`, Apache-2.0; adjacent license copied unchanged. Source entry: `scripts/lib/takehome-qr-entry.mjs`. Rebuild: `pnpm exec esbuild scripts/lib/takehome-qr-entry.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=extension/sidepanel/vendor/qr-encoder.mjs`. It encodes locally with medium error correction and a four-module quiet zone; no QR service receives the listing URL. Upstream: https://github.com/zxing-js/library.
