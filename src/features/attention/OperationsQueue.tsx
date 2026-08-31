import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Flag,
  History,
  Search,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatDateTime } from '../../lib/format'
import type {
  AttentionEventInput,
  AttentionItem,
  AttentionPriority,
  AttentionStatus,
  StoreName,
  UserRole,
} from '../../types'
import './operations-queue.css'

type QueueScope = 'home' | 'group'
type QuickFilter = 'active' | 'urgent' | 'overdue' | 'unassigned' | 'waiting' | 'resolved'

interface OperationsQueueProps {
  items: AttentionItem[]
  homeStore: StoreName
  role: UserRole
  reportDate: string
  onAction: (attentionId: string, input: AttentionEventInput) => Promise<AttentionItem>
}

const STATUS_LABELS: Record<AttentionStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
}

const PRIORITY_LABELS: Record<AttentionPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

function itemBelongsToStore(item: AttentionItem, store: StoreName) {
  return item.store === store || item.relatedStores?.includes(store) === true
}

function dateIsPast(value: string | undefined, reportDate: string) {
  if (!value) return false
  const due = Date.parse(value.length === 10 ? `${value}T23:59:59` : value)
  const report = Date.parse(`${reportDate}T23:59:59`)
  return Number.isFinite(due) && Number.isFinite(report) && due < report
}

function dueLabel(item: AttentionItem) {
  if (item.followUpAt) return `Follow up ${formatDateTime(item.followUpAt)}`
  if (item.dueAt) return `Due ${item.dueAt.length === 10 ? formatDate(item.dueAt) : formatDateTime(item.dueAt)}`
  return 'No due time set'
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function toLocalDateTimeValue(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function OperationsQueue({ items, homeStore, role, reportDate, onAction }: OperationsQueueProps) {
  const [scope, setScope] = useState<QueueScope>('home')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('active')
  const [priority, setPriority] = useState<'all' | AttentionPriority>('all')
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assignee, setAssignee] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [note, setNote] = useState('')
  const [resolutionCode, setResolutionCode] = useState<AttentionEventInput['resolutionCode']>('action_completed')

  const scopedItems = useMemo(
    () => items.filter((item) => scope === 'group' || itemBelongsToStore(item, homeStore)),
    [homeStore, items, scope],
  )

  const metrics = useMemo(() => {
    const active = scopedItems.filter((item) => item.status !== 'resolved')
    return {
      active: active.length,
      urgent: active.filter((item) => item.priority === 'urgent').length,
      overdue: active.filter((item) => dateIsPast(item.followUpAt || item.dueAt, reportDate)).length,
      unassigned: active.filter((item) => !item.assignedTo).length,
      waiting: active.filter((item) => item.status === 'waiting').length,
      resolved: scopedItems.filter((item) => item.status === 'resolved').length,
    }
  }, [reportDate, scopedItems])

  const typeOptions = useMemo(
    () => [...new Set(scopedItems.map((item) => item.type))].sort(),
    [scopedItems],
  )

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return scopedItems.filter((item) => {
      if (quickFilter === 'active' && item.status === 'resolved') return false
      if (quickFilter === 'resolved' && item.status !== 'resolved') return false
      if (quickFilter === 'urgent' && (item.status === 'resolved' || item.priority !== 'urgent')) return false
      if (quickFilter === 'overdue' && (item.status === 'resolved' || !dateIsPast(item.followUpAt || item.dueAt, reportDate))) return false
      if (quickFilter === 'unassigned' && (item.status === 'resolved' || item.assignedTo)) return false
      if (quickFilter === 'waiting' && item.status !== 'waiting') return false
      if (priority !== 'all' && item.priority !== priority) return false
      if (type !== 'all' && item.type !== type) return false
      if (!normalizedQuery) return true
      return [item.label, item.vehicleName, item.stockNumber, item.vin, item.store, item.assignedTo, item.sourceLabel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [priority, query, quickFilter, reportDate, scopedItems, type])

  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null

  useEffect(() => {
    if (selectedId && !visibleItems.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [selectedId, visibleItems])

  useEffect(() => {
    setAssignee(selected?.assignedTo ?? '')
    setFollowUpAt(toLocalDateTimeValue(selected?.followUpAt))
    setNote('')
    setError(null)
  }, [selected?.id, selected?.assignedTo, selected?.followUpAt])

  async function runAction(type: string, extra: Partial<AttentionEventInput> = {}) {
    if (!selected) return
    setPendingAction(type)
    setError(null)
    try {
      await onAction(selected.id, {
        type,
        actor: 'Joe Gallant',
        actorRole: role,
        store: homeStore,
        ...extra,
      })
      setNote('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The work-queue update could not be saved.')
    } finally {
      setPendingAction(null)
    }
  }

  const metricCards: Array<{ key: QuickFilter; label: string; value: number; icon: typeof CircleDot }> = [
    { key: 'active', label: 'Active', value: metrics.active, icon: CircleDot },
    { key: 'urgent', label: 'Urgent', value: metrics.urgent, icon: Flag },
    { key: 'overdue', label: 'Overdue', value: metrics.overdue, icon: Clock3 },
    { key: 'unassigned', label: 'Unassigned', value: metrics.unassigned, icon: Users },
    { key: 'waiting', label: 'Waiting', value: metrics.waiting, icon: CalendarClock },
    { key: 'resolved', label: 'Resolved', value: metrics.resolved, icon: CheckCircle2 },
  ]

  return (
    <section className="ops-queue" aria-label="Operational attention queue">
      <div className="ops-queue-heading">
        <div>
          <span className="eyebrow">Action center</span>
          <h2>{scope === 'home' ? `${homeStore} operations queue` : 'Group operations queue'}</h2>
          <p>Assign and close app-owned work while source inventory, holds, and DealerMail evidence remain unchanged.</p>
        </div>
        <div className="ops-scope-switch" role="group" aria-label="Queue location scope">
          <button type="button" className={scope === 'home' ? 'is-active' : undefined} onClick={() => setScope('home')}>{homeStore}</button>
          <button type="button" className={scope === 'group' ? 'is-active' : undefined} onClick={() => setScope('group')}>All stores</button>
        </div>
      </div>

      <div className="ops-metrics" aria-label="Queue counts">
        {metricCards.map(({ key, label, value, icon: Icon }) => (
          <button type="button" key={key} className={quickFilter === key ? 'is-active' : undefined} onClick={() => setQuickFilter(key)} aria-pressed={quickFilter === key} aria-label={`${label}: ${value}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>

      <div className="ops-toolbar">
        <label className="ops-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search work queue</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vehicle, stock, VIN, owner or issue" />
          {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear queue search"><X aria-hidden="true" /></button> : null}
        </label>
        <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="all">All priorities</option>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Issue type</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{typeOptions.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <span className="ops-result-count">{visibleItems.length} shown</span>
      </div>

      <div className={`ops-workspace ${selectedId ? 'has-mobile-selection' : ''}`}>
        <div className="ops-list" role="list" aria-label="Attention items">
          <div className="ops-list-head" aria-hidden="true"><span>Priority / work</span><span>Owner</span><span>Timing</span><span /></div>
          {visibleItems.length ? visibleItems.map((item) => {
            const overdue = item.status !== 'resolved' && dateIsPast(item.followUpAt || item.dueAt, reportDate)
            return (
              <div role="listitem" className="ops-row-item" key={item.id}>
                <button
                  type="button"
                  className={`ops-row ${selected?.id === item.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                  aria-label={`Open ${item.label}`}
                >
                  <span className="ops-row-main">
                    <span className={`ops-priority ops-priority--${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span>
                    <strong>{item.vehicleName || item.label}</strong>
                    {item.vehicleName ? <small>{item.label}</small> : null}
                    <small>{[item.stockNumber, item.vin, item.store].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="ops-row-owner"><small>Owner</small><strong>{item.assignedTo || 'Unassigned'}</strong><em>{STATUS_LABELS[item.status]}</em></span>
                  <span className={`ops-row-due ${overdue ? 'is-overdue' : ''}`}><small>{item.followUpAt ? 'Follow-up' : 'Due'}</small><strong>{item.followUpAt || item.dueAt ? dueLabel(item).replace(/^(Follow up|Due) /, '') : 'Not set'}</strong>{overdue ? <em>Overdue</em> : null}</span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            )
          }) : (
            <div className="ops-empty"><CheckCircle2 aria-hidden="true" /><strong>No work matches this view</strong><p>Clear filters or choose another queue segment.</p><button type="button" onClick={() => { setQuickFilter('active'); setPriority('all'); setType('all'); setQuery('') }}>Clear filters</button></div>
          )}
        </div>

        {selected ? (
          <aside className={`ops-detail ${selectedId ? 'is-mobile-open' : ''}`} aria-label={`${selected.label} details`}>
            <button type="button" className="ops-detail-mobile-close" onClick={() => setSelectedId(null)} aria-label="Close attention item"><X aria-hidden="true" /></button>
            <div className="ops-detail-topline">
              <span className={`ops-priority ops-priority--${selected.priority}`}>{PRIORITY_LABELS[selected.priority]}</span>
              <span className={`ops-status ops-status--${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
              {selected.store ? <span>{selected.store}</span> : null}
            </div>
            <h3>{selected.vehicleName || selected.label}</h3>
            {selected.vehicleName ? <p className="ops-detail-issue">{selected.label}</p> : null}
            <p className="ops-detail-id">{[selected.stockNumber && `Stock ${selected.stockNumber}`, selected.vin].filter(Boolean).join(' · ')}</p>

            <div className="ops-detail-facts">
              <div><small>Assigned to</small><strong>{selected.assignedTo || 'Unassigned'}</strong></div>
              <div><small>{selected.followUpAt ? 'Follow-up' : 'Due'}</small><strong>{dueLabel(selected)}</strong></div>
              <div><small>Evidence source</small><strong>{selected.sourceLabel || titleCase(selected.type)}</strong></div>
            </div>

            <div className="ops-source-boundary"><AlertTriangle aria-hidden="true" /><div><strong>Work state is separate from source truth</strong><p>Resolving this item closes the Inventory Flow task only. It does not release a hold, change availability, edit DealerMail, or confirm a sale or delivery.</p></div></div>

            <div className="ops-explanation">
              <div><small>Why it matters</small><p>{selected.whyItMatters || 'This item needs an accountable owner and a recorded next step.'}</p></div>
              <div><small>Recommended next step</small><p>{selected.recommendedAction || 'Review the linked record and document the operational outcome.'}</p></div>
            </div>

            <div className="ops-primary-actions" aria-label="Quick actions">
              {selected.allowedActions.includes('acknowledge') ? <button type="button" className="is-primary" disabled={Boolean(pendingAction)} onClick={() => void runAction('acknowledge')}><Check aria-hidden="true" />Acknowledge</button> : null}
              {selected.allowedActions.includes('start_work') ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => void runAction('start_work')}><CircleDot aria-hidden="true" />Start work</button> : null}
              {selected.allowedActions.includes('escalate') ? <button type="button" className="is-danger" disabled={Boolean(pendingAction)} onClick={() => void runAction('escalate', { note: note || undefined })}><Flag aria-hidden="true" />Escalate</button> : null}
              {selected.allowedActions.includes('reopen') ? <button type="button" className="is-primary" disabled={Boolean(pendingAction)} onClick={() => void runAction('reopen', { note: note || undefined })}><CircleDot aria-hidden="true" />Reopen</button> : null}
              {selected.href ? <Link to={selected.href}>Open linked record <ArrowUpRight aria-hidden="true" /></Link> : null}
            </div>

            {error ? <div className="ops-action-error" role="alert">{error}</div> : null}

            <details className="ops-action-panel" open>
              <summary>Assignment, follow-up and notes</summary>
              <div className="ops-action-grid">
                {selected.allowedActions.includes('assign') ? <label><span>Owner</span><div><input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name or role" /><button type="button" disabled={!assignee.trim() || Boolean(pendingAction)} onClick={() => void runAction('assign', { assignee: assignee.trim() })}>Assign</button></div></label> : null}
                {selected.allowedActions.includes('set_follow_up') ? <label><span>Follow-up</span><div><input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /><button type="button" disabled={!followUpAt || Boolean(pendingAction)} onClick={() => void runAction('set_follow_up', { followUpAt: new Date(followUpAt).toISOString() })}>Set</button></div></label> : null}
                <label className="ops-note-field"><span>Internal work note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the next step or confirmed outcome; do not copy credentials." rows={2} /></label>
                <div className="ops-secondary-actions">
                  {selected.allowedActions.includes('add_note') ? <button type="button" disabled={!note.trim() || Boolean(pendingAction)} onClick={() => void runAction('add_note', { note: note.trim() })}>Add note</button> : null}
                  {selected.allowedActions.includes('wait') ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => void runAction('wait', { note: note || undefined })}>Mark waiting</button> : null}
                </div>
                {selected.allowedActions.includes('resolve') ? <div className="ops-resolve"><label><span>Resolution</span><select value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value as AttentionEventInput['resolutionCode'])}><option value="action_completed">Action completed</option><option value="source_condition_cleared">Source condition cleared</option><option value="no_action_required">No action required</option><option value="duplicate">Duplicate</option><option value="other">Other</option></select></label><button type="button" disabled={Boolean(pendingAction) || (resolutionCode === 'other' && !note.trim())} onClick={() => void runAction('resolve', { resolutionCode, note: note || undefined })}><CheckCircle2 aria-hidden="true" />Resolve operational work</button></div> : null}
              </div>
            </details>

            <section className="ops-history" aria-label="Work history">
              <div><History aria-hidden="true" /><h4>Activity</h4><span>{selected.events.length}</span></div>
              {selected.events.length ? <ol>{[...selected.events].reverse().slice(0, 8).map((event) => <li key={event.id}><span /><div><strong>{event.label}</strong><p>{[event.actor, event.store].filter(Boolean).join(' · ')}</p>{event.note ? <blockquote>{event.note}</blockquote> : null}</div><time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time></li>)}</ol> : <p className="ops-history-empty"><UserRound aria-hidden="true" />No app-owned updates yet. Source evidence remains available in the linked record.</p>}
            </section>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
