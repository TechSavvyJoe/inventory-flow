// @ts-nocheck -- service is portable ESM; these fixtures contain synthetic data only.
import { describe, expect, it, vi } from 'vitest'
import { createIntegrationReadService, IntegrationReadError } from '../../server/integrations/read-service.mjs'

const SECRET = 'synthetic-cursor-integrity-key-never-use-live-0123456789'
const HASH = 'a'.repeat(64)
const PRIVATE = 'DO_NOT_EXPORT_PRIVATE_CANARY_93847'
const principal = { clientId: 'synthetic-client', userId: 'synthetic-user', role: 'sales', stores: ['Howell'], scopes: ['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read'] }
const vinFor = (index: number) => `1FTFW1E50NFA${String(index).padStart(5, '0')}`

function row(index = 1, physicalStore = 'Howell') {
  return {
    vin: vinFor(index), stockNumber: `000${index}TEST`, year: 2024, make: 'Ford', model: 'F-150', trim: 'XLT', vehicleName: `2024 Ford F-150 XLT ${index}`,
    listedPrice: index === 1 ? 42810 : index * 1000, msrp: 65000, mileage: index === 1 ? 2052 : index * 100, daysListed: index,
    exteriorColor: 'Oxford White', interiorColor: 'Black', bodyStyle: 'SuperCrew', bodyType: 'Truck', drivetrain: '4WD', engine: '3.5L EcoBoost', transmission: '10-speed automatic', fuelType: 'Gasoline', mpgCity: 17, mpgHighway: 23,
    certified: true, inventoryDate: '2026-09-09', dealerComments: PRIVATE, modelCode: 'W1E', features: 'Trailer Tow Package | Heated Seats; SYNC® 4; literal * ? ~',
    listingUrl: `https://www.bobmaxeyfordhowell.com/used-${vinFor(index)}`, photoCount: 22, imageUrl: 'https://images.dealeron.com/car.jpg', imageUrls: ['https://images.dealeron.com/car.jpg'],
    publicStore: physicalStore, homeStore: 'Howell', homeStoreConfirmed: true, crmStore: physicalStore, sourceReportedLocation: physicalStore,
    managerDisposition: index === 1 ? { stockNumber: '0001TEST', vin: vinFor(1), vehicleName: '2024 Ford F-150 XLT 1', soldManagerLog: true, deliveredManagerLog: true, deliveryDate: '2026-09-09', confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false, privateNote: PRIVATE } : null,
    websiteStatus: 'Not provided', publicListingState: 'Listed publicly; availability not confirmed', dealerOn: { inStock: true, inTransit: false, inProduction: false, secret: PRIVATE },
    hold: { state: index === 1 ? 'multiple' : 'none_observed', label: PRIVATE, backupCount: index === 1 ? 2 : 0, primarySalesperson: PRIVATE, expectedDate: PRIVATE, reason: PRIVATE, commentsCount: 1, alertsCount: 1 },
    movement: { state: 'arrived', label: PRIVATE, currentLocation: 'Lincoln', destination: 'Lincoln', departedAt: '2026-09-08T12:00:00Z', lastConfirmedAt: '2026-09-09T12:00:00Z', locationConfidence: 'verified', transferId: PRIVATE, currentCustodian: PRIVATE, transportAssignee: PRIVATE, nextAction: PRIVATE },
    privateEvidence: { primary: { customerOrReason: PRIVATE }, comments: [{ text: PRIVATE }], alerts: [{ text: PRIVATE }], cdk: { result: PRIVATE } }, searchText: PRIVATE, changeSummary: PRIVATE, dataStatus: PRIVATE, raw: { secret: PRIVATE },
    publicScan: { locationCity: 'Howell', genericColor: 'White', firstSeen: '2026-09-01', lastSeen: '2026-09-09', dealerLocationId: 21521, vehicleId: 222, sourceCount: 4, sourceSites: [PRIVATE], dealerName: PRIVATE, raw: PRIVATE },
    autoCheckReport: { url: `https://www.autocheck.com/report?token=${PRIVATE}`, dataState: 'current', reportRunAt: '2026-09-09T12:00:00Z', score: 95, scoreRangeLow: 85, scoreRangeHigh: 96, usage: 'Personal', ownerCount: 2, lastReportedOdometer: 2050, lastReportedOdometerDate: '2026-09-01', vehicleClass: 'Truck', assemblyCountry: 'United States', estimatedInServiceDate: '2024-01-01', checks: [{ label: 'Accident check', status: 'No issue reported', detail: 'No accident reported by source', raw: PRIVATE }], raw: PRIVATE },
    windowSticker: { url: `https://windowsticker.example/private/${PRIVATE}`, dataState: 'current', originalMarket: 'USA', pricingCurrency: 'USD', pricingCurrencyEvidence: 'US original label', sourceMessage: PRIVATE, failureReason: PRIVATE, vehicleDescription: '2024 F-150 XLT', equipmentGroup: '302A', equipmentGroupContents: ['Synthetic included camera'], equipmentGroupPrice: 1250.75, basePrice: 50000, totalOptions: 11000, destinationCharge: 2000, totalMsrp: 63000, exteriorColor: 'Oxford White', interiorColor: 'Black', engine: '3.5L EcoBoost', transmission: '10-speed', options: ['EQUIPMENT GROUP 302A', 'TRAILER TOW PACKAGE'], standardEquipment: ['PRE-COLLISION ASSIST'], warranty: ['3YR/36,000 BUMPER / BUMPER'], raw: PRIVATE },
    factoryEquipment: { url: `https://example.com/${PRIVATE}`, sourceLabel: PRIVATE, disclaimer: PRIVATE, dataState: 'current', capturedAt: '2026-09-09T12:00:00Z', vehicleDescription: '2024 F-150', basePrice: 50000, totalOptions: 11000, destinationCharge: 2000, totalMsrp: 63000, exteriorColor: 'Oxford White', interiorColor: 'Black', engine: '3.5L EcoBoost', transmission: '10-speed', drivetrain: '4WD', packages: [{ name: 'FX4 OFF-ROAD PACKAGE', code: '55A', price: 1095, features: ['Hill Descent Control'], raw: PRIVATE }], sections: [{ name: 'Safety', items: [{ label: 'Lane-Keeping System', price: 0, raw: PRIVATE }], raw: PRIVATE }], isOriginalWindowSticker: true, raw: PRIVATE },
    fordOasis: { dataState: 'current', capturedAt: '2026-09-09T12:00:00Z', vehicleDescription: '2024 Ford F-150 XLT', versionSeries: 'F-150', buildDate: '2024-01-01', warrantyStartDate: '2024-02-01', releaseDate: '2024-01-05', monthsInService: 31, saleMileage: 15, openFieldServiceActions: [{ code: '24B01', description: 'Field service action' }], warrantyCoverages: [{ type: 'Basic', description: '36 months / 36,000 miles' }], extendedCoverageExpirations: ['2029-02-01'], raw: PRIVATE },
    warrantyCheck: { dataState: 'current', capturedAt: '2026-09-09T12:00:00Z', mileageEntered: 2052, mileageSource: 'Public listing', autoCheck: { inServiceDate: '2024-02-01', inServiceAgeMonths: 31, defaultMileage: 12000, coverages: [{ type: 'Basic', termText: '36 months / 36,000 miles', termMonths: 36, termMiles: 36000, remainingMiles: 33948, remainingMonths: 5, remainingMilesText: '33,948 miles', remainingTimeText: '5 months', status: 'estimated', note: PRIVATE }] }, raw: PRIVATE },
  }
}

function fixture(count = 4) {
  const vehicles = Array.from({ length: count }, (_, index) => row(index + 1))
  vehicles.push(row(999, 'Lincoln'))
  return {
    access: { user: PRIVATE }, meta: { reportDate: '2026-09-09', completedAt: '2026-09-09T13:00:00Z', timezone: 'America/New_York', publicFreshness: 'current', dealerMailFreshness: 'current', managerDispositionFreshness: 'current', managerDispositionCoverageStatus: 'provided', managerDispositionCoveredSourceStores: ['Howell'], warnings: [PRIVATE], manifestPath: PRIVATE, publicCount: 999999, heldVinCount: 999999 }, vehicles,
    transfers: [{ requestedBy: PRIVATE }], attention: [{ label: PRIVATE }], holdSignals: [{ store: 'Lincoln', activeHoldVins: 999999 }],
    managerDispositions: [
      { stockNumber: '0001TEST', vin: vinFor(1), vehicleName: '2024 Ford F-150 XLT 1', soldManagerLog: true, deliveredManagerLog: true, deliveryDate: '2026-09-09', confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false, customerName: PRIVATE },
      { stockNumber: 'MISSING', vin: null, vehicleName: null, soldManagerLog: true, deliveredManagerLog: false, deliveryDate: null, confidence: 'medium', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'not_matched', matchStatus: 'stock_not_in_current_release', physicalStore: null, reviewRequired: true, source_store_note: PRIVATE },
      { stockNumber: 'LINCOLN', vin: vinFor(999), vehicleName: 'Out of scope', soldManagerLog: true, deliveredManagerLog: false, deliveryDate: null, confidence: 'high', sourceStore: 'Lincoln', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Lincoln', reviewRequired: false, note: PRIVATE },
    ],
    publicChanges: [
      { id: 'change-1', type: 'price_change', field: 'Listed price', valueType: 'money', reportDate: '2026-09-09', previousReportDate: '2026-09-08', vin: vinFor(1), stockNumber: '0001TEST', vehicleName: '2024 Ford F-150', store: 'Howell', beforeValue: 44000, afterValue: 42810, currentVehicle: true, raw: PRIVATE },
      { id: 'private-field', type: 'website_status_change', field: 'customer', valueType: 'text', reportDate: '2026-09-09', vin: vinFor(1), store: 'Howell', beforeValue: PRIVATE, afterValue: PRIVATE },
      { id: 'outside-store', type: 'price_change', field: 'Listed price', reportDate: '2026-09-09', vin: vinFor(999), store: 'Lincoln', beforeValue: 8000, afterValue: 7000 },
    ],
  }
}

function service(data = fixture(), who = principal, opts = {}) {
  return createIntegrationReadService({ bootstrap: data, principal: who, bundleSha256: HASH, cursorSecret: SECRET, now: () => new Date('2026-09-09T15:00:00Z'), ...opts })
}
function errorOf(fn: () => unknown) { try { fn() } catch (error) { return { status: error.status, code: error.code, message: error.message } } throw new Error('Expected failure') }

describe('shared integration read service', () => {
  it.each([undefined, false, true])('does not infer confirmed-zero OASIS actions from a legacy array: %s', (flag) => {
    const data = fixture()
    data.vehicles[0].fordOasis.openFieldServiceActions = []
    data.vehicles[0].fordOasis.openActionsCaptured = flag
    expect(service(data).vehicleResources(vinFor(1)).data.fordOasis).toMatchObject({ openFieldServiceActions: [], openActionsCaptured: flag === true })
  })

  it('paginates in Workers without relying on a global Node Buffer', () => {
    vi.stubGlobal('Buffer', undefined)
    try {
      const api = service(fixture(25))
      const first = api.inventory({ limit: 20 })
      expect(api.inventory({ limit: 20, cursor: first.pagination.nextCursor }).data).toHaveLength(5)
    } finally { vi.unstubAllGlobals() }
  })
  it('projects rich exact public and parsed OEM facts without private/raw fields or URL credentials', () => {
    const api = service()
    const data = api.vehicle(vinFor(1)).data
    expect(data.windowSticker.options).toEqual(['EQUIPMENT GROUP 302A', 'TRAILER TOW PACKAGE'])
    expect(data.windowSticker.equipmentGroupContents).toEqual(['Synthetic included camera'])
    expect(data.windowSticker.equipmentGroupPrice).toBe(1250.75)
    expect(data.factoryEquipment.packages[0]).toEqual({ name: 'FX4 OFF-ROAD PACKAGE', code: '55A', price: 1095, features: ['Hill Descent Control'] })
    expect(data.factoryEquipment.sections[0].items[0]).toEqual({ label: 'Lane-Keeping System', price: 0 })
    expect(data.factoryEquipment.isOriginalWindowSticker).toBe(false)
    expect(data.windowSticker.isOriginalWindowSticker).toBe(true)
    expect(data.autoCheckReport.score).toBe(95)
    expect(data.autoCheckReport.checks[0].detail).toBe('No accident reported by source')
    expect(data).not.toHaveProperty('fordOasis')
    expect(data).not.toHaveProperty('warrantyCheck')
    const resources = api.vehicleResources(vinFor(1)).data
    expect(resources.fordOasis.openFieldServiceActions).toEqual([{ code: '24B01', description: 'Field service action' }])
    expect(resources.warrantyCheck.autoCheck.coverages[0]).toMatchObject({ type: 'Basic', remainingMiles: 33948 })
    const serialized = JSON.stringify([api.inventory(), api.vehicle(vinFor(1)), api.vehicleResources(vinFor(1)), api.operationalInventory({ resource: 'ford_oasis' }), api.changes(), api.holdSummary(), api.managerDispositions(), api.health(), api.dailyOperations(), api.dataQuality(), api.reconciliation(), api.capabilities])
    expect(serialized).not.toContain(PRIVATE)
    expect(serialized).not.toContain('999999')
    expect(data).not.toHaveProperty('dealerComments')
    expect(data.autoCheckReport).not.toHaveProperty('url')
    expect(data.location).not.toHaveProperty('transferId')
  })

  it('applies store authorization before search/counts/lookup and does not leak inaccessible existence', () => {
    const api = service()
    expect(api.inventory().pagination.total).toBe(4)
    expect(api.inventory({ store: 'Lincoln' }).pagination.total).toBe(0)
    expect(api.inventory({ q: vinFor(999) }).pagination.total).toBe(0)
    expect(api.changes().pagination.total).toBe(1)
    expect(api.changes({ store: 'Lincoln' }).data).toEqual([])
    expect(api.holdSummary({ store: 'Lincoln' }).data).toEqual([])
    expect(api.managerDispositions({ store: 'Lincoln' }).data).toEqual([])
    expect(api.managerDispositions().pagination.total).toBe(2)
    expect(api.health().data.visibleVehicleCount).toBe(4)
    expect(errorOf(() => api.vehicle(vinFor(999)))).toEqual(errorOf(() => api.vehicle(vinFor(888))))
    expect(errorOf(() => api.vehicle('bad'))).toEqual(errorOf(() => api.vehicle(vinFor(888))))
  })

  it.each([
    ['inventory', 'inventory.read', {}], ['vehicle', 'inventory.read', vinFor(1)], ['vehicleResources', 'inventory.read', vinFor(1)], ['operationalInventory', 'inventory.read', {}], ['managerDispositions', 'inventory.read', {}], ['changes', 'changes.read', {}], ['health', 'health.read', undefined], ['dailyOperations', 'health.read', undefined], ['dataQuality', 'health.read', undefined], ['reconciliation', 'health.read', undefined], ['holdSummary', 'holds.aggregate.read', {}],
  ])('requires the exact %s scope', (method, scope, query) => {
    const api = service(fixture(), { ...principal, scopes: principal.scopes.filter(value => value !== scope) })
    expect(errorOf(() => api[method](query))).toMatchObject({ status: 403, code: 'INSUFFICIENT_SCOPE' })
  })

  it('uses bounded deterministic pagination, signed cursors, and returns fresh detached objects', () => {
    const data = fixture(28), before = JSON.stringify(data), api = service(data)
    const first = api.inventory({ limit: 20, sort: 'mileage' })
    const second = api.inventory({ limit: 20, sort: 'mileage', cursor: first.pagination.nextCursor })
    expect(first.data).toHaveLength(20)
    expect(second.data).toHaveLength(8)
    expect(new Set([...first.data, ...second.data].map(value => value.vin)).size).toBe(28)
    expect(second.pagination.nextCursor).toBeNull()
    first.data[0].factoryEquipment.packages[0].features.push('MUTATED')
    first.meta.allowedStores.push('Lincoln')
    expect(JSON.stringify(api.inventory())).not.toContain('MUTATED')
    expect(JSON.stringify(data)).toBe(before)
    data.vehicles[0].listedPrice = 1
    expect(api.vehicle(vinFor(1)).data.listedPrice).toBe(42810)
  })

  it('rejects cursor modification and replay across query, scope, identity, snapshot or changed operational data', () => {
    const original = fixture(25), api = service(original)
    const cursor = api.inventory().pagination.nextCursor
    const altered = cursor.slice(0, -6) + 'AAAAAA'
    expect(errorOf(() => api.inventory({ cursor: altered })).code).toBe('INVALID_CURSOR')
    expect(errorOf(() => api.inventory({ cursor, q: 'Ford' })).code).toBe('INVALID_CURSOR')
    expect(errorOf(() => api.inventory({ cursor, limit: 10 })).code).toBe('INVALID_CURSOR')
    expect(errorOf(() => service(original, { ...principal, clientId: 'other' }).inventory({ cursor })).code).toBe('INVALID_CURSOR')
    expect(errorOf(() => service(original, { ...principal, stores: ['Howell', 'Lincoln'] }).inventory({ cursor })).code).toBe('INVALID_CURSOR')
    expect(errorOf(() => service(original, principal, { bundleSha256: 'b'.repeat(64) }).inventory({ cursor })).code).toBe('INVALID_CURSOR')
    original.vehicles[0].movement.currentLocation = 'Fowlerville'
    expect(errorOf(() => service(original).inventory({ cursor })).code).toBe('INVALID_CURSOR')
  })

  it.each(['F150', '$42,810', '42810', '2,052', '2052', 'EcoBoost', '302A', 'Hill Descent', 'Lane-Keeping', 'SYNC 4', 'September 9, 2026', 'Sep 9, 2026', '2026-09-09', '0001T', vinFor(1).slice(-8)])('searches only projected fields with literal or folded matching: %s', q => {
    expect(service().inventory({ q }).data.map(value => value.vin)).toContain(vinFor(1))
  })

  it.each(['*', '?', '~', '|'])('treats %s as a literal rather than a wildcard', symbol => {
    const data = fixture()
    for (const value of data.vehicles.slice(1)) { value.features = 'No special symbols'; value.windowSticker.warranty = [] }
    expect(service(data).inventory({ q: symbol }).data.map(value => value.vin)).toEqual([vinFor(1)])
    expect(service(data).inventory({ q: `nonexistent${symbol}` }).pagination.total).toBe(0)
  })

  it('does not search private cached indexes or match every row for punctuation-only queries', () => {
    expect(service().inventory({ q: PRIVATE }).data).toEqual([])
    expect(service().inventory({ q: '!!!' }).data).toEqual([])
  })

  it('filters exact make/model/year, ranges and current hold state; null prices remain last in both directions', () => {
    const data = fixture()
    data.vehicles[1].listedPrice = null
    const api = service(data)
    expect(api.inventory({ make: 'FORD', model: 'F150', year: 2024, minPrice: 40000, maxPrice: 45000, minMileage: 2000, maxMileage: 2100, holdState: 'multiple' }).data.map(value => value.vin)).toEqual([vinFor(1)])
    expect(api.inventory({ sort: 'listedPrice', direction: 'desc' }).data.at(-1).vin).toBe(vinFor(2))
    expect(api.inventory({ sort: 'listedPrice', direction: 'asc' }).data.at(-1).vin).toBe(vinFor(2))
  })

  it.each(['stale_unverified', 'incomplete', 'unknown'])('never publishes stale hold data as current when source is %s', freshness => {
    const data = fixture()
    data.meta.dealerMailFreshness = freshness
    const api = service(data)
    expect(api.vehicle(vinFor(1)).data.hold).toMatchObject({ state: 'stale', hasCurrentHold: null, backupCount: null })
    expect(api.vehicle(vinFor(2)).data.hold).toMatchObject({ state: 'stale', hasCurrentHold: null })
    expect(api.inventory({ holdState: 'none_observed' }).data).toEqual([])
    expect(api.holdSummary().data[0]).toMatchObject({ currentHeldVins: null, noCurrentHoldFound: null, unverifiedVins: 4, currentBackupRecords: null })
    expect(api.health().data.freshness.dealerMailFreshness).toBe(freshness)
  })

  it('keeps no observed hold distinct from availability and does not use unsafe source label', () => {
    const api = service()
    expect(api.vehicle(vinFor(2)).data.hold).toMatchObject({ label: 'No current DealerMail hold found', state: 'none_observed', hasCurrentHold: false })
    expect(api.holdSummary().data[0]).toMatchObject({ currentHeldVins: 1, noCurrentHoldFound: 3, currentBackupRecords: 2, storeAuthority: 'Public physical store' })
    expect(api.inventory().meta.availabilityCaveat).toContain('do not confirm availability')
  })

  it('keeps redacted manager sold/delivered signals separate, scoped, searchable and private-field free', () => {
    const api = service()
    expect(api.vehicle(vinFor(1)).data.managerDisposition).toMatchObject({ soldManagerLog: true, deliveredManagerLog: true, deliveryDate: '2026-09-09', soldLabel: 'Sold — manager log', deliveryLabel: 'Delivered — manager log', statusAuthority: 'manager-supplied sold log' })
    expect(api.managerDispositions({ delivered: true, review: false }).data).toHaveLength(1)
    expect(api.managerDispositions({ delivered: 'false', review: 'true' }).data).toEqual([expect.objectContaining({ stockNumber: 'MISSING', vin: null, vehicleName: null, reviewRequired: true, deliveryLabel: 'Not marked delivered — manager log' })])
    expect(api.managerDispositions({ q: 'manager log' }).pagination.total).toBe(2)
    expect(api.managerDispositions({ q: PRIVATE }).data).toEqual([])
    expect(JSON.stringify(api.managerDispositions())).not.toContain(PRIVATE)
    expect(api.health().data.freshness.managerDispositionFreshness).toBe('current')
    expect(api.managerDispositions().meta.managerDispositionCoverage).toEqual({ status: 'provided', coveredSourceStores: ['Howell'], caveat: expect.stringContaining('not unsold') })
    for (const query of [{ delivered: 'yes' }, { review: 1 }, { private: true }, { limit: 101 }, { q: 'a'.repeat(257) }]) {
      expect(errorOf(() => api.managerDispositions(query))).toMatchObject({ status: 400, code: 'INVALID_QUERY' })
    }
  })

  it('provides safe operational search, release summaries, reconciliation, and resource-specific records without private source fields', () => {
    const api = service()
    expect(api.operationalInventory({ homeStore: 'Howell', hasCurrentHold: true, resource: 'ford_oasis' }).data.map(value => value.vin)).toEqual([vinFor(1)])
    expect(api.operationalInventory({ hasPrice: true, hasPhoto: true, minDaysListed: 1, maxDaysListed: 1 }).pagination.total).toBe(1)
    expect(api.vehicleResources(vinFor(1)).data).toMatchObject({ vin: vinFor(1), fordOasis: { versionSeries: 'F-150' }, warrantyCheck: { mileageEntered: 2052 } })
    expect(api.dailyOperations().data).toMatchObject({ counts: { visiblePublicVehicles: 4, currentHeldPublicVins: 1 }, publicChanges: { price_change: 1 } })
    expect(api.dataQuality().data).toMatchObject({ visibleVehicles: 4, resources: { fordOasis: 4, warrantyCheck: 4 } })
    expect(api.reconciliation().data.stores[0]).toMatchObject({ publicStore: 'Howell', publiclyListedVehicles: 4 })
    const serialized = JSON.stringify([api.operationalInventory({ resource: 'warranty_check' }), api.vehicleResources(vinFor(1)), api.dailyOperations(), api.dataQuality(), api.reconciliation()])
    expect(serialized).not.toContain(PRIVATE)
  })

  it('requires source-safe typed change fields and preserves current selected-release date semantics', () => {
    const data = fixture()
    data.publicChanges.push({ ...data.publicChanges[0], id: 'wrong-type', beforeValue: PRIVATE, afterValue: PRIVATE, valueType: 'text' })
    const result = service(data).changes({ type: 'price_change', from: '2026-09-09', to: '2026-09-09' })
    expect(result.pagination.total).toBe(2)
    expect(result.data.find(value => value.id === 'wrong-type')).toMatchObject({ valueType: 'money', beforeValue: null, afterValue: null })
    expect(JSON.stringify(result)).not.toContain(PRIVATE)
    expect(service().changes({ from: '2026-01-01', to: '2026-01-02' }).data).toEqual([])
    expect(result.meta.historyCoverage).toContain('Selected release only')
  })

  it('replaces numeric sentinel fields with null but preserves true zero option costs and zero mileage', () => {
    const data = fixture()
    Object.assign(data.vehicles[0], { msrp: 0, mpgCity: 0, mpgHighway: 0, mileage: 0 })
    data.vehicles[0].publicScan.vehicleId = 0
    const value = service(data).vehicle(vinFor(1)).data
    expect(value).toMatchObject({ msrp: null, mpgCity: null, mpgHighway: null, mileage: 0 })
    expect(value.publicScan.vehicleId).toBeNull()
    expect(value.factoryEquipment.sections[0].items[0].price).toBe(0)
  })

  it('does not pass unsafe or VIN/store-incorrect listing URLs and source-controlled arbitrary locations', () => {
    const data = fixture()
    data.vehicles[0].listingUrl = `https://www.bobmaxeylincoln.com/${vinFor(1)}`
    data.vehicles[0].movement.currentLocation = PRIVATE
    data.vehicles[0].imageUrl = `https://user:password@images.dealeron.com/${PRIVATE}`
    const value = service(data).vehicle(vinFor(1)).data
    expect(value.listingUrl).toBeNull()
    expect(value.imageUrl).toBeNull()
    expect(value.location.currentStore).toBeNull()
  })

  it.each([
    { limit: 0 }, { limit: 101 }, { limit: 1.1 }, { limit: '20junk' }, { limit: -1 }, { secret: 'oops' }, { sort: '__proto__' }, { direction: 'sideways' }, { year: 8 }, { minPrice: 100, maxPrice: 1 }, { minMileage: 100, maxMileage: 1 }, { holdState: 'available' }, { store: 'Any' }, { q: ['bad'] }, { q: 'a'.repeat(257) }, { make: {} }, { minPrice: 'Infinity' }, { minPrice: '' },
  ])('rejects invalid/unknown inventory query %#', query => {
    expect(errorOf(() => service().inventory(query))).toMatchObject({ status: 400, code: 'INVALID_QUERY' })
  })

  it.each([
    { from: '2026-02-30' }, { to: '9/9/2026' }, { from: '2026-09-10', to: '2026-09-09' }, { type: 'private_note' }, { from: '' }, { history: 'all' },
  ])('rejects invalid dates or unknown changes query %#', query => {
    expect(errorOf(() => service().changes(query))).toMatchObject({ status: 400, code: 'INVALID_QUERY' })
  })

  it('fails closed for missing or invalid server configuration', () => {
    expect(() => service(fixture(), principal, { cursorSecret: undefined })).toThrow(IntegrationReadError)
    expect(() => service(fixture(), principal, { bundleSha256: 'bad' })).toThrow(IntegrationReadError)
    expect(() => service(fixture(), { ...principal, stores: [] })).toThrow(IntegrationReadError)
    expect(() => service(fixture(), { ...principal, stores: ['*'] })).toThrow(IntegrationReadError)
  })
})
