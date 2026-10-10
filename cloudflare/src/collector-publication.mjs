import { importJWK, SignJWT } from 'jose'
import { platformOwner, tenantDatabase } from './platform-admin.mjs'
import { collectorIdentity } from './collector-auth.mjs'
import { currentAttempt, attemptGuard, scopeGuard, machineAudit } from './collector-execution.mjs'
import { canonical, collectorFail, digest, exactFields, executionEnabled, sha, text } from './collector-common.mjs'
import { decryptEnvelope, publishRelease, readReleaseWithIdentity, releaseReadiness, validatedReleaseCounts } from './worker.mjs'
import { verifyPublicationTicket, assertPublicationFence } from './collector-publication-guards.mjs'

function publicationBindings(env) {
 let mapping;try{mapping=JSON.parse(env.PLATFORM_COLLECTOR_PUBLICATION_BINDINGS||'{}')}catch{collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)}
 if(!mapping || Array.isArray(mapping) || typeof mapping!=='object')collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)
 const names=Object.values(mapping)
 if(names.some(n=>typeof n!=='string'||!/^TENANT_[A-Z0-9_]+_PUBLISHER$/.test(n)) || new Set(names).size!==names.length || new Set(names.map(n=>env[n])).size!==names.length)collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)
 return mapping
}
async function bindingFor(env,attempt) {
 await tenantDatabase(env,attempt.group_id)
 const name=publicationBindings(env)[attempt.group_id],binding=name&&env[name]
 if(!binding?.publish || !binding?.readReceipt)collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)
 return binding
}
export async function publicationTicket(env,attempt,operation,now=new Date()) {
 if(!env.COLLECTOR_PUBLICATION_PRIVATE_KEY)collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)
 let key;try{key=await importJWK(JSON.parse(env.COLLECTOR_PUBLICATION_PRIVATE_KEY),'EdDSA')}catch{collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)}
 const issued=Math.floor(now.getTime()/1000)
 return new SignJWT({operation,groupId:attempt.group_id,collectorId:attempt.collector_id,attemptId:attempt.id,fence:attempt.fence,grantGeneration:attempt.grant_generation,configSha256:attempt.config_sha256,scopeSha256:attempt.scope_sha256,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date}).setProtectedHeader({alg:'EdDSA'}).setIssuer('inventory-flow-collector-control').setAudience(`tenant/${attempt.group_id}`).setJti(`${attempt.id}:${attempt.fence}:${operation}`).setIssuedAt(issued).setExpirationTime(issued+30).sign(key)
}

const unknown = (db,id,requestId,date)=>db.batch([
 db.prepare("UPDATE platform_collector_attempts SET stage='reconciliation_required',failure_code='COLLECTOR_PUBLICATION_UNKNOWN' WHERE id=? AND stage='publishing'").bind(id),
 db.prepare("UPDATE platform_pull_requests SET state='reconciliation_required',updated_at=? WHERE id=? AND state='running'").bind(date,requestId),
 db.prepare('UPDATE platform_revision SET revision=revision+1 WHERE id=1'),
])
async function verifiedReceipt(env,attempt,binding,now) {
 const result=await binding.readReceipt(await publicationTicket(env,attempt,'read',now))
 if(!result || !['published_verified','unchanged_verified'].includes(result.status) || result.attemptId!==attempt.id || result.bundleSha256!==attempt.expected_bundle_sha256 || result.reportDate!==attempt.report_date || result.ready!==true || !Number.isSafeInteger(result.counts?.inventory) || result.counts.inventory<0 || !result.verifiedAt) return null
 const countNames=['inventory','managerDispositions','transfers','attention'];if(Object.keys(result.counts).some(k=>!countNames.includes(k)) || countNames.some(k=>!Number.isSafeInteger(result.counts[k]) || result.counts[k]<0) || !/^\d{4}-\d{2}-\d{2}T/.test(result.verifiedAt) || !Number.isFinite(Date.parse(result.verifiedAt)))return null
 const safe={status:result.status,attemptId:attempt.id,bundleSha256:result.bundleSha256,reportDate:result.reportDate,counts:result.counts,ready:true,verifiedAt:result.verifiedAt}
 const hash=await digest(safe),db=env.PLATFORM_DB,date=now.toISOString()
 const prior=await db.prepare("SELECT sanitized_json FROM platform_collector_receipts WHERE attempt_id=? AND kind='publication'").bind(attempt.id).first()
 if(prior)return JSON.parse(prior.sanitized_json)
 try{await db.batch([
 db.prepare('INSERT INTO platform_collector_receipts VALUES(?,1000000,\'publication\',?,?,?)').bind(attempt.id,hash,canonical(safe),date),
 db.prepare("UPDATE platform_collector_attempts SET stage='completed',completed_at=?,failure_code=NULL WHERE id=? AND expected_bundle_sha256=? AND stage IN ('publishing','reconciliation_required')").bind(date,attempt.id,result.bundleSha256),
 db.prepare("UPDATE platform_pull_requests SET state='completed',updated_at=? WHERE id=? AND state IN ('running','reconciliation_required')").bind(date,attempt.request_id),
 db.prepare('UPDATE platform_revision SET revision=revision+1 WHERE id=1'),
 machineAudit(db,{id:attempt.collector_id,name:'Tenant publication verifier'},attempt,'publication_verified',{stage:'completed',bundleSha256:result.bundleSha256},`publication:${attempt.id}`,hash,date),
 ])}catch{const replay=await db.prepare("SELECT sanitized_json FROM platform_collector_receipts WHERE attempt_id=? AND kind='publication'").bind(attempt.id).first();if(replay)return JSON.parse(replay.sanitized_json);collectorFail('COLLECTOR_UNAVAILABLE',503)}
 return safe
}

async function verifiedRejection(env,row,attempt,key) {
 // Receipt + dispatch + settlement audit were persisted together with the
 // failed request. A bare terminal stage or stale-lease response is no proof.
 const db=env.PLATFORM_DB,receipt=await db.prepare("SELECT * FROM platform_collector_receipts WHERE attempt_id=? AND sequence=1000001 AND kind='failure'").bind(attempt.id).first()
 if(!receipt || attempt.stage!=='failed' || attempt.failure_code!=='VALIDATION_FAILED' || attempt.request_state!=='failed')return null
 let proof;try{proof=JSON.parse(receipt.sanitized_json)}catch{return null}
 if(Object.keys(proof??{}).length!==3 || proof.kind!=='failure' || proof.code!=='VALIDATION_FAILED' || proof.at!==receipt.received_at || proof.at!==attempt.completed_at || !/^\d{4}-\d{2}-\d{2}T/.test(proof.at) || !Number.isFinite(Date.parse(proof.at)) || await digest(proof)!==receipt.payload_sha256)return null
 const hash=await digest({attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,configSha256:attempt.config_sha256})
 const dispatch=await db.prepare("SELECT request_hash FROM platform_audit WHERE actor_id=? AND target_id=? AND request_key=? AND action='publication_started'").bind(`collector:${row.id}`,attempt.id,`publish:${key}`).first()
 const rejection=await db.prepare("SELECT request_hash FROM platform_audit WHERE actor_id=? AND target_id=? AND request_key=? AND action='publication_rejected'").bind(`collector:${row.id}`,attempt.id,`publication-rejected:${attempt.id}`).first()
 if(dispatch?.request_hash!==hash || rejection?.request_hash!==receipt.payload_sha256)return null
 return {status:'rejected_verified',attemptId:attempt.id,fence:attempt.fence,idempotencyKey:key,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,code:'VALIDATION_FAILED',ready:false,verifiedAt:proof.at}
}

export async function publishCollector(env,claims,input,key,now=new Date(),clock=null) {
 const started=Date.now(),currentTime=clock??(()=>new Date(now.getTime()+Date.now()-started))
 // Identity precedes body/candidate lookup. Target group is never caller input.
 const row=await collectorIdentity(env,claims)
 exactFields(input,['attemptId','fence','configSha256','envelope']);text(key);sha(input.configSha256)
 exactFields(input.envelope,['version','reportDate','bundleSha256','iv','ciphertext']);sha(input.envelope.bundleSha256)
 const {attempt,scope}=await currentAttempt(env,claims,input.attemptId,input.fence,now,{publicationReplay:true,allowRejectedPublicationReplay:true})
 if(input.configSha256!==attempt.config_sha256 || input.envelope.reportDate!==attempt.report_date)collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 if(attempt.expected_bundle_sha256 && attempt.expected_bundle_sha256!==input.envelope.bundleSha256)collectorFail('COLLECTOR_RECEIPT_CONFLICT',409)
 if(attempt.stage==='failed')return await verifiedRejection(env,row,attempt,key)??{status:'reconciliation_required',attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,ready:false}
 const binding=await bindingFor(env,attempt)
 if(['publishing','reconciliation_required','completed'].includes(attempt.stage)) {
  const verified=await verifiedReceipt(env,attempt,binding,currentTime())
  return verified??{status:'reconciliation_required',attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,ready:false}
 }
 if(attempt.stage!=='captured')collectorFail('COLLECTOR_NO_CAPTURE',409)
 // Persist the one candidate before dispatch. A timeout never dispatches again.
 const authorization=await publicationTicket(env,{...attempt,expected_bundle_sha256:input.envelope.bundleSha256},'publish',now)
 const hash=await digest({attemptId:attempt.id,bundleSha256:input.envelope.bundleSha256,configSha256:input.configSha256})
 const priorDispatch=await env.PLATFORM_DB.prepare('SELECT request_hash FROM platform_audit WHERE actor_id=? AND request_key=?').bind(`collector:${row.id}`,`publish:${key}`).first()
 if(priorDispatch && priorDispatch.request_hash!==hash)collectorFail('COLLECTOR_RECEIPT_CONFLICT',409)
 try{await env.PLATFORM_DB.batch([
  attemptGuard(env.PLATFORM_DB,row,scope,attempt,now,['captured']),
  env.PLATFORM_DB.prepare("UPDATE platform_collector_attempts SET stage='publishing',expected_bundle_sha256=? WHERE id=?").bind(input.envelope.bundleSha256,attempt.id),
  ...(!priorDispatch?[machineAudit(env.PLATFORM_DB,row,attempt,'publication_started',{stage:'publishing',bundleSha256:input.envelope.bundleSha256},`publish:${key}`,hash,now.toISOString())]:[]),
 ])}catch{collectorFail('COLLECTOR_LEASE_STALE',409)}
 attempt.expected_bundle_sha256=input.envelope.bundleSha256;attempt.stage='publishing'
 try {
  const dispatched=await binding.publish(input.envelope,authorization)
  const fenceFields=['status','attemptId','requestId','groupId','collectorId','fence','grantGeneration','configSha256','scopeSha256','bundleSha256','baselineBundleSha256','sourceSha256','reportDate','precommitOnly','code']
  const fenceProof=dispatched?.status==='fence_rejected' && dispatched.precommitOnly===true && ['COLLECTOR_DISABLED','COLLECTOR_LEASE_STALE'].includes(dispatched.code) &&
   Object.keys(dispatched).length===fenceFields.length && Object.keys(dispatched).every(field=>fenceFields.includes(field)) &&
   dispatched.attemptId===attempt.id && dispatched.requestId===attempt.request_id && dispatched.groupId===attempt.group_id && dispatched.collectorId===attempt.collector_id &&
   dispatched.fence===attempt.fence && dispatched.grantGeneration===attempt.grant_generation && dispatched.configSha256===attempt.config_sha256 && dispatched.scopeSha256===attempt.scope_sha256 &&
   dispatched.bundleSha256===attempt.expected_bundle_sha256 && dispatched.baselineBundleSha256===JSON.parse(attempt.config_json).baselineBundleSha256 && dispatched.sourceSha256===attempt.source_sha256 && dispatched.reportDate===attempt.report_date
  if(fenceProof) {
   const date=currentTime().toISOString(),db=env.PLATFORM_DB,proofHash=await digest(dispatched)
   // No tenant release/receipt batch was admitted. Retire only this exact
   // dispatch; owner stops remain stops and execution OFF never requeues it.
   const match="a.id=? AND a.collector_id=? AND a.group_id=? AND a.request_id=? AND a.fence=? AND a.grant_generation=? AND a.config_sha256=? AND a.scope_sha256=? AND a.expected_bundle_sha256=? AND a.report_date=? AND a.config_json=? AND a.source_sha256=? AND a.capture_counts_json=? AND a.stage IN ('publishing','reconciliation_required')"
   const args=[attempt.id,row.id,attempt.group_id,attempt.request_id,attempt.fence,attempt.grant_generation,attempt.config_sha256,attempt.scope_sha256,attempt.expected_bundle_sha256,attempt.report_date,attempt.config_json,attempt.source_sha256,attempt.capture_counts_json]
   const ownerStopped="failure_code IN ('CANCELLED_BY_OWNER','COLLECTOR_REVOKED')"
   await db.batch([
    db.prepare(`UPDATE platform_revision SET revision=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id AND p.group_id=a.group_id WHERE ${match} AND p.state IN ('running','reconciliation_required')) AND EXISTS(SELECT 1 FROM platform_audit WHERE actor_id=? AND target_id=? AND request_key=? AND request_hash=? AND action='publication_started') AND NOT EXISTS(SELECT 1 FROM platform_collector_receipts WHERE attempt_id=? AND kind='publication') THEN revision+1 ELSE NULL END WHERE id=1`).bind(...args,`collector:${row.id}`,attempt.id,`publish:${key}`,hash,attempt.id),
    db.prepare(`UPDATE platform_pull_requests SET state=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE ${match} AND a.${ownerStopped}) THEN 'cancelled' ELSE 'failed' END,updated_at=? WHERE id=? AND state IN ('running','reconciliation_required') AND EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE ${match} AND a.request_id=platform_pull_requests.id)`).bind(...args,date,attempt.request_id,...args),
    db.prepare(`UPDATE platform_collector_attempts AS a SET stage=CASE WHEN ${ownerStopped} THEN 'cancelled' ELSE 'expired' END,failure_code=CASE WHEN ${ownerStopped} THEN failure_code ELSE ? END,completed_at=? WHERE ${match}`).bind(dispatched.code,date,...args),
    machineAudit(db,row,attempt,'publication_fence_rejected',dispatched,`fence-rejected:${attempt.id}`,proofHash,date),
   ])
   return {status:'preflight_retryable',attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,ready:false}
  }
  // A positive tenant RPC proof can release the no-redispatch fence. Preflight
  // did not enter publication; a revision conflict entered it but definitively
  // rolled back the atomic release/receipt batch. A thrown/lost reply cannot.
  const preflightProof=dispatched?.status==='preflight_retryable' && Object.keys(dispatched).length===1
  const revisionProof=dispatched?.status==='revision_retryable' && dispatched.atomicRollback===true && dispatched.attemptId===attempt.id && dispatched.fence===attempt.fence && dispatched.bundleSha256===attempt.expected_bundle_sha256 && dispatched.reportDate===attempt.report_date && Object.keys(dispatched).length===6 && Object.keys(dispatched).every(k=>['status','attemptId','fence','bundleSha256','reportDate','atomicRollback'].includes(k))
  if(preflightProof || revisionProof) {
   const fresh=currentTime(),date=fresh.toISOString(),db=env.PLATFORM_DB
   const proof=revisionProof?{attemptId:attempt.id,fence:attempt.fence,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,atomicRollback:true}:{attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,preflightOnly:true},proofHash=await digest(proof),proofKey=`${revisionProof?'revision':'preflight'}:${attempt.id}`
   const priorProof=await db.prepare('SELECT request_hash FROM platform_audit WHERE actor_id=? AND request_key=?').bind(`collector:${row.id}`,proofKey).first()
   if(priorProof && priorProof.request_hash!==proofHash)collectorFail('COLLECTOR_RECEIPT_CONFLICT',409)
   const proofAudit=()=>priorProof?[]:[machineAudit(db,row,attempt,revisionProof?'publication_revision_deferred':'publication_preflight_deferred',proof,proofKey,proofHash,date)]
   try{await db.batch([
    attemptGuard(db,row,scope,attempt,fresh,['publishing']),
    db.prepare("UPDATE platform_collector_attempts SET stage='captured' WHERE id=? AND stage='publishing' AND expected_bundle_sha256=?").bind(attempt.id,input.envelope.bundleSha256),
    ...proofAudit(),
   ])}catch{
    // The RPC positively proved that no tenant publication committed. If authority
    // or time expired during it, retire ONLY this exact attempt. A fresh claim
    // can retry an otherwise-authorized request within the original budget.
    // Owner cancellation/revocation stays non-runnable, but this proof resolves
    // its publication uncertainty and releases the exact attempt's group lock.
    const guard=scopeGuard(row,scope),match="a.id=? AND a.collector_id=? AND a.group_id=? AND a.request_id=? AND a.fence=? AND a.expected_bundle_sha256=? AND a.stage IN ('publishing','reconciliation_required')",args=[attempt.id,row.id,attempt.group_id,attempt.request_id,attempt.fence,attempt.expected_bundle_sha256]
    const ownerStopped="failure_code IN ('CANCELLED_BY_OWNER','COLLECTOR_REVOKED')"
    await db.batch([
     db.prepare(`UPDATE platform_revision SET revision=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id AND p.group_id=a.group_id WHERE ${match} AND p.state IN ('running','reconciliation_required')) AND EXISTS(SELECT 1 FROM platform_audit WHERE actor_id=? AND target_id=? AND request_key=? AND request_hash=? AND action='publication_started') THEN revision+1 ELSE NULL END WHERE id=1`).bind(...args,`collector:${row.id}`,attempt.id,`publish:${key}`,hash),
     db.prepare(`UPDATE platform_pull_requests SET state=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE ${match} AND a.${ownerStopped}) THEN 'cancelled' WHEN ?=1 AND ?<3 AND ${guard.sql} THEN 'queued' ELSE 'failed' END,updated_at=? WHERE id=? AND state IN ('running','reconciliation_required') AND EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE ${match} AND a.request_id=platform_pull_requests.id)`).bind(...args,executionEnabled(env)?1:0,attempt.fence,...guard.args,date,attempt.request_id,...args),
     db.prepare(`UPDATE platform_collector_attempts SET stage=CASE WHEN ${ownerStopped} THEN 'cancelled' ELSE 'expired' END,failure_code=CASE WHEN ${ownerStopped} THEN failure_code ELSE 'DURATION_EXCEEDED' END,completed_at=? WHERE id=? AND collector_id=? AND group_id=? AND request_id=? AND fence=? AND expected_bundle_sha256=? AND stage IN ('publishing','reconciliation_required')`).bind(date,...args),
     ...proofAudit(),
    ])
   }
   return {status:revisionProof?'revision_retryable':'preflight_retryable',attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,ready:false}
  }
  if(dispatched?.status==='rejected' && dispatched.code==='VALIDATION_FAILED' && Object.keys(dispatched).length===2) {
   const db=env.PLATFORM_DB,date=currentTime().toISOString()
   const receipt={kind:'failure',code:'VALIDATION_FAILED',at:date},receiptHash=await digest(receipt)
   // This positive tenant result proves no publication committed. Settle the
   // exact dispatched candidate even if an owner parked it during the RPC;
   // collector authority and the owner's audit are never rewritten.
   const match="a.id=? AND a.collector_id=? AND a.group_id=? AND a.request_id=? AND a.fence=? AND a.expected_bundle_sha256=? AND a.stage IN ('publishing','reconciliation_required')"
   const args=[attempt.id,row.id,attempt.group_id,attempt.request_id,attempt.fence,attempt.expected_bundle_sha256]
   await db.batch([
    db.prepare(`UPDATE platform_revision SET revision=CASE WHEN EXISTS(SELECT 1 FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id AND p.group_id=a.group_id WHERE ${match} AND p.state IN ('running','reconciliation_required')) AND EXISTS(SELECT 1 FROM platform_audit WHERE actor_id=? AND target_id=? AND request_key=? AND request_hash=? AND action='publication_started') THEN revision+1 ELSE NULL END WHERE id=1`).bind(...args,`collector:${row.id}`,attempt.id,`publish:${key}`,hash),
    db.prepare("INSERT INTO platform_collector_receipts VALUES(?,1000001,'failure',?,?,?)").bind(attempt.id,receiptHash,canonical(receipt),date),
    db.prepare(`UPDATE platform_pull_requests SET state='failed',updated_at=? WHERE id=? AND state IN ('running','reconciliation_required') AND EXISTS(SELECT 1 FROM platform_collector_attempts a WHERE ${match} AND a.request_id=platform_pull_requests.id)`).bind(date,attempt.request_id,...args),
    db.prepare("UPDATE platform_collector_attempts SET stage='failed',failure_code='VALIDATION_FAILED',completed_at=? WHERE id=? AND collector_id=? AND group_id=? AND request_id=? AND fence=? AND expected_bundle_sha256=? AND stage IN ('publishing','reconciliation_required')").bind(date,...args),
    machineAudit(db,{id:attempt.collector_id,name:'Tenant candidate validator'},attempt,'publication_rejected',{stage:'failed',code:'VALIDATION_FAILED'},`publication-rejected:${attempt.id}`,receiptHash,date),
   ])
   collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
  }
  // Publication can outlast a ticket's 30-second lifetime. Issue readback
  // authority only after dispatch returns, using the current settlement clock.
  const verified=await verifiedReceipt(env,attempt,binding,currentTime())
  if(verified)return verified
 }catch(error){if(error?.code==='COLLECTOR_PUBLICATION_INVALID')throw error;/* Persist only the fixed uncertain outcome; never a provider error. */}
 await unknown(env.PLATFORM_DB,attempt.id,attempt.request_id,currentTime().toISOString())
 return {status:'reconciliation_required',attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,ready:false}
}

export async function reconcileCollector(env,claims,groupId,input,now=new Date()) {
 await platformOwner(env.PLATFORM_DB,claims);exactFields(input,['attemptId'])
 const attempt=await env.PLATFORM_DB.prepare("SELECT * FROM platform_collector_attempts WHERE id=? AND group_id=? AND stage IN ('publishing','reconciliation_required','completed')").bind(text(input.attemptId),groupId).first()
 if(!attempt)collectorFail('COLLECTOR_SCOPE_MISMATCH',404)
 const result=await verifiedReceipt(env,attempt,await bindingFor(env,attempt),now)
 await platformOwner(env.PLATFORM_DB,claims)
 return result??{status:'reconciliation_required',attemptId:attempt.id,bundleSha256:attempt.expected_bundle_sha256,reportDate:attempt.report_date,ready:false}
}

// These functions are RPC business logic, never employee HTTP endpoints.
export async function publishTenantCandidate(env,envelope,authorization,testTime=null) {
 const clock=()=>testTime??new Date(),now=clock()
 const {ticket,attempt}=await verifyPublicationTicket(env,authorization,'publish',now,{deferFence:true})
 // This sentinel can originate only in an intentional precommit-check denial,
 // before publishRelease admits a release/receipt batch. Never classify a
 // generic thrown error or a post-admission failure as no-publication proof.
 const fenceRejection=new Error('Intentional precommit publication fence denial')
 let denialCode
 const check=async()=>{
  let rejected
  try{await assertPublicationFence(env,ticket,clock(),{onRejected:code=>{rejected=code}})}
  catch(error){if(rejected){denialCode=rejected;throw fenceRejection}throw error}
 }
 try {
 await check()
 let bundle,counts,baseline,config
 // Independently prove the tenant key and verified baseline are readable before
 // treating candidate decryption errors as definitive bad-input evidence.
 try{baseline=await readReleaseWithIdentity(env,{fresh:true})}catch{return {status:'preflight_retryable'}}
 try {
 if(envelope?.bundleSha256!==ticket.bundleSha256 || envelope.reportDate!==ticket.reportDate)collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 bundle=await decryptEnvelope(envelope,env)
 // Decryption validates the uploaded bytes before optional resource
 // normalization. Reuse those counts; normalized rows are not new provenance.
 counts=validatedReleaseCounts(bundle)
 }catch(error){
  if(error?.code==='COLLECTOR_PUBLICATION_INVALID' || ['INVALID_ENVELOPE','BODY_TOO_LARGE','INVALID_ENCRYPTED_CONTENT','INVALID_OR_INCOMPLETE_RELEASE'].includes(error?.code) || error?.message?.startsWith('Invalid cloud release:'))return {status:'rejected',code:'VALIDATION_FAILED'}
  return {status:'preflight_retryable'}
 }
 try {
 config=JSON.parse(attempt.config_json)
 if(baseline.bundleSha256!==config.baselineBundleSha256 || baseline.release.reportDate!==ticket.reportDate || bundle.release.sourceRuns.dealerMail.sha256!==attempt.source_sha256 || counts.dealerMailRowCount!==JSON.parse(attempt.capture_counts_json).dealerMailRows)collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 // Hold refresh may only change DealerMail evidence and its derived records.
 for(const field of ['publicSnapshot','publicChangeEvents','resourceSnapshot','managerDispositionOverlay'])if(canonical(bundle.release[field]??null)!==canonical(baseline.release[field]??null))collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 for(const [name,run] of Object.entries(bundle.release.sourceRuns))if(name!=='dealerMail' && canonical(run)!==canonical(baseline.release.sourceRuns[name]))collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 const candidates=new Map(bundle.release.vehicles.map(record=>[record.vin,record]))
 for(const original of baseline.release.vehicles){const record=candidates.get(original.vin);if(canonical(record?.publicRecord??null)!==canonical(original.publicRecord??null) || canonical(record?.resourceRecord??null)!==canonical(original.resourceRecord??null))collectorFail('COLLECTOR_PUBLICATION_INVALID',409);candidates.delete(original.vin)}
 for(const record of candidates.values())if(record.publicRecord || record.resourceRecord)collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 const storeNames={howell:'Howell',fowlerville:'Fowlerville','ford-detroit':'Ford Detroit',lincoln:'Lincoln'}
 if(config.dealerships.length!==4 || config.dealerships.some(d=>!storeNames[d.storeKey]))collectorFail('COLLECTOR_PUBLICATION_INVALID',409)
 }catch{return {status:'rejected',code:'VALIDATION_FAILED'}}
 const request=new Request('https://collector-binding.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)})
 return (await publishRelease(request,env,{ticket,now,baselineBundleSha256:config.baselineBundleSha256,check})).json()
 }catch(error){
  if(error!==fenceRejection)throw error
  return {status:'fence_rejected',attemptId:ticket.attemptId,requestId:attempt.request_id,groupId:ticket.groupId,collectorId:ticket.collectorId,fence:ticket.fence,grantGeneration:ticket.grantGeneration,configSha256:ticket.configSha256,scopeSha256:ticket.scopeSha256,bundleSha256:ticket.bundleSha256,baselineBundleSha256:JSON.parse(attempt.config_json).baselineBundleSha256,sourceSha256:attempt.source_sha256,reportDate:ticket.reportDate,precommitOnly:true,code:denialCode}
 }
}

export async function readTenantPublicationReceipt(env,authorization,now=new Date()) {
 const {ticket}=await verifyPublicationTicket(env,authorization,'read',now)
 const unknown=()=>({status:'reconciliation_required',attemptId:ticket.attemptId,ready:false})
 try {
 const receipt=await env.INVENTORY_DB.prepare('SELECT * FROM collector_publication_receipts WHERE attempt_id=? AND group_id=? AND collector_id=? AND fence=? AND grant_generation=? AND config_sha256=? AND bundle_sha256=? AND report_date=?').bind(ticket.attemptId,ticket.groupId,ticket.collectorId,ticket.fence,ticket.grantGeneration,ticket.configSha256,ticket.bundleSha256,ticket.reportDate).first()
 if(!receipt || [['attempt_id','attemptId'],['group_id','groupId'],['collector_id','collectorId'],['fence','fence'],['grant_generation','grantGeneration'],['config_sha256','configSha256'],['bundle_sha256','bundleSha256'],['report_date','reportDate']].some(([field,claim])=>receipt[field]!==ticket[claim]) || !['published','unchanged'].includes(receipt.status) || !/^\d{4}-\d{2}-\d{2}T/.test(receipt.accepted_at) || !Number.isFinite(Date.parse(receipt.accepted_at)))return unknown()
 // A newer release does not undo this append-only commit receipt. Verify the
 // exact accepted immutable artifact, never the current pointer or a cache.
 const version=await env.INVENTORY_DB.prepare("SELECT * FROM cloud_release_versions WHERE bundle_sha256=? AND report_date=? AND status IN ('current','superseded')").bind(receipt.bundle_sha256,receipt.report_date).first()
 if(!version || !['current','superseded'].includes(version.status) || version.bundle_sha256!==receipt.bundle_sha256 || version.report_date!==receipt.report_date || version.object_key!==`releases/${receipt.report_date}/${receipt.bundle_sha256}.json.enc`)return unknown()
 const object=await env.RELEASE_SNAPSHOTS.get(version.object_key)
 if(!object || !Number.isSafeInteger(object.size) || object.size<1 || object.size>25*1024*1024 || object.size!==version.object_bytes)return unknown()
 const envelope=JSON.parse(await object.text())
 if(envelope.bundleSha256!==receipt.bundle_sha256 || envelope.reportDate!==receipt.report_date)return unknown()
 const bundle=await decryptEnvelope(envelope,env),counts=validatedReleaseCounts(bundle),metadata=JSON.parse(version.metadata_json)
 if(bundle.reportDate!==receipt.report_date || canonical(counts)!==canonical(JSON.parse(receipt.counts_json)) || version.public_source_sha256!==bundle.release.sourceRuns.public.sha256 || version.dealermail_source_sha256!==bundle.release.sourceRuns.dealerMail.sha256 || version.public_row_count!==counts.publicRowCount || version.dealermail_row_count!==counts.dealerMailRowCount || metadata.completedAt!==bundle.release.completedAt || metadata.timezone!==bundle.release.timezone)return unknown()
 const readiness=await releaseReadiness(env,bundle.release,receipt.bundle_sha256)
 if(!readiness.ready || readiness.bundleSha256!==receipt.bundle_sha256 || readiness.reportDate!==receipt.report_date || readiness.counts.inventory!==counts.activeInventoryCount)return unknown()
 return {status:receipt.status==='published'?'published_verified':'unchanged_verified',attemptId:ticket.attemptId,bundleSha256:receipt.bundle_sha256,reportDate:receipt.report_date,counts:readiness.counts,ready:true,verifiedAt:now.toISOString()}
 }catch{return unknown()}
}
