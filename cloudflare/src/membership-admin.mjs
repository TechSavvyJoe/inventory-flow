import { assertAdminOverviewAccess } from '../../server/admin-control-center.mjs'
import { STORE_NAMES } from '../../server/constants.mjs'
import { WorkflowError } from '../../server/workflow.mjs'

const ROLES = ['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver']
const FIELDS = 'email, user_id, name, role, home_store, enabled'
function fail(message, code, status = 422) { throw new WorkflowError(message, { code, status }) }
function text(value, field, max = 160, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(`Enter a valid ${field}.`, 'ADMIN_INPUT_INVALID')
  return value.trim()
}
function publicMember(row) {
  return { id: row.user_id, email: row.email, name: row.name, role: row.role, homeStore: row.home_store, enabled: row.enabled === 1 }
}
function actorId(context) {
  assertAdminOverviewAccess(context)
  return text(context?.userId, 'authenticated employee ID')
}
function memberInput(input) {
  const allowed = new Set(['id', 'email', 'name', 'role', 'homeStore', 'enabled', 'reason', 'expectedRevision'])
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key))) fail('This access change contains unsupported fields.', 'ADMIN_INPUT_INVALID')
  const name = text(input.name, 'name')
  if (!ROLES.includes(input.role) || !STORE_NAMES.includes(input.homeStore) || typeof input.enabled !== 'boolean') fail('Choose a role, home store, and access status.', 'ADMIN_INPUT_INVALID')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('Reload the directory before saving.', 'ADMIN_REVISION_REQUIRED')
  const email = text(input.email, 'work email', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid work email.', 'ADMIN_INPUT_INVALID')
  return { id: input.id == null ? null : text(input.id, 'employee ID'), email, name, role: input.role, homeStore: input.homeStore, enabled: input.enabled, reason: text(input.reason, 'reason for this change', 500, 3), expectedRevision: input.expectedRevision }
}
async function authorizedActor(db, userId) {
  const row = await db.prepare('SELECT user_id, name FROM cloud_memberships WHERE user_id=? AND enabled=1 AND role=\'group_manager\'').bind(userId).first()
  if (!row) fail('Your account no longer has group-manager access. Reload the page.', 'ADMIN_ACCESS_CHANGED', 403)
  return row
}
export async function readMembershipAdmin(db, context) {
  const userId = actorId(context)
  await authorizedActor(db, userId)
  const results = await db.batch([
    db.prepare('SELECT revision FROM cloud_app_revision WHERE id=1'),
    db.prepare(`SELECT ${FIELDS} FROM cloud_memberships ORDER BY name COLLATE NOCASE, user_id`),
    db.prepare('SELECT id,actor_name,target_user_id,action,reason,next_json,created_at FROM cloud_membership_events ORDER BY created_at DESC,id DESC LIMIT 30'),
  ])
  const revision = results[0]?.results?.[0]?.revision
  if (!Number.isSafeInteger(revision) || results.some(result => result.success === false)) fail('Employee access settings are unavailable.', 'ADMIN_DIRECTORY_UNAVAILABLE', 503)
  return {
    revision, currentUserId: userId, members: results[1].results.map(publicMember),
    audit: results[2].results.map(row => ({ id: row.id, actor: row.actor_name, targetName: JSON.parse(row.next_json).name, action: row.action, reason: row.reason, occurredAt: row.created_at })),
  }
}
export async function saveMembership(db, input, context, requestKey) {
  const userId = actorId(context)
  const actor = await authorizedActor(db, userId)
  const change = memberInput(input)
  const revisionRow = await db.prepare('SELECT revision FROM cloud_app_revision WHERE id=1').first()
  if (!Number.isSafeInteger(revisionRow?.revision)) fail('Employee access settings are unavailable.', 'ADMIN_DIRECTORY_UNAVAILABLE', 503)
  const key = text(requestKey, 'request key')
  const fingerprint = JSON.stringify(change)
  const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))), b => b.toString(16).padStart(2, '0')).join('')
  const previousRequest = await db.prepare('SELECT request_hash,target_user_id FROM cloud_membership_events WHERE actor_user_id=? AND request_key=?').bind(userId, key).first()
  if (previousRequest) {
    if (previousRequest.request_hash !== requestHash) fail('This request was already used for a different change.', 'ADMIN_REQUEST_CONFLICT', 409)
    await authorizedActor(db, userId)
    return { saved: true, id: previousRequest.target_user_id, replayed: true }
  }
  const previous = change.id ? await db.prepare(`SELECT ${FIELDS} FROM cloud_memberships WHERE user_id=?`).bind(change.id).first() : null
  if (change.id && !previous) fail('This employee could not be found. Reload the directory.', 'ADMIN_MEMBER_NOT_FOUND', 404)
  if (previous && previous.email.toLowerCase() !== change.email) fail('Sign-in email cannot be reassigned. Disable the old account and add a new employee.', 'ADMIN_EMAIL_IMMUTABLE')
  if (change.id === userId && (!change.enabled || change.role !== 'group_manager')) fail('Another group manager must change your own access.', 'ADMIN_SELF_ACCESS_CHANGE')
  const duplicate = await db.prepare('SELECT user_id FROM cloud_memberships WHERE email=? COLLATE NOCASE').bind(change.email).first()
  if (duplicate && duplicate.user_id !== change.id) fail('That email already belongs to an employee. Edit the existing account.', 'ADMIN_EMAIL_EXISTS', 409)
  const id = previous?.user_id ?? crypto.randomUUID()
  const next = { id, email: change.email, name: change.name, role: change.role, homeStore: change.homeStore, enabled: change.enabled }
  const timestamp = new Date().toISOString()
  try {
    await db.batch([
      // A stale snapshot or revoked actor aborts the entire transaction through
      // the existing NOT NULL revision constraint. No partial member/audit write.
      db.prepare(`UPDATE cloud_app_revision SET revision=CASE WHEN revision=? AND EXISTS(SELECT 1 FROM cloud_memberships WHERE user_id=? AND enabled=1 AND role='group_manager') THEN revision+1 ELSE NULL END WHERE id=1`).bind(change.expectedRevision, userId),
      previous
        ? db.prepare('UPDATE cloud_memberships SET name=?,role=?,home_store=?,enabled=?,updated_at=? WHERE user_id=?').bind(change.name, change.role, change.homeStore, change.enabled ? 1 : 0, timestamp, id)
        : db.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(change.email, id, change.name, change.role, change.homeStore, change.enabled ? 1 : 0, timestamp, timestamp),
      db.prepare('INSERT INTO cloud_membership_events(id,actor_user_id,actor_name,target_user_id,action,reason,previous_json,next_json,request_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), userId, actor.name, id, previous ? 'updated' : 'created', change.reason, previous ? JSON.stringify(publicMember(previous)) : null, JSON.stringify(next), key, requestHash, timestamp),
    ])
  } catch (error) {
    if (String(error?.message).includes('Keep at least one active group manager')) fail('Keep at least one active group manager.', 'ADMIN_LAST_MANAGER', 409)
    // A competing retry may have committed while this request was reading.
    const replay = await db.prepare('SELECT request_hash,target_user_id FROM cloud_membership_events WHERE actor_user_id=? AND request_key=?').bind(userId, key).first()
    if (replay?.request_hash === requestHash) {
      await authorizedActor(db, userId)
      return { saved: true, id: replay.target_user_id, replayed: true }
    }
    fail('The directory changed while you were editing. Reload it and review your change again.', 'ADMIN_CONFLICT', 409)
  }
  return { saved: true, id, replayed: false }
}
