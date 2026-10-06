import { expect, test } from '@playwright/test'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// The real Node HTTP routes persist app-owned controls, never source writes.
for (const [width, height] of [[1024, 768], [1320, 820], [1440, 900]]) {
  test(`vehicle header identifiers keep copy targets separate at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/inventory?vin=TESTDATAHWELL0001')
    const workspace = page.getByRole('dialog', { name: '2024 Ford F-150 Lariat vehicle workspace' })
    await expect(workspace).toBeVisible()
    const header = workspace.locator('.vdp-focus-header')
    for (const [label, value] of [['stock number', 'DEMO-H01'], ['VIN', 'TESTDATAHWELL0001']]) {
      const copy = header.getByRole('button', { name: `Copy ${label}: ${value}`, exact: true })
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}

test('phone pagination and row size remain clear of the saved-vehicle launcher', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inventory')
  await page.getByRole('button', { name: /^No hold:/ }).click()
  const pages = page.getByRole('navigation', { name: 'Inventory pages' })
  await expect(pages).toContainText('Showing 1–1 of 1')
  const launcher = page.getByRole('button', { name: /^Saved vehicles:/ })
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

test('records, compares and releases a manual hold, then records Other with details', async ({ page }, info) => {
  const vin = info.project.name === 'mobile' ? 'TESTDATAHWELL0002' : 'TESTDATAHWELL0001'
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.goto(`/inventory?scope=group&vin=${vin}&tab=hold`)
  const workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await expect(workspace).toBeVisible()
  const place = workspace.getByRole('button', { name:'Place manual hold', exact:true })
  await place.click()
  const hold = page.getByRole('dialog', { name:'Manual hold', exact:true })
  await expect(hold).toBeVisible()
  await hold.getByRole('textbox', { name:'Customer initials or nickname' }).fill('AB')
  await hold.getByLabel('Expected delivery (optional)').fill('2026-08-31')
  await hold.getByRole('textbox', { name:'Notes and details' }).fill('Synthetic appointment reservation')
  await hold.getByRole('button', { name:'Place manual hold', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByRole('button', { name:'Manage manual hold', exact:true })).toBeVisible()
  await workspace.getByRole('button', { name:'Manage manual hold', exact:true }).click()
  await expect(hold.getByRole('textbox', { name:'Customer initials or nickname' })).toHaveValue('AB')
  await hold.getByRole('radio', { name:'Release hold' }).check()
  await hold.getByRole('textbox', { name:'Release reason' }).fill('Synthetic appointment ended')
  await hold.getByRole('button', { name:'Release manual hold', exact:true }).click()
  await expect(hold).toHaveCount(0)
  await expect(workspace.getByText('Manual hold released', {exact:true})).toBeVisible()
  await workspace.getByRole('button', { name:/^(Record|Change) disposition$/ }).click()
  const disposition = page.getByRole('dialog', { name:/Disposition ·/ })
  await disposition.getByRole('radio', { name:'Other', exact:true }).check()
  await disposition.getByRole('textbox', { name:/Note/ }).fill('Reserved for showroom display')
  await disposition.getByRole('button', { name:'Save disposition', exact:true }).click()
  await expect(disposition).toHaveCount(0)
  await expect(workspace.getByRole('region', { name:'Manual inventory controls' })).toContainText('Other · Inventory Flow')
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
