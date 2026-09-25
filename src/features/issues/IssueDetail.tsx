import { useEffect, useRef, useState } from 'react'
import { ApiError, appendVehicleIssueEvent, getVehicleIssue } from '../../lib/api'
import { apiAccessGeneration } from '../../lib/apiSession'
import { formatDateTime } from '../../lib/format'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import type { StoreName, UserRole, VehicleIssueAction, VehicleIssueDetail, VehicleIssueEventInput } from '../../types'
import { IssuePhotoPicker, IssuePhotos, type DraftIssuePhoto } from './IssuePhotos'
import { ISSUE_ACTIONS, ISSUE_CATEGORIES, ISSUE_STATUSES, issueNextStep } from './issue-model'
import './issues.css'

interface IssueDetailProps {
  issueId: string; role: UserRole; store: StoreName; onSaved: (issue: VehicleIssueDetail) => void
  readOnly?: boolean
  showVehicle?: boolean
}

export function IssueDetail(props: IssueDetailProps) {
  return <IssueDetailContent key={`${props.role}:${props.store}:${props.issueId}`} {...props} />
}

function IssueDetailContent({ issueId, role, store, onSaved, readOnly = false, showVehicle = true }: IssueDetailProps) {
  const [detail, setDetail] = useState<VehicleIssueDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [action, setAction] = useState<VehicleIssueAction>('add_note')
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState('')
  const [photos, setPhotos] = useState<DraftIssuePhoto[]>([])
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const submitted = useRef(false)
  const { markSaved } = useUnsavedChanges(Boolean(note.trim() || assignee.trim() || photos.length), { saving: saving || preparing })
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setLoadError('')
    void getVehicleIssue(issueId, role, store, controller.signal).then(record => {
      if (controller.signal.aborted) return
      setDetail(record); setConflict(false); setError(''); setLoading(false)
    }).catch(caught => {
      if (controller.signal.aborted) return
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) setDetail(null)
      setLoadError(caught instanceof Error ? caught.message : 'The issue could not load.'); setLoading(false)
    })
    return () => controller.abort()
  }, [issueId, role, store, retry])
  const allowed = readOnly ? [] : (Object.keys(ISSUE_ACTIONS) as VehicleIssueAction[]).filter(value => detail?.allowedActions.includes(value))
  const selectedAction = allowed.includes(action) ? action : allowed.includes('add_note') ? 'add_note' : allowed[0] ?? 'add_note'
  const canSubmit = selectedAction && !conflict && !loading && !preparing && !saving &&
    (selectedAction !== 'assign' || Boolean(assignee.trim())) &&
    (selectedAction !== 'complete' || Boolean(note.trim())) &&
    (selectedAction !== 'add_note' || Boolean(note.trim() || photos.length))
  async function submit() {
    if (!detail || !canSubmit || submitted.current) return
    submitted.current = true; setSaving(true); setError(''); setNotice('')
    const accessGeneration = apiAccessGeneration()
    const input: VehicleIssueEventInput = { type: selectedAction, expectedVersion: detail.version,
      ...(note.trim() ? { note: note.trim() } : {}), ...(selectedAction === 'assign' ? { assignee: assignee.trim() } : {}),
      ...(photos.length ? { photos: photos.map(({ data }) => ({ data })) } : {}),
    }
    try {
      const updated = await appendVehicleIssueEvent(issueId, input, role, store)
      if (!alive.current || accessGeneration !== apiAccessGeneration()) return
      markSaved(); setDetail(updated); setNote(''); setAssignee(''); setPhotos([])
      setNotice(selectedAction === 'complete' ? 'Completion confirmed.' : selectedAction === 'request_completion' ? 'Sent for manager review.' : 'Issue updated.')
      setAction('add_note'); onSaved(updated)
    } catch (caught) {
      if (!alive.current) return
      setConflict(caught instanceof ApiError && caught.status === 409)
      setError(caught instanceof ApiError && caught.status === 409 ? 'This issue changed while you were working. Reload the latest record, review it, then submit your retained draft.' : caught instanceof Error ? caught.message : 'Your update could not be saved. Your draft is still here.')
    } finally { submitted.current = false; if (alive.current) setSaving(false) }
  }
  function selectAction(next: VehicleIssueAction) {
    setAction(next); setError(''); setNotice('')
  }
  return <section className="vehicle-issue-detail" aria-label="Vehicle issue details" aria-busy={loading || saving}>
    {loading ? <p role="status">Loading issue…</p> : null}
    {loadError ? <div className="vehicle-issue-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => setRetry(value => value + 1)} disabled={loading}>Retry issue</button></div> : null}
    {detail ? <div className="vehicle-issue-detail__layout" data-editable={allowed.length > 0}>
      <div className="vehicle-issue-detail__summary">
      <header className="vehicle-issue-detail__heading"><div><h3>{ISSUE_CATEGORIES[detail.category]} issue</h3>{showVehicle ? <p>{detail.vehicleName} · Stock {detail.stockNumber}</p> : null}</div><span className="vehicle-issue-state" data-status={detail.status}>{ISSUE_STATUSES[detail.status]}</span></header>
      {detail.priority === 'urgent' ? <p className="vehicle-issue-urgent">Urgent</p> : null}
      <p className="vehicle-issue-description">{detail.description}</p>
      <dl className="vehicle-issue-facts"><div><dt>Assigned to</dt><dd>{detail.assignee || 'Unassigned'}</dd></div><div><dt>Reporting store</dt><dd>{detail.reportStore}</dd></div><div><dt>Reported by</dt><dd>{detail.reportedBy}</dd></div><div><dt>Reported</dt><dd>{formatDateTime(detail.reportedAt)}</dd></div></dl>
      <p className="vehicle-issue-next-step">{issueNextStep(detail)}</p>
      {notice ? <p role="status">{notice}</p> : null}
      </div>
      {allowed.length ? <form className="vehicle-issue-form" onSubmit={event => { event.preventDefault(); void submit() }}>
        <label>Action<select value={selectedAction} disabled={saving || preparing} onChange={event => selectAction(event.target.value as VehicleIssueAction)}>{allowed.map(value => <option key={value} value={value}>{ISSUE_ACTIONS[value]}</option>)}</select></label>
        {selectedAction === 'assign' ? <label>Assign to<input value={assignee} required maxLength={160} disabled={saving} onChange={event => setAssignee(event.target.value)} placeholder="Employee or team name" /></label> : null}
        <label>{selectedAction === 'complete' ? 'Completion note' : 'Work update'}<textarea rows={2} maxLength={1000} required={selectedAction === 'complete'} disabled={saving} value={note} onChange={event => setNote(event.target.value)} placeholder={selectedAction === 'complete' ? 'What did you check to confirm the issue is resolved?' : 'Record what was checked or what happens next.'} /></label>
        <IssuePhotoPicker photos={photos} onChange={setPhotos} disabled={saving} remaining={Math.max(0, 12 - detail.photoCount)} onPreparing={setPreparing} />
        {error ? <p className="vehicle-issue-error" role="alert">{error}</p> : null}
        <div className="vehicle-issue-form__actions">{conflict ? <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Reload latest issue</button> : null}<button type="submit" className="vehicle-issue-primary" disabled={!canSubmit}>{saving ? 'Saving…' : ISSUE_ACTIONS[selectedAction]}</button></div>
      </form> : <p className="vehicle-issue-muted">{readOnly ? 'Issue history is available. Reporting and updates are not enabled in this deployment.' : 'You can read this issue. Updates are handled by the reporting store.'}</p>}
      <div className="vehicle-issue-detail__evidence"><IssuePhotos issueId={detail.id} photos={detail.photos} role={role} store={store} />
      <section className="vehicle-issue-history" aria-label="Issue history"><h3>History</h3><ol>{[...detail.events].reverse().map(event => <li key={event.id}><strong>{event.type === 'reported' || event.type === 'created' ? 'Issue reported' : ISSUE_ACTIONS[event.type as VehicleIssueAction] ?? event.type}</strong><span>{event.actor} · {formatDateTime(event.createdAt)}</span>{event.assignee ? <span>Assigned to {event.assignee}</span> : null}{event.note ? <p>{event.note}</p> : null}{event.photos.length ? <small>{event.photos.length} {event.photos.length === 1 ? 'photo' : 'photos'} attached</small> : null}</li>)}</ol></section>
      </div>
    </div> : null}
  </section>
}
