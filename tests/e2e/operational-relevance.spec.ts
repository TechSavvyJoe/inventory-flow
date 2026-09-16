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
  await page.locator('.transfer-list-item').first().click()
  const next = page.getByRole('region', { name: 'Next move action' })
  await expect(next).toContainText('Demo Fowlerville Salesperson')
  await expect(next.getByRole('button', { name: 'Update showing / outcome' })).toBeVisible()
  const route = await page.locator('.simple-move-route').boundingBox()
  const action = await next.boundingBox()
  const records = await page.getByRole('navigation', { name: 'Vehicle reference' }).boundingBox()
  expect(route!.y).toBeLessThan(action!.y)
  expect(action!.y + action!.height).toBeLessThanOrEqual(records!.y)
  // The main action is reachable immediately, above the fixed mobile footer.
  const button = await next.getByRole('button', { name: 'Update showing / outcome' }).boundingBox()
  expect(button!.y + button!.height).toBeLessThan((page.viewportSize()?.height ?? 900) - 60)
  await expect(page.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', /^\/inventory\?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Ftransfers%3Fid%3D/)
  await expectFocusedLayout(page)
})

test('service actions appear before secondary facts without sales provider panels', async ({ page }) => {
  await page.goto('/service?vin=TESTDATAHWELL0002')
  const actions = page.getByRole('group', { name: 'Service actions' })
  await expect(actions.getByRole('button', { name: 'Start service' })).toBeVisible()
  await expect(page.getByText('Current state')).toContainText('Waiting for service')
  const action = await actions.boundingBox()
  const facts = await page.getByLabel('Service decision facts').boundingBox()
  expect(action!.y + action!.height).toBeLessThanOrEqual(facts!.y)
  expect(action!.y + action!.height).toBeLessThan((page.viewportSize()?.height ?? 900) - 60)
  await expect(page.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0002&tab=data&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0002')
  await expectFocusedLayout(page)
})

test('action cards expose owner, due and the task destination with explicit records links', async ({ page }) => {
  await page.goto('/attention')
  const first = page.locator('.action-row').first()
  await expect(first.locator('.action-owner')).toContainText('Demo Salesperson')
  await expect(first.getByRole('link', { name: 'Review hold' })).toBeVisible()
  await expect(first.getByRole('link', { name: 'Records', exact: true })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fattention')
  await expect(first.locator('.action-vehicle')).not.toContainText('$51,800')
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
