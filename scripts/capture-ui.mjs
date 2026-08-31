import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.INVENTORY_OPS_QA_URL || 'http://127.0.0.1:4174/inventory'
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const outputDirectory = path.resolve('design')

await mkdir(outputDirectory, { recursive: true })

const browser = await chromium.launch({ executablePath: chromePath, headless: true })

async function loadInventory(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /inventory$/i }).waitFor()
  await page.waitForTimeout(350)
}

async function waitForVisibleImages(page) {
  await page.waitForFunction(() => {
    const visibleImages = [...document.images].filter((image) => image.getClientRects().length > 0)
    return visibleImages.every((image) => image.complete && image.naturalWidth > 0)
  }, undefined, { timeout: 10_000 }).catch(() => undefined)
}

async function captureRoute(page, pathname, fileName) {
  await page.goto(new URL(pathname, baseUrl).toString(), { waitUntil: 'domcontentloaded' })
  await page.locator('h1').first().waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(outputDirectory, fileName) })
}

const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const desktopPage = await desktopContext.newPage()
await loadInventory(desktopPage)
await waitForVisibleImages(desktopPage)
await desktopPage.screenshot({ path: path.join(outputDirectory, 'qa-desktop-inventory-1440x900.png') })

const rowOptions = await desktopPage.getByLabel('Rows per page').locator('option').allTextContents()
await desktopPage.getByLabel('Rows per page').selectOption('10')
await desktopPage.locator('tbody tr').first().click()
await desktopPage.getByRole('dialog').waitFor()
await waitForVisibleImages(desktopPage)
await desktopPage.screenshot({ path: path.join(outputDirectory, 'qa-desktop-vehicle-workspace-1440x900.png') })
await desktopPage.getByRole('tab', { name: 'Hold and availability' }).click()
const dealerMailPanel = desktopPage.locator('section.inventory-dealermail-actions[aria-labelledby="inventory-dealermail-actions-title"]')
await dealerMailPanel.waitFor()
await dealerMailPanel.evaluate((element) => element.scrollIntoView({ block: 'start' }))
await desktopPage.waitForTimeout(100)
await desktopPage.screenshot({ path: path.join(outputDirectory, 'qa-desktop-hold-tools-1440x900.png') })

const desktopMetrics = await desktopPage.evaluate(() => ({
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  documentWidth: document.documentElement.scrollWidth,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
}))
await captureRoute(desktopPage, '/transfers', 'qa-desktop-moves-1440x900.png')
await captureRoute(desktopPage, '/attention', 'qa-desktop-today-1440x900.png')

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
const mobilePage = await mobileContext.newPage()
await loadInventory(mobilePage)
await waitForVisibleImages(mobilePage)
await mobilePage.screenshot({ path: path.join(outputDirectory, 'qa-mobile-inventory-390x844.png') })
await mobilePage.locator('.inventory-mobile-row').first().click()
await mobilePage.getByRole('dialog').waitFor()
await waitForVisibleImages(mobilePage)
await mobilePage.screenshot({ path: path.join(outputDirectory, 'qa-mobile-vehicle-workspace-390x844.png') })

const mobileMetrics = await mobilePage.evaluate(() => ({
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  documentWidth: document.documentElement.scrollWidth,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  desktopTableVisible: Boolean(
    [...document.querySelectorAll('table')].find((element) => element.getClientRects().length > 0),
  ),
  mobileRowsVisible: [...document.querySelectorAll('.inventory-mobile-row')].filter(
    (element) => element.getClientRects().length > 0,
  ).length,
}))
await captureRoute(mobilePage, '/transfers', 'qa-mobile-moves-390x844.png')
await captureRoute(mobilePage, '/attention', 'qa-mobile-today-390x844.png')

console.log(JSON.stringify({ desktopMetrics, mobileMetrics, rowOptions }, null, 2))

await mobileContext.close()
await desktopContext.close()
await browser.close()
