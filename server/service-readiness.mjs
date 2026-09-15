import { createHash, randomUUID } from 'node:crypto'
import { STORE_NAMES } from './constants.mjs'
import { WorkflowError } from './workflow.mjs'

export const SERVICE_STATUSES = Object.freeze(['needs_service', 'in_service', 'serviced'])
export const SERVICE_EVENT_COLUMNS = Object.freeze([
  'id', 'vin', 'version', 'status', 'service_entered_at', 'completed_at', 'notes',
  'updated_at', 'actor', 'actor_user_id', 'actor_role', 'store_id', 'input_hash', 'idempotency_key',
])

export function serviceStore(vehicle) {
  if (vehicle.movement?.locationConfidence === 'verified' && STORE_NAMES.includes(vehicle.movement.currentLocation)) {
    return vehicle.movement.currentLocation
  }
  // Ownership falls back to the server's home-store calculation. This grants
  // the store manager a service action without asserting physical custody.
  return STORE_NAMES.includes(vehicle.homeStore) ? vehicle.homeStore : null
}

export function serviceReadinessView(vehicle, row, context, { includeNotes = false } = {}) {
  const store = serviceStore(vehicle)
  const canManage = context.role === 'group_manager' || (context.role === 'manager' && store === context.store)
  return {
    vin: vehicle.vin,
    // Ready is a workflow baseline, not evidence that a service was performed.
    // An explicit legacy review or recorded arrival stays waiting until a manager acts.
    status: row ? (row.status === 'unknown' ? 'needs_service' : row.status) : vehicle.serviceIntake ? 'needs_service' : 'serviced',
    readinessBasis: row ? (row.status === 'unknown' ? 'legacy_review' : 'manager_updated') : vehicle.serviceIntake ? 'new_arrival' : 'existing_inventory',
    version: row?.version ?? 0,
    serviceEnteredAt: row?.service_entered_at ?? null, completedAt: row?.completed_at ?? null,
    updatedAt: row?.updated_at ?? null, updatedBy: row?.actor ?? null,
    updatedByRole: row?.actor_role ?? null, updatedAtStore: row?.store_id ?? null,
    store, canManage,
    ...(includeNotes && context.canViewPrivateEvidence ? { notes: row?.notes ?? null } : {}),
  }
}

function serviceDate(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new WorkflowError('Enter a valid service date.', { code: 'INVALID_SERVICE_DATE' })
  }
  if (value > today) throw new WorkflowError('Service dates cannot be in the future.', { code: 'INVALID_SERVICE_DATE' })
  return value
}

export function buildServiceReadinessEvent(vehicle, rows, input, context, { now, today, idempotencyKey }) {
  const current = rows.at(-1) ?? null
  const view = serviceReadinessView(vehicle, current, context)
  if (!view.canManage) throw new WorkflowError('Only this vehicle’s store manager can update service status.', { status: 403, code: 'SERVICE_MANAGER_REQUIRED' })
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkflowError('A service update is required.')
  const allowed = new Set(['status', 'serviceDate', 'notes', 'expectedVersion'])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new WorkflowError('Unsupported service update field.', { code: 'INVALID_SERVICE_INPUT' })
  if (!SERVICE_STATUSES.includes(input.status)) throw new WorkflowError('Choose a valid service status.', { code: 'INVALID_SERVICE_STATUS' })
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new WorkflowError('Reload this vehicle before updating service status.', { code: 'SERVICE_VERSION_REQUIRED' })
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160 || /[\x00-\x1f]/.test(idempotencyKey)) {
    throw new WorkflowError('A valid idempotency key is required.', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  }
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.notes))) {
    throw new WorkflowError('Service notes must be text, up to 1,000 characters.', { code: 'INVALID_SERVICE_NOTES' })
  }
  const notes = input.notes?.trim() || null
  const date = ['in_service', 'serviced'].includes(input.status) ? serviceDate(input.serviceDate, today) : null
  if (date === null && input.serviceDate) throw new WorkflowError('A date applies only to in-service or completed work.', { code: 'INVALID_SERVICE_DATE' })
  const inputHash = createHash('sha256').update(JSON.stringify({
    status: input.status, date, notes, expectedVersion: input.expectedVersion,
    actor: context.userId || context.user, role: context.role, store: context.store,
  })).digest('hex')
  const replay = rows.find((row) => row.idempotency_key === idempotencyKey)
  if (replay) {
    if (replay.input_hash !== inputHash) throw new WorkflowError('This request key was already used for a different service update.', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    return { row: replay, created: false }
  }
  if (input.expectedVersion !== view.version) throw new WorkflowError('Another manager updated this vehicle. Review the latest status and save again.', { status: 409, code: 'SERVICE_VERSION_CONFLICT' })
  const enteredAt = input.status === 'in_service' ? date : input.status === 'serviced' ? current?.service_entered_at ?? null : null
  if (input.status === 'serviced' && enteredAt && date < enteredAt) {
    throw new WorkflowError('Completion date cannot be before the date service started.', { code: 'INVALID_SERVICE_DATE' })
  }
  return { created: true, row: {
    id: randomUUID(), vin: vehicle.vin, version: view.version + 1, status: input.status,
    service_entered_at: enteredAt, completed_at: input.status === 'serviced' ? date : null,
    notes, updated_at: now.toISOString(), actor: context.user, actor_user_id: context.userId || null,
    actor_role: context.role, store_id: context.store, input_hash: inputHash, idempotency_key: idempotencyKey,
  } }
}
