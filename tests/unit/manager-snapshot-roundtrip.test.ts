// @ts-nocheck -- the daily runner, importer and Worker validator are plain ESM.
// @vitest-environment node
// End-to-end: the daily runner binds a release to a content-addressed copy of
// the monthly manager log, the importer loads that release, and the Worker's
// release validator accepts the published bundle. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { loadLatestCompletedRelease } from '../../server/importer.mjs'
import { cloudReleaseFrom } from '../../scripts/publish-cloud-release.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { MANAGER_DISPOSITION_AUTHORITY, MANAGER_DISPOSITION_INDEPENDENCE } from '../../server/manager-disposition-schema.mjs'

let fixture
let previousRoot
let internals

beforeAll(async () => {
  fixture = createSyntheticWorkspace()
  mkdirSync(path.join(fixture.workspaceRoot, 'outputs'), { recursive: true })
  mkdirSync(path.join(fixture.workspaceRoot, 'apps', 'inventory-ops'), { recursive: true })
  previousRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
  process.env.BOB_MAXEY_WORKSPACE_ROOT = fixture.workspaceRoot
  internals = (await import('../../scripts/run-inventory-flow-daily.mjs')).internals
})

afterAll(() => {
  if (previousRoot === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
  else process.env.BOB_MAXEY_WORKSPACE_ROOT = previousRoot
  fixture?.cleanup()
})

// The synthetic DealerMail capture is shaped for local loading; give it the
// complete-inventory evidence the Worker validator requires before publishing.
function publishable(release) {
  const snapshot = release.dealerMailSnapshot
  const included = snapshot.completeDealerMailUsedInventory.rows
  const heldVins = new Set(snapshot.vehicles.map((row) => row.mainRow.vin))
  const counts = (rows) => Object.fromEntries(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'].map((store) => [store, rows.filter((row) => row.storeName === store).length]))
  for (const row of included) {
    row.rawCellInnerText = Array(22).fill('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS')
    row.rawCellControlValues = Array.from({ length: 22 }, () => [])
    row.holdStateFromRowClass = heldVins.has(row.vin) ? 'active_hold' : 'no_current_hold_found'
  }
  const excluded = included.filter((row) => !heldVins.has(row.vin))
  snapshot.excludeActiveHoldsValidationSet = { readOnly: true, rows: excluded, summary: { totalRows: excluded.length, uniqueVinCount: excluded.length, uniqueStockCount: excluded.length, byStore: counts(excluded) } }
  snapshot.completeInventorySetValidation.activeHoldDifferenceRows = included.filter((row) => heldVins.has(row.vin)).map(({ vin, stockNumber, storeName, storeCode }) => ({ vin, stockNumber, storeName, storeCode }))
  snapshot.crmInventoryControlValidation = { completeInventoryRowsIncludingHolds: included.length, inventoryRowsExcludingHolds: excluded.length, activeHoldVINsRemovedByExcludeFilter: heldVins.size, excludeFilterRemovedExactlyTheActiveHoldSet: true, includingHoldsByStore: counts(included), excludingHoldsByStore: counts(excluded), lotReadyOnlyRowsIncludingHolds: included.length, lotReadyOnlyVINSetEqualsAllVehiclesVINSet: true }
  for (const held of snapshot.vehicles) for (const detail of held.holdDetailRows) detail.orderRaw = String(detail.holdOrderNumber)
  snapshot.vehicles[0].holdDetailRows.push({ lifecycleStatus: 'deleted_history', holdPosition: 'deleted', orderRaw: 'DELETED', customerOrReasonRaw: 'Synthetic deleted history' })
  snapshot.summary.totalHoldDetailRows += 1
  snapshot.summary.deletedHistoricalHoldRows += 1
  return cloudReleaseFrom(release)
}

describe('manager log bound to a release', () => {
  it('writes an approved-name copy under its content hash, loads it, and passes the cloud validator even after the monthly log changes', () => {
    const root = fixture.workspaceRoot
    const reportDate = fixture.reportDate
    const month = reportDate.slice(0, 7)
    const now = new Date(`${reportDate}T16:00:00-04:00`)
    const manifestPath = path.join(root, 'work', 'run-status', `${reportDate}.json`)
    const baseManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const howell = loadLatestCompletedRelease({ workspaceRoot: root, now }).vehicles.filter((v) => v.publicRecord?.store === 'Howell').slice(0, 2)
    expect(howell).toHaveLength(2)
    const managerLog = {
      schema_version: '1.0', classification: 'operational-redacted', cloud_upload_allowed: true,
      source_store: 'Howell', source_period: month, source_type: 'manager-log',
      status_authority: MANAGER_DISPOSITION_AUTHORITY, status_independence: MANAGER_DISPOSITION_INDEPENDENCE,
      records: [
        { stock_number: howell[0].publicRecord.stock_number, vin: howell[0].vin, vehicle: 'SYNTHETIC', sold_manager_log: true, delivered_manager_log: true, delivery_date: reportDate, confidence: 'high' },
        { stock_number: howell[1].publicRecord.stock_number, vin: howell[1].vin, vehicle: 'SYNTHETIC', sold_manager_log: true, delivered_manager_log: false, delivery_date: null, confidence: 'high' },
      ],
      summary: { sold_records: 2, delivered_records: 1, sold_not_marked_delivered: 1 },
    }
    const soldLog = path.join(root, 'work', 'manager-supplied', 'sold-logs', `${month}-howell-operational.json`)
    mkdirSync(path.dirname(soldLog), { recursive: true })
    writeFileSync(soldLog, JSON.stringify(managerLog))

    const derived = internals.deriveManifest({
      reportDate,
      publicPath: path.resolve(root, baseManifest.public_snapshot_path),
      dealerPath: path.resolve(root, baseManifest.dealermail_snapshot_path),
      warnings: [], steps: [], managerDispositionValidated: true,
    })
    const binding = derived.manager_disposition_overlay
    expect(path.basename(binding.path)).toBe(`${month}-howell-operational.json`)
    expect(path.dirname(binding.path)).toBe(path.join(root, 'work', 'releases', reportDate, 'manager-disposition', binding.sha256.toLowerCase()))
    writeFileSync(manifestPath, JSON.stringify({ ...baseManifest, manager_disposition_overlay: binding }))

    const loaded = loadLatestCompletedRelease({ workspaceRoot: root, now })
    expect(loaded.managerDispositionOverlay.coverageStatus).toBe('provided')
    const bundle = publishable(loaded)
    expect(bundle.release.manifest.manager_disposition_overlay.path).toBe(`local-file:${month}-howell-operational.json`)
    expect(() => validateReleaseBundle(bundle)).not.toThrow()

    // The reason for the copy: a later manager update must not invalidate the
    // verified release, which stays bound to the bytes it was built from.
    writeFileSync(soldLog, JSON.stringify({ ...managerLog, records: managerLog.records.slice(0, 1), summary: { sold_records: 1, delivered_records: 1, sold_not_marked_delivered: 0 } }))
    const reloaded = loadLatestCompletedRelease({ workspaceRoot: root, now })
    expect(reloaded.managerDispositionOverlay.coverageStatus).toBe('provided')
    expect(reloaded.managerDispositionOverlay.summary.soldRecordCount).toBe(loaded.managerDispositionOverlay.summary.soldRecordCount)

    // Tampering with the bound copy is still caught.
    writeFileSync(binding.path, JSON.stringify({ ...managerLog, records: [] }))
    expect(() => loadLatestCompletedRelease({ workspaceRoot: root, now })).toThrow(/checksum differs/)
  })
})
