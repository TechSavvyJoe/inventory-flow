// Merge exact-VIN Ford PTS service history after the Python resource builder.
// This keeps current DealerMail-only inventory in the same Ford/Lincoln source
// workflow as vehicles that are already listed on a dealership website.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { validateVinDocumentEnrichment } from '../server/importer.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { isMainModule } from './lib/is-main.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const APP_ROOT = path.resolve(import.meta.dirname, '..')
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const FORD_MAKES = new Set(['FORD', 'LINC', 'LINCOLN'])
const SOURCE_LABEL = 'Ford PTS Retail Service Repair History (read-only; no customer data)'
const COMPLETE_RESULTS = new Set(['OK', 'NO_HISTORY'])
const CAPTURE_DATA_STATES = new Set(['current', 'stale_unverified'])
let resolvedRoot

function workspaceRoot() {
  resolvedRoot ??= resolveWorkspaceRoot(import.meta.url)
  return resolvedRoot
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file)
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function shapeInspection(value) {
  const status = value?.status === 'confirmed' ? 'confirmed' : 'not_identified'
  const type = optionalText(value?.type)
  return { status, ...(status === 'confirmed' && type ? { type } : {}) }
}

function shapeRepairOrder(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const order = {
    repairOrderNumber: optionalText(value.repairOrderNumber),
    dealerCode: optionalText(value.dealerCode),
    openDate: optionalText(value.openDate),
    closeDate: optionalText(value.closeDate),
    detailComplete: value.detailComplete === true,
    inspection: shapeInspection(value.inspection),
    // The release carries staff-useful service categories only. Raw PTS parts,
    // labor, and free-form repair notes remain outside the public app payload.
    parts: [],
    laborOperations: [],
    services: Array.isArray(value.services)
      ? value.services.slice(0, 20).map(optionalText).filter(Boolean)
      : [],
  }
  if (Number.isSafeInteger(value.odometer)) order.odometer = value.odometer
  return order
}

function shapeRepairOrderTimeline(record) {
  const detailedByFingerprint = new Map((record.checkedRepairOrders || [])
    .filter((order) => order?.detailComplete === true)
    .map((order) => [`${order.repairOrderNumber}|${order.openDate}|${order.closeDate}|${order.odometer ?? ''}`, order]))
  const index = Array.isArray(record.repairOrderIndex) && record.repairOrderIndex.length
    ? record.repairOrderIndex
    : record.checkedRepairOrders || []
  return index.flatMap((order) => {
    const openDate = optionalText(order?.openDate)
    const closeDate = optionalText(order?.closeDate)
    if (!openDate || !closeDate) return []
    const detailed = detailedByFingerprint.get(`${order.repairOrderNumber}|${openDate}|${closeDate}|${order.odometer ?? ''}`)
    const visit = { openDate, closeDate }
    if (Number.isSafeInteger(order?.odometer)) visit.odometer = order.odometer
    const services = Array.isArray(detailed?.services)
      ? detailed.services.slice(0, 20).map(optionalText).filter(Boolean)
      : []
    if (services.length) visit.services = services
    return [visit]
  })
}

function usableCapture(record, vin) {
  return record?.vin === vin && COMPLETE_RESULTS.has(record.result) && CAPTURE_DATA_STATES.has(record.dataState) &&
    record.historyCaptured === true && typeof record.checkedAt === 'string' && Number.isFinite(Date.parse(record.checkedAt))
}

function shapeServiceHistory(record) {
  const history = {
    dataState: record.dataState,
    checkedAt: record.checkedAt,
    sourceLabel: SOURCE_LABEL,
    historyCaptured: true,
    repairOrderCount: record.repairOrderCount,
    detailScanCount: record.detailScanCount,
    inspectionSearchStatus: record.inspectionSearchStatus,
  }
  const latestRepairOrder = shapeRepairOrder(record.latestRepairOrder)
  const recentInspection = shapeRepairOrder(record.recentInspection)
  const recentRepairOrders = Array.isArray(record.checkedRepairOrders)
    ? record.checkedRepairOrders.filter((order) => order?.detailComplete === true).slice(0, 5).map(shapeRepairOrder).filter(Boolean)
    : []
  const repairOrderTimeline = shapeRepairOrderTimeline(record)
  if (latestRepairOrder) history.latestRepairOrder = latestRepairOrder
  if (recentInspection) history.recentInspection = recentInspection
  if (recentRepairOrders.length) history.recentRepairOrders = recentRepairOrders
  if (repairOrderTimeline.length) history.repairOrderTimeline = repairOrderTimeline
  return history
}

function minimalFordOasis(checkedAt) {
  return {
    dataState: 'current',
    capturedAt: checkedAt,
    sourceLabel: SOURCE_LABEL,
    openActionsCaptured: false,
    openFieldServiceActions: [],
    warrantyCoverages: [],
    extendedCoverageExpirations: [],
  }
}

export function mergeFordServiceHistory({ enrichment, captures, vehicles }) {
  if (enrichment?.schemaVersion !== 'inventory-flow-vin-document-enrichment-v1' || !enrichment.recordsByVin || Array.isArray(enrichment.recordsByVin)) {
    throw new Error('INVALID_VIN_DOCUMENT_ENRICHMENT')
  }
  if (captures?.schema !== 'bob-maxey-ford-service-history-v1' || !Array.isArray(captures.records)) {
    throw new Error('INVALID_FORD_SERVICE_HISTORY_CAPTURE')
  }

  const activeFordVins = new Set(Object.entries(vehicles).flatMap(([rawVin, vehicle]) => {
    const vin = String(rawVin || '').trim().toUpperCase()
    const make = String(vehicle?.make || '').trim().toUpperCase()
    return VIN_RE.test(vin) && FORD_MAKES.has(make) ? [vin] : []
  }))
  const captureByVin = new Map(captures.records.flatMap((record) => {
    const vin = String(record?.vin || '').trim().toUpperCase()
    return VIN_RE.test(vin) && usableCapture(record, vin) ? [[vin, record]] : []
  }))
  const stats = { activeFord: activeFordVins.size, attached: 0, created: 0, staleRemoved: 0 }

  for (const [vin, entry] of Object.entries(enrichment.recordsByVin)) {
    if (!entry?.fordOasis?.serviceHistory) continue
    if (!activeFordVins.has(vin) || !captureByVin.has(vin)) {
      delete entry.fordOasis.serviceHistory
      stats.staleRemoved += 1
    }
  }

  for (const vin of activeFordVins) {
    const capture = captureByVin.get(vin)
    if (!capture) continue
    const entry = enrichment.recordsByVin[vin] ?? { vin }
    if (!entry.fordOasis) {
      entry.fordOasis = minimalFordOasis(capture.checkedAt)
      stats.created += 1
    }
    entry.fordOasis.serviceHistory = shapeServiceHistory(capture)
    enrichment.recordsByVin[vin] = entry
    stats.attached += 1
  }

  enrichment.generatedAt = new Date().toISOString()
  enrichment.recordsByVin = Object.fromEntries(Object.entries(enrichment.recordsByVin).sort(([left], [right]) => left.localeCompare(right)))
  // Fail closed before any resource file can reach release publication.
  validateVinDocumentEnrichment(enrichment)
  return { enrichment, stats }
}

export function main(argv = process.argv.slice(2)) {
  const [reportDate] = argv
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) throw new Error('usage: merge-ford-service-history.mjs <YYYY-MM-DD>')
  const root = workspaceRoot()
  const enrichmentPath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
  const capturePath = path.join(root, 'work', 'service-history', `${reportDate}-service-history.json`)
  const captures = existsSync(capturePath)
    ? readJson(capturePath)
    : { schema: 'bob-maxey-ford-service-history-v1', reportDate, records: [] }
  if (captures.reportDate !== reportDate) throw new Error('FORD_SERVICE_HISTORY_DATE_MISMATCH')
  const result = mergeFordServiceHistory({
    enrichment: readJson(enrichmentPath),
    captures,
    vehicles: loadDatedInventoryVehicles(root, reportDate),
  })
  writeJsonAtomic(enrichmentPath, result.enrichment)
  process.stdout.write(`${JSON.stringify({ reportDate, records: Object.keys(result.enrichment.recordsByVin).length, ...result.stats })}\n`)
}

if (isMainModule(import.meta.url)) {
  try { main() } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
