// Owner-run administration only. This script is never part of the public API.
// Run through cloud-secret-store.ps1 -Mode Run; credentials stay in process env.
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, chmodSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { INTEGRATION_SCOPES, INTEGRATION_STORES, hashIntegrationToken } from '../cloudflare/src/integration-access.mjs'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const ROLES = ['sales', 'manager', 'group_manager']
const DAY_MS = 86400000
const sha = (value) => createHash('sha256').update(value).digest('hex')

export class IntegrationManagementError extends Error {
  constructor(code, { clientId, cleanupComplete } = {}) {
    super(code)
    this.code = code
    if (clientId) this.clientId = clientId
    if (cleanupComplete !== undefined) this.cleanupComplete = cleanupComplete
  }
}

function assert(condition, code) { if (!condition) throw new IntegrationManagementError(code) }
function text(value, maximum = 160) { return typeof value === 'string' && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) }
function exactId(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) }
function nowMs(now) {
  const value = now instanceof Date ? now.getTime() : now
  assert(Number.isSafeInteger(value) && value > 0, 'INVALID_CLOCK')
  return value
}
function allowedList(values, allowlist, code) {
  assert(Array.isArray(values) && values.length > 0 && values.length <= allowlist.length && new Set(values).size === values.length && values.every((item) => allowlist.includes(item)), code)
  return [...values]
}
function parsedList(raw) { try { const list = JSON.parse(raw); return Array.isArray(list) ? list : [] } catch { return [] } }

export function validateCreateOptions(options, now = Date.now()) {
  const instant = nowMs(now)
  assert(options.confirm === true, 'CONFIRMATION_REQUIRED')
  assert(['api_token', 'access_oauth'].includes(options.authType), 'EXACT_AUTH_TYPE_REQUIRED')
  assert(text(options.ownerUserId), 'EXACT_OWNER_REQUIRED')
  assert(text(options.label, 100), 'LABEL_REQUIRED')
  const scopes = allowedList(options.scopes, INTEGRATION_SCOPES, 'INVALID_SCOPES')
  const stores = allowedList(options.stores, INTEGRATION_STORES, 'INVALID_STORES')
  assert((options.expiresAt !== undefined) !== (options.days !== undefined), 'EXPLICIT_EXPIRY_REQUIRED')
  let expires
  if (options.days !== undefined) {
    assert(Number.isInteger(options.days) && options.days >= 1 && options.days <= 90, 'EXPIRY_MUST_BE_WITHIN_90_DAYS')
    expires = instant + options.days * DAY_MS
  } else {
    assert(typeof options.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.expiresAt), 'UTC_EXPIRY_REQUIRED')
    expires = Date.parse(options.expiresAt)
    assert(Number.isFinite(expires), 'UTC_EXPIRY_REQUIRED')
    const canonical = new Date(expires).toISOString()
    assert(canonical === options.expiresAt || canonical.replace('.000Z', 'Z') === options.expiresAt, 'UTC_EXPIRY_REQUIRED')
    assert(expires > instant && expires <= instant + 90 * DAY_MS, 'EXPIRY_MUST_BE_WITHIN_90_DAYS')
  }
  const rateLimit = options.rateLimitPerMinute ?? 60
  assert(Number.isInteger(rateLimit) && rateLimit >= 1 && rateLimit <= 600, 'INVALID_RATE_LIMIT')
  if (options.authType === 'api_token') assert(text(options.secretOutput, 1024), 'EXPLICIT_SECRET_OUTPUT_REQUIRED')
  else assert(options.secretOutput === undefined, 'OAUTH_HAS_NO_LOCAL_SECRET')
  return { ...options, scopes, stores, rateLimitPerMinute: rateLimit, expiresAt: new Date(expires).toISOString(), createdAt: new Date(instant).toISOString() }
}

const MEMBER_QUERY = 'SELECT user_id, role, home_store, enabled FROM cloud_memberships WHERE user_id = ?'
const CLIENT_FIELDS = 'client_id,label,auth_type,owner_user_id,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,revoked_at,created_at,updated_at'

function safeMetadata(row) {
  const scopes = parsedList(row.scopes_json), stores = parsedList(row.stores_json)
  return {
    clientId: row.client_id,
    label: text(row.label, 100) ? row.label : 'Invalid label',
    authType: row.auth_type,
    ownerUserId: row.owner_user_id,
    scopes: scopes.filter((item) => INTEGRATION_SCOPES.includes(item)),
    stores: stores.filter((item) => INTEGRATION_STORES.includes(item)),
    rateLimitPerMinute: row.rate_limit_per_minute,
    enabled: row.enabled === 1,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listIntegrationClients(options = {}, { db }) {
  const limit = options.limit ?? 100
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'INVALID_LIMIT')
  assert(options.ownerUserId === undefined || text(options.ownerUserId), 'EXACT_OWNER_REQUIRED')
  const where = options.ownerUserId ? ' WHERE owner_user_id = ?' : ''
  try {
    const rows = await db.query(`SELECT ${CLIENT_FIELDS} FROM integration_clients${where} ORDER BY created_at DESC,client_id LIMIT ?`, [...(options.ownerUserId ? [options.ownerUserId] : []), limit + 1])
    assert(Array.isArray(rows), 'DATABASE_RESPONSE_INVALID')
    return { clients: rows.slice(0, limit).map(safeMetadata), hasMore: rows.length > limit }
  } catch (error) {
    if (error instanceof IntegrationManagementError) throw error
    throw new IntegrationManagementError('CLIENT_LIST_FAILED')
  }
}

export async function createIntegrationClient(input, { db, writeSecret, now = () => Date.now(), random = randomBytes }) {
  const options = validateCreateOptions(input, nowMs(now()))
  let owner
  try { [owner] = await db.query(MEMBER_QUERY, [options.ownerUserId]) } catch { throw new IntegrationManagementError('OWNER_LOOKUP_FAILED') }
  assert(owner?.enabled === 1 && ROLES.includes(owner.role) && INTEGRATION_STORES.includes(owner.home_store), 'OWNER_NOT_AUTHORIZED')
  const clientId = random(16).toString('hex')
  assert(exactId(clientId), 'RANDOM_GENERATOR_FAILED')
  let collision
  try { collision = await db.query('SELECT client_id FROM integration_clients WHERE client_id=?', [clientId]) } catch { throw new IntegrationManagementError('CLIENT_ID_CHECK_FAILED') }
  assert(collision.length === 0, 'RANDOM_CLIENT_ID_COLLISION')
  let token = options.authType === 'api_token' ? `iflow_${clientId}_${random(32).toString('base64url')}` : null
  const digest = token ? await hashIntegrationToken(token) : null
  let credentialFile, activated = false
  try {
    // Reserve DISABLED first. Even an uncertain insert cannot create a usable key.
    const reserved = await db.query(`INSERT INTO integration_clients (client_id,label,auth_type,owner_user_id,token_sha256,scopes_json,stores_json,rate_limit_per_minute,enabled,expires_at,created_at,updated_at)
      SELECT ?,?,?,?,NULLIF(?,''),?,?,?,0,?,?,? WHERE EXISTS (SELECT 1 FROM cloud_memberships WHERE user_id=? AND enabled=1 AND role IN ('sales','manager','group_manager')) RETURNING client_id`,
    [clientId, options.label, options.authType, options.ownerUserId, digest ?? '', JSON.stringify(options.scopes), JSON.stringify(options.stores), options.rateLimitPerMinute, options.expiresAt, options.createdAt, options.createdAt, options.ownerUserId])
    assert(reserved?.length === 1 && reserved[0].client_id === clientId, 'OWNER_NOT_AUTHORIZED')

    if (token) {
      assert(typeof writeSecret === 'function', 'SECRET_WRITER_REQUIRED')
      credentialFile = await writeSecret(options.secretOutput, { clientId, label: options.label, token, scopes: options.scopes, stores: options.stores, expiresAt: options.expiresAt })
      assert(credentialFile && typeof credentialFile.path === 'string' && typeof credentialFile.rollback === 'function', 'SECRET_WRITE_FAILED')
    }
    // Recheck employee membership immediately before activating the grant.
    const activationAt = new Date(nowMs(now())).toISOString()
    assert(Date.parse(options.expiresAt) > Date.parse(activationAt), 'GRANT_EXPIRED_DURING_CREATION')
    const rows = await db.query(`UPDATE integration_clients SET enabled=1,updated_at=? WHERE client_id=? AND enabled=0 AND revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM cloud_memberships WHERE user_id=integration_clients.owner_user_id AND enabled=1 AND role IN ('sales','manager','group_manager')) RETURNING ${CLIENT_FIELDS}`, [activationAt, clientId])
    assert(rows?.length === 1 && rows[0].client_id === clientId && rows[0].enabled === 1, 'GRANT_ACTIVATION_FAILED')
    activated = true
    return { created: true, client: safeMetadata(rows[0]), ...(credentialFile ? { credentialFile: credentialFile.path } : {}), ...(options.authType === 'access_oauth' ? { permissionBoundary: 'Per-employee Managed OAuth grant shared by that employee\'s approved OAuth clients; not per-AI-client permissions.' } : {}) }
  } catch {
    let revoked = false, fileRemoved = !credentialFile
    try {
      const timestamp = new Date(nowMs(now())).toISOString()
      await db.query("UPDATE integration_clients SET enabled=0,revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE client_id=? AND owner_user_id=? AND auth_type=? AND token_sha256 IS NULLIF(?,'') AND created_at=? RETURNING client_id", [timestamp, timestamp, clientId, options.ownerUserId, options.authType, digest ?? '', options.createdAt])
      revoked = true
    } catch { /* Report uncertainty without printing database errors or secret values. */ }
    if (credentialFile) {
      try { fileRemoved = await credentialFile.rollback() === true } catch { fileRemoved = false }
    }
    throw new IntegrationManagementError(revoked && fileRemoved ? 'CLIENT_CREATION_FAILED_CLEANED_UP' : 'CLIENT_CREATION_REQUIRES_REVIEW', { clientId, cleanupComplete: revoked && fileRemoved })
  } finally {
    token = null
    // Successful credentials remain only in the explicitly selected private file.
    if (!activated) credentialFile = null
  }
}

export async function revokeIntegrationClient(options, { db, now = () => Date.now() }) {
  assert(options.confirm === true, 'CONFIRMATION_REQUIRED')
  assert(exactId(options.clientId), 'EXACT_CLIENT_ID_REQUIRED')
  const timestamp = new Date(nowMs(now())).toISOString()
  try {
    const rows = await db.query(`UPDATE integration_clients SET enabled=0,revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE client_id=? RETURNING ${CLIENT_FIELDS}`, [timestamp, timestamp, options.clientId])
    assert(rows?.length === 1 && rows[0].client_id === options.clientId, 'CLIENT_NOT_FOUND')
    return { revoked: true, client: safeMetadata(rows[0]) }
  } catch (error) {
    if (error instanceof IntegrationManagementError) throw error
    throw new IntegrationManagementError('REVOCATION_NOT_CONFIRMED', { clientId: options.clientId })
  }
}

export function secureCredentialPath(output, appRoot = APP_ROOT) {
  assert(text(output, 1024), 'EXPLICIT_SECRET_OUTPUT_REQUIRED')
  const root = realpathSync(appRoot)
  const directory = path.join(root, 'runtime', 'integration-credentials')
  const target = path.resolve(root, output)
  assert(path.dirname(target) === directory && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.json$/.test(path.basename(target)) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(path.basename(target)), 'SECRET_OUTPUT_OUTSIDE_PRIVATE_DIRECTORY')
  const ignores = readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)
  assert(ignores.includes('runtime/'), 'PRIVATE_DIRECTORY_MUST_BE_GIT_IGNORED')
  for (const candidate of [path.join(root, 'runtime'), directory]) {
    if (existsSync(candidate)) assert(lstatSync(candidate).isDirectory() && !lstatSync(candidate).isSymbolicLink() && realpathSync(candidate) === candidate, 'PRIVATE_DIRECTORY_LINK_REJECTED')
  }
  return { root, directory, target }
}

function protectWindowsDirectory(directory) {
  const script = `$ErrorActionPreference='Stop'; $p=$env:INTEGRATION_PRIVATE_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $p; if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {throw 'Directory owner differs'}; $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); $private=$acl.AreAccessRulesProtected -and $rules.Count -gt 0; $inheritedFull=$false; foreach ($entry in $rules) {if ($entry.IdentityReference.Value -ne $sid.Value -or $entry.AccessControlType -ne 'Allow') {$private=$false}; if (($entry.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and ($entry.InheritanceFlags -band 3) -eq 3) {$inheritedFull=$true}}; if ($private -and $inheritedFull) {exit 0}; $acl.SetAccessRuleProtection($true,$false); foreach ($entry in $acl.GetAccessRules($true,$false,[System.Security.Principal.SecurityIdentifier])) {[void]$acl.RemoveAccessRuleAll($entry)}; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.SetAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl; $check=Get-Acl -LiteralPath $p; if (-not $check.AreAccessRulesProtected) {throw 'ACL protection failed'}; foreach ($entry in $check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {if ($entry.IdentityReference.Value -ne $sid.Value -or $entry.AccessControlType -ne 'Allow') {throw 'Owner-only ACL verification failed'}}`
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, INTEGRATION_PRIVATE_DIRECTORY: directory }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, timeout: 15000 })
}

/** Exclusive create inside an owner-only directory; never overwrites any file. */
export function writePrivateIntegrationCredential(output, value, { appRoot = APP_ROOT, platform = process.platform, protectWindows = protectWindowsDirectory, checkIgnore = true } = {}) {
  const { root, directory, target } = secureCredentialPath(output, appRoot)
  assert(!existsSync(target), 'SECRET_WRITE_FAILED')
  if (checkIgnore) {
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', path.relative(root, target)], { cwd: root, windowsHide: true, stdio: 'ignore' })
    assert(ignored.status === 0, 'PRIVATE_DIRECTORY_MUST_BE_GIT_IGNORED')
  }
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    secureCredentialPath(output, appRoot)
    if (platform === 'win32') protectWindows(directory)
    else chmodSync(directory, 0o700)
  } catch { throw new IntegrationManagementError('SECRET_DIRECTORY_UNAVAILABLE') }
  const content = `${JSON.stringify(value, null, 2)}\n`
  const digest = sha(content)
  let descriptor, createdIdentity
  const rollback = () => {
    if (!createdIdentity || !existsSync(target)) return !existsSync(target)
    const current = lstatSync(target)
    // Refuse to remove a substituted link, another inode, or changed contents.
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== createdIdentity.ino || current.dev !== createdIdentity.dev || current.size > 65536 || sha(readFileSync(target)) !== digest) return false
    unlinkSync(target)
    return true
  }
  try {
    descriptor = openSync(target, 'wx', 0o600)
    createdIdentity = fstatSync(descriptor)
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    if (platform !== 'win32') assert((lstatSync(target).mode & 0o777) === 0o600, 'SECRET_PERMISSIONS_INVALID')
    return { path: target, rollback }
  } catch {
    if (descriptor !== undefined) closeSync(descriptor)
    // A partial write contains no user data; remove only the inode we just created.
    if (createdIdentity && existsSync(target)) {
      const current = lstatSync(target)
      if (current.isFile() && !current.isSymbolicLink() && current.ino === createdIdentity.ino && current.dev === createdIdentity.dev) unlinkSync(target)
    }
    throw new IntegrationManagementError('SECRET_WRITE_FAILED')
  }
}

/** Cloudflare admin token comes exclusively from the existing secure env wrapper. */
export function cloudflareIntegrationDatabase(env = process.env, fetcher = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID, database = env.CLOUDFLARE_D1_DATABASE_ID, credential = env.CLOUDFLARE_API_TOKEN
  assert(typeof account === 'string' && /^[a-f0-9]{32}$/.test(account) && typeof database === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(database) && typeof credential === 'string' && credential.length >= 20, 'CLOUDFLARE_ADMIN_ENV_NOT_CONFIGURED')
  return {
    async query(sql, params = []) {
      try {
        // The documented administrative API accepts string parameters. Numeric
        // limits are validated above; SQL converts them in their numeric context.
        assert(Array.isArray(params) && params.every((value) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)), 'INVALID_QUERY_PARAMETERS')
        const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params: params.map(String) }) })
        if (!response.ok || Number(response.headers.get('content-length')) > 1048576) throw new Error('Remote query failed')
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Remote query failed')
        let received = 0
        const chunks = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > 1048576) { await reader.cancel(); throw new Error('Remote query failed') }
          chunks.push(value)
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (payload?.success !== true || !Array.isArray(payload.result) || payload.result.length !== 1 || payload.result[0]?.success !== true || !Array.isArray(payload.result[0].results)) throw new Error('Remote query failed')
        return payload.result[0].results
      } catch { throw new IntegrationManagementError('CLOUDFLARE_QUERY_FAILED') }
    },
  }
}

/** Wrangler has no parameter flag; quote SQLite values, never interpolate raw input. */
export function bindWranglerQuery(sql, params = []) {
  assert(typeof sql === 'string' && sql.length > 0 && sql.length <= 16384 && /^(?:SELECT|INSERT|UPDATE)\b/i.test(sql.trim()) && !sql.includes('\0'), 'INVALID_WRANGLER_QUERY')
  assert(Array.isArray(params) && params.length <= 32, 'INVALID_QUERY_PARAMETERS')
  const literal = (value) => {
    if (value === null) return 'NULL'
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    assert(typeof value === 'string' && value.length <= 16384 && !value.includes('\0'), 'INVALID_QUERY_PARAMETERS')
    return `'${value.replaceAll("'", "''")}'`
  }
  const values = params.map(literal)
  let result = '', quoted = '', bound = 0
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index], next = sql[index + 1]
    if (quoted) {
      result += char
      if (char === quoted) {
        if (next === quoted && quoted !== ']') { result += next; index++ }
        else quoted = ''
      }
      continue
    }
    if (["'", '"', '`', '['].includes(char)) { quoted = char === '[' ? ']' : char; result += char; continue }
    // This owner-only adapter executes exactly one internal statement.
    assert(char !== ';' && !(char === '-' && next === '-') && !(char === '/' && next === '*'), 'INVALID_WRANGLER_QUERY')
    if (char === '?') {
      assert(!/[0-9]/.test(next ?? '') && bound < values.length, 'INVALID_QUERY_PARAMETERS')
      result += values[bound++]
    } else result += char
  }
  assert(!quoted && bound === values.length, 'INVALID_QUERY_PARAMETERS')
  // Only grant metadata and one-way digests may cross process arguments.
  assert(!/iflow_[a-f0-9]{32}_[A-Za-z0-9_-]{43}|oauth:/i.test(result), 'RAW_CREDENTIAL_QUERY_REJECTED')
  return result
}

/** Uses Wrangler's managed login without reading its stored OAuth credentials. */
export function wranglerIntegrationDatabase({ run = spawnSync, readConfig = readFileSync } = {}) {
  const configPath = path.join(APP_ROOT, 'cloudflare', 'integrations.wrangler.jsonc')
  let wranglerBin
  try {
    const config = JSON.parse(readConfig(configPath, 'utf8'))
    const databases = config.d1_databases
    assert(config.name === 'inventory-flow-integrations' && Array.isArray(databases) && databases.length === 1 && databases[0].binding === 'INVENTORY_DB' && databases[0].database_name === 'inventory-ops-production' && databases[0].database_id === '29bfd3dd-ecd9-4c71-9dba-f0c106c690dd', 'WRANGLER_TARGET_NOT_CONFIGURED')
    wranglerBin = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js')
    assert(existsSync(wranglerBin), 'WRANGLER_NOT_INSTALLED')
  } catch { throw new IntegrationManagementError('WRANGLER_TARGET_NOT_CONFIGURED') }
  return {
    async query(sql, params = []) {
      const command = bindWranglerQuery(sql, params)
      try {
        const response = run(process.execPath, [wranglerBin, 'd1', 'execute', 'inventory-ops-production', '--remote', '--config', configPath, '--json', '--command', command], {
          cwd: APP_ROOT, shell: false, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1048576, timeout: 60000,
          env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        })
        assert(!response.error && response.status === 0 && !response.signal && typeof response.stdout === 'string' && Buffer.byteLength(response.stdout) <= 1048576, 'WRANGLER_QUERY_FAILED')
        const payload = JSON.parse(response.stdout)
        assert(Array.isArray(payload) && payload.length === 1 && payload[0]?.success === true && Array.isArray(payload[0].results), 'WRANGLER_QUERY_FAILED')
        return payload[0].results
      } catch { throw new IntegrationManagementError('WRANGLER_QUERY_FAILED') }
    },
  }
}

export function parseManagementArguments(args) {
  const [command, ...remaining] = args
  assert(['list', 'create', 'revoke', 'help'].includes(command), 'COMMAND_REQUIRED')
  const names = new Map([['owner-user-id', 'ownerUserId'], ['type', 'authType'], ['label', 'label'], ['scopes', 'scopes'], ['stores', 'stores'], ['expires', 'expiresAt'], ['days', 'days'], ['rate-limit', 'rateLimitPerMinute'], ['secret-output', 'secretOutput'], ['client-id', 'clientId'], ['limit', 'limit'], ['transport', 'transport']])
  const options = {}
  for (let index = 0; index < remaining.length; index++) {
    const arg = remaining[index]
    if (arg === '--confirm') { assert(options.confirm === undefined, 'DUPLICATE_OPTION'); options.confirm = true; continue }
    assert(arg.startsWith('--') && names.has(arg.slice(2)), 'UNKNOWN_OPTION')
    const key = names.get(arg.slice(2)), value = remaining[++index]
    assert(options[key] === undefined && value !== undefined && !value.startsWith('--'), 'INVALID_OPTION')
    options[key] = ['scopes', 'stores'].includes(key) ? value.split(',').map((part) => part.trim()) : ['days', 'rateLimitPerMinute', 'limit'].includes(key) ? Number(value) : value
  }
  const allowed = { list: ['ownerUserId', 'limit', 'transport'], create: ['ownerUserId', 'authType', 'label', 'scopes', 'stores', 'expiresAt', 'days', 'rateLimitPerMinute', 'secretOutput', 'confirm', 'transport'], revoke: ['clientId', 'confirm', 'transport'], help: [] }[command]
  assert(Object.keys(options).every((key) => allowed.includes(key)), 'OPTION_NOT_VALID_FOR_COMMAND')
  assert(options.transport === undefined || ['api', 'wrangler'].includes(options.transport), 'INVALID_TRANSPORT')
  return { command, options }
}

async function main(args) {
  const { command, options } = parseManagementArguments(args)
  if (command === 'help') {
    process.stdout.write('Owner-run integration administration: list | create | revoke.\nCreate requires --confirm --owner-user-id ID --type api_token|access_oauth --label NAME --scopes CSV --stores CSV and --days 1..90 or --expires UTC_TIMESTAMP.\nAPI creation also requires --secret-output runtime/integration-credentials/NAME.json. Revoke requires --confirm --client-id EXACT_ID.\nDefault --transport api: use cloud-secret-store.ps1 -Mode Run; admin environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID.\nOptional --transport wrangler uses the existing Wrangler login and only inventory-ops-production from cloudflare/integrations.wrangler.jsonc. Credentials and raw command output are never printed.\n')
    return
  }
  // Validate commands before establishing any remote connection.
  if (command === 'create') validateCreateOptions(options)
  if (command === 'create' && options.authType === 'api_token') secureCredentialPath(options.secretOutput)
  if (command === 'revoke') { assert(options.confirm === true, 'CONFIRMATION_REQUIRED'); assert(exactId(options.clientId), 'EXACT_CLIENT_ID_REQUIRED') }
  const deps = { db: options.transport === 'wrangler' ? wranglerIntegrationDatabase() : cloudflareIntegrationDatabase(), writeSecret: writePrivateIntegrationCredential }
  const result = command === 'list' ? await listIntegrationClients(options, deps) : command === 'create' ? await createIntegrationClient(options, deps) : await revokeIntegrationClient(options, deps)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const result = error instanceof IntegrationManagementError ? { code: error.code, ...(error.clientId ? { clientId: error.clientId } : {}), ...(error.cleanupComplete !== undefined ? { cleanupComplete: error.cleanupComplete } : {}) } : { code: 'INTEGRATION_ADMIN_FAILED' }
    process.stderr.write(`${JSON.stringify(result)}\n`)
    process.exitCode = 1
  })
}
