// @ts-nocheck -- D1's Worker binding is exercised through real SQLite semantics.
// @vitest-environment node

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { getCurrentDataset, importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { datasetFromRelease, loadD1Repository, RepositoryConflictError } from '../../cloudflare/src/repository.mjs'

const openDatabases = []
afterEach(() => { while (openDatabases.length) openDatabases.pop().close() })

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:')
  openDatabases.push(sqlite)
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const name of ['0001_initial.sql', '0002_app_access.sql']) {
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
    transportAssignee: null, nextAction: 'Review request', nextActionOwner: 'Synthetic manager', dueAt: requestAt,
    returnRequired: true, returnDueAt: null, lastConfirmedAt: requestAt, locationConfidence: 'reported', closedAt: null,
    createdAt: requestAt, updatedAt: requestAt, idempotencyKey: `${id}:key`, ...overrides,
  }
}
function syntheticEvent(id = 'SYNTHETIC-event-a', overrides = {}) {
  return {
    id, eventType: 'requested', label: 'Requested', actor: 'Synthetic salesperson', actorRole: 'sales', storeId: 'Fowlerville',
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
    const event = syntheticEvent('SYNTHETIC-event-note', { eventType: 'note_added', note: 'Synthetic audit note' })
    next.repository.appendTransferEvent(next.database, 'SYNTHETIC-request-a', event, { next_action: 'Call home manager', updated_at: requestAt, vin: 'wrong', requested_by: 'wrong' })
    await next.commit()
    const restored = await loadD1Repository(d1, buildSyntheticRelease())
    const row = restored.repository.getTransferRow(restored.database, 'SYNTHETIC-request-a')
    expect(row).toMatchObject({ vin: syntheticRequest().vin, requested_by: 'Synthetic salesperson', next_action: 'Call home manager' })
    expect(restored.repository.getTransferEvents(restored.database, row.id)).toHaveLength(2)
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
