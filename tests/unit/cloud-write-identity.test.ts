// PRODUCT-RULE TEST
// @ts-nocheck -- drives the plain ESM Worker with real signed Access JWTs; fabricated identities only.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
//
// Beside cloud-access-revocation.test.ts: on the hosted Worker every persisted
// write actor comes from the enabled D1 membership, never from the request.
// Replaces the retired Node trusted-proxy harness test ('uses upstream identity
// for persisted actors and rejects identity fields in a spoofed payload').
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCloudWorkerHarness } from './cloudWorkerHarness'

const salesperson = { email: 'sales@example.invalid', userId: 'sales-fowlerville-1', name: 'Synthetic Fowlerville Salesperson', role: 'sales', store: 'Fowlerville' }
const manager = { email: 'manager@example.invalid', userId: 'manager-fowlerville-1', name: 'Synthetic Fowlerville Manager', role: 'manager', store: 'Fowlerville' }
const request = {
  vin: 'TESTDATAHWELL0001',
  neededBy: '2026-10-01T18:00:00Z',
  reason: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS write identity',
  customerAppointment: true,
  returnRequired: true,
  priority: 'normal',
}

let cloud
beforeEach(async () => { cloud = await createCloudWorkerHarness([salesperson, manager]) })
afterEach(() => cloud.close())

describe('Worker write identity comes from the D1 membership', () => {
  it('persists requestedBy and requestingStore from the membership, never from the payload, token claims or identity headers', async () => {
    // Every call carries a token claiming group_manager/Lincoln and forged
    // x-inventory-authenticated-* headers (see cloudWorkerHarness.ts).
    const spoofedStore = await cloud.call('POST', '/api/transfers', salesperson.email, { ...request, requestingStore: 'Lincoln' })
    expect(spoofedStore).toMatchObject({ status: 403, json: { code: 'STORE_MISMATCH' } })
    const spoofedActor = await cloud.call('POST', '/api/transfers', salesperson.email, { ...request, requestedBy: 'Spoofed Browser User' })
    expect(spoofedActor).toMatchObject({ status: 403, json: { code: 'ACTOR_MISMATCH' } })
    expect(cloud.count('transfer_requests')).toBe(0)

    const created = await cloud.call('POST', '/api/transfers', salesperson.email, request)
    expect(created.status).toBe(201)
    expect(created.json).toMatchObject({ requestedBy: salesperson.name, requestingStore: salesperson.store })
    expect(cloud.database.prepare('SELECT requested_by, requesting_store_id FROM transfer_requests WHERE id=?').get(created.json.id))
      .toEqual({ requested_by: salesperson.name, requesting_store_id: salesperson.store })
    expect(cloud.database.prepare("SELECT actor, actor_user_id, actor_role, store_id FROM transfer_events WHERE transfer_request_id=? AND event_type='requested'").get(created.json.id))
      .toEqual({ actor: salesperson.name, actor_user_id: salesperson.userId, actor_role: 'sales', store_id: salesperson.store })

    // A server-side membership change applies on the very next write.
    cloud.database.prepare("UPDATE cloud_memberships SET name='Synthetic Lincoln Salesperson', home_store='Lincoln' WHERE email=?").run(salesperson.email)
    const moved = await cloud.call('POST', '/api/transfers', salesperson.email, { ...request, vin: 'TESTDATAFWELL0001' })
    expect(moved.status).toBe(201)
    expect(moved.json).toMatchObject({ requestedBy: 'Synthetic Lincoln Salesperson', requestingStore: 'Lincoln' })
  })

  it('rejects a claimed group-manager actor role on a transfer event at the Worker', async () => {
    const created = await cloud.call('POST', '/api/transfers', salesperson.email, request)
    expect(created.status).toBe(201)
    const before = cloud.count('transfer_events')
    const escalated = await cloud.call('POST', `/api/transfers/${created.json.id}/events`, manager.email,
      { type: 'request_approved', availabilityConfirmed: true, actorRole: 'group_manager' },
      // A manager's preview header is inert: only a verified group manager may preview.
      { 'x-inventory-preview-role': 'group_manager', 'x-inventory-preview-store': 'Lincoln' })
    expect(escalated).toMatchObject({ status: 403, json: { code: 'ROLE_MISMATCH' } })
    expect(cloud.count('transfer_events')).toBe(before)

    const approved = await cloud.call('POST', `/api/transfers/${created.json.id}/events`, manager.email, { type: 'request_approved', availabilityConfirmed: true })
    expect(approved.status).toBe(201)
    expect(cloud.database.prepare("SELECT actor, actor_user_id, actor_role FROM transfer_events WHERE transfer_request_id=? AND event_type='request_approved'").get(created.json.id))
      .toEqual({ actor: manager.name, actor_user_id: manager.userId, actor_role: 'manager' })
  })

  it('persists the disposition actor from the D1 membership and rejects claimed identity fields', async () => {
    const path = '/api/vehicles/TESTDATAFWELL0001/disposition'
    // Every call carries group_manager/Lincoln token claims and forged identity headers.
    const claimed = await cloud.call('POST', path, manager.email, { disposition: 'keep', expectedVersion: 0, actorRole: 'group_manager' })
    expect(claimed).toMatchObject({ status: 422, json: { code: 'INVALID_DISPOSITION_INPUT' } })
    expect(cloud.count('vehicle_disposition_events')).toBe(0)

    const recorded = await cloud.call('POST', path, manager.email, { disposition: 'keep', expectedVersion: 0 })
    expect(recorded.status).toBe(201)
    expect(recorded.json).toMatchObject({ code: 'keep', version: 1, updatedBy: manager.name, updatedByRole: 'manager', store: 'Fowlerville' })
    expect(cloud.database.prepare('SELECT actor, actor_user_id, actor_role, store_id FROM vehicle_disposition_events').all())
      .toEqual([{ actor: manager.name, actor_user_id: manager.userId, actor_role: 'manager', store_id: 'Fowlerville' }])

    // Another store's manager cannot record on a Fowlerville vehicle, whatever the request claims.
    const howell = { email: 'howell-manager@example.invalid', userId: 'manager-howell-1', name: 'Synthetic Howell Manager', role: 'manager', store: 'Howell' }
    cloud.database.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)')
      .run(howell.email, howell.userId, howell.name, howell.role, howell.store)
    const otherStore = await cloud.call('POST', path, howell.email, { disposition: 'sold_pending', expectedVersion: 1 })
    expect(otherStore).toMatchObject({ status: 403, json: { code: 'DISPOSITION_MANAGER_REQUIRED' } })
    expect(cloud.count('vehicle_disposition_events')).toBe(1)
  })
})
