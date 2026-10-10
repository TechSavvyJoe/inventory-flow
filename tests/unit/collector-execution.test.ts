// @ts-nocheck -- actual in-memory SQLite and separately attributed machine actors.
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticCollector, COLLECTOR_OWNER as owner, COLLECTOR_SYNTHETIC_NOW as now } from '../../fixtures/synthetic-collector.mjs'
import { claimCollector, contactCollector, heartbeatCollector, readCollectors, receiptCollector, saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { handleCollectorApi, handlePlatformApi } from '../../cloudflare/src/platform-worker.mjs'
const fixtures=[]
const setup=async(options)=>{const f=await createSyntheticCollector(options);fixtures.push(f);return f}
afterEach(()=>fixtures.splice(0).forEach(f=>f.close()))
const revision=f=>f.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
const queue=async(f,at=now)=>saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[0].connectionId,reason:'Synthetic refresh',expectedRevision:revision(f)},'request',at)
const heartbeat=(f,a)=>({attemptId:a.attemptId,fence:a.fence,profileSha256:f.profileSha256,adapterVersion:'1'})
describe('Collector enrollment, scope and fenced execution',()=>{
 it('serializes different profiles across queued stores and retains the group reconciliation lock',async()=>{
  const f=await setup(),other={common_name:'second-group-profile.access'}
  const enrolled=await saveCollector(f.env,owner,'synthetic-north',{operation:'enroll',name:'Second group host',accessClientId:other.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'different-profile',profileSha256:'c'.repeat(64),credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:f.dealers.map(d=>d.id),connectionIds:f.dealers.map(d=>d.connectionId),reason:'Synthetic second enrollment',expectedRevision:revision(f)},'group-enroll',now)
  await saveCollector(f.env,owner,'synthetic-north',{operation:'enable',id:enrolled.id,reason:'Synthetic second activation',expectedRevision:revision(f)},'group-enable',now)
  await queue(f)
  await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[1].connectionId,reason:'Synthetic second store',expectedRevision:revision(f)},'second-store',now)
  const results=await Promise.all([claimCollector(f.env,f.machine,{},'profile-a',now),claimCollector(f.env,other,{},'profile-b',now)])
  expect(results.filter(Boolean)).toHaveLength(1)
  const active=results.find(Boolean),winner=results[0]?f.machine:other,loser=results[0]?other:f.machine
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_attempts WHERE stage='claimed'").get().n).toBe(1)
  expect(f.sqlite.prepare("PRAGMA index_info('platform_collector_one_group')").all().map(column=>column.name)).toEqual(['group_id'])
  expect(f.sqlite.prepare("PRAGMA index_list('platform_collector_attempts')").all().find(index=>index.name==='platform_collector_one_group')).toMatchObject({unique:1,partial:1})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_pull_requests WHERE state='queued'").get().n).toBe(0)
  // Both original store requests share one capture; late work remains independent.
  await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[2].connectionId,reason:'Synthetic late store',expectedRevision:revision(f)},'late-store',now)
  await receiptCollector(f.env,winner,{attemptId:active.attemptId,fence:active.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED'},now)
  const next=await claimCollector(f.env,loser,{},'after-terminal',now)
  expect(next).not.toBeNull();expect(next.requestId).not.toBe(active.requestId)
  await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[3].connectionId,reason:'Synthetic parked request',expectedRevision:revision(f)},'parked-store',now)
  for(const stage of ['captured','publishing','reconciliation_required']){
   f.sqlite.prepare('UPDATE platform_collector_attempts SET stage=? WHERE id=?').run(stage,next.attemptId)
   expect(await claimCollector(f.env,winner,{},`blocked-${stage}`,now)).toBeNull()
  }
  expect(await claimCollector(f.env,winner,{},'parked-lock',new Date(now.getTime()+130000))).toBeNull()
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts WHERE id=?').get(next.attemptId).stage).toBe('reconciliation_required')
 })
 it('refuses execution on the old platform schema before claiming or retiring work',async()=>{
  const f=await setup();await queue(f);f.sqlite.exec('DROP INDEX platform_collector_one_group')
  await expect(claimCollector(f.env,f.machine,{},'missing-group-schema',now)).rejects.toMatchObject({code:'COLLECTOR_SCHEMA_REQUIRED',status:503})
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(0)
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('queued')
 })
 it('fails the forward serialization migration closed on overlapping historical active profiles',async()=>{
  const f=await setup()
  await queue(f);const a=await claimCollector(f.env,f.machine,{},'legacy-one',now)
  f.sqlite.exec('DROP INDEX platform_collector_one_group')
  const old=f.sqlite.prepare('SELECT * FROM platform_collector_attempts WHERE id=?').get(a.attemptId)
  await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[1].connectionId,reason:'Synthetic legacy second',expectedRevision:revision(f)},'legacy-second',now)
  const queued=f.sqlite.prepare("SELECT id FROM platform_pull_requests WHERE state='queued'").get()
  const duplicate={...old,id:'synthetic-overlap',request_id:queued.id,profile_id:'legacy-other-profile',claim_key:'legacy-other-key'}
  const values=Object.values(duplicate)
  f.sqlite.prepare(`INSERT INTO platform_collector_attempts VALUES(${values.map(()=>'?').join(',')})`).run(...values)
  const before=f.sqlite.prepare('SELECT * FROM platform_collector_attempts ORDER BY id').all()
  expect(()=>f.sqlite.exec(readFileSync(new URL('../../cloudflare/platform-migrations/0005_collector_group_serialization.sql',import.meta.url),'utf8'))).toThrow()
  expect(f.sqlite.prepare('SELECT * FROM platform_collector_attempts ORDER BY id').all()).toEqual(before)
  expect(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='platform_collector_one_profile'").get()).toBeDefined()
 })

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
  const f=await setup(),input={operation:'enroll',name:'Invalid host',accessClientId:'other.access',adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'other',profileSha256:'b'.repeat(64),credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:[f.dealers[0].id],connectionIds:[f.dealers[0].connectionId],reason:'Synthetic partial scope',expectedRevision:revision(f)}
  await expect(saveCollector(f.env,owner,'synthetic-north',input,'partial',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  expect(()=>f.sqlite.prepare('UPDATE platform_collectors SET profile_sha256=? WHERE id=?').run('b'.repeat(64),f.collectorId)).toThrow()
  await expect(claimCollector(f.env,f.machine,{groupId:'synthetic-lake'},'spoof',now)).rejects.toMatchObject({code:'COLLECTOR_INPUT_INVALID'})
 })
 it.each([undefined,'','credential_lowercase','CREDENTIAL_DIFFERENT_PROFILE'])('rejects a missing, invalid or mismatched installed-profile credential reference at enrollment: %s',async credentialRef=>{
  const f=await setup({enroll:false}),beforeRevision=revision(f),beforeSources=f.sqlite.prepare('SELECT * FROM platform_data_connections ORDER BY id').all()
  await expect(saveCollector(f.env,owner,'synthetic-north',{operation:'enroll',name:'Credential test host',accessClientId:f.machine.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store',profileSha256:f.profileSha256,credentialRef,dealershipIds:f.dealers.map(d=>d.id),connectionIds:f.dealers.map(d=>d.connectionId),reason:'Synthetic profile credential review',expectedRevision:beforeRevision},'invalid-profile-reference',now)).rejects.toMatchObject({code:credentialRef==='CREDENTIAL_DIFFERENT_PROFILE'?'COLLECTOR_SCOPE_MISMATCH':'COLLECTOR_INPUT_INVALID'})
  expect(revision(f)).toBe(beforeRevision)
  expect(f.sqlite.prepare('SELECT * FROM platform_data_connections ORDER BY id').all()).toEqual(beforeSources)
  for(const table of ['platform_collectors','platform_collector_grants','platform_collector_attempts','platform_audit'])expect(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(0)
 })
 it.each([['one',''],['all',''],['one','CREDENTIAL_OTHER_PROFILE'],['all','CREDENTIAL_OTHER_PROFILE']])('rejects %s empty or mismatched source credential references without enrollment mutations',async(which,credentialRef)=>{
  const f=await setup({enroll:false})
  for(const dealer of which==='all'?f.dealers:[f.dealers[0]])f.sqlite.prepare('UPDATE platform_data_connections SET credential_ref=? WHERE id=?').run(credentialRef,dealer.connectionId)
  const beforeRevision=revision(f),beforeSources=f.sqlite.prepare('SELECT * FROM platform_data_connections ORDER BY id').all()
  await expect(saveCollector(f.env,owner,'synthetic-north',{operation:'enroll',name:'Credential test host',accessClientId:f.machine.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store',profileSha256:f.profileSha256,credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:f.dealers.map(d=>d.id),connectionIds:f.dealers.map(d=>d.connectionId),reason:'Synthetic connection credential review',expectedRevision:beforeRevision},'invalid-source-reference',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  expect(revision(f)).toBe(beforeRevision)
  expect(f.sqlite.prepare('SELECT * FROM platform_data_connections ORDER BY id').all()).toEqual(beforeSources)
  for(const table of ['platform_collectors','platform_collector_grants','platform_collector_attempts','platform_audit'])expect(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(0)
 })
 it.each(['','CREDENTIAL_OTHER_PROFILE'])('rejects shared credential-reference drift before activation and preserves the paused enrollment: %s',async credentialRef=>{
  const f=await setup(),paused=await saveCollector(f.env,owner,'synthetic-north',{operation:'enroll',name:'Paused reference host',accessClientId:'paused-reference.access',adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-paused-profile',profileSha256:'b'.repeat(64),credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:f.dealers.map(d=>d.id),connectionIds:f.dealers.map(d=>d.connectionId),reason:'Synthetic paused credential review',expectedRevision:revision(f)},'paused-reference-enroll',now)
  f.sqlite.prepare('UPDATE platform_data_connections SET credential_ref=?').run(credentialRef)
  const before=f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(paused.id),beforeRevision=revision(f),beforeAudit=f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n
  await expect(saveCollector(f.env,owner,'synthetic-north',{operation:'enable',id:paused.id,reason:'Synthetic activation review',expectedRevision:beforeRevision},'invalid-reference-enable',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  expect(f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(paused.id)).toEqual(before)
  expect(revision(f)).toBe(beforeRevision)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(beforeAudit)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(0)
 })
 it.each(['','CREDENTIAL_OTHER_PROFILE'])('rejects shared credential-reference drift before contact or lease admission: %s',async credentialRef=>{
  const f=await setup();await queue(f)
  f.sqlite.prepare('UPDATE platform_data_connections SET credential_ref=?').run(credentialRef)
  const beforeRevision=revision(f),beforeHost=f.sqlite.prepare('SELECT * FROM platform_collectors').get(),beforeQueue=f.sqlite.prepare('SELECT * FROM platform_pull_requests').all(),beforeAudit=f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n
  await expect(contactCollector(f.env,f.machine,{profileSha256:f.profileSha256,adapterVersion:'1'},now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  for(let retry=0;retry<4;retry++)await expect(claimCollector(f.env,f.machine,{},`invalid-reference-${retry}`,new Date(now.getTime()+retry*130000))).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  expect(f.sqlite.prepare('SELECT * FROM platform_pull_requests').all()).toEqual(beforeQueue)
  expect(f.sqlite.prepare('SELECT * FROM platform_collectors').get()).toEqual(beforeHost)
  expect(revision(f)).toBe(beforeRevision)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n).toBe(beforeAudit)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts').get().n).toBe(0)
 })
 it('requires the fixed New York timezone at enrollment, activation and claim',async()=>{
  const f=await setup({enroll:false}),input={operation:'enroll',name:'Timezone test host',accessClientId:f.machine.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store',profileSha256:f.profileSha256,credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:f.dealers.map(d=>d.id),connectionIds:f.dealers.map(d=>d.connectionId),reason:'Synthetic timezone enrollment',expectedRevision:revision(f)}
  f.sqlite.prepare('UPDATE platform_data_connections SET timezone=? WHERE id=?').run('America/Detroit',f.dealers[0].connectionId)
  await expect(saveCollector(f.env,owner,'synthetic-north',input,'timezone-invalid-enroll',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  f.sqlite.prepare('UPDATE platform_data_connections SET timezone=? WHERE id=?').run('America/New_York',f.dealers[0].connectionId)
  const enrolled=await saveCollector(f.env,owner,'synthetic-north',input,'timezone-valid-enroll',now)
  f.sqlite.prepare('UPDATE platform_data_connections SET timezone=? WHERE id=?').run('America/Detroit',f.dealers[0].connectionId)
  await expect(saveCollector(f.env,owner,'synthetic-north',{operation:'enable',id:enrolled.id,reason:'Synthetic timezone activation',expectedRevision:revision(f)},'timezone-invalid-enable',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
  f.sqlite.prepare('UPDATE platform_data_connections SET timezone=? WHERE id=?').run('America/New_York',f.dealers[0].connectionId)
  await saveCollector(f.env,owner,'synthetic-north',{operation:'enable',id:enrolled.id,reason:'Synthetic timezone activation',expectedRevision:revision(f)},'timezone-valid-enable',now)
  await queue(f)
  f.sqlite.prepare('UPDATE platform_data_connections SET timezone=? WHERE id=?').run('America/Detroit',f.dealers[0].connectionId)
  await expect(claimCollector(f.env,f.machine,{},'timezone-invalid-claim',now)).rejects.toMatchObject({code:'COLLECTOR_SCOPE_MISMATCH'})
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
 it('does not reclaim an already queued request from a different immutable profile authority',async()=>{
  const f=await setup(),request=await queue(f),old=await claimCollector(f.env,f.machine,{},'old-profile-claim',now)
  const other={common_name:'second-profile.collector.access'}
  const enrolled=await saveCollector(f.env,owner,'synthetic-north',{operation:'enroll',name:'Second synthetic profile',accessClientId:other.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store-next',profileSha256:'c'.repeat(64),credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:f.dealers.map(d=>d.id),connectionIds:f.dealers.map(d=>d.connectionId),reason:'Synthetic second profile',expectedRevision:revision(f)},'second-profile-enroll',now)
  await saveCollector(f.env,owner,'synthetic-north',{operation:'enable',id:enrolled.id,reason:'Synthetic second profile activation',expectedRevision:revision(f)},'second-profile-enable',now)
  // Model a pre-existing queued item carrying an expired attempt from the old authority.
  f.sqlite.prepare("UPDATE platform_pull_requests SET state='queued' WHERE id=?").run(request.id)
  expect(await claimCollector(f.env,other,{},'new-profile-claim',new Date(now.getTime()+130000))).toBeNull()
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests WHERE id=?').get(request.id).state).toBe('queued')
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts WHERE id=?').get(old.attemptId).stage).toBe('claimed')
 })
 it('derives report date from America/New_York at the UTC day boundary',async()=>{
  const f=await setup(),boundary=new Date('2026-08-30T03:30:00.000Z')
  f.tenant.prepare("UPDATE cloud_release_versions SET report_date='2026-08-29' WHERE status='current'").run()
  await queue(f,boundary)
  const attempt=await claimCollector(f.env,f.machine,{},'new-york-boundary',boundary)
  expect(attempt.reportDate).toBe('2026-08-29')
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
  const host=await saveCollector(f.env,owner,'synthetic-other',{operation:'enroll',name:'Other registered host',accessClientId:other.machine.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store',profileSha256:f.profileSha256,credentialRef:'CREDENTIAL_SYNTHETIC_MAIL',dealershipIds:other.dealers.map(d=>d.id),connectionIds:other.dealers.map(d=>d.connectionId),reason:'Synthetic other enrollment',expectedRevision:revision(f)},'other-enroll',now)
  await saveCollector(f.env,owner,'synthetic-other',{operation:'enable',id:host.id,reason:'Synthetic other activation',expectedRevision:revision(f)},'other-enable',now)
  await saveDataControl(f.env,owner,'synthetic-other','pulls',{operation:'request',connectionId:other.dealers[0].connectionId,reason:'Synthetic other request',expectedRevision:revision(f)},'other-request')
  expect(await claimCollector(f.env,f.machine,{},'a-cannot-claim-b',now)).toBeNull()
  await queue(f)
  const north=await claimCollector(f.env,f.machine,{},'north-active',now);expect(north.groupId).toBe('synthetic-north')
  const b=await claimCollector(f.env,other.machine,{},'b-claim',now);expect(b.groupId).toBe('synthetic-other')
  await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,b),now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  await expect(receiptCollector(f.env,f.machine,{attemptId:b.attemptId,fence:b.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED'},now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  await expect(claimCollector(f.env,f.machine,{groupId:'synthetic-other',connectionId:other.dealers[0].connectionId},'spoof',now)).rejects.toMatchObject({code:'COLLECTOR_INPUT_INVALID'})
  f.env.TENANT_NORTH_DB=other.tenantEnv.INVENTORY_DB
  await expect(claimCollector(f.env,f.machine,{},'swapped-tenant',now)).rejects.toMatchObject({code:'TENANT_CONFIGURATION_REQUIRED'})
 })
})
