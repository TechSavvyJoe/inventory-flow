// @ts-nocheck -- the publisher is plain ESM; fixtures are synthetic only.
// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { acquirePublicationLock, releasePublicationLock, reportDate, syncCloudRelease, verifyPublishedRelease, writeReceipt } from '../../scripts/sync-cloud-release.mjs'

const environment = { INVENTORY_OPS_CLOUD_URL:'https://inventory-ops.joegallant.me', INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64:Buffer.alloc(32, 7).toString('base64'), CF_ACCESS_CLIENT_ID:'synthetic', CF_ACCESS_CLIENT_SECRET:'synthetic', INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN:'synthetic' }
const now = new Date('2026-08-30T15:00:00Z')
function fixture() {
  const bundle = buildSyntheticCloudBundle()
  const expected = validateReleaseBundle(bundle)
  const envelope = {reportDate:bundle.reportDate,bundleSha256:'a'.repeat(64)}
  return {bundle,expected,envelope,status:{ready:true,reportDate:bundle.reportDate,bundleSha256:envelope.bundleSha256,metadata:expected},readiness:{ready:true,reportDate:bundle.reportDate,bundleSha256:envelope.bundleSha256,counts:{inventory:expected.activeInventoryCount,managerDispositions:expected.managerDispositionRecordCount},bootstrapBytes:100}}
}
describe('verified daily cloud publication',()=>{
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
    expect(receipt).toMatchObject({complete:true,status:'published_and_verified',bundleSha256:hash,counts:{managerDispositionRecordCount:expected.managerDispositionRecordCount},validation:{managerDispositionBound:true},sourceHashes:{managerDisposition:bundle.release.sourceRuns.managerDisposition?.sha256??null}})
    expect(JSON.stringify(receipt)).not.toMatch(/customer|reasonRaw|synthetic@example|CF-Access/)
    const dir=mkdtempSync(path.join(os.tmpdir(),'inventory-sync-'))
    try {
      const target=writeReceipt(dir,receipt), before=readFileSync(target,'utf8')
      expect(()=>writeReceipt(dir,{...receipt,complete:false})).toThrow('INVALID_PUBLICATION_RECEIPT')
      expect(readFileSync(target,'utf8')).toBe(before)
      expect(()=>writeReceipt(dir,{...receipt,reportDate:'../../unsafe'})).toThrow('INVALID_PUBLICATION_RECEIPT')
    } finally {rmSync(dir,{recursive:true,force:true})}
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
