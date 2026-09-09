// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// Offline recovery exercise. Accepts no database path, remote target or live key.
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSyntheticCloudBundle } from '../fixtures/synthetic-cloud-bundle.mjs'
import { SYNTHETIC_NOW } from '../fixtures/synthetic-release.mjs'
import { memberContext } from '../cloudflare/src/access.mjs'
import { loadD1Repository } from '../cloudflare/src/repository.mjs'
import { decryptEnvelope } from '../cloudflare/src/worker.mjs'
import { validateReleaseBundle } from '../cloudflare/src/release-validation.mjs'
import { createInventoryServiceCore } from '../server/service-core.mjs'
import { encryptBundle } from './publish-cloud-release.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FORMAT = 'inventory-flow-synthetic-sqlite-backup-v1'
const sha = (value) => createHash('sha256').update(value).digest('hex')
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`

/** Real SQLite implements the D1 prepared-statement and atomic batch contract. */
export function sqliteD1(database) {
  return {
    prepare(sql) {
      return {
        sql, params: [],
        bind(...params) { this.params = params; return this },
        async first() { return database.prepare(sql).get(...this.params) ?? null },
        async all() { return { success: true, results: database.prepare(sql).all(...this.params) } },
      }
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ sql, params = [] }) => {
          const statement = database.prepare(sql)
          if (/^\s*SELECT\b/i.test(sql)) return { success: true, results: statement.all(...params) }
          return { success: true, results: [], meta: { changes: statement.run(...params).changes } }
        })
        database.exec('COMMIT')
        return results
      } catch (error) { database.exec('ROLLBACK'); throw error }
    },
  }
}

export function applySyntheticSchema(database) {
  database.exec('PRAGMA foreign_keys = ON')
  const directory = new URL('../cloudflare/migrations/', import.meta.url)
  for (const name of readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    database.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
}

export function databaseEvidence(database) {
  const schema = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
  const tables = schema.filter((row) => row.type === 'table').map((row) => row.name)
  const records = Object.fromEntries(tables.map((name) => [name, database.prepare(`SELECT * FROM ${quote(name)}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))]))
  return {
    digest: sha(JSON.stringify({ schema, records })),
    schemaDigest: sha(JSON.stringify(schema)),
    rowCounts: Object.fromEntries(tables.map((name) => [name, records[name].length])),
    schemaObjects: schema.length,
    revision: records.cloud_app_revision[0].revision,
    // Digest all values, including exact free-form audit text and immutable IDs.
    auditDigest: sha(JSON.stringify([records.transfer_events, records.attention_events])),
  }
}

function encryptedBackup(plaintext, key) {
  const digest = sha(plaintext), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${FORMAT}:${digest}`))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  return { format: FORMAT, digest, iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url') }
}

function decryptBackup(envelope, key) {
  assert.equal(envelope.format, FORMAT)
  const encrypted = Buffer.from(envelope.ciphertext, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
  decipher.setAAD(Buffer.from(`${FORMAT}:${envelope.digest}`))
  decipher.setAuthTag(encrypted.subarray(-16))
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()])
  assert.equal(sha(plaintext), envelope.digest)
  return plaintext
}

function corrupt(envelope) {
  const bytes = Buffer.from(envelope.ciphertext, 'base64url')
  bytes[Math.floor(bytes.length / 2)] ^= 1
  return { ...envelope, ciphertext: bytes.toString('base64url') }
}

async function serviceFor(database, release) {
  const state = await loadD1Repository(sqliteD1(database), release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  return { ...state, service: createInventoryServiceCore({ database: state.database, repository: state.repository, now: () => SYNTHETIC_NOW }) }
}

export async function runRecoveryDrill({ reportDirectory } = {}) {
  const started = performance.now()
  const directory = mkdtempSync(path.join(tmpdir(), 'inventory-flow-synthetic-recovery-'))
  const sourcePath = path.join(directory, 'source.sqlite')
  const backupPath = path.join(directory, 'backup.sqlite')
  const restoredPath = path.join(directory, 'restored.sqlite')
  const key = randomBytes(32), wrongKey = randomBytes(32)
  let source, restored
  try {
    const bundle = buildSyntheticCloudBundle()
    const envelope = encryptBundle(bundle, key)
    const sourceCounts = validateReleaseBundle(bundle)
    const releasePath = path.join(directory, 'release.encrypted.json')
    writeFileSync(releasePath, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 })
    source = new DatabaseSync(sourcePath)
    applySyntheticSchema(source)
    const contexts = []
    for (const role of ['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver']) {
      for (const store of ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']) {
        const id = `synthetic-${contexts.length}`
        source.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)').run(`${id}@example.invalid`, id, `Synthetic ${role} ${store}`, role, store)
        contexts.push(await memberContext({ email: `${id}@example.invalid` }, { INVENTORY_DB: sqliteD1(source) }))
      }
    }
    const sales = contexts.find((item) => item.role === 'sales' && item.store === 'Fowlerville')
    const manager = contexts.find((item) => item.role === 'manager' && item.store === 'Fowlerville')
    source.prepare('INSERT INTO home_assignments VALUES (?,?,?,?,?,?,?,?,?)').run('synthetic-home', bundle.release.vehicles[0].vin, 'Howell', SYNTHETIC_NOW.toISOString(), null, 'synthetic_drill', 'Synthetic manager', 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS', SYNTHETIC_NOW.toISOString())
    source.prepare('INSERT INTO cloud_release_state VALUES (?,?,?)').run('current_release_id', 'synthetic-release', SYNTHETIC_NOW.toISOString())
    source.prepare('INSERT INTO cloud_release_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-release', bundle.reportDate, envelope.bundleSha256, 'synthetic/release.encrypted.json', JSON.stringify(envelope).length, bundle.release.sourceRuns.public.sha256, bundle.release.sourceRuns.dealerMail.sha256, sourceCounts.publicRowCount, sourceCounts.dealerMailRowCount, 'current', SYNTHETIC_NOW.toISOString(), JSON.stringify(sourceCounts))
    const first = await serviceFor(source, bundle.release)
    const request = first.service.createTransfer({ vin: bundle.release.vehicles[1].vin, neededBy: '2026-08-31T18:00:00Z', reason: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS recovery drill' }, sales, 'synthetic-recovery-request')
    await first.commit()
    for (const [input, identity] of [[{ type: 'manager_reviewed' }, 'review'], [{ type: 'approved', homeStoreManager: 'Synthetic home manager' }, 'approve'], [{ type: 'note_added', note: "Synthetic audit: 'quotes' <markup>\nLine two — exact text." }, 'note']]) {
      const next = await serviceFor(source, bundle.release)
      next.service.appendTransferEvent(request.record.id, input, manager, `synthetic-recovery-${identity}`)
      await next.commit()
    }
    const attentionSession = await serviceFor(source, bundle.release)
    const attention = attentionSession.service.listAttention({}, manager).items.find((item) => item.allowedActions.includes('acknowledge'))
    assert.ok(attention, 'A synthetic actionable alert must exist')
    attentionSession.service.appendAttentionEvent(attention.id, { type: 'acknowledge', note: 'Synthetic recovery acknowledgment' }, manager, 'synthetic-recovery-attention')
    await attentionSession.commit()
    const original = databaseEvidence(source)
    const originalSession = await serviceFor(source, bundle.release)
    const originalViews = contexts.map((context) => originalSession.service.bootstrap(context))

    await backup(source, backupPath)
    const plaintext = readFileSync(backupPath)
    const databaseEnvelope = encryptedBackup(plaintext, key)
    plaintext.fill(0)
    const envelopePath = path.join(directory, 'ledger.encrypted.json')
    writeFileSync(envelopePath, JSON.stringify(databaseEnvelope), { flag: 'wx', mode: 0o600 })
    source.close(); source = null
    unlinkSync(sourcePath)
    unlinkSync(backupPath)
    assert.equal(existsSync(sourcePath), false)
    assert.equal(existsSync(backupPath), false)
    assert.throws(() => decryptBackup(databaseEnvelope, wrongKey))
    assert.throws(() => decryptBackup(corrupt(databaseEnvelope), key))
    assert.throws(() => decryptBackup({ ...databaseEnvelope, digest: '0'.repeat(64) }, key))
    const restoredBytes = decryptBackup(JSON.parse(readFileSync(envelopePath, 'utf8')), key)
    writeFileSync(restoredPath, restoredBytes, { flag: 'wx', mode: 0o600 })
    restoredBytes.fill(0)
    restored = new DatabaseSync(restoredPath)
    restored.exec('PRAGMA foreign_keys = ON')
    assert.deepEqual(restored.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check), ['ok'])
    assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), [])
    assert.deepEqual(databaseEvidence(restored), original)

    const storedRelease = JSON.parse(readFileSync(releasePath, 'utf8'))
    const env = { RELEASE_ENCRYPTION_KEY_BASE64: key.toString('base64') }
    await assert.rejects(decryptEnvelope(storedRelease, { RELEASE_ENCRYPTION_KEY_BASE64: wrongKey.toString('base64') }))
    await assert.rejects(decryptEnvelope(corrupt(storedRelease), env))
    const recoveredBundle = await decryptEnvelope(storedRelease, env)
    assert.deepEqual(recoveredBundle, bundle)
    const recovered = await serviceFor(restored, recoveredBundle.release)
    for (let index = 0; index < contexts.length; index++) assert.deepEqual(recovered.service.bootstrap(contexts[index]), originalViews[index])
    const replay = recovered.service.appendTransferEvent(request.record.id, { type: 'manager_reviewed' }, manager, 'synthetic-recovery-review')
    assert.equal(replay.created, false)
    assert.deepEqual(await recovered.commit(), { committed: false, revision: original.revision })
    for (const table of ['transfer_events', 'attention_events']) {
      assert.throws(() => restored.exec(`UPDATE ${table} SET note = 'tampered'`), /append-only/)
      assert.throws(() => restored.exec(`DELETE FROM ${table}`), /append-only/)
    }
    assert.deepEqual(databaseEvidence(restored), original)
    const summary = {
      schemaVersion: 'inventory-flow-recovery-drill-v1', syntheticOnly: true, complete: true,
      executedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
      engine: `Node ${process.versions.node} SQLite ${process.versions.sqlite}`,
      checks: { databaseBackupRestore: true, sourceDeletedBeforeRestore: true, schemaAndRowsExact: true, integrity: true, foreignKeys: true, auditExact: true, appendOnlyTriggers: true, revisionPreserved: true, idempotentReplay: true, encryptedReleaseExact: true, wrongDatabaseKeyRejected: true, tamperedDatabaseRejected: true, changedDatabaseDigestRejected: true, wrongReleaseKeyRejected: true, tamperedReleaseRejected: true, allRoleStoreBootstrapEquivalent: true },
      roleStoreViewsChecked: contexts.length, database: original, sourceCounts,
      boundary: 'Offline synthetic SQLite/D1-contract exercise; no production restore, cloud Time Travel, independent key escrow, live employee account, or actual lost-host recovery was tested.',
    }
    if (reportDirectory) {
      mkdirSync(reportDirectory, { recursive: true })
      writeFileSync(path.join(reportDirectory, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 })
    }
    return summary
  } finally {
    source?.close(); restored?.close(); key.fill(0); wrongKey.fill(0)
    // Only explicitly created files under this unique temporary directory.
    for (const name of ['source.sqlite', 'backup.sqlite', 'restored.sqlite', 'release.encrypted.json', 'ledger.encrypted.json']) {
      const target = path.resolve(directory, name)
      assert.equal(path.dirname(target), path.resolve(directory))
      if (existsSync(target)) unlinkSync(target)
    }
    rmdirSync(directory)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('The synthetic drill accepts no live database, key, path, or remote arguments')
  const base = path.join(ROOT, 'runtime', 'recovery-drills')
  mkdirSync(base, { recursive: true })
  const reportDirectory = mkdtempSync(path.join(base, 'synthetic-'))
  try {
    const result = await runRecoveryDrill({ reportDirectory })
    process.stdout.write(`${JSON.stringify({ complete: result.complete, syntheticOnly: true, roleStoreViewsChecked: result.roleStoreViewsChecked, database: result.database.rowCounts, report: path.join(reportDirectory, 'summary.json') }, null, 2)}\n`)
  } catch {
    process.stderr.write('Synthetic recovery drill failed. No production database, release, key or membership was changed.\n')
    process.exitCode = 1
  }
}
