// Merge exact-VIN vAuto AutoCheck fallback facts after the Python resource
// builder. A dealership-website report always wins and removes the fallback.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

let resolvedRoot
function workspaceRoot() {
  resolvedRoot ??= resolveWorkspaceRoot(import.meta.url)
  return resolvedRoot
}
const APP_ROOT = path.resolve(import.meta.dirname, '..')
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file)
}

function websiteHasAutoCheck(vehicle) {
  return typeof vehicle?.autoCheckReport?.url === 'string' && vehicle.autoCheckReport.url.trim().length > 0
}

function usableCapture(record, vin) {
  return record?.result === 'OK' && record.vin === vin && record.autoCheckReport?.accessMethod === 'vauto' && record.autoCheckReport?.validatedVin === vin
}

export function mergeVautoAutoCheck({ enrichment, captures, vehicles }) {
  if (enrichment?.schemaVersion !== 'inventory-flow-vin-document-enrichment-v1' || !enrichment.recordsByVin || Array.isArray(enrichment.recordsByVin)) {
    throw new Error('INVALID_VIN_DOCUMENT_ENRICHMENT')
  }
  if (captures?.schema !== 'vauto-autocheck-capture-v1' || !Array.isArray(captures.records)) throw new Error('INVALID_VAUTO_AUTOCHECK_CAPTURE')
  const captureByVin = new Map(captures.records.filter((record) => VIN_RE.test(record?.vin ?? '')).map((record) => [record.vin, record]))
  const currentVins = new Set(Object.keys(vehicles))
  const stats = { websiteFirst: 0, fallbackAttached: 0, fallbackStale: 0, fallbackRemoved: 0 }

  for (const [vin, record] of Object.entries(enrichment.recordsByVin)) {
    if (!currentVins.has(vin) && record?.autoCheckReport?.accessMethod === 'vauto') {
      delete record.autoCheckReport
      stats.fallbackRemoved += 1
      if (!Object.keys(record).some((key) => key !== 'vin')) delete enrichment.recordsByVin[vin]
    }
  }

  for (const [vin, vehicle] of Object.entries(vehicles)) {
    const existing = enrichment.recordsByVin[vin]
    if (websiteHasAutoCheck(vehicle)) {
      stats.websiteFirst += 1
      if (existing?.autoCheckReport?.accessMethod === 'vauto') {
        delete existing.autoCheckReport
        stats.fallbackRemoved += 1
        if (!Object.keys(existing).some((key) => key !== 'vin')) delete enrichment.recordsByVin[vin]
      }
      continue
    }
    const capture = captureByVin.get(vin)
    if (usableCapture(capture, vin)) {
      const entry = enrichment.recordsByVin[vin] ?? { vin }
      entry.autoCheckReport = capture.autoCheckReport
      enrichment.recordsByVin[vin] = entry
      stats.fallbackAttached += 1
    } else if (existing?.autoCheckReport?.accessMethod === 'vauto') {
      existing.autoCheckReport.dataState = 'stale_unverified'
      stats.fallbackStale += 1
    }
  }
  enrichment.recordsByVin = Object.fromEntries(Object.entries(enrichment.recordsByVin).sort(([left], [right]) => left.localeCompare(right)))
  return { enrichment, stats }
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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main() } catch (error) {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  }
}
