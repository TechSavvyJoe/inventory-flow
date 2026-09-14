import { ROLES, STALE_AFTER_MS, STORES, WORKSPACES, workspaceFor } from './lib/config.mjs'
import { PanelApiError, fetchBootstrap, fetchVehicle } from './lib/api.mjs'
import { buildPanelData, canRequestVehicle, copyFields, dealSheetText, mergeDetail, requestBlockedReason, roleLabel, toPanelVehicle } from './lib/model.mjs'
import { buildEntry, buildIndex, rank } from './lib/search.mjs'
import { SOURCE_LABELS } from './lib/equipment.mjs'
import { EMPTY_FILTERS, SORTS, activeFilterCount, applyFilters, describeFilters, filterOptions, normalizeFilters, sortMatches } from './lib/filters.mjs'
import { compareVehicles } from './lib/compare.mjs'
import { certifiedTerms, warrantyOutlook } from './lib/warranty.mjs'
import { brandFor } from './lib/brand.mjs'
import * as links from './lib/links.mjs'
import * as fmt from './lib/format.mjs'
import { clear, el, icon } from './lib/dom.mjs'
import { copyText, host, openExtensionPage, openUrl, placeholderPhotos, previewFlags, storage } from './lib/host.mjs'
import { takeHomeModel } from './lib/takehome.mjs'

const $ = (id) => document.getElementById(id)
const ui = {
  panel: $('panel'), brand: $('brand'), who: $('who'), settingsBtn: $('settings-btn'),
  sticky: $('sticky'), search: $('search'), searchIcon: $('search-icon'), q: $('q'), clearBtn: $('clear'), kbd: $('search-kbd'),
  scope: $('scope'), scopeInd: $('scope-ind'), filtersBtn: $('filters-btn'), filterCount: $('filter-count'), filterSummary: $('filter-summary'), status: $('status'), rows: $('rows'), more: $('more'), skeleton: $('skeleton'), tray: $('tray'),
  back: $('back'), detailTitle: $('detail-bar-title'), detailTools: $('detail-tools'), detail: $('detail'),
  compareBack: $('compare-back'), compareTitle: $('compare-title'), compareTools: $('compare-tools'), compare: $('compare'),
  freshText: $('fresh-text'), refresh: $('refresh'),
  backdrop: $('sheet-backdrop'), sheet: $('sheet'), sheetClose: $('sheet-close'), sheetBody: $('sheet-body'), toast: $('toast'),
}

const PAGE = 60
const TABS = [['overview', 'Overview'], ['hold', 'Hold & custody'], ['equipment', 'Equipment'], ['records', 'Records']]
const state = {
  settings: null, workspace: null, data: null, bootstrap: null, index: [], results: [], shown: PAGE, details: new Map(), detailStatus: null,
  query: '', scope: 'home', activeIndex: -1, selectedVin: null, view: 'list', tab: 'overview', photoIndex: 0, compare: [], odometer: new Map(), detailFailed: new Map(), detailPending: new Set(),
  filters: { ...EMPTY_FILTERS }, sort: 'relevance', sheetKind: 'settings',
  loading: false, error: null, fetchedAt: null, controller: null, toastTimer: null, sheetReturnFocus: null, previousView: 'list',
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
  ui.q.placeholder = width < 352 ? 'Stock, VIN, or vehicle' : 'Stock, VIN, vehicle, or salesperson'
  positionIndicator(ui.scope, ui.scopeInd, '.scope-tab')
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

function cacheKey() {
  const identity = state.workspace.demo ? `${state.settings.demoRole}:${state.settings.demoStore}` : 'access'
  return `${state.workspace.origin}|${identity}`
}

function vehicleByVin(vin) { return state.data?.vehicles.find((item) => item.vin === vin) ?? null }

function hydrate(bootstrap, fetchedAt) {
  state.bootstrap = bootstrap
  state.data = buildPanelData(bootstrap)
  state.index = buildIndex(state.data.vehicles)
  state.details.clear()
  state.detailFailed.clear()
  state.fetchedAt = fetchedAt
  state.error = null
  setCompare(state.compare.filter((vin) => vehicleByVin(vin)), { persist: false })
  renderWho()
  renderScopes()
  renderList()
  renderFreshness()
  if (state.view === 'detail' && state.selectedVin) {
    const vehicle = vehicleByVin(state.selectedVin)
    if (vehicle) { loadDetail(vehicle.vin); renderDetail(vehicle, { keepScroll: true }) }
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
    if (['signin', 'forbidden'].includes(state.error.kind)) storage.clearCache().catch(() => {})
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
  return previewFlags.photos ? placeholderPhotos(vehicle) : []
}

/* Rendering: masthead + scope ----------------------------------------- */
function renderWho() {
  const access = state.data?.access
  ui.who.textContent = access ? `${access.store} · ${roleLabel(access.role)}` : ''
  ui.who.title = access?.user ? `Signed in as ${access.user}` : ''
}

function scopeDefinitions() {
  const store = workingStore()
  const vehicles = state.data?.vehicles ?? []
  const held = vehicles.filter((item) => item.hold.hasActiveHold === true).length
  const home = store ? vehicles.filter((item) => item.homeStore === store).length : vehicles.length
  return [
    { id: 'home', label: store ?? 'Home', count: home, filter: (item) => !store || item.homeStore === store },
    { id: 'group', label: 'All stores', count: vehicles.length, filter: () => true },
    { id: 'held', label: 'Held', count: held, filter: (item) => item.hold.hasActiveHold === true },
  ]
}

function renderScopes() {
  // Counts are only honest once inventory has loaded; until then the row is
  // not shown at all rather than showing zeros.
  ui.scope.parentElement.hidden = !state.data
  const scopes = scopeDefinitions()
  for (const node of [...ui.scope.querySelectorAll('.scope-tab')]) node.remove()
  for (const scope of scopes) {
    ui.scope.append(el('button', {
      type: 'button', class: 'scope-tab', role: 'tab', id: `scope-${scope.id}`, dataset: { scope: scope.id },
      'aria-selected': String(scope.id === state.scope), tabindex: scope.id === state.scope ? '0' : '-1',
      onclick: () => setScope(scope.id),
    }, scope.label, el('b', { text: fmt.formatNumber(scope.count) })))
  }
  positionIndicator(ui.scope, ui.scopeInd, '.scope-tab')
}

function positionIndicator(container, indicator, selector) {
  const active = container?.querySelector(`${selector}[aria-selected="true"]`)
  if (!active || !indicator) return
  indicator.style.width = `${active.offsetWidth}px`
  indicator.style.transform = `translateX(${active.offsetLeft}px)`
}

function setScope(id) {
  if (state.scope === id) return
  state.scope = id
  state.shown = PAGE
  state.activeIndex = -1
  for (const tab of ui.scope.querySelectorAll('.scope-tab')) {
    const selected = tab.dataset.scope === id
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
  }
  positionIndicator(ui.scope, ui.scopeInd, '.scope-tab')
  renderList()
}

/* Rendering: list ------------------------------------------------------ */
function currentResults() {
  const scope = scopeDefinitions().find((item) => item.id === state.scope) ?? scopeDefinitions()[0]
  const hasQuery = Boolean(state.query.trim())
  const ranked = applyFilters(rank(state.index, state.query).filter((match) => scope.filter(match.vehicle)), state.filters)
  return sortMatches(ranked, state.sort, { hasQuery })
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
  if (loc.provenance === 'app-confirmed') return `App-confirmed${loc.confirmedAt ? ` ${fmt.formatDateTime(loc.confirmedAt)}` : ''}${loc.custodian ? ` · ${loc.custodian}` : ''}`
  if (loc.provenance === 'source-reported') return 'Source-reported store — not a physical confirmation'
  return 'No current location evidence'
}

function holdPill(vehicle, { long = false } = {}) {
  const hold = vehicle.hold
  const tone = hold.tone === 'held' ? 'pill-held' : hold.tone === 'clear' ? '' : 'pill-moving'
  const label = long ? hold.label : hold.tone === 'held' ? (hold.position === 'backup' ? 'Held · backup' : hold.position === 'multiple' ? `Held · ${hold.backupCount + 1}` : 'Held') : hold.tone === 'clear' ? 'No hold found' : 'Hold unverified'
  return el('span', { class: `pill ${tone}`.trim(), title: hold.label }, hold.tone === 'held' ? icon('lock') : null, label)
}

function movementPill(vehicle) {
  const move = vehicle.movement
  if (!move) return null
  return el('span', { class: `pill ${move.overdue ? 'pill-alert' : 'pill-moving'}`, title: move.nextAction ?? move.label ?? 'Move in progress' }, icon('truck'), move.overdue ? 'Move overdue' : 'Moving')
}

function certifiedBadge(vehicle, { size = 'sm' } = {}) {
  if (!vehicle.certifiedProgram) return null
  const program = vehicle.certifiedProgram
  return el('span', { class: `cert cert-${size} ${program.brand ? `cert-${program.brand}` : ''}`.trim(), title: `${program.name} — separate from any factory warranty still running` }, icon('badge-check'), size === 'sm' ? 'Certified' : program.name)
}

function rowThumb(vehicle) {
  const photos = photosFor(vehicle)
  if (photos.length) return el('span', { class: 'row-thumb' }, el('img', { src: photos[0], alt: '', loading: 'lazy', decoding: 'async' }))
  return el('span', { class: 'row-thumb is-empty', title: 'No photos published' }, icon('image', { size: 13 }))
}

function renderRow(match, position) {
  const vehicle = match.vehicle
  const metaParts = [fmt.formatMoney(vehicle.price), vehicle.mileage !== null ? fmt.formatMileage(vehicle.mileage) : null, fmt.formatDays(vehicle.daysListed)]
  const via = state.query && match.matchedLabels.find((label) => !['Stock', 'VIN', 'Vehicle', 'Make', 'Model', 'Year', 'Trim'].includes(label))
  const inCompare = state.compare.includes(vehicle.vin)
  return el('li', {
    class: `row ${position === state.activeIndex ? 'is-active' : ''} ${inCompare ? 'is-compared' : ''}`.trim(), role: 'option', id: `row-${vehicle.vin}`,
    'aria-selected': String(position === state.activeIndex), dataset: { vin: vehicle.vin, index: String(position) },
    onclick: () => openDetail(vehicle),
  },
    el('span', { class: 'plate' }, rowThumb(vehicle), el('b', { text: vehicle.stockNumber, title: `Stock ${vehicle.stockNumber}` }), el('small', { text: vehicle.homeStore })),
    el('span', { class: 'row-main' },
      el('span', { class: 'row-title', text: vehicle.name, title: vehicle.name }),
      el('span', { class: 'row-meta' }, fmt.joinFacts(metaParts), via ? el('em', { text: ` · via ${via.toLowerCase()}` }) : null),
      el('span', { class: 'row-status' }, holdPill(vehicle), movementPill(vehicle), vehicle.certified ? el('span', { class: 'pill pill-blue', title: `${vehicle.certifiedProgram.name} — separate from any factory warranty` }, icon('badge-check'), 'Certified') : null, locationNode(vehicle)),
    ),
    inCompare ? el('span', { class: 'row-cmp', title: 'In the compare set' }, icon('columns', { size: 13 })) : icon('chevron-right', { size: 14 }),
  )
}

function renderList() {
  if (!state.data) return
  hideSkeleton()
  state.results = currentResults()
  clear(ui.rows)
  clear(ui.more)
  ui.more.hidden = true
  renderTray()
  if (state.results.length === 0) { renderStatus(); return }
  ui.status.hidden = true
  const visible = state.results.slice(0, state.shown)
  visible.forEach((match, position) => ui.rows.append(renderRow(match, position)))
  if (state.results.length > visible.length) {
    ui.more.hidden = false
    ui.more.append(el('button', { type: 'button', onclick: () => { state.shown += PAGE; renderList() } }, `Show ${fmt.formatNumber(Math.min(PAGE, state.results.length - visible.length))} more of ${fmt.formatNumber(state.results.length)}`))
  }
  if (state.activeIndex >= 0) ui.rows.setAttribute('aria-activedescendant', `row-${visible[state.activeIndex]?.vehicle.vin ?? ''}`)
  else ui.rows.removeAttribute('aria-activedescendant')
}

function setActive(index) {
  const max = Math.min(state.results.length, state.shown) - 1
  state.activeIndex = Math.max(-1, Math.min(max, index))
  for (const row of ui.rows.children) {
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
      actions.append(el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openUrl(links.appHomeUrl(state.workspace.origin)) }, icon('external'), 'Open Inventory Flow'))
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
  const scope = scopeDefinitions().find((item) => item.id === state.scope)
  if (query) {
    ui.status.append(el('div', { class: 'status-icon' }, icon('search', { size: 18 })), el('h3', {}, 'No matches for ', el('q', { text: query })))
    ui.status.append(el('p', { text: `Nothing in ${scope?.label ?? 'this view'} matches${activeFilterCount(state.filters) ? ' with these filters' : ''}. Try the stock number, the last 8 of the VIN, or a make and model.` }))
    if (activeFilterCount(state.filters)) actions.append(el('button', { type: 'button', class: 'btn', onclick: () => { state.filters = { ...EMPTY_FILTERS }; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList() } }, 'Clear filters'))
    if (state.scope !== 'group') actions.append(el('button', { type: 'button', class: 'btn', onclick: () => setScope('group') }, 'Search all stores'))
    actions.append(el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.inventorySearchUrl(state.workspace.origin, query)) }, icon('external'), 'Search in the app'))
  } else {
    const filtered = activeFilterCount(state.filters) > 0
    ui.status.append(el('div', { class: 'status-icon' }, icon('car', { size: 18 })), el('h3', { text: filtered ? 'No vehicles match these filters' : state.scope === 'held' ? 'No current DealerMail holds' : 'No vehicles in this view' }))
    ui.status.append(el('p', { text: filtered ? `Nothing in ${scope?.label ?? 'this view'} fits ${describeFilters(state.filters)}. Loosen a filter or widen the scope.` : state.scope === 'held' ? 'No vehicle in the verified snapshot has a current hold. That is not an availability promise.' : 'The selected release has no public vehicles for this store.' }))
    if (filtered) actions.append(el('button', { type: 'button', class: 'btn', onclick: () => { state.filters = { ...EMPTY_FILTERS }; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList() } }, 'Clear filters'))
    if (state.scope !== 'group') actions.append(el('button', { type: 'button', class: 'btn', onclick: () => setScope('group') }, 'Show all stores'))
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
    el('span', { class: `dot ${state.error ? 'is-off' : problem ? 'is-stale' : ''}`.trim() }),
    `${fmt.formatReportDate(meta.reportDate)} release`,
    problem ? ` · ${meta.dealerMailFreshness !== 'current' ? 'DealerMail ' + meta.dealerMailFreshness : 'public ' + meta.publicFreshness}` : '',
    ` · ${state.loading ? 'refreshing…' : `checked ${fmt.formatRelative(state.fetchedAt)}`}${stale && !state.loading ? ' · stale' : ''}`,
  )
  ui.freshText.title = `Source completed ${fmt.formatDateTime(meta.completedAt)} · public ${meta.publicFreshness} · DealerMail ${meta.dealerMailFreshness}`
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
  if (field.kind === 'money') return field.from === 'sticker' ? fmt.formatStickerMoney(field.value, vehicle.documents.windowSticker) : fmt.formatMoney(field.value)
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
  const img = el('img', { class: 'hero-img', src: photos[state.photoIndex], alt: alt(state.photoIndex), decoding: 'async' })
  const count = el('span', { class: 'hero-count num', text: `${state.photoIndex + 1} / ${photos.length}` })
  const thumbs = photos.length > 1 ? el('div', { class: 'hero-thumbs', role: 'group', 'aria-label': 'Photos' }) : null
  const show = (index) => {
    state.photoIndex = (index + photos.length) % photos.length
    img.src = photos[state.photoIndex]
    img.alt = alt(state.photoIndex)
    count.textContent = `${state.photoIndex + 1} / ${photos.length}`
    if (thumbs) for (const thumb of thumbs.children) { const on = Number(thumb.dataset.index) === state.photoIndex; thumb.classList.toggle('is-on', on); thumb.setAttribute('aria-pressed', String(on)); if (on) thumb.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  if (thumbs) photos.slice(0, 16).forEach((src, index) => thumbs.append(el('button', { type: 'button', class: `hero-thumb ${index === state.photoIndex ? 'is-on' : ''}`.trim(), dataset: { index: String(index) }, 'aria-label': `Photo ${index + 1}`, 'aria-pressed': String(index === state.photoIndex), onclick: () => show(index) }, el('img', { src, alt: '', loading: 'lazy', decoding: 'async' }))))
  const frame = el('div', { class: 'hero-frame', tabindex: '0', 'aria-label': 'Vehicle photos, use the arrow keys', onkeydown: (event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); show(state.photoIndex - 1) } if (event.key === 'ArrowRight') { event.preventDefault(); show(state.photoIndex + 1) } } },
    img, logo, count,
    photos.length > 1 ? el('button', { type: 'button', class: 'hero-nav hero-prev', 'aria-label': 'Previous photo', onclick: () => show(state.photoIndex - 1) }, icon('chevron-left', { size: 18 })) : null,
    photos.length > 1 ? el('button', { type: 'button', class: 'hero-nav hero-next', 'aria-label': 'Next photo', onclick: () => show(state.photoIndex + 1) }, icon('chevron-right', { size: 18 })) : null,
  )
  return el('div', { class: 'hero' }, frame, thumbs)
}

function identity(vehicle) {
  const descriptor = fmt.joinFacts([vehicle.trim, vehicle.bodyStyle, vehicle.drivetrain, vehicle.engine, vehicle.exteriorColor])
  const priceMeta = []
  if (vehicle.msrp !== null) priceMeta.push(el('span', { text: `MSRP ${fmt.formatMoney(vehicle.msrp)}` }))
  if (vehicle.savings) priceMeta.push(el('b', { class: 'save', text: `${fmt.formatMoney(vehicle.savings)} under MSRP` }))
  if (vehicle.msrp === null) priceMeta.push(el('span', { text: 'MSRP not published' }))
  return el('div', { class: 'd-head' },
    el('div', { class: 'd-plate-row' },
      el('span', { class: 'd-plate' }, icon('tag'), vehicle.stockNumber),
      certifiedBadge(vehicle), holdPill(vehicle), movementPill(vehicle),
    ),
    el('h1', { class: 'd-name', text: vehicle.name }),
    descriptor ? el('p', { class: 'd-sub', text: descriptor }) : null,
    el('div', { class: 'price-row' },
      el('div', { class: 'price' }, el('strong', { class: 'num', text: fmt.formatMoney(vehicle.price) }), vehicle.price !== null ? copyButton(vehicle.price, 'listed price', { size: 14 }) : null),
      el('div', { class: 'price-meta' }, ...priceMeta),
    ),
    el('div', { class: 'd-facts' },
      fact('Mileage', vehicle.mileage !== null ? fmt.formatMileage(vehicle.mileage) : '—', vehicle.mileage === null),
      fact('Days listed', vehicle.daysListed !== null ? fmt.formatNumber(vehicle.daysListed) : '—', vehicle.daysListed === null),
      fact('Home store', vehicle.homeStore),
    ),
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
  const holdValue = hold.tone === 'held' ? (hold.position === 'backup' ? 'Backup hold' : hold.position === 'multiple' ? `${hold.backupCount + 1} holds` : 'On hold') : hold.tone === 'clear' ? 'No hold found' : 'Not verified'
  const holdSub = hold.tone === 'held'
    ? fmt.joinFacts([primary?.salesperson, primary?.expectedDate ? `exp. ${fmt.formatDate(primary.expectedDate)}` : null]) || (hold.canViewEvidence ? 'DealerMail hold' : 'Details restricted')
    : hold.tone === 'clear' ? 'Not an availability promise' : `DealerMail snapshot ${hold.dataState}`
  const flags = fmt.joinFacts([listing.dealerOn.inStock === true ? 'in stock' : listing.dealerOn.inStock === false ? 'not in stock' : null, listing.dealerOn.inTransit === true ? 'in transit' : null, listing.dealerOn.inProduction === true ? 'in production' : null])
  return el('div', { class: 'sig-grid' },
    signal({ tone: hold.tone === 'held' ? 'held' : hold.tone === 'clear' ? 'clear' : 'unverified', iconName: hold.tone === 'held' ? 'lock' : 'mail', label: 'DealerMail', value: holdValue, sub: holdSub, onClick: () => switchTab('hold'), title: hold.label }),
    signal({ tone: loc.conflict ? 'alert' : loc.provenance === 'app-confirmed' ? 'confirmed' : loc.provenance === 'source-reported' ? 'neutral' : 'unverified', iconName: 'pin', label: 'Location', value: loc.label, sub: loc.provenance === 'app-confirmed' ? `App-confirmed${loc.confirmedAt ? ` ${fmt.formatRelative(loc.confirmedAt)}` : ''}` : loc.provenance === 'source-reported' ? 'Source-reported' : 'No evidence', onClick: () => switchTab('hold'), title: locationTitle(vehicle) }),
    signal({ tone: move ? (move.overdue ? 'alert' : 'moving') : 'neutral', iconName: 'truck', label: 'Movement', value: move ? humanize(move.label ?? move.state) ?? 'Move in progress' : 'No move', sub: move ? fmt.joinFacts([move.nextAction, move.dueAt ? `${move.overdue ? 'overdue' : 'due'} ${fmt.formatRelative(move.dueAt)}` : null]) || humanize(move.requestStatus) : 'Nothing in Inventory Flow', onClick: () => switchTab('hold') }),
    signal({ tone: listing.isListed === true ? 'confirmed' : listing.isListed === false ? 'alert' : 'unverified', iconName: 'globe', label: 'Public listing', value: listing.isListed === true ? 'Listed' : listing.isListed === false ? 'Not listed' : 'Unknown', sub: flags || listing.websiteStatus || `Public snapshot ${listing.dataState}`, onClick: () => switchTab('records') }),
  )
}

function dock(vehicle) {
  const origin = state.workspace.origin
  const access = state.data?.access
  const allowed = canRequestVehicle(vehicle, access)
  const blocked = requestBlockedReason(vehicle, access)
  const primary = el('div', { class: 'dock-primary' },
    el('button', { type: 'button', class: 'btn btn-primary', disabled: !allowed, title: allowed ? 'Opens the request form in Inventory Flow' : blocked ?? '', onclick: () => openUrl(links.requestVehicleUrl(origin, vehicle.vin)) }, icon('truck'), 'Request vehicle'),
    el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.inventorySearchUrl(origin, vehicle.stockNumber)) }, icon('external'), 'Open in app'),
  )
  const inCompare = state.compare.includes(vehicle.vin)
  const utils = el('div', { class: 'dock-utils' },
    chip(inCompare ? 'Comparing' : 'Compare', 'columns', (button) => toggleCompare(vehicle, button), { title: inCompare ? 'Remove from the compare set' : 'Add to the compare set (C)', pressed: inCompare }),
    chip('Deal sheet', 'copy', (button) => copy(dealSheetText(vehicle, (field) => fieldText(field, vehicle)), 'Deal sheet', button), { title: 'Copy every identifying and pricing fact as text' }),
    chip('Take-home page', 'file-text', () => openTakeHome(vehicle), { title: 'One-page customer sheet to print or save as PDF' }),
    vehicle.hold.canManage ? chip('DealerMail', 'mail', async (button) => { await copy(vehicle.stockNumber, 'Stock number', button); openUrl(links.DEALERMAIL_INVENTORY_URL) }, { title: 'Copies the stock number, then opens DealerMail inventory' }) : null,
    vehicle.movement?.transferId ? chip('Track move', 'truck', () => openUrl(links.trackMovementUrl(origin, { transferId: vehicle.movement.transferId, vin: vehicle.vin }))) : null,
  )
  return el('div', { class: 'dock' }, primary, !allowed && blocked ? el('p', { class: 'dock-note', text: blocked }) : null, utils)
}

async function openTakeHome(vehicle) {
  // Only published facts leave the panel; the print page renders the model
  // it is handed and never re-fetches anything.
  await storage.setTakeHome(vehicle.vin, takeHomeModel(vehicle, photosFor(vehicle)))
  openExtensionPage(`print.html#${encodeURIComponent(vehicle.vin)}`)
}

function tabsBar(vehicle) {
  const bar = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Vehicle sections' }, el('span', { class: 'tabs-ind', 'aria-hidden': 'true' }))
  const counts = { equipment: vehicle.equipment.byCategory.reduce((sum, group) => sum + group.items.length, 0), hold: vehicle.hold.tone === 'held' ? hold_count(vehicle) : 0 }
  for (const [id, label] of TABS) {
    bar.append(el('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${id}`, dataset: { tab: id }, 'aria-selected': String(id === state.tab), 'aria-controls': 'tab-panel', tabindex: id === state.tab ? '0' : '-1',
      onclick: () => switchTab(id),
    }, label, counts[id] ? el('b', { text: fmt.formatNumber(counts[id]) }) : null))
  }
  bar.addEventListener('keydown', (event) => {
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
  if (panel) { const next = tabPanel(vehicle); panel.replaceWith(next); if (changed) next.classList.add('is-fresh') }
  if (bar && changed && ui.detail.scrollTop > bar.offsetTop) ui.detail.scrollTop = bar.offsetTop
}

function tabPanel(vehicle) {
  const builders = { overview: overviewTab, hold: holdTab, equipment: equipmentTab, records: recordsTab }
  return el('div', { class: 'tab-panel', id: 'tab-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` }, ...(builders[state.tab] ?? overviewTab)(vehicle))
}

/* Overview tab */
function docTile({ title, sub, iconName, url, onOpen, disabledText, score, brand }) {
  const available = Boolean(url) || Boolean(onOpen)
  return el('button', {
    type: 'button', class: `doc ${available ? '' : 'is-off'} ${brand ? `doc-${brand}` : ''}`.trim(), disabled: !available, title: available ? `Open ${title}` : disabledText ?? `${title} not published`,
    onclick: () => (onOpen ? onOpen() : openUrl(url)),
  },
    score !== null && score !== undefined ? el('span', { class: 'doc-score num', text: String(score) }) : el('span', { class: 'doc-icon' }, icon(iconName, { size: 16 })),
    el('span', { class: 'doc-body' }, el('strong', { text: title }), el('small', { text: available ? sub : disabledText ?? 'Not published' })),
    available ? icon('external', { size: 12, className: 'doc-ext' }) : null,
  )
}

function documentsGrid(vehicle) {
  const docs = vehicle.documents
  const ac = docs.autoCheck
  const fordFamily = Boolean(vehicle.links.oasis)
  const tiles = [
    docTile({ title: 'AutoCheck', sub: ac ? fmt.joinFacts([ac.score !== null ? `Score ${ac.score}` : null, ac.rangeLow !== null && ac.rangeHigh !== null ? `range ${ac.rangeLow}–${ac.rangeHigh}` : null, ac.ownerCount !== null ? `${ac.ownerCount} owner${ac.ownerCount === 1 ? '' : 's'}` : null]) || 'Vehicle history report' : '', iconName: 'shield', url: ac?.url, score: ac?.score ?? null, disabledText: ac ? 'Report link not published' : 'No report captured', brand: 'autocheck' }),
    docTile({ title: 'Window sticker', sub: docs.windowSticker ? fmt.joinFacts([docs.windowSticker.totalMsrp !== null ? fmt.formatStickerMoney(docs.windowSticker.totalMsrp, docs.windowSticker) : null, docs.windowSticker.originalMarket ? `${docs.windowSticker.originalMarket} market` : null]) || 'Original Monroney' : '', iconName: 'file-text', url: docs.windowSticker?.url, disabledText: docs.windowSticker ? 'Sticker link not published' : 'No sticker captured' }),
    fordFamily ? docTile({ title: 'OASIS', sub: 'Warranty start, recalls, service', iconName: 'wrench', url: vehicle.links.oasis, brand: 'ford' }) : null,
    fordFamily ? docTile({ title: 'Ford invoice', sub: 'DealerConnection invoice', iconName: 'receipt', url: vehicle.links.invoice, brand: 'ford' }) : null,
    docTile({ title: 'Listing', sub: vehicle.listing.isListed === true ? 'Dealer website page' : vehicle.listing.isListed === false ? 'Not publicly listed' : 'Dealer website', iconName: 'globe', url: vehicle.listing.url, disabledText: 'No listing link' }),
    docTile({ title: 'Equipment label', sub: docs.factoryEquipment ? fmt.joinFacts([docs.factoryEquipment.totalMsrp !== null ? `ref. ${fmt.formatMoney(docs.factoryEquipment.totalMsrp)}` : null, docs.factoryEquipment.packages.length ? `${docs.factoryEquipment.packages.length} package${docs.factoryEquipment.packages.length === 1 ? '' : 's'}` : null]) || 'vAuto informational label' : '', iconName: 'layers', url: docs.factoryEquipment?.url, disabledText: docs.factoryEquipment ? 'Label image not published' : 'No label captured' }),
  ].filter(Boolean)
  return el('div', { class: 'doc-grid' }, ...tiles)
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
    : parts.length ? `${parts.join(' / ')} left${item.expiresOn ? ` · ends ${fmt.formatDate(item.expiresOn)}` : ''}` : 'needs in-service date and miles'
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
    el('h3', { class: 'card-title' }, icon('shield', { size: 13 }), 'Factory warranty'),
    outlook.program ? el('small', { class: 'card-sub', text: outlook.program }) : el('small', { class: 'card-sub', text: `No terms on file for ${vehicle.make || 'this make'}` }),
  )
  const facts = el('div', { class: 'warr-facts' },
    el('div', { class: 'warr-fact' }, el('small', { text: 'Original in-service' }), el('strong', { text: outlook.inService.date ? fmt.formatDate(outlook.inService.date) : 'Not on the report' }), outlook.inService.date ? el('span', { text: 'AutoCheck estimate' }) : el('span', { text: 'Needed to date the coverage' })),
    el('div', { class: 'warr-fact' }, el('label', {}, el('small', { text: 'Odometer now' }), input), el('span', { text: 'Edit to recalculate' })),
  )
  const cert = vehicle.certifiedProgram ? certifiedTerms(vehicle.certifiedProgram.store) : null
  const card = el('section', { class: 'card warr' },
    head, facts,
    outlook.coverages.length ? el('div', { class: 'warr-rows' }, ...outlook.coverages.map(coverageRow)) : null,
    outlook.stickerWarranty.length ? el('div', { class: 'warr-sticker' }, el('b', { text: 'Printed on the original window sticker' }), el('ul', {}, ...outlook.stickerWarranty.map((text) => el('li', { text })))) : null,
    cert ? el('div', { class: 'warr-cert' },
      el('div', { class: 'warr-cert-head' }, certifiedBadge(vehicle, { size: 'md' })),
      el('ul', { class: 'warr-terms' }, ...cert.terms.map((term) => el('li', { text: term }))),
      el('p', { class: 'd-caption', text: cert.note }),
    ) : null,
    el('p', { class: 'd-caption' }, icon('calendar', { size: 12 }), ' Warranty runs from the first retail sale, not the model year. ', outlook.verify.source === 'oasis' ? 'OASIS shows the exact warranty start date for Ford and Lincoln VINs — use it over this estimate.' : 'The AutoCheck report shows the sale and registration dates and has its own remaining-warranty calculator at the bottom.'),
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
    el('div', { class: 'd-features' }, ...items.map((item) => el('span', { class: `d-feature ${item.standout ? 'is-standout' : ''}`.trim(), title: SOURCE_LABELS[item.source], text: item.label }))),
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

function overviewTab(vehicle) {
  return [documentsGrid(vehicle), dealSheet(vehicle), warrantyCard(vehicle), highlights(vehicle), specsCard(vehicle), readOnlyNote()]
}

function readOnlyNote() {
  return el('p', { class: 'd-freshness', text: 'Documents are reference sources, not availability signals. They do not confirm condition, a hold, custody, sale, delivery or price.' })
}

/* Hold & custody tab */
function holdTab(vehicle) {
  const hold = vehicle.hold
  const primary = hold.evidence.find((item) => item.position === 'primary')
  const headline = hold.tone === 'held'
    ? fmt.joinFacts([hold.position === 'backup' ? 'Backup hold' : hold.position === 'multiple' ? `${hold.backupCount + 1} holds` : 'Primary hold', primary?.salesperson])
    : hold.tone === 'clear' ? 'No current DealerMail hold found' : 'Hold status not verified'
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
      for (const item of items.slice(0, 6)) messages.push(el('div', { class: `d-evidence ${label === 'Alert' ? 'is-alert' : ''}`.trim() }, icon(iconName, { size: 12 }), el('b', { text: label }), item.author ? el('span', { text: ` · ${item.author}` }) : null, item.timestamp ? el('span', { text: ` · ${fmt.formatDateTime(item.timestamp)}` }) : null, el('div', {}, el('span', { text: item.text }))))
    }
  }
  const status = []
  if (hold.canViewEvidence && hold.tone === 'held') {
    if (state.detailStatus === 'loading' && !hold.detailLoaded) status.push(el('p', { class: 'd-caption d-caption-live', text: 'Loading the full DealerMail record…' }))
    if (state.detailStatus === 'failed' && !hold.detailLoaded) status.push(el('p', { class: 'd-caption' }, 'The full record could not be loaded. ', el('button', { type: 'button', class: 'd-inline', onclick: () => loadDetail(vehicle.vin, { retry: true }) }, 'Retry')))
    if (state.detailStatus === 'gone' && !hold.detailLoaded) status.push(el('p', { class: 'd-caption d-caption-warn', text: 'This vehicle is no longer in the current snapshot; the DealerMail record could not be loaded.' }))
  }
  if (hold.tone === 'held' && !hold.canViewEvidence) status.push(el('p', { class: 'd-caption', text: 'Hold details are restricted for your role.' }))
  const actions = el('div', { class: 'dock-utils' },
    vehicle.hold.canManage ? chip('Open in DealerMail', 'mail', async (button) => { await copy(vehicle.stockNumber, 'Stock number', button); openUrl(links.DEALERMAIL_INVENTORY_URL) }, { title: 'Copies the stock number, then opens DealerMail inventory' }) : null,
    chip('Stock', 'tag', (button) => copy(vehicle.stockNumber, 'Stock number', button), { title: 'Copy stock number' }),
    chip('Open in app', 'external', () => openUrl(links.inventorySearchUrl(state.workspace.origin, vehicle.stockNumber))),
  )
  const holdCard = el('section', { class: `card hold-card is-${hold.tone}` },
    el('div', { class: 'hold-head' }, el('span', { class: 'hold-icon' }, icon(hold.tone === 'held' ? 'lock' : hold.tone === 'clear' ? 'check' : 'help', { size: 16 })), el('div', {}, el('strong', { text: headline }), el('small', { text: hold.tone === 'held' ? hold.label : `DealerMail snapshot ${hold.dataState}` }))),
    facts, ...backups, ...status, ...messages,
    el('p', { class: 'd-caption', text: hold.tone === 'clear' ? 'A clean snapshot is not an availability promise. Confirm with the store before committing to a customer.' : hold.tone === 'held' ? 'A hold is a DealerMail signal — separate from the public listing and from where the vehicle physically is.' : 'The DealerMail snapshot is not current, so hold state cannot be verified from here.' }),
    actions,
  )

  const loc = vehicle.location
  const locSection = section('Location', [
    line('pin', loc.label, loc.provenance === 'app-confirmed' ? `app-confirmed${loc.confirmedAt ? ` ${fmt.formatDateTime(loc.confirmedAt)}` : ''}` : loc.provenance === 'source-reported' ? 'source-reported' : 'no evidence'),
    loc.custodian ? line('car', null, `With ${loc.custodian}`) : null,
    loc.conflict ? el('p', { class: 'd-caption d-caption-warn', text: 'Sources disagree about where this vehicle is. Treat the location as unconfirmed.' }) : null,
    loc.store && loc.store !== vehicle.homeStore ? el('p', { class: 'd-caption', text: `Away from its home store, ${vehicle.homeStore}.` }) : null,
  ], { iconName: 'pin' })

  const move = vehicle.movement
  const moveSection = section('Movement', move
    ? [
      line('truck', humanize(move.label ?? move.state) ?? 'Move in progress', humanize(move.requestStatus)),
      move.withheld ? el('p', { class: 'd-caption', text: 'Move details are limited to the stores involved; the location and status above are still the app\'s own record.' }) : null,
      kv([['Next', fmt.joinFacts([move.nextAction, move.nextActionOwner])], ['To', move.destination], [move.overdue ? 'Overdue' : 'Due', move.dueAt ? fmt.formatDateTime(move.dueAt) : null], ['Transport', move.transportAssignee], ['Requested by', move.requestingStore]]),
      move.transferId ? el('div', { class: 'dock-utils' }, chip('Track move', 'truck', () => openUrl(links.trackMovementUrl(state.workspace.origin, { transferId: move.transferId, vin: vehicle.vin })))) : null,
    ]
    : [el('p', { class: 'd-caption', text: 'No move request in Inventory Flow for this vehicle.' })], { iconName: 'truck', pill: move ? el('span', { class: `pill ${move.overdue ? 'pill-alert' : 'pill-moving'}`, text: move.overdue ? 'Overdue' : 'Active' }) : null })

  const managerSection = vehicle.managerLog ? section('Manager log', [
    line('file', vehicle.managerLog.soldLabel, vehicle.managerLog.deliveryLabel),
    vehicle.managerLog.deliveryDate ? line('check', null, `Delivered ${fmt.formatDate(vehicle.managerLog.deliveryDate)}`) : null,
    vehicle.managerLog.dataState !== 'current' ? el('p', { class: 'd-caption d-caption-warn', text: `The manager-log source is ${vehicle.managerLog.dataState}. Treat this as last known, not current.` }) : null,
    el('p', { class: 'd-caption', text: `Manager-supplied evidence from ${vehicle.managerLog.sourceStore}, shown separately from listing, hold and location.` }),
  ], { iconName: 'file', pill: vehicle.managerLog.dataState !== 'current' ? el('span', { class: 'pill pill-moving', text: 'Not current' }) : null }) : null

  return [holdCard, locSection, moveSection, managerSection, el('p', { class: 'd-freshness', text: 'Listing, hold, movement and location are separate facts; none implies another.' })]
}

/* Equipment tab */
function equipmentTab(vehicle) {
  const groups = vehicle.equipment.byCategory
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const docs = vehicle.documents
  const children = []
  const sourcesUsed = [...new Set(groups.flatMap((group) => group.items.map((item) => item.source)))]
  children.push(el('div', { class: 'card-head eq-head' },
    el('h3', { class: 'card-title' }, icon('list', { size: 13 }), `${fmt.formatNumber(total)} published item${total === 1 ? '' : 's'}`),
    total ? el('button', { type: 'button', class: 'btn btn-sm', onclick: (event) => copy(groups.map((group) => `${group.label}\n${group.items.map((item) => `• ${item.label}`).join('\n')}`).join('\n\n'), 'Equipment list', event.currentTarget) }, icon('copy', { size: 13 }), 'Copy list') : null,
  ))
  if (sourcesUsed.length) children.push(el('p', { class: 'd-caption eq-sources' }, ...sourcesUsed.map((source) => el('span', { class: `src-dot src-${source}`, title: SOURCE_LABELS[source] }, el('i'), SOURCE_LABELS[source]))))
  if (docs.factoryEquipment?.packages.length) {
    children.push(el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('layers', { size: 13 }), 'Packages on the equipment label'), docs.factoryEquipment.url ? el('button', { type: 'button', class: 'link-btn', onclick: () => openUrl(docs.factoryEquipment.url) }, 'Open label', icon('external', { size: 12 })) : null),
      ...docs.factoryEquipment.packages.map((pkg) => el('div', { class: 'pkg' },
        el('div', { class: 'pkg-head' }, el('b', { text: pkg.name }), pkg.code ? el('code', { text: pkg.code }) : null, pkg.price !== null ? el('span', { class: 'num', text: fmt.formatMoney(pkg.price) }) : null),
        pkg.features.length ? el('div', { class: 'd-features' }, ...pkg.features.map((feature) => el('span', { class: 'd-feature', text: feature }))) : null,
      )),
    ))
  }
  if (docs.windowSticker?.equipmentGroup) children.push(el('p', { class: 'd-caption' }, el('b', { text: 'Sticker equipment group: ' }), docs.windowSticker.equipmentGroup))
  groups.forEach((group, index) => {
    const details = el('details', { class: 'eq-group', open: index < 2 ? true : null },
      el('summary', {}, icon('chevron-right', { size: 14, className: 'eq-caret' }), el('span', { text: group.label }), el('b', { class: 'num', text: fmt.formatNumber(group.items.length) })),
      el('ul', { class: 'eq-list' }, ...group.items.map((item) => el('li', { class: `eq-item ${item.standout ? 'is-standout' : ''}`.trim(), title: SOURCE_LABELS[item.source] }, el('i', { class: `src-dot src-${item.source}` }), el('span', { text: item.label })))),
    )
    children.push(details)
  })
  if (!total) children.push(el('p', { class: 'd-caption', text: 'No equipment was published for this vehicle by the website, the equipment label or a captured sticker.' }))
  if (docs.factoryEquipment?.disclaimer) children.push(el('p', { class: 'd-freshness', text: docs.factoryEquipment.disclaimer }))
  else children.push(el('p', { class: 'd-freshness', text: 'The vAuto equipment label is informational, not the original window sticker. Confirm installed equipment on the vehicle.' }))
  return children
}

/* Records tab */
function recordsTab(vehicle) {
  const docs = vehicle.documents
  const ac = docs.autoCheck
  const children = []
  if (ac) {
    const facts = kv([
      ['Owners', ac.ownerCount !== null ? `${ac.ownerCount} reported` : null],
      ['Use', ac.usage],
      ['Last odometer', ac.lastReportedOdometer !== null ? fmt.joinFacts([fmt.formatMileage(ac.lastReportedOdometer), ac.lastReportedOdometerDate ? fmt.formatDate(ac.lastReportedOdometerDate) : null]) : null],
      ['In service (est.)', ac.inServiceDate ? fmt.formatDate(ac.inServiceDate) : null, ac.inServiceDate],
      ['Class', ac.vehicleClass], ['Assembly', ac.assemblyCountry], ['Report run', ac.reportRunAt ? fmt.formatDateTime(ac.reportRunAt) : null],
    ])
    children.push(el('section', { class: 'card rec rec-autocheck' },
      el('div', { class: 'card-head' },
        el('h3', { class: 'card-title' }, icon('shield', { size: 13 }), 'AutoCheck history'),
        el('span', { class: `pill ${ac.dataState === 'current' ? 'pill-ok' : 'pill-moving'}`, text: ac.dataState === 'current' ? 'Current' : humanize(ac.dataState) }),
      ),
      ac.score !== null || (ac.rangeLow !== null && ac.rangeHigh !== null) ? el('div', { class: 'score' },
        ac.score !== null ? el('div', { class: 'score-big' }, el('strong', { class: 'num', text: String(ac.score) }), el('small', { text: 'AutoCheck score' })) : null,
        ac.rangeLow !== null && ac.rangeHigh !== null ? el('div', { class: 'score-range' }, el('small', { text: 'Similar vehicles' }), el('b', { class: 'num', text: `${ac.rangeLow}–${ac.rangeHigh}` })) : null,
      ) : null,
      facts,
      ac.checks.length ? el('div', { class: 'checks' }, ...ac.checks.map((check) => el('div', { class: `check is-${check.tone}` }, icon(check.tone === 'clear' ? 'check' : check.tone === 'review' ? 'alert' : 'help', { size: 13 }), el('span', {}, el('b', { text: check.label }), el('small', { text: fmt.joinFacts([check.status, check.detail]) || 'No result published' }))))) : null,
      el('div', { class: 'dock-utils' }, ac.url ? chip('Open report', 'external', () => openUrl(ac.url)) : el('span', { class: 'pill', text: 'Report link not published' })),
    ))
  }
  const sticker = docs.windowSticker
  if (sticker) {
    children.push(el('section', { class: 'card rec' },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('file-text', { size: 13 }), 'Original window sticker'), el('span', { class: `pill ${sticker.dataState === 'current' ? 'pill-ok' : 'pill-moving'}`, text: sticker.dataState === 'current' ? 'Current' : humanize(sticker.dataState) })),
      sticker.vehicleDescription ? el('p', { class: 'd-caption', text: sticker.vehicleDescription }) : null,
      priceTable([['Base MSRP', sticker.basePrice], ['Options', sticker.totalOptions], ['Destination & delivery', sticker.destinationCharge], ['Total MSRP', sticker.totalMsrp]], (value) => fmt.formatStickerMoney(value, sticker)),
      sticker.originalMarket || sticker.pricingCurrency ? el('p', { class: 'd-caption', text: fmt.joinFacts([sticker.originalMarket ? `${sticker.originalMarket} market` : null, sticker.pricingCurrency ? `priced in ${sticker.pricingCurrency}` : null, sticker.currencyEvidence]) }) : null,
      el('div', { class: 'dock-utils' }, sticker.url ? chip('Open sticker', 'external', () => openUrl(sticker.url)) : el('span', { class: 'pill', text: 'Sticker link not published' })),
    ))
  }
  const label = docs.factoryEquipment
  if (label) {
    children.push(el('section', { class: 'card rec' },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('layers', { size: 13 }), 'vAuto equipment label'), el('span', { class: `pill ${label.dataState === 'current' ? 'pill-ok' : 'pill-moving'}`, text: label.dataState === 'current' ? 'Current' : humanize(label.dataState) })),
      priceTable([['Base MSRP', label.basePrice], ['Options', label.totalOptions], ['Destination & delivery', label.destinationCharge], ['Total MSRP (reference)', label.totalMsrp]], fmt.formatMoney),
      el('p', { class: 'd-caption', text: fmt.joinFacts([label.sourceLabel, label.capturedAt ? `captured ${fmt.formatDateTime(label.capturedAt)}` : null]) || 'Informational equipment label — not an original Monroney sticker.' }),
      el('div', { class: 'dock-utils' }, label.url ? chip('Open label', 'external', () => openUrl(label.url)) : el('span', { class: 'pill', text: 'Label image not published' })),
    ))
  }
  const scan = vehicle.publicScan
  const listing = vehicle.listing
  const flags = fmt.joinFacts([listing.dealerOn.inStock === true ? 'in stock' : listing.dealerOn.inStock === false ? 'not in stock' : null, listing.dealerOn.inTransit === true ? 'in transit' : null, listing.dealerOn.inProduction === true ? 'in production' : null])
  children.push(el('section', { class: 'card rec' },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('globe', { size: 13 }), 'Public listing'), listing.isListed === true ? el('span', { class: 'pill pill-blue', text: 'Public' }) : null),
    kv([
      ['Status', listing.isListed === true ? 'Listed publicly' : listing.isListed === false ? 'Not publicly listed' : 'Unknown'],
      ['Website', listing.websiteStatus], ['DealerOn', flags],
      ['First seen', scan?.firstSeen ? fmt.formatDate(scan.firstSeen) : null], ['Last seen', scan?.lastSeen ? fmt.formatDate(scan.lastSeen) : null],
      ['Sources', scan?.sourceCount !== null && scan?.sourceCount !== undefined ? String(scan.sourceCount) : null],
      ['Photos', vehicle.specs.photoCount !== null ? String(vehicle.specs.photoCount) : null],
    ]),
    el('p', { class: 'd-caption', text: listing.dataState === 'current' ? 'Website flags are source flags, not readiness, sale or delivery evidence.' : `The public snapshot is ${listing.dataState}.` }),
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
  if (!ac && !sticker && !label) children.push(el('p', { class: 'd-caption', text: 'No AutoCheck report, window sticker or equipment label was captured for this vehicle.' }))
  children.push(el('p', { class: 'd-freshness', text: `From the ${fmt.formatReportDate(state.data.meta.reportDate)} release · public ${state.data.meta.publicFreshness} · DealerMail ${state.data.meta.dealerMailFreshness}. Reference documents only: they do not confirm condition, availability, sale or delivery.` }))
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
  ui.detail.append(hero(vehicle), identity(vehicle), statusGrid(vehicle), dock(vehicle), tabsBar(vehicle), tabPanel(vehicle))
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
  try {
    detail = await fetchVehicle(state.workspace, state.settings, vin)
    state.detailStatus = null
  } catch (error) {
    if (error?.name === 'AbortError') { state.detailPending.delete(vin); return }
    state.detailStatus = error instanceof PanelApiError && error.kind === 'notfound' ? 'gone' : 'failed'
    state.detailFailed.set(vin, state.detailStatus)
  } finally {
    state.detailPending.delete(vin)
  }
  if (!state.bootstrap || !state.data) return
  if (detail) {
    state.details.set(vin, detail)
    const position = state.data.vehicles.findIndex((item) => item.vin === vin)
    const raw = state.bootstrap.vehicles.find((item) => item.vin === vin)
    if (position >= 0 && raw) {
      const merged = toPanelVehicle(mergeDetail(raw, detail), state.bootstrap)
      state.data.vehicles[position] = merged
      state.index[position] = buildEntry(merged)
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
  const head = el('div', { class: 'cmp-head', style: { '--cols': vehicles.length } }, el('span', { class: 'cmp-corner' }),
    ...vehicles.map((vehicle) => {
      const photos = photosFor(vehicle)
      return el('div', { class: 'cmp-col' },
        photos.length ? el('img', { class: 'cmp-photo', src: photos[0], alt: '', loading: 'lazy' }) : el('span', { class: 'cmp-photo is-empty' }, icon('image', { size: 14 })),
        el('button', { type: 'button', class: 'cmp-stock', title: 'Open this vehicle', onclick: () => { openDetail(vehicle) } }, el('b', { text: vehicle.stockNumber })),
        el('small', { text: vehicle.name, title: vehicle.name }),
        el('button', { type: 'button', class: 'cmp-remove', 'aria-label': `Remove ${vehicle.stockNumber} from compare`, onclick: () => { setCompare(state.compare.filter((vin) => vin !== vehicle.vin)); renderList(); renderCompare() } }, icon('x', { size: 12 })),
      )
    }))
  const rows = el('div', { class: 'cmp-rows', style: { '--cols': vehicles.length } })
  let diffs = 0
  for (const fact of result.facts) {
    if (fact.differs) diffs += 1
    rows.append(el('div', { class: `cmp-row ${fact.differs ? 'is-diff' : ''}`.trim() }, el('span', { class: 'cmp-label', text: fact.label }), ...fact.values.map((value) => el('span', { class: `cmp-val ${/^[\d$,.\s–-]+(?:\s?mi)?$/.test(value) ? 'num' : ''}`.trim(), text: value, title: value }))))
  }
  const onlyOn = result.onlyOn.filter((entry) => entry.items.length)
  ui.compare.append(
    head,
    el('p', { class: 'cmp-note', text: `${diffs} of ${result.facts.length} facts differ · ${fmt.formatNumber(result.shared)} equipment item${result.shared === 1 ? '' : 's'} in common` }),
    rows,
    onlyOn.length ? el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, icon('sparkles', { size: 13 }), 'Equipment differences')),
      ...onlyOn.map((entry) => el('div', { class: 'cmp-only' }, el('b', { text: `Only on ${entry.vehicle.stockNumber}` }), el('div', { class: 'd-features' }, ...entry.items.slice(0, 40).map((label) => el('span', { class: 'd-feature', text: label })), entry.items.length > 40 ? el('span', { class: 'd-feature', text: `+${entry.items.length - 40} more` }) : null)))) : null,
    el('p', { class: 'd-freshness', text: 'Hold, location and listing are the current snapshot for each vehicle; equipment comes from the website, the equipment label and any captured sticker.' }),
  )
  ui.compare.scrollTop = 0
}

/* Settings sheet -------------------------------------------------------- */
function segmented(options, value, onChange) {
  const seg = el('div', { class: 'seg', role: 'group' })
  for (const option of options) {
    seg.append(el('button', { type: 'button', 'aria-pressed': String(option.value === value), onclick: async () => { await onChange(option.value); for (const button of seg.children) button.setAttribute('aria-pressed', String(button.textContent === option.label)) } }, option.label))
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
  if (reload) { state.data = null; state.index = []; state.error = null; state.fetchedAt = null; await storage.clearCache(); renderWho(); renderScopes(); await load() }
}

function renderSheet() {
  clear(ui.sheetBody)
  const s = state.settings
  ui.sheetBody.append(
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Appearance' }), segmented([{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], s.theme, (theme) => updateSettings({ theme }))),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Density' }), segmented([{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], s.density, (density) => updateSettings({ density }))),
  )
  if (host === 'extension') {
    ui.sheetBody.append(el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Workspace' }),
      segmented(Object.values(WORKSPACES).map((item) => ({ value: item.id, label: item.label })), s.workspace, (workspace) => updateSettings({ workspace }, { reload: true }).then(renderSheet)),
      el('p', { class: 'field-help', text: s.workspace === 'demo' ? 'The local demo is synthetic training data from pnpm dev:demo — never live inventory.' : 'Production uses your Cloudflare Access sign-in for Inventory Flow.' })))
  }
  if (state.workspace.demo) {
    ui.sheetBody.append(
      el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'demo-role', text: 'Demo role' }), Object.assign(select(ROLES, s.demoRole, (demoRole) => updateSettings({ demoRole }, { reload: true }), roleLabel), { id: 'demo-role' })),
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
      const next = state.filters[key].filter((item) => item.toLowerCase() !== option.value.toLowerCase())
      if (!on) next.push(option.value)
      setFilters({ [key]: next })
      const nowOn = !on
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
  const vehicles = state.data?.vehicles ?? []
  const options = filterOptions(vehicles)
  const years = options.yearMin !== null && options.yearMax !== null ? Array.from({ length: options.yearMax - options.yearMin + 1 }, (_, index) => options.yearMax - index) : []
  ui.sheetBody.append(
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'sort-select', text: 'Sort' }), Object.assign(select(SORTS.map((item) => item.id), state.sort, (sort) => { state.sort = sort; storage.setFilters({ filters: state.filters, sort }).catch(() => {}); renderFilterState(); renderList() }, (id) => SORTS.find((item) => item.id === id)?.label ?? id), { id: 'sort-select' })),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Only show' }), el('div', { class: 'opt-row' },
      toggle('Certified', 'certified'), toggle('Listed publicly', 'listed'), toggle('No hold found', 'noHold', 'The current DealerMail snapshot found no hold — not an availability promise'), toggle('With photos', 'photos'))),
    optionChips('Make', 'makes', options.makes),
    optionChips('Model', 'models', options.models),
    optionChips('Body', 'bodies', options.bodies),
    optionChips('Drivetrain', 'drivetrains', options.drivetrains),
    optionChips('Fuel', 'fuels', options.fuels),
    optionChips('Home store', 'stores', options.stores),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Year' }), el('div', { class: 'range-row' }, rangeSelect('Year from', 'yearMin', [...years].reverse(), { placeholder: 'From' }), el('span', { class: 'range-sep', text: 'to' }), rangeSelect('Year to', 'yearMax', years, { placeholder: 'To' }))),
    el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Price and mileage' }), el('div', { class: 'range-row' },
      rangeSelect('Price up to', 'priceMax', steps(options.priceMax, 5000), { format: (value) => `Up to ${fmt.formatMoney(value)}`, placeholder: 'Any price' }),
      rangeSelect('Mileage up to', 'mileageMax', steps(options.mileageMax, 10000), { format: (value) => `Up to ${fmt.formatMileage(value)}`, placeholder: 'Any mileage' }))),
    el('div', { class: 'sheet-foot' },
      el('button', { type: 'button', class: 'btn', onclick: () => { state.filters = { ...EMPTY_FILTERS }; state.sort = 'relevance'; storage.setFilters({ filters: state.filters, sort: state.sort }).catch(() => {}); renderFilterState(); renderList(); renderFilterSheet() } }, 'Clear all'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: closeSheet }, `Show ${fmt.formatNumber(currentResults().length)} vehicle${currentResults().length === 1 ? '' : 's'}`),
    ),
  )
}

function openFilters() {
  state.sheetKind = 'filters'
  state.sheetReturnFocus = document.activeElement
  document.getElementById('sheet-title').textContent = 'Filters & sort'
  renderFilterSheet()
  ui.backdrop.hidden = false
  ui.sheet.hidden = false
  ui.filtersBtn.setAttribute('aria-expanded', 'true')
  requestAnimationFrame(() => { ui.backdrop.classList.add('is-in'); ui.sheet.classList.add('is-in'); ui.sheetClose.focus() })
}

function openSheet() {
  state.sheetKind = 'settings'
  state.sheetReturnFocus = document.activeElement
  document.getElementById('sheet-title').textContent = 'Settings'
  renderSheet()
  ui.backdrop.hidden = false
  ui.sheet.hidden = false
  ui.settingsBtn.setAttribute('aria-expanded', 'true')
  requestAnimationFrame(() => { ui.backdrop.classList.add('is-in'); ui.sheet.classList.add('is-in'); ui.sheetClose.focus() })
}

function closeSheet() {
  if (ui.sheet.hidden) return
  ui.backdrop.classList.remove('is-in')
  ui.sheet.classList.remove('is-in')
  ui.settingsBtn.setAttribute('aria-expanded', 'false')
  ui.filtersBtn.setAttribute('aria-expanded', 'false')
  setTimeout(() => { ui.backdrop.hidden = true; ui.sheet.hidden = true }, 280)
  state.sheetReturnFocus?.focus?.()
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
  if (!ui.sheet.hidden) { if (event.key === 'Escape') closeSheet(); return }
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
  const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const next = tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setScope(next.dataset.scope); next.focus()
  }
})

ui.back.addEventListener('click', closeDetail)
ui.compareBack.addEventListener('click', closeCompare)
ui.refresh.addEventListener('click', () => load())
ui.brand.addEventListener('click', () => openUrl(links.appHomeUrl(state.workspace.origin)))
ui.settingsBtn.addEventListener('click', openSheet)
ui.filtersBtn.addEventListener('click', openFilters)
ui.sheetClose.addEventListener('click', closeSheet)
ui.backdrop.addEventListener('click', closeSheet)

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.data && isStale() && !state.loading) load({ silent: true }) })
window.addEventListener('focus', () => { if (state.data && isStale() && !state.loading) load({ silent: true }) })
setInterval(() => { if (document.visibilityState === 'visible') { renderFreshness(); if (state.data && isStale() && !state.loading) load({ silent: true }) } }, 60_000)

/* Boot ------------------------------------------------------------------ */
async function boot() {
  ui.panel.classList.add('no-motion')
  state.settings = await storage.getSettings()
  state.workspace = workspaceFor(state.settings, host)
  applyTheme(); applyDensity()
  renderScopes()
  state.compare = await storage.getCompare()
  const saved = await storage.getFilters()
  state.filters = normalizeFilters(saved?.filters)
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
  requestAnimationFrame(() => { ui.panel.classList.remove('no-motion'); positionIndicator(ui.scope, ui.scopeInd, '.scope-tab') })
  if (!pending) ui.q.focus()
}

boot().catch((error) => { console.error(error); state.error = new PanelApiError('invalid'); hideSkeleton(); renderStatus() })
