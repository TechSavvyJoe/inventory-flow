// Navigation is configured by the deployment. A link never grants authority:
// the destination still verifies its own Access audience and current membership.
function applicationUrl(hostname, pathname) {
  if (typeof hostname !== 'string' || hostname !== hostname.trim()) return null
  const host = hostname.toLowerCase()
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return null
  return `https://${host}${pathname}`
}

export async function softwareAdminUrl(env, claims) {
  const url = applicationUrl(env.SOFTWARE_ADMIN_HOSTNAME, '/platform')
  if (!url || !env.PLATFORM_CONTROL_DB || typeof claims?.email !== 'string' || !claims.email || claims.common_name) return null
  try {
    // Called only after employee authentication. Roles, previews and client
    // headers cannot substitute for a freshly enabled software-owner record.
    const owner = await env.PLATFORM_CONTROL_DB.prepare('SELECT id FROM platform_owners WHERE email=? COLLATE NOCASE AND enabled=1').bind(claims.email.toLowerCase()).first()
    return owner?.id ? url : null
  } catch {
    // Optional navigation fails closed without breaking ordinary inventory.
    return null
  }
}

export function dealershipAppUrl(env, groupId) {
  let mapping
  try { mapping = JSON.parse(env.PLATFORM_TENANT_APP_HOSTNAMES || '{}') } catch { return null }
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object' || !Object.hasOwn(mapping, groupId)) return null
  return applicationUrl(mapping[groupId], '/inventory')
}
