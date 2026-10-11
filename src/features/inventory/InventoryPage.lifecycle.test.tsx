import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapData, TransferRecord, VehicleRecord } from '../../types'
import type { InventoryExperienceProps, InventoryVehicle } from './types'
import { InventoryPage } from './InventoryPage'
import { clearWorkspaceMemory } from '../../lib/workspace-memory'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, get: vi.fn(), adapt: vi.fn(), props: null as InventoryExperienceProps | null }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getVehicle: mocked.get }))
vi.mock('../../components/SourceWarning', () => ({ SourceWarning: () => null }))
vi.mock('../../app/adapters', () => ({
  groupStores: () => [], inventoryStore: () => ({ id: 'howell', name: 'Howell' }),
  toInventoryVehicle: mocked.adapt,
}))
vi.mock('./InventoryExperience', () => ({ InventoryExperience: (props: InventoryExperienceProps) => { mocked.props = props; return <>
  <output data-testid="vehicles">{props.vehicles.map(vehicle => vehicle.vehicleName).join(',')}</output>
  <output data-testid="detail">{props.vehicles.map(vehicle => (vehicle as unknown as VehicleRecord).publicScan?.dealerName ?? '').join(',')}</output>
  <output data-testid="protected">{props.vehicles.map(vehicle => (vehicle as unknown as VehicleRecord).privateEvidence?.primary?.customerOrReason ?? '').join(',')}</output>
  <output data-testid="search">{props.vehicles.map(vehicle => (vehicle as unknown as VehicleRecord).searchText ?? '').join(',')}</output>
  <output data-testid="service">{props.vehicles.map(vehicle => (vehicle as unknown as VehicleRecord).serviceReadiness?.version ?? '').join(',')}</output>
  <output data-testid="oasis">{props.vehicles.map(vehicle => (vehicle as unknown as VehicleRecord).fordOasis?.vehicleDescription ?? '').join(',')}</output>
  <output data-testid="selected">{props.selectedVehicleId ?? 'none'}</output>
  <output data-testid="detail-state">{props.detailState}</output>
  <output data-testid="query">{props.initialQuery}</output>
  <output data-testid="scope">{props.scope}</output>
  <output data-testid="return-label">{props.returnLabel}</output>
  <output data-testid="page-size">{props.pageSize}</output>
  <output data-testid="initial-filters">{JSON.stringify(props.initialFilters ?? null)}</output>
  <output data-testid="quick-view">{props.initialQuickView}</output>
  <output data-testid="filter-request">{props.filterRequestKey}</output>
  <button onClick={() => props.onSelectedVehicleChange?.(props.vehicles[0].id)}>First vehicle</button>
  <button onClick={() => props.onSelectedVehicleChange?.(props.vehicles[1].id)}>Second vehicle</button>
  <button onClick={props.onRetryDetail}>Retry record</button>
  <button onClick={() => props.onSelectedVehicleChange?.(null)}>Close vehicle</button>
  <button onClick={() => props.onScopeChange?.('group')}>Group inventory</button>
  <button onClick={() => { props.onScopeChange?.('group'); props.onSelectedVehicleChange?.(props.vehicles[1].id) }}>Open other-location result</button>
</> } }))

function vehicle(suffix: string, name: string): VehicleRecord { return { vin: `TESTDATAVEHICLE${suffix}`, vehicleName: name } as VehicleRecord }
const first = vehicle('001', 'First summary')
const second = vehicle('002', 'Second summary')
function detailVehicle(base: VehicleRecord, marker: string, patch: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    ...base,
    publicScan: {
      actualLocation: null, locationCity: null, dealerLocationId: null, dealerName: marker,
      vehicleId: null, genericColor: null, sourceSites: [], sourceCount: null, firstSeen: null, lastSeen: null,
    },
    ...patch,
  }
}
function data(firstPatch: Partial<VehicleRecord> = {}, metaPatch: Partial<BootstrapData['meta']> = {}, secondPatch: Partial<VehicleRecord> = {}): BootstrapData {
  return {
    access: { user: 'Synthetic Employee', role: 'manager', store: 'Howell', canViewPrivateEvidence: true, canCreateTransfer: true },
    meta: { reportDate: '2026-09-25', dealerMailCapturedAt: '2026-09-25T12:00:00Z', dealerMailFreshness: 'current', ...metaPatch },
    vehicles: [{ ...first, hold: { state: 'none_observed', label: 'No hold', backupCount: 0 }, ...firstPatch }, { ...second, ...secondPatch }],
    transfers: [],
  } as unknown as BootstrapData
}
function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>Browser back</button>
    <button onClick={() => navigate(1)}>Browser forward</button>
    <button onClick={() => navigate('/inventory')}>Inventory list</button>
  </>
}
function show(path = '/inventory', homeMode = false) { return render(<MemoryRouter initialEntries={[path]}><Navigation /><InventoryPage homeMode={homeMode} /></MemoryRouter>) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  clearWorkspaceMemory()
  mocked.get.mockReset()
  mocked.get.mockImplementation(() => new Promise(() => {}))
  mocked.adapt.mockReset().mockImplementation((vehicle: VehicleRecord) => ({ ...vehicle, id: vehicle.vin }))
  mocked.props = null
  mocked.context = { data: data(), role: 'manager', homeStore: 'Howell', currentUser: 'Synthetic Employee' }
})
afterEach(cleanup)

describe('inventory detail and navigation lifecycle', () => {
  function savedListBootstrap(): BootstrapData {
    const current = data()
    return { ...current, savedListsEnabled: true, access: { ...current.access!, userId: 'synthetic-owner-a' } }
  }

  function enableSavedLists(refreshSnapshot: () => Promise<BootstrapData | null>) {
    mocked.context = { ...mocked.context, data: savedListBootstrap(), currentUserId: 'synthetic-owner-a', refreshSnapshot }
  }

  it('refreshes saved-list vehicles from the new authorized projection and its open transfer join', async () => {
    const freshVehicle = { ...first, vehicleName: 'Fresh authorized vehicle', listedPrice: 31995 }
    const closed = { id: 'closed-transfer', vin: first.vin, requestStatus: 'closed' } as TransferRecord
    const open = { id: 'open-transfer', vin: first.vin, requestStatus: 'requested', nextAction: 'Fresh move action' } as TransferRecord
    const fresh: BootstrapData = { ...savedListBootstrap(), vehicles: [freshVehicle], transfers: [closed, open] }
    const refreshSnapshot = vi.fn().mockResolvedValue(fresh)
    enableSavedLists(refreshSnapshot)
    show()
    expect(mocked.props!.savedLists).toMatchObject({ enabled: true, ownerId: 'synthetic-owner-a', role: 'manager', store: 'Howell' })
    const projected = { id: first.vin, vin: first.vin, price: 31995, movement: { requestId: open.id, nextAction: open.nextAction } } as InventoryVehicle
    mocked.adapt.mockClear().mockReturnValueOnce(projected)
    let result: InventoryVehicle[] | null = null
    await act(async () => { result = await mocked.props!.savedLists!.refreshVehicles!() })
    expect(refreshSnapshot).toHaveBeenCalledOnce()
    expect(mocked.adapt).toHaveBeenCalledExactlyOnceWith(freshVehicle, fresh, open)
    expect(result).toEqual([projected])
    expect(result).not.toContainEqual(expect.objectContaining({ id: second.vin }))
    expect((mocked.context.data as BootstrapData).vehicles[0].vehicleName).toBe('First summary')
  })

  it.each(['failed refresh', 'disabled lists', 'missing access', 'wrong owner', 'missing owner', 'wrong role', 'wrong store'] as const)(
    'does not export the rendered cached inventory after %s', async reason => {
      let fresh: BootstrapData | null = savedListBootstrap()
      if (reason === 'failed refresh') fresh = null
      else if (reason === 'disabled lists') fresh.savedListsEnabled = false
      else if (reason === 'missing access') delete fresh.access
      else if (reason === 'wrong owner') fresh.access!.userId = 'synthetic-owner-b'
      else if (reason === 'missing owner') delete fresh.access!.userId
      else if (reason === 'wrong role') fresh.access!.role = 'sales'
      else fresh.access!.store = 'Lincoln'
      enableSavedLists(vi.fn().mockResolvedValue(fresh))
      show()
      mocked.adapt.mockClear()
      await act(async () => { expect(await mocked.props!.savedLists!.refreshVehicles!()).toBeNull() })
      expect(mocked.adapt).not.toHaveBeenCalled()
      expect(screen.getByTestId('vehicles')).toHaveTextContent('First summary,Second summary')
    },
  )

  it.each(['owner', 'role', 'store'] as const)('discards a saved-list refresh when the active %s changes before it completes', async changed => {
    const pending = deferred<BootstrapData | null>()
    enableSavedLists(() => pending.promise)
    const page = show()
    const refreshVehicles = mocked.props!.savedLists!.refreshVehicles!
    let result!: Promise<InventoryVehicle[] | null>
    act(() => { result = refreshVehicles() })
    if (changed === 'owner') mocked.context.currentUserId = 'synthetic-owner-b'
    else if (changed === 'role') mocked.context.role = 'sales'
    else mocked.context.homeStore = 'Lincoln'
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    mocked.adapt.mockClear()
    await act(async () => {
      pending.resolve(savedListBootstrap())
      expect(await result).toBeNull()
    })
    expect(mocked.adapt).not.toHaveBeenCalled()
  })

  it('does not export a saved-list snapshot without a current membership owner', async () => {
    enableSavedLists(vi.fn().mockResolvedValue(savedListBootstrap()))
    mocked.context.currentUserId = null
    show()
    expect(mocked.props!.savedLists!.enabled).toBe(false)
    mocked.adapt.mockClear()
    await act(async () => { expect(await mocked.props!.savedLists!.refreshVehicles!()).toBeNull() })
    expect(mocked.adapt).not.toHaveBeenCalled()
  })

  it('asks for 50 rows per page by default; the rows selector keeps its other choices', () => {
    show()
    expect(screen.getByTestId('page-size')).toHaveTextContent('50')
  })

  it('keeps the summary after a failed detail read and retries explicitly', async () => {
    mocked.get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(detailVehicle(first, 'First complete record'))
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('failed'))
    expect(screen.getByTestId('vehicles')).toHaveTextContent('First summary')
    fireEvent.click(screen.getByRole('button', { name: 'Retry record' }))
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('ready'))
    expect(screen.getByTestId('detail')).toHaveTextContent('First complete record')
  })

  it('cancels selection changes and ignores the late response from the previous vehicle', async () => {
    const old = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detailVehicle(second, 'Second complete record'))
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    const signal = mocked.get.mock.calls[0][3] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Second vehicle' }))
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('ready'))
    await act(async () => old.resolve(detailVehicle(first, 'Late old detail')))
    expect(screen.getByTestId('detail')).not.toHaveTextContent('Late old detail')
    expect(screen.getByTestId('detail')).toHaveTextContent('Second complete record')
  })

  it('retains full detail through a benign bootstrap replacement, overlays operations, and revalidates in the background', async () => {
    mocked.context.data = data({ serviceReadiness: { version: 1 } as VehicleRecord['serviceReadiness'] })
    mocked.get.mockResolvedValueOnce(detailVehicle(first, 'Retained full record', { privateEvidence: { primary: null, backups: [], comments: [], alerts: [] } }))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Retained full record'))
    const pending = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(pending.promise)
    mocked.context.data = data({ serviceReadiness: { version: 2 } as VehicleRecord['serviceReadiness'] })
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('detail')).toHaveTextContent('Retained full record')
    expect(screen.getByTestId('service')).toHaveTextContent('2')
    expect(screen.getByTestId('detail-state')).toHaveTextContent('refreshing')
    await act(async () => pending.resolve(detailVehicle(first, 'Newest complete record')))
    expect(screen.getByTestId('detail')).toHaveTextContent('Newest complete record')
  })

  it('ignores a detail refresh from an older bootstrap generation that finishes last', async () => {
    mocked.get.mockResolvedValueOnce(detailVehicle(first, 'Initial full record'))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Initial full record'))

    const olderRefresh = deferred<VehicleRecord>()
    const newestRefresh = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(olderRefresh.promise).mockReturnValueOnce(newestRefresh.promise)
    mocked.context.data = data({ serviceReadiness: { version: 2 } as VehicleRecord['serviceReadiness'] })
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2))
    mocked.context.data = data({ serviceReadiness: { version: 3 } as VehicleRecord['serviceReadiness'] })
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(3))

    await act(async () => newestRefresh.resolve(detailVehicle(first, 'Newest generation detail')))
    expect(screen.getByTestId('detail')).toHaveTextContent('Newest generation detail')
    expect(screen.getByTestId('detail-state')).toHaveTextContent('ready')
    await act(async () => olderRefresh.resolve(detailVehicle(first, 'Late obsolete detail')))
    expect(screen.getByTestId('detail')).toHaveTextContent('Newest generation detail')
    expect(screen.getByTestId('detail')).not.toHaveTextContent('Late obsolete detail')
    expect(screen.getByTestId('detail-state')).toHaveTextContent('ready')
  })

  it('keeps retained detail after a temporary background failure and retries explicitly', async () => {
    mocked.get.mockResolvedValueOnce(detailVehicle(first, 'Previously verified detail'))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Previously verified detail'))
    mocked.get.mockRejectedValueOnce(new Error('Temporary failure'))
    mocked.context.data = data({ serviceReadiness: { version: 2 } as VehicleRecord['serviceReadiness'] })
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('stale'))
    expect(screen.getByTestId('detail')).toHaveTextContent('Previously verified detail')
    expect(screen.getByTestId('service')).toHaveTextContent('2')
    mocked.get.mockResolvedValueOnce(detailVehicle(first, 'Recovered detail'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry record' }))
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Recovered detail'))
    expect(screen.getByTestId('detail-state')).toHaveTextContent('ready')
  })

  it('withholds cached private evidence immediately when the hold signature changes', async () => {
    mocked.get.mockResolvedValueOnce(detailVehicle(first, 'Safe retained detail', {
      searchText: 'protected old reason',
      privateEvidence: { primary: { customerOrReason: 'Protected old reason' }, backups: [], comments: [], alerts: [] },
    }))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('protected')).toHaveTextContent('Protected old reason'))
    const pending = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(pending.promise)
    mocked.context.data = data({ hold: { state: 'primary', label: 'DealerMail hold', backupCount: 0 }, searchText: 'safe current terms' })
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('detail')).toHaveTextContent('Safe retained detail')
    expect(screen.getByTestId('protected')).not.toHaveTextContent('Protected old reason')
    expect(screen.getByTestId('search')).toHaveTextContent('safe current terms')
    expect(screen.getByTestId('search')).not.toHaveTextContent('protected old reason')
    expect(screen.getByTestId('detail-state')).toHaveTextContent('refreshing')
    await act(async () => pending.resolve(detailVehicle(first, 'Updated full detail', {
      privateEvidence: { primary: { customerOrReason: 'Protected new reason' }, backups: [], comments: [], alerts: [] },
    })))
    expect(screen.getByTestId('protected')).toHaveTextContent('Protected new reason')
  })

  it('does not retain cached protected details if the access identity changes with the same data object', async () => {
    mocked.get.mockResolvedValueOnce(detailVehicle(first, 'Manager-only detail'))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Manager-only detail'))
    mocked.context.role = 'sales'
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('detail')).not.toHaveTextContent('Manager-only detail')
    expect(screen.getByTestId('selected')).toHaveTextContent(first.vin)
    expect(mocked.get).toHaveBeenLastCalledWith(first.vin, 'sales', 'Howell', expect.any(AbortSignal))
  })

  it('ignores a late protected response from an earlier access identity', async () => {
    const managerRead = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(managerRead.promise).mockResolvedValueOnce(detailVehicle(first, 'Sales-projected detail'))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    mocked.context.role = 'sales'
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Sales-projected detail'))
    await act(async () => managerRead.resolve(detailVehicle(first, 'Late manager detail', {
      privateEvidence: { primary: { customerOrReason: 'Late protected reason' }, backups: [], comments: [], alerts: [] },
    })))
    expect(screen.getByTestId('detail')).not.toHaveTextContent('Late manager detail')
    expect(screen.getByTestId('protected')).not.toHaveTextContent('Late protected reason')
  })

  it('shows fresh fordOasis evidence for a non-selected cached vehicle after a bootstrap refresh', async () => {
    mocked.context.data = data({}, {}, { fordOasis: { vehicleDescription: 'Old OASIS description' } as VehicleRecord['fordOasis'] })
    mocked.get.mockResolvedValueOnce(detailVehicle(second, 'Second detail marker', {
      fordOasis: { vehicleDescription: 'Old OASIS description' } as VehicleRecord['fordOasis'],
    }))
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'Second vehicle' }))
    await waitFor(() => expect(screen.getByTestId('oasis')).toHaveTextContent('Old OASIS description'))
    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle' }))
    mocked.context.data = data({}, {}, { fordOasis: { vehicleDescription: 'New OASIS description' } as VehicleRecord['fordOasis'] })
    page.rerender(<MemoryRouter><Navigation /><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('oasis')).toHaveTextContent('New OASIS description')
    expect(screen.getByTestId('oasis')).not.toHaveTextContent('Old OASIS description')
  })

  it('rejects a response for a different vehicle', async () => {
    mocked.get.mockResolvedValueOnce(detailVehicle(second, 'Unexpected record'))
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('failed'))
    expect(screen.getByTestId('detail')).not.toHaveTextContent('Unexpected record')
  })

  it('restores a navigation-provided search after leaving and reopening inventory', async () => {
    const page = show('/inventory?q=Synthetic+customer+request')
    await waitFor(() => expect(screen.getByTestId('query')).toHaveTextContent('Synthetic customer request'))
    page.unmount()
    show()
    expect(screen.getByTestId('query')).toHaveTextContent('Synthetic customer request')
  })

  it('uses browser Back and Forward to move between the inventory list and selected vehicle', async () => {
    show('/inventory?scope=group')
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`/inventory?scope=group&vin=${first.vin}`)
    expect(screen.getByTestId('selected')).toHaveTextContent(first.vin)
    const signal = mocked.get.mock.calls[0][3] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    expect(signal.aborted).toBe(true)
    expect(screen.getByTestId('location')).toHaveTextContent('/inventory?scope=group')
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
    expect(screen.getByTestId('selected')).toHaveTextContent(first.vin)
    expect(screen.getByTestId('scope')).toHaveTextContent('group')
  })

  it('replaces consecutive vehicle selections and closes without stale detail history or memory', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second vehicle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
    expect(screen.getByTestId('selected')).toHaveTextContent(second.vin)
    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    expect(screen.getByTestId('location')).not.toHaveTextContent('vin=')
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    fireEvent.click(screen.getByRole('button', { name: 'Inventory list' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
  })

  it('honors a deep-linked origin and clears its vehicle when returning to that workspace', () => {
    show(`/inventory?scope=group&vin=${first.vin}&tab=movement&returnTo=${encodeURIComponent('/attention?category=movement')}`)
    expect(screen.getByTestId('selected')).toHaveTextContent(first.vin)
    expect(screen.getByTestId('return-label')).toHaveTextContent('Back to Action center')
    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/attention?category=movement')
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
  })

  it('keeps the home route and remembered private search while making scope and selection navigable', async () => {
    show('/?q=Synthetic+customer+request', true)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    fireEvent.click(screen.getByRole('button', { name: 'Group inventory' }))
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`/?scope=group&vin=${first.vin}`)
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('query')).toHaveTextContent('Synthetic customer request')
    expect(screen.getByTestId('scope')).toHaveTextContent('group')
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
  })

  it('never fetches a URL vehicle that the current authorized projection does not contain', () => {
    show('/inventory?vin=UNAVAILABLE000001')
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    expect(mocked.get).not.toHaveBeenCalled()
    expect(screen.getByText(/This vehicle record is unavailable in your current inventory/)).toBeInTheDocument()
  })

  it('keeps an all-locations scope change made in the same event as selecting a predictive search result', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Open other-location result' }))
    expect(screen.getByTestId('scope')).toHaveTextContent('group')
    expect(screen.getByTestId('selected')).toHaveTextContent(second.vin)
    expect(screen.getByTestId('location')).toHaveTextContent('scope=group')
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    expect(screen.getByTestId('scope')).toHaveTextContent('group')
  })

  it('reads an Overview count link once, strips it from the URL, and keeps Back on the Overview', () => {
    render(<MemoryRouter initialEntries={['/overview', '/inventory?scope=group&store=Howell&view=away']} initialIndex={1}><Navigation /><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/inventory\?scope=group$/)
    expect(JSON.parse(screen.getByTestId('initial-filters').textContent!)).toEqual({ overviewView: { view: 'away', store: 'Howell' } })
    expect(screen.getByTestId('quick-view')).toHaveTextContent('all')
    expect(screen.getByTestId('query')).toHaveTextContent('')
    expect(screen.getByTestId('scope')).toHaveTextContent('group')
    const request = screen.getByTestId('filter-request').textContent
    expect(request).not.toBe('initial')

    // Returning to Inventory keeps the same request (and so its chip) until cleared.
    fireEvent.click(screen.getByRole('button', { name: 'Inventory list' }))
    expect(screen.getByTestId('filter-request')).toHaveTextContent(request!)
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/overview$/)
  })

  it('opens an exception VIN list and ignores unknown Overview values', () => {
    show('/inventory?scope=group&vins=TESTDATAHWELL0001,not+a+vin&view=everything&store=Nowhere')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/inventory\?scope=group$/)
    expect(JSON.parse(screen.getByTestId('initial-filters').textContent!)).toEqual({ vins: ['TESTDATAHWELL0001'] })
  })
})
