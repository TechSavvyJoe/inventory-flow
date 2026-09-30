import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { reportAccessFailure } from '../../lib/apiSession'
import type { InventoryVehicle } from './types'
import { useSyncedCustomerLists } from './useSyncedCustomerLists'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('../../lib/saved-lists-api', async (original) => ({
  ...await original<typeof import('../../lib/saved-lists-api')>(),
  getSavedVehicleLists: api.get,
  mutateSavedVehicleList: api.mutate,
}))

const vehicle = { id:'vehicle-1', vin:'1FTFW1E84RKF00001', stockNumber:'H00001', year:2026, make:'Ford', model:'F-150', price:50000, publicListing:{ dataState:'current', isListed:true }, dealerOn:{ dataState:'current', inStock:true, inTransit:false, inProduction:false }, dealerMail:{ dataState:'current', hasActiveHold:false, position:null }, location:{ homeStore:{ id:'howell', name:'Howell' } } } as InventoryVehicle
const list = (revision = 1) => ({ id:'list-1', label:'AB', revision, createdAt:'2026-09-30T12:00:00Z', updatedAt:'2026-09-30T12:00:00Z', items:[{ vin:vehicle.vin, addedAt:'2026-09-30T12:00:00Z', available:true }] })
const options = { enabled:true, ownerId:'synthetic-owner-a', role:'sales' as const, store:'Howell' as const, context:'sales:Howell:user', authorizedVehicles:[vehicle] }

beforeEach(() => { api.get.mockReset(); api.mutate.mockReset() })
afterEach(cleanup)

describe('useSyncedCustomerLists', () => {
  it('clears the previous owner even with unchanged display context when the new owner refresh fails', async () => {
    api.get.mockResolvedValueOnce({ lists:[list()] }).mockRejectedValueOnce(new Error('offline for B'))
    const { result, rerender } = renderHook(({ ownerId }) => useSyncedCustomerLists({ ...options, ownerId }), { initialProps:{ ownerId:'synthetic-owner-a' } })
    await waitFor(() => expect(result.current.management?.activeLabel).toBe('AB'))
    rerender({ ownerId:'synthetic-owner-b' })
    expect(result.current.entries).toEqual([])
    expect(result.current.management?.lists).toEqual([])
    await waitFor(() => expect(result.current.management?.error).toBe('offline for B'))
    expect(result.current.count).toBe(0)
    expect(result.current.management?.readyForWrites).toBe(false)
    expect(api.get.mock.calls.map(call => call[2])).toEqual(['synthetic-owner-a', 'synthetic-owner-b'])
  })

  it('discards late reads from the previous owner without restoring labels or VINs', async () => {
    let finishA!: (value: { lists: ReturnType<typeof list>[] }) => void
    api.get.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve })).mockResolvedValueOnce({ lists:[] })
    const { result, rerender } = renderHook(({ ownerId }) => useSyncedCustomerLists({ ...options, ownerId }), { initialProps:{ ownerId:'synthetic-owner-a' } })
    rerender({ ownerId:'synthetic-owner-b' })
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    await act(async () => finishA({ lists:[list()] }))
    expect(result.current.management?.lists).toEqual([])
    expect(result.current.entries).toEqual([])
  })

  it('discards a late mutation after an owner switch and never continues the old VIN add', async () => {
    let finishCreate!: (value: ReturnType<typeof list>) => void
    api.get.mockResolvedValue({ lists:[] })
    api.mutate.mockImplementationOnce(() => new Promise(resolve => { finishCreate = resolve }))
    const { result, rerender } = renderHook(({ ownerId }) => useSyncedCustomerLists({ ...options, ownerId }), { initialProps:{ ownerId:'synthetic-owner-a' } })
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    expect(api.mutate.mock.calls[0][3]).toBe('synthetic-owner-a')
    rerender({ ownerId:'synthetic-owner-b' })
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    await act(async () => finishCreate({ ...list(), items:[] }))
    expect(api.mutate).toHaveBeenCalledTimes(1)
    expect(result.current.management?.lists).toEqual([])
    expect(result.current.management?.saving).toBe(false)
  })

  it('does not continue a pending first save after the employee workspace unmounts', async () => {
    let finishCreate!: (value: ReturnType<typeof list>) => void
    api.get.mockResolvedValue({ lists:[] })
    api.mutate.mockImplementationOnce(() => new Promise(resolve => { finishCreate = resolve }))
    const { result, unmount } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    unmount()
    await act(async () => finishCreate({ ...list(), items:[] }))
    expect(api.mutate).toHaveBeenCalledTimes(1)
  })

  it('refuses all list reads and writes without a stable employee identity', async () => {
    const { result } = renderHook(() => useSyncedCustomerLists({ ...options, ownerId:null }))
    act(() => result.current.add(vehicle))
    await act(async () => { await result.current.management?.createList('AB') })
    expect(api.get).not.toHaveBeenCalled()
    expect(api.mutate).not.toHaveBeenCalled()
    expect(result.current.management?.readyForWrites).toBe(false)
  })

  it('does not create a default list until the initial saved-list read is confirmed', async () => {
    let resolveInitial!: (value: { lists: ReturnType<typeof list>[] }) => void
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve }))
    api.mutate
      .mockResolvedValueOnce({ ...list(1), items:[], label:'Customer shortlist' })
      .mockResolvedValueOnce({ ...list(2), label:'Customer shortlist' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    expect(result.current.management?.readyForWrites).toBe(false)

    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()

    await act(async () => resolveInitial({ lists:[] }))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
  })

  it('keeps writes blocked after an initial read failure until retry confirms the lists', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ lists:[] })
    api.mutate
      .mockResolvedValueOnce({ ...list(1), items:[], label:'Customer shortlist' })
      .mockResolvedValueOnce({ ...list(2), label:'Customer shortlist' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.error).toBe('offline'))
    expect(result.current.management?.readyForWrites).toBe(false)

    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()

    act(() => result.current.management?.retry())
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
  })

  it('retains last confirmed references when a refresh fails', async () => {
    api.get.mockResolvedValueOnce({ lists:[list()] }).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => result.current.management?.retry())
    await waitFor(() => expect(result.current.management?.error).toBe('offline'))
    expect(result.current.entries[0]).toMatchObject({ vin:vehicle.vin, available:true })
  })

  it('creates the default list only on the first explicit save, then confirms the added vehicle', async () => {
    api.get.mockResolvedValue({ lists:[] })
    api.mutate
      .mockResolvedValueOnce({ ...list(1), items:[], label:'Customer shortlist' })
      .mockResolvedValueOnce({ ...list(2), label:'Customer shortlist' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    expect(api.mutate).not.toHaveBeenCalled()
    act(() => result.current.add(vehicle))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
    expect(api.mutate.mock.calls[0][0]).toEqual({ action:'create', label:'Customer shortlist' })
    expect(api.mutate.mock.calls[1][0]).toMatchObject({ action:'add', listId:'list-1', expectedRevision:1, vin:vehicle.vin })
    await waitFor(() => expect(result.current.count).toBe(1))
  })

  it('clears confirmed references on auth revocation and performs no reads while disabled', async () => {
    api.get.mockResolvedValueOnce({ lists:[list()] }).mockRejectedValueOnce(new ApiError('signed out', 401))
    const { result, rerender } = renderHook(({ enabled }) => useSyncedCustomerLists({ ...options, enabled }), { initialProps:{ enabled:true } })
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => result.current.management?.retry())
    await waitFor(() => expect(result.current.count).toBe(0))
    rerender({ enabled:false })
    const callsAfterDisable = api.get.mock.calls.length
    act(() => window.dispatchEvent(new Event('focus')))
    expect(api.get).toHaveBeenCalledTimes(callsAfterDisable)
  })

  it('keeps unavailable central references while exposing no stale vehicle facts', async () => {
    api.get.mockResolvedValue({ lists:[{ ...list(), items:[{ vin:'WITHHELDVIN000001', addedAt:'2026-09-30T12:00:00Z', available:false }] }] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.count).toBe(1))
    expect(result.current.entries[0]).toEqual(expect.objectContaining({ vin:'WITHHELDVIN000001', displayName:'Vehicle unavailable', price:null, available:false }))
  })

  it('does not let an older poll overwrite a newer confirmed write', async () => {
    let resolvePoll!: (value: { lists: ReturnType<typeof list>[] }) => void
    api.get.mockResolvedValueOnce({ lists:[list()] }).mockImplementationOnce(() => new Promise(resolve => { resolvePoll = resolve }))
    api.mutate.mockResolvedValueOnce({ ...list(2), items:[] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => result.current.management?.retry())
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    act(() => result.current.remove(vehicle.vin))
    await waitFor(() => expect(result.current.count).toBe(0))
    await act(async () => resolvePoll({ lists:[list()] }))
    expect(result.current.count).toBe(0)
  })

  it('refreshes a conflicted list but keeps the redo instruction visible', async () => {
    api.get.mockResolvedValueOnce({ lists:[list()] }).mockResolvedValueOnce({ lists:[list(3)] })
    api.mutate.mockRejectedValueOnce(new ApiError('conflict', 409))
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => result.current.remove(vehicle.vin))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.management?.error).toMatch(/changed on another device/i))
    expect(result.current.count).toBe(1)
  })

  it('discards a late mutation response after the employee context changes', async () => {
    let resolveCreate!: (value: ReturnType<typeof list>) => void
    api.get.mockResolvedValue({ lists:[] })
    api.mutate.mockImplementationOnce(() => new Promise(resolve => { resolveCreate = resolve }))
    const { result, rerender } = renderHook(({ context }) => useSyncedCustomerLists({ ...options, context }), { initialProps:{ context:'employee-a' } })
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(1))
    rerender({ context:'employee-b' })
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await act(async () => resolveCreate({ ...list(), label:'Customer shortlist', items:[] }))
    expect(result.current.count).toBe(0)
    expect(result.current.management?.lists).toEqual([])
    expect(result.current.management?.saving).toBe(false)
    expect(api.mutate).toHaveBeenCalledTimes(1)
  })

  it('blocks two same-tick saves from creating overlapping lists', async () => {
    let resolveCreate!: (value: ReturnType<typeof list>) => void
    api.get.mockResolvedValue({ lists:[] })
    api.mutate
      .mockImplementationOnce(() => new Promise(resolve => { resolveCreate = resolve }))
      .mockResolvedValueOnce(list(2))
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => { result.current.add(vehicle); result.current.add(vehicle) })
    expect(api.mutate).toHaveBeenCalledTimes(1)
    await act(async () => resolveCreate({ ...list(), label:'Customer shortlist', items:[] }))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
    expect(api.mutate.mock.calls.filter(([input]) => input.action === 'create')).toHaveLength(1)
  })

  it('retries an uncertain write with the same mutation instead of treating a GET as confirmation', async () => {
    api.get.mockResolvedValue({ lists:[list()] })
    api.mutate.mockRejectedValueOnce(new TypeError('network interrupted')).mockResolvedValueOnce({ ...list(2), items:[] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => result.current.remove(vehicle.vin))
    await waitFor(() => expect(result.current.management?.error).toMatch(/network interrupted/))
    act(() => result.current.management?.retry())
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
    expect(api.mutate.mock.calls[1][0]).toEqual(api.mutate.mock.calls[0][0])
    expect(api.get).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.count).toBe(0))
  })

  it('clears list data when the shared API session reports an access failure', async () => {
    api.get.mockResolvedValue({ lists:[list()] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => reportAccessFailure({ status:403, role:'sales', store:'Howell', message:'access revoked' }))
    expect(result.current.count).toBe(0)
    expect(result.current.management?.error).toMatch(/access changed/i)
  })

  it('finishes the original VIN add after an uncertain default-list create is retried', async () => {
    api.get.mockResolvedValue({ lists:[] })
    api.mutate
      .mockRejectedValueOnce(new TypeError('create response interrupted'))
      .mockResolvedValueOnce({ ...list(1), label:'Customer shortlist', items:[] })
      .mockResolvedValueOnce({ ...list(2), label:'Customer shortlist' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await waitFor(() => expect(result.current.management?.pendingAction).toBe(true))
    act(() => result.current.management?.retry())
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(3))
    expect(api.mutate.mock.calls[1][0]).toEqual(api.mutate.mock.calls[0][0])
    expect(api.mutate.mock.calls[2][0]).toEqual({ action:'add', listId:'list-1', expectedRevision:1, vin:vehicle.vin })
    await waitFor(() => expect(result.current.count).toBe(1))
    expect(result.current.management?.pendingAction).toBe(false)
  })

  it('selects the next remaining list after deleting the active list', async () => {
    const second = { ...list(), id:'list-2', label:'CD', items:[] }
    api.get.mockResolvedValue({ lists:[list(), second] })
    api.mutate.mockResolvedValueOnce({ id:'list-1', deleted:true, revision:2 })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.activeListId).toBe('list-1'))
    await act(async () => { await result.current.management?.deleteActiveList() })
    expect(result.current.management?.activeListId).toBe('list-2')
    expect(result.current.management?.activeLabel).toBe('CD')
  })
})
