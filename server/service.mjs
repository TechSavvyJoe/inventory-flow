import { createHash } from 'node:crypto'
import {
  appendTransferEvent,
  getAttentionEvents,
  getAttentionWorkflowRow,
  getCurrentDataset,
  getTransferEvents,
  getTransferRow,
  insertTransferRequest,
  listAttentionWorkflowRows,
  listTransferRows,
  upsertAttentionWorkflow,
} from './database.mjs'
import { allowedAttentionActions, buildAttentionMutation } from './attention-workflow.mjs'
import { STORE_NAMES } from './importer.mjs'
import { allowedEventTypes, buildTransferEvent, buildTransferRequest, roleContext, WorkflowError } from './workflow.mjs'

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const TERMINAL_TRANSFER_STATES = new Set(['declined', 'canceled', 'closed'])
const RETURN_COMPLETE_STATES = new Set(['returned_home', 'closed'])

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

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function daysBetween(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start ?? '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end ?? ''))) {
    return null
  }
  const startTime = Date.parse(`${start}T00:00:00Z`)
  const endTime = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
  return Math.max(0, Math.floor((endTime - startTime) / 86_400_000))
}

function dateIsBeforeReport(value, reportDate) {
  if (!value || !reportDate) return false
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) && /^\d{4}-\d{2}-\d{2}$/.test(String(reportDate))) {
    return String(value) < String(reportDate)
  }
  const valueTime = Date.parse(String(value))
  const reportTime = Date.parse(`${reportDate}T00:00:00`)
  return Number.isFinite(valueTime) && Number.isFinite(reportTime) && valueTime < reportTime
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
  const vins = new Set([...publicByVin.keys(), ...crmByVin.keys()])
  return { publicByVin, crmByVin, holdByVin, resourceByVin, homeByVin, vins }
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
    homeAssignment: indexes.homeByVin.get(vin) ?? null,
  }
}

function primaryAndBackups(holdRecord) {
  const active = (holdRecord?.holdDetailRows ?? []).filter((row) => row?.lifecycleStatus === 'active')
  const primary = active.find((row) => row?.holdPosition === 'primary' || Number(row?.holdOrderNumber) === 1) ?? null
  const backups = active.filter((row) => row !== primary && (row?.holdPosition === 'backup' || Number(row?.holdOrderNumber) > 1))
  return { active, primary, backups }
}

function holdSummary(source, context, freshness, { includePrivate = false } = {}) {
  const holdRecord = source.holdRecord
  const crmRecord = source.crmRecord
  if (freshness !== 'current') {
    return {
      state: holdRecord ? 'stale' : crmRecord ? 'stale' : 'unknown',
      label: holdRecord ? 'Last verified hold — confirm in DealerMail' : 'Hold status stale — confirm in DealerMail',
      backupCount: holdRecord ? primaryAndBackups(holdRecord).backups.length : 0,
    }
  }
  if (!crmRecord) return { state: 'unknown', label: 'Not found in current CRM inventory', backupCount: 0 }
  if (!holdRecord) return { state: 'none_observed', label: 'No hold observed in verified CRM snapshot', backupCount: 0 }

  const { primary, backups } = primaryAndBackups(holdRecord)
  const summary = {
    state: backups.length ? 'multiple' : 'primary',
    label: backups.length ? `Primary hold + ${backups.length} backup${backups.length === 1 ? '' : 's'}` : 'Primary hold',
    backupCount: backups.length,
    expectedDate: cleanText(primary?.expectedDeliveryDateRaw),
    commentsCount: (holdRecord.comments ?? []).reduce(
      (count, group) => count + (Array.isArray(group?.rows) ? group.rows.length : 0),
      0,
    ),
    alertsCount: Array.isArray(holdRecord.alerts) ? holdRecord.alerts.length : 0,
  }
  if (!['driver', 'porter', 'coordinator'].includes(context.role)) summary.primarySalesperson = cleanText(primary?.salespersonRaw)
  if (includePrivate && context.canViewPrivateEvidence) summary.reason = cleanText(primary?.customerOrReasonRaw)
  return summary
}

function simplifyComments(holdRecord) {
  return (holdRecord?.comments ?? []).flatMap((group) =>
    (group?.rows ?? []).map((row) => ({
      author: cleanText(row?.authorRaw),
      text: cleanText(row?.commentTextRaw),
      timestamp: cleanText(row?.timestampRaw),
    })),
  )
}

function simplifyAlerts(holdRecord) {
  return (holdRecord?.alerts ?? []).map((alert) => ({
    text: cleanText(alert?.alertTextRaw ?? alert?.textRaw ?? alert?.bodyTextRaw),
    author: cleanText(alert?.authorRaw),
    timestamp: cleanText(alert?.timestampRaw),
  }))
}

function dealerMailPrivateEvidence(source) {
  if (!source.holdRecord) return undefined
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
    comments: simplifyComments(source.holdRecord),
    alerts: simplifyAlerts(source.holdRecord),
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
    ...(evidence?.alerts ?? []).map((alert) => alert.text),
    ...(evidence?.alerts ?? []).map((alert) => alert.author),
    evidence?.cdk?.status,
    evidence?.cdk?.result,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isActiveTransfer(row) {
  return row && !TERMINAL_TRANSFER_STATES.has(row.status)
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
  const events = new Set(allowedEventTypes(row.status, context.role))
  if (context.role !== 'group_manager') {
    const requestingStoreAction = context.store === row.requesting_store_id
    const homeStoreAction = context.store === row.home_store_id
    if (!requestingStoreAction) {
      events.delete('manager_reviewed')
      events.delete('approved')
      events.delete('declined')
      events.delete('driver_requested')
      events.delete('transport_assigned')
      events.delete('return_assigned')
    }
    if (!homeStoreAction) events.delete('returned_home')
  }
  const actions = []
  const add = (action, condition) => {
    if (condition && !actions.includes(action)) actions.push(action)
  }
  add('approve', events.has('approved'))
  add('review-request', events.has('manager_reviewed'))
  add('decline', events.has('declined'))
  add('request-driver', events.has('driver_requested'))
  add('assign-transport', events.has('transport_assigned') || events.has('return_assigned'))
  add('confirm-pickup', events.has('picked_up') || events.has('return_in_transit'))
  add('confirm-arrival', events.has('arrived'))
  add(
    'record-outcome',
    ['customer_showing', 'sale_outcome_pending', 'sale_confirmed', 'delivery_confirmed', 'not_sold'].some((event) =>
      events.has(event),
    ),
  )
  add('schedule-return', events.has('return_requested'))
  add('confirm-return', events.has('returned_home'))
  add('mark-exception', events.has('location_exception'))
  add('report-condition', events.has('condition_issue'))
  add('escalate', events.has('escalated'))
  add('open-source', true)
  add('close', events.has('closed'))
  return actions
}

function transferView(row, events, source, context, dealerMailFreshness, { includePrivate = false } = {}) {
  const record = {
    id: row.id,
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
    dealerMailHoldState: holdStateForTransfer(source, dealerMailFreshness),
    publicListingState: source.publicRecord ? 'Listed publicly; availability not confirmed' : 'Not in current public release',
    cdkStatus: cdkStatus(source),
    priority: row.priority,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    approvedBy: cleanText(row.approved_by),
    custodian: cleanText(row.current_custodian),
    transportAssignee: cleanText(row.transport_assignee),
    nextAction: row.next_action,
    nextActionOwner: cleanText(row.next_action_owner) ?? 'Unassigned',
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

function movementSummary(source, activeTransfer, transfer, publicFreshness) {
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
      dueAt: transfer.dueAt,
      returnRequired: transfer.returnRequired,
      returnDueAt: transfer.returnDueAt,
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
    source.vin
  )
}

const PUBLIC_PHOTO_HOSTS = new Set([
  'www.bobmaxeyfordhowell.com',
  'www.bobmaxeyfordinfowlerville.com',
  'www.bobmaxeyford.com',
  'www.bobmaxeylincoln.com',
])

function publicPhotoUrls(publicRecord) {
  if (!publicRecord) return []
  const vin = cleanText(publicRecord.vin)?.toLowerCase()
  if (!vin) return []
  const storedGallery = Array.isArray(publicRecord.photo_urls) ? publicRecord.photo_urls : []
  const candidates = storedGallery.length ? storedGallery : [publicRecord.photo_preview_url]
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
  const homeStore = source.homeAssignment?.home_store_id || publicStore
  const latest = transferRows[0] ?? null
  const active = transferRows.find(isActiveTransfer) ?? null
  const activeEvents = active ? getTransferEvents(meta.database, active.id) : []
  const activeTransferView = active
    ? transferView(active, activeEvents, source, context, meta.dealerMailFreshness, { includePrivate: false })
    : null
  const reportDate = meta.reportDate
  const name = vehicleName(source)
  const year = publicRecord?.year ?? finiteNumber(crmRecord?.yearRaw) ?? cleanText(crmRecord?.yearRaw)
  const stockNumber = cleanText(publicRecord?.stock_number) || cleanText(crmRecord?.stockNumber) || ''
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
  const autoCheckReport = independentAutoCheckReport
    ? { ...independentAutoCheckReport, dataState: independentResourceState(independentAutoCheckReport) }
    : publicRecord?.autoCheckReport
      ? { ...publicRecord.autoCheckReport, dataState: publicVehicleResourceState(publicRecord.autoCheckReport) }
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
    daysListed: daysBetween(publicRecord?.inventory_date, reportDate),
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
    websiteStatus: publicRecord ? cleanText(publicRecord.availability) || 'Not provided' : 'Not publicly listed',
    publicListingState: publicRecord
      ? meta.publicFreshness === 'current'
        ? 'Listed publicly; availability not confirmed'
        : 'Last verified public listing — availability not confirmed'
      : 'Not publicly listed in verified release',
    dealerOn: {
      inStock: typeof publicRecord?.in_stock === 'boolean' ? publicRecord.in_stock : null,
      inTransit: typeof publicRecord?.in_transit === 'boolean' ? publicRecord.in_transit : null,
      inProduction: typeof publicRecord?.in_production === 'boolean' ? publicRecord.in_production : null,
    },
    hold,
    movement: movementSummary(source, active, activeTransferView, meta.publicFreshness),
    changeSummary: cleanText(publicRecord?.change_summary),
    dataStatus: cleanText(publicRecord?.data_status) || (crmRecord ? 'CRM only — no current public listing' : 'Unknown'),
    ...(includePublicScan && publicRecord ? { publicScan: publicScanAudit(publicRecord) } : {}),
    ...(autoCheckReport ? { autoCheckReport } : {}),
    ...(windowSticker ? { windowSticker } : {}),
    ...(factoryEquipment ? { factoryEquipment } : {}),
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
    enrichmentRows,
  }
  for (const source of sources) {
    const imageUrls = publicPhotoUrls(source.publicRecord)
    const hasPhotos = imageUrls.length > 0
    const hasAutoCheck = Boolean(source.resourceRecord?.autoCheckReport || source.publicRecord?.autoCheckReport)
    const hasWindowSticker = Boolean(source.publicRecord?.windowSticker)
    const hasFactoryEquipment = Boolean(source.resourceRecord?.factoryEquipment)
    if (hasPhotos || hasAutoCheck || hasWindowSticker || hasFactoryEquipment) coverage.vehicles += 1
    if (hasPhotos) coverage.photos += 1
    coverage.photoUrls += imageUrls.length
    if (hasAutoCheck) coverage.autoCheck += 1
    if (hasWindowSticker) coverage.windowStickers += 1
    if (hasFactoryEquipment) coverage.factoryEquipment += 1
  }
  return coverage
}

function transferVisible(row, context) {
  if (context.role === 'manager' || context.role === 'group_manager') return true
  if (context.role === 'coordinator') {
    return [row.home_store_id, row.requesting_store_id, row.destination_store_id].includes(context.store)
  }
  if (context.role === 'sales') {
    return [row.home_store_id, row.requesting_store_id, row.destination_store_id].includes(context.store)
  }
  return (
    row.transport_assignee === context.user ||
    ['transport_assigned', 'picked_up', 'in_transit', 'return_assigned', 'return_in_transit'].includes(row.movement_status)
  )
}

function metaView(dataset, database, now, loadStatus) {
  const manifest = parseJson(dataset.state.current_manifest_json, {})
  const timeZone = manifest.timezone || 'America/New_York'
  const publicFreshness = currentFreshness(dataset.sourceRuns.public, { now, timeZone, loadStatus })
  const dealerMailFreshness = currentFreshness(dataset.sourceRuns.dealerMail, { now, timeZone, loadStatus })
  const resourceFreshness = currentFreshness(dataset.sourceRuns.resources, { now, timeZone, loadStatus })
  const warnings = parseJson(dataset.state.current_release_warnings_json, [])
  if (loadStatus?.error) warnings.push(`Latest source refresh failed; retained prior verified data as stale/unverified: ${loadStatus.error}`)
  if (dealerMailFreshness !== 'current') {
    warnings.push('DealerMail hold absence or release cannot be concluded from stale or incomplete data.')
  }
  const rawChangeCounts = manifest.public_change_counts ?? {}
  const safeChangeCount = (key) => positiveInteger(rawChangeCounts[key]) ?? 0
  const publicChangeBaseline = parseJson(dataset.state.current_public_change_baseline_json, null)
  return {
    reportDate: dataset.state.current_report_date || dataset.sourceRuns.public?.report_date || '',
    completedAt: manifest.completed_at || dataset.sourceRuns.public?.loaded_at || '',
    timezone: timeZone,
    publicFreshness,
    dealerMailFreshness,
    resourceFreshness,
    publicCount: dataset.publicRows.length,
    crmCount: dataset.crmRows.length,
    heldVinCount: dataset.holdRows.length,
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
  const selector = VEHICLE_SORTS[sort] ?? VEHICLE_SORTS.vehicleName
  const direction = order === 'desc' ? -1 : 1
  return vehicles.sort((left, right) => direction * compareNullable(selector(left), selector(right)) || left.vin.localeCompare(right.vin))
}

function integerQuery(value, fallback, { min = 0, max = 500 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function storeSummaries(vehicles, holdRows, transferRows, now) {
  return STORE_NAMES.map((store) => {
    const storeTransfers = transferRows.filter((row) => isActiveTransfer(row))
    const returnOverdue = storeTransfers.filter(
      (row) =>
        row.home_store_id === store &&
        Boolean(row.return_required) &&
        row.return_due_at &&
        new Date(row.return_due_at) < now &&
        !RETURN_COMPLETE_STATES.has(row.status) &&
        !RETURN_COMPLETE_STATES.has(row.movement_status),
    ).length
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

function attentionEventView(row) {
  return {
    id: row.id,
    type: row.event_type,
    label: row.label,
    actor: row.actor,
    actorRole: row.actor_role,
    store: cleanText(row.store_id),
    occurredAt: row.occurred_at,
    assignee: cleanText(row.assignee),
    followUpAt: cleanText(row.follow_up_at),
    priority: cleanText(row.priority),
    resolutionCode: cleanText(row.resolution_code),
    note: cleanText(row.note),
  }
}

function defaultAttentionPriority(item) {
  if (item.priority) return item.priority
  if (item.severity === 'critical') return 'urgent'
  if (item.severity === 'warning') return 'high'
  return 'normal'
}

function versionedAttentionId(baseId, evidence) {
  const fingerprint = createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 12)
  return `${baseId}-${fingerprint}`
}

function mergeAttentionWorkflow(database, items, context) {
  const workflows = new Map(listAttentionWorkflowRows(database).map((row) => [row.attention_key, row]))
  return items.map((item) => {
    const workflow = workflows.get(item.id)
    const record = {
      ...item,
      status: workflow?.status || 'open',
      priority: workflow?.priority || defaultAttentionPriority(item),
      assignedTo: cleanText(workflow?.assigned_to) || cleanText(item.owner),
      assignedRole: cleanText(workflow?.assigned_role),
      followUpAt: cleanText(workflow?.follow_up_at),
      resolutionCode: cleanText(workflow?.resolution_code),
      resolutionNote: cleanText(workflow?.resolution_note),
      lastUpdatedAt: cleanText(workflow?.updated_at),
      events: workflow ? getAttentionEvents(database, item.id).map(attentionEventView) : [],
    }
    record.allowedActions = allowedAttentionActions(record, context)
    return record
  })
}

function attentionItems(meta, vehicles, stores, transferRows, database, context, conditionDay) {
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
        sourceLabel: 'Inventory Flow transfer ledger',
        whyItMatters: 'A vehicle expected back at its Home Store has not been confirmed received.',
        recommendedAction: 'Open Transfers, confirm current custody, assign the return, or record Home Store receipt.',
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
    const pastExpected = dateIsBeforeReport(vehicle.hold?.expectedDate, meta.reportDate)
    const hasAlert = Number(vehicle.hold?.alertsCount) > 0
    if (!['primary', 'multiple'].includes(vehicle.hold?.state) || (!pastExpected && !hasAlert)) continue
    const store = vehicle.crmStore || vehicle.publicStore
    items.push({
      id: versionedAttentionId(`hold-review-${vehicle.vin}`, [
        conditionDay,
        meta.reportDate,
        vehicle.hold.state,
        vehicle.hold.expectedDate,
        vehicle.hold.alertsCount,
      ]),
      severity: pastExpected ? 'critical' : 'warning',
      priority: pastExpected ? 'urgent' : 'high',
      type: pastExpected ? 'past_expected_hold' : 'hold_alert',
      label: pastExpected ? 'Past-expected hold needs review' : 'Current hold includes an alert',
      vehicleName: vehicle.vehicleName,
      stockNumber: vehicle.stockNumber,
      vin: vehicle.vin,
      store,
      relatedStores: [...new Set([vehicle.publicStore, vehicle.crmStore].filter(Boolean))],
      owner: cleanText(vehicle.hold.primarySalesperson) || `${store} manager`,
      dueAt: cleanText(vehicle.hold.expectedDate),
      sourceLabel: 'Verified DealerMail hold snapshot',
      whyItMatters: pastExpected
        ? 'The expected date has passed. This is a review signal, not proof of delivery, sale, or release.'
        : 'A vehicle-level DealerMail alert is present and should be reviewed in its authorized record.',
      recommendedAction: 'Open the vehicle, review the exact hold evidence, and confirm the current operational next step.',
      href: `/inventory?scope=group&q=${encodeURIComponent(vehicle.vin)}`,
      sourceId: vehicle.vin,
    })
  }
  for (const row of transferRows.filter(isActiveTransfer).slice(0, 20)) {
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
      label: row.next_action,
      vehicleName: row.vehicle_name_at_request,
      stockNumber: row.stock_at_request,
      vin: row.vin,
      store: row.requesting_store_id,
      relatedStores: [...new Set([row.home_store_id, row.requesting_store_id, row.destination_store_id])],
      owner: cleanText(row.next_action_owner),
      dueAt: cleanText(row.due_at),
      sourceLabel: 'Inventory Flow transfer ledger',
      whyItMatters: 'This is the current app-owned handoff required to keep the vehicle request, movement, or return moving.',
      recommendedAction: row.next_action,
      href: `/transfers?id=${encodeURIComponent(row.id)}`,
      sourceId: row.id,
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

export function createInventoryService({ database, now = () => new Date(), initialLoadStatus = {} }) {
  let loadStatus = { ...initialLoadStatus }

  function snapshot(contextInput = {}) {
    const context = roleContext(contextInput)
    const dataset = getCurrentDataset(database)
    const currentNow = now()
    const meta = metaView(dataset, database, currentNow, loadStatus)
    const indexes = buildIndexes(dataset)
    const allTransferRows = listTransferRows(database)
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
      transfersByVin,
      sources,
      publicChanges: Array.isArray(publicChanges) ? publicChanges : [],
      currentNow,
    }
  }

  function vehicleFromSnapshot(state, source, options = {}) {
    return vehicleView(source, state.transfersByVin.get(source.vin) ?? [], state.context, state.meta, options)
  }

  function attentionFromSnapshot(state) {
    const vehicles = state.sources
      .filter((source) => source.publicRecord)
      .map((source) => vehicleFromSnapshot(state, source))
      .filter(Boolean)
    sortVehicles(vehicles)
    const visibleTransferRows = state.allTransferRows.filter((row) => transferVisible(row, state.context))
    const stores = storeSummaries(vehicles, state.dataset.holdRows, state.allTransferRows, state.currentNow)
    return attentionItems(
      state.meta,
      vehicles,
      stores,
      visibleTransferRows,
      database,
      state.context,
      dateInTimeZone(state.currentNow, state.meta.timezone),
    )
  }

  return {
    setLoadStatus(next) {
      loadStatus = { ...loadStatus, ...next }
    },

    health() {
      const state = snapshot({ role: 'sales', store: 'Howell', user: 'health-check' })
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
        },
        counts: {
          public: state.dataset.publicRows.length,
          crm: state.dataset.crmRows.length,
          heldVins: state.dataset.holdRows.length,
          resources: resourceCoverage.vehicles,
          resourceCoverage,
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
        },
        lastRefreshAttemptAt: loadStatus.lastAttemptAt ?? null,
        lastRefreshSuccessAt: loadStatus.lastSuccessAt ?? null,
        warnings: state.meta.warnings,
      }
    },

    bootstrap(contextInput = {}) {
      const state = snapshot(contextInput)
      if (!state.dataset.publicRows.length) {
        throw new WorkflowError('No verified public inventory release is loaded', {
          status: 503,
          code: 'SOURCE_DATA_UNAVAILABLE',
        })
      }
      const vehicles = state.sources
        .filter((source) => source.publicRecord)
        .map((source) => vehicleFromSnapshot(state, source))
        .filter(Boolean)
      sortVehicles(vehicles)
      const visibleTransferRows = state.allTransferRows.filter((row) => transferVisible(row, state.context))
      const transfers = visibleTransferRows.map((row) => {
        const source = sourceVehicle(state.indexes, row.vin)
        return transferView(
          row,
          getTransferEvents(database, row.id),
          source,
          state.context,
          state.meta.dealerMailFreshness,
          { includePrivate: false },
        )
      })
      const stores = storeSummaries(vehicles, state.dataset.holdRows, state.allTransferRows, state.currentNow)
      return {
        access: {
          user: state.context.user,
          role: state.context.role,
          store: state.context.store,
          canViewPrivateEvidence: state.context.canViewPrivateEvidence,
          canCreateTransfer: state.context.canCreateTransfer,
        },
        meta: publicMeta(state.meta),
        stores,
        vehicles,
        transfers,
        holdSignals: holdSignalSummaries(state.dataset.holdRows, state.meta),
        attention: attentionItems(
          state.meta,
          vehicles,
          stores,
          visibleTransferRows,
          database,
          state.context,
          dateInTimeZone(state.currentNow, state.meta.timezone),
        ),
        publicChanges: state.publicChanges,
      }
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
      const includeCrmOnly = query.includeCrmOnly === true || String(query.includeCrmOnly).toLowerCase() === 'true'
      let vehicles = state.sources
        .filter((source) => source.publicRecord || includeCrmOnly)
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
            state.meta.dealerMailFreshness,
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
        throw new WorkflowError('Transfer request was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
      }
      return transferView(
        row,
        getTransferEvents(database, id),
        sourceVehicle(state.indexes, row.vin),
        state.context,
        state.meta.dealerMailFreshness,
        { includePrivate: state.context.canViewPrivateEvidence },
      )
    },

    createTransfer(input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const vin = normalizedVin(input?.vin)
      const source = state.indexes.vins.has(vin) ? sourceVehicle(state.indexes, vin) : null
      const built = buildTransferRequest({
        input: { ...input, vin },
        vehicle: source,
        context: state.context,
        idempotencyKey,
        now: state.currentNow,
      })
      const result = insertTransferRequest(database, built.request, built.initialEvent)
      const record = this.getTransfer(result.row.id, contextInput)
      return { record, created: result.created }
    },

    appendTransferEvent(id, input, contextInput = {}, idempotencyKey) {
      const state = snapshot(contextInput)
      const current = getTransferRow(database, id)
      if (!current || !transferVisible(current, state.context)) {
        throw new WorkflowError('Transfer request was not found', { status: 404, code: 'TRANSFER_NOT_FOUND' })
      }
      const built = buildTransferEvent({
        current,
        input,
        context: state.context,
        idempotencyKey,
        now: state.currentNow,
      })
      const result = appendTransferEvent(database, id, built.event, built.requestPatch)
      const record = this.getTransfer(id, contextInput)
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
  transferVisible,
  allowedUiActions,
})
