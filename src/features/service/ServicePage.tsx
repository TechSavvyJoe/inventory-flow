import { confirmUnsavedWork, useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useWorkspaceLifetime } from '../../lib/useWorkspaceLifetime'
import { useWorkspaceState, useWorkspaceScroll } from '../../lib/workspace-memory'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, CarFront, CheckCircle2, Wrench } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { ApiError, getServiceReadiness, updateServiceReadiness } from '../../lib/api'
import { formatDate, formatNumber } from '../../lib/format'
import { SERVICE_STATUS_OPTIONS, serviceWorkflowStatus, serviceStatusLabel } from '../../lib/service-readiness'
import { vehiclePhotoDisplaySources } from '../../lib/vehicle-photos'
import { currentWorkspaceReturnPath, vehicleWorkspacePath, readWorkspaceReturnPath, workspaceReturnLabel } from '../inventory/inventory-navigation'
import type { ServiceReadinessDetail, ServiceReadinessStatus, ServiceWorkflowStatus, StoreName, UserRole, VehicleRecord } from '../../types'
import { CopyableValue } from '../../components/CopyableValue'
import { PredictiveSearchInput } from '../../components/PredictiveSearchInput'
import { VehicleGallery } from '../inventory/VehicleGallery'
import { ServiceVehicleContext } from './ServiceVehicleContext'
import { searchFieldsMatch } from '../inventory/inventory-search'
import './ServiceDesk.css'

export const SERVICE_LABELS: Record<ServiceReadinessStatus, string> = {
  unknown: 'Waiting for service', needs_service: 'Waiting for service', in_service: 'In service', serviced: 'Ready',
}
const STATUSES = SERVICE_STATUS_OPTIONS.map(option => option.value)
const STATUS_HELP: Record<ServiceReadinessStatus, string> = {
  unknown: 'Service status has not been confirmed. A manager can check each vehicle and record the result.',
  needs_service: 'Vehicles waiting for service or still needing a manager service review. Ready is never assumed.',
  in_service: 'Service has started. Record completion when the work is finished.',
  serviced: 'Ready inventory confirmed by a manager. Completion dates appear when service work was recorded; holds still apply.',
}
const EMPTY_TITLES: Record<ServiceReadinessStatus, string> = {
  unknown: 'No vehicles need a service review', needs_service: 'No vehicles waiting for service',
  in_service: 'No vehicles currently in service', serviced: 'No ready vehicles in this view',
}

function displayDate(value?: string | null): string {
  return value ? formatDate(value.slice(0, 10)) : 'Not recorded';
}

function localToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function ServicePhoto({ vehicle }: { vehicle: VehicleRecord }) {
  const candidates = useMemo(() => vehiclePhotoDisplaySources(vehicle, { width: 240 }), [vehicle.imageUrl, vehicle.imageUrls])
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [candidates.join('\u0000')])
  return <span className="service-photo">{candidates[index]
    ? <img src={candidates[index]} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setIndex((value) => value + 1)} />
    : <CarFront aria-hidden="true" size={30} />}</span>
}

export function ServiceEditor({ vehicle, role, store, initialAction, defaultDate, onSaved, onBack, backLabel = 'Back to service list' }: {
  vehicle: VehicleRecord; role: UserRole; store: StoreName; initialAction: ServiceWorkflowStatus | null; defaultDate: string; onSaved: (status: ServiceReadinessStatus) => Promise<void>; onBack: () => void; backLabel?: string
}) {
  const location = useLocation()
  const [detail, setDetail] = useState<ServiceReadinessDetail | null>(null)
  const [status, setStatus] = useState<ServiceWorkflowStatus>(serviceWorkflowStatus(vehicle.serviceReadiness))
  const [editing, setEditing] = useState(false)
  const [editIntent, setEditIntent] = useState<'transition' | 'note' | 'completion'>('transition')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [retry, setRetry] = useState(0)
  const editorRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const initialEdit = useRef('')
  const captureWorkspace = useWorkspaceLifetime(`${role}:${store}:${vehicle.vin}`)
  const { confirmDiscard, markSaved } = useUnsavedChanges(editing && JSON.stringify([status, date, notes]) !== initialEdit.current, { saving: busy })
  const newerRecordAvailable = detail !== null && (vehicle.serviceReadiness?.version ?? 0) > detail.version
  const recordsHref = vehicleWorkspacePath(vehicle.vin, { tab: 'data', returnTo: currentWorkspaceReturnPath(location) })
  const configuration = [
    ['Engine / drive', [vehicle.engine, vehicle.drivetrain].filter(Boolean).join(' · ')],
    ['Transmission', vehicle.transmission],
    ['Exterior', vehicle.exteriorColor],
    ['Fuel', vehicle.fuelType],
  ].filter(([, value]) => value)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.scrollTop = 0
    headingRef.current?.focus({ preventScroll: true })
    if (window.matchMedia?.('(max-width: 850px)').matches) editor.scrollIntoView?.({ block: 'start' })
  }, [vehicle.vin])

  function acceptDetail(value: ServiceReadinessDetail, openAction = false) {
    initialEdit.current = JSON.stringify([
      openAction && initialAction ? initialAction : serviceWorkflowStatus(value),
      openAction && initialAction ? defaultDate : value.status === 'serviced' ? value.completedAt ?? defaultDate : value.serviceEnteredAt ?? defaultDate,
      value.notes ?? '',
    ])
    setDetail(value)
    setStatus(openAction && initialAction ? initialAction : serviceWorkflowStatus(value))
    setDate(openAction && initialAction ? defaultDate : value.status === 'serviced' ? value.completedAt ?? defaultDate : value.serviceEnteredAt ?? defaultDate)
    setNotes(value.notes ?? '')
    setEditIntent('transition')
    setEditing(Boolean(openAction && initialAction && value.canManage))
  }

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setError('')
    void getServiceReadiness(vehicle.vin, role, store).then((value) => {
      if (!canceled) acceptDetail(value, true)
    }).catch((caught: unknown) => {
      if (!canceled) setError(caught instanceof Error ? caught.message : 'Unable to load service history.')
    }).finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [vehicle.vin, role, store, retry, initialAction])

  function beginAction(next: ServiceWorkflowStatus) {
    setEditIntent('transition'); setStatus(next); setDate(defaultDate); setEditing(true); setSaved(''); setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!detail?.canManage || busy || loading || newerRecordAvailable) return
    const isCurrentWorkspace = captureWorkspace()
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const result = await updateServiceReadiness(vehicle.vin, {
        status, expectedVersion: detail.version, notes,
        ...(['in_service', 'serviced'].includes(status) ? { serviceDate: date } : {}),
      }, role, store)
      if (!isCurrentWorkspace()) return
      markSaved()
      acceptDetail(result)
      setSaved(`${SERVICE_LABELS[result.status]} saved for ${vehicle.stockNumber}.`)
      await onSaved(result.status)
    } catch (caught) {
      if (!isCurrentWorkspace()) return
      setError(caught instanceof Error ? caught.message : 'Service status could not be saved. Try again.')
      if (caught instanceof ApiError && caught.status === 409) {
        // Keep the edited fields while learning the latest version. A second,
        // deliberate save still uses optimistic concurrency against that version.
        try {
          const latest = await getServiceReadiness(vehicle.vin, role, store)
          if (isCurrentWorkspace()) setDetail(latest)
        } catch { /* The current draft remains available to retry. */ }
      }
    } finally { if (isCurrentWorkspace()) setBusy(false) }
  }

  const historyEntry = (entry: ServiceReadinessDetail['history'][number]) => <li key={entry.version}><strong>{serviceStatusLabel(entry)}</strong><span>{entry.updatedBy} · {displayDate(entry.updatedAt)}</span>{entry.serviceEnteredAt && <span>Entered service {displayDate(entry.serviceEnteredAt)}</span>}{entry.completedAt && <span>Completed {displayDate(entry.completedAt)}</span>}{entry.notes && <p>{entry.notes}</p>}</li>

  return <aside ref={editorRef} className="service-editor" aria-label={`Service for ${vehicle.vehicleName}`}>
    <button className="service-back" type="button" onClick={() => { if (confirmDiscard()) onBack() }}><ArrowLeft size={17} />{backLabel}</button>
    <section className="service-vehicle-summary" aria-label="Vehicle summary">
    <header className="service-editor-heading">
      <VehicleGallery vehicle={{ id: vehicle.vin, vehicleName: vehicle.vehicleName, imageUrl: vehicle.imageUrl, imageUrls: vehicle.imageUrls, photoCount: vehicle.photoCount }} />
      <div className="service-editor-identity">
        <h2 ref={headingRef} tabIndex={-1}>{vehicle.vehicleName}</h2>
        <p>{vehicle.serviceReadiness?.store ?? vehicle.homeStore}</p>
        <div className="service-editor-facts">
          <strong>{vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : 'Mileage unavailable'}</strong>
          {vehicle.daysListed != null && <span>{vehicle.daysListed} days listed</span>}
        </div>
      </div>
    </header>
    <dl className="service-editor-identifiers" aria-label="Vehicle identification">
      <div><dt>Stock</dt><dd><CopyableValue label="stock number" text={vehicle.stockNumber} compact>{vehicle.stockNumber}</CopyableValue></dd></div>
      <div className="service-editor-vin"><dt>VIN</dt><dd><CopyableValue label="VIN" text={vehicle.vin} compact>{vehicle.vin}</CopyableValue></dd></div>
    </dl>
    {configuration.length > 0 && <dl className="service-vehicle-configuration" aria-label="Vehicle configuration">
      {configuration.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    </section>
    <section className="service-status-panel" aria-labelledby="service-status-heading">
      <header className="service-status-heading">
        <h3 id="service-status-heading">Service status</h3>
        {!loading && detail?.canManage && !editing && <button type="button" className="service-note-action" disabled={busy || newerRecordAvailable} onClick={() => { setEditIntent(serviceWorkflowStatus(detail) === 'serviced' && !detail.completedAt ? 'completion' : 'note'); setStatus(serviceWorkflowStatus(detail)); setSaved(''); setError(''); setEditing(true) }}>{serviceWorkflowStatus(detail) === 'serviced' && !detail.completedAt ? 'Record completion' : 'Edit note'}</button>}
      </header>
    {loading ? <p role="status">Loading service history…</p> : <>
      {error && <div className="service-error" role="alert"><p>{error}</p>{!detail && <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>}</div>}
      {newerRecordAvailable && <div className="service-error" role="status">
        <p>A newer service update is available. Your unsaved edits are still here. Loading the latest status will replace them.</p>
        <button type="button" disabled={busy} onClick={() => { if (confirmDiscard()) { setSaved(''); setRetry((value) => value + 1) } }}>Load latest status</button>
      </div>}
      {saved && <p className="service-saved" role="status"><CheckCircle2 size={18} />{saved}</p>}
      {detail && <>
        <section className="service-state-summary" aria-label="Recorded service status">
          <p className={`service-current service-current--${serviceWorkflowStatus(detail)}`}><span className="service-current-label">Current state</span><strong>{serviceWorkflowStatus(detail) === 'serviced' && <CheckCircle2 size={18} aria-hidden="true" />}{serviceStatusLabel(detail)}</strong></p>
          {(detail.serviceEnteredAt || detail.completedAt) && <div className="service-recorded-dates">{detail.serviceEnteredAt && <span>Entered service<strong>{displayDate(detail.serviceEnteredAt)}</strong></span>}{detail.completedAt && <span>Completed<strong>{displayDate(detail.completedAt)}</strong></span>}</div>}
        </section>
        {detail.readinessBasis === 'unconfirmed' && <p className="service-unconfirmed">No service completion is recorded. Check the vehicle’s service record, then mark it Ready or start the work needed.</p>}
        {detail.canManage ? <>
          {!editing && <div className="service-status-switch" role="group" aria-label="Service actions">
            {(['needs_service', 'in_service', 'serviced'] as const).map((value) => <button
              key={value}
              type="button"
              aria-pressed={serviceWorkflowStatus(detail) === value}
              disabled={busy || newerRecordAvailable}
              onClick={() => { if (serviceWorkflowStatus(detail) !== value) beginAction(value) }}
            >{value === 'needs_service' ? 'Waiting' : value === 'in_service' ? 'In service' : 'Ready'}</button>)}
          </div>}
          {editing && <form onSubmit={(event) => void submit(event)}>
          <h3>{editIntent === 'note' ? 'Edit service note' : editIntent === 'completion' ? 'Record service completion' : status === 'in_service' ? 'Start service' : status === 'serviced' ? 'Confirm Ready' : 'Waiting for service'}</h3>
          {['in_service', 'serviced'].includes(status) && <><label htmlFor="service-date">{status === 'in_service' ? 'Date entered service' : 'Date service completed'}</label><input id="service-date" type="date" value={date} required disabled={busy} onChange={(event) => setDate(event.target.value)} /></>}
          <label htmlFor="service-notes">Service note <span>(optional)</span></label>
          <textarea id="service-notes" value={notes} maxLength={1000} rows={2} disabled={busy} placeholder="Work needed, completed, or a short handoff note" onChange={(event) => setNotes(event.target.value)} />
          <p className="service-form-help">{editIntent === 'note' ? `Current state: ${SERVICE_LABELS[detail.status]}. Your name and save time are recorded.` : status === 'serviced' ? 'Confirm the vehicle is ready. This records your name and completion date.' : 'Your name and save time are recorded.'}</p>
          <div className="service-direct-actions"><button className="service-save" type="submit" disabled={busy || newerRecordAvailable}>{busy ? 'Saving…' : editIntent === 'note' ? 'Save note' : 'Save service status'}</button><button type="button" disabled={busy} onClick={() => { if (confirmDiscard()) { acceptDetail(detail); setEditing(false) } }}>Cancel</button></div>
        </form>}</> : <p className="service-permission">{detail.store ? `A ${detail.store} manager can update this vehicle’s service status.` : 'A group manager can update service until the vehicle’s store is confirmed.'}</p>}

      </>}
      {/* Vehicle references come from the inventory record, not the service
          endpoint, so they stay readable when service detail fails to load. */}
      <dl className="service-fact-grid" aria-label="Service decision facts">
        <div><dt>Hold</dt><dd>{['primary', 'backup', 'multiple'].includes(vehicle.hold?.state) ? vehicle.hold.label || 'Held — confirm availability' : vehicle.hold?.state === 'none_observed' ? 'No observed hold' : 'Review hold status'}</dd></div>
        <div><dt>Location</dt><dd>{vehicle.movement?.currentLocation || vehicle.sourceReportedLocation || 'Not confirmed'}<small>{vehicle.movement?.currentLocation && vehicle.movement.locationConfidence === 'verified' ? 'Confirmed location' : 'Confirm with the store'}</small></dd></div>
      </dl>
      <nav className="service-vehicle-links" aria-label="Vehicle reference"><Link className="service-vehicle-link" to={vehicleWorkspacePath(vehicle.vin, { returnTo: currentWorkspaceReturnPath(location) })}>Vehicle details</Link><Link className="service-vehicle-link" to={vehicleWorkspacePath(vehicle.vin, { tab: 'data', returnTo: currentWorkspaceReturnPath(location) })}>Records</Link></nav>
    </>}
    </section>
    <ServiceVehicleContext vehicle={vehicle} recordsHref={recordsHref} />
      {!loading && detail && <>
        <section className="service-history" aria-labelledby="service-history-title"><h3 id="service-history-title">Service history</h3>
          {detail.history.length ? <><ol>{detail.history.slice(0, 3).map(historyEntry)}</ol>{detail.history.length > 3 && <details><summary>Earlier updates ({detail.history.length - 3})</summary><ol>{detail.history.slice(3).map(historyEntry)}</ol></details>}</> : <p>{detail.version ? 'Detailed service history is limited to sales staff and managers.' : serviceWorkflowStatus(detail) === 'serviced' ? 'Ready is recorded. No completion date is available.' : 'Service has not been confirmed. A manager must mark this vehicle Ready after review.'}</p>}
        </section>
      </>}
  </aside>
}

export function ServicePage({ toolbarAccessory }: { toolbarAccessory?: ReactNode } = {}) {
  const { data, homeStore, role, currentUser, refresh } = useAppData()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const returnTo = readWorkspaceReturnPath(params.get('returnTo'))
  const accessContext = `${currentUser}:${role}:${homeStore}`
  useWorkspaceScroll(accessContext, 'service')
  const [scope, setScope] = useWorkspaceState<'my_store' | 'all'>(accessContext, 'service.scope', 'my_store')
  const [search, setSearch] = useWorkspaceState(accessContext, 'service.search', '')
  const statusParam = params.get('status') as ServiceWorkflowStatus
  const actionParam = params.get('action') as ServiceWorkflowStatus
  const selectedVin = params.get('vin')
  const selected = data?.vehicles.find((vehicle) => vehicle.vin === selectedVin)
  const status = STATUSES.includes(statusParam) ? statusParam : selected ? serviceWorkflowStatus(selected.serviceReadiness) : 'needs_service'
  const scoped = useMemo(() => (data?.vehicles ?? []).filter((vehicle) => scope === 'all' || (vehicle.serviceReadiness?.store ?? vehicle.homeStore) === homeStore), [data, scope, homeStore])
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((value) => [value, scoped.filter((vehicle) => serviceWorkflowStatus(vehicle.serviceReadiness) === value).length])) as Record<ServiceWorkflowStatus, number>, [scoped])
  const statusVehicles = scoped.filter((vehicle) => serviceWorkflowStatus(vehicle.serviceReadiness) === status)
  const vehicles = statusVehicles.filter((vehicle) => searchFieldsMatch(search, [vehicle.vehicleName, vehicle.stockNumber, vehicle.vin, vehicle.searchText]))
  function selectVin(vin: string | null) { if (!confirmUnsavedWork()) return; setParams((current) => { const next = new URLSearchParams(current); next.delete('action'); if (vin) next.set('vin', vin); else next.delete('vin'); return next }) }
  async function savedStatus(nextStatus: ServiceReadinessStatus) {
    setParams((current) => { const next = new URLSearchParams(current); next.set('status', nextStatus); next.delete('action'); return next }, { replace: true })
    await refresh()
  }
  if (!data) return null
  return <section className={`service-page${selected ? ' service-has-selection' : ''}${selected && returnTo ? ' service-from-vehicle' : ''}`}>
    <header className="service-page-heading"><h1><Wrench aria-hidden="true" size={25} />Service status</h1><div className="service-heading-controls">{toolbarAccessory}<div className="service-scope" role="group" aria-label="Service inventory scope"><button type="button" aria-pressed={scope === 'my_store'} onClick={() => setScope('my_store')}>My store · {homeStore}</button><button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All stores</button></div></div></header>
    <div className="service-tabs" role="group" aria-label="Service status">
      {STATUSES.map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setParams({ status: value, ...(returnTo ? { returnTo } : {}) })}>{SERVICE_LABELS[value]}{' '}<span>{counts[value]}</span></button>)}
    </div>
    {selectedVin && !selected && <p role="status" className="service-permission">This vehicle is not in the current inventory. Select a vehicle below to review service status.</p>}
    <div className="service-content"><div className="service-list-panel">
      <div className="service-list-toolbar"><p>{STATUS_HELP[status]}</p><PredictiveSearchInput className="service-search" inputType="search" value={search} onChange={setSearch} ariaLabel="Search service vehicles" clearLabel="Clear service search" placeholder="Search stock, VIN, model" candidates={statusVehicles.map(vehicle => ({ id: vehicle.vin, label: vehicle.vehicleName, detail: `#${vehicle.stockNumber}`, value: vehicle.stockNumber, searchValues: [vehicle.vehicleName, vehicle.stockNumber, vehicle.vin, vehicle.searchText] }))} /></div>
      <p className="service-result-count" role="status">{vehicles.length} {vehicles.length === 1 ? 'vehicle' : 'vehicles'} · {scope === 'all' ? 'All stores' : homeStore}</p>
      {vehicles.length ? <ul className="service-list">{vehicles.map((vehicle) => <li key={vehicle.vin}><button className="service-vehicle-row" type="button" aria-pressed={selectedVin === vehicle.vin} onClick={() => selectVin(vehicle.vin)}>
        <ServicePhoto key={vehicle.vin} vehicle={vehicle} /><span className="service-vehicle-info"><strong>{vehicle.vehicleName}</strong><span>Stock {vehicle.stockNumber} · {vehicle.serviceReadiness?.store ?? vehicle.homeStore}</span><small>{vehicle.vin}</small></span>
        <span className="service-row-numbers"><strong>{vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : 'Mileage unavailable'}</strong><span>{vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : vehicle.inventoryDate ? `Listed ${displayDate(vehicle.inventoryDate)}` : ''}</span></span>
        <span className={`service-status-badge service-status-${status}`}>{SERVICE_LABELS[status]}<small>{vehicle.serviceReadiness?.notes || (status === 'in_service' && vehicle.serviceReadiness?.serviceEnteredAt ? `Since ${displayDate(vehicle.serviceReadiness.serviceEnteredAt)}` : 'View & update')}</small></span>
      </button></li>)}</ul> : <div className="service-empty"><CheckCircle2 size={28} /><h2>{search ? 'No matching vehicles' : EMPTY_TITLES[status]}</h2><p>{search ? 'Try a stock number, VIN, or model.' : 'Choose another status or expand to all stores.'}</p>{search ? <button type="button" onClick={() => setSearch('')}>Clear search</button> : scope === 'my_store' ? <button type="button" onClick={() => setScope('all')}>Search all stores</button> : null}</div>}
    </div>{selected && <ServiceEditor key={`${selected.vin}:${role}:${homeStore}`} vehicle={selected} role={role} store={homeStore} initialAction={STATUSES.includes(actionParam) ? actionParam : null} defaultDate={selected.vin.startsWith('TESTDATA') ? data.meta.reportDate : localToday()} onSaved={savedStatus} backLabel={returnTo ? workspaceReturnLabel(returnTo) : undefined} onBack={() => returnTo ? navigate(returnTo) : selectVin(null)} />}</div>
  </section>
}
