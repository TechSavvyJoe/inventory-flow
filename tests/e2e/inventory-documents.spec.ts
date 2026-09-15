import { expect, test } from '@playwright/test'

// The synthetic demo vehicle that carries factory-equipment and AutoCheck
// facts (fixtures/synthetic-release.mjs). Playwright boots `pnpm dev:demo`,
// so this spec never depends on — or commits — a real dealership VIN.
const VIN = 'TESTDATAHWELL0001'
const NAME = '2024 Ford F-150 Lariat'

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

  if (testInfo.project.name === 'mobile') {
    const mobileDetail = page.locator('.if-srp-mobile-list .inventory-mobile-row__open', { hasText: NAME })
    await expect(mobileDetail).toBeVisible()
    await mobileDetail.click()
  } else {
    const row = page.getByRole('row', { name: new RegExp(VIN) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: new RegExp(`Open vehicle details for ${NAME}`, 'i') }).click()
  }

  const dialog = page.getByRole('dialog', { name: `${NAME} vehicle workspace` })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Records', exact: true }).click()
  const documents = dialog.getByRole('region', { name: 'Vehicle documents' })
  // Synthetic AutoCheck score and range, then the informational factory
  // equipment profile with its reference MSRP and priced package.
  await expect(documents.getByText('91', { exact: true })).toBeVisible()
  await expect(documents.getByText('86–93', { exact: true })).toBeVisible()
  await expect(documents.getByText('History checks')).toBeVisible()
  await expect(documents.getByText('Informational equipment label—not an original window sticker.', { exact: true })).toBeVisible()
  await expect(documents.getByText('68,420 · currency not captured', { exact: true })).toBeVisible()
  const packages = documents.locator('section.vdp-record-section[aria-label="Packages & priced equipment"]')
  await expect(packages).toBeVisible()
  await expect(packages.getByText('Synthetic Premium Technology Package')).toBeVisible()
  await expect(packages.getByText('3,005 · currency not captured', { exact: true })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
