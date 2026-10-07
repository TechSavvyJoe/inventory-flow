// @ts-nocheck -- the daily runner is plain ESM.
// @vitest-environment node
// A DealerMail snapshot rejected because holds moved under the capture gets one
// fresh recapture; a second rejection stops with a specific code and the
// finalizer's own words, and an expired session is never retried. Synthetic data only.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

let workspaceRoot
let previousRoot
let internals
let originalRuntime

beforeAll(async () => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), 'dealermail-retry-'))
  for (const dir of ['work/run-status', 'work/dealermail-history/snapshots', 'work/inventory-history/snapshots', 'outputs', 'apps/inventory-ops/data']) {
    mkdirSync(path.join(workspaceRoot, dir), { recursive: true })
  }
  previousRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
  process.env.BOB_MAXEY_WORKSPACE_ROOT = workspaceRoot
  internals = (await import('../../scripts/run-inventory-flow-daily.mjs')).internals
  originalRuntime = { ...internals.runtime }
})

afterEach(() => {
  Object.assign(internals.runtime, originalRuntime)
})

afterAll(() => {
  if (previousRoot === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
  else process.env.BOB_MAXEY_WORKSPACE_ROOT = previousRoot
  rmSync(workspaceRoot, { recursive: true, force: true })
})

const SYNTHETIC_VIN = 'TESTDATARETRY0001'
const HOLD_MISMATCH = `Error: hold-state mismatch for VIN ${SYNTHETIC_VIN}: rowClass says active_hold, live hold-detail capture says no_current_hold_found`

function snapshotPath(reportDate) {
  return path.join(workspaceRoot, 'work', 'dealermail-history', 'snapshots', `${reportDate}-complete-used-inventory-deep-cloud-ready.json`)
}

// Mirrors run(): a non-optional step that exits non-zero throws "<label> failed: <output>".
function fakeDealerMail(reportDate, { capture, finalizeRejects = 0, writeTarget = true, finalizeProgress = '' } = {}) {
  const calls = { capture: 0, build: 0, finalize: 0, sleeps: [] }
  internals.runtime.dealerMailRetryDelayMs = 1234
  internals.runtime.sleep = async (ms) => { calls.sleeps.push(ms) }
  internals.runtime.ensureAutomationBrowser = async () => true
  internals.runtime.run = (_command, args) => {
    const script = args[0]
    if (script.includes('capture-dealermail')) {
      calls.capture += 1
      return capture ? capture(calls.capture) : { ok: true, output: '{"sessionStatus":"ok"}', status: 0 }
    }
    if (script.includes('build_v2_snapshot')) {
      calls.build += 1
      return { ok: true, output: 'VALIDATION PASSED', status: 0 }
    }
    if (script.includes('finalize_cloud_snapshot')) {
      calls.finalize += 1
      if (calls.finalize <= finalizeRejects) throw new Error(`DealerMail cloud snapshot finalizer failed: ${finalizeProgress}${HOLD_MISMATCH}`)
      if (writeTarget) writeFileSync(snapshotPath(reportDate), `{"dealermail":"attempt ${calls.finalize}"}\n`)
      return { ok: true, output: 'finalized', status: 0 }
    }
    throw new Error(`unexpected synthetic command ${script}`)
  }
  return calls
}

describe('DealerMail snapshot retry', () => {
  it('recaptures once after a rejected snapshot and records both attempts', async () => {
    const reportDate = '2026-09-01'
    const calls = fakeDealerMail(reportDate, { finalizeRejects: 1 })
    const warnings = []
    const steps = []

    const target = await internals.runDealerMail(reportDate, true, warnings, steps)

    expect(target).toBe(snapshotPath(reportDate))
    expect(calls).toMatchObject({ capture: 2, build: 2, finalize: 2, sleeps: [1234] })
    expect(steps).toEqual([
      expect.objectContaining({ name: 'dealermail_attempt', status: 'snapshot_rejected', attempt: 1, detail: expect.stringContaining('hold-state mismatch') }),
      expect.objectContaining({ name: 'dealermail', status: 'captured', attempt: 2, path: target }),
    ])
    expect(warnings).toEqual([])
  })

  it('stops with DEALERMAIL_SNAPSHOT_REJECTED and keeps each rejection in the steps after a second rejection', async () => {
    const reportDate = '2026-09-02'
    const calls = fakeDealerMail(reportDate, { finalizeRejects: 2 })
    const warnings = []
    const steps = []

    const failure = await internals.runDealerMail(reportDate, true, warnings, steps).catch((error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toBe('DEALERMAIL_SNAPSHOT_REJECTED')
    expect(failure.cause.message).toContain('hold-state mismatch')
    expect(calls).toMatchObject({ capture: 2, finalize: 2, sleeps: [1234] })
    expect(steps.filter((step) => step.name === 'dealermail_attempt').map((step) => step.attempt)).toEqual([1, 2])
    expect(steps.at(-1)).toMatchObject({ name: 'dealermail', status: 'snapshot_rejected', attempts: 2, detail: expect.stringContaining(SYNTHETIC_VIN) })
    expect(warnings.join(' ')).toMatch(/rejected by validation/)
    expect(existsSync(snapshotPath(reportDate))).toBe(false)
  })

  it('treats a finalizer that leaves no snapshot as a rejection and retries it', async () => {
    const reportDate = '2026-09-03'
    let finalizeCount = 0
    const calls = fakeDealerMail(reportDate, { writeTarget: false })
    const baseRun = internals.runtime.run
    internals.runtime.run = (command, args, options) => {
      const result = baseRun(command, args, options)
      if (args[0].includes('finalize_cloud_snapshot') && ++finalizeCount === 2) writeFileSync(snapshotPath(reportDate), '{}\n')
      return result
    }
    const steps = []

    await expect(internals.runDealerMail(reportDate, true, [], steps)).resolves.toBe(snapshotPath(reportDate))
    expect(calls.capture).toBe(2)
    expect(steps[0]).toMatchObject({ name: 'dealermail_attempt', attempt: 1, detail: expect.stringContaining('was not created') })
  })

  it('never retries an expired DealerMail session', async () => {
    const reportDate = '2026-09-04'
    const calls = fakeDealerMail(reportDate, { capture: () => ({ ok: true, output: '{"sessionStatus":"session_expired"}', status: 0 }) })
    const warnings = []
    const steps = []

    await expect(internals.runDealerMail(reportDate, true, warnings, steps)).resolves.toBeNull()
    expect(calls).toMatchObject({ capture: 1, build: 0, finalize: 0, sleeps: [] })
    expect(steps).toEqual([expect.objectContaining({ name: 'dealermail', status: 'session_expired_or_failed', attempt: 1 })])
    expect(warnings.join(' ')).toMatch(/sign in to DealerMail/)
  })

  it('stops without a third capture when the session expires on the recapture', async () => {
    const reportDate = '2026-09-05'
    const calls = fakeDealerMail(reportDate, {
      finalizeRejects: 1,
      capture: (count) => count === 1
        ? { ok: true, output: '{"sessionStatus":"ok"}', status: 0 }
        : { ok: false, output: 'SESSION_EXPIRED Session Ended', status: 1 },
    })
    const steps = []

    await expect(internals.runDealerMail(reportDate, true, [], steps)).resolves.toBeNull()
    expect(calls).toMatchObject({ capture: 2, finalize: 1 })
    expect(steps.at(-1)).toMatchObject({ name: 'dealermail', status: 'session_expired_or_failed', attempt: 2 })
  })

  it('archives the prior revision once in refresh mode, not again on the recapture', async () => {
    const reportDate = '2026-09-06'
    writeFileSync(snapshotPath(reportDate), '{"dealermail":"morning"}\n')
    fakeDealerMail(reportDate, { finalizeRejects: 1 })
    const steps = []

    await internals.runDealerMail(reportDate, true, [], steps, { refresh: true })

    expect(steps.filter((step) => step.name === 'dealermail_archive')).toEqual([expect.objectContaining({ status: 'complete' })])
    expect(readdirSync(path.join(workspaceRoot, 'work', 'dealermail-history', 'intraday', reportDate))).toHaveLength(1)
  })
})

describe('failure detail', () => {
  it('keeps the real message bounded and masks credential-shaped values', () => {
    const detail = internals.failureDetailFor(new Error(`fetch failed token=abc123 Authorization: Bearer xyz.789 Cookie: sid=secret-value\n${'x'.repeat(900)}`))
    expect(detail).toContain('fetch failed')
    expect(detail).not.toMatch(/abc123|xyz\.789|secret-value/)
    expect(detail.length).toBeLessThanOrEqual(500)
    expect(internals.failureDetailFor(new Error('CLOUDFLARE_PUBLISH_FAILED'), 'CLOUDFLARE_PUBLISH_FAILED')).toBeNull()
  })

  it.each([
    ['Basic', 'dXNlcm5hbWU6c2VjcmV0LWJhc2ljLXRva2Vu=='],
    ['Bearer', 'opaque.secret-token-value'],
  ])('redacts the complete Authorization %s value before truncating error and status details', (scheme, credential) => {
    const header = `Authorization: ${scheme} ${credential}`
    const longFailure = `${'x'.repeat(800)}\n${header}`
    const detail = internals.failureDetailFor(new Error(longFailure))

    expect(detail).toContain('Authorization: [redacted]')
    expect(detail).not.toContain(credential)
    expect(detail.length).toBeLessThanOrEqual(500)
    expect(internals.safeDetail(longFailure)).not.toContain(credential)
  })

  it('keeps the finalizer error that follows long progress output', async () => {
    const reportDate = '2026-09-07'
    fakeDealerMail(reportDate, { finalizeRejects: 2, finalizeProgress: `${'progress '.repeat(120)}\n` })
    const steps = []

    const failure = await internals.runDealerMail(reportDate, true, [], steps).catch((error) => error)
    const detail = internals.failureDetailFor(failure, 'DEALERMAIL_SNAPSHOT_REJECTED')

    expect(detail.length).toBeLessThanOrEqual(500)
    expect(detail).toContain('DealerMail cloud snapshot finalizer failed')
    expect(detail).toContain(`hold-state mismatch for VIN ${SYNTHETIC_VIN}`)
    for (const step of steps.filter((entry) => entry.detail)) expect(step.detail).toContain('hold-state mismatch')
  })
})

function hash(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

function receiptBoundDay(reportDate) {
  const publicPath = path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots', `${reportDate}-public.json`)
  const dealerPath = snapshotPath(reportDate)
  const resourcePath = path.join(workspaceRoot, 'apps', 'inventory-ops', 'data', 'vin-document-enrichment.json')
  const manifestPath = path.join(workspaceRoot, 'work', 'run-status', `${reportDate}.json`)
  const receiptPath = path.join(workspaceRoot, 'work', 'app-feed-status', `${reportDate}.json`)
  const intradayStatusPath = path.join(workspaceRoot, 'work', 'hold-refresh-status', `${reportDate}.json`)
  const releasePath = path.join(workspaceRoot, 'work', 'releases', reportDate, 'inventory-flow-release.json')
  mkdirSync(path.dirname(receiptPath), { recursive: true })
  writeFileSync(publicPath, '{"public":"morning"}\n')
  writeFileSync(dealerPath, '{"dealermail":"morning"}\n')
  writeFileSync(resourcePath, '{"resources":"morning"}\n')
  writeFileSync(manifestPath, JSON.stringify({
    report_date: reportDate,
    complete: true,
    public_snapshot_path: publicPath,
    public_snapshot_sha256: hash(readFileSync(publicPath)),
    dealermail_snapshot_path: dealerPath,
    dealermail_snapshot_sha256: hash(readFileSync(dealerPath)),
  }))
  writeFileSync(receiptPath, JSON.stringify({
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
  }))
  return {
    dealerPath,
    intradayStatusPath,
    args: {
      options: { skipAuthenticated: false, noPublish: false },
      reportDate,
      manifestPath,
      releasePath,
      receiptPath,
      intradayStatusPath,
      warnings: [],
      steps: [],
    },
  }
}

describe('hold-refresh failure status', () => {
  it('records DEALERMAIL_SNAPSHOT_REJECTED with the finalizer message and restores the verified snapshot', async () => {
    const day = receiptBoundDay('2026-09-10')
    fakeDealerMail('2026-09-10', { finalizeRejects: 2 })

    const result = await internals.runIntradayHoldRefresh(day.args)

    expect(result).toMatchObject({ ok: false, failureCode: 'DEALERMAIL_SNAPSHOT_REJECTED', failureDetail: expect.stringContaining('hold-state mismatch') })
    const status = JSON.parse(readFileSync(day.intradayStatusPath, 'utf8'))
    expect(status).toMatchObject({
      status: 'intraday_refresh_failed_last_verified_release_preserved',
      failureCode: 'DEALERMAIL_SNAPSHOT_REJECTED',
      failureDetail: expect.stringContaining(`hold-state mismatch for VIN ${SYNTHETIC_VIN}`),
    })
    expect(status).not.toHaveProperty('published')
    expect(status.steps.filter((step) => step.name === 'dealermail_attempt')).toHaveLength(2)
    expect(readFileSync(day.dealerPath, 'utf8')).toBe('{"dealermail":"morning"}\n')
  })

  it('carries the real message behind the INTRADAY_REFRESH_VALIDATION_FAILED catch-all', async () => {
    const day = receiptBoundDay('2026-09-11')
    fakeDealerMail('2026-09-11', {
      capture: () => { throw new TypeError('synthetic unexpected fault api_key=abc123') },
    })

    const result = await internals.runIntradayHoldRefresh(day.args)

    expect(result.failureCode).toBe('INTRADAY_REFRESH_VALIDATION_FAILED')
    const status = JSON.parse(readFileSync(day.intradayStatusPath, 'utf8'))
    expect(status.failureCode).toBe('INTRADAY_REFRESH_VALIDATION_FAILED')
    expect(status.failureDetail).toContain('synthetic unexpected fault')
    expect(status.failureDetail).not.toContain('abc123')
  })
})

describe('morning run', () => {
  it('returns DEALERMAIL_SNAPSHOT_REJECTED with detail instead of an uncaught builder error', async () => {
    const reportDate = '2026-09-12'
    writeFileSync(path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots', `${reportDate}-public.json`), '{"vehicles":[]}\n')
    fakeDealerMail(reportDate, { finalizeRejects: 2 })

    const result = await internals.runDaily(internals.parseArgs(['--date', reportDate]))

    expect(result).toMatchObject({ ok: false, failureCode: 'DEALERMAIL_SNAPSHOT_REJECTED', failureDetail: expect.stringContaining('hold-state mismatch') })
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
    expect(manifest).toMatchObject({ complete: false, dealermail_status: 'snapshot_rejected', failure_code: 'DEALERMAIL_SNAPSHOT_REJECTED' })
    expect(existsSync(result.releasePath)).toBe(false)
  })
})
