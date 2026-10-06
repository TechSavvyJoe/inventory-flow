import { WorkflowError } from '../../server/workflow.mjs'
import { platformOwner } from './platform-admin.mjs'
import { schedulePreview, schedulerEnabled } from './platform-scheduler.mjs'

const fail = (message,code='PLATFORM_INPUT_INVALID',status=422) => {throw new WorkflowError(message,{code,status})}
const text = (value,label,max=160) => {
  if(typeof value!=='string' || !value.trim() || value.trim().length>max || /[\u0000-\u001f\u007f]/.test(value)) fail(`Enter a valid ${label}.`)
  return value.trim()
}
const fields = (input,allowed) => {if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))fail('Unsupported source configuration fields.')}
const preview = (row,now) => {try{return schedulePreview(row,now,row.last_slot??'')}catch{return {invalid:true}}}
const publicConnection = (row,now) => ({id:row.id,groupId:row.group_id,dealershipId:row.dealership_id,name:row.name,provider:row.provider,vendor:row.vendor,oem:row.oem,method:row.method,endpoint:row.endpoint,credentialRef:row.credential_ref,enabled:row.enabled===1,cadence:row.cadence,localTime:row.local_time,timezone:row.timezone,updatedAt:row.updated_at,verification:'not_verified',schedule:{...preview(row,now),checkedAt:row.checked_at??null,outcome:row.outcome??null}})
const publicPull = row => ({id:row.id,connectionId:row.connection_id,state:row.state,kind:row.request_kind,scheduledSlot:row.schedule_slot||null,requestedBy:row.requested_name,createdAt:row.created_at,updatedAt:row.updated_at})
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
async function group(db,id) {const row=await db.prepare('SELECT id,status FROM platform_groups WHERE id=?').bind(id).first();if(!row)fail('This dealer group does not exist.','PLATFORM_NOT_FOUND',404);return row}

export async function readDataConnections(env,claims,groupId,now=new Date()) {
  const db=env.PLATFORM_DB
  await platformOwner(db,claims);await group(db,groupId)
  const result=await db.batch([
    db.prepare('SELECT revision FROM platform_revision WHERE id=1'),
    db.prepare('SELECT c.*,s.checked_at,s.last_slot,s.outcome FROM platform_data_connections c LEFT JOIN platform_schedule_checks s ON s.connection_id=c.id WHERE c.group_id=? ORDER BY c.name COLLATE NOCASE,c.id').bind(groupId),
    db.prepare(`SELECT p.* FROM platform_pull_requests p WHERE p.group_id=? AND (p.state='queued' OR p.id IN (SELECT id FROM platform_pull_requests WHERE group_id=? AND state='cancelled' ORDER BY created_at DESC,id DESC LIMIT 50)) ORDER BY p.created_at DESC,p.id DESC`).bind(groupId,groupId),
    db.prepare('SELECT * FROM platform_scheduler_state WHERE id=1'),
  ])
  if(result.some(row=>row.success===false) || !Number.isSafeInteger(result[0].results[0]?.revision))fail('Data connection administration is unavailable.','PLATFORM_UNAVAILABLE',503)
  await platformOwner(db,claims)
  const heartbeat=result[3].results[0]
  return {groupId,revision:result[0].results[0].revision,connections:result[1].results.map(row=>publicConnection(row,now)),requests:result[2].results.map(publicPull),scheduler:{enabled:schedulerEnabled(env),lastTick:heartbeat?.checked_at??null,checked:heartbeat?.checked??0,queued:heartbeat?.queued??0,waiting:heartbeat?.waiting??0,failed:heartbeat?.failed??0},execution:{connected:false,message:'No collector or API executor is connected. Queue planning never contacts a source or publishes inventory.'}}
}

// The registry does not fetch this URL. Execution adapters require separate review.
function endpoint(value,method) {
  if(value==='')return ''
  if(method==='collector')fail('Collector connections use their authorized local profile; leave the feed URL empty.')
  const source=text(value,'public HTTPS feed URL',500)
  let url;try{url=new URL(source)}catch{fail('Enter a public HTTPS feed URL.')}
  const host=url.hostname.toLowerCase()
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.port && url.port!=='443' || !host.includes('.') || /^\[|^\d+\.|(^|\.)(localhost|local|internal)$/.test(host))fail('Use a public HTTPS URL without credentials, query parameters or private network addresses.')
  return url.href
}

export async function saveDataControl(env,claims,groupId,action,input,key) {
  const db=env.PLATFORM_DB,actor=await platformOwner(db,claims)
  const account=await group(db,groupId)
  fields(input,[...(action==='connections'?['id','dealershipId','name','provider','vendor','oem','method','endpoint','credentialRef','enabled','cadence','localTime','timezone']:['connectionId','requestId','operation']),'reason','expectedRevision'])
  const reason=text(input.reason,'reason',500),requestKey=text(key,'request key')
  if(reason.length<3 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<0)fail('Reload and enter a reason before saving.')
  const revision=await db.prepare('SELECT revision FROM platform_revision WHERE id=1').first()
  if(!Number.isSafeInteger(revision?.revision))fail('Data administration is unavailable.','PLATFORM_UNAVAILABLE',503)
  const requestHash=await digest(JSON.stringify({groupId,action,input}))
  const prior=await db.prepare('SELECT request_hash,target_id FROM platform_audit WHERE actor_id=? AND request_key=?').bind(actor.id,requestKey).first()
  if(prior){await platformOwner(db,claims);if(prior.request_hash!==requestHash)fail('Request key conflict.','PLATFORM_REQUEST_CONFLICT',409);return {saved:true,id:prior.target_id,replayed:true}}
  const now=new Date().toISOString()
  let id,previous,next,write,event
  if(action==='connections') {
    id=input.id==null?crypto.randomUUID():text(input.id,'connection ID')
    previous=input.id?await db.prepare('SELECT * FROM platform_data_connections WHERE id=? AND group_id=?').bind(id,groupId).first():null
    if(input.id && !previous)fail('This connection does not belong to this group.','PLATFORM_NOT_FOUND',404)
    const dealer=await db.prepare('SELECT id,group_id FROM platform_dealerships WHERE id=? AND group_id=?').bind(text(input.dealershipId,'dealership'),groupId).first()
    if(!dealer || previous && previous.dealership_id!==dealer.id)fail('A connection must stay with its original dealership.')
    if(!['public_inventory','dealermail','vauto','autocheck','carfax','crm','equipment','oem','dms','other'].includes(input.provider) || !['collector','api','file'].includes(input.method) || !['manual','daily','hourly'].includes(input.cadence) || typeof input.enabled!=='boolean')fail('Choose supported source, connection and schedule settings.')
    const vendor=input.vendor==null?input.provider:text(input.vendor,'provider or vendor name',80)
    const oem=input.oem??'not_applicable'
    if(!['not_applicable','ford_lincoln','gm','stellantis','toyota_lexus','honda_acura','hyundai_kia','volkswagen_audi','bmw','mercedes_benz','other'].includes(oem) || input.provider==='oem' && oem==='not_applicable')fail('Select the OEM for this manufacturer source.')
    const localTime=text(input.localTime,'local start time',5),timezone=text(input.timezone,'IANA timezone',80)
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime))fail('Choose a valid local start time.')
    try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{fail('Choose a valid IANA timezone.')}
    const credentialRef=input.credentialRef===''?'':text(input.credentialRef,'credential reference',80)
    if(credentialRef && !/^CREDENTIAL_[A-Z][A-Z0-9_]{1,67}$/.test(credentialRef))fail('Enter a CREDENTIAL_ reference name, never a secret or token.')
    next={id,groupId,dealershipId:dealer.id,name:text(input.name,'connection name'),provider:input.provider,vendor,oem,method:input.method,endpoint:endpoint(input.endpoint,input.method),credentialRef,enabled:input.enabled,cadence:input.cadence,localTime,timezone}
    if(input.method!=='collector' && !next.endpoint)fail('API and file connections need a feed URL.')
    // A source paused while work is queued cannot later be captured by accident.
    const queued=await db.prepare("SELECT COUNT(*) AS count FROM platform_pull_requests WHERE connection_id=? AND state='queued'").bind(id).first()
    if(queued?.count)fail('Cancel this connection’s queued request before changing its configuration.','PLATFORM_PULL_PENDING',409)
    write=previous?db.prepare('UPDATE platform_data_connections SET name=?,provider=?,vendor=?,oem=?,method=?,endpoint=?,credential_ref=?,enabled=?,cadence=?,local_time=?,timezone=?,updated_at=? WHERE id=? AND group_id=?').bind(next.name,next.provider,vendor,oem,next.method,next.endpoint,credentialRef,Number(input.enabled),next.cadence,localTime,timezone,now,id,groupId):db.prepare('INSERT INTO platform_data_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,groupId,dealer.id,next.name,next.provider,vendor,oem,next.method,next.endpoint,credentialRef,Number(input.enabled),next.cadence,localTime,timezone,now,now)
    event=previous?'updated':'created'
  } else if(action==='pulls') {
    if(!['request','cancel'].includes(input.operation))fail('Choose request or cancel.')
    const connection=await db.prepare('SELECT * FROM platform_data_connections WHERE id=? AND group_id=?').bind(text(input.connectionId,'connection'),groupId).first()
    if(!connection)fail('This source does not belong to this group.','PLATFORM_NOT_FOUND',404)
    if(input.operation==='request') {
      if(input.requestId!=null)fail('A new request must not supply an existing request ID.')
      if(account.status!=='active' || !connection.enabled)fail('Activate the group and enable the source before requesting a pull.','PLATFORM_PULL_DISABLED',409)
      id=crypto.randomUUID();previous=null;next={id,groupId,connectionId:connection.id,name:connection.name,state:'queued',kind:'manual',scheduleSlot:null}
      write=db.prepare("INSERT INTO platform_pull_requests VALUES(?,?,?,'queued','manual',?,?,'',?,?)").bind(id,groupId,connection.id,actor.id,actor.name,now,now);event='requested'
    } else {
      id=text(input.requestId,'request ID')
      previous=await db.prepare("SELECT * FROM platform_pull_requests WHERE id=? AND group_id=? AND connection_id=? AND state='queued'").bind(id,groupId,connection.id).first()
      if(!previous)fail('This queued request no longer exists. Reload.','PLATFORM_NOT_FOUND',404)
      // Compare the same logical fields on both sides of this state change.
      // The connection name is context, never a rename caused by cancellation.
      previous={id,groupId,connectionId:connection.id,name:connection.name,state:previous.state,kind:previous.request_kind,scheduleSlot:previous.schedule_slot||null}
      next={...previous,state:'cancelled'}
      write=db.prepare("UPDATE platform_pull_requests SET state='cancelled',updated_at=? WHERE id=? AND state='queued'").bind(now,id);event='cancelled'
    }
  } else fail('Route not found.','NOT_FOUND',404)
  try {
    await db.batch([
      db.prepare('UPDATE platform_revision SET revision=CASE WHEN revision=? AND EXISTS(SELECT 1 FROM platform_owners WHERE id=? AND enabled=1) THEN revision+1 ELSE NULL END WHERE id=1').bind(input.expectedRevision,actor.id),write,
      db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,actor.name,action,id,event,reason,previous?JSON.stringify(previous):null,JSON.stringify(next),requestKey,requestHash,now),
    ])
  } catch {
    await platformOwner(db,claims)
    const replay=await db.prepare('SELECT request_hash,target_id FROM platform_audit WHERE actor_id=? AND request_key=?').bind(actor.id,requestKey).first()
    if(replay?.request_hash===requestHash)return {saved:true,id:replay.target_id,replayed:true}
    fail('The configuration changed or this source already has a queued request. Reload before saving.','PLATFORM_CONFLICT',409)
  }
  return {saved:true,id,replayed:false}
}

const AUDIT_FIELDS={groups:['name','status'],dealerships:['name','groupId','storeKey','website','enabled'],owners:['name','email','enabled'],connections:['name','groupId','dealershipId','provider','vendor','oem','method','endpoint','credentialRef','enabled','cadence','localTime','timezone'],pulls:['name','groupId','connectionId','state','kind','scheduleSlot']}
const aliases={groupId:'group_id',storeKey:'store_key',dealershipId:'dealership_id',connectionId:'connection_id',credentialRef:'credential_ref',localTime:'local_time',kind:'request_kind',scheduleSlot:'schedule_slot'}
export async function readPlatformAudit(env,claims,id) {
  const db=env.PLATFORM_DB
  await platformOwner(db,claims)
  const row=await db.prepare('SELECT * FROM platform_audit WHERE id=?').bind(id).first()
  if(!row)fail('This audit entry does not exist.','PLATFORM_NOT_FOUND',404)
  const before=row.previous_json?JSON.parse(row.previous_json):{},after=JSON.parse(row.next_json)
  const changes=(AUDIT_FIELDS[row.entity]??[]).flatMap(field=>{
    // Older cancellation entries stored the raw pull row without a name.
    // Preserve those append-only entries while interpreting their state change.
    if(row.entity==='pulls' && row.action==='cancelled' && field==='name')return []
    const value=record=>{const raw=record[field]??record[aliases[field]];return field==='enabled' && raw!=null?Boolean(raw):field==='scheduleSlot'?raw||null:raw??null}
    const previous=value(before),next=value(after)
    return previous===next?[]:[{field,before:previous,after:next}]
  })
  await platformOwner(db,claims)
  return {id:row.id,actor:row.actor_name,entity:row.entity,action:row.action,targetId:row.target_id,reason:row.reason,occurredAt:row.created_at,changes}
}
