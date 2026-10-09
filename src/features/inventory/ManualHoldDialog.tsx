import { ProviderEvidence, importedHoldSummary } from "./ProviderEvidence"
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ApiError, getManualHold, updateManualHold } from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/format'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import type { ManualHoldDetail, ManualHoldInput, StoreName, UserRole } from '../../types'
import type { InventoryVehicle } from './types'
import { holdStateLabel, initialHoldAction } from './hold-presentation'
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
  const [action, setAction] = useState<ManualHoldInput['state']>(role === 'sales' ? 'requested' : 'active')
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
  const hasHoldFields = action === 'active' || action === 'requested'
  const endingAction = !hasHoldFields
  const actionLabel = action === 'released' ? 'Release hold' : action === 'rejected' ? 'Decline request'
    : action === 'cancelled' ? 'Cancel request' : action === 'requested' ? detail?.state === 'requested' ? 'Save request changes' : 'Submit hold request'
      : detail?.state === 'requested' ? 'Approve hold' : detail?.state === 'active' ? 'Save hold changes' : 'Place hold'
  function loadFields(value: ManualHoldDetail) {
    const openRecord = value.state === 'active' || value.state === 'requested'
    setAction(initialHoldAction(value, role))
    setLabel(openRecord ? value.customerLabel ?? '' : '')
    setDate(openRecord ? value.expectedDeliveryDate ?? '' : '')
    setNote(openRecord ? value.note ?? '' : '')
  }
  useContainedFocus({ active: true, contain: true, containerRef: container, initialFocusRef: heading, returnFocusRef, onEscape: close })
  useModalBackgroundIsolation({ active: true, backgroundRef: background })
  useEffect(() => {
    let cancelled = false
    setDetail(null); setLoading(true); setError('')
    void getManualHold(vehicle.vin, role, store).then(value => {
      if (cancelled) return
      setDetail(value); loadFields(value)
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
        ...(hasHoldFields ? { customerLabel: label.trim(), expectedDeliveryDate: date } : {}), note: note.trim(),
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
          loadFields(latest)
          markSaved(); setDirty(false)
          setError(action === 'released' && latest.state !== 'active'
            ? 'This hold was already released. The latest record is shown; you can request a new hold if needed.'
            : 'This hold changed on another device. The latest values are shown. Review them before saving again.')
        } catch { /* Keep the draft for a deliberate retry. */ }
      }
    } finally { setBusy(false) }
  }

  return createPortal(<div className="manual-hold-overlay">
    <section className="manual-hold-dialog" ref={container} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header><div><h2 ref={heading} tabIndex={-1} id={id}>Hold</h2><p>{[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')} · #{vehicle.stockNumber}</p></div>
        <button type="button" onClick={close} aria-label="Close hold" disabled={busy}><X size={20} aria-hidden="true" /></button></header>
      <div className="manual-hold-body">
        <dl className="manual-hold-comparison"><div><dt>Inventory Flow</dt><dd>{holdStateLabel(detail?.state ?? null)}</dd></div>
          <div><dt>Reported evidence</dt><dd>{importedHoldSummary(vehicle)}</dd></div></dl>
        <ProviderEvidence vehicle={vehicle} />
        {recordsDisagree ? <p role="status" className="manual-hold-warning">The records disagree. Review the imported evidence before promising availability.</p> : null}
        {loading ? <p role="status">Loading the latest record…</p> : null}
        {error ? <p role="alert" className="manual-hold-error">{error}</p> : null}
        {detail?.state === 'requested' ? <p role="status">This request is awaiting manager approval. It is not a confirmed Inventory Flow hold.</p> : null}
        {!loading && !detail ? <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button> : null}
        {!loading && detail?.canManage ? <form onSubmit={event => void submit(event)}>
          {detail.state === 'active' ? <fieldset><legend>Action</legend><div className="manual-hold-actions">
            <label><input type="radio" checked={action === 'active'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('active'); setDirty(true); setNote(detail.note ?? '') }} />Update hold</label>
            <label><input type="radio" checked={action === 'released'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('released'); setDirty(true); setNote('') }} />Release hold</label>
          </div></fieldset> : null}
          {detail.state === 'requested' ? <fieldset><legend>{detail.canApprove === true ? 'Manager decision' : 'Request action'}</legend><div className="manual-hold-actions">
            {detail.canApprove === true ? <>
              <label><input type="radio" checked={action === 'active'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('active'); setDirty(true); setNote(detail.note ?? '') }} />Approve hold</label>
              <label><input type="radio" checked={action === 'rejected'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('rejected'); setDirty(true); setNote('') }} />Decline request</label>
            </> : <>
              <label><input type="radio" checked={action === 'requested'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('requested'); setDirty(true); setNote(detail.note ?? '') }} />Update request</label>
              <label><input type="radio" checked={action === 'cancelled'} name={`${id}-action`} disabled={busy} onChange={() => { setAction('cancelled'); setDirty(true); setNote('') }} />Cancel request</label>
            </>}
          </div></fieldset> : null}
          {hasHoldFields ? <div className="manual-hold-fields">
            <label>Customer initials or nickname<input value={label} maxLength={100} disabled={busy} onChange={event => { setLabel(event.target.value); setDirty(true) }} /></label>
            <label>Expected delivery (optional)<input type="date" value={date} disabled={busy} onChange={event => { setDate(event.target.value); setDirty(true) }} /></label>
          </div> : null}
          <label>{action === 'released' ? 'Release reason' : action === 'rejected' ? 'Decline reason' : action === 'cancelled' ? 'Cancellation reason' : 'Notes and details'}<textarea value={note} maxLength={1000} rows={3} required={endingAction} disabled={busy} onChange={event => { setNote(event.target.value); setDirty(true) }} /></label>
          {action === 'requested' ? <p className="manual-hold-help">Submit to the home-store manager for approval. The vehicle is not held by this request until approved.</p> : null}
          <p className="manual-hold-help">Use a nickname and operational details. Keep contact, financial and identity information in your CRM.</p>
          <div className="manual-hold-actions"><button type="submit" className="manual-hold-primary" disabled={busy || (endingAction ? !note.trim() : !label.trim() && !note.trim())}>{busy ? 'Saving…' : actionLabel}</button>
            <button type="button" onClick={close} disabled={busy}>Cancel</button></div>
        </form> : !loading && detail ? <p>{!detail.enabled || detail.approvalEnabled === false ? 'Hold controls are not enabled yet. Ask Software Admin to finish the hold approval setup.' : 'This hold is managed by its salesperson, the home-store manager or a group manager.'}</p> : null}
        {!loading && detail && !detail.canManage && (detail.customerLabel || detail.note) ? <p><strong>{detail.customerLabel}</strong>{detail.note ? ` · ${detail.note}` : ''}</p> : null}
        {detail?.history.length ? <details className="manual-hold-history"><summary>Hold history · {detail.history.length}</summary><ol>{detail.history.map(row => <li key={row.version}>
          <strong>{holdStateLabel(row.state)}{row.customerLabel ? ` · ${row.customerLabel}` : ''}</strong>
          <span>{row.updatedBy} · {row.updatedAt ? formatDateTime(row.updatedAt) : ''}{row.expectedDeliveryDate ? ` · Expected ${formatDate(row.expectedDeliveryDate)}` : ''}</span>
          {row.note ? <p>{row.note}</p> : null}
        </li>)}</ol></details> : null}
        <p className="manual-hold-help">Hold decisions are recorded in Inventory Flow. Source reports provide supporting evidence; disposition and physical location are recorded separately.</p>
      </div>
    </section>
  </div>, document.body)
}
