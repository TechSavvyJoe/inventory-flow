import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
})

async function expectFocusedLayout(page: Page) {
  await expect(page.getByText('Demo · Synthetic records & AI illustrations.')).toBeVisible()
  await expect(page.locator('.workflow-resource-row')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('move route, owner and next action precede optional vehicle records', async ({ page }) => {
  await page.goto('/transfers')
  // Open the seeded Fowlerville showing move by what it is, not by list position:
  // the list puts the viewer's own next steps first, and earlier specs in the
  // same run (desktop, then mobile) add moves that can outrank it.
  await page.locator('.transfer-list-items').getByRole('button')
    .filter({ hasText: 'TESTDATAHWELL0001' })
    .filter({ hasText: 'Demo Fowlerville Salesperson' })
    .first().click()
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Demo Fowlerville Salesperson')
  await expect(next.getByRole('button', { name: 'Update the showing outcome' })).toBeVisible()
  const route = await page.locator('.simple-move-route').boundingBox()
  const action = await next.boundingBox()
  const records = await page.getByRole('navigation', { name: 'Vehicle reference' }).boundingBox()
  expect(route!.y).toBeLessThan(action!.y)
  expect(action!.y + action!.height).toBeLessThanOrEqual(records!.y)
  // The main action is reachable immediately, above the fixed mobile footer.
  const button = await next.getByRole('button', { name: 'Update the showing outcome' }).boundingBox()
  expect(button!.y + button!.height).toBeLessThan((page.viewportSize()?.height ?? 900) - 60)
  await expect(page.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', /^\/inventory\?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Ftransfers%3Fid%3D/)
  await expectFocusedLayout(page)
})

for (const action of ['Open vehicle', 'Records']) {
  test(`${action} returns to the selected service store`, async ({ page }) => {
    await page.goto('/service?status=needs_service&store=Lincoln')
    const results = page.getByRole('status').filter({ hasText: /vehicles? · Lincoln/ })
    await expect(results).toBeVisible()
    const before = await results.innerText()
    await page.getByRole('navigation', { name: /^Actions for/ }).first().getByRole('link', { name: new RegExp(`^${action} for`) }).click()
    const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
    await expect(workspace).toBeVisible()
    await workspace.getByRole('button', { name: 'Close vehicle details', exact: true }).click()
    await expect(results).toHaveText(before)
    await expect(page.getByRole('button', { name: 'Clear service store filter: Lincoln' })).toBeVisible()
  })
}

test('service actions appear before secondary facts without sales provider panels', async ({ page }) => {
  await page.goto('/service?vin=TESTDATAHWELL0002')
  const actions = page.getByRole('group', { name: 'Service actions' })
  await expect(actions.getByRole('button', { name: 'In service', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recorded service status' })).toContainText('Waiting for service')
  const action = await actions.boundingBox()
  const facts = await page.getByLabel('Service decision facts').boundingBox()
  expect(action!.y + action!.height).toBeLessThanOrEqual(facts!.y)
  // The photo and configuration can extend beyond a short phone's first
  // screen. Scrolling must expose full-size actions clear of fixed app chrome.
  await actions.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  const button = await actions.getByRole('button', { name: 'In service', exact: true }).boundingBox()
  const header = await page.getByRole('banner').boundingBox()
  const mobileNavigation = await page.getByRole('navigation', { name: 'Mobile primary', includeHidden: true }).boundingBox()
  expect(button!.height).toBeGreaterThanOrEqual(44)
  expect(button!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
  expect(button!.y + button!.height).toBeLessThanOrEqual(mobileNavigation?.y ?? page.viewportSize()!.height)
  await expect(page.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0002&tab=data&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0002')
  await actions.getByRole('button', { name: 'In service', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Start service', exact: true })).toBeVisible()
  await expect(page.getByLabel('Date entered service')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expectFocusedLayout(page)
})

test('action cards expose owner, due and the task destination with explicit records links', async ({ page }) => {
  await page.goto('/attention')
  const first = page.locator('.action-row').first()
  await expect(first.locator('.action-owner')).toContainText('Demo Salesperson')
  await expect(first.getByRole('link', { name: 'Review hold' })).toBeVisible()
  await expect(first.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fattention')
  await expect(first.locator('.action-vehicle')).toContainText('$51,800 · 12,450 mi')
  await expect(first.getByRole('button', { name: 'Copy VIN: TESTDATAHWELL0001', exact: true })).toBeVisible()
  await expectFocusedLayout(page)
})

test('price changes keep exact before, after and delta together instead of unrelated reports', async ({ page }) => {
  await page.goto('/updates?view=price')
  const row = page.locator('.updates-row').first()
  await expect(row.locator('.updates-values')).toContainText('$53,300')
  await expect(row.locator('.updates-values')).toContainText('$51,800')
  await expect(row.locator('.updates-values')).toContainText('Down $1,500')
  await expect(row.getByRole('link', { name: 'Service', exact: true })).toHaveCount(0)
  await expect(row.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fupdates%3Fview%3Dprice')
  await expectFocusedLayout(page)
})
