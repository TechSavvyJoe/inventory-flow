import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it.each(['current', 'stale_unverified'] as const)('keeps %s provider and pending manual holds independent of DealerMail and service readiness', async (dataState) => {
    const vehicle = record(), vin = vehicle.vin
    vehicle.hold = { state: 'none_observed', label: 'No current DealerMail hold found', backupCount: 0, canViewEvidence: false }
    vehicle.operationalEvidence = { records: [{ vin, provider: 'synthetic-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-10-10T12:00:00Z', dataState, readOnly: true, complete: true, holdState: 'held' }] }
    vehicle.manualHold = { vin, state: 'requested', version: 1, expectedDeliveryDate: null, updatedAt: null, ownerStore: 'Howell', enabled: true, canManage: false, customerLabel: 'PRIVATE MANUAL CUSTOMER' }
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    show(`/service?vin=${vin}`)
    const summary = await screen.findByRole('region', { name: 'Recorded service status' })
    const facts = screen.getByLabelText('Service decision facts')
    expect(facts).toHaveTextContent('No current DealerMail hold found')
    expect(facts).toHaveTextContent('Synthetic CRM')
    expect(facts).toHaveTextContent(dataState === 'current' ? 'Hold observed' : 'Hold status not verified')
    expect(facts).toHaveTextContent('Pending approval')
    expect(facts).not.toHaveTextContent('PRIVATE MANUAL CUSTOMER')
    expect(summary).toHaveTextContent('Waiting for service')
    expect(within(summary).queryByText('Ready', { exact: true })).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('shows conflicting provider states and an approved app hold without replacing redacted DealerMail', async () => {
    const vehicle = record(), vin = vehicle.vin
    const observation = { vin, provider: 'synthetic-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-10-10T12:00:00Z', dataState: 'current' as const, readOnly: true as const, complete: true, holdState: 'held' as const }
    vehicle.hold = { state: 'primary', label: 'Held', backupCount: 0, canViewEvidence: false }
    vehicle.operationalEvidence = { records: [observation, { ...observation, provider: 'synthetic-dms', sourceLabel: 'Synthetic DMS', holdState: 'not_observed' }] }
    vehicle.manualHold = { vin, state: 'active', version: 1, expectedDeliveryDate: null, updatedAt: null, ownerStore: 'Howell', enabled: true, canManage: false, note: 'PRIVATE MANUAL NOTE' }
    mocked.context.data = { meta: { reportDate: '2026-08-30' }, vehicles: [vehicle] }
    show(`/service?vin=${vin}`)
    await screen.findByRole('region', { name: 'Recorded service status' })
    const facts = screen.getByLabelText('Service decision facts')
    expect(facts).toHaveTextContent('HoldHeld')
    expect(facts).toHaveTextContent('Synthetic CRMHold observed')
    expect(facts).toHaveTextContent('Synthetic DMSNo hold observed')
    expect(facts).toHaveTextContent('Inventory Flow holdApproved hold')
    expect(facts).not.toHaveTextContent('PRIVATE MANUAL NOTE')
    expect(mocked.update).not.toHaveBeenCalled()
  })

  it('opens an all-store service total across stores and preserves scope in the vehicle return link', async () => {
    show('/service?status=serviced&scope=all')
    await waitFor(() => expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true'))
    const vehicleLink = screen.getByRole('link', { name: 'Open vehicle for Synthetic Ford 003' })
    expect(vehicleLink).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0003&returnTo=%2Fservice%3Fstatus%3Dserviced%26scope%3Dall')
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
    // Confirmation is a dedicated editor — no status <select>. List search may
    // still expose a combobox on wide layouts; that is not a save control.
    expect(screen.queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'Open vehicle for Synthetic Ford 002' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0002&returnTo=%2Fservice%3Fstatus%3Dneeds_service%26scope%3Dmy_store')
    expect(screen.getByRole('link', { name: 'Records for Synthetic Ford 002' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0002&tab=data&returnTo=%2Fservice%3Fstatus%3Dneeds_service%26scope%3Dmy_store')
    expect(screen.getByRole('button', { name: 'Update service for Synthetic Ford 002' })).toBeInTheDocument()
    expect(container.querySelector('.service-vehicle-row a, .service-vehicle-row button')).toBeNull()
  })

  it.each(['Open vehicle', 'Records'])('preserves the active store filter in the %s return path', async (action) => {
    show('/service?status=serviced&store=Lincoln')
    const link = await screen.findByRole('link', { name: `${action} for Synthetic Ford 003` })
    await waitFor(() => {
      const url = new URL(link.getAttribute('href')!, 'https://inventory.invalid')
      expect(url.searchParams.get('returnTo')).toBe('/service?status=serviced&scope=all&store=Lincoln')
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
    const search = screen.getByRole('combobox', { name: 'Search service vehicles' })
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
    const search = screen.getByRole('combobox', { name: 'Search service vehicles' })
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
    mocked.get.mockResolvedValue(detail('needs_service', { canManage: false, notes: 'Brake inspection is still needed.' }))
    show('/service?vin=TESTDATAHWELL0001')
    expect(await screen.findByText('A Howell manager can update this vehicle’s service status.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Current service note' })).toHaveTextContent('Brake inspection is still needed.')
    expect(screen.queryByLabelText(/Service note/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save service status' })).not.toBeInTheDocument()
  })

  it('keeps save disabled until conflict recovery returns the latest version', async () => {
    let finishRecovery!: (result: ServiceReadinessDetail) => void
    mocked.get.mockResolvedValueOnce(detail()).mockImplementationOnce(() => new Promise<ServiceReadinessDetail>(resolve => { finishRecovery = resolve }))
    mocked.update.mockRejectedValueOnce(new ApiError('Another manager updated this vehicle.', 409))
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }))
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'My inspection details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another manager updated')
    const pendingSave = screen.getByRole('button', { name: 'Saving…' })
    expect(pendingSave).toBeDisabled()
    fireEvent.click(pendingSave)
    expect(mocked.update).toHaveBeenCalledOnce()
    await act(async () => finishRecovery(detail('in_service', { version: 1, notes: 'Other manager note' })))
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled()
    expect(screen.getByLabelText(/Service note/)).toHaveValue('My inspection details')
    mocked.update.mockResolvedValueOnce(detail('in_service', { version: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(mocked.update).toHaveBeenLastCalledWith('TESTDATAHWELL0001', expect.objectContaining({ expectedVersion: 1, notes: 'My inspection details' }), 'manager', 'Howell'))
  })

  it('keeps the saved detail and success message when the refresh callback rejects', async () => {
    mocked.update.mockResolvedValue(detail('serviced', { version: 1, completedAt: '2026-08-30', notes: 'Synthetic work finished' }))
    mocked.refresh.mockRejectedValueOnce(new Error('Inventory refresh unavailable')).mockResolvedValueOnce(undefined)
    show('/service?vin=TESTDATAHWELL0001')
    fireEvent.click(await screen.findByRole('button', { name: 'Ready' }))
    fireEvent.change(screen.getByLabelText('Date service completed'), { target: { value: '2026-08-30' } })
    fireEvent.change(screen.getByLabelText(/Service note/), { target: { value: 'Synthetic work finished' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save service status' }))

    expect(await screen.findByText('Ready saved for SYNTHETIC-001.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recorded service status' })).toHaveTextContent('Ready')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocked.update).toHaveBeenCalledOnce()
    expect(mocked.refresh).toHaveBeenCalledOnce()
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

  it('shows read-only saved service history when the VIN has left current inventory', async () => {
    const vin = 'TESTDATAHWELL0099'
    mocked.get.mockResolvedValue(detail('serviced', {
      vin, archivedFromInventory: true, canManage: false, store: 'Lincoln', version: 2,
      serviceEnteredAt: '2026-08-28', completedAt: '2026-08-30', notes: 'SYNTHETIC ARCHIVED SERVICE NOTE',
      history: [
        detail('serviced', { vin, version: 2, canManage: false, updatedBy: 'Synthetic Manager', updatedAt: '2026-08-30T12:00:00Z' }),
        detail('in_service', { vin, version: 1, canManage: false, notes: 'SYNTHETIC ARCHIVED SERVICE NOTE', updatedBy: 'Synthetic Manager', updatedAt: '2026-08-28T12:00:00Z' }),
      ],
    }))
    show(`/service?vin=${vin}`)
    const panel = await screen.findByRole('complementary', { name: `Saved service history for ${vin}` })
    expect(panel).toHaveTextContent('no longer in the current inventory')
    expect(panel).toHaveTextContent('Ready')
    expect(panel).toHaveTextContent('Lincoln')
    expect(panel).toHaveTextContent(vin)
    expect(panel).toHaveTextContent('SYNTHETIC ARCHIVED SERVICE NOTE')
    expect(within(panel).getByRole('heading', { name: 'Saved service history' })).toHaveFocus()
    expect(within(panel).queryByRole('button', { name: 'Save service status' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Update service|Waiting|In service|Ready/ })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: /Open vehicle|Vehicle details|Records/ })).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to service list' }))
    expect(screen.queryByRole('complementary', { name: `Saved service history for ${vin}` })).not.toBeInTheDocument()
  })

  it('keeps a VIN with no saved history out of the current inventory', async () => {
    mocked.get.mockRejectedValue(new ApiError('Vehicle was not found.', 404, 'VEHICLE_NOT_FOUND'))
    show('/service?vin=TESTDATAHWELL0099')
    expect(await screen.findByText('This vehicle is not in the current inventory. Select a vehicle below to review service status.')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: /Saved service history/ })).not.toBeInTheDocument()
    expect(mocked.update).not.toHaveBeenCalled()
  })

})
