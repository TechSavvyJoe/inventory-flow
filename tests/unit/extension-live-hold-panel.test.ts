// @vitest-environment jsdom
// @ts-nocheck -- The panel is an unbundled browser module tested with a synthetic API response.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
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

it.each(['requested', 'active'])('shows the safe %s app hold and expected date separately from provider status', async (state) => {
  const appRecord = {
    ...record,
    hold: { state: 'none_observed', canViewEvidence: true, canManage: true, backupCount: 0 },
    privateEvidence: { primary: null, backups: [], comments: [], alerts: [] },
    manualHold: { state, expectedDeliveryDate: '2026-10-12', customerLabel: 'PRIVATE_MARKER', note: 'PRIVATE_MARKER' },
  }
  api.bootstrap.mockResolvedValue({ ...bootstrap, vehicles: [appRecord] })
  api.vehicle.mockResolvedValue(appRecord)
  live.check.mockResolvedValue({ status: 'verified', stock: record.stockNumber, activeCount: 0, checkedAt: '2026-09-23T15:30:00Z' })
  await import('../../extension/sidepanel/panel.js')
  const panel = within(document.body)
  const row = await panel.findByRole('option', { name: /2024 Ford F-350SD Platinum/ })
  expect(row.textContent).toContain(state === 'requested' ? 'Hold request · Pending approval' : 'Inventory Flow reservation')
  if (state === 'requested') expect(row.textContent).not.toContain('Inventory Flow reservation')
  row.click()
  ;(await panel.findByRole('tab', { name: 'Holds & moves' })).click()
  const heading = await panel.findByRole('heading', { name: state === 'requested' ? 'Inventory Flow hold request' : 'Inventory Flow reservation' })
  const section = heading.closest('section')
  await vi.waitFor(() => expect(within(section).getByText('10/12/2026')).toBeTruthy())
  expect(section.textContent).toContain(state === 'requested' ? 'This request is not an approved hold' : 'An app-owned reservation is active')
  expect(section.textContent).not.toContain('PRIVATE_MARKER')
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

it('keeps a current provider hold source-labeled beside the separate DealerMail result', async () => {
  const providerRecord = {
    ...record,
    hold: { state: 'none_observed', canViewEvidence: true, canManage: true, backupCount: 0 },
    privateEvidence: { primary: null, backups: [], comments: [], alerts: [] },
    operationalEvidence: { records: [{ vin: record.vin, provider: 'autocheck', sourceLabel: 'Synthetic AutoCheck', capturedAt: '2026-09-23T14:00:00Z', dataState: 'current', readOnly: true, complete: true, holdState: 'held' }] },
    inventoryDecision: { status: 'unconfirmed', comparison: 'conflict', manualHold: null, importedHold: false, label: 'Review source records', reasons: ['provider_hold_disagreement'], evidence: [{ vin: record.vin, provider: 'autocheck', sourceLabel: 'Synthetic AutoCheck', capturedAt: '2026-09-23T14:00:00Z', dataState: 'current', readOnly: true, complete: true, holdState: 'held', effectiveHoldState: 'held', comparison: 'conflict', reasons: ['provider_hold_disagreement'] }] },
  }
  api.bootstrap.mockResolvedValue({ ...bootstrap, vehicles: [providerRecord] })
  api.vehicle.mockResolvedValue(providerRecord)
  live.check.mockResolvedValue({ status: 'unavailable' })
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelector('#rows .row')).not.toBeNull())
  expect(document.querySelector('.row-status')?.textContent).toContain('Synthetic AutoCheck reports hold')
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(document.querySelector('#tab-hold')).not.toBeNull())
  document.querySelector('#tab-hold').click()
  await vi.waitFor(() => expect(document.querySelector('.hold-card')?.textContent).toContain('Could not confirm the current hold'))
  expect(document.querySelector('.hold-card')?.textContent).toContain('Hold status needs review')
  expect(document.querySelector('.hold-card')?.textContent).not.toContain('No current DealerMail hold found')
  expect(document.querySelector('#tab-panel')?.textContent).toContain('Read-only provider hold observations')
  expect(document.querySelector('#tab-panel')?.textContent).toContain('Synthetic AutoCheck')
  expect(document.querySelector('#tab-panel')?.textContent).toContain('Reports a hold')
  expect(document.querySelector('#tab-panel')?.textContent).toContain('Records disagree')
  expect(document.querySelector('#tab-panel')?.textContent).toContain('separate from DealerMail')
})

it('keeps a retained provider hold findable but labels it as unverified', async () => {
  const providerRecord = {
    ...record,
    hold: { state: 'none_observed', canViewEvidence: true, canManage: true, backupCount: 0 },
    privateEvidence: { primary: null, backups: [], comments: [], alerts: [] },
    operationalEvidence: { records: [{ vin: record.vin, provider: 'carfax', sourceLabel: 'Synthetic CARFAX', capturedAt: '2026-09-01T14:00:00Z', dataState: 'stale_unverified', readOnly: true, complete: true, holdState: 'held' }] },
  }
  api.bootstrap.mockResolvedValue({ ...bootstrap, vehicles: [providerRecord] })
  api.vehicle.mockResolvedValue(providerRecord)
  live.check.mockResolvedValue({ status: 'unavailable' })
  await import('../../extension/sidepanel/panel.js')
  await vi.waitFor(() => expect(document.querySelector('#rows .row')).not.toBeNull())
  expect(document.querySelector('.row-status')?.textContent).toContain('Synthetic CARFAX prior hold · verify')
  document.querySelector('#scope-held').click()
  expect(document.querySelector('#rows').textContent).toContain('HT1345U')
  document.querySelector('#rows .row').click()
  await vi.waitFor(() => expect(document.querySelector('#tab-hold')).not.toBeNull())
  document.querySelector('#tab-hold').click()
  await vi.waitFor(() => expect(document.querySelector('#tab-panel')?.textContent).toContain('Previously reported a hold · not current'))
  expect(document.querySelector('.hold-card')?.textContent).not.toContain('No current DealerMail hold found')
})
