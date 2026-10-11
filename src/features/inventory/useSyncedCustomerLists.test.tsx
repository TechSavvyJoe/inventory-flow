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

beforeEach(() => { api.get.mockReset(); api.mutate.mockReset(); window.localStorage.clear() })
afterEach(cleanup)

describe('useSyncedCustomerLists', () => {
  it('does not let a late ordinary list read overwrite a freshly prepared comparison', async () => {
    let finishPoll!: (value: { lists: ReturnType<typeof list>[] }) => void
    api.get.mockResolvedValueOnce({ lists:[list()] })
      .mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve }))
      .mockResolvedValueOnce({ lists:[{ ...list(3), label:'New membership' }] })
    const { result } = renderHook(() => useSyncedCustomerLists({ ...options, refreshVehicles:async () => [vehicle] }))
    await waitFor(() => expect(result.current.count).toBe(1))
    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => { expect(await result.current.management?.prepareCustomerSheet?.()).toMatchObject({ label:'New membership' }) })
    await act(async () => finishPoll({ lists:[{ ...list(2), label:'Older poll' }] }))
    expect(result.current.management?.activeLabel).toBe('New membership')
  })

  it('discards a sheet whose list read was superseded while inventory refreshed', async () => {
    let finishInventory!: (value: InventoryVehicle[]) => void
    const refreshVehicles = vi.fn(() => new Promise<InventoryVehicle[]>(resolve => { finishInventory = resolve }))
    api.get.mockResolvedValueOnce({ lists:[list()] })
      .mockResolvedValueOnce({ lists:[{ ...list(2), label:'Older sheet list' }] })
      .mockResolvedValueOnce({ lists:[{ ...list(3), label:'Newer poll list' }] })
    const { result } = renderHook(() => useSyncedCustomerLists({ ...options, refreshVehicles }))
    await waitFor(() => expect(result.current.count).toBe(1))
    let pending!: Promise<unknown>
    act(() => { pending = result.current.management!.prepareCustomerSheet!() })
    await waitFor(() => expect(refreshVehicles).toHaveBeenCalledOnce())
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current.management?.activeLabel).toBe('Newer poll list'))
    await act(async () => { finishInventory([vehicle]); expect(await pending).toBeNull() })
    expect(result.current.management?.activeLabel).toBe('Newer poll list')
    expect(result.current.management?.preparingSheet).toBe(false)
  })

  it('requires naming a legacy list before adding through reopened list management', async () => {
    api.get.mockResolvedValue({ lists:[{ ...list(), label:'Customer shortlist', items:[] }] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    await act(async () => { expect(await result.current.management?.addVehicleToActiveList?.(vehicle.vin)).toBe(false) })
    expect(result.current.management?.pendingSave).toMatchObject({ vin:vehicle.vin, namingExistingList:true })
    expect(api.mutate).not.toHaveBeenCalled()
  })

  it('reopens the selected durable list after remount without storing labels or vehicle facts', async () => {
    const second = { ...list(), id:'list-2', label:'CD', items:[] }
    api.get.mockResolvedValue({ lists:[list(), second] })
    const first = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(first.result.current.management?.readyForWrites).toBe(true))
    act(() => first.result.current.management?.selectList('list-2'))
    first.unmount()
    const reopened = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(reopened.result.current.management?.activeLabel).toBe('CD'))
    expect(Array.from({ length:window.localStorage.length }, (_, index) => window.localStorage.getItem(window.localStorage.key(index)!))).toEqual(['list-2'])
    expect(api.mutate).not.toHaveBeenCalled()
  })

  it('adds a current vehicle to a reopened list using its confirmed revision', async () => {
    const second = { ...vehicle, id:'vehicle-2', vin:'1FTFW1E84RKF00002' }
    api.get.mockResolvedValue({ lists:[list(3)] })
    api.mutate.mockResolvedValue({ ...list(4), items:[...list().items, { vin:second.vin, addedAt:list().createdAt, available:true }] })
    const { result } = renderHook(() => useSyncedCustomerLists({ ...options, authorizedVehicles:[vehicle, second] }))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    await act(async () => { expect(await result.current.management?.addVehicleToActiveList?.(second.vin)).toBe(true) })
    expect(api.mutate.mock.calls[0][0]).toEqual({ action:'add', listId:'list-1', expectedRevision:3, vin:second.vin })
    expect(result.current.count).toBe(2)
    await act(async () => { expect(await result.current.management?.addVehicleToActiveList?.('not-authorized')).toBe(false) })
    expect(api.mutate).toHaveBeenCalledTimes(1)
  })

  it('builds each new sheet from freshly read membership, label and authorized inventory', async () => {
    const fresh = { ...vehicle, price:47000, mileage:22000 }
    const latest = { ...list(4), label:'AB updated', items:[...list().items, { vin:'WITHHELDVIN000001', addedAt:list().createdAt, available:false }] }
    api.get.mockResolvedValueOnce({ lists:[list()] }).mockResolvedValue({ lists:[latest] })
    const refreshVehicles = vi.fn().mockResolvedValue([fresh])
    const { result } = renderHook(() => useSyncedCustomerLists({ ...options, refreshVehicles }))
    await waitFor(() => expect(result.current.count).toBe(1))
    await act(async () => {
      expect(await result.current.management?.prepareCustomerSheet?.()).toMatchObject({ listId:'list-1', label:'AB updated', vehicles:[fresh], unavailableCount:1 })
    })
    expect(refreshVehicles).toHaveBeenCalledOnce()
    expect(result.current.count).toBe(2)
    expect(api.mutate).not.toHaveBeenCalled()
  })

  it('does not label last-loaded vehicle facts as fresh after an inventory refresh failure', async () => {
    api.get.mockResolvedValue({ lists:[list()] })
    const { result } = renderHook(() => useSyncedCustomerLists({ ...options, refreshVehicles:async () => null }))
    await waitFor(() => expect(result.current.count).toBe(1))
    await act(async () => { expect(await result.current.management?.prepareCustomerSheet?.()).toBeNull() })
    expect(result.current.management?.error).toMatch(/inventory could not be refreshed/)
    expect(result.current.entries[0].price).toBe(50000)
    expect(result.current.management?.preparingSheet).toBe(false)
  })

  it('discards a prepared sheet if its employee context changed during the refresh', async () => {
    let finish!: (vehicles: InventoryVehicle[]) => void
    api.get.mockResolvedValue({ lists:[list()] })
    const refreshVehicles = vi.fn(() => new Promise<InventoryVehicle[]>(resolve => { finish = resolve }))
    const { result, rerender } = renderHook(({ ownerId }) => useSyncedCustomerLists({ ...options, ownerId, refreshVehicles }), { initialProps:{ ownerId:'synthetic-owner-a' } })
    await waitFor(() => expect(result.current.count).toBe(1))
    let pending!: Promise<unknown>
    act(() => { pending = result.current.management!.prepareCustomerSheet!() })
    await waitFor(() => expect(refreshVehicles).toHaveBeenCalledOnce())
    rerender({ ownerId:'synthetic-owner-b' })
    await act(async () => { finish([vehicle]); expect(await pending).toBeNull() })
    expect(result.current.management?.preparingSheet).toBe(false)
  })

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
    act(() => { void result.current.management?.savePendingToNamedList?.('AB') })
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
    act(() => { void result.current.management?.savePendingToNamedList?.('AB') })
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

  it('does not request a list name until the initial saved-list read is confirmed', async () => {
    let resolveInitial!: (value: { lists: ReturnType<typeof list>[] }) => void
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve }))
    api.mutate
      .mockResolvedValueOnce({ ...list(1), items:[], label:'AB' })
      .mockResolvedValueOnce({ ...list(2), label:'AB' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    expect(result.current.management?.readyForWrites).toBe(false)

    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()

    await act(async () => resolveInitial({ lists:[] }))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
  })

  it('keeps writes blocked after an initial read failure until retry confirms the lists', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ lists:[] })
    api.mutate
      .mockResolvedValueOnce({ ...list(1), items:[], label:'AB' })
      .mockResolvedValueOnce({ ...list(2), label:'AB' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.error).toBe('offline'))
    expect(result.current.management?.readyForWrites).toBe(false)

    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()

    act(() => result.current.management?.retry())
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
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

  it('requires a name before the first save creates a list, then confirms the added vehicle', async () => {
    api.get.mockResolvedValue({ lists:[] })
    api.mutate
      .mockResolvedValueOnce({ ...list(1), items:[], label:'AB' })
      .mockResolvedValueOnce({ ...list(2), label:'AB' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    expect(api.mutate).not.toHaveBeenCalled()
    act(() => result.current.add(vehicle))
    expect(api.mutate).not.toHaveBeenCalled()
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
    expect(api.mutate.mock.calls[0][0]).toEqual({ action:'create', label:'AB' })
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
    act(() => { void result.current.management?.savePendingToNamedList?.('AB') })
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(1))
    rerender({ context:'employee-b' })
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await act(async () => resolveCreate({ ...list(), label:'AB', items:[] }))
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
    expect(api.mutate).not.toHaveBeenCalled()
    act(() => { void result.current.management?.savePendingToNamedList?.('AB'); void result.current.management?.savePendingToNamedList?.('AB') })
    expect(api.mutate).toHaveBeenCalledTimes(1)
    await act(async () => resolveCreate({ ...list(), label:'AB', items:[] }))
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

  it('finishes the original VIN add after an uncertain named-list create is retried', async () => {
    api.get.mockResolvedValue({ lists:[] })
    api.mutate
      .mockRejectedValueOnce(new TypeError('create response interrupted'))
      .mockResolvedValueOnce({ ...list(1), label:'AB', items:[] })
      .mockResolvedValueOnce({ ...list(2), label:'AB' })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
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
  it('cancels first-save naming without writing a default list', async () => {
    api.get.mockResolvedValue({ lists:[] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    expect(result.current.management?.pendingSave?.vin).toBe(vehicle.vin)
    act(() => result.current.management?.cancelPendingSave?.())
    expect(result.current.management?.pendingSave).toBeNull()
    expect(api.mutate).not.toHaveBeenCalled()
  })

  it('renames a legacy generic list in place before adding, retaining existing vehicles', async () => {
    const legacy = { ...list(), label:'Customer shortlist', items:[] }
    api.get.mockResolvedValue({ lists:[legacy] })
    api.mutate.mockResolvedValueOnce({ ...legacy, label:'AB', revision:2 }).mockResolvedValueOnce(list(3))
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    expect(result.current.management?.pendingSave?.namingExistingList).toBe(true)
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
    expect(api.mutate.mock.calls[0][0]).toEqual({ action:'rename', listId:'list-1', expectedRevision:1, label:'AB' })
    expect(api.mutate.mock.calls[1][0]).toMatchObject({ action:'add', listId:'list-1', expectedRevision:2 })
    expect(result.current.count).toBe(1)
    expect(result.current.management?.pendingSave).toBeNull()
  })

  it('rejects the legacy list as an existing target but permits another named list', async () => {
    const legacy = { ...list(), label:'Customer shortlist', items:[] }
    const named = { ...list(), id:'list-2', label:'CD', items:[] }
    api.get.mockResolvedValue({ lists:[legacy, named] })
    api.mutate.mockResolvedValueOnce({ ...named, revision:2, items:list().items })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await act(async () => {
      expect(await result.current.management?.savePendingToExistingList?.(legacy.id)).toBe(false)
    })
    expect(api.mutate).not.toHaveBeenCalled()
    expect(result.current.management?.pendingSave?.vin).toBe(vehicle.vin)
    expect(result.current.management?.error).toMatch(/Name this customer list/)
    await act(async () => {
      expect(await result.current.management?.savePendingToExistingList?.(named.id)).toBe(true)
    })
    expect(api.mutate.mock.calls[0][0]).toEqual({ action:'add', listId:'list-2', expectedRevision:1, vin:vehicle.vin })
    expect(result.current.management?.pendingSave).toBeNull()
  })

  it.each(['create', 'rename'] as const)('keeps naming actionable when a replayed %s is followed by a revision conflict', async (action) => {
    const legacy = { ...list(), label:'Customer shortlist', items:[] }
    const replay = { ...list(2), label:'AB', items:[] }
    const latest = { ...replay, revision:3 }
    api.get.mockResolvedValueOnce({ lists:action === 'rename' ? [legacy] : [] })
      .mockResolvedValue({ lists:[latest] })
    api.mutate.mockRejectedValueOnce(new TypeError('response interrupted'))
      .mockResolvedValueOnce(replay)
      .mockRejectedValueOnce(new ApiError('conflict', 409))
    if (action === 'rename') api.mutate.mockResolvedValueOnce({ ...latest, revision:4 })
    api.mutate.mockResolvedValueOnce({ ...latest, revision:action === 'rename' ? 5 : 4, items:list().items })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
    expect(result.current.management?.pendingAction).toBe(true)
    act(() => result.current.management?.retry())
    await waitFor(() => expect(result.current.management?.error).toMatch(/changed on another device/))
    await waitFor(() => expect(result.current.management?.loading).toBe(false))
    expect(api.mutate.mock.calls[1][0]).toEqual(api.mutate.mock.calls[0][0])
    expect(api.mutate.mock.calls[2][0]).toEqual({ action:'add', listId:'list-1', expectedRevision:2, vin:vehicle.vin })
    expect(result.current.count).toBe(0)
    expect(result.current.management?.pendingAction).toBe(false)
    expect(result.current.management?.pendingSave?.vin).toBe(vehicle.vin)
    // The reviewed current list can now receive the VIN without repeating the
    // interrupted create/rename or pretending the rejected add succeeded.
    await act(async () => {
      expect(await result.current.management?.savePendingToNamedList?.('AB')).toBe(true)
    })
    expect(result.current.count).toBe(1)
    expect(result.current.management?.pendingSave).toBeNull()
    expect(api.mutate.mock.calls.at(-1)?.[0]).toEqual({ action:'add', listId:'list-1', expectedRevision:action === 'rename' ? 4 : 3, vin:vehicle.vin })
  })

  it.each(['owner change', 'access revocation'] as const)('does not continue an interrupted first save after %s during replay', async (change) => {
    let finishReplay!: (value: ReturnType<typeof list>) => void
    api.get.mockResolvedValue({ lists:[] })
    api.mutate.mockRejectedValueOnce(new TypeError('response interrupted'))
      .mockImplementationOnce(() => new Promise(resolve => { finishReplay = resolve }))
    const { result, rerender } = renderHook(({ ownerId }) => useSyncedCustomerLists({ ...options, ownerId }), { initialProps:{ ownerId:'synthetic-owner-a' } })
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await act(async () => { await result.current.management?.savePendingToNamedList?.('AB') })
    act(() => result.current.management?.retry())
    if (change === 'owner change') rerender({ ownerId:'synthetic-owner-b' })
    else act(() => reportAccessFailure({ status:403, role:'sales', store:'Howell', message:'access revoked' }))
    await act(async () => finishReplay({ ...list(), items:[] }))
    expect(api.mutate).toHaveBeenCalledTimes(2)
    expect(result.current.management?.pendingSave).toBeNull()
    expect(result.current.management?.lists).toEqual([])
  })

  it('reuses a same-named list rather than creating another duplicate', async () => {
    api.get.mockResolvedValue({ lists:[list()] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    await act(async () => { await result.current.management?.createList(' ab ') })
    expect(api.mutate).not.toHaveBeenCalled()
    expect(result.current.management?.activeListId).toBe('list-1')
  })

  it('rejects missing names and contact information before creating anything', async () => {
    api.get.mockResolvedValue({ lists:[] })
    const { result } = renderHook(() => useSyncedCustomerLists(options))
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    await act(async () => { await result.current.management?.savePendingToNamedList?.('') })
    expect(result.current.management?.error).toMatch(/initials or a nickname/)
    await act(async () => { await result.current.management?.savePendingToNamedList?.('person@example.com') })
    expect(result.current.management?.error).toMatch(/without contact information/)
    expect(api.mutate).not.toHaveBeenCalled()
  })

  it('clears the naming draft when the employee changes or access is revoked', async () => {
    api.get.mockResolvedValue({ lists:[] })
    const { result, rerender } = renderHook(({ ownerId }) => useSyncedCustomerLists({ ...options, ownerId }), { initialProps:{ ownerId:'synthetic-owner-a' } })
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    rerender({ ownerId:'synthetic-owner-b' })
    expect(result.current.management?.pendingSave).toBeNull()
    await waitFor(() => expect(result.current.management?.readyForWrites).toBe(true))
    act(() => result.current.add(vehicle))
    act(() => reportAccessFailure({ status:403, role:'sales', store:'Howell', message:'access revoked' }))
    expect(result.current.management?.pendingSave).toBeNull()
    expect(api.mutate).not.toHaveBeenCalled()
  })

})
