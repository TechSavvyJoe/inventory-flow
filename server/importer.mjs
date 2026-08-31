import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildPublicChangeEvents, summarizePublicChangeEvents } from './public-change-events.mjs'

export const STORE_NAMES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']

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
const EXTERNAL_AUTOCHECK_PATH_PATTERN = /^\/(?:report|vehiclehistory)(?:\/|$)/i
const PHOTO_ALLOWED_HOSTS = new Set(Object.values(STORE_CONFIG).map((store) => store.websiteHost))
const EXTERNAL_AUTOCHECK_ALLOWED_HOSTS = new Set(['autocheck.com', 'www.autocheck.com'])
const RESOURCE_DATA_STATES = new Set(['current', 'stale_unverified', 'incomplete'])

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

  return (
    validation.public_sources_complete === true &&
    validation.dealermail_complete === true &&
    validation.workbook_validated === true &&
    validation.desktop_excel_opened_without_repair === true &&
    asInteger(validation.formula_errors) === 0 &&
    validation.read_only_validation_hash_unchanged === true &&
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

function canonicalExternalAutoCheckUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  try {
    parsed = new URL(value)
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
    !EXTERNAL_AUTOCHECK_ALLOWED_HOSTS.has(host) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !EXTERNAL_AUTOCHECK_PATH_PATTERN.test(pathName) ||
    decodedPath.split('/').includes('..')
  ) {
    return null
  }
  parsed.protocol = 'https:'
  parsed.hostname = host
  parsed.pathname = pathName
  parsed.hash = ''
  return parsed.toString()
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
  const url = canonicalExternalAutoCheckUrl(value.url)
  assertValid(url, 'External AutoCheck URL is not on an approved official host and route', { vin })
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

export function validateVinDocumentEnrichment(value) {
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
  for (const [rawVin, record] of entries) {
    const vin = normalizedVin(rawVin)
    assertValid(VIN_PATTERN.test(vin) && rawVin === vin, 'VIN document enrichment key is not a canonical VIN', {
      rawVin,
    })
    assertOnlyKeys(record, new Set(['vin', 'factoryEquipment', 'autoCheckReport']), 'VIN document enrichment record', {
      vin,
    })
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
    assertValid(factoryEquipment || autoCheckReport, 'VIN document enrichment record contains no usable resource', { vin })
    if (factoryEquipment) factoryEquipmentCount += 1
    if (autoCheckReport) externalAutoCheckCount += 1
    recordsByVin[vin] = {
      ...(factoryEquipment ? { factoryEquipment } : {}),
      ...(autoCheckReport ? { autoCheckReport } : {}),
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
    },
  }
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

function findPreviousCompletedPublicSnapshot(workspaceRoot, reportDate) {
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
    assertValid(['http:', 'https:'].includes(listingUrl.protocol), 'Public listing URL scheme is invalid', { vin })
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

  const crmVins = new Set()
  const crmStocks = new Set()
  for (const row of crmRows) {
    const vin = normalizedVin(row.vin)
    const stock = normalizedStock(row.stockNumber)
    assertValid(VIN_PATTERN.test(vin), 'DealerMail inventory row has an invalid VIN')
    assertValid(stock.length > 0, 'DealerMail inventory row is missing a stock number', { vin })
    assertValid(!crmVins.has(vin), 'DealerMail inventory contains a duplicate VIN', { vin })
    assertValid(!crmStocks.has(stock.toUpperCase()), 'DealerMail inventory contains a duplicate stock number', { stock })
    assertValid(STORE_NAMES.includes(row.storeName), 'DealerMail inventory row has an unknown CRM store', {
      vin,
      store: row.storeName,
    })
    assertValid(STORE_CONFIG[row.storeName].dealerMailCode === row.storeCode, 'DealerMail store code/name mapping is inconsistent', {
      vin,
      storeCode: row.storeCode,
      storeName: row.storeName,
    })
    assertValid(asInteger(row.sourceCellCount) === 22, 'DealerMail row does not preserve all 22 source cells', { vin })
    crmVins.add(vin)
    crmStocks.add(stock.toUpperCase())
  }
  assertValid(asInteger(crmSummary.uniqueVinCount) === crmVins.size, 'DealerMail unique VIN summary does not reconcile')
  assertValid(asInteger(crmSummary.uniqueStockCount) === crmStocks.size, 'DealerMail unique stock summary does not reconcile')

  const validation = snapshot.completeInventorySetValidation?.validation
  assertValid(isPlainObject(validation), 'DealerMail complete-set validation is missing')
  for (const flag of [
    'differenceVinEqualsFlaggedHolds',
    'differenceStockEqualsFlaggedHolds',
    'allSourceCellCounts22',
    'allVinFormatValid',
    'allStockNonblank',
    'allStoreCodesExpected',
    'setEquationValid',
  ]) {
    assertValid(validation[flag] === true, `DealerMail validation failed: ${flag}`)
  }

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
    assertValid(crmVins.has(vin), 'DealerMail held vehicle is absent from the complete CRM inventory', { vin })
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

  return {
    reportDate: snapshot.reportDate,
    extractedAt: inventory.extractedAtUtc || snapshot.extractedAtUtc,
    holdExtractedAt: snapshot.extractedAtUtc,
    timezone: snapshot.timezone || 'America/New_York',
    rowCount: crmRows.length,
    heldVinCount: holdVins.size,
    crmByVin: Object.fromEntries(crmRows.map((row) => [normalizedVin(row.vin), row])),
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
  const dealerMailValidated = validateDealerMailSnapshot(dealerMailFile.data, {
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
  if (dealerMailFile.data.automationAccessAssessment?.persistentDailyAccess !== 'guaranteed') {
    warnings.push('DealerMail unattended authentication is not guaranteed; preserve this as-of date if a later extraction fails.')
  }
  if (photoCacheLoadWarning) warnings.push(photoCacheLoadWarning)
  if (documentEnrichmentLoadWarning) warnings.push(documentEnrichmentLoadWarning)

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
    try {
      const validated = validateVinDocumentEnrichment(documentEnrichmentFile.data)
      resourceRecordsByVin = validated.recordsByVin
      documentEnrichmentMetadata = {
        ...validated.metadata,
        path: matchedDocumentEnrichmentPath,
        sha256: documentEnrichmentFile.sha256,
        bytes: documentEnrichmentFile.bytes,
      }
    } catch (error) {
      warnings.push(`VIN document enrichment was ignored: ${error.message}`)
      documentEnrichmentMetadata = { status: 'ignored', path: matchedDocumentEnrichmentPath }
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
    const manifestCounts = manifest.public_change_counts ?? {}
    const countKeys = Object.keys(candidateCounts)
    const countsReconcile = countKeys.every(
      (key) => asInteger(manifestCounts[key] ?? 0) === candidateCounts[key],
    )
    if (countsReconcile) {
      publicChangeEvents = candidateEvents
      publicChangeBaseline = {
        reportDate: previousValidated.reportDate,
        snapshotPath: previousPublicPath,
        sha256: previousPublicFile.sha256,
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

  const resourceSourceRun =
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

  return {
    reportDate,
    timezone: manifest.timezone || publicValidated.timezone,
    completedAt: manifest.completed_at || null,
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
        schemaVersion: dealerMailFile.data.schemaVersion,
        status: isSameDay ? 'current' : 'stale_unverified',
        staleReason: isSameDay ? null : `Source release is dated ${reportDate}`,
        rowCount: dealerMailValidated.rowCount,
        metadata: {
          heldVinCount: dealerMailValidated.heldVinCount,
          summary: dealerMailFile.data.summary,
          authentication: {
            persistentDailyAccess: dealerMailFile.data.automationAccessAssessment?.persistentDailyAccess,
            readOnly: dealerMailFile.data.sourceStatus?.readOnly === true,
          },
        },
      },
      resources: resourceSourceRun,
    },
    publicSnapshot: publicFile.data,
    dealerMailSnapshot: dealerMailFile.data,
    publicChangeEvents,
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
    try {
      documentEnrichmentFile = readJsonWithHash(matchedDocumentEnrichmentPath, 'VIN document enrichment')
    } catch (error) {
      documentEnrichmentLoadWarning = `VIN document enrichment could not be read and was ignored: ${error.message}`
    }
  }
  const previousPublic = findPreviousCompletedPublicSnapshot(resolvedWorkspace, reportDate)
  return normalizeRelease({
    manifestPath,
    manifest,
    publicPath,
    publicFile,
    dealerMailPath,
    dealerMailFile,
    previousPublicPath: previousPublic?.snapshotPath ?? null,
    previousPublicFile: previousPublic?.file ?? null,
    photoCachePath: matchedPhotoCachePath,
    photoCacheFile,
    photoCacheLoadWarning,
    documentEnrichmentPath: matchedDocumentEnrichmentPath,
    documentEnrichmentFile,
    documentEnrichmentLoadWarning,
    now,
  })
}

export const importerInternals = Object.freeze({
  VIN_PATTERN,
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
