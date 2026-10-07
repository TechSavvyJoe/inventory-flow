// @ts-nocheck
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { openInventoryDatabase, importRelease } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServer } from '../../server/api.mjs'
import { appReadiness } from '../../cloudflare/src/worker.mjs'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { buildManualHoldEvent, inventoryDecision } from '../../server/manual-holds.mjs'
import { createCloudWorkerHarness } from './cloudWorkerHarness'

const VIN = 'TESTDATAHWELL0002'
const sales = { role: 'sales', store: 'Howell', user: 'Synthetic sales', userId: 'sales-1', canViewPrivateEvidence: true }
const manager = { ...sales, role: 'manager', user: 'Synthetic manager', userId: 'manager-1' }
const source = { vin: VIN, publicRecord: { store: 'Howell' } }
const options = { now: SYNTHETIC_NOW, idempotencyKey: 'synthetic-hold-1' }
const input = { state: 'active', customerLabel: 'AB', note: 'Appointment tomorrow', expectedVersion: 0 }
const contactNotes = [
  'Email synthetic.customer@example.invalid to confirm',
  'Details at https://customer.example.invalid/reservation',
  'Details at www.customer.example.invalid',
  'Call (555) 010-1234 to confirm',
  'Call +1 555 010 1234 to confirm',
  'Call 555.010.1234 to confirm',
  'Call 5550101234 to confirm',
  'Call 555-0123 to confirm',
]
const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })
function local() {
  const database = openInventoryDatabase(); databases.push(database)
  importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  return { database, service: createInventoryService({ database, now: () => SYNTHETIC_NOW }) }
}

describe('manual holds and reconciliation', () => {
  it('creates, edits, releases and retains immutable history without altering imported holds', () => {
    const { database, service } = local()
    const before = service.getVehicle(VIN, sales).hold
    const first = service.updateManualHold(VIN, input, sales, options.idempotencyKey)
    expect(first.record).toMatchObject({ state: 'active', version: 1, customerLabel: 'AB', ownedByCurrentUser: true })
    expect(service.updateManualHold(VIN, input, sales, options.idempotencyKey).created).toBe(false)
    expect(() => service.updateManualHold(VIN, { ...input, note: 'Changed' }, sales, options.idempotencyKey)).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }))
    expect(() => service.updateManualHold(VIN, input, manager, 'stale')).toThrow(expect.objectContaining({ code: 'MANUAL_HOLD_VERSION_CONFLICT' }))
    service.updateManualHold(VIN, { ...input, expectedVersion: 1, note: 'Appointment confirmed' }, sales, 'edit')
    const released = service.updateManualHold(VIN, { state: 'released', expectedVersion: 2, note: 'Customer selected another unit' }, manager, 'release')
    expect(released.record.history.map(row => row.state)).toEqual(['released', 'active', 'active'])
    expect(service.getVehicle(VIN, sales).hold).toEqual(before)
    expect(() => database.exec('DELETE FROM vehicle_manual_hold_events')).toThrow('append-only')
    expect(() => database.exec("UPDATE vehicle_manual_hold_events SET note = 'changed'")).toThrow('append-only')
  })
  it('protects hold ownership, home-store scope, transport roles and trusted identity', () => {
    const row = buildManualHoldEvent(source, [], input, sales, options).row
    for (const who of [{ ...sales, userId: 'other' }, { ...manager, store: 'Lincoln' }, { ...sales, role: 'driver' }, { ...sales, userId: null }]) {
      expect(() => buildManualHoldEvent(source, [row], { ...input, expectedVersion: 1 }, who, options)).toThrow(expect.objectContaining({ status: 403 }))
    }
    expect(buildManualHoldEvent(source, [row], { ...input, expectedVersion: 1 }, manager, { ...options, idempotencyKey: 'manager-edit' }).row).toMatchObject({ actor_user_id: 'manager-1', owner_user_id: 'sales-1' })
    expect(() => buildManualHoldEvent(source, [], { ...input, actor: 'spoof' }, sales, options)).toThrow(expect.objectContaining({ code: 'INVALID_MANUAL_HOLD_INPUT' }))
  })
  it('keeps customer labels, notes and writer identity out of list views and transport detail', () => {
    const { service } = local()
    service.updateManualHold(VIN, input, sales, 'private')
    const view = service.getVehicle(VIN, sales)
    expect(view.manualHold).not.toHaveProperty('customerLabel')
    expect(view.manualHold).not.toHaveProperty('note')
    expect(view.inventoryDecision).toMatchObject({ manualHold: 'active' })
    const detail = service.getManualHold(VIN, { ...sales, role: 'driver' })
    expect(detail).toMatchObject({ canManage: false, history: [] })
    expect(detail).not.toHaveProperty('customerLabel')
    expect(detail).not.toHaveProperty('updatedBy')
  })
  it.each([
    [{ manualHold: { state: 'active' }, hold: { state: 'unknown' } }, 'manual_only', 'held'],
    [{ manualHold: { state: 'active' }, hold: { state: 'primary' } }, 'agreement', 'held'],
    [{ manualHold: { state: 'active' }, hold: { state: 'none_observed' } }, 'conflict', 'held'],
    [{ manualHold: { state: 'released' }, hold: { state: 'primary' } }, 'conflict', 'held'],
    [{ hold: { state: 'none_observed' } }, 'source_only', 'unconfirmed'],
    [{ manualHold: { state: 'active' }, appDisposition: { code: 'delivered' } }, 'conflict', 'delivered'],
  ])('compares independent signals without inventing availability: %j', (vehicle, comparison, status) => {
    expect(inventoryDecision(vehicle)).toMatchObject({ comparison, status })
  })
  it('requires a release reason, valid date and hold detail, and fails closed without storage', () => {
    for (const bad of [{ ...input, customerLabel: '', note: '' }, { ...input, customerLabel: 'person@example.invalid' }, { ...input, expectedDeliveryDate: '2026-02-30' }, { state: 'released', expectedVersion: 0 }]) {
      expect(() => buildManualHoldEvent(source, [], bad, sales, options)).toThrow()
    }
    expect(() => buildManualHoldEvent(source, [], input, sales, { ...options, enabled: false })).toThrow(expect.objectContaining({ code: 'MIGRATION_REQUIRED' }))
  })
  it.each(contactNotes)('rejects contact information in notes before persisting create, edit or release: %s', note => {
    const { database, service } = local()
    const rejection = expect.objectContaining({ code: 'INVALID_MANUAL_HOLD_INPUT', status: 422 })
    expect(() => service.updateManualHold(VIN, { ...input, note }, sales, 'rejected-create')).toThrow(rejection)
    expect(database.prepare('SELECT COUNT(*) AS count FROM vehicle_manual_hold_events').get().count).toBe(0)
    service.updateManualHold(VIN, input, sales, 'valid-create')
    const before = service.getManualHold(VIN, sales)
    for (const state of ['active', 'released']) {
      expect(() => service.updateManualHold(VIN, { ...input, state, expectedVersion: 1, note }, sales, `rejected-${state}`)).toThrow(rejection)
      expect(service.getManualHold(VIN, sales)).toEqual(before)
      expect(database.prepare('SELECT COUNT(*) AS count FROM vehicle_manual_hold_events').get().count).toBe(1)
    }
  })
  it.each([
    'Delivery 2026-10-08; appointment 10/8/2026 at 10:30',
    'Delivery 10-08-2026; backup appointment 10/9/26',
    'Quoted $35,900 with $1,250 deposit; display unit price USD 1250000',
    'Equipment packages 302A and 501A; 18-inch wheels; 4 seats checked',
    'Detail complete; customer selected another unit',
  ])('preserves operational notes with dates, prices and package codes: %s', note => {
    const { service } = local()
    const created = service.updateManualHold(VIN, { ...input, note }, sales, 'operational-create')
    expect(created.record).toMatchObject({ state: 'active', version: 1, note })
    const released = service.updateManualHold(VIN, { state: 'released', expectedVersion: 1, note }, sales, 'operational-release')
    expect(released.record).toMatchObject({ state: 'released', version: 2, note })
  })
  it('supports Other with a required explanation, while retaining delivered units in inventory', () => {
    const { service } = local()
    expect(() => service.updateDisposition(VIN, { disposition: 'other', expectedVersion: 0 }, manager, 'other-empty')).toThrow()
    service.updateDisposition(VIN, { disposition: 'other', note: 'Reserved for dealership display', expectedVersion: 0 }, manager, 'other')
    service.updateDisposition(VIN, { disposition: 'delivered', effectiveDate: '2026-08-30', expectedVersion: 1 }, manager, 'delivered')
    expect(service.getVehicle(VIN, sales)).toMatchObject({ appDisposition: { code: 'delivered' }, inventoryDecision: { status: 'delivered' } })
  })
  it('preserves every disposition row and append-only guards through migration 0015', () => {
    const db = new DatabaseSync(':memory:'); databases.push(db)
    db.exec(readFileSync(new URL('../../cloudflare/migrations/0013_vehicle_dispositions.sql', import.meta.url), 'utf8'))
    db.exec("INSERT INTO vehicle_disposition_events VALUES ('id','TESTDATAHWELL0002',1,'keep',NULL,NULL,'History','2026-08-30','Synthetic','u','manager','Howell','hash','key')")
    db.exec(readFileSync(new URL('../../cloudflare/migrations/0015_manual_inventory_controls.sql', import.meta.url), 'utf8'))
    expect(db.prepare('SELECT note FROM vehicle_disposition_events').get().note).toBe('History')
    expect(() => db.exec('DELETE FROM vehicle_disposition_events')).toThrow('append-only')
  })
  it('persists through the Worker using D1 membership identity and rejects spoofed fields and cross-store writes', async () => {
    const cloud = await createCloudWorkerHarness([{ email: 'sales@example.invalid', ...sales, name: sales.user }, { email: 'manager@example.invalid', ...manager, name: manager.user }])
    try {
      const created = await cloud.call('POST', `/api/vehicles/${VIN}/manual-hold`, 'sales@example.invalid', input)
      expect(created.status).toBe(201)
      expect(created.json).toMatchObject({ state: 'active', updatedBy: sales.user, version: 1 })
      const read = await cloud.call('GET', `/api/vehicles/${VIN}/manual-hold`, 'manager@example.invalid')
      expect(read.json).toMatchObject({ customerLabel: 'AB', history: [expect.objectContaining({ state: 'active' })] })
      const denied = await cloud.call('POST', '/api/vehicles/TESTDATAFWELL0002/manual-hold', 'sales@example.invalid', input)
      expect(denied.status).toBe(403)
      const spoof = await cloud.call('POST', `/api/vehicles/${VIN}/manual-hold`, 'manager@example.invalid', { ...input, expectedVersion: 1, actor: 'forged' })
      expect(spoof.status).toBe(422)
    } finally { cloud.close() }
  })
  it('keeps Worker inventory readable but gates holds and deployment readiness when migration 0015 is absent', async () => {
    const cloud = await createCloudWorkerHarness([{ email: 'sales@example.invalid', ...sales, name: sales.user }])
    try {
      cloud.database.exec('DROP TABLE vehicle_manual_hold_events')
      const revision = cloud.revision()
      const bootstrap = await cloud.call('GET', '/api/bootstrap', 'sales@example.invalid')
      expect(bootstrap.status).toBe(200)
      expect(bootstrap.json).toMatchObject({ manualHoldsEnabled: false, dispositionsEnabled: true, savedListsEnabled: true })
      expect(bootstrap.json.vehicles.length).toBeGreaterThan(0)
      const detail = await cloud.call('GET', `/api/vehicles/${VIN}/manual-hold`, 'sales@example.invalid')
      expect(detail).toMatchObject({ status: 200, json: { enabled: false, canManage: false, state: null, history: [] } })
      const blocked = await cloud.call('POST', `/api/vehicles/${VIN}/manual-hold`, 'sales@example.invalid', input)
      expect(blocked).toMatchObject({ status: 503, json: { code: 'MIGRATION_REQUIRED' } })
      expect(cloud.revision()).toBe(revision)
      expect(await appReadiness(cloud.env)).toMatchObject({ ready: false, manualHoldStorage: false, dispositionStorage: true, savedListsStorage: true })
      expect(cloud.revision()).toBe(revision)
    } finally { cloud.close() }
  })
  it('matches healthy Node demo and Worker hold capabilities and HTTP create, replay, read and release behavior', async () => {
    const { service } = local()
    const nodeServer = createInventoryServer({ service })
    const nodeFetch = globalThis.fetch
    const cloud = await createCloudWorkerHarness([{ email: 'sales@example.invalid', ...sales, name: sales.user }])
    try {
      await new Promise(resolve => nodeServer.listen(0, '127.0.0.1', resolve))
      const baseUrl = `http://127.0.0.1:${nodeServer.address().port}`
      const callNode = async (method, path, body, key = 'synthetic-parity') => {
        const response = await nodeFetch(`${baseUrl}${path}`, {
          method, headers: { 'content-type': 'application/json', 'x-inventory-demo-role': sales.role,
            'x-inventory-demo-store': sales.store, 'x-inventory-demo-user': sales.user, 'idempotency-key': key },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return { status: response.status, json: await response.json() }
      }
      const path = `/api/vehicles/${VIN}/manual-hold`
      const cloudCall = (method, body, key = 'synthetic-parity') => cloud.call(method, path, 'sales@example.invalid', body, { 'idempotency-key': key })
      for (const response of [await callNode('GET', '/api/bootstrap'), await cloud.call('GET', '/api/bootstrap', 'sales@example.invalid')]) {
        expect(response).toMatchObject({ status: 200, json: { manualHoldsEnabled: true, dispositionsEnabled: true, savedListsEnabled: true } })
      }
      expect(await appReadiness(cloud.env)).toMatchObject({ ready: true, manualHoldStorage: true, dispositionStorage: true, savedListsStorage: true })
      const emptyRevision = cloud.revision()
      for (const [index, note] of [contactNotes[0], contactNotes[1], contactNotes[3]].entries()) {
        for (const response of [await callNode('POST', path, { ...input, note }, `contact-create-${index}`), await cloudCall('POST', { ...input, note }, `contact-create-${index}`)]) {
          expect(response).toMatchObject({ status: 422, json: { code: 'INVALID_MANUAL_HOLD_INPUT' } })
        }
      }
      expect(service.getManualHold(VIN, sales)).toMatchObject({ state: null, version: 0, history: [] })
      expect(cloud.database.prepare('SELECT COUNT(*) AS count FROM vehicle_manual_hold_events').get().count).toBe(0)
      expect(cloud.revision()).toBe(emptyRevision)
      const expectation = { enabled: true, canManage: true, state: 'active', version: 1, customerLabel: input.customerLabel,
        note: input.note, updatedBy: sales.user, ownedByCurrentUser: true }
      for (const response of [await callNode('POST', path, input), await cloudCall('POST', input)]) {
        expect(response).toMatchObject({ status: 201, json: expectation })
      }
      for (const response of [await callNode('POST', path, input), await cloudCall('POST', input)]) {
        expect(response).toMatchObject({ status: 200, json: expectation })
      }
      for (const response of [await callNode('GET', path), await cloudCall('GET')]) {
        expect(response).toMatchObject({ status: 200, json: { ...expectation, history: [expect.objectContaining(expectation)] } })
      }
      const nodeBefore = service.getManualHold(VIN, sales)
      const cloudBefore = (await cloudCall('GET')).json
      const revisionBefore = cloud.revision()
      for (const [state, note] of [['active', contactNotes[3]], ['released', contactNotes[0]]]) {
        const rejectedInput = { ...input, state, expectedVersion: 1, note }
        for (const response of [await callNode('POST', path, rejectedInput, `contact-${state}`), await cloudCall('POST', rejectedInput, `contact-${state}`)]) {
          expect(response).toMatchObject({ status: 422, json: { code: 'INVALID_MANUAL_HOLD_INPUT' } })
        }
      }
      expect(service.getManualHold(VIN, sales)).toEqual(nodeBefore)
      expect((await cloudCall('GET')).json).toEqual(cloudBefore)
      expect(cloud.database.prepare('SELECT COUNT(*) AS count FROM vehicle_manual_hold_events').get().count).toBe(1)
      expect(cloud.revision()).toBe(revisionBefore)
      const release = { state: 'released', expectedVersion: 1, note: 'Synthetic customer selected another unit' }
      for (const response of [await callNode('POST', path, release, 'synthetic-release'), await cloudCall('POST', release, 'synthetic-release')]) {
        expect(response).toMatchObject({ status: 201, json: { enabled: true, state: 'released', version: 2, note: release.note,
          history: [expect.objectContaining({ state: 'released' }), expect.objectContaining({ state: 'active' })] } })
      }
    } finally {
      await new Promise(resolve => nodeServer.close(resolve))
      cloud.close()
    }
  })
})
