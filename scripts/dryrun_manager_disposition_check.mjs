// Manager-disposition dry-run oracle, modeled on dryrun_full_bundle_check.mjs:
// loads the release through the REAL importer (manifest gate + the exact
// manifest-bound *-operational.json loader), builds the same cloud bundle
// publish-cloud-release.mjs builds, and runs the REAL validateReleaseBundle.
// Prints the manager disposition counts the validator computes. Never publishes.
//
//   node scripts/dryrun_manager_disposition_check.mjs [YYYY-MM-DD]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasCompletedManifestEvidence, loadLatestCompletedRelease } from '../server/importer.mjs'
import { cloudReleaseFrom } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'

const REPORT_DATE = process.argv[2] ?? '2026-09-12'
const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const WORKSPACE_ROOT = path.resolve(APP_ROOT, '..', '..')

function mmddyyyy(iso) {
  return iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : ''
}

async function main() {
  const out = { report_date: REPORT_DATE, workspaceRoot: WORKSPACE_ROOT, pass: false }
  const fs = await import('node:fs/promises')
  const manifest = JSON.parse(await fs.readFile(path.join(WORKSPACE_ROOT, 'work', 'run-status', `${REPORT_DATE}.json`), 'utf8'))
  out.hasCompletedManifestEvidence = hasCompletedManifestEvidence(manifest)
  out.manifestBinding = manifest.manager_disposition_overlay ?? null

  const release = await loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT })
  out.loadLatestCompletedRelease_ok = true
  out.releaseReportDate = release.reportDate
  if (release.reportDate !== REPORT_DATE) throw new Error(`latest completed release is ${release.reportDate}, not ${REPORT_DATE}`)
  out.sourceRun_managerDisposition = release.sourceRuns.managerDisposition
    ? { ...release.sourceRuns.managerDisposition, snapshotPath: undefined }
    : null
  out.overlaySummary = release.managerDispositionOverlay?.summary ?? null
  out.overlayRecords = (release.managerDispositionOverlay?.records ?? []).map((record) => ({
    stock: record.stockNumber,
    vin: record.vin,
    vehicle: record.vehicleName,
    delivered: record.deliveredManagerLog,
    deliveryDate: mmddyyyy(record.deliveryDate),
    confidence: record.confidence,
    match: record.matchStatus,
    physicalStore: record.physicalStore,
    review: record.reviewRequired,
  }))
  out.managerWarnings = (release.warnings ?? []).filter((warning) => /manager disposition/i.test(warning))

  try {
    const bundle = cloudReleaseFrom(release)
    out.cloudReleaseFrom_ok = true
    const result = validateReleaseBundle(bundle)
    out.validateReleaseBundle_ok = true
    out.validatorManagerCounts = {
      managerDispositionRecordCount: result.managerDispositionRecordCount,
      managerSoldRecordCount: result.managerSoldRecordCount,
      managerDeliveredRecordCount: result.managerDeliveredRecordCount,
      managerDispositionReviewCount: result.managerDispositionReviewCount,
    }
    out.validateReleaseBundle_summary = result
    out.pass = true
  } catch (e) {
    out.validateReleaseBundle_ok = false
    out.validateReleaseBundle_error = e.message
    out.validateReleaseBundle_stack = e.stack
  }

  console.log(JSON.stringify(out, null, 2))
  if (!out.pass) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})