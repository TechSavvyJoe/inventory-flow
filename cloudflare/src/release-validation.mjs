import { canonicalExternalAutoCheckUrl, resourceProvenanceSha256 } from '../../server/resource-validation.mjs'

// Portable validation for the encrypted daily evidence import. This module has
// no filesystem, credentials, or source-fetching dependencies.
export const RELEASE_FORMAT = 'inventory-flow-private-release-v1'
const STORES = Object.freeze({
  Howell: { code: 'H', host: 'www.bobmaxeyfordhowell.com' },
  Fowlerville: { code: 'F', host: 'www.bobmaxeyfordinfowlerville.com' },
  'Ford Detroit': { code: 'D', host: 'www.bobmaxeyford.com' },
  Lincoln: { code: 'L', host: 'www.bobmaxeylincoln.com' },
})
const STORE_NAMES = Object.keys(STORES)
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const HASH = /^[a-f0-9]{64}$/i
const MAX_ROWS = 20000
const CHECKS = ['differenceVinEqualsFlaggedHolds', 'differenceStockEqualsFlaggedHolds', 'allSourceCellCounts22', 'allVinFormatValid', 'allStockNonblank', 'allStoreCodesExpected', 'setEquationValid']
const RESOURCE_SCHEMA = 'inventory-flow-vin-document-enrichment-v1'
const RESOURCE_DATA_STATES = new Set(['current', 'stale_unverified', 'incomplete'])
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
    'dataState', 'url', 'sourceLabel', 'capturedAt', 'reportRunAt', 'score', 'scoreRangeLow',
    'scoreRangeHigh', 'usage', 'ownerCount', 'lastReportedOdometer', 'lastReportedOdometerDate',
    'vehicleClass', 'assemblyCountry', 'estimatedInServiceDate', 'checks',
  ]), 'external AutoCheck record')
  ensure(RESOURCE_DATA_STATES.has(value.dataState), 'external AutoCheck data state is invalid')
  ensure(canonicalExternalAutoCheckUrl(value.url, vin), 'external AutoCheck URL is not an approved exact-VIN HTTPS resource')
  optionalText(value.sourceLabel, 'external AutoCheck sourceLabel', 160)
  optionalTimestamp(value.capturedAt, 'external AutoCheck capturedAt')
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
  return { factoryEquipment: 0, externalAutoCheck: 1 }
}

function validateResourceRecord(value, vin) {
  onlyKeys(value, new Set(['vin', 'factoryEquipment', 'autoCheckReport']), 'resource record')
  ensure(value.vin === vin && normalizedVin(value.vin) === vin, 'resource record VIN does not match its normalized vehicle')
  let counts = { factoryEquipment: 0, externalAutoCheck: 0 }
  if (value.factoryEquipment !== undefined && value.factoryEquipment !== null) {
    const next = validateFactoryEquipment(value.factoryEquipment, vin)
    counts = { factoryEquipment: counts.factoryEquipment + next.factoryEquipment, externalAutoCheck: counts.externalAutoCheck }
  }
  if (value.autoCheckReport !== undefined && value.autoCheckReport !== null) {
    const next = validateExternalAutoCheck(value.autoCheckReport, vin)
    counts = { factoryEquipment: counts.factoryEquipment, externalAutoCheck: counts.externalAutoCheck + next.externalAutoCheck }
  }
  ensure(counts.factoryEquipment + counts.externalAutoCheck > 0, 'resource record contains no usable resource')
  return counts
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
    'status', 'generatedAt', 'recordCount', 'factoryEquipmentCount', 'externalAutoCheckCount', 'path',
    'sha256', 'bytes', 'matchedVehicleCount', 'unmatchedRecordCount',
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
  ensure(factoryCount <= recordCount && autoCheckCount <= recordCount, 'resources type counts exceed the source record count')
  const attachedFactory = resourceRows.reduce((total, row) => total + row.counts.factoryEquipment, 0)
  const attachedAutoCheck = resourceRows.reduce((total, row) => total + row.counts.externalAutoCheck, 0)
  ensure(attachedFactory <= factoryCount && attachedAutoCheck <= autoCheckCount, 'attached resource type counts exceed validated source evidence')
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
    ensure(['in_stock', 'in_transit', 'in_production'].every((key) => typeof record[key] === 'boolean') && Array.isArray(record.source_sites), 'public source flags are missing')
    const url = new URL(record.listing_url)
    ensure(url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname === STORES[record.store].host && url.href.toUpperCase().includes(vin), 'public listing link must use HTTPS and match the VIN and physical store')
    byVin.set(vin, record)
    stocks.add(stockNumber)
  }
  const counts = storeCounts([...byVin.values()], 'store')
  matchOptionalCounts(run.metadata?.storeCounts, counts, 'public store totals')
  return { byVin, counts }
}

function crmRows(value, label) {
  const records = rows(value, label)
  const byVin = new Map()
  const stocks = new Set()
  for (const record of records) {
    ensure(object(record), `${label} record is invalid`)
    const vin = normalizedVin(record.vin)
    const stockNumber = stock(record.stockNumber)
    ensure(!byVin.has(vin) && !stocks.has(stockNumber), `${label} contains duplicate VIN/stock`)
    ensure(Object.hasOwn(STORES, record.storeName) && STORES[record.storeName].code === record.storeCode, `${label} store/code mismatch`)
    ensure(integer(record.sourceCellCount, 'CRM cell count') === 22 && Array.isArray(record.rawCellInnerText) && record.rawCellInnerText.length === 22 && Array.isArray(record.rawCellControlValues) && record.rawCellControlValues.length === 22, `${label} must preserve both 22-cell arrays`)
    byVin.set(vin, record)
    stocks.add(stockNumber)
  }
  return { records, byVin, stocks, counts: storeCounts(records, 'storeName') }
}

function validateCrmSummary(summary, parsed, label) {
  ensure(object(summary) && integer(summary.totalRows, `${label} count`) === parsed.records.length && integer(summary.uniqueVinCount, `${label} VIN count`) === parsed.byVin.size && integer(summary.uniqueStockCount, `${label} stock count`) === parsed.stocks.size, `${label} summary does not reconcile`)
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
  const excludeSource = snapshot.excludeActiveHoldsValidationSet
  ensure(object(excludeSource) && excludeSource.readOnly === true, 'exclude-holds control evidence is missing')
  const excluded = crmRows(excludeSource.rows, 'exclude-holds CRM')
  validateCrmSummary(excludeSource.summary, excluded, 'exclude-holds CRM')
  for (const [vin, record] of excluded.byVin) {
    const original = included.byVin.get(vin)
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
  const difference = new Set([...included.byVin.keys()].filter((vin) => !excluded.byVin.has(vin)))
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

/** Validate a full decrypted bundle; return independently derived non-sensitive totals. */
export function validateReleaseBundle(bundle) {
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
      resourceRows.push({ vin, resourceRecord: record.resourceRecord, counts: validateResourceRecord(record.resourceRecord, vin) })
    }
    seen.add(vin)
  }
  ensure(sameSet(seen, expectedVins), 'normalized inventory omits source VINs')
  validateResourceRun(release.sourceRuns?.resources, resourceRows, bundle.reportDate)
  return {
    reportDate: bundle.reportDate,
    publicRowCount: publicData.byVin.size,
    dealerMailRowCount: crm.byVin.size,
    heldVinCount: crm.held.size,
    activeHoldRecordCount: crm.counters.activeHoldDetailRows,
    backupCount: crm.counters.activeBackupHolds,
    deletedHoldRecordCount: crm.counters.deletedHistoricalHoldRows,
    publicStoreCounts: publicData.counts,
    crmStoreCounts: crm.counts,
    resourceRecordCount: resourceRows.length,
    vehicleCount: seen.size,
  }
}
