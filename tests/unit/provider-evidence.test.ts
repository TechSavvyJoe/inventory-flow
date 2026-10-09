// @ts-nocheck -- shared portable backend modules use plain ESM.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { validateOperationalEvidence, validateServiceHistoryEvidence } from '../../server/provider-evidence.mjs'
import { validateVinDocumentEnrichment, validateVinDocumentEnrichmentForPublish } from '../../server/importer.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { resourceProvenanceSha256 } from '../../server/resource-validation.mjs'
import { inventoryDecision } from '../../server/manual-holds.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServer } from '../../server/api.mjs'

const VIN = 'TESTDATAHWELL0002'
const observation = { vin: VIN, provider: 'crm-one', sourceLabel: 'Synthetic CRM', capturedAt: '2026-08-30T14:00:00Z', dataState: 'current', readOnly: true, complete: true, holdState: 'held' }
const report = { vin: VIN, provider: 'carfax', sourceLabel: 'CARFAX', capturedAt: observation.capturedAt, dataState: 'current', historyStatus: 'reported', entries: [{ date: '2026-08-29', odometer: 42000, odometerUnit: 'mi', services: ['Oil and filter changed'] }] }
const coverage = { type: 'Basic', termText: '3 years / 36,000 miles', remainingMilesText: 'Unknown', remainingTimeText: 'Unknown', status: 'N/A' }
function enrichment(resource) { return structuredClone({ schemaVersion: 'inventory-flow-vin-document-enrichment-v1', generatedAt: observation.capturedAt, recordsByVin: { [VIN]: { vin: VIN, ...resource } } }) }
function cloud(resource) {
  const bundle = buildSyntheticCloudBundle()
  const normalized = validateVinDocumentEnrichment(enrichment(resource))
  const row = bundle.release.vehicles.find(row => row.vin === VIN)
  row.resourceRecord = normalized.recordsByVin[VIN]
  const source = bundle.release.sourceRuns.resources
  const resourceRows = bundle.release.vehicles.filter(row => row.resourceRecord)
  source.rowCount = resourceRows.length
  source.metadata.recordCount = resourceRows.length
  source.metadata.matchedVehicleCount = resourceRows.length
  source.metadata.unmatchedRecordCount = 0
  for (const [channel, key] of [['factoryEquipment', 'factoryEquipmentCount'], ['autoCheckReport', 'externalAutoCheckCount'], ['operationalEvidence', 'operationalEvidenceCount'], ['serviceHistory', 'serviceHistoryCount'], ['warrantyCheck', 'warrantyCheckCount']]) {
    const count = resourceRows.filter(row => row.resourceRecord[channel]).length
    if (count || ['factoryEquipmentCount', 'externalAutoCheckCount'].includes(key)) source.metadata[key] = count
    else delete source.metadata[key]
  }
  source.provenanceSha256 = resourceProvenanceSha256(source, bundle.release.vehicles)
  return bundle
}

describe('safe independent provider evidence', () => {
  it('normalizes exact-VIN observations without aliasing or creating a source claim for empty arrays', () => {
    const source = { records: [{ ...observation, sourceLabel: ' Synthetic CRM ' }] }
    const before = structuredClone(source)
    const result = validateOperationalEvidence(source, VIN)
    expect(result.records[0].sourceLabel).toBe('Synthetic CRM')
    result.records[0].holdState = 'unknown'
    expect(source).toEqual(before)
    expect(validateVinDocumentEnrichment(enrichment({ operationalEvidence: { records: [] }, serviceHistory: { reports: [] } })).metadata).not.toHaveProperty('operationalEvidenceCount')
    expect(validateServiceHistoryEvidence({ reports: [] }, VIN)).toEqual({ reports: [] })
  })
  it.each([
    { ...observation, vin: VIN.toLowerCase() },
    { ...observation, vin: 'TESTDATASYN000007' },
    { ...observation, customer: 'private' },
    { ...observation, provider: 'private/id' },
    { ...observation, provider: 'legacy-dealermail' },
    { ...observation, sourceLabel: 'customer: Private' },
    { ...observation, capturedAt: '2026-02-30T14:00:00Z' },
    { ...observation, dataState: 'retained' },
    { ...observation, readOnly: false },
    { ...observation, complete: false, holdState: 'not_observed' },
    { ...observation, dataState: 'stale_unverified', holdState: 'not_observed' },
    { ...observation, dataState: 'incomplete', reportedDisposition: 'not_observed' },
  ])('rejects unsafe or contradictory observations: %j', record => {
    expect(() => validateOperationalEvidence({ records: [record] }, VIN)).toThrow()
    expect(() => validateVinDocumentEnrichment(enrichment({ operationalEvidence: { records: [record] } }))).toThrow()
  })
  it('rejects duplicates and oversized source arrays', () => {
    expect(() => validateOperationalEvidence({ records: [observation, observation] }, VIN)).toThrow(/unique/)
    expect(() => validateOperationalEvidence({ records: Array.from({ length: 13 }, (_, i) => ({ ...observation, provider: `crm-${i}` })) }, VIN)).toThrow(/bounded/)
    expect(() => validateServiceHistoryEvidence({ reports: [report, report] }, VIN)).toThrow(/unique/)
  })
  it.each([
    { ...report, owner: 'Private' },
    { ...report, provider: 'dealer' },
    { ...report, historyStatus: 'not_reported' },
    { ...report, historyStatus: 'reported', entries: [] },
    { ...report, entries: [{ ...report.entries[0], date: '2026-02-30' }] },
    { ...report, entries: [{ ...report.entries[0], repairOrderNumber: 'private-id' }] },
    { ...report, entries: [{ ...report.entries[0], odometer: -1 }] },
    { ...report, entries: [{ ...report.entries[0], services: ['customer: Private'] }] },
    { ...report, entries: [{ ...report.entries[0], services: Array(13).fill('Checked') }] },
    { ...report, entries: Array(251).fill(report.entries[0]) },
  ])('requires explicit bounded service events and excludes private material: %j', bad => {
    expect(() => validateServiceHistoryEvidence({ reports: [bad] }, VIN)).toThrow()
  })
  it.each([
    'Customer Jane Example requested repairs; vehicle collected at 123 Example Street.',
    'Owner Jane Example approved the repair.',
    'Salesperson Jane Example requested inspection.',
    'Contact Jane Example before work begins.',
    'Vehicle collected at 123 Example Street.',
    'Pickup arranged for Jane Example after repairs.',
    'Delivered to 456 West Example Ave.',
    'Repairs completed at 789 North Example Road.',
    'Vehicle was picked up by Jane Example.',
  ])('rejects recognizable private service narratives in both validators: %s', service => {
    const resource = { serviceHistory: { reports: [{ ...report, entries: [{ ...report.entries[0], services: [service] }] }] } }
    expect(() => validateServiceHistoryEvidence(resource.serviceHistory, VIN)).toThrow(/service must describe/)
    expect(() => validateVinDocumentEnrichment(enrichment(resource))).toThrow(/service must describe/)
    const bundle = cloud({ serviceHistory: { reports: [report] } })
    bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord.serviceHistory = structuredClone(resource.serviceHistory)
    bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
    expect(() => validateReleaseBundle(bundle)).toThrow(/service must describe/)
  })
  it('fails closed before exposing a recognizable private narrative from stored evidence to a driver', () => {
    const bundle = cloud({ serviceHistory: { reports: [report] } })
    bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord.serviceHistory.reports[0].entries[0].services = ['Customer Jane Example requested repairs; vehicle collected at 123 Example Street.']
    const database = openInventoryDatabase()
    try {
      bundle.release.manifestPath = 'synthetic-fixture://manifest'
      for (const run of Object.values(bundle.release.sourceRuns)) if (run) run.snapshotPath = 'synthetic-fixture://provider-evidence'
      importRelease(database, bundle.release, { loadedAt: observation.capturedAt })
      const service = createInventoryService({ database, now: () => new Date('2026-08-30T15:00:00Z') })
      expect(() => service.getVehicle(VIN, { role: 'driver', store: 'Howell', user: 'Synthetic driver' })).toThrow(/service must describe mechanical work/)
    } finally { database.close() }
  })
  it('retains safe mechanical descriptions without turning dates or mileage into events', () => {
    const services = ['Oil and filter changed', 'Tires rotated', 'Transmission serviced', 'Brake pads replaced', 'Vehicle road tested', 'Pickup truck fuel filter replaced', 'Manufacturer recommended maintenance performed', '30,000-mile service performed', '5W-30 engine oil installed']
    const resource = { serviceHistory: { reports: [{ ...report, entries: [{ ...report.entries[0], services }] }] } }
    expect(validateServiceHistoryEvidence(resource.serviceHistory, VIN).reports[0].entries[0].services).toEqual(services)
    expect(() => validateReleaseBundle(cloud(resource))).not.toThrow()
  })
  it('retains valid ISO offsets, unknown freshness, and genuinely reported entries without added detail', () => {
    expect(validateOperationalEvidence({ records: [{ ...observation, dataState: 'unknown', capturedAt: '2026-08-30T10:00:00-04:00' }] }, VIN).records[0]).toMatchObject({ dataState: 'unknown', capturedAt: '2026-08-30T10:00:00-04:00' })
    const result = validateServiceHistoryEvidence({ reports: [{ ...report, entries: [{ date: '2026-08-29', odometer: null, services: [] }] }] }, VIN)
    expect(result.reports[0].entries).toEqual([{ date: '2026-08-29', odometer: null, services: [] }])
    expect(result.reports[0]).not.toHaveProperty('complete')
  })
  it.each([
    ['operationalEvidence', value => { value.records[0].employeeId = 'private' }],
    ['operationalEvidence', value => { value.records[0].provider = 'legacy-dealermail' }],
    ['operationalEvidence', value => { value.records[0].complete = false; value.records[0].holdState = 'not_observed' }],
    ['serviceHistory', value => { value.reports[0].entries[0].ownerName = 'Private' }],
    ['serviceHistory', value => { value.reports[0].entries[0].date = '2026-02-30' }],
  ])('rejects the same unsafe %s channel in importer and Worker', (channel, mutate) => {
    const resource = { operationalEvidence: { records: [structuredClone(observation)] }, serviceHistory: { reports: [structuredClone(report)] } }
    const bundle = cloud(resource)
    const bad = structuredClone(resource)
    mutate(bad[channel])
    expect(() => validateVinDocumentEnrichment(enrichment(bad))).toThrow()
    bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord[channel] = bad[channel]
    bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
    expect(() => validateReleaseBundle(bundle)).toThrow()
  })
  it('accepts CARFAX-only estimated warranty without inventing remaining figures or OEM facts', () => {
    const warrantyCheck = { dataState: 'current', capturedAt: observation.capturedAt, sourceLabel: 'CARFAX estimated warranty', mileageEntered: 42000, carfax: { coverages: [coverage] } }
    const validated = validateVinDocumentEnrichment(enrichment({ warrantyCheck })).recordsByVin[VIN].warrantyCheck
    expect(validated.carfax.coverages[0]).not.toHaveProperty('remainingMiles')
    expect(validated).not.toHaveProperty('fordOasis')
    const bundle = cloud({ warrantyCheck })
    expect(() => validateReleaseBundle(bundle)).not.toThrow()
    bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord.warrantyCheck.carfax.owner = 'Private'
    expect(() => validateReleaseBundle(bundle)).toThrow(/unsupported/)
  })
  it('preserves status-only CARFAX Basic, Corrosion, and Emissions categories with matching Node and Worker unknown text', () => {
    const rows = [{ type: 'Basic', status: 'EXPIRED' }, { type: 'Corrosion', status: 'N/A' }, { type: 'Emissions', status: 'ACTIVE' }]
    const warrantyCheck = { dataState: 'current', capturedAt: observation.capturedAt, sourceLabel: 'CARFAX estimated warranty', mileageEntered: 42000, carfax: { coverages: rows } }
    const normalized = validateVinDocumentEnrichment(enrichment({ warrantyCheck })).recordsByVin[VIN].warrantyCheck
    expect(normalized.carfax.coverages).toEqual(rows.map(row => ({ ...row, termText: 'Unknown', remainingMilesText: 'Unknown', remainingTimeText: 'Unknown' })))
    for (const row of normalized.carfax.coverages) {
      expect(row).not.toHaveProperty('remainingMiles')
      expect(row).not.toHaveProperty('remainingMonths')
      expect(row).not.toHaveProperty('termMonths')
      expect(row).not.toHaveProperty('termMiles')
    }
    const bundle = cloud({ warrantyCheck })
    // Exercise raw status-only rows, not merely the Node-normalized publisher output.
    const resource = bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord
    resource.warrantyCheck.carfax.coverages = structuredClone(rows)
    bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
    expect(() => validateReleaseBundle(bundle)).not.toThrow()
    expect(resource.warrantyCheck.carfax.coverages).toEqual(normalized.carfax.coverages)
    expect(resource.warrantyCheck).not.toHaveProperty('fordOasis')
  })
  it.each([
    { status: 'ACTIVE' },
    { type: 'Basic' },
    { type: 'Basic', status: 'UNKNOWN' },
    { type: 'Basic', status: 'ACTIVE', termText: 36 },
    { type: 'Basic', status: 'ACTIVE', remainingMilesText: 'x'.repeat(41) },
    { type: 'Basic', status: 'ACTIVE', owner: 'Private' },
  ])('still rejects invalid status-only CARFAX coverage: %j', row => {
    const warrantyCheck = { dataState: 'current', capturedAt: observation.capturedAt, sourceLabel: 'CARFAX estimated warranty', mileageEntered: 42000, carfax: { coverages: [row] } }
    expect(() => validateVinDocumentEnrichment(enrichment({ warrantyCheck }))).toThrow()
    const bundle = cloud({ warrantyCheck: { ...warrantyCheck, carfax: { coverages: [{ type: 'Basic', status: 'ACTIVE' }] } } })
    bundle.release.vehicles.find(record => record.vin === VIN).resourceRecord.warrantyCheck.carfax.coverages = [row]
    bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
    expect(() => validateReleaseBundle(bundle)).toThrow()
  })
  it.each(['autoCheck', 'fordOasis'])('keeps %s term and remaining-text contracts strict when CARFAX is also present', source => {
    const row = source === 'fordOasis' ? { ...coverage, type: 'Bumper-to-Bumper' } : coverage
    const block = source === 'fordOasis' ? { warrantyStartDate: '07-June-2025', monthsInService: 14, coverages: [row] } : { coverages: [row] }
    const valid = { dataState: 'current', capturedAt: observation.capturedAt, sourceLabel: 'Synthetic warranty sources', mileageEntered: 42000, carfax: { coverages: [{ type: 'Emissions', status: 'ACTIVE' }] }, [source]: block }
    for (const field of ['termText', 'remainingMilesText', 'remainingTimeText']) {
      const invalid = structuredClone(valid)
      delete invalid[source].coverages[0][field]
      expect(() => validateVinDocumentEnrichment(enrichment({ warrantyCheck: invalid }))).toThrow(/required/)
      const bundle = cloud({ warrantyCheck: valid })
      delete bundle.release.vehicles.find(record => record.vin === VIN).resourceRecord.warrantyCheck[source].coverages[0][field]
      bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
      expect(() => validateReleaseBundle(bundle)).toThrow(/required/)
    }
  })
  it('validates Node and Worker channels with matching optional counts and safe employee projection', () => {
    const resource = { operationalEvidence: { records: [observation] }, serviceHistory: { reports: [report] } }
    const normalized = validateVinDocumentEnrichment(enrichment(resource))
    expect(normalized.metadata).toMatchObject({ operationalEvidenceCount: 1, serviceHistoryCount: 1 })
    const bundle = cloud(resource)
    expect(validateReleaseBundle(bundle)).toMatchObject({ operationalEvidenceCount: 1, serviceHistoryCount: 1 })
    const database = openInventoryDatabase()
    try {
      bundle.release.manifestPath = 'synthetic-fixture://manifest'
      for (const run of Object.values(bundle.release.sourceRuns)) if (run) run.snapshotPath = 'synthetic-fixture://provider-evidence'
      importRelease(database, bundle.release, { loadedAt: observation.capturedAt })
      const service = createInventoryService({ database, now: () => new Date('2026-08-30T15:00:00Z') })
      const context = { role: 'driver', store: 'Howell', user: 'Synthetic driver' }
      const vehicle = service.getVehicle(VIN, context)
      expect(vehicle.operationalEvidence).toEqual(resource.operationalEvidence)
      expect(vehicle.serviceHistory).toEqual(resource.serviceHistory)
      expect(vehicle).not.toHaveProperty('resourceRecord')
      expect(vehicle.hold.state).toBe('none_observed')
      expect(service.listVehicles({ hold: 'yes' }, context).items.map(row => row.vin)).toContain(VIN)
      expect(service.listVehicles({ hold: 'no' }, context).items.map(row => row.vin)).not.toContain(VIN)
    } finally { database.close() }
  })
  it.each([
    ['retained stale positive', { ...observation, dataState: 'stale_unverified' }, true, false],
    ['incomplete positive', { ...observation, dataState: 'incomplete', complete: false }, true, false],
    ['unknown positive', { ...observation, dataState: 'unknown' }, true, false],
    ['current incomplete positive', { ...observation, complete: false }, true, false],
    ['incomplete absence', { ...observation, dataState: 'incomplete', complete: false, holdState: 'unknown' }, false, false],
    ['unknown absence', { ...observation, dataState: 'unknown', holdState: 'unknown' }, false, false],
    ['current unverified absence', { ...observation, holdState: 'unknown' }, false, false],
    ['current verified no observation', { ...observation, holdState: 'not_observed' }, false, true],
  ])('filters actual Node employee API consistently for %s without changing legacy hold fields', async (_label, provider, held, noHold) => {
    const bundle = cloud({ operationalEvidence: { records: [provider] } })
    const database = openInventoryDatabase()
    let server
    try {
      bundle.release.manifestPath = 'synthetic-fixture://manifest'
      for (const run of Object.values(bundle.release.sourceRuns)) if (run) run.snapshotPath = 'synthetic-fixture://provider-evidence'
      importRelease(database, bundle.release, { loadedAt: observation.capturedAt })
      const service = createInventoryService({ database, now: () => new Date('2026-08-30T15:00:00Z') })
      server = createInventoryServer({ service })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const headers = { 'x-inventory-demo-role': 'sales', 'x-inventory-demo-store': 'Howell', 'x-inventory-demo-user': 'Synthetic filter reviewer' }
      const base = `http://127.0.0.1:${server.address().port}`
      const detailResponse = await fetch(`${base}/api/vehicles/${VIN}`, { headers })
      expect(detailResponse.status).toBe(200)
      const detail = await detailResponse.json()
      expect(detail.hold.state).toBe('none_observed')
      for (const [query, expected] of [['yes', held], ['no', noHold]]) {
        const response = await fetch(`${base}/api/vehicles?hold=${query}`, { headers })
        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result.items.some(row => row.vin === VIN)).toBe(expected)
      }
      if (provider.dataState !== 'current' || !provider.complete) expect(detail.inventoryDecision.status).toBe('unconfirmed')
    } finally {
      if (server?.listening) await new Promise(resolve => server.close(resolve))
      database.close()
    }
  })
  it('drops rejected optional resources consistently while retaining other validated evidence', () => {
    const resource = { operationalEvidence: { records: [observation] }, serviceHistory: { reports: [report] } }
    const input = enrichment(resource)
    input.recordsByVin[VIN].serviceHistory.reports[0].owner = 'Private'
    const rejected = []
    expect(validateVinDocumentEnrichmentForPublish(input, { onResourceRejected: value => rejected.push(value) }).recordsByVin[VIN]).toHaveProperty('operationalEvidence')
    expect(rejected[0]).toMatchObject({ channel: 'serviceHistory' })
    const bundle = cloud(resource)
    bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord.serviceHistory.reports[0].owner = 'Private'
    bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
    expect(() => validateReleaseBundle(bundle)).toThrow()
    const result = validateReleaseBundle(bundle, { degradeOptionalResources: true })
    expect(result).toHaveProperty('operationalEvidenceCount', 1)
    expect(bundle.release.vehicles.find(row => row.vin === VIN).resourceRecord).not.toHaveProperty('serviceHistory')
    expect(bundle.release.warnings.join(' ')).toContain('dropped unsafe serviceHistory')
  })
  it('keeps manual release, imported holds, app disposition, and provider disagreement independent', () => {
    const vehicle = { vin: VIN, hold: { state: 'primary', reason: 'Private' }, manualHold: { state: 'released' }, appDisposition: { code: 'delivered' }, operationalEvidence: { records: [{ ...observation, holdState: 'not_observed', reportedDisposition: 'sold_pending' }] } }
    const before = structuredClone(vehicle)
    const result = inventoryDecision(vehicle)
    expect(result).toMatchObject({ status: 'delivered', label: 'Delivered', importedHold: true, reviewRequired: true })
    expect(result.reasons).toEqual(expect.arrayContaining(['source_hold_after_manual_release', 'delivered_with_hold', 'provider_hold_disagreement', 'provider_disposition_mismatch']))
    expect(JSON.stringify(result.evidence)).not.toContain('Private')
    expect(vehicle).toEqual(before)
    expect(inventoryDecision({ ...vehicle, appDisposition: { code: null } })).toMatchObject({ status: 'held', label: 'Held' })
  })
  it('preserves the legacy held observation when a supplied DealerMail provider reports no hold', () => {
    const vehicle = { vin: VIN, hold: { state: 'primary', reason: 'Private legacy hold' }, manualHold: { state: 'released' }, operationalEvidence: { records: [{ ...observation, provider: 'dealermail', holdState: 'not_observed' }] } }
    const result = inventoryDecision(vehicle)
    expect(result).toMatchObject({ status: 'held', label: 'Held', importedHold: true, reviewRequired: true, comparison: 'conflict' })
    expect(result.evidence).toEqual([
      expect.objectContaining({ provider: 'legacy-dealermail', holdState: 'held', effectiveHoldState: 'held', comparison: 'conflict' }),
      expect.objectContaining({ provider: 'dealermail', holdState: 'not_observed', effectiveHoldState: 'not_observed', comparison: 'conflict' }),
    ])
    expect(result.reasons).toEqual(expect.arrayContaining(['source_hold_after_manual_release', 'provider_hold_disagreement']))
    expect(JSON.stringify(result)).not.toContain('Private legacy hold')
    expect(vehicle.hold.state).toBe('primary')
  })
  it('reports per-provider agreement only when current complete observations match another independent record', () => {
    const current = inventoryDecision({ vin: VIN, hold: { state: 'primary' }, operationalEvidence: { records: [observation] } })
    expect(current.evidence.find(row => row.provider === 'crm-one').comparison).toBe('agreement')
    const disposition = inventoryDecision({ vin: VIN, appDisposition: { code: 'sold_pending' }, operationalEvidence: { records: [{ ...observation, holdState: 'unknown', reportedDisposition: 'sold_pending' }] } })
    expect(disposition.evidence.find(row => row.provider === 'crm-one').comparison).toBe('agreement')
    const unknown = inventoryDecision({ vin: VIN, hold: { state: 'primary' }, operationalEvidence: { records: [{ ...observation, dataState: 'stale_unverified' }] } })
    expect(unknown.evidence.find(row => row.provider === 'crm-one').comparison).toBe('unverified')
  })
  it('flags provider disposition mismatch separately from hold agreement without adopting the source sale', () => {
    const result = inventoryDecision({ vin: VIN, operationalEvidence: { records: [
      { ...observation, holdState: 'not_observed', reportedDisposition: 'sold_pending' },
      { ...observation, provider: 'crm-two', holdState: 'not_observed', reportedDisposition: 'delivered' },
    ] } })
    expect(result).toMatchObject({ status: 'unconfirmed', reviewRequired: true, reasons: ['provider_disposition_mismatch'] })
    expect(result.evidence.filter(record => record.capturedAt).every(record => record.comparison === 'conflict')).toBe(true)
    const saved = inventoryDecision({ vin: VIN, appDisposition: { code: 'sold_pending' }, operationalEvidence: { records: [{ ...observation, holdState: 'not_observed', reportedDisposition: 'not_observed' }] } })
    expect(saved).toMatchObject({ status: 'sold_pending', label: 'Sold pending', reasons: [], reviewRequired: false })
  })
  it('does not invent legacy source observation or treat missing source disposition as a sale or availability claim', () => {
    const noLegacy = inventoryDecision({ vin: VIN, hold: { state: 'unknown' }, operationalEvidence: { records: [observation] } })
    expect(noLegacy.evidence.map(record => record.provider)).toEqual(['crm-one'])
    const retained = inventoryDecision({ vin: VIN, hold: { state: 'stale', lastKnownActiveHold: true }, operationalEvidence: { records: [] } })
    expect(retained.evidence).toEqual([expect.objectContaining({ provider: 'dealermail', dataState: 'stale_unverified', holdState: 'held', effectiveHoldState: 'unknown', complete: false, comparison: 'unverified' })])
    const keep = inventoryDecision({ vin: VIN, appDisposition: { code: 'keep' }, operationalEvidence: { records: [{ ...observation, holdState: 'not_observed', reportedDisposition: 'not_observed' }] } })
    expect(keep).toMatchObject({ status: 'unconfirmed', reasons: [], reviewRequired: false })
    const absence = inventoryDecision({ vin: VIN, operationalEvidence: { records: [{ ...observation, provider: 'crm-two', reportedDisposition: 'not_observed' }, { ...observation, reportedDisposition: 'delivered' }] } })
    expect(absence.reasons).not.toContain('provider_disposition_mismatch')
  })
  it('uses current complete hold observations only and never infers a sale from a provider', () => {
    for (const overrides of [{ dataState: 'stale_unverified' }, { dataState: 'incomplete' }, { dataState: 'unknown' }, { complete: false }]) {
      const result = inventoryDecision({ vin: VIN, manualHold: { state: 'released' }, operationalEvidence: { records: [{ ...observation, ...overrides, reportedDisposition: 'delivered' }] } })
      expect(result).toMatchObject({ status: 'unconfirmed', comparison: 'manual_only', reviewRequired: false })
      expect(result.evidence.find(row => row.provider === 'crm-one')).toMatchObject({ effectiveHoldState: 'unknown', comparison: 'unverified' })
    }
    expect(inventoryDecision({ vin: VIN, operationalEvidence: { records: [observation] } })).toMatchObject({ status: 'held', comparison: 'source_only' })
    expect(inventoryDecision({ vin: VIN, operationalEvidence: { records: [{ ...observation, holdState: 'not_observed', reportedDisposition: 'delivered' }] } })).toMatchObject({ status: 'unconfirmed', comparison: 'source_only' })
  })
})
