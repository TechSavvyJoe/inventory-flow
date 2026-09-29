// @ts-nocheck -- the daily orchestrator is plain ESM.
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { loadLatestCompletedRelease } from '../../server/importer.mjs'
import { cloudBundleSha256, cloudReleaseFrom } from '../../scripts/publish-cloud-release.mjs'
import { publicationFailureMessage, publicationReconciliationPath, syncCloudRelease, writePublicationReconciliation } from '../../scripts/sync-cloud-release.mjs'

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

  it('blocks a forced next-day ordinary run before source capture when durable reconciliation is pending or malformed', async () => {
    const internals = await loadInternals()
    const markerPath = publicationReconciliationPath(workspaceRoot)
    const nextReportDate = '2026-10-03'
    const nextPublicPath = path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots', `${nextReportDate}-public.json`)
    const sourceHashes = {
      public: '1'.repeat(64), dealerMail: '2'.repeat(64), resources: '3'.repeat(64),
      managerDisposition: null, managerDispositionBinding: null,
    }
    try {
      writePublicationReconciliation(workspaceRoot, {
        reportDate: '2026-10-02',
        bundleSha256: 'a'.repeat(64),
        failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
        sourceHashes,
        now: new Date('2026-10-02T15:00:00.000Z'),
      })

      await expect(internals.runDaily(internals.parseArgs(['--date', nextReportDate, '--force-publish'])))
        .resolves.toMatchObject({
          ok: false,
          failureCode: 'PUBLICATION_RECONCILIATION_REQUIRED',
          reconciliationRequired: true,
          candidate: { bundleSha256: 'a'.repeat(64), dealerMailSha256: '2'.repeat(64) },
        })
      expect(existsSync(nextPublicPath)).toBe(false)

      writeFileSync(markerPath, '{truncated reconciliation marker')
      await expect(internals.runDaily(internals.parseArgs(['--date', nextReportDate, '--force-publish'])))
        .resolves.toMatchObject({
          ok: false,
          failureCode: 'PUBLICATION_RECONCILIATION_STATE_INVALID',
          reconciliationRequired: true,
        })
      expect(existsSync(nextPublicPath)).toBe(false)
    } finally {
      rmSync(markerPath, { force: true })
    }
  })

  it('binds a post-publisher reconciliation guard to the exact intraday candidate before deciding rollback', async () => {
    const internals = await loadInternals()
    const markerPath = publicationReconciliationPath(workspaceRoot)
    const sourceHashes = {
      public: '1'.repeat(64), dealerMail: '2'.repeat(64), resources: '3'.repeat(64),
      managerDisposition: null, managerDispositionBinding: null,
    }
    try {
      writePublicationReconciliation(workspaceRoot, {
        reportDate: '2026-09-25',
        bundleSha256: 'a'.repeat(64),
        failureCode: 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS',
        sourceHashes,
        holdRefresh: true,
        now: new Date('2026-09-25T15:00:00.000Z'),
      })
      expect(internals.publicationAttemptForCandidate({
        reportDate: '2026-09-25',
        bundleSha256: 'A'.repeat(64),
        sourceHashes,
        holdRefresh: true,
      })).toMatchObject({ present: true, consistent: true })
      expect(internals.publicationAttemptForCandidate({
        reportDate: '2026-09-25',
        bundleSha256: 'A'.repeat(64),
        sourceHashes: { ...sourceHashes, dealerMail: 'f'.repeat(64) },
        holdRefresh: true,
      })).toMatchObject({ present: true, consistent: false })
    } finally {
      rmSync(markerPath, { force: true })
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

  describe('ordinary morning publication failures', () => {
    const built = {
      bundleSha256: 'B'.repeat(64),
      sourceHashes: { public: '1'.repeat(64), dealerMail: '2'.repeat(64), resources: '3'.repeat(64), managerDisposition: null, managerDispositionBinding: null },
    }
    const verified = (bundleSha256, overrides = {}) => ({
      reportDate: '2026-09-25', complete: true, status: 'published_and_verified', bundleSha256,
      verifiedAt: '2026-09-25T13:20:00.000Z', sourceHashes: { ...built.sourceHashes, resources: '9'.repeat(64) }, ...overrides,
    })

    it('records followups pending, not reconciliation, when the publisher verified the release and only followups failed', async () => {
      const internals = await loadInternals()
      const receipt = verified('d'.repeat(64))
      const result = internals.classifyOrdinaryPublicationFailure({
        publisherOutput: 'cloud publish: {"status":"published_and_verified"}\n=== daily-cloud-publish RELEASE PUBLISHED; FOLLOWUPS FAILED: INTEGRATION_VERIFICATION_FAILED ===',
        beforeRaw: null,
        afterState: { raw: JSON.stringify(receipt), receipt, lookupFailed: false },
        durableAttempt: null,
        reportDate: '2026-09-25',
        builtSourceHashes: built.sourceHashes,
      })
      expect(result).toMatchObject({
        status: 'published_followups_pending',
        failureCode: 'CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED',
        reconciliationRequired: false,
        candidate: null,
        receipt: { bundleSha256: 'd'.repeat(64) },
      })
    })

    it('stays conservative when followups failed but no new verified receipt for these sources was written', async () => {
      const internals = await loadInternals()
      const receipt = verified('d'.repeat(64))
      const output = '=== daily-cloud-publish RELEASE PUBLISHED; FOLLOWUPS FAILED: INVOICE_DOCUMENT_PUBLISH_FAILED ==='
      for (const afterState of [
        { raw: JSON.stringify(receipt), receipt, lookupFailed: false },
        { raw: 'changed', receipt: { ...receipt, sourceHashes: { ...receipt.sourceHashes, dealerMail: 'f'.repeat(64) } }, lookupFailed: false },
      ]) {
        expect(internals.classifyOrdinaryPublicationFailure({
          publisherOutput: output,
          beforeRaw: JSON.stringify(receipt),
          afterState,
          durableAttempt: null,
          reportDate: '2026-09-25',
          builtSourceHashes: built.sourceHashes,
        })).toMatchObject({ reconciliationRequired: true, status: 'cloud_publication_outcome_unknown' })
      }
    })

    it('records the publisher marker hash, not the pre-publisher Node hash, and binds only the sources Node captured', async () => {
      const internals = await loadInternals()
      const markerPath = publicationReconciliationPath(workspaceRoot)
      const postedHash = 'e'.repeat(64)
      try {
        // The publisher rebuilt enrichment, so the posted resources hash and
        // bundle hash both differ from what Node built.
        writePublicationReconciliation(workspaceRoot, {
          reportDate: '2026-09-25',
          bundleSha256: postedHash,
          failureCode: 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS',
          sourceHashes: { ...built.sourceHashes, resources: '9'.repeat(64) },
          holdRefresh: false,
          now: new Date('2026-09-25T13:15:00.000Z'),
        })
        const output = `cloud publish FAILED: Cloud sync incomplete: CLOUD_PUBLICATION_OUTCOME_UNKNOWN. candidate_bundle_sha256=${postedHash}.`
        const durableAttempt = internals.publicationAttemptForCandidate({
          reportDate: '2026-09-25',
          bundleSha256: internals.publishedCandidateBundleSha256(output, postedHash),
          sourceHashes: built.sourceHashes,
          holdRefresh: false,
          sourceFields: ['public', 'dealerMail'],
        })
        const result = internals.classifyOrdinaryPublicationFailure({
          publisherOutput: output,
          afterState: { raw: null, receipt: null, lookupFailed: false },
          durableAttempt,
          reportDate: '2026-09-25',
          builtSourceHashes: built.sourceHashes,
        })
        expect(result).toMatchObject({
          failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
          reconciliationRequired: true,
          candidate: { bundleSha256: postedHash, dealerMailSha256: '2'.repeat(64) },
        })
        expect(result.candidate.bundleSha256).not.toBe(built.bundleSha256.toLowerCase())

        const mismatchedPrint = internals.publicationAttemptForCandidate({
          reportDate: '2026-09-25',
          bundleSha256: 'a'.repeat(64),
          sourceHashes: built.sourceHashes,
          holdRefresh: false,
          sourceFields: ['public', 'dealerMail'],
        })
        expect(internals.classifyOrdinaryPublicationFailure({
          publisherOutput: output, durableAttempt: mismatchedPrint, reportDate: '2026-09-25', builtSourceHashes: built.sourceHashes,
        })).toMatchObject({ failureCode: 'PUBLICATION_RECONCILIATION_STATE_INVALID', candidate: { bundleSha256: postedHash } })
      } finally {
        rmSync(markerPath, { force: true })
      }
    })
  })

  describe('same-day hold refresh after a successful guarded reconciliation', () => {
    const candidateHash = 'C'.repeat(64)
    function unresolvedDay(stem) {
      const statusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', `${stem}.json`)
      const manifestPath = path.join(workspaceRoot, 'work', 'run-status', `${stem}.json`)
      const receiptPath = path.join(workspaceRoot, 'work', 'app-feed-status', `${stem}.json`)
      mkdirSync(path.dirname(receiptPath), { recursive: true })
      internals0.writeJson(manifestPath, { cloudflare_publish: { status: 'publication_outcome_unknown', reconciliation_required: true, expected_bundle_sha256: candidateHash } })
      internals0.writeIntradayStatus(statusPath, {
        reportDate: '2026-09-25',
        status: 'intraday_holds_publication_outcome_unknown',
        failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
        summary: 'Synthetic unresolved candidate.',
        reconciliationRequired: true,
        candidate: { bundleSha256: candidateHash, dealerMailSha256: 'B'.repeat(64) },
      })
      const writeReceiptFor = (bundleSha256) => writeFileSync(receiptPath, JSON.stringify({
        reportDate: '2026-09-25', complete: true, status: 'published_and_verified', publication: 'reconciled_exact_candidate',
        bundleSha256: bundleSha256.toLowerCase(), verifiedAt: '2026-09-25T17:00:00.000Z', sourceHashes: { dealerMail: 'B'.repeat(64) },
      }))
      return { statusPath, manifestPath, receiptPath, writeReceiptFor, args: { reportDate: '2026-09-25', intradayStatusPath: statusPath, manifestPath, receiptPath } }
    }
    let internals0
    beforeAll(async () => { internals0 = await loadInternals() })

    it('treats the day as cleared only when the date receipt proves the exact retained candidate and no marker remains', async () => {
      const day = unresolvedDay('reconciled-day')
      expect(internals0.retainedPublicationReconciliation(day.args)).toMatchObject({ consistent: true })

      day.writeReceiptFor('F'.repeat(64))
      expect(internals0.retainedPublicationReconciliation(day.args)).toMatchObject({ consistent: true, candidateBundleSha256: candidateHash.toLowerCase() })

      day.writeReceiptFor(candidateHash)
      expect(internals0.retainedPublicationReconciliation(day.args)).toBeNull()

      const markerPath = publicationReconciliationPath(workspaceRoot)
      try {
        writePublicationReconciliation(workspaceRoot, {
          reportDate: '2026-09-25', bundleSha256: candidateHash, failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
          sourceHashes: { public: '1'.repeat(64), dealerMail: 'B'.repeat(64), resources: '3'.repeat(64), managerDisposition: null, managerDispositionBinding: null },
          holdRefresh: true, now: new Date('2026-09-25T16:00:00.000Z'),
        })
        expect(internals0.retainedPublicationReconciliation(day.args)).not.toBeNull()
      } finally {
        rmSync(markerPath, { force: true })
      }
    })

    it('lets the next intraday slot proceed past the reconciliation stop once the receipt proves the candidate', async () => {
      const day = unresolvedDay('reconciled-slot')
      day.writeReceiptFor(candidateHash)
      const result = await internals0.runIntradayHoldRefresh({
        options: { skipAuthenticated: false, noPublish: false },
        reportDate: '2026-09-25',
        manifestPath: day.manifestPath,
        releasePath: path.join(workspaceRoot, 'work', 'releases', 'reconciled-slot.json'),
        receiptPath: day.receiptPath,
        intradayStatusPath: day.statusPath,
        warnings: [],
        steps: [],
      })
      // It now reaches the receipt-bound source validation instead of stopping
      // on the already-resolved candidate.
      expect(result).not.toHaveProperty('reconciliationRequired')
      expect(result.failureCode).not.toMatch(/RECONCILIATION|OUTCOME_UNKNOWN/)
    })
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

  it('preserves an unresolved candidate across the next scheduled intraday invocation without capture or publish', async () => {
    const internals = await loadInternals()
    const candidate = {
      bundleSha256: 'A'.repeat(64),
      dealerMailSha256: 'B'.repeat(64),
    }
    const statusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', 'sequential-unknown.json')
    const manifestPath = path.join(workspaceRoot, 'work', 'run-status', 'sequential-unknown.json')
    const releasePath = path.join(workspaceRoot, 'work', 'releases', 'sequential-unknown.json')
    const receiptPath = path.join(workspaceRoot, 'work', 'app-feed-status', 'unreadable-receipt')
    mkdirSync(receiptPath, { recursive: true })
    internals.writeJson(manifestPath, {
      cloudflare_publish: {
        status: 'publication_outcome_unknown',
        reconciliation_required: true,
        expected_bundle_sha256: candidate.bundleSha256,
      },
    })
    internals.writeIntradayStatus(statusPath, {
      reportDate: '2026-09-25',
      status: 'intraday_holds_publication_outcome_unknown',
      failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      summary: 'Synthetic first scheduled invocation retained this candidate.',
      reconciliationRequired: true,
      candidate,
    })
    const originalStatus = readFileSync(statusPath, 'utf8')
    const originalManifest = readFileSync(manifestPath, 'utf8')
    const steps = []
    const invocation = () => internals.runIntradayHoldRefresh({
      options: { skipAuthenticated: false, noPublish: false },
      reportDate: '2026-09-25',
      manifestPath,
      releasePath,
      receiptPath,
      intradayStatusPath: statusPath,
      warnings: [],
      steps,
    })

    await expect(invocation()).resolves.toMatchObject({
      ok: false,
      failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      reconciliationRequired: true,
      candidate,
    })
    await expect(invocation()).resolves.toMatchObject({
      ok: false,
      failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      candidate,
    })
    expect(readFileSync(statusPath, 'utf8')).toBe(originalStatus)
    expect(readFileSync(manifestPath, 'utf8')).toBe(originalManifest)
    expect(steps).toEqual([])
    expect(existsSync(releasePath)).toBe(false)
  })

  it.each(['missing', 'corrupt'])('treats a reconciliation manifest as authoritative when hold status is %s', async (statusCondition) => {
    const internals = await loadInternals()
    const candidateHash = 'C'.repeat(64)
    const stem = `manifest-only-${statusCondition}`
    const statusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', `${stem}.json`)
    const manifestPath = path.join(workspaceRoot, 'work', 'run-status', `${stem}.json`)
    const releasePath = path.join(workspaceRoot, 'work', 'releases', `${stem}.json`)
    const receiptPath = path.join(workspaceRoot, 'work', 'app-feed-status', `${stem}-unreadable-receipt`)
    mkdirSync(receiptPath, { recursive: true })
    internals.writeJson(manifestPath, {
      cloudflare_publish: {
        status: 'publication_outcome_unknown',
        reconciliation_required: true,
        expected_bundle_sha256: candidateHash,
      },
    })
    if (statusCondition === 'corrupt') {
      mkdirSync(path.dirname(statusPath), { recursive: true })
      writeFileSync(statusPath, '{truncated reconciliation status')
    }
    const originalManifest = readFileSync(manifestPath, 'utf8')
    const originalStatus = existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : null
    const steps = []

    await expect(internals.runIntradayHoldRefresh({
      options: { skipAuthenticated: false, noPublish: false },
      reportDate: '2026-09-25',
      manifestPath,
      releasePath,
      receiptPath,
      intradayStatusPath: statusPath,
      warnings: [],
      steps,
    })).resolves.toMatchObject({
      ok: false,
      failureCode: 'PUBLICATION_RECONCILIATION_STATE_INVALID',
      reconciliationRequired: true,
      candidate: { bundleSha256: candidateHash.toLowerCase() },
    })
    expect(readFileSync(manifestPath, 'utf8')).toBe(originalManifest)
    if (originalStatus === null) expect(existsSync(statusPath)).toBe(false)
    else expect(readFileSync(statusPath, 'utf8')).toBe(originalStatus)
    expect(steps).toEqual([])
    expect(existsSync(releasePath)).toBe(false)
  })

  it('records the exact final-manifest POST hash for a lost publication response', async () => {
    const fixture = createSyntheticWorkspace()
    try {
      const internals = await loadInternals()
      const manifestPath = path.join(fixture.workspaceRoot, 'work', 'run-status', `${fixture.reportDate}.json`)
      const releasePath = path.join(fixture.workspaceRoot, 'work', 'releases', fixture.reportDate, 'inventory-flow-release.json')
      const now = new Date(`${fixture.reportDate}T15:00:00Z`)
      const fixtureManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const dealerMailPath = path.resolve(fixture.workspaceRoot, fixtureManifest.dealermail_snapshot_path)
      const dealerMail = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const included = dealerMail.completeDealerMailUsedInventory.rows
      const heldVins = new Set(dealerMail.vehicles.map((vehicle) => vehicle.mainRow.vin))
      const counts = (rows) => Object.fromEntries(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
        .map((store) => [store, rows.filter((row) => row.storeName === store).length]))
      for (const row of included) {
        row.rawCellInnerText = Array(22).fill('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS')
        row.rawCellControlValues = Array.from({ length: 22 }, () => [])
        row.holdStateFromRowClass = heldVins.has(row.vin) ? 'active_hold' : 'no_current_hold_found'
      }
      const excluded = included.filter((row) => !heldVins.has(row.vin))
      dealerMail.excludeActiveHoldsValidationSet = {
        readOnly: true,
        rows: excluded,
        summary: { totalRows: excluded.length, uniqueVinCount: excluded.length, uniqueStockCount: excluded.length, byStore: counts(excluded) },
      }
      dealerMail.completeInventorySetValidation.activeHoldDifferenceRows = included
        .filter((row) => heldVins.has(row.vin))
        .map(({ vin, stockNumber, storeName, storeCode }) => ({ vin, stockNumber, storeName, storeCode }))
      dealerMail.crmInventoryControlValidation = {
        completeInventoryRowsIncludingHolds: included.length,
        inventoryRowsExcludingHolds: excluded.length,
        activeHoldVINsRemovedByExcludeFilter: heldVins.size,
        excludeFilterRemovedExactlyTheActiveHoldSet: true,
        includingHoldsByStore: counts(included),
        excludingHoldsByStore: counts(excluded),
        lotReadyOnlyRowsIncludingHolds: included.length,
        lotReadyOnlyVINSetEqualsAllVehiclesVINSet: true,
      }
      for (const held of dealerMail.vehicles) {
        for (const detail of held.holdDetailRows) detail.orderRaw = String(detail.holdOrderNumber)
      }
      dealerMail.vehicles[0].holdDetailRows.push({
        lifecycleStatus: 'deleted_history',
        holdPosition: 'deleted',
        orderRaw: 'DELETED',
        customerOrReasonRaw: 'Synthetic deleted history',
      })
      dealerMail.summary.totalHoldDetailRows += 1
      dealerMail.summary.deletedHistoricalHoldRows += 1
      writeFileSync(dealerMailPath, JSON.stringify(dealerMail, null, 2) + '\n')
      const built = internals.buildAndWriteReleaseBundle(fixture.reportDate, releasePath, manifestPath, {
        workspaceRoot: fixture.workspaceRoot,
        now,
      })
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now })
      const environment = {
        INVENTORY_OPS_CLOUD_URL: 'https://inventory-ops.joegallant.me',
        INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
        CF_ACCESS_CLIENT_ID: 'synthetic',
        CF_ACCESS_CLIENT_SECRET: 'synthetic',
        INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN: 'synthetic',
      }
      let postedHash
      let failure
      try {
        await syncCloudRelease({
          release,
          environment,
          now,
          fetchImpl: async (_url, options) => {
            postedHash = JSON.parse(options.body).bundleSha256
            throw new TypeError('synthetic response lost after POST')
          },
        })
      } catch (error) {
        failure = error
      }
      const classification = internals.classifyFailedPublication({
        publisherOutput: publicationFailureMessage(failure),
        fallbackBundleSha256: built.bundleSha256,
        dealerMailSha256: built.sourceHashes.dealerMail,
      })

      expect(built.bundleSha256).toBe(postedHash)
      expect(cloudBundleSha256(JSON.parse(readFileSync(releasePath, 'utf8')))).toBe(postedHash)
      expect(classification).toMatchObject({
        status: 'cloud_publication_outcome_unknown',
        failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
        reconciliationRequired: true,
        candidate: { bundleSha256: postedHash },
      })
      expect(classification.status).not.toMatch(/preserved|not_published/)

      const reconciledManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      reconciledManifest.daily_steps = [{ name: 'cloudflare_publish', status: 'publication_outcome_unknown' }]
      reconciledManifest.cloudflare_publish = {
        attempted: true,
        status: 'publication_outcome_unknown',
        reconciliation_required: true,
        expected_bundle_sha256: postedHash,
      }
      writeFileSync(manifestPath, JSON.stringify(reconciledManifest, null, 2) + '\n')
      internals.writeIntradayStatus(path.join(fixture.workspaceRoot, 'work', 'hold-refresh-status', `${fixture.reportDate}.json`), {
        reportDate: fixture.reportDate,
        status: 'intraday_holds_publication_outcome_unknown',
        failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
        summary: 'Synthetic exact-hash reconciliation state.',
        reconciliationRequired: true,
        candidate: { bundleSha256: postedHash, dealerMailSha256: built.sourceHashes.dealerMail },
      })
      const retainedRelease = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now })
      expect(cloudBundleSha256(cloudReleaseFrom(retainedRelease))).toBe(postedHash)
    } finally {
      fixture.cleanup()
    }
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

  it('reuses an existing OASIS capture when the browser is unavailable and reports gaps instead of blocking', async () => {
    const internals = await loadInternals()
    const reportDate = '2026-09-22'
    const steps = []
    expect(internals.reuseExistingOasisCapture(reportDate, steps)).toMatchObject({ validated: false, systemic: true })
    expect(steps.at(-1)).toMatchObject({ name: 'oasis', status: 'skipped_browser_unavailable' })

    mkdirSync(path.join(workspaceRoot, 'work', 'oasis-history'), { recursive: true })
    const worklist = [{ vin: '1FT8W3BM8RED19309' }, { vin: '1FTFW1E50NFA00009' }]
    writeFileSync(path.join(workspaceRoot, 'work', `oasis-vin-worklist-${reportDate}.json`), JSON.stringify(worklist))
    const complete = (vin) => ({ vin, openActionsCaptured: true, openFieldServiceActionCount: 0, openFieldServiceActions: [] })
    writeFileSync(path.join(workspaceRoot, 'work', 'oasis-history', `${reportDate}-oasis.json`), JSON.stringify({ records: [complete(worklist[0].vin)] }))
    expect(internals.reuseExistingOasisCapture(reportDate, steps)).toMatchObject({ validated: false, systemic: false, missingVehicles: 1, incompleteVehicles: 0 })
    expect(steps.at(-1)).toMatchObject({ name: 'oasis', status: 'reused_existing_capture_with_gaps' })

    writeFileSync(path.join(workspaceRoot, 'work', 'oasis-history', `${reportDate}-oasis.json`), JSON.stringify({ records: worklist.map((item) => complete(item.vin)) }))
    expect(internals.reuseExistingOasisCapture(reportDate, steps)).toMatchObject({ validated: true, systemic: false })
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

  // PRODUCT-RULE TEST
  // Regression for 2026-09-29: a run of scripts/capture-invoices.mjs that ends with only
  // per-vehicle failures left over (some VINs never resolve, even after the retry pass)
  // exits 0 and prints sessionStatus "incomplete" - see
  // scripts/lib/invoice-capture-outcome.mjs computeExitCode/computeSessionStatus. Before
  // this fix, run-inventory-flow-daily.mjs's expired-source regex only matched
  // session_expired/FETCH_ERROR, so that run was reported as a plain 'complete' step with
  // no warning even though invoices were missing. The regex must widen to also catch
  // "sessionStatus":"incomplete", and must still ignore a clean run.
  describe('invoices_capture expired-source detection (2026-09-29 regression)', () => {
    it('matches a run that finished with only per-vehicle failures left over (exit 0, sessionStatus incomplete)', async () => {
      const internals = await loadInternals()
      const output = JSON.stringify({
        sessionStatus: 'incomplete', fordLincolnVins: 41, attempted: 41, processed: 39,
        failed: 2, retried: 2, recovered: 0, tally: { pdf: 39, unavailable: 0, failed: 2 },
        failureReasons: { FETCH_ERROR: 1, UNEXPECTED_RESPONSE: 1 }, stoppedReason: null,
      })
      expect(internals.INVOICE_CAPTURE_EXPIRED_PATTERN.test(output)).toBe(true)
    })

    it('still matches a systemic stop (session_expired or FETCH_ERROR in stoppedReason)', async () => {
      const internals = await loadInternals()
      expect(internals.INVOICE_CAPTURE_EXPIRED_PATTERN.test(JSON.stringify({ sessionStatus: 'session_expired', stoppedReason: 'SESSION_EXPIRED' }))).toBe(true)
      expect(internals.INVOICE_CAPTURE_EXPIRED_PATTERN.test(JSON.stringify({ sessionStatus: 'incomplete', stoppedReason: 'CONSECUTIVE_FAILURES:FETCH_ERROR' }))).toBe(true)
    })

    it('does not match a clean run that resolved every VIN', async () => {
      const internals = await loadInternals()
      const output = JSON.stringify({
        sessionStatus: 'ok', fordLincolnVins: 41, attempted: 41, processed: 41,
        failed: 0, retried: 0, recovered: 0, tally: { pdf: 41, unavailable: 0, failed: 0 },
        failureReasons: {}, stoppedReason: null,
      })
      expect(internals.INVOICE_CAPTURE_EXPIRED_PATTERN.test(output)).toBe(false)
    })
  })
})
