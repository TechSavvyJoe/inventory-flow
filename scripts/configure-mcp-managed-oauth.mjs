// Inspect or narrowly update the dedicated MCP Access application. This script
// never prints the Cloudflare API token, policy rules, or OAuth credentials.
import { argv, env, exitCode } from 'node:process'

const APP_ID = '8ae25338-9c2b-4cc1-a602-8dd8166560cb'
const command = argv[2] ?? 'inspect'
const apply = command === 'enable-local-agent-redirects' && argv.includes('--confirm')

if (!['inspect', 'enable-local-agent-redirects'].includes(command) || (command === 'enable-local-agent-redirects' && !argv.includes('--confirm'))) {
  throw new Error('Usage: inspect | enable-local-agent-redirects --confirm')
}
if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') || !(env.CLOUDFLARE_API_TOKEN ?? '').length) {
  throw new Error('CLOUDFLARE_ADMIN_CREDENTIALS_UNAVAILABLE')
}

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/access/apps/${APP_ID}`
const headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }
const read = async () => {
  const result = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) })
  const body = await result.json().catch(() => null)
  if (!result.ok || !body?.success || !body?.result) throw new Error('ACCESS_APPLICATION_READ_FAILED')
  return body.result
}
const safe = (app) => {
  const oauth = app.oauth_configuration ?? {}
  const registration = oauth.dynamic_client_registration ?? {}
  return {
    appId: APP_ID,
    name: typeof app.name === 'string' ? app.name : null,
    domain: typeof app.domain === 'string' ? app.domain : null,
    managedOAuthEnabled: oauth.enabled === true,
    dynamicRegistrationEnabled: registration.enabled === true,
    allowAnyOnLocalhost: registration.allow_any_on_localhost === true,
    allowAnyOnLoopback: registration.allow_any_on_loopback === true,
    allowedUris: Array.isArray(registration.allowed_uris) ? registration.allowed_uris : [],
  }
}

const before = await read()
if (!apply) {
  console.log(JSON.stringify({ mode: 'inspect', configuration: safe(before) }))
} else {
  const current = before.oauth_configuration ?? {}
  const registration = current.dynamic_client_registration ?? {}
  const oauth_configuration = {
    ...current,
    enabled: true,
    dynamic_client_registration: {
      ...registration,
      enabled: true,
      // Desktop MCP clients use a short-lived local callback listener. Access
      // still requires PKCE, the owner identity and the existing D1 grant.
      allow_any_on_localhost: true,
      allow_any_on_loopback: true,
      allowed_uris: Array.isArray(registration.allowed_uris) ? registration.allowed_uris : [],
    },
  }
  // Access requires the existing application type and domain on an update. Keep
  // every mutable setting intact; only the documented local-agent callback
  // switches are changed. Policy bindings and API-managed fields are omitted.
  const apiManaged = new Set(['id', 'uid', 'aud', 'created_at', 'updated_at', 'policies'])
  const updatePayload = Object.fromEntries(Object.entries(before).filter(([key]) => !apiManaged.has(key)))
  updatePayload.oauth_configuration = oauth_configuration
  const result = await fetch(endpoint, {
    method: 'PUT', headers, body: JSON.stringify(updatePayload), signal: AbortSignal.timeout(30000),
  })
  const updateResult = await result.json().catch(() => null)
  if (!result.ok || !updateResult?.success || !updateResult?.result) throw new Error('ACCESS_APPLICATION_UPDATE_FAILED')
  const after = safe(updateResult.result)
  if (!after.managedOAuthEnabled || !after.dynamicRegistrationEnabled || !after.allowAnyOnLocalhost || !after.allowAnyOnLoopback) {
    throw new Error('ACCESS_APPLICATION_UPDATE_NOT_CONFIRMED')
  }
  console.log(JSON.stringify({ mode: 'enable-local-agent-redirects', configuration: after }))
}
