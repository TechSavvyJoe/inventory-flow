import { ROLE_PICKER_ROLES, STALE_AFTER_MS, STORES, WORKSPACES, workspaceFor } from './lib/config.mjs'
import { PanelApiError, fetchBootstrap, fetchVehicle } from './lib/api.mjs'
import { buildPanelData, copyFields, dealSheetText, mergeDetail, requestBlockedReason, roleLabel, toPanelVehicle, vehicleMoveAction } from './lib/model.mjs'
import { buildEntry, buildIndex, rank } from './lib/search.mjs'
import { EMPTY_FILTERS, SORTS, activeFilterCount, applyFilters, describeFilters, filterOptions, normalizeFilters, sortMatches } from './lib/filters.mjs'
import { groupMatchesByStore, resolveStoreScope, scopeCounts, scopeMatches } from './lib/scope.mjs'
import { compareVehicles } from './lib/compare.mjs'
import { certifiedTerms, vehicleInServiceSource, warrantyOutlook } from './lib/warranty.mjs'
import { sourceDistanceText } from './lib/source-distance.mjs'
import { brandFor } from './lib/brand.mjs'
import * as links from './lib/links.mjs'
import * as fmt from './lib/format.mjs'
import { clear, el, icon } from './lib/dom.mjs'
import { copyText, host, openExtensionPage, openUrl, placeholderPhotos, previewFlags, storage } from './lib/host.mjs'
import { takeHomeModel } from './lib/takehome.mjs'
import { serviceWorkflowStatus } from './lib/service-readiness.mjs'
import { sourceDisplayText } from './lib/source-text.mjs'
import { dealerMailTabId, checkLiveDealerMailHold, withLiveDealerMailHold } from './lib/live-dealermail-hold.mjs'
import { resourceSummaries } from './lib/resources.mjs'
import { syntheticPreviewPhotos } from './lib/synthetic-photos.mjs'

const $ = (id) => document.getElementById(id)
const ui = {
  panel: $('panel'), brand: $('brand'), who: $('who'), settingsBtn: $('settings-btn'),
  sticky: $('sticky'), search: $('search'), searchIcon: $('search-icon'), q: $('q'), clearBtn: $('clear'), kbd: $('search-kbd'),
  scope: $('scope'), scopeInd: $('scope-ind'), filtersBtn: $('filters-btn'), filterCount: $('filter-count'), filterSummary: $('filter-summary'), status: $('status'), rows: $('rows'), more: $('more'), skeleton: $('skeleton'), tray: $('tray'),
  storeRow: $('store-row'), storeSelect: $('store-select'), storeHome: $('store-home'), storeAll: $('store-all'), storeContext: $('store-context'), resultContext: $('result-context'), expandStores: $('expand-stores'), workspaceLinks: $('workspace-links'),
  back: $('back'), detailTitle: $('detail-bar-title'), detailTools: $('detail-tools'), detail: $('detail'),
  compareBack: $('compare-back'), compareTitle: $('compare-title'), compareTools: $('compare-tools'), compare: $('compare'),
  freshText: $('fresh-text'), refresh: $('refresh'),
  backdrop: $('sheet-backdrop'), sheet: $('sheet'), sheetClose: $('sheet-close'), sheetBody: $('sheet-body'), toast: $('toast'),
}

const PAGE = 60
const TABS = [['overview', 'Overview'], ['equipment', 'Equipment'], ['records', 'Records'], ['hold', 'Holds & moves']]
const state = {
  settings: null, workspace: null, data: null, bootstrap: null, index: [], results: [], shown: PAGE, details: new Map(), detailStatus: null,
  query: '', scope: 'inventory', storeScope: 'home', activeIndex: -1, selectedVin: null, view: 'list', tab: 'overview', photoIndex: 0, compare: [], odometer: new Map(), detailFailed: new Map(), detailPending: new Set(),
  filters: { ...EMPTY_FILTERS }, sort: 'relevance', sheetKind: 'settings',
  loading: false, error: null, fetchedAt: null, controller: null, toastTimer: null, sheetReturnFocus: null, previousView: 'list',
  dataGeneration: 0,
  liveHoldChecks: new Map(),
}

/* Icons that live in static markup */
ui.searchIcon.append(icon('search'))
ui.clearBtn.append(icon('x', { size: 14 }))
ui.settingsBtn.append(icon('sliders'))
ui.filtersBtn.prepend(icon('list', { size: 15 }))
ui.back.append(icon('chevron-left', { size: 18 }), 'Results')
ui.compareBack.append(icon('chevron-left', { size: 18 }), 'Back')
ui.refresh.append(icon('refresh', { size: 14 }))
ui.sheetClose.append(icon('x'))

/* Theme, density, width ------------------------------------------------ */
const darkQuery = matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  const resolved = state.settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : state.settings.theme
  document.documentElement.dataset.theme = resolved
}
darkQuery.addEventListener('change', () => state.settings && applyTheme())
function applyDensity() { document.documentElement.dataset.density = state.settings.density }
new ResizeObserver(([entry]) => {
  const width = entry.contentRect.width
  ui.panel.dataset.width = width < 352 ? 'narrow' : width < 430 ? 'medium' : 'wide'
  ui.q.placeholder = width < 352 ? 'Stock, VIN, model, equipment' : 'Stock, VIN, model, or equipment'
  positionIndicator(ui.scope, ui.scopeInd, '.scope-tab', 'aria-pressed')
  const tabs = ui.detail.querySelector('.tabs')
  if (tabs) positionIndicator(tabs, tabs.querySelector('.tabs-ind'), '.tab')
}).observe(ui.panel)

/* Toast ----------------------------------------------------------------- */
function toast(message, { iconName = 'check' } = {}) {
  clearTimeout(state.toastTimer)
  clear(ui.toast)
  ui.toast.append(icon(iconName, { size: 14 }), el('span', { text: message }))
  ui.toast.classList.add('is-in')
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('is-in'), 1800)
}

async function copy(value, label, button) {
  const ok = await copyText(String(value))
  if (!ok) { toast('Copy blocked by the browser', { iconName: 'alert' }); return }
  toast(`${label} copied`)
  if (button) {
    const original = button.querySelector('.icon')
    const check = icon('check', { size: original?.getAttribute('width') ?? 14 })
    if (original) original.replaceWith(check)
    button.classList.add('is-done')
    setTimeout(() => { button.classList.remove('is-done'); if (original) check.replaceWith(original) }, 1400)
  }
}

/* Data ------------------------------------------------------------------ */
function workingStore() { return state.data?.access?.store ?? (state.workspace.demo ? state.settings.demoStore : null) }
function appOrigin() { return host === 'preview' ? WORKSPACES.demo.origin : state.workspace.origin }

function cacheKey() {
  const identity = state.workspace.demo ? `${state.settings.demoRole}:${state.settings.demoStore}` : 'access'
  return `${state.workspace.origin}|${identity}`
}

function vehicleByVin(vin) { return state.data?.vehicles.find((item) => item.vin === vin) ?? null }

function updateLiveHold(vin, check) {
  if (!state.bootstrap || !state.data) return
  if (check) state.liveHoldChecks.set(vin, check)
  else state.liveHoldChecks.delete(vin)
  const position = state.data.vehicles.findIndex((item) => item.vin === vin)
  const raw = state.bootstrap.vehicles.find((item) => item.vin === vin)
  if (position < 0 || !raw) return
  const detail = state.details.get(vin)
  const base = toPanelVehicle(detail ? mergeDetail(raw, detail) : raw, state.bootstrap, { origin: appOrigin() })
  const updated = withLiveDealerMailHold(base, check)
  state.data.vehicles[position] = updated
  state.index[position] = buildEntry(updated)
  renderScopes()
  renderList()
  if (state.view === 'detail' && state.selectedVin === vin) renderDetail(updated, { keepScroll: true })
  if (state.view === 'compare') renderCompare()
}

async function verifyLiveHold(vin, stock) {
  if (host !== 'extension' || state.workspace.demo) return
  const generation = state.dataGeneration
  const tabId = await dealerMailTabId()
  if (generation !== state.dataGeneration) return
  if (!tabId) { updateLiveHold(vin, null); return }
  updateLiveHold(vin, { status: 'checking' })
  const check = await checkLiveDealerMailHold(tabId, stock)
  if (generation === state.dataGeneration && vehicleByVin(vin)?.stockNumber === stock) updateLiveHold(vin, check)
}

function hydrate(bootstrap, fetchedAt) {
  const before = state.data?.access
  const after = bootstrap.access
  if (before && (before.user !== after?.user || before.userId !== after?.userId || before.role !== after?.role || before.store !== after?.store)) resetIdentityView()
  state.dataGeneration += 1
  state.liveHoldChecks.clear()
  state.detailPending.clear()
  state.bootstrap = bootstrap
  state.data = buildPanelData(bootstrap, { origin: appOrigin() })
  state.index = buildIndex(state.data.vehicles)
  state.details.clear()
  state.detailFailed.clear()
  state.fetchedAt = fetchedAt
  state.error = null
  setCompare(state.compare.filter((vin) => vehicleByVin(vin)), { persist: false })
  renderWho()
  renderStorePicker()
  renderWorkspaceLinks()
  renderScopes()
  renderList()
  renderFreshness()
  if (state.view === 'detail' && state.selectedVin) {
    const vehicle = vehicleByVin(state.selectedVin)
    if (vehicle) { loadDetail(vehicle.vin); renderDetail(vehicle, { keepScroll: true }); verifyLiveHold(vehicle.vin, vehicle.stockNumber) }
  }
  if (state.view === 'compare') renderCompare()
}

async function load({ silent = false } = {}) {
  state.controller?.abort()
  const controller = new AbortController()
  state.controller = controller
  state.loading = true
  if (!silent) { ui.refresh.classList.add('is-spinning') }
  if (!state.data) showSkeleton()
  renderFreshness()
  try {
    const bootstrap = await fetchBootstrap(state.workspace, state.settings, { signal: controller.signal })
    if (controller.signal.aborted) return
    const fetchedAt = Date.now()
    hydrate(bootstrap, fetchedAt)
    await storage.setCache({ key: cacheKey(), fetchedAt, bootstrap })
  } catch (error) {
    if (error?.name === 'AbortError') return
    state.error = error instanceof PanelApiError ? error : new PanelApiError('invalid')
    // A sign-in or membership failure means the identity behind any cached
    // document can no longer be trusted.
    if (['signin', 'forbidden'].includes(state.error.kind)) {
      resetIdentityView()
      state.data = null; state.bootstrap = null; state.index = []; state.results = []
      clear(ui.rows); clear(ui.detail); clear(ui.compare); clear(ui.tray)
      renderScopes(); renderStorePicker(); renderWorkspaceLinks(); renderWho()
      ui.resultContext.hidden = true; ui.expandStores.hidden = true; ui.more.hidden = true; ui.tray.hidden = true
      storage.clearCache().catch(() => {})
    }
    if (!state.data) { hideSkeleton(); renderStatus() }
    else toast(errorTitle(state.error), { iconName: 'alert' })
    renderFreshness()
  } finally {
    if (state.controller === controller) { state.loading = false; ui.refresh.classList.remove('is-spinning'); renderFreshness() }
  }
}

function isStale() { return !state.fetchedAt || Date.now() - state.fetchedAt > STALE_AFTER_MS }

function photosFor(vehicle) {
  if (vehicle.photos.length) return vehicle.photos
  const illustrations = syntheticPreviewPhotos(vehicle, { host, workspace: state.workspace })
  if (illustrations.length) return illustrations
  return previewFlags.photos ? placeholderPhotos(vehicle) : []
}

/* Rendering: masthead + scope ----------------------------------------- */
function renderWho() {
  const access = state.data?.access
  ui.who.textContent = access ? roleLabel(access.role) : ''
  ui.who.title = access?.user ? `Signed in as ${access.user} · ${access.store}` : ''
}

function resetIdentityView() {
  state.dataGeneration += 1; state.detailPending.clear()
  state.storeScope = 'home'; state.scope = 'inventory'; state.query = ''; state.selectedVin = null; state.activeIndex = -1
  state.filters = { ...EMPTY_FILTERS }; state.sort = 'relevance'; state.compare = []; state.odometer.clear(); state.details.clear(); state.detailFailed.clear()
  state.view = 'list'; ui.panel.dataset.view = 'list'; ui.q.value = ''; ui.search.classList.remove('has-value'); ui.clearBtn.hidden = true
  clear(ui.detail); clear(ui.detailTools); clear(ui.compare); clear(ui.compareTools); clear(ui.tray)
  document.querySelector('.d-utilities')?.remove()
  ui.detailTitle.textContent = ''; ui.tray.hidden = true
  for (const view of document.querySelectorAll('[data-view-id]')) view.setAttribute('aria-hidden', String(view.dataset.viewId !== 'list'))
  storage.setCompare([]).catch(() => {}); storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {})
  renderFilterState()
}

function selectedStore() { return resolveStoreScope(state.storeScope, workingStore()) }
function storeLabel() { return selectedStore() || 'all stores' }
function rankedFiltered() { return applyFilters(rank(state.index, state.query), state.filters) }
function renderStorePicker() {
  ui.storeRow.hidden = !state.data
  ui.storeContext.textContent = workingStore() ? `${workingStore()} first` : ''
  clear(ui.storeSelect)
  if (!state.data) return
  const home = workingStore()
  if (home) ui.storeSelect.append(el('option', { value: 'home', text: home }))
  ui.storeSelect.append(el('option', { value: 'all', text: 'All stores' }))
  const stores = [...new Set([...STORES, ...state.data.vehicles.map((v) => v.homeStore)].filter(Boolean))]
  for (const store of stores) if (store !== home) ui.storeSelect.append(el('option', { value: store, text: store }))
  if (!home && state.storeScope === 'home') state.storeScope = 'all'
  ui.storeSelect.value = state.storeScope
  ui.storeRow.dataset.all = String(state.storeScope === 'all')
  ui.storeSelect.closest('label').hidden = Boolean(home && state.storeScope === 'all')
  ui.storeHome.hidden = !home || state.storeScope !== 'all'
  ui.storeHome.textContent = home || 'My store'
  ui.storeHome.setAttribute('aria-label', `Return to my store${home ? `, ${home}` : ''}`)
  ui.storeAll.setAttribute('aria-pressed', String(state.storeScope === 'all'))
  ui.storeAll.setAttribute('aria-label', 'Show inventory from all stores')
}

function setStoreScope(value) {
  state.storeScope = value; state.shown = PAGE; state.activeIndex = -1
  renderStorePicker(); renderList()
}

function renderWorkspaceLinks() {
  clear(ui.workspaceLinks); ui.workspaceLinks.hidden = !state.data
  if (!state.data) return
  const navButton = (label, name, destination, accessibleLabel = label) => el('button', { type: 'button', onclick: () => openUrl(links.workspaceUrl(appOrigin(), destination)), 'aria-label': `${accessibleLabel} (opens in app)`, title: `Open ${accessibleLabel.toLowerCase()} in Inventory Flow` }, icon(name, { size: 19 }), el('span', { text: label }))
  ui.workspaceLinks.append(
    navButton('New', 'car', 'new', 'New inventory'), navButton('Prices', 'tag', 'price', 'Price changes'),
    navButton('Moves', 'truck', 'moves', 'Vehicle moves'), navButton('Service', 'wrench', 'service'), navButton('Actions', 'bell', 'attention', 'Action center'),
  )
}

function scopeDefinitions() {
  const counts = scopeCounts(rankedFiltered(), { storeScope: state.storeScope, workingStore: workingStore() })
  return [
    { id: 'inventory', label: 'All', count: counts.inventory },
    { id: 'held', label: 'Held', count: counts.held },
    { id: 'moving', label: 'Moving', count: counts.moving },
  ]
}

function renderScopes() {
  // Counts are only honest once inventory has loaded; until then the row is
  // not shown at all rather than showing zeros.
  ui.scope.parentElement.hidden = !state.data
  const scopes = scopeDefinitions()
  const focusedScope = document.activeElement?.dataset?.scope
  for (const node of [...ui.scope.querySelectorAll('.scope-tab')]) node.remove()
  for (const scope of scopes) {
    ui.scope.append(el('button', {
      type: 'button', class: 'scope-tab', id: `scope-${scope.id}`, dataset: { scope: scope.id },
      'aria-pressed': String(scope.id === state.scope), tabindex: scope.id === state.scope ? '0' : '-1',
      onclick: () => setScope(scope.id),
      'aria-label': `${scope.label === 'All' ? 'All inventory' : scope.label} (${fmt.formatNumber(scope.count)})`,
    }, scope.label))
  }
  positionIndicator(ui.scope, ui.scopeInd, '.scope-tab', 'aria-pressed')
  if (focusedScope) ui.scope.querySelector(`[data-scope="${focusedScope}"]`)?.focus({ preventScroll: true })
}

function positionIndicator(container, indicator, selector, selectedAttribute = 'aria-selected') {
  const active = container?.querySelector(`${selector}[${selectedAttribute}="true"]`)
  if (!active || !indicator) return
  indicator.style.width = `${active.offsetWidth}px`
  indicator.style.transform = `translateX(${active.offsetLeft}px)`
}

function setScope(id) {
  if (state.scope === id) return
  state.scope = id
  // A Held view and a No hold filter can never match. The explicit view wins.
  if (id === 'held' && state.filters.noHold) { state.filters = { ...state.filters, noHold: false }; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState() }
  state.shown = PAGE
  state.activeIndex = -1
  for (const tab of ui.scope.querySelectorAll('.scope-tab')) {
    const selected = tab.dataset.scope === id
    tab.setAttribute('aria-pressed', String(selected))
    tab.tabIndex = selected ? 0 : -1
  }
  positionIndicator(ui.scope, ui.scopeInd, '.scope-tab', 'aria-pressed')
  renderList()
}

/* Rendering: list ------------------------------------------------------ */
function currentResults() {
  const hasQuery = Boolean(state.query.trim())
  const ranked = scopeMatches(rankedFiltered(), { storeScope: state.storeScope, workingStore: workingStore(), view: state.scope })
  const sorted = sortMatches(ranked, state.sort, { hasQuery })
  return selectedStore() ? sorted : groupMatchesByStore(sorted, workingStore()).flatMap((group) => group.matches)
}

function renderFilterState() {
  const count = activeFilterCount(state.filters)
  ui.filterCount.hidden = count === 0
  ui.filterCount.textContent = String(count)
  ui.filtersBtn.classList.toggle('is-on', count > 0 || state.sort !== 'relevance')
  const summary = [describeFilters(state.filters), state.sort !== 'relevance' ? `sorted by ${SORTS.find((item) => item.id === state.sort)?.label.toLowerCase()}` : null].filter(Boolean).join(' · ')
  clear(ui.filterSummary)
  ui.filterSummary.hidden = !summary
  if (summary) ui.filterSummary.append(el('span', { text: summary }), el('button', { type: 'button', class: 'd-inline', onclick: () => { state.filters = { ...EMPTY_FILTERS }; state.sort = 'relevance'; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList() } }, 'Clear'))
}

function locationNode(vehicle) {
  const loc = vehicle.location
  const away = loc.store && loc.store !== vehicle.homeStore
  return el('span', { class: `loc ${loc.provenance === 'app-confirmed' ? 'is-confirmed' : ''} ${away ? 'is-away' : ''}`.trim(), title: locationTitle(vehicle) }, icon('pin'), el('span', { text: loc.label }))
}

function locationTitle(vehicle) {
  const loc = vehicle.location
  return fmt.joinFacts([loc.label, loc.custodian]) || 'Location needs review'
}

function holdPill(vehicle, { long = false } = {}) {
  const hold = vehicle.hold
  const tone = hold.tone === 'held' ? 'pill-held' : hold.tone === 'clear' ? '' : 'pill-moving'
  const primary = hold.canViewEvidence ? hold.evidence.find((item) => item.position === 'primary') ?? hold.evidence[0] : null
  const label = hold.tone === 'held'
    ? primary?.salesperson ? `Held by ${primary.salesperson}`
      : hold.position === 'backup' ? 'Held · backup'
        : hold.position === 'multiple' ? `Held · ${hold.backupCount + 1}`
          : long ? hold.label : hold.liveCheckStatus === 'verified' ? 'Held' : 'Held at capture'
    : hold.tone === 'clear' ? (hold.liveCheckStatus === 'verified' ? 'No active hold' : 'No hold at capture') : 'Hold unverified'
  return el('span', { class: `pill ${tone}`.trim(), title: fmt.joinFacts([hold.label, primary?.salesperson ? `Held by ${primary.salesperson}` : null]) }, hold.tone === 'held' ? icon('lock') : null, label)
}

function movementPill(vehicle) {
  const move = vehicle.movement
  if (!move) return null
  return el('span', { class: `pill ${move.overdue ? 'pill-alert' : 'pill-moving'}`, title: move.nextAction ?? move.label ?? 'Move in progress' }, icon('truck'), move.overdue ? 'Move overdue' : 'Moving')
}

function certifiedBadge(vehicle, { size = 'sm' } = {}) {
  if (!vehicle.certifiedProgram) return null
  const program = vehicle.certifiedProgram
  const logo = program.brand === 'ford' ? '../resource-brands/ford-blue-certified.svg' : program.brand === 'lincoln' ? '../resource-brands/lincoln-certified.png' : null
  return el('span', { class: `cert cert-${size} ${program.brand ? `cert-${program.brand} cert-logo` : ''}`.trim(), title: `${program.name} — separate from any factory warranty still running` }, logo ? el('img', { src: logo, alt: program.name }) : icon('badge-check'), program.brand === 'lincoln' ? null : program.short)
}

function rowThumb(vehicle) {
  const photos = photosFor(vehicle)
  if (photos.length) {
    let index = 0
    const frame = el('span', { class: 'row-thumb' })
    const photo = el('img', { src: photos[0], alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: () => {
      index += 1
      if (index < photos.length) photo.src = photos[index]
      else { clear(frame); frame.classList.add('is-empty'); frame.append(icon('image', { size: 16 })); frame.title = 'Photos could not load' }
    } })
    frame.append(photo)
    const count = vehicle.specs.photoCount ?? photos.length
    if (count > 1) frame.append(el('span', { class: 'row-photo-count', title: `${count} photos`, text: String(count) }))
    return frame
  }
  return el('span', { class: 'row-thumb is-empty', title: 'No photos published' }, icon('image', { size: 13 }))
}

function renderRow(match, position) {
  const vehicle = match.vehicle
  const metaParts = [fmt.formatMoney(vehicle.price), vehicle.mileage !== null ? fmt.formatMileage(vehicle.mileage) : null]
  const via = state.query && match.matchedLabels.find((label) => !['Stock', 'VIN', 'Vehicle', 'Make', 'Model', 'Year', 'Trim'].includes(label))
  const inCompare = state.compare.includes(vehicle.vin)
  const config = fmt.joinFacts([vehicle.exteriorColor, vehicle.daysListed !== null ? `${fmt.formatNumber(vehicle.daysListed)} days listed` : null])
  const powertrain = fmt.joinFacts([vehicle.engine, vehicle.drivetrain])
  const primaryHold = vehicle.hold.canViewEvidence ? vehicle.hold.evidence[0] : null
  const holdDetail = vehicle.hold.hasActiveHold === true ? fmt.joinFacts([primaryHold?.salesperson ? `Held by ${primaryHold.salesperson}` : null, primaryHold?.expectedDate ? `Expected ${fmt.formatDate(primaryHold.expectedDate)}` : null, vehicle.hold.backupCount ? `${vehicle.hold.backupCount} backup${vehicle.hold.backupCount === 1 ? '' : 's'}` : null]) : null
  return el('li', {
    class: `row ${position === state.activeIndex ? 'is-active' : ''} ${inCompare ? 'is-compared' : ''}`.trim(), role: 'option', id: `row-${vehicle.vin}`,
    'aria-selected': String(position === state.activeIndex), dataset: { vin: vehicle.vin, index: String(position) },
    onclick: () => openDetail(vehicle),
  },
    el('span', { class: 'plate' }, rowThumb(vehicle), el('b', { text: vehicle.stockNumber, title: `Stock ${vehicle.stockNumber}` })),
    el('span', { class: 'row-main' },
      el('span', { class: 'row-title', text: vehicle.name, title: vehicle.name }),
      el('span', { class: 'row-meta', title: fmt.joinFacts([metaParts[0], metaParts[1], fmt.formatDays(vehicle.daysListed)]) }, el('strong', { text: metaParts[0] }), metaParts.slice(1).some(Boolean) ? ' · ' : '', fmt.joinFacts(metaParts.slice(1))),
      powertrain ? el('span', { class: 'row-spec row-powertrain', text: powertrain, title: powertrain }) : null,
      config ? el('span', { class: 'row-spec', text: config, title: config }) : null,
      via ? el('span', { class: 'row-match', text: `Matched ${via.toLowerCase()}` }) : null,
    ),
    inCompare ? el('span', { class: 'row-cmp', title: 'In the compare set' }, icon('columns', { size: 13 })) : icon('chevron-right', { size: 14 }),
    el('span', { class: 'row-operations' },
      el('span', { class: 'row-status' }, el('strong', { class: 'row-store', text: vehicle.homeStore }), certifiedBadge(vehicle), holdPill(vehicle), servicePill(vehicle)),
      vehicle.movement ? el('span', { class: 'row-movement' }, movementPill(vehicle), vehicle.movement.destination ? el('span', { text: `To ${vehicle.movement.destination}` }) : null) : null,
      holdDetail ? el('span', { class: 'row-spec row-hold-detail', text: holdDetail, title: holdDetail }) : null,
      vehicle.location.store !== vehicle.homeStore || vehicle.location.provenance === 'app-confirmed' || vehicle.location.conflict ? locationNode(vehicle) : null,
    ),
    state.scope === 'moving' ? el('span', { class: 'row-workflow-summary' },
      el('span', { text: fmt.joinFacts([vehicle.movement?.nextAction, vehicle.movement?.dueAt ? `Due ${fmt.formatDateTime(vehicle.movement.dueAt)}` : null]) || 'Open vehicle for move details' }),
      el('b', {}, 'Vehicle details', icon('chevron-right', { size: 13 })),
    ) : rowDocumentFacts(vehicle),
  )
}

function importantSourceNote(note) {
  return /saved|partial|incomplete|refresh|stale|unavailable|unknown|unrecognized|future|not captured/i.test(note ?? '')
}

function sourceNoteLabel(note) {
  if (/saved report/i.test(note)) return 'Saved report'
  if (/partial|incomplete/i.test(note)) return 'Partial'
  if (/refresh/i.test(note)) return 'Refresh'
  if (/stale/i.test(note)) return 'Older capture'
  if (/unavailable/i.test(note)) return 'Unavailable'
  if (/unknown|unrecognized/i.test(note)) return 'Check source'
  if (/not captured/i.test(note)) return 'Not captured'
  return 'Source note'
}

function scanFact(resource) {
  const [primary, ...remaining] = resource.compactFacts
  const full = [primary, ...remaining].filter(Boolean).join(' · ')
  if (!primary) return null
  // Keep both decision facts visible: the second line often holds a history
  // check or installed equipment that would otherwise require opening a VIN.
  return el('span', { class: 'row-doc-facts', title: full },
    el('span', { text: primary }),
    ...remaining.map(text => el('span', { class: 'row-doc-secondary', text })),
  )
}

function sourceNoteBadge(note) {
  if (!importantSourceNote(note)) return null
  return el('span', { class: 'row-doc-note', title: note, 'aria-label': note },
    sourceNoteLabel(note),
    el('span', { class: 'visually-hidden', text: `: ${note}` }),
  )
}

function rowDocumentFacts(vehicle) {
  const summaries = resourceSummaries(vehicle).filter(resource => resource.hasCapturedData && resource.id !== 'invoice'
    && (resource.id !== 'window-sticker' || !['incomplete', 'unavailable', 'unknown'].includes(vehicle.documents.windowSticker?.dataState)))
  const prioritized = [...summaries.filter(resource => resource.id === 'oasis' && resource.compactFacts.some(fact => /Open FSA/i.test(fact))), ...summaries.filter(resource => !(resource.id === 'oasis' && resource.compactFacts.some(fact => /Open FSA/i.test(fact))))].slice(0, 3)
  if (!prioritized.length) return null
  // Listbox options keep one coherent keyboard action: open this vehicle.
  // Originals and saved-record actions are separate controls in its detail view.
  return el('span', { class: 'row-documents', 'aria-label': 'Vehicle record highlights. Open the vehicle for complete details.' }, ...prioritized.map(resource =>
    el('span', { class: 'row-doc-summary', dataset: { resource: resource.id } },
      el('span', { class: 'row-doc-provider' }, resource.brand ? resourceBrand(resource.brand, 'row-doc-brand') : icon('file-text'), resource.brand === 'autocheck' || resource.brand === 'vauto' ? null : el('b', { text: resource.id === 'oasis' ? 'OASIS' : 'Sticker' }), sourceNoteBadge(resource.sourceNote)),
      el('span', { class: 'row-doc-content' }, scanFact(resource)),
    )),
  )
}

function renderList() {
  if (!state.data) return
  hideSkeleton()
  state.results = currentResults()
  renderScopes()
  renderResultsContext()
  clear(ui.rows)
  clear(ui.more)
  ui.more.hidden = true
  renderTray()
  ui.rows.removeAttribute('aria-activedescendant')
  if (state.results.length === 0) { state.activeIndex = -1; renderStatus(); return }
  ui.status.hidden = true
  const visible = state.results.slice(0, state.shown)
  let previousStore = null
  visible.forEach((match, position) => {
    if (!selectedStore() && match.vehicle.homeStore !== previousStore) {
      previousStore = match.vehicle.homeStore
      const count = state.results.filter((item) => item.vehicle.homeStore === previousStore).length
      const label = `${previousStore || 'Store not provided'}${previousStore === workingStore() ? ' · My store' : ''}`
      ui.rows.append(el('li', { class: 'store-group', role: 'presentation' }, icon('store', { size: 14 }), el('span', { text: label }), el('b', { text: fmt.formatNumber(count) })))
    }
    ui.rows.append(renderRow(match, position))
  })
  if (state.results.length > visible.length) {
    ui.more.hidden = false
    ui.more.append(el('button', { type: 'button', onclick: () => { state.shown += PAGE; renderList() } }, `Show ${fmt.formatNumber(Math.min(PAGE, state.results.length - visible.length))} more of ${fmt.formatNumber(state.results.length)}`))
  }
  if (state.activeIndex >= 0) ui.rows.setAttribute('aria-activedescendant', `row-${visible[state.activeIndex]?.vehicle.vin ?? ''}`)
  else ui.rows.removeAttribute('aria-activedescendant')
}

const SERVICE_LABELS = { needs_service: 'Waiting for service', in_service: 'In service', serviced: 'Ready' }
function servicePill(vehicle) {
  const status = serviceWorkflowStatus(vehicle.serviceReadiness)
  return el('span', { class: `service-pill service-pill--${status}`, title: status === 'needs_service' && vehicle.serviceReadiness?.readinessBasis === 'unconfirmed' ? 'No service status has been recorded. A manager can confirm Waiting, In service, or Ready.' : `Service status: ${SERVICE_LABELS[status]}` }, icon(status === 'serviced' ? 'check' : 'wrench'), SERVICE_LABELS[status])
}

function renderResultsContext() {
  const count = state.results.length
  ui.resultContext.hidden = false
  clear(ui.resultContext)
  ui.resultContext.append(el('span', { text: `${fmt.formatNumber(count)} ${state.scope === 'held' ? 'held vehicle' : state.scope === 'moving' ? 'moving vehicle' : 'vehicle'}${count === 1 ? '' : 's'} · ${storeLabel()}` }))
  ui.storeAll.textContent = `All ${fmt.formatNumber(scopeMatches(rankedFiltered(), { storeScope: 'all', view: state.scope }).length)}`
  clear(ui.expandStores)
  const other = selectedStore() ? scopeMatches(rankedFiltered(), { storeScope: 'all', view: state.scope }).filter(({ vehicle }) => vehicle.homeStore !== selectedStore()).length : 0
  ui.expandStores.hidden = !other
  if (other) ui.expandStores.append(el('button', { type: 'button', onclick: () => setStoreScope('all'), 'aria-label': `Include other stores (${fmt.formatNumber(other)} more vehicles)` }, 'All stores', el('b', { text: `+${fmt.formatNumber(other)}` }), icon('chevron-right', { size: 14 })))
}

function setActive(index) {
  const max = Math.min(state.results.length, state.shown) - 1
  state.activeIndex = Math.max(-1, Math.min(max, index))
  for (const row of ui.rows.querySelectorAll('.row')) {
    const active = Number(row.dataset.index) === state.activeIndex
    row.classList.toggle('is-active', active)
    row.setAttribute('aria-selected', String(active))
    if (active) { row.scrollIntoView({ block: 'nearest' }); ui.rows.setAttribute('aria-activedescendant', row.id) }
  }
  if (state.activeIndex < 0) ui.rows.removeAttribute('aria-activedescendant')
}

/* Rendering: status ----------------------------------------------------- */
function errorTitle(error) {
  return { signin: 'Sign in to Inventory Flow', forbidden: 'This account is not registered yet', offline: state.workspace.demo ? 'The local demo is not running' : 'Inventory Flow is unreachable', server: 'Inventory Flow had a problem', invalid: 'Unexpected response' }[error?.kind] ?? 'Something went wrong'
}

function renderStatus() {
  clear(ui.status)
  ui.status.hidden = false
  ui.status.classList.remove('is-empty')
  const actions = el('div', { class: 'status-actions' })
  const error = state.error
  if (!state.data && error) {
    const iconName = error.kind === 'signin' ? 'lock' : 'alert'
    ui.status.append(el('div', { class: 'status-icon' }, icon(iconName, { size: 18 })), el('h3', { text: errorTitle(error) }))
    if (error.kind === 'signin') {
      ui.status.append(el('p', { text: 'The panel uses your Inventory Flow sign-in. Sign in once in a tab and come back — nothing else to set up.' }))
      actions.append(el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openUrl(links.appHomeUrl(appOrigin())) }, icon('external'), 'Open Inventory Flow'))
    } else if (error.kind === 'forbidden') {
      ui.status.append(el('p', { text: 'You are signed in, but Inventory Flow has not enabled this account. Ask a manager to add you.' }))
      if (error.code) ui.status.append(el('p', {}, 'Code ', el('code', { text: error.code })))
    } else if (error.kind === 'offline') {
      ui.status.append(el('p', { text: state.workspace.demo ? 'Start it from the repository, then retry.' : 'Check the network, then retry. Nothing was changed.' }))
      if (state.workspace.demo) ui.status.append(el('p', {}, el('code', { text: 'pnpm dev:demo' })))
    } else if (error.kind === 'server') {
      ui.status.append(el('p', { text: `The app answered ${error.status || 'with an error'}. Retry in a moment; if it keeps happening, open the app to check its status.` }))
    } else {
      ui.status.append(el('p', { text: 'The response did not look like Inventory Flow inventory. Check the workspace in Settings.' }))
    }
    actions.append(el('button', { type: 'button', class: 'btn', onclick: () => load() }, icon('refresh'), 'Retry'))
    if (error.kind !== 'signin') actions.append(el('button', { type: 'button', class: 'btn', onclick: openSheet }, icon('sliders'), 'Settings'))
    ui.status.append(actions)
    return
  }
  ui.status.classList.add('is-empty')
  const query = state.query.trim()
  if (query) {
    ui.status.append(el('div', { class: 'status-icon' }, icon('search', { size: 18 })), el('h3', {}, 'No matches for ', el('q', { text: query })))
    ui.status.append(el('p', { text: `Nothing in ${storeLabel()} matches${activeFilterCount(state.filters) ? ' with these filters' : ''}. Try a stock number, the last 8 of the VIN, or a make and model.` }))
    if (activeFilterCount(state.filters)) actions.append(el('button', { type: 'button', class: 'btn', onclick: () => { state.filters = { ...EMPTY_FILTERS }; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList() } }, 'Clear filters'))
    actions.append(el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.inventorySearchUrl(appOrigin(), query)) }, icon('external'), 'Search in the app'))
  } else {
    const filtered = activeFilterCount(state.filters) > 0
    ui.status.append(el('div', { class: 'status-icon' }, icon('car', { size: 18 })), el('h3', { text: filtered ? 'No vehicles match these filters' : state.scope === 'held' ? 'No current DealerMail holds' : state.scope === 'moving' ? 'No vehicles moving in this view' : 'No vehicles in this view' }))
    ui.status.append(el('p', { text: filtered ? `Nothing in ${storeLabel()} fits ${describeFilters(state.filters)}. Clear a filter or choose another store.` : state.scope === 'held' ? `No current DealerMail holds were found in ${storeLabel()}. Hold status alone does not confirm availability.` : state.scope === 'moving' ? `No active vehicle moves were found in ${storeLabel()}. Choose All to see the rest of the inventory.` : 'The selected release has no vehicles for this store.' }))
    if (filtered) actions.append(el('button', { type: 'button', class: 'btn', onclick: () => { state.filters = { ...EMPTY_FILTERS }; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList() } }, 'Clear filters'))
  }
  if (actions.childElementCount) ui.status.append(actions)
}

function showSkeleton() {
  ui.status.hidden = true
  clear(ui.rows)
  clear(ui.skeleton)
  for (let index = 0; index < 7; index += 1) {
    ui.skeleton.append(el('div', { class: 'sk-row' }, el('span', { class: 'sk sk-plate' }), el('span', { class: 'sk-lines' }, el('span', { class: 'sk sk-title' }), el('span', { class: 'sk sk-meta' }), el('span', { class: 'sk sk-pill' }))))
  }
  ui.skeleton.hidden = false
}
function hideSkeleton() { ui.skeleton.hidden = true; clear(ui.skeleton) }

/* Rendering: freshness -------------------------------------------------- */
function renderFreshness() {
  clear(ui.freshText)
  if (!state.data) {
    ui.freshText.append(state.loading ? 'Loading inventory…' : state.error ? 'Not connected' : '')
    return
  }
  const meta = state.data.meta
  const stale = isStale()
  const problem = meta.publicFreshness !== 'current' || meta.dealerMailFreshness !== 'current'
  ui.freshText.append(
    state.workspace.demo ? el('span', { class: 'demo-disclosure', text: 'Demo · synthetic records & illustrations' }) : '',
    el('span', { class: `dot ${state.error ? 'is-off' : problem ? 'is-stale' : ''}`.trim() }),
    `${fmt.formatReportDate(meta.reportDate)} release`,
    meta.dealerMailCapturedAt ? ` · holds captured ${fmt.formatDateTime(meta.dealerMailCapturedAt)}` : ' · daily hold snapshot',
    problem ? ' · review needed' : '',
    ` · ${state.loading ? 'refreshing…' : `checked ${fmt.formatRelative(state.fetchedAt)}`}${stale && !state.loading ? ' · update needed' : ''}`,
  )
  ui.freshText.title = 'Inventory status'
}

/* Compare set ----------------------------------------------------------- */
function setCompare(vins, { persist = true } = {}) {
  state.compare = [...new Set(vins)].slice(0, 3)
  if (persist) storage.setCompare(state.compare).catch(() => {})
  renderTray()
}

function toggleCompare(vehicle, button) {
  const has = state.compare.includes(vehicle.vin)
  if (!has && state.compare.length >= 3) { toast('Compare holds three vehicles', { iconName: 'alert' }); return }
  setCompare(has ? state.compare.filter((vin) => vin !== vehicle.vin) : [...state.compare, vehicle.vin])
  toast(has ? 'Removed from compare' : `Comparing ${state.compare.length}`)
  if (button) { button.setAttribute('aria-pressed', String(!has)); button.classList.toggle('is-on', !has) }
  const row = ui.rows.querySelector(`#row-${CSS.escape(vehicle.vin)}`)
  if (row) row.classList.toggle('is-compared', !has)
}

function renderTray() {
  clear(ui.tray)
  const vehicles = state.compare.map(vehicleByVin).filter(Boolean)
  ui.tray.hidden = vehicles.length === 0
  if (!vehicles.length) return
  ui.tray.append(
    el('span', { class: 'tray-text' }, icon('columns', { size: 14 }), el('b', { text: `Compare ${vehicles.length}` }), el('span', { text: vehicles.map((item) => item.stockNumber).join(' · ') })),
    el('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: vehicles.length < 2, title: vehicles.length < 2 ? 'Add one more vehicle to compare' : 'Open the comparison', onclick: openCompare }, 'Open'),
    el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Clear compare set', onclick: () => { setCompare([]); renderList() } }, icon('x', { size: 14 })),
  )
}

/* Rendering: detail ----------------------------------------------------- */
function chip(label, iconName, onClick, { title, pressed = null } = {}) {
  return el('button', { type: 'button', class: `chip ${pressed ? 'is-on' : ''}`.trim(), title: title ?? label, 'aria-pressed': pressed === null ? null : String(pressed), onclick: (event) => onClick(event.currentTarget) }, icon(iconName), label)
}

function copyButton(value, label, { size = 13, className = '' } = {}) {
  return el('button', { type: 'button', class: `copy-btn ${className}`.trim(), 'aria-label': `Copy ${label}`, title: `Copy ${label}`, onclick: (event) => { event.stopPropagation(); copy(value, label, event.currentTarget) } }, icon('copy', { size }))
}

function section(label, children, { pill, iconName } = {}) {
  return el('section', { class: 'd-section' }, el('h3', { class: 'd-label' }, iconName ? icon(iconName, { size: 13 }) : null, label, pill ?? null), ...children.flat().filter(Boolean))
}

function line(iconName, strong, rest) {
  return el('div', { class: 'd-line' }, icon(iconName), el('span', {}, strong ? el('b', { text: strong }) : null, strong && rest ? ' · ' : '', rest ?? ''))
}

function kv(pairs) {
  const node = el('dl', { class: 'd-kv' })
  for (const [label, value, copyValue] of pairs) {
    if (value === null || value === undefined || value === '' || value === '—') continue
    node.append(el('dt', { text: label }), el('dd', {}, el('span', { text: value }), copyValue !== undefined && copyValue !== null ? copyButton(copyValue, label, { size: 12 }) : null))
  }
  return node.childElementCount ? node : null
}

/** "at_home" / "approved" -> "At home" / "Approved" for server state tokens. */
function humanize(value) {
  if (!value) return null
  const spaced = String(value).replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function fieldText(field, vehicle) {
  if (field.value === null || field.value === undefined || field.value === '') return '—'
  if (field.kind === 'money') return field.from === 'sticker' ? fmt.formatStickerMoney(field.value, vehicle.documents.windowSticker) : field.from === 'label' ? fmt.formatReferencePrice(field.value) : fmt.formatMoney(field.value)
  if (field.kind === 'mileage') return fmt.formatMileage(field.value)
  if (field.kind === 'date') return fmt.formatDate(field.value)
  return String(field.value)
}

function hero(vehicle) {
  const photos = photosFor(vehicle)
  const brand = brandFor(vehicle.homeStore)
  const logo = brand ? el('span', { class: `hero-logo ${brand.wide ? '' : 'is-square'}`.trim(), title: brand.alt }, el('img', { src: brand.src, alt: brand.alt })) : null
  if (!photos.length) {
    const count = vehicle.specs.photoCount
    return el('div', { class: 'hero is-empty' },
      el('div', { class: 'hero-empty' }, icon('image', { size: 18 }), el('span', { text: count ? `${fmt.formatNumber(count)} photo${count === 1 ? '' : 's'} on the listing` : 'No photos published' })),
      logo,
      vehicle.listing.url ? el('button', { type: 'button', class: 'hero-open', onclick: () => openUrl(vehicle.listing.url) }, 'Open listing', icon('external', { size: 12 })) : null,
    )
  }
  state.photoIndex = Math.min(state.photoIndex, photos.length - 1)
  const alt = (index) => `${vehicle.name}, photo ${index + 1} of ${photos.length}`
  const count = el('span', { class: 'hero-count num', text: `${state.photoIndex + 1} / ${photos.length}` })
  const thumbs = photos.length > 1 ? el('div', { class: 'hero-thumbs', role: 'group', 'aria-label': 'Photos' }) : null
  const failedPhotos = new Set()
  const show = (index) => {
    state.photoIndex = (index + photos.length) % photos.length
    img.src = photos[state.photoIndex]
    img.alt = alt(state.photoIndex)
    count.textContent = `${state.photoIndex + 1} / ${photos.length}`
    if (thumbs) for (const thumb of thumbs.children) { const on = Number(thumb.dataset.index) === state.photoIndex; thumb.classList.toggle('is-on', on); thumb.setAttribute('aria-pressed', String(on)); if (on) thumb.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  const img = el('img', { class: 'hero-img', src: photos[state.photoIndex], alt: alt(state.photoIndex), decoding: 'async', referrerpolicy: 'no-referrer', onerror: () => {
    failedPhotos.add(state.photoIndex)
    let next = null
    for (let offset = 1; offset < photos.length; offset += 1) {
      const candidate = (state.photoIndex + offset) % photos.length
      if (!failedPhotos.has(candidate)) { next = candidate; break }
    }
    if (next !== null) { show(next); return }
    clear(frame)
    frame.classList.add('is-empty')
    frame.removeAttribute('tabindex')
    frame.removeAttribute('aria-label')
    frame.append(el('span', { class: 'hero-empty' }, icon('image', { size: 18 }), el('span', { text: 'Photos could not load' })), logo)
    thumbs?.setAttribute('hidden', '')
  } })
  if (thumbs) photos.slice(0, 16).forEach((src, index) => thumbs.append(el('button', { type: 'button', class: `hero-thumb ${index === state.photoIndex ? 'is-on' : ''}`.trim(), dataset: { index: String(index) }, 'aria-label': `Photo ${index + 1}`, 'aria-pressed': String(index === state.photoIndex), onclick: () => show(index) }, el('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }))))
  const frame = el('div', { class: 'hero-frame', tabindex: '0', 'aria-label': 'Vehicle photos, use the arrow keys', onkeydown: (event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); show(state.photoIndex - 1) } if (event.key === 'ArrowRight') { event.preventDefault(); show(state.photoIndex + 1) } } },
    img, logo, count,
    photos.length > 1 ? el('button', { type: 'button', class: 'hero-nav hero-prev', 'aria-label': 'Previous photo', onclick: () => show(state.photoIndex - 1) }, icon('chevron-left', { size: 18 })) : null,
    photos.length > 1 ? el('button', { type: 'button', class: 'hero-nav hero-next', 'aria-label': 'Next photo', onclick: () => show(state.photoIndex + 1) }, icon('chevron-right', { size: 18 })) : null,
  )
  return el('section', { class: 'hero detail-gallery', 'aria-label': 'Vehicle photos' },
    el('div', { class: 'detail-section-head' }, el('h3', { text: `Photos (${photos.length})` }), vehicle.listing.url ? el('button', { type: 'button', class: 'link-btn', onclick: () => openUrl(vehicle.listing.url) }, 'View listing', icon('external', { size: 13 })) : null),
    el('div', { class: `detail-gallery-body ${thumbs ? 'has-thumbs' : ''}` }, frame, thumbs))
}

function identity(vehicle) {
  return el('div', { class: 'd-head' },
    el('h1', { class: 'd-name', text: vehicle.name }),
    el('div', { class: 'price-row' },
      el('strong', { class: 'detail-price num', text: vehicle.price !== null ? fmt.formatMoney(vehicle.price) : 'Price not published' }),
      vehicle.mileage !== null ? el('span', { class: 'num', text: `· ${fmt.formatMileage(vehicle.mileage)}` }) : null,
    ),
    el('div', { class: 'detail-home' }, el('span', { text: vehicle.homeStore }), vehicle.daysListed !== null ? el('span', { text: `· ${fmt.formatNumber(vehicle.daysListed)} days listed` }) : null, certifiedBadge(vehicle)),
    el('div', { class: 'service-summary detail-status-line' },
      holdPill(vehicle), servicePill(vehicle), movementPill(vehicle),
      vehicle.serviceReadiness?.completedAt ? el('span', { text: `Completed ${fmt.formatDate(vehicle.serviceReadiness.completedAt)}` }) : vehicle.serviceReadiness?.serviceEnteredAt ? el('span', { text: `Since ${fmt.formatDate(vehicle.serviceReadiness.serviceEnteredAt)}` }) : null,
    ),
    vehicle.serviceReadiness?.readinessBasis === 'unconfirmed' ? el('p', { class: 'service-unconfirmed', text: 'Service not yet confirmed · manager review needed' }) : null,
  )
}

function fact(label, value, muted = false, title) {
  return el('div', { class: 'd-fact' }, el('small', { text: label }), el('strong', { class: muted ? 'is-muted' : '', text: value, title: title ?? null }))
}

function signal({ tone, iconName, label, value, sub, onClick, title }) {
  return el('button', { type: 'button', class: `sig is-${tone}`, title: title ?? null, onclick: onClick },
    el('span', { class: 'sig-icon' }, icon(iconName, { size: 15 })),
    el('span', { class: 'sig-body' }, el('small', { text: label }), el('strong', { text: value }), sub ? el('span', { text: sub }) : null),
  )
}

function statusGrid(vehicle) {
  const hold = vehicle.hold, loc = vehicle.location, move = vehicle.movement, listing = vehicle.listing
  const primary = hold.evidence[0]
  const holdValue = hold.tone === 'held' ? (primary?.salesperson ? `Held by ${primary.salesperson}` : hold.position === 'backup' ? 'Backup hold' : hold.position === 'multiple' ? `${hold.backupCount + 1} holds` : 'On hold') : hold.tone === 'clear' ? 'No hold found' : 'Not verified'
  const holdSub = hold.tone === 'held'
    ? fmt.joinFacts([hold.liveCheckStatus === 'verified' ? 'Verified in DealerMail' : 'At daily capture', primary?.expectedDate ? `Expected ${fmt.formatDate(primary.expectedDate)}` : null, hold.backupCount ? `${hold.backupCount} backup${hold.backupCount === 1 ? '' : 's'}` : null]) || (hold.canViewEvidence ? 'DealerMail hold' : 'Details restricted')
    : hold.tone === 'clear' ? 'Confirm before promising' : 'Needs review'
  const flags = fmt.joinFacts([listing.dealerOn.inStock === true ? 'in stock' : listing.dealerOn.inStock === false ? 'not in stock' : null, listing.dealerOn.inTransit === true ? 'in transit' : null, listing.dealerOn.inProduction === true ? 'in production' : null])
  return el('div', { class: 'sig-grid' },
    signal({ tone: hold.tone === 'held' ? 'held' : hold.tone === 'clear' ? 'clear' : 'unverified', iconName: hold.tone === 'held' ? 'lock' : 'mail', label: 'Hold', value: holdValue, sub: holdSub, onClick: () => switchTab('hold'), title: hold.label }),
    signal({ tone: loc.conflict ? 'alert' : loc.provenance === 'app-confirmed' ? 'confirmed' : loc.provenance === 'source-reported' ? 'neutral' : 'unverified', iconName: 'pin', label: 'Location', value: loc.label, sub: loc.conflict ? 'Needs confirmation' : 'Vehicle location', onClick: () => switchTab('hold'), title: locationTitle(vehicle) }),
    signal({ tone: move ? (move.overdue ? 'alert' : 'moving') : 'neutral', iconName: 'truck', label: 'Movement', value: move ? humanize(move.label ?? move.state) ?? 'Move in progress' : 'No move', sub: move ? fmt.joinFacts([move.nextAction, move.dueAt ? `${move.overdue ? 'overdue' : 'due'} ${fmt.formatRelative(move.dueAt)}` : null]) || humanize(move.requestStatus) : 'Nothing in Inventory Flow', onClick: () => switchTab('hold') }),
    signal({ tone: listing.isListed === true ? 'confirmed' : listing.isListed === false ? 'alert' : 'unverified', iconName: 'globe', label: 'Listing', value: listing.isListed === true ? 'Listed' : listing.isListed === false ? 'Not listed' : 'Review', sub: flags || listing.websiteStatus || 'Listing status', onClick: () => switchTab('records') }),
  )
}

function dock(vehicle) {
  const origin = appOrigin()
  const access = state.data?.access
  const moveAction = vehicleMoveAction(vehicle, access)
  const blocked = requestBlockedReason(vehicle, access)
  const hasMove = Boolean(vehicle.movement?.transferId)
  const canReroute = hasMove && moveAction === 'direct'
  const primary = el('div', { class: `dock-primary${canReroute ? ' has-reroute' : ''}` },
    el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openUrl(links.inventorySearchUrl(origin, vehicle.stockNumber)) }, 'Open in app', icon('external')),
    hasMove ? el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.trackMovementUrl(origin, { transferId: vehicle.movement.transferId, vin: vehicle.vin })) }, 'View move', icon('arrow-right')) : null,
    moveAction ? el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.requestVehicleUrl(origin, vehicle.vin, moveAction)) }, canReroute ? 'Move again' : moveAction === 'direct' ? 'Move vehicle' : 'Request vehicle', icon('arrow-right')) : null,
  )
  const utils = el('nav', { class: 'd-utilities', 'aria-label': 'Vehicle utilities' },
    chip('Deal sheet', 'copy', (button) => copy(dealSheetText(vehicle, (field) => fieldText(field, vehicle)), 'Deal sheet', button), { title: 'Copy every identifying and pricing fact as text' }),
    chip('Take-home page', 'file-text', () => openTakeHome(vehicle), { title: 'Customer sheet to print or save as PDF' }),
    vehicle.hold.canManage ? chip('DealerMail', 'mail', async (button) => { await copy(vehicle.stockNumber, 'Stock number', button); openUrl(links.DEALERMAIL_INVENTORY_URL) }, { title: 'Copies the stock number, then opens DealerMail inventory' }) : null,
  )
  return el('div', { class: 'dock' }, primary,
    vehicle.moveRequestBlocked && !hasMove && blocked ? el('p', { class: 'dock-note', text: blocked }) : null,
    utils)
}

async function openTakeHome(vehicle) {
  // Only published facts leave the panel; the print page renders the model
  // it is handed and never re-fetches anything.
  const handoff = storage.setTakeHome(vehicle.vin, takeHomeModel(vehicle, photosFor(vehicle)))
  const path = `print.html#${encodeURIComponent(vehicle.vin)}`
  // Preview uses window.open(), so retain the click gesture while its local
  // storage write settles. Chrome extension storage remains persisted first.
  if (host === 'preview') openExtensionPage(path)
  await handoff
  if (host !== 'preview') openExtensionPage(path)
}

function tabsBar(vehicle) {
  const tablist = el('div', { class: 'detail-tablist', role: 'tablist', 'aria-label': 'Vehicle sections' })
  const bar = el('div', { class: 'tabs detail-tabs' }, el('span', { class: 'tabs-ind', 'aria-hidden': 'true' }), tablist)
  const counts = { equipment: vehicle.equipment.byCategory.reduce((sum, group) => sum + group.items.length, 0), hold: vehicle.hold.tone === 'held' ? hold_count(vehicle) : 0 }
  for (const [id, label] of TABS) {
    tablist.append(el('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${id}`, dataset: { tab: id }, 'aria-selected': String(id === state.tab), 'aria-controls': 'tab-panel', tabindex: id === state.tab ? '0' : '-1',
      onclick: () => switchTab(id),
    }, label, counts[id] ? el('b', { text: fmt.formatNumber(counts[id]) }) : null))
  }
  const selected = state.compare.includes(vehicle.vin)
  bar.append(
    el('button', { type: 'button', class: 'tab-action service-update', 'aria-label': vehicle.serviceReadiness?.canManage ? 'Update service in Inventory Flow' : 'View service in Inventory Flow', onclick: () => openUrl(links.serviceStatusUrl(appOrigin(), vehicle.vin)) }, 'Service', icon('external', { size: 12 })),
    el('button', { type: 'button', class: 'tab-action detail-compare-toggle', 'aria-label': selected ? 'Remove vehicle from comparison' : 'Add vehicle to comparison', 'aria-pressed': String(selected), onclick: (event) => { const wasSelected = state.compare.includes(vehicle.vin); toggleCompare(vehicle, event.currentTarget); event.currentTarget.setAttribute('aria-label', state.compare.includes(vehicle.vin) ? 'Remove vehicle from comparison' : 'Add vehicle to comparison'); event.currentTarget.textContent = state.compare.includes(vehicle.vin) ? 'Comparing' : 'Compare'; if (!wasSelected && state.compare.length >= 2) openCompare() } }, selected ? 'Comparing' : 'Compare'),
  )
  bar.addEventListener('keydown', (event) => {
    if (event.target.getAttribute('role') !== 'tab') return
    const tabs = [...bar.querySelectorAll('.tab')]
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      switchTab(next.dataset.tab); next.focus()
    }
  })
  return bar
}

function hold_count(vehicle) { return vehicle.hold.evidence.length + vehicle.hold.comments.length + vehicle.hold.alerts.length }

function switchTab(id) {
  const vehicle = vehicleByVin(state.selectedVin)
  if (!vehicle) return
  const changed = state.tab !== id
  state.tab = id
  const bar = ui.detail.querySelector('.tabs')
  if (bar) {
    for (const tab of bar.querySelectorAll('.tab')) { const on = tab.dataset.tab === id; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1 }
    positionIndicator(bar, bar.querySelector('.tabs-ind'), '.tab')
  }
  const panel = ui.detail.querySelector('#tab-panel')
  // A sticky bar's offsetTop follows its stuck position. Use the content's
  // normal-flow position so a deep Overview link never lands mid-Records.
  const sectionTop = bar && panel ? Math.max(0, ui.detail.scrollTop + panel.getBoundingClientRect().top - ui.detail.getBoundingClientRect().top - bar.offsetHeight) : 0
  if (panel) { const next = tabPanel(vehicle); panel.replaceWith(next); if (changed) next.classList.add('is-fresh') }
  if (bar && panel) {
    ui.detail.scrollTop = Math.min(ui.detail.scrollTop, sectionTop)
    bar.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true })
  }
}

function tabPanel(vehicle) {
  const builders = { overview: overviewTab, hold: holdTab, equipment: equipmentTab, records: recordsTab }
  return el('div', { class: 'tab-panel', id: 'tab-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` }, ...(builders[state.tab] ?? overviewTab)(vehicle))
}

function openRecord(id) {
  switchTab('records')
  const target = [...ui.detail.querySelectorAll('[data-record]')].find((node) => node.dataset.record === id)
  if (!target) return
  const bar = ui.detail.querySelector('.detail-tabs')
  ui.detail.scrollTop = Math.max(0, ui.detail.scrollTop + target.getBoundingClientRect().top - ui.detail.getBoundingClientRect().top - (bar?.offsetHeight ?? 0) - 8)
  target.focus({ preventScroll: true })
}

/* Overview tab */
function resourceBrand(brand, className = 'doc-brand') {
  return el('img', { class: `${className} ${className}--${brand}`, src: `../resource-brands/${brand}.svg`, alt: brand === 'autocheck' ? 'AutoCheck' : brand === 'vauto' ? 'vAuto' : 'Ford' })
}

function docTile({ title, sub, iconName, url, onOpen, disabledText, score, brand }) {
  const available = Boolean(url) || Boolean(onOpen)
  const accessibleTitle = brand === 'autocheck' ? 'AutoCheck history' : brand === 'vauto' ? 'vAuto equipment label' : title
  return el('button', {
    type: 'button', class: `doc ${available ? '' : 'is-off'} ${brand ? `doc-${brand}` : ''}`.trim(), disabled: !available, title: available ? `${onOpen ? 'View details' : 'Open'} ${accessibleTitle}` : disabledText ?? `${accessibleTitle} unavailable`, 'aria-label': `${available ? onOpen ? 'View details' : 'Open' : 'Unavailable:'} ${accessibleTitle}`,
    onclick: () => (onOpen ? onOpen() : openUrl(url)),
  },
    brand ? resourceBrand(brand) : score !== null && score !== undefined ? el('span', { class: 'doc-score num', text: String(score) }) : el('span', { class: 'doc-icon' }, icon(iconName, { size: 16 })),
    el('span', { class: 'doc-body' }, el('strong', { text: brand === 'autocheck' ? 'History' : brand === 'vauto' ? 'Equipment' : title }), el('small', { text: available ? sub : disabledText ?? 'Not published' })),
    available ? icon('external', { size: 12, className: 'doc-ext' }) : null,
  )
}

function documentSummaryFacts(resource, vehicle) {
  const docs = vehicle.documents ?? {}
  if (resource.id === 'window-sticker' || resource.id === 'vauto') {
    const isLabel = resource.id === 'vauto'
    const sticker = isLabel ? docs.factoryEquipment : docs.windowSticker
    const rows = []
    if (sticker?.totalMsrp !== null && sticker?.totalMsrp !== undefined) rows.push([isLabel ? 'Reference MSRP' : 'MSRP', isLabel ? fmt.formatReferencePrice(sticker.totalMsrp) : fmt.formatStickerMoney(sticker.totalMsrp, sticker)])
    if (sticker?.equipmentGroup) rows.push(['Equipment group', sourceDistanceText(sticker.equipmentGroup)])
    if (!isLabel && typeof sticker?.equipmentGroupPrice === 'number') rows.push(['Group price', fmt.formatStickerMoney(sticker.equipmentGroupPrice, sticker)])
    const capturedOptions = isLabel ? [
      ...(sticker?.packages ?? []).flatMap(pkg => [{ text: fmt.joinFacts([pkg.name, pkg.code]), price: pkg.price }, ...(pkg.features ?? []).map(text => ({ text: `· ${text}`, child: true }))]),
      ...(sticker?.sections ?? []).flatMap(section => section.items.map(item => ({ text: item.label, price: item.price }))),
    ] : (sticker?.options ?? []).map(text => ({ text }))
    const optionRows = capturedOptions.filter(item => item.text).map(item => {
      const text = sourceDistanceText(item.text)
      const priced = /^(.*?)\s+(?:[·|]\s*)?((?:USD|CAD)\s*\$?[\d,]+(?:\.\d{2})?|\$[\d,]+(?:\.\d{2})?|NO\s*CHARGE)$/i.exec(text)
      const price = isLabel && typeof item.price === 'number' && Number.isFinite(item.price) ? fmt.formatReferencePrice(item.price) : priced?.[2]
      const child = item.child || /^(?:[•·.]|[-–—])(?:\s+|(?=[A-Za-z]))|^\.\d+(?:[./"'–—-]|\s)/.test(text)
      const raw = isLabel && price ? `${text} · ${price}` : text
      return el('li', { class: `doc-sticker-option${child ? ' doc-sticker-option--child' : ''}`, title: raw, 'aria-label': raw },
        el('span', { text: priced ? priced[1] : text }),
        price ? el('strong', { class: 'doc-sticker-price', text: price }) : null,
      )
    })
    return el('div', { class: 'doc-summary-facts' },
      rows.length ? el('dl', { class: 'doc-fact-ledger' }, ...rows.map(([label, value]) => el('div', { class: 'doc-fact' }, el('dt', { text: label }), el('dd', { text: value })))) : null,
      !isLabel && sticker?.equipmentGroupContents?.length ? el('section', { class: 'doc-options' }, el('h4', { text: 'Included in equipment group' }), el('ul', { class: 'doc-sticker-options' }, ...sticker.equipmentGroupContents.map(text => el('li', { class: 'doc-sticker-option', text: sourceDistanceText(text) })))) : null,
      optionRows.length ? el('section', { class: 'doc-options' }, el('h4', { text: isLabel ? 'Captured equipment & packages' : Array.isArray(sticker?.equipmentGroupContents) ? 'Optional equipment & packages' : 'Captured equipment' }), el('ul', { class: 'doc-sticker-options' }, ...optionRows)) : null,
    )
  }

  const factory = docs.factoryEquipment
  const powertrain = factory ? fmt.joinFacts([factory.engine, factory.transmission, factory.drivetrain]) : null
  const packages = new Set((factory?.packages ?? []).map(pkg => fmt.joinFacts([pkg.name, pkg.code])))
  const featureNames = new Set([
    ...(factory?.sections ?? []).flatMap(section => section.items.map(item => sourceDistanceText(item.label))),
    ...(factory?.packages ?? []).flatMap(pkg => pkg.features.map(sourceDistanceText)),
  ])
  const rows = []
  const packageRows = []
  const features = []
  for (const fact of resource.facts) {
    // The shared vehicle facts already show the authoritative in-service date
    // and specifications. Full captured source records remain on Records.
    if (/^(Estimated warranty start|Warranty start|Vehicle class:|Assembly:)/.test(fact)) continue
    if (resource.id === 'vauto' && (fact === powertrain || /^Exterior /.test(fact) || /reference MSRP/.test(fact))) continue
    if (resource.id === 'vauto' && featureNames.has(fact)) { features.push(fact); continue }
    let label = resource.id === 'vauto' ? 'Equipment' : resource.id === 'window-sticker' ? 'Equipment' : 'Report'
    let value = fact
    const prefix = /^(Score|Last reported|Estimated warranty start|Open FSA|Warranty start|Built|Released|Recorded coverage:|Extended coverage:|Printed warranty:|Vehicle class:|Assembly:|Warranty estimate:|Captured warranty:)\s*(.*)$/.exec(fact)
    if (prefix) {
      label = ({ 'Last reported': 'Odometer', 'Estimated warranty start': 'In-service · estimate', 'Built': 'Build date', 'Released': 'Release date' })[prefix[1]] ?? prefix[1].replace(/:$/, '')
      value = prefix[2]
    } else if (resource.id === 'autocheck' && fact.includes(':')) {
      const separator = fact.indexOf(':'); label = fact.slice(0, separator); value = fact.slice(separator + 1).trim()
    } else if (resource.id === 'autocheck' && /owners?\b/.test(fact)) label = 'Owners / use'
    else if (resource.id === 'autocheck' && fact === docs.autoCheck?.usage) label = 'Use'
    else if (/reference MSRP| MSRP$/.test(fact)) label = 'MSRP'
    else if (/^Exterior /.test(fact)) label = 'Colors'
    else if (packages.has(fact) && resource.id === 'vauto') label = 'Package'
    else if (resource.id === 'window-sticker' && fact === docs.windowSticker?.equipmentGroup) label = 'Group'
    else if (resource.id === 'oasis' && /^0 open Ford actions/.test(fact)) label = 'Open actions'
    else if (/months in service at capture/.test(fact)) label = 'In service'
    else if (/mi at sale/.test(fact)) label = 'Sale mileage'
    ;(label === 'Package' ? packageRows : rows).push(el('div', { class: `doc-fact${label === 'Open FSA' ? ' doc-fact--warning' : ''}` }, el('dt', { text: label }), el('dd', { text: value })))
  }
  return el('div', { class: 'doc-summary-facts' },
    packageRows.length ? el('dl', { class: 'doc-fact-ledger' }, ...packageRows) : null,
    features.length ? el('ul', { class: 'doc-equipment-list', 'aria-label': 'Captured equipment' }, ...features.map(text => el('li', { text }))) : null,
    rows.length ? el('dl', { class: 'doc-fact-ledger' }, ...rows) : null,
  )
}

function documentsGrid(vehicle) {
  const sourceResources = resourceSummaries(vehicle)
  const sticker = sourceResources.find(resource => resource.id === 'window-sticker')
  const equipment = sourceResources.find(resource => resource.id === 'vauto')
  const usableSticker = !['incomplete', 'unavailable', 'unknown'].includes(vehicle.documents.windowSticker?.dataState)
    && (vehicle.documents.windowSticker?.totalMsrp != null || vehicle.documents.windowSticker?.options?.length || vehicle.documents.windowSticker?.equipmentGroup || vehicle.documents.windowSticker?.equipmentGroupContents?.length)
  const selectedEquipment = usableSticker && sticker?.hasCapturedData
    ? sticker : equipment && !['incomplete', 'unavailable', 'unknown'].includes(vehicle.documents.factoryEquipment?.dataState) && (equipment.hasCapturedData || equipment.url) ? equipment : sticker ?? equipment
  const resources = sourceResources.filter(resource => !['window-sticker', 'vauto'].includes(resource.id) || resource === selectedEquipment)
  const cards = resources.filter(resource => resource.hasCapturedData).map(resource => {
    const captured = resource.hasCapturedData
    const accessibleTitle = resource.id === 'autocheck' ? 'AutoCheck history' : resource.id === 'vauto' ? 'vAuto equipment label' : resource.title
    const label = captured ? `View ${accessibleTitle}` : resource.url ? `Open ${resource.title}` : `${resource.title}: details unavailable`
    return el('section', { class: 'doc-summary', dataset: { resource: resource.id }, 'aria-label': `${resource.title} summary` },
      el('button', { type: 'button', class: `doc doc-summary-heading${resource.brand ? ` doc-${resource.brand}` : ''}`, disabled: !captured && !resource.url, 'aria-label': label,
        onclick: () => captured ? openRecord(resource.id) : openUrl(resource.url) },
        resource.brand ? resourceBrand(resource.brand) : icon('file-text'),
        el('span', { class: 'doc-body' }, el('strong', { text: resource.id === 'window-sticker' ? 'Sticker & equipment' : resource.title })),
        icon(captured ? 'arrow-right' : 'external', { size: 14 })),
      resource.id === 'vauto' ? el('p', { class: 'doc-source-note', text: 'vAuto equipment label · not an original window sticker' }) : null,
      resource.facts.length ? documentSummaryFacts(resource, vehicle) : null,
      resource.id === 'vauto' && sticker?.url ? el('button', { type: 'button', class: 'doc-source-supplement', onclick: () => openUrl(sticker.url) }, 'Open window sticker', icon('external', { size: 14 })) : null,
      resource.sourceNote ? el('p', { class: 'doc-source-note', text: resource.sourceNote }) : null,
      captured && resource.url ? el('button', { type: 'button', class: 'doc-source-open', 'aria-label': `Open ${resource.title} for ${vehicle.stockNumber}`, onclick: () => openUrl(resource.url) }, 'Open document', icon('external', { size: 14 })) : null,
    )
  })
  return el('section', { class: 'document-summaries', 'aria-label': 'Vehicle documents and records' },
    el('h3', { class: 'card-title', text: 'Documents & records' }),
    cards.length ? el('div', { class: 'doc-grid doc-grid--summaries' }, ...cards) : null,
    el('div', { class: 'doc-grid doc-grid--utilities' },
      ...resources.filter(resource => !resource.hasCapturedData).map(resource => docTile({
        title: resource.title, sub: resource.sourceKind === 'Dealer lookup' ? 'Dealer lookup' : 'Open document',
        iconName: resource.id === 'invoice' ? 'receipt' : 'file-text', url: resource.url,
        disabledText: 'No captured details', brand: resource.brand,
      })),
      vehicle.listing.url ? docTile({ title: 'Listing', sub: 'Open dealer website', iconName: 'globe', url: vehicle.listing.url }) : null),
  )
}

function dealSheet(vehicle) {
  const always = new Set(['stock', 'vin', 'price', 'msrp', 'mileage'])
  const fields = copyFields(vehicle).filter((field) => always.has(field.key) || (field.value !== null && field.value !== undefined && field.value !== ''))
  const rows = fields.map((field) => {
    const empty = field.value === null || field.value === undefined || field.value === ''
    const raw = field.kind === 'money' || field.kind === 'mileage' ? String(field.value) : String(field.value ?? '')
    return el('div', { class: `ds-row ${empty ? 'is-empty' : ''}`.trim() },
      el('dt', {}, el('span', { text: field.label }), field.from ? el('small', { text: field.from === 'sticker' ? 'sticker' : 'label' }) : null),
      el('dd', { class: field.kind === 'text' ? '' : 'num' }, fieldText(field, vehicle)),
      empty ? el('span', { class: 'copy-slot' }) : copyButton(raw, field.label),
    )
  })
  const header = el('div', { class: 'card-head' },
    el('h3', { class: 'card-title' }, icon('receipt', { size: 13 }), 'Deal sheet'),
    el('button', { type: 'button', class: 'btn btn-sm', onclick: (event) => copy(dealSheetText(vehicle, (field) => fieldText(field, vehicle)), 'Deal sheet', event.currentTarget) }, icon('copy', { size: 13 }), 'Copy all'),
  )
  return el('section', { class: 'card dealsheet' }, header, el('dl', { class: 'dealsheet-body' }, ...rows), el('p', { class: 'd-caption', text: 'Copy buttons put the plain value on the clipboard — digits only for money and miles — so it pastes cleanly into DealerMail, CDK or a worksheet.' }))
}

function coverageRow(item) {
  const statusLabel = { active: 'In coverage', partial: 'Partly known', expired: 'Expired', unknown: 'Needs date' }[item.status]
  const parts = [item.monthsRemaining !== null ? `${item.monthsRemaining} mo` : null, item.milesRemaining !== null ? `${fmt.formatNumber(item.milesRemaining)} mi` : null].filter(Boolean)
  const remaining = item.status === 'expired'
    ? (item.limitedBy === 'miles' ? `past ${fmt.formatNumber(item.termMiles)} mi` : `ended ${fmt.formatDate(item.expiresOn)}`)
    : parts.length ? `${parts.join(' / ')} left${item.expiresOn ? ` · ends ${fmt.formatDate(item.expiresOn)}` : ''}` : 'needs warranty start date and miles'
  const timePct = item.monthsRemaining !== null ? item.monthsRemaining / item.termMonths : null
  const milesPct = item.milesRemaining !== null ? item.milesRemaining / item.termMiles : null
  const pct = [timePct, milesPct].filter((value) => value !== null).reduce((min, value) => Math.min(min, value), 1)
  return el('div', { class: `warr-row is-${item.status}` },
    el('div', { class: 'warr-line' },
      icon(item.status === 'active' ? 'check' : item.status === 'expired' ? 'alert' : 'help', { size: 14 }),
      el('span', { class: 'warr-name' }, el('b', { text: item.label }), el('small', { class: 'warr-term num', text: `${item.termMonths / 12} yr / ${fmt.formatNumber(item.termMiles)} mi` })),
      el('span', { class: 'warr-status', text: statusLabel }),
    ),
    el('div', { class: 'warr-meter', 'aria-hidden': 'true' }, el('span', { style: { '--pct': `${Math.round(pct * 100)}%` } })),
    el('div', { class: 'warr-remaining', text: remaining + (item.limitedBy === 'miles' && item.status === 'active' ? ' · miles run out first' : '') }),
    item.note ? el('p', { class: 'd-caption', text: item.note }) : null,
  )
}

function warrantyCard(vehicle) {
  const miles = state.odometer.has(vehicle.vin) ? state.odometer.get(vehicle.vin) : vehicle.mileage
  const outlook = warrantyOutlook({ ...vehicle, mileage: miles })
  const rerender = () => { const next = warrantyCard(vehicle); card.replaceWith(next); next.querySelector('.warr-odo')?.focus() }
  const input = el('input', {
    class: 'warr-odo num', type: 'number', inputmode: 'numeric', min: '0', step: '100', placeholder: 'miles', 'aria-label': 'Odometer now', value: miles === null || miles === undefined ? '' : String(miles),
    onchange: (event) => { const value = event.target.value === '' ? null : Math.max(0, Math.floor(Number(event.target.value))); state.odometer.set(vehicle.vin, value); rerender() },
  })
  const head = el('div', { class: 'card-head' },
    el('h3', { class: 'card-title' }, icon('shield', { size: 13 }), 'Factory warranty estimate'),
    outlook.program ? el('small', { class: 'card-sub', text: outlook.program }) : el('small', { class: 'card-sub', text: `No terms on file for ${vehicle.make || 'this make'}` }),
  )
  const facts = el('div', { class: 'warr-facts' },
    el('div', { class: 'warr-fact' }, el('small', { text: outlook.inService.estimated ? 'Estimated warranty start' : 'Warranty start · OASIS' }), el('strong', { text: outlook.inService.date ? fmt.formatDate(outlook.inService.date) : 'Not on the report' }), outlook.inService.date ? el('span', { text: outlook.inService.source }) : el('span', { text: 'Needed to date the coverage' })),
    el('div', { class: 'warr-fact' }, el('label', {}, el('small', { text: 'Odometer now' }), input), el('span', { text: 'Edit to recalculate' })),
  )
  const cert = vehicle.certifiedProgram ? certifiedTerms(vehicle.certifiedProgram.store) : null
  const card = el('section', { class: 'card warr' },
    head,

    facts,
    outlook.coverages.length ? el('div', { class: 'warr-rows' }, ...outlook.coverages.map(coverageRow)) : null,
    outlook.stickerWarranty.length ? el('div', { class: 'warr-sticker' }, el('b', { text: 'Printed on the original window sticker' }), el('ul', {}, ...outlook.stickerWarranty.map((text) => el('li', { text })))) : null,
    cert ? el('div', { class: 'warr-cert' },
      el('div', { class: 'warr-cert-head' }, certifiedBadge(vehicle, { size: 'md' })),
      el('ul', { class: 'warr-terms' }, ...cert.terms.map((term) => el('li', { text: term }))),
      el('p', { class: 'd-caption', text: cert.note }),
    ) : null,
    el('p', { class: 'd-caption' }, icon('calendar', { size: 12 }), ' Warranty runs from the first retail sale, not the model year. ', outlook.verify.source === 'oasis' ? 'A captured OASIS warranty start date takes priority; otherwise the date is an AutoCheck estimate. Coverage calculations remain estimates.' : 'The AutoCheck report shows the sale and registration dates and has its own remaining-warranty calculator at the bottom.'),
    outlook.verify.url ? el('button', { type: 'button', class: 'btn btn-sm', onclick: () => openUrl(outlook.verify.url) }, icon(outlook.verify.source === 'oasis' ? 'wrench' : 'shield', { size: 13 }), outlook.verify.source === 'oasis' ? 'Open OASIS' : 'Open AutoCheck report', icon('external', { size: 12 })) : null,
  )
  return card
}

function highlights(vehicle) {
  const standout = vehicle.equipment.standout
  const total = vehicle.equipment.byCategory.reduce((sum, group) => sum + group.items.length, 0)
  if (!total) return null
  const items = (standout.length ? standout : vehicle.equipment.byCategory.flatMap((group) => group.items).slice(0, 6))
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('sparkles', { size: 13 }), 'Stands out'), el('button', { type: 'button', class: 'link-btn', onclick: () => switchTab('equipment') }, `All ${fmt.formatNumber(total)}`, icon('chevron-right', { size: 12 }))),
    el('div', { class: 'd-features' }, ...items.map((item) => el('span', { class: `d-feature ${item.standout ? 'is-standout' : ''}`.trim(), text: item.label }))),
  )
}

function specsCard(vehicle) {
  const s = vehicle.specs
  const node = kv([
    ['Body', fmt.joinFacts([vehicle.bodyStyle, s.bodyType && s.bodyType !== vehicle.bodyStyle ? s.bodyType : null])],
    ['Drivetrain', vehicle.drivetrain], ['Engine', vehicle.engine, vehicle.engine], ['Transmission', vehicle.transmission], ['Fuel', vehicle.fuelType],
    ['MPG', s.mpgCity !== null || s.mpgHighway !== null ? `${s.mpgCity ?? '—'} city / ${s.mpgHighway ?? '—'} hwy` : null],
    ['Exterior', vehicle.exteriorColor, vehicle.exteriorColor], ['Interior', vehicle.interiorColor, vehicle.interiorColor], ['Model code', s.modelCode, s.modelCode],
    ['In inventory since', s.inventoryDate ? fmt.formatDate(s.inventoryDate) : null],
  ])
  if (!node) return null
  return el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('gauge', { size: 13 }), 'Specifications')), node)
}

function frequentFacts(vehicle) {
  const docs = vehicle.documents
  const start = vehicleInServiceSource(vehicle)
  const stickerBase = docs.windowSticker?.basePrice
  const labelBase = docs.factoryEquipment?.basePrice
  const hasStickerBase = stickerBase !== null && stickerBase !== undefined
  const hasLabelBase = labelBase !== null && labelBase !== undefined
  const baseLookup = fact('Base MSRP', hasStickerBase ? fmt.formatStickerMoney(stickerBase, docs.windowSticker) : hasLabelBase ? fmt.formatReferencePrice(labelBase) : '—')
  return el('section', { class: 'detail-frequent-facts', 'aria-label': 'Frequently used vehicle facts' },
    baseLookup,
    fact(start.source === 'OASIS' ? 'Warranty in-service · OASIS' : start.raw ? 'Warranty in-service · estimate' : 'Warranty in-service', start.raw ? fmt.formatDate(start.raw) : '—'),
  )
}

function overviewTab(vehicle) {
  const specification = el('section', { class: 'detail-specification' },
    el('h3', { text: 'Specifications' }),
    kv([['Engine', vehicle.engine], ['Drive', vehicle.drivetrain], ['Exterior', vehicle.exteriorColor], ['Interior', vehicle.interiorColor], ['MSRP', vehicle.msrp !== null ? fmt.formatMoney(vehicle.msrp) : null], ['Fuel', vehicle.fuelType]]))
  const fullSpecifications = el('section', { class: 'detail-specification detail-full-specs' }, el('h3', { text: 'Vehicle details' }),
    kv([['Stock', vehicle.stockNumber], ['VIN', vehicle.vin], ['Transmission', vehicle.transmission], ['Body', vehicle.bodyStyle], ['Vehicle class', vehicle.documents.autoCheck?.vehicleClass], ['Location', vehicle.location.label], ['Model code', vehicle.specs.modelCode], ['Inventory date', vehicle.specs.inventoryDate ? fmt.formatDate(vehicle.specs.inventoryDate) : null], ['Under MSRP', vehicle.savings ? fmt.formatMoney(vehicle.savings) : null], ['Fuel economy', vehicle.specs.mpgCity !== null || vehicle.specs.mpgHighway !== null ? `${vehicle.specs.mpgCity ?? '—'} city / ${vehicle.specs.mpgHighway ?? '—'} highway` : null]]))
  const calculator = el('section', { class: 'detail-calculator' }, el('button', { type: 'button', class: 'detail-calculator-toggle', 'aria-expanded': 'false', onclick: (event) => {
    const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true'
    event.currentTarget.setAttribute('aria-expanded', String(!expanded))
    if (expanded) calculator.querySelector('.warr')?.remove()
    else calculator.append(warrantyCard(vehicle))
  } }, icon('shield', { size: 15 }), 'Warranty calculator', icon('chevron-right', { size: 14 })))
  return [hero(vehicle), frequentFacts(vehicle), specification, documentsGrid(vehicle), fullSpecifications, highlights(vehicle), calculator, readOnlyNote()]
}

function readOnlyNote() {
  return el('p', { class: 'd-freshness', text: 'Confirm availability with the home store before promising this vehicle.' })
}

/* Hold & custody tab */
function holdTab(vehicle) {
  const hold = vehicle.hold
  const primary = hold.evidence.find((item) => item.position === 'primary')
  const headline = hold.tone === 'held'
    ? fmt.joinFacts([hold.position === 'backup' ? 'Backup hold' : hold.position === 'multiple' ? `${hold.backupCount + 1} holds` : 'Primary hold', primary?.salesperson])
    : hold.tone === 'clear' ? 'No active hold' : 'Hold status needs review'
  const facts = hold.tone === 'held' ? kv([
    ['Placed', primary?.holdDate ? fmt.formatDate(primary.holdDate) : null],
    ['Expected', primary?.expectedDate ? fmt.formatDate(primary.expectedDate) : null],
    ['Reason', primary?.customerOrReason],
    ['Backups', hold.backupCount ? String(hold.backupCount) : null],
    ['CDK', hold.cdkStatus],
    ['In DealerMail', fmt.joinFacts([hold.commentsCount ? `${hold.commentsCount} comment${hold.commentsCount === 1 ? '' : 's'}` : null, hold.alertsCount ? `${hold.alertsCount} alert${hold.alertsCount === 1 ? '' : 's'}` : null])],
  ]) : null
  const backups = hold.evidence.filter((item) => item.position === 'backup').map((item) => el('div', { class: 'd-evidence' }, el('b', { text: 'Backup' }), item.salesperson ? el('span', { text: ` · ${item.salesperson}` }) : null, item.expectedDate ? el('span', { text: ` · expected ${fmt.formatDate(item.expectedDate)}` }) : null, item.customerOrReason ? el('div', {}, el('span', { text: item.customerOrReason })) : null))
  const messages = []
  if (hold.canViewEvidence && hold.tone === 'held') {
    for (const [label, iconName, items] of [['Comment', 'message', hold.comments], ['Alert', 'bell', hold.alerts]]) {
      for (const item of items) messages.push(el('div', { class: `d-evidence ${label === 'Alert' ? 'is-alert' : ''}`.trim() }, icon(iconName, { size: 14 }), el('b', { text: label }), item.author ? el('span', { text: ` · ${item.author}` }) : null, item.timestamp ? el('span', { text: ` · ${fmt.formatDateTime(item.timestamp)}` }) : null, el('div', {}, el('span', { text: item.text }))))
    }
  }
  const status = []
  const capturedAt = state.data?.meta?.dealerMailCapturedAt ?? state.data?.meta?.completedAt
  status.push(el('p', { class: 'd-caption', text: hold.liveCheckStatus === 'verified'
    ? `Checked directly in DealerMail ${fmt.formatDateTime(hold.liveCheckedAt)}. Open DealerMail for current names and notes.`
    : hold.liveCheckStatus === 'checking' ? 'Checking the current DealerMail hold…'
      : hold.liveCheckStatus === 'unavailable' ? 'Could not confirm the current hold in DealerMail. Review it there before relying on this status.'
        : `DealerMail snapshot${capturedAt ? ` captured ${fmt.formatDateTime(capturedAt)}` : ''}. Holds may change during the day.` }))
  if (hold.canViewEvidence && hold.tone === 'held') {
    if (state.detailStatus === 'loading' && !hold.detailLoaded) status.push(el('p', { class: 'd-caption d-caption-live', text: 'Loading the full DealerMail record…' }))
    if (state.detailStatus === 'failed' && !hold.detailLoaded) status.push(el('p', { class: 'd-caption' }, 'The full record could not be loaded. ', el('button', { type: 'button', class: 'd-inline', onclick: () => loadDetail(vehicle.vin, { retry: true }) }, 'Retry')))
    if (state.detailStatus === 'gone' && !hold.detailLoaded) status.push(el('p', { class: 'd-caption d-caption-warn', text: 'This vehicle is no longer in the current snapshot; the DealerMail record could not be loaded.' }))
  }
  if (hold.tone === 'held' && !hold.canViewEvidence && hold.liveCheckStatus !== 'verified') status.push(el('p', { class: 'd-caption', text: 'Hold details are restricted for your role.' }))
  const actions = el('div', { class: 'dock-utils' },
    vehicle.hold.canManage ? chip('Open in DealerMail', 'mail', async (button) => { await copy(vehicle.stockNumber, 'Stock number', button); openUrl(links.DEALERMAIL_INVENTORY_URL) }, { title: 'Copies the stock number, then opens DealerMail inventory' }) : null,
    chip('Stock', 'tag', (button) => copy(vehicle.stockNumber, 'Stock number', button), { title: 'Copy stock number' }),
    chip('Open in app', 'external', () => openUrl(links.inventorySearchUrl(appOrigin(), vehicle.stockNumber))),
  )
  const holdCard = el('section', { class: `card hold-card is-${hold.tone}` },
    el('div', { class: 'hold-head' }, el('span', { class: 'hold-icon' }, icon(hold.tone === 'held' ? 'lock' : hold.tone === 'clear' ? 'check' : 'help', { size: 16 })), el('div', {}, el('strong', { text: headline }), el('small', { text: hold.liveCheckStatus === 'verified' ? 'Live DealerMail check' : hold.tone === 'held' ? 'At last capture' : 'Confirm before promising' }))),
    facts, ...backups, ...status, ...messages,
    el('p', { class: 'd-caption', text: 'Confirm availability and vehicle location with the home store before committing to a customer.' }),
    actions,
  )

  const loc = vehicle.location
  const locSection = section('Location', [
    line('pin', loc.label, 'Vehicle location'),
    loc.custodian ? line('car', null, `With ${loc.custodian}`) : null,
    loc.conflict ? el('p', { class: 'd-caption d-caption-warn', text: 'Location needs confirmation with the home store.' }) : null,
    loc.store && loc.store !== vehicle.homeStore ? el('p', { class: 'd-caption', text: `Away from its home store, ${vehicle.homeStore}.` }) : null,
  ], { iconName: 'pin' })

  const move = vehicle.movement
  const moveSection = section('Movement', move
    ? [
      line('truck', humanize(move.label ?? move.state) ?? 'Move in progress', humanize(move.requestStatus)),
      move.withheld ? el('p', { class: 'd-caption', text: 'Move details are limited to the stores involved.' }) : null,
      kv([['Next', fmt.joinFacts([move.nextAction, move.nextActionOwner])], ['To', move.destination], [move.overdue ? 'Overdue' : 'Due', move.dueAt ? fmt.formatDateTime(move.dueAt) : null], ['Transport', move.transportAssignee]]),
      move.transferId ? el('div', { class: 'dock-utils' }, chip('View vehicle move', 'truck', () => openUrl(links.trackMovementUrl(appOrigin(), { transferId: move.transferId, vin: vehicle.vin })))) : null,
    ]
    : [el('p', { class: 'd-caption', text: 'No active vehicle move.' })], { iconName: 'truck', pill: move ? el('span', { class: `pill ${move.overdue ? 'pill-alert' : 'pill-moving'}`, text: move.overdue ? 'Overdue' : 'Active' }) : null })

  const managerSection = vehicle.managerLog ? section('Manager log', [
    line('file', vehicle.managerLog.soldLabel, vehicle.managerLog.deliveryLabel),
    vehicle.managerLog.deliveryDate ? line('check', null, `Delivered ${fmt.formatDate(vehicle.managerLog.deliveryDate)}`) : null,
    vehicle.managerLog.dataState !== 'current' ? el('p', { class: 'd-caption d-caption-warn', text: 'Review this manager update before relying on it.' }) : null,
  ], { iconName: 'file', pill: vehicle.managerLog.dataState !== 'current' ? el('span', { class: 'pill pill-moving', text: 'Not current' }) : null }) : null

  return [holdCard, locSection, moveSection, managerSection]
}

/* Equipment tab */
function equipmentTab(vehicle) {
  const groups = vehicle.equipment.byCategory
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const docs = vehicle.documents
  const children = []
  children.push(el('div', { class: 'card-head eq-head' },
    el('h3', { class: 'card-title' }, icon('list', { size: 13 }), `${fmt.formatNumber(total)} published item${total === 1 ? '' : 's'}`),
    total ? el('button', { type: 'button', class: 'btn btn-sm', onclick: (event) => copy(groups.map((group) => `${group.label}\n${group.items.map((item) => `• ${item.label}`).join('\n')}`).join('\n\n'), 'Equipment list', event.currentTarget) }, icon('copy', { size: 13 }), 'Copy list') : null,
  ))
  if (docs.factoryEquipment?.packages.length) {
    children.push(el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('layers', { size: 13 }), 'Packages on the equipment label'), docs.factoryEquipment.url ? el('button', { type: 'button', class: 'link-btn', onclick: () => openUrl(docs.factoryEquipment.url) }, 'Open label', icon('external', { size: 12 })) : null),
      ...docs.factoryEquipment.packages.map((pkg) => el('div', { class: 'pkg' },
        el('div', { class: 'pkg-head' }, el('b', { text: pkg.name }), pkg.code ? el('code', { text: pkg.code }) : null, pkg.price !== null ? el('span', { class: 'num', text: fmt.formatReferencePrice(pkg.price) }) : null),
        pkg.features.length ? el('div', { class: 'd-features' }, ...pkg.features.map((feature) => el('span', { class: 'd-feature', text: feature }))) : null,
      )),
    ))
  }
  if (docs.windowSticker?.equipmentGroup) children.push(el('p', { class: 'd-caption' }, el('b', { text: 'Sticker equipment group: ' }), docs.windowSticker.equipmentGroup))
  groups.forEach((group) => {
    const details = el('section', { class: 'eq-group eq-ledger', 'aria-label': group.label },
      el('h3', {}, el('span', { text: group.label }), el('b', { class: 'num', text: fmt.formatNumber(group.items.length) })),
      el('ul', { class: 'eq-list' }, ...group.items.map((item) => el('li', { class: `eq-item ${item.standout ? 'is-standout' : ''}`.trim() }, el('span', { text: item.label })))),
    )
    children.push(details)
  })
  if (!total) children.push(el('p', { class: 'd-caption', text: 'No equipment details are available for this vehicle.' }))
  else children.push(el('p', { class: 'd-freshness', text: 'Confirm installed equipment on the vehicle.' }))
  return children
}

/* Records tab */
function historyMetrics(ac) {
  const metric = (label, value, detail) => el('div', { class: 'history-metric' }, el('small', { text: label }), el('strong', { text: value ?? 'Not reported' }), detail ? el('span', { text: detail }) : null)
  const service = ac.checks.find((check) => /\bservice\b/i.test(check.label))
  const serviceCountSources = service ? [service.status, service.detail].filter((value) => /\b\d[\d,]*\s+(?:service\s+)?records?\b/i.test(value ?? '')) : []
  return el('div', { class: 'history-metrics', 'aria-label': 'Vehicle history summary' },
    metric('Score', ac.score !== null ? String(ac.score) : null, ac.rangeLow !== null && ac.rangeHigh !== null ? `Typical ${ac.rangeLow}–${ac.rangeHigh}` : null),
    metric('Owners', ac.ownerCount !== null ? `${ac.ownerCount} reported` : null),
    metric('Use', sourceDistanceText(ac.usage) || null),
    metric('Service records', serviceCountSources.length ? fmt.joinFacts(serviceCountSources) : service ? service.detail || service.status : null),
    metric('Last odometer', ac.lastReportedOdometer !== null ? fmt.formatMileage(ac.lastReportedOdometer) : null, ac.lastReportedOdometerDate ? fmt.formatDate(ac.lastReportedOdometerDate) : null),
  )
}

function historyCheck(check) {
  const iconName = /accident|damage/i.test(check.label) ? 'car' : /odometer/i.test(check.label) ? 'gauge' : /service/i.test(check.label) ? 'wrench' : /recall/i.test(check.label) ? 'alert' : /insurance|title/i.test(check.label) ? 'shield' : /cpo|certif/i.test(check.label) ? 'award' : 'file-text'
  return el('div', { class: `check is-${check.tone}` },
    el('span', { class: 'history-check-icon' }, icon(iconName, { size: 19 })),
    el('span', { class: 'history-check-copy' }, el('b', { text: check.label }), el('small', { text: sourceDistanceText(fmt.joinFacts([check.status, check.detail])) || 'Not reported' })),
    icon(check.tone === 'clear' ? 'check' : check.tone === 'review' ? 'alert' : 'minus', { size: 15, className: 'history-check-status' }),
  )
}

function recordsTab(vehicle) {
  const docs = vehicle.documents
  const ac = docs.autoCheck
  const children = []
  const recordHead = (title, { brand, iconName = 'file-text', url, action, missing, dataState } = {}) => el('div', { class: 'rec-heading' },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, brand ? resourceBrand(brand, 'record-brand') : icon(iconName, { size: 16 }), title)),
    url ? el('button', { type: 'button', class: 'rec-source', 'aria-label': `${action} for ${vehicle.stockNumber}`, onclick: () => openUrl(url) }, brand === 'autocheck' ? 'Open report' : brand === 'ford' ? 'Open OASIS' : brand === 'vauto' ? 'Open equipment' : /sticker/i.test(action) ? 'Open sticker' : 'Open details', icon('external', { size: 14 })) : missing ? el('p', { class: 'rec-source-missing', text: 'Details unavailable' }) : null,
  )
  const recordSection = (title, content) => el('section', { class: 'rec-section', 'aria-label': title }, el('h4', { text: title }), ...content.filter(Boolean))
  // Source lines can print a distance in kilometres; staff read miles.
  const recordList = (title, items) => items?.length ? recordSection(title, [el('ul', { class: 'rec-list' }, ...items.map((text) => el('li', { text: sourceDistanceText(text) })))]) : null
  const sourceNote = () => null
  const note = (text) => text ? el('p', { class: 'rec-note', text }) : null
  const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value)
  const referencePrice = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(value)
  const recordPrices = (rows, format) => {
    const present = rows.filter(([, value]) => hasNumber(value))
    return present.length ? el('dl', { class: 'price-table' }, ...present.map(([title, value]) => el('div', { class: `price-line ${/^total/i.test(title) ? 'is-total' : ''}` }, el('dt', { text: title }), el('dd', { class: 'num', text: format(value) })))) : null
  }
  if (ac) {
    const facts = kv([
      ['Warranty start', ac.inServiceDate ? fmt.formatDate(ac.inServiceDate) : null],
      ['Class', sourceDistanceText(ac.vehicleClass) || null], ['Assembly', ac.assemblyCountry],
    ])
    facts?.classList.add('rec-metadata')
    children.push(el('section', { class: 'card rec rec-autocheck', dataset: { record: 'autocheck' }, tabindex: '-1' },
      recordHead('History', { brand: 'autocheck', url: ac.url, action: 'Open AutoCheck report', missing: 'AutoCheck report unavailable.', dataState: ac.dataState }),
      note(sourceNote(ac, 'autocheck')),
      historyMetrics(ac),
      facts,
      ac.checks.length ? el('div', { class: 'checks', 'aria-label': 'History checks' }, ...ac.checks.map(historyCheck)) : el('p', { class: 'rec-empty', text: 'No history details are available.' }),
    ))
  }
  const sticker = docs.windowSticker
  if (sticker) {
    children.push(el('section', { class: 'card rec', dataset: { record: 'window-sticker' }, tabindex: '-1' },
      recordHead('Window sticker', { url: sticker.url, action: 'Open window sticker', missing: 'Window sticker unavailable.', dataState: sticker.dataState }),
      !sticker.url && docs.factoryEquipment?.url && !['incomplete', 'unavailable', 'unknown'].includes(docs.factoryEquipment.dataState)
        ? el('div', { class: 'doc-source-note' }, 'Original sticker unavailable. ', el('button', { type: 'button', class: 'doc-source-supplement', onclick: () => openUrl(docs.factoryEquipment.url) }, 'Open vAuto equipment', icon('external', { size: 14 }))) : null,
      note(sourceNote(sticker, 'window-sticker')),
      sticker.vehicleDescription ? el('p', { class: 'd-caption', text: sticker.vehicleDescription }) : null,
      recordPrices([[hasNumber(sticker.totalMsrp) ? 'Original MSRP' : 'Base MSRP', sticker.totalMsrp ?? sticker.basePrice]], (value) => fmt.formatStickerMoney(value, sticker)),
      sticker.equipmentGroupContents?.length ? el('section', {}, el('h4', { text: 'Equipment group contents' }), ...sticker.equipmentGroupContents.map(text => el('p', { text }))) : null,
      kv([['Group price', typeof sticker.equipmentGroupPrice === 'number' ? fmt.formatStickerMoney(sticker.equipmentGroupPrice, sticker) : null], ['Equipment group', sticker.equipmentGroup], ['Engine', sourceDistanceText(sticker.engine)], ['Transmission', sourceDistanceText(sticker.transmission)], ['Exterior', sticker.exteriorColor], ['Interior', sticker.interiorColor]]),
      recordList('Factory options', sticker.options),
      recordList('Standard equipment', sticker.standardEquipment),
      recordList('Warranty printed on sticker', sticker.warranty),
      sticker.url ? note('Review the window sticker for full configuration and warranty terms.') : null,
    ))
  }
  const label = docs.factoryEquipment
  if (label) {
    children.push(el('section', { class: 'card rec', dataset: { record: 'vauto' }, tabindex: '-1' },
      recordHead('Equipment', { brand: 'vauto', url: label.url, action: 'Open equipment details', missing: 'Equipment details unavailable.', dataState: label.dataState }),
      note(sourceNote(label, 'vauto')),
      note(label.vehicleDescription),
      el('div', { class: 'rec-metadata' }, recordPrices([[hasNumber(label.totalMsrp) ? 'Reference MSRP' : 'Base MSRP', label.totalMsrp ?? label.basePrice]], referencePrice)),
      kv([['Engine', label.engine], ['Transmission', label.transmission], ['Drivetrain', label.drivetrain], ['Exterior', label.exteriorColor], ['Interior', label.interiorColor]]),
      [...label.packages.map((pkg) => pkg.price), ...label.sections.flatMap((group) => group.items.map((item) => item.price))].some(hasNumber) ? el('p', { class: 'rec-price-context', text: 'Reference pricing' }) : null,
      label.packages.length ? recordSection('Equipment packages', label.packages.map((pkg) => el('div', { class: 'rec-package' },
        el('div', { class: 'rec-line' }, el('b', { text: fmt.joinFacts([pkg.name, pkg.code]) }), hasNumber(pkg.price) ? el('span', { class: 'num', text: referencePrice(pkg.price) }) : null),
        pkg.features.length ? el('ul', { class: 'rec-list' }, ...pkg.features.map((text) => el('li', { text }))) : null,
      ))) : null,
      ...label.sections.map((group) => recordSection(group.name, [el('ul', { class: 'rec-list rec-priced-list' }, ...group.items.map((item) => el('li', { class: 'rec-line' }, el('span', { text: item.label }), hasNumber(item.price) ? el('span', { class: 'num', text: referencePrice(item.price) }) : null)))])),
      note(label.disclaimer || 'The vAuto label is informational, not an original Monroney window sticker. Confirm installed equipment on the vehicle.'),
    ))
  }
  const oasis = docs.fordOasis
  if (oasis || vehicle.links.oasis) children.push(el('section', { class: 'card rec rec-oasis', dataset: { record: 'oasis' }, tabindex: '-1' },
    recordHead('OASIS & warranty', { brand: 'ford', url: vehicle.links.oasis, action: 'Open OASIS', missing: 'OASIS unavailable for this VIN.', dataState: oasis?.dataState }),
    oasis ? note(sourceNote(oasis, 'oasis')) : note('Open OASIS to check this vehicle.'),
    oasis ? kv([
      ['Vehicle', oasis.vehicleDescription], ['Series', oasis.versionSeries],
      ['Warranty start', oasis.warrantyStartDate ? fmt.formatDate(oasis.warrantyStartDate) : null],
      ['Build date', oasis.buildDate ? fmt.formatDate(oasis.buildDate) : null], ['Release date', oasis.releaseDate ? fmt.formatDate(oasis.releaseDate) : null],
      ['Months in service', hasNumber(oasis.monthsInService) ? String(oasis.monthsInService) : null], ['Sale mileage', hasNumber(oasis.saleMileage) ? fmt.formatMileage(oasis.saleMileage) : null],
    ]) : null,
    oasis?.openFieldServiceActions.length ? recordSection(oasis.openActionsCaptured === false ? `At least ${oasis.openFieldServiceActions.length} captured actions · result incomplete` : 'Open Ford service actions', [el('ul', { class: 'rec-list oasis-actions' }, ...oasis.openFieldServiceActions.map((item) => el('li', {}, icon('alert', { size: 17 }), el('span', {}, item.code ? el('b', { text: item.code }) : null, item.code && item.description ? ' · ' : '', sourceDistanceText(sourceDisplayText(item.description))))))]) : el('p', { class: 'rec-empty', text: 'Verify current actions in OASIS.' }),
    oasis?.serviceHistory ? recordSection(`Ford service history · ${oasis.serviceHistory.repairOrderCount} repair ${oasis.serviceHistory.repairOrderCount === 1 ? 'order' : 'orders'}`, [
      oasis.serviceHistory.certifiedInspection ? el('p', { class: 'rec-service-certification' }, icon('check', { size: 15 }), el('strong', { text: 'Certified Blue Oval inspection' }), ` · ${fmt.formatDate(oasis.serviceHistory.certifiedInspection.closeDate)}`) : null,
      oasis.serviceHistory.recentRepairOrders.length
        ? el('ol', { class: 'rec-service-history' }, ...oasis.serviceHistory.recentRepairOrders.map((order) => el('li', {},
          el('div', { class: 'rec-line' }, el('b', { text: `${fmt.formatDate(order.openDate)} to ${fmt.formatDate(order.closeDate)}` }), hasNumber(order.odometer) ? el('span', { class: 'num', text: fmt.formatMileage(order.odometer) }) : null),
          el('p', { text: order.services.length ? order.services.join(' · ') : order.inspection || order.summary || 'Service work recorded' }),
        )))
        : el('p', { class: 'rec-empty', text: 'No detailed recent repair order is available.' }),
      oasis.serviceHistory.checkedAt ? note(`Checked ${fmt.formatDate(oasis.serviceHistory.checkedAt)}`) : null,
    ]) : null,
    oasis?.warrantyCoverages.length ? recordSection('Ford warranty coverages', [el('ul', { class: 'rec-list' }, ...oasis.warrantyCoverages.map((item) => el('li', {}, el('b', { text: item.type }), item.description ? ` · ${sourceDistanceText(sourceDisplayText(item.description))}` : '')))]) : null,
    recordList('Extended coverage expirations', oasis?.extendedCoverageExpirations?.map(value => fmt.formatSourceDateText(value))),
  ))
  const warranty = docs.warrantyCheck
  const coverageBlock = (title, block) => block?.coverages.length ? recordSection(title, [
    kv([['Warranty start', block.warrantyStartDate ? fmt.formatDate(block.warrantyStartDate) : null], ['In service (estimate)', block.inServiceDate ? fmt.formatDate(block.inServiceDate) : null], ['Months in service', hasNumber(block.monthsInService) ? String(block.monthsInService) : hasNumber(block.inServiceAgeMonths) ? String(block.inServiceAgeMonths) : null], ['AutoCheck default mileage', hasNumber(block.defaultMileage) ? fmt.formatMileage(block.defaultMileage) : null]]),
    ...block.coverages.map((coverage) => el('div', { class: 'rec-coverage' }, el('div', { class: 'rec-line' }, el('b', { text: coverage.type }), el('span', { text: coverage.status })),
      kv([['Printed term', sourceDistanceText(coverage.termText)], ['Remaining time', coverage.remainingTimeText], ['Remaining miles', sourceDistanceText(coverage.remainingMilesText)]]), note(coverage.note))),
  ]) : null
  if (warranty && (warranty.fordOasis || warranty.autoCheck)) children.push(el('section', { class: 'card rec rec-warranty', dataset: { record: 'warranty' }, tabindex: '-1' },
    recordHead('Warranty check', { iconName: 'shield', dataState: warranty.dataState, url: warranty.fordOasis ? vehicle.links.oasis : ac?.url, action: warranty.fordOasis ? 'Open OASIS' : 'Open AutoCheck report', missing: 'Warranty details unavailable.' }),
    note(sourceNote(warranty, warranty.fordOasis ? 'oasis' : 'autocheck')),
    kv([['Mileage', hasNumber(warranty.mileageEntered) ? fmt.formatMileage(warranty.mileageEntered) : null]]),
    coverageBlock('Ford OASIS coverage', warranty.fordOasis),
    coverageBlock('AutoCheck warranty estimate', warranty.autoCheck),
    note('Verify current coverage with the store before quoting a customer.'),
  ))
  const scan = vehicle.publicScan
  const listing = vehicle.listing
  const flags = fmt.joinFacts([listing.dealerOn.inStock === true ? 'in stock' : listing.dealerOn.inStock === false ? 'not in stock' : null, listing.dealerOn.inTransit === true ? 'in transit' : null, listing.dealerOn.inProduction === true ? 'in production' : null])
  children.push(el('section', { class: 'card rec' },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('globe', { size: 13 }), 'Public listing'), listing.isListed === true ? el('span', { class: 'pill pill-blue', text: 'Public' }) : null),
    kv([
      ['Status', listing.isListed === true ? 'Listed publicly' : listing.isListed === false ? 'Not publicly listed' : 'Unknown'],
      ['Website', listing.websiteStatus],
      ['Photos', vehicle.specs.photoCount !== null ? String(vehicle.specs.photoCount) : null],
    ]),
    el('p', { class: 'd-caption', text: 'Confirm availability and location with the store before promising this vehicle.' }),
    listing.url ? el('div', { class: 'dock-utils' }, chip('Open listing', 'external', () => openUrl(listing.url))) : null,
  ))
  if (vehicle.dealerComments) {
    const long = vehicle.dealerComments.length > 320
    const body = el('p', { class: `comments ${long ? 'is-clamped' : ''}`.trim(), text: vehicle.dealerComments })
    children.push(el('section', { class: 'card rec' },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('message', { size: 13 }), 'Dealer description'), copyButton(vehicle.dealerComments, 'description')),
      body,
      long ? el('button', { type: 'button', class: 'link-btn', onclick: (event) => { const open = body.classList.toggle('is-clamped'); event.currentTarget.textContent = open ? 'Read more' : 'Show less' } }, 'Read more') : null,
    ))
  }
  if (vehicle.changeSummary) children.push(section('Last change', [line('history', null, vehicle.changeSummary)], { iconName: 'history' }))
  if (!ac && !sticker && !label) children.push(el('p', { class: 'd-caption', text: 'No vehicle records are available.' }))
  const recordOrder = ['autocheck', 'oasis', 'warranty', 'window-sticker', 'vauto']
  children.sort((left, right) => {
    const leftIndex = recordOrder.indexOf(left?.dataset?.record)
    const rightIndex = recordOrder.indexOf(right?.dataset?.record)
    return (leftIndex < 0 ? recordOrder.length : leftIndex) - (rightIndex < 0 ? recordOrder.length : rightIndex)
  })
  const labels = { autocheck: 'AutoCheck', 'window-sticker': 'Sticker', vauto: 'Equipment', oasis: 'OASIS & warranty', warranty: 'Warranty check' }
  const records = children.filter((node) => node?.dataset?.record)
  if (records.length) children.unshift(el('nav', { class: 'record-jumps', 'aria-label': 'Jump to vehicle record' }, ...records.map((node) => el('button', { type: 'button', class: 'btn', onclick: () => openRecord(node.dataset.record) }, labels[node.dataset.record]))))
  children.unshift(frequentFacts(vehicle))
  return children
}

function priceTable(rows, format) {
  const present = rows.filter(([, value]) => value !== null && value !== undefined)
  if (!present.length) return null
  const table = el('dl', { class: 'price-table' })
  for (const [label, value] of present) {
    const total = /^total/i.test(label)
    table.append(el('div', { class: `price-line ${total ? 'is-total' : ''}`.trim() }, el('dt', { text: label }), el('dd', { class: 'num' }, format(value), copyButton(String(value), label, { size: 12 }))))
  }
  return table
}

function renderDetail(vehicle, { keepScroll = false } = {}) {
  const top = ui.detail.scrollTop
  ui.detailTitle.textContent = vehicle.stockNumber
  clear(ui.detailTools)
  const inCompare = state.compare.includes(vehicle.vin)
  ui.detailTools.append(
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy stock number', title: 'Copy stock number (S)', onclick: (event) => copy(vehicle.stockNumber, 'Stock number', event.currentTarget) }, icon('tag', { size: 15 })),
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy VIN', title: 'Copy VIN (V)', onclick: (event) => copy(vehicle.vin, 'VIN', event.currentTarget) }, icon('copy', { size: 15 })),
    el('button', { type: 'button', class: `icon-btn ${inCompare ? 'is-on' : ''}`.trim(), 'aria-label': inCompare ? 'Remove from compare' : 'Add to compare', 'aria-pressed': String(inCompare), title: 'Compare (C)', onclick: (event) => toggleCompare(vehicle, event.currentTarget) }, icon('columns', { size: 15 })),
  )
  clear(ui.detail)
  const actions = dock(vehicle)
  const utilities = actions.querySelector('.d-utilities')
  utilities?.remove()
  ui.detail.parentElement.querySelector(':scope > .d-utilities')?.remove()
  ui.detail.append(identity(vehicle), actions, tabsBar(vehicle), tabPanel(vehicle))
  if (utilities) ui.detail.after(utilities)
  requestAnimationFrame(() => { const bar = ui.detail.querySelector('.tabs'); if (bar) positionIndicator(bar, bar.querySelector('.tabs-ind'), '.tab') })
  ui.detail.scrollTop = keepScroll ? top : 0
}

/**
 * Fetch the per-vehicle record once. A failure is remembered so that the
 * views which re-render on completion (the compare view renders every
 * vehicle in the set, and rendering asks for details) never turn one bad
 * response into an endless stream of requests; only an explicit retry, or a
 * fresh bootstrap, asks again.
 */
async function loadDetail(vin, { retry = false } = {}) {
  if (state.details.has(vin) || state.detailPending.has(vin)) return
  if (state.detailFailed.has(vin) && !retry) return
  state.detailFailed.delete(vin)
  state.detailPending.add(vin)
  state.detailStatus = 'loading'
  if (retry && state.view === 'detail' && state.selectedVin === vin) { const vehicle = vehicleByVin(vin); if (vehicle) renderDetail(vehicle, { keepScroll: true }) }
  let detail = null
  const generation = state.dataGeneration
  try {
    detail = await fetchVehicle(state.workspace, state.settings, vin)
    if (generation !== state.dataGeneration) return
    state.detailStatus = null
  } catch (error) {
    if (generation !== state.dataGeneration) return
    if (error?.name === 'AbortError') { state.detailPending.delete(vin); return }
    state.detailStatus = error instanceof PanelApiError && error.kind === 'notfound' ? 'gone' : 'failed'
    state.detailFailed.set(vin, state.detailStatus)
  } finally {
    if (generation === state.dataGeneration) state.detailPending.delete(vin)
  }
  if (!state.bootstrap || !state.data) return
  if (detail) {
    state.details.set(vin, detail)
    const position = state.data.vehicles.findIndex((item) => item.vin === vin)
    const raw = state.bootstrap.vehicles.find((item) => item.vin === vin)
    if (position >= 0 && raw) {
      const merged = toPanelVehicle(mergeDetail(raw, detail), state.bootstrap, { origin: appOrigin() })
      const updated = withLiveDealerMailHold(merged, state.liveHoldChecks.get(vin))
      state.data.vehicles[position] = updated
      state.index[position] = buildEntry(updated)
    }
  }
  if (state.view === 'detail' && state.selectedVin === vin) {
    const vehicle = vehicleByVin(vin)
    if (vehicle) renderDetail(vehicle, { keepScroll: true })
  }
  if (state.view === 'compare') renderCompare()
}

function showView(id) {
  state.previousView = state.view
  state.view = id
  ui.panel.dataset.view = id
  for (const view of ['list', 'detail', 'compare']) $(`view-${view}`).setAttribute('aria-hidden', String(view !== id))
}

function openDetail(vehicle) {
  if (state.selectedVin !== vehicle.vin) state.photoIndex = 0
  state.selectedVin = vehicle.vin
  state.detailStatus = state.details.has(vehicle.vin) ? null : state.detailFailed.get(vehicle.vin) ?? 'loading'
  renderDetail(vehicle)
  loadDetail(vehicle.vin)
  showView('detail')
  verifyLiveHold(vehicle.vin, vehicle.stockNumber)
  setTimeout(() => ui.detail.focus({ preventScroll: true }), 40)
}

function closeDetail() {
  if (state.view !== 'detail') return
  showView('list')
  renderList()
  const row = state.selectedVin ? ui.rows.querySelector(`#row-${CSS.escape(state.selectedVin)}`) : null
  if (row) { setActive(Number(row.dataset.index)); ui.rows.focus({ preventScroll: true }) } else ui.q.focus()
}

/* Compare view ---------------------------------------------------------- */
function openCompare() {
  if (state.compare.length < 2) return
  renderCompare()
  showView('compare')
  setTimeout(() => ui.compare.focus({ preventScroll: true }), 40)
}

function closeCompare() {
  if (state.view !== 'compare') return
  const back = state.previousView === 'detail' && state.selectedVin && vehicleByVin(state.selectedVin) ? 'detail' : 'list'
  if (back === 'detail') { renderDetail(vehicleByVin(state.selectedVin), { keepScroll: true }); showView('detail') } else { showView('list'); renderList(); ui.q.focus() }
}

function renderCompare() {
  const vehicles = state.compare.map(vehicleByVin).filter(Boolean)
  const sameSet = ui.compare.dataset.vehicleSet === vehicles.map((vehicle) => vehicle.vin).join('|')
  const previousScroll = state.view === 'compare' && sameSet ? ui.compare.scrollTop : 0
  const differencesOnly = ui.compare.dataset.differencesOnly === 'true'
  ui.compare.dataset.vehicleSet = vehicles.map((vehicle) => vehicle.vin).join('|')
  for (const vehicle of vehicles) loadDetail(vehicle.vin)
  clear(ui.compareTools)
  clear(ui.compare)
  ui.compareTitle.textContent = `Compare ${vehicles.length}`
  if (vehicles.length < 2) {
    ui.compare.append(el('div', { class: 'status is-empty' }, el('div', { class: 'status-icon' }, icon('columns', { size: 18 })), el('h3', { text: 'Pick two or three vehicles' }), el('p', { text: 'Open a vehicle and tap Compare. The set stays until you clear it.' }), el('div', { class: 'status-actions' }, el('button', { type: 'button', class: 'btn', onclick: closeCompare }, 'Back to results'))))
    return
  }
  ui.compareTools.append(el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Clear compare set', title: 'Clear', onclick: () => { setCompare([]); closeCompare(); renderList() } }, icon('x', { size: 15 })))
  const result = compareVehicles(vehicles)
  const head = el('div', { class: 'cmp-head', style: { '--cols': vehicles.length } },
    ...vehicles.map((vehicle) => {
      const photos = photosFor(vehicle)
      return el('div', { class: 'cmp-col' },
        photos.length ? el('img', { class: 'cmp-photo', src: photos[0], alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'cmp-photo is-empty' }, icon('image', { size: 14 })),
        el('button', { type: 'button', class: 'cmp-stock', 'aria-label': `Open ${vehicle.stockNumber}`, onclick: () => { openDetail(vehicle) } }, el('b', { text: vehicle.stockNumber }), icon('arrow-right', { size: 13 })),
        el('small', { text: vehicle.name, title: vehicle.name }),
        el('button', { type: 'button', class: 'cmp-remove', 'aria-label': `Remove ${vehicle.stockNumber} from compare`, onclick: () => { setCompare(state.compare.filter((vin) => vin !== vehicle.vin)); renderList(); renderCompare() } }, icon('x', { size: 12 })),
      )
    }))
  const rows = el('div', { class: 'cmp-rows', style: { '--cols': vehicles.length } })
  let diffs = 0
  for (const fact of result.facts) {
    if (fact.differs) diffs += 1
    rows.append(el('section', { class: `cmp-row ${fact.differs ? 'is-diff' : ''}`.trim(), 'aria-label': fact.label, dataset: { differs: String(fact.differs) }, hidden: differencesOnly && !fact.differs },
      el('h3', { class: 'cmp-label', text: fact.label }),
      el('div', { class: 'cmp-values' }, ...fact.values.map((value, index) => el('span', { class: `cmp-val ${/^[\d$,.\s–-]+(?:\s?mi)?$/.test(value) ? 'num' : ''}`.trim(), text: value, 'aria-label': `${vehicles[index].stockNumber}: ${value}` })))))
  }
  const onlyOn = result.onlyOn.filter((entry) => entry.items.length)
  ui.compare.append(
    head,
    el('div', { class: 'cmp-controls' }, el('button', { type: 'button', class: 'btn cmp-differences-toggle', 'aria-pressed': String(differencesOnly), onclick: (event) => {
      const only = ui.compare.dataset.differencesOnly !== 'true'
      ui.compare.dataset.differencesOnly = String(only)
      event.currentTarget.setAttribute('aria-pressed', String(only))
      for (const row of rows.children) row.hidden = only && row.dataset.differs !== 'true'
    } }, 'Differences only')),
    el('p', { class: 'cmp-note', text: `${diffs} of ${result.facts.length} facts differ · ${fmt.formatNumber(result.shared)} equipment item${result.shared === 1 ? '' : 's'} in common` }),
    rows,
    onlyOn.length ? el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('sparkles', { size: 13 }), 'Equipment differences')),
      ...onlyOn.map((entry) => el('div', { class: 'cmp-only' }, el('b', { text: `Only on ${entry.vehicle.stockNumber}` }), el('ul', { class: 'cmp-equipment-list' }, ...entry.items.map((label) => el('li', { text: label })))))) : null,
    el('p', { class: 'd-freshness', text: 'Confirm availability, location, and installed equipment with the store before promising a vehicle.' }),
  )
  ui.compare.scrollTop = previousScroll
}

/* Settings sheet -------------------------------------------------------- */
function segmented(options, value, onChange, label) {
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label })
  for (const option of options) {
    seg.append(el('button', { type: 'button', dataset: { value: option.value }, 'aria-pressed': String(option.value === value), onclick: async () => { await onChange(option.value); for (const button of seg.children) button.setAttribute('aria-pressed', String(button.dataset.value === option.value)) } }, option.label))
  }
  return seg
}

function select(options, value, onChange, label = (option) => option) {
  const node = el('select', { class: 'select', onchange: (event) => onChange(event.target.value) })
  for (const option of options) node.append(el('option', { value: option, selected: option === value ? true : null, text: label(option) }))
  return node
}

async function updateSettings(patch, { reload = false } = {}) {
  state.settings = await storage.setSettings(patch)
  state.workspace = workspaceFor(state.settings, host)
  applyTheme(); applyDensity()
  if (reload) { resetIdentityView(); state.data = null; state.bootstrap = null; state.index = []; state.error = null; state.fetchedAt = null; clear(ui.rows); clear(ui.detail); clear(ui.compare); clear(ui.tray); ui.tray.hidden = true; ui.more.hidden = true; ui.resultContext.hidden = true; ui.expandStores.hidden = true; await storage.clearCache(); renderWho(); renderScopes(); renderStorePicker(); renderWorkspaceLinks(); await load() }
}

function renderSheet() {
  clear(ui.sheetBody)
  const s = state.settings
  ui.sheetBody.append(
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Appearance' }), segmented([{ value: 'light', label: 'Match app' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }], s.theme, (theme) => updateSettings({ theme }), 'Appearance'), el('p', { class: 'field-help', text: 'Match app uses Inventory Flow’s white, navy, and blue design. System follows your device.' })),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Density' }), segmented([{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], s.density, (density) => updateSettings({ density }), 'Density')),
  )
  if (host === 'extension') {
    ui.sheetBody.append(el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Workspace' }),
      segmented(Object.values(WORKSPACES).map((item) => ({ value: item.id, label: item.label })), s.workspace, (workspace) => updateSettings({ workspace }, { reload: true }).then(() => { renderSheet(); ui.sheetBody.querySelector('[aria-label="Workspace"] [aria-pressed="true"]')?.focus({ preventScroll: true }) }), 'Workspace'),
      el('p', { class: 'field-help', text: s.workspace === 'demo' ? 'The local demo is synthetic training data from pnpm dev:demo — never live inventory.' : 'Production uses your Cloudflare Access sign-in for Inventory Flow.' })))
  }
  if (state.workspace.demo) {
    const demoRole = select(ROLE_PICKER_ROLES, s.demoRole, (nextRole) => updateSettings({ demoRole: nextRole }, { reload: true }), roleLabel)
    if (!ROLE_PICKER_ROLES.includes(s.demoRole)) demoRole.prepend(el('option', { value: s.demoRole, selected: true, disabled: true, text: `${roleLabel(s.demoRole)} · Legacy` }))
    ui.sheetBody.append(
      el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'demo-role', text: 'Demo role' }), Object.assign(demoRole, { id: 'demo-role' })),
      el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'demo-store', text: 'Demo store' }), Object.assign(select(STORES, s.demoStore, (demoStore) => updateSettings({ demoStore }, { reload: true })), { id: 'demo-store' })),
    )
  }
  ui.sheetBody.append(el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Keyboard' }), el('dl', { class: 'keys' },
    el('dt', {}, el('kbd', { text: '/' })), el('dd', { text: 'Focus search' }),
    el('dt', {}, el('kbd', { text: '↑' }), el('kbd', { text: '↓' })), el('dd', { text: 'Move through results' }),
    el('dt', {}, el('kbd', { text: 'Enter' })), el('dd', { text: 'Open the vehicle' }),
    el('dt', {}, el('kbd', { text: 'Esc' })), el('dd', { text: 'Back, or clear the search' }),
    el('dt', {}, el('kbd', { text: 'S' }), el('kbd', { text: 'V' })), el('dd', { text: 'Copy stock or VIN from a vehicle' }),
    el('dt', {}, el('kbd', { text: 'F' })), el('dd', { text: 'Filters and sort' }),
    el('dt', {}, el('kbd', { text: 'C' })), el('dd', { text: 'Add or remove the vehicle in Compare' }),
    el('dt', {}, el('kbd', { text: '1' }), el('kbd', { text: '4' })), el('dd', { text: 'Jump to a vehicle section' }),
    el('dt', {}, el('kbd', { text: 'Alt' }), el('kbd', { text: 'Shift' }), el('kbd', { text: 'V' })), el('dd', { text: 'Open this panel from any page' }),
  )))
  ui.sheetBody.append(el('p', { class: 'field-help', text: `Read-only. Requests and moves open in Inventory Flow, where your role and store are enforced. ${host === 'preview' ? 'Preview mode: served locally against the demo API.' : ''}`.trim() }))
}

/* Filters + sort sheet ------------------------------------------------- */
function optionChips(label, key, options, { format = (value) => value } = {}) {
  if (!options.length) return null
  const wrap = el('div', { class: 'field' }, el('span', { class: 'field-label', text: label }))
  const row = el('div', { class: 'opt-row', role: 'group', 'aria-label': label })
  for (const option of options) {
    const on = state.filters[key].some((item) => item.toLowerCase() === option.value.toLowerCase())
    row.append(el('button', { type: 'button', class: `opt ${on ? 'is-on' : ''}`.trim(), 'aria-pressed': String(on), onclick: (event) => {
      const wasOn = state.filters[key].some((item) => item.toLowerCase() === option.value.toLowerCase())
      const next = state.filters[key].filter((item) => item.toLowerCase() !== option.value.toLowerCase())
      if (!wasOn) next.push(option.value)
      setFilters({ [key]: next })
      const nowOn = !wasOn
      event.currentTarget.classList.toggle('is-on', nowOn); event.currentTarget.setAttribute('aria-pressed', String(nowOn))
      updateSheetFooter()
    } }, format(option.value), el('b', { class: 'num', text: fmt.formatNumber(option.count) })))
  }
  wrap.append(row)
  return wrap
}

function rangeSelect(label, key, values, { format = (value) => String(value), placeholder = 'Any' } = {}) {
  const node = el('select', { class: 'select select-sm', 'aria-label': label, onchange: (event) => { setFilters({ [key]: event.target.value === '' ? null : Number(event.target.value) }); updateSheetFooter() } })
  node.append(el('option', { value: '', text: placeholder, selected: state.filters[key] === null ? true : null }))
  for (const value of values) node.append(el('option', { value: String(value), text: format(value), selected: state.filters[key] === value ? true : null }))
  return node
}

function toggle(label, key, hint) {
  const on = state.filters[key] === true
  return el('button', { type: 'button', class: `opt opt-toggle ${on ? 'is-on' : ''}`.trim(), 'aria-pressed': String(on), title: hint ?? null, onclick: (event) => { const next = !state.filters[key]; setFilters({ [key]: next }); event.currentTarget.classList.toggle('is-on', next); event.currentTarget.setAttribute('aria-pressed', String(next)); updateSheetFooter() } }, on ? icon('check', { size: 12 }) : null, label)
}

function setFilters(patch) {
  state.filters = normalizeFilters({ ...state.filters, ...patch })
  if (patch.noHold === true) state.scope = 'inventory'
  state.shown = PAGE
  state.activeIndex = -1
  storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {})
  renderFilterState()
  renderList()
}

function steps(max, step) {
  if (max === null) return []
  const out = []
  for (let value = step; value < max + step; value += step) out.push(value)
  return out.slice(0, 40)
}

function updateSheetFooter() {
  const footer = ui.sheetBody.querySelector('.sheet-foot')
  if (!footer) return
  const count = currentResults().length
  footer.querySelector('.btn-primary').textContent = `Show ${fmt.formatNumber(count)} vehicle${count === 1 ? '' : 's'}`
}

function renderFilterSheet() {
  clear(ui.sheetBody)
  const vehicles = (state.data?.vehicles ?? []).filter((vehicle) => !selectedStore() || vehicle.homeStore === selectedStore())
  const options = filterOptions(vehicles)
  const years = options.yearMin !== null && options.yearMax !== null ? Array.from({ length: options.yearMax - options.yearMin + 1 }, (_, index) => options.yearMax - index) : []
  const ledger = (title, ...fields) => el('section', { class: 'filter-ledger', 'aria-label': title }, el('h3', { class: 'filter-ledger-title', text: title }), el('div', { class: 'filter-ledger-fields' }, ...fields))
  ui.sheetBody.append(
    el('p', { class: 'field-help filter-context', text: `Filters apply to ${storeLabel()} inventory. Results update as you choose.` }),
    ledger('Service', el('div', { class: 'service-filter-buttons', id: 'service-filter-buttons', role: 'group', 'aria-label': 'Service status' }, ...['', 'needs_service', 'in_service', 'serviced'].map((status) => el('button', { type: 'button', class: 'opt-chip', 'aria-pressed': String(state.filters.serviceStatus === status), dataset: { serviceStatus: status }, onclick: (event) => { setFilters({ serviceStatus: status }); for (const button of event.currentTarget.parentElement.children) button.setAttribute('aria-pressed', String(button.dataset.serviceStatus === status)); updateSheetFooter() } }, SERVICE_LABELS[status] ?? 'All')))),
    ledger('Sort and inventory',
      el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'sort-select', text: 'Sort' }), Object.assign(select(SORTS.map((item) => item.id), state.sort, (sort) => { state.sort = sort; storage.setFilters({ filters: state.filters, sort }).catch(() => {}); renderFilterState(); renderList() }, (id) => SORTS.find((item) => item.id === id)?.label ?? id), { id: 'sort-select' })),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Only show' }), el('div', { class: 'opt-row', role: 'group', 'aria-label': 'Inventory signals' },
        toggle('Certified', 'certified'), toggle('Listed publicly', 'listed'), toggle('No hold found', 'noHold', 'The current DealerMail snapshot found no hold — not an availability promise'), toggle('With photos', 'photos')), el('p', { class: 'field-help', text: 'A public listing or no recorded hold does not confirm availability.' }))),
    ledger('Vehicle', optionChips('Make', 'makes', options.makes), optionChips('Model', 'models', options.models), optionChips('Body', 'bodies', options.bodies), optionChips('Drivetrain', 'drivetrains', options.drivetrains), optionChips('Fuel', 'fuels', options.fuels)),
    ledger('Year, price and mileage',
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Year' }), el('div', { class: 'range-row' }, rangeSelect('Year from', 'yearMin', [...years].reverse(), { placeholder: 'From' }), el('span', { class: 'range-sep', text: 'to' }), rangeSelect('Year to', 'yearMax', years, { placeholder: 'To' }))),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Price and mileage' }), el('div', { class: 'range-row' },
        rangeSelect('Price up to', 'priceMax', steps(options.priceMax, 5000), { format: (value) => `Up to ${fmt.formatMoney(value)}`, placeholder: 'Any price' }),
        rangeSelect('Mileage up to', 'mileageMax', steps(options.mileageMax, 10000), { format: (value) => `Up to ${fmt.formatMileage(value)}`, placeholder: 'Any mileage' })))),
    el('div', { class: 'sheet-foot' },
      el('button', { type: 'button', class: 'btn', onclick: () => { state.filters = { ...EMPTY_FILTERS }; state.sort = 'relevance'; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList(); renderFilterSheet(); ui.sheetBody.querySelector('.sheet-foot .btn')?.focus({ preventScroll: true }) } }, 'Clear all'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: closeSheet }, `Show ${fmt.formatNumber(currentResults().length)} vehicle${currentResults().length === 1 ? '' : 's'}`),
    ),
  )
}

let sheetOpen = false
let sheetCloseTimer = null
const sheetBackgroundState = new Map()

function setSheetBackgroundInert(active) {
  if (active) {
    for (const node of ui.panel.children) {
      if (node === ui.sheet || node === ui.backdrop || node === ui.toast) continue
      if (!sheetBackgroundState.has(node)) sheetBackgroundState.set(node, node.hasAttribute('inert'))
      node.setAttribute('inert', '')
    }
  } else {
    for (const [node, wasInert] of sheetBackgroundState) if (!wasInert) node.removeAttribute('inert')
    sheetBackgroundState.clear()
  }
}

function sheetFocusableElements() {
  return [...ui.sheet.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter((node) => !node.matches(':disabled') && node.tabIndex >= 0 && !node.closest('[hidden], [inert], [aria-hidden="true"]'))
}

function openFilters() {
  clearTimeout(sheetCloseTimer)
  sheetOpen = true
  state.sheetKind = 'filters'
  state.sheetReturnFocus = document.activeElement
  document.getElementById('sheet-title').textContent = 'Filters & sort'
  ui.sheetClose.setAttribute('aria-label', 'Close filters and sort')
  ui.sheet.dataset.kind = 'filters'
  renderFilterSheet()
  ui.backdrop.hidden = false
  ui.sheet.hidden = false
  ui.sheet.removeAttribute('inert')
  ui.sheet.setAttribute('aria-hidden', 'false')
  setSheetBackgroundInert(true)
  ui.filtersBtn.setAttribute('aria-expanded', 'true')
  requestAnimationFrame(() => { if (!sheetOpen) return; ui.backdrop.classList.add('is-in'); ui.sheet.classList.add('is-in'); ui.sheetClose.focus() })
}

function openSheet() {
  clearTimeout(sheetCloseTimer)
  sheetOpen = true
  state.sheetKind = 'settings'
  state.sheetReturnFocus = document.activeElement
  document.getElementById('sheet-title').textContent = 'Settings'
  ui.sheetClose.setAttribute('aria-label', 'Close settings')
  ui.sheet.dataset.kind = 'settings'
  renderSheet()
  ui.backdrop.hidden = false
  ui.sheet.hidden = false
  ui.sheet.removeAttribute('inert')
  ui.sheet.setAttribute('aria-hidden', 'false')
  setSheetBackgroundInert(true)
  ui.settingsBtn.setAttribute('aria-expanded', 'true')
  requestAnimationFrame(() => { if (!sheetOpen) return; ui.backdrop.classList.add('is-in'); ui.sheet.classList.add('is-in'); ui.sheetClose.focus() })
}

function closeSheet() {
  if (!sheetOpen) return
  sheetOpen = false
  ui.backdrop.classList.remove('is-in')
  ui.sheet.classList.remove('is-in')
  ui.sheet.setAttribute('inert', '')
  ui.sheet.setAttribute('aria-hidden', 'true')
  setSheetBackgroundInert(false)
  ui.settingsBtn.setAttribute('aria-expanded', 'false')
  ui.filtersBtn.setAttribute('aria-expanded', 'false')
  sheetCloseTimer = setTimeout(() => { ui.backdrop.hidden = true; ui.sheet.hidden = true }, 280)
  const returnTarget = state.sheetReturnFocus?.isConnected && !state.sheetReturnFocus.closest('[inert]') ? state.sheetReturnFocus : state.sheetKind === 'filters' ? ui.filtersBtn : ui.settingsBtn
  returnTarget?.focus?.({ preventScroll: true })
}

/* Search input ---------------------------------------------------------- */
function setQuery(value, { focus = false } = {}) {
  state.query = value
  if (ui.q.value !== value) ui.q.value = value
  ui.search.classList.toggle('has-value', Boolean(value))
  ui.clearBtn.hidden = !value
  state.shown = PAGE
  state.activeIndex = -1
  renderList()
  if (focus) ui.q.focus()
}

ui.q.addEventListener('input', () => setQuery(ui.q.value))
ui.clearBtn.addEventListener('click', () => setQuery('', { focus: true }))
ui.rows.addEventListener('scroll', () => ui.sticky.classList.toggle('is-raised', ui.rows.scrollTop > 0), { passive: true })

ui.q.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); setActive(state.activeIndex < 0 ? 0 : state.activeIndex + 1); ui.rows.focus({ preventScroll: true }) }
  else if (event.key === 'Enter') { const match = state.results[Math.max(0, state.activeIndex)]; if (match) openDetail(match.vehicle) }
  else if (event.key === 'Escape') { if (ui.q.value) { event.preventDefault(); setQuery('') } else ui.q.blur() }
})

ui.rows.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); setActive(state.activeIndex + 1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); if (state.activeIndex <= 0) { setActive(-1); ui.q.focus() } else setActive(state.activeIndex - 1) }
  else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
  else if (event.key === 'End') { event.preventDefault(); setActive(Math.min(state.results.length, state.shown) - 1) }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const match = state.results[state.activeIndex]; if (match) openDetail(match.vehicle) }
  else if (event.key === 'Escape') { setActive(-1); ui.q.focus() }
})

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)
  if (sheetOpen) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSheet() }
    else if (event.key === 'Tab') {
      const focusable = sheetFocusableElements()
      const first = focusable[0] ?? ui.sheetClose
      const last = focusable.at(-1) ?? first
      const active = document.activeElement
      if (!focusable.includes(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault()
        const nextFocus = event.shiftKey ? last : first
        nextFocus.focus({ preventScroll: true })
      }
    }
    return
  }
  if (event.key === '/' && !typing) { event.preventDefault(); ui.q.focus(); ui.q.select(); return }
  if ((event.key === 'f' || event.key === 'F') && !typing && state.view === 'list' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); openFilters(); return }
  if (state.view === 'compare') {
    if (event.key === 'Escape' || (event.key === 'Backspace' && !typing)) { event.preventDefault(); closeCompare() }
    return
  }
  if (state.view === 'detail') {
    if (event.key === 'Escape' || (event.key === 'Backspace' && !typing)) { event.preventDefault(); closeDetail(); return }
    const vehicle = vehicleByVin(state.selectedVin)
    if (!vehicle || typing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 's' || event.key === 'S') copy(vehicle.stockNumber, 'Stock number', ui.detailTools.children[0])
    if (event.key === 'v' || event.key === 'V') copy(vehicle.vin, 'VIN', ui.detailTools.children[1])
    if (event.key === 'c' || event.key === 'C') toggleCompare(vehicle, ui.detailTools.children[2])
    const index = Number(event.key) - 1
    if (index >= 0 && index < TABS.length) switchTab(TABS[index][0])
  }
})

ui.scope.addEventListener('keydown', (event) => {
  const tabs = [...ui.scope.querySelectorAll('.scope-tab')]
  const current = tabs.findIndex((tab) => tab.getAttribute('aria-pressed') === 'true')
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const next = tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setScope(next.dataset.scope); ui.scope.querySelector(`[data-scope="${state.scope}"]`)?.focus()
  }
})

ui.back.addEventListener('click', closeDetail)
ui.compareBack.addEventListener('click', closeCompare)
ui.refresh.addEventListener('click', () => load())
ui.brand.addEventListener('click', () => openUrl(links.appHomeUrl(appOrigin())))
ui.settingsBtn.addEventListener('click', openSheet)
ui.filtersBtn.addEventListener('click', openFilters)
ui.storeSelect.addEventListener('change', () => setStoreScope(ui.storeSelect.value))
ui.storeHome.addEventListener('click', () => setStoreScope('home'))
ui.storeAll.addEventListener('click', () => setStoreScope('all'))
ui.sheetClose.addEventListener('click', closeSheet)
ui.backdrop.addEventListener('click', closeSheet)

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.data && isStale() && !state.loading) load({ silent: true }) })
window.addEventListener('focus', () => { if (state.data && isStale() && !state.loading) load({ silent: true }) })
setInterval(() => {
  if (document.visibilityState !== 'visible') return
  renderFreshness()
  if (state.data && isStale() && !state.loading) load({ silent: true })
  else if (state.view === 'detail' && state.selectedVin) {
    const vehicle = vehicleByVin(state.selectedVin)
    const check = state.liveHoldChecks.get(state.selectedVin)
    if (vehicle && check?.status !== 'checking' && (!check?.checkedAt || Date.now() - Date.parse(check.checkedAt) > 2 * 60_000)) {
      verifyLiveHold(vehicle.vin, vehicle.stockNumber)
    }
  }
}, 60_000)

/* Boot ------------------------------------------------------------------ */
async function boot() {
  ui.panel.classList.add('no-motion')
  state.settings = await storage.getSettings()
  state.workspace = workspaceFor(state.settings, host)
  applyTheme(); applyDensity()
  renderScopes()
  state.compare = await storage.getCompare()
  const saved = await storage.getFilters()
  // Store scope is now explicit above the list. Retire the hidden saved
  // store filter so reopening never strands the user in another store.
  state.filters = normalizeFilters({ ...saved?.filters, stores: [] })
  state.sort = SORTS.some((item) => item.id === saved?.sort) ? saved.sort : 'relevance'
  renderFilterState()
  const pending = await storage.takePendingQuery()
  if (pending) setQuery(pending)
  storage.onPendingQuery((text) => { closeSheet(); if (state.view === 'compare') closeCompare(); closeDetail(); setQuery(text, { focus: true }) })
  // The session cache is only ever shown for the synthetic demo. In production
  // the panel always revalidates first: a shared Chrome profile can change
  // Access users, and a cached document is one user's role-and-store
  // projection that the next user may not be entitled to see.
  const cache = await storage.getCache()
  if (state.workspace.demo && cache?.bootstrap && cache.key === cacheKey()) hydrate(cache.bootstrap, cache.fetchedAt)
  await load({ silent: Boolean(state.data) })
  requestAnimationFrame(() => { ui.panel.classList.remove('no-motion'); positionIndicator(ui.scope, ui.scopeInd, '.scope-tab', 'aria-pressed') })
  if (!pending) ui.q.focus()
}

boot().catch((error) => { console.error(error); state.error = new PanelApiError('invalid'); hideSkeleton(); renderStatus() })
