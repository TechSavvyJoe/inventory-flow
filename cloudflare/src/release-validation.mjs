import { canonicalExternalAutoCheckUrl, resourceProvenanceSha256 } from '../../server/resource-validation.mjs'
import {
  containsForeignOasisText,
  factoryCoverageType,
  factoryTermText,
  isFactoryCoverageRow,
  isOasisDate,
} from '../../server/oasis-coverage-grammar.mjs'

// Portable validation for the encrypted daily evidence import. This module has
// no filesystem, credentials, or source-fetching dependencies.
import {
  MANAGER_DISPOSITION_SCHEMA,
  canonicalManagerDispositionJson,
  managerDispositionSha256,
  sanitizeManagerDispositionDocuments,
  validateSanitizedManagerDispositionOverlay,
} from '../../server/manager-disposition-schema.mjs'

export const RELEASE_FORMAT = 'inventory-flow-private-release-v1'
const STORES = Object.freeze({
  Howell: { code: 'H', host: 'www.bobmaxeyfordhowell.com' },
  Fowlerville: { code: 'F', host: 'www.bobmaxeyfordinfowlerville.com' },
  'Ford Detroit': { code: 'D', host: 'www.bobmaxeyford.com' },
  Lincoln: { code: 'L', host: 'www.bobmaxeylincoln.com' },
})
const STORE_NAMES = Object.keys(STORES)
const MANAGER_STORE_SLUGS = Object.freeze({ Howell: 'howell', Fowlerville: 'fowlerville', 'Ford Detroit': 'ford-detroit', Lincoln: 'lincoln' })
const MANAGER_BINDING_KEYS = new Set([
  'status', 'classification', 'source_type', 'path', 'sha256', 'source_store',
  'source_period', 'sold_records', 'delivered_records',
  'sold_not_marked_delivered', 'matched_current_public_vins',
  'unmatched_records', 'conflicting_records', 'review_records',
  'cloud_upload_allowed',
])
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const SOURCE_VIN_TOKEN = /^[A-Z0-9]{17}$/
const HASH = /^[a-f0-9]{64}$/i
const MAX_ROWS = 20000
const CHECKS = ['differenceVinEqualsFlaggedHolds', 'differenceStockEqualsFlaggedHolds', 'allSourceCellCounts22', 'allStockNonblank', 'allStoreCodesExpected', 'setEquationValid']
const RESOURCE_SCHEMA = 'inventory-flow-vin-document-enrichment-v1'
const RESOURCE_DATA_STATES = new Set(['current', 'stale_unverified', 'incomplete'])
const FORD_OASIS_FIELD_SERVICE_ACTION_CODE = /^[0-9]{2}[A-Z][0-9]{2,3}$/
const WARRANTY_CHECK_COVERAGE_STATUSES = new Set(['ACTIVE', 'EXPIRED', 'N/A'])
const CAI_FACTORY_EQUIPMENT_PATH = /^\/window-stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i
const PUBLIC_RESOURCE_ARCHIVE_ONLY_FIELDS = new Set([
  'validated_vin',
  'observedAt',
  'extractionMethod',
  'originalSourceText',
])

function ensure(condition, message) {
  if (!condition) throw new Error(`Invalid cloud release: ${message}`)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function integer(value, label, minimum = 0) {
  ensure((typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum, `${label} must be an integer`)
  return Number(value)
}

function strictInteger(value, label, minimum = 0) {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum, `${label} must be a numeric integer`)
  return value
}

function rows(value, label, minimum = 0) {
  ensure(Array.isArray(value) && value.length >= minimum && value.length <= MAX_ROWS, `${label} rows are missing or out of bounds`)
  return value
}

function normalizedVin(value) {
  const vin = String(value ?? '').trim().toUpperCase()
  ensure(VIN.test(vin), 'invalid VIN')
  return vin
}

function sourceVinToken(value) {
  ensure(typeof value === 'string' && SOURCE_VIN_TOKEN.test(value), 'invalid source VIN token')
  return value
}

function stock(value) {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= 128, 'invalid stock number')
  return value.trim().toUpperCase()
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function onlyKeys(value, allowed, label) {
  ensure(object(value), `${label} must be an object`)
  ensure(Object.keys(value).every((key) => allowed.has(key)), `${label} contains unsupported fields`)
}

function optionalText(value, label, max = 500) {
  if (value === undefined || value === null || value === '') return undefined
  ensure(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label} is outside the safe text limit`)
  return value.trim()
}

function optionalNumber(value, label, minimum = 0, maximum = 1_000_000) {
  if (value === undefined || value === null || value === '') return undefined
  ensure(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum, `${label} is outside the safe numeric range`)
  return value
}

function optionalInteger(value, label, minimum = 0, maximum = 1_000_000) {
  if (value === undefined || value === null || value === '') return undefined
  ensure(Number.isInteger(value) && value >= minimum && value <= maximum, `${label} must be an integer within the safe range`)
  return value
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return undefined
  ensure(typeof value === 'boolean', `${label} must be a boolean`)
  return value
}

function validTimestamp(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
}

function optionalTimestamp(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  ensure(validTimestamp(value), `${label} must be an ISO timestamp with an explicit timezone`)
  return value
}

function boundedStrings(value, label, limit = 120, itemMax = 500) {
  if (value === undefined || value === null) return []
  ensure(Array.isArray(value) && value.length <= limit, `${label} must be a bounded array`)
  const seen = new Set()
  return value.map((item) => {
    const text = optionalText(item, `${label} item`, itemMax)
    ensure(text, `${label} item is required`)
    const identity = text.toLowerCase()
    ensure(!seen.has(identity), `${label} contains a duplicate item`)
    seen.add(identity)
    return text
  })
}

function approvedFactoryEquipmentUrl(value) {
  if (value === undefined || value === null || value === '') return true
  if (typeof value !== 'string') return false
  let url
  try { url = new URL(value) } catch { return false }
  let decodedPath
  try { decodedPath = decodeURIComponent(url.pathname) } catch { return false }
  return url.protocol === 'https:' &&
    url.hostname.toLowerCase() === 'assets.cai-media-management.com' &&
    !url.username && !url.password && !url.port && !url.search && !url.hash &&
    CAI_FACTORY_EQUIPMENT_PATH.test(url.pathname) &&
    !decodedPath.split('/').includes('..')
}

function validateFactoryEquipment(value, vin) {
  onlyKeys(value, new Set([
    'dataState', 'url', 'sourceLabel', 'capturedAt', 'vehicleDescription', 'basePrice', 'totalOptions',
    'destinationCharge', 'totalMsrp', 'exteriorColor', 'interiorColor', 'engine', 'transmission',
    'drivetrain', 'packages', 'sections', 'disclaimer', 'isOriginalWindowSticker',
  ]), 'factory-equipment record')
  ensure(RESOURCE_DATA_STATES.has(value.dataState), 'factory-equipment data state is invalid')
  ensure(value.isOriginalWindowSticker === false, 'factory-equipment record must be labeled as informational, not an original sticker')
  ensure(approvedFactoryEquipmentUrl(value.url), 'factory-equipment URL is not an approved HTTPS vAuto/CAI resource')
  for (const [field, max] of [
    ['sourceLabel', 160], ['vehicleDescription', 320], ['exteriorColor', 200], ['interiorColor', 200],
    ['engine', 240], ['transmission', 240], ['drivetrain', 160],
  ]) optionalText(value[field], `factory-equipment ${field}`, max)
  optionalTimestamp(value.capturedAt, 'factory-equipment capturedAt')
  for (const field of ['basePrice', 'totalOptions', 'destinationCharge', 'totalMsrp']) optionalNumber(value[field], `factory-equipment ${field}`, 0, 2_000_000)

  ensure(Array.isArray(value.packages) && value.packages.length <= 80, 'factory-equipment packages must be a bounded array')
  const packageNames = new Set()
  for (const entry of value.packages) {
    onlyKeys(entry, new Set(['name', 'code', 'price', 'features']), 'factory-equipment package')
    const name = optionalText(entry.name, 'factory-equipment package name', 240)
    ensure(name, 'factory-equipment package name is required')
    ensure(!packageNames.has(name.toLowerCase()), 'factory-equipment packages contain a duplicate name')
    packageNames.add(name.toLowerCase())
    optionalText(entry.code, 'factory-equipment package code', 80)
    optionalNumber(entry.price, 'factory-equipment package price', 0, 2_000_000)
    boundedStrings(entry.features, 'factory-equipment package features', 120, 300)
  }

  ensure(Array.isArray(value.sections) && value.sections.length <= 40, 'factory-equipment sections must be a bounded array')
  const sectionNames = new Set()
  let itemCount = 0
  for (const section of value.sections) {
    onlyKeys(section, new Set(['name', 'items']), 'factory-equipment section')
    const name = optionalText(section.name, 'factory-equipment section name', 200)
    ensure(name, 'factory-equipment section name is required')
    ensure(!sectionNames.has(name.toLowerCase()), 'factory-equipment sections contain a duplicate name')
    sectionNames.add(name.toLowerCase())
    ensure(Array.isArray(section.items) && section.items.length > 0 && section.items.length <= 150, 'factory-equipment section items must be a non-empty bounded array')
    itemCount += section.items.length
    ensure(itemCount <= 800, 'factory-equipment record contains too many section items')
    for (const item of section.items) {
      onlyKeys(item, new Set(['label', 'price']), 'factory-equipment section item')
      ensure(optionalText(item.label, 'factory-equipment section item label', 700), 'factory-equipment section item label is required')
      optionalNumber(item.price, 'factory-equipment section item price', 0, 2_000_000)
    }
  }
  ensure(optionalText(value.disclaimer, 'factory-equipment disclaimer', 5_000), 'factory-equipment disclaimer is required')
  return { factoryEquipment: 1, externalAutoCheck: 0 }
}

function validateExternalAutoCheck(value, vin) {
  onlyKeys(value, new Set([
    'dataState', 'accessMethod', 'url', 'sourceLabel', 'capturedAt', 'reportRunAt', 'score', 'scoreRangeLow',
    'scoreRangeHigh', 'usage', 'ownerCount', 'lastReportedOdometer', 'lastReportedOdometerDate',
    'vehicleClass', 'assemblyCountry', 'estimatedInServiceDate', 'checks', 'recentInspection',
  ]), 'external AutoCheck record')
  ensure(RESOURCE_DATA_STATES.has(value.dataState), 'external AutoCheck data state is invalid')
  const accessMethod = optionalText(value.accessMethod, 'external AutoCheck accessMethod', 24) ?? 'official_url'
  ensure(['official_url', 'vauto'].includes(accessMethod), 'external AutoCheck access method is invalid')
  if (accessMethod === 'vauto') ensure(value.url === undefined || value.url === null, 'vAuto AutoCheck fallback must not carry a document URL')
  else ensure(canonicalExternalAutoCheckUrl(value.url, vin), 'external AutoCheck URL is not an approved exact-VIN HTTPS resource')
  const sourceLabel = optionalText(value.sourceLabel, 'external AutoCheck sourceLabel', 160)
  const capturedAt = optionalTimestamp(value.capturedAt, 'external AutoCheck capturedAt')
  ensure(accessMethod !== 'vauto' || (sourceLabel && capturedAt), 'vAuto AutoCheck fallback requires its source label and capture time')
  for (const [field, max] of [
    ['reportRunAt', 80], ['usage', 80], ['lastReportedOdometerDate', 20], ['vehicleClass', 160],
    ['assemblyCountry', 120], ['estimatedInServiceDate', 20],
  ]) optionalText(value[field], `external AutoCheck ${field}`, max)
  for (const [field, minimum, maximum] of [
    ['score', 0, 100], ['scoreRangeLow', 0, 100], ['scoreRangeHigh', 0, 100], ['ownerCount', 0, 99],
    ['lastReportedOdometer', 0, 20_000_000],
  ]) optionalNumber(value[field], `external AutoCheck ${field}`, minimum, maximum)
  const checks = value.checks ?? []
  ensure(Array.isArray(checks) && checks.length <= 40, 'external AutoCheck checks must be a bounded array')
  for (const check of checks) {
    onlyKeys(check, new Set(['label', 'status', 'detail']), 'external AutoCheck check')
    ensure(optionalText(check.label, 'external AutoCheck check label', 160), 'external AutoCheck check label is required')
    optionalText(check.status, 'external AutoCheck check status', 200)
    optionalText(check.detail, 'external AutoCheck check detail', 500)
  }
  if (value.recentInspection !== undefined && value.recentInspection !== null) validateAutoCheckRecentInspection(value.recentInspection)
  return { factoryEquipment: 0, externalAutoCheck: 1 }
}

const AUTOCHECK_INSPECTION_TYPES = new Set([
  'Vehicle Serviced or Inspected',
  'Multiple Point Vehicle Inspection',
  'Multi-Point Vehicle Inspection',
  'Certified Pre-Owned Inspection',
  'Pre-Purchase Inspection',
  'Safety Inspection',
  'Vehicle Inspected',
])

function validateAutoCheckRecentInspection(value) {
  ensure(object(value), 'external AutoCheck recent inspection must be an object')
  onlyKeys(value, new Set(['date', 'types']), 'external AutoCheck recent inspection')
  const date = optionalText(value.date, 'external AutoCheck recent inspection date', 10)
  ensure(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date, 'external AutoCheck recent inspection date must be an ISO day')
  ensure(Array.isArray(value.types) && value.types.length > 0 && value.types.length <= 8, 'external AutoCheck recent inspection types must be a bounded array')
  const seen = new Set()
  for (const item of value.types) {
    const type = optionalText(item, 'external AutoCheck recent inspection type', 80)
    ensure(type && AUTOCHECK_INSPECTION_TYPES.has(type), 'external AutoCheck recent inspection type is not an approved generic inspection label')
    ensure(!seen.has(type), 'external AutoCheck recent inspection types contain a duplicate item')
    seen.add(type)
  }
}

const SERVICE_HISTORY_DATE_PATTERN = /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4}$/
const SERVICE_HISTORY_SEARCH_STATES = new Set(['confirmed', 'not_identified', 'incomplete'])
const SERVICE_HISTORY_INSPECTION_STATES = new Set(['confirmed', 'not_identified'])

function validateServiceHistoryInspection(value, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} inspection is required`)
  onlyKeys(value, new Set(['status', 'type']), `${label} inspection`)
  const status = optionalText(value.status, `${label} inspection status`, 40)
  ensure(SERVICE_HISTORY_INSPECTION_STATES.has(status), `${label} inspection status is invalid`)
  const type = optionalText(value.type, `${label} inspection type`, 160)
  ensure(status !== 'confirmed' || type, `${label} confirmed inspection requires a type`)
  ensure(!type || !containsForeignOasisText(type), `${label} inspection type contains identity material`)
}

function validateServiceRepairOrder(value, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  onlyKeys(value, new Set([
    'repairOrderNumber', 'dealerCode', 'openDate', 'closeDate', 'odometer', 'detailComplete',
    'inspection', 'parts', 'laborOperations', 'services', 'summary',
  ]), label)
  const number = optionalText(value.repairOrderNumber, `${label} number`, 24)
  const dealerCode = optionalText(value.dealerCode, `${label} dealer code`, 12)
  const openDate = optionalText(value.openDate, `${label} open date`, 20)
  const closeDate = optionalText(value.closeDate, `${label} close date`, 20)
  ensure(/^\d{1,24}$/.test(number || ''), `${label} number is invalid`)
  ensure(/^[A-Z0-9]{1,12}$/.test(dealerCode || ''), `${label} dealer code is invalid`)
  ensure(SERVICE_HISTORY_DATE_PATTERN.test(openDate || ''), `${label} open date is invalid`)
  ensure(SERVICE_HISTORY_DATE_PATTERN.test(closeDate || ''), `${label} close date is invalid`)
  ensure(typeof value.detailComplete === 'boolean', `${label} detailComplete must be a boolean`)
  optionalInteger(value.odometer, `${label} odometer`, 0, 20_000_000)
  validateServiceHistoryInspection(value.inspection, label)
  const parts = value.parts ?? []
  ensure(Array.isArray(parts) && parts.length <= 80, `${label} parts must be a bounded array`)
  for (const part of parts) {
    onlyKeys(part, new Set(['description', 'quantity', 'partNumber']), `${label} part`)
    const description = optionalText(part.description, `${label} part description`, 300)
    ensure(description && !containsForeignOasisText(description), `${label} part description is invalid`)
    optionalInteger(part.quantity, `${label} part quantity`, 0, 999)
    optionalText(part.partNumber, `${label} part number`, 120)
  }
  const labor = value.laborOperations ?? []
  ensure(Array.isArray(labor) && labor.length <= 80, `${label} labor operations must be a bounded array`)
  for (const operation of labor) {
    onlyKeys(operation, new Set(['code', 'description']), `${label} labor operation`)
    const code = optionalText(operation.code, `${label} labor code`, 40)
    const description = optionalText(operation.description, `${label} labor description`, 500)
    ensure(code && /^[A-Z0-9./-]{1,40}$/i.test(code), `${label} labor code is invalid`)
    ensure(description && !containsForeignOasisText(description), `${label} labor description is invalid`)
  }
  const services = value.services ?? []
  ensure(Array.isArray(services) && services.length <= 20, `${label} services must be a bounded array`)
  for (const service of services) {
    const text = optionalText(service, `${label} service`, 160)
    ensure(text && !containsForeignOasisText(text), `${label} service is invalid`)
  }
  const summary = optionalText(value.summary, `${label} summary`, 1000)
  ensure(!summary || !containsForeignOasisText(summary), `${label} summary contains identity material`)
}

function validateServiceHistoryVisit(value, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  onlyKeys(value, new Set(['openDate', 'closeDate', 'odometer', 'services']), label)
  const openDate = optionalText(value.openDate, `${label} open date`, 20)
  const closeDate = optionalText(value.closeDate, `${label} close date`, 20)
  ensure(SERVICE_HISTORY_DATE_PATTERN.test(openDate || ''), `${label} open date is invalid`)
  ensure(SERVICE_HISTORY_DATE_PATTERN.test(closeDate || ''), `${label} close date is invalid`)
  if (value.odometer != null) ensure(optionalInteger(value.odometer, `${label} odometer`, 0, 20_000_000) !== undefined, `${label} odometer is invalid`)
  const services = value.services ?? []
  ensure(Array.isArray(services) && services.length <= 20, `${label} services must be a bounded array`)
  for (const service of services) {
    const text = optionalText(service, `${label} service`, 160)
    ensure(text && !containsForeignOasisText(text), `${label} service is invalid`)
  }
}

function validateServiceHistory(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'Ford service history must be an object')
  onlyKeys(value, new Set([
    'dataState', 'checkedAt', 'sourceLabel', 'historyCaptured', 'repairOrderCount', 'detailScanCount',
    'inspectionSearchStatus', 'latestRepairOrder', 'recentInspection', 'recentRepairOrders', 'repairOrderTimeline',
  ]), 'Ford service history')
  ensure(RESOURCE_DATA_STATES.has(value.dataState), 'Ford service history data state is invalid')
  ensure(optionalTimestamp(value.checkedAt, 'Ford service history checkedAt'), 'Ford service history checkedAt is required')
  ensure(typeof value.historyCaptured === 'boolean', 'Ford service history historyCaptured must be a boolean')
  const count = optionalInteger(value.repairOrderCount, 'Ford service history repairOrderCount', 0, 20_000)
  ensure(count !== undefined, 'Ford service history repairOrderCount is required')
  const detailScanCount = optionalInteger(value.detailScanCount, 'Ford service history detailScanCount', 0, 20_000)
  ensure(detailScanCount !== undefined, 'Ford service history detailScanCount is required')
  ensure(detailScanCount <= count, 'Ford service history detailed scan count exceeds the reported repair-order count')
  const searchStatus = optionalText(value.inspectionSearchStatus, 'Ford service history inspectionSearchStatus', 40)
  ensure(SERVICE_HISTORY_SEARCH_STATES.has(searchStatus), 'Ford service history inspection search status is invalid')
  optionalText(value.sourceLabel, 'Ford service history sourceLabel', 160)
  if (value.latestRepairOrder != null) validateServiceRepairOrder(value.latestRepairOrder, 'Latest Ford repair order')
  ensure(count === 0 || value.latestRepairOrder, 'Ford service history with repair orders requires the latest repair order')
  if (value.recentInspection != null) {
    validateServiceRepairOrder(value.recentInspection, 'Recent Ford inspection repair order')
    ensure(value.recentInspection.inspection?.status === 'confirmed', 'Recent Ford inspection repair order must contain confirmed inspection evidence')
  }
  const recentRepairOrders = value.recentRepairOrders ?? []
  ensure(Array.isArray(recentRepairOrders) && recentRepairOrders.length <= 5, 'Recent Ford repair orders must be a bounded array')
  recentRepairOrders.forEach((order, index) => validateServiceRepairOrder(order, `Recent Ford repair order ${index + 1}`))
  ensure(recentRepairOrders.length <= value.detailScanCount, 'Recent Ford repair orders exceed the detailed scan count')
  ensure(new Set(recentRepairOrders.map(order => order.repairOrderNumber)).size === recentRepairOrders.length, 'Recent Ford repair orders must be unique')
  const timeline = value.repairOrderTimeline ?? []
  ensure(Array.isArray(timeline) && timeline.length <= count, 'Ford service-history timeline exceeds the reported repair-order count')
  timeline.forEach((visit, index) => validateServiceHistoryVisit(visit, `Ford service-history visit ${index + 1}`))
}

// Ford OASIS vehicle report facts captured read-only from FMCDealer for an
// exact VIN. Dates are validated as bounded printed text, never re-parsed. The
// allow-list mirrors validatedFordOasis() in server/importer.mjs; prior-owner
// names are never part of the capture and no such field is accepted here.
function validateFordOasis(value, vin) {
  onlyKeys(value, new Set([
    'dataState', 'capturedAt', 'sourceLabel', 'vehicleDescription', 'versionSeries', 'buildDate',
    'warrantyStartDate', 'releaseDate', 'monthsInService', 'saleMileage', 'openFieldServiceActions',
    'warrantyCoverages', 'extendedCoverageExpirations', 'openActionsCaptured', 'serviceHistory',
  ]), 'Ford OASIS record')
  ensure(RESOURCE_DATA_STATES.has(value.dataState), 'Ford OASIS data state is invalid')
  ensure(optionalTimestamp(value.capturedAt, 'Ford OASIS capturedAt'), 'Ford OASIS capturedAt is required')
  for (const [field, max] of [
    ['sourceLabel', 160], ['vehicleDescription', 160], ['versionSeries', 120], ['buildDate', 40],
    ['warrantyStartDate', 40], ['releaseDate', 40],
  ]) {
    const text = optionalText(value[field], `Ford OASIS ${field}`, max)
    if (text && ['buildDate', 'warrantyStartDate', 'releaseDate'].includes(field)) ensure(isOasisDate(text), `Ford OASIS ${field} is not a recognized OASIS date`)
    if (text && field === 'vehicleDescription') ensure(!containsForeignOasisText(text), 'Ford OASIS vehicleDescription contains non-vehicle material')
  }
  optionalInteger(value.monthsInService, 'Ford OASIS monthsInService', 0, 600)
  optionalInteger(value.saleMileage, 'Ford OASIS saleMileage', 0, 999_999)

  const actions = value.openFieldServiceActions ?? []
  ensure(value.openActionsCaptured === undefined || typeof value.openActionsCaptured === 'boolean', 'Ford OASIS action capture flag must be a boolean')
  ensure(value.openActionsCaptured !== true || Array.isArray(value.openFieldServiceActions), 'Ford OASIS captured action result requires an explicit array')
  ensure(Array.isArray(actions) && actions.length <= 60, 'Ford OASIS open field service actions must be a bounded array')
  const actionCodes = new Set()
  for (const action of actions) {
    onlyKeys(action, new Set(['code', 'description']), 'Ford OASIS field service action')
    const code = optionalText(action.code, 'Ford OASIS field service action code', 20)
    ensure(code && FORD_OASIS_FIELD_SERVICE_ACTION_CODE.test(code), 'Ford OASIS field service action code is not a valid FSA code')
    ensure(!actionCodes.has(code), 'Ford OASIS field service actions contain a duplicate code')
    actionCodes.add(code)
    const description = optionalText(action.description, 'Ford OASIS field service action description', 300)
    ensure(!description || !containsForeignOasisText(description), 'Ford OASIS field service action description contains non-FSA material')
  }

  const coverages = value.warrantyCoverages ?? []
  ensure(Array.isArray(coverages) && coverages.length <= 20, 'Ford OASIS warranty coverages must be a bounded array')
  for (const coverage of coverages) {
    onlyKeys(coverage, new Set(['type', 'description']), 'Ford OASIS warranty coverage')
    const type = optionalText(coverage.type, 'Ford OASIS warranty coverage type', 120)
    ensure(type && factoryCoverageType(type), 'Ford OASIS warranty coverage type is not a recognized factory coverage')
    const description = optionalText(coverage.description, 'Ford OASIS warranty coverage description', 300)
    ensure(!description || factoryTermText(description) === description, 'Ford OASIS warranty coverage description is not a factory term')
  }

  const expirations = value.extendedCoverageExpirations ?? []
  ensure(Array.isArray(expirations) && expirations.length <= 10, 'Ford OASIS extended coverage expirations must be a bounded array')
  for (const item of expirations) {
    const date = optionalText(item, 'Ford OASIS extended coverage expiration', 40)
    ensure(date && isOasisDate(date), 'Ford OASIS extended coverage expiration is not a recognized OASIS date')
  }
  if (value.serviceHistory != null) validateServiceHistory(value.serviceHistory)
  return { factoryEquipment: 0, externalAutoCheck: 0, fordOasis: 1, warrantyCheck: 0 }
}

function validateWarrantyCheckCoverages(value, label, termTextMax, allowUnlimitedMonths, requireFactoryGrammar = false) {
  const coverages = value ?? []
  ensure(Array.isArray(coverages) && coverages.length > 0 && coverages.length <= 12, `${label} coverages must be a non-empty bounded array`)
  const allowed = new Set([
    'type', 'termText', 'termMonths', 'termMiles', 'unlimitedMiles', 'remainingMiles', 'remainingMonths',
    'remainingMilesText', 'remainingTimeText', 'status', 'note',
  ])
  if (allowUnlimitedMonths) allowed.add('unlimitedMonths')
  const types = new Set()
  for (const coverage of coverages) {
    onlyKeys(coverage, allowed, `${label} coverage`)
    const type = optionalText(coverage.type, `${label} coverage type`, 60)
    ensure(type, `${label} coverage type is required`)
    ensure(!types.has(type.toLowerCase()), `${label} coverages contain a duplicate type`)
    types.add(type.toLowerCase())
    const termText = optionalText(coverage.termText, `${label} coverage termText`, termTextMax)
    ensure(termText, `${label} coverage termText is required`)
    if (requireFactoryGrammar) {
      ensure(isFactoryCoverageRow(type, termText), `${label} coverage is not a recognized factory coverage term`)
      ensure(factoryTermText(termText) === termText, `${label} coverage term is not canonical factory text`)
    }
    ensure(optionalText(coverage.remainingMilesText, `${label} coverage remainingMilesText`, 40), `${label} coverage remainingMilesText is required`)
    ensure(optionalText(coverage.remainingTimeText, `${label} coverage remainingTimeText`, 40), `${label} coverage remainingTimeText is required`)
    ensure(WARRANTY_CHECK_COVERAGE_STATUSES.has(coverage.status), `${label} coverage status is invalid`)
    optionalInteger(coverage.termMonths, `${label} coverage termMonths`, 0, 600)
    optionalInteger(coverage.termMiles, `${label} coverage termMiles`, 0, 999_999)
    optionalInteger(coverage.remainingMiles, `${label} coverage remainingMiles`, 0, 999_999)
    optionalInteger(coverage.remainingMonths, `${label} coverage remainingMonths`, 0, 600)
    optionalBoolean(coverage.unlimitedMiles, `${label} coverage unlimitedMiles`)
    if (allowUnlimitedMonths) optionalBoolean(coverage.unlimitedMonths, `${label} coverage unlimitedMonths`)
    optionalText(coverage.note, `${label} coverage note`, 160)
  }
}

// Per-VIN warranty coverage check. The Ford OASIS block (Ford/Lincoln only) is
// authoritative; the AutoCheck block carries Experian estimates figured from the
// mileage entered. Dates and term text are validated as bounded printed text,
// never re-parsed. The allow-list mirrors validatedWarrantyCheck() in
// server/importer.mjs; no owner or customer field exists and none is accepted.
function validateWarrantyCheck(value, vin) {
  onlyKeys(value, new Set(['dataState', 'capturedAt', 'sourceLabel', 'mileageEntered', 'mileageSource', 'autoCheck', 'fordOasis']), 'warranty check record')
  ensure(RESOURCE_DATA_STATES.has(value.dataState), 'warranty check data state is invalid')
  ensure(optionalTimestamp(value.capturedAt, 'warranty check capturedAt'), 'warranty check capturedAt is required')
  const sourceLabel = optionalText(value.sourceLabel, 'warranty check sourceLabel', 160)
  ensure(sourceLabel, 'warranty check sourceLabel is required')
  ensure(!/\bUNVERIFIED\b|DO NOT QUOTE|OASIS (?:WAS )?UNAVAILABLE/i.test(sourceLabel), 'warranty check sourceLabel marks the record as unverified')
  ensure(optionalInteger(value.mileageEntered, 'warranty check mileageEntered', 0, 999_999) !== undefined, 'warranty check mileageEntered is required')
  optionalText(value.mileageSource, 'warranty check mileageSource', 80)
  const hasAutoCheck = value.autoCheck !== undefined && value.autoCheck !== null
  const hasFordOasis = value.fordOasis !== undefined && value.fordOasis !== null
  ensure(hasAutoCheck || hasFordOasis, 'warranty check record needs at least one of autoCheck or fordOasis')
  if (hasAutoCheck) {
    onlyKeys(value.autoCheck, new Set(['inServiceDate', 'inServiceAgeMonths', 'defaultMileage', 'coverages']), 'warranty check AutoCheck block')
    optionalText(value.autoCheck.inServiceDate, 'warranty check AutoCheck inServiceDate', 40)
    optionalInteger(value.autoCheck.inServiceAgeMonths, 'warranty check AutoCheck inServiceAgeMonths', 0, 600)
    optionalInteger(value.autoCheck.defaultMileage, 'warranty check AutoCheck defaultMileage', 0, 999_999)
    validateWarrantyCheckCoverages(value.autoCheck.coverages, 'warranty check AutoCheck', 80, true)
  }
  if (hasFordOasis) {
    onlyKeys(value.fordOasis, new Set(['warrantyStartDate', 'monthsInService', 'coverages']), 'warranty check Ford OASIS block')
    const warrantyStartDate = optionalText(value.fordOasis.warrantyStartDate, 'warranty check Ford OASIS warrantyStartDate', 40)
    ensure(warrantyStartDate, 'warranty check Ford OASIS warrantyStartDate is required')
    ensure(isOasisDate(warrantyStartDate), 'warranty check Ford OASIS warrantyStartDate is not a recognized OASIS date')
    ensure(optionalInteger(value.fordOasis.monthsInService, 'warranty check Ford OASIS monthsInService', 0, 600) !== undefined, 'warranty check Ford OASIS monthsInService is required')
    validateWarrantyCheckCoverages(value.fordOasis.coverages, 'warranty check Ford OASIS', 120, false, true)
  }
  return { factoryEquipment: 0, externalAutoCheck: 0, fordOasis: 0, warrantyCheck: 1 }
}

function validateFordInvoice(value, vin) {
  onlyKeys(value, new Set(['dataState', 'available', 'capturedAt', 'sourceLabel']), 'Ford invoice record')
  ensure(value.dataState === 'current', 'Ford invoice record must be current')
  ensure(value.available === true, 'Ford invoice record must confirm a saved document')
  ensure(Boolean(optionalTimestamp(value.capturedAt, 'Ford invoice capturedAt')), 'Ford invoice capture time is required')
  ensure(Boolean(optionalText(value.sourceLabel, 'Ford invoice source label', 160)), 'Ford invoice source label is required')
  return { fordInvoice: 1 }
}

function resourceRejectionReason(error) {
  return String(error?.message ?? error).replace(/^Invalid cloud release:\s*/i, '').slice(0, 240)
}

function validateResourceRecord(value, vin, {
  degradeOptionalResources = false,
  onResourceRejected = () => {},
} = {}) {
  onlyKeys(value, new Set(['vin', 'factoryEquipment', 'autoCheckReport', 'fordInvoice', 'fordOasis', 'warrantyCheck']), 'resource record')
  ensure(value.vin === vin && normalizedVin(value.vin) === vin, 'resource record VIN does not match its normalized vehicle')
  let counts = { factoryEquipment: 0, externalAutoCheck: 0, fordInvoice: 0, fordOasis: 0, warrantyCheck: 0 }
  const rejected = []
  if (value.factoryEquipment !== undefined && value.factoryEquipment !== null) {
    const next = validateFactoryEquipment(value.factoryEquipment, vin)
    counts = { ...counts, factoryEquipment: counts.factoryEquipment + next.factoryEquipment }
  }
  if (value.autoCheckReport !== undefined && value.autoCheckReport !== null) {
    const next = validateExternalAutoCheck(value.autoCheckReport, vin)
    counts = { ...counts, externalAutoCheck: counts.externalAutoCheck + next.externalAutoCheck }
  }
  if (value.fordInvoice !== undefined && value.fordInvoice !== null) {
    const next = validateFordInvoice(value.fordInvoice, vin)
    counts = { ...counts, fordInvoice: counts.fordInvoice + next.fordInvoice }
  }
  if (value.fordOasis !== undefined && value.fordOasis !== null) {
    try {
      const next = validateFordOasis(value.fordOasis, vin)
      counts = { ...counts, fordOasis: counts.fordOasis + next.fordOasis }
    } catch (error) {
      if (!degradeOptionalResources) throw error
      const rejection = { vin, channel: 'fordOasis', reason: resourceRejectionReason(error) }
      rejected.push(rejection)
      onResourceRejected(rejection)
    }
  }
  if (value.warrantyCheck !== undefined && value.warrantyCheck !== null) {
    try {
      const next = validateWarrantyCheck(value.warrantyCheck, vin)
      counts = { ...counts, warrantyCheck: counts.warrantyCheck + next.warrantyCheck }
    } catch (error) {
      if (!degradeOptionalResources) throw error
      const rejection = { vin, channel: 'warrantyCheck', reason: resourceRejectionReason(error) }
      rejected.push(rejection)
      onResourceRejected(rejection)
    }
  }
  const usable = counts.factoryEquipment + counts.externalAutoCheck + counts.fordInvoice + counts.fordOasis + counts.warrantyCheck > 0
  ensure(usable || (degradeOptionalResources && rejected.length > 0), 'resource record contains no usable resource')
  return { counts, rejected, usable }
}

function validateResourceRun(run, resourceRows, reportDate) {
  if (run === undefined || run === null) {
    ensure(resourceRows.length === 0, 'resource record exists without a validated resources source run')
    return
  }
  onlyKeys(run, new Set(['type', 'reportDate', 'extractedAt', 'sha256', 'bytes', 'schemaVersion', 'status', 'staleReason', 'rowCount', 'provenanceSha256', 'metadata']), 'resources source run')
  ensure(run.type === 'vin_document_enrichment' && run.schemaVersion === RESOURCE_SCHEMA, 'resources source run type/schema is invalid')
  ensure(run.reportDate === reportDate && run.status === 'current' && (run.staleReason === null || run.staleReason === undefined), 'resources source run is stale or date-mismatched')
  ensure(HASH.test(String(run.sha256)) && strictInteger(run.bytes, 'resources source bytes', 1) > 0, 'resources source run checksum/size is invalid')
  ensure(strictInteger(run.rowCount, 'resources source row count') === resourceRows.length, 'resources source row count does not reconcile')
  if (run.extractedAt !== null && run.extractedAt !== undefined) optionalTimestamp(run.extractedAt, 'resources source extractedAt')

  const metadata = run.metadata
  onlyKeys(metadata, new Set([
    'status', 'generatedAt', 'recordCount', 'factoryEquipmentCount', 'externalAutoCheckCount', 'fordInvoiceCount', 'fordOasisCount',
    'warrantyCheckCount', 'path', 'sha256', 'bytes', 'matchedVehicleCount', 'unmatchedRecordCount',
  ]), 'resources source metadata')
  ensure(metadata.status === 'matched', 'resources source metadata is not matched')
  if (metadata.generatedAt !== null && metadata.generatedAt !== undefined) optionalTimestamp(metadata.generatedAt, 'resources source generatedAt')
  ensure(sameValue(metadata.generatedAt ?? null, run.extractedAt ?? null), 'resources source timestamps do not reconcile')
  ensure(typeof metadata.path === 'string' && /^local-file:[^/\\:]{1,255}$/.test(metadata.path), 'resources source path is not portable')
  ensure(HASH.test(String(metadata.sha256)) && String(metadata.sha256).toLowerCase() === String(run.sha256).toLowerCase(), 'resources source metadata checksum does not reconcile')
  ensure(strictInteger(metadata.bytes, 'resources metadata bytes', 1) === strictInteger(run.bytes, 'resources source bytes', 1), 'resources source metadata size does not reconcile')
  const recordCount = strictInteger(metadata.recordCount, 'resources record count')
  ensure(recordCount <= 2_000, 'resources record count is out of bounds')
  const matched = strictInteger(metadata.matchedVehicleCount, 'matched resources count')
  const unmatched = strictInteger(metadata.unmatchedRecordCount, 'unmatched resources count')
  ensure(matched === resourceRows.length && unmatched === recordCount - matched, 'resources matched/unmatched counts do not reconcile')
  const factoryCount = strictInteger(metadata.factoryEquipmentCount, 'factory-equipment source count')
  const autoCheckCount = strictInteger(metadata.externalAutoCheckCount, 'external AutoCheck source count')
  const invoiceCount = metadata.fordInvoiceCount === undefined ? 0 : strictInteger(metadata.fordInvoiceCount, 'Ford invoice source count')
  // Releases published before the Ford OASIS channel existed carry no OASIS count.
  const oasisCount = metadata.fordOasisCount === undefined ? 0 : strictInteger(metadata.fordOasisCount, 'Ford OASIS source count')
  // Likewise, releases published before the warranty check channel carry no warranty count.
  const warrantyCount = metadata.warrantyCheckCount === undefined ? 0 : strictInteger(metadata.warrantyCheckCount, 'warranty check source count')
  ensure(factoryCount <= recordCount && autoCheckCount <= recordCount && invoiceCount <= recordCount && oasisCount <= recordCount && warrantyCount <= recordCount, 'resources type counts exceed the source record count')
  const attachedFactory = resourceRows.reduce((total, row) => total + row.counts.factoryEquipment, 0)
  const attachedAutoCheck = resourceRows.reduce((total, row) => total + row.counts.externalAutoCheck, 0)
  const attachedInvoice = resourceRows.reduce((total, row) => total + row.counts.fordInvoice, 0)
  const attachedOasis = resourceRows.reduce((total, row) => total + row.counts.fordOasis, 0)
  const attachedWarranty = resourceRows.reduce((total, row) => total + row.counts.warrantyCheck, 0)
  ensure(attachedFactory <= factoryCount && attachedAutoCheck <= autoCheckCount && attachedInvoice <= invoiceCount && attachedOasis <= oasisCount && attachedWarranty <= warrantyCount, 'attached resource type counts exceed validated source evidence')
  ensure(HASH.test(String(run.provenanceSha256)), 'resources source provenance checksum is invalid')
  ensure(
    String(run.provenanceSha256).toLowerCase() === resourceProvenanceSha256(run, resourceRows),
    'resources source provenance does not match its claims and attached records',
  )
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item))
}

function storeCounts(records, field) {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, records.filter((row) => row[field] === name).length]))
}

function checkCounts(actual, expected, label) {
  ensure(object(actual), `${label} is missing`)
  for (const name of STORE_NAMES) ensure(integer(actual[name] ?? 0, `${label} ${name}`) === expected[name], `${label} does not reconcile`)
  ensure(Object.keys(actual).every((name) => STORE_NAMES.includes(name)), `${label} contains an unknown store`)
}

function matchOptionalCounts(actual, expected, label) {
  if (actual !== undefined) checkCounts(actual, expected, label)
}

function sameValue(left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
  if (!object(left) || !object(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
}

function sourceMatches(actual, source, label, allowEnrichment = false) {
  ensure(object(actual), `${label} missing from normalized inventory`)
  const matches = allowEnrichment ? Object.keys(source).every((key) => {
    if (key === 'photo_url_source' && actual[key] === 'Verified app photo cache — official VDP') return true
    if (['autoCheckReport', 'windowSticker'].includes(key) && object(source[key]) && object(actual[key])) {
      // The app-facing projection omits validation/provenance fields and large
      // raw document text. Their exact values remain in the encrypted
      // publicSnapshot archive, while every presentation field must still
      // match that source evidence byte-for-byte at the value level.
      if (source[key].validated_vin !== undefined && normalizedVin(source[key].validated_vin) !== normalizedVin(source.vin)) return false
      return Object.keys(source[key])
        .filter((field) => !PUBLIC_RESOURCE_ARCHIVE_ONLY_FIELDS.has(field))
        .every((field) => sameValue(source[key][field], actual[key][field]))
    }
    return sameValue(source[key], actual[key])
  }) : sameValue(source, actual)
  ensure(matches, `${label} normalized data differs from its source`)
}

function validateManifest(manifest, reportDate) {
  ensure(object(manifest) && manifest.complete === true && manifest.report_date === reportDate, 'completed manifest is missing')
  ensure(manifest.public_inventory_status === 'complete' && ['complete', 'complete_authenticated_read_only'].includes(manifest.dealermail_status), 'manifest source status is incomplete')
  const qa = manifest.validation_results
  ensure(object(qa), 'manifest validation evidence is missing')
  ensure(qa.passed === true || (qa.public_sources_complete === true && qa.dealermail_complete === true && qa.workbook_validated === true && (qa.desktop_excel_opened_without_repair === true || qa.desktop_excel_opened_without_repair_prompt === true) && integer(qa.formula_errors, 'formula errors') === 0 && (qa.read_only_validation_hash_unchanged === true || qa.published_hash_unchanged_after_read_only_tests === true) && qa.macro_free === true), 'manifest validation failed')
  ensure(object(manifest.source_counts), 'manifest counts are missing')
}

function validatePublic(snapshot, run, manifest, reportDate) {
  ensure(object(snapshot) && snapshot.completed === true && snapshot.report_date === reportDate, 'public snapshot is incomplete or mismatched')
  const statuses = rows(snapshot.source_statuses, 'public source', 4)
  ensure(statuses.length === 4 && new Set(statuses.map((item) => item?.source)).size === 4, 'all four unique public sources are required')
  for (const status of statuses) {
    ensure(object(status) && Object.hasOwn(STORES, status.source) && status.status === 'OK', 'public source is incomplete')
    const expected = integer(status.expected_count, 'public source expected count', 1)
    ensure(integer(status.rows_fetched, 'public fetched count') === expected && integer(status.unique_vins, 'public unique count') === expected, 'public source enumeration does not reconcile')
  }
  ensure(object(snapshot.vehicles), 'public VIN map is missing')
  const entries = Object.entries(snapshot.vehicles)
  ensure(entries.length > 0 && entries.length <= MAX_ROWS, 'public inventory is empty or out of bounds')
  ensure(integer(run.rowCount, 'public row count') === entries.length && integer(manifest.source_counts.public_unique_vins, 'manifest public count') === entries.length, 'public count does not reconcile')
  const byVin = new Map()
  const stocks = new Set()
  for (const [key, record] of entries) {
    ensure(object(record), 'public record is invalid')
    const vin = normalizedVin(record.vin)
    const stockNumber = stock(record.stock_number)
    ensure(normalizedVin(key) === vin && !byVin.has(vin) && !stocks.has(stockNumber), 'public VIN/stock is duplicated or mismatched')
    ensure(Object.hasOwn(STORES, record.store), 'public physical store is invalid')
    ensure(typeof record.actual_location === 'string' && record.actual_location.trim() && typeof record.vehicle_name === 'string' && record.vehicle_name.trim(), 'public vehicle/location evidence is missing')
    ensure(
      ['in_stock', 'in_transit', 'in_production'].every((key) => typeof record[key] === 'boolean') &&
        Array.isArray(record.source_sites) && record.source_sites.length > 0 && record.source_sites.every((site) => Object.hasOwn(STORES, site)),
      'public source flags or publishing stores are invalid',
    )
    const url = new URL(record.listing_url)
    const sourceHosts = new Set(record.source_sites.map((site) => STORES[site].host))
    ensure(
      url.protocol === 'https:' && !url.username && !url.password && !url.port && sourceHosts.has(url.hostname) && url.href.toUpperCase().includes(vin),
      'public listing link must use HTTPS and match the VIN and a publishing group store',
    )
    byVin.set(vin, record)
    stocks.add(stockNumber)
  }
  const counts = storeCounts([...byVin.values()], 'store')
  matchOptionalCounts(run.metadata?.storeCounts, counts, 'public store totals')
  return { byVin, counts }
}

function crmRows(value, label) {
  const records = rows(value, label)
  const bySourceVin = new Map()
  const byVin = new Map()
  const stocks = new Set()
  const quarantinedByStock = new Map()
  for (const record of records) {
    ensure(object(record), `${label} record is invalid`)
    const sourceVin = sourceVinToken(record.vin)
    const stockNumber = stock(record.stockNumber)
    ensure(!bySourceVin.has(sourceVin) && !stocks.has(stockNumber), `${label} contains duplicate source VIN/stock`)
    ensure(Object.hasOwn(STORES, record.storeName) && STORES[record.storeName].code === record.storeCode, `${label} store/code mismatch`)
    ensure(integer(record.sourceCellCount, 'CRM cell count') === 22 && Array.isArray(record.rawCellInnerText) && record.rawCellInnerText.length === 22 && Array.isArray(record.rawCellControlValues) && record.rawCellControlValues.length === 22, `${label} must preserve both 22-cell arrays`)
    bySourceVin.set(sourceVin, record)
    stocks.add(stockNumber)
    if (VIN.test(sourceVin)) byVin.set(sourceVin, record)
    else quarantinedByStock.set(stockNumber, record)
  }
  return { records, bySourceVin, byVin, stocks, quarantinedByStock, counts: storeCounts(records, 'storeName') }
}

function validateManagerDisposition(release, normalizedVehicles, reportDate) {
  // Existing encrypted releases predate this optional overlay. Treat absence
  // only as not provided; never infer an unsold or undelivered state.
  const overlay = release.managerDispositionOverlay ?? sanitizeManagerDispositionDocuments({
    documents: [], reportDate, vehicles: normalizedVehicles,
  })
  const summary = validateSanitizedManagerDispositionOverlay(overlay, {
    reportDate,
    vehicles: normalizedVehicles,
  })
  const run = release.sourceRuns?.managerDisposition
  const binding = release.manifest?.manager_disposition_overlay
  if (overlay.coverageStatus === 'not_provided') {
    ensure(run === null || run === undefined, 'manager disposition source run exists without bound source data')
    ensure(binding === null || binding === undefined, 'manager disposition manifest binding exists without source data')
    return summary
  }

  ensure(object(run), 'manager disposition source run is missing')
  onlyKeys(run, new Set([
    'type', 'reportDate', 'extractedAt', 'sha256', 'bytes', 'schemaVersion',
    'status', 'staleReason', 'rowCount', 'metadata',
  ]), 'manager disposition source run')
  ensure(run.type === 'manager_disposition_overlay' && run.schemaVersion === MANAGER_DISPOSITION_SCHEMA, 'manager disposition source schema is unsupported')
  ensure(run.reportDate === reportDate && run.status === 'current' && run.staleReason === null, 'manager disposition source is not current')
  ensure(run.extractedAt === null, 'manager disposition source must not claim an extraction timestamp')
  const canonical = canonicalManagerDispositionJson(overlay)
  ensure(String(run.sha256).toLowerCase() === managerDispositionSha256(overlay), 'manager disposition source checksum does not match its sanitized overlay')
  ensure(strictInteger(run.bytes, 'manager disposition source bytes', 1) === new TextEncoder().encode(canonical).byteLength, 'manager disposition source byte count does not match its sanitized overlay')
  ensure(strictInteger(run.rowCount, 'manager disposition source row count') === summary.recordCount, 'manager disposition source row count does not reconcile')

  onlyKeys(run.metadata, new Set([
    'classification', 'cloudUploadAllowed', 'sourceCount', 'sourceStores',
    'soldRecordCount', 'deliveredRecordCount', 'reviewRecordCount',
    'strippedFieldCount', 'sanitizer', 'boundSourceSha256',
  ]), 'manager disposition source metadata')
  ensure(run.metadata.classification === 'operational-redacted' && run.metadata.cloudUploadAllowed === true, 'manager disposition source is not approved for cloud use')
  ensure(run.metadata.sanitizer === 'strict_allowlist_v1', 'manager disposition source was not processed by the approved sanitizer')
  ensure(strictInteger(run.metadata.sourceCount, 'manager disposition source count', 1) === overlay.sources.length, 'manager disposition source count does not reconcile')
  ensure(Array.isArray(run.metadata.sourceStores) && sameValue(run.metadata.sourceStores, overlay.sources.map((source) => source.sourceStore)), 'manager disposition source stores do not reconcile')
  ensure(strictInteger(run.metadata.soldRecordCount, 'manager disposition sold count') === summary.soldRecordCount, 'manager disposition sold count does not reconcile')
  ensure(strictInteger(run.metadata.deliveredRecordCount, 'manager disposition delivered count') === summary.deliveredRecordCount, 'manager disposition delivered count does not reconcile')
  ensure(strictInteger(run.metadata.reviewRecordCount, 'manager disposition review count') === summary.reviewRecordCount, 'manager disposition review count does not reconcile')
  ensure(strictInteger(run.metadata.strippedFieldCount, 'manager disposition stripped-field count') === overlay.sources.reduce((total, source) => total + source.strippedFieldCount, 0), 'manager disposition stripped-field count does not reconcile')
  ensure(typeof run.metadata.boundSourceSha256 === 'string' && HASH.test(run.metadata.boundSourceSha256), 'manager disposition bound-source checksum is invalid')

  ensure(object(binding), 'manager disposition manifest binding is missing')
  onlyKeys(binding, MANAGER_BINDING_KEYS, 'manager disposition manifest binding')
  ensure(binding.status === 'complete' && binding.classification === 'operational-redacted' && binding.source_type === 'manager-log' && binding.cloud_upload_allowed === true, 'manager disposition manifest binding is not approved')
  ensure(String(binding.sha256).toLowerCase() === String(run.metadata.boundSourceSha256).toLowerCase(), 'manager disposition source does not match its manifest binding')
  ensure(binding.source_period === reportDate.slice(0, 7), 'manager disposition manifest period does not match the release')
  ensure(overlay.sources.length === 1 && binding.source_store === overlay.sources[0].sourceStore && run.metadata.sourceStores.length === 1 && run.metadata.sourceStores[0] === binding.source_store, 'manager disposition manifest store does not match its sanitized source')
  ensure(binding.path === `local-file:${binding.source_period}-${MANAGER_STORE_SLUGS[binding.source_store]}-operational.json`, 'manager disposition manifest path does not match its approved source filename')
  ensure(binding.sold_records === summary.soldRecordCount && binding.delivered_records === summary.deliveredRecordCount && binding.sold_not_marked_delivered === summary.soldNotMarkedDeliveredCount, 'manager disposition manifest status counts do not reconcile')
  ensure(binding.matched_current_public_vins === summary.matchedRecordCount && binding.unmatched_records === summary.unmatchedRecordCount && binding.conflicting_records === summary.conflictingRecordCount && binding.review_records === summary.reviewRecordCount, 'manager disposition manifest match counts do not reconcile')
  return summary
}

function activeInventoryMembership(publicByVin, crmByVin, managerDispositionOverlay) {
  // A current vehicle must be present in at least one current operational
  // source. Public listings and DealerMail are complementary: a CRM-only row
  // can be a just-arrived pre-listing vehicle, while a manager-log row alone
  // is historical audit evidence and must not recreate off-market inventory.
  const activeVins = new Set([...publicByVin.keys(), ...crmByVin.keys()])
  const activeStoreCounts = Object.create(null)
  let managerDeliveredExclusionCount = 0
  let managerPendingIdentityReviewCount = 0
  for (const record of managerDispositionOverlay?.records ?? []) {
    const vin = typeof record?.vin === 'string' && VIN.test(record.vin) ? record.vin : null
    const conflicting = ['matched_vin_stock_review', 'stock_ambiguous'].includes(record?.matchStatus)
    if (record?.deliveredManagerLog === true && vin && !conflicting) {
      if (activeVins.delete(vin)) managerDeliveredExclusionCount += 1
      continue
    }
    if (record?.soldManagerLog === true && record?.deliveredManagerLog === false) {
      if (!vin) {
        managerPendingIdentityReviewCount += 1
      }
    }
  }
  for (const vin of activeVins) {
    const store = publicByVin.get(vin)?.store || crmByVin.get(vin)?.storeName
    if (typeof store === 'string' && store) activeStoreCounts[store] = (activeStoreCounts[store] ?? 0) + 1
  }
  return {
    activeInventoryCount: activeVins.size,
    activeStoreCounts,
    managerDeliveredExclusionCount,
    // Kept for receipt compatibility. Pending manager records no longer carry
    // a VIN back into active inventory after both current sources lose it.
    managerPendingCarryoverCount: 0,
    managerPendingIdentityReviewCount,
  }
}

function validateCrmSummary(summary, parsed, label) {
  ensure(object(summary) && integer(summary.totalRows, `${label} count`) === parsed.records.length && integer(summary.uniqueVinCount, `${label} source-VIN count`) === parsed.bySourceVin.size && integer(summary.uniqueStockCount, `${label} stock count`) === parsed.stocks.size, `${label} summary does not reconcile`)
  matchOptionalCounts(summary.byStore, parsed.counts, `${label} store totals`)
}

function validateDealerMail(snapshot, run, manifest, reportDate) {
  ensure(object(snapshot) && snapshot.schemaVersion === 'dealermail-used-holds-and-complete-inventory-v2' && snapshot.reportDate === reportDate, 'complete DealerMail snapshot is missing or mismatched')
  const status = snapshot.sourceStatus
  ensure(object(status) && /^complete(?:\b|_)/i.test(status.overall ?? '') && status.readOnly === true && status.loginRedirectEncountered !== true && status.credentialsCaptured !== true, 'DealerMail source is incomplete or unsafe')
  const inventory = snapshot.completeDealerMailUsedInventory
  ensure(object(inventory) && inventory.readOnly === true && inventory.authenticationStatus?.authenticatedSessionStillWorks === true && inventory.authenticationStatus?.loginFormDetected === false, 'DealerMail authentication/read-only evidence is missing')
  ensure(Array.isArray(snapshot.currentComments) && Array.isArray(snapshot.currentAlerts), 'DealerMail top-level current comment/alert evidence arrays are missing')
  const included = crmRows(inventory.rows, 'complete CRM')
  for (const record of included.records) {
    ensure(['Y', 'N'].includes(record.commentsFlag), 'complete CRM commentsFlag must be Y or N')
    ensure(['Y', 'N'].includes(record.alertsFlag), 'complete CRM alertsFlag must be Y or N')
    ensure(Array.isArray(record.comments) && Array.isArray(record.alerts), 'complete CRM message evidence is missing')
    ensure(record.comments.every((group) => Array.isArray(group?.rows)), 'complete CRM comment rows are invalid')
    if (record.commentsFlag === 'Y') ensure(record.comments.some((group) => group.rows.some((comment) => typeof comment.commentTextRaw === 'string' && comment.commentTextRaw.trim())), 'flagged complete CRM comments are missing')
    if (record.alertsFlag === 'Y') ensure(record.alerts.some((alert) => typeof alert?.alertTextRaw === 'string' && alert.alertTextRaw.trim()), 'flagged complete CRM alert is missing')
  }
  ensure(included.records.length > 0 && integer(run.rowCount, 'CRM run count') === included.records.length && integer(manifest.source_counts.dealermail_used_rows, 'manifest CRM count') === included.records.length, 'CRM count does not reconcile')
  validateCrmSummary(inventory.summary, included, 'complete CRM')
  const quarantine = run.metadata?.vinQuarantine
  if (quarantine !== undefined || included.quarantinedByStock.size > 0) {
    ensure(object(quarantine), 'CRM VIN-quarantine metadata is missing')
    const quarantineStocks = [...included.quarantinedByStock.keys()].sort()
    ensure(
      strictInteger(quarantine.count, 'CRM VIN-quarantine count') === quarantineStocks.length &&
        strictInteger(quarantine.sourceRowCount, 'CRM source row count') === included.records.length &&
        strictInteger(quarantine.vinReconciledRowCount, 'CRM VIN-reconciled count') === included.byVin.size &&
        quarantine.excludedFromVinWorkflows === true &&
        Array.isArray(quarantine.stocks) &&
        sameValue(quarantine.stocks, quarantineStocks),
      'CRM VIN-quarantine metadata does not reconcile',
    )
  }
  const excludeSource = snapshot.excludeActiveHoldsValidationSet
  ensure(object(excludeSource) && excludeSource.readOnly === true, 'exclude-holds control evidence is missing')
  const excluded = crmRows(excludeSource.rows, 'exclude-holds CRM')
  validateCrmSummary(excludeSource.summary, excluded, 'exclude-holds CRM')
  for (const [sourceVin, record] of excluded.bySourceVin) {
    const original = included.bySourceVin.get(sourceVin)
    ensure(original && stock(original.stockNumber) === stock(record.stockNumber) && original.storeName === record.storeName && original.storeCode === record.storeCode, 'exclude-holds VIN/stock/store does not match complete inventory')
  }

  const held = new Map()
  const counters = { totalHoldDetailRows: 0, activeHoldDetailRows: 0, activePrimaryHolds: 0, activeBackupHolds: 0, deletedHistoricalHoldRows: 0 }
  for (const vehicle of rows(snapshot.vehicles, 'held vehicle', 1)) {
    ensure(object(vehicle) && object(vehicle.mainRow), 'held vehicle identity is missing')
    const vin = normalizedVin(vehicle.mainRow.vin)
    const original = included.byVin.get(vin)
    ensure(original && !held.has(vin) && stock(original.stockNumber) === stock(vehicle.mainRow.stockNumber) && vehicle.store?.name === original.storeName && vehicle.store?.code === original.storeCode, 'held vehicle VIN/stock/store does not match complete CRM')
    const orders = new Set()
    let primaryCount = 0
    for (const detail of rows(vehicle.holdDetailRows, 'hold detail', 1)) {
      ensure(object(detail), 'hold detail is invalid')
      if (detail.stockNumber !== undefined) ensure(stock(detail.stockNumber) === stock(original.stockNumber), 'hold detail stock mismatch')
      if (detail.sourceStockNumber !== undefined) ensure(stock(detail.sourceStockNumber) === stock(original.stockNumber), 'hold detail source stock mismatch')
      counters.totalHoldDetailRows += 1
      if (detail.lifecycleStatus === 'active') {
        const order = integer(detail.holdOrderNumber, 'active hold order', 1)
        ensure(!orders.has(order) && detail.holdPosition === (order === 1 ? 'primary' : 'backup'), 'active hold position/order is duplicated or inconsistent')
        if (detail.orderRaw !== undefined) ensure(integer(detail.orderRaw, 'raw active hold order', 1) === order, 'raw active hold order differs')
        orders.add(order)
        counters.activeHoldDetailRows += 1
        if (order === 1) { primaryCount += 1; counters.activePrimaryHolds += 1 } else counters.activeBackupHolds += 1
      } else {
        ensure(detail.lifecycleStatus === 'deleted_history' && detail.holdPosition === 'deleted' && String(detail.orderRaw).trim().toUpperCase() === 'DELETED', 'deleted hold history is mislabeled')
        counters.deletedHistoricalHoldRows += 1
      }
    }
    ensure(primaryCount === 1, 'held VIN must have exactly one active primary')
    ensure(Array.isArray(vehicle.comments) && Array.isArray(vehicle.alerts), 'held comment/alert evidence is missing')
    if (String(vehicle.mainRow.commentsFlag).toUpperCase() === 'Y') ensure(vehicle.comments.some((comment) => Array.isArray(comment.rows) && comment.rows.length > 0), 'flagged hold comments are missing')
    if (String(vehicle.mainRow.alertsFlag).toUpperCase() === 'Y') ensure(vehicle.alerts.some((alert) => typeof alert.alertTextRaw === 'string' && alert.alertTextRaw.trim()), 'flagged hold alert is missing')
    held.set(vin, vehicle)
  }
  const difference = new Set([...included.bySourceVin.keys()].filter((vin) => !excluded.bySourceVin.has(vin)))
  if (snapshot.releasedHoldHistory !== undefined) {
    const seenHistory = new Set()
    const seenStocks = new Set()
    for (const history of rows(snapshot.releasedHoldHistory, 'released hold history')) {
      const vin = normalizedVin(history?.vin)
      const historyStock = stock(history?.stockNumber)
      ensure(history.vin === vin && !seenHistory.has(vin) && !held.has(vin), 'released hold history is duplicated, noncanonical, or currently held')
      ensure(!seenStocks.has(historyStock), 'released hold history stock is duplicated')
      ensure(object(history.store) && Object.hasOwn(STORES, history.store.name) && STORES[history.store.name].code === history.store.code, 'released hold history CRM store/code is invalid')
      const currentCrm = included.byVin.get(vin)
      const currentStockOwner = included.records.find((record) => stock(record.stockNumber) === historyStock)
      if (currentCrm) {
        ensure(stock(currentCrm.stockNumber) === historyStock && currentCrm.storeName === history.store.name && currentCrm.storeCode === history.store.code, 'released hold history does not match the current CRM VIN/stock/store record')
      } else {
        ensure(!currentStockOwner, 'released hold history stock is currently assigned to a different CRM VIN')
      }
      let sourceUrl
      try { sourceUrl = new URL(history.sourceUrl) } catch { ensure(false, 'released hold history source URL is invalid') }
      const sourceKeys = [...sourceUrl.searchParams.keys()]
      ensure(sourceUrl.protocol === 'https:' && sourceUrl.hostname.toLowerCase() === 'www.dealermail.com' && !sourceUrl.username && !sourceUrl.password && !sourceUrl.port && !sourceUrl.hash && sourceUrl.pathname.toLowerCase() === '/prospect_manager/v2_inventory_used_hold_edit.asp' && sourceKeys.length === 1 && sourceKeys[0] === 's' && stock(sourceUrl.searchParams.get('s')) === historyStock, 'released hold history source URL does not match its exact DealerMail stock')
      ensure(history.currentLiveHold === false && validTimestamp(history.observedAtUtc), 'released hold history must be explicitly non-current with a valid observation time')
      for (const detail of rows(history.holdDetailRows, 'released hold detail', 1)) {
        ensure(object(detail), 'released hold history detail is invalid')
        ensure(stock(detail.stockNumber) === historyStock && stock(detail.sourceStockNumber) === historyStock, 'released hold history nested detail stock/provenance does not match its wrapper')
        if (detail.vin !== undefined) ensure(normalizedVin(detail.vin) === vin, 'released hold history nested detail VIN does not match its wrapper')
        if (detail.storeName !== undefined || detail.storeCode !== undefined) ensure(detail.storeName === history.store.name && detail.storeCode === history.store.code, 'released hold history nested detail store provenance does not match its wrapper')
      }
      seenHistory.add(vin)
      seenStocks.add(historyStock)
    }
  }
  ensure(sameSet(difference, new Set(held.keys())), 'complete inventory must equal exclude-holds plus exact held VIN set')
  const flagged = new Set(included.records.filter((row) => row.holdStateFromRowClass === 'active_hold').map((row) => normalizedVin(row.vin)))
  ensure(sameSet(flagged, new Set(held.keys())), 'CRM active-hold rows differ from live held VIN set')
  for (const [field, expected] of Object.entries({ ...counters, uniqueHeldVehicles: held.size, detailEndpointsAttempted: held.size, detailEndpointsSucceeded: held.size })) {
    ensure(integer(snapshot.summary?.[field], `hold ${field}`) === expected, `hold summary ${field} does not reconcile`)
  }
  ensure(integer(manifest.source_counts.active_held_vins, 'manifest held count') === held.size, 'manifest held count differs')
  const validation = snapshot.completeInventorySetValidation?.validation
  ensure(object(validation) && CHECKS.every((key) => validation[key] === true), 'CRM set validation did not pass')
  ensure(
    validation.allVinFormatValid === (included.quarantinedByStock.size === 0),
    'CRM VIN-format validation does not reconcile with quarantined source rows',
  )
  const differenceRows = rows(snapshot.completeInventorySetValidation.activeHoldDifferenceRows, 'held difference')
  ensure(differenceRows.length === held.size && sameSet(new Set(differenceRows.map((row) => normalizedVin(row.vin))), new Set(held.keys())), 'recorded hold difference set differs')
  for (const row of differenceRows) {
    const original = included.byVin.get(normalizedVin(row.vin))
    ensure(stock(row.stockNumber) === stock(original.stockNumber) && row.storeName === original.storeName && row.storeCode === original.storeCode, 'recorded hold difference stock/store differs')
  }
  const control = snapshot.crmInventoryControlValidation
  ensure(object(control) && integer(control.completeInventoryRowsIncludingHolds, 'control include count') === included.records.length && integer(control.inventoryRowsExcludingHolds, 'control exclude count') === excluded.records.length && integer(control.activeHoldVINsRemovedByExcludeFilter, 'control held count') === held.size && control.excludeFilterRemovedExactlyTheActiveHoldSet === true, 'CRM control totals differ')
  checkCounts(control.includingHoldsByStore, included.counts, 'CRM include controls')
  checkCounts(control.excludingHoldsByStore, excluded.counts, 'CRM exclude controls')
  const lotCount = integer(control.lotReadyOnlyRowsIncludingHolds, 'lot-ready control count', 1)
  ensure(typeof control.lotReadyOnlyVINSetEqualsAllVehiclesVINSet === 'boolean' && (control.lotReadyOnlyVINSetEqualsAllVehiclesVINSet !== true || lotCount === included.records.length), 'lot-ready control evidence is inconsistent')
  const cdk = new Map()
  for (const row of rows(snapshot.cdkReadOnlyLookup?.records ?? [], 'CDK evidence')) {
    const vin = normalizedVin(row.vin)
    ensure(!cdk.has(vin) && included.byVin.has(vin), 'CDK VIN evidence is duplicated or unrelated')
    cdk.set(vin, row)
  }
  return { ...included, held, cdk, counters }
}

/**
 * Validate a full decrypted bundle; return independently derived non-sensitive
 * totals. Strict is the default. The Worker opts into per-channel degradation
 * only for fordOasis/warrantyCheck so a newly tightened optional validator can
 * never make an otherwise valid stored release unreadable during deploy order.
 */
export function validateReleaseBundle(bundle, {
  degradeOptionalResources = false,
  onResourceRejected = () => {},
} = {}) {
  ensure(object(bundle) && bundle.schemaVersion === RELEASE_FORMAT && bundle.complete === true, 'bundle is incomplete or unsupported')
  const release = bundle.release
  ensure(validDate(bundle.reportDate) && object(release) && release.reportDate === bundle.reportDate && release.timezone === 'America/New_York', 'report date/timezone mismatch')
  validateManifest(release.manifest, bundle.reportDate)
  for (const name of ['public', 'dealerMail']) {
    const run = release.sourceRuns?.[name]
    ensure(object(run) && run.status === 'current' && run.reportDate === bundle.reportDate && HASH.test(String(run.sha256)) && integer(run.bytes, 'source byte count', 1) > 0, 'source is incomplete, mismatched, or missing a checksum')
  }
  const publicData = validatePublic(release.publicSnapshot, release.sourceRuns.public, release.manifest, bundle.reportDate)
  const crm = validateDealerMail(release.dealerMailSnapshot, release.sourceRuns.dealerMail, release.manifest, bundle.reportDate)
  ensure(sameValue(release.releasedHoldHistory ?? [], release.dealerMailSnapshot.releasedHoldHistory ?? []), 'normalized released hold history differs from its source evidence')
  const expectedVins = new Set([...publicData.byVin.keys(), ...crm.byVin.keys()])
  const normalized = rows(release.vehicles, 'normalized inventory', 1)
  const seen = new Set()
  const resourceRows = []
  for (const record of normalized) {
    ensure(object(record), 'normalized record is invalid')
    const vin = normalizedVin(record.vin)
    ensure(expectedVins.has(vin) && !seen.has(vin), 'normalized inventory VIN is duplicate or unrelated')
    for (const [field, source, enrich] of [['publicRecord', publicData.byVin.get(vin), true], ['crmRecord', crm.byVin.get(vin), false], ['holdRecord', crm.held.get(vin), false], ['cdkRecord', crm.cdk.get(vin), false]]) {
      if (source) sourceMatches(record[field], source, field, enrich)
      else ensure(record[field] === null || record[field] === undefined, `${field} has no matching source evidence`)
    }
    if (record.resourceRecord !== null && record.resourceRecord !== undefined) {
      const resourceValidation = validateResourceRecord(record.resourceRecord, vin, {
        degradeOptionalResources,
        onResourceRejected,
      })
      if (resourceValidation.counts.fordInvoice > 0) {
        const make = String(record.publicRecord?.make ?? record.crmRecord?.makeRaw ?? '').trim().toUpperCase()
        ensure(['FORD', 'LINC', 'LINCOLN'].includes(make), 'Ford invoice is attached to a non-Ford-family vehicle')
      }
      resourceRows.push({ vin, resourceRecord: record.resourceRecord, record, ...resourceValidation })
    }
    seen.add(vin)
  }
  ensure(sameSet(seen, expectedVins), 'normalized inventory omits source VINs')
  validateResourceRun(release.sourceRuns?.resources, resourceRows, bundle.reportDate)
  if (degradeOptionalResources) {
    const warnings = Array.isArray(release.warnings) ? release.warnings : []
    for (const row of resourceRows) {
      for (const rejection of row.rejected) {
        delete row.record.resourceRecord[rejection.channel]
        warnings.push(`VIN ${rejection.vin}: dropped unsafe ${rejection.channel} enrichment: ${rejection.reason}`)
      }
      if (!row.usable) row.record.resourceRecord = null
    }
    release.warnings = [...new Set(warnings)]
  }
  const managerDisposition = validateManagerDisposition(release, normalized, bundle.reportDate)
  const activeMembership = activeInventoryMembership(publicData.byVin, crm.byVin, release.managerDispositionOverlay)
  return {
    reportDate: bundle.reportDate,
    publicRowCount: publicData.byVin.size,
    dealerMailRowCount: crm.records.length,
    dealerMailVinReconciledCount: crm.byVin.size,
    dealerMailVinReviewCount: crm.quarantinedByStock.size,
    dealerMailVinReviewStocks: [...crm.quarantinedByStock.keys()].sort(),
    heldVinCount: crm.held.size,
    activeHoldRecordCount: crm.counters.activeHoldDetailRows,
    backupCount: crm.counters.activeBackupHolds,
    deletedHoldRecordCount: crm.counters.deletedHistoricalHoldRows,
    publicStoreCounts: publicData.counts,
    crmStoreCounts: crm.counts,
    resourceRecordCount: resourceRows.filter((row) => row.usable).length,
    ...(resourceRows.some((row) => row.counts.fordInvoice > 0)
      ? { fordInvoiceRecordCount: resourceRows.reduce((total, row) => total + row.counts.fordInvoice, 0) }
      : {}),
    fordOasisRecordCount: resourceRows.reduce((total, row) => total + row.counts.fordOasis, 0),
    warrantyCheckRecordCount: resourceRows.reduce((total, row) => total + row.counts.warrantyCheck, 0),
    managerDispositionRecordCount: managerDisposition.recordCount,
    managerSoldRecordCount: managerDisposition.soldRecordCount,
    managerDeliveredRecordCount: managerDisposition.deliveredRecordCount,
    managerDispositionReviewCount: managerDisposition.reviewRecordCount,
    ...activeMembership,
    vehicleCount: seen.size,
  }
}
