import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ServicePage } from './ServicePage'
import { clearWorkspaceMemory } from '../../lib/workspace-memory'
import { ApiError } from '../../lib/api'
import type { ServiceReadinessDetail, ServiceReadinessStatus, StoreName, VehicleRecord } from '../../types'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, get: vi.fn(), update: vi.fn(), refresh: vi.fn() }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), getServiceReadiness: mocked.get, updateServiceReadiness: mocked.update }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
  clearWorkspaceMemory()
  vi.clearAllMocks()
  mocked.context = { data: { meta: { reportDate: '2026-08-30' }, vehicles: [record(), record('needs_service', 'Howell', '002'), record('serviced', 'Lincoln', '003')] }, homeStore: 'Howell', role: 'manager', refresh: mocked.refresh }
  mocked.get.mockResolvedValue(detail())
  mocked.refresh.mockResolvedValue(undefined)
})

describe('Service readiness workspace', () => {
  it('opens a group service total across all stores even from the default home-store scope', async () => {
    show('/service?status=serviced&scope=all')
    await waitFor(() => expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('link', { name: 'Open vehicle for Synthetic Ford 003' })).toBeInTheDocument()
  })
  it('focuses vehicle context and keeps saved status and dates in one summary', async () => {
    mocked.get.mockResolvedValue(detail('serviced', { serviceEnteredAt: '2026-08-28', completedAt: '2026-08-30' }))
    show('/service?vin=TESTDATAHWELL0001')
    const summary = await screen.findByRole('region', { name: 'Recorded service status' })
    expect(screen.getByRole('heading', { name: 'Synthetic Ford 001' })).toHaveFocus()
    expect(screen.getByRole('complementary', { name: 'Service for Synthetic Ford 001' })).not.toHaveAttribute('tabindex')
    expect(summary).toHaveTextContent('Current stateReady')
    expect(summary).toHaveTextContent('Entered service08/28/2026')
    expect(summary).toHaveTextContent('Completed08/30/2026')
    expect(screen.getByLabelText('Vehicle identification')).toHaveTextContent('StockSYNTHETIC-001')
    expect(mocked.update).not.toHaveBeenCalled()
    const current = screen.getByRole('button', { name: 'Ready' })
    expect(current).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(current)
    expect(screen.queryByRole('heading', { name: 'Confirm Ready' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'In service' }))
    expect(screen.getByRole('heading', { name: 'Start service' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date entered service')).toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('opens the shared photo viewer without losing a service draft', async () => {
    const vehicle = record()
    vehicle.imageUrls = ['/demo-vehicles/truck.webp', '/demo-vehicles/suv.webp']
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    show('/service?vin=TESTDATAHWELL0001&action=in_service')
    const note = await screen.findByLabelText(/Service note/)
    fireEvent.change(note, { target: { value: 'Inspect brakes' } })
    const opener = screen.getByRole('button', { name: 'Open photo gallery for Synthetic Ford 001' })
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Synthetic Ford 001 photo gallery' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByText(/Photo 2 of 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('button', { name: 'Reset photo zoom' })).toHaveTextContent('150%')
    fireEvent.click(screen.getByRole('button', { name: 'Close photo gallery' }))
    expect(note).toHaveValue('Inspect brakes')
    expect(opener).toHaveFocus()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('keeps service reference and configuration available when the service endpoint fails', async () => {
    const vehicle = record()
    Object.assign(vehicle, { engine: '3.5L EcoBoost V6', drivetrain: '4WD', transmission: '10-Speed Automatic', exteriorColor: 'Antimatter Blue Metallic', fordOasis: { openActionsCaptured: true, dataState: 'current', warrantyStartDate: '2024-03-14', buildDate: '2024-01-15', openFieldServiceActions: [{ code: 'SYN-24', description: 'Inspect connection' }] } })
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    mocked.get.mockRejectedValue(new Error('Service status unavailable'))
    show('/service?vin=TESTDATAHWELL0001')
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Vehicle configuration')).toHaveTextContent('3.5L EcoBoost V6 · 4WD')
    const reference = screen.getByRole('region', { name: 'Service reference' })
    expect(reference).toHaveTextContent('03/14/2024')
    expect(reference).toHaveTextContent('01/15/2024')
    expect(reference).toHaveTextContent('SYN-24 · Inspect connection')
    expect(screen.queryByRole('button', { name: /Open photo gallery/ })).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('shows Canadian coverage distances in miles while retaining the captured kilometre evidence', async () => {
    const vehicle = record()
    Object.assign(vehicle, { fordOasis: { openActionsCaptured: true, dataState: 'current', warrantyCoverages: [{ type: 'Powertrain', description: '60 months / 100,000 km' }], extendedCoverageExpirations: ['Ends at 120,000 km'] } })
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    show('/service?vin=TESTDATAHWELL0001')
    const reference = await screen.findByRole('region', { name: 'Service reference' })
    expect(reference).toHaveTextContent('62,137 mi')
    expect(reference).toHaveTextContent('100,000 km')
    expect(reference).toHaveTextContent('74,565 mi')
    expect(reference).toHaveTextContent('120,000 km')
  })

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

  it('keeps the vehicle references readable when service detail fails to load', async () => {
    mocked.get.mockRejectedValue(new Error('Service status is unavailable.'))
    show('/service?vin=TESTDATAHWELL0001')
    expect(await screen.findByRole('alert')).toHaveTextContent('Service status is unavailable.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Service for Synthetic Ford 001' }).querySelector('.service-editor-heading')).toHaveTextContent('Howell')
    expect(screen.getByLabelText('Service decision facts')).not.toHaveTextContent('Store')
    expect(screen.getByRole('button', { name: 'Copy VIN: TESTDATAHWELL0001' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy VIN: TESTDATAHWELL0001' }).closest('.service-editor-heading')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy stock number: SYNTHETIC-001' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Vehicle details' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0001')
    expect(screen.getByRole('link', { name: 'Records' })).toBeInTheDocument()
    expect(screen.queryByText('Current state')).not.toBeInTheDocument()
  })

  it('shows only actually saved Ford service actions and never treats them as a service-status update', async () => {
    const vehicle = record('in_service')
    vehicle.fordOasis = { openFieldServiceActions: [{ code: 'SYN-24', description: 'Synthetic action' }] }
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    mocked.get.mockResolvedValue(detail('in_service'))
    show('/service?vin=TESTDATAHWELL0001')
    const source = await screen.findByRole('region', { name: 'Saved Ford service actions' })
    expect(source).toHaveTextContent('OASIS · At least 1 open service action · result incomplete')
    expect(source).toHaveTextContent('SYN-24 · Synthetic action')
    expect(source).toHaveTextContent('SYN-24')
    expect(screen.getByRole('link', { name: 'Review service actions in Records' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Fservice%3Fvin%3DTESTDATAHWELL0001')
    expect(screen.getByText('Current state').parentElement).toHaveTextContent('In service')
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
    fireEvent.click(screen.getByRole('button', { name: 'Record completion' }))
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

  it('adds explicit vehicle, records, and manager service actions without nesting controls in the row button', () => {
    const { container } = show('/service?status=needs_service')
    const row = screen.getByRole('button', { name: /^Synthetic Ford 002Stock/ })
    const actions = screen.getByRole('navigation', { name: 'Actions for Synthetic Ford 002' })
    expect(row).toHaveAttribute('aria-pressed', 'false')
    expect(row.contains(actions)).toBe(false)
    expect(actions).toBe(row.nextElementSibling)
    expect(screen.getByRole('link', { name: 'Open vehicle for Synthetic Ford 002' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0002&returnTo=%2Fservice%3Fstatus%3Dneeds_service')
    expect(screen.getByRole('link', { name: 'Records for Synthetic Ford 002' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0002&tab=data&returnTo=%2Fservice%3Fstatus%3Dneeds_service')
    expect(screen.getByRole('button', { name: 'Update service for Synthetic Ford 002' })).toBeInTheDocument()
    expect(container.querySelector('.service-vehicle-row a, .service-vehicle-row button')).toBeNull()
  })

  it.each(['Open vehicle', 'Records'])('preserves the active store filter in the %s return path', async (action) => {
    show('/service?status=serviced&store=Lincoln')
    const link = await screen.findByRole('link', { name: `${action} for Synthetic Ford 003` })
    await waitFor(() => {
      const url = new URL(link.getAttribute('href')!, 'https://inventory.invalid')
      expect(url.searchParams.get('returnTo')).toBe('/service?status=serviced&store=Lincoln')
    })
  })

  it('opens service from the row action while preserving the current list state', async () => {
    show('/service?status=needs_service')
    fireEvent.click(screen.getByRole('button', { name: 'Update service for Synthetic Ford 002' }))
    expect(await screen.findByRole('complementary', { name: 'Service for Synthetic Ford 002' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Synthetic Ford 002Stock/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps an unsaved service draft when a different row action is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    show('/service?status=needs_service&vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'Finish inspection before changing vehicles' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update service for Synthetic Ford 002' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByRole('complementary', { name: 'Service for Synthetic Ford 001' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Service note/)).toHaveValue('Finish inspection before changing vehicles')
  })

  it('shows read-only service actions when the server projection denies management', () => {
    const vehicle = record('needs_service', 'Howell', '002')
    vehicle.serviceReadiness = { ...vehicle.serviceReadiness!, canManage: false }
    mocked.context.role = 'sales'
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    show('/service?status=needs_service')
    expect(screen.getByRole('button', { name: 'View service for Synthetic Ford 002' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update service for Synthetic Ford 002' })).not.toBeInTheDocument()
  })

  it('opens an Overview store count on that service store once, then lets the list widen again', async () => {
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [record('serviced', 'Howell', '001'), record('serviced', 'Lincoln', '003'), record('serviced', 'Fowlerville', '004')] }
    show('/service?status=serviced&store=Lincoln')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear service store filter: Lincoln' })).toBeInTheDocument())
    expect(screen.getByText('Synthetic Ford 003')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Ford 001')).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic Ford 004')).not.toBeInTheDocument()
    expect(screen.getByText('1 vehicle · Lincoln')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear service store filter: Lincoln' }))
    expect(screen.getByText('Synthetic Ford 001')).toBeInTheDocument()
    expect(screen.getByText('Synthetic Ford 004')).toBeInTheDocument()
  })

  it('matches service search terms across separate authorized fields and clears the search', () => {
    show()
    const search = screen.getByRole('searchbox', { name: 'Search service vehicles' })
    fireEvent.change(search, { target: { value: 'Ford SYNTHETIC-002' } })
    expect(screen.getAllByText('Synthetic Ford 002')).toHaveLength(2)
    expect(screen.queryByText('Synthetic Ford 001')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear service search' }))
    expect(search).toHaveValue('')
    fireEvent.change(search, { target: { value: 'Ford' } })
    expect(screen.getByRole('listbox', { name: 'Search service vehicles suggestions' })).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(search).toHaveValue('SYNTHETIC-001')
    expect(screen.queryByRole('listbox', { name: 'Search service vehicles suggestions' })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'Ford' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Search service vehicles suggestions' })).not.toBeInTheDocument()
  })

  it('shows one truthful list no-results state with a clear action', () => {
    show()
    const search = screen.getByRole('searchbox', { name: 'Search service vehicles' })
    fireEvent.change(search, { target: { value: 'no such vehicle' } })
    expect(screen.getByRole('heading', { name: 'No matching vehicles' })).toBeInTheDocument()
    expect(screen.queryByText('No vehicles waiting for service')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(screen.getByText('Synthetic Ford 001')).toBeInTheDocument()
  })

  it('offers no List/Board view switch now that the board is retired', () => {
    show('/service?view=board')
    expect(screen.queryByRole('group', { name: 'Service view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Board' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Service status' })).toBeInTheDocument()
  })

  it('saves a manager completion with its date and current version, then refreshes the list', async () => {
    mocked.get.mockResolvedValue(detail('in_service', { version: 2, serviceEnteredAt: '2026-08-28' }))
    mocked.update.mockResolvedValue(detail('serviced', { version: 3, serviceEnteredAt: '2026-08-28', completedAt: '2026-08-30' }))
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Ready' }))
    fireEvent.change(screen.getByLabelText('Date service completed'), { target: { value: '2026-08-30' } })
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'Synthetic work finished' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save service status' }))
    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith('TESTDATAHWELL0001', { status: 'serviced', expectedVersion: 2, serviceDate: '2026-08-30', notes: 'Synthetic work finished' }, 'manager', 'Howell'))
    expect(await screen.findByText('Ready saved for SYNTHETIC-001.')).toBeInTheDocument()
    expect(mocked.refresh).toHaveBeenCalledOnce()
  })

  it('does not navigate or refresh the departed service workspace when a pending save finishes', async () => {
    let finish!: (result: ServiceReadinessDetail) => void
    mocked.update.mockImplementation(() => new Promise<ServiceReadinessDetail>(resolve => { finish = resolve }))
    const page = show('/service?vin=TESTDATAHWELL0001&action=in_service')
    await screen.findByLabelText('Date entered service')
    fireEvent.click(screen.getByRole('button', { name: 'Save service status' }))
    expect(mocked.update).toHaveBeenCalledOnce()
    page.unmount()
    await act(async () => finish(detail('in_service', { version: 1 })))
    expect(mocked.refresh).not.toHaveBeenCalled()
  })

  it('shows a conflict, reloads the other manager’s version, and waits for a new deliberate save', async () => {
    mocked.get.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail('in_service', { version: 1, serviceEnteredAt: '2026-08-29' }))
    mocked.update.mockRejectedValue(new ApiError('Another manager updated this vehicle. Review the latest status and save again.', 409))
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another manager updated this vehicle')
    await waitFor(() => expect(screen.getByText('Current state').parentElement).toHaveTextContent('In service'))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ready' }))
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

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Load latest status' }))
    expect(mocked.get).toHaveBeenCalledOnce()
    expect(screen.getByLabelText(/Service note/)).toHaveValue('My unsaved work note')
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Load latest status' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByText('Current state').parentElement).toHaveTextContent('In service'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    expect(screen.getByRole('heading', { name: 'Edit service note' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date entered service')).toHaveValue('2026-08-29')
    expect(screen.getByLabelText(/Service note/)).toHaveValue('Another manager started service')
    expect(screen.queryByText(/A newer service update is available/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('keeps edited service notes when switching status or cancelling is declined, and prompts once on Back', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'Unfinished inspection note' } })
    fireEvent.click(screen.getByRole('button', { name: 'In service 0' }))
    expect(screen.getByLabelText(/Service note/)).toHaveValue('Unfinished inspection note')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText(/Service note/)).toHaveValue('Unfinished inspection note')
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockClear().mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back to service list' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText(/Service note/)).not.toBeInTheDocument()
  })

  it('retains an edited note when the daily bootstrap date changes', async () => {
    const page = show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'Inspection continues after midnight' } })
    const current = mocked.context.data as { meta: { reportDate: string }; vehicles: VehicleRecord[] }
    mocked.context.data = { ...current, meta: { reportDate: '2026-08-31' } }
    page.rerender(<MemoryRouter initialEntries={['/service?vin=TESTDATAHWELL0001']}><ServicePage /></MemoryRouter>)
    expect(screen.getByLabelText(/Service note/)).toHaveValue('Inspection continues after midnight')
    expect(mocked.get).toHaveBeenCalledOnce()
  })

  it('keeps the users edited note when a conflicting save fetches the other managers latest version', async () => {
    mocked.get.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail('in_service', { version: 1, notes: 'Other manager note' }))
    mocked.update.mockRejectedValueOnce(new ApiError('Another manager updated this record.', 409))
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'My inspection details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another manager updated')
    await waitFor(() => expect(screen.getByText('Current state').parentElement).toHaveTextContent('In service'))
    expect(screen.getByLabelText(/Service note/)).toHaveValue('My inspection details')
    expect(mocked.update).toHaveBeenCalledOnce()
  })

})
