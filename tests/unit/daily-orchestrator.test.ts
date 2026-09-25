// @ts-nocheck -- the daily orchestrator is plain ESM.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('parses the intraday hold-refresh mode without enabling unrelated source flags', async () => {
    const internals = await loadInternals()

    expect(internals.parseArgs(['--date', '2026-09-25', '--refresh-holds'])).toMatchObject({
      date: '2026-09-25',
      refreshHolds: true,
      skipAuthenticated: false,
      forcePublish: false,
    })
  })

  it('archives the prior DealerMail revision before an intraday refresh', async () => {
    const internals = await loadInternals()
    const reportDate = '2026-09-25'
    const snapshotDirectory = path.join(workspaceRoot, 'work', 'dealermail-history', 'snapshots')
    mkdirSync(snapshotDirectory, { recursive: true })
    writeFileSync(path.join(snapshotDirectory, `${reportDate}-hold-details-raw.json`), JSON.stringify({ holds: [1] }))
    writeFileSync(path.join(snapshotDirectory, `${reportDate}-complete-used-inventory-deep-cloud-ready.json`), JSON.stringify({ complete: true }))

    const archiveDirectory = internals.archiveDealerMailRevision(reportDate, new Date('2026-09-25T14:25:00.000Z'))

    expect(archiveDirectory).toContain(path.join('intraday', reportDate, '2026-09-25T14-25-00-000Z'))
    expect(existsSync(path.join(archiveDirectory, `${reportDate}-hold-details-raw.json`))).toBe(true)
    const manifest = JSON.parse(readFileSync(path.join(archiveDirectory, 'archive-manifest.json'), 'utf8'))
    expect(manifest.files).toHaveLength(2)
    expect(manifest.files.every((file) => /^[A-F0-9]{64}$/.test(file.sha256))).toBe(true)
  })

  it('keeps hold-only publishing on the lightweight protected path', () => {
    const orchestrator = readFileSync(new URL('../../scripts/run-inventory-flow-daily.mjs', import.meta.url), 'utf8')
    const publisher = readFileSync(new URL('../../scripts/daily-cloud-publish.ps1', import.meta.url), 'utf8')

    expect(orchestrator).toContain("if (holdRefresh) args.push('-HoldRefresh')")
    expect(orchestrator).toContain("status: current.ok ? 'reused_validated' : 'failed_blocking'")
    expect(publisher).toContain('[switch]$HoldRefresh')
    expect(publisher).toContain('reusing saved vAuto, AutoCheck, PDF, sticker, invoice, photo, and warranty data')
    expect(publisher).toContain('invoice documents: reused for hold-only refresh')
    expect(publisher).toContain("@('scripts\\dryrun_resource_enrichment_check.mjs', $date)")
  })

  it('reuses a complete existing OASIS capture when the browser is unavailable, and only then', async () => {
    const internals = await loadInternals()
    const reportDate = '2026-09-22'
    const steps = []
    expect(internals.reuseExistingOasisCapture(reportDate, steps)).toBe(false)
    expect(steps.at(-1)).toMatchObject({ name: 'oasis', status: 'skipped_browser_unavailable' })

    mkdirSync(path.join(workspaceRoot, 'work', 'oasis-history'), { recursive: true })
    const worklist = [{ vin: '1FT8W3BM8RED19309' }, { vin: '1FTFW1E50NFA00009' }]
    writeFileSync(path.join(workspaceRoot, 'work', `oasis-vin-worklist-${reportDate}.json`), JSON.stringify(worklist))
    const complete = (vin) => ({ vin, openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] })
    writeFileSync(path.join(workspaceRoot, 'work', 'oasis-history', `${reportDate}-oasis.json`), JSON.stringify({ records: [complete(worklist[0].vin)] }))
    expect(internals.reuseExistingOasisCapture(reportDate, steps)).toBe(false)
    expect(steps.at(-1)).toMatchObject({ name: 'oasis', status: 'existing_capture_incomplete' })

    writeFileSync(path.join(workspaceRoot, 'work', 'oasis-history', `${reportDate}-oasis.json`), JSON.stringify({ records: worklist.map((item) => complete(item.vin)) }))
    expect(internals.reuseExistingOasisCapture(reportDate, steps)).toBe(true)
    expect(steps.at(-1)).toMatchObject({ name: 'oasis', status: 'reused_existing_capture' })
  })

  it('writes JSON through a temporary file so readers never see a partial manifest', async () => {
    const internals = await loadInternals()
    const target = path.join(workspaceRoot, 'work', 'run-status', 'atomic.json')
    internals.writeJson(target, { complete: true })
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ complete: true })
    expect(readdirSync(path.dirname(target)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('does not bind a previous manager overlay before its current-run validation', async () => {
    const internals = await loadInternals()
    const reportDate = '2026-09-23'
    const publicPath = path.join(workspaceRoot, 'public.json')
    const dealerPath = path.join(workspaceRoot, 'dealer.json')
    writeFileSync(publicPath, JSON.stringify({ vehicles: [{ vin: '1FT8W3BM8RED19309', store: 'Howell' }] }))
    writeFileSync(dealerPath, JSON.stringify({
      completeDealerMailUsedInventory: { rows: [{ vin: '1FT8W3BM8RED19309', storeName: 'Howell' }] },
      excludeActiveHoldsValidationSet: { rows: [{ vin: '1FT8W3BM8RED19309', storeName: 'Howell' }] },
      summary: { uniqueHeldVehicles: 0 },
    }))
    const overlayDirectory = path.join(workspaceRoot, 'work', 'manager-supplied', 'sold-logs')
    mkdirSync(overlayDirectory, { recursive: true })
    writeFileSync(path.join(overlayDirectory, '2026-09-howell-operational.json'), '{stale overlay')

    const manifest = internals.deriveManifest({ reportDate, publicPath, dealerPath, warnings: [], steps: [] })

    expect(manifest.source_counts.dealermail_used_rows).toBe(1)
    expect(manifest).not.toHaveProperty('manager_disposition_overlay')
  })
})
