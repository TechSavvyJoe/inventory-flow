import { ProviderEvidence, importedHoldSummary } from "./ProviderEvidence"
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ApiError, getManualHold, updateManualHold } from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/format'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import type { ManualHoldDetail, StoreName, UserRole } from '../../types'
import type { InventoryVehicle } from './types'
import './ManualHoldDialog.css'

export function ManualHoldDialog({ vehicle, role, store, onClose, onSaved, returnFocusRef }: {
  vehicle: InventoryVehicle; role: UserRole; store: StoreName
  onClose: () => void; onSaved: (detail: ManualHoldDetail) => Promise<void>
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const id = useId()
  const container = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const background = useRef(document.activeElement?.closest<HTMLElement>('[role="dialog"]') ?? document.getElementById('root'))
  const [detail, setDetail] = useState<ManualHoldDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [action, setAction] = useState<'active' | 'released'>('active')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { confirmDiscard, markSaved } = useUnsavedChanges(dirty, { saving: busy })
  // The imported observation stays independent; only the app-owned record is refreshed here.
  const importedHold = vehicle.inventoryDecision ? vehicle.inventoryDecision.importedHold :
    (vehicle.dealerMail.dataState === 'current' ? vehicle.dealerMail.hasActiveHold : null)
  const recordsDisagree = detail !== null && (
    (detail.state === 'active' && importedHold === false) ||
    (detail.state === 'released' && importedHold === true) ||
    (vehicle.appDisposition?.code === 'delivered' && (detail.state === 'active' || importedHold === true)) ||
    vehicle.inventoryDecision?.reviewRequired === true ||
    vehicle.inventoryDecision?.reasons.includes('keep_vs_imported_delivery') === true
  )
  const close = () => { if (!busy && confirmDiscard()) onClose() }
  useContainedFocus({ active: true, contain: true, containerRef: container, initialFocusRef: heading, returnFocusRef, onEscape: close })
  useModalBackgroundIsolation({ active: true, backgroundRef: background })
  useEffect(() => {
    let cancelled = false
    setDetail(null); setLoading(true); setError('')
    void getManualHold(vehicle.vin, role, store).then(value => {
      if (cancelled) return
      setAction('active')
      setDetail(value); setLabel(value.state === 'active' ? value.customerLabel ?? '' : '')
      setDate(value.state === 'active' ? value.expectedDeliveryDate ?? '' : '')
      setNote(value.state === 'active' ? value.note ?? '' : '')
    }).catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'The hold could not be loaded.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vehicle.vin, role, store, retry])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const saved = await updateManualHold(vehicle.vin, {
        state: action, expectedVersion: detail.version,
        ...(action === 'active' ? { customerLabel: label.trim(), expectedDeliveryDate: date } : {}), note: note.trim(),
      }, role, store)
      markSaved(); setDirty(false)
      await onSaved(saved)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The hold could not be saved.')
      if (caught instanceof ApiError && caught.code === 'MANUAL_HOLD_VERSION_CONFLICT') {
        try {
          const latest = await getManualHold(vehicle.vin, role, store)
          setDetail(latest)
          // Reconcile the editable fields with the version before another deliberate save.
          setAction('active')
          setLabel(latest.state === 'active' ? latest.customerLabel ?? '' : '')
          setDate(latest.state === 'active' ? latest.expectedDeliveryDate ?? '' : '')
          setNote(latest.state === 'active' ? latest.note ?? '' : '')
          markSaved(); setDirty(false)
          setError(action === 'released' && latest.state !== 'active'
            ? 'This manual hold was already released. The latest record is shown; you can place a new hold if needed.'
            : 'This manual hold changed on another device. The latest values are shown. Review them before saving again.')
        } catch { /* Keep the draft for a deliberate retry. */ }
      }
    } finally { setBusy(false) }
  }

  return createPortal(<div className="manual-hold-overlay">
    <section className="manual-hold-dialog" ref={container} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header><div><h2 ref={heading} tabIndex={-1} id={id}>Manual hold</h2><p>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')} · #{vehicle.stockNumber}</p></div>
        <button type="button" onClick={close} aria-label="Close manual hold" disabled={busy}><X size={20} aria-hidden="true" /></button></header>
      <div className="manual-hold-body">
        <dl className="manual-hold-comparison"><div><dt>Inventory Flow</dt><dd>{detail?.state === 'active' ? 'Manual hold active' : detail?.state === 'released' ? 'Manual hold released' : 'No manual hold recorded'}</dd></div>
          <div><dt>Imported hold evidence</dt><dd>{importedHoldSummary(vehicle)}</dd></div></dl>
        <ProviderEvidence vehicle={vehicle} />
        {recordsDisagree ? <p role="status" className="manual-hold-warning">The records disagree. Review the imported evidence before promising availability.</p> : null}
        {loading ? <p role="status">Loading the latest record…</p> : null}
        {error ? <p role="alert" className="manual-hold-error">{error}</p> : null}
        {!loading && !detail ? <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button> : null}
        {!loading && detail?.canManage ? <form onSubmit={event => void submit(event)}>
          {detail.state === 'active' ? <fieldset><legend>Action</legend><div className="manual-hold-actions">
            <label><input type="radio" checked={action === 'active'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('active'); setDirty(true); setNote(detail.note ?? '') }} />Update hold</label>
            <label><input type="radio" checked={action === 'released'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('released'); setDirty(true); setNote('') }} />Release hold</label>
          </div></fieldset> : null}
          {action === 'active' ? <div className="manual-hold-fields">
            <label>Customer initials or nickname<input value={label} maxLength={100} disabled={busy} onChange={event => { setLabel(event.target.value); setDirty(true) }} /></label>
            <label>Expected delivery (optional)<input type="date" value={date} disabled={busy} onChange={event => { setDate(event.target.value); setDirty(true) }} /></label>
          </div> : null}
          <label>{action === 'released' ? 'Release reason' : 'Notes and details'}<textarea value={note} maxLength={1000} rows={3} required={action === 'released'} disabled={busy} onChange={event => { setNote(event.target.value); setDirty(true) }} /></label>
          <p className="manual-hold-help">Use a nickname and operational details. Keep contact, financial and identity information in your CRM.</p>
          <div className="manual-hold-actions"><button type="submit" className="manual-hold-primary" disabled={busy || (action === 'released' ? !note.trim() : !label.trim() && !note.trim())}>{busy ? 'Saving…' : action === 'released' ? 'Release manual hold' : detail.state === 'active' ? 'Save hold changes' : 'Place manual hold'}</button>
            <button type="button" onClick={close} disabled={busy}>Cancel</button></div>
        </form> : !loading && detail ? <p>{detail.enabled ? 'This hold is managed by its salesperson, the home-store manager or a group manager.' : 'Manual hold storage is not enabled yet.'}</p> : null}
        {!loading && detail && !detail.canManage && (detail.customerLabel || detail.note) ? <p><strong>{detail.customerLabel}</strong>{detail.note ? ` · ${detail.note}` : ''}</p> : null}
        {detail?.history.length ? <details className="manual-hold-history"><summary>Hold history · {detail.history.length}</summary><ol>{detail.history.map(row => <li key={row.version}>
          <strong>{row.state === 'active' ? 'Hold recorded' : 'Hold released'}{row.customerLabel ? ` · ${row.customerLabel}` : ''}</strong>
          <span>{row.updatedBy} · {row.updatedAt ? formatDateTime(row.updatedAt) : ''}{row.expectedDeliveryDate ? ` · Expected ${formatDate(row.expectedDeliveryDate)}` : ''}</span>
          {row.note ? <p>{row.note}</p> : null}
        </li>)}</ol></details> : null}
        <p className="manual-hold-help">A manual hold is recorded in Inventory Flow. Imported CRM holds, dispositions and physical location stay separate.</p>
      </div>
    </section>
  </div>, document.body)
}
