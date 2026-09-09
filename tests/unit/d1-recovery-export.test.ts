// @ts-nocheck -- synthetic export goes through real SQLite and AES-GCM.
// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectD1RecoveryBackup, verifyD1RecoveryExport } from '../../scripts/verify-d1-recovery-export.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(path.join(directory, file))
    rmdirSync(directory)
  }
})
function fixture(extra = '') {
  const directory = mkdtempSync(path.join(tmpdir(), 'synthetic-d1-export-'))
  directories.push(directory)
  const migrationDir = new URL('../../cloudflare/migrations/', import.meta.url)
  const schema = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort().map((name) => readFileSync(new URL(name, migrationDir), 'utf8')).join('\n')
  const inputPath = path.join(directory, 'export.sql'), outputPath = path.join(directory, 'backup.encrypted.json')
  writeFileSync(inputPath, `${schema}\nINSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES ('synthetic@example.invalid','synthetic-1','Synthetic manager','manager','Howell',1);\nINSERT INTO home_assignments VALUES ('synthetic-home','TESTDATAHWELL0001','Howell','2026-08-30',NULL,'synthetic','Synthetic manager','Please attach an invoice after the vacuum service','2026-08-30');\nUPDATE cloud_app_revision SET revision=13 WHERE id=1;\n${extra}`)
  return { inputPath, outputPath, keyBase64: randomBytes(32).toString('base64') }
}
describe('actual D1 export recovery verifier', () => {
  it('preserves the input by default and verifies a persisted encrypted backup without leaking SQL', () => {
    const options = fixture()
    const result = verifyD1RecoveryExport(options)
    expect(result).toMatchObject({ complete: true, inputRemoved: false, database: { revision: 13, rowCounts: { cloud_memberships: 1, home_assignments: 1 } } })
    expect(Object.values(result.checks).every(Boolean)).toBe(true)
    expect(existsSync(options.inputPath)).toBe(true)
    expect(readFileSync(options.outputPath, 'utf8')).not.toContain('Synthetic manager')
    expect(JSON.stringify(result)).not.toContain('synthetic@example.invalid')
    expect(() => verifyD1RecoveryExport(options)).toThrow('cannot be overwritten')
  })
  it('removes only the expressly disposable export after restoration succeeds', () => {
    const options = fixture()
    expect(verifyD1RecoveryExport({ ...options, disposableExport: true }).inputRemoved).toBe(true)
    expect(existsSync(options.inputPath)).toBe(false)
    expect(existsSync(options.outputPath)).toBe(true)
    expect(inspectD1RecoveryBackup({ backupPath: options.outputPath, keyBase64: options.keyBase64 })).toMatchObject({ complete: true, database: { revision: 13 } })
    expect(() => inspectD1RecoveryBackup({ backupPath: options.outputPath, keyBase64: randomBytes(32).toString('base64') })).toThrow()
  })
  it.each(['ATTACH DATABASE \'elsewhere.sqlite\' AS external;', 'DROP TRIGGER transfer_events_no_update;', 'INSERT INTO attention_events (id,attention_key,event_type,label,actor,actor_role,occurred_at,created_at) VALUES (\'orphan\',\'missing\',\'note\',\'note\',\'Synthetic\',\'manager\',\'2026-08-30\',\'2026-08-30\');'])('fails closed on an unsafe or incomplete export and preserves it', (sql) => {
    const options = fixture(sql)
    expect(() => verifyD1RecoveryExport({ ...options, disposableExport: true })).toThrow()
    expect(existsSync(options.inputPath)).toBe(true)
    expect(existsSync(options.outputPath)).toBe(false)
  })
})
