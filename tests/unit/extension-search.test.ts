// @vitest-environment node
// @ts-nocheck -- the extension is dependency-free ESM; fixtures are synthetic.
import { describe, expect, it } from 'vitest'
import { buildIndex, fold, rank } from '../../extension/sidepanel/lib/search.mjs'
import { buildPanelData } from '../../extension/sidepanel/lib/model.mjs'

const meta = { reportDate: '2026-08-30', completedAt: '2026-08-30T10:00:00-04:00', publicFreshness: 'current', dealerMailFreshness: 'current' }
function record(overrides = {}) {
  return {
    vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', year: 2024, make: 'Ford', model: 'F-150', trim: 'Lariat', vehicleName: '2024 Ford F-150 Lariat',
    listedPrice: 51800, msrp: 68420, mileage: 12450, daysListed: 43, exteriorColor: 'Antimatter Blue Metallic', bodyStyle: 'SuperCrew', drivetrain: '4WD',
    features: 'Max Trailer Tow Package | Heated Seats', homeStore: 'Howell', publicStore: 'Howell', sourceReportedLocation: 'Howell', homeStoreConfirmed: true,
    websiteStatus: 'Not provided', publicListingState: 'Listed publicly', dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No hold observed', backupCount: 0, canViewEvidence: true, canManage: true },
    movement: { state: 'source_reported', label: 'Source-reported location', currentLocation: 'Howell', locationConfidence: 'reported' },
    ...overrides,
  }
}
const bootstrap = (vehicles, extra = {}) => ({ meta, stores: [], transfers: [], attention: [], vehicles, ...extra })
const index = (vehicles) => buildIndex(buildPanelData(bootstrap(vehicles)).vehicles)

describe('deal desk search', () => {
  const vehicles = [
    record(),
    record({ vin: 'TESTDATAFWELL0002', stockNumber: 'DEMO-F02', vehicleName: '2022 Ford Maverick Lariat', model: 'Maverick', year: 2022, listedPrice: 31900, mileage: 18920, homeStore: 'Fowlerville', publicStore: 'Fowlerville', sourceReportedLocation: 'Fowlerville', features: 'Class II Trailer Tow Package', hold: { state: 'primary', label: 'Held · Demo Salesperson', backupCount: 1, canViewEvidence: true, primarySalesperson: 'Demo Salesperson', reason: 'Customer appointment Friday' } }),
    record({ vin: 'TESTDATALNCN00001', stockNumber: 'DEMO-L01', vehicleName: '2024 Lincoln Nautilus Reserve', make: 'Lincoln', model: 'Nautilus', trim: 'Reserve', listedPrice: 62400, homeStore: 'Lincoln', publicStore: 'Lincoln', sourceReportedLocation: 'Lincoln', features: '' }),
  ]

  it('folds joiner punctuation and currency so F150 and $51,800 match their formatted forms', () => {
    expect(fold('F-150')).toBe('f150')
    expect(fold('$51,800')).toBe('51800')
    expect(fold('DEMO-H01')).toBe('demoh01')
  })

  it('ranks an exact stock number first and reports the matched field', () => {
    const [top] = rank(index(vehicles), 'demo-f02')
    expect(top.vehicle.stockNumber).toBe('DEMO-F02')
    expect(top.matchedLabels).toContain('Stock')
  })

  it('matches a VIN fragment, a model without punctuation, and a formatted price', () => {
    expect(rank(index(vehicles), 'WELL0002')[0].vehicle.vin).toBe('TESTDATAFWELL0002')
    expect(rank(index(vehicles), 'f150').map((match) => match.vehicle.stockNumber)).toEqual(['DEMO-H01'])
    expect(rank(index(vehicles), '$51,800')[0].vehicle.stockNumber).toBe('DEMO-H01')
    expect(rank(index(vehicles), '51800')[0].vehicle.stockNumber).toBe('DEMO-H01')
  })

  it('tolerates a one-letter slip in a word but never in an identifier', () => {
    // One substitution ("lariet") is within the app's threshold; a transposition
    // ("larait") is two edits and is rejected there too, so it is not asserted.
    expect(rank(index(vehicles), 'lariet').map((match) => match.vehicle.stockNumber).sort()).toEqual(['DEMO-F02', 'DEMO-H01'])
    expect(rank(index(vehicles), 'DEMO-H02')).toEqual([])
    expect(rank(index(vehicles), 'TESTDATAHWELL0009')).toEqual([])
  })

  it('requires every term to match and boosts the full phrase', () => {
    const ranked = rank(index(vehicles), 'trailer tow')
    expect(ranked.map((match) => match.vehicle.stockNumber).sort()).toEqual(['DEMO-F02', 'DEMO-H01'])
    expect(rank(index(vehicles), 'trailer nautilus')).toEqual([])
  })

  it('finds a hold by salesperson only when the server allowed the evidence', () => {
    expect(rank(index(vehicles), 'Demo Salesperson')[0]?.vehicle.stockNumber).toBe('DEMO-F02')
    // The server redacts the label and the evidence together for restricted
    // roles; the panel must add nothing back.
    const redacted = vehicles.map((item) => ({ ...item, hold: { ...item.hold, label: item.hold.state === 'none_observed' ? item.hold.label : 'Held', canViewEvidence: false, primarySalesperson: undefined, reason: undefined }, privateEvidence: undefined }))
    expect(rank(index(redacted), 'Demo Salesperson')).toEqual([])
  })

  it('never treats the query as a pattern', () => {
    expect(rank(index(vehicles), '.*')).toEqual([])
    // Folding drops the asterisk, so "F*" is simply "F" — a prefix, never a wildcard.
    expect(rank(index(vehicles), 'F*').map((match) => match.vehicle.vin)).toEqual(rank(index(vehicles), 'F').map((match) => match.vehicle.vin))
    expect(rank(index(vehicles), 'F-150 Lariat').map((match) => match.vehicle.stockNumber)).toEqual(['DEMO-H01'])
    // A lone pipe is a literal character with no field to match, as in the app.
    expect(rank(index(vehicles), 'F-150 | Lariat')).toEqual([])
  })

  it('returns everything in order for an empty query', () => {
    expect(rank(index(vehicles), '   ').map((match) => match.vehicle.stockNumber)).toEqual(['DEMO-H01', 'DEMO-F02', 'DEMO-L01'])
  })
})
