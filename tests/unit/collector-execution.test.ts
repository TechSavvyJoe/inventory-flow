// @ts-nocheck -- actual in-memory SQLite and separately attributed machine actors.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticCollector, COLLECTOR_OWNER as owner, COLLECTOR_SYNTHETIC_NOW as now } from '../../fixtures/synthetic-collector.mjs'
import { claimCollector, contactCollector, heartbeatCollector, readCollectors, receiptCollector, saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { handleCollectorApi, handlePlatformApi } from '../../cloudflare/src/platform-worker.mjs'
const fixtures=[]
const setup=async()=>{const f=await createSyntheticCollector();fixtures.push(f);return f}
afterEach(()=>fixtures.splice(0).forEach(f=>f.close()))
const revision=f=>f.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
const queue=async f=>saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[0].connectionId,reason:'Synthetic refresh',expectedRevision:revision(f)},'request')
const heartbeat=(f,a)=>({attemptId:a.attemptId,fence:a.fence,profileSha256:f.profileSha256,adapterVersion:'1'})
describe('Collector enrollment, scope and fenced execution',()=>{
 it('contacts separately from enabled execution and denies owner/employee machine substitution before reading a body',async()=>{
  const f=await setup();expect(await contactCollector(f.env,f.machine,{profileSha256:f.profileSha256,adapterVersion:'1'},now)).toMatchObject({connected:true,enabled:true})
  for(const identity of [owner,{email:'manager@example.invalid'},{common_name:'unenrolled'},{...f.machine,email:owner.email}])expect((await handleCollectorApi(new Request('https://owner.example.invalid/api/collector/claim',{method:'POST',body:'not json'}),f.env,identity,now)).status).toBe(403)
  expect((await handlePlatformApi(new Request('https://owner.example.invalid/api/platform'),f.env,f.machine,now)).status).toBe(403)
  const disabled={...f.env,PLATFORM_COLLECTOR_EXECUTION_ENABLED:'false'}
  expect(await contactCollector(disabled,f.machine,{profileSha256:f.profileSha256,adapterVersion:'1'},now)).toMatchObject({executionEnabled:false})
  await expect(claimCollector(disabled,f.machine,{},'disabled',now)).rejects.toMatchObject({code:'COLLECTOR_DISABLED'})
 })
 it('freezes a fixed profile, all four dealerships, source settings and current baseline; only one simultaneous claim wins',async()=>{
  const f=await setup();await queue(f)
  const results=await Promise.all([claimCollector(f.env,f.machine,{},'first',now),claimCollector(f.env,f.machine,{},'second',now)])
  expect(results.filter(Boolean)).toHaveLength(1);const a=results.find(Boolean)
  expect(a).toMatchObject({groupId:'synthetic-north',adapterId:'dealermail-hold-refresh',baselineBundleSha256:f.baseline.bundleSha256,fence:1})
  expect(a.dealerships).toHaveLength(4);expect(Object.keys(a)).not.toContain('command');expect(Object.keys(a)).not.toContain('publicationUrl')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_attempts WHERE stage='claimed'").get().n).toBe(1)
  expect(await claimCollector(f.env,f.machine,{},results[0]?'first':'second',now)).toEqual(a)
  expect(await heartbeatCollector(f.env,f.machine,heartbeat(f,a),now)).toMatchObject({continue:true})
 })
 it('rejects partial or cross-group grants and immutable profile reassignment',async()=>{
  const f=await setup(),input={operation:'enroll',name:'Invalid host',accessClientId:'other.access',adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'other',profileSha256:'b'.repeat(64),dealershipIds:[f.dealers[0].id],connectionIds:[f.dealers[0].connectionId],reason:'Synthetic partial scope',expectedRevision:revision(f)}
  await expect(saveCollector(f.env,owner,'synthetic-north',input,'partial',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  expect(()=>f.sqlite.prepare('UPDATE platform_collectors SET profile_sha256=? WHERE id=?').run('b'.repeat(64),f.collectorId)).toThrow()
  await expect(claimCollector(f.env,f.machine,{groupId:'synthetic-lake'},'spoof',now)).rejects.toMatchObject({code:'COLLECTOR_INPUT_INVALID'})
 })
 it('rejects expired leases, reclaims only safe capture work with a higher fence, and binds receipt idempotency',async()=>{
  const f=await setup();const request=await queue(f),a=await claimCollector(f.env,f.machine,{},'first',now)
  const receipt={attemptId:a.attemptId,fence:a.fence,sequence:1,kind:'capture',capturedAt:now.toISOString(),sourceSha256:f.bundle.release.sourceRuns.dealerMail.sha256,counts:{dealerMailRows:8}}
  expect(await receiptCollector(f.env,f.machine,receipt,now)).toMatchObject({saved:true,replayed:false});expect(await receiptCollector(f.env,f.machine,receipt,now)).toMatchObject({replayed:true})
  await expect(receiptCollector(f.env,f.machine,{...receipt,sourceSha256:'b'.repeat(64)},now)).rejects.toMatchObject({code:'COLLECTOR_RECEIPT_CONFLICT'})
  const later=new Date(now.getTime()+130000);await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,a),later)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  const b=await claimCollector(f.env,f.machine,{},'retry',later);expect(b.fence).toBe(2);expect(b.requestId).toBe(request.id)
  await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,a),later)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
 })
 it('allows at most two automatic safe capture retries, then requires a new owner request',async()=>{
  const f=await setup();await queue(f)
  for(let retry=0;retry<3;retry++){
   const at=new Date(now.getTime()+retry*130000)
   const attempt=await claimCollector(f.env,f.machine,{},`claim-${retry}`,at)
   expect(attempt.fence).toBe(retry+1)
  }
  expect(await claimCollector(f.env,f.machine,{},'fourth-claim',new Date(now.getTime()+390000))).toBeNull()
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('failed')
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(3)
  expect((await readCollectors(f.env,owner,'synthetic-north',now)).attempts.every(a=>a.stage==='expired'&&a.failureCode==='DURATION_EXCEEDED')).toBe(true)
 })
 it.each(['revoke','suspend','dealer','source','config','cancel'])('invalidates %s before heartbeat and capture receipt',async mode=>{
  const f=await setup();const request=await queue(f),a=await claimCollector(f.env,f.machine,{},'claim',now)
  if(mode==='revoke')await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoke',expectedRevision:revision(f)},'revoke',now)
  if(mode==='suspend')f.sqlite.prepare("UPDATE platform_groups SET status='suspended' WHERE id='synthetic-north'").run()
  if(mode==='dealer')f.sqlite.prepare('UPDATE platform_dealerships SET enabled=0 WHERE id=?').run(f.dealers[1].id)
  if(mode==='source')f.sqlite.prepare('UPDATE platform_data_connections SET enabled=0 WHERE id=?').run(f.dealers[1].connectionId)
  if(mode==='config')f.sqlite.prepare("UPDATE platform_data_connections SET oem='ford_lincoln' WHERE id=?").run(f.dealers[1].connectionId)
  if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:request.id,reason:'Synthetic cancellation',expectedRevision:revision(f)},'cancel')
  await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,a),now)).rejects.toMatchObject({status:expect.any(Number)})
  await expect(receiptCollector(f.env,f.machine,{attemptId:a.attemptId,fence:a.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED'},now)).rejects.toMatchObject({status:expect.any(Number)})
 })
 it('blocks settings edits for every granted source while a group-wide attempt is unresolved; refuses raw failure material',async()=>{
  const f=await setup();await queue(f);const a=await claimCollector(f.env,f.machine,{},'claim',now),d=f.dealers[1]
  await expect(saveDataControl(f.env,owner,'synthetic-north','connections',{id:d.connectionId,dealershipId:d.id,name:'Changed',provider:'dealermail',method:'collector',endpoint:'',credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',enabled:true,cadence:'manual',localTime:'05:30',timezone:'America/Detroit',reason:'Synthetic settings edit',expectedRevision:revision(f)},'edit')).rejects.toMatchObject({code:'PLATFORM_PULL_PENDING'})
  await expect(receiptCollector(f.env,f.machine,{attemptId:a.attemptId,fence:a.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED',stderr:'secret'},now)).rejects.toMatchObject({code:'COLLECTOR_INPUT_INVALID'})
  const projected=(await readCollectors(f.env,owner,'synthetic-north',now)).attempts[0];expect(projected.stage).toBe('claimed');expect(projected).not.toHaveProperty('publication')
 })
 it.each(['claim','heartbeat','receipt'])('aborts the entire %s transaction when a source is disabled after the preliminary read',async operation=>{
  const f=await setup();await queue(f)
  const a=operation==='claim'?null:await claimCollector(f.env,f.machine,{},'first',now)
  const real=f.env.PLATFORM_DB.batch.bind(f.env.PLATFORM_DB);let mutated=false
  f.env.PLATFORM_DB.batch=async statements=>{
   if(!mutated && statements.some(s=>s.sql.includes(operation==='claim'?"state=CASE WHEN state='queued'":'UPDATE platform_revision SET revision=CASE WHEN EXISTS'))){mutated=true;f.sqlite.prepare('UPDATE platform_data_connections SET enabled=0 WHERE id=?').run(f.dealers[1].connectionId)}
   return real(statements)
  }
  if(operation==='claim'){expect(await claimCollector(f.env,f.machine,{},'race',now)).toBeNull();expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('queued');expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(0)}
  else if(operation==='heartbeat')await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,a),now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  else {await expect(receiptCollector(f.env,f.machine,{attemptId:a.attemptId,fence:a.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED'},now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'});expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts').get().n).toBe(0)}
  expect(mutated).toBe(true)
 })
 it('refuses a cold or wrong-date baseline before handing any work to the host',async()=>{
  const f=await setup();await queue(f);f.tenant.prepare("UPDATE cloud_release_versions SET report_date='2026-08-29' WHERE status='current'").run()
  await expect(claimCollector(f.env,f.machine,{},'cold',now)).rejects.toMatchObject({code:'COLLECTOR_BASELINE_REQUIRED'})
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(0)
 })
 it('isolates two enrolled groups sharing profile and credential labels; caller-supplied attempt IDs grant no cross-tenant access',async()=>{
  const f=await setup(),other=await createSyntheticCollector({groupId:'synthetic-other',enroll:false});fixtures.push(other)
  for(const table of ['platform_groups','platform_dealerships','platform_data_connections'])for(const row of other.sqlite.prepare(`SELECT * FROM ${table} WHERE ${table==='platform_groups'?'id':'group_id'}=?`).all('synthetic-other')){const values=Object.values(row);f.sqlite.prepare(`INSERT INTO ${table} VALUES(${values.map(()=>'?').join(',')})`).run(...values)}
  f.env.TENANT_OTHER_DB=other.tenantEnv.INVENTORY_DB;f.env.PLATFORM_TENANT_BINDINGS=JSON.stringify({'synthetic-north':'TENANT_NORTH_DB','synthetic-other':'TENANT_OTHER_DB'})
  const host=await saveCollector(f.env,owner,'synthetic-other',{operation:'enroll',name:'Other registered host',accessClientId:other.machine.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store',profileSha256:f.profileSha256,dealershipIds:other.dealers.map(d=>d.id),connectionIds:other.dealers.map(d=>d.connectionId),reason:'Synthetic other enrollment',expectedRevision:revision(f)},'other-enroll',now)
  await saveCollector(f.env,owner,'synthetic-other',{operation:'enable',id:host.id,reason:'Synthetic other activation',expectedRevision:revision(f)},'other-enable',now)
  await saveDataControl(f.env,owner,'synthetic-other','pulls',{operation:'request',connectionId:other.dealers[0].connectionId,reason:'Synthetic other request',expectedRevision:revision(f)},'other-request')
  expect(await claimCollector(f.env,f.machine,{},'a-cannot-claim-b',now)).toBeNull()
  const b=await claimCollector(f.env,other.machine,{},'b-claim',now);expect(b.groupId).toBe('synthetic-other')
  await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,b),now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  await expect(receiptCollector(f.env,f.machine,{attemptId:b.attemptId,fence:b.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED'},now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  await expect(claimCollector(f.env,f.machine,{groupId:'synthetic-other',connectionId:other.dealers[0].connectionId},'spoof',now)).rejects.toMatchObject({code:'COLLECTOR_INPUT_INVALID'})
  f.env.TENANT_NORTH_DB=other.tenantEnv.INVENTORY_DB;await queue(f)
  await expect(claimCollector(f.env,f.machine,{},'swapped-tenant',now)).rejects.toMatchObject({code:'TENANT_CONFIGURATION_REQUIRED'})
 })
})
