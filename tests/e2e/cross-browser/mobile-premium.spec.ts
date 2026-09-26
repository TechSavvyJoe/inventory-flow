import { expect, test, type Dialog, type Page } from '@playwright/test'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
async function fits(page: Page) {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const dialogs = page.getByRole('dialog')
  for (const dialog of await dialogs.all()) {
    const bounds = await dialog.boundingBox()
    if (!bounds) continue
    const viewport = page.viewportSize()!
    expect(bounds.x).toBeGreaterThanOrEqual(-1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(bounds.y).toBeGreaterThanOrEqual(-1)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
})

test('mobile inventory keeps its place while a records sheet opens and switches vehicles', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/inventory?scope=home')
    // Exercise both held and unheld records; the landing default is No hold.
    await page.getByRole('button', { name: /^All:/ }).click()
    const rows = page.locator('.if-srp-mobile-row--scan')
    await expect(rows).toHaveCount(2)
    // Default price ordering puts the Bronco before the F-150. Select the
    // intended rich-record fixture rather than coupling this test to row order.
    const first = rows.filter({ hasText: 'DEMO-H01' })
    const initialHeight = (await first.boundingBox())!.height
    // A list is a comparison surface; full source ledgers belong in Records.
    // Even this held vehicle with movement attention must stay compact.
    expect(initialHeight).toBeLessThanOrEqual(280)
    expect((await rows.first().boundingBox())!.y).toBeLessThanOrEqual(300)
    await expect(first.locator('.vehicle-resources--scan')).toHaveCount(0)
    const url = page.url()
    const toggle = first.getByRole('button', { name: /^Open vehicle records for/ })
    await toggle.click()
    const panel = page.getByRole('dialog', { name: '2024 Ford F-150 Lariat records', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const source of ['window-sticker','autocheck','oasis']) await expect(panel.locator(`.vehicle-resource-summary[data-resource-kind="${source}"]`)).toBeVisible()
    expect((await first.boundingBox())!.height).toBeCloseTo(initialHeight, 0)
    await panel.getByRole('button', { name: 'Expand equipment details', exact: true }).click()
    await expect(panel.getByRole('list', { name:'Included with equipment group' })).toBeVisible()
    await expect(panel.getByText('NO CHARGE', { exact:true })).toBeVisible()
    await panel.getByRole('button', { name: 'Expand history details', exact: true }).click()
    await expect(panel.locator('.vehicle-resource-summary[data-resource-kind="autocheck"]')).toBeVisible()
    await expect(panel.getByRole('list', { name:'Included with equipment group' })).toHaveCount(0)
    await expect(page).toHaveURL(url)
    await fits(page)
    await panel.getByRole('button', { name: 'Previous vehicle', exact: true }).click()
    const next = page.getByRole('dialog', { name: '2023 Ford Bronco Sport Badlands records', exact:true })
    await expect(next).toBeVisible()
    await expect(next).toContainText('DEMO-H02')
    await next.getByRole('button', { name:'Close records', exact:true }).click()
    await expect(next).toHaveCount(0)
    await expect(toggle).toBeFocused()
    expect((await first.boundingBox())!.height).toBeCloseTo(initialHeight, 0)
    await expect(page).toHaveURL(url)
  }
})

test('every operational page fits a compact phone and a short landscape viewport', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    for (const route of ['/inventory', '/attention', '/updates', '/transfers', '/service', '/manager', '/admin']) {
      await page.goto(route)
      await expect(page.locator('main h1').first()).toBeVisible()
      await fits(page)
      if (route === '/inventory' && viewport.width <= 390) {
        // Avoid regressing the stacked shell + surface gutters that consumed
        // 54px of phone width. Insets belong inside these full-width surfaces.
        for (const selector of ['.if-srp-mobile-row--scan', '.mobile-bottom-nav']) {
          const surface = page.locator(selector).first()
          await expect(surface).toBeVisible()
          const bounds = (await surface.boundingBox())!
          expect(Math.abs(bounds.x)).toBeLessThanOrEqual(1)
          expect(Math.abs(bounds.x + bounds.width - viewport.width)).toBeLessThanOrEqual(1)
        }
      }
    }
  }
  expect(errors).toEqual([])
})

test('a phone vehicle workspace remains usable after rotation and a keyboard-sized viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inventory?vin=TESTDATAHWELL0002')
  const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
  await expect(workspace).toBeVisible()
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 420 }]) {
    await page.setViewportSize(viewport)
    await fits(page)
    if (viewport.width <= 390) {
      const bounds = (await workspace.boundingBox())!
      expect(Math.abs(bounds.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(bounds.width - viewport.width)).toBeLessThanOrEqual(1)
      const header = (await workspace.locator('.vdp-focus-header').boundingBox())!
      const navigation = (await workspace.locator('.vdp-focus-navigation').boundingBox())!
      expect(header.height, 'compact phone identity and status header').toBeLessThanOrEqual(96)
      expect(header.height + navigation.height, 'vehicle content remains in the first phone viewport').toBeLessThanOrEqual(144)
      const tabRail = workspace.getByRole('tablist', { name: 'Vehicle workspace sections' })
      const tabRailDimensions = await tabRail.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
      expect(tabRailDimensions.scrollWidth).toBeGreaterThan(tabRailDimensions.clientWidth)
      for (const name of ['Overview', 'Equipment', 'Records', 'Holds & moves', 'Activity']) {
        const tab = workspace.getByRole('tab', { name, exact: true })
        await tab.scrollIntoViewIfNeeded()
        await expect(tab).toBeInViewport()
      }
      for (const value of await workspace.locator('.vdp-focus-identifiers .copyable-value__content').all()) {
        await value.scrollIntoViewIfNeeded()
        const content = (await value.boundingBox())!
        expect(content.x + content.width).toBeLessThanOrEqual(viewport.width)
        await expect(value).toHaveCSS('white-space', 'nowrap')
      }
      for (const fact of await workspace.locator('.vdp-focus-operations dd:visible').all()) {
        expect((await fact.boundingBox())!.width).toBeGreaterThan(120)
      }
    }
    await workspace.getByRole('tab', { name: 'Records', exact: true }).click()
    await expect(workspace.getByRole('tab', { name: 'Records', exact: true })).toHaveAttribute('aria-selected', 'true')
    if (viewport.width <= 390) {
      for (const title of await workspace.locator('.inventory-vehicle-document__title').all()) {
        expect((await title.boundingBox())!.width).toBeGreaterThan(140)
      }
    }
    await workspace.getByRole('tab', { name: 'Overview', exact: true }).click()
    await expect(workspace.getByRole('button', { name: 'Back to inventory', exact: true })).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-short-viewport.png') })
  await workspace.getByRole('button', { name: 'Back to inventory', exact: true }).click()
  await expect(workspace).toHaveCount(0)
  await fits(page)
})

test('equipment filters and photo gallery retain the vehicle workspace', async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const withGallery = (unit: { imageUrl?: string; imageUrls: string[] }) => {
    // Keep the current summary and detail consistent: summary photo fields
    // intentionally take precedence when retained detail is merged.
    const photo = unit.imageUrl || unit.imageUrls[0]
    return { ...unit, imageUrl: `${photo}?gallery=1`, imageUrls: [1, 2, 3].map(n => `${photo}?gallery=${n}`) }
  }
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    payload.vehicles = payload.vehicles.map((unit: { vin: string; imageUrls: string[] }) => unit.vin === 'TESTDATAHWELL0001' ? withGallery(unit) : unit)
    await route.fulfill({ response, json: payload })
  })
  await page.route('**/api/vehicles/TESTDATAHWELL0001', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: withGallery(await response.json()) })
  })
  await page.goto('/inventory?vin=TESTDATAHWELL0001&scope=home')
  const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
  await expect(workspace.getByRole('region', { name: 'Photos of 2024 Ford F-150 Lariat' })).toContainText('1 / 3')
  const opener = workspace.getByRole('button', { name: /Open photo gallery/ })
  await opener.click()
  const gallery = page.getByRole('dialog', { name: /photo gallery$/ })
  await expect(gallery.getByText('Photo 1 of 3', { exact: false })).toBeVisible()
  await gallery.getByRole('button', { name: 'Next photo', exact: true }).click()
  await expect(gallery.getByText('Photo 2 of 3', { exact: false })).toBeVisible()
  await gallery.press('ArrowRight')
  await expect(gallery.getByText('Photo 3 of 3', { exact: false })).toBeVisible()
  await gallery.getByRole('button', { name: 'View photo 1', exact: true }).click()
  const stage = gallery.locator('.vehicle-photo-viewer__stage')
  // Desktop Firefox does not expose Touch; keyboard navigation above and
  // button zoom below remain covered there. Chromium/WebKit exercise gestures.
  if (browserName !== 'firefox') {
    await stage.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 300, clientY: 300 }] })
    await stage.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 60, clientY: 302 }] })
    await expect(gallery.getByText('Photo 2 of 3', { exact: false })).toBeVisible()
    await stage.dispatchEvent('touchstart', { touches: [{identifier:1,clientX:100,clientY:300},{identifier:2,clientX:200,clientY:300}] })
    await stage.dispatchEvent('touchmove', { touches: [{identifier:1,clientX:50,clientY:300},{identifier:2,clientX:250,clientY:300}] })
    await stage.dispatchEvent('touchend', { touches:[],changedTouches:[{identifier:1,clientX:50,clientY:300},{identifier:2,clientX:250,clientY:300}] })
  } else {
    await gallery.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await gallery.getByRole('button', { name: 'Zoom in', exact: true }).click()
  }
  await expect(gallery.getByRole('button', { name:'Reset photo zoom' })).toHaveText('200%')
  await gallery.getByRole('button', { name:'Reset photo zoom' }).click()
  await expect(gallery.getByRole('button', { name:'Reset photo zoom' })).toHaveText('100%')
  await fits(page)
  await gallery.press('Escape')
  await expect(gallery).toHaveCount(0)
  await expect(workspace).toBeVisible()
  await expect(opener).toBeFocused()
  await workspace.getByRole('tab', { name: 'Equipment', exact: true }).click()
  const search = workspace.getByRole('searchbox', { name: 'Search equipment, packages, or codes' })
  await search.fill('DEMO-BED')
  await expect(workspace.getByRole('status')).toHaveText(/1 of \d+ equipment items/)
  await expect(workspace.getByText('Bed utility package', { exact: true })).toBeVisible()
  await workspace.getByRole('button', { name: 'Clear', exact: true }).click()
  await workspace.getByRole('button', { name: /^Technology, 1 item/ }).click()
  await expect(workspace.getByRole('region', { name: 'Technology', exact: true })).toBeVisible()
  await expect(workspace.getByRole('region', { name: 'Packages', exact: true })).toHaveCount(0)
  await workspace.getByRole('button', { name: 'Clear', exact: true }).click()
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(workspace.getByRole('region', { name: 'Packages', exact: true })).toBeVisible()
    await fits(page)
    await page.screenshot({ path: testInfo.outputPath(`equipment-${width}.png`) })
  }
  await expect(page).toHaveURL(/vin=TESTDATAHWELL0001/)
})

test('failed detail and refresh reads retain the workspace and recover through retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let failDetail = true
  await page.route(url => url.pathname === '/api/vehicles/TESTDATAHWELL0002', route => failDetail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary interruption' }) })
    : route.continue())
  await page.goto('/inventory?vin=TESTDATAHWELL0002')
  const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
  await expect(workspace).toBeVisible()
  await expect(workspace.getByRole('button', { name: 'Retry full record' })).toBeVisible()
  failDetail = false
  await workspace.getByRole('button', { name: 'Retry full record' }).click()
  await expect(workspace.getByText('The full record could not load.', { exact: false })).toHaveCount(0)
  await workspace.getByRole('button', { name: 'Back to inventory', exact: true }).click()

  let failRefresh = true
  await page.route(url => url.pathname === '/api/bootstrap', route => failRefresh
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary interruption' }) })
    : route.continue())
  await page.getByRole('button', { name: 'Open account and app controls' }).click()
  await page.getByRole('button', { name: 'Refresh inventory and holds' }).click()
  await page.getByRole('button', { name: 'Close app controls' }).click()
  await expect(page.getByText('The latest update could not be loaded.')).toBeVisible()
  await expect(page.getByRole('combobox', { name: /Search inventory/i })).toBeVisible()
  failRefresh = false
  await page.getByRole('button', { name: 'Retry update' }).click()
  await expect(page.getByText('The latest update could not be loaded.')).toHaveCount(0)
  await fits(page)
})

const workflowVin = 'TESTDATAHWELL0002'
const workflowSearch = 'DEMO-H02'

async function openFilteredVehicle(page: Page) {
  await page.goto('/inventory')
  const search = page.getByRole('combobox', { name: /Search inventory/i })
  await search.fill(workflowSearch)
  await search.press('Escape')
  await page.locator(`[data-inventory-vehicle-trigger="${workflowVin}"]:visible`).first().click()
  await expect(page).toHaveURL(url => url.pathname === '/inventory' && url.searchParams.get('vin') === workflowVin)
  const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
  await expect(workspace).toBeVisible()
  return workspace
}

async function openVehicleService(page: Page) {
  const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
  // Other acceptance cases may have recorded service on this synthetic VIN.
  // Follow the real action currently offered, without manufacturing readiness.
  await workspace.getByRole('link', { name: /^(Start service|Mark Ready|Service history)$/ }).first().click()
  await expect(page).toHaveURL(url => url.pathname === '/service' && url.searchParams.get('vin') === workflowVin)
  await expect(page.getByRole('button', { name: 'Back to vehicle', exact: true })).toBeVisible()
  await expect(page.locator('.service-current')).toBeVisible()
}

test('workflow returns keep the filtered inventory vehicle through service and a move form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const workspace = await openFilteredVehicle(page)
  const documentStarted = await page.evaluate(() => performance.timeOrigin)
  await openVehicleService(page)
  const origin = new URL(page.url()).searchParams.get('returnTo')!
  expect(new URL(origin, page.url()).searchParams.get('vin')).toBe(workflowVin)
  await page.getByRole('button', { name: 'Back to vehicle', exact: true }).click()
  await expect(workspace).toBeVisible()
  await workspace.getByRole('button', { name: 'Move vehicle', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/transfers/new' && url.searchParams.get('vin') === workflowVin)
  expect(new URL(new URL(page.url()).searchParams.get('returnTo')!, page.url()).searchParams.get('vin')).toBe(workflowVin)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(workspace).toBeVisible()
  await workspace.getByRole('button', { name: 'Back to inventory', exact: true }).click()
  await expect(workspace).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Search inventory/i })).toHaveValue(workflowSearch)
  expect(new URL(page.url()).searchParams.has('q')).toBe(false)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted)
})

test('native Back and Forward restore vehicle selection and the private inventory search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const workspace = await openFilteredVehicle(page)
  await page.goBack()
  await expect(workspace).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Search inventory/i })).toHaveValue(workflowSearch)
  expect(new URL(page.url()).searchParams.has('vin')).toBe(false)
  await page.goForward()
  await expect(workspace).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('vin') === workflowVin)
  await workspace.getByRole('button', { name: 'Back to inventory', exact: true }).click()
  await page.goBack()
  await page.goForward()
  await expect(workspace).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Search inventory/i })).toHaveValue(workflowSearch)
})

for (const workflow of ['service', 'move'] as const) {
  test(`native Back preserves an edited ${workflow} draft when leaving is declined, then permits its named return`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const workspace = await openFilteredVehicle(page)
    if (workflow === 'service') {
      await openVehicleService(page)
      if (!await page.getByLabel('Service note').isVisible()) await page.getByRole('button', { name: /^(Edit note|Record service completion)$/ }).click()
    } else {
      await workspace.getByRole('button', { name: 'Move vehicle', exact: true }).click()
    }
    const note = page.getByLabel(workflow === 'service' ? 'Service note' : 'Why is it moving?')
    await note.fill(`Synthetic unfinished ${workflow} note`)
    await expect(note).toHaveValue(`Synthetic unfinished ${workflow} note`)
    const editedUrl = page.url()
    const prompts: string[] = []
    const decline = async (dialog: Dialog) => { prompts.push(dialog.message()); await dialog.dismiss() }
    page.on('dialog', decline)
    await page.evaluate(() => history.back())
    await expect.poll(() => prompts.length).toBe(1)
    await expect(page).toHaveURL(editedUrl)
    await expect(note).toHaveValue(`Synthetic unfinished ${workflow} note`)
    expect(prompts[0]).toContain('unsaved changes')
    page.off('dialog', decline)
    page.once('dialog', async dialog => { prompts.push(dialog.message()); await dialog.accept() })
    await page.getByRole('button', { name: workflow === 'service' ? 'Back to vehicle' : 'Cancel', exact: true }).click()
    await expect(workspace).toBeVisible()
    expect(prompts).toHaveLength(2)
    await expect(page).toHaveURL(url => url.pathname === '/inventory' && url.searchParams.get('vin') === workflowVin)
  })
}

test('a fresh global search overrides local query edits while a normal return preserves them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/service')
  await expect(page.getByRole('heading', { name: 'Service status', exact: true })).toBeVisible()
  async function globalSearch() {
    const input = page.getByRole('textbox', { name: 'Search inventory', exact: true })
    await input.fill('DEMO-H01')
    await input.press('Enter')
    await expect(page.getByRole('combobox', { name: /Search inventory/i })).toHaveValue('DEMO-H01')
    await expect(page).toHaveURL(url => url.pathname === '/inventory' && !url.searchParams.has('q'))
  }
  await globalSearch()
  const local = page.getByRole('combobox', { name: /Search inventory/i })
  await local.fill('DEMO-H02')
  await expect(local).toHaveValue('DEMO-H02')
  await local.press('Escape')
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Service status' }).click()
  await expect(page.getByRole('heading', { name: 'Service status', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Inventory', exact: true }).click()
  await expect(page.getByRole('combobox', { name: /Search inventory/i })).toHaveValue('DEMO-H02')
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Service status' }).click()
  await expect(page.getByRole('heading', { name: 'Service status', exact: true })).toBeVisible()
  await globalSearch()
  await expect(page.locator('[data-inventory-vehicle-trigger="TESTDATAHWELL0001"]:visible').first()).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain('DEMO-H01')
})
