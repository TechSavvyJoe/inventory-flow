import { ROLES, STALE_AFTER_MS, STORES, WORKSPACES, workspaceFor } from './lib/config.mjs'
import { PanelApiError, fetchBootstrap, fetchVehicle } from './lib/api.mjs'
import { buildPanelData, canRequestVehicle, mergeDetail, requestBlockedReason, roleLabel, toPanelVehicle } from './lib/model.mjs'
import { buildEntry, buildIndex, rank } from './lib/search.mjs'
import * as links from './lib/links.mjs'
import * as fmt from './lib/format.mjs'
import { clear, el, icon } from './lib/dom.mjs'
import { copyText, host, openUrl, storage } from './lib/host.mjs'

const $ = (id) => document.getElementById(id)
const ui = {
  panel: $('panel'), brand: $('brand'), who: $('who'), settingsBtn: $('settings-btn'),
  sticky: $('sticky'), search: $('search'), searchIcon: $('search-icon'), q: $('q'), clearBtn: $('clear'), kbd: $('search-kbd'),
  scope: $('scope'), scopeInd: $('scope-ind'), status: $('status'), rows: $('rows'), more: $('more'), skeleton: $('skeleton'),
  back: $('back'), detailTitle: $('detail-bar-title'), detailTools: $('detail-tools'), detail: $('detail'),
  freshText: $('fresh-text'), refresh: $('refresh'),
  backdrop: $('sheet-backdrop'), sheet: $('sheet'), sheetClose: $('sheet-close'), sheetBody: $('sheet-body'), toast: $('toast'),
}

const PAGE = 60
const state = {
  settings: null, workspace: null, data: null, bootstrap: null, index: [], results: [], shown: PAGE, details: new Map(), detailStatus: null,
  query: '', scope: 'home', activeIndex: -1, selectedVin: null, view: 'list',
  loading: false, error: null, fetchedAt: null, controller: null, toastTimer: null, sheetReturnFocus: null,
}

/* Icons that live in static markup */
ui.searchIcon.append(icon('search'))
ui.clearBtn.append(icon('x', { size: 14 }))
ui.settingsBtn.append(icon('sliders'))
ui.back.append(icon('chevron-left', { size: 18 }), 'Results')
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
  positionScopeIndicator()
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
  const ok = await copyText(value)
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

function hydrate(bootstrap, fetchedAt) {
  state.bootstrap = bootstrap
  state.data = buildPanelData(bootstrap)
  state.index = buildIndex(state.data.vehicles)
  state.details.clear()
  state.fetchedAt = fetchedAt
  state.error = null
  renderWho()
  renderScopes()
  renderList()
  renderFreshness()
  if (state.view === 'detail' && state.selectedVin) {
    const vehicle = state.data.vehicles.find((item) => item.vin === state.selectedVin)
    if (vehicle) renderDetail(vehicle)
  }
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
  ui.scope.hidden = !state.data
  const scopes = scopeDefinitions()
  for (const node of [...ui.scope.querySelectorAll('.scope-tab')]) node.remove()
  for (const scope of scopes) {
    ui.scope.append(el('button', {
      type: 'button', class: 'scope-tab', role: 'tab', id: `scope-${scope.id}`, dataset: { scope: scope.id },
      'aria-selected': String(scope.id === state.scope), tabindex: scope.id === state.scope ? '0' : '-1',
      onclick: () => setScope(scope.id),
    }, scope.label, el('b', { text: fmt.formatNumber(scope.count) })))
  }
  positionScopeIndicator()
}

function positionScopeIndicator() {
  const active = ui.scope.querySelector('.scope-tab[aria-selected="true"]')
  if (!active) return
  ui.scopeInd.style.width = `${active.offsetWidth}px`
  ui.scopeInd.style.transform = `translateX(${active.offsetLeft}px)`
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
  positionScopeIndicator()
  renderList()
}

/* Rendering: list ------------------------------------------------------ */
function currentResults() {
  const scope = scopeDefinitions().find((item) => item.id === state.scope) ?? scopeDefinitions()[0]
  const ranked = rank(state.index, state.query).filter((match) => scope.filter(match.vehicle))
  if (!state.query.trim()) ranked.sort((left, right) => left.vehicle.name.localeCompare(right.vehicle.name) || left.vehicle.stockNumber.localeCompare(right.vehicle.stockNumber, undefined, { numeric: true }))
  return ranked
}

function locationNode(vehicle) {
  const loc = vehicle.location
  const away = loc.store && loc.store !== vehicle.homeStore
  const node = el('span', { class: `loc ${loc.provenance === 'app-confirmed' ? 'is-confirmed' : ''} ${away ? 'is-away' : ''}`.trim(), title: locationTitle(vehicle) }, icon('pin'), el('span', { text: loc.label }))
  return node
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

function renderRow(match, position) {
  const vehicle = match.vehicle
  const metaParts = [fmt.formatMoney(vehicle.price), vehicle.mileage !== null ? fmt.formatMileage(vehicle.mileage) : null, fmt.formatDays(vehicle.daysListed)]
  const via = state.query && match.matchedLabels.find((label) => !['Stock', 'VIN', 'Vehicle', 'Make', 'Model', 'Year', 'Trim'].includes(label))
  const row = el('li', {
    class: `row ${position === state.activeIndex ? 'is-active' : ''}`.trim(), role: 'option', id: `row-${vehicle.vin}`,
    'aria-selected': String(position === state.activeIndex), dataset: { vin: vehicle.vin, index: String(position) },
    onclick: () => openDetail(vehicle),
  },
    el('span', { class: 'plate' }, el('b', { text: vehicle.stockNumber, title: `Stock ${vehicle.stockNumber}` }), el('small', { text: vehicle.homeStore })),
    el('span', { class: 'row-main' },
      el('span', { class: 'row-title', text: vehicle.name, title: vehicle.name }),
      el('span', { class: 'row-meta' }, fmt.joinFacts(metaParts), via ? el('em', { text: ` · via ${via.toLowerCase()}` }) : null),
      el('span', { class: 'row-status' }, holdPill(vehicle), movementPill(vehicle), locationNode(vehicle)),
    ),
    icon('chevron-right', { size: 14 }),
  )
  return row
}

function renderList() {
  if (!state.data) return
  hideSkeleton()
  state.results = currentResults()
  clear(ui.rows)
  clear(ui.more)
  ui.more.hidden = true
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
    ui.status.append(el('p', { text: `Nothing in ${scope?.label ?? 'this view'} matches. Try the stock number, the last 8 of the VIN, or a make and model.` }))
    if (state.scope !== 'group') actions.append(el('button', { type: 'button', class: 'btn', onclick: () => setScope('group') }, 'Search all stores'))
    actions.append(el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.inventorySearchUrl(state.workspace.origin, query)) }, icon('external'), 'Search in the app'))
  } else {
    ui.status.append(el('div', { class: 'status-icon' }, icon('car', { size: 18 })), el('h3', { text: state.scope === 'held' ? 'No current DealerMail holds' : 'No vehicles in this view' }))
    ui.status.append(el('p', { text: state.scope === 'held' ? 'No vehicle in the verified snapshot has a current hold. That is not an availability promise.' : 'The selected release has no public vehicles for this store.' }))
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

/* Rendering: detail ----------------------------------------------------- */
function chip(label, iconName, onClick, { title } = {}) {
  return el('button', { type: 'button', class: 'chip', title: title ?? label, onclick: (event) => onClick(event.currentTarget) }, icon(iconName), label)
}

function section(label, children, { pill } = {}) {
  return el('section', { class: 'd-section' }, el('h3', { class: 'd-label' }, label, pill ?? null), ...children)
}

function line(iconName, strong, rest) {
  return el('div', { class: 'd-line' }, icon(iconName), el('span', {}, strong ? el('b', { text: strong }) : null, strong && rest ? ' · ' : '', rest ?? ''))
}

function renderDetail(vehicle) {
  const origin = state.workspace.origin
  const access = state.data?.access
  ui.detailTitle.textContent = vehicle.stockNumber
  clear(ui.detailTools)
  ui.detailTools.append(
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy stock number', title: 'Copy stock number (S)', onclick: (event) => copy(vehicle.stockNumber, 'Stock number', event.currentTarget) }, icon('tag', { size: 15 })),
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy VIN', title: 'Copy VIN (V)', onclick: (event) => copy(vehicle.vin, 'VIN', event.currentTarget) }, icon('copy', { size: 15 })),
  )
  clear(ui.detail)

  const descriptor = fmt.joinFacts([vehicle.bodyStyle, vehicle.drivetrain, vehicle.engine, vehicle.exteriorColor ? `${vehicle.exteriorColor} exterior` : null, vehicle.certified ? 'Certified' : null])
  const head = el('div', { class: 'd-head' },
    el('div', { class: 'd-plate-row' },
      el('span', { class: 'd-plate' }, icon('tag'), vehicle.stockNumber),
      holdPill(vehicle), movementPill(vehicle),
    ),
    el('h1', { class: 'd-name', text: vehicle.name }),
    descriptor ? el('p', { class: 'd-sub', text: descriptor }) : null,
    el('div', { class: 'd-facts' },
      fact('Price', fmt.formatMoney(vehicle.price)),
      fact('MSRP', fmt.formatMoney(vehicle.msrp), vehicle.msrp === null),
      fact('Mileage', vehicle.mileage !== null ? fmt.formatMileage(vehicle.mileage) : '—', vehicle.mileage === null),
      fact('Days listed', vehicle.daysListed !== null ? fmt.formatNumber(vehicle.daysListed) : '—', vehicle.daysListed === null),
      fact('VIN', vehicle.vin.slice(-8), false, `VIN ${vehicle.vin}`),
      fact('Home store', vehicle.homeStore),
    ),
  )

  const allowed = canRequestVehicle(vehicle, access)
  const blocked = requestBlockedReason(vehicle, access)
  const primary = el('div', { class: 'dock-primary' },
    el('button', { type: 'button', class: 'btn btn-primary', disabled: !allowed, title: allowed ? 'Opens the request form in Inventory Flow' : blocked ?? '', onclick: () => openUrl(links.requestVehicleUrl(origin, vehicle.vin)) }, icon('truck'), 'Request vehicle'),
    el('button', { type: 'button', class: 'btn', onclick: () => openUrl(links.inventorySearchUrl(origin, vehicle.stockNumber)) }, icon('external'), 'Open in app'),
  )
  const utils = el('div', { class: 'dock-utils' },
    chip('Stock', 'tag', (button) => copy(vehicle.stockNumber, 'Stock number', button), { title: 'Copy stock number' }),
    chip('VIN', 'copy', (button) => copy(vehicle.vin, 'VIN', button), { title: 'Copy VIN' }),
    vehicle.listing.url ? chip('Listing', 'external', () => openUrl(vehicle.listing.url), { title: 'Open the dealer website listing' }) : null,
    vehicle.hold.canManage ? chip('DealerMail', 'mail', async (button) => { await copy(vehicle.stockNumber, 'Stock number', button); openUrl(links.DEALERMAIL_INVENTORY_URL) }, { title: 'Copies the stock number, then opens DealerMail inventory' }) : null,
    vehicle.movement?.transferId ? chip('Track move', 'truck', () => openUrl(links.trackMovementUrl(origin, { transferId: vehicle.movement.transferId, vin: vehicle.vin }))) : null,
    vehicle.documents.autoCheck?.url ? chip('AutoCheck', 'shield', () => openUrl(vehicle.documents.autoCheck.url)) : null,
    vehicle.documents.windowSticker?.url ? chip('Sticker', 'file', () => openUrl(vehicle.documents.windowSticker.url)) : null,
    vehicle.documents.factoryEquipment?.url ? chip('Equipment label', 'file', () => openUrl(vehicle.documents.factoryEquipment.url), { title: 'vAuto informational equipment label — not an original window sticker' }) : null,
  )
  const dock = el('div', { class: 'dock' }, primary, !allowed && blocked ? el('p', { class: 'dock-note', text: blocked }) : null, utils)

  // Hold — DealerMail evidence, role-redacted by the server.
  const hold = vehicle.hold
  const holdChildren = [line('lock', hold.label, null)]
  for (const evidence of hold.evidence) {
    holdChildren.push(el('div', { class: 'd-evidence' },
      el('b', { text: evidence.position === 'backup' ? 'Backup' : 'Primary' }),
      evidence.salesperson ? el('span', { text: ` · ${evidence.salesperson}` }) : null,
      evidence.expectedDate ? el('span', { text: ` · expected ${fmt.formatDate(evidence.expectedDate)}` }) : null,
      evidence.customerOrReason ? el('div', {}, el('span', { text: evidence.customerOrReason })) : null,
    ))
  }
  if (hold.canViewEvidence && hold.tone === 'held') {
    if (state.detailStatus === 'loading' && !hold.detailLoaded) holdChildren.push(el('p', { class: 'd-caption d-caption-live', text: 'Loading the full DealerMail record…' }))
    if (state.detailStatus === 'failed' && !hold.detailLoaded) holdChildren.push(el('p', { class: 'd-caption' }, 'The full record could not be loaded. ', el('button', { type: 'button', class: 'd-inline', onclick: () => { state.details.delete(vehicle.vin); loadDetail(vehicle.vin) } }, 'Retry')))
    if (hold.cdkStatus) holdChildren.push(line('file', 'CDK', hold.cdkStatus))
    for (const [label, items] of [['Comment', hold.comments], ['Alert', hold.alerts]]) {
      for (const item of items.slice(0, 4)) {
        holdChildren.push(el('div', { class: 'd-evidence' }, el('b', { text: label }), item.author ? el('span', { text: ` · ${item.author}` }) : null, item.timestamp ? el('span', { text: ` · ${fmt.formatDateTime(item.timestamp)}` }) : null, el('div', {}, el('span', { text: item.text }))))
      }
    }
  }
  if (hold.tone === 'held' && !hold.canViewEvidence) holdChildren.push(el('p', { class: 'd-caption', text: 'Hold details are restricted for your role.' }))
  if (hold.commentsCount || hold.alertsCount) holdChildren.push(el('p', { class: 'd-caption', text: fmt.joinFacts([hold.commentsCount ? `${hold.commentsCount} comment${hold.commentsCount === 1 ? '' : 's'}` : null, hold.alertsCount ? `${hold.alertsCount} alert${hold.alertsCount === 1 ? '' : 's'}` : null]) + ' in DealerMail' }))
  holdChildren.push(el('p', { class: 'd-caption', text: hold.tone === 'clear' ? 'A clean snapshot is not an availability promise. Confirm with the store before committing to a customer.' : hold.tone === 'held' ? 'A hold is a DealerMail signal, separate from the public listing and from where the vehicle physically is.' : 'The DealerMail snapshot is not current, so hold state cannot be verified from here.' }))
  const holdSection = section('DealerMail hold', holdChildren)

  // Location — app custody outranks source reports, and neither implies availability.
  const loc = vehicle.location
  const locChildren = [line('pin', loc.label, loc.provenance === 'app-confirmed' ? `app-confirmed${loc.confirmedAt ? ` ${fmt.formatDateTime(loc.confirmedAt)}` : ''}` : loc.provenance === 'source-reported' ? 'source-reported' : 'no evidence')]
  if (loc.custodian) locChildren.push(line('car', null, `With ${loc.custodian}`))
  if (loc.conflict) locChildren.push(el('p', { class: 'd-caption', text: 'Sources disagree about where this vehicle is. Treat the location as unconfirmed.' }))
  if (loc.store && loc.store !== vehicle.homeStore) locChildren.push(el('p', { class: 'd-caption', text: `Away from its home store, ${vehicle.homeStore}.` }))
  const locSection = section('Location', locChildren)

  // Movement — the app's own ledger only.
  const move = vehicle.movement
  const moveChildren = move
    ? [
      line('truck', humanize(move.label ?? move.state) ?? 'Move in progress', humanize(move.requestStatus)),
      move.withheld ? el('p', { class: 'd-caption', text: 'Move details are limited to the stores involved; the location and status above are still the app\'s own record.' }) : null,
      move.nextAction ? el('dl', { class: 'd-kv' }, el('dt', { text: 'Next' }), el('dd', { text: fmt.joinFacts([move.nextAction, move.nextActionOwner]) }), move.destination ? el('dt', { text: 'To' }) : null, move.destination ? el('dd', { text: move.destination }) : null, move.dueAt ? el('dt', { text: move.overdue ? 'Overdue' : 'Due' }) : null, move.dueAt ? el('dd', { text: fmt.formatDateTime(move.dueAt) }) : null, move.transportAssignee ? el('dt', { text: 'Transport' }) : null, move.transportAssignee ? el('dd', { text: move.transportAssignee }) : null) : null,
    ]
    : [el('p', { class: 'd-caption', text: 'No move request in Inventory Flow for this vehicle.' })]
  const moveSection = section('Movement', moveChildren, { pill: move ? el('span', { class: `pill ${move.overdue ? 'pill-alert' : 'pill-moving'}`, text: move.overdue ? 'Overdue' : 'Active' }) : null })

  // Listing — public website status and DealerOn flags, separate from custody.
  const listing = vehicle.listing
  const dealerOn = listing.dealerOn
  const flags = fmt.joinFacts([dealerOn.inStock === true ? 'in stock' : dealerOn.inStock === false ? 'not in stock' : null, dealerOn.inTransit === true ? 'in transit' : null, dealerOn.inProduction === true ? 'in production' : null])
  const listingSection = section('Public listing', [
    line('external', listing.isListed === true ? 'Listed publicly' : listing.isListed === false ? 'Not publicly listed' : 'Public listing unknown', listing.websiteStatus),
    flags ? line('car', null, `DealerOn flags: ${flags}`) : null,
    el('p', { class: 'd-caption', text: listing.dataState === 'current' ? 'Website flags are source flags, not readiness, sale or delivery evidence.' : 'The public snapshot is not current.' }),
  ], { pill: listing.isListed === true ? el('span', { class: 'pill pill-blue', text: 'Public' }) : null })

  const managerSection = vehicle.managerLog ? section('Manager log', [
    line('file', vehicle.managerLog.soldLabel, vehicle.managerLog.deliveryLabel),
    vehicle.managerLog.deliveryDate ? line('check', null, `Delivered ${fmt.formatDate(vehicle.managerLog.deliveryDate)}`) : null,
    vehicle.managerLog.dataState !== 'current' ? el('p', { class: 'd-caption d-caption-warn', text: `The manager-log source is ${vehicle.managerLog.dataState}. Treat this as last known, not current.` }) : null,
    el('p', { class: 'd-caption', text: `Manager-supplied evidence from ${vehicle.managerLog.sourceStore}, shown separately from listing, hold and location.` }),
  ], { pill: vehicle.managerLog.dataState !== 'current' ? el('span', { class: 'pill pill-moving', text: 'Not current' }) : null }) : null

  const featureSection = vehicle.features.length ? section(`Equipment · ${vehicle.features.length}`, [featureChips(vehicle.features)]) : null
  const docs = vehicle.documents
  const docLines = [
    docs.autoCheck ? line('shield', docs.autoCheck.score !== null ? `AutoCheck ${docs.autoCheck.score}` : 'AutoCheck report', fmt.joinFacts([docs.autoCheck.rangeLow !== null && docs.autoCheck.rangeHigh !== null ? `range ${docs.autoCheck.rangeLow}–${docs.autoCheck.rangeHigh}` : null, docs.autoCheck.ownerCount !== null ? `${docs.autoCheck.ownerCount} owner${docs.autoCheck.ownerCount === 1 ? '' : 's'}` : null])) : null,
    docs.windowSticker ? line('file', 'Window sticker', fmt.joinFacts([docs.windowSticker.totalMsrp !== null ? `total ${fmt.formatStickerMoney(docs.windowSticker.totalMsrp, docs.windowSticker)}` : null, docs.windowSticker.originalMarket ? `${docs.windowSticker.originalMarket} market` : null])) : null,
    docs.factoryEquipment ? line('file', 'Equipment label', fmt.joinFacts([docs.factoryEquipment.totalMsrp !== null ? `reference ${fmt.formatMoney(docs.factoryEquipment.totalMsrp)}` : null, docs.factoryEquipment.packages.length ? `${docs.factoryEquipment.packages.length} package${docs.factoryEquipment.packages.length === 1 ? '' : 's'}` : null])) : null,
  ].filter(Boolean)
  const docSection = docLines.length ? section('Documents', [...docLines, el('p', { class: 'd-caption', text: 'Reference documents only. They do not confirm condition, availability, sale or delivery.' })]) : null

  const photoSection = vehicle.photos.length ? section(`Photos · ${vehicle.photos.length}`, [el('div', { class: 'd-photos' }, ...vehicle.photos.slice(0, 8).map((src, index) => el('img', { src, alt: index === 0 ? `${vehicle.name} photo` : '', loading: 'lazy', decoding: 'async' })))]) : null

  const freshness = el('p', { class: 'd-freshness', text: `From the ${fmt.formatReportDate(state.data.meta.reportDate)} release · public ${state.data.meta.publicFreshness} · DealerMail ${state.data.meta.dealerMailFreshness}. Listing, hold, movement and location are separate facts; none implies another.` })

  ui.detail.append(...[head, dock, holdSection, locSection, moveSection, listingSection, managerSection, featureSection, docSection, photoSection, freshness].filter(Boolean))
  ui.detail.scrollTop = 0
}

/** "at_home" / "approved" -> "At home" / "Approved" for server state tokens. */
function humanize(value) {
  if (!value) return null
  const spaced = String(value).replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function fact(label, value, muted = false, title) {
  return el('div', { class: 'd-fact' }, el('small', { text: label }), el('strong', { class: muted ? 'is-muted' : '', text: value, title: title ?? null }))
}

function featureChips(features) {
  const wrap = el('div', { class: 'd-features' })
  const limit = 12
  const render = (all) => {
    clear(wrap)
    for (const feature of features.slice(0, all ? features.length : limit)) wrap.append(el('span', { class: 'd-feature', text: feature }))
    if (!all && features.length > limit) wrap.append(el('button', { type: 'button', class: 'd-more', onclick: () => render(true) }, `Show all ${features.length}`))
  }
  render(false)
  return wrap
}

async function loadDetail(vin) {
  if (state.details.has(vin)) return
  state.detailStatus = 'loading'
  let detail = null
  try {
    detail = await fetchVehicle(state.workspace, state.settings, vin)
    state.detailStatus = null
  } catch (error) {
    if (error?.name === 'AbortError') return
    state.detailStatus = error instanceof PanelApiError && error.kind === 'notfound' ? 'gone' : 'failed'
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
    const vehicle = state.data.vehicles.find((item) => item.vin === vin)
    if (vehicle) { const top = ui.detail.scrollTop; renderDetail(vehicle); ui.detail.scrollTop = top }
  }
}

function openDetail(vehicle) {
  state.selectedVin = vehicle.vin
  state.view = 'detail'
  state.detailStatus = state.details.has(vehicle.vin) ? null : 'loading'
  renderDetail(vehicle)
  loadDetail(vehicle.vin)
  ui.panel.dataset.view = 'detail'
  ui.viewList?.setAttribute?.('aria-hidden', 'true')
  $('view-detail').setAttribute('aria-hidden', 'false')
  $('view-list').setAttribute('aria-hidden', 'true')
  setTimeout(() => ui.detail.focus({ preventScroll: true }), 40)
}

function closeDetail() {
  if (state.view !== 'detail') return
  state.view = 'list'
  ui.panel.dataset.view = 'list'
  $('view-detail').setAttribute('aria-hidden', 'true')
  $('view-list').setAttribute('aria-hidden', 'false')
  const row = state.selectedVin ? ui.rows.querySelector(`#row-${CSS.escape(state.selectedVin)}`) : null
  if (row) { setActive(Number(row.dataset.index)); ui.rows.focus({ preventScroll: true }) } else ui.q.focus()
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
    el('dt', {}, el('kbd', { text: 'Alt' }), el('kbd', { text: 'Shift' }), el('kbd', { text: 'V' })), el('dd', { text: 'Open this panel from any page' }),
  )))
  ui.sheetBody.append(el('p', { class: 'field-help', text: `Read-only. Requests and moves open in Inventory Flow, where your role and store are enforced. ${host === 'preview' ? 'Preview mode: served locally against the demo API.' : ''}`.trim() }))
}

function openSheet() {
  state.sheetReturnFocus = document.activeElement
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
  if (state.view === 'detail') {
    if (event.key === 'Escape' || (event.key === 'Backspace' && !typing)) { event.preventDefault(); closeDetail(); return }
    const vehicle = state.data?.vehicles.find((item) => item.vin === state.selectedVin)
    if (!vehicle || typing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 's' || event.key === 'S') copy(vehicle.stockNumber, 'Stock number', ui.detailTools.children[0])
    if (event.key === 'v' || event.key === 'V') copy(vehicle.vin, 'VIN', ui.detailTools.children[1])
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
ui.refresh.addEventListener('click', () => load())
ui.brand.addEventListener('click', () => openUrl(links.appHomeUrl(state.workspace.origin)))
ui.settingsBtn.addEventListener('click', openSheet)
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
  const pending = await storage.takePendingQuery()
  if (pending) setQuery(pending)
  storage.onPendingQuery((text) => { closeSheet(); closeDetail(); setQuery(text, { focus: true }) })
  // The session cache is only ever shown for the synthetic demo. In production
  // the panel always revalidates first: a shared Chrome profile can change
  // Access users, and a cached document is one user's role-and-store
  // projection that the next user may not be entitled to see.
  const cache = await storage.getCache()
  if (state.workspace.demo && cache?.bootstrap && cache.key === cacheKey()) hydrate(cache.bootstrap, cache.fetchedAt)
  await load({ silent: Boolean(state.data) })
  requestAnimationFrame(() => { ui.panel.classList.remove('no-motion'); positionScopeIndicator() })
  if (!pending) ui.q.focus()
}

boot().catch((error) => { console.error(error); state.error = new PanelApiError('invalid'); hideSkeleton(); renderStatus() })
