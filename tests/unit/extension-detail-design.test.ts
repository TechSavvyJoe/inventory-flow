// @vitest-environment jsdom
// @ts-nocheck -- Synthetic-only tests for the unbundled companion workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
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
  it('does not present incomplete package and unavailable sticker markers as captured equipment', async () => {
    await boot([{ ...record(), features: '', factoryEquipment: { dataState: 'incomplete', packages: [{ name: 'INCOMPLETE_PACKAGE_MARKER', features: ['INCOMPLETE_FEATURE_MARKER'] }] }, windowSticker: { dataState: 'unavailable', equipmentGroup: 'UNAVAILABLE_GROUP_MARKER' } }])
    within(document.body).getByRole('tab', { name: 'Equipment', exact: true }).click()
    const panel = document.querySelector('#tab-panel')
    expect(panel).not.toHaveTextContent('INCOMPLETE_PACKAGE_MARKER')
    expect(panel).not.toHaveTextContent('INCOMPLETE_FEATURE_MARKER')
    expect(panel).not.toHaveTextContent('UNAVAILABLE_GROUP_MARKER')
    expect(panel).toHaveTextContent('No equipment details are available')
  })
  it('preserves ordered sticker option rows, explicit children and original price tokens', async () => {
    const options = ['Synthetic Equipment Group $1,200.00', '• Synthetic camera package', '. Connected navigation — 1-year trial', 'Synthetic transmission NO CHARGE', 'Synthetic radio trial 90 days', 'Synthetic radio trial 90 days', 'Paint code 2024']
    await boot([{ ...record(), windowSticker: { pricingCurrency: 'CAD', totalMsrp: 45000, options } }])
    const sticker = document.querySelector('.doc-summary[data-resource="window-sticker"]')
    const rows = [...sticker.querySelectorAll('.doc-sticker-option')]
    expect(rows).toHaveLength(options.length)
    expect(rows.map(row => row.textContent)).toEqual(['Synthetic Equipment Group$1,200.00', '• Synthetic camera package', '. Connected navigation — 1-year trial', 'Synthetic transmissionNO CHARGE', 'Synthetic radio trial 90 days', 'Synthetic radio trial 90 days', 'Paint code 2024'])
    expect(rows.filter(row => row.classList.contains('doc-sticker-option--child'))).toHaveLength(2)
    expect([...sticker.querySelectorAll('.doc-sticker-price')].map(node => node.textContent)).toEqual(['$1,200.00', 'NO CHARGE'])
  })
  it('recognizes explicit source currency and dot-prefixed items without treating decimals as children', async () => {
    const options = ['Synthetic package · USD 1,100.00', 'Synthetic roof CAD $900.00', '.TAILGATE STEP', '.275/60R20 BSW ALL-TERRAIN', '.5L engine notation', 'Synthetic option NO CHARGE', '.20\" GLOSS BLACK PAINTED ALUM', '.3.5L V6 ECOBOOST', '.20-inch wheels', '.20 inch wheels']
    await boot([{ ...record(), windowSticker: { options } }])
    const rows = [...document.querySelectorAll('.doc-summary[data-resource="window-sticker"] .doc-sticker-option')]
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(options)
    expect(rows.map(row => row.title)).toEqual(options)
    expect(rows[0].querySelector('.doc-sticker-price').textContent).toBe('USD 1,100.00')
    expect(rows[1].querySelector('.doc-sticker-price').textContent).toBe('CAD $900.00')
    expect(rows[2].classList.contains('doc-sticker-option--child')).toBe(true)
    expect(rows[3].classList.contains('doc-sticker-option--child')).toBe(true)
    expect(rows[4].classList.contains('doc-sticker-option--child')).toBe(false)
    expect(rows[4].textContent).toBe('.5L engine notation')
    expect(rows[5].querySelector('.doc-sticker-price').textContent).toBe('NO CHARGE')
    for (const row of rows.slice(6)) expect(row.classList.contains('doc-sticker-option--child')).toBe(true)
  })
  it('uses one attributed equipment-label fallback when the sticker has no parsed options', async () => {
    await boot([{ ...record(), windowSticker: { dataState: 'current', url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U' }, factoryEquipment: { dataState: 'stale', packages: [{ name: 'Synthetic towing package', features: ['Synthetic trailer camera'] }] } }])
    expect(document.querySelectorAll('.doc-summary[data-resource="window-sticker"]')).toHaveLength(0)
    const summary = document.querySelector('.doc-summary[data-resource="vauto"]')
    expect(summary.textContent).toContain('vAuto equipment')
    expect(summary.textContent).toContain('vAuto equipment label · not an original window sticker')
    expect(summary.textContent).toContain('Synthetic trailer camera')
    expect(summary.textContent).toContain('Saved report')
    expect(summary.querySelector('.doc-source-supplement').textContent).toContain('Open window sticker')
    document.querySelector('#tab-records').click()
    expect(document.querySelector('[data-record="window-sticker"]')).not.toBeNull()
    expect(document.querySelector('[data-record="vauto"]')).not.toBeNull()
  })
  it('routes an incomplete Ford sticker to a link-only vAuto profile', async () => {
    const stickerUrl = 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic&make=Ford&vehicleType=U'
    const equipmentUrl = 'https://assets.cai-media-management.com/window-stickers/123e4567-e89b-42d3-a456-426614174000.jpg'
    await boot([{ ...record(), windowSticker: { dataState: 'incomplete', url: stickerUrl }, factoryEquipment: { dataState: 'current', url: equipmentUrl } }])
    expect(document.querySelector('.doc-summary[data-resource="window-sticker"]')).toBeNull()
    expect(document.querySelector('.doc-grid--utilities .doc-vauto').getAttribute('aria-label')).toContain('vAuto equipment label')
    document.querySelector('#tab-records').click()
    const sticker = document.querySelector('[data-record="window-sticker"]')
    expect(sticker.textContent).toContain('Original sticker unavailable')
    expect(sticker.querySelector('.doc-source-supplement').textContent).toContain('Open vAuto equipment')
    expect(sticker.querySelector('.rec-source')).toBeNull()
  })
  it('keeps explicit equipment-group contents separate from optional equipment', async () => {
    await boot([{ ...record(), windowSticker: { pricingCurrency: 'CAD', equipmentGroup: 'DEMO-GROUP', equipmentGroupPrice: 1250.75, equipmentGroupContents: ['Synthetic included camera'], options: ['Synthetic optional roof NO CHARGE'] } }])
    const summary = document.querySelector('.doc-summary[data-resource="window-sticker"]')
    const sections = [...summary.querySelectorAll('.doc-options')]
    expect(sections[0].textContent).toBe('Included in equipment groupSynthetic included camera')
    expect(sections[1].textContent).toContain('Optional equipment & packagesSynthetic optional roof')
    expect(sections[1].textContent).not.toContain('Synthetic included camera')
    expect(summary.textContent.replace(/\u00a0/g, ' ')).toContain('CAD 1,250.75')
  })
  it('prefers official equipment-group contents over the informational vAuto fallback', async () => {
    await boot([{ ...record(), windowSticker: { pricingCurrency: 'USD', equipmentGroupPrice: 1250.75, equipmentGroupContents: ['Synthetic included camera'] }, factoryEquipment: { dataState: 'current', packages: [{ name: 'Synthetic fallback package', features: ['Synthetic fallback feature'] }] } }])
    const summary = document.querySelector('.doc-summary[data-resource="window-sticker"]')
    expect(summary).not.toBeNull()
    expect(summary.textContent).toContain('Synthetic included camera')
    expect(summary.textContent.replace(/\u00a0/g, ' ')).toContain('$1,250.75')
    expect(document.querySelector('.doc-summary[data-resource="vauto"]')).toBeNull()
  })
  it('retains exact vAuto option prices and repeated package children without inventing currency', async () => {
    await boot([{ ...record(), factoryEquipment: { dataState: 'current', packages: [{ name: 'Package A', price: 1200.75, features: ['Shared feature'] }, { name: 'Package B', price: 0, features: ['Shared feature'] }], sections: [{ name: 'Options', items: [{ label: 'Optional paint', price: 495.25 }] }] } }])
    const summary = document.querySelector('.doc-summary[data-resource="vauto"]')
    expect([...summary.querySelectorAll('.doc-sticker-price')].map(node => node.textContent)).toEqual(['1,200.75', '0', '495.25'])
    expect([...summary.querySelectorAll('.doc-sticker-option--child')].map(node => node.textContent)).toEqual(['· Shared feature', '· Shared feature'])
  })
  it('shows original certification artwork only for the confirmed home-store program', async () => {
    await boot([{ ...record(), certified: true }])
    expect(document.querySelector('.detail-home .cert img').getAttribute('src')).toBe('../resource-brands/ford-blue-certified.svg')
    expect(document.querySelector('.detail-home .cert img').getAttribute('alt')).toBe('Ford Blue Certified')
  })
  it('qualifies partially captured positive OASIS results in Overview and Records', async () => {
    await boot([{ ...record(), fordOasis: { dataState: 'current', capturedAt: '2026-08-30T09:00:00Z', openActionsCaptured: false, openFieldServiceActions: [{ code: '26N99', description: 'Synthetic campaign only after confirming condition' }] } }])
    const summary = document.querySelector('.doc-summary[data-resource="oasis"]')
    expect(summary.textContent).toContain('At least 1 captured actions · result incomplete')
    expect(summary.textContent).toContain('only after confirming condition')
    document.querySelector('#tab-records').click()
    expect(document.querySelector('[data-record="oasis"]').textContent).toContain('At least 1 captured actions · result incomplete')
  })
  it('keeps all OASIS coverage types, release date and conditional actions in Overview', async () => {
    const actions = Array.from({ length: 4 }, (_, index) => ({ code: `26N0${index}`, description: `Synthetic program ${index + 1}: applies only if inspection confirms condition` }))
    const coverages = ['Basic', 'Powertrain', 'Restraint', 'Corrosion', 'Emissions', 'Extended'].map(type => ({ type, description: `Synthetic ${type} captured terms` }))
    await boot([{ ...record(), fordOasis: { dataState: 'current', capturedAt: '2026-08-30T09:00:00Z', warrantyStartDate: '2024-03-14', releaseDate: '2024-02-01', openActionsCaptured: true, openFieldServiceActions: actions, warrantyCoverages: coverages } }])
    const summary = document.querySelector('.doc-summary[data-resource="oasis"]')
    for (const action of actions) expect(summary.textContent).toContain(`${action.code} · ${action.description}`)
    for (const coverage of coverages) expect(summary.textContent).toContain(coverage.description)
    expect(summary.textContent).toContain('Release date02/01/2024')
    expect(summary.textContent).not.toContain('Warranty start')
    expect(summary.textContent).not.toMatch(/4 recalls/i)
  })
  it('shows every captured AutoCheck category and its qualifiers without inferring clean results', async () => {
    const checks = [
      { label: 'State title', status: 'No brands reported' },
      { label: 'Auction brand', status: 'No brands reported' },
      { label: 'Accident / damage', status: 'No accidents reported' },
      { label: 'Open recall', status: 'No information available' },
      { label: 'Insurance loss', status: 'No information available' },
      { label: 'Odometer', status: 'No discrepancy reported' },
      { label: 'Certified pre-owned', status: 'No information available' },
      { label: 'Service', status: '5 records' },
      { label: 'Additional history', status: 'EVENT REPORTED', detail: 'Corrected title' },
    ]
    await boot([{ ...record(), autoCheckReport: { dataState: 'incomplete', reportRunAt: '2026-08-30T09:05:00Z', checks } }])
    const summary = document.querySelector('.doc-summary[data-resource="autocheck"]')
    for (const check of checks) {
      const row = [...summary.querySelectorAll('.doc-fact')].find(row => row.querySelector('dt').textContent === check.label)
      expect(row?.querySelector('dd').textContent).toContain(check.status)
      if (check.detail) expect(row?.querySelector('dd').textContent).toContain(check.detail)
    }
    expect(summary.textContent).toContain('Partial captured record')
    expect(summary.textContent).not.toContain('Report run')
    expect(summary.textContent).not.toContain('08/30/2026')
    expect(summary.textContent).not.toContain('Certified pre-ownedClean')
  })

  it('labels captured report facts and retains warnings, equipment and late source fields', async () => {
    await boot([{ ...record(),
      autoCheckReport: { dataState: 'stale', score: 91, scoreRangeLow: 86, scoreRangeHigh: 93, ownerCount: 2, usage: 'Personal use', lastReportedOdometer: 12345, lastReportedOdometerDate: '2026-08-29', estimatedInServiceDate: '2024-03-14', checks: [{ label: 'Accident check', status: 'Review', detail: 'Damage reported' }, { label: 'Title check', status: 'No title brands reported' }] },
      factoryEquipment: { engine: 'Synthetic V6', transmission: 'Automatic', drivetrain: '4WD', packages: [{ name: 'Synthetic Tow Package', features: ['Trailer brake controller'] }], sections: [{ name: 'Comfort', items: [{ label: 'Heated seats' }] }] },
      windowSticker: { pricingCurrency: 'CAD', totalMsrp: 45600, equipmentGroup: 'Synthetic group', options: ['Synthetic Tow Package', 'Synthetic roof option'], standardEquipment: ['Base steering wheel'], warranty: ['Synthetic warranty terms'] },
      fordOasis: { dataState: 'current', capturedAt: '2026-08-30T09:00:00Z', warrantyStartDate: '2024-03-14', openActionsCaptured: true, openFieldServiceActions: [{ code: '26N99', description: 'Synthetic non-recall campaign' }], warrantyCoverages: [{ type: 'Synthetic coverage', description: 'Verify source terms' }] },
    }])
    const history = document.querySelector('.doc-summary[data-resource="autocheck"]')
    expect([...history.querySelectorAll('dt')].map(node => node.textContent)).toEqual(expect.arrayContaining(['Score', 'Accident check', 'Title check', 'Owners / use', 'Odometer']))
    expect(history.textContent).toContain('91 · 86–93 range')
    expect(history.textContent).toContain('Damage reported')
    expect(history.textContent).not.toContain('03/14/2024')
    expect(history.textContent).toContain('Saved report · refresh at source')
    expect(document.querySelector('.doc-summary[data-resource="vauto"]')).toBeNull()
    const sticker = document.querySelector('.doc-summary[data-resource="window-sticker"]')
    expect(sticker.textContent.replace(/\s+/g, ' ')).toContain('CAD 45,600')
    expect([...sticker.querySelectorAll('h4')].map(node => node.textContent)).toEqual(['Captured equipment'])
    expect(sticker.textContent).toContain('Synthetic Tow Package')
    expect(sticker.textContent).toContain('Synthetic roof option')
    expect(sticker.textContent).not.toContain('Base steering wheel')
    expect(sticker.textContent).not.toContain('Synthetic warranty terms')
    const oasis = document.querySelector('.doc-summary[data-resource="oasis"]')
    expect(oasis.querySelector('.doc-fact--warning').textContent).toContain('26N99 · Synthetic non-recall campaign')
    expect(oasis.textContent).toContain('Recorded coverage')
    expect(oasis.textContent).toContain('Verify source terms')
  })

  it('uses original base MSRP for the single pricing shortcut on Overview and Records', async () => {
    const vehicle = { ...record(), inventoryDate: '2026-09-12', autoCheckReport: { estimatedInServiceDate: '2024-01-01' }, fordOasis: { warrantyStartDate: '2024-04-10' }, windowSticker: { basePrice: 42500, pricingCurrency: 'CAD', options: ['WEIGHT FEE — CAD 100'] } }
    await boot([vehicle])
    const facts = () => document.querySelector('.detail-frequent-facts').textContent.replace(/\s+/g, ' ')
    expect(facts()).toContain('Warranty in-service · OASIS')
    expect(facts()).toContain('04/10/2024')
    expect(facts()).toContain('CAD 42,500')
    expect(facts()).toContain('Base MSRP')
    expect(facts()).not.toContain('WEIGHT FEE — CAD 100')
    expect(document.querySelectorAll('.detail-frequent-facts .d-fact')).toHaveLength(2)
    expect(document.querySelector('.detail-full-specs').textContent).not.toContain('Inventory date')
    document.querySelector('#tab-records').click()
    expect(facts()).toContain('CAD 42,500')
    expect(document.querySelector('[data-record="window-sticker"]').textContent).toContain('WEIGHT FEE — CAD 100')
    const jump = [...document.querySelectorAll('.record-jumps button')].find((node) => node.textContent === 'Sticker')
    jump.click()
    expect(document.activeElement.dataset.record).toBe('window-sticker')
  })
  it('qualifies an in-service date that only AutoCheck estimated', async () => {
    await boot([{ ...record(), make: 'Chevrolet', autoCheckReport: { estimatedInServiceDate: '2024-01-01' } }])
    const facts = document.querySelector('.detail-frequent-facts').textContent.replace(/\s+/g, ' ')
    expect(facts).toContain('Warranty in-service · estimate')
    expect(facts).toContain('01/01/2024')
    expect(facts).not.toContain('OASIS')
  })
  it('does not attribute equipment-label prices to a sticker missing its base price', async () => {
    await boot([{ ...record(), windowSticker: { pricingCurrency: 'USD' }, factoryEquipment: { basePrice: 42500 } }])
    expect(document.querySelector('.detail-frequent-facts').textContent).toContain('42,500')
    expect(document.querySelector('.detail-frequent-facts').textContent).not.toContain('vAuto reference')
  })
  it.each([undefined, { pricingCurrency: 'CAD' }])('keeps copied equipment-label pricing in unknown currency despite sticker metadata %j', async (windowSticker) => {
    await boot([{ ...record(), windowSticker, factoryEquipment: { basePrice: 42500.5, totalOptions: 1200, destinationCharge: 1995, totalMsrp: 45695.5 } }])
    const { copyText } = await import('../../extension/sidepanel/lib/host.mjs')
    document.querySelector('#view-detail > .d-utilities button').click()
    await vi.waitFor(() => expect(copyText).toHaveBeenCalled())
    const text = copyText.mock.calls[0][0]
    expect(text).toContain('Listed price: $32,000')
    expect(text).toContain('vAuto base MSRP: 42,500.5')
    expect(text).toContain('Options total: 1,200')
    expect(text).toContain('Destination & delivery: 1,995')
    expect(text).toContain('vAuto MSRP: 45,695.5')
    expect(text).not.toContain('Sticker total MSRP')
    expect(text).toContain('42,500.5')
    expect(document.querySelector('.detail-frequent-facts').textContent).toContain('42,500.5')
  })
  it('explains unconfirmed service without inventing a fourth state or a completion', async () => {
    await boot([{ ...record(), serviceReadiness: { status: 'needs_service', readinessBasis: 'unconfirmed' } }])
    expect(document.querySelector('.service-summary').textContent).toContain('Waiting for service')
    expect(document.querySelector('.service-unconfirmed').textContent).toContain('Service not yet confirmed')
    expect(document.querySelector('.service-summary').textContent).not.toContain('Completed')
  })
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
    expect(document.querySelectorAll('#tab-panel .eq-ledger details')).toHaveLength(0)
    expect(within(document.querySelector('#tab-panel')).getByText('Sales guide · packages & feature differences').closest('details')).not.toHaveAttribute('open')
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

describe('quick companion overview interactions', () => {
  it('puts captured packages before the collapsed calculator and documents', async () => {
    await boot([{ ...record(), windowSticker: { dataState:'current', equipmentGroup:'Synthetic premium package', options:['Synthetic towing option'] } }])
    const heading = within(document.body).getByRole('heading', { name:'Stands out' })
    const calculator = within(document.body).getByRole('button', { name:'Warranty calculator' })
    const documents = within(document.body).getByRole('region', { name:'Vehicle documents and records' })
    expect(heading.compareDocumentPosition(calculator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(calculator.compareDocumentPosition(documents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(calculator).toHaveAttribute('aria-expanded','false')
    expect(heading.parentElement.parentElement).toHaveTextContent('Synthetic premium package')
  })
  it('opens and closes captured document details together', async () => {
    await boot([{ ...record(), windowSticker: { dataState:'current', equipmentGroup:'Synthetic group', options:['Synthetic additional roof'] }, autoCheckReport:{ dataState:'current',score:91, ownerCount:1, checks:[{ label:'Title',status:'Synthetic clean title' }] }, fordOasis:{ dataState:'current', warrantyStartDate:'2024-03-01', warrantyCoverages:[{type:'Synthetic manufacturer coverage',description:'Synthetic coverage detail'}] } }])
    const documents = within(document.body).getByRole('region', { name:'Vehicle documents and records' })
    const details = [...documents.querySelectorAll('.doc-expanded-facts')]
    expect(details).toHaveLength(3)
    expect(details.every(node => node.hidden)).toBe(true)
    within(documents).getByRole('button', { name:'Show details' }).click()
    expect(details.every(node => !node.hidden)).toBe(true)
    within(documents).getByRole('button', { name:'Hide details' }).click()
    expect(details.every(node => node.hidden)).toBe(true)
  })
  it('enlarges the photo and restores focus when the viewer closes', async () => {
    await boot([{ ...record(), imageUrls:['https://images.dealer.com/synthetic-one.jpg','https://images.dealer.com/synthetic-two.jpg'] }])
    const enlarge = within(document.body).getByRole('button', { name:/Enlarge photos of/ }); enlarge.focus(); enlarge.click()
    const dialog = within(document.body).getByRole('dialog', { name:/Photos/ })
    within(dialog).getByRole('button', { name:'Next enlarged photo' }).click()
    expect(within(dialog).getByRole('img')).toHaveAttribute('src','https://images.dealer.com/synthetic-two.jpg')
    within(dialog).getByRole('button', { name:'Close photos' }).click()
    expect(document.activeElement).toBe(enlarge)
  })
})
