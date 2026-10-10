// @vitest-environment jsdom
// @ts-nocheck -- Unbundled extension UI exercised with synthetic source records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import markup from '../../extension/sidepanel/index.html?raw'

const api = vi.hoisted(() => ({ bootstrap: vi.fn(), vehicle: vi.fn() }))
vi.mock('../../extension/sidepanel/lib/api.mjs', async (importOriginal) => ({ ...(await importOriginal()), fetchBootstrap: api.bootstrap, fetchVehicle: api.vehicle }))
vi.mock('../../extension/sidepanel/lib/host.mjs', () => ({
  host: 'preview', previewFlags: { photos: false }, placeholderPhotos: () => [], copyText: vi.fn(), openUrl: vi.fn(), openExtensionPage: vi.fn(),
  storage: { getSettings: async () => ({ workspace: 'demo', theme: 'light', density: 'comfortable', demoRole: 'manager', demoStore: 'Howell' }), getCompare: async () => [], getFilters: async () => null, takePendingQuery: async () => null, onPendingQuery: () => {}, getCache: async () => null, setCache: async () => {}, clearCache: async () => {}, setCompare: async () => {}, setFilters: async () => {} },
}))
const fixture = () => ({
  fixtureMarker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS', vin: 'TESTDATA000000001', stockNumber: 'DEMO-RECORDS', vehicleName: '2024 Ford Synthetic Records Vehicle', make: 'Ford', model: 'Synthetic', homeStore: 'Howell', listedPrice: 32000,
  hold: { state: 'none_observed', canViewEvidence: false, backupCount: 0 },
})
const recordWithSources = () => ({ ...fixture(),
  autoCheckReport: { dataState: 'stale_unverified', url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=SYNTHETIC&ac=TEST-REPORT', score: 72, scoreRangeLow: 70, scoreRangeHigh: 89, ownerCount: 2, usage: 'Synthetic rental use', lastReportedOdometer: 23456, lastReportedOdometerDate: '2026-09-01', reportRunAt: '2026-09-01T10:00:00Z', checks: Array.from({ length: 6 }, (_, index) => ({ label: `Synthetic history check ${index + 1}`, status: index === 5 ? 'Problem Reported' : 'No issue reported', detail: index === 5 ? 'Synthetic salvage record requires review' : 'Synthetic detail' })) },
  windowSticker: { dataState: 'current', url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/123/window-sticker?sv=SYNTHETIC&make=Ford&vehicleType=Used', vehicleDescription: 'Synthetic Canadian build', basePrice: 42000, totalOptions: 3000, destinationCharge: 2000, totalMsrp: 47000, pricingCurrency: 'CAD', originalMarket: 'Canada', equipmentGroup: 'Synthetic 302A', engine: 'Synthetic 3.5L engine', transmission: 'Synthetic 10-speed', exteriorColor: 'Synthetic blue', interiorColor: 'Synthetic black', options: ['Synthetic tow option 53A — CAD 995', 'Synthetic roof option — CAD 2,005'], standardEquipment: ['Synthetic lane keeping', 'Synthetic reverse camera'], warranty: ['Synthetic warranty term: 36 months'] },
  factoryEquipment: { dataState: 'current', sourceLabel: 'Synthetic vAuto label', url: 'https://assets.cai-media-management.com/window-stickers/123e4567-e89b-42d3-a456-426614174000.jpg', totalMsrp: 46000, engine: 'Synthetic V6', capturedAt: '2026-09-01T10:00:00Z', packages: [{ name: 'Synthetic Tech package', code: 'TECH', price: 2000, features: ['Synthetic head-up display', 'Synthetic parking sensors'] }], sections: [{ name: 'Synthetic safety equipment', items: [{ label: 'Synthetic adaptive cruise', price: 800 }, { label: 'Synthetic blind-spot warning', price: 0 }] }], disclaimer: 'Synthetic vAuto informational equipment label — not an original window sticker.' },
  fordOasis: { dataState: 'current', capturedAt: '2026-09-01T10:00:00Z', sourceLabel: 'Synthetic Ford OASIS capture', warrantyStartDate: '2024-04-10', buildDate: '2024-02-02', releaseDate: '2024-02-10', monthsInService: 28, saleMileage: 15, openFieldServiceActions: [{ code: 'TEST-26A', description: 'Synthetic service-action description' }], warrantyCoverages: [{ type: 'Synthetic powertrain', description: 'Synthetic Ford coverage term' }], extendedCoverageExpirations: ['Synthetic ESP expiration 2029-04-10'], serviceHistory: { dataState: 'current', checkedAt: '2026-09-01T11:00:00Z', historyCaptured: true, repairOrderCount: 4, detailScanCount: 2, inspectionSearchStatus: 'confirmed', latestRepairOrder: { repairOrderNumber: '12345', dealerCode: '00001', openDate: '08/25/2026', closeDate: '08/26/2026', odometer: 23200, detailComplete: true, inspection: { status: 'confirmed', type: 'Used-car inspection' }, parts: [], laborOperations: [], services: ['Used-car inspection', 'Oil and filter service'] }, recentRepairOrders: [{ repairOrderNumber: '12345', dealerCode: '00001', openDate: '08/25/2026', closeDate: '08/26/2026', odometer: 23200, detailComplete: true, inspection: { status: 'confirmed', type: 'Used-car inspection' }, parts: [], laborOperations: [], services: ['Used-car inspection', 'Oil and filter service'] }, { repairOrderNumber: '12000', dealerCode: '00001', openDate: '05/10/2026', closeDate: '05/10/2026', odometer: 20000, detailComplete: true, inspection: { status: 'not_identified' }, parts: [], laborOperations: [], services: ['Tire inspection/service'] }] } },
  warrantyCheck: { dataState: 'current', capturedAt: '2026-09-01T10:00:00Z', mileageEntered: 23456, mileageSource: 'Synthetic listed odometer', fordOasis: { warrantyStartDate: '2024-04-10', monthsInService: 28, coverages: [{ type: 'Synthetic Ford basic', termText: '36 months / 36,000 miles', remainingTimeText: '8 months', remainingMilesText: '12,544 miles', status: 'ACTIVE' }] }, autoCheck: { inServiceDate: '2024-04-15', defaultMileage: 20000, coverages: [{ type: 'Synthetic AutoCheck basic', termText: '36 months / 36,000 miles', remainingTimeText: '9 months', remainingMilesText: '12,544 miles', status: 'ACTIVE', note: 'Synthetic estimate only' }] } },
})

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/g, '')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 0 })
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function openRecords(record = recordWithSources()) {
  api.bootstrap.mockResolvedValue({ access: { user: 'synthetic-manager', role: 'manager', store: 'Howell' }, meta: { publicFreshness: 'current', dealerMailFreshness: 'current', reportDate: '2026-09-14' }, stores: [], transfers: [], vehicles: [record] })
  api.vehicle.mockResolvedValue(record)
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelector('#rows .row')).not.toBeNull())
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(document.querySelector('#tab-records')).not.toBeNull())
  document.querySelector('#tab-records').click()
  await vi.waitFor(() => expect(document.querySelector('.rec')).not.toBeNull())
  return document.querySelector('#detail')
}

describe('extension captured Records detail parity', () => {
  it('puts history and OASIS coverage before long sticker and equipment lists with matching named jumps', async () => {
    const detail = await openRecords()
    expect([...detail.querySelectorAll('#tab-panel > [data-record]')].map((node) => node.dataset.record)).toEqual(['autocheck', 'oasis', 'warranty', 'window-sticker', 'vauto'])
    expect([...detail.querySelectorAll('.record-jumps button')].map((node) => node.textContent)).toEqual(['AutoCheck', 'OASIS & warranty', 'Warranty check', 'Sticker', 'Equipment'])
  })
  it('summarizes captured history without turning missing or adverse checks into clean results', async () => {
    const record = recordWithSources()
    record.autoCheckReport.checks.push({ label: 'Service history', status: 'Records reported', detail: '2 synthetic service records' }, { label: 'Open recall check', status: 'Not reported' })
    const detail = await openRecords(record)
    const summary = detail.querySelector('.history-metrics')
    expect(summary.querySelectorAll('.history-metric')).toHaveLength(5)
    expect(summary.textContent).toContain('2 synthetic service records')
    expect(summary.closest('details')).toBeNull()
    expect(detail.querySelectorAll('.rec-autocheck .check.is-clear')).toHaveLength(5)
    expect(detail.querySelectorAll('.rec-autocheck .check.is-unknown')).toHaveLength(1)
    expect([...detail.querySelectorAll('.rec-autocheck .check.is-review')].some((node) => node.textContent.includes('Synthetic salvage record requires review'))).toBe(true)
    expect(detail.querySelector('.rec-autocheck .check.is-unknown').textContent).toContain('Not reported')
  })
  it('keeps original sticker pricing visible and vAuto reference pricing in an optional supplement', async () => {
    // The original sticker is authoritative; repeating the full vAuto block
    // by default duplicated equipment and pricing in the old Records layout.
    const detail = await openRecords()
    const supplement = detail.querySelector('[data-record="vauto"]')
    expect(supplement.tagName).toBe('DETAILS')
    expect(supplement.open).toBe(false)
    expect(supplement.querySelector('summary').textContent).toBe('Additional vAuto equipment')
    expect(detail.querySelector('[data-record="window-sticker"] .price-table').closest('details')).toBeNull()
    supplement.querySelector('summary').click()
    expect(supplement.open).toBe(true)
    expect(supplement.querySelector('.price-table')).not.toBeNull()
    expect(supplement.querySelector('.rec-price-context').textContent).toBe('Reference pricing')
    expect(supplement.querySelector('.rec-priced-list')).not.toBeNull()
  })
  it('keeps Ford timeline visits without repair-order IDs and prefers them over provider histories', async () => {
    const record = recordWithSources()
    record.fordOasis.serviceHistory = { dataState: 'current', checkedAt: '2026-09-01T11:00:00Z', repairOrderCount: 1, detailScanCount: 0, repairOrderTimeline: [{ openDate: '2026-08-25', closeDate: '2026-08-26', odometer: 23200, services: ['Synthetic OEM visit without an ID'], repairOrderNumber: 'PRIVATE_MARKER' }] }
    record.serviceHistory = { reports: [{ vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX report', capturedAt: '2026-09-01T11:00:00Z', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2025-05-01', odometer: 12000, odometerUnit: 'mi', services: ['Synthetic CARFAX visit'] }] }] }
    const detail = await openRecords(record)
    const history = detail.querySelector('.rec-service')
    expect(history.textContent).toContain('Synthetic OEM visit without an ID')
    expect(history.textContent).toContain('08/25/2026 · 08/26/2026')
    expect(history.textContent).not.toContain('PRIVATE_MARKER')
    expect(history.querySelector('.rec-history-secondary').open).toBe(false)
    expect(history.querySelector('.rec-history-secondary summary').textContent).toBe('CARFAX service history')
  })
  it('renders the date-only OEM repair timeline when no provider reports exist', async () => {
    const record = recordWithSources()
    delete record.autoCheckReport
    delete record.serviceHistory
    record.fordOasis.serviceHistory = { dataState: 'current', checkedAt: '2026-09-01T11:00:00Z', repairOrderCount: 1, detailScanCount: 0, repairOrderTimeline: [{ openDate: '2026-08-25', closeDate: '2026-08-26', odometer: 23200, services: ['Synthetic OEM timeline-only visit'] }] }
    const detail = await openRecords(record)
    const history = detail.querySelector('.rec-service')
    expect(history).not.toBeNull()
    expect(history.textContent).toContain('Synthetic OEM timeline-only visit')
    expect(history.textContent).toContain('08/25/2026 · 08/26/2026')
    expect(history.querySelectorAll('.rec-history-secondary')).toHaveLength(0)
  })
  it('uses current AutoCheck before retained CARFAX when OEM visits are absent and keeps both sources', async () => {
    const record = recordWithSources()
    delete record.fordOasis.serviceHistory
    record.serviceHistory = { reports: [
      { vin: record.vin, provider: 'autocheck', sourceLabel: 'Synthetic AutoCheck', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2025-02-01', services: ['Synthetic AutoCheck visit'] }] },
      { vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX', dataState: 'retained', historyStatus: 'reported', entries: [{ date: '2025-03-01', odometer: 15000, odometerUnit: 'mi', services: ['Synthetic CARFAX visit'] }] },
    ] }
    const detail = await openRecords(record)
    const history = detail.querySelector('.rec-service')
    expect(history.querySelector('.rec-section h4').textContent).toBe('AutoCheck service history')
    expect(history.querySelector('.rec-section').textContent).toContain('Synthetic AutoCheck visit')
    expect(history.querySelectorAll('.rec-history-secondary')).toHaveLength(1)
    expect(history.querySelector('.rec-history-secondary').open).toBe(false)
    expect(history.querySelector('.rec-history-secondary .rec-section').textContent).toContain('Synthetic CARFAX visit')
  })
  it.each(['stale_unverified', 'incomplete'])('prefers current OEM timeline over %s provider OEM and retains the provider report', async dataState => {
    const record = recordWithSources()
    record.fordOasis.serviceHistory.repairOrderTimeline = [{ openDate: '2026-08-25', closeDate: '2026-08-26', odometer: 23200, services: ['Synthetic current OEM timeline'] }]
    record.serviceHistory = { reports: [{ vin: record.vin, provider: 'oem', sourceLabel: 'Synthetic retained OEM report', capturedAt: '2026-08-01T11:00:00Z', dataState, historyStatus: 'reported', entries: [{ date: '2025-05-01', services: ['Synthetic retained OEM work'] }] }] }
    const detail = await openRecords(record)
    const regions = within(detail).getAllByRole('region', { name: 'OEM service history' })
    expect(regions).toHaveLength(2)
    expect(regions.find(region => !region.closest('details')).textContent).toContain('Synthetic current OEM timeline')
    const retained = regions.find(region => region.closest('details'))
    expect(retained.textContent).toContain('Synthetic retained OEM work')
    expect(retained.textContent).toContain(dataState)
    expect(retained.closest('details').open).toBe(false)
  })
  it('prefers current provider OEM before retained legacy OEM and current external history without dropping alternatives', async () => {
    const record = recordWithSources()
    record.fordOasis.serviceHistory.dataState = 'stale_unverified'
    record.serviceHistory = { reports: [
      { vin: record.vin, provider: 'oem', sourceLabel: 'Synthetic current OEM report', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-08-29', services: ['Synthetic current provider OEM work'] }] },
      { vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic current CARFAX', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-08-28', services: ['Synthetic current CARFAX work'] }] },
    ] }
    const detail = await openRecords(record)
    const regions = within(detail).getAllByRole('region', { name: 'OEM service history' })
    expect(regions).toHaveLength(2)
    expect(regions.find(region => !region.closest('details')).textContent).toContain('Synthetic current provider OEM work')
    expect(regions.find(region => region.closest('details')).textContent).toContain(' · stale · ')
    expect(within(detail).getByRole('region', { name: 'CARFAX service history' }).textContent).toContain('Synthetic current CARFAX work')
  })
  it.each(['current', 'stale_unverified'])('ranks %s external history by freshness before provider preference and retains all evidence', async externalState => {
    const record = recordWithSources()
    delete record.fordOasis.serviceHistory
    record.serviceHistory = { reports: [
      { vin: record.vin, provider: 'oem', sourceLabel: 'Synthetic retained OEM', dataState: 'stale_unverified', historyStatus: 'reported', entries: [{ date: '2025-05-01', services: ['Synthetic retained OEM work'] }] },
      { vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX', dataState: externalState, historyStatus: 'reported', entries: [{ date: '2026-08-28', services: ['Synthetic CARFAX work'] }] },
    ] }
    const detail = await openRecords(record)
    const oem = within(detail).getByRole('region', { name: 'OEM service history' })
    const carfax = within(detail).getByRole('region', { name: 'CARFAX service history' })
    expect(oem.textContent).toContain('Synthetic retained OEM work')
    expect(carfax.textContent).toContain('Synthetic CARFAX work')
    const primary = externalState === 'current' ? carfax : oem
    const secondary = externalState === 'current' ? oem : carfax
    expect(primary.closest('details')).toBeNull()
    expect(secondary.closest('details').open).toBe(false)
  })
  it('does not promote an inner current timeline when the enclosing OEM capture is stale', async () => {
    const record = recordWithSources()
    record.fordOasis.dataState = 'stale_unverified'
    record.serviceHistory = { reports: [{ vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic current CARFAX', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-08-28', services: ['Synthetic current CARFAX work'] }] }] }
    const detail = await openRecords(record)
    const carfax = within(detail).getByRole('region', { name: 'CARFAX service history' })
    expect(carfax.closest('details')).toBeNull()
    const oem = within(detail).getByRole('region', { name: 'OEM service history' })
    expect(oem.closest('details').open).toBe(false)
    expect(oem.textContent).toContain(' · stale · ')
  })
  it('shows a CARFAX warranty estimate without OEM data and leaves unknown estimates unknown', async () => {
    const record = recordWithSources()
    delete record.fordOasis
    record.warrantyCheck = { dataState: 'current', capturedAt: '2026-09-01T10:00:00Z', mileageEntered: 23456, mileageSource: 'Synthetic listed odometer', carfax: { inServiceDate: '2024-04-15', inServiceAgeMonths: 29, coverages: [
      { type: 'Synthetic CARFAX basic', remainingMonths: 8, remainingTimeText: '8 months', remainingMilesText: '12,000 miles' },
      { type: 'Synthetic CARFAX powertrain', remainingMonths: 20, remainingTimeText: '20 months' },
    ] } }
    const detail = await openRecords(record)
    const warranty = detail.querySelector('.rec-warranty')
    expect(warranty.textContent).toContain('CARFAX warranty estimate')
    expect(warranty.textContent).toContain('Synthetic CARFAX powertrain')
    expect(warranty.textContent).toContain('Synthetic CARFAX basic')
    expect(warranty.textContent).toContain('8 months')
    expect(warranty.textContent).toContain('20 months')
    expect(warranty.textContent).toContain('12,000 miles')
    expect(warranty.querySelectorAll('.rec-coverage')).toHaveLength(2)
    expect(warranty.textContent).not.toContain('manufacturer coverage')
    expect(warranty.textContent).toContain('23,456 mi · Synthetic listed odometer')
    expect(warranty.textContent).toContain('Report miles remaining')
    expect(warranty.querySelector('.rec-source')).toBeNull()
    expect(warranty.querySelector('.rec-heading button')).toBeNull()
  })

  it('renders status-only CARFAX warranty categories without inventing terms or remaining balances', async () => {
    const record = recordWithSources()
    delete record.fordOasis
    record.warrantyCheck = { dataState: 'current', capturedAt: '2026-09-01T10:00:00Z', mileageEntered: 23456, carfax: { coverages: [
      { type: 'Basic Warranty', status: 'EXPIRED' },
      { type: 'Corrosion', status: 'ACTIVE' },
      { type: 'Emissions', status: 'N/A' },
    ] } }
    const warranty = (await openRecords(record)).querySelector('.rec-warranty')
    const rows = [...warranty.querySelectorAll('.rec-coverage')]
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual(['Basic WarrantyEXPIRED', 'CorrosionACTIVE', 'EmissionsN/A'])
    expect(warranty.textContent).not.toMatch(/Printed term|Report time remaining|Report miles remaining/)
  })

  it('calculates only structured mileage terms from current vehicle mileage and keeps supplied estimates distinct', async () => {
    const record = recordWithSources()
    delete record.fordOasis
    record.mileage = 40000
    record.warrantyCheck = { dataState: 'current', capturedAt: '2026-09-01T10:00:00Z', mileageEntered: 35000, mileageSource: 'Synthetic report basis', carfax: { coverages: [
      { type: 'Synthetic below-limit', status: 'ACTIVE', termMiles: 60000, termText: 'Printed synthetic term', remainingMiles: 57000, remainingMilesText: '57,000 report-supplied miles' },
      { type: 'Synthetic above-limit', status: 'EXPIRED', termMiles: 36000 },
      { type: 'Synthetic unknown structured term', status: 'ACTIVE', termText: '60,000 miles shown as source text' },
      { type: 'Synthetic unlimited', status: 'ACTIVE', termMiles: 60000, unlimitedMiles: true },
    ] } }
    const warranty = (await openRecords(record)).querySelector('.rec-warranty')
    const rows = [...warranty.querySelectorAll('.rec-coverage')]
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Coverage limit60,000 mi')
    expect(rows[0].textContent).toContain('Current vehicle mileage40,000 mi')
    expect(rows[0].textContent).toContain('Calculated miles remaining20,000 mi')
    expect(rows[0].textContent).toContain('Report miles remaining57,000 report-supplied miles')
    expect(rows[1].textContent).toContain('Calculated miles remaining0 mi')
    expect(rows[2].textContent).not.toContain('Calculated miles remaining')
    expect(rows[2].textContent).not.toContain('Coverage limit')
    expect(rows[3].textContent).not.toContain('Calculated miles remaining')
    expect(warranty.textContent).toContain('Mileage basis35,000 mi · Synthetic report basis')
  })

  it('does not assume miles when a service entry has no odometer unit', async () => {
    const record = recordWithSources()
    delete record.fordOasis
    record.serviceHistory = { reports: [{ vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX', dataState: 'current', historyStatus: 'reported', entries: [{ date: '2025-03-01', odometer: 12000, services: ['Synthetic unitless visit'] }] }] }
    const detail = await openRecords(record)
    const history = detail.querySelector('.rec-service')
    expect(history.textContent).toContain('12,000')
    expect(history.textContent).not.toContain('12,000 mi')
  })
  it('retains service counts from the status and keeps full findings visible beside the compact summary', async () => {
    const record = recordWithSources()
    record.autoCheckReport.checks = [
      { label: 'Service history', status: '12 service records reported', detail: 'Synthetic inspection history available' },
      { label: 'Odometer', status: 'No issue reported', detail: 'Last reported odometer: 23,456 mi; conflicting reading: 20,000 mi' },
      { label: 'CPO', status: 'No issue reported', detail: 'CPO details not captured; last reported odometer: 23,456 mi' },
    ]
    const detail = await openRecords(record)
    expect(detail.querySelector('.history-metrics').textContent).toContain('12 service records reported')
    const checks = [...detail.querySelectorAll('.rec-autocheck .check')]
    record.autoCheckReport.checks.forEach((source, index) => {
      expect(checks[index].textContent).toContain(source.status)
      expect(checks[index].textContent).toContain(source.detail)
      expect(checks[index].closest('details')).toBeNull()
    })
    expect(checks[1].classList.contains('is-review')).toBe(true)
    expect(checks[2].classList.contains('is-unknown')).toBe(true)
  })
  it('shows every history check, warning and report fact without an expander', async () => {
    const detail = await openRecords()
    expect(detail.querySelectorAll('.rec-autocheck .check')).toHaveLength(6)
    expect(detail.textContent).toContain('Synthetic salvage record requires review')
    expect(detail.textContent).toContain('2 reported')
    expect(detail.textContent).toContain('Synthetic rental use')
    expect(detail.textContent).toContain('23,456 mi')
    expect(detail.querySelector('.rec-autocheck .rec-state')).toBeNull()
    expect(detail.querySelectorAll('.rec details .check')).toHaveLength(0)
    expect(detail.querySelector('.rec-autocheck .rec-source-details')).toBeNull()
    expect(detail.querySelector('.record-brand--autocheck').getAttribute('alt')).toBe('AutoCheck')
  })
  it('shows sticker currency, equipment, options, standard items and printed warranty directly', async () => {
    const detail = await openRecords()
    for (const text of ['CAD 47,000', 'Synthetic 302A', 'Synthetic 3.5L engine', 'Synthetic tow option 53A', 'Synthetic lane keeping', 'Synthetic warranty term: 36 months']) expect(detail.textContent.replace(/\s/g, ' ')).toContain(text)
    expect(detail.textContent).toContain('Review the window sticker for full configuration and warranty terms.')
  })
  it('shows vAuto package contents, individual price lines and original-document disclaimer', async () => {
    const detail = await openRecords()
    const label = detail.querySelector('.record-brand--vauto').closest('.rec')
    for (const text of ['Synthetic Tech package', 'TECH', '2,000', 'Synthetic head-up display', 'Synthetic adaptive cruise', '800', 'Synthetic blind-spot warning', '0', 'Reference pricing']) expect(label.textContent).toContain(text)
    expect(label.textContent).not.toMatch(/\$|USD/)
  })
  it('shows useful OASIS data with a direct lookup action', async () => {
    const detail = await openRecords()
    const oasis = detail.querySelector('.rec-oasis')
    for (const text of ['Warranty start', '04/10/2024', 'Build date', '02/02/2024', 'TEST-26A', 'Synthetic service-action description', 'Ford service history · 4 repair orders', '08/25/2026 to 08/26/2026', 'Oil and filter service', 'Tire inspection/service', 'Synthetic Ford coverage term', 'Synthetic ESP expiration']) expect(oasis.textContent).toContain(text)
    expect(oasis.textContent).not.toContain('12345')
    expect(oasis.textContent).not.toContain('00001')
    expect(oasis.querySelector('.rec-source').textContent).toContain('Open OASIS')
    expect(oasis.querySelector('.rec-source').getAttribute('aria-label')).toContain('Open OASIS')
    expect(oasis.textContent).not.toContain('not a saved report')
  })

  it('labels Certified Blue Oval only when Ford service history explicitly captured it', async () => {
    const record = recordWithSources()
    record.fordOasis.serviceHistory.certifiedInspection = {
      repairOrderNumber: '12001', dealerCode: '00001', openDate: '08/10/2026', closeDate: '08/11/2026', odometer: 23000,
      detailComplete: true, inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
      parts: [], laborOperations: [], services: ['Certified Blue Oval inspection'],
    }
    const detail = await openRecords(record)
    const oasis = detail.querySelector('.rec-oasis')
    expect(oasis.querySelector('.rec-service-certification').textContent).toContain('Certified Blue Oval inspection')
    expect(oasis.querySelector('.rec-service-certification').textContent).toContain('08/11/2026')
  })

  it('renders decoded OASIS descriptions as safe text, leaving source evidence intact', async () => {
    const record = recordWithSources()
    const encoded = 'REAR AXLE &#x25B4; &amp; &lt;img src=x onerror=alert(1)&gt;'
    record.fordOasis.openFieldServiceActions[0].description = encoded
    record.fordOasis.warrantyCoverages[0].description = '5 years &amp; 60,000 miles'
    const detail = await openRecords(record)
    const oasis = detail.querySelector('.rec-oasis')
    expect(oasis.textContent).toContain('REAR AXLE ▴ & <img src=x onerror=alert(1)>')
    expect(oasis.textContent).toContain('5 years & 60,000 miles')
    expect(oasis.querySelector('.rec-list img')).toBeNull()
    expect(oasis.querySelector('[onerror]')).toBeNull()
    expect(record.fordOasis.openFieldServiceActions[0].description).toBe(encoded)
  })
  it('keeps Ford coverage and AutoCheck estimates distinct with mileage and captured remaining terms', async () => {
    const detail = await openRecords()
    const warranty = detail.querySelector('.rec-warranty')
    for (const text of ['Ford OASIS coverage', 'AutoCheck warranty estimate', 'Synthetic Ford basic', 'Synthetic AutoCheck basic', '8 months', '9 months', '12,544 miles', '23,456 mi', 'AutoCheck default mileage', '20,000 mi']) expect(warranty.textContent).toContain(text)
    expect(warranty.textContent).toContain('Verify current coverage with the store')
  })
  it('opens approved documents from separate heading actions', async () => {
    const detail = await openRecords()
    const { openUrl } = await import('../../extension/sidepanel/lib/host.mjs')
    const button = detail.querySelector('.rec-autocheck .rec-heading button')
    expect(button.textContent).toContain('Open report')
    expect(button.getAttribute('aria-label')).toBe('Open AutoCheck report for DEMO-RECORDS')
    button.click()
    expect(openUrl).toHaveBeenCalledWith('https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=SYNTHETIC&ac=TEST-REPORT')
    expect(document.querySelector('#tab-records').getAttribute('aria-selected')).toBe('true')
  })
  it('retains saved facts but does not render unsafe source actions', async () => {
    const record = recordWithSources()
    record.autoCheckReport.url = 'javascript:alert(1)'
    record.windowSticker.url = 'https://unapproved.invalid/sticker'
    record.factoryEquipment.url = 'https://unapproved.invalid/label'
    const detail = await openRecords(record)
    expect(detail.querySelector('.rec-autocheck .rec-source')).toBeNull()
    expect(detail.textContent).toContain('Details unavailable')
    expect(detail.textContent).not.toContain('link not captured')
    expect(detail.textContent).toContain('Synthetic tow option')
  })
  it('does not turn a missing OASIS capture or an empty action array into an all-clear claim', async () => {
    const detail = await openRecords(fixture())
    expect(detail.textContent).toContain('Open OASIS to check this vehicle')
    expect(detail.querySelector('.rec-oasis').textContent).not.toMatch(/0 open|No open|All clear|Ready/)
  })
  it('keeps an empty incomplete action list explicitly unverified', async () => {
    const record = recordWithSources()
    record.fordOasis = { dataState: 'incomplete', openFieldServiceActions: [] }
    const detail = await openRecords(record)
    expect(detail.querySelector('.rec-oasis').textContent).toContain('Verify current actions in OASIS')
    expect(detail.querySelector('.rec-oasis').textContent).not.toMatch(/0 open|No open|All clear|Ready/)
  })
  it('distinguishes a captured zero from an unverified action result', async () => {
    const record = recordWithSources()
    record.fordOasis = { dataState: 'current', openActionsCaptured: true, openFieldServiceActions: [] }
    const detail = await openRecords(record)
    const oasis = detail.querySelector('.rec-oasis').textContent
    expect(oasis).toContain('No open Ford service actions in the captured report.')
    expect(oasis).not.toContain('Verify current actions in OASIS')
  })
  it.each([
    ['2099-09-14T12:00:00Z', 'Future source date:'],
    ['not-a-date', 'Unrecognized source date: not-a-date'],
    ['2026-02-30T12:00:00Z', 'Unrecognized source date: 2026-02-30T12:00:00Z'],
  ])('keeps technical capture-date diagnostics out of manager records for source date %s', async (date, expected) => {
    const record = recordWithSources()
    record.autoCheckReport.reportRunAt = date
    record.factoryEquipment.capturedAt = date
    record.fordOasis.capturedAt = date
    record.warrantyCheck.capturedAt = date
    const detail = await openRecords(record)
    for (const section of [detail.querySelector('.rec-autocheck'), detail.querySelector('.record-brand--vauto').closest('.rec'), detail.querySelector('.rec-oasis'), detail.querySelector('.rec-warranty')]) {
      expect(section.textContent).not.toContain(expected)
      expect(section.querySelector('.rec-source-details')).toBeNull()
    }
  })
  it('preserves decimal source numerals without inventing vAuto currency', async () => {
    const record = recordWithSources()
    record.factoryEquipment.packages[0].price = 2345.67
    record.factoryEquipment.sections[0].items[0].price = 890.12
    const detail = await openRecords(record)
    const label = detail.querySelector('.record-brand--vauto').closest('.rec')
    expect(label.textContent).toContain('2,345.67')
    expect(label.textContent).toContain('890.12')
    expect(label.textContent).not.toMatch(/\$|USD/)
  })
})
