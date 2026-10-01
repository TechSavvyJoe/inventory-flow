import { STORE_NAMES } from './constants.mjs'
import { WorkflowError } from './workflow.mjs'

/**
 * Phase 1 is deliberately a read-only operational overview. There is no
 * existing capability model for employee application routes, so the current
 * cross-store group-manager role is the narrowest server-owned entitlement
 * that can safely see the directory and group-wide audit projection.
 */
export const ADMIN_OVERVIEW_ROLE = 'group_manager'
export const ADMIN_OVERVIEW_AUDIT_LIMIT = 50

const MEMBER_ROLES = new Set(['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver'])
const FEED_STATES = new Set(['current', 'stale_unverified', 'incomplete', 'unknown'])
const TRANSFER_AUDIT_ACTIVITY = Object.freeze({
  requested: 'Vehicle move requested',
  request_approved: 'Move approved by requesting store',
  request_declined: 'Move declined by requesting store',
  vehicle_departed: 'Vehicle collected from the home store',
  return_started: 'Vehicle return started',
  manager_reviewed: 'Move reviewed by requesting store',
  approved: 'Vehicle release confirmed',
  declined: 'Vehicle move declined',
  canceled: 'Vehicle move canceled',
  driver_requested: 'Driver requested',
  transport_assigned: 'Driver assigned',
  picked_up: 'Vehicle collected',
  in_transit: 'Vehicle in transit',
  arrived: 'Vehicle arrived at requesting store',
  customer_showing: 'Showing started',
  sale_outcome_pending: 'Decision or paperwork pending',
  sale_confirmed: 'Sale recorded',
  delivery_confirmed: 'Delivery confirmed',
  not_sold: 'Vehicle not sold',
  return_requested: 'Vehicle return requested',
  return_assigned: 'Return driver assigned',
  return_in_transit: 'Vehicle returning home',
  returned_home: 'Vehicle returned home',
  closed: 'Vehicle move closed',
  note_added: 'Move note added',
  eta_updated: 'Arrival time updated',
  location_exception: 'Location issue flagged',
  condition_issue: 'Vehicle condition issue flagged',
  escalated: 'Vehicle move escalated',
})
const ATTENTION_AUDIT_ACTIVITY = Object.freeze({
  acknowledge: 'Task acknowledged',
  assign: 'Assignment updated',
  start_work: 'Work started',
  wait: 'Waiting for follow-up',
  set_follow_up: 'Follow-up scheduled',
  change_priority: 'Priority changed',
  add_note: 'Task note added',
  escalate: 'Task escalated',
  resolve: 'Task resolved',
  reopen: 'Task reopened',
})
const SERVICE_AUDIT_ACTIVITY = Object.freeze({
  needs_service: 'Waiting for service',
  in_service: 'Service started',
  serviced: 'Vehicle marked ready',
})
const DISPOSITION_AUDIT_ACTIVITY = Object.freeze({
  keep: 'Disposition: keep',
  sold_pending: 'Disposition: sold pending',
  delivered: 'Disposition: delivered',
  wholesale: 'Disposition: wholesale',
  transfer_out: 'Disposition: transfer out',
})
const ATTENTION_SCOPE_LABEL = Object.freeze({
  source_freshness: 'Source feed',
  return_overdue: 'Overdue return',
  location_exception: 'Location review',
  missing_price: 'Pricing review',
  past_expected_hold: 'Hold review',
  hold_alert: 'Hold review',
  vehicle_alert: 'Vehicle alert',
  transfer_next_action: 'Vehicle move',
  manager_pending_identity_review: 'Inventory identity review',
})

function safeText(value, maxLength = 160) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return null
  return text
}

function safeTimestamp(value) {
  const timestamp = safeText(value, 80)
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null
}

function canonicalDirectoryText(value, maxLength = 160) {
  const text = safeText(value, maxLength)
  return text && text === value ? text : null
}

function safeStore(value) {
  const store = safeText(value, 40)
  return STORE_NAMES.includes(store) ? store : null
}

function safeRole(value) {
  const role = safeText(value, 40)
  return MEMBER_ROLES.has(role) ? role : null
}

function safeVin(value) {
  const vin = safeText(value, 17)
  return vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null
}

function knownFeedState(value) {
  return FEED_STATES.has(value) ? value : 'unknown'
}

function latestTimestamp(values) {
  const valid = values.map(safeTimestamp).filter(Boolean)
  return valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
}

function memberView(row) {
  const id = canonicalDirectoryText(row?.user_id)
  const name = canonicalDirectoryText(row?.name)
  const roleValue = canonicalDirectoryText(row?.role, 40)
  const homeStoreValue = canonicalDirectoryText(row?.home_store, 40)
  const role = MEMBER_ROLES.has(roleValue) ? roleValue : null
  const homeStore = STORE_NAMES.includes(homeStoreValue) ? homeStoreValue : null
  const enabled = row?.enabled
  if (!id || !name || !role || !homeStore || ![0, 1].includes(enabled)) {
    throw new WorkflowError('The server-owned employee directory is invalid.', {
      status: 503,
      code: 'ADMIN_DIRECTORY_INVALID',
    })
  }
  return {
    id,
    name,
    role,
    // Workflows already give group managers cross-store visibility. Keep that
    // established server rule visible rather than accepting a client scope.
    storeAccess: role === ADMIN_OVERVIEW_ROLE ? [...STORE_NAMES] : [homeStore],
    status: enabled === 1 ? 'active' : 'disabled',
    // No session/activity table exists in this release. Never fabricate use.
    lastActiveAt: null,
  }
}

function feedStatus(meta, hasPublicData, hasCrmData) {
  if (!hasPublicData && !hasCrmData) return 'unknown'
  if (!hasPublicData || !hasCrmData) return 'incomplete'
  const publicState = knownFeedState(meta?.publicFreshness)
  const dealerMailState = knownFeedState(meta?.dealerMailFreshness)
  if (publicState === 'incomplete' || dealerMailState === 'incomplete') return 'incomplete'
  if (publicState === 'stale_unverified' || dealerMailState === 'stale_unverified') return 'stale_unverified'
  if (publicState === 'current' && dealerMailState === 'current') return 'current'
  return 'unknown'
}

function feedIssueSummary(status, meta, hasPublicData, hasCrmData) {
  if (status === 'current') return null
  if (!hasPublicData && !hasCrmData) {
    return 'No public inventory or DealerMail records were present for this store in the current release.'
  }
  if (!hasPublicData) return 'Public inventory records were not present for this store in the current release.'
  if (!hasCrmData) return 'DealerMail records were not present for this store in the current release.'
  const publicState = knownFeedState(meta?.publicFreshness)
  const dealerMailState = knownFeedState(meta?.dealerMailFreshness)
  if (status === 'unknown' && publicState === 'unknown' && dealerMailState === 'unknown') return null
  // This is a bounded projection of authoritative state labels, not a raw
  // importer error that could contain source or customer details.
  return `Public inventory: ${publicState}; DealerMail: ${dealerMailState}`
}

function feedViews({ meta, sourceRuns, publicRows, crmRows }) {
  const publicByStore = new Map()
  const crmByStore = new Map()
  for (const row of publicRows ?? []) {
    const store = safeStore(row?.physical_store_id)
    if (store) publicByStore.set(store, (publicByStore.get(store) ?? 0) + 1)
  }
  for (const row of crmRows ?? []) {
    const store = safeStore(row?.crm_store_id)
    if (store) crmByStore.set(store, (crmByStore.get(store) ?? 0) + 1)
  }
  const lastSuccessfulAt = latestTimestamp([
    sourceRuns?.public?.extracted_at,
    sourceRuns?.public?.loaded_at,
    sourceRuns?.dealerMail?.extracted_at,
    sourceRuns?.dealerMail?.loaded_at,
  ])
  let connectedStores = 0
  const feeds = STORE_NAMES.map((store) => {
    const hasPublicData = (publicByStore.get(store) ?? 0) > 0
    const hasCrmData = (crmByStore.get(store) ?? 0) > 0
    const hasCompleteStoreData = hasPublicData && hasCrmData
    if (hasCompleteStoreData) connectedStores += 1
    const status = feedStatus(meta, hasPublicData, hasCrmData)
    return {
      store,
      status,
      lastSuccessfulAt: hasCompleteStoreData ? lastSuccessfulAt : null,
      vehicleCount: publicByStore.get(store) ?? 0,
      issueSummary: feedIssueSummary(status, meta, hasPublicData, hasCrmData),
    }
  })
  return { feeds, connectedStores }
}

function auditEntry({ kind, sourceId, occurredAt, actor, activity, scope }) {
  const safeKind = safeText(kind, 20)
  const safeSourceId = safeText(sourceId, 180)
  const safeOccurredAt = safeTimestamp(occurredAt)
  const safeActivity = safeText(activity, 220)
  const safeScope = safeText(scope, 220)
  if (!safeKind || !safeSourceId || !safeOccurredAt || !safeActivity || !safeScope) return null
  return {
    id: `${safeKind}:${safeSourceId}`,
    occurredAt: safeOccurredAt,
    actor: safeText(actor),
    activity: safeActivity,
    scope: safeScope,
    // An append-only event exists only after its transaction committed.
    result: 'recorded',
  }
}

function mappedActivity(mapping, value, fallback) {
  const key = safeText(value, 80)
  return key && Object.hasOwn(mapping, key) ? mapping[key] : fallback
}

function vehicleScope(vin, store) {
  return store ? `VIN ${vin} · ${store}` : `VIN ${vin}`
}

function attentionScope(item, store) {
  const vin = safeVin(item?.source_id)
  const sourceType = safeText(item?.source_type, 80)
  const label = vin
    ? `VIN ${vin}`
    : sourceType && Object.hasOwn(ATTENTION_SCOPE_LABEL, sourceType)
      ? ATTENTION_SCOPE_LABEL[sourceType]
      : 'Operations task'
  return store ? `${label} · ${store}` : label
}

function transferAuditEntries(transferRows, getEvents) {
  const entries = []
  for (const transfer of transferRows ?? []) {
    const vin = safeVin(transfer?.vin)
    if (!vin) continue
    for (const event of getEvents(transfer) ?? []) {
      const store = safeStore(event?.store_id)
      const entry = auditEntry({
        kind: 'transfer',
        sourceId: event?.id,
        // `occurred_at` is business time and may be supplied by the actor.
        // The control-center audit order uses the server-owned record time.
        occurredAt: event?.created_at,
        actor: event?.actor,
        activity: mappedActivity(TRANSFER_AUDIT_ACTIVITY, event?.event_type, 'Vehicle move updated'),
        scope: vehicleScope(vin, store),
      })
      if (entry) entries.push(entry)
    }
  }
  return entries
}

function attentionAuditEntries(attentionRows, getEvents) {
  const entries = []
  for (const item of attentionRows ?? []) {
    const key = safeText(item?.attention_key, 160)
    if (!key) continue
    for (const event of getEvents(item) ?? []) {
      const store = safeStore(event?.store_id)
      const entry = auditEntry({
        kind: 'attention',
        sourceId: event?.id,
        occurredAt: event?.created_at,
        actor: event?.actor,
        activity: mappedActivity(ATTENTION_AUDIT_ACTIVITY, event?.event_type, 'Operations task updated'),
        scope: attentionScope(item, store),
      })
      if (entry) entries.push(entry)
    }
  }
  return entries
}

function serviceAuditEntries(rows) {
  return (rows ?? []).map((event) => {
    const vin = safeVin(event?.vin)
    const store = safeStore(event?.store_id)
    const scope = vin ? vehicleScope(vin, store) : null
    return auditEntry({
      kind: 'service',
      sourceId: event?.id,
      // Service readiness `updated_at` is generated from the server clock.
      occurredAt: event?.updated_at,
      actor: event?.actor,
      activity: mappedActivity(SERVICE_AUDIT_ACTIVITY, event?.status, 'Service status updated'),
      scope,
    })
  }).filter(Boolean)
}

// Disposition writer names and notes belong only in disposition detail.
function dispositionAuditEntries(rows) {
  return (rows ?? []).map((event) => {
    const vin = safeVin(event?.vin)
    const store = safeStore(event?.store_id)
    return auditEntry({
      kind: 'disposition',
      sourceId: event?.id,
      // `updated_at` is generated from the server clock.
      occurredAt: event?.updated_at,
      actor: null,
      activity: mappedActivity(DISPOSITION_AUDIT_ACTIVITY, event?.disposition, 'Disposition recorded'),
      scope: vin ? vehicleScope(vin, store) : null,
    })
  }).filter(Boolean)
}

export function assertAdminOverviewAccess(context) {
  if (context?.role !== ADMIN_OVERVIEW_ROLE) {
    throw new WorkflowError('Group-manager access is required for the Admin Control Center.', {
      status: 403,
      code: 'ADMIN_OVERVIEW_ACCESS_REQUIRED',
    })
  }
}

/**
 * Maps preloaded, server-owned records into the one Phase-1 control-center
 * contract. Inputs are intentionally data, never request headers or claims.
 */
export function buildAdminOverview({
  generatedAt,
  members = [],
  meta,
  sourceRuns,
  publicRows = [],
  crmRows = [],
  transferRows = [],
  attentionRows = [],
  serviceEvents = [],
  dispositionEvents = [],
  getTransferEvents = () => [],
  getAttentionEvents = () => [],
} = {}) {
  if (!Array.isArray(members)) {
    throw new WorkflowError('The server-owned employee directory is unavailable.', {
      status: 503,
      code: 'ADMIN_DIRECTORY_UNAVAILABLE',
    })
  }
  const people = members
    .map(memberView)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  const { feeds, connectedStores } = feedViews({ meta, sourceRuns, publicRows, crmRows })
  const audit = [
    ...transferAuditEntries(transferRows, getTransferEvents),
    ...attentionAuditEntries(attentionRows, getAttentionEvents),
    ...serviceAuditEntries(serviceEvents),
    ...dispositionAuditEntries(dispositionEvents),
  ]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || left.id.localeCompare(right.id))
    .slice(0, ADMIN_OVERVIEW_AUDIT_LIMIT)
  return {
    generatedAt: safeTimestamp(generatedAt),
    readOnly: true,
    summary: {
      activeUsers: people.filter((person) => person.status === 'active').length,
      connectedStores,
      feedsCurrent: feeds.filter((feed) => feed.status === 'current').length,
      lastVerifiedAt: latestTimestamp([
        sourceRuns?.public?.extracted_at,
        sourceRuns?.public?.loaded_at,
        sourceRuns?.dealerMail?.extracted_at,
        sourceRuns?.dealerMail?.loaded_at,
        sourceRuns?.resources?.extracted_at,
        sourceRuns?.resources?.loaded_at,
        sourceRuns?.managerDisposition?.extracted_at,
        sourceRuns?.managerDisposition?.loaded_at,
      ]),
    },
    people,
    feeds,
    audit,
  }
}
