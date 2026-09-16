// @vitest-environment jsdom
// @ts-nocheck -- Independent synthetic regression checks for the unbundled shell.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import markup from '../../extension/sidepanel/index.html?raw'

const api = vi.hoisted(() => ({ bootstrap: vi.fn(), vehicle: vi.fn(), openUrl: vi.fn() }))
vi.mock('../../extension/sidepanel/lib/api.mjs', async (importOriginal) => ({ ...(await importOriginal()), fetchBootstrap: api.bootstrap, fetchVehicle: api.vehicle }))
vi.mock('../../extension/sidepanel/lib/host.mjs', () => ({
  host: 'preview', previewFlags: { photos: false }, placeholderPhotos: () => [], copyText: vi.fn(), openUrl: api.openUrl, openExtensionPage: vi.fn(),
  storage: { getSettings: async () => ({ workspace: 'demo', theme: 'light', density: 'comfortable', demoRole: 'manager', demoStore: 'Howell' }), getCompare: async () => [], getFilters: async () => null, takePendingQuery: async () => null, onPendingQuery: () => {}, getCache: async () => null, setCache: async () => {}, clearCache: async () => {}, setCompare: async () => {}, setFilters: async () => {} },
}))

const reportUrl = 'https://www.bobmaxeyfordhowell.com/AutoCheck.aspx?sv=SYNTHETIC&ac=SYNTHETIC'
const vehicle = (vin, homeStore, model, patch = {}) => ({
  vin, stockNumber: `DEMO-${vin.slice(-4)}`, year: 2024, vehicleName: `2024 Ford ${model}`, make: 'Ford', model,
  homeStore, publicStore: homeStore, listedPrice: 32000, mileage: 14000,
  hold: { state: 'none', canViewEvidence: false }, ...patch,
})
const move = { state: 'in_transit', label: 'In transit', currentLocation: 'In transit', locationConfidence: 'verified', destination: 'Howell' }
const vehicles = () => [
  vehicle('TESTDATAHWELL0001', 'Howell', 'F-150', { hold: { state: 'primary', canViewEvidence: false }, movement: move, listingUrl: 'https://www.bobmaxeyfordhowell.com/used-Synthetic-truck', autoCheckReport: { dataState: 'current', url: reportUrl, score: 91, ownerCount: 1, checks: [{ label: 'Title', status: 'No title brands found' }] } }),
  vehicle('TESTDATAHWELL0002', 'Howell', 'Escape', { dealerOn: { inTransit: true }, serviceReadiness: { status: 'needs_service' }, movement: { state: 'source_reported', currentLocation: 'Howell', locationConfidence: 'reported' } }),
  vehicle('TESTDATALNCN00001', 'Lincoln', 'F-150', { hold: { state: 'primary', canViewEvidence: false }, movement: move }),
  vehicle('TESTDATALNCN00002', 'Lincoln', 'Corsair', { movement: { state: 'returned_home', currentLocation: 'Lincoln', locationConfidence: 'verified' } }),
  vehicle('TESTDATAFWELL0001', 'Fowlerville', 'Silverado', { vehicleName: '2024 Chevrolet Silverado', make: 'Chevrolet', movement: move }),
]
const bootstrap = (records = vehicles()) => ({ access: { user: 'Synthetic manager', role: 'manager', store: 'Howell' }, meta: { publicFreshness: 'current', dealerMailFreshness: 'current', reportDate: '2026-09-15' }, stores: [], transfers: [], vehicles: records })
const rows = () => [...document.querySelectorAll('#rows .row')]
const query = (text) => { const input = document.querySelector('#q'); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })) }
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/g, '')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 0 })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
  api.bootstrap.mockResolvedValue(bootstrap())
  api.vehicle.mockResolvedValue(vehicles()[0])
})

afterEach(() => {
  document.querySelector('#sheet-close')?.click()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else delete HTMLElement.prototype.scrollIntoView
})

async function boot() {
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(rows()).toHaveLength(2))
}

describe('extension compact shell regressions', () => {
  it.each([['held', 2], ['moving', 3]])('counts the current %s view on the All-store action', async (view, allCount) => {
    await boot()
    expect(document.querySelector('#store-all').textContent).toBe('All 5')
    document.querySelector(`#scope-${view}`).click()
    expect(rows()).toHaveLength(1)
    expect(document.querySelector('#store-all').textContent).toBe(`All ${allCount}`)
    document.querySelector('#store-all').click()
    expect(rows()).toHaveLength(allCount)
    expect(document.querySelector(`#scope-${view}`).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('#store-all').getAttribute('aria-pressed')).toBe('true')
    expect(api.vehicle).not.toHaveBeenCalled()
  })

  it.each(['held', 'moving'])('returns directly home with the query and %s view intact', async (view) => {
    await boot(); query('F150')
    document.querySelector(`#scope-${view}`).click()
    expect(document.querySelector('#store-all').textContent).toBe('All 2')
    document.querySelector('#store-all').click()
    expect(rows()).toHaveLength(2)
    const home = document.querySelector('#store-home')
    expect(home.hidden).toBe(false)
    expect(home.getAttribute('aria-label')).toBe('Return to my store, Howell')
    home.click()
    expect(rows()).toHaveLength(1)
    expect(rows()[0].dataset.vin).toBe('TESTDATAHWELL0001')
    expect(document.querySelector('#q').value).toBe('F150')
    expect(document.querySelector(`#scope-${view}`).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('#store-all').getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('#store-select').value).toBe('home')
    expect(api.vehicle).not.toHaveBeenCalled()
  })

  it('does not turn DealerOn transit, waiting for service, or a completed receipt into an active move', async () => {
    await boot()
    expect(document.querySelector('#rows').textContent).toContain('Waiting for service')
    document.querySelector('#scope-moving').click()
    expect(rows().map((row) => row.dataset.vin)).toEqual(['TESTDATAHWELL0001'])
    document.querySelector('#store-all').click()
    expect(rows().map((row) => row.dataset.vin).sort()).toEqual(['TESTDATAFWELL0001', 'TESTDATAHWELL0001', 'TESTDATALNCN00001'].sort())
    expect(document.querySelector('#rows').textContent).toContain('Waiting for service')
  })

  it('shows a move-specific empty state and clears the removed keyboard active row', async () => {
    api.bootstrap.mockResolvedValue(bootstrap(vehicles().map(({ movement, ...record }) => record)))
    await boot()
    const input = document.querySelector('#q')
    const firstResultId = rows()[0].id
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    const list = document.querySelector('#rows')
    expect(list.getAttribute('aria-activedescendant')).toBe(firstResultId)
    document.querySelector('#scope-moving').click()
    expect(rows()).toHaveLength(0)
    expect(list.hasAttribute('aria-activedescendant')).toBe(false)
    expect(document.querySelector('#status').textContent).toContain('No vehicles moving in this view')
    expect(document.querySelector('#status').textContent).not.toContain('The selected release has no vehicles for this store')
    document.querySelector('#scope-inventory').click()
    expect(rows()).toHaveLength(2)
    expect(document.querySelector('#status').hidden).toBe(true)
  })

  it('keeps five labeled workspace actions directly available and opens exact main-app routes', async () => {
    await boot()
    const nav = document.querySelector('nav[aria-label="Inventory Flow workspaces"]')
    const controls = [...nav.querySelectorAll(':scope > button')]
    expect(controls.map((button) => button.textContent)).toEqual(['New', 'Prices', 'Moves', 'Service', 'Actions'])
    expect(nav.querySelector('details')).toBeNull()
    const destinations = [
      ['New inventory', '/updates?view=new'], ['Price changes', '/updates?view=price'],
      ['Vehicle moves', '/transfers'], ['Service', '/service'], ['Action center', '/attention'],
    ]
    controls.forEach((button, index) => {
      expect(button.getAttribute('aria-label')).toBe(`${destinations[index][0]} (opens in app)`)
      button.click()
      expect(api.openUrl).toHaveBeenLastCalledWith(`http://127.0.0.1:4173${destinations[index][1]}`)
    })
    expect(api.vehicle).not.toHaveBeenCalled()
  })

  it('keeps captured facts visible without nested list actions or per-row requests', async () => {
    await boot()
    const summary = document.querySelector('#row-TESTDATAHWELL0001 .row-documents')
    expect(summary.textContent).toContain('Score 91')
    expect(summary.textContent).toContain('1 owner')
    expect(summary.querySelector('a, button, input, [tabindex]')).toBeNull()
    query('F150'); document.querySelector('#scope-held').click(); document.querySelector('#store-all').click()
    expect(api.vehicle).not.toHaveBeenCalled()
    document.querySelector('#row-TESTDATAHWELL0001').click()
    await vi.waitFor(() => expect(api.vehicle).toHaveBeenCalledTimes(1))
    expect(api.vehicle.mock.calls[0][2]).toBe('TESTDATAHWELL0001')
    const original = [...document.querySelectorAll('#detail .doc-source-open')].find((button) => /AutoCheck|history/i.test(button.getAttribute('aria-label') ?? button.textContent)) ?? document.querySelector('#detail .doc-source-open')
    expect(original).not.toBeNull()
    original.click()
    expect(api.openUrl).toHaveBeenLastCalledWith(reportUrl)
  })
  it('uses the move next step instead of a report strip in the Moving workspace', async () => {
    const records = vehicles()
    records[0].movement = { ...move, nextAction: 'Confirm synthetic arrival', dueAt: '2026-09-18T16:00:00Z' }
    api.bootstrap.mockResolvedValue(bootstrap(records))
    await boot()
    expect(document.querySelector('#row-TESTDATAHWELL0001 .row-documents')).not.toBeNull()
    document.querySelector('#scope-moving').click()
    const row = document.querySelector('#row-TESTDATAHWELL0001')
    expect(row.querySelector('.row-documents')).toBeNull()
    expect(row.querySelector('.row-workflow-summary').textContent).toContain('Confirm synthetic arrival')
    expect(row.querySelector('.row-workflow-summary').textContent).toContain('Due Sep 18')
    expect(row.querySelector('.row-workflow-summary').textContent).toContain('Vehicle details')
    expect(row.querySelector('.row-workflow-summary a, .row-workflow-summary button')).toBeNull()
    expect(api.vehicle).not.toHaveBeenCalled()
    row.click()
    await vi.waitFor(() => expect(document.querySelector('#tab-records')).not.toBeNull())
  })
})
