// @ts-nocheck -- exercises the real D1 migration SQL against node:sqlite.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AUDIT_OPERATIONS } from '../../cloudflare/src/integration-access.mjs'
import { TOOL_OPERATIONS } from '../../cloudflare/src/integration-worker.mjs'

const migrationsDirectory = new URL('../../cloudflare/migrations/', import.meta.url)
const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })

function migrated() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, migrationsDirectory), 'utf8'))
  }
  const now = new Date().toISOString()
  db.prepare('INSERT INTO cloud_memberships(email,user_id,name,role,home_store,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('synthetic@example.invalid', 'synthetic-user', 'Synthetic owner', 'group_manager', 'Howell', 1, now, now)
  db.prepare('INSERT INTO integration_clients (client_id,label,auth_type,owner_user_id,token_sha256,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('a'.repeat(32), 'Synthetic integration', 'api_token', 'synthetic-user', 'b'.repeat(64), '["inventory.read"]', '["Howell"]', 60, 1, now, now, now)
  return db
}

describe('integration audit operation allowlist', () => {
  it('accepts every operation the Worker records under the migrated D1 CHECK constraint', () => {
    const db = migrated()
    const insert = db.prepare('INSERT INTO integration_access_audit (client_id, operation, status, result_count, occurred_at) VALUES (?, ?, 200, 0, ?)')
    for (const operation of AUDIT_OPERATIONS) {
      expect(() => insert.run('a'.repeat(32), operation, Date.now()), operation).not.toThrow()
    }
    expect(() => insert.run('a'.repeat(32), 'unlisted_operation', Date.now())).toThrow(/CHECK constraint/)
  })

  it('maps every MCP tool to an audited operation name', () => {
    for (const [tool, operation] of Object.entries(TOOL_OPERATIONS)) {
      expect(AUDIT_OPERATIONS.has(operation), `${tool} -> ${operation}`).toBe(true)
    }
  })

  it('keeps both audit indexes after the table rebuild', () => {
    const db = migrated()
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='integration_access_audit'").all().map((row) => row.name).sort()
    expect(indexes).toEqual(['integration_access_audit_client_time_idx', 'integration_access_audit_time_idx'])
  })
})
