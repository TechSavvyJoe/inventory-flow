// Dry-run: verify a run-status manifest passes the real gate functions before
// running the actual cloud:publish-release command.
//
//   node scripts/dryrun_manifest_check.mjs [YYYY-MM-DD]
//   (defaults to today's date in America/New_York)
//
// Every check reports through the JSON summary and sets the exit code, so this
// can serve as the advertised pre-publish gate rather than a diagnostic print.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { hasCompletedManifestEvidence, findLatestCompletedManifest, loadLatestCompletedRelease } from '../server/importer.mjs';
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs';

function todayInNewYork() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const REPORT_DATE = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : todayInNewYork();
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta.url);

function main() {
  const out = { report_date: REPORT_DATE, workspaceRoot: WORKSPACE_ROOT };
  let failed = false;

  try {
    out.findLatestCompletedManifest = findLatestCompletedManifest(WORKSPACE_ROOT);
  } catch (e) {
    failed = true;
    out.findLatestCompletedManifest_error = e.message;
  }

  try {
    const manifestPath = path.join(WORKSPACE_ROOT, 'work', 'run-status', `${REPORT_DATE}.json`);
    out.manifestPath = manifestPath;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const evidence = hasCompletedManifestEvidence(manifest);
    out.hasCompletedManifestEvidence = evidence;
    if (evidence !== true) {
      failed = true;
      out.hasCompletedManifestEvidence_error = `${REPORT_DATE} manifest does not carry completed evidence`;
    }
  } catch (e) {
    failed = true;
    out.hasCompletedManifestEvidence_error = e.message;
  }

  try {
    const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT });
    out.loadLatestCompletedRelease_ok = true;
    out.release_summary = {
      reportDate: release?.reportDate,
      hasPublicSnapshot: !!release?.publicSnapshot,
      hasDealerMailSnapshot: !!release?.dealerMailSnapshot,
      hasWorkbook: !!release?.workbook,
    };
    // The manifest and the loaded release must describe the same day, or this
    // gate would validate one day's evidence against another day's artifacts.
    if (release?.reportDate !== REPORT_DATE) {
      failed = true;
      out.releaseReportDate_error = `latest completed release is ${release?.reportDate}, expected ${REPORT_DATE}`;
    }
  } catch (e) {
    failed = true;
    out.loadLatestCompletedRelease_ok = false;
    out.loadLatestCompletedRelease_error = e.message;
  }

  out.PASS = !failed;
  console.log(JSON.stringify(out, null, 2));
  if (failed) process.exitCode = 1;
}

try {
  main();
} catch (e) {
  console.error('FATAL', e);
  process.exit(1);
}
