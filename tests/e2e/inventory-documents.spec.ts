import { expect, test } from '@playwright/test'

const VIN = '1FMUK8DHXTGB76992'

test('inventory search opens the VIN-specific premium document workspace', async ({ page }, testInfo) => {
  await page.goto('/inventory')

  // Dev-mode route compilation can exceed Playwright's 5s assertion default
  // when desktop and mobile projects start together. Wait for the real page
  // heading, not an arbitrary timer or the transient loading surface.
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Rows per page').locator('option')).toHaveText([
    '10',
    '15',
    '20',
    '25',
    '50',
    '100',
  ])

  await page.getByRole('combobox', { name: 'Search inventory' }).fill(VIN)
  await expect(page.getByText('2026 Ford Explorer Active', { exact: true }).first()).toBeVisible()

  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: /Open details for 2026 Ford Explorer Active.*AutoCheck report available.*Window sticker available/i }).click()
  } else {
    const row = page.getByRole('row', { name: new RegExp(VIN) })
    await expect(row.getByRole('link', { name: /Open AutoCheck report/i })).toHaveAttribute(
      'href',
      /bobmaxeyfordhowell\.com\/autocheck\.aspx\?/,
    )
    await expect(row.getByRole('link', { name: /Open window sticker/i })).toHaveAttribute(
      'href',
      /bobmaxeyfordhowell\.com\/api\/vhcliaa\/inventory\/21521\/window-sticker\?/,
    )
    await row.getByRole('button', { name: /Open vehicle details for 2026 Ford Explorer Active/i }).click()
  }

  const dialog = page.getByRole('dialog', { name: '2026 Ford Explorer Active vehicle workspace' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Full records/i }).click()
  const documents = dialog.getByRole('region', { name: 'Vehicle documents' })
  await expect(documents.getByRole('link', { name: /Open AutoCheck report/i })).toBeVisible()
  await expect(documents.getByRole('link', { name: /Open window sticker/i })).toBeVisible()
  await expect(documents.getByText('92', { exact: true })).toBeVisible()
  await expect(documents.getByText('89–94', { exact: true })).toBeVisible()
  await expect(documents.getByText('200A', { exact: true })).toBeVisible()
  await expect(documents.getByText('$49,480', { exact: true })).toBeVisible()
  await expect(documents.getByText('History checks', { exact: true })).toBeVisible()
  await expect(documents.getByText('Factory options', { exact: true })).toBeVisible()
  await expect(documents.getByText('Full factory equipment & warranty', { exact: true })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
