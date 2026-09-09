// @ts-nocheck -- exercises complete Node SQLite backup and Worker decryption.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runRecoveryDrill } from '../../scripts/run-recovery-drill.mjs'

describe('isolated operational recovery', () => {
  it('restores all rows, schema, audit, identity and revision from encrypted artifacts after removing the source database', async () => {
    const result = await runRecoveryDrill()
    expect(result).toMatchObject({ complete: true, syntheticOnly: true, roleStoreViewsChecked: 24 })
    expect(Object.values(result.checks).every((value) => value === true)).toBe(true)
    expect(result.database.rowCounts).toMatchObject({ transfer_requests: 1, transfer_events: 4, attention_work_items: 1, attention_events: 1, cloud_memberships: 24, cloud_release_versions: 1, home_assignments: 1 })
    expect(result.sourceCounts).toMatchObject({ publicRowCount: 8, dealerMailRowCount: 8, heldVinCount: 2, activeHoldRecordCount: 3, backupCount: 1, deletedHoldRecordCount: 1 })
  }, 60000)
})
