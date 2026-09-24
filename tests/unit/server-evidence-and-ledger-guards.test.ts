// @ts-nocheck -- shared Node/Worker service contract, synthetic records only.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

const LOANER_ALERT = 'LCTP loaner out to synthetic customer until 9/12, synthetic deal #0000'

function harness({ workflowMode = 'simple', mutate } = {}) {
  const release = buildSyntheticRelease({ includeDemoChanges: true })
  mutate?.(release)
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  let clock = new Date(SYNTHETIC_NOW)
  const service = createInventoryService({ database, now: () => clock, workflowMode })
  return { service, database, release, tick: () => { clock = new Date(clock.getTime() + 60_000) } }
}

describe('loaner alert redaction', () => {
  const withLoaner = (release) => {
    const vehicle = release.vehicles.find((row) => row.crmRecord && row.publicRecord)
    vehicle.crmRecord.alerts = [{ alertTextRaw: LOANER_ALERT, authorRaw: 'Synthetic manager', timestampRaw: '08/30/2026 09:20 AM' }]
    return vehicle
  }

  it.each(['driver', 'porter', 'coordinator'])('keeps the raw DealerMail alert text away from %s while preserving the operational signal', (role) => {
    let vin, store
    const { service } = harness({ mutate: (release) => { const vehicle = withLoaner(release); vin = vehicle.vin; store = vehicle.publicRecord.store } })
    const context = { role, store, user: `Synthetic ${role}` }
    const detail = service.getVehicle(vin, context)
    expect(detail.privateEvidence).toBeUndefined()
    expect(detail.hold.loaner).toMatchObject({ active: true, program: 'LCTP', label: 'Current loaner LCTP', serviceDate: '9/12' })
    expect(detail.hold.loaner).not.toHaveProperty('rawAlert')
    const row = service.listVehicles({}, context).items.find((item) => item.vin === vin)
    expect(row.hold.loaner).not.toHaveProperty('rawAlert')
    expect(JSON.stringify(detail)).not.toContain('synthetic deal')
    expect(JSON.stringify(row)).not.toContain('synthetic deal')
  })

  it.each(['sales', 'manager', 'group_manager'])('still shows the raw alert to %s, who may view hold evidence', (role) => {
    let vin, store
    const { service } = harness({ mutate: (release) => { const vehicle = withLoaner(release); vin = vehicle.vin; store = vehicle.publicRecord.store } })
    const context = { role, store, user: `Synthetic ${role}` }
    expect(service.getVehicle(vin, context).hold.loaner.rawAlert).toBe(LOANER_ALERT)
    expect(service.listVehicles({}, context).items.find((item) => item.vin === vin).hold.loaner.rawAlert).toBe(LOANER_ALERT)
  })
})

describe('transfer event time guards', () => {
  const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic salesperson', userId: 'sales-1' }
  const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic manager', userId: 'manager-1' }
  const groupManager = { role: 'group_manager', store: 'Howell', user: 'Synthetic group manager', userId: 'gm-1' }
  const vin = 'TESTDATAHWELL0002'

  function approvedMove(service) {
    const created = service.createTransfer({ vin, neededBy: '2026-08-31T14:00:00-04:00', reason: 'Synthetic showing' }, sales, 'request')
    service.appendTransferEvent(created.record.id, { type: 'request_approved', availabilityConfirmed: true }, manager, 'approve')
    return created.record.id
  }

  it('rejects an occurredAt materially in the future or older than 90 days', () => {
    const { service } = harness()
    const id = approvedMove(service)
    expect(() => service.appendTransferEvent(id, { type: 'customer_showing', occurredAt: '2099-01-01T00:00:00Z' }, sales, 'future'))
      .toThrow(/occurredAt cannot be materially in the future/)
    const stale = new Date(SYNTHETIC_NOW.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString()
    expect(() => service.appendTransferEvent(id, { type: 'customer_showing', occurredAt: stale }, sales, 'stale'))
      .toThrow(/occurredAt cannot be more than 90 days ago/)
    const recent = new Date(SYNTHETIC_NOW.getTime() - 10 * 60_000).toISOString()
    const showing = service.appendTransferEvent(id, { type: 'customer_showing', occurredAt: recent }, sales, 'recent')
    expect(showing.record.lastConfirmedAt).toBe(recent)
  })

  it('rejects zone-less timestamps instead of reading them in the server zone', () => {
    const { service } = harness()
    const id = approvedMove(service)
    for (const occurredAt of ['2026-08-30T10:15', '2026-08-30T10:15:00', '2026-08-30', 'August 30 2026']) {
      expect(() => service.appendTransferEvent(id, { type: 'note_added', note: 'Synthetic note', occurredAt }, sales, `zoneless-${occurredAt}`), occurredAt)
        .toThrow(/explicit timezone/)
    }
    for (const occurredAt of ['2026-08-30T10:15:00Z', '2026-08-30T10:15:00.000Z', '2026-08-30T06:15:00-04:00', '2026-08-30T10:15Z']) {
      expect(() => service.appendTransferEvent(id, { type: 'note_added', note: 'Synthetic note', occurredAt }, sales, `zoned-${occurredAt}`), occurredAt).not.toThrow()
    }
    expect(() => service.createTransfer({ vin: 'TESTDATAHWELL0001', neededBy: '2026-08-31T14:00', reason: 'Synthetic showing' }, sales, 'zoneless-request'))
      .toThrow(/neededBy must be an ISO timestamp with an explicit timezone/)
  })

  it('keeps ledger recency on the server clock so a backdated event does not hide the move', () => {
    const { service, database, tick } = harness()
    const id = approvedMove(service)
    tick()
    const backdated = new Date(SYNTHETIC_NOW.getTime() - 30 * 60_000).toISOString()
    service.appendTransferEvent(id, { type: 'note_added', note: 'Synthetic note' , occurredAt: backdated }, sales, 'note')
    const row = database.prepare('SELECT updated_at FROM transfer_requests WHERE id = ?').get(id)
    expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(backdated))
  })

  it('does not let a direct move be blocked forever by a bounded occurredAt', () => {
    const { service, tick } = harness()
    const id = approvedMove(service)
    tick()
    service.appendTransferEvent(id, { type: 'customer_showing' }, sales, 'showing')
    tick()
    service.appendTransferEvent(id, { type: 'return_started' }, sales, 'return')
    tick()
    service.appendTransferEvent(id, { type: 'returned_home' }, { role: 'manager', store: 'Howell', user: 'Synthetic home manager', userId: 'manager-2' }, 'home')
    tick()
    const direct = service.createTransfer({ vin, intent: 'direct', requestingStore: 'Howell', destinationStore: 'Lincoln', requestedBy: groupManager.user, reason: 'Synthetic reroute', returnRequired: true }, groupManager, 'direct')
    expect(direct.created).toBe(true)
  })

  it('rejects an ETA update on a declined move instead of rewriting the closed ledger row', () => {
    const { service, database } = harness()
    const created = service.createTransfer({ vin, neededBy: '2026-08-31T14:00:00-04:00', reason: 'Synthetic showing' }, sales, 'request')
    const id = created.record.id
    service.appendTransferEvent(id, { type: 'request_declined', note: 'Synthetic decline' }, manager, 'decline')
    const before = database.prepare('SELECT status, due_at, updated_at FROM transfer_requests WHERE id = ?').get(id)
    expect(before.status).toBe('declined')
    expect(() => service.appendTransferEvent(id, { type: 'eta_updated', dueAt: '2027-05-05T12:00:00Z' }, { role: 'coordinator', store: 'Howell', user: 'Synthetic coordinator', userId: 'coord-1' }, 'eta'))
      .toThrow()
    expect(database.prepare('SELECT status, due_at, updated_at FROM transfer_requests WHERE id = ?').get(id)).toEqual(before)
  })
})

describe('attention coverage for active moves', () => {
  it('lists every active move as an attention item rather than capping at twenty', () => {
    const { service, tick } = harness({ workflowMode: 'advanced' })
    const groupManager = { role: 'group_manager', store: 'Howell', user: 'Synthetic group manager', userId: 'gm-1' }
    const vehicles = service.listVehicles({ scope: 'group', limit: 50 }, groupManager).items.map((item) => ({ vin: item.vin, store: item.homeStore }))
    let count = 0
    for (let index = 0; index < 22; index += 1) {
      const { vin, store } = vehicles[index % vehicles.length]
      const requestingStore = store === 'Fowlerville' ? 'Howell' : 'Fowlerville'
      const created = service.createTransfer({ vin, neededBy: '2026-08-31T14:00:00-04:00', reason: `Synthetic request ${index}` }, { role: 'sales', store: requestingStore, user: `Synthetic salesperson ${index}`, userId: `sales-${index}` }, `request-${index}`)
      if (created.created) count += 1
      tick()
    }
    expect(count).toBeGreaterThan(20)
    const attention = service.listAttention({ type: 'transfer_next_action', limit: 100 }, groupManager)
    expect(attention.items.length).toBe(count)
  })
})
