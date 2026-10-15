import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadLatestCompletedRelease, validateVinDocumentEnrichment } from '../server/importer.mjs'
import { sanitizeManagerDispositionDocuments } from '../server/manager-disposition-schema.mjs'
import { cloudBundleSha256, cloudReleaseFrom, publishedManifestFrom } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'
import { writeAtomicFile, writeJsonAtomic } from './lib/atomic-write.mjs'
import { assertRetainedPublication, readRetainedPublication } from './publication-followup-metadata.mjs'
import { assessOasisCapture } from './lib/oasis-parser.mjs'
import { acquirePublicationLock, assertInheritedPublicationLock, readPublicationReconciliation, receiptSourceHashes, releasePublicationLock } from './sync-cloud-release.mjs'

const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta.url)
const APP_ROOT = path.join(WORKSPACE_ROOT, 'apps', 'inventory-ops')
const WORK_ROOT = path.join(WORKSPACE_ROOT, 'work')
const RUNTIME_ROOT = path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies')
const NODE = existsSync(path.join(RUNTIME_ROOT, 'node', 'bin', 'node.exe')) ? path.join(RUNTIME_ROOT, 'node', 'bin', 'node.exe') : process.execPath
const PYTHON = existsSync(path.join(RUNTIME_ROOT, 'python', 'python.exe')) ? path.join(RUNTIME_ROOT, 'python', 'python.exe') : 'python'
const POWERSHELL = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell'
const AVAILABILITY_CAVEAT = 'Public listings, source flags, expected dates, holds, CDK responses, manager sold logs, and resource records do not independently establish availability, a sale, delivery, funding, paperwork completion, or physical location. Confirm with the appropriate store before customer commitment.'
const DEALERMAIL_REVISION_SUFFIXES = [
  'deep-capture-raw.json',
  'exclude-view-raw.json',
  'hold-details-raw.json',
  'complete-list-raw-cells.json',
  'complete-inventory-raw.json',
  'complete-used-inventory-deep-cloud-ready.json',
]
const PUBLICATION_LOCK_OWNER_ENV = 'INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID'
const PUBLICATION_LOCKED = 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
// Matches capture-invoices.mjs's non-blocking, non-zero-exit outcomes: a systemic stop
// (session_expired / FETCH_ERROR in the stoppedReason) as well as a run that finished the
// queue with only per-vehicle failures left over, which exits 0 but prints
// "sessionStatus":"incomplete" - that must still surface as a warning, not disappear as
// 'complete'. See scripts/lib/invoice-capture-outcome.mjs computeSessionStatus/computeExitCode.
const INVOICE_CAPTURE_EXPIRED_PATTERN = /session_expired|FETCH_ERROR|"sessionStatus":"incomplete"/i
const DEALERMAIL_SNAPSHOT_REJECTED = 'DEALERMAIL_SNAPSHOT_REJECTED'
const DEALERMAIL_ATTEMPTS = 2

// Process, clock, and browser seams. Production always uses the real ones;
// tests swap them through internals.runtime.
const runtime = {
  run: (...args) => run(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ensureAutomationBrowser: (warnings) => ensureAutomationBrowser(warnings),
  dealerMailRetryDelayMs: 20000,
  writeCollectorBaselineFile: (filePath, content) => writeCollectorBaselineFile(filePath, content),
  writeCollectorPromotionBackup: (filePath, content) => writeCollectorPromotionBackup(filePath, content),
}

function parseArgs(argv) {
  const options = {
    date: null,
    dryRun: false,
    noPublish: false,
    forcePublish: false,
    skipAuthenticated: false,
    refreshHolds: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--date') options.date = argv[++index]
    else if (arg === '--workspace-root') index += 1
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-publish') options.noPublish = true
    else if (arg === '--force-publish') options.forcePublish = true
    else if (arg === '--skip-authenticated') options.skipAuthenticated = true
    else if (arg === '--refresh-holds') options.refreshHolds = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('--date must be YYYY-MM-DD')
  return options
}

function todayInNewYork(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function validationClockFor(reportDate) {
  return new Date(`${reportDate}T16:00:00-04:00`)
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase()
}

function fileInfo(filePath) {
  const stats = statSync(filePath)
  return { sha256: sha256(filePath), bytes: stats.size }
}

function writeJson(filePath, value) {
  // The local API re-imports the manifest every few minutes and the cloud sync
  // reads it concurrently; fsync the temp bytes and directory before readers
  // can observe the renamed path.
  writeJsonAtomic(filePath, value)
}

function writeBuffer(filePath, value) {
  writeAtomicFile(filePath, value)
}

function captureFileTransaction(filePaths) {
  const before = new Map([...new Set(filePaths)].map((filePath) => [
    filePath,
    existsSync(filePath) ? readFileSync(filePath) : null,
  ]))
  let finished = false
  return {
    commit() { finished = true },
    rollback() {
      if (finished) return
      for (const [filePath, content] of before) {
        if (content === null) {
          try { unlinkSync(filePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
        } else {
          writeBuffer(filePath, content)
        }
      }
      finished = true
    },
  }
}

function normalizedHash(value) {
  const text = String(value ?? '').trim().toUpperCase()
  return /^[A-F0-9]{64}$/.test(text) ? text : null
}

function sameHash(left, right) {
  const normalizedLeft = normalizedHash(left)
  return normalizedLeft !== null && normalizedLeft === normalizedHash(right)
}

function resolveBoundWorkspacePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}_PATH_MISSING`)
  const resolved = path.resolve(WORKSPACE_ROOT, value)
  const relative = path.relative(WORKSPACE_ROOT, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label}_PATH_OUTSIDE_WORKSPACE`)
  }
  return resolved
}

function readReceiptState(receiptPath) {
  if (!existsSync(receiptPath)) return { raw: null, receipt: null }
  const raw = readFileSync(receiptPath, 'utf8')
  try { return { raw, receipt: JSON.parse(raw) } } catch { return { raw, receipt: null } }
}

function readReceiptStateAfterPublication(receiptPath) {
  try {
    return { ...readReceiptState(receiptPath), lookupFailed: false }
  } catch {
    // Once the publisher has run, losing access to the local receipt cannot be
    // treated as proof that the remote candidate was never accepted.
    return { raw: null, receipt: null, lookupFailed: true }
  }
}

function verifiedReceiptIdentityIsValid(receipt, expectedReportDate) {
  return receipt?.status === 'published_and_verified' &&
    receipt?.complete === true &&
    (!expectedReportDate || receipt.reportDate === expectedReportDate) &&
    normalizedHash(receipt.bundleSha256) !== null &&
    typeof receipt.verifiedAt === 'string' &&
    Number.isFinite(Date.parse(receipt.verifiedAt))
}

function assertReceiptHashes(receipt, expectedHashes, expectedReportDate = null) {
  if (!verifiedReceiptIdentityIsValid(receipt, expectedReportDate)) return false
  return ['public', 'dealerMail', 'resources', 'managerDisposition', 'managerDispositionBinding']
    .every((key) => {
      const expected = expectedHashes[key] ?? null
      const actual = receipt.sourceHashes?.[key] ?? null
      return expected === null ? actual === null || actual === undefined : sameHash(actual, expected)
    })
}

function publicationMayHaveSucceeded(publisherOutput = '') {
  return /CLOUD_PUBLICATION_OUTCOME_UNKNOWN|CLOUD_PUBLICATION_VERIFIED_RECEIPT_NOT_RECORDED|RELEASE PUBLISHED; FOLLOWUPS FAILED/i.test(publisherOutput)
}

function publishedCandidateBundleSha256(publisherOutput = '', fallback = null) {
  const matches = [...String(publisherOutput).matchAll(/\bcandidate_bundle_sha256=([a-f0-9]{64})\b/gi)]
  const exactPostedHash = matches.at(-1)?.[1]
  const candidate = normalizedHash(exactPostedHash) ?? normalizedHash(fallback)
  return candidate?.toLowerCase() ?? null
}

function classifyFailedPublication({ publisherOutput = '', fallbackBundleSha256, dealerMailSha256 }) {
  if (!publicationMayHaveSucceeded(publisherOutput)) {
    return {
      status: 'publish_failed_last_verified_release_preserved',
      failureCode: 'CLOUDFLARE_PUBLISH_FAILED',
      reconciliationRequired: false,
      candidate: null,
    }
  }
  return {
    status: 'cloud_publication_outcome_unknown',
    failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
    reconciliationRequired: true,
    candidate: {
      bundleSha256: publishedCandidateBundleSha256(publisherOutput, fallbackBundleSha256),
      dealerMailSha256: normalizedHash(dealerMailSha256)?.toLowerCase() ?? null,
    },
  }
}

// The ordinary (non-hold) publisher rebuilds the photo cache and resource
// enrichment before its POST, so Node's pre-publisher bundle hash is never the
// posted hash. Evidence of what was posted comes only from the publisher: its
// durable exact-candidate marker, or the candidate hash it printed.
function classifyOrdinaryPublicationFailure({ publisherOutput = '', beforeRaw = null, afterState = { raw: null, receipt: null }, durableAttempt = null, reportDate, builtSourceHashes = {} }) {
  if (durableAttempt) {
    const state = durableAttempt.state
    const postedHash = normalizedHash(state?.candidate?.bundleSha256) ?? normalizedHash(publishedCandidateBundleSha256(publisherOutput))
    return {
      status: 'cloud_publication_outcome_unknown',
      failureCode: durableAttempt.consistent ? 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN' : 'PUBLICATION_RECONCILIATION_STATE_INVALID',
      reconciliationRequired: true,
      receipt: null,
      candidate: {
        bundleSha256: postedHash?.toLowerCase() ?? null,
        dealerMailSha256: (normalizedHash(state?.candidate?.sourceHashes?.dealerMail) ?? normalizedHash(builtSourceHashes.dealerMail))?.toLowerCase() ?? null,
      },
    }
  }
  // No marker remains, so the publisher either never reached its POST or
  // archived the marker after exact verification and a flushed receipt. When it
  // reports the release published and this date's receipt is verified for the
  // sources this run captured (and for the printed candidate, if any), only the
  // follow-ups failed; mirror classifyPublicationOutcome's hold-path rule.
  if (/RELEASE PUBLISHED; FOLLOWUPS FAILED/i.test(publisherOutput) && !afterState.lookupFailed) {
    const receipt = afterState.receipt
    const printedHash = normalizedHash(publishedCandidateBundleSha256(publisherOutput))
    const sameSources = ['public', 'dealerMail'].every((field) => sameHash(receipt?.sourceHashes?.[field], builtSourceHashes[field]))
    if (verifiedReceiptIdentityIsValid(receipt, reportDate) && receipt.complete === true && sameSources &&
        (printedHash === null || printedHash === normalizedHash(receipt.bundleSha256)) &&
        afterState.raw !== beforeRaw) {
      return {
        status: 'published_followups_pending',
        failureCode: 'CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED',
        reconciliationRequired: false,
        receipt,
        candidate: null,
      }
    }
  }
  const failure = classifyFailedPublication({
    publisherOutput,
    fallbackBundleSha256: null,
    dealerMailSha256: builtSourceHashes.dealerMail,
  })
  return { ...failure, receipt: null }
}

function classifyPublicationOutcome({ processOk, beforeRaw, afterState, expectedHashes, reportDate, publisherOutput = '' }) {
  const matchesCandidate = assertReceiptHashes(afterState.receipt, expectedHashes, reportDate)
  if (processOk && matchesCandidate) return 'published_and_followups_complete'
  if (!processOk && afterState.raw !== null && afterState.raw !== beforeRaw && matchesCandidate) {
    return 'published_followups_pending'
  }
  if (processOk || publicationMayHaveSucceeded(publisherOutput)) return 'publication_outcome_unknown'
  return 'not_published'
}

function verifyHoldRefreshStableSources({ reportDate, receipt, manifestPath, publicPath, resourcePath }) {
  if (!verifiedReceiptIdentityIsValid(receipt, reportDate)) {
    throw new Error('VERIFIED_RECEIPT_REQUIRED')
  }
  const manifest = readJson(manifestPath)
  if (manifest?.complete !== true || manifest?.report_date !== reportDate) {
    throw new Error('VERIFIED_MANIFEST_REQUIRED')
  }
  if (!existsSync(publicPath)) throw new Error('PUBLIC_SNAPSHOT_MISSING')
  if (!sameHash(sha256(publicPath), receipt.sourceHashes?.public)) throw new Error('PUBLIC_SNAPSHOT_RECEIPT_MISMATCH')
  if (manifest.public_snapshot_sha256 && !sameHash(manifest.public_snapshot_sha256, receipt.sourceHashes?.public)) {
    throw new Error('PUBLIC_MANIFEST_RECEIPT_MISMATCH')
  }
  if (!existsSync(resourcePath)) throw new Error('RESOURCE_ENRICHMENT_MISSING')
  if (!sameHash(sha256(resourcePath), receipt.sourceHashes?.resources)) throw new Error('RESOURCE_ENRICHMENT_RECEIPT_MISMATCH')

  const managerBinding = manifest.manager_disposition_overlay ?? null
  const expectedManagerBinding = receipt.sourceHashes?.managerDispositionBinding ?? null
  const expectedManagerProjection = receipt.sourceHashes?.managerDisposition ?? null
  if (expectedManagerBinding === null || expectedManagerBinding === undefined) {
    if (managerBinding || expectedManagerProjection) throw new Error('MANAGER_OVERLAY_RECEIPT_MISMATCH')
  } else {
    if (!managerBinding || managerBinding.status !== 'complete' || !sameHash(managerBinding.sha256, expectedManagerBinding)) {
      throw new Error('MANAGER_OVERLAY_RECEIPT_MISMATCH')
    }
    if (!normalizedHash(expectedManagerProjection)) throw new Error('MANAGER_OVERLAY_RECEIPT_MISMATCH')
    const managerPath = resolveBoundWorkspacePath(managerBinding.path, 'MANAGER_OVERLAY')
    if (!existsSync(managerPath) || !sameHash(sha256(managerPath), expectedManagerBinding)) {
      throw new Error('MANAGER_OVERLAY_SOURCE_MISMATCH')
    }
  }
  return { manifest, managerBinding }
}

function verifyHoldRefreshBaseline({ reportDate, receipt, manifestPath, publicPath, dealerPath, resourcePath }) {
  const baseline = verifyHoldRefreshStableSources({ reportDate, receipt, manifestPath, publicPath, resourcePath })
  const canonicalDealerPath = dealerPath ?? dealerCloudSnapshotPath(reportDate)
  if (!existsSync(canonicalDealerPath)) throw new Error('DEALERMAIL_SNAPSHOT_MISSING')
  const receiptDealerHash = receipt.sourceHashes?.dealerMail
  if (!sameHash(sha256(canonicalDealerPath), receiptDealerHash)) {
    throw new Error('DEALERMAIL_SNAPSHOT_RECEIPT_MISMATCH')
  }
  if (!sameHash(baseline.manifest.dealermail_snapshot_sha256, receiptDealerHash)) {
    throw new Error('DEALERMAIL_MANIFEST_RECEIPT_MISMATCH')
  }
  const manifestDealerPath = resolveBoundWorkspacePath(baseline.manifest.dealermail_snapshot_path, 'DEALERMAIL_SNAPSHOT')
  if (path.relative(path.resolve(canonicalDealerPath), manifestDealerPath) !== '') {
    throw new Error('DEALERMAIL_MANIFEST_PATH_MISMATCH')
  }
  return { ...baseline, dealerPath: canonicalDealerPath }
}

function inspectCollectorBaseline(reportDate) {
  recoverCollectorCaptureBaseline()
  if (reportDate !== todayInNewYork()) throw new Error('BASELINE_REQUIRED')
  if (retainedGlobalPublicationReconciliation()) throw new Error('RECONCILIATION_REQUIRED')
  const manifestPath = path.join(WORK_ROOT, 'run-status', `${reportDate}.json`)
  const releasePath = path.join(WORK_ROOT, 'releases', reportDate, 'inventory-flow-release.json')
  const receiptPath = path.join(WORK_ROOT, 'app-feed-status', `${reportDate}.json`)
  const intradayStatusPath = path.join(WORK_ROOT, 'hold-refresh-status', `${reportDate}.json`)
  const retained = retainedPublicationReconciliation({ reportDate, intradayStatusPath, manifestPath, receiptPath })
  if (retained) throw new Error('RECONCILIATION_REQUIRED')
  const receipt = readReceiptState(receiptPath).receipt
  if (!receipt || receipt.status !== 'published_and_verified' || receipt.reportDate !== reportDate || receipt.complete !== true) {
    throw new Error('BASELINE_REQUIRED')
  }
  const publicPath = publicSnapshotPath(reportDate)
  const dealerPath = dealerCloudSnapshotPath(reportDate)
  const resourcePath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
  const baseline = verifyHoldRefreshBaseline({ reportDate, receipt, manifestPath, publicPath, dealerPath, resourcePath })
  const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT, now: validationClockFor(reportDate) })
  if (release.reportDate !== reportDate) throw new Error('BASELINE_REQUIRED')
  assertCandidatePreservesReceiptSources(release, receipt)
  return { reportDate, baseline, receipt, manifestPath, releasePath, receiptPath, publicPath, dealerPath, resourcePath }
}

function assertCandidatePreservesReceiptSources(release, receipt) {
  const actual = receiptSourceHashes(release)
  for (const key of ['public', 'resources', 'managerDisposition', 'managerDispositionBinding']) {
    const expected = receipt.sourceHashes?.[key] ?? null
    const candidate = actual[key] ?? null
    if (expected === null ? candidate !== null : !sameHash(candidate, expected)) {
      throw new Error(`${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_CHANGED_DURING_HOLD_REFRESH`)
    }
  }
  return actual
}

function run(command, args, { cwd = WORKSPACE_ROOT, optional = false, label = command, extraEnv = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      BOB_MAXEY_WORKSPACE_ROOT: WORKSPACE_ROOT,
      INVENTORY_WORKSPACE_ROOT: WORKSPACE_ROOT,
      ...extraEnv,
    },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (result.error || result.status !== 0) {
    const message = result.error?.message || output || `${label} exited ${result.status}`
    if (!optional) throw new Error(`${label} failed: ${message}`)
    return { ok: false, output: message, status: result.status ?? 1 }
  }
  return { ok: true, output, status: 0 }
}

async function automationBrowserAvailable() {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch {
    return false
  }
}

async function ensureAutomationBrowser(warnings) {
  if (await automationBrowserAvailable()) return true
  const starter = path.join(APP_ROOT, 'scripts', 'start-automation-browser.ps1')
  if (existsSync(starter)) {
    run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', starter], {
      optional: true,
      label: 'automation browser start',
    })
    const startedAt = Date.now()
    while (Date.now() - startedAt < 60000) {
      if (await automationBrowserAvailable()) return true
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  warnings.push('sign in to DealerMail, FMCDealer, and vAuto in the Work PC Automation Browser; authenticated source collection was skipped because the automation browser was unavailable.')
  return false
}

function publicSnapshotPath(reportDate) {
  return path.join(WORK_ROOT, 'inventory-history', 'snapshots', `${reportDate}-public.json`)
}

function dealerCloudSnapshotPath(reportDate) {
  return path.join(WORK_ROOT, 'dealermail-history', 'snapshots', `${reportDate}-complete-used-inventory-deep-cloud-ready.json`)
}

function archiveDealerMailRevision(reportDate, archivedAt = new Date()) {
  const snapshotDirectory = path.join(WORK_ROOT, 'dealermail-history', 'snapshots')
  const existing = DEALERMAIL_REVISION_SUFFIXES
    .map((suffix) => ({ suffix, source: path.join(snapshotDirectory, `${reportDate}-${suffix}`) }))
    .filter(({ source }) => existsSync(source))
  if (!existing.length) return null

  const revision = archivedAt.toISOString().replace(/[:.]/g, '-')
  const archiveDirectory = path.join(WORK_ROOT, 'dealermail-history', 'intraday', reportDate, revision)
  mkdirSync(archiveDirectory, { recursive: true })
  const files = []
  for (const { suffix, source } of existing) {
    const destination = path.join(archiveDirectory, `${reportDate}-${suffix}`)
    copyFileSync(source, destination)
    files.push({ name: path.basename(destination), sha256: sha256(destination) })
  }
  writeJson(path.join(archiveDirectory, 'archive-manifest.json'), {
    schema: 'inventory-flow-dealermail-intraday-archive-v1',
    reportDate,
    archivedAt: archivedAt.toISOString(),
    files,
  })
  return archiveDirectory
}

function runPublicInventory(reportDate, steps) {
  const target = publicSnapshotPath(reportDate)
  if (existsSync(target)) {
    steps.push({ name: 'public_inventory', status: 'reused', path: target })
    return target
  }
  run(PYTHON, ['work\\run_public_inventory_only.py', '--report-date', reportDate, '--output', target], {
    label: 'public inventory collector',
  })
  steps.push({ name: 'public_inventory', status: 'captured', path: target })
  return target
}

// The host builder and finalizer reject a whole snapshot when DealerMail moved
// under the ~45 s capture (a hold placed or released mid-read shows up as a
// hold-state or row-count mismatch). One fresh capture after a short wait
// usually settles it; a second rejection stops the run with the finalizer's
// own words in the steps. Nothing that failed validation is ever published,
// and an expired session is never retried.
async function runDealerMail(reportDate, browserReady, warnings, steps, { refresh = false } = {}) {
  const target = dealerCloudSnapshotPath(reportDate)
  if (existsSync(target) && !refresh) {
    steps.push({ name: 'dealermail', status: 'reused', path: target })
    return target
  }
  if (!browserReady) {
    warnings.push('sign in to DealerMail in the Work PC Automation Browser; DealerMail was not captured and the cloud release was not published.')
    steps.push({ name: 'dealermail', status: 'skipped_browser_unavailable' })
    return null
  }
  if (refresh) {
    const archiveDirectory = archiveDealerMailRevision(reportDate)
    steps.push({
      name: 'dealermail_archive',
      status: archiveDirectory ? 'complete' : 'skipped_no_prior_snapshot',
      ...(archiveDirectory ? { path: archiveDirectory } : {}),
    })
  }
  let rejection = null
  for (let attempt = 1; attempt <= DEALERMAIL_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await runtime.sleep(runtime.dealerMailRetryDelayMs)
    const capture = runtime.run(NODE, ['scripts\\capture-dealermail.mjs', 'run', reportDate, '--budget-ms', '900000'], {
      cwd: APP_ROOT,
      optional: true,
      label: 'DealerMail capture',
    })
    if (!capture.ok || /session_expired/i.test(capture.output)) {
      warnings.push('sign in to DealerMail in the Work PC Automation Browser; DealerMail session was not usable and the cloud release was not published.')
      steps.push({ name: 'dealermail', status: 'session_expired_or_failed', attempt, detail: safeDetail(capture.output) })
      return null
    }
    try {
      runtime.run(NODE, ['build_v2_snapshot.mjs', reportDate], { cwd: WORK_ROOT, label: 'DealerMail snapshot builder' })
      runtime.run(NODE, ['work\\finalize_cloud_snapshot.mjs', reportDate], { label: 'DealerMail cloud snapshot finalizer' })
      if (!existsSync(target)) throw new Error('DealerMail finalized snapshot was not created')
    } catch (error) {
      rejection = error
      steps.push({ name: 'dealermail_attempt', status: 'snapshot_rejected', attempt, detail: failureDetailFor(error) })
      continue
    }
    steps.push({ name: 'dealermail', status: 'captured', attempt, path: target })
    return target
  }
  warnings.push(`DealerMail snapshot was rejected by validation on ${DEALERMAIL_ATTEMPTS} captures; the last verified release stays in place.`)
  steps.push({ name: 'dealermail', status: 'snapshot_rejected', attempts: DEALERMAIL_ATTEMPTS, detail: failureDetailFor(rejection) })
  throw new Error(DEALERMAIL_SNAPSHOT_REJECTED, { cause: rejection })
}

// Without a browser (--skip-authenticated, or the automation browser is down)
// the run can still publish when this date's OASIS capture already exists and
// covers the worklist, exactly as capture-oasis.mjs itself judges completeness.
function reuseExistingOasisCapture(reportDate, steps) {
  const worklistPath = path.join(WORK_ROOT, `oasis-vin-worklist-${reportDate}.json`)
  const capturePath = path.join(WORK_ROOT, 'oasis-history', `${reportDate}-oasis.json`)
  if (!existsSync(worklistPath) || !existsSync(capturePath)) {
    steps.push({ name: 'oasis', status: 'skipped_browser_unavailable' })
    return oasisOutcome({ systemic: true })
  }
  try {
    const worklist = readJson(worklistPath)
    const records = readJson(capturePath).records
    if (!Array.isArray(worklist) || !Array.isArray(records)) throw new Error('unexpected OASIS capture shape')
    const quality = assessOasisCapture(worklist, records)
    steps.push({ name: 'oasis', status: quality.complete ? 'reused_existing_capture' : 'reused_existing_capture_with_gaps', detail: safeDetail(JSON.stringify(quality)) })
    return oasisOutcome({ quality })
  } catch (error) {
    steps.push({ name: 'oasis', status: 'existing_capture_unreadable', detail: safeDetail(String(error?.message ?? error)) })
    return oasisOutcome({ systemic: true })
  }
}

// OASIS never blocks the release (Joe, 2026-09-28): one vehicle's unreadable
// report, or even an unavailable Ford session, must not hold back inventory and
// holds. Every vehicle keeps its own flag (openActionsCaptured false or no
// record), so nothing unconfirmed is shown as "no recalls". The counts go into
// the manifest and a warning so the gap stays visible.
function oasisOutcome({ quality = null, systemic = false } = {}) {
  const incompleteVehicles = quality ? quality.incompleteActionResults : null
  const missingVehicles = quality ? quality.missingVinCount : null
  return {
    validated: !systemic && quality?.complete === true,
    systemic,
    incompleteVehicles,
    missingVehicles,
  }
}

function lastJsonLine(output) {
  const lines = String(output ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('{'))
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]) } catch { /* keep looking */ }
  }
  return null
}

function oasisWarning(outcome) {
  if (outcome.systemic) return 'Ford OASIS was not captured for this run (sign in to FMCDealer in the Work PC Automation Browser). The inventory and holds candidate may continue without OASIS; publication still requires validation and verification.'
  const gaps = (outcome.incompleteVehicles ?? 0) + (outcome.missingVehicles ?? 0)
  return gaps ? `Ford OASIS open actions are unconfirmed for ${gaps} vehicle(s); if published, they will show as not confirmed in the app. Review the affected vehicles in OASIS.` : null
}

function invoiceCaptureComplete({ reportDate, result, readIndex = () => readJson(path.join(WORK_ROOT, 'invoice-history', reportDate, 'index.json')) }) {
  const report = lastJsonLine(result.output)
  if (!result.ok || report?.sessionStatus !== 'ok' || report.failed !== 0 || report.stoppedReason !== null) return false
  try {
    const index = readIndex()
    return index?.schema === 'ford-invoice-index-v1' && index.reportDate === reportDate && Array.isArray(index.results) &&
      typeof report.fordLincolnVins === 'number' && index.results.length === report.fordLincolnVins &&
      index.results.every(row => /^[A-HJ-NPR-Z0-9]{17}$/.test(row?.vin ?? '') && ['pdf', 'unavailable'].includes(row?.status)) &&
      new Set(index.results.map(row => row.vin)).size === index.results.length
  } catch { return false }
}

function runOptionalAuthenticatedSources(reportDate, browserReady, warnings, steps) {
  if (!browserReady) {
    steps.push({ name: 'authenticated_optional_sources', status: 'skipped_browser_unavailable' })
    const reused = reuseExistingOasisCapture(reportDate, steps)
    const warning = oasisWarning(reused)
    if (warning) warnings.push(warning)
    return reused
  }
  let oasis = oasisOutcome({ systemic: true })
  const optionalRuns = [
    {
      name: 'oasis',
      command: NODE,
      args: ['scripts\\capture-oasis.mjs', 'run', reportDate, '--budget-ms', '1800000'],
      cwd: APP_ROOT,
      expired: /session_expired/i,
      warning: 'sign in to FMCDealer in the Work PC Automation Browser; Ford OASIS data is incomplete for this run.',
    },
    {
      name: 'ford_service_history',
      command: NODE,
      args: ['scripts\\capture-service-history.mjs', 'run', reportDate, '--detail-limit', 'all', '--budget-ms', '3600000'],
      cwd: APP_ROOT,
      expired: /session_expired/i,
      warning: 'sign in to FMCDealer in the Work PC Automation Browser; Ford retail service-history data is incomplete for this run.',
    },
    {
      name: 'invoices_capture',
      command: NODE,
      args: ['scripts\\capture-invoices.mjs', 'run', reportDate, '--budget-ms', '1800000'],
      cwd: APP_ROOT,
      expired: INVOICE_CAPTURE_EXPIRED_PATTERN,
      warning: 'Ford invoice capture is incomplete; check the fordvisions session or source response and retry this source.',
    },
    { name: 'invoice_text', command: PYTHON, args: ['work\\extract_invoice_text.py', '--report-date', reportDate] },
    { name: 'invoice_parse', command: PYTHON, args: ['work\\parse_ford_invoice.py', '--report-date', reportDate] },
    { name: 'vauto_worklist', command: PYTHON, args: ['work\\build_vauto_worklist.py', '--report-date', reportDate] },
    {
      name: 'vauto_factory_equipment',
      command: NODE,
      args: ['scripts\\vauto-factory-equipment.mjs', 'run', path.join(WORK_ROOT, 'vauto-history', `worklist-${reportDate}.json`), path.join(WORK_ROOT, 'vauto-history', `${reportDate}-factory-equipment.json`)],
      cwd: APP_ROOT,
      expired: /SESSION_EXPIRED|session_expired/i,
      warning: 'sign in to vAuto in the Work PC Automation Browser; vAuto factory-equipment data is incomplete for this run.',
    },
    {
      name: 'vauto_autocheck_fallback',
      command: NODE,
      args: ['scripts\\capture-vauto-autocheck.mjs', 'run', reportDate, '--budget-ms', '600000'],
      cwd: APP_ROOT,
      expired: /SESSION_EXPIRED|session_expired/i,
      warning: 'sign in to vAuto in the Work PC Automation Browser; AutoCheck fallback is incomplete for vehicles not yet listed online.',
    },
    {
      name: 'warranty',
      command: NODE,
      args: ['scripts\\capture-warranty.mjs', 'run', reportDate, '--budget-ms', '1800000'],
      cwd: APP_ROOT,
      expired: /session_expired/i,
      warning: 'sign in to FMCDealer in the Work PC Automation Browser; warranty/OASIS data is incomplete for this run.',
    },
  ]
  for (const item of optionalRuns) {
    const result = runtime.run(item.command, item.args, { cwd: item.cwd ?? WORKSPACE_ROOT, optional: true, label: item.name })
    if (item.name === 'oasis') {
      const report = lastJsonLine(result.output)
      const systemic = !result.ok || item.expired?.test(result.output) || !report || typeof report.missingVinCount !== 'number'
      oasis = oasisOutcome({ quality: report && typeof report.missingVinCount === 'number' ? report : null, systemic })
      const warning = oasisWarning(oasis)
      if (warning) warnings.push(warning)
      steps.push({ name: 'oasis', status: systemic ? 'failed_non_blocking' : oasis.validated ? 'complete' : 'completed_with_warning', detail: safeDetail(result.output) })
      continue
    }
    const incomplete = item.name === 'invoices_capture' ? !invoiceCaptureComplete({ reportDate, result }) : item.expired?.test(result.output)
    if (!result.ok || incomplete) {
      if (item.warning) {
        warnings.push(item.warning)
      }
      steps.push({ name: item.name, status: result.ok ? 'completed_with_warning' : 'failed_non_blocking', detail: safeDetail(result.output) })
    } else {
      steps.push({ name: item.name, status: 'complete' })
    }
  }
  return oasis
}

function managerDispositionOverlayPath(reportDate) {
  return path.join(WORK_ROOT, 'manager-supplied', 'sold-logs', `${reportDate.slice(0, 7)}-howell-operational.json`)
}

function managerDispositionOverlayReadable(reportDate) {
  try {
    readFileSync(managerDispositionOverlayPath(reportDate))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    // An overlay that exists but cannot be read must fail the run; treating it
    // as absent would publish without sold/delivered marks.
    return true
  }
}

function runManagerDisposition(reportDate, warnings, steps) {
  const month = reportDate.slice(0, 7)
  const csv = path.join(WORK_ROOT, 'sold-delivered', `${month}.csv`)
  if (!existsSync(csv)) {
    steps.push({ name: 'manager_disposition', status: 'skipped_no_csv' })
    return false
  }
  const ingest = run(PYTHON, ['work\\ingest_sold_delivered.py', '--report-date', reportDate, '--csv', csv], {
    optional: true,
    label: 'manager sold/delivered overlay ingest',
  })
  const check = ingest.ok
    ? run(NODE, ['scripts\\dryrun_manager_disposition_check.mjs', reportDate], {
        cwd: APP_ROOT,
        optional: true,
        label: 'manager sold/delivered overlay check',
      })
    : { ok: false, output: ingest.output }
  if (!ingest.ok || !check.ok) {
    // A present overlay that failed validation must block publish. Skipping it
    // would ship a complete manifest without its sold/delivered marks.
    if (managerDispositionOverlayReadable(reportDate)) {
      warnings.push('Manager sold/delivered overlay did not validate; publishing was blocked so sold or delivered marks are not dropped.')
      steps.push({ name: 'manager_disposition', status: 'failed_blocking', detail: safeDetail(check.output) })
      return 'failed_blocking'
    }
    warnings.push('Manager sold/delivered overlay did not validate; it was not used to change current inventory status.')
    steps.push({ name: 'manager_disposition', status: 'failed_non_blocking', detail: safeDetail(check.output) })
    return false
  }
  steps.push({ name: 'manager_disposition', status: 'complete' })
  return true
}

function runResourceBuild(reportDate, warnings, steps) {
  const build = run(PYTHON, ['work\\build_vin_document_enrichment.py', '--report-date', reportDate], {
    optional: true,
    label: 'VIN document enrichment builder',
  })
  const serviceHistoryMerge = build.ok
    ? run(NODE, ['scripts\\merge-ford-service-history.mjs', reportDate], { cwd: APP_ROOT, optional: true, label: 'Ford service history merge' })
    : { ok: false, output: build.output }
  const autoCheckMerge = build.ok && serviceHistoryMerge.ok
    ? run(NODE, ['scripts\\merge-vauto-autocheck.mjs', reportDate], { cwd: APP_ROOT, optional: true, label: 'vAuto AutoCheck fallback merge' })
    : { ok: false, output: serviceHistoryMerge.output }
  const invoiceMerge = build.ok && serviceHistoryMerge.ok && autoCheckMerge.ok
    ? run(NODE, ['scripts\\merge-invoice-metadata.mjs', reportDate], { cwd: APP_ROOT, optional: true, label: 'Saved Ford invoice merge' })
    : { ok: false, output: autoCheckMerge.output }
  const check = build.ok && serviceHistoryMerge.ok && autoCheckMerge.ok && invoiceMerge.ok ? validateCurrentResourceFile() : { ok: false, output: invoiceMerge.output }
  if (!build.ok || !serviceHistoryMerge.ok || !autoCheckMerge.ok || !invoiceMerge.ok || !check.ok) {
    warnings.push('Vehicle resource enrichment did not validate, so the release was not published.')
    steps.push({ name: 'resources', status: 'failed_blocking', detail: safeDetail(check.output) })
    return false
  }
  steps.push({ name: 'resources', status: 'complete', detail: safeDetail(`${build.output} ${serviceHistoryMerge.output} ${autoCheckMerge.output} ${invoiceMerge.output}`) })
  return true
}

function validateCurrentResourceFile() {
  try {
    const enrichmentPath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
    const raw = readJson(enrichmentPath)
    const validated = validateVinDocumentEnrichment(raw)
    return {
      ok: true,
      output: JSON.stringify({
        status: validated.metadata?.status ?? 'validated',
        recordCount: validated.metadata?.recordCount ?? Object.keys(validated.recordsByVin ?? {}).length,
        factoryEquipmentCount: validated.metadata?.factoryEquipmentCount ?? null,
        fordOasisCount: validated.metadata?.fordOasisCount ?? null,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      output: error?.message || String(error),
    }
  }
}

function safeDetail(value) {
  return redactSecrets(String(value || '')).replace(/\s+/g, ' ').slice(0, 500)
}

function redactSecrets(text) {
  return String(text)
    .replace(/\b(cookie|set-cookie)\s*[:=][^\r\n]*/gi, '$1: [redacted]')
    .replace(/\bauthorization["']?\s*[:=]\s*[^\r\n]*/gi, 'Authorization: [redacted]')
    .replace(/\bbearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|authorization|session[_-]?id)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[redacted]')
}

const FAILURE_DETAIL_MAX = 500
const FAILURE_DETAIL_HEAD = 120

// A failure code stays machine-readable; the underlying message rides along so
// a catch-all code is still diagnosable. Credential-shaped values are masked
// before bounding. A step failure reads "<label> failed: <stdout + stderr>", so
// the thrown error (stderr) sits at the END after any progress output: an
// over-long detail keeps the label head and the tail, never the head alone.
// A bare code that is already the failure code adds nothing and is omitted.
function failureDetailFor(error, failureCode = null) {
  if (!error) return null
  const message = String(error?.message ?? error)
  const cause = error?.cause ? String(error.cause?.message ?? error.cause) : ''
  const parts = [message === failureCode ? '' : message, cause].filter(Boolean)
  if (!parts.length) return null
  const text = redactSecrets(parts.join(' | ')).replace(/\s+/g, ' ').trim()
  if (text.length <= FAILURE_DETAIL_MAX) return text
  const tail = FAILURE_DETAIL_MAX - FAILURE_DETAIL_HEAD - 3
  return `${text.slice(0, FAILURE_DETAIL_HEAD)} … ${text.slice(-tail)}`
}

function rowsFromPublic(snapshot) {
  const vehicles = snapshot.vehicles
  if (Array.isArray(vehicles)) return vehicles
  if (vehicles && typeof vehicles === 'object') return Object.values(vehicles)
  return []
}

function countByStore(rows, field = 'store') {
  const counts = Object.fromEntries(STORES.map((store) => [store, 0]))
  for (const row of rows) {
    const store = row?.[field] ?? row?.storeName
    if (Object.hasOwn(counts, store)) counts[store] += 1
  }
  return counts
}

function deriveManifest({
  reportDate,
  publicPath,
  dealerPath,
  warnings,
  steps,
  managerDispositionValidated = false,
  managerDispositionBinding,
  runMode = 'inventory_flow_background_pipeline',
}) {
  const publicSnapshot = readJson(publicPath)
  const dealerSnapshot = readJson(dealerPath)
  const publicRows = rowsFromPublic(publicSnapshot)
  const crmRows = dealerSnapshot.completeDealerMailUsedInventory?.rows ?? []
  const excludeRows = dealerSnapshot.excludeActiveHoldsValidationSet?.rows ?? []
  const publicInfo = fileInfo(publicPath)
  const dealerInfo = fileInfo(dealerPath)
  const managerBinding = managerDispositionBinding === undefined
    ? managerDispositionValidated ? managerBindingFor(reportDate, publicRows) : null
    : managerDispositionBinding
  const sourceCounts = {
    public_unique_vins: publicRows.length,
    public_by_store: publicSnapshot.validation?.store_counts ?? countByStore(publicRows),
    dealermail_used_rows: crmRows.length,
    dealermail_exclude_hold_rows: excludeRows.length,
    dealermail_by_store: countByStore(crmRows, 'storeName'),
    active_held_vins: dealerSnapshot.summary?.uniqueHeldVehicles ?? (dealerSnapshot.vehicles ?? []).length,
    active_hold_records: dealerSnapshot.summary?.activeHoldDetailRows ?? 0,
    active_backups: dealerSnapshot.summary?.activeBackupHolds ?? 0,
    hold_history_rows: dealerSnapshot.summary?.totalHoldDetailRows ?? 0,
    deleted_hold_records: dealerSnapshot.summary?.deletedHistoricalHoldRows ?? 0,
    comments: countMessageRows(dealerSnapshot, 'comments'),
    alerts: countMessageRows(dealerSnapshot, 'alerts'),
    cdk_reads: dealerSnapshot.cdkReadOnlyLookup?.records?.length ?? 0,
  }
  return {
    report_date: reportDate,
    timezone: 'America/New_York',
    run_mode: runMode,
    required_daily_output: 'inventory_flow_app_api_mcp',
    public_inventory_status: 'complete',
    dealermail_status: 'complete_authenticated_read_only',
    workbook_status: 'not_required_app_only',
    excel_export_status: 'optional_on_demand',
    public_snapshot_path: publicPath,
    public_snapshot_sha256: publicInfo.sha256,
    dealermail_snapshot_path: dealerPath,
    dealermail_snapshot_sha256: dealerInfo.sha256,
    source_counts: sourceCounts,
    public_change_counts: publicSnapshot.validation?.change_counts ?? {},
    validation_results: {
      public_sources_complete: true,
      dealermail_complete: true,
      app_release_validated: false,
      cloud_release_bundle_validated: false,
      workbook_validated: false,
      excel_not_required_for_app_publish: true,
      passed: true,
    },
    warnings: [...new Set([...warnings, AVAILABILITY_CAVEAT])],
    availability_caveat: AVAILABILITY_CAVEAT,
    daily_steps: steps,
    completion_time: new Date().toISOString(),
    complete: true,
    ...(managerBinding ? { manager_disposition_overlay: managerBinding } : {}),
  }
}

function countMessageRows(snapshot, key) {
  let total = 0
  for (const vehicle of snapshot.vehicles ?? []) {
    for (const group of vehicle[key] ?? []) {
      if (Array.isArray(group?.rows)) total += group.rows.length
      else if (key === 'alerts' && group?.alertTextRaw) total += 1
    }
  }
  return total
}

function managerBindingFor(reportDate, publicRows = []) {
  const month = reportDate.slice(0, 7)
  const target = managerDispositionOverlayPath(reportDate)
  // Missing overlay is fine. A present but unreadable or invalid file must
  // fail the run: silently binding no overlay would drop sold/delivered marks.
  // Read the path directly so an inaccessible directory is not treated as absent.
  let overlay
  let sourceBytes
  try {
    sourceBytes = readFileSync(target)
    overlay = JSON.parse(sourceBytes.toString('utf8'))
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
      throw new Error('overlay must be a JSON object')
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`MANAGER_DISPOSITION_OVERLAY_UNREADABLE: ${error.message}`, { cause: error })
  }
  const stats = overlay.summary ?? overlay
  const currentVehicles = publicRows.map((row) => ({
    vin: String(row?.vin ?? '').trim().toUpperCase(),
    publicRecord: row,
    crmRecord: null,
  })).filter((vehicle) => vehicle.vin)
  const sanitized = sanitizeManagerDispositionDocuments({
    documents: [{ expectedStore: overlay.sourceStore ?? overlay.source_store ?? 'Howell', data: overlay }],
    reportDate,
    vehicles: currentVehicles,
  })
  const matchStats = sanitized.summary ?? {}
  // A monthly manager log can legitimately change after a daily release has
  // been published. Bind the release to a content-addressed copy so a later
  // update cannot invalidate an otherwise verified inventory and hold view.
  // The copy keeps the approved file name (the cloud validator publishes and
  // checks only the basename); the lowercase content hash is the folder name.
  // Hash and copy the same bytes (no read-then-copy race), write atomically,
  // and repair a truncated or damaged copy: the folder name is the content
  // hash, so rewriting it with bytes that match that hash is always safe.
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex').toUpperCase()
  const snapshotDirectory = path.join(WORK_ROOT, 'releases', reportDate, 'manager-disposition', sourceSha256.toLowerCase())
  const releaseSource = path.join(snapshotDirectory, path.basename(target))
  if (!existsSync(releaseSource) || !sameHash(sha256(releaseSource), sourceSha256)) writeBuffer(releaseSource, sourceBytes)
  if (!sameHash(sha256(releaseSource), sourceSha256)) throw new Error('MANAGER_DISPOSITION_RELEASE_SNAPSHOT_MISMATCH')
  return {
    status: 'complete',
    classification: 'operational-redacted',
    source_type: 'manager-log',
    path: releaseSource,
    sha256: sourceSha256,
    source_store: overlay.sourceStore ?? overlay.source_store ?? 'Howell',
    source_period: overlay.sourcePeriod ?? overlay.source_period ?? month,
    sold_records: stats.soldRecords ?? stats.sold_records ?? stats.recordCount ?? 0,
    delivered_records: stats.deliveredRecords ?? stats.delivered_records ?? 0,
    sold_not_marked_delivered: stats.soldNotDeliveredRecords ?? stats.sold_not_marked_delivered ?? 0,
    matched_current_public_vins: matchStats.matchedRecordCount ?? stats.matchedCurrentPublicVins ?? stats.matched_current_public_vins ?? 0,
    unmatched_records: matchStats.unmatchedRecordCount ?? stats.unmatchedRecords ?? stats.unmatched_records ?? 0,
    conflicting_records: matchStats.conflictingRecordCount ?? stats.conflictingRecords ?? stats.conflicting_records ?? 0,
    review_records: matchStats.reviewRecordCount ?? stats.reviewRecords ?? stats.review_records ?? 0,
    cloud_upload_allowed: true,
  }
}

function buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath, {
  receipt = null,
  workspaceRoot = WORKSPACE_ROOT,
  now = validationClockFor(reportDate),
} = {}) {
  const release = loadLatestCompletedRelease({ workspaceRoot, now })
  if (release.reportDate !== reportDate) {
    throw new Error(`Latest completed release is ${release.reportDate}, expected ${reportDate}`)
  }
  if (receipt) assertCandidatePreservesReceiptSources(release, receipt)
  const preliminaryValidation = validateReleaseBundle(cloudReleaseFrom(release))
  const manifest = readJson(manifestPath)
  manifest.validation_results = {
    ...manifest.validation_results,
    app_release_validated: true,
    cloud_release_bundle_validated: true,
    validate_release_bundle_summary: preliminaryValidation,
    passed: true,
  }
  writeJson(manifestPath, manifest)

  // Finalize self-attesting validation fields before writing the artifact.
  // Local path/hash and delivery fields are outside cloudReleaseFrom(), so the
  // saved bundle and every retry share the exact immutable POST identity.
  const finalRelease = loadLatestCompletedRelease({ workspaceRoot, now })
  if (finalRelease.reportDate !== reportDate) {
    throw new Error(`Latest completed release is ${finalRelease.reportDate}, expected ${reportDate}`)
  }
  const finalSourceHashes = receipt
    ? assertCandidatePreservesReceiptSources(finalRelease, receipt)
    : receiptSourceHashes(finalRelease)
  const finalBundle = cloudReleaseFrom(finalRelease)
  const finalValidation = validateReleaseBundle(finalBundle)
  if (JSON.stringify(finalValidation) !== JSON.stringify(preliminaryValidation)) {
    throw new Error('RELEASE_VALIDATION_SUMMARY_CHANGED_DURING_FINALIZATION')
  }
  writeJson(releasePath, finalBundle)
  const finalManifest = readJson(manifestPath)
  finalManifest.release_bundle_path = releasePath
  finalManifest.release_bundle_sha256 = sha256(releasePath)
  writeJson(manifestPath, finalManifest)
  return { validation: finalValidation, sourceHashes: finalSourceHashes, bundleSha256: cloudBundleSha256(finalBundle) }
}

function publish(reportDate, forcePublish, steps, { holdRefresh = false, expectedSourceHashes = null, followupsOnly = null } = {}) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(APP_ROOT, 'scripts', 'daily-cloud-publish.ps1'),
    '-ReportDate',
    reportDate,
    '-WorkspaceRoot',
    WORKSPACE_ROOT,
  ]
  if (forcePublish) args.push('-Force')
  if (holdRefresh) args.push('-HoldRefresh')
  const result = runtime.run(POWERSHELL, args, {
    optional: true,
    label: 'Cloudflare publisher',
    extraEnv: {
      ...(expectedSourceHashes ? { INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON: JSON.stringify(expectedSourceHashes) } : {}),
      ...(followupsOnly ? { INVENTORY_OPS_FOLLOWUPS_ONLY_BUNDLE_SHA256: followupsOnly } : {}),
    },
  })
  steps.push({ name: 'cloudflare_publish', status: result.ok ? 'complete' : 'failed', detail: safeDetail(result.output) })
  return result
}

function summarize({ reportDate, validation, publishStatus, manifestPath, releasePath, warnings }) {
  const counts = validation ?? {}
  const warningLines = warnings.filter((warning) => warning !== AVAILABILITY_CAVEAT)
  return [
    `Inventory Flow ${reportDate}: ${publishStatus}.`,
    `Public ${counts.publicRowCount ?? 'n/a'} | CRM ${counts.dealerMailRowCount ?? 'n/a'} | Held ${counts.heldVinCount ?? 'n/a'} | Backups ${counts.backupCount ?? 'n/a'}.`,
    `Stores public: ${formatStores(counts.publicStoreCounts)}.`,
    `Stores CRM: ${formatStores(counts.crmStoreCounts)}.`,
    warningLines.length ? `Warnings: ${warningLines.join(' ')}` : 'Warnings: none.',
    `Release bundle: ${releasePath}`,
    `Status file: ${manifestPath}`,
  ].join('\n')
}

function formatStores(counts = {}) {
  return STORES.map((store) => `${store} ${counts[store] ?? 0}`).join(', ')
}

function exitCodeForResult(result) {
  return result?.ok === false ? 1 : 0
}

function writeIntradayStatus(filePath, {
  reportDate,
  status,
  summary,
  failureCode = null,
  failureDetail = null,
  validation = {},
  warnings = [],
  steps = [],
  published = false,
  receipt = null,
  reconciliationRequired = false,
  candidate = null,
}) {
  if (receipt && !verifiedReceiptIdentityIsValid(receipt, reportDate)) {
    throw new Error('VERIFIED_RECEIPT_LINK_INVALID')
  }
  if (receipt && !normalizedHash(receipt.sourceHashes?.dealerMail)) {
    throw new Error('VERIFIED_RECEIPT_LINK_INVALID')
  }
  if (candidate && (!normalizedHash(candidate.bundleSha256) || !normalizedHash(candidate.dealerMailSha256))) {
    throw new Error('PUBLICATION_RECONCILIATION_LINK_INVALID')
  }
  writeJson(filePath, {
    reportDate,
    status,
    checkedAt: new Date().toISOString(),
    summary,
    ...(failureCode ? { failureCode } : {}),
    ...(failureDetail ? { failureDetail: safeDetail(redactSecrets(failureDetail)) } : {}),
    ...(published ? { published: true } : {}),
    ...(reconciliationRequired ? { reconciliationRequired: true } : {}),
    ...(receipt ? {
      receipt: {
        bundleSha256: receipt.bundleSha256,
        verifiedAt: receipt.verifiedAt,
        dealerMailSha256: receipt.sourceHashes?.dealerMail,
      },
    } : {}),
    ...(candidate ? { candidate } : {}),
    ...(Object.keys(validation).length ? { counts: validation } : {}),
    warnings,
    steps,
  })
}

function dealerMailRevisionPaths(reportDate) {
  const directory = path.join(WORK_ROOT, 'dealermail-history', 'snapshots')
  return DEALERMAIL_REVISION_SUFFIXES.map((suffix) => path.join(directory, `${reportDate}-${suffix}`))
}

function candidateManifestFromBaseline({ baseline, reportDate, publicPath, dealerPath, warnings, steps, managerDispositionBinding }) {
  const preserved = { ...baseline }
  for (const key of [
    'cloudflare_publish',
    'latest_pointers_advanced',
    'release_bundle_path',
    'release_bundle_sha256',
    'completed_at',
    'completion_time',
  ]) delete preserved[key]
  return {
    ...preserved,
    ...deriveManifest({
      reportDate,
      publicPath,
      dealerPath,
      warnings,
      steps,
      managerDispositionBinding,
      runMode: 'inventory_flow_intraday_hold_refresh',
    }),
  }
}

// A successful guarded recovery writes this date's verified receipt for the
// exact candidate and archives the global marker. That receipt is proof the
// candidate is live, so a hold status or run manifest still naming that same
// candidate no longer blocks the day. Any other hash, an unreadable receipt, or
// a remaining (or malformed) global marker keeps the stop in place.
function reconciliationClearedByReceipt({ reportDate, receiptPath, candidateHashes }) {
  if (!receiptPath || candidateHashes.length === 0) return false
  try {
    if (readPublicationReconciliation(WORKSPACE_ROOT) !== null) return false
  } catch {
    return false
  }
  let receipt
  try {
    receipt = readReceiptState(receiptPath).receipt
  } catch {
    return false
  }
  if (!verifiedReceiptIdentityIsValid(receipt, reportDate)) return false
  const receiptHash = normalizedHash(receipt.bundleSha256)
  return candidateHashes.every((hash) => hash !== null && hash === receiptHash)
}

function retainedPublicationReconciliation({ reportDate, intradayStatusPath, manifestPath, receiptPath = null }) {
  let status = null
  let statusReadable = false
  if (existsSync(intradayStatusPath)) {
    try {
      status = readJson(intradayStatusPath)
      statusReadable = true
    } catch {}
  }
  const statusRequiresReconciliation = statusReadable && (
    status?.reconciliationRequired === true || status?.status === 'intraday_holds_publication_outcome_unknown'
  )
  const candidateBundleSha256 = normalizedHash(status?.candidate?.bundleSha256)
  let manifest = null
  let manifestReadable = false
  let expectedBundleSha256 = null
  let manifestExpectedHashPresent = false
  try {
    manifest = readJson(manifestPath)
    manifestReadable = true
    const expected = manifest?.cloudflare_publish?.expected_bundle_sha256
    manifestExpectedHashPresent = expected !== undefined && expected !== null
    expectedBundleSha256 = normalizedHash(expected)
  } catch {
    // Either artifact can independently stop another write. Repairing an
    // unreadable counterpart remains an operator action.
  }
  const manifestRequiresReconciliation = manifestReadable && (
    manifest?.cloudflare_publish?.reconciliation_required === true ||
    manifest?.cloudflare_publish?.status === 'publication_outcome_unknown'
  )
  if (!statusRequiresReconciliation && !manifestRequiresReconciliation) return null
  const candidateHashes = [
    ...(statusRequiresReconciliation ? [candidateBundleSha256] : []),
    ...(manifestRequiresReconciliation ? [expectedBundleSha256] : []),
  ]
  if (reconciliationClearedByReceipt({ reportDate, receiptPath, candidateHashes })) return null

  const consistent = statusRequiresReconciliation &&
    status.reportDate === reportDate &&
    candidateBundleSha256 !== null &&
    (!manifestExpectedHashPresent || (expectedBundleSha256 !== null && candidateBundleSha256 === expectedBundleSha256))
  return {
    consistent,
    candidate: status?.candidate ?? (expectedBundleSha256 ? { bundleSha256: expectedBundleSha256.toLowerCase() } : null),
    candidateBundleSha256: (candidateBundleSha256 ?? expectedBundleSha256)?.toLowerCase() ?? null,
  }
}

function retainedGlobalPublicationReconciliation(workspaceRoot = WORKSPACE_ROOT) {
  try {
    const state = readPublicationReconciliation(workspaceRoot)
    if (!state) return null
    return {
      consistent: true,
      reportDate: state.reportDate,
      failureCode: state.failureCode,
      candidate: {
        bundleSha256: state.candidate.bundleSha256,
        dealerMailSha256: state.candidate.sourceHashes.dealerMail,
      },
    }
  } catch {
    return { consistent: false, reportDate: null, failureCode: 'PUBLICATION_RECONCILIATION_STATE_INVALID', candidate: null }
  }
}

function publicationAttemptForCandidate({ reportDate, bundleSha256, sourceHashes, holdRefresh, sourceFields = ['public', 'dealerMail', 'resources', 'managerDisposition', 'managerDispositionBinding'] }) {
  let state
  try {
    state = readPublicationReconciliation(WORKSPACE_ROOT)
  } catch {
    return { present: true, consistent: false, state: null }
  }
  if (!state) return null
  const consistent = state.reportDate === reportDate &&
    sameHash(state.candidate.bundleSha256, bundleSha256) &&
    state.candidate.holdRefresh === holdRefresh &&
    sourceFields.every((field) => {
      const expected = sourceHashes[field] ?? null
      const actual = state.candidate.sourceHashes[field] ?? null
      return expected === null ? actual === null : sameHash(actual, expected)
    })
  return { present: true, consistent, state }
}

async function runIntradayHoldRefresh({ options, reportDate, manifestPath, releasePath, receiptPath, intradayStatusPath, warnings, steps }) {
  const retainedReconciliation = retainedPublicationReconciliation({ reportDate, intradayStatusPath, manifestPath, receiptPath })
  if (retainedReconciliation) {
    const failureCode = retainedReconciliation.consistent
      ? 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN'
      : 'PUBLICATION_RECONCILIATION_STATE_INVALID'
    const summary = retainedReconciliation.consistent
      ? `Inventory Flow ${reportDate}: candidate SHA-256 ${retainedReconciliation.candidateBundleSha256} still requires reconciliation before another refresh.`
      : `Inventory Flow ${reportDate}: the retained publication reconciliation state is incomplete or inconsistent; operator review is required before another refresh.`
    return {
      ok: false,
      failureCode,
      summary,
      validation: {},
      manifestPath,
      releasePath,
      reconciliationRequired: true,
      candidate: retainedReconciliation.candidate,
    }
  }

  const beforeReceipt = readReceiptState(receiptPath)
  if (beforeReceipt.receipt?.status !== 'published_and_verified' || beforeReceipt.receipt?.reportDate !== reportDate || beforeReceipt.receipt?.complete !== true) {
    const summary = `Inventory Flow ${reportDate}: intraday hold refresh waiting for the morning verified release.`
    writeIntradayStatus(intradayStatusPath, { reportDate, status: 'waiting_for_verified_morning_release', summary })
    return { ok: true, summary, validation: {}, manifestPath, releasePath }
  }

  const publicPath = publicSnapshotPath(reportDate)
  const dealerPath = dealerCloudSnapshotPath(reportDate)
  const resourcePath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
  let baseline
  try {
    baseline = verifyHoldRefreshBaseline({
      reportDate,
      receipt: beforeReceipt.receipt,
      manifestPath,
      publicPath,
      dealerPath,
      resourcePath,
    })
  } catch (error) {
    const failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RECEIPT_BOUND_SOURCE_VALIDATION_FAILED'
    const failureDetail = failureDetailFor(error, failureCode)
    const summary = `Inventory Flow ${reportDate}: intraday hold refresh stopped because the last verified source bindings could not be proved.`
    writeIntradayStatus(intradayStatusPath, {
      reportDate,
      status: 'failed_receipt_bound_source_validation',
      failureCode,
      failureDetail,
      summary,
      steps,
    })
    return { ok: false, failureCode, ...(failureDetail ? { failureDetail } : {}), summary, manifestPath, releasePath }
  }

  const transaction = captureFileTransaction([
    manifestPath,
    releasePath,
    ...dealerMailRevisionPaths(reportDate),
  ])
  let keepCandidate = false
  let publishedFailureCode = null
  let publishedReceipt = null
  let candidateEvidence = null
  let result
  try {
    steps.push({ name: 'public_inventory', status: 'reused_receipt_bound', path: publicPath })
    steps.push({ name: 'manager_disposition', status: baseline.managerBinding ? 'reused_receipt_bound' : 'reused_none_receipt_bound' })

    const browserReady = options.skipAuthenticated ? false : await runtime.ensureAutomationBrowser(warnings)
    // Browser startup can take long enough for a stray process or manual edit
    // to replace the canonical file. Rebind it immediately before the archive
    // and capture so only the receipt-proven morning snapshot is archived.
    verifyHoldRefreshBaseline({
      reportDate,
      receipt: beforeReceipt.receipt,
      manifestPath,
      publicPath,
      dealerPath,
      resourcePath,
    })
    const refreshedDealerPath = await runDealerMail(reportDate, browserReady, warnings, steps, { refresh: true })
    if (!refreshedDealerPath) {
      const summary = `Inventory Flow ${reportDate}: intraday hold refresh failed; the last verified release was restored.`
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status: 'failed_dealermail_refresh',
        failureCode: 'DEALERMAIL_INCOMPLETE',
        summary,
        warnings,
        steps,
      })
      return { ok: false, failureCode: 'DEALERMAIL_INCOMPLETE', summary, manifestPath, releasePath }
    }

    // Recheck immutable inputs after the authenticated capture so a concurrent
    // or manual file replacement cannot ride along with the hold-only release.
    verifyHoldRefreshStableSources({
      reportDate,
      receipt: beforeReceipt.receipt,
      manifestPath,
      publicPath,
      resourcePath,
    })
    const resources = validateCurrentResourceFile()
    steps.push({
      name: 'resources',
      status: resources.ok ? 'reused_receipt_bound' : 'failed_blocking',
      detail: safeDetail(resources.output),
    })
    if (!resources.ok) throw new Error('RESOURCE_VALIDATION_FAILED')

    let manifest = candidateManifestFromBaseline({
      baseline: baseline.manifest,
      reportDate,
      publicPath,
      dealerPath: refreshedDealerPath,
      warnings,
      steps,
      managerDispositionBinding: baseline.managerBinding,
    })
    manifest.validation_results = {
      ...manifest.validation_results,
      resource_enrichment_validated: true,
      oasis_capture_validated: true,
      passed: true,
    }
    writeJson(manifestPath, manifest)

    const built = buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath, { receipt: beforeReceipt.receipt })
    if (options.noPublish) {
      const status = 'intraday_holds_validated_no_publish_last_verified_release_preserved'
      const summary = summarize({ reportDate, validation: built.validation, publishStatus: status, manifestPath, releasePath, warnings })
      writeIntradayStatus(intradayStatusPath, { reportDate, status, summary, validation: built.validation, warnings, steps })
      return { ok: true, summary, validation: built.validation, manifestPath, releasePath }
    }

    const publication = publish(reportDate, true, steps, { holdRefresh: true, expectedSourceHashes: built.sourceHashes })
    const durableAttempt = publicationAttemptForCandidate({
      reportDate,
      bundleSha256: built.bundleSha256,
      sourceHashes: built.sourceHashes,
      holdRefresh: true,
    })
    const afterReceipt = readReceiptStateAfterPublication(receiptPath)
    const publicationOutcome = classifyPublicationOutcome({
      processOk: publication.ok,
      beforeRaw: beforeReceipt.raw,
      afterState: afterReceipt,
      expectedHashes: built.sourceHashes,
      reportDate,
      publisherOutput: afterReceipt.lookupFailed || durableAttempt
        ? `${publication.output}\nCLOUD_PUBLICATION_OUTCOME_UNKNOWN`
        : publication.output,
    })

    if (publicationOutcome === 'published_and_followups_complete') {
      keepCandidate = true
      publishedFailureCode = 'POST_PUBLISH_STATE_RECORD_FAILED'
      publishedReceipt = afterReceipt.receipt
      manifest = readJson(manifestPath)
      manifest.daily_steps = steps
      writeJson(manifestPath, manifest)
      const status = 'intraday_holds_published_and_verified'
      const summary = summarize({ reportDate, validation: built.validation, publishStatus: status, manifestPath, releasePath, warnings })
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status,
        summary,
        validation: built.validation,
        warnings,
        steps,
        published: true,
        receipt: afterReceipt.receipt,
      })
      result = { ok: true, summary, validation: built.validation, manifestPath, releasePath }
      return result
    }

    if (publicationOutcome === 'published_followups_pending') {
      keepCandidate = true
      publishedFailureCode = 'CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED'
      publishedReceipt = afterReceipt.receipt
      steps.at(-1).status = 'published_followups_failed'
      manifest = readJson(manifestPath)
      manifest.daily_steps = steps
      manifest.cloudflare_publish = {
        attempted: true,
        status: 'published_and_verified_followups_pending',
        receipt_path: receiptPath,
        bundle_sha256: afterReceipt.receipt.bundleSha256,
        verified_at: afterReceipt.receipt.verifiedAt,
        publisher: 'BobMaxey-InventoryFlow-DailyPublish',
      }
      writeJson(manifestPath, manifest)
      const status = 'intraday_holds_published_followups_pending'
      const summary = summarize({ reportDate, validation: built.validation, publishStatus: status, manifestPath, releasePath, warnings })
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status,
        failureCode: 'CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED',
        summary,
        validation: built.validation,
        warnings,
        steps,
        published: true,
        receipt: afterReceipt.receipt,
      })
      result = { ok: false, failureCode: 'CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED', summary, validation: built.validation, manifestPath, releasePath }
      return result
    }

    if (publicationOutcome === 'publication_outcome_unknown') {
      keepCandidate = true
      publishedFailureCode = durableAttempt && !durableAttempt.consistent
        ? 'PUBLICATION_RECONCILIATION_STATE_INVALID'
        : 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN'
      const candidateBundleSha256 = publishedCandidateBundleSha256(publication.output, built.bundleSha256)
      candidateEvidence = {
        bundleSha256: candidateBundleSha256,
        dealerMailSha256: built.sourceHashes.dealerMail,
      }
      steps.at(-1).status = 'publication_outcome_unknown'
      manifest = readJson(manifestPath)
      manifest.daily_steps = steps
      manifest.cloudflare_publish = {
        attempted: true,
        status: 'publication_outcome_unknown',
        reconciliation_required: true,
        expected_bundle_sha256: candidateBundleSha256,
        receipt_path: receiptPath,
        publisher: 'BobMaxey-InventoryFlow-DailyPublish',
      }
      writeJson(manifestPath, manifest)
      const status = 'intraday_holds_publication_outcome_unknown'
      const summary = `Inventory Flow ${reportDate}: the cloud publisher may have accepted the validated hold release, but the exact candidate could not be re-verified. The candidate was retained and requires reconciliation before another refresh.`
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status,
        failureCode: publishedFailureCode,
        summary,
        validation: built.validation,
        warnings,
        steps,
        reconciliationRequired: true,
        candidate: candidateEvidence,
      })
      result = { ok: false, failureCode: publishedFailureCode, summary, validation: built.validation, manifestPath, releasePath }
      return result
    }

    throw new Error('CLOUDFLARE_PUBLISH_FAILED')
  } catch (error) {
    if (keepCandidate) {
      const failureCode = publishedFailureCode ?? 'POST_PUBLISH_STATE_RECORD_FAILED'
      const failureDetail = failureDetailFor(error, failureCode)
      const outcomeUnknown = ['CLOUD_PUBLICATION_OUTCOME_UNKNOWN', 'PUBLICATION_RECONCILIATION_STATE_INVALID'].includes(failureCode)
      const summary = outcomeUnknown
        ? `Inventory Flow ${reportDate}: the cloud publication outcome remains unknown and requires reconciliation before another refresh.`
        : `Inventory Flow ${reportDate}: the intraday hold release is published and verified, but post-publication state recording is incomplete.`
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status: outcomeUnknown ? 'intraday_holds_publication_outcome_unknown' : 'intraday_holds_published_followups_pending',
        failureCode,
        failureDetail,
        summary,
        warnings,
        steps,
        published: !outcomeUnknown,
        receipt: outcomeUnknown ? null : publishedReceipt,
        reconciliationRequired: outcomeUnknown,
        candidate: outcomeUnknown ? candidateEvidence : null,
      })
      result = { ok: false, failureCode, ...(failureDetail ? { failureDetail } : {}), summary, manifestPath, releasePath }
      return result
    }
    const failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'INTRADAY_REFRESH_VALIDATION_FAILED'
    const failureDetail = failureDetailFor(error, failureCode)
    const status = failureCode === 'CLOUDFLARE_PUBLISH_FAILED'
      ? 'publish_failed_last_verified_release_preserved'
      : 'intraday_refresh_failed_last_verified_release_preserved'
    const summary = `Inventory Flow ${reportDate}: intraday hold refresh failed before a new verified publication; the last verified release was restored.`
    writeIntradayStatus(intradayStatusPath, { reportDate, status, failureCode, failureDetail, summary, warnings, steps })
    result = { ok: false, failureCode, ...(failureDetail ? { failureDetail } : {}), summary, manifestPath, releasePath }
    return result
  } finally {
    if (keepCandidate) transaction.commit()
    else {
      try { transaction.rollback() } catch (error) {
        const summary = `Inventory Flow ${reportDate}: intraday rollback failed; operator review is required before another publication attempt.`
        writeIntradayStatus(intradayStatusPath, {
          reportDate,
          status: 'failed_rollback_requires_attention',
          failureCode: 'INTRADAY_ROLLBACK_FAILED',
          failureDetail: failureDetailFor(error, 'INTRADAY_ROLLBACK_FAILED'),
          summary,
          warnings,
          steps,
        })
        throw new Error('INTRADAY_ROLLBACK_FAILED', { cause: error })
      }
    }
  }
}

// Collector bridge staging is intentionally separate from the normal daily
// runner. It reuses only the receipt-bound hold-refresh validation/build path,
// copies the exact validated bundle to a private attempt directory, then
// restores all canonical files before returning. `captureDealerMail` is an
// injected, fixed adapter callback; this helper never starts a browser or
// chooses a source.
function writeCollectorAttemptFile(filePath, content) {
  const descriptor = openSync(filePath, 'wx', 0o600)
  try { writeFileSync(descriptor, content); fsyncSync(descriptor) }
  finally { closeSync(descriptor) }
  syncCollectorDirectory(path.dirname(filePath))
}

function writeCollectorPromotionBackup(filePath, content) {
  const directory = path.dirname(filePath)
  const temporary = `${filePath}.tmp`
  try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const descriptor = openSync(temporary, 'wx', 0o600)
  try { writeFileSync(descriptor, content); fsyncSync(descriptor) }
  finally { closeSync(descriptor) }
  try {
    renameSync(temporary, filePath)
    syncCollectorDirectory(directory)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function syncCollectorDirectory(directory) {
  if (process.platform === 'win32') return
  const descriptor = openSync(directory, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function writeCollectorBaselineFile(filePath, content) {
  const temporary = `${filePath}.${process.pid}.collector.tmp`
  const descriptor = openSync(temporary, 'wx', 0o600)
  try {
    try { writeFileSync(descriptor, content); fsyncSync(descriptor) }
    finally { closeSync(descriptor) }
    renameSync(temporary, filePath)
  } finally { try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  syncCollectorDirectory(path.dirname(filePath))
}

const COLLECTOR_CAPTURE_JOURNAL_LIMIT = 128 * 1024 * 1024
const COLLECTOR_CAPTURE_FILE_LIMIT = 25 * 1024 * 1024
const collectorCaptureJournalPath = () => path.join(WORK_ROOT, 'collector-attempts', 'capture-rollback.json')
function collectorCaptureBaselinePaths(reportDate) {
  return {
    manifest: path.join(WORK_ROOT, 'run-status', `${reportDate}.json`),
    release: path.join(WORK_ROOT, 'releases', reportDate, 'inventory-flow-release.json'),
    ...Object.fromEntries(dealerMailRevisionPaths(reportDate).map((filePath, index) => [`dealerMail${index}`, filePath])),
    receipt: path.join(WORK_ROOT, 'app-feed-status', `${reportDate}.json`),
  }
}

function readCollectorCaptureJournal(journalPath) {
  assertCollectorLocalFile(journalPath)
  if (lstatSync(journalPath).size > COLLECTOR_CAPTURE_JOURNAL_LIMIT) throw new Error('RECONCILIATION_REQUIRED')
  const journal = readJson(journalPath)
  if (Object.keys(journal).sort().join(',') !== 'attemptId,baselineBundleSha256,child,files,reportDate,schemaVersion' || journal.schemaVersion !== 2 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(journal.attemptId ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(journal.reportDate ?? '') ||
      !normalizedHash(journal.baselineBundleSha256)) throw new Error('RECONCILIATION_REQUIRED')
  if (journal.child !== null) {
    const child = journal.child
    if (Object.keys(child ?? {}).sort().join(',') !== 'nonce,ownerId,parentPid,phase,pid' ||
        !['launch_pending', 'active'].includes(child.phase) || !Number.isSafeInteger(child.parentPid) || child.parentPid < 1 ||
        !/^[a-f0-9-]{36}$/.test(child.nonce ?? '') || !/^[a-f0-9-]{36}$/.test(child.ownerId ?? '') ||
        (child.phase === 'launch_pending' ? child.pid !== null : !Number.isSafeInteger(child.pid) || child.pid < 1)) throw new Error('RECONCILIATION_REQUIRED')
  }
  const paths = collectorCaptureBaselinePaths(journal.reportDate)
  if (Object.keys(journal.files ?? {}).sort().join(',') !== Object.keys(paths).sort().join(',')) throw new Error('RECONCILIATION_REQUIRED')
  const files = Object.fromEntries(Object.entries(journal.files).map(([key, value]) => {
    if (value === null) return [key, null]
    if (Object.keys(value).sort().join(',') !== 'bytes,sha256' || typeof value.bytes !== 'string' || value.bytes.length > Math.ceil(COLLECTOR_CAPTURE_FILE_LIMIT / 3) * 4) throw new Error('RECONCILIATION_REQUIRED')
    const bytes = Buffer.from(value.bytes, 'base64')
    if (bytes.length > COLLECTOR_CAPTURE_FILE_LIMIT || bytes.toString('base64') !== value.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw new Error('RECONCILIATION_REQUIRED')
    return [key, bytes]
  }))
  if (!files.manifest || !files.release || !files.receipt || !files.dealerMail5) throw new Error('RECONCILIATION_REQUIRED')
  const receipt = JSON.parse(files.receipt.toString('utf8'))
  const manifest = JSON.parse(files.manifest.toString('utf8'))
  if (!verifiedReceiptIdentityIsValid(receipt, journal.reportDate) || !sameHash(receipt.bundleSha256, journal.baselineBundleSha256) ||
      !sameHash(cloudBundleSha256(JSON.parse(files.release.toString('utf8'))), journal.baselineBundleSha256) ||
      manifest.report_date !== journal.reportDate || manifest.complete !== true ||
      path.resolve(WORKSPACE_ROOT, manifest.dealermail_snapshot_path ?? '') !== paths.dealerMail5 ||
      !sameHash(createHash('sha256').update(files.dealerMail5).digest('hex'), receipt.sourceHashes?.dealerMail) ||
      !sameHash(manifest.dealermail_snapshot_sha256, receipt.sourceHashes?.dealerMail)) throw new Error('RECONCILIATION_REQUIRED')
  // Validate every destination before the first rollback write. Journal contents
  // carry fixed slots rather than caller-selected paths.
  for (const filePath of Object.values(paths)) assertCollectorLocalFile(filePath, true)
  return { journal, paths, files }
}

function recoverCollectorCaptureBaseline() {
  const journalPath = collectorCaptureJournalPath(), directory = path.dirname(journalPath)
  if (!existsSync(directory)) return false
  let lock
  try {
    const pending = assertCollectorLocalFile(journalPath, true)
    const temporary = assertCollectorLocalFile(`${journalPath}.tmp`, true)
    if (!pending && !temporary) return false
    const lockPath = path.join(WORK_ROOT, 'app-feed-status', '.publication.lock')
    if (!assertInheritedPublicationLock(lockPath)) lock = acquirePublicationLock(lockPath)
    // A partial journal was never admitted for capture. Keep it for review;
    // never guess original bytes or silently delete recovery evidence.
    if (temporary) throw new Error('RECONCILIATION_REQUIRED')
    const { journal, paths, files } = readCollectorCaptureJournal(journalPath)
    if (journal.child) {
      // A dead host does not prove its separately spawned writer is dead. An
      // admitted child fences rollback until definite exit; PID reuse, EPERM
      // and unknown process status remain blocked, never grounds for a kill.
      const pid = journal.child.phase === 'active' ? journal.child.pid : journal.child.parentPid
      let definitelyExited = false
      try { process.kill(pid, 0) } catch (error) { definitelyExited = error.code === 'ESRCH' }
      if (!definitelyExited) throw new Error('RECONCILIATION_REQUIRED')
    }
    // Publication/promotion never runs while this journal exists. A changed
    // receipt is outside this transaction's authority and must be reconciled.
    if (!readFileSync(paths.receipt).equals(files.receipt)) throw new Error('RECONCILIATION_REQUIRED')
    for (const [key, filePath] of Object.entries(paths)) {
      if (files[key] === null) {
        try { unlinkSync(filePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
        syncCollectorDirectory(path.dirname(filePath))
      } else if (!existsSync(filePath) || !readFileSync(filePath).equals(files[key])) {
        writeCollectorBaselineFile(filePath, files[key])
      }
    }
    for (const [key, filePath] of Object.entries(paths)) {
      if (files[key] === null ? existsSync(filePath) : !readFileSync(filePath).equals(files[key])) throw new Error('RECONCILIATION_REQUIRED')
    }
    verifyHoldRefreshBaseline({ reportDate: journal.reportDate, receipt: JSON.parse(files.receipt.toString('utf8')),
      manifestPath: paths.manifest, publicPath: publicSnapshotPath(journal.reportDate), dealerPath: paths.dealerMail5,
      resourcePath: path.join(APP_ROOT, 'data', 'vin-document-enrichment.json') })
    // Confirm journal removal can be persisted before retiring the only backup.
    syncCollectorDirectory(directory)
    unlinkSync(journalPath)
    syncCollectorDirectory(directory)
    return true
  } catch { throw new Error('RECONCILIATION_REQUIRED') }
  finally { if (lock) releasePublicationLock(lock) }
}

function beginCollectorCaptureRollback({ reportDate, attemptId, baselineBundleSha256 }) {
  const journalPath = collectorCaptureJournalPath(), directory = path.dirname(journalPath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  syncCollectorDirectory(WORK_ROOT)
  if (assertCollectorLocalFile(journalPath, true) || assertCollectorLocalFile(`${journalPath}.tmp`, true)) throw new Error('RECONCILIATION_REQUIRED')
  const paths = collectorCaptureBaselinePaths(reportDate)
  const files = Object.fromEntries(Object.entries(paths).map(([key, filePath]) => {
    if (!assertCollectorLocalFile(filePath, true)) return [key, null]
    if (lstatSync(filePath).size > COLLECTOR_CAPTURE_FILE_LIMIT) throw new Error('RECONCILIATION_REQUIRED')
    const bytes = readFileSync(filePath)
    return [key, { bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }]
  }))
  const serialized = JSON.stringify({ schemaVersion: 2, attemptId, reportDate, baselineBundleSha256, child: null, files })
  if (Buffer.byteLength(serialized) > COLLECTOR_CAPTURE_JOURNAL_LIMIT) throw new Error('RECONCILIATION_REQUIRED')
  // Unlike an attempt artifact, this fixed journal survives cleanup and holds
  // the receipt-bound baseline until exact rollback succeeds on any startup.
  writeCollectorAttemptFile(`${journalPath}.tmp`, serialized)
  renameSync(`${journalPath}.tmp`, journalPath)
  syncCollectorDirectory(directory)
  readCollectorCaptureJournal(journalPath)
  return { rollback: recoverCollectorCaptureBaseline, childGuard: collectorCaptureChildGuard(journalPath) }
}

function writeCollectorCaptureJournal(journalPath, journal) {
  const temporary = `${journalPath}.tmp`
  const serialized = JSON.stringify(journal)
  if (Buffer.byteLength(serialized) > COLLECTOR_CAPTURE_JOURNAL_LIMIT) throw new Error('RECONCILIATION_REQUIRED')
  // Preserve both the old complete backup and any interrupted replacement.
  // A temporary replacement makes all later recovery fail closed.
  writeCollectorAttemptFile(temporary, serialized)
  renameSync(temporary, journalPath)
  syncCollectorDirectory(path.dirname(journalPath))
}

function collectorCaptureChildGuard(journalPath) {
  let launch = null
  const matchingJournal = () => {
    const { journal } = readCollectorCaptureJournal(journalPath)
    if (!launch || journal.child?.nonce !== launch.nonce || journal.child.ownerId !== launch.ownerId ||
        journal.child.parentPid !== process.pid) throw new Error('RECONCILIATION_REQUIRED')
    return journal
  }
  return {
    prepare() {
      const lockPath = path.join(WORK_ROOT, 'app-feed-status', '.publication.lock')
      if (!assertInheritedPublicationLock(lockPath)) throw new Error(PUBLICATION_LOCKED)
      const { journal } = readCollectorCaptureJournal(journalPath)
      if (journal.child !== null) throw new Error('RECONCILIATION_REQUIRED')
      launch = { phase: 'launch_pending', pid: null, parentPid: process.pid, nonce: randomUUID(), ownerId: process.env[PUBLICATION_LOCK_OWNER_ENV] }
      writeCollectorCaptureJournal(journalPath, { ...journal, child: launch })
      return { journalPath, nonce: launch.nonce, ownerId: launch.ownerId }
    },
    register(pid) {
      const journal = matchingJournal()
      if (journal.child.phase !== 'launch_pending' || !Number.isSafeInteger(pid) || pid < 1) throw new Error('RECONCILIATION_REQUIRED')
      writeCollectorCaptureJournal(journalPath, { ...journal, child: { ...launch, phase: 'active', pid } })
    },
    closed() {
      const journal = matchingJournal()
      writeCollectorCaptureJournal(journalPath, { ...journal, child: null })
      launch = null
    },
  }
}

async function stageIntradayHoldRefreshCandidate({ reportDate, attemptId, baselineBundleSha256, captureDealerMail }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '') || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attemptId ?? '')) {
    throw new Error('COLLECTOR_ATTEMPT_INVALID')
  }
  if (typeof captureDealerMail !== 'function') throw new Error('COLLECTOR_ADAPTER_INVALID')
  if (!assertInheritedPublicationLock(path.join(WORK_ROOT, 'app-feed-status', '.publication.lock'))) throw new Error(PUBLICATION_LOCKED)
  const verified = inspectCollectorBaseline(reportDate)
  const { manifestPath, releasePath, receiptPath, publicPath, dealerPath, resourcePath, baseline, receipt } = verified
  if (!sameHash(receipt.bundleSha256, baselineBundleSha256)) throw new Error('BASELINE_REQUIRED')
  const beforeReceipt = { receipt }
  const transaction = beginCollectorCaptureRollback({ reportDate, attemptId, baselineBundleSha256 })
  let staged = false
  try {
    await captureDealerMail({ reportDate, workspaceRoot: WORKSPACE_ROOT, childGuard: transaction.childGuard })
    verifyHoldRefreshStableSources({ reportDate, receipt: beforeReceipt.receipt, manifestPath, publicPath, resourcePath })
    const resourceValidation = validateCurrentResourceFile()
    if (!resourceValidation.ok) throw new Error('BASELINE_INVALID')

    const steps = [
      { name: 'public_inventory', status: 'reused_receipt_bound' },
      { name: 'manager_disposition', status: baseline.managerBinding ? 'reused_receipt_bound' : 'reused_none_receipt_bound' },
      { name: 'dealermail', status: 'captured' },
      { name: 'resources', status: 'reused_receipt_bound' },
    ]
    const manifest = candidateManifestFromBaseline({
      baseline: baseline.manifest,
      reportDate,
      publicPath,
      dealerPath,
      warnings: [],
      steps,
      managerDispositionBinding: baseline.managerBinding,
    })
    manifest.validation_results = {
      ...manifest.validation_results,
      resource_enrichment_validated: true,
      oasis_capture_validated: true,
      passed: true,
    }
    writeJson(manifestPath, manifest)
    const built = buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath, { receipt: beforeReceipt.receipt })
    const bundle = readJson(releasePath)
    const bundleSha256 = cloudBundleSha256(bundle)
    if (!sameHash(bundleSha256, built.bundleSha256)) throw new Error('CANDIDATE_HASH_MISMATCH')

    const candidateDirectory = path.join(WORK_ROOT, 'collector-attempts')
    const candidatePath = path.join(candidateDirectory, `${attemptId}.release.json`)
    mkdirSync(candidateDirectory, { recursive: true, mode: 0o700 })
    const directoryInfo = lstatSync(candidateDirectory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || existsSync(candidatePath)) throw new Error('ATTEMPT_DIRECTORY_INVALID')
    writeCollectorAttemptFile(candidatePath, readFileSync(releasePath))
    const candidateManifestPath = path.join(candidateDirectory, `${attemptId}.manifest.json`)
    writeCollectorAttemptFile(candidateManifestPath, JSON.stringify(readJson(manifestPath), null, 2) + '\n')
    // The canonical inputs are rolled back below. Retain the exact bytes that
    // were validated, so verified publication can advance the local baseline
    // without another capture, build, or raw evidence merge.
    const candidateDealerMailPath = path.join(candidateDirectory, `${attemptId}.dealermail.json`)
    writeCollectorAttemptFile(candidateDealerMailPath, readFileSync(dealerPath))
    const dealerSnapshot = readJson(dealerPath)
    const dealerRows = dealerSnapshot.completeDealerMailUsedInventory?.rows
    if (!Array.isArray(dealerRows)) throw new Error('DEALERMAIL_SNAPSHOT_INVALID')
    const capturedAt = dealerSnapshot.extractedAtUtc
    const nestedCapturedAt = dealerSnapshot.completeDealerMailUsedInventory?.extractedAtUtc
    if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt)) ||
        typeof nestedCapturedAt !== 'string' || !Number.isFinite(Date.parse(nestedCapturedAt)) ||
        Date.parse(capturedAt) !== Date.parse(nestedCapturedAt)) throw new Error('DEALERMAIL_SNAPSHOT_INVALID')
    staged = true
    return {
      candidatePath,
      candidateManifestPath,
      candidateDealerMailPath,
      bundleSha256: bundleSha256.toLowerCase(),
      sourceSha256: sha256(dealerPath).toLowerCase(),
      reportDate,
      dealerMailRows: dealerRows.length,
      capturedAt,
      counts: built.validation,
    }
  } finally {
    try { transaction.rollback() } catch (error) {
      if (staged) throw new Error('CANONICAL_ROLLBACK_FAILED', { cause: error })
      throw error
    }
  }
}

function assertCollectorLocalFile(filePath, optional = false) {
  const relative = path.relative(WORKSPACE_ROOT, filePath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  let current = WORKSPACE_ROOT
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    let stat
    try { stat = lstatSync(current) }
    catch (error) { if (optional && current === filePath && error.code === 'ENOENT') return false; throw error }
    if (stat.isSymbolicLink() || (current === filePath ? !stat.isFile() : !stat.isDirectory())) throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  }
  return true
}

// Only a tenant-verified exact candidate may advance the local receipt-bound
// baseline. This API is used by initial publication and read-only reconciliation
// while the collector owns the same publication lock as the legacy writer.
function promoteVerifiedCollectorCandidate({ profile, claim, candidate, verification }) {
  if (profile?.workspaceRoot !== WORKSPACE_ROOT || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(claim?.attemptId ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(claim?.reportDate ?? '') || !normalizedHash(claim.baselineBundleSha256)) {
    throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  }
  const lockPath = path.join(WORK_ROOT, 'app-feed-status', '.publication.lock')
  if (!assertInheritedPublicationLock(lockPath)) throw new Error(PUBLICATION_LOCKED)
  recoverCollectorCaptureBaseline()
  const { attemptId, reportDate } = claim
  const base = path.join(WORK_ROOT, 'collector-attempts', attemptId)
  const retainedPaths = { release: `${base}.release.json`, manifest: `${base}.manifest.json`, dealerMail: `${base}.dealermail.json` }
  if (candidate?.candidatePath !== retainedPaths.release || candidate?.candidateManifestPath !== retainedPaths.manifest || candidate?.candidateDealerMailPath !== retainedPaths.dealerMail) {
    throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  }
  for (const filePath of Object.values(retainedPaths)) assertCollectorLocalFile(filePath)
  const bundle = readJson(retainedPaths.release)
  const bundleSha256 = cloudBundleSha256(bundle)
  const counts = validateReleaseBundle(bundle)
  if (!sameHash(bundleSha256, candidate.bundleSha256) || bundle.reportDate !== reportDate ||
      !['published_verified', 'unchanged_verified'].includes(verification?.status) || verification.attemptId !== attemptId ||
      !sameHash(verification.bundleSha256, bundleSha256) || verification.reportDate !== reportDate || verification.ready !== true ||
      typeof verification.verifiedAt !== 'string' || !Number.isFinite(Date.parse(verification.verifiedAt)) ||
      verification.counts?.inventory !== counts.activeInventoryCount || verification.counts?.managerDispositions !== counts.managerDispositionRecordCount) {
    throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  }
  const manifest = readJson(retainedPaths.manifest)
  const sourceHashes = receiptSourceHashes(bundle.release)
  const paths = {
    dealerMail: dealerCloudSnapshotPath(reportDate),
    release: path.join(WORK_ROOT, 'releases', reportDate, 'inventory-flow-release.json'),
    manifest: path.join(WORK_ROOT, 'run-status', `${reportDate}.json`),
    receipt: path.join(WORK_ROOT, 'app-feed-status', `${reportDate}.json`),
  }
  for (const filePath of Object.values(paths)) assertCollectorLocalFile(filePath)
  if (!sameHash(sha256(retainedPaths.dealerMail), sourceHashes.dealerMail) || !sameHash(candidate.sourceSha256, sourceHashes.dealerMail) ||
      !sameHash(manifest.dealermail_snapshot_sha256, sourceHashes.dealerMail) || manifest.report_date !== reportDate || manifest.complete !== true ||
      path.resolve(WORKSPACE_ROOT, manifest.dealermail_snapshot_path) !== paths.dealerMail ||
      path.resolve(WORKSPACE_ROOT, manifest.public_snapshot_path) !== publicSnapshotPath(reportDate) ||
      cloudBundleSha256(publishedManifestFrom(manifest)) !== cloudBundleSha256(bundle.release.manifest) ||
      cloudBundleSha256(readJson(retainedPaths.dealerMail)) !== cloudBundleSha256(bundle.release.dealerMailSnapshot)) {
    throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  }
  const localReceipt = readReceiptState(paths.receipt).receipt
  if (!verifiedReceiptIdentityIsValid(localReceipt, reportDate) ||
      (!sameHash(localReceipt.bundleSha256, claim.baselineBundleSha256) && !sameHash(localReceipt.bundleSha256, bundleSha256))) {
    throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  }
  verifyHoldRefreshStableSources({ reportDate, receipt: localReceipt, manifestPath: retainedPaths.manifest, publicPath: publicSnapshotPath(reportDate), resourcePath: path.join(APP_ROOT, 'data', 'vin-document-enrichment.json') })
  assertCandidatePreservesReceiptSources(bundle.release, localReceipt)
  const expectedBytes = Object.fromEntries(Object.entries(retainedPaths).map(([key, filePath]) => [key, readFileSync(filePath)]))
  const localMatches = () => Object.entries(expectedBytes).every(([key, content]) => readFileSync(paths[key]).equals(content)) &&
    assertReceiptHashes(readReceiptState(paths.receipt).receipt, sourceHashes, reportDate) && sameHash(readReceiptState(paths.receipt).receipt.bundleSha256, bundleSha256)
  if (localMatches()) return { status: 'local_baseline_verified', bundleSha256, receiptPath: paths.receipt }

  const backupPath = `${base}.promotion-backup.json`
  let backup
  if (existsSync(backupPath)) {
    assertCollectorLocalFile(backupPath)
    backup = readJson(backupPath)
    if (backup.attemptId !== attemptId || backup.reportDate !== reportDate || !sameHash(backup.bundleSha256, bundleSha256) ||
        !sameHash(backup.baselineBundleSha256, claim.baselineBundleSha256) || backup.profileSha256 !== profile.profileSha256 ||
        Object.keys(backup.files ?? {}).sort().join(',') !== Object.keys(paths).sort().join(',')) throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
  } else {
    verifyHoldRefreshBaseline({ reportDate, receipt: localReceipt, manifestPath: paths.manifest, publicPath: publicSnapshotPath(reportDate), dealerPath: paths.dealerMail, resourcePath: path.join(APP_ROOT, 'data', 'vin-document-enrichment.json') })
    backup = { attemptId, reportDate, bundleSha256, baselineBundleSha256: claim.baselineBundleSha256, profileSha256: profile.profileSha256,
      files: Object.fromEntries(Object.entries(paths).map(([key, filePath]) => { const content = readFileSync(filePath); return [key, { bytes: content.toString('base64'), sha256: createHash('sha256').update(content).digest('hex') }] })) }
    runtime.writeCollectorPromotionBackup(backupPath, JSON.stringify(backup))
  }
  const backups = Object.fromEntries(Object.entries(backup.files).map(([key, value]) => {
    const content = Buffer.from(value.bytes, 'base64')
    if (createHash('sha256').update(content).digest('hex') !== value.sha256) throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
    return [key, content]
  }))
  const receipt = { schemaVersion: 1, reportDate, complete: true, status: 'published_and_verified', publication: verification.status,
    bundleSha256, verifiedAt: verification.verifiedAt, counts,
    validation: { exactContent: true, storeCounts: true, privateAppReadiness: true, managerDispositionBound: true }, sourceHashes }
  try {
    for (const key of ['dealerMail', 'release', 'manifest']) runtime.writeCollectorBaselineFile(paths[key], expectedBytes[key])
    // Keep the existing receipt schema, but atomically replace the receipt
    // last: interruption must expose either the old or exact new receipt.
    writeCollectorBaselineFile(paths.receipt, JSON.stringify(receipt, null, 2) + '\n')
    if (!localMatches()) throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED')
    verifyHoldRefreshBaseline({ reportDate, receipt, manifestPath: paths.manifest, publicPath: publicSnapshotPath(reportDate), dealerPath: paths.dealerMail, resourcePath: path.join(APP_ROOT, 'data', 'vin-document-enrichment.json') })
    return { status: 'local_baseline_verified', bundleSha256, receiptPath: paths.receipt }
  } catch (error) {
    // The durable backup survives an interrupted process as well as a failed
    // write. Exact candidate and pending host state remain for read-only retry.
    try { for (const [key, content] of Object.entries(backups)) writeCollectorBaselineFile(paths[key], content) }
    catch (rollbackError) { throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED', { cause: rollbackError }) }
    throw new Error('COLLECTOR_LOCAL_PROMOTION_FAILED', { cause: error })
  }
}

async function retryPublicationFollowups({ reportDate, receipt, manifestPath, releasePath, steps }) {
  const manifest = readJson(manifestPath)
  if (manifest.complete !== true || manifest.report_date !== reportDate ||
      !sameHash(manifest.cloudflare_publish?.bundle_sha256, receipt.bundleSha256)) throw new Error('PENDING_FOLLOWUPS_RECEIPT_MISMATCH')
  const bundle = readRetainedPublication({ workspaceRoot: WORKSPACE_ROOT, reportDate, receipt, required: true })
  const result = publish(reportDate, false, steps, { followupsOnly: receipt.bundleSha256 })
  const currentReceipt = readReceiptState(path.join(WORK_ROOT, 'app-feed-status', `${reportDate}.json`)).receipt
  if (!currentReceipt) throw new Error('VERIFIED_RECEIPT_REQUIRED')
  assertRetainedPublication({ bundle, receipt: currentReceipt, reportDate })
  const retainedManifest = readJson(manifestPath)
  if (retainedManifest.cloudflare_publish?.reconciliation_required === true || retainedManifest.cloudflare_publish?.status === 'publication_outcome_unknown') {
    throw new Error('PUBLICATION_RECONCILIATION_REQUIRED')
  }
  if (!result.ok) {
    retainedManifest.cloudflare_publish = { ...retainedManifest.cloudflare_publish, status: 'published_and_verified_followups_pending', bundle_sha256: receipt.bundleSha256 }
    writeJson(manifestPath, retainedManifest)
  }
  const completed = result.ok && readJson(manifestPath).cloudflare_publish?.status === 'published_and_verified'
  const summary = summarize({ reportDate, validation: receipt.counts ?? {}, publishStatus: completed ? 'published_and_followups_complete' : 'published_followups_pending', manifestPath, releasePath, warnings: manifest.warnings ?? [] })
  return { ok: completed, failureCode: completed ? null : 'CLOUDFLARE_POST_PUBLISH_FOLLOWUPS_FAILED', summary, validation: receipt.counts ?? {}, manifestPath, releasePath }
}

async function runDailyUnlocked(options) {
  const reportDate = options.date ?? todayInNewYork()
  const manifestPath = path.join(WORK_ROOT, 'run-status', `${reportDate}.json`)
  const releaseDirectory = path.join(WORK_ROOT, 'releases', reportDate)
  const releasePath = path.join(releaseDirectory, 'inventory-flow-release.json')
  const receiptPath = path.join(WORK_ROOT, 'app-feed-status', `${reportDate}.json`)
  const intradayStatusPath = path.join(WORK_ROOT, 'hold-refresh-status', `${reportDate}.json`)
  const summaryPath = path.join(releaseDirectory, 'daily-summary.json')
  const warnings = []
  const steps = []

  if (options.dryRun) {
    const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT, now: validationClockFor(reportDate) })
    if (release.reportDate !== reportDate) throw new Error(`Dry run found latest release ${release.reportDate}, expected ${reportDate}`)
    const validation = validateReleaseBundle(cloudReleaseFrom(release))
    const summary = summarize({
      reportDate,
      validation,
      publishStatus: 'dry_run_validated_no_publish',
      manifestPath,
      releasePath,
      warnings: release.warnings ?? [],
    })
    return { ok: true, summary, validation, manifestPath, releasePath }
  }

  const retainedGlobalReconciliation = retainedGlobalPublicationReconciliation()
  if (retainedGlobalReconciliation) {
    const failureCode = retainedGlobalReconciliation.consistent
      ? 'PUBLICATION_RECONCILIATION_REQUIRED'
      : 'PUBLICATION_RECONCILIATION_STATE_INVALID'
    const summary = retainedGlobalReconciliation.consistent
      ? `Inventory Flow publication is blocked: the ${retainedGlobalReconciliation.reportDate} candidate SHA-256 ${retainedGlobalReconciliation.candidate.bundleSha256} requires exact-hash reconciliation before any new capture, rebuild, or publish.`
      : 'Inventory Flow publication is blocked: the durable publication-reconciliation marker is malformed or unreadable and requires operator repair before any new capture, rebuild, or publish.'
    return {
      ok: false,
      failureCode,
      summary,
      validation: {},
      manifestPath,
      releasePath,
      reconciliationRequired: true,
      candidate: retainedGlobalReconciliation.candidate,
    }
  }

  // A forced/new capture cannot overtake the exact verified candidate's
  // unfinished documents, integration projection, pointers, or archive.
  if (existsSync(manifestPath) &&
      readJson(manifestPath).cloudflare_publish?.status === 'published_and_verified_followups_pending') {
    if (options.noPublish) return { ok: false, failureCode: 'PUBLISH_SKIPPED_FOLLOWUPS_PENDING', summary: `Inventory Flow ${reportDate}: publication followups remain pending; --no-publish deferred the receipt-bound retry.`, validation: {}, manifestPath, releasePath }
    const receipt = readReceiptState(receiptPath).receipt
    if (!verifiedReceiptIdentityIsValid(receipt, reportDate)) throw new Error('VERIFIED_RECEIPT_REQUIRED')
    return retryPublicationFollowups({ reportDate, receipt, manifestPath, releasePath, steps })
  }

  if (options.refreshHolds) {
    return runIntradayHoldRefresh({
      options,
      reportDate,
      manifestPath,
      releasePath,
      receiptPath,
      intradayStatusPath,
      warnings,
      steps,
    })
  }

  if (!options.forcePublish && existsSync(receiptPath)) {
    const receipt = readJson(receiptPath)
    if (receipt.status === 'published_and_verified' && receipt.reportDate === reportDate) {
      const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT, now: validationClockFor(reportDate) })
      const validation = validateReleaseBundle(cloudReleaseFrom(release))
      const summary = summarize({
        reportDate,
        validation,
        publishStatus: 'already_published_and_verified',
        manifestPath,
        releasePath,
        warnings: release.warnings ?? [],
      })
      return { ok: true, summary, validation, manifestPath, releasePath }
    }
  }

  const browserReady = options.skipAuthenticated ? false : await runtime.ensureAutomationBrowser(warnings)
  const publicPath = runPublicInventory(reportDate, steps)
  let dealerPath = null
  let dealerMailRejection = null
  try {
    dealerPath = await runDealerMail(reportDate, browserReady, warnings, steps)
  } catch (error) {
    if (error.message !== DEALERMAIL_SNAPSHOT_REJECTED) throw error
    dealerMailRejection = error
  }
  if (!dealerPath) {
    const failureCode = dealerMailRejection ? DEALERMAIL_SNAPSHOT_REJECTED : 'DEALERMAIL_INCOMPLETE'
    const failureDetail = failureDetailFor(dealerMailRejection, failureCode)
    const status = dealerMailRejection ? 'not_published_dealermail_snapshot_rejected' : 'not_published_dealermail_incomplete'
    const incomplete = {
      report_date: reportDate,
      timezone: 'America/New_York',
      run_mode: 'inventory_flow_background_pipeline',
      public_inventory_status: existsSync(publicPath) ? 'complete' : 'incomplete',
      dealermail_status: dealerMailRejection ? 'snapshot_rejected' : 'skipped_no_authenticated_session',
      complete: false,
      public_snapshot_path: existsSync(publicPath) ? publicPath : null,
      ...(failureDetail ? { failure_code: failureCode, failure_detail: failureDetail } : {}),
      warnings,
      daily_steps: steps,
      completion_time: new Date().toISOString(),
    }
    writeJson(manifestPath, incomplete)
    const summary = summarize({ reportDate, validation: {}, publishStatus: status, manifestPath, releasePath, warnings })
    writeJson(summaryPath, { reportDate, status, summary, ...(failureDetail ? { failureCode, failureDetail } : {}) })
    return { ok: false, failureCode, ...(failureDetail ? { failureDetail } : {}), summary, manifestPath, releasePath }
  }

  const oasis = runOptionalAuthenticatedSources(reportDate, browserReady, warnings, steps)
  const oasisValidation = {
    oasis_capture_validated: oasis.validated,
    oasis_incomplete_vehicles: oasis.incompleteVehicles,
    oasis_missing_vehicles: oasis.missingVehicles,
  }
  let manifest = deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps })
  writeJson(manifestPath, manifest)
  const managerDispositionResult = runManagerDisposition(reportDate, warnings, steps)
  if (managerDispositionResult === 'failed_blocking') {
    manifest = deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps, managerDispositionValidated: false })
    manifest.complete = false
    manifest.validation_results = {
      ...manifest.validation_results,
      passed: false,
      manager_disposition_validated: false,
      ...oasisValidation,
    }
    writeJson(manifestPath, manifest)
    const status = 'not_published_manager_disposition_validation_failed'
    const summary = summarize({ reportDate, validation: {}, publishStatus: status, manifestPath, releasePath, warnings })
    writeJson(summaryPath, { reportDate, status, summary, warnings, steps, checkedAt: new Date().toISOString() })
    return { ok: false, failureCode: 'MANAGER_DISPOSITION_VALIDATION_FAILED', summary, manifestPath, releasePath }
  }
  const managerDispositionValidated = managerDispositionResult === true
  manifest = deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps, managerDispositionValidated })
  writeJson(manifestPath, manifest)

  const resourcesOk = runResourceBuild(reportDate, warnings, steps)
  manifest = { ...readJson(manifestPath), warnings: [...new Set([...warnings, AVAILABILITY_CAVEAT])], daily_steps: steps }
  if (!resourcesOk) {
    manifest.complete = false
    manifest.validation_results = { ...manifest.validation_results, passed: false, resource_enrichment_validated: false, ...oasisValidation }
    writeJson(manifestPath, manifest)
    const status = 'not_published_resource_validation_failed'
    const summary = summarize({ reportDate, validation: {}, publishStatus: status, manifestPath, releasePath, warnings })
    writeJson(summaryPath, { reportDate, status, summary, warnings, steps, checkedAt: new Date().toISOString() })
    return { ok: false, failureCode: 'RESOURCE_VALIDATION_FAILED', summary, manifestPath, releasePath }
  }
  manifest.validation_results = { ...manifest.validation_results, resource_enrichment_validated: true, passed: true, ...oasisValidation }
  writeJson(manifestPath, manifest)

  const built = buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath)
  const { validation } = built
  let publishStatus = 'publish_skipped_by_flag'
  let publishOk = true
  let failureCode = null
  let reconciliationRequired = false
  let candidate = null
  let publishedReceipt = null
  if (!options.noPublish) {
    const beforeReceipt = readReceiptStateAfterPublication(receiptPath)
    const publication = publish(reportDate, options.forcePublish, steps)
    const retainedMarker = retainedGlobalPublicationReconciliation()
    const durableAttempt = retainedMarker
      ? publicationAttemptForCandidate({
          reportDate,
          // The hash the publisher printed must be the marker's own hash.
          bundleSha256: publishedCandidateBundleSha256(publication.output, retainedMarker.candidate?.bundleSha256 ?? null),
          sourceHashes: built.sourceHashes,
          holdRefresh: false,
          // The publisher rebuilds resources (and so the bundle) before POST;
          // only the captured public and DealerMail sources are Node's to bind.
          sourceFields: ['public', 'dealerMail'],
        })
      : null
    publishOk = publication.ok
    if (publishOk) {
      publishStatus = 'published_or_already_verified'
    } else {
      const failure = classifyOrdinaryPublicationFailure({
        publisherOutput: publication.output,
        beforeRaw: beforeReceipt.raw,
        afterState: readReceiptStateAfterPublication(receiptPath),
        durableAttempt,
        reportDate,
        builtSourceHashes: built.sourceHashes,
      })
      publishStatus = failure.status
      failureCode = failure.failureCode
      reconciliationRequired = failure.reconciliationRequired
      candidate = failure.candidate
      if (reconciliationRequired) steps.at(-1).status = 'publication_outcome_unknown'
      else if (failure.receipt) steps.at(-1).status = 'published_followups_failed'
      publishedReceipt = failure.receipt
    }
    manifest = readJson(manifestPath)
    manifest.daily_steps = steps
    if (reconciliationRequired) {
      manifest.cloudflare_publish = {
        attempted: true,
        status: 'publication_outcome_unknown',
        reconciliation_required: true,
        expected_bundle_sha256: candidate.bundleSha256,
        receipt_path: receiptPath,
        publisher: 'BobMaxey-InventoryFlow-DailyPublish',
      }
    } else if (publishedReceipt) {
      manifest.cloudflare_publish = {
        attempted: true,
        status: 'published_and_verified_followups_pending',
        receipt_path: receiptPath,
        bundle_sha256: publishedReceipt.bundleSha256,
        verified_at: publishedReceipt.verifiedAt,
        publisher: 'BobMaxey-InventoryFlow-DailyPublish',
      }
    }
    writeJson(manifestPath, manifest)
  }
  const summary = summarize({ reportDate, validation, publishStatus, manifestPath, releasePath, warnings })
  writeJson(summaryPath, {
    reportDate,
    status: publishStatus,
    summary,
    counts: validation,
    warnings,
    steps,
    ...(reconciliationRequired ? { reconciliationRequired: true, candidate } : {}),
    checkedAt: new Date().toISOString(),
  })
  return {
    ok: publishOk,
    failureCode: publishOk ? null : failureCode,
    summary,
    validation,
    manifestPath,
    releasePath,
  }
}

function assertNoPendingCollectorAttempt() {
  const directory = path.join(WORK_ROOT, 'collector-attempts')
  try {
    let stat
    try { stat = lstatSync(directory) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('RECONCILIATION_REQUIRED')
    // Only proof-backed cleanup retires a state marker to .settled. A retained
    // marker (including an older state or interrupted durable replacement) is
    // uncertain regardless of its flags or contents. Leave its exact candidate
    // and the canonical baseline untouched for the collector's recovery path.
    if (readdirSync(directory).some(name => name.endsWith('.state.json') || (name.includes('.state.json.') && name.endsWith('.tmp')))) {
      throw new Error('RECONCILIATION_REQUIRED')
    }
  } catch { throw new Error('RECONCILIATION_REQUIRED') }
}

async function runDaily(options) {
  if (options.dryRun) return runDailyUnlocked(options)
  const reportDate = options.date ?? todayInNewYork()
  const lockDirectory = path.join(WORK_ROOT, 'app-feed-status')
  const lockPath = path.join(lockDirectory, '.publication.lock')
  const previousOwner = process.env[PUBLICATION_LOCK_OWNER_ENV]
  let lock = null
  try {
    mkdirSync(lockDirectory, { recursive: true })
    const inherited = assertInheritedPublicationLock(lockPath)
    lock = inherited ? null : acquirePublicationLock(lockPath)
    if (lock) process.env[PUBLICATION_LOCK_OWNER_ENV] = JSON.parse(lock.content).ownerId
    assertNoPendingCollectorAttempt()
    recoverCollectorCaptureBaseline()
    return await runDailyUnlocked(options)
  } catch (error) {
    if (error.message === PUBLICATION_LOCKED && options.refreshHolds) {
      const intradayStatusPath = path.join(WORK_ROOT, 'hold-refresh-status', `${reportDate}.json`)
      const summary = `Inventory Flow ${reportDate}: intraday hold refresh deferred while the protected publication pipeline is active.`
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status: 'waiting_for_pipeline_writer',
        summary,
      })
      return {
        ok: true,
        summary,
        validation: {},
        manifestPath: path.join(WORK_ROOT, 'run-status', `${reportDate}.json`),
        releasePath: path.join(WORK_ROOT, 'releases', reportDate, 'inventory-flow-release.json'),
      }
    }
    throw error
  } finally {
    if (previousOwner === undefined) delete process.env[PUBLICATION_LOCK_OWNER_ENV]
    else process.env[PUBLICATION_LOCK_OWNER_ENV] = previousOwner
    if (lock) releasePublicationLock(lock)
  }
}

function printHelp() {
  console.log(`Usage: run-inventory-flow-daily --date YYYY-MM-DD [--dry-run] [--no-publish] [--force-publish] [--skip-authenticated] [--refresh-holds]

Runs the app-first daily pipeline: source collection, validation, local release bundle, and Cloudflare publish.
--refresh-holds archives and refreshes DealerMail only after the morning release is verified, then republishes a validated revision through the protected publisher.
Excel workbook generation is intentionally outside this command.`)
}

export const internals = {
  INVOICE_CAPTURE_EXPIRED_PATTERN,
  lastJsonLine,
  oasisOutcome,
  oasisWarning,
  reuseExistingOasisCapture,
  runtime,
  runOptionalAuthenticatedSources,
  retryPublicationFollowups,
  invoiceCaptureComplete,
  runDealerMail,
  failureDetailFor,
  safeDetail,
  archiveDealerMailRevision,
  assertCandidatePreservesReceiptSources,
  assertReceiptHashes,
  buildAndWriteReleaseBundle,
  candidateManifestFromBaseline,
  captureFileTransaction,
  classifyFailedPublication,
  classifyOrdinaryPublicationFailure,
  classifyPublicationOutcome,
  dealerMailRevisionPaths,
  deriveManifest,
  exitCodeForResult,
  formatStores,
  parseArgs,
  publish,
  publicationAttemptForCandidate,
  publishedCandidateBundleSha256,
  readReceiptStateAfterPublication,
  retainedGlobalPublicationReconciliation,
  retainedPublicationReconciliation,
  reuseExistingOasisCapture,
  runDaily,
  runIntradayHoldRefresh,
  inspectCollectorBaseline,
  recoverCollectorCaptureBaseline,
  collectorCaptureBaselinePaths,
  stageIntradayHoldRefreshCandidate,
  promoteVerifiedCollectorCandidate,
  verifyHoldRefreshBaseline,
  verifyHoldRefreshStableSources,
  summarize,
  todayInNewYork,
  writeIntradayStatus,
  writeJson,
}

if (process.argv[1] && path.basename(process.argv[1]).toLowerCase() === 'run-inventory-flow-daily.mjs') {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
  } else {
    runDaily(options).then((result) => {
      console.log(result.summary)
      if (result.failureDetail) console.error(`${result.failureCode}: ${result.failureDetail}`)
      process.exitCode = exitCodeForResult(result)
    }).catch((error) => {
      const detail = error?.cause ? failureDetailFor(error.cause) : null
      console.error(`run-inventory-flow-daily failed: ${error.message}${detail ? ` (${detail})` : ''}`)
      process.exitCode = 1
    })
  }
}
