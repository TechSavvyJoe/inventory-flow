// @ts-nocheck -- D1's Worker binding is exercised through real SQLite semantics.
// @vitest-environment node

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { getCurrentDataset, importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { d1SnapshotRepository, datasetFromRelease, loadD1Repository, RepositoryConflictError } from '../../cloudflare/src/repository.mjs'

const openDatabases = []
afterEach(() => { while (openDatabases.length) openDatabases.pop().close() })

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:')
  openDatabases.push(sqlite)
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const name of ['0001_initial.sql', '0002_app_access.sql', '0003_transport_assignment_identity.sql', '0007_service_readiness.sql', '0008_service_intake.sql']) {
    sqlite.exec(readFileSync(new URL(`../../cloudflare/migrations/${name}`, import.meta.url), 'utf8'))
  }
  return {
    sqlite,
    prepare(sql) {
      return {
        sql, params: [],
        bind(...params) { return { sql, params } },
      }
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ sql, params = [] }) => {
          const stmt = sqlite.prepare(sql)
          if (/^\s*SELECT\b/i.test(sql)) return { success: true, results: stmt.all(...params), meta: {} }
          const { changes } = stmt.run(...params)
          return { success: true, results: [], meta: { changes } }
        })
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw new Error(`D1_ERROR: ${error.message}`, { cause: error })
      }
    },
  }
}

const requestAt = SYNTHETIC_NOW.toISOString()
function syntheticRequest(id = 'SYNTHETIC-request-a', overrides = {}) {
  return {
    id, vin: '1FTEW1EP7PFA00001', stockAtRequest: 'SYNTHETIC-001', vehicleNameAtRequest: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS',
    homeStoreId: 'Howell', homeStoreConfirmed: false, requestingStoreId: 'Fowlerville', destinationStoreId: 'Fowlerville',
    requestedBy: 'Synthetic salesperson', requestedAt: requestAt, neededBy: requestAt,
    reason: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS test request', customerReference: null, customerAppointment: false,
    approvalOwner: 'Synthetic manager', approvedBy: null, priority: 'normal', status: 'requested', movementStatus: 'at_home',
    dealStatus: 'not_confirmed', deliveryStatus: 'not_confirmed', currentLocationId: 'Howell', currentCustodian: null,
    transportAssignee: null, transportAssigneeUserId: null, nextAction: 'Review request', nextActionOwner: 'Synthetic manager', dueAt: requestAt,
    returnRequired: true, returnDueAt: null, lastConfirmedAt: requestAt, locationConfidence: 'reported', closedAt: null,
    createdAt: requestAt, updatedAt: requestAt, idempotencyKey: `${id}:key`, ...overrides,
  }
}
function syntheticEvent(id = 'SYNTHETIC-event-a', overrides = {}) {
  return {
    id, eventType: 'requested', label: 'Requested', actor: 'Synthetic salesperson', actorUserId: 'synthetic-sales-1',
    actorRole: 'sales', storeId: 'Fowlerville',
    fromLocationId: 'Howell', toLocationId: 'Fowlerville', occurredAt: requestAt, note: null, createdAt: requestAt,
    idempotencyKey: `${id}:key`, ...overrides,
  }
}
function syntheticAttention(overrides = {}) {
  return {
    attentionKey: 'SYNTHETIC-attention', sourceType: 'transfer', sourceId: 'SYNTHETIC-request-a', status: 'acknowledged', priority: 'normal',
    assignedTo: 'Synthetic salesperson', assignedRole: 'sales', followUpAt: null, resolutionCode: null, resolutionNote: null,
    createdAt: requestAt, updatedAt: requestAt, lastActor: 'Synthetic salesperson', lastActorRole: 'sales', lastStoreId: 'Howell', ...overrides,
  }
}
function normalizeDataset(dataset) {
  const normalized = structuredClone(dataset)
  normalized.state.current_manifest_path = ''
  for (const source of Object.values(normalized.sourceRuns)) {
    if (source) { source.snapshot_path = ''; source.manifest_path = '' }
  }
  for (const key of ['publicRows', 'crmRows', 'holdRows', 'resourceRows']) normalized[key].sort((a, b) => a.vin.localeCompare(b.vin))
  return normalized
}

describe('D1 shared operational repository', () => {
  it('commits a direct move and its physical audit as one cloud transaction', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    const manager = { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }
    const movedAt = new Date(SYNTHETIC_NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const input = {
      vin: 'TESTDATAHWELL0002', intent: 'direct', destinationStore: 'Ford Detroit', movedAt,
      reason: 'Synthetic customer showing', returnRequired: true,
    }
    const cold = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => SYNTHETIC_NOW }) }
    }

    const first = await cold()
    const created = first.service.createTransfer(input, manager, 'simple-cloud-direct')
    expect(created.record).toMatchObject({
      requestStatus: 'arrived', movementStatus: 'at_requesting_store',
      homeStore: 'Howell', destination: 'Ford Detroit', currentLocation: 'Ford Detroit',
      lastConfirmedAt: movedAt, locationConfidence: 'verified',
    })
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(0)
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(0)
    await first.commit()
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(1)
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(1)
    expect(d1.sqlite.prepare('SELECT status, movement_status, current_location_id FROM transfer_requests').get()).toEqual({
      status: 'arrived', movement_status: 'at_requesting_store', current_location_id: 'Ford Detroit',
    })
    expect(d1.sqlite.prepare('SELECT event_type, store_id, from_location_id, to_location_id, occurred_at FROM transfer_events').get()).toEqual({
      event_type: 'direct_move_recorded', store_id: 'Howell', from_location_id: 'Howell', to_location_id: 'Ford Detroit', occurred_at: movedAt,
    })

    const restored = await cold()
    expect(restored.service.getTransfer(created.record.id, manager).events).toHaveLength(1)
    expect(restored.service.createTransfer(input, manager, 'simple-cloud-direct')).toMatchObject({ created: false, record: { id: created.record.id } })
    expect((await restored.commit()).committed).toBe(false)
  })

  it('commits a direct reroute by superseding the old cloud row in the same transaction', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    const manager = { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }
    const cold = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => SYNTHETIC_NOW }) }
    }
    const firstInput = {
      vin: 'TESTDATAHWELL0002', intent: 'direct', destinationStore: 'Ford Detroit',
      movedAt: '2026-08-30T11:00:00Z', reason: 'Synthetic first destination', returnRequired: true,
    }
    const first = await cold()
    const original = first.service.createTransfer(firstInput, manager, 'cloud-reroute-a').record
    first.service.appendTransferEvent(original.id, {
      type: 'note_added', note: 'Backdated passive note before the direct physical event',
      occurredAt: '2026-08-30T10:00:00Z',
    }, manager, 'cloud-reroute-backdated-note')
    await first.commit()

    const reroute = await cold()
    const replacement = reroute.service.createTransfer({
      ...firstInput, destinationStore: 'Lincoln', movedAt: '2026-08-30T12:00:00Z', reason: 'Synthetic corrected destination',
    }, manager, 'cloud-reroute-b').record
    expect(replacement.events[0]).toMatchObject({ fromLocation: 'Ford Detroit', toLocation: 'Lincoln' })
    expect(d1.sqlite.prepare('SELECT status FROM transfer_requests WHERE id=?').get(original.id).status).toBe('arrived')
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(1)
    await reroute.commit()

    expect(d1.sqlite.prepare('SELECT status FROM transfer_requests WHERE id=?').get(original.id).status).toBe('canceled')
    expect(d1.sqlite.prepare('SELECT status, current_location_id FROM transfer_requests WHERE id=?').get(replacement.id))
      .toEqual({ status: 'arrived', current_location_id: 'Lincoln' })
    expect(d1.sqlite.prepare("SELECT event_type, from_location_id, to_location_id FROM transfer_events WHERE transfer_request_id=? AND event_type='direct_move_superseded'").get(original.id))
      .toEqual({ event_type: 'direct_move_superseded', from_location_id: 'Ford Detroit', to_location_id: 'Lincoln' })
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM transfer_requests WHERE status NOT IN ('declined','canceled','closed')").get().n).toBe(1)

    const replay = await cold()
    expect(replay.service.createTransfer(firstInput, manager, 'cloud-reroute-a'))
      .toMatchObject({ created: false, record: { id: original.id } })
    expect((await replay.commit()).committed).toBe(false)
  })

  it('rejects a backdated cloud direct move and audits a later move from the last physical store', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
    const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic requesting manager', userId: 'manager-1' }
    const homeManager = { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }
    let clock = new Date(SYNTHETIC_NOW)
    const tick = () => { clock = new Date(clock.getTime() + 60_000) }
    const cold = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => clock }) }
    }

    const trip = await cold()
    const requested = trip.service.createTransfer({
      vin: 'TESTDATAHWELL0001', neededBy: requestAt, reason: 'Synthetic prior showing', returnRequired: true,
    }, sales, 'prior-cloud-request').record
    trip.service.appendTransferEvent(requested.id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'prior-cloud-approval')
    tick()
    trip.service.appendTransferEvent(requested.id, { type: 'vehicle_departed' }, sales, 'prior-cloud-departure')
    tick()
    const arrived = trip.service.appendTransferEvent(requested.id, { type: 'arrived' }, sales, 'prior-cloud-arrival').record
    const latestPhysicalAt = arrived.events.at(-1).occurredAt
    await trip.commit()
    d1.sqlite.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?").run(latestPhysicalAt, requested.id)
    tick()

    const direct = {
      vin: requested.vin, intent: 'direct', destinationStore: 'Ford Detroit', movedAt: latestPhysicalAt,
      reason: 'Synthetic corrected movement', returnRequired: true,
    }
    const stale = await cold()
    expect(() => stale.service.createTransfer(direct, homeManager, 'backdated-cloud-direct'))
      .toThrowError(expect.objectContaining({ code: 'MOVE_CHRONOLOGY_CONFLICT' }))
    expect((await stale.commit()).committed).toBe(false)
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE event_type='direct_move_recorded'").get().n).toBe(0)

    const movedAt = clock.toISOString()
    const current = await cold()
    const moved = current.service.createTransfer({
      ...direct, destinationStore: 'Howell', movedAt,
    }, homeManager, 'later-cloud-direct').record
    expect(moved).toMatchObject({ homeStore: 'Howell', currentLocation: 'Howell', requestStatus: 'arrived', lastConfirmedAt: movedAt })
    expect(moved.events).toContainEqual(expect.objectContaining({
      type: 'direct_move_recorded', fromLocation: 'Fowlerville', toLocation: 'Howell', occurredAt: movedAt,
    }))
    await current.commit()
    expect(d1.sqlite.prepare("SELECT from_location_id, to_location_id, occurred_at FROM transfer_events WHERE event_type='direct_move_recorded'").get()).toEqual({
      from_location_id: 'Fowlerville', to_location_id: 'Howell', occurred_at: movedAt,
    })
  })

  it('preserves a terminal in-transit origin in a cold cloud direct correction', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
    const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic requesting manager', userId: 'manager-1' }
    const group = { role: 'group_manager', store: 'Howell', user: 'Synthetic group manager', userId: 'group-1' }
    let clock = new Date(SYNTHETIC_NOW)
    const cold = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => clock }) }
    }

    const prior = await cold()
    const requested = prior.service.createTransfer({
      vin: 'TESTDATAHWELL0001', neededBy: requestAt, reason: 'Synthetic prior transit', returnRequired: true,
    }, sales, 'cloud-transit-request').record
    prior.service.appendTransferEvent(requested.id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'cloud-transit-approval')
    clock = new Date(clock.getTime() + 60_000)
    const departed = prior.service.appendTransferEvent(requested.id, { type: 'vehicle_departed' }, sales, 'cloud-transit-departure').record
    const departedAt = departed.events.at(-1).occurredAt
    await prior.commit()
    d1.sqlite.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?").run(departedAt, requested.id)
    clock = new Date(clock.getTime() + 60_000)

    const correction = await cold()
    const movedAt = clock.toISOString()
    const moved = correction.service.createTransfer({
      vin: requested.vin, intent: 'direct', destinationStore: 'Howell', movedAt,
      reason: 'Synthetic terminal transit correction', returnRequired: true,
    }, group, 'cloud-transit-direct').record
    expect(moved.events[0]).toMatchObject({
      type: 'direct_move_recorded', fromLocation: 'In transit', toLocation: 'Howell', occurredAt: movedAt,
    })
    await correction.commit()
    expect(d1.sqlite.prepare("SELECT from_location_id, to_location_id FROM transfer_events WHERE event_type='direct_move_recorded'").get())
      .toEqual({ from_location_id: 'In transit', to_location_id: 'Howell' })
  })

  it('does not allow two concurrent simple requests for one VIN after the losing writer reloads', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
    const input = { vin: 'TESTDATAHWELL0001', neededBy: requestAt, reason: 'Synthetic concurrent request' }
    const cold = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => SYNTHETIC_NOW }) }
    }
    const first = await cold()
    const second = await cold()
    const winner = first.service.createTransfer(input, sales, 'simple-concurrent-a')
    second.service.createTransfer(input, sales, 'simple-concurrent-b')
    await first.commit()
    await expect(second.commit()).rejects.toBeInstanceOf(RepositoryConflictError)
    const retry = await cold()
    expect(() => retry.service.createTransfer(input, sales, 'simple-concurrent-b')).toThrow('already has an open move')
    expect(retry.service.createTransfer(input, sales, 'simple-concurrent-a')).toMatchObject({ created: false, record: { id: winner.record.id } })
    expect((await retry.commit()).committed).toBe(false)
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(1)
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(1)
  })

  it('persists the simple manager approval and assignment-free move across cold cloud requests', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
    const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic manager', userId: 'manager-1' }
    const home = { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }
    const cold = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => SYNTHETIC_NOW }) }
    }
    const first = await cold()
    const created = first.service.createTransfer({ vin: 'TESTDATAHWELL0001', neededBy: requestAt, reason: 'Synthetic request', returnRequired: true }, sales, 'simple-cloud-request')
    await first.commit()
    const id = created.record.id
    for (const [event, context, status, dealStatus] of [
      [{ type: 'request_approved', availabilityConfirmed: true }, manager, 'approved', 'not_confirmed'],
      [{ type: 'customer_showing' }, sales, 'customer_showing', 'customer_showing'],
      [{ type: 'return_started' }, sales, 'return_in_transit', 'customer_showing'],
      [{ type: 'returned_home' }, home, 'closed', 'customer_showing'],
    ]) {
      const current = await cold()
      expect(current.service.getTransfer(id, context).workflowMode).toBe('simple')
      const mutation = current.service.appendTransferEvent(id, event, context, `simple-cloud-${event.type}`)
      expect(mutation.record.requestStatus).toBe(status)
      expect(mutation.record.deliveryStatus).toBe('not_confirmed')
      expect(mutation.record.dealStatus).toBe(dealStatus)
      await current.commit()
      const restored = await cold()
      expect(restored.service.getTransfer(id, context).requestStatus).toBe(status)
      expect(restored.service.appendTransferEvent(id, event, context, `simple-cloud-${event.type}`).created).toBe(false)
      expect((await restored.commit()).committed).toBe(false)
    }
    const final = await cold()
    const complete = final.service.getTransfer(id, home)
    expect(complete.currentLocation).toBe('Howell')
    expect(complete.events).toHaveLength(5)
    expect(complete.events.map((event) => event.type).sort()).toEqual([
      'requested', 'request_approved', 'customer_showing', 'return_started', 'returned_home',
    ].sort())
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE event_type IN (?, ?, ?)').get('manager_reviewed', 'transport_assigned', 'return_assigned').n).toBe(0)
    expect(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM public_vehicle_snapshots').get().n).toBe(0)
  })

  it('preserves complete source, hold, backup, CDK and resource row shapes without copying source evidence to D1', async () => {
    const release = buildSyntheticRelease()
    const local = openInventoryDatabase()
    openDatabases.push(local)
    importRelease(local, release, { loadedAt: requestAt })
    const d1 = fakeD1()
    const cloud = await loadD1Repository(d1, release, { loadedAt: requestAt })
    expect(normalizeDataset(cloud.repository.getCurrentDataset(cloud.database))).toEqual(normalizeDataset(getCurrentDataset(local)))
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM public_vehicle_snapshots').get().count).toBe(0)
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM crm_vehicle_snapshots').get().count).toBe(0)
    expect(await cloud.commit()).toEqual({ committed: false, revision: 0 })
  })

  it('matches local service output for every role, including private-evidence redaction', async () => {
    const release = buildSyntheticRelease()
    const local = openInventoryDatabase()
    openDatabases.push(local)
    importRelease(local, release, { loadedAt: requestAt })
    const cloud = await loadD1Repository(fakeD1(), release, { loadedAt: requestAt })
    const nodeService = createInventoryService({ database: local, now: () => SYNTHETIC_NOW })
    const cloudService = createInventoryServiceCore({ database: cloud.database, repository: cloud.repository, now: () => SYNTHETIC_NOW })
    for (const role of ['sales', 'manager', 'group_manager', 'coordinator', 'driver', 'porter']) {
      const context = { role, store: 'Howell', user: 'Synthetic user' }
      expect(cloudService.bootstrap(context)).toEqual(nodeService.bootstrap(context))
      for (const vehicle of release.vehicles) expect(cloudService.getVehicle(vehicle.vin, context)).toEqual(nodeService.getVehicle(vehicle.vin, context))
    }
  })

  it('commits a request and its audit event together and restores it on a fresh request', async () => {
    const d1 = fakeD1()
    const first = await loadD1Repository(d1, buildSyntheticRelease())
    const created = first.repository.insertTransferRequest(first.database, syntheticRequest(), syntheticEvent())
    expect(created.created).toBe(true)
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM transfer_requests').get().count).toBe(0)
    expect(await first.commit()).toEqual({ committed: true, revision: 1 })
    const next = await loadD1Repository(d1, buildSyntheticRelease())
    expect(next.repository.getTransferRow(next.database, created.row.id)).toEqual(created.row)
    expect(next.repository.getTransferEvents(next.database, created.row.id)).toHaveLength(1)
    const repeated = next.repository.insertTransferRequest(next.database, syntheticRequest(), syntheticEvent())
    expect(repeated).toEqual({ row: created.row, created: false })
    expect(await next.commit()).toEqual({ committed: false, revision: 1 })
  })

  it('runs the real service request, manager review, release decision and attention actions across fresh cloud requests', async () => {
    const d1 = fakeD1()
    const release = buildSyntheticRelease()
    // Deliberately fabricated, format-valid identity for workflow validation.
    release.vehicles[0].vin = '1FTEW1EP7PFA00001'
    const salesperson = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson' }
    const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic manager' }
    const session = async () => {
      const store = await loadD1Repository(d1, release)
      return { ...store, service: createInventoryServiceCore({ database: store.database, repository: store.repository, now: () => SYNTHETIC_NOW }) }
    }
    const first = await session()
    const requested = first.service.createTransfer({ vin: release.vehicles[0].vin, neededBy: '2026-08-30T20:00:00Z', reason: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS showing' }, salesperson, 'SYNTHETIC-service-create')
    expect(requested.created).toBe(true)
    await first.commit()
    const review = await session()
    const reviewed = review.service.appendTransferEvent(requested.record.id, { type: 'manager_reviewed' }, manager, 'SYNTHETIC-service-review')
    expect(reviewed.record.requestStatus).toBe('manager_reviewed')
    await review.commit()
    const reviewRetry = await session()
    expect(reviewRetry.service.appendTransferEvent(requested.record.id, { type: 'manager_reviewed' }, manager, 'SYNTHETIC-service-review').created).toBe(false)
    expect(() => reviewRetry.service.appendTransferEvent(requested.record.id, { type: 'approved' }, manager, 'SYNTHETIC-service-review')).toThrow('another action')
    expect(await reviewRetry.commit()).toMatchObject({ committed: false })
    const approval = await session()
    const approved = approval.service.appendTransferEvent(requested.record.id, { type: 'approved', homeStoreManager: 'Synthetic home manager' }, manager, 'SYNTHETIC-service-approve')
    expect(approved.record.requestStatus).toBe('approved')
    // Explicit app approval must never rewrite source holds, customer outcome,
    // delivery, or physical custody claims.
    expect(approved.record.deliveryStatus).toBe('not_confirmed')
    await approval.commit()
    const attention = await session()
    const item = attention.service.listAttention({}, manager).items.find((candidate) => candidate.allowedActions?.includes('acknowledge'))
    expect(item).toBeTruthy()
    const acknowledged = attention.service.appendAttentionEvent(item.id, { type: 'acknowledge' }, manager, 'SYNTHETIC-service-attention')
    expect(acknowledged.record.status).toBe('acknowledged')
    await attention.commit()
    const attentionRetry = await session()
    expect(attentionRetry.service.appendAttentionEvent(item.id, { type: 'acknowledge' }, manager, 'SYNTHETIC-service-attention').created).toBe(false)
    expect(() => attentionRetry.service.appendAttentionEvent(item.id, { type: 'resolve' }, manager, 'SYNTHETIC-service-attention')).toThrow('another action')
    expect(await attentionRetry.commit()).toMatchObject({ committed: false })
    const final = await session()
    expect(final.service.getTransfer(requested.record.id, manager).requestStatus).toBe('approved')
    expect(final.service.getAttention(item.id, manager).status).toBe('acknowledged')
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM transfer_events').get().count).toBe(3)
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM attention_events').get().count).toBe(1)
  })

  it('persists whitelisted transfer updates and never mutates source or identity fields', async () => {
    const d1 = fakeD1()
    const first = await loadD1Repository(d1, buildSyntheticRelease())
    first.repository.insertTransferRequest(first.database, syntheticRequest(), syntheticEvent())
    await first.commit()
    const next = await loadD1Repository(d1, buildSyntheticRelease())
    const event = syntheticEvent('SYNTHETIC-event-note', {
      eventType: 'note_added', note: 'Synthetic audit note', driverOrPorterUserId: 'runner-a',
    })
    next.repository.appendTransferEvent(next.database, 'SYNTHETIC-request-a', event, {
      next_action: 'Call home manager', transport_assignee_user_id: 'runner-a',
      updated_at: requestAt, vin: 'wrong', requested_by: 'wrong',
    })
    await next.commit()
    const restored = await loadD1Repository(d1, buildSyntheticRelease())
    const row = restored.repository.getTransferRow(restored.database, 'SYNTHETIC-request-a')
    expect(row).toMatchObject({
      vin: syntheticRequest().vin, requested_by: 'Synthetic salesperson', next_action: 'Call home manager',
      transport_assignee_user_id: 'runner-a',
    })
    expect(restored.repository.getTransferEvents(restored.database, row.id)).toHaveLength(2)
    expect(restored.repository.getTransferEvents(restored.database, row.id)[1].actor_user_id).toBe('synthetic-sales-1')
    expect(restored.repository.getTransferEvents(restored.database, row.id)[1].driver_or_porter_user_id).toBe('runner-a')
    expect(restored.repository.appendTransferEvent(restored.database, row.id, event, { next_action: 'must not apply twice' }).created).toBe(false)
    await restored.commit()
    expect(() => d1.sqlite.prepare('UPDATE transfer_events SET note = ? WHERE id = ?').run('tampered', event.id)).toThrow('append-only')
    expect(() => d1.sqlite.prepare('DELETE FROM transfer_events WHERE id = ?').run(event.id)).toThrow('append-only')
  })

  it('rejects a stale concurrent writer without inserting either its request or event', async () => {
    const d1 = fakeD1()
    const first = await loadD1Repository(d1, buildSyntheticRelease())
    const second = await loadD1Repository(d1, buildSyntheticRelease())
    first.repository.insertTransferRequest(first.database, syntheticRequest('SYNTHETIC-a'), syntheticEvent('SYNTHETIC-a'))
    second.repository.insertTransferRequest(second.database, syntheticRequest('SYNTHETIC-b'), syntheticEvent('SYNTHETIC-b'))
    await first.commit()
    await expect(second.commit()).rejects.toBeInstanceOf(RepositoryConflictError)
    expect(d1.sqlite.prepare('SELECT id FROM transfer_requests').all()).toEqual([{ id: 'SYNTHETIC-a' }])
    expect(d1.sqlite.prepare('SELECT id FROM transfer_events').all()).toEqual([{ id: 'SYNTHETIC-a' }])
    expect(d1.sqlite.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(1)
    const retry = await loadD1Repository(d1, buildSyntheticRelease())
    retry.repository.insertTransferRequest(retry.database, syntheticRequest('SYNTHETIC-b'), syntheticEvent('SYNTHETIC-b'))
    expect(await retry.commit()).toEqual({ committed: true, revision: 2 })
  })

  it('rolls back the revision and request if any audit insert fails, hiding SQL/error details', async () => {
    const d1 = fakeD1()
    const first = await loadD1Repository(d1, buildSyntheticRelease())
    first.repository.insertTransferRequest(first.database, syntheticRequest(), syntheticEvent('SYNTHETIC-invalid', { actor: null }))
    await expect(first.commit()).rejects.toThrow('Unable to save the shared workflow transaction')
    expect(d1.sqlite.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(0)
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM transfer_requests').get().count).toBe(0)
    expect(d1.sqlite.prepare('SELECT count(*) AS count FROM transfer_events').get().count).toBe(0)
  })

  it('persists attention state, preserves creation time, and keeps all audit history in insertion order', async () => {
    const d1 = fakeD1()
    const first = await loadD1Repository(d1, buildSyntheticRelease())
    first.repository.upsertAttentionWorkflow(first.database, syntheticAttention(), syntheticEvent('SYNTHETIC-z', { eventType: 'acknowledge' }))
    await first.commit()
    const next = await loadD1Repository(d1, buildSyntheticRelease())
    const event = syntheticEvent('SYNTHETIC-a', { eventType: 'assign', assignee: 'Synthetic manager' })
    next.repository.upsertAttentionWorkflow(next.database, syntheticAttention({ assignedTo: 'Synthetic manager', createdAt: '2099-01-01T00:00:00Z' }), event)
    await next.commit()
    const restored = await loadD1Repository(d1, buildSyntheticRelease())
    expect(restored.repository.getAttentionWorkflowRow(restored.database, 'SYNTHETIC-attention')).toMatchObject({ assigned_to: 'Synthetic manager', created_at: requestAt })
    expect(restored.repository.getAttentionEvents(restored.database, 'SYNTHETIC-attention').map((row) => row.id)).toEqual(['SYNTHETIC-z', 'SYNTHETIC-a'])
    expect(restored.repository.upsertAttentionWorkflow(restored.database, syntheticAttention(), event).created).toBe(false)
    expect(await restored.commit()).toEqual({ committed: false, revision: 2 })
    expect(() => d1.sqlite.prepare('DELETE FROM attention_events').run()).toThrow('append-only')
  })

  it('keeps existing authoritative home assignments across new immutable source releases', async () => {
    const d1 = fakeD1()
    d1.sqlite.prepare(`INSERT INTO home_assignments (id, vin, home_store_id, effective_from, assignment_source, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('SYNTHETIC-home', '1FTEW1EP7PFA00001', 'Lincoln', requestAt, 'manager_confirmed', 'Synthetic manager', requestAt)
    const first = await loadD1Repository(d1, buildSyntheticRelease())
    const release = buildSyntheticRelease()
    release.reportDate = '2026-08-31'
    const next = await loadD1Repository(d1, release)
    expect(next.database.dataset.homeAssignments).toEqual(first.database.dataset.homeAssignments)
    expect(next.database.dataset.homeAssignments).toHaveLength(1)
  })

  it('creates no real memberships and constrains server-owned roles and stores', () => {
    const d1 = fakeD1()
    expect(d1.sqlite.prepare('SELECT * FROM cloud_memberships').all()).toEqual([])
    d1.sqlite.prepare('INSERT INTO cloud_memberships (email, user_id, name, role, home_store) VALUES (?, ?, ?, ?, ?)')
      .run('synthetic@example.invalid', 'SYNTHETIC-user', 'Synthetic user', 'sales', 'Howell')
    expect(d1.sqlite.prepare('SELECT enabled FROM cloud_memberships').get().enabled).toBe(0)
    expect(() => d1.sqlite.prepare('UPDATE cloud_memberships SET role = ?').run('owner')).toThrow('CHECK constraint')
    expect(() => d1.sqlite.prepare('UPDATE cloud_memberships SET home_store = ?').run('Unknown')).toThrow('CHECK constraint')
    expect(() => d1.sqlite.prepare('DELETE FROM cloud_app_revision').run()).toThrow('cannot be deleted')
  })

  it('backfills legacy assignment IDs only for one unambiguous enabled transport member', () => {
    const sqlite = new DatabaseSync(':memory:')
    openDatabases.push(sqlite)
    sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0001_initial.sql', import.meta.url), 'utf8'))
    sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0002_app_access.sql', import.meta.url), 'utf8'))
    const insertMember = sqlite.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)')
    insertMember.run('unique@example.invalid', 'runner-unique', 'Unique Runner', 'driver', 'Howell')
    insertMember.run('duplicate.one@example.invalid', 'runner-duplicate-1', 'Duplicate Runner', 'driver', 'Howell')
    insertMember.run('duplicate.two@example.invalid', 'runner-duplicate-2', 'Duplicate Runner', 'porter', 'Fowlerville')
    const insertRequest = sqlite.prepare(`
      INSERT INTO transfer_requests (
        id,vin,stock_at_request,vehicle_name_at_request,home_store_id,home_store_confirmed,
        requesting_store_id,destination_store_id,requested_by,requested_at,reason,customer_appointment,
        priority,status,movement_status,deal_status,delivery_status,current_location_id,transport_assignee,
        next_action,return_required,location_confidence,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const insertLegacy = (id, assignee) => insertRequest.run(
      id, '1FTEW1EP7PFA00001', 'SYNTHETIC-001', 'Synthetic vehicle', 'Howell', 0,
      'Fowlerville', 'Fowlerville', 'Synthetic salesperson', requestAt, 'Synthetic reason', 0,
      'normal', 'transport_assigned', 'transport_assigned', 'not_confirmed', 'not_confirmed', 'Howell',
      assignee, 'Pickup vehicle', 1, 'reported', requestAt, requestAt,
    )
    insertLegacy('unique-transfer', 'unique runner')
    insertLegacy('duplicate-transfer', 'Duplicate Runner')
    const insertEvent = sqlite.prepare(`
      INSERT INTO transfer_events (
        id,transfer_request_id,event_type,label,actor,actor_role,driver_or_porter,occurred_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `)
    insertEvent.run('unique-event', 'unique-transfer', 'transport_assigned', 'Transport assigned', 'Manager', 'manager', 'UNIQUE RUNNER', requestAt, requestAt)
    insertEvent.run('duplicate-event', 'duplicate-transfer', 'transport_assigned', 'Transport assigned', 'Manager', 'manager', 'Duplicate Runner', requestAt, requestAt)

    sqlite.exec(readFileSync(new URL('../../cloudflare/migrations/0003_transport_assignment_identity.sql', import.meta.url), 'utf8'))
    expect(sqlite.prepare('SELECT transport_assignee_user_id AS id FROM transfer_requests WHERE id=?').get('unique-transfer').id).toBe('runner-unique')
    expect(sqlite.prepare('SELECT actor_user_id AS id FROM transfer_events WHERE id=?').get('unique-event').id).toBeNull()
    expect(sqlite.prepare('SELECT driver_or_porter_user_id AS id FROM transfer_events WHERE id=?').get('unique-event').id).toBeNull()
    expect(sqlite.prepare('SELECT transport_assignee_user_id AS id FROM transfer_requests WHERE id=?').get('duplicate-transfer').id).toBeNull()
    expect(sqlite.prepare('SELECT driver_or_porter_user_id AS id FROM transfer_events WHERE id=?').get('duplicate-event').id).toBeNull()
  })

  it('rejects malformed or duplicate normalized identities instead of silently losing records', () => {
    expect(() => datasetFromRelease({ reportDate: '2026-08-30' })).toThrow('missing normalized')
    const release = buildSyntheticRelease()
    release.vehicles.push(release.vehicles[0])
    expect(() => datasetFromRelease(release)).toThrow('duplicate or missing')
    expect(datasetFromRelease(null).publicRows).toEqual([])
  })

  it('never reads or clones unused raw source archives while preserving identical normalized output', () => {
    const release = buildSyntheticRelease()
    const expected = datasetFromRelease(release)
    for (const field of ['publicSnapshot', 'dealerMailSnapshot']) {
      Object.defineProperty(release, field, {
        enumerable: true,
        get() { throw new Error('The request read model must not access raw archives') },
      })
    }
    expect(datasetFromRelease(release)).toEqual(expected)
  })

  it('reads one transfer\'s events without walking the whole ledger', () => {
    // Bootstrap builds a view for every visible transfer, and each view needs
    // that transfer's events. Scanning the entire event ledger once per
    // transfer is quadratic, and this Worker runs under a 1,000 ms CPU cap
    // that a busy dealership's accumulated ledger would eventually exceed.
    let reads = 0
    const database = { transfers: [], transferEvents: [], pending: [], closed: false }
    for (let transfer = 0; transfer < 60; transfer += 1) {
      const id = `synthetic-transfer-${transfer}`
      database.transfers.push({ id, vin: '1FTFW1E50NFA00001', status: 'requested' })
      for (let index = 0; index < 10; index += 1) {
        const row = { id: `${id}-event-${index}`, occurred_at: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00Z`, created_at: '2026-09-09T12:00:00Z', event_type: 'note_added' }
        Object.defineProperty(row, 'transfer_request_id', { enumerable: true, get() { reads += 1; return id } })
        database.transferEvents.push(row)
      }
    }
    const total = database.transferEvents.length
    for (const row of database.transfers) expect(d1SnapshotRepository.getTransferEvents(database, row.id)).toHaveLength(10)

    // One grouping pass over the ledger plus one read per returned row as
    // it is cloned — linear in the ledger, not one full pass per transfer
    // (which was 36,600 reads for this fixture).
    expect(reads).toBeLessThanOrEqual(total * 3)

    // An event appended during the same request must still be visible.
    const appended = d1SnapshotRepository.appendTransferEvent(database, 'synthetic-transfer-0', { type: 'note_added', actor: 'Synthetic porter', actorRole: 'porter', store: 'Howell', note: 'Synthetic note', occurredAt: '2026-09-30T12:00:00Z', createdAt: '2026-09-30T12:00:00Z' }, {})
    expect(appended.created).toBe(true)
    expect(d1SnapshotRepository.getTransferEvents(database, 'synthetic-transfer-0')).toHaveLength(11)
    expect(d1SnapshotRepository.getTransferEvents(database, 'synthetic-transfer-1')).toHaveLength(10)
  })

  it('defensively isolates every consumed field from release and home-assignment mutations', () => {
    const release = buildSyntheticRelease()
    release.publicChangeEvents = [{ type: 'synthetic', details: { value: 'original' } }]
    const home = [{ vin: release.vehicles[0].vin, home_store_id: 'Howell' }]
    const dataset = datasetFromRelease(release, home)
    const expected = structuredClone(dataset)
    release.vehicles[0].publicRecord.vehicle_name = 'mutated original'
    release.sourceRuns.public.metadata.storeCounts.Howell = 999
    release.manifest.public_change_counts.price_change = 999
    release.warnings.push('mutated original')
    release.publicChangeEvents[0].details.value = 'mutated original'
    home[0].home_store_id = 'Lincoln'
    expect(dataset).toEqual(expected)
    dataset.publicRows[0].payload.vehicle_name = 'mutated read model'
    expect(release.vehicles[0].publicRecord.vehicle_name).toBe('mutated original')
  })
})
