// @ts-nocheck -- real signed Access identities and an isolated D1 schema.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudWorkerHarness, CLOUD_HOST } from './cloudWorkerHarness'
import worker from '../../cloudflare/src/worker.mjs'

const sales = { email: 'pause-sales@example.invalid', userId: 'pause-sales', name: 'Synthetic Sales', role: 'sales', store: 'Howell' }
const manager = { email: 'pause-manager@example.invalid', userId: 'pause-manager', name: 'Synthetic Manager', role: 'manager', store: 'Howell' }
const group = { email: 'pause-group@example.invalid', userId: 'pause-group', name: 'Synthetic Group', role: 'group_manager', store: 'Lincoln' }
const driver = { email: 'pause-driver@example.invalid', userId: 'pause-driver', name: 'Synthetic Driver', role: 'driver', store: 'Howell' }
const vin = 'TESTDATAHWELL0002'
const holdPath = `/api/vehicles/${vin}/manual-hold`
const holdRequest = { state: 'requested', customerLabel: 'AB', note: 'Synthetic private appointment', expectedVersion: 0 }
const paused = { status: 503, json: { code: 'EMPLOYEE_WRITES_DISABLED', error: 'Saving changes is temporarily paused. You can still view inventory and saved activity.' } }
const branches = [
  '/transfers', `/vehicles/${vin}/service`, `/vehicles/${vin}/disposition`, `/vehicles/${vin}/manual-hold`,
  '/transfers/synthetic-transfer/events', '/attention/synthetic-attention/events', `/vehicles/${vin}/issues`,
  '/vehicle-issues/synthetic-issue/events', '/saved-lists', '/admin/members',
]
let cloud
beforeEach(async () => { cloud = await createCloudWorkerHarness([sales, manager, group, driver]) })
afterEach(() => cloud.close())

function storedRows() {
  const tables = cloud.database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  return tables.map(({ name }) => [name, cloud.database.prepare(`SELECT * FROM "${name}"`).all()])
}

describe('deployment-only employee write pause', () => {
  it.each(['/api', '/api/v1'])('refuses every documented employee POST under %s before body parsing, storage reads or mutations', async prefix => {
    cloud.env.EMPLOYEE_WRITES_DISABLED = 'true'
    const before = storedRows()
    const get = vi.spyOn(cloud.env.RELEASE_SNAPSHOTS, 'get')
    for (const path of branches) {
      const response = await cloud.call('POST', `${prefix}${path}`, group.email, undefined, {
        'x-inventory-saved-list-owner': group.userId,
        'idempotency-key': '', // Pause takes precedence over payload/idempotency parsing.
        'x-inventory-employee-writes-disabled': 'false',
      })
      expect(response).toMatchObject(paused)
    }
    expect(storedRows()).toEqual(before)
    expect(cloud.storedObjects.size).toBe(0)
    expect(get).not.toHaveBeenCalled()
  })

  it.each(['', 'TRUE', 'False', ' false ', '0', false, null])('fails closed for a configured invalid pause value %j', async value => {
    cloud.env.EMPLOYEE_WRITES_DISABLED = value
    expect(await cloud.call('POST', holdPath, sales.email, { ...holdRequest, EMPLOYEE_WRITES_DISABLED: 'false' })).toMatchObject(paused)
    expect(cloud.count('vehicle_manual_hold_events')).toBe(0)
  })

  it.each([undefined, 'false'])('keeps normal manager approval and ownership enforcement when writes are enabled (%j)', async value => {
    if (value !== undefined) cloud.env.EMPLOYEE_WRITES_DISABLED = value
    expect(await cloud.call('POST', holdPath, sales.email, holdRequest)).toMatchObject({ status: 201, json: { state: 'requested', version: 1 } })
    const selfApproval = await cloud.call('POST', holdPath, sales.email, { state: 'active', expectedVersion: 1 })
    expect(selfApproval).toMatchObject({ status: 403, json: { code: 'MANUAL_HOLD_APPROVAL_REQUIRED' } })
    expect(await cloud.call('POST', holdPath, manager.email, { state: 'active', expectedVersion: 1 })).toMatchObject({ status: 201, json: { state: 'active', version: 2 } })
    expect(cloud.database.prepare('SELECT owner_user_id, actor_user_id FROM vehicle_manual_hold_events WHERE version=2').get())
      .toEqual({ owner_user_id: sales.userId, actor_user_id: manager.userId })
  })

  it.each(['requested', 'active', 'rejected', 'cancelled'])('retains existing %s history, private saved lists and role redaction during a pause', async state => {
    expect((await cloud.call('POST', holdPath, sales.email, holdRequest)).status).toBe(201)
    if (state !== 'requested') {
      const actor = state === 'cancelled' ? sales : manager
      expect((await cloud.call('POST', holdPath, actor.email, { state, expectedVersion: 1, note: 'Synthetic private decision' })).status).toBe(201)
    }
    const ownerHeader = { 'x-inventory-saved-list-owner': sales.userId }
    expect((await cloud.call('POST', '/api/saved-lists', sales.email, { action: 'create', label: 'SYNTHETIC customer initials' }, ownerHeader)).status).toBe(201)
    const before = storedRows()
    const paths = ['/api/bootstrap', `/api/vehicles/${vin}`, holdPath, '/api/saved-lists']
    const activeReads = await Promise.all(paths.map(path => cloud.call('GET', path, sales.email, undefined, ownerHeader)))
    for (const response of activeReads) expect(response.status).toBe(200)
    cloud.env.EMPLOYEE_WRITES_DISABLED = 'true'
    for (let index = 0; index < paths.length; index++) {
      const response = await cloud.call('GET', paths[index], sales.email, undefined, ownerHeader)
      expect(response.status).toBe(200)
      expect(response.json).toEqual(activeReads[index].json)
    }
    const transport = await cloud.call('GET', holdPath, driver.email)
    expect(transport).toMatchObject({ status: 200, json: { history: [], canManage: false } })
    expect(JSON.stringify(transport.json)).not.toMatch(/Synthetic private|customerLabel|updatedBy|pause-sales/)
    expect(await cloud.call('POST', holdPath, manager.email, { state: 'active', expectedVersion: 1 })).toMatchObject(paused)
    expect(storedRows()).toEqual(before)
  })

  it('preserves route, authentication, membership, origin, admin and saved-list owner checks', async () => {
    cloud.env.EMPLOYEE_WRITES_DISABLED = 'true'
    const anonymous = await worker.fetch(new Request(`https://${CLOUD_HOST}${holdPath}`, { method: 'POST' }), cloud.env)
    expect(anonymous.status).toBe(401)
    expect(await cloud.call('POST', holdPath, 'unknown@example.invalid', holdRequest)).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(await cloud.call('POST', holdPath, sales.email, holdRequest, { origin: 'https://other.example.invalid' })).toMatchObject({ status: 403, json: { code: 'SAME_ORIGIN_REQUIRED' } })
    expect(await cloud.call('POST', '/api/admin/members', sales.email, {})).toMatchObject({ status: 403, json: { code: 'ADMIN_OVERVIEW_ACCESS_REQUIRED' } })
    const wrongOwner = await cloud.call('POST', '/api/saved-lists', sales.email, {}, { 'x-inventory-saved-list-owner': group.userId })
    expect(wrongOwner.status).toBe(403)
    expect(wrongOwner.json.code).not.toBe('EMPLOYEE_WRITES_DISABLED')
    expect((await cloud.call('POST', '/api/unknown', group.email, {})).status).toBe(404)
    expect((await cloud.call('POST', '/api/bootstrap', group.email, {})).status).toBe(405)
    expect((await cloud.call('DELETE', holdPath, group.email, {})).status).toBe(405)
    cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(sales.email)
    expect(await cloud.call('POST', holdPath, sales.email, holdRequest)).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
  })

  it('keeps publisher requests on their separate authentication path', async () => {
    cloud.env.EMPLOYEE_WRITES_DISABLED = 'true'
    // An employee cannot publish, regardless of the employee pause flag.
    const result = await cloud.call('POST', '/internal/releases', group.email, {})
    expect(result.status).toBe(403)
    expect(result.json.code).toBe('PUBLISHER_IDENTITY_REQUIRED')
    expect(cloud.storedObjects.size).toBe(0)
  })
})
