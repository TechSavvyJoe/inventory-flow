import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// The browser engine is real WebKit. Device descriptors emulate viewport/input;
// physical Safari/iPhone acceptance is still a separate release check.
const test = base.extend<{ runtimeHealth: void }>({
  runtimeHealth: [async ({ page }, use, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) errors.push(message.text())
    })
    await use()
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors, 'Browser runtime and console errors').toEqual([])
    await capture(page, testInfo, 'final-state')
  }, { auto: true }],
})

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: false })
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    dialogOverflow: [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .filter(element => element.getClientRects().length > 0)
      .map(element => element.scrollWidth - element.clientWidth),
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  for (const overflow of dimensions.dialogOverflow) expect(overflow).toBeLessThanOrEqual(1)
}

function results(page: Page, mobile: boolean) {
  return mobile
    ? page.locator('.inventory-mobile-list .inventory-mobile-row')
    : page.locator('.inventory-table--flow tbody tr.inventory-main-row')
}

test('the bundled font paints a visibly heavier bold weight', async ({ page }, testInfo) => {
  await loadInventory(page)
  const weights = await page.evaluate(async () => {
    const family = getComputedStyle(document.body).fontFamily.split(',')[0]
    await Promise.all([400, 700].map(weight => document.fonts.load(`${weight} 40px ${family}`, 'MMMMM')))
    return [400, 700].map(weight => {
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 80
      const context = canvas.getContext('2d')!
      context.font = `${weight} 40px ${family}`
      context.fillText('MMMMM', 0, 50)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let alpha = 0
      for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index]
      return { family, weight, alpha, width: context.measureText('MMMMM').width }
    })
  })
  expect(weights[0].alpha).toBeGreaterThan(0)
  // A real regression in Windows WebKit kept bold at the regular glyph weight
  // while computed font-weight and advance widths still claimed bold.
  expect(weights[1].alpha / weights[0].alpha).toBeGreaterThan(1.2)
  const metricsPath = testInfo.outputPath('font-raster-metrics.json')
  await writeFile(metricsPath, JSON.stringify(weights, null, 2))
  await testInfo.attach('font-raster-metrics', { path: metricsPath, contentType: 'application/json' })
})

async function loadInventory(page: Page) {
  await page.goto('/inventory')
  await expect(page).toHaveTitle(/Inventory Flow/)
  await expect(page).toHaveURL(/\/inventory/)
  await expect(page.getByRole('heading', { name: 'Howell inventory' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All locations, 8 group vehicles' })).toBeVisible()
  // This invariant prevents this suite from accidentally running against real data.
  const bootstrap = await page.request.get('/api/bootstrap?role=manager&homeStore=Howell')
  expect(bootstrap.ok()).toBe(true)
  const payload = await bootstrap.json()
  expect(payload.vehicles).toHaveLength(8)
  expect(payload.vehicles.every((vehicle: { vin: string }) => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
}

async function expectSelectedScopeContrast(page: Page) {
  // DOM state can update before the color transition has reached its final
  // painted state. Await the contrast contract rather than sleeping a duration.
  await expect.poll(() => page.locator('.inventory-scope-switch button[aria-pressed="true"]').evaluate(button => {
    const label = [...button.querySelectorAll<HTMLElement>(':scope > span')].find(element => element.getClientRects().length)!
    const background = getComputedStyle(button).backgroundColor
    const foreground = getComputedStyle(label).webkitTextFillColor || getComputedStyle(label).color
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const [light, dark] = [luminance(background), luminance(foreground)].sort((a, b) => b - a)
    return (light + 0.05) / (dark + 0.05)
  }), { message: 'Selected store label contrast' }).toBeGreaterThanOrEqual(4.5)
}

test('inventory scope, literal search, multilevel sort, and row controls operate', async ({ page, isMobile }, testInfo) => {
  await loadInventory(page)
  if (!isMobile) {
    const footerContrast = await page.locator('.nav-footer-copy small').evaluate(label => {
      const nav = label.closest('.desktop-nav')!
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const s = value / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      }
      const style = getComputedStyle(label)
      const foreground = luminance(style.webkitTextFillColor || style.color)
      const background = luminance(getComputedStyle(nav).backgroundColor)
      return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    })
    expect(footerContrast, 'Sidebar supporting-copy contrast').toBeGreaterThanOrEqual(4.5)
  }
  const rows = results(page, isMobile)
  await expect(rows).toHaveCount(2)
  if (isMobile) {
    await page.evaluate(async () => { await document.fonts.ready })
    const valuations = await rows.locator('.inventory-mobile-row__valuation').evaluateAll(elements => elements.map(element => {
      const items = [...element.children].map(child => {
        const { left, right, top, bottom } = child.getBoundingClientRect()
        return { left, right, top, bottom, size: parseFloat(getComputedStyle(child).fontSize) }
      })
      return {
        sizes: items.map(item => item.size),
        gaps: items.slice(1).map((item, index) => {
          const previous = items[index]
          const sameLine = Math.min(previous.bottom, item.bottom) > Math.max(previous.top, item.top)
          return { sameLine, space: sameLine ? item.left - previous.right : item.top - previous.bottom }
        }),
      }
    }))
    for (const valuation of valuations) {
      expect(valuation.sizes[0], 'Price remains readable').toBeGreaterThanOrEqual(15)
      expect(valuation.sizes[1], 'Mileage remains readable').toBeGreaterThanOrEqual(12)
      for (const gap of valuation.gaps) {
        expect(gap.space, 'Mobile values do not touch or overlap').toBeGreaterThanOrEqual(gap.sameLine ? 8 : 3.5)
      }
    }
    await capture(page, testInfo, 'mobile-valuation-spacing')
  }
  await expectSelectedScopeContrast(page)
  await page.getByRole('button', { name: 'All locations, 8 group vehicles' }).click()
  await expect(rows).toHaveCount(8)
  await expectSelectedScopeContrast(page)

  const search = page.getByRole('combobox', { name: 'Search inventory' })
  await search.fill('DEMO-D02')
  await search.press('Escape')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Silverado 1500')
  await search.fill('no-such-vehicle*?~|')
  await search.press('Escape')
  await expect(rows).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear inventory search' }).click()
  await search.press('Escape')
  await expect(rows).toHaveCount(8)

  const sortButton = page.getByRole('button', { name: /^Sort inventory\./ })
  await sortButton.click()
  await page.getByLabel('Sort priority 1 field').selectOption('price')
  const ascendingButton = page.getByRole('button', { name: 'Price: change to ascending' })
  if (await ascendingButton.count()) await ascendingButton.click()
  if (isMobile) await expect(rows.first()).toContainText('DEMO-F02')
  else await expect(rows.first()).toHaveAttribute('data-stock-number', 'DEMO-F02')
  await page.getByRole('button', { name: 'Price: change to descending' }).click()
  if (isMobile) await expect(rows.first()).toContainText('DEMO-L01')
  else await expect(rows.first()).toHaveAttribute('data-stock-number', 'DEMO-L01')
  await page.getByLabel('Add another inventory sort').selectOption('mileage')
  await expect(page.getByLabel('Sort priority 3 field')).toHaveValue('mileage')
  await sortButton.click()

  await page.getByLabel('Rows per page').selectOption('100')
  await expect(page.getByLabel('Rows per page')).toHaveValue('100')
  await expect(rows).toHaveCount(8)
  await page.reload()
  await expect(page.getByLabel('Rows per page')).toHaveValue('100')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'inventory')
})

test('four-column comparison keeps long equipment, identifiers, resources, and actions legible', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'The phone uses its dedicated vehicle list; desktop/tablet table is verified here.')
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    expect(payload.vehicles.every((vehicle: { vin: string }) => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    for (const vehicle of payload.vehicles) {
      vehicle.changeSummary = 'Price changed'
      vehicle.autoCheckReport = {
        dataState: 'current', score: 95, ownerCount: 1,
        url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic',
      }
      vehicle.windowSticker = {
        dataState: 'current', equipmentGroup: '302A',
        options: ['CLASS IV TRAILER TOW PACKAGE WITH PRO TRAILER BACKUP ASSIST AND INTEGRATED TRAILER BRAKE CONTROLLER', 'FX4 OFF-ROAD PACKAGE', 'EQUIPMENT GROUP 302A'],
        url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U',
      }
    }
    await route.fulfill({ response, json: payload })
  })
  await page.goto('/inventory')
  const main = page.locator('.inventory-table--flow .inventory-main-row').first()
  const record = page.locator('.inventory-record-row').first()
  await expect(page.locator('.inventory-table--flow thead th')).toHaveCount(4)
  await expect(record).toContainText('TESTDATAHWELL0001')
  await expect(record).toContainText('Score 95')
  await expect(record).toContainText('302A')
  await expect(main.getByRole('button', { name: /View all .* equipment items/ })).toBeVisible()
  for (const width of [1024, 1280, 1440, 1800]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('heading', { name: 'Howell inventory' }).scrollIntoViewIfNeeded()
    await page.evaluate(async () => { await document.fonts.ready })
    const dimensions = await main.evaluate(row => {
      const selectors = ['.inventory-vehicle-copy__title strong', '.inventory-equipment-cell__primary strong', '.inventory-row-open', '.inventory-row-action-label', '.inventory-hold-action strong']
      return selectors.map(selector => {
        const element = row.querySelector<HTMLElement>(selector)!
        const css = getComputedStyle(element)
        return { selector, width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight, size: parseFloat(css.fontSize), whiteSpace: css.whiteSpace, text: element.innerText, rect: element.getBoundingClientRect().toJSON() }
      })
    })
    for (const element of dimensions) {
      expect(element.size, `${width}px ${element.selector} readable type`).toBeGreaterThanOrEqual(14)
      if (element.width) expect(element.scrollWidth, `${width}px ${element.selector} not clipped horizontally`).toBeLessThanOrEqual(element.width + 1)
      if (element.height) expect(element.scrollHeight, `${width}px ${element.selector} not clipped vertically`).toBeLessThanOrEqual(element.height + 1)
    }
    const identifiers = await record.locator('.copyable-value__content').evaluateAll(elements => elements.map(element => ({
      size: parseFloat(getComputedStyle(element).fontSize), width: element.clientWidth, scrollWidth: element.scrollWidth,
    })))
    for (const field of identifiers) {
      expect(field.size).toBeGreaterThanOrEqual(13)
      expect(field.scrollWidth).toBeLessThanOrEqual(field.width + 1)
    }
    const region = await page.locator('.inventory-table-wrap').evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }))
    expect(region.contentHeight).toBeLessThanOrEqual(region.height + 2)
    if (width >= 1280) expect(region.contentWidth).toBeLessThanOrEqual(region.width + 2)
    await expectNoOverflow(page)
    await capture(page, testInfo, `table-width-${width}`)
  }
  const equipmentTrigger = main.getByRole('button', { name: /View all .* equipment items/ })
  await equipmentTrigger.click()
  await expect(page.getByRole('tab', { name: 'Equipment', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(equipmentTrigger).toBeFocused()
  await record.getByRole('button', { name: /View change history/ }).click()
  await expect(page.getByRole('tab', { name: 'Records', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  const holdTrigger = main.getByRole('button', { name: /Review DealerMail handoff|Open hold details/ })
  await holdTrigger.click()
  await expect(page.getByRole('tab', { name: 'Holds & moves', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(holdTrigger).toBeFocused()
})

test('larger page sizes expand the results and pagination changes the visible vehicles', async ({ page, isMobile }, testInfo) => {
  // Expand only the already-fabricated bootstrap response for this UI contract.
  // No source data or persistent database is read or changed by this fixture.
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json()
    expect(payload.vehicles.every((vehicle: { vin: string }) => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    payload.vehicles = Array.from({ length: 48 }, (_, index) => {
      const source = payload.vehicles[index % payload.vehicles.length]
      const vin = `TESTDATAPAGE${String(index).padStart(5, '0')}`
      const stockNumber = `DEMO-P${String(index).padStart(3, '0')}`
      return { ...source, vin, stockNumber, searchText: `${source.searchText} ${vin} ${stockNumber}` }
    })
    await route.fulfill({ response, json: payload })
  })
  await page.goto('/inventory?scope=group')
  await expect(page.getByRole('button', { name: 'All locations, 48 group vehicles' })).toBeVisible()
  await page.getByRole('button', { name: 'All locations, 48 group vehicles' }).click()
  await page.getByLabel('Rows per page').selectOption('10')
  const rows = results(page, isMobile)
  await expect(rows).toHaveCount(10)
  const firstPageText = await rows.first().innerText()
  await page.getByRole('button', { name: 'Next inventory page' }).click()
  await expect(page.getByRole('navigation', { name: 'Inventory pages' })).toContainText('Page 2 of 5')
  expect(await rows.first().innerText()).not.toBe(firstPageText)
  const surface = page.locator('.inventory-results-surface')
  const tenRowHeight = (await surface.boundingBox())!.height
  await page.getByLabel('Rows per page').selectOption('100')
  await expect(rows).toHaveCount(48)
  await expect(page.getByRole('navigation', { name: 'Inventory pages' })).toContainText('Page 1 of 1')
  expect((await surface.boundingBox())!.height).toBeGreaterThan(tenRowHeight * 3)
  if (!isMobile) {
    const dimensions = await page.locator('.inventory-table-wrap').evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      maxHeight: getComputedStyle(element).maxHeight,
    }))
    expect(dimensions.maxHeight).toBe('none')
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 2)
  }
  await expectNoOverflow(page)
  await page.getByRole('heading', { name: /inventory/i }).scrollIntoViewIfNeeded()
  await capture(page, testInfo, 'inventory-expanded-page')
})

test('VDP hold, movement, and full equipment are reachable and closing restores focus', async ({ page, isMobile }, testInfo) => {
  await loadInventory(page)
  const trigger = isMobile
    ? page.getByRole('button', { name: /^Open details for 2024 Ford F-150/ })
    : page.getByRole('button', { name: /^Open vehicle details for 2024 Ford F-150/ })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: /2024 Ford F-150 Lariat vehicle workspace/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tabpanel', { name: 'Overview' })).toBeVisible()
  await expect(dialog).toContainText('DEMO-H01')
  await expect(dialog).toContainText('TESTDATAHWELL0001')
  const layoutEvidence = await dialog.evaluate(root => {
    const selectors = ['', '.vdp-flow-header', '.vdp-flow-navigation', '.vdp-flow-content', '.inventory-workspace-tab-panels', '.inventory-workspace-panel--overview', '.inventory-workspace-panel__body']
    return selectors.map(selector => {
      const element = selector ? root.querySelector(selector)! : root
      const css = getComputedStyle(element)
      return { selector, rect: element.getBoundingClientRect().toJSON(), padding: css.padding, margin: css.margin, border: css.border, gap: css.gap, inset: css.inset, maxWidth: css.maxWidth, blue: css.getPropertyValue('--v10-blue'), info: css.getPropertyValue('--ifx-info') }
    })
  })
  await testInfo.attach('VDP computed layout', { body: JSON.stringify(layoutEvidence, null, 2), contentType: 'application/json' })
  await expect(dialog.getByRole('tab')).toHaveText(['Overview', 'Equipment', 'Holds & moves', 'Records'])
  const metrics = dialog.locator('.vdp-flow-metrics')
  await expect(metrics).toContainText('12,450 mi')
  await expect(metrics.getByRole('button')).toHaveCount(0)
  const header = dialog.locator('.vdp-flow-header')
  const navigation = dialog.getByRole('tablist', { name: 'Vehicle workspace sections' })
  const headerBox = await header.boundingBox()
  const navigationBox = await navigation.boundingBox()
  expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1)
  await expect(dialog.getByRole('toolbar', { name: 'Vehicle actions' })).toBeVisible()
  const status = dialog.getByRole('region', { name: 'Vehicle operational summary' })
  await expect(status.getByRole('button')).toHaveCount(3)
  const statusOverflow = await status.evaluate(element => [...element.querySelectorAll('button')].map(button => ({
    clientHeight: button.clientHeight, scrollHeight: button.scrollHeight,
    clientWidth: button.clientWidth, scrollWidth: button.scrollWidth,
  })))
  for (const box of statusOverflow) {
    expect(box.scrollHeight, 'Status text is not vertically clipped').toBeLessThanOrEqual(box.clientHeight + 1)
    expect(box.scrollWidth, 'Status text stays inside its column').toBeLessThanOrEqual(box.clientWidth + 1)
  }
  const placeholderContrast = await dialog.locator('.inventory-workspace-gallery__placeholder').evaluate(placeholder => {
    const stage = placeholder.closest('.inventory-workspace-gallery')!
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const background = luminance(getComputedStyle(stage).backgroundColor)
    return [...placeholder.querySelectorAll('strong, span')].map(label => {
      const style = getComputedStyle(label)
      const foreground = luminance(style.webkitTextFillColor || style.color)
      return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    })
  })
  for (const contrast of placeholderContrast) expect(contrast, 'Missing-photo copy contrast').toBeGreaterThanOrEqual(4.5)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-overview')

  await dialog.getByRole('tab', { name: 'Holds & moves' }).click()
  const holdPanel = dialog.getByRole('tabpanel', { name: 'Holds & moves' })
  await expect(holdPanel).toBeVisible()
  await expect(dialog.locator('.inventory-workspace-gallery')).toBeHidden()
  await expect(holdPanel).toContainText('Demo Salesperson')
  await expect(holdPanel).toContainText('Backup Demo Salesperson')
  await capture(page, testInfo, 'vehicle-hold')
  const handoff = holdPanel.getByRole('region', { name: 'DealerMail vehicle tools' })
  const launch = handoff.getByRole('button', { name: 'Open DealerMail & copy stock' })
  await launch.scrollIntoViewIfNeeded()
  await expect(launch).toBeVisible()
  await expect(launch).toBeEnabled()
  expect(await handoff.evaluate(panel => parseFloat(getComputedStyle(panel).paddingTop)), 'Handoff heading clears its border').toBeGreaterThanOrEqual(14)
  const launchContrast = await launch.evaluate(button => {
    const style = getComputedStyle(button)
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const foreground = luminance(style.webkitTextFillColor || style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
  })
  expect(launchContrast, 'DealerMail handoff button label contrast').toBeGreaterThanOrEqual(4.5)
  const identifiers = await handoff.locator('dd').evaluateAll(elements => elements.map(element => {
    const { left, right } = element.getBoundingClientRect()
    return { left, right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
  }))
  expect(Math.abs(identifiers[0].left - identifiers[1].left), 'Stock and VIN values align').toBeLessThanOrEqual(1)
  for (const identifier of identifiers) expect(identifier.scrollWidth).toBeLessThanOrEqual(identifier.clientWidth + 1)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'dealermail-handoff')

  await expect(holdPanel.locator('#inventory-section-movement')).toContainText('Howell')
  await expect(holdPanel.getByRole('button', { name: 'Track movement', exact: true })).toBeEnabled()
  await dialog.getByRole('tab', { name: 'Equipment' }).click()
  const equipment = dialog.getByRole('tabpanel', { name: 'Equipment' })
  await expect(equipment).toBeVisible()
  await expect(dialog.locator('.inventory-workspace-gallery')).toBeHidden()
  const equipmentBox = await equipment.boundingBox()
  const currentNavigationBox = await navigation.boundingBox()
  expect(equipmentBox!.y - currentNavigationBox!.y - currentNavigationBox!.height, 'Equipment starts immediately below navigation').toBeLessThanOrEqual(26)
  await expect(equipment).toContainText('Equipment & packages')
  const showAll = equipment.getByRole('button', { name: /Show all \d+ items/ }).first()
  await expect(showAll).toBeVisible()
  const listId = await showAll.getAttribute('aria-controls')
  expect(listId).toBeTruthy()
  const equipmentItems = equipment.locator(`[id="${listId}"] li`)
  const itemsBefore = await equipmentItems.filter({ visible: true }).count()
  const totalItems = await equipmentItems.count()
  await showAll.click()
  expect(totalItems).toBeGreaterThan(itemsBefore)
  await expect(equipmentItems.filter({ visible: true })).toHaveCount(totalItems)
  await expect(equipment).toContainText('Max Trailer Tow Package')
  await expect(equipment.locator('.inventory-workspace-equipment-group > ul > li > svg')).toHaveCount(0)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-equipment')

  await dialog.getByRole('tab', { name: 'Records' }).click()
  const records = dialog.getByRole('tabpanel', { name: 'Records' })
  await expect(records).toBeVisible()
  await expect(records.locator('.vdp-flow-technical')).not.toHaveAttribute('open')
  await expect(records.getByRole('heading', { name: 'Vehicle history', exact: true })).toHaveCount(1)
  const technicalSummary = records.locator('.vdp-flow-technical > summary')
  await dialog.getByRole('button', { name: 'Close vehicle details' }).focus()
  let reachedTechnical = false
  for (let step = 0; step < 70; step += 1) {
    await page.keyboard.press('Tab')
    reachedTechnical = await technicalSummary.evaluate(element => element === document.activeElement)
    if (reachedTechnical) break
  }
  expect(reachedTechnical, 'Keyboard can reach technical details without escaping the dialog').toBe(true)
  await page.keyboard.press('Enter')
  await expect(records.locator('.vdp-flow-technical')).toHaveAttribute('open')
  await page.keyboard.press('Enter')
  await expect(records.locator('.vdp-flow-technical')).not.toHaveAttribute('open')
  await dialog.getByRole('tab', { name: 'Records' }).click()
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-records')
  await dialog.locator('.vdp-flow-resources > summary').click()
  await expect(dialog.getByRole('group', { name: 'Vehicle resources' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.vdp-flow-resources')).not.toHaveAttribute('open')
  await expect(dialog.locator('.vdp-flow-resources > summary')).toBeFocused()

  const originalViewport = page.viewportSize()!
  for (const width of [360, 700, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await dialog.getByRole('tab', { name: 'Equipment' }).click()
    const frame = await dialog.boundingBox()
    const tabs = await navigation.boundingBox()
    const panel = await equipment.boundingBox()
    expect(frame!.y + frame!.height).toBeLessThanOrEqual(901)
    expect(frame!.y).toBeGreaterThanOrEqual(0)
    expect(panel!.y - tabs!.y - tabs!.height).toBeLessThanOrEqual(26)
    expect(tabs!.y + tabs!.height, 'Header leaves usable content space').toBeLessThan(410)
    await expectNoOverflow(page)
    await capture(page, testInfo, `equipment-width-${width}`)
  }
  await page.setViewportSize(originalViewport)

  await dialog.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('vehicle moves search, queue filters, and request entry are usable', async ({ page }, testInfo) => {
  await page.goto('/transfers')
  await expect(page.getByRole('heading', { name: 'Vehicle moves', exact: true })).toBeVisible()
  const queue = page.getByRole('complementary', { name: 'Movement requests' })
  await expect(queue).toBeVisible()
  await page.getByRole('button', { name: /^Active/ }).click()
  const items = queue.locator('.transfer-list-item')
  expect(await items.count()).toBeGreaterThan(0)
  await page.getByLabel('Search vehicle moves').fill('missing-move')
  await expect(items).toHaveCount(0)
  await page.getByLabel('Search vehicle moves').fill('DEMO-H01')
  await expect(items).toHaveCount(1)
  await page.getByLabel('Sort vehicle moves').selectOption('stock')
  await expect(page.getByLabel('Sort vehicle moves')).toHaveValue('stock')
  await page.getByLabel('Filter vehicle moves').selectOption('awaiting-approval')
  await expect(items).toHaveCount(0)
  await page.getByLabel('Filter vehicle moves').selectOption('all')
  await expect(items).toHaveCount(1)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-moves')
  await items.first().click()
  await expect(page).toHaveURL(/\/transfers\?id=/)
  await expect(page.locator('#transfer-detail-workspace')).toContainText('DEMO-H01')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-move-detail')
  await page.goto('/transfers')
  await page.getByRole('button', { name: 'Request a vehicle', exact: true }).click()
  await expect(page).toHaveURL(/\/inventory/)
  await expect(page.getByRole('heading', { name: 'Howell inventory' })).toBeVisible()
})

test('attention scope, search, item detail, and daily changes remain operable', async ({ page, isMobile }, testInfo) => {
  await page.goto('/attention')
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible()
  const scope = page.getByRole('group', { name: 'Queue location scope' })
  await expect(scope.getByRole('button', { name: 'Howell' })).toHaveAttribute('aria-pressed', 'true')
  await scope.getByRole('button', { name: 'All stores' }).click()
  await expect(scope.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  const items = page.getByRole('list', { name: 'Attention items' }).getByRole('listitem')
  expect(await items.count()).toBeGreaterThan(0)
  await page.getByRole('textbox', { name: 'Search work queue' }).fill('missing-alert*?~|')
  await expect(items).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear queue search' }).click()
  expect(await items.count()).toBeGreaterThan(0)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'attention')
  const item = items.first().getByRole('button')
  await item.click()
  const detail = page.locator('#ops-selected-detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('region', { name: 'Recommended next step' })).toBeVisible()
  expect(await detail.locator('.ops-primary-actions button, .ops-primary-actions a').count()).toBeGreaterThan(0)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'attention-detail')
  if (isMobile) {
    await page.getByRole('button', { name: 'Close attention item' }).click()
    await expect(item).toBeFocused()
  }
  await page.getByRole('tab', { name: /^Daily changes/ }).click()
  await expect(page.getByRole('tab', { name: /^Daily changes/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: /^Daily changes/ })).toBeVisible()
  await expectNoOverflow(page)
  await page.getByRole('tab', { name: /^Work queue/ }).click()
  await expect(page.getByRole('tab', { name: /^Work queue/ })).toHaveAttribute('aria-selected', 'true')
})
