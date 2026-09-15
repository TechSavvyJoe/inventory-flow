// @vitest-environment node
// @ts-nocheck -- synthetic source/view provenance regressions, never production data.
import { describe, expect, it } from 'vitest'
import { integrationBootstrapFromSource } from '../../server/integrations/source-bootstrap.mjs'
import { createIntegrationReadService } from '../../server/integrations/read-service.mjs'

const VIN = '1FTFW1E50NFA00001', SECOND = '1FTFW1E50NFA00002'
const PRIVATE = 'SYNTHETIC_PRIVATE_SOURCE_CANARY'
function fixture() {
  const record = {
    vin: VIN, stock_number: '0001PUBLIC', year: '2024', make: 'Ford', model: 'F-150', trim: 'XLT', vehicle_name: '2024 Ford F-150 XLT',
    store: 'Howell', listed_price: 42000, msrp: 62000, mileage: 2052, inventory_date: '2026-09-01',
    exterior_color: 'Oxford White', interior_color: 'Black', body_style: 'SuperCrew', body_type: 'Truck', drivetrain: '4WD', engine: '3.5L EcoBoost', transmission: '10-speed', fuel_type: 'Gasoline', mpg_city: 17, mpg_highway: 23,
    certified: false, model_code: 'W1E', features: 'EQUIPMENT GROUP 302A', listing_url: `https://www.bobmaxeyfordhowell.com/used-${VIN}`, photo_count: 22,
    availability: '', in_stock: true, in_transit: false, in_production: false,
    location_city: 'Howell', generic_color: 'White', first_seen: '2026-09-02', last_seen: '2026-09-09', dealer_location_id: 21521, vehicle_id: 34567, source_count: 4,
    dealer_comments: PRIVATE, raw: { customer: PRIVATE },
  }
  const view = {
    vin: VIN, stockNumber: 'CRM-FALLBACK', year: 2021, make: 'CRM-MAKE', model: 'CRM-MODEL', trim: 'CRM-TRIM', vehicleName: 'CRM-DESCRIPTION',
    publicStore: 'Lincoln', listedPrice: 9999, msrp: 1, mileage: 777, daysListed: 99, inventoryDate: '2026-01-01', exteriorColor: 'CRM-COLOR', interiorColor: 'CRM-INTERIOR', bodyStyle: 'CRM-BODY', bodyType: 'CRM-TYPE', engine: 'CRM-ENGINE',
    homeStore: 'Howell', homeStoreConfirmed: true, crmStore: 'Lincoln', websiteStatus: 'In Stock',
    imageUrl: 'https://images.dealeron.com/car.jpg', imageUrls: ['https://images.dealeron.com/car.jpg'],
    hold: { state: 'multiple', backupCount: 1, customerOrReason: PRIVATE, primarySalesperson: PRIVATE, raw: { notes: PRIVATE } },
    movement: { state: 'arrived', currentLocation: 'Lincoln', destination: 'Lincoln', locationConfidence: 'verified', departedAt: '2026-09-08T12:00:00Z', lastConfirmedAt: '2026-09-09T12:00:00Z', notes: PRIVATE, actor: PRIVATE, newRequestBlocked: true },
    autoCheckReport: { dataState: 'current', score: 90, checks: [{ label: 'Accident', status: 'No issue reported', detail: 'No accident reported', raw: PRIVATE }], url: PRIVATE, raw: PRIVATE },
    windowSticker: { dataState: 'current', equipmentGroup: '302A', options: ['TRAILER TOW PACKAGE'], standardEquipment: ['SYNC 4'], warranty: ['3YR/36000'], raw: PRIVATE, url: PRIVATE },
    factoryEquipment: { dataState: 'current', packages: [{ name: 'FX4', code: '55A', price: 1095, features: ['Hill descent'], raw: PRIVATE }], sections: [{ name: 'Safety', items: [{ label: 'Lane keeping', price: 0, raw: PRIVATE }], raw: PRIVATE }], raw: PRIVATE, url: PRIVATE },
    fordOasis: { dataState: 'current', capturedAt: '2026-09-09T12:00:00Z', vehicleDescription: '2024 Ford F-150', versionSeries: 'F-150', buildDate: '2024-01-01', warrantyStartDate: '2024-02-01', releaseDate: '2024-01-05', monthsInService: 31, saleMileage: 10, openFieldServiceActions: [{ code: '24B01', description: 'Field service action', raw: PRIVATE }], warrantyCoverages: [{ type: 'Basic', description: '36 months / 36,000 miles', raw: PRIVATE }], extendedCoverageExpirations: ['2029-02-01'], raw: PRIVATE },
    warrantyCheck: { dataState: 'current', capturedAt: '2026-09-09T12:00:00Z', mileageEntered: 2052, mileageSource: 'Public listing', autoCheck: { inServiceDate: '2024-02-01', inServiceAgeMonths: 31, defaultMileage: 12000, coverages: [{ type: 'Basic', termText: '36 months / 36,000 miles', remainingMilesText: '33,948 miles', remainingTimeText: '5 months', status: 'estimated', note: PRIVATE, raw: PRIVATE }] }, raw: PRIVATE },
    privateEvidence: { customer: PRIVATE }, dealerComments: PRIVATE, raw: PRIVATE, searchText: PRIVATE,
  }
  return {
    bootstrap: {
      meta: { reportDate: '2026-09-09', completedAt: '2026-09-09T13:00:00Z', timezone: 'America/New_York', publicFreshness: 'current', dealerMailFreshness: 'current', managerDispositionFreshness: 'current', managerDispositionCoverageStatus: 'provided', managerDispositionCoveredSourceStores: ['Howell', PRIVATE], warnings: [PRIVATE], manifestPath: PRIVATE },
      vehicles: [view], publicChanges: [{ id: 'change1', type: 'price_change', field: 'Listed price', valueType: 'money', reportDate: '2026-09-09', vin: VIN, store: 'Howell', beforeValue: 43000, afterValue: 42000, raw: PRIVATE }],
      managerDispositions: [{ stockNumber: '0001PUBLIC', vin: VIN, vehicleName: '2024 Ford F-150 XLT', soldManagerLog: true, deliveredManagerLog: true, deliveryDate: '2026-09-09', confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false, soldLabel: PRIVATE, deliveryLabel: PRIVATE, dataState: PRIVATE, customerName: PRIVATE, source_store_note: PRIVATE }],
      attention: [{ notes: PRIVATE }], transfers: [{ reason: PRIVATE }],
    },
    release: { vehicles: [{ vin: VIN, publicRecord: record, crmRecord: { customer: PRIVATE }, holdRecord: { reason: PRIVATE } }] },
  }
}
function read(bootstrap) {
  return createIntegrationReadService({ bootstrap, principal: { userId: 'synthetic', clientId: 'test', role: 'sales', stores: ['Howell'], scopes: ['inventory.read', 'health.read', 'changes.read', 'holds.aggregate.read'] }, bundleSha256: 'a'.repeat(64), cursorSecret: 'synthetic-source-test-cursor-secret-0123456789' })
}

describe('integration public-source bootstrap', () => {
  it('replaces app/CRM fallback fields with exact public values and source physical store', () => {
    const { bootstrap, release } = fixture()
    const result = integrationBootstrapFromSource(bootstrap, release)
    expect(result.vehicles[0]).toMatchObject({ stockNumber: '0001PUBLIC', year: 2024, make: 'Ford', model: 'F-150', trim: 'XLT', vehicleName: '2024 Ford F-150 XLT', listedPrice: 42000, mileage: 2052, publicStore: 'Howell', sourceReportedLocation: 'Howell', daysListed: 8, exteriorColor: 'Oxford White', engine: '3.5L EcoBoost', websiteStatus: 'Not provided' })
    expect(result.vehicles[0].dealerOn).toEqual({ inStock: true, inTransit: false, inProduction: false })
    expect(result.vehicles[0]).toMatchObject({ homeStore: 'Howell', homeStoreConfirmed: true, crmStore: 'Lincoln', movement: { currentLocation: 'Lincoln' } })
    // The app API's own new-request decision is not a Shared Read API fact:
    // the explicit movement allowlist keeps it (and the private keys) out.
    expect(Object.keys(result.vehicles[0].movement).sort()).toEqual(['currentLocation', 'departedAt', 'destination', 'lastConfirmedAt', 'locationConfidence', 'state'])
    expect(result.vehicles[0].movement).not.toHaveProperty('newRequestBlocked')
  })

  it('keeps absent public facts missing instead of relabeling CRM values as published data', () => {
    const { bootstrap, release } = fixture(), source = release.vehicles[0].publicRecord
    for (const key of ['listed_price', 'mileage', 'stock_number', 'year', 'make', 'model', 'trim', 'vehicle_name', 'exterior_color', 'interior_color', 'body_style', 'body_type', 'engine']) delete source[key]
    const value = read(integrationBootstrapFromSource(bootstrap, release)).vehicle(VIN).data
    for (const key of ['listedPrice', 'mileage', 'stockNumber', 'year', 'make', 'model', 'trim', 'vehicleName', 'exteriorColor', 'interiorColor', 'bodyStyle', 'bodyType', 'engine']) expect(value[key], key).toBeNull()
    expect(JSON.stringify(value)).not.toContain('CRM-')
  })

  it('rebuilds public scan metadata even when the ordinary bootstrap omitted it', () => {
    const { bootstrap, release } = fixture()
    expect(bootstrap.vehicles[0]).not.toHaveProperty('publicScan')
    const value = read(integrationBootstrapFromSource(bootstrap, release)).vehicle(VIN).data
    expect(value.publicScan).toEqual({ locationCity: 'Howell', genericColor: 'White', firstSeen: '2026-09-02', lastSeen: '2026-09-09', dealerLocationId: 21521, vehicleId: 34567, sourceCount: 4 })
    expect(read(integrationBootstrapFromSource(bootstrap, release)).inventory({ q: 'September 2, 2026' }).pagination.total).toBe(1)
    release.vehicles[0].publicRecord.vehicle_id = 0
    expect(integrationBootstrapFromSource(bootstrap, release).vehicles[0].publicScan.vehicleId).toBeNull()
  })

  it('retains only known safe containers, with no private/raw fields or shared mutable objects', () => {
    const { bootstrap, release } = fixture(), before = structuredClone({ bootstrap, release })
    const result = integrationBootstrapFromSource(bootstrap, release)
    expect(JSON.stringify(result)).not.toContain(PRIVATE)
    expect(Object.keys(result)).toEqual(['meta', 'vehicles', 'publicChanges', 'managerDispositions'])
    expect(result.managerDispositions).toEqual([{ stockNumber: '0001PUBLIC', vin: VIN, vehicleName: '2024 Ford F-150 XLT', soldManagerLog: true, deliveredManagerLog: true, deliveryDate: '2026-09-09', confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false }])
    expect(result.meta.managerDispositionCoveredSourceStores).toEqual(['Howell'])
    expect(result.vehicles[0].windowSticker.options).toEqual(['TRAILER TOW PACKAGE'])
    expect(result.vehicles[0].factoryEquipment.sections[0].items).toEqual([{ label: 'Lane keeping', price: 0 }])
    expect(result.vehicles[0].fordOasis.openFieldServiceActions).toEqual([{ code: '24B01', description: 'Field service action' }])
    expect(result.vehicles[0].warrantyCheck.autoCheck.coverages[0]).toMatchObject({ type: 'Basic', status: 'estimated' })
    expect(result.vehicles[0].hold).toEqual({ state: 'multiple', backupCount: 1 })
    result.vehicles[0].windowSticker.options.push('Changed')
    result.vehicles[0].factoryEquipment.packages[0].features.push('Changed')
    result.publicChanges[0].beforeValue = 0
    result.meta.reportDate = '2000-01-01'
    expect({ bootstrap, release }).toEqual(before)
  })

  it('never expands the existing VIN set or guesses missing, mismatched, duplicate or CRM-only public sources', () => {
    const { bootstrap, release } = fixture()
    release.vehicles.push({ vin: SECOND, publicRecord: { ...release.vehicles[0].publicRecord, vin: SECOND } })
    expect(integrationBootstrapFromSource(bootstrap, release).vehicles.map(row => row.vin)).toEqual([VIN])
    for (const records of [[], [{ vin: VIN, publicRecord: null }], [{ vin: VIN, publicRecord: { ...release.vehicles[0].publicRecord, vin: SECOND } }], [release.vehicles[0], release.vehicles[0]], [{ vin: VIN, publicRecord: { ...release.vehicles[0].publicRecord, store: 'Unknown' } }]]) {
      expect(integrationBootstrapFromSource(bootstrap, { vehicles: records }).vehicles).toEqual([])
    }
  })

  it('uses only the fixed report date for aging, preserving missing and invalid dates', () => {
    const { bootstrap, release } = fixture()
    bootstrap.meta.reportDate = '2026-09-05'
    expect(integrationBootstrapFromSource(bootstrap, release).vehicles[0].daysListed).toBe(4)
    for (const value of [undefined, '', '2026-02-30', 'bad']) {
      release.vehicles[0].publicRecord.inventory_date = value
      expect(integrationBootstrapFromSource(bootstrap, release).vehicles[0].daysListed).toBeNull()
    }
  })

  it('fails closed when required source structures are unavailable', () => {
    const { bootstrap, release } = fixture()
    for (const [view, source] of [[null, release], [{ ...bootstrap, meta: null }, release], [bootstrap, null], [bootstrap, {}]]) {
      expect(() => integrationBootstrapFromSource(view, source)).toThrowError('Verified source inventory is unavailable')
    }
  })
})
