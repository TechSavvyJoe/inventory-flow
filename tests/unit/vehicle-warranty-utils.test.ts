import { describe, expect, it } from 'vitest'
import { addMonthsUtc, certifiedTerms, parseServiceDate, warrantyOutlook, warrantySummary, warrantyTermsFor } from '../../src/features/inventory/vehicle-warranty-utils'

const NOW = Date.UTC(2026, 8, 12)

describe('vehicle-warranty-utils', () => {
  it('parses in-service dates as UTC days and clamps month arithmetic', () => {
    expect(parseServiceDate('3/14/2024')?.toISOString()).toBe('2024-03-14T00:00:00.000Z')
    expect(parseServiceDate('2024-03-14')?.toISOString()).toBe('2024-03-14T00:00:00.000Z')
    expect(parseServiceDate('nope')).toBeNull()
    expect(addMonthsUtc(new Date(Date.UTC(2023, 0, 31)), 1).toISOString().slice(0, 10)).toBe('2023-02-28')
  })

  it('computes remaining coverage from the in-service estimate and current miles', () => {
    const outlook = warrantyOutlook({ make: 'Ford', mileage: 12450, inServiceDate: '2024-03-14', oasisUrl: 'https://example.invalid/oasis' }, { now: NOW })
    expect(outlook.program).toBe('Ford new-vehicle limited warranty')
    expect(outlook.coverages.map((item) => [item.key, item.status, item.expiresOn, item.monthsRemaining, item.milesRemaining])).toEqual([
      ['basic', 'active', '2027-03-14', 6, 23550],
      ['powertrain', 'active', '2029-03-14', 30, 47550],
    ])
    expect(outlook.verify).toMatchObject({ source: 'oasis', url: 'https://example.invalid/oasis' })
    expect(warrantySummary(outlook)).toBe('Bumper-to-bumper 6 mo / 23,550 mi left · Powertrain 30 mo / 47,550 mi left')
  })

  it('reports expiry, partial knowledge, electrified terms and unknown makes honestly', () => {
    expect(warrantyOutlook({ make: 'Lincoln', mileage: 51000, inServiceDate: '2024-03-14' }, { now: NOW }).coverages[0]).toMatchObject({ status: 'expired', limitedBy: 'miles' })
    expect(warrantyOutlook({ make: 'Chevrolet', mileage: 10000 }, { now: NOW }).coverages[0]).toMatchObject({ status: 'partial', expiresOn: null })
    expect(warrantyOutlook({ make: 'Toyota', fuelType: 'Hybrid', mileage: 10000, inServiceDate: '2025-01-01' }, { now: NOW }).coverages.map((item) => item.key)).toEqual(['basic', 'powertrain', 'electrified', 'battery'])
    expect(warrantyOutlook({ make: 'Kia', mileage: 10000, inServiceDate: '2025-01-01' }, { now: NOW }).coverages[1].note).toMatch(/Original owner only/)
    const unknown = warrantyOutlook({ make: 'Fisker', mileage: 10000 }, { now: NOW })
    expect(unknown.termsKnown).toBe(false)
    expect(unknown.coverages).toEqual([])
    expect(unknown.verify.source).toBe('autocheck')
  })

  it('names the store certification, which is separate from factory coverage', () => {
    expect(certifiedTerms('Lincoln').name).toBe('Lincoln Certified Pre-Owned')
    expect(certifiedTerms('Howell').name).toBe('Ford Blue Advantage')
    expect(certifiedTerms('Ford Detroit').terms.join(' ')).toMatch(/Blue Certified: .*139-point/)
    expect(certifiedTerms('Ford Detroit').terms.join(' ')).toMatch(/Gold Certified: .*172-point/)
  })

  it('applies the terms that were in force for the model year', () => {
    expect(warrantyTermsFor('Ram', 2026)?.powertrain).toEqual([120, 100000])
    expect(warrantyTermsFor('Ram', 2024)?.powertrain).toEqual([60, 60000])
    expect(warrantyTermsFor('Volkswagen', 2018)?.basic).toEqual([72, 72000])
    expect(warrantyTermsFor('Toyota', 2019)?.battery).toEqual([96, 100000])
    expect(warrantyTermsFor('Toyota', '')?.battery).toEqual([120, 150000])
    expect(warrantyOutlook({ make: 'Ram', year: 2026, mileage: 5000, inServiceDate: '2026-02-01' }, { now: NOW }).coverages[1]).toMatchObject({ termMonths: 120, termMiles: 100000 })
  })
})
