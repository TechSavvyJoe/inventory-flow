import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLatestCompletedRelease } from '../server/importer.mjs'

const RELEASE_FORMAT = 'inventory-flow-private-release-v1'
const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_WORKSPACE_ROOT = path.resolve(APP_ROOT, '..', '..')

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required and must be loaded from the local secret store`)
  return value
}

function base64Key(value) {
  const bytes = Buffer.from(String(value).trim(), 'base64')
  if (bytes.length !== 32) throw new Error('INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes')
  return bytes
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sourceRunForCloud(source) {
  if (!source) return null
  return {
    type: source.type,
    reportDate: source.reportDate,
    extractedAt: source.extractedAt ?? null,
    sha256: source.sha256,
    bytes: source.bytes,
    schemaVersion: source.schemaVersion,
    status: source.status,
    staleReason: source.staleReason ?? null,
    rowCount: source.rowCount,
    metadata: source.metadata ?? {},
  }
}

function cloudReleaseFrom(release) {
  return {
    schemaVersion: RELEASE_FORMAT,
    complete: true,
    reportDate: release.reportDate,
    createdAt: new Date().toISOString(),
    release: {
      reportDate: release.reportDate,
      timezone: release.timezone,
      completedAt: release.completedAt,
      // The cloud release must never contain computer-specific manifest or
      // snapshot paths. The full normalized evidence stays encrypted below.
      manifest: {
        report_date: release.manifest?.report_date,
        completed_at: release.manifest?.completed_at ?? null,
        complete: release.manifest?.complete === true,
        slicer_status: release.manifest?.slicer_status ?? null,
      },
      warnings: release.warnings ?? [],
      sourceRuns: {
        public: sourceRunForCloud(release.sourceRuns?.public),
        dealerMail: sourceRunForCloud(release.sourceRuns?.dealerMail),
        resources: sourceRunForCloud(release.sourceRuns?.resources),
      },
      publicSnapshot: release.publicSnapshot,
      dealerMailSnapshot: release.dealerMailSnapshot,
      publicChangeEvents: release.publicChangeEvents ?? [],
      vehicles: release.vehicles ?? [],
    },
  }
}

function encryptBundle(bundle, key) {
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8')
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

function accessHeaders() {
  const clientId = process.env.CF_ACCESS_CLIENT_ID
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together')
  }
  return clientId
    ? { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret }
    : {}
}

async function main() {
  const cloudUrl = new URL(requiredEnvironment('INVENTORY_OPS_CLOUD_URL'))
  if (cloudUrl.protocol !== 'https:') throw new Error('INVENTORY_OPS_CLOUD_URL must use HTTPS')
  const workspaceRoot = path.resolve(process.env.INVENTORY_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT)
  const release = loadLatestCompletedRelease({ workspaceRoot })
  if (release.sourceRuns?.public?.status !== 'current' || release.sourceRuns?.dealerMail?.status !== 'current') {
    throw new Error('Refusing to publish because the public or DealerMail source is not current')
  }

  const envelope = encryptBundle(cloudReleaseFrom(release), base64Key(requiredEnvironment('INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64')))
  const endpoint = new URL('/internal/releases', cloudUrl)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnvironment('INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN')}`,
      'Content-Type': 'application/json',
      ...accessHeaders(),
    },
    body: JSON.stringify(envelope),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Cloud release publish failed (${response.status}): ${payload?.error ?? 'unknown error'}`)
  // This output is intentionally limited to publish state and report date. It
  // never contains credentials, source data, customer details, or raw notes.
  process.stdout.write(`${payload.status}: ${payload.reportDate}\n`)
}

main().catch((error) => {
  process.stderr.write(`Cloud release was not published: ${error.message}\n`)
  process.exitCode = 1
})
