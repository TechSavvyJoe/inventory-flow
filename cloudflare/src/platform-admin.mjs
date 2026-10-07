import { AccessError } from './access.mjs'
import { WorkflowError } from '../../server/workflow.mjs'
import { assertTenantIdentity } from './tenant-gate.mjs'
import { dealershipAppUrl } from './account-navigation.mjs'

const ROLES = ['sales','manager','group_manager','coordinator','porter','driver']
const fail = (message, code = 'PLATFORM_INPUT_INVALID', status = 422) => { throw new WorkflowError(message, {code,status}) }
const fields = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('This change contains unsupported fields.')
}
function text(value, label, max = 160, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(`Enter a valid ${label}.`)
  return value.trim()
}
function email(value) {
  const result = text(value, 'email', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('Enter a valid sign-in email.')
  return result
}
const boolean = value => { if (typeof value !== 'boolean') fail('Choose enabled or disabled.'); return value ? 1 : 0 }
const revision = value => { if (!Number.isSafeInteger(value) || value < 0) fail('Reload before saving.', 'PLATFORM_REVISION_REQUIRED'); return value }
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('')
const publicOwner = row => ({id:row.id,email:row.email,name:row.name,enabled:row.enabled === 1})
const publicDealer = row => ({id:row.id,groupId:row.group_id,name:row.name,storeKey:row.store_key,website:row.website,enabled:row.enabled === 1})

export async function platformOwner(db, claims) {
  if (!db) throw new AccessError('PLATFORM_NOT_CONFIGURED', 503)
  if (typeof claims?.email !== 'string' || !claims.email || claims.common_name) throw new AccessError('SOFTWARE_OWNER_REQUIRED', 403)
  const row = await db.prepare('SELECT id,email,name,enabled FROM platform_owners WHERE email=? COLLATE NOCASE AND enabled=1').bind(claims.email.toLowerCase()).first()
  if (!row) throw new AccessError('SOFTWARE_OWNER_REQUIRED', 403)
  return row
}

// Server-managed D1 bindings only: no URLs, API tokens or DB IDs from a form.
export function tenantBindings(env) {
  let mapping
  try { mapping = JSON.parse(env.PLATFORM_TENANT_BINDINGS || '{}') } catch { throw new AccessError('TENANT_CONFIGURATION_REQUIRED', 503) }
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new AccessError('TENANT_CONFIGURATION_REQUIRED', 503)
  const names = Object.values(mapping)
  if (names.some(name => typeof name !== 'string' || !/^TENANT_[A-Z0-9_]+_DB$/.test(name)) || new Set(names).size !== names.length) throw new AccessError('TENANT_CONFIGURATION_REQUIRED', 503)
  return mapping
}
export async function tenantDatabase(env, groupId) {
  const name = tenantBindings(env)[groupId]
  if (!name || !env[name]?.prepare) fail('This group has no verified isolated database connection.', 'TENANT_NOT_CONNECTED', 409)
  await assertTenantIdentity(env[name], groupId)
  return env[name]
}
async function health(env, groupId, now) {
  const binding = tenantBindings(env)[groupId]
  if (!binding) return {status:'not_connected',message:'Connect an isolated tenant deployment before activation.'}
  try {
    const db = await tenantDatabase(env, groupId)
    const results = await db.batch([
      db.prepare("SELECT report_date,published_at,status FROM cloud_release_versions WHERE release_id=(SELECT value FROM cloud_release_state WHERE key='current_release_id')"),
      db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS active FROM cloud_memberships'),
      db.prepare("SELECT COUNT(*) AS count FROM cloud_memberships WHERE enabled=1 AND role='group_manager'"),
    ])
    if (results.some(result => result.success === false)) throw new Error()
    const release = results[0].results[0]
    const age = release?.published_at ? (now.getTime() - Date.parse(release.published_at)) / 3600000 : NaN
    const status = !release ? 'no_release' : !Number.isFinite(age) || age < -0.1 || age > 26 ? 'stale' : release.status !== 'current' ? 'needs_review' : 'current'
    return {status, connected:true, reportDate:release?.report_date ?? null,publishedAt:release?.published_at ?? null,releaseStatus:release?.status ?? null,employees:results[1].results[0].total,activeEmployees:results[1].results[0].active ?? 0,groupManagers:results[2].results[0].count,message:status === 'current' ? 'Current stored publication. Collector sessions and external providers are not probed.' : 'Review publication status in this group’s deployment.'}
  } catch { return {status:'unavailable',message:'Database connection or tenant identity could not be verified.'} }
}

export async function readPlatform(env, claims, now = new Date()) {
  const db = env.PLATFORM_DB
  const owner = await platformOwner(db, claims)
  const result = await db.batch([
    db.prepare('SELECT revision FROM platform_revision WHERE id=1'),
    db.prepare('SELECT * FROM platform_groups ORDER BY name COLLATE NOCASE,id'),
    db.prepare('SELECT * FROM platform_dealerships ORDER BY name COLLATE NOCASE,id'),
    db.prepare('SELECT * FROM platform_owners ORDER BY name COLLATE NOCASE,id'),
    db.prepare('SELECT id,actor_name,entity,target_id,action,reason,created_at FROM platform_audit ORDER BY created_at DESC,id DESC LIMIT 50'),
  ])
  if (result.some(row => row.success === false) || !Number.isSafeInteger(result[0].results[0]?.revision)) fail('Software administration is unavailable.', 'PLATFORM_UNAVAILABLE', 503)
  const groups = []
  // Bound D1 concurrency; one unavailable group never masks the others.
  const rows = result[1].results
  for (let offset=0;offset<rows.length;offset+=4) groups.push(...await Promise.all(rows.slice(offset,offset+4).map(async row=>({id:row.id,name:row.name,status:row.status,updatedAt:row.updated_at,dealerships:result[2].results.filter(dealer => dealer.group_id === row.id).map(publicDealer),health:await health(env,row.id,now)}))))
  for (const group of groups) group.appUrl=group.status==='active' && group.health.connected===true ? dealershipAppUrl(env,group.id) : null
  await platformOwner(db, claims)
  return {demo:env.PLATFORM_DEMO===true,owner:publicOwner(owner),revision:result[0].results[0].revision,generatedAt:now.toISOString(),groups,owners:result[3].results.map(publicOwner),audit:result[4].results.map(row => ({id:row.id,actor:row.actor_name,entity:row.entity,targetId:row.target_id,action:row.action,reason:row.reason,occurredAt:row.created_at}))}
}

export async function savePlatform(env, claims, entity, input, key) {
  const db = env.PLATFORM_DB
  const actor = await platformOwner(db, claims)
  const currentRevision = await db.prepare('SELECT revision FROM platform_revision WHERE id=1').first()
  if (!Number.isSafeInteger(currentRevision?.revision)) fail('Software administration is unavailable.','PLATFORM_UNAVAILABLE',503)
  const allowed = {groups:['id','name','status'],dealerships:['id','groupId','name','storeKey','website','enabled'],owners:['id','email','name','enabled']}[entity]
  if (!allowed) fail('Route not found.', 'NOT_FOUND', 404)
  fields(input,[...allowed,'reason','expectedRevision'])
  const reason = text(input.reason,'reason for this change',500,3)
  const expectedRevision = revision(input.expectedRevision)
  const requestKey = text(key,'request key')
  const requestHash = await hash(JSON.stringify({entity,input}))
  const previousRequest = await db.prepare('SELECT request_hash,target_id FROM platform_audit WHERE actor_id=? AND request_key=?').bind(actor.id,requestKey).first()
  if (previousRequest) {
    await platformOwner(db,claims)
    if (previousRequest.request_hash !== requestHash) fail('This request key belongs to another change.','PLATFORM_REQUEST_CONFLICT',409)
    return {saved:true,id:previousRequest.target_id,replayed:true}
  }
  const id = input.id == null ? crypto.randomUUID() : text(input.id,'record ID')
  const table = {groups:'platform_groups',dealerships:'platform_dealerships',owners:'platform_owners'}[entity]
  const previous = input.id ? await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first() : null
  if (input.id && !previous) fail('This record no longer exists. Reload.','PLATFORM_NOT_FOUND',404)
  let next, write
  const timestamp = new Date().toISOString()
  if (entity === 'groups') {
    const name = text(input.name,'group name')
    const status = input.status
    if (!['setup','active','suspended'].includes(status) || (!previous && status !== 'setup')) fail('Create groups in setup before activating them.')
    if (status === 'active') {
      const connection = await health(env,id,new Date())
      const dealers = await db.prepare('SELECT COUNT(*) AS count FROM platform_dealerships WHERE group_id=? AND enabled=1').bind(id).first()
      if (!connection.connected || !connection.groupManagers || !dealers?.count) fail('Connect the isolated database, add a dealership and an active group manager before activation.','TENANT_NOT_READY',409)
    }
    next = {id,name,status}
    write = previous ? db.prepare('UPDATE platform_groups SET name=?,status=?,updated_at=? WHERE id=?').bind(name,status,timestamp,id) : db.prepare('INSERT INTO platform_groups VALUES(?,?,?,?,?)').bind(id,name,status,timestamp,timestamp)
  } else if (entity === 'dealerships') {
    const groupId = text(input.groupId,'group ID')
    const group = await db.prepare('SELECT id FROM platform_groups WHERE id=?').bind(groupId).first()
    if (!group || previous && previous.group_id !== groupId) fail('A dealership stays in its original group.')
    const name = text(input.name,'dealership name'), storeKey = text(input.storeKey,'store key'), enabled = boolean(input.enabled)
    if (previous && previous.store_key !== storeKey) fail('Store keys are immutable. Add a new dealership record instead.')
    const website = input.website === '' ? '' : text(input.website,'public website',500)
    if (website) { let url; try { url = new URL(website) } catch { fail('Enter an HTTPS public website.') } if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('Enter an HTTPS public website without credentials or query parameters.') }
    next = {id,groupId,name,storeKey,website,enabled:Boolean(enabled)}
    write = previous ? db.prepare('UPDATE platform_dealerships SET name=?,website=?,enabled=? WHERE id=?').bind(name,website,enabled,id) : db.prepare('INSERT INTO platform_dealerships VALUES(?,?,?,?,?,?)').bind(id,groupId,name,storeKey,website,enabled)
  } else {
    const signInEmail = email(input.email), name = text(input.name,'owner name'), enabled = boolean(input.enabled)
    if (previous && previous.email.toLowerCase() !== signInEmail) fail('Sign-in email is immutable.')
    if (id === actor.id && !enabled) fail('Another software owner must disable your account.','PLATFORM_SELF_DISABLE')
    next = {id,email:signInEmail,name,enabled:Boolean(enabled)}
    write = previous ? db.prepare('UPDATE platform_owners SET name=?,enabled=? WHERE id=?').bind(name,enabled,id) : db.prepare('INSERT INTO platform_owners VALUES(?,?,?,?)').bind(id,signInEmail,name,enabled)
  }
  try {
    await db.batch([
      db.prepare('UPDATE platform_revision SET revision=CASE WHEN revision=? AND EXISTS(SELECT 1 FROM platform_owners WHERE id=? AND enabled=1) THEN revision+1 ELSE NULL END WHERE id=1').bind(expectedRevision,actor.id),
      write,
      db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,actor.name,entity,id,previous?'updated':'created',reason,previous?JSON.stringify(previous):null,JSON.stringify(next),requestKey,requestHash,timestamp),
    ])
  } catch {
    await platformOwner(db,claims)
    const replay = await db.prepare('SELECT request_hash,target_id FROM platform_audit WHERE actor_id=? AND request_key=?').bind(actor.id,requestKey).first()
    if (replay?.request_hash === requestHash) return {saved:true,id:replay.target_id,replayed:true}
    fail('The directory changed or this record conflicts with an existing one. Reload and review your change.','PLATFORM_CONFLICT',409)
  }
  return {saved:true,id,replayed:false}
}

export async function readTenantMembers(env, claims, groupId) {
  await platformOwner(env.PLATFORM_DB,claims)
  const db = await tenantDatabase(env,groupId)
  const result = await db.batch([
    db.prepare('SELECT COUNT(*) AS revision FROM cloud_membership_events'),
    db.prepare('SELECT email,user_id,name,role,home_store,enabled FROM cloud_memberships ORDER BY name COLLATE NOCASE,user_id'),
    db.prepare('SELECT id,actor_name,action,reason,next_json,created_at FROM cloud_membership_events ORDER BY created_at DESC,id DESC LIMIT 30'),
  ])
  if (result.some(row => row.success === false) || !Number.isSafeInteger(result[0].results[0]?.revision)) fail('Employee administration is unavailable.', 'PLATFORM_UNAVAILABLE', 503)
  await platformOwner(env.PLATFORM_DB,claims)
  return {groupId,revision:result[0].results[0].revision,members:result[1].results.map(row=>({id:row.user_id,email:row.email,name:row.name,role:row.role,homeStore:row.home_store,enabled:row.enabled===1})),audit:result[2].results.map(row=>({id:row.id,actor:row.actor_name,action:row.action,reason:row.reason,targetName:JSON.parse(row.next_json).name,occurredAt:row.created_at}))}
}

export async function saveTenantMember(env, claims, groupId, input, key) {
  const actor = await platformOwner(env.PLATFORM_DB,claims)
  const db = await tenantDatabase(env,groupId)
  fields(input,['id','email','name','role','homeStore','enabled','reason','expectedRevision'])
  const expectedRevision = revision(input.expectedRevision), requestKey = text(key,'request key')
  const name = text(input.name,'employee name'), signInEmail = email(input.email), enabled = boolean(input.enabled), reason = text(input.reason,'reason for this change',500,3)
  if (!ROLES.includes(input.role)) fail('Choose a supported employee role.')
  const storeKey = text(input.homeStore,'home dealership')
  const requestHash = await hash(JSON.stringify({groupId,input}))
  const previousRequest = await db.prepare('SELECT request_hash,target_user_id FROM cloud_membership_events WHERE actor_user_id=? AND request_key=?').bind(`platform:${actor.id}`,requestKey).first()
  if (previousRequest) { await platformOwner(env.PLATFORM_DB,claims); if (previousRequest.request_hash !== requestHash) fail('Request key conflict.','PLATFORM_REQUEST_CONFLICT',409); return {saved:true,id:previousRequest.target_user_id,replayed:true} }
  const previous = input.id ? await db.prepare('SELECT * FROM cloud_memberships WHERE user_id=?').bind(text(input.id,'employee ID')).first() : null
  if (input.id && !previous) fail('This employee does not belong to this group.','PLATFORM_NOT_FOUND',404)
  if (previous && previous.email.toLowerCase() !== signInEmail) fail('Sign-in email is immutable.')
  const store = await env.PLATFORM_DB.prepare('SELECT store_key,enabled FROM platform_dealerships WHERE group_id=? AND store_key=?').bind(groupId,storeKey).first()
  if (!store || !store.enabled && previous?.home_store !== storeKey) fail('Choose an enabled dealership in this group.')
  const appRevision = await db.prepare('SELECT revision FROM cloud_app_revision WHERE id=1').first()
  if (!Number.isSafeInteger(appRevision?.revision)) fail('Employee administration is unavailable.', 'PLATFORM_UNAVAILABLE', 503)
  const id = previous?.user_id ?? crypto.randomUUID()
  const next = {id,email:signInEmail,name,role:input.role,homeStore:store.store_key,enabled:Boolean(enabled)}
  const timestamp = new Date().toISOString()
  await platformOwner(env.PLATFORM_DB,claims)
  try {
    await db.batch([
      db.prepare('UPDATE cloud_app_revision SET revision=CASE WHEN (SELECT COUNT(*) FROM cloud_membership_events)=? THEN revision+1 ELSE NULL END WHERE id=1').bind(expectedRevision),
      previous ? db.prepare('UPDATE cloud_memberships SET name=?,role=?,home_store=?,enabled=?,updated_at=? WHERE user_id=?').bind(name,input.role,store.store_key,enabled,timestamp,id) : db.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(signInEmail,id,name,input.role,store.store_key,enabled,timestamp,timestamp),
      db.prepare('INSERT INTO cloud_membership_events(id,actor_user_id,actor_name,target_user_id,action,reason,previous_json,next_json,request_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),`platform:${actor.id}`,actor.name,id,previous?'updated':'created',reason,previous?JSON.stringify(previous):null,JSON.stringify(next),requestKey,requestHash,timestamp),
    ])
  } catch {
    await platformOwner(env.PLATFORM_DB,claims)
    const replay = await db.prepare('SELECT request_hash,target_user_id FROM cloud_membership_events WHERE actor_user_id=? AND request_key=?').bind(`platform:${actor.id}`,requestKey).first()
    if (replay?.request_hash === requestHash) return {saved:true,id:replay.target_user_id,replayed:true}
    fail('The employee directory changed, the email already exists, or the final group manager cannot be disabled. Reload and review.','PLATFORM_CONFLICT',409)
  }
  return {saved:true,id,replayed:false}
}
