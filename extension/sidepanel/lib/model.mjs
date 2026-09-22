import { serviceWorkflowStatus } from './service-readiness.mjs'

// Builds the panel's vehicle view model from the app's /api/bootstrap record.
// The rules mirror src/app/adapters.ts and src/features/inventory/
// inventory-utils.ts so the panel never says something the app would not:
// public listing, DealerMail hold, app movement, and physical location are
// kept as separate facts and none is inferred from another.

import { STORES } from './config.mjs'
import { autoCheckUrl, factoryEquipmentUrl, fordInvoiceUrl, fordOasisUrl, listingUrl, photoUrl, savedFordInvoiceUrl, windowStickerUrl } from './links.mjs'
import { autoCheckTone, equipmentByCategory, standoutEquipment } from './equipment.mjs'
import { historyDetailTone } from './resources.mjs'
import { warrantyOutlook } from './warranty.mjs'

const ROLE_LABELS = Object.freeze({
  sales: 'Salesperson', manager: 'Store manager', coordinator: 'Transport coordinator', porter: 'Porter', driver: 'Driver', group_manager: 'Group manager',
})

export function roleLabel(role) { return ROLE_LABELS[role] ?? 'Team member' }

export function dataState(freshness) {
  if (freshness === 'current') return 'current'
  if (freshness === 'stale_unverified') return 'stale'
  if (freshness === 'incomplete') return 'incomplete'
  return 'unavailable'
}

const text = (value) => {
  const cleaned = typeof value === 'string' ? value.trim() : ''
  return cleaned || null
}
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])

export function vehicleName(record) {
  return text(record.vehicleName) || [record.year, record.make, record.model, record.trim].map((part) => text(String(part ?? ''))).filter(Boolean).join(' ')
}

function holdActive(state, dealerMailState) {
  if (dealerMailState !== 'current') return null
  if (state === 'primary' || state === 'backup' || state === 'multiple') return true
  if (state === 'none_observed') return false
  return null
}

/** Same wording as the app's dealerMailHoldLabel. */
export function holdLabel({ dataState: state, hasActiveHold, conciseState, position }) {
  if (state !== 'current') return 'Hold status not verified'
  if (hasActiveHold === true) {
    if (conciseState) return conciseState
    if (position === 'backup') return 'DealerMail backup hold'
    if (position === 'multiple') return 'DealerMail holds'
    return 'DealerMail hold'
  }
  if (hasActiveHold === false) return 'No current DealerMail hold found'
  return 'DealerMail hold not provided'
}

function holdSignal(record, dealerMailState) {
  const hold = record.hold ?? { state: 'unknown', label: '', backupCount: 0 }
  const position = ['primary', 'backup', 'multiple'].includes(hold.state) ? hold.state : null
  const hasActiveHold = holdActive(hold.state, dealerMailState)
  const canViewEvidence = hold.canViewEvidence === true
  const evidence = []
  // Evidence is only ever the server's role-redacted projection; the panel adds
  // nothing and shows salesperson/reason only when the app would.
  if (canViewEvidence && hasActiveHold) {
    const primary = record.privateEvidence?.primary ?? null
    evidence.push({
      position: 'primary',
      salesperson: text(primary?.salesperson) || text(hold.primarySalesperson),
      customerOrReason: text(primary?.customerOrReason) || text(hold.reason),
      holdDate: text(primary?.holdDate),
      expectedDate: text(primary?.expectedDate) || text(hold.expectedDate),
    })
    for (const backup of record.privateEvidence?.backups ?? []) {
      evidence.push({ position: 'backup', salesperson: text(backup.salesperson), customerOrReason: text(backup.customerOrReason), holdDate: text(backup.holdDate), expectedDate: text(backup.expectedDate) })
    }
  }
  const tone = hasActiveHold === true ? 'held' : hasActiveHold === false ? 'clear' : 'unverified'
  const message = (item) => ({ author: text(item?.author), text: text(item?.text), timestamp: text(item?.timestamp) })
  const detailLoaded = canViewEvidence && record.privateEvidence !== undefined
  return {
    state: hold.state,
    dataState: dealerMailState,
    hasActiveHold,
    position,
    backupCount: number(hold.backupCount) ?? 0,
    conciseState: text(hold.label),
    label: holdLabel({ dataState: dealerMailState, hasActiveHold, conciseState: text(hold.label), position }),
    tone,
    canViewEvidence,
    canManage: hold.canManage === true,
    commentsCount: number(hold.commentsCount) ?? 0,
    alertsCount: number(hold.alertsCount) ?? 0,
    evidence,
    // Present only once the per-vehicle record has been merged in.
    detailLoaded,
    comments: canViewEvidence ? (record.privateEvidence?.comments ?? []).map(message).filter((item) => item.text) : [],
    alerts: canViewEvidence ? (record.privateEvidence?.alerts ?? []).map(message).filter((item) => item.text) : [],
    cdkStatus: canViewEvidence ? text(record.privateEvidence?.cdk?.status) || text(record.privateEvidence?.cdk?.result) : null,
  }
}

/**
 * The server's movement summary is app custody evidence whenever it came from
 * the ledger — even when the transfer itself is withheld from this role or
 * store. service-core.mjs deliberately publishes location, state and
 * confidence without the transfer link so other stores can find a group
 * vehicle; only a plain source report carries state 'source_reported'.
 */
function ledgerBacked(record, transfer) {
  const movement = record.movement ?? {}
  return Boolean(transfer || movement.transferId || (text(movement.state) && movement.state !== 'source_reported'))
}

/** Mirrors resolveCurrentLocation: app custody evidence outranks source reports. */
export function resolveLocation(record, transfer) {
  const movement = record.movement ?? {}
  const confirmedAt = text(movement.lastConfirmedAt) || text(transfer?.lastConfirmedAt)
  if (movement.locationConfidence === 'conflicting') {
    return { label: 'Location needs checking', store: null, provenance: 'app-confirmed', confidence: 'conflicting', confirmedAt, custodian: null, conflict: true }
  }
  const confirmed = ledgerBacked(record, transfer) ? text(movement.currentLocation) || text(transfer?.currentLocation) : null
  if (confirmed && confirmed !== 'Unknown') {
    return {
      label: confirmed,
      store: STORES.includes(confirmed) ? confirmed : null,
      provenance: 'app-confirmed',
      confidence: movement.locationConfidence ?? 'unknown',
      confirmedAt,
      custodian: text(movement.currentCustodian) || text(transfer?.custodian),
      conflict: false,
    }
  }
  const reported = text(record.sourceReportedLocation) || text(record.publicStore)
  if (reported) return { label: reported, store: STORES.includes(reported) ? reported : null, provenance: 'source-reported', confidence: 'reported', confirmedAt: null, custodian: null, conflict: false }
  return { label: 'Location not confirmed', store: null, provenance: 'unknown', confidence: 'unknown', confirmedAt: null, custodian: null, conflict: false }
}

/**
 * Custody evidence is not the same as an open move, and the app's adapter
 * (src/app/adapters.ts) uses the same precedence:
 * 1. a transfer link or request status the server let this caller see
 *    (vehicleView spreads the physical-location row over the active transfer
 *    summary, so a new request on a received-home vehicle arrives as
 *    { transferId, requestStatus, state: 'returned_home' } — the link wins);
 * 2. a joined transfer that has not closed (the join above already skips
 *    terminal rows);
 * 3. otherwise the ledger state alone — except a completed home receipt
 *    ('returned_home', still published as location evidence after the request
 *    closed; the server lets the vehicle be requested again) and a location
 *    conflict ('location_exception', emitted without any transfer link).
 */
function openMove(record, transfer) {
  const movement = record.movement ?? {}
  if (text(movement.transferId) || text(movement.requestStatus) || transfer) return true
  const state = text(movement.state)
  const conflicting = movement.locationConfidence === 'conflicting' || state === 'location_exception'
  return !conflicting && state !== 'returned_home'
}

function movementSignal(record, transfer, now) {
  const movement = record.movement ?? {}
  if (!ledgerBacked(record, transfer) || !openMove(record, transfer)) return null
  const dueAt = text(movement.dueAt) || text(transfer?.dueAt)
  const transferId = text(transfer?.id) || text(movement.transferId)
  return {
    transferId,
    // Without a transfer link the server has withheld actor, owner and
    // customer detail on purpose; what remains is still real custody state.
    withheld: !transferId,
    state: text(transfer?.movementStatus) || text(movement.state),
    label: text(movement.label) || text(transfer?.movementStatus),
    requestStatus: text(movement.requestStatus) || text(transfer?.requestStatus),
    nextAction: text(movement.nextAction) || text(transfer?.nextAction),
    nextActionOwner: text(movement.nextActionOwner) || text(transfer?.nextActionOwner),
    destination: text(movement.destination) || text(transfer?.destination),
    requestingStore: text(transfer?.requestingStore),
    dueAt,
    overdue: Boolean(dueAt && new Date(dueAt).getTime() < now),
    custodian: text(movement.currentCustodian) || text(transfer?.custodian),
    transportAssignee: text(movement.transportAssignee) || text(transfer?.transportAssignee),
    returnRequired: movement.returnRequired === true,
    returnDueAt: text(movement.returnDueAt),
    canDirectReroute: movement.canDirectReroute === true,
  }
}

function isListed(record) {
  const state = `${record.publicListingState ?? ''} ${record.websiteStatus ?? ''}`.toLowerCase()
  if (state.includes('not found') || state.includes('removed') || state.includes('not listed')) return false
  if (state.includes('listed') || state.includes('available')) return true
  return record.listingUrl ? true : null
}

/** Dealer-confirmed policy: certified vehicles at the three Ford stores are Blue Certified.
 * Certification follows the home store, including non-Ford makes; unknown stores stay generic.
 */
export function certifiedProgram(homeStore) {
  const store = String(homeStore ?? '').trim()
  if (store === 'Lincoln') return { name: 'Lincoln Certified Pre-Owned', short: 'Lincoln Certified', brand: 'lincoln', store }
  if (['Howell', 'Fowlerville', 'Ford Detroit'].includes(store)) return { name: 'Ford Blue Certified', short: 'Blue Certified', brand: 'ford', store }
  return { name: 'Certified', short: 'Certified', brand: null, store }
}

const documentState = (value, fallback) => value === 'stale' ? 'stale' : value === 'unknown' ? 'unknown' : value ? dataState(value) : fallback
const entries = (value) => Array.isArray(value) ? value : []

function warrantyCoverages(value) {
  return entries(value).filter((item) => text(item?.type) && text(item?.termText) && text(item?.remainingMilesText) && text(item?.remainingTimeText) && ['ACTIVE', 'EXPIRED', 'N/A'].includes(item?.status))
    .map((item) => ({
      type: text(item.type), termText: text(item.termText), status: item.status,
      remainingMilesText: text(item.remainingMilesText), remainingTimeText: text(item.remainingTimeText), note: text(item.note),
      termMonths: number(item.termMonths), termMiles: number(item.termMiles), remainingMiles: number(item.remainingMiles), remainingMonths: number(item.remainingMonths),
      unlimitedMiles: typeof item.unlimitedMiles === 'boolean' ? item.unlimitedMiles : null,
      unlimitedMonths: typeof item.unlimitedMonths === 'boolean' ? item.unlimitedMonths : null,
    }))
}

function capturedWarranty(record, fallback) {
  if (!record || number(record.mileageEntered) === null) return null
  const autoCheck = record.autoCheck ? {
    inServiceDate: text(record.autoCheck.inServiceDate), inServiceAgeMonths: number(record.autoCheck.inServiceAgeMonths), defaultMileage: number(record.autoCheck.defaultMileage),
    coverages: warrantyCoverages(record.autoCheck.coverages),
  } : null
  const fordOasis = record.fordOasis && text(record.fordOasis.warrantyStartDate) && number(record.fordOasis.monthsInService) !== null ? {
    warrantyStartDate: text(record.fordOasis.warrantyStartDate), monthsInService: number(record.fordOasis.monthsInService), coverages: warrantyCoverages(record.fordOasis.coverages),
  } : null
  return autoCheck || fordOasis ? {
    dataState: documentState(record.dataState, fallback), capturedAt: text(record.capturedAt), sourceLabel: text(record.sourceLabel),
    mileageEntered: number(record.mileageEntered), mileageSource: text(record.mileageSource), autoCheck, fordOasis,
  } : null
}

function capturedServiceOrder(value) {
  const repairOrderNumber = text(value?.repairOrderNumber)
  const openDate = text(value?.openDate)
  const closeDate = text(value?.closeDate)
  if (!repairOrderNumber || !openDate || !closeDate) return null
  return {
    repairOrderNumber,
    openDate,
    closeDate,
    odometer: number(value.odometer),
    services: list(value.services),
    summary: text(value.summary),
    inspection: value.inspection?.status === 'confirmed' ? text(value.inspection.type) : null,
  }
}

function capturedServiceHistory(value, fallback) {
  if (!value || number(value.repairOrderCount) === null || number(value.detailScanCount) === null) return null
  const latest = capturedServiceOrder(value.latestRepairOrder)
  const recent = entries(value.recentRepairOrders).map(capturedServiceOrder).filter(Boolean)
  return {
    dataState: documentState(value.dataState, fallback), checkedAt: text(value.checkedAt),
    repairOrderCount: number(value.repairOrderCount), detailScanCount: number(value.detailScanCount),
    latestRepairOrder: latest,
    recentRepairOrders: recent.length ? recent : latest ? [latest] : [],
  }
}

function documentsFor(record, publicState, dealerMailState) {
  const autoCheck = record.autoCheckReport
  const sticker = record.windowSticker
  const factory = record.factoryEquipment
  const oasis = record.fordOasis
  return {
    autoCheck: autoCheck
      ? {
        url: autoCheckUrl(autoCheck.url, record.listingUrl), dataState: documentState(autoCheck.dataState, publicState),
        score: number(autoCheck.score), rangeLow: number(autoCheck.scoreRangeLow), rangeHigh: number(autoCheck.scoreRangeHigh), ownerCount: number(autoCheck.ownerCount),
        usage: text(autoCheck.usage), lastReportedOdometer: number(autoCheck.lastReportedOdometer), lastReportedOdometerDate: text(autoCheck.lastReportedOdometerDate),
        vehicleClass: text(autoCheck.vehicleClass), assemblyCountry: text(autoCheck.assemblyCountry), inServiceDate: text(autoCheck.estimatedInServiceDate), reportRunAt: text(autoCheck.reportRunAt),
        sourceLabel: text(autoCheck.sourceLabel), sourceMessage: text(autoCheck.sourceMessage), failureReason: text(autoCheck.failureReason),
        checks: entries(autoCheck.checks).filter((check) => text(check?.label)).map((check) => {
          const statusTone = autoCheckTone(check.status)
          const detailTone = historyDetailTone(check.detail)
          const tone = statusTone === 'review' || detailTone === 'review' ? 'review' : detailTone ?? statusTone
          return { label: text(check.label), status: text(check.status), detail: text(check.detail), tone }
        }),
      }
      : null,
    windowSticker: sticker
      ? {
        url: windowStickerUrl(sticker.url, record.listingUrl), dataState: documentState(sticker.dataState, publicState),
        basePrice: number(sticker.basePrice), totalOptions: number(sticker.totalOptions), destinationCharge: number(sticker.destinationCharge), totalMsrp: number(sticker.totalMsrp),
        pricingCurrency: text(sticker.pricingCurrency), originalMarket: text(sticker.originalMarket), currencyEvidence: text(sticker.pricingCurrencyEvidence),
        vehicleDescription: text(sticker.vehicleDescription), equipmentGroup: text(sticker.equipmentGroup), equipmentGroupPrice: number(sticker.equipmentGroupPrice),
        ...(Array.isArray(sticker.equipmentGroupContents) ? { equipmentGroupContents: list(sticker.equipmentGroupContents) } : {}),
        engine: text(sticker.engine), transmission: text(sticker.transmission), exteriorColor: text(sticker.exteriorColor), interiorColor: text(sticker.interiorColor),
        sourceMessage: text(sticker.sourceMessage), failureReason: text(sticker.failureReason),
        options: list(sticker.options), standardEquipment: list(sticker.standardEquipment), warranty: list(sticker.warranty),
      }
      : null,
    factoryEquipment: factory
      ? {
        url: factoryEquipmentUrl(factory.url), dataState: documentState(factory.dataState, dealerMailState),
        basePrice: number(factory.basePrice), totalOptions: number(factory.totalOptions), destinationCharge: number(factory.destinationCharge), totalMsrp: number(factory.totalMsrp),
        capturedAt: text(factory.capturedAt), sourceLabel: text(factory.sourceLabel), disclaimer: text(factory.disclaimer),
        vehicleDescription: text(factory.vehicleDescription), engine: text(factory.engine), transmission: text(factory.transmission), drivetrain: text(factory.drivetrain),
        exteriorColor: text(factory.exteriorColor), interiorColor: text(factory.interiorColor),
        packages: entries(factory.packages).filter((item) => text(item?.name)).map((item) => ({ name: text(item.name), code: text(item.code), price: number(item.price), features: list(item.features) })),
        sections: entries(factory.sections).filter((section) => text(section?.name)).map((section) => ({ name: text(section.name), items: entries(section.items).filter((item) => text(item?.label)).map((item) => ({ label: text(item.label), price: number(item.price) })) })),
      }
      : null,
    fordOasis: oasis ? {
      dataState: documentState(oasis.dataState, dealerMailState), capturedAt: text(oasis.capturedAt), sourceLabel: text(oasis.sourceLabel),
      vehicleDescription: text(oasis.vehicleDescription), versionSeries: text(oasis.versionSeries),
      buildDate: text(oasis.buildDate), warrantyStartDate: text(oasis.warrantyStartDate), releaseDate: text(oasis.releaseDate),
      monthsInService: number(oasis.monthsInService), saleMileage: number(oasis.saleMileage),
      // An omitted or malformed array is not evidence of zero service actions.
      openActionsCaptured: oasis.openActionsCaptured === true && Array.isArray(oasis.openFieldServiceActions) && oasis.openFieldServiceActions.every((item) => text(item?.code)),
      openFieldServiceActions: entries(oasis.openFieldServiceActions).filter((item) => text(item?.code)).map((item) => ({ code: text(item.code), description: text(item.description) })),
      warrantyCoverages: entries(oasis.warrantyCoverages).filter((item) => text(item?.type)).map((item) => ({ type: text(item.type), description: text(item.description) })),
      extendedCoverageExpirations: list(oasis.extendedCoverageExpirations),
      ...(oasis.serviceHistory ? { serviceHistory: capturedServiceHistory(oasis.serviceHistory, dealerMailState) } : {}),
    } : null,
    warrantyCheck: capturedWarranty(record.warrantyCheck, dealerMailState),
  }
}

export function toPanelVehicle(record, bootstrap, { now = Date.now(), origin = null } = {}) {
  const meta = bootstrap.meta ?? {}
  const publicState = dataState(meta.publicFreshness)
  const dealerMailState = dataState(meta.dealerMailFreshness)
  const transfer = (bootstrap.transfers ?? []).find((item) => item.vin === record.vin && item.id === record.movement?.transferId)
    ?? (bootstrap.transfers ?? []).find((item) => item.vin === record.vin && !isTerminal(item))
  const features = typeof record.features === 'string'
    ? [...new Set(record.features.split(/\s*\|\s*|\s*,\s*/).map((item) => item.trim()).filter(Boolean))]
    : []
  const photos = [...new Set([record.imageUrl, ...(Array.isArray(record.imageUrls) ? record.imageUrls : [])].map(photoUrl).filter(Boolean))]
  const disposition = record.managerDisposition
  const documents = documentsFor(record, publicState, dealerMailState)
  const make = text(record.make) || ''
  // The app enables Ford dealer tools for Ford and Lincoln VINs only.
  const fordFamily = /^(ford|lincoln)$/i.test(make)
  const savedInvoice = Boolean(fordFamily && record.fordInvoice?.available === true && text(record.fordInvoice?.capturedAt) && origin)
  const price = number(record.listedPrice)
  const msrp = number(record.msrp)
  const vehicle = {
    id: record.vin,
    vin: record.vin,
    stockNumber: text(record.stockNumber) || '—',
    name: vehicleName(record),
    year: record.year ?? '',
    make,
    model: text(record.model) || '',
    trim: text(record.trim),
    price,
    msrp,
    savings: price !== null && msrp !== null && msrp > price ? msrp - price : null,
    mileage: number(record.mileage),
    daysListed: number(record.daysListed),
    exteriorColor: text(record.exteriorColor),
    interiorColor: text(record.interiorColor),
    bodyStyle: text(record.bodyStyle),
    drivetrain: text(record.drivetrain),
    engine: text(record.engine),
    transmission: text(record.transmission),
    fuelType: text(record.fuelType),
    serviceReadiness: {
      status: serviceWorkflowStatus(record.serviceReadiness),
      readinessBasis: record.serviceReadiness?.readinessBasis || (['needs_service', 'in_service', 'serviced'].includes(record.serviceReadiness?.status) ? 'manager_updated' : 'unconfirmed'),
      serviceEnteredAt: text(record.serviceReadiness?.serviceEnteredAt), completedAt: text(record.serviceReadiness?.completedAt),
      updatedAt: text(record.serviceReadiness?.updatedAt), store: text(record.serviceReadiness?.store), canManage: record.serviceReadiness?.canManage === true,
    },
    certified: record.certified === true,
    certifiedProgram: record.certified === true ? certifiedProgram(record.homeStore) : null,
    specs: {
      bodyType: text(record.bodyType), mpgCity: number(record.mpgCity), mpgHighway: number(record.mpgHighway),
      modelCode: text(record.modelCode), inventoryDate: text(record.inventoryDate), photoCount: number(record.photoCount),
    },
    features,
    photos,
    changeSummary: text(record.changeSummary),
    dealerComments: text(record.dealerComments),
    authorizedSearchText: text(record.searchText),
    homeStore: text(record.homeStore) || '',
    sourceReportedStore: text(record.sourceReportedLocation) || text(record.publicStore),
    crmStore: text(record.crmStore),
    listing: {
      dataState: publicState,
      isListed: isListed(record),
      state: text(record.publicListingState),
      websiteStatus: text(record.websiteStatus),
      url: listingUrl(record.listingUrl),
      dealerOn: { inStock: record.dealerOn?.inStock ?? null, inTransit: record.dealerOn?.inTransit ?? null, inProduction: record.dealerOn?.inProduction ?? null },
    },
    links: {
      oasis: fordFamily ? fordOasisUrl(record.vin) : null,
      invoice: fordFamily ? savedInvoice ? savedFordInvoiceUrl(origin, record.vin) : fordInvoiceUrl(record.vin) : null,
      ...(savedInvoice ? { invoiceSaved: true, invoiceCapturedAt: text(record.fordInvoice.capturedAt) } : {}),
    },
    hold: holdSignal(record, dealerMailState),
    location: resolveLocation(record, transfer),
    movement: movementSignal(record, transfer, now),
    // The server's own createTransfer decision (service-core vehicleView
    // publishes the guard behind 409 ACTIVE_TRANSFER_EXISTS, decided over
    // every ledger row for the VIN); null when this server did not say.
    // Never derived from `movement` — the two answer different questions.
    moveRequestBlocked: typeof record.movement?.newRequestBlocked === 'boolean' ? record.movement.newRequestBlocked : null,
    managerLog: disposition
      ? {
        soldLabel: disposition.soldLabel, deliveryLabel: disposition.deliveryLabel, deliveryDate: text(disposition.deliveryDate), sourceStore: disposition.sourceStore, confidence: disposition.confidence,
        dataState: dataState(meta.managerDispositionFreshness ?? disposition.dataState ?? 'unknown'),
      }
      : null,
    documents,
    publicScan: record.publicScan
      ? {
        firstSeen: text(record.publicScan.firstSeen), lastSeen: text(record.publicScan.lastSeen),
        sourceCount: number(record.publicScan.sourceCount) ?? (Array.isArray(record.publicScan.sourceSites) ? record.publicScan.sourceSites.length : null),
        locationCity: text(record.publicScan.locationCity), genericColor: text(record.publicScan.genericColor),
      }
      : null,
    // Records that only the per-vehicle endpoint carries.
    detailLoaded: record.privateEvidence !== undefined || record.autoCheckReport !== undefined || record.publicScan !== undefined,
    equipment: null,
    warranty: null,
  }
  vehicle.equipment = { standout: standoutEquipment(vehicle, 6), byCategory: equipmentByCategory(vehicle) }
  vehicle.warranty = warrantyOutlook(vehicle, { now })
  return vehicle
}

/** The per-vehicle record is the bootstrap record plus role-filtered evidence; it wins field by field. */
export function mergeDetail(record, detail) {
  if (!detail || typeof detail !== 'object' || detail.vin !== record.vin) return record
  return { ...record, ...detail }
}

function isTerminal(transfer) {
  const status = `${transfer.requestStatus ?? ''} ${transfer.movementStatus ?? ''}`.toLowerCase()
  return /cancel|declin|complete|returned|closed|rejected/.test(status)
}

/**
 * The server's word on whether a ledger row still blocks a new request; an
 * open move is only the fallback for servers that did not publish it (older
 * deployments, the advanced engine). Absence never means "allowed".
 */
function moveRequestBlocked(vehicle) {
  return vehicle.moveRequestBlocked ?? Boolean(vehicle.movement)
}

/**
 * Resolve the one move action this user can start for this vehicle.
 *
 * Salespeople request vehicles from another store. Store managers can record
 * a direct move for inventory owned by their store and request inventory from
 * another store. Group managers can record a direct move for any vehicle.
 */
export function vehicleMoveAction(vehicle, access) {
  if (!access || access.canCreateTransfer === false) return false
  if (!['sales', 'manager', 'group_manager'].includes(access.role)) return false
  // Role and home store are the panel's rules; whether the ledger blocks a
  // new request is the server's (409 ACTIVE_TRANSFER_EXISTS).
  if (moveRequestBlocked(vehicle)) {
    const ownsVehicle = access.role === 'group_manager' || (access.role === 'manager' && vehicle.homeStore === access.store)
    return vehicle.movement?.canDirectReroute === true && ownsVehicle ? 'direct' : false
  }
  if (access.role === 'group_manager') return 'direct'
  if (access.role === 'manager' && vehicle.homeStore === access.store) return 'direct'
  if (vehicle.homeStore !== access.store) return 'request'
  return false
}

/** Backward-compatible boolean used by older extension surfaces and tests. */
export function canRequestVehicle(vehicle, access) {
  return Boolean(vehicleMoveAction(vehicle, access))
}

export function requestBlockedReason(vehicle, access) {
  if (!access) return 'Sign in to move vehicles.'
  if (!['sales', 'manager', 'group_manager'].includes(access.role) || access.canCreateTransfer === false) return 'Your role cannot move vehicles.'
  if (moveRequestBlocked(vehicle)) {
    if (vehicleMoveAction(vehicle, access) === 'direct') return null
    // Blocked without a visible move: a request this user may not see is
    // open somewhere. Name no store, actor or request — the server does not.
    return vehicle.movement ? 'A move is already in progress.' : 'This vehicle already has an open move request.'
  }
  if (access.role === 'sales' && vehicle.homeStore === access.store) return 'Ask your store manager to move this vehicle to another location.'
  return null
}

/**
 * The identifying and pricing facts a deal needs pasted somewhere else, in a
 * stable order. Sticker pricing wins over the vAuto label because it is the
 * original Monroney; the label is informational.
 */
export function copyFields(vehicle) {
  const sticker = vehicle.documents.windowSticker
  const label = vehicle.documents.factoryEquipment
  const pick = (key) => (sticker && sticker[key] !== null ? { value: sticker[key], from: 'sticker' } : label && label[key] !== null ? { value: label[key], from: 'label' } : { value: null, from: null })
  const base = pick('basePrice'), options = pick('totalOptions'), destination = pick('destinationCharge'), total = pick('totalMsrp')
  return [
    { key: 'stock', label: 'Stock', value: vehicle.stockNumber, kind: 'text' },
    { key: 'vin', label: 'VIN', value: vehicle.vin, kind: 'text' },
    { key: 'vehicle', label: 'Vehicle', value: vehicle.name, kind: 'text' },
    { key: 'year', label: 'Year', value: vehicle.year || null, kind: 'text' },
    { key: 'price', label: 'Listed price', value: vehicle.price, kind: 'money' },
    { key: 'msrp', label: 'MSRP', value: vehicle.msrp, kind: 'money' },
    { key: 'base', label: 'Base MSRP', value: base.value, kind: 'money', from: base.from },
    { key: 'options', label: 'Options total', value: options.value, kind: 'money', from: options.from },
    { key: 'destination', label: 'Destination & delivery', value: destination.value, kind: 'money', from: destination.from },
    { key: 'stickerTotal', label: total.from === 'label' ? 'Equipment label total MSRP' : 'Sticker total MSRP', value: total.value, kind: 'money', from: total.from },
    { key: 'mileage', label: 'Miles', value: vehicle.mileage, kind: 'mileage' },
    { key: 'inService', label: vehicle.warranty?.inService.estimated ? 'Warranty start (est.)' : 'Warranty start (OASIS)', value: vehicle.warranty?.inService.date ?? null, kind: 'date' },
    { key: 'exterior', label: 'Exterior', value: vehicle.exteriorColor, kind: 'text' },
    { key: 'interior', label: 'Interior', value: vehicle.interiorColor, kind: 'text' },
    { key: 'engine', label: 'Engine', value: vehicle.engine, kind: 'text' },
    { key: 'transmission', label: 'Transmission', value: vehicle.transmission, kind: 'text' },
    { key: 'drivetrain', label: 'Drivetrain', value: vehicle.drivetrain, kind: 'text' },
    { key: 'modelCode', label: 'Model code', value: vehicle.specs.modelCode, kind: 'text' },
    { key: 'homeStore', label: 'Home store', value: vehicle.homeStore, kind: 'text' },
  ]
}

/** Plain-text deal sheet for a single copy-all action. */
export function dealSheetText(vehicle, formatValue) {
  const lines = copyFields(vehicle)
    .filter((field) => field.value !== null && field.value !== undefined && field.value !== '')
    .map((field) => `${field.label}: ${formatValue(field)}`)
  if (vehicle.certifiedProgram) lines.push(`Certified: ${vehicle.certifiedProgram.name}`)
  lines.push(`DealerMail: ${vehicle.hold.label}`, `Location: ${vehicle.location.label} (${vehicle.location.provenance === 'app-confirmed' ? 'app-confirmed' : vehicle.location.provenance === 'source-reported' ? 'source-reported' : 'unconfirmed'})`)
  return lines.join('\n')
}

export function buildPanelData(bootstrap, { now = Date.now(), origin = null } = {}) {
  const vehicles = (bootstrap.vehicles ?? []).map((record) => toPanelVehicle(record, bootstrap, { now, origin }))
  const stores = (bootstrap.stores ?? []).map((item) => ({ store: item.store, publicUnits: number(item.publicUnits) ?? 0, currentHolds: number(item.currentHolds) ?? 0, awayFromHome: number(item.awayFromHome) ?? 0 }))
  const meta = bootstrap.meta ?? {}
  return {
    access: bootstrap.access ?? null,
    vehicles,
    stores,
    meta: {
      reportDate: text(meta.reportDate),
      completedAt: text(meta.completedAt),
      publicFreshness: dataState(meta.publicFreshness),
      dealerMailFreshness: dataState(meta.dealerMailFreshness),
      heldVinCount: number(meta.heldVinCount) ?? vehicles.filter((item) => item.hold.hasActiveHold).length,
    },
  }
}
