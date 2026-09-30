import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { subscribeAccessFailures } from '../../lib/apiSession'
import { getSavedVehicleLists, mutateSavedVehicleList, savedListLabelError, type SavedVehicleList } from '../../lib/saved-lists-api'
import type { StoreName, UserRole } from '../../types'
import type { InventoryVehicle } from './types'
import type { ShortlistContextValue, ShortlistEntry } from './useCustomerShortlist'

export interface SyncedCustomerListsOptions {
  enabled: boolean
  role: UserRole
  store: StoreName
  context: string
  authorizedVehicles: InventoryVehicle[]
}

const DEFAULT_LABEL = 'Customer shortlist'
const POLL_MS = 25_000

function entryFor(vehicle: InventoryVehicle, addedAt: string): ShortlistEntry {
  return {
    id: vehicle.vin,
    vin: vehicle.vin,
    stockNumber: vehicle.stockNumber,
    displayName: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
    price: vehicle.price ?? null,
    imageUrl: vehicle.imageUrl || vehicle.imageUrls?.[0] || null,
    exteriorColor: vehicle.exteriorColor || null,
    addedAt: Date.parse(addedAt) || Date.now(),
    available: true,
  }
}

function unavailableEntry(vin: string, addedAt: string): ShortlistEntry {
  return {
    id: vin,
    vin,
    stockNumber: 'Unavailable',
    displayName: 'Vehicle unavailable',
    price: null,
    imageUrl: null,
    exteriorColor: null,
    addedAt: Date.parse(addedAt) || Date.now(),
    available: false,
  }
}

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return 'This list changed on another device. Review the latest list and try again.'
  return error instanceof Error ? error.message : 'Saved lists could not be updated. Try again.'
}

function mutationOutcomeUncertain(error: unknown) {
  return !(error instanceof ApiError) || [408, 425, 429].includes(error.status) || error.status >= 500
}

export function useSyncedCustomerLists({ enabled, role, store, context, authorizedVehicles }: SyncedCustomerListsOptions): ShortlistContextValue {
  const [lists, setLists] = useState<SavedVehicleList[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastConfirmedAt, setLastConfirmedAt] = useState<number | null>(null)
  const generation = useRef(0)
  const writeVersion = useRef(0)
  const revoked = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const mutationBusy = useRef(false)
  const mutationToken = useRef<symbol | null>(null)
  const pendingMutation = useRef<{
    input: Parameters<typeof mutateSavedVehicleList>[0]
    generation: number
    continuation?: { type: 'add-after-create'; vin: string }
  } | null>(null)
  const listsRef = useRef(lists)
  listsRef.current = lists

  const refresh = useCallback(async (preserveError = false) => {
    if (!enabled || revoked.current) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const requestGeneration = generation.current
    const requestWriteVersion = writeVersion.current
    setLoading(true)
    try {
      const response = await getSavedVehicleLists(role, store, controller.signal)
      if (controller.signal.aborted || requestGeneration !== generation.current || requestWriteVersion !== writeVersion.current) return
      setLists(response.lists)
      setActiveListId(current => current && response.lists.some(list => list.id === current) ? current : response.lists[0]?.id ?? null)
      if (!preserveError) setError(null)
      setLastConfirmedAt(Date.now())
    } catch (cause) {
      if (controller.signal.aborted || requestGeneration !== generation.current) return
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        revoked.current = true
        setLists([])
        setActiveListId(null)
      }
      setError(messageFor(cause))
    } finally {
      if (requestGeneration === generation.current && abort.current === controller) setLoading(false)
    }
  }, [enabled, role, store])

  useEffect(() => {
    generation.current += 1
    revoked.current = false
    mutationBusy.current = false
    mutationToken.current = null
    pendingMutation.current = null
    abort.current?.abort()
    setLists([])
    setActiveListId(null)
    setError(null)
    setSaving(false)
    setLastConfirmedAt(null)
    if (!enabled) return
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, POLL_MS)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      abort.current?.abort()
    }
  }, [context, enabled, refresh])

  useEffect(() => subscribeAccessFailures(() => {
    if (!enabled) return
    generation.current += 1
    revoked.current = true
    mutationBusy.current = false
    mutationToken.current = null
    pendingMutation.current = null
    abort.current?.abort()
    setLists([])
    setActiveListId(null)
    setLoading(false)
    setSaving(false)
    setError('Your access changed. Reload or sign in again before using saved lists.')
    setLastConfirmedAt(null)
  }), [enabled])

  const activeList = lists.find(list => list.id === activeListId) ?? null
  const vehiclesByVin = useMemo(() => new Map(authorizedVehicles.map(vehicle => [vehicle.vin, vehicle])), [authorizedVehicles])
  const entries = useMemo(() => (activeList?.items ?? []).map(item => {
    const vehicle = vehiclesByVin.get(item.vin)
    return vehicle && item.available ? entryFor(vehicle, item.addedAt) : unavailableEntry(item.vin, item.addedAt)
  }), [activeList, vehiclesByVin])
  const ids = useMemo(() => new Set(activeList?.items.map(item => item.vin) ?? []), [activeList])

  const applyMutation = useCallback(async (
    input: Parameters<typeof mutateSavedVehicleList>[0],
    options: { retryPending?: boolean; continuation?: { type: 'add-after-create'; vin: string } } = {},
  ) => {
    if (!enabled || mutationBusy.current || revoked.current || pendingMutation.current && !options.retryPending) return null
    const requestGeneration = generation.current
    const token = Symbol('saved-list-mutation')
    mutationBusy.current = true
    mutationToken.current = token
    setSaving(true)
    setError(null)
    try {
      const result = await mutateSavedVehicleList(input, role, store)
      if (requestGeneration !== generation.current || token !== mutationToken.current) return null
      pendingMutation.current = null
      writeVersion.current += 1
      if ('deleted' in result) {
        const remaining = listsRef.current.filter(list => list.id !== result.id)
        setLists(remaining)
        setActiveListId(current => current === result.id ? remaining[0]?.id ?? null : current)
      } else {
        setLists(current => {
          const exists = current.some(list => list.id === result.id)
          return exists ? current.map(list => list.id === result.id ? result : list) : [...current, result]
        })
        setActiveListId(result.id)
      }
      setLastConfirmedAt(Date.now())
      return result
    } catch (cause) {
      if (requestGeneration !== generation.current || token !== mutationToken.current) return null
      pendingMutation.current = mutationOutcomeUncertain(cause)
        ? { input, generation: requestGeneration, continuation: options.continuation }
        : null
      setError(messageFor(cause))
      if (cause instanceof ApiError && cause.status === 409) void refresh(true)
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        revoked.current = true
        setLists([])
        setActiveListId(null)
      }
      return null
    } finally {
      if (requestGeneration === generation.current && token === mutationToken.current) {
        mutationBusy.current = false
        mutationToken.current = null
        setSaving(false)
      }
    }
  }, [enabled, refresh, role, store])

  const createList = useCallback(async (rawLabel: string) => {
    const label = rawLabel.trim()
    const validation = savedListLabelError(label)
    if (validation) { setError(validation); return false }
    return Boolean(await applyMutation({ action: 'create', label }))
  }, [applyMutation])

  const addAsync = useCallback(async (vehicle: InventoryVehicle) => {
    const actionGeneration = generation.current
    let list = activeList
    if (!list) {
      const created = await applyMutation(
        { action: 'create', label: DEFAULT_LABEL },
        { continuation: { type: 'add-after-create', vin: vehicle.vin } },
      )
      if (actionGeneration !== generation.current || !created || 'deleted' in created) return
      list = created
    }
    if (actionGeneration !== generation.current) return
    if (list.items.some(item => item.vin === vehicle.vin)) return
    await applyMutation({ action: 'add', listId: list.id, expectedRevision: list.revision, vin: vehicle.vin })
  }, [activeList, applyMutation])
  const removeAsync = useCallback(async (vin: string) => {
    if (!activeList || !activeList.items.some(item => item.vin === vin)) return
    await applyMutation({ action: 'remove', listId: activeList.id, expectedRevision: activeList.revision, vin })
  }, [activeList, applyMutation])

  const clear = useCallback(() => {
    if (!activeList || saving) return
    void (async () => {
      let revision = activeList.revision
      for (const item of activeList.items) {
        const result = await applyMutation({ action: 'remove', listId: activeList.id, expectedRevision: revision, vin: item.vin })
        if (!result || 'deleted' in result) break
        revision = result.revision
      }
    })()
  }, [activeList, applyMutation, saving])

  const isShortlisted = useCallback((vehicle: InventoryVehicle | string) => {
    if (typeof vehicle === 'string') return ids.has(vehicle)
    return ids.has(vehicle.vin)
  }, [ids])
  const add = useCallback((vehicle: InventoryVehicle) => { void addAsync(vehicle) }, [addAsync])
  const remove = useCallback((vin: string) => { void removeAsync(vin) }, [removeAsync])
  const toggle = useCallback((vehicle: InventoryVehicle) => {
    if (ids.has(vehicle.vin)) void removeAsync(vehicle.vin)
    else void addAsync(vehicle)
  }, [addAsync, ids, removeAsync])

  return {
    context,
    entries,
    ids,
    count: activeList?.items.length ?? 0,
    isShortlisted,
    toggle,
    add,
    remove,
    clear,
    management: {
      lists: lists.map(list => ({ id: list.id, label: list.label, count: list.items.length })),
      activeListId,
      activeLabel: activeList?.label ?? DEFAULT_LABEL,
      loading,
      saving,
      error,
      lastConfirmedAt,
      pendingAction: pendingMutation.current?.generation === generation.current,
      accessRevoked: revoked.current,
      selectList: setActiveListId,
      createList,
      renameActiveList: async (rawLabel) => {
        if (!activeList) return false
        const label = rawLabel.trim()
        const validation = savedListLabelError(label)
        if (validation) { setError(validation); return false }
        return Boolean(await applyMutation({ action: 'rename', listId: activeList.id, expectedRevision: activeList.revision, label }))
      },
      deleteActiveList: async () => activeList
        ? Boolean(await applyMutation({ action: 'delete', listId: activeList.id, expectedRevision: activeList.revision }))
        : false,
      retry: () => {
        if (revoked.current) return
        const pending = pendingMutation.current
        if (pending?.generation === generation.current) void (async () => {
          const result = await applyMutation(pending.input, { retryPending: true, continuation: pending.continuation })
          if (!result || 'deleted' in result || generation.current !== pending.generation) return
          if (pending.continuation?.type === 'add-after-create' && !result.items.some(item => item.vin === pending.continuation!.vin)) {
            await applyMutation({
              action: 'add',
              listId: result.id,
              expectedRevision: result.revision,
              vin: pending.continuation.vin,
            })
          }
        })()
        else void refresh()
      },
    },
  }
}
