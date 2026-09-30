// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let listsApi: typeof import('../../src/lib/saved-lists-api')
const fetchMock = vi.fn<typeof fetch>()

beforeEach(async () => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  listsApi = await import('../../src/lib/saved-lists-api')
})
afterEach(() => vi.unstubAllGlobals())

describe('saved-list employee owner fence transport', () => {
  it('attaches the server-confirmed employee to list reads and writes', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ lists:[] }), { headers:{ 'content-type':'application/json' } }))
    await listsApi.getSavedVehicleLists('sales', 'Howell', 'synthetic-owner-a')
    await listsApi.mutateSavedVehicleList({ action:'create', label:'AB' }, 'sales', 'Howell', 'synthetic-owner-a')
    for (const [, init] of fetchMock.mock.calls) expect(new Headers(init?.headers).get('x-inventory-saved-list-owner')).toBe('synthetic-owner-a')
  })

  it('never shares an uncertain mutation retry key between employees with the same display context', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const create = (owner: string) => listsApi.mutateSavedVehicleList({ action:'create', label:'AB' }, 'sales', 'Howell', owner)
    await expect(create('synthetic-owner-a')).rejects.toThrow('offline')
    await expect(create('synthetic-owner-b')).rejects.toThrow('offline')
    await expect(create('synthetic-owner-a')).rejects.toThrow('offline')
    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'))
    expect(keys[0]).toBe(keys[2])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('fails closed before transport without a stable employee identity', () => {
    expect(() => listsApi.getSavedVehicleLists('sales', 'Howell', '')).toThrow(/employee identity/)
    expect(() => listsApi.mutateSavedVehicleList({ action:'create', label:'AB' }, 'sales', 'Howell', '')).toThrow(/employee identity/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
