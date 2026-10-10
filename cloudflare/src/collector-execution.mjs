import { platformOwner, tenantDatabase } from './platform-admin.mjs'
import { collectorIdentity } from './collector-auth.mjs'
import { canonical, collectorFail, digest, exactFields, executionEnabled, integer, profileIdentity, sha, stringList, text } from './collector-common.mjs'

export const COLLECTOR_FAILURE_CODES = ['BASELINE_REQUIRED','RECONCILIATION_REQUIRED','NEEDS_SIGN_IN','BROWSER_UNAVAILABLE','CAPTURE_INCOMPLETE','CAPTURE_FAILED','VALIDATION_FAILED','ADAPTER_DEPENDENCY_MISSING','PROFILE_SCOPE_MISMATCH','DISALLOWED_SOURCE','HOST_IO_FAILED','DURATION_EXCEEDED']
const timestamp = date => date.toISOString()
const COLLECTOR_TIMEZONE = 'America/New_York'
const updated = async(db,sql,...args)=>(await db.batch([db.prepare(sql).bind(...args)]))[0]
const ownerMutation = (db,actor,revision)=>db.prepare('UPDATE platform_revision SET revision=CASE WHEN revision=? AND EXISTS(SELECT 1 FROM platform_owners WHERE id=? AND enabled=1) THEN revision+1 ELSE NULL END WHERE id=1').bind(revision,actor.id)
const audit = (db,actor,entity,id,action,reason,previous,next,key,hash,now)=>db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,actor.name,entity,id,action,reason,previous?canonical(previous):null,canonical(next),key,hash,now)
const groupRow = async(db,id)=>{const row=await db.prepare('SELECT * FROM platform_groups WHERE id=?').bind(id).first();if(!row)collectorFail('COLLECTOR_SCOPE_MISMATCH',404);return row}

export async function collectorScope(env,row,{active=false}={}) {
 const db=env.PLATFORM_DB,group=await groupRow(db,row.group_id)
 const dealers=(await db.prepare('SELECT id,store_key,enabled FROM platform_dealerships WHERE group_id=? ORDER BY id').bind(row.group_id).all()).results
 const grants=(await db.prepare('SELECT c.* FROM platform_collector_grants p JOIN platform_data_connections c ON c.id=p.connection_id AND c.group_id=p.group_id AND c.dealership_id=p.dealership_id WHERE p.collector_id=? ORDER BY c.id').bind(row.id).all()).results
 // This installed adapter is explicitly the existing FOUR-store capture.
 if(dealers.length!==4 || grants.length!==4 || dealers.some(d=>!d.enabled) || new Set(grants.map(c=>c.dealership_id)).size!==4 || new Set(grants.map(c=>c.credential_ref)).size!==1 || grants.some(c=>!dealers.some(d=>d.id===c.dealership_id) || c.provider!=='dealermail' || c.method!=='collector' || c.endpoint!=='' || c.oem!=='not_applicable' || c.timezone!==COLLECTOR_TIMEZONE))collectorFail('COLLECTOR_SCOPE_MISMATCH',409)
 if(active && (group.status!=='active' || grants.some(c=>!c.enabled)))collectorFail('COLLECTOR_DISABLED',409)
 const scope={groupId:row.group_id,dealerships:dealers.map(d=>({id:d.id,storeKey:d.store_key})),connectionIds:grants.map(c=>c.id)}
 if(await digest(scope)!==row.scope_sha256)collectorFail('COLLECTOR_SCOPE_MISMATCH',409)
 return {...scope,connections:grants.map(c=>({id:c.id,dealershipId:c.dealership_id,provider:c.provider,vendor:c.vendor,oem:c.oem,method:c.method,endpoint:c.endpoint,credentialRef:c.credential_ref,enabled:Boolean(c.enabled),cadence:c.cadence,localTime:c.local_time,timezone:c.timezone,updatedAt:c.updated_at}))}
}

// Every authority/configuration field is rechecked inside the D1 transaction.
// CASE ... ELSE NULL deliberately aborts the whole batch on a stale guard.
export function scopeGuard(row,scope) {
 const clauses=["EXISTS(SELECT 1 FROM platform_collectors h JOIN platform_groups g ON g.id=h.group_id WHERE h.id=? AND h.group_id=? AND h.generation=? AND h.enabled=1 AND h.revoked_at IS NULL AND h.profile_sha256=? AND h.scope_sha256=? AND g.status='active')","(SELECT COUNT(*) FROM platform_dealerships WHERE group_id=?)=4","(SELECT COUNT(*) FROM platform_collector_grants WHERE collector_id=?)=4"]
 const args=[row.id,row.group_id,row.generation,row.profile_sha256,row.scope_sha256,row.group_id,row.id]
 for(const c of scope.connections){clauses.push("EXISTS(SELECT 1 FROM platform_data_connections c JOIN platform_dealerships d ON d.id=c.dealership_id JOIN platform_collector_grants p ON p.connection_id=c.id AND p.dealership_id=d.id AND p.group_id=c.group_id WHERE p.collector_id=? AND c.id=? AND c.group_id=? AND c.dealership_id=? AND d.group_id=? AND d.store_key=? AND d.enabled=1 AND c.enabled=1 AND c.provider=? AND c.vendor=? AND c.oem=? AND c.method=? AND c.endpoint=? AND c.credential_ref=? AND c.cadence=? AND c.local_time=? AND c.timezone=? AND c.updated_at=?)");args.push(row.id,c.id,row.group_id,c.dealershipId,row.group_id,scope.dealerships.find(d=>d.id===c.dealershipId).storeKey,c.provider,c.vendor,c.oem,c.method,c.endpoint,c.credentialRef,c.cadence,c.localTime,c.timezone,c.updatedAt)}
 return {sql:clauses.join(' AND '),args}
}
export const machineAudit=(db,row,attempt,action,next,key,hash,date)=>audit(db,{id:`collector:${row.id}`,name:row.name},'collector_attempts',attempt.id,action,'Registered collector execution',null,next,key,hash,date)
export function attemptGuard(db,row,scope,attempt,now,stages=['claimed','captured'],{bump=true}={}) {
 const guard=scopeGuard(row,scope),date=timestamp(now)
 return db.prepare(`UPDATE platform_revision SET revision=CASE WHEN ${guard.sql} AND EXISTS(SELECT 1 FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id WHERE a.id=? AND a.collector_id=? AND a.fence=? AND a.grant_generation=? AND a.config_sha256=? AND a.stage IN (${stages.map(()=>'?').join(',')}) AND a.lease_until>? AND a.hard_deadline>? AND p.state='running') THEN ${bump?'revision+1':'revision'} ELSE NULL END WHERE id=1`).bind(...guard.args,attempt.id,row.id,attempt.fence,row.generation,attempt.config_sha256,...stages,date,date)
}

export async function readCollectors(env,claims,groupId,now=new Date()) {
 await platformOwner(env.PLATFORM_DB,claims);await groupRow(env.PLATFORM_DB,groupId)
 const rows=(await env.PLATFORM_DB.prepare('SELECT * FROM platform_collectors WHERE group_id=? ORDER BY name,id').bind(groupId).all()).results
 const collectors=[]
 for(const row of rows){const grants=(await env.PLATFORM_DB.prepare('SELECT connection_id,dealership_id FROM platform_collector_grants WHERE collector_id=? ORDER BY connection_id').bind(row.id).all()).results;const age=row.last_seen_at?(now.getTime()-Date.parse(row.last_seen_at)):Infinity;collectors.push({id:row.id,groupId:row.group_id,name:row.name,accessClientId:row.access_client_id,...profileIdentity(row),scopeSha256:row.scope_sha256,enabled:Boolean(row.enabled),generation:row.generation,revokedAt:row.revoked_at,lastSeenAt:row.last_seen_at,connected:executionEnabled(env)&&Boolean(row.enabled)&&!row.revoked_at&&age>=0&&age<=90000,dealershipIds:grants.map(g=>g.dealership_id).sort(),connectionIds:grants.map(g=>g.connection_id),scopeLabel:'Group-wide DealerMail refresh · all four registered dealerships'})}
 const attempts=(await env.PLATFORM_DB.prepare('SELECT * FROM platform_collector_attempts WHERE group_id=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(groupId).all()).results.map(row=>({id:row.id,requestId:row.request_id,collectorId:row.collector_id,fence:row.fence,stage:row.stage,createdAt:row.created_at,leaseUntil:row.lease_until,capturedAt:row.captured_at,bundleSha256:row.expected_bundle_sha256,reportDate:row.report_date,failureCode:row.failure_code,completedAt:row.completed_at}))
 for(const attempt of attempts){const receipt=await env.PLATFORM_DB.prepare("SELECT sanitized_json,received_at FROM platform_collector_receipts WHERE attempt_id=? AND kind='publication'").bind(attempt.id).first();if(receipt){const proof=JSON.parse(receipt.sanitized_json);attempt.publication={status:'published_and_verified',verifiedAt:proof.verifiedAt,bundleSha256:proof.bundleSha256,vehicleCount:proof.counts.inventory}}}
 const revision=await env.PLATFORM_DB.prepare('SELECT revision FROM platform_revision WHERE id=1').first()
 await platformOwner(env.PLATFORM_DB,claims)
 return {groupId,revision:revision.revision,executionEnabled:executionEnabled(env),collectors,attempts}
}

export async function saveCollector(env,claims,groupId,input,key,now=new Date()) {
 const db=env.PLATFORM_DB,actor=await platformOwner(db,claims);await groupRow(db,groupId)
 exactFields(input,['operation','id','name','accessClientId','adapterId','adapterVersion','profileId','profileSha256','dealershipIds','connectionIds','reason','expectedRevision'])
 const reason=text(input.reason,500);if(reason.length<3)collectorFail('COLLECTOR_INPUT_INVALID')
 integer(input.expectedRevision);text(key);const hash=await digest({groupId,input})
 const prior=await db.prepare('SELECT request_hash,target_id FROM platform_audit WHERE actor_id=? AND request_key=?').bind(actor.id,key).first()
 if(prior){if(prior.request_hash!==hash)collectorFail('COLLECTOR_CONFLICT',409);return {saved:true,id:prior.target_id,replayed:true}}
 const date=timestamp(now);let id,previous=null,next,statements=[]
 if(input.operation==='enroll'){
  if(input.id || input.adapterId!=='dealermail-hold-refresh' || input.adapterVersion!=='1')collectorFail('COLLECTOR_INPUT_INVALID')
  const dealerIds=stringList(input.dealershipIds),connectionIds=stringList(input.connectionIds)
  const dealers=(await db.prepare('SELECT id,store_key,enabled FROM platform_dealerships WHERE group_id=? ORDER BY id').bind(groupId).all()).results
  if(dealers.length!==4 || canonical(dealerIds)!==canonical(dealers.map(d=>d.id)) || dealers.some(d=>!d.enabled) || connectionIds.length!==4)collectorFail('COLLECTOR_SCOPE_MISMATCH',409)
  const connections=[]
  for(const connectionId of connectionIds){const c=await db.prepare('SELECT * FROM platform_data_connections WHERE id=? AND group_id=?').bind(connectionId,groupId).first();if(!c || c.provider!=='dealermail' || c.method!=='collector' || c.endpoint!=='' || c.oem!=='not_applicable' || !dealerIds.includes(c.dealership_id))collectorFail('COLLECTOR_SCOPE_MISMATCH',409);connections.push(c)}
  if(new Set(connections.map(c=>c.dealership_id)).size!==4 || connections.some(c=>c.timezone!==COLLECTOR_TIMEZONE))collectorFail('COLLECTOR_SCOPE_MISMATCH',409)
  await tenantDatabase(env,groupId)
  id=crypto.randomUUID();const scopeSha=await digest({groupId,dealerships:dealers.map(d=>({id:d.id,storeKey:d.store_key})),connectionIds})
  next={id,groupId,name:text(input.name),accessClientId:text(input.accessClientId),adapterId:input.adapterId,adapterVersion:input.adapterVersion,profileId:text(input.profileId),profileSha256:sha(input.profileSha256),scopeSha256:scopeSha,enabled:false}
  statements.push(db.prepare('INSERT INTO platform_collectors VALUES(?,?,?,?,?,?,?,?,?,0,1,NULL,?,?,NULL)').bind(id,groupId,next.accessClientId,next.name,next.adapterId,next.adapterVersion,next.profileId,next.profileSha256,scopeSha,date,date))
  for(const c of connections)statements.push(db.prepare('INSERT INTO platform_collector_grants VALUES(?,?,?,?)').bind(id,c.id,c.dealership_id,groupId))
 }else if(['enable','revoke'].includes(input.operation)){
  if(Object.keys(input).some(k=>!['operation','id','reason','expectedRevision'].includes(k)))collectorFail('COLLECTOR_INPUT_INVALID')
  id=text(input.id);previous=await db.prepare('SELECT * FROM platform_collectors WHERE id=? AND group_id=?').bind(id,groupId).first();if(!previous)collectorFail('COLLECTOR_SCOPE_MISMATCH',404)
  if(input.operation==='enable') {if(previous.enabled)collectorFail('COLLECTOR_CONFLICT',409);if(previous.revoked_at)collectorFail('COLLECTOR_REVOKED',409);await collectorScope(env,previous,{active:true});await tenantDatabase(env,groupId)}
  next={id,enabled:input.operation==='enable',revokedAt:input.operation==='revoke'?date:null,generation:previous.generation+1}
  statements.push(db.prepare('UPDATE platform_collectors SET enabled=?,generation=generation+1,revoked_at=?,updated_at=? WHERE id=? AND group_id=?').bind(Number(next.enabled),next.revokedAt,date,id,groupId))
  if(input.operation==='revoke'){
   statements.push(db.prepare("UPDATE platform_pull_requests SET state=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE a.request_id=platform_pull_requests.id AND a.collector_id=? AND a.stage IN ('publishing','reconciliation_required')) THEN 'reconciliation_required' ELSE 'cancelled' END,updated_at=? WHERE id IN (SELECT request_id FROM platform_collector_attempts WHERE collector_id=? AND stage IN ('claimed','captured','publishing','reconciliation_required'))").bind(id,date,id))
   statements.push(db.prepare("UPDATE platform_collector_attempts SET stage=CASE WHEN stage IN ('publishing','reconciliation_required') THEN 'reconciliation_required' ELSE 'cancelled' END,failure_code='COLLECTOR_REVOKED' WHERE collector_id=? AND stage IN ('claimed','captured','publishing','reconciliation_required')").bind(id))
  }
 }else collectorFail('COLLECTOR_INPUT_INVALID')
 try {await db.batch([ownerMutation(db,actor,input.expectedRevision),...statements,audit(db,actor,'collectors',id,input.operation,reason,previous?{id,enabled:Boolean(previous.enabled),revokedAt:previous.revoked_at,generation:previous.generation}:null,next,key,hash,date)])}
 catch {await platformOwner(db,claims);const retry=await db.prepare('SELECT request_hash,target_id FROM platform_audit WHERE actor_id=? AND request_key=?').bind(actor.id,key).first();if(retry?.request_hash===hash)return {saved:true,id:retry.target_id,replayed:true};collectorFail('COLLECTOR_CONFLICT',409)}
 return {saved:true,id,replayed:false}
}

export async function contactCollector(env,claims,input,now=new Date()) {
 exactFields(input,['profileSha256','adapterVersion']);const row=await collectorIdentity(env,claims,{allowDisabled:true})
 if(input.profileSha256!==row.profile_sha256 || input.adapterVersion!==row.adapter_version)collectorFail('COLLECTOR_PROFILE_MISMATCH',409)
 await collectorScope(env,row)
 await updated(env.PLATFORM_DB,'UPDATE platform_collectors SET last_seen_at=? WHERE id=? AND generation=? AND revoked_at IS NULL',timestamp(now),row.id,row.generation)
 await collectorIdentity(env,claims,{allowDisabled:true})
 return {collectorId:row.id,enabled:Boolean(row.enabled),executionEnabled:executionEnabled(env),scopeSha256:row.scope_sha256,profileSha256:row.profile_sha256,adapterVersion:row.adapter_version,connected:true,checkedAt:timestamp(now)}
}

export async function claimCollector(env,claims,input,key,now=new Date()) {
 exactFields(input,[]);text(key);const row=await collectorIdentity(env,claims),scope=await collectorScope(env,row,{active:true}),db=env.PLATFORM_DB,date=timestamp(now)
 if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='platform_collector_one_group'").first())collectorFail('COLLECTOR_SCHEMA_REQUIRED',503)
 const tenant=await tenantDatabase(env,row.group_id)
 const baseline=await tenant.prepare("SELECT v.bundle_sha256,v.report_date FROM cloud_release_state s JOIN cloud_release_versions v ON v.release_id=s.value WHERE s.key='current_release_id' AND v.status='current'").first()
 const prior=await db.prepare('SELECT * FROM platform_collector_attempts WHERE collector_id=? AND claim_key=?').bind(row.id,key).first()
 if(prior){await currentAttempt(env,claims,prior.id,prior.fence,now);return leaseProjection(prior,row)}
 // A dead host's safe capture lease can be reclaimed by another enrolled
 // host for the same profile. In-flight publication is never re-dispatched.
 await db.batch([
  db.prepare("UPDATE platform_pull_requests SET state=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE a.request_id=platform_pull_requests.id AND a.stage='publishing' AND a.lease_until<=? AND json_extract(a.config_json,'$.profileSha256')=? AND json_extract(a.config_json,'$.adapterId')=? AND json_extract(a.config_json,'$.adapterVersion')=?) THEN 'reconciliation_required' WHEN (SELECT MAX(fence) FROM platform_collector_attempts a WHERE a.request_id=platform_pull_requests.id AND json_extract(a.config_json,'$.profileSha256')=? AND json_extract(a.config_json,'$.adapterId')=? AND json_extract(a.config_json,'$.adapterVersion')=?)>=3 THEN 'failed' ELSE 'queued' END,updated_at=? WHERE id IN (SELECT request_id FROM platform_collector_attempts WHERE group_id=? AND profile_id=? AND stage IN ('claimed','captured','publishing') AND lease_until<=? AND json_extract(config_json,'$.profileSha256')=? AND json_extract(config_json,'$.adapterId')=? AND json_extract(config_json,'$.adapterVersion')=?)").bind(date,row.profile_sha256,row.adapter_id,row.adapter_version,row.profile_sha256,row.adapter_id,row.adapter_version,date,row.group_id,row.profile_id,date,row.profile_sha256,row.adapter_id,row.adapter_version),
  db.prepare("UPDATE platform_collector_attempts SET stage=CASE WHEN stage='publishing' THEN 'reconciliation_required' ELSE 'expired' END,failure_code='DURATION_EXCEEDED' WHERE group_id=? AND profile_id=? AND stage IN ('claimed','captured','publishing') AND lease_until<=? AND json_extract(config_json,'$.profileSha256')=? AND json_extract(config_json,'$.adapterId')=? AND json_extract(config_json,'$.adapterVersion')=?").bind(row.group_id,row.profile_id,date,row.profile_sha256,row.adapter_id,row.adapter_version),
 ])

 // All profiles publish one group snapshot. Unknown outcomes retain this lock.
 const groupIdle="NOT EXISTS(SELECT 1 FROM platform_collector_attempts WHERE group_id=? AND stage IN ('claimed','captured','publishing','reconciliation_required'))"
 if(await db.prepare("SELECT id FROM platform_collector_attempts WHERE group_id=? AND stage IN ('claimed','captured','publishing','reconciliation_required') LIMIT 1").bind(row.group_id).first())return null

 const request=await db.prepare("SELECT p.* FROM platform_pull_requests p JOIN platform_collector_grants g ON g.connection_id=p.connection_id AND g.group_id=p.group_id WHERE g.collector_id=? AND p.state='queued' AND NOT EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE a.request_id=p.id AND (json_extract(a.config_json,'$.profileSha256') IS NOT ? OR json_extract(a.config_json,'$.adapterId') IS NOT ? OR json_extract(a.config_json,'$.adapterVersion') IS NOT ?)) ORDER BY p.created_at,p.id LIMIT 1").bind(row.id,row.profile_sha256,row.adapter_id,row.adapter_version).first()
 if(!request)return null
 const reportDate=new Intl.DateTimeFormat('en-CA',{timeZone:COLLECTOR_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
 if(!baseline || baseline.report_date!==reportDate || !/^[a-f0-9]{64}$/.test(baseline.bundle_sha256??''))collectorFail('COLLECTOR_BASELINE_REQUIRED',409)
 const config={...profileIdentity(row),...scope,targetConnectionId:request.connection_id,grantGeneration:row.generation,baselineBundleSha256:baseline.bundle_sha256},configJson=canonical(config),configSha=await digest(config)
 const id=crypto.randomUUID(),lease=timestamp(new Date(now.getTime()+120000)),deadline=timestamp(new Date(now.getTime()+2700000))
 const priorFence=await db.prepare('SELECT COALESCE(MAX(fence),0) AS fence FROM platform_collector_attempts WHERE request_id=?').bind(request.id).first(),fence=priorFence.fence+1
 const guard=scopeGuard(row,scope)
 try{
  await db.batch([
   db.prepare(`UPDATE platform_pull_requests SET state=CASE WHEN state='queued' AND ${guard.sql} AND ${groupIdle} THEN 'running' ELSE NULL END,updated_at=? WHERE id=?`).bind(...guard.args,row.group_id,date,request.id),
   db.prepare("INSERT INTO platform_collector_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'claimed',NULL,NULL,NULL,NULL,?,NULL,NULL)").bind(id,request.id,row.id,row.group_id,row.profile_id,row.generation,fence,key,configJson,configSha,row.scope_sha256,date,lease,deadline,reportDate),
   db.prepare('UPDATE platform_revision SET revision=revision+1 WHERE id=1'),
   machineAudit(db,row,{id},'claimed',{requestId:request.id,fence,stage:'claimed'},`claim:${key}`,configSha,date),
  ])
 }catch{const retry=await db.prepare('SELECT * FROM platform_collector_attempts WHERE collector_id=? AND claim_key=?').bind(row.id,key).first();if(retry){await currentAttempt(env,claims,retry.id,retry.fence,now);return leaseProjection(retry,row)};return null}

 const attempt=await db.prepare('SELECT * FROM platform_collector_attempts WHERE id=?').bind(id).first()
 await currentAttempt(env,claims,id,fence,now)
 await updated(db,'UPDATE platform_collectors SET last_seen_at=? WHERE id=? AND generation=?',date,row.id,row.generation)
 return leaseProjection(attempt,row)
}

function leaseProjection(attempt,row) {const config=JSON.parse(attempt.config_json);return {attemptId:attempt.id,requestId:attempt.request_id,fence:attempt.fence,leaseUntil:attempt.lease_until,hardDeadline:attempt.hard_deadline,configSha256:attempt.config_sha256,scopeSha256:attempt.scope_sha256,grantGeneration:attempt.grant_generation,...profileIdentity(row),groupId:attempt.group_id,dealerships:config.dealerships,connectionIds:config.connectionIds,credentialRef:config.connections.find(c=>c.id===config.targetConnectionId).credentialRef,baselineBundleSha256:config.baselineBundleSha256,reportDate:attempt.report_date}}

export async function currentAttempt(env,claims,id,fence,now=new Date(),{publicationReplay=false,allowPublishing=false}={}) {
 text(id);integer(fence,1);const row=await collectorIdentity(env,claims),db=env.PLATFORM_DB
 const attempt=await db.prepare('SELECT a.*,p.state AS request_state FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id WHERE a.id=? AND a.collector_id=? AND a.group_id=?').bind(id,row.id,row.group_id).first()
 if(!attempt || attempt.fence!==fence || attempt.grant_generation!==row.generation)collectorFail('COLLECTOR_LEASE_STALE',409)
 const scope=await collectorScope(env,row,{active:true})
 const config={...profileIdentity(row),...scope,targetConnectionId:JSON.parse(attempt.config_json).targetConnectionId,grantGeneration:row.generation,baselineBundleSha256:JSON.parse(attempt.config_json).baselineBundleSha256}
 if(await digest(config)!==attempt.config_sha256)collectorFail('COLLECTOR_LEASE_STALE',409)
 const replay=publicationReplay && ['completed','reconciliation_required','publishing'].includes(attempt.stage)
 if(!replay && (!(allowPublishing?['claimed','captured','publishing']:['claimed','captured']).includes(attempt.stage) || attempt.request_state!=='running' || Date.parse(attempt.lease_until)<=now.getTime() || Date.parse(attempt.hard_deadline)<=now.getTime()))collectorFail('COLLECTOR_LEASE_STALE',409)
 return {attempt,row,scope}
}

export async function heartbeatCollector(env,claims,input,now=new Date()) {
 exactFields(input,['attemptId','fence','profileSha256','adapterVersion']);const {attempt,row,scope}=await currentAttempt(env,claims,input.attemptId,input.fence,now,{allowPublishing:true})
 if(input.profileSha256!==row.profile_sha256 || input.adapterVersion!==row.adapter_version)collectorFail('COLLECTOR_PROFILE_MISMATCH',409)
 const lease=timestamp(new Date(Math.min(now.getTime()+120000,Date.parse(attempt.hard_deadline))))
 try{await env.PLATFORM_DB.batch([
  attemptGuard(env.PLATFORM_DB,row,scope,attempt,now,['claimed','captured','publishing'],{bump:false}),
  env.PLATFORM_DB.prepare('UPDATE platform_collector_attempts SET lease_until=? WHERE id=?').bind(lease,attempt.id),
 ])}catch{collectorFail('COLLECTOR_LEASE_STALE',409)}
 await updated(env.PLATFORM_DB,'UPDATE platform_collectors SET last_seen_at=? WHERE id=? AND generation=?',timestamp(now),row.id,row.generation)
 await currentAttempt(env,claims,attempt.id,attempt.fence,now,{allowPublishing:true})
 return {continue:true,leaseUntil:lease}
}

export async function receiptCollector(env,claims,input,now=new Date()) {
 exactFields(input,['attemptId','fence','sequence','kind','capturedAt','sourceSha256','counts','code']);text(input.attemptId);integer(input.fence,1);integer(input.sequence,1,999999)
 const row=await collectorIdentity(env,claims),db=env.PLATFORM_DB
 const owned=await db.prepare('SELECT * FROM platform_collector_attempts WHERE id=? AND collector_id=? AND group_id=? AND fence=?').bind(input.attemptId,row.id,row.group_id,input.fence).first();if(!owned)collectorFail('COLLECTOR_LEASE_STALE',409)
 if(input.kind==='capture'){
  if(input.code!==undefined || typeof input.capturedAt!=='string' || !Number.isFinite(Date.parse(input.capturedAt)) || Date.parse(input.capturedAt)<Date.parse(owned.created_at) || Date.parse(input.capturedAt)>now.getTime()+30000)collectorFail('COLLECTOR_INPUT_INVALID')
  sha(input.sourceSha256);exactFields(input.counts,['dealerMailRows']);integer(input.counts.dealerMailRows)
 }else if(input.kind==='failure'){
  if(!COLLECTOR_FAILURE_CODES.includes(input.code) || input.capturedAt!==undefined || input.sourceSha256!==undefined || input.counts!==undefined)collectorFail('COLLECTOR_INPUT_INVALID')
 }else collectorFail('COLLECTOR_INPUT_INVALID')
 const hash=await digest(input),prior=await db.prepare('SELECT payload_sha256 FROM platform_collector_receipts WHERE attempt_id=? AND sequence=?').bind(input.attemptId,input.sequence).first()
 if(prior){if(prior.payload_sha256!==hash)collectorFail('COLLECTOR_RECEIPT_CONFLICT',409);return {saved:true,replayed:true}}
 const {attempt,scope}=await currentAttempt(env,claims,input.attemptId,input.fence,now)
 if(input.kind==='capture' && attempt.stage!=='claimed')collectorFail('COLLECTOR_RECEIPT_CONFLICT',409)
 const date=timestamp(now),stage=input.kind==='capture'?'captured':'failed'
 try{await db.batch([
  attemptGuard(db,row,scope,attempt,now,input.kind==='capture'?['claimed']:['claimed','captured']),
  db.prepare('UPDATE platform_collector_attempts SET stage=?,captured_at=?,source_sha256=?,capture_counts_json=?,failure_code=?,completed_at=? WHERE id=?').bind(stage,input.capturedAt??attempt.captured_at,input.sourceSha256??attempt.source_sha256,input.counts?canonical(input.counts):attempt.capture_counts_json,input.code??null,input.kind==='failure'?date:null,input.attemptId),
  db.prepare('INSERT INTO platform_collector_receipts VALUES(?,?,?,?,?,?)').bind(input.attemptId,input.sequence,input.kind,hash,canonical(input),date),
  machineAudit(db,row,attempt,input.kind,{stage,code:input.code??null},`receipt:${attempt.id}:${input.sequence}`,hash,date),
  ...(input.kind==='failure'?[db.prepare("UPDATE platform_pull_requests SET state='failed',updated_at=? WHERE id=?").bind(date,attempt.request_id)]:[]),
 ])}catch{const replay=await db.prepare('SELECT payload_sha256 FROM platform_collector_receipts WHERE attempt_id=? AND sequence=?').bind(input.attemptId,input.sequence).first();if(replay){if(replay.payload_sha256===hash)return {saved:true,replayed:true};collectorFail('COLLECTOR_RECEIPT_CONFLICT',409)}collectorFail('COLLECTOR_LEASE_STALE',409)}
 return {saved:true,replayed:false}
}
