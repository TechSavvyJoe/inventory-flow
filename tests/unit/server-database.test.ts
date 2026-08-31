// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import {
  countTransfers,
  getCurrentDataset,
  importRelease,
  openInventoryDatabase,
} from '../../server/database.mjs'
import { findLatestCompletedManifest, loadLatestCompletedRelease } from '../../server/importer.mjs'

describe('separate Inventory Flow ledger', () => {
  it('imports immutable source rows without fabricating home assignments or transfers', () => {
    const fixture = createSyntheticWorkspace()
    const { manifest } = findLatestCompletedManifest(fixture.workspaceRoot)
    const release = loadLatestCompletedRelease({
      workspaceRoot: fixture.workspaceRoot,
      now: new Date(`${manifest.report_date}T18:00:00-04:00`),
    })
    const database = openInventoryDatabase()

    try {
      importRelease(database, release, { loadedAt: `${manifest.report_date}T22:00:00.000Z` })
      const dataset = getCurrentDataset(database)
      expect(dataset.publicRows).toHaveLength(manifest.source_counts.public_unique_vins)
      expect(dataset.crmRows).toHaveLength(manifest.source_counts.dealermail_used_rows)
      expect(dataset.holdRows).toHaveLength(manifest.source_counts.active_held_vins)
      expect(dataset.resourceRows).toHaveLength(1)
      expect(dataset.resourceRows[0]).toMatchObject({ vin: 'TESTDATAHWELL0001' })
      expect(dataset.resourceRows[0].payload.factoryEquipment).toMatchObject({
        totalMsrp: 68420,
        isOriginalWindowSticker: false,
      })
      expect(dataset.sourceRuns.resources).toMatchObject({
        source_type: 'vin_document_enrichment',
        row_count: 1,
      })
      expect(dataset.homeAssignments).toHaveLength(0)
      expect(countTransfers(database)).toBe(0)
    } finally {
      database.close()
      fixture.cleanup()
    }
  })
})
