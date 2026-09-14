// Full dry-run oracle: exercises the REAL production validators end-to-end
// (importer.mjs's manifest/snapshot gate, then the same cloudReleaseFrom +
// validateReleaseBundle path publish-cloud-release.mjs calls internally)
// against today's data, before touching the actual publish command.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasCompletedManifestEvidence, loadLatestCompletedRelease, validateDealerMailSnapshot } from '../server/importer.mjs'
import { cloudReleaseFrom } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'

function todayInNewYork() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const REPORT_DATE = process.argv[2] || todayInNewYork()
if (!/^\d{4}-\d{2}-\d{2}$/.test(REPORT_DATE)) {
  throw new Error('report date must be YYYY-MM-DD')
}
const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const WORKSPACE_ROOT = path.resolve(APP_ROOT, '..', '..')

async function main() {
  const out = { report_date: REPORT_DATE, workspaceRoot: WORKSPACE_ROOT }

  const fs = await import('node:fs/promises')
  const manifestRaw = await fs.readFile(path.join(WORKSPACE_ROOT, 'work', 'run-status', `${REPORT_DATE}.json`), 'utf8')
  const manifest = JSON.parse(manifestRaw)
  out.hasCompletedManifestEvidence = hasCompletedManifestEvidence(manifest)

  const release = await loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT })
  out.loadLatestCompletedRelease_ok = true
  out.releaseReportDate = release?.reportDate
  out.releaseReportDateMatches = release?.reportDate === REPORT_DATE
  out.dealerMailSnapshotPathUsed = manifest.dealermail_snapshot_path

  try {
    const validated = validateDealerMailSnapshot(release.dealerMailSnapshot, { reportDate: REPORT_DATE })
    out.importerValidateDealerMailSnapshot_ok = true
    out.importerValidateDealerMailSnapshot_summary = {
      rowCount: validated.rowCount,
      heldVinCount: validated.heldVinCount,
      vinReconciledRowCount: validated.vinReconciledRowCount,
    }
  } catch (e) {
    out.importerValidateDealerMailSnapshot_ok = false
    out.importerValidateDealerMailSnapshot_error = e.message
  }

  try {
    const bundle = cloudReleaseFrom(release)
    out.cloudReleaseFrom_ok = true
    const result = validateReleaseBundle(bundle)
    out.validateReleaseBundle_ok = true
    out.validateReleaseBundle_summary = result
  } catch (e) {
    out.validateReleaseBundle_ok = false
    out.validateReleaseBundle_error = e.message
    out.validateReleaseBundle_stack = e.stack
  }

  console.log(JSON.stringify(out, null, 2))
  const passed = out.hasCompletedManifestEvidence === true &&
    out.releaseReportDateMatches === true &&
    out.importerValidateDealerMailSnapshot_ok === true &&
    out.cloudReleaseFrom_ok === true &&
    out.validateReleaseBundle_ok === true
  if (!passed) process.exitCode = 1
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
