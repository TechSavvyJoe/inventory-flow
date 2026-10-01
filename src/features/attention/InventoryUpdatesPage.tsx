import { useMemo } from 'react'
import { useWorkspaceScroll, useWorkspaceState } from '../../lib/workspace-memory'
import { ArrowRight, CheckCircle2, Info } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { VehicleThumbnail } from '../../components/VehicleThumbnail'
import { VehicleQuickFacts } from '../../components/VehicleQuickFacts'
import { PredictiveSearchInput } from '../../components/PredictiveSearchInput'
import { formatCurrency, formatDate, formatNumber } from '../../lib/format'
import type { PublicChangeEvent, PublicChangeType } from '../../types'
import { scopePublicChanges } from './change-scope'
import { ServiceStatusLink } from '../inventory/ServiceStatusLink'
import { currentWorkspaceReturnPath, vehicleWorkspacePath, withWorkspaceReturnPath } from '../../lib/inventory-navigation'
import { searchFieldsMatch } from '../../lib/search'
import '../../styles/workflow-pages.css'
import './InventoryUpdatesPage.css'

type UpdateView = 'new' | 'price' | 'other'
const LABELS: Record<PublicChangeType, string> = { new_arrival: 'New arrival', price_change: 'Price changed', removed: 'Listing removed', mileage_change: 'Mileage updated', website_status_change: 'Online status changed', stock_correction: 'Stock number corrected', store_transfer: 'Listed store changed' }
// Website listing state is not an operational change for store staff: a unit
// leaving or changing status on the website confirms nothing about a sale,
// delivery, hold, or physical location. Keep it out of the feed so the changes
// people act on (arrivals, prices, mileage, stock, store) stay visible.
const HIDDEN_UPDATE_TYPES: ReadonlySet<PublicChangeType> = new Set(['removed', 'website_status_change'])
const belongsToView = (event: PublicChangeEvent, view: UpdateView) => !HIDDEN_UPDATE_TYPES.has(event.type) && (view === 'new' ? event.type === 'new_arrival' : view === 'price' ? event.type === 'price_change' : !['new_arrival', 'price_change'].includes(event.type))
const eventSearchFields = (event: PublicChangeEvent) => [event.vehicleName, event.stockNumber, event.vin, event.store]
function eventValue(event: PublicChangeEvent, value: PublicChangeEvent['beforeValue']) {
  if (value === null || value === '') return 'Not published'
  if (event.valueType === 'money') return formatCurrency(Number(value))
  if (event.valueType === 'mileage') return `${formatNumber(Number(value))} mi`
  return String(value)
}

export function InventoryUpdatesPage() {
  const { data, homeStore, role, currentUser } = useAppData()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const view: UpdateView = params.get('view') === 'price' ? 'price' : params.get('view') === 'other' ? 'other' : 'new'
  const accessContext = `${currentUser}:${role}:${homeStore}`
  useWorkspaceScroll(accessContext, 'updates')
  const [scope, setScope] = useWorkspaceState<'home' | 'group'>(accessContext, 'updates.scope', 'home')
  const [query, setQuery] = useWorkspaceState(accessContext, 'updates.query', '')
  const [otherType, setOtherType] = useWorkspaceState(accessContext, 'updates.type', 'all')
  const allChanges = data?.publicChanges ?? []
  const certifiedTotal = Object.values(data?.meta.publicChangeCounts ?? {}).reduce((total, count) => total + count, 0)
  const baseline = allChanges[0]?.previousReportDate || data?.meta.publicChangeBaselineDate
  const hasComparison = certifiedTotal > 0 || Boolean(baseline)
  const countKeys = { new_arrival: 'newArrival', price_change: 'priceChange', removed: 'removed', mileage_change: 'mileageChange', website_status_change: 'websiteStatusChange', stock_correction: 'stockCorrection', store_transfer: 'storeTransfer' } as const
  const detailCertified = allChanges.length === certifiedTotal && (certifiedTotal > 0 || Boolean(baseline)) && Object.entries(countKeys).every(([type, key]) => allChanges.filter(event => event.type === type).length === (data?.meta.publicChangeCounts[key] ?? 0))
  const displayScope = detailCertified ? scope : 'group'
  const scoped = scopePublicChanges(allChanges, displayScope, homeStore)
  const vehicles = useMemo(() => new Map(data?.vehicles.map(vehicle => [vehicle.vin, vehicle]) ?? []), [data?.vehicles])
  if (!data) return null
  const totals = detailCertified ? { new: scoped.filter(event => event.type === 'new_arrival').length, price: scoped.filter(event => event.type === 'price_change').length, other: scoped.filter(event => belongsToView(event, 'other')).length } : { new: data.meta.publicChangeCounts.newArrival, price: data.meta.publicChangeCounts.priceChange, other: certifiedTotal - data.meta.publicChangeCounts.newArrival - data.meta.publicChangeCounts.priceChange - data.meta.publicChangeCounts.removed - data.meta.publicChangeCounts.websiteStatusChange }
  const viewChanges = detailCertified ? scoped.filter(event => belongsToView(event, view) && (view !== 'other' || otherType === 'all' || event.type === otherType)) : []
  const visible = viewChanges.filter(event => searchFieldsMatch(query, eventSearchFields(event))).sort((a, b) => {
    if (view === 'price') return (Number(a.afterValue) - Number(a.beforeValue)) - (Number(b.afterValue) - Number(b.beforeValue))
    return a.vehicleName.localeCompare(b.vehicleName, 'en-US')
  })
  function selectView(next: UpdateView) { const nextParams = new URLSearchParams(params); nextParams.set('view', next); setParams(nextParams) }
  return <section className="workflow-page inventory-updates-page">
    <div className="workflow-page-heading"><div><h1>Inventory updates</h1><p>New arrivals and price changes for your inventory.</p></div><div className="workflow-scope" role="group" aria-label="Inventory change store scope"><button type="button" disabled={!detailCertified} aria-pressed={displayScope === 'home'} onClick={() => setScope('home')}>{homeStore}</button><button type="button" aria-pressed={displayScope === 'group'} onClick={() => setScope('group')}>All stores</button></div></div>
    <div className="workflow-tabs" role="group" aria-label="Inventory update type">{([['new','New arrivals'], ['price','Price changes'], ['other','Other updates']] as const).map(([key,label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => selectView(key)}>{label}<span>{hasComparison ? totals[key] : '—'}</span></button>)}</div>
    <div className="workflow-toolbar"><PredictiveSearchInput className="workflow-search" ariaLabel="Search inventory updates" clearLabel="Clear update search" value={query} onChange={setQuery} placeholder="Search make, model, stock, or VIN" candidates={viewChanges.map(event => ({ id: event.id, label: event.vehicleName, detail: `${event.stockNumber} · ${event.store}`, value: event.stockNumber || event.vin, searchValues: eventSearchFields(event) }))}/>
      {view === 'other' ? <label className="workflow-select"><span className="sr-only">Other update type</span><select value={otherType} onChange={event => setOtherType(event.target.value)}><option value="all">All other updates</option>{Object.entries(LABELS).filter(([type]) => !['new_arrival','price_change'].includes(type) && !HIDDEN_UPDATE_TYPES.has(type as PublicChangeType)).map(([type,label]) => <option value={type} key={type}>{label}</option>)}</select></label> : null}
      <span className="updates-date">{baseline ? `${formatDate(baseline)} → ` : ''}{formatDate(data.meta.reportDate)}</span>
    </div>
    {data.meta.publicFreshness !== 'current' ? <p className="workflow-notice" role="status">Some inventory changes need review before acting on them.</p> : null}
    {!detailCertified && hasComparison ? <p className="workflow-notice" role="status">Showing verified group totals. Vehicle-level detail could not be reconciled for this update.</p> : null}
    <div role="list" aria-label={`${view === 'new' ? 'New arrivals' : view === 'price' ? 'Price changes' : 'Other updates'} results`}>
      {visible.map(event => { const vehicle = vehicles.get(event.vin); const delta = event.type === 'price_change' && typeof event.beforeValue === 'number' && typeof event.afterValue === 'number' ? event.afterValue - event.beforeValue : null
        return <article key={event.id} role="listitem" className="updates-row">
          <div className="workflow-vehicle"><VehicleThumbnail vehicle={vehicle}/><div><strong>{event.vehicleName}</strong><small>Stock {event.stockNumber}</small><small>{event.vin}</small></div></div>
          <div className="updates-values">{view === 'price' ? <><del>{eventValue(event,event.beforeValue)}</del><strong>{eventValue(event,event.afterValue)}</strong>{delta !== null && delta !== 0 ? <span className={delta < 0 ? 'price-down' : 'price-up'}>{delta < 0 ? 'Down' : 'Up'} {formatCurrency(Math.abs(delta))}</span> : null}</> : view === 'new' ? <><span>Added {formatDate(event.reportDate)}</span><strong>{typeof vehicle?.listedPrice === 'number' ? formatCurrency(vehicle.listedPrice) : 'Price not published'}</strong></> : <><strong style={{fontSize: 14}}>{LABELS[event.type]}</strong><span>{event.field}</span><span>{eventValue(event,event.beforeValue)} → {eventValue(event,event.afterValue)}</span></>}</div>
          <div className="updates-specs"><strong>{event.store}</strong>{typeof vehicle?.mileage === 'number' ? <span>{formatNumber(vehicle.mileage)} mi</span> : null}<VehicleQuickFacts vehicle={vehicle} />{vehicle && event.currentVehicle && view === 'new' ? <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} /> : null}</div>
          {event.currentVehicle ? <div className="updates-actions"><Link className="workflow-action workflow-action--primary" to={vehicleWorkspacePath(event.vin, { returnTo: currentWorkspaceReturnPath(location) })}>Vehicle details<ArrowRight aria-hidden="true"/></Link>{vehicle ? <div className="workflow-quick-actions"><Link to={vehicleWorkspacePath(event.vin, { tab: 'data', returnTo: currentWorkspaceReturnPath(location) })}>Records</Link>{view === 'new' ? <Link to={withWorkspaceReturnPath(`/service?vin=${encodeURIComponent(event.vin)}`, currentWorkspaceReturnPath(location))}>Service</Link> : null}</div> : null}</div> : <span className="updates-actions workflow-muted">No current listing</span>}
        </article>
      })}
      {!visible.length ? <div className="workflow-empty">{!detailCertified ? <Info aria-hidden="true" style={{ color: 'var(--ink-600)' }}/> : <CheckCircle2 aria-hidden="true"/>}<h2>{!hasComparison ? 'Waiting for the first inventory comparison' : !detailCertified ? 'Vehicle details are unavailable for this comparison' : query ? 'No updates match your search' : `No ${view === 'new' ? 'new arrivals' : view === 'price' ? 'price changes' : 'other updates'} in this view`}</h2><p>{!hasComparison ? 'New arrivals and price changes appear after two completed inventory updates.' : detailCertified ? `Showing ${displayScope === 'home' ? homeStore : 'all stores'} for the latest verified comparison.` : 'The verified totals remain available above.'}</p>{query ? <button type="button" onClick={() => setQuery('')}>Clear search</button> : detailCertified && scope === 'home' ? <button type="button" onClick={() => setScope('group')}>See all stores</button> : null}</div> : null}
    </div>
    <details className="updates-source"><summary>About this update</summary><p>Changes compare completed public inventory snapshots. Website listing status and removed listings are left out: they do not confirm a sale, delivery, hold release, or physical departure.</p><p>Hold follow-ups are in Action center. Service status is recorded separately by store managers.</p></details>
  </section>
}
