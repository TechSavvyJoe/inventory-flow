// Read-only live smoke test. Local credentials are consumed, never displayed.
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInventoryFlowClient } from '../clients/inventory-flow.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HOST = 'https://inventory-data.joegallant.me'
const ALLOWED = new Set(['inventory-data.joegallant.me', 'techsavvyjoe.cloudflareaccess.com'])
function assert(ok) { if (!ok) throw new Error('INTEGRATION_VERIFICATION_FAILED') }
async function fetchSafe(url, options = {}) {
  const target = new URL(url)
  assert(target.protocol === 'https:' && ALLOWED.has(target.hostname) && !target.port && !target.username && !target.password)
  return fetch(target, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000) })
}
async function oauthDiscovery() {
  const unauthenticated = await fetchSafe(`${HOST}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'inventory-owner-verification', version: '1.0.0' }, capabilities: {} } }) })
  const challenge = unauthenticated.headers.get('www-authenticate') || ''
  const pointer = /resource_metadata="([^"]+)"/.exec(challenge)?.[1]
  if (unauthenticated.status !== 401 || !pointer) return { protected: unauthenticated.status === 401 || unauthenticated.status === 302, discoveryReady: false, status: unauthenticated.status }
  const metadataResponse = await fetchSafe(pointer)
  const metadata = await metadataResponse.json()
  assert(metadataResponse.status === 200 && Array.isArray(metadata.authorization_servers))
  const issuer = metadata.authorization_servers[0]
  const parsed = new URL(issuer)
  const wellKnown = `${parsed.origin}/.well-known/oauth-authorization-server${parsed.pathname === '/' ? '' : parsed.pathname}`
  const authorizationResponse = await fetchSafe(wellKnown)
  const authorization = await authorizationResponse.json()
  return { protected: true, discoveryReady: metadata.resource === `${HOST}/mcp` && authorizationResponse.status === 200, resource: metadata.resource, issuer: authorization.issuer, issuerIdentificationAdvertised: authorization.authorization_response_iss_parameter_supported === true, pkce: authorization.code_challenge_methods_supported?.includes('S256') === true, dynamicRegistration: Boolean(authorization.registration_endpoint), liveClientSignInVerified: false }
}
let stage = 'anonymous-access'
try {
  const output = { checkedAt: new Date().toISOString(), host: HOST }
  const noCredential = await fetchSafe(`${HOST}/api/v1/inventory`)
  assert(noCredential.status === 401)
  output.unauthenticatedApiDenied = true
  stage = 'oauth-discovery'
  output.oauth = await oauthDiscovery()
  const requested = process.argv[2]
  if (requested) {
    const privateRoot = realpathSync(path.join(ROOT, 'runtime', 'integration-credentials'))
    const file = realpathSync(path.resolve(ROOT, requested))
    assert(path.dirname(file) === privateRoot && path.extname(file) === '.json')
    stage = 'local-key-read'
    const stored = JSON.parse(readFileSync(file, 'utf8'))
    const token = stored.token
    assert(typeof token === 'string' && /^iflow_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(token))
    const client = createInventoryFlowClient({ baseUrl: `${HOST}/api/v1`, token: () => token, fetch: async (url, init) => {
      const result = await fetchSafe(url, init)
      if (!result.ok) {
        const safe = await result.clone().json().catch(() => null)
        const code = safe?.error?.code
        const platform = typeof safe?.error_code === 'number' ? safe.error_code : typeof safe?.error_code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(safe.error_code) ? safe.error_code : null
        console.error(JSON.stringify({ stage, status: result.status, serverCode: /^[A-Z_]{3,80}$/.test(code ?? '') ? code : 'UNSPECIFIED', platformCode: platform, platformName: typeof safe?.error_name === 'string' && /^[a-zA-Z_ -]{1,100}$/.test(safe.error_name) ? safe.error_name : null }))
      }
      return result
    } })
    stage = 'authenticated-health'
    const health = await client.dataHealth()
    const byStore = {}, seen = new Set()
    let withEquipment = 0, withHistory = 0, withScanDates = 0, first
    stage = 'inventory-pagination'
    for await (const vehicle of client.iterateInventory({ limit: 20 })) {
      assert(!seen.has(vehicle.vin) && !Object.hasOwn(vehicle, 'privateEvidence') && !Object.hasOwn(vehicle, 'dealerComments'))
      assert(!Object.hasOwn(vehicle.hold, 'primarySalesperson') && !Object.hasOwn(vehicle.hold, 'reason'))
      first ??= vehicle.vin
      seen.add(vehicle.vin)
      byStore[vehicle.publicStore] = (byStore[vehicle.publicStore] || 0) + 1
      if (vehicle.windowSticker?.options?.length || vehicle.factoryEquipment?.packages?.length) withEquipment++
      if (vehicle.autoCheckReport?.score !== null && vehicle.autoCheckReport?.score !== undefined) withHistory++
      if (vehicle.publicScan?.firstSeen && vehicle.publicScan?.lastSeen) withScanDates++
    }
    stage = 'inventory-reconciliation'
    assert(seen.size > 0 && seen.size === health.data.visibleVehicleCount)
    stage = 'vehicle-detail'
    const detail = await client.vehicle(first)
    assert(detail.data.vin === first)
    stage = 'changes-and-holds'
    const changes = await client.changes({ limit: 1 })
    const holds = await client.holdSummary()
    output.api = { verified: true, reportDate: health.meta.reportDate, bundleSha256: health.meta.bundleSha256, total: seen.size, byStore, vehiclesWithEquipment: withEquipment, vehiclesWithHistory: withHistory, vehiclesWithScanDates: withScanDates, changeCount: changes.pagination.total, holdSummaryStores: holds.data.length }
  }
  console.log(JSON.stringify(output, null, 2))
} catch (error) { console.error(JSON.stringify({ verified: false, stage, httpStatus: Number.isInteger(error.status) ? error.status : null, code: /^[A-Z_]{3,80}$/.test(error.code ?? '') ? error.code : 'VERIFICATION_FAILED', diagnostic: 'No credentials or source responses logged.' })); process.exitCode = 1 }
