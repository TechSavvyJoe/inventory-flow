// Resource-channel dry-run oracle: exercises the REAL validators end-to-end on
// apps/inventory-ops/data/vin-document-enrichment.json.
//   1. importer.mjs validateVinDocumentEnrichment() on the file itself
//   2. loadLatestCompletedRelease() (same importer path the publisher uses) for the
//      expected report date, then cloudReleaseFrom() + cloudflare validateReleaseBundle()
//   Prints resourceRecordCount and exits non-zero on any failure. Never publishes.
//
//   node scripts/dryrun_resource_enrichment_check.mjs [YYYY-MM-DD]
//   (defaults to today's date in America/New_York)
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLatestCompletedRelease, validateVinDocumentEnrichment } from '../server/importer.mjs'
import { cloudReleaseFrom } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta.url)
const ENRICHMENT_PATH = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')

function todayInNewYork() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

const REPORT_DATE = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : todayInNewYork()

async function main() {
  const out = { report_date: REPORT_DATE, workspaceRoot: WORKSPACE_ROOT, enrichmentPath: ENRICHMENT_PATH }
  let failed = false

  // 1. the enrichment file on its own, through the importer's validator
  try {
    const raw = JSON.parse(readFileSync(ENRICHMENT_PATH, 'utf8'))
    const validated = validateVinDocumentEnrichment(raw)
    const records = Object.values(validated.recordsByVin)
    out.validateVinDocumentEnrichment_ok = true
    out.validateVinDocumentEnrichment_summary = {
      ...validated.metadata,
      withCaiUrl: records.filter((record) => typeof record.factoryEquipment?.url === 'string').length,
      withPricing: records.filter((record) => record.factoryEquipment && ['basePrice', 'totalMsrp', 'totalOptions', 'destinationCharge'].some((key) => record.factoryEquipment[key] !== undefined)).length,
      withPackagesOrSections: records.filter((record) => (record.factoryEquipment?.packages?.length ?? 0) + (record.factoryEquipment?.sections?.length ?? 0) > 0).length,
      withFordOasis: records.filter((record) => Boolean(record.fordOasis)).length,
      withOpenFieldServiceActions: records.filter((record) => (record.fordOasis?.openFieldServiceActions?.length ?? 0) > 0).length,
      fordOasisOnly: records.filter((record) => record.fordOasis && !record.factoryEquipment && !record.autoCheckReport).length,
    }
  } catch (error) {
    failed = true
    out.validateVinDocumentEnrichment_ok = false
    out.validateVinDocumentEnrichment_error = error.message
    out.validateVinDocumentEnrichment_details = error.details ?? null
  }

  // 2. the full release path: importer gate -> cloud bundle -> cloud validator
  try {
    const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT })
    out.loadLatestCompletedRelease_ok = true
    out.releaseReportDate = release.reportDate
    if (release.reportDate !== REPORT_DATE) {
      failed = true
      out.releaseReportDate_error = `latest completed release is ${release.reportDate}, expected ${REPORT_DATE}`
    }
    const resources = release.sourceRuns?.resources ?? null
    out.resourcesSourceRun = resources
      ? {
          status: resources.status,
          staleReason: resources.staleReason,
          rowCount: resources.rowCount,
          recordCount: resources.metadata?.recordCount,
          factoryEquipmentCount: resources.metadata?.factoryEquipmentCount,
          externalAutoCheckCount: resources.metadata?.externalAutoCheckCount,
          fordOasisCount: resources.metadata?.fordOasisCount,
          matchedVehicleCount: resources.metadata?.matchedVehicleCount,
          unmatchedRecordCount: resources.metadata?.unmatchedRecordCount,
        }
      : null
    out.releaseWarnings = release.warnings ?? []

    const bundle = cloudReleaseFrom(release)
    out.cloudReleaseFrom_ok = true
    const result = validateReleaseBundle(bundle)
    out.validateReleaseBundle_ok = true
    out.validateReleaseBundle_summary = result
    out.resourceRecordCount = result.resourceRecordCount
    out.fordOasisRecordCount = result.fordOasisRecordCount
    out.attachedFordOasisRecordCount = (release.vehicles ?? []).filter((vehicle) => vehicle.resourceRecord?.fordOasis).length
  } catch (error) {
    failed = true
    out.validateReleaseBundle_ok = false
    out.validateReleaseBundle_error = error.message
    out.validateReleaseBundle_details = error.details ?? null
  }

  out.PASS = !failed
  console.log(JSON.stringify(out, null, 2))
  if (failed) process.exit(1)
}

main().catch((error) => {
  console.error('FATAL', error)
  process.exit(1)
})
