// @vitest-environment jsdom
// @ts-nocheck -- Synthetic tests for the unbundled extension's modal workflow.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import markup from '../../extension/sidepanel/index.html?raw'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../extension/sidepanel/lib/config.mjs'

const mock = vi.hoisted(() => ({ bootstrap: vi.fn(), vehicle: vi.fn(), saveSettings: vi.fn(), saveFilters: vi.fn(), settings: {} }))
vi.mock('../../extension/sidepanel/lib/api.mjs', async (importOriginal) => ({ ...(await importOriginal()), fetchBootstrap: mock.bootstrap, fetchVehicle: mock.vehicle }))
vi.mock('../../extension/sidepanel/lib/host.mjs', () => ({
  host: 'extension', previewFlags: { photos: false }, placeholderPhotos: () => [], copyText: vi.fn(), openUrl: vi.fn(), openExtensionPage: vi.fn(),
  storage: {
    getSettings: async () => mock.settings, setSettings: mock.saveSettings,
    getCompare: async () => [], getFilters: async () => null, takePendingQuery: async () => null, onPendingQuery: () => {},
    getCache: async () => null, setCache: async () => {}, clearCache: async () => {}, setCompare: async () => {}, setFilters: mock.saveFilters,
  },
}))

const record = (vin, make, model, serviceStatus = 'serviced') => ({
  vin, stockNumber: `DEMO-${model}`, year: 2024, vehicleName: `2024 ${make} ${model}`, make, model,
  homeStore: 'Howell', listedPrice: 32000, mileage: 14000, bodyStyle: 'SUV', drivetrain: 'AWD', fuelType: 'Gasoline',
  hold: { state: 'none', canViewEvidence: false }, serviceReadiness: { status: serviceStatus },
})
const vehicles = [record('TESTDATAHWELL0001', 'Ford', 'Alpha'), record('TESTDATAHWELL0002', 'Chevrolet', 'Beta', 'needs_service')]
const bootstrap = () => ({ access: { user: 'Synthetic manager', role: 'manager', store: 'Howell' }, meta: { publicFreshness: 'current', dealerMailFreshness: 'current', reportDate: '2026-09-15' }, stores: [], transfers: [], vehicles })
const key = (value, shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))
const open = (id) => { const button = document.getElementById(id); button.focus(); button.click(); return button }
const buttonIn = (selector, startsWith) => [...document.querySelectorAll(`${selector} button`)].find((button) => button.textContent.startsWith(startsWith))
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
// Only the dev-only build (pnpm extension:dev) grants the loopback demo origin.
const DEV_BUILD_HOSTS = ['https://inventory-ops.joegallant.me/*', 'http://127.0.0.1:4173/*', 'http://localhost:4173/*']
const SHIPPED_HOSTS = ['https://inventory-ops.joegallant.me/*']
const grantHosts = (hostPermissions) => vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ host_permissions: hostPermissions }) } })

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/g, '')
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 0 })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
  grantHosts(DEV_BUILD_HOSTS)
  mock.settings = { ...DEFAULT_SETTINGS, workspace: 'demo' }
  mock.saveSettings.mockImplementation(async (patch) => { mock.settings = normalizeSettings({ ...mock.settings, ...patch }); return mock.settings })
  mock.saveFilters.mockResolvedValue(undefined)
  mock.bootstrap.mockResolvedValue(bootstrap())
  mock.vehicle.mockResolvedValue(vehicles[0])
})

afterEach(() => {
  document.getElementById('sheet-close')?.click()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else delete HTMLElement.prototype.scrollIntoView
})

async function boot() {
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelectorAll('#rows .row')).toHaveLength(2))
}

describe('extension settings compatibility', () => {
  it('uses app-matching light for new settings without changing the production workspace', () => {
    expect(normalizeSettings(null)).toMatchObject({ theme: 'light', workspace: 'production', density: 'comfortable' })
    expect(normalizeSettings({ theme: 'obsolete', density: 'tiny' })).toMatchObject({ theme: 'light', density: 'comfortable' })
  })

  it.each(['system', 'light', 'dark'])('preserves saved %s appearance and both supported densities', (theme) => {
    for (const density of ['comfortable', 'compact']) expect(normalizeSettings({ theme, density })).toMatchObject({ theme, density })
  })

  it('names each preference group, saves the exact existing enum, and does not follow system darkness unless selected', async () => {
    await boot()
    expect(document.documentElement.dataset.theme).toBe('light')
    open('settings-btn')
    for (const name of ['Appearance', 'Density', 'Workspace']) expect(document.querySelector(`#sheet [role="group"][aria-label="${name}"]`)).not.toBeNull()
    buttonIn('[aria-label="Appearance"]', 'Dark').click()
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    buttonIn('[aria-label="Appearance"]', 'Match app').click()
    await vi.waitFor(() => expect(mock.saveSettings).toHaveBeenLastCalledWith({ theme: 'light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    buttonIn('[aria-label="Density"]', 'Compact').click()
    await vi.waitFor(() => expect(document.documentElement.dataset.density).toBe('compact'))
    expect(mock.settings.workspace).toBe('demo')
  })

  it('shows no workspace switch and stays on production in the shipped build', async () => {
    grantHosts(SHIPPED_HOSTS)
    await boot()
    expect(mock.bootstrap.mock.calls[0][0]).toMatchObject({ id: 'production' })
    open('settings-btn')
    expect(document.querySelector('#sheet [role="group"][aria-label="Workspace"]')).toBeNull()
    expect(document.getElementById('demo-role')).toBeNull()
    expect(mock.settings.workspace).toBe('demo')
  })

  it('retains an explicitly saved system preference on a dark device', async () => {
    mock.settings = { ...mock.settings, theme: 'system' }
    await boot()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(mock.saveSettings).not.toHaveBeenCalled()
  })

  it('offers only salesperson, store manager, and group manager roles', async () => {
    await boot(); open('settings-btn')
    const role = document.querySelector('#demo-role')
    expect([...role.options].map((option) => option.textContent)).toEqual(['Salesperson', 'Store manager', 'Group manager'])
  })

  it('preserves a saved legacy role as read-only', async () => {
    mock.settings = { ...mock.settings, demoRole: 'porter' }
    await boot(); open('settings-btn')
    const legacy = document.querySelector('#demo-role option[value="porter"]')
    expect(legacy).toBeDisabled()
    expect(legacy).toHaveTextContent('Porter · Legacy')
  })
})

describe('extension filter workflow and keyboard containment', () => {
  it('can select and deselect the same make and model without reopening the sheet', async () => {
    await boot(); open('filters-btn')
    expect(document.querySelector('.filter-ledger-title').textContent).toBe('Service')
    for (const [group, name] of [['Make', 'Ford'], ['Model', 'Alpha']]) {
      const choice = buttonIn(`[aria-label="${group}"]`, name)
      choice.click()
      expect(choice.getAttribute('aria-pressed')).toBe('true')
      expect(document.querySelectorAll('#rows .row')).toHaveLength(1)
      choice.click()
      expect(choice.getAttribute('aria-pressed')).toBe('false')
      expect(document.querySelectorAll('#rows .row')).toHaveLength(2)
    }
  })

  it('shows three service states plus All and clears filters without losing focus', async () => {
    await boot(); open('filters-btn')
    expect([...document.querySelectorAll('#service-filter-buttons button')].map((button) => button.textContent)).toEqual(['All', 'Waiting for service', 'In service', 'Ready'])
    document.querySelector('[data-service-status="serviced"]').click()
    expect(document.querySelector('.sheet-foot .btn-primary').textContent).toBe('Show 1 vehicle')
    const sort = document.querySelector('#sort-select')
    sort.value = 'price-asc'; sort.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.sheet-foot .btn').click()
    expect(document.activeElement).toBe(document.querySelector('.sheet-foot .btn'))
    expect(document.querySelector('#sort-select').value).toBe('relevance')
    expect(document.querySelector('[data-service-status=""]').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.sheet-foot .btn-primary').textContent).toBe('Show 2 vehicles')
  })

  it.each(['filters-btn', 'settings-btn'])('traps Tab within %s, makes background inert, and restores focus on Escape', async (id) => {
    await boot()
    const trigger = open(id)
    const sheet = document.querySelector('#sheet')
    for (const selector of ['.mast', '.views', '.fresh']) expect(document.querySelector(selector).hasAttribute('inert')).toBe(true)
    expect(sheet.hasAttribute('inert')).toBe(false)
    const candidates = [...sheet.querySelectorAll('button, select, input, a[href], [tabindex]')].filter((node) => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden], [inert]'))
    const first = candidates[0], last = candidates.at(-1)
    first.focus(); key('Tab', true)
    expect(document.activeElement).toBe(last)
    last.focus(); key('Tab')
    expect(document.activeElement).toBe(first)
    key('Escape')
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    for (const selector of ['.mast', '.views', '.fresh']) expect(document.querySelector(selector).hasAttribute('inert')).toBe(false)
    expect(sheet.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not let a delayed close hide a newly reopened dialog', async () => {
    await boot(); open('settings-btn'); key('Escape'); open('filters-btn')
    await new Promise((resolve) => setTimeout(resolve, 320))
    expect(document.querySelector('#sheet').hidden).toBe(false)
    expect(document.querySelector('#sheet').dataset.kind).toBe('filters')
    expect(document.querySelector('.views').hasAttribute('inert')).toBe(true)
  })
})
