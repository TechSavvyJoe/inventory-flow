import { randomUUID } from 'node:crypto'
import { STORE_NAMES } from './constants.mjs'

export const USER_ROLES = ['sales', 'manager', 'coordinator', 'porter', 'driver', 'group_manager']
export const PRIVILEGED_ROLES = new Set(['manager', 'group_manager'])
export const HOLD_EVIDENCE_ROLES = new Set(['sales', 'manager', 'group_manager'])

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const PASSIVE_EVENTS = new Set(['note_added', 'eta_updated', 'driver_requested', 'condition_issue', 'location_exception', 'escalated'])
const ACTIVE_ONLY_PASSIVE_EVENTS = new Set(['driver_requested', 'condition_issue', 'location_exception', 'escalated'])
const TRANSPORT_ASSIGNMENT_EVENTS = new Set(['transport_assigned', 'return_assigned'])

export const TRANSITION_MAP = Object.freeze({
  requested: new Set(['manager_reviewed', 'declined', 'canceled']),
  manager_reviewed: new Set(['approved', 'declined', 'canceled']),
  approved: new Set(['transport_assigned', 'canceled']),
  transport_assigned: new Set(['picked_up', 'canceled']),
  picked_up: new Set(['in_transit', 'arrived']),
  in_transit: new Set(['arrived']),
  arrived: new Set(['customer_showing', 'sale_outcome_pending', 'sale_confirmed', 'not_sold', 'return_requested']),
  customer_showing: new Set(['sale_outcome_pending', 'sale_confirmed', 'not_sold', 'return_requested']),
  sale_outcome_pending: new Set(['sale_confirmed', 'not_sold', 'return_requested']),
  sale_confirmed: new Set(['delivery_confirmed']),
  delivery_confirmed: new Set(['closed']),
  not_sold: new Set(['return_requested']),
  return_requested: new Set(['return_assigned']),
  return_assigned: new Set(['return_in_transit']),
  return_in_transit: new Set(['returned_home']),
  returned_home: new Set(['closed']),
  declined: new Set(),
  canceled: new Set(),
  closed: new Set(),
})

const EVENT_LABELS = Object.freeze({
  requested: 'Vehicle requested',
  manager_reviewed: 'Requesting-store manager approved; home-store call required',
  approved: 'Home-store availability and release confirmed',
  declined: 'Request declined',
  canceled: 'Request canceled',
  transport_assigned: 'Transport assigned',
  picked_up: 'Vehicle picked up',
  in_transit: 'Vehicle in transit',
  arrived: 'Vehicle arrived at requesting store',
  customer_showing: 'Customer showing in progress',
  sale_outcome_pending: 'Sale outcome pending confirmation',
  sale_confirmed: 'Sold pending recorded in Inventory Flow',
  delivery_confirmed: 'Delivery explicitly confirmed in Inventory Flow',
  not_sold: 'Vehicle not sold',
  return_requested: 'Return to home store requested',
  return_assigned: 'Return transport assigned',
  return_in_transit: 'Vehicle returning to home store',
  returned_home: 'Home store receipt confirmed',
  closed: 'Transfer workflow closed',
  note_added: 'Operational note added',
  eta_updated: 'Due time updated',
  driver_requested: 'Driver coordination requested',
  location_exception: 'Location exception recorded',
  condition_issue: 'Vehicle condition issue reported',
  escalated: 'Transfer escalated for manager attention',
})

const EVENT_ROLE_RULES = Object.freeze({
  manager_reviewed: new Set(['manager', 'group_manager']),
  approved: new Set(['manager', 'group_manager']),
  declined: new Set(['manager', 'group_manager']),
  canceled: new Set(['manager', 'group_manager']),
  driver_requested: new Set(['sales', 'manager', 'group_manager']),
  transport_assigned: new Set(['coordinator', 'manager', 'group_manager']),
  picked_up: new Set(['porter', 'driver', 'manager', 'group_manager']),
  in_transit: new Set(['porter', 'driver', 'manager', 'group_manager']),
  arrived: new Set(['porter', 'driver', 'manager', 'group_manager']),
  customer_showing: new Set(['sales', 'manager', 'group_manager']),
  sale_outcome_pending: new Set(['sales', 'manager', 'group_manager']),
  sale_confirmed: new Set(['manager', 'group_manager']),
  delivery_confirmed: new Set(['manager', 'group_manager']),
  not_sold: new Set(['sales', 'manager', 'group_manager']),
  return_requested: new Set(['sales', 'manager', 'group_manager']),
  return_assigned: new Set(['coordinator', 'manager', 'group_manager']),
  return_in_transit: new Set(['porter', 'driver', 'manager', 'group_manager']),
  returned_home: new Set(['manager', 'group_manager']),
  closed: new Set(['manager', 'group_manager']),
  note_added: new Set(USER_ROLES),
  eta_updated: new Set(['coordinator', 'porter', 'driver', 'manager', 'group_manager']),
  location_exception: new Set(USER_ROLES),
  condition_issue: new Set(USER_ROLES),
  escalated: new Set(USER_ROLES),
})

export class WorkflowError extends Error {
  constructor(message, { status = 422, code = 'VALIDATION_ERROR', details } = {}) {
    super(message)
    this.name = 'WorkflowError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function requiredText(value, field, maxLength = 500) {
  const text = String(value ?? '').trim()
  if (!text) throw new WorkflowError(`${field} is required`, { details: { field } })
  if (text.length > maxLength) {
    throw new WorkflowError(`${field} is too long`, { details: { field, maxLength } })
  }
  return text
}

function optionalText(value, field, maxLength = 500) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  if (text.length > maxLength) {
    throw new WorkflowError(`${field} is too long`, { details: { field, maxLength } })
  }
  return text || null
}

function optionalIdentity(value, field) {
  const text = optionalText(value, field, 160)
  if (text && /[\u0000-\u001f\u007f]/.test(text)) {
    throw new WorkflowError(`${field} is invalid`, { details: { field } })
  }
  return text
}

function storeName(value, field) {
  const store = requiredText(value, field, 40)
  if (!STORE_NAMES.includes(store)) {
    throw new WorkflowError(`${field} must be a Bob Maxey store`, {
      details: { field, allowed: STORE_NAMES },
    })
  }
  return store
}

function isoTimestamp(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new WorkflowError(`${field} is required`, { details: { field } })
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw new WorkflowError(`${field} must be a valid date or timestamp`, { details: { field } })
  }
  return parsed.toISOString()
}

export function roleContext({ role, store, user, userId, allowLegacyTransportAssignmentByName = false } = {}) {
  if (!USER_ROLES.includes(role)) {
    throw new WorkflowError('A valid authenticated role is required', {
      status: 401,
      code: 'AUTH_CONTEXT_INVALID',
      details: { field: 'role' },
    })
  }
  if (!STORE_NAMES.includes(store)) {
    throw new WorkflowError('A valid authenticated store is required', {
      status: 401,
      code: 'AUTH_CONTEXT_INVALID',
      details: { field: 'store' },
    })
  }
  const normalizedUser = String(user ?? '').trim()
  if (!normalizedUser) {
    throw new WorkflowError('An authenticated user is required', {
      status: 401,
      code: 'AUTH_CONTEXT_INVALID',
      details: { field: 'user' },
    })
  }
  const normalizedUserId = optionalIdentity(userId, 'userId')
  return {
    role,
    store,
    user: normalizedUser,
    userId: normalizedUserId,
    allowLegacyTransportAssignmentByName: allowLegacyTransportAssignmentByName === true,
    canViewPrivateEvidence: HOLD_EVIDENCE_ROLES.has(role),
    canCreateTransfer: !['coordinator', 'porter', 'driver'].includes(role),
  }
}

export function buildTransferRequest({ input, vehicle, context, idempotencyKey, now = new Date() }) {
  if (!context.canCreateTransfer) {
    throw new WorkflowError('Drivers cannot create transfer requests', { status: 403, code: 'FORBIDDEN' })
  }
  const vin = String(input?.vin ?? '').trim().toUpperCase()
  if (!VIN_PATTERN.test(vin)) throw new WorkflowError('VIN must be a valid 17-character VIN')
  if (!vehicle || vehicle.vin !== vin) {
    throw new WorkflowError('Vehicle was not found in the current source release', {
      status: 404,
      code: 'VEHICLE_NOT_FOUND',
    })
  }

  const requestingStoreId = context.store
  if (input.requestingStore && storeName(input.requestingStore, 'requestingStore') !== requestingStoreId) {
    throw new WorkflowError('requestingStore must match the active store context', {
      status: 403,
      code: 'STORE_MISMATCH',
    })
  }
  const sourceStore = vehicle.homeAssignment?.home_store_id || vehicle.publicRecord?.store || vehicle.crmRecord?.storeName
  const homeStoreId = storeName(sourceStore, 'homeStore')
  if (requestingStoreId === homeStoreId) {
    throw new WorkflowError('A cross-store request must use a different requesting store', {
      details: { homeStore: homeStoreId, requestingStore: requestingStoreId },
    })
  }

  const requestedBy = requiredText(context.user, 'requestedBy', 160)
  if (input.requestedBy && input.requestedBy !== requestedBy) {
    throw new WorkflowError('requestedBy must match the authenticated user context', {
      status: 403,
      code: 'ACTOR_MISMATCH',
    })
  }
  const neededBy = isoTimestamp(input.neededBy, 'neededBy', { required: true })
  const returnDueAt = isoTimestamp(input.returnDueAt, 'returnDueAt')
  const reason = requiredText(input.reason, 'reason', 1000)
  const customerReference = optionalText(input.customerReference, 'customerReference', 500)
  const priority = PRIORITIES.has(input.priority) ? input.priority : 'normal'
  const requestedAt = now.toISOString()
  const vehicleName = String(
    vehicle.publicRecord?.vehicle_name ||
      [vehicle.crmRecord?.yearRaw, vehicle.crmRecord?.makeRaw, vehicle.crmRecord?.modelRaw, vehicle.crmRecord?.seriesRaw]
        .filter(Boolean)
        .join(' '),
  ).trim()
  const stockAtRequest = String(vehicle.publicRecord?.stock_number || vehicle.crmRecord?.stockNumber || '').trim()
  const approvalOwner = optionalText(input.approvalOwner, 'approvalOwner', 160) || `${requestingStoreId} manager`
  const id = randomUUID()

  const request = {
    id,
    vin,
    stockAtRequest,
    vehicleNameAtRequest: vehicleName,
    homeStoreId,
    homeStoreConfirmed: Boolean(vehicle.homeAssignment),
    requestingStoreId,
    destinationStoreId: requestingStoreId,
    requestedBy,
    requestedAt,
    neededBy,
    reason,
    customerReference,
    customerAppointment: Boolean(input.customerAppointment),
    approvalOwner,
    approvedBy: null,
    priority,
    status: 'requested',
    movementStatus: 'at_home',
    dealStatus: 'not_confirmed',
    deliveryStatus: 'not_confirmed',
    currentLocationId: homeStoreId,
    currentCustodian: null,
    transportAssignee: null,
    transportAssigneeUserId: null,
    nextAction: 'Requesting-store manager reviews and approves the request',
    nextActionOwner: approvalOwner,
    dueAt: neededBy,
    returnRequired: input.returnRequired !== false,
    returnDueAt,
    lastConfirmedAt: requestedAt,
    locationConfidence: vehicle.homeAssignment ? 'verified' : 'reported',
    closedAt: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    idempotencyKey: optionalText(idempotencyKey, 'Idempotency-Key', 200),
  }

  const initialEvent = {
    id: randomUUID(),
    eventType: 'requested',
    label: EVENT_LABELS.requested,
    actor: requestedBy,
    actorUserId: context.userId,
    actorRole: context.role,
    storeId: requestingStoreId,
    fromLocationId: homeStoreId,
    toLocationId: requestingStoreId,
    occurredAt: requestedAt,
    note: null,
    createdAt: requestedAt,
    idempotencyKey: request.idempotencyKey ? `${request.idempotencyKey}:requested` : null,
  }

  return { request, initialEvent }
}

function requireEventPermission(eventType, role) {
  const allowed = EVENT_ROLE_RULES[eventType]
  if (!allowed) throw new WorkflowError('Unsupported transfer event type', { details: { eventType } })
  if (!allowed.has(role)) {
    throw new WorkflowError(`Role ${role} cannot record ${eventType}`, {
      status: 403,
      code: 'FORBIDDEN',
      details: { eventType, role },
    })
  }
}

function transitionAllowed(currentStatus, eventType) {
  if (eventType === 'driver_requested') return currentStatus === 'approved'
  if (ACTIVE_ONLY_PASSIVE_EVENTS.has(eventType) && ['declined', 'canceled', 'closed'].includes(currentStatus)) return false
  if (PASSIVE_EVENTS.has(eventType)) return true
  return TRANSITION_MAP[currentStatus]?.has(eventType) === true
}

export function allowedEventTypes(currentStatus, role) {
  if (!USER_ROLES.includes(role)) return []
  const candidates = new Set([...(TRANSITION_MAP[currentStatus] ?? []), ...PASSIVE_EVENTS])
  return [...candidates].filter(
    (eventType) => EVENT_ROLE_RULES[eventType]?.has(role) && transitionAllowed(currentStatus, eventType),
  )
}

function workflowPatch(current, eventType, input, actor, occurredAt, context) {
  const destination = current.destination_store_id
  const home = current.home_store_id
  const assignee = optionalText(input.assignee, 'assignee', 160)
  const assigneeUserId = optionalIdentity(input.assigneeUserId, 'assigneeUserId')
  const dueAt = isoTimestamp(input.dueAt, 'dueAt')
  const patch = {
    status: PASSIVE_EVENTS.has(eventType) ? current.status : eventType,
    updated_at: occurredAt,
  }

  switch (eventType) {
    case 'manager_reviewed':
      Object.assign(patch, {
        next_action: `Requesting-store manager calls ${home} used-car manager and records the release decision`,
        next_action_owner: current.approval_owner || `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'approved':
      Object.assign(patch, {
        approved_by: actor,
        next_action: destination === 'Howell' ? 'Salesperson calls Stacey for a driver' : 'Requesting store asks its manager or coordinator for a driver',
        next_action_owner: current.requested_by || `${destination} salesperson`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'declined':
    case 'canceled':
      Object.assign(patch, {
        next_action: 'No further action',
        next_action_owner: null,
        closed_at: occurredAt,
        last_confirmed_at: occurredAt,
      })
      break
    case 'transport_assigned':
      if (!assignee) throw new WorkflowError('assignee is required when transport is assigned')
      if (!dueAt) throw new WorkflowError('dueAt is required so the requesting team can see the pickup target')
      if (context.userId && !assigneeUserId) {
        throw new WorkflowError('A verified transport assignee identity is required', {
          code: 'ASSIGNEE_IDENTITY_REQUIRED',
        })
      }
      Object.assign(patch, {
        movement_status: 'transport_assigned',
        transport_assignee: assignee,
        transport_assignee_user_id: assigneeUserId,
        next_action: 'Assigned driver picks up vehicle and confirms custody',
        next_action_owner: assignee,
        due_at: dueAt,
      })
      break
    case 'picked_up':
    case 'in_transit':
      Object.assign(patch, {
        movement_status: eventType,
        current_location_id: 'In transit',
        current_custodian: assignee || current.transport_assignee || actor,
        next_action: 'Confirm arrival at requesting store',
        next_action_owner: assignee || current.transport_assignee || actor,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'arrived':
      Object.assign(patch, {
        movement_status: 'at_requesting_store',
        current_location_id: destination,
        current_custodian: actor,
        next_action: 'Record customer showing or vehicle outcome',
        next_action_owner: `${destination} sales/manager`,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'customer_showing':
      Object.assign(patch, {
        deal_status: 'customer_showing',
        next_action: 'Record sale outcome',
        next_action_owner: actor,
        last_confirmed_at: occurredAt,
      })
      break
    case 'sale_outcome_pending':
      Object.assign(patch, {
        deal_status: 'pending_confirmation',
        next_action: 'Manager confirms sale or starts return',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'sale_confirmed':
      Object.assign(patch, {
        deal_status: 'sold_pending',
        next_action: 'Confirm delivery separately before closing the movement workflow',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'delivery_confirmed':
      Object.assign(patch, {
        delivery_status: 'delivery_confirmed',
        next_action: 'Close movement workflow',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'not_sold':
      Object.assign(patch, {
        deal_status: 'not_sold',
        next_action: 'Request return to home store',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'return_requested':
      Object.assign(patch, {
        movement_status: 'return_requested',
        next_action: destination === 'Howell' ? 'Stacey coordinates the return driver' : 'Requesting store assigns the return driver',
        next_action_owner: destination === 'Howell' ? 'Stacey (Howell transport coordinator)' : `${destination} manager`,
        due_at: dueAt || current.return_due_at,
        last_confirmed_at: occurredAt,
      })
      break
    case 'return_assigned':
      if (!assignee) throw new WorkflowError('assignee is required when return transport is assigned')
      if (!dueAt) throw new WorkflowError('dueAt is required so the Home Store can see the return target')
      if (context.userId && !assigneeUserId) {
        throw new WorkflowError('A verified transport assignee identity is required', {
          code: 'ASSIGNEE_IDENTITY_REQUIRED',
        })
      }
      Object.assign(patch, {
        movement_status: 'return_assigned',
        transport_assignee: assignee,
        transport_assignee_user_id: assigneeUserId,
        next_action: 'Return vehicle to home store',
        next_action_owner: assignee,
        due_at: dueAt,
      })
      break
    case 'return_in_transit':
      Object.assign(patch, {
        movement_status: 'return_in_transit',
        current_location_id: 'In transit',
        current_custodian: assignee || current.transport_assignee || actor,
        next_action: 'Home manager confirms receipt',
        next_action_owner: `${home} manager`,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'returned_home':
      Object.assign(patch, {
        movement_status: 'returned_home',
        current_location_id: home,
        current_custodian: `${home} manager`,
        next_action: 'Close movement workflow',
        next_action_owner: `${home} manager`,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'closed':
      Object.assign(patch, {
        next_action: 'No further action',
        next_action_owner: null,
        closed_at: occurredAt,
        last_confirmed_at: occurredAt,
      })
      break
    case 'eta_updated':
      if (!dueAt) throw new WorkflowError('dueAt is required for an ETA update')
      Object.assign(patch, { due_at: dueAt })
      break
    case 'driver_requested':
      Object.assign(patch, {
        next_action: destination === 'Howell' ? 'Stacey assigns the driver and pickup time' : 'Requesting manager or coordinator assigns the driver',
        next_action_owner: destination === 'Howell' ? 'Stacey (Howell transport coordinator)' : `${destination} manager`,
      })
      break
    case 'note_added':
    case 'condition_issue':
    case 'location_exception':
    case 'escalated':
      break
    default:
      throw new WorkflowError('Unsupported transfer event type', { details: { eventType } })
  }

  return patch
}

export function buildTransferEvent({ current, input, context, idempotencyKey, now = new Date() }) {
  if (!current) throw new WorkflowError('Transfer request was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
  const eventType = requiredText(input?.type, 'type', 60).toLowerCase()
  requireEventPermission(eventType, context.role)
  const groupOverride = context.role === 'group_manager'
  const recordsHomeStoreDecision =
    eventType === 'approved' || (eventType === 'declined' && current.status === 'manager_reviewed')
  const homeStoreManager = recordsHomeStoreDecision
    ? requiredText(input?.homeStoreManager, 'homeStoreManager', 160)
    : null
  if (eventType === 'manager_reviewed' && !groupOverride && context.store !== current.requesting_store_id) {
    throw new WorkflowError('The requesting-store manager must review this request first', { status: 403, code: 'WRONG_STORE_ROLE' })
  }
  if (eventType === 'approved') {
    if (!groupOverride && context.store !== current.requesting_store_id) {
      throw new WorkflowError('The requesting-store manager must record the Home Store call and release decision', { status: 403, code: 'WRONG_STORE_ROLE' })
    }
  }
  if (eventType === 'declined' && !groupOverride) {
    if (context.store !== current.requesting_store_id) {
      throw new WorkflowError('Only an authorized manager in the request path may decline this request', { status: 403, code: 'WRONG_STORE_ROLE' })
    }
  }
  if (['driver_requested', 'transport_assigned', 'return_assigned'].includes(eventType) && !groupOverride && context.store !== current.requesting_store_id) {
    throw new WorkflowError('Driver coordination belongs to the requesting store', { status: 403, code: 'WRONG_STORE_ROLE' })
  }
  if (eventType === 'returned_home' && !groupOverride && context.store !== current.home_store_id) {
    throw new WorkflowError('The Home Store manager must confirm the vehicle was returned', { status: 403, code: 'WRONG_STORE_ROLE' })
  }
  if (!transitionAllowed(current.status, eventType)) {
    throw new WorkflowError(`Cannot record ${eventType} while transfer is ${current.status}`, {
      status: 409,
      code: 'INVALID_TRANSITION',
      details: {
        currentStatus: current.status,
        eventType,
        allowed: [...(TRANSITION_MAP[current.status] ?? []), ...PASSIVE_EVENTS],
      },
    })
  }
  if (input.actorRole && input.actorRole !== context.role) {
    throw new WorkflowError('actorRole must match the active role context', { status: 403, code: 'ROLE_MISMATCH' })
  }

  const actor = requiredText(context.user, 'actor', 160)
  if (input.actor && input.actor !== actor) {
    throw new WorkflowError('actor must match the authenticated user context', {
      status: 403,
      code: 'ACTOR_MISMATCH',
    })
  }
  const occurredAt = isoTimestamp(input.occurredAt, 'occurredAt') || now.toISOString()
  const storeId = storeName(context.store, 'store')
  if (input.store && storeName(input.store, 'store') !== storeId) {
    throw new WorkflowError('store must match the active store context', {
      status: 403,
      code: 'STORE_MISMATCH',
    })
  }
  if (!TRANSPORT_ASSIGNMENT_EVENTS.has(eventType) && Object.hasOwn(input, 'assigneeUserId')) {
    throw new WorkflowError('assigneeUserId is valid only for a verified transport assignment', {
      code: 'ASSIGNEE_IDENTITY_CLIENT_CONTROLLED',
    })
  }
  const event = {
    id: randomUUID(),
    eventType,
    label: EVENT_LABELS[eventType],
    actor,
    actorUserId: context.userId,
    actorRole: context.role,
    storeId,
    fromLocationId: optionalText(input.fromLocation, 'fromLocation', 120) || current.current_location_id,
    toLocationId: optionalText(input.toLocation, 'toLocation', 120),
    driverOrPorter: optionalText(input.assignee, 'assignee', 160),
    driverOrPorterUserId: TRANSPORT_ASSIGNMENT_EVENTS.has(eventType)
      ? optionalIdentity(input.assigneeUserId, 'assigneeUserId')
      : null,
    occurredAt,
    expectedArrivalAt: isoTimestamp(input.dueAt, 'dueAt'),
    confirmedBy: homeStoreManager || (PRIVILEGED_ROLES.has(context.role) ? actor : null),
    note: optionalText(input.note, 'note', 1000),
    createdAt: now.toISOString(),
    idempotencyKey: optionalText(idempotencyKey, 'Idempotency-Key', 200),
  }

  return {
    event,
    requestPatch: workflowPatch(current, eventType, input, actor, occurredAt, context),
  }
}

export const workflowInternals = Object.freeze({
  EVENT_LABELS,
  EVENT_ROLE_RULES,
  PASSIVE_EVENTS,
  ACTIVE_ONLY_PASSIVE_EVENTS,
  isoTimestamp,
  transitionAllowed,
})
