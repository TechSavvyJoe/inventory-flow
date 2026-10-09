import { FlowLedgerHeading, flowButtonClassName } from '../../design-system'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Cable, FileInput, Filter, Pause, Play, Plus, RotateCw, Search, ExternalLink, History } from 'lucide-react'
import { formatDateTime } from '../../lib/format'
import type { PlatformConnection, PlatformConnections, PlatformEdit, PlatformGroup, PlatformRequest, PlatformPull } from './types'
import { METHODS, OEMS, PROVIDERS } from './platformPresentation'
import { PlatformOemCoverage } from './PlatformOemCoverage'
import { sourceReadiness } from './platformSourceModel'
import { matchSourceProfile, type SourceProfile } from './sourceCatalog'
import { PlatformProviderDirectory } from './PlatformProviderDirectory'
import { useGroupResource } from './useGroupResource'
import { PlatformCollectors } from './PlatformCollectors'
import './PlatformDataConnections.css'

const PULL_STATES = {queued:'Awaiting executor',running:'Running',completed:'Publication verified',failed:'Stopped',cancelled:'Cancelled',reconciliation_required:'Reconciliation required'}
const QUEUE_EMPTY_MESSAGES:Record<'all'|PlatformPull['state'],string>={
  all:'No pull requests.',
  queued:'No waiting pull requests.',
  running:'No running pull requests.',
  completed:'No completed pull requests.',
  failed:'No stopped pull requests.',
  reconciliation_required:'No pull requests need reconciliation.',
  cancelled:'No cancelled pull requests.',
}
const queueEmptyMessage=(state:string)=>Object.hasOwn(QUEUE_EMPTY_MESSAGES,state)?QUEUE_EMPTY_MESSAGES[state as keyof typeof QUEUE_EMPTY_MESSAGES]:'No pull requests match this filter.'
const scheduleLabel = (item: PlatformConnection) => item.cadence === 'manual' ? 'On request' : `${item.cadence === 'daily' ? 'Daily' : 'Hourly from'} ${item.localTime}`

export function PlatformDataConnections({ group, request, revision, busy, begin }: { group: PlatformGroup; request: PlatformRequest; revision: number; busy: boolean; begin: (edit: PlatformEdit) => void }) {
  const { data, error, retry } = useGroupResource<PlatformConnections>(`/groups/${group.id}/connections`, request, revision)
  const inspectorHeading = useRef<HTMLHeadingElement>(null), sourceRows = useRef(new Map<string, HTMLButtonElement>()), focusDestination = useRef<'inspector' | 'directory' | null>(null)
  const [panel,setPanel]=useState<'coverage'|'catalog'|'queue'|'collectors'|null>(null), [filtersOpen,setFiltersOpen]=useState(false)
  const [selected, setSelected] = useState(''), [detailOpen, setDetailOpen] = useState(true)
  const [search, setSearch] = useState(''), [store, setStore] = useState('all'), [provider, setProvider] = useState('all'), [oem, setOem] = useState('all'), [preference, setPreference] = useState('all'), [queueState, setQueueState] = useState('all')
  const connections = data?.connections.filter(item => item.groupId === group.id) ?? []
  const dealerName = (id: string) => group.dealerships.find(dealer => dealer.id === id)?.name ?? 'Unregistered dealership'
  const visible = connections.filter(item => `${item.name} ${item.vendor ?? ''} ${PROVIDERS[item.provider] ?? ''} ${OEMS[item.oem ?? 'not_applicable'] ?? ''} ${dealerName(item.dealershipId)}`.toLowerCase().includes(search.toLowerCase()) && (store === 'all' || item.dealershipId === store) && (provider === 'all' || item.provider === provider) && (oem === 'all' || (item.oem ?? 'not_applicable') === oem) && (preference === 'all' || item.enabled === (preference === 'enabled')))
  const selectedId = visible.some(item => item.id === selected) ? selected : visible[0]?.id
  const item = visible.find(source => source.id === selectedId)
  const waiting = data?.requests.filter(pull => ['queued','running','reconciliation_required'].includes(pull.state)) ?? []
  const scheduler = data?.scheduler
  const plannerStatus = !scheduler ? 'Planner diagnostics unavailable'
    : !scheduler.enabled ? 'Daily planner not activated'
      : !scheduler.lastTick ? 'Queue planner enabled · awaiting first tick'
        : scheduler.failed > 0 ? 'Latest planner batch reported failures'
          : 'Planner heartbeat successful'
  useEffect(() => {
    const destination = focusDestination.current
    if (!destination || panel) return
    const frame = window.requestAnimationFrame(() => {
      const target = destination === 'inspector' ? inspectorHeading.current : sourceRows.current.get(selectedId ?? '')
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'nearest' }); focusDestination.current = null }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [detailOpen, selectedId, panel])
  const showSource = (id: string, focusInspector = window.innerWidth < 1200) => { if (focusInspector) focusDestination.current = 'inspector'; setSelected(id); setDetailOpen(true) }
  const backToSources = () => { focusDestination.current = 'directory'; setDetailOpen(false) }
  const clearFilters = () => { setSearch(''); setStore('all'); setProvider('all'); setOem('all'); setPreference('all') }
  const inspect = (id: string) => { clearFilters(); showSource(id, true); setPanel(null) }
  const edit = (source?: PlatformConnection, family = 'not_applicable', dealershipId?: string, profile?:SourceProfile, focusInspectorAfterSave = false): PlatformEdit => ({
    kind:'source',
    afterSave: id => { clearFilters(); showSource(id, focusInspectorAfterSave || window.innerWidth < 1200); setPanel(null) },
    title: source ? 'Edit data connection' : 'Add data connection', path: `/groups/${group.id}/connections`,
    values: { ...(source ? { id: source.id } : {}), dealershipId: source?.dealershipId ?? dealershipId ?? group.dealerships[0]?.id ?? '', name: source?.name ?? profile?.name ?? '', provider: source?.provider ?? profile?.category ?? (family === 'not_applicable' ? 'public_inventory' : 'oem'), vendor: source?.vendor ?? profile?.name ?? (source ? PROVIDERS[source.provider] : ''), oem: source?.oem ?? family, method: source?.method ?? 'collector', endpoint: source?.endpoint ?? '', credentialRef: source?.credentialRef ?? '', enabled: source?.enabled ?? false, cadence: source?.cadence ?? 'manual', localTime: source?.localTime ?? '05:30', timezone: source?.timezone ?? 'America/Detroit', expectedRevision: data!.revision },
    fields: [
      { key: 'name', label: 'Connection name', section: 'Source identity' },
      { key: 'dealershipId', label: 'Dealership', section: 'Source identity', options: group.dealerships.filter(dealer => !source || dealer.id === source.dealershipId).map(dealer => ({ value: dealer.id, label: dealer.name })) },
      { key: 'provider', label: 'Data source', section: 'Source identity', options: Object.entries(PROVIDERS).map(([value, label]) => ({ value, label })) },
      { key: 'vendor', label: 'Provider or vendor name', section: 'Source identity' },
      { key: 'oem', label: 'OEM connection', section: 'Source identity', options: Object.entries(OEMS).map(([value, label]) => ({ value, label })) },
      { key: 'method', label: 'Connection method', section: 'Connection & credentials', options: Object.entries(METHODS).map(([value, label]) => ({ value, label })) },
      { key: 'endpoint', label: 'Public HTTPS feed URL', section: 'Connection & credentials', showWhen: { key: 'method', values: ['api', 'file'] } },
      { key: 'credentialRef', label: 'Credential reference (CREDENTIAL_NAME)', section: 'Connection & credentials', optional: true },
      { key: 'cadence', label: 'Pull schedule', section: 'Schedule & preference', options: [{ value: 'manual', label: 'On request' }, { value: 'daily', label: 'Daily' }, { value: 'hourly', label: 'Hourly' }] },
      { key: 'localTime', label: 'Local start time', section: 'Schedule & preference', type: 'time', showWhen: { key: 'cadence', values: ['daily', 'hourly'] } },
      { key: 'timezone', label: 'IANA timezone', section: 'Schedule & preference', showWhen: { key: 'cadence', values: ['daily', 'hourly'] } },
      { key: 'enabled', label: 'Enable scheduling preference', section: 'Schedule & preference', type: 'checkbox' },
    ],
    help: 'Save authorized configuration for this dealership. New sources start paused. Credential references identify separately provisioned secrets; no passwords are stored here. Enabling a preference does not start collection or verify provider access.',
  })
  const control = (source: PlatformConnection, operation: 'request' | 'cancel', requestId?: string) => begin({ title: operation === 'request' ? 'Queue data pull' : 'Cancel queued pull', path: `/groups/${group.id}/pulls`, values: { connectionId: source.id, operation, ...(requestId ? { requestId } : {}), expectedRevision: data!.revision }, fields: [], help: operation === 'request' ? `Queue a read-only pull request for ${source.name}. ${data?.execution.connected?'An eligible enrolled collector can claim permitted work. Capture and verified publication will be recorded separately.':'No executor is connected, so it will wait here until cancelled. No source is contacted and no inventory is published.'}` : `Stop further work for ${source.name}. A publication already admitted may finish; review its final verified or unknown result.` })
  const queued = item ? waiting.find(pull => pull.connectionId === item.id) : undefined
  const checks = item && data ? sourceReadiness(item, data, group) : undefined

  const profile=item?matchSourceProfile(item.provider,item.vendor??''):undefined
  const toggle=(next:'coverage'|'catalog'|'queue'|'collectors')=>setPanel(current=>current===next?null:next)
  return <section className="platform-data-workbench" data-source-detail-open={!panel&&detailOpen&&!!item} aria-label="Dealership data connections">
    <FlowLedgerHeading variant="plain" level={3} title={<><Cable size={20} aria-hidden="true" />Data connections</>} description="Choose a provider, configure its delivery and review stored evidence." actions={<button className={flowButtonClassName({ variant: "primary", className: "platform-primary" })} disabled={busy||!data||!group.dealerships.length} onClick={()=>begin(edit())}><Plus aria-hidden="true"/>Add connection</button>} />
    {!group.dealerships.length&&<p className="platform-empty-copy">Register a dealership before connecting its data.</p>}
    {error?<p role="alert">{error} <button className={flowButtonClassName({ variant: "secondary" })} onClick={retry}>Retry data connections</button></p>:!data?<p role="status">Loading source configuration…</p>:<>
      <section className="platform-execution-strip" aria-label="Collection readiness">
        <dl className="platform-execution-facts">
          <div><dt>Executor</dt><dd>{data.execution.connected?'Executor reported connected':'Executor not connected'}</dd></div>
          <div><dt>Planner</dt><dd>{plannerStatus}</dd></div>
          <div><dt>Configured sources</dt><dd>{connections.length} sources</dd></div>
          <div><dt>Waiting requests</dt><dd>{waiting.length} requests</dd></div>
          <div><dt>Provider access</dt><dd>Unverified</dd></div>
        </dl>
        <details><summary>Planner diagnostics</summary><small>Last tick: {formatDateTime(scheduler?.lastTick ?? undefined)} · {scheduler?.checked ?? 'Not reported'} checked · {scheduler?.queued ?? 'Not reported'} queued · {scheduler?.waiting ?? 'Not reported'} planner waiting · {scheduler?.failed ?? 'Not reported'} failed</small></details>
      </section>
      <div className="platform-data-tools" aria-label="Source planning tools"><button disabled={busy} aria-expanded={panel==='coverage'} onClick={()=>toggle('coverage')}>Evidence & OEM coverage</button><button disabled={busy} aria-expanded={panel==='catalog'} onClick={()=>toggle('catalog')}>Provider directory</button><button disabled={busy} aria-expanded={panel==='collectors'} onClick={()=>toggle('collectors')}>Collector hosts</button><button disabled={busy} aria-expanded={panel==='queue'} onClick={()=>toggle('queue')}>Pull requests {waiting.length}</button></div>
      {panel==='collectors'&&<PlatformCollectors group={group} connections={connections} request={request} revision={revision} busy={busy} onChanged={retry}/>}
      {panel==='coverage'&&<PlatformOemCoverage group={group} data={data} busy={busy} onInspect={inspect} onAdd={(family,dealershipId)=>begin(edit(undefined,family,dealershipId,undefined,true))}/>}
      {panel==='catalog'&&<PlatformProviderDirectory busy={busy||!group.dealerships.length} onChoose={providerProfile=>begin(edit(undefined,'not_applicable',undefined,providerProfile,true))}/>}
      {panel==='queue'&&<section aria-label="Pull request queue"><FlowLedgerHeading level={3} title={<><History size={20} aria-hidden="true" />Pull request history</>} description="Unresolved requests and latest 50 outcomes. Review Collector hosts for capture and publication evidence." actions={<select aria-label="Pull request state filter" value={queueState} onChange={event=>setQueueState(event.target.value)}><option value="all">All requests</option><option value="queued">Waiting</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Stopped</option><option value="reconciliation_required">Needs reconciliation</option><option value="cancelled">Cancelled</option></select>} /><div className="platform-source-queue">{data.requests.filter(pull=>queueState==='all'||pull.state===queueState).map(pull=>{const source=connections.find(connection=>connection.id===pull.connectionId);return <article className="platform-source-queue-row" key={pull.id}><div><strong>{source?.name??'Source no longer registered'}</strong><small>{source?dealerName(source.dealershipId):'Account-scoped request'} · {pull.kind==='scheduled'?'Scheduled':'Manual'}</small></div><div><strong>{PULL_STATES[pull.state]}</strong><small>{formatDateTime(pull.createdAt)} · {pull.requestedBy}</small>{pull.scheduledSlot&&<small>Local slot {pull.scheduledSlot}</small>}</div>{source&&<button className={flowButtonClassName({ variant: "secondary" })} disabled={busy} onClick={()=>['queued','running'].includes(pull.state)?control(source,'cancel',pull.id):inspect(source.id)}>{pull.state==='queued'?'Cancel request':pull.state==='running'?'Stop request':'Inspect source'}</button>}</article>})}{!data.requests.some(pull=>queueState==='all'||pull.state===queueState)&&<p className="platform-empty-copy">{queueEmptyMessage(queueState)}</p>}</div></section>}
      {!panel&&<>
        <div className={`platform-source-toolbar ${filtersOpen?'platform-source-toolbar--filters-open':''}`}><label className="platform-search"><Search aria-hidden="true"/><input aria-label="Find a connection" placeholder="Search sources or dealerships" value={search} onChange={event=>{setSearch(event.target.value);setDetailOpen(false)}}/></label><button className="platform-source-filter-toggle" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(current=>!current)}><Filter aria-hidden="true"/>Filters</button>
          <select aria-label="Connection dealership filter" value={store} onChange={event=>{setStore(event.target.value);setDetailOpen(false)}}><option value="all">All dealerships</option>{group.dealerships.map(dealer=><option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}</select>
          <select aria-label="Connection provider filter" value={provider} onChange={event=>{setProvider(event.target.value);setDetailOpen(false)}}><option value="all">All source types</option>{Object.entries(PROVIDERS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="Connection OEM filter" value={oem} onChange={event=>{setOem(event.target.value);setDetailOpen(false)}}><option value="all">All OEM families</option>{Object.entries(OEMS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="Connection preference filter" value={preference} onChange={event=>{setPreference(event.target.value);setDetailOpen(false)}}><option value="all">All preferences</option><option value="enabled">Enabled</option><option value="paused">Paused</option></select>
        </div>
        <div className="platform-source-workspace" data-detail-open={detailOpen&&!!item}>
          <div className="platform-source-ledger" role="region" aria-label="Source directory"><div className="platform-source-ledger-head" aria-hidden="true"><span>Source / evidence</span><span>Dealership</span><span>Preference</span><span>Schedule</span></div>
            {visible.map(source=><button className="platform-source-ledger-row" key={source.id} ref={element=>{if(element)sourceRows.current.set(source.id,element);else sourceRows.current.delete(source.id)}} disabled={busy} aria-pressed={selectedId===source.id} aria-label={`Inspect ${source.name} at ${dealerName(source.dealershipId)}`} onClick={()=>showSource(source.id)}><span><strong>{source.name}</strong><small>{source.vendor||PROVIDERS[source.provider]} · {PROVIDERS[source.provider]}</small></span><span>{dealerName(source.dealershipId)}<small>{OEMS[source.oem??'not_applicable']}</small></span><span><span className={`platform-status ${source.enabled?'platform-status--active':''}`}>{source.enabled?'Enabled':'Paused'}</span><small>Access unverified</small></span><span>{scheduleLabel(source)}<small>{waiting.some(pull=>pull.connectionId===source.id)?'Request waiting':source.cadence==='manual'?METHODS[source.method]:source.timezone}</small></span></button>)}
            {!visible.length&&<div className="platform-source-empty"><Cable aria-hidden="true"/><h4>{connections.length?'No matching sources':'No data sources configured'}</h4><p>{connections.length?'Change the filters to see other sources.':'Choose a provider to register an authorized collector, API or file feed.'}</p>{connections.length>0&&<button className={flowButtonClassName({ variant: "secondary" })} onClick={clearFilters}>Clear source filters</button>}</div>}
            <p className="platform-ledger-count">{visible.length} of {connections.length} configured sources · select a source to configure</p>
          </div>
          {item&&<article className="platform-source" aria-label="Selected source configuration"><header><button className="platform-source-back" onClick={backToSources}><ArrowLeft aria-hidden="true"/><span>Back to sources</span></button><span className="platform-source-icon">{item.method==='file'?<FileInput aria-hidden="true"/>:<Cable aria-hidden="true"/>}</span><div><h4 ref={inspectorHeading} tabIndex={-1}>{item.name}</h4><small>{dealerName(item.dealershipId)} · {item.vendor||PROVIDERS[item.provider]}</small></div><div className="platform-source-preference"><span className="platform-status">Scheduling preference: {item.enabled?'enabled':'paused'}</span><small>Access unverified</small></div></header>
            <footer><button className={flowButtonClassName({ variant: "secondary" })} disabled={busy||!!queued} onClick={()=>begin(edit(item))}>Configure</button><button className={flowButtonClassName({ variant: "secondary" })} disabled={busy||!!queued} onClick={()=>begin({...edit(item),kind:undefined,title:item.enabled?'Pause source':'Resume source',values:{...edit(item).values,enabled:!item.enabled},fields:[]})}>{item.enabled?<Pause aria-hidden="true"/>:<Play aria-hidden="true"/>}{item.enabled?'Pause':'Resume'}</button><button className={flowButtonClassName({ variant: "secondary" })} disabled={busy||!!queued||!item.enabled||group.status!=='active'} onClick={()=>control(item,'request')}><RotateCw aria-hidden="true"/>Queue pull request</button></footer>
            {queued&&<p className="platform-queue-status" role="status">{queued.state==='queued'?'Request queued · awaiting executor':PULL_STATES[queued.state]} <button className={flowButtonClassName({ variant: "secondary" })} disabled={busy||queued.state==='reconciliation_required'} onClick={()=>control(item,'cancel',queued.id)}>Cancel request</button></p>}
            <dl className="platform-source-facts"><div><dt>Evidence category</dt><dd>{PROVIDERS[item.provider]}</dd></div><div><dt>OEM scope</dt><dd>{OEMS[item.oem??'not_applicable']}</dd></div><div><dt>Delivery</dt><dd>{METHODS[item.method]}</dd></div><div><dt>Schedule</dt><dd>{scheduleLabel(item)}</dd></div>{item.cadence!=='manual'&&<><div><dt>Next planned slot</dt><dd>{item.schedule?.nextLocal??'Not reported'}</dd></div><div><dt>Timezone</dt><dd>{item.timezone}</dd></div></>}</dl>
            <section className="platform-source-evidence" aria-label="Source evidence guide"><details><summary>What this provider can supply</summary>{profile?<><ul>{profile.evidence.map(evidence=><li key={evidence}>{evidence}</li>)}</ul><p>{profile.access}</p><small>{profile.gate}</small><a href={profile.url} target="_blank" rel="noopener noreferrer">Provider documentation <ExternalLink aria-hidden="true"/></a></>:<p>Request the provider’s field dictionary, approved delivery method and dealer scope. This connection has no matched research profile.</p>}<p className="platform-help">Provider capabilities are planning guidance. Capture and field mapping have not been verified for this connection.</p></details></section>
            <details className="platform-source-readiness"><summary>Setup checks & technical details</summary>{checks?.checks.map(check=><div key={check.key}><span><strong>{check.label}</strong><small>{check.detail}</small></span><span className="platform-status">{check.status}</span></div>)}<dl className="platform-source-facts"><div><dt>Credential reference</dt><dd>{item.credentialRef||'Not configured'}</dd></div><div><dt>Configuration changed</dt><dd>{formatDateTime(item.updatedAt)}</dd></div></dl>{item.endpoint&&<p className="platform-source-url"><strong>Saved endpoint</strong> {item.endpoint}</p>}<p className="platform-help">{checks?.access.detail} {checks?.executor.detail}</p></details>
            <p className="platform-help">{queued?'Resolve the active request before editing.':!item.enabled?'Resume saves an enabled preference; it does not start collection.':group.status!=='active'?'Activate this account before queuing a request.':'Queuing saves a request only. No source is contacted or inventory published.'}</p>
          </article>}
        </div>
      </>}
    </>}
  </section>
}
