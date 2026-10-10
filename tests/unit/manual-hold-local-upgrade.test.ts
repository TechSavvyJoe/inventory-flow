// @ts-nocheck
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it } from 'vitest'
import { constants, DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { importRelease, manualHoldApprovalsEnabled, migrate, openInventoryDatabase } from '../../server/database.mjs'
import { buildManualHoldEvent } from '../../server/manual-holds.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'

const VIN = 'TESTDATAHWELL0002'
const source = { vin: VIN, publicRecord: { store: 'Howell' } }
const manager = { role: 'manager', store: 'Howell', user: 'Synthetic manager', userId: 'synthetic-manager', canViewPrivateEvidence: true }
const sales = { ...manager, role: 'sales', user: 'Synthetic sales', userId: 'synthetic-sales' }
const options = { now: SYNTHETIC_NOW, idempotencyKey: 'legacy-active' }
const databases = []
const directories = []
afterEach(() => {
  while (databases.length) databases.pop().close()
  while (directories.length) rmSync(directories.pop(), { recursive: true, force: true })
})

function legacyDatabase(databasePath = ':memory:') {
  const database = new DatabaseSync(databasePath)
  databases.push(database)
  for (const name of ['0013_vehicle_dispositions.sql', '0015_manual_inventory_controls.sql']) {
    database.exec(readFileSync(new URL(`../../cloudflare/migrations/${name}`, import.meta.url), 'utf8'))
  }
  const active = buildManualHoldEvent(source, [], { state: 'active', customerLabel: 'AB', expectedVersion: 0 }, manager, options).row
  const released = buildManualHoldEvent(source, [active], { state: 'released', note: 'Synthetic legacy release', expectedVersion: 1 }, manager, { ...options, idempotencyKey: 'legacy-release' }).row
  const legacySales = { ...active, id: 'synthetic-legacy-sales-event', vin: 'TESTDATAHWELL0001', actor: sales.user,
    actor_user_id: sales.userId, actor_role: sales.role, owner_user_id: sales.userId }
  for (const row of [active, released, legacySales]) insert(database, row)
  return database
}

function insert(database, row) {
  const columns = Object.keys(row)
  database.prepare(`INSERT INTO vehicle_manual_hold_events (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(key => row[key]))
}

const rows = database => database.prepare('SELECT * FROM vehicle_manual_hold_events ORDER BY vin, version').all()
const schema = database => database.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'vehicle_manual_hold_events' ORDER BY type, name").all()

describe('local manual hold approval upgrade', () => {
  it('upgrades a persisted legacy ledger on open, preserves every event and guard, and is idempotent on reopen', () => {
    const runtimeDir = mkdtempSync(path.join(tmpdir(), 'synthetic-manual-hold-upgrade-'))
    directories.push(runtimeDir)
    const databasePath = path.join(runtimeDir, 'synthetic.sqlite')
    const legacy = legacyDatabase(databasePath)
    const before = rows(legacy)
    expect(manualHoldApprovalsEnabled(legacy)).toBe(false)
    databases.pop().close()

    const database = openInventoryDatabase({ databasePath, runtimeDir })
    databases.push(database)
    expect(manualHoldApprovalsEnabled(database)).toBe(true)
    expect(rows(database)).toEqual(before)
    expect(database.prepare("PRAGMA index_info('vehicle_manual_hold_events_vin_idx')").all().map(row => row.name)).toEqual(['vin', 'version'])
    expect(() => database.exec('DELETE FROM vehicle_manual_hold_events')).toThrow('append-only')
    expect(() => database.exec("UPDATE vehicle_manual_hold_events SET actor_user_id = 'forged'")).toThrow('append-only')
    const event = before[0]
    expect(() => insert(database, { ...event, id: 'duplicate-version', idempotency_key: 'different-key' })).toThrow('UNIQUE')
    expect(() => insert(database, { ...event, id: 'duplicate-key', version: 99 })).toThrow('UNIQUE')
    expect(() => insert(database, { ...event, vin: 'TESTDATAHWELL0003', idempotency_key: 'different-vin' })).toThrow('UNIQUE')
    const upgradedSchema = schema(database)
    migrate(database)
    expect(schema(database)).toEqual(upgradedSchema)
    expect(rows(database)).toEqual(before)

    importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
    const service = createInventoryService({ database, now: () => SYNTHETIC_NOW })
    expect(service.getManualHold(VIN, sales)).toMatchObject({ state: 'released', version: 2, approvalEnabled: true })
    const request = { state: 'requested', note: 'Synthetic appointment', expectedVersion: 2 }
    expect(service.updateManualHold(VIN, request, sales, 'new-request').record).toMatchObject({ state: 'requested', version: 3, ownedByCurrentUser: true })
    expect(service.updateManualHold(VIN, request, sales, 'new-request').created).toBe(false)
    expect(service.updateManualHold(VIN, { state: 'active', expectedVersion: 3 }, manager, 'approve-request').record).toMatchObject({ state: 'active', version: 4, ownedByCurrentUser: false })
    expect(rows(database).filter(row => row.vin === VIN && row.version <= 2)).toEqual(before.filter(row => row.vin === VIN))
    const after = rows(database)
    databases.pop().close()
    const reopened = openInventoryDatabase({ databasePath, runtimeDir })
    databases.push(reopened)
    expect(rows(reopened)).toEqual(after)
    expect(schema(reopened)).toEqual(upgradedSchema)
  })

  it('rolls back the full rebuild if SQLite refuses the rename after dropping the legacy table', () => {
    const database = legacyDatabase()
    const beforeRows = rows(database)
    const beforeSchema = schema(database)
    let droppedLegacyTable = false
    let deniedRename = false
    database.setAuthorizer((action, first, second) => {
      if (action === constants.SQLITE_DROP_TABLE && first === 'vehicle_manual_hold_events') droppedLegacyTable = true
      if (action === constants.SQLITE_ALTER_TABLE && second === 'vehicle_manual_hold_events_next') {
        deniedRename = true
        return constants.SQLITE_DENY
      }
      return constants.SQLITE_OK
    })
    expect(() => migrate(database)).toThrow('not authorized')
    database.setAuthorizer(null)
    expect(droppedLegacyTable).toBe(true)
    expect(deniedRename).toBe(true)
    expect(rows(database)).toEqual(beforeRows)
    expect(schema(database)).toEqual(beforeSchema)
    expect(manualHoldApprovalsEnabled(database)).toBe(false)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'vehicle_manual_hold_events_next'").get()).toBeUndefined()
    expect(() => database.exec('DELETE FROM vehicle_manual_hold_events')).toThrow('append-only')
    migrate(database)
    expect(manualHoldApprovalsEnabled(database)).toBe(true)
    expect(rows(database)).toEqual(beforeRows)
  })
})
