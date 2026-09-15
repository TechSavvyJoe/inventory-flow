import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, fstatSync, lstatSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLatestCompletedRelease } from '../server/importer.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { accessHeaders, publicationEndpoint, cloudReleaseFrom, encryptBundle, base64Key, publishEnvelope } from './publish-cloud-release.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const COUNT_FIELDS = ['publicRowCount', 'dealerMailRowCount', 'dealerMailVinReconciledCount', 'dealerMailVinReviewCount', 'heldVinCount', 'activeHoldRecordCount', 'backupCount', 'deletedHoldRecordCount', 'resourceRecordCount', 'managerDispositionRecordCount', 'managerSoldRecordCount', 'managerDeliveredRecordCount', 'managerDispositionReviewCount', 'activeInventoryCount', 'managerDeliveredExclusionCount', 'managerPendingCarryoverCount', 'managerPendingIdentityReviewCount', 'vehicleCount']
const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
export function reportDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function check(condition, code) { if (!condition) throw new Error(code) }

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
  return { ...Object.fromEntries(COUNT_FIELDS.map(field => [field, expected[field]])), publicStoreCounts: expected.publicStoreCounts, crmStoreCounts: expected.crmStoreCounts }
}

export async function syncCloudRelease({ release, environment = process.env, fetchImpl = fetch, now = new Date() }) {
  check(release.reportDate === reportDate(now), 'NO_COMPLETED_CURRENT_DAY_RELEASE')
  check(release.sourceRuns?.public?.status === 'current' && release.sourceRuns?.dealerMail?.status === 'current', 'SOURCE_NOT_CURRENT')
  const bundle = cloudReleaseFrom(release)
  const expected = validateReleaseBundle(bundle)
  const envelope = encryptBundle(bundle, base64Key(environment.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64 ?? ''))
  const publication = await publishEnvelope(envelope, { environment, fetchImpl })
  const base = publicationEndpoint(environment.INVENTORY_OPS_CLOUD_URL).origin
  const read = async (route) => {
    const response = await fetchImpl(base + route, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { ...accessHeaders(environment), Authorization: `Bearer ${environment.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN}` } })
    check(response.ok, 'CLOUD_VERIFICATION_REQUEST_FAILED')
    return response.json()
  }
  const [status, readiness] = await Promise.all([read('/internal/status'), read('/internal/readiness')])
  const counts = verifyPublishedRelease({ envelope, expected, status, readiness })
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
    sourceHashes: receiptSourceHashes(release),
  }
}

// A publication receipt is separate from the immutable audited report manifest:
// recording delivery must never change the identity of the source being sent.
export function writeReceipt(directory, receipt) {
  check(receipt.complete === true && receipt.status === 'published_and_verified' && /^\d{4}-\d{2}-\d{2}$/.test(receipt.reportDate), 'INVALID_PUBLICATION_RECEIPT')
  mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `${receipt.reportDate}.json`)
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    renameSync(temporary, destination)
  } finally { try { unlinkSync(temporary) } catch {} }
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

export async function main() {
  const workspaceRoot = resolveWorkspaceRoot(import.meta.url)
  const directory = path.join(workspaceRoot, 'work/app-feed-status')
  mkdirSync(directory, { recursive: true })
  const lockPath = path.join(directory, '.publication.lock')
  const lock = acquirePublicationLock(lockPath)
  try {
    const release = loadLatestCompletedRelease({ workspaceRoot })
    const receipt = await syncCloudRelease({ release })
    const receiptPath = writeReceipt(directory, receipt)
    process.stdout.write(JSON.stringify({ status: receipt.status, reportDate: receipt.reportDate, counts: receipt.counts, receiptPath }) + '\n')
  } finally { releasePublicationLock(lock) }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  // Never forward raw HTTP payloads, authentication details, or source rows.
  const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'PUBLICATION_NOT_VERIFIED'
  process.stderr.write(`Cloud sync incomplete: ${code}. Existing verified receipt and audited report were preserved.\n`)
  process.exitCode = 1
})
