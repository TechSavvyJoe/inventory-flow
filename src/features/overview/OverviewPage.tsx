import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  CarFront,
  CircleAlert,
  Clock3,
  FileText,
  MapPin,
  Printer,
  Wrench,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { SourceWarning } from '../../components/SourceWarning'
import { formatDate, formatDateTime } from '../../lib/format'
import { vehicleWorkspacePath, withWorkspaceReturnPath } from '../../lib/inventory-navigation'
import { serviceStatusLabel } from '../../lib/service-readiness'
import { useWorkspaceState } from '../../lib/workspace-memory'
import type { StoreName } from '../../types'
import {
  buildOverviewModel,
  overviewMedian,
  type OverviewPopulation,
  type OverviewStoreSummary,
  type OverviewVehicleFact,
} from './overview-model'
import './overview.css'

type OverviewScope = 'home' | 'group'
type PopulationStore = StoreName | 'All stores'

interface PopulationSelection {
  store: PopulationStore
  population: OverviewPopulation
}

const POPULATION_LABELS: Record<OverviewPopulation, string> = {
  inventory: 'Home inventory',
  on_lot: 'On lot',
  away: 'Away from home',
  visiting: 'Visiting',
  in_transit: 'In transit',
  holds: 'Current or last-verified holds',
  waiting_service: 'Waiting for service',
  in_service: 'In service',
  ready: 'Ready',
  location_review: 'Location needs checking',
  return_overdue: 'Return overdue',
  records_incomplete: 'Records incomplete',
  manager_log_sold: 'Sold — manager log',
  manager_log_delivered: 'Delivered — manager log',
  open_issues: 'Open vehicle issues',
}

const STORE_METRICS: Array<{ population: OverviewPopulation; shortLabel: string; tone?: string }> = [
  { population: 'on_lot', shortLabel: 'On lot' },
  { population: 'away', shortLabel: 'Away' },
  { population: 'visiting', shortLabel: 'Visiting' },
  { population: 'in_transit', shortLabel: 'In transit' },
  { population: 'holds', shortLabel: 'Holds' },
  { population: 'waiting_service', shortLabel: 'Waiting service' },
  { population: 'return_overdue', shortLabel: 'Return overdue', tone: 'danger' },
  { population: 'location_review', shortLabel: 'Check location', tone: 'warning' },
  { population: 'open_issues', shortLabel: 'Open issues', tone: 'warning' },
]

function uniqueFacts(facts: OverviewVehicleFact[]): OverviewVehicleFact[] {
  return [...new Map(facts.map(fact => [fact.vehicle.vin, fact])).values()]
}

function selectedPopulation(
  stores: OverviewStoreSummary[],
  selection: PopulationSelection,
): OverviewVehicleFact[] {
  const selectedStores = selection.store === 'All stores'
    ? stores
    : stores.filter(summary => summary.store === selection.store)
  return uniqueFacts(selectedStores.flatMap(summary => summary.populations[selection.population]))
}

function metricName(store: StoreName, count: number, label: string): string {
  return `${store}: ${count} ${label.toLowerCase()}`
}

function StoreCard({
  summary,
  homeStore,
  selected,
  onSelect,
}: {
  summary: OverviewStoreSummary
  homeStore: StoreName
  selected: PopulationSelection
  onSelect: (selection: PopulationSelection) => void
}) {
  const homeCount = summary.populations.inventory.length
  return (
    <section className={`ov-store-card${summary.store === homeStore ? ' is-home' : ''}`} aria-labelledby={`ov-store-${summary.store.replaceAll(' ', '-').toLowerCase()}`}>
      <header>
        <div>
          <h2 id={`ov-store-${summary.store.replaceAll(' ', '-').toLowerCase()}`}>{summary.store}</h2>
          <p>{summary.store === homeStore ? 'Working store' : 'Group store'} · home assignment</p>
        </div>
        <button
          type="button"
          className="ov-store-total"
          aria-label={metricName(summary.store, homeCount, 'home inventory vehicles')}
          aria-pressed={selected.store === summary.store && selected.population === 'inventory'}
          onClick={() => onSelect({ store: summary.store, population: 'inventory' })}
        >
          <strong>{homeCount}</strong>
          <span>home units</span>
        </button>
      </header>
      <div className="ov-store-metrics">
        {STORE_METRICS.map(metric => {
          const count = summary.populations[metric.population].length
          const active = selected.store === summary.store && selected.population === metric.population
          return (
            <button
              type="button"
              key={metric.population}
              className={`${active ? 'is-active' : ''}${metric.tone ? ` ov-tone-${metric.tone}` : ''}`}
              aria-label={metricName(summary.store, count, metric.shortLabel)}
              aria-pressed={active}
              disabled={count === 0}
              onClick={() => onSelect({ store: summary.store, population: metric.population })}
            >
              <span>{metric.shortLabel}</span>
              <strong>{count}</strong>
            </button>
          )
        })}
      </div>
      <div className="ov-store-support">
        {([
          ['ready', 'Ready'],
          ['in_service', 'In service'],
          ['records_incomplete', 'Records incomplete'],
        ] as Array<[OverviewPopulation, string]>).map(([population, label]) => {
          const count = summary.populations[population].length
          return <button key={population} type="button" aria-label={metricName(summary.store, count, label)} aria-pressed={selected.store === summary.store && selected.population === population} disabled={count === 0} onClick={() => onSelect({ store: summary.store, population })}><span>{label}</span><strong>{count}</strong></button>
        })}
        <p>Source-reported locations are labeled in the vehicle drilldown.</p>
      </div>
    </section>
  )
}

function PopulationRows({ facts, returnTo }: { facts: OverviewVehicleFact[]; returnTo: string }) {
  if (!facts.length) return <p className="ov-empty">No vehicles are in this population.</p>
  return (
    <ul className="ov-vehicle-list">
      {facts.map(fact => {
        const vehicle = fact.vehicle
        const recordsPath = vehicleWorkspacePath(vehicle.vin, { tab: 'data', returnTo })
        const detailPath = vehicleWorkspacePath(vehicle.vin, { returnTo })
        return (
          <li key={vehicle.vin}>
            <div className="ov-vehicle-identity">
              <strong>{vehicle.vehicleName}</strong>
              <span>#{vehicle.stockNumber} · VIN {vehicle.vin}</span>
              <span>Home: {fact.homeStore} · Current: {fact.currentLocation}</span>
              <small>{fact.locationBasisLabel}</small>
            </div>
            <div className="ov-vehicle-signals">
              {fact.away
                ? <span>{fact.awayDays === null ? 'Away · departure time not recorded' : `${fact.awayDays} day${fact.awayDays === 1 ? '' : 's'} away`}</span>
                : fact.locationBasis === 'move_ledger'
                  ? <span>Confirmed at home store</span>
                  : fact.locationBasis === 'source_reported'
                    ? <span>Source reports home store · custody not confirmed</span>
                    : <span>Location needs checking</span>}
              <span>{fact.holdActive ? fact.vehicle.hold.label : 'No current DealerMail hold found · confirm with home store'}</span>
              <span>{serviceStatusLabel(fact.vehicle.serviceReadiness)}</span>
              {fact.returnOverdue ? <strong className="ov-tone-danger">Return overdue</strong> : null}
              {fact.openIssues.length ? <strong className="ov-tone-warning">{fact.openIssues.length} open issue{fact.openIssues.length === 1 ? '' : 's'}</strong> : null}
            </div>
            <div className="ov-vehicle-actions">
              <Link to={recordsPath}><FileText aria-hidden="true" />Records {fact.records.captured}/{fact.records.applicable}</Link>
              <Link to={detailPath}>Vehicle details</Link>
              {vehicle.movement.transferId ? <Link to={withWorkspaceReturnPath(`/transfers?id=${encodeURIComponent(vehicle.movement.transferId)}`, returnTo)}><ArrowLeftRight aria-hidden="true" />Move</Link> : null}
              <Link to={withWorkspaceReturnPath(`/service?vin=${encodeURIComponent(vehicle.vin)}`, returnTo)}><Wrench aria-hidden="true" />Service</Link>
              {fact.openIssues[0] ? <Link to={`/attention?issue=${encodeURIComponent(fact.openIssues[0].id)}`}><CircleAlert aria-hidden="true" />Issue</Link> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function durationText(value: number | null, sample: number, empty: string): string {
  if (value === null) return empty
  return `${value} day${value === 1 ? '' : 's'} median · ${sample} measured`
}

export function OverviewPage() {
  const { data, homeStore, role, currentUser } = useAppData()
  const accessContext = `${currentUser}:${role}:${homeStore}`
  const [scope, setScope] = useWorkspaceState<OverviewScope>(accessContext, 'overview.scope', role === 'group_manager' ? 'group' : 'home')
  const [selection, setSelection] = useState<PopulationSelection>({ store: homeStore, population: 'inventory' })
  const model = useMemo(() => data ? buildOverviewModel(data) : null, [data])
  if (!data || !model) return null

  const orderedStores = [...model.stores].sort((left, right) => left.store === homeStore ? -1 : right.store === homeStore ? 1 : 0)
  const visibleStores = scope === 'home' ? orderedStores.filter(summary => summary.store === homeStore) : orderedStores
  const activeSelection = scope === 'home' && selection.store !== homeStore
    ? { store: homeStore, population: selection.population } as PopulationSelection
    : selection.store !== 'All stores' && !visibleStores.some(summary => summary.store === selection.store)
    ? { store: homeStore, population: selection.population } as PopulationSelection
    : selection
  const populationFacts = selectedPopulation(visibleStores, activeSelection)
  const scopeFacts = uniqueFacts(visibleStores.flatMap(summary => summary.populations.inventory))
  const awayFacts = scopeFacts.filter(fact => fact.away)
  const measuredAway = awayFacts.filter(fact => fact.awayDays !== null)
  const serviceFacts = uniqueFacts(visibleStores.flatMap(summary => [
    ...summary.populations.waiting_service,
    ...summary.populations.in_service,
    ...summary.populations.ready,
  ]))
  const inServiceFacts = serviceFacts.filter(fact => fact.serviceStatus === 'in_service')
  const measuredService = inServiceFacts.filter(fact => fact.serviceDays !== null)
  const waitingFacts = serviceFacts.filter(fact => fact.serviceStatus === 'needs_service')
  const measuredWaiting = waitingFacts.filter(fact => fact.waitingListingDays !== null)
  const openAttention = [...new Map(visibleStores.flatMap(summary => summary.attention).map(item => [item.id, item])).values()]
  const openIssues = [...new Map(visibleStores.flatMap(summary => summary.openIssues).map(issue => [issue.id, issue])).values()]
  const managerLogRows = (data.managerDispositions ?? []).filter(row => visibleStores.some(summary => summary.store === row.sourceStore))
  const unmatchedManagerRows = managerLogRows.filter(row => row.reviewRequired || !row.vin)
  const freshness = data.meta.dealerMailFreshness === 'current' && data.meta.publicFreshness === 'current'
    ? 'Holds current · website current'
    : 'One or more sources are last verified or incomplete'
  const returnTo = '/overview'
  const scopePopulationStore: PopulationStore = scope === 'home' ? homeStore : 'All stores'

  function choosePopulation(store: PopulationStore, population: OverviewPopulation) {
    setSelection({ store, population })
  }

  return (
    <section className="ov-page" aria-labelledby="ov-title">
      <header className="ov-header">
        <div>
          <p className="ov-eyebrow">Management snapshot</p>
          <h1 id="ov-title">Inventory overview</h1>
          <p>Where vehicles are, how long operational work is taking, and what needs a manager’s attention.</p>
        </div>
        <div className="ov-header-actions">
          <div className="ov-scope" role="group" aria-label="Overview scope">
            <button type="button" aria-pressed={scope === 'home'} onClick={() => setScope('home')}>My store · {homeStore}</button>
            <button type="button" aria-pressed={scope === 'group'} onClick={() => setScope('group')}>All stores</button>
          </div>
          <button type="button" className="ov-print" onClick={() => window.print()}><Printer aria-hidden="true" />Print snapshot</button>
        </div>
        <p className="ov-asof" role="status">As of {formatDate(data.meta.reportDate)} · updated {formatDateTime(data.meta.completedAt)} · {freshness}</p>
      </header>

      <SourceWarning meta={data.meta} />

      <p className="ov-boundary"><AlertTriangle aria-hidden="true" /><span><strong>Operational evidence, not an availability promise.</strong> Listing, DealerMail hold, manager-log disposition, service, and physical location remain separate. Confirm availability and custody with the home store.</span></p>

      <section className="ov-stores" aria-label="Store inventory summaries">
        {visibleStores.map(summary => <StoreCard key={summary.store} summary={summary} homeStore={homeStore} selected={activeSelection} onSelect={setSelection} />)}
      </section>

      <section className="ov-section ov-population" aria-labelledby="ov-population-title">
        <header className="ov-section-heading">
          <div>
            <p>Selected population</p>
            <h2 id="ov-population-title">{activeSelection.store} · {POPULATION_LABELS[activeSelection.population]}</h2>
          </div>
          <strong role="status" aria-live="polite">{populationFacts.length} vehicle{populationFacts.length === 1 ? '' : 's'}</strong>
        </header>
        <PopulationRows facts={populationFacts} returnTo={returnTo} />
      </section>

      <div className="ov-two-column">
        <section className="ov-section" aria-labelledby="ov-time-title">
          <header className="ov-section-heading">
            <div><p>Durations</p><h2 id="ov-time-title">Time signals</h2></div>
            <Clock3 aria-hidden="true" />
          </header>
          <div className="ov-signal-list">
            <button type="button" onClick={() => choosePopulation(scopePopulationStore, 'away')}>
              <span>Away from home</span>
              <strong>{durationText(overviewMedian(measuredAway.map(fact => fact.awayDays)), measuredAway.length, awayFacts.length ? `${awayFacts.length} away · departure time not recorded` : 'No vehicles away from home')}</strong>
              <small>Inventory Flow departure evidence only</small>
            </button>
            <button type="button" onClick={() => choosePopulation(scopePopulationStore, 'in_service')}>
              <span>Currently in service</span>
              <strong>{durationText(overviewMedian(measuredService.map(fact => fact.serviceDays)), measuredService.length, inServiceFacts.length ? `${inServiceFacts.length} in service · start date not recorded` : 'No vehicles currently in service')}</strong>
              <small>Manager-recorded service start to report date</small>
            </button>
            <button type="button" onClick={() => choosePopulation(scopePopulationStore, 'waiting_service')}>
              <span>Waiting units · listed age</span>
              <strong>{durationText(overviewMedian(measuredWaiting.map(fact => fact.waitingListingDays)), measuredWaiting.length, `${waitingFacts.length} waiting · listing age unavailable`)}</strong>
              <small>Listing age is not lot age or service wait time</small>
            </button>
          </div>
        </section>

        <section className="ov-section" aria-labelledby="ov-records-title">
          <header className="ov-section-heading">
            <div><p>Captured evidence</p><h2 id="ov-records-title">Records coverage</h2></div>
            <FileText aria-hidden="true" />
          </header>
          <div className="ov-records-summary">
            <button type="button" onClick={() => choosePopulation(scopePopulationStore, 'records_incomplete')}>
              <strong>{scopeFacts.filter(fact => fact.records.captured < fact.records.applicable).length}</strong>
              <span>vehicles with incomplete current records</span>
            </button>
            <p>Ford and Lincoln coverage checks AutoCheck, window sticker, factory equipment, OASIS, Ford service history, and invoice. Other makes use the applicable first three sources.</p>
            <small>Counts include only records marked current and visible to your authenticated role. Missing evidence does not describe vehicle condition or availability.</small>
          </div>
        </section>
      </div>

      <div className="ov-two-column">
        <section className="ov-section" aria-labelledby="ov-attention-title">
          <header className="ov-section-heading">
            <div><p>App-owned work</p><h2 id="ov-attention-title">Attention and vehicle issues</h2></div>
            <CircleAlert aria-hidden="true" />
          </header>
          <div className="ov-attention-counts">
            <Link to="/attention" aria-label={`${openAttention.length} open Action center ${openAttention.length === 1 ? 'item' : 'items'}`}><strong>{openAttention.length}</strong><span>open Action center items</span></Link>
            <Link to="/attention" aria-label={`${openIssues.length} open vehicle ${openIssues.length === 1 ? 'issue' : 'issues'}`}><strong>{openIssues.length}</strong><span>open vehicle issues</span></Link>
          </div>
          {openAttention.length || openIssues.length ? <ul className="ov-work-list">
            {openIssues.slice(0, 4).map(issue => <li key={issue.id}><span><strong>{issue.vehicleName}</strong><small>#{issue.stockNumber} · {issue.category} · {issue.status.replaceAll('_', ' ')}</small></span><Link to={`/attention?issue=${encodeURIComponent(issue.id)}`}>Review issue</Link></li>)}
            {openAttention.slice(0, 4).map(item => <li key={item.id}><span><strong>{item.label}</strong><small>{item.store ?? item.actionStore ?? 'Group'} · {item.priority} priority</small></span><Link to={item.href || '/attention'}>Review action</Link></li>)}
          </ul> : <p className="ov-empty">No open app-owned work is visible in this scope.</p>}
          <p className="ov-section-note">Issue completion is confirmed by a manager. Action center items and issue history are Inventory Flow records; they do not update DealerMail or source systems.</p>
        </section>

        <section className="ov-section" aria-labelledby="ov-disposition-title">
          <header className="ov-section-heading">
            <div><p>Read-only source evidence</p><h2 id="ov-disposition-title">Manager-log dispositions</h2></div>
            <CarFront aria-hidden="true" />
          </header>
          <div className="ov-disposition-grid">
            <button type="button" onClick={() => choosePopulation(scopePopulationStore, 'manager_log_sold')}><strong>{scopeFacts.filter(fact => fact.vehicle.managerDisposition?.soldManagerLog).length}</strong><span>Sold — manager log</span></button>
            <button type="button" onClick={() => choosePopulation(scopePopulationStore, 'manager_log_delivered')}><strong>{scopeFacts.filter(fact => fact.vehicle.managerDisposition?.deliveredManagerLog).length}</strong><span>Delivered — manager log</span></button>
            <Link to="/attention" aria-label={`${unmatchedManagerRows.length} manager-log rows need an exact VIN match`}><strong>{unmatchedManagerRows.length}</strong><small>rows need an exact VIN match</small></Link>
          </div>
          <p>{data.meta.managerDispositionCoverageCaveat || 'Manager-log coverage depends on the source periods included in the completed daily release.'}</p>
          <small>These imported labels are independent of public listing, DealerMail hold, service readiness, delivery confirmation, and physical location. Inventory Flow does not infer one from another.</small>
        </section>
      </div>

      <section className="ov-provenance" aria-labelledby="ov-provenance-title">
        <h2 id="ov-provenance-title">How to read this page</h2>
        <dl>
          <div><dt><MapPin aria-hidden="true" />Location</dt><dd>Verified Inventory Flow custody events take priority. Source-reported store is labeled when no verified move location exists.</dd></div>
          <div><dt><ArrowLeftRight aria-hidden="true" />Time away</dt><dd>Starts only from an actual recorded departure. An approval or request never starts the clock.</dd></div>
          <div><dt><Wrench aria-hidden="true" />Service</dt><dd>Manager records and qualifying source evidence determine status. A listing date never becomes a service date.</dd></div>
          <div><dt><FileText aria-hidden="true" />Documents</dt><dd>Coverage means a current captured record is visible. It does not confirm availability, condition, or installed equipment.</dd></div>
        </dl>
      </section>

      <footer className="ov-print-only">Inventory Flow daily snapshot · {scope === 'home' ? homeStore : 'All stores'} · As of {formatDate(data.meta.reportDate)} · {role === 'group_manager' ? 'Group manager' : 'Store manager'} · Counts are source evidence and app records as of the times shown. Confirm holds, availability, and physical location with the home store.</footer>
    </section>
  )
}
