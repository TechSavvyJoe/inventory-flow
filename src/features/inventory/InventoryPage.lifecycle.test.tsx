import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapData, VehicleRecord } from '../../types'
import type { InventoryExperienceProps } from './types'
import { InventoryPage } from './InventoryPage'
import { clearWorkspaceMemory } from '../../lib/workspace-memory'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, get: vi.fn() }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getVehicle: mocked.get }))
vi.mock('../../components/SourceWarning', () => ({ SourceWarning: () => null }))
vi.mock('../../app/adapters', () => ({
  inventoryMetrics: () => ({}), groupStores: () => [], inventoryStore: () => ({ id: 'howell', name: 'Howell' }),
  toInventoryVehicle: (vehicle: VehicleRecord) => ({ id: vehicle.vin, vin: vehicle.vin, vehicleName: vehicle.vehicleName }),
}))
vi.mock('./InventoryExperience', () => ({ InventoryExperience: (props: InventoryExperienceProps) => <>
  <output data-testid="vehicles">{props.vehicles.map(vehicle => vehicle.vehicleName).join(',')}</output>
  <output data-testid="selected">{props.selectedVehicleId ?? 'none'}</output>
  <output data-testid="detail-state">{props.detailState}</output>
  <output data-testid="query">{props.initialQuery}</output>
  <output data-testid="scope">{props.scope}</output>
  <output data-testid="return-label">{props.returnLabel}</output>
  <button onClick={() => props.onSelectedVehicleChange?.(props.vehicles[0].id)}>First vehicle</button>
  <button onClick={() => props.onSelectedVehicleChange?.(props.vehicles[1].id)}>Second vehicle</button>
  <button onClick={props.onRetryDetail}>Retry record</button>
  <button onClick={() => props.onSelectedVehicleChange?.(null)}>Close vehicle</button>
  <button onClick={() => props.onScopeChange?.('group')}>Group inventory</button>
  <button onClick={() => { props.onScopeChange?.('group'); props.onSelectedVehicleChange?.(props.vehicles[1].id) }}>Open other-location result</button>
</> }))

function vehicle(suffix: string, name: string): VehicleRecord { return { vin: `TESTDATAVEHICLE${suffix}`, vehicleName: name } as VehicleRecord }
const first = vehicle('001', 'First summary')
const second = vehicle('002', 'Second summary')
function data(): BootstrapData { return { vehicles: [first, second], transfers: [] } as unknown as BootstrapData }
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
  mocked.context = { data: data(), role: 'manager', homeStore: 'Howell', currentUser: 'Synthetic Employee' }
})
afterEach(cleanup)

describe('inventory detail and navigation lifecycle', () => {
  it('keeps the summary after a failed detail read and retries explicitly', async () => {
    mocked.get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ...first, vehicleName: 'First complete record' })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('failed'))
    expect(screen.getByTestId('vehicles')).toHaveTextContent('First summary')
    fireEvent.click(screen.getByRole('button', { name: 'Retry record' }))
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('ready'))
    expect(screen.getByTestId('vehicles')).toHaveTextContent('First complete record')
  })

  it('cancels selection changes and ignores the late response from the previous vehicle', async () => {
    const old = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...second, vehicleName: 'Second complete record' })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    const signal = mocked.get.mock.calls[0][3] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Second vehicle' }))
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('ready'))
    await act(async () => old.resolve({ ...first, vehicleName: 'Late old detail' }))
    expect(screen.getByTestId('vehicles')).not.toHaveTextContent('Late old detail')
    expect(screen.getByTestId('vehicles')).toHaveTextContent('Second complete record')
  })

  it('discards detail cache when a newer bootstrap replaces the inventory projection', async () => {
    mocked.get.mockResolvedValueOnce({ ...first, vehicleName: 'Older full record' })
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('vehicles')).toHaveTextContent('Older full record'))
    const pending = deferred<VehicleRecord>()
    mocked.get.mockReturnValueOnce(pending.promise)
    mocked.context.data = data()
    page.rerender(<MemoryRouter><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('vehicles')).toHaveTextContent('First summary')
    expect(screen.getByTestId('vehicles')).not.toHaveTextContent('Older full record')
    await act(async () => pending.resolve({ ...first, vehicleName: 'Newest complete record' }))
    expect(screen.getByTestId('vehicles')).toHaveTextContent('Newest complete record')
  })

  it('does not retain cached protected details if the access identity changes with the same data object', async () => {
    mocked.get.mockResolvedValueOnce({ ...first, vehicleName: 'Manager-only detail' })
    const page = show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('vehicles')).toHaveTextContent('Manager-only detail'))
    mocked.context.role = 'sales'
    page.rerender(<MemoryRouter><InventoryPage /></MemoryRouter>)
    expect(screen.getByTestId('vehicles')).not.toHaveTextContent('Manager-only detail')
    expect(screen.getByTestId('selected')).toHaveTextContent(first.vin)
    expect(mocked.get).toHaveBeenLastCalledWith(first.vin, 'sales', 'Howell', expect.any(AbortSignal))
  })

  it('rejects a response for a different vehicle', async () => {
    mocked.get.mockResolvedValueOnce({ ...second, vehicleName: 'Unexpected record' })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'First vehicle' }))
    await waitFor(() => expect(screen.getByTestId('detail-state')).toHaveTextContent('failed'))
    expect(screen.getByTestId('vehicles')).not.toHaveTextContent('Unexpected record')
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
})
