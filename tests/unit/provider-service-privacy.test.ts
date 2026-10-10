// @ts-nocheck -- shared portable backend modules use plain ESM.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { validateServiceHistoryEvidence } from '../../server/provider-evidence.mjs'
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

  it.each(['coordinator', 'porter', 'driver'])('fails closed on stored attribution before any %s response or search projection', role => {
    for (const description of PRIVATE_DESCRIPTIONS.slice(0, 2)) {
      storedService(history([description]), service => {
        const context = { role, store: 'Howell', user: `Synthetic ${role}` }
        expect(() => service.getVehicle(VIN, context)).toThrow(/service must describe mechanical work/)
        expect(() => service.listVehicles({ limit: 50 }, context)).toThrow(/service must describe mechanical work/)
        expect(() => service.bootstrap(context)).toThrow(/service must describe mechanical work/)
      })
    }
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
