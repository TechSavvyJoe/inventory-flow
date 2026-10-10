// @ts-nocheck -- exercises the host bridge and installed adapter, which are plain Node ESM.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getEventListeners } from 'node:events'
import { STORE_CONFIG } from '../../server/importer.mjs'
import { createSyntheticCollector, COLLECTOR_OWNER, COLLECTOR_SYNTHETIC_NOW } from '../../fixtures/synthetic-collector.mjs'
import { handleCollectorApi } from '../../cloudflare/src/platform-worker.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { runDaemon, runOnce, collectorHostInternals } from '../../scripts/collector-host.mjs'
import { profileFingerprint, validateCollectorProfile, COLLECTOR_ADAPTER_ID, COLLECTOR_ADAPTER_VERSION, COLLECTOR_PROFILE_NAME } from '../../scripts/lib/collector-profile.mjs'
import { assertBaselineBundleMatchesClaim, assertClaimMatchesProfile, assertContactMatchesProfile, collectorRequest, submitCollectorPublication, validateReceiptPayload } from '../../scripts/lib/collector-protocol.mjs'
import { adapterInternals, checkCollectorDependencies, findPendingPublication, getOrCreateClaimIdempotencyKey, clearPendingClaimIdempotencyKey, makeDealerMailCapture, privateAttemptArtifacts, saveAttemptState } from '../../scripts/lib/dealermail-hold-refresh-adapter.mjs'

const tempRoots: string[] = []
const originalWorkspace = process.env.BOB_MAXEY_WORKSPACE_ROOT
const originalInventoryWorkspace = process.env.INVENTORY_WORKSPACE_ROOT

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'inventory-collector-host-'))
  tempRoots.push(root)
  for (const directory of ['work', 'work/run-status', 'work/app-feed-status', 'outputs', 'apps/inventory-ops', 'apps/inventory-ops/scripts', 'runtime/collector/profiles']) {
    mkdirSync(path.join(root, directory), { recursive: true })
  }
  const deps = {
    capture: "const ORIGIN = 'https://www.dealermail.com'\n",
    builder: '/* synthetic snapshot builder */\n',
    finalizer: '/* synthetic finalizer */\n',
  }
  writeFileSync(path.join(root, 'apps/inventory-ops/scripts/capture-dealermail.mjs'), deps.capture)
  writeFileSync(path.join(root, 'work/build_v2_snapshot.mjs'), deps.builder)
  writeFileSync(path.join(root, 'work/finalize_cloud_snapshot.mjs'), deps.finalizer)
  const dependencyName = { capture: 'dealermailCapture', builder: 'snapshotBuilder', finalizer: 'snapshotFinalizer' }
  const dependencyHashes = Object.fromEntries(Object.entries(deps).map(([key, value]) => [
    dependencyName[key as keyof typeof dependencyName],
    createHash('sha256').update(value).digest('hex'),
  ]))
  const installedKeys: Record<string, string> = { Howell: 'howell', Fowlerville: 'fowlerville', 'Ford Detroit': 'ford-detroit', Lincoln: 'lincoln' }
  const stores = Object.entries(STORE_CONFIG).map(([storeName, store]) => ({
    dealerMailId: store.dealerMailId,
    storeKey: installedKeys[storeName],
    dealershipId: 'dealership-' + store.dealerMailId,
    connectionId: 'connection-' + store.dealerMailId,
  }))
  const profile: any = {
    schemaVersion: 1,
    adapterId: COLLECTOR_ADAPTER_ID,
    adapterVersion: COLLECTOR_ADAPTER_VERSION,
    profileId: 'group-dealermail-v1',
    groupId: 'group-test',
    source: 'dealermail',
    stores,
    controlPlaneOrigin: 'https://inventory-admin-staging.joegallant.me',
    credentialRef: 'CREDENTIAL_TEST_ACCESS',
    releaseKeyRef: 'test-release-key',
    workspaceRoot: root,
    dependencyHashes,
  }
  profile.profileSha256 = profileFingerprint(profile)
  writeFileSync(path.join(root, 'runtime/collector/profiles', COLLECTOR_PROFILE_NAME + '.json'), JSON.stringify(profile))
  return { root, profile }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (originalWorkspace === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
  else process.env.BOB_MAXEY_WORKSPACE_ROOT = originalWorkspace
  if (originalInventoryWorkspace === undefined) delete process.env.INVENTORY_WORKSPACE_ROOT
  else process.env.INVENTORY_WORKSPACE_ROOT = originalInventoryWorkspace
})

describe('collector host contract', () => {
  it('accepts only the fixed commands and installed profile name', () => {
    expect(collectorHostInternals.parseArgs(['run-once', '--profile', 'group-dealermail-v1'])).toMatchObject({ command: 'run-once' })
    expect(() => collectorHostInternals.parseArgs(['run-once', '--profile', 'other'])).toThrow('PROFILE_NOT_INSTALLED')
    expect(() => collectorHostInternals.parseArgs(['run-once', '--profile', 'group-dealermail-v1', '--source', 'ford'])).toThrow('UNKNOWN_OPTION')
    expect(collectorHostInternals.isDefiniteStaleClaim({ status: 409, message: 'COLLECTOR_LEASE_STALE' })).toBe(true)
    expect(collectorHostInternals.isDefiniteStaleClaim({ status: 503, message: 'COLLECTOR_LEASE_STALE' })).toBe(false)
  })

  it('binds a profile to the exact full DealerMail store set and fixed control-plane origins', () => {
    const { profile } = fixture()
    expect(validateCollectorProfile(profile).profileSha256).toBe(profile.profileSha256)
    expect(profileFingerprint({ ...profile, dependencyHashes: { ...profile.dependencyHashes, snapshotBuilder: '0'.repeat(64) } })).not.toBe(profile.profileSha256)
    const narrowed = { ...profile, stores: profile.stores.slice(1) }
    expect(() => validateCollectorProfile(narrowed)).toThrow('PROFILE_STORE_SCOPE_MISMATCH')
    const badOrigin = { ...profile, controlPlaneOrigin: 'https://attacker.example' }
    expect(() => validateCollectorProfile(badOrigin)).toThrow('CONTROL_PLANE_ORIGIN_UNSUPPORTED')
    expect(() => validateCollectorProfile({ ...profile, publisherUrl: 'https://attacker.example' })).toThrow('PROFILE_INVALID')
  })

  it('rejects claimed scopes that differ from the enrolled group or add executable fields', () => {
    const { profile } = fixture()
    const now = new Date()
    const claim = {
      attemptId: 'attempt-1', requestId: 'request-1', fence: 1,
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      hardDeadline: new Date(now.getTime() + 10 * 60_000).toISOString(),
      configSha256: 'a'.repeat(64), scopeSha256: 'b'.repeat(64), baselineBundleSha256: 'f'.repeat(64), grantGeneration: 1,
      adapterId: COLLECTOR_ADAPTER_ID, adapterVersion: COLLECTOR_ADAPTER_VERSION,
      profileId: profile.profileId, profileSha256: profile.profileSha256, groupId: profile.groupId,
      dealerships: profile.stores.map((store: any) => ({ id: store.dealershipId, storeKey: store.storeKey })),
      connectionIds: profile.stores.map((store: any) => store.connectionId),
      credentialRef: profile.credentialRef, reportDate: collectorHostInternals.reportDateNow(),
    }
    expect(assertClaimMatchesProfile(claim, profile, now, claim.scopeSha256)).toBe(claim)
    expect(assertBaselineBundleMatchesClaim(claim, { bundleSha256: claim.baselineBundleSha256 })).toBe(true)
    expect(() => assertBaselineBundleMatchesClaim(claim, { bundleSha256: '0'.repeat(64) })).toThrow('BASELINE_REQUIRED')
    expect(() => assertClaimMatchesProfile({ ...claim, scopeSha256: 'c'.repeat(64) }, profile, now, claim.scopeSha256)).toThrow('PROFILE_SCOPE_MISMATCH')
    expect(() => assertClaimMatchesProfile({ ...claim, command: 'powershell' }, profile, now)).toThrow('CLAIM_INVALID')
    expect(() => validateCollectorProfile({ ...profile, credentialRef: 'test-access' })).toThrow('CREDENTIAL_REFERENCE_INVALID')
  })

  it('accepts only source evidence receipt fields and a server-shaped contact result', () => {
    const { profile } = fixture()
    const contact = {
      collectorId: 'collector-1', enabled: false, executionEnabled: false,
      scopeSha256: 'd'.repeat(64), profileSha256: profile.profileSha256,
      adapterVersion: COLLECTOR_ADAPTER_VERSION, connected: true, checkedAt: new Date().toISOString(),
    }
    expect(assertContactMatchesProfile(contact, profile)).toBe(contact)
    expect(() => assertContactMatchesProfile({ ...contact, publisherUrl: 'https://attacker.example' }, profile)).toThrow('CONTACT_INVALID')
    expect(validateReceiptPayload({
      attemptId: 'attempt-1', fence: 1, sequence: 1, kind: 'capture',
      capturedAt: new Date().toISOString(), sourceSha256: 'e'.repeat(64), counts: { dealerMailRows: 10 },
    }).kind).toBe('capture')
    expect(() => validateReceiptPayload({ attemptId: 'attempt-1', fence: 1, sequence: 1, kind: 'publication' })).toThrow('RECEIPT_INVALID')
    expect(() => validateReceiptPayload({ attemptId: 'attempt-1', fence: 1, sequence: 1, kind: 'failure', code: 'raw: cookie' })).toThrow('RECEIPT_INVALID')
    expect(collectorHostInternals.receiptFailureCode('DEALERMAIL_SESSION_REQUIRED')).toBe('NEEDS_SIGN_IN')
    expect(() => validateReceiptPayload({ attemptId: 'attempt-1', fence: 1, sequence: 1, kind: 'failure', code: 'DEALERMAIL_SESSION_REQUIRED' })).toThrow('RECEIPT_INVALID')
  })

  it('uses only bounded same-origin HTTPS collector routes and fixed Access headers', async () => {
    const { profile } = fixture()
    const calls: any[] = []
    const fetchImpl = async (url: URL, options: any) => {
      calls.push({ url, options })
      return { status: 204, ok: true, text: async () => '' }
    }
    const result = await collectorRequest(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, '/api/collector/claim', {
      body: {}, idempotencyKey: 'key-1', fetchImpl: fetchImpl as any,
    })
    expect(result.status).toBe(204)
    expect(calls[0].url.href).toBe(profile.controlPlaneOrigin + '/api/collector/claim')
    expect(calls[0].options.redirect).toBe('error')
    expect(calls[0].options.headers).toMatchObject({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret', 'Idempotency-Key': 'key-1' })
    await expect(collectorRequest(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, '/api/collector/claim?url=https://attacker.example', { fetchImpl: fetchImpl as any })).rejects.toThrow('COLLECTOR_ROUTE_INVALID')
  })

  it('accepts only the exact publication verification projection and aggregate counts', async () => {
    const { profile } = fixture()
    const publication = {
      attemptId: 'attempt-1', fence: 1, configSha256: 'b'.repeat(64), idempotencyKey: 'idempotency-key',
      envelope: { bundleSha256: 'a'.repeat(64), reportDate: '2026-10-09', ciphertext: 'synthetic' },
    }
    const responseBody = {
      status: 'published_verified', attemptId: publication.attemptId, bundleSha256: publication.envelope.bundleSha256,
      reportDate: publication.envelope.reportDate, counts: { inventory: 1, managerDispositions: 0, transfers: 0, attention: 0 },
      ready: true, verifiedAt: new Date().toISOString(),
    }
    const fetchImpl = async () => ({ status: 200, ok: true, text: async () => JSON.stringify(responseBody) })
    await expect(submitCollectorPublication(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, publication, { fetchImpl: fetchImpl as any })).resolves.toMatchObject({ status: 'published_verified' })
    const unsafeFetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ ...responseBody, vinList: ['synthetic'] }) })
    await expect(submitCollectorPublication(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, publication, { fetchImpl: unsafeFetch as any })).rejects.toThrow('PUBLICATION_RESPONSE_INVALID')
  })

  it('accepts only the exact bound non-ready revision retry projection', async () => {
    const { profile } = fixture()
    const publication = { attemptId: 'attempt-1', fence: 1, configSha256: 'b'.repeat(64), idempotencyKey: 'idempotency-key', envelope: { bundleSha256: 'a'.repeat(64), reportDate: '2026-10-09', ciphertext: 'synthetic' } }
    const responseBody = { status: 'revision_retryable', attemptId: publication.attemptId, bundleSha256: publication.envelope.bundleSha256, reportDate: publication.envelope.reportDate, ready: false }
    const reply = (body: any) => async () => ({ status: 200, ok: true, text: async () => JSON.stringify(body) })
    await expect(submitCollectorPublication(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, publication, { fetchImpl: reply(responseBody) as any })).resolves.toEqual(responseBody)
    for (const body of [{ ...responseBody, ready: true }, { ...responseBody, atomicRollback: true }, { ...responseBody, bundleSha256: 'b'.repeat(64) }, { ...responseBody, reportDate: '2026-10-08' }, { ...responseBody, attemptId: 'other-attempt' }]) {
      await expect(submitCollectorPublication(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, publication, { fetchImpl: reply(body) as any })).rejects.toThrow(/PUBLICATION_RESPONSE_(INVALID|MISMATCH)/)
    }
  })

  it('rejects an oversized publication wrapper before making any POST', async () => {
    const { profile } = fixture()
    const maxBytes = 25 * 1024 * 1024
    const publication: any = {
      attemptId: 'attempt-1', fence: 1, configSha256: 'b'.repeat(64), idempotencyKey: 'idempotency-key',
      envelope: { bundleSha256: 'a'.repeat(64), reportDate: '2026-10-09', ciphertext: '' },
    }
    const envelopeBytes = Buffer.byteLength(JSON.stringify(publication.envelope))
    publication.envelope.ciphertext = 'x'.repeat(maxBytes - envelopeBytes - 1)
    expect(Buffer.byteLength(JSON.stringify(publication.envelope))).toBeLessThanOrEqual(maxBytes)
    const calls: any[] = []
    let requestStarted = false
    const fetchImpl = async (...args: any[]) => { calls.push(args); return new Response('{}') }
    await expect(submitCollectorPublication(profile, { accessClientId: 'id', accessClientSecret: 'secret' }, publication, {
      fetchImpl: fetchImpl as any, onRequestStarted: () => { requestStarted = true },
    })).rejects.toThrow('REQUEST_TOO_LARGE')
    expect(calls).toHaveLength(0)
    expect(requestStarted).toBe(false)
  })

  it('runs the host protocol through the actual collector API and signed tenant publication fixture', async () => {
    const fixture = await createSyntheticCollector()
    try {
      const groupId = fixture.machine.common_name.replace(/\.collector\.access$/, '')
      const revision = fixture.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
      await saveDataControl(fixture.env, COLLECTOR_OWNER, groupId, 'pulls', {
        operation: 'request', connectionId: fixture.dealers[0].connectionId,
        reason: 'Synthetic host bridge test', expectedRevision: revision,
      }, 'host-bridge-request')
      const profile: any = {
        profileId: 'synthetic-holds-four-store', profileSha256: fixture.profileSha256,
        groupId, credentialRef: 'CREDENTIAL_SYNTHETIC_MAIL',
        controlPlaneOrigin: 'https://inventory-admin-staging.joegallant.me',
        stores: fixture.dealers.map((dealer: any) => ({ dealershipId: dealer.id, storeKey: dealer.storeKey, connectionId: dealer.connectionId })),
      }
      const credentials = { accessClientId: 'synthetic-access-id', accessClientSecret: 'synthetic-access-secret' }
      const fetchImpl = (async (url: URL, options: RequestInit) => handleCollectorApi(new Request(url, options), fixture.env, fixture.machine, COLLECTOR_SYNTHETIC_NOW)) as any
      const contactResponse = await collectorRequest(profile, credentials, '/api/collector/contact', {
        body: { profileSha256: profile.profileSha256, adapterVersion: COLLECTOR_ADAPTER_VERSION }, fetchImpl,
      })
      const contact = assertContactMatchesProfile(contactResponse.body, profile)
      const claimResponse = await collectorRequest(profile, credentials, '/api/collector/claim', {
        body: {}, idempotencyKey: 'synthetic-host-claim-key', fetchImpl,
      })
      const claim = assertClaimMatchesProfile(claimResponse.body, profile, COLLECTOR_SYNTHETIC_NOW, contact.scopeSha256)
      expect(claim.baselineBundleSha256).toBe(fixture.baseline.bundleSha256)
      await collectorRequest(profile, credentials, '/api/collector/receipts', {
        body: validateReceiptPayload({
          attemptId: claim.attemptId, fence: claim.fence, sequence: 1, kind: 'capture',
          capturedAt: COLLECTOR_SYNTHETIC_NOW.toISOString(), sourceSha256: fixture.bundle.release.sourceRuns.dealerMail.sha256,
          counts: { dealerMailRows: 8 },
        }), fetchImpl,
      })
      const candidate = structuredClone(fixture.bundle)
      candidate.release.completedAt = COLLECTOR_SYNTHETIC_NOW.toISOString()
      candidate.createdAt = COLLECTOR_SYNTHETIC_NOW.toISOString()
      const envelope = encryptBundle(candidate, fixture.key)
      const result = await submitCollectorPublication(profile, credentials, {
        attemptId: claim.attemptId, fence: claim.fence, configSha256: claim.configSha256,
        idempotencyKey: 'synthetic-host-publication-key', envelope,
      }, { fetchImpl })
      expect(result).toMatchObject({ status: 'published_verified', bundleSha256: envelope.bundleSha256, ready: true })
      expect(fixture.tenant.prepare('SELECT bundle_sha256 FROM cloud_release_versions WHERE status=\'current\'').get().bundle_sha256).toBe(envelope.bundleSha256)
    } finally { fixture.close() }
  })

  it('fails closed without a matching installed dependency hash or an already-open DealerMail tab', async () => {
    const { profile } = fixture()
    expect(checkCollectorDependencies(profile)).toHaveLength(3)
    expect(() => checkCollectorDependencies({ ...profile, dependencyHashes: { ...profile.dependencyHashes, snapshotBuilder: '0'.repeat(64) } })).toThrow('ADAPTER_DEPENDENCY_MISSING')
    let spawned = false
    const capture = makeDealerMailCapture(profile, {
      fetchImpl: async () => ({ ok: true, json: async () => [{ url: 'https://example.com/' }] }) as any,
      spawnImpl: (() => { spawned = true; throw new Error('must not spawn') }) as any,
    })
    await expect(capture({ reportDate: collectorHostInternals.reportDateNow() })).rejects.toThrow('DEALERMAIL_SESSION_REQUIRED')
    expect(spawned).toBe(false)
  })

  it('rejects a nested Ford fallback imported by the fixed snapshot builder', () => {
    const { root, profile } = fixture()
    const builderPath = path.join(root, 'work/build_v2_snapshot.mjs')
    const helperPath = path.join(root, 'work/snapshot-helper.mjs')
    const builder = "import './snapshot-helper.mjs'\nexport const buildSnapshot = () => true\n"
    writeFileSync(builderPath, builder)
    writeFileSync(helperPath, "export const runFallback = () => fetch('https://www.fordtechservice.dealerconnection.com/oasis/run')\n")
    profile.dependencyHashes.snapshotBuilder = createHash('sha256').update(builder).digest('hex')
    profile.profileSha256 = profileFingerprint(profile)
    expect(() => makeDealerMailCapture(profile)).toThrow('ADAPTER_DEPENDENCY_MISSING')
  })

  it('rejects literal dynamic imports so helper reachability stays fingerprinted', () => {
    const { root, profile } = fixture()
    writeFileSync(path.join(root, 'work/build_v2_snapshot.mjs'), "await import('./snapshot-helper.mjs')\n")

    expect(() => profileFingerprint(profile)).toThrow('ADAPTER_DEPENDENCY_MISSING')
  })

  it('admits only the reviewed LF and CRLF shared CDP helper bytes and fingerprints installed bytes', () => {
    const { root, profile } = fixture()
    const capturePath = path.join(root, 'apps/inventory-ops/scripts/capture-dealermail.mjs')
    const helperPath = path.join(root, 'apps/inventory-ops/scripts/lib/cdp.mjs')
    mkdirSync(path.dirname(helperPath), { recursive: true })
    const capture = "import './lib/cdp.mjs'\nconst ORIGIN = 'https://www.dealermail.com'\n"
    const helper = readFileSync(new URL('../../scripts/lib/cdp.mjs', import.meta.url))
    const helperCrlf = Buffer.from(helper.toString('utf8').replace(/\r?\n/g, '\r\n'))
    expect(createHash('sha256').update(helper).digest('hex')).toBe('fd013e76571cbaa2197d1c071d11ba308b7f8d772b3227e9e16c6b627ba5188d')
    expect(createHash('sha256').update(helperCrlf).digest('hex')).toBe('6e9d5a8f2e9c93124fb8e1e7bab6a07e4d933daf99808bb8c6d127406acd031d')
    writeFileSync(capturePath, capture)
    writeFileSync(helperPath, helper)
    profile.dependencyHashes.dealermailCapture = createHash('sha256').update(capture).digest('hex')
    profile.profileSha256 = profileFingerprint(profile)

    expect(checkCollectorDependencies(profile)).toHaveLength(3)
    const lfFingerprint = profileFingerprint(profile)
    writeFileSync(helperPath, helperCrlf)
    profile.profileSha256 = profileFingerprint(profile)
    expect(checkCollectorDependencies(profile)).toHaveLength(3)
    const crlfFingerprint = profileFingerprint(profile)
    expect(crlfFingerprint).not.toBe(lfFingerprint)

    const priorHelper = Buffer.from(helper.toString('utf8').replace(
      '  let list\n  try { list = await targets() } catch { return 0 }',
      '  const list = await targets()',
    ))
    expect(createHash('sha256').update(priorHelper).digest('hex')).toBe('54d171972ef3200b0abc77e77c5404b23109d1188d67e8e5b089bd360ce56c90')
    const priorHelperCrlf = Buffer.from(priorHelper.toString('utf8').replace(/\r?\n/g, '\r\n'))
    expect(createHash('sha256').update(priorHelperCrlf).digest('hex')).toBe('e542c222ef3ebeb8bbe358f15ae2fe00424fddc92efe6139d1e40add58ee9005')
    writeFileSync(helperPath, priorHelper)
    profile.profileSha256 = profileFingerprint(profile)
    expect(checkCollectorDependencies(profile)).toHaveLength(3)
    writeFileSync(helperPath, priorHelperCrlf)
    profile.profileSha256 = profileFingerprint(profile)
    expect(checkCollectorDependencies(profile)).toHaveLength(3)
    writeFileSync(helperPath, helper)
    profile.profileSha256 = profileFingerprint(profile)

    writeFileSync(helperPath, Buffer.concat([helperCrlf, Buffer.from('\r\n// synthetic graph change\r\n')]))
    profile.profileSha256 = profileFingerprint(profile)
    expect(() => checkCollectorDependencies(profile)).toThrow('ADAPTER_DEPENDENCY_MISSING')
    writeFileSync(helperPath, Buffer.from(helper.toString('utf8').replace(
      'https://www.fordtechservice.dealerconnection.com/VehicleService/Details',
      'https://www.extra-forbidden-host.pts.com/source',
    )))
    profile.profileSha256 = profileFingerprint(profile)
    expect(() => checkCollectorDependencies(profile)).toThrow('ADAPTER_DEPENDENCY_MISSING')
  })

  it('blocks before contacting the platform or touching source tabs when the verified baseline is absent', async () => {
    const { root } = fixture()
    let remoteCalls = 0
    let credentialCalls = 0
    const previousRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
    try {
      const result = await runOnce({
        profileName: COLLECTOR_PROFILE_NAME,
        profileDirectory: path.join(root, 'runtime/collector/profiles'),
        fetchImpl: (async () => { remoteCalls += 1; throw new Error('network should not be called') }) as any,
        credentialReader: (() => { credentialCalls += 1; throw new Error('credentials should not be read') }) as any,
      })
      expect(result).toEqual({ status: 'blocked', code: 'BASELINE_REQUIRED' })
      expect(remoteCalls).toBe(0)
      expect(credentialCalls).toBe(0)
    } finally {
      if (previousRoot === undefined) delete process.env.BOB_MAXEY_WORKSPACE_ROOT
      else process.env.BOB_MAXEY_WORKSPACE_ROOT = previousRoot
    }
  })

  it('persists a claim idempotency key across transport uncertainty and clears only the matching key', () => {
    const { root, profile } = fixture()
    const first = getOrCreateClaimIdempotencyKey(root, profile.profileSha256)
    expect(getOrCreateClaimIdempotencyKey(root, profile.profileSha256)).toBe(first)
    expect(() => getOrCreateClaimIdempotencyKey(root, '0'.repeat(64))).toThrow('RECONCILIATION_REQUIRED')
    expect(() => clearPendingClaimIdempotencyKey(root, profile.profileSha256, '0'.repeat(36))).toThrow('RECONCILIATION_REQUIRED')
    clearPendingClaimIdempotencyKey(root, profile.profileSha256, first)
    expect(getOrCreateClaimIdempotencyKey(root, profile.profileSha256)).not.toBe(first)
  })

  it('keeps an exact publication candidate discoverable after an uncertain response', () => {
    const { root, profile } = fixture()
    const artifacts = privateAttemptArtifacts(root, 'attempt-pending')
    mkdirSync(artifacts.directory, { recursive: true })
    writeFileSync(artifacts.candidatePath, JSON.stringify({ reportDate: '2026-10-09', marker: 'synthetic' }))
    writeFileSync(artifacts.manifestPath, JSON.stringify({ reportDate: '2026-10-09', marker: 'synthetic' }))
    writeFileSync(artifacts.dealerMailPath, JSON.stringify({ reportDate: '2026-10-09', marker: 'synthetic' }))
    writeFileSync(artifacts.envelopePath, JSON.stringify({ reportDate: '2026-10-09', bundleSha256: 'a'.repeat(64), ciphertext: 'synthetic' }))
    saveAttemptState(artifacts.statePath, {
      attemptId: 'attempt-pending', fence: 2, reportDate: '2026-10-09', profileSha256: profile.profileSha256,
      configSha256: 'b'.repeat(64), bundleSha256: 'a'.repeat(64), publicationIdempotencyKey: '12345678-1234-4234-8234-123456789012',
      publicationPending: true, reconciliationRequired: true,
    })
    expect(findPendingPublication(root)).toMatchObject({ state: { attemptId: 'attempt-pending' }, envelope: { ciphertext: 'synthetic' } })
  })

  it('cancels only its owned capture child and excludes collector credentials from its environment', async () => {
    const { root, profile } = fixture()
    const childEnv = adapterInternals.childEnvironment(profile)
    expect(childEnv).not.toHaveProperty('CF_ACCESS_CLIENT_SECRET')
    expect(childEnv).not.toHaveProperty('INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64')
    const controller = new AbortController()
    const child = adapterInternals.runOwnedChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: root, profile, signal: controller.signal, timeoutMs: 3000,
    })
    setTimeout(() => controller.abort(), 40)
    await expect(child).rejects.toThrow('LEASE_STOPPED')
  })

  it('waits for an owned child close before returning to rollback after cancellation', async () => {
    const { root, profile } = fixture()
    const marker = path.join(root, 'late-child-write.txt')
    const childSource = `process.on('SIGTERM', () => setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'finished'); process.exit(0) }, 150)); process.stdout.write('ready'); setInterval(() => {}, 1000)`
    const controller = new AbortController()
    const startedAt = Date.now()
    const child = adapterInternals.runOwnedChild(process.execPath, ['-e', childSource], {
      cwd: root, profile, signal: controller.signal, timeoutMs: 3000,
      onChild: childProcess => childProcess.stdout.once('data', () => controller.abort()),
    })

    await expect(child).rejects.toThrow('LEASE_STOPPED')
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(120)
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toBe('finished')
  })

  it('removes the daemon abort listener after a poll wait completes', async () => {
    const { root } = fixture()
    const controller = new AbortController()
    const before = getEventListeners(controller.signal, 'abort').length
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any)
    try {
      const running = runDaemon({
        profileName: COLLECTOR_PROFILE_NAME,
        profileDirectory: path.join(root, 'runtime/collector/profiles'),
        pollIntervalMs: 30_000,
        signal: controller.signal,
        credentialReader: (() => { throw new Error('baseline gate should run first') }) as any,
      })
      setTimeout(() => controller.abort(), 40)
      expect(await running).toEqual([{ status: 'blocked', code: 'BASELINE_REQUIRED' }])
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(before)
    } finally { write.mockRestore() }
  })
})
