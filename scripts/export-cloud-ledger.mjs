import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LEDGER_COLUMNS, LEDGER_FORMAT, LEDGER_TABLE_NAMES, ledgerCounts, validateLedgerBundle } from '../cloudflare/src/ledger-import.mjs'

const APP_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export function ledgerEncryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('A canonical base64 32-byte ledger encryption key is required')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length !== 32 || bytes.toString('base64') !== value) throw new Error('Ledger encryption key is invalid')
  return bytes
}

/** Opens an existing local ledger read-only; source tables are never selected. */
export function readLedgerFromSQLite({ databasePath = path.join(APP_ROOT, 'runtime', 'inventory-ops.sqlite'), reportDate } = {}) {
  if (!existsSync(databasePath)) throw new Error('The local saved-activity database does not exist')
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    database.exec('PRAGMA query_only = ON; BEGIN')
    const resolvedDate = reportDate ?? database.prepare("SELECT value FROM app_state WHERE key = 'current_report_date'").get()?.value
    const tables = Object.fromEntries(LEDGER_TABLE_NAMES.map((table) => [table,
      database.prepare(`SELECT ${LEDGER_COLUMNS[table].join(', ')} FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row })),
    ]))
    const bundle = validateLedgerBundle({ schemaVersion: LEDGER_FORMAT, reportDate: resolvedDate, tables })
    database.exec('COMMIT')
    return bundle
  } finally {
    database.close()
  }
}

export function encryptLedgerBundle(input, key) {
  const bundle = validateLedgerBundle(input)
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Ledger encryption key must contain exactly 32 bytes')
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8')
  const bundleSha256 = createHash('sha256').update(plaintext).digest('hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${LEDGER_FORMAT}:${bundle.reportDate}:${bundleSha256}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  plaintext.fill(0)
  return { version: LEDGER_FORMAT, reportDate: bundle.reportDate, bundleSha256, iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url') }
}

export function exportCloudLedger({ databasePath, reportDate, keyBase64, runtimeDir = path.join(APP_ROOT, 'runtime') } = {}) {
  const key = ledgerEncryptionKey(keyBase64)
  try {
    const bundle = readLedgerFromSQLite({ databasePath, reportDate })
    const envelope = encryptLedgerBundle(bundle, key)
    mkdirSync(runtimeDir, { recursive: true })
    const target = path.join(runtimeDir, 'cloud-ledger-envelope.json')
    const temporary = path.join(runtimeDir, `.cloud-ledger-envelope-${randomUUID()}.json`)
    writeFileSync(temporary, JSON.stringify(envelope), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temporary, target)
    return { reportDate: bundle.reportDate, counts: ledgerCounts(bundle), envelopePath: target }
  } finally {
    key.fill(0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = exportCloudLedger({
      keyBase64: process.env.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64,
    })
    // Encrypted artifact stays under ignored runtime/. Console output is counts only.
    process.stdout.write(`Saved activity encrypted: ${JSON.stringify(result.counts)}\n`)
  } catch {
    process.stderr.write('Saved activity was not exported. Check the local database, schema, and configured encryption key; no source data was exported.\n')
    process.exitCode = 1
  }
}
