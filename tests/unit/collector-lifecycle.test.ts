// @ts-nocheck -- exercises the plain ESM host and runner with synthetic evidence.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import { findPendingPublication } from '../../scripts/lib/dealermail-hold-refresh-adapter.mjs'

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
  const { runOnce } = await import('../../scripts/collector-host.mjs')
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
    adapterId: profile.adapterId, adapterVersion: profile.adapterVersion, profileId: profile.profileId, profileSha256: profile.profileSha256,
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
    return handleCollectorApi(new Request(url, options), remote.env, remote.machine, COLLECTOR_SYNTHETIC_NOW)
  }
  const options = {
    profileName: COLLECTOR_PROFILE_NAME, profileDirectory,
    credentialReader: () => ({ accessClientId: 'synthetic', accessClientSecret: 'synthetic', releaseEncryptionKeyBase64: remote.key.toString('base64') }),
    fetchImpl: actualFetch,
    runnerLoader: async () => runner,
    now: () => COLLECTOR_SYNTHETIC_NOW,
    captureFactory: () => async () => {
      captures += 1
      const snapshot = JSON.parse(readFileSync(dealerPath, 'utf8'))
      snapshot.extractedAtUtc = new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + captures * 1000).toISOString()
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
  return { root, remote, profile, runner, runOnce, options, queue, actualFetch, envelopes, dealerPath, manifestPath, receiptPath, releasePath,
    captures: () => captures, publications: () => publications,
    localHash: () => JSON.parse(readFileSync(receiptPath, 'utf8')).bundleSha256,
    cloudHash: () => remote.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256,
  }
}

describe('collector exact candidate local baseline lifecycle', () => {
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
