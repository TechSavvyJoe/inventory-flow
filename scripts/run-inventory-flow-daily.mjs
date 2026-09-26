import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadLatestCompletedRelease, validateVinDocumentEnrichment } from '../server/importer.mjs'
import { sanitizeManagerDispositionDocuments } from '../server/manager-disposition-schema.mjs'
import { cloudReleaseFrom } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'
import { assessOasisCapture } from './lib/oasis-parser.mjs'
import { acquirePublicationLock, assertInheritedPublicationLock, receiptSourceHashes, releasePublicationLock } from './sync-cloud-release.mjs'

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
  mkdirSync(path.dirname(filePath), { recursive: true })
  // The local API re-imports the manifest every few minutes and the cloud sync
  // reads it concurrently; a temp file plus rename never exposes a half-written
  // document to either reader.
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' })
  renameSync(temporary, filePath)
}

function writeBuffer(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, value)
  renameSync(temporary, filePath)
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

function classifyPublicationOutcome({ processOk, beforeRaw, afterState, expectedHashes, reportDate }) {
  const matchesCandidate = assertReceiptHashes(afterState.receipt, expectedHashes, reportDate)
  if (processOk && matchesCandidate) return 'published_and_followups_complete'
  if (!processOk && afterState.raw !== null && afterState.raw !== beforeRaw && matchesCandidate) {
    return 'published_followups_pending'
  }
  return 'not_published'
}

function verifyHoldRefreshBaseline({ reportDate, receipt, manifestPath, publicPath, resourcePath }) {
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

function runDealerMail(reportDate, browserReady, warnings, steps, { refresh = false } = {}) {
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
  const capture = run(NODE, ['scripts\\capture-dealermail.mjs', 'run', reportDate, '--budget-ms', '900000'], {
    cwd: APP_ROOT,
    optional: true,
    label: 'DealerMail capture',
  })
  if (!capture.ok || /session_expired/i.test(capture.output)) {
    warnings.push('sign in to DealerMail in the Work PC Automation Browser; DealerMail session was not usable and the cloud release was not published.')
    steps.push({ name: 'dealermail', status: 'session_expired_or_failed', detail: safeDetail(capture.output) })
    return null
  }
  run(NODE, ['work\\build_v2_snapshot.mjs', reportDate], { label: 'DealerMail snapshot builder' })
  run(NODE, ['work\\finalize_cloud_snapshot.mjs', reportDate], { label: 'DealerMail cloud snapshot finalizer' })
  if (!existsSync(target)) throw new Error('DealerMail finalized snapshot was not created')
  steps.push({ name: 'dealermail', status: 'captured', path: target })
  return target
}

// Without a browser (--skip-authenticated, or the automation browser is down)
// the run can still publish when this date's OASIS capture already exists and
// covers the worklist, exactly as capture-oasis.mjs itself judges completeness.
function reuseExistingOasisCapture(reportDate, steps) {
  const worklistPath = path.join(WORK_ROOT, `oasis-vin-worklist-${reportDate}.json`)
  const capturePath = path.join(WORK_ROOT, 'oasis-history', `${reportDate}-oasis.json`)
  if (!existsSync(worklistPath) || !existsSync(capturePath)) {
    steps.push({ name: 'oasis', status: 'skipped_browser_unavailable' })
    return false
  }
  try {
    const worklist = readJson(worklistPath)
    const records = readJson(capturePath).records
    if (!Array.isArray(worklist) || !Array.isArray(records)) throw new Error('unexpected OASIS capture shape')
    const quality = assessOasisCapture(worklist, records)
    steps.push({ name: 'oasis', status: quality.complete ? 'reused_existing_capture' : 'existing_capture_incomplete', detail: safeDetail(JSON.stringify(quality)) })
    return quality.complete === true
  } catch (error) {
    steps.push({ name: 'oasis', status: 'existing_capture_unreadable', detail: safeDetail(String(error?.message ?? error)) })
    return false
  }
}

function runOptionalAuthenticatedSources(reportDate, browserReady, warnings, steps) {
  if (!browserReady) {
    steps.push({ name: 'authenticated_optional_sources', status: 'skipped_browser_unavailable' })
    return reuseExistingOasisCapture(reportDate, steps)
  }
  let oasisComplete = true
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
      expired: /session_expired|FETCH_ERROR/i,
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
    const result = run(item.command, item.args, { cwd: item.cwd ?? WORKSPACE_ROOT, optional: true, label: item.name })
    if (!result.ok || item.expired?.test(result.output)) {
      if (item.name === 'oasis') {
        oasisComplete = false
        warnings.push(item.expired?.test(result.output)
          ? item.warning
          : 'Ford OASIS action-result capture is incomplete; review the source and retry before publishing.')
      } else if (item.warning) {
        warnings.push(item.warning)
      }
      steps.push({ name: item.name, status: item.name === 'oasis' ? 'failed_blocking' : result.ok ? 'completed_with_warning' : 'failed_non_blocking', detail: safeDetail(result.output) })
    } else {
      steps.push({ name: item.name, status: 'complete' })
    }
  }
  return oasisComplete
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
    warnings.push('Manager sold/delivered overlay did not validate; it was not used to change current inventory status.')
    steps.push({ name: 'manager_disposition', status: 'failed_non_blocking', detail: safeDetail(check.output) })
    return false
  } else {
    steps.push({ name: 'manager_disposition', status: 'complete' })
    return true
  }
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
  return String(value || '').replace(/\s+/g, ' ').slice(0, 500)
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
  const directory = path.join(WORK_ROOT, 'manager-supplied', 'sold-logs')
  const target = path.join(directory, `${month}-howell-operational.json`)
  if (!existsSync(target)) return null
  // manager-supplied is a hand-dropped file, not build output: a stale or
  // half-written overlay must not crash the daily manifest. Treat any parse
  // or validation failure the same as "no overlay for this month."
  let overlay
  try {
    overlay = readJson(target)
  } catch {
    return null
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
  return {
    status: 'complete',
    classification: 'operational-redacted',
    source_type: 'manager-log',
    path: target,
    sha256: sha256(target),
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

function buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath, { receipt = null } = {}) {
  const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT, now: validationClockFor(reportDate) })
  if (release.reportDate !== reportDate) {
    throw new Error(`Latest completed release is ${release.reportDate}, expected ${reportDate}`)
  }
  const sourceHashes = receipt ? assertCandidatePreservesReceiptSources(release, receipt) : receiptSourceHashes(release)
  const bundle = cloudReleaseFrom(release)
  const validation = validateReleaseBundle(bundle)
  writeJson(releasePath, bundle)
  const manifest = readJson(manifestPath)
  manifest.release_bundle_path = releasePath
  manifest.release_bundle_sha256 = sha256(releasePath)
  manifest.validation_results = {
    ...manifest.validation_results,
    app_release_validated: true,
    cloud_release_bundle_validated: true,
    validate_release_bundle_summary: validation,
    passed: true,
  }
  writeJson(manifestPath, manifest)
  return { validation, sourceHashes }
}

function publish(reportDate, forcePublish, steps, { holdRefresh = false, expectedSourceHashes = null } = {}) {
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
  const result = run(POWERSHELL, args, {
    optional: true,
    label: 'Cloudflare publisher',
    extraEnv: expectedSourceHashes
      ? { INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON: JSON.stringify(expectedSourceHashes) }
      : {},
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
  validation = {},
  warnings = [],
  steps = [],
  published = false,
  receipt = null,
}) {
  if (receipt && !verifiedReceiptIdentityIsValid(receipt, reportDate)) {
    throw new Error('VERIFIED_RECEIPT_LINK_INVALID')
  }
  if (receipt && !normalizedHash(receipt.sourceHashes?.dealerMail)) {
    throw new Error('VERIFIED_RECEIPT_LINK_INVALID')
  }
  writeJson(filePath, {
    reportDate,
    status,
    checkedAt: new Date().toISOString(),
    summary,
    ...(failureCode ? { failureCode } : {}),
    ...(published ? { published: true } : {}),
    ...(receipt ? {
      receipt: {
        bundleSha256: receipt.bundleSha256,
        verifiedAt: receipt.verifiedAt,
        dealerMailSha256: receipt.sourceHashes?.dealerMail,
      },
    } : {}),
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

async function runIntradayHoldRefresh({ options, reportDate, manifestPath, releasePath, receiptPath, intradayStatusPath, warnings, steps }) {
  const beforeReceipt = readReceiptState(receiptPath)
  if (beforeReceipt.receipt?.status !== 'published_and_verified' || beforeReceipt.receipt?.reportDate !== reportDate || beforeReceipt.receipt?.complete !== true) {
    const summary = `Inventory Flow ${reportDate}: intraday hold refresh waiting for the morning verified release.`
    writeIntradayStatus(intradayStatusPath, { reportDate, status: 'waiting_for_verified_morning_release', summary })
    return { ok: true, summary, validation: {}, manifestPath, releasePath }
  }

  const publicPath = publicSnapshotPath(reportDate)
  const resourcePath = path.join(APP_ROOT, 'data', 'vin-document-enrichment.json')
  let baseline
  try {
    baseline = verifyHoldRefreshBaseline({
      reportDate,
      receipt: beforeReceipt.receipt,
      manifestPath,
      publicPath,
      resourcePath,
    })
  } catch (error) {
    const failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RECEIPT_BOUND_SOURCE_VALIDATION_FAILED'
    const summary = `Inventory Flow ${reportDate}: intraday hold refresh stopped because the last verified source bindings could not be proved.`
    writeIntradayStatus(intradayStatusPath, {
      reportDate,
      status: 'failed_receipt_bound_source_validation',
      failureCode,
      summary,
      steps,
    })
    return { ok: false, failureCode, summary, manifestPath, releasePath }
  }

  const transaction = captureFileTransaction([
    manifestPath,
    releasePath,
    ...dealerMailRevisionPaths(reportDate),
  ])
  let keepCandidate = false
  let publishedFailureCode = null
  let publishedReceipt = null
  let result
  try {
    steps.push({ name: 'public_inventory', status: 'reused_receipt_bound', path: publicPath })
    steps.push({ name: 'manager_disposition', status: baseline.managerBinding ? 'reused_receipt_bound' : 'reused_none_receipt_bound' })

    const browserReady = options.skipAuthenticated ? false : await ensureAutomationBrowser(warnings)
    const dealerPath = runDealerMail(reportDate, browserReady, warnings, steps, { refresh: true })
    if (!dealerPath) {
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
    verifyHoldRefreshBaseline({
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
      dealerPath,
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
    const afterReceipt = readReceiptState(receiptPath)
    const publicationOutcome = classifyPublicationOutcome({
      processOk: publication.ok,
      beforeRaw: beforeReceipt.raw,
      afterState: afterReceipt,
      expectedHashes: built.sourceHashes,
      reportDate,
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

    throw new Error('CLOUDFLARE_PUBLISH_FAILED')
  } catch (error) {
    if (keepCandidate) {
      const failureCode = publishedFailureCode ?? 'POST_PUBLISH_STATE_RECORD_FAILED'
      const summary = `Inventory Flow ${reportDate}: the intraday hold release is published and verified, but post-publication state recording is incomplete.`
      writeIntradayStatus(intradayStatusPath, {
        reportDate,
        status: 'intraday_holds_published_followups_pending',
        failureCode,
        summary,
        warnings,
        steps,
        published: true,
        receipt: publishedReceipt,
      })
      result = { ok: false, failureCode, summary, manifestPath, releasePath }
      return result
    }
    const failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'INTRADAY_REFRESH_VALIDATION_FAILED'
    const status = failureCode === 'CLOUDFLARE_PUBLISH_FAILED'
      ? 'publish_failed_last_verified_release_preserved'
      : 'intraday_refresh_failed_last_verified_release_preserved'
    const summary = `Inventory Flow ${reportDate}: intraday hold refresh failed before a new verified publication; the last verified release was restored.`
    writeIntradayStatus(intradayStatusPath, { reportDate, status, failureCode, summary, warnings, steps })
    result = { ok: false, failureCode, summary, manifestPath, releasePath }
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
          summary,
          warnings,
          steps,
        })
        throw new Error('INTRADAY_ROLLBACK_FAILED', { cause: error })
      }
    }
  }
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

  const browserReady = options.skipAuthenticated ? false : await ensureAutomationBrowser(warnings)
  const publicPath = runPublicInventory(reportDate, steps)
  const dealerPath = runDealerMail(reportDate, browserReady, warnings, steps)
  if (!dealerPath) {
    const incomplete = {
      report_date: reportDate,
      timezone: 'America/New_York',
      run_mode: 'inventory_flow_background_pipeline',
      public_inventory_status: existsSync(publicPath) ? 'complete' : 'incomplete',
      dealermail_status: 'skipped_no_authenticated_session',
      complete: false,
      public_snapshot_path: existsSync(publicPath) ? publicPath : null,
      warnings,
      daily_steps: steps,
      completion_time: new Date().toISOString(),
    }
    writeJson(manifestPath, incomplete)
    const summary = summarize({ reportDate, validation: {}, publishStatus: 'not_published_dealermail_incomplete', manifestPath, releasePath, warnings })
    writeJson(summaryPath, { reportDate, status: 'not_published_dealermail_incomplete', summary })
    return { ok: false, failureCode: 'DEALERMAIL_INCOMPLETE', summary, manifestPath, releasePath }
  }

  const oasisComplete = runOptionalAuthenticatedSources(reportDate, browserReady, warnings, steps)
  let manifest = deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps })
  writeJson(manifestPath, manifest)
  const managerDispositionValidated = runManagerDisposition(reportDate, warnings, steps)
  manifest = deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps, managerDispositionValidated })
  writeJson(manifestPath, manifest)

  const resourcesOk = runResourceBuild(reportDate, warnings, steps)
  manifest = { ...readJson(manifestPath), warnings: [...new Set([...warnings, AVAILABILITY_CAVEAT])], daily_steps: steps }
  if (!resourcesOk || !oasisComplete) {
    manifest.complete = false
    manifest.validation_results = { ...manifest.validation_results, passed: false, resource_enrichment_validated: resourcesOk, oasis_capture_validated: oasisComplete }
    writeJson(manifestPath, manifest)
    const status = !oasisComplete ? 'not_published_oasis_incomplete' : 'not_published_resource_validation_failed'
    const summary = summarize({ reportDate, validation: {}, publishStatus: status, manifestPath, releasePath, warnings })
    writeJson(summaryPath, { reportDate, status, summary, warnings, steps, checkedAt: new Date().toISOString() })
    return { ok: false, failureCode: !oasisComplete ? 'OASIS_INCOMPLETE' : 'RESOURCE_VALIDATION_FAILED', summary, manifestPath, releasePath }
  }
  manifest.validation_results = { ...manifest.validation_results, resource_enrichment_validated: true, passed: true }
  writeJson(manifestPath, manifest)

  const { validation } = buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath)
  let publishStatus = 'publish_skipped_by_flag'
  let publishOk = true
  if (!options.noPublish) {
    publishOk = publish(reportDate, options.forcePublish, steps).ok
    publishStatus = publishOk ? 'published_or_already_verified' : 'publish_failed_last_verified_release_preserved'
    manifest = readJson(manifestPath)
    manifest.daily_steps = steps
    writeJson(manifestPath, manifest)
  }
  const summary = summarize({ reportDate, validation, publishStatus, manifestPath, releasePath, warnings })
  writeJson(summaryPath, { reportDate, status: publishStatus, summary, counts: validation, warnings, steps, checkedAt: new Date().toISOString() })
  return {
    ok: publishOk,
    failureCode: publishOk ? null : 'CLOUDFLARE_PUBLISH_FAILED',
    summary,
    validation,
    manifestPath,
    releasePath,
  }
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
  archiveDealerMailRevision,
  assertCandidatePreservesReceiptSources,
  assertReceiptHashes,
  candidateManifestFromBaseline,
  captureFileTransaction,
  classifyPublicationOutcome,
  deriveManifest,
  exitCodeForResult,
  formatStores,
  parseArgs,
  publish,
  reuseExistingOasisCapture,
  runDaily,
  verifyHoldRefreshBaseline,
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
      process.exitCode = exitCodeForResult(result)
    }).catch((error) => {
      console.error(`run-inventory-flow-daily failed: ${error.message}`)
      process.exitCode = 1
    })
  }
}
