// Merge exact-VIN vAuto AutoCheck fallback facts after the Python resource
// builder. A dealership-website report always wins and removes the fallback.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { validateServiceHistoryEvidence } from '../server/provider-evidence.mjs'
import { VAUTO_AUTOCHECK_SERVICE_SOURCE, VAUTO_AUTOCHECK_MECHANICAL_DESCRIPTIONS } from './capture-vauto-autocheck.mjs'
import { writeJsonAtomic } from './lib/atomic-write.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { isMainModule } from './lib/is-main.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

let resolvedRoot
function workspaceRoot() {
  resolvedRoot ??= resolveWorkspaceRoot(import.meta.url)
  return resolvedRoot
}
const APP_ROOT = path.resolve(import.meta.dirname, '..')
const MECHANICAL_DESCRIPTIONS = new Set(VAUTO_AUTOCHECK_MECHANICAL_DESCRIPTIONS)
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function websiteHasAutoCheck(vehicle) {
  return typeof vehicle?.autoCheckReport?.url === 'string' && vehicle.autoCheckReport.url.trim().length > 0
}

function usableCapture(record, vin) {
  return record?.result === 'OK' && record.vin === vin && record.autoCheckReport?.accessMethod === 'vauto' && record.autoCheckReport?.validatedVin === vin
}

function isFallbackServiceReport(report) {
  return report?.provider === 'autocheck' && report.sourceLabel === VAUTO_AUTOCHECK_SERVICE_SOURCE
}
function removeFallbackServiceHistory(entry) {
  if (!entry?.serviceHistory?.reports) return false
  const reports = entry.serviceHistory.reports.filter(report => !isFallbackServiceReport(report))
  const changed = reports.length !== entry.serviceHistory.reports.length
  if (reports.length) entry.serviceHistory = { reports }
  else delete entry.serviceHistory
  return changed
}
function staleFallbackServiceHistory(entry) {
  const reports = entry?.serviceHistory?.reports
  if (!reports?.some(isFallbackServiceReport)) return false
  entry.serviceHistory = { reports: reports.map(report => isFallbackServiceReport(report) ? { ...report, dataState: 'stale_unverified' } : report) }
  return true
}
function capturedServiceHistory(capture, vin) {
  if (!capture?.serviceHistory || capture.autoCheckReport?.dataState !== 'current') return null
  try {
    const normalized = validateServiceHistoryEvidence(capture.serviceHistory, vin)
    if (!normalized.reports.length || normalized.reports.some(report => !isFallbackServiceReport(report) || report.capturedAt !== capture.autoCheckReport.capturedAt || report.dataState !== 'current' || report.historyStatus !== 'reported' || report.entries.some(entry => !entry.services.length || entry.services.some(service => !MECHANICAL_DESCRIPTIONS.has(service))))) return null
    return normalized
  } catch { return null }
}

export function mergeVautoAutoCheck({ enrichment, captures, vehicles }) {
  if (enrichment?.schemaVersion !== 'inventory-flow-vin-document-enrichment-v1' || !enrichment.recordsByVin || Array.isArray(enrichment.recordsByVin)) {
    throw new Error('INVALID_VIN_DOCUMENT_ENRICHMENT')
  }
  if (captures?.schema !== 'vauto-autocheck-capture-v1' || !Array.isArray(captures.records)) throw new Error('INVALID_VAUTO_AUTOCHECK_CAPTURE')
  const captureByVin = new Map(captures.records.filter((record) => VIN_RE.test(record?.vin ?? '')).map((record) => [record.vin, record]))
  const currentVins = new Set(Object.keys(vehicles))
  const stats = { websiteFirst: 0, fallbackAttached: 0, fallbackStale: 0, fallbackRemoved: 0, serviceHistoryAttached: 0, serviceHistoryStale: 0, serviceHistoryRemoved: 0 }

  for (const [vin, record] of Object.entries(enrichment.recordsByVin)) {
    if (!currentVins.has(vin)) {
      if (record?.autoCheckReport?.accessMethod === 'vauto') { delete record.autoCheckReport; stats.fallbackRemoved += 1 }
      if (removeFallbackServiceHistory(record)) stats.serviceHistoryRemoved += 1
      if (!Object.keys(record).some((key) => key !== 'vin')) delete enrichment.recordsByVin[vin]
    }
  }

  for (const [vin, vehicle] of Object.entries(vehicles)) {
    const existing = enrichment.recordsByVin[vin]
    if (websiteHasAutoCheck(vehicle)) {
      stats.websiteFirst += 1
      if (removeFallbackServiceHistory(existing)) stats.serviceHistoryRemoved += 1
      if (existing?.autoCheckReport?.accessMethod === 'vauto') {
        delete existing.autoCheckReport
        stats.fallbackRemoved += 1
        if (!Object.keys(existing).some((key) => key !== 'vin')) delete enrichment.recordsByVin[vin]
      }
      if (existing && !Object.keys(existing).some(key => key !== 'vin')) delete enrichment.recordsByVin[vin]
      continue
    }
    const capture = captureByVin.get(vin)
    if (usableCapture(capture, vin)) {
      const entry = enrichment.recordsByVin[vin] ?? { vin }
      entry.autoCheckReport = capture.autoCheckReport
      const serviceHistory = capturedServiceHistory(capture, vin)
      if (serviceHistory) {
        const retained = (entry.serviceHistory?.reports ?? []).filter(report => !isFallbackServiceReport(report))
        entry.serviceHistory = validateServiceHistoryEvidence({ reports: [...retained, ...serviceHistory.reports] }, vin)
        stats.serviceHistoryAttached += 1
      } else if (staleFallbackServiceHistory(entry)) stats.serviceHistoryStale += 1
      enrichment.recordsByVin[vin] = entry
      stats.fallbackAttached += 1
    } else {
      if (existing?.autoCheckReport?.accessMethod === 'vauto') {
        existing.autoCheckReport.dataState = 'stale_unverified'
        stats.fallbackStale += 1
      }
      if (staleFallbackServiceHistory(existing)) stats.serviceHistoryStale += 1
    }
  }
  enrichment.recordsByVin = Object.fromEntries(Object.entries(enrichment.recordsByVin).sort(([left], [right]) => left.localeCompare(right)))
  // This count is also regenerated by the publication importer from the final
  // enrichment records; do not add metadata to the enrichment file's schema.
  const serviceHistoryCount = Object.values(enrichment.recordsByVin).filter(record => record?.serviceHistory?.reports?.length > 0).length
  return { enrichment, stats, metadata: serviceHistoryCount > 0 ? { serviceHistoryCount } : {} }
}

export function main(argv = process.argv.slice(2)) {
  const [reportDate] = argv
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')) {
    console.error('usage: merge-vauto-autocheck.mjs <YYYY-MM-DD>')
    return 2
  }
  const enrichmentPath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
  const root = workspaceRoot()
  const capturePath = path.join(root, 'work', 'vauto-history', `${reportDate}-autocheck.json`)
  const result = mergeVautoAutoCheck({
    enrichment: readJson(enrichmentPath),
    captures: existsSync(capturePath)
      ? readJson(capturePath)
      : { schema: 'vauto-autocheck-capture-v1', reportDate, records: [] },
    vehicles: loadDatedInventoryVehicles(root, reportDate),
  })
  writeJsonAtomic(enrichmentPath, result.enrichment)
  console.log(JSON.stringify({ reportDate, records: Object.keys(result.enrichment.recordsByVin).length, ...result.stats }))
  return 0
}

if (isMainModule(import.meta.url)) {
  try { process.exitCode = main() } catch (error) {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  }
}
