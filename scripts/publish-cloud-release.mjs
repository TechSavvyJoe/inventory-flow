import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadLatestCompletedRelease } from '../server/importer.mjs'
import { RELEASE_FORMAT, validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_WORKSPACE_ROOT = path.resolve(APP_ROOT, '..', '..')
const PRIVATE_HOSTNAME = 'inventory-ops.joegallant.me'
const MAX_ENVELOPE_BYTES = 25 * 1024 * 1024

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

// Keep provenance labels and filenames while removing machine-specific path
// prefixes. Restrict this transformation to metadata: exact vehicle/customer
// text and complete raw snapshots are preserved without rewriting their values.
export function portableMetadata(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => portableMetadata(item, parentKey))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portableMetadata(item, key)]))
  if (typeof value === 'string' && /(?:path|paths)$/i.test(parentKey) && /^(?:[a-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var)\/)/i.test(value)) {
    return `local-file:${value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)}`
  }
  return value
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
      manifest: portableMetadata(release.manifest),
      warnings: release.warnings ?? [],
      sourceRuns: {
        public: sourceRunForCloud(release.sourceRuns?.public),
        dealerMail: sourceRunForCloud(release.sourceRuns?.dealerMail),
        resources: sourceRunForCloud(release.sourceRuns?.resources),
      },
      publicSnapshot: release.publicSnapshot,
      dealerMailSnapshot: release.dealerMailSnapshot,
      releasedHoldHistory: release.releasedHoldHistory ?? [],
      publicChangeEvents: release.publicChangeEvents ?? [],
      vehicles: release.vehicles ?? [],
    },
  }
}

export function encryptBundle(bundle, key) {
  validateReleaseBundle(bundle)
  const plaintext = Buffer.from(canonicalJson(bundle), 'utf8')
  const bundleSha256 = sha256(plaintext)
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

export async function publishEnvelope(envelope, { environment = process.env, fetchImpl = fetch } = {}) {
  const endpoint = publicationEndpoint(requiredEnvironment('INVENTORY_OPS_CLOUD_URL', environment))
  const body = JSON.stringify(envelope)
  if (Buffer.byteLength(body, 'utf8') > MAX_ENVELOPE_BYTES) throw new Error('Encrypted release exceeds the permitted upload size')
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
    headers: {
      Authorization: `Bearer ${requiredEnvironment('INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN', environment)}`,
      'Content-Type': 'application/json',
      ...accessHeaders(environment),
    },
    body,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const code = typeof payload?.code === 'string' && /^[A-Z0-9_]+$/.test(payload.code) ? `: ${payload.code}` : ''
    throw new Error(`Cloud release publish failed (${response.status}${code})`)
  }
  if (!payload || !['published', 'already_published'].includes(payload.status) || payload.reportDate !== envelope.reportDate) throw new Error('Cloud release response did not confirm the expected report date and publication status')
  return { status: payload.status, reportDate: payload.reportDate }
}

export async function main() {
  publicationEndpoint(requiredEnvironment('INVENTORY_OPS_CLOUD_URL'))
  accessHeaders()
  const workspaceRoot = path.resolve(process.env.INVENTORY_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT)
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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Cloud release was not published: ${error.message}\n`)
    process.exitCode = 1
  })
}
