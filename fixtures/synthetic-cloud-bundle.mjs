// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// Complete publication-shaped evidence. No operational paths or credentials are read.
import { createSyntheticWorkspace } from './synthetic-workspace.mjs'
import { loadLatestCompletedRelease } from '../server/importer.mjs'
import { cloudReleaseFrom } from '../scripts/publish-cloud-release.mjs'

export function buildSyntheticCloudBundle() {
  const fixture = createSyntheticWorkspace()
  try {
    const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00Z') })
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
    snapshot.excludeActiveHoldsValidationSet = {
      readOnly: true, rows: excluded,
      summary: { totalRows: excluded.length, uniqueVinCount: excluded.length, uniqueStockCount: excluded.length, byStore: counts(excluded) },
    }
    snapshot.completeInventorySetValidation.activeHoldDifferenceRows = included.filter((row) => heldVins.has(row.vin)).map(({ vin, stockNumber, storeName, storeCode }) => ({ vin, stockNumber, storeName, storeCode }))
    snapshot.crmInventoryControlValidation = {
      completeInventoryRowsIncludingHolds: included.length, inventoryRowsExcludingHolds: excluded.length,
      activeHoldVINsRemovedByExcludeFilter: heldVins.size, excludeFilterRemovedExactlyTheActiveHoldSet: true,
      includingHoldsByStore: counts(included), excludingHoldsByStore: counts(excluded),
      lotReadyOnlyRowsIncludingHolds: included.length, lotReadyOnlyVINSetEqualsAllVehiclesVINSet: true,
    }
    for (const held of snapshot.vehicles) for (const detail of held.holdDetailRows) detail.orderRaw = String(detail.holdOrderNumber)
    snapshot.vehicles[0].holdDetailRows.push({ lifecycleStatus: 'deleted_history', holdPosition: 'deleted', orderRaw: 'DELETED', customerOrReasonRaw: 'Synthetic deleted history' })
    snapshot.summary.totalHoldDetailRows += 1
    snapshot.summary.deletedHistoricalHoldRows += 1
    return structuredClone(cloudReleaseFrom(release))
  } finally { fixture.cleanup() }
}
