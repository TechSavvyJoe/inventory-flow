import { test, expect } from '@playwright/test'
import type { BootstrapData, PublicChangeEvent, VehicleRecord } from '../../../src/types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// This config owns isolated synthetic servers. Only their bootstrap response is altered.
test('inventory updates separate store-scoped arrivals, exact price changes, and removed listings', async ({ page }, testInfo) => {
  const homeNewVin = 'TESTDATAHWELL0001'
  const homePriceVin = 'TESTDATAHWELL0002'
  const awayNewVin = 'TESTDATAFWELL0001'
  const awayPriceVin = 'TESTDATAFWELL0002'
  const removedVin = 'TESTDATAREMVD0001'
  await page.addInitScript(() => {
    localStorage.setItem('maxey-home-store', 'Howell')
    localStorage.setItem('maxey-role', 'manager')
  })
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json() as BootstrapData
    expect(payload.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const vehicle = (vin: string) => {
      const match = payload.vehicles.find(candidate => candidate.vin === vin)
      expect(match, `The isolated synthetic release contains ${vin}`).toBeTruthy()
      return match!
    }
    function change(source: VehicleRecord, type: PublicChangeEvent['type'], beforeValue: PublicChangeEvent['beforeValue'], afterValue: PublicChangeEvent['afterValue'], valueType: PublicChangeEvent['valueType'], field: string): PublicChangeEvent {
      return { id: `synthetic-update-${type}-${source.vin}`, type, field, valueType,
        reportDate: payload.meta.reportDate, previousReportDate: '2026-08-29', vin: source.vin,
        stockNumber: source.stockNumber, vehicleName: source.vehicleName, store: source.publicStore,
        beforeValue, afterValue, currentVehicle: true, listingUrl: source.listingUrl }
    }
    payload.publicChanges = [
      change(vehicle(homeNewVin), 'new_arrival', null, 'Listed', 'state', 'Public listing'),
      change(vehicle(awayNewVin), 'new_arrival', null, 'Listed', 'state', 'Public listing'),
      change(vehicle(homePriceVin), 'price_change', 45000, 42500, 'money', 'Listed price'),
      change(vehicle(awayPriceVin), 'price_change', 30000, 30750, 'money', 'Listed price'),
      change(vehicle(homePriceVin), 'mileage_change', 18920, 19020, 'mileage', 'Mileage'),
      change(vehicle('TESTDATALNCN00001'), 'website_status_change', 'In transit', 'In stock', 'state', 'Website status'),
      { id: 'synthetic-removed-listing', type: 'removed', field: 'Public listing', valueType: 'state', reportDate: payload.meta.reportDate,
        previousReportDate: '2026-08-29', vin: removedVin, stockNumber: 'DEMO-REMOVED', vehicleName: 'Synthetic removed vehicle',
        store: 'Howell', beforeValue: 'Listed', afterValue: 'Not in current public release', currentVehicle: false, listingUrl: null },
    ]
    payload.meta.publicChangeBaselineDate = '2026-08-29'
    payload.meta.publicChangeCounts = { newArrival: 2, priceChange: 2, removed: 1, mileageChange: 1, websiteStatusChange: 1, stockCorrection: 0, storeTransfer: 0 }
    vehicle(homePriceVin).listedPrice = 42500
    vehicle(awayPriceVin).listedPrice = 30750
    await route.fulfill({ response, json: payload })
  })

  await page.goto('/updates')
  const scope = page.getByRole('group', { name: 'Inventory change store scope' })
  const tabs = page.getByRole('group', { name: 'Inventory update type' })
  await expect(scope.getByRole('button', { name: 'Howell', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(tabs.getByRole('button', { name: /New arrivals/ })).toContainText('1')
  const arrivals = page.getByRole('list', { name: 'New arrivals results' })
  await expect(arrivals.getByRole('listitem')).toHaveCount(1)
  await expect(arrivals).toContainText(homeNewVin)
  await expect(arrivals).not.toContainText(awayNewVin)
  await scope.getByRole('button', { name: 'All stores', exact: true }).click()
  await expect(arrivals.getByRole('listitem')).toHaveCount(2)
  await expect(arrivals).toContainText(awayNewVin)
  await page.screenshot({ path: testInfo.outputPath('updates-new-all-stores.png'), fullPage: false })

  await tabs.getByRole('button', { name: /Price changes/ }).click()
  const prices = page.getByRole('list', { name: 'Price changes results' })
  await expect(prices.getByRole('listitem')).toHaveCount(2)
  const reduction = prices.getByRole('listitem').filter({ hasText: homePriceVin })
  await expect(reduction.locator('del')).toHaveText('$45,000')
  await expect(reduction.locator('.updates-values strong')).toHaveText('$42,500')
  await expect(reduction).toContainText('Down $2,500')
  const increase = prices.getByRole('listitem').filter({ hasText: awayPriceVin })
  await expect(increase.locator('del')).toHaveText('$30,000')
  await expect(increase.locator('.updates-values strong')).toHaveText('$30,750')
  await expect(increase).toContainText('Up $750')
  await scope.getByRole('button', { name: 'Howell', exact: true }).click()
  await expect(prices.getByRole('listitem')).toHaveCount(1)
  await expect(prices).not.toContainText(awayPriceVin)
  await page.screenshot({ path: testInfo.outputPath('updates-prices-my-store.png'), fullPage: false })

  await tabs.getByRole('button', { name: /Other updates/ }).click()
  const other = page.getByRole('list', { name: 'Other updates results' })
  await expect(other.getByRole('listitem')).toHaveCount(2)
  await expect(other).toContainText('18,920 mi → 19,020 mi')
  await page.getByLabel('Other update type').selectOption('removed')
  await expect(other.getByRole('listitem')).toHaveCount(1)
  const removed = other.getByRole('listitem').filter({ hasText: removedVin })
  await expect(removed).toContainText('Listing removed')
  await expect(removed).toContainText('No current listing')
  await expect(removed.getByRole('link')).toHaveCount(0)
  await page.getByText('About this update', { exact: true }).click()
  await expect(page.getByText('Changes compare completed public inventory snapshots.', { exact: false })).toContainText('A removed listing does not confirm a sale, delivery, hold release, or physical departure.')
  await page.screenshot({ path: testInfo.outputPath('updates-removed-listing.png'), fullPage: false })
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)

  await page.getByLabel('Other update type').selectOption('all')
  await scope.getByRole('button', { name: 'All stores', exact: true }).click()
  await expect(other.getByRole('listitem')).toHaveCount(3)
  await expect(other).toContainText('Online status changed')
  await tabs.getByRole('button', { name: /Price changes/ }).click()
  const current = page.getByRole('list', { name: 'Price changes results' }).getByRole('listitem').filter({ hasText: homePriceVin })
  await expect(current.getByRole('link', { name: 'Open vehicle' })).toHaveAttribute('href', `/inventory?scope=group&vin=${homePriceVin}`)
  await current.getByRole('link', { name: 'Open vehicle' }).click()
  await expect(page).toHaveURL(new RegExp(`/inventory\\?scope=group&vin=${homePriceVin}`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText(homePriceVin)
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).not.toHaveURL(/vin=/)
})
