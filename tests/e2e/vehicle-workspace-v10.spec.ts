import { expect, test, type Locator, type Page } from '@playwright/test'

async function openWorkspace(page: Page, projectName: string) {
  if (projectName === 'mobile') {
    await page.setViewportSize({ width: 390, height: 844 })
  }
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })

  if (projectName === 'mobile') {
    await page.getByRole('button', { name: /Open details for/i }).first().click()
  } else {
    await page.getByRole('button', { name: /Open vehicle details for/i }).first().click()
  }

  const dialog = page.getByRole('dialog', { name: /vehicle workspace/i })
  await expect(dialog).toBeVisible()
  return dialog
}

async function hasHorizontalOverflow(locator: Locator) {
  return locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
}

test('keeps the operational hero readable and its status strip inside the workspace', async ({ page }, testInfo) => {
  const dialog = await openWorkspace(page, testInfo.project.name)
  await expect(dialog).toHaveClass(/inventory-workspace--v10/)
  await expect(dialog).toHaveAttribute('data-active-section', 'overview')
  if (testInfo.project.name === 'desktop') {
    await expect(dialog.getByRole('button', { name: /Hold status/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Current location/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Movement/i })).toBeVisible()
  } else {
    await expect(dialog.locator('.inventory-workspace-mobile-status__hold')).toBeVisible()
    await expect(dialog.locator('.inventory-workspace-mobile-status__location')).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Location and movement' })).toBeVisible()
  }

  expect(await hasHorizontalOverflow(dialog)).toBe(false)

  if (testInfo.project.name === 'desktop') {
    const hero = dialog.locator('.inventory-workspace-hero')
    const operations = dialog.locator('.inventory-workspace-hero__operations')
    const toolbar = dialog.getByRole('toolbar', { name: 'Vehicle actions' })
    const [heroBox, operationsBox, toolbarBox] = await Promise.all([
      hero.boundingBox(),
      operations.boundingBox(),
      toolbar.boundingBox(),
    ])
    expect(heroBox).not.toBeNull()
    expect(operationsBox).not.toBeNull()
    expect(toolbarBox).not.toBeNull()
    expect((operationsBox?.y ?? 0) + (operationsBox?.height ?? 0)).toBeLessThanOrEqual(
      (heroBox?.y ?? 0) + (heroBox?.height ?? 0) + 1,
    )
    expect((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0)).toBeLessThanOrEqual(
      (heroBox?.y ?? 0) + (heroBox?.height ?? 0) + 1,
    )
  } else {
    const viewport = page.viewportSize()
    expect(viewport).toEqual({ width: 390, height: 844 })

    const hero = dialog.locator('.inventory-workspace-hero')
    const gallery = dialog.locator('.inventory-workspace-gallery--cinematic')
    const summary = dialog.locator('.inventory-workspace-hero__summary')
    const title = dialog.locator('.inventory-workspace-identity__title h2')
    const operations = dialog.locator('.inventory-workspace-hero__operations')
    const status = dialog.locator('.inventory-workspace-mobile-status')
    const actions = dialog.getByRole('toolbar', { name: 'Mobile vehicle actions' })
    const tabs = dialog.getByRole('tablist', { name: 'Vehicle workspace sections' })
    const panel = dialog.getByRole('tabpanel', { name: 'Overview' })

    const [dialogBox, heroBox, galleryBox, summaryBox, titleBox, statusBox, actionsBox, tabsBox, panelBox] =
      await Promise.all([
        dialog.boundingBox(),
        hero.boundingBox(),
        gallery.boundingBox(),
        summary.boundingBox(),
        title.boundingBox(),
        status.boundingBox(),
        actions.boundingBox(),
        tabs.boundingBox(),
        panel.boundingBox(),
      ])

    for (const box of [dialogBox, heroBox, galleryBox, summaryBox, titleBox, statusBox, actionsBox, tabsBox, panelBox]) {
      expect(box).not.toBeNull()
    }

    expect(dialogBox?.width).toBe(390)
    expect(galleryBox?.width).toBeGreaterThanOrEqual(389)
    expect(summaryBox?.width).toBeGreaterThanOrEqual(389)
    expect(summaryBox?.y ?? 0).toBeGreaterThanOrEqual((galleryBox?.y ?? 0) + (galleryBox?.height ?? 0) - 1)
    expect(titleBox?.width).toBeGreaterThan(300)
    expect(titleBox?.height).toBeLessThan(90)
    await expect(operations).toBeHidden()
    await expect(status.getByText('Hold status', { exact: true })).toBeVisible()
    await expect(status.getByText('Salesperson', { exact: true })).toBeVisible()
    await expect(status.getByText('Expected date', { exact: true })).toBeVisible()
    await expect(status.getByText('Location', { exact: true })).toBeVisible()
    expect(statusBox?.height ?? 0).toBeLessThanOrEqual(112)
    expect(statusBox?.y ?? 0).toBeGreaterThanOrEqual((heroBox?.y ?? 0) + (heroBox?.height ?? 0) - 1)
    expect(actionsBox?.y ?? 0).toBeGreaterThanOrEqual((statusBox?.y ?? 0) + (statusBox?.height ?? 0) - 1)
    expect(tabsBox?.y ?? 0).toBeGreaterThanOrEqual((actionsBox?.y ?? 0) + (actionsBox?.height ?? 0) - 1)
    expect(panelBox?.y ?? 0).toBeGreaterThanOrEqual((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0) - 1)

    const heroColumns = await hero.evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    expect(heroColumns.trim().split(/\s+/)).toHaveLength(1)
    expect(await hasHorizontalOverflow(dialog.locator('.inventory-workspace-scroll--dense'))).toBe(false)

    await page.setViewportSize({ width: 700, height: 844 })
    await expect.poll(() => dialog.boundingBox().then((box) => box?.width)).toBe(700)
    const compactTabletColumns = await hero.evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    expect(compactTabletColumns.trim().split(/\s+/)).toHaveLength(1)
    await expect(operations).toBeHidden()
    expect(await hasHorizontalOverflow(dialog)).toBe(false)
  }
})

test('uses a calm progressive equipment ledger without duplicate specification walls', async ({ page }, testInfo) => {
  const dialog = await openWorkspace(page, testInfo.project.name)
  await dialog.getByRole('tab', { name: 'Equipment' }).click()
  await expect(dialog).toHaveAttribute('data-active-section', 'equipment')

  const panel = dialog.getByRole('tabpanel', { name: 'Equipment' })
  await expect(panel.getByText('Equipment & packages', { exact: true })).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Vehicle specifications' })).toHaveCount(0)
  await expect(panel.locator('.inventory-workspace-equipment-group > ul > li > svg')).toHaveCount(0)
  await expect(panel.locator('.inventory-workspace-equipment-group')).not.toHaveCount(0)
  await expect(panel.getByRole('button', { name: /Show all \d+ items/i }).first()).toBeVisible()
  expect(await hasHorizontalOverflow(dialog)).toBe(false)

  const hero = dialog.locator('.inventory-workspace-hero')
  const activePanelBox = await panel.boundingBox()
  const tabsBox = await dialog.getByRole('tablist', { name: 'Vehicle workspace sections' }).boundingBox()
  const heroBox = await hero.boundingBox()
  expect(activePanelBox).not.toBeNull()
  expect(tabsBox).not.toBeNull()
  if (testInfo.project.name === 'desktop') {
    expect(heroBox).not.toBeNull()
    expect((activePanelBox?.y ?? 0) - ((tabsBox?.y ?? 0) + (tabsBox?.height ?? 0))).toBeLessThanOrEqual(
      (heroBox?.height ?? 0) + 32,
    )
  }

  if (testInfo.project.name === 'mobile') {
    const categories = panel.locator('.inventory-workspace-equipment-evidence__groups')
    await expect(categories).toBeVisible()
    expect(await hasHorizontalOverflow(categories)).toBe(false)

    const compactContext = dialog.locator('.inventory-workspace-mobile-context')
    const equipmentIndex = dialog.locator('.inventory-workspace-equipment-specs')
    const firstGroup = panel.locator('.inventory-workspace-equipment-group').first()
    const [panelBox, firstGroupBox, contextBox] = await Promise.all([
      panel.boundingBox(),
      firstGroup.boundingBox(),
      compactContext.boundingBox(),
    ])
    expect(panelBox).not.toBeNull()
    expect(firstGroupBox).not.toBeNull()
    expect(contextBox).not.toBeNull()
    expect(firstGroupBox?.width ?? 0).toBeGreaterThan((panelBox?.width ?? 0) - 30)
    await expect(equipmentIndex).toBeHidden()
    await expect(compactContext).toContainText('DEMO-H01')
    await expect(compactContext).toContainText('TESTDATAHWELL0001')
    const compactIdentifiers = compactContext.locator('.inventory-workspace-mobile-context__identifiers .copyable-value__content')
    await expect(compactIdentifiers).toHaveCount(2)
    for (let index = 0; index < 2; index += 1) {
      expect(await hasHorizontalOverflow(compactIdentifiers.nth(index))).toBe(false)
    }
    expect(contextBox?.height ?? 0).toBeLessThanOrEqual(130)

    const groupColumns = await categories.evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    expect(groupColumns.trim().split(/\s+/)).toHaveLength(1)

    const scroller = dialog.locator('.inventory-workspace-scroll--dense')
    await scroller.evaluate((element) => {
      element.scrollTop = 480
    })
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await dialog.getByRole('tab', { name: 'Overview' }).click()
    await expect(dialog).toHaveAttribute('data-active-section', 'overview')
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)
  }
})
