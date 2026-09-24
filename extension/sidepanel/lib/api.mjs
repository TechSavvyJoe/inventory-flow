// The panel's only network path: a GET of the app's own bootstrap document,
// sent with the browser's cookies so the user's existing Cloudflare Access
// session carries it. The panel never posts; actions deep-link into the app.

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
    headers['x-inventory-demo-user'] = 'Deal desk panel'
  }
  return { url: url.href, init: { method: 'GET', headers, credentials: 'include', redirect: 'manual', cache: 'no-store' } }
}

export function bootstrapRequest(workspace, settings) { return requestFor(workspace, settings, '/api/bootstrap') }
export function vehicleRequest(workspace, settings, vin) { return requestFor(workspace, settings, `/api/vehicles/${encodeURIComponent(String(vin).toUpperCase())}`) }

// The panel polls the same one or two documents repeatedly (bootstrap on an
// interval, the open vehicle on demand). Keep only the last payload and its
// ETag per URL so an unchanged poll can send If-None-Match and reuse it
// instead of re-parsing the whole document. Page-session only, in memory —
// nothing here is written to storage or survives a reload.
const revalidated = new Map()

async function fetchJson({ url, init }, { fetchImpl, signal }) {
  const cached = revalidated.get(url)
  const headers = cached ? { ...init.headers, 'If-None-Match': cached.etag } : init.headers
  let response
  try {
    response = await fetchImpl(url, { ...init, headers, signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new PanelApiError('offline')
  }
  // Access answers an unauthenticated request with a redirect to its login
  // page; with redirect: 'manual' that surfaces as an opaque redirect. A 304
  // is also in the 300s, so it must be carved out before this check.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400 && response.status !== 304) || response.status === 401) {
    throw new PanelApiError('signin', { status: response.status })
  }
  // Must sit before the `!response.ok` check below — a 304 is not "ok" but
  // means the cached payload is still current.
  if (response.status === 304 && cached) return cached.payload
  const contentType = response.headers.get('content-type') ?? ''
  const isJson = /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType)
  if (response.status === 403) {
    const body = isJson ? await response.json().catch(() => null) : null
    throw new PanelApiError('forbidden', { status: 403, code: body?.code ?? null })
  }
  if (response.status === 404) throw new PanelApiError('notfound', { status: 404 })
  if (!response.ok) throw new PanelApiError('server', { status: response.status })
  if (!isJson) throw new PanelApiError('signin', { status: response.status })
  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PanelApiError('invalid', { status: response.status })
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
