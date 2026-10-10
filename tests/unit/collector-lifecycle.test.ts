// @ts-nocheck -- exercises the plain ESM host and runner with synthetic evidence.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import fs, { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { createSyntheticCollector, COLLECTOR_OWNER, COLLECTOR_SYNTHETIC_NOW } from '../../fixtures/synthetic-collector.mjs'
import { saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { handleCollectorApi } from '../../cloudflare/src/platform-worker.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { publishRelease } from '../../cloudflare/src/worker.mjs'
import { cloudBundleSha256, encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { receiptSourceHashes, writeReceipt } from '../../scripts/sync-cloud-release.mjs'
import { COLLECTOR_PROFILE_NAME, installedStoreSet, profileFingerprint } from '../../scripts/lib/collector-profile.mjs'
import { findPendingPublication, privateAttemptArtifacts } from '../../scripts/lib/dealermail-hold-refresh-adapter.mjs'

const hashFile = (filePath: string) => createHash('sha256').update(readFileSync(filePath)).digest('hex')
const writeJson = (filePath: string, value: any) => { mkdirSync(path.dirname(filePath), { recursive: true }); writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n') }
let cleanup: (() => void) | null = null
let previousRoot: string | undefined
let previousInventoryRoot: string | undefined

afterEach(() => {
  cleanup?.(); cleanup = null
  if (previousRoot === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
  else process.env.BOB_MAXEY_WORKSPACE_ROOT = previousRoot
  if (previousInventoryRoot === undefined) delete process.env.INVENTORY_WORKSPACE_ROOT
  else process.env.INVENTORY_WORKSPACE_ROOT = previousInventoryRoot
  vi.useRealTimers()
})

async function lifecycleFixture() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
  const local = createSyntheticWorkspace()
  mkdirSync(path.join(local.workspaceRoot, 'outputs'), { recursive: true })
  mkdirSync(path.join(local.workspaceRoot, 'work/app-feed-status'), { recursive: true })
  const remote = await createSyntheticCollector({ enroll: false })
  cleanup = () => { local.cleanup(); remote.close() }
  previousRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
  previousInventoryRoot = process.env.INVENTORY_WORKSPACE_ROOT
  process.env.BOB_MAXEY_WORKSPACE_ROOT = local.workspaceRoot
  process.env.INVENTORY_WORKSPACE_ROOT = local.workspaceRoot
  vi.resetModules()
  const runner = await import('../../scripts/run-inventory-flow-daily.mjs')
  const { runOnce, collectorHostInternals } = await import('../../scripts/collector-host.mjs')
  const root = local.workspaceRoot, date = local.reportDate
  const manifestPath = path.join(root, 'work/run-status', `${date}.json`)
  const originalManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const publicPath = path.join(root, 'work/inventory-history/snapshots', `${date}-public.json`)
  const dealerPath = path.join(root, 'work/dealermail-history/snapshots', `${date}-complete-used-inventory-deep-cloud-ready.json`)
  const releasePath = path.join(root, 'work/releases', date, 'inventory-flow-release.json')
  const receiptPath = path.join(root, 'work/app-feed-status', `${date}.json`)
  copyFileSync(path.resolve(root, originalManifest.public_snapshot_path), publicPath)
  writeJson(dealerPath, buildSyntheticCloudBundle().release.dealerMailSnapshot)
  writeJson(manifestPath, { ...originalManifest, public_snapshot_path: publicPath, public_snapshot_sha256: hashFile(publicPath), dealermail_snapshot_path: dealerPath, dealermail_snapshot_sha256: hashFile(dealerPath) })
  const built = runner.internals.buildAndWriteReleaseBundle(date, releasePath, manifestPath, { workspaceRoot: root, now: COLLECTOR_SYNTHETIC_NOW })
  const baseline = JSON.parse(readFileSync(releasePath, 'utf8'))
  writeReceipt(path.dirname(receiptPath), { schemaVersion: 1, reportDate: date, complete: true, status: 'published_and_verified', publication: 'published', bundleSha256: cloudBundleSha256(baseline), verifiedAt: COLLECTOR_SYNTHETIC_NOW.toISOString(), counts: built.validation, sourceHashes: receiptSourceHashes(baseline.release) })
  const baselineResponse = await publishRelease(new Request('https://synthetic.invalid/internal/releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(encryptBundle(baseline, remote.key)) }), remote.tenantEnv)
  expect(baselineResponse.ok).toBe(true)
  mkdirSync(path.join(root, 'outputs'), { recursive: true })
  const files = { dealermailCapture: 'apps/inventory-ops/scripts/capture-dealermail.mjs', snapshotBuilder: 'work/build_v2_snapshot.mjs', snapshotFinalizer: 'work/finalize_cloud_snapshot.mjs' }
  const dependencyHashes: any = {}
  for (const [name, relative] of Object.entries(files)) {
    const target = path.join(root, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, "// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS\nconst ORIGIN = 'https://www.dealermail.com'\n")
    dependencyHashes[name] = hashFile(target)
  }
  const profile = {
    schemaVersion: 1, adapterId: 'dealermail-hold-refresh', adapterVersion: '1', profileId: 'synthetic-holds-four-store',
    groupId: 'synthetic-north', source: 'dealermail', workspaceRoot: root,
    controlPlaneOrigin: 'https://inventory-admin-staging.joegallant.me', credentialRef: 'CREDENTIAL_SYNTHETIC_MAIL', releaseKeyRef: 'synthetic-release', dependencyHashes,
    stores: installedStoreSet.map(store => { const dealer = remote.dealers.find(item => item.storeKey === store.storeKey); return { ...store, dealershipId: dealer.id, connectionId: dealer.connectionId } }),
  }
  profile.profileSha256 = profileFingerprint(profile)
  const profileDirectory = path.join(root, 'runtime/collector/profiles')
  writeJson(path.join(profileDirectory, `${COLLECTOR_PROFILE_NAME}.json`), profile)
  for (const dealer of remote.dealers) remote.sqlite.prepare('UPDATE platform_data_connections SET credential_ref=? WHERE id=?').run(profile.credentialRef, dealer.connectionId)
  const enrollment = await saveCollector(remote.env, COLLECTOR_OWNER, profile.groupId, {
    operation: 'enroll', name: 'Synthetic lifecycle host', accessClientId: remote.machine.common_name,
    adapterId: profile.adapterId, adapterVersion: profile.adapterVersion, profileId: profile.profileId, profileSha256: profile.profileSha256, credentialRef: profile.credentialRef,
    dealershipIds: remote.dealers.map(dealer => dealer.id), connectionIds: remote.dealers.map(dealer => dealer.connectionId),
    reason: 'Synthetic lifecycle enrollment', expectedRevision: remote.sqlite.prepare('SELECT revision FROM platform_revision').get().revision,
  }, 'lifecycle-enroll', COLLECTOR_SYNTHETIC_NOW)
  remote.collectorId = enrollment.id
  await saveCollector(remote.env, COLLECTOR_OWNER, profile.groupId, {
    operation: 'enable', id: enrollment.id, reason: 'Synthetic lifecycle activation',
    expectedRevision: remote.sqlite.prepare('SELECT revision FROM platform_revision').get().revision,
  }, 'lifecycle-enable', COLLECTOR_SYNTHETIC_NOW)
  let captures = 0, publications = 0
  const envelopes: any[] = []
  const actualFetch = async (url: URL, options: RequestInit) => {
    if (url.pathname === '/api/collector/publication') { publications += 1; envelopes.push(JSON.parse(String(options.body)).envelope) }
    return handleCollectorApi(new Request(url, options), remote.env, remote.machine, new Date())
  }
  const options = {
    profileName: COLLECTOR_PROFILE_NAME, profileDirectory,
    credentialReader: () => ({ accessClientId: 'synthetic', accessClientSecret: 'synthetic', releaseEncryptionKeyBase64: remote.key.toString('base64') }),
    fetchImpl: actualFetch,
    runnerLoader: async () => runner,
    now: () => new Date(),
    captureFactory: () => async () => {
      captures += 1
      const snapshot = JSON.parse(readFileSync(dealerPath, 'utf8'))
      snapshot.extractedAtUtc = new Date(Date.now() + captures * 1000).toISOString()
      snapshot.completeDealerMailUsedInventory.extractedAtUtc = snapshot.extractedAtUtc
      writeJson(dealerPath, snapshot)
    },
  }
  let requestNumber = 0
  const queue = async () => {
    requestNumber += 1
    const revision = remote.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
    return saveDataControl(remote.env, COLLECTOR_OWNER, profile.groupId, 'pulls', { operation: 'request', connectionId: remote.dealers[0].connectionId, reason: 'Synthetic lifecycle request', expectedRevision: revision }, `lifecycle-request-${requestNumber}`, COLLECTOR_SYNTHETIC_NOW)
  }
  return { root, remote, profile, runner, runOnce, collectorHostInternals, options, queue, actualFetch, envelopes, dealerPath, manifestPath, receiptPath, releasePath,
    captures: () => captures, publications: () => publications,
    localHash: () => JSON.parse(readFileSync(receiptPath, 'utf8')).bundleSha256,
    cloudHash: () => remote.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256,
  }
}

describe('collector exact candidate local baseline lifecycle', () => {
  it.each([
    ['initial', 'published_verified'], ['reconcile', 'published_verified'],
    ['initial', 'rejected_verified'], ['reconcile', 'rejected_verified'],
  ])('keeps %s %s settled when a private artifact cannot be deleted', async (phase, result) => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    if (result === 'rejected_verified') {
      f.remote.env.TENANT_NORTH_PUBLISHER.publish = vi.fn(async () => ({ status: 'rejected', code: 'VALIDATION_FAILED' }))
    }
    if (phase === 'reconcile') {
      expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
        const response = await f.actualFetch(url, options)
        if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic terminal publication reply lost')
        return response
      } })).status).toBe('reconciliation_required')
      expect(findPendingPublication(f.root)).not.toBe(null)
    }
    const unlink = fs.unlinkSync
    let orphanPath, orphanBytes, removalFailures = 0
    fs.unlinkSync = filePath => {
      if (path.dirname(filePath) === path.join(f.root, 'work/collector-attempts') && filePath.endsWith('.manifest.json')) {
        orphanPath = filePath
        orphanBytes = readFileSync(filePath)
        removalFailures += 1
        throw Object.assign(new Error('Synthetic artifact locked'), { code: 'EBUSY' })
      }
      return unlink(filePath)
    }
    syncBuiltinESMExports()
    let settled
    try { settled = await f.runOnce(f.options) }
    finally { fs.unlinkSync = unlink; syncBuiltinESMExports() }

    expect(removalFailures).toBe(1)
    expect(settled.status).toBe(result === 'rejected_verified' ? 'failed' : 'published_verified')
    expect(readFileSync(orphanPath)).toEqual(orphanBytes)
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.captures()).toBe(1)
    expect(f.localHash()).toBe(result === 'rejected_verified' ? baseline : settled.bundleSha256)
    expect(f.cloudHash()).toBe(f.localHash())
    expect((await f.runOnce(f.options)).status).toBe('idle')
    expect(f.captures()).toBe(1)
  })

  const abortError = signal => new Promise((_, reject) => {
    const rejectAborted = () => reject(new Error('LEASE_STOPPED'))
    if (signal.aborted) rejectAborted()
    else signal.addEventListener('abort', rejectAborted, { once: true })
  })

  const failHeartbeat = mode => {
    if (mode === 'network') throw new TypeError('Synthetic heartbeat network failure')
    if (mode === 'timeout') throw new DOMException('Synthetic heartbeat timeout', 'TimeoutError')
    if (mode === 'invalid') return new Response(JSON.stringify({ continue: true }), { status: 200 })
    return new Response(JSON.stringify({ code: 'COLLECTOR_UNAVAILABLE' }), { status: 503 })
  }

  it.each(['network', 'timeout', 'server', 'invalid'])('expires and requeues capture after an unconfirmed %s heartbeat without a permanent failure or old publication', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let captureStarted
    const started = new Promise(resolve => { captureStarted = resolve })
    const capture = f.options.captureFactory()
    const running = f.runOnce({ ...f.options,
      captureFactory: (_profile, { signal }) => async args => {
        captureStarted()
        await abortError(signal).catch(() => undefined)
        // A capture finishing as cancellation arrives can still stage files.
        // None of those old attempt files may become a pending publication.
        await capture(args)
      },
      fetchImpl: (url, options) => url.pathname === '/api/collector/heartbeat' ? failHeartbeat(mode) : f.actualFetch(url, options),
    })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await running).toMatchObject({ status: 'lease_retryable', code: 'LEASE_STOPPED' })
    const old = f.remote.sqlite.prepare('SELECT * FROM platform_collector_attempts').get()
    expect(old.stage).toBe('claimed')
    expect(f.remote.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts').get().n).toBe(0)
    expect(f.publications()).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    const artifacts = privateAttemptArtifacts(f.root, old.id)
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath']) expect(existsSync(artifacts[key])).toBe(false)
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
    expect(await f.runOnce(f.options)).toMatchObject({ status: 'idle' })
    expect(f.captures()).toBe(1)
    vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121_000))
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
    expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts WHERE id=?').get(old.id).stage).toBe('expired')
    expect(f.remote.sqlite.prepare('SELECT fence FROM platform_collector_attempts WHERE id<>?').get(old.id).fence).toBe(2)
    expect(f.captures()).toBe(2)
    expect(f.publications()).toBe(1)
  })

  it('retires only the unpublished candidate after a heartbeat transport failure while a capture receipt reply is pending', async () => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let receiptStarted
    const started = new Promise(resolve => { receiptStarted = resolve })
    const running = f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/heartbeat') return failHeartbeat('network')
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/receipts') { receiptStarted(); await abortError(options.signal) }
      return response
    } })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await running).toMatchObject({ status: 'lease_retryable' })
    expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('captured')
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.publications()).toBe(0)
    expect(f.localHash()).toBe(baseline)
    vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121_000))
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
    expect(f.captures()).toBe(2)
  })

  it.each([
    ['COLLECTOR_REVOKED', 403], ['COLLECTOR_DISABLED', 403], ['COLLECTOR_SCOPE_MISMATCH', 409], ['LEASE_STOPPED', 200],
  ])('keeps definitive %s heartbeat rejection fail closed with a bounded failure receipt', async (code, status) => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let captureStarted
    const started = new Promise(resolve => { captureStarted = resolve })
    const running = f.runOnce({ ...f.options,
      captureFactory: (_profile, { signal }) => async () => { captureStarted(); await abortError(signal) },
      fetchImpl: (url, options) => url.pathname === '/api/collector/heartbeat'
        ? new Response(JSON.stringify(status === 200 ? { continue: false } : { code }), { status }) : f.actualFetch(url, options),
    })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await running).toMatchObject({ status: 'failed', code })
    expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('failed')
    expect(f.remote.sqlite.prepare("SELECT sanitized_json FROM platform_collector_receipts WHERE kind='failure'").get().sanitized_json).toContain(status === 200 ? 'HOST_IO_FAILED' : 'VALIDATION_FAILED')
    expect(f.publications()).toBe(0)
    expect(f.captures()).toBe(0)
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
  })

  it('reclaims a definitively stale heartbeat with a fresh fence and no failure receipt for the expired capture', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let captureStarted, firstCapture = true
    const started = new Promise(resolve => { captureStarted = resolve })
    const running = f.runOnce({ ...f.options,
      captureFactory: (_profile, { signal }) => async args => {
        if (!firstCapture) return f.options.captureFactory()(args)
        firstCapture = false
        captureStarted()
        await abortError(signal)
      },
      fetchImpl: (url, options) => {
        if (url.pathname === '/api/collector/heartbeat') vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121_000))
        return f.actualFetch(url, options)
      },
    })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await running).status).toBe('published_verified')
    expect(f.remote.sqlite.prepare('SELECT stage,fence FROM platform_collector_attempts ORDER BY fence').all()).toEqual([
      { stage: 'expired', fence: 1 }, { stage: 'completed', fence: 2 },
    ])
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(0)
    expect(f.captures()).toBe(1)
    expect(f.publications()).toBe(1)
  })

  it('retains the exact candidate for readback after heartbeat transport failure during a dispatched publication', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let publicationStarted
    const started = new Promise(resolve => { publicationStarted = resolve })
    const running = f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/heartbeat') return failHeartbeat('network')
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') { publicationStarted(); await abortError(options.signal) }
      return response
    } })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await running).status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root)
    expect(pending.state).toMatchObject({ publicationPending: true, reconciliationRequired: true })
    const candidateBytes = readFileSync(pending.artifacts.candidatePath)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(0)
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
    expect(f.captures()).toBe(1)
    expect(f.envelopes[1]).toEqual(f.envelopes[0])
    expect(cloudBundleSha256(JSON.parse(candidateBytes.toString()))).toBe(f.localHash())
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it('preserves earlier durable publication uncertainty when a stale heartbeat interrupts capture receipt recovery before dispatch', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic publication reply lost')
      return response
    } })).status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root)
    // Exercise the conservative durable-state boundary directly: earlier
    // uncertainty must win even when capture acknowledgement needs recovery.
    writeJson(pending.artifacts.statePath, { ...pending.state, captureReceiptSent: false, captureReceiptPending: true })
    const candidateBytes = readFileSync(pending.artifacts.candidatePath)
    const envelopeBytes = readFileSync(pending.artifacts.envelopePath)
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let receiptStarted
    const started = new Promise(resolve => { receiptStarted = resolve })
    const recovered = f.collectorHostInternals.runClaimedAttempt(f.profile, f.options.credentialReader(), {
      ...pending.state, hardDeadline: new Date(Date.now() + 45 * 60_000).toISOString(),
    }, { ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/heartbeat') return Response.json({ code: 'COLLECTOR_LEASE_STALE' }, { status: 409 })
      if (url.pathname === '/api/collector/receipts') { receiptStarted(); return abortError(options.signal) }
      throw new Error('Must not publish or write a failure receipt')
    } })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await recovered).toMatchObject({ status: 'reconciliation_required', code: 'COLLECTOR_LEASE_STALE' })
    expect(readFileSync(pending.artifacts.candidatePath)).toEqual(candidateBytes)
    expect(readFileSync(pending.artifacts.envelopePath)).toEqual(envelopeBytes)
    expect(findPendingPublication(f.root).state.reconciliationRequired).toBe(true)
    expect(f.captures()).toBe(1)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(0)
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
    expect(f.captures()).toBe(1)
  })

  const oversizedWrapper = pending => {
    const envelope = { ...pending.envelope, ciphertext: '' }
    envelope.ciphertext = 'x'.repeat(25 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(envelope)) - 20)
    writeFileSync(pending.artifacts.envelopePath, JSON.stringify(envelope))
  }

  it.each(['http', 'platform-batch'])('settles a retained candidate from exact rejection readback after the committed %s failure reply was lost', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    const publish = vi.fn(async () => ({ status: 'rejected', code: 'VALIDATION_FAILED' }))
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    if (mode === 'platform-batch') {
      const batch = f.remote.env.PLATFORM_DB.batch
      f.remote.env.PLATFORM_DB.batch = async statements => {
        const result = await batch(statements)
        if (statements.some(s => s.sql.includes("1000001,'failure'"))) throw new TypeError('Synthetic committed rejection batch reply lost')
        return result
      }
    }
    const unknown = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (mode === 'http' && url.pathname === '/api/collector/publication') throw new TypeError('Synthetic committed rejection HTTP reply lost')
      return response
    } })
    expect(unknown.status).toBe('reconciliation_required')
    expect(findPendingPublication(f.root)).not.toBe(null)
    expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('failed')
    const settled = await f.runOnce(f.options)
    expect(settled).toMatchObject({ status: 'failed', code: 'VALIDATION_FAILED' })
    expect(findPendingPublication(f.root)).toBe(null)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(f.captures()).toBe(1)
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
  })

  it('settles a local oversized publication during dropped-capture recovery and allows a later pull', async () => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'capture') throw new TypeError('Synthetic capture receipt never dispatched')
      return f.actualFetch(url, options)
    } })).status).toBe('capture_receipt_pending')
    oversizedWrapper(findPendingPublication(f.root))
    expect(await f.runOnce(f.options)).toMatchObject({ status: 'failed', code: 'REQUEST_TOO_LARGE' })
    expect(f.publications()).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('failed')
    expect(f.localHash()).toBe(baseline)
    await f.queue()
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
  }, 30_000)

  it('retires a definitive stale publication during dropped-capture recovery and completes a fresh claim', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    let dropped = false
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/receipts' && !dropped && JSON.parse(String(options.body)).kind === 'capture') {
        dropped = true
        throw new TypeError('Synthetic capture receipt reply lost')
      }
      return response
    } })).status).toBe('capture_receipt_pending')
    let expired = false
    const recovered = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/receipts' && !expired && JSON.parse(String(options.body)).kind === 'capture') {
        expired = true
        vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121_000))
      }
      return response
    } })
    expect(recovered.status).toBe('published_verified')
    expect(f.captures()).toBe(2)
    expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts ORDER BY fence').all().map(a => a.stage)).toEqual(['expired', 'completed'])
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it.each(['before-commit', 'after-commit'])('retains an undispatched oversized recovery until its failure receipt is acknowledged (%s)', async mode => {
    const f = await lifecycleFixture()
    await f.queue()
    await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'capture') throw new TypeError('Synthetic capture receipt lost')
      return f.actualFetch(url, options)
    } })
    oversizedWrapper(findPendingPublication(f.root))
    const failed = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'failure') {
        if (mode === 'after-commit') await f.actualFetch(url, options)
        throw new TypeError('Synthetic failure receipt reply lost')
      }
      return f.actualFetch(url, options)
    } })
    expect(failed.status).toBe('failure_receipt_pending')
    expect(findPendingPublication(f.root).state).toMatchObject({ publicationPending: false, reconciliationRequired: false, captureReceiptSent: true })
    expect(await f.runOnce(f.options)).toMatchObject({ status: 'failed', code: 'REQUEST_TOO_LARGE' })
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(1)
    expect(f.publications()).toBe(0)
    await f.queue()
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
  }, 30_000)

  it.each(['local-oversize', 'stale-response'])('preserves earlier publication uncertainty through a later %s recovery error', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic committed publication reply lost')
      return response
    } })).status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root), originalEnvelope = readFileSync(pending.artifacts.envelopePath, 'utf8')
    if (mode === 'local-oversize') oversizedWrapper(pending)
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (mode === 'stale-response' && url.pathname === '/api/collector/publication') return Response.json({ code: 'COLLECTOR_LEASE_STALE' }, { status: 409 })
      return f.actualFetch(url, options)
    } })).status).toBe('reconciliation_required')
    expect(findPendingPublication(f.root).state.attemptId).toBe(pending.state.attemptId)
    expect(f.localHash()).toBe(baseline)
    writeFileSync(pending.artifacts.envelopePath, originalEnvelope)
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
    expect(f.captures()).toBe(1)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(1)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_started'").get().n).toBe(1)
  }, 30_000)

  it('runs runOnce twice through the real collector API and signed encrypted tenant, advancing both baselines', async () => {
    const f = await lifecycleFixture()
    const originalHash = f.localHash()
    expect(f.cloudHash()).toBe(originalHash)
    await f.queue()
    const first = await f.runOnce(f.options)
    expect(first.code).toBeUndefined()
    expect(first).toMatchObject({ status: 'published_verified' })
    expect(f.localHash()).toBe(first.bundleSha256)
    expect(f.cloudHash()).toBe(first.bundleSha256)
    expect(first.bundleSha256).not.toBe(originalHash)
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.runner.internals.inspectCollectorBaseline(f.remote.bundle.reportDate).receipt.bundleSha256).toBe(first.bundleSha256)
    await f.queue()
    const second = await f.runOnce(f.options)
    expect(second.status).toBe('published_verified')
    expect(second.bundleSha256).not.toBe(first.bundleSha256)
    expect(f.localHash()).toBe(second.bundleSha256)
    expect(f.cloudHash()).toBe(second.bundleSha256)
    expect(f.captures()).toBe(2)
  })

  it('retains the exact encrypted candidate after an interrupted first publication and reconciles without recapture', async () => {
    const f = await lifecycleFixture()
    const baseline = f.localHash()
    await f.queue()
    const lost = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic transport interruption before tenant dispatch')
      return f.actualFetch(url, options)
    } })
    expect(lost.status).toBe('reconciliation_required')
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
    const pending = findPendingPublication(f.root)
    const retainedEnvelope = readFileSync(pending.artifacts.envelopePath, 'utf8')
    for (const suffix of ['release.json', 'manifest.json', 'dealermail.json', 'state.json']) expect(existsSync(path.join(pending.artifacts.directory, `${lost.attemptId}.${suffix}`))).toBe(true)
    const reconciled = await f.runOnce(f.options)
    expect(reconciled.status).toBe('published_verified')
    expect(f.envelopes[0]).toEqual(JSON.parse(retainedEnvelope))
    expect(f.localHash()).toBe(reconciled.bundleSha256)
    expect(f.cloudHash()).toBe(reconciled.bundleSha256)
    expect(f.captures()).toBe(1)
  })

  it('retries a signed preflight-only publication response with the same retained candidate', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    let rejected = false
    const first = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication' && !rejected) {
        rejected = true
        const publication = JSON.parse(String(options.body))
        return Response.json({
          status: 'preflight_retryable', attemptId: publication.attemptId,
          bundleSha256: publication.envelope.bundleSha256, reportDate: publication.envelope.reportDate,
          ready: false,
        })
      }
      return f.actualFetch(url, options)
    } })
    expect(first.status).toBe('preflight_retryable')
    const pending = findPendingPublication(f.root)
    expect(pending.state.preflightRetryable).toBe(true)
    const retainedEnvelope = readFileSync(pending.artifacts.envelopePath, 'utf8')
    const retried = await f.runOnce(f.options)
    expect(retried.status).toBe('published_verified')
    expect(f.envelopes).toHaveLength(1)
    expect(f.envelopes[0]).toEqual(JSON.parse(retainedEnvelope))
    expect(f.captures()).toBe(1)
    expect(f.localHash()).toBe(retried.bundleSha256)
  })

  it('retains one capture and retries the same encrypted candidate after a proven atomic revision rollback', async () => {
    const f = await lifecycleFixture(), baseline = f.localHash(), batch = f.remote.tenantEnv.INVENTORY_DB.batch
    await f.queue()
    let raced = false
    f.remote.tenantEnv.INVENTORY_DB.batch = async (statements: any[]) => {
      if (!raced && statements.some(s => s.sql.includes('UPDATE cloud_app_revision SET revision=CASE'))) {
        raced = true
        f.remote.tenant.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1').run()
      }
      return batch(statements)
    }
    const first = await f.runOnce(f.options)
    expect(first.status).toBe('revision_retryable')
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS count FROM collector_publication_receipts').get().count).toBe(0)
    const pending = findPendingPublication(f.root)
    expect(pending.state).toMatchObject({ revisionRetryable: true, preflightRetryable: false, reconciliationRequired: false, publicationPending: true })
    const envelope = readFileSync(pending.artifacts.envelopePath, 'utf8'), key = pending.state.publicationIdempotencyKey
    const second = await f.runOnce(f.options)
    expect(second.status).toBe('published_verified')
    expect(f.envelopes).toHaveLength(2)
    expect(f.envelopes[0]).toEqual(JSON.parse(envelope))
    expect(f.envelopes[1]).toEqual(JSON.parse(envelope))
    expect(key).toBeTruthy()
    expect(f.captures()).toBe(1)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS count FROM collector_publication_receipts').get().count).toBe(1)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_audit WHERE action='publication_started'").get().count).toBe(1)
    expect(f.localHash()).toBe(second.bundleSha256)
    expect(f.cloudHash()).toBe(second.bundleSha256)
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it('clears revision rollback proof before a retry whose committed response is lost', async () => {
    const f = await lifecycleFixture(), batch = f.remote.tenantEnv.INVENTORY_DB.batch
    await f.queue()
    let raced = false
    f.remote.tenantEnv.INVENTORY_DB.batch = async (statements: any[]) => {
      if (!raced && statements.some(s => s.sql.includes('UPDATE cloud_app_revision SET revision=CASE'))) {
        raced = true
        f.remote.tenant.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1').run()
      }
      return batch(statements)
    }
    expect((await f.runOnce(f.options)).status).toBe('revision_retryable')
    const retained = findPendingPublication(f.root)
    const retry = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') throw new Error('Synthetic committed retry response lost')
      return response
    } })
    expect(retry.status).toBe('reconciliation_required')
    expect(findPendingPublication(f.root).state).toMatchObject({ revisionRetryable: false, reconciliationRequired: true })
    expect(f.cloudHash()).toBe(retained.state.bundleSha256)
    expect((await f.runOnce(f.options)).status).toBe('published_verified')
    expect(f.captures()).toBe(1)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS count FROM collector_publication_receipts').get().count).toBe(1)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS count FROM platform_audit WHERE action='publication_started'").get().count).toBe(1)
  })

  it.each(['preflight_retryable', 'revision_retryable'])('uses retained %s proof to retire an expired uncommitted retry and complete a fresh claim', async status => {
    const f = await lifecycleFixture()
    await f.queue()
    let preflight = false
    const first = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication' && !preflight) {
        preflight = true
        const publication = JSON.parse(String(options.body))
        return Response.json({
          status, attemptId: publication.attemptId,
          bundleSha256: publication.envelope.bundleSha256, reportDate: publication.envelope.reportDate,
          ready: false,
        })
      }
      return f.actualFetch(url, options)
    } })
    expect(first.status).toBe(status)
    vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121_000))
    const recovered = await f.runOnce(f.options)
    expect(recovered.status).toBe('published_verified')
    expect(f.captures()).toBe(2)
    expect(f.publications()).toBe(2)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS count FROM collector_publication_receipts').get().count).toBe(1)
    expect(f.localHash()).toBe(recovered.bundleSha256)
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it.each([
    ['COLLECTOR_REVOKED', 403],
    ['COLLECTOR_DISABLED', 403],
    ['COLLECTOR_SCOPE_MISMATCH', 409],
  ])('retires a preflight candidate on the exact %s/%s authority response', async (code, status) => {
    const f = await lifecycleFixture()
    const baseline = f.localHash()
    await f.queue()
    let preflight = false
    const first = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication' && !preflight) {
        preflight = true
        const publication = JSON.parse(String(options.body))
        return Response.json({ status: 'preflight_retryable', attemptId: publication.attemptId,
          bundleSha256: publication.envelope.bundleSha256, reportDate: publication.envelope.reportDate, ready: false })
      }
      return f.actualFetch(url, options)
    } })
    expect(first.status).toBe('preflight_retryable')
    const failed = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') return Response.json({ code }, { status })
      return f.actualFetch(url, options)
    } })
    expect(failed).toMatchObject({ status: 'failed', code })
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.localHash()).toBe(baseline)
  })

  it('keeps the candidate when an authority response has an unrecognized code or status', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    let preflight = false
    await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication' && !preflight) {
        preflight = true
        const publication = JSON.parse(String(options.body))
        return Response.json({ status: 'preflight_retryable', attemptId: publication.attemptId,
          bundleSha256: publication.envelope.bundleSha256, reportDate: publication.envelope.reportDate, ready: false })
      }
      return f.actualFetch(url, options)
    } })
    const failed = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') return Response.json({ code: 'COLLECTOR_REVOKED' }, { status: 409 })
      return f.actualFetch(url, options)
    } })
    expect(failed.status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root)
    expect(pending.state).toMatchObject({ preflightRetryable: false, reconciliationRequired: true })
  })

  it('keeps a preflight candidate unknown after the later publication response is lost', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    let preflight = false
    await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication' && !preflight) {
        preflight = true
        const publication = JSON.parse(String(options.body))
        return Response.json({ status: 'preflight_retryable', attemptId: publication.attemptId,
          bundleSha256: publication.envelope.bundleSha256, reportDate: publication.envelope.reportDate, ready: false })
      }
      return f.actualFetch(url, options)
    } })
    const unknown = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic later publication response lost')
      return response
    } })
    expect(unknown.status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root)
    expect(pending.state).toMatchObject({ preflightRetryable: false, reconciliationRequired: true })
    expect(f.cloudHash()).toBe(pending.envelope.bundleSha256)
    const recovered = await f.runOnce(f.options)
    expect(recovered.status).toBe('published_verified')
    expect(f.localHash()).toBe(recovered.bundleSha256)
    expect(f.captures()).toBe(1)
  })

  it('records an oversized complete publication wrapper as a definite failure without POST or retained attempt', async () => {
    const f = await lifecycleFixture()
    const baseline = f.localHash()
    await f.queue()
    const maxBytes = 25 * 1024 * 1024
    const runnerLoader = async () => ({
      ...f.runner,
      internals: {
        ...f.runner.internals,
        stageIntradayHoldRefreshCandidate: async args => {
          const stage = await f.runner.internals.stageIntradayHoldRefreshCandidate(args)
          const candidate = JSON.parse(readFileSync(stage.candidatePath, 'utf8'))
          const envelopeShape = {
            version: 'inventory-flow-private-release-v1', reportDate: stage.reportDate,
            bundleSha256: 'a'.repeat(64), iv: 'x'.repeat(16), ciphertext: '',
          }
          const targetCiphertextBytes = Math.floor((maxBytes - 100 - Buffer.byteLength(JSON.stringify(envelopeShape))) * 0.75) - 16
          const basePlaintextBytes = Buffer.byteLength(JSON.stringify({ ...candidate, syntheticPreflightPadding: '' }))
          const paddingSize = Math.max(0, targetCiphertextBytes - basePlaintextBytes)
          candidate.syntheticPreflightPadding = 'x'.repeat(paddingSize)
          writeJson(stage.candidatePath, candidate)
          const envelope = encryptBundle(candidate, f.remote.key)
          stage.bundleSha256 = envelope.bundleSha256
          const wrapperBytes = Buffer.byteLength(JSON.stringify({
            attemptId: 'synthetic-attempt-id', fence: 1, configSha256: 'a'.repeat(64), envelope,
          }))
          expect(Buffer.byteLength(JSON.stringify(envelope))).toBeGreaterThan(maxBytes - 200)
          expect(Buffer.byteLength(JSON.stringify(envelope))).toBeLessThanOrEqual(maxBytes)
          expect(wrapperBytes).toBeGreaterThan(maxBytes)
          return stage
        },
      },
    })
    const result = await f.runOnce({ ...f.options, runnerLoader })
    expect(result).toMatchObject({ status: 'failed', code: 'REQUEST_TOO_LARGE' })
    expect(f.publications()).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.localHash()).toBe(baseline)
  }, 30_000)

  it('rejects missing, invalid or disagreeing extractedAtUtc provenance before publication', async () => {
    const f = await lifecycleFixture()
    const baseline = f.localHash()
    const invalidations = [
      snapshot => { delete snapshot.extractedAtUtc },
      snapshot => { snapshot.extractedAtUtc = 'not-a-timestamp' },
      snapshot => { snapshot.completeDealerMailUsedInventory.extractedAtUtc = new Date(Date.parse(snapshot.extractedAtUtc) + 1000).toISOString() },
    ]
    for (const invalidate of invalidations) {
      await f.queue()
      const result = await f.runOnce({ ...f.options, captureFactory: () => async (...args) => {
        await f.options.captureFactory()(...args)
        const snapshot = JSON.parse(readFileSync(f.dealerPath, 'utf8'))
        invalidate(snapshot)
        writeJson(f.dealerPath, snapshot)
      } })
      expect(result).toMatchObject({ status: 'failed', code: 'DEALERMAIL_SNAPSHOT_INVALID' })
    }
    expect(f.publications()).toBe(0)
    expect(f.captures()).toBe(3)
    expect(f.localHash()).toBe(baseline)
  })

  it('retires a successful capture whose retained same-day snapshot timestamp predates the claim', async () => {
    const f = await lifecycleFixture()
    const baseline = f.localHash()
    const oldSnapshot = JSON.parse(readFileSync(f.dealerPath, 'utf8'))
    expect(Date.parse(oldSnapshot.extractedAtUtc)).toBeLessThan(COLLECTOR_SYNTHETIC_NOW.getTime())
    await f.queue()
    let captures = 0
    const result = await f.runOnce({ ...f.options, captureFactory: () => async () => { captures += 1 } })
    expect(result).toMatchObject({ status: 'failed', code: 'DEALERMAIL_SNAPSHOT_INVALID' })
    expect(captures).toBe(1)
    expect(f.publications()).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    expect(f.localHash()).toBe(baseline)
  })

  it('retires a capture attempt after a definitive stale receipt and makes one fresh claim', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    let claims = 0
    let staleReceiptSent = false
    const result = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/claim') {
        claims += 1
        if (claims > 1) return new Response(null, { status: 204 })
      }
      if (url.pathname === '/api/collector/receipts' && !staleReceiptSent) {
        const receipt = JSON.parse(String(options.body))
        if (receipt.kind === 'capture') {
          staleReceiptSent = true
          return Response.json({ code: 'COLLECTOR_LEASE_STALE' }, { status: 409 })
        }
      }
      return f.actualFetch(url, options)
    } })
    expect(result.status).toBe('idle')
    expect(claims).toBe(2)
    expect(f.captures()).toBe(1)
    expect(f.publications()).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it('restarts after a dropped capture receipt, retires it when the lease expires, and completes a fresh pull', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    let dropped = false
    const interrupted = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/receipts' && !dropped && JSON.parse(String(options.body)).kind === 'capture') {
        dropped = true
        throw new TypeError('Synthetic lost capture receipt response')
      }
      return f.actualFetch(url, options)
    } })
    expect(interrupted.status).toBe('capture_receipt_pending')
    expect(findPendingPublication(f.root)).not.toBe(null)
    vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121_000))
    const recovered = await f.runOnce(f.options)
    expect(recovered, JSON.stringify(recovered)).toMatchObject({ status: 'published_verified' })
    expect(f.captures()).toBe(2)
    expect(f.publications()).toBe(1)
    expect(f.localHash()).toBe(recovered.bundleSha256)
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it('recovers an interrupted temporary promotion backup before canonical writes', async () => {
    const f = await lifecycleFixture()
    const original = [f.dealerPath, f.manifestPath, f.releasePath, f.receiptPath].map(file => readFileSync(file))
    await f.queue()
    const writer = f.runner.internals.runtime.writeCollectorPromotionBackup
    let tempPath: string | null = null
    f.runner.internals.runtime.writeCollectorPromotionBackup = (file, _content) => {
      tempPath = `${file}.tmp`
      writeFileSync(tempPath, '{partial backup')
      throw new Error('Synthetic interruption during backup write')
    }
    const failed = await f.runOnce(f.options)
    f.runner.internals.runtime.writeCollectorPromotionBackup = writer
    expect(failed.status).toBe('reconciliation_required')
    expect(tempPath && existsSync(tempPath)).toBe(true)
    for (const [index, file] of [f.dealerPath, f.manifestPath, f.releasePath, f.receiptPath].entries()) expect(readFileSync(file).equals(original[index])).toBe(true)
    const recovered = await f.runOnce(f.options)
    expect(recovered.status).toBe('published_verified')
    expect(tempPath && existsSync(tempPath)).toBe(false)
    expect(f.captures()).toBe(1)
  })

  it('recovers when promotion stops immediately after the backup rename', async () => {
    const f = await lifecycleFixture()
    const original = [f.dealerPath, f.manifestPath, f.releasePath, f.receiptPath].map(file => readFileSync(file))
    await f.queue()
    const writer = f.runner.internals.runtime.writeCollectorPromotionBackup
    let backupPath: string | null = null
    f.runner.internals.runtime.writeCollectorPromotionBackup = (file, content) => {
      backupPath = file
      writer(file, content)
      throw new Error('Synthetic process stop after durable backup rename')
    }
    const interrupted = await f.runOnce(f.options)
    f.runner.internals.runtime.writeCollectorPromotionBackup = writer
    expect(interrupted.status).toBe('reconciliation_required')
    expect(backupPath && existsSync(backupPath)).toBe(true)
    expect(backupPath && existsSync(`${backupPath}.tmp`)).toBe(false)
    for (const [index, file] of [f.dealerPath, f.manifestPath, f.releasePath, f.receiptPath].entries()) expect(readFileSync(file).equals(original[index])).toBe(true)
    const recovered = await f.runOnce(f.options)
    expect(recovered.status).toBe('published_verified')
    expect(f.captures()).toBe(1)
  })

  it('retains an accepted candidate when every publication response is lost and promotes after same-hash read-only reconciliation', async () => {
    const f = await lifecycleFixture()
    const baseline = f.localHash()
    await f.queue()
    const lost = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic accepted publication response lost')
      return response
    } })
    expect(lost.status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root)
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(pending.envelope.bundleSha256)
    const receiptCount = f.remote.tenant.prepare('SELECT COUNT(*) AS count FROM collector_publication_receipts').get().count
    const reconciled = await f.runOnce(f.options)
    expect(reconciled.status).toBe('published_verified')
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS count FROM collector_publication_receipts').get().count).toBe(receiptCount)
    expect(f.localHash()).toBe(pending.envelope.bundleSha256)
    expect(f.captures()).toBe(1)
    expect(findPendingPublication(f.root)).toBe(null)
  })

  it('rolls back a failed local promotion and keeps candidate, backup and pending marker for a verified retry', async () => {
    const f = await lifecycleFixture()
    const baselineHash = f.localHash()
    const original = [f.dealerPath, f.manifestPath, f.releasePath, f.receiptPath].map(file => readFileSync(file))
    await f.queue()
    const writer = f.runner.internals.runtime.writeCollectorBaselineFile
    let writes = 0
    f.runner.internals.runtime.writeCollectorBaselineFile = (file, content) => { writes += 1; if (writes === 2) throw new Error('Synthetic disk failure'); writer(file, content) }
    const failed = await f.runOnce(f.options)
    f.runner.internals.runtime.writeCollectorBaselineFile = writer
    expect(failed.status).toBe('reconciliation_required')
    expect(f.localHash()).toBe(baselineHash)
    for (const [index, file] of [f.dealerPath, f.manifestPath, f.releasePath, f.receiptPath].entries()) expect(readFileSync(file).equals(original[index])).toBe(true)
    const pending = findPendingPublication(f.root)
    expect(f.cloudHash()).toBe(pending.envelope.bundleSha256)
    const backupPath = path.join(pending.artifacts.directory, `${failed.attemptId}.promotion-backup.json`)
    expect(existsSync(backupPath)).toBe(true)
    const envelope = readFileSync(pending.artifacts.envelopePath, 'utf8')
    // Simulate a process interruption after a canonical input write but before
    // the receipt. The durable backup and pending marker permit exact replay.
    copyFileSync(pending.artifacts.dealerMailPath, f.dealerPath)
    const recovered = await f.runOnce(f.options)
    expect(recovered.status).toBe('published_verified')
    expect(f.localHash()).toBe(recovered.bundleSha256)
    expect(f.envelopes.at(-1)).toEqual(JSON.parse(envelope))
    expect(f.captures()).toBe(1)
    expect(existsSync(backupPath)).toBe(false)
  })
})
