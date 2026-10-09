import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { STORE_CONFIG } from '../../server/importer.mjs'

export const COLLECTOR_ADAPTER_ID = 'dealermail-hold-refresh'
export const COLLECTOR_ADAPTER_VERSION = '1'
export const COLLECTOR_PROFILE_NAME = 'group-dealermail-v1'
export const COLLECTOR_SOURCE = 'dealermail'
export const CONTROL_PLANE_ORIGINS = new Set([
  'https://inventory-admin.joegallant.me',
  'https://inventory-admin-staging.joegallant.me',
])

const STORE_SET = Object.entries(STORE_CONFIG)
  .map(([storeName, value]) => ({
    dealerMailId: value.dealerMailId,
    storeKey: ({ Howell: 'howell', Fowlerville: 'fowlerville', 'Ford Detroit': 'ford-detroit', Lincoln: 'lincoln' })[storeName],
  }))
  .sort((a, b) => a.dealerMailId.localeCompare(b.dealerMailId))
const PROFILE_FIELDS = ['adapterId', 'adapterVersion', 'groupId', 'profileId', 'source', 'stores', 'dependencyHashes']
const PROFILE_KEYS = new Set(['schemaVersion', 'adapterId', 'adapterVersion', 'profileId', 'groupId', 'source', 'stores', 'controlPlaneOrigin', 'credentialRef', 'releaseKeyRef', 'workspaceRoot', 'dependencyHashes', 'profileSha256'])
const STORE_KEYS = new Set(['dealerMailId', 'storeKey', 'dealershipId', 'connectionId'])
const DEPENDENCY_KEYS = new Set(['dealermailCapture', 'snapshotBuilder', 'snapshotFinalizer'])
const DEPENDENCY_ENTRYPOINTS = [
  'apps/inventory-ops/scripts/capture-dealermail.mjs',
  'work/build_v2_snapshot.mjs',
  'work/finalize_cloud_snapshot.mjs',
]
const REVIEWED_NODE_BUILTINS = new Set([
  'node:assert', 'node:buffer', 'node:crypto', 'node:events', 'node:fs', 'node:fs/promises',
  'node:path', 'node:stream', 'node:timers', 'node:timers/promises', 'node:url', 'node:util',
])

function assertNoSymlinkDirectoryChain(root, target) {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('WORKSPACE_ROOT_INVALID')
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (!existsSync(current)) throw new Error('WORKSPACE_ROOT_INVALID')
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('WORKSPACE_ROOT_INVALID')
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function profileFingerprint(profile) {
  const immutable = Object.fromEntries(PROFILE_FIELDS.map(key => [key, key === 'stores'
    ? (profile[key] ?? []).map(({ dealerMailId, storeKey, dealershipId }) => ({ dealerMailId: String(dealerMailId), storeKey, dealershipId })).sort((a, b) => a.dealerMailId.localeCompare(b.dealerMailId))
    : profile[key]]))
  immutable.adapterCodeSha256 = adapterCodeFingerprint()
  immutable.dependencyGraph = collectCollectorDependencyGraph(profile.workspaceRoot)
  return createHash('sha256').update(canonicalJson(immutable)).digest('hex')
}

export function collectCollectorDependencyGraph(workspaceRoot) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw new Error('ADAPTER_DEPENDENCY_MISSING')
  const root = path.resolve(workspaceRoot)
  const visited = new Map()
  const queue = DEPENDENCY_ENTRYPOINTS.map(file => path.resolve(root, file))
  const inRoot = file => {
    const relative = path.relative(root, file)
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }
  while (queue.length) {
    const filePath = queue.shift()
    if (!inRoot(filePath)) throw new Error('ADAPTER_DEPENDENCY_MISSING')
    if (visited.has(filePath)) continue
    if (visited.size >= 256) throw new Error('ADAPTER_DEPENDENCY_MISSING')
    assertNoSymlinkDirectoryChain(root, path.dirname(filePath))
    let stat
    try { stat = lstatSync(filePath) } catch { throw new Error('ADAPTER_DEPENDENCY_MISSING') }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) throw new Error('ADAPTER_DEPENDENCY_MISSING')
    const source = readFileSync(filePath, 'utf8')
    const imports = []
    const staticImport = /(?:\bimport\s*(?:[^'"()]*?\s+from\s*)?|\bexport\s+[^'"()]*?\s+from\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]\s*\)?/g
    for (const match of source.matchAll(staticImport)) imports.push(match[1])
    if (/\bimport\s*\(/.test(source) || /\brequire\s*\(\s*(?!['"])/.test(source)) throw new Error('ADAPTER_DEPENDENCY_MISSING')
    const digest = createHash('sha256').update(source).digest('hex')
    visited.set(filePath, digest)
    for (const specifier of imports) {
      if (specifier.startsWith('node:')) {
        if (!REVIEWED_NODE_BUILTINS.has(specifier)) throw new Error('ADAPTER_DEPENDENCY_MISSING')
        continue
      }
      if (!specifier.startsWith('.')) throw new Error('ADAPTER_DEPENDENCY_MISSING')
      const requested = path.resolve(path.dirname(filePath), specifier)
      const candidates = path.extname(requested)
        ? [requested]
        : [requested, `${requested}.mjs`, `${requested}.js`, `${requested}.cjs`, `${requested}.json`]
      const resolved = candidates.find(candidate => {
        try { return lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink() } catch { return false }
      })
      if (!resolved || !inRoot(resolved)) throw new Error('ADAPTER_DEPENDENCY_MISSING')
      if (!visited.has(resolved)) queue.push(resolved)
    }
  }
  return [...visited.entries()].map(([file, hash]) => ({ path: path.relative(root, file).split(path.sep).join('/'), sha256: hash })).sort((a, b) => a.path.localeCompare(b.path))
}

let cachedAdapterCodeSha256
function adapterCodeFingerprint() {
  if (cachedAdapterCodeSha256) return cachedAdapterCodeSha256
  const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptsDirectory, '..', '..')
  const sourceFiles = [
    'scripts/collector-host.mjs',
    'scripts/lib/collector-profile.mjs',
    'scripts/lib/collector-protocol.mjs',
    'scripts/lib/dealermail-hold-refresh-adapter.mjs',
    'scripts/lib/cdp.mjs',
    'scripts/run-inventory-flow-daily.mjs',
    'scripts/publish-cloud-release.mjs',
    'scripts/sync-cloud-release.mjs',
    'server/importer.mjs',
    'cloudflare/src/release-validation.mjs',
  ]
  const hash = createHash('sha256')
  for (const relative of sourceFiles) {
    hash.update(relative).update('\0').update(readFileSync(path.join(repoRoot, relative))).update('\0')
  }
  cachedAdapterCodeSha256 = hash.digest('hex')
  return cachedAdapterCodeSha256
}

export function validateCollectorProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('PROFILE_INVALID')
  if (!Object.keys(profile).every(key => PROFILE_KEYS.has(key))) throw new Error('PROFILE_INVALID')
  if (profile.schemaVersion !== 1 || profile.adapterId !== COLLECTOR_ADAPTER_ID || profile.adapterVersion !== COLLECTOR_ADAPTER_VERSION) {
    throw new Error('ADAPTER_PROFILE_UNSUPPORTED')
  }
  if (typeof profile.profileId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(profile.profileId)) throw new Error('PROFILE_INVALID')
  if (typeof profile.groupId !== 'string' || !profile.groupId.trim()) throw new Error('PROFILE_INVALID')
  if (profile.source !== COLLECTOR_SOURCE) throw new Error('SOURCE_SCOPE_UNSUPPORTED')
  if (!Array.isArray(profile.stores) || profile.stores.length !== STORE_SET.length) throw new Error('PROFILE_STORE_SCOPE_MISMATCH')
  if (profile.stores.some(store => !store || typeof store !== 'object' || Array.isArray(store) || !Object.keys(store).every(key => STORE_KEYS.has(key)))) throw new Error('PROFILE_STORE_SCOPE_MISMATCH')
  const stores = profile.stores.map(({ dealerMailId, storeKey, dealershipId, connectionId }) => ({
    dealerMailId: String(dealerMailId ?? ''), storeKey, dealershipId, connectionId,
  })).sort((a, b) => a.dealerMailId.localeCompare(b.dealerMailId))
  for (let index = 0; index < STORE_SET.length; index += 1) {
    if (stores[index].dealerMailId !== STORE_SET[index].dealerMailId || stores[index].storeKey !== STORE_SET[index].storeKey) {
      throw new Error('PROFILE_STORE_SCOPE_MISMATCH')
    }
    if (typeof stores[index].dealershipId !== 'string' || !stores[index].dealershipId.trim() ||
        typeof stores[index].connectionId !== 'string' || !stores[index].connectionId.trim()) {
      throw new Error('PROFILE_STORE_BINDING_MISSING')
    }
  }
  if (!CONTROL_PLANE_ORIGINS.has(profile.controlPlaneOrigin)) throw new Error('CONTROL_PLANE_ORIGIN_UNSUPPORTED')
  if (typeof profile.credentialRef !== 'string' || !/^CREDENTIAL_[A-Z][A-Z0-9_]{1,67}$/.test(profile.credentialRef)) throw new Error('CREDENTIAL_REFERENCE_INVALID')
  if (typeof profile.releaseKeyRef !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,80}$/.test(profile.releaseKeyRef)) throw new Error('RELEASE_KEY_REFERENCE_INVALID')
  if (typeof profile.workspaceRoot !== 'string' || !path.isAbsolute(profile.workspaceRoot)) throw new Error('WORKSPACE_ROOT_INVALID')
  const root = path.resolve(profile.workspaceRoot)
  if (root !== profile.workspaceRoot || !existsSync(root) || lstatSync(root).isSymbolicLink()) throw new Error('WORKSPACE_ROOT_INVALID')
  for (const required of ['work/run-status', 'work/app-feed-status', 'outputs', 'apps/inventory-ops']) {
    assertNoSymlinkDirectoryChain(root, path.join(root, required))
  }
  if (!profile.dependencyHashes || typeof profile.dependencyHashes !== 'object' || Array.isArray(profile.dependencyHashes) ||
      !Object.keys(profile.dependencyHashes).every(key => DEPENDENCY_KEYS.has(key)) ||
      [...DEPENDENCY_KEYS].some(key => !/^[a-f0-9]{64}$/.test(profile.dependencyHashes[key] ?? ''))) throw new Error('PROFILE_INVALID')
  const actualHash = profileFingerprint({ ...profile, stores })
  if (profile.profileSha256 && profile.profileSha256 !== actualHash) throw new Error('PROFILE_HASH_MISMATCH')
  return { ...profile, profileSha256: actualHash, stores }
}

export function loadCollectorProfile(name, { workspaceRoot, profileDirectory } = {}) {
  if (name !== COLLECTOR_PROFILE_NAME) throw new Error('PROFILE_NOT_INSTALLED')
  const root = workspaceRoot ?? (profileDirectory ? path.resolve(profileDirectory, '..', '..', '..') : null) ?? process.env.BOB_MAXEY_WORKSPACE_ROOT ?? process.env.INVENTORY_WORKSPACE_ROOT ?? process.cwd()
  const directory = profileDirectory ?? path.join(root, 'runtime', 'collector', 'profiles')
  const filePath = path.join(directory, `${name}.json`)
  if (path.resolve(path.dirname(filePath)) !== path.resolve(directory) || !existsSync(filePath)) throw new Error('PROFILE_NOT_INSTALLED')
  if (path.resolve(directory) !== path.resolve(root, 'runtime', 'collector', 'profiles')) throw new Error('PROFILE_INVALID')
  assertNoSymlinkDirectoryChain(root, path.resolve(directory))
  if (lstatSync(filePath).isSymbolicLink() || !lstatSync(filePath).isFile()) throw new Error('PROFILE_INVALID')
  let profile
  try { profile = JSON.parse(readFileSync(filePath, 'utf8')) } catch { throw new Error('PROFILE_INVALID') }
  return validateCollectorProfile(profile)
}

export function readProtectedCollectorCredentials(profile, { platform = process.platform, execFile = execFileSync } = {}) {
  if (platform !== 'win32') throw new Error('CREDENTIAL_STORE_UNAVAILABLE')
  const credentialPath = path.join(profile.workspaceRoot, 'runtime', 'collector', 'credentials', `${profile.credentialRef}.dpapi`)
  const keyPath = path.join(profile.workspaceRoot, 'runtime', 'collector', 'credentials', `${profile.releaseKeyRef}.dpapi`)
  for (const filePath of [credentialPath, keyPath]) {
    if (!existsSync(filePath) || lstatSync(filePath).isSymbolicLink() || !lstatSync(filePath).isFile()) throw new Error('CREDENTIAL_STORE_MISSING')
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    '$credentialSecret = Get-Content -LiteralPath $args[0] -Raw | ConvertTo-SecureString',
    '$credentialJson = [System.Net.NetworkCredential]::new(\'\', $credentialSecret).Password',
    '$credentials = $credentialJson | ConvertFrom-Json',
    '$key = Get-Content -LiteralPath $args[1] -Raw | ConvertTo-SecureString',
    '$keyText = [System.Net.NetworkCredential]::new(\'\', $key).Password',
    '[ordered]@{ accessClientId=[string]$credentials.accessClientId; accessClientSecret=[string]$credentials.accessClientSecret; releaseEncryptionKeyBase64=$keyText } | ConvertTo-Json -Compress',
  ].join('; ')
  let raw
  try { raw = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, credentialPath, keyPath], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { throw new Error('CREDENTIAL_STORE_UNAVAILABLE') }
  let value
  try { value = JSON.parse(String(raw).trim()) } catch { throw new Error('CREDENTIAL_STORE_INVALID') }
  if (!value.accessClientId || !value.accessClientSecret || !value.releaseEncryptionKeyBase64) throw new Error('CREDENTIAL_STORE_INVALID')
  return value
}

export const installedStoreSet = Object.freeze(STORE_SET)
