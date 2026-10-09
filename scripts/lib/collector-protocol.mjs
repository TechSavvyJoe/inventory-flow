import { randomUUID } from 'node:crypto'
import { COLLECTOR_ADAPTER_ID, COLLECTOR_ADAPTER_VERSION } from './collector-profile.mjs'

const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_JSON_BYTES = 64 * 1024
const MAX_ENVELOPE_BYTES = 25 * 1024 * 1024
const CLAIM_KEYS = new Set(['attemptId', 'requestId', 'fence', 'leaseUntil', 'hardDeadline', 'configSha256', 'scopeSha256', 'baselineBundleSha256', 'grantGeneration', 'adapterId', 'adapterVersion', 'profileId', 'profileSha256', 'groupId', 'dealerships', 'connectionIds', 'credentialRef', 'reportDate'])
const CONTACT_KEYS = new Set(['collectorId', 'enabled', 'executionEnabled', 'scopeSha256', 'profileSha256', 'adapterVersion', 'connected', 'checkedAt'])
const FAILURE_CODES = new Set([
  'BASELINE_REQUIRED', 'RECONCILIATION_REQUIRED', 'NEEDS_SIGN_IN',
  'BROWSER_UNAVAILABLE', 'CAPTURE_INCOMPLETE', 'CAPTURE_FAILED',
  'VALIDATION_FAILED', 'ADAPTER_DEPENDENCY_MISSING', 'PROFILE_SCOPE_MISMATCH',
  'DISALLOWED_SOURCE', 'HOST_IO_FAILED', 'DURATION_EXCEEDED',
])

function check(condition, code) { if (!condition) throw new Error(code) }
function isId(value) { return typeof value === 'string' && ID.test(value) }
function isIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function sha(value) { return typeof value === 'string' && HASH.test(value) }

export function randomIdempotencyKey() { return randomUUID() }

export function assertClaimMatchesProfile(claim, profile, now = new Date(), expectedScopeSha256 = null) {
  check(claim && typeof claim === 'object' && !Array.isArray(claim), 'CLAIM_INVALID')
  check(Object.keys(claim).every(key => CLAIM_KEYS.has(key)), 'CLAIM_INVALID')
  check(claim.adapterId === COLLECTOR_ADAPTER_ID && claim.adapterVersion === COLLECTOR_ADAPTER_VERSION, 'ADAPTER_PROFILE_UNSUPPORTED')
  check(claim.profileId === profile.profileId && claim.profileSha256 === profile.profileSha256, 'PROFILE_MISMATCH')
  check(claim.groupId === profile.groupId, 'PROFILE_SCOPE_MISMATCH')
  check(isId(claim.attemptId) && isId(claim.requestId) && Number.isSafeInteger(claim.fence) && claim.fence > 0, 'CLAIM_INVALID')
  check(Number.isSafeInteger(claim.grantGeneration) && claim.grantGeneration > 0, 'CLAIM_INVALID')
  check(sha(claim.configSha256) && sha(claim.scopeSha256), 'CLAIM_INVALID')
  if (expectedScopeSha256 !== null) check(claim.scopeSha256 === expectedScopeSha256, 'PROFILE_SCOPE_MISMATCH')
  check(sha(claim.baselineBundleSha256), 'BASELINE_REQUIRED')
  check(isIso(claim.leaseUntil) && isIso(claim.hardDeadline), 'CLAIM_INVALID')
  const leaseUntil = Date.parse(claim.leaseUntil)
  const hardDeadline = Date.parse(claim.hardDeadline)
  check(leaseUntil > now.getTime() && leaseUntil <= hardDeadline && hardDeadline > now.getTime() && hardDeadline <= now.getTime() + 45 * 60_000 + 5_000, 'CLAIM_EXPIRED')
  check(DATE.test(claim.reportDate) && claim.reportDate === reportDateInNewYork(now), 'CLAIM_INVALID')
  check(claim.credentialRef === profile.credentialRef, 'CREDENTIAL_REFERENCE_MISMATCH')
  check(Array.isArray(claim.dealerships) && claim.dealerships.length === profile.stores.length, 'PROFILE_SCOPE_MISMATCH')
  check(claim.dealerships.every(item => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every(key => ['id', 'storeKey'].includes(key))), 'PROFILE_SCOPE_MISMATCH')
  const received = claim.dealerships.map(item => ({ id: item?.id, storeKey: item?.storeKey })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const expected = profile.stores.map(item => ({ id: item.dealershipId, storeKey: item.storeKey })).sort((a, b) => a.id.localeCompare(b.id))
  check(JSON.stringify(received) === JSON.stringify(expected), 'PROFILE_SCOPE_MISMATCH')
  check(Array.isArray(claim.connectionIds) && claim.connectionIds.every(isId), 'PROFILE_SCOPE_MISMATCH')
  check(JSON.stringify([...claim.connectionIds].sort()) === JSON.stringify(profile.stores.map(store => store.connectionId).sort()), 'PROFILE_SCOPE_MISMATCH')
  return claim
}

export function assertContactMatchesProfile(contact, profile) {
  check(contact && typeof contact === 'object' && !Array.isArray(contact), 'CONTACT_INVALID')
  check(Object.keys(contact).every(key => CONTACT_KEYS.has(key)), 'CONTACT_INVALID')
  check(isId(contact.collectorId), 'CONTACT_INVALID')
  check(typeof contact.connected === 'boolean' && isIso(contact.checkedAt), 'CONTACT_INVALID')
  check(contact.profileSha256 === profile.profileSha256, 'PROFILE_MISMATCH')
  check(contact.adapterVersion === COLLECTOR_ADAPTER_VERSION, 'ADAPTER_PROFILE_UNSUPPORTED')
  check(sha(contact.scopeSha256), 'CONTACT_INVALID')
  check(typeof contact.enabled === 'boolean' && typeof contact.executionEnabled === 'boolean', 'CONTACT_INVALID')
  return contact
}

export function assertBaselineBundleMatchesClaim(claim, verifiedReceipt) {
  check(sha(claim?.baselineBundleSha256) && sha(verifiedReceipt?.bundleSha256) && claim.baselineBundleSha256 === verifiedReceipt.bundleSha256, 'BASELINE_REQUIRED')
  return true
}

export function validateReceiptPayload(payload) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload), 'RECEIPT_INVALID')
  check(isId(payload.attemptId) && Number.isSafeInteger(payload.fence) && payload.fence > 0 && Number.isSafeInteger(payload.sequence) && payload.sequence > 0, 'RECEIPT_INVALID')
  check(['capture', 'failure'].includes(payload.kind), 'RECEIPT_INVALID')
  if (payload.kind === 'capture') {
    check(isIso(payload.capturedAt) && sha(payload.sourceSha256), 'RECEIPT_INVALID')
    check(payload.counts && Object.keys(payload.counts).length === 1 && Number.isSafeInteger(payload.counts.dealerMailRows) && payload.counts.dealerMailRows >= 0, 'RECEIPT_INVALID')
  } else {
    check(FAILURE_CODES.has(payload.code), 'RECEIPT_INVALID')
  }
  return payload
}

export async function collectorRequest(profile, credentials, pathname, {
  method = 'POST', body = {}, idempotencyKey, fetchImpl = fetch,
  signal, maxResponseBytes = MAX_JSON_BYTES, onRequestStarted,
} = {}) {
  check(pathname.startsWith('/api/collector/') && !pathname.includes('?') && !pathname.includes('#'), 'COLLECTOR_ROUTE_INVALID')
  const url = new URL(pathname, profile.controlPlaneOrigin)
  check(url.origin === profile.controlPlaneOrigin && url.protocol === 'https:', 'COLLECTOR_ROUTE_INVALID')
  const serialized = JSON.stringify(body)
  check(Buffer.byteLength(serialized, 'utf8') <= maxResponseBytes, 'REQUEST_TOO_LARGE')
  const headers = {
    'Content-Type': 'application/json',
    'CF-Access-Client-Id': credentials.accessClientId,
    'CF-Access-Client-Secret': credentials.accessClientSecret,
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const options = {
    method,
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(120_000),
    headers,
    body: method === 'GET' ? undefined : serialized,
  }
  if (signal?.aborted) throw new Error('LEASE_STOPPED')
  onRequestStarted?.()
  const response = await fetchImpl(url, options)
  if (response.status === 204) return { status: 204, body: null }
  const text = await readBoundedBody(response, maxResponseBytes)
  let value = null
  try { value = text ? JSON.parse(text) : null } catch { throw new Error('COLLECTOR_RESPONSE_INVALID') }
  if (!response.ok) {
    const code = typeof value?.code === 'string' && /^[A-Z0-9_]{2,80}$/.test(value.code) ? value.code : 'COLLECTOR_REQUEST_FAILED'
    const error = new Error(code)
    error.status = response.status
    throw error
  }
  return { status: response.status, body: value }
}

async function readBoundedBody(response, limit) {
  if (!response.body?.getReader) {
    const text = await response.text()
    check(Buffer.byteLength(text, 'utf8') <= limit, 'RESPONSE_TOO_LARGE')
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error('RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, total).toString('utf8')
}

function reportDateInNewYork(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export async function submitCollectorPublication(profile, credentials, publication, {
  fetchImpl = fetch, signal, onRequestStarted,
} = {}) {
  const envelopeBytes = Buffer.byteLength(JSON.stringify(publication.envelope), 'utf8')
  check(envelopeBytes <= MAX_ENVELOPE_BYTES, 'ENVELOPE_TOO_LARGE')
  const response = await collectorRequest(profile, credentials, '/api/collector/publication', {
    body: {
      attemptId: publication.attemptId,
      fence: publication.fence,
      configSha256: publication.configSha256,
      envelope: publication.envelope,
    },
    idempotencyKey: publication.idempotencyKey,
    fetchImpl,
    signal,
    onRequestStarted,
    maxResponseBytes: MAX_ENVELOPE_BYTES,
  })
  const result = response.body
  check(result && ['published_verified', 'unchanged_verified', 'reconciliation_required', 'preflight_retryable'].includes(result.status), 'PUBLICATION_RESPONSE_INVALID')
  check(result.attemptId === publication.attemptId && result.bundleSha256 === publication.envelope.bundleSha256 && result.reportDate === publication.envelope.reportDate, 'PUBLICATION_RESPONSE_MISMATCH')
  const responseKeys = ['reconciliation_required', 'preflight_retryable'].includes(result.status)
    ? ['status', 'attemptId', 'bundleSha256', 'reportDate', 'ready']
    : ['status', 'attemptId', 'bundleSha256', 'reportDate', 'counts', 'ready', 'verifiedAt']
  check(Object.keys(result).every(key => responseKeys.includes(key)), 'PUBLICATION_RESPONSE_INVALID')
  if (['reconciliation_required', 'preflight_retryable'].includes(result.status)) check(result.ready === false, 'PUBLICATION_RESPONSE_INVALID')
  else {
    check(result.ready === true && isIso(result.verifiedAt), 'PUBLICATION_NOT_VERIFIED')
    const countNames = ['inventory', 'managerDispositions', 'transfers', 'attention']
    check(result.counts && typeof result.counts === 'object' && !Array.isArray(result.counts) &&
      Object.keys(result.counts).every(key => countNames.includes(key)) &&
      countNames.every(key => Number.isSafeInteger(result.counts[key]) && result.counts[key] >= 0), 'PUBLICATION_RESPONSE_INVALID')
  }
  return result
}

export const collectorLimits = Object.freeze({ jsonBytes: MAX_JSON_BYTES, envelopeBytes: MAX_ENVELOPE_BYTES })
