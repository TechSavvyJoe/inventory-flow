// @ts-nocheck -- real signed JWT and SQL membership checks; fabricated identities only.
// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { memberContext, verifyAccess } from '../../cloudflare/src/access.mjs'
import worker from '../../cloudflare/src/worker.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'

const issuer = 'https://synthetic-revocation.cloudflareaccess.com'
const audience = 'synthetic-revocation-employees'
let signing, otherSigning
const databases = []
beforeAll(async () => {
  signing = await generateKeyPair('RS256'); otherSigning = await generateKeyPair('RS256')
  const key = await exportJWK(signing.publicKey); key.kid = 'synthetic-revocation'
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`)
    return Response.json({ keys: [key] })
  }))
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => { for (const database of databases.splice(0)) database.close() })
async function token(overrides = {}, key = signing.privateKey) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ iss: issuer, aud: audience, sub: 'synthetic-subject', email: 'synthetic@example.invalid', iat: now, exp: now + 3600, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-revocation' }).sign(key)
}
function request(jwt) { return new Request('https://synthetic.invalid/api/health', { headers: { 'cf-access-jwt-assertion': jwt, 'x-inventory-authenticated-role': 'group_manager', 'x-inventory-authenticated-store': 'Lincoln' } }) }
function harness() {
  const database = new DatabaseSync(':memory:'); databases.push(database)
  applySyntheticSchema(database)
  database.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)').run('synthetic@example.invalid', 'synthetic-user', 'Synthetic manager', 'manager', 'Howell')
  return { database, env: { PRIVATE_HOSTNAME: 'synthetic.invalid', ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: audience, INVENTORY_DB: sqliteD1(database) } }
}
describe('session and employee revocation boundary', () => {
  it.each(['iss', 'aud', 'sub', 'exp', 'iat'])('rejects a signed token missing required claim %s', async (claim) => {
    const { env } = harness()
    await expect(verifyAccess(request(await token({ [claim]: undefined })), env)).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID', status: 401 })
  })
  it('rejects a correctly shaped token signed by another key', async () => {
    const { env } = harness()
    await expect(verifyAccess(request(await token({}, otherSigning.privateKey)), env)).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID' })
  })
  it('blocks service-token identity from employee membership even with the employee audience', async () => {
    const { env } = harness()
    expect((await worker.fetch(request(await token({ common_name: 'synthetic-service' })), env)).status).toBe(403)
  })
  it('revokes a previously valid session immediately on membership disable and deletion', async () => {
    const { database, env } = harness()
    const jwt = await token()
    expect((await worker.fetch(request(jwt), env)).status).toBe(200)
    database.exec('UPDATE cloud_memberships SET enabled=0')
    expect((await worker.fetch(request(jwt), env)).status).toBe(403)
    database.exec('UPDATE cloud_memberships SET enabled=1')
    expect((await worker.fetch(request(jwt), env)).status).toBe(200)
    database.exec('DELETE FROM cloud_memberships')
    expect((await worker.fetch(request(jwt), env)).status).toBe(403)
  })
  it('applies server-side role/store changes on the next request while ignoring old claims and forged headers', async () => {
    const { database, env } = harness()
    const jwt = await token({ role: 'group_manager', store: 'Lincoln' })
    const current = async () => memberContext(await verifyAccess(request(jwt), env), env)
    expect(await current()).toMatchObject({ role: 'manager', store: 'Howell', userId: 'synthetic-user', canPreviewRoles: false })
    database.exec("UPDATE cloud_memberships SET role='sales',home_store='Fowlerville'")
    expect(await current()).toMatchObject({ role: 'sales', store: 'Fowlerville', userId: 'synthetic-user', canPreviewRoles: false })
  })
})
