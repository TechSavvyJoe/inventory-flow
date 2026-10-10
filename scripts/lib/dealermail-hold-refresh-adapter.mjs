import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { base64Key, cloudBundleSha256, encryptBundle } from '../publish-cloud-release.mjs'
import { collectCollectorDependencyGraph } from './collector-profile.mjs'

const CAPTURE_DEPS = Object.freeze([
  { id: 'dealermailCapture', relativePath: path.join('apps', 'inventory-ops', 'scripts', 'capture-dealermail.mjs') },
  { id: 'snapshotBuilder', relativePath: path.join('work', 'build_v2_snapshot.mjs') },
  { id: 'snapshotFinalizer', relativePath: path.join('work', 'finalize_cloud_snapshot.mjs') },
])
const OUTPUT_LIMIT = 256 * 1024
const DEALERMAIL_CAPTURE_BUDGET_MS = 15 * 60_000
// Allow the capture process one minute after its own budget to emit its
// controlled incomplete result and close cleanly before the host terminates it.
const DEALERMAIL_CAPTURE_TIMEOUT_MS = DEALERMAIL_CAPTURE_BUDGET_MS + 60_000
const CHILD_ENV_NAMES = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'TEMP', 'TMP']
const FORBIDDEN_HOSTS = /(?:https?:\/\/|wss?:\/\/)[^\s'"`<>]*\b(?:[a-z0-9-]+\.)*(?:fmcdealer|dealerconnection|fordvisions|fordtechservice|oasis|autocheck|vauto|pts)\.(?:com|net)\b/i
const FORBIDDEN_CAPTURE_REFERENCE = /(?:capture[-_](?:oasis|service[-_]history|invoice|warranty|vauto|autocheck|pts|keeper)|ensureAutomationBrowser|start[-_]automation[-_]browser)/i
const FORD_MERGE_REFERENCE = /\b(?:merge\s+ford|ford\s+merge|mergeFord|mergeFord[A-Z]|mergeOasis|mergeInvoice|mergeServiceHistory)\b/i
const REVIEWED_CDP_ALLOWED_URL = 'https://www.fordtechservice.dealerconnection.com/VehicleService/Details'
// Reviewed original and best-effort cleanup helper revisions, each LF/CRLF.
const REVIEWED_CDP_SHA256 = new Set([
  '54d171972ef3200b0abc77e77c5404b23109d1188d67e8e5b089bd360ce56c90',
  'e542c222ef3ebeb8bbe358f15ae2fe00424fddc92efe6139d1e40add58ee9005',
  'fd013e76571cbaa2197d1c071d11ba308b7f8d772b3227e9e16c6b627ba5188d',
  '6e9d5a8f2e9c93124fb8e1e7bab6a07e4d933daf99808bb8c6d127406acd031d',
])

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const hashFile = filePath => sha256(readFileSync(filePath))

function writeDurableFile(filePath, contents, flags = 'wx') {
  const descriptor = openSync(filePath, flags, 0o600)
  try { writeFileSync(descriptor, contents); fsyncSync(descriptor) }
  finally { closeSync(descriptor) }
}

function syncDirectory(directory, { required = false } = {}) {
  if (process.platform === 'win32') return
  let descriptor
  try { descriptor = openSync(directory, 'r'); fsyncSync(descriptor) }
  catch (error) {
    if (required) throw error
    // Some filesystems do not expose directory fsync.
  }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function checkCollectorDependencies(profile) {
  if (!profile?.workspaceRoot || !profile?.dependencyHashes) throw new Error('ADAPTER_DEPENDENCY_MISSING')
  const resolved = CAPTURE_DEPS.map(dependency => ({
    id: dependency.id,
    filePath: path.join(profile.workspaceRoot, dependency.relativePath),
  }))
  for (const item of resolved) {
    if (!within(profile.workspaceRoot, item.filePath) || !existsSync(item.filePath)) throw new Error('ADAPTER_DEPENDENCY_MISSING')
    const stat = lstatSync(item.filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ADAPTER_DEPENDENCY_MISSING')
    const expected = profile.dependencyHashes[item.id]
    if (!/^[a-f0-9]{64}$/.test(expected ?? '') || hashFile(item.filePath) !== expected) throw new Error('ADAPTER_DEPENDENCY_MISSING')
  }
  for (const dependency of collectCollectorDependencyGraph(profile.workspaceRoot)) {
    const source = readFileSync(path.join(profile.workspaceRoot, dependency.path), 'utf8')
    const reviewedCdp = dependency.path === 'apps/inventory-ops/scripts/lib/cdp.mjs'
      && REVIEWED_CDP_SHA256.has(dependency.sha256)
    const checkedSource = reviewedCdp ? source.replaceAll(REVIEWED_CDP_ALLOWED_URL, '') : source
    if (FORBIDDEN_HOSTS.test(checkedSource) || FORBIDDEN_CAPTURE_REFERENCE.test(source) || FORD_MERGE_REFERENCE.test(source)) {
      throw new Error('ADAPTER_DEPENDENCY_MISSING')
    }
  }
  return resolved
}

export async function hasExistingDealerMailTab({ fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  let response
  try { response = await fetchImpl('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(timeoutMs) }) }
  catch { return false }
  if (!response.ok) return false
  const tabs = await response.json().catch(() => null)
  return Array.isArray(tabs) && tabs.some(tab => {
    try { return new URL(tab.url).origin === 'https://www.dealermail.com' } catch { return false }
  })
}

function childEnvironment(profile) {
  const env = {}
  for (const name of CHILD_ENV_NAMES) if (process.env[name]) env[name] = process.env[name]
  const nodeDirectory = path.dirname(path.resolve(process.execPath))
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
  const systemPaths = systemRoot ? [path.join(systemRoot, 'System32'), systemRoot] : []
  env.PATH = [nodeDirectory, ...systemPaths].join(path.delimiter)
  env.BOB_MAXEY_WORKSPACE_ROOT = profile.workspaceRoot
  env.INVENTORY_WORKSPACE_ROOT = profile.workspaceRoot
  return env
}

function runOwnedChild(executable, args, { cwd, signal, timeoutMs, onChild, childGuard, profile, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('LEASE_STOPPED'))
    const launch = childGuard?.prepare()
    const childArgs = launch ? [fileURLToPath(new URL('./collector-child-bootstrap.mjs', import.meta.url)), launch.journalPath, launch.nonce, launch.ownerId, ...args] : args
    let child
    try { child = spawnImpl(executable, childArgs, {
      cwd, env: childEnvironment(profile), shell: false, windowsHide: true,
      stdio: launch ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    }) } catch (error) {
      // Preserve the launch record when no close event establishes completion.
      // Recovery can retire this unadmitted launch after its host has exited.
      return reject(error)
    }
    let output = ''
    let requestedError = null
    let timer = null
    let escalationTimer = null
    let settled = false
    const clearTimers = () => {
      if (timer) clearTimeout(timer)
      if (escalationTimer) clearTimeout(escalationTimer)
      timer = null
      escalationTimer = null
    }
    const terminate = error => {
      if (requestedError) return
      requestedError = error
      if (timer) clearTimeout(timer)
      timer = null
      try { child.kill('SIGTERM') } catch { /* Escalation below still waits for close. */ }
      escalationTimer = setTimeout(() => {
        if (settled) return
        try { child.kill('SIGKILL') } catch { /* The close event remains the completion boundary. */ }
      }, 1000)
      escalationTimer.unref?.()
    }
    const append = chunk => {
      if (requestedError) return
      output += chunk.toString('utf8')
      if (output.length > OUTPUT_LIMIT) terminate(new Error('CAPTURE_OUTPUT_LIMIT'))
    }
    const aborted = () => terminate(new Error('LEASE_STOPPED'))
    const finishOnClose = code => {
      if (settled) return
      settled = true
      clearTimers()
      signal?.removeEventListener('abort', aborted)
      try { childGuard?.closed() } catch { return reject(new Error('RECONCILIATION_REQUIRED')) }
      if (requestedError) reject(requestedError)
      else if (code === 0) resolve(output)
      else reject(new Error('CAPTURE_PROCESS_FAILED'))
    }
    try {
      if (launch) {
        childGuard.register(child.pid)
        child.send({ type: 'collector_start', nonce: launch.nonce }, error => { if (error) terminate(new Error('CAPTURE_PROCESS_FAILED')) })
      }
      onChild?.(child)
    } catch { terminate(new Error('CAPTURE_PROCESS_FAILED')) }
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    if (!requestedError) timer = setTimeout(() => terminate(new Error('CAPTURE_TIMEOUT')), timeoutMs)
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', () => terminate(new Error('CAPTURE_PROCESS_FAILED')))
    child.on('close', finishOnClose)
  })
}

export function makeDealerMailCapture(profile, { onChild, signal, spawnImpl = spawn, fetchImpl = fetch } = {}) {
  const dependencies = checkCollectorDependencies(profile)
  const capture = dependencies.find(item => item.id === 'dealermailCapture').filePath
  const builder = dependencies.find(item => item.id === 'snapshotBuilder').filePath
  const finalizer = dependencies.find(item => item.id === 'snapshotFinalizer').filePath
  const appRoot = path.join(profile.workspaceRoot, 'apps', 'inventory-ops')
  for (const filePath of [capture, builder, finalizer]) {
    const content = readFileSync(filePath, 'utf8')
    if (FORBIDDEN_HOSTS.test(path.basename(filePath)) || FORBIDDEN_CAPTURE_REFERENCE.test(content) || FORD_MERGE_REFERENCE.test(content)) {
      throw new Error('ADAPTER_DEPENDENCY_MISSING')
    }
  }
  // Reject accidental drift in the fixed child call graph before any source I/O.
  const captureText = readFileSync(capture, 'utf8')
  if (!captureText.includes("const ORIGIN = 'https://www.dealermail.com'") || FORBIDDEN_CAPTURE_REFERENCE.test(captureText) || FORD_MERGE_REFERENCE.test(captureText)) {
    throw new Error('ADAPTER_DEPENDENCY_MISSING')
  }
  return async ({ reportDate, childGuard }) => {
    if (!await hasExistingDealerMailTab({ fetchImpl })) throw new Error('DEALERMAIL_SESSION_REQUIRED')
    await runChild(process.execPath, [capture, 'run', reportDate, '--budget-ms', String(DEALERMAIL_CAPTURE_BUDGET_MS)], { cwd: appRoot, signal, timeoutMs: DEALERMAIL_CAPTURE_TIMEOUT_MS, onChild, childGuard, spawnImpl, profile })
    await runChild(process.execPath, [builder, reportDate], { cwd: path.join(profile.workspaceRoot, 'work'), signal, timeoutMs: 8 * 60_000, onChild, childGuard, spawnImpl, profile })
    await runChild(process.execPath, [finalizer, reportDate], { cwd: profile.workspaceRoot, signal, timeoutMs: 8 * 60_000, onChild, childGuard, spawnImpl, profile })
  }
}

function runChild(executable, args, options) {
  return runOwnedChild(executable, args, options)
}

export function privateAttemptArtifacts(workspaceRoot, attemptId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attemptId)) throw new Error('COLLECTOR_ATTEMPT_INVALID')
  const directory = path.join(workspaceRoot, 'work', 'collector-attempts')
  const base = path.join(directory, attemptId)
  return {
    directory,
    candidatePath: `${base}.release.json`,
    manifestPath: `${base}.manifest.json`,
    dealerMailPath: `${base}.dealermail.json`,
    promotionBackupPath: `${base}.promotion-backup.json`,
    envelopePath: `${base}.envelope.json`,
    statePath: `${base}.state.json`,
  }
}

export function persistExactEnvelope(filePath, envelope) {
  if (existsSync(filePath)) {
    const stat = lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024) throw new Error('CANDIDATE_ENVELOPE_MISMATCH')
    const existing = JSON.parse(readFileSync(filePath, 'utf8'))
    if (existing.bundleSha256 !== envelope.bundleSha256 || existing.reportDate !== envelope.reportDate || cloudBundleSha256FromEnvelope(existing) !== cloudBundleSha256FromEnvelope(envelope)) {
      throw new Error('CANDIDATE_ENVELOPE_MISMATCH')
    }
    return existing
  }
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const serialized = JSON.stringify(envelope)
  if (Buffer.byteLength(serialized, 'utf8') > 25 * 1024 * 1024) throw new Error('CANDIDATE_ENVELOPE_MISMATCH')
  writeDurableFile(filePath, serialized)
  syncDirectory(path.dirname(filePath))
  return envelope
}

function cloudBundleSha256FromEnvelope(envelope) { return envelope.bundleSha256 }

export function makeCandidateEnvelope(candidatePath, encryptionKey) {
  const bundle = JSON.parse(readFileSync(candidatePath, 'utf8'))
  const envelope = encryptBundle(bundle, base64Key(encryptionKey))
  if (cloudBundleSha256(bundle) !== envelope.bundleSha256) throw new Error('CANDIDATE_HASH_MISMATCH')
  return envelope
}

export function saveAttemptState(filePath, state) {
  const safe = {
    attemptId: state.attemptId,
    fence: state.fence,
    reportDate: state.reportDate,
    profileSha256: state.profileSha256,
    configSha256: state.configSha256,
    baselineBundleSha256: state.baselineBundleSha256,
    capturedAt: state.capturedAt,
    sourceSha256: state.sourceSha256,
    bundleSha256: state.bundleSha256,
    dealerMailRows: state.dealerMailRows,
    captureReceiptSent: state.captureReceiptSent === true,
    captureReceiptPending: state.captureReceiptPending === true,
    publicationPending: state.publicationPending === true,
    reconciliationRequired: state.reconciliationRequired === true,
    preflightRetryable: state.preflightRetryable === true,
    revisionRetryable: state.revisionRetryable === true,
    publicationIdempotencyKey: state.publicationIdempotencyKey,
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`
  writeDurableFile(temporary, JSON.stringify(safe))
  renameSync(temporary, filePath)
  syncDirectory(path.dirname(filePath))
  return safe
}

export function findPendingPublication(workspaceRoot) {
  const directory = path.join(workspaceRoot, 'work', 'collector-attempts')
  if (!existsSync(directory)) return null
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('RECONCILIATION_REQUIRED')
  const pending = []
  for (const name of readdirSync(directory)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\.state\.json$/.test(name)) continue
    const attemptId = name.slice(0, -'.state.json'.length)
    const artifacts = privateAttemptArtifacts(workspaceRoot, attemptId)
    const stateStat = lstatSync(artifacts.statePath)
    if (!stateStat.isFile() || stateStat.isSymbolicLink() || stateStat.size > 64 * 1024) throw new Error('RECONCILIATION_REQUIRED')
    const state = JSON.parse(readFileSync(artifacts.statePath, 'utf8'))
    // The first durable writer state precedes captureReceiptPending. It still
    // owns a complete candidate and must recover, even with every flag false.
    // Missing/nonboolean flags cannot prove that same undispatched boundary.
    const progress = ['captureReceiptSent', 'captureReceiptPending', 'publicationPending', 'reconciliationRequired']
    if (progress.every(key => state?.[key] !== true) && !progress.every(key => state?.[key] === false)) throw new Error('RECONCILIATION_REQUIRED')
    for (const filePath of [artifacts.candidatePath, artifacts.manifestPath, artifacts.dealerMailPath, artifacts.envelopePath]) {
      const stat = lstatSync(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024) throw new Error('RECONCILIATION_REQUIRED')
    }
    const candidate = JSON.parse(readFileSync(artifacts.candidatePath, 'utf8'))
    const envelope = JSON.parse(readFileSync(artifacts.envelopePath, 'utf8'))
    pending.push({ artifacts, state, candidate, envelope })
  }
  if (pending.length > 1) throw new Error('RECONCILIATION_REQUIRED')
  return pending[0] ?? null
}

export function getOrCreateClaimIdempotencyKey(workspaceRoot, profileSha256) {
  const directory = path.join(workspaceRoot, 'work', 'collector-attempts')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('RECONCILIATION_REQUIRED')
  const filePath = path.join(directory, 'pending-claim.json')
  if (existsSync(filePath)) {
    const stat = lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('RECONCILIATION_REQUIRED')
    let record
    try { record = JSON.parse(readFileSync(filePath, 'utf8')) } catch { throw new Error('RECONCILIATION_REQUIRED') }
    if (record.profileSha256 !== profileSha256 || !/^[0-9a-f-]{36}$/.test(record.idempotencyKey ?? '')) throw new Error('RECONCILIATION_REQUIRED')
    return record.idempotencyKey
  }
  const record = { profileSha256, idempotencyKey: randomUUID() }
  writeDurableFile(filePath, JSON.stringify(record))
  syncDirectory(directory)
  return record.idempotencyKey
}

export function clearPendingClaimIdempotencyKey(workspaceRoot, profileSha256, expectedKey) {
  const filePath = path.join(workspaceRoot, 'work', 'collector-attempts', 'pending-claim.json')
  if (!existsSync(filePath)) return
  const stat = lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('RECONCILIATION_REQUIRED')
  const record = JSON.parse(readFileSync(filePath, 'utf8'))
  if (record.profileSha256 !== profileSha256 || record.idempotencyKey !== expectedKey) throw new Error('RECONCILIATION_REQUIRED')
  unlinkSync(filePath)
  syncDirectory(path.dirname(filePath))
}

export function cleanupVerifiedAttempt(artifacts) {
  // Only a settled attempt reaches cleanup. Retire its pending marker before
  // deleting evidence, so an interrupted cleanup leaves harmless orphan files.
  const tombstonePath = `${artifacts.statePath}.settled`
  let retired = false
  try { renameSync(artifacts.statePath, tombstonePath); retired = true }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('RECONCILIATION_REQUIRED') }
  if (retired) {
    try { syncDirectory(artifacts.directory, { required: true }) }
    catch {
      // No evidence has been deleted yet. Preserve the complete pending attempt
      // when storage cannot confirm retirement; never expose filesystem paths.
      try { renameSync(tombstonePath, artifacts.statePath) } catch {}
      throw new Error('RECONCILIATION_REQUIRED')
    }
  }
  for (const filePath of [artifacts.candidatePath, artifacts.manifestPath, artifacts.dealerMailPath, artifacts.promotionBackupPath, artifacts.envelopePath, tombstonePath]) {
    // Do not let an orphan-removal failure recreate a pending marker in the
    // caller's recovery handler after some of its candidate files are gone.
    try { unlinkSync(filePath) } catch { /* Best-effort removal of this settled attempt only. */ }
  }
}

export const adapterInternals = Object.freeze({ CAPTURE_DEPS, OUTPUT_LIMIT, FORBIDDEN_HOSTS, FORBIDDEN_CAPTURE_REFERENCE, FORD_MERGE_REFERENCE, childEnvironment, runOwnedChild })
