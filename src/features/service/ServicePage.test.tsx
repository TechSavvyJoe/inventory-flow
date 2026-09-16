import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ServicePage } from './ServicePage'
import { ApiError } from '../../lib/api'
import type { ServiceReadinessDetail, ServiceReadinessStatus, StoreName, VehicleRecord } from '../../types'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, get: vi.fn(), update: vi.fn(), refresh: vi.fn() }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), getServiceReadiness: mocked.get, updateServiceReadiness: mocked.update }))
afterEach(cleanup)

function record(status: ServiceReadinessStatus = 'unknown', store: StoreName = 'Howell', suffix = '001'): VehicleRecord {
  return { vin: `TESTDATAHWELL${suffix.padStart(4, '0')}`, stockNumber: `SYNTHETIC-${suffix}`, vehicleName: `Synthetic Ford ${suffix}`, homeStore: store, publicStore: store,
    serviceReadiness: { vin: `TESTDATAHWELL${suffix.padStart(4, '0')}`, status, version: 0, serviceEnteredAt: null, completedAt: null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store, canManage: true },
  } as VehicleRecord
}
function detail(status: ServiceReadinessStatus = 'unknown', overrides: Partial<ServiceReadinessDetail> = {}): ServiceReadinessDetail {
  return { ...record(status).serviceReadiness!, history: [], notes: null, ...overrides }
}
function show(path = '/service') { return render(<MemoryRouter initialEntries={[path]}><ServicePage /></MemoryRouter>) }
beforeEach(() => {
  vi.clearAllMocks()
  mocked.context = { data: { meta: { reportDate: '2026-08-30' }, vehicles: [record(), record('needs_service', 'Howell', '002'), record('serviced', 'Lincoln', '003')] }, homeStore: 'Howell', role: 'manager', refresh: mocked.refresh }
  mocked.get.mockResolvedValue(detail())
  mocked.refresh.mockResolvedValue(undefined)
})

describe('Service readiness workspace', () => {
  it('puts direct service actions before secondary facts, with links instead of full provider panels', async () => {
    const { container } = show('/service?vin=TESTDATAHWELL0001')
    const actions = await screen.findByRole('group', { name: 'Service actions' })
    const facts = screen.getByLabelText('Service decision facts')
    expect(actions.compareDocumentPosition(facts)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('link', { name: 'Vehicle details' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0001')
    expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0001')
    expect(container.querySelector('.workflow-resource-row')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Saved Ford service actions' })).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('shows only actually saved Ford service actions and never treats them as a service-status update', async () => {
    const vehicle = record('in_service')
    vehicle.fordOasis = { openFieldServiceActions: [{ code: 'SYN-24', description: 'Synthetic action' }] }
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    mocked.get.mockResolvedValue(detail('in_service'))
    show('/service?vin=TESTDATAHWELL0001')
    const source = await screen.findByRole('region', { name: 'Saved Ford service actions' })
    expect(source).toHaveTextContent('OASIS: 1 open service action in saved report')
    expect(source).toHaveTextContent('SYN-24')
    expect(screen.getByRole('link', { name: 'Review service actions in Records' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0001')
    expect(screen.getByText('Current state')).toHaveTextContent('In service')
    expect(mocked.update).not.toHaveBeenCalled()
  })
  it('opens the VDP start-service link as a confirmation without saving automatically', async () => {
    mocked.get.mockResolvedValue(detail('needs_service'))
    show('/service?vin=TESTDATAHWELL0001&action=in_service')
    expect(await screen.findByLabelText('Date entered service')).toHaveValue('2026-08-30')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('does not manufacture a completion date for an explicit Ready record', async () => {
    mocked.get.mockResolvedValue(detail('serviced'))
    show('/service?vin=TESTDATAHWELL0001')
    expect(await screen.findByText('Ready is recorded. No completion date is available.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Date service completed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record service completion' }))
    expect(screen.getByLabelText('Date service completed')).toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })
  it('shows exactly three states, puts legacy review in waiting, and starts in the employee store', () => {
    show()
    expect(screen.getByText('Synthetic Ford 001')).toBeInTheDocument()
    expect(screen.getByText('Synthetic Ford 002')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Waiting for service 2' }))
    expect(screen.getByText('Synthetic Ford 002')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ready 1' }))
    expect(screen.getByText('Synthetic Ford 003')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Ford 001')).not.toBeInTheDocument()
  })

  it('saves a manager completion with its date and current version, then refreshes the list', async () => {
    mocked.get.mockResolvedValue(detail('in_service', { version: 2, serviceEnteredAt: '2026-08-28' }))
    mocked.update.mockResolvedValue(detail('serviced', { version: 3, serviceEnteredAt: '2026-08-28', completedAt: '2026-08-30' }))
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Ready' }))
    fireEvent.change(screen.getByLabelText('Date service completed'), { target: { value: '2026-08-30' } })
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'Synthetic work finished' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save service status' }))
    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith('TESTDATAHWELL0001', { status: 'serviced', expectedVersion: 2, serviceDate: '2026-08-30', notes: 'Synthetic work finished' }, 'manager', 'Howell'))
    expect(await screen.findByText('Ready saved for SYNTHETIC-001.')).toBeInTheDocument()
    expect(mocked.refresh).toHaveBeenCalledOnce()
  })

  it('shows a conflict, reloads the other manager’s version, and waits for a new deliberate save', async () => {
    mocked.get.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail('in_service', { version: 1, serviceEnteredAt: '2026-08-29' }))
    mocked.update.mockRejectedValue(new ApiError('Another manager updated this vehicle. Review the latest status and save again.', 409))
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save service status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another manager updated this vehicle')
    await waitFor(() => expect(screen.getByText('Current state')).toHaveTextContent('In service'))
    expect(mocked.update).toHaveBeenCalledOnce()
    expect(mocked.refresh).not.toHaveBeenCalled()
  })

  it('shows read-only status without update controls when the server denies management', async () => {
    mocked.context.role = 'sales'
    mocked.get.mockResolvedValue(detail('needs_service', { canManage: false }))
    show('/service?vin=TESTDATAHWELL0001')
    expect(await screen.findByText('A Howell manager can update this vehicle’s service status.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save service status' })).not.toBeInTheDocument()
  })

  it('preserves a draft when bootstrap announces a newer version and requires an explicit reload before saving', async () => {
    mocked.get.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail('in_service', {
      version: 1, serviceEnteredAt: '2026-08-29', notes: 'Another manager started service',
    }))
    const page = show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Ready' }))
    fireEvent.change(screen.getByLabelText('Date service completed'), { target: { value: '2026-08-30' } })
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'My unsaved work note' } })
    const refreshed = record('in_service')
    refreshed.serviceReadiness = { ...refreshed.serviceReadiness!, version: 1, serviceEnteredAt: '2026-08-29' }
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [refreshed] }
    page.rerender(<MemoryRouter initialEntries={['/service?vin=TESTDATAHWELL0001']}><ServicePage /></MemoryRouter>)

    expect(screen.getByText(/A newer service update is available/)).toHaveTextContent('Loading the latest status will replace them.')
    expect(screen.getByRole('heading', { name: 'Confirm Ready' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date service completed')).toHaveValue('2026-08-30')
    expect(screen.getByLabelText(/Service note/)).toHaveValue('My unsaved work note')
    const save = screen.getByRole('button', { name: 'Save service status' })
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(mocked.update).not.toHaveBeenCalled()
    expect(mocked.get).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Load latest status' }))
    await waitFor(() => expect(screen.getByText('Current state')).toHaveTextContent('In service'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    expect(screen.getByLabelText('Date entered service')).toHaveValue('2026-08-29')
    expect(screen.getByLabelText(/Service note/)).toHaveValue('Another manager started service')
    expect(screen.queryByText(/A newer service update is available/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save service status' })).toBeEnabled()
    expect(mocked.update).not.toHaveBeenCalled()
  })
})
