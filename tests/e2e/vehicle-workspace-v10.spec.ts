import { expect, test, type Locator, type Page } from '@playwright/test'

async function openWorkspace(page: Page, projectName: string) {
  if (projectName === 'mobile') await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', {
    name: projectName === 'mobile' ? /Open details for/i : /Open vehicle details for/i,
  }).first().click()
  const dialog = page.getByRole('dialog', { name: /vehicle workspace/i })
  await expect(dialog).toBeVisible()
  return dialog
}

async function hasHorizontalOverflow(locator: Locator) {
  return locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
}

test('uses one readable identity, action row and four-section navigation on every screen size', async ({ page }, testInfo) => {
  const dialog = await openWorkspace(page, testInfo.project.name)
  await expect(dialog).toHaveClass(/inventory-workspace--flow/)
  await expect(dialog).toHaveAttribute('data-active-section', 'overview')
  const header = dialog.locator('.vdp-flow-header')
  const identity = header.locator('.vdp-flow-identity')
  const toolbar = dialog.getByRole('toolbar', { name: 'Vehicle actions' })
  const tabs = dialog.getByRole('tablist', { name: 'Vehicle workspace sections' })
  const panel = dialog.getByRole('tabpanel', { name: 'Overview' })
  const operations = panel.getByRole('region', { name: 'Vehicle operational summary' })
  await expect(header.getByRole('heading')).toHaveCount(1)
  await expect(dialog.getByRole('toolbar')).toHaveCount(1)
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Equipment', 'Holds & moves', 'Records'])
  await expect(dialog.getByRole('tabpanel')).toHaveCount(1)
  await expect(operations.getByRole('button', { name: /Hold status/i })).toBeVisible()
  await expect(operations.getByRole('button', { name: /Current location/i })).toBeVisible()
  await expect(operations.getByRole('button', { name: /^Movement/i })).toBeVisible()

  const identifiers = identity.locator('.copyable-value__content')
  await expect(identifiers).toHaveCount(2)
  const originalIdentity = await identifiers.allTextContents()
  expect(originalIdentity.every((value) => value.trim().length > 0)).toBe(true)
  for (const identifier of await identifiers.all()) expect(await hasHorizontalOverflow(identifier)).toBe(false)
  expect(await hasHorizontalOverflow(dialog)).toBe(false)
  expect(await hasHorizontalOverflow(dialog.locator('.inventory-workspace-scroll--dense'))).toBe(false)

  const [headerBox, identityBox, toolbarBox, tabsBox, panelBox, operationsBox] = await Promise.all([
    header.boundingBox(), identity.boundingBox(), toolbar.boundingBox(), tabs.boundingBox(),
    panel.boundingBox(), operations.boundingBox(),
  ])
  for (const box of [headerBox, identityBox, toolbarBox, tabsBox, panelBox, operationsBox]) expect(box).not.toBeNull()
  expect((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0)).toBeLessThanOrEqual((headerBox?.y ?? 0) + (headerBox?.height ?? 0) + 1)
  expect(tabsBox?.y ?? 0).toBeGreaterThanOrEqual((headerBox?.y ?? 0) + (headerBox?.height ?? 0) - 1)
  expect(panelBox?.y ?? 0).toBeGreaterThanOrEqual((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0) - 1)
  for (const signal of await operations.getByRole('button').all()) {
    const box = await signal.boundingBox()
    expect(box).not.toBeNull()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((operationsBox?.y ?? 0) + (operationsBox?.height ?? 0) + 1)
    expect(await signal.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(false)
  }

  const records = tabs.getByRole('tab', { name: 'Records' })
  await records.focus()
  await records.press('Home')
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(records).toBeFocused()
  await expect(records).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tabpanel', { name: 'Records' })).toBeVisible()
  await expect(dialog.locator('.inventory-workspace-gallery')).toBeHidden()
  await expect(identifiers).toHaveText(originalIdentity)

  if (testInfo.project.name === 'mobile') {
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 })
    expect((await dialog.boundingBox())?.width).toBe(390)
    await page.setViewportSize({ width: 700, height: 844 })
    await expect.poll(() => dialog.boundingBox().then((box) => box?.width)).toBe(700)
    await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Equipment', 'Holds & moves', 'Records'])
    expect(await hasHorizontalOverflow(dialog)).toBe(false)
  }
})

test('keeps equipment immediately below navigation without repeated gallery or specifications', async ({ page }, testInfo) => {
  const dialog = await openWorkspace(page, testInfo.project.name)
  await dialog.getByRole('tab', { name: 'Equipment' }).click()
  await expect(dialog).toHaveAttribute('data-active-section', 'equipment')
  const panel = dialog.getByRole('tabpanel', { name: 'Equipment' })
  await expect(panel.getByText('Equipment & packages', { exact: true })).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Vehicle specifications' })).toHaveCount(0)
  await expect(panel.locator('.inventory-workspace-equipment-group > ul > li > svg')).toHaveCount(0)
  await expect(panel.locator('.inventory-workspace-equipment-group')).not.toHaveCount(0)
  await expect(panel.getByRole('button', { name: /copy/i })).toHaveCount(0)
  await expect(dialog.locator('.inventory-workspace-gallery')).toBeHidden()
  await expect(dialog.getByRole('region', { name: 'Vehicle operational summary' })).toHaveCount(0)
  expect(await hasHorizontalOverflow(dialog)).toBe(false)

  const [panelBox, tabsBox] = await Promise.all([
    panel.boundingBox(), dialog.getByRole('tablist', { name: 'Vehicle workspace sections' }).boundingBox(),
  ])
  expect(panelBox).not.toBeNull()
  expect(tabsBox).not.toBeNull()
  expect((panelBox?.y ?? 0) - ((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0))).toBeLessThanOrEqual(36)

  const showAll = panel.getByRole('button', { name: /Show all \d+ items/i }).first()
  await expect(showAll).toBeVisible()
  await expect(showAll).toHaveAttribute('aria-expanded', 'false')
  const equipmentGroup = showAll.locator('xpath=ancestor::*[contains(@class,"inventory-workspace-equipment-group")][1]')
  await showAll.click()
  await expect(equipmentGroup.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
  for (const item of await equipmentGroup.locator('li').all()) await expect(item).toBeVisible()

  const categories = panel.locator('.inventory-workspace-equipment-evidence__groups')
  await expect(categories).toBeVisible()
  expect(await hasHorizontalOverflow(categories)).toBe(false)
  if (testInfo.project.name === 'mobile') {
    const firstGroupBox = await panel.locator('.inventory-workspace-equipment-group').first().boundingBox()
    expect(firstGroupBox).not.toBeNull()
    expect(firstGroupBox?.width ?? 0).toBeGreaterThan((panelBox?.width ?? 0) - 40)
    const groupColumns = await categories.evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    expect(groupColumns.trim().split(/\s+/)).toHaveLength(1)
  }

  const scroller = dialog.locator('.inventory-workspace-scroll--dense')
  await scroller.evaluate((element) => { element.scrollTop = 480 })
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await dialog.getByRole('tab', { name: 'Overview' }).click()
  await expect(dialog).toHaveAttribute('data-active-section', 'overview')
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)
})
