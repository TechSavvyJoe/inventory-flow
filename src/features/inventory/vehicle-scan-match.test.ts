// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import type { InventoryVehicle } from './types'
import { isValidScannedVin, matchScannedVehicles, normalizeScanIdentifier } from './vehicle-scan-match'

function vehicle(vin: string, stockNumber: string, store = 'Howell'): InventoryVehicle {
  return { id: vin, vin, stockNumber, location: { homeStore: { name: store } } } as InventoryVehicle
}
const first = vehicle('1FTEW1EP7PFA00001', 'H24681P')
const second = vehicle('1FTEW1EP7PFA00002', 'F24680A', 'Fowlerville')
const inventory = [first, second]

describe('local vehicle scan matching', () => {
  it('normalizes case and printed tag separators without OCR correction', () => {
    expect(normalizeScanIdentifier(' #h-24681_p ')).toBe('H24681P')
    expect(normalizeScanIdentifier('H2468lP')).toBe('H2468LP')
    expect(normalizeScanIdentifier('H24681:P')).toBe('H24681:P')
  })

  it('validates VIN length and excludes I, O and Q', () => {
    expect(isValidScannedVin(first.vin.toLowerCase())).toBe(true)
    for (const invalid of ['1FTEW1EP7PFA0000', '1FTEW1EP7PFA000011', 'IFTEW1EP7PFA00001', '1FTEW1EP7PFAO0001', '1FTEW1EP7PFAQ0001']) {
      expect(isValidScannedVin(invalid)).toBe(false)
    }
  })

  it('matches an exact VIN from a barcode or labelled text', () => {
    for (const text of [first.vin, `VIN: ${first.vin.toLowerCase()}\nStock H24681P`, 'VIN: 1FTEW1EP7 PFA00001']) {
      expect(matchScannedVehicles(text, inventory)).toEqual([{ vehicle: first, matchKind: 'vin', needsReview: false }])
    }
  })

  it('uses an exact authorized synthetic or legacy source VIN without guessing its format', () => {
    const synthetic = vehicle('TESTDATAINVALID01', 'DEMO-01')
    expect(isValidScannedVin(synthetic.vin)).toBe(false)
    expect(matchScannedVehicles(`VIN ${synthetic.vin}`, [synthetic]))
      .toEqual([{ vehicle: synthetic, matchKind: 'vin', needsReview: false }])
  })

  it.each(['H24681P', 'stock: h-24681-p', 'Stock # H24681 P', 'UNIT NO. H24681_P'])('matches the complete stock tag %s', text => {
    expect(matchScannedVehicles(text, inventory)).toEqual([{ vehicle: first, matchKind: 'stock', needsReview: false }])
  })

  it('returns both stores for a duplicate stock, rather than selecting one', () => {
    const other = vehicle(second.vin, first.stockNumber, 'Fowlerville')
    expect(matchScannedVehicles('H24681P', [first, other])).toEqual([
      { vehicle: first, matchKind: 'stock', needsReview: false },
      { vehicle: other, matchKind: 'stock', needsReview: false },
    ])
  })

  it('deduplicates repeated observations and repeated source rows with an exact VIN preferred', () => {
    expect(matchScannedVehicles(`H24681P\n${first.vin}\n${first.vin}`, [first, { ...first, id: 'synthetic-duplicate' }]))
      .toEqual([{ vehicle: first, matchKind: 'vin', needsReview: false }])
  })

  it('requires review for a single known OCR confusion', () => {
    expect(matchScannedVehicles('Stock H2468lP', inventory)).toEqual([{ vehicle: first, matchKind: 'stock', needsReview: true }])
    expect(matchScannedVehicles('VIN 1FTEW1EP7PFAO0001', inventory)).toEqual([{ vehicle: first, matchKind: 'vin', needsReview: true }])
    expect(matchScannedVehicles('Stock H24G8lP', inventory)).toEqual([])
  })

  it('does not turn an unrelated typo, VIN suffix or stock suffix into a match', () => {
    for (const text of ['H2468P', 'X24681P', 'PFA00001', '24681P', '24681', '681P', 'H24681P9', 'XH24681P', 'H24681-P-OLD']) {
      expect(matchScannedVehicles(text, inventory)).toEqual([])
    }
  })

  it('does not match phone numbers, prices, mileage or arbitrary numeric substrings as numeric stocks', () => {
    const numeric = vehicle(first.vin, '24681')
    for (const text of ['Call 313-555-24681', 'Phone: 313 555 24681', 'Mileage 24681', 'Price $24681', 'VIN 24681123456789012']) {
      expect(matchScannedVehicles(text, [numeric])).toEqual([])
    }
    for (const text of ['24681', '#24681', 'Stock: 24681', 'Unit No. 24-681']) {
      expect(matchScannedVehicles(text, [numeric])).toEqual([{ vehicle: numeric, matchKind: 'stock', needsReview: false }])
    }
  })

  it('requires a standalone or explicitly labelled short stock', () => {
    const short = vehicle(first.vin, 'P123')
    expect(matchScannedVehicles('Model P123', [short])).toEqual([])
    expect(matchScannedVehicles('Stock P123', [short])).toEqual([{ vehicle: short, matchKind: 'stock', needsReview: false }])
    expect(matchScannedVehicles('P123', [short])).toEqual([{ vehicle: short, matchKind: 'stock', needsReview: false }])
  })

  it('returns only authorized input vehicles and does not mutate them', () => {
    const before = structuredClone(inventory)
    expect(matchScannedVehicles(`${second.vin}\nF24680A`, [first])).toEqual([])
    expect(matchScannedVehicles('', inventory)).toEqual([])
    expect(matchScannedVehicles(first.vin, [])).toEqual([])
    expect(inventory).toEqual(before)
  })
})
