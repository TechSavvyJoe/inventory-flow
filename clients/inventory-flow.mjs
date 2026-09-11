/** Backend-only, dependency-free client for the Inventory Flow read API. */
const DEFAULT_BASE_URL = 'https://inventory-data.joegallant.me/api/v1/'
const INVENTORY_FIELDS = ['q', 'store', 'make', 'model', 'year', 'minPrice', 'maxPrice', 'minMileage', 'maxMileage', 'holdState', 'sort', 'direction', 'limit', 'cursor']
const CHANGE_FIELDS = ['q', 'store', 'type', 'from', 'to', 'limit', 'cursor']
const MANAGER_DISPOSITION_FIELDS = ['q', 'store', 'delivered', 'review', 'limit', 'cursor']
const SAFE_ERROR_CODES = new Set(['INVALID_QUERY', 'INVALID_CURSOR', 'NOT_FOUND', 'INSUFFICIENT_SCOPE', 'FORBIDDEN', 'SOURCE_DATA_UNAVAILABLE', 'INTEGRATION_UNAVAILABLE', 'INTEGRATION_DATA_UNAVAILABLE', 'INTEGRATION_AUDIT_UNAVAILABLE', 'INTEGRATION_RATE_LIMITED', 'INTEGRATION_TOKEN_INVALID', 'INTEGRATION_GRANT_INACTIVE', 'INTEGRATIONS_NOT_CONFIGURED', 'INTEGRATION_RESPONSE_TOO_LARGE', 'RESPONSE_TOO_LARGE'])

export class InventoryFlowError extends Error {
  constructor(code, { status = 0, retryAfter = null } = {}) {
    const messages = {
      INVALID_CURSOR: 'The inventory snapshot changed or the cursor is invalid. Start a new listing from the first page.',
      RESPONSE_TOO_LARGE: 'The response exceeds the client limit. Request a smaller page.',
      INTEGRATION_RESPONSE_TOO_LARGE: 'The response exceeds the server limit. Request a smaller page.',
      TIMEOUT: 'The inventory request timed out.', ABORTED: 'The inventory request was canceled.',
      REDIRECT_REJECTED: 'The inventory API answered with a redirect, which this client refuses to follow.',
      SERVER_ONLY: 'Use the inventory API client in a trusted server, not in browser code.',
    }
    super(messages[code] || 'The inventory request could not be completed.')
    this.name = 'InventoryFlowError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

const failure = (code, options) => { throw new InventoryFlowError(code, options) }

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new InventoryFlowError('ABORTED'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function boundedJson(response, maximum, signal) {
  const size = response.headers.get('content-length')
  if (size && /^\d+$/.test(size) && Number(size) > maximum) {
    void response.body?.cancel().catch(() => {})
    failure('RESPONSE_TOO_LARGE', { status: response.status })
  }
  const type = response.headers.get('content-type') ?? ''
  if (!/^application\/(?:json|problem\+json)(?:\s*;|$)/i.test(type)) {
    void response.body?.cancel().catch(() => {})
    failure('INVALID_RESPONSE', { status: response.status })
  }
  if (!response.body?.getReader) failure('INVALID_RESPONSE', { status: response.status })
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      length += value.byteLength
      if (length > maximum) failure('RESPONSE_TOO_LARGE', { status: response.status })
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { failure('INVALID_RESPONSE', { status: response.status }) }
}

function queryParameters(query, allowed) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || ![Object.prototype, null].includes(Object.getPrototypeOf(query))) failure('INVALID_QUERY')
  const result = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) failure('INVALID_QUERY')
    if (value === undefined) continue
    const type = typeof value
    const booleanField = ['delivered', 'review'].includes(key)
    if ((booleanField ? type !== 'boolean' : !['string', 'number'].includes(type)) || (type === 'number' && !Number.isFinite(value)) || String(value).length > (key === 'cursor' ? 8192 : 256)) failure('INVALID_QUERY')
    result.set(key, String(value))
  }
  return result
}

/**
 * token: a backend secret string or async () => secret. Never put it in a URL,
 * browser bundle, localStorage, telemetry, or an AI prompt.
 * baseUrl must be an operator-approved HTTPS API origin.
 */
export function createInventoryFlowClient({ token, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch, timeoutMs = 15000, maxResponseBytes = 1048576 } = {}) {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') failure('SERVER_ONLY')
  if (!['string', 'function'].includes(typeof token) || typeof fetchImpl !== 'function') failure('INVALID_CONFIGURATION')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1048576) failure('INVALID_CONFIGURATION')
  let base
  try {
    base = new URL(baseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) failure('INVALID_CONFIGURATION')
    if (!base.pathname.endsWith('/')) base.pathname += '/'
  } catch { failure('INVALID_CONFIGURATION') }

  async function request(path, query, allowed, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'signal')) failure('INVALID_CONFIGURATION')
    const external = options.signal
    if (external && (typeof external.addEventListener !== 'function' || typeof external.removeEventListener !== 'function' || typeof external.aborted !== 'boolean')) failure('INVALID_CONFIGURATION')
    if (external?.aborted) failure('ABORTED')
    const url = new URL(path, base)
    url.search = queryParameters(query, allowed).toString()
    const controller = new AbortController()
    let timedOut = false
    const cancel = () => controller.abort()
    external?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      let credential
      try { credential = await abortable(typeof token === 'function' ? token() : token, controller.signal) } catch {
        if (controller.signal.aborted) failure(timedOut ? 'TIMEOUT' : 'ABORTED')
        failure('TOKEN_UNAVAILABLE')
      }
      if (typeof credential !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(credential)) failure('TOKEN_UNAVAILABLE')
      // `redirect: 'error'` said exactly what we want — never follow a redirect,
      // so the Bearer credential can never be forwarded to another origin — but
      // Cloudflare Workers (Workerd) does not support that mode and throws at
      // fetch time, which turned every call from a Worker-hosted consumer into
      // NETWORK_ERROR. `manual` is supported everywhere; the refusal moves here,
      // before the body is touched. Runtimes surface a manual redirect either as
      // the 3xx response itself or as an opaque redirect with status 0.
      const response = await abortable(fetchImpl(url.href, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` }, credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: controller.signal }), controller.signal)
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        void response.body?.cancel().catch(() => {})
        failure('REDIRECT_REJECTED', { status: response.status })
      }
      const payload = await boundedJson(response, maxResponseBytes, controller.signal)
      if (!response.ok) {
        const code = SAFE_ERROR_CODES.has(payload?.error?.code) ? payload.error.code : 'HTTP_ERROR'
        const rawRetry = response.headers.get('retry-after')
        const retryAfter = rawRetry && /^\d{1,6}$/.test(rawRetry) ? Number(rawRetry) : null
        failure(code, { status: response.status, retryAfter })
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) failure('INVALID_RESPONSE', { status: response.status })
      return payload
    } catch (error) {
      if (controller.signal.aborted) failure(timedOut ? 'TIMEOUT' : 'ABORTED')
      if (error instanceof InventoryFlowError) throw error
      // Do not surface fetch/provider error text; it can include the URL or token.
      failure('NETWORK_ERROR')
    } finally {
      clearTimeout(timer)
      external?.removeEventListener('abort', cancel)
    }
  }

  const client = {
    inventory(query = {}, options) { return request('inventory', query, INVENTORY_FIELDS, options) },
    vehicle(vin, options) {
      if (typeof vin !== 'string' || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return Promise.reject(new InventoryFlowError('INVALID_QUERY'))
      return request(`vehicles/${encodeURIComponent(vin.toUpperCase())}`, {}, [], options)
    },
    changes(query = {}, options) { return request('changes', query, CHANGE_FIELDS, options) },
    dataHealth(options) { return request('data-health', {}, [], options) },
    holdSummary(query = {}, options) { return request('holds/summary', query, ['store'], options) },
    managerDispositions(query = {}, options) { return request('manager-dispositions', query, MANAGER_DISPOSITION_FIELDS, options) },
    capabilities(options) { return request('capabilities', {}, [], options) },
    async *iterateInventory(query = {}, options) {
      queryParameters(query, INVENTORY_FIELDS)
      let cursor = query.cursor
      const seen = new Set(cursor ? [cursor] : [])
      while (true) {
        const page = await client.inventory({ ...query, ...(cursor ? { cursor } : {}) }, options)
        if (!Array.isArray(page.data) || !page.pagination || !Number.isSafeInteger(page.pagination.total) || page.pagination.total < 0 || !Number.isSafeInteger(page.pagination.returned) || page.pagination.returned !== page.data.length || page.data.length > 100) failure('INVALID_RESPONSE')
        const next = page.pagination.nextCursor
        if (next !== null && (typeof next !== 'string' || next.length === 0 || next.length > 8192 || seen.has(next) || !page.data.length)) failure('INVALID_RESPONSE')
        for (const vehicle of page.data) yield vehicle
        cursor = next
        if (cursor === null) return
        seen.add(cursor)
        // Never restart silently: it could mix snapshots or duplicate consumed rows.
      }
    },
    async *iterateManagerDispositions(query = {}, options) {
      queryParameters(query, MANAGER_DISPOSITION_FIELDS)
      let cursor = query.cursor
      const seen = new Set(cursor ? [cursor] : [])
      while (true) {
        const page = await client.managerDispositions({ ...query, ...(cursor ? { cursor } : {}) }, options)
        if (!Array.isArray(page.data) || !page.pagination || !Number.isSafeInteger(page.pagination.total) || page.pagination.total < 0 || !Number.isSafeInteger(page.pagination.returned) || page.pagination.returned !== page.data.length || page.data.length > 100) failure('INVALID_RESPONSE')
        const next = page.pagination.nextCursor
        if (next !== null && (typeof next !== 'string' || next.length === 0 || next.length > 8192 || seen.has(next) || !page.data.length)) failure('INVALID_RESPONSE')
        for (const disposition of page.data) yield disposition
        cursor = next
        if (cursor === null) return
        seen.add(cursor)
      }
    },
  }
  return Object.freeze(client)
}
