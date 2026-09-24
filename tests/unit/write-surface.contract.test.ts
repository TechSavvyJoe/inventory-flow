// PRODUCT-RULE TEST
// @ts-nocheck -- drives the plain ESM Worker and Node demo server; fabricated identities only.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
//
// The write surface is a contract. Sources (DealerMail, public inventory, CDK,
// AutoCheck, factory equipment, window stickers) are read-only evidence, so the
// app accepts exactly five employee write branches and nothing else:
//   POST /api/transfers                    create a move request
//   POST /api/transfers/:id/events         record a move event
//   POST /api/attention/:id/events         record an action-center event
//   POST /api/vehicles/:vin/service        record service readiness
//   POST /api/admin/members                edit employee access (group manager)
// plus the three machine-only publisher uploads under /internal/ (Access
// service identity and publisher token): POST /internal/releases,
// POST /internal/invoices/:date/:vin and POST /internal/equipment/:vin/:sha256.
// Adding a write means changing WRITE_BRANCHES here, with Joe's approval.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSyntheticRelease } from '../../fixtures/synthetic-release.mjs'
import { createSyntheticMembershipAdmin } from '../../fixtures/synthetic-membership-admin.mjs'
import { startInventoryServer } from '../../server/index.mjs'
import { createCloudWorkerHarness } from './cloudWorkerHarness'

const root = path.resolve(__dirname, '../..')
const VIN = 'TESTDATAHWELL0001'
const SERVICE_VIN = 'TESTDATAHWELL0002'

// The only branches that may accept a POST, with the actor and a valid payload.
const WRITE_BRANCHES = ['/api/transfers', '/api/transfers/:transfer/events', '/api/attention/:attention/events', '/api/vehicles/:vin/service', '/api/admin/members']

// Every path the app serves, plus write-shaped paths that must never exist.
const READ_PATHS = [
  '/api/health', '/api/bootstrap', '/api/vehicles', '/api/vehicles/:vin', '/api/vehicles/:vin/invoice', '/api/vehicles/:vin/equipment-pdf',
  '/api/transfers/:transfer', '/api/attention', '/api/attention/:attention', '/api/admin/overview', '/',
]
const NEVER_WRITABLE = [
  '/api/vehicles/:vin/hold', '/api/vehicles/:vin/holds', '/api/dealermail/holds', '/api/dealermail/holds/:vin',
  '/api/dealermail/comments', '/api/dealermail/hold/:vin/delete', '/api/cdk/deals', '/api/releases/current',
  '/api/public/inventory', '/api/vehicles/:vin/sticker', '/api/vehicles/:vin/autocheck',
]
const KNOWN_PATHS = [...WRITE_BRANCHES, ...READ_PATHS]
const V1_ALIASES = KNOWN_PATHS.filter((p) => p.startsWith('/api/')).map((p) => p.replace(/^\/api\//, '/api/v1/'))
const OTHER_METHODS = ['PUT', 'PATCH', 'DELETE']
const PROBE = { type: 'note_added', note: 'SYNTHETIC write-surface probe', status: 'held', holdStatus: 'released', vin: VIN, expectedVersion: 0 }

const members = {
  group: { email: 'group@example.invalid', userId: 'group-1', name: 'Synthetic Group Manager', role: 'group_manager', store: 'Lincoln' },
  sales: { email: 'sales@example.invalid', userId: 'sales-1', name: 'Synthetic Fowlerville Salesperson', role: 'sales', store: 'Fowlerville' },
  manager: { email: 'manager@example.invalid', userId: 'manager-1', name: 'Synthetic Fowlerville Manager', role: 'manager', store: 'Fowlerville' },
  howell: { email: 'howell@example.invalid', userId: 'manager-howell-1', name: 'Synthetic Howell Manager', role: 'manager', store: 'Howell' },
}
const transferRequest = { vin: VIN, neededBy: '2026-10-01T18:00:00Z', reason: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS write surface', customerAppointment: true, returnRequired: true, priority: 'normal' }

function fill(template, ids) {
  return template.replace(':vin', VIN).replace(':transfer', ids.transfer).replace(':attention', encodeURIComponent(ids.attention))
}

// Each branch: who writes it and a payload the branch accepts.
function validWrite(branch, ids, revision) {
  switch (branch) {
    case '/api/transfers': return { as: 'sales', path: branch, body: { ...transferRequest, vin: 'TESTDATALNCN00001' } }
    case '/api/transfers/:transfer/events': return { as: 'manager', path: fill(branch, ids), body: { type: 'request_approved', availabilityConfirmed: true } }
    case '/api/attention/:attention/events': return { as: 'group', path: fill(branch, ids), body: { type: 'acknowledge' } }
    case '/api/vehicles/:vin/service': return { as: 'howell', path: branch.replace(':vin', SERVICE_VIN), body: { status: 'needs_service', expectedVersion: 0 } }
    case '/api/admin/members': return { as: 'group', path: branch, body: { email: 'new-member@example.invalid', name: 'Synthetic New Member', role: 'manager', homeStore: 'Howell', enabled: true, reason: 'SYNTHETIC onboarding', expectedRevision: revision } }
    default: throw new Error(`No valid write for ${branch}`)
  }
}

describe('the source pins exactly the documented write branches', () => {
  it('the Worker treats only POST as a write and branches on exactly five employee writes and three publisher uploads', () => {
    const source = readFileSync(path.join(root, 'cloudflare/src/worker.mjs'), 'utf8')
    expect(source).toContain("const read=request.method==='GET', write=request.method==='POST'")
    expect(source).toContain("if(!read && !write) throw new HttpError('METHOD_NOT_ALLOWED',405)")
    expect(source.match(/else if\(write && [^{]+\{/g)).toEqual([
      'else if(write && /^\\/vehicles\\/[^/]+\\/service$/.test(route)) {',
      "else if(write && route==='/transfers') {",
      'else if(write && /^\\/(transfers|attention)\\/[^/]+\\/events$/.test(route)) {',
    ])
    expect(source.match(/await saveMembership\(/g)).toHaveLength(1)
    expect(source.match(/request\.method==='POST' && [^)]+\)/g)).toEqual([
      "request.method==='POST' && invoiceMatch)",
      "request.method==='POST' && equipmentMatch)",
      "request.method==='POST' && url.pathname==='/internal/releases')",
    ])
  })

  it('the Node demo server branches on the same writes', () => {
    const source = readFileSync(path.join(root, 'server/api.mjs'), 'utf8')
    expect(source.match(/request\.method === 'POST' && [^)]+\)/g)).toEqual([
      "request.method === 'POST' && serviceMatch)",
      "request.method === 'POST' && attentionEventMatch)",
      "request.method === 'POST' && route === '/transfers')",
      "request.method === 'POST' && eventMatch)",
    ])
    expect(source.match(/request\.method !== 'POST'/g)).toHaveLength(1)
  })
})

describe('Worker write surface', () => {
  let cloud
  const ids = {}
  const tables = ['transfer_requests', 'transfer_events', 'attention_events', 'vehicle_service_events', 'cloud_memberships', 'cloud_membership_events']
  const snapshot = () => ({ revision: cloud.revision(), ...Object.fromEntries(tables.map((table) => [table, cloud.count(table)])) })

  beforeAll(async () => {
    cloud = await createCloudWorkerHarness(Object.values(members))
    cloud.env.ACCESS_PUBLISHER_AUDIENCE = 'synthetic-writes-publisher'
    const created = await cloud.call('POST', '/api/transfers', members.sales.email, transferRequest)
    expect(created.status).toBe(201)
    ids.transfer = created.json.id
    const attention = await cloud.call('GET', '/api/attention', members.group.email)
    ids.attention = attention.json.items.find((item) => item.allowedActions?.includes('acknowledge'))?.id
    expect(ids.attention).toBeTruthy()
  })
  afterAll(() => cloud.close())

  it.each(OTHER_METHODS.flatMap((method) => [...KNOWN_PATHS, ...V1_ALIASES, ...NEVER_WRITABLE].map((template) => [method, template])))(
    '%s %s answers 405 and changes nothing', async (method, template) => {
      const before = snapshot()
      const response = await cloud.call(method, fill(template, ids), members.group.email, PROBE)
      expect(response.status).toBe(405)
      expect(response.json).toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      expect(snapshot()).toEqual(before)
    })

  it.each([...READ_PATHS, ...NEVER_WRITABLE])('POST %s is rejected and changes nothing', async (template) => {
    const before = snapshot()
    const response = await cloud.call('POST', fill(template, ids), members.group.email, PROBE)
    expect([404, 405]).toContain(response.status)
    expect(snapshot()).toEqual(before)
  })

  it('an employee session reaches no publisher upload route with any method', async () => {
    const before = snapshot()
    for (const method of ['GET', 'POST', ...OTHER_METHODS]) {
      for (const pathname of ['/internal/releases', `/internal/invoices/2026-09-15/${VIN}`, `/internal/equipment/${VIN}/${'a'.repeat(64)}`, '/internal/status', '/internal/readiness']) {
        expect((await cloud.call(method, pathname, members.group.email, PROBE)).status, `${method} ${pathname}`).toBe(401)
      }
    }
    expect(snapshot()).toEqual(before)
  })

  it('accepts POST on exactly the documented write branches', async () => {
    for (const branch of WRITE_BRANCHES) {
      // The membership directory's optimistic lock is the append-only
      // membership-events count, not the generic app revision every other
      // branch uses; see membership-admin.mjs's readMembershipAdmin.
      const write = validWrite(branch, ids, branch === '/api/admin/members' ? cloud.count('cloud_membership_events') : cloud.revision())
      const before = cloud.revision()
      const response = await cloud.call('POST', write.path, members[write.as].email, write.body)
      expect(response.status, `${branch}: ${JSON.stringify(response.json)}`).toBeGreaterThanOrEqual(200)
      expect(response.status, `${branch}: ${JSON.stringify(response.json)}`).toBeLessThan(300)
      expect(cloud.revision(), branch).toBe(before + 1)
    }
  })
})

describe('Node demo server write surface', () => {
  let app
  let baseUrl
  const ids = {}
  const headersFor = (member) => ({ 'x-inventory-demo-role': member.role, 'x-inventory-demo-store': member.store, 'x-inventory-demo-user': member.name })
  const tables = ['transfer_requests', 'transfer_events', 'attention_events', 'vehicle_service_events']
  const snapshot = () => Object.fromEntries(tables.map((table) => [table, app.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))
  let keys = 0
  async function call(method, pathname, member, body) {
    const write = !['GET', 'HEAD'].includes(method)
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...headersFor(member),
        ...(write ? { origin: baseUrl, 'content-type': 'application/json', 'idempotency-key': `synthetic-node-write-${++keys}` } : {}),
      },
      ...(write && body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { json = null }
    return { status: response.status, json }
  }

  beforeAll(async () => {
    // The exact startup path `pnpm dev:demo` and `pnpm start:demo` run.
    app = startInventoryServer({ port: 0, releaseLoader: () => buildSyntheticRelease(), adminDirectory: createSyntheticMembershipAdmin() })
    await new Promise((resolve) => (app.server.listening ? resolve(undefined) : app.server.once('listening', resolve)))
    baseUrl = `http://127.0.0.1:${app.server.address().port}`
    const created = await call('POST', '/api/transfers', members.sales, transferRequest)
    expect(created.status).toBe(201)
    ids.transfer = created.json.id
    const attention = await call('GET', '/api/attention', members.group)
    ids.attention = attention.json.items.find((item) => item.allowedActions?.includes('acknowledge'))?.id
    expect(ids.attention).toBeTruthy()
  })
  afterAll(() => app.close())

  it.each(OTHER_METHODS.flatMap((method) => [...KNOWN_PATHS, ...V1_ALIASES, ...NEVER_WRITABLE].map((template) => [method, template])))(
    '%s %s is refused and changes nothing', async (method, template) => {
      const before = snapshot()
      const response = await call(method, fill(template, ids), members.group, PROBE)
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(snapshot()).toEqual(before)
    })

  it.each([...READ_PATHS, ...NEVER_WRITABLE])('POST %s is rejected and changes nothing', async (template) => {
    const before = snapshot()
    const response = await call('POST', fill(template, ids), members.group, PROBE)
    expect([404, 405]).toContain(response.status)
    expect(snapshot()).toEqual(before)
  })

  it('accepts POST on exactly the documented write branches', async () => {
    for (const branch of WRITE_BRANCHES) {
      const write = validWrite(branch, ids, 0)
      const response = await call('POST', write.path, members[write.as], write.body)
      expect(response.status, `${branch}: ${JSON.stringify(response.json)}`).toBeGreaterThanOrEqual(200)
      expect(response.status, `${branch}: ${JSON.stringify(response.json)}`).toBeLessThan(300)
    }
  })
})
