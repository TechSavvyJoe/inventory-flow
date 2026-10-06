import { createHash } from 'node:crypto'
import {
  appendTransferEvent,
  getAttentionEvents,
  getAttentionWorkflowRow,
  getCurrentDataset,
  getTransferEvents,
  getTransferRow,
  insertTransferRequest,
  supersedeTransferRequest,
  listAttentionWorkflowRows,
  listTransferRows,
  upsertAttentionWorkflow,
  createRepositoryContext,
  listServiceEvents,
  insertServiceEvent,
  manualHoldsEnabled, listManualHoldEvents, insertManualHoldEvent,
  dispositionsEnabled,
  listDispositionEvents,
  insertDispositionEvent,
  vehicleIssuesEnabled,
  listVehicleIssueRows,
  listVehicleIssueEvents,
  insertVehicleIssue,
  appendVehicleIssueEvent,
  savedVehicleListsEnabled,
  listSavedVehicleLists as listSavedVehicleListRows,
  mutateSavedVehicleList as persistSavedVehicleListMutation,
} from './repository-dispatch.mjs'
import { buildServiceReadinessEvent, serviceReadinessView } from './service-readiness.mjs'
import { buildManualHoldEvent, manualHoldDetail, manualHoldView, inventoryDecision } from './manual-holds.mjs'
import { buildDispositionEvent, dispositionDetail, dispositionView } from './vehicle-disposition.mjs'
import { buildVehicleIssue, buildVehicleIssueEvent, canReportVehicleIssue, vehicleIssueView, VEHICLE_ISSUE_CATEGORIES, VEHICLE_ISSUE_STATUSES } from './vehicle-issues.mjs'
import { allowedAttentionActions, attentionInputHash, buildAttentionMutation, canSeePersistedAssignee, isTransportItem } from './attention-workflow.mjs'
import { assertAdminOverviewAccess, buildAdminOverview } from './admin-control-center.mjs'
import { STORE_NAMES } from './constants.mjs'
import { dateInTimeZone, dateIsBeforeReport, daysBetween } from './calendar-days.mjs'
import { buildOverviewSummary, overviewAccess } from './overview-summary.mjs'
import { normalizePublicChangeCounts } from './public-change-counts.mjs'
import { MANAGER_DISPOSITION_COVERAGE_CAVEAT } from './manager-disposition-schema.mjs'
import { allowedEventTypes, buildTransferEvent, buildTransferRequest, roleContext, WorkflowError } from './workflow.mjs'
import { normalizeSavedListMutation, savedListOwnerId, savedListView } from './saved-vehicle-lists.mjs'

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const TERMINAL_TRANSFER_STATES = new Set(['declined', 'canceled', 'closed'])
const RETURN_COMPLETE_STATES = new Set(['returned_home', 'closed'])
// A sold-pending vehicle is waiting on its customer delivery, not on a trip
// home, so its return clock is paused until a manager records the deal fell
// through (not_sold) and the return path reopens.
const RETURN_PAUSED_STATES = new Set(['sale_confirmed', 'delivery_confirmed'])
const SIMPLE_DESTINATION_CUSTODY_EVENTS = new Set(['customer_showing', 'sale_outcome_pending', 'sale_confirmed', 'not_sold'])
const ACTIVE_TRANSPORT_ASSIGNMENT_STATES = new Set([
  'transport_assigned',
  'picked_up',
  'in_transit',
  'return_assigned',
  'return_in_transit',
])

function parseJson(value, fallback = null) {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function cleanText(value) {
  const text = String(value ?? '').trim()
  return text || undefined
}

function normalizedTimestamp(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString()
}

function transferEventLocationBefore(replay, current, events) {
  let location = current.home_store_id
  const replayIndex = events.findIndex((event) => event.id === replay.id)
  if (replayIndex < 0) return undefined
  for (const event of events.slice(0, replayIndex)) {
    const recordsPhysicalLocation = [
      'direct_move_recorded', 'vehicle_departed', 'picked_up', 'in_transit', 'arrived',
      'return_started', 'return_in_transit', 'returned_home',
    ].includes(event.event_type) ||
      (SIMPLE_DESTINATION_CUSTODY_EVENTS.has(event.event_type) && event.to_location_id === current.destination_store_id)
    if (recordsPhysicalLocation && cleanText(event.to_location_id)) location = cleanText(event.to_location_id)
  }
  return location
}

function transferEventReplayPayloadMatches(replay, input, context, current, events) {
  const expectedOccurredAt = normalizedTimestamp(input?.occurredAt)
  if (expectedOccurredAt === undefined) return false
  if (expectedOccurredAt !== null && replay.occurred_at !== expectedOccurredAt) return false
  // An omitted occurredAt is replayable only when the original event used its
  // server creation time. This distinguishes an explicit historical timestamp.
  if (expectedOccurredAt === null && replay.occurred_at !== replay.created_at) return false
  if ((replay.note ?? null) !== (cleanText(input?.note) ?? null)) return false
  if ((replay.expected_arrival_at ?? null) !== normalizedTimestamp(input?.dueAt)) return false
  if ((replay.driver_or_porter ?? null) !== (cleanText(input?.assignee) ?? null)) return false
  if ((replay.driver_or_porter_user_id ?? null) !== (cleanText(input?.assigneeUserId) ?? null)) return false
  if (Object.hasOwn(input ?? {}, 'fromLocation')) {
    const inputFrom = cleanText(input.fromLocation) ?? null
    // Starting a simple return before an explicit arrival proves destination
    // custody. The immutable audit stores that canonical physical origin, but
    // the browser retry contains the location displayed before the action.
    // Reconstruct that pre-event value so a lost-response retry is stable.
    const expectedInputFrom = context.workflowMode === 'simple' &&
      replay.event_type === 'return_started' && replay.to_location_id === 'In transit'
      ? transferEventLocationBefore(replay, current, events)
      : replay.from_location_id
    if ((expectedInputFrom ?? null) !== inputFrom) return false
  }
  if (Object.hasOwn(input ?? {}, 'toLocation') &&
      (replay.to_location_id ?? null) !== (cleanText(input.toLocation) ?? null)) return false
  if (Object.hasOwn(input ?? {}, 'homeStoreManager') &&
      (replay.confirmed_by ?? null) !== (cleanText(input.homeStoreManager) ?? null)) return false
  if (replay.event_type === 'request_approved' && input?.availabilityConfirmed !== true) return false
  if (input?.actor && input.actor !== context.user) return false
  if (input?.actorRole && input.actorRole !== context.role) return false
  if (input?.store && input.store !== context.store) return false
  return true
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveInteger(value) {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? Math.trunc(number) : undefined
}

function publicScanAudit(publicRecord) {
  if (!publicRecord) return undefined
  const rawVehicleId = finiteNumber(publicRecord.vehicle_id)
  const sourceSites = Array.isArray(publicRecord.source_sites)
    ? publicRecord.source_sites.map(cleanText).filter(Boolean)
    : [cleanText(publicRecord.source_sites)].filter(Boolean)
  return {
    actualLocation: cleanText(publicRecord.actual_location) ?? null,
    locationCity: cleanText(publicRecord.location_city) ?? null,
    dealerLocationId: finiteNumber(publicRecord.dealer_location_id),
    dealerName: cleanText(publicRecord.dealer_name) ?? null,
    vehicleId: rawVehicleId === 0 ? null : rawVehicleId,
    genericColor: cleanText(publicRecord.generic_color) ?? null,
    sourceSites,
    sourceCount: positiveInteger(publicRecord.source_count) ?? null,
    firstSeen: cleanText(publicRecord.first_seen) ?? null,
    lastSeen: cleanText(publicRecord.last_seen) ?? null,
  }
}

function currentFreshness(sourceRun, { now, timeZone, loadStatus }) {
  if (!sourceRun) return 'unknown'
  if (sourceRun.status === 'incomplete') return 'incomplete'
  if (loadStatus?.error) return 'stale_unverified'
  const today = dateInTimeZone(now, timeZone)
  if (sourceRun.report_date !== today || sourceRun.status === 'stale_unverified') return 'stale_unverified'
  return 'current'
}

function buildIndexes(dataset) {
  const publicByVin = new Map(dataset.publicRows.map((row) => [row.vin, row]))
  const crmByVin = new Map(dataset.crmRows.map((row) => [row.vin, row]))
  const holdByVin = new Map(dataset.holdRows.map((row) => [row.vin, row]))
  const resourceByVin = new Map((dataset.resourceRows ?? []).map((row) => [row.vin, row]))
  const homeByVin = new Map(dataset.homeAssignments.map((row) => [row.vin, row]))
  const releasedHistoryByVin = new Map((parseJson(dataset.state.current_released_hold_history_json, []) ?? [])
    .map((row) => [String(row.vin ?? '').trim().toUpperCase(), row]))
  const managerDispositionOverlay = parseJson(dataset.state.current_manager_disposition_overlay_json, null)
  const managerDispositionCoveredSourceStores = STORE_NAMES.filter((store) =>
    Array.isArray(managerDispositionOverlay?.sources) && managerDispositionOverlay.sources.some((source) => source?.sourceStore === store),
  )
  const managerDispositionRecords = Array.isArray(managerDispositionOverlay?.records)
    ? managerDispositionOverlay.records
    : []
  const managerDispositionByVin = new Map(managerDispositionRecords
    .filter((row) => typeof row?.vin === 'string' && VIN_PATTERN.test(row.vin))
    .map((row) => [row.vin, row]))
  // Only a delivered row that named this exact VIN may hide a vehicle. A row
  // matched by stock number alone stays in inventory and goes to the identity
  // review alert instead: a reused or mistyped stock number must never hide a
  // unit that is still listed or still in DealerMail.
  const managerDeliveredVins = new Set(managerDispositionRecords
    .filter(managerDeliveryHidesVin)
    .map((row) => row.vin))
  // Current inventory must be backed by a current public listing or current
  // DealerMail record. The manager sold board is retained as redacted audit
  // evidence, but it must never revive a vehicle that has left both sources.
  // That keeps off-market sold/delivered units out of the app and API while
  // allowing fresh DealerMail-only arrivals to remain visible as pre-listing.
  const vins = new Set([...publicByVin.keys(), ...crmByVin.keys()])
  const managerHiddenVins = []
  for (const vin of managerDeliveredVins) {
    if (vins.delete(vin)) managerHiddenVins.push(vin)
  }
  // Data health: hidden by the manager log while the public feed still lists
  // it. The delivery evidence is exact-VIN, but the count keeps a mistaken
  // manager-log row visible instead of silently shrinking the listed set.
  const managerHiddenListedVins = managerHiddenVins.filter((vin) => publicByVin.has(vin))
  return {
    publicByVin, crmByVin, holdByVin, resourceByVin, homeByVin,
    releasedHistoryByVin, managerDispositionOverlay, managerDispositionRecords,
    managerDispositionByVin, managerDeliveredVins, managerHiddenVins, managerHiddenListedVins, vins,
  }
}

const MANAGER_IDENTITY_CONFLICTS = new Set(['matched_vin_stock_review', 'stock_ambiguous'])

function managerDeliveryHidesVin(row) {
  return row?.deliveredManagerLog === true && row?.matchMethod === 'vin' &&
    typeof row?.vin === 'string' && VIN_PATTERN.test(row.vin) &&
    !MANAGER_IDENTITY_CONFLICTS.has(row?.matchStatus)
}

/**
 * Manager-log rows that cannot be placed on an exact VIN: sold/delivery-pending
 * rows without a VIN or with a conflicting identity, and delivered rows whose
 * VIN came from a stock-number match (or conflicts) and so did not hide the
 * vehicle. Each becomes the existing identity-review attention item.
 */
function managerIdentityReviewRecord(row) {
  if (row?.soldManagerLog !== true) return false
  if (row?.deliveredManagerLog === false) return !row?.vin || MANAGER_IDENTITY_CONFLICTS.has(row?.matchStatus)
  return row?.deliveredManagerLog === true && !managerDeliveryHidesVin(row)
}

/**
 * The one public-listing code. It comes only from the current public release
 * record and its freshness; labels beside it are display text. DealerMail
 * presence never makes a vehicle listed: it only separates a pre-listing
 * arrival from a vehicle that is in neither current source.
 */
function publicListingCode(source, publicFreshness) {
  if (source?.publicRecord) return publicFreshness === 'current' ? 'listed' : 'stale'
  return source?.crmRecord ? 'pre_listing' : 'not_in_release'
}

function currentInventoryRecord(source) {
  return Boolean(source?.publicRecord || source?.crmRecord)
}

function sourceVehicle(indexes, vin) {
  const publicRow = indexes.publicByVin.get(vin)
  const crmRow = indexes.crmByVin.get(vin)
  const holdRow = indexes.holdByVin.get(vin)
  return {
    vin,
    publicRecord: publicRow?.payload ?? null,
    crmRecord: crmRow?.payload ?? null,
    holdRecord: holdRow?.payload ?? null,
    cdkRecord: holdRow?.cdk ?? null,
    resourceRecord: indexes.resourceByVin.get(vin)?.payload ?? null,
    releasedHistoryRecord: indexes.releasedHistoryByVin.get(vin) ?? null,
    managerDispositionRecord: indexes.managerDispositionByVin.get(vin) ?? null,
    homeAssignment: indexes.homeByVin.get(vin) ?? null,
  }
}

function primaryAndBackups(holdRecord) {
  const active = (holdRecord?.holdDetailRows ?? []).filter((row) => row?.lifecycleStatus === 'active')
  const primary = active.find((row) => row?.holdPosition === 'primary' || Number(row?.holdOrderNumber) === 1) ?? null
  const backups = active.filter((row) => row !== primary && (row?.holdPosition === 'backup' || Number(row?.holdOrderNumber) > 1))
  return { active, primary, backups }
}

function loanerSignal(messages) {
  const alert = (messages.alerts ?? []).find((item) => {
    const text = cleanText(item?.alertTextRaw ?? item?.textRaw ?? item?.bodyTextRaw)
    return /\b(?:LCTP|FCTP|loaner)\b/i.test(text)
  })
  const rawAlert = cleanText(alert?.alertTextRaw ?? alert?.textRaw ?? alert?.bodyTextRaw)
  if (!rawAlert) return null
  const program = /\bFCTP\b/i.test(rawAlert) ? 'FCTP' : /\bLCTP\b/i.test(rawAlert) ? 'LCTP' : 'Loaner'
  const dateMatch = rawAlert.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/)
  return {
    active: true,
    program,
    label: program === 'Loaner' ? 'Current loaner' : `Current loaner ${program}`,
    serviceDate: dateMatch ? dateMatch[1] : null,
    rawAlert,
  }
}

/**
 * The loaner badge facts every role may see. The alert text itself is DealerMail
 * evidence and commonly carries customer or RO references, so it reaches only
 * roles that may view private evidence. Clients fall back on the label.
 */
function loanerForRole(loaner, context) {
  if (!loaner) return null
  if (context.canViewPrivateEvidence) return loaner
  const { active, program, label, serviceDate } = loaner
  return { active, program, label, serviceDate }
}

function holdSummary(source, context, freshness, { includePrivate = false } = {}) {
  const holdRecord = source.holdRecord
  const crmRecord = source.crmRecord
  const messages = dealerMailMessages(source)
  const loaner = loanerForRole(loanerSignal(messages), context)
  const messageCounts = {
    commentsCount: messages.comments.reduce((count, group) => count + (Array.isArray(group?.rows) ? group.rows.length : 0), 0),
    alertsCount: messages.alerts.length,
  }
  if (freshness !== 'current') {
    const retained = holdRecord ? holdSummary(source, context, 'current', { includePrivate }) : null
    return {
      ...retained,
      lastKnownActiveHold: Boolean(holdRecord),
      // A prior complete observation is retained separately from current status.
      lastKnownNoHold: freshness === 'stale_unverified' && Boolean(crmRecord) && !holdRecord,
      state: holdRecord ? 'stale' : crmRecord ? 'stale' : 'unknown',
      label: holdRecord ? 'Last verified hold — confirm in DealerMail' : 'Hold status stale — confirm in DealerMail',
      backupCount: holdRecord ? primaryAndBackups(holdRecord).backups.length : 0,
      loaner,
      ...messageCounts,
    }
  }
  if (!crmRecord) return { state: 'unknown', label: 'Not found in current CRM inventory', backupCount: 0, loaner }
  if (!holdRecord) {
    return {
      state: 'none_observed',
      label: loaner?.active ? loaner.label : 'No hold observed in verified CRM snapshot',
      backupCount: 0,
      loaner,
      ...messageCounts,
    }
  }

  const { primary, backups } = primaryAndBackups(holdRecord)
  const summary = {
    state: backups.length ? 'multiple' : 'primary',
    label: backups.length ? `Primary hold + ${backups.length} backup${backups.length === 1 ? '' : 's'}` : 'Primary hold',
    backupCount: backups.length,
    expectedDate: cleanText(primary?.expectedDeliveryDateRaw),
    loaner,
    ...messageCounts,
  }
  if (!['driver', 'porter', 'coordinator'].includes(context.role)) summary.primarySalesperson = cleanText(primary?.salespersonRaw)
  if (includePrivate && context.canViewPrivateEvidence) summary.reason = cleanText(primary?.customerOrReasonRaw)
  return summary
}

function dealerMailMessages(source) {
  // Current complete-inventory evidence covers every CRM VIN. Keep the held
  // record fallback for older releases without duplicating the same messages.
  return {
    comments: source.crmRecord?.comments ?? source.holdRecord?.comments ?? [],
    alerts: source.crmRecord?.alerts ?? source.holdRecord?.alerts ?? [],
  }
}

function simplifyComments(evidence) {
  return (evidence?.comments ?? []).flatMap((group) =>
    (group?.rows ?? []).map((row) => ({
      author: cleanText(row?.authorRaw),
      text: cleanText(row?.commentTextRaw),
      timestamp: cleanText(row?.timestampRaw),
    })),
  )
}

function simplifyAlerts(evidence) {
  return (evidence?.alerts ?? []).map((alert) => ({
    text: cleanText(alert?.alertTextRaw ?? alert?.textRaw ?? alert?.bodyTextRaw),
    author: cleanText(alert?.authorRaw),
    timestamp: cleanText(alert?.timestampRaw),
    metadataRaw: cleanText(alert?.modifiedMetadataRaw),
    spiffRaw: cleanText(alert?.spiffRaw),
  }))
}

function dealerMailPrivateEvidence(source) {
  const messages = dealerMailMessages(source)
  const history = [
    ...(source.holdRecord?.holdDetailRows ?? []).filter((row) => row.lifecycleStatus !== 'active').map((row) => ({ row, released: false })),
    ...(source.releasedHistoryRecord?.holdDetailRows ?? []).map((row) => ({ row, released: true })),
  ].map(({ row, released }) => ({
    orderRaw: cleanText(row.orderRaw ?? row.holdOrderNumber),
    lifecycle: cleanText(row.lifecycleStatus),
    salesperson: cleanText(row.salespersonRaw),
    customerOrReason: cleanText(row.customerOrReasonRaw),
    holdDate: cleanText(row.holdDateRaw),
    expectedDate: cleanText(row.expectedDeliveryDateRaw),
    statusLabel: released
      ? (Number(row.orderRaw ?? row.holdOrderNumber) === 1
        ? 'Not in current live hold set; detail page retains order 1 — review'
        : 'Not in current live hold set; outcome unknown')
      : 'Deleted history — not active',
  }))
  if (!source.holdRecord && !messages.comments.length && !messages.alerts.length && !history.length) return undefined
  const { primary, backups } = primaryAndBackups(source.holdRecord)
  return {
    primary: primary
      ? {
          salesperson: cleanText(primary.salespersonRaw),
          customerOrReason: cleanText(primary.customerOrReasonRaw),
          holdDate: cleanText(primary.holdDateRaw),
          expectedDate: cleanText(primary.expectedDeliveryDateRaw),
          heldBy: cleanText(primary.heldByRaw),
        }
      : null,
    backups: backups.map((row) => ({
      order: Number(row.holdOrderNumber) || undefined,
      salesperson: cleanText(row.salespersonRaw),
      customerOrReason: cleanText(row.customerOrReasonRaw),
      holdDate: cleanText(row.holdDateRaw),
      expectedDate: cleanText(row.expectedDeliveryDateRaw),
    })),
    comments: simplifyComments(messages),
    alerts: simplifyAlerts(messages),
    history,
    cdk: source.cdkRecord
      ? {
          result: cleanText(source.cdkRecord.result),
          status: cleanText(source.cdkRecord.fields?.STATUS),
          fields: Object.fromEntries(
            Object.entries(source.cdkRecord.fields ?? {})
              .filter(([key]) => ['STATUS', 'YEAR', 'MODEL', 'STOCKNO', 'VIN'].includes(key))
              .map(([key, value]) => [key, String(value ?? '')]),
          ),
        }
      : null,
  }
}

function privateSearchText(source) {
  const evidence = dealerMailPrivateEvidence(source)
  return [
    evidence?.primary?.salesperson,
    evidence?.primary?.customerOrReason,
    evidence?.primary?.heldBy,
    ...(evidence?.backups ?? []).map((backup) => backup.salesperson),
    ...(evidence?.backups ?? []).map((backup) => backup.customerOrReason),
    ...(evidence?.comments ?? []).map((comment) => comment.text),
    ...(evidence?.comments ?? []).map((comment) => comment.author),
    ...(evidence?.comments ?? []).map((comment) => comment.timestamp),
    ...(evidence?.alerts ?? []).map((alert) => alert.text),
    ...(evidence?.alerts ?? []).map((alert) => alert.author),
    ...(evidence?.alerts ?? []).map((alert) => alert.timestamp),
    ...(evidence?.alerts ?? []).flatMap((alert) => [alert.metadataRaw, alert.spiffRaw]),
    evidence?.cdk?.status,
    evidence?.cdk?.result,
    ...(evidence?.history ?? []).flatMap((row) => [row.orderRaw, row.lifecycle, row.salesperson, row.customerOrReason, row.holdDate, row.expectedDate, row.statusLabel]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isActiveTransfer(row) {
  return row && !TERMINAL_TRANSFER_STATES.has(row.status)
}

function blocksNewSimpleRequest(row) {
  return isActiveTransfer(row) && !(row.status === 'returned_home' && row.movement_status === 'returned_home' &&
    row.current_location_id === row.home_store_id)
}

/**
 * The exact rule createTransfer enforces (409 ACTIVE_TRANSFER_EXISTS), decided
 * over every ledger row for the VIN whether or not the caller may see it.
 * vehicleView publishes the same answer so clients never guess it from the
 * movement shape they happen to receive. The advanced engine allows overlaps,
 * so it never blocks there.
 */
function newRequestBlocked(rows, workflowMode) {
  return workflowMode === 'simple' && rows.some(blocksNewSimpleRequest)
}

function transferEventView(row, { includeNotes = false } = {}) {
  const event = {
    id: row.id,
    type: row.event_type,
    label: row.label,
    occurredAt: row.occurred_at,
    actor: cleanText(row.actor),
    actorRole: cleanText(row.actor_role),
    store: cleanText(row.store_id),
    fromLocation: cleanText(row.from_location_id),
    toLocation: cleanText(row.to_location_id),
    confirmedBy: cleanText(row.confirmed_by),
  }
  if (includeNotes) event.note = cleanText(row.note)
  return event
}

function holdStateForTransfer(source, dealerMailFreshness) {
  if (dealerMailFreshness !== 'current') return 'stale_unverified'
  if (!source.crmRecord) return 'unknown'
  if (!source.holdRecord) return 'none_observed'
  return primaryAndBackups(source.holdRecord).backups.length ? 'primary_with_backups' : 'primary'
}

function cdkStatus(source) {
  const status = cleanText(source.cdkRecord?.fields?.STATUS)
  return status ? `Raw CDK status ${status} — not mapped to sale or delivery` : 'Not provided'
}

function allowedUiActions(row, context) {
  if (!transferMutationAuthorized(row, context)) return []
  const simple = context.workflowMode === 'simple'
  if (simple && row.status === 'returned_home') return ['open-source']
  const events = new Set(allowedEventTypes(row.status, context.role, context.workflowMode))
  if (context.role !== 'group_manager') {
    const requestingStoreAction = context.store === row.requesting_store_id
    const homeStoreAction = context.store === row.home_store_id
    if (!requestingStoreAction) {
      events.delete('manager_reviewed')
      events.delete('approved')
      events.delete('request_approved')
      events.delete('request_declined')
      events.delete('declined')
      events.delete('driver_requested')
      events.delete('transport_assigned')
      events.delete('return_assigned')
      if (simple && ['sales', 'manager'].includes(context.role)) {
        events.delete('arrived')
        events.delete('return_started')
        for (const eventType of SIMPLE_DESTINATION_CUSTODY_EVENTS) events.delete(eventType)
      }
    }
    if (!homeStoreAction) events.delete('returned_home')
  }
  const actions = []
  const add = (action, condition) => {
    if (condition && !actions.includes(action)) actions.push(action)
  }
  add('approve', events.has(simple ? 'request_approved' : 'approved'))
  add('review-request', !simple && events.has('manager_reviewed'))
  add('decline', events.has(simple ? 'request_declined' : 'declined'))
  add('request-driver', !simple && events.has('driver_requested'))
  add('assign-transport', !simple && (events.has('transport_assigned') || events.has('return_assigned')))
  // Collection and destination-arrival were not reliably recorded by the two
  // stores. Keep historical evidence read-only, but do not make either one an
  // everyday manager task or a gate to the outcome/return workflow.
  add('confirm-pickup', !simple && (events.has('picked_up') || events.has('return_in_transit')))
  add('confirm-arrival', !simple && events.has('arrived'))
  add(
    'record-outcome',
    ['customer_showing', 'sale_outcome_pending', 'sale_confirmed', 'delivery_confirmed', 'not_sold'].some((event) =>
      events.has(event),
    ),
  )
  add('schedule-return', events.has(simple ? 'return_started' : 'return_requested'))
  add('confirm-return', events.has('returned_home'))
  add('mark-exception', events.has('location_exception'))
  add('report-condition', events.has('condition_issue'))
  add('escalate', events.has('escalated'))
  add('open-source', true)
  add('close', events.has('closed'))
  return actions
}

// Present older rows in the current operating language without modifying the
// stored ledger, timestamps, or future advanced-workflow evidence.
function simpleNextAction(row) {
  switch (row.status) {
    case 'requested':
    case 'manager_reviewed':
      return { label: 'Check the vehicle is free, then approve this move', owner: row.approval_owner || `${row.requesting_store_id} manager` }
    case 'approved':
    case 'transport_assigned':
    case 'picked_up':
    case 'in_transit':
      return { label: 'Show the vehicle, then start its return', owner: row.requested_by || `${row.requesting_store_id} sales` }
    case 'arrived':
    case 'customer_showing':
    case 'sale_outcome_pending':
      return { label: 'Record the showing outcome, or start the return', owner: `${row.requesting_store_id} sales` }
    case 'sale_confirmed':
      return { label: 'Confirm delivery, or record the deal fell through', owner: `${row.requesting_store_id} manager` }
    case 'delivery_confirmed':
      return { label: 'Close the move · the customer took delivery', owner: `${row.requesting_store_id} manager` }
    case 'not_sold':
    case 'return_requested':
    case 'return_assigned':
      return { label: 'Start the return when the vehicle leaves', owner: `${row.requesting_store_id} sales` }
    case 'return_in_transit':
      return { label: `Confirm the vehicle is back at ${row.home_store_id}`, owner: `${row.home_store_id} manager` }
    case 'returned_home':
      return { label: `Move complete · back at ${row.home_store_id}`, owner: undefined }
    default:
      return { label: row.next_action, owner: cleanText(row.next_action_owner) }
  }
}

/**
 * Which store owns a move's current next step. The persisted next-action owner
 * names a person, a driver or a coordinator, never a store, so the queue reads
 * the movement instead: only a return already travelling or received is the
 * Home Store's to confirm. Everything else sits with the requesting store.
 */
function transferNextActionStore(row) {
  const returning = ['return_in_transit', 'returned_home']
  if (returning.includes(row.movement_status) || returning.includes(row.status)) {
    return cleanText(row.home_store_id)
  }
  return cleanText(row.destination_store_id) || cleanText(row.requesting_store_id)
}

function transferView(row, events, source, context, meta, { includePrivate = false } = {}) {
  const next = context.workflowMode === 'simple' ? simpleNextAction(row) : { label: row.next_action, owner: cleanText(row.next_action_owner) }
  const record = {
    id: row.id,
    workflowMode: context.workflowMode ?? 'advanced',
    vin: row.vin,
    stockNumber: row.stock_at_request,
    vehicleName: row.vehicle_name_at_request,
    homeStore: row.home_store_id,
    requestingStore: row.requesting_store_id,
    currentLocation: row.current_location_id,
    destination: row.destination_store_id,
    requestStatus: row.status,
    movementStatus: row.movement_status,
    dealStatus: row.deal_status,
    deliveryStatus: row.delivery_status,
    dealerMailHoldState: holdStateForTransfer(source, meta.dealerMailFreshness),
    publicListing: publicListingCode(source, meta.publicFreshness),
    publicListingState: source.publicRecord ? 'Listed publicly; availability not confirmed' : 'Not in current public release',
    cdkStatus: cdkStatus(source),
    priority: row.priority,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    approvedBy: cleanText(row.approved_by),
    custodian: cleanText(row.current_custodian),
    transportAssignee: cleanText(row.transport_assignee),
    nextAction: next.label,
    nextActionOwner: next.owner ?? 'Unassigned',
    // The store that owns the next step: the same rule the Action center uses
    // to decide actionability, so a client colors overdue work red only for
    // the store that has to act on it.
    nextActionStore: transferNextActionStore(row),
    dueAt: cleanText(row.due_at),
    returnRequired: Boolean(row.return_required),
    returnDueAt: cleanText(row.return_due_at),
    lastConfirmedAt: cleanText(row.last_confirmed_at),
    locationConfidence: row.location_confidence,
    allowedActions: allowedUiActions(row, context),
    events: events.map((event) => transferEventView(event, { includeNotes: includePrivate && context.canViewPrivateEvidence })),
  }
  if (includePrivate && context.canViewPrivateEvidence) {
    record.privateEvidence = {
      requestReason: row.reason,
      customerReference: cleanText(row.customer_reference),
      customerAppointment: Boolean(row.customer_appointment),
      approvalOwner: cleanText(row.approval_owner),
      dealerMail: dealerMailPrivateEvidence(source),
    }
  }
  return record
}

function movementDepartureAt(row, events) {
  if (!row || !isActiveTransfer(row) || !row.current_location_id || row.current_location_id === row.home_store_id ||
      ['unknown', 'conflicting'].includes(row.location_confidence) ||
      ![...STORE_NAMES, 'In transit'].includes(row.current_location_id)) return undefined
  // Reset only on a recorded physical home receipt. In the simplified flow,
  // a destination-tagged outcome (or return beginning at that destination) is
  // the first reliable proof that the vehicle is away when pickup/arrival were
  // intentionally omitted.
  const dated = events.map((event) => ({ event, time: Date.parse(event.occurred_at) })).filter(({ time }) => Number.isFinite(time))
  const lastReceipt = Math.max(-Infinity, ...dated.filter(({ event }) => event.event_type === 'returned_home').map(({ time }) => time))
  const departed = dated.filter(({ event, time }) => time > lastReceipt && (
    ['direct_move_recorded', 'vehicle_departed', 'picked_up', 'in_transit'].includes(event.event_type) ||
    (SIMPLE_DESTINATION_CUSTODY_EVENTS.has(event.event_type) && event.to_location_id === row.destination_store_id) ||
    (event.event_type === 'return_started' && event.from_location_id === row.destination_store_id)
  )).sort((a, b) => a.time - b.time)[0]
  return departed ? new Date(departed.time).toISOString() : undefined
}

function physicalLocationAuthority(rows, database) {
  const physicalEvents = new Set(['direct_move_recorded', 'vehicle_departed', 'picked_up', 'in_transit', 'arrived', 'return_started', 'return_in_transit', 'returned_home'])
  // A later request or note is not a physical move. Completed receipts remain
  // evidence even though the simple workflow closes in that same transaction.
  const evidence = rows.map((row) => {
    const events = getTransferEvents(database, row.id)
    const physical = events.filter((event) => (
      physicalEvents.has(event.event_type) ||
      (SIMPLE_DESTINATION_CUSTODY_EVENTS.has(event.event_type) && event.to_location_id === row.destination_store_id)
    ) && Number.isFinite(Date.parse(event.occurred_at)))
    return { row, events, time: Math.max(-Infinity, ...physical.map((event) => Date.parse(event.occurred_at))) }
  }).filter(({ time }) => Number.isFinite(time)).sort((a, b) => b.time - a.time || a.row.id.localeCompare(b.row.id))
  if (evidence.length) {
    const latest = evidence[0]
    const tied = evidence.filter(({ time }) => time === latest.time)
    const locationKey = ({ row }) => JSON.stringify([
      row.current_location_id, row.home_store_id,
      row.current_location_id === 'In transit' ? (row.movement_status.includes('return') ? 'return' : 'outbound') : null,
    ])
    // UUID order is not evidence that one physical update happened later.
    // Keep agreeing locations useful, but never choose between conflicting
    // equal-time sightings or manufacture a clock from ambiguous trips.
    return {
      ...latest,
      conflicting: new Set(tied.map(locationKey)).size > 1,
      departureConflicting: new Set(tied.map(({ row, events }) => movementDepartureAt(row, events))).size > 1,
    }
  }
  const row = rows.find(blocksNewSimpleRequest)
  return row ? { row, events: getTransferEvents(database, row.id) } : null
}

function sharedLocationSummary(row, events) {
  // This explicit allowlist is deliberately not a redacted TransferRecord.
  // Other stores may locate group vehicles without gaining a transfer link,
  // actor, customer reference, note, custodian or action-owner identity.
  return {
    state: row.movement_status,
    label: ['unknown', 'conflicting'].includes(row.location_confidence) ? 'Location needs checking' : row.movement_status.replaceAll('_', ' '),
    currentLocation: row.current_location_id,
    destination: row.destination_store_id,
    lastConfirmedAt: cleanText(row.last_confirmed_at),
    locationConfidence: row.location_confidence,
    departedAt: movementDepartureAt(row, events),
  }
}

function movementSummary(source, activeTransfer, transfer, publicFreshness, events = []) {
  if (activeTransfer && transfer) {
    return {
      transferId: transfer.id,
      requestStatus: transfer.requestStatus,
      state: transfer.movementStatus,
      label: transfer.movementStatus.replaceAll('_', ' '),
      currentLocation: transfer.currentLocation,
      currentCustodian: transfer.custodian,
      transportAssignee: transfer.transportAssignee,
      destination: transfer.destination,
      lastConfirmedAt: transfer.lastConfirmedAt,
      locationConfidence: transfer.locationConfidence,
      nextAction: transfer.nextAction,
      nextActionOwner: transfer.nextActionOwner,
      nextActionStore: transfer.nextActionStore,
      dueAt: transfer.dueAt,
      returnRequired: transfer.returnRequired,
      returnDueAt: transfer.returnDueAt,
      departedAt: movementDepartureAt(activeTransfer, events),
    }
  }
  const sourceLocation = source.publicRecord?.store || source.crmRecord?.storeName || 'Unknown'
  return {
    state: 'source_reported',
    label: publicFreshness === 'current' ? 'Source-reported location' : 'Last verified source location',
    currentLocation: sourceLocation,
    locationConfidence: publicFreshness === 'current' ? 'reported' : 'stale',
    nextAction: 'Confirm with home store before customer commitment',
    nextActionOwner: `${sourceLocation} manager`,
  }
}

function vehicleName(source) {
  return (
    cleanText(source.publicRecord?.vehicle_name) ||
    [source.crmRecord?.yearRaw, source.crmRecord?.makeRaw, source.crmRecord?.modelRaw, source.crmRecord?.seriesRaw]
      .map(cleanText)
      .filter(Boolean)
      .join(' ') ||
    cleanText(source.managerDispositionRecord?.vehicleName) ||
    source.vin
  )
}

const PUBLIC_PHOTO_HOSTS = new Set([
  'www.bobmaxeyfordhowell.com',
  'www.bobmaxeyfordinfowlerville.com',
  'www.bobmaxeyford.com',
  'www.bobmaxeylincoln.com',
])

const DEALERON_PHOTO_ACCOUNT_BY_HOST = Object.freeze({
  'www.bobmaxeyfordhowell.com': '23482',
  'www.bobmaxeyfordinfowlerville.com': '14236',
  'www.bobmaxeyford.com': '11801',
  'www.bobmaxeylincoln.com': '11803',
})

const PUBLIC_PHOTO_HOST_BY_STORE = Object.freeze({
  Howell: 'www.bobmaxeyfordhowell.com',
  Fowlerville: 'www.bobmaxeyfordinfowlerville.com',
  'Ford Detroit': 'www.bobmaxeyford.com',
  Lincoln: 'www.bobmaxeylincoln.com',
})

function publicListingHost(publicRecord) {
  const configuredHost = PUBLIC_PHOTO_HOST_BY_STORE[publicRecord?.store]
  if (configuredHost && PUBLIC_PHOTO_HOSTS.has(configuredHost)) return configuredHost
  const listing = cleanText(publicRecord?.listing_url)
  if (!listing) return null
  try {
    const url = new URL(listing)
    const host = url.hostname.toLowerCase()
    return PUBLIC_PHOTO_HOSTS.has(host) ? host : null
  } catch {
    return null
  }
}

function directMoveInitial(row, database) {
  if (!row) return null
  return getTransferEvents(database, row.id).find((event) => event.event_type === 'direct_move_recorded') ?? null
}

function inferredDealerOnPhotoUrls(publicRecord, vin) {
  const count = positiveInteger(publicRecord?.photo_count)
  if (!count) return []
  const host = publicListingHost(publicRecord)
  const account = host ? DEALERON_PHOTO_ACCOUNT_BY_HOST[host] : null
  if (!account) return []
  const lowerVin = vin.toLowerCase()
  const cappedCount = Math.min(count, 100)
  return Array.from({ length: cappedCount }, (_, index) =>
    `https://${host}/inventoryphotos/${account}/${lowerVin}/ip/${index + 1}.jpg`)
}

function publicPhotoUrls(publicRecord) {
  if (!publicRecord) return []
  const vin = cleanText(publicRecord.vin)?.toLowerCase()
  if (!vin) return []
  const storedGallery = Array.isArray(publicRecord.photo_urls) ? publicRecord.photo_urls : []
  const candidates = storedGallery.length
    ? storedGallery
    : cleanText(publicRecord.photo_preview_url)
      ? [publicRecord.photo_preview_url]
      : inferredDealerOnPhotoUrls(publicRecord, vin)
  const urls = []
  const seen = new Set()
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      continue
    }
    const path = parsed.pathname.replace(/\/{2,}/g, '/')
    let decodedPath
    try {
      decodedPath = decodeURIComponent(path)
    } catch {
      continue
    }
    const lowerPath = path.toLowerCase()
    if (
      parsed.protocol !== 'https:' ||
      !PUBLIC_PHOTO_HOSTS.has(parsed.hostname.toLowerCase()) ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      !lowerPath.startsWith('/inventoryphotos/') ||
      !lowerPath.includes(`/${vin}/`) ||
      !/\.(?:jpe?g|png|webp)$/i.test(path) ||
      decodedPath.split('/').includes('..')
    ) {
      continue
    }
    const canonical = `https://${parsed.hostname.toLowerCase()}${path}`
    const identity = canonical.toLowerCase()
    if (seen.has(identity)) continue
    seen.add(identity)
    urls.push(canonical)
    if (urls.length >= 100) break
  }
  return urls
}

function vehicleView(source, transferRows, context, meta, { includePrivate = false, includePublicScan = false } = {}) {
  const publicRecord = source.publicRecord
  const crmRecord = source.crmRecord
  const publicStore = publicRecord?.store || crmRecord?.storeName
  if (!STORE_NAMES.includes(publicStore)) return null
  const visibleTransferRows = transferRows.filter((row) => transferVisible(row, context))
  const latest = visibleTransferRows[0] ?? null
  const simple = context.workflowMode === 'simple'
  const groupLocationVisible = simple && ['sales', 'manager', 'group_manager'].includes(context.role)
  const location = simple ? physicalLocationAuthority(groupLocationVisible ? transferRows : visibleTransferRows, meta.database) : null
  const homeStore = source.homeAssignment?.home_store_id || (!location?.conflicting && location?.row.home_store_id) || publicStore
  const active = simple
    ? (location && blocksNewSimpleRequest(location.row) && transferVisible(location.row, context) ? location.row :
      visibleTransferRows.find(blocksNewSimpleRequest) ?? null)
    : visibleTransferRows.find(isActiveTransfer) ?? null
  const activeEvents = active ? getTransferEvents(meta.database, active.id) : []
  const blockingTransferRows = transferRows.filter(blocksNewSimpleRequest)
  const activeDirect = blockingTransferRows.length === 1 && directMoveInitial(blockingTransferRows[0], meta.database)
    ? blockingTransferRows[0]
    : null
  const activeTransferView = active
    ? transferView(active, activeEvents, source, context, meta, { includePrivate: false })
    : null
  const baseMovement = movementSummary(source, active, activeTransferView, meta.publicFreshness, activeEvents)
  const physicalMovement = location?.conflicting
    ? {
        state: 'location_exception', label: 'Location needs checking', currentLocation: 'Unknown',
        locationConfidence: 'conflicting', destination: undefined, lastConfirmedAt: undefined, departedAt: undefined,
      }
    : location
      ? { ...sharedLocationSummary(location.row, location.events), ...(location.departureConflicting ? { departedAt: undefined } : {}) }
      : null
  const movement = {
    ...(physicalMovement
      ? !location.conflicting && active && transferVisible(location.row, context)
        ? { ...baseMovement, ...physicalMovement }
        : physicalMovement
      : baseMovement),
    // The caller's own createTransfer outcome, decided over every row for the
    // VIN (transferRows is state.transfersByVin, not the visibility-filtered
    // list) so the value published is exactly what a POST would get. Only
    // callers who could reach that 409 receive the bit; drivers, porters and
    // coordinators are refused with 403 first, so for them presence itself
    // would be a new disclosure. It is one boolean with no request identity,
    // actor, store, custodian, note or customer attached — the same single
    // fact the 409 message already states. Absent in advanced mode, where
    // createTransfer never evaluates the single-active rule.
    ...(simple && context.canCreateTransfer ? { newRequestBlocked: newRequestBlocked(transferRows, context.workflowMode) } : {}),
    ...(simple && activeDirect && !location?.conflicting &&
      (context.role === 'group_manager' || (context.role === 'manager' && context.store === activeDirect.home_store_id))
      ? { canDirectReroute: true }
      : {}),
  }
  const reportDate = meta.reportDate
  const name = vehicleName(source)
  const year = publicRecord?.year ?? finiteNumber(crmRecord?.yearRaw) ?? cleanText(crmRecord?.yearRaw)
  const stockNumber = cleanText(publicRecord?.stock_number) || cleanText(crmRecord?.stockNumber) ||
    cleanText(source.managerDispositionRecord?.stockNumber) || ''
  const hold = holdSummary(source, context, meta.dealerMailFreshness, { includePrivate })
  hold.canViewEvidence = context.canViewPrivateEvidence
  hold.canManage = context.canViewPrivateEvidence
  const imageUrls = publicPhotoUrls(publicRecord)
  const publicVehicleResourceState = (resource) =>
    meta.publicFreshness === 'current'
      ? resource?.dataState === 'incomplete'
        ? 'incomplete'
        : 'current'
      : meta.publicFreshness
  const independentResourceState = (resource) =>
    meta.resourceFreshness === 'current' ? resource?.dataState : meta.resourceFreshness
  const independentAutoCheckReport = source.resourceRecord?.autoCheckReport
  // The selling dealer's live website report is authoritative. vAuto is only
  // the exact-VIN fallback for a current vehicle that is not listed online yet.
  const autoCheckReport = publicRecord?.autoCheckReport
    ? { ...publicRecord.autoCheckReport, dataState: publicVehicleResourceState(publicRecord.autoCheckReport) }
    : independentAutoCheckReport
      ? { ...independentAutoCheckReport, dataState: independentResourceState(independentAutoCheckReport) }
      : undefined
  const windowSticker = publicRecord?.windowSticker
    ? { ...publicRecord.windowSticker, dataState: publicVehicleResourceState(publicRecord.windowSticker) }
    : undefined
  const factoryEquipment = source.resourceRecord?.factoryEquipment
    ? {
        ...source.resourceRecord.factoryEquipment,
        dataState: independentResourceState(source.resourceRecord.factoryEquipment),
        isOriginalWindowSticker: false,
      }
    : undefined
  const canViewFordInvoice = ['sales', 'manager', 'group_manager'].includes(context.authenticatedRole)
  const fordInvoice = canViewFordInvoice && source.resourceRecord?.fordInvoice
    ? {
        ...source.resourceRecord.fordInvoice,
        dataState: independentResourceState(source.resourceRecord.fordInvoice),
      }
    : undefined
  // Ford OASIS facts are read-only reference evidence from the resources
  // channel. Open field service actions never imply availability or condition.
  const fordOasis = source.resourceRecord?.fordOasis
    ? {
        ...source.resourceRecord.fordOasis,
        dataState: independentResourceState(source.resourceRecord.fordOasis),
      }
    : undefined
  // Warranty coverage check is read-only reference evidence from the same
  // channel. Remaining coverage never implies condition or availability.
  const warrantyCheck = source.resourceRecord?.warrantyCheck
    ? {
        ...source.resourceRecord.warrantyCheck,
        dataState: independentResourceState(source.resourceRecord.warrantyCheck),
      }
    : undefined
  const view = {
    vin: source.vin,
    stockNumber,
    year,
    make: cleanText(publicRecord?.make) || cleanText(crmRecord?.makeRaw) || '',
    model: cleanText(publicRecord?.model) || cleanText(crmRecord?.modelRaw) || '',
    trim: cleanText(publicRecord?.trim) || cleanText(crmRecord?.seriesRaw),
    vehicleName: name,
    listedPrice: finiteNumber(publicRecord?.listed_price ?? crmRecord?.priceNumber),
    msrp: finiteNumber(publicRecord?.msrp),
    mileage: finiteNumber(publicRecord?.mileage ?? crmRecord?.mileageNumber),
    daysListed: publicRecord
      ? daysBetween(publicRecord.inventory_date, reportDate)
      : finiteNumber(crmRecord?.inventoryAgeNumber),
    exteriorColor: cleanText(publicRecord?.exterior_color) || cleanText(crmRecord?.colorRaw),
    interiorColor: cleanText(publicRecord?.interior_color),
    bodyStyle: cleanText(publicRecord?.body_style) || cleanText(crmRecord?.bodyRaw),
    bodyType: cleanText(publicRecord?.body_type),
    drivetrain: cleanText(publicRecord?.drivetrain),
    engine: cleanText(publicRecord?.engine) || cleanText(crmRecord?.engineRaw),
    transmission: cleanText(publicRecord?.transmission),
    fuelType: cleanText(publicRecord?.fuel_type),
    mpgCity: finiteNumber(publicRecord?.mpg_city),
    mpgHighway: finiteNumber(publicRecord?.mpg_highway),
    certified: typeof publicRecord?.certified === 'boolean' ? publicRecord.certified : null,
    inventoryDate: cleanText(publicRecord?.inventory_date),
    dealerComments: cleanText(publicRecord?.dealer_comments),
    modelCode: cleanText(publicRecord?.model_code),
    features: cleanText(publicRecord?.features),
    listingUrl: cleanText(publicRecord?.listing_url),
    photoCount: positiveInteger(publicRecord?.photo_count),
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    publicStore,
    homeStore,
    homeStoreConfirmed: Boolean(source.homeAssignment),
    crmStore: cleanText(crmRecord?.storeName),
    sourceReportedLocation: publicStore,
    websiteStatus: publicRecord ? cleanText(publicRecord.availability) || 'Not provided' : 'Current DealerMail record — not publicly listed',
    publicListing: publicListingCode(source, meta.publicFreshness),
    publicListingState: publicRecord
      ? meta.publicFreshness === 'current'
        ? 'Listed publicly; availability not confirmed'
        : 'Last verified public listing — availability not confirmed'
      : 'Pre-listing — current DealerMail record; public website listing not yet observed',
    dealerOn: {
      inStock: typeof publicRecord?.in_stock === 'boolean' ? publicRecord.in_stock : null,
      inTransit: typeof publicRecord?.in_transit === 'boolean' ? publicRecord.in_transit : null,
      inProduction: typeof publicRecord?.in_production === 'boolean' ? publicRecord.in_production : null,
    },
    managerDisposition: source.managerDispositionRecord
      ? {
          ...source.managerDispositionRecord,
          dataState: meta.managerDispositionFreshness,
        }
      : null,
    hold,
    movement,
    changeSummary: cleanText(publicRecord?.change_summary),
    dataStatus: cleanText(publicRecord?.data_status) || (crmRecord
      ? 'Pre-listing — current DealerMail record; public website listing not yet observed'
      : 'Unknown'),
    ...(includePublicScan && publicRecord ? { publicScan: publicScanAudit(publicRecord) } : {}),
    ...(autoCheckReport ? { autoCheckReport } : {}),
    ...(windowSticker ? { windowSticker } : {}),
    ...(factoryEquipment ? { factoryEquipment } : {}),
    ...(fordInvoice ? { fordInvoice } : {}),
    ...(fordOasis ? { fordOasis } : {}),
    ...(warrantyCheck ? { warrantyCheck } : {}),
  }
  const safeSearchParts = [
    source.vin,
    stockNumber,
    year,
    view.make,
    view.model,
    view.trim,
    name,
    view.listedPrice,
    view.mileage,
    view.exteriorColor,
    view.interiorColor,
    view.bodyStyle,
    view.drivetrain,
    view.engine,
    view.transmission,
    view.fuelType,
    view.features,
    view.msrp,
    view.daysListed,
    publicRecord?.body_type,
    publicRecord?.mpg_city,
    publicRecord?.mpg_highway,
    publicRecord?.certified,
    publicRecord?.photo_count,
    publicRecord?.inventory_date,
    publicRecord?.model_code,
    publicRecord?.generic_color,
    publicRecord?.dealer_comments,
    publicRecord?.data_status,
    publicRecord?.actual_location,
    publicRecord?.location_city,
    publicRecord?.dealer_location_id,
    publicRecord?.dealer_name,
    publicRecord?.vehicle_id,
    publicRecord?.first_seen,
    publicRecord?.last_seen,
    ...(Array.isArray(publicRecord?.source_sites) ? publicRecord.source_sites : [publicRecord?.source_sites]),
    publicRecord?.source_count,
    publicStore,
    view.crmStore,
    view.websiteStatus,
    view.managerDisposition?.soldLabel,
    view.managerDisposition?.deliveryLabel,
    view.managerDisposition?.deliveryDate,
    view.managerDisposition?.sourceStore,
    view.managerDisposition?.sourcePeriod,
    hold.primarySalesperson,
    autoCheckReport?.reportRunAt,
    autoCheckReport?.score,
    autoCheckReport?.scoreRangeLow,
    autoCheckReport?.scoreRangeHigh,
    autoCheckReport?.usage,
    autoCheckReport?.ownerCount,
    autoCheckReport?.lastReportedOdometer,
    autoCheckReport?.lastReportedOdometerDate,
    autoCheckReport?.vehicleClass,
    autoCheckReport?.assemblyCountry,
    autoCheckReport?.estimatedInServiceDate,
    ...(autoCheckReport?.checks ?? []).flatMap((check) => [check.label, check.status, check.detail]),
    windowSticker?.vehicleDescription,
    windowSticker?.equipmentGroup,
    windowSticker?.originalMarket,
    windowSticker?.pricingCurrency,
    windowSticker?.pricingCurrencyEvidence,
    windowSticker?.basePrice,
    windowSticker?.totalOptions,
    windowSticker?.destinationCharge,
    windowSticker?.totalMsrp,
    windowSticker?.exteriorColor,
    windowSticker?.interiorColor,
    windowSticker?.engine,
    windowSticker?.transmission,
    ...(windowSticker?.options ?? []),
    ...(windowSticker?.standardEquipment ?? []),
    ...(windowSticker?.warranty ?? []),
    factoryEquipment?.dataState,
    factoryEquipment?.sourceLabel,
    factoryEquipment?.capturedAt,
    factoryEquipment?.vehicleDescription,
    factoryEquipment?.basePrice,
    factoryEquipment?.totalOptions,
    factoryEquipment?.destinationCharge,
    factoryEquipment?.totalMsrp,
    factoryEquipment?.exteriorColor,
    factoryEquipment?.interiorColor,
    factoryEquipment?.engine,
    factoryEquipment?.transmission,
    factoryEquipment?.drivetrain,
    ...(factoryEquipment?.packages ?? []).flatMap((entry) => [
      entry.name,
      entry.code,
      entry.price,
      ...(entry.features ?? []),
    ]),
    ...(factoryEquipment?.sections ?? []).flatMap((section) => [
      section.name,
      ...section.items.flatMap((item) => [item.label, item.price]),
    ]),
    factoryEquipment?.disclaimer,
    factoryEquipment ? 'vAuto CAI informational equipment label not original Monroney window sticker' : null,
    fordInvoice?.available ? 'Saved Ford factory invoice' : null,
    fordInvoice?.capturedAt,
    fordOasis?.dataState,
    fordOasis?.sourceLabel,
    fordOasis?.vehicleDescription,
    fordOasis?.versionSeries,
    fordOasis?.buildDate,
    fordOasis?.warrantyStartDate,
    fordOasis?.releaseDate,
    fordOasis?.monthsInService,
    fordOasis?.saleMileage,
    ...(fordOasis?.openFieldServiceActions ?? []).flatMap((action) => [action.code, action.description]),
    ...(fordOasis?.warrantyCoverages ?? []).flatMap((coverage) => [coverage.type, coverage.description]),
    ...(fordOasis?.extendedCoverageExpirations ?? []),
    fordOasis ? 'Ford OASIS' : null,
    fordOasis?.openFieldServiceActions?.length ? 'open recall field service action' : null,
    warrantyCheck?.dataState,
    warrantyCheck?.sourceLabel,
    warrantyCheck?.mileageEntered,
    warrantyCheck?.mileageSource,
    warrantyCheck?.autoCheck?.inServiceDate,
    warrantyCheck?.autoCheck?.inServiceAgeMonths,
    warrantyCheck?.fordOasis?.warrantyStartDate,
    warrantyCheck?.fordOasis?.monthsInService,
    ...[...(warrantyCheck?.autoCheck?.coverages ?? []), ...(warrantyCheck?.fordOasis?.coverages ?? [])].flatMap(
      (coverage) => [
        coverage.type,
        coverage.termText,
        coverage.remainingMilesText,
        coverage.remainingTimeText,
        coverage.status,
        coverage.note,
      ],
    ),
    warrantyCheck ? 'warranty check coverage' : null,
  ]
  if (context.canViewPrivateEvidence) safeSearchParts.push(privateSearchText(source))
  if (context.canViewPrivateEvidence && includePrivate) {
    const privateEvidence = dealerMailPrivateEvidence(source)
    if (privateEvidence) view.privateEvidence = privateEvidence
  }
  view.searchText = safeSearchParts.filter((value) => value !== undefined && value !== null).join(' ').toLowerCase()
  if (latest && !active) view.lastMovementRequestStatus = latest.status
  return view
}

function mergedResourceCoverage(sources, enrichmentRows = 0) {
  const coverage = {
    vehicles: 0,
    photos: 0,
    photoUrls: 0,
    autoCheck: 0,
    windowStickers: 0,
    factoryEquipment: 0,
    fordInvoices: 0,
    fordOasis: 0,
    warrantyCheck: 0,
    enrichmentRows,
  }
  for (const source of sources) {
    const imageUrls = publicPhotoUrls(source.publicRecord)
    const hasPhotos = imageUrls.length > 0
    const hasAutoCheck = Boolean(source.resourceRecord?.autoCheckReport || source.publicRecord?.autoCheckReport)
    const hasWindowSticker = Boolean(source.publicRecord?.windowSticker)
    const hasFactoryEquipment = Boolean(source.resourceRecord?.factoryEquipment)
    const hasFordInvoice = Boolean(source.resourceRecord?.fordInvoice)
    const hasFordOasis = Boolean(source.resourceRecord?.fordOasis)
    const hasWarrantyCheck = Boolean(source.resourceRecord?.warrantyCheck)
    if (hasPhotos || hasAutoCheck || hasWindowSticker || hasFactoryEquipment || hasFordInvoice || hasFordOasis || hasWarrantyCheck) {
      coverage.vehicles += 1
    }
    if (hasPhotos) coverage.photos += 1
    coverage.photoUrls += imageUrls.length
    if (hasAutoCheck) coverage.autoCheck += 1
    if (hasWindowSticker) coverage.windowStickers += 1
    if (hasFactoryEquipment) coverage.factoryEquipment += 1
    if (hasFordInvoice) coverage.fordInvoices += 1
    if (hasFordOasis) coverage.fordOasis += 1
    if (hasWarrantyCheck) coverage.warrantyCheck += 1
  }
  return coverage
}

function transferRelatedToStore(row, store) {
  return [row.home_store_id, row.requesting_store_id, row.destination_store_id].includes(store)
}

function transportAssignedToUser(row, context) {
  if (TERMINAL_TRANSFER_STATES.has(row.status)) return false
  if (!ACTIVE_TRANSPORT_ASSIGNMENT_STATES.has(row.movement_status)) return false
  const assignedUserId = cleanText(row.transport_assignee_user_id)
  if (assignedUserId) return Boolean(context.userId) && assignedUserId === context.userId
  const legacyAssignee = row.transport_assignee
  return context.allowLegacyTransportAssignmentByName === true &&
    typeof legacyAssignee === 'string' &&
    /^[\x20-\x7e]+$/.test(legacyAssignee) &&
    legacyAssignee === context.user
}

function transferVisible(row, context) {
  if (context.role === 'group_manager') return true
  if (['manager', 'coordinator', 'sales'].includes(context.role)) {
    return transferRelatedToStore(row, context.store)
  }
  if (['porter', 'driver'].includes(context.role)) return transportAssignedToUser(row, context)
  return false
}

function transferMutationAuthorized(row, context) {
  if (context.role === 'group_manager') return true
  if (['manager', 'coordinator', 'sales'].includes(context.role)) {
    return transferRelatedToStore(row, context.store)
  }
  if (['porter', 'driver'].includes(context.role)) return transportAssignedToUser(row, context)
  return false
}

function metaView(dataset, database, now, loadStatus) {
  const manifest = parseJson(dataset.state.current_manifest_json, {})
  const timeZone = manifest.timezone || 'America/New_York'
  const publicFreshness = currentFreshness(dataset.sourceRuns.public, { now, timeZone, loadStatus })
  const dealerMailFreshness = currentFreshness(dataset.sourceRuns.dealerMail, { now, timeZone, loadStatus })
  const resourceFreshness = currentFreshness(dataset.sourceRuns.resources, { now, timeZone, loadStatus })
  const managerDispositionFreshness = currentFreshness(dataset.sourceRuns.managerDisposition, { now, timeZone, loadStatus })
  const managerDispositionOverlay = parseJson(dataset.state.current_manager_disposition_overlay_json, null)
  const managerDispositionCoveredSourceStores = STORE_NAMES.filter((store) =>
    Array.isArray(managerDispositionOverlay?.sources) && managerDispositionOverlay.sources.some((source) => source?.sourceStore === store),
  )
  const warnings = parseJson(dataset.state.current_release_warnings_json, [])
  if (loadStatus?.error) warnings.push(`Latest source refresh failed; retained prior verified data as stale/unverified: ${loadStatus.error}`)
  if (dealerMailFreshness !== 'current') {
    warnings.push('DealerMail hold absence or release cannot be concluded from stale or incomplete data.')
  }
  const normalizedChangeCounts = normalizePublicChangeCounts(manifest.public_change_counts)
  warnings.push(...normalizedChangeCounts.issues)
  const safeChangeCount = (key) => normalizedChangeCounts.counts[key] ?? 0
  const publicChangeBaseline = parseJson(dataset.state.current_public_change_baseline_json, null)
  const crmSourceCount = positiveInteger(dataset.sourceRuns.dealerMail?.row_count) ?? dataset.crmRows.length
  return {
    reportDate: dataset.state.current_report_date || dataset.sourceRuns.public?.report_date || '',
    completedAt: manifest.completed_at || dataset.sourceRuns.public?.loaded_at || '',
    publicCapturedAt: dataset.sourceRuns.public?.extracted_at || '',
    dealerMailCapturedAt: dataset.sourceRuns.dealerMail?.extracted_at || '',
    timezone: timeZone,
    publicFreshness,
    dealerMailFreshness,
    resourceFreshness,
    managerDispositionFreshness,
    managerDispositionCoverageStatus: managerDispositionOverlay?.coverageStatus === 'provided' ? 'provided' : 'not_provided',
    managerDispositionCoveredSourceStores,
    managerDispositionCoverageCaveat: MANAGER_DISPOSITION_COVERAGE_CAVEAT,
    publicCount: dataset.publicRows.length,
    crmCount: crmSourceCount,
    heldVinCount: dataset.holdRows.length,
    managerDispositionCount: managerDispositionOverlay?.summary?.recordCount ?? 0,
    managerDeliveredCount: managerDispositionOverlay?.summary?.deliveredRecordCount ?? 0,
    managerDispositionReviewCount: managerDispositionOverlay?.summary?.reviewRecordCount ?? 0,
    publicChangeBaselineDate:
      cleanText(publicChangeBaseline?.reportDate) || cleanText(dataset.sourceRuns.public?.metadata?.changeBaseline?.reportDate),
    publicChangeCounts: {
      newArrival: safeChangeCount('new_arrival'),
      removed: safeChangeCount('removed'),
      priceChange: safeChangeCount('price_change'),
      mileageChange: safeChangeCount('mileage_change'),
      websiteStatusChange: safeChangeCount('website_status_change'),
      stockCorrection: safeChangeCount('stock_correction'),
      storeTransfer: safeChangeCount('store_transfer'),
    },
    holdChangeStatus: cleanText(manifest.hold_change_status) || 'not_provided',
    warnings: [...new Set(warnings)],
    database,
  }
}

function publicMeta(meta) {
  const { database, ...safe } = meta
  return safe
}

function matchesVehicleFilters(vehicle, query, privateIndex = '') {
  if (query.q && !vehicle.searchText.includes(query.q.toLowerCase()) && !privateIndex.includes(query.q.toLowerCase())) return false
  if (query.store && vehicle.publicStore !== query.store) return false
  if (query.homeStore && vehicle.homeStore !== query.homeStore) return false
  if (query.hold) {
    const wanted = query.hold.toLowerCase()
    if (wanted === 'yes' && !['primary', 'multiple'].includes(vehicle.hold.state)) return false
    if (wanted === 'no' && vehicle.hold.state !== 'none_observed') return false
    if (!['yes', 'no'].includes(wanted) && vehicle.hold.state !== wanted) return false
  }
  return true
}

const VEHICLE_SORTS = Object.freeze({
  vehicleName: (row) => row.vehicleName,
  stockNumber: (row) => row.stockNumber,
  vin: (row) => row.vin,
  store: (row) => row.publicStore,
  price: (row) => row.listedPrice,
  mileage: (row) => row.mileage,
  daysListed: (row) => row.daysListed,
})

function compareNullable(left, right) {
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1
  if (right === null || right === undefined) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
}

function sortVehicles(vehicles, sort = 'vehicleName', order = 'asc') {
  // The query string reaches here unvalidated. A `??` fallback treats only
  // nullish lookups as unknown, so inherited keys such as `__proto__` or
  // `hasOwnProperty` resolved to non-functions and threw a 500. Own-property
  // membership keeps the lenient default for every unknown value.
  const selector = Object.hasOwn(VEHICLE_SORTS, sort) ? VEHICLE_SORTS[sort] : VEHICLE_SORTS.vehicleName
  const direction = order === 'desc' ? -1 : 1
  return vehicles.sort((left, right) => direction * compareNullable(selector(left), selector(right)) || left.vin.localeCompare(right.vin))
}

function integerQuery(value, fallback, { min = 0, max = 500 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** The one return-overdue rule: the stores summary and the Overview both count it. */
function transferReturnOverdue(row, now) {
  return isActiveTransfer(row) &&
    Boolean(row.return_required) &&
    Boolean(row.return_due_at) &&
    new Date(row.return_due_at) < now &&
    !RETURN_COMPLETE_STATES.has(row.status) &&
    !RETURN_PAUSED_STATES.has(row.status) &&
    !RETURN_COMPLETE_STATES.has(row.movement_status)
}

function storeSummaries(vehicles, holdRows, transferRows, now) {
  return STORE_NAMES.map((store) => {
    const storeTransfers = transferRows.filter((row) => isActiveTransfer(row))
    const returnOverdue = storeTransfers.filter((row) => row.home_store_id === store && transferReturnOverdue(row, now)).length
    const sourceConflicts = vehicles.filter(
      (vehicle) => vehicle.publicStore === store && vehicle.crmStore && vehicle.crmStore !== vehicle.publicStore,
    ).length
    return {
      store,
      publicUnits: vehicles.filter((vehicle) => vehicle.publicStore === store && vehicle.listingUrl).length,
      currentHolds: holdRows.filter((row) => row.crm_store_id === store).length,
      awayFromHome: storeTransfers.filter(
        (row) => row.home_store_id === store && row.current_location_id !== store,
      ).length,
      visiting: storeTransfers.filter(
        (row) => row.home_store_id !== store && row.current_location_id === store,
      ).length,
      returnOverdue,
      locationExceptions:
        sourceConflicts +
        storeTransfers.filter(
          (row) => row.home_store_id === store && ['conflicting', 'unknown', 'stale'].includes(row.location_confidence),
        ).length,
    }
  })
}

function attentionEventView(row, { includeNotes = false, includeAssignee = false } = {}) {
  return {
    id: row.id,
    type: row.event_type,
    label: row.label,
    actor: row.actor,
    actorRole: row.actor_role,
    store: cleanText(row.store_id),
    occurredAt: row.occurred_at,
    assignee: includeAssignee ? cleanText(row.assignee) : null,
    followUpAt: cleanText(row.follow_up_at),
    priority: cleanText(row.priority),
    resolutionCode: cleanText(row.resolution_code),
    note: includeNotes ? cleanText(row.note) : null,
  }
}

function defaultAttentionPriority(item) {
  if (item.priority) return item.priority
  if (item.severity === 'critical') return 'urgent'
  if (item.severity === 'warning') return 'high'
  return 'normal'
}

// Select source identity and authored evidence before role redaction. Capture
// metadata and other VINs do not describe a new condition on this vehicle.
function attentionSourceEvidence(source) {
  if (!source) return null
  const { primary, backups } = primaryAndBackups(source.holdRecord)
  const holds = [primary, ...backups].filter(Boolean).map((row) => [
    cleanText(row.holdPosition), row.holdOrderNumber ?? cleanText(row.orderRaw),
    cleanText(row.holdDateRaw), cleanText(row.expectedDeliveryDateRaw),
    cleanText(row.salespersonRaw), cleanText(row.customerOrReasonRaw), cleanText(row.heldByRaw),
  ])
  const alerts = simplifyAlerts(dealerMailMessages(source)).map((alert) => [
    alert.text, alert.author, alert.timestamp, alert.metadataRaw, alert.spiffRaw,
  ])
  return { holds: holds.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), alerts: alerts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
}

function versionedAttentionId(baseId, evidence) {
  const fingerprint = createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 12)
  return `${baseId}-${fingerprint}`
}

/**
 * Conditions that describe the group's data rather than one store's next step.
 * They stay in the Action center so nothing is hidden, but they never enter the
 * navigation badge: a badge that counts source health and website pricing gaps
 * alongside real handoffs stops telling anyone whether they have work to do.
 */
const INFORMATIONAL_ATTENTION_TYPES = Object.freeze({
  source_freshness: 'source_health',
  missing_price: 'public_listing',
})

/** Roles that only ever act on vehicle movement, never on hold or sold-board review. */
const TRANSPORT_ONLY_ROLES = Object.freeze(['driver', 'porter'])

/**
 * Whether the signed-in viewer can take this item's next step today. The rule is
 * deliberately narrow: the step has to belong to the viewer's own store and be
 * something their role performs.
 *
 * Actionability stays tied to the viewer's working location for every role,
 * group managers included: an item another store owns is still that store's
 * next step, not theirs, so it never enters their badge. That is a separate
 * question from `allowedActions`, which may still let a group manager or a
 * related store record a note or a follow-up on an item that is not theirs to
 * take. The Action center shows both: the badge counts actionability, the
 * follow-up controls follow allowedActions.
 */
function attentionActionability(item, context) {
  const informational = (reason) => ({ actionability: 'informational', informationalReason: reason })
  if (Object.hasOwn(INFORMATIONAL_ATTENTION_TYPES, item.type)) {
    return informational(INFORMATIONAL_ATTENTION_TYPES[item.type])
  }
  const owningStore = cleanText(item.actionStore) || cleanText(item.store)
  if (!owningStore || owningStore !== context.store) return informational('other_store')
  if (!isTransportItem(item) && TRANSPORT_ONLY_ROLES.includes(context.role)) return informational('role_scope')
  if (item.type === 'manager_pending_identity_review' && !['manager', 'group_manager'].includes(context.role)) {
    return informational('role_scope')
  }
  return { actionability: 'actionable', informationalReason: null }
}

function mergeAttentionWorkflow(database, items, context) {
  const workflows = new Map(listAttentionWorkflowRows(database).map((row) => [row.attention_key, row]))
  return items.map((item) => {
    const workflow = workflows.get(item.id)
    const record = {
      ...item,
      status: workflow?.status || 'open',
      priority: workflow?.priority || defaultAttentionPriority(item),
      assignedTo: (canSeePersistedAssignee(item, context) ? cleanText(workflow?.assigned_to) : null) || cleanText(item.owner),
      assignedRole: cleanText(workflow?.assigned_role),
      followUpAt: cleanText(workflow?.follow_up_at),
      resolutionCode: cleanText(workflow?.resolution_code),
      resolutionNote: context.canViewPrivateEvidence ? cleanText(workflow?.resolution_note) : null,
      lastUpdatedAt: cleanText(workflow?.updated_at),
      events: workflow ? getAttentionEvents(database, item.id).map((event) => attentionEventView(event, { includeNotes: context.canViewPrivateEvidence, includeAssignee: canSeePersistedAssignee(item, context) })) : [],
    }
    record.allowedActions = allowedAttentionActions(record, context)
    Object.assign(record, attentionActionability(record, context))
    return record
  })
}

function attentionItems(meta, vehicles, stores, transferRows, database, context, conditionDay, managerDispositionRecords = [], sources = []) {
  const items = []
  if (meta.publicFreshness !== 'current' || meta.dealerMailFreshness !== 'current') {
    items.push({
      id: versionedAttentionId('source-freshness', [conditionDay, meta.reportDate, meta.publicFreshness, meta.dealerMailFreshness]),
      severity: 'critical',
      priority: 'urgent',
      type: 'source_freshness',
      label: 'One or more source feeds are stale or incomplete; verify before acting.',
      sourceLabel: 'Daily source health',
      whyItMatters: 'Availability, hold-release, and removal conclusions are unsafe until all required sources are current.',
      recommendedAction: 'Use the last verified release and restore the incomplete source before making a final conclusion.',
      href: '/attention',
    })
  }
  for (const summary of stores) {
    if (summary.returnOverdue) {
      items.push({
        id: versionedAttentionId(`return-overdue-${summary.store}`, [conditionDay, summary.returnOverdue]),
        severity: 'critical',
        priority: 'urgent',
        type: 'return_overdue',
        label: `${summary.returnOverdue} return${summary.returnOverdue === 1 ? '' : 's'} overdue`,
        count: summary.returnOverdue,
        store: summary.store,
        relatedStores: [summary.store],
        sourceLabel: 'Inventory Flow move ledger',
        whyItMatters: 'A vehicle due back at its home store has not been confirmed received.',
        recommendedAction: 'Open Vehicle moves, then assign the return or confirm the vehicle is back.',
        href: '/transfers',
      })
    }
    if (summary.locationExceptions) {
      items.push({
        id: versionedAttentionId(`location-exception-${summary.store}`, [conditionDay, summary.locationExceptions]),
        severity: 'warning',
        priority: 'high',
        type: 'location_exception',
        label: `${summary.locationExceptions} location exception${summary.locationExceptions === 1 ? '' : 's'} need review`,
        count: summary.locationExceptions,
        store: summary.store,
        relatedStores: [summary.store],
        sourceLabel: 'Inventory and transfer reconciliation',
        whyItMatters: 'The source-reported location and the app-owned movement record do not fully agree.',
        recommendedAction: 'Confirm physical custody and record a transfer location update without changing source-system evidence.',
        href: '/transfers',
      })
    }
  }
  for (const summary of stores) {
    const missingPrice = vehicles.filter(
      (vehicle) => vehicle.publicStore === summary.store && vehicle.listingUrl && vehicle.listedPrice === null,
    ).length
    if (missingPrice) {
      items.push({
        id: versionedAttentionId(`missing-public-price-${summary.store}`, [conditionDay, meta.reportDate, missingPrice]),
        severity: 'info',
        priority: 'normal',
        type: 'missing_price',
        label: `${missingPrice} public unit${missingPrice === 1 ? '' : 's'} without a published price`,
        count: missingPrice,
        store: summary.store,
        relatedStores: [summary.store],
        sourceLabel: 'Verified public inventory release',
        whyItMatters: 'Salespeople cannot quote a published website price for these units.',
        recommendedAction: 'Review the affected inventory and confirm pricing through the authorized dealership process.',
        href: '/inventory',
      })
    }
  }
  for (const vehicle of vehicles) {
    const activeHold = ['primary', 'multiple'].includes(vehicle.hold?.state)
    const currentCrm = activeHold || vehicle.hold?.state === 'none_observed'
    const pastExpected = activeHold && dateIsBeforeReport(vehicle.hold?.expectedDate, meta.reportDate)
    const hasAlert = Number(vehicle.hold?.alertsCount) > 0
    if (!currentCrm || (!pastExpected && !hasAlert)) continue
    const store = vehicle.crmStore || vehicle.publicStore
    items.push({
      id: versionedAttentionId(`${activeHold ? 'hold' : 'vehicle'}-review-${vehicle.vin}`, [
        conditionDay,
        meta.reportDate,
        vehicle.hold.state,
        vehicle.hold.expectedDate,
        vehicle.hold.alertsCount,
        attentionSourceEvidence(sources.find((source) => source.vin === vehicle.vin)),
      ]),
      severity: pastExpected ? 'critical' : 'warning',
      priority: pastExpected ? 'urgent' : 'high',
      type: pastExpected ? 'past_expected_hold' : activeHold ? 'hold_alert' : 'vehicle_alert',
      label: pastExpected ? 'Past-expected hold needs review' : activeHold ? 'Current hold includes an alert' : 'Vehicle alert needs review',
      vehicleName: vehicle.vehicleName,
      stockNumber: vehicle.stockNumber,
      vin: vehicle.vin,
      store,
      relatedStores: [...new Set([vehicle.publicStore, vehicle.crmStore].filter(Boolean))],
      owner: cleanText(vehicle.hold.primarySalesperson) || `${store} manager`,
      dueAt: cleanText(vehicle.hold.expectedDate),
      sourceLabel: activeHold ? 'Verified DealerMail hold snapshot' : 'Verified DealerMail vehicle record',
      whyItMatters: pastExpected
        ? 'The expected date has passed. This is a review signal, not proof of delivery, sale, or release.'
        : 'A vehicle-level DealerMail alert is present and should be reviewed in its authorized record.',
      recommendedAction: 'Open the vehicle, review the exact alert or hold evidence, and confirm the current operational next step.',
      href: `/inventory?scope=group&q=${encodeURIComponent(vehicle.vin)}`,
      sourceId: vehicle.vin,
    })
  }
  // Every active move gets an attention item. A fixed cap silently dropped the
  // least recently touched moves, which are exactly the ones needing review,
  // and made them unreachable through /api/attention/:id.
  for (const row of transferRows.filter((row) => isActiveTransfer(row) &&
    !(context.workflowMode === 'simple' && row.status === 'returned_home'))) {
    const next = context.workflowMode === 'simple' ? simpleNextAction(row) : { label: row.next_action, owner: cleanText(row.next_action_owner) }
    items.push({
      id: versionedAttentionId(`transfer-${row.id}`, [
        conditionDay,
        row.status,
        row.movement_status,
        row.current_location_id,
        row.next_action,
        row.due_at,
        row.return_due_at,
      ]),
      severity: row.priority === 'urgent' ? 'critical' : row.priority === 'high' ? 'warning' : 'info',
      priority: row.priority,
      type: 'transfer_next_action',
      label: next.label,
      vehicleName: row.vehicle_name_at_request,
      stockNumber: row.stock_at_request,
      vin: row.vin,
      store: row.requesting_store_id,
      actionStore: transferNextActionStore(row),
      relatedStores: [...new Set([row.home_store_id, row.requesting_store_id, row.destination_store_id])],
      owner: next.owner,
      dueAt: cleanText(row.due_at),
      sourceLabel: 'Inventory Flow move ledger',
      whyItMatters: 'This is the next handoff Inventory Flow needs to keep the move going.',
      recommendedAction: next.label,
      href: `/transfers?id=${encodeURIComponent(row.id)}`,
      sourceId: row.id,
    })
  }
  for (const record of managerDispositionRecords.filter(managerIdentityReviewRecord)) {
    const delivered = record.deliveredManagerLog === true
    items.push({
      id: versionedAttentionId(`manager-pending-identity-${record.sourceStore}-${record.stockNumber}`, [
        conditionDay,
        meta.reportDate,
        record.sourcePeriod,
        record.stockNumber,
        record.matchStatus,
        ...(delivered ? ['delivered', record.matchMethod] : []),
      ]),
      severity: 'warning',
      priority: 'high',
      type: 'manager_pending_identity_review',
      label: delivered
        ? `${record.stockNumber} is delivered on the manager log and needs an exact VIN match`
        : `${record.stockNumber} is sold / delivery pending and needs an exact VIN match`,
      vehicleName: record.vehicleName || `Vehicle ${record.stockNumber}`,
      stockNumber: record.stockNumber,
      vin: record.vin || undefined,
      store: record.sourceStore,
      relatedStores: [record.sourceStore],
      owner: `${record.sourceStore} manager`,
      sourceLabel: 'Manager-supplied sold board',
      whyItMatters: delivered
        ? 'The manager log marks this unit delivered, but the row did not carry this exact VIN, so the vehicle stays in inventory until its identity is confirmed.'
        : 'The row is not highlighted, so it must stay operationally active, but it cannot be placed in the VIN-based inventory table until its identity is confirmed.',
      recommendedAction: 'Confirm the exact stock number and VIN; do not treat this unit as delivered or available.',
      href: '/attention',
      sourceId: `${record.sourceStore}:${record.stockNumber}`,
    })
  }
  return mergeAttentionWorkflow(database, items, context)
}

function holdSignalSummaries(holdRows, meta) {
  const summaries = new Map(
    STORE_NAMES.map((store) => [
      store,
      {
        store,
        activeHoldVins: 0,
        pastExpected: 0,
        withAlerts: 0,
        withComments: 0,
        reviewVins: 0,
        freshness: meta.dealerMailFreshness,
      },
    ]),
  )
  for (const row of holdRows) {
    const store = cleanText(row.crm_store_id)
    const summary = summaries.get(store)
    if (!summary || Number(row.active_hold_count) <= 0) continue
    const pastExpected = dateIsBeforeReport(cleanText(row.expected_date), meta.reportDate)
    const withAlerts = Number(row.alerts_count) > 0
    summary.activeHoldVins += 1
    if (pastExpected) summary.pastExpected += 1
    if (withAlerts) summary.withAlerts += 1
    if (Number(row.comments_count) > 0) summary.withComments += 1
    if (pastExpected || withAlerts) summary.reviewVins += 1
  }
  return [...summaries.values()]
}

function normalizedVin(value) {
  const vin = String(value ?? '').trim().toUpperCase()
  if (!VIN_PATTERN.test(vin)) {
    throw new WorkflowError('VIN must be a valid 17-character VIN', { status: 400, code: 'INVALID_VIN' })
  }
  return vin
}

function healthView(state, loadStatus) {
  const ready = Boolean(state.meta.reportDate && state.dataset.publicRows.length)
  const resourceCoverage = mergedResourceCoverage(state.sources, state.dataset.resourceRows?.length ?? 0)
  return {
    ok: ready && state.meta.publicFreshness !== 'incomplete' && state.meta.dealerMailFreshness !== 'incomplete',
    ready,
    reportDate: state.meta.reportDate || null,
    freshness: {
      public: state.meta.publicFreshness,
      dealerMail: state.meta.dealerMailFreshness,
      resources: state.meta.resourceFreshness,
      managerDisposition: state.meta.managerDispositionFreshness,
    },
    counts: {
      public: state.dataset.publicRows.length,
      crm: state.meta.crmCount,
      heldVins: state.dataset.holdRows.length,
      resources: resourceCoverage.vehicles,
      resourceCoverage,
      managerDispositions: state.indexes.managerDispositionRecords.length,
      // VINs the manager log hid from active inventory, and how many of those
      // the current public feed still lists, so a mistaken row is visible.
      managerDeliveredHidden: state.indexes.managerHiddenVins.length,
      managerDeliveredHiddenWhileListed: state.indexes.managerHiddenListedVins.length,
      transfers: state.allTransferRows.length,
    },
    sources: {
      public: state.dataset.sourceRuns.public
        ? {
            sha256: state.dataset.sourceRuns.public.content_sha256,
            rows: state.dataset.sourceRuns.public.row_count,
            extractedAt: state.dataset.sourceRuns.public.extracted_at,
          }
        : null,
      dealerMail: state.dataset.sourceRuns.dealerMail
        ? {
            sha256: state.dataset.sourceRuns.dealerMail.content_sha256,
            rows: state.dataset.sourceRuns.dealerMail.row_count,
            extractedAt: state.dataset.sourceRuns.dealerMail.extracted_at,
          }
        : null,
      resources: state.dataset.sourceRuns.resources
        ? {
            sha256: state.dataset.sourceRuns.resources.content_sha256,
            rows: state.dataset.sourceRuns.resources.row_count,
            extractedAt: state.dataset.sourceRuns.resources.extracted_at,
          }
        : null,
      managerDisposition: state.dataset.sourceRuns.managerDisposition
        ? {
            sha256: state.dataset.sourceRuns.managerDisposition.content_sha256,
            rows: state.dataset.sourceRuns.managerDisposition.row_count,
            extractedAt: state.dataset.sourceRuns.managerDisposition.extracted_at,
          }
        : null,
    },
    lastRefreshAttemptAt: loadStatus.lastAttemptAt ?? null,
    lastRefreshSuccessAt: loadStatus.lastSuccessAt ?? null,
    warnings: state.meta.warnings,
  }
}

export function createInventoryServiceCore({ database: databaseHandle, repository, now = () => new Date(), initialLoadStatus = {}, workflowMode = 'simple' }) {
  if (!['simple', 'advanced'].includes(workflowMode)) throw new TypeError('workflowMode must be simple or advanced')
  const database = createRepositoryContext(databaseHandle, repository)
  let loadStatus = { ...initialLoadStatus }

  function issueSnapshot(contextInput) {
    const context = roleContext(contextInput)
    const enabled = vehicleIssuesEnabled(database)
    const issues = listVehicleIssueRows(database)
    const eventsByIssue = new Map()
    for (const event of listVehicleIssueEvents(database)) {
      const rows = eventsByIssue.get(event.issue_id) ?? []
      rows.push(event)
      eventsByIssue.set(event.issue_id, rows)
    }
    for (const rows of eventsByIssue.values()) rows.sort((left, right) => left.version - right.version)
    return { context, enabled, issues, eventsByIssue }
  }

  function issueRecords(state) {
    return state.issues.map((issue) => vehicleIssueView(issue, state.eventsByIssue.get(issue.id) ?? [], state.context))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  }

  function requireIssueStorage(state) {
    if (!state.enabled) throw new WorkflowError('Vehicle issue storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
  }

  function snapshot(contextInput = {}) {
    // Mode is deployment-owned, never a client role/header/body override.
    const context = { ...roleContext(contextInput), workflowMode }
    const dataset = getCurrentDataset(database)
    const currentNow = now()
    const meta = metaView(dataset, database, currentNow, loadStatus)
    const indexes = buildIndexes(dataset)
    const allTransferRows = listTransferRows(database)
    const serviceEventsByVin = new Map()
    for (const row of listServiceEvents(database)) {
      const values = serviceEventsByVin.get(row.vin) ?? []
      values.push(row)
      serviceEventsByVin.set(row.vin, values)
    }
    // The app's own disposition ledger. Nothing here derives a row from a
    // source, a move event or the manager log; only updateDisposition writes.
    const dispositionStorage = dispositionsEnabled(database)
    const dispositionEventsByVin = new Map()
    for (const row of listDispositionEvents(database)) {
      const values = dispositionEventsByVin.get(row.vin) ?? []
      values.push(row)
      dispositionEventsByVin.set(row.vin, values)
    }
    const manualHoldStorage = manualHoldsEnabled(database)
    const manualHoldEventsByVin = new Map()
    for (const row of listManualHoldEvents(database)) {
      const rows = manualHoldEventsByVin.get(row.vin) ?? []
      rows.push(row)
      manualHoldEventsByVin.set(row.vin, rows)
    }
    const transfersByVin = new Map()
    for (const row of allTransferRows) {
      const values = transfersByVin.get(row.vin) ?? []
      values.push(row)
      transfersByVin.set(row.vin, values)
    }
    const sources = [...indexes.vins].sort().map((vin) => sourceVehicle(indexes, vin))
    const publicChanges = parseJson(dataset.state.current_public_change_events_json, [])
    return {
      context,
      dataset,
      meta,
      indexes,
      allTransferRows,
      serviceEventsByVin,
      serviceIntakeByVin: new Map((dataset.serviceIntake ?? []).map((row) => [row.vin, row])),
      dispositionStorage, manualHoldStorage, manualHoldEventsByVin,
      savedListsStorage: savedVehicleListsEnabled(database),
      dispositionEventsByVin,
      transfersByVin,
      sources,
      publicChanges: Array.isArray(publicChanges) ? publicChanges : [],
      currentNow,
    }
  }

  function vehicleFromSnapshot(state, source, options = {}) {
    const vehicle = vehicleView(source, state.transfersByVin.get(source.vin) ?? [], state.context, state.meta, options)
    if (vehicle) {
      // Internal provenance is non-enumerable: expose only the safe readiness view.
      Object.defineProperty(vehicle, 'serviceIntake', { value: state.serviceIntakeByVin.get(source.vin) })
      // Calendar freshness describes the report, not whether a recorded inspection
      // happened. Keep the selected release's original evidence until replacement.
      Object.defineProperty(vehicle, 'publishedServiceEvidence', { value: {
        ...vehicle,
        serviceIntake: vehicle.serviceIntake,
        autoCheckReport: source.publicRecord?.autoCheckReport
          ? { ...source.publicRecord.autoCheckReport, dataState: state.dataset.sourceRuns.public?.status === 'current'
              ? source.publicRecord.autoCheckReport.dataState ?? 'current' : state.dataset.sourceRuns.public?.status }
          : state.dataset.sourceRuns.resources?.status === 'current' ? source.resourceRecord?.autoCheckReport : undefined,
        fordOasis: state.dataset.sourceRuns.resources?.status === 'current' ? source.resourceRecord?.fordOasis : undefined,
      } })
      vehicle.serviceReadiness = serviceReadinessView(vehicle, state.serviceEventsByVin.get(source.vin)?.at(-1), state.context)
      // Codes, dates and stores only: the note and writer's name are read
      // through getDisposition, never in a list view.
      vehicle.appDisposition = dispositionView(source, state.dispositionEventsByVin.get(source.vin)?.at(-1) ?? null, state.context, {
        enabled: state.dispositionStorage,
      })
      vehicle.manualHold = manualHoldView(source, state.manualHoldEventsByVin.get(source.vin)?.at(-1), state.context, { enabled: state.manualHoldStorage })
      vehicle.inventoryDecision = inventoryDecision(vehicle)
      vehicle.canReportIssue = vehicleIssuesEnabled(database) && canReportVehicleIssue(vehicle, state.context)
    }
    return vehicle
  }

  function serviceDetail(vehicle, rows, context, selectedRow = rows.at(-1)) {
    return {
      ...serviceReadinessView(vehicle, selectedRow, context, { includeNotes: true }),
      history: context.canViewPrivateEvidence
        ? [...rows].reverse().map((row) => serviceReadinessView(vehicle, row, context, { includeNotes: true }))
        : [],
    }
  }

  function attentionFromSnapshot(state) {
    const vehicles = state.sources
      .filter(currentInventoryRecord)
      .map((source) => vehicleFromSnapshot(state, source))
      .filter(Boolean)
    sortVehicles(vehicles)
    const visibleTransferRows = state.allTransferRows.filter((row) => transferVisible(row, state.context))
    const stores = storeSummaries(vehicles, state.dataset.holdRows, visibleTransferRows, state.currentNow)
    return attentionItems(
      state.meta,
      vehicles,
      stores,
      visibleTransferRows,
      database,
      state.context,
      dateInTimeZone(state.currentNow, state.meta.timezone),
      state.indexes.managerDispositionRecords,
      state.sources,
    )
  }

  return {
    setLoadStatus(next) {
      loadStatus = { ...loadStatus, ...next }
    },

    health() {
      return healthView(snapshot({ role: 'sales', store: 'Howell', user: 'health-check' }), loadStatus)
    },

    adminOverview(contextInput = {}, members = []) {
      assertAdminOverviewAccess(contextInput)
      const state = snapshot(contextInput)
      const attentionRows = listAttentionWorkflowRows(database)
      return buildAdminOverview({
        generatedAt: state.currentNow.toISOString(),
        members,
        meta: state.meta,
        sourceRuns: state.dataset.sourceRuns,
        publicRows: state.dataset.publicRows,
        crmRows: state.dataset.crmRows,
        transferRows: state.allTransferRows,
        attentionRows,
        serviceEvents: listServiceEvents(database),
        dispositionEvents: listDispositionEvents(database),
        getTransferEvents: (transfer) => getTransferEvents(database, transfer.id),
        getAttentionEvents: (attention) => getAttentionEvents(database, attention.attention_key),
      })
    },

    /**
     * `overview: false` skips the Overview projection. The integration Worker
     * passes it: that path never exposes the projection.
     */
    bootstrap(contextInput = {}, { overview = true } = {}) {
      const state = snapshot(contextInput)
      const issueState = issueSnapshot(contextInput)
      if (!state.dataset.publicRows.length) {
        throw new WorkflowError('No verified public inventory release is loaded', {
          status: 503,
          code: 'SOURCE_DATA_UNAVAILABLE',
        })
      }
      const vehicles = state.sources
        .filter(currentInventoryRecord)
        .map((source) => vehicleFromSnapshot(state, source))
        .filter(Boolean)
      sortVehicles(vehicles)
      const visibleTransferRows = state.allTransferRows.filter((row) => transferVisible(row, state.context))
      const transferEventsById = new Map(visibleTransferRows.map((row) => [row.id, getTransferEvents(database, row.id)]))
      const transfers = visibleTransferRows.map((row) => {
        const source = sourceVehicle(state.indexes, row.vin)
        return transferView(
          row,
          transferEventsById.get(row.id),
          source,
          state.context,
          state.meta,
          { includePrivate: false },
        )
      })
      const stores = storeSummaries(vehicles, state.dataset.holdRows, visibleTransferRows, state.currentNow)
      const holdSignals = holdSignalSummaries(state.dataset.holdRows, state.meta)
      const asOfDay = dateInTimeZone(state.currentNow, state.meta.timezone)
      // Built only from what this role already receives: the role-filtered
      // vehicles and visible transfer rows, never state.allTransferRows.
      const overviewView = overview && overviewAccess(state.context.role)
        ? buildOverviewSummary({
            context: state.context,
            meta: state.meta,
            asOfDay,
            vehicles,
            visibleTransferRows,
            transferEventsById,
            returnOverdueTransferIds: new Set(visibleTransferRows
              .filter((row) => transferReturnOverdue(row, state.currentNow)).map((row) => row.id)),
            holdRows: state.dataset.holdRows,
            holdSignals,
            serviceRowByVin: new Map([...state.serviceEventsByVin].map(([vin, rows]) => [vin, rows.at(-1)])),
            serviceIntakeByVin: state.serviceIntakeByVin,
            managerIdentityReviews: state.indexes.managerDispositionRecords.filter(managerIdentityReviewRecord),
          })
        : null
      return {
        access: {
          user: state.context.user,
          userId: savedListOwnerId(state.context, { required: false }),
          role: state.context.role,
          store: state.context.store,
          canViewPrivateEvidence: state.context.canViewPrivateEvidence,
          canCreateTransfer: state.context.canCreateTransfer,
        },
        meta: publicMeta(state.meta),
        stores,
        vehicles,
        transfers,
        vehicleIssuesEnabled: issueState.enabled,
        vehicleIssues: issueRecords(issueState),
        // False only on a D1 without migration 0013: the page says so instead
        // of showing zero dispositions and no way to record one.
        dispositionsEnabled: state.dispositionStorage,
        manualHoldsEnabled: state.manualHoldStorage,
        savedListsEnabled: state.savedListsStorage && Boolean(savedListOwnerId(state.context, { required: false })),
        holdSignals,
        managerDispositions: state.indexes.managerDispositionRecords.map((record) => ({
          ...record,
          dataState: state.meta.managerDispositionFreshness,
        })),
        attention: attentionItems(
          state.meta,
          vehicles,
          stores,
          visibleTransferRows,
          database,
          state.context,
          asOfDay,
          state.indexes.managerDispositionRecords,
          state.sources,
        ),
        publicChanges: state.publicChanges,
        ...(overviewView ? { overview: overviewView } : {}),
      }
    },

    getServiceReadiness(vinInput, contextInput = {}) {
      const state = snapshot(contextInput)
      const vin = normalizedVin(vinInput)
      const source = state.sources.find((candidate) => candidate.vin === vin)
      const vehicle = source && vehicleFromSnapshot(state, source)
      if (!vehicle) throw new WorkflowError('Vehicle was not found.', { status: 404, code: 'VEHICLE_NOT_FOUND' })
      return serviceDetail(vehicle, state.serviceEventsByVin.get(vin) ?? [], state.context)
    },

    listSavedVehicleLists(contextInput = {}) {
      const state = snapshot(contextInput)
      if (!state.savedListsStorage) return { lists: [] }
      const ownerUserId = savedListOwnerId(state.context)
      const availableVins = new Set(state.sources
        .filter(currentInventoryRecord)
        .filter((source) => Boolean(vehicleFromSnapshot(state, source)))
        .map((source) => source.vin))
      return {
        lists: listSavedVehicleListRows(database, ownerUserId)
          .map((row) => savedListView(row, availableVins)),
      }
    },

    mutateSavedVehicleList(input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      if (!state.savedListsStorage) {
        throw new WorkflowError('Saved-list storage is not enabled yet.', { status: 503, code: 'MIGRATION_REQUIRED' })
      }
      const mutation = normalizeSavedListMutation(input, state.context, idempotencyKey, state.currentNow)
      const result = persistSavedVehicleListMutation(database, mutation)
      const availableVins = new Set(state.sources
        .filter(currentInventoryRecord)
        .filter((source) => Boolean(vehicleFromSnapshot(state, source)))
        .map((source) => source.vin))
      return {
        created: mutation.action === 'create' && result.replayed !== true,
        record: savedListView(result.result, availableVins),
      }
    },

    getDisposition(vinInput, contextInput = {}) {
      const state = snapshot(contextInput)
      const vin = normalizedVin(vinInput)
      const source = state.sources.find((candidate) => candidate.vin === vin)
      const vehicle = source && vehicleFromSnapshot(state, source)
      if (!vehicle) throw new WorkflowError('Vehicle was not found.', { status: 404, code: 'VEHICLE_NOT_FOUND' })
      return { ...dispositionDetail(source, state.dispositionEventsByVin.get(vin) ?? [], state.context, { enabled: state.dispositionStorage }), otherEnabled: state.manualHoldStorage }
    },

    updateDisposition(vinInput, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const vin = normalizedVin(vinInput)
      const source = state.sources.find((candidate) => candidate.vin === vin)
      const vehicle = source && vehicleFromSnapshot(state, source)
      if (!vehicle) throw new WorkflowError('Vehicle was not found.', { status: 404, code: 'VEHICLE_NOT_FOUND' })
      const rows = state.dispositionEventsByVin.get(vin) ?? []
      if (input?.disposition === 'other' && !state.manualHoldStorage) throw new WorkflowError('Manual inventory controls require migration 0015.', { status: 503, code: 'MIGRATION_REQUIRED' })
      const result = buildDispositionEvent(source, rows, input, state.context, {
        now: state.currentNow,
        today: dateInTimeZone(state.currentNow, state.meta.timezone),
        idempotencyKey,
        enabled: state.dispositionStorage,
      })
      if (result.created) {
        insertDispositionEvent(database, result.row)
        rows.push(result.row)
      }
      return { created: result.created, record: { ...dispositionDetail(source, rows, state.context, { enabled: state.dispositionStorage }), otherEnabled: state.manualHoldStorage } }
    },

    getManualHold(vinInput, contextInput = {}) {
      const state = snapshot(contextInput)
      const source = state.sources.find(candidate => candidate.vin === normalizedVin(vinInput))
      if (!source || !vehicleFromSnapshot(state, source)) throw new WorkflowError('Vehicle was not found.', { status: 404, code: 'VEHICLE_NOT_FOUND' })
      return manualHoldDetail(source, state.manualHoldEventsByVin.get(source.vin) ?? [], state.context, { enabled: state.manualHoldStorage })
    },

    updateManualHold(vinInput, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const source = state.sources.find(candidate => candidate.vin === normalizedVin(vinInput))
      if (!source || !vehicleFromSnapshot(state, source)) throw new WorkflowError('Vehicle was not found.', { status: 404, code: 'VEHICLE_NOT_FOUND' })
      const rows = state.manualHoldEventsByVin.get(source.vin) ?? []
      const result = buildManualHoldEvent(source, rows, input, state.context, { now: state.currentNow, idempotencyKey, enabled: state.manualHoldStorage })
      if (result.created) { insertManualHoldEvent(database, result.row); rows.push(result.row) }
      return { created: result.created, record: manualHoldDetail(source, rows, state.context, { enabled: state.manualHoldStorage }) }
    },

    listVehicleIssues(query = {}, contextInput = {}) {
      const state = issueSnapshot(contextInput)
      if (!query || typeof query !== 'object' || Array.isArray(query) ||
          Object.keys(query).some((key) => !['vin', 'store', 'status', 'category', 'priority', 'limit', 'offset'].includes(key))) {
        throw new WorkflowError('Unsupported vehicle issue filter.', { code: 'INVALID_ISSUE_FILTER' })
      }
      if ((query.store && !STORE_NAMES.includes(query.store)) ||
          (query.status && !VEHICLE_ISSUE_STATUSES.includes(query.status)) ||
          (query.category && !VEHICLE_ISSUE_CATEGORIES.includes(query.category)) ||
          (query.priority && !['normal', 'urgent'].includes(query.priority))) {
        throw new WorkflowError('Choose a valid vehicle issue filter.', { code: 'INVALID_ISSUE_FILTER' })
      }
      const vin = query.vin ? normalizedVin(query.vin) : null
      const items = issueRecords(state).filter((issue) => (!vin || issue.vin === vin) &&
        (!query.store || issue.reportStore === query.store) && (!query.status || issue.status === query.status) &&
        (!query.category || issue.category === query.category) && (!query.priority || issue.priority === query.priority))
      const offset = integerQuery(query.offset, 0, { min: 0, max: 100000 })
      const limit = integerQuery(query.limit, 100, { min: 1, max: 500 })
      return { items: items.slice(offset, offset + limit), total: items.length }
    },

    getVehicleIssue(id, contextInput = {}) {
      const state = issueSnapshot(contextInput)
      const issue = state.issues.find((row) => row.id === id)
      if (!issue) throw new WorkflowError('Vehicle issue was not found.', { status: 404, code: 'VEHICLE_ISSUE_NOT_FOUND' })
      return vehicleIssueView(issue, state.eventsByIssue.get(id) ?? [], state.context, { detail: true })
    },

    createVehicleIssue(vinInput, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const issueState = issueSnapshot(contextInput)
      requireIssueStorage(issueState)
      const vin = normalizedVin(vinInput)
      const source = state.sources.find((candidate) => candidate.vin === vin)
      const vehicle = source && vehicleFromSnapshot(state, source)
      const result = buildVehicleIssue({
        vin, vehicle, issues: issueState.issues, input, context: issueState.context,
        idempotencyKey, now: state.currentNow,
      })
      if (result.created) insertVehicleIssue(database, result.issue, result.event)
      return { created: result.created, record: this.getVehicleIssue(result.issue.id, contextInput) }
    },

    appendVehicleIssueEvent(id, input, contextInput = {}, idempotencyKey) {
      const state = issueSnapshot(contextInput)
      requireIssueStorage(state)
      const issue = state.issues.find((row) => row.id === id)
      if (!issue) throw new WorkflowError('Vehicle issue was not found.', { status: 404, code: 'VEHICLE_ISSUE_NOT_FOUND' })
      const result = buildVehicleIssueEvent({
        issue, rows: state.eventsByIssue.get(id) ?? [], input, context: state.context,
        idempotencyKey, now: now(),
      })
      if (result.created) appendVehicleIssueEvent(database, result.event)
      return { created: result.created, record: this.getVehicleIssue(id, contextInput) }
    },

    updateServiceReadiness(vinInput, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const vin = normalizedVin(vinInput)
      const source = state.sources.find((candidate) => candidate.vin === vin)
      const vehicle = source && vehicleFromSnapshot(state, source)
      if (!vehicle) throw new WorkflowError('Vehicle was not found.', { status: 404, code: 'VEHICLE_NOT_FOUND' })
      const rows = state.serviceEventsByVin.get(vin) ?? []
      const result = buildServiceReadinessEvent(vehicle, rows, input, state.context, {
        now: state.currentNow, today: dateInTimeZone(state.currentNow, state.meta.timezone), idempotencyKey,
      })
      if (result.created) {
        insertServiceEvent(database, result.row)
        rows.push(result.row)
      }
      // A delayed retry confirms the original write without presenting it as
      // current after another manager has already saved a newer version.
      return { created: result.created, record: serviceDetail(vehicle, rows, state.context) }
    },

    listAttention(query = {}, contextInput = {}) {
      const state = snapshot(contextInput)
      let items = attentionFromSnapshot(state)
      if (query.store) items = items.filter((item) => item.store === query.store || item.relatedStores?.includes(query.store))
      if (query.status) items = items.filter((item) => item.status === query.status)
      if (query.priority) items = items.filter((item) => item.priority === query.priority)
      if (query.type) items = items.filter((item) => item.type === query.type)
      if (query.assignedTo) {
        const assignedTo = String(query.assignedTo).toLowerCase()
        items = items.filter((item) => String(item.assignedTo ?? '').toLowerCase().includes(assignedTo))
      }
      if (query.q) {
        const search = String(query.q).toLowerCase()
        items = items.filter((item) =>
          [item.label, item.vehicleName, item.stockNumber, item.vin, item.store, item.assignedTo, item.sourceLabel]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(search),
        )
      }
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
      const statusOrder = { open: 0, acknowledged: 1, in_progress: 2, waiting: 3, resolved: 4 }
      items.sort(
        (left, right) =>
          (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9) ||
          (priorityOrder[left.priority] ?? 9) - (priorityOrder[right.priority] ?? 9) ||
          String(left.followUpAt || left.dueAt || '').localeCompare(String(right.followUpAt || right.dueAt || '')) ||
          left.label.localeCompare(right.label),
      )
      return {
        items,
        total: items.length,
        counts: {
          open: items.filter((item) => item.status === 'open').length,
          acknowledged: items.filter((item) => item.status === 'acknowledged').length,
          inProgress: items.filter((item) => item.status === 'in_progress').length,
          waiting: items.filter((item) => item.status === 'waiting').length,
          resolved: items.filter((item) => item.status === 'resolved').length,
          urgent: items.filter((item) => item.priority === 'urgent' && item.status !== 'resolved').length,
          unassigned: items.filter((item) => !item.assignedTo && item.status !== 'resolved').length,
        },
      }
    },

    getAttention(id, contextInput = {}) {
      const state = snapshot(contextInput)
      const item = attentionFromSnapshot(state).find((candidate) => candidate.id === id)
      if (!item) throw new WorkflowError('Attention item was not found', { status: 404, code: 'ATTENTION_NOT_FOUND' })
      return item
    },

    appendAttentionEvent(id, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const sourceItem = attentionFromSnapshot(state).find((candidate) => candidate.id === id)
      if (!sourceItem) throw new WorkflowError('Attention item was not found', { status: 404, code: 'ATTENTION_NOT_FOUND' })
      const replayKey = String(idempotencyKey ?? '').trim()
      const replay = replayKey && getAttentionEvents(database, id).find((event) => event.idempotency_key === replayKey)
      if (replay) {
        let inputHash
        try { inputHash = attentionInputHash(input, state.context) } catch { /* A different or invalid retry conflicts. */ }
        if (!replay.input_hash || replay.input_hash !== inputHash) {
          throw new WorkflowError('This action key belongs to another action', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
        }
        return { record: sourceItem, created: false }
      }
      const current = getAttentionWorkflowRow(database, id)
      const built = buildAttentionMutation({
        sourceItem,
        current,
        input,
        context: state.context,
        idempotencyKey,
        now: state.currentNow,
      })
      const result = upsertAttentionWorkflow(database, built.workflow, built.event)
      const record = this.getAttention(id, contextInput)
      return { record, created: result.created }
    },

    listVehicles(query = {}, contextInput = {}) {
      const state = snapshot(contextInput)
      let vehicles = state.sources
        .filter(currentInventoryRecord)
        .map((source) => ({
          vehicle: vehicleFromSnapshot(state, source),
          privateIndex: state.context.canViewPrivateEvidence ? privateSearchText(source) : '',
        }))
        .filter(({ vehicle }) => Boolean(vehicle))
        .filter(({ vehicle, privateIndex }) => matchesVehicleFilters(vehicle, query, privateIndex))
        .map(({ vehicle }) => vehicle)
      vehicles = sortVehicles(vehicles, query.sort, query.order)
      const total = vehicles.length
      const offset = integerQuery(query.offset, 0, { min: 0, max: 100_000 })
      const limit = integerQuery(query.limit, 100, { min: 1, max: 500 })
      return {
        items: vehicles.slice(offset, offset + limit),
        total,
        limit,
        offset,
        meta: publicMeta(state.meta),
      }
    },

    getVehicle(vinInput, contextInput = {}) {
      const vin = normalizedVin(vinInput)
      const state = snapshot(contextInput)
      if (!state.indexes.vins.has(vin)) {
        throw new WorkflowError('Vehicle was not found in the current verified source release', {
          status: 404,
          code: 'VEHICLE_NOT_FOUND',
        })
      }
      return vehicleFromSnapshot(state, sourceVehicle(state.indexes, vin), {
        includePrivate: state.context.canViewPrivateEvidence,
        includePublicScan: true,
      })
    },

    listTransfers(query = {}, contextInput = {}) {
      const state = snapshot(contextInput)
      const rows = listTransferRows(database, {
        vin: query.vin,
        status: query.status,
        store: query.store,
      }).filter((row) => transferVisible(row, state.context))
      return {
        items: rows.map((row) =>
          transferView(
            row,
            getTransferEvents(database, row.id),
            sourceVehicle(state.indexes, row.vin),
            state.context,
            state.meta,
            { includePrivate: false },
          ),
        ),
        total: rows.length,
      }
    },

    getTransfer(id, contextInput = {}) {
      const state = snapshot(contextInput)
      const row = getTransferRow(database, id)
      if (!row || !transferVisible(row, state.context)) {
        throw new WorkflowError('That vehicle move was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
      }
      return transferView(
        row,
        getTransferEvents(database, id),
        sourceVehicle(state.indexes, row.vin),
        state.context,
        state.meta,
        { includePrivate: state.context.canViewPrivateEvidence },
      )
    },

    createTransfer(input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const vin = normalizedVin(input?.vin)
      const source = state.indexes.vins.has(vin) ? sourceVehicle(state.indexes, vin) : null
      const replayKey = String(idempotencyKey ?? '').trim()
      const replayCandidate = replayKey
        ? state.allTransferRows.find((row) => row.idempotency_key === replayKey)
        : null
      const vinRows = state.transfersByVin.get(vin) ?? []
      const directIntent = String(input?.intent ?? '').trim().toLowerCase() === 'direct'
      if (replayCandidate) {
        const conflict = () => {
          throw new WorkflowError('This request key belongs to another request', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
        }
        if (replayCandidate.vin !== vin) conflict()
        const initial = getTransferEvents(database, replayCandidate.id).find((event) =>
          ['requested', 'direct_move_recorded'].includes(event.event_type))
        if (!initial) conflict()
        const replayInput = directIntent && !input?.movedAt && initial.occurred_at === replayCandidate.requested_at
          ? { ...input, movedAt: initial.occurred_at }
          : input
        let replayBuild
        try {
          replayBuild = buildTransferRequest({
            input: { ...replayInput, vin },
            vehicle: {
              vin,
              homeAssignment: { home_store_id: replayCandidate.home_store_id },
              movementHomeStore: replayCandidate.home_store_id,
              movementCurrentLocation: initial.from_location_id,
              publicRecord: {
                vehicle_name: replayCandidate.vehicle_name_at_request,
                stock_number: replayCandidate.stock_at_request,
              },
            },
            context: state.context,
            idempotencyKey,
            now: new Date(replayCandidate.requested_at),
          })
        } catch {
          conflict()
        }
        const sameActor = state.context.userId
          ? initial.actor_user_id === state.context.userId
          : !cleanText(initial.actor_user_id) && initial.actor === state.context.user
        const sameMutation =
          replayCandidate.requested_by === replayBuild.request.requestedBy &&
          (replayCandidate.needed_by ?? null) === (replayBuild.request.neededBy ?? null) &&
          replayCandidate.reason === replayBuild.request.reason &&
          (replayCandidate.customer_reference ?? null) === (replayBuild.request.customerReference ?? null) &&
          Boolean(replayCandidate.customer_appointment) === replayBuild.request.customerAppointment &&
          (replayCandidate.approval_owner ?? null) === (replayBuild.request.approvalOwner ?? null) &&
          replayCandidate.priority === replayBuild.request.priority &&
          Boolean(replayCandidate.return_required) === replayBuild.request.returnRequired &&
          (replayCandidate.return_due_at ?? null) === (replayBuild.request.returnDueAt ?? null) &&
          (initial.event_type !== 'direct_move_recorded' || initial.occurred_at === replayBuild.initialEvent.occurredAt)
        if (replayCandidate.requesting_store_id !== replayBuild.request.requestingStoreId ||
            replayCandidate.destination_store_id !== replayBuild.request.destinationStoreId ||
            initial.event_type !== replayBuild.initialEvent.eventType ||
            initial.store_id !== state.context.store ||
            !sameActor || initial.actor_role !== state.context.authenticatedRole ||
            !sameMutation) conflict()
        return { record: this.getTransfer(replayCandidate.id, contextInput), created: false }
      }

      const location = (workflowMode === 'simple' || directIntent) ? physicalLocationAuthority(vinRows, database) : null
      const requestBlocked = newRequestBlocked(vinRows, workflowMode)
      const blockingRows = workflowMode === 'simple' ? vinRows.filter(blocksNewSimpleRequest) : []
      const activeDirect = blockingRows.length === 1 && directMoveInitial(blockingRows[0], database)
        ? blockingRows[0]
        : null
      const canSupersedeDirect = Boolean(directIntent && activeDirect &&
        (state.context.role === 'group_manager' ||
          (state.context.role === 'manager' && state.context.store === activeDirect.home_store_id)))
      const built = buildTransferRequest({
        input: { ...input, vin },
        vehicle: source
          ? {
              ...source,
              existingMoveBlocked: requestBlocked,
              ...(location && !location.conflicting ? {
                movementHomeStore: location.row.home_store_id,
                movementCurrentLocation: location.row.current_location_id,
              } : {}),
            }
          : source,
        context: state.context,
        idempotencyKey,
        now: state.currentNow,
      })
      if (built.initialEvent.eventType === 'direct_move_recorded' && (!requestBlocked || canSupersedeDirect)) {
        if (location?.conflicting) {
          throw new WorkflowError('The vehicle location has conflicting physical records and must be resolved before moving it', {
            status: 409,
            code: 'LOCATION_CONFLICT',
          })
        }
        const movedTime = Date.parse(built.initialEvent.occurredAt)
        if (Number.isFinite(location?.time) && movedTime <= location.time) {
          throw new WorkflowError('movedAt must be later than the latest recorded physical location update', {
            status: 409,
            code: 'MOVE_CHRONOLOGY_CONFLICT',
            details: { latestPhysicalAt: new Date(location.time).toISOString() },
          })
        }
      }
      if (requestBlocked) {
        if (canSupersedeDirect) {
          if (location?.row.current_location_id === built.request.destinationStoreId) {
            throw new WorkflowError('Destination store must be different from the vehicle current location', {
              details: {
                currentLocation: location.row.current_location_id,
                destinationStore: built.request.destinationStoreId,
              },
            })
          }
          built.request.enforceSingleActive = true
          const supersedeEvent = {
            eventType: 'direct_move_superseded',
            label: 'Direct move superseded by a new destination',
            actor: state.context.user,
            actorUserId: state.context.userId,
            actorRole: state.context.authenticatedRole,
            storeId: state.context.store,
            fromLocationId: location?.row.current_location_id || activeDirect.current_location_id,
            toLocationId: built.request.destinationStoreId,
            occurredAt: built.initialEvent.occurredAt,
            confirmedBy: state.context.user,
            note: null,
            createdAt: state.currentNow.toISOString(),
            idempotencyKey: built.request.idempotencyKey
              ? `${built.request.idempotencyKey}:supersede:${activeDirect.id}`
              : null,
          }
          const result = supersedeTransferRequest(
            database,
            activeDirect.id,
            activeDirect.updated_at,
            supersedeEvent,
            built.request,
            built.initialEvent,
          )
          return { record: this.getTransfer(result.row.id, contextInput), created: result.created }
        }
        // Do not reveal another store's private request identity or details.
        throw new WorkflowError('This vehicle already has an open move request. Review its location and ask your manager before starting another.', {
          status: 409, code: 'ACTIVE_TRANSFER_EXISTS',
        })
      }
      built.request.enforceSingleActive = workflowMode === 'simple'
      const result = insertTransferRequest(database, built.request, built.initialEvent)
      const record = this.getTransfer(result.row.id, contextInput)
      return { record, created: result.created }
    },

    appendTransferEvent(id, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const current = getTransferRow(database, id)
      if (!current) {
        throw new WorkflowError('That vehicle move was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
      }
      const events = getTransferEvents(database, id)
      const replay = idempotencyKey && events.find((event) => event.idempotency_key === idempotencyKey)
      const recordView = (row) =>
        transferView(
          row,
          getTransferEvents(database, id),
          sourceVehicle(state.indexes, row.vin),
          state.context,
          state.meta,
          { includePrivate: state.context.canViewPrivateEvidence },
        )
      const replayType = String(input?.type ?? '').trim().toLowerCase()
      const replayPayloadMatches = replay
        ? transferEventReplayPayloadMatches(replay, input, state.context, current, events)
        : false
      const stableReplayActor = replay && cleanText(replay.actor_user_id)
      const stableReplayAuthorized = Boolean(
        stableReplayActor &&
        state.context.userId &&
        stableReplayActor === state.context.userId &&
        replay.actor_role === state.context.authenticatedRole &&
        replay.event_type === replayType &&
        replayPayloadMatches,
      )
      const mutationAuthorized = transferMutationAuthorized(current, state.context)
      if (stableReplayAuthorized && mutationAuthorized) return { record: recordView(current), created: false }
      // Arrival is the one transport mutation that intentionally ends the
      // assignee's scope. Permit only that exact stable-ID replay and return an
      // immutable receipt, never the evolving current transfer record.
      if (
        stableReplayAuthorized &&
        !mutationAuthorized &&
        replay.event_type === 'arrived' &&
        ['porter', 'driver'].includes(state.context.role)
      ) {
        return {
          record: {
            id: current.id,
            vin: current.vin,
            stockNumber: current.stock_at_request,
            requestStatus: 'arrived',
            movementStatus: 'at_requesting_store',
            replayed: true,
          },
          created: false,
        }
      }
      if (!mutationAuthorized) {
        throw new WorkflowError('That vehicle move was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
      }
      if (replay) {
        const legacyReplayAuthorized = !cleanText(replay.actor_user_id) &&
          !state.context.userId &&
          replay.actor === state.context.user &&
          replay.actor_role === state.context.authenticatedRole &&
          replay.event_type === replayType &&
          replayPayloadMatches
        if (!legacyReplayAuthorized) {
          throw new WorkflowError('This action key belongs to another action', { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
        }
        return { record: recordView(current), created: false }
      }
      const built = buildTransferEvent({
        current,
        input,
        context: state.context,
        idempotencyKey,
        now: state.currentNow,
      })
      const result = appendTransferEvent(database, id, built.event, built.requestPatch)
      const record = recordView(result.row)
      return { record, created: result.created }
    },
  }
}

export const serviceInternals = Object.freeze({
  dateInTimeZone,
  daysBetween,
  dealerMailPrivateEvidence,
  privateSearchText,
  holdSummary,
  isActiveTransfer,
  blocksNewSimpleRequest,
  newRequestBlocked,
  transferVisible,
  transferMutationAuthorized,
  allowedUiActions,
})
