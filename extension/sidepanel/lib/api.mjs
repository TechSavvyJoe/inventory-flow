// Reads use the app's authenticated JSON API. The sole write is a user-clicked
// saved-list mutation brokered through the service worker into the app origin;
// no general-purpose write proxy exists.

export class PanelApiError extends Error {
  constructor(kind, { status = 0, code = null } = {}) {
    super(kind)
    this.name = 'PanelApiError'
    this.kind = kind // signin | forbidden | offline | server | invalid
    this.status = status
    this.code = code
  }
}

function requestFor(workspace, settings, path) {
  const url = new URL(path, workspace.origin)
  const headers = { Accept: 'application/json' }
  if (workspace.demo) {
    // The synthetic demo server reads its identity from these headers and
    // query fields; production ignores both and uses the Access session.
    url.searchParams.set('homeStore', settings.demoStore)
    url.searchParams.set('role', settings.demoRole)
    headers['x-inventory-demo-role'] = settings.demoRole
    headers['x-inventory-demo-store'] = settings.demoStore
    headers['x-inventory-demo-user'] = 'Local prototype user'
  }
  return { url: url.href, init: { method: 'GET', headers, credentials: 'include', redirect: 'manual', cache: 'no-store' } }
}

export function bootstrapRequest(workspace, settings) { return requestFor(workspace, settings, '/api/bootstrap') }
export function vehicleRequest(workspace, settings, vin) { return requestFor(workspace, settings, `/api/vehicles/${encodeURIComponent(String(vin).toUpperCase())}`) }
export function companionReleaseRequest(workspace, settings) { return requestFor(workspace, settings, '/downloads/companion-version.json') }
export function savedListsRequest(workspace, settings) { return requestFor(workspace, settings, '/api/saved-lists') }

// The panel polls the same one or two documents repeatedly (bootstrap on an
// interval, the open vehicle on demand). Keep only the last payload and its
// ETag per URL so an unchanged poll can send If-None-Match and reuse it
// instead of re-parsing the whole document. Page-session only, in memory —
// nothing here is written to storage or survives a reload.
const revalidated = new Map()
let cacheGeneration = 0

export function clearApiCache() {
  cacheGeneration += 1
  revalidated.clear()
}

function assertCurrentGeneration(generation) {
  if (generation !== cacheGeneration) throw new DOMException('Access changed', 'AbortError')
}

async function fetchJson({ url, init }, { fetchImpl, signal }) {
  const generation = cacheGeneration
  const cached = revalidated.get(url)
  const headers = cached ? { ...init.headers, 'If-None-Match': cached.etag } : init.headers
  let response
  try {
    response = await fetchImpl(url, { ...init, headers, signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new PanelApiError('offline')
  }
  assertCurrentGeneration(generation)
  // Access answers an unauthenticated request with a redirect to its login
  // page; with redirect: 'manual' that surfaces as an opaque redirect. A 304
  // is also in the 300s, so it must be carved out before this check.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400 && response.status !== 304) || response.status === 401) {
    clearApiCache()
    throw new PanelApiError('signin', { status: response.status })
  }
  // Must sit before the `!response.ok` check below — a 304 is not "ok" but
  // means the cached payload is still current.
  if (response.status === 304 && cached) return cached.payload
  const contentType = response.headers.get('content-type') ?? ''
  const isJson = /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType)
  if (response.status === 403) {
    // Revoke from headers alone: an error body can stall indefinitely.
    clearApiCache()
    throw new PanelApiError('forbidden', { status: 403 })
  }
  if (response.status === 404) throw new PanelApiError('notfound', { status: 404 })
  if (!response.ok) throw new PanelApiError('server', { status: response.status })
  if (!isJson) { clearApiCache(); throw new PanelApiError('signin', { status: response.status }) }
  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PanelApiError('invalid', { status: response.status })
  assertCurrentGeneration(generation)
  const etag = response.headers.get('etag')
  if (etag) revalidated.set(url, { etag, payload })
  else revalidated.delete(url)
  return payload
}

export async function fetchBootstrap(workspace, settings, { fetchImpl = globalThis.fetch, signal } = {}) {
  const payload = await fetchJson(bootstrapRequest(workspace, settings), { fetchImpl, signal })
  if (!Array.isArray(payload.vehicles) || !payload.meta) throw new PanelApiError('invalid')
  return payload
}

/**
 * Bootstrap already includes the captured vehicle reports used by list
 * summaries. Detail adds public-scan context and role-filtered DealerMail
 * evidence (backups, comments, alerts, CDK), fetched only after opening.
 */
export async function fetchVehicle(workspace, settings, vin, { fetchImpl = globalThis.fetch, signal } = {}) {
  const payload = await fetchJson(vehicleRequest(workspace, settings, vin), { fetchImpl, signal })
  if (typeof payload.vin !== 'string' || payload.vin.toUpperCase() !== String(vin).toUpperCase()) throw new PanelApiError('invalid')
  return payload
}

function validSavedList(value) {
  return value && typeof value === 'object' && typeof value.id === 'string' &&
    typeof value.label === 'string' && Number.isSafeInteger(value.revision) &&
    typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' && Array.isArray(value.items) &&
    value.items.every((item) => item && typeof item.vin === 'string' && typeof item.addedAt === 'string' && typeof item.available === 'boolean')
}

export async function fetchSavedLists(workspace, settings, { fetchImpl = globalThis.fetch, signal } = {}) {
  const payload = await fetchJson(savedListsRequest(workspace, settings), { fetchImpl, signal })
  if (!Array.isArray(payload.lists) || !payload.lists.every(validSavedList)) throw new PanelApiError('invalid')
  return payload
}

export async function mutateSavedList(workspace, settings, input, { idempotencyKey, signal, runtime = globalThis.chrome?.runtime } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!runtime?.sendMessage) {
    // Browser preview and unit tests run on the demo page origin, so their
    // ordinary fetch is same-origin. The shipped extension uses the guarded
    // service-worker path below.
    const request = requestFor(workspace, settings, '/api/saved-lists')
    const response = await fetch(request.url, {
      ...request.init, method: 'POST', signal,
      headers: { ...request.init.headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }).catch((error) => { if (error?.name === 'AbortError') throw error; throw new PanelApiError('offline') })
    if (response.status === 401 || response.type === 'opaqueredirect') throw new PanelApiError('signin', { status: response.status })
    if (response.status === 403) throw new PanelApiError('forbidden', { status: 403 })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new PanelApiError('server', { status: response.status, code: payload?.code ?? null })
    if (!(payload?.deleted === true ? typeof payload.id === 'string' && Number.isSafeInteger(payload.revision) : validSavedList(payload))) throw new PanelApiError('invalid')
    clearApiCache()
    return payload
  }
  const outcome = await runtime.sendMessage({
    type: 'inventory-flow:saved-list-mutation', origin: workspace.origin, input, idempotencyKey,
    ...(workspace.demo ? { demo: { role: settings.demoRole, store: settings.demoStore } } : {}),
  })
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (outcome?.kind === 'signin' || outcome?.redirected || outcome?.status === 401) throw new PanelApiError('signin', { status: outcome?.status ?? 0 })
  if (outcome?.kind === 'offline') throw new PanelApiError('offline')
  if (outcome?.status === 403) throw new PanelApiError('forbidden', { status: 403, code: outcome.payload?.code ?? null })
  if (!outcome || outcome.status < 200 || outcome.status >= 300) throw new PanelApiError('server', { status: outcome?.status ?? 0, code: outcome?.payload?.code ?? null })
  const payload = outcome.payload
  if (!(payload?.deleted === true ? typeof payload.id === 'string' && Number.isSafeInteger(payload.revision) : validSavedList(payload))) throw new PanelApiError('invalid')
  clearApiCache()
  return payload
}

export async function fetchCompanionRelease(workspace, settings, { fetchImpl = globalThis.fetch, signal } = {}) {
  const payload = await fetchJson(companionReleaseRequest(workspace, settings), { fetchImpl, signal })
  if (!/^\d+\.\d+\.\d+$/.test(String(payload.version ?? '')) || payload.downloadPath !== '/downloads/inventory-flow-deal-desk.zip') {
    throw new PanelApiError('invalid')
  }
  return { version: payload.version, downloadPath: payload.downloadPath }
}
