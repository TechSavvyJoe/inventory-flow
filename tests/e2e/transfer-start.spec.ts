import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('maxey-role')) localStorage.setItem('maxey-role', 'group_manager')
    if (!localStorage.getItem('maxey-home-store')) localStorage.setItem('maxey-home-store', 'Howell')
  })
})

test('start-a-move picker and direct form stay usable without horizontal overflow', async ({ page }) => {
  await page.goto('/transfers/new')

  await expect(page.getByRole('heading', { name: 'Start a move' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search inventory to move' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move vehicle' }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

  await page.getByRole('button', { name: 'Move vehicle' }).first().click()
  await expect(page.getByRole('heading', { name: 'Move vehicle' })).toBeVisible()
  await expect(page.getByLabel('Destination store')).toBeVisible()
  await expect(page.getByLabel('Moved at')).toBeVisible()
  await expect(page.getByLabel('Why is it moving?')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('role and store previews preserve the working location and expose only the authorized move path', async ({ page }, testInfo) => {
  const openAccountControls = async () => {
    const account = page.getByRole('button', { name: 'Open account and app controls' })
    if (await account.isVisible()) await account.click()
    else await page.getByRole('button', { name: 'More app controls' }).click()
    await expect(page.getByLabel('Preview role')).toBeVisible()
  }
  const setRole = async (label: string) => {
    await openAccountControls()
    await page.getByLabel('Preview role').selectOption({ label })
    await expect(page.getByLabel('Working location')).toHaveValue('Ford Detroit')
    await page.keyboard.press('Escape')
  }
  const search = async (stock: string) => {
    await page.goto('/transfers/new')
    await page.getByRole('textbox', { name: 'Search inventory to move' }).fill(stock)
    return page.locator('.move-picker-row').filter({ hasText: stock })
  }

  await page.goto('/transfers/new')
  await page.getByLabel('Working location').selectOption('Ford Detroit')
  await expect(page.getByLabel('Working location')).toHaveValue('Ford Detroit')
  await page.reload()
  await expect(page.getByLabel('Working location')).toHaveValue('Ford Detroit')

  await openAccountControls()
  const roleOptions = await page.getByLabel('Preview role').locator('option').allTextContents()
  expect(roleOptions).toEqual(['Salesperson', 'Store manager', 'Group manager'])
  expect(roleOptions.join(' ')).not.toMatch(/Transport coordinator|Driver|Porter/)
  await page.keyboard.press('Escape')

  await setRole('Salesperson')
  let row = await search('DEMO-F02')
  await expect(row.getByRole('button', { name: 'Request to Ford Detroit' })).toBeVisible()
  await expect((await search('DEMO-D01')).getByRole('button')).toHaveCount(0)

  await setRole('Store manager')
  row = await search('DEMO-D01')
  await expect(row.getByRole('button', { name: 'Move vehicle' })).toBeVisible()
  row = await search('DEMO-F02')
  await expect(row.getByRole('button', { name: 'Request to Ford Detroit' })).toBeVisible()

  await setRole('Group manager')
  row = await search('DEMO-L01')
  await expect(row.getByRole('button', { name: 'Move vehicle' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  testInfo.annotations.push({ type: 'role-matrix', description: 'Sales away=request; manager own=direct/away=request; group manager any=direct.' })
})

test('a group manager can record a completed direct store move without pickup or arrival steps', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile'
  const stock = mobile ? 'DEMO-F01' : 'DEMO-H02'
  const destination = mobile ? 'Lincoln' : 'Ford Detroit'

  await page.goto('/transfers/new')
  await page.getByRole('textbox', { name: 'Search inventory to move' }).fill(stock)
  const vehicle = page.locator('.move-picker-row').filter({ hasText: stock })
  await expect(vehicle).toHaveCount(1)
  await vehicle.getByRole('button', { name: 'Move vehicle' }).click()

  await page.getByLabel('Destination store').selectOption(destination)
  // The synthetic demo has a deliberately fixed clock, so submit a matching
  // local timestamp instead of the browser's real current time.
  await page.getByLabel('Moved at').fill('2026-08-30T10:00:01')
  await page.getByLabel('Why is it moving?').fill('Synthetic customer showing for direct-move browser verification')
  await page.getByRole('button', { name: `Move to ${destination}` }).click()

  await expect(page.getByRole('heading', { name: 'Vehicle move recorded' })).toBeVisible()
  await expect(page.getByText(new RegExp(`tracked .* to ${destination}`))).toBeVisible()
  await expect(page.getByRole('button', { name: 'View this move' })).toBeVisible()
  await expect(page.getByRole('button', { name: /collected|arrived/i })).toHaveCount(0)
})

test('an authorized active direct move keeps Track and adds Move again', async ({ page }, testInfo) => {
  const stock = testInfo.project.name === 'mobile' ? 'DEMO-F01' : 'DEMO-H02'
  const currentDestination = testInfo.project.name === 'mobile' ? 'Lincoln' : 'Ford Detroit'

  await page.goto('/transfers/new')
  await page.getByRole('textbox', { name: 'Search inventory to move' }).fill(stock)
  const vehicle = page.locator('.move-picker-row').filter({ hasText: stock })
  await expect(vehicle.getByRole('button', { name: 'Track move' })).toBeVisible()
  await expect(vehicle.getByRole('button', { name: 'Move again' })).toBeVisible()
  await vehicle.getByRole('button', { name: 'Move again' }).click()
  await expect(page.getByRole('heading', { name: 'Move vehicle' })).toBeVisible()
  await expect(page.getByLabel('Destination store').locator(`option[value="${currentDestination}"]`)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /collected|arrived/i })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
