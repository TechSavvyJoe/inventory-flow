// @ts-nocheck -- exercises the plain ESM host and runner with synthetic evidence.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import fs, { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { createSyntheticCollector, COLLECTOR_OWNER, COLLECTOR_SYNTHETIC_NOW } from '../../fixtures/synthetic-collector.mjs'
import { saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { handleCollectorApi } from '../../cloudflare/src/platform-worker.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { savePlatform } from '../../cloudflare/src/platform-admin.mjs'
import { publishRelease } from '../../cloudflare/src/worker.mjs'
import { cloudBundleSha256, encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { receiptSourceHashes, writeReceipt } from '../../scripts/sync-cloud-release.mjs'
import { COLLECTOR_PROFILE_NAME, installedStoreSet, profileFingerprint } from '../../scripts/lib/collector-profile.mjs'
import { findPendingPublication, privateAttemptArtifacts, getOrCreateClaimIdempotencyKey } from '../../scripts/lib/dealermail-hold-refresh-adapter.mjs'

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

async function crashAfterInitialCandidateState(f) {
  const claimKey = getOrCreateClaimIdempotencyKey(f.root, f.profile.profileSha256)
  const response = await f.actualFetch(new URL('/api/collector/claim', f.profile.controlPlaneOrigin), {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': claimKey }, body: '{}',
  })
  expect(response.ok).toBe(true)
  const claim = await response.json()
  const artifacts = privateAttemptArtifacts(f.root, claim.attemptId)
  const captureMarker = path.join(f.root, 'synthetic-crash-capture-count.json')
  // Kill only the owned synthetic child after the real host fsyncs its first
  // all-false state. No catch/finally runs, matching this durable crash boundary.
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const fixed = ${COLLECTOR_SYNTHETIC_NOW.getTime()}, RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
    const statePath = ${JSON.stringify(artifacts.statePath)}, sync = fs.fsyncSync, rename = fs.renameSync;
    const crash = () => {
      if (!fs.existsSync(statePath)) return;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (['captureReceiptSent', 'captureReceiptPending', 'publicationPending', 'reconciliationRequired'].every(key => state[key] === false)) process.exit(86);
    };
    fs.fsyncSync = descriptor => {
      sync(descriptor);
      if (fs.fstatSync(descriptor).isDirectory()) crash();
    };
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (process.platform === 'win32' && to === statePath) crash();
    };
    syncBuiltinESMExports();
    const runner = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/run-inventory-flow-daily.mjs')).href)});
    const { collectorHostInternals } = await import(${JSON.stringify(pathToFileURL(path.resolve('scripts/collector-host.mjs')).href)});
    await collectorHostInternals.acquireRunnerLock(${JSON.stringify(f.profile)});
    const outcome = await collectorHostInternals.runClaimedAttempt(${JSON.stringify(f.profile)}, ${JSON.stringify(f.options.credentialReader())}, ${JSON.stringify(claim)}, {
      runnerLoader: async () => runner,
      now: () => new Date(fixed),
      fetchImpl: async () => { throw new Error('Synthetic crash must precede every receipt/publication request'); },
      captureFactory: () => async () => {
        fs.writeFileSync(${JSON.stringify(captureMarker)}, '1');
        const snapshot = JSON.parse(fs.readFileSync(${JSON.stringify(f.dealerPath)}, 'utf8'));
        snapshot.extractedAtUtc = new Date(fixed + 1000).toISOString();
        snapshot.completeDealerMailUsedInventory.extractedAtUtc = snapshot.extractedAtUtc;
        fs.writeFileSync(${JSON.stringify(f.dealerPath)}, JSON.stringify(snapshot));
      },
    });
    process.stdout.write(JSON.stringify(outcome));
    process.exit(88);
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    timeout: 15000, encoding: 'utf8',
    env: { PATH: process.env.PATH, BOB_MAXEY_WORKSPACE_ROOT: f.root, INVENTORY_WORKSPACE_ROOT: f.root },
  })
  expect({ status: child.status, stderr: child.stderr, stdout: child.stdout, error: child.error?.message }).toEqual({ status: 86, stderr: '', stdout: '', error: undefined })
  expect(readFileSync(captureMarker, 'utf8')).toBe('1')
  const state = JSON.parse(readFileSync(artifacts.statePath, 'utf8'))
  expect(state).toMatchObject({ captureReceiptSent: false, captureReceiptPending: false, publicationPending: false, reconciliationRequired: false })
  for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath']) expect(existsSync(artifacts[key])).toBe(true)
  expect(existsSync(path.join(artifacts.directory, 'capture-rollback.json'))).toBe(false)
  expect(f.remote.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('claimed')
  expect(f.remote.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts').get().n).toBe(0)
  return { claim, artifacts, state, captureMarker }
}

describe('collector exact candidate local baseline lifecycle', () => {
  it.each(['resume', 'expired', 'lost-capture-reply', 'lost-publication-reply', 'execution-off'])('discovers the actual all-false durable host crash marker and safely handles %s without second capture', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    const crashed = await crashAfterInitialCandidateState(f)
    const pending = findPendingPublication(f.root)
    expect(pending).toMatchObject({ state: crashed.state })
    const before = Object.fromEntries(['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath'].map(key => [key, readFileSync(crashed.artifacts[key])]))
    const exactEnvelope = JSON.parse(before.envelopePath.toString())
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
    const sourceWork = vi.spyOn(f.runner.internals.runtime, 'run')
    const browser = vi.spyOn(f.runner.internals.runtime, 'ensureAutomationBrowser')
    try {
      await expect(f.runner.internals.runDaily(f.runner.internals.parseArgs(['--date', crashed.state.reportDate, '--force-publish']))).rejects.toThrow('RECONCILIATION_REQUIRED')
      expect(sourceWork).not.toHaveBeenCalled()
      expect(browser).not.toHaveBeenCalled()
    } finally {
      sourceWork.mockRestore()
      browser.mockRestore()
    }
    if (mode === 'expired') {
      vi.setSystemTime(new Date(COLLECTOR_SYNTHETIC_NOW.getTime() + 121000))
      const promotion = vi.fn(), runnerLoader = vi.fn(async () => f.runner)
      const recovered = await f.collectorHostInternals.reconcilePendingPublication(
        f.profile, f.options.credentialReader(), pending, f.actualFetch, undefined, { runnerLoader, promotion },
      )
      expect(recovered).toMatchObject({ status: 'retry_fresh_claim', code: 'COLLECTOR_LEASE_STALE' })
      expect(promotion).not.toHaveBeenCalled()
      expect(runnerLoader).not.toHaveBeenCalled()
      expect(findPendingPublication(f.root)).toBe(null)
      expect(existsSync(path.join(crashed.artifacts.directory, 'pending-claim.json'))).toBe(false)
      for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath']) expect(existsSync(crashed.artifacts[key])).toBe(false)
      expect(f.publications()).toBe(0)
      expect(f.remote.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts').get().n).toBe(0)
      expect(f.localHash()).toBe(baseline)
      expect(f.cloudHash()).toBe(baseline)
    } else if (mode === 'execution-off') {
      f.remote.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED = 'false'
      expect(await f.runOnce(f.options)).toMatchObject({ status: 'disabled' })
      expect(await f.runOnce(f.options)).toMatchObject({ status: 'disabled' })
      expect(readFileSync(crashed.artifacts.statePath)).toEqual(Buffer.from(JSON.stringify(crashed.state)))
      for (const [key, bytes] of Object.entries(before)) expect(readFileSync(crashed.artifacts[key])).toEqual(bytes)
      expect(f.publications()).toBe(0)
      expect(f.localHash()).toBe(baseline)
      expect(f.cloudHash()).toBe(baseline)
    } else {
      if (mode !== 'resume') {
        const first = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
          const response = await f.actualFetch(url, options)
          if (mode === 'lost-capture-reply' && url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'capture') throw new TypeError('Synthetic capture reply lost after crash recovery')
          if (mode === 'lost-publication-reply' && url.pathname === '/api/collector/publication') throw new TypeError('Synthetic committed publication reply lost after crash recovery')
          return response
        } })
        expect(first.status).toBe(mode === 'lost-capture-reply' ? 'capture_receipt_pending' : 'reconciliation_required')
        for (const [key, bytes] of Object.entries(before)) expect(readFileSync(crashed.artifacts[key])).toEqual(bytes)
        expect(findPendingPublication(f.root)).not.toBe(null)
        expect(f.localHash()).toBe(baseline)
      }
      expect(await f.runOnce(f.options)).toMatchObject({ status: 'published_verified', bundleSha256: exactEnvelope.bundleSha256 })
      expect(f.envelopes.every(envelope => JSON.stringify(envelope) === JSON.stringify(exactEnvelope))).toBe(true)
      expect(f.localHash()).toBe(exactEnvelope.bundleSha256)
      expect(f.cloudHash()).toBe(exactEnvelope.bundleSha256)
      expect(findPendingPublication(f.root)).toBe(null)
      expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='capture'").get().n).toBe(1)
      expect(f.remote.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(1)
    }
    expect(readFileSync(crashed.captureMarker, 'utf8')).toBe('1')
    expect(f.captures()).toBe(0)
  })

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

  const rejectCollectorAuthority = async (f, mode) => {
    if (mode === 'revoked') {
      await saveCollector(f.remote.env, COLLECTOR_OWNER, f.profile.groupId, {
        operation: 'revoke', id: f.remote.collectorId, reason: 'Synthetic revocation before dispatch',
        expectedRevision: f.remote.sqlite.prepare('SELECT revision FROM platform_revision').get().revision,
      }, 'synthetic-pre-dispatch-revoke', new Date())
    } else if (mode === 'enrollment-disabled') {
      f.remote.sqlite.prepare('UPDATE platform_collectors SET enabled=0 WHERE id=?').run(f.remote.collectorId)
    } else if (mode === 'group-suspended' || mode === 'dealership-disabled') {
      const expectedRevision = f.remote.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
      if (mode === 'group-suspended') {
        const group = f.remote.sqlite.prepare('SELECT * FROM platform_groups WHERE id=?').get(f.profile.groupId)
        await savePlatform(f.remote.env,COLLECTOR_OWNER,'groups',{id:group.id,name:group.name,status:'suspended',reason:'Synthetic authority suspension',expectedRevision},'lost-publication-owner-stop')
      } else {
        const dealer = f.remote.sqlite.prepare('SELECT * FROM platform_dealerships WHERE id=?').get(f.remote.dealers[0].id)
        await savePlatform(f.remote.env,COLLECTOR_OWNER,'dealerships',{id:dealer.id,groupId:dealer.group_id,name:dealer.name,storeKey:dealer.store_key,website:dealer.website,enabled:false,reason:'Synthetic authority disable',expectedRevision},'lost-publication-owner-stop')
      }
    } else f.remote.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED = 'false'
  }

  const artifactBytes = artifacts => Object.fromEntries(
    ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath'].map(key => [key, readFileSync(artifacts[key])]),
  )

  it.each(['revoked', 'enrollment-disabled', 'execution-disabled'])('retires a new candidate on exact pre-dispatch %s authority rejection', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    const publish = vi.fn(f.remote.env.TENANT_NORTH_PUBLISHER.publish)
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    await f.queue()
    let requests = 0, failureReceipts = 0, artifacts
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') {
        requests += 1
        artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
        await rejectCollectorAuthority(f, mode)
      }
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'failure') failureReceipts += 1
      return f.actualFetch(url, options)
    } })
    expect(outcome).toMatchObject({ status: 'failed', code: mode === 'revoked' ? 'COLLECTOR_REVOKED' : 'COLLECTOR_DISABLED' })
    expect(requests).toBe(1)
    expect(publish).not.toHaveBeenCalled()
    expect(failureReceipts).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath']) expect(existsSync(artifacts[key])).toBe(false)
    expect(existsSync(path.join(artifacts.directory, 'pending-claim.json'))).toBe(false)
    expect(existsSync(path.join(artifacts.directory, 'capture-rollback.json'))).toBe(false)
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
    if (mode === 'revoked') await expect(f.runOnce(f.options)).rejects.toMatchObject({ message: 'COLLECTOR_REVOKED', status: 403 })
    else expect(await f.runOnce(f.options)).toMatchObject({ status: 'disabled' })
    expect(f.captures()).toBe(1)
  })

  it.each(['group-suspended','dealership-disabled'].flatMap(mode => ['initial','capture-recovery','preflight-recovery'].map(phase => [mode,phase])))('retires only an undispatched %s candidate during %s on actual owner-authority 409', async (mode,phase) => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    const originalPublish = f.remote.env.TENANT_NORTH_PUBLISHER.publish
    const publish = vi.fn(originalPublish)
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    if (phase === 'capture-recovery') {
      expect((await f.runOnce({ ...f.options, fetchImpl: async (url,options) => {
        const response = await f.actualFetch(url,options)
        if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'capture') throw new TypeError('Synthetic lost capture acknowledgement')
        return response
      } })).status).toBe('capture_receipt_pending')
      expect(findPendingPublication(f.root).state.publicationPending).toBe(false)
    }
    if (phase === 'preflight-recovery') {
      f.remote.env.TENANT_NORTH_PUBLISHER.publish = async () => ({ status:'preflight_retryable' })
      expect((await f.runOnce(f.options)).status).toBe('preflight_retryable')
      expect(findPendingPublication(f.root).state.preflightRetryable).toBe(true)
      f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    }
    let requests = 0, failureReceipts = 0, artifacts, ownerAudit, ownerRecord, authorityResponse
    const expectedCode = mode === 'group-suspended' ? 'COLLECTOR_DISABLED' : 'COLLECTOR_SCOPE_MISMATCH'
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url,options) => {
      if (url.pathname === '/api/collector/publication') {
        requests += 1
        artifacts = privateAttemptArtifacts(f.root,JSON.parse(String(options.body)).attemptId)
        if (requests === 1) {
          const expectedRevision = f.remote.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
          if (mode === 'group-suspended') {
            const group = f.remote.sqlite.prepare('SELECT * FROM platform_groups WHERE id=?').get(f.profile.groupId)
            await savePlatform(f.remote.env,COLLECTOR_OWNER,'groups',{ id:group.id,name:group.name,status:'suspended',reason:'Synthetic owner suspension after capture',expectedRevision },'owner-stop-before-publication')
            ownerRecord = f.remote.sqlite.prepare('SELECT * FROM platform_groups WHERE id=?').get(group.id)
          } else {
            const dealer = f.remote.sqlite.prepare('SELECT * FROM platform_dealerships WHERE id=?').get(f.remote.dealers[0].id)
            await savePlatform(f.remote.env,COLLECTOR_OWNER,'dealerships',{ id:dealer.id,groupId:dealer.group_id,name:dealer.name,storeKey:dealer.store_key,website:dealer.website,enabled:false,reason:'Synthetic owner dealership disable after capture',expectedRevision },'owner-stop-before-publication')
            ownerRecord = f.remote.sqlite.prepare('SELECT * FROM platform_dealerships WHERE id=?').get(dealer.id)
          }
          ownerAudit = f.remote.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='owner-stop-before-publication'").get()
        }
        const response = await f.actualFetch(url,options)
        authorityResponse = { status:response.status,body:await response.clone().json() }
        return response
      }
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'failure') failureReceipts += 1
      return f.actualFetch(url,options)
    } })
    expect(authorityResponse).toMatchObject({status:409,body:{code:expectedCode}})
    expect(outcome).toMatchObject({status:'failed',code:expectedCode})
    expect(requests).toBe(1)
    expect(publish).not.toHaveBeenCalled()
    expect(failureReceipts).toBe(0)
    expect(findPendingPublication(f.root)).toBe(null)
    for (const key of ['candidatePath','manifestPath','dealerMailPath','envelopePath','statePath']) expect(existsSync(artifacts[key])).toBe(false)
    expect(existsSync(path.join(artifacts.directory,'pending-claim.json'))).toBe(false)
    expect(existsSync(path.join(artifacts.directory,'capture-rollback.json'))).toBe(false)
    expect(existsSync(path.join(f.root,'work/app-feed-status/.publication.lock'))).toBe(false)
    expect(f.localHash()).toBe(baseline);expect(f.cloudHash()).toBe(baseline);expect(f.captures()).toBe(1)
    const attempt = f.remote.sqlite.prepare('SELECT stage,expected_bundle_sha256 FROM platform_collector_attempts').get()
    expect(attempt.stage).toBe('captured')
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_started'").get().n).toBe(phase === 'preflight-recovery' ? 1 : 0)
    expect(f.remote.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='owner-stop-before-publication'").get()).toEqual(ownerAudit)
    expect(f.remote.sqlite.prepare(`SELECT * FROM ${mode === 'group-suspended' ? 'platform_groups' : 'platform_dealerships'} WHERE id=?`).get(ownerRecord.id)).toEqual(ownerRecord)
    if (mode === 'group-suspended') expect(await f.runOnce(f.options)).toMatchObject({status:'blocked',code:expectedCode})
    else await expect(f.runOnce(f.options)).rejects.toMatchObject({status:409,message:expectedCode})
    expect(findPendingPublication(f.root)).toBe(null);expect(f.captures()).toBe(1)
  })

  it.each(['COLLECTOR_PUBLICATION_INVALID', 'COLLECTOR_LEASE_STALE', 'COLLECTOR_NO_CAPTURE'])('still retires a new candidate on direct publication %s/409 rejection', async code => {
    const f = await lifecycleFixture()
    await f.queue()
    let requests = 0, artifacts
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') {
        requests += 1
        artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
        return Response.json({ code }, { status: 409 })
      }
      return f.actualFetch(url, options)
    } })
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(requests).toBe(1)
    expect(findPendingPublication(f.root)).toBe(null)
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath']) expect(existsSync(artifacts[key])).toBe(false)
    expect(f.captures()).toBe(1)
  })

  it.each(['revoked', 'execution-disabled'])('retires an undispatched capture-receipt recovery on exact %s authority rejection', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'capture') throw new TypeError('Synthetic capture receipt never dispatched')
      return f.actualFetch(url, options)
    } })).status).toBe('capture_receipt_pending')
    const pending = findPendingPublication(f.root)
    expect(pending.state.publicationPending).not.toBe(true)
    const publish = vi.fn(f.remote.env.TENANT_NORTH_PUBLISHER.publish)
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') await rejectCollectorAuthority(f, mode)
      return f.actualFetch(url, options)
    } })
    expect(outcome).toMatchObject({ status: 'failed', code: mode === 'revoked' ? 'COLLECTOR_REVOKED' : 'COLLECTOR_DISABLED' })
    expect(findPendingPublication(f.root)).toBe(null)
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath']) expect(existsSync(pending.artifacts[key])).toBe(false)
    expect(existsSync(path.join(pending.artifacts.directory, 'pending-claim.json'))).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    expect(f.captures()).toBe(1)
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
  })

  it.each([
    ['COLLECTOR_REVOKED', 401], ['COLLECTOR_REVOKED', 409],
    ['COLLECTOR_DISABLED', 401], ['COLLECTOR_AUTH_REQUIRED', 403],
    ['COLLECTOR_SCOPE_MISMATCH', 403], ['COLLECTOR_SCOPE_MISMATCH', 500],
  ])('keeps a new candidate unknown for non-authoritative %s/%s responses', async (code, status) => {
    const f = await lifecycleFixture()
    await f.queue()
    let artifacts, before, requests = 0
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') {
        requests += 1
        artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
        before ??= artifactBytes(artifacts)
        return Response.json({ code }, { status })
      }
      return f.actualFetch(url, options)
    } })
    expect(outcome.status).toBe('reconciliation_required')
    expect(requests).toBe(2)
    expect(findPendingPublication(f.root).state.reconciliationRequired).toBe(true)
    expect(artifactBytes(artifacts)).toEqual(before)
    expect(f.captures()).toBe(1)
  })

  it.each(['COLLECTOR_DISABLED','COLLECTOR_SCOPE_MISMATCH'].flatMap(code => ['before-commit','after-commit'].map(point => [code,point])))('preserves a new candidate when tenant-dispatched %s at %s remains uncertain', async (code,point) => {
    const f = await lifecycleFixture(), baseline = f.localHash(), publish = f.remote.env.TENANT_NORTH_PUBLISHER.publish
    await f.queue()
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = vi.fn(async (...args) => {
      if (point === 'after-commit') await publish(...args)
      throw Object.assign(new Error('Synthetic tenant-dispatched authority-shaped failure'),{code,status:409})
    })
    let artifacts, before, responseStatus, failureReceipts = 0
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url,options) => {
      if (url.pathname === '/api/collector/publication') {
        artifacts = privateAttemptArtifacts(f.root,JSON.parse(String(options.body)).attemptId)
        before = artifactBytes(artifacts)
        const response = await f.actualFetch(url,options)
        responseStatus = response.status
        expect(await response.clone().json()).toMatchObject({status:'reconciliation_required',ready:false})
        return response
      }
      if (url.pathname === '/api/collector/receipts' && JSON.parse(String(options.body)).kind === 'failure') failureReceipts += 1
      return f.actualFetch(url,options)
    } })
    expect(responseStatus).toBe(200);expect(outcome.status).toBe('reconciliation_required')
    expect(f.remote.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
    expect(findPendingPublication(f.root).state).toMatchObject({publicationPending:true,reconciliationRequired:true})
    expect(artifactBytes(artifacts)).toEqual(before);expect(failureReceipts).toBe(0)
    expect(f.localHash()).toBe(baseline);expect(f.captures()).toBe(1)
    expect(f.remote.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_started'").get().n).toBe(1)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(point === 'after-commit' ? 1 : 0)
    if (point === 'after-commit') {
      expect(f.cloudHash()).toBe(findPendingPublication(f.root).state.bundleSha256)
      expect((await f.runOnce(f.options)).status).toBe('published_verified')
      expect(findPendingPublication(f.root)).toBe(null);expect(f.localHash()).toBe(f.cloudHash())
    } else {
      expect(f.cloudHash()).toBe(baseline)
      expect((await f.runOnce(f.options)).status).toBe('reconciliation_required')
      expect(artifactBytes(artifacts)).toEqual(before)
    }
    expect(f.captures()).toBe(1);expect(f.remote.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  })

  it.each(['revoked', 'execution-disabled', 'group-suspended', 'dealership-disabled'].flatMap(mode => ['before-dispatch', 'after-commit'].map(loss => [mode, loss])))('preserves a new candidate when %s rejection follows the first %s lost reply', async (mode, loss) => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    const publish = vi.fn(f.remote.env.TENANT_NORTH_PUBLISHER.publish)
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    await f.queue()
    let requests = 0, artifacts, before
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') {
        requests += 1
        if (requests === 1) {
          artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
          before = artifactBytes(artifacts)
          if (loss === 'after-commit') await f.actualFetch(url, options)
          await rejectCollectorAuthority(f, mode)
          throw new TypeError('Synthetic first publication reply lost')
        }
      }
      return f.actualFetch(url, options)
    } })
    expect(outcome.status).toBe('reconciliation_required')
    expect(requests).toBe(2)
    expect(publish).toHaveBeenCalledTimes(loss === 'after-commit' ? 1 : 0)
    expect(findPendingPublication(f.root).state).toMatchObject({ publicationPending: true, reconciliationRequired: true })
    expect(artifactBytes(artifacts)).toEqual(before)
    expect(f.localHash()).toBe(baseline)
    expect(f.captures()).toBe(1)
  })

  it.each(['revoked', 'execution-disabled', 'group-suspended', 'dealership-disabled'])('preserves a persisted unknown candidate after exact %s authority rejection', async mode => {
    const f = await lifecycleFixture()
    await f.queue()
    expect((await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      const response = await f.actualFetch(url, options)
      if (url.pathname === '/api/collector/publication') throw new TypeError('Synthetic committed reply lost')
      return response
    } })).status).toBe('reconciliation_required')
    const pending = findPendingPublication(f.root), before = artifactBytes(pending.artifacts)
    const publish = vi.fn(f.remote.env.TENANT_NORTH_PUBLISHER.publish)
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') await rejectCollectorAuthority(f, mode)
      return f.actualFetch(url, options)
    } })
    expect(outcome.status).toBe('reconciliation_required')
    expect(findPendingPublication(f.root).state.attemptId).toBe(pending.state.attemptId)
    expect(artifactBytes(pending.artifacts)).toEqual(before)
    expect(publish).not.toHaveBeenCalled()
    expect(f.captures()).toBe(1)
  })

  it('preserves exact candidate evidence if pre-dispatch authority cleanup cannot retire its marker', async () => {
    const f = await lifecycleFixture()
    await f.queue()
    const rename = fs.renameSync
    let artifacts, before, failures = 0
    fs.renameSync = (from, to) => {
      if (artifacts && from === artifacts.statePath && to === `${artifacts.statePath}.settled`) {
        failures += 1
        throw Object.assign(new Error('Synthetic marker locked'), { code: 'EBUSY' })
      }
      return rename(from, to)
    }
    syncBuiltinESMExports()
    let outcome
    try { outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') {
        artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
        before = artifactBytes(artifacts)
        await rejectCollectorAuthority(f, 'execution-disabled')
      }
      return f.actualFetch(url, options)
    } }) }
    finally { fs.renameSync = rename; syncBuiltinESMExports() }
    expect(failures).toBe(1)
    expect(outcome).toMatchObject({ status: 'reconciliation_required', code: 'RECONCILIATION_REQUIRED' })
    expect(findPendingPublication(f.root).state.attemptId).toBe(path.basename(artifacts.statePath, '.state.json'))
    expect(artifactBytes(artifacts)).toEqual(before)
    expect(f.captures()).toBe(1)
    expect(f.remote.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  })

  const abortError = signal => new Promise((_, reject) => {
    const rejectAborted = () => reject(new Error('LEASE_STOPPED'))
    if (signal.aborted) rejectAborted()
    else signal.addEventListener('abort', rejectAborted, { once: true })
  })

  it.each(['revoked', 'execution-disabled', 'stale'])('preserves a candidate when a %s heartbeat aborts publication before its reply', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    let publicationStarted, artifacts, before, heartbeats = 0
    const started = new Promise(resolve => { publicationStarted = resolve })
    const running = f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/publication') {
        artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
        before = artifactBytes(artifacts)
        publicationStarted()
        // The server may have admitted this request. Its reply is never seen.
        return abortError(options.signal)
      }
      if (url.pathname === '/api/collector/heartbeat') {
        heartbeats += 1
        if (mode === 'stale') return Response.json({ code: 'COLLECTOR_LEASE_STALE' }, { status: 409 })
      }
      return f.actualFetch(url, options)
    } })
    await started
    if (mode !== 'stale') await rejectCollectorAuthority(f, mode)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await running).toMatchObject({ status: 'reconciliation_required', code: mode === 'revoked' ? 'COLLECTOR_REVOKED' : mode === 'stale' ? 'COLLECTOR_LEASE_STALE' : 'COLLECTOR_DISABLED' })
    expect(heartbeats).toBe(1)
    expect(findPendingPublication(f.root).state).toMatchObject({ publicationPending: true, reconciliationRequired: true })
    expect(artifactBytes(artifacts)).toEqual(before)
    expect(f.localHash()).toBe(baseline)
    expect(f.captures()).toBe(1)
  })

  it.each(['revoked', 'execution-disabled', 'stale'])('settles direct %s publication rejection despite a heartbeat abort after its complete body read', async mode => {
    const f = await lifecycleFixture(), baseline = f.localHash()
    await f.queue()
    vi.useFakeTimers()
    vi.setSystemTime(COLLECTOR_SYNTHETIC_NOW)
    const publish = vi.fn(f.remote.env.TENANT_NORTH_PUBLISHER.publish)
    f.remote.env.TENANT_NORTH_PUBLISHER.publish = publish
    let artifacts, completeBodyRead = false, heartbeats = 0, publicationSignal
    const outcome = await f.runOnce({ ...f.options, fetchImpl: async (url, options) => {
      if (url.pathname === '/api/collector/heartbeat') heartbeats += 1
      if (url.pathname !== '/api/collector/publication') return f.actualFetch(url, options)
      artifacts = privateAttemptArtifacts(f.root, JSON.parse(String(options.body)).attemptId)
      publicationSignal = options.signal
      if (mode === 'stale') f.remote.sqlite.prepare('UPDATE platform_collector_attempts SET lease_until=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), JSON.parse(String(options.body)).attemptId)
      else await rejectCollectorAuthority(f, mode)
      const response = await f.actualFetch(url, options)
      expect(response.status).toBe(mode === 'stale' ? 409 : 403)
      const reader = response.body.getReader()
      response.body.getReader = () => ({
        read: async () => {
          const chunk = await reader.read()
          if (chunk.done) {
            completeBodyRead = true
            // All rejection bytes arrived. The concurrent heartbeat aborts
            // before the protocol's parsed error reaches the host catch.
            const aborted = publicationSignal.aborted ? Promise.resolve() : new Promise(resolve => publicationSignal.addEventListener('abort', resolve, { once: true }))
            await vi.advanceTimersByTimeAsync(30_000)
            await aborted
          }
          return chunk
        },
        releaseLock: () => reader.releaseLock(),
        cancel: () => reader.cancel(),
      })
      return response
    } })
    expect(completeBodyRead).toBe(true)
    expect(heartbeats).toBe(1)
    expect(publicationSignal.aborted).toBe(true)
    expect(outcome).toMatchObject({ status: 'failed', code: mode === 'revoked' ? 'COLLECTOR_REVOKED' : mode === 'stale' ? 'COLLECTOR_LEASE_STALE' : 'COLLECTOR_DISABLED' })
    expect(findPendingPublication(f.root)).toBe(null)
    for (const key of ['candidatePath', 'manifestPath', 'dealerMailPath', 'envelopePath', 'statePath']) expect(existsSync(artifacts[key])).toBe(false)
    expect(existsSync(path.join(artifacts.directory, 'pending-claim.json'))).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    expect(f.localHash()).toBe(baseline)
    expect(f.cloudHash()).toBe(baseline)
    expect(f.captures()).toBe(1)
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

  it.each([false,true])('fences a forced same-day daily run before source work while an accepted collector candidate awaits promotion (inherited lock: %s)',async inherited=>{
    const f=await lifecycleFixture()
    await f.queue()
    const writer=f.runner.internals.runtime.writeCollectorBaselineFile
    f.runner.internals.runtime.writeCollectorBaselineFile=()=>{throw new Error('Synthetic promotion interruption')}
    const failed=await f.runOnce(f.options)
    f.runner.internals.runtime.writeCollectorBaselineFile=writer
    expect(failed.status).toBe('reconciliation_required')
    const pending=findPendingPublication(f.root)
    expect(existsSync(path.join(pending.artifacts.directory,'capture-rollback.json'))).toBe(false)
    const files=[f.dealerPath,f.manifestPath,f.releasePath,f.receiptPath,pending.artifacts.statePath,pending.artifacts.candidatePath,pending.artifacts.envelopePath]
    const before=files.map(file=>readFileSync(file))
    const run=vi.spyOn(f.runner.internals.runtime,'run'),browser=vi.spyOn(f.runner.internals.runtime,'ensureAutomationBrowser')
    const {acquirePublicationLock,releasePublicationLock}=await import('../../scripts/sync-cloud-release.mjs')
    const previousOwner=process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID
    const lock=inherited?acquirePublicationLock(path.join(f.root,'work/app-feed-status/.publication.lock')):null
    if(lock)process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID=JSON.parse(lock.content).ownerId
    try{
      await expect(f.runner.internals.runDaily(f.runner.internals.parseArgs(['--date',f.date,'--force-publish']))).rejects.toThrow('RECONCILIATION_REQUIRED')
      expect(run).not.toHaveBeenCalled();expect(browser).not.toHaveBeenCalled()
      for(const [index,file] of files.entries())expect(readFileSync(file)).toEqual(before[index])
    }finally{
      run.mockRestore();browser.mockRestore()
      if(previousOwner===undefined)delete process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID
      else process.env.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID=previousOwner
      if(lock)releasePublicationLock(lock)
    }
    const recovered=await f.runOnce(f.options)
    expect(recovered.status).toBe('published_verified')
    expect(f.localHash()).toBe(pending.envelope.bundleSha256)
    expect(f.captures()).toBe(1)
    expect(findPendingPublication(f.root)).toBeNull()
  })
})
