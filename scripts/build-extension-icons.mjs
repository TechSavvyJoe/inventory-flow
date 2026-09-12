// Renders the Chrome extension's toolbar/store icons from the brand mark.
// Run once after changing public/brand-kit/inventory-flow-icon.svg:
//   node scripts/build-extension-icons.mjs
// Sizes follow Chrome's manifest requirements (16/32/48/128 PNG with alpha).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'public/brand-kit/inventory-flow-icon.svg')
const target = resolve(root, 'extension/icons')
const sizes = [16, 32, 48, 128]

let sharp
try { ({ default: sharp } = await import('sharp')) } catch {
  console.error('sharp is not installed. Run: pnpm dlx sharp@latest --help  (or add sharp as a devDependency) and retry.')
  process.exit(1)
}

mkdirSync(target, { recursive: true })
const svg = readFileSync(source)
for (const size of sizes) {
  // Rasterize at high density so the rounded tile stays crisp at 16px.
  const png = await sharp(svg, { density: Math.max(72, Math.round((size / 64) * 72 * 4)) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(resolve(target, `icon-${size}.png`), png)
  console.log(`icon-${size}.png ${png.length}B`)
}
