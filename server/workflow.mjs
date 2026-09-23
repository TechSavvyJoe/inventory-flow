import { randomUUID } from 'node:crypto'
import { STORE_NAMES } from './constants.mjs'

export const USER_ROLES = ['sales', 'manager', 'coordinator', 'porter', 'driver', 'group_manager']
export const PRIVILEGED_ROLES = new Set(['manager', 'group_manager'])
export const HOLD_EVIDENCE_ROLES = new Set(['sales', 'manager', 'group_manager'])

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const TRANSFER_INTENTS = new Set(['request', 'direct'])
const DIRECT_MOVE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const DIRECT_MOVE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const PASSIVE_EVENTS = new Set(['note_added', 'eta_updated', 'driver_requested', 'condition_issue', 'location_exception', 'escalated'])
const ACTIVE_ONLY_PASSIVE_EVENTS = new Set(['eta_updated', 'driver_requested', 'condition_issue', 'location_exception', 'escalated'])
const TRANSPORT_ASSIGNMENT_EVENTS = new Set(['transport_assigned', 'return_assigned'])

// Distinct events preserve the advanced audit/identity rules while the default
// interface records the same lifecycle without dispatch assignments.
const SIMPLE_EVENT_STATUS = Object.freeze({
  request_approved: 'approved',
  request_declined: 'declined',
  vehicle_departed: 'picked_up',
  return_started: 'return_in_transit',
})
const SIMPLE_EVENT_FROM = Object.freeze({
  request_approved: new Set(['requested', 'manager_reviewed']),
  request_declined: new Set(['requested', 'manager_reviewed']),
  // Retained only so a previously released integration can finish its saved
  // audit trail. The everyday interface no longer presents this as a step.
  vehicle_departed: new Set(['approved', 'transport_assigned']),
  // An approved move can be worked or returned without requiring a separate
  // collection and arrival acknowledgement from two different managers.
  return_started: new Set(['approved', 'transport_assigned', 'picked_up', 'in_transit', 'arrived', 'customer_showing', 'sale_outcome_pending', 'not_sold', 'return_requested', 'return_assigned']),
})
const SIMPLE_OUTCOME_EVENTS = new Set(['customer_showing', 'sale_outcome_pending', 'sale_confirmed', 'not_sold'])
const SIMPLE_OUTCOME_FROM = new Set(['approved', 'transport_assigned', 'picked_up', 'in_transit', 'arrived'])
const SIMPLE_PRE_DESTINATION_STATES = new Set(['approved', 'transport_assigned', 'picked_up', 'in_transit'])

// Every lifecycle transition the simple (default) mode records, listed
// explicitly. Simple mode never falls through to TRANSITION_MAP: the advanced
// dispatch events (manager_reviewed, approved, declined, transport_assigned,
// picked_up, in_transit, return_requested, return_assigned, return_in_transit)
// are refused here even though legacy rows may still sit in those states and
// finish through the simple events below. Passive events are checked apart.
function simpleTransitionTable() {
  const table = new Map()
  const add = (from, events) => {
    if (!table.has(from)) table.set(from, new Set())
    for (const event of events) table.get(from).add(event)
  }
  for (const [event, states] of Object.entries(SIMPLE_EVENT_FROM)) for (const from of states) add(from, [event])
  for (const from of SIMPLE_OUTCOME_FROM) add(from, SIMPLE_OUTCOME_EVENTS)
  // The outcome chain once the vehicle is being shown.
  add('customer_showing', ['sale_outcome_pending', 'sale_confirmed', 'not_sold'])
  add('sale_outcome_pending', ['sale_confirmed', 'not_sold'])
  // A sold-pending vehicle waits for delivery; only a manager unwinds it.
  add('sale_confirmed', ['delivery_confirmed', 'not_sold'])
  add('delivery_confirmed', ['closed'])
  // Cancellation before the vehicle leaves its home store.
  for (const from of ['requested', 'manager_reviewed', 'approved', 'transport_assigned']) add(from, ['canceled'])
  // The return trip ends with the Home Store's receipt.
  add('return_in_transit', ['returned_home'])
  add('returned_home', ['closed'])
  // Legacy simple-ledger rows may still record an arrival after a departure.
  add('picked_up', ['arrived'])
  add('in_transit', ['arrived'])
  return Object.freeze(Object.fromEntries(table))
}
export const SIMPLE_TRANSITIONS = simpleTransitionTable()

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
  // A sold-pending vehicle waits for its customer delivery; the return path
  // reopens only when a manager records that the deal fell through.
  sale_confirmed: new Set(['delivery_confirmed', 'not_sold']),
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
  requested: 'Move requested',
  direct_move_recorded: 'Vehicle moved to destination store',
  request_approved: 'Requesting-store manager approved the move and confirmed the vehicle was free',
  request_declined: 'Requesting-store manager declined the request',
  vehicle_departed: 'Vehicle collected from the home store',
  return_started: 'Vehicle returning to the home store',
  manager_reviewed: 'Requesting-store manager approved · home store still to call',
  approved: 'Home store confirmed the vehicle is free and released it',
  declined: 'Request declined',
  canceled: 'Request canceled',
  transport_assigned: 'Driver assigned',
  picked_up: 'Vehicle collected',
  in_transit: 'Vehicle in transit',
  arrived: 'Vehicle arrived at requesting store',
  customer_showing: 'Showing in progress',
  sale_outcome_pending: 'Decision or paperwork pending',
  sale_confirmed: 'Sold pending recorded in Inventory Flow',
  delivery_confirmed: 'Delivery explicitly confirmed in Inventory Flow',
  not_sold: 'Shown · not sold',
  return_requested: 'Return to home store requested',
  return_assigned: 'Return driver assigned',
  return_in_transit: 'Vehicle returning to home store',
  returned_home: 'Home store confirmed the vehicle is back',
  closed: 'Move closed',
  note_added: 'Note added',
  eta_updated: 'Due time updated',
  driver_requested: 'Driver requested',
  location_exception: 'Location issue reported',
  condition_issue: 'Vehicle condition issue reported',
  escalated: 'Move escalated for manager attention',
})

const EVENT_ROLE_RULES = Object.freeze({
  request_approved: new Set(['manager', 'group_manager']),
  request_declined: new Set(['manager', 'group_manager']),
  vehicle_departed: new Set(['sales', 'manager', 'group_manager']),
  return_started: new Set(['sales', 'manager', 'group_manager']),
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

// A timestamp without an explicit zone (a raw datetime-local value, or a bare
// date) would be read in the server's zone, which is UTC on the hosted Worker
// and Eastern on the dealership host. Require the instant to be unambiguous.
const ZONED_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i

function isoTimestamp(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new WorkflowError(`${field} is required`, { details: { field } })
    return null
  }
  const parsed = typeof value === 'string' && ZONED_ISO_TIMESTAMP.test(value.trim()) ? new Date(value.trim()) : new Date(NaN)
  if (Number.isNaN(parsed.valueOf())) {
    throw new WorkflowError(`${field} must be an ISO timestamp with an explicit timezone`, { details: { field } })
  }
  return parsed.toISOString()
}

export function roleContext({
  role,
  store,
  user,
  userId,
  authenticatedRole,
  authenticatedStore,
  allowLegacyTransportAssignmentByName = false,
} = {}) {
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
  const authorityRole = authenticatedRole ?? role
  if (!USER_ROLES.includes(authorityRole) || (authorityRole !== role && authorityRole !== 'group_manager')) {
    throw new WorkflowError('A valid authenticated authority role is required', {
      status: 401,
      code: 'AUTH_CONTEXT_INVALID',
      details: { field: 'authenticatedRole' },
    })
  }
  const authorityStore = authenticatedStore ?? store
  if (!STORE_NAMES.includes(authorityStore) || (authorityStore !== store && authorityRole !== 'group_manager')) {
    throw new WorkflowError('A valid authenticated authority store is required', {
      status: 401,
      code: 'AUTH_CONTEXT_INVALID',
      details: { field: 'authenticatedStore' },
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
    authenticatedRole: authorityRole,
    authenticatedStore: authorityStore,
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

  const intent = String(input?.intent ?? 'request').trim().toLowerCase()
  if (!TRANSFER_INTENTS.has(intent)) {
    throw new WorkflowError('intent must be request or direct', { details: { field: 'intent' } })
  }
  const direct = intent === 'direct'
  const actorStoreId = context.store
  if (input.requestingStore && storeName(input.requestingStore, 'requestingStore') !== actorStoreId) {
    throw new WorkflowError('requestingStore must match the active store context', {
      status: 403,
      code: 'STORE_MISMATCH',
    })
  }
  const sourceStore = vehicle.homeAssignment?.home_store_id || vehicle.movementHomeStore || vehicle.publicRecord?.store || vehicle.crmRecord?.storeName
  const homeStoreId = storeName(sourceStore, 'homeStore')
  const authoritativeMovementLocation = String(
    vehicle.movementCurrentLocation || vehicle.movementCurrentStore || '',
  ).trim()
  if (direct && authoritativeMovementLocation &&
      !STORE_NAMES.includes(authoritativeMovementLocation) && authoritativeMovementLocation !== 'In transit') {
    throw new WorkflowError('The vehicle current location must be resolved before it can be moved directly', {
      status: 409,
      code: 'LOCATION_CONFLICT',
      details: { currentLocation: authoritativeMovementLocation },
    })
  }
  const directOriginStoreId = direct && authoritativeMovementLocation
    ? authoritativeMovementLocation
    : homeStoreId
  const destinationStoreId = direct
    ? storeName(input.destinationStore, 'destinationStore')
    : actorStoreId
  if (!direct && input.destinationStore && storeName(input.destinationStore, 'destinationStore') !== actorStoreId) {
    throw new WorkflowError('Move requests can only bring a vehicle into the active store', {
      status: 403,
      code: 'STORE_MISMATCH',
    })
  }
  if (destinationStoreId === (direct ? directOriginStoreId : homeStoreId) &&
      !(direct && vehicle.existingMoveBlocked)) {
    throw new WorkflowError(direct
      ? 'Destination store must be different from the vehicle current location'
      : 'A cross-store request must use a different requesting store', {
      details: {
        homeStore: homeStoreId,
        ...(direct ? { currentLocation: directOriginStoreId } : {}),
        destinationStore: destinationStoreId,
      },
    })
  }
  if (direct && !PRIVILEGED_ROLES.has(context.role)) {
    throw new WorkflowError('Only a manager can directly move a vehicle', { status: 403, code: 'FORBIDDEN' })
  }
  if (direct && context.role === 'manager' && actorStoreId !== homeStoreId) {
    throw new WorkflowError('A store manager can only directly move a vehicle owned by their store', {
      status: 403,
      code: 'WRONG_STORE_ROLE',
      details: { homeStore: homeStoreId, managerStore: actorStoreId },
    })
  }
  if (!direct && !['sales', 'manager'].includes(context.role)) {
    throw new WorkflowError('Only salespeople and store managers can create move requests', {
      status: 403,
      code: 'FORBIDDEN',
    })
  }

  const requestedBy = requiredText(context.user, 'requestedBy', 160)
  if (input.requestedBy && input.requestedBy !== requestedBy) {
    throw new WorkflowError('requestedBy must match the authenticated user context', {
      status: 403,
      code: 'ACTOR_MISMATCH',
    })
  }
  const neededBy = isoTimestamp(input.neededBy, 'neededBy', { required: !direct })
  const returnDueAt = isoTimestamp(input.returnDueAt, 'returnDueAt')
  const reason = requiredText(input.reason, 'reason', 1000)
  const customerReference = optionalText(input.customerReference, 'customerReference', 500)
  const priority = PRIORITIES.has(input.priority) ? input.priority : 'normal'
  const requestedAt = now.toISOString()
  const movedAt = direct ? (isoTimestamp(input.movedAt, 'movedAt') || requestedAt) : null
  if (direct) {
    const movedTime = Date.parse(movedAt)
    const nowTime = now.valueOf()
    if (movedTime > nowTime + DIRECT_MOVE_FUTURE_TOLERANCE_MS) {
      throw new WorkflowError('movedAt cannot be materially in the future', {
        details: { field: 'movedAt', futureToleranceMinutes: 5 },
      })
    }
    if (movedTime < nowTime - DIRECT_MOVE_MAX_AGE_MS) {
      throw new WorkflowError('movedAt cannot be more than 90 days ago', {
        details: { field: 'movedAt', maximumBackdateDays: 90 },
      })
    }
  }
  const returnBoundary = direct ? movedAt : neededBy
  if (returnDueAt && returnBoundary && Date.parse(returnDueAt) <= Date.parse(returnBoundary)) {
    throw new WorkflowError(`returnDueAt must be later than ${direct ? 'movedAt' : 'neededBy'}`, {
      details: { field: 'returnDueAt', after: direct ? 'movedAt' : 'neededBy' },
    })
  }
  const vehicleName = String(
    vehicle.publicRecord?.vehicle_name ||
      [vehicle.crmRecord?.yearRaw, vehicle.crmRecord?.makeRaw, vehicle.crmRecord?.modelRaw, vehicle.crmRecord?.seriesRaw]
        .filter(Boolean)
        .join(' '),
  ).trim()
  const stockAtRequest = String(vehicle.publicRecord?.stock_number || vehicle.crmRecord?.stockNumber || '').trim()
  const requestingStoreId = destinationStoreId
  const approvalOwner = direct ? null : (optionalText(input.approvalOwner, 'approvalOwner', 160) || `${requestingStoreId} manager`)
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
    approvedBy: direct ? requestedBy : null,
    priority,
    status: direct ? 'arrived' : 'requested',
    movementStatus: direct ? 'at_requesting_store' : 'at_home',
    dealStatus: 'not_confirmed',
    deliveryStatus: 'not_confirmed',
    currentLocationId: direct ? destinationStoreId : homeStoreId,
    currentCustodian: null,
    transportAssignee: null,
    transportAssigneeUserId: null,
    nextAction: direct ? 'Record the showing outcome, or start the return' : 'Check the vehicle is free, then approve this move',
    nextActionOwner: direct ? `${destinationStoreId} sales` : approvalOwner,
    dueAt: direct ? returnDueAt : neededBy,
    returnRequired: input.returnRequired !== false,
    returnDueAt,
    // A standard request is operational intent, not a sighting. A direct move
    // is different: the authorized manager is explicitly recording the
    // destination and movement time, so that physical event starts the
    // confirmation clock immediately.
    lastConfirmedAt: direct ? movedAt : null,
    locationConfidence: direct ? 'verified' : 'reported',
    closedAt: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    idempotencyKey: optionalText(idempotencyKey, 'Idempotency-Key', 200),
  }

  const initialEvent = {
    id: randomUUID(),
    eventType: direct ? 'direct_move_recorded' : 'requested',
    label: direct ? EVENT_LABELS.direct_move_recorded : EVENT_LABELS.requested,
    actor: requestedBy,
    actorUserId: context.userId,
    actorRole: context.authenticatedRole || context.role,
    storeId: actorStoreId,
    fromLocationId: direct ? directOriginStoreId : homeStoreId,
    toLocationId: requestingStoreId,
    occurredAt: direct ? movedAt : requestedAt,
    note: null,
    createdAt: requestedAt,
    idempotencyKey: request.idempotencyKey ? `${request.idempotencyKey}:${direct ? 'direct_move_recorded' : 'requested'}` : null,
  }

  return { request, initialEvent }
}

function eventRoleAllowed(eventType, role, workflowMode) {
  // Existing simple-ledger rows may retain an old arrival entry. Keep that
  // historical reconciliation path valid without exposing it as a new UI step.
  if (workflowMode === 'simple' && eventType === 'arrived' && role === 'sales') return true
  return EVENT_ROLE_RULES[eventType]?.has(role) === true
}

function requireEventPermission(eventType, role, workflowMode) {
  const allowed = EVENT_ROLE_RULES[eventType]
  if (!allowed) throw new WorkflowError('Unsupported move event type', { details: { eventType } })
  if (!eventRoleAllowed(eventType, role, workflowMode)) {
    throw new WorkflowError(`Role ${role} cannot record ${eventType}`, {
      status: 403,
      code: 'FORBIDDEN',
      details: { eventType, role },
    })
  }
}

// A manager confirmed the sale; only a manager may record that it fell through.
function saleUnwindRestricted(currentStatus, eventType, role) {
  return eventType === 'not_sold' && currentStatus === 'sale_confirmed' && !PRIVILEGED_ROLES.has(role)
}

function passiveTransitionAllowed(currentStatus, eventType) {
  if (eventType === 'driver_requested') return currentStatus === 'approved'
  if (ACTIVE_ONLY_PASSIVE_EVENTS.has(eventType) && ['declined', 'canceled', 'closed'].includes(currentStatus)) return false
  return true
}

function lifecycleTransitions(currentStatus, workflowMode) {
  return (workflowMode === 'simple' ? SIMPLE_TRANSITIONS : TRANSITION_MAP)[currentStatus] ?? new Set()
}

function transitionAllowed(currentStatus, eventType, workflowMode = 'advanced') {
  if (PASSIVE_EVENTS.has(eventType)) return passiveTransitionAllowed(currentStatus, eventType)
  return lifecycleTransitions(currentStatus, workflowMode).has(eventType)
}

export function allowedEventTypes(currentStatus, role, workflowMode = 'advanced') {
  if (!USER_ROLES.includes(role)) return []
  const candidates = new Set([...lifecycleTransitions(currentStatus, workflowMode), ...PASSIVE_EVENTS])
  return [...candidates].filter(
    (eventType) =>
      eventRoleAllowed(eventType, role, workflowMode) &&
      transitionAllowed(currentStatus, eventType, workflowMode) &&
      !saleUnwindRestricted(currentStatus, eventType, role),
  )
}

function workflowPatch(current, eventType, input, actor, occurredAt, context, recordedAt = occurredAt) {
  const destination = current.destination_store_id
  const home = current.home_store_id
  const assignee = optionalText(input.assignee, 'assignee', 160)
  const assigneeUserId = optionalIdentity(input.assigneeUserId, 'assigneeUserId')
  const dueAt = isoTimestamp(input.dueAt, 'dueAt')
  const patch = {
    status: PASSIVE_EVENTS.has(eventType) ? current.status : (SIMPLE_EVENT_STATUS[eventType] ?? eventType),
    // Ledger recency follows the server clock; occurredAt is the actor's
    // business time and is kept on the event and confirmation fields.
    updated_at: recordedAt,
  }

  switch (eventType) {
    case 'request_approved':
      Object.assign(patch, {
        approved_by: actor,
        next_action: 'Show the vehicle, then start its return',
        next_action_owner: current.requested_by || `${destination} sales`,
      })
      break
    case 'vehicle_departed':
      Object.assign(patch, {
        movement_status: 'picked_up',
        current_location_id: 'In transit',
        current_custodian: null,
        next_action: `Confirm the vehicle arrived at ${destination}`,
        next_action_owner: `${destination} sales`,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'return_started':
      Object.assign(patch, {
        movement_status: 'return_in_transit',
        current_location_id: 'In transit',
        current_custodian: null,
        next_action: `Confirm the vehicle is back at ${home}`,
        next_action_owner: `${home} manager`,
        due_at: dueAt || current.return_due_at,
        return_due_at: dueAt || current.return_due_at,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'manager_reviewed':
      Object.assign(patch, {
        next_action: `Call the ${home} used-car manager and record the answer`,
        next_action_owner: current.approval_owner || `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'approved':
      Object.assign(patch, {
        approved_by: actor,
        next_action: destination === 'Howell' ? 'Ask Stacey for a driver' : 'Ask your manager or coordinator for a driver',
        next_action_owner: current.requested_by || `${destination} sales`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'declined':
    case 'request_declined':
    case 'canceled':
      Object.assign(patch, {
        next_action: 'No further action',
        next_action_owner: null,
        closed_at: occurredAt,
        last_confirmed_at: occurredAt,
      })
      break
    case 'transport_assigned':
      if (!assignee) throw new WorkflowError('Name the assigned driver so staff know who has the vehicle.')
      if (!dueAt) throw new WorkflowError('Set a pickup time so the requesting store knows when the driver is coming.')
      if (context.userId && !assigneeUserId) {
        throw new WorkflowError('A verified transport assignee identity is required', {
          code: 'ASSIGNEE_IDENTITY_REQUIRED',
        })
      }
      Object.assign(patch, {
        movement_status: 'transport_assigned',
        transport_assignee: assignee,
        transport_assignee_user_id: assigneeUserId,
        next_action: 'Collect the vehicle and confirm you have it',
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
        next_action: `Confirm the vehicle arrived at ${destination}`,
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
        next_action: 'Record the showing outcome',
        next_action_owner: `${destination} sales`,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'customer_showing':
      Object.assign(patch, {
        deal_status: 'customer_showing',
        next_action: 'Record the sale outcome',
        next_action_owner: actor,
        last_confirmed_at: occurredAt,
      })
      break
    case 'sale_outcome_pending':
      Object.assign(patch, {
        deal_status: 'pending_confirmation',
        next_action: 'Confirm the sale, or start the return',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'sale_confirmed':
      Object.assign(patch, {
        deal_status: 'sold_pending',
        next_action: 'Confirm delivery, or record the deal fell through',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'delivery_confirmed':
      Object.assign(patch, {
        delivery_status: 'delivery_confirmed',
        next_action: 'Close the move',
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'not_sold':
      Object.assign(patch, {
        deal_status: 'not_sold',
        // A deal that fell through after a sold-pending record leaves no
        // delivery behind; the row must not keep reading as sold.
        delivery_status: 'not_confirmed',
        next_action: `Start the return to ${home}`,
        next_action_owner: `${destination} manager`,
        last_confirmed_at: occurredAt,
      })
      break
    case 'return_requested':
      Object.assign(patch, {
        movement_status: 'return_requested',
        next_action: destination === 'Howell' ? 'Ask Stacey for a return driver' : 'Assign the return driver',
        next_action_owner: destination === 'Howell' ? 'Stacey (Howell transport coordinator)' : `${destination} manager`,
        due_at: dueAt || current.return_due_at,
        last_confirmed_at: occurredAt,
      })
      break
    case 'return_assigned':
      if (!assignee) throw new WorkflowError('Name the return driver so staff know who has the vehicle.')
      if (!dueAt) throw new WorkflowError('Set a return time so the home store knows when to expect the vehicle.')
      if (context.userId && !assigneeUserId) {
        throw new WorkflowError('A verified transport assignee identity is required', {
          code: 'ASSIGNEE_IDENTITY_REQUIRED',
        })
      }
      Object.assign(patch, {
        movement_status: 'return_assigned',
        transport_assignee: assignee,
        transport_assignee_user_id: assigneeUserId,
        next_action: `Drive the vehicle back to ${home}`,
        next_action_owner: assignee,
        due_at: dueAt,
      })
      break
    case 'return_in_transit':
      Object.assign(patch, {
        movement_status: 'return_in_transit',
        current_location_id: 'In transit',
        current_custodian: assignee || current.transport_assignee || actor,
        next_action: `Confirm the vehicle is back at ${home}`,
        next_action_owner: `${home} manager`,
        last_confirmed_at: occurredAt,
        location_confidence: 'verified',
      })
      break
    case 'returned_home':
      Object.assign(patch, {
        ...(context.workflowMode === 'simple' ? { status: 'closed', closed_at: occurredAt } : {}),
        movement_status: 'returned_home',
        current_location_id: home,
        current_custodian: `${home} manager`,
        next_action: context.workflowMode === 'simple' ? 'No further action' : 'Close the move',
        next_action_owner: context.workflowMode === 'simple' ? null : `${home} manager`,
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
      if (!dueAt) throw new WorkflowError('Set the new due time before saving this update.')
      Object.assign(patch, { due_at: dueAt })
      break
    case 'driver_requested':
      Object.assign(patch, {
        next_action: 'Assign a driver and a pickup time',
        next_action_owner: destination === 'Howell' ? 'Stacey (Howell transport coordinator)' : `${destination} manager`,
      })
      break
    case 'note_added':
    case 'condition_issue':
    case 'location_exception':
    case 'escalated':
      break
    default:
      throw new WorkflowError('Unsupported move event type', { details: { eventType } })
  }

  // The simplified UI deliberately removed the unreliable pickup/arrival
  // chores. A destination-side outcome is therefore authoritative proof that
  // the vehicle reached the requesting store when no earlier arrival exists.
  if (context.workflowMode === 'simple' && SIMPLE_OUTCOME_EVENTS.has(eventType) &&
      SIMPLE_PRE_DESTINATION_STATES.has(current.status)) {
    Object.assign(patch, {
      movement_status: 'at_requesting_store',
      current_location_id: destination,
      current_custodian: actor,
      last_confirmed_at: occurredAt,
      location_confidence: 'verified',
    })
  }

  return patch
}

export function buildTransferEvent({ current, input, context, idempotencyKey, now = new Date() }) {
  if (!current) throw new WorkflowError('That vehicle move was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
  const eventType = requiredText(input?.type, 'type', 60).toLowerCase()
  requireEventPermission(eventType, context.role, context.workflowMode)
  if (saleUnwindRestricted(current.status, eventType, context.role)) {
    throw new WorkflowError('Only a manager can record that a confirmed sale fell through', { status: 403, code: 'FORBIDDEN' })
  }
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
  if (eventType === 'request_approved') {
    if (!groupOverride && context.store !== current.requesting_store_id) {
      throw new WorkflowError('Only the requesting-store manager can approve this request', { status: 403, code: 'WRONG_STORE_ROLE' })
    }
    if (input?.availabilityConfirmed !== true) {
      throw new WorkflowError('Confirm that you checked with the home store and the vehicle is available for this move', {
        code: 'AVAILABILITY_CONFIRMATION_REQUIRED',
      })
    }
  }
  if (eventType === 'request_declined') {
    if (!groupOverride && context.store !== current.requesting_store_id) {
      throw new WorkflowError('Only the requesting-store manager can decline this request', { status: 403, code: 'WRONG_STORE_ROLE' })
    }
    requiredText(input?.note, 'decline reason', 1000)
  }
  if (context.workflowMode === 'simple' &&
      (['arrived', 'return_started'].includes(eventType) || SIMPLE_OUTCOME_EVENTS.has(eventType)) &&
      ['sales', 'manager'].includes(context.role) && context.store !== current.requesting_store_id) {
    throw new WorkflowError('The requesting store must confirm this location update', { status: 403, code: 'WRONG_STORE_ROLE' })
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
  if (!transitionAllowed(current.status, eventType, context.workflowMode)) {
    throw new WorkflowError(`Cannot record ${eventType} while transfer is ${current.status}`, {
      status: 409,
      code: 'INVALID_TRANSITION',
      details: {
        currentStatus: current.status,
        eventType,
        allowed: [...lifecycleTransitions(current.status, context.workflowMode), ...PASSIVE_EVENTS],
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
  const occurredTime = Date.parse(occurredAt)
  // occurredAt becomes the move's last confirmed location time. Bound it the
  // same way as a direct move's movedAt: a far-future value would otherwise
  // block every later move of that vehicle through the chronology check.
  if (occurredTime > now.valueOf() + DIRECT_MOVE_FUTURE_TOLERANCE_MS) {
    throw new WorkflowError('occurredAt cannot be materially in the future', {
      details: { field: 'occurredAt', futureToleranceMinutes: 5 },
    })
  }
  if (occurredTime < now.valueOf() - DIRECT_MOVE_MAX_AGE_MS) {
    throw new WorkflowError('occurredAt cannot be more than 90 days ago', {
      details: { field: 'occurredAt', maximumBackdateDays: 90 },
    })
  }
  const storeId = storeName(context.store, 'store')
  const simpleOutcomeEstablishesDestination = context.workflowMode === 'simple' &&
    SIMPLE_OUTCOME_EVENTS.has(eventType) && SIMPLE_PRE_DESTINATION_STATES.has(current.status)
  const simpleReturnEstablishesDestination = context.workflowMode === 'simple' &&
    eventType === 'return_started' && SIMPLE_PRE_DESTINATION_STATES.has(current.status)
  if (context.workflowMode === 'simple' && Object.hasOwn(SIMPLE_EVENT_STATUS, eventType) &&
      Object.hasOwn(input, 'fromLocation') &&
      optionalText(input.fromLocation, 'fromLocation', 120) !== current.current_location_id) {
    throw new WorkflowError('fromLocation must match the current vehicle location shown for this move', {
      status: 409,
      code: 'LOCATION_MISMATCH',
    })
  }
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
    label: eventType === 'returned_home' && context.workflowMode === 'simple'
      ? 'Home store confirmed the vehicle is back · move complete'
      // The same event unwinds a sold-pending deal or closes a plain showing;
      // the history row names which one happened.
      : eventType === 'not_sold' && current.status === 'sale_confirmed'
        ? 'Deal fell through · not sold'
        : EVENT_LABELS[eventType],
    actor,
    actorUserId: context.userId,
    actorRole: context.authenticatedRole || context.role,
    storeId,
    fromLocationId: simpleReturnEstablishesDestination
      ? current.destination_store_id
      : Object.hasOwn(SIMPLE_EVENT_STATUS, eventType)
        ? current.current_location_id
        : optionalText(input.fromLocation, 'fromLocation', 120) || current.current_location_id,
    toLocationId: simpleOutcomeEstablishesDestination
      ? current.destination_store_id
      : ['vehicle_departed', 'return_started'].includes(eventType)
        ? 'In transit'
        : ['request_approved', 'request_declined'].includes(eventType)
          ? current.current_location_id
          : optionalText(input.toLocation, 'toLocation', 120),
    driverOrPorter: Object.hasOwn(SIMPLE_EVENT_STATUS, eventType) ? null : optionalText(input.assignee, 'assignee', 160),
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
    requestPatch: workflowPatch(current, eventType, input, actor, occurredAt, context, now.toISOString()),
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
