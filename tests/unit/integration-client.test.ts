// @ts-nocheck -- dependency-free ESM client, synthetic network responses only.
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createInventoryFlowClient, InventoryFlowError } from '../../clients/inventory-flow.mjs'

const TOKEN = 'iflow_synthetic_secret_do_not_use_live'
const VIN = '1FTFW1E50NFA00001'
const json = (body, options = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...options })
const page = (id, nextCursor = null) => ({ data: [{ vin: VIN, id }], meta: { reportDate: '2026-09-09' }, pagination: { total: 2, returned: 1, limit: 1, nextCursor } })

describe('Inventory Flow backend JavaScript client', () => {
  it('uses only Bearer headers, GET, no credentials, no redirects and safe query encoding', async () => {
    const fetch = vi.fn(async () => json(page(1)))
    const client = createInventoryFlowClient({ token: TOKEN, fetch })
    await client.inventory({ q: 'F-150 | *?~ $42,810', store: 'Ford Detroit', limit: 20 })
    const [url, init] = fetch.mock.calls[0]
    expect(new URL(url).pathname).toBe('/api/v1/inventory')
    expect(new URL(url).searchParams.get('q')).toBe('F-150 | *?~ $42,810')
    expect(url).not.toContain(TOKEN)
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual', headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } })
    // Workerd below compatibility date 2024-11-11 throws on any `cache` option,
    // which turned every call from a Worker-hosted consumer into NETWORK_ERROR.
    expect(init).not.toHaveProperty('cache')
  })

  it('works on a runtime whose fetch rejects the cache option outright', async () => {
    const fetch = vi.fn(async (_url, init) => {
      if ('cache' in init) throw new TypeError("The 'cache' field on 'RequestInitializerDict' is not implemented.")
      return json(page(1))
    })
    const client = createInventoryFlowClient({ token: TOKEN, fetch })
    await expect(client.inventory()).resolves.toMatchObject({ pagination: { total: 2 } })
  })

  it('refuses a redirect before reading the body so the credential is never forwarded', async () => {
    // Cloudflare Workers (Workerd) rejects redirect: 'error' at fetch time, so the
    // client asks for 'manual' and must refuse the redirect itself. Node/undici
    // hand back the 3xx response; browser-style runtimes hand back an opaque
    // redirect with status 0. Both must be refused without a second fetch.
    for (const response of [
      new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
      Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' }),
    ]) {
      const fetch = vi.fn(async () => response)
      const client = createInventoryFlowClient({ token: TOKEN, fetch })
      await expect(client.inventory()).rejects.toMatchObject({ name: 'InventoryFlowError', code: 'REDIRECT_REJECTED' })
      expect(fetch).toHaveBeenCalledTimes(1)
      const [, init] = fetch.mock.calls[0]
      expect(init.redirect).toBe('manual')
    }
  })

  it('supports an async secret provider without caching the credential', async () => {
    const token = vi.fn(async () => TOKEN)
    const client = createInventoryFlowClient({ token, fetch: async () => json(page(1)) })
    await client.inventory(); await client.inventory()
    expect(token).toHaveBeenCalledTimes(2)
  })

  it('matches all six REST paths with no extra query parameters', async () => {
    const fetch = vi.fn(async () => json({ data: {} }))
    const client = createInventoryFlowClient({ token: TOKEN, fetch, baseUrl: 'https://approved.example/api/v1' })
    await client.vehicle(VIN.toLowerCase()); await client.changes({ type: 'price_change', from: '2026-09-09' }); await client.dataHealth(); await client.holdSummary({ store: 'Howell' }); await client.managerDispositions({ delivered: true, review: false }); await client.capabilities()
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([`/api/v1/vehicles/${VIN}`, '/api/v1/changes', '/api/v1/data-health', '/api/v1/holds/summary', '/api/v1/manager-dispositions', '/api/v1/capabilities'])
    const managerUrl = new URL(fetch.mock.calls[4][0])
    expect(Object.fromEntries(managerUrl.searchParams)).toEqual({ delivered: 'true', review: 'false' })
  })

  it('iterates page cursors without mutating caller query', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(page(1, 'page2.signed'))).mockResolvedValueOnce(json(page(2)))
    const query = { q: 'Ford', limit: 1 }, client = createInventoryFlowClient({ token: TOKEN, fetch })
    const results = []
    for await (const value of client.iterateInventory(query)) results.push(value.id)
    expect(results).toEqual([1, 2])
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('page2.signed')
    expect(query).toEqual({ q: 'Ford', limit: 1 })
  })

  it('iterates redacted manager-disposition pages without restarting or accepting a cursor loop', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(page(1, 'manager.page2'))).mockResolvedValueOnce(json(page(2)))
    const client = createInventoryFlowClient({ token: TOKEN, fetch })
    const values = []
    for await (const value of client.iterateManagerDispositions({ delivered: true, limit: 1 })) values.push(value.id)
    expect(values).toEqual([1, 2])
    expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/api/v1/manager-dispositions')
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('manager.page2')
    const loop = createInventoryFlowClient({ token: TOKEN, fetch: async () => json(page(1, 'repeat.manager')) }).iterateManagerDispositions({ limit: 1 })
    await loop.next()
    await expect(loop.next()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('stops rather than silently restarting when a snapshot cursor becomes invalid', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(page(1, 'old.cursor'))).mockResolvedValueOnce(json({ error: { code: 'INVALID_CURSOR' } }, { status: 400 }))
    const client = createInventoryFlowClient({ token: TOKEN, fetch })
    const iterate = client.iterateInventory({ limit: 1 })
    expect((await iterate.next()).value.id).toBe(1)
    await expect(iterate.next()).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects looping pagination', async () => {
    const client = createInventoryFlowClient({ token: TOKEN, fetch: async () => json(page(1, 'repeat.cursor')) })
    const iterate = client.iterateInventory()
    await iterate.next()
    await expect(iterate.next()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each(['http://example.com/api/v1', 'https://name:password@example.com/api/v1', 'https://example.com/api?token=x', 'https://example.com/api#secret', 'not a url'])('rejects unsafe base URL %s', baseUrl => {
    expect(() => createInventoryFlowClient({ token: TOKEN, baseUrl })).toThrow(InventoryFlowError)
  })

  it.each([{ token: 'oops' }, { q: ['bad'] }, { cursor: 'a'.repeat(8193) }, { q: null }, { q: true }, { unknown: 'bad' }])('rejects unknown query fields and complex values %#', async query => {
    const fetch = vi.fn(), client = createInventoryFlowClient({ token: TOKEN, fetch })
    await expect(client.inventory(query)).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([{ delivered: 'yes' }, { review: 1 }, { customerName: 'private' }, { cursor: 'a'.repeat(8193) }, { q: false }])('rejects invalid manager-disposition query values %#', async query => {
    const fetch = vi.fn(), client = createInventoryFlowClient({ token: TOKEN, fetch })
    await expect(client.managerDispositions(query)).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid VINs before issuing a network call', async () => {
    const fetch = vi.fn(), client = createInventoryFlowClient({ token: TOKEN, fetch })
    await expect(client.vehicle('../token')).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes network and token-provider failures that contain credentials or URLs', async () => {
    for (const options of [
      { token: TOKEN, fetch: () => { throw new Error(`https://example.com/?token=${TOKEN}`) } },
      { token: () => { throw new Error(TOKEN) }, fetch: vi.fn() },
      { token: `bad\r\n${TOKEN}`, fetch: vi.fn() },
    ]) {
      const client = createInventoryFlowClient(options)
      try { await client.inventory(); throw new Error('Expected failure') } catch (error) { expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(TOKEN); expect(error).toBeInstanceOf(InventoryFlowError) }
    }
  })

  it('does not reflect response error text or arbitrary codes; preserves safe status and retry delay', async () => {
    const client = createInventoryFlowClient({ token: TOKEN, fetch: async () => json({ error: { code: TOKEN, message: `URL https://example.com/?token=${TOKEN}` } }, { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } }) })
    const error = await client.inventory().catch(value => value)
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 429, retryAfter: 30 })
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(TOKEN)
  })

  it.each([
    ['a plain-text 429 from an edge rate limiter', new Response('rate limited', { status: 429, headers: { 'content-type': 'text/plain', 'retry-after': '45' } }), { code: 'HTTP_ERROR', status: 429, retryAfter: 45 }],
    ['an HTML 502 generated by the edge', new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }), { code: 'HTTP_ERROR', status: 502, retryAfter: null }],
    ['a 503 with no body at all', new Response(null, { status: 503, headers: { 'retry-after': '120' } }), { code: 'HTTP_ERROR', status: 503, retryAfter: 120 }],
    ['an error body larger than the client limit', new Response(JSON.stringify({ error: { code: 'INVALID_QUERY', detail: 'x'.repeat(400) } }), { status: 400, headers: { 'content-type': 'application/json' } }), { code: 'HTTP_ERROR', status: 400 }],
  ])('surfaces the status and retry delay of %s instead of INVALID_RESPONSE', async (_label, response, expected) => {
    // A consumer's retry loop keys off status and retryAfter. Insisting on a
    // JSON body before looking at either turned every non-JSON failure into a
    // generic INVALID_RESPONSE with the retry delay discarded.
    const client = createInventoryFlowClient({ token: TOKEN, maxResponseBytes: 200, fetch: async () => response })
    const error = await client.inventory().catch(value => value)
    expect(error).toBeInstanceOf(InventoryFlowError)
    expect(error).toMatchObject(expected)
    expect(error.message).not.toMatch(/502 Bad Gateway|rate limited/)
  })

  it('reports the server size cap under its own code, distinct from the client cap', async () => {
    // The API answers 413 { error: { code: 'RESPONSE_TOO_LARGE' } } when a page
    // exceeds its 1 MiB cap. The client uses that same code for its own
    // maxResponseBytes cap, so the two must not collapse into one: raising the
    // client limit fixes one, asking for a smaller page fixes the other.
    const client = createInventoryFlowClient({ token: TOKEN, fetch: async () => json({ error: { code: 'RESPONSE_TOO_LARGE' } }, { status: 413 }) })
    const error = await client.inventory().catch(value => value)
    expect(error).toMatchObject({ code: 'INTEGRATION_RESPONSE_TOO_LARGE', status: 413 })
    expect(error.message).toMatch(/server limit/)
    const capped = createInventoryFlowClient({ token: TOKEN, maxResponseBytes: 10, fetch: async () => json(page(1)) })
    await expect(capped.inventory()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', message: expect.stringMatching(/client limit/) })
  })

  it.each(['INVALID_QUERY', 'INSUFFICIENT_SCOPE', 'INTEGRATION_TOKEN_INVALID'])('preserves allowlisted nested REST error code %s', async code => {
    const client = createInventoryFlowClient({ token: TOKEN, fetch: async () => json({ error: { code } }, { status: 400 }) })
    await expect(client.inventory()).rejects.toMatchObject({ code, status: 400 })
  })

  it.each([{ code: 'INVALID_CURSOR' }, { error: 'INVALID_CURSOR' }, { error: null }, null])('sanitizes errors outside the nested REST contract %#', async payload => {
    const client = createInventoryFlowClient({ token: TOKEN, fetch: async () => json(payload, { status: 400 }) })
    await expect(client.inventory()).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 400 })
  })

  it('cancels an already-aborted request without reading the secret', async () => {
    const token = vi.fn(() => TOKEN), controller = new AbortController(); controller.abort()
    const client = createInventoryFlowClient({ token, fetch: vi.fn() })
    await expect(client.inventory({}, { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
    expect(token).not.toHaveBeenCalled()
  })

  it('cancels cleanly when the abort lands while the secret provider is still resolving', async () => {
    // The provider is awaited before fetch. If the caller cancels during that
    // await, the credential must not be handed to fetch at all, and a provider
    // that then fails must not leave an orphaned rejection behind — Node and
    // Workers can treat an unhandled rejection as fatal for the whole process.
    const orphaned = []
    const onUnhandled = reason => orphaned.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      // The abort is queued behind the provider's resolution so it lands in
      // the gap after the credential is in hand but before fetch is called.
      const resolving = new AbortController(), fetch = vi.fn()
      const client = createInventoryFlowClient({ token: async () => TOKEN, fetch })
      const pending = client.inventory({}, { signal: resolving.signal })
      queueMicrotask(() => resolving.abort())
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
      expect(fetch).not.toHaveBeenCalled()

      const failing = new AbortController()
      const late = createInventoryFlowClient({ token: async () => { failing.abort(); throw new Error(`provider lost ${TOKEN}`) }, fetch })
      const error = await late.inventory({}, { signal: failing.signal }).catch(value => value)
      expect(error).toMatchObject({ code: 'ABORTED' })
      expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(TOKEN)
      expect(fetch).not.toHaveBeenCalled()
      await new Promise(resolve => setImmediate(resolve))
      expect(orphaned).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('propagates caller abort and enforces timeout even on a hung fetch', async () => {
    const controller = new AbortController()
    const client = createInventoryFlowClient({ token: TOKEN, fetch: () => new Promise(() => {}), timeoutMs: 50 })
    const aborted = client.inventory({}, { signal: controller.signal }); controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(client.inventory()).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('times out a hung secret provider', async () => {
    const client = createInventoryFlowClient({ token: () => new Promise(() => {}), fetch: vi.fn(), timeoutMs: 5 })
    await expect(client.inventory()).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('limits response bytes whether or not Content-Length is present', async () => {
    const payload = { data: 'a'.repeat(200) }
    for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', 'content-length': '999' }]) {
      const client = createInventoryFlowClient({ token: TOKEN, maxResponseBytes: 100, fetch: async () => new Response(JSON.stringify(payload), { headers }) })
      await expect(client.inventory()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    }
  })

  it.each([
    new Response('<html>Login page</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{invalid json', { headers: { 'content-type': 'application/json' } }),
    json(null), json([]),
  ])('rejects unexpected or invalid response %#', async response => {
    const client = createInventoryFlowClient({ token: TOKEN, fetch: async () => response })
    await expect(client.inventory()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('keeps published OpenAPI query and scope vocabulary aligned with the implemented API', () => {
    const spec = JSON.parse(readFileSync(new URL('../../docs/inventory-flow.openapi.json', import.meta.url), 'utf8'))
    expect(spec.openapi).toBe('3.1.0')
    const operation = spec.paths['/inventory'].get
    expect(operation.parameters.map(value => value.name)).toEqual(['q', 'store', 'make', 'model', 'year', 'minPrice', 'maxPrice', 'minMileage', 'maxMileage', 'holdState', 'sort', 'direction', 'limit', 'cursor'])
    expect(operation.parameters.find(value => value.name === 'limit').schema).toMatchObject({ minimum: 1, maximum: 100, default: 20 })
    expect(spec.components.schemas.Scope.enum).toEqual(['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read'])
    expect(spec.components.schemas.Capabilities.properties.historicalSnapshots.const).toBe(false)
    expect(spec.components.schemas.Error).toEqual({
      type: 'object', additionalProperties: false, required: ['error'],
      properties: { error: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string' } } } },
    })
  })
})
