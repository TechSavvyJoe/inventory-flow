import { chooseInventoryView } from './inventory-controls'
import { expect, test } from '@playwright/test'
import type { BootstrapData } from '../../src/types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// The real Node HTTP routes persist app-owned controls, never source writes.
for (const [width, height] of [[1024, 768], [1320, 820], [1440, 900]]) {
  test(`vehicle reference identifiers keep copy targets separate across tabs at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/inventory?vin=TESTDATAHWELL0001')
    const workspace = page.getByRole('dialog', { name: '2024 Ford F-150 Lariat vehicle workspace' })
    await expect(workspace).toBeVisible()
    for (const tab of ['Overview', 'Equipment', 'Records']) {
      await workspace.getByRole('tab', { name: tab, exact: true }).click()
      const reference = tab === 'Overview'
        ? workspace.getByRole('region', { name: 'Vehicle photo and reference values' })
        : workspace.getByRole('group', { name: 'Vehicle reference', exact: true })
      for (const [label, value] of [['stock number', 'DEMO-H01'], ['VIN', 'TESTDATAHWELL0001']]) {
        const copy = reference.getByRole('button', { name: `Copy ${label}: ${value}`, exact: true })
        await expect(copy).toBeVisible()
        const text = copy.locator('..').getByText(value, { exact: true })
        const textBounds = await text.boundingBox()
        const copyBounds = await copy.boundingBox()
        expect(textBounds).not.toBeNull()
        expect(copyBounds).not.toBeNull()
        expect(textBounds!.x + textBounds!.width).toBeLessThanOrEqual(copyBounds!.x)
        expect(copyBounds!.width).toBeGreaterThanOrEqual(44)
        expect(copyBounds!.height).toBeGreaterThanOrEqual(44)
        expect(await text.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}

test('phone pagination and row size remain clear of the saved-vehicle launcher', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // The desktop direct-move test moves this synthetic Bronco to Ford Detroit
  // before the mobile project runs. Restore its initial location only in this
  // page's synthetic response so the one-row home layout stays deterministic;
  // the shared demo ledger and the real move assertions remain untouched.
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json() as BootstrapData
    expect(payload.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const bronco = payload.vehicles.find(vehicle => vehicle.vin === 'TESTDATAHWELL0002')!
    expect(bronco).toBeDefined()
    bronco.movement = {
      state: 'source_reported', label: 'Source-reported location', currentLocation: 'Howell',
      locationConfidence: 'reported', nextAction: 'Confirm with home store before customer commitment',
      nextActionOwner: 'Howell manager', newRequestBlocked: false,
    }
    payload.transfers = payload.transfers.filter(transfer => transfer.vin !== bronco.vin)
    await route.fulfill({ response, json: payload })
  })
  // A populated launcher is wider than the empty launcher. Keep its shared
  // browser-suite state deterministic without writing the saved-list ledger.
  await page.route('**/api/saved-lists', async route => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ json: { lists: [{
      id: 'synthetic-pager-list', label: 'Synthetic pager choices', revision: 1,
      createdAt: '2026-08-30T12:00:00Z', updatedAt: '2026-08-30T12:00:00Z',
      items: ['TESTDATAHWELL0001', 'TESTDATAHWELL0002', 'TESTDATAFWELL0001', 'TESTDATADETRT0001'].map(vin => ({
        vin, addedAt: '2026-08-30T12:00:00Z', available: true,
      })),
    }] } })
  })
  await page.goto('/inventory')
  await chooseInventoryView(page, 'no-hold')
  const pages = page.getByRole('navigation', { name: 'Inventory pages' })
  await expect(pages).toContainText('Showing 1–1 of 1')
  const launcher = page.getByRole('button', { name: /^Saved vehicles:/ })
  await expect(launcher).toHaveAccessibleName('Saved vehicles: Synthetic pager choices (4) — Saved lists')
  const launcherBounds = await launcher.boundingBox()
  expect(launcherBounds).not.toBeNull()
  for (const control of [
    pages.getByRole('button', { name: 'Previous inventory page' }),
    pages.getByRole('button', { name: 'Next inventory page' }),
    pages.getByRole('combobox', { name: 'Rows per page' }),
  ]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    const separateRows = bounds!.y + bounds!.height <= launcherBounds!.y || launcherBounds!.y + launcherBounds!.height <= bounds!.y
    const separateColumns = bounds!.x + bounds!.width <= launcherBounds!.x || launcherBounds!.x + launcherBounds!.width <= bounds!.x
    expect(separateRows || separateColumns).toBe(true)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
})

test('records, compares and releases a hold, then records Other with details', async ({ page }, info) => {
  const vin = info.project.name === 'mobile' ? 'TESTDATAHWELL0002' : 'TESTDATAHWELL0001'
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto(`/inventory?scope=group&vin=${vin}&tab=hold`)
  const workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await expect(workspace).toBeVisible()
  const place = workspace.getByRole('button', { name:'Place hold', exact:true })
  await place.click()
  const hold = page.getByRole('dialog', { name:'Hold', exact:true })
  await expect(hold).toBeVisible()
  await hold.getByRole('textbox', { name:'Customer initials or nickname' }).fill('AB')
  await hold.getByLabel('Expected delivery (optional)').fill('2026-08-31')
  await hold.getByRole('textbox', { name:'Notes and details' }).fill('Synthetic appointment reservation')
  await hold.getByRole('button', { name:'Place hold', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByRole('button', { name:'Manage hold', exact:true })).toBeVisible()
  await workspace.getByRole('button', { name:'Manage hold', exact:true }).click()
  await expect(hold.getByRole('textbox', { name:'Customer initials or nickname' })).toHaveValue('AB')
  await hold.getByRole('radio', { name:'Release hold' }).check()
  await hold.getByRole('textbox', { name:'Release reason' }).fill('Synthetic appointment ended')
  await hold.getByRole('button', { name:'Release hold', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByText('Hold released', {exact:true})).toBeVisible()
  await workspace.getByRole('button', { name:/^(Record|Change) disposition$/ }).click()
  const disposition = page.getByRole('dialog', { name:/Disposition ·/ })
  await disposition.getByRole('radio', { name:'Other', exact:true }).check()
  await disposition.getByRole('textbox', { name:/Note/ }).fill('Reserved for showroom display')
  await disposition.getByRole('button', { name:'Save disposition', exact:true }).click()
  await expect(disposition).toHaveCount(0)
  await expect(workspace.getByRole('region', { name:'Hold and disposition controls' })).toContainText('Inventory Flow: Hold released · Other')
  await workspace.getByRole('button', { name:'Change disposition', exact:true }).click()
  const savedDisposition = page.getByRole('dialog', { name:/Disposition ·/ })
  await expect(savedDisposition).toContainText('Other')
  await expect(savedDisposition.getByText('Reserved for showroom display', { exact:true })).toBeVisible()
  await savedDisposition.getByRole('button', { name:'Close disposition', exact:true }).click()
  await expect(savedDisposition).toHaveCount(0)
  await workspace.getByRole('button', { name:'Close vehicle details' }).click()
  const row = page.getByRole('article').filter({ has:page.getByRole('button', { name:/Review inventory decision/ }) }).first()
  const decision = row.getByRole('button', { name:/Review inventory decision/ })
  if (info.project.name === 'mobile') {
    await expect(decision).toBeVisible()
    const decisionBounds = await decision.boundingBox()
    const holdBounds = await row.getByRole('button', { name:/Open (DealerMail hold tools|hold details)/ }).boundingBox()
    expect(decisionBounds).not.toBeNull()
    expect(holdBounds).not.toBeNull()
    expect(decisionBounds!.y).toBeGreaterThanOrEqual(holdBounds!.y + holdBounds!.height)
    expect(decisionBounds!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('sales hold requests stay pending until the home-store manager approves, then can be released', async ({ page }, info) => {
  const vin = info.project.name === 'mobile' ? 'TESTDATAHWELL0002' : 'TESTDATAHWELL0001'
  await page.addInitScript(() => {
    if (!localStorage.getItem('maxey-role')) localStorage.setItem('maxey-role', 'sales')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto(`/inventory?scope=group&vin=${vin}&tab=hold`)
  let workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await expect(workspace).toBeVisible()
  await workspace.getByRole('button', { name:'Request hold', exact:true }).click()
  let hold = page.getByRole('dialog', { name:'Hold', exact:true })
  await expect(hold).toBeVisible()
  await hold.getByRole('textbox', { name:'Customer initials or nickname' }).fill('QA')
  await hold.getByLabel('Expected delivery (optional)').fill('2026-10-16')
  await hold.getByRole('textbox', { name:'Notes and details' }).fill('Synthetic approval workflow reservation')
  await hold.getByRole('button', { name:'Submit hold request', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByRole('region', { name:'Hold and disposition controls' })).toContainText('Pending approval')
  await workspace.getByRole('button', { name:'Manage hold request', exact:true }).click()
  hold = page.getByRole('dialog', { name:'Hold', exact:true })
  await expect(hold.getByText('This request is awaiting manager approval. It is not a confirmed Inventory Flow hold.')).toBeVisible()
  await expect(hold.locator('.manual-hold-comparison')).toContainText('Pending approval')
  await expect(hold.locator('.manual-hold-comparison')).not.toContainText('Held')
  await hold.getByRole('button', { name:'Close hold' }).click()

  await page.evaluate(() => localStorage.setItem('maxey-role', 'manager'))
  await page.goto('/attention')
  await expect(page.getByRole('heading', { level:1, name:'Action center', exact:true })).toBeVisible()
  // Other browser specs can leave another vehicle awaiting approval in the
  // shared synthetic ledger. Review this request by its accessible VIN control.
  const requestedVehicle = page.getByRole('listitem').filter({ has: page.getByRole('button', { name:`Copy VIN: ${vin}`, exact:true }) })
  const reviewRequest = requestedVehicle.getByRole('link', { name:'Review hold request', exact:true })
  await expect(reviewRequest).toHaveAttribute('href', `/inventory?scope=group&vin=${vin}&tab=hold&returnTo=%2Fattention`)
  await reviewRequest.scrollIntoViewIfNeeded()
  const reviewBounds = await reviewRequest.boundingBox()
  expect(reviewBounds).not.toBeNull()
  expect(reviewBounds!.height).toBeGreaterThanOrEqual(44)
  expect(reviewBounds!.width).toBeGreaterThanOrEqual(44)
  expect(await reviewRequest.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('pending-hold-manager-review.png') })
  await reviewRequest.click()
  workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await expect(workspace).toBeVisible()
  await expect(workspace.getByRole('tab', { name:'Holds & moves', exact:true })).toHaveAttribute('aria-selected', 'true')
  await expect(workspace.getByRole('button', { name:'Back to Action center', exact:true })).toBeVisible()
  await workspace.getByRole('button', { name:'Review hold request', exact:true }).click()
  hold = page.getByRole('dialog', { name:'Hold', exact:true })
  await hold.getByRole('radio', { name:'Approve hold', exact:true }).check()
  await hold.getByRole('button', { name:'Approve hold', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByRole('region', { name:'Hold and disposition controls' })).toContainText('Held')

  await page.evaluate(() => localStorage.setItem('maxey-role', 'sales'))
  await page.goto(`/inventory?scope=group&vin=${vin}&tab=hold`)
  workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await expect(workspace).toBeVisible()
  await expect(workspace.getByRole('region', { name:'Hold and disposition controls' })).toContainText('Held')
  await workspace.getByRole('button', { name:'Manage hold', exact:true }).click()
  hold = page.getByRole('dialog', { name:'Hold', exact:true })
  await hold.getByRole('radio', { name:'Release hold', exact:true }).check()
  await hold.getByRole('textbox', { name:'Release reason' }).fill('Synthetic approval workflow completed')
  await hold.getByRole('button', { name:'Release hold', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByRole('region', { name:'Hold and disposition controls' })).toContainText('Hold released')
})
