import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, ClipboardCheck, FileText, MapPin, Printer, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { SourceWarning } from '../../components/SourceWarning'
import { formatDate, formatDateTime } from '../../lib/format'
import { useWorkspaceState } from '../../lib/workspace-memory'
import type {
  AppDispositionCode,
  BootstrapData,
  OverviewException,
  OverviewExceptionKind,
  OverviewServiceStoreMetrics,
  OverviewSummary,
  OverviewThresholds,
  OverviewVehicleFacts,
  StoreName,
  UserRole,
  VehicleRecord,
} from '../../types'
import {
  actionCenterHref,
  dispositionView,
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
import { DispositionDialog } from './DispositionDialog'
import { defaultDispositionDate, DISPOSITION_LABELS, DISPOSITION_QUALIFIER, dispositionSummary, managerLogLine } from './disposition-model'
import { StoreBoard } from './StoreBoard'
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
/** A media query as a useSyncExternalStore source; false where matchMedia is missing. */
function mediaQuery(query: string) {
  return {
    subscribe(onChange: () => void) {
      const media = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined
      if (!media) return () => undefined
      media.addEventListener?.('change', onChange)
      return () => media.removeEventListener?.('change', onChange)
    },
    matches: () => typeof window !== 'undefined' && (window.matchMedia?.(query).matches ?? false),
  }
}

/** Matches the stylesheet's single-column breakpoint. */
const PHONE = mediaQuery('(max-width: 880px)')
/** Matches overview.css: from this width the sections sit in two columns. */
const WIDE = mediaQuery('(min-width: 1181px)')

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

/**
 * OVERVIEW_SPEC §11: fixed copy, never source text. The two disposition kinds
 * are prompts, never inferences. Each line is shown once per type above the
 * store counts, so it reads for one vehicle or many.
 */
const EXCEPTION_COPY: Record<OverviewExceptionKind, { label: string; why: (thresholds: OverviewThresholds) => string }> = {
  location_conflict: { label: 'Location needs checking', why: () => 'The app’s own move records disagree about where the vehicle is.' },
  source_conflict: { label: 'Website and DealerMail disagree on store', why: () => 'The public feed and the CRM list different stores; confirm which lot has the vehicle.' },
  no_app_record: { label: 'Listed at another store · no move recorded', why: () => 'The website lists the vehicle away from its home store and Inventory Flow has no move for it.' },
  stale_confirmation: { label: 'Not confirmed for 7+ days', why: (thresholds) => `Away from home with no custody confirmation for ${thresholds.unaccountedAfterDays}+ days.` },
  return_overdue: { label: 'Return overdue', why: () => 'Due back and not confirmed received.' },
  hold_past_expected: { label: 'Hold past expected date', why: () => 'The DealerMail expected date has passed; a review signal, not proof of sale or release.' },
  identity_review: { label: 'Manager log needs an exact VIN', why: () => 'Sold-board rows that could not be placed on a VIN.' },
  records_incomplete: { label: 'Records not all captured', why: () => 'Vehicles missing one or more of AutoCheck, OASIS, sticker, invoice or Ford service history.' },
  service_date_order: { label: 'Service dates before arrival', why: () => 'A recorded service date is earlier than the arrival date; check the record.' },
  listed_but_delivered: { label: 'Recorded delivered · still listed', why: (thresholds) => `Delivered in Inventory Flow ${thresholds.listedAfterDeliveredDays}+ days ago and still listed on the website. Confirm with the store; the listing is not changed here.` },
  delivered_move_no_disposition: { label: 'Move says delivered · no disposition', why: () => 'A move records customer delivery; no disposition has been recorded.' },
}

/** Store-card disposition counts, most decision-relevant first (OVERVIEW_SPEC §3). */
const CARD_DISPOSITIONS: AppDispositionCode[] = ['sold_pending', 'delivered', 'wholesale', 'transfer_out']
const TABLE_DISPOSITIONS: Array<AppDispositionCode | 'none'> = ['sold_pending', 'delivered', 'wholesale', 'transfer_out', 'keep', 'none']
const DISPOSITION_ROWS = 8

const UNACCOUNTED_TEXT: Record<NonNullable<OverviewVehicleFacts['unaccounted']>['reason'], string> = {
  location_conflict: 'Location needs checking',
  source_conflict: 'Website and DealerMail disagree on store',
  no_app_record: 'Listed at another store · no move recorded',
  stale_confirmation: 'Not confirmed recently',
}


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
  if (vehicle.appDisposition?.code) details.push({ text: `${dispositionSummary(vehicle.appDisposition)} · recorded` })
  if (filter === 'waiting' && facts.service.waitingDays !== undefined) {
    details.push({ text: [`Waiting ${plural(facts.service.waitingDays, 'day')}`, arrivalText(facts.service)].filter(Boolean).join(' · ') })
  }
  const transferId = vehicle.movement.transferId
  return (
    <li className="ov-row">
      <div className="ov-row-main">
        <strong>{vehicle.vehicleName}</strong>
        <span className="ov-row-meta">#{vehicle.stockNumber} · Home {vehicle.homeStore}</span>
        <span className="ov-row-custody"><MapPin aria-hidden="true" />{custodyText(facts)}{facts.custodyBasis === 'ledger' ? null : <em title="The website’s store, not a confirmed location">source-reported</em>}</span>
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

const STORAGE_NOT_ENABLED = 'Disposition storage is not enabled yet.'

function StoreCard({ counts, homeStore, role, rows, fullAccess, holdsVerified, collapseMore, collapseStore, dispositionsEnabled }: { counts: StoreCounts; homeStore: StoreName; role: UserRole; rows: OverviewRow[]; fullAccess: boolean; holdsVerified: boolean; collapseMore: boolean; collapseStore: boolean; dispositionsEnabled: boolean }) {
  const store = counts.store
  const titleId = `ov-store-${slug(store)}`
  const otherStore = store !== homeStore
  const notes: Partial<Record<keyof StoreCounts, string | null>> = {
    onLot: `${counts.onLotSourceReported} source-reported`,
    holds: holdsVerified ? null : 'last verified',
  }
  // On a phone the secondary counts fold away so the where list reaches the first viewport (OVERVIEW_SPEC §3).
  const dispositions = counts.dispositions
  const moreCounts = (
    <div className="ov-more-body">
      <dl className="ov-counts ov-counts--more">
        {MORE_COUNTS.map((spec) => <CountLink key={spec.key} store={store} count={counts[spec.key] as number} spec={spec} />)}
      </dl>
      {dispositions ? (
        <div className="ov-card-dispositions">
          <h4>Dispositions <small>{DISPOSITION_QUALIFIER}</small></h4>
          {dispositionsEnabled ? (
            <dl className="ov-counts ov-counts--more">
              {CARD_DISPOSITIONS.map((code) => (
                <CountLink key={code} store={store} count={dispositions[code]}
                  spec={{ key: 'dispositions', label: DISPOSITION_LABELS[code], phrase: `with the disposition ${DISPOSITION_LABELS[code].toLowerCase()}`, href: (target) => inventoryViewHref(target, dispositionView(code)) }} />
              ))}
            </dl>
          ) : <p className="ov-storage-note">{STORAGE_NOT_ENABLED}</p>}
        </div>
      ) : null}
    </div>
  )
  const heading = (
    <>
      <h3 id={titleId}>{store}</h3>
      {otherStore
        ? role === 'group_manager' ? null : <p>Moves as visible to you</p>
        : <p>Home store</p>}
    </>
  )
  const body = (
    <>
      <dl className="ov-counts ov-counts--core">
        {CORE_COUNTS.map((spec) => <CountLink key={spec.key} store={store} count={counts[spec.key] as number} spec={spec} note={notes[spec.key]} />)}
      </dl>
      {collapseMore ? (
        <details className="ov-more">
          <summary>More counts<ChevronDown aria-hidden="true" /></summary>
          {moreCounts}
        </details>
      ) : moreCounts}
      <ReturnVerification rows={rows} store={store} fullAccess={fullAccess} />
    </>
  )
  return (
    <section className={`ov-store-card${otherStore ? '' : ' is-home'}`} aria-labelledby={titleId}>
      {collapseStore ? (
        <details className="ov-store-details">
          <summary>
            <span className="ov-store-summary-title">{heading}</span>
            <span className="ov-store-preview" aria-hidden="true">
              <span>Away <strong>{counts.away}</strong></span>
              <span>Holds <strong>{counts.holds}</strong></span>
              <span>Service <strong>{counts.waitingForService}</strong></span>
            </span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="ov-store-details-body">{body}</div>
        </details>
      ) : <><header>{heading}</header>{body}</>}
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
        <table className="ov-table" aria-labelledby="ov-service-title">
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
      <p className="ov-section-note">Arrival uses verified arrival or public listing dates; listing dates can lag physical receipt. Days listed is listing age, not lot age.</p>
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
    </section>
  )
}

/** Colour means urgency: vehicles not where they should be, then records that disagree, then paperwork. */
const EXCEPTION_TONE: Record<OverviewExceptionKind, 'danger' | 'warning' | 'neutral'> = {
  return_overdue: 'danger',
  stale_confirmation: 'danger',
  location_conflict: 'danger',
  hold_past_expected: 'warning',
  listed_but_delivered: 'warning',
  delivered_move_no_disposition: 'warning',
  source_conflict: 'warning',
  no_app_record: 'warning',
  identity_review: 'neutral',
  service_date_order: 'neutral',
  records_incomplete: 'neutral',
}
const TONE_ORDER = { danger: 0, warning: 1, neutral: 2 } as const

/** One exception type: its explanation once, then one count per store in scope. */
interface ExceptionGroup {
  kind: OverviewExceptionKind
  label: string
  entries: OverviewException[]
}

function exceptionGroups(exceptions: OverviewException[], thresholds: OverviewThresholds): ExceptionGroup[] {
  const groups = new Map<OverviewExceptionKind, ExceptionGroup>()
  for (const exception of exceptions) {
    const label = exception.kind === 'stale_confirmation' ? `Not confirmed for ${thresholds.unaccountedAfterDays}+ days` : EXCEPTION_COPY[exception.kind].label
    const group = groups.get(exception.kind) ?? { kind: exception.kind, label, entries: [] }
    group.entries.push(exception)
    groups.set(exception.kind, group)
  }
  // Stable sort: urgency first, then the server's order.
  return [...groups.values()].sort((left, right) => TONE_ORDER[EXCEPTION_TONE[left.kind]] - TONE_ORDER[EXCEPTION_TONE[right.kind]])
}

function ExceptionsSection({ overview, stores }: { overview: OverviewSummary; stores: StoreName[] }) {
  const groups = exceptionGroups(exceptionRows(overview, stores), overview.thresholds)
  return (
    <section className="ov-section ov-exceptions" aria-labelledby="ov-exceptions-title">
      <header className="ov-section-heading"><h2 id="ov-exceptions-title">Exceptions</h2></header>
      {groups.length ? (
        <div className="ov-exception-groups">
          {groups.map(({ kind, label, entries }) => (
            <div key={kind} className={`ov-exception-group ov-exception-group--${EXCEPTION_TONE[kind]}`}>
              <div className="ov-exception-head">
                <h3 id={`ov-exception-${kind}`}>{label}</h3>
                {kind === 'hold_past_expected' ? <Link className="ov-row-link" to={actionCenterHref('holds')}>Open in Action center</Link> : null}
              </div>
              <p className="ov-exception-why">{EXCEPTION_COPY[kind].why(overview.thresholds)}</p>
              <dl className="ov-counts" aria-labelledby={`ov-exception-${kind}`}>
                {entries.map((exception) => (
                  <div key={exception.store} className={`ov-count${EXCEPTION_TONE[kind] === 'neutral' ? '' : ` ov-tone-${EXCEPTION_TONE[kind]}`}`}>
                    <dt>{exception.store}</dt>
                    <dd><Link to={exceptionHref(exception)} aria-label={`${exception.store}: ${plural(exception.count, 'vehicle')} · ${label}`}>{exception.count}</Link></dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : <p className="ov-empty">No exceptions in this scope.</p>}
    </section>
  )
}

function WhereSection({ rows, stores, holdsVerified, printing, filter, onFilter }: { rows: OverviewRow[]; stores: StoreName[]; holdsVerified: boolean; printing: boolean; filter: WhereFilter; onFilter: (filter: WhereFilter) => void }) {
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
          <button key={entry.value} type="button" aria-pressed={filter === entry.value} onClick={() => { onFilter(entry.value); setShowAll(false) }}>
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
    </section>
  )
}

/**
 * On a wide screen the store board is secondary: it sits at the foot of
 * whichever column of daily lists is shorter (where + exceptions, or
 * dispositions). The board itself is never measured, so the choice cannot
 * feed back on itself; the daily sections never change column.
 */
function useBoardUnderDispositions(columnsRef: RefObject<HTMLElement | null>, active: boolean) {
  const [underDispositions, setUnderDispositions] = useState(false)
  useLayoutEffect(() => {
    const container = columnsRef.current
    if (!active || !container || typeof ResizeObserver === 'undefined') return
    const sections = ['.ov-where', '.ov-exceptions', '.ov-dispositions'].map((selector) => container.querySelector<HTMLElement>(selector))
    const place = () => {
      const [where, exceptions, dispositions] = sections.map((section) => section?.getBoundingClientRect().height ?? 0)
      const gap = Number.parseFloat(getComputedStyle(container).rowGap) || 0
      setUnderDispositions(dispositions < where + gap + exceptions)
    }
    place()
    const observer = new ResizeObserver(place)
    for (const section of sections) if (section) observer.observe(section)
    return () => observer.disconnect()
  }, [columnsRef, active])
  return active && underDispositions
}

interface DispositionRow {
  vehicle: VehicleRecord
  ownerStore: StoreName
  moveDelivered: boolean
}

/** Owner store the server counted the vehicle's disposition under. */
function dispositionOwner(vehicle: VehicleRecord): StoreName {
  return vehicle.appDisposition?.ownerStore ?? vehicle.homeStore
}

/**
 * Vehicles that carry a decision: a recorded disposition, an imported
 * manager-log sale, or a move that recorded delivery. Prompts come first;
 * nothing here is inferred or written — each row only opens the dialog.
 */
function dispositionRows(rows: OverviewRow[], overview: OverviewSummary, stores: readonly StoreName[]): DispositionRow[] {
  const inScope = new Set(stores)
  const moveDelivered = new Set(overview.exceptions.filter((entry) => entry.kind === 'delivered_move_no_disposition').flatMap((entry) => entry.vins))
  const needsDecision = (row: DispositionRow) => !row.vehicle.appDisposition?.code
  return rows
    .map(({ vehicle }) => ({ vehicle, ownerStore: dispositionOwner(vehicle), moveDelivered: moveDelivered.has(vehicle.vin) }))
    .filter((row) => inScope.has(row.ownerStore) && (row.vehicle.appDisposition?.code || row.vehicle.managerDisposition || row.moveDelivered))
    .sort((left, right) => Number(needsDecision(right)) - Number(needsDecision(left)) ||
      (right.vehicle.appDisposition?.updatedAt ?? '').localeCompare(left.vehicle.appDisposition?.updatedAt ?? '', 'en-US') ||
      left.vehicle.vehicleName.localeCompare(right.vehicle.vehicleName, 'en-US'))
}

function DispositionCount({ store, code, count }: { store: StoreName; code: AppDispositionCode | 'none'; count: number }) {
  if (!count) return <span className="ov-zero">0</span>
  const label = code === 'none' ? 'with no disposition recorded' : `with the disposition ${DISPOSITION_LABELS[code].toLowerCase()}`
  return <Link to={inventoryViewHref(store, dispositionView(code))} aria-label={`${store}: ${plural(count, 'vehicle')} ${label}`}>{count}</Link>
}

function DispositionsSection({ overview, rows, stores, status, enabled, onOpen }: {
  overview: OverviewSummary
  rows: OverviewRow[]
  stores: StoreName[]
  status: string
  /** False on a database without the disposition table: say so, never show zeros. */
  enabled: boolean
  onOpen: (vin: string, opener: HTMLElement) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const entries = useMemo(() => dispositionRows(rows, overview, stores), [rows, overview, stores])
  const visible = showAll ? entries : entries.slice(0, DISPOSITION_ROWS)
  const storeCounts = storeCards(overview, stores)
  return (
    <section className="ov-section ov-dispositions" aria-labelledby="ov-dispositions-title">
      <header className="ov-section-heading">
        <h2 id="ov-dispositions-title">Dispositions</h2>
        <p className="ov-section-note">{DISPOSITION_QUALIFIER}</p>
      </header>
      {enabled ? null : (
        <p className="ov-storage-note" role="status">{STORAGE_NOT_ENABLED} No disposition can be recorded or shown until it is; the manager log below is unchanged.</p>
      )}
      {enabled ? <div className="ov-table-wrap">
        <table className="ov-table ov-disposition-table" aria-labelledby="ov-dispositions-title">
          <thead>
            <tr>
              <th scope="col">Store</th>
              {TABLE_DISPOSITIONS.map((code) => <th key={code} scope="col">{code === 'none' ? 'None recorded' : DISPOSITION_LABELS[code]}</th>)}
            </tr>
          </thead>
          <tbody>
            {storeCounts.map((counts) => (
              <tr key={counts.store}>
                <th scope="row">{counts.store}</th>
                {TABLE_DISPOSITIONS.map((code) => (
                  <td key={code} data-label={code === 'none' ? 'None recorded' : DISPOSITION_LABELS[code]}>
                    <DispositionCount store={counts.store} code={code} count={counts.dispositions?.[code] ?? 0} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div> : null}
      {status ? <p className="ov-status" role="status">{status}</p> : null}
      <h3 className="ov-subheading">Decisions and evidence</h3>
      {visible.length ? (
        <ul className="ov-rows">
          {visible.map(({ vehicle, ownerStore, moveDelivered }) => {
            const disposition = vehicle.appDisposition
            const evidence = managerLogLine(vehicle.managerDisposition)
            const action = !enabled ? null : disposition?.canManage
              ? disposition.code ? 'Change disposition' : 'Record disposition'
              : disposition?.code ? 'View disposition' : null
            return (
              <li key={vehicle.vin} className="ov-row">
                <div className="ov-row-main">
                  <strong>{vehicle.vehicleName}</strong>
                  <span className="ov-row-meta">#{vehicle.stockNumber} · {ownerStore}</span>
                  <span className="ov-row-details">
                    <span>{dispositionSummary(disposition)}{disposition?.effectiveDate ? ` · effective ${formatDate(disposition.effectiveDate)}` : ''}</span>
                    {evidence ? <span className="ov-row-evidence"><ClipboardCheck aria-hidden="true" />{evidence}</span> : null}
                    {moveDelivered ? <span className="ov-tone-warning">A move records customer delivery</span> : null}
                  </span>
                </div>
                <div className="ov-row-actions">
                  {action ? <button type="button" className="ov-row-link" aria-label={`${action} for ${vehicle.vehicleName}`} onClick={(event) => onOpen(vehicle.vin, event.currentTarget)}>{action}</button> : null}
                  <RecordsLink vin={vehicle.vin} facts={overview.vehicleFacts[vehicle.vin]} name={vehicle.vehicleName} />
                </div>
              </li>
            )
          })}
        </ul>
      ) : <p className="ov-empty">No dispositions or manager-log sales in this scope.</p>}
      {entries.length > DISPOSITION_ROWS && !showAll ? <button type="button" className="ov-button ov-show-all" onClick={() => setShowAll(true)}>Show all {entries.length}</button> : null}
    </section>
  )
}

export function OverviewPage() {
  const { data, homeStore, role, currentUser, refresh } = useAppData()
  const accessContext = `${currentUser}:${role}:${homeStore}`
  const [scope, setScope] = useWorkspaceState<OverviewScope>(accessContext, 'overview.scope', role === 'group_manager' ? 'group' : 'home')
  const [serviceReport, setServiceReport] = useState(false)
  const [printing, setPrinting] = useState(false)
  // One filter drives the where list and the store board's pin numbers.
  const [whereFilter, setWhereFilter] = useState<WhereFilter>('away')
  const [dispositionVin, setDispositionVin] = useState<string | null>(null)
  const [dispositionStatus, setDispositionStatus] = useState('')
  // Focus returns to the exact row button that opened the dialog (Safari
  // does not focus a clicked button, so the dialog cannot rely on activeElement).
  const dispositionOpener = useRef<HTMLElement | null>(null)
  const phone = useSyncExternalStore(PHONE.subscribe, PHONE.matches, () => false)
  const wide = useSyncExternalStore(WIDE.subscribe, WIDE.matches, () => false)
  const columnsRef = useRef<HTMLDivElement>(null)
  const boardUnderDispositions = useBoardUnderDispositions(columnsRef, wide && !printing && Boolean(data?.overview))
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
  const dispositionsEnabled = data.dispositionsEnabled !== false
  const dispositionVehicle = dispositionVin ? data.vehicles.find((vehicle) => vehicle.vin === dispositionVin) ?? null : null
  const holdsVerified = data.meta.dealerMailFreshness === 'current'
  const scopeLabel = scope === 'home' ? homeStore : 'All stores'
  const roleLabel = ROLE_LABELS[role] ?? role
  const managerLog = data.meta.managerDispositionFreshness && data.meta.managerDispositionFreshness !== 'current'
    ? ` · Manager log ${freshnessWord(data.meta.managerDispositionFreshness).toLowerCase()}` : ''
  const asOf = `As of ${formatDate(overview.asOfDay)} · Holds ${freshnessWord(data.meta.dealerMailFreshness).toLowerCase()} · Website ${freshnessWord(data.meta.publicFreshness).toLowerCase()}${managerLog}`
  const scopedIssues = (data.vehicleIssues ?? []).filter((issue) => stores.includes(issue.reportStore))
  const openIssueCount = scopedIssues.filter((issue) => issue.status !== 'completed').length
  const reviewIssueCount = scopedIssues.filter((issue) => issue.status === 'awaiting_review').length
  const urgentIssueCount = scopedIssues.filter((issue) => issue.status !== 'completed' && issue.priority === 'urgent').length

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

  const where = <WhereSection key="where" rows={rows} stores={stores} holdsVerified={holdsVerified} printing={printing} filter={whereFilter} onFilter={setWhereFilter} />
  const board = <StoreBoard key="board" overview={overview} homeStore={homeStore} role={role} metric={whereFilter} collapsible={phone && !printing} />
  const exceptions = <ExceptionsSection key="exceptions" overview={overview} stores={stores} />
  const dispositions = (
    <DispositionsSection key="dispositions" overview={overview} rows={rows} stores={stores} status={dispositionStatus} enabled={dispositionsEnabled}
      onOpen={(vin, opener) => { dispositionOpener.current = opener; setDispositionStatus(''); setDispositionVin(vin) }} />
  )
  // A wide screen keeps the daily lists in fixed columns (where and
  // exceptions; dispositions) and puts the compact store board at the foot of
  // the shorter one. Narrower screens and print stack the two wrappers as one
  // column in phone reading order: where, board, exceptions, dispositions.
  // Where and dispositions keep their wrapper and key in every layout, so
  // their show-all state survives a switch.
  const columns = !wide || printing ? [[where, board], [exceptions, dispositions]]
    : boardUnderDispositions ? [[where, exceptions], [dispositions, board]] : [[where, exceptions, board], [dispositions]]

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

      <section className="ov-issue-entry" aria-label="Vehicle issues summary">
        <div className="ov-issue-title"><ClipboardCheck aria-hidden="true" /><div><h2>Vehicle issues</h2><p>Reported by employees in this scope</p></div></div>
        <dl className="ov-issue-counts">
          <div><dt>Open</dt><dd>{openIssueCount}</dd></div>
          <div><dt>Awaiting review</dt><dd>{reviewIssueCount}</dd></div>
          <div className={urgentIssueCount ? 'ov-tone-danger' : undefined}><dt>Urgent</dt><dd>{urgentIssueCount}</dd></div>
        </dl>
        <Link className="ov-button" to={`/attention?category=issues&scope=${scope}`}><ClipboardCheck aria-hidden="true"/>Vehicle issue log</Link>
      </section>

      <section className={`ov-stores${stores.length === 1 ? ' ov-stores--single' : ''}`} aria-label="Store summary">
        {storeCards(overview, stores).map((counts) => (
          <StoreCard key={counts.store} counts={counts} homeStore={homeStore} role={role} rows={rows} fullAccess={fullAccess} holdsVerified={holdsVerified} collapseMore={!printing} collapseStore={phone && stores.length > 1 && !printing} dispositionsEnabled={dispositionsEnabled} />
        ))}
      </section>

      <div className="ov-columns" ref={columnsRef}>
        {columns.map((sections, index) => <div key={index} className="ov-column">{sections}</div>)}
      </div>

      <ServiceSection data={data} overview={overview} stores={stores} fullAccess={fullAccess} reportMode={serviceReport} onReport={printServiceReport} />

      <footer className="ov-print-only ov-print-footer">Counts are app records and source evidence as of the times shown. Nothing here asserts availability; confirm holds and location with the home store.</footer>
      {dispositionVehicle ? (
        <DispositionDialog
          vehicle={{ vin: dispositionVehicle.vin, name: dispositionVehicle.vehicleName, stockNumber: dispositionVehicle.stockNumber }}
          disposition={dispositionVehicle.appDisposition}
          evidence={dispositionVehicle.managerDisposition}
          role={role}
          store={homeStore}
          defaultDate={defaultDispositionDate(dispositionVehicle.vin, data.meta.reportDate)}
          returnFocusRef={dispositionOpener}
          onClose={() => setDispositionVin(null)}
          onSaved={async (saved) => {
            setDispositionVin(null)
            setDispositionStatus(`${dispositionSummary(saved)} recorded for #${dispositionVehicle.stockNumber}.`)
            await refresh()
          }}
        />
      ) : null}
    </section>
  )
}
