// @ts-nocheck -- exercises the same core through SQLite and the D1 adapter.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
//
// The app-owned disposition ledger (OVERVIEW_SPEC §6): versioned, idempotent,
// append-only, written only by the vehicle's home-store manager or a group
// manager, never inferred from a source or a move, and never hiding a vehicle.
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { createInventoryServer } from '../../server/api.mjs'
import { loadD1Repository } from '../../cloudflare/src/repository.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'
import { createCloudWorkerHarness } from './cloudWorkerHarness'
import {
  buildDispositionEvent,
  DISPOSITION_CODES,
  DISPOSITION_TRANSITIONS,
  dispositionOwnerStore,
  dispositionView,
} from '../../server/vehicle-disposition.mjs'

const databases = []
const servers = []
afterEach(async () => {
  while (servers.length) await new Promise((resolve) => servers.pop().close(resolve))
  while (databases.length) databases.pop().close()
})

const UNHELD = 'TESTDATAFWELL0002'
const HELD = 'TESTDATAHWELL0001'
const fowlervilleManager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic Fowlerville Manager', userId: 'manager-fowlerville' }
const howellManager = { role: 'manager', store: 'Howell', user: 'Synthetic Howell Manager', userId: 'manager-howell' }
const groupManager = { role: 'group_manager', store: 'Lincoln', user: 'Synthetic Group Manager', userId: 'group-manager' }
const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic Fowlerville Salesperson', userId: 'sales-fowlerville' }
const driver = { role: 'driver', store: 'Howell', user: 'Synthetic Driver', userId: 'driver-howell' }
const TODAY = '2026-08-30'

function local(release = buildSyntheticRelease()) {
  const db = openInventoryDatabase()
  databases.push(db)
  importRelease(db, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  return { db, service: createInventoryService({ database: db, now: () => SYNTHETIC_NOW }) }
}

function count(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM vehicle_disposition_events').get().n
}

// The pure builder, over a fabricated source and ledger rows.
const context = (overrides) => ({ canViewPrivateEvidence: true, authenticatedRole: overrides.role, ...overrides })
const source = { vin: UNHELD, publicRecord: { store: 'Fowlerville' }, holdRecord: null }
let keys = 0
function build(rows, input, who = context(fowlervilleManager), extra = {}) {
  return buildDispositionEvent(extra.source ?? source, rows, input, who, { now: SYNTHETIC_NOW, today: TODAY, idempotencyKey: extra.key ?? `synthetic-key-${++keys}` })
}
function rowFor(code, version) {
  const { row } = build([], { disposition: 'keep', expectedVersion: 0 })
  return { ...row, disposition: code, version, idempotency_key: `row-${code}-${version}` }
}
const validInput = (code, extra = {}) => ({
  disposition: code, expectedVersion: 1,
  ...(['delivered', 'wholesale'].includes(code) ? { effectiveDate: '2026-08-29' } : {}),
  ...(code === 'transfer_out' ? { destinationStore: 'Howell' } : {}),
  ...extra,
})

describe('disposition ledger rules', () => {
  it('allows exactly the documented transitions from every state and refuses the rest', () => {
    for (const from of DISPOSITION_CODES) {
      for (const to of DISPOSITION_CODES) {
        const attempt = () => build([rowFor(from, 1)], validInput(to, ['delivered', 'wholesale'].includes(from) ? { note: 'Correction after review' } : {}))
        if (DISPOSITION_TRANSITIONS[from].includes(to)) expect(attempt().created, `${from} → ${to}`).toBe(true)
        else expect(attempt, `${from} → ${to}`).toThrow(expect.objectContaining({ code: 'INVALID_DISPOSITION_TRANSITION', details: { from, to, allowed: [...DISPOSITION_TRANSITIONS[from]] } }))
      }
    }
    for (const to of DISPOSITION_CODES) expect(build([], { ...validInput(to), expectedVersion: 0 }).created, `none → ${to}`).toBe(true)
    // A collapsed deal re-dispositions directly.
    expect(build([rowFor('sold_pending', 1)], validInput('wholesale')).row).toMatchObject({ disposition: 'wholesale', version: 2 })
    expect(build([rowFor('sold_pending', 1)], validInput('transfer_out')).row).toMatchObject({ disposition: 'transfer_out', destination_store: 'Howell' })
  })

  it('requires a note to correct a delivered or wholesale unit back to Keep', () => {
    for (const from of ['delivered', 'wholesale']) {
      expect(() => build([rowFor(from, 1)], validInput('keep'))).toThrow(expect.objectContaining({ code: 'INVALID_DISPOSITION_NOTE' }))
      expect(() => build([rowFor(from, 1)], validInput('keep', { note: 'ok' }))).toThrow(expect.objectContaining({ code: 'INVALID_DISPOSITION_NOTE' }))
      expect(build([rowFor(from, 1)], validInput('keep', { note: 'Unit came back on the unwind' })).row.note).toBe('Unit came back on the unwind')
    }
  })

  it('validates dates, destination stores, notes and input keys before writing', () => {
    const cases = [
      [{ disposition: 'delivered', expectedVersion: 0 }, 'INVALID_DISPOSITION_DATE'],
      [{ disposition: 'wholesale', expectedVersion: 0 }, 'INVALID_DISPOSITION_DATE'],
      [{ disposition: 'keep', effectiveDate: '2026-08-31', expectedVersion: 0 }, 'INVALID_DISPOSITION_DATE'],
      [{ disposition: 'keep', effectiveDate: '2026-02-30', expectedVersion: 0 }, 'INVALID_DISPOSITION_DATE'],
      [{ disposition: 'keep', effectiveDate: '08/29/2026', expectedVersion: 0 }, 'INVALID_DISPOSITION_DATE'],
      [{ disposition: 'transfer_out', expectedVersion: 0 }, 'DESTINATION_STORE_REQUIRED'],
      [{ disposition: 'transfer_out', destinationStore: 'Fowlerville', expectedVersion: 0 }, 'INVALID_DESTINATION_STORE'],
      [{ disposition: 'transfer_out', destinationStore: 'Nowhere', expectedVersion: 0 }, 'INVALID_DESTINATION_STORE'],
      [{ disposition: 'keep', destinationStore: 'Howell', expectedVersion: 0 }, 'INVALID_DESTINATION_STORE'],
      [{ disposition: 'keep', note: 'x'.repeat(501), expectedVersion: 0 }, 'INVALID_DISPOSITION_NOTE'],
      [{ disposition: 'keep', note: 'bell\u0007', expectedVersion: 0 }, 'INVALID_DISPOSITION_NOTE'],
      [{ disposition: 'sold', expectedVersion: 0 }, 'INVALID_DISPOSITION'],
      [{ disposition: 'keep' }, 'DISPOSITION_VERSION_REQUIRED'],
      [{ disposition: 'keep', expectedVersion: -1 }, 'DISPOSITION_VERSION_REQUIRED'],
      [{ disposition: 'keep', expectedVersion: 0, actor: 'Spoofed' }, 'INVALID_DISPOSITION_INPUT'],
      [{ disposition: 'keep', expectedVersion: 0, actorRole: 'group_manager' }, 'INVALID_DISPOSITION_INPUT'],
      [{ disposition: 'keep', expectedVersion: 0, store: 'Lincoln' }, 'INVALID_DISPOSITION_INPUT'],
      [['keep'], 'INVALID_DISPOSITION_INPUT'],
    ]
    for (const [input, code] of cases) expect(() => build([], input), JSON.stringify(input)).toThrow(expect.objectContaining({ status: 422, code }))
    expect(() => build([], { disposition: 'keep', expectedVersion: 0 }, context(fowlervilleManager), { key: '' })).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }))
    expect(build([], { disposition: 'keep', effectiveDate: TODAY, note: '  trimmed  ', expectedVersion: 0 }).row).toMatchObject({ effective_date: TODAY, note: 'trimmed' })
  })

  it('refuses a note that repeats a name or reason from the DealerMail hold, active, deleted or released', () => {
    const held = {
      vin: HELD, publicRecord: { store: 'Fowlerville' },
      holdRecord: { holdDetailRows: [
        { lifecycleStatus: 'active', customerOrReasonRaw: 'Customer Okonkwo — deposit', salespersonRaw: 'Priya Raman' },
        { lifecycleStatus: 'deleted_history', customerOrReasonRaw: 'Lindqvist trade', salespersonRaw: 'Bo Tan' },
      ] },
      releasedHistoryRecord: { holdDetailRows: [{ customerOrReasonRaw: 'Abernathy', salespersonRaw: 'Tomas' }] },
    }
    for (const note of ['Waiting on okonkwo', 'Priya confirmed', 'LINDQVIST approved', 'Call Abernathy', 'tomas to deliver', 'Raman-approved']) {
      expect(() => build([], { disposition: 'sold_pending', note, expectedVersion: 0 }, context(fowlervilleManager), { source: held }), note)
        .toThrow(expect.objectContaining({ status: 422, code: 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE' }))
    }
    // Operational words shared with a hold reason are not names.
    expect(build([], { disposition: 'sold_pending', note: 'Deposit taken; delivery Friday', expectedVersion: 0 }, context(fowlervilleManager), { source: held }).created).toBe(true)
    // Tokens under four characters never match (the spec's floor; a known limit for short names).
    expect(build([], { disposition: 'sold_pending', note: 'Bo Tan will call', expectedVersion: 0 }, context(fowlervilleManager), { source: held }).created).toBe(true)
  })

  it('never exempts a name: day names in the customer text and every salesperson token are evidence', () => {
    const hold = (customerOrReasonRaw, salespersonRaw) => ({
      vin: HELD, publicRecord: { store: 'Fowlerville' },
      holdRecord: { holdDetailRows: [{ lifecycleStatus: 'active', customerOrReasonRaw, salespersonRaw }] },
    })
    const attempt = (source, note) => () => build([], { disposition: 'sold_pending', note, expectedVersion: 0 }, context(fowlervilleManager), { source })
    const refused = expect.objectContaining({ status: 422, code: 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE' })
    // A customer named "Friday Sale": the day name is not exempt.
    expect(attempt(hold('Friday Sale', 'Priya Raman'), 'Delivery Friday')).toThrow(refused)
    // A salesperson field is always a name: nothing in it is exempt, not even "Will" or "Deal".
    expect(attempt(hold('Deposit', 'Will Deal'), 'Will confirm Monday')).toThrow(refused)
    expect(attempt(hold('Deposit', 'Will Deal'), 'Deal closed')).toThrow(refused)
    // The allowlist applies only to the customer/reason text, never to the note.
    expect(build([], { disposition: 'sold_pending', note: 'Deposit taken; delivery this week', expectedVersion: 0 }, context(fowlervilleManager), { source: hold('Smith — deposit, delivery this week', 'Priya Raman') }).created).toBe(true)
    expect(attempt(hold('Smith — deposit', 'Priya Raman'), 'SMITH deposit taken')).toThrow(refused)
  })

  it('answers a retry from the ledger before re-judging the note, even after the hold changed', () => {
    const input = { disposition: 'sold_pending', note: 'Call Okafor tomorrow', expectedVersion: 0 }
    const first = build([], input, context(fowlervilleManager), { key: 'synthetic-retry' })
    expect(first.created).toBe(true)
    // A later release adds a hold naming the same person the note mentions.
    const heldNow = { ...source, holdRecord: { holdDetailRows: [{ lifecycleStatus: 'active', customerOrReasonRaw: 'Okafor', salespersonRaw: 'Priya Raman' }] } }
    expect(build([first.row], input, context(fowlervilleManager), { source: heldNow, key: 'synthetic-retry' })).toEqual({ row: first.row, created: false })
    // A new request with the same note is refused.
    expect(() => build([first.row], { ...input, disposition: 'delivered', effectiveDate: '2026-08-30', expectedVersion: 1 }, context(fowlervilleManager), { source: heldNow, key: 'synthetic-new' }))
      .toThrow(expect.objectContaining({ code: 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE' }))
    // The replay also survives a later calendar day.
    expect(buildDispositionEvent(source, [first.row], input, context(fowlervilleManager), { now: SYNTHETIC_NOW, today: '2027-01-01', idempotencyKey: 'synthetic-retry' }).created).toBe(false)
  })

  it('takes identity only from the server context and audits the signed-in role', () => {
    const previewing = { ...groupManager, role: 'manager', store: 'Fowlerville', authenticatedRole: 'group_manager', canViewPrivateEvidence: true }
    const { row } = build([], { disposition: 'keep', expectedVersion: 0 }, previewing)
    expect(row).toMatchObject({ actor: groupManager.user, actor_user_id: groupManager.userId, actor_role: 'group_manager', store_id: 'Fowlerville' })
  })

  it('derives the owner store from the home assignment or the source store, never from the caller', () => {
    expect(dispositionOwnerStore({ publicRecord: { store: 'Howell' } })).toBe('Howell')
    expect(dispositionOwnerStore({ crmRecord: { storeName: 'Lincoln' } })).toBe('Lincoln')
    expect(dispositionOwnerStore({ homeAssignment: { home_store_id: 'Ford Detroit' }, publicRecord: { store: 'Howell' } })).toBe('Ford Detroit')
    expect(dispositionOwnerStore({ publicRecord: { store: 'Elsewhere' } })).toBeNull()
    const assigned = { vin: UNHELD, homeAssignment: { home_store_id: 'Howell' }, publicRecord: { store: 'Fowlerville' } }
    for (const who of [fowlervilleManager, howellManager, driver, groupManager]) {
      expect(dispositionView(assigned, null, context(who)).ownerStore).toBe('Howell')
    }
    expect(dispositionView(assigned, null, context(howellManager)).canManage).toBe(true)
    expect(dispositionView(assigned, null, context(fowlervilleManager)).canManage).toBe(false)
    expect(dispositionView(assigned, null, context(howellManager), { enabled: false }).canManage).toBe(false)
  })
})

describe('disposition ledger through the service', () => {
  it('creates, replays, rejects a reused key with a different request, and detects a stale version', () => {
    const { db, service } = local()
    const input = { disposition: 'sold_pending', effectiveDate: '2026-08-29', note: 'Deposit taken', expectedVersion: 0 }
    const created = service.updateDisposition(UNHELD, input, fowlervilleManager, 'synthetic-create')
    expect(created.created).toBe(true)
    expect(created.record).toMatchObject({
      vin: UNHELD, code: 'sold_pending', version: 1, effectiveDate: '2026-08-29', ownerStore: 'Fowlerville', canManage: true,
      updatedBy: fowlervilleManager.user, updatedByRole: 'manager', store: 'Fowlerville', note: 'Deposit taken',
    })
    expect(created.record.history).toHaveLength(1)
    expect(service.updateDisposition(UNHELD, input, fowlervilleManager, 'synthetic-create')).toMatchObject({ created: false, record: { version: 1 } })
    expect(() => service.updateDisposition(UNHELD, { ...input, note: 'Different' }, fowlervilleManager, 'synthetic-create'))
      .toThrow(expect.objectContaining({ status: 409, code: 'IDEMPOTENCY_CONFLICT' }))
    expect(() => service.updateDisposition(UNHELD, { disposition: 'keep', expectedVersion: 0 }, groupManager, 'synthetic-stale'))
      .toThrow(expect.objectContaining({ status: 409, code: 'DISPOSITION_VERSION_CONFLICT' }))
    expect(count(db)).toBe(1)
    const delivered = service.updateDisposition(UNHELD, { disposition: 'delivered', effectiveDate: '2026-08-30', expectedVersion: 1 }, groupManager, 'synthetic-delivered')
    expect(delivered.record).toMatchObject({ code: 'delivered', version: 2, updatedByRole: 'group_manager', store: 'Lincoln' })
    expect(delivered.record.history.map((entry) => entry.code)).toEqual(['delivered', 'sold_pending'])
  })

  it('refuses a request key reused by a different actor, even with the same body', () => {
    const { db, service } = local()
    const input = { disposition: 'keep', expectedVersion: 0 }
    expect(service.updateDisposition(UNHELD, input, fowlervilleManager, 'synthetic-shared-key').created).toBe(true)
    expect(() => service.updateDisposition(UNHELD, input, groupManager, 'synthetic-shared-key'))
      .toThrow(expect.objectContaining({ status: 409, code: 'IDEMPOTENCY_CONFLICT' }))
    expect(count(db)).toBe(1)
  })

  it('lets the owner store manager and group managers write; other stores, sales and transport roles cannot', () => {
    const { db, service } = local()
    for (const who of [howellManager, sales, driver]) {
      expect(() => service.updateDisposition(UNHELD, { disposition: 'keep', expectedVersion: 0 }, who, `synthetic-denied-${who.role}`), who.role)
        .toThrow(expect.objectContaining({ status: 403, code: 'DISPOSITION_MANAGER_REQUIRED' }))
    }
    expect(count(db)).toBe(0)
    expect(service.updateDisposition('TESTDATADETRT0002', { disposition: 'wholesale', effectiveDate: '2026-08-28', expectedVersion: 0 }, groupManager, 'synthetic-group').created).toBe(true)
    expect(service.updateDisposition('TESTDATAHWELL0002', { disposition: 'keep', expectedVersion: 0 }, howellManager, 'synthetic-howell').created).toBe(true)
    expect(() => service.updateDisposition('1FTFW1E50NFA00009', { disposition: 'keep', expectedVersion: 0 }, groupManager, 'synthetic-missing'))
      .toThrow(expect.objectContaining({ status: 404, code: 'VEHICLE_NOT_FOUND' }))
  })

  it('refuses a note repeating the synthetic hold evidence on the held vehicle', () => {
    const { db, service } = local()
    expect(() => service.updateDisposition(HELD, { disposition: 'sold_pending', note: 'Demo Salesperson has the deposit', expectedVersion: 0 }, howellManager, 'synthetic-guard'))
      .toThrow(expect.objectContaining({ status: 422, code: 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE' }))
    expect(count(db)).toBe(0)
    expect(service.updateDisposition(HELD, { disposition: 'sold_pending', note: 'Deposit taken; delivery Friday', expectedVersion: 0 }, howellManager, 'synthetic-guard-ok').created).toBe(true)
  })

  it('keeps the owner store identical for every viewer and gates the note and writer on private-evidence roles', () => {
    const { service } = local()
    service.updateDisposition(UNHELD, { disposition: 'sold_pending', note: 'Deposit taken', expectedVersion: 0 }, fowlervilleManager, 'synthetic-view')
    for (const who of [fowlervilleManager, driver, groupManager, sales]) {
      expect(service.getVehicle(UNHELD, who).appDisposition.ownerStore, who.role).toBe('Fowlerville')
      // List and vehicle views never carry the note or the writer.
      expect(service.getVehicle(UNHELD, who).appDisposition).not.toHaveProperty('note')
      expect(service.getVehicle(UNHELD, who).appDisposition).not.toHaveProperty('updatedBy')
    }
    expect(service.getDisposition(UNHELD, sales)).toMatchObject({ code: 'sold_pending', note: 'Deposit taken', updatedBy: fowlervilleManager.user, canManage: false })
    expect(service.getDisposition(UNHELD, sales).history).toHaveLength(1)
    const transport = service.getDisposition(UNHELD, driver)
    expect(transport).toMatchObject({ code: 'sold_pending', version: 1, history: [] })
    expect(transport).not.toHaveProperty('note')
    expect(transport).not.toHaveProperty('updatedBy')
  })

  it('is append-only: the triggers abort every update and delete', () => {
    const { db, service } = local()
    service.updateDisposition(UNHELD, { disposition: 'keep', expectedVersion: 0 }, fowlervilleManager, 'synthetic-append')
    for (const sql of ["UPDATE vehicle_disposition_events SET note='changed'", 'DELETE FROM vehicle_disposition_events']) {
      expect(() => db.exec(sql), sql).toThrow(/append-only/)
    }
    const cloudDb = new DatabaseSync(':memory:')
    databases.push(cloudDb)
    applySyntheticSchema(cloudDb)
    cloudDb.prepare("INSERT INTO vehicle_disposition_events (id,vin,version,disposition,updated_at,actor,actor_role,store_id,input_hash,idempotency_key) VALUES ('d1',?,1,'keep','2026-08-30T00:00:00Z','A','manager','Howell','h','k')").run(UNHELD)
    for (const sql of ["UPDATE vehicle_disposition_events SET note='changed'", 'DELETE FROM vehicle_disposition_events']) {
      expect(() => cloudDb.exec(sql), `D1 ${sql}`).toThrow(/append-only/)
    }
  })

  it('lists the event in the Control center audit with actor, role and store, never the note', () => {
    const { service } = local()
    service.updateDisposition(UNHELD, { disposition: 'sold_pending', note: 'SYNTHETIC-PRIVATE-NOTE', expectedVersion: 0 }, fowlervilleManager, 'synthetic-audit')
    const audit = service.adminOverview(groupManager, []).audit.filter((entry) => entry.id.startsWith('disposition:'))
    expect(audit).toEqual([expect.objectContaining({ actor: fowlervilleManager.user, activity: 'Disposition: sold pending', scope: `VIN ${UNHELD} · Fowlerville`, result: 'recorded' })])
    expect(JSON.stringify(service.adminOverview(groupManager, []))).not.toContain('SYNTHETIC-PRIVATE-NOTE')
  })

  it('is never inferred: a release that drops the vehicle leaves the ledger alone, and move events never write it', () => {
    const { db, service } = local()
    service.updateDisposition(UNHELD, { disposition: 'sold_pending', expectedVersion: 0 }, fowlervilleManager, 'synthetic-before-drop')
    // A newer release (new source-run hashes) that no longer carries the vehicle.
    const release = buildSyntheticRelease()
    release.sourceRuns = {
      ...release.sourceRuns,
      public: { ...release.sourceRuns.public, sha256: 'd'.repeat(64) },
      dealerMail: { ...release.sourceRuns.dealerMail, sha256: 'e'.repeat(64) },
    }
    release.vehicles = release.vehicles.filter((vehicle) => vehicle.vin !== UNHELD)
    importRelease(db, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
    const after = createInventoryService({ database: db, now: () => SYNTHETIC_NOW })
    expect(after.bootstrap(groupManager).vehicles.map((vehicle) => vehicle.vin)).not.toContain(UNHELD)
    expect(db.prepare('SELECT vin, version, disposition FROM vehicle_disposition_events').all()).toEqual([{ vin: UNHELD, version: 1, disposition: 'sold_pending' }])

    const moved = local()
    const move = moved.service.createTransfer({
      vin: 'TESTDATAFWELL0001', intent: 'direct', requestingStore: 'Fowlerville', destinationStore: 'Ford Detroit', requestedBy: fowlervilleManager.user,
      movedAt: new Date(SYNTHETIC_NOW.getTime() - 86_400_000).toISOString(), returnRequired: false, reason: 'Synthetic move', priority: 'normal',
    }, fowlervilleManager, 'synthetic-inference-move').record
    const detroitManager = { role: 'manager', store: 'Ford Detroit', user: 'Synthetic Detroit Manager', userId: 'manager-detroit' }
    moved.service.appendTransferEvent(move.id, { type: 'sale_confirmed' }, detroitManager, 'synthetic-inference-sale')
    moved.service.appendTransferEvent(move.id, { type: 'delivery_confirmed' }, detroitManager, 'synthetic-inference-delivery')
    expect(count(moved.db)).toBe(0)
    expect(moved.service.getVehicle('TESTDATAFWELL0001', groupManager).appDisposition).toMatchObject({ code: null, version: 0 })
  })

  it('never hides a vehicle recorded delivered: only the sources remove it', () => {
    const { service } = local()
    service.updateDisposition(UNHELD, { disposition: 'delivered', effectiveDate: '2026-08-30', expectedVersion: 0 }, fowlervilleManager, 'synthetic-delivered-visible')
    expect(service.bootstrap(groupManager).vehicles.map((vehicle) => vehicle.vin)).toContain(UNHELD)
    expect(service.listVehicles({ limit: 100 }, groupManager).items.map((vehicle) => vehicle.vin)).toContain(UNHELD)
    expect(service.getVehicle(UNHELD, sales).appDisposition).toMatchObject({ code: 'delivered' })
  })
})

describe('disposition ledger on D1 and over HTTP', () => {
  it('commits through the D1 adapter and reads back on a cold request', async () => {
    const db = new DatabaseSync(':memory:')
    databases.push(db)
    applySyntheticSchema(db)
    const d1 = sqliteD1(db)
    const cold = async () => {
      const repo = await loadD1Repository(d1, buildSyntheticRelease())
      return { ...repo, service: createInventoryServiceCore({ database: repo.database, repository: repo.repository, now: () => SYNTHETIC_NOW }) }
    }
    const first = await cold()
    expect(first.service.updateDisposition(UNHELD, { disposition: 'keep', expectedVersion: 0 }, fowlervilleManager, 'synthetic-d1').created).toBe(true)
    expect(count(db)).toBe(0)
    expect(await first.commit()).toMatchObject({ committed: true })
    const second = await cold()
    expect(second.service.getDisposition(UNHELD, fowlervilleManager)).toMatchObject({ code: 'keep', version: 1, updatedBy: fowlervilleManager.user })
    expect(second.service.updateDisposition(UNHELD, { disposition: 'keep', expectedVersion: 0 }, fowlervilleManager, 'synthetic-d1').created).toBe(false)
    expect(await second.commit()).toMatchObject({ committed: false })
    expect(db.prepare('SELECT actor, actor_role, store_id FROM vehicle_disposition_events').all()).toEqual([{ actor: fowlervilleManager.user, actor_role: 'manager', store_id: 'Fowlerville' }])
  })

  it('serves GET and POST on the Node API with 201 on create and 200 on replay', async () => {
    const { service } = local()
    const server = createInventoryServer({ service })
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/vehicles/${UNHELD}/disposition`
    const headers = { 'content-type': 'application/json', 'x-inventory-role': 'manager', 'x-inventory-store': 'Fowlerville', 'x-inventory-user': fowlervilleManager.user, 'idempotency-key': 'synthetic-http' }
    const body = JSON.stringify({ disposition: 'sold_pending', effectiveDate: '2026-08-29', expectedVersion: 0 })
    const created = await fetch(base, { method: 'POST', headers, body })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ code: 'sold_pending', version: 1 })
    const replay = await fetch(base, { method: 'POST', headers, body })
    expect(replay.status).toBe(200)
    const read = await fetch(base, { headers })
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ code: 'sold_pending', history: [expect.objectContaining({ code: 'sold_pending' })] })
    const denied = await fetch(base, { method: 'POST', headers: { ...headers, 'x-inventory-role': 'sales', 'idempotency-key': 'synthetic-http-sales' }, body })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'DISPOSITION_MANAGER_REQUIRED' })
  })

  it('guards the Worker route: same origin and an idempotency key for writes, reads for every employee, nothing else', async () => {
    const members = [
      { email: 'fowlerville-manager@example.invalid', userId: 'manager-fowlerville', name: 'Synthetic Fowlerville Manager', role: 'manager', store: 'Fowlerville' },
      { email: 'fowlerville-sales@example.invalid', userId: 'sales-fowlerville', name: 'Synthetic Fowlerville Salesperson', role: 'sales', store: 'Fowlerville' },
      { email: 'group-manager@example.invalid', userId: 'group-manager', name: 'Synthetic Group Manager', role: 'group_manager', store: 'Lincoln' },
    ]
    const cloud = await createCloudWorkerHarness(members)
    try {
      const path = `/api/vehicles/${UNHELD}/disposition`
      const body = { disposition: 'keep', expectedVersion: 0 }
      expect(await cloud.call('POST', path, members[0].email, body, { origin: 'https://elsewhere.invalid' })).toMatchObject({ status: 403, json: { code: 'SAME_ORIGIN_REQUIRED' } })
      expect(await cloud.call('POST', path, members[0].email, body, { 'idempotency-key': '' })).toMatchObject({ status: 400, json: { code: 'IDEMPOTENCY_KEY_REQUIRED' } })
      expect(cloud.count('vehicle_disposition_events')).toBe(0)
      expect((await cloud.call('POST', path, members[0].email, body)).status).toBe(201)
      expect((await cloud.call('POST', `/api/v1/vehicles/${UNHELD}/disposition`, members[1].email, body)).status).toBe(403)
      const read = await cloud.call('GET', path, members[1].email)
      expect(read).toMatchObject({ status: 200, json: { code: 'keep', version: 1, canManage: false, updatedBy: members[0].name } })
      expect((await cloud.call('GET', `${path}/history`, members[1].email)).status).toBe(404)
      // A group manager previewing as sales is sales for this write.
      const preview = { 'x-inventory-preview-role': 'sales', 'x-inventory-preview-store': 'Fowlerville' }
      expect(await cloud.call('POST', path, members[2].email, { disposition: 'sold_pending', expectedVersion: 1 }, preview))
        .toMatchObject({ status: 403, json: { code: 'DISPOSITION_MANAGER_REQUIRED' } })
      expect(cloud.count('vehicle_disposition_events')).toBe(1)
      expect((await cloud.call('POST', path, members[2].email, { disposition: 'sold_pending', expectedVersion: 1 })).status).toBe(201)
    } finally {
      cloud.close()
    }
  })
})
