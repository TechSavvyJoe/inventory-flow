// @vitest-environment node
// @ts-nocheck -- dependency-free ESM; synthetic fixtures only.
import { describe, expect, it } from 'vitest'
import { addMonthsUtc, certifiedTerms, parseServiceDate, warrantyOutlook, vehicleInServiceSource, warrantySummary, warrantyTermsFor, wholeMonthsBetween } from '../../extension/sidepanel/lib/warranty.mjs'
import { toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'

const NOW = Date.UTC(2026, 8, 12) // 2026-09-12

const vehicle = (overrides = {}) => ({
  make: 'Ford', fuelType: 'Gasoline', engine: '3.5L EcoBoost V6', mileage: 12450, vin: 'TESTDATAHWELL0001',
  links: { oasis: 'https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=TESTDATAHWELL0001' },
  documents: { autoCheck: { url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=a&ac=b', inServiceDate: '2024-03-14' }, windowSticker: null, fordOasis: { warrantyStartDate: '2024-03-14' } },
  ...overrides,
})

describe('authoritative in-service source', () => {
  it.each(['Ford', ' lInCoLn '])('prefers OASIS and uses the AutoCheck estimate when absent for %s', (make) => {
    const documents = { autoCheck: { inServiceDate: '2023-01-01' }, fordOasis: { warrantyStartDate: '2024-03-14' } }
    expect(vehicleInServiceSource({ make, documents })).toMatchObject({ raw: '2024-03-14', source: 'OASIS', estimated: false })
    expect(vehicleInServiceSource({ make, documents: { autoCheck: documents.autoCheck } })).toMatchObject({ raw: '2023-01-01', source: 'AutoCheck estimate', estimated: true })
    expect(warrantyOutlook(vehicle({ make, documents: { autoCheck: documents.autoCheck } }), { now: NOW }).inService.date).toBe('2023-01-01')
  })
  it('uses warranty-check dates after empty direct fields and keeps OASIS ahead of AutoCheck', () => {
    expect(vehicleInServiceSource({ documents: { fordOasis: { warrantyStartDate: '  ' }, autoCheck: { inServiceDate: '2023-01-01' }, warrantyCheck: { fordOasis: { warrantyStartDate: '2024-03-14' } } } }).source).toBe('OASIS')
    expect(vehicleInServiceSource({ make: 'Ford', documents: { warrantyCheck: { autoCheck: { inServiceDate: '2023-01-01' } } } })).toMatchObject({ raw: '2023-01-01', source: 'AutoCheck estimate' })
  })
  it('uses captured OASIS first regardless of make', () => {
    expect(vehicleInServiceSource({ make: 'Chevrolet', documents: { autoCheck: { inServiceDate: '2023-01-01' }, fordOasis: { warrantyStartDate: '2024-03-14' } } })).toMatchObject({ raw: '2024-03-14', source: 'OASIS', estimated: false })
  })
  it.each(['Ford', 'Chevrolet'])('calculates time and mileage from mapped CARFAX-only evidence for %s', (make) => {
    const mapped = toPanelVehicle({
      vin: 'TESTDATACARFAX001', stockNumber: 'DEMO-CF01', make, year: 2024, mileage: 21000,
      warrantyCheck: { dataState: 'current', mileageEntered: 21000, carfax: { inServiceDate: '2024-03-14', coverages: [] } },
    }, { meta: { publicFreshness: 'current' }, transfers: [] })
    expect(vehicleInServiceSource(mapped)).toEqual({ raw: '2024-03-14', source: 'CARFAX estimate', estimated: true })
    expect(warrantyOutlook(mapped, { now: NOW }).coverages.find(item => item.key === 'basic')).toMatchObject({
      expiresOn: '2027-03-14', monthsRemaining: 6, milesRemaining: 15000, status: 'active',
    })
  })
  it('keeps captured OASIS and AutoCheck dates ahead of the CARFAX fallback', () => {
    const carfax = { inServiceDate: '2024-03-14' }
    const autoCheck = { inServiceDate: '2023-01-01' }
    expect(vehicleInServiceSource({ documents: { warrantyCheck: { carfax, autoCheck } } })).toMatchObject({ source: 'AutoCheck estimate', raw: '2023-01-01' })
    expect(vehicleInServiceSource({ documents: { fordOasis: { warrantyStartDate: '2022-02-01' }, warrantyCheck: { carfax, autoCheck } } })).toMatchObject({ source: 'OASIS', estimated: false, raw: '2022-02-01' })
    expect(vehicleInServiceSource({ documents: { autoCheck: { inServiceDate: ' ' }, warrantyCheck: { carfax } } })).toMatchObject({ source: 'CARFAX estimate' })
  })
})

describe('in-service date parsing', () => {
  it('reads ISO days, US dates and full timestamps as UTC calendar days', () => {
    expect(parseServiceDate('2024-03-14')?.toISOString()).toBe('2024-03-14T00:00:00.000Z')
    expect(parseServiceDate('3/14/2024')?.toISOString()).toBe('2024-03-14T00:00:00.000Z')
    expect(parseServiceDate('2024-03-14T18:00:00-04:00')?.toISOString()).toBe('2024-03-14T00:00:00.000Z')
    expect(parseServiceDate('not a date')).toBeNull()
    expect(parseServiceDate('')).toBeNull()
  })

  it('adds months without overflowing short months', () => {
    expect(addMonthsUtc(new Date(Date.UTC(2024, 0, 31)), 1).toISOString().slice(0, 10)).toBe('2024-02-29')
    expect(addMonthsUtc(new Date(Date.UTC(2024, 2, 14)), 36).toISOString().slice(0, 10)).toBe('2027-03-14')
    expect(wholeMonthsBetween(new Date(NOW), new Date(Date.UTC(2027, 2, 14)))).toBe(6)
    expect(wholeMonthsBetween(new Date(NOW), new Date(Date.UTC(2027, 2, 11)))).toBe(5)
  })
})

describe('remaining factory coverage', () => {
  it('dates coverage from the in-service estimate and limits it by miles, whichever ends first', () => {
    const outlook = warrantyOutlook(vehicle(), { now: NOW })
    expect(outlook.inService).toMatchObject({ date: '2024-03-14', source: 'OASIS', estimated: false })
    const basic = outlook.coverages.find((item) => item.key === 'basic')
    expect(basic).toMatchObject({ termMonths: 36, termMiles: 36000, expiresOn: '2027-03-14', monthsRemaining: 6, milesRemaining: 23550, status: 'active', limitedBy: 'time' })
    const powertrain = outlook.coverages.find((item) => item.key === 'powertrain')
    expect(powertrain).toMatchObject({ termMonths: 60, termMiles: 60000, expiresOn: '2029-03-14', status: 'active' })
    expect(outlook.verify).toMatchObject({ source: 'oasis' })
    expect(outlook.verify.url).toContain('oasis/Index?vin=TESTDATAHWELL0001')
    expect(warrantySummary(outlook)).toBe('Bumper-to-bumper 6 mo / 23,550 mi left · Powertrain 30 mo / 47,550 mi left')
  })

  it('marks coverage expired by miles or by time and never goes negative', () => {
    const byMiles = warrantyOutlook(vehicle({ mileage: 40000 }), { now: NOW })
    expect(byMiles.coverages.find((item) => item.key === 'basic')).toMatchObject({ status: 'expired', limitedBy: 'miles', milesRemaining: 0 })
    expect(byMiles.coverages.find((item) => item.key === 'powertrain')).toMatchObject({ status: 'active', milesRemaining: 20000 })
    const byTime = warrantyOutlook(vehicle({ documents: { fordOasis: { warrantyStartDate: '2021-01-10' } } }), { now: NOW })
    expect(byTime.coverages.find((item) => item.key === 'basic')).toMatchObject({ status: 'expired', limitedBy: 'time', monthsRemaining: 0 })
  })

  it('is only partly known without an in-service date, and unknown without either fact', () => {
    const noDate = warrantyOutlook(vehicle({ documents: { autoCheck: { inServiceDate: null } } }), { now: NOW })
    expect(noDate.inService.date).toBeNull()
    expect(noDate.coverages[0]).toMatchObject({ status: 'partial', expiresOn: null, milesRemaining: 23550 })
    const nothing = warrantyOutlook(vehicle({ mileage: null, documents: { autoCheck: null } }), { now: NOW })
    expect(nothing.coverages[0]).toMatchObject({ status: 'unknown', monthsRemaining: null, milesRemaining: null })
    expect(warrantySummary(nothing)).toBeNull()
  })

  it('sends non-Ford makes to the AutoCheck report and carries make-specific rules', () => {
    const hyundai = warrantyOutlook(vehicle({ make: 'Hyundai', links: { oasis: null } }), { now: NOW })
    expect(hyundai.verify).toMatchObject({ source: 'autocheck' })
    expect(hyundai.verify.url).toContain('autocheck.aspx')
    expect(hyundai.coverages.find((item) => item.key === 'powertrain')).toMatchObject({ termMonths: 120, termMiles: 100000 })
    expect(hyundai.coverages.find((item) => item.key === 'powertrain').note).toMatch(/Original owner only/)
    const prius = warrantyOutlook(vehicle({ make: 'Toyota', fuelType: 'Hybrid', links: { oasis: null } }), { now: NOW })
    expect(prius.coverages.map((item) => item.key)).toEqual(['basic', 'powertrain', 'electrified', 'battery'])
    expect(prius.coverages.find((item) => item.key === 'battery')).toMatchObject({ termMonths: 120, termMiles: 150000 })
    const unknown = warrantyOutlook(vehicle({ make: 'Fisker', links: { oasis: null } }), { now: NOW })
    expect(unknown.termsKnown).toBe(false)
    expect(unknown.coverages).toEqual([])
    expect(unknown.program).toBeNull()
  })

  it('passes window-sticker warranty lines through untouched', () => {
    const outlook = warrantyOutlook(vehicle({ documents: { autoCheck: null, windowSticker: { warranty: ['3 yr / 36,000 mi bumper-to-bumper', '', '5 yr / 60,000 mi powertrain'] } } }), { now: NOW })
    expect(outlook.stickerWarranty).toEqual(['3 yr / 36,000 mi bumper-to-bumper', '5 yr / 60,000 mi powertrain'])
  })
})

describe('dealership certification', () => {
  it('follows the store, not the make, and stays separate from factory coverage', () => {
    expect(certifiedTerms('Howell')).toMatchObject({ name: 'Ford Blue Certified', brand: 'ford' })
    expect(certifiedTerms('Fowlerville').name).toBe('Ford Blue Certified')
    expect(certifiedTerms('Lincoln')).toMatchObject({ name: 'Lincoln Certified Pre-Owned', brand: 'lincoln' })
    // The dealer confirmed Blue certification at all three Ford stores.
    expect(certifiedTerms('Howell').terms.join(' ')).toMatch(/Blue Certified: .*90 day \/ 4,000 mi/)
    expect(certifiedTerms('Howell').terms.join(' ')).not.toContain('Gold Certified')
    expect(certifiedTerms('Unknown').brand).toBeNull()
    expect(certifiedTerms('Ford Detroit').name).toBe('Ford Blue Certified')
    expect(certifiedTerms('Lincoln').terms.join(' ')).toMatch(/Signature: .*6 yr \/ 100,000 mi/)
    expect(certifiedTerms('Howell').note).toMatch(/Separate from any factory warranty/)
  })
})

describe('model-year revisions', () => {
  it('applies the terms that were in force when the vehicle was new', () => {
    expect(warrantyTermsFor('Ram', 2026).powertrain).toEqual([120, 100000])
    expect(warrantyTermsFor('Ram', 2025).powertrain).toEqual([60, 60000])
    expect(warrantyTermsFor('Buick', 2019).basic).toEqual([48, 50000])
    expect(warrantyTermsFor('Buick', 2020).basic).toEqual([36, 36000])
    expect(warrantyTermsFor('Volkswagen', 2019).basic).toEqual([72, 72000])
    expect(warrantyTermsFor('Toyota', 2019).battery).toEqual([96, 100000])
    expect(warrantyTermsFor('Toyota', 2024).battery).toEqual([120, 150000])
    // Unknown or blank years fall back to the current terms; unknown makes stay unknown.
    expect(warrantyTermsFor('Ram', '').powertrain).toEqual([60, 60000])
    expect(warrantyTermsFor('Fisker', 2024)).toBeNull()
    const ram2026 = warrantyOutlook(vehicle({ make: 'Ram', year: 2026, links: { oasis: null } }), { now: NOW })
    expect(ram2026.coverages.find((item) => item.key === 'powertrain')).toMatchObject({ termMonths: 120, termMiles: 100000 })
    expect(ram2026.coverages.find((item) => item.key === 'powertrain').note).toMatch(/Original owner only/)
  })
})
