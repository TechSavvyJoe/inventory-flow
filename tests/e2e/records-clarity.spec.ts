import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { BootstrapData, VehicleRecord, WarrantyCheckCoverageRecord } from '../../src/types'

// Richer display evidence layered over the isolated demo at its read boundary.
// All facts and document identifiers are fabricated; no source link is opened.
const VIN = 'TESTDATAHWELL0001'
const NAME = '2024 Ford F-150 Lariat'
const HISTORY_URL = 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic-records&ac=synthetic-records'
const STICKER_URL = 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic-records&make=Ford&vehicleType=U'
const EQUIPMENT_URL = 'https://assets.cai-media-management.com/window-stickers/00000000-0000-4000-8000-000000000001.jpg'
const coverage: WarrantyCheckCoverageRecord[] = [
  { type: 'Bumper-to-Bumper', termText: '3 years / 36,000 miles', remainingMilesText: '23,550 miles', remainingTimeText: '6 months', status: 'ACTIVE' },
  { type: 'Powertrain', termText: '5 years / 60,000 miles', remainingMilesText: '47,550 miles', remainingTimeText: '30 months', status: 'ACTIVE' },
]
const richRecords: Partial<VehicleRecord> = {
  autoCheckReport: {
    url: HISTORY_URL, dataState: 'current', reportRunAt: '2026-08-30T13:05:00Z',
    score: 91, scoreRangeLow: 86, scoreRangeHigh: 93, ownerCount: 2, usage: 'Personal',
    lastReportedOdometer: 12450, lastReportedOdometerDate: '2026-08-29',
    estimatedInServiceDate: '2024-03-14', vehicleClass: 'Light-duty pickup', assemblyCountry: 'United States',
    checks: [
      { label: 'State Title Brand', status: 'Clean', detail: 'Clean' },
      { label: 'Auction Brand / Issues', status: 'No Issue', detail: 'No auction brands reported' },
      { label: 'Accident / Damage', status: 'Minor', detail: 'Minor damage reported' },
      { label: 'Open Recall Check', status: 'No Issue', detail: 'No open recalls in this history report' },
      { label: 'Insurance Loss / Transfer', status: 'No Issue', detail: 'No insurance loss reported' },
      { label: 'Odometer Check', status: 'No Issue', detail: 'Last reported odometer: 12,450 (08/29/2026)' },
      { label: 'Certified Pre-Owned', status: 'No CPO Info Available' },
      { label: 'Service / Repair', status: 'Records Available', detail: '12 service records' },
      { label: 'Additional History', status: 'Events Reported', detail: 'Registration renewed' },
    ],
  },
  windowSticker: {
    url: STICKER_URL, dataState: 'current', vehicleDescription: NAME,
    basePrice: 63420, totalOptions: 3005, destinationCharge: 1995, totalMsrp: 68420,
    pricingCurrency: null, pricingCurrencyEvidence: 'Synthetic source has no printed currency symbol.',
    equipmentGroup: '502A', exteriorColor: 'Antimatter Blue Metallic', interiorColor: 'Black',
    engine: '3.5L EcoBoost V6', transmission: '10-Speed Automatic',
    options: ['Synthetic Premium Technology Package — 3,005', '360-Degree Camera'],
    standardEquipment: ['LED Headlamps', 'Heated Front Seats', 'Rear-view camera'],
    warranty: ['3-year / 36,000-mile bumper-to-bumper', '5-year / 60,000-mile powertrain'],
  },
  factoryEquipment: {
    url: EQUIPMENT_URL, dataState: 'current', sourceLabel: 'Synthetic vAuto equipment fixture', capturedAt: '2026-08-30T13:00:00Z',
    vehicleDescription: NAME, isOriginalWindowSticker: false,
    basePrice: 63420, totalOptions: 3005, destinationCharge: 1995, totalMsrp: 68420,
    engine: '3.5L EcoBoost V6', transmission: '10-Speed Automatic', drivetrain: '4WD',
    exteriorColor: 'Antimatter Blue Metallic', interiorColor: 'Black',
    packages: [{ name: 'Synthetic Premium Technology Package', code: 'DEMO', price: 3005, features: ['360-Degree Camera', 'Adaptive Cruise Control', 'Blind Spot Monitoring'] }],
    sections: [
      { name: 'Safety and Driver Assistance', items: [{ label: 'Lane-Keeping System' }, { label: 'Rear Cross-Traffic Alert' }, { label: 'Adaptive Cruise Control' }] },
      { name: 'Comfort and Convenience', items: [{ label: 'Heated and ventilated front seats' }, { label: 'Wireless smartphone integration' }] },
    ],
    disclaimer: 'Synthetic reference only; verify installed equipment.',
  },
  fordOasis: {
    dataState: 'current', capturedAt: '2026-08-30T14:00:00Z', warrantyStartDate: '14-MAR-2024',
    buildDate: '20-FEB-2024', releaseDate: '28-FEB-2024', monthsInService: 29, saleMileage: 15,
    vehicleDescription: NAME, openActionsCaptured: true,
    openFieldServiceActions: [{ code: 'DEMO-26A', description: 'Synthetic rear camera inspection &amp; software check' }],
    warrantyCoverages: [{ type: 'Bumper-to-Bumper', description: '3 years / 36,000 miles' }, { type: 'Powertrain', description: '5 years / 60,000 miles' }],
    extendedCoverageExpirations: [],
  },
  warrantyCheck: {
    dataState: 'current', capturedAt: '2026-08-30T14:00:00Z', mileageEntered: 12450, mileageSource: 'Synthetic current listed odometer',
    fordOasis: { warrantyStartDate: '14-MAR-2024', monthsInService: 29, coverages: coverage },
    autoCheck: { inServiceDate: '2024-03-14', inServiceAgeMonths: 29, defaultMileage: 12450, coverages: coverage },
  },
}

async function installRichDemoRecords(page: Page, recordOverrides: Partial<VehicleRecord> = richRecords) {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'group_manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
  await page.route('**/api/bootstrap?**', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json() as BootstrapData
    expect(payload.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const vehicle = payload.vehicles.find(vehicle => vehicle.vin === VIN)
    expect(vehicle).toBeDefined()
    Object.assign(vehicle!, recordOverrides)
    await route.fulfill({ response, json: payload })
  })
  await page.route(`**/api/vehicles/${VIN}`, async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const vehicle = await response.json() as VehicleRecord
    expect(vehicle.vin).toBe(VIN)
    await route.fulfill({ response, json: { ...vehicle, ...recordOverrides } })
  })
}

async function capture(page: Page, width: number, state: string) {
  const directory = process.env.INVENTORY_RECORDS_QA_DIR
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: join(directory, `records-${width}-${state}.png`) })
}

test.use({ deviceScaleFactor: 1 })

async function expectCompactReportColumns(records: Locator, width: number) {
  const sections = await records.locator('.inventory-vehicle-documents__grid > [data-record-section]').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect()
    return { id: element.getAttribute('data-record-section'), x: box.x, y: box.y, bottom: box.bottom, fragments: element.getClientRects().length }
  }))
  const columns = new Map<number, typeof sections>()
  for (const section of sections) {
    expect(section.fragments, `${section.id} remains one complete report`).toBe(1)
    const column = Math.round(section.x)
    columns.set(column, [...(columns.get(column) ?? []), section])
  }
  expect(columns.size, 'Reports use two independent desktop columns and one phone reading order').toBe(Math.min(sections.length, width >= 1024 ? 2 : 1))
  const visualReadingOrder: (string | null)[] = []
  for (const [, column] of [...columns].sort(([left], [right]) => left - right)) {
    column.sort((first, second) => first.y - second.y)
    visualReadingOrder.push(...column.map(section => section.id))
    for (let index = 1; index < column.length; index++) {
      const gap = column[index].y - column[index - 1].bottom
      expect(gap, `${column[index].id} follows the previous report without a row-sized blank area`).toBeLessThanOrEqual(16)
      expect(gap, 'Separate report borders remain distinguishable').toBeGreaterThanOrEqual(8)
    }
  }
  expect(visualReadingOrder).toEqual(sections.map(section => section.id))
}

async function expectReportHeadingVisible(workspace: Locator, section: Locator) {
  const scroll = await workspace.locator('.vdp-focus-scroll').boundingBox()
  const heading = await section.locator('.inventory-vehicle-document__heading').first().boundingBox()
  expect(heading, 'The jumped-to report has a visible heading').not.toBeNull()
  expect(heading!.y, 'Jump lands below the fixed workspace navigation').toBeGreaterThanOrEqual(scroll!.y - 1)
  expect(heading!.y + heading!.height, 'The full heading remains above the fixed footer').toBeLessThanOrEqual(scroll!.y + scroll!.height + 1)
}

// Each viewport owns a complete flow and its own normal test budget. Combining
// all desktop widths consumed that budget in CI before the final flow finished.
for (const size of [
  { project: 'mobile', width: 390, height: 844 },
  { project: 'desktop', width: 1024, height: 768 },
  { project: 'desktop', width: 1320, height: 820 },
  { project: 'desktop', width: 1440, height: 900 },
]) {
  test(`rich Records stay ordered, factual and navigable at ${size.width}×${size.height}`, async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name !== size.project, 'Viewport runs in its matching desktop or mobile project')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      // Match the cross-browser health guard: WebKit ignores this optional
      // viewport hint. Every other console error and page error still fails.
      if (browserName === 'webkit' && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.') return
      if (message.type() === 'error') errors.push(message.text())
    })
    await installRichDemoRecords(page)
    await page.setViewportSize(size)
    await page.goto(`/inventory?scope=group&vin=${VIN}&tab=data`)
    await expect(page).toHaveTitle(/Inventory Flow/)
    const workspace = page.getByRole('dialog', { name: `${NAME} vehicle workspace` })
    await expect(workspace).toBeVisible()
    await expect(workspace.getByRole('tab', { name: 'Records', exact: true })).toHaveAttribute('aria-selected', 'true')
    const records = workspace.getByRole('region', { name: 'Vehicle documents' })
    await expect(records.locator('[data-record-section]')).toHaveCount(5)
    expect(await records.locator('[data-record-section]').evaluateAll(sections => sections.map(section => section.getAttribute('data-record-section')))).toEqual(['autocheck', 'oasis', 'warranty', 'sticker', 'equipment'])
    await expect(records.locator('[data-record-section="equipment"]')).not.toHaveAttribute('open', '')
    await expect(records.locator('[data-record-section="equipment"] .inventory-vehicle-document')).toBeHidden()
    await expect(workspace.locator('.vdp-records-summary')).toContainText('Base MSRP')
    await expect(workspace.locator('.vdp-records-summary')).toContainText('63,420')
    // The top-of-workspace summary never carries the sticker-currency qualifier
    // (VehicleWorkspace.tsx hardcodes baseMsrpQualifier to null there); that
    // caveat only renders down in the Records > Window sticker section, which
    // the assertion at the bottom of this test already covers.
    await expect(workspace.locator('.vdp-records-summary')).not.toContainText('Sticker · confirm currency')

    const history = records.locator('[data-record-section="autocheck"]')
    const checks = history.locator('.inventory-vehicle-document__check')
    await expect(checks).toHaveCount(9)
    expect((await checks.locator('strong').allTextContents()).sort()).toEqual(['Title', 'Auction', 'Accident / damage', 'Recalls', 'Insurance', 'Odometer', 'CPO', 'Service', 'Other history'].sort())
    await expect(checks.filter({ hasText: 'CPO' })).toContainText('Not reported')
    await expect(checks.filter({ hasText: 'Service' })).toContainText('12 service records')
    await expect(history.locator('.vdp-history-summary')).toContainText('Owners2')
    await expect(history.locator('.vdp-record-source-details').last()).toContainText('Personal')
    await expect(history.getByLabel('AutoCheck at-a-glance results')).toContainText('12 service records')
    await expect(history.locator('.vdp-history-more')).not.toContainText('12 service records')
    await expect(history.locator('.vdp-record-source-details').last()).toContainText('12,450 mi')
    await expect(history.locator('.vdp-history-more')).not.toHaveAttribute('open')
    await history.locator('.vdp-history-more > summary').click()
    await expect(history.locator('.vdp-history-more').getByText('Auction', { exact: true })).toBeVisible()
    await history.locator('.vdp-history-more > summary').click()
    expect(await records.locator('.vdp-record-source-details').evaluateAll(details => details.every(detail => !(detail as HTMLDetailsElement).open))).toBe(true)
    await expect(history.getByRole('link', { name: /Open AutoCheck report/ })).toHaveAttribute('href', HISTORY_URL)
    await expect(history.getByRole('link', { name: /Open AutoCheck report/ })).toHaveAttribute('target', '_blank')
    await page.evaluate(async () => { await document.fonts.ready })
    const recordsPanel = await workspace.getByRole('tabpanel', { name: 'Records', exact: true }).boundingBox()
    const historyBox = await history.boundingBox()
    expect(historyBox!.y - recordsPanel!.y, 'Report facts start near the top, without a tall summary/navigation stack').toBeLessThanOrEqual(150)
    await expectCompactReportColumns(records, size.width)
    for (const button of await records.getByRole('navigation', { name: 'Record sections' }).getByRole('button').all()) {
      const box = await button.boundingBox()
      expect(box!.height, 'Report navigation keeps a full touch target').toBeGreaterThanOrEqual(44)
    }
    await capture(page, size.width, 'top')

    const jumps = records.getByRole('navigation', { name: 'Record sections' })
    for (const [button, sectionId] of [['OASIS', 'oasis'], ['Warranty', 'warranty'], ['Window sticker', 'sticker'], ['Equipment', 'equipment'], ['AutoCheck', 'autocheck']] as const) {
      await jumps.getByRole('button', { name: button, exact: true }).click()
      const section = records.locator(`[data-record-section="${sectionId}"]`)
      await expect(section).toBeFocused()
      await expectReportHeadingVisible(workspace, section)
      await expect(workspace.getByRole('tab', { name: 'Records', exact: true })).toBeInViewport()
      await expect(workspace.getByRole('heading', { name: NAME, exact: true })).toBeInViewport()
      const footer = await workspace.locator('.vdp-focus-footer').boundingBox()
      const frame = await workspace.boundingBox()
      expect(footer).not.toBeNull()
      expect(Math.abs(footer!.y + footer!.height - (frame!.y + frame!.height))).toBeLessThanOrEqual(2)
      const overflow = await page.evaluate(() => {
        const workspace = document.getElementById('inventory-vehicle-workspace')!
        return { page: document.documentElement.scrollWidth > innerWidth, workspace: workspace.scrollWidth > workspace.clientWidth + 1 }
      })
      expect(overflow).toEqual({ page: false, workspace: false })
      await capture(page, size.width, sectionId)
    }

    const equipment = records.locator('[data-record-section="equipment"]')
    await expect(equipment.getByRole('region', { name: 'Packages & priced equipment' })).toContainText('Synthetic Premium Technology Package')
    // Base MSRP sits above the collapsible source details and is always
    // visible; only the exterior/interior/powertrain facts are gated behind
    // the "Source details" toggle.
    await expect(equipment.getByLabel('Base MSRP')).toContainText('63,420')
    await expect(equipment.getByText('Antimatter Blue Metallic')).toBeHidden()
    await equipment.locator('.vdp-record-source-details > summary').click()
    await expect(equipment.getByText('Antimatter Blue Metallic')).toBeVisible()
    await expect(equipment.getByText('3.5L EcoBoost V6 · 10-Speed Automatic · 4WD')).toBeVisible()
    await equipment.locator('.vdp-record-source-details > summary').click()
    await expect(equipment.getByText('Antimatter Blue Metallic')).toBeHidden()
    const sticker = records.locator('[data-record-section="sticker"]')
    const stickerPricing = sticker.getByLabel('Window sticker pricing')
    await expect(stickerPricing).toContainText('Original MSRP')
    await expect(stickerPricing).toContainText('68,420')
    await expect(stickerPricing).not.toContainText('63,420')
    await expect(stickerPricing.getByText('Base MSRP', { exact: true })).toHaveCount(0)
    await expect(equipment.getByLabel('Base MSRP')).toContainText('63,420')
    await expect(sticker.getByText('Options', { exact: true })).toHaveCount(0)
    await expect(sticker.getByText('Destination', { exact: true })).toHaveCount(0)
    await expect(sticker).not.toContainText('Synthetic source has no printed currency symbol.')
    await expect(records.locator('[data-record-section="oasis"]')).toContainText('Synthetic rear camera inspection & software check')
    const warranty = records.locator('[data-record-section="warranty"]')
    await expect(warranty.getByRole('table', { name: 'Remaining factory warranty by coverage' })).toContainText('47,550 miles')
    await expect(warranty.getByRole('table', { name: 'AutoCheck warranty estimate', includeHidden: true })).toBeHidden()
    // Native columns may rebalance when report evidence expands. Keep the
    // reports unbroken and ensure every jump follows its actual new position.
    for (const expanded of [true, false]) {
      for (const details of await records.locator('.vdp-record-source-details').all()) {
        const isOpen = await details.evaluate(element => (element as HTMLDetailsElement).open)
        if (isOpen !== expanded) await details.locator(':scope > summary').click()
      }
      await expectCompactReportColumns(records, size.width)
      for (const section of await records.locator('[data-record-section]').all()) {
        await jumps.getByRole('button', { name: (await section.getAttribute('aria-label'))!, exact: true }).click()
        await expect(section).toBeFocused()
        await expectReportHeadingVisible(workspace, section)
      }
      await capture(page, size.width, expanded ? 'evidence-expanded' : 'evidence-collapsed')
    }
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('a single captured report uses the available width and keeps its jump visible', async ({ page }, testInfo) => {
  await installRichDemoRecords(page, {
    autoCheckReport: undefined, windowSticker: undefined, factoryEquipment: undefined, warrantyCheck: undefined,
    fordOasis: richRecords.fordOasis,
  })
  const width = testInfo.project.name === 'mobile' ? 390 : 1440
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
  await page.goto(`/inventory?scope=group&vin=${VIN}&tab=data`)
  const workspace = page.getByRole('dialog', { name: `${NAME} vehicle workspace` })
  const records = workspace.getByRole('region', { name: 'Vehicle documents' })
  const report = records.getByRole('region', { name: 'OASIS', exact: true })
  await expect(records.locator('[data-record-section]')).toHaveCount(1)
  await expectCompactReportColumns(records, width)
  const container = await records.locator('.inventory-vehicle-documents__grid').boundingBox()
  const box = await report.boundingBox()
  expect(Math.abs(container!.width - box!.width), 'A lone report does not reserve an empty second column').toBeLessThanOrEqual(1)
  await records.getByRole('navigation', { name: 'Record sections' }).getByRole('button', { name: 'OASIS', exact: true }).click()
  await expect(report).toBeFocused()
  await expectReportHeadingVisible(workspace, report)
})
