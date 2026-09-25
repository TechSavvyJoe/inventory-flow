// @ts-nocheck -- synthetic Node service contract.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })
const manager = { role: 'group_manager', store: 'Howell', user: 'Synthetic Manager', userId: 'synthetic-manager' }
function harness() {
  const release = buildSyntheticRelease()
  const database = openInventoryDatabase()
  databases.push(database)
  const reload = () => importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  reload()
  const service = createInventoryService({ database, now: () => SYNTHETIC_NOW })
  const item = service.listAttention({}, manager).items.find((row) => row.type === 'hold_alert')
  expect(item).toBeDefined()
  return { release, database, service, item, reload }
}

describe('attention evidence and retry regressions', () => {
  it('redacts persisted hold-event assignments in bootstrap, list and detail for transport roles', () => {
    const { service, item } = harness()
    service.appendAttentionEvent(item.id, { type: 'assign', assignee: 'SYNTHETIC PRIVATE ASSIGNEE' }, manager, 'assign')
    expect(service.getAttention(item.id, manager).events[0].assignee).toBe('SYNTHETIC PRIVATE ASSIGNEE')
    for (const role of ['driver', 'porter', 'coordinator']) {
      const context = { ...manager, role, user: 'Synthetic transport' }
      for (const result of [service.bootstrap(context).attention, service.listAttention({}, context).items, service.getAttention(item.id, context)]) {
        expect(JSON.stringify(result)).not.toContain('SYNTHETIC PRIVATE ASSIGNEE')
      }
    }
  })

  it('retains transport assignments in event projections for all transport roles', () => {
    const { service, database } = harness()
    const move = service.createTransfer({ vin: 'TESTDATAHWELL0002', requestingStore: 'Lincoln', requestedBy: manager.user, neededBy: '2026-08-31T19:00:00Z', reason: 'Synthetic transport' }, { ...manager, role: 'manager', store: 'Lincoln' }, 'move')
    database.prepare("UPDATE transfer_requests SET transport_assignee_user_id = ?, movement_status = 'transport_assigned' WHERE id = ?").run(manager.userId, move.record.id)
    const item = service.listAttention({}, manager).items.find((row) => row.sourceId === move.record.id)
    service.appendAttentionEvent(item.id, { type: 'assign', assignee: 'Synthetic Driver' }, manager, 'assign')
    for (const role of ['driver', 'porter', 'coordinator']) {
      expect(service.getAttention(item.id, { ...manager, role, store: 'Lincoln' }).events[0].assignee).toBe('Synthetic Driver')
    }
  })

  it.each(['alert', 'hold identity'])('opens a new condition for changed %s, retaining old audit', (change) => {
    const { service, database, release, item, reload } = harness()
    service.appendAttentionEvent(item.id, { type: 'resolve', resolutionCode: 'action_completed' }, manager, 'resolve')
    const source = release.vehicles.find((row) => row.vin === item.vin)
    source.crmRecord.capturedAt = '2026-08-30T23:00:00Z'
    const unrelated = release.vehicles.find((row) => row.vin !== item.vin && row.holdRecord)
    unrelated.holdRecord.holdDetailRows[0].customerOrReasonRaw = 'Unrelated synthetic change'
    reload()
    expect(service.getAttention(item.id, manager).status).toBe('resolved')
    if (change === 'alert') {
      const alerts = source.crmRecord.alerts ?? source.holdRecord.alerts
      alerts[0].alertTextRaw = 'Replacement synthetic alert with the same count'
    } else source.holdRecord.holdDetailRows[0].customerOrReasonRaw = 'New synthetic hold identity'
    reload()
    const next = service.listAttention({}, manager).items.find((row) => row.vin === item.vin)
    expect(next.id).not.toBe(item.id)
    expect(next.status).toBe('open')
    expect(database.prepare('SELECT event_type FROM attention_events WHERE attention_key = ?').all(item.id)).toEqual([{ event_type: 'resolve' }])
    for (const role of ['driver', 'porter', 'coordinator', 'sales', 'manager']) {
      expect(service.listAttention({}, { ...manager, role }).items.find((row) => row.vin === item.vin).id).toBe(next.id)
    }
  })

  it.each([
    { note: 'Different note' }, { assignee: 'Different assignee' }, { assignedRole: 'driver' },
    { followUpAt: '2026-09-01T12:00:00Z' }, { priority: 'urgent' },
    { resolutionCode: 'other' }, { occurredAt: '2026-08-30T12:00:00Z' }, { type: 'acknowledge' },
  ])('rejects changed semantic input %j under an existing key', (change) => {
    const { service, item } = harness()
    const input = { type: 'add_note', note: 'Original note' }
    service.appendAttentionEvent(item.id, input, manager, 'note')
    expect(() => service.appendAttentionEvent(item.id, { ...input, ...change }, manager, 'note')).toThrow(expect.objectContaining({ status: 409, code: 'IDEMPOTENCY_CONFLICT' }))
  })

  it('binds actor context and returns current state on a normalized delayed retry', () => {
    const { service, item } = harness()
    const input = { type: 'add_note', note: 'Original note' }
    service.appendAttentionEvent(item.id, input, manager, 'note')
    service.appendAttentionEvent(item.id, { type: 'resolve', resolutionCode: 'action_completed' }, manager, 'resolve')
    const retry = service.appendAttentionEvent(item.id, { type: ' ADD_NOTE ', note: ' Original note ' }, manager, ' note ')
    expect(retry).toMatchObject({ created: false, record: { status: 'resolved' } })
    expect(retry.record.events).toHaveLength(2)
    for (const change of [{ user: 'Other actor' }, { userId: 'other-id' }, { store: 'Lincoln' }, { role: 'manager' }]) {
      expect(() => service.appendAttentionEvent(item.id, input, { ...manager, ...change }, 'note')).toThrow(expect.objectContaining({ status: 409 }))
    }
  })
})
