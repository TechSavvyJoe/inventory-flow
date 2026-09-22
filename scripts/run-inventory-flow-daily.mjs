import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadLatestCompletedRelease, validateVinDocumentEnrichment } from '../server/importer.mjs'
import { sanitizeManagerDispositionDocuments } from '../server/manager-disposition-schema.mjs'
import { cloudReleaseFrom } from './publish-cloud-release.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta.url)
const APP_ROOT = path.join(WORKSPACE_ROOT, 'apps', 'inventory-ops')
const WORK_ROOT = path.join(WORKSPACE_ROOT, 'work')
const RUNTIME_ROOT = path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies')
const NODE = existsSync(path.join(RUNTIME_ROOT, 'node', 'bin', 'node.exe')) ? path.join(RUNTIME_ROOT, 'node', 'bin', 'node.exe') : process.execPath
const PYTHON = existsSync(path.join(RUNTIME_ROOT, 'python', 'python.exe')) ? path.join(RUNTIME_ROOT, 'python', 'python.exe') : 'python'
const POWERSHELL = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell'
const AVAILABILITY_CAVEAT = 'Public listings, source flags, expected dates, holds, CDK responses, manager sold logs, and resource records do not independently establish availability, a sale, delivery, funding, paperwork completion, or physical location. Confirm with the appropriate store before customer commitment.'

function parseArgs(argv) {
  const options = {
    date: null,
    dryRun: false,
    noPublish: false,
    forcePublish: false,
    skipAuthenticated: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--date') options.date = argv[++index]
    else if (arg === '--workspace-root') index += 1
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-publish') options.noPublish = true
    else if (arg === '--force-publish') options.forcePublish = true
    else if (arg === '--skip-authenticated') options.skipAuthenticated = true
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
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' })
}

function run(command, args, { cwd = WORKSPACE_ROOT, optional = false, label = command } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      BOB_MAXEY_WORKSPACE_ROOT: WORKSPACE_ROOT,
      INVENTORY_WORKSPACE_ROOT: WORKSPACE_ROOT,
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

function runDealerMail(reportDate, browserReady, warnings, steps) {
  const target = dealerCloudSnapshotPath(reportDate)
  if (existsSync(target)) {
    steps.push({ name: 'dealermail', status: 'reused', path: target })
    return target
  }
  if (!browserReady) {
    warnings.push('sign in to DealerMail in the Work PC Automation Browser; DealerMail was not captured and the cloud release was not published.')
    steps.push({ name: 'dealermail', status: 'skipped_browser_unavailable' })
    return null
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

function runOptionalAuthenticatedSources(reportDate, browserReady, warnings, steps) {
  if (!browserReady) {
    steps.push({ name: 'authenticated_optional_sources', status: 'skipped_browser_unavailable' })
    return
  }
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
      args: ['scripts\\capture-service-history.mjs', 'run', reportDate, '--budget-ms', '1800000'],
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
      warning: 'sign in to FMCDealer in the Work PC Automation Browser; Ford invoice data is incomplete for this run.',
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
      if (item.warning) warnings.push(item.warning)
      steps.push({ name: item.name, status: result.ok ? 'completed_with_warning' : 'failed_non_blocking', detail: safeDetail(result.output) })
    } else {
      steps.push({ name: item.name, status: 'complete' })
    }
  }
}

function runManagerDisposition(reportDate, warnings, steps) {
  const month = reportDate.slice(0, 7)
  const csv = path.join(WORK_ROOT, 'sold-delivered', `${month}.csv`)
  if (!existsSync(csv)) {
    steps.push({ name: 'manager_disposition', status: 'skipped_no_csv' })
    return
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
  } else {
    steps.push({ name: 'manager_disposition', status: 'complete' })
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

function deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps }) {
  const publicSnapshot = readJson(publicPath)
  const dealerSnapshot = readJson(dealerPath)
  const publicRows = rowsFromPublic(publicSnapshot)
  const crmRows = dealerSnapshot.completeDealerMailUsedInventory?.rows ?? []
  const excludeRows = dealerSnapshot.excludeActiveHoldsValidationSet?.rows ?? []
  const publicInfo = fileInfo(publicPath)
  const dealerInfo = fileInfo(dealerPath)
  const managerBinding = managerBindingFor(reportDate, publicRows)
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
    run_mode: 'inventory_flow_background_pipeline',
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
  const overlay = readJson(target)
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

function buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath) {
  const release = loadLatestCompletedRelease({ workspaceRoot: WORKSPACE_ROOT, now: validationClockFor(reportDate) })
  if (release.reportDate !== reportDate) {
    throw new Error(`Latest completed release is ${release.reportDate}, expected ${reportDate}`)
  }
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
  return validation
}

function publish(reportDate, forcePublish, steps) {
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
  const result = run(POWERSHELL, args, { optional: true, label: 'Cloudflare publisher' })
  steps.push({ name: 'cloudflare_publish', status: result.ok ? 'complete' : 'failed', detail: safeDetail(result.output) })
  return result.ok
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

async function runDaily(options) {
  const reportDate = options.date ?? todayInNewYork()
  const manifestPath = path.join(WORK_ROOT, 'run-status', `${reportDate}.json`)
  const releaseDirectory = path.join(WORK_ROOT, 'releases', reportDate)
  const releasePath = path.join(releaseDirectory, 'inventory-flow-release.json')
  const receiptPath = path.join(WORK_ROOT, 'app-feed-status', `${reportDate}.json`)
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
    writeJson(path.join(releaseDirectory, 'daily-summary.json'), { reportDate, status: 'not_published_dealermail_incomplete', summary })
    return { ok: false, failureCode: 'DEALERMAIL_INCOMPLETE', summary, manifestPath, releasePath }
  }

  runOptionalAuthenticatedSources(reportDate, browserReady, warnings, steps)
  runManagerDisposition(reportDate, warnings, steps)
  let manifest = deriveManifest({ reportDate, publicPath, dealerPath, warnings, steps })
  writeJson(manifestPath, manifest)

  const resourcesOk = runResourceBuild(reportDate, warnings, steps)
  manifest = { ...readJson(manifestPath), warnings: [...new Set([...warnings, AVAILABILITY_CAVEAT])], daily_steps: steps }
  if (!resourcesOk) {
    manifest.complete = false
    manifest.validation_results = { ...manifest.validation_results, passed: false, resource_enrichment_validated: false }
    writeJson(manifestPath, manifest)
    const summary = summarize({ reportDate, validation: {}, publishStatus: 'not_published_resource_validation_failed', manifestPath, releasePath, warnings })
    writeJson(path.join(releaseDirectory, 'daily-summary.json'), { reportDate, status: 'not_published_resource_validation_failed', summary })
    return { ok: false, failureCode: 'RESOURCE_VALIDATION_FAILED', summary, manifestPath, releasePath }
  }
  manifest.validation_results = { ...manifest.validation_results, resource_enrichment_validated: true, passed: true }
  writeJson(manifestPath, manifest)

  const validation = buildAndWriteReleaseBundle(reportDate, releasePath, manifestPath)
  let publishStatus = 'publish_skipped_by_flag'
  let publishOk = true
  if (!options.noPublish) {
    publishOk = publish(reportDate, options.forcePublish, steps)
    publishStatus = publishOk ? 'published_or_already_verified' : 'publish_failed_last_verified_release_preserved'
    manifest = readJson(manifestPath)
    manifest.daily_steps = steps
    writeJson(manifestPath, manifest)
  }
  const summary = summarize({ reportDate, validation, publishStatus, manifestPath, releasePath, warnings })
  writeJson(path.join(releaseDirectory, 'daily-summary.json'), { reportDate, status: publishStatus, summary, counts: validation, warnings })
  return {
    ok: publishOk,
    failureCode: publishOk ? null : 'CLOUDFLARE_PUBLISH_FAILED',
    summary,
    validation,
    manifestPath,
    releasePath,
  }
}

function printHelp() {
  console.log(`Usage: run-inventory-flow-daily --date YYYY-MM-DD [--dry-run] [--no-publish] [--force-publish] [--skip-authenticated]

Runs the app-first daily pipeline: source collection, validation, local release bundle, and Cloudflare publish.
Excel workbook generation is intentionally outside this command.`)
}

export const internals = {
  deriveManifest,
  exitCodeForResult,
  formatStores,
  summarize,
  todayInNewYork,
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
