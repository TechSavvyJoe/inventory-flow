// @ts-nocheck -- the daily orchestrator is plain ESM.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let workspaceRoot: string
let previousWorkspaceRoot: string | undefined

beforeAll(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), 'inventory-flow-daily-'))
  mkdirSync(path.join(workspaceRoot, 'work', 'run-status'), { recursive: true })
  mkdirSync(path.join(workspaceRoot, 'outputs'), { recursive: true })
  mkdirSync(path.join(workspaceRoot, 'apps', 'inventory-ops'), { recursive: true })
  previousWorkspaceRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
  process.env.BOB_MAXEY_WORKSPACE_ROOT = workspaceRoot
})

afterAll(() => {
  if (previousWorkspaceRoot === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
  else process.env.BOB_MAXEY_WORKSPACE_ROOT = previousWorkspaceRoot
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('app-first daily orchestrator helpers', () => {
  async function loadInternals() {
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

  it('returns a failing process status for an incomplete scheduled run', async () => {
    const internals = await loadInternals()

    expect(internals.exitCodeForResult({ ok: true })).toBe(0)
    expect(internals.exitCodeForResult({ ok: false, failureCode: 'DEALERMAIL_INCOMPLETE' })).toBe(1)
  })
})
