// @ts-nocheck -- exercises the JavaScript worker against real SQLite and signed synthetic JWTs.
// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { authenticateIntegration, auditIntegrationAccess, consumeIntegrationQuota, hashIntegrationToken, parseIntegrationToken } from '../../cloudflare/src/integration-access.mjs'

const clientId = '1'.repeat(32)
const apiToken = `iflow_${clientId}_${'a'.repeat(43)}`
const oauthClientId = '2'.repeat(32)
const issuer = 'https://synthetic-integration-access.cloudflareaccess.com'
const audience = 'synthetic-dedicated-integration-audience'
const databases = []
let signing, otherSigning
beforeAll(async () => {
  signing = await generateKeyPair('RS256')
  otherSigning = await generateKeyPair('RS256')
  const key = await exportJWK(signing.publicKey)
  key.kid = 'synthetic-integrations'
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`)
    return Response.json({ keys: [key] })
  }))
})
afterEach(() => { for (const database of databases.splice(0)) database.close() })
afterAll(() => vi.unstubAllGlobals())

function sqliteD1(db) {
  return {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this }, async first() { return db.prepare(sql).get(...this.values) ?? null } }
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ sql, values }) => ({ success: true, meta: { changes: db.prepare(sql).run(...values).changes } }))
        db.exec('COMMIT')
        return results
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
}

async function harness() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE cloud_memberships (email TEXT PRIMARY KEY COLLATE NOCASE, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, home_store TEXT NOT NULL, enabled INTEGER NOT NULL);
    INSERT INTO cloud_memberships VALUES ('synthetic@example.invalid', 'synthetic-user', 'Synthetic manager', 'manager', 'Howell', 1);`)
  db.exec(readFileSync(new URL('../../cloudflare/migrations/0004_integrations.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('../../cloudflare/migrations/0006_integration_audit_per_client.sql', import.meta.url), 'utf8'))
  const now = new Date().toISOString(), expires = new Date(Date.now() + 86400000).toISOString()
  const addGrant = async (type = 'api_token', id = clientId) => {
    db.prepare('INSERT INTO integration_clients (client_id,label,auth_type,owner_user_id,token_sha256,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, 'Synthetic integration', type, 'synthetic-user', type === 'api_token' ? await hashIntegrationToken(apiToken) : null,
      '["inventory.read","health.read"]', '["Howell","Lincoln"]', 3, 1, expires, now, now,
    )
  }
  await addGrant()
  return { db, addGrant, env: { INVENTORY_DB: sqliteD1(db), INTEGRATIONS_ENABLED: 'true', INTEGRATION_HOSTNAME: 'synthetic-integration.invalid', ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: 'synthetic-browser-audience', ACCESS_PUBLISHER_AUDIENCE: 'synthetic-publisher-audience', INTEGRATION_MANAGED_OAUTH_ENABLED: 'true', INTEGRATION_ACCESS_AUDIENCE: audience } }
}

function request(token = apiToken, headers = {}, url = 'https://synthetic-integration.invalid/api/v1/inventory') {
  return new Request(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } })
}

async function assertion(overrides = {}, key = signing.privateKey) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ iss: issuer, aud: audience, sub: 'synthetic-subject', email: 'synthetic@example.invalid', iat: now, exp: now + 900, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-integrations' }).sign(key)
}

describe('dedicated read-only integration credentials', () => {
  it('returns only server-owned grants and current employee identity', async () => {
    const { env } = await harness()
    const principal = await authenticateIntegration(request(apiToken, { 'x-inventory-authenticated-role': 'group_manager', 'x-inventory-authenticated-store': 'Fowlerville', 'x-integration-scopes': '*' }), env)
    expect(principal).toEqual({ clientId, grantType: 'api_token', userId: 'synthetic-user', role: 'manager', stores: ['Howell', 'Lincoln'], scopes: ['inventory.read', 'health.read'], user: 'Synthetic manager', store: 'Howell', authenticated: true, canPreviewRoles: false, rateLimitPerMinute: 3 })
    expect(Object.isFrozen(principal)).toBe(true)
    expect(Object.isFrozen(principal.scopes)).toBe(true)
    expect(JSON.stringify(principal)).not.toContain(apiToken)
  })

  it('stores only a full-token SHA-256 digest, never a token or its secret', async () => {
    const { db } = await harness()
    const rows = db.prepare('SELECT * FROM integration_clients').all()
    expect(rows[0].token_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(rows)).not.toContain(apiToken)
    expect(JSON.stringify(rows)).not.toContain('a'.repeat(43))
    expect(parseIntegrationToken(apiToken)).toEqual({ clientId })
    expect(() => db.exec('UPDATE integration_clients SET token_sha256=NULL')).toThrow(/CHECK/)
    expect(() => db.prepare('UPDATE integration_clients SET token_sha256=?').run('z'.repeat(64))).toThrow(/CHECK/)
  })

  it.each([null, 'not-an-app-token', `iflow_${clientId}_${'b'.repeat(43)}`, `iflow_${'f'.repeat(32)}_${'a'.repeat(43)}`, 'eyJhbGciOiJSUzI1NiJ9.example.signature', 'oauth:short'])('rejects missing, forged, or other credential types (%s)', async (token) => {
    const { env } = await harness()
    await expect(authenticateIntegration(request(token), env)).rejects.toMatchObject({ status: 401 })
  })

  it('never accepts a cookie, browser assertion, or publisher secret as an API credential', async () => {
    const { env } = await harness()
    await expect(authenticateIntegration(request(null, { Cookie: `CF_Authorization=${apiToken}`, 'cf-access-jwt-assertion': await assertion(), 'cf-access-client-secret': apiToken }), env)).rejects.toMatchObject({ status: 401 })
  })

  it.each(['token', 'access_token', 'api_key', 'apikey', 'Authorization'])('rejects query-string credential %s even with valid Authorization', async (key) => {
    const { env } = await harness()
    await expect(authenticateIntegration(request(apiToken, {}, `https://synthetic-integration.invalid/api/v1/inventory?${key}=redacted`), env)).rejects.toMatchObject({ status: 400 })
  })

  it.each(['http://synthetic-integration.invalid/api/v1/inventory', 'https://other.invalid/api/v1/inventory', 'https://synthetic-integration.invalid:4433/api/v1/inventory'])('rejects a wrong transport or host', async (url) => {
    const { env } = await harness()
    await expect(authenticateIntegration(request(apiToken, {}, url), env)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['enabled=0', "revoked_at='2026-01-01T00:00:00Z'", "expires_at='2000-01-01T00:00:00Z'", "expires_at='not-a-date'"])('immediately enforces revoked/expired grant: %s', async (assignment) => {
    const { env, db } = await harness()
    await authenticateIntegration(request(), env)
    db.exec(`UPDATE integration_clients SET ${assignment}`)
    await expect(authenticateIntegration(request(), env)).rejects.toMatchObject({ status: 403 })
  })

  it('immediately enforces current owner role, store, enabled state and existence', async () => {
    const { env, db } = await harness()
    db.exec("UPDATE cloud_memberships SET role='sales',home_store='Fowlerville'")
    expect(await authenticateIntegration(request(), env)).toMatchObject({ role: 'sales', store: 'Fowlerville' })
    db.exec('UPDATE cloud_memberships SET enabled=0')
    await expect(authenticateIntegration(request(), env)).rejects.toMatchObject({ status: 403 })
    db.exec("UPDATE cloud_memberships SET enabled=1,role='driver'")
    await expect(authenticateIntegration(request(), env)).rejects.toMatchObject({ status: 403 })
    db.exec('PRAGMA foreign_keys=OFF; DELETE FROM cloud_memberships')
    await expect(authenticateIntegration(request(), env)).rejects.toMatchObject({ status: 401 })
  })

  it.each(['[]', '["*"]', '["private.read"]', '["inventory.read","inventory.read"]', '["inventory.read",1]'])('rejects empty, unknown or malformed scopes %s', async (scopes) => {
    const { env, db } = await harness()
    db.prepare('UPDATE integration_clients SET scopes_json=?').run(scopes)
    await expect(authenticateIntegration(request(), env)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['[]', '["*"]', '["Detroit"]', '["Howell","Howell"]'])('rejects invalid store allowlists %s', async (stores) => {
    const { env, db } = await harness()
    db.prepare('UPDATE integration_clients SET stores_json=?').run(stores)
    await expect(authenticateIntegration(request(), env)).rejects.toMatchObject({ status: 403 })
  })

  it('fails closed if disabled, unconfigured, or the grant lookup fails', async () => {
    const { env } = await harness()
    await expect(authenticateIntegration(request(), { ...env, INTEGRATIONS_ENABLED: 'false' })).rejects.toMatchObject({ status: 503 })
    await expect(authenticateIntegration(request(), { ...env, INTEGRATION_HOSTNAME: undefined })).rejects.toMatchObject({ status: 503 })
    await expect(authenticateIntegration(request(), { ...env, INVENTORY_DB: { batch() {}, prepare() { throw new Error('Do not echo database details') } } })).rejects.toMatchObject({ code: 'INTEGRATION_AUTH_UNAVAILABLE', status: 503 })
  })
})

describe('Cloudflare Managed OAuth employee grants', () => {
  const opaque = `oauth:${'o'.repeat(48)}`
  it('validates the dedicated Access assertion and maps to exactly one server-owned employee grant', async () => {
    const { env, addGrant } = await harness()
    await addGrant('access_oauth', oauthClientId)
    const current = await authenticateIntegration(request(opaque, { 'cf-access-jwt-assertion': await assertion({ scopes: ['private.read'], role: 'group_manager', store: 'Lincoln', client_id: 'untrusted-client' }) }), env)
    expect(current).toMatchObject({ clientId: oauthClientId, grantType: 'access_oauth', role: 'manager', store: 'Howell', scopes: ['inventory.read', 'health.read'] })
  })

  it('requires both the opaque bearer and the edge-signed assertion', async () => {
    const { env, addGrant } = await harness()
    await addGrant('access_oauth', oauthClientId)
    await expect(authenticateIntegration(request(opaque), env)).rejects.toMatchObject({ status: 401 })
    await expect(authenticateIntegration(request(null, { 'cf-access-jwt-assertion': await assertion() }), env)).rejects.toMatchObject({ status: 401 })
    await expect(authenticateIntegration(request(await assertion()), env)).rejects.toMatchObject({ status: 401 })
  })

  it.each(['synthetic-browser-audience', 'synthetic-publisher-audience'])('rejects browser/publisher assertion audience %s', async (aud) => {
    const { env, addGrant } = await harness()
    await addGrant('access_oauth', oauthClientId)
    await expect(authenticateIntegration(request(opaque, { 'cf-access-jwt-assertion': await assertion({ aud }) }), env)).rejects.toMatchObject({ status: 401 })
    await expect(authenticateIntegration(request(opaque, { 'cf-access-jwt-assertion': await assertion({ aud }) }), { ...env, INTEGRATION_ACCESS_AUDIENCE: aud })).rejects.toMatchObject({ status: 503 })
  })

  it.each(['iss', 'aud', 'exp', 'iat', 'sub'])('rejects an assertion missing %s', async (claim) => {
    const { env, addGrant } = await harness()
    await addGrant('access_oauth', oauthClientId)
    await expect(authenticateIntegration(request(opaque, { 'cf-access-jwt-assertion': await assertion({ [claim]: undefined }) }), env)).rejects.toMatchObject({ status: 401 })
  })

  it('rejects invalid signatures, expiration, future issuance and service identities', async () => {
    const { env, addGrant } = await harness()
    await addGrant('access_oauth', oauthClientId)
    await expect(authenticateIntegration(request(opaque, { 'cf-access-jwt-assertion': await assertion({}, otherSigning.privateKey) }), env)).rejects.toMatchObject({ status: 401 })
    for (const claims of [{ exp: 1 }, { iat: Math.floor(Date.now() / 1000) + 3600 }, { common_name: 'synthetic-service' }, { email: undefined }]) {
      await expect(authenticateIntegration(request(opaque, { 'cf-access-jwt-assertion': await assertion(claims) }), env)).rejects.toMatchObject({ status: expect.any(Number) })
    }
  })

  it('requires a current explicit OAuth grant and rejects duplicate OAuth grants for an employee', async () => {
    const { env, addGrant, db } = await harness()
    const incoming = request(opaque, { 'cf-access-jwt-assertion': await assertion() })
    await expect(authenticateIntegration(incoming, env)).rejects.toMatchObject({ status: 403 })
    await addGrant('access_oauth', oauthClientId)
    await authenticateIntegration(incoming, env)
    await expect(addGrant('access_oauth', '3'.repeat(32))).rejects.toThrow(/UNIQUE/)
    db.exec('UPDATE cloud_memberships SET enabled=0')
    await expect(authenticateIntegration(incoming, env)).rejects.toMatchObject({ status: 403 })
  })

  it('uses the replacement OAuth grant after revocation without selecting old history', async () => {
    const { env, addGrant, db } = await harness()
    const incoming = request(opaque, { 'cf-access-jwt-assertion': await assertion() })
    await addGrant('access_oauth', oauthClientId)
    db.prepare('UPDATE integration_clients SET enabled=0,revoked_at=? WHERE client_id=?').run(new Date().toISOString(), oauthClientId)
    await addGrant('access_oauth', '3'.repeat(32))
    expect(await authenticateIntegration(incoming, env)).toMatchObject({ clientId: '3'.repeat(32), grantType: 'access_oauth' })
  })
})

describe('integration quota and privacy-preserving audit', () => {
  it('atomically admits only the allowed requests, resets next minute, and does not roll back its window', async () => {
    const { env, db } = await harness()
    const principal = await authenticateIntegration(request(), env)
    const now = 1800000000010
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => consumeIntegrationQuota(env, principal, now)))
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(3)
    expect(attempts.filter((item) => item.status === 'rejected').every((item) => item.reason.status === 429)).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM integration_rate_windows').get().count).toBe(1)
    expect(await consumeIntegrationQuota(env, principal, now + 60000)).toMatchObject({ remaining: 2, limit: 3 })
    await expect(consumeIntegrationQuota(env, principal, now)).rejects.toMatchObject({ status: 429 })
  })

  it('rejects quota storage failure rather than allowing unmetered access', async () => {
    const { env } = await harness()
    const principal = await authenticateIntegration(request(), env)
    await expect(consumeIntegrationQuota({ INVENTORY_DB: { prepare() { throw new Error('private debug data') } } }, principal)).rejects.toMatchObject({ code: 'INTEGRATION_QUOTA_UNAVAILABLE', status: 503 })
    await expect(consumeIntegrationQuota({ INVENTORY_DB: { prepare() { return { bind() { return this }, async first() { return {} } } } } }, principal)).rejects.toMatchObject({ code: 'INTEGRATION_QUOTA_UNAVAILABLE', status: 503 })
  })

  it('logs only bounded metadata and caps retention to 30 days and 10,000 rows', async () => {
    const { env, db } = await harness()
    const principal = await authenticateIntegration(request(), env)
    const now = Date.now()
    const insert = db.prepare('INSERT INTO integration_access_audit (client_id,operation,status,result_count,occurred_at) VALUES (?, ?, ?, ?, ?)')
    db.exec('BEGIN')
    insert.run(clientId, 'health', 200, 0, now - 40 * 86400000)
    for (let index = 0; index < 10005; index++) insert.run(clientId, 'health', 200, 0, now - index)
    db.exec('COMMIT')
    await auditIntegrationAccess(env, principal, { operation: 'inventory_list', status: 200, resultCount: 25, query: 'customer secret', token: apiToken, body: 'never logged' }, now)
    const rows = db.prepare('SELECT * FROM integration_access_audit ORDER BY occurred_at DESC,id DESC').all()
    expect(rows).toHaveLength(10000)
    expect(rows[0]).toMatchObject({ operation: 'inventory_list', status: 200, result_count: 25 })
    expect(Object.keys(rows[0]).sort()).toEqual(['client_id', 'id', 'occurred_at', 'operation', 'result_count', 'status'])
    expect(JSON.stringify(rows)).not.toMatch(/customer secret|never logged|iflow_/)
    await auditIntegrationAccess(env, principal, { operation: 'manager_dispositions_list', status: 200, resultCount: 7, customerName: 'never logged' }, now + 1)
    expect(db.prepare('SELECT operation,result_count FROM integration_access_audit ORDER BY id DESC LIMIT 1').get()).toMatchObject({ operation: 'manager_dispositions_list', result_count: 7 })
    await auditIntegrationAccess(env, principal, { operation: 'user submitted secret', status: 400, resultCount: 100000 }, now + 1)
    expect(db.prepare('SELECT operation,result_count FROM integration_access_audit ORDER BY id DESC LIMIT 1').get()).toMatchObject({ operation: 'other', result_count: 1000 })
  })

  it('does not let one integration\'s rejected requests evict another\'s access history', async () => {
    // Every rejection is audited too, including the 429 a client gets for
    // exceeding its own quota — the one outcome a misbehaving client can
    // produce without limit. Evicting purely by global recency meant that
    // flood pushed out the real read history of every other integration,
    // which is exactly the record an access question needs to answer.
    const { db, env } = await harness()
    const noisyId = '3'.repeat(32), stamp = new Date().toISOString()
    db.prepare('INSERT INTO integration_clients (client_id,label,auth_type,owner_user_id,token_sha256,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(noisyId, 'Noisy integration', 'api_token', 'synthetic-user', await hashIntegrationToken(`iflow_${noisyId}_${'b'.repeat(43)}`), '["inventory.read"]', '["Howell"]', 3, 1, new Date(Date.now() + 86400000).toISOString(), stamp, stamp)
    const principal = await authenticateIntegration(request(), env)
    const now = Date.now()
    const insert = db.prepare('INSERT INTO integration_access_audit (client_id,operation,status,result_count,occurred_at) VALUES (?, ?, ?, ?, ?)')
    db.exec('BEGIN')
    for (let index = 0; index < 40; index++) insert.run(clientId, 'inventory_list', 200, 25, now - 900000 - index)
    for (let index = 0; index < 10000; index++) insert.run(noisyId, 'other', 429, 0, now - index)
    db.exec('COMMIT')

    await auditIntegrationAccess(env, principal, { operation: 'inventory_list', status: 200, resultCount: 25 }, now + 1)

    const remaining = db.prepare('SELECT COUNT(*) AS total FROM integration_access_audit WHERE client_id = ?').get(clientId)
    expect(remaining.total).toBe(41)
  })

  it('fails closed on failed or non-success audit batches', async () => {
    const { env } = await harness()
    const principal = await authenticateIntegration(request(), env)
    for (const batch of [async () => { throw new Error('private debug data') }, async () => [{ success: false }]]) {
      await expect(auditIntegrationAccess({ ...env, INVENTORY_DB: { ...env.INVENTORY_DB, batch } }, principal, { operation: 'health', status: 200 })).rejects.toMatchObject({ status: 503, code: 'INTEGRATION_AUDIT_UNAVAILABLE' })
    }
  })
})
