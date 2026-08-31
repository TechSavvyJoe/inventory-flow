import { randomUUID } from 'node:crypto'
import { WorkflowError } from './workflow.mjs'

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const RESOLUTION_CODES = new Set([
  'action_completed',
  'source_condition_cleared',
  'duplicate',
  'no_action_required',
  'other',
])

const ACTION_LABELS = Object.freeze({
  acknowledge: 'Acknowledged',
  assign: 'Assignment updated',
  start_work: 'Work started',
  wait: 'Waiting on follow-up',
  set_follow_up: 'Follow-up scheduled',
  change_priority: 'Priority changed',
  add_note: 'Internal note added',
  escalate: 'Escalated',
  resolve: 'Operational work resolved',
  reopen: 'Reopened',
})

const ROLE_ACTIONS = Object.freeze({
  group_manager: Object.keys(ACTION_LABELS),
  manager: Object.keys(ACTION_LABELS),
  coordinator: [
    'acknowledge',
    'assign',
    'start_work',
    'wait',
    'set_follow_up',
    'add_note',
    'escalate',
    'resolve',
    'reopen',
  ],
  sales: [
    'acknowledge',
    'assign',
    'start_work',
    'wait',
    'set_follow_up',
    'add_note',
    'escalate',
    'resolve',
    'reopen',
  ],
  porter: ['acknowledge', 'start_work', 'add_note', 'escalate', 'resolve', 'reopen'],
  driver: ['acknowledge', 'start_work', 'add_note', 'escalate', 'resolve', 'reopen'],
})

function optionalText(value, field, maxLength = 1000) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > maxLength) {
    throw new WorkflowError(`${field} must be ${maxLength} characters or fewer`, {
      details: { field, maxLength },
    })
  }
  return text
}

function requiredText(value, field, maxLength = 1000) {
  const text = optionalText(value, field, maxLength)
  if (!text) throw new WorkflowError(`${field} is required`, { details: { field } })
  return text
}

function isoTimestamp(value, field) {
  const text = optionalText(value, field, 100)
  if (!text) return null
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) throw new WorkflowError(`${field} must be a valid date and time`, { details: { field } })
  return new Date(timestamp).toISOString()
}

function itemIsLocal(item, context) {
  if (context.role === 'group_manager') return true
  const relatedStores = Array.isArray(item.relatedStores) ? item.relatedStores : []
  if (item.store) return item.store === context.store || relatedStores.includes(context.store)
  return ['manager'].includes(context.role)
}

function isTransportItem(item) {
  return ['transfer_next_action', 'return_overdue', 'location_exception'].includes(item.type)
}

export function allowedAttentionActions(item, context) {
  if (!item || !itemIsLocal(item, context)) return []
  if (['porter', 'driver'].includes(context.role) && !isTransportItem(item)) return []
  const status = item.status || 'open'
  const roleActions = ROLE_ACTIONS[context.role] ?? []
  if (status === 'resolved') return roleActions.filter((action) => ['reopen', 'add_note'].includes(action))
  return roleActions.filter((action) => action !== 'reopen')
}

function defaultPriority(item) {
  if (PRIORITIES.has(item.priority)) return item.priority
  if (item.severity === 'critical') return 'urgent'
  if (item.severity === 'warning') return 'high'
  return 'normal'
}

export function buildAttentionMutation({ sourceItem, current, input, context, idempotencyKey, now = new Date() }) {
  if (!sourceItem) throw new WorkflowError('Attention item was not found', { status: 404, code: 'ATTENTION_NOT_FOUND' })
  const eventType = requiredText(input?.type, 'type', 60).toLowerCase()
  const currentView = {
    ...sourceItem,
    status: current?.status || 'open',
    priority: current?.priority || defaultPriority(sourceItem),
  }
  const allowed = allowedAttentionActions(currentView, context)
  if (!allowed.includes(eventType)) {
    throw new WorkflowError(`Role ${context.role} cannot record ${eventType} for this item`, {
      status: 403,
      code: 'FORBIDDEN',
      details: { eventType, allowed },
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
  const note = optionalText(input.note, 'note', 1500)
  const workflow = {
    attentionKey: sourceItem.id,
    sourceType: sourceItem.type,
    sourceId: sourceItem.sourceId || sourceItem.vin || sourceItem.id,
    status: current?.status || 'open',
    priority: current?.priority || defaultPriority(sourceItem),
    assignedTo: current?.assigned_to || sourceItem.owner || null,
    assignedRole: current?.assigned_role || null,
    followUpAt: current?.follow_up_at || null,
    resolutionCode: current?.resolution_code || null,
    resolutionNote: current?.resolution_note || null,
    createdAt: current?.created_at || occurredAt,
    updatedAt: occurredAt,
    lastActor: actor,
    lastActorRole: context.role,
    lastStoreId: context.store,
  }

  const event = {
    id: randomUUID(),
    eventType,
    label: ACTION_LABELS[eventType],
    actor,
    actorRole: context.role,
    storeId: context.store,
    occurredAt,
    assignee: null,
    followUpAt: null,
    priority: null,
    resolutionCode: null,
    note,
    createdAt: now.toISOString(),
    idempotencyKey: optionalText(idempotencyKey, 'Idempotency-Key', 200),
  }

  switch (eventType) {
    case 'acknowledge':
      workflow.status = 'acknowledged'
      break
    case 'assign': {
      const assignee = requiredText(input.assignee, 'assignee', 160)
      if (context.role === 'sales' && assignee !== context.user) {
        throw new WorkflowError('Salespeople may assign an item only to themselves', { status: 403, code: 'FORBIDDEN' })
      }
      workflow.assignedTo = assignee
      workflow.assignedRole = optionalText(input.assignedRole, 'assignedRole', 60)
      event.assignee = assignee
      if (workflow.status === 'open') workflow.status = 'acknowledged'
      break
    }
    case 'start_work':
      workflow.status = 'in_progress'
      if (!workflow.assignedTo) workflow.assignedTo = actor
      break
    case 'wait':
      workflow.status = 'waiting'
      break
    case 'set_follow_up': {
      const followUpAt = isoTimestamp(input.followUpAt, 'followUpAt')
      if (!followUpAt) throw new WorkflowError('followUpAt is required', { details: { field: 'followUpAt' } })
      workflow.followUpAt = followUpAt
      event.followUpAt = followUpAt
      if (workflow.status === 'open') workflow.status = 'acknowledged'
      break
    }
    case 'change_priority': {
      const priority = String(input.priority ?? '').toLowerCase()
      if (!PRIORITIES.has(priority)) throw new WorkflowError('priority must be low, normal, high, or urgent')
      workflow.priority = priority
      event.priority = priority
      break
    }
    case 'add_note':
      requiredText(input.note, 'note', 1500)
      break
    case 'escalate':
      workflow.priority = 'urgent'
      if (workflow.status === 'open' || workflow.status === 'acknowledged') workflow.status = 'in_progress'
      event.priority = 'urgent'
      break
    case 'resolve': {
      const resolutionCode = String(input.resolutionCode ?? '').toLowerCase()
      if (!RESOLUTION_CODES.has(resolutionCode)) {
        throw new WorkflowError('resolutionCode must identify how the operational work was closed')
      }
      if (resolutionCode === 'other') requiredText(input.note, 'note', 1500)
      workflow.status = 'resolved'
      workflow.resolutionCode = resolutionCode
      workflow.resolutionNote = note
      event.resolutionCode = resolutionCode
      break
    }
    case 'reopen':
      workflow.status = 'open'
      workflow.resolutionCode = null
      workflow.resolutionNote = null
      break
    default:
      throw new WorkflowError('Unsupported attention event type', { details: { eventType } })
  }

  return { workflow, event }
}

export const attentionWorkflowInternals = Object.freeze({
  ACTION_LABELS,
  ROLE_ACTIONS,
  RESOLUTION_CODES,
  itemIsLocal,
})
