// @ts-nocheck -- shared portable backend modules use plain ESM.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { projectServiceHistoryEvidence, validateServiceHistoryEvidence } from '../../server/provider-evidence.mjs'
import { validateVinDocumentEnrichment, validateVinDocumentEnrichmentForPublish } from '../../server/importer.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { resourceProvenanceSha256 } from '../../server/resource-validation.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { VAUTO_AUTOCHECK_MECHANICAL_DESCRIPTIONS } from '../../scripts/capture-vauto-autocheck.mjs'

const VIN = 'TESTDATAHWELL0002'
const CAPTURED_AT = '2026-08-30T14:00:00Z'
const PRIVATE_DESCRIPTIONS = [
  'Brake replacement approved by Jane Smith',
  'Oil changed for Jane Smith',
  'Jane Smith: Oil and filter changed',
  'Oil and filter changed — Jane Smith',
  'Oil and filter changed (Jane Smith)',
  'Oil and filter changed; Jane Smith',
  'Oil and filter changed by Jane Smith',
  'Jane Smith oil and filter changed',
  'Brake pads replaced per Jane Smith',
  'Front brake pads replaced for J. Smith',
  'Oil changed for JANE SMITH',
  'Oil changed for Jane\u00a0Smith',
  'Oil changed for Jаne Smith',
  'Transmission serviced, authorized by J. S.',
  'Vehicle inspected at Smith Service for Jane',
  'Synthetic oil and filter service for Jane Smith',
  '5W-30 engine oil installed per Jane Smith',
  '30,000-mile service performed for Jane Smith',
  'Oil and filter changed, Jane Smith collected vehicle',
  'Vehicle collected after oil and filter changed',
]
function history(services = ['Oil and filter changed'], provider = 'autocheck') {
  return { reports: [{ vin: VIN, provider, sourceLabel: provider, capturedAt: CAPTURED_AT,
    dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-08-29',
      odometer: 42000, odometerUnit: 'mi', services }] }] }
}
function enrichment(serviceHistory) {
  return { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', generatedAt: CAPTURED_AT,
    recordsByVin: { [VIN]: { vin: VIN, serviceHistory } } }
}
function bundle(serviceHistory) {
  const result = buildSyntheticCloudBundle()
  result.release.vehicles.find(row => row.vin === VIN).resourceRecord = { vin: VIN, serviceHistory }
  const source = result.release.sourceRuns.resources
  const resources = result.release.vehicles.filter(row => row.resourceRecord)
  source.rowCount = resources.length
  source.metadata.recordCount = resources.length
  source.metadata.matchedVehicleCount = resources.length
  source.metadata.unmatchedRecordCount = 0
  for (const [channel, key] of [['factoryEquipment', 'factoryEquipmentCount'], ['autoCheckReport', 'externalAutoCheckCount'], ['operationalEvidence', 'operationalEvidenceCount'], ['serviceHistory', 'serviceHistoryCount'], ['warrantyCheck', 'warrantyCheckCount']]) {
    const count = resources.filter(row => row.resourceRecord[channel]).length
    if (count || ['factoryEquipmentCount', 'externalAutoCheckCount'].includes(key)) source.metadata[key] = count
    else delete source.metadata[key]
  }
  source.provenanceSha256 = resourceProvenanceSha256(source, result.release.vehicles)
  return result
}
function storedService(serviceHistory, action) {
  const database = openInventoryDatabase()
  try {
    const release = bundle(serviceHistory).release
    release.manifestPath = 'synthetic-fixture://provider-service-privacy'
    for (const run of Object.values(release.sourceRuns)) if (run) run.snapshotPath = 'synthetic-fixture://provider-service-privacy'
    importRelease(database, release, { loadedAt: CAPTURED_AT })
    return action(createInventoryService({ database, now: () => new Date('2026-08-30T15:00:00Z') }))
  } finally { database.close() }
}

describe('provider mechanical service description privacy', () => {
  it.each(PRIVATE_DESCRIPTIONS)('rejects complete private or ambiguous prose rather than extracting a service: %s', description => {
    const value = history([description])
    const before = structuredClone(value)
    expect(() => validateServiceHistoryEvidence(value, VIN)).toThrow(/service must describe mechanical work/)
    expect(() => validateVinDocumentEnrichment(enrichment(value))).toThrow(/service must describe mechanical work/)
    expect(() => validateReleaseBundle(bundle(value))).toThrow(/service must describe mechanical work/)
    expect(value).toEqual(before)
  })

  it.each(['oem', 'autocheck', 'carfax'])('rejects attribution in %s and drops its entire optional channel on publishing', provider => {
    const value = history(['Oil and filter changed', 'Brake replacement approved by Jane Smith'], provider)
    const rejected = []
    const normalized = validateVinDocumentEnrichmentForPublish(enrichment(value), { onResourceRejected: row => rejected.push(row) })
    expect(normalized.recordsByVin[VIN]).toBeUndefined()
    expect(rejected).toEqual([expect.objectContaining({ vin: VIN, channel: 'serviceHistory' })])
    expect(JSON.stringify(rejected)).not.toContain('Jane Smith')
    const cloud = bundle(value)
    validateReleaseBundle(cloud, { degradeOptionalResources: true })
    expect(cloud.release.vehicles.find(row => row.vin === VIN).resourceRecord?.serviceHistory).toBeUndefined()
    expect(JSON.stringify(cloud)).not.toContain('Jane Smith')
  })

  // Previously this test required every read to throw: one optional legacy
  // attribution blocked the entire inventory. Quarantine preserves the privacy
  // boundary while keeping validated event facts and unrelated vehicles usable.
  it.each(['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver'])('quarantines stored narratives without blocking any %s response or search projection', role => {
    const narratives = [...PRIVATE_DESCRIPTIONS, 'Legacy provider maintenance narrative',
      'Oil and filter changed for PRIVATE_MARKER', 'Owner name: PRIVATE_MARKER',
      'Vehicle inspected at 123 Example Street', 'Vehicle inspected for private@example.test',
      'Vehicle inspected for (555) 010-1234']
    const value = history(['Engine mounts replaced', narratives[0]])
    value.reports[0].entries.push(...narratives.map(description => ({ date: '2026-08-28',
      odometer: 41000, odometerUnit: 'km', services: [description] })))
    value.reports.push(...history(['Front brake pads replaced'], 'carfax').reports)
    const before = structuredClone(value)
    const expected = projectServiceHistoryEvidence(value, VIN)
    expect(expected.reports[0]).toMatchObject({ dataState: 'incomplete', historyStatus: 'reported' })
    expect(expected.reports[0].entries[0]).toEqual({ date: '2026-08-29', odometer: 42000,
      odometerUnit: 'mi', services: ['Engine mounts replaced'] })
    for (const entry of expected.reports[0].entries.slice(1)) {
      expect(entry).toEqual({ date: '2026-08-28', odometer: 41000, odometerUnit: 'km', services: [] })
    }
    expect(expected.reports[1]).toEqual(value.reports[1])
    expect(value).toEqual(before)
    storedService(value, service => {
      const context = { role, store: 'Howell', user: `Synthetic ${role}` }
      const detail = service.getVehicle(VIN, context)
      const list = service.listVehicles({ limit: 50 }, context)
      const bootstrap = service.bootstrap(context)
      expect(list.total).toBeGreaterThan(1)
      expect(bootstrap.vehicles.length).toBeGreaterThan(1)
      for (const vehicle of [detail, list.items.find(row => row.vin === VIN), bootstrap.vehicles.find(row => row.vin === VIN)]) {
        expect(vehicle.serviceHistory).toEqual(expected)
        expect(vehicle).not.toHaveProperty('resourceRecord')
        if (['coordinator', 'porter', 'driver'].includes(role)) expect(vehicle.privateEvidence).toBeUndefined()
      }
      for (const response of [detail, list, bootstrap]) {
        const serialized = JSON.stringify(response)
        for (const narrative of narratives) expect(serialized).not.toContain(narrative)
        expect(serialized).not.toContain('PRIVATE_MARKER')
        expect(serialized).not.toContain('private@example.test')
      }
      for (const q of ['2026-08-28', '41000', '2026-08-29', '42000']) {
        expect(service.listVehicles({ q, limit: 50 }, context).items.map(row => row.vin)).toContain(VIN)
      }
      expect(service.listVehicles({ q: 'PRIVATE_MARKER', limit: 50 }, context).total).toBe(0)
    })
  })

  it.each(['current', 'incomplete', 'stale_unverified', 'unknown'])('retains the %s freshness boundary when quarantining a stored narrative', dataState => {
    const value = history(['Oil and filter changed for PRIVATE_MARKER'])
    value.reports[0].dataState = dataState
    expect(projectServiceHistoryEvidence(value, VIN).reports[0]).toEqual({ ...value.reports[0],
      dataState: dataState === 'current' ? 'incomplete' : dataState,
      entries: [{ date: '2026-08-29', odometer: 42000, odometerUnit: 'mi', services: [] }] })
  })

  it.each([
    ['unsupported channel field', value => { value.raw = 'PRIVATE_MARKER' }],
    ['mismatched VIN', value => { value.reports[0].vin = 'TESTDATAHWELL0003' }],
    ['unsupported provider', value => { value.reports[0].provider = 'unknown-provider' }],
    ['invalid freshness', value => { value.reports[0].dataState = 'fresh' }],
    ['invalid capture timestamp', value => { value.reports[0].capturedAt = '2026-02-30T14:00:00Z' }],
    ['unsupported report field', value => { value.reports[0].customerName = 'PRIVATE_MARKER' }],
    ['private source label', value => { value.reports[0].sourceLabel = 'Owner name: PRIVATE_MARKER' }],
    ['duplicate reports', value => { value.reports.push(structuredClone(value.reports[0])) }],
    ['excess reports', value => { value.reports = Array.from({ length: 13 }, () => structuredClone(value.reports[0])) }],
    ['contradictory history status', value => { value.reports[0].historyStatus = 'not_reported' }],
    ['excess entries', value => { value.reports[0].entries = Array.from({ length: 251 }, () => structuredClone(value.reports[0].entries[0])) }],
    ['unsupported entry field', value => { value.reports[0].entries[0].comment = 'PRIVATE_MARKER' }],
    ['invalid calendar date', value => { value.reports[0].entries[0].date = '2026-02-30' }],
    ['empty services', value => { value.reports[0].entries[0].services = [] }],
    ['excess services', value => { value.reports[0].entries[0].services = Array(13).fill('Oil and filter changed') }],
    ['non-string service', value => { value.reports[0].entries[0].services = [42] }],
    ['blank service', value => { value.reports[0].entries[0].services = [' '] }],
    ['overlong service', value => { value.reports[0].entries[0].services = ['x'.repeat(241)] }],
    ['control character service', value => { value.reports[0].entries[0].services = ['Oil and filter changed\nPRIVATE_MARKER'] }],
    ['string odometer', value => { value.reports[0].entries[0].odometer = '42000' }],
    ['fractional odometer', value => { value.reports[0].entries[0].odometer = 42000.5 }],
    ['negative odometer', value => { value.reports[0].entries[0].odometer = -1 }],
    ['excess odometer', value => { value.reports[0].entries[0].odometer = 20_000_001 }],
    ['unknown odometer unit', value => { value.reports[0].entries[0].odometerUnit = 'miles' }],
  ])('continues failing closed on stored %s', (_label, mutate) => {
    const value = history(['Legacy provider maintenance narrative'])
    mutate(value)
    expect(() => projectServiceHistoryEvidence(value, VIN)).toThrow(/Invalid provider evidence/)
    storedService(value, service => {
      const context = { role: 'coordinator', store: 'Howell', user: 'Synthetic coordinator' }
      for (const read of [() => service.getVehicle(VIN, context),
        () => service.listVehicles({ limit: 50 }, context), () => service.bootstrap(context)]) {
        expect(read).toThrow(/Invalid provider evidence/)
      }
    })
  })

  const SAFE_DESCRIPTIONS = [...VAUTO_AUTOCHECK_MECHANICAL_DESCRIPTIONS,
    'Oil and filter service', 'Synthetic oil and filter service', 'Synthetic tire rotation',
    'Synthetic brake inspection', 'Engine mounts replaced', 'Front brake pads replaced',
    'Pickup truck fuel filter replaced', 'Manufacturer recommended maintenance performed',
    '30,000-mile service performed', '5W-30 engine oil installed',
    'Transmission fluid changed', 'Air filter replaced', 'Cabin air filter replaced',
    'Battery replaced', 'Spark plugs replaced', 'Tires balanced', 'Wheel alignment performed',
    'Brake inspection/service', 'Tire inspection/service',
  ]
  it.each(SAFE_DESCRIPTIONS)('preserves a documented mechanical fact unchanged: %s', description => {
    const value = history([description])
    expect(projectServiceHistoryEvidence(value, VIN)).toEqual(value)
    expect(validateServiceHistoryEvidence(value, VIN)).toEqual(value)
    expect(validateVinDocumentEnrichment(enrichment(value)).recordsByVin[VIN].serviceHistory).toEqual(value)
    expect(() => validateReleaseBundle(bundle(value))).not.toThrow()
  })

  it.each(['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver'])('preserves safe service facts, date and mileage in the %s employee projection', role => {
    const value = history(['Engine mounts replaced', 'Front brake pads replaced'])
    storedService(value, service => {
      const context = { role, store: 'Howell', user: `Synthetic ${role}` }
      const vehicle = service.getVehicle(VIN, context)
      expect(vehicle.serviceHistory).toEqual(value)
      expect(vehicle).not.toHaveProperty('resourceRecord')
      if (['coordinator', 'porter', 'driver'].includes(role)) expect(vehicle.privateEvidence).toBeUndefined()
      for (const q of ['2026-08-29', '42000']) {
        expect(service.listVehicles({ q, limit: 50 }, context).items.map(row => row.vin)).toContain(VIN)
      }
    })
  })
})
