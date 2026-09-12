// @ts-nocheck -- shared Node/Worker service contract, synthetic records only.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic requesting manager', userId: 'manager-1' }
const homeManager = { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }
const homeSales = { role: 'sales', store: 'Howell', user: 'Synthetic home salesperson', userId: 'sales-2' }
const unrelated = { role: 'manager', store: 'Lincoln', user: 'Synthetic unrelated manager', userId: 'manager-3' }
const request = {
  vin: 'TESTDATAHWELL0001', requestingStore: 'Fowlerville', requestedBy: sales.user,
  neededBy: '2026-08-30T19:00:00Z', returnDueAt: '2026-08-31T19:00:00Z',
  reason: 'Synthetic customer showing', priority: 'normal', returnRequired: true,
}

function harness(workflowMode?: string) {
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  let clock = new Date(SYNTHETIC_NOW)
  const service = createInventoryService({ database, now: () => clock, ...(workflowMode ? { workflowMode } : {}) })
  const created = service.createTransfer(request, sales, 'synthetic-request')
  return { database, service, id: created.record.id, created: created.record, tick: () => { clock = new Date(clock.getTime() + 60_000) } }
}

function approve(service, id) {
  return service.appendTransferEvent(id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'synthetic-approval')
}

describe('simple manager-led vehicle moves', () => {
  it('defaults to one manager approval and a driver-free outward and return trip, keeping independent statuses and audit', () => {
    const { service, database, id, created, tick } = harness()
    expect(created.workflowMode).toBe('simple')
    expect(created.requestStatus).toBe('requested')
    expect(created.allowedActions).not.toContain('approve')
    const managerView = service.getTransfer(id, manager)
    expect(managerView.allowedActions).toContain('approve')
    expect(managerView.allowedActions).not.toEqual(expect.arrayContaining(['review-request', 'request-driver', 'assign-transport']))
    tick()
    const approved = approve(service, id).record
    expect(approved).toMatchObject({ requestStatus: 'approved', currentLocation: 'Howell', approvedBy: manager.user })
    expect(approved.lastConfirmedAt).toBe(created.lastConfirmedAt)
    expect(approved.events.at(-1)).toMatchObject({ type: 'request_approved', confirmedBy: manager.user })
    expect(approved.events.at(-1).label).toContain('confirmed availability for this move')
    expect(approved.allowedActions).toContain('confirm-pickup')
    expect(approved.nextAction).not.toMatch(/driver|dispatch/i)
    tick()
    const departed = service.appendTransferEvent(id, { type: 'vehicle_departed', fromLocation: 'Fake place', toLocation: 'Fake destination' }, sales, 'synthetic-departure').record
    expect(departed).toMatchObject({ requestStatus: 'picked_up', movementStatus: 'picked_up', currentLocation: 'In transit', locationConfidence: 'verified' })
    expect(departed.transportAssignee).toBeUndefined()
    expect(departed.events.at(-1)).toMatchObject({ type: 'vehicle_departed', fromLocation: 'Howell', toLocation: 'In transit' })
    expect(departed.allowedActions).toContain('confirm-arrival')
    tick()
    const arrived = service.appendTransferEvent(id, { type: 'arrived', toLocation: 'Fowlerville' }, sales, 'synthetic-arrival').record
    expect(arrived.currentLocation).toBe('Fowlerville')
    expect(arrived.allowedActions).toContain('schedule-return')
    tick()
    const returning = service.appendTransferEvent(id, { type: 'return_started', dueAt: '2026-08-30T20:00:00Z' }, sales, 'synthetic-return').record
    expect(returning).toMatchObject({ requestStatus: 'return_in_transit', currentLocation: 'In transit', returnDueAt: '2026-08-30T20:00:00.000Z' })
    expect(returning.allowedActions).not.toContain('confirm-return')
    expect(service.getTransfer(id, homeManager).allowedActions).toContain('confirm-return')
    tick()
    const home = service.appendTransferEvent(id, { type: 'returned_home', toLocation: 'Howell' }, homeManager, 'synthetic-receipt').record
    expect(home).toMatchObject({ requestStatus: 'closed', movementStatus: 'returned_home', currentLocation: 'Howell', dealStatus: 'not_confirmed', deliveryStatus: 'not_confirmed' })
    expect(home.allowedActions).not.toContain('close')
    expect(database.prepare('SELECT closed_at FROM transfer_requests WHERE id=?').get(id).closed_at).toBe(home.events.at(-1).occurredAt)
    expect(service.listAttention({}, manager).items.some((item) => item.type === 'transfer_next_action')).toBe(false)
    expect(home.dealerMailHoldState).toBe(created.dealerMailHoldState)
    expect(home.events.map((event) => event.type)).toEqual(['requested', 'request_approved', 'vehicle_departed', 'arrived', 'return_started', 'returned_home'])
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE driver_or_porter IS NOT NULL').get().n).toBe(0)
  })

  it('requires a real Boolean confirmation, requesting manager scope, and cannot be approved by sales or the other store', () => {
    const { service, database, id } = harness()
    for (const availabilityConfirmed of [undefined, false, 'true', 1]) {
      expect(() => service.appendTransferEvent(id, { type: 'request_approved', availabilityConfirmed }, manager)).toThrow('Confirm that you checked')
    }
    expect(() => approve(service, id)).not.toThrow()
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(2)

    const second = harness()
    const input = { type: 'request_approved', availabilityConfirmed: true }
    expect(() => second.service.appendTransferEvent(second.id, input, sales)).toThrow('cannot record')
    expect(() => second.service.appendTransferEvent(second.id, input, homeManager)).toThrow('requesting-store manager')
    expect(() => second.service.appendTransferEvent(second.id, input, unrelated)).toThrow('not found')
    expect(second.service.getTransfer(second.id, homeManager).allowedActions).not.toContain('approve')
    expect(second.database.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(1)
  })

  it('denies premature movement, wrong-store arrival/return, and home receipt without the home manager', () => {
    const { service, id } = harness()
    expect(() => service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)).toThrow('Cannot record')
    approve(service, id)
    expect(() => service.appendTransferEvent(id, { type: 'arrived' }, sales)).toThrow('Cannot record')
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, homeSales)
    expect(() => service.appendTransferEvent(id, { type: 'arrived' }, homeManager)).toThrow('requesting store')
    expect(service.getTransfer(id, homeManager).allowedActions).not.toContain('confirm-arrival')
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    expect(() => service.appendTransferEvent(id, { type: 'return_started' }, homeSales)).toThrow('requesting store')
    service.appendTransferEvent(id, { type: 'return_started' }, sales)
    expect(() => service.appendTransferEvent(id, { type: 'returned_home' }, sales)).toThrow('cannot record')
    expect(() => service.appendTransferEvent(id, { type: 'returned_home' }, manager)).toThrow('Home Store manager')
  })

  it('preserves idempotent audit, authentic actor identity and mode ownership', () => {
    const { service, database, id } = harness()
    const first = approve(service, id)
    expect(first.created).toBe(true)
    expect(approve(service, id).created).toBe(false)
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(2)
    expect(() => service.appendTransferEvent(id, { type: 'vehicle_departed' }, manager, 'synthetic-approval')).toThrow('another action')
    expect(() => service.appendTransferEvent(id, { type: 'vehicle_departed', actor: manager.user }, sales)).toThrow('authenticated user')
    expect(service.getTransfer(id, { ...manager, workflowMode: 'advanced' }).workflowMode).toBe('simple')
    const legacy = harness('advanced')
    expect(legacy.created.workflowMode).toBe('advanced')
    expect(() => approve(legacy.service, legacy.id)).toThrow('Cannot record')
    expect(legacy.service.getTransfer(legacy.id, manager).allowedActions).toContain('review-request')
  })

  it('declines a legacy reviewed request in one manager action without requiring the retired second approval form', () => {
    const { service, id } = harness()
    service.appendTransferEvent(id, { type: 'manager_reviewed' }, manager)
    expect(service.getTransfer(id, manager).allowedActions).toContain('decline')
    expect(() => service.appendTransferEvent(id, { type: 'request_declined' }, manager)).toThrow('decline reason is required')
    expect(() => service.appendTransferEvent(id, { type: 'request_declined', note: 'Synthetic decline' }, homeManager)).toThrow('requesting-store manager')
    const declined = service.appendTransferEvent(id, { type: 'request_declined', note: 'Vehicle needed at its home store' }, manager).record
    expect(declined.requestStatus).toBe('declined')
    expect(declined.allowedActions).not.toContain('approve')
    expect(declined.events.find((event) => event.type === 'request_declined')).toMatchObject({ confirmedBy: manager.user, note: 'Vehicle needed at its home store' })
  })

  it('preserves legacy dispatch transitions and evidence while allowing an existing request to finish in the simpler interface', () => {
    const { service, database, id } = harness()
    service.appendTransferEvent(id, { type: 'manager_reviewed' }, manager, 'old-review')
    expect(() => service.appendTransferEvent(id, { type: 'approved' }, manager)).toThrow('homeStoreManager is required')
    service.appendTransferEvent(id, { type: 'approved', homeStoreManager: homeManager.user }, manager, 'old-release')
    expect(() => service.appendTransferEvent(id, { type: 'picked_up' }, manager)).toThrow('Cannot record')
    expect(() => service.appendTransferEvent(id, { type: 'transport_assigned', assignee: 'Synthetic driver', dueAt: request.neededBy }, manager)).toThrow('verified transport assignee identity')
    service.appendTransferEvent(id, { type: 'transport_assigned', assignee: 'Synthetic driver', assigneeUserId: 'driver-1', dueAt: request.neededBy }, manager, 'old-dispatch')
    const rawBefore = database.prepare('SELECT * FROM transfer_requests WHERE id=?').get(id)
    const simpleView = service.getTransfer(id, manager)
    expect(simpleView.nextAction).not.toMatch(/driver|dispatch/i)
    expect(simpleView.allowedActions).toContain('confirm-pickup')
    expect(simpleView.allowedActions).not.toContain('assign-transport')
    expect(database.prepare('SELECT * FROM transfer_requests WHERE id=?').get(id)).toEqual(rawBefore)
    const departed = service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales).record
    expect(departed.transportAssignee).toBe('Synthetic driver')
    expect(departed.events.map((event) => event.type)).toEqual(expect.arrayContaining(['requested', 'manager_reviewed', 'approved', 'transport_assigned', 'vehicle_departed']))
    expect(departed.events).toHaveLength(5)
  })

  it('keeps reported issues, stale holds, and overdue alerts visible without driver wording', () => {
    const { service, database, id } = harness()
    approve(service, id)
    service.appendTransferEvent(id, { type: 'condition_issue', note: 'Synthetic wheel damage; home manager should review' }, sales)
    const record = service.getTransfer(id, homeManager)
    expect(record.events.find((event) => event.type === 'condition_issue').note).toContain('Synthetic wheel damage')
    expect(record.allowedActions).toContain('report-condition')
    service.setLoadStatus({ error: 'Synthetic collector unavailable' })
    expect(service.getTransfer(id, manager).dealerMailHoldState).toBe('stale_unverified')
    const alerts = service.listAttention({}, manager).items.filter((item) => item.type === 'transfer_next_action')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].label).not.toMatch(/driver|dispatch/i)
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(3)
  })

  it('treats old received-home rows as finished without changing the saved ledger or blocking a later request', () => {
    const { service, database, id, tick } = harness()
    approve(service, id)
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    service.appendTransferEvent(id, { type: 'return_started' }, sales)
    service.appendTransferEvent(id, { type: 'returned_home' }, homeManager)
    // Model an older released ledger that awaited an optional administrative close.
    database.prepare("UPDATE transfer_requests SET status='returned_home', closed_at=NULL, next_action='Close movement workflow' WHERE id=?").run(id)
    const before = database.prepare('SELECT * FROM transfer_requests WHERE id=?').get(id)
    const view = service.getTransfer(id, homeManager)
    expect(view.requestStatus).toBe('returned_home')
    expect(view.nextAction).toContain('move complete')
    expect(view.allowedActions).toEqual(['open-source'])
    expect(service.listAttention({}, manager).items.some((item) => item.type === 'transfer_next_action')).toBe(false)
    expect(database.prepare('SELECT * FROM transfer_requests WHERE id=?').get(id)).toEqual(before)
    tick()
    const next = service.createTransfer(request, sales, 'synthetic-new-request-after-home-receipt')
    expect(next.created).toBe(true)
    expect(next.record.id).not.toBe(id)
    expect(service.getVehicle(request.vin, sales).movement.transferId).toBe(next.record.id)
  })

  it('shares only group-safe current location and actual departure time, never inaccessible transfer identity or private evidence', () => {
    const { service, id, tick } = harness()
    approve(service, id)
    tick()
    const departure = service.appendTransferEvent(id, { type: 'vehicle_departed', note: 'Private synthetic movement note' }, sales).record
    const departedAt = departure.events.find((event) => event.type === 'vehicle_departed').occurredAt
    tick()
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'note_added', note: 'Private customer-reference reminder' }, manager)
    for (const role of ['sales', 'manager', 'group_manager']) {
      const context = { ...unrelated, role }
      const movement = service.getVehicle(request.vin, context).movement
      expect(movement).toMatchObject({ currentLocation: 'Fowlerville', state: 'at_requesting_store', departedAt, locationConfidence: 'verified' })
      if (role !== 'group_manager') {
        expect(Object.keys(movement).sort()).toEqual(['currentLocation', 'departedAt', 'destination', 'label', 'lastConfirmedAt', 'locationConfidence', 'state'].sort())
        expect(JSON.stringify(movement)).not.toMatch(/Private|Synthetic|customer|actor|custodian|transferId|nextActionOwner/)
        expect(service.listTransfers({}, context).items).toHaveLength(0)
        expect(() => service.getTransfer(id, context)).toThrow('not found')
        expect(service.bootstrap(context).transfers).toHaveLength(0)
      }
    }
    for (const role of ['driver', 'porter', 'coordinator']) {
      const movement = service.getVehicle(request.vin, { ...unrelated, role }).movement
      expect(movement.state).toBe('source_reported')
      expect(movement.departedAt).toBeUndefined()
    }
    tick()
    service.appendTransferEvent(id, { type: 'return_started' }, sales)
    expect(service.getVehicle(request.vin, unrelated).movement.departedAt).toBe(departedAt)
    tick()
    service.appendTransferEvent(id, { type: 'returned_home' }, homeManager)
    expect(service.getVehicle(request.vin, unrelated).movement.departedAt).toBeUndefined()
  })

  it('does not invent elapsed time for source-only, unknown or conflicting vehicle locations', () => {
    const { service, database, id, tick } = harness()
    expect(service.getVehicle('TESTDATAHWELL0002', unrelated).movement).toMatchObject({ state: 'source_reported', locationConfidence: 'reported' })
    expect(service.getVehicle('TESTDATAHWELL0002', unrelated).movement.departedAt).toBeUndefined()
    approve(service, id)
    expect(service.getVehicle(request.vin, unrelated).movement.departedAt).toBeUndefined()
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    for (const confidence of ['unknown', 'conflicting']) {
      database.prepare('UPDATE transfer_requests SET current_location_id=?, location_confidence=? WHERE id=?').run('Unknown', confidence, id)
      expect(service.getVehicle(request.vin, unrelated).movement).toMatchObject({ currentLocation: 'Unknown', locationConfidence: confidence, label: 'Location needs checking' })
      expect(service.getVehicle(request.vin, unrelated).movement.departedAt).toBeUndefined()
    }
  })

  it('rejects overlapping requests without resetting actual location, while allowing only the original actor to retry its key', () => {
    const { service, database, id, tick } = harness()
    expect(() => service.createTransfer(request, sales, 'another-pending-request')).toThrow('already has an open move')
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    const before = service.getVehicle(request.vin, unrelated).movement
    tick()
    expect(() => service.createTransfer(request, sales, 'another-away-request')).toThrow('already has an open move')
    expect(service.getVehicle(request.vin, unrelated).movement).toEqual(before)
    expect(service.createTransfer(request, sales, 'synthetic-request')).toMatchObject({ created: false, record: { id } })
    expect(() => service.createTransfer({ ...request, requestedBy: manager.user }, manager, 'synthetic-request')).toThrow('key belongs to another request')
    expect(() => service.createTransfer({ ...request, vin: 'TESTDATAHWELL0002' }, sales, 'synthetic-request')).toThrow('key belongs to another request')
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(1)
  })

  it('uses actual movement evidence across legacy overlaps, not a newer pending request or a note on an older trip', () => {
    const { service, database, id, tick } = harness()
    approve(service, id)
    tick()
    const firstDeparture = service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales).record.events.at(-1).occurredAt
    tick()
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    // Preserve historical overlap support in the optional advanced engine.
    const legacy = createInventoryService({ database, workflowMode: 'advanced', now: () => new Date(SYNTHETIC_NOW.getTime() + 600_000) })
    const later = legacy.createTransfer(request, sales, 'legacy-overlap').record
    expect(service.getVehicle(request.vin, unrelated).movement).toMatchObject({ currentLocation: 'Fowlerville', departedAt: firstDeparture })
    expect(service.getVehicle(request.vin, sales).movement.transferId).toBe(id)
    database.prepare("UPDATE transfer_requests SET status='approved' WHERE id=?").run(later.id)
    tick()
    const secondDeparture = service.appendTransferEvent(later.id, { type: 'vehicle_departed' }, sales).record.events.find((event) => event.type === 'vehicle_departed').occurredAt
    tick()
    service.appendTransferEvent(id, { type: 'note_added', note: 'Synthetic administrative note, not a physical move' }, manager)
    expect(service.getVehicle(request.vin, unrelated).movement).toMatchObject({ currentLocation: 'In transit', departedAt: secondDeparture })
    expect(service.getVehicle(request.vin, sales).movement.transferId).toBe(later.id)
  })

  it('keeps a completed home receipt authoritative over a visiting-store feed and later requests', () => {
    const { service, database, id, tick } = harness()
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    const release = buildSyntheticRelease()
    release.vehicles.find((vehicle) => vehicle.vin === request.vin).publicRecord.store = 'Fowlerville'
    importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
    tick()
    service.appendTransferEvent(id, { type: 'return_started' }, sales)
    tick()
    const receipt = service.appendTransferEvent(id, { type: 'returned_home' }, homeManager).record
    const vehicle = service.getVehicle(request.vin, unrelated)
    expect(vehicle.homeStore).toBe('Howell')
    expect(vehicle.movement).toMatchObject({ currentLocation: 'Howell', state: 'returned_home', locationConfidence: 'verified', lastConfirmedAt: receipt.lastConfirmedAt })
    expect(vehicle.movement.departedAt).toBeUndefined()
    expect(vehicle.movement.transferId).toBeUndefined()
    expect(() => service.getTransfer(id, unrelated)).toThrow('not found')
    tick()
    // A later request must not relabel the physical receipt as a new sighting.
    const next = service.createTransfer({ ...request, requestingStore: 'Lincoln', requestedBy: unrelated.user }, unrelated, 'after-receipt')
    expect(next.created).toBe(true)
    expect(next.record.homeStore).toBe('Howell')
    expect(service.getVehicle(request.vin, homeManager).movement).toMatchObject({ currentLocation: 'Howell', state: 'returned_home', lastConfirmedAt: receipt.lastConfirmedAt })
  })

  it('does not choose a location by UUID when legacy physical sightings tie and disagree, but preserves agreeing locations', () => {
    const { service, database, id, tick } = harness()
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    tick()
    const firstArrival = service.appendTransferEvent(id, { type: 'arrived' }, sales).record.events.find((event) => event.type === 'arrived').occurredAt
    const legacy = createInventoryService({ database, workflowMode: 'advanced', now: () => new Date(SYNTHETIC_NOW.getTime() + 600_000) })
    const later = legacy.createTransfer(request, sales, 'legacy-tied-trip').record
    database.prepare("UPDATE transfer_requests SET status='approved' WHERE id=?").run(later.id)
    service.appendTransferEvent(later.id, { type: 'vehicle_departed', occurredAt: firstArrival }, sales)
    for (const context of [sales, unrelated]) {
      const movement = service.getVehicle(request.vin, context).movement
      expect(movement).toMatchObject({ currentLocation: 'Unknown', state: 'location_exception', locationConfidence: 'conflicting', label: 'Location needs checking' })
      expect(movement.departedAt).toBeUndefined()
      expect(movement.transferId).toBeUndefined()
    }
    service.appendTransferEvent(later.id, { type: 'arrived', occurredAt: firstArrival }, sales)
    const agreed = service.getVehicle(request.vin, unrelated).movement
    expect(agreed).toMatchObject({ currentLocation: 'Fowlerville', locationConfidence: 'verified' })
    // The location agrees; the two distinct departure clocks do not.
    expect(agreed.departedAt).toBeUndefined()
    tick()
    service.appendTransferEvent(later.id, { type: 'return_started' }, sales)
    expect(service.getVehicle(request.vin, unrelated).movement).toMatchObject({ currentLocation: 'In transit', locationConfidence: 'verified', departedAt: firstArrival })
  })

  it('does not treat a home assignment plus a bare request as a physical sighting', () => {
    // A home assignment records which store is accountable for the vehicle.
    // A request records that a salesperson at another store wants it. Neither
    // is a sighting, yet together they used to produce locationConfidence
    // 'verified' with lastConfirmedAt set to the request time — broadcast
    // group-wide and projected to the integration API as a confirmed location
    // that nobody had confirmed. Physical location must only be inferred from
    // physical events.
    const database = openInventoryDatabase()
    databases.push(database)
    importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
    database.prepare(`
      INSERT INTO home_assignments (id, vin, home_store_id, effective_from, effective_to, assignment_source, assigned_by, note, created_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?)
    `).run('synthetic-home-assignment', request.vin, 'Howell', SYNTHETIC_NOW.toISOString(), 'synthetic_test', homeManager.user, SYNTHETIC_NOW.toISOString())
    let clock = new Date(SYNTHETIC_NOW)
    const service = createInventoryService({ database, now: () => clock })
    const tick = () => { clock = new Date(clock.getTime() + 60_000) }

    const vehicleBefore = service.getVehicle(request.vin, unrelated)
    // The assignment is recognized as an accountability fact...
    expect(vehicleBefore.homeStoreConfirmed).toBe(true)
    // ...but not as a sighting.
    expect(vehicleBefore.movement).toMatchObject({ state: 'source_reported', locationConfidence: 'reported' })
    expect(vehicleBefore.movement.lastConfirmedAt).toBeUndefined()

    const created = service.createTransfer(request, sales, 'synthetic-request').record
    expect(created.locationConfidence).toBe('reported')
    expect(created.lastConfirmedAt).toBeFalsy()

    // Group-wide location summary for a store that is party to nothing.
    const after = service.getVehicle(request.vin, unrelated).movement
    expect(after.locationConfidence).not.toBe('verified')
    expect(after.lastConfirmedAt).toBeUndefined()

    // The first physical event is what earns 'verified' and starts the clock.
    tick()
    approve(service, created.id)
    tick()
    const departed = service.appendTransferEvent(created.id, { type: 'vehicle_departed' }, sales, 'synthetic-departure').record
    expect(departed.locationConfidence).toBe('verified')
    expect(departed.lastConfirmedAt).toBe(clock.toISOString())
  })
})
