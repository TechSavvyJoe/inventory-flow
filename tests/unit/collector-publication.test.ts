// @ts-nocheck -- synthetic actual SQLite, encrypted evidence, R2 and signed RPC.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyntheticCollector, COLLECTOR_OWNER as owner, COLLECTOR_SYNTHETIC_NOW as now } from '../../fixtures/synthetic-collector.mjs'
import { claimCollector, readCollectors, receiptCollector, saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { publishCollector, publicationTicket, publishTenantCandidate, reconcileCollector } from '../../cloudflare/src/collector-publication.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { cloudBundleSha256, encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { publishRelease } from '../../cloudflare/src/worker.mjs'
import { MANAGER_DISPOSITION_AUTHORITY, MANAGER_DISPOSITION_INDEPENDENCE, MANAGER_DISPOSITION_SCHEMA, canonicalManagerDispositionJson, managerDispositionSha256, sanitizeManagerDispositionDocuments } from '../../server/manager-disposition-schema.mjs'
const fixtures=[]
afterEach(()=>fixtures.splice(0).forEach(f=>f.close()))
const revision=f=>f.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
const setup=async(prepare=async()=>{})=>{
 const f=await createSyntheticCollector();fixtures.push(f)
 await prepare(f)
 await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[0].connectionId,reason:'Synthetic refresh',expectedRevision:revision(f)},'request')
 f.attempt=await claimCollector(f.env,f.machine,{},'claim',now)
 await receiptCollector(f.env,f.machine,{attemptId:f.attempt.attemptId,fence:f.attempt.fence,sequence:1,kind:'capture',capturedAt:now.toISOString(),sourceSha256:f.bundle.release.sourceRuns.dealerMail.sha256,counts:{dealerMailRows:8}},now)
 f.candidate=structuredClone(f.bundle);f.candidate.release.completedAt=now.toISOString();f.candidate.createdAt=now.toISOString();f.envelope=encryptBundle(f.candidate,f.key)
 f.input={attemptId:f.attempt.attemptId,fence:f.attempt.fence,configSha256:f.attempt.configSha256,envelope:f.envelope}
 return f
}
describe('Brokered publication and independent tenant receipt',()=>{
 it('completes exact publication and a subsequent pull using active inventory after a confirmed manager delivery',async()=>{
  const f=await setup(async f=>{
   const v=f.bundle.release.vehicles.find(v=>v.publicRecord?.store==='Howell')
   const source={schema_version:'1.0',classification:'operational-redacted',cloud_upload_allowed:true,source_store:'Howell',source_period:f.bundle.reportDate.slice(0,7),source_type:'manager-log',status_authority:MANAGER_DISPOSITION_AUTHORITY,status_independence:MANAGER_DISPOSITION_INDEPENDENCE,records:[{stock_number:v.publicRecord.stock_number,vin:v.vin,vehicle:v.publicRecord.vehicle_name,sold_manager_log:true,delivered_manager_log:true,delivery_date:f.bundle.reportDate,confidence:'high'}],summary:{sold_records:1,delivered_records:1,sold_not_marked_delivered:0}}
   const overlay=sanitizeManagerDispositionDocuments({documents:[{expectedStore:'Howell',data:source}],reportDate:f.bundle.reportDate,vehicles:f.bundle.release.vehicles}),rawHash='b'.repeat(64),s=overlay.summary
   f.bundle.release.managerDispositionOverlay=overlay
   f.bundle.release.sourceRuns.managerDisposition={type:'manager_disposition_overlay',reportDate:f.bundle.reportDate,extractedAt:null,sha256:managerDispositionSha256(overlay),bytes:new TextEncoder().encode(canonicalManagerDispositionJson(overlay)).byteLength,schemaVersion:MANAGER_DISPOSITION_SCHEMA,status:'current',staleReason:null,rowCount:s.recordCount,metadata:{classification:'operational-redacted',cloudUploadAllowed:true,sourceCount:1,sourceStores:['Howell'],soldRecordCount:1,deliveredRecordCount:1,reviewRecordCount:s.reviewRecordCount,strippedFieldCount:overlay.sources[0].strippedFieldCount,sanitizer:'strict_allowlist_v1',boundSourceSha256:rawHash}}
   f.bundle.release.manifest.manager_disposition_overlay={status:'complete',classification:'operational-redacted',source_type:'manager-log',path:`local-file:${f.bundle.reportDate.slice(0,7)}-howell-operational.json`,sha256:rawHash,source_store:'Howell',source_period:f.bundle.reportDate.slice(0,7),sold_records:1,delivered_records:1,sold_not_marked_delivered:0,matched_current_public_vins:s.matchedRecordCount,unmatched_records:s.unmatchedRecordCount,conflicting_records:s.conflictingRecordCount,review_records:s.reviewRecordCount,cloud_upload_allowed:true}
   f.bundle.release.completedAt=new Date(now.getTime()-1000).toISOString()
   f.baseline=encryptBundle(f.bundle,f.key)
   const response=await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.baseline)}),f.tenantEnv)
   expect(response.ok).toBe(true)
  })
  expect(await publishCollector(f.env,f.machine,f.input,'delivery',now)).toMatchObject({status:'published_verified',counts:{inventory:7,managerDispositions:1},ready:true})
  expect(JSON.parse(f.tenant.prepare('SELECT counts_json FROM collector_publication_receipts').get().counts_json)).toMatchObject({vehicleCount:8,activeInventoryCount:7})
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('completed')
  await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[0].connectionId,reason:'Synthetic subsequent refresh',expectedRevision:revision(f)},'next-request')
  const next=await claimCollector(f.env,f.machine,{},'next-claim',now)
  await receiptCollector(f.env,f.machine,{attemptId:next.attemptId,fence:next.fence,sequence:1,kind:'capture',capturedAt:now.toISOString(),sourceSha256:f.candidate.release.sourceRuns.dealerMail.sha256,counts:{dealerMailRows:8}},now)
  expect(await publishCollector(f.env,f.machine,{attemptId:next.attemptId,fence:next.fence,configSha256:next.configSha256,envelope:f.envelope},'next-publish',now)).toMatchObject({status:'unchanged_verified',counts:{inventory:7}})
 })
 it.each(['add','change','remove'])('rejects %s public-change evidence before tenant mutation',async mode=>{
  const f=await setup(async f=>{
   f.bundle.release.publicChangeEvents=[{type:'new_arrival',vin:f.bundle.release.vehicles[0].vin,store:'Howell',date:f.bundle.reportDate}]
   f.bundle.release.completedAt=new Date(now.getTime()-1000).toISOString()
   f.baseline=encryptBundle(f.bundle,f.key)
   expect((await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.baseline)}),f.tenantEnv)).ok).toBe(true)
  }),events=f.candidate.release.publicChangeEvents
  if(mode==='add')events.push({...events[0],type:'new_arrival'})
  if(mode==='change')events[0]={...events[0],type:'new_arrival',after:'Synthetic forged arrival'}
  if(mode==='remove')events.pop()
  f.input.envelope=encryptBundle(f.candidate,f.key)
  const intakeBefore=f.tenant.prepare('SELECT COUNT(*) AS n FROM vehicle_service_intake').get().n
  await expect(publishCollector(f.env,f.machine,f.input,'public-events',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM vehicle_service_intake').get().n).toBe(intakeBefore)
 })
 it.each(['key','malformed-key','wrong-key','r2','d1'])('retains the same candidate and safely retries a definitely preflight-only %s failure',async mode=>{
  const f=await setup(),originalKey=f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64,originalGet=f.bucket.get,originalPrepare=f.tenantEnv.INVENTORY_DB.prepare
  if(mode==='key')delete f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64
  if(mode==='malformed-key')f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64=Buffer.from('synthetic malformed key').toString('base64')
  if(mode==='wrong-key')f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64=Buffer.alloc(32,99).toString('base64')
  if(mode==='r2')f.bucket.get=vi.fn(async()=>{throw new Error('Synthetic temporary read outage')})
  if(mode==='d1')f.tenantEnv.INVENTORY_DB.prepare=vi.fn(()=>{throw new Error('Synthetic temporary D1 outage')})
  // D1 failure inside ticket verification is ambiguous at the broker; only a
  // positive preflight result can release its no-redispatch fence.
  if(mode==='d1')f.tenantEnv.INVENTORY_DB.prepare=sql=>sql.includes('inventory_tenant_identity')?originalPrepare(sql):({first:async()=>{throw new Error('Synthetic baseline read outage')}})
  expect(await publishCollector(f.env,f.machine,f.input,'preflight',now)).toMatchObject({status:'preflight_retryable',ready:false})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('captured')
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64=originalKey;f.bucket.get=originalGet;f.tenantEnv.INVENTORY_DB.prepare=originalPrepare
  expect(await publishCollector(f.env,f.machine,f.input,'preflight',now)).toMatchObject({status:'published_verified'})
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_started'").get().n).toBe(1)
 })
 it('rejects a corrupt candidate only after independently proving the baseline key works',async()=>{
  const f=await setup();f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  await expect(publishCollector(f.env,f.machine,f.input,'corrupt',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
  expect(f.sqlite.prepare('SELECT stage,failure_code FROM platform_collector_attempts').get()).toMatchObject({stage:'failed',failure_code:'VALIDATION_FAILED'})
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it.each(['lease','deadline','third-attempt','cancel','revoke','disabled'])('durably retires a positively undispatched preflight after concurrent %s',async mode=>{
  const f=await setup(),later=new Date(now.getTime()+121000)
  if(mode==='deadline')f.sqlite.prepare('UPDATE platform_collector_attempts SET lease_until=?,hard_deadline=?').run(new Date(now.getTime()+120000).toISOString(),new Date(now.getTime()+120000).toISOString())
  if(mode==='third-attempt'){f.sqlite.prepare('UPDATE platform_collector_attempts SET fence=3').run();f.input.fence=3}
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async()=>{
   if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic cancelled during RPC',expectedRevision:revision(f)},'cancel-rpc')
   if(mode==='revoke')await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoked during RPC',expectedRevision:revision(f)},'revoke-rpc',now)
   if(mode==='disabled')f.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED='false'
   return {status:'preflight_retryable'}
  })
  expect(await publishCollector(f.env,f.machine,f.input,`late-${mode}`,now,()=>later)).toMatchObject({status:'preflight_retryable'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe(['cancel','revoke'].includes(mode)?'reconciliation_required':'expired')
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe(['cancel','revoke'].includes(mode)?'reconciliation_required':['disabled','third-attempt'].includes(mode)?'failed':'queued')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_preflight_deferred'").get().n).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  if(['lease','deadline'].includes(mode))expect(await claimCollector(f.env,f.machine,{},'retry-after-positive-expiry',later)).toMatchObject({fence:2})
 })
 it('preserves an unknown outcome when a positive preflight response is lost',async()=>{
  const f=await setup();f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async()=>{throw new Error('Synthetic lost preflight reply')})
  expect(await publishCollector(f.env,f.machine,f.input,'lost-preflight',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_preflight_deferred'").get().n).toBe(0)
 })
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
