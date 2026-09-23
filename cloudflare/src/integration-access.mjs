import { verifyAccess } from './access.mjs'

export const INTEGRATION_SCOPES = Object.freeze(['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read'])
export const INTEGRATION_STORES = Object.freeze(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'])
const READER_ROLES = ['sales', 'manager', 'group_manager']
const TOKEN_PATTERN = /^iflow_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/
export const AUDIT_OPERATIONS = new Set(['health', 'inventory_list', 'inventory_get', 'operational_inventory_search', 'vehicle_resources_get', 'changes_list', 'daily_operations_get', 'data_quality_get', 'reconciliation_get', 'holds_summary', 'manager_dispositions_list', 'mcp_initialize', 'mcp_tools_list', 'mcp_tools_call', 'mcp_notification', 'other'])
const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
// Per client, not global. Every rejection is audited too, including the 429 a
// client gets for exceeding its own quota — the one outcome a misbehaving
// integration can produce without limit — so a global recency cap let that
// flood evict the genuine read history of every other integration.
const AUDIT_ROW_LIMIT = 10000

export class IntegrationAccessError extends Error {
  constructor(code = 'INTEGRATION_AUTHENTICATION_REQUIRED', status = 401, retryAfter = null) {
    super(code)
    this.name = 'IntegrationAccessError'
    this.code = code
    this.status = status
    if (retryAfter !== null) this.retryAfter = retryAfter
  }
}

function milliseconds(now = Date.now()) {
  const result = now instanceof Date ? now.getTime() : now
  if (!Number.isSafeInteger(result) || result < 0) throw new IntegrationAccessError('INTEGRATION_CONFIGURATION_INVALID', 503)
  return result
}

function identity(value, max = 160) {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
}

function allowedList(raw, allowlist) {
  let values
  try { values = JSON.parse(raw) } catch { throw new IntegrationAccessError('INTEGRATION_GRANT_INVALID', 403) }
  if (!Array.isArray(values) || !values.length || values.length > allowlist.length || new Set(values).size !== values.length || values.some((value) => !allowlist.includes(value))) {
    throw new IntegrationAccessError('INTEGRATION_GRANT_INVALID', 403)
  }
  return Object.freeze(values)
}

export function parseIntegrationToken(token) {
  if (typeof token !== 'string') return null
  const match = TOKEN_PATTERN.exec(token)
  return match ? { clientId: match[1] } : null
}

export async function hashIntegrationToken(token) {
  if (!parseIntegrationToken(token)) throw new IntegrationAccessError('INTEGRATION_TOKEN_INVALID')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function requireConfiguration(request, env) {
  if (env.INTEGRATIONS_ENABLED !== 'true' || !env.INVENTORY_DB?.prepare || !env.INVENTORY_DB?.batch) {
    throw new IntegrationAccessError('INTEGRATIONS_NOT_CONFIGURED', 503)
  }
  const hostname = env.INTEGRATION_HOSTNAME
  if (typeof hostname !== 'string' || hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    throw new IntegrationAccessError('INTEGRATION_CONFIGURATION_INVALID', 503)
  }
  const url = new URL(request.url)
  if (url.protocol !== 'https:' || url.hostname !== hostname || url.port || url.username || url.password) {
    throw new IntegrationAccessError('INTEGRATION_HOST_NOT_ALLOWED', 403)
  }
  // Secrets belong only in Authorization, never URLs, cookies, or forwarded app headers.
  for (const key of url.searchParams.keys()) {
    if (['token', 'access_token', 'api_key', 'apikey', 'authorization'].includes(key.toLowerCase())) {
      throw new IntegrationAccessError('INTEGRATION_QUERY_CREDENTIAL_REJECTED', 400)
    }
  }
}

const SELECT_GRANT = `SELECT client.client_id, client.auth_type, client.scopes_json, client.stores_json,
  client.enabled, client.expires_at, client.revoked_at, client.rate_limit_per_minute,
  member.user_id, member.name, member.email, member.role, member.home_store, member.enabled AS member_enabled
  FROM integration_clients AS client
  JOIN cloud_memberships AS member ON member.user_id = client.owner_user_id`

function grantPrincipal(row, now) {
  if (!row || row.enabled !== 1 || row.member_enabled !== 1 || row.revoked_at !== null || typeof row.expires_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(row.expires_at) || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now) {
    throw new IntegrationAccessError('INTEGRATION_GRANT_INACTIVE', 403)
  }
  if (!/^[a-f0-9]{32}$/.test(row.client_id) || !READER_ROLES.includes(row.role) || !INTEGRATION_STORES.includes(row.home_store) || !identity(row.user_id) || !identity(row.name) || !Number.isInteger(row.rate_limit_per_minute) || row.rate_limit_per_minute < 1 || row.rate_limit_per_minute > 600) {
    throw new IntegrationAccessError('INTEGRATION_GRANT_INVALID', 403)
  }
  return Object.freeze({
    clientId: row.client_id,
    grantType: row.auth_type,
    userId: row.user_id,
    role: row.role,
    stores: allowedList(row.stores_json, INTEGRATION_STORES),
    scopes: allowedList(row.scopes_json, INTEGRATION_SCOPES),
    user: row.name,
    store: row.home_store,
    authenticated: true,
    identityMode: 'trusted_proxy',
    canPreviewRoles: false,
    rateLimitPerMinute: row.rate_limit_per_minute,
  })
}

/**
 * Dedicated integration credentials only; no browser/publisher credential fallback.
 * Managed OAuth's bearer token is opaque. Cloudflare validates it at the edge and
 * forwards a signed assertion. Do not accept this adapter on a bypass origin.
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
 */
export async function authenticateIntegration(request, env) {
  requireConfiguration(request, env)
  const authorization = request.headers.get('authorization')
  if (!authorization || authorization.length > 8192) throw new IntegrationAccessError()
  const match = /^Bearer ([A-Za-z0-9_:.\-]+)$/i.exec(authorization)
  if (!match) throw new IntegrationAccessError('INTEGRATION_TOKEN_INVALID')
  const token = match[1]
  const apiToken = parseIntegrationToken(token)
  const now = milliseconds()
  try {
    if (apiToken) {
      const digest = await hashIntegrationToken(token)
      const row = await env.INVENTORY_DB.prepare(`${SELECT_GRANT} WHERE client.client_id = ? AND client.token_sha256 = ? AND client.auth_type = 'api_token'`).bind(apiToken.clientId, digest).first()
      if (!row) throw new IntegrationAccessError('INTEGRATION_TOKEN_INVALID')
      return grantPrincipal(row, now)
    }

    // An ordinary signed browser JWT or Access service-token secret is not OAuth.
    if (!/^oauth:[A-Za-z0-9_.-]{16,4096}$/.test(token)) throw new IntegrationAccessError('INTEGRATION_TOKEN_INVALID')
    const audience = env.INTEGRATION_ACCESS_AUDIENCE
    if (env.INTEGRATION_MANAGED_OAUTH_ENABLED !== 'true' || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER ?? '') || !identity(audience, 256) || audience === env.ACCESS_AUDIENCE || audience === env.ACCESS_PUBLISHER_AUDIENCE) {
      throw new IntegrationAccessError('INTEGRATION_OAUTH_NOT_CONFIGURED', 503)
    }
    let claims
    try { claims = await verifyAccess(request, env, audience) } catch { throw new IntegrationAccessError('INTEGRATION_OAUTH_TOKEN_INVALID') }
    if (!identity(claims.email, 254) || claims.common_name || typeof claims.sub !== 'string' || !claims.sub || !Number.isFinite(claims.iat) || claims.iat > Math.floor(now / 1000) + 5) {
      throw new IntegrationAccessError('INTEGRATION_EMPLOYEE_REQUIRED', 403)
    }
    const row = await env.INVENTORY_DB.prepare(`${SELECT_GRANT} WHERE member.email = ? COLLATE NOCASE AND client.auth_type = 'access_oauth' AND client.revoked_at IS NULL`).bind(claims.email.toLowerCase()).first()
    return grantPrincipal(row, now)
  } catch (error) {
    if (error instanceof IntegrationAccessError) throw error
    // D1/JWKS exceptions may contain request metadata; never send or log them.
    throw new IntegrationAccessError('INTEGRATION_AUTH_UNAVAILABLE', 503)
  }
}

/** Atomic fixed-window limit: simultaneous requests cannot all read an old count. */
export async function consumeIntegrationQuota(env, principal, now = Date.now()) {
  const instant = milliseconds(now)
  const windowStart = Math.floor(instant / 60000) * 60000
  const limit = principal?.rateLimitPerMinute
  if (!/^[a-f0-9]{32}$/.test(principal?.clientId ?? '') || !Number.isInteger(limit) || limit < 1 || limit > 600) {
    throw new IntegrationAccessError('INTEGRATION_GRANT_INVALID', 403)
  }
  const retryAfter = Math.max(1, Math.ceil((windowStart + 60000 - instant) / 1000))
  try {
    const row = await env.INVENTORY_DB.prepare(`
      INSERT INTO integration_rate_windows (client_id, window_start, request_count) VALUES (?, ?, 1)
      ON CONFLICT(client_id) DO UPDATE SET
        request_count = CASE WHEN excluded.window_start > integration_rate_windows.window_start THEN 1 ELSE integration_rate_windows.request_count + 1 END,
        window_start = excluded.window_start
      WHERE excluded.window_start >= integration_rate_windows.window_start
        AND (excluded.window_start > integration_rate_windows.window_start OR integration_rate_windows.request_count < ?)
      RETURNING request_count, window_start
    `).bind(principal.clientId, windowStart, limit).first()
    if (!row) throw new IntegrationAccessError('INTEGRATION_RATE_LIMITED', 429, retryAfter)
    if (!Number.isInteger(row.request_count) || row.request_count < 1 || row.request_count > limit || row.window_start !== windowStart) {
      throw new IntegrationAccessError('INTEGRATION_QUOTA_UNAVAILABLE', 503)
    }
    return { limit, remaining: Math.max(0, limit - row.request_count), resetAt: windowStart + 60000, retryAfter }
  } catch (error) {
    if (error instanceof IntegrationAccessError) throw error
    throw new IntegrationAccessError('INTEGRATION_QUOTA_UNAVAILABLE', 503)
  }
}

/** Await before returning sensitive results. Audit failures fail closed. */
export async function auditIntegrationAccess(env, principal, details = {}, now = Date.now()) {
  const instant = milliseconds(now)
  if (!/^[a-f0-9]{32}$/.test(principal?.clientId ?? '') || !Number.isInteger(details.status) || details.status < 100 || details.status > 599) {
    throw new IntegrationAccessError('INTEGRATION_AUDIT_INVALID', 503)
  }
  const operation = AUDIT_OPERATIONS.has(details.operation) ? details.operation : 'other'
  const count = Number.isInteger(details.resultCount) && details.resultCount >= 0 ? Math.min(details.resultCount, 1000) : 0
  try {
    const result = await env.INVENTORY_DB.batch([
      env.INVENTORY_DB.prepare('INSERT INTO integration_access_audit (client_id, operation, status, result_count, occurred_at) VALUES (?, ?, ?, ?, ?)').bind(principal.clientId, operation, details.status, count, instant),
      env.INVENTORY_DB.prepare('DELETE FROM integration_access_audit WHERE occurred_at < ?').bind(instant - AUDIT_RETENTION_MS),
      env.INVENTORY_DB.prepare('DELETE FROM integration_access_audit WHERE client_id = ? AND id IN (SELECT id FROM integration_access_audit WHERE client_id = ? ORDER BY occurred_at DESC, id DESC LIMIT -1 OFFSET ?)').bind(principal.clientId, principal.clientId, AUDIT_ROW_LIMIT),
    ])
    if (!Array.isArray(result) || result.length !== 3 || result.some((item) => item.success !== true)) throw new Error('Audit unavailable')
  } catch { throw new IntegrationAccessError('INTEGRATION_AUDIT_UNAVAILABLE', 503) }
}
