// @ts-nocheck -- synthetic actual SQLite, encrypted evidence, R2 and signed RPC.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyntheticCollector, COLLECTOR_OWNER as owner, COLLECTOR_SYNTHETIC_NOW as now } from '../../fixtures/synthetic-collector.mjs'
import { claimCollector, readCollectors, receiptCollector, saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { publishCollector, publicationTicket, publishTenantCandidate, reconcileCollector } from '../../cloudflare/src/collector-publication.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { cloudBundleSha256, encryptBundle } from '../../scripts/publish-cloud-release.mjs'
const fixtures=[]
afterEach(()=>fixtures.splice(0).forEach(f=>f.close()))
const revision=f=>f.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
const setup=async()=>{
 const f=await createSyntheticCollector();fixtures.push(f)
 await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[0].connectionId,reason:'Synthetic refresh',expectedRevision:revision(f)},'request')
 f.attempt=await claimCollector(f.env,f.machine,{},'claim',now)
 await receiptCollector(f.env,f.machine,{attemptId:f.attempt.attemptId,fence:f.attempt.fence,sequence:1,kind:'capture',capturedAt:now.toISOString(),sourceSha256:f.bundle.release.sourceRuns.dealerMail.sha256,counts:{dealerMailRows:8}},now)
 f.candidate=structuredClone(f.bundle);f.candidate.release.completedAt=now.toISOString();f.candidate.createdAt=now.toISOString();f.envelope=encryptBundle(f.candidate,f.key)
 f.input={attemptId:f.attempt.attemptId,fence:f.attempt.fence,configSha256:f.attempt.configSha256,envelope:f.envelope}
 return f
}
describe('Brokered publication and independent tenant receipt',()=>{
 it('actually decrypts, validates, accepts, persists and reads the exact tenant publication; host cannot submit publication receipts',async()=>{
  const f=await setup(),result=await publishCollector(f.env,f.machine,f.input,'publish',now)
  expect(result).toMatchObject({status:'published_verified',bundleSha256:f.envelope.bundleSha256,ready:true,counts:{inventory:8}})
  expect(f.tenant.prepare('SELECT * FROM collector_publication_receipts').get()).toMatchObject({attempt_id:f.attempt.attemptId,bundle_sha256:f.envelope.bundleSha256,status:'published'})
  expect(f.sqlite.prepare("SELECT state FROM platform_pull_requests").get().state).toBe('completed')
  const projection=(await readCollectors(f.env,owner,'synthetic-north',now)).attempts[0]
  expect(projection.publication).toMatchObject({status:'published_and_verified',bundleSha256:f.envelope.bundleSha256,vehicleCount:8})
  await expect(receiptCollector(f.env,f.machine,{attemptId:f.attempt.attemptId,fence:f.attempt.fence,sequence:2,kind:'publication'},now)).rejects.toMatchObject({code:'COLLECTOR_INPUT_INVALID'})
  const publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  expect(await publishCollector(f.env,f.machine,f.input,'same-publish',new Date(now.getTime()+180000))).toMatchObject({status:'published_verified'})
  expect(publish).not.toHaveBeenCalled()
  await expect(publishCollector(f.env,f.machine,{...f.input,envelope:{...f.envelope,bundleSha256:'b'.repeat(64)}},'changed',now)).rejects.toMatchObject({code:'COLLECTOR_RECEIPT_CONFLICT'})
 })
 it('records same current candidate as unchanged only with a new lease-bound tenant receipt',async()=>{
  const f=await setup();f.input.envelope=f.baseline
  expect(await publishCollector(f.env,f.machine,f.input,'unchanged',now)).toMatchObject({status:'unchanged_verified',bundleSha256:f.baseline.bundleSha256})
  expect(f.tenant.prepare('SELECT status FROM collector_publication_receipts').get().status).toBe('unchanged')
 })
 it('treats a timeout after acceptance as unknown, never dispatches again and reconciles only the exact candidate',async()=>{
  const f=await setup(),real=f.env.TENANT_NORTH_PUBLISHER.publish
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{await real(...args);throw new Error('SYNTHETIC_PRIVATE_FAILURE')})
  expect(await publishCollector(f.env,f.machine,f.input,'timeout',now)).toMatchObject({status:'reconciliation_required',ready:false})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
  expect(await publishCollector(f.env,f.machine,f.input,'reconcile',new Date(now.getTime()+180000))).toMatchObject({status:'published_verified'})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind=\'publication\'').get().n).toBe(1)
 })
 it('does not mistake an old same-date publication for success when dispatch never reached the tenant',async()=>{
  const f=await setup();f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async()=>{throw new Error('timeout')})
  expect(await publishCollector(f.env,f.machine,f.input,'timeout',now)).toMatchObject({status:'reconciliation_required'})
  expect(await publishCollector(f.env,f.machine,f.input,'retry',new Date(now.getTime()+180000))).toMatchObject({status:'reconciliation_required',ready:false})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind=\'publication\'').get().n).toBe(0)
 })
 it.each(['public','resource','capture','scope','tenant','signature','fence','revoke'])('rejects altered %s at the tenant boundary and preserves the current baseline',async mode=>{
  const f=await setup()
  if(mode==='public'){f.candidate.release.sourceRuns.public.bytes+=1;f.input.envelope=encryptBundle(f.candidate,f.key)}
  if(mode==='resource'){f.candidate.release.vehicles[0].resourceRecord={fake:'modified'};f.input.envelope={...f.envelope,bundleSha256:cloudBundleSha256(f.candidate)}}
  if(mode==='capture')f.sqlite.prepare('UPDATE platform_collector_attempts SET source_sha256=?').run('b'.repeat(64))
  if(mode==='scope')f.sqlite.prepare("UPDATE platform_data_connections SET oem='ford_lincoln' WHERE id=?").run(f.dealers[1].connectionId)
  if(mode==='tenant')f.tenantEnv.PLATFORM_TENANT_ID='other-group'
  if(mode==='signature')f.tenantEnv.COLLECTOR_PUBLICATION_PUBLIC_KEY='{}'
  if(mode==='fence')f.env.TENANT_NORTH_PUBLISHER.publish=async(envelope,ticket)=>{f.sqlite.prepare('UPDATE platform_collector_attempts SET fence=fence+1').run();return publishTenantCandidate(f.tenantEnv,envelope,ticket,now)}
  if(mode==='revoke')f.env.TENANT_NORTH_PUBLISHER.publish=async(envelope,ticket)=>{await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic concurrent revocation',expectedRevision:revision(f)},'revoke',now);return publishTenantCandidate(f.tenantEnv,envelope,ticket,now)}
  try{await publishCollector(f.env,f.machine,f.input,'guard',now)}catch(error){expect(error.status).toBeGreaterThanOrEqual(400)}
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it('revoked hosts cannot reconcile, but owner read-only reconciliation preserves an already accepted publication',async()=>{
  const f=await setup(),real=f.env.TENANT_NORTH_PUBLISHER.publish
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{await real(...args);throw new Error('lost reply')}
  await publishCollector(f.env,f.machine,f.input,'publish',now)
  await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoke after dispatch',expectedRevision:revision(f)},'revoke',now)
  await expect(publishCollector(f.env,f.machine,f.input,'machine-reconcile',now)).rejects.toMatchObject({code:'COLLECTOR_REVOKED'})
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:f.attempt.attemptId},now)).toMatchObject({status:'published_verified'})
 })
 it('requires a configured unique server-selected service binding before dispatch',async()=>{
  const f=await setup();f.env.PLATFORM_COLLECTOR_PUBLICATION_BINDINGS=JSON.stringify({'synthetic-north':'TENANT_NORTH_PUBLISHER','synthetic-lake':'TENANT_NORTH_PUBLISHER'})
  await expect(publishCollector(f.env,f.machine,f.input,'shared',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_UNAVAILABLE'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('captured')
 })
 it('keeps a captured candidate retryable when the signing key is missing before dispatch',async()=>{
  const f=await setup();delete f.env.COLLECTOR_PUBLICATION_PRIVATE_KEY
  const publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  await expect(publishCollector(f.env,f.machine,f.input,'missing-key',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_UNAVAILABLE',status:503})
  expect(publish).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('captured')
 })
})
