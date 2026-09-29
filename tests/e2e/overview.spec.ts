import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
})

test('management overview stays dense, navigable, and printable at every canonical viewport', async ({ page }, testInfo) => {
  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: 'Inventory overview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Store inventory summaries' }).getByRole('heading', { level: 2 })).toHaveCount(4)

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1320, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
    const targets = await page.locator('.ov-page button, .ov-page a').evaluateAll(elements => elements.filter(element => !(element as HTMLButtonElement).disabled).map(element => element.getBoundingClientRect().height))
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(44)
    if (viewport.width === 390) {
      const storeStrip = page.getByRole('region', { name: 'Store inventory summaries' })
      const stripLayout = await storeStrip.evaluate(element => ({
        bottom: element.getBoundingClientRect().bottom,
        height: element.getBoundingClientRect().height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(stripLayout.height).toBeLessThan(360)
      expect(stripLayout.scrollWidth).toBeGreaterThan(stripLayout.clientWidth)
      const populationTop = await page.getByRole('heading', { name: 'Howell · Home inventory' }).evaluate(element => element.closest('section')!.getBoundingClientRect().top)
      expect(populationTop - stripLayout.bottom).toBeLessThan(24)
    }
    await page.screenshot({ path: testInfo.outputPath(`overview-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }

  await page.getByRole('button', { name: 'Howell: 2 home inventory vehicles' }).click()
  const population = page.getByRole('region', { name: /Howell · Home inventory/ })
  await expect(population.getByText('2 vehicles')).toBeVisible()
  await expect(population.getByRole('link', { name: /^Records \d\/6$/ }).first()).toHaveAttribute('href', /tab=data/)
  await expect(population.getByText(/Source-reported store; physical custody not confirmed/).first()).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByText(/Inventory Flow daily snapshot/)).toBeVisible()
  await expect(page.locator('.desktop-nav')).toBeHidden()
})

test('the retired Group operations route opens the management overview', async ({ page }) => {
  await page.goto('/overview')
  const navigation = (page.viewportSize()?.width ?? 1440) <= 700
    ? page.getByRole('navigation', { name: 'Mobile primary' })
    : page.getByRole('navigation', { name: 'Primary' })
  await expect(navigation.getByRole('link', { name: (page.viewportSize()?.width ?? 1440) <= 700 ? 'Overview' : 'Inventory overview' })).toHaveAttribute('aria-current', 'page')

  await page.getByRole('button', { name: 'Open account and app controls' }).click()
  await expect(page.getByRole('dialog', { name: 'Account and app controls' }).getByRole('link', { name: /Group operations/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.goto('/manager')
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('heading', { name: 'Inventory overview' })).toBeVisible()
})

test('sales roles cannot open the management overview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('maxey-role', 'sales'))
  await page.goto('/overview')
  await expect(page).toHaveURL(/\/attention$/)
  await expect(page.getByRole('heading', { name: 'Action center' })).toBeVisible()
})
