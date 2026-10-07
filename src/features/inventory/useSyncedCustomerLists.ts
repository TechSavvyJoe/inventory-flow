import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { subscribeAccessFailures } from '../../lib/apiSession'
import { getSavedVehicleLists, mutateSavedVehicleList, savedListLabelError, type SavedVehicleList } from '../../lib/saved-lists-api'
import type { StoreName, UserRole } from '../../types'
import type { InventoryVehicle } from './types'
import type { ShortlistContextValue, ShortlistEntry } from './useCustomerShortlist'

export interface SyncedCustomerListsOptions {
  enabled: boolean
  ownerId: string | null
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

export function useSyncedCustomerLists({ enabled: requestedEnabled, ownerId, role, store, context, authorizedVehicles }: SyncedCustomerListsOptions): ShortlistContextValue {
  const enabled = requestedEnabled && Boolean(ownerId)
  const accessKey = JSON.stringify([ownerId, role, store, context])
  const boundAccessKey = useRef(accessKey)
  const [lists, setLists] = useState<SavedVehicleList[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastConfirmedAt, setLastConfirmedAt] = useState<number | null>(null)
  const [pendingSave, setPendingSave] = useState<{ vin: string; generation: number; namingListId: string | null } | null>(null)
  const pendingSaveRef = useRef(pendingSave)
  pendingSaveRef.current = pendingSave
  const namingBusy = useRef(false)
  const generation = useRef(0)
  const writeVersion = useRef(0)
  const revoked = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const mutationBusy = useRef(false)
  const initialReadConfirmed = useRef(false)
  const mutationToken = useRef<symbol | null>(null)
  const pendingMutation = useRef<{
    input: Parameters<typeof mutateSavedVehicleList>[0]
    generation: number
    continuation?: { type: 'add-after-create'; vin: string }
  } | null>(null)
  const listsRef = useRef(lists)
  listsRef.current = lists

  const refresh = useCallback(async (preserveError = false) => {
    if (!enabled || !ownerId || boundAccessKey.current !== accessKey || revoked.current) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const requestGeneration = generation.current
    const requestWriteVersion = writeVersion.current
    setLoading(true)
    try {
      const response = await getSavedVehicleLists(role, store, ownerId, controller.signal)
      if (controller.signal.aborted || requestGeneration !== generation.current || requestWriteVersion !== writeVersion.current) return
      setLists(response.lists)
      setActiveListId(current => current && response.lists.some(list => list.id === current) ? current : response.lists[0]?.id ?? null)
      initialReadConfirmed.current = true
      if (!preserveError) setError(null)
      setLastConfirmedAt(Date.now())
    } catch (cause) {
      if (controller.signal.aborted || requestGeneration !== generation.current) return
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        revoked.current = true
        setLists([])
        setActiveListId(null)
        setPendingSave(null)
      }
      setError(messageFor(cause))
    } finally {
      if (requestGeneration === generation.current && abort.current === controller) setLoading(false)
    }
  }, [accessKey, enabled, ownerId, role, store])

  useLayoutEffect(() => {
    boundAccessKey.current = accessKey
    generation.current += 1
    revoked.current = false
    mutationBusy.current = false
    initialReadConfirmed.current = false
    mutationToken.current = null
    pendingMutation.current = null
    namingBusy.current = false
    setPendingSave(null)
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
      // A late create must not issue its follow-up VIN add after unmount or
      // account switch. Aborting GET alone cannot cancel a pending mutation.
      generation.current += 1
      initialReadConfirmed.current = false
      mutationToken.current = null
      pendingMutation.current = null
      pendingSaveRef.current = null
      namingBusy.current = false
      mutationBusy.current = false
    }
  }, [accessKey, enabled, refresh])

  useEffect(() => subscribeAccessFailures(() => {
    if (!enabled) return
    generation.current += 1
    revoked.current = true
    mutationBusy.current = false
    initialReadConfirmed.current = false
    mutationToken.current = null
    pendingMutation.current = null
    namingBusy.current = false
    setPendingSave(null)
    abort.current?.abort()
    setLists([])
    setActiveListId(null)
    setLoading(false)
    setSaving(false)
    setError('Your access changed. Reload or sign in again before using saved lists.')
    setLastConfirmedAt(null)
  }), [enabled])

  const viewCurrent = enabled && boundAccessKey.current === accessKey
  const visibleLists = viewCurrent ? lists : []
  const activeList = visibleLists.find(list => list.id === activeListId) ?? null
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
    if (!enabled || !ownerId || boundAccessKey.current !== accessKey || !initialReadConfirmed.current || mutationBusy.current || revoked.current || pendingMutation.current && !options.retryPending) return null
    const requestGeneration = generation.current
    const token = Symbol('saved-list-mutation')
    mutationBusy.current = true
    mutationToken.current = token
    setSaving(true)
    setError(null)
    try {
      const result = await mutateSavedVehicleList(input, role, store, ownerId)
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
        setPendingSave(null)
      }
      return null
    } finally {
      if (requestGeneration === generation.current && token === mutationToken.current) {
        mutationBusy.current = false
        mutationToken.current = null
        setSaving(false)
      }
    }
  }, [accessKey, enabled, ownerId, refresh, role, store])

  const createList = useCallback(async (rawLabel: string) => {
    if (!viewCurrent || !initialReadConfirmed.current || revoked.current || mutationBusy.current || pendingMutation.current) return false
    const label = rawLabel.trim()
    const validation = savedListLabelError(label)
    if (validation) { setError(validation); return false }
    const existing = listsRef.current.find(list => list.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())
    if (existing) { setActiveListId(existing.id); return true }
    return Boolean(await applyMutation({ action: 'create', label }))
  }, [applyMutation, viewCurrent])

  const addToList = useCallback(async (list: SavedVehicleList, vin: string) => {
    if (list.items.some(item => item.vin === vin)) { setActiveListId(list.id); return true }
    return Boolean(await applyMutation({ action: 'add', listId: list.id, expectedRevision: list.revision, vin }))
  }, [applyMutation])

  const addAsync = useCallback(async (vehicle: InventoryVehicle) => {
    if (!viewCurrent || !initialReadConfirmed.current || revoked.current || mutationBusy.current || pendingMutation.current || namingBusy.current) return
    if (!vehiclesByVin.has(vehicle.vin)) return
    if (!activeList || activeList.label === DEFAULT_LABEL) {
      // First Save asks for a name. Legacy generic lists are renamed in place,
      // preserving their vehicles instead of creating another default list.
      setPendingSave({ vin: vehicle.vin, generation: generation.current, namingListId: activeList?.id ?? null })
      return
    }
    await addToList(activeList, vehicle.vin)
  }, [activeList, addToList, vehiclesByVin, viewCurrent])

  const savePending = useCallback(async (choice: { label: string } | { listId: string }) => {
    const pending = pendingSaveRef.current
    if (!pending || pending.generation !== generation.current || namingBusy.current || revoked.current || !vehiclesByVin.has(pending.vin)) return false
    namingBusy.current = true
    try {
      let list: SavedVehicleList | undefined
      if ('listId' in choice) {
        list = listsRef.current.find(candidate => candidate.id === choice.listId)
        if (list?.id === pending.namingListId || list?.label === DEFAULT_LABEL) {
          setError('Name this customer list before saving the vehicle, or choose another named list.')
          return false
        }
      }
      else {
        const label = choice.label.trim()
        const validation = savedListLabelError(label)
        if (validation) { setError(validation); return false }
        // Reuse a same-named customer list rather than add a confusing duplicate.
        list = listsRef.current.find(candidate => candidate.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase() && candidate.id !== pending.namingListId)
        if (!list) {
          const current = listsRef.current.find(candidate => candidate.id === pending.namingListId)
          const input = current
            ? { action: 'rename' as const, listId: current.id, expectedRevision: current.revision, label }
            : { action: 'create' as const, label }
          const result = await applyMutation(input, { continuation: { type: 'add-after-create', vin: pending.vin } })
          if (!result || 'deleted' in result) return false
          list = result
        }
      }
      if (!list || pending.generation !== generation.current || revoked.current) return false
      const saved = await addToList(list, pending.vin)
      if (saved && pending.generation === generation.current) setPendingSave(null)
      return saved
    } finally {
      if (pending.generation === generation.current) namingBusy.current = false
    }
  }, [addToList, applyMutation, vehiclesByVin])
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
      lists: visibleLists.map(list => ({ id: list.id, label: list.label, count: list.items.length })),
      activeListId: viewCurrent ? activeListId : null,
      activeLabel: activeList?.label ?? DEFAULT_LABEL,
      loading: viewCurrent && loading,
      saving: viewCurrent && saving,
      error: viewCurrent ? error : null,
      lastConfirmedAt: viewCurrent ? lastConfirmedAt : null,
      pendingAction: viewCurrent && pendingMutation.current?.generation === generation.current,
      accessRevoked: revoked.current,
      readyForWrites: viewCurrent && initialReadConfirmed.current,
      pendingSave: viewCurrent && pendingSave?.generation === generation.current && vehiclesByVin.has(pendingSave.vin)
        ? { vin: pendingSave.vin, displayName: entryFor(vehiclesByVin.get(pendingSave.vin)!, '').displayName,
          stockNumber: vehiclesByVin.get(pendingSave.vin)!.stockNumber, namingExistingList: Boolean(pendingSave.namingListId), namingListId: pendingSave.namingListId } : null,
      savePendingToNamedList: label => savePending({ label }),
      savePendingToExistingList: listId => savePending({ listId }),
      cancelPendingSave: () => { if (!mutationBusy.current && !namingBusy.current) setPendingSave(null) },
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
            const added = await applyMutation({
              action: 'add',
              listId: result.id,
              expectedRevision: result.revision,
              vin: pending.continuation.vin,
            })
            if (!added || 'deleted' in added) return
          }
          if (!pendingMutation.current && generation.current === pending.generation && !revoked.current) setPendingSave(null)
        })()
        else void refresh()
      },
    },
  }
}
