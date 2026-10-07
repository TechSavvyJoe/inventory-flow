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
const sources: PlatformConnections = { groupId: group.id, revision: 5, connections: [source('synthetic-public'), source('synthetic-oasis', { name: 'OASIS archive', provider: 'oem', vendor: 'Archived Ford evidence', oem: 'ford_lincoln', dealershipId: 'synthetic-south', method: 'collector', endpoint: '', enabled: false, cadence: 'manual' })], requests: [], execution: { connected: false, message: 'No executor.' }, scheduler: { enabled: false, lastTick: null, checked: 0, queued: 0, waiting: 0, failed: 0 } }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const start = async (sourceData = sources) => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => Response.json(options?.method === 'POST' ? { saved: true } : url.endsWith('/connections') ? sourceData : overview))
  vi.stubGlobal('fetch', fetcher)
  render(<PlatformAdminPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Data connections' }))
  await screen.findByRole('navigation', { name: 'Data connection views' })
  return fetcher
}

describe('Source and OEM administration workbench', () => {
  it('combines dealership, OEM and preference filters without leaving an excluded source in the inspector', async () => {
    await start()
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection dealership filter' }), { target: { value: 'synthetic-south' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection OEM filter' }), { target: { value: 'ford_lincoln' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection preference filter' }), { target: { value: 'paused' } })
    const directory = screen.getByRole('region', { name: 'Source directory' })
    expect(within(directory).getByRole('button', { name: 'Inspect OASIS archive at Synthetic South' })).toBeInTheDocument()
    expect(within(directory).queryByRole('button', { name: /Public feed/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'OASIS archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request pull' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a connection' }), { target: { value: 'does not exist' } })
    expect(screen.getByRole('heading', { name: 'No matching sources' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear source filters' }))
    expect(within(directory).getAllByRole('button')).toHaveLength(2)
  })

  it('opens a dealership-scoped OEM draft, starts paused and preserves its family when the source category changes', async () => {
    const fetcher = await start()
    fireEvent.click(screen.getByRole('button', { name: 'OEM coverage' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'OEM family' }), { target: { value: 'toyota_lexus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Toyota / Lexus source for Synthetic South' }))
    const form = screen.getByRole('form', { name: 'Add data connection' })
    expect(within(form).getByRole('combobox', { name: 'Dealership' })).toHaveValue('synthetic-south')
    expect(within(form).getByRole('combobox', { name: 'OEM connection' })).toHaveValue('toyota_lexus')
    expect(within(form).getByRole('checkbox', { name: 'Source enabled' })).not.toBeChecked()
    fireEvent.change(within(form).getByRole('combobox', { name: 'Data source' }), { target: { value: 'equipment' } })
    expect(within(form).getByRole('combobox', { name: 'OEM connection' })).toHaveValue('toyota_lexus')
    fireEvent.change(within(form).getByRole('textbox', { name: 'Connection name' }), { target: { value: 'Synthetic factory equipment' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Provider or vendor name' }), { target: { value: 'Authorized synthetic vendor' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason for this change' }), { target: { value: 'Synthetic configuration setup' } })
    fireEvent.submit(form)
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
    const post = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(post[0]).toBe('/api/platform/groups/synthetic-group/connections')
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({ dealershipId: 'synthetic-south', oem: 'toyota_lexus', provider: 'equipment', enabled: false, expectedRevision: 5 })
  })

  it('shows schedules as configured targets and queued work without invented successful captures', async () => {
    await start({ ...sources, requests: [{ id: 'synthetic-pull', connectionId: 'synthetic-public', state: 'queued', kind: 'scheduled', scheduledSlot: '2026-10-05T05:30', requestedBy: 'Synthetic planner', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Schedules' }))
    const schedules = screen.getByRole('region', { name: 'Dealership pull schedules' })
    expect(within(schedules).getByText('Daily 05:30')).toBeInTheDocument()
    expect(within(schedules).queryByText('OASIS archive')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pull queue 1' }))
    const queue = screen.getByRole('region', { name: 'Pull request queue' })
    expect(within(queue).getByText('Awaiting executor')).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Cancel request' })).toBeEnabled()
    fireEvent.change(within(queue).getByRole('combobox', { name: 'Pull request state filter' }), { target: { value: 'cancelled' } })
    expect(within(queue).getByText('No cancelled pull requests.')).toBeInTheDocument()
    expect(screen.queryByText(/Last successful sync/)).not.toBeInTheDocument()
  })
})
