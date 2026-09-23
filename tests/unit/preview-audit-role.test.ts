// @ts-nocheck -- shared Node/Worker service contract, synthetic records only.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

function harness() {
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  return { database, service: createInventoryService({ database, now: () => new Date(SYNTHETIC_NOW) }) }
}

// A group manager previewing another role acts under that role's permissions,
// but the audit trail records who actually signed in, the same convention
// transfer events already follow (server/workflow.mjs actorRole).
const previewingManager = {
  role: 'manager', store: 'Howell', user: 'Synthetic group manager', userId: 'group-1',
  authenticatedRole: 'group_manager', authenticatedStore: 'Howell',
}

describe('audit role while previewing', () => {
  it('records the signed-in role on a service-readiness update', () => {
    const { database, service } = harness()
    const saved = service.updateServiceReadiness('TESTDATAHWELL0001', { status: 'needs_service', expectedVersion: 0 }, previewingManager, 'preview-service')
    expect(saved.created).toBe(true)
    expect(saved.record.updatedByRole).toBe('group_manager')
    expect(database.prepare('SELECT actor_role FROM vehicle_service_events WHERE idempotency_key = ?').get('preview-service').actor_role).toBe('group_manager')
    // Without a preview the signed-in role is the role.
    const direct = service.updateServiceReadiness('TESTDATAHWELL0001', { status: 'in_service', expectedVersion: 1, serviceDate: '2026-08-30' }, { role: 'manager', store: 'Howell', user: 'Synthetic manager', userId: 'manager-1' }, 'direct-service')
    expect(direct.record.updatedByRole).toBe('manager')
  })

  it('records the signed-in role on an action-center event and still replays the same key', () => {
    const { database, service } = harness()
    const item = service.listAttention({}, previewingManager).items.find((candidate) => candidate.allowedActions?.includes('acknowledge'))
    expect(item).toBeTruthy()
    const first = service.appendAttentionEvent(item.id, { type: 'acknowledge' }, previewingManager, 'preview-attention')
    expect(first.created).toBe(true)
    const row = database.prepare('SELECT actor_role FROM attention_events WHERE idempotency_key = ?').get('preview-attention')
    expect(row.actor_role).toBe('group_manager')
    expect(database.prepare('SELECT last_actor_role FROM attention_work_items WHERE attention_key = ?').get(item.id).last_actor_role).toBe('group_manager')
    expect(first.record.events.at(-1)).toMatchObject({ type: 'acknowledge', actorRole: 'group_manager' })
    expect(service.appendAttentionEvent(item.id, { type: 'acknowledge' }, previewingManager, 'preview-attention').created).toBe(false)
  })
})
