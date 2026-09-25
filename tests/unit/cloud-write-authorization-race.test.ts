// @ts-nocheck -- real signed Access JWTs and transactional SQLite D1 shim.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCloudWorkerHarness } from './cloudWorkerHarness'

const sales = { email: 'race-sales@example.invalid', userId: 'synthetic-race-sales', name: 'Synthetic Race Salesperson', role: 'sales', store: 'Fowlerville' }
const manager = { email: 'race-manager@example.invalid', userId: 'synthetic-race-manager', name: 'Synthetic Race Manager', role: 'manager', store: 'Fowlerville' }
const request = { vin: 'TESTDATAHWELL0001', neededBy: '2026-10-01T18:00:00Z', reason: 'Synthetic boundary-race request', returnRequired: true }
let cloud
beforeEach(async () => { cloud = await createCloudWorkerHarness([sales, manager]) })
afterEach(() => cloud.close())

function changeAtBoundary(change, { beforeRead = false } = {}) {
  const batch = cloud.env.INVENTORY_DB.batch.bind(cloud.env.INVENTORY_DB)
  let changed = false
  let commitAttempts = 0
  cloud.env.INVENTORY_DB.batch = async (statements) => {
    const commit = /^UPDATE cloud_app_revision\b/i.test(statements[0].sql)
    if (commit) commitAttempts++
    const boundary = beforeRead ? /^SELECT revision FROM cloud_app_revision\b/i.test(statements[0].sql) : commit
    if (!changed && boundary) { changed = true; change() }
    return batch(statements)
  }
  return () => ({ changed, commitAttempts })
}

describe('Worker authorization remains current through the commit boundary', () => {
  it.each([false, true])('does not retry a revoked employee with stale authority (revision advanced: %s)', async (advanceRevision) => {
    const boundary = changeAtBoundary(() => {
      cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(sales.email)
      if (advanceRevision) cloud.database.exec('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1')
    })
    const result = await cloud.call('POST', '/api/transfers', sales.email, request)
    expect(boundary()).toEqual({ changed: true, commitAttempts: 1 })
    expect(result).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(cloud.count('transfer_requests')).toBe(0)
    expect(cloud.count('transfer_events')).toBe(0)
    expect(cloud.revision()).toBe(advanceRevision ? 1 : 0)
  })

  it('catches revocation after initial authorization but before the ledger snapshot is read', async () => {
    const boundary = changeAtBoundary(() => {
      cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(sales.email)
      cloud.database.exec('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1')
    }, { beforeRead: true })
    expect(await cloud.call('POST', '/api/transfers', sales.email, request))
      .toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(boundary().changed).toBe(true)
    expect(cloud.count('transfer_requests')).toBe(0)
    expect(cloud.count('transfer_events')).toBe(0)
  })

  it('does not commit after the authenticated membership is deleted', async () => {
    changeAtBoundary(() => cloud.database.prepare('DELETE FROM cloud_memberships WHERE email=?').run(sales.email))
    expect(await cloud.call('POST', '/api/transfers', sales.email, request))
      .toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(cloud.count('transfer_requests')).toBe(0)
    expect(cloud.count('transfer_events')).toBe(0)
  })

  it.each([
    ['role demotion', "UPDATE cloud_memberships SET role='sales' WHERE email=?"],
    ['home-store change', "UPDATE cloud_memberships SET home_store='Howell' WHERE email=?"],
  ])('reauthorizes a manager approval after %s and rolls back its stale audit', async (_label, sql) => {
    const created = await cloud.call('POST', '/api/transfers', sales.email, request)
    expect(created.status).toBe(201)
    const boundary = changeAtBoundary(() => cloud.database.prepare(sql).run(manager.email))
    const result = await cloud.call('POST', `/api/transfers/${created.json.id}/events`, manager.email,
      { type: 'request_approved', availabilityConfirmed: true },
      { 'x-inventory-preview-role': 'group_manager', 'x-inventory-preview-store': 'Fowlerville' })
    expect(boundary()).toEqual({ changed: true, commitAttempts: 1 })
    expect(result.status).toBe(403)
    expect(cloud.database.prepare('SELECT status FROM transfer_requests').get().status).toBe('requested')
    expect(cloud.count('transfer_events')).toBe(1)
    expect(cloud.revision()).toBe(1)
  })

  it('uses the refreshed server-owned identity after a name change, ignoring forged identity headers', async () => {
    const name = 'Synthetic Renamed Salesperson'
    const boundary = changeAtBoundary(() => cloud.database.prepare('UPDATE cloud_memberships SET name=? WHERE email=?').run(name, sales.email))
    const result = await cloud.call('POST', '/api/transfers', sales.email, request)
    expect(result).toMatchObject({ status: 201, json: { requestedBy: name, requestingStore: sales.store } })
    expect(boundary()).toEqual({ changed: true, commitAttempts: 2 })
    expect(cloud.database.prepare('SELECT actor,actor_user_id,actor_role,store_id FROM transfer_events').get())
      .toEqual({ actor: name, actor_user_id: sales.userId, actor_role: sales.role, store_id: sales.store })
    expect(cloud.count('transfer_requests')).toBe(1)
    expect(cloud.count('transfer_events')).toBe(1)
    expect(cloud.revision()).toBe(1)
  })

  it('still retries an unrelated ledger conflict once without duplicating the request or audit', async () => {
    const boundary = changeAtBoundary(() => cloud.database.exec('UPDATE cloud_app_revision SET revision=revision+1 WHERE id=1'))
    expect((await cloud.call('POST', '/api/transfers', sales.email, request)).status).toBe(201)
    expect(boundary()).toEqual({ changed: true, commitAttempts: 2 })
    expect(cloud.count('transfer_requests')).toBe(1)
    expect(cloud.count('transfer_events')).toBe(1)
    expect(cloud.revision()).toBe(2)
  })

  it('checks access before returning an idempotent replay, without advancing the revision', async () => {
    const headers = { 'idempotency-key': 'synthetic-authorized-replay' }
    expect((await cloud.call('POST', '/api/transfers', sales.email, request, headers)).status).toBe(201)
    expect((await cloud.call('POST', '/api/transfers', sales.email, request, headers)).status).toBe(200)
    expect(cloud.revision()).toBe(1)
    const boundary = changeAtBoundary(() => cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(sales.email))
    expect(await cloud.call('POST', '/api/transfers', sales.email, request, headers))
      .toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(boundary()).toEqual({ changed: true, commitAttempts: 1 })
    expect(cloud.count('transfer_requests')).toBe(1)
    expect(cloud.count('transfer_events')).toBe(1)
    expect(cloud.revision()).toBe(1)
  })
})
