import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { STORE_NAMES } from '../constants.mjs'
import { MANAGER_DISPOSITION_AUTHORITY, MANAGER_DISPOSITION_COVERAGE_CAVEAT, MANAGER_DISPOSITION_INDEPENDENCE } from '../manager-disposition-schema.mjs'

const SCOPES = ['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read']
const STATES = ['current', 'stale_unverified', 'incomplete', 'unknown']
const HOLD_STATES = ['primary', 'backup', 'multiple', 'none_observed', 'stale', 'unknown']
const MANAGER_MATCH_STATES = ['matched', 'matched_vin_stock_review', 'not_in_current_release', 'stock_not_in_current_release', 'stock_ambiguous']
const CHANGE_TYPES = ['new_arrival', 'removed', 'price_change', 'mileage_change', 'website_status_change', 'stock_correction', 'store_transfer']
const CHANGE_FIELDS = {
  new_arrival: { field: 'Public listing', valueType: 'state', aliases: ['Public listing'] },
  removed: { field: 'Public listing', valueType: 'state', aliases: ['Public listing'] },
  price_change: { field: 'Listed price', valueType: 'money', aliases: ['Listed price', 'listed_price', 'listedPrice'] },
  mileage_change: { field: 'Mileage', valueType: 'mileage', aliases: ['Mileage', 'mileage'] },
  website_status_change: { field: 'Website Status', valueType: 'text', aliases: ['Website Status', 'website_status', 'availability'] },
  stock_correction: { field: 'Stock number', valueType: 'text', aliases: ['Stock number', 'stock_number', 'stockNumber'] },
  store_transfer: { field: 'Source physical store', valueType: 'store', aliases: ['Source physical store', 'store', 'Store'] },
}
const SORT_FIELDS = ['vehicleName', 'stockNumber', 'year', 'listedPrice', 'mileage', 'daysListed', 'make', 'model', 'publicStore', 'homeStore']
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const DISCLAIMER = 'Listing, hold, location, and report signals do not confirm availability, sale, delivery, funding, condition, or installed equipment. Confirm with the store.'
const LISTING_DOMAINS = {
  Howell: 'www.bobmaxeyfordhowell.com',
  Fowlerville: 'www.bobmaxeyfordinfowlerville.com',
  'Ford Detroit': 'www.bobmaxeyford.com',
  Lincoln: 'www.bobmaxeylincoln.com',
}
const PHOTO_CDN_DOMAINS = ['dealeron.com', 'homenetinc.com', 'cai-media-management.com', 'vauto.com']
const PHOTO_DEALER_DOMAINS = new Set(Object.values(LISTING_DOMAINS))

export class IntegrationReadError extends Error {
  constructor(message, { status = 400, code = 'INVALID_QUERY' } = {}) {
    super(message)
    this.name = 'IntegrationReadError'
    this.status = status
    this.code = code
  }
}

const fail = (message, status = 400, code = 'INVALID_QUERY') => { throw new IntegrationReadError(message, { status, code }) }
const text = (value, max = 2000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : null
const number = (value, { positive = false, integer = false } = {}) => typeof value === 'number' && Number.isFinite(value) && value >= (positive ? Number.EPSILON : 0) && (!integer || Number.isInteger(value)) ? value : null
const bool = value => typeof value === 'boolean' ? value : null
const array = value => Array.isArray(value) ? value : []
const strings = value => array(value).slice(0, 2000).map(item => text(item)).filter(item => item !== null)
const store = value => STORE_NAMES.includes(value) ? value : null
const freshness = value => STATES.includes(value) ? value : 'unknown'
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clone = value => structuredClone(value)
const folded = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}*?~|]/gu, '')

function safeUrl(value, allowedHosts) {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if (allowedHosts && !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null
    // Links must not become a side channel for session credentials.
    if ([...url.searchParams.keys()].some(key => /token|secret|session|password|cookie|authorization|api.?key|credential/i.test(key))) return null
    return url.href
  } catch { return null }
}

function listingUrl(value, vin, physicalStore) {
  const url = safeUrl(value, LISTING_DOMAINS[physicalStore] ? [LISTING_DOMAINS[physicalStore].replace(/^www\./, '')] : [])
  return url && url.toUpperCase().includes(vin) ? url : null
}

function photoUrl(value, vin) {
  const candidate = safeUrl(value)
  if (!candidate) return null
  const url = new URL(candidate)
  // Keep the existing CDN boundary. The app's public-photo reader also emits
  // VIN-specific dealer URLs; its approved galleries must survive projection.
  if (PHOTO_CDN_DOMAINS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return candidate
  if (!PHOTO_DEALER_DOMAINS.has(url.hostname) || !VIN.test(vin ?? '')) return null
  const pathname = url.pathname.replace(/\/{2,}/g, '/')
  let decodedPath
  try { decodedPath = decodeURIComponent(pathname) } catch { return null }
  if (!pathname.toLowerCase().startsWith('/inventoryphotos/') ||
      !pathname.toLowerCase().includes(`/${vin.toLowerCase()}/`) ||
      !/\.(?:jpe?g|png|webp)$/i.test(pathname) || decodedPath.includes('\\') || decodedPath.split('/').includes('..')) return null
  // Match the source reader's canonical form; do not pass tracking or fragments.
  return `${url.origin}${pathname}`
}

function autoCheck(value) {
  if (!value || typeof value !== 'object') return null
  const recentInspection = value.recentInspection && typeof value.recentInspection === 'object' && !Array.isArray(value.recentInspection)
    ? { date: text(value.recentInspection.date), types: array(value.recentInspection.types).map(text).filter(Boolean).slice(0, 8) }
    : null
  return {
    dataState: freshness(value.dataState),
    reportRunAt: text(value.reportRunAt),
    score: number(value.score), scoreRangeLow: number(value.scoreRangeLow), scoreRangeHigh: number(value.scoreRangeHigh),
    usage: text(value.usage), ownerCount: number(value.ownerCount, { integer: true }),
    lastReportedOdometer: number(value.lastReportedOdometer), lastReportedOdometerDate: text(value.lastReportedOdometerDate),
    vehicleClass: text(value.vehicleClass), assemblyCountry: text(value.assemblyCountry), estimatedInServiceDate: text(value.estimatedInServiceDate),
    checks: array(value.checks).slice(0, 2000).map(check => ({ label: text(check?.label), status: text(check?.status), detail: text(check?.detail) })),
    ...(recentInspection?.date && recentInspection.types.length ? { recentInspection } : {}),
  }
}

function sticker(value) {
  if (!value || typeof value !== 'object') return null
  return {
    dataState: freshness(value.dataState), originalMarket: text(value.originalMarket), pricingCurrency: text(value.pricingCurrency),
    pricingCurrencyEvidence: text(value.pricingCurrencyEvidence), vehicleDescription: text(value.vehicleDescription), equipmentGroup: text(value.equipmentGroup), equipmentGroupPrice: number(value.equipmentGroupPrice),
    basePrice: number(value.basePrice, { positive: true }), totalOptions: number(value.totalOptions), destinationCharge: number(value.destinationCharge), totalMsrp: number(value.totalMsrp, { positive: true }),
    exteriorColor: text(value.exteriorColor), interiorColor: text(value.interiorColor), engine: text(value.engine), transmission: text(value.transmission),
    ...(Array.isArray(value.equipmentGroupContents) ? { equipmentGroupContents: strings(value.equipmentGroupContents) } : {}),
    options: strings(value.options), standardEquipment: strings(value.standardEquipment), warranty: strings(value.warranty),
    isOriginalWindowSticker: true,
  }
}

function factoryEquipment(value) {
  if (!value || typeof value !== 'object') return null
  return {
    dataState: freshness(value.dataState), capturedAt: text(value.capturedAt), vehicleDescription: text(value.vehicleDescription),
    basePrice: number(value.basePrice, { positive: true }), totalOptions: number(value.totalOptions), destinationCharge: number(value.destinationCharge), totalMsrp: number(value.totalMsrp, { positive: true }),
    exteriorColor: text(value.exteriorColor), interiorColor: text(value.interiorColor), engine: text(value.engine), transmission: text(value.transmission), drivetrain: text(value.drivetrain),
    packages: array(value.packages).slice(0, 2000).map(item => ({ name: text(item?.name), code: text(item?.code), price: number(item?.price), features: strings(item?.features) })),
    sections: array(value.sections).slice(0, 2000).map(section => ({ name: text(section?.name), items: array(section?.items).slice(0, 2000).map(item => ({ label: text(item?.label), price: number(item?.price) })) })),
    isOriginalWindowSticker: false,
    description: 'VIN-specific informational equipment label; not an original Monroney window sticker.',
  }
}

function fordOasis(value) {
  if (!value || typeof value !== 'object') return null
  return {
    dataState: freshness(value.dataState), capturedAt: text(value.capturedAt), vehicleDescription: text(value.vehicleDescription),
    versionSeries: text(value.versionSeries), buildDate: text(value.buildDate), warrantyStartDate: text(value.warrantyStartDate),
    bodyStyle: text(value.bodyStyle, 160), driveType: text(value.driveType, 160), paintColor: text(value.paintColor, 160), paintCode: text(value.paintCode, 160),
    engine: text(value.engine, 160), engineCalibration: text(value.engineCalibration, 160), transmission: text(value.transmission, 160),
    axleRatio: text(value.axleRatio, 160), axleCode: text(value.axleCode, 160), grossVehicleWeight: text(value.grossVehicleWeight, 160),
    wheelSize: text(value.wheelSize, 160), tire: text(value.tire, 160), syncVersion: text(value.syncVersion, 160), fuelType: text(value.fuelType, 160),
    releaseDate: text(value.releaseDate), monthsInService: number(value.monthsInService, { integer: true }), saleMileage: number(value.saleMileage),
    openActionsCaptured: value.openActionsCaptured === true && Array.isArray(value.openFieldServiceActions),
    openFieldServiceActions: array(value.openFieldServiceActions).slice(0, 60).map(item => ({ code: text(item?.code, 20), description: text(item?.description, 300) })),
    warrantyCoverages: array(value.warrantyCoverages).slice(0, 20).map(item => ({ type: text(item?.type, 120), description: text(item?.description, 300) })),
    extendedCoverageExpirations: strings(value.extendedCoverageExpirations).slice(0, 10),
    disclaimer: 'Ford OASIS facts are read-only reference evidence. Open field service actions do not establish availability, condition, sale, delivery, or physical presence.',
  }
}

function warrantyCoverage(value) {
  return {
    type: text(value?.type, 120), termText: text(value?.termText, 120), termMonths: number(value?.termMonths, { integer: true }), termMiles: number(value?.termMiles, { integer: true }),
    unlimitedMiles: bool(value?.unlimitedMiles), unlimitedMonths: bool(value?.unlimitedMonths), remainingMiles: number(value?.remainingMiles, { integer: true }),
    remainingMonths: number(value?.remainingMonths, { integer: true }), remainingMilesText: text(value?.remainingMilesText, 40), remainingTimeText: text(value?.remainingTimeText, 40),
    status: text(value?.status, 80),
  }
}

function warrantyCheck(value) {
  if (!value || typeof value !== 'object') return null
  const result = {
    dataState: freshness(value.dataState), capturedAt: text(value.capturedAt), mileageEntered: number(value.mileageEntered, { integer: true }), mileageSource: text(value.mileageSource, 80),
    disclaimer: 'Warranty coverage is read-only reference evidence and does not establish vehicle condition or availability.',
  }
  if (value.autoCheck && typeof value.autoCheck === 'object') {
    result.autoCheck = {
      inServiceDate: text(value.autoCheck.inServiceDate), inServiceAgeMonths: number(value.autoCheck.inServiceAgeMonths, { integer: true }), defaultMileage: number(value.autoCheck.defaultMileage, { integer: true }),
      coverages: array(value.autoCheck.coverages).slice(0, 12).map(warrantyCoverage),
    }
  }
  if (value.fordOasis && typeof value.fordOasis === 'object') {
    result.fordOasis = {
      warrantyStartDate: text(value.fordOasis.warrantyStartDate), monthsInService: number(value.fordOasis.monthsInService, { integer: true }),
      coverages: array(value.fordOasis.coverages).slice(0, 12).map(warrantyCoverage),
    }
  }
  return result
}

function publicHold(value, dealerMailFreshness) {
  const rawState = HOLD_STATES.includes(value?.state) ? value.state : 'unknown'
  const state = dealerMailFreshness === 'current' ? rawState : rawState === 'unknown' ? 'unknown' : 'stale'
  const labels = { primary: 'Current primary hold found', backup: 'Current backup hold found', multiple: 'Current primary and backup holds found', none_observed: 'No current DealerMail hold found', stale: 'Hold status unverified', unknown: 'Hold status unknown' }
  return {
    state, label: labels[state], dataState: dealerMailFreshness,
    hasCurrentHold: ['primary', 'backup', 'multiple'].includes(state) ? true : state === 'none_observed' ? false : null,
    backupCount: ['primary', 'backup', 'multiple'].includes(state) ? number(value?.backupCount, { integer: true }) : state === 'none_observed' ? 0 : null,
  }
}

function managerDispositionView(value, dataState) {
  if (!value || typeof value !== 'object' || value.soldManagerLog !== true) return null
  const delivered = bool(value.deliveredManagerLog)
  const matchStatus = MANAGER_MATCH_STATES.includes(value.matchStatus) ? value.matchStatus : null
  if (delivered === null || !matchStatus) return null
  return {
    stockNumber: text(value.stockNumber, 80),
    vin: typeof value.vin === 'string' && VIN.test(value.vin) ? value.vin : null,
    vehicleName: text(value.vehicleName),
    soldManagerLog: true,
    deliveredManagerLog: delivered,
    deliveryDate: delivered ? text(value.deliveryDate, 10) : null,
    confidence: ['high', 'medium-high', 'medium', 'low'].includes(value.confidence) ? value.confidence : null,
    sourceStore: store(value.sourceStore), sourcePeriod: text(value.sourcePeriod, 7),
    matchMethod: ['vin', 'unique_stock', 'not_matched'].includes(value.matchMethod) ? value.matchMethod : null,
    matchStatus, physicalStore: store(value.physicalStore), reviewRequired: bool(value.reviewRequired),
    soldLabel: 'Sold — manager log',
    deliveryLabel: delivered ? 'Delivered — manager log' : 'Not marked delivered — manager log',
    dataState: freshness(dataState ?? value.dataState),
    statusAuthority: MANAGER_DISPOSITION_AUTHORITY,
    statusIndependence: MANAGER_DISPOSITION_INDEPENDENCE,
  }
}

function projectVehicle(value, meta) {
  const movement = value.movement ?? {}
  const confidence = ['verified', 'reported', 'stale', 'conflicting', 'unknown'].includes(movement.locationConfidence) ? movement.locationConfidence : 'unknown'
  return {
    vin: text(value.vin, 17), stockNumber: text(value.stockNumber, 80), year: number(typeof value.year === 'string' && /^\d{4}$/.test(value.year) ? Number(value.year) : value.year, { integer: true }),
    make: text(value.make), model: text(value.model), trim: text(value.trim), vehicleName: text(value.vehicleName),
    listedPrice: number(value.listedPrice, { positive: true }), msrp: number(value.msrp, { positive: true }), mileage: number(value.mileage), daysListed: number(value.daysListed, { integer: true }),
    exteriorColor: text(value.exteriorColor), interiorColor: text(value.interiorColor), bodyStyle: text(value.bodyStyle), bodyType: text(value.bodyType),
    drivetrain: text(value.drivetrain), engine: text(value.engine), transmission: text(value.transmission), fuelType: text(value.fuelType), mpgCity: number(value.mpgCity, { positive: true }), mpgHighway: number(value.mpgHighway, { positive: true }),
    certified: bool(value.certified), inventoryDate: text(value.inventoryDate), modelCode: text(value.modelCode), features: text(value.features, 65536),
    listingUrl: listingUrl(value.listingUrl, value.vin, value.publicStore), photoCount: number(value.photoCount, { integer: true }),
    imageUrl: photoUrl(value.imageUrl, value.vin),
    imageUrls: array(value.imageUrls).slice(0, 500).map(url => photoUrl(url, value.vin)).filter(Boolean),
    publicStore: store(value.publicStore), homeStore: store(value.homeStore), homeStoreConfirmed: bool(value.homeStoreConfirmed), crmStore: store(value.crmStore), sourceReportedLocation: store(value.sourceReportedLocation),
    websiteStatus: text(value.websiteStatus) || 'Not provided', publicListingState: text(value.publicListingState),
    dealerOn: { inStock: bool(value.dealerOn?.inStock), inTransit: bool(value.dealerOn?.inTransit), inProduction: bool(value.dealerOn?.inProduction) },
    managerDisposition: managerDispositionView(value.managerDisposition, meta.managerDispositionFreshness),
    hold: publicHold(value.hold, meta.dealerMailFreshness),
    location: {
      currentStore: store(movement.currentLocation), destinationStore: store(movement.destination), confidence,
      lastConfirmedAt: text(movement.lastConfirmedAt), departedAt: text(movement.departedAt),
      state: /^[a-z_]{1,48}$/.test(movement.state ?? '') ? movement.state : 'unknown',
    },
    sourceFreshness: { public: meta.publicFreshness, dealerMail: meta.dealerMailFreshness, managerDisposition: meta.managerDispositionFreshness },
    publicScan: value.publicScan ? {
      locationCity: text(value.publicScan.locationCity), genericColor: text(value.publicScan.genericColor),
      firstSeen: text(value.publicScan.firstSeen), lastSeen: text(value.publicScan.lastSeen),
      dealerLocationId: number(value.publicScan.dealerLocationId, { integer: true }), vehicleId: number(value.publicScan.vehicleId, { positive: true, integer: true }),
      sourceCount: number(value.publicScan.sourceCount, { integer: true }),
    } : null,
    autoCheckReport: autoCheck(value.autoCheckReport), windowSticker: sticker(value.windowSticker), factoryEquipment: factoryEquipment(value.factoryEquipment),
    fordOasis: fordOasis(value.fordOasis), warrantyCheck: warrantyCheck(value.warrantyCheck),
  }
}

function scalars(value, result = []) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    result.push(String(value))
    if (typeof value === 'number') result.push(value.toLocaleString('en-US'))
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
      const date = new Date(value.slice(0, 10) + 'T12:00:00Z')
      if (Number.isFinite(date.getTime())) for (const month of ['long', 'short', 'numeric']) result.push(date.toLocaleDateString('en-US', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' }))
    }
  } else if (Array.isArray(value)) value.forEach(item => scalars(item, result))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => scalars(item, result))
  return result
}

function matches(value, q) {
  if (!q) return true
  const fields = scalars(value)
  const needle = folded(q)
  return fields.some(field => field.toLowerCase().includes(q.toLowerCase()) || (needle.length > 0 && folded(field).includes(needle)))
}

function changeValue(value, kind) {
  if (kind === 'money' || kind === 'mileage') return number(value)
  if (kind === 'store') return store(value)
  if (kind === 'state') return ['Not in prior public release', 'Listed in current public release', 'Listed in prior public release', 'Not in current public release'].includes(value) ? value : null
  return text(value)
}

function queryObject(query, allowed) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || ![Object.prototype, null].includes(Object.getPrototypeOf(query))) fail('Query must be an object')
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) fail(`Unsupported query field: ${key}`)
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > (key === 'cursor' ? 8192 : 256))) fail(`Invalid query field: ${key}`)
  }
  return query
}

function scalarQuery(value, fallback = '') { return value === undefined ? fallback : String(value).trim() }
function numericQuery(value, name, { integer = false, max = Number.MAX_SAFE_INTEGER, min = 0 } = {}) {
  if (value === undefined) return null
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) fail(`Invalid ${name}`)
  const result = Number(value)
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) fail(`Invalid ${name}`)
  return result
}
function booleanQuery(value, name) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  fail(`Invalid ${name}`)
}
function dateQuery(value, name) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`Invalid ${name}; expected YYYY-MM-DD`)
  const parsed = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`Invalid ${name}`)
  return value
}

/** A fresh instance operates on one server-selected release and immutable scoped read model. */
export function createIntegrationReadService({ bootstrap, principal, bundleSha256, cursorSecret, now = () => new Date() }) {
  if (!bootstrap || !Array.isArray(bootstrap.vehicles) || !bootstrap.meta) fail('Verified release is unavailable', 503, 'SOURCE_DATA_UNAVAILABLE')
  if (!principal || !Array.isArray(principal.stores) || !principal.stores.length || principal.stores.some(item => !STORE_NAMES.includes(item)) || !Array.isArray(principal.scopes)) fail('Integration principal is invalid', 403, 'FORBIDDEN')
  if (typeof bundleSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(bundleSha256) || typeof cursorSecret !== 'string' || cursorSecret.length < 32) fail('Integration read service is not configured', 503, 'INTEGRATION_UNAVAILABLE')
  const allowedStores = STORE_NAMES.filter(item => principal.stores.includes(item))
  const scopes = SCOPES.filter(item => principal.scopes.includes(item))
  const requireScope = scope => { if (!scopes.includes(scope)) fail('This integration does not have the required scope', 403, 'INSUFFICIENT_SCOPE') }
  const sourceMeta = {
    publicFreshness: freshness(bootstrap.meta.publicFreshness),
    dealerMailFreshness: freshness(bootstrap.meta.dealerMailFreshness),
    managerDispositionFreshness: freshness(bootstrap.meta.managerDispositionFreshness),
  }
  const resourceFreshness = freshness(bootstrap.meta.resourceFreshness)
  const managerDispositionCoverage = {
    status: bootstrap.meta.managerDispositionCoverageStatus === 'provided' ? 'provided' : 'not_provided',
    coveredSourceStores: STORE_NAMES.filter(item => array(bootstrap.meta.managerDispositionCoveredSourceStores).includes(item)),
    caveat: MANAGER_DISPOSITION_COVERAGE_CAVEAT,
  }
  if (managerDispositionCoverage.status === 'not_provided') managerDispositionCoverage.coveredSourceStores = []
  const meta = {
    schemaVersion: 'inventory-read.v1', reportDate: text(bootstrap.meta.reportDate), completedAt: text(bootstrap.meta.completedAt), bundleSha256,
    timezone: text(bootstrap.meta.timezone) || 'America/New_York', allowedStores, sourceFreshness: sourceMeta,
    managerDispositionCoverage,
    availabilityCaveat: DISCLAIMER, historyCoverage: 'Selected release only; date filters do not fetch earlier snapshots.',
    excludedFields: ['customer identity', 'salesperson identity', 'hold reasons', 'CRM comments and alerts', 'raw CDK', 'manager-log free text', 'free-form operational notes', 'raw source objects', 'authenticated document URLs'],
  }
  // Authorization is applied before projection, searching, counting, or lookups.
  const projectedVehicles = bootstrap.vehicles.filter(value => allowedStores.includes(value.publicStore) && VIN.test(value.vin ?? '')).map(value => projectVehicle(value, sourceMeta))
  const resourcesByVin = new Map(projectedVehicles.map(value => [value.vin, Object.freeze({
    autoCheckReport: value.autoCheckReport, windowSticker: value.windowSticker, factoryEquipment: value.factoryEquipment,
    fordOasis: value.fordOasis, warrantyCheck: value.warrantyCheck,
  })]))
  const vehicles = projectedVehicles.map(({ fordOasis, warrantyCheck, ...value }) => value)
  const publicChanges = array(bootstrap.publicChanges).filter(value => allowedStores.includes(value.store) && CHANGE_TYPES.includes(value.type) && CHANGE_FIELDS[value.type].aliases.includes(value.field) && VIN.test(value.vin ?? '')).map(value => ({
    id: text(value.id, 200), type: value.type, field: CHANGE_FIELDS[value.type].field,
    valueType: CHANGE_FIELDS[value.type].valueType,
    reportDate: text(value.reportDate, 10), previousReportDate: text(value.previousReportDate, 10), vin: value.vin, stockNumber: text(value.stockNumber, 80), vehicleName: text(value.vehicleName), store: store(value.store),
    beforeValue: changeValue(value.beforeValue, CHANGE_FIELDS[value.type].valueType),
    afterValue: changeValue(value.afterValue, CHANGE_FIELDS[value.type].valueType),
    currentVehicle: bool(value.currentVehicle), listingUrl: listingUrl(value.listingUrl, value.vin, value.store),
  }))
  const managerDispositions = array(bootstrap.managerDispositions)
    .map(value => managerDispositionView(value, sourceMeta.managerDispositionFreshness))
    .filter(value => value && allowedStores.includes(value.physicalStore ?? value.sourceStore))
  const allStoresGranted = allowedStores.length === STORE_NAMES.length
  const binding = digest({ bundleSha256, clientId: text(principal.clientId), userId: text(principal.userId), role: text(principal.role), allowedStores, scopes, data: digest([vehicles, publicChanges, managerDispositions]) })

  function selectedStore(value) {
    const selected = scalarQuery(value)
    if (selected && !STORE_NAMES.includes(selected)) fail('Invalid store')
    return selected
  }

  function paginate(rows, normalized, endpoint, cursor) {
    let offset = 0
    const queryHash = digest({ endpoint, query: normalized })
    if (cursor !== undefined) {
      try {
        if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
        const [payload, signature] = cursor.split('.')
        const expected = createHmac('sha256', cursorSecret).update(payload).digest()
        const received = Buffer.from(signature, 'base64url')
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error()
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        if (decoded.binding !== binding || decoded.queryHash !== queryHash || !Number.isSafeInteger(decoded.offset) || decoded.offset <= 0 || decoded.offset >= rows.length) throw new Error()
        offset = decoded.offset
      } catch { fail('Cursor is invalid or the data changed; start from the first page', 400, 'INVALID_CURSOR') }
    }
    const end = Math.min(offset + normalized.limit, rows.length)
    let nextCursor = null
    if (end < rows.length) {
      const payload = Buffer.from(JSON.stringify({ binding, queryHash, offset: end })).toString('base64url')
      nextCursor = `${payload}.${createHmac('sha256', cursorSecret).update(payload).digest('base64url')}`
    }
    return { data: clone(rows.slice(offset, end)), meta: clone(meta), pagination: { total: rows.length, limit: normalized.limit, returned: end - offset, nextCursor } }
  }

  function rowsByStore(makeRow) {
    return allowedStores.map(publicStore => makeRow(publicStore, vehicles.filter(value => value.publicStore === publicStore)))
  }

  function matchesVehicle(value, q) {
    return matches({ vehicle: value, resources: resourcesByVin.get(value.vin) ?? null }, q)
  }

  function changeCounts() {
    return Object.fromEntries(CHANGE_TYPES.map(type => [type, publicChanges.filter(value => value.type === type).length]))
  }

  function resourceCoverage(rows = vehicles) {
    return {
      vehicles: rows.length,
      withPhotos: rows.filter(value => (value.photoCount ?? 0) > 0).length,
      autoCheck: rows.filter(value => resourcesByVin.get(value.vin)?.autoCheckReport).length,
      originalWindowSticker: rows.filter(value => resourcesByVin.get(value.vin)?.windowSticker).length,
      factoryEquipment: rows.filter(value => resourcesByVin.get(value.vin)?.factoryEquipment).length,
      fordOasis: rows.filter(value => resourcesByVin.get(value.vin)?.fordOasis).length,
      warrantyCheck: rows.filter(value => resourcesByVin.get(value.vin)?.warrantyCheck).length,
    }
  }

  function safeSourceWarnings() {
    return [
      ['public', sourceMeta.publicFreshness], ['dealerMail', sourceMeta.dealerMailFreshness],
      ['resources', resourceFreshness], ['managerDisposition', sourceMeta.managerDispositionFreshness],
    ].filter(([, state]) => state !== 'current').map(([source, state]) => ({ source, state, code: `${source}_not_current` }))
  }

  function summaryStoreRow(publicStore, rows) {
    const currentHolds = sourceMeta.dealerMailFreshness === 'current'
    return {
      publicStore,
      publiclyListedVehicles: rows.length,
      crmStorePresentOnPublicRows: rows.filter(value => value.crmStore !== null).length,
      crmStoreMismatchOnPublicRows: rows.filter(value => value.crmStore && value.crmStore !== value.publicStore).length,
      homeStoreMismatchOnPublicRows: rows.filter(value => value.homeStore && value.homeStore !== value.publicStore).length,
      currentLocationMismatchOnPublicRows: rows.filter(value => value.location.currentStore && value.location.currentStore !== value.publicStore).length,
      currentHeldPublicVins: currentHolds ? rows.filter(value => value.hold.hasCurrentHold === true).length : null,
      noCurrentHoldFoundPublicVins: currentHolds ? rows.filter(value => value.hold.state === 'none_observed').length : null,
      holdUnverifiedPublicVins: rows.filter(value => value.hold.hasCurrentHold === null).length,
      managerSoldSignals: rows.filter(value => value.managerDisposition?.soldManagerLog === true).length,
      managerDeliveredSignals: rows.filter(value => value.managerDisposition?.deliveredManagerLog === true).length,
    }
  }

  function operationsReport() {
    const currentHolds = sourceMeta.dealerMailFreshness === 'current'
    return {
      report: {
        reportDate: meta.reportDate, completedAt: meta.completedAt, timezone: meta.timezone, bundleSha256,
        sourceFreshness: { ...clone(sourceMeta), resources: resourceFreshness }, scopeFullyCoversGroup: allStoresGranted,
      },
      counts: {
        visiblePublicVehicles: vehicles.length,
        completeGroupPublicVehicles: allStoresGranted ? number(bootstrap.meta.publicCount, { integer: true }) : null,
        completeGroupCrmRows: allStoresGranted ? number(bootstrap.meta.crmCount, { integer: true }) : null,
        completeGroupHeldVins: allStoresGranted ? number(bootstrap.meta.heldVinCount, { integer: true }) : null,
        currentHeldPublicVins: currentHolds ? vehicles.filter(value => value.hold.hasCurrentHold === true).length : null,
        currentBackupRecordsOnPublicVins: currentHolds ? vehicles.reduce((total, value) => total + (value.hold.backupCount ?? 0), 0) : null,
        holdUnverifiedPublicVins: vehicles.filter(value => value.hold.hasCurrentHold === null).length,
        managerSoldSignals: managerDispositions.length,
        managerDeliveredSignals: managerDispositions.filter(value => value.deliveredManagerLog).length,
      },
      publicChanges: changeCounts(),
      resources: resourceCoverage(),
      stores: rowsByStore(summaryStoreRow),
      warnings: safeSourceWarnings(),
      caveats: [DISCLAIMER, 'Complete CRM counts are shown only to grants covering all four stores. Per-store CRM figures here are limited to publicly listed VINs with a CRM store match.'],
    }
  }

  function dataQualitySummary() {
    const currentHolds = sourceMeta.dealerMailFreshness === 'current'
    const exceptions = {
      noPublishedPrice: vehicles.filter(value => value.listedPrice === null).length,
      missingWebsiteStatus: vehicles.filter(value => value.websiteStatus === 'Not provided').length,
      onePhoto: vehicles.filter(value => value.photoCount === 1).length,
      missingDrivetrain: vehicles.filter(value => value.drivetrain === null).length,
      missingMpg: vehicles.filter(value => value.mpgCity === null || value.mpgHighway === null).length,
      missingMsrp: vehicles.filter(value => value.msrp === null).length,
      missingVehicleId: vehicles.filter(value => value.publicScan?.vehicleId === null).length,
      unusualCertifiedMake: vehicles.filter(value => value.certified === true && !['ford', 'lincoln'].includes(String(value.make ?? '').toLowerCase())).length,
      missingOfficialListingLink: vehicles.filter(value => value.listingUrl === null).length,
      crmStoreMismatch: vehicles.filter(value => value.crmStore && value.crmStore !== value.publicStore).length,
      unverifiedHoldState: vehicles.filter(value => value.hold.hasCurrentHold === null).length,
      heldPublicVins: currentHolds ? vehicles.filter(value => value.hold.hasCurrentHold === true).length : null,
    }
    return {
      verifiedRelease: { reportDate: meta.reportDate, completedAt: meta.completedAt, bundleSha256, sourceFreshness: { ...clone(sourceMeta), resources: resourceFreshness }, scopeFullyCoversGroup: allStoresGranted },
      visibleVehicles: vehicles.length,
      resources: resourceCoverage(),
      exceptions,
      warnings: safeSourceWarnings(),
      excludedFields: clone(meta.excludedFields),
      caveat: 'Exception counts preserve source values and flag review needs; they do not silently correct the daily source data.',
    }
  }

  function reconciliationSummary() {
    return {
      coverage: {
        publicNormalizedVinRows: vehicles.length,
        completeGroupCrmRows: allStoresGranted ? number(bootstrap.meta.crmCount, { integer: true }) : null,
        note: 'This comparison is restricted to current publicly listed VINs. CRM-only rows, customer reasons, comments, alerts, and raw CDK data are not exposed.',
      },
      stores: rowsByStore(summaryStoreRow),
      sourceFreshness: { ...clone(sourceMeta), resources: resourceFreshness },
      caveat: DISCLAIMER,
    }
  }

  return {
    capabilities: Object.freeze({ schemaVersion: 'inventory-read.v1', readOnly: true, scopes: Object.freeze(scopes), stores: Object.freeze(allowedStores), maxPageSize: 100, defaultPageSize: 20, historicalSnapshots: false, licensedReports: 'Parsed facts only; authenticated document URLs and original reports excluded', inventorySortFields: Object.freeze(SORT_FIELDS.slice()), managerDispositions: true }),
    inventory(query = {}) {
      requireScope('inventory.read')
      queryObject(query, ['q', 'store', 'make', 'model', 'year', 'minPrice', 'maxPrice', 'minMileage', 'maxMileage', 'holdState', 'sort', 'direction', 'limit', 'cursor'])
      const normalized = {
        q: scalarQuery(query.q), store: selectedStore(query.store), make: scalarQuery(query.make), model: scalarQuery(query.model), year: numericQuery(query.year, 'year', { integer: true, min: 1886, max: 2200 }),
        minPrice: numericQuery(query.minPrice, 'minPrice'), maxPrice: numericQuery(query.maxPrice, 'maxPrice'), minMileage: numericQuery(query.minMileage, 'minMileage'), maxMileage: numericQuery(query.maxMileage, 'maxMileage'),
        holdState: scalarQuery(query.holdState), sort: scalarQuery(query.sort, 'vehicleName'), direction: scalarQuery(query.direction, 'asc'), limit: numericQuery(query.limit ?? 20, 'limit', { integer: true, min: 1, max: 100 }),
      }
      if (!SORT_FIELDS.includes(normalized.sort) || !['asc', 'desc'].includes(normalized.direction)) fail('Invalid sort or direction')
      if (normalized.holdState && !HOLD_STATES.includes(normalized.holdState)) fail('Invalid holdState')
      if ((normalized.minPrice !== null && normalized.maxPrice !== null && normalized.minPrice > normalized.maxPrice) || (normalized.minMileage !== null && normalized.maxMileage !== null && normalized.minMileage > normalized.maxMileage)) fail('Minimum cannot exceed maximum')
      const rows = vehicles.filter(value => (!normalized.store || value.publicStore === normalized.store) && (!normalized.make || folded(value.make) === folded(normalized.make)) && (!normalized.model || folded(value.model) === folded(normalized.model)) && (normalized.year === null || value.year === normalized.year) && (!normalized.holdState || value.hold.state === normalized.holdState)
        && (normalized.minPrice === null || (value.listedPrice !== null && value.listedPrice >= normalized.minPrice)) && (normalized.maxPrice === null || (value.listedPrice !== null && value.listedPrice <= normalized.maxPrice))
        && (normalized.minMileage === null || (value.mileage !== null && value.mileage >= normalized.minMileage)) && (normalized.maxMileage === null || (value.mileage !== null && value.mileage <= normalized.maxMileage)) && matchesVehicle(value, normalized.q))
      rows.sort((left, right) => {
        const a = left[normalized.sort], b = right[normalized.sort]
        if (a === null && b !== null) return 1
        if (b === null && a !== null) return -1
        const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true, sensitivity: 'base' })
        return result * (normalized.direction === 'desc' ? -1 : 1) || left.vin.localeCompare(right.vin)
      })
      return paginate(rows, normalized, 'inventory', query.cursor)
    },
    vehicle(vin) {
      requireScope('inventory.read')
      const value = typeof vin === 'string' && VIN.test(vin.toUpperCase()) ? vehicles.find(row => row.vin === vin.toUpperCase()) : null
      if (!value) fail('Vehicle not found', 404, 'NOT_FOUND')
      return { data: clone(value), meta: clone(meta) }
    },
    vehicleResources(vin) {
      requireScope('inventory.read')
      const value = typeof vin === 'string' && VIN.test(vin.toUpperCase()) ? vehicles.find(row => row.vin === vin.toUpperCase()) : null
      if (!value) fail('Vehicle not found', 404, 'NOT_FOUND')
      const resources = resourcesByVin.get(value.vin)
      return {
        data: clone({
          vin: value.vin, stockNumber: value.stockNumber, vehicleName: value.vehicleName, publicStore: value.publicStore, listingUrl: value.listingUrl,
          photoCount: value.photoCount, imageUrls: value.imageUrls, autoCheckReport: resources?.autoCheckReport ?? null, windowSticker: resources?.windowSticker ?? null,
          factoryEquipment: resources?.factoryEquipment ?? null, fordOasis: resources?.fordOasis ?? null, warrantyCheck: resources?.warrantyCheck ?? null,
          sourceFreshness: value.sourceFreshness,
        }),
        meta: clone(meta),
      }
    },
    operationalInventory(query = {}) {
      requireScope('inventory.read')
      queryObject(query, ['q', 'store', 'homeStore', 'crmStore', 'currentStore', 'certified', 'hasPrice', 'hasPhoto', 'hasCurrentHold', 'hasManagerDisposition', 'resource', 'minDaysListed', 'maxDaysListed', 'sort', 'direction', 'limit', 'cursor'])
      const normalized = {
        q: scalarQuery(query.q), store: selectedStore(query.store), homeStore: selectedStore(query.homeStore), crmStore: selectedStore(query.crmStore), currentStore: selectedStore(query.currentStore),
        certified: booleanQuery(query.certified, 'certified'), hasPrice: booleanQuery(query.hasPrice, 'hasPrice'), hasPhoto: booleanQuery(query.hasPhoto, 'hasPhoto'),
        hasCurrentHold: booleanQuery(query.hasCurrentHold, 'hasCurrentHold'), hasManagerDisposition: booleanQuery(query.hasManagerDisposition, 'hasManagerDisposition'),
        resource: scalarQuery(query.resource), minDaysListed: numericQuery(query.minDaysListed, 'minDaysListed', { integer: true }), maxDaysListed: numericQuery(query.maxDaysListed, 'maxDaysListed', { integer: true }),
        sort: scalarQuery(query.sort, 'vehicleName'), direction: scalarQuery(query.direction, 'asc'), limit: numericQuery(query.limit ?? 20, 'limit', { integer: true, min: 1, max: 100 }),
      }
      const resourceFields = { autocheck: 'autoCheckReport', original_window_sticker: 'windowSticker', factory_equipment: 'factoryEquipment', ford_oasis: 'fordOasis', warranty_check: 'warrantyCheck' }
      if (normalized.resource && !Object.hasOwn(resourceFields, normalized.resource)) fail('Invalid resource')
      if (!SORT_FIELDS.includes(normalized.sort) || !['asc', 'desc'].includes(normalized.direction)) fail('Invalid sort or direction')
      if (normalized.minDaysListed !== null && normalized.maxDaysListed !== null && normalized.minDaysListed > normalized.maxDaysListed) fail('Minimum cannot exceed maximum')
      const rows = vehicles.filter(value =>
        (!normalized.store || value.publicStore === normalized.store) && (!normalized.homeStore || value.homeStore === normalized.homeStore) &&
        (!normalized.crmStore || value.crmStore === normalized.crmStore) && (!normalized.currentStore || value.location.currentStore === normalized.currentStore) &&
        (normalized.certified === null || value.certified === normalized.certified) && (normalized.hasPrice === null || (value.listedPrice !== null) === normalized.hasPrice) &&
        (normalized.hasPhoto === null || ((value.photoCount ?? 0) > 0) === normalized.hasPhoto) && (normalized.hasCurrentHold === null || value.hold.hasCurrentHold === normalized.hasCurrentHold) &&
        (normalized.hasManagerDisposition === null || (value.managerDisposition !== null) === normalized.hasManagerDisposition) &&
        (!normalized.resource || Boolean(resourcesByVin.get(value.vin)?.[resourceFields[normalized.resource]])) &&
        (normalized.minDaysListed === null || (value.daysListed !== null && value.daysListed >= normalized.minDaysListed)) &&
        (normalized.maxDaysListed === null || (value.daysListed !== null && value.daysListed <= normalized.maxDaysListed)) && matchesVehicle(value, normalized.q),
      )
      rows.sort((left, right) => {
        const a = left[normalized.sort], b = right[normalized.sort]
        if (a === null && b !== null) return 1
        if (b === null && a !== null) return -1
        const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true, sensitivity: 'base' })
        return result * (normalized.direction === 'desc' ? -1 : 1) || left.vin.localeCompare(right.vin)
      })
      return paginate(rows, normalized, 'operational-inventory', query.cursor)
    },
    changes(query = {}) {
      requireScope('changes.read')
      queryObject(query, ['q', 'store', 'type', 'from', 'to', 'limit', 'cursor'])
      const normalized = { q: scalarQuery(query.q), store: selectedStore(query.store), type: scalarQuery(query.type), from: dateQuery(query.from, 'from'), to: dateQuery(query.to, 'to'), limit: numericQuery(query.limit ?? 20, 'limit', { integer: true, min: 1, max: 100 }) }
      if (normalized.type && !CHANGE_TYPES.includes(normalized.type)) fail('Invalid change type')
      if (normalized.from && normalized.to && normalized.from > normalized.to) fail('from cannot be after to')
      const rows = publicChanges.filter(value => (!normalized.store || normalized.store === value.store) && (!normalized.type || value.type === normalized.type) && (!normalized.from || value.reportDate >= normalized.from) && (!normalized.to || value.reportDate <= normalized.to) && matches(value, normalized.q))
        .sort((left, right) => String(right.reportDate).localeCompare(String(left.reportDate)) || left.vin.localeCompare(right.vin) || String(left.id).localeCompare(String(right.id)))
      return paginate(rows, normalized, 'changes', query.cursor)
    },
    holdSummary(query = {}) {
      requireScope('holds.aggregate.read')
      queryObject(query, ['store'])
      const selected = selectedStore(query.store)
      const data = allowedStores.filter(item => !selected || item === selected).map(item => {
        const rows = vehicles.filter(value => value.publicStore === item)
        return { store: item, storeAuthority: 'Public physical store', coverage: 'Publicly listed vehicles only; not all CRM inventory', vehicles: rows.length, freshness: sourceMeta.dealerMailFreshness,
          currentHeldVins: sourceMeta.dealerMailFreshness === 'current' ? rows.filter(value => value.hold.hasCurrentHold === true).length : null,
          noCurrentHoldFound: sourceMeta.dealerMailFreshness === 'current' ? rows.filter(value => value.hold.state === 'none_observed').length : null,
          unverifiedVins: rows.filter(value => value.hold.hasCurrentHold === null).length,
          currentBackupRecords: sourceMeta.dealerMailFreshness === 'current' ? rows.reduce((sum, value) => sum + (value.hold.backupCount ?? 0), 0) : null,
        }
      })
      return { data, meta: clone(meta) }
    },
    managerDispositions(query = {}) {
      requireScope('inventory.read')
      queryObject(query, ['q', 'store', 'delivered', 'review', 'limit', 'cursor'])
      const normalized = {
        q: scalarQuery(query.q), store: selectedStore(query.store),
        delivered: scalarQuery(query.delivered), review: scalarQuery(query.review),
        limit: numericQuery(query.limit ?? 20, 'limit', { integer: true, min: 1, max: 100 }),
      }
      if (normalized.delivered && !['true', 'false'].includes(normalized.delivered)) fail('Invalid delivered filter')
      if (normalized.review && !['true', 'false'].includes(normalized.review)) fail('Invalid review filter')
      const rows = managerDispositions.filter(value => {
        const authorityStore = value.physicalStore ?? value.sourceStore
        return (!normalized.store || authorityStore === normalized.store) &&
          (!normalized.delivered || value.deliveredManagerLog === (normalized.delivered === 'true')) &&
          (!normalized.review || value.reviewRequired === (normalized.review === 'true')) &&
          matches(value, normalized.q)
      }).sort((left, right) => String(right.deliveryDate ?? '').localeCompare(String(left.deliveryDate ?? '')) || String(left.stockNumber).localeCompare(String(right.stockNumber)))
      return paginate(rows, normalized, 'manager-dispositions', query.cursor)
    },
    health() {
      requireScope('health.read')
      const checkedAt = typeof now === 'function' ? now() : now
      return { data: { ready: Boolean(meta.reportDate && vehicles.length), freshness: clone(sourceMeta), visibleVehicleCount: vehicles.length, checkedAt: new Date(checkedAt).toISOString() }, meta: clone(meta) }
    },
    dailyOperations() {
      requireScope('health.read')
      return { data: clone(operationsReport()), meta: clone(meta) }
    },
    dataQuality() {
      requireScope('health.read')
      return { data: clone(dataQualitySummary()), meta: clone(meta) }
    },
    reconciliation() {
      requireScope('health.read')
      return { data: clone(reconciliationSummary()), meta: clone(meta) }
    },
  }
}
