import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeftRight,
  ArrowRight,
  Bell,
  CarFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Download,
  Ellipsis,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings2,
  Users,
  ListChecks,
  Wrench,
  X,
} from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { formatDateTime } from '../lib/format'
import { FlowBrandLockup } from '../design-system'
import { runInterfaceTransition } from '../lib/interfaceTransition'
import { useContainedFocus } from '../lib/useContainedFocus'
import { useModalBackgroundIsolation } from '../lib/useModalBackgroundIsolation'
import { STORE_NAMES, type StoreName, type UserRole } from '../types'
import {
  createInventorySearchNavigation,
  inventorySearchAccessContext,
} from '../features/inventory/inventory-navigation'
import { useAppData } from './AppDataContext'
import { STORE_BRANDING } from './storeBranding'
import '../styles/mobile-density.css'
import { openStoreActionCount } from '../features/attention/action-center'
import '../styles/workflow-navigation.css'
import '../styles/compact-workspace.css'

const NAV_ITEMS = [
  { id: 'inventory', to: '/inventory', label: 'Inventory', shortLabel: 'Inventory', icon: CarFront },
  { id: 'moves', to: '/transfers', label: 'Vehicle moves', shortLabel: 'Moves', icon: ArrowLeftRight },
  { id: 'today', to: '/attention', label: 'Action center', shortLabel: 'Actions', icon: Bell },
  { id: 'updates', to: '/updates', label: 'Inventory updates', shortLabel: 'Updates', icon: ListChecks },
  { id: 'service', to: '/service', label: 'Service status', shortLabel: 'Service', icon: Wrench },
] as const

const ADMIN_NAV_ITEM = {
  id: 'admin',
  to: '/admin',
  label: 'Control center',
  shortLabel: 'Control center',
  icon: LayoutDashboard,
} as const

type NavigationItemId = (typeof NAV_ITEMS)[number]['id'] | typeof ADMIN_NAV_ITEM.id

const ROLE_LABELS: Record<UserRole, string> = {
  sales: 'Salesperson',
  manager: 'Store manager',
  group_manager: 'Group manager',
  coordinator: 'Transport coordinator',
  porter: 'Porter',
  driver: 'Driver',
}

const ROLE_PREVIEW_OPTIONS: UserRole[] = ['sales', 'manager', 'group_manager']

// The bottom rail holds four destinations plus More. Whatever it leaves out has
// no other link on a phone, so the utility menu carries it with its page help.
const MOBILE_UTILITY_HINTS: Partial<Record<NavigationItemId, string>> = {
  today: 'The next step for your store, in one place',
  updates: 'New arrivals and price changes for your inventory',
  service: 'Waiting, in service, and completed work',
}

const NAV_STORAGE_KEY = 'maxey-inventory-flow:expanded-navigation-v3'

function readStoredNavigationState() {
  if (typeof window === 'undefined') return false
  try {
    const stored = window.localStorage?.getItem(NAV_STORAGE_KEY)
    return stored === null ? Boolean(window.matchMedia?.('(min-width: 1180px)').matches) : stored === 'true'
  } catch {
    return false
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data, homeStore, setHomeStore, role, setRole, currentUser, refresh, loading } = useAppData()
  const authenticatedUser = currentUser || 'Local prototype user'
  const userInitials = authenticatedUser
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'IF'
  const [navExpanded, setNavExpanded] = useState(readStoredNavigationState)
  const [utilityOpen, setUtilityOpen] = useState(false)
  const [storeSwitching, setStoreSwitching] = useState(false)
  const searchAccessContext = inventorySearchAccessContext(role, homeStore, currentUser)
  const [searchDraft, setSearchDraft] = useState(() => ({ accessContext: searchAccessContext, query: '' }))
  const query = searchDraft.accessContext === searchAccessContext ? searchDraft.query : ''
  const utilityDialogRef = useRef<HTMLDivElement>(null)
  const utilityCloseRef = useRef<HTMLButtonElement>(null)
  const utilityOpenerRef = useRef<HTMLButtonElement>(null)
  const appShellRef = useRef<HTMLDivElement>(null)
  const mainContentRef = useRef<HTMLElement>(null)
  const previousHomeStoreRef = useRef(homeStore)
  const navigate = useNavigate()
  const location = useLocation()
  const previousLocationKeyRef = useRef(location.key)
  const isInventoryRoute = location.pathname === '/' || location.pathname.startsWith('/inventory')
  const attentionCount = openStoreActionCount(data, homeStore)
  const storeBrand = STORE_BRANDING[homeStore]
  const canSeeManager = role === 'manager' || role === 'group_manager'
  const canSeeAdmin = role === 'group_manager'
  const desktopNavigationItems = canSeeAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS
  const mobileNavigationIds: NavigationItemId[] = canSeeAdmin
    ? ['admin', 'inventory', 'moves', 'service']
    : ['inventory', 'moves', 'today', 'updates']
  const mobileNavigationItems = [ADMIN_NAV_ITEM, ...NAV_ITEMS]
    .filter((item) => mobileNavigationIds.includes(item.id))
    .sort((left, right) => mobileNavigationIds.indexOf(left.id) - mobileNavigationIds.indexOf(right.id))
  const mobileUtilityItems = NAV_ITEMS.filter((item) => !mobileNavigationIds.includes(item.id))
  const rolePreviewEnabled = data?.access?.canPreviewRoles === true || import.meta.env.DEV || import.meta.env.VITE_ENABLE_ROLE_PREVIEW === 'true'
  const storePreviewEnabled = data?.access?.canPreviewStores === true || import.meta.env.DEV || import.meta.env.VITE_ENABLE_ROLE_PREVIEW === 'true'
  const productionRolePreview = data?.access?.rolePreviewActive === true
  const freshnessState = !data
    ? 'unknown'
    : data.meta.dealerMailFreshness === 'incomplete' || data.meta.publicFreshness === 'incomplete'
      ? 'incomplete'
      : data.meta.dealerMailFreshness === 'current' && data.meta.publicFreshness === 'current'
        ? 'current'
        : 'stale_unverified'
  const freshnessLabel = data
    ? data.meta.dealerMailFreshness === 'current' && data.meta.publicFreshness === 'current'
      ? 'Current'
      : data.meta.dealerMailFreshness === 'incomplete' || data.meta.publicFreshness === 'incomplete'
        ? 'Refresh incomplete'
        : 'Check data'
    : loading ? 'Updating' : 'Unavailable'

  useContainedFocus({
    active: utilityOpen,
    contain: true,
    containerRef: utilityDialogRef,
    initialFocusRef: utilityCloseRef,
    returnFocusRef: utilityOpenerRef,
    onEscape: () => setUtilityOpen(false),
  })

  useModalBackgroundIsolation({
    active: utilityOpen,
    backgroundRef: appShellRef,
  })

  useEffect(() => {
    try {
      window.localStorage?.setItem(NAV_STORAGE_KEY, String(navExpanded))
    } catch {
      // Navigation persistence is a convenience and must never block the app.
    }
  }, [navExpanded])

  useEffect(() => {
    if (previousHomeStoreRef.current === homeStore) return

    previousHomeStoreRef.current = homeStore
    setStoreSwitching(true)
    const timer = window.setTimeout(() => setStoreSwitching(false), 760)

    return () => window.clearTimeout(timer)
  }, [homeStore])

  useEffect(() => {
    setSearchDraft({ accessContext: searchAccessContext, query: '' })
  }, [searchAccessContext])

  useEffect(() => {
    if (previousLocationKeyRef.current === location.key) return
    previousLocationKeyRef.current = location.key

    // Leave focus ownership with an active modal. Route-level dialogs restore
    // focus to their own opener when they close.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

    mainContentRef.current?.focus({ preventScroll: true })
  }, [location.key])

  function handleSearch(event: FormEvent) {
    event.preventDefault()
    const destination = createInventorySearchNavigation(query, searchAccessContext)
    navigate(
      { pathname: destination.pathname, search: destination.search },
      { state: destination.state },
    )
    setSearchDraft({ accessContext: searchAccessContext, query: '' })
  }

  function openUtility(event: MouseEvent<HTMLButtonElement>) {
    utilityOpenerRef.current = event.currentTarget
    setUtilityOpen(true)
  }

  function isNavActive(id: NavigationItemId, to: string) {
    if (id === 'inventory') return location.pathname === '/' || location.pathname.startsWith('/inventory')
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }

  const primaryNavigation = (
    <nav className="primary-nav" aria-label="Primary">
      {desktopNavigationItems.map(({ id, to, label, icon: Icon }) => {
        const active = isNavActive(id, to)
        return (
          <NavLink
            key={to}
            to={to}
            className={`nav-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            title={navExpanded ? undefined : label}
          >
            <span className="nav-icon-frame" aria-hidden="true"><Icon /></span>
            <span className="nav-label">{label}</span>
            {id === 'today' && attentionCount > 0 ? (
              <span className="nav-count" aria-label={`${attentionCount} items need attention today`}>
                {attentionCount}
              </span>
            ) : null}
          </NavLink>
        )
      })}
    </nav>
  )

  const utilityLayer = utilityOpen ? (
    <div
      className={`utility-layer store-theme-${storeBrand.themeKey}`}
      data-ifx-oem={storeBrand.oemKey}
      id="app-utility-dialog"
      ref={utilityDialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-utility-title"
      aria-describedby="app-utility-context"
      tabIndex={-1}
    >
      <div className="utility-scrim" onClick={() => setUtilityOpen(false)} aria-hidden="true" />
      <section className="utility-panel">
        <header className="utility-panel-header">
          <span className="utility-user-mark" aria-hidden="true"><CircleUserRound /></span>
          <span>
            <h2 id="app-utility-title">Account and app controls</h2>
            <small id="app-utility-context">{authenticatedUser} · {ROLE_LABELS[role]} · {homeStore}</small>
          </span>
          <button ref={utilityCloseRef} type="button" onClick={() => setUtilityOpen(false)} aria-label="Close app controls"><X /></button>
        </header>

        <div className="utility-update-card" aria-busy={loading}>
          <span className={`freshness-dot freshness-${freshnessState}`} aria-hidden="true" />
          <span role="status" aria-live="polite" aria-atomic="true" aria-busy={loading}>
            <strong>Inventory and holds · {freshnessLabel}</strong>
            <small>{data ? `Updated ${formatDateTime(data.meta.completedAt)}` : loading ? 'Updating now…' : 'Update unavailable'}</small>
          </span>
          <button type="button" onClick={() => void refresh()} aria-label={loading ? 'Refreshing inventory and holds' : 'Refresh inventory and holds'} disabled={loading}>
            <RefreshCw className={loading ? 'spin' : ''} aria-hidden="true" />
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>

        {rolePreviewEnabled ? <label className="utility-role-control" title="Test the app with this role’s permissions">
          <Settings2 aria-hidden="true" />
          <span>
            <small>Preview role</small>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {ROLE_PREVIEW_OPTIONS.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
            </select>
          </span>
          <ChevronDown aria-hidden="true" />
        </label> : null}
        {data?.access?.canPreviewRoles && <p className="utility-role-help">Your account is a Group manager. Choose a role to test its permissions. Any changes you save affect live records.</p>}

        {import.meta.env.PROD && <a className="utility-service-link" href="/downloads/inventory-flow-deal-desk.zip" download="inventory-flow-deal-desk.zip"><Download aria-hidden="true"/><span><strong>Download companion extension</strong><small>Extract the ZIP, then load or reload it in Chrome extensions.</small></span><ChevronRight aria-hidden="true"/></a>}

        {mobileUtilityItems.map(({ id, to, label, icon: Icon }) => (
          <NavLink key={id} className="utility-service-link" to={to} onClick={() => setUtilityOpen(false)}><Icon aria-hidden="true"/><span><strong>{label}</strong><small>{MOBILE_UTILITY_HINTS[id]}</small></span><ChevronRight aria-hidden="true"/></NavLink>
        ))}

        {canSeeManager ? (
          <NavLink className="utility-manager-link" to="/manager" onClick={() => setUtilityOpen(false)}>
            <Users aria-hidden="true" />
            <span>
              <strong>Manager overview</strong>
              <small>Group inventory, holds, movement, and exceptions</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </NavLink>
        ) : null}
      </section>
    </div>
  ) : null

  return (
    <>
    <div
      ref={appShellRef}
      className={`app-shell${navExpanded ? ' is-nav-expanded' : ' is-nav-compact'} store-theme-${storeBrand.themeKey}${storeSwitching ? ' is-store-switching' : ''}`}
      data-dealer-group={storeBrand.dealerGroupKey}
      data-oem={storeBrand.oemKey}
      data-ifx-oem={storeBrand.oemKey}
      data-store-theme={storeBrand.themeKey}
    >
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="desktop-nav" id="application-navigation" aria-label="Application navigation">
        <div className="brand-block">
          <FlowBrandLockup tenantLabel="Maxey" />
        </div>
        {primaryNavigation}
        <div className="nav-footer">
          <span className="nav-footer-copy">
            <strong>{homeStore}</strong>
            <small>4 connected stores</small>
          </span>
          <button
            type="button"
            className="nav-collapse-button"
            aria-label={navExpanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={navExpanded}
            aria-controls="application-navigation"
            onClick={() => setNavExpanded((current) => !current)}
          >
            {navExpanded ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            <span>{navExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
        </div>
      </aside>

      <header className={`top-bar${isInventoryRoute ? ' is-inventory-route' : ''}`}>
        <div className="mobile-brand" aria-label="Inventory Flow, Maxey workspace">
          <FlowBrandLockup tenantLabel="Maxey" compact />
        </div>

        <div className="store-control-region">
          <label className="store-control">
            <span className="store-brand-frame" key={`store-logo-${homeStore}`} aria-hidden="true">
              <img className="store-brand-logo" src={storeBrand.assetPath} alt="" />
            </span>
            <span className="store-control-copy">
              <span>Working location</span>
              <span className="store-select-wrap">
                <select
                  value={homeStore}
                  disabled={!storePreviewEnabled}
                  onChange={(event) => {
                    const nextStore = event.target.value as StoreName
                    runInterfaceTransition(() => setHomeStore(nextStore), 'oem')
                  }}
                  aria-label="Working location"
                  title={storePreviewEnabled ? 'Change the working location' : `Your account is assigned to ${homeStore}`}
                >
                  {STORE_NAMES.map((store) => <option key={store}>{store}</option>)}
                </select>
                <ChevronDown aria-hidden="true" />
              </span>
            </span>
          </label>
          {storeSwitching ? (
            <span className="store-switch-status" role="status" aria-live="polite">
              {storeBrand.oemLabel} · {homeStore}
            </span>
          ) : null}
        </div>

        {isInventoryRoute ? null : (
          <form className="global-search" onSubmit={handleSearch} role="search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setSearchDraft({ accessContext: searchAccessContext, query: event.target.value })}
              placeholder="Search stock, VIN, model, feature, salesperson, or hold"
              aria-label="Search inventory"
              autoComplete="off"
            />
            <button type="submit" aria-label="Search my store inventory">
              <ArrowRight aria-hidden="true" />
            </button>
          </form>
        )}

        <button
          type="button"
          className={`freshness-chip freshness-${freshnessState}`}
          onClick={openUtility}
          title={data?.meta.warnings.join('\n') || 'Latest inventory and hold update is current'}
          aria-label={`${freshnessLabel}. Open update details`}
          aria-haspopup="dialog"
          aria-expanded={utilityOpen}
          aria-controls="app-utility-dialog"
        >
          <span className="freshness-dot" aria-hidden="true" />
          <span>{freshnessLabel}</span>
          <small>{data ? formatDateTime(data.meta.completedAt) : ''}</small>
        </button>

        <button
          type="button"
          className="profile-button"
          aria-label="Open account and app controls"
          aria-haspopup="dialog"
          aria-expanded={utilityOpen}
          aria-controls="app-utility-dialog"
          onClick={openUtility}
        >
          <span className="profile-initials" aria-hidden="true">{userInitials}</span>
          <span className="profile-copy">
            <strong>{authenticatedUser}</strong>
            <small>{ROLE_LABELS[role]}</small>
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
      </header>

      <main ref={mainContentRef} className="app-main" id="main-content" tabIndex={-1}>
        {productionRolePreview && <div className="role-preview-banner" role="status"><span>Testing {ROLE_LABELS[role]} · Live records</span><button type="button" onClick={() => setRole('group_manager')}>Return to Group manager</button></div>}
        {data?.meta.warnings.some(warning => warning.includes('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS')) && <p className="synthetic-preview-notice">Demo · Synthetic records &amp; AI illustrations.</p>}{children}
      </main>

      <nav className={`mobile-bottom-nav${canSeeAdmin ? ' is-group-manager' : ''}`} aria-label="Mobile primary">
        {mobileNavigationItems.map(({ id, to, label, shortLabel, icon: Icon }) => {
          const active = isNavActive(id, to)
          return (
            <NavLink
              key={to}
              to={to}
              className={active ? 'is-active' : ''}
              aria-current={active ? 'page' : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{shortLabel}</span>
              {id === 'today' && attentionCount > 0 ? <b aria-label={`${attentionCount} items need attention today`}>{attentionCount}</b> : null}
            </NavLink>
          )
        })}
        <button
          type="button"
          className={utilityOpen ? 'is-active' : ''}
          aria-label="More app controls"
          aria-haspopup="dialog"
          aria-expanded={utilityOpen}
          aria-controls="app-utility-dialog"
          onClick={openUtility}
        >
          <Ellipsis aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

    </div>
    {utilityLayer && typeof document !== 'undefined' ? createPortal(utilityLayer, document.body) : null}
    </>
  )
}
