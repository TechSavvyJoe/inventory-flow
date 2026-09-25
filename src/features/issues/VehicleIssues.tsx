import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronRight, Plus } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import { confirmUnsavedWork } from '../../lib/useUnsavedChanges'
import type { VehicleIssue, VehicleIssueDetail } from '../../types'
import { IssueDetail } from './IssueDetail'
import { ISSUE_CATEGORIES, ISSUE_STATUSES, type VehicleIssueContext } from './issue-model'
import './issues.css'

export function VehicleIssuesSummary({ issues, canReport, enabled, onOpen, onReport }: {
  issues: VehicleIssue[]; canReport: boolean; enabled: boolean; onOpen: () => void; onReport: (button: HTMLButtonElement) => void
}) {
  const open = issues.filter(issue => issue.status !== 'completed')
  return <section className="vehicle-issues-summary" aria-label="Vehicle issues"><button type="button" onClick={onOpen}><AlertCircle aria-hidden="true"/><span>{enabled ? open.length ? `${open.length} open vehicle ${open.length === 1 ? 'issue' : 'issues'}` : 'Vehicle issues' : 'Vehicle issues unavailable'}</span><ChevronRight aria-hidden="true" /></button>{canReport ? <button type="button" onClick={event => onReport(event.currentTarget)}><Plus aria-hidden="true" />Report issue</button> : null}</section>
}

export function VehicleIssues({ issues, context, canReport, onReport, onSaved, initialIssueId }: {
  issues: VehicleIssue[]; context: VehicleIssueContext; canReport: boolean; onReport: (button: HTMLButtonElement) => void
  onSaved: (issue: VehicleIssueDetail) => void; initialIssueId?: string
}) {
  const [selected, setSelected] = useState<string | null>(initialIssueId ?? null)
  const issueButtons = useRef(new Map<string, HTMLButtonElement>())
  const returnIssueFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!selected && returnIssueFocus.current) {
      issueButtons.current.get(returnIssueFocus.current)?.focus({ preventScroll: true })
      returnIssueFocus.current = null
    }
  }, [selected])
  useEffect(() => { if (initialIssueId) setSelected(initialIssueId) }, [initialIssueId])
  const [completed, setCompleted] = useState(false)
  const visible = issues.filter(issue => completed ? issue.status === 'completed' : issue.status !== 'completed').sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || b.updatedAt.localeCompare(a.updatedAt, 'en-US'))
  if (!context.enabled && !issues.length) return <p role="status" className="vehicle-issue-unavailable">Vehicle issue reporting is not available in this deployment yet. Ask your manager to arrange any needed work.</p>
  return <section className="vehicle-issues" aria-label="Vehicle issue log">
    <header className="vehicle-issues-heading">{selected ? <button type="button" onClick={() => { if (confirmUnsavedWork()) { returnIssueFocus.current = selected; setCompleted(issues.find(issue => issue.id === selected)?.status === 'completed'); setSelected(null) } }}>Back to issue list</button> : <div><h3>Vehicle issues</h3><p>Staff report and update work. A manager confirms completion.</p></div>}{canReport ? <button type="button" className="vehicle-issue-primary" onClick={event => onReport(event.currentTarget)}><Plus aria-hidden="true" />Report issue</button> : null}</header>
    {selected ? <IssueDetail key={`${context.currentUser}:${context.role}:${context.homeStore}:${selected}`} issueId={selected} role={context.role} store={context.homeStore} onSaved={onSaved} readOnly={!context.enabled} showVehicle={false} /> : <>
      <div className="vehicle-issue-action-options" role="group" aria-label="Issue status"><button type="button" aria-pressed={!completed} onClick={() => setCompleted(false)}>Open ({issues.filter(issue => issue.status !== 'completed').length})</button><button type="button" aria-pressed={completed} onClick={() => setCompleted(true)}>Completed ({issues.filter(issue => issue.status === 'completed').length})</button></div>
      {visible.length ? <ul className="vehicle-issue-list">{visible.map(issue => <li key={issue.id}><button type="button" ref={button => { if (button) issueButtons.current.set(issue.id, button); else issueButtons.current.delete(issue.id) }} onClick={() => { returnIssueFocus.current = issue.id; setSelected(issue.id) }}><span><strong>{ISSUE_CATEGORIES[issue.category]}{issue.priority === 'urgent' ? <span className="vehicle-issue-urgent"> · Urgent</span> : null}</strong><span>{issue.description}</span><small>{issue.assignee || 'Unassigned'} · Updated {formatDateTime(issue.updatedAt)}{issue.photoCount ? ` · ${issue.photoCount} photos` : ''}</small></span><span className="vehicle-issue-state" data-status={issue.status}>{ISSUE_STATUSES[issue.status]}</span><ChevronRight aria-hidden="true" /></button></li>)}</ul> : <p className="vehicle-issue-empty">{completed ? 'No completed issues recorded.' : 'No open issues recorded. Report anything that needs attention.'}</p>}
    </>}
  </section>
}
