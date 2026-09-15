import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
})

test('group managers can scan people, feeds and activity without horizontal overflow', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Control center' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Control center sections' }).getByRole('link')).toHaveCount(4)
  await expect(page.getByText('Group manager controls', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add employee' })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Search employees' }).fill('Demo Howell')
  await expect(page.locator('.admin-member-card')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Edit Demo Howell Manager' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search employees' }).clear()
  expect(await page.locator('.admin-member-card').count()).toBeGreaterThanOrEqual(8)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('admin-directory.png'), fullPage: false })
})

test('creates, edits and disables synthetic employee access with visible audit history', async ({ page }, testInfo) => {
  const name = `Synthetic QA ${testInfo.project.name} ${Date.now()}`
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Add employee' }).click()
  await page.getByLabel('Full name', { exact: true }).fill(name)
  await page.getByLabel('Sign-in email', { exact: true }).fill(`${crypto.randomUUID()}@example.invalid`)
  await page.getByLabel('Role', { exact: true }).selectOption('manager')
  await page.getByLabel('Home store', { exact: true }).selectOption('Howell')
  await page.getByLabel('Reason for change', { exact: true }).fill('Synthetic UI verification')
  await page.getByRole('button', { name: 'Save access', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: `${name}'s access was saved.` })).toBeVisible()
  await expect(page.locator('.admin-access-history')).toContainText('Synthetic UI verification')
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  await expect(page.getByLabel('Sign-in email')).toBeDisabled()
  await page.getByLabel('Home store', { exact: true }).selectOption('Lincoln')
  await page.getByRole('radio', { name: 'Disabled', exact: true }).check()
  await page.getByLabel('Reason for change', { exact: true }).fill('Synthetic deactivation test')
  await page.getByRole('button', { name: 'Save access', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: `${name}'s access was saved.` })).toBeVisible()
  const card = page.locator('.admin-member-card').filter({ hasText: name })
  await expect(card).toContainText('Lincoln')
  await expect(card).toContainText('Disabled')
  await expect(page.locator('.admin-access-history')).toContainText('Synthetic deactivation test')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('admin-saved-access.png'), fullPage: false })
})

test('store managers are redirected before requesting admin data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('maxey-role', 'manager'))
  let adminRequestCount = 0
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/admin/')) adminRequestCount += 1 })
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/attention$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Action center' })).toBeVisible()
  expect(adminRequestCount).toBe(0)
})
