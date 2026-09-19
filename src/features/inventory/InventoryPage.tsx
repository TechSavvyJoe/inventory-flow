import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { groupStores, inventoryMetrics, inventoryStore, toInventoryVehicle } from '../../app/adapters'
import { SourceWarning } from '../../components/SourceWarning'
import { getVehicle } from '../../lib/api'
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
} from './inventory-navigation'


export function InventoryPage({ homeMode = false }: { homeMode?: boolean }) {
  const { data, homeStore, role, currentUser } = useAppData()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [scope, setScope] = useState<InventoryScope>('home')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [vehicleDetails, setVehicleDetails] = useState<Record<string, VehicleRecord>>({})
  const requestedScope: InventoryScope = params.get('scope') === 'group' ? 'group' : 'home'
  const accessContext = inventorySearchAccessContext(role, homeStore, currentUser)
  const requestedVin = params.get('vin')?.trim().toUpperCase() || null
  const workspaceReturnPath = readWorkspaceReturnPath(params.get('returnTo'))
  const openedLinkRef = useRef('')
  const previousAccessContextRef = useRef(accessContext)
  const navigationRequest = readInventorySearchRequest(location.state, accessContext)
  const legacyQuery =
    params.has('q') && previousAccessContextRef.current === accessContext
      ? (params.get('q') || '').trim()
      : null
  const incomingQuery = navigationRequest?.query ?? legacyQuery
  const [rememberedSearch, setRememberedSearch] = useState(() => ({
    accessContext,
    query: incomingQuery ?? '',
  }))
  const query =
    incomingQuery ?? (rememberedSearch.accessContext === accessContext ? rememberedSearch.query : '')
  const detailContext = `${accessContext}:${requestedScope}:${query}`
  const previousDetailContextRef = useRef(detailContext)

  const vehicles = useMemo(() => {
    if (!data) return []
    const transfers = transferByVin(data.transfers)
    return data.vehicles.map((vehicle) => {
      const cachedDetail = vehicleDetails[vehicle.vin]
      // Service is live operational data: do not let an earlier detail fetch
      // mask a manager's newer update delivered by the bootstrap refresh.
      const detailed = cachedDetail ? { ...cachedDetail, serviceReadiness: vehicle.serviceReadiness } : vehicle
      return toInventoryVehicle(detailed, data, transfers.get(vehicle.vin))
    })
  }, [data, vehicleDetails])

  useEffect(() => {
    const contextChanged = previousAccessContextRef.current !== accessContext
    if (contextChanged) {
      setRememberedSearch({ accessContext, query: '' })
    } else if (incomingQuery !== null) {
      setRememberedSearch({ accessContext, query: incomingQuery })
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
  }, [accessContext, incomingQuery, location.hash, location.pathname, location.search, location.state, navigate, params])

  useEffect(() => {
    if (previousDetailContextRef.current === detailContext) return
    previousDetailContextRef.current = detailContext
    setVehicleDetails({})
    setSelectedVehicleId(null)
  }, [detailContext])

  useEffect(() => {
    setScope(requestedScope)
  }, [query, requestedScope])

  useEffect(() => {
    const key = `${accessContext}:${location.key}`
    if (!requestedVin || !data || openedLinkRef.current === key) return
    if (data.vehicles.some(vehicle => vehicle.vin === requestedVin)) {
      openedLinkRef.current = key
      setSelectedVehicleId(requestedVin)
    }
  }, [accessContext, data, location.key, requestedVin])

  useEffect(() => {
    if (!selectedVehicleId || vehicleDetails[selectedVehicleId]) return
    let canceled = false
    void getVehicle(selectedVehicleId, role, homeStore)
      .then((detail) => {
        if (!canceled) setVehicleDetails((current) => ({ ...current, [detail.vin]: detail }))
      })
      .catch(() => {
        // Keep the privacy-safe list summary visible if the detail request is unavailable.
      })
    return () => {
      canceled = true
    }
  }, [accessContext, homeStore, role, selectedVehicleId, vehicleDetails])

  if (!data) return null

  const store = inventoryStore(homeStore)

  function requestVehicle(vehicle: InventoryVehicle) {
    navigate(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=request`)
  }

  function moveVehicle(vehicle: InventoryVehicle, intent: 'request' | 'direct') {
    const returnTo = `${location.pathname}${location.search}`
    navigate(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}&intent=${intent}&returnTo=${encodeURIComponent(returnTo)}`)
  }

  function trackMovement(vehicle: InventoryVehicle) {
    const path = movementTrackingPath(vehicle)
    if (path) {
      navigate(path)
      return
    }
    // The transfer is withheld from this role or store. Keep the user on the
    // vehicle: its Location & movement section shows the custody facts the
    // server did publish, whereas the moves page has no record to select.
    setSelectedVehicleId(vehicle.id)
  }

  function openListing(vehicle: InventoryVehicle) {
    if (vehicle.publicListing.listingUrl) {
      window.open(vehicle.publicListing.listingUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section className={`inventory-page${homeMode ? ' inventory-home-mode' : ''}`}>
      <SourceWarning meta={data.meta} />
      <InventoryExperience
        key={`${accessContext}-${query}-${homeMode ? 'home' : 'inventory'}`}
        homeStore={store}
        vehicles={vehicles}
        metrics={inventoryMetrics(data, homeStore)}
        groupStores={groupStores(data, homeStore)}
        title={`${homeStore} inventory`}
        initialScope={requestedScope}
        scope={scope}
        initialQuery={query}
        initialWorkspaceTab={(['overview', 'equipment', 'movement', 'hold', 'timeline', 'data'] as VehicleWorkspaceTab[]).find(tab => tab === params.get('tab')) ?? 'overview'}
        searchPersistenceKey={accessContext}
        selectedVehicleId={selectedVehicleId}
        onSelectedVehicleChange={(id) => {
          setSelectedVehicleId(id)
          if (!id && requestedVin) {
            if (workspaceReturnPath) {
              navigate(workspaceReturnPath, { replace: true })
              return
            }
            const next = new URLSearchParams(params); next.delete('vin'); next.delete('tab')
            navigate({ pathname: location.pathname, search: next.toString() }, { replace: true })
          }
        }}
        pageSize={25}
        canRequestVehicle={(vehicle) => canRequestVehicleMove(vehicle, role, store.id)}
        moveActionFor={(vehicle) => vehicleMoveAction(vehicle, role, store)}
        onScopeChange={setScope}
        onGroupStoreSelect={() => setScope('group')}
        onRequestVehicle={requestVehicle}
        onMoveVehicle={moveVehicle}
        onTrackMovement={trackMovement}
        onOpenListing={openListing}
        onOpenSourceRecord={(vehicle, source) => {
          if (source === 'public') openListing(vehicle)
        }}
      />
    </section>
  )
}
