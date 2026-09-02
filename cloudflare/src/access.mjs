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

export async function memberContext(claims, env) {
  if (typeof claims.email !== 'string' || !claims.email || claims.common_name) throw new AccessError('EMPLOYEE_ACCESS_REQUIRED',403)
  const row = await env.INVENTORY_DB.prepare('SELECT user_id, name, role, home_store FROM cloud_memberships WHERE email = ? AND enabled = 1').bind(claims.email.toLowerCase()).first()
  const roles = ['sales','manager','group_manager','coordinator','porter','driver']
  const stores = ['Howell','Fowlerville','Ford Detroit','Lincoln']
  if (!row || !roles.includes(row.role) || !stores.includes(row.home_store)) throw new AccessError('EMPLOYEE_NOT_AUTHORIZED',403)
  return { role: row.role, store: row.home_store, user: row.name, userId: row.user_id, identityMode: 'trusted_proxy', authenticated: true, canPreviewRoles: false }
}
