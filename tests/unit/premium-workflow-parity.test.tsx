import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ServicePage } from '../../src/features/service/ServicePage'
import { VehicleWorkspace } from '../../src/features/inventory/VehicleWorkspace'
import { InventoryTable } from '../../src/features/inventory/InventoryTable'
import { CustomerShortlistDrawer } from '../../src/features/inventory/CustomerShortlistDrawer'
import { clearCustomerShortlist, useCustomerShortlist } from '../../src/features/inventory/useCustomerShortlist'
import { ApiError } from '../../src/lib/api'
import { createMockVehicle } from './testHelpers'
import type { ServiceReadinessDetail, ServiceReadinessStatus, VehicleRecord } from '../../src/types'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, get: vi.fn(), update: vi.fn(), refresh: vi.fn() }))
vi.mock('../../src/app/AppDataContext', () => ({ useAppData: () => mocked.context }))
vi.mock('../../src/lib/api', async original => ({ ...await original<typeof import('../../src/lib/api')>(), getServiceReadiness: mocked.get, updateServiceReadiness: mocked.update }))

const VIN = 'TESTDATAHWELL0001'
function record(status: ServiceReadinessStatus = 'needs_service', canManage = true): VehicleRecord {
  return { vin: VIN, stockNumber: 'SYNTHETIC-001', vehicleName: 'Synthetic Ford One', homeStore: 'Howell', publicStore: 'Howell',
    serviceReadiness: { vin: VIN, status, version: 1, serviceEnteredAt: null, completedAt: null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage },
  } as VehicleRecord
}
function detail(status: ServiceReadinessStatus = 'needs_service', extra: Partial<ServiceReadinessDetail> = {}): ServiceReadinessDetail {
  return { ...record(status).serviceReadiness!, notes: null, history: [], ...extra }
}
function service(path = '/service') {
  return <MemoryRouter initialEntries={[path]}><ServicePage /></MemoryRouter>
}
beforeEach(() => {
  vi.clearAllMocks()
  clearCustomerShortlist()
  mocked.context = { data: { meta: { reportDate: '2026-08-30' }, vehicles: [record()] }, homeStore: 'Howell', role: 'manager', refresh: mocked.refresh }
  mocked.get.mockResolvedValue(detail())
  mocked.refresh.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); clearCustomerShortlist(); vi.restoreAllMocks() })

describe('Service uses the manager-led service workflow', () => {
  it('opens a deliberate confirmation and renders only confirmed server state after later changes', async () => {
    mocked.update.mockResolvedValue(detail('in_service', { version: 2, serviceEnteredAt: '2026-08-30' }))
    const page = render(service(`/service?vin=${VIN}&action=in_service`))
    expect(await screen.findByLabelText('Date entered service')).toHaveValue('2026-08-30')
    expect(mocked.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save service status' }))
    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith(VIN, expect.objectContaining({ status: 'in_service', expectedVersion: 1, serviceDate: '2026-08-30' }), 'manager', 'Howell'))
    expect(await screen.findByText('In service saved for SYNTHETIC-001.')).toBeInTheDocument()
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [record('in_service')] }
    page.rerender(service())
    fireEvent.click(screen.getByRole('button', { name: 'Back to service list' }))
    expect(screen.getByRole('button', { name: 'In service 1' })).toBeInTheDocument()
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [record('needs_service')] }
    page.rerender(service())
    expect(screen.getByRole('button', { name: 'In service 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waiting for service 1' })).toBeInTheDocument()
  })

  it('keeps denied service access read-only even when the URL requests Mark Ready', async () => {
    mocked.context.role = 'sales'
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [record('needs_service', false)] }
    mocked.get.mockResolvedValue(detail('needs_service', { canManage: false }))
    render(service(`/service?vin=${VIN}&action=serviced`))
    expect(await screen.findByText('A Howell manager can update this vehicle’s service status.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save service status' })).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('retains vehicle references and retry when service detail cannot load', async () => {
    mocked.get.mockRejectedValueOnce(new Error('Service is temporarily unavailable.')).mockResolvedValue(detail())
    render(service(`/service?vin=${VIN}`))
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    expect(screen.getByRole('link', { name: 'Records' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('group', { name: 'Service actions' })).toBeInTheDocument()
  })

  it('requires review after a version conflict without retrying a write automatically', async () => {
    mocked.get.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail('in_service', { version: 2 }))
    mocked.update.mockRejectedValue(new ApiError('Another manager updated this vehicle.', 409))
    render(service(`/service?vin=${VIN}&action=serviced`))
    fireEvent.click(await screen.findByRole('button', { name: 'Save service status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another manager')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Recorded service status' })).toHaveTextContent('In service'))
    expect(mocked.update).toHaveBeenCalledOnce()
  })
})

describe('Premium inventory preserves source qualifications and actions', () => {
  it('never represents unverified or no observed holds as availability', () => {
    const vehicle = createMockVehicle({ vin: VIN, id: VIN, dealerMail: { dataState: 'stale', hasActiveHold: false, activeRecordCount: 0, canViewEvidence: false, canManageHold: false } })
    const page = render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />)
    expect(screen.getByText('Hold status unverified')).toBeInTheDocument()
    expect(screen.queryByText(/^Available$/)).not.toBeInTheDocument()
    page.rerender(<InventoryTable vehicles={[{ ...vehicle, dealerMail: { ...vehicle.dealerMail, dataState: 'current' } }]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()} />)
    expect(screen.getByText('No current hold').closest('button')).toHaveAttribute('title', 'Availability still requires confirmation')
    expect(screen.queryByText(/^Available$/)).not.toBeInTheDocument()
  })

  it('passes authorized direct-move intent through the shared row actions', () => {
    const vehicle = createMockVehicle({ id: VIN, vin: VIN })
    const move = vi.fn()
    render(<InventoryTable vehicles={[vehicle]} sorts={[]} onSortChange={vi.fn()} onSelectVehicle={vi.fn()}
      moveActionFor={() => ({ intent: 'direct', label: 'Move vehicle', shortLabel: 'Move' })} onMoveVehicle={move} />)
    fireEvent.click(screen.getByRole('button', { name: /^Move vehicle / }))
    expect(move).toHaveBeenCalledWith(vehicle, 'direct')
  })

  it('uses real service links instead of local completion buttons in vehicle details', () => {
    const vehicle = createMockVehicle({ id: VIN, vin: VIN, serviceReadiness: { ...record().serviceReadiness!, canManage: true } })
    render(<MemoryRouter><VehicleWorkspace vehicle={vehicle} homeStore={{ id: 'howell', name: 'Howell' }} onClose={vi.fn()} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /^Mark Ready$/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Ready for delivery')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /service/i }).length).toBeGreaterThan(0)
    expect(mocked.update).not.toHaveBeenCalled()
  })
})

describe('Shortlist belongs only to the current authenticated context', () => {
  it('does not restore stored snapshots and clears immediately across identities', () => {
    const vehicle = createMockVehicle({ id: VIN, vin: VIN })
    localStorage.setItem('inventory:customer-shortlist', JSON.stringify([{ id: 'PRIVATE-OLD-ENTRY' }]))
    const saved = vi.spyOn(Storage.prototype, 'setItem')
    const hook = renderHook(({ context }) => useCustomerShortlist(context, [vehicle]), { initialProps: { context: 'manager:Howell:alice' } })
    expect(hook.result.current.count).toBe(0)
    act(() => hook.result.current.add(vehicle))
    expect(hook.result.current.count).toBe(1)
    const oldAdd = hook.result.current.add
    hook.rerender({ context: 'sales:Howell:bob' })
    expect(hook.result.current.count).toBe(0)
    act(() => oldAdd(vehicle))
    expect(hook.result.current.count).toBe(0)
    expect(saved).not.toHaveBeenCalled()
  })

  it('updates displayed prices and prunes vehicles removed from authorized inventory', () => {
    const vehicle = createMockVehicle({ id: VIN, vin: VIN, price: 20000 })
    const hook = renderHook(({ vehicles }) => useCustomerShortlist('manager:Howell:alice', vehicles), { initialProps: { vehicles: [vehicle] } })
    act(() => hook.result.current.add(vehicle))
    hook.rerender({ vehicles: [{ ...vehicle, price: 21000 }] })
    expect(hook.result.current.entries[0].price).toBe(21000)
    hook.rerender({ vehicles: [] })
    expect(hook.result.current.entries).toEqual([])
  })

  it('makes compare cards keyboard-operable buttons with qualified context', () => {
    const open = vi.fn()
    render(<CustomerShortlistDrawer entries={[{ id: VIN, vin: VIN, stockNumber: 'SYNTHETIC-001', displayName: 'Synthetic Ford', price: 20000, imageUrl: null, exteriorColor: 'Blue', addedAt: 0 }]} onSelectVehicle={open} onRemove={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Saved vehicles:/ }))
    const region = screen.getByRole('region', { name: 'Saved vehicles 1' })
    expect(region).toHaveTextContent('Confirm availability with the home store')
    const opener = within(region).getByRole('button', { name: /^Open shortlisted/ })
    opener.focus()
    expect(opener).toHaveFocus()
    fireEvent.click(opener)
    expect(open).toHaveBeenCalledWith({ id: VIN }, opener)
  })
})
