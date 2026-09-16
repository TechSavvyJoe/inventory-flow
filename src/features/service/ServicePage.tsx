import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CarFront, CheckCircle2, Search, Wrench } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { ApiError, getServiceReadiness, updateServiceReadiness } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import { SERVICE_STATUS_OPTIONS, serviceWorkflowStatus, serviceStatusLabel } from '../../lib/service-readiness'
import type { ServiceReadinessDetail, ServiceReadinessStatus, ServiceWorkflowStatus, StoreName, UserRole, VehicleRecord } from '../../types'
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

function displayDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : 'Not recorded'
}

function localToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function ServicePhoto({ vehicle }: { vehicle: VehicleRecord }) {
  const candidates = [vehicle.imageUrl, ...(vehicle.imageUrls ?? [])].filter((url): url is string => Boolean(url))
  const [index, setIndex] = useState(0)
  return <span className="service-photo">{candidates[index]
    ? <img src={candidates[index]} alt="" loading="lazy" onError={() => setIndex((value) => value + 1)} />
    : <CarFront aria-hidden="true" size={30} />}</span>
}

function ServiceEditor({ vehicle, role, store, initialAction, defaultDate, onSaved, onBack }: {
  vehicle: VehicleRecord; role: UserRole; store: StoreName; initialAction: ServiceWorkflowStatus | null; defaultDate: string; onSaved: (status: ServiceReadinessStatus) => Promise<void>; onBack: () => void
}) {
  const [detail, setDetail] = useState<ServiceReadinessDetail | null>(null)
  const [status, setStatus] = useState<ServiceWorkflowStatus>(serviceWorkflowStatus(vehicle.serviceReadiness))
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [retry, setRetry] = useState(0)
  const editorRef = useRef<HTMLElement>(null)
  const newerRecordAvailable = detail !== null && (vehicle.serviceReadiness?.version ?? 0) > detail.version
  const openFordActions = vehicle.fordOasis?.openFieldServiceActions ?? []

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.scrollTop = 0
    editor.focus({ preventScroll: true })
    if (window.matchMedia?.('(max-width: 850px)').matches) editor.scrollIntoView?.({ block: 'start' })
  }, [vehicle.vin])

  function acceptDetail(value: ServiceReadinessDetail, openAction = false) {
    setDetail(value)
    setStatus(openAction && initialAction ? initialAction : serviceWorkflowStatus(value))
    setDate(openAction && initialAction ? defaultDate : value.status === 'serviced' ? value.completedAt ?? defaultDate : value.serviceEnteredAt ?? defaultDate)
    setNotes(value.notes ?? '')
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
  }, [vehicle.vin, role, store, retry, initialAction, defaultDate])

  function beginAction(next: ServiceWorkflowStatus) {
    setStatus(next); setDate(defaultDate); setEditing(true); setSaved(''); setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!detail?.canManage || busy || loading || newerRecordAvailable) return
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const result = await updateServiceReadiness(vehicle.vin, {
        status, expectedVersion: detail.version, notes,
        ...(['in_service', 'serviced'].includes(status) ? { serviceDate: date } : {}),
      }, role, store)
      acceptDetail(result)
      setSaved(`${SERVICE_LABELS[result.status]} saved for ${vehicle.stockNumber}.`)
      await onSaved(result.status)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Service status could not be saved. Try again.')
      if (caught instanceof ApiError && caught.status === 409) {
        try { acceptDetail(await getServiceReadiness(vehicle.vin, role, store)) } catch { setDetail(null) }
      }
    } finally { setBusy(false) }
  }

  return <aside ref={editorRef} tabIndex={-1} className="service-editor" aria-label={`Service for ${vehicle.vehicleName}`}>
    <button className="service-back" type="button" onClick={onBack}><ArrowLeft size={17} />Back to service list</button>
    <div className="service-editor-heading"><ServicePhoto key={vehicle.vin} vehicle={vehicle} /><div><h2>{vehicle.vehicleName}</h2><p>#{vehicle.stockNumber} · {vehicle.serviceReadiness?.store ?? vehicle.homeStore}</p><small>{vehicle.vin}</small></div></div>
    <div className="service-editor-facts"><strong>{vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : 'Mileage not captured'}</strong>{vehicle.exteriorColor && <span>{vehicle.exteriorColor}</span>}</div>
    {loading ? <p role="status">Loading service history…</p> : <>
      {error && <div className="service-error" role="alert"><p>{error}</p>{!detail && <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>}</div>}
      {newerRecordAvailable && <div className="service-error" role="status">
        <p>A newer service update is available. Your unsaved edits are still here. Loading the latest status will replace them.</p>
        <button type="button" disabled={busy} onClick={() => { setSaved(''); setRetry((value) => value + 1) }}>Load latest status</button>
      </div>}
      {saved && <p className="service-saved" role="status"><CheckCircle2 size={18} />{saved}</p>}
      {detail && <>
        <p className="service-current">Current state<strong>{serviceStatusLabel(detail)}</strong></p>
        {detail.readinessBasis === 'unconfirmed' && <p className="service-unconfirmed">No service completion is recorded. Check the vehicle’s service record, then mark it Ready or start the work needed.</p>}
        {(detail.serviceEnteredAt || detail.completedAt) && <div className="service-recorded-dates">{detail.serviceEnteredAt && <span>Entered service<strong>{displayDate(detail.serviceEnteredAt)}</strong></span>}{detail.completedAt && <span>Completed<strong>{displayDate(detail.completedAt)}</strong></span>}</div>}
        {detail.canManage ? <>
          {!editing && <div className="service-direct-actions" role="group" aria-label="Service actions">
            {serviceWorkflowStatus(detail) !== 'in_service' && <button type="button" className="service-save" disabled={busy || newerRecordAvailable} onClick={() => beginAction('in_service')}>Start service</button>}
            {serviceWorkflowStatus(detail) !== 'serviced' && <button type="button" disabled={busy || newerRecordAvailable} onClick={() => beginAction('serviced')}>Mark Ready</button>}
            {serviceWorkflowStatus(detail) !== 'needs_service' && <button type="button" disabled={busy || newerRecordAvailable} onClick={() => beginAction('needs_service')}>Waiting for service</button>}
            <button type="button" disabled={busy || newerRecordAvailable} onClick={() => { setStatus(serviceWorkflowStatus(detail)); setEditing(true) }}>{serviceWorkflowStatus(detail) === 'serviced' && !detail.completedAt ? 'Record service completion' : 'Edit note'}</button>
          </div>}
          {editing && <form onSubmit={(event) => void submit(event)}>
          <h3>{status === 'in_service' ? 'Start service' : status === 'serviced' ? 'Confirm Ready' : 'Waiting for service'}</h3>
          {['in_service', 'serviced'].includes(status) && <><label htmlFor="service-date">{status === 'in_service' ? 'Date entered service' : 'Date service completed'}</label><input id="service-date" type="date" value={date} required disabled={busy} onChange={(event) => setDate(event.target.value)} /></>}
          <label htmlFor="service-notes">Service note <span>(optional)</span></label>
          <textarea id="service-notes" value={notes} maxLength={1000} rows={2} disabled={busy} placeholder="Work needed, completed, or a short handoff note" onChange={(event) => setNotes(event.target.value)} />
          <p className="service-form-help">{status === 'serviced' ? 'Confirm the vehicle is ready. This records your name and completion date.' : 'Your name and save time are recorded.'}</p>
          <div className="service-direct-actions"><button className="service-save" type="submit" disabled={busy || newerRecordAvailable}>{busy ? 'Saving…' : 'Save service status'}</button><button type="button" disabled={busy} onClick={() => { acceptDetail(detail); setEditing(false) }}>Cancel</button></div>
        </form>}</> : <p className="service-permission">{detail.store ? `A ${detail.store} manager can update this vehicle’s service status.` : 'A group manager can update service until the vehicle’s store is confirmed.'}</p>}
        {openFordActions.length > 0 && <section className="service-source-alert" aria-label="Saved Ford service actions">
          <strong>OASIS: {openFordActions.length} open service {openFordActions.length === 1 ? 'action' : 'actions'} in saved report</strong>
          <span>{openFordActions.map(action => action.code).join(' · ')}</span>
          <Link to={`/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}&tab=data`}>Review service actions in Records</Link>
        </section>}
        <dl className="service-fact-grid" aria-label="Service decision facts">
          <div><dt>Store</dt><dd>{vehicle.serviceReadiness?.store ?? vehicle.homeStore}</dd></div>
          <div><dt>Inventory age</dt><dd>{vehicle.daysListed != null ? `${vehicle.daysListed} days` : 'Not captured'}</dd></div>
          <div><dt>Hold</dt><dd>{['primary', 'backup', 'multiple'].includes(vehicle.hold?.state) ? vehicle.hold.label || 'Held — confirm availability' : vehicle.hold?.state === 'none_observed' ? 'No observed hold' : 'Review hold status'}</dd></div>
          <div><dt>Location</dt><dd>{vehicle.movement?.currentLocation || vehicle.sourceReportedLocation || 'Not confirmed'}<small>{vehicle.movement?.currentLocation && vehicle.movement.locationConfidence === 'verified' ? 'Confirmed location' : 'Confirm with the store'}</small></dd></div>
        </dl>
        <nav className="service-vehicle-links" aria-label="Vehicle reference"><Link className="service-vehicle-link" to={`/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}`}>Vehicle details</Link><Link className="service-vehicle-link" to={`/inventory?scope=group&vin=${encodeURIComponent(vehicle.vin)}&tab=data`}>Records</Link></nav>
        <section className="service-history" aria-labelledby="service-history-title"><h3 id="service-history-title">Service history</h3>
          {detail.history.length ? <ol>{detail.history.map((entry) => <li key={entry.version}><strong>{serviceStatusLabel(entry)}</strong><span>{entry.updatedBy} · {displayDate(entry.updatedAt)}</span>{entry.serviceEnteredAt && <span>Entered service {displayDate(entry.serviceEnteredAt)}</span>}{entry.completedAt && <span>Completed {displayDate(entry.completedAt)}</span>}{entry.notes && <p>{entry.notes}</p>}</li>)}</ol> : <p>{detail.version ? 'Detailed service history is limited to sales staff and managers.' : serviceWorkflowStatus(detail) === 'serviced' ? 'Ready is recorded, but no service completion date was captured.' : 'Service has not been confirmed. A manager must mark this vehicle Ready after review.'}</p>}
        </section>
      </>}
    </>}
  </aside>
}

export function ServicePage() {
  const { data, homeStore, role, refresh } = useAppData()
  const [params, setParams] = useSearchParams()
  const [scope, setScope] = useState<'my_store' | 'all'>('my_store')
  const [search, setSearch] = useState('')
  const statusParam = params.get('status') as ServiceWorkflowStatus
  const actionParam = params.get('action') as ServiceWorkflowStatus
  const selectedVin = params.get('vin')
  const selected = data?.vehicles.find((vehicle) => vehicle.vin === selectedVin)
  const status = STATUSES.includes(statusParam) ? statusParam : selected ? serviceWorkflowStatus(selected.serviceReadiness) : 'needs_service'
  const scoped = useMemo(() => (data?.vehicles ?? []).filter((vehicle) => scope === 'all' || (vehicle.serviceReadiness?.store ?? vehicle.homeStore) === homeStore), [data, scope, homeStore])
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((value) => [value, scoped.filter((vehicle) => serviceWorkflowStatus(vehicle.serviceReadiness) === value).length])) as Record<ServiceWorkflowStatus, number>, [scoped])
  const vehicles = scoped.filter((vehicle) => serviceWorkflowStatus(vehicle.serviceReadiness) === status &&
    (!search.trim() || `${vehicle.vehicleName} ${vehicle.stockNumber} ${vehicle.vin} ${vehicle.searchText ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())))
  function selectVin(vin: string | null) { setParams((current) => { const next = new URLSearchParams(current); next.delete('action'); if (vin) next.set('vin', vin); else next.delete('vin'); return next }) }
  async function savedStatus(nextStatus: ServiceReadinessStatus) {
    setParams((current) => { const next = new URLSearchParams(current); next.set('status', nextStatus); next.delete('action'); return next }, { replace: true })
    await refresh()
  }
  if (!data) return null
  return <section className={`service-page${selected ? ' service-has-selection' : ''}`}>
    <header className="service-page-heading"><h1><Wrench aria-hidden="true" size={25} />Service status</h1><div className="service-scope" role="group" aria-label="Service inventory scope"><button type="button" aria-pressed={scope === 'my_store'} onClick={() => setScope('my_store')}>My store · {homeStore}</button><button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All stores</button></div></header>
    <div className="service-tabs" role="group" aria-label="Service status">
      {STATUSES.map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setParams({ status: value })}>{SERVICE_LABELS[value]}{' '}<span>{counts[value]}</span></button>)}
    </div>
    {selectedVin && !selected && <p role="status" className="service-permission">This vehicle is not in the current inventory. Select a vehicle below to review service status.</p>}
    <div className="service-content"><div className="service-list-panel">
      <div className="service-list-toolbar"><p>{STATUS_HELP[status]}</p><label className="service-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Search service vehicles</span><input type="search" value={search} placeholder="Search stock, VIN, model" onChange={(event) => setSearch(event.target.value)} /></label></div>
      <p className="service-result-count" role="status">{vehicles.length} {vehicles.length === 1 ? 'vehicle' : 'vehicles'} · {scope === 'all' ? 'All stores' : homeStore}</p>
      {vehicles.length ? <ul className="service-list">{vehicles.map((vehicle) => <li key={vehicle.vin}><button className="service-vehicle-row" type="button" aria-pressed={selectedVin === vehicle.vin} onClick={() => selectVin(vehicle.vin)}>
        <ServicePhoto key={vehicle.vin} vehicle={vehicle} /><span className="service-vehicle-info"><strong>{vehicle.vehicleName}</strong><span>Stock {vehicle.stockNumber} · {vehicle.serviceReadiness?.store ?? vehicle.homeStore}</span><small>{vehicle.vin}</small></span>
        <span className="service-row-numbers"><strong>{vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : 'Mileage not captured'}</strong><span>{vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : vehicle.inventoryDate ? `Listed ${displayDate(vehicle.inventoryDate)}` : ''}</span></span>
        <span className={`service-status-badge service-status-${status}`}>{SERVICE_LABELS[status]}<small>{vehicle.serviceReadiness?.notes || (status === 'in_service' && vehicle.serviceReadiness?.serviceEnteredAt ? `Since ${displayDate(vehicle.serviceReadiness.serviceEnteredAt)}` : 'View & update')}</small></span>
      </button></li>)}</ul> : <div className="service-empty"><CheckCircle2 size={28} /><h2>{search ? 'No matching vehicles' : EMPTY_TITLES[status]}</h2><p>{search ? 'Try a stock number, VIN, or model.' : 'Choose another status or expand to all stores.'}</p>{scope === 'my_store' && <button type="button" onClick={() => setScope('all')}>Search all stores</button>}</div>}
    </div>{selected && <ServiceEditor key={`${selected.vin}:${role}:${homeStore}`} vehicle={selected} role={role} store={homeStore} initialAction={STATUSES.includes(actionParam) ? actionParam : null} defaultDate={selected.vin.startsWith('TESTDATA') ? data.meta.reportDate : localToday()} onSaved={savedStatus} onBack={() => selectVin(null)} />}</div>
  </section>
}
