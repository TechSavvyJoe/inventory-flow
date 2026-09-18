// @ts-nocheck -- the daily orchestrator is plain ESM.
// @vitest-environment node
import { describe, expect, it } from 'vitest'

describe('app-first daily orchestrator helpers', () => {
  async function loadInternals() {
    process.env.BOB_MAXEY_WORKSPACE_ROOT = 'C:\\Users\\JoeGallant\\Documents\\Codex\\2026-08-27\\let-s-set-up-a-scheduled-3'
    return (await import('../../scripts/run-inventory-flow-daily.mjs')).internals
  }

  it('uses the New York report date instead of UTC midnight', async () => {
    const internals = await loadInternals()
    expect(internals.todayInNewYork(new Date('2026-09-18T02:00:00Z'))).toBe('2026-09-17')
  })

  it('formats the daily summary around app/API counts, not workbook status', async () => {
    const internals = await loadInternals()
    const summary = internals.summarize({
      reportDate: '2026-09-17',
      publishStatus: 'published_or_already_verified',
      manifestPath: 'work/run-status/2026-09-17.json',
      releasePath: 'work/releases/2026-09-17/inventory-flow-release.json',
      warnings: [],
      validation: {
        publicRowCount: 235,
        dealerMailRowCount: 232,
        heldVinCount: 29,
        backupCount: 5,
        publicStoreCounts: { Howell: 80, Fowlerville: 48, 'Ford Detroit': 64, Lincoln: 43 },
        crmStoreCounts: { Howell: 77, Fowlerville: 49, 'Ford Detroit': 64, Lincoln: 42 },
      },
    })

    expect(summary).toContain('Public 235 | CRM 232 | Held 29 | Backups 5')
    expect(summary).toContain('Release bundle: work/releases/2026-09-17/inventory-flow-release.json')
    expect(summary).not.toMatch(/workbook|xlsx|customer/i)
  })
})
