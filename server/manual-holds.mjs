import { createHash, randomUUID } from 'node:crypto'
import { dispositionOwnerStore } from './vehicle-disposition.mjs'
import { employeeNoteHasContactInformation } from './employee-note-validation.mjs'
import { WorkflowError } from './workflow.mjs'

// App-owned reservations. Imported CRM holds remain independent, read-only evidence.
export const MANUAL_HOLD_COLUMNS = Object.freeze([
  'id', 'vin', 'version', 'state', 'customer_label', 'expected_delivery_date', 'note',
  'owner_user_id', 'updated_at', 'actor', 'actor_user_id', 'actor_role', 'store_id', 'input_hash', 'idempotency_key',
])
const ROLES = new Set(['sales', 'manager', 'group_manager'])
const KEYS = new Set(['state', 'customerLabel', 'expectedDeliveryDate', 'note', 'expectedVersion'])
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

function employeeId(context) {
  if (context.userId) return context.userId
  // Only the isolated Node demo resolver enables this legacy prototype flag.
  // Hosted membership identity never falls back to a display name.
  return context.allowLegacyTransportAssignmentByName === true
    ? `demo:${createHash('sha256').update(JSON.stringify([context.role, context.store, context.user])).digest('hex')}` : null
}

function canManage(source, row, context, enabled) {
  if (!enabled || !ROLES.has(context.role) || !employeeId(context)) return false
  const store = dispositionOwnerStore(source)
  if (!store) return false
  if (context.role === 'group_manager') return true
  if (context.store !== store) return false
  return context.role === 'manager' || row?.state !== 'active' || row.owner_user_id === employeeId(context)
}

export function manualHoldView(source, row, context, { enabled = true, detail = false } = {}) {
  return {
    vin: source.vin, state: row?.state ?? null, version: row?.version ?? 0,
    expectedDeliveryDate: row?.expected_delivery_date ?? null,
    updatedAt: row?.updated_at ?? null, ownerStore: dispositionOwnerStore(source),
    canManage: canManage(source, row, context, enabled), enabled,
    ...(detail && context.canViewPrivateEvidence ? {
      customerLabel: row?.customer_label ?? null, note: row?.note ?? null,
      updatedBy: row?.actor ?? null, ownedByCurrentUser: row?.owner_user_id === employeeId(context),
    } : {}),
  }
}

export function manualHoldDetail(source, rows, context, options) {
  return {
    ...manualHoldView(source, rows.at(-1), context, { ...options, detail: true }),
    history: context.canViewPrivateEvidence
      ? [...rows].reverse().map(row => manualHoldView(source, row, context, { ...options, detail: true })) : [],
  }
}

function text(value, limit, label) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > limit || CONTROL.test(value)) {
    throw new WorkflowError(`Enter a valid ${label} (${limit} characters maximum).`, { code: 'INVALID_MANUAL_HOLD_INPUT' })
  }
  return value.trim() || null
}

export function buildManualHoldEvent(source, rows, input, context, { now, idempotencyKey, enabled = true }) {
  if (!enabled) throw new WorkflowError('Manual hold storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
  const current = rows.at(-1)
  if (!canManage(source, current, context, enabled)) {
    throw new WorkflowError('Your store’s salesperson can manage their own hold; a home-store or group manager can manage any hold.', { status: 403, code: 'MANUAL_HOLD_ACCESS_DENIED' })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !KEYS.has(key)) ||
      !['active', 'released'].includes(input.state) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new WorkflowError('Choose a hold action and reload the latest record before saving.', { code: 'INVALID_MANUAL_HOLD_INPUT' })
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160 || /[\x00-\x1f]/.test(idempotencyKey)) {
    throw new WorkflowError('A valid idempotency key is required.', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  }
  const customerLabel = text(input.customerLabel, 100, 'customer label')
  if (customerLabel && (/@|https?:\/\/|www\./i.test(customerLabel) || (customerLabel.match(/\d/g)?.length ?? 0) >= 7)) {
    throw new WorkflowError('Use initials or a nickname, without contact information.', { code: 'INVALID_MANUAL_HOLD_INPUT' })
  }
  const note = text(input.note, 1000, 'hold note')
  if (note && employeeNoteHasContactInformation(note)) {
    throw new WorkflowError('Keep contact information in the CRM, not in hold notes.', { code: 'INVALID_MANUAL_HOLD_INPUT' })
  }
  const date = text(input.expectedDeliveryDate, 10, 'expected delivery date')
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) {
    throw new WorkflowError('Enter a valid expected delivery date.', { code: 'INVALID_MANUAL_HOLD_INPUT' })
  }
  const inputHash = createHash('sha256').update(JSON.stringify({ state: input.state, expectedVersion: input.expectedVersion, customerLabel, note, expectedDeliveryDate: date,
    actor: employeeId(context), role: context.role, store: context.store })).digest('hex')
  const replay = rows.find(row => row.idempotency_key === idempotencyKey)
  if (replay) {
    if (replay.input_hash !== inputHash) throw new WorkflowError('This request key was used for another hold action.', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    return { row: replay, created: false }
  }
  if (input.expectedVersion !== (current?.version ?? 0)) throw new WorkflowError('Another employee updated the hold. Review the latest record and save again.', { status: 409, code: 'MANUAL_HOLD_VERSION_CONFLICT' })
  if (input.state === 'released' && current?.state !== 'active') throw new WorkflowError('There is no active manual hold to release.', { code: 'MANUAL_HOLD_NOT_ACTIVE' })
  if (input.state === 'released' && !note) throw new WorkflowError('Add a reason for releasing this hold.', { code: 'MANUAL_HOLD_REASON_REQUIRED' })
  if (input.state === 'active' && !customerLabel && !note) throw new WorkflowError('Add a customer nickname or a reason for the hold.', { code: 'MANUAL_HOLD_REASON_REQUIRED' })
  return { created: true, row: {
    id: randomUUID(), vin: source.vin, version: (current?.version ?? 0) + 1, state: input.state,
    customer_label: input.state === 'released' ? current.customer_label : customerLabel,
    expected_delivery_date: input.state === 'released' ? current.expected_delivery_date : date, note,
    owner_user_id: current?.state === 'active' ? current.owner_user_id : employeeId(context),
    updated_at: now.toISOString(), actor: context.user, actor_user_id: employeeId(context),
    actor_role: context.authenticatedRole || context.role, store_id: context.store, input_hash: inputHash, idempotency_key: idempotencyKey,
  } }
}

/** Signal comparison, never an availability promise or a write back to a source. */
export function inventoryDecision(vehicle) {
  const manual = vehicle.manualHold?.state ?? null
  const observed = ['primary', 'backup', 'multiple'].includes(vehicle.hold?.state) ? true
    : vehicle.hold?.state === 'none_observed' ? false : null
  const code = vehicle.appDisposition?.code ?? null
  const reasons = []
  if (manual === 'active' && observed === false) reasons.push('manual_hold_not_in_source')
  if (manual === 'released' && observed === true) reasons.push('source_hold_after_manual_release')
  if (code === 'delivered' && (manual === 'active' || observed === true)) reasons.push('delivered_with_hold')
  if (code === 'keep' && vehicle.managerDisposition?.deliveredManagerLog === true) reasons.push('keep_vs_imported_delivery')
  const comparison = reasons.length ? 'conflict' : manual && observed !== null ? 'agreement'
    : manual ? 'manual_only' : observed !== null ? 'source_only' : 'unverified'
  const status = code && code !== 'keep' ? code : manual === 'active' || observed === true ? 'held' : 'unconfirmed'
  return { status, comparison, reasons, manualHold: manual, importedHold: observed,
    label: reasons.length ? 'Review conflicting records' : status === 'held' ? manual === 'active' ? 'Manual hold' : 'Imported hold'
      : status === 'sold_pending' ? 'Sold pending' : status === 'delivered' ? 'Delivered'
        : status === 'other' ? 'Other disposition' : status === 'wholesale' ? 'Wholesale'
          : status === 'transfer_out' ? 'Transfer out' : 'Confirm availability' }
}
