import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CarFront, RotateCw } from 'lucide-react'
import { toInventoryVehicle } from '../../app/adapters'
import { VehicleThumbnail } from '../../components/VehicleThumbnail'
import { formatNumber } from '../../lib/format'
import { vehicleWorkspacePath, withWorkspaceReturnPath } from '../../lib/inventory-navigation'
import type { BootstrapData, StoreName, TransferRecord, UserRole, VehicleIssue, VehicleRecord } from '../../types'
import type { InventoryVehicle } from '../inventory/types'
import { formatMoney, publicListingLabel, resolveCurrentLocation, vehicleDisplayName } from '../inventory/inventory-utils'
import { standoutEquipment } from '../inventory/vehicle-feature-utils'
import { useSyncedCustomerLists } from '../inventory/useSyncedCustomerLists'
import { inventoryViewHref, serviceStatusHref } from './overview-links'
import './SalesOverview.css'

export interface SalesOverviewProps {
  data: BootstrapData
  stores: StoreName[]
  homeStore: StoreName
  role: UserRole
  currentUserId: string | null
  printing?: boolean
}

const TERMINAL_MOVE_STATES = new Set(['closed', 'declined', 'canceled', 'expired'])

function normalizedStatus(value?: string) {
  return (value ?? '').toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function isActiveMove(record: TransferRecord) {
  const status = normalizedStatus(record.requestStatus)
  return !TERMINAL_MOVE_STATES.has(status) && !(record.workflowMode === 'simple' && status === 'returned-home')
}

function moveInScope(record: TransferRecord, stores: ReadonlySet<StoreName>) {
  return stores.has(record.homeStore) || stores.has(record.requestingStore) || stores.has(record.destination as StoreName)
}

function vehicleInScope(vehicle: VehicleRecord, stores: ReadonlySet<StoreName>) {
  const movementStore = vehicle.movement.locationConfidence === 'verified' && stores.has(vehicle.movement.currentLocation as StoreName)
    ? vehicle.movement.currentLocation as StoreName
    : null
  const observedStore = movementStore ?? vehicle.sourceReportedLocation
  return stores.has(vehicle.homeStore) || stores.has(observedStore) || Boolean(vehicle.crmStore && stores.has(vehicle.crmStore))
}

function serviceLabel(vehicle: VehicleRecord) {
  switch (vehicle.serviceReadiness?.status) {
    case 'needs_service': return 'Waiting for service'
    case 'in_service': return 'In service'
    case 'serviced': return 'Service recorded ready'
    default: return 'Service status not recorded'
  }
}

function issueLabel(issue: VehicleIssue) {
  const category = issue.category.charAt(0).toUpperCase() + issue.category.slice(1)
  const status = issue.status.replaceAll('_', ' ')
  return `${category} · ${status}`
}

function attentionReasons(vehicle: VehicleRecord, issues: readonly VehicleIssue[], activeMoveVins: ReadonlySet<string>) {
  const reasons: string[] = []
  if (vehicle.hold.state === 'primary' || vehicle.hold.state === 'backup' || vehicle.hold.state === 'multiple') reasons.push('hold signal')
  if (vehicle.serviceReadiness?.status === 'needs_service' || vehicle.serviceReadiness?.status === 'in_service') reasons.push('service attention')
  if (issues.some(issue => issue.vin === vehicle.vin && issue.status !== 'completed')) reasons.push('reported issue')
  if (activeMoveVins.has(vehicle.vin)) reasons.push('active move')
  if (vehicle.movement.locationConfidence === 'conflicting' || vehicle.movement.locationConfidence === 'stale') reasons.push('location check')
  return reasons
}

function scopedMetricHref(kind: 'on-lot' | 'holds' | 'service' | 'moves', stores: readonly StoreName[]) {
  const store = stores.length === 1 ? stores[0] : undefined
  if (kind === 'service') return serviceStatusHref('needs_service', store)
  if (kind === 'moves') return store ? `/transfers?store=${encodeURIComponent(store)}` : '/transfers'
  if (store) return inventoryViewHref(store, kind === 'on-lot' ? 'on-lot' : 'holds')
  return kind === 'on-lot' ? '/inventory?scope=group' : '/attention?category=holds&scope=group'
}

function joinedFact(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value?.trim())).join(' / ') || 'Not published'
}

function SalesVehicleRow({ vehicle, normalized, reasons = [] }: {
  vehicle: VehicleRecord
  normalized: InventoryVehicle
  reasons?: readonly string[]
}) {
  const name = vehicleDisplayName(normalized)
  const standouts = standoutEquipment(normalized, 2).map(item => item.label)
  const economy = [normalized.fuelType, Number.isFinite(normalized.mpgCity) && normalized.mpgCity != null && normalized.mpgCity > 0 ? `${normalized.mpgCity} city` : null, Number.isFinite(normalized.mpgHighway) && normalized.mpgHighway != null && normalized.mpgHighway > 0 ? `${normalized.mpgHighway} highway` : null]
  const location = resolveCurrentLocation(normalized).label

  return <li className="sales-overview__vehicle-row">
    <VehicleThumbnail vehicle={vehicle} className="sales-overview__vehicle-photo" />
    <div className="sales-overview__vehicle-content">
      <div className="sales-overview__vehicle-heading">
        <div className="sales-overview__vehicle-identity">
          <strong>{name}</strong>
          <span>Stock {vehicle.stockNumber}</span>
          <span className="sales-overview__vin">VIN {vehicle.vin}</span>
        </div>
        <div className="sales-overview__price-mileage">
          <strong>{formatMoney(normalized.price)}</strong>
          <span>{normalized.mileage == null ? 'Mileage not published' : `${formatNumber(normalized.mileage)} mi`}</span>
        </div>
        <Link className="sales-overview__open" to={vehicleWorkspacePath(vehicle.vin, { returnTo: '/overview' })} aria-label={`Open vehicle: ${name}`}>Open vehicle</Link>
      </div>

      <dl className="sales-overview__specs">
        <div><dt>Powertrain</dt><dd>{joinedFact([normalized.engine, normalized.drivetrain])}</dd></div>
        <div><dt>Colors</dt><dd>{joinedFact([normalized.exteriorColor, normalized.interiorColor])}</dd></div>
        <div><dt>Transmission / fuel / MPG</dt><dd>{joinedFact([normalized.transmission, ...economy])}</dd></div>
        <div><dt>Standout equipment</dt><dd>{standouts.length ? standouts.join(' / ') : 'None captured'}</dd></div>
      </dl>

      <dl className="sales-overview__operational-facts">
        <div><dt>Listing</dt><dd>{publicListingLabel(normalized)}</dd></div>
        <div><dt>Hold</dt><dd>{vehicle.hold.label}</dd></div>
        <div><dt>Location</dt><dd>{location}</dd></div>
        <div><dt>Service</dt><dd>{serviceLabel(vehicle)}</dd></div>
        {reasons.length ? <div><dt>Why shown</dt><dd>{reasons.join(', ')}</dd></div> : null}
      </dl>
    </div>
  </li>
}

export function SalesOverview({ data, stores, homeStore, role, currentUserId, printing = false }: SalesOverviewProps) {
  const authorizedVehicles = useMemo(() => data.vehicles.map(vehicle => toInventoryVehicle(vehicle, data)), [data])
  const accessContext = useMemo(() => JSON.stringify([currentUserId, role, homeStore, 'overview']), [currentUserId, role, homeStore])
  const savedLists = useSyncedCustomerLists({
    enabled: data.savedListsEnabled === true && Boolean(currentUserId),
    ownerId: currentUserId,
    role,
    store: homeStore,
    context: accessContext,
    authorizedVehicles,
  })
  const management = savedLists.management
  const storeSet = useMemo(() => new Set(stores), [stores])
  const sourceByVin = useMemo(() => new Map(data.vehicles.map(vehicle => [vehicle.vin, vehicle])), [data.vehicles])
  const inventoryByVin = useMemo(() => new Map(authorizedVehicles.map(vehicle => [vehicle.vin, vehicle])), [authorizedVehicles])
  const visibleSavedVehicles = currentUserId && data.savedListsEnabled === true && !management?.accessRevoked ? savedLists.entries.flatMap(entry => {
    if (entry.available === false) return []
    const vehicle = sourceByVin.get(entry.vin)
    return vehicle ? [vehicle] : []
  }) : []
  const savedVins = new Set(visibleSavedVehicles.map(vehicle => vehicle.vin))
  const activeMoves = data.transfers.filter(record => isActiveMove(record) && moveInScope(record, storeSet))
  const activeMoveVins = new Set(activeMoves.map(record => record.vin))
  const scopeOverview = data.overview?.stores.filter(entry => storeSet.has(entry.store)) ?? []
  const overviewCounts = scopeOverview.length ? {
    onLot: scopeOverview.reduce((sum, entry) => sum + entry.onLot, 0),
    holds: scopeOverview.reduce((sum, entry) => sum + entry.holds, 0),
    service: scopeOverview.reduce((sum, entry) => sum + entry.waitingForService, 0),
  } : null
  const fallbackHolds = data.stores.filter(entry => storeSet.has(entry.store)).reduce((sum, entry) => sum + entry.currentHolds, 0)
  const metrics = [
    { label: stores.length === 1 ? 'On lot' : 'Browse group inventory', value: stores.length === 1 ? overviewCounts?.onLot ?? null : data.vehicles.filter(vehicle => vehicleInScope(vehicle, storeSet)).length, href: scopedMetricHref('on-lot', stores) },
    { label: 'Hold signals', value: overviewCounts?.holds ?? fallbackHolds, href: scopedMetricHref('holds', stores) },
    { label: 'Waiting for service', value: overviewCounts?.service ?? data.vehicles.filter(vehicle => vehicleInScope(vehicle, storeSet) && vehicle.serviceReadiness?.status === 'needs_service').length, href: scopedMetricHref('service', stores) },
    { label: 'Active moves', value: activeMoves.length, href: scopedMetricHref('moves', stores) },
  ]
  const relevantVehicles = [...data.vehicles]
    .filter(vehicle => vehicleInScope(vehicle, storeSet) && !savedVins.has(vehicle.vin))
    .map((vehicle, index) => ({ vehicle, index, reasons: attentionReasons(vehicle, data.vehicleIssues ?? [], activeMoveVins) }))
    .sort((left, right) => {
      const leftBand = left.reasons.length ? 0 : 1
      const rightBand = right.reasons.length ? 0 : 1
      return leftBand - rightBand || left.index - right.index
    })
    .slice(0, printing ? undefined : 4)
  const myIssues = currentUserId
    ? (data.vehicleIssues ?? []).filter(issue => issue.reportedByUserId === currentUserId && issue.status !== 'completed')
    : []

  return <div className="sales-overview">
    <section className="sales-overview__metrics" aria-label="Current store facts">
      {metrics.map(metric => <Link key={metric.label} to={metric.href} className="sales-overview__metric" aria-label={`${metric.label}: ${metric.value ?? 'not provided'}`}>
        <span>{metric.label === 'Waiting for service' ? 'Service wait' : metric.label === 'Hold signals' ? 'Holds' : metric.label === 'Active moves' ? 'Moves' : metric.label === 'Browse group inventory' ? 'Inventory' : metric.label}</span><strong>{metric.value ?? '—'}</strong><ArrowRight aria-hidden="true" />
      </Link>)}
    </section>

    <div className={`sales-overview__workspace${visibleSavedVehicles.length ? '' : ' sales-overview__workspace--no-saved'}`}>
      <div className="sales-overview__vehicle-column">
        <section className="sales-overview__panel sales-overview__saved" aria-labelledby="sales-saved-heading">
          <header className="sales-overview__section-head">
            <div><h2 id="sales-saved-heading">Customer saved lists</h2><p>Keep customer choices together. Open a vehicle for holds, history and equipment.</p></div>
            {management?.loading ? <span role="status">Checking for updates…</span> : null}
          </header>
          {data.savedListsEnabled !== true ? <p className="sales-overview__state">Saved lists are not enabled for this service.</p>
            : !currentUserId ? <p className="sales-overview__state">Sign in with an employee identity to view customer saved lists.</p>
            : management?.accessRevoked ? <p className="sales-overview__state sales-overview__state--alert" role="alert">Your saved-list access changed. Reload or sign in again.</p>
            : <>
              {management?.lists.length ? <div className="sales-overview__list-tabs" aria-label="Choose a customer saved list">
                {management.lists.map(list => <button key={list.id} type="button" aria-pressed={management.activeListId === list.id} onClick={() => management.selectList(list.id)}>{list.label}<span>{list.count}</span></button>)}
              </div> : !management?.loading && !management?.error ? <p className="sales-overview__state">No customer saved lists yet. Save vehicles from Inventory when you are working with a customer.</p> : null}
              {management?.error ? <div className="sales-overview__error" role="alert"><span>{management.error}</span><button type="button" onClick={management.retry}><RotateCw aria-hidden="true" />Retry</button></div> : null}
              {visibleSavedVehicles.length ? <ul className="sales-overview__vehicle-list">
                {visibleSavedVehicles.map(vehicle => <SalesVehicleRow key={vehicle.vin} vehicle={vehicle} normalized={inventoryByVin.get(vehicle.vin)!} />)}
              </ul> : management?.activeListId && !management.loading ? <p className="sales-overview__state">This list has no vehicles in your current authorized inventory.</p> : null}
            </>}
        </section>

        {relevantVehicles.length || !visibleSavedVehicles.length ? <section className="sales-overview__panel sales-overview__other" aria-labelledby="sales-relevant-heading">
          <header className="sales-overview__section-head"><div><h2 id="sales-relevant-heading">Other vehicles in scope</h2><p>Vehicles with hold, service, issue, move or location signals appear first. Saved-list vehicles are excluded from this section.</p></div></header>
          {relevantVehicles.length ? <ul className="sales-overview__vehicle-list">
            {relevantVehicles.map(({ vehicle, reasons }) => <SalesVehicleRow key={vehicle.vin} vehicle={vehicle} normalized={inventoryByVin.get(vehicle.vin)!} reasons={reasons} />)}
          </ul> : <p className="sales-overview__state">{visibleSavedVehicles.length ? 'The vehicles in this scope are already in the selected list.' : 'No vehicles are in this store scope.'}</p>}
        </section> : null}
      </div>

      <aside className="sales-overview__sidebar" aria-label="Sales workspace actions">
        <section className="sales-overview__panel sales-overview__browse-panel" aria-labelledby="sales-browse-heading">
          <div><h2 id="sales-browse-heading">Browse other stock</h2><p>Search current authorized inventory across the group.</p></div>
          <Link className="sales-overview__browse" to="/inventory?scope=group">Browse inventory<ArrowRight aria-hidden="true" /></Link>
        </section>

        {currentUserId ? <section className="sales-overview__panel" aria-labelledby="sales-issues-heading">
          <header className="sales-overview__section-head"><div><h2 id="sales-issues-heading">My reported issues</h2><p>Open issues reported with your employee identity.</p></div><strong>{myIssues.length}</strong></header>
          {myIssues.length ? <ul className="sales-overview__plain-list">{myIssues.slice(0, printing ? undefined : 4).map(issue => <li key={issue.id}><div><strong>{issue.vehicleName}</strong><span>Stock {issue.stockNumber}</span><span>{issueLabel(issue)}</span></div><Link to={`/attention?category=issues&issue=${encodeURIComponent(issue.id)}&scope=group`}>Review</Link></li>)}</ul> : <p className="sales-overview__state">No open issues reported by you.</p>}
        </section> : null}

        <section className="sales-overview__panel" aria-labelledby="sales-moves-heading">
          <header className="sales-overview__section-head"><div><h2 id="sales-moves-heading">Store moves</h2><p>Read-only moves touching this store scope.</p></div><Link to={scopedMetricHref('moves', stores)}>View all</Link></header>
          {activeMoves.length ? <ul className="sales-overview__plain-list">{activeMoves.slice(0, printing ? undefined : 3).map(move => <li key={move.id}><div><strong>{move.vehicleName}</strong><span>Stock {move.stockNumber}</span><span>Location {move.currentLocation}</span><span>Next: {move.nextAction}</span></div><Link to={withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(move.id)}`, '/overview')}>Open move</Link></li>)}</ul> : <p className="sales-overview__state"><CarFront aria-hidden="true" />No active moves in this store scope.</p>}
        </section>
      </aside>
    </div>
    <p className="sales-overview__boundary"><AlertCircle aria-hidden="true" />Listing, hold, service, movement, issue, and location facts remain independent. This overview does not confirm availability.</p>
  </div>
}
