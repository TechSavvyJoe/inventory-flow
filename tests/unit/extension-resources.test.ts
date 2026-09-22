// @vitest-environment node
// @ts-nocheck -- dependency-free extension ESM; synthetic fixtures only.
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'
import { capturedOasisActionsAreEmpty, resourceSummaries } from '../../extension/sidepanel/lib/resources.mjs'

const now = Date.parse('2026-09-15T12:00:00Z')
const vin = '1FTFW1E84RKF12345'
const listing = 'https://www.bobmaxeyfordhowell.com/used-Synthetic'
const historyUrl = 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=synthetic&ac=synthetic'
const stickerUrl = 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/12345/window-sticker?sv=synthetic&make=Ford&vehicleType=U'
const equipmentUrl = 'https://assets.cai-media-management.com/window-stickers/12345678-1234-4234-8234-123456789abc.jpg'
function panel(overrides = {}) {
  const record = { vin, make: 'Ford', model: 'F-150', vehicleName: 'Synthetic F-150', homeStore: 'Howell', listingUrl: listing, ...overrides }
  return toPanelVehicle(record, { meta: { publicFreshness: 'current', dealerMailFreshness: 'current' }, transfers: [] }, { now })
}
const source = (overrides, id) => resourceSummaries(panel(overrides), { now }).find((item) => item.id === id)
const coverage = { type: 'Powertrain', termText: '60 months / 60,000 miles', remainingMilesText: '30,000', remainingTimeText: '24 months', status: 'ACTIVE', termMonths: 60, termMiles: 60000, remainingMiles: 30000, remainingMonths: 24, note: 'Synthetic captured line' }

describe('extension captured document model', () => {
  it('retains all captured OASIS fields and distinguishes missing action arrays', () => {
    const oasis = { dataState: 'stale', capturedAt: '2026-09-10', sourceLabel: 'Synthetic OASIS', vehicleDescription: 'Synthetic F-150', versionSeries: 'Lariat', buildDate: '08/01/2024', warrantyStartDate: '08/29/2024', releaseDate: '08/08/2024', monthsInService: 24, saleMileage: 18, openFieldServiceActions: [{ code: '24S00', description: 'Synthetic software update' }], warrantyCoverages: [{ type: 'Basic', description: '36 months / 36,000 miles' }], extendedCoverageExpirations: ['Synthetic ESP ends 08/29/2029'] }
    expect(panel({ fordOasis: { ...oasis, openActionsCaptured: true } }).documents.fordOasis).toEqual({ ...oasis, openActionsCaptured: true })
    expect(panel({ fordOasis: oasis }).documents.fordOasis.openActionsCaptured).toBe(false)
    expect(panel({ fordOasis: { capturedAt: '2026-09-10' } }).documents.fordOasis.openActionsCaptured).toBe(false)
    expect(panel({ fordOasis: { openFieldServiceActions: [{}] } }).documents.fordOasis.openActionsCaptured).toBe(false)
  })

  it('retains sticker powertrain, colors, currency evidence and failure notes', () => {
    const sticker = { dataState: 'incomplete', url: stickerUrl, engine: '3.5L V6', transmission: '10-speed', exteriorColor: 'Blue', interiorColor: 'Black', pricingCurrency: 'CAD', pricingCurrencyEvidence: 'Printed Canadian dollars', originalMarket: 'Canada', sourceMessage: 'Captured pricing only', failureReason: 'Options unreadable', totalMsrp: 78000 }
    const { pricingCurrencyEvidence, ...expected } = sticker
    expect(panel({ windowSticker: sticker }).documents.windowSticker).toMatchObject({ ...expected, currencyEvidence: pricingCurrencyEvidence })
  })

  it('retains vAuto powertrain, named package and section data without declaring it an original sticker', () => {
    const factory = { url: equipmentUrl, vehicleDescription: 'Synthetic truck', engine: '2.7L', transmission: '10-speed', drivetrain: '4WD', exteriorColor: 'Gray', interiorColor: 'Black', packages: [{ name: 'Synthetic Tow Package', code: '53A', price: 1500, features: ['Trailer brake controller'] }], sections: [{ name: 'Safety', items: [{ label: '360 camera', price: null }] }], disclaimer: 'Informational equipment label' }
    expect(panel({ factoryEquipment: factory }).documents.factoryEquipment).toMatchObject(factory)
  })

  it('preserves separately sourced warranty checks without replacing the existing estimate', () => {
    const warrantyCheck = { dataState: 'current', capturedAt: '2026-09-10', sourceLabel: 'Synthetic warranty check', mileageEntered: 30000, mileageSource: 'Entered', autoCheck: { inServiceDate: '08/29/2024', inServiceAgeMonths: 24, defaultMileage: 30000, coverages: [coverage] }, fordOasis: { warrantyStartDate: '08/30/2024', monthsInService: 24, coverages: [{ ...coverage, note: 'Recorded Ford coverage' }] } }
    const vehicle = panel({ warrantyCheck })
    expect(vehicle.documents.warrantyCheck).toMatchObject(warrantyCheck)
    expect(vehicle.documents.autoCheck).toBeNull()
    expect(vehicle.documents.fordOasis).toBeNull()
    expect(vehicle.documents.warrantyCheck.autoCheck.coverages[0]).toMatchObject({ unlimitedMiles: null, unlimitedMonths: null })
    expect(panel({ warrantyCheck: { ...warrantyCheck, mileageEntered: undefined } }).documents.warrantyCheck).toBeNull()
    expect(panel({ warrantyCheck: { mileageEntered: 0, autoCheck: { coverages: [{ type: 'Basic', status: 'ACTIVE' }] } } }).documents.warrantyCheck.autoCheck.coverages).toEqual([])
  })
})

describe('extension resource summaries', () => {
  it('decodes OASIS descriptions for display while preserving model and raw evidence', () => {
    const fordOasis = {
      dataState: 'current', capturedAt: '2026-09-01',
      openFieldServiceActions: [{ code: 'TEST-26A', description: 'REAR AXLE &#x25B4; &amp; HUB' }],
      warrantyCoverages: [{ type: 'Powertrain', description: '5 years &amp; 60,000 miles' }],
    }
    const vehicle = panel({ fordOasis })
    const oasis = resourceSummaries(vehicle, { now }).find((item) => item.id === 'oasis')
    expect(oasis.compactFacts).toEqual(['At least 1 captured actions · result incomplete', 'Open FSA TEST-26A · REAR AXLE ▴ & HUB'])
    expect(oasis.facts).toContain('Recorded coverage: Powertrain · 5 years & 60,000 miles')
    expect(vehicle.documents.fordOasis.openFieldServiceActions[0].description).toBe('REAR AXLE &#x25B4; &amp; HUB')
    expect(fordOasis.warrantyCoverages[0].description).toBe('5 years &amp; 60,000 miles')
  })

  it('prioritizes history hazards before score and owners while retaining every captured check', () => {
    const autoCheckReport = { score: 91, ownerCount: 1, usage: 'Personal', reportRunAt: '2026-09-10', lastReportedOdometer: 12450, lastReportedOdometerDate: '2026-09-09', checks: [{ label: 'Accident', status: 'No accidents reported' }, { label: 'Title', status: 'Salvage brand reported' }, { label: 'Odometer', status: 'Odometer discrepancy reported' }] }
    const summary = source({ autoCheckReport }, 'autocheck')
    expect(summary.compactFacts).toEqual(['Title: Salvage brand reported', 'Odometer: Odometer discrepancy reported'])
    expect(summary.facts).toContain('1 owner · Personal')
    expect(summary.facts).toContain('Accident: No accidents reported')
    expect(summary.facts).toContain('Last reported 12,450 mi · 09/09/2026')
    expect(summary.sourceNote).toBe('Report run 09/10/2026')
    expect(summary.sourceKind).toBe('Saved data')
  })

  it('retains a warning in detail beneath a nominally clear check status', () => {
    const summary = source({ autoCheckReport: { checks: [{ label: 'Title', status: 'No issues found', detail: 'Salvage title reported' }] } }, 'autocheck')
    expect(summary.compactFacts[0]).toBe('Title: No issues found · Salvage title reported')
  })
  it.each(['Odometer discrepancy reported; last reported odometer: 12,450', 'Conflicting reading: 10,000 mi', 'Last reported odometer: 12,450 mi; conflicting reading: 10,000 mi'])('retains the complete compact odometer warning: %s', (detail) => {
    const summary = source({ autoCheckReport: { lastReportedOdometer: 12450, checks: [{ label: 'Odometer', status: 'No issues found', detail }] } }, 'autocheck')
    expect(summary.compactFacts[0]).toBe(`Odometer: No issues found · ${detail}`)
  })
  it.each(['Not reported; last reported odometer: 12,450 mi', 'CPO details not captured'])('retains missing CPO source details beneath populated check status: %s', (detail) => {
    const summary = source({ autoCheckReport: { checks: [{ label: 'CPO', status: 'No issues found', detail }] } }, 'autocheck')
    expect(summary.compactFacts[0]).toBe(`CPO: No issues found · ${detail}`)
  })
  it('does not turn a plain repeated odometer value or explicitly negated finding into an adverse detail tone', () => {
    const vehicle = panel({ autoCheckReport: { checks: [
      { label: 'Odometer', status: 'No issue reported', detail: 'Last reported odometer: 12,450 mi' },
      { label: 'Odometer', status: 'No issue reported', detail: 'No odometer discrepancies reported' },
    ] } })
    expect(vehicle.documents.autoCheck.checks.map((check) => check.tone)).toEqual(['clear', 'clear'])
  })
  it.each([
    'No accidents or damage reported',
    'No major accidents or structural damage reported',
    'No salvage, flood or odometer discrepancies reported',
  ])('keeps a compound negated AutoCheck phrase clear: %s', (detail) => {
    // autoCheckTone already reads the compound phrase as clear in a status;
    // the detail tone must not contradict it by matching the trailing subject.
    const vehicle = panel({ autoCheckReport: { checks: [{ label: 'Accident', status: 'No issues reported', detail }] } })
    expect(vehicle.documents.autoCheck.checks[0].tone).toBe('clear')
  })
  it.each([
    'No accidents reported, 1 damage record found',
    'No accidents and 2 damage records',
  ])('still reviews a partly negated finding that names a real record: %s', (detail) => {
    const vehicle = panel({ autoCheckReport: { checks: [{ label: 'Accident', status: 'No issues reported', detail }] } })
    expect(vehicle.documents.autoCheck.checks[0].tone).toBe('review')
  })
  it('does not downgrade an adverse status when additional detail is missing', () => {
    const vehicle = panel({ autoCheckReport: { checks: [{ label: 'Title', status: 'Salvage brand reported', detail: 'Additional details not captured' }] } })
    expect(vehicle.documents.autoCheck.checks[0].tone).toBe('review')
  })

  it('does not invent a clean result or omit explicit zero numeric values', () => {
    const empty = source({ autoCheckReport: { dataState: 'incomplete', score: NaN, checks: [{ label: 'Title' }] } }, 'autocheck')
    expect(empty.facts).toEqual([])
    expect(empty.hasCapturedData).toBe(false)
    expect(empty.sourceNote).toBe('Partial captured record · No report details captured')
    const zero = source({ autoCheckReport: { score: 0, ownerCount: 0, lastReportedOdometer: 0, checks: [] } }, 'autocheck')
    expect(zero.compactFacts).toEqual(['Score 0 · 0 owners', 'Last reported 0 mi'])
    expect(zero.facts.join(' ')).not.toMatch(/clean|no accidents|no damage|available/i)
  })

  it('uses saved facts when a source URL is rejected and keeps legitimate links separate', () => {
    const rejected = source({ autoCheckReport: { url: `${historyUrl}&redirect=https://evil.example`, score: 91 } }, 'autocheck')
    expect(rejected).toMatchObject({ url: null, sourceKind: 'Saved data', hasCapturedData: true, facts: ['Score 91'] })
    expect(source({ autoCheckReport: { url: historyUrl, score: 91 } }, 'autocheck')).toMatchObject({ url: historyUrl, sourceKind: 'Original source' })
    expect(source({ listingUrl: 'https://www.bobmaxeylincoln.com/used-Synthetic', autoCheckReport: { url: historyUrl, score: 91 } }, 'autocheck').url).toBeNull()
  })

  it('shows original sticker currency, named options, powertrain and printed warranty', () => {
    const summary = source({ windowSticker: { url: stickerUrl, totalMsrp: 78000, pricingCurrency: 'CAD', equipmentGroup: '502A', engine: '3.5L EcoBoost', transmission: '10-speed', exteriorColor: 'Blue', options: ['Floor mats', 'Twin panel moonroof', 'Trailer Tow Package'], standardEquipment: ['Rearview camera'], warranty: ['3-year / 36,000-mile basic coverage'] } }, 'window-sticker')
    expect(summary.compactFacts[0]).toMatch(/^CAD\s78,000 MSRP · 502A$/)
    expect(summary.compactFacts[1]).toBe('Twin panel moonroof · Trailer Tow Package')
    expect(summary.facts).toContain('3.5L EcoBoost · 10-speed')
    expect(summary.facts).toContain('Printed warranty: 3-year / 36,000-mile basic coverage')
    expect(summary.sourceKind).toBe('Original source')
    expect(summary.facts.join(' ')).not.toMatch(/USD|converted/)
  })

  it('retains partial, stale, unknown and source failure notes apart from facts', () => {
    expect(source({ autoCheckReport: { score: 91, dataState: 'stale_unverified', reportRunAt: '2026-09-10' } }, 'autocheck').sourceNote).toBe('Saved report · refresh at source · Report run 09/10/2026')
    expect(source({ windowSticker: { totalMsrp: 50000, dataState: 'incomplete', sourceMessage: 'Pricing only', failureReason: 'Options unreadable' } }, 'window-sticker').sourceNote).toBe('Partial captured record')
    expect(source({ autoCheckReport: { dataState: 'unknown' } }, 'autocheck').sourceNote).toMatch(/Source status unknown/)
    expect(source({ autoCheckReport: { score: 91, reportRunAt: '2030-01-01' } }, 'autocheck').sourceNote).toMatch(/Future source date/)
    expect(source({ autoCheckReport: { score: 91, reportRunAt: 'not a date' } }, 'autocheck').sourceNote).toMatch(/Unrecognized source date/)
  })

  it('shows named vAuto packages and useful feature lines rather than only counts', () => {
    const summary = source({ factoryEquipment: { url: equipmentUrl, packages: [{ name: 'Synthetic Premium Package', code: '302A' }], sections: [{ name: 'Safety', items: [{ label: 'Blind Spot Information System' }, { label: '360 camera' }] }], engine: '2.7L V6', drivetrain: '4WD', totalMsrp: 48000 } }, 'vauto')
    expect(summary.compactFacts).toEqual(['Synthetic Premium Package · 302A', 'Blind Spot Information System · 360 camera'])
    expect(summary.facts).toContain('2.7L V6 · 4WD')
    expect(summary.facts).toContain('48,000 reference MSRP')
    expect(summary).toMatchObject({ target: 'equipment', sourceKind: 'Source document', sourceNote: 'Informational · not an original sticker' })
  })

  it('distinguishes dealer lookups from captured OASIS details', () => {
    const lookup = source({}, 'oasis')
    expect(lookup).toMatchObject({ hasCapturedData: false, facts: [], compactFacts: ['DealerConnection sign-in'], sourceKind: 'Dealer lookup', sourceNote: 'No OASIS report details captured' })
    const captured = source({ fordOasis: { capturedAt: '2026-09-10', warrantyStartDate: '08/29/2024', buildDate: '08/01/2024', openFieldServiceActions: [{ code: '24S00', description: 'Synthetic software update' }], warrantyCoverages: [{ type: 'Powertrain', description: '60 months / 60,000 miles' }], extendedCoverageExpirations: ['Synthetic ESP ends 08/29/2029'], monthsInService: 24, saleMileage: 18 } }, 'oasis')
    expect(captured.compactFacts).toEqual(['At least 1 captured actions · result incomplete', 'Open FSA 24S00 · Synthetic software update'])
    expect(captured.facts).toContain('Extended coverage: Synthetic ESP ends 08/29/2029')
    expect(captured.facts).toContain('18 mi at sale')
    expect(captured.hasCapturedData).toBe(true)
  })

  it('only permits zero actions from an explicit complete, dated, nonfuture capture', () => {
    const complete = { dataState: 'current', capturedAt: '2026-09-10', openActionsCaptured: true, openFieldServiceActions: [] }
    expect(source({ fordOasis: complete }, 'oasis').facts).toContain('0 open Ford actions in captured report')
    for (const bad of [{ ...complete, openActionsCaptured: undefined }, { ...complete, openActionsCaptured: false }, { ...complete, dataState: 'incomplete' }, { ...complete, capturedAt: '2030-01-01' }, { ...complete, capturedAt: '2026-02-30' }, { ...complete, capturedAt: 'invalid' }, { ...complete, capturedAt: undefined }, { ...complete, openFieldServiceActions: undefined }, { ...complete, openFieldServiceActions: [{}] }]) {
      const vehicle = panel({ fordOasis: bad })
      expect(capturedOasisActionsAreEmpty(vehicle.documents.fordOasis, { now })).toBe(false)
      expect(resourceSummaries(vehicle, { now }).find((item) => item.id === 'oasis').facts.join(' ')).not.toMatch(/0 open/)
    }
    expect(source({ fordOasis: { ...complete, dataState: 'stale_unverified' } }, 'oasis').sourceNote).toMatch(/Saved report/)
  })

  it('keeps captured warranty estimates and captured OASIS warranty separate', () => {
    const warrantyCheck = { dataState: 'stale_unverified', capturedAt: '2026-09-10', mileageEntered: 30000, autoCheck: { coverages: [coverage] }, fordOasis: { warrantyStartDate: '08/30/2024', monthsInService: 24, coverages: [coverage] } }
    const history = source({ warrantyCheck }, 'autocheck')
    const oasis = source({ warrantyCheck }, 'oasis')
    expect(history.facts.join(' ')).toContain('Warranty estimate: Powertrain')
    expect(history.sourceNote).toMatch(/estimate, not OASIS coverage.*Saved report.*30,000 mi entered/)
    expect(oasis.facts.join(' ')).toContain('Captured warranty: Powertrain')
    expect(oasis.sourceNote).toMatch(/Open-action result not captured.*Saved report/)
  })

  it('shows every captured source distance in US miles and keeps the source figure', () => {
    const sticker = source({ windowSticker: { dataState: 'current', url: stickerUrl, originalMarket: 'Canada', warranty: ['5 years / 100,000 km powertrain'], options: ['Combined 9.8 L/100 km'] } }, 'window-sticker')
    expect(sticker.facts).toContain('Printed warranty: 5 years / 62,137 mi powertrain (100,000 km in the source)')
    expect(sticker.facts).toContain('Combined 24 mpg (9.8 L/100 km in the source)')

    const history = source({ autoCheckReport: { dataState: 'current', url: historyUrl, usage: 'Personal · 148 000 km reported', checks: [{ label: 'Odometer check', detail: 'Last reported odometer: 148,000 km' }] } }, 'autocheck')
    expect(history.facts.join(' ')).toContain('91,963 mi')
    expect(history.facts.join(' ')).not.toMatch(/\d\s*km\b(?! in the source)/)

    const oasis = source({ fordOasis: { dataState: 'current', capturedAt: '2026-09-10', warrantyCoverages: [{ type: 'Powertrain', description: '60 months/100,000 km' }], extendedCoverageExpirations: ['ESP to 160,000 km'] } }, 'oasis')
    expect(oasis.facts).toContain('Recorded coverage: Powertrain · 60 months/62,137 mi (100,000 km in the source)')
    expect(oasis.facts).toContain('Extended coverage: ESP to 99,419 mi (160,000 km in the source)')

    const metric = source({ warrantyCheck: { dataState: 'current', mileageEntered: 30000, fordOasis: { warrantyStartDate: '08/30/2024', monthsInService: 24, coverages: [{ ...coverage, termText: '60 months / 100,000 km', remainingMilesText: '40,000 km' }] } } }, 'oasis')
    expect(metric.facts.join(' ')).toContain('60 months / 62,137 mi (100,000 km in the source)')
    expect(metric.facts.join(' ')).toContain('24,855 mi (40,000 km in the source) remaining miles')
  })

  it('never turns synthetic MSRP into a fabricated original document or adds Ford lookup to another make', () => {
    expect(resourceSummaries(panel({ msrp: 64000 }), { now }).find((item) => item.id === 'window-sticker')).toBeUndefined()
    expect(resourceSummaries(panel({ make: 'Toyota' }), { now })).toEqual([])
    const vehicle = panel({ serviceReadiness: { status: 'needs_service' }, fordOasis: { dataState: 'current', capturedAt: '2026-09-10', openFieldServiceActions: [] } })
    resourceSummaries(vehicle, { now })
    expect(vehicle.serviceReadiness.status).toBe('needs_service')
    expect(vehicle.hold.hasActiveHold).toBeNull()
    expect(vehicle.movement).toBeNull()
  })
})
