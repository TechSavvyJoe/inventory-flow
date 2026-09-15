// @ts-nocheck -- owner-run JavaScript CLI, isolated SQL, fabricated credentials only.
// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { bindWranglerQuery, cloudflareIntegrationDatabase, createIntegrationClient, listIntegrationClients, parseManagementArguments, revokeIntegrationClient, secureCredentialPath, validateCreateOptions, wranglerIntegrationDatabase, writePrivateIntegrationCredential } from '../../scripts/manage-integration-client.mjs'
import { hashIntegrationToken } from '../../cloudflare/src/integration-access.mjs'

const databases = [], directories = []
const instant = Date.parse('2026-09-09T19:00:00.000Z')
const options = { confirm: true, ownerUserId: 'synthetic-owner', authType: 'api_token', label: 'Synthetic reporting app', scopes: ['inventory.read', 'health.read'], stores: ['Howell', 'Lincoln'], days: 30, secretOutput: 'runtime/integration-credentials/synthetic.json' }
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) {
    expect(path.dirname(directory)).toBe(path.resolve(tmpdir()))
    expect(path.basename(directory)).toMatch(/^inventory-credential-test-/)
    rmSync(directory, { recursive: true, force: true })
  }
})

function harness() {
  const database = new DatabaseSync(':memory:')
  databases.push(database)
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE cloud_memberships(email TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT,role TEXT,home_store TEXT,enabled INTEGER);
    INSERT INTO cloud_memberships VALUES ('synthetic@example.invalid','synthetic-owner','Synthetic manager','manager','Howell',1);`)
  database.exec(readFileSync(new URL('../../cloudflare/migrations/0004_integrations.sql', import.meta.url), 'utf8'))
  const calls = []
  const db = { async query(sql, params = []) { calls.push({ sql, params }); return database.prepare(sql).all(...params) } }
  const secret = { value: null, path: null, rolledBack: false }
  const writeSecret = vi.fn(async (output, value) => {
    secret.value = value
    secret.path = output
    expect(database.prepare('SELECT enabled FROM integration_clients WHERE client_id=?').get(value.clientId).enabled).toBe(0)
    return { path: output, async rollback() { secret.rolledBack = true; return true } }
  })
  return { database, db, calls, secret, deps: { db, writeSecret, now: () => instant } }
}

function fileFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-credential-test-'))
  directories.push(root)
  writeFileSync(path.join(root, '.gitignore'), 'runtime/\n', 'utf8')
  return root
}

describe('explicit integration provisioning', () => {
  it('creates a disabled reservation, writes private credentials, then activates with only a hash in D1', async () => {
    const { database, deps, calls, secret } = harness()
    const result = await createIntegrationClient(options, deps)
    expect(result.created).toBe(true)
    expect(result.client).toMatchObject({ enabled: true, scopes: options.scopes, stores: options.stores, ownerUserId: options.ownerUserId, expiresAt: '2026-10-09T19:00:00.000Z' })
    expect(secret.value.token).toMatch(/^iflow_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/)
    expect(database.prepare('SELECT token_sha256 FROM integration_clients').get().token_sha256).toBe(await hashIntegrationToken(secret.value.token))
    expect(JSON.stringify(calls)).not.toContain(secret.value.token)
    expect(JSON.stringify(result)).not.toContain(secret.value.token)
    expect(JSON.stringify(result)).not.toContain('token_sha256')
    expect(secret.rolledBack).toBe(false)
  })

  it('creates per-employee OAuth grants without creating or exposing an OAuth secret', async () => {
    const { database, deps } = harness()
    const result = await createIntegrationClient({ ...options, authType: 'access_oauth', secretOutput: undefined }, deps)
    expect(result.client.authType).toBe('access_oauth')
    expect(result.permissionBoundary).toContain('Per-employee')
    expect(result).not.toHaveProperty('credentialFile')
    expect(deps.writeSecret).not.toHaveBeenCalled()
    expect(database.prepare('SELECT token_sha256 FROM integration_clients').get().token_sha256).toBeNull()
  })

  it('preserves a revoked OAuth grant and creates a separate replacement', async () => {
    const { database, deps } = harness()
    const input = { ...options, authType: 'access_oauth', secretOutput: undefined }
    const first = await createIntegrationClient(input, deps)
    await revokeIntegrationClient({ confirm: true, clientId: first.client.clientId }, deps)
    const second = await createIntegrationClient(input, deps)
    expect(second.client.clientId).not.toBe(first.client.clientId)
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_clients WHERE auth_type='access_oauth'").get().count).toBe(2)
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_clients WHERE auth_type='access_oauth' AND revoked_at IS NULL").get().count).toBe(1)
  })

  it('never disables an existing grant on a client ID collision', async () => {
    const { database, deps } = harness()
    const first = await createIntegrationClient(options, deps)
    await expect(createIntegrationClient(options, { ...deps, random: (size) => size === 16 ? Buffer.from(first.client.clientId, 'hex') : randomBytes(size) })).rejects.toHaveProperty('code', 'RANDOM_CLIENT_ID_COLLISION')
    expect(database.prepare('SELECT enabled,revoked_at FROM integration_clients WHERE client_id=?').get(first.client.clientId)).toMatchObject({ enabled: 1, revoked_at: null })
  })

  it.each([
    { confirm: false }, { ownerUserId: undefined }, { scopes: [] }, { scopes: ['private.read'] }, { scopes: ['inventory.read', 'inventory.read'] },
    { stores: ['*'] }, { stores: ['Detroit'] }, { days: 91 }, { days: 0 }, { days: undefined }, { days: undefined, expiresAt: '2026-02-30T19:00:00Z' },
    { expiresAt: '2026-10-01T19:00:00Z' }, { secretOutput: undefined }, { authType: 'service' }, { rateLimitPerMinute: 601 },
  ])('rejects missing explicit scope/owner/expiry/confirmation and invalid options before any DB call', async (override) => {
    const { deps, calls } = harness()
    await expect(createIntegrationClient({ ...options, ...override }, deps)).rejects.toHaveProperty('code')
    expect(calls).toHaveLength(0)
  })

  it('accepts a canonical UTC expiry or a bounded days value, never defaults to indefinite', () => {
    expect(validateCreateOptions({ ...options, days: undefined, expiresAt: '2026-10-01T19:00:00Z' }, instant).expiresAt).toBe('2026-10-01T19:00:00.000Z')
    expect(() => validateCreateOptions({ ...options, days: undefined, expiresAt: '2026-09-09T19:00:00Z' }, instant)).toThrow('EXPIRY_MUST_BE_WITHIN_90_DAYS')
  })

  it.each(["enabled=0", "role='driver'", "home_store='Unknown'"])('requires an existing enabled permitted owner: %s', async (assignment) => {
    const { database, deps } = harness()
    database.exec(`UPDATE cloud_memberships SET ${assignment}`)
    await expect(createIntegrationClient(options, deps)).rejects.toHaveProperty('code', 'OWNER_NOT_AUTHORIZED')
    expect(database.prepare('SELECT COUNT(*) AS count FROM integration_clients').get().count).toBe(0)
    expect(deps.writeSecret).not.toHaveBeenCalled()
  })

  it('does not create files when disabled-reservation storage fails', async () => {
    const { deps, db } = harness()
    const broken = { ...deps, db: { async query(sql, params) { if (sql.startsWith('INSERT')) throw new Error('private Cloudflare details'); return db.query(sql, params) } } }
    await expect(createIntegrationClient(options, broken)).rejects.toMatchObject({ code: 'CLIENT_CREATION_FAILED_CLEANED_UP', cleanupComplete: true })
    expect(deps.writeSecret).not.toHaveBeenCalled()
  })

  it('revokes the disabled reservation when credential writing fails without logging the error', async () => {
    const { database, deps } = harness()
    await expect(createIntegrationClient(options, { ...deps, writeSecret: async () => { throw new Error('sensitive filesystem context') } })).rejects.toMatchObject({ code: 'CLIENT_CREATION_FAILED_CLEANED_UP' })
    expect(database.prepare('SELECT enabled,revoked_at FROM integration_clients').get()).toMatchObject({ enabled: 0, revoked_at: '2026-09-09T19:00:00.000Z' })
  })

  it('rechecks membership before activation and rolls back only its own newly written file', async () => {
    const { database, deps, secret } = harness()
    const writer = deps.writeSecret
    await expect(createIntegrationClient(options, { ...deps, writeSecret: async (...args) => { const file = await writer(...args); database.exec('UPDATE cloud_memberships SET enabled=0'); return file } })).rejects.toMatchObject({ code: 'CLIENT_CREATION_FAILED_CLEANED_UP' })
    expect(secret.rolledBack).toBe(true)
    expect(database.prepare('SELECT enabled FROM integration_clients').get().enabled).toBe(0)
  })

  it('revokes a remotely committed activation if its response was lost', async () => {
    const { database, deps, db, secret } = harness()
    const failing = { async query(sql, params) { const result = await db.query(sql, params); if (sql.startsWith('UPDATE integration_clients SET enabled=1')) throw new Error('lost response'); return result } }
    await expect(createIntegrationClient(options, { ...deps, db: failing })).rejects.toMatchObject({ code: 'CLIENT_CREATION_FAILED_CLEANED_UP' })
    expect(secret.rolledBack).toBe(true)
    expect(database.prepare('SELECT enabled,revoked_at FROM integration_clients').get()).toMatchObject({ enabled: 0, revoked_at: '2026-09-09T19:00:00.000Z' })
  })

  it('reports unresolved revocation without leaking credentials when cleanup cannot be confirmed', async () => {
    const { deps, db, secret } = harness()
    const failing = { async query(sql, params) { if (sql.startsWith('UPDATE')) throw new Error('secret SQL response'); return db.query(sql, params) } }
    const error = await createIntegrationClient(options, { ...deps, db: failing }).catch((value) => value)
    expect(error).toMatchObject({ code: 'CLIENT_CREATION_REQUIRES_REVIEW', cleanupComplete: false })
    expect(error.clientId).toMatch(/^[a-f0-9]{32}$/)
    expect(error.message).not.toContain(secret.value.token)
    expect(secret.rolledBack).toBe(true)
  })

  it('lists only sanitized metadata and revokes only the exact requested grant, idempotently', async () => {
    const { deps, db, secret } = harness()
    const first = await createIntegrationClient(options, deps)
    const firstToken = secret.value.token
    const second = await createIntegrationClient({ ...options, label: 'Second synthetic app', secretOutput: 'runtime/integration-credentials/second.json' }, deps)
    const list = await listIntegrationClients({}, { db })
    expect(list.clients).toHaveLength(2)
    expect(JSON.stringify(list)).not.toMatch(/token_sha256|name|email/)
    expect(JSON.stringify(list)).not.toContain(firstToken)
    const revoked = await revokeIntegrationClient({ confirm: true, clientId: first.client.clientId }, deps)
    expect(revoked.client.enabled).toBe(false)
    expect((await revokeIntegrationClient({ confirm: true, clientId: first.client.clientId }, deps)).client.revokedAt).toBe(revoked.client.revokedAt)
    expect((await listIntegrationClients({}, { db })).clients.find((item) => item.clientId === second.client.clientId).enabled).toBe(true)
    await expect(revokeIntegrationClient({ confirm: false, clientId: second.client.clientId }, deps)).rejects.toHaveProperty('code', 'CONFIRMATION_REQUIRED')
    await expect(revokeIntegrationClient({ confirm: true, clientId: '*' }, deps)).rejects.toHaveProperty('code', 'EXACT_CLIENT_ID_REQUIRED')
  })
})

describe('private credential file handling', () => {
  const fileBehaviorOptions = { checkIgnore: false, protectWindows: () => {} }

  it('restricts output to one explicitly named ignored private JSON file', () => {
    const root = fileFixture()
    // The target is anchored to the app root's real location (macOS resolves
    // its temp directory through /var -> /private/var), so compare to that.
    expect(secureCredentialPath(options.secretOutput, root).target).toBe(path.join(realpathSync(root), options.secretOutput))
    for (const output of ['credential.json', '../secret.json', 'runtime/secret.json', 'runtime/integration-credentials/../secret.json', 'runtime/integration-credentials/nested/secret.json', 'runtime/integration-credentials/CON.json']) {
      expect(() => secureCredentialPath(output, root)).toThrow('SECRET_OUTPUT_OUTSIDE_PRIVATE_DIRECTORY')
    }
    writeFileSync(path.join(root, '.gitignore'), '', 'utf8')
    expect(() => secureCredentialPath(options.secretOutput, root)).toThrow('PRIVATE_DIRECTORY_MUST_BE_GIT_IGNORED')
  })

  it('writes exclusively, never overwrites, and refuses to remove edited files on rollback', () => {
    const root = fileFixture()
    const value = { token: `iflow_${randomBytes(16).toString('hex')}_${randomBytes(32).toString('base64url')}` }
    const first = writePrivateIntegrationCredential(options.secretOutput, value, { appRoot: root, ...fileBehaviorOptions })
    expect(JSON.parse(readFileSync(first.path, 'utf8'))).toEqual(value)
    if (process.platform !== 'win32') expect(statSync(first.path).mode & 0o777).toBe(0o600)
    expect(() => writePrivateIntegrationCredential(options.secretOutput, { token: 'synthetic replacement' }, { appRoot: root, ...fileBehaviorOptions })).toThrow('SECRET_WRITE_FAILED')
    expect(JSON.parse(readFileSync(first.path, 'utf8'))).toEqual(value)
    writeFileSync(first.path, 'user changed this file', 'utf8')
    expect(first.rollback()).toBe(false)
    expect(existsSync(first.path)).toBe(true)
  })

  it('removes only the exact unmodified credential file it created', () => {
    const root = fileFixture()
    const file = writePrivateIntegrationCredential(options.secretOutput, { token: 'synthetic-test-only' }, { appRoot: root, ...fileBehaviorOptions })
    const neighbor = path.join(path.dirname(file.path), 'keep.json')
    writeFileSync(neighbor, 'existing user data', 'utf8')
    const second = writePrivateIntegrationCredential('runtime/integration-credentials/second.json', { token: 'another-synthetic-test-only' }, { appRoot: root, ...fileBehaviorOptions })
    expect(existsSync(second.path)).toBe(true)
    expect(second.rollback()).toBe(true)
    expect(file.rollback()).toBe(true)
    expect(existsSync(file.path)).toBe(false)
    expect(readFileSync(neighbor, 'utf8')).toBe('existing user data')
  })

  it('does not write any secret until Windows owner-only protection succeeds', () => {
    const root = fileFixture()
    const protectWindows = vi.fn(() => { throw new Error('ACL unavailable') })
    expect(() => writePrivateIntegrationCredential(options.secretOutput, { token: 'synthetic-test-only' }, { appRoot: root, checkIgnore: false, platform: 'win32', protectWindows })).toThrow('SECRET_DIRECTORY_UNAVAILABLE')
    expect(protectWindows).toHaveBeenCalledOnce()
    expect(existsSync(path.join(root, options.secretOutput))).toBe(false)
  })
})

describe('owner-run CLI and bounded Cloudflare adapter', () => {
  it('parses only allowed explicit arguments and never accepts a token option', () => {
    const parsed = parseManagementArguments(['create', '--confirm', '--type', 'api_token', '--owner-user-id', 'synthetic-owner', '--label', 'Synthetic app', '--scopes', 'inventory.read,health.read', '--stores', 'Howell,Ford Detroit', '--days', '30', '--secret-output', options.secretOutput])
    expect(parsed.options).toMatchObject({ confirm: true, days: 30, stores: ['Howell', 'Ford Detroit'] })
    expect(() => parseManagementArguments(['create', '--token', 'do not accept credentials in arguments'])).toThrow('UNKNOWN_OPTION')
    expect(() => parseManagementArguments(['revoke', '--owner-user-id', 'synthetic-owner'])).toThrow('OPTION_NOT_VALID_FOR_COMMAND')
    expect(() => parseManagementArguments(['create', '--confirm', '--confirm'])).toThrow('DUPLICATE_OPTION')
  })

  it('uses only admin environment credentials, redirects disabled, bound params and bounded response parsing', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_D1_DATABASE_ID: '11111111-2222-3333-4444-555555555555', CLOUDFLARE_API_TOKEN: 'synthetic-admin-only-credential' }
    const fetcher = vi.fn(async (_url, request) => {
      expect(request.redirect).toBe('error')
      expect(request.headers.Authorization).toBe(`Bearer ${env.CLOUDFLARE_API_TOKEN}`)
      expect(JSON.parse(request.body)).toEqual({ sql: 'SELECT user_id FROM cloud_memberships WHERE user_id=?', params: ['synthetic-owner'] })
      return Response.json({ success: true, result: [{ success: true, results: [{ user_id: 'synthetic-owner' }] }] })
    })
    expect(await cloudflareIntegrationDatabase(env, fetcher).query('SELECT user_id FROM cloud_memberships WHERE user_id=?', ['synthetic-owner'])).toEqual([{ user_id: 'synthetic-owner' }])
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_D1_DATABASE_ID}/query`)
    for (const response of [Response.json({ success: false, errors: [{ message: 'private error' }] }), new Response('private error', { status: 403 }), new Response('x'.repeat(1048577)), Response.json({ success: true, result: [{ success: false, results: [] }] })]) {
      await expect(cloudflareIntegrationDatabase(env, async () => response).query('SELECT 1')).rejects.toHaveProperty('code', 'CLOUDFLARE_QUERY_FAILED')
    }
    expect(() => cloudflareIntegrationDatabase({ ...env, CLOUDFLARE_API_TOKEN: undefined }, fetcher)).toThrow('CLOUDFLARE_ADMIN_ENV_NOT_CONFIGURED')
  })
})

describe('bounded Wrangler managed-login transport', () => {
  it('keeps API transport the default and permits only the explicit Wrangler alternative', () => {
    expect(parseManagementArguments(['list']).options.transport).toBeUndefined()
    expect(parseManagementArguments(['list', '--transport', 'wrangler']).options.transport).toBe('wrangler')
    expect(parseManagementArguments(['list', '--transport', 'api']).options.transport).toBe('api')
    expect(() => parseManagementArguments(['list', '--transport', 'shell'])).toThrow('INVALID_TRANSPORT')
    expect(() => parseManagementArguments(['list', '--database', 'other'])).toThrow('UNKNOWN_OPTION')
    expect(() => parseManagementArguments(['list', '--config', 'other'])).toThrow('UNKNOWN_OPTION')
  })

  it('binds SQLite literals, embedded quotes, literal question marks, numeric values and NULL safely', () => {
    const database = new DatabaseSync(':memory:'); databases.push(database)
    const value = "Joe's ?; DROP TABLE integration_clients; --"
    const command = bindWranglerQuery("SELECT ? AS label, '?' AS literal, ? AS missing, ? AS rate, ? AS scopes", [value, null, 60, '["inventory.read"]'])
    expect(database.prepare(command).get()).toEqual({ label: value, literal: '?', missing: null, rate: 60, scopes: '["inventory.read"]' })
    expect(bindWranglerQuery('SELECT "?", `?`, [?], ?', ['value'])).toBe('SELECT "?", `?`, [?], \'value\'')
  })

  it.each([
    ['SELECT ?', []], ['SELECT 1', ['unused']], ["SELECT 'unterminated", []], ['SELECT ?1', ['named']],
    ['SELECT 1; SELECT 2', []], ['SELECT 1 -- comment', []], ['SELECT 1 /*comment*/', []], ['DELETE FROM integration_clients', []],
    ['SELECT ?', [Infinity]], ['SELECT ?', [undefined]], ['SELECT ?', ['bad\0value']],
  ])('rejects ambiguous or unbounded statements before spawning: %s', (sql, params) => {
    const run = vi.fn()
    return expect(wranglerIntegrationDatabase({ run }).query(sql, params)).rejects.toHaveProperty('code').then(() => expect(run).not.toHaveBeenCalled())
  })

  it('rejects raw API/OAuth credentials from process arguments', async () => {
    const run = vi.fn()
    const apiToken = `iflow_${'a'.repeat(32)}_${'b'.repeat(43)}`
    for (const token of [apiToken, 'oauth:synthetic-opaque-secret']) {
      await expect(wranglerIntegrationDatabase({ run }).query('SELECT ?', [token])).rejects.toHaveProperty('code', 'RAW_CREDENTIAL_QUERY_REJECTED')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('executes bundled Wrangler without a shell and only the fixed configured production database', async () => {
    const run = vi.fn((_node, _args, settings) => {
      expect(settings).toMatchObject({ shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] })
      return { status: 0, stdout: JSON.stringify([{ success: true, results: [{ user_id: 'synthetic-owner' }] }]), stderr: '' }
    })
    const result = await wranglerIntegrationDatabase({ run }).query('SELECT user_id FROM cloud_memberships WHERE user_id=?', ['synthetic-owner'])
    expect(result).toEqual([{ user_id: 'synthetic-owner' }])
    const [executable, args] = run.mock.calls[0]
    expect(executable).toBe(process.execPath)
    expect(args[0].replaceAll('\\', '/')).toMatch(/\/wrangler\/bin\/wrangler\.js$/)
    expect(args.slice(1, 6)).toEqual(['d1', 'execute', 'inventory-ops-production', '--remote', '--config'])
    expect(args[6].replaceAll('\\', '/')).toMatch(/\/cloudflare\/integrations\.wrangler\.jsonc$/)
    expect(args.slice(7)).toEqual(['--json', '--command', "SELECT user_id FROM cloud_memberships WHERE user_id='synthetic-owner'"])
  })

  it('fails closed on config drift and never exposes Wrangler errors or raw output', async () => {
    const run = vi.fn()
    expect(() => wranglerIntegrationDatabase({ run, readConfig: () => JSON.stringify({ name: 'other', d1_databases: [] }) })).toThrow('WRANGLER_TARGET_NOT_CONFIGURED')
    expect(run).not.toHaveBeenCalled()
    for (const response of [
      { status: 1, stdout: '', stderr: 'sensitive OAuth details' },
      { status: null, error: new Error('private failed process arguments'), stdout: '', stderr: '' },
      { status: 0, signal: 'SIGTERM', stdout: '[]' },
      { status: 0, stdout: 'private response' },
      { status: 0, stdout: 'x'.repeat(1048577) },
      { status: 0, stdout: JSON.stringify([{ success: false, results: [] }]) },
      { status: 0, stdout: JSON.stringify([{ success: true, results: [] }, { success: true, results: [] }]) },
    ]) {
      const error = await wranglerIntegrationDatabase({ run: () => response }).query('SELECT 1').catch((failure) => failure)
      expect(error.code).toBe('WRANGLER_QUERY_FAILED')
      expect(error.message).toBe('WRANGLER_QUERY_FAILED')
    }
  })

  it('runs complete API and OAuth provisioning through safely bound synthetic SQLite commands', async () => {
    const { database, deps, secret } = harness()
    const commands = []
    const run = vi.fn((_executable, args) => {
      const command = args.at(-1); commands.push(command)
      return { status: 0, stdout: JSON.stringify([{ success: true, results: database.prepare(command).all() }]) }
    })
    const transport = wranglerIntegrationDatabase({ run })
    const first = await createIntegrationClient({ ...options, label: "Joe's read-only app" }, { ...deps, db: transport })
    expect(first.client.label).toBe("Joe's read-only app")
    expect(commands.join('\n')).not.toContain(secret.value.token)
    expect(database.prepare('SELECT token_sha256 FROM integration_clients').get().token_sha256).toBe(await hashIntegrationToken(secret.value.token))
    const oauth = await createIntegrationClient({ ...options, authType: 'access_oauth', secretOutput: undefined }, { ...deps, db: transport })
    expect(oauth.client.enabled).toBe(true)
    expect(database.prepare('SELECT token_sha256 FROM integration_clients WHERE client_id=?').get(oauth.client.clientId).token_sha256).toBeNull()
    expect((await revokeIntegrationClient({ confirm: true, clientId: first.client.clientId }, { ...deps, db: transport })).client.enabled).toBe(false)
  })
})
