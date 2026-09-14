// Dry-run: verify today's run-status manifest passes the real gate functions
// before running the actual cloud:publish-release command.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCompletedManifestEvidence, findLatestCompletedManifest, loadLatestCompletedRelease } from '../server/importer.mjs';

const REPORT_DATE = '2026-09-11';
const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKSPACE_ROOT = path.resolve(APP_ROOT, '..', '..');

async function main() {
  const out = { report_date: REPORT_DATE, workspaceRoot: WORKSPACE_ROOT };

  try {
    const manifestPath = await findLatestCompletedManifest(WORKSPACE_ROOT);
    out.findLatestCompletedManifest = manifestPath;
  } catch (e) {
    out.findLatestCompletedManifest_error = e.message;
  }

  try {
    const fs = await import('node:fs/promises');
    const manifestRaw = await fs.readFile(path.join(WORKSPACE_ROOT, 'work', 'run-status', `${REPORT_DATE}.json`), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const evidence = hasCompletedManifestEvidence(manifest);
    out.hasCompletedManifestEvidence = evidence;
  } catch (e) {
    out.hasCompletedManifestEvidence_error = e.message;
    out.hasCompletedManifestEvidence_stack = e.stack;
  }

  try {
    const release = await loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT });
    out.loadLatestCompletedRelease_ok = true;
    out.release_summary = {
      reportDate: release?.reportDate,
      hasPublicSnapshot: !!release?.publicSnapshot,
      hasDealerMailSnapshot: !!release?.dealerMailSnapshot,
      hasWorkbook: !!release?.workbook,
    };
  } catch (e) {
    out.loadLatestCompletedRelease_ok = false;
    out.loadLatestCompletedRelease_error = e.message;
    out.loadLatestCompletedRelease_stack = e.stack;
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
