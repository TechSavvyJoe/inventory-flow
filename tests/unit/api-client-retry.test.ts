// PRODUCT-RULE TEST
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferEventInput, TransferRequestInput } from '../../src/types'

let api: typeof import('../../src/lib/api')
const fetchMock = vi.fn<typeof fetch>()
const input: TransferRequestInput = {
  vin: '1FTFW1E50NFA00001',
  requestedBy: 'Synthetic salesperson',
  requestingStore: 'Howell',
  neededBy: '2026-09-03T12:00:00Z',
  reason: 'Synthetic test appointment',
  customerAppointment: true,
  returnRequired: true,
  priority: 'normal',
}
const event: TransferEventInput = {
  type: 'note_added', actor: 'Synthetic salesperson', actorRole: 'sales', store: 'Howell', note: 'Synthetic note',
}
const json = (body: unknown = { id: 'synthetic-transfer' }, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
})
const keyAt = (index: number) => new Headers(fetchMock.mock.calls[index][1]?.headers).get('Idempotency-Key')
const create = () => api.createTransfer(input, 'sales', 'Howell')

beforeEach(async () => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  api = await import('../../src/lib/api')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('page-session mutation retries', () => {
  it('cancels an obsolete transfer read without misreporting a server timeout', async () => {
    const controller = new AbortController()
    const aborted = new DOMException('Selection changed.', 'AbortError')
    fetchMock.mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(aborted), { once: true })
    }))
    const pending = api.getTransfer('old-transfer', 'manager', 'Howell', controller.signal)
    const outcome = expect(pending).rejects.toBe(aborted)
    const sentSignal = fetchMock.mock.calls[0][1]?.signal
    expect(sentSignal?.aborted).toBe(false)
    controller.abort()
    expect(sentSignal?.aborted).toBe(true)
    await outcome
  })

  it('reuses a key after a network failure and clears it after confirmed success', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Connection lost')).mockImplementation(async () => json())
    await expect(create()).rejects.toThrow('Connection lost')
    await create()
    await create()
    expect(keyAt(0)).toMatch(/^[a-f0-9-]{36}$/)
    expect(keyAt(1)).toBe(keyAt(0))
    expect(keyAt(2)).not.toBe(keyAt(0))
  })

  it('aborts a stalled connection itself and classifies it as a retryable timeout', async () => {
    // A dealership network can stall a connection without ever failing it,
    // which previously left `fetch` pending with no recovery path. The mock
    // below hangs exactly like that — it only settles when the signal the
    // client passed is aborted — so this proves the client's own timer fires
    // and aborts it, not merely that an AbortError is mapped to 408. The
    // timeout must not be confused with a real network failure (whose raw
    // message the case above still expects to see unchanged).
    // Only the timer functions are faked: the idempotency key is derived with
    // a real `crypto.subtle.digest`, which needs the real event loop to settle.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let signal: AbortSignal | undefined
      fetchMock.mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined
        signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
      })).mockImplementation(async () => json())
      const pending = create()
      const outcome = expect(pending).rejects.toMatchObject({ status: 408, message: expect.stringMatching(/timed out/i) })
      while (!signal) await new Promise((resolve) => setImmediate(resolve))
      await vi.advanceTimersByTimeAsync(19_999)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal.aborted).toBe(true)
      await outcome
      await create()
      expect(keyAt(1)).toBe(keyAt(0))
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([408, 425, 429, 500, 502, 503])('retains the action key for an uncertain or retryable HTTP %i response', async (status) => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Try again' }, status)).mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ status })
    await create()
    expect(keyAt(1)).toBe(keyAt(0))
  })

  it.each([400, 403, 404, 409, 422])('clears a key after a definitive HTTP %i rejection', async (status) => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Action rejected' }, status)).mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ status })
    await create()
    expect(keyAt(1)).not.toBe(keyAt(0))
  })

  it('shares a key between overlapping duplicates, including a retry while another response is pending', async () => {
    const responses: Array<(response: Response) => void> = []
    fetchMock.mockImplementation(() => new Promise((resolve) => responses.push(resolve)))
    const first = create()
    const second = create()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(keyAt(1)).toBe(keyAt(0))
    responses[0](json())
    await first
    const third = create()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(keyAt(2)).toBe(keyAt(0))
    responses[1](json())
    responses[2](json())
    await Promise.all([second, third])
    fetchMock.mockImplementation(async () => json())
    await create()
    expect(keyAt(3)).not.toBe(keyAt(0))
  })

  it('shares a key for duplicate submissions made in the same turn even when a response is immediate', async () => {
    fetchMock.mockImplementation(async () => json())
    await Promise.all([create(), create()])
    expect(keyAt(1)).toBe(keyAt(0))
  })

  it('isolates keys by body, route, and role/store identity', async () => {
    fetchMock.mockRejectedValue(new TypeError('Connection lost'))
    const fail = async (operation: Promise<unknown>) => expect(operation).rejects.toThrow('Connection lost')
    await fail(create())
    await fail(api.createTransfer({ ...input, reason: 'Different synthetic request' }, 'sales', 'Howell'))
    await fail(api.createTransfer(input, 'manager', 'Howell'))
    await fail(api.createTransfer(input, 'sales', 'Lincoln'))
    await fail(api.appendTransferEvent('transfer-one', event, 'sales', 'Howell'))
    await fail(api.appendTransferEvent('transfer-two', event, 'sales', 'Howell'))
    await fail(api.appendAttentionEvent('transfer-one', event, 'sales', 'Howell'))
    expect(new Set(fetchMock.mock.calls.map((_, index) => keyAt(index))).size).toBe(7)
    await fail(create())
    expect(keyAt(7)).toBe(keyAt(0))
  })

  it('sends direct-move intent, destination, and movement time but not client-controlled identity', async () => {
    fetchMock.mockImplementation(async () => json())
    await api.createTransfer({
      vin: input.vin,
      intent: 'direct',
      requestingStore: input.requestingStore,
      destinationStore: 'Ford Detroit',
      requestedBy: input.requestedBy,
      movedAt: '2026-09-02T16:00:00.000Z',
      reason: input.reason,
      customerAppointment: input.customerAppointment,
      returnRequired: input.returnRequired,
      priority: input.priority,
    }, 'manager', 'Howell')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      vin: input.vin,
      intent: 'direct',
      destinationStore: 'Ford Detroit',
      movedAt: '2026-09-02T16:00:00.000Z',
    })
    expect(body).not.toHaveProperty('requestedBy')
    expect(body).not.toHaveProperty('requestingStore')
  })

  it('keeps uncertain retry memory bounded and expires old idle actions', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    fetchMock.mockRejectedValue(new TypeError('Connection lost'))
    for (let index = 0; index < 129; index += 1) {
      now += 1
      await expect(api.createTransfer({ ...input, reason: `Synthetic request ${index}` }, 'sales', 'Howell')).rejects.toThrow()
    }
    await expect(api.createTransfer({ ...input, reason: 'Synthetic request 0' }, 'sales', 'Howell')).rejects.toThrow()
    expect(keyAt(129)).not.toBe(keyAt(0))
    await expect(create()).rejects.toThrow()
    const beforeExpiry = keyAt(130)
    now += 31 * 60 * 1000
    await expect(create()).rejects.toThrow()
    expect(keyAt(131)).not.toBe(beforeExpiry)
  })

  it('retains a key if a successful JSON response is damaged', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{', { headers: { 'Content-Type': 'application/json' } }))
      .mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ status: 502 })
    await create()
    expect(keyAt(1)).toBe(keyAt(0))
  })
})

describe('response body deadlines', () => {
  it('lets the large bootstrap body finish after the ordinary request deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let signal: AbortSignal | undefined
      let reading = false
      let resolveBody!: (value: unknown) => void
      fetchMock.mockImplementationOnce(async (_input, init) => {
        signal = init?.signal ?? undefined
        const response = json()
        vi.spyOn(response, 'json').mockImplementation(() => {
          reading = true
          return new Promise((resolve) => { resolveBody = resolve })
        })
        return response
      })

      const pending = api.getBootstrap('Howell', 'manager')
      while (!reading) await new Promise((resolve) => setImmediate(resolve))

      await vi.advanceTimersByTimeAsync(20_000)
      expect(signal?.aborted).toBe(false)
      resolveBody({ meta: { reportDate: '2026-09-15' }, vehicles: [] })
      await expect(pending).resolves.toMatchObject({ meta: { reportDate: '2026-09-15' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a stalled bootstrap body as a retryable timeout rather than damaged JSON', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let signal: AbortSignal | undefined
      let reading = false
      fetchMock.mockImplementationOnce(async (_input, init) => {
        signal = init?.signal ?? undefined
        const response = json()
        vi.spyOn(response, 'json').mockImplementation(() => {
          reading = true
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            }, { once: true })
          })
        })
        return response
      })

      const pending = api.getBootstrap('Howell', 'manager')
      const outcome = expect(pending).rejects.toMatchObject({
        status: 408,
        message: expect.stringMatching(/response took too long to finish/i),
      })
      while (!reading) await new Promise((resolve) => setImmediate(resolve))

      await vi.advanceTimersByTimeAsync(59_999)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal?.aborted).toBe(true)
      await outcome
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the original 20-second body deadline and retry key for mutations', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let signal: AbortSignal | undefined
      let reading = false
      fetchMock.mockImplementationOnce(async (_input, init) => {
        signal = init?.signal ?? undefined
        const response = json()
        vi.spyOn(response, 'json').mockImplementation(() => {
          reading = true
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            }, { once: true })
          })
        })
        return response
      }).mockImplementation(async () => json())

      const pending = create()
      const outcome = expect(pending).rejects.toMatchObject({ status: 408 })
      while (!reading) await new Promise((resolve) => setImmediate(resolve))

      await vi.advanceTimersByTimeAsync(19_999)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal?.aborted).toBe(true)
      await outcome

      await create()
      expect(keyAt(1)).toBe(keyAt(0))
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves intentional caller cancellation while a response body is being read', async () => {
    const controller = new AbortController()
    const aborted = new DOMException('Selection changed.', 'AbortError')
    let reading = false
    fetchMock.mockImplementationOnce(async (_input, init) => {
      const response = json()
      vi.spyOn(response, 'json').mockImplementation(() => {
        reading = true
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(aborted), { once: true })
        })
      })
      return response
    })

    const pending = api.getTransfer('old-transfer', 'manager', 'Howell', controller.signal)
    while (!reading) await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await expect(pending).rejects.toBe(aborted)
  })
})

describe('Access sign-in and response handling', () => {
  it('shows a friendly sign-in instruction for a successful HTML login page without losing an uncertain action key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Cloudflare Access login</html>', { headers: { 'Content-Type': 'text/html' } }))
      .mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ name: 'ApiError', status: 401, message: expect.stringMatching(/reload.*sign in/i) })
    await create()
    expect(keyAt(1)).toBe(keyAt(0))
  })

  it('recognizes a confirmed Access redirect even if its response claims JSON', async () => {
    const login = json({ login: true })
    Object.defineProperty(login, 'url', { value: 'https://synthetic.cloudflareaccess.com/cdn-cgi/access/login' })
    fetchMock.mockResolvedValueOnce(login).mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/reload.*sign in/i) })
    await create()
    expect(keyAt(1)).not.toBe(keyAt(0))
  })

  it('replaces a technical 401 message with the sign-in instruction and clears the rejected key', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Missing JWT assertion' }, 401)).mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/reload.*sign in/i) })
    await create()
    expect(keyAt(1)).not.toBe(keyAt(0))
  })

  it('does not expose HTML errors and retains a key after a non-JSON server failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Internal details</html>', {
      status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/html' },
    })).mockImplementation(async () => json())
    await expect(create()).rejects.toMatchObject({ status: 503, message: 'Service Unavailable' })
    await create()
    expect(keyAt(1)).toBe(keyAt(0))
  })

  it('supports JSON media types and does not add mutation headers to reads', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"synthetic"}', { headers: { 'Content-Type': 'application/vnd.inventory+json' } }))
    await expect(api.getTransfer('synthetic', 'sales', 'Howell')).resolves.toMatchObject({ id: 'synthetic' })
    expect(keyAt(0)).toBeNull()
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('x-inventory-demo-role')).toBe('sales')
    expect(headers.get('x-inventory-preview-role')).toBe('sales')
    expect(headers.get('x-inventory-demo-store')).toBe('Howell')
    expect(headers.get('x-inventory-preview-store')).toBe('Howell')
  })
})

describe('session access and confirmed writes', () => {
  it('keeps a marked operation refusal local to the action without reporting lost workspace access', async () => {
    const { isOperationDenial, subscribeAccessFailures } = await import('../../src/lib/apiSession')
    const listener = vi.fn()
    const unsubscribe = subscribeAccessFailures(listener)
    try {
      const response = json({ error: 'Only a manager can move this vehicle.', code: 'FORBIDDEN' }, 403)
      response.headers.set('X-Inventory-Error-Scope', 'operation')
      fetchMock.mockResolvedValueOnce(response)
      const caught = await create().catch(error => error)
      expect(caught).toMatchObject({ status: 403, code: 'FORBIDDEN' })
      expect(isOperationDenial(caught)).toBe(true)
      expect(listener).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it.each([
    { error: 'Only a manager can move this vehicle.', code: 'FORBIDDEN' },
    { error: 'Access changed', code: 'EMPLOYEE_NOT_AUTHORIZED', errorScope: 'operation' },
    { error: 'Unknown response', code: 'UNKNOWN', operationDenied: true },
  ])('never trusts an unmarked 403 body to retain the workspace (%j)', async body => {
    const { isOperationDenial, subscribeAccessFailures } = await import('../../src/lib/apiSession')
    const listener = vi.fn()
    const unsubscribe = subscribeAccessFailures(listener)
    try {
      fetchMock.mockResolvedValueOnce(json(body, 403))
      const caught = await create().catch(error => error)
      expect(caught).toMatchObject({ status: 403 })
      expect(isOperationDenial(caught)).toBe(false)
      expect(listener).toHaveBeenCalledOnce()
    } finally { unsubscribe() }
  })

  it('does not treat a non-JSON 403 with a copied operation header as an authenticated operation denial', async () => {
    const { subscribeAccessFailures } = await import('../../src/lib/apiSession')
    const listener = vi.fn()
    const unsubscribe = subscribeAccessFailures(listener)
    try {
      fetchMock.mockResolvedValueOnce(new Response('Access denied', { status: 403, headers: { 'Content-Type': 'text/html', 'X-Inventory-Error-Scope': 'operation' } }))
      await expect(create()).rejects.toMatchObject({ status: 403 })
      expect(listener).toHaveBeenCalledOnce()
    } finally { unsubscribe() }
  })

  it.each([401, 403] as const)('reports HTTP %i with request context so the workspace can purge protected records', async (status) => {
    const { subscribeAccessFailures } = await import('../../src/lib/apiSession')
    const listener = vi.fn()
    const unsubscribe = subscribeAccessFailures(listener)
    try {
      fetchMock.mockResolvedValueOnce(json({ error: 'Access changed' }, status))
      await expect(api.getVehicle('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS', 'manager', 'Lincoln')).rejects.toMatchObject({ status })
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status, role: 'manager', store: 'Lincoln' }))
    } finally {
      unsubscribe()
    }
  })

  it('invalidates access as soon as forbidden headers arrive even if its response body stalls', async () => {
    const { subscribeAccessFailures } = await import('../../src/lib/apiSession')
    const listener = vi.fn()
    const unsubscribe = subscribeAccessFailures(listener)
    let finish!: (body: unknown) => void
    const response = json({ error: 'Access changed' }, 403)
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    fetchMock.mockResolvedValueOnce(response)
    const pending = api.getVehicle('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS', 'sales', 'Howell')
    const outcome = expect(pending).rejects.toMatchObject({ status: 403 })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    finish({ error: 'Access changed' })
    await outcome
    unsubscribe()
  })

  it('advances the mutation revision only after a confirmed successful save', async () => {
    const { confirmedMutationRevision } = await import('../../src/lib/apiSession')
    const before = confirmedMutationRevision()
    fetchMock.mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValueOnce(json())
    await expect(create()).rejects.toThrow('Offline')
    expect(confirmedMutationRevision()).toBe(before)
    await create()
    expect(confirmedMutationRevision()).toBe(before + 1)
  })

  it('passes caller cancellation through the bootstrap body read', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    }))
    const pending = api.getBootstrap('Howell', 'manager', controller.signal)
    const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await outcome
  })

  it('does not invalidate the current workspace for a request from an earlier access generation', async () => {
    const { invalidateApiAccess, subscribeAccessFailures } = await import('../../src/lib/apiSession')
    const listener = vi.fn()
    const unsubscribe = subscribeAccessFailures(listener)
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = api.getVehicle('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS', 'manager', 'Howell')
    const outcome = expect(pending).rejects.toMatchObject({ status: 401 })
    invalidateApiAccess()
    finish(json({ error: 'Old session' }, 401))
    await outcome
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

})

describe('bootstrap revalidation', () => {
  const bootstrapJson = (etag: string) => new Response(JSON.stringify({ meta: { reportDate: '2026-09-22' }, vehicles: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: etag },
  })
  const headerAt = (index: number, name: string) => new Headers(fetchMock.mock.calls[index][1]?.headers).get(name)

  it('sends the stored validator and reuses the same payload object on 304', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapJson('"a"'))
    const first = await api.getBootstrap('Howell', 'manager')
    expect(headerAt(0, 'If-None-Match')).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"a"' } }))
    const second = await api.getBootstrap('Howell', 'manager')
    expect(headerAt(1, 'If-None-Match')).toBe('"a"')
    expect(second).toBe(first)
    // A changed document replaces the payload and the validator.
    fetchMock.mockResolvedValueOnce(bootstrapJson('"b"'))
    const third = await api.getBootstrap('Howell', 'manager')
    expect(third).not.toBe(first)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }))
    await api.getBootstrap('Howell', 'manager')
    expect(headerAt(3, 'If-None-Match')).toBe('"b"')
  })

  it('never reuses a validator across an access change', async () => {
    const session = await import('../../src/lib/apiSession')
    fetchMock.mockResolvedValueOnce(bootstrapJson('"a"'))
    await api.getBootstrap('Howell', 'manager')
    session.invalidateApiAccess()
    fetchMock.mockResolvedValueOnce(bootstrapJson('"c"'))
    await api.getBootstrap('Howell', 'manager')
    expect(headerAt(1, 'If-None-Match')).toBeNull()
  })

  it('keeps validators per document, so another store never answers for this one', async () => {
    fetchMock.mockResolvedValueOnce(bootstrapJson('"howell"'))
    await api.getBootstrap('Howell', 'manager')
    fetchMock.mockResolvedValueOnce(bootstrapJson('"lincoln"'))
    await api.getBootstrap('Lincoln', 'manager')
    expect(headerAt(1, 'If-None-Match')).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }))
    await api.getBootstrap('Howell', 'manager')
    expect(headerAt(2, 'If-None-Match')).toBe('"howell"')
  })
})
