// @ts-nocheck -- shared Node/Worker service contract, synthetic records only.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const manager = (store) => ({ role: 'manager', store, user: `Synthetic ${store} manager`, userId: `manager-${store}` })
const sales = (store) => ({ role: 'sales', store, user: `Synthetic ${store} salesperson`, userId: `sales-${store}` })
const driver = (store) => ({ role: 'driver', store, user: `Synthetic ${store} driver`, userId: `driver-${store}` })

function harness({ release = buildSyntheticRelease(), now = SYNTHETIC_NOW } = {}) {
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  const service = createInventoryService({ database, now: () => new Date(now) })
  return { database, service }
}

function scopedItems(service, context) {
  return service.bootstrap(context).attention.filter(
    (item) => !item.store || item.store === context.store || (item.relatedStores ?? []).includes(context.store),
  )
}

/** The count the badge used before triage: every scoped item except source health. */
function badgeBefore(items) {
  return items.filter((item) => item.type !== 'source_freshness' && item.status !== 'resolved').length
}

/** The count the badge shows now: actionable items, collapsed per vehicle. */
function badgeAfter(items) {
  const actionable = items.filter((item) => item.actionability === 'actionable' && item.status !== 'resolved')
  return new Set(actionable.map((item) => (item.vin ? `vin:${item.vin}` : `item:${item.id}`))).size
}

/** One move owned by Fowlerville and one Howell return already travelling home. */
function movesHarness() {
  const { service } = harness()
  const awayRequest = {
    vin: 'TESTDATAHWELL0001', requestingStore: 'Fowlerville', requestedBy: sales('Fowlerville').user,
    neededBy: '2026-08-30T19:00:00Z', returnDueAt: '2026-08-31T19:00:00Z',
    reason: 'Synthetic customer showing', priority: 'normal', returnRequired: true,
  }
  const away = service.createTransfer(awayRequest, sales('Fowlerville'), 'triage-request-away')
  service.appendTransferEvent(away.record.id, { type: 'request_approved', availabilityConfirmed: true }, manager('Fowlerville'), 'triage-approve-away')

  const returning = service.createTransfer(
    { ...awayRequest, vin: 'TESTDATAHWELL0002', requestingStore: 'Lincoln', requestedBy: sales('Lincoln').user },
    sales('Lincoln'), 'triage-request-return',
  )
  for (const [type, context, key] of [
    ['request_approved', manager('Lincoln'), 'approve'],
    ['vehicle_departed', manager('Howell'), 'depart'],
    ['arrived', manager('Lincoln'), 'arrive'],
    ['return_started', manager('Lincoln'), 'return'],
  ]) {
    service.appendTransferEvent(returning.record.id, { type, availabilityConfirmed: true }, context, `triage-${key}`)
  }
  return { service, awayId: away.record.id, returningId: returning.record.id }
}

describe('Action center triage', () => {
  it('counts only the work a store and role can take, and leaves the rest classified', () => {
    const { service } = movesHarness()
    const counts = {}
    for (const store of STORES) {
      const items = scopedItems(service, manager(store))
      counts[store] = { before: badgeBefore(items), after: badgeAfter(items) }
      expect(items.every((item) => ['actionable', 'informational'].includes(item.actionability))).toBe(true)
      // Nothing is dropped: every scoped item is still returned, just classified.
      expect(items.filter((item) => item.actionability === 'informational').length)
        .toBe(items.length - items.filter((item) => item.actionability === 'actionable').length)
    }
    expect(counts).toEqual({
      Howell: { before: 3, after: 2 },
      Fowlerville: { before: 1, after: 1 },
      'Ford Detroit': { before: 0, after: 0 },
      Lincoln: { before: 2, after: 1 },
    })
  })

  it('gives a move to the store that owns its next step, not to every store it touches', () => {
    const { service, awayId, returningId } = movesHarness()
    const away = scopedItems(service, manager('Howell')).find((item) => item.sourceId === awayId)
    expect(away).toMatchObject({ type: 'transfer_next_action', store: 'Fowlerville', actionStore: 'Fowlerville' })
    expect(away.relatedStores).toEqual(expect.arrayContaining(['Howell', 'Fowlerville']))
    expect(away).toMatchObject({ actionability: 'informational', informationalReason: 'other_store' })
    expect(scopedItems(service, manager('Fowlerville')).find((item) => item.sourceId === awayId))
      .toMatchObject({ actionability: 'actionable', informationalReason: null })

    const returning = scopedItems(service, manager('Howell')).find((item) => item.sourceId === returningId)
    expect(returning).toMatchObject({ actionStore: 'Howell', actionability: 'actionable' })
    expect(scopedItems(service, manager('Lincoln')).find((item) => item.sourceId === returningId))
      .toMatchObject({ actionability: 'informational', informationalReason: 'other_store' })
  })

  it('keeps source health and website pricing out of every store badge', () => {
    const release = buildSyntheticRelease()
    const unpriced = release.vehicles.find((vehicle) => vehicle.publicRecord?.store === 'Howell')
    unpriced.publicRecord.listed_price = null
    if (unpriced.crmRecord) unpriced.crmRecord.priceNumber = null
    const { service } = harness({ release, now: new Date(SYNTHETIC_NOW.getTime() + 3 * 24 * 60 * 60 * 1000) })
    const items = scopedItems(service, manager('Howell'))

    expect(items.find((item) => item.type === 'source_freshness'))
      .toMatchObject({ actionability: 'informational', informationalReason: 'source_health' })
    expect(items.find((item) => item.type === 'missing_price'))
      .toMatchObject({ store: 'Howell', actionability: 'informational', informationalReason: 'public_listing' })
    // Both conditions still carry their evidence and their recommended action.
    expect(items.find((item) => item.type === 'source_freshness').sourceLabel).toBe('Daily source health')
    expect(badgeAfter(items)).toBe(0)
  })

  it('routes hold review to the store that owns the hold and to the roles that perform it', () => {
    const { service } = harness()
    const held = scopedItems(service, sales('Howell')).find((item) => item.type === 'hold_alert')
    expect(held).toMatchObject({ store: 'Howell', actionability: 'actionable', informationalReason: null })
    expect(service.bootstrap(sales('Fowlerville')).attention.find((item) => item.id === held.id))
      .toMatchObject({ actionability: 'informational', informationalReason: 'other_store' })

    const forDriver = service.bootstrap(driver('Howell')).attention.find((item) => item.type === 'hold_alert')
    expect(forDriver).toMatchObject({ actionability: 'informational', informationalReason: 'role_scope' })
  })

  it('classifies without changing what each role is allowed to see', () => {
    const { service } = harness()
    const privileged = service.bootstrap(manager('Howell')).attention.find((item) => item.type === 'hold_alert')
    const forDriver = service.bootstrap(driver('Howell')).attention.find((item) => item.type === 'hold_alert')

    expect(forDriver.id).toBe(privileged.id)
    expect(forDriver.allowedActions).toEqual([])
    expect(forDriver.resolutionNote ?? null).toBeNull()
    expect(forDriver.events).toEqual([])
    // The DealerMail salesperson stays inside the privileged snapshot.
    expect(forDriver.owner).toBe('Howell manager')
    expect(Object.keys(privileged)).toEqual(expect.arrayContaining([
      'id', 'severity', 'type', 'label', 'store', 'relatedStores', 'sourceLabel', 'whyItMatters',
      'recommendedAction', 'href', 'status', 'priority', 'allowedActions', 'events',
    ]))
  })
})
