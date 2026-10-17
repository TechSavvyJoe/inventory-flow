import { chooseInventoryView } from './inventory-controls'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Synthetic fixture only. Compact rows must improve scanning without losing
// copy fields, direct actions, warning cues, or keyboard access to full evidence.
const name = '2022 Ford Maverick Lariat'
const secondName = '2022 Lincoln Corsair Grand Touring'

async function openInventory(page: Page) {
  await page.goto('/inventory?scope=group')
  await expect(page.getByRole('heading', { name: 'All locations inventory' })).toBeVisible()
  await chooseInventoryView(page, 'all')
  // Other workflow specs create synthetic moves in the shared demo service.
  // Use the real sort UI so density is measured in a stable vehicle order,
  // rather than mistaking a later row for the third vehicle after a move.
  await page.getByRole('button', { name: /^Sort inventory\./ }).click()
  await page.getByRole('button', { name: 'Remove Last movement sort', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Sort priority 1 field', exact: true })).toHaveValue('vehicle')
  await page.getByRole('button', { name: 'Close sort options', exact: true }).click()
}

async function settle(panel: Locator) {
  await panel.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)))
  })
}

for (const [width, height] of [[390, 844], [1024, 768], [1320, 820], [1440, 900]]) {
  test(`inventory details expand independently and preserve the global preference at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    await openInventory(page)
    const expand = page.getByRole('button', { name: `Expand details for ${name}`, exact: true })
    const second = page.getByRole('button', { name: `Expand details for ${secondName}`, exact: true })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expect(second).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Copy VIN: TESTDATAFWELL0002', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy window sticker base MSRP: 29260', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Open vehicle records for ${name}`, exact: true })).toBeVisible()
    for (const copyName of ['Copy stock number: DEMO-F02', 'Copy window sticker base MSRP: 29260', 'Copy mileage: 33640']) {
      const value = page.getByRole('button', { name: copyName, exact: true }).locator('..').locator('.copyable-value__content')
      const lines = await value.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.y))
      })
      expect(new Set(lines).size, `${copyName} stays on one readable line at ${width}px`).toBe(1)
    }
    if (width === 1440) {
      const third = page.getByRole('rowgroup').filter({ has: page.getByRole('button', { name: 'Open vehicle records for 2023 Chevrolet Silverado 1500 RST', exact: true }) })
      const thirdBounds = (await third.boundingBox())!
      expect(thirdBounds.y + thirdBounds.height, 'Three complete compact vehicles fit in the desktop viewport').toBeLessThanOrEqual(height)
    }
    const panelId = await expand.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = page.locator(`[id="${panelId}"]`)
    await expect(panel).toHaveAttribute('aria-hidden', 'true')
    await expect(panel).toHaveAttribute('inert', '')
    const compactHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    const box = (await expand.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)

    await expand.focus()
    await page.keyboard.press('Enter')
    const collapse = page.getByRole('button', { name: `Collapse details for ${name}`, exact: true })
    await expect(collapse).toBeFocused()
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect(second).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).not.toHaveAttribute('inert')
    await settle(panel)
    await expect(page.getByRole('region', { name: `Additional details for ${name}`, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(compactHeight + 40)
    await page.getByRole('button', { name: 'Expand all vehicle details', exact: true }).click()
    await expect(page.getByRole('button', { name: `Collapse details for ${secondName}`, exact: true })).toHaveAttribute('aria-expanded', 'true')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Collapse all vehicle details', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Collapse details for ${name}`, exact: true })).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('button', { name: 'Collapse all vehicle details', exact: true }).click()
    await expect(page.getByRole('button', { name: `Expand details for ${name}`, exact: true })).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand all vehicle details', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Expand details for ${name}`, exact: true })).toHaveAttribute('aria-expanded', 'false')
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
    // CSS scale prevents a 3x mobile-emulation bitmap being presented as a
    // zoomed-in viewport. Geometry assertions above still use CSS pixels.
    await page.screenshot({ path: testInfo.outputPath(`inventory-compact-${width}.png`), scale: 'css' })
  })
}

for (const [width, height] of [[390, 844], [1024, 768], [1320, 820], [1440, 900]]) {
  test(`inventory filters keep results close and actions usable at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    await openInventory(page)
    const toggle = page.getByRole('button', { name: 'Filters', exact: true })
    await toggle.click()
    const panel = page.getByRole('region', { name: 'Inventory filters', exact: true })
    await expect(panel).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    if (width >= 1024) {
      expect((await panel.boundingBox())!.height, 'Refine panel leaves room for vehicle results').toBeLessThan(340)
    }
    for (const field of ['Minimum price', 'Maximum price', 'Maximum mileage']) {
      const input = panel.getByRole('spinbutton', { name: field, exact: true })
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await panel.getByRole('spinbutton', { name: 'Maximum price', exact: true }).fill('30000')
    const show = panel.getByRole('button', { name: 'Show 1 vehicle', exact: true })
    await expect(show).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`inventory-filters-${width}.png`), scale: 'css' })
    await show.click()
    await expect(panel).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Filters 1', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: `Open vehicle records for ${name}`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Open vehicle records for ${secondName}`, exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear maximum price filter: $30,000', exact: true }).click()
    await expect(page.getByRole('button', { name: `Open vehicle records for ${secondName}`, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  })
}

test('reduced motion and Records navigation keep disclosure state predictable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openInventory(page)
  const expand = page.getByRole('button', { name: `Expand details for ${name}`, exact: true })
  const panelId = await expand.getAttribute('aria-controls')
  const panel = page.locator(`[id="${panelId}"]`)
  await expand.click()
  expect(await panel.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('none')
  const collapse = page.getByRole('button', { name: `Collapse details for ${name}`, exact: true })
  await page.getByRole('button', { name: `Open vehicle records for ${name}`, exact: true }).click()
  const workspace = page.getByRole('dialog', { name: `${name} records` })
  await expect(workspace.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(workspace).toHaveCount(0)
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await collapse.focus()
  await page.keyboard.press('Space')
  await expect(expand).toBeFocused()
  await expect(panel).toHaveAttribute('aria-hidden', 'true')
  await expect(panel).toHaveAttribute('inert', '')
})
