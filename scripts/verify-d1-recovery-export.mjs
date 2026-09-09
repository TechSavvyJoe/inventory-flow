// Validates an explicitly supplied D1 SQL export locally. Never connects to D1.
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { base64Key } from './publish-cloud-release.mjs'
import { databaseEvidence } from './run-recovery-drill.mjs'

const FORMAT = 'inventory-flow-d1-sql-recovery-v1'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const requiredTriggers = ['cloud_app_revision_no_delete', 'transfer_events_no_update', 'transfer_events_no_delete', 'attention_events_no_update', 'attention_events_no_delete']

function restoreInMemory(sql) {
  const database = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: false, allowExtension: false })
  try {
    // D1 exports consist of schema/data SQL. Refuse commands that could attach
    // another file, load code, or write a file outside this in-memory restore.
    const instructions = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g, ' ')
    if (/\b(?:ATTACH|DETACH|VACUUM)\b|\bload_extension\s*\(|\b(?:writable_schema|temp_store_directory|data_store_directory)\b/i.test(instructions)) throw new Error('Export contains a disallowed restore instruction')
    database.exec(sql)
    database.exec('PRAGMA foreign_keys = ON')
    assert.deepEqual(database.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check), ['ok'])
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    const triggers = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all().map((row) => row.name))
    for (const trigger of requiredTriggers) assert.ok(triggers.has(trigger), 'Required operational audit protection is missing from the export')
    return database
  } catch (error) { database.close(); throw error }
}

function decrypt(envelope, key) {
  assert.equal(envelope.format, FORMAT)
  const encrypted = Buffer.from(envelope.ciphertext, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
  decipher.setAAD(Buffer.from(`${FORMAT}:${envelope.sourceSha256}:${envelope.databaseSha256}`))
  decipher.setAuthTag(encrypted.subarray(-16))
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()])
  assert.equal(hash(plaintext), envelope.sourceSha256)
  return plaintext
}

/** Verify an existing encrypted artifact after the plaintext export is gone. */
export function inspectD1RecoveryBackup({ backupPath, keyBase64 }) {
  const key = base64Key(keyBase64)
  let plaintext, restored
  try {
    const envelope = JSON.parse(readFileSync(backupPath, 'utf8'))
    plaintext = decrypt(envelope, key)
    restored = restoreInMemory(plaintext.toString('utf8'))
    const database = databaseEvidence(restored)
    assert.equal(database.digest, envelope.databaseSha256)
    return { complete: true, sourceSha256: envelope.sourceSha256, database, integrity: true, foreignKeys: true, requiredTriggers: true }
  } finally { restored?.close(); plaintext?.fill(0); key.fill(0) }
}

/** Caller secures the exact export and output directory before invoking. */
export function verifyD1RecoveryExport({ inputPath, outputPath, keyBase64, disposableExport = false }) {
  const started = performance.now()
  const input = realpathSync(inputPath), output = path.resolve(outputPath)
  assert.notEqual(input.toLowerCase(), output.toLowerCase(), 'Input and output must be different files')
  assert.equal(path.extname(input).toLowerCase(), '.sql', 'Only an explicitly exported SQL file is accepted')
  assert.equal(existsSync(output), false, 'An existing encrypted backup cannot be overwritten')
  const inputStat = statSync(input)
  assert.ok(inputStat.isFile() && inputStat.size > 0 && inputStat.size <= 256 * 1024 * 1024, 'Export must be a nonempty file up to 256 MiB')
  const key = base64Key(keyBase64), wrongKey = randomBytes(32)
  let plaintext, recovered, source, restored
  try {
    plaintext = readFileSync(input)
    source = restoreInMemory(plaintext.toString('utf8'))
    const evidence = databaseEvidence(source)
    const iv = randomBytes(12), sourceSha256 = hash(plaintext)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(`${FORMAT}:${sourceSha256}:${evidence.digest}`))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
    const envelope = { format: FORMAT, sourceSha256, databaseSha256: evidence.digest, iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url') }
    assert.throws(() => decrypt(envelope, wrongKey))
    const tampered = Buffer.from(ciphertext); tampered[Math.floor(tampered.length / 2)] ^= 1
    assert.throws(() => decrypt({ ...envelope, ciphertext: tampered.toString('base64url') }, key))
    assert.throws(() => decrypt({ ...envelope, databaseSha256: '0'.repeat(64) }, key))
    // Persist the exact authenticated artifact, then re-open it before verification.
    writeFileSync(output, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 })
    recovered = decrypt(JSON.parse(readFileSync(output, 'utf8')), key)
    restored = restoreInMemory(recovered.toString('utf8'))
    assert.deepEqual(databaseEvidence(restored), evidence)
    const summary = {
      schemaVersion: 'inventory-flow-d1-recovery-verification-v1', complete: true,
      verifiedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
      sourceSha256, encryptedSha256: hash(readFileSync(output)), encryptedBytes: statSync(output).size,
      database: evidence,
      checks: { integrity: true, foreignKeys: true, schemaAndRowsExact: true, auditExact: true, requiredTriggers: true, revisionPreserved: true, persistedCiphertextDecrypted: true, wrongKeyRejected: true, tamperedCiphertextRejected: true, changedMetadataRejected: true },
      inputRemoved: false,
      boundary: 'An explicitly supplied SQL export was restored only in local memory. Live D1 Time Travel, independent recovery-key possession and cloud account recovery were not exercised.',
    }
    if (disposableExport) {
      // Avoid deleting an export replaced by another process during this drill.
      const current = statSync(input)
      assert.equal(current.dev, inputStat.dev)
      assert.equal(current.ino, inputStat.ino)
      assert.equal(hash(readFileSync(input)), sourceSha256)
      unlinkSync(input)
      summary.inputRemoved = true
    }
    return summary
  } finally {
    source?.close(); restored?.close(); plaintext?.fill(0); recovered?.fill(0)
    key.fill(0); wrongKey.fill(0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 2 && args[0] === '--verify-backup') {
      const result = inspectD1RecoveryBackup({ backupPath: args[1], keyBase64: process.env.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64 })
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
    const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
    const inputPath = value('--input'), outputPath = value('--output')
    if (!inputPath || !outputPath || args.some((arg, index) => index % 2 === 0 && !['--input', '--output', '--disposable-export'].includes(arg))) throw new Error('Provide --input export.sql --output backup.encrypted.json [--disposable-export]')
    const result = verifyD1RecoveryExport({ inputPath, outputPath, keyBase64: process.env.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64, disposableExport: args.includes('--disposable-export') })
    writeFileSync(`${path.resolve(outputPath)}.verification.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
    process.stdout.write(`${JSON.stringify({ complete: result.complete, inputRemoved: result.inputRemoved, database: result.database, verification: `${path.resolve(outputPath)}.verification.json` }, null, 2)}\n`)
    }
  } catch {
    process.stderr.write('Recovery export validation failed. Live D1 was not changed. Preserve the export for authorized review; no source rows or credentials were printed.\n')
    process.exitCode = 1
  }
}
