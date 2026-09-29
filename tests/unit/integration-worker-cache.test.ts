// @vitest-environment node
// @ts-nocheck -- drives the deployed integration Worker against real SQLite; synthetic grants and release only.
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import deployed, { resetIntegrationReadServiceCache } from '../../cloudflare/src/integration-worker.mjs'
import { hashIntegrationToken } from '../../cloudflare/src/integration-access.mjs'
import { resetReleaseCache } from '../../cloudflare/src/worker.mjs'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { encryptBundle } from '../../scripts/publish-cloud-release.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'

// The verifier pages the whole inventory right after a publish. Each page used
// to rebuild the D1 snapshot, app bootstrap and scoped projection; these tests
// count those builds (one D1 snapshot batch per build) through the real
// default export, so the real authenticator, quota and audit stay in the path.
const HOST = 'synthetic-integration-cache.invalid'
const STORES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const ALL_SCOPES = ['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read']
const encryptionKey = Buffer.alloc(32, 47)
const databases = []

async function harness() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  applySyntheticSchema(db)
  db.prepare('INSERT INTO cloud_memberships (email,user_id,name,role,home_store,enabled) VALUES (?,?,?,?,?,1)')
    .run('synthetic-cache@example.invalid', 'synthetic-cache-user', 'Synthetic cache manager', 'manager', 'Howell')
  const objects = new Map()
  const counts = { builds: 0, releaseReads: 0 }
  const base = sqliteD1(db)
  const env = {
    INVENTORY_DB: {
      prepare: (sql) => base.prepare(sql),
      async batch(statements) {
        if (statements.some(({ sql }) => /FROM transfer_requests/.test(sql))) counts.builds++
        return base.batch(statements)
      },
    },
    RELEASE_SNAPSHOTS: {
      async get(key) {
        counts.releaseReads++
        const serialized = objects.get(key)
        return serialized ? { size: Buffer.byteLength(serialized), text: async () => serialized } : null
      },
    },
    RELEASE_ENCRYPTION_KEY_BASE64: encryptionKey.toString('base64'),
    INTEGRATIONS_ENABLED: 'true', INTEGRATION_HOSTNAME: HOST, INTEGRATION_MANAGED_OAUTH_ENABLED: 'false',
    INTEGRATION_CURSOR_SECRET: 'synthetic-integration-cache-cursor-secret-0123456789',
  }
  let releases = 0
  function publish(mutate = () => {}) {
    const bundle = buildSyntheticCloudBundle()
    mutate(bundle)
    const envelope = encryptBundle(bundle, encryptionKey)
    const serialized = JSON.stringify(envelope)
    const id = `synthetic-cache-release-${++releases}`, objectKey = `releases/${id}.enc`
    objects.set(objectKey, serialized)
    db.exec("UPDATE cloud_release_versions SET status='superseded' WHERE status='current'")
    db.prepare(`INSERT INTO cloud_release_versions (release_id,report_date,bundle_sha256,object_key,object_bytes,public_source_sha256,dealermail_source_sha256,public_row_count,dealermail_row_count,status,published_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,'current',?,?)`)
      .run(id, envelope.reportDate, envelope.bundleSha256, objectKey, Buffer.byteLength(serialized), bundle.release.sourceRuns.public.sha256, bundle.release.sourceRuns.dealerMail.sha256, bundle.release.sourceRuns.public.rowCount, bundle.release.sourceRuns.dealerMail.rowCount, '2026-09-29T12:00:00.000Z', '{}')
    db.prepare("INSERT INTO cloud_release_state (key,value,updated_at) VALUES ('current_release_id',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(id, '2026-09-29T12:00:00.000Z')
    return envelope.bundleSha256
  }
  async function client(digit, { stores = STORES, scopes = ALL_SCOPES } = {}) {
    const clientId = digit.repeat(32), token = `iflow_${clientId}_${digit.repeat(43)}`
    const now = new Date().toISOString(), expires = new Date(Date.now() + 7 * 86400000).toISOString()
    db.prepare('INSERT INTO integration_clients (client_id,label,auth_type,owner_user_id,token_sha256,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(clientId, `Synthetic cache grant ${digit}`, 'api_token', 'synthetic-cache-user', await hashIntegrationToken(token), JSON.stringify(scopes), JSON.stringify(stores), 600, 1, expires, now, now)
    return { clientId, token }
  }
  async function get(token, path) {
    const response = await deployed.fetch(new Request(`https://${HOST}${path}`, { headers: { Authorization: `Bearer ${token}` } }), env)
    return { status: response.status, body: await response.json() }
  }
  async function pageAll(token, limit = 2) {
    const pages = []
    let cursor = null
    do {
      const page = await get(token, `/api/v1/inventory?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`)
      expect(page.status).toBe(200)
      pages.push(page.body)
      cursor = page.body.pagination.nextCursor
    } while (cursor)
    return pages
  }
  const audited = (clientId) => db.prepare('SELECT COUNT(*) AS total FROM integration_access_audit WHERE client_id = ?').get(clientId).total
  return { db, env, counts, publish, client, get, pageAll, audited }
}

beforeEach(() => { resetReleaseCache(); resetIntegrationReadServiceCache() })
afterEach(() => {
  vi.useRealTimers()
  for (const database of databases.splice(0)) database.close()
  resetReleaseCache(); resetIntegrationReadServiceCache()
})

describe('integration Worker per-isolate read-service cache', () => {
  it('builds the snapshot, bootstrap and projection once while one principal pages the whole inventory', async () => {
    const h = await harness()
    const bundleSha256 = h.publish()
    const { clientId, token } = await h.client('a')
    const pages = await h.pageAll(token)
    expect(pages.length).toBeGreaterThan(2)
    const vins = pages.flatMap((page) => page.data.map((vehicle) => vehicle.vin))
    expect(new Set(vins).size).toBe(vins.length)
    expect(vins.length).toBe(pages[0].pagination.total)
    expect(pages.every((page) => page.meta.bundleSha256 === bundleSha256)).toBe(true)
    // Before this cache: one build per page. Now: one per isolate and state.
    expect(h.counts).toEqual({ builds: 1, releaseReads: 1 })
    // Authorization and the audit trail still ran on every page.
    expect(h.audited(clientId)).toBe(pages.length)
  })

  it('never serves one grant scope another scope\'s projection', async () => {
    const h = await harness()
    h.publish()
    const narrow = await h.client('b', { stores: ['Howell'], scopes: ['inventory.read'] })
    const wide = await h.client('c')
    const narrowPage = await h.get(narrow.token, '/api/v1/inventory?limit=100')
    const widePage = await h.get(wide.token, '/api/v1/inventory?limit=100')
    expect(h.counts.builds).toBe(2)
    expect(narrowPage.body.meta.allowedStores).toEqual(['Howell'])
    expect(narrowPage.body.data.every((vehicle) => vehicle.publicStore === 'Howell')).toBe(true)
    expect(widePage.body.meta.allowedStores).toEqual(STORES)
    expect(widePage.body.pagination.total).toBeGreaterThan(narrowPage.body.pagination.total)
    // A scope the narrow grant lacks is still refused, even with the wide
    // grant's entry cached beside it.
    expect(await h.get(narrow.token, '/api/v1/changes')).toEqual({ status: 403, body: { error: { code: 'INSUFFICIENT_SCOPE' } } })
    // Each grant keeps its own entry: repeats rebuild nothing.
    expect((await h.get(narrow.token, '/api/v1/inventory?limit=100')).body).toEqual(narrowPage.body)
    expect((await h.get(wide.token, '/api/v1/inventory?limit=100')).body).toEqual(widePage.body)
    expect(h.counts.builds).toBe(2)
    // A grant widened in D1 is a new principal on the next request, not the old projection.
    h.db.prepare('UPDATE integration_clients SET stores_json = ? WHERE client_id = ?').run(JSON.stringify(STORES), narrow.clientId)
    const widened = await h.get(narrow.token, '/api/v1/inventory?limit=100')
    expect(h.counts.builds).toBe(3)
    expect(widened.body.meta.allowedStores).toEqual(STORES)
    expect(widened.body.pagination.total).toBe(widePage.body.pagination.total)
  })

  it('rebuilds for a new current bundle and rejects a cursor from the superseded one', async () => {
    const h = await harness()
    const first = h.publish()
    const { token } = await h.client('d')
    const page = await h.get(token, '/api/v1/inventory?limit=2')
    expect(page.body.meta.bundleSha256).toBe(first)
    const second = h.publish((bundle) => { bundle.release.warnings = [...(bundle.release.warnings ?? []), 'SYNTHETIC_CACHE_REBUILD_MARKER'] })
    expect(second).not.toBe(first)
    const next = await h.get(token, `/api/v1/inventory?limit=2&cursor=${page.body.pagination.nextCursor}`)
    expect(next).toEqual({ status: 400, body: { error: { code: 'INVALID_CURSOR' } } })
    const fresh = await h.get(token, '/api/v1/inventory?limit=2')
    expect(fresh.body.meta.bundleSha256).toBe(second)
    expect(h.counts).toEqual({ builds: 2, releaseReads: 2 })
  })

  it('refuses a revoked or disabled client even while its cache entry exists', async () => {
    const h = await harness()
    h.publish()
    const { clientId, token } = await h.client('e')
    expect((await h.get(token, '/api/v1/inventory?limit=2')).status).toBe(200)
    h.db.prepare('UPDATE integration_clients SET revoked_at = ? WHERE client_id = ?').run(new Date().toISOString(), clientId)
    expect(await h.get(token, '/api/v1/inventory?limit=2')).toEqual({ status: 403, body: { error: { code: 'INTEGRATION_GRANT_INACTIVE' } } })
    h.db.prepare('UPDATE integration_clients SET revoked_at = NULL WHERE client_id = ?').run(clientId)
    h.db.exec("UPDATE cloud_memberships SET enabled = 0 WHERE user_id = 'synthetic-cache-user'")
    expect(await h.get(token, '/api/v1/inventory?limit=2')).toEqual({ status: 403, body: { error: { code: 'INTEGRATION_GRANT_INACTIVE' } } })
    // Refused before the read service was consulted: nothing was rebuilt.
    expect(h.counts.builds).toBe(1)
  })

  it('rebuilds after an app ledger write, a new report day, the lifetime bound or a cursor-secret rotation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T03:59:30Z')) // 23:59:30 in New York
    const h = await harness()
    h.publish()
    const { token } = await h.client('f')
    await h.get(token, '/api/v1/inventory?limit=2')
    await h.get(token, '/api/v1/inventory?limit=2')
    expect(h.counts.builds).toBe(1)
    // Every committed app write (transfer, attention, service, issue) bumps the revision.
    h.db.exec('UPDATE cloud_app_revision SET revision = revision + 1 WHERE id = 1')
    await h.get(token, '/api/v1/inventory?limit=2')
    expect(h.counts.builds).toBe(2)
    // Source freshness is judged against the day in the release time zone:
    // 40 seconds later, inside the lifetime bound, but past New York midnight.
    vi.setSystemTime(new Date('2026-09-30T04:00:10Z'))
    await h.get(token, '/api/v1/inventory?limit=2')
    expect(h.counts.builds).toBe(3)
    vi.setSystemTime(new Date('2026-09-30T04:01:11Z'))
    await h.get(token, '/api/v1/inventory?limit=2')
    expect(h.counts.builds).toBe(4)
    h.env.INTEGRATION_CURSOR_SECRET = 'synthetic-integration-cache-rotated-secret-9876543210'
    await h.get(token, '/api/v1/inventory?limit=2')
    expect(h.counts.builds).toBe(5)
    expect(h.counts.releaseReads).toBe(1)
  })
})
