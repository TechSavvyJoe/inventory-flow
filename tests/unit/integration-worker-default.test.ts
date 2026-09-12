// @vitest-environment node
// @ts-nocheck -- exercises the deployed Worker composition against real SQLite; synthetic grants only.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import deployed from '../../cloudflare/src/integration-worker.mjs'
import { hashIntegrationToken } from '../../cloudflare/src/integration-access.mjs'

// Every other gateway test injects fakes into createIntegrationWorker(). This
// file calls the default export — the object wrangler deploys — so the real
// authenticator, quota, audit and read-service loader are the ones wired in.
const HOST = 'synthetic-integration.invalid'
const clientId = '4'.repeat(32)
const apiToken = `iflow_${clientId}_${'c'.repeat(43)}`
const databases = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })

function sqliteD1(db) {
  return {
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this },
        async first() { return db.prepare(sql).get(...this.values) ?? null },
        async all() { return { success: true, results: db.prepare(sql).all(...this.values) } },
        async run() { return { success: true, meta: { changes: db.prepare(sql).run(...this.values).changes } } },
      }
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ sql, values }) => ({ success: true, meta: { changes: db.prepare(sql).run(...values).changes } }))
        db.exec('COMMIT')
        return results
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
}

async function harness() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE cloud_memberships (email TEXT PRIMARY KEY COLLATE NOCASE, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, home_store TEXT NOT NULL, enabled INTEGER NOT NULL);
    INSERT INTO cloud_memberships VALUES ('synthetic@example.invalid', 'synthetic-user', 'Synthetic manager', 'manager', 'Howell', 1);`)
  db.exec(readFileSync(new URL('../../cloudflare/migrations/0004_integrations.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('../../cloudflare/migrations/0006_integration_audit_per_client.sql', import.meta.url), 'utf8'))
  const now = new Date().toISOString(), expires = new Date(Date.now() + 86400000).toISOString()
  db.prepare('INSERT INTO integration_clients (client_id,label,auth_type,owner_user_id,token_sha256,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(clientId, 'Synthetic default-composition grant', 'api_token', 'synthetic-user', await hashIntegrationToken(apiToken), '["inventory.read","health.read"]', '["Howell"]', 3, 1, expires, now, now)
  const env = {
    INVENTORY_DB: sqliteD1(db), INTEGRATIONS_ENABLED: 'true', INTEGRATION_HOSTNAME: HOST, INTEGRATION_MANAGED_OAUTH_ENABLED: 'false',
    INTEGRATION_CURSOR_SECRET: 'synthetic-default-composition-cursor-secret-0123456789',
    // No release is published: the real loader must fail closed after the real
    // authenticator, quota and audit have run.
    RELEASE_SNAPSHOTS: { async get() { return null } },
  }
  return { db, env }
}

const request = (token, path = '/api/v1/inventory') => new Request(`https://${HOST}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

describe('deployed integration Worker composition', () => {
  it('rejects anonymous and unknown credentials with the real authenticator and writes nothing', async () => {
    const { db, env } = await harness()
    for (const [token, code] of [[null, 'INTEGRATION_AUTHENTICATION_REQUIRED'], ['not-a-token', 'INTEGRATION_TOKEN_INVALID'], [`iflow_${'5'.repeat(32)}_${'d'.repeat(43)}`, 'INTEGRATION_TOKEN_INVALID']]) {
      const result = await deployed.fetch(request(token), env)
      expect({ token, status: result.status }).toEqual({ token, status: 401 })
      expect(await result.json()).toEqual({ error: { code } })
    }
    expect(db.prepare('SELECT COUNT(*) AS total FROM integration_access_audit').get().total).toBe(0)
  })

  it('runs a real grant through the real quota, audit and loader, and fails closed without a release', async () => {
    const { db, env } = await harness()
    const result = await deployed.fetch(request(apiToken), env)
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: { code: 'INTEGRATION_DATA_UNAVAILABLE' } })
    // The real quota was consumed and reported even on the failure …
    expect(result.headers.get('RateLimit-Limit')).toBe('3')
    expect(result.headers.get('RateLimit-Remaining')).toBe('2')
    // … and the real audit recorded the attempt against this client, with no
    // token, exception text or source detail alongside it.
    const rows = db.prepare('SELECT client_id, operation, status, result_count FROM integration_access_audit').all()
    expect(rows).toEqual([{ client_id: clientId, operation: 'inventory_list', status: 503, result_count: 0 }])
    expect(JSON.stringify(rows)).not.toContain('iflow_')
  })

  it('enforces the real per-minute quota end to end', async () => {
    const { env } = await harness()
    const statuses = []
    for (let index = 0; index < 4; index += 1) statuses.push((await deployed.fetch(request(apiToken, '/api/v1/data-health'), env)).status)
    const last = await deployed.fetch(request(apiToken, '/api/v1/data-health'), env)
    expect(statuses).toEqual([503, 503, 503, 429])
    expect(last.status).toBe(429)
    expect(await last.json()).toEqual({ error: { code: 'INTEGRATION_RATE_LIMITED' } })
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})
