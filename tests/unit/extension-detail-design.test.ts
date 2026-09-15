// @vitest-environment jsdom
// @ts-nocheck -- Synthetic-only tests for the unbundled companion workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import markup from '../../extension/sidepanel/index.html?raw'
import { renderTakeHome, takeHomeModel } from '../../extension/sidepanel/lib/takehome.mjs'
import { toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'
import { readFileSync } from 'node:fs'
const printCss = readFileSync('extension/sidepanel/takehome.css', 'utf8')
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const api = vi.hoisted(() => ({ bootstrap: vi.fn(), vehicle: vi.fn() }))
vi.mock('../../extension/sidepanel/lib/api.mjs', async (original) => ({ ...(await original()), fetchBootstrap: api.bootstrap, fetchVehicle: api.vehicle }))
vi.mock('../../extension/sidepanel/lib/host.mjs', () => ({
  host: 'preview', previewFlags: { photos: false }, placeholderPhotos: () => [], copyText: vi.fn(), openUrl: vi.fn(), openExtensionPage: vi.fn(),
  storage: { getSettings: async () => ({ workspace: 'demo', theme: 'light', density: 'comfortable', demoRole: 'manager', demoStore: 'Howell' }), getCompare: async () => [], getFilters: async () => null, takePendingQuery: async () => null, onPendingQuery: () => {}, getCache: async () => null, setCache: async () => {}, clearCache: async () => {}, setCompare: async () => {}, setFilters: async () => {}, setTakeHome: vi.fn() },
}))
const record = (suffix = '1') => ({
  fixtureMarker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS', vin: `TESTDATA00000000${suffix}`, stockNumber: `DEMO-D${suffix}`, vehicleName: '2024 Ford Synthetic Long Vehicle Name', year: 2024, make: 'Ford', model: 'Synthetic', homeStore: 'Howell', publicStore: 'Howell', sourceReportedLocation: 'Howell', listedPrice: suffix === '1' ? 32000 : 35000, mileage: 12345, msrp: 45000,
  engine: 'Synthetic EcoBoost V6', features: 'Synthetic adaptive cruise | Synthetic heated seats', listingUrl: `https://www.bobmaxeyfordhowell.com/used-Synthetic-${suffix}`,
  serviceReadiness: { status: suffix === '1' ? 'needs_service' : 'serviced' }, hold: { state: 'none_observed', canViewEvidence: true, backupCount: 0 },
})
const bootstrap = (records) => ({ access: { user: 'synthetic-manager', role: 'manager', store: 'Howell' }, meta: { publicFreshness: 'current', dealerMailFreshness: 'current', reportDate: '2026-09-14' }, stores: [], transfers: [], vehicles: records })
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); api.vehicle.mockReset()
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/g, '')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 0 })
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else delete HTMLElement.prototype.scrollIntoView
})
async function boot(records = [record()]) {
  api.bootstrap.mockResolvedValue(bootstrap(records))
  if (!api.vehicle.getMockImplementation()) api.vehicle.mockImplementation((_workspace, _settings, vin) => Promise.resolve(records.find((item) => item.vin === vin)))
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelectorAll('#rows .row')).toHaveLength(records.length))
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(document.querySelector('.detail-tabs')).not.toBeNull())
}

describe('companion concept vehicle workspace', () => {
  it('keeps a compact overview with deliberate tools instead of repeated ledgers', async () => {
    await boot()
    expect(document.querySelector('#detail .sig-grid')).toBeNull()
    expect(document.querySelector('#detail .dealsheet')).toBeNull()
    expect(document.querySelector('#detail .warr')).toBeNull()
    expect(document.querySelector('.detail-specification').textContent).toContain('Synthetic EcoBoost V6')
    const calculator = document.querySelector('.detail-calculator-toggle')
    calculator.click()
    expect(calculator.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('#detail .warr')).not.toBeNull()
    calculator.click()
    expect(document.querySelector('#detail .warr')).toBeNull()
  })
  it('exposes four real section tabs and two separate workflow actions', async () => {
    await boot()
    expect([...document.querySelectorAll('.detail-tabs [role="tab"]')].map((node) => node.dataset.tab)).toEqual(['overview', 'equipment', 'records', 'hold'])
    expect(document.querySelectorAll('.detail-tabs .tab-action')).toHaveLength(2)
    document.querySelector('#tab-overview').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.querySelector('#tab-equipment').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('#tab-panel').getAttribute('aria-labelledby')).toBe('tab-equipment')
    expect(document.querySelectorAll('.detail-tabs .tab-action')).toHaveLength(2)
  })
  it('opens service for the exact VIN without changing the selected tab', async () => {
    await boot()
    const { openUrl } = await import('../../extension/sidepanel/lib/host.mjs')
    document.querySelector('.service-update').click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/service?vin=TESTDATA000000001')
    expect(document.querySelector('#tab-overview').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.service-summary').textContent).toContain('Waiting for service')
  })
  it('keeps copy and customer-sheet utilities outside the detail scroller', async () => {
    await boot()
    const utilities = document.querySelector('#view-detail > .d-utilities')
    expect(utilities).not.toBeNull()
    expect(document.querySelector('#detail .d-utilities')).toBeNull()
    expect(utilities.textContent).toContain('Deal sheet')
    expect(utilities.textContent).toContain('Take-home page')
    const { copyText } = await import('../../extension/sidepanel/lib/host.mjs')
    utilities.querySelector('button').click()
    await vi.waitFor(() => expect(copyText).toHaveBeenCalled())
    expect(copyText.mock.calls[0][0]).toContain('TESTDATA000000001')
  })
  it('opens the preview take-home page before an asynchronous handoff loses the click gesture', async () => {
    await boot()
    const { storage, openExtensionPage } = await import('../../extension/sidepanel/lib/host.mjs')
    let releaseHandoff
    const handoff = new Promise((resolve) => { releaseHandoff = resolve })
    storage.setTakeHome.mockReturnValueOnce(handoff)
    ;[...document.querySelectorAll('#view-detail > .d-utilities button')].find((button) => button.textContent.includes('Take-home page')).click()
    expect(storage.setTakeHome).toHaveBeenCalledWith('TESTDATA000000001', expect.any(Object))
    expect(openExtensionPage).toHaveBeenCalledWith('print.html#TESTDATA000000001')
    releaseHandoff()
    await handoff
  })
  it('falls through to a later detail photo when the first source photo fails', async () => {
    const first = 'https://images.example.test/first.jpg'
    const second = 'https://images.example.test/second.jpg'
    await boot([{ ...record(), imageUrls: [first, second] }])
    const image = document.querySelector('.hero-img')
    expect(image.getAttribute('src')).toBe(first)
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    image.dispatchEvent(new Event('error'))
    expect(image.getAttribute('src')).toBe(second)
    expect(document.querySelector('.hero-count').textContent).toBe('2 / 2')
  })
  it('shows every equipment group without nested expanders', async () => {
    await boot()
    document.querySelector('#tab-equipment').click()
    expect(document.querySelectorAll('#tab-panel details')).toHaveLength(0)
    expect(document.querySelectorAll('.eq-ledger').length).toBeGreaterThan(0)
    expect(document.querySelector('#tab-panel').textContent).toContain('Synthetic heated seats')
  })
  it('retains all authorized hold messages instead of silently cutting off six', async () => {
    const held = { ...record(), hold: { state: 'primary', canViewEvidence: true, backupCount: 0, commentsCount: 8 }, privateEvidence: { primary: { salesperson: 'Synthetic colleague' }, comments: Array.from({ length: 8 }, (_, index) => ({ text: `Synthetic note ${index + 1}` })), alerts: [] } }
    await boot([held])
    document.querySelector('#tab-hold').click()
    await vi.waitFor(() => expect(document.querySelector('#tab-panel').textContent).toContain('Synthetic note 8'))
    expect(document.querySelector('#tab-panel').textContent).toContain('Synthetic note 1')
  })
  it('compares full values, differences, service and location provenance', async () => {
    await boot([record('1'), record('2')])
    document.querySelector('.detail-compare-toggle').click()
    document.querySelector('#back').click()
    document.querySelectorAll('#rows .row')[1].click()
    document.querySelector('.detail-compare-toggle').click()
    expect(document.querySelector('#panel').dataset.view).toBe('compare')
    expect(document.querySelector('.cmp-row[aria-label="Service"]').textContent).toContain('Waiting for service')
    expect(document.querySelector('.cmp-row[aria-label="Location"]').textContent).toContain('source-reported')
    document.querySelector('.cmp-differences-toggle').click()
    expect(document.querySelector('.cmp-row[aria-label="Engine"]').hidden).toBe(true)
    expect(document.querySelector('.cmp-row[aria-label="Price"]').hidden).toBe(false)
  })
  it('preserves comparison position when an asynchronous source detail arrives', async () => {
    let resolveSecond
    const second = new Promise((resolve) => { resolveSecond = resolve })
    api.vehicle.mockImplementation((_workspace, _settings, vin) => vin.endsWith('2') ? second : Promise.resolve(record('1')))
    await boot([record('1'), record('2')])
    document.querySelector('.detail-compare-toggle').click()
    document.querySelector('#back').click()
    document.querySelectorAll('#rows .row')[1].click()
    document.querySelector('.detail-compare-toggle').click()
    document.querySelector('#compare').scrollTop = 250
    resolveSecond({ ...record('2'), engine: 'Synthetic updated source engine' })
    await vi.waitFor(() => expect(document.querySelector('#compare').textContent).toContain('Synthetic updated source engine'))
    expect(document.querySelector('#compare').scrollTop).toBe(250)
  })
})

describe('customer take-home usability and privacy', () => {
  it('exposes a guarded public listing link without adding private operational fields', () => {
    const vehicle = toPanelVehicle(record(), bootstrap([record()]))
    const model = takeHomeModel(vehicle)
    const page = renderTakeHome(model)
    expect(page.querySelector('.th-listing-link').href).toBe('https://www.bobmaxeyfordhowell.com/used-Synthetic-1')
    expect(page.querySelector('.th-listing-link').rel).toBe('noopener noreferrer')
    expect(JSON.stringify(model)).not.toContain('serviceReadiness')
    expect(renderTakeHome({ ...model, listingUrl: 'javascript:alert(1)' }).querySelector('.th-listing-link')).toBeNull()
  })
  it('allows printed content to continue instead of clipping a fixed-height page', () => {
    expect(printCss).toContain('height: auto; min-height: 11in')
    expect(printCss).toContain('overflow: visible; display: block')
    expect(printCss).not.toContain('height: 11in; min-height: 0')
    expect(printCss).toContain('min-height: 44px')
  })
})
