// @ts-nocheck -- synthetic SQLite, signed tenant RPC and bounded control-plane membership.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticCollector, COLLECTOR_OWNER as owner, COLLECTOR_SYNTHETIC_NOW as now } from '../../fixtures/synthetic-collector.mjs'
import { claimCollector, heartbeatCollector, receiptCollector, saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { publishCollector, reconcileCollector } from '../../cloudflare/src/collector-publication.mjs'
import { saveDataControl, readPlatformAudit } from '../../cloudflare/src/platform-data.mjs'
import { canonical, digest } from '../../cloudflare/src/collector-common.mjs'
import { encryptBundle } from '../../scripts/publish-cloud-release.mjs'
const fixtures=[]
afterEach(()=>fixtures.splice(0).forEach(f=>f.close()))
const setup=async()=>{const f=await createSyntheticCollector();fixtures.push(f);return f}
const revision=f=>f.sqlite.prepare('SELECT revision FROM platform_revision').get().revision
const queue=async(f,index)=>saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[index].connectionId,reason:'Synthetic grouped capture',expectedRevision:revision(f)},`group-store-${index}`,now)
const row=(f,a)=>f.sqlite.prepare('SELECT * FROM platform_collector_attempts WHERE id=?').get(a.attemptId)
const members=(f,a)=>JSON.parse(row(f,a).config_json).requestIds
const states=f=>f.sqlite.prepare('SELECT id,state FROM platform_pull_requests ORDER BY id').all()
const heartbeat=(f,a)=>({attemptId:a.attemptId,fence:a.fence,profileSha256:f.profileSha256,adapterVersion:'1'})
const capture=(f,a)=>({attemptId:a.attemptId,fence:a.fence,sequence:1,kind:'capture',capturedAt:now.toISOString(),sourceSha256:f.bundle.release.sourceRuns.dealerMail.sha256,counts:{dealerMailRows:8}})
const input=(f,a)=>{const candidate=structuredClone(f.bundle);candidate.release.completedAt=now.toISOString();candidate.createdAt=now.toISOString();return {attemptId:a.attemptId,fence:a.fence,configSha256:a.configSha256,envelope:encryptBundle(candidate,f.key)}}
const cancel=async(f,id)=>{const request=f.sqlite.prepare('SELECT connection_id FROM platform_pull_requests WHERE id=?').get(id);return saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:request.connection_id,requestId:id,reason:'Synthetic whole capture stop',expectedRevision:revision(f)},'group-stop',now)}

describe('frozen compatible DealerMail request coalescing',()=>{
 it('atomically claims four stores once, binds membership to configuration, and replays the same wire contract',async()=>{
  const f=await setup(),requests=[]
  for(let i=0;i<4;i++)requests.push(await queue(f,i))
  const claims=await Promise.all([claimCollector(f.env,f.machine,{},'group-a',now),claimCollector(f.env,f.machine,{},'group-b',now)])
  expect(claims.filter(Boolean)).toHaveLength(1)
  const a=claims.find(Boolean),frozen=JSON.parse(row(f,a).config_json)
  expect(frozen.requestIds).toEqual(requests.map(r=>r.id).sort())
  expect(await digest(frozen)).toBe(a.configSha256)
  expect(a).not.toHaveProperty('requestIds')
  expect(states(f).every(r=>r.state==='running')).toBe(true)
  expect(f.sqlite.prepare('SELECT COUNT(*) n FROM platform_collector_attempts').get().n).toBe(1)
  expect(await claimCollector(f.env,f.machine,{},claims[0]?'group-a':'group-b',now)).toEqual(a)
 })
 it('settles only frozen members on capture failure and never adds a late queued store',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'group',now),ids=members(f,a),late=await queue(f,2)
  expect(await claimCollector(f.env,f.machine,{},'group',now)).toEqual(a)
  expect(members(f,a)).toEqual(ids)
  const receipt={attemptId:a.attemptId,fence:a.fence,sequence:1,kind:'failure',code:'CAPTURE_FAILED'}
  await receiptCollector(f.env,f.machine,receipt,now)
  expect(await receiptCollector(f.env,f.machine,receipt,now)).toMatchObject({replayed:true})
  expect(states(f).filter(r=>ids.includes(r.id)).every(r=>r.state==='failed')).toBe(true)
  expect(states(f).find(r=>r.id===late.id).state).toBe('queued')
 })
 it('reclaims the same frozen group with a higher fence and leaves late work independent',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'first',now),ids=members(f,a),late=await queue(f,2),later=new Date(now.getTime()+121000)
  const b=await claimCollector(f.env,f.machine,{},'second',later)
  expect(b).toMatchObject({requestId:a.requestId,fence:2})
  expect(members(f,b)).toEqual(ids)
  expect(states(f).find(r=>r.id===late.id).state).toBe('queued')
  await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,a),later)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  await expect(receiptCollector(f.env,f.machine,capture(f,a),later)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
 })
 it('exhausts the original three-attempt budget for the complete frozen group',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  let ids
  for(let i=0;i<3;i++){const a=await claimCollector(f.env,f.machine,{},`retry-${i}`,new Date(now.getTime()+i*121000));expect(a.fence).toBe(i+1);ids??=members(f,a);expect(members(f,a)).toEqual(ids)}
  expect(await claimCollector(f.env,f.machine,{},'exhausted',new Date(now.getTime()+363000))).toBeNull()
  expect(states(f).every(r=>r.state==='failed')).toBe(true)
 })
 it('keeps legacy singleton configuration valid and never regroups its retry',async()=>{
  const f=await setup();await queue(f,0)
  const a=await claimCollector(f.env,f.machine,{},'legacy',now),config=JSON.parse(row(f,a).config_json)
  delete config.requestIds
  f.sqlite.prepare('UPDATE platform_collector_attempts SET config_json=?,config_sha256=? WHERE id=?').run(canonical(config),await digest(config),a.attemptId)
  expect(await heartbeatCollector(f.env,f.machine,heartbeat(f,a),now)).toMatchObject({continue:true})
  const late=await queue(f,1),b=await claimCollector(f.env,f.machine,{},'legacy-retry',new Date(now.getTime()+121000))
  expect(members(f,b)).toEqual([a.requestId])
  expect(states(f).find(r=>r.id===late.id).state).toBe('queued')
 })
 it('rejects a nonprimary member that stops running before heartbeat or receipt',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'guard',now),sibling=members(f,a).find(id=>id!==a.requestId)
  f.sqlite.prepare("UPDATE platform_pull_requests SET state='queued' WHERE id=?").run(sibling)
  await expect(heartbeatCollector(f.env,f.machine,heartbeat(f,a),now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  await expect(receiptCollector(f.env,f.machine,capture(f,a),now)).rejects.toMatchObject({code:'COLLECTOR_LEASE_STALE'})
  expect(f.sqlite.prepare('SELECT COUNT(*) n FROM platform_collector_receipts').get().n).toBe(0)
 })
 it('aborts all four claims if a queued sibling is cancelled between selection and transaction',async()=>{
  const f=await setup(),requests=[];for(let i=0;i<4;i++)requests.push(await queue(f,i))
  const batch=f.env.PLATFORM_DB.batch.bind(f.env.PLATFORM_DB);let raced=false
  f.env.PLATFORM_DB.batch=async statements=>{if(!raced&&statements.some(s=>s.sql.includes("state=CASE WHEN state='queued'"))){raced=true;f.sqlite.prepare("UPDATE platform_pull_requests SET state='cancelled' WHERE id=?").run(requests[3].id)}return batch(statements)}
  expect(await claimCollector(f.env,f.machine,{},'race',now)).toBeNull()
  expect(raced).toBe(true)
  expect(states(f).filter(r=>r.id!==requests[3].id).every(r=>r.state==='queued')).toBe(true)
  expect(f.sqlite.prepare('SELECT COUNT(*) n FROM platform_collector_attempts').get().n).toBe(0)
 })
 it('attributes nonprimary cancellation to the owner and stops the whole undispatched capture',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'cancel',now),ids=members(f,a),sibling=ids.find(id=>id!==a.requestId)
  await cancel(f,sibling)
  expect(states(f).every(r=>r.state==='cancelled')).toBe(true)
  expect(row(f,a)).toMatchObject({stage:'cancelled',failure_code:'CANCELLED_BY_OWNER'})
  const audit=f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='group-stop'").get()
  expect(audit).toMatchObject({actor_id:f.sqlite.prepare('SELECT id FROM platform_owners WHERE email=?').get(owner.email).id,target_id:sibling,reason:'Synthetic whole capture stop'})
  expect(JSON.parse(audit.next_json).requestIds).toEqual(ids)
  expect((await readPlatformAudit(f.env,owner,audit.id)).changes).toContainEqual({field:'requestIds',before:null,after:ids})
  expect(await claimCollector(f.env,f.machine,{},'no-resume',now)).toBeNull()
 })
 it.each(['preflight','revision'].flatMap(proof=>['primary','sibling','none'].map(cancelled=>({proof,cancelled}))))('keeps fresh work claimable after $proof requeue and $cancelled cancellation',async({proof,cancelled})=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'deferred-group',now),ids=members(f,a),body=input(f,a)
  await receiptCollector(f.env,f.machine,capture(f,a),now)
  let dispatches=0
  f.env.TENANT_NORTH_PUBLISHER.publish=async()=>{dispatches++;return proof==='preflight'?{status:'preflight_retryable'}:{status:'revision_retryable',attemptId:a.attemptId,fence:a.fence,bundleSha256:body.envelope.bundleSha256,reportDate:body.envelope.reportDate,atomicRollback:true}}
  const later=new Date(now.getTime()+121000)
  expect(await publishCollector(f.env,f.machine,body,'deferred-publication',now,()=>later)).toMatchObject({status:`${proof}_retryable`})
  expect(states(f).every(r=>r.state==='queued')).toBe(true)
  const expired=row(f,a)
  expect(expired.stage).toBe('expired')
  const late=await queue(f,2)
  if(cancelled!=='none'){
   const stopped=cancelled==='primary'?a.requestId:ids.find(id=>id!==a.requestId)
   await cancel(f,stopped)
   expect(states(f).filter(r=>ids.includes(r.id)).every(r=>r.state==='cancelled')).toBe(true)
   const audit=f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='group-stop'").get()
   expect(audit).toMatchObject({target_id:stopped,reason:'Synthetic whole capture stop'})
   expect(JSON.parse(audit.next_json)).toMatchObject({state:'cancelled',requestIds:ids})
  }
  expect(row(f,a)).toEqual(expired)
  expect(states(f).find(r=>r.id===late.id).state).toBe('queued')
  const next=await claimCollector(f.env,f.machine,{},'after-deferred-stop',new Date(now.getTime()+122000))
  expect(next).toMatchObject({requestId:cancelled==='none'?a.requestId:late.id,fence:cancelled==='none'?2:1})
  expect(members(f,next)).toEqual(cancelled==='none'?ids:[late.id])
  expect(await digest(JSON.parse(row(f,next).config_json))).toBe(next.configSha256)
  expect(dispatches).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it('aborts queued retry cancellation when another claim wins the owner revision race',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'cancel-race-original',now),ids=members(f,a),body=input(f,a)
  await receiptCollector(f.env,f.machine,capture(f,a),now)
  f.env.TENANT_NORTH_PUBLISHER.publish=async()=>({status:'preflight_retryable'})
  const later=new Date(now.getTime()+121000)
  await publishCollector(f.env,f.machine,body,'cancel-race-defer',now,()=>later)
  const expired=row(f,a),batch=f.env.PLATFORM_DB.batch.bind(f.env.PLATFORM_DB)
  let raced=false,retry
  f.env.PLATFORM_DB.batch=async statements=>{
   if(!raced && statements.some(s=>s.sql.includes('revision=CASE WHEN revision=?'))){raced=true;retry=await claimCollector(f.env,f.machine,{},'cancel-race-retry',later)}
   return batch(statements)
  }
  await expect(cancel(f,ids.find(id=>id!==a.requestId))).rejects.toMatchObject({code:'PLATFORM_CONFLICT'})
  expect(raced).toBe(true)
  expect(retry).toMatchObject({requestId:a.requestId,fence:2})
  expect(members(f,retry)).toEqual(ids)
  expect(states(f).every(r=>r.state==='running')).toBe(true)
  expect(row(f,a)).toEqual(expired)
  expect(f.sqlite.prepare("SELECT COUNT(*) n FROM platform_audit WHERE request_key='group-stop'").get().n).toBe(0)
 })
 it('revokes the entire frozen group without touching a late queued request',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'revoke',now),ids=members(f,a),late=await queue(f,2)
  await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic shared revoke',expectedRevision:revision(f)},'revoke',now)
  expect(states(f).filter(r=>ids.includes(r.id)).every(r=>r.state==='cancelled')).toBe(true)
  expect(states(f).find(r=>r.id===late.id).state).toBe('queued')
 })
 it('publishes one receipt for four completed requests and does not dispatch on replay',async()=>{
  const f=await setup();for(let i=0;i<4;i++)await queue(f,i)
  const a=await claimCollector(f.env,f.machine,{},'publish',now);await receiptCollector(f.env,f.machine,capture(f,a),now)
  const publish=f.env.TENANT_NORTH_PUBLISHER.publish;let dispatches=0
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{dispatches++;return publish(...args)}
  expect(await publishCollector(f.env,f.machine,input(f,a),'publication',now)).toMatchObject({status:'published_verified'})
  expect(states(f).every(r=>r.state==='completed')).toBe(true)
  expect(f.sqlite.prepare("SELECT COUNT(*) n FROM platform_collector_receipts WHERE kind='publication'").get().n).toBe(1)
  await publishCollector(f.env,f.machine,input(f,a),'publication',now)
  expect(dispatches).toBe(1)
 })
 it('parks every member on an unknown dispatch, preserves owner stop and never publishes twice',async()=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'unknown',now);await receiptCollector(f.env,f.machine,capture(f,a),now)
  let dispatches=0
  f.env.TENANT_NORTH_PUBLISHER.publish=async()=>{dispatches++;throw new TypeError('Synthetic lost dispatch response')}
  const body=input(f,a)
  expect(await publishCollector(f.env,f.machine,body,'publication',now)).toMatchObject({status:'reconciliation_required'})
  expect(states(f).every(r=>r.state==='reconciliation_required')).toBe(true)
  await cancel(f,members(f,a).find(id=>id!==a.requestId))
  const audit=f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='group-stop'").get()
  expect(await publishCollector(f.env,f.machine,body,'publication',now)).toMatchObject({status:'reconciliation_required'})
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:a.attemptId},now)).toMatchObject({status:'reconciliation_required'})
  expect(await claimCollector(f.env,f.machine,{},'no-redispatch',new Date(now.getTime()+121000))).toBeNull()
  expect(dispatches).toBe(1)
  expect(f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='group-stop'").get()).toEqual(audit)
 })
 it.each(['cancel','off'])('settles the complete group only after intentional precommit %s denial',async mode=>{
  const f=await setup();await queue(f,0);await queue(f,1)
  const a=await claimCollector(f.env,f.machine,{},'precommit',now);await receiptCollector(f.env,f.machine,capture(f,a),now)
  const publish=f.env.TENANT_NORTH_PUBLISHER.publish
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{if(mode==='cancel')await cancel(f,members(f,a).find(id=>id!==a.requestId));else{f.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED='false';f.tenantEnv.PLATFORM_COLLECTOR_EXECUTION_ENABLED='false'}return publish(...args)}
  expect(await publishCollector(f.env,f.machine,input(f,a),'publication',now)).toMatchObject({status:'preflight_retryable'})
  expect(states(f).every(r=>r.state===(mode==='cancel'?'cancelled':'failed'))).toBe(true)
  expect(f.tenant.prepare('SELECT COUNT(*) n FROM collector_publication_receipts').get().n).toBe(0)
  expect(['cancelled','expired']).toContain(row(f,a).stage)
 })
})
