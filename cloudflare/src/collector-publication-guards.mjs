import { importJWK, jwtVerify } from 'jose'
import { assertTenantIdentity } from './tenant-gate.mjs'
import { collectorScope, scopeGuard } from './collector-execution.mjs'
import { canonical, collectorFail, executionEnabled } from './collector-common.mjs'

export async function verifyPublicationTicket(env,authorization,operation,now=new Date()) {
 if(operation==='publish' && !executionEnabled(env) || !env.PLATFORM_CONTROL_DB || !env.PLATFORM_TENANT_ID || !env.COLLECTOR_PUBLICATION_PUBLIC_KEY)collectorFail('COLLECTOR_PUBLICATION_UNAVAILABLE',503)
 let payload
 try {const key=await importJWK(JSON.parse(env.COLLECTOR_PUBLICATION_PUBLIC_KEY),'EdDSA');payload=(await jwtVerify(authorization,key,{algorithms:['EdDSA'],issuer:'inventory-flow-collector-control',audience:`tenant/${env.PLATFORM_TENANT_ID}`,currentDate:now,requiredClaims:['exp','iat','jti']})).payload}
 catch {collectorFail('COLLECTOR_AUTH_REQUIRED',403)}
 if(payload.operation!==operation || payload.groupId!==env.PLATFORM_TENANT_ID || payload.exp-payload.iat>30)collectorFail('COLLECTOR_AUTH_REQUIRED',403)
 await assertTenantIdentity(env.INVENTORY_DB,payload.groupId)
 const attempt=await env.PLATFORM_CONTROL_DB.prepare('SELECT a.*,p.state AS request_state FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id WHERE a.id=? AND a.group_id=? AND a.collector_id=?').bind(payload.attemptId,payload.groupId,payload.collectorId).first()
 if(!attempt || attempt.fence!==payload.fence || attempt.grant_generation!==payload.grantGeneration || attempt.config_sha256!==payload.configSha256 || attempt.scope_sha256!==payload.scopeSha256 || attempt.expected_bundle_sha256!==payload.bundleSha256 || attempt.report_date!==payload.reportDate)collectorFail('COLLECTOR_LEASE_STALE',409)
 if(operation==='publish')await assertPublicationFence(env,payload,now)
 return {ticket:payload,attempt}
}

// Recheck immediately before tenant acceptance. Cross-database cancellation
// cannot roll back an already admitted tenant transaction; that race remains
// reconciliation_required until the tenant receipt is independently read.
export async function assertPublicationFence(env,ticket,now=new Date()) {
 if(!executionEnabled(env))collectorFail('COLLECTOR_DISABLED',403)
 const db=env.PLATFORM_CONTROL_DB
 const row=await db.prepare('SELECT * FROM platform_collectors WHERE id=? AND group_id=?').bind(ticket.collectorId,ticket.groupId).first()
 if(!row || !row.enabled || row.revoked_at || row.generation!==ticket.grantGeneration)collectorFail('COLLECTOR_LEASE_STALE',409)
 const scope=await collectorScope({PLATFORM_DB:db},row,{active:true}),guard=scopeGuard(row,scope)
 const valid=await db.prepare(`SELECT a.id FROM platform_collector_attempts a JOIN platform_pull_requests p ON p.id=a.request_id WHERE a.id=? AND a.fence=? AND a.config_sha256=? AND a.expected_bundle_sha256=? AND a.stage='publishing' AND p.state='running' AND a.lease_until>? AND a.hard_deadline>? AND ${guard.sql}`).bind(ticket.attemptId,ticket.fence,ticket.configSha256,ticket.bundleSha256,now.toISOString(),now.toISOString(),...guard.args).first()
 if(!valid)collectorFail('COLLECTOR_LEASE_STALE',409)
 const frozen=JSON.parse((await db.prepare('SELECT config_json FROM platform_collector_attempts WHERE id=?').bind(ticket.attemptId).first()).config_json)
 const current={...frozen,...scope}
 if(canonical(current)!==canonical(frozen))collectorFail('COLLECTOR_LEASE_STALE',409)
}

export function publicationReceiptStatement(env,ticket,counts,status,now=new Date()) {
 return env.INVENTORY_DB.prepare('INSERT INTO collector_publication_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(ticket.attemptId,ticket.groupId,ticket.collectorId,ticket.fence,ticket.grantGeneration,ticket.configSha256,ticket.bundleSha256,ticket.reportDate,canonical(counts),status,now.toISOString())
}
