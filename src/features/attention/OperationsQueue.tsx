import { confirmUnsavedWork, useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useWorkspaceState, useWorkspaceScroll } from '../../lib/workspace-memory'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CopyableValue } from '../../components/CopyableValue'
import { PredictiveSearchInput } from '../../components/PredictiveSearchInput'
import { VehicleThumbnail } from '../../components/VehicleThumbnail'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '../../lib/format'
import { serviceStatusLabel } from '../../lib/service-readiness'
import type { AttentionEventInput, AttentionItem, BootstrapData, StoreName, UserRole, VehicleRecord } from '../../types'
import { actionCategory, belongsToActionStore, groupByVehicle, INFORMATIONAL_REASON_LABELS, isActionable, isTaskOverdue, taskLinkLabel, taskTitle, type ActionCategory, type ActionRow } from './action-center'
import { currentWorkspaceReturnPath, vehicleWorkspacePath, withWorkspaceReturnPath } from '../../lib/inventory-navigation'
import { searchFieldsMatch } from '../../lib/search'
import '../../styles/workflow-pages.css'
import './OperationsQueue.css'
import { VehicleIssueLedger } from '../issues/VehicleIssueLedger'

interface OperationsQueueProps {
  items: AttentionItem[]; homeStore: StoreName; role: UserRole; reportDate: string
  vehicles?: VehicleRecord[]; currentUser?: string
  issueData?: BootstrapData; onIssueChanged?: () => Promise<void>
  onAction: (id: string, input: AttentionEventInput) => Promise<AttentionItem>
}
const CATEGORIES: Array<[ActionCategory, string]> = [['all', 'All tasks'], ['issues', 'Vehicle issues'], ['moves', 'Vehicle moves'], ['holds', 'Hold follow-ups'], ['inventory', 'Inventory checks'], ['service', 'Service']]

function TaskVehicle({ item, vehicle }: { item: AttentionItem; vehicle?: VehicleRecord }) {
  const homeStore = vehicle?.homeStore || item.store
  const currentStore = vehicle?.movement?.locationConfidence === 'verified' && vehicle.movement.currentLocation
    ? vehicle.movement.currentLocation : vehicle?.sourceReportedLocation
  const location = vehicle?.movement?.locationConfidence === 'verified' && vehicle.movement.currentLocation
    ? `Confirmed at ${vehicle.movement.currentLocation}`
    : vehicle?.sourceReportedLocation ? `Reported at ${vehicle.sourceReportedLocation}` : null
  const value = vehicle ? [vehicle.listedPrice != null ? formatCurrency(vehicle.listedPrice) : null, vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : null, vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : null].filter(Boolean).join(' · ') : ''
  return <div className="workflow-vehicle action-vehicle"><VehicleThumbnail vehicle={vehicle}/><div className="action-vehicle-summary">
    <strong>{vehicle?.vehicleName || item.vehicleName || item.store || 'Store inventory'}</strong>
    {value ? <p className="action-vehicle-value">{value}</p> : null}
    {vehicle ? <p className="action-vehicle-readiness">{[serviceStatusLabel(vehicle.serviceReadiness), location].filter(Boolean).join(' · ')}</p> : null}
    {homeStore && homeStore !== currentStore ? <small>Home: {homeStore}</small> : null}
    {item.count ? <small>{item.count} {item.count === 1 ? 'vehicle' : 'vehicles'}</small> : null}
  </div><div className="action-vehicle-identifiers">{(vehicle?.stockNumber || item.stockNumber) && <CopyableValue label="stock number" text={(vehicle?.stockNumber || item.stockNumber)!} compact>Stock {vehicle?.stockNumber || item.stockNumber}</CopyableValue>}{(vehicle?.vin || item.vin) && <CopyableValue label="VIN" text={(vehicle?.vin || item.vin)!} compact>{vehicle?.vin || item.vin}</CopyableValue>}</div></div>
}

function TaskActions({ item, vehicle, returnTo }: { item: AttentionItem; vehicle?: VehicleRecord; returnTo: string }) {
  return <div className="action-next-steps" aria-label="Task and vehicle actions">
    {item.href ? <Link className="workflow-action workflow-action--primary" to={withWorkspaceReturnPath(item.href, returnTo)}>{taskLinkLabel(item)}<ArrowRight aria-hidden="true"/></Link> : <span className="workflow-muted">Ask your manager</span>}
    {vehicle ? <div className="workflow-quick-actions">
      <Link to={vehicleWorkspacePath(vehicle.vin, { returnTo })}>Vehicle details</Link>
      <Link to={vehicleWorkspacePath(vehicle.vin, { tab: 'data', returnTo })}>Records</Link>
    </div> : null}
  </div>
}

function TaskFollowUp({ item, condition, role, homeStore, currentUser, onAction }: Pick<OperationsQueueProps, 'role' | 'homeStore' | 'currentUser' | 'onAction'> & { item: AttentionItem; condition?: string }) {
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const { markSaved } = useUnsavedChanges(Boolean(note.trim() || date), { saving: busy })
  async function save(type: string) {
    setBusy(true); setMessage(''); setError('')
    try {
      await onAction(item.id, { type, actor: currentUser || 'Signed-in employee', actorRole: role, store: homeStore,
        note: note.trim() || undefined, ...(type === 'set_follow_up' ? { followUpAt: new Date(date).toISOString() } : {}),
        ...(type === 'resolve' ? { resolutionCode: 'action_completed' } : {}),
      })
      markSaved()
      setMessage(type === 'resolve' ? 'Review completed.' : 'Follow-up saved.'); setNote(''); setDate('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save. Try again.') }
    finally { setBusy(false) }
  }
  const canNote = item.allowedActions.includes('add_note')
  const canDate = item.allowedActions.includes('set_follow_up')
  // Move progress is recorded on the move itself; closing a generic task is not a handoff.
  const canResolve = actionCategory(item) !== 'moves' && item.allowedActions.includes('resolve')
  return <details className="action-follow-up"><summary>Follow-up &amp; history{condition ? <span className="action-follow-up-condition"> · {condition}</span> : null}</summary><div className="action-follow-up-body">
    {canNote || canDate || canResolve || item.allowedActions.includes('reopen') ? <div className="action-follow-up-form">
      {canNote ? <label>Work note<textarea rows={1} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="What was confirmed, or what happens next?" /></label> : null}
      {canDate ? <label>Follow up on<input type="datetime-local" value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label> : null}
      <div className="workflow-inline-actions">
        {canNote || canDate ? <button type="button" disabled={busy || !(canDate && date) && !(canNote && note.trim())} onClick={() => void save(date && canDate ? 'set_follow_up' : 'add_note')}>{busy ? 'Saving…' : 'Save follow-up'}</button> : null}
        {canResolve ? <button type="button" disabled={busy} onClick={() => void save('resolve')}>Mark reviewed</button> : null}
        {item.allowedActions.includes('reopen') ? <button type="button" disabled={busy} onClick={() => void save('reopen')}>Reopen review</button> : null}
      </div>
      {error ? <p role="alert" className="workflow-error">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    </div> : null}
    {item.events.length ? <ol className="action-history">{[...item.events].reverse().slice(0, 8).map(event => <li key={event.id}><strong>{event.label}</strong><span>{event.actor} · {formatDateTime(event.occurredAt)}</span>{event.note ? <p>{event.note}</p> : null}</li>)}</ol> : null}
  </div></details>
}

export function OperationsQueue({ items, homeStore, role, reportDate, vehicles = [], currentUser, onAction, issueData, onIssueChanged }: OperationsQueueProps) {
  const location = useLocation()
  const returnTo = currentWorkspaceReturnPath(location)
  const accessContext = `${issueData?.access?.userId ?? currentUser}:${role}:${homeStore}`
  useWorkspaceScroll(accessContext, 'attention')
  const [scope, setScope] = useWorkspaceState<'home' | 'group'>(accessContext, 'attention.scope', 'home')
  const [category, setCategory] = useWorkspaceState<ActionCategory>(accessContext, 'attention.category', 'all')
  const [status, setStatus] = useWorkspaceState(accessContext, 'attention.status', 'open')
  const [query, setQuery] = useWorkspaceState(accessContext, 'attention.query', '')
  // An Overview link (`?category=`) picks the task category once on entry.
  const navigate = useNavigate()
  const categoryParam = new URLSearchParams(location.search).get('category')
  useEffect(() => {
    if (categoryParam === null) return
    if (CATEGORIES.some(([key]) => key === categoryParam)) setCategory(categoryParam as ActionCategory)
    const scopeParam = new URLSearchParams(location.search).get('scope')
    if (scopeParam === 'home' || scopeParam === 'group') setScope(scopeParam)
    const next = new URLSearchParams(location.search)
    next.delete('category')
    next.delete('scope')
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : '', hash: location.hash }, { replace: true })
  }, [categoryParam]) // eslint-disable-line react-hooks/exhaustive-deps -- applied once per link
  const scoped = useMemo(() => items.filter(item => scope === 'group' || belongsToActionStore(item, homeStore)), [items, scope, homeStore])
  const statusItems = scoped.filter(item => status === 'reviewed' ? item.status === 'resolved' : item.status !== 'resolved')
  const matchesSearch = (item: AttentionItem) =>
    searchFieldsMatch(query, [taskTitle(item), item.type === 'vehicle_issue' ? item.whyItMatters : undefined, item.vehicleName, item.stockNumber, item.vin, item.owner, item.assignedTo, item.store])
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 }
  const taskItems = statusItems.filter(isActionable)
  const visible = groupByVehicle(taskItems
    .filter(item => (category === 'all' || actionCategory(item) === category) && matchesSearch(item))
    .sort((a, b) => Number(isTaskOverdue(b, reportDate)) - Number(isTaskOverdue(a, reportDate)) || priorityRank[a.priority] - priorityRank[b.priority]))
  // Everything a store cannot act on today stays reachable but collapsed, so the
  // queue above it only ever counts work this store and role can actually take.
  const alsoWorthKnowing = statusItems.filter(item => !isActionable(item) && (category === 'all' || actionCategory(item) === category) && matchesSearch(item))
  // A tab counts the rows it will show: one per vehicle with a condition in that
  // category. A vehicle with a hold and a service step is one row under "All
  // tasks" and one row under each of "Hold follow-ups" and "Service", so the
  // category figures can add up to more than "All tasks" by design.
  const categoryCounts = (key: ActionCategory) => key === 'issues' && issueData ? (issueData.vehicleIssues ?? []).filter(issue => issue.status !== 'completed' && (scope === 'group' || issue.reportStore === homeStore)).length : groupByVehicle(taskItems.filter(item => key === 'all' || actionCategory(item) === key)).length
  const vehicleMap = useMemo(() => new Map(vehicles.map(vehicle => [vehicle.vin, vehicle])), [vehicles])
  return <section className="action-queue" aria-label="Store action queue">
    <div className="workflow-page-heading"><div><h1>Action center</h1><p>The next step for your store, in one place.</p></div>
      <div className="workflow-scope" role="group" aria-label="Queue location scope"><button type="button" aria-pressed={scope === 'home'} onClick={() => { if (confirmUnsavedWork()) setScope('home') } }>{homeStore}</button><button type="button" aria-pressed={scope === 'group'} onClick={() => { if (confirmUnsavedWork()) setScope('group') } }>All stores</button></div>
    </div>
    <div className="workflow-tabs" role="group" aria-label="Task category">{CATEGORIES.filter(([key]) => key !== 'issues' || ['sales', 'manager', 'group_manager'].includes(role) || items.some(item => item.type === 'vehicle_issue')).map(([key, label]) => <button type="button" key={key} aria-label={key === 'issues' ? `${label} ${categoryCounts(key)}` : undefined} aria-pressed={category === key} onClick={() => { if (confirmUnsavedWork()) setCategory(key) } }>{label}<span>{categoryCounts(key)}</span></button>)}</div>
    {category === 'issues' && issueData ? <VehicleIssueLedger data={issueData} homeStore={homeStore} role={role} currentUser={currentUser} allStores={scope === 'group'} onChanged={onIssueChanged ?? (() => Promise.resolve())} /> : <>
    <div className="workflow-toolbar"><PredictiveSearchInput className="workflow-search" value={query} onChange={value => { if (confirmUnsavedWork()) setQuery(value) }} ariaLabel="Search work queue" clearLabel="Clear queue search" placeholder="Search vehicle, stock, VIN, or task" candidates={statusItems.filter(item => category === 'all' || actionCategory(item) === category).filter(matchesSearch).map(item => ({ id: item.id, label: item.vehicleName || item.stockNumber || taskTitle(item), detail: taskTitle(item), value: item.stockNumber || item.vehicleName || taskTitle(item), searchValues: [taskTitle(item), item.vehicleName, item.stockNumber, item.vin, item.owner, item.assignedTo, item.store] }))} />
      <div className="workflow-scope action-status-buttons" role="group" aria-label="Task status"><button type="button" aria-pressed={status === 'open'} onClick={() => { if (confirmUnsavedWork()) setStatus('open') } }>Open</button><button type="button" aria-pressed={status === 'reviewed'} onClick={() => { if (confirmUnsavedWork()) setStatus('reviewed') } }>Reviewed</button></div><span className="workflow-muted" role="status"><span>{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span>{alsoWorthKnowing.length ? ` · ${alsoWorthKnowing.length} informational` : ''}</span>
    </div>
    <div className="action-list" role="list" aria-label="Attention items"><div className="action-list-head" aria-hidden="true"><span>Vehicle</span><span>What needs doing</span><span>Owner / timing</span><span>Next step</span></div>
      {visible.map(row => <TaskRow key={row.key} row={row} vehicle={vehicleMap.get(row.lead.vin ?? '')} returnTo={returnTo} reportDate={reportDate} role={role} homeStore={homeStore} currentUser={currentUser} onAction={onAction}/>)}
      {!visible.length ? <div className="workflow-empty"><CheckCircle2 aria-hidden="true"/><h2>{query || category !== 'all' ? alsoWorthKnowing.length ? 'No actionable tasks match this view' : 'No tasks match this view' : status === 'reviewed' ? 'No reviewed tasks yet' : 'Your store is caught up'}</h2><p>{alsoWorthKnowing.length ? `${alsoWorthKnowing.length} informational ${alsoWorthKnowing.length === 1 ? 'item matches' : 'items match'} below.` : status === 'open' ? 'New follow-ups appear here when there is a next step to take.' : 'Completed reviews will appear here.'}</p>{query || category !== 'all' ? <button type="button" onClick={() => { if (confirmUnsavedWork()) { setQuery(''); setCategory('all') } }}>Clear filters</button> : null}</div> : null}
    </div>
    {alsoWorthKnowing.length ? <details className="action-also">
      <summary>Also worth knowing<span className="action-also-count">{alsoWorthKnowing.length}</span></summary>
      <p className="workflow-muted">These are not your store's next step today. Read them before promising a vehicle.</p>
      <ul className="action-also-list" aria-label="Also worth knowing">
        {alsoWorthKnowing.map(item => <li key={item.id}>
          <strong>{taskTitle(item)}</strong>
          <span>{[item.vehicleName || item.stockNumber, item.actionStore || item.store, item.informationalReason ? INFORMATIONAL_REASON_LABELS[item.informationalReason] : null].filter(Boolean).join(' · ')}</span>
          {item.href ? <Link to={withWorkspaceReturnPath(item.href, returnTo)}>{taskLinkLabel(item)}</Link> : null}
          {/* Not this store's step, but still recordable when the server allows it: a
              group manager or a related store can leave a note or a follow-up date. */}
          {item.allowedActions.length ? <TaskFollowUp item={item} role={role} homeStore={homeStore} currentUser={currentUser} onAction={onAction}/> : null}
        </li>)}
      </ul>
    </details> : null}
    </>}
  </section>
}

function TaskRow({ row, vehicle, returnTo, reportDate, role, homeStore, currentUser, onAction }: Pick<OperationsQueueProps, 'role' | 'homeStore' | 'currentUser' | 'onAction' | 'reportDate'> & { row: ActionRow; vehicle?: VehicleRecord; returnTo: string }) {
  const { lead } = row
  const relatedTasks = row.items.filter((item, index, items) => item.id !== lead.id && item.href && item.href !== lead.href && items.findIndex(other => other.href === item.href) === index)
  const overdue = row.items.some(item => isTaskOverdue(item, reportDate))
  // One row is one vehicle, but each condition keeps its own workflow record: a
  // note about the hold has to land on the hold, not on the move that leads the
  // row. Service status is recorded on the service page instead.
  const followUps = row.items.filter(item => item.type !== 'service_pending' && item.type !== 'vehicle_issue')
  return <article role="listitem" className="action-row"><div className="action-row-content">
    <TaskVehicle item={lead} vehicle={vehicle}/>
    <div className="action-task"><strong>{taskTitle(lead)}</strong>
      {lead.type === 'vehicle_issue' ? <p className="workflow-muted">{lead.whyItMatters}</p> : null}
      {relatedTasks.length > 0 ? <div className="action-task-related" aria-label="Other tasks for this vehicle">{relatedTasks.map(item => <Link key={item.id} to={withWorkspaceReturnPath(item.href!, returnTo)}>{taskLinkLabel(item)}</Link>)}</div> : null}
    </div>
    <div className="action-owner"><strong>{lead.assignedTo || lead.owner || 'Store manager'}</strong><span className={overdue ? 'workflow-overdue' : undefined}>{lead.followUpAt ? `Follow up ${formatDateTime(lead.followUpAt)}` : lead.dueAt ? `Due ${formatDate(lead.dueAt)}` : lead.status === 'resolved' ? 'Reviewed' : 'Next store review'}</span></div>
    <TaskActions item={lead} vehicle={vehicle} returnTo={returnTo}/>
  </div>{followUps.map(item => <TaskFollowUp key={item.id} item={item} condition={followUps.length > 1 ? taskTitle(item) : undefined} role={role} homeStore={homeStore} currentUser={currentUser} onAction={onAction}/>)}</article>
}
