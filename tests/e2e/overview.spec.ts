import { expect, test, type Page } from '@playwright/test'
import type { BootstrapData } from '../../src/types'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1320, height: 820 },
  { width: 1440, height: 900 },
]

async function signInAs(page: Page, role: 'group_manager' | 'manager' | 'sales') {
  await page.addInitScript((value) => {
    localStorage.setItem('maxey-role', value)
    localStorage.setItem('maxey-home-store', 'Howell')
  }, role)
}

test('the server Overview stays dense, navigable, and printable at every canonical viewport', async ({ page }, testInfo) => {
  await signInAs(page, 'group_manager')
  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Store summary' }).getByRole('heading', { level: 3 })).toHaveCount(4)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
    const targets = await page.locator('.ov-page button, .ov-page a').evaluateAll(elements => elements
      .filter(element => element.getBoundingClientRect().width > 0)
      .map(element => element.getBoundingClientRect().height))
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: testInfo.outputPath(`overview-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByText(/Inventory Flow · Daily snapshot · All stores/)).toBeVisible()
  await expect(page.locator('.desktop-nav')).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
})

/** OVERVIEW_SPEC §15.8: the two synthetic Howell units shaped like the unit tests' direct move away, injected client-side so the shared demo ledger is untouched. */
async function withHowellUnitsAway(page: Page) {
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json() as BootstrapData
    expect(payload.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const overview = payload.overview!
    for (const [vin, days] of [['TESTDATAHWELL0001', 3], ['TESTDATAHWELL0002', 9]] as const) {
      Object.assign(overview.vehicleFacts[vin], { custody: 'away', custodyBasis: 'ledger', currentStore: 'Lincoln', daysAway: days })
      overview.stores.find(row => row.store === 'Howell')!.away += 1
    }
    await route.fulfill({ response, json: payload })
  })
}

test('on a phone the home card core counts and the first away row share the first viewport', async ({ page }) => {
  await signInAs(page, 'manager')
  await withHowellUnitsAway(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/overview')
  const summary = page.getByRole('region', { name: 'Store summary' })
  await expect(summary.getByRole('link', { name: 'Howell: 2 vehicles away from home' })).toBeInViewport()
  const more = summary.getByText('More counts')
  await expect(more).toBeVisible()
  await expect(summary.getByRole('link', { name: /with records incomplete$/ })).toBeHidden()
  const where = page.getByRole('region', { name: 'Where is my inventory' })
  const firstRow = where.getByRole('listitem').first()
  await expect(firstRow).toContainText('Away · at Lincoln')
  const fold = await page.evaluate(() => document.documentElement.clientHeight)
  const box = (await firstRow.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(fold)

  await more.click()
  await expect(summary.getByRole('link', { name: /with records incomplete$/ })).toBeVisible()
})

test('a store-card count opens Inventory filtered to exactly that count, and Back returns to the Overview', async ({ page }) => {
  await signInAs(page, 'manager')
  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  // Phones fold the secondary counts behind one disclosure.
  const more = page.getByText('More counts')
  if (await more.isVisible()) await more.click()
  const link = page.getByRole('link', { name: /^Howell: \d+ vehicles? with records incomplete$/ })
  const count = Number(await link.textContent())
  await link.click()
  await expect(page).toHaveURL(/\/inventory\?scope=group$/)
  await expect(page.getByRole('button', { name: 'Clear Overview view: Records incomplete · Howell' })).toBeVisible()
  await expect(page.getByText(`Showing 1–${count} of ${count}`)).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/overview$/)
})

test('the retired Group operations route opens the Overview', async ({ page }) => {
  await signInAs(page, 'group_manager')
  await page.goto('/manager')
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
})

test('sales open the Overview read-only, with no manager actions', async ({ page }) => {
  await signInAs(page, 'sales')
  await page.goto('/overview')
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByText('Read-only')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Update service/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /back home$/ })).toHaveCount(0)
})

test('the phone rail is Overview · Inventory · Moves · Actions · More, with the rest under More', async ({ page }) => {
  await signInAs(page, 'sales')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/overview')
  const rail = page.getByRole('navigation', { name: 'Mobile primary' })
  await expect(rail.getByRole('link')).toHaveText([/Overview/, /Inventory/, /Moves/, /Actions/])
  await expect(rail.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  await rail.getByRole('button', { name: 'More app controls' }).click()
  const more = page.getByRole('dialog', { name: 'Account and app controls' })
  await expect(more.getByRole('link', { name: /Inventory updates/ })).toBeVisible()
  await expect(more.getByRole('link', { name: /Service status/ })).toBeVisible()
})
