import { createHash } from 'node:crypto'
import { STORE_NAMES } from './constants.mjs'

export const MANAGER_DISPOSITION_SCHEMA = 'manager-disposition-overlay-v1'
export const MANAGER_DISPOSITION_AUTHORITY = 'manager-supplied sold log'
export const MANAGER_DISPOSITION_INDEPENDENCE = 'Sold and delivered manager-log evidence is shown separately from public listing, DealerMail hold, CDK, and physical-store fields.'
export const MANAGER_DISPOSITION_COVERAGE_CAVEAT = 'No row means no manager-log signal in a covered source, not unsold, available, or not delivered. Stores outside the covered source list have no manager-log coverage.'

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const PERIOD = /^\d{4}-\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const STOCK = /^[A-Z0-9._-]{1,80}$/
const CONFIDENCE = new Set(['high', 'medium-high', 'medium', 'low'])
const TOP_LEVEL_KEYS = new Set([
  'schema_version', 'classification', 'cloud_upload_allowed', 'source_store', 'source_period',
  'source_type', 'status_authority', 'status_independence', 'records', 'summary',
])
const INPUT_RECORD_KEYS = new Set([
  'stock_number', 'vin', 'vehicle', 'sold_manager_log', 'delivered_manager_log',
  'delivery_date', 'confidence', 'source_store_note',
])
const INPUT_SUMMARY_KEYS = new Set(['sold_records', 'delivered_records', 'sold_not_marked_delivered'])
const OVERLAY_KEYS = new Set([
  'schemaVersion', 'reportDate', 'classification', 'cloudUploadAllowed', 'coverageStatus',
  'statusAuthority', 'statusIndependence', 'sources', 'records', 'summary',
])
const SOURCE_KEYS = new Set(['sourceStore', 'sourcePeriod', 'recordCount', 'strippedFieldCount'])
const RECORD_KEYS = new Set([
  'stockNumber', 'vin', 'vehicleName', 'soldManagerLog', 'deliveredManagerLog',
  'deliveryDate', 'confidence', 'sourceStore', 'sourcePeriod', 'matchMethod',
  'matchStatus', 'physicalStore', 'reviewRequired', 'soldLabel', 'deliveryLabel',
])
const SUMMARY_KEYS = new Set([
  'recordCount', 'soldRecordCount', 'deliveredRecordCount', 'soldNotMarkedDeliveredCount',
  'matchedRecordCount', 'unmatchedRecordCount', 'conflictingRecordCount',
  'reviewRecordCount', 'bySourceStore',
])

function fail(message) {
  throw new Error(`Invalid manager disposition overlay: ${message}`)
}

function ensure(condition, message) {
  if (!condition) fail(message)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value, keys, label) {
  ensure(object(value), `${label} must be an object`)
  ensure(Object.keys(value).every((key) => keys.has(key)), `${label} contains unsupported fields`)
}

function strictInteger(value, label) {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`)
  return value
}

function validDate(value) {
  return typeof value === 'string' && DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function cleanText(value, label, maximum = 200) {
  ensure(typeof value === 'string', `${label} must be text`)
  const cleaned = value.trim()
  ensure(cleaned.length > 0 && cleaned.length <= maximum && !/[\u0000-\u001f\u007f]/.test(cleaned), `${label} is outside the safe text limit`)
  return cleaned
}

function normalizedVin(value) {
  if (value === null || value === undefined || value === '') return null
  ensure(typeof value === 'string', 'VIN must be text or null')
  const vin = value.trim().toUpperCase()
  ensure(VIN.test(vin), 'VIN is invalid')
  return vin
}

function normalizedStock(value) {
  ensure(typeof value === 'string', 'stock number must be text')
  const stock = value.trim().toUpperCase()
  ensure(STOCK.test(stock), 'stock number is invalid')
  return stock
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function canonicalManagerDispositionJson(value) {
  return canonicalJson(value)
}

export function managerDispositionSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function publicStore(vehicle) {
  return STORE_NAMES.includes(vehicle?.publicRecord?.store) ? vehicle.publicRecord.store : null
}

function publicVehicleName(vehicle) {
  const value = vehicle?.publicRecord?.vehicle_name
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}

function vehicleStocks(vehicle) {
  return [...new Set([
    vehicle?.publicRecord?.stock_number,
    vehicle?.crmRecord?.stockNumber,
  ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().toUpperCase()))]
}

function releaseIndexes(vehicles) {
  ensure(Array.isArray(vehicles), 'release vehicles must be an array')
  const byVin = new Map()
  const byStock = new Map()
  const seenVins = new Set()
  for (const vehicle of vehicles) {
    ensure(object(vehicle) && typeof vehicle.vin === 'string' && VIN.test(vehicle.vin), 'release vehicle identity is invalid')
    ensure(!seenVins.has(vehicle.vin), 'release vehicle identity is duplicated')
    seenVins.add(vehicle.vin)
    // Only the current public inventory can satisfy the manifest's
    // matched_current_public_vins contract. CRM-only evidence remains separate.
    if (!publicStore(vehicle)) continue
    byVin.set(vehicle.vin, vehicle)
    for (const stock of vehicleStocks(vehicle)) {
      const matches = byStock.get(stock) ?? []
      matches.push(vehicle)
      byStock.set(stock, matches)
    }
  }
  return { byVin, byStock }
}

function resolveMatch(stockNumber, sourceVin, indexes) {
  let matchMethod = 'not_matched'
  let matchStatus = sourceVin ? 'not_in_current_release' : 'stock_not_in_current_release'
  let matchedVehicle = null
  if (sourceVin) {
    matchMethod = 'vin'
    matchedVehicle = indexes.byVin.get(sourceVin) ?? null
    if (matchedVehicle) {
      matchStatus = vehicleStocks(matchedVehicle).includes(stockNumber) ? 'matched' : 'matched_vin_stock_review'
    }
  } else {
    const stockMatches = indexes.byStock.get(stockNumber) ?? []
    if (stockMatches.length === 1) {
      matchMethod = 'unique_stock'
      matchStatus = 'matched'
      matchedVehicle = stockMatches[0]
    } else if (stockMatches.length > 1) {
      matchStatus = 'stock_ambiguous'
    }
  }
  return {
    matchMethod,
    matchStatus,
    matchedVehicle,
    vin: sourceVin ?? matchedVehicle?.vin ?? null,
    physicalStore: matchedVehicle ? publicStore(matchedVehicle) : null,
    reviewRequired: matchStatus !== 'matched',
  }
}

function summarize(records) {
  const bySourceStore = Object.fromEntries(STORE_NAMES.map((store) => [store, records.filter((record) => record.sourceStore === store).length]))
  return {
    recordCount: records.length,
    soldRecordCount: records.filter((record) => record.soldManagerLog).length,
    deliveredRecordCount: records.filter((record) => record.deliveredManagerLog).length,
    soldNotMarkedDeliveredCount: records.filter((record) => record.soldManagerLog && !record.deliveredManagerLog).length,
    matchedRecordCount: records.filter((record) => record.matchStatus === 'matched').length,
    unmatchedRecordCount: records.filter((record) => ['not_in_current_release', 'stock_not_in_current_release'].includes(record.matchStatus)).length,
    conflictingRecordCount: records.filter((record) => ['matched_vin_stock_review', 'stock_ambiguous'].includes(record.matchStatus)).length,
    reviewRecordCount: records.filter((record) => record.reviewRequired).length,
    bySourceStore,
  }
}

function emptyOverlay(reportDate) {
  return {
    schemaVersion: MANAGER_DISPOSITION_SCHEMA,
    reportDate,
    classification: 'operational-redacted',
    cloudUploadAllowed: true,
    coverageStatus: 'not_provided',
    statusAuthority: MANAGER_DISPOSITION_AUTHORITY,
    statusIndependence: MANAGER_DISPOSITION_INDEPENDENCE,
    sources: [],
    records: [],
    summary: summarize([]),
  }
}

function sanitizeInputRecord(value, document, indexes) {
  onlyKeys(value, INPUT_RECORD_KEYS, 'manager disposition source record')
  const stockNumber = normalizedStock(value.stock_number)
  const sourceVin = normalizedVin(value.vin)
  // Validate the source field but do not publish it. For a matched record the
  // displayed generic vehicle name is re-derived from current public evidence;
  // unmatched free text cannot become a PII side channel.
  cleanText(value.vehicle, 'vehicle name')
  ensure(value.sold_manager_log === true, 'every included source record must be explicitly marked sold')
  ensure(typeof value.delivered_manager_log === 'boolean', 'delivered manager-log status must be Boolean')
  const deliveryDate = value.delivery_date === null || value.delivery_date === undefined ? null : value.delivery_date
  if (value.delivered_manager_log) ensure(validDate(deliveryDate), 'a delivered source record requires a valid delivery date')
  else ensure(deliveryDate === null, 'a record not marked delivered cannot carry a delivery date')
  ensure(typeof value.confidence === 'string' && CONFIDENCE.has(value.confidence), 'confidence is unsupported')

  const matched = resolveMatch(stockNumber, sourceVin, indexes)
  return {
    stockNumber,
    vin: matched.vin,
    vehicleName: matched.matchedVehicle ? publicVehicleName(matched.matchedVehicle) : null,
    soldManagerLog: true,
    deliveredManagerLog: value.delivered_manager_log,
    deliveryDate,
    confidence: value.confidence,
    sourceStore: document.source_store,
    sourcePeriod: document.source_period,
    matchMethod: matched.matchMethod,
    matchStatus: matched.matchStatus,
    physicalStore: matched.physicalStore,
    reviewRequired: matched.reviewRequired,
    soldLabel: 'Sold — manager log',
    deliveryLabel: value.delivered_manager_log ? 'Delivered — manager log' : 'Not marked delivered — manager log',
  }
}

/**
 * Convert explicitly selected operational-redacted source documents to the only
 * manager disposition shape permitted in an encrypted release. Unknown fields
 * fail closed; the one legacy source_store_note field is counted and discarded.
 */
export function sanitizeManagerDispositionDocuments({ documents = [], reportDate, vehicles = [] }) {
  ensure(validDate(reportDate), 'report date is invalid')
  ensure(Array.isArray(documents) && documents.length <= STORE_NAMES.length, 'source document list is invalid')
  if (documents.length === 0) return emptyOverlay(reportDate)
  const indexes = releaseIndexes(vehicles)
  const period = reportDate.slice(0, 7)
  const seenStores = new Set()
  const sources = []
  const records = []

  for (const item of documents) {
    const document = item?.data ?? item
    onlyKeys(document, TOP_LEVEL_KEYS, 'manager disposition source')
    ensure(document.schema_version === '1.0', 'source schema version is unsupported')
    ensure(document.classification === 'operational-redacted' && document.cloud_upload_allowed === true, 'source is not approved for cloud upload')
    ensure(document.source_type === 'manager-log', 'source type is unsupported')
    ensure(document.status_authority === MANAGER_DISPOSITION_AUTHORITY, 'status authority is unsupported')
    ensure(document.status_independence === MANAGER_DISPOSITION_INDEPENDENCE, 'status independence statement is unsupported')
    ensure(STORE_NAMES.includes(document.source_store), 'source store is unsupported')
    ensure(document.source_period === period && PERIOD.test(document.source_period), 'source period does not match the release')
    ensure(item?.expectedStore === undefined || item.expectedStore === document.source_store, 'source filename/store binding does not match')
    ensure(!seenStores.has(document.source_store), 'source store is duplicated')
    seenStores.add(document.source_store)
    ensure(Array.isArray(document.records) && document.records.length > 0 && document.records.length <= 20_000, 'source records are missing or out of bounds')

    const sourceRecords = document.records.map((record) => {
      const sanitized = sanitizeInputRecord(record, document, indexes)
      ensure(!sanitized.deliveryDate || sanitized.deliveryDate <= reportDate, 'delivered date cannot be after the release report date')
      return sanitized
    })
    const sourceSummary = summarize(sourceRecords)
    onlyKeys(document.summary, INPUT_SUMMARY_KEYS, 'manager disposition source summary')
    ensure(strictInteger(document.summary.sold_records, 'source sold count') === sourceSummary.soldRecordCount, 'source sold count does not reconcile')
    ensure(strictInteger(document.summary.delivered_records, 'source delivered count') === sourceSummary.deliveredRecordCount, 'source delivered count does not reconcile')
    ensure(strictInteger(document.summary.sold_not_marked_delivered, 'source undelivered count') === sourceSummary.soldNotMarkedDeliveredCount, 'source undelivered count does not reconcile')
    const strippedFieldCount = document.records.reduce((count, record) => count + (Object.hasOwn(record, 'source_store_note') ? 1 : 0), 0)
    sources.push({ sourceStore: document.source_store, sourcePeriod: document.source_period, recordCount: sourceRecords.length, strippedFieldCount })
    records.push(...sourceRecords)
  }

  const identities = new Set()
  const matchedVins = new Set()
  for (const record of records) {
    const identity = record.vin ? `VIN:${record.vin}` : `STOCK:${record.sourceStore}:${record.stockNumber}`
    ensure(!identities.has(identity), 'source records contain a duplicate identity')
    identities.add(identity)
    if (record.matchStatus === 'matched' || record.matchStatus === 'matched_vin_stock_review') {
      ensure(record.vin && !matchedVins.has(record.vin), 'more than one source record matches the same current VIN')
      matchedVins.add(record.vin)
    }
  }

  records.sort((left, right) => left.sourceStore.localeCompare(right.sourceStore) || left.stockNumber.localeCompare(right.stockNumber))
  sources.sort((left, right) => left.sourceStore.localeCompare(right.sourceStore))
  return {
    schemaVersion: MANAGER_DISPOSITION_SCHEMA,
    reportDate,
    classification: 'operational-redacted',
    cloudUploadAllowed: true,
    coverageStatus: 'provided',
    statusAuthority: MANAGER_DISPOSITION_AUTHORITY,
    statusIndependence: MANAGER_DISPOSITION_INDEPENDENCE,
    sources,
    records,
    summary: summarize(records),
  }
}

export function validateSanitizedManagerDispositionOverlay(overlay, { reportDate, vehicles = [] } = {}) {
  onlyKeys(overlay, OVERLAY_KEYS, 'sanitized manager disposition overlay')
  ensure(overlay.schemaVersion === MANAGER_DISPOSITION_SCHEMA && overlay.reportDate === reportDate, 'sanitized overlay schema/date is invalid')
  ensure(overlay.classification === 'operational-redacted' && overlay.cloudUploadAllowed === true, 'sanitized overlay classification is invalid')
  ensure(['provided', 'not_provided'].includes(overlay.coverageStatus), 'sanitized overlay coverage status is invalid')
  ensure(overlay.statusAuthority === MANAGER_DISPOSITION_AUTHORITY && overlay.statusIndependence === MANAGER_DISPOSITION_INDEPENDENCE, 'sanitized overlay authority statement is invalid')
  ensure(Array.isArray(overlay.sources) && overlay.sources.length <= STORE_NAMES.length, 'sanitized source list is invalid')
  ensure(Array.isArray(overlay.records) && overlay.records.length <= 20_000, 'sanitized record list is invalid')
  ensure((overlay.coverageStatus === 'provided') === (overlay.sources.length > 0 && overlay.records.length > 0), 'sanitized coverage status does not match its data')
  const indexes = releaseIndexes(vehicles)
  const seenSources = new Set()
  for (const source of overlay.sources) {
    onlyKeys(source, SOURCE_KEYS, 'sanitized source summary')
    ensure(STORE_NAMES.includes(source.sourceStore) && source.sourcePeriod === reportDate.slice(0, 7), 'sanitized source identity is invalid')
    ensure(!seenSources.has(source.sourceStore), 'sanitized source is duplicated')
    seenSources.add(source.sourceStore)
    strictInteger(source.recordCount, 'sanitized source record count')
    strictInteger(source.strippedFieldCount, 'sanitized stripped-field count')
  }
  const seenIdentity = new Set()
  const seenMatchedVin = new Set()
  for (const record of overlay.records) {
    onlyKeys(record, RECORD_KEYS, 'sanitized manager disposition record')
    const stockNumber = normalizedStock(record.stockNumber)
    const vin = normalizedVin(record.vin)
    ensure(record.vehicleName === null || typeof record.vehicleName === 'string', 'sanitized vehicle name must be text or null')
    if (record.vehicleName !== null) cleanText(record.vehicleName, 'sanitized vehicle name')
    ensure(record.soldManagerLog === true && typeof record.deliveredManagerLog === 'boolean', 'sanitized sold/delivered status is invalid')
    if (record.deliveredManagerLog) ensure(validDate(record.deliveryDate), 'sanitized delivered record requires a delivery date')
    else ensure(record.deliveryDate === null, 'sanitized record not marked delivered cannot carry a delivery date')
    ensure(!record.deliveryDate || record.deliveryDate <= reportDate, 'sanitized delivered date cannot be after the release report date')
    ensure(CONFIDENCE.has(record.confidence), 'sanitized confidence is unsupported')
    ensure(STORE_NAMES.includes(record.sourceStore) && record.sourcePeriod === reportDate.slice(0, 7), 'sanitized source store/period is invalid')
    ensure(['vin', 'unique_stock', 'not_matched'].includes(record.matchMethod), 'sanitized match method is invalid')
    ensure(['matched', 'matched_vin_stock_review', 'not_in_current_release', 'stock_not_in_current_release', 'stock_ambiguous'].includes(record.matchStatus), 'sanitized match status is invalid')
    ensure(record.physicalStore === null || STORE_NAMES.includes(record.physicalStore), 'sanitized physical store is invalid')
    ensure(typeof record.reviewRequired === 'boolean' && record.reviewRequired === (record.matchStatus !== 'matched'), 'sanitized review status is invalid')
    ensure(record.soldLabel === 'Sold — manager log' && record.deliveryLabel === (record.deliveredManagerLog ? 'Delivered — manager log' : 'Not marked delivered — manager log'), 'sanitized labels are invalid')
    const identity = vin ? `VIN:${vin}` : `STOCK:${record.sourceStore}:${stockNumber}`
    ensure(!seenIdentity.has(identity), 'sanitized record identity is duplicated')
    seenIdentity.add(identity)
    if (record.matchStatus === 'matched' || record.matchStatus === 'matched_vin_stock_review') {
      ensure(vin && indexes.byVin.has(vin) && !seenMatchedVin.has(vin), 'sanitized matched VIN is unrelated or duplicated')
      seenMatchedVin.add(vin)
      const matched = indexes.byVin.get(vin)
      ensure(record.physicalStore === publicStore(matched), 'sanitized physical store differs from current public evidence')
      if (record.matchMethod === 'unique_stock') ensure((indexes.byStock.get(stockNumber) ?? []).length === 1, 'sanitized stock fallback is not unique')
    }
    const sourceVin = record.matchMethod === 'vin' ? vin : null
    const expectedMatch = resolveMatch(stockNumber, sourceVin, indexes)
    ensure(record.vin === expectedMatch.vin, 'sanitized VIN does not match current public evidence')
    ensure(record.matchMethod === expectedMatch.matchMethod && record.matchStatus === expectedMatch.matchStatus, 'sanitized match result differs from current public evidence')
    ensure(record.physicalStore === expectedMatch.physicalStore && record.reviewRequired === expectedMatch.reviewRequired, 'sanitized store/review result differs from current public evidence')
    ensure(record.vehicleName === (expectedMatch.matchedVehicle ? publicVehicleName(expectedMatch.matchedVehicle) : null), 'sanitized vehicle name differs from current public evidence')
  }
  for (const source of overlay.sources) {
    ensure(source.recordCount === overlay.records.filter((record) => record.sourceStore === source.sourceStore).length, 'sanitized source count does not reconcile')
    ensure(source.strippedFieldCount <= source.recordCount, 'sanitized stripped-field count exceeds its source records')
  }
  onlyKeys(overlay.summary, SUMMARY_KEYS, 'sanitized manager disposition summary')
  const expected = summarize(overlay.records)
  ensure(canonicalJson(overlay.summary) === canonicalJson(expected), 'sanitized summary does not reconcile')
  return expected
}
