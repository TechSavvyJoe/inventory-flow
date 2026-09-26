// @ts-nocheck -- the publisher is plain ESM; fixtures are synthetic only.
// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { cloudBundleSha256, cloudReleaseFrom } from '../../scripts/publish-cloud-release.mjs'
import { acquirePublicationLock, assertExpectedSourceHashes, assertInheritedPublicationLock, main, publicationFailureMessage, publicationReconciliationPath, readPublicationReconciliation, receiptSourceHashes, reconcilePendingPublication, releasePublicationLock, reportDate, syncCloudRelease, verifyPublishedRelease, writePublicationReconciliation, writeReceipt } from '../../scripts/sync-cloud-release.mjs'

const environment = { INVENTORY_OPS_CLOUD_URL:'https://inventory-ops.joegallant.me', INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64:Buffer.alloc(32, 7).toString('base64'), CF_ACCESS_CLIENT_ID:'synthetic', CF_ACCESS_CLIENT_SECRET:'synthetic', INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN:'synthetic' }
const now = new Date('2026-08-30T15:00:00Z')
function fixture() {
  const bundle = buildSyntheticCloudBundle()
  const expected = validateReleaseBundle(bundle)
  const envelope = {reportDate:bundle.reportDate,bundleSha256:'a'.repeat(64)}
  return {bundle,expected,envelope,status:{ready:true,reportDate:bundle.reportDate,bundleSha256:envelope.bundleSha256,metadata:expected},readiness:{ready:true,reportDate:bundle.reportDate,bundleSha256:envelope.bundleSha256,counts:{inventory:expected.activeInventoryCount,managerDispositions:expected.managerDispositionRecordCount},bootstrapBytes:100}}
}
describe('verified daily cloud publication',()=>{
  it('keeps the raw manager binding separate from the sanitized overlay hash',()=>{
    const release={sourceRuns:{managerDisposition:{sha256:'a'.repeat(64),metadata:{boundSourceSha256:'B'.repeat(64)}}}}
    expect(receiptSourceHashes(release)).toMatchObject({managerDisposition:'a'.repeat(64),managerDispositionBinding:'B'.repeat(64)})
  })
  it('rechecks all receipt-bound source hashes immediately before a hold publication',()=>{
    const {bundle}=fixture()
    const expected=receiptSourceHashes(bundle.release)
    expect(assertExpectedSourceHashes(bundle.release,{INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON:JSON.stringify(expected)})).toBe(true)
    expect(()=>assertExpectedSourceHashes(bundle.release,{INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON:JSON.stringify({...expected,public:'f'.repeat(64)})})).toThrow('HOLD_REFRESH_SOURCE_BINDING_MISMATCH')
    expect(()=>assertExpectedSourceHashes(bundle.release,{INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON:JSON.stringify({public:expected.public})})).toThrow('HOLD_REFRESH_SOURCE_BINDINGS_INVALID')
  })
  it('uses the New York date across UTC midnight',()=>expect(reportDate(new Date('2026-09-10T02:00:00Z'))).toBe('2026-09-09'))
  it('requires exact content as well as date and aggregate/store counts',()=>{
    const data=fixture()
    expect(verifyPublishedRelease(data).publicRowCount).toBe(data.expected.publicRowCount)
    expect(()=>verifyPublishedRelease({...data,status:{...data.status,bundleSha256:'b'.repeat(64)}})).toThrow('CLOUD_CONTENT_MISMATCH')
    // Equal-date/equal-count readiness from a racing publication is not proof
    // that the exact intended release was loaded by the application.
    expect(()=>verifyPublishedRelease({...data,readiness:{...data.readiness,bundleSha256:'b'.repeat(64)}})).toThrow('CLOUD_READINESS_CONTENT_MISMATCH')
    expect(()=>verifyPublishedRelease({...data,status:{...data.status,metadata:{...data.expected,heldVinCount:999}}})).toThrow('CLOUD_COUNT_MISMATCH')
    expect(()=>verifyPublishedRelease({...data,status:{...data.status,metadata:{...data.expected,crmStoreCounts:{}}}})).toThrow('CLOUD_STORE_COUNT_MISMATCH')
    expect(()=>verifyPublishedRelease({...data,readiness:{...data.readiness,counts:{inventory:0}}})).toThrow('APP_READ_MODEL_MISMATCH')
    expect(()=>verifyPublishedRelease({...data,readiness:{...data.readiness,ready:false}})).toThrow('CLOUD_NOT_READY')
    expect(()=>verifyPublishedRelease({...data,readiness:{...data.readiness,reportDate:'2026-08-29'}})).toThrow('CLOUD_DATE_MISMATCH')
  })
  it('verifies the optional resource channel counts and records them on the receipt',()=>{
    const data=fixture()
    // A deployed Worker that dropped one optional channel still reports ready.
    for(const field of ['fordOasisRecordCount','warrantyCheckRecordCount']){
      expect(()=>verifyPublishedRelease({...data,status:{...data.status,metadata:{...data.expected,[field]:999}}})).toThrow('CLOUD_COUNT_MISMATCH')
      expect(verifyPublishedRelease(data)[field]).toBe(data.expected[field])
    }
  })
  it('rejects stale or incomplete sources before any network call',async()=>{
    const {bundle}=fixture()
    const fetchImpl=()=>{throw Error('Should not call network')}
    await expect(syncCloudRelease({release:bundle.release,environment,fetchImpl,now:new Date('2026-08-31T15:00:00Z')})).rejects.toThrow('NO_COMPLETED_CURRENT_DAY_RELEASE')
    const release=structuredClone(bundle.release); release.sourceRuns.dealerMail.status='stale'
    await expect(syncCloudRelease({release,environment,fetchImpl,now})).rejects.toThrow('SOURCE_NOT_CURRENT')
  })
  it('checks independent status/readiness after idempotent publication and records no customer data',async()=>{
    const {bundle,expected}=fixture(); let hash; const routes=[]
    const fetchImpl=async(url,options)=>{
      const route=new URL(url).pathname;routes.push(route)
      expect(options.redirect).toBe('error')
      if(route==='/internal/releases') {hash=JSON.parse(options.body).bundleSha256;return Response.json({status:'already_published',reportDate:bundle.reportDate})}
      if(route==='/internal/status') return Response.json({ready:true,reportDate:bundle.reportDate,bundleSha256:hash,metadata:expected})
      return Response.json({ready:true,reportDate:bundle.reportDate,bundleSha256:hash,counts:{inventory:expected.activeInventoryCount,managerDispositions:expected.managerDispositionRecordCount},bootstrapBytes:123})
    }
    const receipt=await syncCloudRelease({release:bundle.release,environment,fetchImpl,now})
    expect(routes.sort()).toEqual(['/internal/readiness','/internal/releases','/internal/status'])
    expect(receipt).toMatchObject({
      complete:true,
      status:'published_and_verified',
      bundleSha256:hash,
      counts:{managerDispositionRecordCount:expected.managerDispositionRecordCount},
      validation:{managerDispositionBound:true},
      sourceHashes:{
        managerDisposition:bundle.release.sourceRuns.managerDisposition?.sha256??null,
        managerDispositionBinding:bundle.release.sourceRuns.managerDisposition?.metadata?.boundSourceSha256??null,
      },
    })
    expect(JSON.stringify(receipt)).not.toMatch(/customer|reasonRaw|synthetic@example|CF-Access/)
    const dir=mkdtempSync(path.join(os.tmpdir(),'inventory-sync-'))
    try {
      const target=writeReceipt(dir,receipt), before=readFileSync(target,'utf8')
      expect(()=>writeReceipt(dir,{...receipt,complete:false})).toThrow('INVALID_PUBLICATION_RECEIPT')
      expect(readFileSync(target,'utf8')).toBe(before)
      expect(()=>writeReceipt(dir,{...receipt,reportDate:'../../unsafe'})).toThrow('INVALID_PUBLICATION_RECEIPT')
    } finally {rmSync(dir,{recursive:true,force:true})}
  })
  it('requeries the exact candidate hash after a transient verification lookup failure',async()=>{
    const {bundle,expected}=fixture(); let hash; let statusCalls=0; let readinessCalls=0
    const fetchImpl=async(url,options)=>{
      const route=new URL(url).pathname
      if(route==='/internal/releases') {hash=JSON.parse(options.body).bundleSha256;return Response.json({status:'published',reportDate:bundle.reportDate})}
      if(route==='/internal/status') {
        statusCalls+=1
        if(statusCalls===1) return Response.json({code:'TEMPORARY'}, {status:503})
        return Response.json({ready:true,reportDate:bundle.reportDate,bundleSha256:hash,metadata:expected})
      }
      readinessCalls+=1
      return Response.json({ready:true,reportDate:bundle.reportDate,bundleSha256:hash,counts:{inventory:expected.activeInventoryCount,managerDispositions:expected.managerDispositionRecordCount},bootstrapBytes:123})
    }

    const receipt=await syncCloudRelease({release:bundle.release,environment,fetchImpl,now})

    expect(receipt).toMatchObject({status:'published_and_verified',bundleSha256:hash})
    expect(statusCalls).toBe(2)
    expect(readinessCalls).toBe(2)
  })
  it('reports an unknown publication outcome when an accepted candidate cannot be reverified',async()=>{
    const {bundle}=fixture(); let publicationCalls=0; let verificationCalls=0
    const fetchImpl=async(url)=>{
      const route=new URL(url).pathname
      if(route==='/internal/releases') {
        publicationCalls+=1
        return Response.json({status:'published',reportDate:bundle.reportDate})
      }
      verificationCalls+=1
      return Response.json({code:'TEMPORARY'}, {status:503})
    }

    let failure
    try {
      await syncCloudRelease({release:bundle.release,environment,fetchImpl,now})
    } catch (error) {
      failure=error
    }
    expect(failure).toMatchObject({
      message:'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      bundleSha256:expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(publicationFailureMessage(failure)).toContain(`candidate_bundle_sha256=${failure.bundleSha256}`)
    expect(publicationFailureMessage(failure)).not.toContain('were preserved')
    expect(publicationCalls).toBe(1)
    expect(verificationCalls).toBe(4)
  })

  it('classifies a lost POST response as outcome unknown with the exact transmitted envelope hash',async()=>{
    const {bundle}=fixture(); let postedHash
    const fetchImpl=async(url,options)=>{
      if(new URL(url).pathname==='/internal/releases') {
        postedHash=JSON.parse(options.body).bundleSha256
        throw new TypeError('synthetic response lost after request transmission')
      }
      throw new Error('verification must not run without a POST response')
    }
    let failure
    try {
      await syncCloudRelease({release:bundle.release,environment,fetchImpl,now})
    } catch (error) {
      failure=error
    }

    expect(failure).toMatchObject({
      message:'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      bundleSha256:postedHash,
    })
    expect(publicationFailureMessage(failure)).toContain(`candidate_bundle_sha256=${postedHash}`)
  })

  it('persists an exact cross-date reconciliation marker before an ambiguous publisher exits and blocks the next attempt', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-main-'))
    const { bundle } = fixture()
    try {
      let postedHash
      const ambiguousPostWriteResponse = async (_url, options) => {
        postedHash = JSON.parse(options.body).bundleSha256
        expect(readPublicationReconciliation(workspaceRoot)).toMatchObject({
          failureCode: 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS',
          candidate: { bundleSha256: postedHash },
        })
        return Response.json({ code: 'PUBLISH_CONFLICT_RETRY' }, { status: 409 })
      }
      await expect(main({ workspaceRoot, environment, fetchImpl: ambiguousPostWriteResponse, now, loadRelease: () => bundle.release }))
        .rejects.toThrow('CLOUD_PUBLICATION_OUTCOME_UNKNOWN')

      const state = readPublicationReconciliation(workspaceRoot)
      expect(state).toMatchObject({
        schemaVersion: 1,
        status: 'publication_reconciliation_required',
        reconciliationRequired: true,
        reportDate: bundle.reportDate,
        failureCode: 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS',
        candidate: { bundleSha256: postedHash },
      })
      expect(state.candidate.sourceHashes).toMatchObject({
        public: expect.stringMatching(/^[a-f0-9]{64}$/),
        dealerMail: expect.stringMatching(/^[a-f0-9]{64}$/),
        resources: expect.stringMatching(/^[a-f0-9]{64}$/),
      })

      let retriedNetwork = false
      await expect(main({
        workspaceRoot,
        environment,
        now: new Date('2026-08-31T15:00:00Z'),
        fetchImpl: async () => { retriedNetwork = true; throw new Error('must remain blocked') },
        loadRelease: () => { throw new Error('must not load a new release') },
      })).rejects.toThrow('PUBLICATION_RECONCILIATION_REQUIRED')
      expect(retriedNetwork).toBe(false)
    } finally { rmSync(workspaceRoot, { recursive: true, force: true }) }
  })

  it('refuses the network call when the durable pre-POST marker cannot be recorded', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-marker-failure-'))
    const { bundle } = fixture()
    try {
      const fetchImpl = vi.fn()
      await expect(main({
        workspaceRoot,
        environment,
        fetchImpl,
        now,
        loadRelease: () => bundle.release,
        writeReconciliation: () => { throw new Error('synthetic durable marker failure') },
      })).rejects.toThrow('synthetic durable marker failure')
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally { rmSync(workspaceRoot, { recursive: true, force: true }) }
  })

  it('archives the pre-POST guard only for a definite no-commit rejection', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-definite-rejection-'))
    const { bundle } = fixture()
    try {
      const fetchImpl = vi.fn().mockResolvedValue(Response.json({ code: 'OLDER_RELEASE_REJECTED' }, { status: 409 }))
      await expect(main({ workspaceRoot, environment, fetchImpl, now, loadRelease: () => bundle.release }))
        .rejects.toThrow('Cloud release publish failed (409: OLDER_RELEASE_REJECTED)')
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(existsSync(publicationReconciliationPath(workspaceRoot))).toBe(false)
      const archiveDirectory = path.join(workspaceRoot, 'work', 'app-feed-status', 'reconciled')
      expect(readdirSync(archiveDirectory)).toEqual([
        expect.stringContaining(`definitely-rejected-${cloudBundleSha256(cloudReleaseFrom(bundle.release))}.json`),
      ])
    } finally { rmSync(workspaceRoot, { recursive: true, force: true }) }
  })

  it('archives the guard after exact verification and a flushed verified receipt', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-success-'))
    const { bundle, expected } = fixture()
    try {
      let postedHash
      const fetchImpl = async (url, options) => {
        const route = new URL(url).pathname
        if (route === '/internal/releases') {
          postedHash = JSON.parse(options.body).bundleSha256
          expect(readPublicationReconciliation(workspaceRoot)?.candidate.bundleSha256).toBe(postedHash)
          return Response.json({ status: 'published', reportDate: bundle.reportDate })
        }
        if (route === '/internal/status') return Response.json({ ready: true, reportDate: bundle.reportDate, bundleSha256: postedHash, metadata: expected })
        return Response.json({ ready: true, reportDate: bundle.reportDate, bundleSha256: postedHash, counts: { inventory: expected.activeInventoryCount, managerDispositions: expected.managerDispositionRecordCount }, bootstrapBytes: 100 })
      }

      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      try {
        await main({ workspaceRoot, environment, fetchImpl, now, loadRelease: () => bundle.release })
      } finally {
        output.mockRestore()
      }

      expect(existsSync(publicationReconciliationPath(workspaceRoot))).toBe(false)
      expect(JSON.parse(readFileSync(path.join(workspaceRoot, 'work', 'app-feed-status', `${bundle.reportDate}.json`), 'utf8')))
        .toMatchObject({ status: 'published_and_verified', bundleSha256: postedHash })
      expect(readdirSync(path.join(workspaceRoot, 'work', 'app-feed-status', 'reconciled')))
        .toEqual([expect.stringContaining(`verified-${postedHash}.json`)])
    } finally { rmSync(workspaceRoot, { recursive: true, force: true }) }
  })

  it('records verified-receipt write failure and only clears it after exact protected hash reconciliation', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-receipt-'))
    const { bundle, expected } = fixture()
    try {
      const receiptDirectory = path.join(workspaceRoot, 'work', 'app-feed-status', `${bundle.reportDate}.json`)
      mkdirSync(receiptDirectory, { recursive: true })
      let postedHash
      const publishFetch = async (url, options) => {
        const route = new URL(url).pathname
        if (route === '/internal/releases') {
          postedHash = JSON.parse(options.body).bundleSha256
          return Response.json({ status: 'published', reportDate: bundle.reportDate })
        }
        if (route === '/internal/status') return Response.json({ ready: true, reportDate: bundle.reportDate, bundleSha256: postedHash, metadata: expected })
        return Response.json({ ready: true, reportDate: bundle.reportDate, bundleSha256: postedHash, counts: { inventory: expected.activeInventoryCount, managerDispositions: expected.managerDispositionRecordCount }, bootstrapBytes: 100 })
      }
      await expect(main({ workspaceRoot, environment, fetchImpl: publishFetch, now, loadRelease: () => bundle.release }))
        .rejects.toThrow('CLOUD_PUBLICATION_VERIFIED_RECEIPT_NOT_RECORDED')
      expect(readPublicationReconciliation(workspaceRoot)).toMatchObject({
        failureCode: 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS',
        candidate: { bundleSha256: postedHash },
      })

      rmSync(receiptDirectory, { recursive: true, force: true })
      const mismatchedFetch = async (url) => {
        const route = new URL(url).pathname
        if (route === '/internal/status') return Response.json({ ready: true, reportDate: bundle.reportDate, bundleSha256: 'f'.repeat(64), metadata: expected })
        return Response.json({ ready: true, reportDate: bundle.reportDate, bundleSha256: 'f'.repeat(64), counts: { inventory: expected.activeInventoryCount, managerDispositions: expected.managerDispositionRecordCount }, bootstrapBytes: 100 })
      }
      await expect(reconcilePendingPublication({ workspaceRoot, environment, fetchImpl: mismatchedFetch, now, loadRelease: () => bundle.release }))
        .rejects.toThrow('PUBLICATION_RECONCILIATION_NOT_VERIFIED')
      expect(readPublicationReconciliation(workspaceRoot)).toMatchObject({ candidate: { bundleSha256: postedHash } })

      const reconciled = await reconcilePendingPublication({ workspaceRoot, environment, fetchImpl: publishFetch, now, loadRelease: () => bundle.release })
      expect(reconciled.receipt).toMatchObject({
        status: 'published_and_verified',
        publication: 'reconciled_exact_candidate',
        bundleSha256: postedHash,
      })
      expect(existsSync(publicationReconciliationPath(workspaceRoot))).toBe(false)
      expect(existsSync(reconciled.archivedStatePath)).toBe(true)
      expect(JSON.parse(readFileSync(reconciled.receiptPath, 'utf8'))).toMatchObject({ bundleSha256: postedHash })
    } finally { rmSync(workspaceRoot, { recursive: true, force: true }) }
  })

  it('fails closed on malformed reconciliation state and refuses to replace a different pending candidate', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-reconciliation-'))
    try {
      const sourceHashes = { public: '1'.repeat(64), dealerMail: '2'.repeat(64), resources: '3'.repeat(64), managerDisposition: null, managerDispositionBinding: null }
      writePublicationReconciliation(workspaceRoot, {
        reportDate: '2026-08-30',
        bundleSha256: 'a'.repeat(64),
        failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
        sourceHashes,
        now,
      })
      expect(() => writePublicationReconciliation(workspaceRoot, {
        reportDate: '2026-08-31', bundleSha256: 'b'.repeat(64), failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN', sourceHashes, now,
      })).toThrow('PUBLICATION_RECONCILIATION_STATE_CONFLICT')
      const markerPath = publicationReconciliationPath(workspaceRoot)
      const state = JSON.parse(readFileSync(markerPath, 'utf8'))
      writeFileSync(markerPath, JSON.stringify({ ...state, unexpected: true }))
      expect(() => readPublicationReconciliation(workspaceRoot)).toThrow('PUBLICATION_RECONCILIATION_STATE_INVALID')
    } finally { rmSync(workspaceRoot, { recursive: true, force: true }) }
  })
})

describe('publication writer ownership and crash recovery', () => {
  const directories = []
  afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
  function file() { const directory = mkdtempSync(path.join(os.tmpdir(), 'inventory-sync-lock-')); directories.push(directory); return path.join(directory, '.publication.lock') }
  it('keeps a live or reused PID locked and releases only its own file', () => {
    const target = file(), lock = acquirePublicationLock(target)
    expect(() => acquirePublicationLock(target)).toThrow('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
    expect(readFileSync(target, 'utf8')).toBe(lock.content)
    releasePublicationLock(lock)
    expect(existsSync(target)).toBe(false)
  })
  it('lets a child publisher reuse only the exact outer pipeline-lock owner', () => {
    const target = file(), lock = acquirePublicationLock(target)
    const ownerId = JSON.parse(lock.content).ownerId
    expect(assertInheritedPublicationLock(target, { INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID: ownerId })).toBe(true)
    expect(() => assertInheritedPublicationLock(target, { INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID: 'different-owner' }))
      .toThrow('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
    expect(readFileSync(target, 'utf8')).toBe(lock.content)
    releasePublicationLock(lock)
  })
  it('recovers only a proven exited PID under an exclusive recovery guard', () => {
    const target = file()
    writeFileSync(target, JSON.stringify({ pid: 1999999999, startedAt: '2026-08-30T00:00:00Z' }))
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      expect(pid).toBe(1999999999); expect(signal).toBe(0)
      // A second recovery contender must not delete the first one's target.
      expect(() => acquirePublicationLock(target)).toThrow('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
      throw Object.assign(new Error('Synthetic exited process'), { code: 'ESRCH' })
    })
    const lock = acquirePublicationLock(target)
    expect(JSON.parse(readFileSync(target, 'utf8')).pid).toBe(process.pid)
    expect(existsSync(`${target}.recovery`)).toBe(false)
    releasePublicationLock(lock)
  })
  it.each(['', '{', '{}', '{"pid":0}', '{"pid":-1}', '{"pid":"5"}'])('retains a torn or unknown-owner lock %s for manual review', (content) => {
    const target = file(); writeFileSync(target, content)
    const probe = vi.spyOn(process, 'kill')
    expect(() => acquirePublicationLock(target)).toThrow('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
    expect(readFileSync(target, 'utf8')).toBe(content)
    expect(probe).not.toHaveBeenCalled()
  })
  it('does not treat permission denial or an orphan recovery guard as proof of an exited writer', () => {
    const target = file(), content = JSON.stringify({ pid: 1999999999 })
    writeFileSync(target, content)
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('Synthetic permission denial'), { code: 'EPERM' }) })
    expect(() => acquirePublicationLock(target)).toThrow('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
    expect(readFileSync(target, 'utf8')).toBe(content)
    writeFileSync(`${target}.recovery`, 'ambiguous recovery owner')
    expect(() => acquirePublicationLock(target)).toThrow('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
    expect(readFileSync(`${target}.recovery`, 'utf8')).toBe('ambiguous recovery owner')
  })
})
