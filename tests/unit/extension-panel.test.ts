// @vitest-environment jsdom
// @ts-nocheck -- Exercise the unbundled panel with synthetic, role-projected data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import markup from '../../extension/sidepanel/index.html?raw'

const api = vi.hoisted(() => ({ bootstrap: vi.fn(), vehicle: vi.fn() }))
vi.mock('../../extension/sidepanel/lib/api.mjs', async (importOriginal) => ({ ...(await importOriginal()), fetchBootstrap: api.bootstrap, fetchVehicle: api.vehicle }))
vi.mock('../../extension/sidepanel/lib/host.mjs', () => ({
  host: 'preview', previewFlags: { photos: false }, placeholderPhotos: () => [], copyText: vi.fn(), openUrl: vi.fn(), openExtensionPage: vi.fn(),
  storage: { getSettings: async () => ({ workspace: 'demo', theme: 'light', density: 'comfortable', demoRole: 'sales', demoStore: 'Howell' }), getCompare: async () => [], getFilters: async () => null, takePendingQuery: async () => null, onPendingQuery: () => {}, getCache: async () => null, setCache: async () => {}, clearCache: async () => {}, setCompare: async () => {}, setFilters: async () => {} },
}))

const vehicle = (homeStore = 'Howell', vin = 'TESTDATAHWELL0001') => ({
  vin, stockNumber: homeStore === 'Howell' ? 'DEMO-H01' : 'DEMO-L01', vehicleName: '2024 Ford Test Vehicle', make: 'Ford', model: 'Test', homeStore, listedPrice: 32000,
  hold: { state: 'primary', canViewEvidence: true, primarySalesperson: 'Synthetic Private Person', backupCount: 0 },
})
const bootstrap = (store = 'Howell', role = 'manager') => ({
  access: { user: `test-${store}`, store, role }, meta: { publicFreshness: 'current', dealerMailFreshness: 'current', reportDate: '2026-09-14' }, stores: [], transfers: [], vehicles: [vehicle(), vehicle('Lincoln', 'TESTDATALNCN00001')],
})
const waitForText = async (selector, text) => vi.waitFor(() => expect(document.querySelector(selector)?.textContent).toContain(text))
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
  api.vehicle.mockResolvedValue(vehicle())
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else delete HTMLElement.prototype.scrollIntoView
})

describe('extension working-store workflow and identity reset', () => {
  it('keeps the vehicle list in the normal keyboard tab order with a visible focus rule', async () => {
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'DEMO-H01')
    const rows = document.querySelector('#rows')
    expect(rows.tabIndex).toBe(0)
    rows.focus()
    rows.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(rows.getAttribute('aria-activedescendant')).toBe('row-TESTDATAHWELL0001')
  })
  it('shows captured report facts before opening a vehicle, without per-row detail requests', async () => {
    const record={...vehicle(), autoCheckReport:{dataState:'stale',score:91,ownerCount:1,checks:[{label:'Title',status:'Salvage reported'}]}, windowSticker:{dataState:'current',totalMsrp:68420,pricingCurrency:'CAD',equipmentGroup:'Synthetic equipment group',options:['Synthetic towing package']}}
    api.bootstrap.mockResolvedValue({...bootstrap(),vehicles:[record]})
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows','Salvage reported')
    expect(document.querySelector('.row-documents').textContent).toContain('CAD 68,420 MSRP')
    expect(document.querySelector('.row-documents').textContent).toContain('Saved report')
    expect(document.querySelector('.row-documents button, .row-documents a')).toBeNull()
    expect(api.vehicle).not.toHaveBeenCalled()
  })

  it('shows both captured decision facts directly in the inventory row', async () => {
    const record = {...vehicle(), autoCheckReport:{ dataState:'stale', score:91, ownerCount:1, checks:[{ label:'Title', status:'No title brands found' }, { label:'Odometer', status:'No issue found' }] }}
    api.bootstrap.mockResolvedValue({...bootstrap(),vehicles:[record]})
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'Score 91')
    const documents = document.querySelector('.row-documents')
    const summary = documents.querySelector('[data-resource="autocheck"]')
    const fact = summary.querySelector('.row-doc-facts')
    expect(documents.getAttribute('aria-label')).toContain('complete details')
    expect(fact.querySelector(':scope > span:not(.visually-hidden)').textContent).toContain('Score 91')
    expect(fact.title).toContain('Title: No title brands found')
    expect(fact.textContent).toContain('Title: No title brands found')
    expect(fact.querySelector('.row-doc-secondary').textContent).toContain('Title: No title brands found')
    expect(fact.querySelector('.visually-hidden')).toBeNull()
    expect(summary.querySelector('.row-doc-note').getAttribute('aria-label')).toContain('refresh at source')
  })

  it('keeps source-open actions separate from captured detail navigation', async () => {
    const {openUrl}=await import('../../extension/sidepanel/lib/host.mjs')
    const source='https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic'
    const record={...vehicle(),listingUrl:'https://www.bobmaxeyfordhowell.com/used-Synthetic-test',autoCheckReport:{dataState:'current',url:source,score:91,ownerCount:1,checks:[{label:'Title',status:'No title brands found'}]}}
    api.bootstrap.mockResolvedValue({...bootstrap(),vehicles:[record]})
    api.vehicle.mockResolvedValue(record)
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows','Score 91')
    document.querySelector('.row').click()
    await vi.waitFor(()=>expect(document.querySelector('.doc-source-open')).not.toBeNull())
    document.querySelector('.doc-source-open').click()
    expect(openUrl).toHaveBeenCalledWith(source)
    expect(document.querySelector('#tab-overview').getAttribute('aria-selected')).toBe('true')
    document.querySelector('.doc-autocheck').click()
    expect(document.querySelector('#tab-records').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.rec-autocheck').textContent).toContain('No title brands found')
  })

  it('opens captured records at the section start instead of keeping a deep overview scroll position', async () => {
    const record={...vehicle(),autoCheckReport:{dataState:'current',score:91,checks:[]}}
    api.bootstrap.mockResolvedValue({...bootstrap(),vehicles:[record]})
    api.vehicle.mockResolvedValue(record)
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows','Score 91')
    document.querySelector('.row').click()
    await vi.waitFor(()=>expect(document.querySelector('.doc-autocheck')).not.toBeNull())
    const detail=document.querySelector('#detail'), bar=document.querySelector('.tabs'), panel=document.querySelector('#tab-panel')
    detail.scrollTop=900
    vi.spyOn(detail,'getBoundingClientRect').mockReturnValue({top:100})
    vi.spyOn(panel,'getBoundingClientRect').mockReturnValue({top:-300})
    Object.defineProperty(bar,'offsetHeight',{value:50,configurable:true})
    Object.defineProperty(bar,'offsetTop',{value:900,configurable:true})
    document.querySelector('.doc-autocheck').click()
    expect(detail.scrollTop).toBeLessThan(450)
    expect(document.activeElement.dataset.record).toBe('autocheck')
    expect(document.querySelector('#tab-records').getAttribute('aria-selected')).toBe('true')
  })

  it('prioritizes a captured Ford action and keeps it separate from service status', async () => {
    const record={...vehicle(),serviceReadiness:{status:'serviced'},fordOasis:{dataState:'incomplete',warrantyStartDate:'2024-03-14',openFieldServiceActions:[{code:'DEMO-01',description:'Synthetic inspection action'}]},autoCheckReport:{dataState:'current',score:91,checks:[]}}
    api.bootstrap.mockResolvedValue({...bootstrap(),vehicles:[record]})
    api.vehicle.mockResolvedValue(record)
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows','Synthetic inspection action')
    expect(document.querySelector('.row-doc-summary').dataset.resource).toBe('oasis')
    expect(document.querySelector('.row .service-pill').textContent).toBe('Ready')
    document.querySelector('.row').click()
    await vi.waitFor(()=>expect(document.querySelector('.detail-calculator-toggle')).not.toBeNull())
    document.querySelector('.detail-calculator-toggle').click()
    await waitForText('#detail','Factory warranty estimate')
    expect(document.querySelector('.warr').textContent).toContain('Warranty start · OASIS')
    expect(document.querySelector('.warr').textContent.match(/03\/14\/2024/g)).toHaveLength(1)
  })

  it('uses authentic provider assets and retains captured report facts without substituting CARFAX', async () => {
    const record = { ...vehicle(),
      autoCheckReport: { dataState: 'current', score: 91, ownerCount: 1, usage: 'Personal', checks: [], scoreRangeLow: 86, scoreRangeHigh: 93 },
      factoryEquipment: { dataState: 'current', isOriginalWindowSticker: false, sourceLabel: 'vAuto informational equipment', packages: [], sections: [] },
    }
    api.bootstrap.mockResolvedValue({ ...bootstrap(), vehicles: [record] })
    api.vehicle.mockResolvedValue(record)
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'DEMO-H01')
    document.querySelector('.row').click()
    await vi.waitFor(() => expect(document.querySelector('.doc-autocheck img')).not.toBeNull())
    expect(document.querySelector('.doc-autocheck img')?.getAttribute('src')).toBe('../resource-brands/autocheck.svg')
    expect(document.querySelector('.doc-vauto img')?.getAttribute('src')).toBe('../resource-brands/vauto.svg')
    expect(document.querySelector('.doc-autocheck')?.getAttribute('aria-label')).toBe('View AutoCheck history')
    expect(document.querySelector('.doc-autocheck')?.disabled).toBe(false)
    document.querySelector('.doc-autocheck').click()
    expect(document.querySelector('#tab-records')?.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.record-brand--autocheck')?.getAttribute('alt')).toBe('AutoCheck')
    expect(document.querySelector('.record-brand--vauto')?.getAttribute('alt')).toBe('vAuto')
    expect(document.querySelector('.history-metric:first-child strong')?.textContent).toBe('91')
    expect(document.querySelector('.history-metric:first-child')?.textContent).toContain('86–93')
    expect(document.querySelector('#detail')?.textContent).not.toContain('CARFAX')
  })

  it.each([
    ['needs_service', 'Waiting for service'],
    ['in_service', 'In service'],
    ['serviced', 'Ready'],
  ])('shows the %s service label as visible text in inventory, vehicle detail, and filters', async (status, label) => {
    const record = { ...vehicle(), serviceReadiness: { status } }
    api.bootstrap.mockResolvedValue({ ...bootstrap(), vehicles: [record] })
    api.vehicle.mockResolvedValue(record)
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', label)
    expect(document.querySelector('#rows .service-pill')?.textContent).toBe(label)
    document.querySelector('.row').click()
    await waitForText('#detail .service-summary', label)
    expect(document.querySelector('#detail .service-pill')?.textContent).toBe(label)
    document.querySelector('#back').click()
    document.querySelector('#filters-btn').click()
    const option = document.querySelector(`#service-filter-buttons button[data-service-status="${status}"]`)
    expect(option?.textContent).toBe(label)
    expect([...document.querySelectorAll('#service-filter-buttons button')].map((button) => button.textContent)).toEqual(['All', 'Waiting for service', 'In service', 'Ready'])
    expect(document.querySelector('#service-select')).toBeNull()
  })

  it('shows unconfirmed inventory waiting and exposes service without a submenu', async () => {
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'Waiting for service')
    document.querySelector('.row').click()
    await waitForText('#detail .service-summary', 'Waiting for service')
    expect(document.querySelector('#detail .service-summary').textContent).not.toMatch(/Completed|Manager-confirmed/)
    expect(document.querySelector('#detail .service-update').textContent).toBe('Service')
    expect(document.querySelector('#detail .dock-more')).toBeNull()
    expect(document.querySelector('#detail').firstElementChild.className).toBe('d-head')
  })

  it('filters Ready in the service-first filter panel while preserving Waiting and store scope', async () => {
    const ready = { ...vehicle(), serviceReadiness: { status: 'serviced' } }
    const waiting = { ...vehicle('Howell', 'TESTDATAHWELL0002'), serviceReadiness: { status: 'needs_service' } }
    const lincolnReady = { ...vehicle('Lincoln', 'TESTDATALNCN00001'), serviceReadiness: { status: 'serviced' } }
    api.bootstrap.mockResolvedValue({ ...bootstrap(), vehicles: [ready, waiting, lincolnReady] })
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'Waiting for service')
    document.querySelector('#filters-btn').click()
    document.querySelector('[data-service-status="serviced"]').click()
    expect(document.querySelector('[data-service-status="serviced"]').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelectorAll('#rows .row')).toHaveLength(1)
    expect(document.querySelector('#rows').textContent).not.toContain('Waiting for service')
    document.querySelector('#sheet-close').click()
    document.querySelector('#expand-stores button').click()
    expect(document.querySelectorAll('#rows .row')).toHaveLength(2)
    document.querySelector('#filters-btn').click()
    expect(document.querySelector('[data-service-status="serviced"]').getAttribute('aria-pressed')).toBe('true')
    document.querySelector('[data-service-status=""]').click()
    expect(document.querySelectorAll('#rows .row')).toHaveLength(3)
  })

  it('opens the new app workspaces on the demo app origin, not the static extension preview origin', async () => {
    const { openUrl } = await import('../../extension/sidepanel/lib/host.mjs')
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#workspace-links', 'New')
    document.querySelector('#workspace-links [aria-label="New inventory (opens in app)"]').click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/updates?view=new')
    document.querySelector('#workspace-links [aria-label="Price changes (opens in app)"]').click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/updates?view=price')
  })

  it('opens a direct move for a manager viewing inventory owned by their store', async () => {
    const { openUrl } = await import('../../extension/sidepanel/lib/host.mjs')
    api.bootstrap.mockResolvedValue(bootstrap('Howell', 'manager'))
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'DEMO-H01')
    document.querySelector('#row-TESTDATAHWELL0001').click()
    await waitForText('.dock-primary', 'Move vehicle')
    document.querySelector('.dock-primary button:last-child').click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/transfers/new?vin=TESTDATAHWELL0001&intent=direct')
  })

  it('opens an inbound request for a salesperson viewing another store\'s vehicle', async () => {
    const { openUrl } = await import('../../extension/sidepanel/lib/host.mjs')
    api.bootstrap.mockResolvedValue(bootstrap('Howell', 'sales'))
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'DEMO-H01')
    document.querySelector('#expand-stores button').click()
    document.querySelector('#row-TESTDATALNCN00001').click()
    await waitForText('.dock-primary', 'Request vehicle')
    document.querySelector('.dock-primary button:last-child').click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/transfers/new?vin=TESTDATALNCN00001&intent=request')
  })

  it('keeps View move and adds Move again for a server-authorized active direct move', async () => {
    const { openUrl } = await import('../../extension/sidepanel/lib/host.mjs')
    const reroutable = {
      ...vehicle(),
      movement: {
        transferId: 'direct-move-1',
        state: 'at_requesting_store',
        currentLocation: 'Ford Detroit',
        locationConfidence: 'verified',
        newRequestBlocked: true,
        canDirectReroute: true,
      },
    }
    api.bootstrap.mockResolvedValue({ ...bootstrap('Howell', 'group_manager'), vehicles: [reroutable] })
    api.vehicle.mockResolvedValue(reroutable)
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'DEMO-H01')
    document.querySelector('#row-TESTDATAHWELL0001').click()
    await waitForText('.dock-primary', 'Move again')
    const dock = document.querySelector('.dock-primary')
    expect(dock.textContent).toContain('View move')
    dock.querySelectorAll('button')[1].click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/transfers?id=direct-move-1')
    dock.querySelectorAll('button')[2].click()
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:4173/transfers/new?vin=TESTDATAHWELL0001&intent=direct')
  })

  it('keeps Held local, expands explicitly, then returns to the working store with the query intact', async () => {
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#result-context', '1 vehicle · Howell')
    const search = document.querySelector('#q')
    search.value = 'Ford'; search.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#scope-held').click()
    expect(document.querySelector('#result-context').textContent).toContain('1 held vehicle · Howell')
    document.querySelector('#expand-stores button').click()
    expect(document.querySelector('#result-context').textContent).toContain('2 held vehicles · all stores')
    expect([...document.querySelectorAll('.store-group')].map((row) => row.textContent)).toEqual(['Howell · My store1', 'Lincoln1'])
    expect(search.value).toBe('Ford')
    document.querySelector('#store-home').click()
    expect(document.querySelector('#result-context').textContent).toContain('1 held vehicle · Howell')
    expect(search.value).toBe('Ford')
  })

  it('removes prior private content when a refresh fails authentication', async () => {
    const { PanelApiError } = await import('../../extension/sidepanel/lib/api.mjs')
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'Synthetic Private Person')
    document.querySelector('.row').click()
    await vi.waitFor(()=>expect(document.querySelector('#tab-hold')).not.toBeNull())
    document.querySelector('#tab-hold').click()
    await waitForText('#detail', 'Synthetic Private Person')
    api.bootstrap.mockRejectedValueOnce(new PanelApiError('signin'))
    document.querySelector('#refresh').click()
    await waitForText('#status', 'Sign in to Inventory Flow')
    expect(document.querySelector('#rows').textContent).toBe('')
    expect(document.querySelector('#detail').textContent).toBe('')
    expect(document.querySelector('.d-utilities')).toBeNull()
    expect(document.querySelector('#panel').dataset.view).toBe('list')
    expect(document.querySelector('#workspace-links').hidden).toBe(true)
  })

  it('discards a late detail response after the signed-in identity changes', async () => {
    let resolveDetail
    api.vehicle.mockReturnValueOnce(new Promise((resolve) => { resolveDetail = resolve }))
    await import('../../extension/sidepanel/panel.js')
    await waitForText('#rows', 'DEMO-H01')
    document.querySelector('.row').click()
    const redacted = bootstrap('Lincoln', 'sales')
    redacted.vehicles = redacted.vehicles.map((record) => ({ ...record, hold: { state: 'primary', canViewEvidence: false } }))
    api.bootstrap.mockResolvedValueOnce(redacted)
    document.querySelector('#refresh').click()
    await waitForText('#result-context', '1 vehicle · Lincoln')
    resolveDetail({ ...vehicle(), privateEvidence: { primary: { salesperson: 'Late Private Detail' } } })
    await Promise.resolve(); await Promise.resolve()
    expect(document.body.textContent).not.toContain('Late Private Detail')
    expect(document.body.textContent).not.toContain('Synthetic Private Person')
    expect(document.querySelector('#detail').textContent).toBe('')
  })
})
