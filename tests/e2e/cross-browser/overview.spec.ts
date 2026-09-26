import { expect, test } from '@playwright/test'

test('manager overview preserves its hierarchy and controls across browser engines', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto('/overview')

  await expect(page.getByRole('heading', { name: 'Inventory overview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Howell: 2 home inventory vehicles' })).toBeVisible()
  await page.getByRole('button', { name: 'Howell: 2 home inventory vehicles' }).click()
  await expect(page.getByRole('heading', { name: 'Howell · Home inventory' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Records \d\/6$/ }).first()).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
})
