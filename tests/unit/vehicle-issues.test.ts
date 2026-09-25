// @ts-nocheck -- exercises the shared ESM domain through real SQLite adapters.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { createIntegrationReadService } from '../../server/integrations/read-service.mjs'
import { canReportVehicleIssue } from '../../server/vehicle-issues.mjs'
import { loadD1Repository, RepositoryConflictError } from '../../cloudflare/src/repository.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'

const VIN = 'TESTDATAHWELL0001'
const marker = 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS'
const sales = { role: 'sales', store: 'Howell', user: 'Synthetic Sales', userId: 'synthetic-issue-sales' }
const manager = { role: 'manager', store: 'Howell', user: 'Synthetic Manager', userId: 'synthetic-issue-manager' }
const group = { role: 'group_manager', store: 'Lincoln', user: 'Synthetic Group Manager', userId: 'synthetic-issue-group' }
const input = { category: 'cleaning', priority: 'normal', description: `${marker} windshield needs cleaning` }
const photo = (index = 1) => ({ id: index.toString(16).padStart(64, '0'), contentType: 'image/jpeg', bytes: 1200 })
const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

function local() {
  const database = openInventoryDatabase()
  databases.push(database)
  importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  return { database, service: createInventoryService({ database, now: () => SYNTHETIC_NOW }) }
}

async function cloud({ migrated = true } = {}) {
  const database = new DatabaseSync(':memory:')
  databases.push(database)
  applySyntheticSchema(database)
  if (!migrated) database.exec('DROP TABLE vehicle_issue_events; DROP TABLE vehicle_issues;')
  const d1 = sqliteD1(database)
  const cold = async () => {
    const repository = await loadD1Repository(d1, buildSyntheticRelease())
    return { ...repository, service: createInventoryServiceCore({ database: repository.database, repository: repository.repository, now: () => SYNTHETIC_NOW }) }
  }
  return { database, cold }
}

describe('durable vehicle issues', () => {
  it('requires a manager to assign and confirm completion, independently of service readiness', () => {
    const { service } = local()
    const before = service.getServiceReadiness(VIN, manager)
    const issue = service.createVehicleIssue(VIN, input, sales, 'create-1').record
    expect(issue).toMatchObject({ category: 'cleaning', status: 'open', version: 1, reportStore: 'Howell', reportedByUserId: sales.userId })
    expect(issue.allowedActions).not.toContain('complete')
    for (const type of ['assign', 'complete', 'reopen']) {
      expect(() => service.appendVehicleIssueEvent(issue.id, { type, expectedVersion: 1, assignee: 'Detail team', note: 'Verified' }, sales, `deny-${type}`))
        .toThrowError(expect.objectContaining({ status: 403, code: 'ISSUE_MANAGER_REQUIRED' }))
    }
    const assigned = service.appendVehicleIssueEvent(issue.id, { type: 'assign', expectedVersion: 1, assignee: 'Detail team' }, manager, 'assign-1').record
    expect(assigned).toMatchObject({ status: 'open', version: 2, assignee: 'Detail team' })
    service.appendVehicleIssueEvent(issue.id, { type: 'start_work', expectedVersion: 2 }, sales, 'start-1')
    const ready = service.appendVehicleIssueEvent(issue.id, { type: 'request_completion', expectedVersion: 3 }, sales, 'review-1').record
    expect(ready).toMatchObject({ status: 'awaiting_review', completedAt: null, version: 4 })
    expect(() => service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 4 }, manager, 'complete-empty')).toThrow('Update note is required')
    const done = service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 4, note: 'Checked clean windshield' }, manager, 'complete-1').record
    expect(done).toMatchObject({ status: 'completed', completedBy: manager.user, completedAt: SYNTHETIC_NOW.toISOString(), version: 5 })
    expect(done.events.at(-1)).toMatchObject({ actorUserId: manager.userId, actorRole: 'manager', type: 'complete' })
    expect(service.getServiceReadiness(VIN, manager)).toEqual(before)
    const reopened = service.appendVehicleIssueEvent(issue.id, { type: 'reopen', expectedVersion: 5, note: 'Needs another pass' }, manager, 'reopen-1').record
    expect(reopened).toMatchObject({ status: 'open', completedAt: null, completedBy: null, version: 6 })
    expect(reopened.events).toHaveLength(6)
  })

  it('preserves vehicle identity, reporting store, history and exact retries after source removal', () => {
    const { service, database } = local()
    const issue = service.createVehicleIssue(VIN, input, sales, 'durable-create').record
    for (const table of ['public_vehicle_snapshots', 'crm_vehicle_snapshots', 'hold_vehicle_snapshots', 'vehicle_resource_snapshots']) {
      database.prepare(`DELETE FROM ${table} WHERE vin = ?`).run(VIN)
    }
    expect(() => service.getVehicle(VIN, manager)).toThrowError(expect.objectContaining({ code: 'VEHICLE_NOT_FOUND' }))
    expect(service.getVehicleIssue(issue.id, manager)).toMatchObject({ vin: VIN, stockNumber: issue.stockNumber, vehicleName: issue.vehicleName, reportStore: 'Howell' })
    expect(service.listVehicleIssues({ vin: VIN }, manager).items).toHaveLength(1)
    expect(service.createVehicleIssue(VIN, input, sales, 'durable-create')).toMatchObject({ created: false, record: { id: issue.id } })
    const done = service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 1, note: 'Checked before departure' }, manager, 'durable-complete')
    expect(done.record.status).toBe('completed')
    expect(() => service.createVehicleIssue(VIN, input, sales, 'new-missing-vehicle')).toThrowError(expect.objectContaining({ code: 'VEHICLE_NOT_FOUND' }))
  })

  it('uses stable actor IDs, full payload fingerprints and expected versions for retries', () => {
    const { service } = local()
    const issue = service.createVehicleIssue(VIN, input, sales, 'actor-key').record
    expect(() => service.createVehicleIssue(VIN, { ...input, description: 'Changed report' }, sales, 'actor-key'))
      .toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }))
    const namesake = { ...sales, userId: 'another-stable-id' }
    expect(service.createVehicleIssue(VIN, input, namesake, 'actor-key').record.id).not.toBe(issue.id)
    const update = { type: 'add_note', expectedVersion: 1, note: 'First note' }
    service.appendVehicleIssueEvent(issue.id, update, sales, 'note-key')
    service.appendVehicleIssueEvent(issue.id, { type: 'assign', expectedVersion: 2, assignee: 'Detail team' }, manager, 'assign-key')
    expect(service.appendVehicleIssueEvent(issue.id, update, { ...sales, user: 'Renamed employee' }, 'note-key'))
      .toMatchObject({ created: false, record: { version: 3, assignee: 'Detail team' } })
    expect(() => service.appendVehicleIssueEvent(issue.id, { ...update, note: 'Changed note' }, sales, 'note-key'))
      .toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }))
    expect(() => service.appendVehicleIssueEvent(issue.id, { ...update, note: 'Another note' }, sales, 'another-key'))
      .toThrowError(expect.objectContaining({ code: 'ISSUE_VERSION_CONFLICT', status: 409 }))
  })

  it('enforces report-store writes while allowing active employees to read operational history', () => {
    const { service } = local()
    const issue = service.createVehicleIssue(VIN, input, sales, 'scoped').record
    for (const role of ['coordinator', 'porter', 'driver']) {
      const transport = { ...sales, role }
      const record = service.getVehicleIssue(issue.id, transport)
      expect(record.allowedActions).toEqual([])
      expect(record).not.toHaveProperty('privateEvidence')
      expect(() => service.createVehicleIssue(VIN, input, transport, `transport-${role}`)).toThrowError(expect.objectContaining({ status: 403 }))
      expect(() => service.appendVehicleIssueEvent(issue.id, { type: 'add_note', expectedVersion: 1, note: 'Not authorized' }, transport, role)).toThrowError(expect.objectContaining({ status: 403 }))
    }
    const outside = { ...manager, store: 'Lincoln' }
    expect(service.getVehicleIssue(issue.id, outside).allowedActions).toEqual([])
    expect(() => service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 1, note: 'No authority' }, outside, 'outside'))
      .toThrowError(expect.objectContaining({ status: 403 }))
    expect(() => service.createVehicleIssue(VIN, input, outside, 'outside-create')).toThrowError(expect.objectContaining({ code: 'ISSUE_STORE_FORBIDDEN' }))
    expect(service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 1, note: 'Group manager verified' }, group, 'group-complete').record.status).toBe('completed')
  })

  it('uses confirmed location only to grant visiting-store reporting, never an assignment label', () => {
    const vehicle = { homeStore: 'Howell', movement: { currentLocation: 'Lincoln', locationConfidence: 'reported' } }
    expect(canReportVehicleIssue(vehicle, { ...sales, store: 'Lincoln' })).toBe(false)
    expect(canReportVehicleIssue({ ...vehicle, movement: { ...vehicle.movement, locationConfidence: 'verified' } }, { ...sales, store: 'Lincoln' })).toBe(true)
    expect(canReportVehicleIssue(vehicle, sales)).toBe(true)
    expect(canReportVehicleIssue(vehicle, group)).toBe(true)
  })

  it('accepts bounded verified photo metadata and retains photos in immutable history', () => {
    const { service } = local()
    const issue = service.createVehicleIssue(VIN, { ...input, photos: [photo()] }, sales, 'photo-create').record
    expect(issue.photoCount).toBe(1)
    expect(issue.photos[0]).toMatchObject({ ...photo(), eventId: issue.events[0].id })
    const photoOnly = service.appendVehicleIssueEvent(issue.id, { type: 'add_note', expectedVersion: 1, photos: [photo(2)] }, sales, 'photo-only').record
    expect(photoOnly).toMatchObject({ version: 2, photoCount: 2 })
    expect(() => service.appendVehicleIssueEvent(issue.id, { type: 'add_note', expectedVersion: 2, photos: [photo()] }, sales, 'same-photo')).toThrowError(expect.objectContaining({ code: 'INVALID_ISSUE_PHOTOS' }))
    expect(() => service.createVehicleIssue(VIN, { ...input, photos: [{ ...photo(), url: 'https://example.invalid/private.jpg' }] }, sales, 'injected-photo')).toThrowError(expect.objectContaining({ code: 'INVALID_ISSUE_PHOTOS' }))
    expect(() => service.createVehicleIssue(VIN, { ...input, photos: [photo(1), photo(2), photo(3), photo(4)] }, sales, 'too-many')).toThrowError(expect.objectContaining({ code: 'INVALID_ISSUE_PHOTOS' }))
    expect(() => service.createVehicleIssue(VIN, { ...input, actor: 'Spoofed manager' }, sales, 'spoof')).toThrowError(expect.objectContaining({ code: 'INVALID_VEHICLE_ISSUE' }))
    expect(() => service.createVehicleIssue(VIN, { ...input, description: 'x'.repeat(1001) }, sales, 'oversize')).toThrowError(expect.objectContaining({ code: 'INVALID_VEHICLE_ISSUE' }))
  })

  it('caps issue photos across multiple updates and replays before the total limit check', () => {
    const { service } = local()
    const issue = service.createVehicleIssue(VIN, { ...input, photos: [photo(1), photo(2), photo(3)] }, sales, 'photo-limit-create').record
    for (let version = 1; version <= 3; version++) service.appendVehicleIssueEvent(issue.id, {
      type: 'add_note', expectedVersion: version, photos: [photo(version * 3 + 1), photo(version * 3 + 2), photo(version * 3 + 3)],
    }, sales, `photos-${version}`)
    expect(service.getVehicleIssue(issue.id, sales).photoCount).toBe(12)
    expect(service.appendVehicleIssueEvent(issue.id, { type: 'add_note', expectedVersion: 3, photos: [photo(10), photo(11), photo(12)] }, sales, 'photos-3').created).toBe(false)
    expect(() => service.appendVehicleIssueEvent(issue.id, { type: 'add_note', expectedVersion: 4, photos: [photo(13)] }, sales, 'thirteenth')).toThrowError(expect.objectContaining({ code: 'ISSUE_PHOTO_LIMIT' }))
  })

  it('keeps completed reports inspectable in filtered queues and out of the integration projection', () => {
    const { service } = local()
    const privateMarker = `${marker}-LOT-ISSUE-ONLY`
    const issue = service.createVehicleIssue(VIN, { ...input, description: privateMarker }, sales, 'projection').record
    service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 1, note: privateMarker }, manager, 'projection-complete')
    expect(service.listVehicleIssues({ status: 'completed', store: 'Howell' }, sales)).toMatchObject({ total: 1, items: [{ id: issue.id }] })
    expect(service.listVehicleIssues({ status: 'open' }, sales).total).toBe(0)
    const bootstrap = service.bootstrap(manager)
    expect(bootstrap).toMatchObject({ vehicleIssuesEnabled: true, vehicleIssues: [{ id: issue.id, status: 'completed' }] })
    expect(bootstrap.vehicles.find((row) => row.vin === VIN).canReportIssue).toBe(true)
    const integration = createIntegrationReadService({
      bootstrap, principal: { clientId: 'synthetic-issues-reader', userId: 'synthetic-reader', stores: ['Howell'], scopes: ['inventory.read'] },
      bundleSha256: 'a'.repeat(64), cursorSecret: 'synthetic-issues-cursor-secret-never-use-live', now: () => SYNTHETIC_NOW,
    })
    expect(JSON.stringify(integration.inventory({}))).not.toContain(privateMarker)
    expect(JSON.stringify(integration.inventory({}))).not.toContain('vehicleIssues')
  })

  it('prevents updating or deleting both report identity and event history in SQLite', () => {
    const { service, database } = local()
    service.createVehicleIssue(VIN, input, sales, 'immutable')
    for (const sql of ["UPDATE vehicle_issues SET description='changed'", 'DELETE FROM vehicle_issues', "UPDATE vehicle_issue_events SET note='changed'", 'DELETE FROM vehicle_issue_events']) {
      expect(() => database.exec(sql)).toThrow('append-only')
    }
  })

  it.each([
    null, [], 'not an object', 5, true,
    { ...input, description: { text: 'unexpected object' } },
    { ...input, priority: ['urgent'] },
    { ...input, category: '__proto__' },
    { ...input, reportStore: 'Lincoln' },
    { ...input, reporterUserId: 'forged' },
    { ...input, photos: [null] },
    { ...input, photos: [{ ...photo(), bytes: 500 * 1024 + 1 }] },
  ])('rejects malformed or authority-bearing creation inputs without changing history: %j', (value) => {
    const { service, database } = local()
    expect(() => service.createVehicleIssue(VIN, value, sales, 'malformed-input')).toThrowError(expect.objectContaining({ status: 422 }))
    expect(database.prepare('SELECT COUNT(*) AS n FROM vehicle_issues').get().n).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS n FROM vehicle_issue_events').get().n).toBe(0)
  })

  it('requires an authenticated stable actor except in the explicitly marked synthetic demo context', () => {
    const { service } = local()
    expect(() => service.createVehicleIssue(VIN, input, {}, 'missing-context')).toThrowError(expect.objectContaining({ code: 'AUTH_CONTEXT_INVALID', status: 401 }))
    expect(() => service.createVehicleIssue(VIN, input, { ...sales, user: '' }, 'missing-user')).toThrowError(expect.objectContaining({ code: 'AUTH_CONTEXT_INVALID', status: 401 }))
    expect(() => service.createVehicleIssue(VIN, input, { ...sales, userId: null }, 'missing-id')).toThrowError(expect.objectContaining({ code: 'AUTH_CONTEXT_INVALID', status: 401 }))
    const demo = service.createVehicleIssue(VIN, input, { ...sales, userId: null, allowLegacyTransportAssignmentByName: true }, 'demo-actor')
    expect(demo.record.reportedByUserId).toBe('demo:Howell:Synthetic Sales')
  })

  it('round-trips a D1 issue across cold repositories and rejects simultaneous updates atomically', async () => {
    const { database, cold } = await cloud()
    const first = await cold()
    const issue = first.service.createVehicleIssue(VIN, input, sales, 'd1-create').record
    await first.commit()
    const a = await cold()
    const b = await cold()
    expect(a.service.getVehicleIssue(issue.id, sales)).toEqual(issue)
    a.service.appendVehicleIssueEvent(issue.id, { type: 'assign', expectedVersion: 1, assignee: 'Detail team' }, manager, 'd1-assign')
    b.service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 1, note: 'Concurrent completion' }, manager, 'd1-complete')
    await a.commit()
    await expect(b.commit()).rejects.toBeInstanceOf(RepositoryConflictError)
    const latest = await cold()
    expect(latest.service.getVehicleIssue(issue.id, manager)).toMatchObject({ version: 2, status: 'open', assignee: 'Detail team' })
    expect(database.prepare('SELECT COUNT(*) AS n FROM vehicle_issue_events').get().n).toBe(2)
    expect(() => latest.service.appendVehicleIssueEvent(issue.id, { type: 'complete', expectedVersion: 1, note: 'Concurrent completion' }, manager, 'd1-complete')).toThrowError(expect.objectContaining({ code: 'ISSUE_VERSION_CONFLICT' }))
  })

  it.each(['enabled=0', "role='sales'", "home_store='Lincoln'"])(
    'rolls back issue and audit rows when server membership changes at commit: %s', async (change) => {
      const { database, cold } = await cloud()
      const email = 'synthetic-issues@example.invalid'
      database.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)').run(email, manager.userId, manager.user, manager.role, manager.store)
      const attempt = await cold()
      attempt.service.createVehicleIssue(VIN, input, manager, 'revoked-create')
      database.exec(`UPDATE cloud_memberships SET ${change}`)
      await expect(attempt.commit({ email, context: { ...manager, authenticatedRole: manager.role, authenticatedStore: manager.store } })).rejects.toBeInstanceOf(RepositoryConflictError)
      expect(database.prepare('SELECT COUNT(*) AS n FROM vehicle_issues').get().n).toBe(0)
      expect(database.prepare('SELECT COUNT(*) AS n FROM vehicle_issue_events').get().n).toBe(0)
    },
  )

  it('keeps inventory readable and refuses issue writes until the operator migration is applied', async () => {
    const { cold } = await cloud({ migrated: false })
    const state = await cold()
    expect(state.service.bootstrap(manager)).toMatchObject({ vehicleIssuesEnabled: false, vehicleIssues: [] })
    expect(state.service.listVehicles({}, manager).items.length).toBeGreaterThan(0)
    expect(state.service.listVehicleIssues({}, manager)).toEqual({ items: [], total: 0 })
    expect(() => state.service.createVehicleIssue(VIN, input, sales, 'migration-pending')).toThrowError(expect.objectContaining({ status: 503, code: 'MIGRATION_REQUIRED' }))
  })
})
