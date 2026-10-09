// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// In-memory control plane, tenant D1 and R2 exercising the actual broker.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { generateKeyPair, exportJWK } from 'jose'
import { createSyntheticPlatformAdmin } from './synthetic-platform-admin.mjs'
import { buildSyntheticCloudBundle } from './synthetic-cloud-bundle.mjs'
import { applySyntheticSchema, sqliteD1 } from '../scripts/run-recovery-drill.mjs'
import { encryptBundle } from '../scripts/publish-cloud-release.mjs'
import { publishRelease } from '../cloudflare/src/worker.mjs'
import { publishTenantCandidate, readTenantPublicationReceipt } from '../cloudflare/src/collector-publication.mjs'
import { saveCollector } from '../cloudflare/src/collector-execution.mjs'

export const COLLECTOR_SYNTHETIC_NOW=new Date('2026-08-30T15:00:00Z')
export const COLLECTOR_OWNER={email:'owner@example.invalid'}
export async function createSyntheticCollector({groupId='synthetic-north',enroll=true}={}) {
 const fixture=createSyntheticPlatformAdmin({groupId}),{sqlite,env}=fixture,tenant=new DatabaseSync(':memory:')
 applySyntheticSchema(tenant)
 tenant.exec(readFileSync(new URL('../cloudflare/tenant-migrations/0001_tenant_identity.sql',import.meta.url),'utf8'))
 tenant.prepare('INSERT INTO inventory_tenant_identity VALUES(1,?)').run(groupId)
 sqlite.prepare('DELETE FROM platform_dealerships WHERE group_id=?').run(groupId)
 const dealers=['howell','fowlerville','ford-detroit','lincoln'].map((storeKey,i)=>({id:`${groupId}-dealer-${i}`,storeKey,connectionId:`${groupId}-source-${i}`}))
 for(const d of dealers){sqlite.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,1)').run(d.id,groupId,`Synthetic ${d.storeKey}`,d.storeKey,'');sqlite.prepare('INSERT INTO platform_data_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(d.connectionId,groupId,d.id,`Synthetic ${d.storeKey} DealerMail`,'dealermail','DealerMail','not_applicable','collector','','CREDENTIAL_SYNTHETIC_MAIL',1,'manual','05:30','America/Detroit',COLLECTOR_SYNTHETIC_NOW.toISOString(),COLLECTOR_SYNTHETIC_NOW.toISOString())}
 const objects=new Map(),bucket={async put(key,body,options={}){objects.set(key,{body:String(body),...options})},async get(key){const row=objects.get(key);return row?{...row,size:Buffer.byteLength(row.body),text:async()=>row.body}:null},async head(key){const row=objects.get(key);return row?{...row,size:Buffer.byteLength(row.body)}:null}}
 const keys=await generateKeyPair('EdDSA',{extractable:true}),key=Buffer.alloc(32,42),tenantEnv={INVENTORY_DB:sqliteD1(tenant),RELEASE_SNAPSHOTS:bucket,RELEASE_ENCRYPTION_KEY_BASE64:key.toString('base64'),PLATFORM_CONTROL_DB:env.PLATFORM_DB,PLATFORM_TENANT_ID:groupId,PLATFORM_COLLECTOR_EXECUTION_ENABLED:'true',COLLECTOR_PUBLICATION_PUBLIC_KEY:JSON.stringify(await exportJWK(keys.publicKey))}
 const bundle=buildSyntheticCloudBundle(),baseline=encryptBundle(bundle,key)
 await publishRelease(new Request('https://synthetic.invalid/internal/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(baseline)}),tenantEnv)
 Object.assign(env,{TENANT_NORTH_DB:tenantEnv.INVENTORY_DB,PLATFORM_COLLECTOR_EXECUTION_ENABLED:'true',ACCESS_COLLECTOR_AUDIENCE:'synthetic-collector-aud',COLLECTOR_PUBLICATION_PRIVATE_KEY:JSON.stringify(await exportJWK(keys.privateKey)),PLATFORM_COLLECTOR_PUBLICATION_BINDINGS:JSON.stringify({[groupId]:'TENANT_NORTH_PUBLISHER'}),TENANT_NORTH_PUBLISHER:{publish:(envelope,ticket)=>publishTenantCandidate(tenantEnv,envelope,ticket,COLLECTOR_SYNTHETIC_NOW),readReceipt:ticket=>readTenantPublicationReceipt(tenantEnv,ticket,COLLECTOR_SYNTHETIC_NOW)}})
 const profileSha256='a'.repeat(64),machine={common_name:`${groupId}.collector.access`}
 let collectorId
 if(enroll){const saved=await saveCollector(env,COLLECTOR_OWNER,groupId,{operation:'enroll',name:'Synthetic registered host',accessClientId:machine.common_name,adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-holds-four-store',profileSha256,dealershipIds:dealers.map(d=>d.id),connectionIds:dealers.map(d=>d.connectionId),reason:'Synthetic enrollment',expectedRevision:0},'enroll',COLLECTOR_SYNTHETIC_NOW);collectorId=saved.id;await saveCollector(env,COLLECTOR_OWNER,groupId,{operation:'enable',id:collectorId,reason:'Synthetic activation',expectedRevision:1},'enable',COLLECTOR_SYNTHETIC_NOW)}
 return {...fixture,tenant,tenantEnv,bucket,objects,baseline,bundle,key,dealers,machine,collectorId,profileSha256,close(){tenant.close();fixture.close()}}
}
