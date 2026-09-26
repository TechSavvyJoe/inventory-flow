import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLatestCompletedRelease } from '../server/importer.mjs'
import { RELEASE_FORMAT, validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'
import { isMainModule } from './lib/is-main.mjs'

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const PRIVATE_HOSTNAME = 'inventory-ops.joegallant.me'
const MAX_ENVELOPE_BYTES = 25 * 1024 * 1024
const LOCAL_MANIFEST_KEYS = new Set([
  'cloudflare_publish',
  'daily_steps',
  'latest_pointers_advanced',
  'release_bundle_path',
  'release_bundle_sha256',
])
const DEFINITE_RELEASE_REJECTION_CODES = new Set([
  'ACCESS_AUTHENTICATION_REQUIRED',
  'ACCESS_NOT_CONFIGURED',
  'ACCESS_TOKEN_INVALID',
  'BODY_TOO_LARGE',
  'CURRENT_RELEASE_METADATA_INVALID',
  'DATABASE_NOT_CONFIGURED',
  'EMPTY_BODY',
  'INVALID_ENCRYPTED_CONTENT',
  'INVALID_ENVELOPE',
  'INVALID_JSON',
  'INVALID_OR_INCOMPLETE_RELEASE',
  'INVALID_RELEASE_COMPLETION_TIME',
  'JSON_CONTENT_REQUIRED',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'OLDER_RELEASE_REJECTED',
  'PRIVATE_HOST_REQUIRED',
  'PUBLISHER_AUTHENTICATION_REQUIRED',
  'PUBLISHER_IDENTITY_REQUIRED',
  'PUBLISH_CONFLICT_RETRY',
  'RELEASE_KEY_NOT_CONFIGURED',
])

function requiredEnvironment(name, environment = process.env) {
  const value = environment[name]
  if (!value) throw new Error(`${name} is required and must be loaded from the local secret store`)
  return value
}

export function base64Key(value) {
  const input = String(value).trim()
  if (!/^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})$/.test(input)) throw new Error('Release encryption key is not canonical base64 for 32 bytes')
  const bytes = Buffer.from(input, input.includes('=') ? 'base64' : 'base64url')
  if (bytes.length !== 32 || ![bytes.toString('base64'), bytes.toString('base64url')].includes(input)) throw new Error('Release encryption key is not canonical base64 for 32 bytes')
  return bytes
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function cloudBundleSha256(bundle) {
  return sha256(Buffer.from(canonicalJson(bundle), 'utf8'))
}

// Keep provenance labels and filenames while removing machine-specific path
// prefixes. Restrict this transformation to metadata: exact vehicle/customer
// text and complete raw snapshots are preserved without rewriting their values.
//
// The key name is the signal, not the prefix. A prefix allowlist missed every
// path outside /Users, /home, /tmp and /var — macOS realpaths under /private,
// external volumes, /opt, /srv, /mnt, and relative or home-relative paths all
// went into the published metadata verbatim. Any value under a *path key that
// contains a separator is reduced to its filename; URLs are left alone.
export function portableMetadata(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => portableMetadata(item, parentKey))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portableMetadata(item, key)]))
  if (typeof value === 'string' && /(?:path|paths)$/i.test(parentKey) && /[\\/]/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return `local-file:${value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)}`
  }
  return value
}

export function publishedManifestFrom(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return portableMetadata(manifest)
  return portableMetadata(Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !LOCAL_MANIFEST_KEYS.has(key)),
  ))
}

function sourceRunForCloud(source) {
  if (!source) return null
  return {
    type: source.type,
    reportDate: source.reportDate,
    extractedAt: source.extractedAt ?? null,
    sha256: String(source.sha256 ?? '').toLowerCase(),
    bytes: source.bytes,
    schemaVersion: source.schemaVersion,
    status: source.status,
    staleReason: source.staleReason ?? null,
    rowCount: source.rowCount,
    ...(source.provenanceSha256 ? { provenanceSha256: String(source.provenanceSha256).toLowerCase() } : {}),
    metadata: portableMetadata(source.metadata ?? {}),
  }
}

export function cloudReleaseFrom(release) {
  return {
    schemaVersion: RELEASE_FORMAT,
    complete: true,
    reportDate: release.reportDate,
    // Publication time is recorded by the service. The artifact identity is
    // deterministic so retries of the same evidence reuse the same release.
    createdAt: release.completedAt ?? release.manifest?.completed_at ?? null,
    scope: 'daily_source_evidence',
    release: {
      reportDate: release.reportDate,
      timezone: release.timezone,
      completedAt: release.completedAt,
      // Preserve certified totals, change categories, and validation evidence.
      // App-owned transfers require the separate operational-ledger migration.
      // Delivery receipts and local artifact bookkeeping change after a
      // publish attempt. They are deliberately outside the immutable release
      // identity; source bindings and validation evidence remain inside it.
      manifest: publishedManifestFrom(release.manifest),
      warnings: release.warnings ?? [],
      sourceRuns: {
        public: sourceRunForCloud(release.sourceRuns?.public),
        dealerMail: sourceRunForCloud(release.sourceRuns?.dealerMail),
        resources: sourceRunForCloud(release.sourceRuns?.resources),
        managerDisposition: sourceRunForCloud(release.sourceRuns?.managerDisposition),
      },
      publicSnapshot: release.publicSnapshot,
      dealerMailSnapshot: release.dealerMailSnapshot,
      releasedHoldHistory: release.releasedHoldHistory ?? [],
      publicChangeEvents: release.publicChangeEvents ?? [],
      managerDispositionOverlay: release.managerDispositionOverlay,
      vehicles: release.vehicles ?? [],
    },
  }
}

export function encryptBundle(bundle, key) {
  validateReleaseBundle(bundle)
  const plaintext = Buffer.from(canonicalJson(bundle), 'utf8')
  const bundleSha256 = cloudBundleSha256(bundle)
  const iv = randomBytes(12)
  const aad = Buffer.from(`${RELEASE_FORMAT}:${bundle.reportDate}:${bundleSha256}`, 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    version: RELEASE_FORMAT,
    reportDate: bundle.reportDate,
    bundleSha256,
    iv: iv.toString('base64url'),
    ciphertext: Buffer.concat([ciphertext, authTag]).toString('base64url'),
  }
}

export function accessHeaders(environment = process.env) {
  const clientId = requiredEnvironment('CF_ACCESS_CLIENT_ID', environment)
  const clientSecret = requiredEnvironment('CF_ACCESS_CLIENT_SECRET', environment)
  return { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret }
}

export function publicationEndpoint(value) {
  const cloudUrl = new URL(value)
  if (cloudUrl.protocol !== 'https:' || cloudUrl.hostname !== PRIVATE_HOSTNAME || cloudUrl.port || cloudUrl.username || cloudUrl.password || cloudUrl.search || cloudUrl.hash || cloudUrl.pathname !== '/') throw new Error(`Cloud publish URL must be https://${PRIVATE_HOSTNAME}`)
  return new URL('/internal/releases', cloudUrl)
}

export class CloudPublicationReconciliationError extends Error {
  constructor(code, bundleSha256, { cause } = {}) {
    super(code, { cause })
    this.name = 'CloudPublicationReconciliationError'
    this.bundleSha256 = typeof bundleSha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(bundleSha256)
      ? bundleSha256.toLowerCase()
      : null
  }
}

function outcomeUnknown(envelope, cause) {
  return new CloudPublicationReconciliationError('CLOUD_PUBLICATION_OUTCOME_UNKNOWN', envelope?.bundleSha256, { cause })
}

export async function publishEnvelope(envelope, { environment = process.env, fetchImpl = fetch } = {}) {
  const endpoint = publicationEndpoint(requiredEnvironment('INVENTORY_OPS_CLOUD_URL', environment))
  const body = JSON.stringify(envelope)
  if (Buffer.byteLength(body, 'utf8') > MAX_ENVELOPE_BYTES) throw new Error('Encrypted release exceeds the permitted upload size')
  const request = {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
    headers: {
      Authorization: `Bearer ${requiredEnvironment('INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN', environment)}`,
      'Content-Type': 'application/json',
      ...accessHeaders(environment),
    },
    body,
  }
  let response
  try {
    response = await fetchImpl(endpoint, request)
  } catch (error) {
    // A transport error cannot prove whether the server accepted the POST.
    throw outcomeUnknown(envelope, error)
  }
  if (!response || typeof response.ok !== 'boolean') throw outcomeUnknown(envelope)
  let payload = null
  try {
    payload = await response.json()
  } catch (error) {
    // Once the POST has been attempted, an unparseable response cannot prove
    // whether the server committed before returning or truncating the body.
    throw outcomeUnknown(envelope, error)
  }
  if (!response.ok) {
    const code = payload !== null && typeof payload === 'object' && !Array.isArray(payload) &&
      typeof payload.code === 'string' && /^[A-Z0-9_]+$/.test(payload.code)
      ? payload.code
      : null
    if (!code || !DEFINITE_RELEASE_REJECTION_CODES.has(code)) throw outcomeUnknown(envelope)
    throw new Error(`Cloud release publish failed (${response.status}: ${code})`)
  }
  if (!payload || !['published', 'already_published'].includes(payload.status) || payload.reportDate !== envelope.reportDate) {
    throw outcomeUnknown(envelope)
  }
  return { status: payload.status, reportDate: payload.reportDate }
}

export async function main() {
  publicationEndpoint(requiredEnvironment('INVENTORY_OPS_CLOUD_URL'))
  accessHeaders()
  const workspaceRoot = resolveWorkspaceRoot(import.meta.url)
  const release = loadLatestCompletedRelease({ workspaceRoot })
  if (release.sourceRuns?.public?.status !== 'current' || release.sourceRuns?.dealerMail?.status !== 'current') {
    throw new Error('Refusing to publish because the public or DealerMail source is not current')
  }

  const envelope = encryptBundle(cloudReleaseFrom(release), base64Key(requiredEnvironment('INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64')))
  const payload = await publishEnvelope(envelope)
  // This output is intentionally limited to publish state and report date. It
  // never contains credentials, source data, customer details, or raw notes.
  process.stdout.write(`${payload.status}: ${payload.reportDate}\n`)
}

export function publisherFailureMessage(error) {
  if (error?.message === 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN') {
    const bundleSha256 = typeof error.bundleSha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(error.bundleSha256)
      ? error.bundleSha256.toLowerCase()
      : null
    const candidate = bundleSha256 ? ` candidate_bundle_sha256=${bundleSha256}.` : ''
    return `Cloud release publication outcome is unknown: CLOUD_PUBLICATION_OUTCOME_UNKNOWN.${candidate} Reconcile the exact candidate before another publication attempt.`
  }
  return `Cloud release was not published: ${error.message}`
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${publisherFailureMessage(error)}\n`)
    process.exitCode = 1
  })
}
