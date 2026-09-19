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
const unrelatedSales = { role: 'sales', store: 'Lincoln', user: 'Synthetic unrelated salesperson', userId: 'sales-3' }
const alternateSales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic alternate salesperson', userId: 'sales-4' }
const detroitManager = { role: 'manager', store: 'Ford Detroit', user: 'Synthetic Detroit manager', userId: 'manager-4' }
const groupManager = { role: 'group_manager', store: 'Howell', user: 'Synthetic group manager', userId: 'group-manager-1' }
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

function emptyHarness() {
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  let clock = new Date(SYNTHETIC_NOW)
  const service = createInventoryService({ database, now: () => clock })
  return { database, service, tick: () => { clock = new Date(clock.getTime() + 60_000) } }
}

function approve(service, id) {
  return service.appendTransferEvent(id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'synthetic-approval')
}

describe('simple manager-led vehicle moves', () => {
  it('lets the home-store manager record one direct move at its destination with an atomic physical audit', () => {
    const { service, database } = emptyHarness()
    const movedAt = new Date(SYNTHETIC_NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const direct = {
      vin: 'TESTDATAHWELL0002', intent: 'direct', requestingStore: 'Howell', destinationStore: 'Ford Detroit',
      requestedBy: homeManager.user, movedAt, reason: 'Synthetic customer showing', priority: 'normal', returnRequired: true,
    }

    const created = service.createTransfer(direct, homeManager, 'synthetic-direct-move')
    expect(created.created).toBe(true)
    expect(created.record).toMatchObject({
      homeStore: 'Howell', requestingStore: 'Ford Detroit', destination: 'Ford Detroit',
      requestStatus: 'arrived', movementStatus: 'at_requesting_store', currentLocation: 'Ford Detroit',
      approvedBy: homeManager.user, locationConfidence: 'verified', lastConfirmedAt: movedAt,
    })
    expect(created.record.allowedActions).not.toContain('record-outcome')
    expect(created.record.allowedActions).not.toEqual(expect.arrayContaining(['confirm-pickup', 'confirm-arrival']))
    expect(service.getTransfer(created.record.id, detroitManager).allowedActions).toEqual(expect.arrayContaining(['record-outcome', 'schedule-return']))
    expect(created.record.events).toHaveLength(1)
    expect(created.record.events[0]).toMatchObject({
      type: 'direct_move_recorded', actor: homeManager.user, actorRole: 'manager', store: 'Howell',
      fromLocation: 'Howell', toLocation: 'Ford Detroit', occurredAt: movedAt,
    })
    expect(created.record.requestedAt).toBe(SYNTHETIC_NOW.toISOString())
    expect(service.getVehicle(direct.vin, homeManager).movement).toMatchObject({
      state: 'at_requesting_store', currentLocation: 'Ford Detroit', destination: 'Ford Detroit',
      departedAt: movedAt, locationConfidence: 'verified', newRequestBlocked: true,
    })

    const row = database.prepare('SELECT * FROM transfer_requests WHERE id=?').get(created.record.id)
    const event = database.prepare('SELECT * FROM transfer_events WHERE transfer_request_id=?').get(created.record.id)
    expect(row).toMatchObject({ status: 'arrived', movement_status: 'at_requesting_store', current_location_id: 'Ford Detroit' })
    expect(event).toMatchObject({ event_type: 'direct_move_recorded', occurred_at: movedAt, created_at: SYNTHETIC_NOW.toISOString() })

    expect(service.createTransfer(direct, homeManager, 'synthetic-direct-move')).toMatchObject({ created: false, record: { id: created.record.id } })
    for (const changed of [
      { ...direct, destinationStore: 'Lincoln' },
      { ...direct, movedAt: new Date(Date.parse(movedAt) + 60_000).toISOString() },
      { ...direct, reason: 'A different direct-move reason' },
      { ...direct, returnDueAt: new Date(Date.parse(movedAt) + 86_400_000).toISOString() },
      { ...direct, priority: 'high' },
      { ...direct, customerReference: 'Different customer' },
      { ...direct, returnRequired: false },
    ]) {
      expect(() => service.createTransfer(changed, homeManager, 'synthetic-direct-move'))
        .toThrow('key belongs to another request')
    }
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(1)
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_events').get().n).toBe(1)
    expect(() => service.createTransfer({
      ...direct, movedAt: new Date(Date.parse(movedAt) + 60 * 60 * 1000).toISOString(),
    }, homeManager, 'second-direct-move')).toThrow('different from the vehicle current location')
  })

  it('atomically supersedes an active direct move for the owning manager or group manager only', () => {
    const { service, database } = emptyHarness()
    const firstMovedAt = new Date(SYNTHETIC_NOW.getTime() - 3 * 60 * 60 * 1000).toISOString()
    const first = service.createTransfer({
      vin: 'TESTDATAHWELL0002', intent: 'direct', requestingStore: 'Howell', destinationStore: 'Ford Detroit',
      requestedBy: homeManager.user, movedAt: firstMovedAt, reason: 'Initial direct destination',
      priority: 'normal', returnRequired: true, customerAppointment: false,
    }, homeManager, 'direct-reroute-a').record
    service.appendTransferEvent(first.id, {
      type: 'note_added', note: 'Backdated passive note must not hide the direct origin',
      occurredAt: new Date(Date.parse(firstMovedAt) - 60_000).toISOString(),
    }, homeManager, 'direct-reroute-backdated-note')
    expect(service.getVehicle(first.vin, homeManager).movement).toMatchObject({ newRequestBlocked: true, canDirectReroute: true })
    expect(service.getVehicle(first.vin, detroitManager).movement.canDirectReroute).toBeUndefined()
    expect(service.getVehicle(first.vin, homeSales).movement.canDirectReroute).toBeUndefined()

    const secondMovedAt = new Date(SYNTHETIC_NOW.getTime() - 2 * 60 * 60 * 1000).toISOString()
    expect(() => service.createTransfer({
      vin: first.vin, intent: 'direct', requestingStore: manager.store, destinationStore: 'Lincoln',
      requestedBy: manager.user, movedAt: secondMovedAt, reason: 'Unauthorized other manager reroute',
      priority: 'normal', returnRequired: true, customerAppointment: false,
    }, manager, 'direct-reroute-denied-manager')).toThrow('owned by their store')
    expect(() => service.createTransfer({
      vin: first.vin, intent: 'direct', requestingStore: sales.store, destinationStore: 'Lincoln',
      requestedBy: sales.user, movedAt: secondMovedAt, reason: 'Unauthorized salesperson reroute',
      priority: 'normal', returnRequired: true, customerAppointment: false,
    }, sales, 'direct-reroute-denied-sales')).toThrow('Only a manager')

    const second = service.createTransfer({
      vin: first.vin, intent: 'direct', requestingStore: 'Howell', destinationStore: 'Lincoln',
      requestedBy: homeManager.user, movedAt: secondMovedAt, reason: 'Owning manager reroute',
      priority: 'normal', returnRequired: true, customerAppointment: false,
    }, homeManager, 'direct-reroute-b').record
    expect(second.events[0]).toMatchObject({ type: 'direct_move_recorded', fromLocation: 'Ford Detroit', toLocation: 'Lincoln' })
    expect(database.prepare('SELECT status FROM transfer_requests WHERE id=?').get(first.id).status).toBe('canceled')
    expect(service.getTransfer(first.id, homeManager).events.at(-1)).toMatchObject({
      type: 'direct_move_superseded', fromLocation: 'Ford Detroit', toLocation: 'Lincoln', actorRole: 'manager',
    })
    expect(database.prepare("SELECT COUNT(*) AS n FROM transfer_requests WHERE status NOT IN ('declined','canceled','closed')").get().n).toBe(1)

    const thirdMovedAt = new Date(SYNTHETIC_NOW.getTime() - 60 * 60 * 1000).toISOString()
    const third = service.createTransfer({
      vin: first.vin, intent: 'direct', requestingStore: 'Howell', destinationStore: 'Fowlerville',
      requestedBy: groupManager.user, movedAt: thirdMovedAt, reason: 'Group manager reroute',
      priority: 'normal', returnRequired: true, customerAppointment: false,
    }, groupManager, 'direct-reroute-c').record
    expect(third.events[0]).toMatchObject({ type: 'direct_move_recorded', fromLocation: 'Lincoln', toLocation: 'Fowlerville', actorRole: 'group_manager' })
    expect(database.prepare('SELECT status FROM transfer_requests WHERE id=?').get(second.id).status).toBe('canceled')
    expect(database.prepare("SELECT COUNT(*) AS n FROM transfer_requests WHERE status NOT IN ('declined','canceled','closed')").get().n).toBe(1)
  })

  it('enforces direct-move ownership, request roles, destinations, and movedAt bounds', () => {
    const direct = {
      vin: 'TESTDATAHWELL0002', intent: 'direct', requestingStore: 'Howell', destinationStore: 'Ford Detroit',
      requestedBy: homeManager.user, movedAt: SYNTHETIC_NOW.toISOString(), reason: 'Synthetic move', priority: 'normal', returnRequired: true,
    }

    expect(() => emptyHarness().service.createTransfer({ ...direct, requestedBy: sales.user, requestingStore: sales.store }, sales, 'sales-direct'))
      .toThrow('Only a manager')
    expect(() => emptyHarness().service.createTransfer({ ...direct, requestedBy: manager.user, requestingStore: manager.store }, manager, 'other-manager-direct'))
      .toThrow('owned by their store')
    expect(() => emptyHarness().service.createTransfer({ ...direct, destinationStore: 'Howell' }, homeManager, 'same-store-direct'))
      .toThrow('different from the vehicle current location')
    const managerRequest = emptyHarness().service.createTransfer({ ...request, requestedBy: manager.user }, manager, 'manager-request')
    expect(managerRequest.record.requestStatus).toBe('requested')

    const approvalHarness = emptyHarness()
    const pending = approvalHarness.service.createTransfer(request, sales, 'group-approval-request').record
    const groupApproved = approvalHarness.service.appendTransferEvent(
      pending.id,
      { type: 'request_approved', availabilityConfirmed: true },
      groupManager,
      'group-approval',
    ).record
    expect(groupApproved).toMatchObject({ requestStatus: 'approved', approvedBy: groupManager.user })

    const group = emptyHarness()
    const groupMove = group.service.createTransfer({
      ...direct, vin: 'TESTDATAFWELL0002', requestingStore: groupManager.store,
      requestedBy: groupManager.user, destinationStore: 'Ford Detroit',
    }, groupManager, 'group-direct').record
    expect(groupMove).toMatchObject({ homeStore: 'Fowlerville', currentLocation: 'Ford Detroit', requestStatus: 'arrived' })

    const tooOld = new Date(SYNTHETIC_NOW.getTime() - (91 * 24 * 60 * 60 * 1000)).toISOString()
    const tooFuture = new Date(SYNTHETIC_NOW.getTime() + (6 * 60 * 1000)).toISOString()
    expect(() => emptyHarness().service.createTransfer({ ...direct, movedAt: tooOld }, homeManager, 'old-direct')).toThrow('more than 90 days')
    expect(() => emptyHarness().service.createTransfer({ ...direct, movedAt: tooFuture }, homeManager, 'future-direct')).toThrow('materially in the future')
    expect(() => emptyHarness().service.createTransfer({
      ...direct,
      movedAt: '2026-08-30T10:00:00-04:00',
      returnDueAt: '2026-08-30T14:00:00Z',
    }, homeManager, 'equal-direct-return')).toThrow('later than movedAt')
    expect(() => emptyHarness().service.createTransfer({
      ...request,
      neededBy: '2026-08-30T15:00:00-04:00',
      returnDueAt: '2026-08-30T19:00:00Z',
    }, sales, 'equal-request-return')).toThrow('later than neededBy')

    const salesRequest = emptyHarness().service.createTransfer({ ...request, destinationStore: 'Fowlerville' }, sales, 'sales-request')
    expect(salesRequest.record.requestStatus).toBe('requested')
    expect(() => emptyHarness().service.createTransfer({ ...request, destinationStore: 'Lincoln' }, sales, 'spoofed-destination'))
      .toThrow('active store')
  })

  it('rejects a reused request key when any mutation-defining request field changes', () => {
    const { service, id } = harness()
    expect(service.createTransfer(request, sales, 'synthetic-request')).toMatchObject({ created: false, record: { id } })
    for (const changed of [
      { ...request, neededBy: '2026-08-30T20:00:00Z' },
      { ...request, reason: 'Different request reason' },
      { ...request, returnDueAt: '2026-09-01T19:00:00Z' },
      { ...request, priority: 'urgent' },
      { ...request, customerReference: 'Different customer' },
      { ...request, customerAppointment: true },
      { ...request, returnRequired: false },
      { ...request, approvalOwner: 'Different manager' },
    ]) {
      expect(() => service.createTransfer(changed, sales, 'synthetic-request'))
        .toThrow('key belongs to another request')
    }
  })

  it('replays an older direct key without revalidating it against later physical moves', () => {
    const { service } = emptyHarness()
    const direct = (destinationStore, movedAt, reason) => ({
      vin: 'TESTDATAHWELL0002', intent: 'direct', requestingStore: 'Howell', destinationStore,
      requestedBy: homeManager.user, movedAt, reason, priority: 'normal', returnRequired: true,
      customerAppointment: false,
    })
    const close = (id, prefix) => {
      service.appendTransferEvent(id, { type: 'sale_confirmed' }, groupManager, `${prefix}-sale`)
      service.appendTransferEvent(id, { type: 'delivery_confirmed' }, groupManager, `${prefix}-delivery`)
      service.appendTransferEvent(id, { type: 'closed' }, groupManager, `${prefix}-close`)
    }
    const firstInput = direct('Ford Detroit', '2026-08-30T13:00:00Z', 'First direct move')
    const first = service.createTransfer(firstInput, homeManager, 'historical-direct-a').record
    close(first.id, 'historical-a')
    const second = service.createTransfer({
      ...direct('Lincoln', '2026-08-30T13:30:00Z', 'Second direct move'), requestedBy: groupManager.user,
    }, groupManager, 'historical-direct-b').record
    close(second.id, 'historical-b')
    const third = service.createTransfer({
      ...direct('Ford Detroit', '2026-08-30T14:00:00Z', 'Third direct move'), requestedBy: groupManager.user,
    }, groupManager, 'historical-direct-c').record
    close(third.id, 'historical-c')

    expect(service.createTransfer(firstInput, homeManager, 'historical-direct-a'))
      .toMatchObject({ created: false, record: { id: first.id } })
  })

  it('records authenticated group-manager authority while previewing a store manager', () => {
    const { service, tick } = emptyHarness()
    const preview = {
      role: 'manager', store: 'Ford Detroit', authenticatedRole: 'group_manager', authenticatedStore: 'Howell',
      user: groupManager.user, userId: groupManager.userId,
    }
    const created = service.createTransfer({
      ...request, requestingStore: 'Ford Detroit', requestedBy: preview.user,
    }, preview, 'preview-manager-request')
    expect(created.record.events[0]).toMatchObject({
      type: 'requested', actorRole: 'group_manager', store: 'Ford Detroit', actor: groupManager.user,
    })
    expect(service.createTransfer({
      ...request, requestingStore: 'Ford Detroit', requestedBy: preview.user,
    }, preview, 'preview-manager-request')).toMatchObject({ created: false, record: { id: created.record.id } })
    tick()
    const approvalInput = { type: 'request_approved', availabilityConfirmed: true }
    const approved = service.appendTransferEvent(created.record.id, approvalInput, preview, 'preview-manager-approval')
    expect(approved.record.events.at(-1)).toMatchObject({
      type: 'request_approved', actorRole: 'group_manager', store: 'Ford Detroit', actor: groupManager.user,
    })
    expect(service.appendTransferEvent(created.record.id, approvalInput, preview, 'preview-manager-approval').created).toBe(false)
    expect(() => service.appendTransferEvent(
      created.record.id,
      { ...approvalInput, note: 'Changed replay payload' },
      preview,
      'preview-manager-approval',
    )).toThrow('key belongs to another action')
  })

  it('rejects chronology regression and moves from the latest physical store without changing vehicle ownership', () => {
    const { service, database, tick } = emptyHarness()
    const pending = service.createTransfer(request, sales, 'prior-away-request').record
    service.appendTransferEvent(pending.id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'prior-away-approval')
    tick()
    service.appendTransferEvent(pending.id, { type: 'vehicle_departed' }, sales, 'prior-away-departure')
    tick()
    const arrived = service.appendTransferEvent(pending.id, { type: 'arrived' }, sales, 'prior-away-arrival').record
    const latestPhysicalAt = arrived.events.at(-1).occurredAt
    database.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?").run(latestPhysicalAt, pending.id)
    tick()

    const direct = {
      vin: request.vin, intent: 'direct', requestingStore: 'Howell', destinationStore: 'Ford Detroit',
      requestedBy: homeManager.user, movedAt: latestPhysicalAt, reason: 'Synthetic corrected movement',
      priority: 'normal', returnRequired: true,
    }
    expect(() => service.createTransfer(direct, homeManager, 'backdated-direct'))
      .toThrowError(expect.objectContaining({ code: 'MOVE_CHRONOLOGY_CONFLICT' }))
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(1)

    const laterMovedAt = new Date(Date.parse(latestPhysicalAt) + 60_000).toISOString()
    expect(() => service.createTransfer({ ...direct, destinationStore: 'Fowlerville', movedAt: laterMovedAt }, homeManager, 'same-location-direct'))
      .toThrow('different from the vehicle current location')

    const returned = service.createTransfer({
      ...direct, destinationStore: 'Howell', movedAt: laterMovedAt,
    }, homeManager, 'away-to-home-direct').record
    expect(returned).toMatchObject({
      homeStore: 'Howell', requestingStore: 'Howell', destination: 'Howell',
      currentLocation: 'Howell', requestStatus: 'arrived', locationConfidence: 'verified',
    })
    expect(returned.events).toContainEqual(expect.objectContaining({
      type: 'direct_move_recorded', fromLocation: 'Fowlerville', toLocation: 'Howell', occurredAt: laterMovedAt,
    }))
    expect(service.getVehicle(request.vin, homeManager).movement).toMatchObject({
      currentLocation: 'Howell', state: 'at_requesting_store', locationConfidence: 'verified',
    })
  })

  it('preserves an authoritative in-transit origin for a later direct correction', () => {
    const { service, database, tick } = emptyHarness()
    const prior = service.createTransfer(request, sales, 'prior-transit-request').record
    service.appendTransferEvent(prior.id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'prior-transit-approval')
    tick()
    const departed = service.appendTransferEvent(prior.id, { type: 'vehicle_departed' }, sales, 'prior-transit-departure').record
    const latestPhysicalAt = departed.events.at(-1).occurredAt
    database.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?").run(latestPhysicalAt, prior.id)
    tick()

    const movedAt = new Date(Date.parse(latestPhysicalAt) + 60_000).toISOString()
    const corrected = service.createTransfer({
      vin: request.vin, intent: 'direct', requestingStore: groupManager.store, destinationStore: 'Howell',
      requestedBy: groupManager.user, movedAt, reason: 'Synthetic terminal transit correction',
      priority: 'normal', returnRequired: true, customerAppointment: false,
    }, groupManager, 'transit-to-home-direct').record
    expect(corrected).toMatchObject({ homeStore: 'Howell', currentLocation: 'Howell', requestStatus: 'arrived' })
    expect(corrected.events[0]).toMatchObject({
      type: 'direct_move_recorded', fromLocation: 'In transit', toLocation: 'Howell', occurredAt: movedAt,
    })
  })

  it('uses the first visible outcome as destination custody and completes a driver-free return with no hidden steps', () => {
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
    expect(approved.allowedActions).toEqual(expect.arrayContaining(['record-outcome', 'schedule-return']))
    expect(approved.allowedActions).not.toEqual(expect.arrayContaining(['confirm-pickup', 'confirm-arrival']))
    expect(approved.nextAction).not.toMatch(/driver|dispatch/i)
    tick()
    const worked = service.appendTransferEvent(id, { type: 'customer_showing' }, sales, 'synthetic-showing').record
    expect(worked).toMatchObject({
      requestStatus: 'customer_showing', movementStatus: 'at_requesting_store', currentLocation: 'Fowlerville',
      locationConfidence: 'verified', dealStatus: 'customer_showing', custodian: sales.user,
    })
    expect(worked.transportAssignee).toBeUndefined()
    expect(worked.events.at(-1)).toMatchObject({ type: 'customer_showing', fromLocation: 'Howell', toLocation: 'Fowlerville' })
    expect(worked.allowedActions).toEqual(expect.arrayContaining(['record-outcome', 'schedule-return']))
    expect(worked.allowedActions).not.toEqual(expect.arrayContaining(['confirm-pickup', 'confirm-arrival']))
    expect(service.getVehicle(request.vin, sales).movement).toMatchObject({
      state: 'at_requesting_store', currentLocation: 'Fowlerville', destination: 'Fowlerville',
      departedAt: worked.events.at(-1).occurredAt, locationConfidence: 'verified',
    })
    tick()
    const returning = service.appendTransferEvent(id, { type: 'return_started', dueAt: '2026-08-30T20:00:00Z' }, sales, 'synthetic-return').record
    expect(returning).toMatchObject({ requestStatus: 'return_in_transit', currentLocation: 'In transit', returnDueAt: '2026-08-30T20:00:00.000Z' })
    expect(returning.events.at(-1)).toMatchObject({ type: 'return_started', fromLocation: 'Fowlerville', toLocation: 'In transit' })
    expect(service.getVehicle(request.vin, sales).movement).toMatchObject({ currentLocation: 'In transit', departedAt: worked.events.at(-1).occurredAt })
    expect(returning.allowedActions).not.toContain('confirm-return')
    expect(service.getTransfer(id, homeManager).allowedActions).toContain('confirm-return')
    tick()
    const home = service.appendTransferEvent(id, { type: 'returned_home', toLocation: 'Howell' }, homeManager, 'synthetic-receipt').record
    expect(home).toMatchObject({ requestStatus: 'closed', movementStatus: 'returned_home', currentLocation: 'Howell', dealStatus: 'customer_showing', deliveryStatus: 'not_confirmed' })
    expect(home.allowedActions).not.toContain('close')
    expect(database.prepare('SELECT closed_at FROM transfer_requests WHERE id=?').get(id).closed_at).toBe(home.events.at(-1).occurredAt)
    expect(service.listAttention({}, manager).items.some((item) => item.type === 'transfer_next_action')).toBe(false)
    expect(home.dealerMailHoldState).toBe(created.dealerMailHoldState)
    expect(home.events.map((event) => event.type)).toEqual(['requested', 'request_approved', 'customer_showing', 'return_started', 'returned_home'])
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_events WHERE driver_or_porter IS NOT NULL').get().n).toBe(0)
  })

  it('keeps a sold-pending vehicle waiting on its delivery, off the return path, until a manager records the deal fell through', () => {
    const database = openInventoryDatabase()
    databases.push(database)
    importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
    let clock = new Date(SYNTHETIC_NOW)
    const service = createInventoryService({ database, now: () => clock })
    const id = service.createTransfer(request, sales, 'sold-pending-request').record.id
    approve(service, id)
    clock = new Date(clock.getTime() + 60_000)
    const sold = service.appendTransferEvent(id, { type: 'sale_confirmed' }, manager, 'sold-pending-sale').record
    expect(sold).toMatchObject({
      requestStatus: 'sale_confirmed', dealStatus: 'sold_pending', deliveryStatus: 'not_confirmed',
      movementStatus: 'at_requesting_store', currentLocation: 'Fowlerville', returnRequired: true,
    })
    expect(sold.nextAction).toBe('Confirm the customer delivery, or record that the deal fell through')
    expect(sold.allowedActions).toContain('record-outcome')
    expect(sold.allowedActions).not.toContain('schedule-return')
    // The return clock pauses while the sale is pending: a past return-due
    // date is not an overdue return for the home store.
    clock = new Date('2026-09-01T12:00:00Z')
    expect(new Date(request.returnDueAt) < clock).toBe(true)
    expect(service.bootstrap(homeManager).stores.find((store) => store.store === 'Howell').returnOverdue).toBe(0)
    // A manager confirmed the sale; a salesperson cannot unwind it.
    expect(() => service.appendTransferEvent(id, { type: 'not_sold' }, sales, 'sold-pending-sales-unwind')).toThrow(/Only a manager/)
    expect(service.getTransfer(id, sales).allowedActions).not.toContain('record-outcome')
    const unwound = service.appendTransferEvent(id, { type: 'not_sold' }, manager, 'sold-pending-unwind').record
    expect(unwound).toMatchObject({ requestStatus: 'not_sold', dealStatus: 'not_sold', deliveryStatus: 'not_confirmed', nextAction: 'Record when the vehicle starts its return' })
    expect(unwound.allowedActions).toContain('schedule-return')
    expect(service.bootstrap(homeManager).stores.find((store) => store.store === 'Howell').returnOverdue).toBe(1)
    clock = new Date(clock.getTime() + 60_000)
    const returning = service.appendTransferEvent(id, { type: 'return_started', dueAt: '2026-09-01T15:00:00Z' }, sales, 'sold-pending-return').record
    expect(returning).toMatchObject({ requestStatus: 'return_in_transit', currentLocation: 'In transit' })
    expect(unwound.events.map((event) => event.type)).toEqual(['requested', 'request_approved', 'sale_confirmed', 'not_sold'])
  })

  it('finishes a delivered vehicle at the destination with no return step', () => {
    const { service, id, tick } = harness()
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'sale_confirmed' }, manager, 'delivered-sale')
    tick()
    const delivered = service.appendTransferEvent(id, { type: 'delivery_confirmed' }, manager, 'delivered-delivery').record
    expect(delivered).toMatchObject({ requestStatus: 'delivery_confirmed', dealStatus: 'sold_pending', deliveryStatus: 'delivery_confirmed', currentLocation: 'Fowlerville', nextAction: 'Delivered — close the move' })
    expect(delivered.allowedActions).toContain('close')
    expect(delivered.allowedActions).not.toEqual(expect.arrayContaining(['schedule-return', 'confirm-return']))
  })

  it('treats return started from approval as proof it had reached the destination', () => {
    const { service, id, tick } = harness()
    approve(service, id)
    tick()
    const input = { type: 'return_started', fromLocation: 'Howell' }
    const returning = service.appendTransferEvent(id, input, sales, 'return-directly-after-approval').record
    const event = returning.events.at(-1)
    expect(returning).toMatchObject({ requestStatus: 'return_in_transit', movementStatus: 'return_in_transit', currentLocation: 'In transit', locationConfidence: 'verified' })
    expect(event).toMatchObject({ type: 'return_started', fromLocation: 'Fowlerville', toLocation: 'In transit' })
    expect(service.getVehicle(request.vin, sales).movement).toMatchObject({
      state: 'return_in_transit', currentLocation: 'In transit', departedAt: event.occurredAt,
    })
    expect(service.appendTransferEvent(id, input, sales, 'return-directly-after-approval').created).toBe(false)
    expect(() => service.appendTransferEvent(
      id,
      { ...input, fromLocation: 'Lincoln' },
      sales,
      'return-directly-after-approval',
    )).toThrow('key belongs to another action')
  })

  it('does not advertise a direct reroute while physical location evidence conflicts', () => {
    const { service, database, tick } = emptyHarness()
    const vin = 'TESTDATAHWELL0002'
    const prior = service.createTransfer({ ...request, vin }, sales, 'conflict-prior-request').record
    service.appendTransferEvent(prior.id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'conflict-prior-approval')
    tick()
    service.appendTransferEvent(prior.id, { type: 'vehicle_departed' }, sales, 'conflict-prior-departure')
    tick()
    const arrived = service.appendTransferEvent(prior.id, { type: 'arrived' }, sales, 'conflict-prior-arrival').record
    database.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?")
      .run(arrived.events.at(-1).occurredAt, prior.id)
    tick()
    const movedAt = new Date(Date.parse(arrived.events.at(-1).occurredAt) + 60_000).toISOString()
    const direct = service.createTransfer({
      vin, intent: 'direct', destinationStore: 'Ford Detroit', requestedBy: homeManager.user,
      movedAt, reason: 'Synthetic direct location', priority: 'normal', returnRequired: true,
    }, homeManager, 'conflict-active-direct').record
    database.prepare("UPDATE transfer_events SET occurred_at=? WHERE transfer_request_id=? AND event_type='arrived'")
      .run(movedAt, prior.id)
    const movement = service.getVehicle(vin, homeManager).movement
    expect(movement).toMatchObject({ currentLocation: 'Unknown', locationConfidence: 'conflicting', newRequestBlocked: true })
    expect(movement.canDirectReroute).toBeUndefined()
    expect(database.prepare("SELECT status FROM transfer_requests WHERE id=?").get(direct.id).status).toBe('arrived')
  })

  it('keeps simplified destination custody durable after closure and uses it as the next direct origin', () => {
    const { service, database, id, tick } = harness()
    approve(service, id)
    tick()
    const showing = service.appendTransferEvent(id, { type: 'customer_showing' }, sales, 'durable-showing').record
    const custodyAt = showing.events.at(-1).occurredAt
    tick()
    service.appendTransferEvent(id, { type: 'sale_confirmed' }, manager, 'durable-sale')
    tick()
    service.appendTransferEvent(id, { type: 'delivery_confirmed' }, manager, 'durable-delivery')
    tick()
    service.appendTransferEvent(id, { type: 'closed' }, manager, 'durable-close')
    expect(service.getVehicle(request.vin, unrelated).movement).toMatchObject({
      currentLocation: 'Fowlerville', locationConfidence: 'verified',
    })

    tick()
    const movedAt = new Date(Date.parse(custodyAt) + 4 * 60_000).toISOString()
    const direct = service.createTransfer({
      vin: request.vin, intent: 'direct', requestingStore: 'Howell', destinationStore: 'Ford Detroit',
      requestedBy: homeManager.user, movedAt, reason: 'Synthetic post-sale location correction', returnRequired: true,
      priority: 'normal', customerAppointment: false,
    }, homeManager, 'direct-after-simple-close').record
    expect(direct.events[0]).toMatchObject({ type: 'direct_move_recorded', fromLocation: 'Fowlerville', toLocation: 'Ford Detroit' })
    expect(database.prepare("SELECT COUNT(*) AS n FROM transfer_events WHERE event_type='arrived'").get().n).toBe(0)
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

  it('limits simplified custody outcomes to the requesting store', () => {
    const { service, id } = harness()
    approve(service, id)
    expect(service.getTransfer(id, homeManager).allowedActions).not.toContain('record-outcome')
    expect(() => service.appendTransferEvent(id, { type: 'customer_showing' }, homeSales, 'wrong-store-showing'))
      .toThrow('requesting store')
    expect(service.appendTransferEvent(id, { type: 'customer_showing' }, sales, 'right-store-showing').record.currentLocation)
      .toBe('Fowlerville')
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

  it('rejects an event replay key when its immutable payload changes', () => {
    const { service, id } = harness()
    approve(service, id)
    const event = { type: 'return_started', dueAt: '2026-08-30T20:00:00Z', note: 'Customer finished showing' }
    expect(service.appendTransferEvent(id, event, sales, 'stable-return-start').created).toBe(true)
    expect(service.appendTransferEvent(id, event, sales, 'stable-return-start').created).toBe(false)
    expect(() => service.appendTransferEvent(
      id,
      { ...event, dueAt: '2026-08-30T21:00:00Z' },
      sales,
      'stable-return-start',
    )).toThrow('key belongs to another action')
    expect(() => service.appendTransferEvent(
      id,
      { ...event, note: 'Different immutable note' },
      sales,
      'stable-return-start',
    )).toThrow('key belongs to another action')
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
    expect(simpleView.allowedActions).toContain('schedule-return')
    expect(simpleView.allowedActions).not.toEqual(expect.arrayContaining(['confirm-pickup', 'confirm-arrival']))
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
    // The published decision matches what createTransfer is about to do.
    expect(service.getVehicle(request.vin, sales).movement.newRequestBlocked).toBe(false)
    const next = service.createTransfer(request, sales, 'synthetic-new-request-after-home-receipt')
    expect(next.created).toBe(true)
    expect(next.record.id).not.toBe(id)
    expect(service.getVehicle(request.vin, sales).movement.transferId).toBe(next.record.id)
    expect(service.getVehicle(request.vin, sales).movement.newRequestBlocked).toBe(true)
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
      // newRequestBlocked is the caller's own createTransfer outcome: one
      // boolean that the 409 text already discloses, carrying no identity.
      expect(movement.newRequestBlocked).toBe(true)
      if (role !== 'group_manager') {
        expect(Object.keys(movement).sort()).toEqual(['currentLocation', 'departedAt', 'destination', 'label', 'lastConfirmedAt', 'locationConfidence', 'newRequestBlocked', 'state'].sort())
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
      // Roles that cannot create a request never reach the 409, so the bit
      // is not published to them at all — not even as false.
      expect(movement.newRequestBlocked).toBeUndefined()
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
    expect(() => service.createTransfer({ ...request, requestedBy: alternateSales.user }, alternateSales, 'synthetic-request')).toThrow('key belongs to another request')
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
    const next = service.createTransfer({ ...request, requestingStore: 'Lincoln', requestedBy: unrelatedSales.user }, unrelatedSales, 'after-receipt')
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
      // Even the conflict shape carries the server's own new-request decision: both trips are still open.
      expect(movement).toMatchObject({ currentLocation: 'Unknown', state: 'location_exception', locationConfidence: 'conflicting', label: 'Location needs checking', newRequestBlocked: true })
      expect(movement.departedAt).toBeUndefined()
      expect(movement.transferId).toBeUndefined()
    }
    service.appendTransferEvent(later.id, { type: 'arrived', occurredAt: firstArrival }, sales)
    const agreed = service.getVehicle(request.vin, unrelated).movement
    expect(agreed).toMatchObject({ currentLocation: 'Fowlerville', locationConfidence: 'verified', newRequestBlocked: true })
    // The location agrees; the two distinct departure clocks do not.
    expect(agreed.departedAt).toBeUndefined()
    tick()
    service.appendTransferEvent(later.id, { type: 'return_started' }, sales)
    expect(service.getVehicle(request.vin, unrelated).movement).toMatchObject({ currentLocation: 'In transit', locationConfidence: 'verified', departedAt: firstArrival })
  })

  it('publishes its own new-request decision on every movement shape, decided over every ledger row rather than the visible ones', () => {
    const { service, database, id, tick } = harness()
    // Source-only vehicle: nothing blocks. Creator roles get an explicit false;
    // roles that cannot request (403 before the 409) get nothing.
    expect(service.getVehicle('TESTDATAHWELL0002', sales).movement).toMatchObject({ state: 'source_reported', newRequestBlocked: false })
    for (const role of ['driver', 'porter', 'coordinator']) {
      expect(service.getVehicle('TESTDATAHWELL0002', { ...unrelated, role }).movement.newRequestBlocked).toBeUndefined()
    }
    // A pending request blocks. The party store receives the transfer shape,
    // the unrelated store the physical-only fallback without a link; both true.
    expect(service.getVehicle(request.vin, sales).movement).toMatchObject({ transferId: id, requestStatus: 'requested', newRequestBlocked: true })
    const pending = service.getVehicle(request.vin, unrelated).movement
    expect(pending).toMatchObject({ state: 'at_home', currentLocation: 'Howell', newRequestBlocked: true })
    expect(pending.transferId).toBeUndefined()
    const lincolnRequest = { ...request, requestingStore: 'Lincoln', requestedBy: unrelatedSales.user }
    expect(() => service.createTransfer(lincolnRequest, unrelatedSales, 'lincoln-while-pending')).toThrow('already has an open move')
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    for (const context of [sales, homeManager, unrelated]) {
      expect(service.getVehicle(request.vin, context).movement).toMatchObject({ state: 'at_requesting_store', newRequestBlocked: true })
    }
    expect(() => service.createTransfer(lincolnRequest, unrelatedSales, 'lincoln-while-away')).toThrow('already has an open move')
    tick()
    service.appendTransferEvent(id, { type: 'return_started' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'returned_home' }, homeManager)
    // The receipt stays the location authority (state 'returned_home') while
    // the decision flips to false for every creator role.
    for (const context of [sales, homeManager, unrelated]) {
      const movement = service.getVehicle(request.vin, context).movement
      expect(movement).toMatchObject({ state: 'returned_home', currentLocation: 'Howell', newRequestBlocked: false })
      expect(movement.transferId).toBeUndefined()
    }
    tick()
    const next = service.createTransfer(lincolnRequest, unrelatedSales, 'lincoln-after-receipt')
    expect(next.created).toBe(true)
    // Fowlerville is party to the closed trip but not to the Lincoln request:
    // it still sees the receipt's physical shape, now with true and no link.
    const thirdStore = service.getVehicle(request.vin, sales).movement
    expect(thirdStore).toMatchObject({ state: 'returned_home', newRequestBlocked: true })
    expect(thirdStore.transferId).toBeUndefined()
    expect(JSON.stringify(thirdStore)).not.toMatch(/Lincoln manager|transferId|actor|custodian/)
    expect(service.getVehicle(request.vin, unrelated).movement.newRequestBlocked).toBe(true)
    expect(service.getVehicle(request.vin, homeManager).movement).toMatchObject({ transferId: next.record.id, state: 'returned_home', newRequestBlocked: true })
    expect(() => service.createTransfer(request, sales, 'fowlerville-while-lincoln-pending')).toThrow('already has an open move')
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(2)

    // Canceled after departure: the last physical fact is 'picked_up', 'In
    // transit', but a terminal row blocks nothing. Unreachable through the
    // simple API; models a corrected or legacy ledger.
    const canceled = harness()
    approve(canceled.service, canceled.id)
    canceled.tick()
    canceled.service.appendTransferEvent(canceled.id, { type: 'vehicle_departed' }, sales)
    canceled.tick()
    canceled.database.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?").run(SYNTHETIC_NOW.toISOString(), canceled.id)
    for (const context of [sales, homeManager, unrelated]) {
      const movement = canceled.service.getVehicle(request.vin, context).movement
      expect(movement).toMatchObject({ state: 'picked_up', currentLocation: 'In transit', locationConfidence: 'verified', newRequestBlocked: false })
      expect(movement.transferId).toBeUndefined()
      expect(movement.departedAt).toBeUndefined()
    }
    for (const role of ['driver', 'porter', 'coordinator']) {
      expect(canceled.service.getVehicle(request.vin, { ...unrelated, role }).movement.newRequestBlocked).toBeUndefined()
    }
    const afterCancel = canceled.service.createTransfer(lincolnRequest, unrelatedSales, 'lincoln-after-cancel')
    expect(afterCancel.created).toBe(true)
    for (const context of [sales, homeManager, unrelated]) {
      expect(canceled.service.getVehicle(request.vin, context).movement).toMatchObject({ state: 'picked_up', newRequestBlocked: true })
    }

    // The advanced engine allows overlaps, so there is no decision to publish.
    const legacy = harness('advanced')
    expect(legacy.service.getVehicle(request.vin, sales).movement.transferId).toBe(legacy.id)
    expect(legacy.service.getVehicle(request.vin, sales).movement.newRequestBlocked).toBeUndefined()
    expect(legacy.service.getVehicle('TESTDATAHWELL0002', sales).movement.newRequestBlocked).toBeUndefined()
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
