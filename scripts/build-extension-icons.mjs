// Renders the Chrome extension's toolbar/store icons from the brand mark.
//   pnpm extension:icons
// Uses the Chromium that Playwright (a declared devDependency) already
// provides, so a clean install needs no extra native module. Sizes follow
// Chrome's manifest requirements: 16/32/48/128 PNG with alpha.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'public/brand-kit/inventory-flow-icon.svg')
const target = resolve(root, 'extension/icons')
const sizes = [16, 32, 48, 128]

mkdirSync(target, { recursive: true })
const svg = readFileSync(source).toString('base64')
let browser
try { browser = await chromium.launch() } catch { browser = await chromium.launch({ channel: 'chrome' }) }
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${svg}" alt="">`)
    await page.waitForLoadState('load')
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
    writeFileSync(resolve(target, `icon-${size}.png`), png)
    console.log(`icon-${size}.png ${png.length}B`)
    await page.close()
  }
} finally {
  await browser.close()
}
