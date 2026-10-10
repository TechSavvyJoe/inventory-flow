// @vitest-environment node
// @ts-nocheck -- dependency-free ESM; synthetic fixtures only.
import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, activeFilterCount, applyFilters, describeFilters, filterOptions, matchesFilters, normalizeFilters, sortMatches } from '../../extension/sidepanel/lib/filters.mjs'

const v = (overrides = {}) => ({
  vin: 'VIN', stockNumber: 'S1', name: '2024 Ford F-150 Lariat', year: 2024, make: 'Ford', model: 'F-150', bodyStyle: 'SuperCrew', drivetrain: '4WD', fuelType: 'Gasoline', homeStore: 'Howell',
  price: 51800, msrp: 68420, savings: 16620, mileage: 12450, daysListed: 43, certified: true, photos: ['https://www.bobmaxeyfordhowell.com/a.jpg'],
  listing: { isListed: true }, hold: { hasActiveHold: false }, ...overrides,
})
const vehicles = [
  v(),
  v({ vin: 'V2', stockNumber: 'S2', name: '2023 Ford Bronco Sport Badlands', year: 2023, model: 'Bronco Sport', bodyStyle: 'SUV', price: 31900, savings: 8475, mileage: 18920, daysListed: 27, hold: { hasActiveHold: true }, photos: [] }),
  v({ vin: 'V3', stockNumber: 'S3', name: '2022 Lincoln Corsair Grand Touring', year: 2022, make: 'Lincoln', model: 'Corsair', bodyStyle: 'SUV', drivetrain: 'AWD', fuelType: 'Plug-In Hybrid', homeStore: 'Lincoln', price: 36750, savings: null, mileage: 29450, daysListed: 56, certified: false, listing: { isListed: null }, hold: { hasActiveHold: null } }),
  v({ vin: 'V4', stockNumber: 'S4', name: '2021 Chevrolet Equinox', year: 2021, make: 'Chevrolet', model: 'Equinox', bodyStyle: 'SUV', drivetrain: 'FWD', price: null, msrp: null, savings: null, mileage: null, daysListed: null, certified: false }),
]
const matches = vehicles.map((vehicle) => ({ vehicle, matchedLabels: [] }))

describe('filter options', () => {
  it('offers only values that exist, with counts, plus the numeric bounds', () => {
    const options = filterOptions(vehicles)
    expect(options.makes).toEqual([{ value: 'Ford', count: 2 }, { value: 'Chevrolet', count: 1 }, { value: 'Lincoln', count: 1 }])
    expect(options.bodies[0]).toEqual({ value: 'SUV', count: 3 })
    expect(options).toMatchObject({ yearMin: 2021, yearMax: 2024, priceMax: 51800, mileageMax: 29450, certified: 2, photos: 3 })
  })

  it('ignores a blank or unparseable year instead of reading it as year 0', () => {
    // toPanelVehicle publishes '' for a record without a year; Number('') is 0.
    const withBlank = [...vehicles, v({ vin: 'V5', stockNumber: 'S5', year: '' }), v({ vin: 'V6', stockNumber: 'S6', year: 'n/a' })]
    expect(filterOptions(withBlank)).toMatchObject({ yearMin: 2021, yearMax: 2024 })
    expect(matchesFilters(v({ year: '' }), normalizeFilters({ yearMin: 2020 }))).toBe(false)
    // Year 0 would have satisfied an upper bound; a blank year must not.
    expect(matchesFilters(v({ year: '' }), normalizeFilters({ yearMax: 2025 }))).toBe(false)
    expect(matchesFilters(v({ year: '' }), normalizeFilters({}))).toBe(true)
    const sorted = sortMatches(withBlank.map((vehicle) => ({ vehicle })), 'year-desc').map(({ vehicle }) => vehicle.vin)
    expect(sorted.slice(-2).sort()).toEqual(['V5', 'V6'])
  })
})

describe('matching', () => {
  it('filters manager-confirmed Ready inventory independently of store while retaining unresolved service', () => {
    const ready = v({ serviceReadiness: { status: 'serviced' } })
    const waiting = v({ serviceReadiness: { status: 'needs_service' } })
    const serviced = normalizeFilters({ serviceStatus: 'serviced', stores: ['Howell'] })
    expect(matchesFilters(ready, serviced)).toBe(true)
    expect(matchesFilters(waiting, serviced)).toBe(false)
    expect(matchesFilters(v(), serviced)).toBe(false)
    expect(matchesFilters(v({ serviceReadiness: { status: 'unknown' } }), serviced)).toBe(false)
    expect(matchesFilters(waiting, normalizeFilters({ serviceStatus: 'unknown' }))).toBe(true)
    expect(describeFilters(serviced)).toBe('Howell · ready only')
    expect(normalizeFilters({ serviceStatus: 'available' }).serviceStatus).toBe('')
  })

  it('combines criteria and treats missing facts as non-matches for numeric limits', () => {
    expect(vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ makes: ['ford'], bodies: ['SUV'] }))).map((item) => item.vin)).toEqual(['V2'])
    expect(vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ priceMax: 40000 }))).map((item) => item.vin)).toEqual(['V2', 'V3'])
    expect(vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ yearMin: 2023, yearMax: 2024 }))).map((item) => item.vin)).toEqual(['VIN', 'V2'])
    expect(vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ mileageMax: 20000, certified: true }))).map((item) => item.vin)).toEqual(['VIN', 'V2'])
    expect(vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ fuels: ['Plug-In Hybrid'], stores: ['Lincoln'] }))).map((item) => item.vin)).toEqual(['V3'])
  })

  it('reads "no hold" strictly as a snapshot that found none', () => {
    const noHold = vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ noHold: true }))).map((item) => item.vin)
    expect(noHold).toEqual(['VIN', 'V4'])
    const providerHeld = v({ operationalEvidence: { records: [{ provider: 'carfax', dataState: 'current', complete: true, holdState: 'held' }] } })
    const providerUnknown = v({ operationalEvidence: { records: [{ provider: 'carfax', dataState: 'stale_unverified', complete: false, holdState: 'held' }] } })
    const appHeld = v({ manualHold: { state: 'active' } })
    expect(matchesFilters(providerHeld, normalizeFilters({ noHold: true }))).toBe(false)
    expect(matchesFilters(providerUnknown, normalizeFilters({ noHold: true }))).toBe(false)
    expect(matchesFilters(appHeld, normalizeFilters({ noHold: true }))).toBe(false)
    expect(vehicles.filter((vehicle) => matchesFilters(vehicle, normalizeFilters({ listed: true, photos: true }))).map((item) => item.vin)).toEqual(['VIN', 'V4'])
  })

  it('requires every supplied provider observation to be current, complete, and explicitly negative', () => {
    const noHold = normalizeFilters({ noHold: true })
    const makeEvidence = (record) => v({ operationalEvidence: { records: [record] } })
    const unknownState = makeEvidence({ provider: 'autocheck', dataState: 'current', complete: true, holdState: 'unknown' })
    const unknownSource = makeEvidence({ provider: 'carfax', dataState: 'unknown', complete: true, holdState: 'not_observed' })
    const incompleteSource = makeEvidence({ provider: 'oem', dataState: 'current', complete: false, holdState: 'not_observed' })
    const currentNegative = makeEvidence({ provider: 'carfax', dataState: 'current', complete: true, holdState: 'not_observed' })
    const emptyEvidence = v({ operationalEvidence: { records: [] } })

    expect(matchesFilters(unknownState, noHold)).toBe(false)
    expect(matchesFilters(unknownSource, noHold)).toBe(false)
    expect(matchesFilters(incompleteSource, noHold)).toBe(false)
    expect(matchesFilters(emptyEvidence, noHold)).toBe(false)
    expect(matchesFilters(currentNegative, noHold)).toBe(true)
    expect(matchesFilters(v(), noHold)).toBe(true)
  })

  it('normalizes junk into the empty filter set', () => {
    expect(normalizeFilters(null)).toEqual(EMPTY_FILTERS)
    expect(normalizeFilters({ makes: ['Ford', ' Ford ', 7], priceMax: 'x', certified: 'yes' })).toMatchObject({ makes: ['Ford', '7'], priceMax: null, certified: false })
    expect(activeFilterCount(normalizeFilters({ makes: ['Ford'], yearMin: 2023, certified: true }))).toBe(3)
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
  })

  it('describes the active filters in the words the sheet uses', () => {
    expect(describeFilters(normalizeFilters({ makes: ['Ford'], bodies: ['SUV'], yearMin: 2022, yearMax: 2024, priceMax: 40000, mileageMax: 30000, noHold: true })))
      .toBe('Ford · SUV · 2022–2024 · under $40k · under 30k mi · no hold found')
  })
})

describe('sorting', () => {
  it('orders by the chosen field with missing values last and a name tiebreak', () => {
    expect(sortMatches(matches, 'price-asc').map((item) => item.vehicle.vin)).toEqual(['V2', 'V3', 'VIN', 'V4'])
    expect(sortMatches(matches, 'price-desc').map((item) => item.vehicle.vin)).toEqual(['VIN', 'V3', 'V2', 'V4'])
    expect(sortMatches(matches, 'mileage-asc').map((item) => item.vehicle.vin)).toEqual(['VIN', 'V2', 'V3', 'V4'])
    expect(sortMatches(matches, 'year-desc').map((item) => item.vehicle.year)).toEqual([2024, 2023, 2022, 2021])
    expect(sortMatches(matches, 'days-desc').map((item) => item.vehicle.vin)).toEqual(['V3', 'VIN', 'V2', 'V4'])
    // Old discount-based preferences safely fall back to vehicle name.
    expect(sortMatches(matches, 'savings-desc')).toEqual(sortMatches(matches, 'name'))
  })

  it('keeps search ranking for relevance when there is a query and falls back to names otherwise', () => {
    const ranked = [matches[3], matches[0]]
    expect(sortMatches(ranked, 'relevance', { hasQuery: true })).toBe(ranked)
    expect(sortMatches(ranked, 'relevance', { hasQuery: false }).map((item) => item.vehicle.vin)).toEqual(['V4', 'VIN'])
    expect(applyFilters(matches, normalizeFilters({ makes: ['Lincoln'] })).map((item) => item.vehicle.vin)).toEqual(['V3'])
  })
})
