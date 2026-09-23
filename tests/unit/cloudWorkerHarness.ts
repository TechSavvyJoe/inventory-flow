// @ts-nocheck -- drives the plain ESM Worker with real signed Access JWTs.
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// Shared by the Worker write-surface and write-identity tests: a real D1
// schema on node:sqlite, the encrypted synthetic release in a stub R2, and
// fabricated Access members. Call createCloudWorkerHarness() in beforeAll.
import { DatabaseSync } from 'node:sqlite'
import { expect, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import worker from '../../cloudflare/src/worker.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'

export const CLOUD_HOST = 'synthetic-writes.inventory.invalid'
const issuer = 'https://synthetic-writes.cloudflareaccess.com'
const audience = 'synthetic-writes-employees'
const objectKey = 'releases/synthetic-writes.enc'

// One signing key per test file: the Worker caches the issuer's public keys,
// so a fresh key per harness would fail signature checks after the first.
let signingKey
function signing() {
  signingKey ??= (async () => {
    const pair = await generateKeyPair('RS256')
    const jwk = await exportJWK(pair.publicKey)
    jwk.kid = 'synthetic-writes-key'
    return { privateKey: pair.privateKey, jwk }
  })()
  return signingKey
}

export async function createCloudWorkerHarness(members) {
  const { privateKey, jwk } = await signing()
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`)
    return Response.json({ keys: [jwk] })
  }))
  const encryptionKey = Buffer.alloc(32, 31)
  const bundle = buildSyntheticCloudBundle()
  const envelope = encryptBundle(bundle, encryptionKey)
  const serialized = JSON.stringify(envelope)

  const database = new DatabaseSync(':memory:')
  applySyntheticSchema(database)
  const insertMember = database.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)')
  for (const member of members) insertMember.run(member.email, member.userId, member.name, member.role, member.store)
  database.prepare(`
    INSERT INTO cloud_release_versions (
      release_id,report_date,bundle_sha256,object_key,object_bytes,
      public_source_sha256,dealermail_source_sha256,public_row_count,dealermail_row_count,
      status,published_at,metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,'current',?,?)
  `).run(
    'synthetic-writes-release', envelope.reportDate, envelope.bundleSha256, objectKey, Buffer.byteLength(serialized),
    bundle.release.sourceRuns.public.sha256, bundle.release.sourceRuns.dealerMail.sha256,
    bundle.release.sourceRuns.public.rowCount, bundle.release.sourceRuns.dealerMail.rowCount,
    '2026-09-15T12:00:00.000Z', '{}',
  )
  database.prepare("INSERT INTO cloud_release_state (key,value,updated_at) VALUES ('current_release_id',?,?)")
    .run('synthetic-writes-release', '2026-09-15T12:00:00.000Z')

  const env = {
    PRIVATE_HOSTNAME: CLOUD_HOST,
    ACCESS_ISSUER: issuer,
    ACCESS_AUDIENCE: audience,
    RELEASE_ENCRYPTION_KEY_BASE64: encryptionKey.toString('base64'),
    INVENTORY_DB: sqliteD1(database),
    RELEASE_SNAPSHOTS: {
      async get(key) {
        expect(key).toBe(objectKey)
        return { size: Buffer.byteLength(serialized), text: async () => serialized }
      },
    },
  }

  async function token(email) {
    const now = Math.floor(Date.now() / 1000)
    // Role/store claims in the token are ignored; the D1 membership decides.
    return new SignJWT({ iss: issuer, aud: audience, sub: `subject:${email}`, email, iat: now, exp: now + 3600, role: 'group_manager', store: 'Lincoln' })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-writes-key' }).sign(privateKey)
  }

  let keys = 0
  async function call(method, path, email, body, headers = {}) {
    const write = !['GET', 'HEAD'].includes(method)
    const request = new Request(`https://${CLOUD_HOST}${path}`, {
      method,
      headers: {
        'cf-access-jwt-assertion': await token(email),
        // Privileged if the Worker trusted browser identity headers; it must not.
        'x-inventory-authenticated-role': 'group_manager',
        'x-inventory-authenticated-store': 'Lincoln',
        'x-inventory-authenticated-user': 'Spoofed Browser User',
        ...(write ? { origin: `https://${CLOUD_HOST}`, 'content-type': 'application/json', 'idempotency-key': `synthetic-write-${++keys}` } : {}),
        ...headers,
      },
      ...(write && body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const response = await worker.fetch(request, env)
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { json = null }
    return { status: response.status, json }
  }

  return {
    env, database, bundle, call,
    revision: () => database.prepare('SELECT revision FROM cloud_app_revision WHERE id=1').get().revision,
    count: (table) => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    close: () => { database.close(); vi.unstubAllGlobals() },
  }
}
