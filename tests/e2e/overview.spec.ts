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

test('on a phone an actionable vehicle leads the single-column overview and store evidence follows', async ({ page }) => {
  await signInAs(page, 'manager')
  await withHowellUnitsAway(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/overview')
  const queue = page.getByRole('region', { name: 'Work queue' })
  const selectedTab = queue.getByRole('button', { pressed: true })
  await expect(selectedTab).not.toHaveAccessibleName(/ 0$/)
  const firstAction = queue.locator('.ov-work-row').first().getByRole('link').first()
  await expect(firstAction).toBeInViewport()
  const fold = await page.evaluate(() => document.documentElement.clientHeight)
  const queueBox = (await queue.boundingBox())!
  expect(queueBox.y + queueBox.height).toBeLessThanOrEqual(fold)

  const summary = page.getByRole('region', { name: 'Store summary' })
  // Earlier specs in the same run may record real moves on the shared demo
  // ledger, so the count is not pinned; the reading order is what this covers.
  await expect(summary.getByRole('link', { name: /^Howell: \d+ vehicles? away from home$/ })).toBeVisible()
  const more = summary.getByText('More counts')
  await expect(more).toBeVisible()
  await expect(summary.getByRole('link', { name: /with records incomplete$/ })).toBeHidden()
  const where = page.getByRole('region', { name: 'Where is my inventory' })
  const firstRow = where.getByRole('listitem').first()
  await expect(firstRow).toContainText(/Away · at /)
  const readingOrder = await page.locator('.ov-page > *').evaluateAll(elements => elements.map(element => element.className))
  expect(readingOrder.findIndex(className => className.includes('ov-work-queue')))
    .toBeLessThan(readingOrder.findIndex(className => className.includes('ov-stores')))

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
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sales workspace', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Store summary' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Store operations', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Store summary' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Update service/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /back home$/ })).toHaveCount(0)
})

test('the phone rail is Overview · Inventory · Actions · Service · More, with Moves and the rest under More', async ({ page }) => {
  await signInAs(page, 'sales')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/overview')
  const rail = page.getByRole('navigation', { name: 'Mobile primary' })
  await expect(rail.getByRole('link')).toHaveText([/Overview/, /Inventory/, /Actions/, /Service/])
  await expect(rail.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  await rail.getByRole('button', { name: 'More app controls' }).click()
  const more = page.getByRole('dialog', { name: 'Account and app controls' })
  await expect(more.getByRole('link', { name: /Inventory updates/ })).toBeVisible()
  await expect(more.getByRole('link', { name: /Vehicle moves/ })).toBeVisible()
})

// Overview decision links, the disposition dialog and its two entry points.

test('work-queue tabs support the keyboard and open the exact vehicle action behind them', async ({ page }) => {
  await signInAs(page, 'group_manager')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/overview')
  await expect(page.getByRole('region', { name: 'Store board' })).toHaveCount(0)
  const queue = page.getByRole('region', { name: 'Work queue' })
  const serviceTab = queue.getByRole('button', { name: /^Service \d+$/ })
  await serviceTab.focus()
  await page.keyboard.press('Enter')
  await expect(serviceTab).toHaveAttribute('aria-pressed', 'true')
  const action = queue.getByRole('link', { name: /^Update service$/ }).first()
  const actionHref = await action.getAttribute('href')
  expect(actionHref).toMatch(/^\/service\?vin=TESTDATA[A-Z0-9]+&returnTo=%2Foverview$/)
  await action.click()
  const serviceUrl = new URL(actionHref!, 'https://inventory.invalid')
  await expect(page).toHaveURL(new RegExp(`/service\\?vin=${serviceUrl.searchParams.get('vin')}&returnTo=%2Foverview$`))
  await page.goBack()
  await expect(page).toHaveURL(/\/overview$/)

  const exceptionsTab = queue.getByRole('button', { name: /^Exceptions \d+$/ })
  await exceptionsTab.focus()
  await page.keyboard.press(' ')
  await expect(exceptionsTab).toHaveAttribute('aria-pressed', 'true')
  const review = queue.getByRole('link', { name: /^Review \d+ vehicles?$/ }).first()
  const reviewHref = (await review.getAttribute('href'))!
  const reviewUrl = new URL(reviewHref, 'https://inventory.invalid')
  expect(reviewUrl.pathname).toBe('/inventory')
  expect(reviewUrl.searchParams.get('scope')).toBe('group')
  const store = reviewUrl.searchParams.get('store')!
  expect(store).toBeTruthy()
  await review.click()
  await expect(page).toHaveURL(/\/inventory\?scope=group$/)
  await expect(page.getByRole('button', { name: new RegExp(`Clear Overview view: .+ · ${store}$`) })).toBeVisible()
})

test('the disposition dialog traps focus, locks scroll, closes on Escape and restores focus at every viewport', async ({ page }, testInfo) => {
  await signInAs(page, 'group_manager')
  await page.goto('/overview')
  const section = page.getByRole('region', { name: 'Dispositions' })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const opener = section.getByRole('button', { name: /^(Change|Record) disposition for / }).first()
    await opener.scrollIntoViewIfNeeded()
    await opener.click()
    const dialog = page.getByRole('dialog', { name: /^Disposition · / })
    await expect(dialog.getByRole('group', { name: /Change to|Record as/ })).toBeVisible()
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
    const targets = await dialog.locator('button, a, label, select, textarea, input:not([type="radio"])').evaluateAll(elements => elements
      .filter(element => element.getBoundingClientRect().width > 0)
      .map(element => element.getBoundingClientRect().height))
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(44)
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
    await page.screenshot({ path: testInfo.outputPath(`disposition-dialog-${viewport.width}x${viewport.height}.png`) })
    // Tab cycles inside the dialog.
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  }
})

test('a store manager records a disposition from the vehicle workspace and the Overview count follows', async ({ page }) => {
  await signInAs(page, 'manager')
  await page.setViewportSize({ width: 1320, height: 820 })
  const soldPending = async () => {
    await page.goto('/overview')
    const section = page.getByRole('region', { name: 'Dispositions' })
    await expect(section.getByRole('row', { name: /^Howell/ })).toBeVisible()
    const link = section.getByRole('link', { name: /^Howell: \d+ vehicles? with the disposition sold pending$/ })
    return await link.count() ? Number(await link.textContent()) : 0
  }
  const before = await soldPending()

  await page.goto('/inventory?scope=group&vin=TESTDATAHWELL0001')
  const operations = page.getByRole('region', { name: 'Vehicle operational summary' })
  let wasSoldPending = false
  const record = async (choice: 'Sold pending' | 'Keep') => {
    await operations.getByRole('button', { name: /^(Record|Change) disposition$/ }).click()
    const dialog = page.getByRole('dialog', { name: /^Disposition · / })
    // The choices render once the latest record has loaded.
    await expect(dialog.getByRole('group', { name: /Change to|Record as/ })).toBeVisible()
    const radio = dialog.getByRole('radio', { name: choice })
    if (!await radio.count()) {
      // A retried run left it Sold pending: reopen from Keep so the path is the same.
      wasSoldPending = true
      await dialog.getByRole('radio', { name: 'Keep' }).check()
      await dialog.getByRole('button', { name: 'Save disposition' }).click()
      await expect(dialog).toBeHidden()
      return record(choice)
    }
    await radio.check()
    await dialog.getByRole('button', { name: 'Save disposition' }).click()
    await expect(dialog).toBeHidden()
  }
  await record('Sold pending')
  await expect(operations.getByRole('status')).toHaveText(/^Sold pending recorded for #/)
  // Provenance belongs with the full disposition detail; the action and its
  // immediate confirmation remain in the operational summary.
  await expect(page.getByRole('region', { name: 'Operational details' })).toContainText('recorded in Inventory Flow')

  await expect.poll(soldPending).toBe(wasSoldPending ? before : before + 1)
})
