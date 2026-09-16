import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, X } from 'lucide-react'
import { useAppData } from '../../app/AppDataContext'
import { useContainedFocus } from '../../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../../lib/useModalBackgroundIsolation'
import type { TransferRecord } from '../../types'
import { transferActionLabels } from './presentation'
import type { TransferActionKind, TransferDetail } from './types'
import './transfers-page.css'

interface TransferActionDialogProps {
  action: TransferActionKind
  record: TransferRecord
  detail: TransferDetail
  onClose: () => void
  onComplete?: (updated: TransferRecord) => void
}

interface EventChoice {
  value: string
  label: string
  help: string
}

function outcomeChoices(status: string, manager: boolean): EventChoice[] {
  if (status === 'sale_confirmed') {
    return [{ value: 'delivery_confirmed', label: 'Delivery confirmed', help: 'Use only after an authorized manager has explicit delivery confirmation.' }]
  }
  const values: EventChoice[] = [
    { value: 'customer_showing', label: 'Showing in progress', help: 'The customer outcome is still open.' },
    { value: 'sale_outcome_pending', label: 'Decision / paperwork pending', help: 'A manager still needs to confirm the final outcome.' },
    { value: 'not_sold', label: 'Shown — not sold', help: 'Starts the return-to-home workflow.' },
  ]
  if (manager) values.push({ value: 'sale_confirmed', label: 'Sold pending — manager confirmed', help: 'This still does not confirm delivery or final paperwork.' })
  return values
}

function eventForAction(action: TransferActionKind, status: string, outcome: string, simple: boolean): string {
  if (simple) {
    if (action === 'approve') return 'request_approved'
    if (action === 'decline') return 'request_declined'
    if (action === 'confirm-pickup') return 'vehicle_departed'
    if (action === 'schedule-return') return 'return_started'
  }
  switch (action) {
    case 'review-request': return 'manager_reviewed'
    case 'approve': return 'approved'
    case 'decline': return 'declined'
    case 'request-driver': return 'driver_requested'
    case 'assign-transport': return status === 'return_requested' ? 'return_assigned' : 'transport_assigned'
    case 'confirm-pickup': return status === 'return_assigned' ? 'return_in_transit' : 'picked_up'
    case 'confirm-arrival': return 'arrived'
    case 'record-outcome': return outcome
    case 'schedule-return': return 'return_requested'
    case 'confirm-return': return 'returned_home'
    case 'mark-exception': return 'location_exception'
    case 'report-condition': return 'condition_issue'
    case 'escalate': return 'escalated'
    case 'close': return 'closed'
    default: return ''
  }
}

function normalizedStatus(value: string): string {
  return value.toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function topLevelAppBackground(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : document.getElementById('root')
  if (!active) return null

  let background = active
  while (background.parentElement && background.parentElement !== document.body) {
    background = background.parentElement
  }
  return background.parentElement === document.body ? background : document.getElementById('root')
}

export function TransferActionDialog({ action, record, detail, onClose, onComplete }: TransferActionDialogProps) {
  const { addTransferEvent, homeStore, role, currentUser } = useAppData()
  const simple = record.workflowMode === 'simple'
  const isManager = role === 'manager' || role === 'group_manager'
  const outcomes = useMemo(() => outcomeChoices(record.requestStatus, isManager), [isManager, record.requestStatus])
  const [outcome, setOutcome] = useState(outcomes[0]?.value ?? '')
  const [assignee, setAssignee] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [homeStoreManager, setHomeStoreManager] = useState('')
  const [availabilityConfirmed, setAvailabilityConfirmed] = useState(false)
  const [note, setNote] = useState('')
  const [conditionSeverity, setConditionSeverity] = useState<'minor' | 'needs-review' | 'do-not-drive'>('needs-review')
  const [safeToDrive, setSafeToDrive] = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventType = eventForAction(action, record.requestStatus, outcome, simple)
  const needsAvailabilityConfirmation = eventType === 'request_approved'
  const needsAssignee = eventType === 'transport_assigned' || eventType === 'return_assigned'
  const needsDue = needsAssignee || eventType === 'return_requested' || eventType === 'return_started'
  const needsHomeReleaseConfirmation = eventType === 'approved'
  const needsDecisionReason = eventType === 'declined' || eventType === 'request_declined'
  const recordsHomeStoreDecision = !simple && (needsHomeReleaseConfirmation || (needsDecisionReason && normalizedStatus(record.requestStatus) === 'manager-reviewed'))
  const isConditionIssue = eventType === 'condition_issue'
  const actionTitle = needsAvailabilityConfirmation ? 'Approve this move'
    : eventType === 'vehicle_departed' ? 'Mark vehicle collected'
    : simple && eventType === 'arrived' ? `Mark arrived at ${record.destination}`
    : simple && eventType === 'returned_home' ? 'Confirm back home'
    : eventType === 'return_started' ? 'Start return to home store'
    : eventType === 'manager_reviewed'
    ? 'Approve at requesting store'
    : eventType === 'approved'
      ? 'Record home-store release'
      : recordsHomeStoreDecision
        ? 'Record home-store decline'
        : transferActionLabels[action]
  const submitLabel = needsAvailabilityConfirmation ? 'Approve this move'
    : eventType === 'vehicle_departed' ? 'Mark collected'
    : simple && eventType === 'arrived' ? 'Mark arrived'
    : simple && eventType === 'returned_home' ? 'Confirm back home'
    : eventType === 'return_started' ? 'Start return'
    : isConditionIssue
    ? 'Record issue'
    : eventType === 'manager_reviewed'
      ? 'Approve request'
      : eventType === 'approved'
        ? 'Record release grant'
        : recordsHomeStoreDecision
          ? 'Record home-store decline'
          : eventType === 'declined' || eventType === 'request_declined'
            ? 'Decline request'
        : eventType === 'returned_home'
          ? 'Confirm home receipt'
          : eventType === 'return_requested'
            ? 'Schedule return'
            : 'Record update'
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  )
  const backgroundRef = useRef<HTMLElement | null>(topLevelAppBackground())

  useModalBackgroundIsolation({
    active: true,
    backgroundRef,
  })

  useContainedFocus({
    active: true,
    contain: true,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef,
    onEscape: onClose,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!eventType) return
    if (needsAvailabilityConfirmation && !availabilityConfirmed) {
      setError('Confirm you checked with the vehicle’s home store and it is available for this move.')
      return
    }
    if (needsAssignee && !assignee.trim()) {
      setError('Enter the assigned driver. If the porter or a salesperson is driving, record that manager-assigned person by name.')
      return
    }
    if (needsAssignee && !dueAt) {
      setError('Set the pickup or return target time so salespeople can see when the driver is coming.')
      return
    }
    if (recordsHomeStoreDecision && !homeStoreManager.trim()) {
      setError(`Enter the ${record.homeStore} manager who gave the release decision.`)
      return
    }
    if (needsDecisionReason && !note.trim()) {
      setError('Briefly record why the vehicle is not being released.')
      return
    }
    if (isConditionIssue && !note.trim()) {
      setError('Describe the condition or damage so the Home Store manager can review it before receipt.')
      return
    }
    const recordedNote = isConditionIssue
      ? `Severity: ${conditionSeverity}; Safe to drive: ${safeToDrive}; Home-store manager acknowledgment: pending; Issue: ${note.trim()}`
      : note.trim() || undefined
    setSubmitting(true)
    setError(null)
    try {
      const updated = await addTransferEvent(record.id, {
        type: eventType,
        actor: currentUser || 'Signed-in user',
        actorRole: role,
        store: homeStore,
        homeStoreManager: recordsHomeStoreDecision ? homeStoreManager.trim() : undefined,
        availabilityConfirmed: needsAvailabilityConfirmation ? availabilityConfirmed : undefined,
        note: recordedNote,
        fromLocation: record.currentLocation,
        toLocation:
          eventType === 'arrived' ? record.destination : eventType === 'returned_home' ? record.homeStore : undefined,
        dueAt: dueAt || undefined,
        assignee: assignee.trim() || undefined,
      })
      onComplete?.(updated)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The movement update could not be recorded.')
    } finally {
      setSubmitting(false)
    }
  }

  const dialog = (
    <div className="transfer-action-layer">
      <div className="transfer-action-scrim" onClick={onClose} aria-hidden="true" />
      <form
        ref={dialogRef}
        className={`transfer-action-dialog${simple ? ' move-action-simple' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onSubmit={submit}
      >
        <header>
          <div>
            <span>{detail.vehicle.stock} · {detail.vehicle.homeStore} → {record.destination}</span>
            <h2 id={titleId}>{actionTitle}</h2>
            <p id={descriptionId}>{detail.vehicle.vehicleLabel}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close movement action"><X aria-hidden="true" /></button>
        </header>

        {action === 'record-outcome' ? (
          <fieldset className="action-outcome-options">
            <legend>Record only what is explicitly known</legend>
            {outcomes.map((choice) => (
              <label key={choice.value}>
                <input type="radio" name="outcome" checked={outcome === choice.value} onChange={() => setOutcome(choice.value)} />
                <span><strong>{choice.label}</strong><small>{choice.help}</small></span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {needsAvailabilityConfirmation ? (
          <label className="action-availability-confirmation">
            <input type="checkbox" checked={availabilityConfirmed} onChange={(event) => { setAvailabilityConfirmed(event.target.checked); setError(null) }} />
            <span>
              <strong>I checked with {record.homeStore}; this vehicle is available for this move.</strong>
              <small>You are recording the availability check for {record.requestingStore}. The sales team can update the outcome or start the return when appropriate.</small>
            </span>
          </label>
        ) : eventType === 'vehicle_departed' ? (
          <div className="action-approval-sequence" role="note">
            <strong>Record the actual collection</strong>
            <span>Confirm the vehicle has left {record.homeStore} for {record.destination}. This starts the time-away clock.</span>
          </div>
        ) : simple && eventType === 'arrived' ? (
          <div className="action-approval-sequence" role="note"><strong>Confirm arrival at {record.destination}</strong><span>Record this after the vehicle and keys have arrived. The next step is to update the showing or start its return.</span></div>
        ) : simple && eventType === 'returned_home' ? (
          <div className="action-approval-sequence" role="note"><strong>Confirm {record.homeStore} received the vehicle</strong><span>Check the vehicle and keys are back at the home store. This completes the move and stops the time-away clock.</span></div>
        ) : eventType === 'return_started' ? (
          <div className="action-approval-sequence" role="note">
            <strong>Returning to {record.homeStore}</strong>
            <span>Use this when the vehicle has actually started back. It stays away until its home store confirms receipt.</span>
          </div>
        ) : eventType === 'manager_reviewed' ? (
          <div className="action-approval-sequence" role="note">
            <strong>Stage 2 · Requesting-store approval</strong>
            <span>
              Approve this request for {record.requestingStore}. This does not confirm availability or release.
              Next, the {record.requestingStore} manager must contact the {record.homeStore} used-car manager.
            </span>
          </div>
        ) : recordsHomeStoreDecision ? (
          <div className="action-approval-sequence" role="note">
            <strong>Stage 3 · Home-store contact & release decision</strong>
            <span>
              Record this only after the {record.requestingStore} manager contacted the {record.homeStore} used-car manager.
              A driver can be assigned only after a release grant is recorded.
            </span>
          </div>
        ) : null}

        {needsAssignee ? (
          <label className="action-field">
            <span>Assigned driver</span>
            <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Driver name — other staff only if a manager assigns them" />
            <small>For Howell requests, Stacey normally coordinates the driver. The porter may be assigned and uses the Porter role when driving.</small>
          </label>
        ) : null}

        {needsDue ? (
          <label className="action-field">
            <span>{eventType === 'return_requested' || eventType === 'return_started' ? 'Return due' : 'Target time'}{eventType === 'return_started' ? ' (optional)' : ''}</span>
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </label>
        ) : null}

        {isConditionIssue ? (
          <div className="action-condition-fields" aria-label="Vehicle condition issue details">
            <label className="action-field">
              <span>Issue severity <small>required</small></span>
              <select value={conditionSeverity} onChange={(event) => setConditionSeverity(event.target.value as typeof conditionSeverity)}>
                <option value="minor">Minor — document at handoff</option>
                <option value="needs-review">Needs manager review</option>
                <option value="do-not-drive">Do not drive until reviewed</option>
              </select>
            </label>
            <fieldset className="action-drive-status">
              <legend>Safe to drive?</legend>
              {(['yes', 'no', 'unknown'] as const).map((value) => (
                <label key={value}>
                  <input type="radio" name="safe-to-drive" value={value} checked={safeToDrive === value} onChange={() => setSafeToDrive(value)} />
                  <span>{value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'Needs review'}</span>
                </label>
              ))}
            </fieldset>
            <div className="action-home-manager-notice">
              <strong>{record.homeStore} manager acknowledgment</strong>
              <span>Pending — the issue stays visible with the return until the Home Store confirms receipt.</span>
            </div>
          </div>
        ) : null}

        {recordsHomeStoreDecision ? (
          <label className="action-field">
            <span>Home-store manager contacted <small>required</small></span>
            <input
              value={homeStoreManager}
              onChange={(event) => setHomeStoreManager(event.target.value)}
              placeholder={`Name or role at ${record.homeStore}`}
              autoComplete="off"
            />
            <small>This records who gave the verbal grant or decline; the signed-in manager remains the recorder.</small>
          </label>
        ) : null}

        <label className="action-field">
          <span>{isConditionIssue ? 'Condition / damage description' : needsHomeReleaseConfirmation ? 'Release conditions or pickup note' : recordsHomeStoreDecision ? 'Why the Home Store declined' : needsDecisionReason ? 'Decision reason' : eventType === 'driver_requested' ? 'Stacey / driver-request note' : 'Operational note'} <small>{isConditionIssue || needsDecisionReason ? 'required' : 'optional'}</small></span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder={isConditionIssue ? 'What was found, where on the vehicle, and when it was noticed?' : needsHomeReleaseConfirmation ? 'Keys, pickup window, or other release conditions' : recordsHomeStoreDecision ? `What the ${record.homeStore} manager declined or could not confirm` : eventType === 'driver_requested' ? 'After calling Stacey, add any pickup timing she needs' : 'What the next person needs to know'}
          />
        </label>

        <div className="action-separation-note">
          <CheckCircle2 aria-hidden="true" />
        <p>{simple ? 'This updates the internal vehicle move. It does not confirm a sale, customer delivery, or funding.' : 'This records one internal move event. It does not by itself confirm availability, sale, delivery, or funding.'}</p>
        </div>
        {error ? <div className="action-error" role="alert"><AlertTriangle aria-hidden="true" />{error}</div> : null}
        <footer>
          <button className="mif-button mif-button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="mif-button mif-button--primary" type="submit" disabled={submitting || !eventType}>
            {submitting ? 'Recording…' : submitLabel} <ArrowRight aria-hidden="true" />
          </button>
        </footer>
      </form>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
