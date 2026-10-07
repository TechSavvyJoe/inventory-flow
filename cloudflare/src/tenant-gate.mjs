import { AccessError } from './access.mjs'

export async function assertTenantIdentity(db, groupId) {
  let row
  try { row = await db.prepare('SELECT group_id FROM inventory_tenant_identity WHERE singleton=1').first() }
  catch { throw new AccessError('TENANT_CONFIGURATION_REQUIRED', 503) }
  if (row?.group_id !== groupId) throw new AccessError('TENANT_CONFIGURATION_REQUIRED', 503)
}

// The deployment, never a URL/header/browser, selects its one inventory DB.
// Existing deployments are unchanged until both control-plane bindings are set.
export async function assertTenantEnabled(env) {
  if (!env.PLATFORM_CONTROL_DB && !env.PLATFORM_TENANT_ID) return
  if (!env.PLATFORM_CONTROL_DB || !env.PLATFORM_TENANT_ID) throw new AccessError('TENANT_CONFIGURATION_REQUIRED', 503)
  await assertTenantIdentity(env.INVENTORY_DB, env.PLATFORM_TENANT_ID)
  const group = await env.PLATFORM_CONTROL_DB.prepare('SELECT status FROM platform_groups WHERE id=?').bind(env.PLATFORM_TENANT_ID).first()
  if (group?.status !== 'active') throw new AccessError('TENANT_ACCESS_SUSPENDED', 403)
}
