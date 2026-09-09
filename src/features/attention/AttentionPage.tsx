import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CarFront,
  CheckCircle2,
  FileClock,
  MapPinOff,
  RefreshCw,
  Tag,
} from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { formatCurrency, formatDate, formatNumber } from '../../lib/format'
import type { PublicChangeEvent, PublicChangeType } from '../../types'
import './attention.css'
import { scopePublicChanges } from './change-scope'
import { OperationsQueue } from './OperationsQueue'

const CHANGE_ICONS: Record<PublicChangeType, typeof CarFront> = {
  new_arrival: CarFront,
  removed: AlertTriangle,
  price_change: BadgeDollarSign,
  website_status_change: RefreshCw,
  mileage_change: FileClock,
  stock_correction: Tag,
  store_transfer: MapPinOff,
}

const CHANGE_LABELS: Record<PublicChangeType, string> = {
  new_arrival: 'New arrival',
  removed: 'Listing removed',
  price_change: 'Price changed',
  website_status_change: 'Online status changed',
  mileage_change: 'Mileage changed',
  stock_correction: 'Stock corrected',
  store_transfer: 'Location changed',
}

type TodayTab = 'attention' | 'changes'
type ChangeScope = 'home' | 'group'
type ChangeFilter = 'all' | PublicChangeType

function holdChangeNotice(status: string) {
  if (status === 'structured_baseline_established_no_vin_level_prior_snapshot') {
    return {
      title: 'Hold history starts with this update',
      detail: 'No earlier item-by-item hold comparison is available yet.',
    }
  }
  if (!status || status === 'not_provided') {
    return {
      title: 'Hold changes are not available',
      detail: 'Use the current hold status and confirm it before treating a vehicle as released.',
    }
  }
  return {
    title: 'Hold changes checked',
    detail: 'A hold change does not confirm a sale or delivery.',
  }
}

function eventValue(event: PublicChangeEvent, value: PublicChangeEvent['beforeValue']) {
  if (value === null || value === '') return 'Not published'
  if (event.valueType === 'money') return formatCurrency(typeof value === 'number' ? value : Number(value))
  if (event.valueType === 'mileage') return `${formatNumber(typeof value === 'number' ? value : Number(value))} mi`
  return String(value)
}

function eventDelta(event: PublicChangeEvent) {
  if (event.type !== 'price_change' || typeof event.beforeValue !== 'number' || typeof event.afterValue !== 'number') {
    return null
  }
  const delta = event.afterValue - event.beforeValue
  if (delta === 0) return null
  return `${delta < 0 ? 'Down' : 'Up'} ${formatCurrency(Math.abs(delta))}`
}

function countsFromEvents(events: PublicChangeEvent[]) {
  const count = (type: PublicChangeType) => events.filter((event) => event.type === type).length
  return {
    newArrival: count('new_arrival'),
    removed: count('removed'),
    priceChange: count('price_change'),
    websiteStatusChange: count('website_status_change'),
  }
}

function changePriority(type: PublicChangeType) {
  const priorities: Record<PublicChangeType, number> = {
    price_change: 0,
    website_status_change: 1,
    store_transfer: 2,
    stock_correction: 3,
    mileage_change: 4,
    new_arrival: 5,
    removed: 6,
  }
  return priorities[type]
}

export function AttentionPage() {
  const { data, homeStore, role, addAttentionEvent } = useAppData()
  const [tab, setTab] = useState<TodayTab>('attention')
  const attentionTabRef = useRef<HTMLButtonElement>(null)
  const changesTabRef = useRef<HTMLButtonElement>(null)
  const [scope, setScope] = useState<ChangeScope>('home')
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all')

  const attentionItems = data?.attention ?? []
  const allChanges = data?.publicChanges ?? []
  const scopeChanges = useMemo(
    () => scopePublicChanges(allChanges, scope, homeStore),
    [allChanges, homeStore, scope],
  )
  const visibleChanges = useMemo(
    () => scopeChanges
      .filter((event) => changeFilter === 'all' || event.type === changeFilter)
      .sort(
        (left, right) =>
          changePriority(left.type) - changePriority(right.type) ||
          left.store.localeCompare(right.store) ||
          left.vehicleName.localeCompare(right.vehicleName),
      ),
    [changeFilter, scopeChanges],
  )

  if (!data) return null

  const certifiedTotal = Object.values(data.meta.publicChangeCounts).reduce((total, count) => total + count, 0)
  const comparisonBaselineDate = allChanges[0]?.previousReportDate || data.meta.publicChangeBaselineDate
  const detailedChangesCertified = allChanges.length === certifiedTotal && (certifiedTotal > 0 || Boolean(comparisonBaselineDate))
  const displayScope: ChangeScope = detailedChangesCertified ? scope : 'group'
  const counts = detailedChangesCertified
    ? countsFromEvents(scopeChanges)
    : {
        newArrival: data.meta.publicChangeCounts.newArrival,
        removed: data.meta.publicChangeCounts.removed,
        priceChange: data.meta.publicChangeCounts.priceChange,
        websiteStatusChange: data.meta.publicChangeCounts.websiteStatusChange,
      }
  const displayedChangeTotal = detailedChangesCertified ? scopeChanges.length : certifiedTotal
  const holdNotice = holdChangeNotice(data.meta.holdChangeStatus)
  const currentChanges = data.meta.publicFreshness === 'current'
  const attentionCount = attentionItems.filter(
    (item) =>
      item.status !== 'resolved' &&
      (!item.store || item.store === homeStore || item.relatedStores?.includes(homeStore)),
  ).length
  const summaryCards = [
    { key: 'new', label: 'New arrivals', value: counts.newArrival, detail: 'Added to inventory', tone: 'new' },
    { key: 'price', label: 'Price changes', value: counts.priceChange, detail: 'Exact before / after', tone: 'price' },
    { key: 'status', label: 'Online status', value: counts.websiteStatusChange, detail: 'Listing status changed', tone: 'status' },
    { key: 'removed', label: 'Listing removed', value: counts.removed, detail: 'No longer listed online', tone: 'removed' },
  ] as const
  const filterOptions: Array<[ChangeFilter, string]> = [
    ['all', 'All changes'],
    ['new_arrival', 'New arrivals'],
    ['price_change', 'Price'],
    ['removed', 'Removed'],
    ['website_status_change', 'Online status'],
  ]

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, current: TodayTab) {
    const next = event.key === 'Home'
      ? 'attention'
      : event.key === 'End'
        ? 'changes'
        : event.key === 'ArrowRight' || event.key === 'ArrowLeft'
          ? current === 'attention' ? 'changes' : 'attention'
          : null
    if (!next) return
    event.preventDefault()
    setTab(next)
    ;(next === 'attention' ? attentionTabRef : changesTabRef).current?.focus()
  }

  return (
    <section className="today-page">
      <div className="page-header-row today-header">
        <div>
          <h1 className="page-heading">Needs attention</h1>
          <p className="page-subtitle">Work the highest-priority vehicle tasks for {homeStore}, with ownership and the next step in one place.</p>
        </div>
        <div className="today-as-of">
          <small>Updated</small>
          <strong>{formatDate(data.meta.reportDate)}</strong>
        </div>
      </div>

      {data.meta.publicFreshness !== 'current' || data.meta.dealerMailFreshness !== 'current' ? (
        <div className="today-data-warning" role="status">
          <AlertTriangle aria-hidden="true" />
          <div><strong>Some records may be out of date</strong><p>Use the last verified details and confirm the current status before acting.</p></div>
        </div>
      ) : null}

      <div className="today-tabs" role="tablist" aria-label="Today sections">
        <button ref={attentionTabRef} id="today-tab-attention" type="button" role="tab" aria-controls="today-panel-attention" aria-selected={tab === 'attention'} tabIndex={tab === 'attention' ? 0 : -1} className={tab === 'attention' ? 'is-active' : undefined} onKeyDown={(event) => moveTabFocus(event, 'attention')} onClick={() => setTab('attention')}>
          Work queue <span>{attentionCount}</span>
        </button>
        <button ref={changesTabRef} id="today-tab-changes" type="button" role="tab" aria-controls="today-panel-changes" aria-selected={tab === 'changes'} tabIndex={tab === 'changes' ? 0 : -1} className={tab === 'changes' ? 'is-active' : undefined} onKeyDown={(event) => moveTabFocus(event, 'changes')} onClick={() => setTab('changes')}>
          Daily changes <span>{displayedChangeTotal}</span>
        </button>
      </div>

      {tab === 'changes' ? <>
        <div className="today-summary-context">
          <span><strong>{displayScope === 'home' ? homeStore : 'All stores'}</strong> change totals</span>
          <div className="today-scope-control" role="group" aria-label="Inventory change store scope">
            <button type="button" aria-pressed={displayScope === 'home'} disabled={!detailedChangesCertified} title={!detailedChangesCertified ? 'Store detail is unavailable for this release' : undefined} className={displayScope === 'home' ? 'is-active' : undefined} onClick={() => setScope('home')}><span>{homeStore}</span></button>
            <button type="button" aria-pressed={displayScope === 'group'} className={displayScope === 'group' ? 'is-active' : undefined} onClick={() => setScope('group')}><span>All stores</span></button>
          </div>
        </div>

        <div className="today-summary" aria-label={`${displayScope === 'home' ? homeStore : 'Group'} inventory change totals`}>
          {summaryCards.map((card) => (
            <article className={`today-summary-card today-summary-card--${card.tone}`} key={card.key}>
              <strong>{formatNumber(card.value)}</strong>
              <span>{card.label}</span>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>
      </> : null}

      {tab === 'attention' ? (
        <div id="today-panel-attention" role="tabpanel" className="today-panel" aria-labelledby="today-tab-attention">
          <OperationsQueue
            items={attentionItems}
            homeStore={homeStore}
            role={role}
            reportDate={data.meta.reportDate}
            onAction={addAttentionEvent}
          />
        </div>
      ) : (
          <div id="today-panel-changes" role="tabpanel" className="today-panel" aria-labelledby="today-tab-changes">
          <div className="today-baseline-notice"><FileClock aria-hidden="true" /><div><strong>{holdNotice.title}</strong><p>{holdNotice.detail}</p></div></div>
          <div className="today-change-toolbar"><div><h2>{displayScope === 'home' ? `${homeStore} changes` : 'All-store changes'}</h2><p>{detailedChangesCertified ? `${scopeChanges.length} certified event${scopeChanges.length === 1 ? '' : 's'} from ${formatDate(comparisonBaselineDate)} to ${formatDate(data.meta.reportDate)}` : `${certifiedTotal} certified group event${certifiedTotal === 1 ? '' : 's'} for ${formatDate(data.meta.reportDate)}; VIN-level detail is unavailable`}</p></div></div>

          <div className="today-change-filters" role="group" aria-label="Change type filter">
            {filterOptions.map(([value, label]) => (
              <button type="button" className={changeFilter === value ? 'is-active' : undefined} aria-pressed={changeFilter === value} key={value} onClick={() => setChangeFilter(value)}>{label}</button>
            ))}
          </div>

          {!currentChanges ? <div className="today-stale-change-warning"><AlertTriangle aria-hidden="true" /><p>These are the last verified changes. Do not treat a missing or unchanged listing as a current removal or release.</p></div> : null}
          {!detailedChangesCertified ? <div className="today-stale-change-warning"><AlertTriangle aria-hidden="true" /><p>VIN-level detail is unavailable because it did not reconcile to the certified totals. Use the aggregate counts above.</p></div> : null}

          {visibleChanges.length ? (
            <div className="today-change-list" role="list">
              {visibleChanges.map((event) => {
                const Icon = CHANGE_ICONS[event.type]
                const delta = eventDelta(event)
                const isPriceDecrease = event.type === 'price_change' && typeof event.beforeValue === 'number' && typeof event.afterValue === 'number' && event.afterValue < event.beforeValue
                return (
                  <article className="today-change-row" role="listitem" key={event.id}>
                    <span className={`today-change-icon today-change-icon--${event.type}`}><Icon aria-hidden="true" /></span>
                    <div className="today-change-copy">
                      <span className={`today-change-badge today-change-badge--${event.type}`}>{CHANGE_LABELS[event.type]}</span>
                      <strong>{event.vehicleName}</strong>
                      <small>{event.stockNumber} · {event.vin}</small>
                      <small className="today-change-mobile-store">{event.store}</small>
                    </div>
                    <div className="today-change-store"><small>Location</small><strong>{event.store}</strong></div>
                    <div className="today-change-values">
                      <span><small>{event.field}</small><strong>{eventValue(event, event.beforeValue)} → {eventValue(event, event.afterValue)}</strong></span>
                      {delta ? <small className={isPriceDecrease ? 'today-change-delta--down' : 'today-change-delta--up'}>{delta}</small> : null}
                    </div>
                    {event.currentVehicle ? (
                      <Link to={`/inventory?scope=group&q=${encodeURIComponent(event.vin)}`} aria-label={`Open ${event.vehicleName}, stock ${event.stockNumber}`}><span>Open</span><ArrowRight aria-hidden="true" /></Link>
                    ) : <span className="today-change-no-current" aria-label="No current online inventory record">—</span>}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="today-change-empty"><CheckCircle2 aria-hidden="true" /><strong>{detailedChangesCertified ? 'No matching changes for this view' : 'Use the certified aggregate totals above'}</strong>{detailedChangesCertified ? <button type="button" onClick={() => setChangeFilter('all')}>Clear change filter</button> : null}</div>
          )}

          <div className="today-removal-note"><AlertTriangle aria-hidden="true" /><p><strong>A listing removal is not a sales outcome.</strong> It means a VIN was listed online in the prior verified update and is missing from this update. It does not mean sold, delivered, or physically gone.</p></div>
        </div>
      )}
    </section>
  )
}
