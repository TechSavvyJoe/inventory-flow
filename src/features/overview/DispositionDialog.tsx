import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardCheck, X } from 'lucide-react'
import { ApiError, getDisposition, updateDisposition } from '../../lib/api'
import { formatDate, formatDateTime } from '../../lib/format'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { STORE_NAMES, type AppDisposition, type AppDispositionCode, type AppDispositionDetail, type StoreName, type UserRole } from '../../types'
import {
  allowedDispositions,
  dateRequired,
  DISPOSITION_LABELS,
  DISPOSITION_QUALIFIER,
  dispositionSummary,
  isCorrection,
  managerLogLine,
  type ManagerLogEvidence,
} from './disposition-model'
import './DispositionDialog.css'

const NOTE_LIMIT = 500
const CONFLICT_MESSAGE = 'Another manager updated this vehicle. Review and save again.'
const ROLE_LABELS: Record<'manager' | 'group_manager', string> = { manager: 'store manager', group_manager: 'group manager' }

export interface DispositionDialogVehicle {
  vin: string
  name: string
  stockNumber: string
}

function HistoryEntry({ entry }: { entry: AppDisposition }) {
  return (
    <li>
      <strong>{dispositionSummary(entry)}</strong>
      <span>
        {entry.effectiveDate ? `Effective ${formatDate(entry.effectiveDate)} · ` : ''}
        {entry.updatedBy ? `${entry.updatedBy} · ` : ''}{entry.updatedAt ? formatDateTime(entry.updatedAt) : ''}
      </span>
      {entry.note ? <p>{entry.note}</p> : null}
    </li>
  )
}

/**
 * Record or review a vehicle's disposition in Inventory Flow (OVERVIEW_SPEC
 * §6.10). The app's own record sits beside the imported manager log; nothing
 * here writes to DealerMail, CDK, the listing or the manager log.
 */
export function DispositionDialog({ vehicle, disposition, evidence, role, store, defaultDate, onClose, onSaved, returnFocusRef }: {
  vehicle: DispositionDialogVehicle
  /** The list view's disposition; the dialog loads the detail (note, history) itself. */
  disposition: AppDisposition | null | undefined
  evidence?: ManagerLogEvidence | null
  role: UserRole
  store: StoreName
  defaultDate: string
  onClose: () => void
  onSaved: (detail: AppDispositionDetail) => void | Promise<void>
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const titleId = useId()
  const noteHelpId = useId()
  const noteErrorId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // The dialog may open over the vehicle workspace, itself a modal: isolate
  // whatever modal (or the app) held focus when it opened.
  const background = useRef<HTMLElement | null>(
    document.activeElement?.closest<HTMLElement>('[role="dialog"]') ?? document.getElementById('root'),
  )
  const [detail, setDetail] = useState<AppDispositionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [choice, setChoice] = useState<AppDispositionCode | null>(null)
  const [date, setDate] = useState(defaultDate)
  const [destination, setDestination] = useState<StoreName | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [noteError, setNoteError] = useState('')
  const dirty = choice !== null || note.trim() !== ''
  const { confirmDiscard, markSaved } = useUnsavedChanges(dirty, { saving: busy })
  const close = () => { if (!busy && confirmDiscard()) onClose() }

  useContainedFocus({ active: true, contain: true, containerRef: dialogRef, initialFocusRef: headingRef, returnFocusRef, onEscape: close })
  useModalBackgroundIsolation({ active: true, backgroundRef: background })

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setLoadError('')
    void getDisposition(vehicle.vin, role, store)
      .then((value) => { if (!canceled) setDetail(value) })
      .catch((caught: unknown) => { if (!canceled) setLoadError(caught instanceof Error ? caught.message : 'The disposition could not be loaded.') })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [vehicle.vin, role, store, retry])

  const current = detail ?? disposition ?? null
  const canManage = Boolean(detail?.canManage)
  const options = allowedDispositions(current?.code).filter(code => code !== 'other' || detail?.otherEnabled !== false)
  const correcting = (choice === 'keep' && isCorrection(current?.code)) || choice === 'other'
  const needsDate = dateRequired(choice)
  const destinations = STORE_NAMES.filter((candidate) => candidate !== current?.ownerStore)
  const logLine = managerLogLine(evidence)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!detail || !choice || busy) return
    setBusy(true)
    setError('')
    setNoteError('')
    try {
      const saved = await updateDisposition(vehicle.vin, {
        disposition: choice,
        expectedVersion: detail.version,
        ...(date ? { effectiveDate: date } : {}),
        ...(choice === 'transfer_out' && destination ? { destinationStore: destination } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }, role, store)
      markSaved()
      await onSaved(saved)
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined
      const message = caught instanceof Error ? caught.message : 'The disposition could not be saved. Try again.'
      if (code === 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE' || code === 'INVALID_DISPOSITION_NOTE') {
        setNoteError(message)
      } else if (code === 'DISPOSITION_VERSION_CONFLICT') {
        // Keep the draft and learn the latest record; a deliberate second save
        // still uses optimistic concurrency against that version.
        setError(CONFLICT_MESSAGE)
        try {
          const latest = await getDisposition(vehicle.vin, role, store)
          setDetail(latest)
          setChoice((previous) => previous && allowedDispositions(latest.code).includes(previous) ? previous : null)
        } catch { /* the draft stays available */ }
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="disposition-overlay">
      <section className="disposition-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="disposition-dialog__header">
          <div>
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>Disposition · {vehicle.name}</h2>
            <p>#{vehicle.stockNumber}{current?.ownerStore ? ` · ${current.ownerStore} manager decides` : ''}</p>
          </div>
          <button type="button" className="disposition-icon-button" onClick={close} aria-label="Close disposition" disabled={busy}><X aria-hidden="true" /></button>
        </header>
        <div className="disposition-dialog__body">
          <dl className="disposition-facts">
            <div>
              <dt>Disposition · {DISPOSITION_QUALIFIER}</dt>
              <dd>
                <strong>{dispositionSummary(current)}</strong>
                {current?.effectiveDate ? <span>Effective {formatDate(current.effectiveDate)}</span> : null}
                {detail?.updatedBy && detail.updatedByRole ? <span>{detail.updatedBy} · {ROLE_LABELS[detail.updatedByRole]}</span> : null}
              </dd>
            </div>
            {logLine ? (
              <div>
                <dt>Manager log · imported</dt>
                <dd><span className="disposition-evidence"><ClipboardCheck aria-hidden="true" />{logLine}</span></dd>
              </div>
            ) : null}
          </dl>
          {detail?.note ? <p className="disposition-current-note"><span>Note</span>{detail.note}</p> : null}

          {loading ? <p role="status" className="disposition-muted">Loading the latest disposition…</p> : null}
          {loadError ? (
            <div className="disposition-alert" role="alert">
              <p>{loadError}</p>
              <button type="button" className="disposition-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
            </div>
          ) : null}

          {!loading && detail && canManage ? (
            <form className="disposition-form" onSubmit={(event) => void submit(event)} noValidate>
              {error ? <p className="disposition-alert" role="alert">{error}</p> : null}
              <fieldset>
                <legend>{current?.code ? 'Change to' : 'Record as'}</legend>
                <div className="disposition-choices">
                  {options.map((code) => (
                    <label key={code} className="disposition-choice">
                      <input type="radio" name={`${titleId}-choice`} value={code} checked={choice === code} disabled={busy} onChange={() => setChoice(code)} />
                      <span>{DISPOSITION_LABELS[code]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {choice ? (
                <div className="disposition-fields">
                  <label className="disposition-field">
                    <span>Effective date{needsDate ? '' : ' (optional)'}</span>
                    <input type="date" value={date} required={needsDate} max={defaultDate} disabled={busy} onChange={(event) => setDate(event.target.value)} />
                  </label>
                  {choice === 'transfer_out' ? (
                    <label className="disposition-field">
                      <span>Destination store</span>
                      <select value={destination} required disabled={busy} onChange={(event) => setDestination(event.target.value as StoreName | '')}>
                        <option value="">Choose a store</option>
                        {destinations.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <label className="disposition-field">
                <span>Note{choice === 'other' ? ' (required)' : correcting ? ' (required for a correction)' : ' (optional)'}</span>
                <textarea
                  value={note}
                  maxLength={NOTE_LIMIT}
                  rows={3}
                  disabled={busy}
                  aria-invalid={noteError ? true : undefined}
                  aria-describedby={noteError ? `${noteHelpId} ${noteErrorId}` : noteHelpId}
                  onChange={(event) => { setNote(event.target.value); setNoteError('') }}
                />
              </label>
              <p id={noteHelpId} className="disposition-muted">Use operational details, without customer contact information. Notes are visible to sales and managers. {note.length}/{NOTE_LIMIT}</p>
              {noteError ? <p id={noteErrorId} className="disposition-field-error" role="alert">{noteError}</p> : null}
              <div className="disposition-actions">
                <button type="submit" className="disposition-button disposition-button--primary"
                  disabled={busy || !choice || (needsDate && !date) || (choice === 'transfer_out' && !destination) || (correcting && note.trim().length < 3)}>
                  {busy ? 'Saving…' : 'Save disposition'}
                </button>
                <button type="button" className="disposition-button" onClick={close} disabled={busy}>Cancel</button>
              </div>
            </form>
          ) : null}
          {!loading && detail && !canManage ? (
            <p className="disposition-muted">
              {current?.ownerStore ? `A ${current.ownerStore} manager or a group manager records this vehicle’s disposition.` : 'A group manager records this vehicle’s disposition.'}
            </p>
          ) : null}

          {detail?.history.length ? (
            <section className="disposition-history" aria-labelledby={`${titleId}-history`}>
              <h3 id={`${titleId}-history`}>History</h3>
              <ol>{detail.history.map((entry) => <HistoryEntry key={entry.version} entry={entry} />)}</ol>
            </section>
          ) : null}
          <p className="disposition-muted">Recorded in Inventory Flow only. DealerMail, CDK, the website listing and the manager log are not changed here.</p>
        </div>
      </section>
    </div>,
    document.body,
  )
}
