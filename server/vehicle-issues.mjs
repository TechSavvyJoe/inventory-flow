import { createHash, randomUUID } from 'node:crypto'
import { WorkflowError } from './workflow.mjs'

export const VEHICLE_ISSUE_CATEGORIES = Object.freeze(['cleaning', 'fuel', 'mechanical', 'damage', 'other'])
export const VEHICLE_ISSUE_STATUSES = Object.freeze(['open', 'in_progress', 'awaiting_review', 'completed'])
export const VEHICLE_ISSUE_COLUMNS = Object.freeze([
  'id', 'vin', 'stock_number', 'vehicle_name', 'home_store_id', 'report_store_id',
  'category', 'priority', 'description', 'reporter', 'reporter_user_id', 'reporter_role',
  'created_at', 'input_hash', 'idempotency_key',
])
export const VEHICLE_ISSUE_EVENT_COLUMNS = Object.freeze([
  'id', 'issue_id', 'version', 'event_type', 'status', 'assignee', 'note', 'actor',
  'actor_user_id', 'actor_role', 'store_id', 'created_at', 'completed_at', 'completed_by',
  'photos_json', 'input_hash', 'idempotency_key',
])

const WRITE_ROLES = new Set(['sales', 'manager', 'group_manager'])
const MANAGER_ROLES = new Set(['manager', 'group_manager'])
const ACTIONS = new Set(['assign', 'start_work', 'request_completion', 'complete', 'reopen', 'add_note'])
const MAX_PHOTO_BYTES = 500 * 1024

function fail(message, code = 'INVALID_VEHICLE_ISSUE', status = 422) {
  throw new WorkflowError(message, { code, status })
}

function text(value, label, { required = false, max = 1000 } = {}) {
  if (value == null || value === '') {
    if (required) fail(`${label} is required.`)
    return null
  }
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    fail(`${label} must be text, up to ${max} characters.`)
  }
  const result = value.trim()
  if (!result && required) fail(`${label} is required.`)
  return result || null
}

function inputObject(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Object.keys(input).some((key) => !fields.includes(key))) fail('Unsupported vehicle issue field.')
}

function actorIdentity(context) {
  // Hosted identities always have a stable membership ID. The deterministic
  // demo fallback is namespaced and cannot be supplied through hosted headers.
  if (context.userId) return context.userId
  if (context.allowLegacyTransportAssignmentByName === true) {
    return `demo:${context.authenticatedStore || context.store}:${context.user}`
  }
  fail('An authenticated employee identity is required.', 'AUTH_CONTEXT_INVALID', 401)
}

function requestKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) {
    fail('A valid idempotency key is required.', 'IDEMPOTENCY_KEY_REQUIRED')
  }
  return value.trim()
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizedPhotos(value) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 3) fail('Attach no more than three photos per update.', 'INVALID_ISSUE_PHOTOS')
  const photos = value.map((photo) => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo) ||
        Object.keys(photo).some((key) => !['id', 'contentType', 'bytes'].includes(key)) ||
        !/^[a-f0-9]{64}$/.test(photo.id ?? '') || photo.contentType !== 'image/jpeg' ||
        !Number.isSafeInteger(photo.bytes) || photo.bytes <= 0 || photo.bytes > MAX_PHOTO_BYTES) {
      fail('A verified JPEG photo is required.', 'INVALID_ISSUE_PHOTOS')
    }
    return { id: photo.id, contentType: 'image/jpeg', bytes: photo.bytes }
  })
  if (new Set(photos.map((photo) => photo.id)).size !== photos.length) fail('The same photo was attached twice.', 'INVALID_ISSUE_PHOTOS')
  return photos.sort((left, right) => left.id.localeCompare(right.id))
}

function eventPhotos(row) {
  return row.photos_json ? JSON.parse(row.photos_json) : []
}

function scopeAllowsWrite(issue, context) {
  return WRITE_ROLES.has(context.role) && (context.role === 'group_manager' || issue.report_store_id === context.store)
}

export function canReportVehicleIssue(vehicle, context) {
  return WRITE_ROLES.has(context.role) && (context.role === 'group_manager' ||
    vehicle.homeStore === context.store ||
    (vehicle.movement?.locationConfidence === 'verified' && vehicle.movement.currentLocation === context.store))
}

export function allowedVehicleIssueActions(issue, current, context) {
  if (!scopeAllowsWrite(issue, context)) return []
  const actions = ['add_note']
  const manager = MANAGER_ROLES.has(context.role)
  if (current.status === 'completed') return manager ? [...actions, 'reopen'] : actions
  if (manager) actions.push('assign', 'complete')
  if (current.status !== 'in_progress') actions.push('start_work')
  if (current.status !== 'awaiting_review') actions.push('request_completion')
  return actions
}

export function vehicleIssueView(issue, rows, context, { detail = false } = {}) {
  const current = rows.at(-1)
  if (!current) fail('Vehicle issue history is unavailable.', 'ISSUE_HISTORY_UNAVAILABLE', 503)
  const photos = rows.flatMap((row) => eventPhotos(row).map((photo) => ({ ...photo, eventId: row.id, createdAt: row.created_at })))
  const record = {
    id: issue.id, vin: issue.vin, stockNumber: issue.stock_number, vehicleName: issue.vehicle_name,
    homeStore: issue.home_store_id, reportStore: issue.report_store_id,
    category: issue.category, priority: issue.priority, description: issue.description,
    status: current.status, version: current.version, assignee: current.assignee,
    reportedBy: issue.reporter, reportedByUserId: issue.reporter_user_id, reportedAt: issue.created_at,
    updatedAt: current.created_at, completedAt: current.completed_at, completedBy: current.completed_by,
    photoCount: photos.length, allowedActions: allowedVehicleIssueActions(issue, current, context),
  }
  if (detail) {
    record.photos = photos
    record.events = rows.map((row) => ({
      id: row.id, type: row.event_type, version: row.version, note: row.note,
      assignee: row.assignee, status: row.status, actor: row.actor, actorUserId: row.actor_user_id,
      actorRole: row.actor_role, store: row.store_id, createdAt: row.created_at, photos: eventPhotos(row),
    }))
  }
  return record
}

function assertReplay(row, inputHash) {
  if (row.input_hash !== inputHash) fail('This request key was already used for a different issue update.', 'IDEMPOTENCY_CONFLICT', 409)
}

export function buildVehicleIssue({ vin, vehicle, issues, input, context, idempotencyKey, now }) {
  if (!WRITE_ROLES.has(context.role)) fail('Sales staff or a manager must report this issue.', 'ISSUE_REPORTER_REQUIRED', 403)
  inputObject(input, ['category', 'priority', 'description', 'photos'])
  if (!VEHICLE_ISSUE_CATEGORIES.includes(input.category)) fail('Choose a valid issue category.')
  const priority = input.priority ?? 'normal'
  if (!['normal', 'urgent'].includes(priority)) fail('Choose normal or urgent priority.')
  const description = text(input.description, 'Issue description', { required: true })
  const photos = normalizedPhotos(input.photos)
  const key = requestKey(idempotencyKey)
  const actorId = actorIdentity(context)
  const inputHash = digest({ vin, category: input.category, priority, description, photos, actorId, store: context.store })
  const replay = issues.find((issue) => issue.reporter_user_id === actorId && issue.idempotency_key === key)
  if (replay) {
    if (!scopeAllowsWrite(replay, context)) fail('This issue belongs to another store.', 'ISSUE_STORE_FORBIDDEN', 403)
    assertReplay(replay, inputHash)
    return { created: false, issue: replay }
  }
  if (!vehicle) fail('Vehicle was not found.', 'VEHICLE_NOT_FOUND', 404)
  if (!canReportVehicleIssue(vehicle, context)) fail('Report issues for a vehicle at your store or assigned to your store.', 'ISSUE_STORE_FORBIDDEN', 403)
  const createdAt = now.toISOString()
  const issue = {
    id: randomUUID(), vin: vehicle.vin, stock_number: vehicle.stockNumber, vehicle_name: vehicle.vehicleName,
    home_store_id: vehicle.homeStore, report_store_id: context.store, category: input.category,
    priority, description, reporter: context.user, reporter_user_id: actorId,
    reporter_role: context.authenticatedRole || context.role, created_at: createdAt,
    input_hash: inputHash, idempotency_key: key,
  }
  const event = {
    id: randomUUID(), issue_id: issue.id, version: 1, event_type: 'reported', status: 'open', assignee: null,
    note: null, actor: context.user, actor_user_id: actorId, actor_role: context.authenticatedRole || context.role,
    store_id: context.store, created_at: createdAt, completed_at: null, completed_by: null,
    photos_json: JSON.stringify(photos), input_hash: inputHash, idempotency_key: key,
  }
  return { created: true, issue, event }
}

export function buildVehicleIssueEvent({ issue, rows, input, context, idempotencyKey, now }) {
  if (!scopeAllowsWrite(issue, context)) fail('Only sales staff and managers at the reporting store can update this issue.', 'ISSUE_STORE_FORBIDDEN', 403)
  inputObject(input, ['type', 'expectedVersion', 'assignee', 'note', 'photos'])
  if (!ACTIONS.has(input.type)) fail('Choose a valid issue action.')
  if (['assign', 'complete', 'reopen'].includes(input.type) && !MANAGER_ROLES.has(context.role)) {
    fail('Only a manager can assign, complete, or reopen an issue.', 'ISSUE_MANAGER_REQUIRED', 403)
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('Reload the issue before saving.', 'ISSUE_VERSION_REQUIRED')
  const key = requestKey(idempotencyKey)
  const actorId = actorIdentity(context)
  const note = text(input.note, 'Update note', { required: input.type === 'complete' })
  const assignee = input.type === 'assign' ? text(input.assignee, 'Person or team', { required: true, max: 160 }) : null
  if (input.type !== 'assign' && input.assignee != null) fail('A person or team applies only to an assignment.')
  const photos = normalizedPhotos(input.photos)
  if (input.type === 'add_note' && !note && !photos.length) fail('Add a note or photo to this update.')
  const inputHash = digest({ type: input.type, expectedVersion: input.expectedVersion, assignee, note, photos, actorId, store: context.store })
  const replay = rows.find((row) => row.actor_user_id === actorId && row.idempotency_key === key)
  if (replay) {
    assertReplay(replay, inputHash)
    return { created: false, event: replay }
  }
  const current = rows.at(-1)
  if (input.expectedVersion !== current.version) fail('Another employee updated this issue. Review the latest details and save again.', 'ISSUE_VERSION_CONFLICT', 409)
  if (!allowedVehicleIssueActions(issue, current, context).includes(input.type)) fail('This action does not apply to the current issue status.', 'ISSUE_ACTION_CONFLICT', 409)
  const previousPhotos = rows.flatMap(eventPhotos)
  if (previousPhotos.length + photos.length > 12) fail('An issue can have no more than twelve photos.', 'ISSUE_PHOTO_LIMIT')
  if (photos.some((photo) => previousPhotos.some((previous) => previous.id === photo.id))) fail('This photo is already attached to the issue.', 'INVALID_ISSUE_PHOTOS')
  const createdAt = now.toISOString()
  const status = ({ start_work: 'in_progress', request_completion: 'awaiting_review', complete: 'completed', reopen: 'open' })[input.type] ?? current.status
  return { created: true, event: {
    id: randomUUID(), issue_id: issue.id, version: current.version + 1, event_type: input.type, status,
    assignee: input.type === 'assign' ? assignee : current.assignee, note,
    actor: context.user, actor_user_id: actorId, actor_role: context.authenticatedRole || context.role,
    store_id: context.store, created_at: createdAt,
    completed_at: input.type === 'complete' ? createdAt : input.type === 'reopen' ? null : current.completed_at,
    completed_by: input.type === 'complete' ? context.user : input.type === 'reopen' ? null : current.completed_by,
    photos_json: JSON.stringify(photos), input_hash: inputHash, idempotency_key: key,
  } }
}
