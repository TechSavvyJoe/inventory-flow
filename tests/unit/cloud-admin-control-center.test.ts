// @ts-nocheck -- exercises the plain ESM Worker with real signed Access JWTs.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import worker from '../../cloudflare/src/worker.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'

const host = 'synthetic-admin.inventory.invalid'
const issuer = 'https://synthetic-admin.cloudflareaccess.com'
const audience = 'synthetic-admin-employees'
const databases = []
const encryptionKey = Buffer.alloc(32, 23)
let privateKey
let envelope
let serializedEnvelope
let bundle

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  jwk.kid = 'synthetic-admin-key'
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`)
    return Response.json({ keys: [jwk] })
  }))
  bundle = buildSyntheticCloudBundle()
  envelope = encryptBundle(bundle, encryptionKey)
  serializedEnvelope = JSON.stringify(envelope)
})

afterAll(() => vi.unstubAllGlobals())
afterEach(() => {
  while (databases.length) databases.pop().close()
})

async function token(email, overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    iss: issuer, aud: audience, sub: `subject:${email}`, email, iat: now, exp: now + 3600,
    role: 'sales', store: 'Howell', ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-admin-key' }).sign(privateKey)
}

function request(path, jwt, options = {}) {
  return new Request(`https://${host}${path}`, {
    ...options,
    headers: {
      'cf-access-jwt-assertion': jwt,
      // These would be privileged if the Worker trusted browser headers.
      'x-inventory-authenticated-role': 'group_manager',
      'x-inventory-authenticated-store': 'Lincoln',
      ...options.headers,
    },
  })
}

function harness() {
  const database = new DatabaseSync(':memory:')
  databases.push(database)
  applySyntheticSchema(database)
  const insertMember = database.prepare(
    'INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,?)',
  )
  insertMember.run('group@example.invalid', 'group-1', 'Synthetic Group Manager', 'group_manager', 'Lincoln', 1)
  insertMember.run('manager@example.invalid', 'manager-1', 'Synthetic Store Manager', 'manager', 'Howell', 1)
  insertMember.run('former@example.invalid', 'driver-disabled', 'Synthetic Former Driver', 'driver', 'Ford Detroit', 0)
  database.prepare(`
    INSERT INTO cloud_release_versions (
      release_id,report_date,bundle_sha256,object_key,object_bytes,
      public_source_sha256,dealermail_source_sha256,public_row_count,dealermail_row_count,
      status,published_at,metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,'current',?,?)
  `).run(
    'synthetic-admin-release', envelope.reportDate, envelope.bundleSha256, 'releases/synthetic-admin.enc',
    Buffer.byteLength(serializedEnvelope), bundle.release.sourceRuns.public.sha256,
    bundle.release.sourceRuns.dealerMail.sha256, bundle.release.sourceRuns.public.rowCount,
    bundle.release.sourceRuns.dealerMail.rowCount, '2026-09-15T12:00:00.000Z', '{}',
  )
  database.prepare("INSERT INTO cloud_release_state (key,value,updated_at) VALUES ('current_release_id',?,?)")
    .run('synthetic-admin-release', '2026-09-15T12:00:00.000Z')

  const baseD1 = sqliteD1(database)
  const prepare = vi.fn((sql) => baseD1.prepare(sql))
  const env = {
    PRIVATE_HOSTNAME: host,
    ACCESS_ISSUER: issuer,
    ACCESS_AUDIENCE: audience,
    RELEASE_ENCRYPTION_KEY_BASE64: encryptionKey.toString('base64'),
    INVENTORY_DB: { ...baseD1, prepare },
    RELEASE_SNAPSHOTS: {
      async get(key) {
        expect(key).toBe('releases/synthetic-admin.enc')
        return { size: Buffer.byteLength(serializedEnvelope), text: async () => serializedEnvelope }
      },
    },
  }
  return { database, env, prepare }
}

function adminDirectoryQueries(prepare) {
  return prepare.mock.calls.map(([sql]) => sql).filter((sql) => /SELECT\s+user_id,\s*name,\s*role,\s*home_store,\s*enabled/i.test(sql))
}

describe('Cloudflare Admin Control Center route', () => {
  it('uses the D1 membership as identity and returns only the explicit directory projection', async () => {
    const { database, env, prepare } = harness()
    const jwt = await token('group@example.invalid', { role: 'driver', store: 'Unknown' })
    const response = await worker.fetch(request('/api/admin/overview?role=sales&store=Howell&token=not-returned', jwt), env)
    expect(response.status).toBe(200)
    const overview = await response.json()
    expect(overview.readOnly).toBe(true)
    expect(overview.people).toHaveLength(3)
    expect(overview.people.find((person) => person.id === 'group-1')).toMatchObject({
      role: 'group_manager', storeAccess: ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'], status: 'active', lastActiveAt: null,
    })
    expect(overview.people.find((person) => person.id === 'driver-disabled')).toMatchObject({ status: 'disabled' })
    expect(overview.feeds).toHaveLength(4)
    expect(Array.isArray(overview.audit)).toBe(true)
    expect(Object.keys(overview.summary).sort()).toEqual(['activeUsers', 'connectedStores', 'feedsCurrent', 'lastVerifiedAt'])

    const queries = adminDirectoryQueries(prepare)
    expect(queries).toHaveLength(1)
    expect(queries[0].replace(/\s+/g, ' ').trim()).toBe(
      'SELECT user_id, name, role, home_store, enabled FROM cloud_memberships ORDER BY name COLLATE NOCASE, user_id',
    )
    expect(queries[0]).not.toMatch(/email|token|created_at|updated_at/i)
    expect(JSON.stringify(overview)).not.toMatch(/group@example|manager@example|former@example|not-returned|token/i)
    expect(database.prepare('SELECT revision FROM cloud_app_revision WHERE id=1').get().revision).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM attention_events').get().count).toBe(0)
  })

  it('authorizes from D1 before the directory/release read and keeps the route GET-only', async () => {
    const { env, prepare } = harness()
    const managerJwt = await token('manager@example.invalid', { role: 'group_manager', store: 'Lincoln' })
    const denied = await worker.fetch(request('/api/admin/overview', managerJwt), env)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'ADMIN_OVERVIEW_ACCESS_REQUIRED' })
    expect(adminDirectoryQueries(prepare)).toHaveLength(0)
    expect(prepare.mock.calls.some(([sql]) => sql.includes('cloud_release_versions'))).toBe(false)

    prepare.mockClear()
    const groupJwt = await token('group@example.invalid')
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await worker.fetch(request('/api/admin/overview', groupJwt, { method }), env)
      expect(response.status, method).toBe(405)
      expect(await response.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    }
    expect(adminDirectoryQueries(prepare)).toHaveLength(0)
    expect(prepare.mock.calls.some(([sql]) => sql.includes('cloud_release_versions'))).toBe(false)
  })

  it('fails closed and sanitizes a D1 directory failure before reading the release', async () => {
    const { env } = harness()
    const originalPrepare = env.INVENTORY_DB.prepare
    env.INVENTORY_DB.prepare = (sql) => {
      if (/SELECT\s+user_id,\s*name,\s*role,\s*home_store,\s*enabled/i.test(sql)) {
        return { async all() { throw new Error('SYNTHETIC_PRIVATE_D1_DETAIL') } }
      }
      return originalPrepare(sql)
    }
    const response = await worker.fetch(request('/api/admin/overview', await token('group@example.invalid')), env)
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).toContain('ADMIN_DIRECTORY_UNAVAILABLE')
    expect(text).not.toContain('SYNTHETIC_PRIVATE_D1_DETAIL')
  })
})
