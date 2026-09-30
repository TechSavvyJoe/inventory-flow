import { createHash, randomUUID } from 'node:crypto'
import { WorkflowError } from './workflow.mjs'

export const SAVED_LIST_LIMIT = 20
export const SAVED_LIST_ITEM_LIMIT = 200
export const SAVED_LIST_BODY_BYTES = 4 * 1024

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const LIST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACTION_FIELDS = Object.freeze({
  create: new Set(['action', 'label']),
  rename: new Set(['action', 'listId', 'label', 'expectedRevision']),
  delete: new Set(['action', 'listId', 'expectedRevision']),
  add: new Set(['action', 'listId', 'vin', 'expectedRevision']),
  remove: new Set(['action', 'listId', 'vin', 'expectedRevision']),
})

function invalid(message, details) {
  throw new WorkflowError(message, { code: 'INVALID_SAVED_LIST_INPUT', details })
}

export function savedListOwnerId(context, { required = true } = {}) {
  const value = String(context?.userId ?? '').trim()
  if (value) return value
  if (context?.allowLegacyTransportAssignmentByName === true) return 'demo:local-prototype-user'
  if (required) {
    throw new WorkflowError('A stable authenticated employee identity is required.', {
      status: 401,
      code: 'AUTH_CONTEXT_INVALID',
      details: { field: 'userId' },
    })
  }
  return null
}

function labelValue(value) {
  const label = String(value ?? '').trim().normalize('NFC')
  if (!label || [...label].length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) {
    invalid('List label must be between 1 and 80 characters.', { field: 'label' })
  }
  return label
}

function revisionValue(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid('expectedRevision must be a positive integer.', { field: 'expectedRevision' })
  }
  return value
}

function idempotencyValue(value) {
  const key = String(value ?? '').trim()
  if (!key || key.length > 160 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new WorkflowError('An idempotency key is required for this action.', {
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })
  }
  return key
}

export function normalizeSavedListMutation(input, context, idempotencyKey, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Saved-list input must be an object.')
  const action = String(input.action ?? '').trim().toLowerCase()
  const allowed = ACTION_FIELDS[action]
  if (!allowed || Object.keys(input).some((field) => !allowed.has(field))) {
    invalid('Choose a supported saved-list action.', { field: 'action' })
  }
  const normalized = { action }
  if (action === 'create' || action === 'rename') normalized.label = labelValue(input.label)
  if (action !== 'create') {
    const listId = String(input.listId ?? '').trim()
    if (!LIST_ID_PATTERN.test(listId)) invalid('Choose a valid saved list.', { field: 'listId' })
    normalized.listId = listId.toLowerCase()
    normalized.expectedRevision = revisionValue(input.expectedRevision)
  }
  if (action === 'add' || action === 'remove') {
    const vin = String(input.vin ?? '').trim().toUpperCase()
    if (!VIN_PATTERN.test(vin)) invalid('VIN must be a valid 17-character VIN.', { field: 'vin' })
    normalized.vin = vin
  }
  const inputHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
  return {
    ...normalized,
    ownerUserId: savedListOwnerId(context),
    idempotencyKey: idempotencyValue(idempotencyKey),
    inputHash,
    at: now.toISOString(),
    newId: action === 'create' ? randomUUID() : undefined,
  }
}

export function savedListView(raw, availableVins) {
  if (raw?.deleted === true) return { id: raw.id, deleted: true, revision: raw.revision }
  return {
    id: raw.id,
    label: raw.label,
    revision: raw.revision,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    items: raw.items.map((item) => ({
      vin: item.vin,
      addedAt: item.addedAt,
      available: availableVins.has(item.vin),
    })),
  }
}
