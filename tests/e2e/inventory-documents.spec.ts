import { chooseInventoryView } from './inventory-controls'
import { expect, test } from '@playwright/test'

// The synthetic demo vehicle that carries factory-equipment and AutoCheck
// facts (fixtures/synthetic-release.mjs). Playwright boots `pnpm dev:demo`,
// so this spec never depends on — or commits — a real dealership VIN.
const VIN = 'TESTDATAHWELL0001'
const NAME = '2024 Ford F-150 Lariat'

test('browser history restores the app after leaving nested take-home and vehicle dialogs', async ({ page }, testInfo) => {
  await page.goto('/overview')
  await page.getByRole('link', { name:'Inventory', exact:true }).filter({ visible:true }).click()
  await expect(page.getByRole('combobox', { name:'Search inventory' })).toBeVisible()
  await chooseInventoryView(page, 'all')
  await page.getByRole('combobox', { name:'Search inventory' }).fill(VIN)
  if (testInfo.project.name === 'mobile') {
    await page.locator('.if-srp-mobile-list .inventory-mobile-row__open', { hasText:NAME }).click()
  } else {
    await page.getByRole('row', { name:new RegExp(VIN) }).getByRole('button', { name:new RegExp(`Open vehicle details for ${NAME}`, 'i') }).click()
  }
  const workspace = page.getByRole('dialog', { name:`${NAME} vehicle workspace` })
  await workspace.getByRole('button', { name:'Take-home page' }).click()
  await expect(page.getByRole('dialog', { name:/Take-home page/ })).toBeVisible()
  await page.evaluate(() => history.go(-2))
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('#root')).not.toHaveAttribute('inert')
  await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true')
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  await page.getByRole('link', { name:'Inventory', exact:true }).filter({ visible:true }).click()
  await expect(page.getByRole('combobox', { name:'Search inventory' })).toBeVisible()
})

test('inventory search opens the VIN-specific premium document workspace', async ({ page }, testInfo) => {
  await page.goto('/inventory')

  // Dev-mode route compilation can exceed Playwright's 5s assertion default
  // when desktop and mobile projects start together. Wait for the real page
  // heading, not an arbitrary timer or the transient loading surface.
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })
  // The rich document fixture is deliberately held. Select All before checking
  // result controls, which are absent when the default No hold view is empty.
  await chooseInventoryView(page, 'all')
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
  const overviewDocuments = dialog.getByRole('region', { name: 'Documents and vehicle records', exact: true })
  const sharedDetails = overviewDocuments.getByRole('button', { name: /^(Show|Hide) details$/ })
  await sharedDetails.focus()
  await page.keyboard.press('Enter')
  await expect(sharedDetails).toHaveAttribute('aria-expanded', 'true')
  await expect(sharedDetails).toHaveAccessibleName('Hide details')
  await expect(sharedDetails).toBeFocused()
  for (const name of ['Sticker & equipment', 'AutoCheck', 'Ford OASIS']) {
    const source = overviewDocuments.getByRole('region', { name, exact: true })
    await expect(source.locator('.vehicle-resource-summary__disclosure')).toBeVisible()
  }
  expect((await sharedDetails.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.keyboard.press('Space')
  await expect(sharedDetails).toHaveAttribute('aria-expanded', 'false')
  await expect(sharedDetails).toBeFocused()
  await expect(overviewDocuments.locator('.vehicle-resource-summary__disclosure:visible')).toHaveCount(0)
  await overviewDocuments.getByRole('button', { name: 'Full records', exact: true }).click()
  await expect(dialog.getByRole('tab', { name: 'Records', exact: true })).toHaveAttribute('aria-selected', 'true')
  const documents = dialog.getByRole('region', { name: 'Vehicle documents' })
  // Synthetic AutoCheck score and range, followed by concise equipment
  // highlights with the complete record still one click away.
  await expect(documents.getByLabel('AutoCheck summary').locator('dd').first()).toContainText('91')
  await expect(documents.getByText('Typical 86–93', { exact: true })).toBeVisible()
  await expect(documents.getByText('More history checks', { exact: false })).toBeVisible()
  await documents.getByRole('navigation', { name: 'Record sections' }).getByRole('button', { name: 'Equipment', exact: true }).click()
  const profile = documents.locator('[data-document-kind="vauto-factory-equipment"]')
  await expect(profile.getByText(/Informational equipment label—not an original window sticker\./)).toHaveCount(0)
  // The demo record carries equipment facts and a disclaimer, so the source
  // disclosure renders — collapsed, with nothing of it on screen but its summary.
  await expect(profile.locator('.vdp-record-source-details')).toHaveCount(1)
  await expect(profile.locator('.vdp-record-source-details > div')).toBeHidden()
  const packages = documents.locator('section.vdp-record-section[aria-label="Packages & priced equipment"]')
  await expect(packages).toBeVisible()
  await expect(packages.getByText('Max Trailer Tow Package (DEMO-1)', { exact: true })).toBeVisible()
  await expect(packages).not.toContainText('$3,005')
  await documents.getByRole('navigation', { name: 'Record sections' }).getByRole('button', { name: 'Window sticker', exact: true }).click()
  const sticker = documents.getByRole('region', { name: 'Window sticker', exact: true })
  const stickerPricing = sticker.getByLabel('Window sticker pricing')
  await expect(stickerPricing).toContainText('Original MSRP')
  await expect(stickerPricing).toContainText('$68,420')
  await expect(stickerPricing.getByText('Base MSRP', { exact: true })).toHaveCount(0)
  await expect(profile.getByLabel('Base MSRP')).toContainText('63,420')
  await expect(sticker.getByText('Total options', { exact: true })).toHaveCount(0)
  await expect(sticker.getByText('Destination', { exact: true })).toHaveCount(0)
  await expect(sticker).not.toContainText('Fabricated USD pricing for demonstration only')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
