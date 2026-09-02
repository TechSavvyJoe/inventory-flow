// @ts-nocheck -- synthetic Node SQLite mirrors D1 transaction and parameter semantics.
// @vitest-environment node
import { createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { LEDGER_COLUMNS, LEDGER_FORMAT, LEDGER_TABLE_NAMES, importLedger, validateLedgerBundle } from '../../cloudflare/src/ledger-import.mjs'
import { encryptLedgerBundle, exportCloudLedger, ledgerEncryptionKey, readLedgerFromSQLite } from '../../scripts/export-cloud-ledger.mjs'

const resources = []
afterEach(() => {
  while (resources.length) resources.pop()()
})

function sourceHarness() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'inventory-synthetic-ledger-'))
  resources.push(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'synthetic.sqlite')
  const database = openInventoryDatabase({ databasePath, runtimeDir: directory })
  const release = buildSyntheticRelease()
  importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  const service = createInventoryService({ database, now: () => new Date(SYNTHETIC_NOW) })
  const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic Salesperson' }
  const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic Manager' }
  const transfer = service.createTransfer({
    vin: 'TESTDATAHWELL0002', requestingStore: 'Fowlerville', reason: 'Synthetic saved activity for migration',
    neededBy: '2026-08-31T14:00:00-04:00',
  }, sales, 'synthetic-migration-request')
  service.appendTransferEvent(transfer.record.id, { type: 'manager_reviewed', note: "Synthetic note: 'quoted' <text> remains exact" }, manager, 'synthetic-migration-review')
  const attention = service.listAttention({}, manager).items.find((item) => item.allowedActions?.includes('acknowledge'))
  service.appendAttentionEvent(attention.id, { type: 'acknowledge', note: 'Synthetic attention migration' }, manager, 'synthetic-migration-attention')
  for (const [id, end] of [['synthetic-home-old', '2026-08-29T12:00:00Z'], ['synthetic-home-current', null]]) {
    database.prepare('INSERT INTO home_assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, 'TESTDATAHWELL0002', 'Howell', '2026-08-28T12:00:00Z', end,
      'synthetic_explicit_confirmation', 'Synthetic Manager', 'Synthetic home history', SYNTHETIC_NOW.toISOString(),
    )
  }
  database.close()
  return { directory, databasePath, bundle: readLedgerFromSQLite({ databasePath }) }
}

function d1Harness() {
  const database = new DatabaseSync(':memory:')
  resources.push(() => database.close())
  database.exec(readFileSync(new URL('../../cloudflare/migrations/0001_initial.sql', import.meta.url), 'utf8'))
  database.exec(readFileSync(new URL('../../cloudflare/migrations/0002_app_access.sql', import.meta.url), 'utf8'))
  const d1 = {
    database,
    failTable: null,
    beforeWrite: null,
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this } }
    },
    async batch(statements) {
      const isWrite = statements.some(({ sql }) => sql.startsWith('UPDATE cloud_app_revision'))
      if (isWrite && d1.beforeWrite) { const callback = d1.beforeWrite; d1.beforeWrite = null; callback() }
      database.exec('BEGIN')
      try {
        const results = statements.map(({ sql, values }) => {
          if (d1.failTable && sql.startsWith(`INSERT INTO ${d1.failTable} `)) throw new Error('Synthetic transaction failure')
          const prepared = database.prepare(sql)
          if (sql.startsWith('SELECT')) return { success: true, results: prepared.all(...values) }
          prepared.run(...values)
          return { success: true, results: [] }
        })
        database.exec('COMMIT')
        return results
      } catch (error) { database.exec('ROLLBACK'); throw error }
    },
  }
  return d1
}

function destinationCounts(d1) {
  return Object.fromEntries(LEDGER_TABLE_NAMES.map((table) => [table, d1.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]))
}

describe('initial encrypted saved-activity migration', () => {
  it('reads the source read-only and exports only all five app-owned tables with exact audit values', () => {
    const { databasePath, bundle } = sourceHarness()
    const before = createHash('sha256').update(readFileSync(databasePath)).digest('hex')
    const repeat = readLedgerFromSQLite({ databasePath })
    expect(repeat).toEqual(bundle)
    expect(createHash('sha256').update(readFileSync(databasePath)).digest('hex')).toBe(before)
    expect(Object.keys(bundle.tables)).toEqual(LEDGER_TABLE_NAMES)
    expect(bundle.tables.home_assignments).toHaveLength(2)
    expect(bundle.tables.transfer_requests).toHaveLength(1)
    expect(bundle.tables.transfer_events).toHaveLength(2)
    expect(bundle.tables.attention_work_items).toHaveLength(1)
    expect(bundle.tables.attention_events).toHaveLength(1)
    expect(JSON.stringify(bundle)).not.toContain('publicSnapshot')
    expect(JSON.stringify(bundle)).not.toContain('payload_json')
  })

  it('creates only an encrypted envelope, binds version/date/hash, and uses random IVs with stable content identity', () => {
    const { directory, databasePath, bundle } = sourceHarness()
    const key = randomBytes(32)
    const envelope = encryptLedgerBundle(bundle, key)
    const second = encryptLedgerBundle(bundle, key)
    expect(second.bundleSha256).toBe(envelope.bundleSha256)
    expect(second.iv).not.toBe(envelope.iv)
    const encrypted = Buffer.from(envelope.ciphertext, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
    decipher.setAAD(Buffer.from(`${LEDGER_FORMAT}:${bundle.reportDate}:${envelope.bundleSha256}`))
    decipher.setAuthTag(encrypted.subarray(-16))
    expect(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'))).toEqual(bundle)
    const exported = exportCloudLedger({ databasePath, runtimeDir: path.join(directory, 'runtime'), keyBase64: key.toString('base64') })
    const content = readFileSync(exported.envelopePath, 'utf8')
    expect(content).not.toContain('Synthetic Salesperson')
    expect(content).not.toContain('TESTDATA')
    expect(readdirSync(path.dirname(exported.envelopePath))).toEqual(['cloud-ledger-envelope.json'])
    expect(ledgerEncryptionKey(key.toString('base64'))).toEqual(key)
    expect(() => ledgerEncryptionKey(`${key.toString('base64')}garbage`)).toThrow()
  })

  it('imports all activity atomically once and safely replays the same content', async () => {
    const { bundle } = sourceHarness()
    const d1 = d1Harness()
    const imported = await importLedger(bundle, { INVENTORY_DB: d1 })
    expect(imported.status).toBe('imported')
    expect(imported.counts).toEqual(destinationCounts(d1))
    for (const table of LEDGER_TABLE_NAMES) {
      const rows = d1.database.prepare(`SELECT ${LEDGER_COLUMNS[table].join(', ')} FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))
      expect(rows).toEqual(bundle.tables[table])
    }
    expect(d1.database.prepare('SELECT COUNT(*) AS count FROM source_runs').get().count).toBe(0)
    const replay = await importLedger(bundle, { INVENTORY_DB: d1 })
    expect(replay.status).toBe('already_imported')
    expect(d1.database.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(1)
    const changed = structuredClone(bundle)
    changed.tables.transfer_requests[0].reason += ' changed'
    await expect(importLedger(changed, { INVENTORY_DB: d1 })).rejects.toMatchObject({ code: 'LEDGER_ALREADY_IMPORTED', status: 409 })
  })

  it.each(['unknown table', 'unknown column', 'orphan event', 'duplicate key', 'missing audit', 'duplicate current home', 'bad date'])(
    'rejects %s before writing anything', async (problem) => {
      const { bundle } = sourceHarness()
      const changed = structuredClone(bundle)
      if (problem === 'unknown table') changed.tables.source_runs = []
      if (problem === 'unknown column') changed.tables.transfer_requests[0].payload_json = 'not permitted'
      if (problem === 'orphan event') changed.tables.transfer_events[0].transfer_request_id = 'missing'
      if (problem === 'duplicate key') changed.tables.transfer_events.push({ ...changed.tables.transfer_events[0] })
      if (problem === 'missing audit') changed.tables.transfer_events = []
      if (problem === 'duplicate current home') changed.tables.home_assignments[0].effective_to = null
      if (problem === 'bad date') changed.reportDate = '2026-02-31'
      const d1 = d1Harness()
      await expect(importLedger(changed, { INVENTORY_DB: d1 })).rejects.toMatchObject({ code: 'INVALID_LEDGER' })
      expect(Object.values(destinationCounts(d1)).every((count) => count === 0)).toBe(true)
    },
  )

  it('refuses an existing destination without a successful migration marker', async () => {
    const { bundle } = sourceHarness()
    const d1 = d1Harness()
    const row = bundle.tables.home_assignments[0]
    d1.database.prepare('INSERT INTO home_assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...LEDGER_COLUMNS.home_assignments.map((key) => row[key]))
    await expect(importLedger(bundle, { INVENTORY_DB: d1 })).rejects.toMatchObject({ code: 'LEDGER_NOT_EMPTY' })
    expect(destinationCounts(d1).home_assignments).toBe(1)
    expect(destinationCounts(d1).transfer_requests).toBe(0)
  })

  it('rolls back all rows and the import marker after a later insertion failure', async () => {
    const { bundle } = sourceHarness()
    const d1 = d1Harness()
    d1.failTable = 'attention_events'
    await expect(importLedger(bundle, { INVENTORY_DB: d1 })).rejects.toMatchObject({ code: 'LEDGER_IMPORT_CONFLICT' })
    expect(Object.values(destinationCounts(d1)).every((count) => count === 0)).toBe(true)
    expect(d1.database.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(0)
    expect(d1.database.prepare('SELECT COUNT(*) AS count FROM cloud_release_state').get().count).toBe(0)
  })

  it('refuses a stale revision when another app writer wins the race', async () => {
    const { bundle } = sourceHarness()
    const d1 = d1Harness()
    d1.beforeWrite = () => d1.database.exec('UPDATE cloud_app_revision SET revision = revision + 1 WHERE id = 1')
    await expect(importLedger(bundle, { INVENTORY_DB: d1 })).rejects.toMatchObject({ code: 'LEDGER_IMPORT_CONFLICT' })
    expect(Object.values(destinationCounts(d1)).every((count) => count === 0)).toBe(true)
    expect(d1.database.prepare('SELECT revision FROM cloud_app_revision').get().revision).toBe(1)
  })
})
