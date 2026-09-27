import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, fstatSync, fsyncSync, lstatSync, renameSync, unlinkSync } from 'node:fs'
import { createDecipheriv, randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLatestCompletedRelease } from '../server/importer.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { accessHeaders, publicationEndpoint, cloudBundleSha256, cloudReleaseFrom, encryptBundle, base64Key, publishEnvelope, CloudPublicationReconciliationError } from './publish-cloud-release.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

// The optional Ford OASIS and warranty channels are degradable: a deployed
// Worker whose validator drops one still reports a ready release. Verifying
// their counts keeps a silently degraded publication from being recorded as
// published_and_verified with exactContent: true.
const COUNT_FIELDS = ['publicRowCount', 'dealerMailRowCount', 'dealerMailVinReconciledCount', 'dealerMailVinReviewCount', 'heldVinCount', 'activeHoldRecordCount', 'backupCount', 'deletedHoldRecordCount', 'resourceRecordCount', 'fordOasisRecordCount', 'warrantyCheckRecordCount', 'managerDispositionRecordCount', 'managerSoldRecordCount', 'managerDeliveredRecordCount', 'managerDispositionReviewCount', 'activeInventoryCount', 'managerDeliveredExclusionCount', 'managerPendingCarryoverCount', 'managerPendingIdentityReviewCount', 'vehicleCount']
const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const RECONCILIATION_FILE = 'publication-reconciliation.json'
// The exact encrypted POST body retained beside the marker. Guarded recovery may
// re-send these bytes, and only these bytes, when the candidate is not live.
const RETAINED_ENVELOPE_FILE = 'publication-reconciliation.envelope.json'
const PUBLICATION_ATTEMPT_IN_PROGRESS = 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS'
const RECONCILIATION_FAILURE_CODES = new Set([
  PUBLICATION_ATTEMPT_IN_PROGRESS,
  'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
  'CLOUD_PUBLICATION_VERIFIED_RECEIPT_NOT_RECORDED',
])
// Guarded-recovery failures that leave the exact-candidate marker in place.
const RECOVERY_RETAINED_CODES = new Set([
  'PUBLICATION_RECONCILIATION_NOT_VERIFIED',
  'PUBLICATION_RECONCILIATION_REPOST_REJECTED',
  'PUBLICATION_RECONCILIATION_REPOST_OUTCOME_UNKNOWN',
  'PUBLICATION_RECONCILIATION_ENVELOPE_NOT_RETAINED',
  'PUBLICATION_RECONCILIATION_ENVELOPE_INVALID',
  'PUBLICATION_RECONCILIATION_RECEIPT_CONFLICT',
  'PUBLICATION_RECONCILIATION_CANDIDATE_MISMATCH',
])
const SOURCE_HASH_FIELDS = ['public', 'dealerMail', 'resources', 'managerDisposition', 'managerDispositionBinding']
export function reportDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function check(condition, code) { if (!condition) throw new Error(code) }

function normalizedBundleHash(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(text) ? text : null
}

function validatePublicationReconciliation(value) {
  try {
    check(Object.keys(value ?? {}).sort().join(',') === ['candidate', 'failureCode', 'reconciliationRequired', 'recordedAt', 'reportDate', 'schemaVersion', 'status'].sort().join(','), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(value?.schemaVersion === 1, 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(value.status === 'publication_reconciliation_required' && value.reconciliationRequired === true, 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(/^\d{4}-\d{2}-\d{2}$/.test(value.reportDate), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(RECONCILIATION_FAILURE_CODES.has(value.failureCode), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(typeof value.recordedAt === 'string' && Number.isFinite(Date.parse(value.recordedAt)) && new Date(value.recordedAt).toISOString() === value.recordedAt, 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(Object.keys(value.candidate ?? {}).sort().join(',') === ['bundleSha256', 'holdRefresh', 'sourceHashes'].sort().join(','), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    const bundleSha256 = normalizedBundleHash(value.candidate?.bundleSha256)
    check(bundleSha256 !== null, 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(typeof value.candidate.holdRefresh === 'boolean', 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    const sourceHashes = value.candidate?.sourceHashes
    check(sourceHashes && typeof sourceHashes === 'object' && !Array.isArray(sourceHashes), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    check(Object.keys(sourceHashes).length === SOURCE_HASH_FIELDS.length && SOURCE_HASH_FIELDS.every((field) => Object.hasOwn(sourceHashes, field)), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    for (const field of SOURCE_HASH_FIELDS) {
      const hash = sourceHashes[field]
      check(hash === null || normalizedBundleHash(hash) !== null, 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    }
    for (const field of ['public', 'dealerMail', 'resources']) {
      check(normalizedBundleHash(sourceHashes[field]) !== null, 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    }
    return {
      ...value,
      candidate: {
        bundleSha256,
        holdRefresh: value.candidate.holdRefresh,
        sourceHashes: Object.fromEntries(SOURCE_HASH_FIELDS.map((field) => [field, sourceHashes[field] === null ? null : normalizedBundleHash(sourceHashes[field])])),
      },
    }
  } catch {
    throw new Error('PUBLICATION_RECONCILIATION_STATE_INVALID')
  }
}

export function publicationReconciliationPath(workspaceRoot) {
  return path.join(workspaceRoot, 'work', 'app-feed-status', RECONCILIATION_FILE)
}

export function retainedEnvelopePath(workspaceRoot) {
  return path.join(workspaceRoot, 'work', 'app-feed-status', RETAINED_ENVELOPE_FILE)
}

// Called before the marker is installed, so an existing file can only be an
// orphan from an attempt that never reached its POST; it is replaced atomically.
export function writeRetainedEnvelope(workspaceRoot, envelope) {
  const destination = retainedEnvelopePath(workspaceRoot)
  mkdirSync(path.dirname(destination), { recursive: true })
  const serialized = JSON.stringify(envelope)
  const temporary = `${destination}.${process.pid}.tmp`
  let descriptor = null
  try {
    descriptor = openSync(temporary, 'w', 0o600)
    writeFileSync(descriptor, serialized)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporary, destination)
    syncDirectory(path.dirname(destination))
    check(readFileSync(destination, 'utf8') === serialized, 'PUBLICATION_RETAINED_ENVELOPE_WRITE_FAILED')
  } finally {
    if (descriptor !== null) try { closeSync(descriptor) } catch {}
    try { unlinkSync(temporary) } catch {}
  }
  return destination
}

function removeRetainedEnvelope(workspaceRoot) {
  try { unlinkSync(retainedEnvelopePath(workspaceRoot)) } catch {}
}

// Returns the exact retained POST body only when its identity and ciphertext
// both prove the marker's candidate: the AES-GCM tag binds the report date and
// bundle hash, and the decrypted canonical bundle must hash to the same value.
function readRetainedEnvelope(workspaceRoot, state, environment) {
  const filePath = retainedEnvelopePath(workspaceRoot)
  let body
  try {
    const identity = lstatSync(filePath)
    check(identity.isFile() && !identity.isSymbolicLink(), 'PUBLICATION_RECONCILIATION_ENVELOPE_NOT_RETAINED')
    body = readFileSync(filePath, 'utf8')
  } catch {
    throw new CloudPublicationReconciliationError('PUBLICATION_RECONCILIATION_ENVELOPE_NOT_RETAINED', state.candidate.bundleSha256)
  }
  try {
    const envelope = JSON.parse(body)
    check(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'INVALID')
    check(envelope.reportDate === state.reportDate && envelope.bundleSha256 === state.candidate.bundleSha256, 'INVALID')
    check(typeof envelope.iv === 'string' && typeof envelope.ciphertext === 'string', 'INVALID')
    const sealed = Buffer.from(envelope.ciphertext, 'base64url')
    check(sealed.length > 16, 'INVALID')
    const decipher = createDecipheriv('aes-256-gcm', base64Key(environment.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64 ?? ''), Buffer.from(envelope.iv, 'base64url'))
    decipher.setAAD(Buffer.from(`${envelope.version}:${envelope.reportDate}:${envelope.bundleSha256}`, 'utf8'))
    decipher.setAuthTag(sealed.subarray(sealed.length - 16))
    const plaintext = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
    check(cloudBundleSha256(JSON.parse(plaintext.toString('utf8'))) === state.candidate.bundleSha256, 'INVALID')
    return envelope
  } catch {
    throw new CloudPublicationReconciliationError('PUBLICATION_RECONCILIATION_ENVELOPE_INVALID', state.candidate.bundleSha256)
  }
}

export function readPublicationReconciliation(workspaceRoot) {
  const filePath = publicationReconciliationPath(workspaceRoot)
  let identity
  try { identity = lstatSync(filePath) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error('PUBLICATION_RECONCILIATION_STATE_INVALID')
  }
  try {
    check(identity.isFile() && !identity.isSymbolicLink(), 'PUBLICATION_RECONCILIATION_STATE_INVALID')
    return validatePublicationReconciliation(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    throw new Error('PUBLICATION_RECONCILIATION_STATE_INVALID')
  }
}

export function assertNoPendingPublicationReconciliation(workspaceRoot) {
  const state = readPublicationReconciliation(workspaceRoot)
  if (!state) return null
  const error = new Error('PUBLICATION_RECONCILIATION_REQUIRED')
  error.bundleSha256 = state.candidate.bundleSha256
  error.reconciliation = state
  throw error
}

export function writePublicationReconciliation(workspaceRoot, {
  reportDate: candidateReportDate,
  bundleSha256,
  failureCode,
  sourceHashes,
  holdRefresh = false,
  now = new Date(),
}) {
  const state = validatePublicationReconciliation({
    schemaVersion: 1,
    status: 'publication_reconciliation_required',
    reconciliationRequired: true,
    reportDate: candidateReportDate,
    failureCode,
    recordedAt: now.toISOString(),
    candidate: { bundleSha256, holdRefresh, sourceHashes },
  })
  const destination = publicationReconciliationPath(workspaceRoot)
  mkdirSync(path.dirname(destination), { recursive: true })
  const existing = readPublicationReconciliation(workspaceRoot)
  if (existing) {
    check(existing.reportDate === state.reportDate &&
      existing.candidate.bundleSha256 === state.candidate.bundleSha256 &&
      existing.candidate.holdRefresh === state.candidate.holdRefresh &&
      SOURCE_HASH_FIELDS.every((field) => existing.candidate.sourceHashes[field] === state.candidate.sourceHashes[field]),
    'PUBLICATION_RECONCILIATION_STATE_CONFLICT')
    return { path: destination, state: existing }
  }
  let descriptor = null
  try {
    // Create the guard at its final path and never unlink a failed write. A
    // torn file is deliberately fail-closed by the strict reader, while a
    // successfully flushed file survives a process exit before or during POST.
    descriptor = openSync(destination, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(state, null, 2) + '\n')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    syncDirectory(path.dirname(destination))
    const persisted = readPublicationReconciliation(workspaceRoot)
    check(persisted?.reportDate === state.reportDate &&
      persisted?.failureCode === state.failureCode &&
      persisted?.candidate.bundleSha256 === state.candidate.bundleSha256 &&
      persisted?.candidate.holdRefresh === state.candidate.holdRefresh &&
      SOURCE_HASH_FIELDS.every((field) => persisted?.candidate.sourceHashes[field] === state.candidate.sourceHashes[field]),
    'PUBLICATION_RECONCILIATION_STATE_WRITE_FAILED')
  } finally {
    if (descriptor !== null) try { closeSync(descriptor) } catch {}
  }
  return { path: destination, state }
}

function syncDirectory(directory) {
  let descriptor = null
  try {
    descriptor = openSync(directory, 'r')
    fsyncSync(descriptor)
  } catch {
    // Windows does not consistently permit opening directories. Guard and
    // receipt payloads are flushed at their final file paths before this
    // best-effort directory flush is attempted.
  } finally {
    if (descriptor !== null) try { closeSync(descriptor) } catch {}
  }
}

export function archivePublicationReconciliation(workspaceRoot, expectedBundleSha256, now = new Date(), resolution = 'verified') {
  check(['verified', 'definitely-rejected'].includes(resolution), 'PUBLICATION_RECONCILIATION_RESOLUTION_INVALID')
  const state = readPublicationReconciliation(workspaceRoot)
  check(state !== null && state.candidate.bundleSha256 === normalizedBundleHash(expectedBundleSha256), 'PUBLICATION_RECONCILIATION_STATE_CHANGED')
  const source = publicationReconciliationPath(workspaceRoot)
  const archiveDirectory = path.join(path.dirname(source), 'reconciled')
  mkdirSync(archiveDirectory, { recursive: true })
  const destination = path.join(archiveDirectory, `${state.reportDate}-${now.toISOString().replace(/[:.]/g, '-')}-${resolution}-${state.candidate.bundleSha256}.json`)
  renameSync(source, destination)
  syncDirectory(path.dirname(source))
  syncDirectory(archiveDirectory)
  const archived = validatePublicationReconciliation(JSON.parse(readFileSync(destination, 'utf8')))
  check(archived.candidate.bundleSha256 === state.candidate.bundleSha256 && !existsSync(source), 'PUBLICATION_RECONCILIATION_ARCHIVE_FAILED')
  // The retained ciphertext is only a recovery input for this marker. A later
  // attempt overwrites any copy left by a failed unlink before its own marker.
  removeRetainedEnvelope(workspaceRoot)
  return destination
}

function normalizedSourceHash(value) {
  if (value === null) return null
  check(typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value), 'HOLD_REFRESH_SOURCE_BINDINGS_INVALID')
  return value.toLowerCase()
}

export function assertExpectedSourceHashes(release, environment = process.env) {
  const raw = String(environment.INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON ?? '').trim()
  if (!raw) return false
  let expected
  try { expected = JSON.parse(raw) } catch { throw new Error('HOLD_REFRESH_SOURCE_BINDINGS_INVALID') }
  check(expected && typeof expected === 'object' && !Array.isArray(expected), 'HOLD_REFRESH_SOURCE_BINDINGS_INVALID')
  const keys = ['public', 'dealerMail', 'resources', 'managerDisposition', 'managerDispositionBinding']
  check(Object.keys(expected).length === keys.length && keys.every((key) => Object.hasOwn(expected, key)), 'HOLD_REFRESH_SOURCE_BINDINGS_INVALID')
  const actual = receiptSourceHashes(release)
  for (const key of keys) {
    check(normalizedSourceHash(expected[key]) === normalizedSourceHash(actual[key] ?? null), 'HOLD_REFRESH_SOURCE_BINDING_MISMATCH')
  }
  return true
}

export function receiptSourceHashes(release) {
  return {
    ...Object.fromEntries(['public', 'dealerMail', 'resources', 'managerDisposition'].map(name => [name, release.sourceRuns?.[name]?.sha256 ?? null])),
    // sourceRuns.managerDisposition.sha256 binds the sanitized cloud overlay.
    // The daily manifest binds the raw operational input. Preserve both so the
    // idempotency guard compares like with like.
    managerDispositionBinding: release.sourceRuns?.managerDisposition?.metadata?.boundSourceSha256 ?? null,
  }
}

export function verifyPublishedRelease({ envelope, expected, status, readiness }) {
  check(status?.ready === true && readiness?.ready === true, 'CLOUD_NOT_READY')
  check(status.reportDate === envelope.reportDate && readiness.reportDate === envelope.reportDate, 'CLOUD_DATE_MISMATCH')
  check(status.bundleSha256 === envelope.bundleSha256, 'CLOUD_CONTENT_MISMATCH')
  check(readiness.bundleSha256 === envelope.bundleSha256, 'CLOUD_READINESS_CONTENT_MISMATCH')
  for (const field of COUNT_FIELDS) check(status.metadata?.[field] === expected[field], 'CLOUD_COUNT_MISMATCH')
  for (const field of ['publicStoreCounts', 'crmStoreCounts']) {
    for (const store of STORES) check((status.metadata?.[field]?.[store] ?? 0) === (expected[field]?.[store] ?? 0), 'CLOUD_STORE_COUNT_MISMATCH')
  }
  check(readiness.counts?.inventory === expected.activeInventoryCount && readiness.counts?.managerDispositions === expected.managerDispositionRecordCount && readiness.bootstrapBytes > 0, 'APP_READ_MODEL_MISMATCH')
  // Reported for data health, not cross-checked: VINs the manager log hid while
  // the public feed still lists them. A Worker older than this field still verifies.
  return { ...Object.fromEntries(COUNT_FIELDS.map(field => [field, expected[field]])), managerDeliveredListedExclusionCount: expected.managerDeliveredListedExclusionCount ?? 0, publicStoreCounts: expected.publicStoreCounts, crmStoreCounts: expected.crmStoreCounts, activeStoreCounts: expected.activeStoreCounts }
}

export async function syncCloudRelease({ release, environment = process.env, fetchImpl = fetch, now = new Date(), beforePublish = null }) {
  check(release.reportDate === reportDate(now), 'NO_COMPLETED_CURRENT_DAY_RELEASE')
  check(release.sourceRuns?.public?.status === 'current' && release.sourceRuns?.dealerMail?.status === 'current', 'SOURCE_NOT_CURRENT')
  assertExpectedSourceHashes(release, environment)
  const bundle = cloudReleaseFrom(release)
  const expected = validateReleaseBundle(bundle)
  const envelope = encryptBundle(bundle, base64Key(environment.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64 ?? ''))
  const sourceHashes = receiptSourceHashes(release)
  const publication = await publishEnvelope(envelope, {
    environment,
    fetchImpl,
    beforeRequest: beforePublish ? () => beforePublish({ envelope, sourceHashes }) : null,
  })
  const base = publicationEndpoint(environment.INVENTORY_OPS_CLOUD_URL).origin
  const read = async (route) => {
    const response = await fetchImpl(base + route, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { ...accessHeaders(environment), Authorization: `Bearer ${environment.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN}` } })
    check(response.ok, 'CLOUD_VERIFICATION_REQUEST_FAILED')
    return response.json()
  }
  let counts
  let verificationError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const [status, readiness] = await Promise.all([read('/internal/status'), read('/internal/readiness')])
      counts = verifyPublishedRelease({ envelope, expected, status, readiness })
      verificationError = null
      break
    } catch (error) {
      verificationError = error
    }
  }
  if (verificationError) {
    throw new CloudPublicationReconciliationError('CLOUD_PUBLICATION_OUTCOME_UNKNOWN', envelope.bundleSha256, { cause: verificationError })
  }
  return {
    schemaVersion: 1,
    reportDate: envelope.reportDate,
    complete: true,
    status: 'published_and_verified',
    publication: publication.status,
    bundleSha256: envelope.bundleSha256,
    verifiedAt: new Date().toISOString(),
    counts,
    validation: { exactContent: true, storeCounts: true, privateAppReadiness: true, managerDispositionBound: true },
    sourceHashes,
  }
}

// A publication receipt is separate from the immutable audited report manifest:
// recording delivery must never change the identity of the source being sent.
export function writeReceipt(directory, receipt) {
  check(receipt.complete === true && receipt.status === 'published_and_verified' && /^\d{4}-\d{2}-\d{2}$/.test(receipt.reportDate), 'INVALID_PUBLICATION_RECEIPT')
  mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `${receipt.reportDate}.json`)
  const serialized = JSON.stringify(receipt, null, 2) + '\n'
  try {
    const existing = lstatSync(destination)
    check(existing.isFile() && !existing.isSymbolicLink(), 'INVALID_PUBLICATION_RECEIPT_DESTINATION')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  let descriptor = null
  try {
    // The exact-candidate marker remains installed throughout this write. A
    // torn receipt therefore blocks every later writer instead of allowing a
    // second candidate, and a successful fsync/readback is proven before the
    // marker can be archived.
    descriptor = openSync(destination, 'w', 0o600)
    writeFileSync(descriptor, serialized)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    syncDirectory(directory)
    check(readFileSync(destination, 'utf8') === serialized, 'PUBLICATION_RECEIPT_WRITE_NOT_VERIFIED')
  } finally {
    if (descriptor !== null) try { closeSync(descriptor) } catch {}
  }
  return destination
}

const WRITER_LOCKED = 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
function sameFile(left, right) { return left.dev === right.dev && left.ino === right.ino && right.isFile() }
function ownedFile(filePath, identity, content) {
  try { return sameFile(identity, lstatSync(filePath)) && readFileSync(filePath, 'utf8') === content } catch { return false }
}
function createLock(filePath) {
  const fd = openSync(filePath, 'wx', 0o600)
  const content = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ownerId: randomUUID() })
  try {
    writeFileSync(fd, content)
    return { fd, path: filePath, identity: fstatSync(fd), content }
  } catch (error) {
    closeSync(fd)
    // A torn lock is ambiguous and deliberately remains for owner review.
    throw error
  }
}
export function releasePublicationLock(lock) {
  try {
    check(ownedFile(lock.path, lock.identity, lock.content), WRITER_LOCKED)
    unlinkSync(lock.path)
  } finally { closeSync(lock.fd) }
}
export function acquirePublicationLock(lockPath) {
  try { return createLock(lockPath) } catch (error) { if (error.code !== 'EEXIST') throw new Error(WRITER_LOCKED) }
  // All recovery contenders use one exclusive, short-lived guard. A normal
  // writer may win exclusive acquisition after stale removal; recovery then
  // fails without inspecting or deleting that newly acquired owner's lock.
  let guard
  try { guard = createLock(`${lockPath}.recovery`) } catch { throw new Error(WRITER_LOCKED) }
  try {
    const identity = lstatSync(lockPath)
    check(identity.isFile() && !identity.isSymbolicLink(), WRITER_LOCKED)
    const content = readFileSync(lockPath, 'utf8')
    let recorded
    try { recorded = JSON.parse(content) } catch { throw new Error(WRITER_LOCKED) }
    check(Number.isSafeInteger(recorded?.pid) && recorded.pid > 0, WRITER_LOCKED)
    let definitelyExited = false
    try { process.kill(recorded.pid, 0) } catch (error) { definitelyExited = error.code === 'ESRCH' }
    check(definitelyExited, WRITER_LOCKED)
    check(ownedFile(lockPath, identity, content), WRITER_LOCKED)
    unlinkSync(lockPath)
    try { return createLock(lockPath) } catch { throw new Error(WRITER_LOCKED) }
  } catch { throw new Error(WRITER_LOCKED) }
  finally { releasePublicationLock(guard) }
}

export function assertInheritedPublicationLock(lockPath, environment = process.env) {
  const ownerId = String(environment.INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID ?? '').trim()
  if (!ownerId) return false
  try {
    const identity = lstatSync(lockPath)
    check(identity.isFile() && !identity.isSymbolicLink(), WRITER_LOCKED)
    const recorded = JSON.parse(readFileSync(lockPath, 'utf8'))
    check(recorded?.ownerId === ownerId, WRITER_LOCKED)
    return true
  } catch {
    throw new Error(WRITER_LOCKED)
  }
}

async function readProtectedReleaseState(environment, fetchImpl) {
  const base = publicationEndpoint(environment.INVENTORY_OPS_CLOUD_URL).origin
  const read = async (route) => {
    const response = await fetchImpl(base + route, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
      headers: {
        ...accessHeaders(environment),
        Authorization: `Bearer ${environment.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN}`,
      },
    })
    check(response.ok, 'CLOUD_VERIFICATION_REQUEST_FAILED')
    return response.json()
  }
  return Promise.all([read('/internal/status'), read('/internal/readiness')])
}

function assertReconciliationCandidateMatchesRelease(state, release) {
  try { return assertCandidateSources(state, release) } catch (error) {
    throw new CloudPublicationReconciliationError(error.message, state.candidate.bundleSha256)
  }
}

function assertCandidateSources(state, release) {
  check(release.reportDate === state.reportDate, 'PUBLICATION_RECONCILIATION_CANDIDATE_MISMATCH')
  const bundle = cloudReleaseFrom(release)
  check(cloudBundleSha256(bundle) === state.candidate.bundleSha256, 'PUBLICATION_RECONCILIATION_CANDIDATE_MISMATCH')
  const sourceHashes = receiptSourceHashes(release)
  for (const field of SOURCE_HASH_FIELDS) {
    const actual = sourceHashes[field] === null || sourceHashes[field] === undefined ? null : normalizedBundleHash(sourceHashes[field])
    check(actual === state.candidate.sourceHashes[field], 'PUBLICATION_RECONCILIATION_CANDIDATE_MISMATCH')
  }
  return { bundle, expected: validateReleaseBundle(bundle) }
}

export async function reconcilePendingPublication({
  workspaceRoot = resolveWorkspaceRoot(import.meta.url),
  environment = process.env,
  fetchImpl = fetch,
  now = new Date(),
  loadRelease = loadLatestCompletedRelease,
} = {}) {
  const directory = path.join(workspaceRoot, 'work', 'app-feed-status')
  mkdirSync(directory, { recursive: true })
  const lockPath = path.join(directory, '.publication.lock')
  const inheritedLock = assertInheritedPublicationLock(lockPath, environment)
  const lock = inheritedLock ? null : acquirePublicationLock(lockPath)
  try {
    const state = readPublicationReconciliation(workspaceRoot)
    check(state !== null, 'PUBLICATION_RECONCILIATION_NOT_FOUND')
    const candidateClock = new Date(`${state.reportDate}T16:00:00-04:00`)
    const release = loadRelease({ workspaceRoot, now: candidateClock })
    const { expected } = assertReconciliationCandidateMatchesRelease(state, release)
    const candidateIdentity = { reportDate: state.reportDate, bundleSha256: state.candidate.bundleSha256 }
    const verifyLive = async () => {
      let verificationError
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const [status, readiness] = await readProtectedReleaseState(environment, fetchImpl)
          return { counts: verifyPublishedRelease({ envelope: candidateIdentity, expected, status, readiness }) }
        } catch (error) {
          verificationError = error
        }
      }
      return { verificationError }
    }
    let publication = 'reconciled_exact_candidate'
    let { counts, verificationError } = await verifyLive()
    if (verificationError) {
      // The candidate is not proven live. Re-send the exact retained encrypted
      // POST body (same bytes, same bundle hash) through the normal publish
      // path; never rebuild or re-encrypt. Every non-verified outcome keeps the
      // marker in place.
      const envelope = readRetainedEnvelope(workspaceRoot, state, environment)
      try {
        await publishEnvelope(envelope, { environment, fetchImpl })
      } catch (error) {
        const code = error?.definiteNoCommit === true
          ? 'PUBLICATION_RECONCILIATION_REPOST_REJECTED'
          : 'PUBLICATION_RECONCILIATION_REPOST_OUTCOME_UNKNOWN'
        throw new CloudPublicationReconciliationError(code, state.candidate.bundleSha256, { cause: error })
      }
      ;({ counts, verificationError } = await verifyLive())
      if (verificationError) throw new CloudPublicationReconciliationError('PUBLICATION_RECONCILIATION_NOT_VERIFIED', state.candidate.bundleSha256, { cause: verificationError })
      publication = 'reposted_exact_candidate'
    }

    const receipt = {
      schemaVersion: 1,
      reportDate: state.reportDate,
      complete: true,
      status: 'published_and_verified',
      publication,
      bundleSha256: state.candidate.bundleSha256,
      verifiedAt: now.toISOString(),
      counts,
      validation: { exactContent: true, storeCounts: true, privateAppReadiness: true, managerDispositionBound: true },
      sourceHashes: state.candidate.sourceHashes,
    }
    const receiptPath = path.join(directory, `${receipt.reportDate}.json`)
    if (existsSync(receiptPath)) {
      // Both protected endpoints have just proved this exact candidate live, and
      // the marker blocked every later writer, so a parseable same-date receipt
      // (for example the morning release before an intraday hold refresh) is
      // older evidence and is replaced exactly as a normal publish would. Only a
      // torn or unreadable receipt stops recovery for operator review.
      try { JSON.parse(readFileSync(receiptPath, 'utf8')) } catch { throw new CloudPublicationReconciliationError('PUBLICATION_RECONCILIATION_RECEIPT_CONFLICT', state.candidate.bundleSha256) }
    }
    writeReceipt(directory, receipt)
    const archivedStatePath = archivePublicationReconciliation(workspaceRoot, receipt.bundleSha256, now)
    return { receipt, receiptPath, archivedStatePath }
  } finally { if (lock) releasePublicationLock(lock) }
}

export async function main({
  workspaceRoot = resolveWorkspaceRoot(import.meta.url),
  environment = process.env,
  fetchImpl = fetch,
  now = new Date(),
  loadRelease = loadLatestCompletedRelease,
  writeReconciliation = writePublicationReconciliation,
} = {}) {
  const directory = path.join(workspaceRoot, 'work/app-feed-status')
  mkdirSync(directory, { recursive: true })
  const lockPath = path.join(directory, '.publication.lock')
  const inheritedLock = assertInheritedPublicationLock(lockPath, environment)
  const lock = inheritedLock ? null : acquirePublicationLock(lockPath)
  try {
    assertNoPendingPublicationReconciliation(workspaceRoot)
    const release = loadRelease({ workspaceRoot, now })
    const holdRefresh = Boolean(String(environment.INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON ?? '').trim())
    let publicationAttempt = null
    let receipt
    try {
      receipt = await syncCloudRelease({
        release,
        environment,
        fetchImpl,
        now,
        beforePublish: ({ envelope, sourceHashes }) => {
          writeRetainedEnvelope(workspaceRoot, envelope)
          publicationAttempt = writeReconciliation(workspaceRoot, {
            reportDate: release.reportDate,
            bundleSha256: envelope.bundleSha256,
            failureCode: PUBLICATION_ATTEMPT_IN_PROGRESS,
            sourceHashes,
            holdRefresh,
            now,
          }).state
        },
      })
    } catch (error) {
      if (error?.definiteNoCommit === true && publicationAttempt) {
        archivePublicationReconciliation(workspaceRoot, publicationAttempt.candidate.bundleSha256, now, 'definitely-rejected')
      }
      throw error
    }
    check(publicationAttempt?.candidate.bundleSha256 === receipt.bundleSha256, 'PUBLICATION_RECONCILIATION_STATE_CHANGED')
    let receiptPath
    try {
      receiptPath = writeReceipt(directory, receipt)
    } catch (error) {
      const reconciliationError = new CloudPublicationReconciliationError('CLOUD_PUBLICATION_VERIFIED_RECEIPT_NOT_RECORDED', receipt.bundleSha256, { cause: error })
      throw reconciliationError
    }
    archivePublicationReconciliation(workspaceRoot, receipt.bundleSha256, now)
    process.stdout.write(JSON.stringify({ status: receipt.status, reportDate: receipt.reportDate, bundleSha256: receipt.bundleSha256, counts: receipt.counts, receiptPath }) + '\n')
  } finally { if (lock) releasePublicationLock(lock) }
}

export function publicationFailureMessage(error) {
  const code = /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'PUBLICATION_NOT_VERIFIED'
  const bundleSha256 = typeof error?.bundleSha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(error.bundleSha256)
    ? error.bundleSha256.toLowerCase()
    : null
  const reconciliationRequired = RECONCILIATION_FAILURE_CODES.has(code) || code === 'PUBLICATION_RECONCILIATION_REQUIRED'
  if (RECOVERY_RETAINED_CODES.has(code)) {
    const candidate = bundleSha256 ? ` candidate_bundle_sha256=${bundleSha256}.` : ''
    return `Publication reconciliation incomplete: ${code}.${candidate} The exact-candidate marker was kept; follow the guarded recovery in DAILY_AUTOMATION_RUNBOOK.md.`
  }
  if (reconciliationRequired) {
    const candidate = bundleSha256 ? ` candidate_bundle_sha256=${bundleSha256}.` : ''
    return `Cloud sync incomplete: ${code}.${candidate} Reconcile the exact candidate before any new publication attempt.`
  }
  return `Cloud sync incomplete: ${code}. Existing verified receipt and audited report were preserved.`
}

if (process.argv[1] && path.basename(process.argv[1]) === 'sync-cloud-release.mjs') {
  const command = process.argv[2] ?? 'publish'
  const operation = command === '--reconcile-pending'
    ? reconcilePendingPublication().then(({ receipt, receiptPath, archivedStatePath }) => {
        process.stdout.write(JSON.stringify({
          status: receipt.status,
          publication: receipt.publication,
          reportDate: receipt.reportDate,
          bundleSha256: receipt.bundleSha256,
          receiptPath,
          archivedStatePath,
        }) + '\n')
      })
    : command === 'publish'
      ? main()
      : Promise.reject(new Error('UNKNOWN_SYNC_COMMAND'))
  operation.catch(error => {
    // Never forward raw HTTP payloads, authentication details, or source rows.
    process.stderr.write(`${publicationFailureMessage(error)}\n`)
    process.exitCode = 1
  })
}
