// @ts-nocheck -- exercises the plain ESM Node and Worker adapters with synthetic identities.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSyntheticRelease } from '../../fixtures/synthetic-release.mjs'
import { startInventoryServer } from '../../server/index.mjs'
import { loadD1Repository, RepositoryConflictError } from '../../cloudflare/src/repository.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { sqliteD1 } from '../../scripts/run-recovery-drill.mjs'
import { createCloudWorkerHarness } from './cloudWorkerHarness'

const CURRENT_VIN = 'TESTDATAHWELL0001'
const SECOND_VIN = 'TESTDATAHWELL0002'
const MISSING_VIN = 'TESTDATAXXXX00001'
const sales = { email: 'saved-sales@example.invalid', userId: 'saved-sales-1', name: 'Synthetic Saved Salesperson', role: 'sales', store: 'Howell' }
const other = { email: 'saved-other@example.invalid', userId: 'saved-other-1', name: 'Synthetic Other Salesperson', role: 'sales', store: 'Fowlerville' }
const sameNameOther = { email: 'saved-same-name@example.invalid', userId: 'saved-sales-2', name: sales.name, role: sales.role, store: sales.store }
const group = { email: 'saved-group@example.invalid', userId: 'saved-group-1', name: 'Synthetic Saved Group Manager', role: 'group_manager', store: 'Lincoln' }
const members = [sales, other, sameNameOther, group]
const ownerFor = (email) => members.find((member) => member.email === email)?.userId ?? 'unknown-synthetic-owner'
const nodeFetch = globalThis.fetch

describe('Worker employee-owned saved vehicle lists', () => {
  let cloud
  beforeEach(async () => { cloud = await createCloudWorkerHarness(members) })
  afterEach(() => cloud.close())

  const post = (email, body, key, headers = {}) => cloud.call('POST', '/api/saved-lists', email, body, {
    'idempotency-key': key, 'x-inventory-saved-list-owner': ownerFor(email), ...headers,
  })
  const get = (email, headers = {}) => cloud.call('GET', '/api/saved-lists', email, undefined, {
    'x-inventory-saved-list-owner': ownerFor(email), ...headers,
  })

  it('keeps list capability while skipping list row reads on ordinary routes and unrelated writes', async () => {
    const created = await post(other.email, { action: 'create', label: 'AB' }, 'skip-read-create')
    await post(other.email, { action: 'add', listId: created.json.id, vin: CURRENT_VIN, expectedRevision: 1 }, 'skip-read-add')

    const prepare = vi.spyOn(cloud.env.INVENTORY_DB, 'prepare')
    const listRowReads = () => prepare.mock.calls.map(([sql]) => sql).filter((sql) =>
      /\bFROM\s+(?:saved_vehicle_lists|saved_vehicle_list_items|saved_vehicle_list_actions)\b/i.test(sql))
    for (const route of ['/api/bootstrap', `/api/vehicles/${CURRENT_VIN}`, '/api/transfers', '/api/attention']) {
      prepare.mockClear()
      const response = await cloud.call('GET', route, other.email)
      expect(response.status, route).toBe(200)
      if (route === '/api/bootstrap') expect(response.json.savedListsEnabled).toBe(true)
      expect(listRowReads(), route).toEqual([])
    }

    prepare.mockClear()
    const unrelatedWrite = await cloud.call('POST', '/api/transfers', other.email, {
      vin: CURRENT_VIN, neededBy: '2026-10-08T18:00:00Z', reason: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS unrelated workflow',
      customerAppointment: true, returnRequired: true, priority: 'normal',
    })
    expect(unrelatedWrite.status).toBe(201)
    expect(listRowReads()).toEqual([])
    prepare.mockRestore()

    const replay = await post(other.email, { action: 'create', label: 'AB' }, 'skip-read-create')
    expect(replay).toMatchObject({ status: 200, json: { id: created.json.id, revision: 1 } })
    expect((await get(other.email)).json.lists).toMatchObject([
      { id: created.json.id, label: 'AB', items: [{ vin: CURRENT_VIN, available: true }] },
    ])
  })

  it('isolates owners, keeps missing VIN references, and never returns a vehicle snapshot', async () => {
    const created = await post(sales.email, { action: 'create', label: 'AB' }, 'create-ab')
    expect(created).toMatchObject({ status: 201, json: { label: 'AB', revision: 1, items: [] } })

    const current = await post(sales.email, { action: 'add', listId: created.json.id, vin: CURRENT_VIN, expectedRevision: 1 }, 'add-current')
    expect(current).toMatchObject({ status: 200, json: { revision: 2, items: [{ vin: CURRENT_VIN, available: true }] } })
    const missing = await post(sales.email, { action: 'add', listId: created.json.id, vin: MISSING_VIN, expectedRevision: 2 }, 'add-missing')
    expect(missing.status).toBe(200)
    expect(missing.json.items).toEqual([
      expect.objectContaining({ vin: CURRENT_VIN, available: true }),
      expect.objectContaining({ vin: MISSING_VIN, available: false }),
    ])
    expect(missing.json.items.every((item) => Object.keys(item).sort().join(',') === 'addedAt,available,vin')).toBe(true)

    const own = await get(sales.email)
    expect(own.json.lists).toHaveLength(1)
    expect((await get(other.email)).json).toEqual({ lists: [] })
    const hidden = await post(other.email, { action: 'rename', listId: created.json.id, label: 'Stolen', expectedRevision: 3 }, 'other-rename')
    expect(hidden).toMatchObject({ status: 404, json: { code: 'SAVED_LIST_NOT_FOUND' } })

    const removed = await post(sales.email, { action: 'remove', listId: created.json.id, vin: MISSING_VIN, expectedRevision: 3 }, 'remove-missing')
    expect(removed).toMatchObject({ status: 200, json: { revision: 4, items: [{ vin: CURRENT_VIN, available: true }] } })
    const deleted = await post(sales.email, { action: 'delete', listId: created.json.id, expectedRevision: 4 }, 'delete-ab')
    expect(deleted).toMatchObject({ status: 200, json: { id: created.json.id, deleted: true, revision: 5 } })
    expect((await get(sales.email)).json).toEqual({ lists: [] })

    const storedRevision = cloud.revision()
    const actionCount = cloud.count('saved_vehicle_list_actions')
    expect(await post(sales.email, { action: 'delete', listId: created.json.id, expectedRevision: 4 }, 'delete-ab'))
      .toMatchObject({ status: 200, json: deleted.json })
    expect(cloud.revision()).toBe(storedRevision)
    expect(cloud.count('saved_vehicle_list_actions')).toBe(actionCount)
  })

  it('binds idempotency to the normalized action and reports list revision conflicts', async () => {
    const body = { action: 'create', label: 'CD' }
    const first = await post(sales.email, body, 'same-create')
    const revision = cloud.revision()
    const replay = await post(sales.email, body, 'same-create')
    expect(replay).toMatchObject({ status: 200, json: { id: first.json.id, revision: 1 } })
    expect(cloud.revision()).toBe(revision)
    expect(cloud.count('saved_vehicle_lists')).toBe(1)
    expect(cloud.count('saved_vehicle_list_actions')).toBe(1)

    const reused = await post(sales.email, { action: 'create', label: 'Different' }, 'same-create')
    expect(reused).toMatchObject({ status: 409, json: { code: 'IDEMPOTENCY_CONFLICT' } })
    const renamed = await post(sales.email, { action: 'rename', listId: first.json.id, label: 'EF', expectedRevision: 1 }, 'rename')
    expect(renamed).toMatchObject({ status: 200, json: { label: 'EF', revision: 2 } })
    const stale = await post(sales.email, { action: 'add', listId: first.json.id, vin: CURRENT_VIN, expectedRevision: 1 }, 'stale')
    expect(stale).toMatchObject({ status: 409, json: { code: 'SAVED_LIST_CONFLICT' } })
  })

  it('keeps the authenticated owner during permission preview and denies revoked or anonymous memberships', async () => {
    const created = await post(group.email, { action: 'create', label: 'GM' }, 'group-create')
    expect(created.status).toBe(201)
    const preview = await get(group.email, {
      'x-inventory-preview-role': 'sales', 'x-inventory-preview-store': 'Howell',
    })
    expect(preview.json.lists.map((list) => list.id)).toEqual([created.json.id])
    expect((await get(sales.email)).json).toEqual({ lists: [] })

    const employeeList = await post(sales.email, { action: 'create', label: 'Employee' }, 'employee-create')
    expect(employeeList.status).toBe(201)
    cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(sales.email)
    expect(await get(sales.email)).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(await get('unknown@example.invalid')).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
  })

  it('rejects wrong-origin and overbroad bodies before persisting anything', async () => {
    const wrongOrigin = await post(sales.email, { action: 'create', label: 'AB' }, 'wrong-origin', { origin: 'https://evil.example' })
    expect(wrongOrigin).toMatchObject({ status: 403, json: { code: 'SAME_ORIGIN_REQUIRED' } })
    const contactField = await post(sales.email, { action: 'create', label: 'AB', phone: '555-0100' }, 'contact-field')
    expect(contactField).toMatchObject({ status: 422, json: { code: 'INVALID_SAVED_LIST_INPUT' } })
    expect(cloud.count('saved_vehicle_lists')).toBe(0)
    expect(cloud.count('saved_vehicle_list_actions')).toBe(0)
  })

  it.each([
    ['email', 'customer@example.com'],
    ['URL', 'https://example.com/customer'],
    ['www URL', 'www.example.com/customer'],
    ['phone-like digits', 'Call 5551234'],
  ])('rejects %s labels on both create and rename', async (_kind, label) => {
    const invalidCreate = await post(sales.email, { action: 'create', label }, `invalid-create-${_kind}`)
    expect(invalidCreate).toMatchObject({ status: 422, json: { code: 'INVALID_SAVED_LIST_INPUT' } })

    const created = await post(sales.email, { action: 'create', label: 'AB' }, `valid-create-${_kind}`)
    const invalidRename = await post(sales.email, {
      action: 'rename', listId: created.json.id, expectedRevision: 1, label,
    }, `invalid-rename-${_kind}`)
    expect(invalidRename).toMatchObject({ status: 422, json: { code: 'INVALID_SAVED_LIST_INPUT' } })
    expect((await get(sales.email)).json.lists)
      .toEqual([expect.objectContaining({ id: created.json.id, label: 'AB', revision: 1 })])
    expect(cloud.count('saved_vehicle_list_actions')).toBe(1)
  })

  it('serializes concurrent item changes without replacing the whole list', async () => {
    const created = await post(sales.email, { action: 'create', label: 'Concurrent' }, 'concurrent-create')
    const seeded = await post(sales.email, { action: 'add', listId: created.json.id, vin: CURRENT_VIN, expectedRevision: 1 }, 'concurrent-seed')
    expect(seeded.json.revision).toBe(2)
    const results = await Promise.all([
      post(sales.email, { action: 'add', listId: created.json.id, vin: SECOND_VIN, expectedRevision: 2 }, 'concurrent-add'),
      post(sales.email, { action: 'remove', listId: created.json.id, vin: CURRENT_VIN, expectedRevision: 2 }, 'concurrent-remove'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const list = (await get(sales.email)).json.lists[0]
    expect(list.revision).toBe(3)
    expect(list.items.map((item) => item.vin).sort()).toEqual(
      results[0].status === 200 ? [CURRENT_VIN, SECOND_VIN].sort() : [],
    )
  })

  it('enforces list and item caps atomically across stale D1 snapshots', async () => {
    const at = '2026-09-30T12:00:00.000Z'
    const context = {
      user: sales.name, userId: sales.userId, role: sales.role, store: sales.store,
      authenticatedRole: sales.role, authenticatedStore: sales.store,
    }
    const insertList = cloud.database.prepare('INSERT INTO saved_vehicle_lists (id,owner_user_id,label,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    for (let index = 0; index < 19; index += 1) {
      insertList.run(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, sales.userId, `List ${index}`, 1, at, at)
    }
    async function snapshot(key) {
      const repo = await loadD1Repository(sqliteD1(cloud.database), cloud.bundle.release, { ownerUserId: sales.userId, idempotencyKey: key })
      return { repo, service: createInventoryServiceCore({ database: repo.database, repository: repo.repository, now: () => new Date(at) }) }
    }
    const left = await snapshot('cap-create-left')
    const right = await snapshot('cap-create-right')
    left.service.mutateSavedVehicleList({ action: 'create', label: 'Left' }, context, 'cap-create-left')
    right.service.mutateSavedVehicleList({ action: 'create', label: 'Right' }, context, 'cap-create-right')
    await left.repo.commit({ email: sales.email, context })
    await expect(right.repo.commit({ email: sales.email, context })).rejects.toBeInstanceOf(RepositoryConflictError)
    const retry = await snapshot('cap-create-right')
    expect(() => retry.service.mutateSavedVehicleList({ action: 'create', label: 'Right' }, context, 'cap-create-right'))
      .toThrowError(expect.objectContaining({ code: 'SAVED_LIST_LIMIT_REACHED' }))
    expect(cloud.count('saved_vehicle_lists')).toBe(20)

    const itemListId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    // Replace one empty list with the cap target while preserving the owner's
    // 20-list ceiling; item rows are independent normalized references.
    cloud.database.prepare('UPDATE saved_vehicle_lists SET id=? WHERE id=?').run(itemListId, '00000000-0000-4000-8000-000000000000')
    const insertItem = cloud.database.prepare('INSERT INTO saved_vehicle_list_items (list_id,vin,added_at) VALUES (?,?,?)')
    for (let index = 0; index < 199; index += 1) insertItem.run(itemListId, `TESTDATA${String(index).padStart(9, '0')}`, at)
    const addLeft = await snapshot('cap-add-left')
    const addRight = await snapshot('cap-add-right')
    addLeft.service.mutateSavedVehicleList({ action: 'add', listId: itemListId, vin: 'TESTDATA900000001', expectedRevision: 1 }, context, 'cap-add-left')
    addRight.service.mutateSavedVehicleList({ action: 'add', listId: itemListId, vin: 'TESTDATA900000002', expectedRevision: 1 }, context, 'cap-add-right')
    await addLeft.repo.commit({ email: sales.email, context })
    await expect(addRight.repo.commit({ email: sales.email, context })).rejects.toBeInstanceOf(RepositoryConflictError)
    const addRetry = await snapshot('cap-add-right')
    expect(() => addRetry.service.mutateSavedVehicleList({ action: 'add', listId: itemListId, vin: 'TESTDATA900000002', expectedRevision: 1 }, context, 'cap-add-right'))
      .toThrowError(expect.objectContaining({ code: 'SAVED_LIST_CONFLICT' }))
    expect(cloud.database.prepare('SELECT COUNT(*) AS total FROM saved_vehicle_list_items WHERE list_id=?').get(itemListId).total).toBe(200)
  })

  it('advertises migration capability and refuses writes when migration 0014 is absent', async () => {
    cloud.database.exec('DROP TABLE saved_vehicle_list_actions; DROP TABLE saved_vehicle_list_items; DROP TABLE saved_vehicle_lists;')
    const bootstrap = await cloud.call('GET', '/api/bootstrap', sales.email)
    expect(bootstrap.json.savedListsEnabled).toBe(false)
    const write = await post(sales.email, { action: 'create', label: 'AB' }, 'migration-missing')
    expect(write).toMatchObject({ status: 503, json: { code: 'MIGRATION_REQUIRED' } })
  })

  it('changes bootstrap validators for different stable employee IDs even when display access is identical', async () => {
    const first = await cloud.call('GET', '/api/bootstrap', sales.email)
    expect(first).toMatchObject({ status: 200, json: { access: { user: sales.name, userId: sales.userId, role: sales.role, store: sales.store } } })
    const second = await cloud.call('GET', '/api/bootstrap', sameNameOther.email, undefined, {
      'if-none-match': first.headers.get('etag'),
    })
    expect(second).toMatchObject({ status: 200, json: { access: { user: sales.name, userId: sameNameOther.userId, role: sales.role, store: sales.store } } })
    expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'))
  })

  it('rejects missing or stale owner fences on reads and writes without changing saved rows', async () => {
    expect((await post(sales.email, { action: 'create', label: 'Owner fence' }, 'owner-fence-seed')).status).toBe(201)
    const before = {
      revision: cloud.revision(), lists: cloud.count('saved_vehicle_lists'), actions: cloud.count('saved_vehicle_list_actions'),
    }
    const attempts = [
      await cloud.call('GET', '/api/saved-lists', sales.email),
      await cloud.call('GET', '/api/saved-lists', sales.email, undefined, { 'x-inventory-saved-list-owner': other.userId }),
      await cloud.call('POST', '/api/saved-lists', sales.email, { action: 'create', label: 'Missing' }),
      await cloud.call('POST', '/api/saved-lists', sales.email, { action: 'create', label: 'Stale' }, { 'x-inventory-saved-list-owner': other.userId }),
    ]
    for (const response of attempts) expect(response).toMatchObject({ status: 403, json: { code: 'ACCESS_CONTEXT_CHANGED' } })
    expect({
      revision: cloud.revision(), lists: cloud.count('saved_vehicle_lists'), actions: cloud.count('saved_vehicle_list_actions'),
    }).toEqual(before)
  })

  it('rechecks the current D1 member after a transaction conflict and rejects the original owner fence', async () => {
    const d1 = cloud.env.INVENTORY_DB
    const originalBatch = d1.batch.bind(d1)
    let changedDuringCommit = false
    d1.batch = async (statements) => {
      if (!changedDuringCommit && statements[0]?.sql.includes('UPDATE cloud_app_revision SET revision = CASE WHEN')) {
        changedDuringCommit = true
        cloud.database.prepare('UPDATE cloud_app_revision SET revision = revision + 1').run()
        cloud.database.prepare('UPDATE cloud_memberships SET user_id=? WHERE email=?')
          .run('saved-sales-reassigned', sales.email)
      }
      return originalBatch(statements)
    }
    const response = await post(sales.email, { action: 'create', label: 'Retry owner' }, 'retry-owner')
    expect(changedDuringCommit).toBe(true)
    expect(response).toMatchObject({ status: 403, json: { code: 'ACCESS_CONTEXT_CHANGED' } })
    expect(cloud.count('saved_vehicle_lists')).toBe(0)
    expect(cloud.count('saved_vehicle_list_actions')).toBe(0)
  })
})

describe('Node and Worker saved-list HTTP parity', () => {
  let app
  let baseUrl
  let cloud

  beforeEach(async () => {
    app = startInventoryServer({ port: 0, releaseLoader: () => buildSyntheticRelease() })
    await new Promise((resolve) => (app.server.listening ? resolve(undefined) : app.server.once('listening', resolve)))
    baseUrl = `http://127.0.0.1:${app.server.address().port}`
    cloud = await createCloudWorkerHarness([sales])
  })
  afterEach(async () => { await app.close(); cloud.close() })

  async function nodeCall(method, path, body, key, origin = baseUrl, expectedOwnerId = 'demo:local-prototype-user') {
    const response = await nodeFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'x-inventory-demo-role': 'sales', 'x-inventory-demo-store': 'Howell', 'x-inventory-demo-user': 'Local prototype user',
        ...(expectedOwnerId === null ? {} : { 'x-inventory-saved-list-owner': expectedOwnerId }),
        ...(method === 'POST' ? { origin, 'content-type': 'application/json', 'idempotency-key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, json: await response.json() }
  }

  it('returns the same list shape and item semantics from SQLite and D1', async () => {
    const nodeCreated = await nodeCall('POST', '/api/v1/saved-lists', { action: 'create', label: 'Parity' }, 'parity-create')
    const cloudCreated = await cloud.call('POST', '/api/v1/saved-lists', sales.email, { action: 'create', label: 'Parity' }, {
      'idempotency-key': 'parity-create', 'x-inventory-saved-list-owner': sales.userId,
    })
    expect([nodeCreated.status, cloudCreated.status]).toEqual([201, 201])

    const nodeAdded = await nodeCall('POST', '/api/saved-lists', { action: 'add', listId: nodeCreated.json.id, vin: MISSING_VIN, expectedRevision: 1 }, 'parity-add')
    const cloudAdded = await cloud.call('POST', '/api/saved-lists', sales.email,
      { action: 'add', listId: cloudCreated.json.id, vin: MISSING_VIN, expectedRevision: 1 }, {
        'idempotency-key': 'parity-add', 'x-inventory-saved-list-owner': sales.userId,
      })
    const comparable = (value) => ({ label: value.label, revision: value.revision, items: value.items.map(({ vin, available }) => ({ vin, available })) })
    expect(comparable(nodeAdded.json)).toEqual(comparable(cloudAdded.json))
    expect(comparable(nodeAdded.json)).toEqual({ label: 'Parity', revision: 2, items: [{ vin: MISSING_VIN, available: false }] })
    expect((await nodeCall('GET', '/api/saved-lists')).json.lists.map(comparable)).toEqual([comparable(nodeAdded.json)])

    expect(await nodeCall('POST', '/api/saved-lists', { action: 'create', label: 'Blocked' }, 'bad-origin', 'https://evil.example'))
      .toMatchObject({ status: 403, json: { code: 'SAME_ORIGIN_REQUIRED' } })

    const contactLabel = { action: 'create', label: 'customer@example.com' }
    expect(await nodeCall('POST', '/api/saved-lists', contactLabel, 'parity-contact-node'))
      .toMatchObject({ status: 422, json: { code: 'INVALID_SAVED_LIST_INPUT' } })
    expect(await cloud.call('POST', '/api/saved-lists', sales.email, contactLabel, {
      'idempotency-key': 'parity-contact-cloud', 'x-inventory-saved-list-owner': sales.userId,
    }))
      .toMatchObject({ status: 422, json: { code: 'INVALID_SAVED_LIST_INPUT' } })
  })

  it('applies the same missing and changed owner fence to the Node demo', async () => {
    expect(await nodeCall('GET', '/api/bootstrap')).toMatchObject({
      status: 200, json: { access: { userId: 'demo:local-prototype-user' } },
    })
    const before = app.database.prepare('SELECT COUNT(*) AS total FROM saved_vehicle_lists').get().total
    expect(await nodeCall('GET', '/api/saved-lists', undefined, undefined, baseUrl, null))
      .toMatchObject({ status: 403, json: { code: 'ACCESS_CONTEXT_CHANGED' } })
    expect(await nodeCall('POST', '/api/saved-lists', { action: 'create', label: 'Wrong owner' }, 'wrong-owner', baseUrl, 'other-owner'))
      .toMatchObject({ status: 403, json: { code: 'ACCESS_CONTEXT_CHANGED' } })
    expect(app.database.prepare('SELECT COUNT(*) AS total FROM saved_vehicle_lists').get().total).toBe(before)
  })
})
