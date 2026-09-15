import { test, expect } from '@playwright/test'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// The owning config starts isolated synthetic API/web servers at 4274/4273.
test('service work moves from waiting through completion and stays permissioned after reload', async ({ page, request }, testInfo) => {
  const vin = 'TESTDATAHWELL0002'
  const endpoint = `/api/vehicles/${vin}/service`
  const identity = { 'x-inventory-demo-role': 'manager', 'x-inventory-demo-store': 'Howell', 'x-inventory-demo-user': 'Synthetic QA Manager' }
  const initial = await request.get(endpoint, { headers: identity })
  expect(initial.ok()).toBe(true)
  const before = await initial.json()
  if (before.status !== 'needs_service') {
    // Reset only this fabricated ledger between browser projects.
    const reset = await request.post(endpoint, { headers: { ...identity, 'Idempotency-Key': `synthetic-service-reset-${testInfo.project.name}` }, data: { status: 'needs_service', expectedVersion: before.version } })
    expect(reset.ok()).toBe(true)
  }
  await page.addInitScript(() => {
    if (!localStorage.getItem('maxey-role')) localStorage.setItem('maxey-role', 'manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto(`/service?vin=${vin}`)
  await expect(page.locator('.service-current strong')).toHaveText('Waiting for service')
  await page.getByRole('button', { name: 'Start service' }).click()
  await page.getByLabel('Date entered service').fill('2026-08-29')
  await page.getByLabel('Service note').fill('Synthetic inspection requested')
  await page.getByRole('button', { name: 'Save service status' }).click()
  await expect(page.getByText(/In service saved for/)).toBeVisible()
  await page.getByRole('button', { name: 'Back to service list' }).click()
  await page.getByRole('button', { name: /^In service/ }).click()
  await expect(page.locator('.service-vehicle-row')).toHaveCount(1)
  await page.locator('.service-vehicle-row').click()
  await expect(page.locator('.service-current strong')).toHaveText('In service')
  await page.getByRole('button', { name: 'Mark Ready' }).click()
  await page.getByLabel('Date service completed').fill('2026-08-30')
  await page.getByRole('button', { name: 'Save service status' }).click()
  await expect(page.getByText(/Ready saved for/)).toBeVisible()
  await page.reload()
  await expect(page.locator('.service-current strong')).toHaveText('Ready')
  await expect(page.locator('.service-recorded-dates')).toContainText('Aug 29, 2026')
  await expect(page.locator('.service-recorded-dates')).toContainText('Aug 30, 2026')
  await expect(page.locator('.service-history')).toContainText('Waiting for service')
  await expect(page.locator('.service-history')).toContainText('In service')
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
  await page.screenshot({ path: testInfo.outputPath('service-completed.png'), fullPage: false })

  const saved = await (await request.get(endpoint, { headers: identity })).json()
  const crossStore = await request.post(endpoint, { headers: { ...identity, 'x-inventory-demo-store': 'Lincoln', 'Idempotency-Key': `synthetic-service-forbidden-${testInfo.project.name}` }, data: { status: 'needs_service', expectedVersion: saved.version } })
  expect(crossStore.status()).toBe(403)
  await page.evaluate(() => localStorage.setItem('maxey-role', 'sales'))
  await page.reload()
  await expect(page.getByText('A Howell manager can update this vehicle’s service status.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save service status' })).toHaveCount(0)
  const salesWrite = await request.post(endpoint, { headers: { ...identity, 'x-inventory-demo-role': 'sales', 'Idempotency-Key': `synthetic-service-sales-forbidden-${testInfo.project.name}` }, data: { status: 'needs_service', expectedVersion: saved.version } })
  expect(salesWrite.status()).toBe(403)
  expect((await (await request.get(endpoint, { headers: identity })).json()).version).toBe(saved.version)
})
