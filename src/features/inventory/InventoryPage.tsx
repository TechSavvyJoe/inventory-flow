import { useWorkspaceState } from '../../lib/workspace-memory'
import type { VehicleDetailLoadState } from '../../components/VehicleDetailStatus'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { groupStores, inventoryStore, toInventoryVehicle } from '../../app/adapters'
import { SourceWarning } from '../../components/SourceWarning'
import { ApiError, getVehicle } from '../../lib/api'
import type { VehicleRecord } from '../../types'
import type { InventoryScope, InventoryVehicle, VehicleWorkspaceTab } from './types'
import { InventoryExperience } from './InventoryExperience'
import { canRequestVehicleMove, movementTrackingPath, transferByVin, vehicleMoveAction } from './inventory-utils'
import {
  hasInventorySearchRequest,
  inventorySearchAccessContext,
  readWorkspaceReturnPath,
  readInventorySearchRequest,
  stripLegacyInventorySearchQuery,
  currentWorkspaceReturnPath,
  withWorkspaceReturnPath,
  workspaceReturnLabel,
} from '../../lib/inventory-navigation'


export function InventoryPage({ homeMode = false }: { homeMode?: boolean }) {
  const { data, homeStore, role, currentUser, refresh } = useAppData()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const accessContext = inventorySearchAccessContext(role, homeStore, currentUser)
  const [scope, setScope] = useWorkspaceState<InventoryScope>(accessContext, 'inventory.scope', 'home')
  const [vehicleDetails, setVehicleDetails] = useState<{ context: string; source: typeof data; records: Record<string, VehicleRecord> }>({ context: accessContext, source: data, records: {} })
  const [detailRequest, setDetailRequest] = useState<{ key: string; state: VehicleDetailLoadState }>({ key: '', state: 'loading' })
  const [detailRetry, setDetailRetry] = useState(0)
  const requestedScope: InventoryScope = params.has('scope') ? params.get('scope') === 'group' ? 'group' : 'home' : scope
  const nextSelectionScope = useRef(requestedScope)
  nextSelectionScope.current = requestedScope
  const requestedVin = params.get('vin')?.trim().toUpperCase() || null
  // A vehicle is a navigable workspace. The URL owns selection so browser
  // Back/Forward cannot resurrect a selection remembered by an earlier visit.
  const selectedVehicleId = requestedVin && data?.vehicles.some(vehicle => vehicle.vin === requestedVin) ? requestedVin : null
  const workspaceReturnPath = readWorkspaceReturnPath(params.get('returnTo'))
  const previousAccessContextRef = useRef(accessContext)
  const navigationRequest = readInventorySearchRequest(location.state, accessContext)
  const legacyQuery =
    params.has('q') && previousAccessContextRef.current === accessContext
      ? (params.get('q') || '').trim()
      : null
  const incomingQuery = navigationRequest?.query ?? legacyQuery
  const [rememberedSearch, setRememberedSearch] = useWorkspaceState(accessContext, 'inventory.navigationSearch', () => ({
    accessContext,
    query: incomingQuery ?? '',
    requestKey: incomingQuery !== null ? location.key : 'initial',
  }))
  const queryRequestKey = incomingQuery !== null ? location.key : rememberedSearch.requestKey
  const query =
    incomingQuery ?? (rememberedSearch.accessContext === accessContext ? rememberedSearch.query : '')

  const vehicles = useMemo(() => {
    if (!data) return []
    const transfers = transferByVin(data.transfers)
    return data.vehicles.map((vehicle) => {
      const cachedDetail = vehicleDetails.context === accessContext && vehicleDetails.source === data ? vehicleDetails.records[vehicle.vin] : undefined
      // Service is live operational data: do not let an earlier detail fetch
      // mask a manager's newer update delivered by the bootstrap refresh.
      const detailed = cachedDetail ? { ...cachedDetail, serviceReadiness: vehicle.serviceReadiness } : vehicle
      return toInventoryVehicle(detailed, data, transfers.get(vehicle.vin))
    })
  }, [accessContext, data, vehicleDetails])

  useEffect(() => {
    const contextChanged = previousAccessContextRef.current !== accessContext
    if (contextChanged) {
      setRememberedSearch({ accessContext, query: '', requestKey: 'initial' })
    } else if (incomingQuery !== null) {
      setRememberedSearch({ accessContext, query: incomingQuery, requestKey: location.key })
    }

    if (params.has('q') || hasInventorySearchRequest(location.state)) {
      navigate(
        {
          pathname: location.pathname,
          search: stripLegacyInventorySearchQuery(location.search),
          hash: location.hash,
        },
        { replace: true, state: null },
      )
    }

    previousAccessContextRef.current = accessContext
  }, [accessContext, incomingQuery, location.key, location.hash, location.pathname, location.search, location.state, navigate, params])

  useEffect(() => {
    setScope(requestedScope)
  }, [requestedScope, setScope])

  const detailKey = `${accessContext}:${selectedVehicleId ?? ''}`
  const activeDetail = vehicleDetails.context === accessContext && vehicleDetails.source === data && selectedVehicleId ? vehicleDetails.records[selectedVehicleId] : undefined
  useEffect(() => {
    if (!selectedVehicleId || !data || activeDetail) return
    let canceled = false
    const controller = new AbortController()
    setDetailRequest({ key: detailKey, state: 'loading' })
    void getVehicle(selectedVehicleId, role, homeStore, controller.signal)
      .then(detail => {
        if (canceled) return
        if (detail.vin !== selectedVehicleId) { setDetailRequest({ key: detailKey, state: 'failed' }); return }
        setVehicleDetails(current => ({ context: accessContext, source: data, records: { ...(current.context === accessContext && current.source === data ? current.records : {}), [detail.vin]: detail } }))
        setDetailRequest({ key: detailKey, state: 'ready' })
      })
      .catch(error => {
        if (!canceled) setDetailRequest({ key: detailKey, state: error instanceof ApiError && [401, 403, 404].includes(error.status) ? 'unavailable' : 'failed' })
      })
    return () => { canceled = true; controller.abort() }
  }, [detailKey, selectedVehicleId, data, activeDetail, role, homeStore, detailRetry])

  if (!data) return null

  const store = inventoryStore(homeStore)

  function selectVehicle(id: string | null) {
    if (id === selectedVehicleId) return
    if (id && !data?.vehicles.some(vehicle => vehicle.vin === id)) return
    if (!id && workspaceReturnPath) {
      navigate(workspaceReturnPath, { replace: true })
      return
    }
    const next = new URLSearchParams(params)
    next.delete('q')
    next.delete('tab')
    if (id) {
      next.set('vin', id)
      next.set('scope', nextSelectionScope.current)
    } else {
      next.delete('vin')
    }
    // Opening from a list adds one Back destination. Switching or explicitly
    // closing a vehicle replaces that detail entry, avoiding stale detail
    // entries when staff work through several vehicles in the same workspace.
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: Boolean(requestedVin) })
  }

  function changeScope(nextScope: InventoryScope) {
    // Predictive search can switch to all locations and select its result in
    // the same event, before the router has rendered the new scope.
    nextSelectionScope.current = nextScope
    const next = new URLSearchParams(params)
    next.set('scope', nextScope)
    next.delete('vin')
    next.delete('tab')
    next.delete('q')
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true })
  }

  function requestVehicle(vehicle: InventoryVehicle) {
    navigate(withWorkspaceReturnPath(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=request`, currentWorkspaceReturnPath(location)))
  }

  function moveVehicle(vehicle: InventoryVehicle, intent: 'request' | 'direct') {
    const returnTo = `${location.pathname}${location.search}`
    navigate(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=${intent}&returnTo=${encodeURIComponent(returnTo)}`)
  }

  function trackMovement(vehicle: InventoryVehicle) {
    const path = movementTrackingPath(vehicle)
    if (path) {
      navigate(withWorkspaceReturnPath(path, currentWorkspaceReturnPath(location)))
      return
    }
    // The transfer is withheld from this role or store. Keep the user on the
    // vehicle: its Location & movement section shows the custody facts the
    // server did publish, whereas the moves page has no record to select.
    selectVehicle(vehicle.id)
  }

  function openListing(vehicle: InventoryVehicle) {
    if (vehicle.publicListing.listingUrl) {
      window.open(vehicle.publicListing.listingUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section className={`inventory-page${homeMode ? ' inventory-home-mode' : ''}`}>
      <SourceWarning meta={data.meta} />
      {requestedVin && !data.vehicles.some(vehicle => vehicle.vin === requestedVin) ? <div className="source-warning" role="status">This vehicle record is unavailable in your current inventory. Search the inventory or return to your previous workspace.</div> : null}
      <InventoryExperience
        key={`${accessContext}-${queryRequestKey}-${homeMode ? 'home' : 'inventory'}`}
        homeStore={store}
        issueContext={data.vehicleIssuesEnabled === true || Boolean(data.vehicleIssues?.length)
          ? { role, homeStore, currentUser, enabled: data.vehicleIssuesEnabled === true, issues: data.vehicleIssues ?? [], onChanged: refresh }
          : undefined}
        vehicles={vehicles}
        detailState={activeDetail ? 'ready' : detailRequest.key === detailKey ? detailRequest.state : 'loading'}
        onRetryDetail={() => setDetailRetry(value => value + 1)}
        returnLabel={workspaceReturnLabel(workspaceReturnPath)}
        groupStores={groupStores(data, homeStore)}
        scope={requestedScope}
        initialQuery={query}
        initialQuickView={query.trim() || requestedVin ? "all" : "no-hold"}
        queryRequestKey={queryRequestKey}
        initialWorkspaceTab={(['overview', 'equipment', 'movement', 'hold', 'timeline', 'data', 'issues'] as VehicleWorkspaceTab[]).find(tab => tab === params.get('tab') && (tab !== 'issues' || data.vehicleIssuesEnabled === true || Boolean(data.vehicleIssues?.length))) ?? 'overview'}
        searchPersistenceKey={accessContext}
        selectedVehicleId={selectedVehicleId}
        onSelectedVehicleChange={selectVehicle}
        pageSize={25}
        canRequestVehicle={(vehicle) => canRequestVehicleMove(vehicle, role, store.id)}
        moveActionFor={(vehicle) => vehicleMoveAction(vehicle, role, store)}
        onScopeChange={changeScope}
        onRequestVehicle={requestVehicle}
        onMoveVehicle={moveVehicle}
        onTrackMovement={trackMovement}
        onOpenListing={openListing}
      />
    </section>
  )
}
