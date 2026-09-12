// Builds the panel's vehicle view model from the app's /api/bootstrap record.
// The rules mirror src/app/adapters.ts and src/features/inventory/
// inventory-utils.ts so the panel never says something the app would not:
// public listing, DealerMail hold, app movement, and physical location are
// kept as separate facts and none is inferred from another.

import { STORES } from './config.mjs'
import { autoCheckUrl, factoryEquipmentUrl, listingUrl, photoUrl, windowStickerUrl } from './links.mjs'

const ROLE_LABELS = Object.freeze({
  sales: 'Sales', manager: 'Manager', coordinator: 'Coordinator', porter: 'Porter', driver: 'Driver', group_manager: 'Group manager',
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

function movementSignal(record, transfer, now) {
  const movement = record.movement ?? {}
  if (!ledgerBacked(record, transfer)) return null
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
  }
}

function isListed(record) {
  const state = `${record.publicListingState ?? ''} ${record.websiteStatus ?? ''}`.toLowerCase()
  if (state.includes('not found') || state.includes('removed') || state.includes('not listed')) return false
  if (state.includes('listed') || state.includes('available')) return true
  return record.listingUrl ? true : null
}

export function toPanelVehicle(record, bootstrap, { now = Date.now() } = {}) {
  const meta = bootstrap.meta ?? {}
  const publicState = dataState(meta.publicFreshness)
  const dealerMailState = dataState(meta.dealerMailFreshness)
  const transfer = (bootstrap.transfers ?? []).find((item) => item.vin === record.vin && item.id === record.movement?.transferId)
    ?? (bootstrap.transfers ?? []).find((item) => item.vin === record.vin && !isTerminal(item))
  const features = typeof record.features === 'string'
    ? [...new Set(record.features.split(/\s*\|\s*|\s*,\s*/).map((item) => item.trim()).filter(Boolean))]
    : []
  const photos = [...new Set((record.imageUrls ?? (record.imageUrl ? [record.imageUrl] : [])).map(photoUrl).filter(Boolean))]
  const disposition = record.managerDisposition
  return {
    id: record.vin,
    vin: record.vin,
    stockNumber: text(record.stockNumber) || '—',
    name: vehicleName(record),
    year: record.year ?? '',
    make: text(record.make) || '',
    model: text(record.model) || '',
    trim: text(record.trim),
    price: number(record.listedPrice),
    msrp: number(record.msrp),
    mileage: number(record.mileage),
    daysListed: number(record.daysListed),
    exteriorColor: text(record.exteriorColor),
    interiorColor: text(record.interiorColor),
    bodyStyle: text(record.bodyStyle),
    drivetrain: text(record.drivetrain),
    engine: text(record.engine),
    transmission: text(record.transmission),
    fuelType: text(record.fuelType),
    certified: record.certified === true,
    features,
    photos,
    changeSummary: text(record.changeSummary),
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
    hold: holdSignal(record, dealerMailState),
    location: resolveLocation(record, transfer),
    movement: movementSignal(record, transfer, now),
    managerLog: disposition
      ? {
        soldLabel: disposition.soldLabel, deliveryLabel: disposition.deliveryLabel, deliveryDate: text(disposition.deliveryDate), sourceStore: disposition.sourceStore, confidence: disposition.confidence,
        dataState: dataState(meta.managerDispositionFreshness ?? disposition.dataState ?? 'unknown'),
      }
      : null,
    documents: {
      autoCheck: record.autoCheckReport ? { url: autoCheckUrl(record.autoCheckReport.url), score: number(record.autoCheckReport.score), rangeLow: number(record.autoCheckReport.scoreRangeLow), rangeHigh: number(record.autoCheckReport.scoreRangeHigh), ownerCount: number(record.autoCheckReport.ownerCount) } : null,
      windowSticker: record.windowSticker ? { url: windowStickerUrl(record.windowSticker.url), totalMsrp: number(record.windowSticker.totalMsrp), pricingCurrency: text(record.windowSticker.pricingCurrency), originalMarket: text(record.windowSticker.originalMarket) } : null,
      factoryEquipment: record.factoryEquipment ? { url: factoryEquipmentUrl(record.factoryEquipment.url), totalMsrp: number(record.factoryEquipment.totalMsrp), packages: (record.factoryEquipment.packages ?? []).map((item) => text(item?.name)).filter(Boolean) } : null,
    },
  }
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

/** The app's own rule for showing "Request vehicle". */
export function canRequestVehicle(vehicle, access) {
  if (!access || access.canCreateTransfer === false) return false
  if (!['sales', 'manager', 'group_manager'].includes(access.role)) return false
  if (vehicle.homeStore === access.store) return false
  return !vehicle.movement?.transferId
}

export function requestBlockedReason(vehicle, access) {
  if (!access) return 'Sign in to request vehicles.'
  if (!['sales', 'manager', 'group_manager'].includes(access.role) || access.canCreateTransfer === false) return 'Your role cannot request vehicles.'
  if (vehicle.homeStore === access.store) return `Already at ${access.store}, your working store.`
  if (vehicle.movement?.transferId) return 'A move is already in progress.'
  return null
}

export function buildPanelData(bootstrap, { now = Date.now() } = {}) {
  const vehicles = (bootstrap.vehicles ?? []).map((record) => toPanelVehicle(record, bootstrap, { now }))
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
