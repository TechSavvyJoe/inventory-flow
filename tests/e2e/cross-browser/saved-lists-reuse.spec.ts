import { expect, test as base, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { BootstrapData } from '../../../src/types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS: membership uses the isolated
// demo API; only GET responses supply fabricated changes to current inventory.
// Native sharing is intercepted locally and never contacts a recipient.
type SharedPdf = { name: string; type: string; header: string; sha256: string }
type ShareWindow = Window & { savedListShares: SharedPdf[] }
type SavedListReceipt = { id: string; label: string; revision: number; items: Array<{ vin: string }> }
type OwnedListCleanup = { created: { id: string; label: string; headers: Record<string, string> } | null }

const test = base.extend<{ ownedList: OwnedListCleanup }>({
  ownedList: async ({ request, baseURL }, use, testInfo) => {
    expect(baseURL).toBe('http://127.0.0.1:4273')
    const ownedList: OwnedListCleanup = { created: null }
    await use(ownedList)
    if (!ownedList.created) return
    // This fixture removes only the exact list returned by our UI create request,
    // including after a failed assertion. Existing lists are never test cleanup.
    const { id, label, headers } = ownedList.created
    const before = await request.get('/api/saved-lists', { headers })
    expect(before.ok(), 'Read the test-owned list for cleanup').toBe(true)
    const { lists } = await before.json() as { lists: SavedListReceipt[] }
    const created = lists.find(list => list.id === id)
    expect(created?.label).toBe(label)
    expect(created!.items.every(item => item.vin.startsWith('TESTDATA'))).toBe(true)
    const removed = await request.post('/api/saved-lists', {
      headers: { ...headers, origin: baseURL!, 'idempotency-key': randomUUID() },
      data: { action: 'delete', listId: id, expectedRevision: created!.revision },
    })
    expect(removed.ok(), 'Delete only the test-owned list').toBe(true)
    expect(await removed.json()).toMatchObject({ id, deleted: true })
    const after = await request.get('/api/saved-lists', { headers })
    expect(after.ok()).toBe(true)
    const remaining = await after.json() as { lists: SavedListReceipt[] }
    expect(remaining.lists).toEqual(lists.filter(list => list.id !== id))
    await testInfo.attach('test-owned-list-cleanup', {
      contentType: 'application/json',
      body: JSON.stringify({ id, label, deleted: true, retainedListIds: remaining.lists.map(list => list.id) }),
    })
  },
})

async function expectUsableControls(page: Page, surface: Locator) {
  const viewport = page.viewportSize()!
  const bounds = await surface.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
  const controls = surface.getByRole('button').or(surface.getByRole('combobox'))
  const boxes: Array<{ x: number; y: number; width: number; height: number; name: string }> = []
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue
    const box = (await control.boundingBox())!
    const name = await control.getAttribute('aria-label') ?? await control.innerText()
    expect(box.height, `${name}: target height`).toBeGreaterThanOrEqual(44)
    expect(box.width, `${name}: target width`).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    // The saved-vehicle rows can scroll, but all toolbar actions must fit.
    if (await surface.getAttribute('role') === 'dialog') {
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    // Rows inside the popup intentionally scroll beneath its fixed footer.
    // Compare visible intersections, not the clipped portions behind it.
    const visible = await control.evaluate(element => {
      const rect = element.getBoundingClientRect()
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect()
        if (style.overflowX !== 'visible') { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
        if (style.overflowY !== 'visible') { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
      }
      return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
    })
    if (visible.width && visible.height) boxes.push({ ...visible, name })
  }
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first], b = boxes[second]
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      expect(overlapX > 1 && overlapY > 1, `${a.name} and ${b.name}: visible controls must not overlap`).toBe(false)
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
}

async function capture(page: Page, testInfo: TestInfo, state: string) {
  await page.mouse.move(0, 0)
  const isDrawer = state === 'reopened' || state === 'add-vehicles'
  const surface = isDrawer
    ? page.getByRole('region', { name: /^Saved vehicles \d+$/ })
    : page.getByRole('region', { name: '2024 Ford F-150 Lariat', exact: true })
  if (!isDrawer) {
    await surface.evaluate(element => (window.innerWidth <= 760 ? element : element.closest('article')!).scrollIntoView({ block: 'start' }))
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect.poll(() => surface.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
  const path = testInfo.outputPath(`saved-list-${state}-${page.viewportSize()!.width}.png`)
  await page.screenshot({ path })
  await testInfo.attach(state, { path, contentType: 'image/png' })
}

async function addFromReopenedList(panel: Locator, stock: string, label: string) {
  const add = panel.getByRole('button', { name: 'Add vehicles', exact: true })
  if (await add.getAttribute('aria-expanded') !== 'true') await add.click()
  await panel.getByRole('searchbox', { name: 'Find vehicles to add' }).fill(stock)
  await panel.getByRole('button', { name: `Add ${stock} to ${label}`, exact: true }).click()
  await expect(panel.getByRole('button', { name: `Remove ${stock} from list`, exact: true })).toBeEnabled()
}

async function saveComparison(page: Page, sheet: Locator, testInfo: TestInfo, state: string) {
  const downloadPromise = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Save PDF', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('inventory-flow-vehicle-comparison.pdf')
  const path = testInfo.outputPath(`saved-list-${state}.pdf`)
  await download.saveAs(path)
  await testInfo.attach(`${state} comparison PDF`, { path, contentType: 'application/pdf' })
  const bytes = await readFile(path)
  expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.7')
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getAuthor()).toBe('Inventory Flow')
  expect(pdf.getTitle()).toBe('Inventory Flow vehicle comparison')
  expect(pdf.getPageCount()).toBe(await sheet.getByRole('article', { name: /^Vehicle comparison · Page \d+ of \d+$/ }).count())
  expect(pdf.getPage(0).getSize()).toEqual({ width: 792, height: 612 })
  return createHash('sha256').update(bytes).digest('hex')
}

test('a saved customer list reopens, persists edits, refreshes comparison facts and reshares only on request', async ({ page, ownedList }, testInfo) => {
  test.setTimeout(120_000)
  const label = `QA ${testInfo.project.name.split('-').map(part => part[0].toUpperCase()).join('')} ${testInfo.workerIndex}`
  let revision: 'initial' | 'updated' | 'retry' = 'initial'
  let fail: 'none' | 'list' | 'inventory' = 'none'
  let holdRefresh: Promise<void> | null = null
  let releaseRefresh: (() => void) | null = null
  let refreshWaiting = false
  const printNotice = 'Customer sheet refresh required. Return to Inventory Flow and refresh this comparison successfully before printing or sharing.'
  let downloads = 0
  page.on('download', () => { downloads += 1 })
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'sales')
    localStorage.setItem('maxey-home-store', 'Howell')
    ;(window as unknown as ShareWindow).savedListShares = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files![0], buffer = await file.arrayBuffer()
      const hash = await crypto.subtle.digest('SHA-256', buffer)
      ;(window as unknown as ShareWindow).savedListShares.push({ name: file.name, type: file.type, header: new TextDecoder().decode(buffer.slice(0, 8)), sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') })
    } })
  })
  await page.route(url => url.pathname === '/api/saved-lists', async route => {
    if (fail === 'list' && route.request().method() === 'GET') {
      await route.fulfill({ status: 503, json: { error: 'Synthetic saved-list refresh interruption' } })
    } else await route.continue()
  })
  await page.route(url => url.pathname === '/api/bootstrap', async route => {
    expect(route.request().method()).toBe('GET')
    if (holdRefresh) {
      refreshWaiting = true
      await holdRefresh
      refreshWaiting = false
    }
    if (fail === 'inventory') {
      await route.fulfill({ status: 503, json: { error: 'Synthetic inventory refresh interruption' } })
      return
    }
    const headers = { ...route.request().headers() }
    delete headers['if-none-match']
    const response = await route.fetch({ headers })
    expect(response.ok()).toBe(true)
    const data = await response.json() as BootstrapData
    expect(data.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const vehicle = data.vehicles.find(candidate => candidate.stockNumber === 'DEMO-H01')!
    expect(vehicle).toBeTruthy()
    vehicle.listedPrice = revision === 'initial' ? 36991 : revision === 'updated' ? 34987 : 33983
    vehicle.windowSticker = {
      ...vehicle.windowSticker, dataState: 'current',
      equipmentGroup: revision === 'initial' ? 'Synthetic comfort package' : revision === 'updated' ? 'Synthetic touring package' : 'Synthetic technology package',
      equipmentGroupContents: [], options: [], standardEquipment: [],
    }
    await route.fulfill({ response, json: data })
  })

  await page.goto('/inventory?scope=group')
  await page.getByRole('button', { name: /^All:/ }).click()
  const launcher = page.getByRole('button', { name: /^Saved vehicles:/ })
  await launcher.click()
  const panel = page.getByRole('region', { name: /^Saved vehicles \d+$/ })
  await panel.getByRole('button', { name: 'New list', exact: true }).click()
  await panel.getByRole('textbox', { name: 'New customer list', exact: true }).fill(label)
  const creation = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/api/saved-lists' || response.request().method() !== 'POST') return false
    const body = response.request().postDataJSON() as { action?: string; label?: string }
    return body.action === 'create' && body.label === label
  })
  await panel.getByRole('button', { name: 'Create', exact: true }).click()
  const createdResponse = await creation
  expect(createdResponse.ok()).toBe(true)
  const createdList = await createdResponse.json() as SavedListReceipt
  ownedList.created = {
    id: createdList.id, label,
    headers: Object.fromEntries(Object.entries(createdResponse.request().headers()).filter(([name]) => name.startsWith('x-inventory-'))),
  }
  const select = panel.getByRole('combobox', { name: 'Customer list', exact: true })
  await expect(select).toHaveValue(/.+/)
  await expect(select.getByRole('option', { name: `${label} (0)`, exact: true })).toHaveJSProperty('selected', true)
  const listId = await select.inputValue()
  expect(listId).toBe(createdList.id)
  await addFromReopenedList(panel, 'DEMO-H02', label)
  await addFromReopenedList(panel, 'DEMO-F02', label)
  await page.keyboard.press('Escape')
  await expect(launcher).toBeFocused()

  await page.reload()
  await launcher.click()
  await expect(select).toHaveValue(listId)
  await expect(select.getByRole('option', { name: `${label} (2)`, exact: true })).toHaveJSProperty('selected', true)
  await expect(panel.getByRole('button', { name: 'Remove DEMO-H02 from list', exact: true })).toBeEnabled()
  await panel.getByRole('button', { name: 'Remove DEMO-H02 from list', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Remove DEMO-H02 from list', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Add vehicles', exact: true }).click()
  await panel.getByRole('searchbox', { name: 'Find vehicles to add' }).fill('DEMO-H01')
  await expect(panel.getByRole('button', { name: `Add DEMO-H01 to ${label}`, exact: true })).toBeEnabled()
  await expectUsableControls(page, panel)
  await capture(page, testInfo, 'add-vehicles')
  if (testInfo.project.name === 'chromium-desktop') {
    await page.setViewportSize({ width: 320, height: 844 })
    await expectUsableControls(page, panel)
    await capture(page, testInfo, 'add-vehicles')
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await addFromReopenedList(panel, 'DEMO-H01', label)
  await page.reload()
  await launcher.click()
  await expect(select).toHaveValue(listId)
  await expect(select.getByRole('option', { name: `${label} (2)`, exact: true })).toHaveJSProperty('selected', true)
  for (const stock of ['DEMO-F02', 'DEMO-H01']) await expect(panel.getByRole('button', { name: `Remove ${stock} from list`, exact: true })).toBeEnabled()
  await expect(panel.getByRole('button', { name: 'Remove DEMO-H02 from list', exact: true })).toHaveCount(0)
  await expectUsableControls(page, panel)
  await capture(page, testInfo, 'reopened')

  const sheetLauncher = panel.getByRole('button', { name: 'Customer sheet (2)', exact: true })
  await sheetLauncher.click()
  const sheet = page.getByRole('dialog', { name: `Take-home page · ${label}`, exact: true })
  await sheet.getByRole('combobox', { name: 'Format' }).selectOption('comparison')
  for (const covered of [
    page.getByRole('region', { name: /^Saved vehicles \d+$/, includeHidden: true }),
    page.getByRole('region', { name: 'Customer shortlist launcher', includeHidden: true }),
  ]) {
    await expect(covered).toHaveAttribute('inert', '')
    await expect(covered).toHaveAttribute('aria-hidden', 'true')
    await expect(covered).toHaveCSS('opacity', '0')
    await expect(covered).toHaveCSS('pointer-events', 'none')
  }
  const comparison = sheet.getByRole('region', { name: '2024 Ford F-150 Lariat', exact: true })
  const save = sheet.getByRole('button', { name: 'Save PDF', exact: true })
  await expect(save).toBeEnabled({ timeout: 30_000 })
  await expect(sheet.getByRole('article', { name: 'Vehicle comparison · Page 1 of 1', exact: true })).toHaveCount(1)
  await expect(comparison).toContainText('$36,991')
  await expect(comparison).toContainText('Synthetic comfort package')
  await expect(sheet).toContainText('DEMO-F02')
  await expect(comparison).toContainText('DEMO-H01')
  await expect(sheet).not.toContainText('DEMO-H02')
  await expectUsableControls(page, sheet)
  expect(downloads).toBe(0)
  expect(await page.evaluate(() => (window as unknown as ShareWindow).savedListShares)).toEqual([])
  const initialPdfHash = await saveComparison(page, sheet, testInfo, 'initial')
  await sheet.getByRole('button', { name: 'Share', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as ShareWindow).savedListShares)).toEqual([
    { name: 'inventory-flow-vehicle-comparison.pdf', type: 'application/pdf', header: '%PDF-1.7', sha256: initialPdfHash },
  ])

  revision = 'updated'
  holdRefresh = new Promise<void>(resolve => { releaseRefresh = resolve })
  await sheet.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
  await expect.poll(() => refreshWaiting, { message: 'The current inventory GET is held until the export gate is checked' }).toBe(true)
  for (const name of ['Print / Save as PDF', 'Save PDF', 'Share']) await expect(sheet.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(sheet.getByRole('status')).toHaveText('Refreshing saved list and inventory…')
  releaseRefresh!()
  holdRefresh = null
  await expect(save).toBeEnabled({ timeout: 30_000 })
  await expect(comparison).toContainText('$34,987')
  await expect(comparison).toContainText('Synthetic touring package')
  await expect(comparison).not.toContainText('$36,991')
  await expect(comparison).not.toContainText('Synthetic comfort package')
  await expect(sheet.getByText(/^Inventory checked/)).toBeVisible()
  expect(downloads).toBe(1)
  expect(await page.evaluate(() => (window as unknown as ShareWindow).savedListShares.length)).toBe(1)
  await capture(page, testInfo, 'refreshed-comparison')
  if (testInfo.project.name === 'chromium-desktop') {
    for (const viewport of [{ width: 320, height: 844 }, { width: 1024, height: 768 }, { width: 1320, height: 820 }]) {
      await page.setViewportSize(viewport)
      await expectUsableControls(page, sheet)
      if (viewport.width >= 1024) {
        const first = (await sheet.getByRole('region', { name: '2022 Ford Maverick Lariat', exact: true }).boundingBox())!
        const second = (await comparison.boundingBox())!
        expect(Math.abs(first.y - second.y), 'The comparison keeps both vehicles aligned side by side').toBeLessThanOrEqual(1)
        expect(first.x + first.width).toBeLessThanOrEqual(second.x)
        expect(await sheet.getByRole('article', { name: 'Vehicle comparison · Page 1 of 1', exact: true }).locator('.comparison-line').evaluateAll(lines => lines.filter(line => line.scrollWidth > line.clientWidth + 1).map(line => line.textContent))).toEqual([])
      }
      await capture(page, testInfo, 'refreshed-comparison')
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const refreshedPdfHash = await saveComparison(page, sheet, testInfo, 'refreshed')
  expect(refreshedPdfHash).not.toBe(initialPdfHash)
  await sheet.getByRole('button', { name: 'Share', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as ShareWindow).savedListShares)).toEqual([
    { name: 'inventory-flow-vehicle-comparison.pdf', type: 'application/pdf', header: '%PDF-1.7', sha256: initialPdfHash },
    { name: 'inventory-flow-vehicle-comparison.pdf', type: 'application/pdf', header: '%PDF-1.7', sha256: refreshedPdfHash },
  ])

  for (const failure of ['list', 'inventory'] as const) {
    fail = failure
    await sheet.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
    await expect(sheet.getByRole('alert')).toContainText('Could not refresh this list')
    await expect(sheet.getByRole('status')).toHaveText('Last-loaded preview. Refresh successfully before exporting.')
    await expect(sheet.getByText(/^Inventory checked/)).toHaveCount(0)
    await expect(comparison).toContainText('$34,987')
    for (const name of ['Print / Save as PDF', 'Save PDF', 'Share']) await expect(sheet.getByRole('button', { name, exact: true })).toBeDisabled()
    expect(downloads).toBe(2)
    expect(await page.evaluate(() => (window as unknown as ShareWindow).savedListShares.length)).toBe(2)
  }
  await expectUsableControls(page, sheet)
  await capture(page, testInfo, 'refresh-failed')
  await page.emulateMedia({ media: 'print' })
  await expect(comparison).toBeHidden()
  await expect(page.getByText(printNotice, { exact: true })).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
  fail = 'none'
  revision = 'retry'
  await sheet.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
  await expect(save).toBeEnabled({ timeout: 30_000 })
  await expect(comparison).toContainText('$33,983')
  await expect(comparison).toContainText('Synthetic technology package')
  await expect(sheet.getByRole('alert')).toHaveCount(0)
  await expect(sheet.getByText(/^Inventory checked/)).toBeVisible()
  const pages = await sheet.getByRole('article', { name: /^Vehicle comparison · Page \d+ of \d+$/ }).count()
  await expect(sheet.getByRole('status')).toHaveText(`Ready · ${pages} ${pages === 1 ? 'page' : 'pages'} · 2 vehicles`)
  await page.emulateMedia({ media: 'print' })
  await expect(comparison).toBeVisible()
  await expect(comparison).toContainText('$33,983')
  await expect(comparison).toContainText('Synthetic technology package')
  await expect(page.getByText(printNotice, { exact: true })).toHaveCount(0)
  await page.emulateMedia({ media: 'screen' })

  await sheet.getByRole('button', { name: 'Edit list', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(select).toHaveValue(listId)
  await panel.getByRole('button', { name: 'Remove DEMO-F02 from list', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Remove DEMO-F02 from list', exact: true })).toHaveCount(0)
  const editedSheetLauncher = panel.getByRole('button', { name: 'Customer sheet (1)', exact: true })
  await editedSheetLauncher.click()
  await sheet.getByRole('combobox', { name: 'Format' }).selectOption('comparison')
  await expect(save).toBeEnabled({ timeout: 30_000 })
  await expect(comparison).toContainText('DEMO-H01')
  await expect(sheet).not.toContainText('DEMO-F02')
  const close = sheet.getByRole('button', { name: 'Close', exact: true })
  await close.focus()
  await page.keyboard.press('Tab')
  await expect(sheet.getByRole('combobox', { name: 'Format' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editedSheetLauncher).toBeFocused().catch(async error => {
    await testInfo.attach('focus-after-sheet-close', { contentType: 'application/json', body: JSON.stringify(await editedSheetLauncher.evaluate(element => ({
      documentFocused: document.hasFocus(), activeElement: document.activeElement?.outerHTML.slice(0, 1200),
      opener: element.outerHTML, inertAncestor: element.closest('[inert]')?.outerHTML.slice(0, 1200),
      rootInert: document.getElementById('root')?.inert, rootHidden: document.getElementById('root')?.getAttribute('aria-hidden'),
      drawerInert: element.closest('section')?.inert, drawerHidden: element.closest('section')?.getAttribute('aria-hidden'),
      visibility: getComputedStyle(element).visibility, display: getComputedStyle(element).display,
    })), null, 2) })
    throw error
  })
  await expect(panel).not.toHaveAttribute('inert')
  await expect(panel).not.toHaveAttribute('aria-hidden', 'true')
  await expect(panel).toHaveCSS('opacity', '1')
  await page.keyboard.press('Escape')
  await expect(launcher).toBeFocused()
  await page.reload()
  await launcher.click()
  await expect(select).toHaveValue(listId)
  await expect(select.getByRole('option', { name: `${label} (1)`, exact: true })).toHaveJSProperty('selected', true)
  await expect(panel.getByRole('button', { name: 'Remove DEMO-H01 from list', exact: true })).toBeEnabled()
  await expect(panel.getByRole('button', { name: 'Remove DEMO-F02 from list', exact: true })).toHaveCount(0)

})

test('Overview keeps customer-sheet print state and opens the matching saved list for editing', async ({ page }, testInfo) => {
  const label = 'QA Overview', listId = 'synthetic-overview-reuse'
  let fail: 'none' | 'inventory' = 'none'
  const printNotice = 'Customer sheet refresh required. Return to Inventory Flow and refresh this comparison successfully before printing or sharing.'
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'sales')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.route(url => url.pathname === '/api/saved-lists', async route => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ json: { lists: [{ id: listId, label, revision: 1, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', items: [{ vin: 'TESTDATAHWELL0001', available: true, addedAt: '2026-09-30T12:00:00Z' }] }] } })
  })
  await page.route(url => url.pathname === '/api/bootstrap', async route => {
    expect(route.request().method()).toBe('GET')
    if (fail === 'inventory') {
      await route.fulfill({ status: 503, json: { error: 'Synthetic inventory refresh interruption' } })
      return
    }
    const headers = { ...route.request().headers() }
    delete headers['if-none-match']
    const response = await route.fetch({ headers })
    expect(response.ok()).toBe(true)
    const data = await response.json() as BootstrapData
    expect(data.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const vehicle = data.vehicles.find(candidate => candidate.stockNumber === 'DEMO-H01')!
    vehicle.listedPrice = 33983
    vehicle.windowSticker = { ...vehicle.windowSticker, dataState: 'current', equipmentGroup: 'Synthetic technology package', equipmentGroupContents: [], options: [], standardEquipment: [] }
    await route.fulfill({ response, json: data })
  })
  const sheet = page.getByRole('dialog', { name: `Take-home page · ${label}`, exact: true })
  const comparison = sheet.getByRole('region', { name: '2024 Ford F-150 Lariat', exact: true })
  const save = sheet.getByRole('button', { name: 'Save PDF', exact: true })
  const panel = page.getByRole('region', { name: /^Saved vehicles \d+$/ })
  const select = panel.getByRole('combobox', { name: 'Customer list', exact: true })
  await page.goto('/overview')
  const overviewLists = page.getByRole('region', { name: 'Customer saved lists', exact: true })
  await expect(overviewLists.getByRole('button', { name: new RegExp(`^${label}\\s*1$`) })).toHaveAttribute('aria-pressed', 'true')
  await overviewLists.getByRole('button', { name: 'Customer sheet', exact: true }).click()
  await sheet.getByRole('combobox', { name: 'Format' }).selectOption('comparison')
  await expect(save).toBeEnabled({ timeout: 30_000 })
  await expect(comparison).toContainText('$33,983')
  await expect(comparison).toContainText('Synthetic technology package')
  await capture(page, testInfo, 'overview-comparison')
  // Native browser printing emits beforeprint independently of the toolbar.
  // Opening a sheet from Overview must keep its own modal and print state.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await page.emulateMedia({ media: 'print' })
  await expect(sheet).toBeVisible()
  await expect(comparison).toBeVisible()
  await expect(comparison).toContainText('$33,983')
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  fail = 'inventory'
  await sheet.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
  await expect(sheet.getByRole('alert')).toContainText('Could not refresh this list')
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await page.emulateMedia({ media: 'print' })
  await expect(sheet).toBeVisible()
  await expect(comparison).toBeHidden()
  await expect(page.getByText(printNotice, { exact: true })).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(save).toBeDisabled()
  fail = 'none'
  await sheet.getByRole('button', { name: 'Edit list', exact: true }).click()
  await expect(page).toHaveURL(/\/inventory\?scope=group$/)
  await expect(panel).toBeVisible()
  await expect(select).toHaveValue(listId)
  await expect(panel.getByRole('button', { name: 'Remove DEMO-H01 from list', exact: true })).toBeEnabled()
})
