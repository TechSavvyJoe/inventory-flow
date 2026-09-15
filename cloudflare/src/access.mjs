import { createRemoteJWKSet, jwtVerify } from 'jose'

export class AccessError extends Error {
  constructor(code = 'ACCESS_AUTHENTICATION_REQUIRED', status = 401) { super(code); this.code = code; this.status = status }
}

// Only public signing keys are cached. User claims and data never live in a module cache.
const keySets = new Map()
export async function verifyAccess(request, env, audience = env.ACCESS_AUDIENCE) {
  const issuer = env.ACCESS_ISSUER
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer ?? '') || !audience) {
    throw new AccessError('ACCESS_NOT_CONFIGURED', 503)
  }
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token || token.length > 16384) throw new AccessError()
  let keys = keySets.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 300000 })
    keySets.set(issuer, keys)
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub'], clockTolerance: 5,
    })
    return payload
  } catch { throw new AccessError('ACCESS_TOKEN_INVALID') }
}

export async function memberContext(claims, env, request) {
  if (typeof claims.email !== 'string' || !claims.email || claims.common_name) throw new AccessError('EMPLOYEE_ACCESS_REQUIRED',403)
  const row = await env.INVENTORY_DB.prepare(`
    SELECT member.user_id, member.name, member.role, member.home_store,
      (SELECT COUNT(*) FROM cloud_memberships AS candidate
         WHERE candidate.enabled = 1
         AND candidate.role IN ('porter', 'driver')
         AND candidate.name = member.name COLLATE BINARY) AS transport_name_matches
    FROM cloud_memberships AS member
    WHERE member.email = ? AND member.enabled = 1
  `).bind(claims.email.toLowerCase()).first()
  const roles = ['sales','manager','group_manager','coordinator','porter','driver']
  const stores = ['Howell','Fowlerville','Ford Detroit','Lincoln']
  const validIdentity = (value) => typeof value === 'string' && value.trim() && value === value.trim() && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
  const legacyTransportName = (value) => /^[\x20-\x7e]+$/.test(value)
  if (!row || !roles.includes(row.role) || !stores.includes(row.home_store) || !validIdentity(row.name) || !validIdentity(row.user_id)) {
    throw new AccessError('EMPLOYEE_NOT_AUTHORIZED',403)
  }
  // A preview can only narrow a freshly verified group manager membership.
  // Neither JWT role claims nor browser headers grant the underlying authority.
  const canPreviewRoles = row.role === 'group_manager'
  const previewRole = canPreviewRoles ? request?.headers.get('x-inventory-preview-role') : null
  if (previewRole && !roles.includes(previewRole)) throw new AccessError('INVALID_PREVIEW_ROLE', 400)
  const effectiveRole = previewRole || row.role
  return {
    role: effectiveRole,
    authenticatedRole: row.role,
    rolePreviewActive: effectiveRole !== row.role,
    store: row.home_store,
    user: row.name,
    userId: row.user_id,
    allowLegacyTransportAssignmentByName:
      ['porter', 'driver'].includes(row.role) &&
      legacyTransportName(row.name) &&
      Number(row.transport_name_matches) === 1,
    identityMode: 'trusted_proxy',
    authenticated: true,
    canPreviewRoles,
  }
}
