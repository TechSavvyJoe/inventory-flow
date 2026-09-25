// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let api: typeof import('../../lib/api')
let session: typeof import('../../lib/apiSession')
const fetchMock = vi.fn<typeof fetch>()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(async () => {
  vi.resetModules(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock)
  api = await import('../../lib/api'); session = await import('../../lib/apiSession')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('vehicle issue API client', () => {
  it('uses direct record responses and retries an interrupted create with the same idempotency key', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Connection lost')).mockResolvedValueOnce(json({ id: 'issue-1' }, 201))
    const input = { category: 'cleaning' as const, priority: 'normal' as const, description: 'Synthetic floor mats need cleaning.' }
    await expect(api.createVehicleIssue('TEST VIN', input, 'sales', 'Howell')).rejects.toThrow('Connection lost')
    await expect(api.createVehicleIssue('TEST VIN', input, 'sales', 'Howell')).resolves.toEqual({ id: 'issue-1' })
    const headers = fetchMock.mock.calls.map(([, options]) => new Headers(options?.headers))
    expect(headers[0].get('Idempotency-Key')).toBe(headers[1].get('Idempotency-Key'))
    expect(headers[0].get('Idempotency-Key')).toBeTruthy()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/vehicles/TEST%20VIN/issues')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(input)
  })

  it('sends the expected version and preserves a conflict for explicit UI recovery', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Issue changed. Reload it.' }, 409))
    await expect(api.appendVehicleIssueEvent('issue/id', { type: 'complete', expectedVersion: 7, note: 'Checked the repair.' }, 'manager', 'Howell')).rejects.toMatchObject({ status: 409 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/vehicle-issues/issue%2Fid/events')
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ type: 'complete', expectedVersion: 7, note: 'Checked the repair.' })
  })

  it('fetches authorized JPEG bytes with the active identity and disables browser caching', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } }))
    const result = await api.getVehicleIssuePhoto('issue/id', 'photo/id', 'manager', 'Howell')
    expect(result.type).toBe('image/jpeg'); expect(result.size).toBe(4)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/vehicle-issues/issue%2Fid/photos/photo%2Fid')
    const options = fetchMock.mock.calls[0][1]!
    expect(options.cache).toBe('no-store')
    expect(new Headers(options.headers).get('x-inventory-preview-role')).toBe('manager')
    expect(new Headers(options.headers).get('x-inventory-preview-store')).toBe('Howell')
  })

  it.each([401, 403])('reports denied photo access to the existing session guard (%i)', async status => {
    const listener = vi.fn(), unsubscribe = session.subscribeAccessFailures(listener)
    fetchMock.mockResolvedValue(json({ error: 'Denied' }, status))
    await expect(api.getVehicleIssuePhoto('issue', 'photo', 'sales', 'Howell')).rejects.toMatchObject({ status })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status, role: 'sales', store: 'Howell' }))
    unsubscribe()
  })

  it('treats a sign-in page as expired access rather than displaying it as a photo', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(api.getVehicleIssuePhoto('issue', 'photo', 'sales', 'Howell')).rejects.toMatchObject({ status: 401 })
  })

  it('cancels obsolete photo requests without turning caller cancellation into a timeout', async () => {
    const controller = new AbortController(), aborted = new DOMException('Context changed.', 'AbortError')
    fetchMock.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(aborted), { once: true }) }))
    const pending = api.getVehicleIssuePhoto('issue', 'photo', 'sales', 'Howell', controller.signal)
    const outcome = expect(pending).rejects.toBe(aborted)
    controller.abort(); await outcome
  })
})
