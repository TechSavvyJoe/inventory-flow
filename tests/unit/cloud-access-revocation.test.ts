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
function request(jwt, previewRole, pathname = '/api/health') {
  const headers = new Headers({ 'cf-access-jwt-assertion': jwt, 'x-inventory-authenticated-role': 'group_manager', 'x-inventory-authenticated-store': 'Lincoln' })
  if (previewRole !== undefined) headers.set('x-inventory-preview-role', previewRole)
  return new Request(`https://synthetic.invalid${pathname}`, { headers })
}
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

  it.each(['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver'])('lets a verified group manager preview %s without changing stored identity', async (role) => {
    const { database, env } = harness()
    database.exec("UPDATE cloud_memberships SET role='group_manager'")
    const req = request(await token({ role: 'sales', store: 'Lincoln' }), role)
    const context = await memberContext(await verifyAccess(req, env), env, req)
    expect(context).toMatchObject({
      role, authenticatedRole: 'group_manager', canPreviewRoles: true,
      rolePreviewActive: role !== 'group_manager', store: 'Howell', userId: 'synthetic-user', user: 'Synthetic manager',
      allowLegacyTransportAssignmentByName: false,
    })
    expect(database.prepare('SELECT role,home_store FROM cloud_memberships').get()).toMatchObject({ role: 'group_manager', home_store: 'Howell' })
    const restored = request(req.headers.get('cf-access-jwt-assertion'))
    expect(await memberContext(await verifyAccess(restored, env), env, restored)).toMatchObject({ role: 'group_manager', rolePreviewActive: false })
  })

  it.each(['sales', 'manager', 'coordinator', 'porter', 'driver'])('ignores preview headers for authenticated %s members', async (role) => {
    const { database, env } = harness()
    database.prepare('UPDATE cloud_memberships SET role=?').run(role)
    const req = request(await token({ role: 'group_manager' }), 'group_manager')
    expect(await memberContext(await verifyAccess(req, env), env, req)).toMatchObject({
      role, authenticatedRole: role, canPreviewRoles: false, rolePreviewActive: false, store: 'Howell',
    })
    const forbidden = await worker.fetch(request(req.headers.get('cf-access-jwt-assertion'), 'group_manager', '/api/admin/overview'), env)
    expect(forbidden.status).toBe(403)
  })

  it('removes preview permission immediately after a membership role change or disable', async () => {
    const { database, env } = harness()
    database.exec("UPDATE cloud_memberships SET role='group_manager'")
    database.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)').run('backup@example.invalid', 'synthetic-backup', 'Synthetic backup manager', 'group_manager', 'Howell')
    const req = request(await token(), 'manager')
    const context = async () => memberContext(await verifyAccess(req, env), env, req)
    expect(await context()).toMatchObject({ role: 'manager', authenticatedRole: 'group_manager', canPreviewRoles: true })
    database.exec("UPDATE cloud_memberships SET role='sales' WHERE email='synthetic@example.invalid'")
    expect(await context()).toMatchObject({ role: 'sales', authenticatedRole: 'sales', canPreviewRoles: false, rolePreviewActive: false })
    database.exec("UPDATE cloud_memberships SET enabled=0 WHERE email='synthetic@example.invalid'")
    await expect(context()).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_AUTHORIZED', status: 403 })
  })

  it('rejects invalid group-manager preview roles and enforces the effective role on admin routes', async () => {
    const { database, env } = harness()
    database.exec("UPDATE cloud_memberships SET role='group_manager'")
    const jwt = await token()
    expect((await worker.fetch(request(jwt, 'administrator'), env)).status).toBe(400)
    expect((await worker.fetch(request(jwt, 'sales', '/api/admin/overview'), env)).status).toBe(403)
    expect((await worker.fetch(request(jwt, 'sales', '/api/admin/members'), env)).status).toBe(403)
    expect((await worker.fetch(request(jwt, 'group_manager'), env)).status).toBe(200)
  })
})
