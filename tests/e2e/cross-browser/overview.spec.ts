import { expect, test } from '@playwright/test'

test('the Overview preserves its hierarchy and count links across browser engines', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto('/overview')

  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Store summary' }).getByRole('heading', { level: 3 })).toHaveCount(4)
  await expect(page.getByRole('link', { name: /^Howell: \d+ vehicles? on lot$/ })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=on-lot')
  await expect(page.getByRole('region', { name: 'Service' })).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
})
