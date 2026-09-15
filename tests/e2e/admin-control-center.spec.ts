import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
})

test('group managers can scan the read-only control center without horizontal overflow', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  await page.setViewportSize(mobile ? { width: 426, height: 1024 } : { width: 1488, height: 1058 })
  const adminRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/overview') adminRequests.push(request.method())
  })

  await page.goto('/admin')

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Control center' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Control center sections' }).getByRole('link')).toHaveCount(4)
  await expect(page.getByText('Read-only view', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /add|create|delete|disable|edit|save/i })).toHaveCount(0)
  // React StrictMode deliberately remounts once in development, so the page
  // may repeat its cancellable read. Every request must still be read-only.
  expect(adminRequests.length).toBeGreaterThan(0)
  expect(new Set(adminRequests)).toEqual(new Set(['GET']))

  const peopleTable = page.getByRole('table', { name: 'People with Inventory Flow access' })
  const mobilePeople = page.locator('.admin-person-row')
  const auditTable = page.getByRole('table', { name: 'Recent read-only audit activity' })
  const mobileAudit = page.locator('.admin-audit-row')
  if (mobile) {
    await expect(peopleTable).toBeHidden()
    await expect(mobilePeople.first()).toBeVisible()
    await expect(mobilePeople).toHaveCount(4)
    await expect(mobileAudit).toHaveCount(3)
    await mobilePeople.first().locator('summary').click()
    await expect(mobilePeople.first()).toHaveAttribute('open', '')
    await expect(mobilePeople.first().getByText('Last active')).toBeVisible()
    await mobilePeople.first().locator('summary').click()
    await expect(mobilePeople.first()).not.toHaveAttribute('open', '')

    const showAllPeople = page.getByRole('button', { name: 'Show all 8 people' })
    const showAllEvents = page.getByRole('button', { name: /^Show all \d+ events$/ })
    await expect(showAllPeople).toHaveAttribute('aria-controls', 'admin-mobile-people-list')
    await expect(showAllEvents).toHaveAttribute('aria-controls', 'admin-mobile-audit-list')
    const auditEventCount = Number.parseInt((await showAllEvents.innerText()).match(/\d+/)?.[0] ?? '', 10)
    expect(auditEventCount).toBeGreaterThan(3)
    expect(await showAllPeople.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    expect(await showAllEvents.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)

    await showAllPeople.click()
    await expect(mobilePeople).toHaveCount(8)
    const showFewerPeople = page.getByRole('button', { name: 'Show fewer people' })
    await expect(showFewerPeople).toHaveAttribute('aria-expanded', 'true')
    await showFewerPeople.click()
    await expect(mobilePeople).toHaveCount(4)

    await showAllEvents.click()
    await expect(mobileAudit).toHaveCount(auditEventCount)
    const showFewerEvents = page.getByRole('button', { name: 'Show fewer events' })
    await expect(showFewerEvents).toHaveAttribute('aria-expanded', 'true')
    await showFewerEvents.click()
    await expect(mobileAudit).toHaveCount(3)
  } else {
    await expect(peopleTable).toBeVisible()
    await expect(mobilePeople.first()).toBeHidden()
    await expect(peopleTable.locator('tbody tr')).toHaveCount(8)
    await expect(auditTable.locator('tbody tr').first()).toBeVisible()
    expect(await auditTable.locator('tbody tr').count()).toBeGreaterThan(3)
    await expect(page.getByRole('button', { name: 'Show all 8 people' })).toBeHidden()
    await expect(page.getByRole('button', { name: /^Show all \d+ events$/ })).toBeHidden()
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await page.screenshot({
    path: testInfo.outputPath(`admin-control-center-${testInfo.project.name}.png`),
    fullPage: true,
    scale: 'css',
  })
})

test('store managers are redirected before the admin page can request data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('maxey-role', 'manager'))
  let adminRequestCount = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/overview') adminRequestCount += 1
  })

  await page.goto('/admin')

  await expect(page).toHaveURL(/\/attention$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Action center' })).toBeVisible()
  expect(adminRequestCount).toBe(0)
})
