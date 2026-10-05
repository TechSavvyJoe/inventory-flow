import { expect, test, type Page } from '@playwright/test'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// Inventory -> save -> open the floating list -> keep the page in place.
async function saveVehicles(page: Page) {
  await page.goto('/inventory?scope=group')
  await page.getByRole('button', { name: /^All:/ }).click()
  for (const stock of ['DEMO-H02', 'DEMO-H01', 'DEMO-F02', 'DEMO-L02']) {
    const save = page.getByRole('button', { name: `Save ${stock} to shortlist`, exact: true })
    if (await save.count()) await save.click()
    await expect(page.getByRole('button', { name: `Remove ${stock} from shortlist`, exact: true })).toBeVisible()
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function pageFrame(page: Page) {
  return page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    scrollY: window.scrollY,
  }))
}

for (const [width, height] of [[390, 844], [1024, 768], [1320, 820], [1440, 900]]) {
  test(`saved vehicles stay outside page flow at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await saveVehicles(page)
    await expect(page).toHaveTitle(/Inventory Flow/)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    // A transformed/clipped app container must not capture the fixed launcher.
    await page.evaluate(() => { document.getElementById('root')!.style.transform = 'translateZ(0)' })
    const launcher = page.getByRole('button', { name: /^Saved vehicles:/ })
    const closedFrame = await pageFrame(page)
    const closedBounds = await launcher.boundingBox()
    expect(closedBounds!.y).toBeGreaterThan(0)
    expect(closedBounds!.y + closedBounds!.height).toBeLessThanOrEqual(height)
    await launcher.click()
    const panel = page.getByRole('region', { name: /^Saved vehicles \d+$/ })
    await expect(panel).toBeVisible()
    await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    expect(await pageFrame(page)).toEqual(closedFrame)
    expect(await launcher.boundingBox()).toEqual(closedBounds)
    const bounds = await panel.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(closedBounds!.y)
    await expect(panel.getByRole('textbox', { name: 'Customer list name' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Clear list' })).toHaveCount(0)
    const sheet = panel.getByRole('button', { name: /^Customer sheet/ })
    await expect(sheet).toBeInViewport()
    // The rows scroll inside the pop-up; the document action stays reachable.
    await panel.getByRole('region', { name: 'Customer saved lists' }).evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(sheet).toBeInViewport()
    expect(await pageFrame(page)).toEqual(closedFrame)
    await panel.getByRole('region', { name: 'Customer saved lists' }).evaluate(element => { element.scrollTop = 0 })
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(launcher).toBeFocused()
    expect(await pageFrame(page)).toEqual(closedFrame)
    await launcher.click()
    await launcher.click()
    await expect(panel).toHaveCount(0)
    expect(errors).toEqual([])
    expect(closedFrame.width).toBeLessThanOrEqual(width)
    // Capture the normal app shell after testing the transformed-container case.
    await page.evaluate(() => { document.getElementById('root')!.style.removeProperty('transform'); window.scrollTo(0, 0) })
    await launcher.click()
    await panel.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    const screenshot = testInfo.outputPath(`saved-vehicles-${width}.png`)
    await page.screenshot({ path: screenshot })
    await testInfo.attach(`saved vehicles ${width}x${height}`, { path: screenshot, contentType: 'image/png' })
  })
}

test('saved vehicles preserve the pop-up when opening and closing a vehicle workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await saveVehicles(page)
  const launcher = page.getByRole('button', { name: /^Saved vehicles:/ })
  await launcher.click()
  const panel = page.getByRole('region', { name: /^Saved vehicles \d+$/ })
  const opener = panel.getByRole('button', { name: /^Open shortlisted 2024 Ford F-150 Lariat,/ })
  await opener.click()
  const workspace = page.getByRole('dialog', { name: '2024 Ford F-150 Lariat vehicle workspace' })
  await expect(workspace).toBeVisible()
  await expect(launcher).toBeHidden()
  await expect(panel).toBeHidden()
  await workspace.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(panel).toBeVisible()
  await expect(opener).toBeFocused()
  const sheetButton = panel.getByRole('button', { name: /^Customer sheet/ })
  await sheetButton.click()
  const sheet = page.getByRole('dialog', { name: /Take-home page/ })
  await expect(sheet).toBeVisible()
  await expect(panel).toBeHidden()
  await expect(launcher).toBeHidden()
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(sheetButton).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(launcher).toBeFocused()
})
