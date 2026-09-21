import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  LockKeyhole,
  RefreshCw,
  Store,
  Users,
} from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAppData } from '../../app/AppDataContext'
import { STORE_BRANDING } from '../../app/storeBranding'
import { formatDateTime, formatNumber } from '../../lib/format'
import { getAdminOverview } from '../../lib/api'
import { STORE_NAMES, type StoreName } from '../../types'
import type { AdminAuditEntry, AdminFeed, AdminOverview, AdminPerson } from './types'
import { MembershipManagement } from './MembershipManagement'
import './admin.css'

interface AdminLoadState {
  accessContext: string
  data: AdminOverview | null
  loading: boolean
  error: string | null
}

const ROLE_LABELS: Record<string, string> = {
  sales: 'Salesperson',
  manager: 'Store manager',
  group_manager: 'Group manager',
  coordinator: 'Transport coordinator',
  porter: 'Porter',
  driver: 'Driver',
}

const FEED_LABELS: Record<AdminFeed['status'], string> = {
  current: 'Current',
  stale_unverified: 'Stale — verify',
  incomplete: 'Incomplete',
  unknown: 'Not verified',
}

function labelCount(value: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '—'
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role.replaceAll('_', ' ')
}

function storeAccessLabel(stores: string[]) {
  if (!stores.length) return 'Not recorded'
  const knownStores = new Set(STORE_NAMES)
  if (knownStores.size === stores.length && stores.every((store) => knownStores.has(store as StoreName))) {
    return 'All stores'
  }
  return stores.join(', ')
}

function timestampLabel(value: string | null, fallback: string) {
  return value ? formatDateTime(value) : fallback
}

function anchorId(prefix: string, value: string) {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'record'}`
}

function storeBrand(store: string) {
  return Object.prototype.hasOwnProperty.call(STORE_BRANDING, store)
    ? STORE_BRANDING[store as StoreName]
    : null
}

function feedSummaryLabel(data: AdminOverview) {
  if (data.summary.connectedStores === 0) return 'Not verified'
  if (data.summary.feedsCurrent === data.summary.connectedStores) return 'Current'
  return `${formatNumber(data.summary.feedsCurrent)} current`
}

function AdminLoadingState() {
  return (
    <section className="admin-state" role="status" aria-live="polite">
      <span className="admin-loading-mark" aria-hidden="true" />
      <div>
        <h1>Loading control center</h1>
        <p>Checking people, feed health, and recorded activity.</p>
      </div>
    </section>
  )
}

function AdminErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="admin-state admin-state--error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <h1>Control center unavailable</h1>
        <p>{message}</p>
        <button type="button" onClick={retry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </button>
      </div>
    </section>
  )
}

function Status({ status, children }: { status: string; children: ReactNode }) {
  return (
    <span className={`admin-status admin-status--${status}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  )
}

function PeopleSection({ people }: { people: AdminPerson[] }) {
  const [showAllMobile, setShowAllMobile] = useState(false)
  const mobilePeople = showAllMobile ? people : people.slice(0, 4)
  const hasMorePeople = people.length > 4

  return (
    <section className="admin-section admin-section--people" id="admin-people" aria-labelledby="admin-people-title">
      <header className="admin-section__header">
        <div>
          <h2 id="admin-people-title">People &amp; access</h2>
          <p>Group manager access across all stores.</p>
        </div>
        <span>{labelCount(people.length, 'person', 'people')}</span>
      </header>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption className="visually-hidden">People with Inventory Flow access</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Store access</th>
              <th scope="col">Status</th>
              <th scope="col">Last active</th>
              <th scope="col"><span className="visually-hidden">Record link</span></th>
            </tr>
          </thead>
          <tbody>
            {people.length ? people.map((person) => {
              const rowId = anchorId('admin-person', person.id)
              return (
                <tr key={person.id} id={rowId}>
                  <th scope="row">
                    <span className="admin-person-name">
                      <span className="admin-avatar" aria-hidden="true">{initials(person.name)}</span>
                      <span>{person.name}</span>
                    </span>
                  </th>
                  <td>{roleLabel(person.role)}</td>
                  <td>{storeAccessLabel(person.storeAccess)}</td>
                  <td>
                    <Status status={person.status}>{person.status === 'active' ? 'Active' : 'Disabled'}</Status>
                  </td>
                  <td><time dateTime={person.lastActiveAt ?? undefined}>{timestampLabel(person.lastActiveAt, 'Not recorded')}</time></td>
                  <td>
                    <a className="admin-row-link" href={`#${rowId}`} aria-label={`Link to ${person.name}`}>
                      View <ArrowRight aria-hidden="true" />
                    </a>
                  </td>
                </tr>
              )
            }) : (
              <tr><td className="admin-empty-cell" colSpan={6}>No people are available in this read-only view.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-mobile-list">
        {people.length ? (
          <>
            <div id="admin-mobile-people-list" role="list">
              {mobilePeople.map((person) => (
                <details className="admin-scan-row admin-person-row" key={person.id} id={anchorId('admin-mobile-person', person.id)} role="listitem">
                  <summary>
                    <span className="admin-avatar" aria-hidden="true">{initials(person.name)}</span>
                    <span className="admin-scan-row__primary">
                      <strong>{person.name}</strong>
                      <small>{roleLabel(person.role)}</small>
                    </span>
                    <span className="admin-scan-row__store">{storeAccessLabel(person.storeAccess)}</span>
                    <Status status={person.status}>{person.status === 'active' ? 'Active' : 'Disabled'}</Status>
                    <span className="admin-scan-row__action">View <ChevronRight aria-hidden="true" /></span>
                  </summary>
                  <dl>
                    <div><dt>Store access</dt><dd>{storeAccessLabel(person.storeAccess)}</dd></div>
                    <div><dt>Last active</dt><dd>{timestampLabel(person.lastActiveAt, 'Not recorded')}</dd></div>
                  </dl>
                </details>
              ))}
            </div>
            {hasMorePeople ? (
              <button
                type="button"
                className="admin-mobile-toggle"
                aria-controls="admin-mobile-people-list"
                aria-expanded={showAllMobile}
                onClick={() => setShowAllMobile((current) => !current)}
              >
                {showAllMobile ? 'Show fewer people' : `Show all ${formatNumber(people.length)} people`}
                <ChevronDown aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : <p className="admin-empty-row">No people are available in this read-only view.</p>}
      </div>
    </section>
  )
}

function FeedSection({ feeds }: { feeds: AdminFeed[] }) {
  return (
    <section className="admin-section admin-section--feeds" id="admin-feeds" aria-labelledby="admin-feeds-title">
      <header className="admin-section__header">
        <div>
          <h2 id="admin-feeds-title">Feed health</h2>
          <p>Inventory data feed status for each store.</p>
        </div>
        <span>{labelCount(feeds.length, 'store')}</span>
      </header>

      <div className="admin-table-wrap">
        <table className="admin-table admin-feed-table">
          <caption className="visually-hidden">Inventory feed health by store</caption>
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col">Status</th>
              <th scope="col">Last successful update</th>
              <th scope="col">Vehicle count</th>
              <th scope="col">Issue summary</th>
            </tr>
          </thead>
          <tbody>
            {feeds.length ? feeds.map((feed) => {
              const rowId = anchorId('admin-feed', feed.store)
              return (
                <tr key={feed.store} id={rowId}>
                  <th scope="row">{feed.store}</th>
                  <td><Status status={feed.status}>{FEED_LABELS[feed.status]}</Status></td>
                  <td><time dateTime={feed.lastSuccessfulAt ?? undefined}>{timestampLabel(feed.lastSuccessfulAt, 'Not recorded')}</time></td>
                  <td data-numeric>{feed.vehicleCount == null ? 'Not reported' : formatNumber(feed.vehicleCount)}</td>
                  <td>{feed.issueSummary || (feed.status === 'current' ? 'No issues' : 'No issue detail reported')}</td>
                </tr>
              )
            }) : (
              <tr><td className="admin-empty-cell" colSpan={5}>No store feed records are available yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-mobile-list" role="list">
        {feeds.length ? feeds.map((feed) => {
          const brand = storeBrand(feed.store)
          return (
            <details className="admin-scan-row admin-feed-row" key={feed.store} id={anchorId('admin-mobile-feed', feed.store)} role="listitem">
              <summary>
                <span className="admin-store-mark" aria-hidden="true">
                  {brand ? <img src={brand.assetPath} alt="" /> : <Store />}
                </span>
                <strong className="admin-feed-row__store">{feed.store}</strong>
                <span className="admin-feed-row__health">
                  <Status status={feed.status}>{FEED_LABELS[feed.status]}</Status>
                  <time dateTime={feed.lastSuccessfulAt ?? undefined}>{timestampLabel(feed.lastSuccessfulAt, 'Not recorded')}</time>
                </span>
                <span className="admin-feed-row__count">
                  <strong>{feed.vehicleCount == null ? '—' : formatNumber(feed.vehicleCount)}</strong>
                  <small>vehicles</small>
                </span>
                <ChevronRight className="admin-scan-row__chevron" aria-hidden="true" />
              </summary>
              <dl>
                <div><dt>Issue summary</dt><dd>{feed.issueSummary || (feed.status === 'current' ? 'No issues' : 'No issue detail reported')}</dd></div>
              </dl>
            </details>
          )
        }) : <p className="admin-empty-row">No store feed records are available yet.</p>}
      </div>
    </section>
  )
}

function AuditSection({ audit }: { audit: AdminAuditEntry[] }) {
  const [showAllMobile, setShowAllMobile] = useState(false)
  const mobileAudit = showAllMobile ? audit : audit.slice(0, 3)
  const hasMoreAudit = audit.length > 3

  return (
    <section className="admin-section admin-section--audit" id="admin-audit" aria-labelledby="admin-audit-title">
      <header className="admin-section__header">
        <div>
          <h2 id="admin-audit-title">Recent audit activity</h2>
          <p>Latest recorded system activity across your stores.</p>
        </div>
        <span>{labelCount(audit.length, 'event')}</span>
      </header>

      <div className="admin-table-wrap">
        <table className="admin-table admin-audit-table">
          <caption className="visually-hidden">Recent read-only audit activity</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Person</th>
              <th scope="col">Activity</th>
              <th scope="col">Scope</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {audit.length ? audit.map((entry) => (
              <tr key={entry.id}>
                <td><time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time></td>
                <td>{entry.actor || 'Not recorded'}</td>
                <th scope="row">{entry.activity}</th>
                <td>{entry.scope}</td>
                <td><Status status="recorded">Recorded</Status></td>
              </tr>
            )) : (
              <tr><td className="admin-empty-cell" colSpan={5}>No audit activity has been recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-mobile-list admin-audit-list">
        {audit.length ? (
          <>
            <div id="admin-mobile-audit-list" role="list">
              {mobileAudit.map((entry) => (
                <article className="admin-audit-row" key={entry.id} role="listitem">
                  <span className="admin-audit-row__icon" aria-hidden="true"><ClipboardCheck /></span>
                  <span className="admin-audit-row__copy">
                    <strong>{entry.activity}</strong>
                    <small>{entry.actor || 'Actor not recorded'} · {entry.scope}</small>
                  </span>
                  <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
                </article>
              ))}
            </div>
            {hasMoreAudit ? (
              <button
                type="button"
                className="admin-mobile-toggle"
                aria-controls="admin-mobile-audit-list"
                aria-expanded={showAllMobile}
                onClick={() => setShowAllMobile((current) => !current)}
              >
                {showAllMobile ? 'Show fewer events' : `Show all ${formatNumber(audit.length)} events`}
                <ChevronDown aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : <p className="admin-empty-row">No audit activity has been recorded yet.</p>}
      </div>
    </section>
  )
}

export function AdminPage() {
  const { hash } = useLocation()
  const activeSection = ['#admin-people', '#admin-feeds', '#admin-audit'].includes(hash) ? hash : '#admin-overview'
  const sectionLink = (section: string) => ({ href: section, className: activeSection === section ? 'is-active' : undefined, 'aria-current': activeSection === section ? 'location' as const : undefined })
  const { homeStore, role } = useAppData()
  const accessContext = `${role}:${homeStore}`
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<AdminLoadState>({
    accessContext,
    data: null,
    loading: role === 'group_manager',
    error: null,
  })

  useEffect(() => {
    if (role !== 'group_manager') {
      setLoadState({ accessContext, data: null, loading: false, error: null })
      return
    }

    const controller = new AbortController()
    setLoadState({ accessContext, data: null, loading: true, error: null })
    void getAdminOverview(role, homeStore, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.readOnly !== true) throw new Error('The server did not return a read-only control center view.')
        setLoadState({ accessContext, data, loading: false, error: null })
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setLoadState({
          accessContext,
          data: null,
          loading: false,
          error: caught instanceof Error ? caught.message : 'The control center could not be loaded.',
        })
      })

    return () => controller.abort()
  }, [accessContext, attempt, homeStore, role])

  if (role !== 'group_manager') return <Navigate to="/attention" replace />

  const currentState = loadState.accessContext === accessContext
    ? loadState
    : { accessContext, data: null, loading: true, error: null }

  if (currentState.loading && !currentState.data) return <AdminLoadingState />
  if (currentState.error || !currentState.data) {
    return <AdminErrorState message={currentState.error || 'The control center returned no data.'} retry={() => setAttempt((value) => value + 1)} />
  }

  const data = currentState.data
  const verificationLabel = timestampLabel(data.summary.lastVerifiedAt, 'Not yet verified')

  return (
    <section className="admin-page" aria-labelledby="admin-page-title">
      <header className="admin-heading">
        <h1 id="admin-page-title">Control center</h1>
        <p>People, data health, and accountability<span className="admin-heading__desktop-copy"> across every store</span>.</p>
      </header>

      <section className="admin-summary" id="admin-overview" aria-labelledby="admin-summary-title">
        <h2 className="visually-hidden" id="admin-summary-title">Control center overview</h2>
        <article aria-label={`${labelCount(data.summary.activeUsers, 'active user')}`}>
          <Users aria-hidden="true" />
          <span><strong data-numeric>{formatNumber(data.summary.activeUsers)}</strong><small>Active users</small></span>
        </article>
        <article aria-label={`${labelCount(data.summary.connectedStores, 'connected store')}`}>
          <Building2 aria-hidden="true" />
          <span><strong data-numeric>{formatNumber(data.summary.connectedStores)}</strong><small>Connected stores</small></span>
        </article>
        <article aria-label={`${data.summary.feedsCurrent} of ${data.summary.connectedStores} connected feeds current`}>
          <span className={`admin-summary__dot${data.summary.connectedStores > 0 && data.summary.feedsCurrent === data.summary.connectedStores ? ' is-current' : ''}`} aria-hidden="true" />
          <span><strong>{feedSummaryLabel(data)}</strong><small>Feed status<span className="admin-heading__desktop-copy"> · {verificationLabel}</span></small></span>
        </article>
      </section>

      <nav className="admin-tabs" aria-label="Control center sections">
        <a {...sectionLink("#admin-overview")}>Overview</a>
        <a {...sectionLink("#admin-people")}><span className="admin-tab__desktop-copy">People &amp; access</span><span className="admin-tab__mobile-copy">People</span></a>
        <a {...sectionLink("#admin-feeds")}><span className="admin-tab__desktop-copy">Feed health</span><span className="admin-tab__mobile-copy">Feeds</span></a>
        <a {...sectionLink("#admin-audit")}><span className="admin-tab__desktop-copy">Audit log</span><span className="admin-tab__mobile-copy">Audit</span></a>
      </nav>

      <p className="admin-readonly-note">
        <LockKeyhole aria-hidden="true" />
        <span>{data.canManageMembers ? <><strong>Group manager controls</strong> · Access changes are recorded.</> : <><strong>Read-only view</strong> for group managers. Employee editing is unavailable on this host.</>}</span>
      </p>

      {data.canManageMembers ? <MembershipManagement role={role} store={homeStore} onSaved={() => {
        void getAdminOverview(role, homeStore).then(updated => setLoadState(current => current.accessContext === accessContext ? { ...current, data: updated } : current)).catch(() => { /* Employee save succeeded; Reload refreshes the overview if this read fails. */ })
      }} /> : <PeopleSection people={data.people} />}
      <FeedSection feeds={data.feeds} />
      <AuditSection audit={data.audit} />

      <footer className="admin-generated-note">
        <Activity aria-hidden="true" />
        Overview generated {timestampLabel(data.generatedAt, 'at an unrecorded time')}.
      </footer>
    </section>
  )
}
