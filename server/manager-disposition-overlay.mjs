import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import {
  MANAGER_DISPOSITION_SCHEMA,
  canonicalManagerDispositionJson,
  managerDispositionSha256,
  sanitizeManagerDispositionDocuments,
} from './manager-disposition-schema.mjs'

const SOURCE_DIRECTORY = ['work', 'manager-supplied', 'sold-logs']
const RELEASE_DIRECTORY = ['work', 'releases']
const STORE_FILES = Object.freeze({
  Howell: 'howell',
  Fowlerville: 'fowlerville',
  'Ford Detroit': 'ford-detroit',
  Lincoln: 'lincoln',
})
const MANIFEST_KEYS = new Set([
  'status', 'classification', 'source_type', 'path', 'sha256', 'source_store',
  'source_period', 'sold_records', 'delivered_records',
  'sold_not_marked_delivered', 'matched_current_public_vins',
  'unmatched_records', 'conflicting_records', 'review_records',
  'cloud_upload_allowed',
])

function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

function onlyKeys(value, allowed, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  ensure(Object.keys(value).every((key) => allowed.has(key)), `${label} contains unsupported fields`)
}

function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function ensureWithin(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Manager disposition source must stay inside the reporting workspace')
  }
  return resolvedCandidate
}

function readOperationalSource(filePath, root) {
  const link = lstatSync(filePath)
  if (!link.isFile() || link.isSymbolicLink()) throw new Error('Manager disposition source must be a regular file')
  // A redirect is a symlink *inside* the workspace — a source directory or
  // file resolving somewhere else. Ancestors of the workspace may legitimately
  // be symlinks (macOS resolves /var to /private/var; a deployment can mount
  // the workspace behind a link), so the comparison starts from the root's
  // own real location rather than demanding the whole path be link-free.
  const expected = path.join(realpathSync(root), path.relative(path.resolve(root), path.resolve(filePath)))
  if (realpathSync(filePath) !== expected) throw new Error('Manager disposition source path must not redirect')
  let bytes
  let data
  try {
    bytes = readFileSync(filePath)
    data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  }
  catch { throw new Error('Manager disposition operational source is not valid JSON') }
  return {
    data,
    sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  }
}

/**
 * Read only the exact manifest-bound *-operational.json source. There is no
 * directory scan or filename inference, so an unbound file cannot enter a
 * release and a differently classified neighboring file is never opened.
 */
export function loadManagerDispositionOverlay({ workspaceRoot, reportDate, vehicles, current = true, manifestBinding = null }) {
  const root = path.resolve(workspaceRoot)
  const empty = sanitizeManagerDispositionDocuments({ documents: [], reportDate, vehicles })
  if (!manifestBinding) return { overlay: empty, sourceRun: null, sourcePaths: [] }
  onlyKeys(manifestBinding, MANIFEST_KEYS, 'Manager disposition manifest binding')
  ensure(manifestBinding.status === 'complete', 'Manager disposition manifest binding is not complete')
  ensure(manifestBinding.classification === 'operational-redacted', 'Manager disposition manifest binding is not redacted')
  ensure(manifestBinding.source_type === 'manager-log', 'Manager disposition manifest source type is unsupported')
  ensure(manifestBinding.cloud_upload_allowed === true, 'Manager disposition manifest source is not approved for cloud upload')
  ensure(Object.hasOwn(STORE_FILES, manifestBinding.source_store), 'Manager disposition manifest store is unsupported')
  ensure(manifestBinding.source_period === reportDate.slice(0, 7), 'Manager disposition manifest period does not match the release')
  for (const key of ['sold_records', 'delivered_records', 'sold_not_marked_delivered', 'matched_current_public_vins', 'unmatched_records', 'conflicting_records', 'review_records']) {
    ensure(integer(manifestBinding[key]), `Manager disposition manifest ${key} is invalid`)
  }
  ensure(manifestBinding.review_records === manifestBinding.unmatched_records + manifestBinding.conflicting_records, 'Manager disposition manifest review count does not reconcile')
  ensure(typeof manifestBinding.sha256 === 'string' && /^[A-Fa-f0-9]{64}$/.test(manifestBinding.sha256), 'Manager disposition manifest checksum is invalid')

  const sourceDirectory = ensureWithin(root, path.join(root, ...SOURCE_DIRECTORY))
  // Content-addressed release copy: releases/<date>/manager-disposition/<sha256 lowercase>/<approved name>.
  const snapshotDirectory = ensureWithin(root, path.join(root, ...RELEASE_DIRECTORY, reportDate, 'manager-disposition', manifestBinding.sha256.toLowerCase()))
  const expectedName = `${manifestBinding.source_period}-${STORE_FILES[manifestBinding.source_store]}-operational.json`
  const boundCandidate = path.isAbsolute(manifestBinding.path) ? manifestBinding.path : path.join(root, manifestBinding.path)
  const sourcePath = ensureWithin(root, boundCandidate)
  // path.relative is case-insensitive on Windows, so a drive letter spelled
  // c: in one place and C: in another does not reject an approved source.
  const sameDirectory = (left, right) => path.relative(left, right) === ''
  const isLegacyOperationalSource = sameDirectory(path.dirname(sourcePath), sourceDirectory) && path.basename(sourcePath) === expectedName
  const isReleaseSnapshot = sameDirectory(path.dirname(sourcePath), snapshotDirectory) && path.basename(sourcePath) === expectedName
  ensure(isLegacyOperationalSource || isReleaseSnapshot, 'Manager disposition manifest path is not an approved operational source')
  const source = readOperationalSource(sourcePath, root)
  ensure(source.sha256 === manifestBinding.sha256.toUpperCase(), 'Manager disposition source checksum differs from the completed manifest')
  const documents = [{ expectedStore: manifestBinding.source_store, data: source.data }]
  const overlay = sanitizeManagerDispositionDocuments({ documents, reportDate, vehicles })
  ensure(overlay.summary.soldRecordCount === manifestBinding.sold_records, 'Manager disposition sold count differs from the completed manifest')
  ensure(overlay.summary.deliveredRecordCount === manifestBinding.delivered_records, 'Manager disposition delivered count differs from the completed manifest')
  ensure(overlay.summary.soldNotMarkedDeliveredCount === manifestBinding.sold_not_marked_delivered, 'Manager disposition not-marked-delivered count differs from the completed manifest')
  ensure(overlay.summary.matchedRecordCount === manifestBinding.matched_current_public_vins, 'Manager disposition matched count differs from the completed manifest')
  ensure(overlay.summary.unmatchedRecordCount === manifestBinding.unmatched_records, 'Manager disposition unmatched count differs from the completed manifest')
  ensure(overlay.summary.conflictingRecordCount === manifestBinding.conflicting_records, 'Manager disposition conflict count differs from the completed manifest')
  ensure(overlay.summary.reviewRecordCount === manifestBinding.review_records, 'Manager disposition review count differs from the completed manifest')
  const payload = canonicalManagerDispositionJson(overlay)
  const sha256 = managerDispositionSha256(overlay).toUpperCase()
  const bytes = new TextEncoder().encode(payload).byteLength
  const sourceRun = overlay.coverageStatus === 'provided' ? {
    type: 'manager_disposition_overlay',
    reportDate,
    extractedAt: null,
    snapshotPath: sourcePath,
    sha256,
    bytes,
    schemaVersion: MANAGER_DISPOSITION_SCHEMA,
    status: current ? 'current' : 'stale_unverified',
    staleReason: current ? null : `Source release is dated ${reportDate}`,
    rowCount: overlay.summary.recordCount,
    metadata: {
      classification: overlay.classification,
      cloudUploadAllowed: overlay.cloudUploadAllowed,
      sourceCount: overlay.sources.length,
      sourceStores: overlay.sources.map((source) => source.sourceStore),
      soldRecordCount: overlay.summary.soldRecordCount,
      deliveredRecordCount: overlay.summary.deliveredRecordCount,
      reviewRecordCount: overlay.summary.reviewRecordCount,
      strippedFieldCount: overlay.sources.reduce((count, source) => count + source.strippedFieldCount, 0),
      sanitizer: 'strict_allowlist_v1',
      boundSourceSha256: source.sha256,
    },
  } : null
  return { overlay, sourceRun, sourcePaths: [sourcePath] }
}
