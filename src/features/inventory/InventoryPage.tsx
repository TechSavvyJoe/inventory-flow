import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { groupStores, inventoryMetrics, inventoryStore, toInventoryVehicle } from '../../app/adapters'
import { SourceWarning } from '../../components/SourceWarning'
import { getVehicle } from '../../lib/api'
import type { VehicleRecord } from '../../types'
import type { InventoryScope, InventoryVehicle } from './types'
import { InventoryExperience } from './InventoryExperience'
import {
  hasInventorySearchRequest,
  inventorySearchAccessContext,
  readInventorySearchRequest,
  stripLegacyInventorySearchQuery,
} from './inventory-navigation'

export function InventoryPage({ homeMode = false }: { homeMode?: boolean }) {
  const { data, homeStore, role } = useAppData()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [scope, setScope] = useState<InventoryScope>('home')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [vehicleDetails, setVehicleDetails] = useState<Record<string, VehicleRecord>>({})
  const requestedScope: InventoryScope = params.get('scope') === 'group' ? 'group' : 'home'
  const accessContext = inventorySearchAccessContext(role, homeStore)
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

  const vehicles = useMemo(() => {
    if (!data) return []
    const transfers = new Map(data.transfers.map((transfer) => [transfer.vin, transfer]))
    return data.vehicles.map((vehicle) => {
      const detailed = vehicleDetails[vehicle.vin] ?? vehicle
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
    setVehicleDetails({})
    setSelectedVehicleId(null)
  }, [accessContext, query, requestedScope])

  useEffect(() => {
    setScope(requestedScope)
  }, [query, requestedScope])

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
  }, [homeStore, role, selectedVehicleId, vehicleDetails])

  if (!data) return null

  const store = inventoryStore(homeStore)

  function requestVehicle(vehicle: InventoryVehicle) {
    navigate(`/transfers/new?vin=${encodeURIComponent(vehicle.vin)}`)
  }

  function trackMovement(vehicle: InventoryVehicle) {
    const requestId = vehicle.movement?.requestId
    navigate(requestId ? `/transfers?id=${encodeURIComponent(requestId)}` : `/transfers?vin=${encodeURIComponent(vehicle.vin)}`)
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
        key={`${role}-${homeStore}-${query}-${homeMode ? 'home' : 'inventory'}`}
        homeStore={store}
        vehicles={vehicles}
        metrics={inventoryMetrics(data, homeStore)}
        groupStores={groupStores(data, homeStore)}
        title={`${homeStore} inventory`}
        initialScope={requestedScope}
        scope={scope}
        initialQuery={query}
        searchPersistenceKey={`${role}:${homeStore}`}
        selectedVehicleId={selectedVehicleId}
        onSelectedVehicleChange={setSelectedVehicleId}
        pageSize={25}
        canRequestVehicle={(vehicle) =>
          ['sales', 'manager', 'group_manager'].includes(role) &&
          vehicle.location.homeStore.id !== store.id &&
          !vehicle.movement?.requestId
        }
        onScopeChange={setScope}
        onGroupStoreSelect={() => setScope('group')}
        onRequestVehicle={requestVehicle}
        onTrackMovement={trackMovement}
        onOpenListing={openListing}
        onOpenSourceRecord={(vehicle, source) => {
          if (source === 'public') openListing(vehicle)
        }}
      />
    </section>
  )
}
