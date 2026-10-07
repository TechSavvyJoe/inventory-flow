import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, ChevronRight, ClipboardCheck, FileText, MapPin, Printer, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { SourceWarning } from '../../components/SourceWarning'
import { VehicleThumbnail } from '../../components/VehicleThumbnail'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '../../lib/format'
import { vehicleWorkspacePath } from '../../lib/inventory-navigation'
import { useWorkspaceState } from '../../lib/workspace-memory'
import { STORE_NAMES } from '../../types'
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
  VehicleIssue,
  VehicleRecord,
} from '../../types'
import { ISSUE_CATEGORIES, ISSUE_STATUSES } from '../issues/issue-model'
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
import { SalesOverview } from './SalesOverview'
import { defaultDispositionDate, DISPOSITION_LABELS, DISPOSITION_QUALIFIER, dispositionSummary, managerLogLine } from './disposition-model'
import './overview.css'

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  group_manager: 'Group manager',
  manager: 'Store manager',
  sales: 'Salesperson',
}

const PHONE_ROWS = 5
const AGED_ROWS = 3
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
  records_incomplete: { label: 'Records not all captured', why: () => 'Current records are incomplete: AutoCheck and sticker, plus OASIS, invoice and service history for Ford/Lincoln, or factory equipment for other makes.' },
  service_date_order: { label: 'Service dates before arrival', why: () => 'A recorded service date is earlier than the arrival date; check the record.' },
  listed_but_delivered: { label: 'Recorded delivered · still listed', why: (thresholds) => `Delivered in Inventory Flow ${thresholds.listedAfterDeliveredDays}+ days ago and still listed on the website. Confirm with the store; the listing is not changed here.` },
  delivered_move_no_disposition: { label: 'Move says delivered · no disposition', why: () => 'A move records customer delivery; no disposition has been recorded.' },
}

/** Store-card disposition counts, most decision-relevant first (OVERVIEW_SPEC §3). */
const CARD_DISPOSITIONS: AppDispositionCode[] = ['sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other']
const TABLE_DISPOSITIONS: Array<AppDispositionCode | 'none'> = ['sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other', 'keep', 'none']
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
  return `${value} days · ${plural(metric.n, 'vehicle')}`
}

function intakeShare(metrics: OverviewServiceStoreMetrics): string {
  const total = metrics.arrivalBasis.intake + metrics.arrivalBasis.listing_date + metrics.arrivalBasis.unknown
  return total ? `${Math.round((metrics.arrivalBasis.intake / total) * 100)}%` : '—'
}

function ServiceCount({ count, status, store, label }: { count: number; status: 'needs_service' | 'in_service' | 'serviced'; store?: StoreName; label: string }) {
  if (!count) return <span className="ov-zero">0</span>
  return <Link to={serviceStatusHref(status, store)} aria-label={`${store ?? 'All stores'}: ${plural(count, 'vehicle')} ${label}`}>{count}</Link>
}

function ServiceWorkloadRow({ metrics, store, thresholds }: { metrics: OverviewServiceStoreMetrics; store?: StoreName; thresholds: readonly number[] }) {
  return (
    <tr className={store ? undefined : 'ov-service-group'}>
      <th scope="row">{store ?? 'All stores'}</th>
      <td data-label="Waiting"><ServiceCount count={metrics.counts.waitingForService} status="needs_service" store={store} label="waiting for service" /></td>
      <td data-label="In service"><ServiceCount count={metrics.counts.inService} status="in_service" store={store} label="in service" /></td>
      <td data-label="Ready"><ServiceCount count={metrics.counts.ready} status="serviced" store={store} label="ready" /></td>
      <td data-label={`Waiting ${thresholds[0]}+ days`} className={metrics.agedWaiting14 ? 'ov-tone-warning' : 'ov-service-muted'}>{metrics.agedWaiting14}</td>
      <td data-label={`Waiting ${thresholds[1]}+ days`} className={metrics.agedWaiting30 ? 'ov-tone-danger' : 'ov-service-muted'}>{metrics.agedWaiting30}</td>
    </tr>
  )
}

function ServiceTimingRow({ metrics, store, thresholds }: { metrics: OverviewServiceStoreMetrics; store?: StoreName; thresholds: readonly number[] }) {
  return (
    <tr className={store ? undefined : 'ov-service-group'}>
      <th scope="row">{store ?? 'All stores'}</th>
      <td data-label="Arrival to service start">{median(metrics.medians.receiptToStartDays)}</td>
      <td data-label="Time in service">{median(metrics.medians.inServiceDays)}</td>
      <td data-label="Arrival to ready">{median(metrics.medians.receiptToReadyDays)}</td>
      <td data-label="Arrival dates from intake">{intakeShare(metrics)}</td>
      <td data-label={`Waiting ${thresholds[0]}+ days`}>{metrics.agedWaiting14}</td>
      <td data-label={`Waiting ${thresholds[1]}+ days`}>{metrics.agedWaiting30}</td>
    </tr>
  )
}

function serviceActionAllowed(vehicle: VehicleRecord | undefined, fallbackStore: StoreName | null | undefined, role: UserRole, homeStore: StoreName) {
  const serverDecision = vehicle?.serviceReadiness?.canManage
  if (serverDecision === true) return true
  if (serverDecision === false) return false
  if (role === 'group_manager') return true
  if (role !== 'manager') return false
  const movementStore = vehicle?.movement.locationConfidence === 'verified' && STORE_NAMES.includes(vehicle.movement.currentLocation as StoreName)
    ? vehicle.movement.currentLocation as StoreName
    : null
  const ownerStore = vehicle?.serviceReadiness?.store ?? movementStore ?? vehicle?.homeStore ?? fallbackStore
  return ownerStore != null && ownerStore === homeStore
}

function ServiceSection({ data, overview, stores, role, homeStore, reportMode, printing, onReport }: { data: BootstrapData; overview: OverviewSummary; stores: StoreName[]; role: UserRole; homeStore: StoreName; reportMode: boolean; printing: boolean; onReport: () => void }) {
  const service = overview.service
  const [showAllAged, setShowAllAged] = useState(false)
  const [showTiming, setShowTiming] = useState(false)
  if (!service) return null
  const perStore = stores.flatMap((store) => service.perStore.filter((entry) => entry.store === store))
  const basis = stores.length === 1 ? perStore[0]?.basis ?? service.group.basis : service.group.basis
  const aged = agedWaitingRows(data, overview, stores).sort((left, right) => right.waitingDays - left.waitingDays)
  const visibleAged = printing || reportMode || showAllAged ? aged : aged.slice(0, AGED_ROWS)
  const [waitingFrom, waitingLong] = overview.thresholds.serviceWaitingDays
  const timingExpanded = printing || reportMode || showTiming
  const scopeMetrics = stores.length === 1 ? perStore[0] : service.group
  return (
    <section className={`ov-section ov-service${reportMode ? ' is-report' : ''}`} aria-labelledby="ov-service-title">
      <header className="ov-section-heading">
        <h2 id="ov-service-title">Service</h2>
        <button type="button" className="ov-button" onClick={onReport}><Printer aria-hidden="true" />Open report</button>
      </header>
      <div className="ov-service-layout">
      <div className="ov-service-workload">
        <div className="ov-service-aged-summary" aria-label="Long service waits">
          <span><strong>{scopeMetrics?.agedWaiting14 ?? 0}</strong> waiting {waitingFrom}+ days</span>
          <span><strong>{scopeMetrics?.agedWaiting30 ?? 0}</strong> waiting {waitingLong}+ days</span>
        </div>
        <table className="ov-table ov-service-counts" aria-label="Service workload">
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col">Waiting</th>
              <th scope="col">In service</th>
              <th scope="col">Ready</th>
              <th scope="col">Waiting <br />{waitingFrom}+ days</th>
              <th scope="col">Waiting <br />{waitingLong}+ days</th>
            </tr>
          </thead>
          <tbody>
            {perStore.map((entry) => <ServiceWorkloadRow key={entry.store} metrics={entry} store={entry.store} thresholds={overview.thresholds.serviceWaitingDays} />)}
            {stores.length > 1 ? <ServiceWorkloadRow metrics={service.group} thresholds={overview.thresholds.serviceWaitingDays} /> : null}
          </tbody>
        </table>
        <p className="ov-section-note">Counts reflect recorded service status. {waitingLong}+ days is included in {waitingFrom}+ days.</p>
      </div>
      <div className="ov-service-priority">
      <header className="ov-service-priority-heading"><h3 className="ov-subheading">Longest waiting</h3><span>{plural(aged.length, 'vehicle')} · {waitingFrom}+ days</span></header>
      {aged.length ? (
        <ul className="ov-rows">
          {visibleAged.map((entry) => {
            const name = entry.vehicle?.vehicleName ?? entry.vin
            return (
              <li key={entry.vin} className="ov-row ov-service-vehicle">
                <VehicleThumbnail vehicle={entry.vehicle} className="ov-service-photo" />
                <div className="ov-row-main">
                  <strong>{name}</strong>
                  <span className="ov-row-meta">{entry.vehicle ? `Stock ${entry.vehicle.stockNumber} · ` : ''}{entry.store ?? 'Service store not set'}{entry.vehicle?.mileage != null ? ` · ${formatNumber(entry.vehicle.mileage)} mi` : ''}</span>
                  <span className={`ov-service-wait${entry.waitingDays >= waitingLong ? ' ov-tone-danger' : ' ov-tone-warning'}`}>Waiting {plural(entry.waitingDays, 'day')}<span>{entry.arrivalBasis === 'intake' ? 'From recorded arrival' : entry.arrivalBasis === 'listing_date' ? 'From listing date; arrival unconfirmed' : 'Arrival date unconfirmed'}</span></span>
                </div>
                <div className="ov-row-actions">
                  <RecordsLink vin={entry.vin} facts={entry.facts} name={name} />
                  {serviceActionAllowed(entry.vehicle, entry.store, role, homeStore) ? <Link className="ov-row-link" to={serviceVehicleHref(entry.vin)} aria-label={`Update service for ${name}`}><Wrench aria-hidden="true" />Update service</Link> : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : <p className="ov-empty">No vehicles waiting {waitingFrom}+ days in this scope.</p>}
      {aged.length > AGED_ROWS && !reportMode ? (
        <div className="ov-show-all">
          {showAllAged ? null : <button type="button" className="ov-button" onClick={() => setShowAllAged(true)}>Show all {aged.length}</button>}
          <Link className="ov-row-link" to={serviceStatusHref('needs_service', stores.length === 1 ? stores[0] : undefined)}>Open Waiting for service</Link>
        </div>
      ) : null}
      </div>
      </div>
      <div className="ov-service-details">
        <button type="button" className="ov-service-disclosure" aria-expanded={timingExpanded} aria-controls="ov-service-timing" onClick={() => setShowTiming(!showTiming)}><span>Service timing &amp; evidence</span><ChevronDown aria-hidden="true" /></button>
        {timingExpanded ? <div id="ov-service-timing" className="ov-service-timing">
          <p className="ov-section-note">Median days, with the number of vehicles used in each calculation. A dash means no complete dates are recorded.</p>
          <div className="ov-table-wrap"><table className="ov-table" aria-label="Service timing & evidence">
            <thead><tr><th scope="col">Store</th><th scope="col">Arrival to service start</th><th scope="col">Time in service</th><th scope="col">Arrival to ready</th><th scope="col">Arrival dates from intake</th><th scope="col">Waiting {waitingFrom}+ days</th><th scope="col">Waiting {waitingLong}+ days</th></tr></thead>
            <tbody>{perStore.map((entry) => <ServiceTimingRow key={entry.store} metrics={entry} store={entry.store} thresholds={overview.thresholds.serviceWaitingDays} />)}{stores.length > 1 ? <ServiceTimingRow metrics={service.group} thresholds={overview.thresholds.serviceWaitingDays} /> : null}</tbody>
          </table></div>
          <p className="ov-section-note">Arrival uses verified arrival or public listing dates; listing dates can lag physical receipt. Days listed is listing age, not lot age.</p>
          <dl className="ov-service-basis">
            {[[ 'Manager-recorded', basis.manager_updated ], [ 'Ford service inspection', basis.ford_service_history_inspection ], [ 'AutoCheck inspection', basis.autocheck_post_intake_inspection ], [ 'New arrival', basis.new_arrival ], [ 'Unconfirmed', basis.unconfirmed ], [ 'Legacy review', basis.legacy_review ]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
          </dl>
        </div> : null}
      </div>
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

type WorkQueueView = 'issues' | 'location' | 'service' | 'holds' | 'exceptions' | 'dispositions'

const WORK_QUEUE_VIEWS: Array<{ value: WorkQueueView; label: string }> = [
  { value: 'issues', label: 'Vehicle issues' },
  { value: 'location', label: 'Location & moves' },
  { value: 'service', label: 'Service' },
  { value: 'holds', label: 'Hold evidence' },
  { value: 'exceptions', label: 'Exceptions' },
  { value: 'dispositions', label: 'Dispositions' },
]

const WORK_QUEUE_ROWS = 4

function VehicleValue({ vehicle }: { vehicle?: VehicleRecord }) {
  if (!vehicle) return null
  const values = [
    vehicle.listedPrice != null ? formatCurrency(vehicle.listedPrice) : null,
    vehicle.mileage != null ? `${formatNumber(vehicle.mileage)} mi` : null,
    vehicle.daysListed != null ? `${plural(vehicle.daysListed, 'day')} listed` : null,
  ].filter(Boolean)
  return values.length ? <span className="ov-work-value">{values.join(' · ')}</span> : null
}

function WorkQueueRow({ vehicle, fallbackName, stockNumber, work, detail, owner, status, tone, actionLabel, actionHref, onAction, showVehicleLink = true }: {
  vehicle?: VehicleRecord
  fallbackName: string
  stockNumber?: string
  work: string
  detail: string
  owner: string
  status: string
  tone?: Tone
  actionLabel: string
  actionHref?: string
  onAction?: (opener: HTMLElement) => void
  showVehicleLink?: boolean
}) {
  const name = vehicle?.vehicleName ?? fallbackName
  const stock = vehicle?.stockNumber ?? stockNumber
  return (
    <li className="ov-work-row">
      <div className="ov-work-vehicle">
        <VehicleThumbnail vehicle={vehicle} className="ov-work-photo" />
        <div>
          <strong>{name}</strong>
          {stock ? <span>Stock {stock}</span> : null}
          <VehicleValue vehicle={vehicle} />
        </div>
      </div>
      <div className="ov-work-detail">
        <strong>{work}</strong>
        <p>{detail}</p>
      </div>
      <div className="ov-work-owner">
        <span>Owner / status</span>
        <strong>{owner}</strong>
        <small className={tone ? `ov-tone-${tone}` : undefined}>{status}</small>
      </div>
      <div className="ov-work-actions">
        {actionHref ? <Link className="ov-work-primary" to={actionHref}>{actionLabel}<ChevronRight aria-hidden="true" /></Link> : null}
        {onAction ? <button type="button" className="ov-work-primary" onClick={(event) => onAction(event.currentTarget)}>{actionLabel}<ChevronRight aria-hidden="true" /></button> : null}
        {showVehicleLink && vehicle ? <Link className="ov-work-secondary" to={vehicleWorkspacePath(vehicle.vin, { returnTo: '/overview' })}>Vehicle details</Link> : null}
      </div>
    </li>
  )
}

function issueAction(issue: VehicleIssue, enabled: boolean): { label: string; href: string } {
  const canReview = enabled && issue.status === 'awaiting_review' && issue.allowedActions.includes('complete')
  const canManage = enabled && issue.allowedActions.length > 0
  const label = canReview ? 'Review work' : canManage ? 'Manage issue' : 'View issue'
  const params = new URLSearchParams({ category: 'issues', issue: issue.id })
  if (canReview) params.set('action', 'complete')
  return { label, href: `/attention?${params.toString()}` }
}

function OverviewWorkQueue({ data, overview, rows, stores, scope, role, homeStore, holdsVerified, dispositionsEnabled, onDispositionOpen }: {
  data: BootstrapData
  overview: OverviewSummary
  rows: OverviewRow[]
  stores: StoreName[]
  scope: OverviewScope
  role: UserRole
  homeStore: StoreName
  holdsVerified: boolean
  dispositionsEnabled: boolean
  onDispositionOpen: (vin: string, opener: HTMLElement) => void
}) {
  const vehicles = useMemo(() => new Map(data.vehicles.map((vehicle) => [vehicle.vin, vehicle])), [data.vehicles])
  const issues = useMemo(() => (data.vehicleIssues ?? [])
    .filter((issue) => stores.includes(issue.reportStore) && issue.status !== 'completed')
    .sort((left, right) => Number(right.priority === 'urgent') - Number(left.priority === 'urgent') ||
      Number(right.status === 'awaiting_review') - Number(left.status === 'awaiting_review') ||
      right.updatedAt.localeCompare(left.updatedAt, 'en-US')), [data.vehicleIssues, stores])
  const locations = useMemo(() => whereRows(rows, 'unaccounted', stores), [rows, stores])
  const service = useMemo(() => whereRows(rows, 'waiting', stores), [rows, stores])
  const holds = useMemo(() => whereRows(rows, 'holds', stores), [rows, stores])
  const exceptions = useMemo(() => exceptionRows(overview, stores), [overview, stores])
  const dispositions = useMemo(() => dispositionRows(rows, overview, stores), [rows, overview, stores])
  const queueCounts: Record<WorkQueueView, number> = {
    issues: issues.length,
    location: locations.length,
    service: service.length,
    holds: holds.length,
    exceptions: exceptions.reduce((total, exception) => total + exception.count, 0),
    dispositions: dispositions.length,
  }
  const [view, setView] = useState<WorkQueueView>(() => WORK_QUEUE_VIEWS.find((entry) => queueCounts[entry.value] > 0)?.value ?? 'issues')

  let content: ReactNode
  if (view === 'issues') {
    content = issues.slice(0, WORK_QUEUE_ROWS).map((issue) => {
      const action = issueAction(issue, data.vehicleIssuesEnabled === true)
      return <WorkQueueRow key={issue.id} vehicle={vehicles.get(issue.vin)} fallbackName={issue.vehicleName} stockNumber={issue.stockNumber}
        work={`${ISSUE_CATEGORIES[issue.category]}${issue.priority === 'urgent' ? ' · Urgent' : ''}`} detail={issue.description}
        owner={issue.assignee ?? 'Unassigned'} status={`${ISSUE_STATUSES[issue.status]} · updated ${formatDateTime(issue.updatedAt)}`}
        tone={issue.priority === 'urgent' ? 'danger' : undefined} actionLabel={action.label} actionHref={`${action.href}&scope=${scope}`} />
    })
  } else if (view === 'location') {
    content = locations.slice(0, WORK_QUEUE_ROWS).map(({ vehicle, facts }) => {
      const reason = facts.unaccounted ? UNACCOUNTED_TEXT[facts.unaccounted.reason] : custodyText(facts)
      const detail = [custodyText(facts), daysAwayText(facts), facts.returnDueAt ? `Return due ${formatDate(facts.returnDueAt)}` : null].filter(Boolean).join(' · ')
      const transferId = vehicle.movement.transferId
      return <WorkQueueRow key={vehicle.vin} vehicle={vehicle} fallbackName={vehicle.vehicleName} work={reason} detail={detail}
        owner={`Home ${vehicle.homeStore}`} status={facts.returnOverdue ? 'Return overdue' : 'Location needs confirmation'} tone={facts.returnOverdue ? 'danger' : 'warning'}
        actionLabel={transferId ? 'Open move' : 'Check location'} actionHref={locationHref(vehicle.vin, transferId)} />
    })
  } else if (view === 'service') {
    content = service.slice(0, WORK_QUEUE_ROWS).map(({ vehicle, facts }) => (
      <WorkQueueRow key={vehicle.vin} vehicle={vehicle} fallbackName={vehicle.vehicleName} work="Waiting for service"
        detail={[facts.service.waitingDays !== undefined ? `Waiting ${plural(facts.service.waitingDays, 'day')}` : null, arrivalText(facts.service)].filter(Boolean).join(' · ') || 'Arrival timing not recorded'}
        owner={facts.service.store ?? vehicle.homeStore} status={facts.service.waitingDays !== undefined ? `${plural(facts.service.waitingDays, 'day')} waiting` : 'Waiting time not recorded'}
        tone={facts.service.waitingDays !== undefined && facts.service.waitingDays >= overview.thresholds.serviceWaitingDays[1] ? 'danger' : undefined}
        actionLabel={serviceActionAllowed(vehicle, facts.service.store, role, homeStore) ? 'Update service' : 'View service'} actionHref={serviceVehicleHref(vehicle.vin)} />
    ))
  } else if (view === 'holds') {
    content = holds.slice(0, WORK_QUEUE_ROWS).map(({ vehicle, facts }) => (
      <WorkQueueRow key={vehicle.vin} vehicle={vehicle} fallbackName={vehicle.vehicleName} work={vehicle.hold.label}
        detail={`${holdsVerified ? 'Current' : 'Last-verified'} DealerMail evidence · confirm with the home store`}
        owner={vehicle.crmStore ?? vehicle.homeStore} status={facts.holdPastExpected ? 'Past expected date' : 'Hold evidence recorded'} tone={facts.holdPastExpected ? 'warning' : undefined}
        actionLabel="Open hold evidence" actionHref={vehicleWorkspacePath(vehicle.vin, { tab: 'hold', returnTo: '/overview' })} />
    ))
  } else if (view === 'exceptions') {
    content = exceptions.slice(0, WORK_QUEUE_ROWS).map((exception) => {
      const vehicle = exception.vins.map((vin) => vehicles.get(vin)).find((candidate): candidate is VehicleRecord => Boolean(candidate))
      const exceptionTone = EXCEPTION_TONE[exception.kind]
      const label = exception.kind === 'stale_confirmation' ? `Not confirmed for ${overview.thresholds.unaccountedAfterDays}+ days` : EXCEPTION_COPY[exception.kind].label
      return <WorkQueueRow key={`${exception.kind}:${exception.store}`} vehicle={vehicle} fallbackName={`${exception.store} inventory`} work={label}
        detail={EXCEPTION_COPY[exception.kind].why(overview.thresholds)} owner={exception.store} status={plural(exception.count, 'vehicle')}
        tone={exceptionTone === 'neutral' ? undefined : exceptionTone}
        actionLabel={`Review ${plural(exception.count, 'vehicle')}`} actionHref={exceptionHref(exception)} showVehicleLink={Boolean(vehicle)} />
    })
  } else {
    content = dispositions.slice(0, WORK_QUEUE_ROWS).map(({ vehicle, ownerStore, moveDelivered }) => {
      const disposition = vehicle.appDisposition
      const evidence = managerLogLine(vehicle.managerDisposition)
      const action = !dispositionsEnabled ? null : disposition?.canManage
        ? disposition.code ? 'Change disposition' : 'Record disposition'
        : disposition?.code ? 'View disposition' : null
      return <WorkQueueRow key={vehicle.vin} vehicle={vehicle} fallbackName={vehicle.vehicleName} work={dispositionSummary(disposition)}
        detail={evidence ?? (moveDelivered ? 'A move records customer delivery; no disposition has been recorded.' : DISPOSITION_QUALIFIER)}
        owner={`${ownerStore} manager`} status={moveDelivered ? 'Delivery evidence needs review' : disposition?.code ? `Effective ${formatDate(disposition.effectiveDate ?? undefined)}` : 'Decision not recorded'}
        tone={moveDelivered ? 'warning' : undefined} actionLabel={action ?? 'Open vehicle'}
        onAction={action ? (opener) => onDispositionOpen(vehicle.vin, opener) : undefined}
        actionHref={action ? undefined : vehicleWorkspacePath(vehicle.vin, { returnTo: '/overview' })} showVehicleLink={Boolean(action)} />
    })
  }

  return (
    <section className="ov-work-queue" aria-labelledby="ov-work-title">
      <header className="ov-work-heading">
        <div><h2 id="ov-work-title">Work queue</h2><p>Vehicle-level work and evidence in this scope.</p></div>
        <Link className="ov-button" to={`/attention?${view === 'issues' ? 'category=issues&' : ''}scope=${scope}`}>{view === 'issues' ? 'Vehicle issue log' : 'Open Action center'}<ChevronRight aria-hidden="true" /></Link>
      </header>
      <div className="ov-work-tabs" role="group" aria-label="Overview work queue">
        {WORK_QUEUE_VIEWS.map((entry) => <button key={entry.value} type="button" aria-label={`${entry.label} ${queueCounts[entry.value]}`} aria-pressed={view === entry.value} onClick={() => setView(entry.value)}>{entry.label}<span>{queueCounts[entry.value]}</span></button>)}
      </div>
      <div className="ov-work-columns" aria-hidden="true"><span>Vehicle / value</span><span>Work</span><span>Owner / status</span><span>Next action</span></div>
      {queueCounts[view] ? <ul className="ov-work-rows">{content}</ul> : <p className="ov-work-empty">No {WORK_QUEUE_VIEWS.find((entry) => entry.value === view)!.label.toLowerCase()} in this scope.</p>}
      {queueCounts[view] > WORK_QUEUE_ROWS ? <p className="ov-work-more">Showing {WORK_QUEUE_ROWS} of {queueCounts[view]} items. Open the full ledger from the row action or section below.</p> : null}
    </section>
  )
}

export function OverviewPage() {
  const { data, homeStore, role, currentUser, currentUserId, refresh } = useAppData()
  const accessContext = JSON.stringify([currentUserId, currentUser, role, homeStore])
  const [presentationChoice, setPresentationChoice] = useState<{ context: string; value: 'sales' | 'operations' } | null>(null)
  // An employee or role change gets its own default before the first render;
  // a previous employee's presentation choice never carries across identities.
  const presentation = presentationChoice?.context === accessContext ? presentationChoice.value : role === 'sales' ? 'sales' : 'operations'
  const [scope, setScope] = useWorkspaceState<OverviewScope>(accessContext, 'overview.scope', role === 'group_manager' ? 'group' : 'home')
  const [serviceReport, setServiceReport] = useState(false)
  const [printing, setPrinting] = useState(false)
  // The filter drives the operational location ledger below the work queue.
  const [whereFilter, setWhereFilter] = useState<WhereFilter>('away')
  const [dispositionVin, setDispositionVin] = useState<string | null>(null)
  const [dispositionStatus, setDispositionStatus] = useState('')
  // Focus returns to the exact row button that opened the dialog (Safari
  // does not focus a clicked button, so the dialog cannot rely on activeElement).
  const dispositionOpener = useRef<HTMLElement | null>(null)
  const phone = useSyncExternalStore(PHONE.subscribe, PHONE.matches, () => false)
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
  const exceptions = <ExceptionsSection key="exceptions" overview={overview} stores={stores} />
  const dispositions = (
    <DispositionsSection key="dispositions" overview={overview} rows={rows} stores={stores} status={dispositionStatus} enabled={dispositionsEnabled}
      onOpen={(vin, opener) => { dispositionOpener.current = opener; setDispositionStatus(''); setDispositionVin(vin) }} />
  )
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

      <div className="ov-scope" role="group" aria-label="Overview presentation">
        <button type="button" aria-pressed={presentation === 'sales'} onClick={() => setPresentationChoice({ context: accessContext, value: 'sales' })}>Sales workspace</button>
        <button type="button" aria-pressed={presentation === 'operations'} onClick={() => setPresentationChoice({ context: accessContext, value: 'operations' })}>Store operations</button>
      </div>

      {presentation === 'sales' ? <SalesOverview data={data} stores={stores} homeStore={homeStore} role={role} currentUserId={currentUserId ?? null} printing={printing} /> : <>
      <OverviewWorkQueue data={data} overview={overview} rows={rows} stores={stores} scope={scope} role={role} homeStore={homeStore}
        holdsVerified={holdsVerified} dispositionsEnabled={dispositionsEnabled}
        onDispositionOpen={(vin, opener) => { dispositionOpener.current = opener; setDispositionStatus(''); setDispositionVin(vin) }} />

      <section className={`ov-stores${stores.length === 1 ? ' ov-stores--single' : ''}`} aria-label="Store summary">
        {storeCards(overview, stores).map((counts) => (
          <StoreCard key={counts.store} counts={counts} homeStore={homeStore} role={role} rows={rows} fullAccess={fullAccess} holdsVerified={holdsVerified} collapseMore={!printing} collapseStore={phone && stores.length > 1 && !printing} dispositionsEnabled={dispositionsEnabled} />
        ))}
      </section>

      <div className="ov-columns">
        <div className="ov-column">{where}{exceptions}</div>
        <div className="ov-column">{dispositions}</div>
      </div>

      <ServiceSection data={data} overview={overview} stores={stores} role={role} homeStore={homeStore} reportMode={serviceReport} printing={printing} onReport={printServiceReport} />
      </>}

      <footer className="ov-print-only ov-print-footer">Counts are app records and source evidence as of the times shown. Nothing here asserts availability; confirm holds and location with the home store.</footer>
      {dispositionVehicle ? (
        <DispositionDialog
          vehicle={{ vin: dispositionVehicle.vin, name: dispositionVehicle.vehicleName, stockNumber: dispositionVehicle.stockNumber }}
          disposition={dispositionVehicle.appDisposition}
          evidence={dispositionVehicle.managerDisposition}
          role={role}
          store={homeStore}
          defaultDate={defaultDispositionDate(dispositionVehicle.vin, data.meta.reportDate, data.meta.timezone)}
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
