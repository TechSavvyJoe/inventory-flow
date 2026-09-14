import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildPublicChangeEvents, summarizePublicChangeEvents } from './public-change-events.mjs'
import { normalizePublicChangeCounts } from './public-change-counts.mjs'
import { canonicalExternalAutoCheckUrl, resourceProvenanceSha256 } from './resource-validation.mjs'
import {
  containsForeignOasisText,
  factoryCoverageType,
  factoryTermText,
  isFactoryCoverageRow,
  isOasisDate,
} from './oasis-coverage-grammar.mjs'
import { sanitizeManagerDispositionDocuments } from './manager-disposition-schema.mjs'
import { loadManagerDispositionOverlay } from './manager-disposition-overlay.mjs'

import { STORE_NAMES } from './constants.mjs'
export { STORE_NAMES } from './constants.mjs'

export const STORE_CONFIG = Object.freeze({
  Howell: {
    id: 'Howell',
    dealerMailCode: 'H',
    dealerMailId: '26',
    dealerOnLocationIds: ['21521'],
    websiteHost: 'www.bobmaxeyfordhowell.com',
  },
  Fowlerville: {
    id: 'Fowlerville',
    dealerMailCode: 'F',
    dealerMailId: '95',
    dealerOnLocationIds: ['23328'],
    websiteHost: 'www.bobmaxeyfordinfowlerville.com',
  },
  'Ford Detroit': {
    id: 'Ford Detroit',
    dealerMailCode: 'D',
    dealerMailId: '25',
    dealerOnLocationIds: ['21520'],
    websiteHost: 'www.bobmaxeyford.com',
  },
  Lincoln: {
    id: 'Lincoln',
    dealerMailCode: 'L',
    dealerMailId: '27',
    dealerOnLocationIds: ['21524', '21522'],
    websiteHost: 'www.bobmaxeylincoln.com',
  },
})

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/
const SOURCE_VIN_TOKEN_PATTERN = /^[A-Z0-9]{17}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MANIFEST_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/
const LEGACY_PHOTO_CACHE_SCHEMA = 'inventory-ops-photo-cache-v1'
const VEHICLE_RESOURCE_CACHE_SCHEMA = 'inventory-ops-vehicle-resource-cache-v2'
const VIN_DOCUMENT_ENRICHMENT_SCHEMA = 'inventory-flow-vin-document-enrichment-v1'
const SUPPORTED_PHOTO_CACHE_SCHEMAS = new Set([LEGACY_PHOTO_CACHE_SCHEMA, VEHICLE_RESOURCE_CACHE_SCHEMA])
const PHOTO_PATH_PATTERN = /^\/inventoryphotos\/.*\.(?:jpe?g|png|webp)$/i
const AUTOCHECK_PATH = '/autocheck.aspx'
const WINDOW_STICKER_PATH_PATTERN = /^\/api\/vhcliaa\/inventory\/[0-9]{1,8}\/window-sticker$/i
const CAI_FACTORY_EQUIPMENT_PATH_PATTERN =
  /^\/window-stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i
const PHOTO_ALLOWED_HOSTS = new Set(Object.values(STORE_CONFIG).map((store) => store.websiteHost))
const RESOURCE_DATA_STATES = new Set(['current', 'stale_unverified', 'incomplete'])
const FORD_OASIS_FIELD_SERVICE_ACTION_CODE_PATTERN = /^[0-9]{2}[A-Z][0-9]{2,3}$/
const WARRANTY_CHECK_COVERAGE_STATUSES = new Set(['ACTIVE', 'EXPIRED', 'N/A'])

export class SnapshotValidationError extends Error {
  constructor(message, details = undefined) {
    super(message)
    this.name = 'SnapshotValidationError'
    this.details = details
  }
}

function assertValid(condition, message, details = undefined) {
  if (!condition) {
    throw new SnapshotValidationError(message, details)
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertOnlyKeys(value, allowedKeys, label, details = undefined) {
  assertValid(isPlainObject(value), `${label} must be an object`, details)
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key))
  assertValid(unknownKeys.length === 0, `${label} contains unsupported fields`, {
    ...details,
    unknownKeys,
  })
}

function asInteger(value) {
  return Number.isInteger(value) ? value : Number.parseInt(String(value ?? ''), 10)
}

function normalizedVin(value) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizedStock(value) {
  return String(value ?? '').trim()
}

export function normalizeDealerMailSnapshotForImport(snapshot) {
  assertValid(isPlainObject(snapshot), 'DealerMail snapshot must be an object')
  const releasedHistory = snapshot.releasedHoldHistory
  if (!Array.isArray(releasedHistory) || !releasedHistory.some((history) => typeof history?.store === 'string')) {
    return snapshot
  }

  // The compatibility path must never share mutable nested evidence with the
  // parsed source object. The original file hash and bytes remain authoritative.
  const normalizedSnapshot = structuredClone(snapshot)
  const normalizedReleasedHistory = normalizedSnapshot.releasedHoldHistory
  const crmRows = normalizedSnapshot.completeDealerMailUsedInventory?.rows
  const storeMap = normalizedSnapshot.storeMap
  assertValid(Array.isArray(crmRows), 'Legacy released hold history requires complete CRM rows')
  assertValid(isPlainObject(storeMap), 'Legacy released hold history requires the snapshot store map')

  const crmRowsByVin = new Map()
  const crmRowsByStock = new Map()
  const heldVins = new Set(
    (Array.isArray(normalizedSnapshot.vehicles) ? normalizedSnapshot.vehicles : [])
      .map((vehicle) => normalizedVin(vehicle?.mainRow?.vin))
      .filter(Boolean),
  )
  for (const row of crmRows) {
    const vin = normalizedVin(row?.vin)
    const matches = crmRowsByVin.get(vin) ?? []
    matches.push(row)
    crmRowsByVin.set(vin, matches)
    const stock = normalizedStock(row?.stockNumber).toUpperCase()
    const stockMatches = crmRowsByStock.get(stock) ?? []
    stockMatches.push(row)
    crmRowsByStock.set(stock, stockMatches)
  }

  const normalizedHistory = normalizedReleasedHistory.map((history) => {
    if (typeof history?.store !== 'string') return history

    const legacyCode = history.store
    const vin = normalizedVin(history.vin)
    const historyStock = normalizedStock(history.stockNumber).toUpperCase()
    assertValid(
      !heldVins.has(vin),
      'Legacy released hold history VIN is still in the live held set',
      { vin },
    )
    const currentMatches = crmRowsByVin.get(vin) ?? []
    assertValid(
      currentMatches.length <= 1,
      'Legacy released hold history matches more than one current CRM VIN row',
      { vin },
    )
    const mappedStore = Object.hasOwn(storeMap, legacyCode) ? storeMap[legacyCode] : null
    assertValid(
      historyStock.length > 0,
      'Legacy released hold history stock is missing',
      { vin },
    )
    const currentCrm = currentMatches[0]
    const canonicalStoreName = currentCrm?.storeName ?? mappedStore?.storeName
    const canonicalStoreCode = currentCrm?.storeCode ?? legacyCode
    const storeConfig = STORE_CONFIG[canonicalStoreName]
    assertValid(
      isPlainObject(mappedStore) &&
        storeConfig &&
        canonicalStoreCode === legacyCode &&
        storeConfig.dealerMailCode === legacyCode &&
        mappedStore.storeName === canonicalStoreName &&
        String(mappedStore.storeId ?? '') === storeConfig.dealerMailId,
      'Legacy released hold history store code does not match current CRM and snapshot store-map evidence',
      { vin, legacyCode },
    )
    if (currentCrm) {
      assertValid(
        normalizedStock(currentCrm.stockNumber).toUpperCase() === historyStock,
        'Legacy released hold history VIN/stock does not match the current CRM row',
        { vin, historyStock },
      )
    } else {
      assertValid(
        (crmRowsByStock.get(historyStock) ?? []).length === 0,
        'Legacy released hold history stock is currently assigned to a different CRM VIN',
        { vin, historyStock },
      )
    }

    return {
      ...history,
      store: { name: canonicalStoreName, code: canonicalStoreCode },
    }
  })

  return {
    ...normalizedSnapshot,
    releasedHoldHistory: normalizedHistory,
  }
}

const COMPLETE_DEALERMAIL_STATUSES = new Set([
  'complete',
  'complete_authenticated_read_only',
])

export function hasCompletedManifestEvidence(manifest) {
  if (!isPlainObject(manifest) || manifest.complete !== true) return false
  if (manifest.public_inventory_status !== 'complete') return false
  if (!COMPLETE_DEALERMAIL_STATUSES.has(manifest.dealermail_status)) return false

  const validation = manifest.validation_results
  if (!isPlainObject(validation)) return false
  if (validation.passed === true) return true

  const desktopOpenedWithoutRepair =
    validation.desktop_excel_opened_without_repair === true ||
    validation.desktop_excel_opened_without_repair_prompt === true
  const readOnlyHashUnchanged =
    validation.read_only_validation_hash_unchanged === true ||
    validation.published_hash_unchanged_after_read_only_tests === true

  return (
    validation.public_sources_complete === true &&
    validation.dealermail_complete === true &&
    validation.workbook_validated === true &&
    desktopOpenedWithoutRepair &&
    asInteger(validation.formula_errors) === 0 &&
    readOnlyHashUnchanged &&
    validation.macro_free === true
  )
}

function dateInTimeZone(date, timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function ensureWithin(root, candidate, label) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  assertValid(
    relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative),
    `${label} must stay inside the reporting workspace`,
    { candidate: resolvedCandidate },
  )
  return resolvedCandidate
}

function parseJsonBuffer(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw new SnapshotValidationError(`${label} is not valid JSON`, { cause: error.message })
  }
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase()
}

export function readJsonWithHash(filePath, label = 'JSON file') {
  let buffer
  try {
    const stats = statSync(filePath)
    assertValid(stats.isFile(), `${label} path is not a file`, { filePath })
    buffer = readFileSync(filePath)
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error
    throw new SnapshotValidationError(`${label} could not be read`, {
      filePath,
      cause: error.message,
    })
  }

  return {
    data: parseJsonBuffer(buffer, label),
    sha256: sha256Buffer(buffer),
    bytes: buffer.byteLength,
  }
}

function photoCachePath(workspaceRoot, reportDate, publicSnapshotSha256) {
  return ensureWithin(
    workspaceRoot,
    path.join(
      workspaceRoot,
      'apps',
      'inventory-ops',
      'data',
      'photo-cache',
      `${reportDate}-${publicSnapshotSha256}.json`,
    ),
    'App photo cache',
  )
}

function vinDocumentEnrichmentPath(workspaceRoot) {
  return ensureWithin(
    workspaceRoot,
    path.join(workspaceRoot, 'apps', 'inventory-ops', 'data', 'vin-document-enrichment.json'),
    'VIN document enrichment',
  )
}

function canonicalPhotoUrl(value, vin) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const pathName = parsed.pathname.replace(/\/{2,}/g, '/')
  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathName)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    !PHOTO_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    !PHOTO_PATH_PATTERN.test(pathName) ||
    !pathName.toUpperCase().includes(`/${vin}/`) ||
    decodedPath.split('/').includes('..')
  ) {
    return null
  }
  return `https://${parsed.hostname.toLowerCase()}${pathName}`
}

function canonicalVehicleResourceUrl(value, vin, kind, publicRecord) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  let listing
  try {
    parsed = new URL(value)
    listing = new URL(String(publicRecord?.listing_url ?? ''))
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const pathName = parsed.pathname.replace(/\/{2,}/g, '/')
  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathName)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    listing.protocol !== 'https:' ||
    !PHOTO_ALLOWED_HOSTS.has(host) ||
    host !== listing.hostname.toLowerCase() ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    decodedPath.split('/').includes('..')
  ) {
    return null
  }
  const keys = [...parsed.searchParams.keys()]
  const hasExactly = (required) =>
    keys.length === required.length &&
    required.every(
      (key) => keys.filter((candidate) => candidate === key).length === 1 && Boolean(parsed.searchParams.get(key)?.trim()),
    )
  if (kind === 'autocheck') {
    if (pathName.toLowerCase() !== AUTOCHECK_PATH || !hasExactly(['sv', 'ac'])) return null
  } else if (kind === 'windowSticker') {
    const required = ['sv', 'make', 'vehicleType']
    const allowed = new Set([...required, 'dealerCode'])
    if (
      !WINDOW_STICKER_PATH_PATTERN.test(pathName) ||
      keys.some((key) => !allowed.has(key)) ||
      required.some(
        (key) => keys.filter((candidate) => candidate === key).length !== 1 || !parsed.searchParams.get(key)?.trim(),
      ) ||
      (keys.includes('dealerCode') && keys.filter((key) => key === 'dealerCode').length !== 1)
    ) {
      return null
    }
  } else {
    return null
  }
  parsed.protocol = 'https:'
  parsed.hostname = host
  parsed.pathname = pathName
  parsed.hash = ''
  return parsed.toString()
}

function optionalBoundedText(value, label, { max = 500 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  assertValid(typeof value === 'string', `${label} must be text`)
  const text = value.trim()
  assertValid(text.length > 0 && text.length <= max, `${label} is outside the safe text limit`)
  return text
}

function optionalBoundedNumber(value, label, { min = 0, max = 1_000_000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  assertValid(Number.isFinite(number) && number >= min && number <= max, `${label} is outside the safe numeric range`)
  return number
}

function optionalBoundedInteger(value, label, { min = 0, max = 1_000_000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  assertValid(Number.isInteger(value) && value >= min && value <= max, `${label} must be an integer within the safe range`)
  return value
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return undefined
  assertValid(typeof value === 'boolean', `${label} must be a boolean`)
  return value
}

function boundedStringArray(value, label, { limit = 120, itemMax = 500 } = {}) {
  if (value === undefined || value === null) return []
  assertValid(Array.isArray(value) && value.length <= limit, `${label} must be a bounded array`)
  const result = []
  const seen = new Set()
  for (const item of value) {
    const text = optionalBoundedText(item, `${label} item`, { max: itemMax })
    if (!text) continue
    const identity = text.toLowerCase()
    assertValid(!seen.has(identity), `${label} contains a duplicate item`)
    seen.add(identity)
    result.push(text)
  }
  return result
}

function validatedAutoCheckReport(value, vin, publicRecord) {
  if (value === undefined || value === null) return undefined
  assertValid(isPlainObject(value), 'AutoCheck cache record must be an object', { vin })
  assertValid(normalizedVin(value.validated_vin) === vin, 'AutoCheck cache record is not exact-VIN validated', { vin })
  const url = canonicalVehicleResourceUrl(value.url, vin, 'autocheck', publicRecord)
  assertValid(url, 'AutoCheck cache URL is unsafe or does not match the vehicle website', { vin })
  assertValid(['current', 'incomplete'].includes(value.dataState), 'AutoCheck cache data state is invalid', { vin })
  const checks = value.checks === undefined || value.checks === null ? [] : value.checks
  assertValid(Array.isArray(checks) && checks.length <= 20, 'AutoCheck checks must be a bounded array', { vin })
  const normalizedChecks = checks.map((check) => {
    assertValid(isPlainObject(check), 'AutoCheck check row must be an object', { vin })
    const label = optionalBoundedText(check.label, 'AutoCheck check label', { max: 120 })
    assertValid(label, 'AutoCheck check label is required', { vin })
    const row = { label }
    const status = optionalBoundedText(check.status, 'AutoCheck check status', { max: 160 })
    const detail = optionalBoundedText(check.detail, 'AutoCheck check detail', { max: 300 })
    if (status) row.status = status
    if (detail) row.detail = detail
    return row
  })
  const result = { url, dataState: value.dataState }
  const textFields = [
    ['reportRunAt', 80],
    ['usage', 80],
    ['lastReportedOdometerDate', 20],
    ['vehicleClass', 160],
    ['assemblyCountry', 120],
    ['estimatedInServiceDate', 20],
  ]
  for (const [key, max] of textFields) {
    const text = optionalBoundedText(value[key], `AutoCheck ${key}`, { max })
    if (text) result[key] = text
  }
  const numberFields = [
    ['score', 0, 100],
    ['scoreRangeLow', 0, 100],
    ['scoreRangeHigh', 0, 100],
    ['ownerCount', 0, 99],
    ['lastReportedOdometer', 0, 20_000_000],
  ]
  for (const [key, min, max] of numberFields) {
    const number = optionalBoundedNumber(value[key], `AutoCheck ${key}`, { min, max })
    if (number !== undefined) result[key] = number
  }
  if (normalizedChecks.length) result.checks = normalizedChecks
  return result
}

function validatedWindowSticker(value, vin, publicRecord) {
  if (value === undefined || value === null) return undefined
  assertValid(isPlainObject(value), 'Window-sticker cache record must be an object', { vin })
  assertValid(normalizedVin(value.validated_vin) === vin, 'Window-sticker cache record is not exact-VIN validated', { vin })
  const url = canonicalVehicleResourceUrl(value.url, vin, 'windowSticker', publicRecord)
  assertValid(url, 'Window-sticker cache URL is unsafe or does not match the vehicle website', { vin })
  assertValid(['current', 'incomplete'].includes(value.dataState), 'Window-sticker cache data state is invalid', { vin })
  const result = { url, dataState: value.dataState }
  const textFields = [
    ['vehicleDescription', 240],
    ['equipmentGroup', 160],
    ['exteriorColor', 160],
    ['interiorColor', 160],
    ['engine', 240],
    ['transmission', 240],
    ['originalMarket', 80],
    ['pricingCurrency', 3],
    ['pricingCurrencyEvidence', 500],
    ['failureReason', 300],
    ['sourceMessage', 500],
  ]
  for (const [key, max] of textFields) {
    const text = optionalBoundedText(value[key], `Window sticker ${key}`, { max })
    if (text) result[key] = text
  }
  for (const key of ['basePrice', 'totalOptions', 'destinationCharge', 'totalMsrp']) {
    const number = optionalBoundedNumber(value[key], `Window sticker ${key}`)
    if (number !== undefined) result[key] = number
  }
  const options = boundedStringArray(value.options, 'Window sticker options', { limit: 60 })
  const standardEquipment = boundedStringArray(value.standardEquipment, 'Window sticker standard equipment')
  const warranty = boundedStringArray(value.warranty, 'Window sticker warranty', { limit: 20 })
  if (options.length) result.options = options
  if (standardEquipment.length) result.standardEquipment = standardEquipment
  if (warranty.length) result.warranty = warranty
  return result
}

function optionalIsoTimestamp(value, label) {
  const text = optionalBoundedText(value, label, { max: 64 })
  if (!text) return undefined
  assertValid(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text) &&
      Number.isFinite(Date.parse(text)),
    `${label} must be an ISO timestamp with an explicit timezone`,
  )
  return text
}

function canonicalCaiFactoryEquipmentUrl(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const pathName = parsed.pathname.replace(/\/{2,}/g, '/')
  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathName)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'assets.cai-media-management.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !CAI_FACTORY_EQUIPMENT_PATH_PATTERN.test(pathName) ||
    decodedPath.split('/').includes('..')
  ) {
    return null
  }
  return `https://assets.cai-media-management.com${pathName}`
}

function validatedFactoryEquipment(value, vin) {
  assertOnlyKeys(
    value,
    new Set([
      'dataState',
      'url',
      'sourceLabel',
      'capturedAt',
      'vehicleDescription',
      'basePrice',
      'totalOptions',
      'destinationCharge',
      'totalMsrp',
      'exteriorColor',
      'interiorColor',
      'engine',
      'transmission',
      'drivetrain',
      'packages',
      'sections',
      'disclaimer',
      'isOriginalWindowSticker',
    ]),
    'Factory-equipment record',
    { vin },
  )
  assertValid(RESOURCE_DATA_STATES.has(value.dataState), 'Factory-equipment data state is invalid', { vin })
  assertValid(
    value.isOriginalWindowSticker === false,
    'Factory-equipment record must explicitly state that it is not an original window sticker',
    { vin },
  )
  const result = { dataState: value.dataState, isOriginalWindowSticker: false }
  const url = canonicalCaiFactoryEquipmentUrl(value.url)
  assertValid(url !== null, 'Factory-equipment URL is not an approved vAuto/CAI image URL', { vin })
  if (url) result.url = url

  const textFields = [
    ['sourceLabel', 160],
    ['vehicleDescription', 320],
    ['exteriorColor', 200],
    ['interiorColor', 200],
    ['engine', 240],
    ['transmission', 240],
    ['drivetrain', 160],
  ]
  for (const [key, max] of textFields) {
    const text = optionalBoundedText(value[key], `Factory-equipment ${key}`, { max })
    if (text) result[key] = text
  }
  const capturedAt = optionalIsoTimestamp(value.capturedAt, 'Factory-equipment capturedAt')
  if (capturedAt) result.capturedAt = capturedAt
  for (const key of ['basePrice', 'totalOptions', 'destinationCharge', 'totalMsrp']) {
    const number = optionalBoundedNumber(value[key], `Factory-equipment ${key}`, { max: 2_000_000 })
    if (number !== undefined) result[key] = number
  }

  const packages = value.packages ?? []
  assertValid(Array.isArray(packages) && packages.length <= 80, 'Factory-equipment packages must be a bounded array', {
    vin,
  })
  const packageNames = new Set()
  result.packages = packages.map((entry) => {
    assertOnlyKeys(entry, new Set(['name', 'code', 'price', 'features']), 'Factory-equipment package', { vin })
    const name = optionalBoundedText(entry.name, 'Factory-equipment package name', { max: 240 })
    assertValid(name, 'Factory-equipment package name is required', { vin })
    const identity = name.toLowerCase()
    assertValid(!packageNames.has(identity), 'Factory-equipment packages contain a duplicate name', { vin, name })
    packageNames.add(identity)
    const row = { name }
    const code = optionalBoundedText(entry.code, 'Factory-equipment package code', { max: 80 })
    const price = optionalBoundedNumber(entry.price, 'Factory-equipment package price', { max: 2_000_000 })
    const features = boundedStringArray(entry.features, 'Factory-equipment package features', {
      limit: 120,
      itemMax: 300,
    })
    if (code) row.code = code
    if (price !== undefined) row.price = price
    if (features.length) row.features = features
    return row
  })

  const sections = value.sections ?? []
  assertValid(Array.isArray(sections) && sections.length <= 40, 'Factory-equipment sections must be a bounded array', {
    vin,
  })
  let sectionItemCount = 0
  const sectionNames = new Set()
  result.sections = sections.map((section) => {
    assertOnlyKeys(section, new Set(['name', 'items']), 'Factory-equipment section', { vin })
    const name = optionalBoundedText(section.name, 'Factory-equipment section name', { max: 200 })
    assertValid(name, 'Factory-equipment section name is required', { vin })
    const identity = name.toLowerCase()
    assertValid(!sectionNames.has(identity), 'Factory-equipment sections contain a duplicate name', { vin, name })
    sectionNames.add(identity)
    assertValid(
      Array.isArray(section.items) && section.items.length > 0 && section.items.length <= 150,
      'Factory-equipment section items must be a non-empty bounded array',
      { vin, name },
    )
    sectionItemCount += section.items.length
    assertValid(sectionItemCount <= 800, 'Factory-equipment file contains too many section items', { vin })
    const items = section.items.map((item) => {
      assertOnlyKeys(item, new Set(['label', 'price']), 'Factory-equipment section item', { vin, section: name })
      const label = optionalBoundedText(item.label, 'Factory-equipment section item label', { max: 700 })
      assertValid(label, 'Factory-equipment section item label is required', { vin, section: name })
      const row = { label }
      const price = optionalBoundedNumber(item.price, 'Factory-equipment section item price', { max: 2_000_000 })
      if (price !== undefined) row.price = price
      return row
    })
    return { name, items }
  })

  const disclaimer = optionalBoundedText(value.disclaimer, 'Factory-equipment disclaimer', { max: 5_000 })
  assertValid(disclaimer, 'Factory-equipment disclaimer is required', { vin })
  result.disclaimer = disclaimer
  return result
}

function validatedExternalAutoCheck(value, vin) {
  assertOnlyKeys(
    value,
    new Set([
      'validatedVin',
      'dataState',
      'url',
      'sourceLabel',
      'capturedAt',
      'reportRunAt',
      'score',
      'scoreRangeLow',
      'scoreRangeHigh',
      'usage',
      'ownerCount',
      'lastReportedOdometer',
      'lastReportedOdometerDate',
      'vehicleClass',
      'assemblyCountry',
      'estimatedInServiceDate',
      'checks',
    ]),
    'External AutoCheck record',
    { vin },
  )
  assertValid(normalizedVin(value.validatedVin) === vin, 'External AutoCheck record is not exact-VIN validated', {
    vin,
  })
  assertValid(RESOURCE_DATA_STATES.has(value.dataState), 'External AutoCheck data state is invalid', { vin })
  const url = canonicalExternalAutoCheckUrl(value.url, vin)
  assertValid(url, 'External AutoCheck URL is not on an approved official host and exact-VIN route', { vin })
  const result = { url, dataState: value.dataState }
  const sourceLabel = optionalBoundedText(value.sourceLabel, 'External AutoCheck source label', { max: 160 })
  const capturedAt = optionalIsoTimestamp(value.capturedAt, 'External AutoCheck capturedAt')
  if (sourceLabel) result.sourceLabel = sourceLabel
  if (capturedAt) result.capturedAt = capturedAt
  const textFields = [
    ['reportRunAt', 80],
    ['usage', 80],
    ['lastReportedOdometerDate', 20],
    ['vehicleClass', 160],
    ['assemblyCountry', 120],
    ['estimatedInServiceDate', 20],
  ]
  for (const [key, max] of textFields) {
    const text = optionalBoundedText(value[key], `External AutoCheck ${key}`, { max })
    if (text) result[key] = text
  }
  const numberFields = [
    ['score', 0, 100],
    ['scoreRangeLow', 0, 100],
    ['scoreRangeHigh', 0, 100],
    ['ownerCount', 0, 99],
    ['lastReportedOdometer', 0, 20_000_000],
  ]
  for (const [key, min, max] of numberFields) {
    const number = optionalBoundedNumber(value[key], `External AutoCheck ${key}`, { min, max })
    if (number !== undefined) result[key] = number
  }
  const checks = value.checks ?? []
  assertValid(Array.isArray(checks) && checks.length <= 40, 'External AutoCheck checks must be a bounded array', { vin })
  if (checks.length) {
    result.checks = checks.map((check) => {
      assertOnlyKeys(check, new Set(['label', 'status', 'detail']), 'External AutoCheck check', { vin })
      const label = optionalBoundedText(check.label, 'External AutoCheck check label', { max: 160 })
      assertValid(label, 'External AutoCheck check label is required', { vin })
      const row = { label }
      const status = optionalBoundedText(check.status, 'External AutoCheck check status', { max: 200 })
      const detail = optionalBoundedText(check.detail, 'External AutoCheck check detail', { max: 500 })
      if (status) row.status = status
      if (detail) row.detail = detail
      return row
    })
  }
  return result
}

/**
 * Ford OASIS vehicle report facts captured read-only from FMCDealer for an
 * exact VIN. Dates stay exactly as OASIS prints them. The capture never
 * includes prior-owner names, and no such field is accepted here.
 */
function validatedFordOasis(value, vin) {
  assertOnlyKeys(
    value,
    new Set([
      'dataState',
      'capturedAt',
      'sourceLabel',
      'vehicleDescription',
      'versionSeries',
      'buildDate',
      'warrantyStartDate',
      'releaseDate',
      'monthsInService',
      'saleMileage',
      'openFieldServiceActions',
      'warrantyCoverages',
      'extendedCoverageExpirations',
    ]),
    'Ford OASIS record',
    { vin },
  )
  assertValid(RESOURCE_DATA_STATES.has(value.dataState), 'Ford OASIS data state is invalid', { vin })
  const capturedAt = optionalIsoTimestamp(value.capturedAt, 'Ford OASIS capturedAt')
  assertValid(capturedAt, 'Ford OASIS capturedAt is required', { vin })
  const result = { dataState: value.dataState, capturedAt }

  const textFields = [
    ['sourceLabel', 160],
    ['vehicleDescription', 160],
    ['versionSeries', 120],
    ['buildDate', 40],
    ['warrantyStartDate', 40],
    ['releaseDate', 40],
  ]
  for (const [key, max] of textFields) {
    const text = optionalBoundedText(value[key], `Ford OASIS ${key}`, { max })
    if (text && ['buildDate', 'warrantyStartDate', 'releaseDate'].includes(key)) {
      assertValid(isOasisDate(text), `Ford OASIS ${key} is not a recognized OASIS date`, { vin })
    }
    if (text && key === 'vehicleDescription') {
      assertValid(!containsForeignOasisText(text), 'Ford OASIS vehicleDescription contains non-vehicle material', { vin })
    }
    if (text) result[key] = text
  }
  const integerFields = [
    ['monthsInService', 0, 600],
    ['saleMileage', 0, 999_999],
  ]
  for (const [key, min, max] of integerFields) {
    const number = optionalBoundedInteger(value[key], `Ford OASIS ${key}`, { min, max })
    if (number !== undefined) result[key] = number
  }

  const actions = value.openFieldServiceActions ?? []
  assertValid(
    Array.isArray(actions) && actions.length <= 60,
    'Ford OASIS open field service actions must be a bounded array',
    { vin },
  )
  const actionCodes = new Set()
  result.openFieldServiceActions = actions.map((action) => {
    assertOnlyKeys(action, new Set(['code', 'description']), 'Ford OASIS field service action', { vin })
    const code = optionalBoundedText(action.code, 'Ford OASIS field service action code', { max: 20 })
    assertValid(
      code && FORD_OASIS_FIELD_SERVICE_ACTION_CODE_PATTERN.test(code),
      'Ford OASIS field service action code is not a valid FSA code',
      { vin },
    )
    assertValid(!actionCodes.has(code), 'Ford OASIS field service actions contain a duplicate code', { vin, code })
    actionCodes.add(code)
    const row = { code }
    const description = optionalBoundedText(action.description, 'Ford OASIS field service action description', {
      max: 300,
    })
    assertValid(!description || !containsForeignOasisText(description), 'Ford OASIS field service action description contains non-FSA material', { vin, code })
    if (description) row.description = description
    return row
  })

  const coverages = value.warrantyCoverages ?? []
  assertValid(
    Array.isArray(coverages) && coverages.length <= 20,
    'Ford OASIS warranty coverages must be a bounded array',
    { vin },
  )
  result.warrantyCoverages = coverages.map((coverage) => {
    assertOnlyKeys(coverage, new Set(['type', 'description']), 'Ford OASIS warranty coverage', { vin })
    const type = optionalBoundedText(coverage.type, 'Ford OASIS warranty coverage type', { max: 120 })
    assertValid(type && factoryCoverageType(type), 'Ford OASIS warranty coverage type is not a recognized factory coverage', { vin })
    const row = { type }
    const description = optionalBoundedText(coverage.description, 'Ford OASIS warranty coverage description', {
      max: 300,
    })
    assertValid(!description || factoryTermText(description) === description, 'Ford OASIS warranty coverage description is not a factory term', { vin, type })
    if (description) row.description = description
    return row
  })

  const expirations = value.extendedCoverageExpirations ?? []
  assertValid(
    Array.isArray(expirations) && expirations.length <= 10,
    'Ford OASIS extended coverage expirations must be a bounded array',
    { vin },
  )
  result.extendedCoverageExpirations = expirations.map((item) => {
    const text = optionalBoundedText(item, 'Ford OASIS extended coverage expiration', { max: 40 })
    assertValid(text && isOasisDate(text), 'Ford OASIS extended coverage expiration is not a recognized OASIS date', { vin })
    return text
  })
  return result
}

const WARRANTY_STATUSES = new Set(['ACTIVE', 'EXPIRED', 'N/A'])

/**
 * One warranty coverage row. Term text is carried through exactly as the source
 * prints it; the remaining figures are computed against the vehicle's own
 * odometer and age, and the computed numbers travel with the text that states them.
 */
function validatedWarrantyCoverage(value, vin, label, seen, {
  termTextMax,
  allowUnlimitedMonths,
  requireFactoryGrammar = false,
}) {
  const allowedKeys = new Set([
    'type',
    'termText',
    'termMonths',
    'termMiles',
    'unlimitedMiles',
    'remainingMiles',
    'remainingMonths',
    'remainingMilesText',
    'remainingTimeText',
    'status',
    'note',
  ])
  if (allowUnlimitedMonths) allowedKeys.add('unlimitedMonths')
  assertOnlyKeys(
    value,
    allowedKeys,
    `${label} coverage`,
    { vin },
  )
  const type = optionalBoundedText(value.type, `${label} coverage type`, { max: 60 })
  assertValid(type, `${label} coverage type is required`, { vin })
  const identity = type.toLowerCase()
  assertValid(!seen.has(identity), `${label} coverages contain a duplicate type`, { vin, type })
  seen.add(identity)

  const termText = optionalBoundedText(value.termText, `${label} coverage term`, { max: termTextMax })
  assertValid(termText, `${label} coverage term is required`, { vin, type })
  if (requireFactoryGrammar) {
    assertValid(isFactoryCoverageRow(type, termText), `${label} coverage is not a recognized factory coverage term`, { vin, type })
    assertValid(factoryTermText(termText) === termText, `${label} coverage term is not canonical factory text`, { vin, type })
  }
  const remainingMilesText = optionalBoundedText(value.remainingMilesText, `${label} remaining miles text`, { max: 40 })
  assertValid(remainingMilesText, `${label} remaining miles text is required`, { vin, type })
  const remainingTimeText = optionalBoundedText(value.remainingTimeText, `${label} remaining time text`, { max: 40 })
  assertValid(remainingTimeText, `${label} remaining time text is required`, { vin, type })
  assertValid(WARRANTY_STATUSES.has(value.status), `${label} coverage status is invalid`, { vin, type })

  const row = { type, termText, remainingMilesText, remainingTimeText, status: value.status }
  for (const [key, min, max] of [
    ['termMonths', 0, 600],
    ['termMiles', 0, 999_999],
    ['remainingMonths', 0, 600],
    ['remainingMiles', 0, 999_999],
  ]) {
    const number = optionalBoundedInteger(value[key], `${label} coverage ${key}`, { min, max })
    if (number !== undefined) row[key] = number
  }
  for (const key of ['unlimitedMiles', ...(allowUnlimitedMonths ? ['unlimitedMonths'] : [])]) {
    if (value[key] === undefined || value[key] === null) continue
    assertValid(typeof value[key] === 'boolean', `${label} coverage ${key} must be a boolean`, { vin, type })
    if (value[key]) row[key] = true
  }
  const note = optionalBoundedText(value.note, `${label} coverage note`, { max: 160 })
  if (note) row.note = note
  return row
}

/**
 * Remaining factory warranty for one VIN, figured at that vehicle's own listed
 * odometer. Two independent read-only sources may be present:
 *   fordOasis  - Ford/Lincoln only, the manufacturer's own record (authoritative)
 *   autoCheck  - Experian's estimate, available for every make
 * At least one must be present. No owner or customer field exists in either
 * block and none is accepted here.
 */
function validatedWarrantyCheck(value, vin) {
  assertOnlyKeys(
    value,
    new Set(['dataState', 'capturedAt', 'sourceLabel', 'mileageEntered', 'mileageSource', 'autoCheck', 'fordOasis']),
    'Warranty check record',
    { vin },
  )
  assertValid(RESOURCE_DATA_STATES.has(value.dataState), 'Warranty check data state is invalid', { vin })
  const capturedAt = optionalIsoTimestamp(value.capturedAt, 'Warranty check capturedAt')
  assertValid(capturedAt, 'Warranty check capturedAt is required', { vin })
  const sourceLabel = optionalBoundedText(value.sourceLabel, 'Warranty check sourceLabel', { max: 160 })
  assertValid(sourceLabel, 'Warranty check sourceLabel is required', { vin })
  assertValid(!/\bUNVERIFIED\b|DO NOT QUOTE|OASIS (?:WAS )?UNAVAILABLE/i.test(sourceLabel), 'Warranty check sourceLabel marks the record as unverified', { vin })
  const mileageEntered = optionalBoundedInteger(value.mileageEntered, 'Warranty check mileageEntered', {
    min: 0,
    max: 999_999,
  })
  assertValid(mileageEntered !== undefined, 'Warranty check mileageEntered is required', { vin })

  const result = { dataState: value.dataState, capturedAt, sourceLabel, mileageEntered }
  const mileageSource = optionalBoundedText(value.mileageSource, 'Warranty check mileageSource', { max: 80 })
  if (mileageSource) result.mileageSource = mileageSource

  if (value.autoCheck !== undefined && value.autoCheck !== null) {
    const block = value.autoCheck
    assertOnlyKeys(
      block,
      new Set(['inServiceDate', 'inServiceAgeMonths', 'defaultMileage', 'coverages']),
      'Warranty check AutoCheck block',
      { vin },
    )
    const rows = block.coverages ?? []
    assertValid(
      Array.isArray(rows) && rows.length > 0 && rows.length <= 12,
      'Warranty check AutoCheck coverages must be a non-empty bounded array',
      { vin },
    )
    const seen = new Set()
    const out = {
      coverages: rows.map((row) => validatedWarrantyCoverage(row, vin, 'Warranty check AutoCheck', seen, {
        termTextMax: 80,
        allowUnlimitedMonths: true,
      })),
    }
    const inServiceDate = optionalBoundedText(block.inServiceDate, 'Warranty check AutoCheck inServiceDate', { max: 40 })
    if (inServiceDate) out.inServiceDate = inServiceDate
    for (const [key, min, max] of [
      ['inServiceAgeMonths', 0, 600],
      ['defaultMileage', 0, 999_999],
    ]) {
      const number = optionalBoundedInteger(block[key], `Warranty check AutoCheck ${key}`, { min, max })
      if (number !== undefined) out[key] = number
    }
    result.autoCheck = out
  }

  if (value.fordOasis !== undefined && value.fordOasis !== null) {
    const block = value.fordOasis
    assertOnlyKeys(block, new Set(['warrantyStartDate', 'monthsInService', 'coverages']), 'Warranty check OASIS block', {
      vin,
    })
    const warrantyStartDate = optionalBoundedText(block.warrantyStartDate, 'Warranty check OASIS warrantyStartDate', {
      max: 40,
    })
    assertValid(warrantyStartDate, 'Warranty check OASIS warrantyStartDate is required', { vin })
    assertValid(isOasisDate(warrantyStartDate), 'Warranty check OASIS warrantyStartDate is not a recognized OASIS date', { vin })
    const monthsInService = optionalBoundedInteger(block.monthsInService, 'Warranty check OASIS monthsInService', {
      min: 0,
      max: 600,
    })
    assertValid(monthsInService !== undefined, 'Warranty check OASIS monthsInService is required', { vin })
    const rows = block.coverages ?? []
    assertValid(
      Array.isArray(rows) && rows.length > 0 && rows.length <= 12,
      'Warranty check OASIS coverages must be a non-empty bounded array',
      { vin },
    )
    const seen = new Set()
    result.fordOasis = {
      warrantyStartDate,
      monthsInService,
      coverages: rows.map((row) => validatedWarrantyCoverage(row, vin, 'Warranty check OASIS', seen, {
        termTextMax: 120,
        allowUnlimitedMonths: false,
        requireFactoryGrammar: true,
      })),
    }
  }

  assertValid(result.autoCheck || result.fordOasis, 'Warranty check record carries no warranty source', { vin })
  return result
}

function validateVinDocumentEnrichmentInternal(value, {
  degradeOptionalResources = false,
  onResourceRejected = () => {},
} = {}) {
  assertOnlyKeys(
    value,
    new Set(['schemaVersion', 'generatedAt', 'recordsByVin']),
    'VIN document enrichment file',
  )
  assertValid(value.schemaVersion === VIN_DOCUMENT_ENRICHMENT_SCHEMA, 'VIN document enrichment schema is unsupported')
  const generatedAt = optionalIsoTimestamp(value.generatedAt, 'VIN document enrichment generatedAt')
  assertValid(isPlainObject(value.recordsByVin), 'VIN document enrichment recordsByVin is missing')
  const entries = Object.entries(value.recordsByVin)
  assertValid(entries.length <= 2_000, 'VIN document enrichment contains too many vehicle records')
  const recordsByVin = {}
  let factoryEquipmentCount = 0
  let externalAutoCheckCount = 0
  let fordOasisCount = 0
  let warrantyCheckCount = 0
  for (const [rawVin, record] of entries) {
    const vin = normalizedVin(rawVin)
    assertValid(VIN_PATTERN.test(vin) && rawVin === vin, 'VIN document enrichment key is not a canonical VIN', {
      rawVin,
    })
    assertOnlyKeys(
      record,
      new Set(['vin', 'factoryEquipment', 'autoCheckReport', 'fordOasis', 'warrantyCheck']),
      'VIN document enrichment record',
      { vin },
    )
    assertValid(normalizedVin(record.vin) === vin && record.vin === vin, 'VIN document enrichment record VIN does not match its key', {
      vin,
    })
    const factoryEquipment =
      record.factoryEquipment === undefined || record.factoryEquipment === null
        ? undefined
        : validatedFactoryEquipment(record.factoryEquipment, vin)
    const autoCheckReport =
      record.autoCheckReport === undefined || record.autoCheckReport === null
        ? undefined
        : validatedExternalAutoCheck(record.autoCheckReport, vin)
    let fordOasis
    let warrantyCheck
    let rejectedOptionalResource = false
    if (record.fordOasis !== undefined && record.fordOasis !== null) {
      try {
        fordOasis = validatedFordOasis(record.fordOasis, vin)
      } catch (error) {
        if (!degradeOptionalResources) throw error
        rejectedOptionalResource = true
        onResourceRejected({ vin, channel: 'fordOasis', reason: String(error?.message ?? error).slice(0, 240) })
      }
    }
    if (record.warrantyCheck !== undefined && record.warrantyCheck !== null) {
      try {
        warrantyCheck = validatedWarrantyCheck(record.warrantyCheck, vin)
      } catch (error) {
        if (!degradeOptionalResources) throw error
        rejectedOptionalResource = true
        onResourceRejected({ vin, channel: 'warrantyCheck', reason: String(error?.message ?? error).slice(0, 240) })
      }
    }
    if (degradeOptionalResources && rejectedOptionalResource && !(factoryEquipment || autoCheckReport || fordOasis || warrantyCheck)) {
      continue
    }
    assertValid(
      factoryEquipment || autoCheckReport || fordOasis || warrantyCheck,
      'VIN document enrichment record contains no usable resource',
      { vin },
    )
    if (factoryEquipment) factoryEquipmentCount += 1
    if (autoCheckReport) externalAutoCheckCount += 1
    if (fordOasis) fordOasisCount += 1
    if (warrantyCheck) warrantyCheckCount += 1
    recordsByVin[vin] = {
      vin,
      ...(factoryEquipment ? { factoryEquipment } : {}),
      ...(autoCheckReport ? { autoCheckReport } : {}),
      ...(fordOasis ? { fordOasis } : {}),
      ...(warrantyCheck ? { warrantyCheck } : {}),
    }
  }
  return {
    recordsByVin,
    metadata: {
      status: 'matched',
      generatedAt: generatedAt ?? null,
      recordCount: entries.length,
      factoryEquipmentCount,
      externalAutoCheckCount,
      // Emit fordOasisCount only when the Ford OASIS channel is actually in use.
      // A release with zero OASIS records stays byte-compatible with a Worker that
      // predates the channel (its metadata allow-list has no fordOasisCount key),
      // so the daily publish keeps working before the OASIS-aware Worker is deployed.
      ...(fordOasisCount > 0 ? { fordOasisCount } : {}),
      // Same backward-compatibility rule for the warranty check channel.
      ...(warrantyCheckCount > 0 ? { warrantyCheckCount } : {}),
    },
  }
}

// Direct callers keep the strict validator for diagnostics and tests. The
// publication importer may drop only the two newly introduced optional Ford
// channels per VIN, preserving older factory-equipment/AutoCheck evidence and
// surfacing an explicit release warning instead of losing the whole release.
export function validateVinDocumentEnrichment(value) {
  return validateVinDocumentEnrichmentInternal(value)
}

export function validateVinDocumentEnrichmentForPublish(value, { onResourceRejected } = {}) {
  return validateVinDocumentEnrichmentInternal(value, {
    degradeOptionalResources: true,
    onResourceRejected,
  })
}

export function mergeVerifiedPhotoCache({ recordsByVin, cache, reportDate, publicSnapshotSha256 }) {
  assertValid(isPlainObject(cache), 'App photo cache must be an object')
  assertValid(SUPPORTED_PHOTO_CACHE_SCHEMAS.has(cache.schema_version), 'App photo cache schema is unsupported')
  assertValid(cache.report_date === reportDate, 'App photo cache report date does not match the public release')
  assertValid(
    cache.public_snapshot_sha256 === publicSnapshotSha256,
    'App photo cache source hash does not match the public snapshot',
  )
  assertValid(isPlainObject(cache.vehicles), 'App photo cache vehicles are missing')
  const entries = Object.entries(cache.vehicles)
  assertValid(
    asInteger(cache.summary?.public_vehicles) === Object.keys(recordsByVin).length,
    'App photo cache public vehicle count does not match the public snapshot',
  )
  if (cache.schema_version === LEGACY_PHOTO_CACHE_SCHEMA) {
    assertValid(
      asInteger(cache.summary?.vehicles_with_photos) === entries.length,
      'App photo cache photo vehicle count does not reconcile',
    )
  } else {
    assertValid(
      asInteger(cache.summary?.vehicles_with_resources) === entries.length,
      'App vehicle resource count does not reconcile',
    )
  }

  const merged = { ...recordsByVin }
  let totalUrls = 0
  let vehiclesWithPhotos = 0
  let vehiclesWithAutoCheck = 0
  let vehiclesWithWindowSticker = 0
  for (const [key, entry] of entries) {
    assertValid(isPlainObject(entry), 'App photo cache vehicle row is invalid', { key })
    const vin = normalizedVin(entry.vin)
    assertValid(VIN_PATTERN.test(vin) && normalizedVin(key) === vin, 'App photo cache VIN is invalid', { key })
    const publicRecord = recordsByVin[vin]
    assertValid(publicRecord, 'App photo cache contains a VIN outside the bound public snapshot', { vin })
    assertValid(
      String(entry.listing_url ?? '') === String(publicRecord.listing_url ?? ''),
      'App photo cache listing URL does not match the bound public vehicle',
      { vin },
    )
    assertValid(Array.isArray(entry.photo_urls), 'App photo cache photo_urls must be an array', { vin })
    assertValid(entry.photo_urls.length <= 100, 'App photo cache contains too many photos for one VIN', { vin })
    const urls = []
    const seen = new Set()
    for (const raw of entry.photo_urls) {
      const url = canonicalPhotoUrl(raw, vin)
      assertValid(url, 'App photo cache contains an unsafe or mismatched photo URL', { vin })
      const identity = url.toLowerCase()
      assertValid(!seen.has(identity), 'App photo cache contains a duplicate photo URL', { vin })
      seen.add(identity)
      urls.push(url)
    }
    const preview = entry.photo_preview_url ? canonicalPhotoUrl(entry.photo_preview_url, vin) : null
    assertValid(!entry.photo_preview_url || preview, 'App photo cache preview URL is unsafe or mismatched', { vin })
    const autoCheckReport =
      cache.schema_version === VEHICLE_RESOURCE_CACHE_SCHEMA
        ? validatedAutoCheckReport(entry.autoCheckReport, vin, publicRecord)
        : undefined
    const windowSticker =
      cache.schema_version === VEHICLE_RESOURCE_CACHE_SCHEMA
        ? validatedWindowSticker(entry.windowSticker, vin, publicRecord)
        : undefined
    assertValid(
      urls.length > 0 || preview || autoCheckReport || windowSticker,
      'App vehicle resource row contains no usable resources',
      { vin },
    )
    totalUrls += urls.length
    if (urls.length > 0 || preview) vehiclesWithPhotos += 1
    if (autoCheckReport) vehiclesWithAutoCheck += 1
    if (windowSticker) vehiclesWithWindowSticker += 1
    merged[vin] = {
      ...publicRecord,
      photo_urls: urls,
      photo_preview_url: preview || '',
      photo_url_source: 'Verified app photo cache — official VDP',
      ...(autoCheckReport ? { autoCheckReport } : {}),
      ...(windowSticker ? { windowSticker } : {}),
    }
  }
  assertValid(asInteger(cache.summary?.photo_urls) === totalUrls, 'App photo cache URL total does not reconcile')
  assertValid(
    asInteger(cache.summary?.vehicles_with_photos) === vehiclesWithPhotos,
    'App photo cache vehicle total does not reconcile',
  )
  if (cache.schema_version === VEHICLE_RESOURCE_CACHE_SCHEMA) {
    assertValid(
      asInteger(cache.summary?.vehicles_with_autocheck) === vehiclesWithAutoCheck,
      'AutoCheck resource total does not reconcile',
    )
    assertValid(
      asInteger(cache.summary?.vehicles_with_window_sticker) === vehiclesWithWindowSticker,
      'Window-sticker resource total does not reconcile',
    )
  }
  return {
    recordsByVin: merged,
    metadata: {
      status: 'matched',
      reportDate,
      publicSnapshotSha256,
      schemaVersion: cache.schema_version,
      vehiclesWithResources: entries.length,
      vehiclesWithPhotos,
      photoUrls: totalUrls,
      vehiclesWithAutoCheck,
      vehiclesWithWindowSticker,
      generatedAt: String(cache.generated_at ?? ''),
    },
  }
}

export function findLatestCompletedManifest(workspaceRoot) {
  const manifestsDirectory = path.join(workspaceRoot, 'work', 'run-status')
  let candidates
  try {
    candidates = readdirSync(manifestsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MANIFEST_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
  } catch (error) {
    throw new SnapshotValidationError('Run-status directory could not be read', {
      manifestsDirectory,
      cause: error.message,
    })
  }

  for (const name of candidates) {
    const manifestPath = path.join(manifestsDirectory, name)
    const { data } = readJsonWithHash(manifestPath, 'Run manifest')
    if (data?.complete === true) {
      return { manifestPath, manifest: data }
    }
  }

  throw new SnapshotValidationError('No completed dated run manifest was found', {
    manifestsDirectory,
  })
}

function findAuditedPublicBaseline(workspaceRoot, reportDate, { publicPath, publicFile, manifest } = {}) {
  if (!publicPath || !publicFile) return null
  let auditPath
  try {
    auditPath = ensureWithin(
      workspaceRoot,
      manifest?.public_audit_path
        ? path.resolve(workspaceRoot, manifest.public_audit_path)
        : path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots', `${reportDate}-public-audit.json`),
      'Public change audit',
    )
  } catch {
    return { warning: 'The public change audit path is outside this workspace; VIN-level daily changes were withheld.' }
  }
  if (!existsSync(auditPath)) {
    return manifest?.public_audit_path
      ? { warning: 'The manifest-referenced public change audit is unavailable; VIN-level daily changes were withheld.' }
      : null
  }
  try {
    const auditFile = readJsonWithHash(auditPath, 'Public change audit')
    const audit = auditFile.data
    if (manifest?.public_snapshot_sha256) {
      assertValid(String(manifest.public_snapshot_sha256).toLowerCase() === publicFile.sha256.toLowerCase(), 'Current public snapshot checksum differs from its manifest')
    }
    assertValid(audit.passed === true && audit.report_date === reportDate, 'Public change audit is not passed for this report')
    assertValid(audit.checks?.independent_change_reconciliation === true, 'Public change audit lacks independent reconciliation')
    assertValid(String(audit.snapshot_sha256 ?? '').toLowerCase() === publicFile.sha256.toLowerCase(), 'Public change audit does not match the current snapshot checksum')
    assertValid(/^[A-Fa-f0-9]{64}$/.test(String(audit.prior_sha256 ?? '')), 'Public change audit has no valid prior checksum')
    if (manifest?.public_audit_sha256) {
      assertValid(auditFile.sha256.toLowerCase() === String(manifest.public_audit_sha256).toLowerCase(), 'Public change audit checksum differs from the manifest')
    }
    const snapshotsDirectory = path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots')
    const candidates = new Set()
    if (typeof audit.prior_snapshot === 'string') {
      try { candidates.add(ensureWithin(workspaceRoot, path.resolve(workspaceRoot, audit.prior_snapshot), 'Audited prior snapshot')) } catch { /* Never read outside the workspace. */ }
    }
    for (const entry of readdirSync(snapshotsDirectory, { withFileTypes: true })) {
      if (entry.isFile() && /^\d{4}-\d{2}-\d{2}(?:[^/\\]*)\.json$/.test(entry.name) && entry.name.slice(0, 10) < reportDate) {
        candidates.add(path.join(snapshotsDirectory, entry.name))
      }
    }
    for (const snapshotPath of candidates) {
      try {
        const file = readJsonWithHash(snapshotPath, 'Audited prior public snapshot')
        if (file.sha256.toLowerCase() !== audit.prior_sha256.toLowerCase()) continue
        const validated = validatePublicSnapshot(file.data)
        assertValid(validated.reportDate < reportDate, 'Audited prior snapshot must precede this report')
        return { snapshotPath, file, evidence: { auditPath, auditSha256: auditFile.sha256, expectedPriorSha256: audit.prior_sha256 } }
      } catch {
        // Keep searching only for the exact audited bytes, never a similar set.
      }
    }
    return { warning: 'The exact prior public snapshot certified by this report\'s audit is unavailable; VIN-level daily changes were withheld.' }
  } catch {
    return { warning: 'The public change audit does not validate against this release; VIN-level daily changes were withheld.' }
  }
}

function findPreviousCompletedPublicSnapshot(workspaceRoot, reportDate, current = {}) {
  const audited = findAuditedPublicBaseline(workspaceRoot, reportDate, current)
  if (audited) return audited
  const manifestsDirectory = path.join(workspaceRoot, 'work', 'run-status')
  let priorManifestNames = []
  try {
    priorManifestNames = readdirSync(manifestsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MANIFEST_PATTERN.test(entry.name) && entry.name.slice(0, 10) < reportDate)
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
  } catch {
    // Older fixture/archive formats can have snapshots without dated manifests.
  }
  for (const name of priorManifestNames) {
    try {
      const { data: manifest } = readJsonWithHash(path.join(manifestsDirectory, name), 'Prior run manifest')
      if (manifest.complete !== true || manifest.public_inventory_status !== 'complete' || !hasCompletedManifestEvidence(manifest)) continue
      assertValid(manifest.report_date === name.slice(0, 10), 'Prior manifest date differs from its filename')
      assertValid(typeof manifest.public_snapshot_path === 'string' && manifest.public_snapshot_path.length > 0, 'Prior public snapshot path is missing')
      assertValid(/^[A-Fa-f0-9]{64}$/.test(String(manifest.public_snapshot_sha256 ?? '')), 'Prior public snapshot checksum is missing')
      const snapshotPath = ensureWithin(
        workspaceRoot,
        path.isAbsolute(manifest.public_snapshot_path)
          ? manifest.public_snapshot_path
          : path.resolve(workspaceRoot, manifest.public_snapshot_path),
        'Prior public snapshot',
      )
      assertValid(path.basename(snapshotPath).startsWith(manifest.report_date), 'Prior snapshot filename differs from its report date')
      const file = readJsonWithHash(snapshotPath, 'Prior public snapshot')
      assertValid(file.sha256.toLowerCase() === manifest.public_snapshot_sha256.toLowerCase(), 'Prior public snapshot checksum differs from its manifest')
      validatePublicSnapshot(file.data, { reportDate: manifest.report_date, manifest })
      return { snapshotPath, file }
    } catch {
      // Never substitute an incomplete or altered release for certified history.
    }
  }
  if (priorManifestNames.length > 0) return null

  // Compatibility for pre-manifest archives only. Once dated history manifests
  // exist, their explicit paths and checksums are the exclusive authority.
  const snapshotsDirectory = path.join(workspaceRoot, 'work', 'inventory-history', 'snapshots')
  let candidates = []
  try {
    candidates = readdirSync(snapshotsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MANIFEST_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => name.slice(0, 10) < reportDate)
      .sort((left, right) => right.localeCompare(left))
  } catch {
    return null
  }

  for (const name of candidates) {
    const snapshotPath = path.join(snapshotsDirectory, name)
    try {
      const file = readJsonWithHash(snapshotPath, 'Prior public snapshot')
      validatePublicSnapshot(file.data, { reportDate: name.slice(0, 10) })
      return { snapshotPath, file }
    } catch {
      // The daily report compares against the latest successful snapshot. Skip
      // incomplete or damaged history rather than manufacturing removals.
    }
  }
  return null
}

export function validatePublicSnapshot(snapshot, { reportDate, manifest } = {}) {
  assertValid(isPlainObject(snapshot), 'Public snapshot must be an object')
  assertValid(snapshot.completed === true, 'Public snapshot is not marked completed')
  assertValid(DATE_PATTERN.test(String(snapshot.report_date ?? '')), 'Public report date is invalid')
  if (reportDate) {
    assertValid(snapshot.report_date === reportDate, 'Public snapshot date does not match the run manifest', {
      expected: reportDate,
      actual: snapshot.report_date,
    })
  }

  assertValid(Array.isArray(snapshot.source_statuses), 'Public source statuses are missing')
  assertValid(snapshot.source_statuses.length === STORE_NAMES.length, 'Public source status count must be four')
  const statusStores = new Set()
  for (const status of snapshot.source_statuses) {
    assertValid(isPlainObject(status), 'Public source status row is invalid')
    assertValid(STORE_NAMES.includes(status.source), 'Public source status contains an unknown store', {
      source: status.source,
    })
    statusStores.add(status.source)
    assertValid(status.status === 'OK', `Public source ${status.source} is not complete`, status)
    const expected = asInteger(status.expected_count)
    const fetched = asInteger(status.rows_fetched)
    const unique = asInteger(status.unique_vins)
    assertValid(expected > 0 && expected === fetched && fetched === unique, `Public source ${status.source} count reconciliation failed`, {
      expected,
      fetched,
      unique,
    })
  }
  assertValid(statusStores.size === STORE_NAMES.length, 'Public source status stores are not unique')

  assertValid(isPlainObject(snapshot.vehicles), 'Public vehicles must be a VIN-keyed object')
  const entries = Object.entries(snapshot.vehicles)
  const expectedCount = manifest?.source_counts?.public_unique_vins
  if (Number.isInteger(expectedCount)) {
    assertValid(entries.length === expectedCount, 'Public vehicle count differs from the run manifest', {
      expected: expectedCount,
      actual: entries.length,
    })
  }

  const vins = new Set()
  const stocks = new Set()
  for (const [key, vehicle] of entries) {
    assertValid(isPlainObject(vehicle), 'Public vehicle row is invalid', { key })
    const vin = normalizedVin(vehicle.vin)
    const stock = normalizedStock(vehicle.stock_number)
    assertValid(VIN_PATTERN.test(vin), 'Public vehicle has an invalid VIN', { key })
    assertValid(normalizedVin(key) === vin, 'Public VIN object key does not match the row VIN', { key, vin })
    assertValid(!vins.has(vin), 'Public snapshot contains a duplicate VIN', { vin })
    assertValid(stock.length > 0, 'Public vehicle is missing a stock number', { vin })
    assertValid(!stocks.has(stock.toUpperCase()), 'Public snapshot contains a duplicate stock number', { stock })
    assertValid(STORE_NAMES.includes(vehicle.store), 'Public vehicle has an unknown physical store', {
      vin,
      store: vehicle.store,
    })
    assertValid(String(vehicle.actual_location ?? '').trim().length > 0, 'Public vehicle is missing VehicleLocation evidence', { vin })
    assertValid(String(vehicle.vehicle_name ?? '').trim().length > 0, 'Public vehicle name is missing', { vin })
    assertValid(typeof vehicle.in_stock === 'boolean', 'DealerOn in-stock flag must be Boolean', { vin })
    assertValid(typeof vehicle.in_transit === 'boolean', 'DealerOn in-transit flag must be Boolean', { vin })
    assertValid(typeof vehicle.in_production === 'boolean', 'DealerOn in-production flag must be Boolean', { vin })
    assertValid(Array.isArray(vehicle.source_sites), 'Public source_sites must be an array', { vin })

    let listingUrl
    try {
      listingUrl = new URL(String(vehicle.listing_url ?? ''))
    } catch {
      throw new SnapshotValidationError('Public listing URL is invalid', { vin })
    }
    assertValid(
      listingUrl.protocol === 'https:' && !listingUrl.username && !listingUrl.password && !listingUrl.port,
      'Public listing URL must use HTTPS without credentials or a custom port',
      { vin },
    )
    assertValid(listingUrl.hostname.toLowerCase() === STORE_CONFIG[vehicle.store].websiteHost, 'Public listing URL host does not match physical store', {
      vin,
      store: vehicle.store,
      host: listingUrl.hostname,
    })
    assertValid(listingUrl.toString().toUpperCase().includes(vin), 'Public listing URL does not contain its VIN', { vin })

    vins.add(vin)
    stocks.add(stock.toUpperCase())
  }

  return {
    reportDate: snapshot.report_date,
    extractedAt: snapshot.generated_at,
    timezone: snapshot.timezone || 'America/New_York',
    rowCount: entries.length,
    storeCounts: Object.fromEntries(STORE_NAMES.map((store) => [store, entries.filter(([, row]) => row.store === store).length])),
    vehiclesByVin: Object.fromEntries(entries.map(([vin, row]) => [normalizedVin(vin), row])),
  }
}

export function validateDealerMailSnapshot(snapshot, { reportDate, manifest } = {}) {
  assertValid(isPlainObject(snapshot), 'DealerMail snapshot must be an object')
  assertValid(
    snapshot.schemaVersion === 'dealermail-used-holds-and-complete-inventory-v2',
    'DealerMail schema version is unsupported',
    { schemaVersion: snapshot.schemaVersion },
  )
  assertValid(DATE_PATTERN.test(String(snapshot.reportDate ?? '')), 'DealerMail report date is invalid')
  if (reportDate) {
    assertValid(snapshot.reportDate === reportDate, 'DealerMail report date does not match the run manifest', {
      expected: reportDate,
      actual: snapshot.reportDate,
    })
  }

  const sourceStatus = snapshot.sourceStatus
  assertValid(isPlainObject(sourceStatus), 'DealerMail source status is missing')
  assertValid(String(sourceStatus.overall ?? '').toLowerCase().startsWith('complete'), 'DealerMail source is not complete')
  assertValid(sourceStatus.loginRedirectEncountered !== true, 'DealerMail extraction encountered a login redirect')
  assertValid(sourceStatus.readOnly === true, 'DealerMail extraction was not certified read-only')

  const inventory = snapshot.completeDealerMailUsedInventory
  assertValid(isPlainObject(inventory), 'Complete DealerMail inventory is missing')
  assertValid(inventory.readOnly === true, 'Complete DealerMail inventory was not certified read-only')
  assertValid(
    Array.isArray(snapshot.currentComments) && Array.isArray(snapshot.currentAlerts),
    'DealerMail top-level current comment/alert evidence arrays are missing',
  )
  const authentication = inventory.authenticationStatus
  assertValid(isPlainObject(authentication), 'DealerMail authentication validation is missing')
  assertValid(authentication.authenticatedSessionStillWorks === true, 'DealerMail session was not current during extraction')
  assertValid(authentication.loginFormDetected === false, 'DealerMail login form was detected during extraction')
  assertValid(Array.isArray(inventory.rows), 'Complete DealerMail inventory rows are missing')

  const crmRows = inventory.rows
  const crmSummary = inventory.summary ?? {}
  assertValid(asInteger(crmSummary.totalRows) === crmRows.length, 'DealerMail total row count does not reconcile')
  const expectedCrmCount = manifest?.source_counts?.dealermail_used_rows
  if (Number.isInteger(expectedCrmCount)) {
    assertValid(crmRows.length === expectedCrmCount, 'DealerMail row count differs from the run manifest', {
      expected: expectedCrmCount,
      actual: crmRows.length,
    })
  }

  const crmSourceVins = new Set()
  const crmStocks = new Set()
  const crmByVin = new Map()
  const crmByStock = new Map()
  const quarantinedByStock = new Map()
  for (const row of crmRows) {
    const sourceVin = String(row.vin ?? '')
    const stock = normalizedStock(row.stockNumber)
    assertValid(SOURCE_VIN_TOKEN_PATTERN.test(sourceVin), 'DealerMail inventory row has an invalid source VIN token', {
      stock,
    })
    assertValid(stock.length > 0, 'DealerMail inventory row is missing a stock number', { sourceVin })
    assertValid(!crmSourceVins.has(sourceVin), 'DealerMail inventory contains a duplicate source VIN', { sourceVin })
    assertValid(!crmStocks.has(stock.toUpperCase()), 'DealerMail inventory contains a duplicate stock number', { stock })
    assertValid(STORE_NAMES.includes(row.storeName), 'DealerMail inventory row has an unknown CRM store', {
      sourceVin,
      store: row.storeName,
    })
    assertValid(STORE_CONFIG[row.storeName].dealerMailCode === row.storeCode, 'DealerMail store code/name mapping is inconsistent', {
      sourceVin,
      storeCode: row.storeCode,
      storeName: row.storeName,
    })
    assertValid(asInteger(row.sourceCellCount) === 22, 'DealerMail row does not preserve all 22 source cells', { sourceVin })
    assertValid(['Y', 'N'].includes(row.commentsFlag), 'DealerMail inventory commentsFlag must be Y or N', { sourceVin })
    assertValid(['Y', 'N'].includes(row.alertsFlag), 'DealerMail inventory alertsFlag must be Y or N', { sourceVin })
    assertValid(Array.isArray(row.comments) && Array.isArray(row.alerts), 'DealerMail inventory message evidence is missing', { sourceVin })
    assertValid(row.comments.every((group) => Array.isArray(group?.rows)), 'DealerMail comment rows are invalid', { sourceVin })
    if (row.commentsFlag === 'Y') {
      assertValid(row.comments.some((group) => group.rows.some((comment) => typeof comment.commentTextRaw === 'string' && comment.commentTextRaw.trim())), 'Flagged DealerMail inventory comments are missing', { sourceVin })
    }
    if (row.alertsFlag === 'Y') {
      assertValid(row.alerts.some((alert) => typeof alert?.alertTextRaw === 'string' && alert.alertTextRaw.trim()), 'Flagged DealerMail inventory alert is missing', { sourceVin })
    }
    crmSourceVins.add(sourceVin)
    crmStocks.add(stock.toUpperCase())
    crmByStock.set(stock.toUpperCase(), row)
    if (VIN_PATTERN.test(sourceVin)) crmByVin.set(sourceVin, row)
    else quarantinedByStock.set(stock.toUpperCase(), row)
  }
  assertValid(asInteger(crmSummary.uniqueVinCount) === crmSourceVins.size, 'DealerMail unique source-VIN summary does not reconcile')
  assertValid(asInteger(crmSummary.uniqueStockCount) === crmStocks.size, 'DealerMail unique stock summary does not reconcile')

  const validation = snapshot.completeInventorySetValidation?.validation
  assertValid(isPlainObject(validation), 'DealerMail complete-set validation is missing')
  for (const flag of [
    'differenceVinEqualsFlaggedHolds',
    'differenceStockEqualsFlaggedHolds',
    'allSourceCellCounts22',
    'allStockNonblank',
    'allStoreCodesExpected',
    'setEquationValid',
  ]) {
    assertValid(validation[flag] === true, `DealerMail validation failed: ${flag}`)
  }
  assertValid(
    validation.allVinFormatValid === (quarantinedByStock.size === 0),
    'DealerMail VIN-format validation does not reconcile with quarantined source rows',
    { quarantinedCount: quarantinedByStock.size },
  )

  assertValid(Array.isArray(snapshot.vehicles), 'DealerMail held vehicles are missing')
  const holdVehicles = snapshot.vehicles
  const holdVins = new Set()
  let totalDetails = 0
  let activeDetails = 0
  let activePrimaries = 0
  let activeBackups = 0
  let deletedHistory = 0

  for (const vehicle of holdVehicles) {
    const vin = normalizedVin(vehicle?.mainRow?.vin)
    assertValid(VIN_PATTERN.test(vin), 'DealerMail held vehicle has an invalid VIN')
    assertValid(!holdVins.has(vin), 'DealerMail held vehicles contain a duplicate VIN', { vin })
    assertValid(crmByVin.has(vin), 'DealerMail held vehicle is absent from the valid-VIN CRM inventory', { vin })
    assertValid(STORE_NAMES.includes(vehicle?.store?.name), 'DealerMail held vehicle has an unknown CRM store', { vin })
    const details = Array.isArray(vehicle.holdDetailRows) ? vehicle.holdDetailRows : []
    const active = details.filter((row) => row?.lifecycleStatus === 'active')
    const primary = active.filter((row) => row?.holdPosition === 'primary' || asInteger(row?.holdOrderNumber) === 1)
    const backups = active.filter((row) => row?.holdPosition === 'backup' || asInteger(row?.holdOrderNumber) > 1)
    assertValid(primary.length === 1, 'Held vehicle must have exactly one active primary hold', { vin, primaryCount: primary.length })
    totalDetails += details.length
    activeDetails += active.length
    activePrimaries += primary.length
    activeBackups += backups.length
    deletedHistory += details.filter((row) => row?.lifecycleStatus !== 'active').length
    holdVins.add(vin)
  }

  const summary = snapshot.summary ?? {}
  const summaryChecks = {
    uniqueHeldVehicles: holdVins.size,
    totalHoldDetailRows: totalDetails,
    activeHoldDetailRows: activeDetails,
    activePrimaryHolds: activePrimaries,
    activeBackupHolds: activeBackups,
    deletedHistoricalHoldRows: deletedHistory,
  }
  for (const [field, expected] of Object.entries(summaryChecks)) {
    assertValid(asInteger(summary[field]) === expected, `DealerMail hold summary does not reconcile: ${field}`, {
      expected,
      actual: summary[field],
    })
  }
  assertValid(
    asInteger(summary.detailEndpointsAttempted) === holdVins.size &&
      asInteger(summary.detailEndpointsSucceeded) === holdVins.size,
    'DealerMail hold detail endpoints were not complete',
  )

  const expectedHeldCount = manifest?.source_counts?.active_held_vins
  if (Number.isInteger(expectedHeldCount)) {
    assertValid(holdVins.size === expectedHeldCount, 'DealerMail held VIN count differs from the run manifest', {
      expected: expectedHeldCount,
      actual: holdVins.size,
    })
  }

  const cdkByVin = Object.fromEntries(
    (snapshot.cdkReadOnlyLookup?.records ?? [])
      .filter((record) => VIN_PATTERN.test(normalizedVin(record?.vin)))
      .map((record) => [normalizedVin(record.vin), record]),
  )

  if (snapshot.releasedHoldHistory !== undefined) {
    assertValid(Array.isArray(snapshot.releasedHoldHistory), 'Released hold history must be an array')
    const seen = new Set()
    const seenStocks = new Set()
    for (const history of snapshot.releasedHoldHistory) {
      const vin = normalizedVin(history?.vin)
      const historyStock = normalizedStock(history?.stockNumber).toUpperCase()
      assertValid(VIN_PATTERN.test(vin) && history?.vin === vin && !seen.has(vin) && !holdVins.has(vin), 'Released hold history VIN is invalid, duplicated, noncanonical, or currently held', { vin })
      assertValid(historyStock && !seenStocks.has(historyStock), 'Released hold history stock is missing or duplicated', { vin })
      assertValid(
        isPlainObject(history.store) &&
          STORE_NAMES.includes(history.store.name) &&
          STORE_CONFIG[history.store.name].dealerMailCode === history.store.code,
        'Released hold history CRM store/code is invalid',
        { vin },
      )

      const currentCrm = crmByVin.get(vin)
      const currentStockOwner = crmByStock.get(historyStock)
      if (currentCrm) {
        assertValid(
          normalizedStock(currentCrm.stockNumber).toUpperCase() === historyStock &&
            currentCrm.storeName === history.store.name &&
            currentCrm.storeCode === history.store.code,
          'Released hold history does not match the current CRM VIN/stock/store record',
          { vin },
        )
      } else {
        assertValid(
          !currentStockOwner,
          'Released hold history stock is currently assigned to a different CRM VIN',
          { vin, historyStock },
        )
      }

      let sourceUrl
      try {
        sourceUrl = new URL(String(history.sourceUrl ?? ''))
      } catch {
        throw new SnapshotValidationError('Released hold history source URL is invalid', { vin })
      }
      const sourceKeys = [...sourceUrl.searchParams.keys()]
      assertValid(
        sourceUrl.protocol === 'https:' &&
          sourceUrl.hostname.toLowerCase() === 'www.dealermail.com' &&
          !sourceUrl.username &&
          !sourceUrl.password &&
          !sourceUrl.port &&
          !sourceUrl.hash &&
          sourceUrl.pathname.toLowerCase() === '/prospect_manager/v2_inventory_used_hold_edit.asp' &&
          sourceKeys.length === 1 &&
          sourceKeys[0] === 's' &&
          normalizedStock(sourceUrl.searchParams.get('s')).toUpperCase() === historyStock,
        'Released hold history source URL does not match its exact DealerMail stock',
        { vin },
      )
      assertValid(history.currentLiveHold === false, 'Released hold history must explicitly remain non-current', { vin })
      assertValid(
        typeof history.observedAtUtc === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(history.observedAtUtc) &&
          Number.isFinite(Date.parse(history.observedAtUtc)),
        'Released hold history observation timestamp is invalid',
        { vin },
      )
      assertValid(Array.isArray(history.holdDetailRows) && history.holdDetailRows.length > 0, 'Released hold history detail rows are missing', { vin })
      for (const detail of history.holdDetailRows) {
        assertValid(isPlainObject(detail), 'Released hold history detail row is invalid', { vin })
        assertValid(
          normalizedStock(detail.stockNumber).toUpperCase() === historyStock &&
            normalizedStock(detail.sourceStockNumber).toUpperCase() === historyStock,
          'Released hold history nested detail stock/provenance does not match its wrapper',
          { vin },
        )
        if (detail.vin !== undefined) {
          assertValid(normalizedVin(detail.vin) === vin, 'Released hold history nested detail VIN does not match its wrapper', { vin })
        }
        if (detail.storeName !== undefined || detail.storeCode !== undefined) {
          assertValid(
            detail.storeName === history.store.name && detail.storeCode === history.store.code,
            'Released hold history nested detail store provenance does not match its wrapper',
            { vin },
          )
        }
      }
      seen.add(vin)
      seenStocks.add(historyStock)
    }
  }

  return {
    reportDate: snapshot.reportDate,
    extractedAt: inventory.extractedAtUtc || snapshot.extractedAtUtc,
    holdExtractedAt: snapshot.extractedAtUtc,
    timezone: snapshot.timezone || 'America/New_York',
    rowCount: crmRows.length,
    vinReconciledRowCount: crmByVin.size,
    heldVinCount: holdVins.size,
    crmByVin: Object.fromEntries(crmByVin),
    vinQuarantine: {
      count: quarantinedByStock.size,
      stocks: [...quarantinedByStock.keys()].sort(),
    },
    holdsByVin: Object.fromEntries(holdVehicles.map((vehicle) => [normalizedVin(vehicle.mainRow.vin), vehicle])),
    cdkByVin,
  }
}

export function normalizeRelease({
  manifestPath,
  manifest,
  publicPath,
  publicFile,
  dealerMailPath,
  dealerMailFile,
  previousPublicPath = null,
  previousPublicFile = null,
  previousPublicEvidence = null,
  previousPublicWarning = null,
  photoCachePath: matchedPhotoCachePath = null,
  photoCacheFile = null,
  photoCacheLoadWarning = null,
  documentEnrichmentPath: matchedDocumentEnrichmentPath = null,
  documentEnrichmentFile = null,
  documentEnrichmentLoadWarning = null,
  now = new Date(),
}) {
  assertValid(manifest?.complete === true, 'Run manifest is not marked complete')
  assertValid(DATE_PATTERN.test(String(manifest.report_date ?? '')), 'Run manifest report date is invalid')
  assertValid(manifest.public_inventory_status === 'complete', 'Run manifest public inventory is not complete')
  assertValid(
    COMPLETE_DEALERMAIL_STATUSES.has(manifest.dealermail_status),
    'Run manifest DealerMail data is not complete',
  )
  assertValid(hasCompletedManifestEvidence(manifest), 'Run manifest validation did not pass')

  const publicValidated = validatePublicSnapshot(publicFile.data, {
    reportDate: manifest.report_date,
    manifest,
  })
  const dealerMailCompatibilityNormalizationApplied =
    Array.isArray(dealerMailFile.data?.releasedHoldHistory) &&
    dealerMailFile.data.releasedHoldHistory.some((history) => typeof history?.store === 'string')
  const dealerMailSnapshot = normalizeDealerMailSnapshotForImport(dealerMailFile.data)
  const dealerMailValidated = validateDealerMailSnapshot(dealerMailSnapshot, {
    reportDate: manifest.report_date,
    manifest,
  })

  const reportDate = manifest.report_date
  const today = dateInTimeZone(now, manifest.timezone || 'America/New_York')
  const isSameDay = reportDate === today
  const warnings = []
  if (!isSameDay) {
    warnings.push(`Latest completed source release is dated ${reportDate}; current local date is ${today}.`)
  }
  if (dealerMailSnapshot.automationAccessAssessment?.persistentDailyAccess !== 'guaranteed') {
    warnings.push('DealerMail unattended authentication is not guaranteed; preserve this as-of date if a later extraction fails.')
  }
  if (dealerMailCompatibilityNormalizationApplied) {
    warnings.push('Legacy released-hold store codes were normalized in memory; the certified source file, checksum, and byte count were not changed.')
  }
  if (dealerMailValidated.vinQuarantine.count > 0) {
    warnings.push(
      `DealerMail VIN-format review: ${dealerMailValidated.vinQuarantine.count} source row(s) were preserved in encrypted evidence and excluded from VIN-based inventory and actions. Review stock ${dealerMailValidated.vinQuarantine.stocks.join(', ')}.`,
    )
  }
  if (photoCacheLoadWarning) warnings.push(photoCacheLoadWarning)
  if (documentEnrichmentLoadWarning) warnings.push(documentEnrichmentLoadWarning)
  if (previousPublicWarning) warnings.push(previousPublicWarning)

  let publicRecordsByVin = publicValidated.vehiclesByVin
  let photoCacheMetadata = { status: 'not_found' }
  if (photoCacheFile?.data) {
    try {
      const mergedPhotos = mergeVerifiedPhotoCache({
        recordsByVin: publicRecordsByVin,
        cache: photoCacheFile.data,
        reportDate,
        publicSnapshotSha256: publicFile.sha256,
      })
      publicRecordsByVin = mergedPhotos.recordsByVin
      photoCacheMetadata = {
        ...mergedPhotos.metadata,
        path: matchedPhotoCachePath,
        cacheSha256: photoCacheFile.sha256,
      }
    } catch (error) {
      warnings.push(`App photo cache was ignored: ${error.message}`)
      photoCacheMetadata = { status: 'ignored', path: matchedPhotoCachePath }
    }
  }

  let resourceRecordsByVin = {}
  let documentEnrichmentMetadata = { status: 'not_found', path: matchedDocumentEnrichmentPath }
  if (documentEnrichmentFile?.data) {
    const validated = validateVinDocumentEnrichmentForPublish(documentEnrichmentFile.data, {
      onResourceRejected: ({ vin, channel, reason }) => {
        warnings.push(`VIN ${vin}: dropped unsafe ${channel} enrichment: ${reason}`)
      },
    })
    resourceRecordsByVin = validated.recordsByVin
    documentEnrichmentMetadata = {
      ...validated.metadata,
      path: matchedDocumentEnrichmentPath,
      sha256: documentEnrichmentFile.sha256,
      bytes: documentEnrichmentFile.bytes,
    }
  }

  let publicChangeEvents = []
  let publicChangeBaseline = null
  if (previousPublicFile?.data) {
    const previousValidated = validatePublicSnapshot(previousPublicFile.data)
    const candidateEvents = buildPublicChangeEvents({
      previousSnapshot: previousPublicFile.data,
      currentSnapshot: publicFile.data,
    })
    const candidateCounts = summarizePublicChangeEvents(candidateEvents)
    const { counts: manifestCounts, issues: countIssues } = normalizePublicChangeCounts(manifest.public_change_counts)
    warnings.push(...countIssues)
    const countKeys = Object.keys(candidateCounts)
    const countsReconcile = countIssues.length === 0 && countKeys.every(
      (key) => manifestCounts[key] === candidateCounts[key],
    )
    if (countsReconcile) {
      publicChangeEvents = candidateEvents
      publicChangeBaseline = {
        reportDate: previousValidated.reportDate,
        snapshotPath: previousPublicPath,
        sha256: previousPublicFile.sha256,
        ...(previousPublicEvidence ? { audit: previousPublicEvidence } : {}),
      }
    } else {
      warnings.push(
        'Detailed public change events did not reconcile to the certified daily totals; aggregate counts were retained without VIN-level conclusions.',
      )
    }
  } else if (Object.values(manifest.public_change_counts ?? {}).some((value) => asInteger(value) > 0)) {
    warnings.push(
      'No prior complete public snapshot was available for VIN-level change details; aggregate daily change counts were retained.',
    )
  }

  const vehicleVins = new Set([
    ...Object.keys(publicRecordsByVin),
    ...Object.keys(dealerMailValidated.crmByVin),
  ])
  const vehicles = [...vehicleVins].sort().map((vin) => ({
    vin,
    publicRecord: publicRecordsByVin[vin] ?? null,
    crmRecord: dealerMailValidated.crmByVin[vin] ?? null,
    holdRecord: dealerMailValidated.holdsByVin[vin] ?? null,
    cdkRecord: dealerMailValidated.cdkByVin[vin] ?? null,
    resourceRecord: resourceRecordsByVin[vin] ?? null,
  }))

  const matchedResourceCount = vehicles.reduce((count, vehicle) => count + (vehicle.resourceRecord ? 1 : 0), 0)
  if (documentEnrichmentMetadata.status === 'matched') {
    documentEnrichmentMetadata.matchedVehicleCount = matchedResourceCount
    documentEnrichmentMetadata.unmatchedRecordCount =
      documentEnrichmentMetadata.recordCount - matchedResourceCount
  }

  const resourceSourceRunBase =
    documentEnrichmentMetadata.status === 'matched'
      ? {
          type: 'vin_document_enrichment',
          reportDate,
          extractedAt: documentEnrichmentMetadata.generatedAt,
          snapshotPath: matchedDocumentEnrichmentPath,
          sha256: documentEnrichmentFile.sha256,
          bytes: documentEnrichmentFile.bytes,
          schemaVersion: VIN_DOCUMENT_ENRICHMENT_SCHEMA,
          status: isSameDay ? 'current' : 'stale_unverified',
          staleReason: isSameDay ? null : `Source release is dated ${reportDate}`,
          rowCount: matchedResourceCount,
          metadata: documentEnrichmentMetadata,
        }
      : null
  const resourceSourceRun = resourceSourceRunBase
    ? {
        ...resourceSourceRunBase,
        provenanceSha256: resourceProvenanceSha256(resourceSourceRunBase, vehicles),
      }
    : null

  return {
    reportDate,
    timezone: manifest.timezone || publicValidated.timezone,
    completedAt: manifest.completed_at || manifest.completion_time || null,
    manifestPath,
    manifest,
    warnings,
    sourceRuns: {
      public: {
        type: 'public_inventory',
        reportDate,
        extractedAt: publicValidated.extractedAt,
        snapshotPath: publicPath,
        sha256: publicFile.sha256,
        bytes: publicFile.bytes,
        schemaVersion: 'public-inventory-v1-adapter',
        status: isSameDay ? 'current' : 'stale_unverified',
        staleReason: isSameDay ? null : `Source release is dated ${reportDate}`,
        rowCount: publicValidated.rowCount,
        metadata: {
          storeCounts: publicValidated.storeCounts,
          sourceStatuses: publicFile.data.source_statuses,
          changeBaseline: publicChangeBaseline,
          changeEventCount: publicChangeEvents.length,
          photoCache: photoCacheMetadata,
        },
      },
      dealerMail: {
        type: 'dealermail_inventory_holds',
        reportDate,
        extractedAt: dealerMailValidated.extractedAt,
        snapshotPath: dealerMailPath,
        sha256: dealerMailFile.sha256,
        bytes: dealerMailFile.bytes,
        schemaVersion: dealerMailSnapshot.schemaVersion,
        status: isSameDay ? 'current' : 'stale_unverified',
        staleReason: isSameDay ? null : `Source release is dated ${reportDate}`,
        rowCount: dealerMailValidated.rowCount,
        metadata: {
          heldVinCount: dealerMailValidated.heldVinCount,
          vinQuarantine: {
            count: dealerMailValidated.vinQuarantine.count,
            stocks: dealerMailValidated.vinQuarantine.stocks,
            sourceRowCount: dealerMailValidated.rowCount,
            vinReconciledRowCount: dealerMailValidated.vinReconciledRowCount,
            excludedFromVinWorkflows: true,
          },
          summary: dealerMailSnapshot.summary,
          compatibilityNormalization: dealerMailCompatibilityNormalizationApplied
            ? {
                applied: true,
                field: 'releasedHoldHistory.store',
                mode: 'in_memory_non_mutating',
                originalSourceSha256: dealerMailFile.sha256,
                originalSourceBytes: dealerMailFile.bytes,
              }
            : { applied: false },
          authentication: {
            persistentDailyAccess: dealerMailSnapshot.automationAccessAssessment?.persistentDailyAccess,
            readOnly: dealerMailSnapshot.sourceStatus?.readOnly === true,
          },
        },
      },
      resources: resourceSourceRun,
      managerDisposition: null,
    },
    publicSnapshot: publicFile.data,
    dealerMailSnapshot,
    releasedHoldHistory: dealerMailSnapshot.releasedHoldHistory ?? [],
    publicChangeEvents,
    managerDispositionOverlay: sanitizeManagerDispositionDocuments({ documents: [], reportDate, vehicles }),
    vehicles,
  }
}

export function loadLatestCompletedRelease({ workspaceRoot, now = new Date() }) {
  const resolvedWorkspace = path.resolve(workspaceRoot)
  const { manifestPath, manifest } = findLatestCompletedManifest(resolvedWorkspace)
  const reportDate = String(manifest.report_date ?? '')
  assertValid(DATE_PATTERN.test(reportDate), 'Completed run manifest has an invalid report date')
  assertValid(path.basename(manifestPath) === `${reportDate}.json`, 'Run manifest filename does not match its report date')

  const publicPath = ensureWithin(
    resolvedWorkspace,
    path.isAbsolute(manifest.public_snapshot_path)
      ? manifest.public_snapshot_path
      : path.resolve(resolvedWorkspace, manifest.public_snapshot_path),
    'Public snapshot',
  )
  const dealerMailPath = ensureWithin(
    resolvedWorkspace,
    path.isAbsolute(manifest.dealermail_snapshot_path)
      ? manifest.dealermail_snapshot_path
      : path.resolve(resolvedWorkspace, manifest.dealermail_snapshot_path),
    'DealerMail snapshot',
  )
  assertValid(path.basename(publicPath).startsWith(reportDate), 'Public snapshot filename does not match the report date')
  assertValid(path.basename(dealerMailPath).startsWith(reportDate), 'DealerMail snapshot filename does not match the report date')

  const publicFile = readJsonWithHash(publicPath, 'Public snapshot')
  const dealerMailFile = readJsonWithHash(dealerMailPath, 'DealerMail snapshot')
  const matchedPhotoCachePath = photoCachePath(resolvedWorkspace, reportDate, publicFile.sha256)
  let photoCacheFile = null
  let photoCacheLoadWarning = null
  if (existsSync(matchedPhotoCachePath)) {
    try {
      photoCacheFile = readJsonWithHash(matchedPhotoCachePath, 'App photo cache')
    } catch (error) {
      photoCacheLoadWarning = `App photo cache could not be read and was ignored: ${error.message}`
    }
  }
  const matchedDocumentEnrichmentPath = vinDocumentEnrichmentPath(resolvedWorkspace)
  let documentEnrichmentFile = null
  let documentEnrichmentLoadWarning = null
  if (existsSync(matchedDocumentEnrichmentPath)) {
    documentEnrichmentFile = readJsonWithHash(matchedDocumentEnrichmentPath, 'VIN document enrichment')
  }
  const previousPublic = findPreviousCompletedPublicSnapshot(resolvedWorkspace, reportDate, { publicPath, publicFile, manifest })
  const release = normalizeRelease({
    manifestPath,
    manifest,
    publicPath,
    publicFile,
    dealerMailPath,
    dealerMailFile,
    previousPublicPath: previousPublic?.snapshotPath ?? null,
    previousPublicFile: previousPublic?.file ?? null,
    previousPublicEvidence: previousPublic?.evidence ?? null,
    previousPublicWarning: previousPublic?.warning ?? null,
    photoCachePath: matchedPhotoCachePath,
    photoCacheFile,
    photoCacheLoadWarning,
    documentEnrichmentPath: matchedDocumentEnrichmentPath,
    documentEnrichmentFile,
    documentEnrichmentLoadWarning,
    now,
  })
  const managerDisposition = loadManagerDispositionOverlay({
    workspaceRoot: resolvedWorkspace,
    reportDate,
    vehicles: release.vehicles,
    current: release.sourceRuns.public.status === 'current',
    manifestBinding: manifest.manager_disposition_overlay ?? null,
  })
  release.managerDispositionOverlay = managerDisposition.overlay
  release.sourceRuns.managerDisposition = managerDisposition.sourceRun
  if (managerDisposition.overlay.summary.reviewRecordCount > 0) {
    release.warnings.push(
      `${managerDisposition.overlay.summary.reviewRecordCount} manager disposition record(s) require identity review; they remain separate from current inventory status.`,
    )
  }
  return release
}

export const importerInternals = Object.freeze({
  VIN_PATTERN,
  SOURCE_VIN_TOKEN_PATTERN,
  dateInTimeZone,
  normalizedStock,
  normalizedVin,
  findPreviousCompletedPublicSnapshot,
  photoCachePath,
  vinDocumentEnrichmentPath,
  canonicalPhotoUrl,
  canonicalCaiFactoryEquipmentUrl,
  canonicalExternalAutoCheckUrl,
})
