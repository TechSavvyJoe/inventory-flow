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
  await page.getByRole('button', { name: 'In service', exact: true }).click()
  await page.getByLabel('Date entered service').fill('2026-08-29')
  await page.getByLabel('Service note').fill('Synthetic inspection requested')
  await page.getByRole('button', { name: 'Save service status' }).click()
  await expect(page.getByText(/In service saved for/)).toBeVisible()
  await page.getByRole('button', { name: 'Back to service list' }).click()
  await page.getByRole('group', { name: 'Service status', exact: true }).getByRole('button', { name: /^In service/ }).click()
  await expect(page.locator('.service-vehicle-row')).toHaveCount(1)
  await page.locator('.service-vehicle-row').click()
  await expect(page.locator('.service-current strong')).toHaveText('In service')
  await page.getByRole('button', { name: 'Ready', exact: true }).click()
  await page.getByLabel('Date service completed').fill('2026-08-30')
  await page.getByRole('button', { name: 'Save service status' }).click()
  await expect(page.getByText(/Ready saved for/)).toBeVisible()
  await page.reload()
  await expect(page.locator('.service-current strong')).toHaveText('Ready')
  await expect(page.locator('.service-recorded-dates')).toContainText('08/29/2026')
  await expect(page.locator('.service-recorded-dates')).toContainText('08/30/2026')
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


test('service setup exposes captured OASIS details and an expandable photo without losing the draft', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/service?vin=TESTDATAHWELL0001&action=in_service&returnTo=%2Finventory%3Fscope%3Dhome')
    if (width >= 1000) {
      const vehicle = (await page.getByRole('region', { name: 'Vehicle summary', exact: true }).boundingBox())!
      const reference = (await page.getByRole('region', { name: 'Service reference', exact: true }).boundingBox())!
      const status = (await page.getByRole('region', { name: 'Service status', exact: true }).boundingBox())!
      const history = (await page.getByRole('region', { name: 'Service history', exact: true }).boundingBox())!
      expect(reference.width).toBeCloseTo(vehicle.width, 0)
      expect(history.y).toBeCloseTo(status.y, 0)
      expect(reference.y - Math.max(status.y + status.height, history.y + history.height)).toBeLessThanOrEqual(20)
    }
    const note = page.getByLabel('Service note')
    await note.fill('Synthetic inspection draft')
    const reference = page.getByRole('region', { name: 'Service reference', exact: true })
    await expect(reference.getByText('DEMO-CAL-DEMO-H01', { exact: true })).toBeVisible()
    await expect(reference.getByText('23,550 miles', { exact: true })).toBeVisible()
    await expect(reference.getByText('7 months', { exact: true })).toBeVisible()
    await expect(reference.getByText('Bumper to Bumper', { exact: true })).toBeVisible()
    await expect(reference.getByText('Powertrain', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    const photo = page.getByRole('button', { name: 'Open photo gallery for 2024 Ford F-150 Lariat', exact: true })
    await photo.click()
    const gallery = page.getByRole('dialog', { name: '2024 Ford F-150 Lariat photo gallery', exact: true })
    await expect(gallery).toBeVisible()
    await gallery.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(gallery.getByRole('button', { name: 'Reset photo zoom', exact: true })).toHaveText('150%')
    await gallery.getByRole('button', { name: 'Close photo gallery', exact: true }).click()
    await expect(photo).toBeFocused()
    await expect(note).toHaveValue('Synthetic inspection draft')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Start service', exact: true })).toHaveCount(0)
  }
})
