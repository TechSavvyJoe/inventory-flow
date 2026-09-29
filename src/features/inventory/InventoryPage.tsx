import { useWorkspaceState } from '../../lib/workspace-memory'
import type { VehicleDetailLoadState } from '../../components/VehicleDetailStatus'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { groupStores, inventoryStore, toInventoryVehicle } from '../../app/adapters'
import { SourceWarning } from '../../components/SourceWarning'
import { ApiError, getVehicle } from '../../lib/api'
import type { BootstrapData, VehicleRecord } from '../../types'
import type { InventoryFilters, InventoryScope, InventoryVehicle, VehicleWorkspaceTab } from './types'
import { hasOverviewInventoryParams, readOverviewInventoryRequest, withoutOverviewInventoryParams, type OverviewInventoryRequest } from '../overview/overview-links'
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

/** An Overview link's Inventory parameters as initial filters for one request. */
function overviewRequestFilters(request: OverviewInventoryRequest | null): Partial<InventoryFilters> | null {
  if (!request) return null
  return {
    ...(request.overviewView ? { overviewView: request.overviewView } : {}),
    ...(request.store ? { storeId: inventoryStore(request.store).id } : {}),
    ...(request.serviceReadiness ? { serviceReadiness: request.serviceReadiness } : {}),
    ...(request.vins ? { vins: request.vins } : {}),
  }
}

interface VehicleDetailEntry {
  record: VehicleRecord
  sourceRevision: number
  protectedSignature: string
}

interface VehicleDetailCache {
  context: string
  records: Record<string, VehicleDetailEntry>
}

/**
 * DealerMail details are protected evidence. A new daily CRM capture or any
 * change in the authorized hold projection invalidates that evidence before
 * React paints the replacement bootstrap. Other detail-only fields can remain
 * visible while their background read catches up.
 */
function protectedDetailSignature(data: BootstrapData, vehicle: VehicleRecord): string {
  return JSON.stringify({
    reportDate: data.meta?.reportDate ?? null,
    dealerMailCapturedAt: data.meta?.dealerMailCapturedAt ?? null,
    dealerMailFreshness: data.meta?.dealerMailFreshness ?? null,
    canViewPrivateEvidence: data.access?.canViewPrivateEvidence === true,
    hold: vehicle.hold ?? null,
  })
}

function withoutProtectedEvidence(record: VehicleRecord): VehicleRecord {
  const { privateEvidence: _privateEvidence, ...safeRecord } = record
  return safeRecord as VehicleRecord
}

function retainedDetail(entry: VehicleDetailEntry | undefined, data: BootstrapData, vehicle: VehicleRecord): VehicleRecord | undefined {
  if (!entry) return undefined
  const detail = entry.protectedSignature === protectedDetailSignature(data, vehicle)
    ? entry.record
    : withoutProtectedEvidence(entry.record)
  // Keep only the detail-only evidence while the new read runs; every other
  // field in the authorized bootstrap projection wins immediately, including
  // autoCheckReport, windowSticker, factoryEquipment, fordInvoice, fordOasis
  // and warrantyCheck, and its regenerated search text, so an old private
  // hold term cannot remain in the index after the hold signature changes.
  // Building from the live vehicle (rather than spreading the cached detail)
  // also drops any cached key the new bootstrap no longer sends.
  return {
    ...vehicle,
    ...(detail.publicScan !== undefined ? { publicScan: detail.publicScan } : {}),
    ...(detail.privateEvidence !== undefined ? { privateEvidence: detail.privateEvidence } : {}),
  }
}


export function InventoryPage({ homeMode = false }: { homeMode?: boolean }) {
  const { data, homeStore, role, currentUser, refresh } = useAppData()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const accessContext = inventorySearchAccessContext(role, homeStore, currentUser)
  const [scope, setScope] = useWorkspaceState<InventoryScope>(accessContext, 'inventory.scope', 'home')
  const [vehicleDetails, setVehicleDetails] = useState<VehicleDetailCache>({ context: accessContext, records: {} })
  const [detailRequest, setDetailRequest] = useState<{ key: string; sourceRevision: number; state: VehicleDetailLoadState }>({ key: '', sourceRevision: -1, state: 'loading' })
  const [detailRetry, setDetailRetry] = useState(0)
  const bootstrapRevisionRef = useRef<{ source: BootstrapData | null; revision: number }>({ source: data, revision: 0 })
  if (bootstrapRevisionRef.current.source !== data) {
    bootstrapRevisionRef.current = { source: data, revision: bootstrapRevisionRef.current.revision + 1 }
  }
  const bootstrapRevision = bootstrapRevisionRef.current.revision
  const latestDetailContextRef = useRef({ accessContext, bootstrapRevision })
  latestDetailContextRef.current = { accessContext, bootstrapRevision }
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
  // Overview count links (store, view, service, vins) are read on entry, kept
  // in memory for this signed-in context, and stripped like the legacy q.
  const overviewParamsPresent = hasOverviewInventoryParams(params)
  const incomingFilters =
    overviewParamsPresent && previousAccessContextRef.current === accessContext
      ? overviewRequestFilters(readOverviewInventoryRequest(params))
      : null
  const incomingFiltersKey = incomingFilters ? JSON.stringify(incomingFilters) : null
  const [rememberedFilters, setRememberedFilters] = useWorkspaceState<{ accessContext: string; requestKey: string; filters: Partial<InventoryFilters> | null }>(
    accessContext,
    'inventory.overviewFilters',
    () => ({ accessContext, requestKey: incomingFilters ? location.key : 'initial', filters: incomingFilters }),
  )
  const filterRequest = incomingFilters
    ? { requestKey: location.key, filters: incomingFilters }
    : rememberedFilters.accessContext === accessContext ? rememberedFilters : { requestKey: 'initial', filters: null }
  const [rememberedSearch, setRememberedSearch] = useWorkspaceState(accessContext, 'inventory.navigationSearch', () => ({
    accessContext,
    query: incomingQuery ?? '',
    requestKey: incomingQuery !== null ? location.key : 'initial',
  }))
  const queryRequestKey = incomingQuery !== null || incomingFilters ? location.key : rememberedSearch.requestKey
  const query =
    incomingQuery ?? (incomingFilters ? '' : rememberedSearch.accessContext === accessContext ? rememberedSearch.query : '')
  const filterRequestActive = filterRequest.requestKey !== 'initial' && filterRequest.requestKey === queryRequestKey

  const vehicles = useMemo(() => {
    if (!data) return []
    const transfers = transferByVin(data.transfers)
    return data.vehicles.map((vehicle) => {
      const cachedDetail = vehicleDetails.context === accessContext ? vehicleDetails.records[vehicle.vin] : undefined
      const detailed = retainedDetail(cachedDetail, data, vehicle) ?? vehicle
      return toInventoryVehicle(detailed, data, transfers.get(vehicle.vin))
    })
  }, [accessContext, data, vehicleDetails])

  useEffect(() => {
    const contextChanged = previousAccessContextRef.current !== accessContext
    if (contextChanged) {
      setRememberedSearch({ accessContext, query: '', requestKey: 'initial' })
      setRememberedFilters({ accessContext, requestKey: 'initial', filters: null })
    } else if (incomingQuery !== null || incomingFiltersKey !== null) {
      setRememberedSearch({ accessContext, query: incomingQuery ?? '', requestKey: location.key })
      if (incomingFiltersKey !== null) setRememberedFilters({ accessContext, requestKey: location.key, filters: JSON.parse(incomingFiltersKey) })
    }

    if (params.has('q') || overviewParamsPresent || hasInventorySearchRequest(location.state)) {
      navigate(
        {
          pathname: location.pathname,
          search: withoutOverviewInventoryParams(stripLegacyInventorySearchQuery(location.search)),
          hash: location.hash,
        },
        { replace: true, state: null },
      )
    }

    previousAccessContextRef.current = accessContext
  }, [accessContext, incomingFiltersKey, incomingQuery, location.key, location.hash, location.pathname, location.search, location.state, navigate, overviewParamsPresent, params])

  useEffect(() => {
    setScope(requestedScope)
  }, [requestedScope, setScope])

  const detailKey = `${accessContext}:${selectedVehicleId ?? ''}`
  const selectedSummary = selectedVehicleId ? data?.vehicles.find(vehicle => vehicle.vin === selectedVehicleId) : undefined
  const activeEntry = vehicleDetails.context === accessContext && selectedVehicleId ? vehicleDetails.records[selectedVehicleId] : undefined
  const currentProtectedSignature = data && selectedSummary ? protectedDetailSignature(data, selectedSummary) : null
  const activeDetail = data && selectedSummary ? retainedDetail(activeEntry, data, selectedSummary) : undefined
  const hasActiveDetail = Boolean(activeDetail)
  const detailIsFresh = Boolean(activeEntry && activeEntry.sourceRevision === bootstrapRevision && activeEntry.protectedSignature === currentProtectedSignature)

  useLayoutEffect(() => {
    setVehicleDetails(current => {
      if (!data || current.context !== accessContext) {
        return current.context === accessContext && Object.keys(current.records).length === 0
          ? current
          : { context: accessContext, records: {} }
      }
      const summaries = new Map(data.vehicles.map(vehicle => [vehicle.vin, vehicle]))
      let records = current.records
      for (const [vin, entry] of Object.entries(current.records)) {
        const summary = summaries.get(vin)
        if (!summary) {
          if (records === current.records) records = { ...records }
          delete records[vin]
        } else if (entry.record.privateEvidence && entry.protectedSignature !== protectedDetailSignature(data, summary)) {
          if (records === current.records) records = { ...records }
          records[vin] = { ...entry, record: withoutProtectedEvidence(entry.record) }
        }
      }
      return records === current.records ? current : { ...current, records }
    })
  }, [accessContext, data])

  useEffect(() => {
    if (!selectedVehicleId || !data || !selectedSummary || detailIsFresh) return
    let canceled = false
    const controller = new AbortController()
    const signature = protectedDetailSignature(data, selectedSummary)
    setDetailRequest({ key: detailKey, sourceRevision: bootstrapRevision, state: hasActiveDetail ? 'refreshing' : 'loading' })
    void getVehicle(selectedVehicleId, role, homeStore, controller.signal)
      .then(detail => {
        if (canceled || latestDetailContextRef.current.accessContext !== accessContext || latestDetailContextRef.current.bootstrapRevision !== bootstrapRevision) return
        if (detail.vin !== selectedVehicleId) {
          setDetailRequest({ key: detailKey, sourceRevision: bootstrapRevision, state: hasActiveDetail ? 'stale' : 'failed' })
          return
        }
        setVehicleDetails(current => ({
          context: accessContext,
          records: {
            ...(current.context === accessContext ? current.records : {}),
            [detail.vin]: { record: detail, sourceRevision: bootstrapRevision, protectedSignature: signature },
          },
        }))
        setDetailRequest({ key: detailKey, sourceRevision: bootstrapRevision, state: 'ready' })
      })
      .catch(error => {
        if (canceled || latestDetailContextRef.current.accessContext !== accessContext || latestDetailContextRef.current.bootstrapRevision !== bootstrapRevision) return
        const unavailable = error instanceof ApiError && [401, 403, 404].includes(error.status)
        if (unavailable) {
          setVehicleDetails(current => current.context !== accessContext ? current : {
            context: current.context,
            records: Object.fromEntries(Object.entries(current.records).filter(([vin]) => vin !== selectedVehicleId)),
          })
        }
        setDetailRequest({ key: detailKey, sourceRevision: bootstrapRevision, state: unavailable ? 'unavailable' : hasActiveDetail ? 'stale' : 'failed' })
      })
    return () => { canceled = true; controller.abort() }
  }, [detailKey, selectedVehicleId, data, selectedSummary, hasActiveDetail, detailIsFresh, role, homeStore, detailRetry, accessContext, bootstrapRevision])

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
        detailState={activeDetail
          ? detailRequest.key === detailKey && detailRequest.sourceRevision === bootstrapRevision && ['refreshing', 'stale'].includes(detailRequest.state)
            ? detailRequest.state
            : detailIsFresh ? 'ready' : 'refreshing'
          : detailRequest.key === detailKey && detailRequest.sourceRevision === bootstrapRevision ? detailRequest.state : 'loading'}
        onRetryDetail={() => setDetailRetry(value => value + 1)}
        returnLabel={workspaceReturnLabel(workspaceReturnPath)}
        groupStores={groupStores(data, homeStore)}
        scope={requestedScope}
        initialQuery={query}
        initialQuickView={query.trim() || requestedVin || filterRequestActive ? "all" : "no-hold"}
        queryRequestKey={queryRequestKey}
        initialFilters={filterRequest.filters ?? undefined}
        filterRequestKey={filterRequest.requestKey}
        initialWorkspaceTab={(['overview', 'equipment', 'movement', 'hold', 'timeline', 'data', 'issues'] as VehicleWorkspaceTab[]).find(tab => tab === params.get('tab') && (tab !== 'issues' || data.vehicleIssuesEnabled === true || Boolean(data.vehicleIssues?.length))) ?? 'overview'}
        searchPersistenceKey={accessContext}
        selectedVehicleId={selectedVehicleId}
        onSelectedVehicleChange={selectVehicle}
        pageSize={50}
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
