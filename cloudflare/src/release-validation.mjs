// Portable validation for the encrypted daily evidence import. This module has
// no filesystem, Node runtime, credentials, or source-fetching dependencies.
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
      // The importer removes its validation-only VIN marker from presentation
      // documents. The original exact-VIN evidence remains in publicSnapshot.
      if (source[key].validated_vin !== undefined && normalizedVin(source[key].validated_vin) !== normalizedVin(source.vin)) return false
      return Object.keys(source[key]).filter((field) => field !== 'validated_vin').every((field) => sameValue(source[key][field], actual[key][field]))
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
    ensure(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port && url.hostname === STORES[record.store].host && url.href.toUpperCase().includes(vin), 'public listing link does not match VIN and physical store')
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
  const included = crmRows(inventory.rows, 'complete CRM')
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
  const expectedVins = new Set([...publicData.byVin.keys(), ...crm.byVin.keys()])
  const normalized = rows(release.vehicles, 'normalized inventory', 1)
  const seen = new Set()
  for (const record of normalized) {
    ensure(object(record), 'normalized record is invalid')
    const vin = normalizedVin(record.vin)
    ensure(expectedVins.has(vin) && !seen.has(vin), 'normalized inventory VIN is duplicate or unrelated')
    for (const [field, source, enrich] of [['publicRecord', publicData.byVin.get(vin), true], ['crmRecord', crm.byVin.get(vin), false], ['holdRecord', crm.held.get(vin), false], ['cdkRecord', crm.cdk.get(vin), false]]) {
      if (source) sourceMatches(record[field], source, field, enrich)
      else ensure(record[field] === null || record[field] === undefined, `${field} has no matching source evidence`)
    }
    seen.add(vin)
  }
  ensure(sameSet(seen, expectedVins), 'normalized inventory omits source VINs')
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
    vehicleCount: seen.size,
  }
}
