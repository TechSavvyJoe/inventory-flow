import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, FileText, MapPin, Printer, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { SourceWarning } from '../../components/SourceWarning'
import { formatDate, formatDateTime } from '../../lib/format'
import { useWorkspaceState } from '../../lib/workspace-memory'
import type {
  BootstrapData,
  OverviewException,
  OverviewExceptionKind,
  OverviewServiceStoreMetrics,
  OverviewSummary,
  OverviewVehicleFacts,
  StoreName,
  UserRole,
} from '../../types'
import {
  actionCenterHref,
  exceptionHref,
  inventoryViewHref,
  locationHref,
  recordsHref,
  returnOverdueHref,
  serviceStatusHref,
  serviceVehicleHref,
  type OverviewInventoryView,
} from './overview-links'
import {
  agedWaitingRows,
  exceptionRows,
  freshnessWord,
  OVERVIEW_ROW_LIMIT,
  overviewRows,
  plural,
  returnVerification,
  scopeStores,
  storeCards,
  WHERE_FILTERS,
  whereCounts,
  whereRows,
  type OverviewRow,
  type OverviewScope,
  type StoreCounts,
  type WhereFilter,
} from './overview-selectors'
import './overview.css'

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  group_manager: 'Group manager',
  manager: 'Store manager',
  sales: 'Salesperson',
}

const PHONE_ROWS = 5
const AGED_ROWS = 10
/** OVERVIEW_SPEC §10: the printed snapshot lists this many where-rows; `.ov-where .ov-rows` hides the rest in print. */
const PRINT_ROWS = 15
/** Matches the stylesheet's single-column breakpoint. */
const PHONE_QUERY = '(max-width: 880px)'

function subscribeToPhone(onChange: () => void) {
  const media = typeof window !== 'undefined' ? window.matchMedia?.(PHONE_QUERY) : undefined
  if (!media) return () => undefined
  media.addEventListener?.('change', onChange)
  return () => media.removeEventListener?.('change', onChange)
}

function phoneSnapshot() {
  return typeof window !== 'undefined' && (window.matchMedia?.(PHONE_QUERY).matches ?? false)
}

type Tone = 'danger' | 'warning'

interface CountSpec {
  key: keyof StoreCounts
  label: string
  /** Completes "Howell: 3 vehicles …" for the link's accessible name. */
  phrase: string
  href: (store: StoreName) => string
  tone?: Tone
}

const inventory = (view: OverviewInventoryView) => (store: StoreName) => inventoryViewHref(store, view)

const CORE_COUNTS: CountSpec[] = [
  { key: 'onLot', label: 'On lot', phrase: 'on lot', href: inventory('on-lot') },
  { key: 'away', label: 'Away', phrase: 'away from home', href: inventory('away') },
  { key: 'visiting', label: 'Visiting', phrase: 'visiting from other stores', href: inventory('visiting') },
  { key: 'inTransit', label: 'In transit', phrase: 'in transit', href: inventory('in-transit') },
  { key: 'holds', label: 'Holds', phrase: 'with holds', href: inventory('holds') },
  { key: 'waitingForService', label: 'Waiting for service', phrase: 'waiting for service', href: (store) => serviceStatusHref('needs_service', store) },
  { key: 'unaccounted', label: 'Unaccounted', phrase: 'unaccounted', href: inventory('unaccounted'), tone: 'danger' },
  { key: 'returnOverdue', label: 'Return overdue', phrase: 'with a return overdue', href: returnOverdueHref, tone: 'danger' },
]

const MORE_COUNTS: CountSpec[] = [
  { key: 'inService', label: 'In service', phrase: 'in service', href: (store) => serviceStatusHref('in_service', store) },
  { key: 'ready', label: 'Ready', phrase: 'ready', href: (store) => serviceStatusHref('serviced', store) },
  { key: 'holdsPastExpected', label: 'Holds past expected', phrase: 'with a hold past its expected date', href: inventory('holds-past-expected'), tone: 'warning' },
  { key: 'aged60', label: 'Listed 60+ days', phrase: 'listed 60 or more days', href: inventory('aged-60') },
  { key: 'aged90', label: 'Listed 90+ days', phrase: 'listed 90 or more days', href: inventory('aged-90'), tone: 'warning' },
  { key: 'recordsIncomplete', label: 'Records incomplete', phrase: 'with records incomplete', href: inventory('records-incomplete') },
]

/** OVERVIEW_SPEC §11: fixed copy, never source text. */
const EXCEPTION_COPY: Record<OverviewExceptionKind, { label: string; why: (days: number) => string }> = {
  location_conflict: { label: 'Location needs checking', why: () => 'The app’s own move records disagree about where this vehicle is.' },
  source_conflict: { label: 'Website and DealerMail disagree on store', why: () => 'The public feed and the CRM list different stores; confirm which lot has it.' },
  no_app_record: { label: 'Listed at another store · no move recorded', why: () => 'The website lists it away from its home store and Inventory Flow has no move for it.' },
  stale_confirmation: { label: 'Not confirmed for 7+ days', why: (days) => `Away from home with no custody confirmation for ${days}+ days.` },
  return_overdue: { label: 'Return overdue', why: () => 'Due back and not confirmed received.' },
  hold_past_expected: { label: 'Hold past expected date', why: () => 'The DealerMail expected date has passed; a review signal, not proof of sale or release.' },
  identity_review: { label: 'Manager log needs an exact VIN', why: () => 'A sold-board row could not be placed on a VIN.' },
  records_incomplete: { label: 'Records not all captured', why: () => 'One or more of AutoCheck, OASIS, sticker, invoice or Ford service history has not been captured for this unit.' },
  service_date_order: { label: 'Service dates before arrival', why: () => 'A recorded service date is earlier than the arrival date; check the record.' },
}

const UNACCOUNTED_TEXT: Record<NonNullable<OverviewVehicleFacts['unaccounted']>['reason'], string> = {
  location_conflict: 'Location needs checking',
  source_conflict: 'Website and DealerMail disagree on store',
  no_app_record: 'Listed at another store · no move recorded',
  stale_confirmation: 'Not confirmed recently',
}

const SERVICE_FOOTNOTE = 'Arrival is the earliest verified arrival or public listing date; listing dates can lag physical receipt. Ready from Ford or AutoCheck evidence uses the source’s dates. Days listed is listing age, not lot age. No service date is ever inferred from a listing, a hold, or a delivery.'

function slug(store: string): string {
  return store.toLowerCase().replaceAll(' ', '-')
}

function CountLink({ store, count, spec, note }: { store: StoreName; count: number; spec: CountSpec; note?: string | null }) {
  const toneClass = count > 0 && spec.tone ? ` ov-tone-${spec.tone}` : ''
  return (
    <div className={`ov-count${toneClass}`}>
      <dt>{spec.label}{note ? <small>{note}</small> : null}</dt>
      <dd>
        {count > 0
          ? <Link to={spec.href(store)} aria-label={`${store}: ${plural(count, 'vehicle')} ${spec.phrase}`}>{count}</Link>
          : <span className="ov-zero">0</span>}
      </dd>
    </div>
  )
}

function custodyText(facts: OverviewVehicleFacts): string {
  if (facts.custody === 'away') return facts.currentStore ? `Away · at ${facts.currentStore}` : 'Away'
  if (facts.custody === 'in_transit') return facts.returnLeg === 'return' ? 'In transit · returning home' : 'In transit'
  if (facts.custody === 'conflict') return 'Location needs checking'
  return 'On lot'
}

function daysAwayText(facts: OverviewVehicleFacts): string | null {
  if (facts.daysAway !== undefined) return `${plural(facts.daysAway, 'day')} away${facts.departedAt ? ` · since ${formatDate(facts.departedAt)}` : ''}`
  if (facts.daysAwayBasis === 'unknown') return 'Days away not recorded'
  return null
}

function arrivalText(service: OverviewVehicleFacts['service']): string | null {
  if (!service.arrivalDate) return null
  return `arrived ${formatDate(service.arrivalDate)} (${service.arrivalBasis === 'intake' ? 'intake' : 'listing date'})`
}

function RecordsLink({ vin, facts, name }: { vin: string; facts?: OverviewVehicleFacts; name: string }) {
  const label = facts ? `Records ${facts.recordsCaptured}/${facts.recordsApplicable}` : 'Records'
  return <Link className="ov-row-link" to={recordsHref(vin)} aria-label={`${label} for ${name}`}><FileText aria-hidden="true" />{label}</Link>
}

function WhereRow({ row, filter, holdsVerified }: { row: OverviewRow; filter: WhereFilter; holdsVerified: boolean }) {
  const { vehicle, facts } = row
  const days = daysAwayText(facts)
  const details: Array<{ text: string; tone?: Tone }> = []
  if (days) details.push({ text: days })
  if (facts.returnDueAt) details.push({ text: `Return due ${formatDate(facts.returnDueAt)}${facts.returnOverdue ? ' · Overdue' : ''}`, tone: facts.returnOverdue ? 'danger' : undefined })
  if (facts.unaccounted) {
    details.push({
      text: facts.unaccounted.reason === 'stale_confirmation' && facts.unaccounted.days !== undefined
        ? `Unaccounted · not confirmed for ${plural(facts.unaccounted.days, 'day')}`
        : `Unaccounted · ${UNACCOUNTED_TEXT[facts.unaccounted.reason]}`,
      tone: 'danger',
    })
  }
  if (facts.holdActive) details.push({ text: `${vehicle.hold.label}${holdsVerified ? '' : ' (last verified)'}${facts.holdPastExpected ? ' · past expected' : ''}`, tone: facts.holdPastExpected ? 'warning' : undefined })
  if (filter === 'waiting' && facts.service.waitingDays !== undefined) {
    details.push({ text: [`Waiting ${plural(facts.service.waitingDays, 'day')}`, arrivalText(facts.service)].filter(Boolean).join(' · ') })
  }
  const transferId = vehicle.movement.transferId
  return (
    <li className="ov-row">
      <div className="ov-row-main">
        <strong>{vehicle.vehicleName}</strong>
        <span className="ov-row-meta">#{vehicle.stockNumber} · Home {vehicle.homeStore}</span>
        <span className="ov-row-custody"><MapPin aria-hidden="true" />{custodyText(facts)} <em>{facts.custodyBasis === 'ledger' ? 'ledger' : 'source-reported'}</em></span>
        {details.length ? <span className="ov-row-details">{details.map((detail) => <span key={detail.text} className={detail.tone ? `ov-tone-${detail.tone}` : undefined}>{detail.text}</span>)}</span> : null}
      </div>
      <div className="ov-row-actions">
        <Link className="ov-row-link" to={locationHref(vehicle.vin, transferId)} aria-label={`${transferId ? 'Move' : 'Location'} for ${vehicle.vehicleName}`}><MapPin aria-hidden="true" />{transferId ? 'Move' : 'Location'}</Link>
        <RecordsLink vin={vehicle.vin} facts={facts} name={vehicle.vehicleName} />
      </div>
    </li>
  )
}

function ReturnVerification({ rows, store, fullAccess }: { rows: OverviewRow[]; store: StoreName; fullAccess: boolean }) {
  const { returning, received } = returnVerification(rows, store)
  if (!returning.length && !received.length) return null
  return (
    <div className="ov-returns">
      <h4>Return-home verification</h4>
      <ul>
        {returning.map(({ vehicle, facts }) => (
          <li key={vehicle.vin} className={facts.returnOverdue ? 'ov-tone-danger' : undefined}>
            <span>{vehicle.vehicleName} · #{vehicle.stockNumber} · returning home{facts.returnDueAt ? ` · due ${formatDate(facts.returnDueAt)}` : ''}{facts.returnOverdue ? ' · Overdue' : ''}</span>
            {fullAccess && vehicle.movement.transferId
              ? <Link className="ov-row-link" to={locationHref(vehicle.vin, vehicle.movement.transferId)} aria-label={`Confirm ${vehicle.vehicleName} back home`}>Confirm back home</Link>
              : null}
          </li>
        ))}
        {received.slice(0, 2).map(({ vehicle, facts }) => (
          <li key={vehicle.vin}><span>Back home {formatDate(facts.receivedHomeAt)} · {vehicle.vehicleName} · #{vehicle.stockNumber}</span></li>
        ))}
        {received.length > 2 ? <li><span>{plural(received.length - 2, 'more return')} this week</span></li> : null}
      </ul>
    </div>
  )
}

function StoreCard({ counts, homeStore, role, rows, fullAccess, holdsVerified, collapseMore }: { counts: StoreCounts; homeStore: StoreName; role: UserRole; rows: OverviewRow[]; fullAccess: boolean; holdsVerified: boolean; collapseMore: boolean }) {
  const store = counts.store
  const titleId = `ov-store-${slug(store)}`
  const otherStore = store !== homeStore
  const notes: Partial<Record<keyof StoreCounts, string | null>> = {
    onLot: `${counts.onLotSourceReported} source-reported`,
    holds: holdsVerified ? null : 'last verified',
  }
  // On a phone the secondary counts fold away so the where list reaches the first viewport (OVERVIEW_SPEC §3).
  const moreCounts = (
    <dl className="ov-counts ov-counts--more">
      {MORE_COUNTS.map((spec) => <CountLink key={spec.key} store={store} count={counts[spec.key] as number} spec={spec} />)}
    </dl>
  )
  return (
    <section className={`ov-store-card${otherStore ? '' : ' is-home'}`} aria-labelledby={titleId}>
      <header>
        <h3 id={titleId}>{store}</h3>
        {otherStore
          ? role === 'group_manager' ? null : <p>Moves as visible to you</p>
          : <p>Home store</p>}
      </header>
      <dl className="ov-counts">
        {CORE_COUNTS.map((spec) => <CountLink key={spec.key} store={store} count={counts[spec.key] as number} spec={spec} note={notes[spec.key]} />)}
      </dl>
      {collapseMore ? (
        <details className="ov-more">
          <summary>More counts<ChevronDown aria-hidden="true" /></summary>
          {moreCounts}
        </details>
      ) : moreCounts}
      <ReturnVerification rows={rows} store={store} fullAccess={fullAccess} />
    </section>
  )
}

function median(metric: { value: number | null; n: number }): string {
  if (metric.value === null) return '—'
  const value = Number.isInteger(metric.value) ? metric.value : metric.value.toFixed(1)
  return `${value} d (n=${metric.n})`
}

function intakeShare(metrics: OverviewServiceStoreMetrics): string {
  const total = metrics.arrivalBasis.intake + metrics.arrivalBasis.listing_date + metrics.arrivalBasis.unknown
  return total ? `${Math.round((metrics.arrivalBasis.intake / total) * 100)}%` : '—'
}

function ServiceCount({ count, status, store, label }: { count: number; status: 'needs_service' | 'in_service' | 'serviced'; store?: StoreName; label: string }) {
  if (!count) return <span className="ov-zero">0</span>
  return <Link to={serviceStatusHref(status, store)} aria-label={`${store ?? 'All stores'}: ${plural(count, 'vehicle')} ${label}`}>{count}</Link>
}

function ServiceMetricsRow({ metrics, store }: { metrics: OverviewServiceStoreMetrics; store?: StoreName }) {
  return (
    <tr className={store ? undefined : 'ov-service-group'}>
      <th scope="row">{store ?? 'All stores'}</th>
      <td data-label="Waiting"><ServiceCount count={metrics.counts.waitingForService} status="needs_service" store={store} label="waiting for service" /></td>
      <td data-label="In service"><ServiceCount count={metrics.counts.inService} status="in_service" store={store} label="in service" /></td>
      <td data-label="Ready"><ServiceCount count={metrics.counts.ready} status="serviced" store={store} label="ready" /></td>
      <td data-label="Median receipt → start">{median(metrics.medians.receiptToStartDays)}</td>
      <td data-label="Median in service">{median(metrics.medians.inServiceDays)}</td>
      <td data-label="Median receipt → Ready">{median(metrics.medians.receiptToReadyDays)}</td>
      <td data-label="Waiting 14+ / 30+">{metrics.agedWaiting14} / {metrics.agedWaiting30}</td>
      <td data-label="Arrival dates from intake">{intakeShare(metrics)}</td>
    </tr>
  )
}

function ServiceSection({ data, overview, stores, fullAccess, reportMode, onReport }: { data: BootstrapData; overview: OverviewSummary; stores: StoreName[]; fullAccess: boolean; reportMode: boolean; onReport: () => void }) {
  const service = overview.service
  const [showAllAged, setShowAllAged] = useState(false)
  if (!service) return null
  const perStore = stores.flatMap((store) => service.perStore.filter((entry) => entry.store === store))
  const basis = stores.length === 1 ? perStore[0]?.basis ?? service.group.basis : service.group.basis
  const aged = agedWaitingRows(data, overview, stores)
  const visibleAged = reportMode || showAllAged ? aged : aged.slice(0, AGED_ROWS)
  const [waitingFrom, waitingLong] = overview.thresholds.serviceWaitingDays
  return (
    <section className={`ov-section ov-service${reportMode ? ' is-report' : ''}`} aria-labelledby="ov-service-title">
      <header className="ov-section-heading">
        <h2 id="ov-service-title">Service</h2>
        <button type="button" className="ov-button" onClick={onReport}><Printer aria-hidden="true" />Open report</button>
      </header>
      <div className="ov-table-wrap">
        <table className="ov-service-table" aria-labelledby="ov-service-title">
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col">Waiting</th>
              <th scope="col">In service</th>
              <th scope="col">Ready</th>
              <th scope="col">Median receipt → start</th>
              <th scope="col">Median in service</th>
              <th scope="col">Median receipt → Ready</th>
              <th scope="col">Waiting {waitingFrom}+ / {waitingLong}+</th>
              <th scope="col">Arrival dates from intake</th>
            </tr>
          </thead>
          <tbody>
            {perStore.map((entry) => <ServiceMetricsRow key={entry.store} metrics={entry} store={entry.store} />)}
            {stores.length > 1 ? <ServiceMetricsRow metrics={service.group} /> : null}
          </tbody>
        </table>
      </div>
      <p className="ov-basis">
        Basis: {basis.manager_updated} manager-recorded · {basis.ford_service_history_inspection} Ford Certified Blue Oval · {basis.autocheck_post_intake_inspection} AutoCheck inspection · {basis.new_arrival} new arrival · {basis.unconfirmed} unconfirmed · {basis.legacy_review} legacy review
      </p>
      <h3 className="ov-subheading">Waiting {waitingFrom}+ days</h3>
      {aged.length ? (
        <ul className="ov-rows">
          {visibleAged.map((entry) => {
            const name = entry.vehicle?.vehicleName ?? entry.vin
            return (
              <li key={entry.vin} className="ov-row">
                <div className="ov-row-main">
                  <strong>{name}</strong>
                  <span className="ov-row-meta">{entry.vehicle ? `#${entry.vehicle.stockNumber} · ` : ''}{entry.store ?? 'Service store not set'}</span>
                  <span className={`ov-row-details${entry.waitingDays >= waitingLong ? ' ov-tone-danger' : ''}`}><span>Waiting {plural(entry.waitingDays, 'day')}{entry.facts?.service.arrivalDate ? ` · ${arrivalText(entry.facts.service)}` : ''}</span></span>
                </div>
                <div className="ov-row-actions">
                  <RecordsLink vin={entry.vin} facts={entry.facts} name={name} />
                  {fullAccess ? <Link className="ov-row-link" to={serviceVehicleHref(entry.vin)} aria-label={`Update service for ${name}`}><Wrench aria-hidden="true" />Update service</Link> : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : <p className="ov-empty">No vehicles waiting {waitingFrom}+ days in this scope.</p>}
      {aged.length > AGED_ROWS && !reportMode ? (
        <div className="ov-show-all">
          {showAllAged ? null : <button type="button" className="ov-button" onClick={() => setShowAllAged(true)}>Show all {aged.length}</button>}
          <Link className="ov-row-link" to={serviceStatusHref('needs_service')}>Open Waiting for service</Link>
        </div>
      ) : null}
      <p className="ov-footnote">{SERVICE_FOOTNOTE}</p>
      <p className="ov-source">Inventory Flow service ledger · live; Ford/AutoCheck evidence {freshnessWord(data.meta.resourceFreshness).toLowerCase()}</p>
    </section>
  )
}

function ExceptionsSection({ overview, stores, data }: { overview: OverviewSummary; stores: StoreName[]; data: BootstrapData }) {
  const exceptions = exceptionRows(overview, stores)
  return (
    <section className="ov-section ov-exceptions" aria-labelledby="ov-exceptions-title">
      <header className="ov-section-heading"><h2 id="ov-exceptions-title">Exceptions</h2></header>
      {exceptions.length ? (
        <dl className="ov-exception-list">
          {exceptions.map((exception: OverviewException) => {
            const copy = EXCEPTION_COPY[exception.kind]
            const label = exception.kind === 'stale_confirmation' ? `Not confirmed for ${overview.thresholds.unaccountedAfterDays}+ days` : copy.label
            return (
              <div key={`${exception.kind}:${exception.store}`}>
                <dt>{label}<small>{exception.store}</small></dt>
                <dd>
                  <Link to={exceptionHref(exception)} aria-label={`${exception.store}: ${plural(exception.count, 'vehicle')} · ${label}`}>{exception.count}</Link>
                  <p>{copy.why(overview.thresholds.unaccountedAfterDays)}</p>
                  {exception.kind === 'hold_past_expected' ? <Link className="ov-row-link" to={actionCenterHref('holds')}>Open in Action center</Link> : null}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : <p className="ov-empty">No exceptions in this scope.</p>}
      <p className="ov-source">Holds as of {formatDateTime(data.meta.completedAt)} · DealerMail {freshnessWord(data.meta.dealerMailFreshness).toLowerCase()} · records captures {freshnessWord(data.meta.resourceFreshness).toLowerCase()}</p>
    </section>
  )
}

function WhereSection({ rows, stores, holdsVerified, printing }: { rows: OverviewRow[]; stores: StoreName[]; holdsVerified: boolean; printing: boolean }) {
  const [filter, setFilter] = useState<WhereFilter>('away')
  const [showAll, setShowAll] = useState(false)
  const counts = useMemo(() => whereCounts(rows, stores), [rows, stores])
  const matches = useMemo(() => whereRows(rows, filter, stores), [rows, filter, stores])
  const visible = showAll || printing ? matches.slice(0, OVERVIEW_ROW_LIMIT) : matches.slice(0, PHONE_ROWS)
  const label = WHERE_FILTERS.find((entry) => entry.value === filter)!.label
  const unprinted = matches.length - PRINT_ROWS
  return (
    <section className="ov-section ov-where" aria-labelledby="ov-where-title">
      <header className="ov-section-heading"><h2 id="ov-where-title">Where is my inventory</h2></header>
      <div className="ov-chips ov-where-controls" role="group" aria-label="Show vehicles">
        {WHERE_FILTERS.map((entry) => (
          <button key={entry.value} type="button" aria-pressed={filter === entry.value} onClick={() => { setFilter(entry.value); setShowAll(false) }}>
            {entry.label} <span>{counts[entry.value]}</span>
          </button>
        ))}
      </div>
      <p className="ov-result" role="status">{plural(matches.length, 'vehicle')} · {label}</p>
      {visible.length
        ? <ul className="ov-rows">{visible.map((row) => <WhereRow key={row.vehicle.vin} row={row} filter={filter} holdsVerified={holdsVerified} />)}</ul>
        : <p className="ov-empty">{filter === 'away' ? 'No vehicles away from home.' : `No vehicles in ${label.toLowerCase()}.`}</p>}
      {matches.length > visible.length && !showAll ? <button type="button" className="ov-button ov-show-all" onClick={() => setShowAll(true)}>Show all {Math.min(matches.length, OVERVIEW_ROW_LIMIT)}</button> : null}
      {showAll && matches.length > OVERVIEW_ROW_LIMIT ? <p className="ov-footnote">Showing the first {OVERVIEW_ROW_LIMIT}. Open Inventory from a store count for the full list.</p> : null}
      {unprinted > 0 ? <p className="ov-print-only ov-print-more">and {plural(unprinted, 'more vehicle')} {filter === 'away' ? 'away from home' : `in ${label.toLowerCase()}`}</p> : null}
      <p className="ov-source">Locations: Inventory Flow move ledger · live. A location marked source-reported is the website’s store, not a confirmed location.</p>
    </section>
  )
}

export function OverviewPage() {
  const { data, homeStore, role, currentUser } = useAppData()
  const accessContext = `${currentUser}:${role}:${homeStore}`
  const [scope, setScope] = useWorkspaceState<OverviewScope>(accessContext, 'overview.scope', role === 'group_manager' ? 'group' : 'home')
  const [serviceReport, setServiceReport] = useState(false)
  const [printing, setPrinting] = useState(false)
  const phone = useSyncExternalStore(subscribeToPhone, phoneSnapshot, () => false)
  // Printing from the browser menu gets the same full snapshot as the button.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true))
    const after = () => setPrinting(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
  const overview = data?.overview
  const rows = useMemo(() => data && overview ? overviewRows(data, overview) : [], [data, overview])
  const stores = useMemo(() => scopeStores(homeStore, scope), [homeStore, scope])
  if (!data) return null
  if (!overview) {
    return (
      <section className="ov-page" aria-labelledby="ov-title">
        <header className="ov-header"><h1 id="ov-title">Overview</h1></header>
        <p className="ov-empty">The Overview is not available for this account.</p>
      </section>
    )
  }

  const fullAccess = overview.access === 'full'
  const holdsVerified = data.meta.dealerMailFreshness === 'current'
  const scopeLabel = scope === 'home' ? homeStore : 'All stores'
  const roleLabel = ROLE_LABELS[role] ?? role
  const asOf = `As of ${formatDate(overview.asOfDay)} · Holds ${freshnessWord(data.meta.dealerMailFreshness).toLowerCase()} · Website ${freshnessWord(data.meta.publicFreshness).toLowerCase()} · Locations from the move ledger`

  function printSnapshot() {
    flushSync(() => setPrinting(true))
    window.print()
    setPrinting(false)
  }

  function printServiceReport() {
    flushSync(() => setServiceReport(true))
    window.print()
    setServiceReport(false)
  }

  return (
    <section className={`ov-page${serviceReport ? ' is-service-report' : ''}`} aria-labelledby="ov-title">
      <header className="ov-header">
        <div className="ov-title">
          <h1 id="ov-title">Overview</h1>
          {fullAccess ? null : <p className="ov-access">Read-only</p>}
        </div>
        <div className="ov-scope" role="group" aria-label="Overview scope">
          <button type="button" aria-pressed={scope === 'home'} onClick={() => setScope('home')}>My store · {homeStore}</button>
          <button type="button" aria-pressed={scope === 'group'} onClick={() => setScope('group')}>All stores</button>
        </div>
        <p className="ov-asof" role="status">{asOf}</p>
        <button type="button" className="ov-button ov-print" onClick={printSnapshot}><Printer aria-hidden="true" />Print daily snapshot</button>
      </header>

      <p className="ov-print-only ov-print-header">Inventory Flow · Daily snapshot · {scopeLabel} · As of {formatDate(overview.asOfDay)} · Printed {formatDateTime(new Date().toISOString())} · {roleLabel} · Holds {freshnessWord(data.meta.dealerMailFreshness).toLowerCase()} · Website {freshnessWord(data.meta.publicFreshness).toLowerCase()}</p>

      <SourceWarning meta={data.meta} />

      <section className={`ov-stores${stores.length === 1 ? ' ov-stores--single' : ''}`} aria-label="Store summary">
        {storeCards(overview, stores).map((counts) => (
          <StoreCard key={counts.store} counts={counts} homeStore={homeStore} role={role} rows={rows} fullAccess={fullAccess} holdsVerified={holdsVerified} collapseMore={phone && !printing} />
        ))}
      </section>

      <div className="ov-grid">
        <WhereSection rows={rows} stores={stores} holdsVerified={holdsVerified} printing={printing} />
        <ExceptionsSection overview={overview} stores={stores} data={data} />
      </div>

      <ServiceSection data={data} overview={overview} stores={stores} fullAccess={fullAccess} reportMode={serviceReport} onReport={printServiceReport} />

      <footer className="ov-print-only ov-print-footer">Counts are app records and source evidence as of the times shown. Nothing here asserts availability; confirm holds and location with the home store.</footer>
    </section>
  )
}
