import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlatformAdminPage from './PlatformAdminPage'
import type { PlatformConnection, PlatformConnections, PlatformOverview } from './types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const group = { id: 'synthetic-group', name: 'Synthetic Motors', status: 'active' as const, updatedAt: '2026-10-05T12:00:00Z', dealerships: [
  { id: 'synthetic-north', groupId: 'synthetic-group', name: 'Synthetic North', storeKey: 'north', website: '', enabled: true },
  { id: 'synthetic-south', groupId: 'synthetic-group', name: 'Synthetic South', storeKey: 'south', website: '', enabled: true },
], health: { status: 'stale', connected: true, activeEmployees: 1, employees: 1, groupManagers: 1, message: 'Synthetic retained release' } }
const owner = { id: 'synthetic-owner', name: 'Demo owner', email: 'owner@example.invalid', enabled: true }
const overview: PlatformOverview = { owner, owners: [owner], groups: [group], audit: [], revision: 5, generatedAt: '2026-10-05T14:00:00Z' }
const source = (id: string, overrides: Partial<PlatformConnection> = {}): PlatformConnection => ({ id, groupId: group.id, dealershipId: 'synthetic-north', name: 'Public feed', provider: 'public_inventory', vendor: 'Public website', oem: 'not_applicable', method: 'api', endpoint: 'https://feed.example.invalid/inventory', credentialRef: '', enabled: true, cadence: 'daily', localTime: '05:30', timezone: 'America/Detroit', updatedAt: '2026-10-05T12:00:00Z', verification: 'not_verified', ...overrides })
const sources: PlatformConnections = { groupId: group.id, revision: 5, connections: [source('synthetic-public'), source('synthetic-oasis', { name: 'OASIS archive', provider: 'oem', vendor: 'Archived Ford evidence', oem: 'ford_lincoln', dealershipId: 'synthetic-south', method: 'collector', endpoint: '', enabled: false, cadence: 'manual' }), source('synthetic-crm', { name: 'Independent CRM', provider: 'crm', vendor: 'Independent CRM', oem: 'not_applicable' })], requests: [], execution: { connected: false, message: 'No executor.' }, scheduler: { enabled: false, lastTick: null, checked: 0, queued: 0, waiting: 0, failed: 0 } }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const start = async (sourceData = sources) => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => Response.json(options?.method === 'POST' ? { saved: true, id: 'synthetic-oasis' } : url.endsWith('/connections') ? sourceData : overview))
  vi.stubGlobal('fetch', fetcher)
  render(<PlatformAdminPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open Synthetic Motors workspace' }))
  fireEvent.click(screen.getByRole('button', { name: 'Data connections' }))
  await screen.findByRole('region', { name: 'Source directory' })
  return fetcher
}

describe('Source and OEM administration workbench', () => {
  it('labels every empty pull-history filter with its selected request state', async () => {
    await start()
    fireEvent.click(screen.getByRole('button', { name: /^Pull requests/ }))
    const queue=screen.getByRole('region', { name: 'Pull request queue' })
    const filter=within(queue).getByRole('combobox', { name: 'Pull request state filter' })
    for (const [value,message] of [
      ['all','No pull requests.'],
      ['queued','No waiting pull requests.'],
      ['running','No running pull requests.'],
      ['completed','No completed pull requests.'],
      ['failed','No stopped pull requests.'],
      ['reconciliation_required','No pull requests need reconciliation.'],
      ['cancelled','No cancelled pull requests.'],
    ]) {
      fireEvent.change(filter, { target: { value } })
      expect(filter).toHaveValue(value)
      expect(within(queue).getByText(message)).toBeInTheDocument()
      if(value!=='cancelled')expect(within(queue).queryByText('No cancelled pull requests.')).not.toBeInTheDocument()
    }
    fireEvent.change(filter, { target: { value: 'unknown-state' } })
    expect(within(queue).getByText('No pull requests match this filter.')).toBeInTheDocument()
  })

  it('combines dealership, OEM and preference filters without leaving an excluded source in the inspector', async () => {
    await start()
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection dealership filter' }), { target: { value: 'synthetic-south' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection OEM filter' }), { target: { value: 'ford_lincoln' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection preference filter' }), { target: { value: 'paused' } })
    const directory = screen.getByRole('region', { name: 'Source directory' })
    expect(within(directory).getByRole('button', { name: 'Inspect OASIS archive at Synthetic South' })).toBeInTheDocument()
    expect(within(directory).queryByRole('button', { name: /Public feed/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'OASIS archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queue pull request' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a connection' }), { target: { value: 'does not exist' } })
    expect(screen.getByRole('heading', { name: 'No matching sources' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear source filters' }))
    expect(within(directory).getAllByRole('button')).toHaveLength(3)
  })

  it('opens a dealership-scoped OEM draft, starts paused and preserves its family when the source category changes', async () => {
    vi.stubGlobal('innerWidth', 1440)
    const fetcher = await start()
    fireEvent.click(screen.getByRole('button', { name: 'Evidence & OEM coverage' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'OEM family' }), { target: { value: 'toyota_lexus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Toyota / Lexus source for Synthetic South' }))
    const form = screen.getByRole('form', { name: 'Add data connection' })
    expect(within(form).getByRole('combobox', { name: 'Dealership' })).toHaveValue('synthetic-south')
    expect(within(form).getByRole('combobox', { name: 'OEM connection' })).toHaveValue('toyota_lexus')
    fireEvent.change(within(form).getByRole('combobox', { name: 'Data source' }), { target: { value: 'equipment' } })
    expect(within(form).getByRole('combobox', { name: 'OEM connection' })).toHaveValue('toyota_lexus')
    fireEvent.change(within(form).getByRole('textbox', { name: 'Connection name' }), { target: { value: 'Synthetic factory equipment' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Provider or vendor name' }), { target: { value: 'Authorized synthetic vendor' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Continue to connection' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Continue to schedule & review' }))
    expect(within(form).getByRole('checkbox', { name: 'Enable scheduling preference' })).not.toBeChecked()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Synthetic configuration setup' } })
    fireEvent.submit(form)
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'OASIS archive' })).toHaveFocus())
    const post = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(post[0]).toBe('/api/platform/groups/synthetic-group/connections')
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({ dealershipId: 'synthetic-south', oem: 'toyota_lexus', provider: 'equipment', enabled: false, expectedRevision: 5 })
  })

  it('shows schedules as configured targets and queued work without invented successful captures', async () => {
    await start({ ...sources, requests: [{ id: 'synthetic-pull', connectionId: 'synthetic-public', state: 'queued', kind: 'scheduled', scheduledSlot: '2026-10-05T05:30', requestedBy: 'Synthetic planner', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' }] })
    expect(screen.getByText('Daily planner not activated')).toBeInTheDocument()
    const selected = screen.getByRole('article', { name: 'Selected source configuration' })
    expect(within(selected).getByText('Daily 05:30')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pull requests 1' }))
    const queue = screen.getByRole('region', { name: 'Pull request queue' })
    expect(within(queue).getByText('Awaiting executor')).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Cancel request' })).toBeEnabled()
    fireEvent.change(within(queue).getByRole('combobox', { name: 'Pull request state filter' }), { target: { value: 'cancelled' } })
    expect(within(queue).getByText('No cancelled pull requests.')).toBeInTheDocument()
    expect(screen.queryByText(/Last successful sync/)).not.toBeInTheDocument()
  })

  it('shows an enabled planner awaiting its first tick with the full zeroed counters', async () => {
    await start({ ...sources, scheduler: { enabled: true, lastTick: null, checked: 0, queued: 0, waiting: 0, failed: 0 } })
    expect(screen.getByText('Queue planner enabled · awaiting first tick')).toBeInTheDocument()
    expect(screen.getByText(/Last tick: Not confirmed · 0 checked · 0 queued · 0 planner waiting · 0 failed/)).toBeInTheDocument()
    expect(screen.getByText(/Executor not connected/)).toBeInTheDocument()
  })

  it('shows the latest planner tick and failed batch counters', async () => {
    await start({ ...sources, scheduler: { enabled: true, lastTick: '2026-10-05T09:31:00.000Z', checked: 3, queued: 1, waiting: 2, failed: 1 } })
    expect(screen.getByText('Latest planner batch reported failures')).toBeInTheDocument()
    expect(screen.getByText(/Last tick: .* · 3 checked · 1 queued · 2 planner waiting · 1 failed/)).toBeInTheDocument()
  })

  it('confirms a successful planner heartbeat separately from executor connectivity', async () => {
    await start({ ...sources, scheduler: { enabled: true, lastTick: '2026-10-05T09:31:00.000Z', checked: 3, queued: 1, waiting: 0, failed: 0 } })
    expect(screen.getByText('Planner heartbeat successful')).toBeInTheDocument()
    expect(screen.getByText(/Last tick: .* · 3 checked · 1 queued · 0 planner waiting · 0 failed/)).toBeInTheDocument()
    expect(screen.getByText('Executor not connected')).toBeInTheDocument()
  })

  it('moves desktop keyboard focus into the inspector after cross-panel inspection', async () => {
    vi.stubGlobal('innerWidth', 1440)
    const cancelled = { id: 'synthetic-cancelled', connectionId: 'synthetic-oasis', state: 'cancelled' as const, kind: 'manual' as const, requestedBy: 'Synthetic operator', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:05:00Z' }
    await start({ ...sources, requests: [cancelled] })

    const directory = screen.getByRole('region', { name: 'Source directory' })
    const ledgerRow = within(directory).getByRole('button', { name: 'Inspect OASIS archive at Synthetic South' })
    fireEvent.click(ledgerRow)
    expect(ledgerRow).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'OASIS archive' })).not.toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Evidence & OEM coverage' }))
    fireEvent.click(screen.getByRole('button', { name: 'View OASIS archive' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'OASIS archive' })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Pull requests 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect source' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'OASIS archive' })).toHaveFocus())
  })

  it('focuses the inspector after provider setup saves on desktop', async () => {
    vi.stubGlobal('innerWidth', 1440)
    const fetcher = await start()
    fireEvent.click(screen.getByRole('button', { name: 'Provider directory' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure Selly Automotive' }))
    const form = screen.getByRole('form', { name: 'Add data connection' })
    fireEvent.click(within(form).getByRole('button', { name: 'Continue to connection' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Continue to schedule & review' }))
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Synthetic provider setup' } })
    fireEvent.submit(form)
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'OASIS archive' })).toHaveFocus())
  })

  it('restores direct desktop ledger edit focus after saving', async () => {
    vi.stubGlobal('innerWidth', 1440)
    await start()
    const configure = screen.getByRole('button', { name: 'Configure' })
    fireEvent.click(configure)
    const form = screen.getByRole('form', { name: 'Edit data connection' })
    fireEvent.click(within(form).getByRole('button', { name: 'Continue to connection' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Continue to schedule & review' }))
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Synthetic direct edit' } })
    fireEvent.submit(form)
    await waitFor(() => expect(configure).toHaveFocus())
  })
})
