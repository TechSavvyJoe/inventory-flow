// @ts-nocheck -- the daily orchestrator is plain ESM.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

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

  it('defers the entire hold refresh behind an active shared pipeline writer', async () => {
    const internals = await loadInternals()
    const reportDate = '2026-09-25'
    const lockPath = path.join(workspaceRoot, 'work', 'app-feed-status', '.publication.lock')
    const statusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', `${reportDate}.json`)
    mkdirSync(path.dirname(lockPath), { recursive: true })
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ownerId: 'active-synthetic-writer' }))
    try {
      const result = await internals.runDaily(internals.parseArgs(['--date', reportDate, '--refresh-holds']))
      expect(result.ok).toBe(true)
      expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toMatchObject({
        reportDate,
        status: 'waiting_for_pipeline_writer',
      })
    } finally {
      rmSync(lockPath, { force: true })
    }
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
    expect(orchestrator).toContain("status: resources.ok ? 'reused_receipt_bound' : 'failed_blocking'")
    expect(publisher).toContain('[switch]$HoldRefresh')
    expect(publisher).toContain('reusing saved vAuto, AutoCheck, PDF, sticker, invoice, photo, and warranty data')
    expect(publisher).toContain('invoice documents: reused for hold-only refresh')
    expect(publisher).toContain("@('scripts\\dryrun_resource_enrichment_check.mjs', $date)")
    expect(publisher).toContain('HOLD_REFRESH_SOURCE_BINDINGS_REQUIRED')
    expect(orchestrator).toContain('INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON')
  })

  function hash(value: string | Buffer) {
    return createHash('sha256').update(value).digest('hex').toUpperCase()
  }

  async function receiptBoundFixture(reportDate: string) {
    const internals = await loadInternals()
    const publicPath = path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots', `${reportDate}-public.json`)
    const dealerPath = path.join(workspaceRoot, 'work', 'dealermail-history', 'snapshots', `${reportDate}-complete-used-inventory-deep-cloud-ready.json`)
    const resourcePath = path.join(workspaceRoot, 'apps', 'inventory-ops', 'data', 'vin-document-enrichment.json')
    const manifestPath = path.join(workspaceRoot, 'work', 'run-status', `${reportDate}.json`)
    mkdirSync(path.dirname(publicPath), { recursive: true })
    mkdirSync(path.dirname(dealerPath), { recursive: true })
    mkdirSync(path.dirname(resourcePath), { recursive: true })
    writeFileSync(publicPath, '{"public":"morning"}\n')
    writeFileSync(dealerPath, '{"dealermail":"morning"}\n')
    writeFileSync(resourcePath, '{"resources":"morning"}\n')
    const manifest = {
      report_date: reportDate,
      complete: true,
      public_snapshot_path: publicPath,
      public_snapshot_sha256: hash(readFileSync(publicPath)),
      dealermail_snapshot_path: dealerPath,
      dealermail_snapshot_sha256: hash(readFileSync(dealerPath)),
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const receipt = {
      reportDate,
      complete: true,
      status: 'published_and_verified',
      bundleSha256: 'E'.repeat(64),
      verifiedAt: `${reportDate}T14:00:00Z`,
      sourceHashes: {
        public: hash(readFileSync(publicPath)),
        dealerMail: hash(readFileSync(dealerPath)),
        resources: hash(readFileSync(resourcePath)),
        managerDisposition: null,
        managerDispositionBinding: null,
      },
    }
    return { internals, reportDate, publicPath, dealerPath, resourcePath, manifestPath, manifest, receipt }
  }

  it('refuses a hold refresh when the reused public snapshot no longer matches the verified receipt', async () => {
    const fixture = await receiptBoundFixture('2026-09-26')
    writeFileSync(fixture.publicPath, '{"public":"replaced"}\n')

    expect(() => fixture.internals.verifyHoldRefreshBaseline(fixture)).toThrow('PUBLIC_SNAPSHOT_RECEIPT_MISMATCH')
  })

  it('refuses a hold refresh when resource enrichment no longer matches the verified receipt', async () => {
    const fixture = await receiptBoundFixture('2026-09-27')
    writeFileSync(fixture.resourcePath, '{"resources":"partially-rebuilt"}\n')

    expect(() => fixture.internals.verifyHoldRefreshBaseline(fixture)).toThrow('RESOURCE_ENRICHMENT_RECEIPT_MISMATCH')
  })

  it('refuses to archive or refresh a canonical DealerMail snapshot that no longer matches the receipt or manifest', async () => {
    const corrupted = await receiptBoundFixture('2026-09-29')
    writeFileSync(corrupted.dealerPath, '{"dealermail":"corrupted-before-refresh"}\n')
    expect(() => corrupted.internals.verifyHoldRefreshBaseline(corrupted))
      .toThrow('DEALERMAIL_SNAPSHOT_RECEIPT_MISMATCH')

    const rebound = await receiptBoundFixture('2026-09-30')
    rebound.manifest.dealermail_snapshot_sha256 = 'C'.repeat(64)
    writeFileSync(rebound.manifestPath, JSON.stringify(rebound.manifest))
    expect(() => rebound.internals.verifyHoldRefreshBaseline(rebound))
      .toThrow('DEALERMAIL_MANIFEST_RECEIPT_MISMATCH')

    const redirected = await receiptBoundFixture('2026-10-02')
    const alternatePath = path.join(path.dirname(redirected.dealerPath), 'alternate-copy.json')
    writeFileSync(alternatePath, readFileSync(redirected.dealerPath))
    redirected.manifest.dealermail_snapshot_path = alternatePath
    writeFileSync(redirected.manifestPath, JSON.stringify(redirected.manifest))
    expect(() => redirected.internals.verifyHoldRefreshBaseline(redirected))
      .toThrow('DEALERMAIL_MANIFEST_PATH_MISMATCH')
  })

  it('restores the verified DealerMail snapshot when an intraday candidate is rolled back', async () => {
    const fixture = await receiptBoundFixture('2026-10-01')
    const before = readFileSync(fixture.dealerPath)
    expect(fixture.internals.dealerMailRevisionPaths(fixture.reportDate)).toContain(fixture.dealerPath)
    const transaction = fixture.internals.captureFileTransaction([
      fixture.manifestPath,
      ...fixture.internals.dealerMailRevisionPaths(fixture.reportDate),
    ])
    writeFileSync(fixture.dealerPath, '{"dealermail":"partial-refresh"}\n')
    writeFileSync(fixture.manifestPath, '{"complete":false}\n')

    transaction.rollback()

    expect(readFileSync(fixture.dealerPath).equals(before)).toBe(true)
    expect(() => fixture.internals.verifyHoldRefreshBaseline(fixture)).not.toThrow()
  })

  it('reuses only the receipt-bound manager overlay and fails if its source changes', async () => {
    const fixture = await receiptBoundFixture('2026-09-28')
    const managerPath = path.join(workspaceRoot, 'work', 'manager-supplied', 'sold-logs', '2026-09-howell-operational.json')
    mkdirSync(path.dirname(managerPath), { recursive: true })
    writeFileSync(managerPath, '{"manager":"morning"}\n')
    const binding = { status: 'complete', path: managerPath, sha256: hash(readFileSync(managerPath)) }
    fixture.manifest.manager_disposition_overlay = binding
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest))
    fixture.receipt.sourceHashes.managerDisposition = 'A'.repeat(64)
    fixture.receipt.sourceHashes.managerDispositionBinding = binding.sha256

    expect(fixture.internals.verifyHoldRefreshBaseline(fixture).managerBinding).toEqual(binding)
    const candidateRelease = {
      sourceRuns: {
        public: { sha256: fixture.receipt.sourceHashes.public },
        dealerMail: { sha256: 'F'.repeat(64) },
        resources: { sha256: fixture.receipt.sourceHashes.resources },
        managerDisposition: {
          sha256: fixture.receipt.sourceHashes.managerDisposition,
          metadata: { boundSourceSha256: binding.sha256 },
        },
      },
    }
    expect(fixture.internals.assertCandidatePreservesReceiptSources(candidateRelease, fixture.receipt))
      .toMatchObject({ managerDisposition: fixture.receipt.sourceHashes.managerDisposition })
    candidateRelease.sourceRuns.managerDisposition.sha256 = 'C'.repeat(64)
    expect(() => fixture.internals.assertCandidatePreservesReceiptSources(candidateRelease, fixture.receipt))
      .toThrow('MANAGER_DISPOSITION_CHANGED_DURING_HOLD_REFRESH')

    writeFileSync(managerPath, '{"manager":"changed"}\n')
    expect(() => fixture.internals.verifyHoldRefreshBaseline(fixture)).toThrow('MANAGER_OVERLAY_SOURCE_MISMATCH')
  })

  it('restores the canonical manifest, release, and source files after a failed candidate', async () => {
    const internals = await loadInternals()
    const directory = path.join(workspaceRoot, 'transaction-test')
    const manifestPath = path.join(directory, 'manifest.json')
    const releasePath = path.join(directory, 'release.json')
    const newlyCreatedPath = path.join(directory, 'new-source.json')
    mkdirSync(directory, { recursive: true })
    writeFileSync(manifestPath, 'verified manifest')
    writeFileSync(releasePath, 'verified release')
    const transaction = internals.captureFileTransaction([manifestPath, releasePath, newlyCreatedPath])
    writeFileSync(manifestPath, 'candidate manifest')
    writeFileSync(releasePath, 'candidate release')
    writeFileSync(newlyCreatedPath, 'candidate source')

    transaction.rollback()

    expect(readFileSync(manifestPath, 'utf8')).toBe('verified manifest')
    expect(readFileSync(releasePath, 'utf8')).toBe('verified release')
    expect(existsSync(newlyCreatedPath)).toBe(false)
  })

  it('distinguishes a verified cloud publication with failed followups from a prepublication failure', async () => {
    const internals = await loadInternals()
    const sourceHashes = {
      public: 'A'.repeat(64), dealerMail: 'B'.repeat(64), resources: 'C'.repeat(64),
      managerDisposition: null, managerDispositionBinding: null,
    }
    const receipt = {
      reportDate: '2026-09-25', complete: true, status: 'published_and_verified',
      bundleSha256: 'D'.repeat(64), verifiedAt: '2026-09-25T14:25:00Z', sourceHashes,
    }

    expect(internals.classifyPublicationOutcome({
      processOk: false,
      beforeRaw: '{"old":true}',
      afterState: { raw: JSON.stringify(receipt), receipt },
      expectedHashes: sourceHashes,
      reportDate: '2026-09-25',
    })).toBe('published_followups_pending')
    expect(internals.classifyPublicationOutcome({
      processOk: false,
      beforeRaw: JSON.stringify(receipt),
      afterState: { raw: JSON.stringify(receipt), receipt },
      expectedHashes: sourceHashes,
      reportDate: '2026-09-25',
    })).toBe('not_published')

    expect(internals.classifyPublicationOutcome({
      processOk: true,
      beforeRaw: '{"old":true}',
      afterState: { raw: JSON.stringify({ ...receipt, reportDate: '2026-09-24' }), receipt: { ...receipt, reportDate: '2026-09-24' } },
      expectedHashes: sourceHashes,
      reportDate: '2026-09-25',
    })).toBe('publication_outcome_unknown')
    expect(internals.classifyPublicationOutcome({
      processOk: false,
      beforeRaw: JSON.stringify(receipt),
      afterState: { raw: JSON.stringify(receipt), receipt },
      expectedHashes: { ...sourceHashes, dealerMail: 'E'.repeat(64) },
      reportDate: '2026-09-25',
      publisherOutput: 'Cloud sync incomplete: CLOUD_PUBLICATION_OUTCOME_UNKNOWN.',
    })).toBe('publication_outcome_unknown')
    expect(internals.classifyPublicationOutcome({
      processOk: false,
      beforeRaw: JSON.stringify(receipt),
      afterState: { raw: null, receipt: null },
      expectedHashes: { ...sourceHashes, dealerMail: 'F'.repeat(64) },
      reportDate: '2026-09-25',
      publisherOutput: 'daily-cloud-publish RELEASE PUBLISHED; FOLLOWUPS FAILED: RECEIPT_LOOKUP_FAILED',
    })).toBe('publication_outcome_unknown')
  })

  it('records exact candidate evidence when publication requires reconciliation', async () => {
    const internals = await loadInternals()
    const statusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', 'unknown.json')
    internals.writeIntradayStatus(statusPath, {
      reportDate: '2026-09-25',
      status: 'intraday_holds_publication_outcome_unknown',
      failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      summary: 'Synthetic reconciliation required',
      reconciliationRequired: true,
      candidate: {
        bundleSha256: 'A'.repeat(64),
        dealerMailSha256: 'B'.repeat(64),
      },
    })

    expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toMatchObject({
      status: 'intraday_holds_publication_outcome_unknown',
      reconciliationRequired: true,
      candidate: {
        bundleSha256: 'A'.repeat(64),
        dealerMailSha256: 'B'.repeat(64),
      },
    })
  })

  it('treats an unreadable post-publish receipt as unavailable evidence', async () => {
    const internals = await loadInternals()
    const unreadableReceiptPath = path.join(workspaceRoot, 'work', 'app-feed-status', 'receipt-directory')
    mkdirSync(unreadableReceiptPath, { recursive: true })

    expect(internals.readReceiptStateAfterPublication(unreadableReceiptPath)).toEqual({
      raw: null,
      receipt: null,
      lookupFailed: true,
    })
  })

  it('links a successful hold status to its verified app-feed receipt without source data', async () => {
    const internals = await loadInternals()
    const statusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', 'linked.json')
    internals.writeIntradayStatus(statusPath, {
      reportDate: '2026-09-25',
      status: 'intraday_holds_published_and_verified',
      summary: 'synthetic success',
      published: true,
      receipt: {
        reportDate: '2026-09-25',
        complete: true,
        status: 'published_and_verified',
        bundleSha256: 'A'.repeat(64),
        verifiedAt: '2026-09-25T14:25:00Z',
        sourceHashes: { dealerMail: 'B'.repeat(64) },
      },
    })
    const status = JSON.parse(readFileSync(statusPath, 'utf8'))
    expect(status.receipt).toEqual({
      bundleSha256: 'A'.repeat(64),
      verifiedAt: '2026-09-25T14:25:00Z',
      dealerMailSha256: 'B'.repeat(64),
    })
    expect(JSON.stringify(status)).not.toMatch(/customer|comment|alert|reason/i)
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
