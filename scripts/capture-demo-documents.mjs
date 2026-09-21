/** Render synthetic HTML documents only; never capture live vehicle data. */
import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin = new URL(process.env.DEMO_DOCUMENT_ORIGIN || 'http://127.0.0.1:4173')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  throw new Error('Synthetic document captures require a local preview server.')
}
const directory = new URL('../public/demo-documents/', import.meta.url)
const samples = JSON.parse(await readFile(new URL('samples.json', directory), 'utf8'))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1150, height: 1100 }, deviceScaleFactor: 0.6 })
  for (const [vin, sample] of Object.entries(samples)) {
    if (!/^TESTDATA[A-Z0-9]{9}$/.test(vin)) throw new Error('Unexpected non-synthetic document identifier.')
    await page.goto(new URL(`/demo-documents/window-sticker.html?vehicle=${vin}`, origin).href)
    const document = page.locator('#document[aria-busy="false"]')
    await document.waitFor()
    if (!(await document.innerText()).includes(sample.title) || !(await document.innerText()).includes('NOT AN OFFICIAL WINDOW STICKER')) {
      throw new Error(`Synthetic document did not render correctly for ${vin}.`)
    }
    await page.evaluate(() => window.document.fonts.ready)
    await document.screenshot({ path: fileURLToPath(new URL(`window-sticker-${vin}.png`, directory)) })
  }
} finally {
  await browser.close()
}
console.log(`Rendered ${Object.keys(samples).length} exact-vehicle synthetic document previews.`)
