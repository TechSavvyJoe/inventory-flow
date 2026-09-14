// @ts-nocheck -- shared Node/Worker service contract, synthetic records only.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { toInventoryVehicle } from '../../src/app/adapters'
import { canRequestVehicleMove, movementTrackingPath, transferByVin } from '../../src/features/inventory/inventory-utils'
import { canRequestVehicle, toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic requesting manager', userId: 'manager-1' }
const homeManager = { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }
const unrelated = { role: 'manager', store: 'Lincoln', user: 'Synthetic unrelated manager', userId: 'manager-3' }
const request = {
  vin: 'TESTDATAHWELL0001', requestingStore: 'Fowlerville', requestedBy: sales.user,
  neededBy: '2026-08-30T19:00:00Z', returnDueAt: '2026-08-31T19:00:00Z',
  reason: 'Synthetic customer showing', priority: 'normal', returnRequired: true,
}
const lincolnRequest = { ...request, requestingStore: 'Lincoln', requestedBy: unrelated.user }

function harness() {
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  let clock = new Date(SYNTHETIC_NOW)
  const service = createInventoryService({ database, now: () => clock })
  const created = service.createTransfer(request, sales, 'synthetic-request')
  return { database, service, id: created.record.id, tick: () => { clock = new Date(clock.getTime() + 60_000) }, now: () => clock }
}

function approve(service, id) {
  return service.appendTransferEvent(id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'synthetic-approval')
}

/**
 * Both clients, built exactly as they are in production: the app through
 * InventoryPage's one-row-per-VIN join of bootstrap.transfers, the Deal Desk
 * panel through toPanelVehicle. Returns each one's Request decision next to
 * the server's own answer.
 */
function clientViews(service, context, vin, now) {
  const data = service.bootstrap(context)
  const record = data.vehicles.find((vehicle) => vehicle.vin === vin)
  const joined = transferByVin(data.transfers).get(vin)
  const app = toInventoryVehicle(record, data, joined)
  const panel = toPanelVehicle(record, data, { now: now.getTime() })
  return {
    server: record.movement,
    app,
    panel,
    appCanRequest: canRequestVehicleMove(app, context.role, context.store.toLowerCase()),
    panelCanRequest: canRequestVehicle(panel, data.access),
    joinedStatus: joined?.requestStatus ?? null,
  }
}

function attempt(service, body, context, key) {
  try {
    return service.createTransfer(body, context, key).created ? 'created' : 'replayed'
  } catch (error) {
    if (error.code !== 'ACTIVE_TRANSFER_EXISTS') throw error
    return 'refused'
  }
}

describe('the app and the Deal Desk panel reach the server\'s request decision', () => {
  it('agrees with createTransfer on every party-store shape, without a stale transfer link', () => {
    const { service, database, id, tick, now } = harness()

    // Pending: the requesting store sees the link, a third store the physical
    // shape only; both are blocked and neither client offers a request.
    const pending = clientViews(service, sales, request.vin, now())
    expect(pending.server).toMatchObject({ transferId: id, newRequestBlocked: true })
    expect(pending.app.movement).toMatchObject({ requestId: id, requestStatus: 'requested', withheld: false })
    expect(movementTrackingPath(pending.app)).toBe(`/transfers?id=${id}`)
    expect(pending.panel.movement).toMatchObject({ transferId: id, withheld: false })
    expect([pending.appCanRequest, pending.panelCanRequest]).toEqual([false, false])
    const pendingThird = clientViews(service, unrelated, request.vin, now())
    expect(pendingThird.server.transferId).toBeUndefined()
    expect(pendingThird.app.movement).toMatchObject({ requestId: null, withheld: true })
    expect(pendingThird.panel.movement).toMatchObject({ transferId: null, withheld: true })
    expect([pendingThird.appCanRequest, pendingThird.panelCanRequest]).toEqual([false, false])
    expect(attempt(service, lincolnRequest, unrelated, 'lincoln-while-pending')).toBe('refused')

    // Canceled before anything moved: the row stays in the requesting store's
    // bootstrap.transfers as terminal. The vehicle is a plain source report
    // again — no open move, no app-confirmed location, no Track link — and the
    // server accepts a new request.
    tick()
    service.appendTransferEvent(id, { type: 'canceled' }, manager, 'synthetic-cancel')
    const earlyCancel = clientViews(service, sales, request.vin, now())
    expect(earlyCancel.joinedStatus).toBe('canceled')
    expect(earlyCancel.server).toMatchObject({ state: 'source_reported', newRequestBlocked: false })
    expect(earlyCancel.app.movement).toBeNull()
    expect(earlyCancel.app.location).toMatchObject({ appConfirmedLocation: null, appConfirmedAt: null })
    expect(earlyCancel.app.timeline.map((event) => event.title)).toEqual(['Vehicle requested', 'Request canceled'])
    expect(movementTrackingPath(earlyCancel.app)).toBeNull()
    expect(earlyCancel.panel.movement).toBeNull()
    expect(earlyCancel.panel.location.provenance).toBe('source-reported')
    expect([earlyCancel.appCanRequest, earlyCancel.panelCanRequest]).toEqual([true, true])
    tick()
    expect(attempt(service, request, sales, 'fowlerville-after-cancel')).toBe('created')
    expect(database.prepare('SELECT COUNT(*) AS n FROM transfer_requests').get().n).toBe(2)
  })

  it('offers a new request for a trip canceled after it departed, keeping the stale physical pill', () => {
    const { service, database, id, tick, now } = harness()
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales, 'synthetic-departure')
    tick()
    // Unreachable through the simple API; models a corrected or legacy ledger.
    database.prepare("UPDATE transfer_requests SET status='canceled', closed_at=? WHERE id=?").run(now().toISOString(), id)

    // The requesting store is handed the canceled row by InventoryPage's join;
    // a third store never was. Both must land on the server's physical-only
    // shape: still 'picked_up', but no request id, due date or next action
    // from the canceled request — so no Track movement and no overdue pill.
    const partyStore = clientViews(service, sales, request.vin, now())
    expect(partyStore.joinedStatus).toBe('canceled')
    expect(partyStore.server).toMatchObject({ state: 'picked_up', currentLocation: 'In transit', newRequestBlocked: false })
    const thirdStore = clientViews(service, unrelated, request.vin, now())
    expect(thirdStore.joinedStatus).toBeNull()
    for (const view of [partyStore, thirdStore]) {
      expect(view.app.movement).toMatchObject({ state: 'picked_up', requestId: null, requestStatus: null, withheld: true, nextAction: null, dueAt: null, overdue: false })
      expect(view.app.location).toMatchObject({ appConfirmedLocation: 'In transit', appConfirmedStore: null })
      expect(movementTrackingPath(view.app)).toBeNull()
      expect(view.panel.movement).toMatchObject({ state: 'picked_up', transferId: null, withheld: true, overdue: false })
      expect([view.appCanRequest, view.panelCanRequest]).toEqual([true, true])
    }
    expect(partyStore.app.movement).toEqual(thirdStore.app.movement)
    expect(partyStore.app.timeline.map((event) => event.title)).toContain('Vehicle left the home store')
    expect(attempt(service, lincolnRequest, unrelated, 'lincoln-after-cancel')).toBe('created')

    // Once Lincoln's request is open, the Fowlerville store is still handed
    // its own canceled row: the server's decision, not the joined row, is what
    // blocks a further request.
    const blocked = clientViews(service, sales, request.vin, now())
    expect(blocked.joinedStatus).toBe('canceled')
    expect(blocked.server).toMatchObject({ state: 'picked_up', newRequestBlocked: true })
    expect(blocked.server.transferId).toBeUndefined()
    expect(blocked.app.movement).toMatchObject({ requestId: null, withheld: true })
    expect([blocked.appCanRequest, blocked.panelCanRequest]).toEqual([false, false])
    expect(attempt(service, request, sales, 'fowlerville-while-lincoln-open')).toBe('refused')
  })

  it('lets the server\'s transfer link outrank an older closed row from the same join', () => {
    const { service, id, tick, now } = harness()
    approve(service, id)
    tick()
    service.appendTransferEvent(id, { type: 'vehicle_departed' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'arrived' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'return_started' }, sales)
    tick()
    service.appendTransferEvent(id, { type: 'returned_home' }, homeManager)
    tick()
    const reopened = service.createTransfer(lincolnRequest, unrelated, 'lincoln-after-receipt').record

    // The home store is party to both rows. The join now picks the open
    // request, and the server links the same one; either way it must win.
    const home = clientViews(service, homeManager, request.vin, now())
    expect(home.joinedStatus).toBe('requested')
    expect(home.server).toMatchObject({ transferId: reopened.id, requestStatus: 'requested', state: 'returned_home', newRequestBlocked: true })
    expect(home.app.movement).toMatchObject({ requestId: reopened.id, requestStatus: 'requested', withheld: false })
    expect(movementTrackingPath(home.app)).toBe(`/transfers?id=${reopened.id}`)
    expect(home.panel.movement).toMatchObject({ transferId: reopened.id })

    // Fowlerville is party to the closed trip only: the receipt is location
    // evidence, the joined closed row adds nothing, and the server's decision
    // is what withholds the request.
    const fowlerville = clientViews(service, sales, request.vin, now())
    expect(fowlerville.joinedStatus).toBe('closed')
    expect(fowlerville.server).toMatchObject({ state: 'returned_home', newRequestBlocked: true })
    expect(fowlerville.server.transferId).toBeUndefined()
    expect(fowlerville.app.movement).toBeNull()
    expect(fowlerville.app.location).toMatchObject({ appConfirmedLocation: 'Howell' })
    expect(movementTrackingPath(fowlerville.app)).toBeNull()
    expect(fowlerville.panel.movement).toBeNull()
    expect([fowlerville.appCanRequest, fowlerville.panelCanRequest]).toEqual([false, false])
    expect(JSON.stringify([fowlerville.app.movement, fowlerville.app.location, fowlerville.panel])).not.toContain(reopened.id)
    expect(attempt(service, request, sales, 'fowlerville-while-lincoln-pending')).toBe('refused')
  })
})
