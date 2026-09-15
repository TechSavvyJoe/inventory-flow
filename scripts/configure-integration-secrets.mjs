// Run through the existing current-user protected cloud-secret-store.ps1 wrapper.
// Secrets travel only through child stdin; never command arguments or logs.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
function invoke(args, input) {
  const result = spawnSync(process.execPath, [wrangler, 'secret', ...args, '--config', 'cloudflare/integrations.wrangler.jsonc'], { cwd: root, input, encoding: 'utf8', timeout: 120000, windowsHide: true, shell: false, maxBuffer: 1024 * 1024 })
  if (result.status !== 0 || result.error) throw new Error('INTEGRATION_SECRET_SETUP_FAILED')
  return result.stdout
}
try {
  const argumentsText = process.argv.slice(2).join(' ')
  const repairReleaseKey = argumentsText === '--confirm --repair-release-key'
  const repairRuntimeSecrets = argumentsText === '--confirm --repair-runtime-secrets'
  if (argumentsText !== '--confirm' && !repairReleaseKey && !repairRuntimeSecrets) throw new Error('EXPLICIT_CONFIRM_REQUIRED')
  const key = process.env.INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64
  if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 32) throw new Error('PROTECTED_RELEASE_KEY_REQUIRED')
  const existing = JSON.parse(invoke(['list']))
  if (!Array.isArray(existing)) throw new Error('SECRET_METADATA_UNAVAILABLE')
  const names = new Set(existing.map(item => item.name))
  const secrets = {}
  // This worker must decrypt the same immutable release envelope as the sole
  // publisher. A guarded repair can correct a previously misconfigured Worker
  // secret without reading, logging, or rotating the publisher's key.
  if (!names.has('RELEASE_ENCRYPTION_KEY_BASE64') || repairReleaseKey || repairRuntimeSecrets) secrets.RELEASE_ENCRYPTION_KEY_BASE64 = key
  if (!names.has('INTEGRATION_CURSOR_SECRET') || repairRuntimeSecrets) secrets.INTEGRATION_CURSOR_SECRET = randomBytes(48).toString('base64url')
  const count = Object.keys(secrets).length
  if (count) invoke(['bulk'], JSON.stringify(secrets))
  const after = JSON.parse(invoke(['list']))
  if (!['RELEASE_ENCRYPTION_KEY_BASE64', 'INTEGRATION_CURSOR_SECRET'].every(name => after.some(item => item.name === name))) throw new Error('SECRET_SETUP_NOT_VERIFIED')
  console.log(JSON.stringify({ configured: true, createdSecrets: count, releaseKeyRepaired: repairReleaseKey || repairRuntimeSecrets, cursorSecretRepaired: repairRuntimeSecrets, existingSecretsPreserved: !repairReleaseKey && !repairRuntimeSecrets }))
} catch {
  console.error('Integration secret setup could not be verified. No credential values were logged. Check the protected settings and Worker permissions.')
  process.exitCode = 1
}
