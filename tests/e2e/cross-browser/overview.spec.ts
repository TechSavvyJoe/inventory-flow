import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { BootstrapData } from '../../../src/types'

test('the Overview preserves its hierarchy and count links across browser engines', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto('/overview')

  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  const storeSummary = page.getByRole('region', { name: 'Store summary' })
  await expect(storeSummary.getByRole('heading', { level: 3 })).toHaveCount(4)

  const howell = storeSummary.getByRole('region', { name: 'Howell' })
  if ((page.viewportSize()?.width ?? 0) <= 880) {
    await howell.getByRole('heading', { name: 'Howell', level: 3 }).click()
  }

  const onLot = howell.getByRole('link', { name: /^Howell: \d+ vehicles? on lot$/ })
  await expect(onLot).toBeVisible()
  await expect(onLot).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=on-lot')
  await expect(page.getByRole('region', { name: 'Service' })).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
})

test('sales opens a current customer comparison PDF from Overview without returning to Inventory', async ({ page }, testInfo) => {
  // SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS: exercise a private list read
  // without changing the shared demo ledger or using live inventory.
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'sales')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  const items = ['TESTDATAHWELL0001', 'TESTDATAHWELL0002', 'TESTDATAFWELL0001'].map(vin => ({ vin, available: true, addedAt: '2026-09-30T12:00:00Z' }))
  await page.route('**/api/saved-lists', route => route.fulfill({ json: { lists: [
    { id: 'synthetic-ab', label: 'AB', revision: 1, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', items: [...items, { vin: 'TESTDATAMISSING001', available: false, addedAt: '2026-09-30T12:00:00Z' }] },
    { id: 'synthetic-cd', label: 'CD', revision: 1, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', items: [] },
  ] } }))
  await page.goto('/overview')
  const saved = page.getByRole('region', { name: 'Customer saved lists' })
  const launch = saved.getByRole('button', { name: 'Customer sheet', exact: true })
  await expect(launch).toBeVisible()
  await expect(saved.getByRole('listitem')).toHaveCount(3)
  await expect(saved).toContainText('1 saved vehicle has no current authorized details.')
  await expect(saved).not.toContainText('TESTDATAMISSING001')

  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1320, height: 820 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }))
    expect(geometry.page).toBeLessThanOrEqual(geometry.width + 1)
    const box = (await launch.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: testInfo.outputPath(`sales-customer-sheet-${viewport.width}.png`) })
  }

  await launch.click()
  const sheet = page.getByRole('dialog', { name: /Take-home page/ })
  await sheet.getByRole('combobox', { name: 'Format' }).selectOption('comparison')
  const comparison = sheet.getByRole('article', { name: 'Vehicle comparison · Page 1 of 1' })
  await expect(comparison).toBeVisible()
  await expect(comparison.getByRole('img', { name: /Scan to open .* listing/ })).toHaveCount(0)
  await expect(comparison.getByText('Ask dealership', { exact: true })).toHaveCount(3)
  await expect(comparison.getByText('for details', { exact: true })).toHaveCount(3)
  const save = sheet.getByRole('button', { name: 'Save PDF', exact: true })
  await expect(save).toBeEnabled({ timeout: 20000 })
  const downloaded = page.waitForEvent('download')
  await save.click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('inventory-flow-vehicle-comparison.pdf')
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.7')
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getTitle()).toBe('Inventory Flow vehicle comparison')
  expect(pdf.getPageCount()).toBe(1)
  expect(pdf.getPage(0).getSize()).toEqual({ width: 792, height: 612 })
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(launch).toBeFocused()

  await saved.getByRole('button', { name: /^CD\s*0$/ }).click()
  await expect(saved).toContainText('This list has no vehicles in your current authorized inventory.')
  await expect(launch).toHaveCount(0)
  await expect(saved.getByRole('listitem')).toHaveCount(0)
})

test('the sales all-store hold count opens ordinary active holds even when none needs attention', async ({ page, isMobile }) => {
  // SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS: ordinary holds have no alert
  // or past-expected date. Changing only this browser response preserves the ledger.
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'sales')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json() as BootstrapData
    expect(payload.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    for (const vehicle of payload.vehicles.filter(vehicle => payload.overview?.vehicleFacts[vehicle.vin].holdActive)) {
      vehicle.hold.alertsCount = 0
      vehicle.hold.expectedDate = '2026-09-01'
      delete payload.overview!.vehicleFacts[vehicle.vin].holdPastExpected
    }
    payload.attention = []
    await route.fulfill({ response, json: payload })
  })
  await page.goto('/overview')
  await page.getByRole('button', { name: 'All stores', exact: true }).click()
  const holds = page.getByRole('region', { name: 'Current store facts' }).getByRole('link', { name: 'Hold signals: 2' })
  await expect(holds).toHaveAttribute('href', '/inventory?scope=group&store=all&view=holds')
  await holds.click()
  await expect(page).toHaveURL(/\/inventory\?scope=group$/)
  const clear = page.getByRole('button', { name: 'Clear Overview view: Holds · All stores' })
  await expect(clear).toBeVisible()
  const rows = isMobile ? page.locator('.if-srp-mobile-list .if-srp-mobile-row') : page.locator('.inv-desk-table tbody tr.inv-desk-row')
  const vehicleUnits = isMobile ? rows : page.locator('.inv-desk-table tbody.inv-desk-vehicle-rows')
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('Showing 1–2 of 2', { exact: true })).toBeVisible()
  await expect(vehicleUnits.filter({ hasText: 'TESTDATAHWELL0001' })).toHaveCount(1)
  await expect(vehicleUnits.filter({ hasText: 'TESTDATALNCN00001' })).toHaveCount(1)
  await clear.click()
  await expect(rows).toHaveCount(8)
})
