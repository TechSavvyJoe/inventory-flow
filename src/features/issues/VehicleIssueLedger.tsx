import { useMemo, useRef, useState } from 'react'
import { Camera, ClipboardList, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { toInventoryVehicle } from '../../app/adapters'
import { VehicleThumbnail } from '../../components/VehicleThumbnail'
import { formatCurrency, formatDateTime, formatNumber } from '../../lib/format'
import { currentWorkspaceReturnPath, vehicleWorkspacePath } from '../../lib/inventory-navigation'
import { searchFieldsMatch } from '../../lib/search'
import { serviceStatusLabel } from '../../lib/service-readiness'
import { confirmUnsavedWork } from '../../lib/useUnsavedChanges'
import { useWorkspaceState } from '../../lib/workspace-memory'
import { FlowLedgerHeading, flowButtonClassName } from '../../design-system'
import type { BootstrapData, StoreName, UserRole, VehicleIssueAction, VehicleIssueCategory } from '../../types'
import { IssueDialog } from './IssueDialog'
import { IssueReportForm } from './IssueReportDialog'
import { canReportVehicleIssue, ISSUE_CATEGORIES, ISSUE_STATUSES, issueNextAction } from './issue-model'
import './VehicleIssueLedger.css'

type IssueView = 'open' | 'review' | 'completed' | 'all'
const VIEWS: Array<[IssueView, string]> = [['open', 'Open'], ['review', 'Review'], ['completed', 'Completed'], ['all', 'All']]
const PAGE_SIZE = 12

export function VehicleIssueLedger({ data, homeStore, role, currentUser, allStores, onChanged }: {
  data: BootstrapData; homeStore: StoreName; role: UserRole; currentUser?: string
  allStores: boolean; onChanged: () => Promise<void>
}) {
  const owner = `${data.access?.userId ?? currentUser}:${role}:${homeStore}`
  const [view, setView] = useWorkspaceState<IssueView>(owner, 'issues.view', 'open')
  const [category, setCategory] = useWorkspaceState<VehicleIssueCategory | 'all'>(owner, 'issues.category', 'all')
  const [query, setQuery] = useWorkspaceState(owner, 'issues.query', '')
  const [paging, setPaging] = useState({ key: '', page: 0 })
  const [reporting, setReporting] = useState(false)
  const [reportVin, setReportVin] = useState<string | null>(null)
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [notice, setNotice] = useState('')
  const opener = useRef<HTMLElement | null>(null)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const returnTo = currentWorkspaceReturnPath(location)
  const vehicles = useMemo(() => new Map(data.vehicles.map(vehicle => [vehicle.vin, vehicle])), [data.vehicles])
  // Keep historical issues even after a vehicle leaves the current daily feed.
  // The reporting store owns the work; a source location does not change it.
  const scoped = (data.vehicleIssues ?? []).filter(issue => allStores || issue.reportStore === homeStore)
  const matches = scoped.filter(issue => (category === 'all' || issue.category === category) && searchFieldsMatch(query,
    [issue.vehicleName, issue.stockNumber, issue.vin, issue.description, issue.assignee, issue.reportedBy, issue.reportStore, ISSUE_CATEGORIES[issue.category]]))
  const inView = (status: string, selected: IssueView) => selected === 'all' || (selected === 'open' ? status !== 'completed' : selected === 'review' ? status === 'awaiting_review' : status === 'completed')
  const filtered = matches.filter(issue => inView(issue.status, view)).sort((a, b) =>
    Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || Number(b.status === 'awaiting_review') - Number(a.status === 'awaiting_review') || b.updatedAt.localeCompare(a.updatedAt, 'en-US') || a.id.localeCompare(b.id, 'en-US'))
  const pageKey = `${allStores}:${view}:${category}:${query}`
  const page = Math.min(paging.key === pageKey ? paging.page : 0, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1))
  const context = { role, homeStore, currentUser: currentUser ?? 'Signed-in employee', enabled: data.vehicleIssuesEnabled === true, issues: data.vehicleIssues ?? [], onChanged }
  const reportable = context.enabled ? data.vehicles.filter(vehicle => canReportVehicleIssue(toInventoryVehicle(vehicle, data), context)) : []
  const reportVehicle = reportVin ? vehicles.get(reportVin) : undefined
  const pickerMatches = reportable.filter(vehicle => searchFieldsMatch(vehicleQuery, [vehicle.vehicleName, vehicle.vin, vehicle.stockNumber, vehicle.homeStore]))

  return <section className="issue-ledger" aria-label="Vehicle issue log">
    <FlowLedgerHeading className="issue-ledger__heading" title={<><ClipboardList size={20} aria-hidden="true" />Ledger</>} description="Assign work, track updates and photos, then confirm completion."
      actions={reportable.length ? <button data-issue-opener className={flowButtonClassName({ variant: "primary", className: "issue-ledger__primary" })} type="button" onClick={event => { opener.current = event.currentTarget; setReportVin(null); setVehicleQuery(''); setReporting(true); setNotice('') }}><Plus aria-hidden="true" />Report issue</button> : undefined} />
    {data.vehicleIssuesEnabled !== true ? <p className="issue-ledger__notice" role="status">Issue history is available. Reporting and updates are not enabled in this deployment.</p> : null}
    {notice ? <p className="issue-ledger__notice" role="status">{notice}</p> : null}
    <div className="issue-ledger__toolbar">
      <div className="issue-ledger__views" role="group" aria-label="Issue status">{VIEWS.map(([key, label]) => <button key={key} type="button" aria-label={`${label} ${matches.filter(issue => inView(issue.status, key)).length}`} aria-pressed={view === key} onClick={() => setView(key)}>{label}<span>{matches.filter(issue => inView(issue.status, key)).length}</span></button>)}</div>
      <label className="issue-ledger__search"><Search aria-hidden="true"/><input type="search" aria-label="Search vehicle issues" placeholder="Vehicle, stock, VIN, issue or employee" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="issue-ledger__category">Category<select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="all">All categories</option>{Object.entries(ISSUE_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <div className="issue-ledger__columns" aria-hidden="true"><span>Vehicle / location</span><span>Issue / evidence</span><span>Owner / progress</span><span>Next action</span></div>
    <div className="issue-ledger__rows" role="list" aria-label="Reported vehicle issues">{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(issue => {
      const vehicle = vehicles.get(issue.vin)
      const location = vehicle?.movement?.locationConfidence === 'verified' ? `Confirmed at ${vehicle.movement.currentLocation}` : vehicle?.sourceReportedLocation ? `Reported at ${vehicle.sourceReportedLocation}` : null
      const value = vehicle ? [vehicle.listedPrice != null ? formatCurrency(vehicle.listedPrice) : null, vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : null, serviceStatusLabel(vehicle.serviceReadiness)].filter(Boolean).join(' · ') : null
      const nextAction = data.vehicleIssuesEnabled === true ? issueNextAction(issue) : null
      const actionLabels: Partial<Record<VehicleIssueAction, string>> = { assign: 'Assign issue', start_work: 'Start work', add_note: 'Add update', request_completion: 'Send for review', complete: 'Review work', reopen: 'Reopen issue' }
      const actionLabel = nextAction ? actionLabels[nextAction] : 'View issue'
      return <article className="issue-ledger__row" role="listitem" key={issue.id}>
        <div className="issue-ledger__vehicle"><VehicleThumbnail vehicle={vehicle} className="issue-ledger__photo"/><div><strong>{vehicle?.vehicleName ?? issue.vehicleName}</strong>{value ? <p>{value}</p> : null}<p>Stock {issue.stockNumber} · {issue.vin}</p><p>{vehicle ? location ?? 'Location not confirmed' : 'Not in current inventory'}</p></div></div>
        <div className="issue-ledger__issue"><div className="issue-ledger__labels"><strong>{ISSUE_CATEGORIES[issue.category]}</strong>{issue.priority === 'urgent' ? <span className="issue-ledger__urgent">Urgent</span> : null}</div><p className="issue-ledger__description">{issue.description}</p>{issue.photoCount ? <span className="issue-ledger__evidence"><Camera aria-hidden="true"/>{issue.photoCount} {issue.photoCount === 1 ? 'photo' : 'photos'} attached</span> : null}<small>Reported by {issue.reportedBy} · {issue.reportStore}</small></div>
        <div className="issue-ledger__progress"><span className="vehicle-issue-state" data-status={issue.status}>{ISSUE_STATUSES[issue.status]}</span><strong>{issue.assignee ?? 'Unassigned'}</strong><small>{issue.status === 'completed' ? `Confirmed by ${issue.completedBy ?? 'manager'}` : 'Updated'} · {formatDateTime(issue.completedAt ?? issue.updatedAt)}</small></div>
        <div className="issue-ledger__actions"><Link data-issue-opener className={flowButtonClassName({ variant: "primary", className: "issue-ledger__primary" })} to={`?issue=${encodeURIComponent(issue.id)}${nextAction ? `&action=${nextAction}` : ''}`} aria-label={`${actionLabel}: ${ISSUE_CATEGORIES[issue.category]} · ${issue.stockNumber}`}>{actionLabel}<ChevronRight aria-hidden="true"/></Link>{vehicle ? <Link data-inventory-vehicle-trigger={issue.vin} to={vehicleWorkspacePath(issue.vin, { tab: 'issues', returnTo })}>Vehicle details</Link> : null}</div>
      </article>
    })}</div>
    {!filtered.length ? <div className="issue-ledger__empty"><h3>{query || category !== 'all' ? 'No issues match these filters' : view === 'completed' ? 'No completed issues yet' : view === 'review' ? 'No issues awaiting manager review' : view === 'all' ? 'No vehicle issues reported yet' : 'No open vehicle issues'}</h3><p>{query || category !== 'all' ? 'Try another vehicle, employee or category.' : 'Reports stay attached to the vehicle, with photos, updates and completion history.'}</p>{query || category !== 'all' ? <button type="button" onClick={() => { setQuery(''); setCategory('all') }}>Clear issue filters</button> : null}</div> : null}
    <footer className="issue-ledger__footer"><span role="status">{filtered.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}` : '0'} {filtered.length === 1 ? 'issue' : 'issues'} · {allStores ? 'All reporting stores' : homeStore}</span>{filtered.length > PAGE_SIZE ? <div><button type="button" aria-label="Previous issue page" disabled={page === 0} onClick={() => setPaging({ key: pageKey, page: page - 1 })}><ChevronLeft aria-hidden="true"/></button><button type="button" aria-label="Next issue page" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPaging({ key: pageKey, page: page + 1 })}><ChevronRight aria-hidden="true"/></button></div> : null}</footer>
    {reporting ? <IssueDialog title="Report a vehicle issue" returnFocusRef={opener} onClose={() => setReporting(false)}>
      {reportVehicle ? <><button className="issue-ledger__back" type="button" onClick={() => { if (confirmUnsavedWork()) setReportVin(null) }}><ChevronLeft aria-hidden="true"/>Choose another vehicle</button><IssueReportForm key={reportVehicle.vin} vehicle={toInventoryVehicle(reportVehicle, data)} context={context} onSaved={issue => { setReporting(false); setNotice(`Issue reported for stock ${issue.stockNumber}.`); const next = new URLSearchParams(params); next.set('issue', issue.id); setParams(next); void onChanged().catch(() => undefined) }} /></> : <div className="issue-ledger__picker"><label>Find the vehicle<input type="search" autoFocus value={vehicleQuery} onChange={event => setVehicleQuery(event.target.value)} placeholder="Search stock, VIN or vehicle" /></label><p>{pickerMatches.length} {pickerMatches.length === 1 ? 'vehicle' : 'vehicles'} · Choose a vehicle to attach the report.</p><ul>{pickerMatches.slice(0, 25).map(vehicle => <li key={vehicle.vin}><button type="button" onClick={() => setReportVin(vehicle.vin)}><VehicleThumbnail vehicle={vehicle} className="issue-ledger__photo"/><span><strong>{vehicle.vehicleName}</strong><small>Stock {vehicle.stockNumber} · {vehicle.homeStore}</small></span><ChevronRight aria-hidden="true"/></button></li>)}</ul>{pickerMatches.length > 25 ? <p>Search to narrow the first 25 results.</p> : null}{!pickerMatches.length ? <p>No reportable vehicles match. Try another stock number or VIN.</p> : null}</div>}
    </IssueDialog> : null}
  </section>
}
