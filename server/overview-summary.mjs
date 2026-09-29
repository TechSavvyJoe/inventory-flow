import { dateInTimeZone, dateIsBeforeReport, daysBetween } from './calendar-days.mjs'
import { STORE_NAMES } from './constants.mjs'

/**
 * The Overview projection (OVERVIEW_SPEC §5, §7). A pure function of the
 * role-filtered bootstrap it is attached to: the vehicles and visible transfer
 * rows that bootstrap() already built for this caller, never every ledger row.
 * It carries only codes, calendar days, counts, store names and VINs — no free
 * text from any source — and every duration is whole days in the release
 * timezone, so the bootstrap ETag stays stable within a day.
 */

export const OVERVIEW_THRESHOLDS = Object.freeze({
  unaccountedAfterDays: 7,
  agedListingDays: Object.freeze([60, 90]),
  serviceWaitingDays: Object.freeze([14, 30]),
  listedAfterDeliveredDays: 3,
  recentReceiptDays: 7,
})

// Every real user is an evidence role. Managers and group managers get the
// full Overview; sales get the same projection read-only (it holds nothing a
// salesperson does not already receive in the bootstrap). Retired transport
// roles get none.
const OVERVIEW_ACCESS = Object.freeze({ group_manager: 'full', manager: 'full', sales: 'read_only' })

export function overviewAccess(role) {
  return Object.hasOwn(OVERVIEW_ACCESS, role) ? OVERVIEW_ACCESS[role] : null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const FORD_MAKE = /^(ford|linc|lincoln)$/i
const SERVICE_STATUSES = ['needs_service', 'in_service', 'serviced']
const SERVICE_BASES = ['manager_updated', 'ford_service_history_inspection', 'autocheck_post_intake_inspection', 'new_arrival', 'unconfirmed', 'legacy_review']
const EVIDENCE_BASES = new Set(['ford_service_history_inspection', 'autocheck_post_intake_inspection'])
const TERMINAL_TRANSFER_STATES = new Set(['declined', 'canceled', 'closed'])
const PLANNED_TRANSFER_STATES = new Set(['approved', 'transport_assigned'])
const EXCEPTION_KINDS = [
  'location_conflict', 'source_conflict', 'no_app_record', 'stale_confirmation', 'return_overdue',
  'hold_past_expected', 'identity_review', 'records_incomplete', 'service_date_order',
  'listed_but_delivered', 'delivered_move_no_disposition',
]
const DISPOSITION_KEYS = ['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'none']
const CANCELED_TRANSFER_STATES = new Set(['declined', 'canceled'])
const EXCEPTION_VIN_LIMIT = 50
const AGED_WAITING_LIMIT = 100

function isoDay(value) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value
}

/** A calendar day in the release timezone from an ISO day or an instant. */
function dayOf(value, timeZone) {
  const day = isoDay(value)
  if (day) return day
  if (typeof value !== 'string' || !value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? dateInTimeZone(new Date(time), timeZone) : null
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  const n = sorted.length
  if (!n) return { value: null, n }
  const middle = Math.floor(n / 2)
  return { value: n % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, n }
}

function custodyOf(vehicle) {
  const movement = vehicle.movement ?? {}
  if (movement.locationConfidence === 'conflicting' || movement.state === 'location_exception') {
    return { custody: 'conflict', custodyBasis: 'ledger' }
  }
  if (movement.state && movement.state !== 'source_reported') {
    if (movement.currentLocation === 'In transit') return { custody: 'in_transit', custodyBasis: 'ledger' }
    if (STORE_NAMES.includes(movement.currentLocation)) {
      return {
        custody: movement.currentLocation === vehicle.homeStore ? 'on_lot' : 'away',
        custodyBasis: 'ledger',
        currentStore: movement.currentLocation,
      }
    }
    // The move ledger holds the vehicle but cannot place it.
    return { custody: 'conflict', custodyBasis: 'ledger' }
  }
  // No move ledger: the website's store is the only location evidence, and it
  // is always labelled source-reported, never read as physical custody.
  const reported = vehicle.sourceReportedLocation
  if (!STORE_NAMES.includes(reported)) return { custody: 'conflict', custodyBasis: 'source_reported' }
  return {
    custody: reported === vehicle.homeStore ? 'on_lot' : 'away',
    custodyBasis: 'source_reported',
    currentStore: reported,
  }
}

function recordsOf(vehicle) {
  const records = {
    autoCheck: vehicle.autoCheckReport?.dataState === 'current',
    oasis: vehicle.fordOasis?.dataState === 'current',
    sticker: vehicle.windowSticker?.dataState === 'current',
    invoice: vehicle.fordInvoice?.dataState === 'current',
    fordHistory: vehicle.fordOasis?.serviceHistory?.historyCaptured === true,
  }
  const ford = FORD_MAKE.test(String(vehicle.make ?? '').trim())
  const applicable = ford ? Object.keys(records) : ['autoCheck', 'sticker', 'invoice']
  return {
    records,
    recordsCaptured: applicable.filter((key) => records[key]).length,
    recordsApplicable: ford ? 5 : 3,
  }
}

function serviceFactsOf(vehicle, { row, intake, asOfDay, timeZone }) {
  const readiness = vehicle.serviceReadiness ?? {}
  const status = SERVICE_STATUSES.includes(readiness.status) ? readiness.status : 'needs_service'
  const basis = readiness.readinessBasis ?? 'unconfirmed'
  // A manager's row carries its own dates, even when null: the view's
  // evidence fallback must never date a cycle the manager reopened.
  let enteredAt = null
  let completedAt = null
  if (basis === 'manager_updated') {
    enteredAt = dayOf(row?.service_entered_at, timeZone)
    completedAt = dayOf(row?.completed_at, timeZone)
  } else if (EVIDENCE_BASES.has(basis)) {
    const evidence = readiness.readinessEvidence ?? {}
    enteredAt = isoDay(evidence.inServiceDate)
    completedAt = isoDay(evidence.readyDate ?? evidence.inspectionDate)
  }
  const intakeDay = isoDay(intake?.first_arrival_date)
  const listingDay = isoDay(vehicle.inventoryDate)
  const arrivalDate = [intakeDay, listingDay].filter(Boolean).sort()[0] ?? null
  const arrivalBasis = !arrivalDate ? 'unknown' : arrivalDate === intakeDay ? 'intake' : 'listing_date'
  const ordered = (start, end) => Boolean(start && end && start <= end)
  const facts = {
    status,
    basis,
    store: STORE_NAMES.includes(readiness.store) ? readiness.store : null,
    arrivalBasis,
  }
  if (arrivalDate) facts.arrivalDate = arrivalDate
  if (status === 'needs_service' && arrivalDate) facts.waitingDays = daysBetween(arrivalDate, asOfDay)
  if (status !== 'needs_service' && ordered(arrivalDate, enteredAt)) facts.receiptToStartDays = daysBetween(arrivalDate, enteredAt)
  if (status === 'in_service' && enteredAt) facts.inServiceDays = daysBetween(enteredAt, asOfDay)
  if (status === 'serviced' && ordered(enteredAt, completedAt)) facts.inServiceDays = daysBetween(enteredAt, completedAt)
  if (status === 'serviced' && ordered(arrivalDate, completedAt)) facts.receiptToReadyDays = daysBetween(arrivalDate, completedAt)
  const updatedDay = row ? dayOf(row.updated_at, timeZone) : null
  if (updatedDay) facts.sinceServiceUpdateDays = daysBetween(updatedDay, asOfDay)
  // ISO-day string order, because daysBetween clamps a reversed pair to 0.
  if ((enteredAt && arrivalDate && enteredAt < arrivalDate) ||
      (completedAt && arrivalDate && completedAt < arrivalDate) ||
      (enteredAt && completedAt && completedAt < enteredAt)) facts.dateOrderIssue = true
  return facts
}

function emptyStoreCounts() {
  return {
    onLot: 0, onLotSourceReported: 0, away: 0, visiting: 0, inTransit: 0, conflict: 0,
    holds: 0, holdsPastExpected: 0,
    waitingForService: 0, inService: 0, ready: 0,
    aged60: 0, aged90: 0,
    unaccounted: 0, returnOverdue: 0,
    recordsIncomplete: 0,
    listed: 0, preListing: 0,
  }
}

function emptyDispositionCounts() {
  return Object.fromEntries(DISPOSITION_KEYS.map((key) => [key, 0]))
}

function emptyServiceMetrics() {
  return {
    counts: { waitingForService: 0, inService: 0, ready: 0 },
    basis: Object.fromEntries(SERVICE_BASES.map((basis) => [basis, 0])),
    arrivalBasis: { intake: 0, listing_date: 0, unknown: 0 },
    samples: { receiptToStartDays: [], inServiceDays: [], receiptToReadyDays: [] },
    agedWaiting14: 0,
    agedWaiting30: 0,
  }
}

function addServiceMetrics(metrics, service, thresholds) {
  metrics.counts[service.status === 'needs_service' ? 'waitingForService' : service.status === 'in_service' ? 'inService' : 'ready'] += 1
  if (Object.hasOwn(metrics.basis, service.basis)) metrics.basis[service.basis] += 1
  metrics.arrivalBasis[service.arrivalBasis] += 1
  if (service.receiptToStartDays !== undefined) metrics.samples.receiptToStartDays.push(service.receiptToStartDays)
  // "Currently in service": a completed cycle's length is not in this median.
  if (service.status === 'in_service' && service.inServiceDays !== undefined) metrics.samples.inServiceDays.push(service.inServiceDays)
  if (service.receiptToReadyDays !== undefined) metrics.samples.receiptToReadyDays.push(service.receiptToReadyDays)
  if (service.waitingDays !== undefined && service.waitingDays >= thresholds.serviceWaitingDays[0]) metrics.agedWaiting14 += 1
  if (service.waitingDays !== undefined && service.waitingDays >= thresholds.serviceWaitingDays[1]) metrics.agedWaiting30 += 1
}

function finishServiceMetrics({ samples, ...metrics }) {
  return {
    ...metrics,
    medians: {
      receiptToStartDays: median(samples.receiptToStartDays),
      inServiceDays: median(samples.inServiceDays),
      receiptToReadyDays: median(samples.receiptToReadyDays),
    },
  }
}

/** One arrow per (from, to, kind) over the caller's visible active moves. */
function boardFlows(visibleTransferRows) {
  const flows = new Map()
  for (const row of visibleTransferRows) {
    if (TERMINAL_TRANSFER_STATES.has(row.status) || row.status === 'delivery_confirmed' ||
        row.movement_status === 'returned_home' || ['unknown', 'conflicting'].includes(row.location_confidence)) continue
    const home = row.home_store_id
    const destination = row.destination_store_id
    let flow = null
    if (row.current_location_id === 'In transit' && String(row.movement_status ?? '').includes('return')) {
      flow = { from: destination, to: home, kind: 'return' }
    } else if (row.current_location_id === 'In transit' || (STORE_NAMES.includes(row.current_location_id) && row.current_location_id !== home)) {
      flow = { from: home, to: destination, kind: 'outbound' }
    } else if (row.current_location_id === home && PLANNED_TRANSFER_STATES.has(row.status)) {
      flow = { from: home, to: destination, kind: 'planned' }
    }
    if (!flow || !STORE_NAMES.includes(flow.from) || !STORE_NAMES.includes(flow.to) || flow.from === flow.to) continue
    const key = `${flow.from}|${flow.to}|${flow.kind}`
    const entry = flows.get(key) ?? { ...flow, vins: new Set() }
    entry.vins.add(row.vin)
    flows.set(key, entry)
  }
  const kindOrder = ['outbound', 'return', 'planned']
  return [...flows.values()]
    .map(({ vins, ...flow }) => ({ ...flow, count: vins.size, vins: [...vins].sort() }))
    .sort((left, right) => STORE_NAMES.indexOf(left.from) - STORE_NAMES.indexOf(right.from) ||
      STORE_NAMES.indexOf(left.to) - STORE_NAMES.indexOf(right.to) || kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind))
}

export function buildOverviewSummary({
  context,
  meta,
  asOfDay,
  vehicles,
  visibleTransferRows = [],
  transferEventsById = new Map(),
  returnOverdueTransferIds = new Set(),
  holdRows = [],
  holdSignals = [],
  serviceRowByVin = new Map(),
  serviceIntakeByVin = new Map(),
  managerIdentityReviews = [],
  thresholds = OVERVIEW_THRESHOLDS,
}) {
  const timeZone = meta.timezone || 'America/New_York'
  const rowsByVin = new Map()
  for (const row of visibleTransferRows) rowsByVin.set(row.vin, [...(rowsByVin.get(row.vin) ?? []), row])
  // Hold counts come from the rows the Action center counts: an active hold
  // count above zero. A row with zero active holds is not a hold, and no
  // count is ever derived from hold label text.
  const activeHoldRowsByVin = new Map(holdRows.filter((row) => Number(row.active_hold_count) > 0).map((row) => [row.vin, row]))

  const access = overviewAccess(context.role)
  const stores = new Map(STORE_NAMES.map((store) => [store, emptyStoreCounts()]))
  // Dispositions count under the role-independent owner store (the store
  // whose manager may record one), so every viewer's card agrees with who can write.
  const dispositionCounts = new Map(STORE_NAMES.map((store) => [store, emptyDispositionCounts()]))
  const vehiclesByVin = new Map(vehicles.map((vehicle) => [vehicle.vin, vehicle]))
  const exceptions = new Map()
  const addException = (kind, store, vin, transferId) => {
    if (!STORE_NAMES.includes(store)) return
    const key = `${kind}|${store}`
    const entry = exceptions.get(key) ?? { kind, store, count: 0, vins: new Set(), transferIds: new Set() }
    entry.count += 1
    if (vin) entry.vins.add(vin)
    if (transferId) entry.transferIds.add(transferId)
    exceptions.set(key, entry)
  }
  const serviceGroup = emptyServiceMetrics()
  const servicePerStore = new Map(STORE_NAMES.map((store) => [store, emptyServiceMetrics()]))
  const agedWaiting = []
  const vehicleFacts = {}

  for (const vehicle of vehicles) {
    const home = vehicle.homeStore
    const counts = stores.get(home)
    const movement = vehicle.movement ?? {}
    const location = custodyOf(vehicle)
    const facts = { custody: location.custody, custodyBasis: location.custodyBasis }
    if (location.currentStore) facts.currentStore = location.currentStore
    if (movement.state === 'return_in_transit') facts.returnLeg = 'return'
    const awayFromHome = location.custody === 'away' || location.custody === 'in_transit'
    if (awayFromHome) {
      const departedDay = dayOf(movement.departedAt, timeZone)
      if (departedDay) {
        facts.daysAway = daysBetween(departedDay, asOfDay)
        facts.departedAt = movement.departedAt
      } else {
        facts.daysAwayBasis = 'unknown'
      }
    }
    if (movement.lastConfirmedAt && location.custodyBasis === 'ledger') facts.lastConfirmedAt = movement.lastConfirmedAt
    if (movement.returnDueAt) facts.returnDueAt = movement.returnDueAt

    const vinRows = rowsByVin.get(vehicle.vin) ?? []
    const overdueRows = vinRows.filter((row) => returnOverdueTransferIds.has(row.id))
    if (overdueRows.length) facts.returnOverdue = true
    const receipts = vinRows.flatMap((row) => (transferEventsById.get(row.id) ?? [])
      .filter((event) => event.event_type === 'returned_home')
      .map((event) => dayOf(event.occurred_at, timeZone))
      .filter((day) => day && day <= asOfDay))
      .sort()
    const receivedDay = receipts.at(-1)
    if (receivedDay && location.custody === 'on_lot' && daysBetween(receivedDay, asOfDay) <= thresholds.recentReceiptDays) facts.receivedHomeAt = receivedDay

    // Unaccounted: the first matching rule wins.
    if (location.custody === 'conflict') facts.unaccounted = { reason: 'location_conflict' }
    else if (vehicle.crmStore && vehicle.crmStore !== vehicle.publicStore) facts.unaccounted = { reason: 'source_conflict' }
    else if (location.custody === 'away' && location.custodyBasis === 'source_reported') facts.unaccounted = { reason: 'no_app_record' }
    else if (awayFromHome) {
      const transferRow = vinRows.find((row) => row.id === movement.transferId)
      const confirmedDay = dayOf(movement.lastConfirmedAt ?? transferRow?.requested_at, timeZone)
      const days = confirmedDay ? daysBetween(confirmedDay, asOfDay) : null
      if (days !== null && days >= thresholds.unaccountedAfterDays) facts.unaccounted = { reason: 'stale_confirmation', days }
    }

    const holdRow = activeHoldRowsByVin.get(vehicle.vin)
    if (holdRow) {
      facts.holdActive = true
      if (dateIsBeforeReport(String(holdRow.expected_date ?? '').trim() || undefined, meta.reportDate)) facts.holdPastExpected = true
    }
    if (vehicle.hold?.state) facts.holdState = vehicle.hold.state

    // Listing age buckets only for a listed vehicle (the code, never a label).
    if (vehicle.publicListing === 'listed' && Number.isFinite(vehicle.daysListed)) {
      if (vehicle.daysListed >= thresholds.agedListingDays[1]) facts.agedBucket = thresholds.agedListingDays[1]
      else if (vehicle.daysListed >= thresholds.agedListingDays[0]) facts.agedBucket = thresholds.agedListingDays[0]
    } else if (vehicle.publicListing === 'pre_listing') {
      facts.agedBasis = 'crm_age'
    }

    Object.assign(facts, recordsOf(vehicle))
    const service = serviceFactsOf(vehicle, {
      row: serviceRowByVin.get(vehicle.vin), intake: serviceIntakeByVin.get(vehicle.vin), asOfDay, timeZone,
    })
    facts.service = service
    vehicleFacts[vehicle.vin] = facts

    if (counts) {
      if (facts.custody === 'on_lot') counts.onLot += 1
      if (facts.custody === 'on_lot' && facts.custodyBasis === 'source_reported') counts.onLotSourceReported += 1
      if (facts.custody === 'away') counts.away += 1
      if (facts.custody === 'in_transit') counts.inTransit += 1
      if (facts.custody === 'conflict') counts.conflict += 1
      if (facts.agedBucket) counts.aged60 += 1
      if (facts.agedBucket === thresholds.agedListingDays[1]) counts.aged90 += 1
      if (facts.unaccounted) counts.unaccounted += 1
      if (facts.recordsCaptured < facts.recordsApplicable) counts.recordsIncomplete += 1
      if (vehicle.publicListing === 'listed') counts.listed += 1
      if (vehicle.publicListing === 'pre_listing') counts.preListing += 1
    }
    if (facts.custody === 'away' && facts.currentStore !== home) {
      const visited = stores.get(facts.currentStore)
      if (visited) visited.visiting += 1
    }
    const serviceCounts = stores.get(service.store)
    if (serviceCounts) {
      if (service.status === 'needs_service') serviceCounts.waitingForService += 1
      if (service.status === 'in_service') serviceCounts.inService += 1
      if (service.status === 'serviced') serviceCounts.ready += 1
      addServiceMetrics(servicePerStore.get(service.store), service, thresholds)
    }
    addServiceMetrics(serviceGroup, service, thresholds)
    if (service.waitingDays !== undefined && service.waitingDays >= thresholds.serviceWaitingDays[0]) {
      agedWaiting.push({ vin: vehicle.vin, store: service.store, waitingDays: service.waitingDays, arrivalBasis: service.arrivalBasis })
    }

    // The app's own disposition, shown beside (never replacing) the imported
    // manager log. It never hides a vehicle and is never inferred here.
    const disposition = vehicle.appDisposition ?? null
    const dispositionStore = disposition?.ownerStore ?? home
    if (disposition?.code) facts.disposition = disposition.code
    const dispositionTally = dispositionCounts.get(dispositionStore)
    if (dispositionTally) dispositionTally[disposition?.code ?? 'none'] += 1
    const deliveredDay = disposition?.code === 'delivered' ? isoDay(disposition.effectiveDate) : null
    if (deliveredDay && vehicle.publicListing === 'listed' && deliveredDay <= asOfDay &&
        daysBetween(deliveredDay, asOfDay) >= thresholds.listedAfterDeliveredDays) {
      addException('listed_but_delivered', dispositionStore, vehicle.vin)
    }

    if (facts.unaccounted) addException(facts.unaccounted.reason, home, vehicle.vin)
    if (facts.recordsCaptured < facts.recordsApplicable) addException('records_incomplete', home, vehicle.vin)
    if (service.dateOrderIssue) addException('service_date_order', service.store ?? home, vehicle.vin)
  }

  // A move that recorded customer delivery with no delivered disposition: a
  // prompt for the managers who can record one, never an inference.
  if (access === 'full') {
    const prompted = new Set()
    for (const row of visibleTransferRows) {
      if (row.delivery_status !== 'delivery_confirmed' || CANCELED_TRANSFER_STATES.has(row.status) || prompted.has(row.vin)) continue
      const vehicle = vehiclesByVin.get(row.vin)
      if (!vehicle || vehicle.appDisposition?.code === 'delivered') continue
      prompted.add(row.vin)
      addException('delivered_move_no_disposition', vehicle.appDisposition?.ownerStore ?? vehicle.homeStore, row.vin, row.id)
    }
  }

  // Return overdue is attributed to the home store, one per ledger row, the
  // same rule and count as the bootstrap stores summary.
  for (const row of visibleTransferRows) {
    if (!returnOverdueTransferIds.has(row.id)) continue
    const counts = stores.get(row.home_store_id)
    if (counts) counts.returnOverdue += 1
    addException('return_overdue', row.home_store_id, row.vin, row.id)
  }
  for (const signal of holdSignals) {
    const counts = stores.get(signal.store)
    if (!counts) continue
    counts.holds = signal.activeHoldVins
    counts.holdsPastExpected = signal.pastExpected
  }
  for (const row of activeHoldRowsByVin.values()) {
    if (!(row.vin in vehicleFacts)) continue
    if (dateIsBeforeReport(String(row.expected_date ?? '').trim() || undefined, meta.reportDate)) {
      addException('hold_past_expected', String(row.crm_store_id ?? '').trim(), row.vin)
    }
  }
  // Manager-log rows that cannot be placed on an exact VIN: a count only.
  for (const record of managerIdentityReviews) addException('identity_review', record?.sourceStore)

  const storeCounts = STORE_NAMES.map((store) => ({ store, ...stores.get(store), dispositions: dispositionCounts.get(store) }))
  const group = { ...emptyStoreCounts(), dispositions: emptyDispositionCounts() }
  for (const counts of storeCounts) {
    for (const key of Object.keys(group)) if (key !== 'dispositions') group[key] += counts[key]
    for (const key of DISPOSITION_KEYS) group.dispositions[key] += counts.dispositions[key]
  }

  const exceptionList = [...exceptions.values()]
    .sort((left, right) => EXCEPTION_KINDS.indexOf(left.kind) - EXCEPTION_KINDS.indexOf(right.kind) ||
      STORE_NAMES.indexOf(left.store) - STORE_NAMES.indexOf(right.store))
    .map(({ transferIds, vins, ...entry }) => ({
      ...entry,
      vins: [...vins].sort().slice(0, EXCEPTION_VIN_LIMIT),
      ...(transferIds.size ? { transferIds: [...transferIds].sort() } : {}),
    }))

  return {
    asOfDay,
    scopeStore: context.store,
    role: context.role,
    access,
    thresholds: {
      unaccountedAfterDays: thresholds.unaccountedAfterDays,
      agedListingDays: [...thresholds.agedListingDays],
      serviceWaitingDays: [...thresholds.serviceWaitingDays],
      listedAfterDeliveredDays: thresholds.listedAfterDeliveredDays,
      recentReceiptDays: thresholds.recentReceiptDays,
    },
    stores: storeCounts,
    group,
    board: { flows: boardFlows(visibleTransferRows) },
    vehicleFacts,
    service: {
      perStore: STORE_NAMES.map((store) => ({ store, ...finishServiceMetrics(servicePerStore.get(store)) })),
      group: finishServiceMetrics(serviceGroup),
      agedWaiting: agedWaiting
        .sort((left, right) => right.waitingDays - left.waitingDays || left.vin.localeCompare(right.vin))
        .slice(0, AGED_WAITING_LIMIT),
    },
    exceptions: exceptionList,
  }
}
