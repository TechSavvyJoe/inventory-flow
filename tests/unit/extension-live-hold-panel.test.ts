// @vitest-environment jsdom
// @ts-nocheck -- The panel is an unbundled browser module tested with a synthetic API response.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import markup from '../../extension/sidepanel/index.html?raw'

const api = vi.hoisted(() => ({ bootstrap: vi.fn(), vehicle: vi.fn() }))
const live = vi.hoisted(() => ({ tab: vi.fn(), check: vi.fn() }))
vi.mock('../../extension/sidepanel/lib/api.mjs', async (importOriginal) => ({ ...(await importOriginal()), fetchBootstrap: api.bootstrap, fetchVehicle: api.vehicle }))
vi.mock('../../extension/sidepanel/lib/live-dealermail-hold.mjs', async (importOriginal) => ({ ...(await importOriginal()), dealerMailTabId: live.tab, checkLiveDealerMailHold: live.check }))
vi.mock('../../extension/sidepanel/lib/host.mjs', () => ({
  host: 'extension', previewFlags: { photos: false }, placeholderPhotos: () => [], copyText: vi.fn(), openUrl: vi.fn(), openExtensionPage: vi.fn(),
  storage: { getSettings: async () => ({ workspace: 'production', theme: 'light', density: 'comfortable' }), getCompare: async () => [], getFilters: async () => null, takePendingQuery: async () => null, onPendingQuery: () => {}, getCache: async () => null, setCache: async () => {}, clearCache: async () => {}, setCompare: async () => {}, setFilters: async () => {} },
}))

const record = {
  vin: '1FT8W3BM8RED19309', stockNumber: 'HT1345U', vehicleName: '2024 Ford F-350SD Platinum', make: 'Ford', model: 'F-350SD', homeStore: 'Howell', listedPrice: 76995,
  hold: { state: 'primary', canViewEvidence: true, canManage: true, primarySalesperson: 'Old salesperson', reason: 'Old hold reason', backupCount: 0 },
  privateEvidence: { primary: { salesperson: 'Old salesperson', customerOrReason: 'Old hold reason' }, backups: [], comments: [], alerts: [] },
}
const bootstrap = { access: { user: 'synthetic-manager', store: 'Howell', role: 'manager' }, meta: { publicFreshness: 'current', dealerMailFreshness: 'current', reportDate: '2026-09-23', dealerMailCapturedAt: '2026-09-23T12:36:22Z' }, stores: [], transfers: [], vehicles: [record] }
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  document.documentElement.innerHTML = markup.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/g, '')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 0 })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0)
  api.bootstrap.mockResolvedValue(bootstrap)
  api.vehicle.mockResolvedValue(record)
  live.tab.mockResolvedValue(7)
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else delete HTMLElement.prototype.scrollIntoView
})

it('replaces a released truck hold and removes the stale person and reason', async () => {
  live.check.mockResolvedValue({ status: 'verified', stock: 'HT1345U', activeCount: 0, checkedAt: '2026-09-23T15:30:00Z' })
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelector('#rows .row')).not.toBeNull())
  expect(document.querySelector('#fresh-text')?.textContent).toContain('holds captured')
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(document.querySelector('.detail-status-line')?.textContent).toContain('No active hold'))
  document.querySelector('#tab-hold').click()
  expect(document.querySelector('.hold-card')?.textContent).toContain('Checked directly in DealerMail')
  expect(document.querySelector('.hold-card')?.textContent).not.toMatch(/Old salesperson|Old hold reason/)
  expect(live.check).toHaveBeenCalledWith(7, 'HT1345U')
})

it('retains the dated captured evidence after a failed production live check', async () => {
  live.check.mockResolvedValue({ status: 'unavailable' })
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelector('#rows .row')).not.toBeNull())
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(document.querySelector('.detail-status-line')?.textContent).toContain('Last verified hold'))
  document.querySelector('#tab-hold').click()
  expect(document.querySelector('.hold-card')?.textContent).toContain('Could not confirm the current hold')
  expect(document.querySelector('.hold-card')?.textContent).toContain('Old salesperson')
  expect(document.querySelector('.hold-card')?.textContent).toContain('Old hold reason')
  expect(document.querySelector('.hold-card')?.textContent).toContain('Last verified DealerMail snapshot captured')
  expect(document.querySelector('.hold-card')?.textContent).toContain('09/23/2026')
  document.querySelector('#back').click()
  document.querySelector('#scope-held').click()
  expect(document.querySelector('#rows')?.textContent).toContain('HT1345U')
})

it('keeps captured evidence visible while the production live check is pending', async () => {
  let finishCheck
  live.check.mockReturnValue(new Promise((resolve) => { finishCheck = resolve }))
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelector('#rows .row')).not.toBeNull())
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(live.check).toHaveBeenCalled())
  document.querySelector('#tab-hold').click()
  expect(document.querySelector('.hold-card')?.textContent).toContain('Checking the current DealerMail hold')
  expect(document.querySelector('.hold-card')?.textContent).toContain('Old hold reason')
  expect(document.querySelector('.hold-card')?.textContent).toContain('Last verified DealerMail snapshot captured')
  finishCheck({ status: 'verified', stock: 'HT1345U', activeCount: 1, checkedAt: '2026-09-23T15:30:00Z' })
  await vi.waitFor(() => expect(document.querySelector('.hold-card')?.textContent).toContain('Checked directly in DealerMail'))
  expect(document.querySelector('.hold-card')?.textContent).not.toMatch(/Old salesperson|Old hold reason/)
})
