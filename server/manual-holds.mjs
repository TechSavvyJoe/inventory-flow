import { createHash, randomUUID } from 'node:crypto'
import { dispositionOwnerStore } from './vehicle-disposition.mjs'
import { employeeNoteHasContactInformation } from './employee-note-validation.mjs'
import { validateOperationalEvidence } from './provider-evidence.mjs'
import { WorkflowError } from './workflow.mjs'

// App-owned reservations. Imported CRM holds remain independent, read-only evidence.
export const MANUAL_HOLD_COLUMNS = Object.freeze([
  'id', 'vin', 'version', 'state', 'customer_label', 'expected_delivery_date', 'note',
  'owner_user_id', 'updated_at', 'actor', 'actor_user_id', 'actor_role', 'store_id', 'input_hash', 'idempotency_key',
])
const ROLES = new Set(['sales', 'manager', 'group_manager'])
const STATES = ['requested', 'active', 'released', 'rejected', 'cancelled']
export function manualHoldApprovalSchema(sql) {
  return typeof sql === 'string' && STATES.every(state => sql.includes(`'${state}'`))
}
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
  return context.role === 'manager' || !['active', 'requested'].includes(row?.state) || row.owner_user_id === employeeId(context)
}

export function manualHoldView(source, row, context, { enabled = true, approvalEnabled = true, detail = false } = {}) {
  return {
    vin: source.vin, state: row?.state ?? null, version: row?.version ?? 0,
    expectedDeliveryDate: row?.expected_delivery_date ?? null,
    updatedAt: row?.updated_at ?? null, ownerStore: dispositionOwnerStore(source),
    canManage: canManage(source, row, context, enabled && approvalEnabled), enabled, approvalEnabled,
    canApprove: row?.state === 'requested' && ['manager', 'group_manager'].includes(context.role) && canManage(source, row, context, enabled && approvalEnabled),
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

export function buildManualHoldEvent(source, rows, input, context, { now, idempotencyKey, enabled = true, approvalEnabled = true }) {
  if (!enabled || !approvalEnabled) throw new WorkflowError('Manual hold approvals require migration 0017 before saving.', { status: 503, code: 'MIGRATION_REQUIRED' })
  const current = rows.at(-1)
  if (!canManage(source, current, context, enabled)) {
    throw new WorkflowError('Your store’s salesperson can manage their own hold; a home-store or group manager can manage any hold.', { status: 403, code: 'MANUAL_HOLD_ACCESS_DENIED' })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !KEYS.has(key)) ||
      !STATES.includes(input.state) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
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
  // Approval omissions retain the request's detail; explicit empty values clear it.
  // Bind that distinction to the immutable predecessor so replay after approval
  // computes the same hash, while pre-approval legacy event hashes stay valid.
  const approvalInput = input.state === 'active' && rows.some(row => row.version === input.expectedVersion && row.state === 'requested')
    ? { providedFields: ['customerLabel', 'note', 'expectedDeliveryDate'].filter(key => input[key] !== undefined) } : {}
  const inputHash = createHash('sha256').update(JSON.stringify({ state: input.state, expectedVersion: input.expectedVersion, customerLabel, note, expectedDeliveryDate: date,
    ...approvalInput, actor: employeeId(context), role: context.role, store: context.store })).digest('hex')
  const replay = rows.find(row => row.idempotency_key === idempotencyKey)
  if (replay) {
    if (replay.input_hash !== inputHash) throw new WorkflowError('This request key was used for another hold action.', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    return { row: replay, created: false }
  }
  if (input.expectedVersion !== (current?.version ?? 0)) throw new WorkflowError('Another employee updated the hold. Review the latest record and save again.', { status: 409, code: 'MANUAL_HOLD_VERSION_CONFLICT' })
  const pending = current?.state === 'requested'
  const active = current?.state === 'active'
  const manager = ['manager', 'group_manager'].includes(context.role)
  if (input.state === 'active' && !manager && !active) throw new WorkflowError('A home-store or group manager must approve the hold request.', { status: 403, code: 'MANUAL_HOLD_APPROVAL_REQUIRED' })
  if (input.state === 'requested' && active) throw new WorkflowError('Release the active hold before requesting another hold.', { code: 'MANUAL_HOLD_INVALID_TRANSITION' })
  if (input.state === 'rejected' && (!manager || !pending)) throw new WorkflowError('Only a home-store or group manager can reject a pending request.', { status: 403, code: 'MANUAL_HOLD_ACCESS_DENIED' })
  if (input.state === 'cancelled' && (!pending || current.owner_user_id !== employeeId(context))) throw new WorkflowError('Only the requester can cancel their pending request.', { status: 403, code: 'MANUAL_HOLD_ACCESS_DENIED' })
  if (input.state === 'released' && !active) throw new WorkflowError('There is no active manual hold to release.', { code: 'MANUAL_HOLD_NOT_ACTIVE' })
  if (['released', 'rejected', 'cancelled'].includes(input.state) && !note) throw new WorkflowError('Add a reason for this hold action.', { code: 'MANUAL_HOLD_REASON_REQUIRED' })
  const closing = ['released', 'rejected', 'cancelled'].includes(input.state)
  const approving = input.state === 'active' && pending
  const nextLabel = closing || (approving && input.customerLabel === undefined) ? current.customer_label : customerLabel
  const nextDate = closing || (approving && input.expectedDeliveryDate === undefined) ? current.expected_delivery_date : date
  const nextNote = approving && input.note === undefined ? current.note : note
  if (['active', 'requested'].includes(input.state) && !nextLabel && !nextNote) throw new WorkflowError('Add a customer nickname or a reason for the hold.', { code: 'MANUAL_HOLD_REASON_REQUIRED' })
  return { created: true, row: {
    id: randomUUID(), vin: source.vin, version: (current?.version ?? 0) + 1, state: input.state,
    customer_label: nextLabel, expected_delivery_date: nextDate, note: nextNote,
    owner_user_id: active || pending ? current.owner_user_id : employeeId(context),
    updated_at: now.toISOString(), actor: context.user, actor_user_id: employeeId(context),
    actor_role: context.authenticatedRole || context.role, store_id: context.store, input_hash: inputHash, idempotency_key: idempotencyKey,
  } }
}

/** Signal comparison, never an availability promise or a write back to a source. */
export function inventoryDecision(vehicle) {
  const manual = vehicle.manualHold?.state ?? null
  const decidedManual = ['active', 'released'].includes(manual) ? manual : null
  const observed = ['primary', 'backup', 'multiple'].includes(vehicle.hold?.state) ? true
    : vehicle.hold?.state === 'none_observed' ? false : null
  const code = vehicle.appDisposition?.code ?? null
  const reasons = []
  if (manual === 'active' && observed === false) reasons.push('manual_hold_not_in_source')
  if (manual === 'released' && observed === true) reasons.push('source_hold_after_manual_release')
  if (code === 'delivered' && (manual === 'active' || observed === true)) reasons.push('delivered_with_hold')
  if (code === 'keep' && vehicle.managerDisposition?.deliveredManagerLog === true) reasons.push('keep_vs_imported_delivery')
  const legacyReasons = [...reasons]
  let evidence
  if (vehicle.operationalEvidence) {
    const records = validateOperationalEvidence(vehicle.operationalEvidence, vehicle.vin).records
    evidence = records.map(record => {
      const current = record.dataState === 'current' && record.complete
      const effectiveHoldState = current ? record.holdState : 'unknown'
      const providerObserved = effectiveHoldState === 'held' ? true : effectiveHoldState === 'not_observed' ? false : null
      const knownDisposition = current && record.reportedDisposition && !['unknown', 'not_observed'].includes(record.reportedDisposition)
      const agrees = (providerObserved !== null && (decidedManual || observed === providerObserved)) || (knownDisposition && record.reportedDisposition === code)
      const providerReasons = []
      if (manual === 'active' && providerObserved === false) providerReasons.push('manual_hold_not_in_source')
      if (manual === 'released' && providerObserved === true) providerReasons.push('source_hold_after_manual_release')
      if (code === 'delivered' && providerObserved === true) providerReasons.push('delivered_with_hold')
      if (current && code && record.reportedDisposition && !['unknown', 'not_observed'].includes(record.reportedDisposition) && record.reportedDisposition !== code) providerReasons.push('provider_disposition_mismatch')
      return { ...record, effectiveHoldState, comparison: providerReasons.length ? 'conflict'
        : agrees ? 'agreement' : providerObserved !== null || knownDisposition ? 'source_only' : 'unverified', reasons: providerReasons }
    })
    const currentSignals = evidence.filter(record => record.effectiveHoldState !== 'unknown')
    if ((observed !== null && currentSignals.some(record => (record.effectiveHoldState === 'held') !== observed)) || new Set(currentSignals.map(record => record.effectiveHoldState)).size > 1) {
      reasons.push('provider_hold_disagreement')
      evidence = evidence.map(record => record.effectiveHoldState === 'unknown' ? record : {
        ...record, comparison: 'conflict', reasons: [...new Set([...record.reasons, 'provider_hold_disagreement'])],
      })
    }
    const dispositions = evidence.filter(record => record.dataState === 'current' && record.complete && record.reportedDisposition && !['unknown', 'not_observed'].includes(record.reportedDisposition))
    if (new Set(dispositions.map(record => record.reportedDisposition)).size > 1) {
      evidence = evidence.map(record => dispositions.includes(record) ? {
        ...record, comparison: 'conflict', reasons: [...new Set([...record.reasons, 'provider_disposition_mismatch'])],
      } : record)
    }
    reasons.push(...evidence.flatMap(record => record.reasons))
    // Legacy CRM evidence stays distinct from supplied providers and carries no private fields.
    if (observed !== null || vehicle.hold?.lastKnownActiveHold === true) evidence.unshift({
      vin: vehicle.vin, provider: records.some(record => record.provider === 'dealermail') ? 'legacy-dealermail' : 'dealermail', sourceLabel: 'DealerMail',
      dataState: observed === null ? 'stale_unverified' : 'current', readOnly: true, complete: observed !== null,
      holdState: observed === true || vehicle.hold?.lastKnownActiveHold === true ? 'held' : observed === false ? 'not_observed' : 'unknown',
      effectiveHoldState: observed === true ? 'held' : observed === false ? 'not_observed' : 'unknown',
      comparison: observed === null ? 'unverified' : legacyReasons.length || reasons.includes('provider_hold_disagreement') ? 'conflict' : decidedManual ? 'agreement' : 'source_only',
      reasons: [...legacyReasons, ...(reasons.includes('provider_hold_disagreement') ? ['provider_hold_disagreement'] : [])],
    })
  }
  const uniqueReasons = [...new Set(reasons)]
  const providerObserved = evidence?.some(record => record.capturedAt && record.dataState === 'current' && record.complete && (record.effectiveHoldState !== 'unknown' || (record.reportedDisposition && !['unknown', 'not_observed'].includes(record.reportedDisposition)))) ?? false
  const providerHeld = evidence?.some(record => record.capturedAt && record.effectiveHoldState === 'held') ?? false
  const comparison = reasons.length ? 'conflict' : decidedManual && (observed !== null || providerObserved) ? 'agreement'
    : decidedManual ? 'manual_only' : observed !== null || providerObserved ? 'source_only' : 'unverified'
  const status = code && code !== 'keep' ? code : manual === 'active' || observed === true || providerHeld ? 'held' : manual === 'requested' ? 'hold_requested' : 'unconfirmed'
  return { status, comparison, reasons: uniqueReasons, manualHold: manual, importedHold: observed,
    reviewRequired: reasons.length > 0, ...(evidence ? { evidence } : {}),
    label: code && code !== 'keep' ? ({ sold_pending: 'Sold pending', delivered: 'Delivered', other: 'Other disposition', wholesale: 'Wholesale', transfer_out: 'Transfer out' }[code] ?? 'Other disposition') : reasons.length && !evidence ? 'Review conflicting records' : status === 'held' ? 'Held' : status === 'hold_requested' ? 'Hold requested'
      : status === 'sold_pending' ? 'Sold pending' : status === 'delivered' ? 'Delivered'
        : status === 'other' ? 'Other disposition' : status === 'wholesale' ? 'Wholesale'
          : status === 'transfer_out' ? 'Transfer out' : 'Confirm availability' }
}
