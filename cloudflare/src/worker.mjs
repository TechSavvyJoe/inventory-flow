import { timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { AccessError, memberContext, verifyAccess } from './access.mjs'
import { validateReleaseBundle } from './release-validation.mjs'
import { loadD1Repository, RepositoryConflictError } from './repository.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { WorkflowError } from '../../server/workflow.mjs'
import { importLedger, LedgerImportError } from './ledger-import.mjs'

const FORMAT = 'inventory-flow-private-release-v1'
const LEDGER_FORMAT = 'inventory-flow-private-ledger-v1'
const MAX_UPLOAD = 25 * 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const headers = {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}
function json(status, data) { return new Response(JSON.stringify(data), {status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}}) }
class HttpError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status } }
function equal(a, b) { const left=encoder.encode(String(a??'')), right=encoder.encode(String(b??'')); return left.length === right.length && timingSafeEqual(left,right) }
function bytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw new HttpError('INVALID_ENCRYPTED_CONTENT')
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0, length=value.length-padding, remainder=length%4
  if(remainder===1 || (padding && (value.length%4!==0 || padding!==4-remainder))) throw new HttpError('INVALID_ENCRYPTED_CONTENT')
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', last=value[length-1].replace('-','+').replace('_','/'), tail=alphabet.indexOf(last)
  if((remainder===2 && (tail&15)!==0) || (remainder===3 && (tail&3)!==0)) throw new HttpError('INVALID_ENCRYPTED_CONTENT')
  // Native decoding avoids a multi-million-element temporary JS array. That
  // string-iterator allocation can exceed Worker memory and CPU budgets.
  return Buffer.from(value,'base64url')
}
async function digest(data) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('') }
export async function readJson(request, limit) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError('JSON_CONTENT_REQUIRED',415)
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError('BODY_TOO_LARGE',413)
  const reader=request.body?.getReader()
  if (!reader) throw new HttpError('EMPTY_BODY')
  let size=0; const chunks=[]
  try {
    while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>limit) {await reader.cancel();throw new HttpError('BODY_TOO_LARGE',413)} chunks.push(value) }
    const all=new Uint8Array(size); let offset=0
    for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength}
    const result=JSON.parse(decoder.decode(all))
    if(!result || typeof result!=='object' || Array.isArray(result)) throw new Error()
    return result
  } catch(error) { if(error instanceof HttpError) throw error; throw new HttpError('INVALID_JSON') }
  finally {reader.releaseLock()}
}

const TRANSPORT_ASSIGNMENT_EVENTS = new Set(['transport_assigned', 'return_assigned'])

/** Resolve the existing display-name control to one server-owned membership. */
export async function resolveTransportAssignment(input, env) {
  const eventType = String(input?.type ?? '').trim().toLowerCase()
  if (!TRANSPORT_ASSIGNMENT_EVENTS.has(eventType)) return input
  if (Object.hasOwn(input, 'assigneeUserId')) {
    throw new HttpError('ASSIGNEE_IDENTITY_CLIENT_CONTROLLED', 422)
  }
  const assignee = String(input?.assignee ?? '').trim()
  if (!assignee || assignee.length > 160 || /[\u0000-\u001f\u007f]/.test(assignee)) {
    throw new HttpError('ASSIGNEE_REQUIRED', 422)
  }
  let result
  try {
    result = await env.INVENTORY_DB.prepare(`
      SELECT user_id, name, role
      FROM cloud_memberships
      WHERE enabled = 1
        AND role IN ('porter', 'driver')
        AND name = ? COLLATE NOCASE
      ORDER BY user_id
      LIMIT 2
    `).bind(assignee).all()
  } catch {
    throw new HttpError('ASSIGNEE_DIRECTORY_UNAVAILABLE', 503)
  }
  const rows = Array.isArray(result?.results) ? result.results : []
  if (rows.length === 0) throw new HttpError('ASSIGNEE_NOT_AUTHORIZED', 422)
  if (rows.length !== 1) throw new HttpError('ASSIGNEE_NAME_AMBIGUOUS', 422)
  const member = rows[0]
  const valid = (value) => typeof value === 'string' && value.trim() && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
  if (!valid(member.user_id) || !valid(member.name) || !['porter', 'driver'].includes(member.role)) {
    throw new HttpError('ASSIGNEE_NOT_AUTHORIZED', 422)
  }
  return { ...input, assignee: member.name, assigneeUserId: member.user_id }
}

export async function prepareTransportAssignment(input, env, preflight) {
  const preflightInput = { ...input }
  delete preflightInput.assigneeUserId
  try {
    return { input: preflightInput, replay: preflight(preflightInput) }
  } catch (error) {
    if (!(error instanceof WorkflowError) || error.code !== 'ASSIGNEE_IDENTITY_REQUIRED') throw error
    if (Object.hasOwn(input, 'assigneeUserId')) throw new HttpError('ASSIGNEE_IDENTITY_CLIENT_CONTROLLED', 422)
    return { input: await resolveTransportAssignment(preflightInput, env), replay: null }
  }
}
export async function decryptEnvelope(envelope, env, format=FORMAT) {
  if(envelope?.version!==format || !/^\d{4}-\d{2}-\d{2}$/.test(envelope.reportDate??'') || !/^[a-f0-9]{64}$/.test(envelope.bundleSha256??'')) throw new HttpError('INVALID_ENVELOPE')
  if(typeof envelope.ciphertext!=='string' || envelope.ciphertext.length>MAX_UPLOAD) throw new HttpError('BODY_TOO_LARGE',413)
  const iv=bytes(envelope.iv), encrypted=bytes(envelope.ciphertext), keyBytes=bytes(env.RELEASE_ENCRYPTION_KEY_BASE64)
  if(iv.length!==12 || encrypted.length<17 || keyBytes.length!==32) throw new HttpError('INVALID_ENCRYPTED_CONTENT')
  try {
    const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt'])
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`${format}:${envelope.reportDate}:${envelope.bundleSha256}`)},key,encrypted)
    if(await digest(plaintext)!==envelope.bundleSha256) throw new Error()
    const bundle=JSON.parse(decoder.decode(plaintext))
    if(bundle.schemaVersion!==format || bundle.reportDate!==envelope.reportDate) throw new Error()
    if(format===FORMAT) validateReleaseBundle(bundle)
    return bundle
  } catch {throw new HttpError('INVALID_OR_INCOMPLETE_RELEASE')}
}
const CURRENT_SQL=`SELECT v.* FROM cloud_release_state s JOIN cloud_release_versions v ON v.release_id=s.value WHERE s.key='current_release_id' AND v.status='current'`
async function currentRelease(env) {return env.INVENTORY_DB.prepare(CURRENT_SQL).first()}
export function releaseCompletionTime(value) {
  if(typeof value!=='string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw new HttpError('INVALID_RELEASE_COMPLETION_TIME')
  return Date.parse(value)
}
export function assertReleaseOrdering(current, reportDate, completedAt) {
  const incomingTime=releaseCompletionTime(completedAt)
  if(!current) return
  if(current.report_date>reportDate) throw new HttpError('OLDER_RELEASE_REJECTED',409)
  if(current.report_date!==reportDate) return
  let metadata
  try {metadata=JSON.parse(current.metadata_json)} catch {throw new HttpError('CURRENT_RELEASE_METADATA_INVALID',503)}
  if(!metadata || typeof metadata!=='object' || Array.isArray(metadata)) throw new HttpError('CURRENT_RELEASE_METADATA_INVALID',503)
  // Initial scaffold releases could lack completedAt. Permit a validated new
  // release to repair that legacy state, but never accept a new missing time.
  if(metadata.completedAt===null || metadata.completedAt===undefined) return
  let currentTime
  try {currentTime=releaseCompletionTime(metadata.completedAt)} catch {throw new HttpError('CURRENT_RELEASE_METADATA_INVALID',503)}
  if(currentTime>incomingTime) throw new HttpError('OLDER_RELEASE_REJECTED',409)
}
async function readRelease(env) {
  const row=await currentRelease(env)
  if(!row) throw new HttpError('INVENTORY_NOT_IMPORTED',503)
  const object=await env.RELEASE_SNAPSHOTS.get(row.object_key)
  if(!object || object.size>MAX_UPLOAD) throw new HttpError('RELEASE_ARTIFACT_UNAVAILABLE',503)
  const envelope=JSON.parse(await object.text())
  if(envelope.bundleSha256!==row.bundle_sha256) throw new HttpError('RELEASE_ARTIFACT_UNAVAILABLE',503)
  return (await decryptEnvelope(envelope,env)).release
}
export async function appReadiness(env) {
  const release=await readRelease(env)
  const repo=await loadD1Repository(env.INVENTORY_DB,release)
  const service=createInventoryServiceCore({database:repo.database,repository:repo.repository,initialLoadStatus:{status:'loaded'}})
  // Fixed least-privileged context exercises the real read pipeline without
  // accepting browser claims or exposing any employee/customer evidence.
  const bootstrap=service.bootstrap({role:'driver',store:'Howell',user:'Cloud readiness diagnostic'})
  return {
    ready:true,reportDate:bootstrap.meta.reportDate,
    counts:{inventory:bootstrap.vehicles.length,transfers:bootstrap.transfers.length,attention:bootstrap.attention.length},
    bootstrapBytes:encoder.encode(JSON.stringify(bootstrap)).byteLength,
  }
}
async function publisher(request, env) {
  const claims=await verifyAccess(request,env,env.ACCESS_PUBLISHER_AUDIENCE)
  if(!env.PUBLISHER_CLIENT_ID || !equal(claims.common_name,env.PUBLISHER_CLIENT_ID) || claims.email) throw new AccessError('PUBLISHER_IDENTITY_REQUIRED',403)
  if(!env.RELEASE_PUBLISHER_TOKEN || !equal(request.headers.get('authorization'),`Bearer ${env.RELEASE_PUBLISHER_TOKEN}`)) throw new AccessError('PUBLISHER_AUTHENTICATION_REQUIRED',403)
}
async function publishRelease(request, env) {
  const envelope=await readJson(request,MAX_UPLOAD)
  const bundle=await decryptEnvelope(envelope,env)
  const counts=validateReleaseBundle(bundle)
  releaseCompletionTime(bundle.release.completedAt)
  const existing=await env.INVENTORY_DB.prepare('SELECT * FROM cloud_release_versions WHERE bundle_sha256=? AND report_date=?').bind(envelope.bundleSha256,envelope.reportDate).first()
  if(existing && existing.status!=='rejected' && await env.RELEASE_SNAPSHOTS.head(existing.object_key)) return json(200,{status:'already_published',reportDate:envelope.reportDate})
  const state=await env.INVENTORY_DB.batch([env.INVENTORY_DB.prepare('SELECT revision FROM cloud_app_revision WHERE id=1'),env.INVENTORY_DB.prepare(CURRENT_SQL)])
  const revision=state[0].results[0]?.revision, current=state[1].results[0]
  if(!Number.isSafeInteger(revision)) throw new HttpError('DATABASE_NOT_CONFIGURED',503)
  assertReleaseOrdering(current,envelope.reportDate,bundle.release.completedAt)
  const objectKey=`releases/${envelope.reportDate}/${envelope.bundleSha256}.json.enc`, serialized=JSON.stringify(envelope)
  await env.RELEASE_SNAPSHOTS.put(objectKey,serialized,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{reportDate:envelope.reportDate,bundleSha256:envelope.bundleSha256}})
  const id=existing?.release_id??crypto.randomUUID(), time=new Date().toISOString()
  const metadata=JSON.stringify({completedAt:bundle.release.completedAt,timezone:bundle.release.timezone,warningCount:bundle.release.warnings?.length??0,...counts})
  try {
    await env.INVENTORY_DB.batch([
      env.INVENTORY_DB.prepare('UPDATE cloud_app_revision SET revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END WHERE id=1').bind(revision),
      env.INVENTORY_DB.prepare("UPDATE cloud_release_versions SET status='superseded' WHERE status='current'"),
      env.INVENTORY_DB.prepare(`INSERT INTO cloud_release_versions (release_id,report_date,bundle_sha256,object_key,object_bytes,public_source_sha256,dealermail_source_sha256,public_row_count,dealermail_row_count,status,published_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,'current',?,?) ON CONFLICT(release_id) DO UPDATE SET status='current',published_at=excluded.published_at,metadata_json=excluded.metadata_json`).bind(id,envelope.reportDate,envelope.bundleSha256,objectKey,encoder.encode(serialized).length,bundle.release.sourceRuns.public.sha256,bundle.release.sourceRuns.dealerMail.sha256,counts.publicRowCount,counts.dealerMailRowCount,time,metadata),
      env.INVENTORY_DB.prepare("INSERT INTO cloud_release_state(key,value,updated_at) VALUES('current_release_id',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(id,time),
    ])
  } catch {throw new HttpError('PUBLISH_CONFLICT_RETRY',409)}
  return json(201,{status:'published',reportDate:envelope.reportDate})
}
async function appApi(request,url,env,context) {
  const route=url.pathname.replace(/^\/api(?:\/v1)?/,'')
  const read=request.method==='GET', write=request.method==='POST'
  if(!read && !write) throw new HttpError('METHOD_NOT_ALLOWED',405)
  if(!(/^\/(bootstrap|vehicles|transfers|attention)$/.test(route) || /^\/(vehicles|transfers|attention)\/[^/]+(?:\/events)?$/.test(route))) throw new HttpError('NOT_FOUND',404)
  if(write && request.headers.get('origin')!==url.origin) throw new AccessError('SAME_ORIGIN_REQUIRED',403)
  const idempotency=request.headers.get('idempotency-key')
  if(write && (!idempotency || idempotency.length>160 || /[\x00-\x1f]/.test(idempotency))) throw new HttpError('IDEMPOTENCY_KEY_REQUIRED')
  const input=write?await readJson(request,64*1024):null
  const release=await readRelease(env)
  let resolvedAssignmentInput=null
  for(let attempt=0;attempt<3;attempt++) {
    const repo=await loadD1Repository(env.INVENTORY_DB,release)
    const service=createInventoryServiceCore({database:repo.database,repository:repo.repository,initialLoadStatus:{status:'loaded'}})
    const query=Object.fromEntries(url.searchParams)
    let result, mutation=false
    if(read && route==='/bootstrap') result=service.bootstrap(context)
    else if(read && route==='/vehicles') result=service.listVehicles(query,context)
    else if(read && /^\/vehicles\/[^/]+$/.test(route)) result=service.getVehicle(decodeURIComponent(route.split('/')[2]),context)
    else if(read && route==='/transfers') result=service.listTransfers(query,context)
    else if(read && /^\/transfers\/[^/]+$/.test(route)) result=service.getTransfer(decodeURIComponent(route.split('/')[2]),context)
    else if(read && route==='/attention') result=service.listAttention(query,context)
    else if(read && /^\/attention\/[^/]+$/.test(route)) result=service.getAttention(decodeURIComponent(route.split('/')[2]),context)
    else if(write && route==='/transfers') {result=service.createTransfer(input,context,idempotency);mutation=true}
    else if(write && /^\/(transfers|attention)\/[^/]+\/events$/.test(route)) {
      const [,type,id]=route.split('/')
      if(type==='attention') result=service.appendAttentionEvent(decodeURIComponent(id),input,context,idempotency)
      else if(!TRANSPORT_ASSIGNMENT_EVENTS.has(String(input?.type??'').trim().toLowerCase()) || resolvedAssignmentInput) {
        result=service.appendTransferEvent(decodeURIComponent(id),resolvedAssignmentInput??input,context,idempotency)
      } else {
        // Authorize the transfer, role, store, lifecycle and payload before
        // querying the employee directory. This prevents unrelated users from
        // probing valid or duplicate staff names through assignment errors.
        const prepared=await prepareTransportAssignment(input,env,(candidate)=>
          service.appendTransferEvent(decodeURIComponent(id),candidate,context,idempotency))
        resolvedAssignmentInput=prepared.input
        result=prepared.replay??service.appendTransferEvent(decodeURIComponent(id),resolvedAssignmentInput,context,idempotency)
      }
      mutation=true
    } else throw new HttpError('NOT_FOUND',404)
    if(!mutation) return json(200,result)
    try {await repo.commit();return json(result.created?201:200,result.record)}
    catch(error) {if(error instanceof RepositoryConflictError && attempt<2) continue; throw error}
  }
  throw new HttpError('REPOSITORY_CONFLICT',409)
}
export default {
  async fetch(request,env) {
    const requestId=crypto.randomUUID()
    try {
      const url=new URL(request.url)
      if(!env.PRIVATE_HOSTNAME || url.hostname!==env.PRIVATE_HOSTNAME) throw new AccessError('PRIVATE_HOST_REQUIRED',403)
      if(url.pathname.startsWith('/internal/')) {
        await publisher(request,env)
        if(request.method==='POST' && url.pathname==='/internal/releases') return await publishRelease(request,env)
        if(request.method==='POST' && url.pathname==='/internal/ledger') return json(200,await importLedger(await decryptEnvelope(await readJson(request,MAX_UPLOAD),env,LEDGER_FORMAT),env))
        if(request.method==='GET' && url.pathname==='/internal/status') {const current=await currentRelease(env);return json(200,{ready:Boolean(current),reportDate:current?.report_date??null,metadata:current?JSON.parse(current.metadata_json):null})}
        if(request.method==='GET' && url.pathname==='/internal/readiness') return json(200,await appReadiness(env))
        throw new HttpError('NOT_FOUND',404)
      }
      const context=await memberContext(await verifyAccess(request,env),env)
      if(request.method==='GET' && url.pathname==='/api/health') return json(200,{ok:true,ready:Boolean(await currentRelease(env)),service:'inventory-flow-cloud'})
      if(url.pathname.startsWith('/api/')) return await appApi(request,url,env,context)
      if(!['GET','HEAD'].includes(request.method)) throw new HttpError('METHOD_NOT_ALLOWED',405)
      if(!env.ASSETS) throw new HttpError('FRONTEND_NOT_DEPLOYED',503)
      const asset=await env.ASSETS.fetch(request)
      return new Response(asset.body,{status:asset.status,headers:{...Object.fromEntries(asset.headers),...headers}})
    } catch(error) {
      const known=error instanceof HttpError || error instanceof AccessError || error instanceof WorkflowError || error instanceof RepositoryConflictError || error instanceof LedgerImportError
      return json(known?(error.status??400):500,{error:known?error.message:'The request could not be completed. Please try again.',code:known?error.code:'INTERNAL_ERROR',requestId})
    }
  },
}
