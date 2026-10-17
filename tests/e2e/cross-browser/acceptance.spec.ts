import { chooseInventoryView } from '../inventory-controls'
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// The browser engine is real WebKit. Device descriptors emulate viewport/input;
// physical Safari/iPhone acceptance is still a separate release check.
// In-flight API requests per page. A `page.goto()` while one is pending makes
// WebKit log the cancelled fetch as an "access control checks" console error,
// which the runtime-health guard below would count as real. A state update can
// schedule its follow-up read just after the preceding bootstrap settles, so
// `settleApi` also requires a short quiet window before navigation.
const inFlight = new WeakMap<Page, Map<object, string>>()
const lastApiActivity = new WeakMap<Page, number>()
async function waitForRenderFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}
async function settleApi(page: Page) {
  try {
    const waitForQuietApi = () => expect.poll(() => {
      const pending = inFlight.get(page)?.size ?? 0
      const quietFor = Date.now() - (lastApiActivity.get(page) ?? 0)
      return pending === 0 && quietFor >= 250
    }, { timeout: 10_000, intervals: [50] }).toBe(true)
    // Passive React refresh effects can begin after the first zero-pending
    // observation. Confirm the network stays quiet across a rendered frame
    // before a route change can unload a late same-origin detail read.
    await waitForQuietApi()
    await waitForRenderFrames(page)
    await waitForQuietApi()
  } catch (error) {
    const pending = [...(inFlight.get(page)?.values() ?? [])].join(', ')
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nPending same-origin API request(s): ${pending}`)
  }
}

async function switchLocationAndSettle(page: Page, homeStore: string) {
  // Register before selectOption: changing the working location schedules its
  // bootstrap read from a passive AppDataContext effect.
  const bootstrap = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET' || !response.ok()) return false
    const url = new URL(response.url())
    return url.pathname === '/api/bootstrap' && url.searchParams.get('homeStore') === homeStore
  })
  await page.getByLabel('Working location', { exact: true }).selectOption(homeStore)
  await bootstrap
  await waitForRenderFrames(page)
  await settleApi(page)
}

const test = base.extend<{ runtimeHealth: void }>({
  runtimeHealth: [async ({ page, browserName }, use, testInfo) => {
    const errors: string[] = []
    const pending = new Map<object, string>()
    inFlight.set(page, pending)
    page.on('request', request => {
      if (!request.url().includes('/api/')) return
      lastApiActivity.set(page, Date.now())
      pending.set(request, `${request.method()} ${request.url()}`)
    })
    page.on('requestfinished', request => {
      if (!request.url().includes('/api/')) return
      lastApiActivity.set(page, Date.now())
      pending.delete(request)
    })
    page.on('requestfailed', request => {
      if (!request.url().includes('/api/')) return
      lastApiActivity.set(page, Date.now())
      pending.delete(request)
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      // WebKit ignores this progressive-enhancement viewport key. Keep every
      // other warning/error, including page errors, in the health assertion.
      if (browserName === 'webkit' && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.') return
      if (['error', 'warning'].includes(message.type())) errors.push(message.text())
    })
    await use()
    // Let the rendered route finish its own same-origin reads before Playwright
    // tears down the page. This keeps cancellation noise distinct from a real
    // browser/runtime error and makes the final screenshot reflect settled UI.
    await settleApi(page)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors, 'Browser runtime and console errors').toEqual([])
    await capture(page, testInfo, 'final-state')
  }, { auto: true }],
})

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: false, scale: 'css' })
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


async function expectOpenFilterGeometry(page: Page, width: number) {
  const scope = page.getByRole('group', { name: 'Inventory location scope' })
  const quickFilters = page.getByRole('group', { name: 'Inventory quick filters' })
  const serviceFilters = page.getByRole('group', { name: 'Inventory service status' })
  const serviceSelect = serviceFilters.getByRole('combobox', { name: 'Inventory service status' })
  const serviceControls = [serviceSelect]
  await expect(serviceSelect).toBeVisible()
  await expect(serviceSelect.getByRole('option')).toHaveText([
    /^All · \d+$/, /^Waiting · \d+$/, /^In service · \d+$/, /^Ready · \d+$/,
  ])
  if (width <= 760) {
    const quickView = quickFilters.getByRole('combobox', { name: 'Inventory quick view' })
    await expect(quickView.getByRole('option')).toHaveText([
      /^No hold · \d+$/, /^All · \d+$/, /^Held · \d+$/, /^(?:Offsite|Away) · \d+$/,
    ])
  }
  const sections = [
    page.getByRole('combobox', { name: 'Search inventory' }),
    scope.getByRole('button', { name: /^Howell inventory, \d+ of \d+ group vehicles$/ }),
    scope.getByRole('button', { name: /^All locations, \d+ group vehicles$/ }),
    ...(width <= 760 ? [quickFilters.getByRole('combobox', { name: 'Inventory quick view' })] : [
    quickFilters.getByRole('button', { name: /^No hold: \d+ vehicles$/ }),
    quickFilters.getByRole('button', { name: /^All: \d+ vehicles$/ }),
    quickFilters.getByRole('button', { name: /^Held: \d+ vehicles$/ }),
    quickFilters.getByRole('button', { name: /^(?:Offsite|Away from home): \d+ vehicles$/ }),
    ]),
    ...serviceControls,
    page.getByRole('button', { name: /^Filters/ }),
    page.getByRole('button', { name: /^Sort inventory\./ }),
  ]
  for (const optional of [page.getByRole('button', { name: 'Scan vehicle', exact: true }), page.getByRole('button', { name: /^Shortlist \(\d+\) — Saved only$/ })]) {
    if (await optional.isVisible()) sections.push(optional)
  }
  const boxes = await Promise.all(sections.map(async section => {
    await expect(section).toBeVisible()
    return { name: await section.getAttribute('aria-label') || await section.innerText(), box: (await section.boundingBox())! }
  }))
  for (let left = 0; left < boxes.length; left++) {
    for (let right = left + 1; right < boxes.length; right++) {
      const a = boxes[left]!
      const b = boxes[right]!
      const overlapWidth = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x)
      const overlapHeight = Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y)
      expect(overlapWidth > 1 && overlapHeight > 1, `${width}px ${a.name} and ${b.name} must not overlap`).toBe(false)
    }
  }
  if (width <= 760) {
    const quickFiltersBox = (await quickFilters.boundingBox())!
    const serviceFiltersBox = (await serviceFilters.boundingBox())!
    expect(serviceFiltersBox.y, `${width}px compact service filter stays with or after the quick filters`).toBeGreaterThanOrEqual(quickFiltersBox.y)
  }
  for (const control of serviceControls) {
    const target = (await control.boundingBox())!
    expect(target.height).toBeGreaterThanOrEqual(44)
    expect(target.width).toBeGreaterThanOrEqual(44)
  }
}

function results(page: Page, mobile: boolean) {
  return mobile
    ? page.locator('.if-srp-mobile-list .if-srp-mobile-row')
    : page.locator('.inv-desk-table tbody tr.inv-desk-row')
}

test('inventory reflows from a wide monitor to a narrow phone without crowded controls', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(120_000)
  await loadInventory(page)
  const widths = isMobile ? [320, 330, 360, 390, 430] : [320, 330, 360, 390, 600, 720, 760, 761, 820, 1024, 1280, 1320, 1440, 1920, 2560]
  const measurements: unknown[] = []
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))))
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectNoOverflow(page)
    const freshnessTimestamp = page.locator('.freshness-chip small')
    if (width > 880 && await freshnessTimestamp.isVisible()) {
      const freshnessWidth = await freshnessTimestamp.evaluate(element => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }))
      expect(freshnessWidth.scroll, `Freshness timestamp is complete at ${width}`).toBeLessThanOrEqual(freshnessWidth.client + 1)
    }
    const mobileList = page.locator('.if-srp-mobile-list')
    const table = page.locator('.inventory-grid-shell--desk')
    await expect.poll(async () => Number(await mobileList.isVisible()) + Number(await table.isVisible()), {
      message: `Exactly one results layout at ${width}`,
    }).toBe(1)
    const mobileVisible = await mobileList.isVisible()
    const firstRow = mobileVisible ? mobileList.locator('.if-srp-mobile-row').first() : page.locator('.inv-desk-row').first()
    await expect(firstRow).toBeVisible()
    const bounds = await page.locator('.if-srp-controls').evaluate(element => {
      const controls = [...element.querySelectorAll<HTMLElement>('button,select')].filter(control => control.getClientRects().length && !control.closest('[hidden]'))
      return { height: element.getBoundingClientRect().height, controls: controls.map(control => ({
        name: control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName,
        left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right,
        height: control.getBoundingClientRect().height, size: parseFloat(getComputedStyle(control).fontSize),
      })) }
    })
    expect(bounds.height, `At most two readable control rows including service at ${width}`).toBeLessThanOrEqual(112)
    for (const control of bounds.controls) {
      expect(control.left, `${width}px ${control.name} left edge`).toBeGreaterThanOrEqual(0)
      expect(control.right, `${width}px ${control.name} right edge`).toBeLessThanOrEqual(width + 1)
      expect(control.size, `${width}px ${control.name} readable text`).toBeGreaterThanOrEqual(13)
    }
    const top = (await firstRow.boundingBox())!.y
    expect(top, `First vehicle appears near the controls at ${width}`).toBeLessThan(480)
    if (!mobileVisible) {
      // Table scrollWidth includes its collapsed border widths in Chromium even
      // when its rendered box fits exactly. Assert physical table overhang,
      // which is the actual sideways-scroll/clipping regression users see.
      const overflow = await page.locator('.if-srp-table-wrap').evaluate(el => {
        const table = el.querySelector('table')!
        const wrap = el.getBoundingClientRect()
        const tableBox = table.getBoundingClientRect()
        const style = getComputedStyle(el)
        const left = wrap.left + parseFloat(style.borderLeftWidth)
        const right = wrap.right - parseFloat(style.borderRightWidth)
        return Math.max(0, left - tableBox.left, tableBox.right - right)
      })
      expect(overflow, `No sideways table scrolling at ${width}`).toBeLessThanOrEqual(1)
    }
    const quickSelect = page.getByLabel('Inventory quick view')
    if (await quickSelect.isVisible()) {
      await quickSelect.selectOption('held')
      await expect(quickSelect).toHaveValue('held')
      await quickSelect.selectOption('all')
    }
    await page.getByRole('button', { name: /^Sort inventory\./ }).click()
    const sortPanel = page.locator('.inventory-sort-composer__panel')
    await expect(sortPanel).toBeVisible()
    const panel = (await sortPanel.boundingBox())!
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1)
    await page.getByLabel('Sort priority 1 field').selectOption('price')
    await page.getByRole('button', { name: 'Close sort options' }).click()
    await expect(sortPanel).toBeHidden()
    const search = page.getByRole('combobox', { name: 'Search inventory' })
    const quickFilters = page.getByRole('group', { name: 'Inventory quick filters' })
    const closedSearch = (await search.boundingBox())!
    const closedQuickFilters = (await quickFilters.boundingBox())!
    await page.getByRole('button', { name: /^Filters/ }).click()
    await expect(page.getByRole('region', { name: 'Inventory filters' })).toBeVisible()
    await expectOpenFilterGeometry(page, width)
    await expectNoOverflow(page)
    if ([320, 390, 1024, 1320, 1440].includes(width)) await capture(page, testInfo, `filters-open-${width}`)
    await page.getByRole('button', { name: /^Filters/ }).click()
    const restoredSearch = (await search.boundingBox())!
    const restoredQuickFilters = (await quickFilters.boundingBox())!
    for (const [before, after] of [[closedSearch, restoredSearch], [closedQuickFilters, restoredQuickFilters]]) {
      expect(after!.y, `${width}px closing filters restores the compact header`).toBeCloseTo(before!.y, 0)
      expect(after!.height).toBeCloseTo(before!.height, 0)
    }
    if (width === 320 || width === 390) {
      await page.getByRole('button', { name: 'Save DEMO-H02 to shortlist', exact: true }).click()
      const naming = page.getByRole('dialog', { name: /Save to a customer list|Name this customer list/ })
      const removeSaved = page.getByRole('button', { name: 'Remove DEMO-H02 from shortlist', exact: true })
      await expect.poll(async () => await naming.isVisible() || await removeSaved.isVisible()).toBe(true)
      if (await naming.isVisible()) {
        await naming.getByRole('textbox', { name: 'List name', exact: true }).fill('Responsive demo list')
        await naming.getByRole('button', { name: 'Save vehicle', exact: true }).click()
        await expect(naming).toHaveCount(0)
      }
      await expect(removeSaved).toBeVisible()
      await page.getByRole('button', { name: /^Filters/ }).click()
      await expectOpenFilterGeometry(page, width)
      await expectNoOverflow(page)
      await capture(page, testInfo, `shortlist-filters-open-${width}`)
      await page.getByRole('button', { name: /^Filters/ }).click()
      await page.getByRole('button', { name: 'Remove DEMO-H02 from shortlist', exact: true }).click()
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    measurements.push({ width, controls: bounds, firstVehicleTop: top, layout: mobileVisible ? 'phone' : 'comparison' })
    await capture(page, testInfo, `responsive-${width}`)
  }
  await writeFile(testInfo.outputPath('responsive-metrics.json'), JSON.stringify(measurements, null, 2))
})

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
  // These coverage cases exercise held and unheld records together.
  await chooseInventoryView(page, 'all')
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
  await expect.poll(() => page.locator('.if-srp-scope button[aria-pressed="true"]').evaluate(button => {
    type Rgba = [number, number, number, number]
    const parseColor = (value: string): Rgba => {
      if (value === 'transparent') return [0, 0, 0, 0]
      const match = value.match(/^([a-z-]+)\((.*)\)$/i)
      if (!match) throw new Error(`Unsupported computed color: ${value}`)
      const name = match[1]!.toLowerCase()
      let body = match[2]!.trim()
      let space = ''
      if (name === 'color') {
        const colorSpace = body.match(/^([a-z-]+)\s+/i)
        if (!colorSpace) throw new Error(`Missing computed color space: ${value}`)
        space = colorSpace[1]!.toLowerCase()
        body = body.slice(colorSpace[0].length)
        if (!['srgb', 'srgb-linear'].includes(space)) throw new Error(`Unsupported computed color space: ${space}`)
      } else if (!['rgb', 'rgba'].includes(name)) throw new Error(`Unsupported computed color function: ${name}`)
      const [channelText, alphaText] = body.split('/')
      const tokens = channelText!.replace(/,/g, ' ').trim().split(/\s+/)
      const legacyAlpha = !alphaText && tokens.length === 4 ? tokens.pop() : undefined
      if (tokens.length !== 3) throw new Error(`Expected three channels: ${value}`)
      const scale = space ? 1 : 255
      const channels = tokens.map(token => {
        const parsed = Number.parseFloat(token)
        if (!Number.isFinite(parsed)) throw new Error(`Invalid computed channel: ${token}`)
        return token.endsWith('%') ? parsed / 100 * scale : parsed
      })
      const alphaToken = alphaText?.trim() ?? legacyAlpha ?? '1'
      const alphaNumber = Number.parseFloat(alphaToken)
      if (!Number.isFinite(alphaNumber)) throw new Error(`Invalid computed alpha: ${alphaToken}`)
      const alpha = alphaToken.endsWith('%') ? alphaNumber / 100 : alphaNumber
      if (space === 'srgb-linear') {
        return [...channels.map(channel => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055) * 255), alpha] as Rgba
      }
      return [channels[0]! * (space ? 255 : 1), channels[1]! * (space ? 255 : 1), channels[2]! * (space ? 255 : 1), alpha]
    }
    const composite = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + back[3] * (1 - front[3])
      if (!alpha) return [0, 0, 0, 0]
      return [0, 1, 2].map(index => (front[index]! * front[3] + back[index]! * back[3] * (1 - front[3])) / alpha).concat(alpha) as Rgba
    }
    const backgroundFor = (element: Element) => {
      const ancestors: Element[] = []
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node)
      return ancestors.reduce<Rgba>((background, ancestor) => {
        const layer = parseColor(getComputedStyle(ancestor).backgroundColor)
        return layer[3] > 0 ? composite(layer, background) : background
      }, [255, 255, 255, 1])
    }
    const luminance = (color: Rgba) => {
      const channels = color.slice(0, 3).map(channel => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const label = [...button.querySelectorAll<HTMLElement>(':scope > span')].find(element => element.getClientRects().length) ?? button
    // `-webkit-text-fill-color` defaults to black even when the paint comes
    // from the inherited `color`, so only inspect the actual color contract.
    const foreground = getComputedStyle(label).color
    const background = backgroundFor(button)
    const renderedForeground = composite(parseColor(foreground), background)
    const [light, dark] = [luminance(renderedForeground), luminance(background)].sort((a, b) => b - a)
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
  const sortPanel = page.locator('.inventory-sort-composer__panel')
  await expect(sortPanel).toBeVisible()
  const panelBounds = await sortPanel.boundingBox()
  // Phone controls use display:contents to share the compact header grid;
  // their fixed sort sheet is contained by the viewport, not that boxless wrapper.
  const controlBounds = isMobile
    ? { x: 0, width: page.viewportSize()!.width }
    : await page.locator('.if-srp-controls').boundingBox()
  expect(panelBounds, 'Sort options have a visible layout').not.toBeNull()
  expect(controlBounds).not.toBeNull()
  expect(panelBounds!.width, 'Sort options have a readable width independent of the trigger').toBeGreaterThanOrEqual(Math.min(300, controlBounds!.width))
  expect(panelBounds!.x).toBeGreaterThanOrEqual(controlBounds!.x - 1)
  expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(controlBounds!.x + controlBounds!.width + 1)
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
  await capture(page, testInfo, 'inventory-multilevel-sort')
  await page.getByRole('button', { name: 'Close sort options', exact: true }).click()
  await expect(sortButton).toHaveAttribute('aria-expanded', 'false')

  await page.getByLabel('Rows per page').selectOption('100')
  await expect(page.getByLabel('Rows per page')).toHaveValue('100')
  await expect(rows).toHaveCount(8)
  await page.reload()
  await expect(page.getByLabel('Rows per page')).toHaveValue('100')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'inventory')
})

async function expandJoinedRecord(row: Locator) {
  const group = row.locator('xpath=..')
  const toggle = group.getByRole('button', { name: /^(?:Expand|Collapse) details for / })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const details = group.getByRole('region', { name: /^Additional details for / })
  await expect(details).toBeVisible()
  await expect.poll(() => details.evaluate(element => {
    const clip = element.parentElement!
    return clip.scrollHeight - clip.clientHeight
  }), { message: 'Complete joined evidence is revealed before measuring its facts' }).toBeLessThanOrEqual(1)
  return details
}

test('ordinary joined records keep readable facts and two useful vehicles in the first canonical viewport', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'The phone uses its dedicated vehicle list; desktop/tablet table is verified here.')
  await loadInventory(page)
  await page.getByRole('button', { name: /^All locations, \d+ group vehicles$/ }).click()
  await chooseInventoryView(page, 'all')
  await page.getByRole('button', { name: /^Sort inventory\./ }).click()
  const movementSort = page.getByRole('button', { name: 'Remove Last movement sort', exact: true })
  if (await movementSort.count()) await movementSort.click()
  await expect(page.getByRole('combobox', { name: 'Sort priority 1 field', exact: true })).toHaveValue('vehicle')
  await expect(page.getByRole('button', { name: 'Vehicle: change to descending', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close sort options', exact: true }).click()
  const row = page.locator('.inv-desk-table .inv-desk-row[data-stock-number="DEMO-F02"]')
  await expect(row).toBeVisible()
  await expect(row).toContainText('Maverick')
  await expect(row).toHaveAttribute('data-hold-state', 'clear')
  await expect(row.locator('xpath=..').getByRole('button', { name: /View change history/ })).toHaveCount(0)
  const measure = () => row.evaluate(row => {
    const selectors = ['.inv-desk-vehicle__title strong', '.inv-desk-price strong', '.inv-desk-hold > span:last-child']
    const text = selectors.map(selector => {
      const element = row.querySelector<HTMLElement>(selector)!
      const css = getComputedStyle(element)
      return { selector, size: parseFloat(css.fontSize), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }
    })
    return { text, rowHeight: row.getBoundingClientRect().height, vehicleGroupHeight: row.closest('tbody')!.getBoundingClientRect().height }
  })
  for (const { width, height } of [{ width: 1024, height: 768 }, { width: 1320, height: 820 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0) })
    const dimensions = await measure()
    await testInfo.attach(`ordinary-record-${width}`, { body: JSON.stringify({ width, height, ...dimensions }, null, 2), contentType: 'application/json' })
    for (const element of dimensions.text) {
      expect(element.size, `${width}px ordinary Maverick ${element.selector} remains readable`).toBeGreaterThanOrEqual(15)
      expect(element.scrollWidth, `${width}px ordinary Maverick ${element.selector} is not horizontally clipped`).toBeLessThanOrEqual(element.clientWidth + 1)
      expect(element.scrollHeight, `${width}px ordinary Maverick ${element.selector} is not vertically clipped`).toBeLessThanOrEqual(element.clientHeight + 1)
    }
    const groups = page.locator('.inv-desk-table > tbody')
    await expect(groups).toHaveCount(8)
    const second = groups.nth(1)
    if (width === 1440) {
      for (const group of [groups.nth(0), second]) {
        const box = (await group.boundingBox())!
        expect(box.y, 'Complete records start inside the viewport').toBeGreaterThanOrEqual(0)
        expect(box.y + box.height, 'Two complete ordinary vehicle records fit the first 1440px viewport').toBeLessThanOrEqual(height + 1)
      }
    } else {
      for (const fact of [
        second.getByRole('button', { name: /^Open vehicle details for/ }),
        second.locator('.inv-desk-price strong'),
        second.locator('[data-fact="location"]'),
        second.locator('[data-fact="hold"]'),
        second.locator('[data-fact="service"]'),
      ]) {
        await expect(fact).toBeVisible()
        const box = (await fact.boundingBox())!
        expect(box.y + box.height, `${width}px second vehicle identity, price, location, hold and service are in the first viewport`).toBeLessThanOrEqual(height + 1)
      }
    }
    const actions = row.locator('xpath=..').getByRole('group', { name: /^Actions for 2022 Ford Maverick/ })
    await expect(actions).toBeVisible()
    const targets = actions.locator('button, a')
    await expect(targets).toHaveCount(5)
    await expect(actions.getByRole('button', { name: /^Expand details for 2022 Ford Maverick/ })).toBeVisible()
    await expect(actions.getByRole('button', { name: /^Open vehicle records for 2022 Ford Maverick/ })).toBeVisible()
    await expect(actions.getByRole('button', { name: /^Save DEMO-F02 to shortlist$/ })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Request to Howell 2022 Ford Maverick Lariat', exact: true })).toBeVisible()
    await expect(actions.getByRole('button', { name: /^(Open listing for|Listing unavailable for) 2022 Ford Maverick/ }).or(actions.getByRole('link', { name: /^Open listing for 2022 Ford Maverick/ }))).toBeVisible()
    const actionOrder = await actions.locator(':scope > .inv-desk-action').evaluateAll(elements => elements.map(element => element.getAttribute('data-row-action')))
    expect(actionOrder.slice(0, 3), `${width}px records, save, and listing stay together before operational actions`).toEqual(['records', 'shortlist', 'listing'])
    for (const target of await targets.all()) {
      const box = await target.boundingBox()
      expect(box!.height, `${width}px ordinary action height`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${width}px ordinary action width`).toBeGreaterThanOrEqual(44)
    }
    // Density is checked collapsed; configuration must remain fully readable
    // when the employee deliberately opens this vehicle's details.
    const details = await expandJoinedRecord(row)
    const powertrain = details.getByText('2.0L EcoBoost · AWD', { exact: true })
    await expect(powertrain).toBeVisible()
    const fact = await powertrain.evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
    expect(fact.size).toBeGreaterThanOrEqual(15)
    expect(fact.scrollWidth).toBeLessThanOrEqual(fact.clientWidth + 1)
    expect(fact.scrollHeight).toBeLessThanOrEqual(fact.clientHeight + 1)
    await actions.getByRole('button', { name: /^Collapse details for 2022 Ford Maverick/ }).click()
    await expect(actions.getByRole('button', { name: /^Expand details for 2022 Ford Maverick/ })).toHaveAttribute('aria-expanded', 'false')
    await expectNoOverflow(page)
  }
})

test('two primary columns keep complete vehicle evidence and direct actions in one joined record', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90_000)
  test.skip(isMobile, 'The phone uses its dedicated vehicle list; desktop/tablet table is verified here.')
  let includePriceChange = false
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    expect(payload.vehicles.every((vehicle: { vin: string }) => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    for (const vehicle of payload.vehicles) {
      if (includePriceChange) vehicle.changeSummary = 'Price changed'
      else delete vehicle.changeSummary
      vehicle.autoCheckReport = {
        dataState: 'current', score: 95, ownerCount: 1,
        url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic',
      }
      vehicle.windowSticker = {
        dataState: 'current', equipmentGroup: '302A',
        options: ['CLASS IV TRAILER TOW PACKAGE WITH PRO TRAILER BACKUP ASSIST AND INTEGRATED TRAILER BRAKE CONTROLLER', 'FX4 OFF-ROAD PACKAGE', 'EQUIPMENT GROUP 302A'],
        url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U',
      }
      vehicle.imageUrl = '/brand-kit/inventory-flow-primary-1600.png'
      vehicle.imageUrls = [vehicle.imageUrl]
      vehicle.photoCount = 18
    }
    await route.fulfill({ response, json: payload })
  })
  await page.goto('/inventory')
  await chooseInventoryView(page, 'all')
  // Assert against the rich-record fixture, independent of default price sorting.
  const main = page.locator('.inv-desk-table .inv-desk-row[data-stock-number="DEMO-H01"]')
  const richMaverick = page.locator('.inv-desk-table .inv-desk-row[data-stock-number="DEMO-F02"]')
  // Each vehicle has two native decision cells, joined source evidence, then direct actions.
  const headers = page.locator('.inv-desk-table thead th')
  await expect(headers).toHaveCount(2)
  const headerContracts = [
    'Vehicle', 'Operations',
  ]
  for (const name of headerContracts) {
    const header = page.getByRole('columnheader', { name, exact: true })
    await expect(header).toBeAttached()
    await expect(header).toHaveAttribute('scope', 'col')
  }
  await expect(headers.locator('button, a, select, input, [tabindex="0"]')).toHaveCount(0)
  // Ordinary density has a separate canonical viewport contract. This rich
  // fixture must retain complete source evidence and 44px controls as it grows.
  await expect(main.locator(':scope > td')).toHaveCount(2)
  await expect(main.locator(':scope > td').nth(0)).toHaveAttribute('data-column', 'vehicle')
  await expect(main.locator(':scope > td').nth(1)).toHaveAttribute('data-column', 'status')
  const vehicleRows = main.locator('xpath=..')
  const evidence = vehicleRows.locator(':scope > tr.inv-desk-evidence')
  const footer = vehicleRows.locator(':scope > tr.inv-desk-footer')
  await expect(vehicleRows.locator(':scope > tr')).toHaveCount(3)
  await expect(evidence.locator(':scope > td')).toHaveCount(1)
  await expect(evidence.locator(':scope > td')).toHaveAttribute('colspan', '2')
  await expect(footer.locator(':scope > td')).toHaveCount(1)
  await expect(footer.locator(':scope > td')).toHaveAttribute('colspan', '2')
  await expect(main.locator('[data-column="vehicle"]')).toBeVisible()
  await expect(vehicleRows.getByRole('button', { name: /^Expand details for / })).toHaveAttribute('aria-expanded', 'false')
  await expect(evidence.getByRole('region', { name: /^History source evidence/ })).toHaveCount(0)
  await expandJoinedRecord(main)
  const historySource = evidence.getByRole('region', { name: /^History source evidence/ })
  const equipmentSource = evidence.getByRole('region', { name: /^Factory equipment source evidence/ })
  const oasisSource = evidence.getByRole('region', { name: /^OASIS source evidence/ })
  await expect(historySource).toBeVisible()
  await expect(equipmentSource).toBeVisible()
  await expect(oasisSource).toBeVisible()
  const actions = footer.getByRole('group', { name: /^Actions for / })
  await expect(actions).toBeVisible()
  await expect(actions.locator(':scope > .inv-desk-action').first()).toHaveAccessibleName(/Open vehicle records/)
  await expect(actions.locator(':scope > .inv-desk-action').nth(1)).toHaveAccessibleName(/Save DEMO-H01 to shortlist/)
  const footerActionOrder = await actions.locator(':scope > .inv-desk-action').evaluateAll(elements => elements.map(element => element.getAttribute('data-row-action')))
  expect(footerActionOrder.slice(0, 3), 'Records, Save, and Listing precede operational controls').toEqual(['records', 'shortlist', 'listing'])
  await expect(evidence.locator('.inv-desk-configuration__values > span').first()).toBeVisible()
  await expect(equipmentSource).toContainText('3 captured entries')
  await expect(evidence.getByRole('button', { name: /View all .* equipment items/ })).toContainText('Class IV Trailer tow package')
  await expect(historySource).toContainText('95')
  const vehicleCell = main.locator('[data-column="vehicle"]')
  await expect(vehicleCell.getByRole('button', { name: 'Copy stock number: DEMO-H01', exact: true })).toBeVisible()
  await expect(vehicleCell.getByRole('button', { name: 'Copy VIN: TESTDATAHWELL0001', exact: true })).toBeVisible()
  await expect(vehicleCell.getByRole('button', { name: /^Copy .*base MSRP:/ })).toBeVisible()
  await expect(vehicleCell.getByRole('button', { name: 'Copy mileage: 12450', exact: true })).toBeVisible()
  await expect(vehicleCell.getByRole('group', { name: 'Copy identifiers for 2024 Ford F-150 Lariat' })).toBeVisible()
  await expect(vehicleCell.getByLabel('Registration calculator values')).toBeVisible()
  await expect(vehicleRows).toContainText('TESTDATAHWELL0001')
  await expect(evidence.getByRole('group', { name: 'Configuration for 2024 Ford F-150 Lariat', exact: true })).toContainText('3.5L EcoBoost V6')
  // The identity band now labels the captured color explicitly.
  await expect(evidence.locator('.inv-desk-vehicle__comparison > span').filter({ hasText: 'Black' })).toHaveText('Blackinterior')
  await expect(main).toContainText('43 days listed')
  await expect(main.getByLabel('18 vehicle photos')).toBeAttached()
  // The joined native table also remains active at 1024px; these checkpoints
  // exercise its wider desktop layouts after the responsive transition.
  const showAllLocationsAndVehicles = async () => {
    await page.getByRole('button', { name: /^All locations, \d+ group vehicles$/ }).click()
    await chooseInventoryView(page, 'all')
  }
  for (const width of [1280, 1440, 1800]) {
    // First capture H01 without a change summary. The exact same record and
    // injected source evidence are then reloaded with its one 44px history band.
    includePriceChange = false
    await page.reload()
    await showAllLocationsAndVehicles()
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('heading', { name: 'All locations inventory' }).scrollIntoViewIfNeeded()
    await expandJoinedRecord(main)
    await expandJoinedRecord(richMaverick)
    await page.evaluate(async () => { await document.fonts.ready })
    await expect(vehicleRows.getByRole('button', { name: /View change history/ })).toHaveCount(0)
    const measure = (row = main) => row.evaluate(row => {
      const selectors = ['.inv-desk-vehicle__title strong', '.inv-desk-price strong', '.inv-desk-configuration__values > span', '.inv-desk-hold > span:last-child']
      const text = selectors.map(selector => {
        const element = row.closest('tbody')!.querySelector<HTMLElement>(selector)!
        const css = getComputedStyle(element)
        return {
          selector,
          size: parseFloat(css.fontSize),
          text: element.innerText,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }
      })
      const photo = row.querySelector<HTMLElement>('.inv-desk-vehicle__photo')!
      const image = row.querySelector<HTMLImageElement>('.inv-desk-vehicle__photo img')!
      const table = row.closest<HTMLElement>('.if-srp-table-wrap')!
      return {
        text,
        rowHeight: row.getBoundingClientRect().height,
        vehicleGroupHeight: row.closest('tbody')!.getBoundingClientRect().height,
        photo: photo.getBoundingClientRect().toJSON(),
        image: { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
        tableWidth: table.clientWidth,
      }
    })
    const heldBaselineDimensions = await measure(main)
    const maverickEquipment = richMaverick.locator('xpath=..').getByRole('button', { name: /View all .* equipment items/ })
    await expect(maverickEquipment).toContainText('Class IV Trailer tow package')
    const maverickEvidence = richMaverick.locator('xpath=..').locator(':scope > tr.inv-desk-evidence')
    await expect(maverickEvidence.getByRole('region', { name: /^History source evidence/ }).locator('a[href="https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic"]')).toHaveAttribute('target', '_blank')
    await expect(maverickEvidence.getByRole('region', { name: /^Factory equipment source evidence/ }).locator('a[href="https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U"]')).toHaveAttribute('target', '_blank')

    // A price-change signal adds exactly one 44px history control band.
    includePriceChange = true
    await page.reload()
    await showAllLocationsAndVehicles()
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('heading', { name: 'All locations inventory' }).scrollIntoViewIfNeeded()
    await expandJoinedRecord(main)
    await expandJoinedRecord(richMaverick)
    await page.evaluate(async () => { await document.fonts.ready })
    const dimensions = await measure()
    for (const group of [vehicleRows, richMaverick.locator('xpath=..')]) {
      const sourceFacts = await group.locator('.inventory-source-band .vehicle-resource-scan__fields dt, .inventory-source-band .vehicle-resource-scan__fields dd').evaluateAll(elements => elements.map(element => {
        const source = element.closest<HTMLElement>('.inventory-source-band__source')!.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(element)
        const css = getComputedStyle(element)
        return {
          text: element.textContent?.trim() ?? '', label: element.tagName === 'DT', size: parseFloat(css.fontSize),
          source: { left: source.left, right: source.right, top: source.top, bottom: source.bottom },
          fragments: [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
        }
      }))
      expect(sourceFacts.length).toBeGreaterThan(0)
      for (const fact of sourceFacts) {
        const date = /^\d{2}\/\d{2}\/\d{4}$/.test(fact.text)
        expect(fact.size, `${width}px source ${fact.label ? 'label' : 'value'} remains readable: ${fact.text}`).toBeGreaterThanOrEqual(fact.label || date ? 12 : 15)
        for (const fragment of fact.fragments) {
          expect(fragment.left, `${width}px source text stays within its provider: ${fact.text}`).toBeGreaterThanOrEqual(fact.source.left - 1)
          expect(fragment.right).toBeLessThanOrEqual(fact.source.right + 1)
          expect(fragment.top).toBeGreaterThanOrEqual(fact.source.top - 1)
          expect(fragment.bottom, `${width}px complete source text remains visible: ${fact.text}`).toBeLessThanOrEqual(fact.source.bottom + 1)
        }
        if (!fact.label && date && fact.fragments.length) {
          expect(Math.max(...fact.fragments.map(rect => rect.bottom)) - Math.min(...fact.fragments.map(rect => rect.top)), 'A complete source date stays on one line').toBeLessThanOrEqual(fact.size * 1.5)
        }
      }
    }
    const changeHistory = vehicleRows.getByRole('button', { name: 'View change history for 2024 Ford F-150 Lariat: Price changed', exact: true })
    await expect(changeHistory).toBeVisible()
    await expect(changeHistory).toHaveText('Price changed')
    await expect(changeHistory).toHaveAttribute('title', 'Price changed')
    const changeBounds = await changeHistory.boundingBox()
    expect(changeBounds!.height, `${width}px price-change control is a single 44px band`).toBeGreaterThanOrEqual(44)
    expect(changeBounds!.height, `${width}px price-change control does not add an oversized band`).toBeLessThanOrEqual(45)
    const groupGrowth = dimensions.vehicleGroupHeight - heldBaselineDimensions.vehicleGroupHeight
    expect(groupGrowth, `${width}px price-change does not shrink the held vehicle group`).toBeGreaterThanOrEqual(0)
    expect(groupGrowth, `${width}px price-change adds at most one band and its gap`).toBeLessThanOrEqual(46)
    for (const element of dimensions.text) {
      expect(element.size, `${width}px ${element.selector} readable type`).toBeGreaterThanOrEqual(15)
      // The scan intentionally wraps useful facts instead of hiding them
      // behind ellipses; neither axis may be clipped.
      expect(element.scrollWidth, `${width}px ${element.selector} not horizontally clipped`).toBeLessThanOrEqual(element.clientWidth + 1)
      expect(element.scrollHeight, `${width}px ${element.selector} not vertically clipped`).toBeLessThanOrEqual(element.clientHeight + 1)
    }
    expect(dimensions.rowHeight, `${width}px row keeps scroll density`).toBeGreaterThanOrEqual(84)
    // The adversarial 87-character option can grow naturally. Adding its
    // price-change control still costs at most one 44px band and a separator.
    expect(dimensions.vehicleGroupHeight, `${width}px changed held group stays within one 44px band of its baseline`).toBeLessThanOrEqual(heldBaselineDimensions.vehicleGroupHeight + 46)
    for (const name of ['Copy stock number: DEMO-H01', 'Copy mileage: 12450', 'Copy VIN: TESTDATAHWELL0001']) {
      await expect(main.locator('[data-column="vehicle"]').getByRole('button', { name, exact: true })).toBeVisible()
    }
    const actions = main.locator('xpath=following-sibling::tr[contains(@class,"inv-desk-footer")]').getByRole('group', { name: /^Actions for 2024 Ford F-150 Lariat$/ })
    await expect(actions.getByRole('button', { name: /Open vehicle records for 2024 Ford F-150/ })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Save DEMO-H01 to shortlist', exact: true })).toBeVisible()
    await expect(actions.getByRole('button', { name: /^(Open listing for|Listing unavailable for)/ }).or(actions.getByRole('link', { name: /Open listing for/ }))).toBeVisible()
    await expect(actions.getByRole('button', { name: /^(Request|Track)/ })).toBeVisible()
    const actionTargets = actions.locator('button, a')
    expect(await actionTargets.count()).toBeGreaterThan(0)
    for (const target of await actionTargets.all()) {
      await expect(target).toBeVisible()
      const box = await target.boundingBox()
      expect(box!.height, `${width}px action target height`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${width}px action target width`).toBeGreaterThanOrEqual(44)
    }
    expect(dimensions.photo.width, `${width}px photo preview remains useful`).toBeGreaterThanOrEqual(128)
    expect(dimensions.photo.height, `${width}px photo preview remains useful`).toBeGreaterThanOrEqual(85)
    // The supplied listing imagery is 3:2; keeping that native presentation
    // avoids needless crop/grain while the 128px-wide scan preview stays useful.
    expect(dimensions.photo.width / dimensions.photo.height).toBeCloseTo(3 / 2, 1)
    expect(dimensions.image.naturalWidth).toBeGreaterThan(dimensions.photo.width * 2)
    expect(dimensions.image.naturalHeight).toBeGreaterThan(dimensions.photo.height * 2)
    const equipment = vehicleRows.getByRole('button', { name: /View all .* equipment items/ })
    await expect(equipment).toBeVisible()
    await expect(equipment).toContainText('302A')
    await expect(equipment).toContainText(/\+\d+ more/)
    const region = await page.locator('.if-srp-table-wrap').evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }))
    expect(region.contentHeight).toBeLessThanOrEqual(region.height + 2)
    expect(region.contentWidth).toBeLessThanOrEqual(region.width + 2)
    await expectNoOverflow(page)
    await capture(page, testInfo, `table-width-${width}`)
  }
  const recordsTrigger = actions.getByRole('button', { name: /^Open vehicle records for/ })
  await recordsTrigger.click()
  await expect(page.getByRole('dialog', { name: /records$/i })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(recordsTrigger).toBeFocused()
  await vehicleRows.getByRole('button', { name: /View change history/ }).click()
  await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  const equipmentTrigger = vehicleRows.getByRole('button', { name: /View all .* equipment items/ })
  await expect(equipmentTrigger).toBeVisible()
  await equipmentTrigger.click()
  await expect(page.getByRole('tab', { name: 'Equipment', exact: true })).toHaveAttribute('aria-selected', 'true')
  // Table previews shorten equipment labels; the captured wording remains
  // complete when the employee opens the Equipment workspace.
  await expect(page.getByRole('dialog')).toContainText('CLASS IV TRAILER TOW PACKAGE WITH PRO TRAILER BACKUP ASSIST AND INTEGRATED TRAILER BRAKE CONTROLLER')
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(equipmentTrigger).toBeFocused()
  const holdTrigger = main.getByRole('button', { name: /Review DealerMail handoff|Open hold details/ })
  await holdTrigger.click()
  await expect(page.getByRole('tab', { name: 'Holds & moves', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close vehicle details' }).click()
  await expect(holdTrigger).toBeFocused()
})

test.describe('touch-capable desktop', () => {
  test.use({ hasTouch: true })

  test('a touchscreen keeps 44px row actions in the desktop table', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The phone uses its dedicated vehicle list; this covers a touch laptop or landscape tablet.')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/inventory')
    await chooseInventoryView(page, 'all')
    expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
    const main = page.locator('.inv-desk-table .inv-desk-row[data-stock-number="DEMO-H01"]')
    const actionTargets = main.locator('xpath=..').getByRole('group', { name: /^Actions for 2024 Ford F-150 Lariat$/ }).locator('button, a')
    expect(await actionTargets.count()).toBeGreaterThan(0)
    for (const target of await actionTargets.all()) {
      const box = await target.boundingBox()
      expect(box!.height, 'touch action target height').toBeGreaterThanOrEqual(44)
      expect(box!.width, 'touch action target width').toBeGreaterThanOrEqual(44)
    }
    await expectNoOverflow(page)
  })
})

test('phone cards show exact equipment and document facts with direct detail actions', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'This contract verifies the dedicated phone card at 320px and 390px.')
  const documentEvidence = {
    autoCheckReport: {
      dataState: 'current', score: 95, ownerCount: 2,
      url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic',
    },
    windowSticker: {
      dataState: 'current', equipmentGroup: 'Equipment Group 302A',
      totalMsrp: 59650, pricingCurrency: 'USD',
      options: ['FX4 Off-Road Package', 'Trailer Tow Package'],
      standardEquipment: ['LED Headlamps', 'Heated Front Seats'],
      url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U',
    },
    // This acceptance case exercises a captured official source. Do not let
    // the fixture's demo-vehicle image intentionally substitute the clearly
    // labelled demo sticker, which is covered independently by unit tests.
    imageUrl: '/brand-kit/inventory-flow-primary-1600.png',
    imageUrls: ['/brand-kit/inventory-flow-primary-1600.png'],
  }
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json()
    expect(payload.vehicles).toHaveLength(8)
    expect(payload.vehicles.every((vehicle: { vin: string }) => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const vehicle = payload.vehicles.find((item: { vin: string }) => item.vin === 'TESTDATAHWELL0001')
    expect(vehicle).toBeDefined()
    Object.assign(vehicle, documentEvidence)
    await route.fulfill({ response, json: payload })
  })
  // Opening a VDP intentionally replaces its list summary with the detail
  // response. Keep this one synthetic vehicle consistent at both read routes.
  await page.route('**/api/vehicles/TESTDATAHWELL0001', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const vehicle = await response.json()
    expect(vehicle.vin).toBe('TESTDATAHWELL0001')
    await route.fulfill({ response, json: { ...vehicle, ...documentEvidence } })
  })
  await loadInventory(page)
  // Anchor this mid-list fixture to its exact identity control; first-card
  // placement and above-dock actions are covered by the whole-fixture probe.
  const detailsTrigger = page.getByRole('button', { name: /Open details for 2024 Ford F-150 Lariat, stock DEMO-H01, VIN TESTDATAHWELL0001/ })
  const card = detailsTrigger.locator('xpath=ancestor::article[contains(@class, "if-srp-mobile-row")]')
  const originalMsrp = card.locator('.inventory-mobile-row__factory-pricing')
  const identifiers = card.getByRole('group', { name: 'Copy identifiers for 2024 Ford F-150 Lariat' })
  const operationalSignals = card.getByLabel('Operational vehicle signals')
  const workflowActions = card.getByRole('group', { name: 'Actions for 2024 Ford F-150 Lariat' })
  const registrationFacts = card.getByLabel('Registration calculator values')
  const reportShortcuts = card.getByLabel('Source evidence for 2024 Ford F-150 Lariat', { exact: true })
  const expandedRecords = page.getByRole('dialog', {name:'2024 Ford F-150 Lariat records',exact:true})
  const history = expandedRecords.locator('[data-resource-kind="autocheck"]')
  const sticker = expandedRecords.locator('[data-resource-kind="window-sticker"]')
  const recordsTrigger = card.getByRole('button', { name: /Open vehicle records for 2024 Ford F-150/ })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0) })
    await expect(card).toBeVisible()
    const expansion = card.getByRole('button', { name: /^(?:Expand|Collapse) details for 2024 Ford F-150 Lariat$/ })
    if (await expansion.getAttribute('aria-expanded') === 'true') await expansion.click()
    await expect(expansion).toHaveAttribute('aria-expanded', 'false')
    await expect(reportShortcuts).toBeHidden()
    await expansion.click()
    await expect(expansion).toHaveAttribute('aria-expanded', 'true')
    const additionalDetails = card.getByRole('region', { name: 'Additional details for 2024 Ford F-150 Lariat', exact: true })
    await expect(additionalDetails).toBeVisible()
    await expect.poll(() => additionalDetails.evaluate(element => {
      const clip = element.parentElement!
      return clip.scrollHeight - clip.clientHeight
    }), { message: 'Expanded details finish revealing their complete contents' }).toBeLessThanOrEqual(1)
    // Complete record ledgers stay in Records; the joined source summaries
    // remain after status and workflow controls in the same vehicle record.
    await expect(reportShortcuts.getByRole('region')).toHaveCount(3)
    await expect(card.locator('.vehicle-resource-summary')).toHaveCount(0)
    await expect(originalMsrp).toBeVisible()
    for (const [first, next] of [
      [detailsTrigger, originalMsrp],
      [originalMsrp, identifiers],
      [identifiers, registrationFacts],
      [registrationFacts, operationalSignals],
      [operationalSignals, workflowActions],
      [workflowActions, reportShortcuts],
    ]) {
      const follows = await first.evaluate((element, following) => Boolean(element.compareDocumentPosition(following as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await next.elementHandle())
      expect(follows, `${width}px phone card keeps factory pricing, identifiers, calculator facts, status, actions, and sources in reading order`).toBe(true)
    }
    const copyTargets = [
      card.getByRole('button', { name: 'Copy stock number: DEMO-H01', exact: true }),
      card.getByRole('button', { name: 'Copy VIN: TESTDATAHWELL0001', exact: true }),
      card.getByRole('button', { name: /^Copy .*base MSRP:/ }),
      card.getByRole('button', { name: /^Copy mileage:/ }),
    ]
    for (const target of copyTargets) {
      await expect(target).toBeVisible()
      const box = await target.boundingBox()
      expect(box!.height, `${width}px copy control has a 44px touch target`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${width}px copy control has a 44px touch target`).toBeGreaterThanOrEqual(44)
    }
    const actionControls = workflowActions.locator(':scope > button, :scope > a')
    await expect(actionControls).toHaveCount(5)
    const actionBoxes = await Promise.all((await actionControls.all()).map(async target => {
      await expect(target).toBeVisible()
      const box = await target.boundingBox()
      expect(box!.height, `${width}px workflow action has a 44px touch target`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${width}px workflow action has a 44px touch target`).toBeGreaterThanOrEqual(44)
      return box!
    }))
    expect(Math.abs(actionBoxes[0].y - actionBoxes[1].y), `${width}px first workflow row is aligned`).toBeLessThanOrEqual(2)
    expect(Math.abs(actionBoxes[2].y - actionBoxes[3].y), `${width}px second workflow row is aligned`).toBeLessThanOrEqual(2)
    expect(Math.abs(actionBoxes[3].y - actionBoxes[4].y), `${width}px Details aligns with Save and Listing`).toBeLessThanOrEqual(2)
    expect(actionBoxes[0].x).toBeLessThan(actionBoxes[1].x)
    expect(actionBoxes[2].x).toBeLessThan(actionBoxes[3].x)
    expect(actionBoxes[3].x).toBeLessThan(actionBoxes[4].x)
    expect(actionBoxes[0].y).toBeLessThan(actionBoxes[2].y)
    const clipping = await card.evaluate(element => {
      const nodes = Array.from(element.querySelectorAll<HTMLElement>('*'))
        .filter(node => {
          if (!node.getClientRects().length || ['IMG', 'SVG'].includes(node.tagName)) return false
          if (node.matches('.copyable-value__button-label, .inventory-sr-only')) return false
          const style = getComputedStyle(node)
          const bounds = node.getBoundingClientRect()
          const clippedOnePixelLabel = bounds.width <= 1 && bounds.height <= 1 && (style.clip !== 'auto' || style.clipPath !== 'none')
          return !clippedOnePixelLabel
        })
      return nodes.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        .map(node => ({ className: node.className, text: node.innerText?.slice(0, 80), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }))
    })
    expect(clipping, `${width}px phone content has no clipped descendants`).toEqual([])
    await recordsTrigger.click()
    await expect(expandedRecords).toBeVisible()
    // Only the selected source occupies the full-width preview pane.
    for (const source of ['history', 'equipment'] as const) {
      await expandedRecords.getByRole('button', { name: `Expand ${source} details`, exact: true }).click()
      if (source === 'history') {
        await expect(history.locator('.vehicle-resource-summary__fields > .is-score')).toContainText('95')
        await expect(history).toContainText('2 owners')
        await expect(history.getByRole('link', { name: /Open AutoCheck history for VIN TESTDATAHWELL0001/ })).toHaveAttribute('target', '_blank')
      } else {
        await expect(sticker).toContainText('$59,650')
        await expect(sticker).toContainText('Equipment Group 302A')
        await expect(sticker.getByRole('link', { name: /Open sticker for VIN TESTDATAHWELL0001/ })).toHaveAttribute('target', '_blank')
      }
      const visibleFacts = expandedRecords.locator('.vehicle-resource-summary__body:visible')
      await expect(visibleFacts).toHaveCount(1)
      const fields = await visibleFacts.evaluateAll(elements => elements.map(element => ({
        width: element.clientWidth, scrollWidth: element.scrollWidth,
        height: element.clientHeight, scrollHeight: element.scrollHeight,
        size: parseFloat(getComputedStyle(element).fontSize),
      })))
      for (const field of fields) {
        expect(field.size, `${width}px equipment and document facts stay readable`).toBeGreaterThanOrEqual(12)
        expect(field.width, `${width}px facts have usable line width`).toBeGreaterThan(120)
        expect(field.scrollWidth).toBeLessThanOrEqual(field.width + 1)
        expect(field.scrollHeight).toBeLessThanOrEqual(field.height + 1)
      }
    }
    await expectNoOverflow(page)
    await capture(page, testInfo, `phone-document-rich-${width}`)

    await expandedRecords.getByRole('button', {name:'Close records',exact:true}).click()
    await expect(recordsTrigger).toBeFocused()
    await detailsTrigger.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: 'Equipment', exact: true }).click()
    await expect(dialog.getByRole('tab', { name: 'Equipment', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('tabpanel', { name: 'Equipment', exact: true })).toContainText('Trailer Tow Package')
    await expectNoOverflow(page)
    await dialog.getByRole('button', { name: 'Close vehicle details' }).click()
    await expect(detailsTrigger).toBeFocused()

    await recordsTrigger.click()
    await expandedRecords.getByRole('button', { name: 'Full vehicle', exact: true }).click()
    await expect(dialog.getByRole('tab', { name: 'Records', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('tabpanel', { name: 'Records', exact: true })).toContainText('AutoCheck vehicle history')
    await expectNoOverflow(page)
    await dialog.getByRole('button', { name: 'Close vehicle details' }).click()
    await expect(recordsTrigger).toBeFocused()
  }
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
  await chooseInventoryView(page, 'all')
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
    const dimensions = await page.locator('.if-srp-table-wrap').evaluate(element => ({
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
  // This deliberately exercises every workspace pane and four responsive
  // widths with visual evidence. Windows WebKit can take longer than the
  // suite-wide 45s allowance while its screenshots settle; retain every UI
  // assertion and give this one end-to-end flow a realistic budget.
  test.setTimeout(90_000)
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
    const selectors = ['', '.vdp-focus-header', '.vdp-focus-navigation', '.vdp-focus-scroll', '.inventory-workspace-panel--overview', '.inventory-workspace-panel__body']
    return selectors.map(selector => {
      const element = selector ? root.querySelector(selector)! : root
      const css = getComputedStyle(element)
      return { selector, rect: element.getBoundingClientRect().toJSON(), padding: css.padding, margin: css.margin, border: css.border, gap: css.gap, inset: css.inset, maxWidth: css.maxWidth, blue: css.getPropertyValue('--v10-blue'), info: css.getPropertyValue('--ifx-info') }
    })
  })
  await testInfo.attach('VDP computed layout', { body: JSON.stringify(layoutEvidence, null, 2), contentType: 'application/json' })
  await expect(dialog.getByRole('tab')).toHaveText(['Overview', 'Equipment', 'Records', 'Holds & moves', 'Activity', 'Issues'])
  const metrics = dialog.locator('.vdp-focus-specs')
  await expect(metrics).toContainText('12,450 mi')
  const header = dialog.locator('.vdp-focus-header')
  const navigation = dialog.locator('.vdp-focus-navigation')
  const headerBox = await header.boundingBox()
  const navigationBox = await navigation.boundingBox()
  expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1)
  await expect(dialog.getByRole('toolbar', { name: 'Vehicle actions' })).toBeVisible()
  const status = dialog.getByRole('region', { name: 'Vehicle operational summary' })
  await expect(status).toContainText('Location')
  // Overview presents one detailed service link in its operational summary;
  // other tabs retain that link beside the persistent identifier controls.
  const serviceLink = dialog.getByRole('link', {
    name: /^Service: (?:Ready|Waiting for service)$/,
  })
  await expect(serviceLink).toHaveCount(1)
  await expect(serviceLink).toBeVisible()
  await expect(serviceLink).toHaveAttribute('href', /\/service\?vin=TESTDATAHWELL0001(?:&|$)/)
  const statusOverflow = await status.evaluate(element => [...element.querySelectorAll<HTMLElement>('button,a')].map(control => ({
    clientHeight: control.clientHeight, scrollHeight: control.scrollHeight,
    clientWidth: control.clientWidth, scrollWidth: control.scrollWidth,
  })))
  for (const box of statusOverflow) {
    expect(box.scrollHeight, 'Status text is not vertically clipped').toBeLessThanOrEqual(box.clientHeight + 1)
    expect(box.scrollWidth, 'Status text stays inside its column').toBeLessThanOrEqual(box.clientWidth + 1)
  }
  await expect(dialog.getByRole('region', { name: /Photos of 2024 Ford F-150/ })).toBeVisible()
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-overview')

  await dialog.getByRole('tab', { name: 'Holds & moves' }).click()
  const holdPanel = dialog.getByRole('tabpanel', { name: 'Holds & moves' })
  await expect(holdPanel).toBeVisible()
  await expect(serviceLink).toBeVisible()
  await expect(dialog.locator('.inventory-workspace-gallery')).toBeHidden()
  await expect(holdPanel).toContainText('Demo Salesperson')
  await expect(holdPanel).toContainText('Backup Demo Salesperson')
  await capture(page, testInfo, 'vehicle-hold')
  const handoff = holdPanel.getByRole('region', { name: 'DealerMail vehicle tools' })
  const launch = handoff.getByRole('button', { name: 'Open in DealerMail (copies stock)' })
  await launch.scrollIntoViewIfNeeded()
  await expect(launch).toBeVisible()
  await expect(launch).toBeEnabled()
  const handoffLayout = await handoff.evaluate(panel => {
    const heading = panel.querySelector<HTMLElement>('h3')!
    const launch = panel.querySelector<HTMLElement>('.inventory-dealermail-handoff__launch')!
    const panelBox = panel.getBoundingClientRect()
    const headingBox = heading.getBoundingClientRect()
    const guidanceBox = panel.querySelector('header')!.getBoundingClientRect()
    const launchBox = launch.getBoundingClientRect()
    const style = getComputedStyle(panel)
    return {
      borderTop: parseFloat(style.borderTopWidth),
      paddingTop: parseFloat(style.paddingTop),
      headingOffset: headingBox.top - panelBox.top,
      actionClearance: Math.max(launchBox.top - guidanceBox.bottom, guidanceBox.top - launchBox.bottom, launchBox.left - guidanceBox.right, guidanceBox.left - launchBox.right),
      targetWidth: launchBox.width, targetHeight: launchBox.height,
    }
  })
  // The current VDP intentionally uses a borderless handoff rail. If a card
  // border returns, it needs breathing room; either variant must keep the
  // heading and primary action visually distinct.
  if (handoffLayout.borderTop >= 1) expect(handoffLayout.paddingTop, 'Bordered handoff clears its heading').toBeGreaterThanOrEqual(14)
  else expect(handoffLayout.headingOffset, 'Borderless handoff begins within its rail').toBeGreaterThanOrEqual(0)
  // Desktop places the action beside guidance; phones stack it underneath.
  expect(handoffLayout.actionClearance, 'Handoff action does not overlap heading or guidance').toBeGreaterThanOrEqual(0)
  expect(handoffLayout.targetWidth).toBeGreaterThanOrEqual(44)
  expect(handoffLayout.targetHeight).toBeGreaterThanOrEqual(44)
  const launchContrast = await launch.evaluate(button => {
    const style = getComputedStyle(button)
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
  })
  expect(launchContrast, 'DealerMail handoff button label contrast').toBeGreaterThanOrEqual(4.5)
  const identifiers = await handoff.locator('dd').evaluateAll(elements => elements.map(element => {
    const { left, right } = element.getBoundingClientRect()
    return { left, right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
  }))
  // Each identifier must fit its responsive column; desktop places these side by side.
  for (const identifier of identifiers) expect(identifier.scrollWidth).toBeLessThanOrEqual(identifier.clientWidth + 1)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'dealermail-handoff')

  await expect(holdPanel.locator('#inventory-section-movement')).toContainText('Howell')
  await expect(holdPanel.getByRole('button', { name: 'Track movement', exact: true })).toBeEnabled()
  await dialog.getByRole('tab', { name: 'Equipment' }).click()
  const equipment = dialog.getByRole('tabpanel', { name: 'Equipment' })
  await expect(equipment).toBeVisible()
  await expect(serviceLink).toBeVisible()
  await expect(dialog.locator('.inventory-workspace-gallery')).toBeHidden()
  const equipmentBox = await equipment.boundingBox()
  const currentNavigationBox = await navigation.boundingBox()
  expect(equipmentBox!.y - currentNavigationBox!.y - currentNavigationBox!.height, 'Equipment starts immediately below navigation').toBeLessThanOrEqual(26)
  await expect(equipment).toContainText('Equipment & packages')
  const equipmentItems = equipment.locator('.inventory-workspace-equipment-group > ul > li')
  const totalItems = await equipmentItems.count()
  expect(totalItems).toBeGreaterThan(0)
  // Categories of five or fewer are already complete; expand only categories
  // with additional captured items, then verify the whole ledger is visible.
  for (const showAll of await equipment.getByRole('button', { name: /Show all \d+ items/ }).all()) {
    const listId = await showAll.getAttribute('aria-controls')
    expect(listId).toBeTruthy()
    const categoryItems = equipment.locator(`[id="${listId}"] li`)
    expect(await categoryItems.count()).toBeGreaterThan(await categoryItems.filter({ visible: true }).count())
    await showAll.click()
  }
  await expect(equipmentItems.filter({ visible: true })).toHaveCount(totalItems)
  const equipmentSearch = equipment.getByRole('searchbox', { name: 'Search equipment, packages, or codes' })
  await equipmentSearch.fill('Max Trailer Tow')
  await expect(equipmentItems).toHaveCount(1)
  await expect(equipmentItems).toContainText('Max Trailer Tow Package')
  await equipment.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(equipmentItems).toHaveCount(totalItems)
  await expect(equipment).toContainText('Max Trailer Tow Package')
  for (const icon of await equipment.locator('.inventory-workspace-equipment-group > ul > li > svg').all()) await expect(icon).toHaveAttribute('aria-hidden', 'true')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-equipment')

  await dialog.getByRole('tab', { name: 'Records' }).click()
  const records = dialog.getByRole('tabpanel', { name: 'Records' })
  await expect(records).toBeVisible()
  await expect(serviceLink).toBeVisible()
  const sourceDetails = records.locator('.vdp-record-source-details').filter({ has: page.locator('summary', { hasText: /^Source details$/ }) }).first()
  await expect(sourceDetails).not.toHaveAttribute('open')
  await expect(records.getByRole('region', { name: 'Vehicle documents', exact: true })).toBeVisible()
  const technicalSummary = sourceDetails.locator('summary')
  await dialog.getByRole('button', { name: 'Close vehicle details' }).focus()
  let reachedTechnical = false
  for (let step = 0; step < 70; step += 1) {
    await page.keyboard.press('Tab')
    reachedTechnical = await technicalSummary.evaluate(element => element === document.activeElement)
    if (reachedTechnical) break
  }
  expect(reachedTechnical, 'Keyboard can reach source details without escaping the dialog').toBe(true)
  await page.keyboard.press('Enter')
  await expect(sourceDetails).toHaveAttribute('open')
  await page.keyboard.press('Enter')
  await expect(sourceDetails).not.toHaveAttribute('open')
  await dialog.getByRole('tab', { name: 'Records' }).click()
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-records')
  const autoCheckSource = records.getByRole('link', { name: /Open AutoCheck report/ })
  if (await autoCheckSource.count()) {
    await expect(autoCheckSource).toHaveAttribute('target', '_blank')
  } else {
    // Captured facts remain useful when an adapter did not retain the original
    // provider URL. The VDP must state that boundary rather than inventing a
    // destination; source-link behavior is covered with a URL-bearing fixture.
    await expect(records.getByRole('status', { name: 'AutoCheck report unavailable', exact: true })).toBeVisible()
    await expect(records.locator('[data-document-kind="autocheck"]')).toHaveAttribute('data-link-state', 'unavailable')
  }

  const originalViewport = page.viewportSize()!
  for (const width of [360, 700, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await dialog.getByRole('tab', { name: 'Equipment' }).click()
    const frame = await dialog.boundingBox()
    // Measure the visible navigation frame independently of its scrollable tab rail.
    const navigationFrame = await dialog.locator('.vdp-focus-navigation').boundingBox()
    const panel = await equipment.boundingBox()
    expect(frame!.y + frame!.height).toBeLessThanOrEqual(901)
    expect(frame!.y).toBeGreaterThanOrEqual(0)
    expect(navigationFrame, 'Visible workspace navigation frame').not.toBeNull()
    expect(panel!.y - navigationFrame!.y - navigationFrame!.height).toBeLessThanOrEqual(26)
    expect(navigationFrame!.y + navigationFrame!.height, 'Header leaves usable content space').toBeLessThan(410)
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
  const queue = page.getByRole('complementary', { name: 'Vehicle moves' })
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
  await expect(page.locator('#transfer-detail-workspace')).toBeVisible()
  await expect(page.locator('#transfer-detail-workspace')).toContainText('DEMO-H01')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'vehicle-move-detail')
  // WebKit reports a page-unload cancellation as an access-control console
  // error. Wait for the same-origin detail fetch instead of navigating away
  // while it is still in flight; this also proves the detail rendered from
  // the authoritative endpoint rather than only the bootstrap fallback.
  await settleApi(page)
  await page.goto('/transfers')
  await page.getByRole('button', { name: 'Start a vehicle move', exact: true }).click()
  await expect(page).toHaveURL(/\/transfers\/new/)
  await expect(page.getByRole('heading', { name: 'Start a move', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Search inventory to move' })).toBeVisible()
  await expectNoOverflow(page)
})

test('action center opens the exact task and inventory updates have their own page', async ({ page }, testInfo) => {
  // This flow captures three settled, data-rich workspaces. Windows WebKit
  // completes the workflow but can spend the suite-wide 45 seconds in the
  // final screenshot encoder, so retain every assertion with a realistic
  // per-test budget rather than weakening the health or visual checks.
  test.setTimeout(90_000)
  await page.goto('/attention')
  await expect(page.getByRole('heading', { name: 'Action center', exact: true })).toBeVisible()
  const scope = page.getByRole('group', { name: 'Queue location scope' })
  await expect(scope.getByRole('button', { name: 'Howell' })).toHaveAttribute('aria-pressed', 'true')
  await scope.getByRole('button', { name: 'All stores' }).click()
  await expect(scope.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
  const items = page.getByRole('list', { name: 'Attention items' }).getByRole('listitem')
  expect(await items.count()).toBeGreaterThan(0)
  await page.getByRole('combobox', { name: 'Search work queue' }).fill('missing-alert*?~|')
  await expect(items).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear queue search' }).click()
  expect(await items.count()).toBeGreaterThan(0)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'attention')
  const row = items.first()
  // A task can include source-resource links in addition to its one primary
  // workflow link. Scope this assertion to the task action itself.
  await expect(row.locator('a.workflow-action')).toHaveCount(1)
  // A row collapses one vehicle's conditions, and each condition keeps its own
  // follow-up disclosure. Record against the leading condition's disclosure.
  const followUp = row.locator('details.action-follow-up').first()
  await followUp.locator('summary').click()
  await expect(followUp.getByLabel('Work note')).toBeVisible()
  await followUp.getByLabel('Work note').fill('Synthetic task review for browser validation')
  await followUp.getByRole('button', { name: 'Save follow-up' }).click()
  await expect(followUp.getByRole('status')).toHaveText('Follow-up saved.')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'attention-follow-up')
  await settleApi(page)
  await page.goto('/updates?view=price')
  await expect(page.getByRole('heading', { name: 'Inventory updates', exact: true })).toBeVisible()
  const updateTypes = page.getByRole('group', { name: 'Inventory update type' })
  await expect(updateTypes.getByRole('button', { name: /^Price changes/ })).toHaveAttribute('aria-pressed', 'true')
  await updateTypes.getByRole('button', { name: /^New arrivals/ }).click()
  await expect(page).toHaveURL(/view=new/)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'inventory-updates')
})

test('simple moves use one manager decision and physical location updates through return home', async ({ page }, testInfo) => {
  // This end-to-end move captures four settled states and crosses stores twice.
  // Windows WebKit can exceed the suite-wide 45 seconds while encoding those
  // screenshots, so preserve the complete workflow with a realistic budget.
  test.setTimeout(90_000)
  // This config starts an isolated in-memory demo, never the production app.
  const headers = { 'x-inventory-demo-role': 'manager', 'x-inventory-demo-store': 'Howell', 'x-inventory-demo-user': 'Synthetic acceptance manager' }
  const response = await page.request.post('/api/transfers', {
    headers,
    data: { vin: 'TESTDATAFWELL0002', neededBy: '2026-08-31T16:00:00Z', returnDueAt: '2026-09-01T16:00:00Z', reason: 'Synthetic browser workflow test', returnRequired: true },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const created = await response.json()
  await page.goto(`/transfers?id=${created.id}`)
  const tracker = page.locator('.simple-transfer-tracker')
  await expect(tracker).toBeVisible()
  await expect(tracker.getByRole('region', { name: 'Next step' })).toHaveCount(1)
  await expect(tracker.getByRole('button', { name: /driver|dispatch|release|close request|close the move/i })).toHaveCount(0)
  await expect(tracker.getByRole('region', { name: 'Vehicle location and time away' })).toContainText('At home store')
  await tracker.getByRole('button', { name: 'Approve this move', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('textbox', { name: /driver|home.store manager/i })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Approve this move', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Confirm you checked')
  await dialog.getByRole('checkbox', { name: /I checked with Fowlerville/ }).check()
  await expectNoOverflow(page)
  await capture(page, testInfo, 'simple-approval')
  await dialog.getByRole('button', { name: 'Approve this move', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  // Approval confirms availability, not physical arrival. Recording a showing
  // confirms the vehicle is now at the requesting store in the simple workflow.
  await expect(tracker.getByRole('button', { name: /Mark vehicle collected|Mark arrived/ })).toHaveCount(0)
  await expect(tracker.getByRole('region', { name: 'Vehicle location and time away' })).toContainText('Fowlerville')
  await tracker.getByRole('button', { name: 'Update the showing outcome', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: /Showing in progress/ }).check()
  await dialog.getByRole('button', { name: 'Record update', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(tracker.getByRole('region', { name: 'Vehicle location and time away' })).toContainText('Howell')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'simple-arrived')

  // Staff at the owning store can find their away inventory without opening a private move.
  await switchLocationAndSettle(page, 'Fowlerville')
  await page.goto('/transfers')
  await page.getByText('Browse vehicle locations', { exact: true }).click()
  await page.getByRole('button', { name: /^Home inventory away / }).click()
  const locations = page.getByRole('region', { name: 'Home inventory away', exact: true })
  await locations.getByLabel('Search inventory locations').fill('TESTDATAFWELL0002')
  await expect(locations.locator('tbody tr')).toHaveCount(1)
  await expect(locations.locator('tbody tr')).toContainText('Howell')
  await expectNoOverflow(page)
  await capture(page, testInfo, 'home-inventory-away')
  await locations.getByRole('button', { name: 'Close locations' }).click()
  await switchLocationAndSettle(page, 'Howell')
  await page.goto(`/transfers?id=${created.id}`)
  const nextStep = tracker.getByRole('region', { name: 'Next step' })
  await expect(nextStep.getByRole('button', { name: 'Start return', exact: true })).toBeVisible()
  await expect(tracker.getByText('Other options', { exact: true })).toHaveCount(0)
  await tracker.getByRole('button', { name: 'Start return', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start return', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(tracker.getByRole('region', { name: 'Vehicle location and time away' })).toContainText('In transit')
  await expect(tracker.getByRole('button', { name: 'Confirm back home', exact: true })).toHaveCount(0)
  await switchLocationAndSettle(page, 'Fowlerville')
  await expect(tracker.getByRole('region', { name: 'Next step' }).getByRole('button', { name: 'Confirm back home', exact: true })).toBeVisible()
  await tracker.getByRole('button', { name: 'Confirm back home', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm back home', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(tracker).toContainText('Back home · move complete')
  await expect(tracker.getByRole('button', { name: /close|driver|dispatch/i })).toHaveCount(0)
  await expectNoOverflow(page)
  await capture(page, testInfo, 'simple-back-home')
})

test('service deep link keeps vehicle identity above current status and source history at every canonical viewport', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'manager')
    localStorage.setItem('maxey-home-store', 'Lincoln')
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1320, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/service?vin=TESTDATALNCN00002&returnTo=%2Foverview')

    const summary = page.getByRole('region', { name: 'Vehicle summary', exact: true })
    const configuration = summary.getByLabel('Vehicle configuration', { exact: true })
    const identification = summary.getByLabel('Vehicle identification', { exact: true })
    const status = page.getByRole('region', { name: 'Recorded service status', exact: true })
    const sourceRecords = page.getByRole('region', { name: 'Vehicle service records', exact: true })
    const actions = page.getByRole('group', { name: 'Service actions', exact: true })

    await expect(summary).toHaveCount(1)
    await expect(summary).toBeVisible()
    await expect(summary.getByRole('heading', { name: '2022 Lincoln Corsair Grand Touring', exact: true })).toBeVisible()
    await expect(summary.getByRole('button', { name: /^Open photo gallery for 2022 Lincoln Corsair Grand Touring$/ })).toBeVisible()
    await expect(configuration).toContainText('2.5L Plug-In Hybrid')
    await expect(configuration).toContainText('AWD')
    await expect(identification).toContainText('DEMO-L02')
    await expect(identification).toContainText('TESTDATALNCN00002')
    await expect(status).toContainText('Waiting for service')
    await expect(sourceRecords).toContainText('8 service visits reported')
    await expect(sourceRecords).toContainText('Used-car inspection')
    await expect(actions).toBeVisible()

    const summaryBounds = (await summary.boundingBox())!
    const statusBounds = (await status.boundingBox())!
    const historyBounds = (await sourceRecords.boundingBox())!
    expect(summaryBounds.x).toBeGreaterThanOrEqual(0)
    expect(summaryBounds.x + summaryBounds.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(summaryBounds.y).toBeGreaterThanOrEqual(0)
    expect(summaryBounds.y + summaryBounds.height).toBeLessThanOrEqual(viewport.height)
    expect(summaryBounds.y + summaryBounds.height).toBeLessThanOrEqual(statusBounds.y)
    expect(summaryBounds.y + summaryBounds.height).toBeLessThanOrEqual(historyBounds.y)
    for (const identityArea of [summary, configuration, identification]) {
      const overflow = await identityArea.evaluate(element => ({
        horizontal: element.scrollWidth - element.clientWidth,
        vertical: element.scrollHeight - element.clientHeight,
      }))
      expect(overflow.horizontal, 'vehicle identity horizontal clipping').toBeLessThanOrEqual(1)
      expect(overflow.vertical, 'vehicle identity vertical clipping').toBeLessThanOrEqual(1)
    }

    for (const action of await actions.getByRole('button').all()) {
      const bounds = (await action.boundingBox())!
      expect(bounds.height, 'active service action touch target height').toBeGreaterThanOrEqual(44)
      expect(bounds.width, 'active service action touch target width').toBeGreaterThanOrEqual(44)
    }
    await expectNoOverflow(page)
  }
})
