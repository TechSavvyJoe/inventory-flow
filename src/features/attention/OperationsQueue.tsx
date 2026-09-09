import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Flag,
  History,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
type QuickFilter = 'active' | 'urgent' | 'overdue' | 'resolved'

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

const PRIORITY_RANK: Record<AttentionPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const ISSUE_LABELS: Record<string, string> = {
  source_freshness: 'Data needs verification',
  return_overdue: 'Vehicle return',
  location_exception: 'Location mismatch',
  missing_price: 'Price needed',
  past_expected_hold: 'Hold follow-up',
  hold_alert: 'Vehicle alert',
  vehicle_alert: 'Vehicle alert',
  transfer_next_action: 'Vehicle move',
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
  return 'No follow-up set'
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function issueLabel(value: string) {
  return ISSUE_LABELS[value] || titleCase(value)
}

function recordLinkLabel(href: string | undefined) {
  if (href?.startsWith('/transfers')) return 'Open vehicle move'
  if (href?.startsWith('/inventory')) return 'Open vehicle'
  return 'Open related record'
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
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assignee, setAssignee] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [note, setNote] = useState('')
  const [resolutionCode, setResolutionCode] = useState<AttentionEventInput['resolutionCode']>('action_completed')
  const detailRef = useRef<HTMLElement | null>(null)
  const selectionTriggerRef = useRef<HTMLButtonElement | null>(null)

  function closeMobileDetail() {
    setSelectedId(null)
    window.requestAnimationFrame(() => selectionTriggerRef.current?.focus({ preventScroll: true }))
  }

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
      resolved: scopedItems.filter((item) => item.status === 'resolved').length,
    }
  }, [reportDate, scopedItems])

  const typeOptions = useMemo(
    () => [...new Set(scopedItems.map((item) => item.type))].sort(),
    [scopedItems],
  )

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return scopedItems
      .filter((item) => {
        if (quickFilter === 'active' && item.status === 'resolved') return false
        if (quickFilter === 'resolved' && item.status !== 'resolved') return false
        if (quickFilter === 'urgent' && (item.status === 'resolved' || item.priority !== 'urgent')) return false
        if (quickFilter === 'overdue' && (item.status === 'resolved' || !dateIsPast(item.followUpAt || item.dueAt, reportDate))) return false
        if (type !== 'all' && item.type !== type) return false
        if (!normalizedQuery) return true
        return [item.label, item.vehicleName, item.stockNumber, item.vin, item.store, item.assignedTo, issueLabel(item.type)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      })
      .sort((left, right) => {
        const leftOverdue = dateIsPast(left.followUpAt || left.dueAt, reportDate) ? 0 : 1
        const rightOverdue = dateIsPast(right.followUpAt || right.dueAt, reportDate) ? 0 : 1
        const leftDue = Date.parse(left.followUpAt || left.dueAt || '9999-12-31')
        const rightDue = Date.parse(right.followUpAt || right.dueAt || '9999-12-31')
        return (
          PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
          leftOverdue - rightOverdue ||
          leftDue - rightDue ||
          (left.vehicleName || left.label).localeCompare(right.vehicleName || right.label)
        )
      })
  }, [query, quickFilter, reportDate, scopedItems, type])

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

  useEffect(() => {
    if (!selectedId || typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 820px)').matches) return
    const handleMobileKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMobileDetail()
    }
    const frame = window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView?.({ block: 'start' })
      detailRef.current?.querySelector<HTMLButtonElement>('.ops-detail-mobile-close')?.focus({ preventScroll: true })
    })
    window.addEventListener('keydown', handleMobileKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleMobileKeyDown)
    }
  }, [selectedId])

  async function runAction(actionType: string, extra: Partial<AttentionEventInput> = {}) {
    if (!selected) return
    setPendingAction(actionType)
    setError(null)
    try {
      await onAction(selected.id, {
        type: actionType,
        actor: 'Joe Gallant',
        actorRole: role,
        store: homeStore,
        ...extra,
      })
      setNote('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task update could not be saved.')
    } finally {
      setPendingAction(null)
    }
  }

  const queueTabs: Array<{ key: QuickFilter; label: string; value: number; icon: typeof CircleDot }> = [
    { key: 'active', label: 'Active', value: metrics.active, icon: CircleDot },
    { key: 'urgent', label: 'Urgent', value: metrics.urgent, icon: Flag },
    { key: 'overdue', label: 'Overdue', value: metrics.overdue, icon: Clock3 },
    { key: 'resolved', label: 'Resolved', value: metrics.resolved, icon: CheckCircle2 },
  ]

  const vehicleHref = selected?.vin ? `/inventory?scope=group&q=${encodeURIComponent(selected.vin)}` : null

  return (
    <section className="ops-queue" aria-label="Needs attention work queue">
      <div className="ops-queue-heading">
        <div>
          <h2>Work queue</h2>
          <p>Open the item, take the next authorized step, and leave a clear owner and follow-up.</p>
        </div>
        <div className="ops-scope-switch" role="group" aria-label="Queue location scope">
          <button type="button" aria-pressed={scope === 'home'} className={scope === 'home' ? 'is-active' : undefined} onClick={() => setScope('home')}><span>{homeStore}</span></button>
          <button type="button" aria-pressed={scope === 'group'} className={scope === 'group' ? 'is-active' : undefined} onClick={() => setScope('group')}><span>All stores</span></button>
        </div>
      </div>

      <div className="ops-control-deck">
        <div className="ops-queue-tabs" role="group" aria-label="Queue status">
          {queueTabs.map(({ key, label, value, icon: Icon }) => (
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
          <label><span>Issue</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All issues</option>{typeOptions.map((value) => <option key={value} value={value}>{issueLabel(value)}</option>)}</select></label>
          <span className="ops-result-count">{visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className={`ops-workspace ${selectedId ? 'has-mobile-selection' : ''}`}>
        <div className="ops-list" role="list" aria-label="Attention items">
          <div className="ops-list-head" aria-hidden="true"><span>Issue and vehicle</span><span>Owner / status</span><span>Due</span><span /></div>
          {visibleItems.length ? visibleItems.map((item) => {
            const overdue = item.status !== 'resolved' && dateIsPast(item.followUpAt || item.dueAt, reportDate)
            return (
              <div role="listitem" className="ops-row-item" key={item.id}>
                <button
                  type="button"
                  className={`ops-row ops-row--${item.priority} ${selected?.id === item.id ? 'is-selected' : ''}`}
                  onClick={(event) => {
                    selectionTriggerRef.current = event.currentTarget
                    setSelectedId(item.id)
                  }}
                  aria-label={`Open ${item.label}`}
                  aria-expanded={selectedId === item.id}
                  aria-controls="ops-selected-detail"
                >
                  <span className="ops-row-main">
                    <span className={`ops-priority ops-priority--${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span>
                    <span className="ops-row-category">{issueLabel(item.type)}</span>
                    <strong>{item.vehicleName || item.label}</strong>
                    {item.vehicleName ? <small>{item.label}</small> : null}
                    <small>{[item.stockNumber && `Stock ${item.stockNumber}`, item.vin, item.store].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="ops-row-owner"><small>Owner</small><strong>{item.assignedTo || 'Unassigned'}</strong><em>{STATUS_LABELS[item.status]}</em></span>
                  <span className={`ops-row-due ${overdue ? 'is-overdue' : ''}`}><small>{item.followUpAt ? 'Follow-up' : 'Due'}</small><strong>{item.followUpAt || item.dueAt ? dueLabel(item).replace(/^(Follow up|Due) /, '') : 'Not set'}</strong>{overdue ? <em>Overdue</em> : null}</span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            )
          }) : (
            <div className="ops-empty"><CheckCircle2 aria-hidden="true" /><strong>No work matches this view</strong><p>Clear the filters or choose another queue status.</p><button type="button" onClick={() => { setQuickFilter('active'); setType('all'); setQuery('') }}>Clear filters</button></div>
          )}
        </div>

        {selected ? (
          <aside id="ops-selected-detail" ref={detailRef} className={`ops-detail ${selectedId ? 'is-mobile-open' : ''}`} aria-label={`${selected.label} details`}>
            <button type="button" className="ops-detail-mobile-close" onClick={closeMobileDetail} aria-label="Close attention item"><X aria-hidden="true" /></button>

            <header className="ops-detail-header">
              <div className="ops-detail-topline">
                <span className={`ops-priority ops-priority--${selected.priority}`}>{PRIORITY_LABELS[selected.priority]}</span>
                <span className={`ops-status ops-status--${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
                <span>{issueLabel(selected.type)}</span>
              </div>
              <h3>{selected.vehicleName || selected.label}</h3>
              {selected.vehicleName ? <p className="ops-detail-issue">{selected.label}</p> : null}
              <p className="ops-detail-id">{[selected.store, selected.stockNumber && `Stock ${selected.stockNumber}`, selected.vin].filter(Boolean).join(' · ')}</p>
            </header>

            <section className="ops-action-brief" aria-label="Recommended next step">
              <div className="ops-action-brief-copy"><small>Next action</small><strong>{selected.recommendedAction || 'Review the linked record and document the confirmed outcome.'}</strong></div>
              <div className="ops-action-facts">
                <span><small>Owner</small><strong>{selected.assignedTo || 'Unassigned'}</strong></span>
                <span className={dateIsPast(selected.followUpAt || selected.dueAt, reportDate) ? 'is-overdue' : undefined}><small>Timing</small><strong>{dueLabel(selected)}</strong></span>
              </div>
              <div className="ops-primary-actions" aria-label="Available task actions">
                {selected.allowedActions.includes('start_work') ? <button type="button" className="is-primary" disabled={Boolean(pendingAction)} onClick={() => void runAction('start_work')}><CircleDot aria-hidden="true" />Start work</button> : null}
                {selected.allowedActions.includes('acknowledge') ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => void runAction('acknowledge')}><Check aria-hidden="true" />Acknowledge</button> : null}
                {selected.allowedActions.includes('reopen') ? <button type="button" className="is-primary" disabled={Boolean(pendingAction)} onClick={() => void runAction('reopen', { note: note || undefined })}><CircleDot aria-hidden="true" />Reopen</button> : null}
                {selected.allowedActions.includes('escalate') ? <button type="button" className="is-danger" disabled={Boolean(pendingAction)} onClick={() => void runAction('escalate', { note: note || undefined })}><Flag aria-hidden="true" />Escalate</button> : null}
                {selected.href ? <Link to={selected.href}>{recordLinkLabel(selected.href)} <ArrowUpRight aria-hidden="true" /></Link> : null}
                {vehicleHref && vehicleHref !== selected.href ? <Link to={vehicleHref}>View vehicle <ArrowUpRight aria-hidden="true" /></Link> : null}
              </div>
            </section>

            <section className="ops-why" aria-label="Why this needs attention">
              <small>Why this needs attention</small>
              <p>{selected.whyItMatters || 'This item needs an accountable owner and a recorded next step.'}</p>
            </section>

            <div className="ops-task-boundary"><AlertTriangle aria-hidden="true" /><p>Completing this task updates Inventory Flow only. Confirm the real-world status before making a customer commitment.</p></div>

            {error ? <div className="ops-action-error" role="alert">{error}</div> : null}

            <details className="ops-action-panel">
              <summary>Update owner, follow-up or resolution</summary>
              <div className="ops-action-grid">
                {selected.allowedActions.includes('assign') ? <label><span>Owner</span><div><input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name or role" /><button type="button" disabled={!assignee.trim() || Boolean(pendingAction)} onClick={() => void runAction('assign', { assignee: assignee.trim() })}>Assign</button></div></label> : null}
                {selected.allowedActions.includes('set_follow_up') ? <label><span>Follow-up</span><div><input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /><button type="button" disabled={!followUpAt || Boolean(pendingAction)} onClick={() => void runAction('set_follow_up', { followUpAt: new Date(followUpAt).toISOString() })}>Set</button></div></label> : null}
                <label className="ops-note-field"><span>Internal work note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the next step or confirmed outcome." rows={3} /></label>
                <div className="ops-secondary-actions">
                  {selected.allowedActions.includes('add_note') ? <button type="button" disabled={!note.trim() || Boolean(pendingAction)} onClick={() => void runAction('add_note', { note: note.trim() })}>Add note</button> : null}
                  {selected.allowedActions.includes('wait') ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => void runAction('wait', { note: note || undefined })}>Mark waiting</button> : null}
                </div>
                {selected.allowedActions.includes('resolve') ? <div className="ops-resolve"><label><span>Resolution</span><select value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value as AttentionEventInput['resolutionCode'])}><option value="action_completed">Action completed</option><option value="source_condition_cleared">Condition cleared</option><option value="no_action_required">No action required</option><option value="duplicate">Duplicate</option><option value="other">Other</option></select></label><button type="button" disabled={Boolean(pendingAction) || (resolutionCode === 'other' && !note.trim())} onClick={() => void runAction('resolve', { resolutionCode, note: note || undefined })}><CheckCircle2 aria-hidden="true" />Resolve task</button></div> : null}
              </div>
            </details>

            <details className="ops-evidence-panel">
              <summary>Evidence and activity <span>{selected.events.length}</span></summary>
              <div className="ops-evidence-facts">
                <div><small>Evidence type</small><strong>{issueLabel(selected.type)}</strong></div>
                <div><small>Recorded from</small><strong>{selected.sourceLabel || 'Linked operational record'}</strong></div>
                {selected.lastUpdatedAt ? <div><small>Last task update</small><strong>{formatDateTime(selected.lastUpdatedAt)}</strong></div> : null}
              </div>
              <section className="ops-history" aria-label="Task activity">
                <div><History aria-hidden="true" /><h4>Activity</h4><span>{selected.events.length}</span></div>
                {selected.events.length ? <ol>{[...selected.events].reverse().slice(0, 8).map((event) => <li key={event.id}><span /><div><strong>{event.label}</strong><p>{[event.actor, event.store].filter(Boolean).join(' · ')}</p>{event.note ? <blockquote>{event.note}</blockquote> : null}</div><time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time></li>)}</ol> : <p className="ops-history-empty"><UserRound aria-hidden="true" />No task updates yet.</p>}
              </section>
            </details>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
