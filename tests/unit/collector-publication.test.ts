// @ts-nocheck -- synthetic actual SQLite, encrypted evidence, R2 and signed RPC.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { createSyntheticCollector, COLLECTOR_OWNER as owner, COLLECTOR_SYNTHETIC_NOW as now } from '../../fixtures/synthetic-collector.mjs'
import { claimCollector, readCollectors, receiptCollector, saveCollector } from '../../cloudflare/src/collector-execution.mjs'
import { publishCollector, publicationTicket, publishTenantCandidate, readTenantPublicationReceipt, reconcileCollector } from '../../cloudflare/src/collector-publication.mjs'
import { saveDataControl } from '../../cloudflare/src/platform-data.mjs'
import { digest } from '../../cloudflare/src/collector-common.mjs'
import { cloudBundleSha256, encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { publishRelease } from '../../cloudflare/src/worker.mjs'
import { resourceProvenanceSha256 } from '../../server/resource-validation.mjs'
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
const removeSyntheticPublicListing=(bundle,vin)=>{
 const release=bundle.release,record=release.publicSnapshot.vehicles[vin]
 delete release.publicSnapshot.vehicles[vin]
 release.vehicles.find(v=>v.vin===vin).publicRecord=null
 const status=release.publicSnapshot.source_statuses.find(s=>s.source===record.store)
 for(const field of ['expected_count','rows_fetched','unique_vins'])status[field]--
 release.sourceRuns.public.rowCount--
 release.sourceRuns.public.metadata.storeCounts[record.store]--
 release.sourceRuns.public.metadata.sourceStatuses=structuredClone(release.publicSnapshot.source_statuses)
 release.manifest.source_counts.public_unique_vins--
}
const publishSyntheticBaseline=async f=>{
 f.baseline=encryptBundle(f.bundle,f.key)
 const result=await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.baseline)}),f.tenantEnv)
 expect(result.ok).toBe(true)
}
// Exercise the tenant's rejection of an authenticated but malformed candidate;
// the normal publisher refuses these payloads before encrypting them.
const encryptMalformedSyntheticCandidate=(bundle,key)=>{
 const version='inventory-flow-private-release-v1',iv=randomBytes(12),plaintext=Buffer.from(JSON.stringify(bundle)),bundleSha256=createHash('sha256').update(plaintext).digest('hex')
 const cipher=createCipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(Buffer.from(`${version}:${bundle.reportDate}:${bundleSha256}`))
 const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()])
 return {version,reportDate:bundle.reportDate,bundleSha256,iv:iv.toString('base64url'),ciphertext:ciphertext.toString('base64url')}
}
const stopDuringTenantPublication=async(f,mode,key='fence-owner-stop')=>{
 if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic stop at tenant publication fence',expectedRevision:revision(f)},key)
 else if(mode==='revoke')await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoke at tenant publication fence',expectedRevision:revision(f)},key,now)
 else {f.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED='false';f.tenantEnv.PLATFORM_COLLECTOR_EXECUTION_ENABLED='false'}
}
const raceTenantFence=(f,point,action)=>{
 if(point==='binding-entry'){
  const publish=f.env.TENANT_NORTH_PUBLISHER.publish
  let raced=false
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{if(!raced){raced=true;await action()}return publish(...args)}
  return ()=>raced
 }
 const method=point==='entry'?'get':point==='new-commit'?'put':'head',original=f.bucket[method]
 let raced=false
 f.bucket[method]=vi.fn(async(...args)=>{
  const result=await original(...args)
  if(!raced){raced=true;await action()}
  return result
 })
 return ()=>raced
}
describe('Brokered publication and independent tenant receipt',()=>{
 it.each(['binding-entry','entry','new-commit','unchanged-commit'].flatMap(point=>['cancel','revoke','disabled'].map(mode=>({point,mode}))))('settles exact precommit fence proof after $mode at $point without tenant acceptance or owner-decision changes',async({point,mode})=>{
  const f=await setup()
  if(point==='unchanged-commit')f.input.envelope=f.baseline
  const nextRequest=await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[1].connectionId,reason:'Synthetic unrelated queued work',expectedRevision:revision(f)},'fence-next-request')
  const original=f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get(),tenant={revision:f.tenant.prepare('SELECT revision FROM cloud_app_revision').get(),versions:f.tenant.prepare('SELECT * FROM cloud_release_versions').all(),state:f.tenant.prepare('SELECT * FROM cloud_release_state').all(),intake:f.tenant.prepare('SELECT * FROM vehicle_service_intake').all()}
  const baselineObject=f.objects.get(`releases/${f.baseline.reportDate}/${f.baseline.bundleSha256}.json.enc`).body
  let ownerAudit,collector,tenantProof,tenantError
  const raced=raceTenantFence(f,point,async()=>{
   await stopDuringTenantPublication(f,mode)
   ownerAudit=f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='fence-owner-stop'").get()
   collector=f.sqlite.prepare('SELECT * FROM platform_collectors').get()
  })
  const publish=f.env.TENANT_NORTH_PUBLISHER.publish
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{try{tenantProof=await publish(...args);return tenantProof}catch(error){tenantError={message:error.message,code:error.code};throw error}})
  const batch=f.env.PLATFORM_DB.batch,settlementErrors=[]
  f.env.PLATFORM_DB.batch=async statements=>{try{return await batch(statements)}catch(error){settlementErrors.push(error.message);throw error}}
  const outcome=await publishCollector(f.env,f.machine,f.input,'precommit-fence',now)
  expect(settlementErrors).toEqual([])
  expect(tenantError).toBeUndefined()
  expect(tenantProof?.status).toBe('fence_rejected')
  expect(outcome).toMatchObject({status:'preflight_retryable',ready:false,bundleSha256:f.input.envelope.bundleSha256})
  expect(raced()).toBe(true)
  expect(tenantProof).toMatchObject({status:'fence_rejected',precommitOnly:true,attemptId:original.id,groupId:original.group_id,collectorId:original.collector_id,fence:original.fence,grantGeneration:original.grant_generation,configSha256:original.config_sha256,scopeSha256:original.scope_sha256,bundleSha256:f.input.envelope.bundleSha256,reportDate:original.report_date})
  const settled=f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get()
  expect(settled.stage).toBe(['cancel','revoke'].includes(mode)?'cancelled':'expired')
  expect(settled.failure_code).toBe(mode==='cancel'?'CANCELLED_BY_OWNER':mode==='revoke'?'COLLECTOR_REVOKED':'COLLECTOR_DISABLED')
  for(const field of ['id','request_id','collector_id','group_id','fence','grant_generation','config_sha256','scope_sha256','config_json','source_sha256','report_date'])expect(settled[field]).toBe(original[field])
  expect(settled.expected_bundle_sha256).toBe(f.input.envelope.bundleSha256)
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests WHERE id=?').get(f.attempt.requestId).state).toBe(['cancel','revoke'].includes(mode)?'cancelled':'failed')
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests WHERE id=?').get(nextRequest.id).state).toBe('queued')
  expect(f.sqlite.prepare('SELECT * FROM platform_collectors').get()).toEqual(collector)
  expect(f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='fence-owner-stop'").get()).toEqual(ownerAudit)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_attempts WHERE stage IN ('claimed','captured','publishing','reconciliation_required')").get().n).toBe(0)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare('SELECT revision FROM cloud_app_revision').get()).toEqual(tenant.revision)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_versions').all()).toEqual(tenant.versions)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_state').all()).toEqual(tenant.state)
  expect(f.tenant.prepare('SELECT * FROM vehicle_service_intake').all()).toEqual(tenant.intake)
  expect(f.objects.get(`releases/${f.baseline.reportDate}/${f.baseline.bundleSha256}.json.enc`).body).toBe(baselineObject)
  expect(f.objects.size).toBe(point==='new-commit'?2:1)
  if(mode==='cancel')expect(await claimCollector(f.env,f.machine,{},'after-precommit-fence',now)).toMatchObject({requestId:nextRequest.id})
  if(mode==='revoke')await expect(claimCollector(f.env,f.machine,{},'revoked-after-precommit-fence',now)).rejects.toMatchObject({code:'COLLECTOR_REVOKED'})
  if(mode==='disabled'){
   expect(f.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED).toBe('false');expect(f.tenantEnv.PLATFORM_COLLECTOR_EXECUTION_ENABLED).toBe('false')
   await expect(claimCollector(f.env,f.machine,{},'disabled-after-precommit-fence',now)).rejects.toMatchObject({code:'COLLECTOR_DISABLED'})
  }
 })
 it.each(['signature','expired','wrong-operation','foreign-fence','missing-binding','lookup-stale','lookup-disabled'])('requires authenticated frozen ticket identity before initial OFF fence proof: %s',async mode=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  f.bucket.get=vi.fn(f.bucket.get);f.bucket.put=vi.fn(f.bucket.put);f.bucket.head=vi.fn(f.bucket.head)
  let proof
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(envelope,authorization)=>{
   await stopDuringTenantPublication(f,'disabled')
   const attempt=f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get()
   if(mode==='signature')authorization='synthetic-invalid-signature'
   if(mode==='expired')authorization=await publicationTicket(f.env,attempt,'publish',new Date(now.getTime()-60000))
   if(mode==='wrong-operation')authorization=await publicationTicket(f.env,attempt,'read',now)
   if(mode==='foreign-fence')authorization=await publicationTicket(f.env,{...attempt,fence:attempt.fence+1},'publish',now)
   if(mode==='missing-binding')f.tenantEnv.PLATFORM_CONTROL_DB=null
   if(mode.startsWith('lookup-')){
    const prepare=f.tenantEnv.PLATFORM_CONTROL_DB.prepare
    f.tenantEnv.PLATFORM_CONTROL_DB.prepare=sql=>{
     const statement=prepare(sql)
     if(sql.startsWith('SELECT a.*,p.state AS request_state')){
      const bind=statement.bind
      statement.bind=(...args)=>{const bound=bind.apply(statement,args);bound.first=async()=>{throw Object.assign(new Error('Synthetic initial identity lookup outage'),{code:mode==='lookup-stale'?'COLLECTOR_LEASE_STALE':'COLLECTOR_DISABLED'})};return bound}
     }
     return statement
    }
   }
   proof=await publish(envelope,authorization)
   return proof
  })
  expect(await publishCollector(f.env,f.machine,f.input,'invalid-initial-fence-proof',now)).toMatchObject({status:'reconciliation_required',ready:false})
  expect(proof).toBeUndefined()
  expect(f.sqlite.prepare('SELECT stage,completed_at FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',completed_at:null})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(0)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_attempts WHERE stage IN ('publishing','reconciliation_required')").get().n).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  expect(f.bucket.get).not.toHaveBeenCalled();expect(f.bucket.put).not.toHaveBeenCalled();expect(f.bucket.head).not.toHaveBeenCalled()
  expect(f.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED).toBe('false');expect(f.tenantEnv.PLATFORM_COLLECTOR_EXECUTION_ENABLED).toBe('false')
 })
 it.each(['lost','extra','missing','false-precommit','foreign-group','foreign-collector','foreign-generation','foreign-config','foreign-scope','foreign-attempt','foreign-request','foreign-fence','foreign-bundle','foreign-baseline','foreign-source','foreign-date','forged-code'])('keeps the group readback-only when exact precommit fence proof is %s',async mutation=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  raceTenantFence(f,'new-commit',()=>stopDuringTenantPublication(f,'cancel'))
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const proof=await publish(...args)
   if(mutation==='lost')throw new Error('Synthetic lost precommit fence proof')
   const changed={...proof}
   if(mutation==='extra')changed.unrecognized=true
   if(mutation==='missing')delete changed.requestId
   if(mutation==='false-precommit')changed.precommitOnly=false
   const fields={'foreign-group':'groupId','foreign-collector':'collectorId','foreign-generation':'grantGeneration','foreign-config':'configSha256','foreign-scope':'scopeSha256','foreign-attempt':'attemptId','foreign-request':'requestId','foreign-fence':'fence','foreign-bundle':'bundleSha256','foreign-baseline':'baselineBundleSha256','foreign-source':'sourceSha256','foreign-date':'reportDate','forged-code':'code'}
   const field=fields[mutation]
   if(field)changed[field]=typeof changed[field]==='number'?changed[field]+1:'synthetic-foreign-proof'
   return changed
  })
  expect(await publishCollector(f.env,f.machine,f.input,'unknown-fence-proof',now)).toMatchObject({status:'reconciliation_required',ready:false})
  expect(f.sqlite.prepare('SELECT stage,failure_code,completed_at FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',failure_code:'CANCELLED_BY_OWNER',completed_at:null})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(0)
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:f.attempt.attemptId},now)).toMatchObject({status:'reconciliation_required'})
  expect(await claimCollector(f.env,f.machine,{},'blocked-by-unknown-fence',now)).toBeNull()
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
 })
 it.each(['fence','config','scope','generation','bundle','dispatch'])('does not settle an exact precommit proof against a changed saved %s',async mutation=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  raceTenantFence(f,'entry',()=>stopDuringTenantPublication(f,'cancel'))
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const proof=await publish(...args)
   const field={fence:'fence',config:'config_sha256',scope:'scope_sha256',generation:'grant_generation',bundle:'expected_bundle_sha256'}[mutation]
   if(field)f.sqlite.prepare(`UPDATE platform_collector_attempts SET ${field}=?`).run(['fence','generation'].includes(mutation)?99:'b'.repeat(64))
   else f.sqlite.prepare("UPDATE platform_audit SET target_id='synthetic-foreign-attempt' WHERE action='publication_started'").run()
   return proof
  })
  expect(await publishCollector(f.env,f.machine,f.input,'saved-fence-proof',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage,completed_at FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',completed_at:null})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(0)
 })
 it.each(['COLLECTOR_LEASE_STALE','COLLECTOR_DISABLED'])('does not turn an infrastructure throw with spoofed %s code into precommit fence proof',async code=>{
  const f=await setup(),prepare=f.tenantEnv.PLATFORM_CONTROL_DB.prepare
  let lookups=0
  f.tenantEnv.PLATFORM_CONTROL_DB.prepare=sql=>{
   const statement=prepare(sql)
   if(sql==='SELECT * FROM platform_collectors WHERE id=? AND group_id=?'){
    const bind=statement.bind
    statement.bind=(...args)=>{
     const bound=bind.apply(statement,args),first=bound.first
     bound.first=async()=>{if(++lookups===2)throw Object.assign(new Error('Synthetic control DB outage'),{code});return first.call(bound)}
     return bound
    }
   }
   return statement
  }
  expect(await publishCollector(f.env,f.machine,f.input,'spoofed-fence-outage',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(0)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it('rolls back exact fence-proof retirement atomically when its control-plane batch fails',async()=>{
  const f=await setup(),batch=f.env.PLATFORM_DB.batch
  raceTenantFence(f,'entry',()=>stopDuringTenantPublication(f,'cancel'))
  f.env.PLATFORM_DB.batch=async statements=>{
   if(statements.some(statement=>statement.params?.includes('publication_fence_rejected')))return batch([...statements,f.env.PLATFORM_DB.prepare('UPDATE platform_revision SET revision=NULL WHERE id=1')])
   return batch(statements)
  }
  expect(await publishCollector(f.env,f.machine,f.input,'atomic-fence-proof',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage,failure_code,completed_at FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',failure_code:'CANCELLED_BY_OWNER',completed_at:null})
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(0)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it.each(['cancel','revoke','disabled'])('preserves exact committed publication readback when %s races after the atomic batch',async mode=>{
  const f=await setup(),batch=f.tenantEnv.INVENTORY_DB.batch
  let stopped=false,ownerAudit,collector
  f.tenantEnv.INVENTORY_DB.batch=async statements=>{
   const result=await batch(statements)
   if(!stopped && statements.some(statement=>statement.sql.startsWith('INSERT INTO collector_publication_receipts'))){
    stopped=true
    await stopDuringTenantPublication(f,mode,'after-commit-owner-stop')
    ownerAudit=f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='after-commit-owner-stop'").get()
    collector=f.sqlite.prepare('SELECT * FROM platform_collectors').get()
   }
   return result
  }
  expect(await publishCollector(f.env,f.machine,f.input,'committed-fence-race',now)).toMatchObject({status:'published_verified',ready:true,bundleSha256:f.envelope.bundleSha256})
  expect(stopped).toBe(true)
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('completed')
  expect(f.sqlite.prepare('SELECT * FROM platform_collectors').get()).toEqual(collector)
  expect(f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key='after-commit-owner-stop'").get()).toEqual(ownerAudit)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_fence_rejected'").get().n).toBe(0)
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:f.attempt.attemptId},now)).toMatchObject({status:'published_verified',ready:true})
 })
 it.each(['valid','bad-provenance','preflight-outage'])('handles provenance-bound status-only CARFAX coverage through publication and receipt readback: %s',async mode=>{
  const f=await setup(async f=>{
   const resource=f.bundle.release.vehicles.find(v=>v.resourceRecord).resourceRecord
   resource.warrantyCheck={dataState:'current',capturedAt:now.toISOString(),sourceLabel:'Synthetic CARFAX warranty estimate',mileageEntered:1000,carfax:{coverages:[{type:'Powertrain',status:'ACTIVE'}]}}
   const run=f.bundle.release.sourceRuns.resources
   run.metadata.warrantyCheckCount=1
   run.provenanceSha256=resourceProvenanceSha256(run,f.bundle.release.vehicles)
   // Encrypt the original authenticated bytes without the publisher's local
   // normalization so the tenant must validate the permitted status-only row.
   f.baseline=encryptMalformedSyntheticCandidate(f.bundle,f.key)
   const result=await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.baseline)}),f.tenantEnv)
   expect(result.ok).toBe(true)
  })
  f.candidate=structuredClone(f.bundle);f.candidate.release.completedAt=now.toISOString();f.candidate.createdAt=now.toISOString()
  if(mode==='bad-provenance')f.candidate.release.sourceRuns.resources.provenanceSha256='0'.repeat(64)
  f.input.envelope=encryptMalformedSyntheticCandidate(f.candidate,f.key)
  const original=JSON.stringify(f.candidate),envelope=JSON.stringify(f.input.envelope),baselineHash=f.baseline.bundleSha256
  if(mode==='preflight-outage'){
   const get=f.bucket.get
   f.bucket.get=vi.fn(async()=>{throw new Error('Synthetic baseline read outage')})
   expect(await publishCollector(f.env,f.machine,f.input,'status-only-carfax',now)).toMatchObject({status:'preflight_retryable',ready:false})
   expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('captured')
   f.bucket.get=get
  }
  if(mode==='bad-provenance'){
   await expect(publishCollector(f.env,f.machine,f.input,'status-only-carfax',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
   expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
   expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(baselineHash)
  }else{
   expect(await publishCollector(f.env,f.machine,f.input,'status-only-carfax',now)).toMatchObject({status:'published_verified',ready:true,bundleSha256:f.input.envelope.bundleSha256})
   const attempt=f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get()
   expect(await readTenantPublicationReceipt(f.tenantEnv,await publicationTicket(f.env,attempt,'read',now),now)).toMatchObject({status:'published_verified',ready:true,bundleSha256:f.input.envelope.bundleSha256})
   expect(f.objects.get(`releases/${f.input.envelope.reportDate}/${f.input.envelope.bundleSha256}.json.enc`).body).toBe(envelope)
  }
  expect(JSON.stringify(f.candidate)).toBe(original)
  expect(JSON.stringify(f.input.envelope)).toBe(envelope)
 })
 it.each([45000,119000])('verifies a publication after a %ims RPC using a fresh receipt ticket and settlement time',async elapsed=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  let current=now
  const clock=()=>current
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const result=await publish(...args)
   current=new Date(now.getTime()+elapsed)
   return result
  })
  f.env.TENANT_NORTH_PUBLISHER.readReceipt=vi.fn(ticket=>readTenantPublicationReceipt(f.tenantEnv,ticket,clock()))
  expect(await publishCollector(f.env,f.machine,f.input,'slow-publication',now,clock)).toMatchObject({status:'published_verified',bundleSha256:f.envelope.bundleSha256,ready:true,verifiedAt:current.toISOString()})
  const settledAt=current.toISOString()
  expect(f.sqlite.prepare('SELECT stage,completed_at,failure_code FROM platform_collector_attempts').get()).toEqual({stage:'completed',completed_at:settledAt,failure_code:null})
  expect(f.sqlite.prepare('SELECT state,updated_at FROM platform_pull_requests').get()).toEqual({state:'completed',updated_at:settledAt})
  expect(f.sqlite.prepare("SELECT received_at FROM platform_collector_receipts WHERE kind='publication'").get().received_at).toBe(settledAt)
  expect(f.sqlite.prepare("SELECT created_at FROM platform_audit WHERE action='publication_verified'").get().created_at).toBe(settledAt)
  const settledRevision=revision(f)
  current=new Date(current.getTime()+180000)
  expect(await publishCollector(f.env,f.machine,f.input,'slow-publication',now,clock)).toMatchObject({status:'published_verified',verifiedAt:settledAt})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.env.TENANT_NORTH_PUBLISHER.readReceipt).toHaveBeenCalledTimes(2)
  expect(revision(f)).toBe(settledRevision)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='publication'").get().n).toBe(1)
 })
 it.each(['rejected','lost','malformed'])('keeps a delayed %s validation result fail closed with current settlement evidence',async mode=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish,later=new Date(now.getTime()+45000)
  let current=now
  f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const result=await publish(...args)
   current=later
   if(mode==='lost')throw new Error('Synthetic delayed rejection reply lost')
   return mode==='malformed'?{...result,unrecognized:true}:result
  })
  f.env.TENANT_NORTH_PUBLISHER.readReceipt=ticket=>readTenantPublicationReceipt(f.tenantEnv,ticket,current)
  const result=publishCollector(f.env,f.machine,f.input,'slow-rejection',now,()=>current)
  if(mode==='rejected'){
   await expect(result).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
   expect(f.sqlite.prepare('SELECT stage,completed_at,failure_code FROM platform_collector_attempts').get()).toEqual({stage:'failed',completed_at:later.toISOString(),failure_code:'VALIDATION_FAILED'})
   expect(f.sqlite.prepare("SELECT received_at FROM platform_collector_receipts WHERE kind='failure'").get().received_at).toBe(later.toISOString())
   expect(await publishCollector(f.env,f.machine,f.input,'slow-rejection',later)).toMatchObject({status:'rejected_verified',ready:false,verifiedAt:later.toISOString()})
  }else{
   expect(await result).toMatchObject({status:'reconciliation_required',ready:false})
   expect(f.sqlite.prepare('SELECT stage,failure_code FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',failure_code:'COLLECTOR_PUBLICATION_UNKNOWN'})
   expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind IN ('failure','publication')").get().n).toBe(0)
   expect(await publishCollector(f.env,f.machine,f.input,'slow-rejection',now,()=>current)).toMatchObject({status:'reconciliation_required',ready:false})
  }
  expect(f.sqlite.prepare('SELECT updated_at FROM platform_pull_requests').get().updated_at).toBe(later.toISOString())
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
 })
 it('replays an exact persisted validation rejection without another tenant call after its first reply is lost',async()=>{
  const f=await setup(),publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  await expect(publishCollector(f.env,f.machine,f.input,'rejection-readback',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
  const beforeRevision=revision(f)
  expect(await publishCollector(f.env,f.machine,f.input,'rejection-readback',new Date(now.getTime()+180000))).toMatchObject({status:'rejected_verified',attemptId:f.attempt.attemptId,fence:f.attempt.fence,bundleSha256:f.envelope.bundleSha256,reportDate:f.envelope.reportDate,idempotencyKey:'rejection-readback',code:'VALIDATION_FAILED',ready:false})
  expect(publish).toHaveBeenCalledTimes(1)
  expect((await publishCollector(f.env,f.machine,f.input,'rejection-readback',now)).status).toBe('rejected_verified')
  expect(revision(f)).toBe(beforeRevision)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_rejected'").get().n).toBe(1)
 })
 it.each(['key','bundle','fence','receipt-hash','revoked'])('does not turn mismatched %s into an exact rejection readback',async mode=>{
  const f=await setup(),publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  await expect(publishCollector(f.env,f.machine,f.input,'rejection-bound',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
  if(mode==='bundle')f.input.envelope={...f.input.envelope,bundleSha256:'b'.repeat(64)}
  if(mode==='fence')f.input.fence++
  if(mode==='receipt-hash'){
   const prepare=f.env.PLATFORM_DB.prepare
   f.env.PLATFORM_DB.prepare=sql=>{
    const statement=prepare(sql)
    if(sql.includes('FROM platform_collector_receipts') && sql.includes('1000001')){
     const bind=statement.bind
     statement.bind=(...args)=>{const bound=bind.apply(statement,args),first=bound.first;bound.first=async()=>{const receipt=await first.call(bound);return receipt?{...receipt,payload_sha256:'b'.repeat(64)}:null};return bound}
    }
    return statement
   }
  }
  if(mode==='revoked')await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoked before rejection readback',expectedRevision:revision(f)},'rejection-revoke',now)
  let result
  try{result=await publishCollector(f.env,f.machine,f.input,mode==='key'?'foreign-key':'rejection-bound',now)}catch(error){result={status:'refused',code:error.code}}
  if(['key','receipt-hash'].includes(mode))expect(result.status).toBe('reconciliation_required')
  else expect(result).toEqual({status:'refused',code:mode==='fence'?'COLLECTOR_LEASE_STALE':mode==='bundle'?'COLLECTOR_RECEIPT_CONFLICT':'COLLECTOR_REVOKED'})
  expect(publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('failed')
 })
 it.each(['cancel','revoke'])('settles an exact positive validation rejection after racing owner %s without restoring authority',async mode=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  const otherRequest=await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[1].connectionId,reason:'Synthetic separately queued request',expectedRevision:revision(f)},'other-request')
  f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  let ownerAudit,collector
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{
   const rejected=await publish(...args)
   expect(rejected).toEqual({status:'rejected',code:'VALIDATION_FAILED'})
   if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic cancel while validation replied',expectedRevision:revision(f)},'validation-cancel')
   else await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoke while validation replied',expectedRevision:revision(f)},'validation-revoke',now)
   ownerAudit=f.sqlite.prepare("SELECT * FROM platform_audit WHERE request_key=?").get(`validation-${mode}`)
   collector=f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(f.collectorId)
   return rejected
  }
  await expect(publishCollector(f.env,f.machine,f.input,'validation-race',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
  expect(f.sqlite.prepare('SELECT stage,failure_code FROM platform_collector_attempts').get()).toMatchObject({stage:'failed',failure_code:'VALIDATION_FAILED'})
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests WHERE id=?').get(f.attempt.requestId).state).toBe('failed')
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests WHERE id=?').get(otherRequest.id).state).toBe('queued')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_rejected'").get().n).toBe(1)
  expect(f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(f.collectorId)).toEqual(collector)
  expect(f.sqlite.prepare('SELECT * FROM platform_audit WHERE request_key=?').get(`validation-${mode}`)).toEqual(ownerAudit)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  if(mode==='cancel'){
   await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[0].connectionId,reason:'Synthetic next pull after rejection',expectedRevision:revision(f)},'after-rejection')
   expect(await claimCollector(f.env,f.machine,{},'after-rejection-claim',now)).toMatchObject({fence:1})
  }else await expect(claimCollector(f.env,f.machine,{},'revoked-next-claim',now)).rejects.toMatchObject({code:'COLLECTOR_REVOKED'})
 })
 it.each(['fence','bundle','foreign-dispatch'])('keeps validation rejection unknown when the saved %s no longer matches',async mode=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  if(mode==='foreign-dispatch'){
   const hash=await digest({attemptId:f.attempt.attemptId,bundleSha256:f.envelope.bundleSha256,configSha256:f.attempt.configSha256})
   f.sqlite.prepare("INSERT INTO platform_audit SELECT id||'-foreign',actor_id,actor_name,entity,'synthetic-foreign-attempt','publication_started',reason,previous_json,next_json,'publish:validation-fenced',?,created_at FROM platform_audit WHERE action='claimed' LIMIT 1").run(hash)
  }
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{
   const rejected=await publish(...args)
   if(mode==='fence')f.sqlite.prepare('UPDATE platform_collector_attempts SET fence=fence+1').run()
   if(mode==='bundle')f.sqlite.prepare('UPDATE platform_collector_attempts SET expected_bundle_sha256=?').run('b'.repeat(64))
   return rejected
  }
  expect(await publishCollector(f.env,f.machine,f.input,'validation-fenced',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(0)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_rejected'").get().n).toBe(0)
 })
 it.each(['lost','malformed'])('keeps a %s validation rejection reply fenced for readback only',async mode=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  f.input.envelope={...f.envelope,ciphertext:'invalid encrypted candidate'}
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const rejected=await publish(...args)
   if(mode==='lost')throw new Error('Synthetic validation reply lost')
   return {...rejected,unrecognized:true}
  })
  expect(await publishCollector(f.env,f.machine,f.input,'validation-unknown',now)).toMatchObject({status:'reconciliation_required'})
  expect(await publishCollector(f.env,f.machine,f.input,'validation-unknown',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='failure'").get().n).toBe(0)
 })
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
 it.each(['null','omitted','changed','retained'])('preserves baseline DealerMail-only resource evidence when its candidate record is %s',async mode=>{
  const f=await setup(async f=>{
   f.resourceVin=f.bundle.release.vehicles.find(v=>v.resourceRecord).vin
   removeSyntheticPublicListing(f.bundle,f.resourceVin)
   await publishSyntheticBaseline(f)
  })
  const record=f.candidate.release.vehicles.find(v=>v.vin===f.resourceVin),retained=structuredClone(record.resourceRecord)
  expect(record.publicRecord).toBeNull()
  expect(record.resourceRecord.factoryEquipment).toBeTruthy()
  if(mode==='null')record.resourceRecord=null
  if(mode==='omitted')delete record.resourceRecord
  if(mode==='changed')record.resourceRecord.factoryEquipment.sourceLabel='Synthetic altered retained resource'
  expect(f.candidate.release.sourceRuns.resources).toEqual(f.bundle.release.sourceRuns.resources)
  expect(f.candidate.release.resourceSnapshot).toEqual(f.bundle.release.resourceSnapshot)
  f.input.envelope=mode==='retained'?encryptBundle(f.candidate,f.key):encryptMalformedSyntheticCandidate(f.candidate,f.key)
  if(mode==='retained'){
   expect(await publishCollector(f.env,f.machine,f.input,'mail-only-resource',now)).toMatchObject({status:'published_verified',ready:true})
   expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(1)
   expect(f.bundle.release.vehicles.find(v=>v.vin===f.resourceVin).resourceRecord).toEqual(retained)
  }else{
   await expect(publishCollector(f.env,f.machine,f.input,'mail-only-resource',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
   expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
   expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  }
 })
 it('allows a genuinely new DealerMail-only VIN without adding public or resource evidence',async()=>{
  const f=await setup(async f=>{
   f.newRecord=structuredClone(f.bundle.release.vehicles.find(v=>!v.holdRecord && !v.resourceRecord && v.crmRecord.storeName==='Howell'))
   f.fullMail=structuredClone(f.bundle.release.dealerMailSnapshot)
   f.fullMailRun=structuredClone(f.bundle.release.sourceRuns.dealerMail)
   removeSyntheticPublicListing(f.bundle,f.newRecord.vin)
   f.bundle.release.vehicles=f.bundle.release.vehicles.filter(v=>v.vin!==f.newRecord.vin)
   const snapshot=f.bundle.release.dealerMailSnapshot
   for(const field of ['completeDealerMailUsedInventory','excludeActiveHoldsValidationSet']){
    const set=snapshot[field];set.rows=set.rows.filter(row=>row.vin!==f.newRecord.vin)
    for(const name of ['totalRows','uniqueVinCount','uniqueStockCount'])set.summary[name]--
    if(set.summary.byStore)set.summary.byStore.Howell--
   }
   const control=snapshot.crmInventoryControlValidation
   for(const field of ['completeInventoryRowsIncludingHolds','inventoryRowsExcludingHolds','lotReadyOnlyRowsIncludingHolds'])control[field]--
   control.includingHoldsByStore.Howell--;control.excludingHoldsByStore.Howell--
   f.bundle.release.sourceRuns.dealerMail.rowCount--
   f.bundle.release.sourceRuns.dealerMail.metadata.vinQuarantine.sourceRowCount--
   f.bundle.release.sourceRuns.dealerMail.metadata.vinQuarantine.vinReconciledRowCount--
   f.bundle.release.manifest.source_counts.dealermail_used_rows--
   await publishSyntheticBaseline(f)
  })
  expect(f.bundle.release.vehicles.some(v=>v.vin===f.newRecord.vin)).toBe(false)
  f.candidate.release.dealerMailSnapshot=f.fullMail
  f.candidate.release.sourceRuns.dealerMail=f.fullMailRun
  f.candidate.release.manifest.source_counts.dealermail_used_rows=8
  f.candidate.release.vehicles.push({...f.newRecord,publicRecord:null,resourceRecord:null})
  f.input.envelope=encryptBundle(f.candidate,f.key)
  expect(await publishCollector(f.env,f.machine,f.input,'new-mail-only',now)).toMatchObject({status:'published_verified',ready:true,counts:{inventory:8}})
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(1)
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
 it.each(['before-state-read','before-release-batch','unchanged-before-batch'])('retains a newer legacy public release when a hold candidate races it %s',async mode=>{
  const f=await setup(),batch=f.tenantEnv.INVENTORY_DB.batch
  if(mode==='unchanged-before-batch')f.input.envelope=f.baseline
  const newer=structuredClone(f.bundle),vehicle=newer.release.vehicles.find(v=>v.publicRecord)
  const publicRecord=newer.release.publicSnapshot.vehicles[vehicle.vin]
  publicRecord.listed_price+=1000;vehicle.publicRecord.listed_price=publicRecord.listed_price
  newer.release.sourceRuns.public.sha256='c'.repeat(64)
  // The newer public release completed before the hold capture. Ordering alone
  // must not let that capture restore the old public price after publication.
  newer.release.completedAt=new Date(now.getTime()-1000).toISOString()
  const newerEnvelope=encryptBundle(newer,f.key)
  let raced=false,afterLegacy
  f.tenantEnv.INVENTORY_DB.batch=async statements=>{
   const atStateRead=statements.some(s=>s.sql==='SELECT revision FROM cloud_app_revision WHERE id=1')
   const atReleaseBatch=statements.some(s=>s.sql.includes("UPDATE cloud_release_versions SET status='superseded'"))
   const atUnchangedBatch=statements.some(s=>s.sql.includes('UPDATE cloud_release_versions SET metadata_json=?'))
   if(!raced && (mode==='before-state-read'?atStateRead:mode==='before-release-batch'?atReleaseBatch:atUnchangedBatch)){
    raced=true
    const legacy=await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(newerEnvelope)}),f.tenantEnv)
    expect(legacy.status).toBe(201)
    afterLegacy={revision:f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision,versions:f.tenant.prepare('SELECT * FROM cloud_release_versions ORDER BY release_id').all(),state:f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all(),intake:f.tenant.prepare('SELECT * FROM vehicle_service_intake ORDER BY vin').all()}
   }
   return batch(statements)
  }
  const publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  const result=await publishCollector(f.env,f.machine,f.input,'legacy-baseline-race',now)
  expect(raced).toBe(true)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(newerEnvelope.bundleSha256)
  expect(f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(afterLegacy.revision)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_versions ORDER BY release_id').all()).toEqual(afterLegacy.versions)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all()).toEqual(afterLegacy.state)
  expect(f.tenant.prepare('SELECT * FROM vehicle_service_intake ORDER BY vin').all()).toEqual(afterLegacy.intake)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(result).toMatchObject({status:'revision_retryable',ready:false,bundleSha256:f.input.envelope.bundleSha256})
  expect(f.sqlite.prepare('SELECT stage,expected_bundle_sha256 FROM platform_collector_attempts').get()).toMatchObject({stage:'captured',expected_bundle_sha256:f.input.envelope.bundleSha256})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_revision_deferred'").get().n).toBe(1)
  // No new baseline can be silently substituted into the frozen attempt.
  await expect(publishCollector(f.env,f.machine,f.input,'legacy-baseline-race',now)).rejects.toMatchObject({code:'COLLECTOR_PUBLICATION_INVALID'})
  expect(publish).toHaveBeenCalledTimes(2)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(newerEnvelope.bundleSha256)
 })
 it.each(['database','lost-after-commit'])('keeps an unchanged candidate readback-only after an ambiguous %s reply',async mode=>{
  const f=await setup(),batch=f.tenantEnv.INVENTORY_DB.batch
  f.input.envelope=f.baseline
  const beforeRevision=f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision
  f.tenantEnv.INVENTORY_DB.batch=async statements=>{
   if(statements.some(s=>s.sql.includes('UPDATE cloud_release_versions SET metadata_json=?'))){
    if(mode==='database')throw new Error('Synthetic unchanged batch unavailable')
    await batch(statements)
    throw new Error('Synthetic unchanged reply lost after commit')
   }
   return batch(statements)
  }
  const publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  expect(await publishCollector(f.env,f.machine,f.input,'unchanged-ambiguous',now)).toMatchObject({status:'reconciliation_required',ready:false})
  expect(f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(beforeRevision)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(mode==='database'?0:1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_revision_deferred'").get().n).toBe(0)
  expect(await publishCollector(f.env,f.machine,f.input,'unchanged-ambiguous',now)).toMatchObject({status:mode==='database'?'reconciliation_required':'unchanged_verified'})
  expect(publish).toHaveBeenCalledTimes(1)
 })
 it.each(['sqlite','d1'])('retries the exact candidate after an employee revision race atomically rolls back every tenant row (%s)',async mode=>{
  const f=await setup(),batch=f.tenantEnv.INVENTORY_DB.batch
  f.tenant.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)').run('synthetic-race@example.invalid','synthetic-race','Synthetic racing employee','sales','Howell')
  const before={revision:f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision,versions:f.tenant.prepare('SELECT * FROM cloud_release_versions ORDER BY release_id').all(),state:f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all(),intake:f.tenant.prepare('SELECT * FROM vehicle_service_intake ORDER BY vin').all()}
  let raced=false
  f.tenantEnv.INVENTORY_DB.batch=async statements=>{
   if(!raced && statements.some(s=>s.sql.includes('UPDATE cloud_app_revision SET revision=CASE'))){
    raced=true
    // This committed employee write lands after the publisher read revision,
    // but before its receipt + release + intake transaction starts.
    await batch([f.tenantEnv.INVENTORY_DB.prepare("UPDATE cloud_memberships SET role='manager' WHERE user_id='synthetic-race'"),f.tenantEnv.INVENTORY_DB.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1')])
   }
   try{return await batch(statements)}catch(error){
    if(mode==='d1')throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT`)
    throw error
   }
  }
  const publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  expect(await publishCollector(f.env,f.machine,f.input,'revision-race',now)).toMatchObject({status:'revision_retryable',ready:false,bundleSha256:f.envelope.bundleSha256})
  expect(raced).toBe(true)
  expect(f.objects.has(`releases/${f.envelope.reportDate}/${f.envelope.bundleSha256}.json.enc`)).toBe(true)
  expect(f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(before.revision+1)
  expect(f.tenant.prepare("SELECT role FROM cloud_memberships WHERE user_id='synthetic-race'").get().role).toBe('manager')
  expect(f.tenant.prepare('SELECT * FROM cloud_release_versions ORDER BY release_id').all()).toEqual(before.versions)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all()).toEqual(before.state)
  expect(f.tenant.prepare('SELECT * FROM vehicle_service_intake ORDER BY vin').all()).toEqual(before.intake)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.sqlite.prepare('SELECT stage,expected_bundle_sha256 FROM platform_collector_attempts').get()).toMatchObject({stage:'captured',expected_bundle_sha256:f.envelope.bundleSha256})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_revision_deferred'").get().n).toBe(1)
  await expect(publishCollector(f.env,f.machine,{...f.input,envelope:{...f.envelope,bundleSha256:'b'.repeat(64)}},'revision-race',now)).rejects.toMatchObject({code:'COLLECTOR_RECEIPT_CONFLICT'})
  expect(await publishCollector(f.env,f.machine,f.input,'revision-race',now)).toMatchObject({status:'published_verified',ready:true})
  expect(publish).toHaveBeenCalledTimes(2)
  expect(publish.mock.calls[1][0]).toEqual(publish.mock.calls[0][0])
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_started'").get().n).toBe(1)
  expect(await publishCollector(f.env,f.machine,f.input,'revision-race',now)).toMatchObject({status:'published_verified'})
  expect(publish).toHaveBeenCalledTimes(2)
 })
 it.each(['database','generic-conflict','other-constraint','lost-cas-reply','post-commit'])('retains readback-only reconciliation after ambiguous %s failure',async mode=>{
  const f=await setup(),batch=f.tenantEnv.INVENTORY_DB.batch
  let dispatchBatches=0
  f.tenantEnv.INVENTORY_DB.batch=async statements=>{
   if(statements.some(s=>s.sql.includes('UPDATE cloud_app_revision SET revision=CASE'))){
    dispatchBatches++
    if(mode==='database')throw new Error('Synthetic D1 transport unavailable')
    if(mode==='generic-conflict')throw Object.assign(new Error('PUBLISH_CONFLICT_RETRY'),{code:'PUBLISH_CONFLICT_RETRY'})
    if(mode==='other-constraint')throw new Error('NOT NULL constraint failed: cloud_release_versions.report_date')
    if(mode==='lost-cas-reply'){
     f.tenant.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1').run()
     try{await batch(statements)}catch{throw new Error('Synthetic lost batch reply')}
    }
    await batch(statements)
    throw new Error('Synthetic reply lost after commit')
   }
   return batch(statements)
  }
  expect(await publishCollector(f.env,f.machine,f.input,mode,now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_revision_deferred'").get().n).toBe(0)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(mode==='post-commit'?1:0)
  expect(await publishCollector(f.env,f.machine,f.input,mode,now)).toMatchObject({status:mode==='post-commit'?'published_verified':'reconciliation_required'})
  expect(dispatchBatches).toBe(1)
 })
 it('does not classify preparation or fence failures as an atomic revision rollback',async()=>{
  const f=await setup(),prepare=f.tenantEnv.INVENTORY_DB.prepare
  f.tenantEnv.INVENTORY_DB.prepare=sql=>{
   if(sql.includes('UPDATE cloud_app_revision SET revision=CASE'))throw new Error('NOT NULL constraint failed: cloud_app_revision.revision')
   return prepare(sql)
  }
  const publish=vi.spyOn(f.env.TENANT_NORTH_PUBLISHER,'publish')
  expect(await publishCollector(f.env,f.machine,f.input,'prepare-failure',now)).toMatchObject({status:'reconciliation_required'})
  expect(await publishCollector(f.env,f.machine,f.input,'prepare-failure',now)).toMatchObject({status:'reconciliation_required'})
  expect(publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_revision_deferred'").get().n).toBe(0)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it.each(['missing-proof','foreign-attempt','foreign-fence','foreign-hash','foreign-date','extra-field'])('rejects a malformed or mismatched revision rollback proof: %s',async mode=>{
  const f=await setup(),proof={status:'revision_retryable',attemptId:f.attempt.attemptId,fence:f.attempt.fence,bundleSha256:f.envelope.bundleSha256,reportDate:f.envelope.reportDate,atomicRollback:true}
  if(mode==='missing-proof')delete proof.atomicRollback
  if(mode==='foreign-attempt')proof.attemptId='other-attempt'
  if(mode==='foreign-fence')proof.fence++
  if(mode==='foreign-hash')proof.bundleSha256='b'.repeat(64)
  if(mode==='foreign-date')proof.reportDate='2026-08-29'
  if(mode==='extra-field')proof.customer='SYNTHETIC_PRIVATE_VALUE'
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async()=>proof)
  expect(await publishCollector(f.env,f.machine,f.input,mode,now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
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
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe(['cancel','revoke'].includes(mode)?'cancelled':'expired')
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe(['cancel','revoke'].includes(mode)?'cancelled':['disabled','third-attempt'].includes(mode)?'failed':'queued')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_preflight_deferred'").get().n).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  if(['lease','deadline'].includes(mode))expect(await claimCollector(f.env,f.machine,{},'retry-after-positive-expiry',later)).toMatchObject({fence:2})
 })
 it.each(['lease','deadline','third-attempt','cancel','revoke','disabled'])('keeps revision rollback retries fenced and bounded after concurrent %s',async mode=>{
  const f=await setup(),later=new Date(now.getTime()+121000),batch=f.tenantEnv.INVENTORY_DB.batch
  if(mode==='deadline')f.sqlite.prepare('UPDATE platform_collector_attempts SET lease_until=?,hard_deadline=?').run(new Date(now.getTime()+120000).toISOString(),new Date(now.getTime()+120000).toISOString())
  if(mode==='third-attempt'){f.sqlite.prepare('UPDATE platform_collector_attempts SET fence=3').run();f.input.fence=3}
  f.tenantEnv.INVENTORY_DB.batch=async statements=>{
   if(statements.some(s=>s.sql.includes('UPDATE cloud_app_revision SET revision=CASE')))f.tenant.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1').run()
   return batch(statements)
  }
  const publish=f.env.TENANT_NORTH_PUBLISHER.publish
  f.env.TENANT_NORTH_PUBLISHER.publish=async(...args)=>{
   const proof=await publish(...args)
   if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic cancelled after rollback',expectedRevision:revision(f)},'cancel-cas')
   if(mode==='revoke')await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revoked after rollback',expectedRevision:revision(f)},'revoke-cas',now)
   if(mode==='disabled')f.env.PLATFORM_COLLECTOR_EXECUTION_ENABLED='false'
   return proof
  }
  expect(await publishCollector(f.env,f.machine,f.input,`late-cas-${mode}`,now,()=>later)).toMatchObject({status:'revision_retryable'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe(['cancel','revoke'].includes(mode)?'cancelled':'expired')
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe(['cancel','revoke'].includes(mode)?'cancelled':['disabled','third-attempt'].includes(mode)?'failed':'queued')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_revision_deferred'").get().n).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  if(['lease','deadline'].includes(mode))expect(await claimCollector(f.env,f.machine,{},'retry-after-rollback-expiry',later)).toMatchObject({fence:2})
 })
 it('preserves an unknown outcome when a positive preflight response is lost',async()=>{
  const f=await setup();f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async()=>{throw new Error('Synthetic lost preflight reply')})
  expect(await publishCollector(f.env,f.machine,f.input,'lost-preflight',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action='publication_preflight_deferred'").get().n).toBe(0)
 })
 it.each(['preflight','revision'].flatMap(proof=>['cancel','revoke'].map(mode=>({proof,mode}))))('settles $proof no-publication proof after owner $mode and frees only the exact group attempt',async({proof,mode})=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish,later=new Date(now.getTime()+45000)
  const otherRequest=await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[1].connectionId,reason:'Synthetic independent queued work',expectedRevision:revision(f)},'proof-other-request')
  const history={...f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get(),id:'synthetic-historical-attempt',request_id:otherRequest.id,claim_key:'synthetic-historical-claim',stage:'expired',failure_code:'DURATION_EXCEEDED',completed_at:now.toISOString()}
  // Independent history must retain its own request and configuration identity.
  const historyConfig={...JSON.parse(history.config_json),requestIds:[otherRequest.id],targetConnectionId:f.dealers[1].connectionId}
  history.config_json=JSON.stringify(historyConfig);history.config_sha256=await digest(historyConfig)
  const columns=Object.keys(history)
  f.sqlite.prepare(`INSERT INTO platform_collector_attempts (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(history))
  if(proof==='preflight')delete f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64
  else{
   const batch=f.tenantEnv.INVENTORY_DB.batch
   f.tenantEnv.INVENTORY_DB.batch=async statements=>{
    if(statements.some(s=>s.sql.includes('UPDATE cloud_app_revision SET revision=CASE')))f.tenant.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1').run()
    return batch(statements)
   }
  }
  let ownerAudit,collector
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const result=await publish(...args)
   expect(result.status).toBe(`${proof}_retryable`)
   if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic owner cancellation after no-publication proof',expectedRevision:revision(f)},'proof-cancel')
   else await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic owner revocation after no-publication proof',expectedRevision:revision(f)},'proof-revoke',now)
   expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts WHERE id=?').get(f.attempt.attemptId).stage).toBe('reconciliation_required')
   ownerAudit=f.sqlite.prepare('SELECT * FROM platform_audit WHERE request_key=?').get(`proof-${mode}`)
   collector=f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(f.collectorId)
   return result
  })
  expect(await publishCollector(f.env,f.machine,f.input,'owner-proof',now,()=>later)).toMatchObject({status:`${proof}_retryable`,ready:false})
  expect(f.sqlite.prepare('SELECT stage,failure_code,completed_at FROM platform_collector_attempts WHERE id=?').get(f.attempt.attemptId)).toEqual({stage:'cancelled',failure_code:mode==='cancel'?'CANCELLED_BY_OWNER':'COLLECTOR_REVOKED',completed_at:later.toISOString()})
  expect(f.sqlite.prepare('SELECT state,updated_at FROM platform_pull_requests WHERE id=?').get(f.attempt.requestId)).toEqual({state:'cancelled',updated_at:later.toISOString()})
  expect(f.sqlite.prepare('SELECT * FROM platform_collector_attempts WHERE id=?').get(history.id)).toEqual(history)
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests WHERE id=?').get(otherRequest.id).state).toBe('queued')
  expect(f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(f.collectorId)).toEqual(collector)
  expect(f.sqlite.prepare('SELECT * FROM platform_audit WHERE request_key=?').get(`proof-${mode}`)).toEqual(ownerAudit)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_attempts WHERE stage IN (\'claimed\',\'captured\',\'publishing\',\'reconciliation_required\')').get().n).toBe(0)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_audit WHERE action=? AND target_id=?').get(`publication_${proof}_deferred`,f.attempt.attemptId).n).toBe(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
  expect(f.tenant.prepare("SELECT bundle_sha256 FROM cloud_release_versions WHERE status='current'").get().bundle_sha256).toBe(f.baseline.bundleSha256)
  if(mode==='cancel'){
   f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64=f.key.toString('base64')
   expect(await claimCollector(f.env,f.machine,{},'proof-next-claim',later)).toMatchObject({requestId:otherRequest.id,fence:2})
  }else await expect(claimCollector(f.env,f.machine,{},'proof-revoked-claim',later)).rejects.toMatchObject({code:'COLLECTOR_REVOKED'})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
 })
 it.each(['preflight','revision'].flatMap(proof=>['cancel','revoke'].flatMap(mode=>['lost','malformed'].map(reply=>({proof,mode,reply})))) )('keeps owner $mode fenced when its $proof no-publication reply is $reply',async({proof,mode,reply})=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  if(proof==='preflight')delete f.tenantEnv.RELEASE_ENCRYPTION_KEY_BASE64
  else{
   const batch=f.tenantEnv.INVENTORY_DB.batch
   f.tenantEnv.INVENTORY_DB.batch=async statements=>{
    if(statements.some(s=>s.sql.includes('UPDATE cloud_app_revision SET revision=CASE')))f.tenant.prepare('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1').run()
    return batch(statements)
   }
  }
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{
   const result=await publish(...args)
   if(mode==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic cancellation with uncertain reply',expectedRevision:revision(f)},'uncertain-cancel')
   else await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revocation with uncertain reply',expectedRevision:revision(f)},'uncertain-revoke',now)
   if(reply==='lost')throw new Error('Synthetic no-publication reply lost')
   return proof==='preflight'?{...result,unrecognized:true}:{...result,atomicRollback:false}
  })
  expect(await publishCollector(f.env,f.machine,f.input,'uncertain-owner-proof',now)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage,failure_code,completed_at FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',failure_code:mode==='cancel'?'CANCELLED_BY_OWNER':'COLLECTOR_REVOKED',completed_at:null})
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action IN ('publication_preflight_deferred','publication_revision_deferred')").get().n).toBe(0)
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:f.attempt.attemptId},now)).toMatchObject({status:'reconciliation_required'})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.tenant.prepare('SELECT COUNT(*) AS n FROM collector_publication_receipts').get().n).toBe(0)
 })
 it.each(['preflight','revision'].flatMap(proof=>['fence','bundle','foreign-dispatch'].map(mismatch=>({proof,mismatch}))))('does not settle $proof proof against a mismatched saved $mismatch',async({proof,mismatch})=>{
  const f=await setup(),later=new Date(now.getTime()+121000)
  if(mismatch==='foreign-dispatch'){
   const hash=await digest({attemptId:f.attempt.attemptId,bundleSha256:f.envelope.bundleSha256,configSha256:f.attempt.configSha256})
   f.sqlite.prepare("INSERT INTO platform_audit SELECT id||'-foreign',actor_id,actor_name,entity,'synthetic-foreign-attempt','publication_started',reason,previous_json,next_json,'publish:isolated-proof',?,created_at FROM platform_audit WHERE action='claimed' LIMIT 1").run(hash)
  }
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async()=>{
   if(mismatch==='fence')f.sqlite.prepare('UPDATE platform_collector_attempts SET fence=fence+1').run()
   if(mismatch==='bundle')f.sqlite.prepare('UPDATE platform_collector_attempts SET expected_bundle_sha256=?').run('b'.repeat(64))
   return proof==='preflight'?{status:'preflight_retryable'}:{status:'revision_retryable',attemptId:f.attempt.attemptId,fence:f.attempt.fence,bundleSha256:f.envelope.bundleSha256,reportDate:f.envelope.reportDate,atomicRollback:true}
  })
  expect(await publishCollector(f.env,f.machine,f.input,'isolated-proof',now,()=>later)).toMatchObject({status:'reconciliation_required'})
  expect(f.sqlite.prepare('SELECT stage,completed_at FROM platform_collector_attempts').get()).toEqual({stage:'reconciliation_required',completed_at:null})
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('reconciliation_required')
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_audit WHERE action IN ('publication_preflight_deferred','publication_revision_deferred')").get().n).toBe(0)
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
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
  const f=await setup(),real=f.env.TENANT_NORTH_PUBLISHER.publish,later=new Date(now.getTime()+45000)
  let current=now
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{await real(...args);current=later;throw new Error('SYNTHETIC_PRIVATE_FAILURE')})
  const readReceipt=vi.fn(ticket=>readTenantPublicationReceipt(f.tenantEnv,ticket,current))
  f.env.TENANT_NORTH_PUBLISHER.readReceipt=readReceipt
  expect(await publishCollector(f.env,f.machine,f.input,'timeout',now,()=>current)).toMatchObject({status:'reconciliation_required',ready:false})
  expect(readReceipt).not.toHaveBeenCalled()
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('reconciliation_required')
  expect(f.sqlite.prepare('SELECT updated_at FROM platform_pull_requests').get().updated_at).toBe(later.toISOString())
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind=\'publication\'').get().n).toBe(0)
  current=new Date(now.getTime()+180000)
  expect(await publishCollector(f.env,f.machine,f.input,'reconcile',now,()=>current)).toMatchObject({status:'published_verified',verifiedAt:current.toISOString()})
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind=\'publication\'').get().n).toBe(1)
 })
 it.each(['published','unchanged'].flatMap(mode=>['none','cancel','revoke'].map(ownerAction=>({mode,ownerAction}))))('settles a lost committed $mode receipt after supersession and owner $ownerAction',async({mode,ownerAction})=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  const otherRequest=await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'request',connectionId:f.dealers[1].connectionId,reason:'Synthetic independently queued request',expectedRevision:revision(f)},'superseded-other-request')
  const historical={...f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get(),id:'synthetic-prior-receipt-attempt',request_id:otherRequest.id,claim_key:'synthetic-prior-receipt-claim',stage:'expired',failure_code:'DURATION_EXCEEDED',completed_at:now.toISOString()}
  // Independent history must retain its own request and configuration identity.
  const historicalConfig={...JSON.parse(historical.config_json),requestIds:[otherRequest.id],targetConnectionId:f.dealers[1].connectionId}
  historical.config_json=JSON.stringify(historicalConfig);historical.config_sha256=await digest(historicalConfig)
  const historicalColumns=Object.keys(historical)
  f.sqlite.prepare(`INSERT INTO platform_collector_attempts (${historicalColumns.join(',')}) VALUES (${historicalColumns.map(()=>'?').join(',')})`).run(...Object.values(historical))
  const queued=f.sqlite.prepare('SELECT * FROM platform_pull_requests WHERE id=?').get(otherRequest.id)
  if(mode==='unchanged')f.input.envelope=f.baseline
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{await publish(...args);throw new Error('Synthetic committed reply lost')})
  expect(await publishCollector(f.env,f.machine,f.input,'superseded-receipt',now)).toMatchObject({status:'reconciliation_required'})
  const tenantReceipt=f.tenant.prepare('SELECT * FROM collector_publication_receipts').get()
  expect(tenantReceipt.status).toBe(mode)
  const newer=structuredClone(f.candidate),vehicle=newer.release.vehicles.find(v=>v.publicRecord)
  newer.release.publicSnapshot.vehicles[vehicle.vin].listed_price+=1000
  vehicle.publicRecord.listed_price=newer.release.publicSnapshot.vehicles[vehicle.vin].listed_price
  newer.release.sourceRuns.public.sha256='d'.repeat(64)
  newer.release.completedAt=new Date(now.getTime()+1000).toISOString()
  const newerEnvelope=encryptBundle(newer,f.key)
  expect((await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(newerEnvelope)}),f.tenantEnv)).status).toBe(201)
  const afterNewer={revision:f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision,versions:f.tenant.prepare('SELECT * FROM cloud_release_versions ORDER BY release_id').all(),state:f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all(),intake:f.tenant.prepare('SELECT * FROM vehicle_service_intake ORDER BY vin').all()}
  let ownerAudit,collector
  if(ownerAction==='cancel')await saveDataControl(f.env,owner,'synthetic-north','pulls',{operation:'cancel',connectionId:f.dealers[0].connectionId,requestId:f.attempt.requestId,reason:'Synthetic cancellation after superseded acceptance',expectedRevision:revision(f)},'superseded-owner-cancel')
  if(ownerAction==='revoke')await saveCollector(f.env,owner,'synthetic-north',{operation:'revoke',id:f.collectorId,reason:'Synthetic revocation after superseded acceptance',expectedRevision:revision(f)},'superseded-owner-revoke',now)
  if(ownerAction!=='none'){
   ownerAudit=f.sqlite.prepare('SELECT * FROM platform_audit WHERE request_key=?').get(`superseded-owner-${ownerAction}`)
   collector=f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(f.collectorId)
  }
  expect(f.tenant.prepare('SELECT status FROM cloud_release_versions WHERE bundle_sha256=?').get(tenantReceipt.bundle_sha256).status).toBe('superseded')
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:f.attempt.attemptId},now)).toMatchObject({status:`${mode}_verified`,bundleSha256:tenantReceipt.bundle_sha256,reportDate:tenantReceipt.report_date,ready:true,counts:{inventory:8}})
  expect(f.sqlite.prepare('SELECT stage FROM platform_collector_attempts').get().stage).toBe('completed')
  expect(f.sqlite.prepare('SELECT state FROM platform_pull_requests').get().state).toBe('completed')
  expect(f.sqlite.prepare('SELECT * FROM platform_collector_attempts WHERE id=?').get(historical.id)).toEqual(historical)
  expect(f.sqlite.prepare('SELECT * FROM platform_pull_requests WHERE id=?').get(otherRequest.id)).toEqual(queued)
  expect(f.tenant.prepare('SELECT * FROM collector_publication_receipts').get()).toEqual(tenantReceipt)
  expect(f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(afterNewer.revision)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_versions ORDER BY release_id').all()).toEqual(afterNewer.versions)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all()).toEqual(afterNewer.state)
  expect(f.tenant.prepare('SELECT * FROM vehicle_service_intake ORDER BY vin').all()).toEqual(afterNewer.intake)
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_attempts WHERE stage IN ('claimed','captured','publishing','reconciliation_required')").get().n).toBe(0)
  if(ownerAction!=='none'){
   expect(f.sqlite.prepare('SELECT * FROM platform_audit WHERE request_key=?').get(`superseded-owner-${ownerAction}`)).toEqual(ownerAudit)
   expect(f.sqlite.prepare('SELECT * FROM platform_collectors WHERE id=?').get(f.collectorId)).toEqual(collector)
  }
  if(ownerAction==='revoke')await expect(claimCollector(f.env,f.machine,{},'after-superseded-claim',now)).rejects.toMatchObject({code:'COLLECTOR_REVOKED'})
  else expect(await claimCollector(f.env,f.machine,{},'after-superseded-claim',now)).toMatchObject({requestId:otherRequest.id,fence:2,baselineBundleSha256:newerEnvelope.bundleSha256})
 })
 it.each(['published','unchanged'].flatMap(mode=>['missing-receipt','missing-version','rejected-version','version-hash','version-date','version-object','version-source','version-count','version-metadata','missing-object','object-hash','object-date','object-ciphertext','receipt-count','receipt-grant','receipt-fence','receipt-group','receipt-config','receipt-status'].flatMap(corruption=>(['missing-version','rejected-version','missing-object','object-ciphertext','receipt-count'].includes(corruption)?['current','superseded']:['current']).map(state=>({mode,corruption,state})))) )('keeps a committed $mode receipt unknown with $state version and $corruption corruption',async({mode,corruption,state})=>{
  const f=await setup(),publish=f.env.TENANT_NORTH_PUBLISHER.publish
  if(mode==='unchanged')f.input.envelope=f.baseline
  f.env.TENANT_NORTH_PUBLISHER.publish=vi.fn(async(...args)=>{await publish(...args);throw new Error('Synthetic receipt reply lost')})
  expect(await publishCollector(f.env,f.machine,f.input,'corrupt-receipt',now)).toMatchObject({status:'reconciliation_required'})
  const receipt=f.tenant.prepare('SELECT * FROM collector_publication_receipts').get()
  const version=f.tenant.prepare('SELECT * FROM cloud_release_versions WHERE bundle_sha256=?').get(receipt.bundle_sha256)
  const originalObject=f.objects.get(version.object_key)
  if(state==='superseded'){
   const newer=structuredClone(f.candidate),vehicle=newer.release.vehicles.find(v=>v.publicRecord)
   newer.release.publicSnapshot.vehicles[vehicle.vin].listed_price+=1000
   vehicle.publicRecord.listed_price=newer.release.publicSnapshot.vehicles[vehicle.vin].listed_price
   newer.release.sourceRuns.public.sha256='d'.repeat(64)
   newer.release.completedAt=new Date(now.getTime()+1000).toISOString()
   const newerEnvelope=encryptBundle(newer,f.key)
   expect((await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(newerEnvelope)}),f.tenantEnv)).status).toBe(201)
   expect(f.tenant.prepare('SELECT status FROM cloud_release_versions WHERE bundle_sha256=?').get(receipt.bundle_sha256).status).toBe('superseded')
  }
  if(corruption==='missing-version')f.tenant.prepare('DELETE FROM cloud_release_versions WHERE release_id=?').run(version.release_id)
  if(corruption==='rejected-version')f.tenant.prepare("UPDATE cloud_release_versions SET status='rejected' WHERE release_id=?").run(version.release_id)
  if(corruption==='version-hash')f.tenant.prepare('UPDATE cloud_release_versions SET bundle_sha256=? WHERE release_id=?').run('e'.repeat(64),version.release_id)
  if(corruption==='version-date')f.tenant.prepare('UPDATE cloud_release_versions SET report_date=? WHERE release_id=?').run('2026-08-29',version.release_id)
  if(corruption==='version-object')f.tenant.prepare('UPDATE cloud_release_versions SET object_key=? WHERE release_id=?').run('releases/foreign/version.json.enc',version.release_id)
  if(corruption==='version-source')f.tenant.prepare('UPDATE cloud_release_versions SET public_source_sha256=? WHERE release_id=?').run('e'.repeat(64),version.release_id)
  if(corruption==='version-count')f.tenant.prepare('UPDATE cloud_release_versions SET public_row_count=public_row_count+1 WHERE release_id=?').run(version.release_id)
  if(corruption==='version-metadata')f.tenant.prepare('UPDATE cloud_release_versions SET metadata_json=? WHERE release_id=?').run('{}',version.release_id)
  if(corruption==='missing-object')f.objects.delete(version.object_key)
  if(corruption.startsWith('object-')){
   const envelope=JSON.parse(originalObject.body)
   if(corruption==='object-hash')envelope.bundleSha256='e'.repeat(64)
   if(corruption==='object-date')envelope.reportDate='2026-08-29'
   if(corruption==='object-ciphertext')envelope.ciphertext=(envelope.ciphertext[0]==='A'?'B':'A')+envelope.ciphertext.slice(1)
   f.objects.set(version.object_key,{...originalObject,body:JSON.stringify(envelope)})
  }
  if(corruption==='missing-receipt' || corruption.startsWith('receipt-')){
   // Receipts are append-only. Inject a corrupted read result without disabling
   // their schema triggers or permitting a production receipt rewrite.
   const prepare=f.tenantEnv.INVENTORY_DB.prepare
   f.tenantEnv.INVENTORY_DB.prepare=sql=>{
    const statement=prepare(sql)
    if(sql.includes('SELECT * FROM collector_publication_receipts')){
     const bind=statement.bind
     statement.bind=(...args)=>{const bound=bind.apply(statement,args),first=bound.first;bound.first=async()=>{
      const row=await first.call(bound)
      if(corruption==='missing-receipt')return null
      if(corruption==='receipt-count')return {...row,counts_json:JSON.stringify({...JSON.parse(row.counts_json),activeInventoryCount:999})}
      const field={'receipt-grant':'grant_generation','receipt-fence':'fence','receipt-group':'group_id','receipt-config':'config_sha256','receipt-status':'status'}[corruption]
      return {...row,[field]:typeof row[field]==='number'?row[field]+1:'synthetic-invalid-binding'}
     };return bound}
    }
    return statement
   }
  }
  const before={revision:revision(f),attempt:f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get(),request:f.sqlite.prepare('SELECT * FROM platform_pull_requests').get(),tenantRevision:f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision,state:f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all()}
  expect(await reconcileCollector(f.env,owner,'synthetic-north',{attemptId:f.attempt.attemptId},now)).toMatchObject({status:'reconciliation_required',ready:false})
  expect(revision(f)).toBe(before.revision)
  expect(f.sqlite.prepare('SELECT * FROM platform_collector_attempts').get()).toEqual(before.attempt)
  expect(f.sqlite.prepare('SELECT * FROM platform_pull_requests').get()).toEqual(before.request)
  expect(f.tenant.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(before.tenantRevision)
  expect(f.tenant.prepare('SELECT * FROM cloud_release_state ORDER BY key').all()).toEqual(before.state)
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_collector_receipts WHERE kind='publication'").get().n).toBe(0)
  expect(f.env.TENANT_NORTH_PUBLISHER.publish).toHaveBeenCalledTimes(1)
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
