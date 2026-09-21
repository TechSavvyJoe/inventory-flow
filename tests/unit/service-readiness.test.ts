// @ts-nocheck -- exercises the same core through SQLite and the D1 adapter.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { createInventoryServer } from '../../server/api.mjs'
import { loadD1Repository, RepositoryConflictError } from '../../cloudflare/src/repository.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'
import { serviceReadinessView, serviceStore } from '../../server/service-readiness.mjs'
import { serviceIntakeRows } from '../../server/service-intake.mjs'

const databases = []
const servers = []
afterEach(async () => {
  while (servers.length) await new Promise((resolve) => servers.pop().close(resolve))
  while (databases.length) databases.pop().close()
})
const VIN = 'TESTDATAHWELL0001'
const manager = { role: 'manager', store: 'Howell', user: 'Synthetic Manager', userId: 'synthetic-manager-1' }
function local() {
  const db = openInventoryDatabase()
  databases.push(db)
  importRelease(db, buildSyntheticRelease())
  const service = () => createInventoryService({ database: db, now: () => SYNTHETIC_NOW })
  return { db, service: service(), reload: service }
}
async function cloud() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  applySyntheticSchema(db)
  const d1 = sqliteD1(db)
  const cold = async () => {
    const repo = await loadD1Repository(d1, buildSyntheticRelease())
    return { ...repo, service: createInventoryServiceCore({ database: repo.database, repository: repo.repository, now: () => SYNTHETIC_NOW }) }
  }
  return { db, cold }
}

describe('manager service readiness ledger', () => {
  it('persists a verified arrival as Waiting after later imports, time passage, and removal/reappearance', () => {
    const { db, reload } = local()
    const arrival = buildSyntheticRelease()
    arrival.publicChangeEvents = [{ type: 'new_arrival', vin: VIN, reportDate: '2026-08-30' }]
    importRelease(db, arrival)
    expect(reload().getServiceReadiness(VIN, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'new_arrival', version: 0, completedAt: null })
    importRelease(db, { ...buildSyntheticRelease(), publicChangeEvents: [] })
    const future = createInventoryService({ database: db, now: () => new Date('2027-08-30T12:00:00Z') })
    expect(future.getServiceReadiness(VIN, manager).status).toBe('needs_service')
    importRelease(db, { ...buildSyntheticRelease(), vehicles: buildSyntheticRelease().vehicles.filter((vehicle) => vehicle.vin !== VIN) })
    importRelease(db, buildSyntheticRelease())
    expect(reload().getServiceReadiness(VIN, manager).status).toBe('needs_service')
    reload().updateServiceReadiness(VIN, { status: 'serviced', expectedVersion: 0, serviceDate: '2026-08-30' }, manager, 'ready-arrival')
    importRelease(db, arrival)
    expect(reload().getServiceReadiness(VIN, manager)).toMatchObject({ status: 'serviced', readinessBasis: 'manager_updated', completedAt: '2026-08-30' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_intake').get().n).toBe(1)
  })

  it('does not treat listing age, hold status, or non-arrival feed changes as service work', () => {
    const release = buildSyntheticRelease()
    release.publicChangeEvents = [{ type: 'price_change', vin: VIN, reportDate: release.reportDate }, { type: 'new_arrival', vin: 'TESTDATAMISSING01', reportDate: release.reportDate }]
    expect(serviceIntakeRows(release, SYNTHETIC_NOW.toISOString())).toEqual([])
    const { service } = local()
    expect(service.getServiceReadiness(VIN, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed', completedAt: null, serviceEnteredAt: null })
    expect(() => service.updateServiceReadiness(VIN, { status: 'unknown', expectedVersion: 0 }, manager, 'removed-option')).toThrowError(expect.objectContaining({ code: 'INVALID_SERVICE_STATUS' }))
  })

  it('maps historical unknown to Waiting without mutating its recorded event or fabricating dates', () => {
    const row = { status: 'unknown', version: 4, actor: 'Historic manager', updated_at: '2026-08-20T12:00:00Z' }
    expect(serviceReadinessView({ vin: VIN, homeStore: 'Howell' }, row, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'legacy_review', version: 4, completedAt: null })
    expect(row.status).toBe('unknown')
  })

  it('does not infer readiness from source listing, hold, warranty or sold-board signals', () => {
    const vehicle = {
      vin: VIN, homeStore: 'Howell', daysListed: 500, inventoryDate: '2025-04-01',
      websiteStatus: 'Available', dealerOn: { inStock: true }, certified: true,
      hold: { state: 'none_observed' },
      fordOasis: { warrantyStartDate: '2024-03-01', openFieldServiceActions: [] },
      managerDisposition: { soldManagerLog: true, deliveredManagerLog: true },
    }
    expect(serviceReadinessView(vehicle, null, manager)).toMatchObject({
      status: 'needs_service', readinessBasis: 'unconfirmed', version: 0,
      completedAt: null, serviceEnteredAt: null, updatedAt: null, updatedBy: null,
    })
  })

  it('uses only a current post-intake AutoCheck inspection to mark non-Ford inventory Ready', () => {
    const vehicle = {
      vin: VIN, homeStore: 'Howell', make: 'Cadillac', inventoryDate: '2026-08-30',
      autoCheckReport: {
        dataState: 'current',
        recentInspection: { date: '2026-08-30', types: ['Multiple Point Vehicle Inspection'] },
      },
    }
    expect(serviceReadinessView(vehicle, null, manager)).toMatchObject({
      status: 'serviced', readinessBasis: 'autocheck_post_intake_inspection', completedAt: '2026-08-30',
      readinessEvidence: { source: 'autocheck', inspectionDate: '2026-08-30', types: ['Multiple Point Vehicle Inspection'] },
    })
    expect(serviceReadinessView({ ...vehicle, make: 'Ford' }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed' })
    expect(serviceReadinessView({ ...vehicle, autoCheckReport: { dataState: 'stale', recentInspection: vehicle.autoCheckReport.recentInspection } }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed' })
    expect(serviceReadinessView({ ...vehicle, autoCheckReport: { dataState: 'current', recentInspection: { date: '2026-08-29', types: ['Vehicle Inspected'] } } }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed' })
    expect(serviceReadinessView({ ...vehicle, inventoryDate: '2026-08-01', serviceIntake: { first_arrival_date: '2026-08-31' } }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'new_arrival' })
    expect(serviceReadinessView(vehicle, { status: 'needs_service', version: 1, actor: manager.user }, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'manager_updated', readinessEvidence: null })
  })

  it('uses only a current post-intake Ford service-history inspection to mark Ford and Lincoln inventory Ready', () => {
    const serviceHistory = {
      dataState: 'current', historyCaptured: true,
      recentInspection: {
        openDate: '08/14/2026', closeDate: '09/11/2026',
        inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
      },
    }
    const vehicle = {
      vin: VIN, homeStore: 'Howell', make: 'Ford', inventoryDate: '2026-08-13',
      fordOasis: { serviceHistory },
    }
    expect(serviceReadinessView(vehicle, null, manager)).toMatchObject({
      status: 'serviced', readinessBasis: 'ford_service_history_inspection',
      serviceEnteredAt: '2026-08-14', completedAt: '2026-09-11',
      readinessEvidence: {
        source: 'ford_service_history', inspectionDate: '2026-09-11',
        inServiceDate: '2026-08-14', readyDate: '2026-09-11',
        types: ['Certified Blue Oval inspection'],
      },
    })
    expect(serviceReadinessView({ ...vehicle, make: 'Lincoln' }, null, manager)).toMatchObject({ status: 'serviced', readinessBasis: 'ford_service_history_inspection' })
    expect(serviceReadinessView({ ...vehicle, make: 'Cadillac' }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed' })
    expect(serviceReadinessView({ ...vehicle, inventoryDate: '2026-08-15' }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed' })
    expect(serviceReadinessView({ ...vehicle, fordOasis: { serviceHistory: { ...serviceHistory, dataState: 'stale' } } }, null, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed' })
    expect(serviceReadinessView(vehicle, { status: 'needs_service', version: 1, actor: manager.user }, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'manager_updated', readinessEvidence: null })
  })

  it.each(['needs_service', 'in_service', 'serviced'])('preserves the manager %s state over feed arrival and baseline signals', (status) => {
    const row = { status, version: 3, service_entered_at: status === 'needs_service' ? null : '2026-08-28', completed_at: status === 'serviced' ? '2026-08-30' : null, actor: manager.user }
    expect(serviceReadinessView({ vin: VIN, homeStore: 'Howell', serviceIntake: { first_arrival_date: '2026-08-30' } }, row, manager)).toMatchObject({
      status, readinessBasis: 'manager_updated', version: 3,
      serviceEnteredAt: row.service_entered_at, completedAt: row.completed_at, updatedBy: manager.user,
    })
  })

  it('keeps unconfirmed inventory Waiting across cold D1 loads without creating a manager attestation', async () => {
    const { db, cold } = await cloud()
    const first = await cold()
    expect(first.service.getVehicle(VIN, manager).serviceReadiness).toMatchObject({
      status: 'needs_service', readinessBasis: 'unconfirmed', version: 0,
      completedAt: null, serviceEnteredAt: null, updatedAt: null, updatedBy: null,
    })
    expect((await cold()).service.bootstrap(manager).vehicles.find(vehicle => vehicle.vin === VIN).serviceReadiness.status).toBe('needs_service')
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_events').get().n).toBe(0)
    expect((await first.commit()).committed).toBe(false)
  })

  it('reads durable intake through cold D1 snapshots and never overrides a later manager action', async () => {
    const { db, cold } = await cloud()
    db.prepare('INSERT INTO vehicle_service_intake (vin, first_arrival_date, observed_at) VALUES (?, ?, ?)').run(VIN, '2026-08-30', SYNTHETIC_NOW.toISOString())
    expect((await cold()).service.getServiceReadiness(VIN, manager)).toMatchObject({ status: 'needs_service', readinessBasis: 'new_arrival', version: 0 })
    const next = await cold()
    next.service.updateServiceReadiness(VIN, { status: 'serviced', expectedVersion: 0, serviceDate: '2026-08-30' }, manager, 'cloud-arrival-ready')
    await next.commit()
    expect((await cold()).service.getServiceReadiness(VIN, manager)).toMatchObject({ status: 'serviced', readinessBasis: 'manager_updated', completedAt: '2026-08-30' })
    expect(db.prepare('SELECT first_arrival_date FROM vehicle_service_intake WHERE vin = ?').get(VIN).first_arrival_date).toBe('2026-08-30')
  })

  it('keeps unconfirmed existing inventory Waiting, persists the full cycle and retains independent dates', () => {
    const { db, service, reload } = local()
    expect(service.getVehicle(VIN, manager).serviceReadiness).toMatchObject({ status: 'needs_service', version: 0, canManage: true, store: 'Howell', completedAt: null, updatedBy: null, readinessBasis: 'unconfirmed' })
    const waiting = service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0, notes: 'Synthetic brake inspection' }, manager, 'service-waiting')
    expect(waiting.record).toMatchObject({ status: 'needs_service', version: 1, serviceEnteredAt: null, completedAt: null, updatedBy: manager.user })
    reload().updateServiceReadiness(VIN, { status: 'in_service', expectedVersion: 1, serviceDate: '2026-08-28' }, manager, 'service-started')
    const finished = reload().updateServiceReadiness(VIN, { status: 'serviced', expectedVersion: 2, serviceDate: '2026-08-30', notes: 'Synthetic work completed' }, manager, 'service-complete')
    expect(finished.record).toMatchObject({ status: 'serviced', version: 3, serviceEnteredAt: '2026-08-28', completedAt: '2026-08-30' })
    expect(reload().getServiceReadiness(VIN, manager).history.map((row) => row.status)).toEqual(['serviced', 'in_service', 'needs_service'])
    expect(reload().bootstrap(manager).vehicles.find((vehicle) => vehicle.vin === VIN).serviceReadiness.status).toBe('serviced')
    expect(db.prepare('SELECT actor_user_id FROM vehicle_service_events').all().every((row) => row.actor_user_id === manager.userId)).toBe(true)
    expect(() => db.exec('DELETE FROM vehicle_service_events')).toThrow('append-only')
    expect(() => db.exec("UPDATE vehicle_service_events SET actor = 'spoofed'")).toThrow('append-only')
    importRelease(db, buildSyntheticRelease())
    expect(reload().getServiceReadiness(VIN, manager).status).toBe('serviced')
    const reopened = reload().updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 3 }, manager, 'service-reopen')
    expect(reopened.record).toMatchObject({ status: 'needs_service', serviceEnteredAt: null, completedAt: null, version: 4 })
    expect(reopened.record.history[1].completedAt).toBe('2026-08-30')
  })

  it('requires manager and matching server-computed store; ignores no client identity fields', () => {
    const { service, db } = local()
    for (const role of ['sales', 'coordinator', 'porter', 'driver']) {
      expect(() => service.updateServiceReadiness(VIN, { status: 'serviced', expectedVersion: 0, serviceDate: '2026-08-30' }, { ...manager, role }, `forbidden-${role}`)).toThrowError(expect.objectContaining({ status: 403 }))
    }
    expect(() => service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0 }, { ...manager, store: 'Lincoln' }, 'wrong-store')).toThrowError(expect.objectContaining({ status: 403 }))
    expect(() => service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0, actor: 'spoofed' }, manager, 'spoof-actor')).toThrowError(expect.objectContaining({ code: 'INVALID_SERVICE_INPUT' }))
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_events').get().n).toBe(0)
    expect(service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0 }, { ...manager, role: 'group_manager', store: 'Lincoln' }, 'group-save').created).toBe(true)
    expect(serviceStore({ homeStore: 'Howell', movement: { currentLocation: 'Lincoln', locationConfidence: 'verified' } })).toBe('Lincoln')
    expect(serviceStore({ homeStore: 'Howell', movement: { currentLocation: 'Lincoln', locationConfidence: 'reported' } })).toBe('Howell')
    const destination = { ...manager, store: 'Fowlerville' }
    const salesperson = { ...destination, role: 'sales', user: 'Synthetic salesperson' }
    const move = service.createTransfer({ vin: VIN, neededBy: '2026-08-30T18:00:00Z', reason: 'Synthetic service-store authorization check' }, salesperson, 'service-move')
    service.appendTransferEvent(move.record.id, { type: 'request_approved', availabilityConfirmed: true }, destination, 'service-move-approved')
    service.appendTransferEvent(move.record.id, { type: 'vehicle_departed' }, salesperson, 'service-move-departed')
    service.appendTransferEvent(move.record.id, { type: 'arrived' }, salesperson, 'service-move-arrived')
    expect(service.getServiceReadiness(VIN, destination)).toMatchObject({ store: 'Fowlerville', canManage: true })
    expect(() => service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 1 }, manager, 'former-owner')).toThrowError(expect.objectContaining({ status: 403 }))
    expect(service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 1 }, destination, 'verified-owner').created).toBe(true)
  })

  it('replays one request without appending and rejects changed keys, stale versions, invalid or future dates', () => {
    const { service, db } = local()
    const input = { status: 'in_service', expectedVersion: 0, serviceDate: '2026-08-28' }
    const saved = service.updateServiceReadiness(VIN, input, manager, 'same-key')
    expect(service.updateServiceReadiness(VIN, input, manager, 'same-key')).toEqual({ created: false, record: saved.record })
    expect(() => service.updateServiceReadiness(VIN, { ...input, serviceDate: '2026-08-29' }, manager, 'same-key')).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }))
    expect(() => service.updateServiceReadiness(VIN, input, { ...manager, userId: 'another-manager-same-name' }, 'same-key')).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }))
    expect(() => service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0 }, manager, 'stale-key')).toThrowError(expect.objectContaining({ code: 'SERVICE_VERSION_CONFLICT' }))
    for (const serviceDate of ['2026-02-30', '2026-08-31', '2026-08-27', 'invalid', '']) {
      expect(() => service.updateServiceReadiness(VIN, { status: 'serviced', expectedVersion: 1, serviceDate }, manager, `date-${serviceDate}`)).toThrowError(expect.objectContaining({ code: 'INVALID_SERVICE_DATE' }))
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_events').get().n).toBe(1)
  })

  it('omits freeform service notes from bootstrap and transport responses', () => {
    const { service } = local()
    const notes = 'SYNTHETIC PRIVATE NOTE'
    service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0, notes }, manager, 'private-note')
    expect(service.getServiceReadiness(VIN, manager).notes).toBe(notes)
    expect(JSON.stringify(service.bootstrap(manager))).not.toContain(notes)
    for (const role of ['driver', 'porter', 'coordinator']) {
      const response = service.getServiceReadiness(VIN, { ...manager, role })
      expect(response.status).toBe('needs_service')
      expect(response.history).toEqual([])
      expect(JSON.stringify(response)).not.toContain(notes)
    }
  })

  it('returns the latest local state when retrying a saved request after another manager updates it', () => {
    const { service, db, reload } = local()
    const input = { status: 'in_service', expectedVersion: 0, serviceDate: '2026-08-28', notes: 'Synthetic service started' }
    service.updateServiceReadiness(VIN, input, manager, 'delayed-local-retry')
    const otherManager = { ...manager, user: 'Synthetic second manager', userId: 'synthetic-manager-2' }
    const completed = reload().updateServiceReadiness(VIN, {
      status: 'serviced', expectedVersion: 1, serviceDate: '2026-08-30', notes: 'Synthetic completion recorded later',
    }, otherManager, 'later-local-completion')

    const replay = reload().updateServiceReadiness(VIN, input, manager, 'delayed-local-retry')

    expect(replay).toEqual({ created: false, record: completed.record })
    expect(replay.record).toMatchObject({ status: 'serviced', version: 2, updatedBy: otherManager.user })
    expect(replay.record.history.map((entry) => entry.version)).toEqual([2, 1])
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_events').get().n).toBe(2)
    expect(reload().getServiceReadiness(VIN, manager)).toEqual(replay.record)
  })

  it('returns the latest cold D1 state on a delayed retry without committing another event', async () => {
    const { db, cold } = await cloud()
    const original = await cold()
    const input = { status: 'in_service', expectedVersion: 0, serviceDate: '2026-08-28', notes: 'Synthetic D1 start' }
    original.service.updateServiceReadiness(VIN, input, manager, 'delayed-cloud-retry')
    await original.commit()
    const later = await cold()
    const otherManager = { ...manager, user: 'Synthetic second manager', userId: 'synthetic-manager-2' }
    const completed = later.service.updateServiceReadiness(VIN, {
      status: 'serviced', expectedVersion: 1, serviceDate: '2026-08-30', notes: 'Synthetic D1 completion',
    }, otherManager, 'later-cloud-completion')
    await later.commit()
    const retry = await cold()

    const replay = retry.service.updateServiceReadiness(VIN, input, manager, 'delayed-cloud-retry')

    expect(replay).toEqual({ created: false, record: completed.record })
    expect(replay.record.history.map((entry) => entry.version)).toEqual([2, 1])
    expect((await retry.commit()).committed).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_events').get().n).toBe(2)
    expect((await cold()).service.getServiceReadiness(VIN, manager)).toEqual(replay.record)
  })

  it('persists and audits cold D1 writes, retries, and two-manager conflicts atomically', async () => {
    const { db, cold } = await cloud()
    const first = await cold()
    const second = await cold()
    const input = { status: 'in_service', expectedVersion: 0, serviceDate: '2026-08-28', notes: 'Synthetic D1 service' }
    first.service.updateServiceReadiness(VIN, input, manager, 'cloud-first')
    second.service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0 }, manager, 'cloud-second')
    await first.commit()
    await expect(second.commit()).rejects.toBeInstanceOf(RepositoryConflictError)
    const refreshed = await cold()
    expect(refreshed.service.getServiceReadiness(VIN, manager)).toMatchObject({ status: 'in_service', version: 1, serviceEnteredAt: '2026-08-28' })
    expect(refreshed.service.updateServiceReadiness(VIN, input, manager, 'cloud-first').created).toBe(false)
    expect(() => refreshed.service.updateServiceReadiness(VIN, { status: 'needs_service', expectedVersion: 0 }, manager, 'cloud-second')).toThrowError(expect.objectContaining({ code: 'SERVICE_VERSION_CONFLICT' }))
    expect((await refreshed.commit()).committed).toBe(false)
    const complete = await cold()
    complete.service.updateServiceReadiness(VIN, { status: 'serviced', expectedVersion: 1, serviceDate: '2026-08-30' }, manager, 'cloud-complete')
    await complete.commit()
    expect((await cold()).service.getServiceReadiness(VIN, manager)).toMatchObject({ status: 'serviced', serviceEnteredAt: '2026-08-28', completedAt: '2026-08-30', version: 2 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM vehicle_service_events').get().n).toBe(2)
    expect(() => db.exec('DELETE FROM vehicle_service_events')).toThrow('append-only')
  })

  it('exposes persisted service via the authenticated Node endpoint without accepting payload role overrides', async () => {
    const { service } = local()
    const server = createInventoryServer({ service, identityResolver: { resolve: () => manager } })
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${server.address().port}/api/vehicles/${VIN}/service`
    const post = (input, key) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) })
    expect(await (await fetch(endpoint)).json()).toMatchObject({ status: 'needs_service', readinessBasis: 'unconfirmed', completedAt: null, serviceEnteredAt: null, updatedBy: null })
    expect((await post({ status: 'needs_service', expectedVersion: 0, role: 'group_manager' }, 'http-spoof')).status).toBe(422)
    expect((await post({ status: 'needs_service', expectedVersion: 0 }, 'http-save')).status).toBe(201)
    expect((await (await fetch(endpoint)).json()).status).toBe('needs_service')
  })

  it('rejects malformed encoded API path segments as a client error', async () => {
    const { service } = local()
    const server = createInventoryServer({ service, identityResolver: { resolve: () => manager } })
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${server.address().port}/api/vehicles/%E0%A4%A/service`

    const response = await fetch(endpoint)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid path', code: 'INVALID_PATH' })
  })
})
