// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getManualHold, updateManualHold } from '../../lib/api'
import type { ManualHoldDetail, UserRole } from '../../types'
import type { InventoryVehicle } from './types'
import { ManualHoldDialog } from './ManualHoldDialog'

vi.mock('../../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  getManualHold: vi.fn(), updateManualHold: vi.fn(),
}))
afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const warning = 'The records disagree. Review the imported evidence before promising availability.'
function detail(state: ManualHoldDetail['state'], version = 1): ManualHoldDetail {
  return { vin: 'TESTDATAHWELL0001', state, version, ownerStore: 'Howell', canManage: true, enabled: true, approvalEnabled: true, canApprove: false,
    customerLabel: 'Synthetic customer', note: 'Synthetic operational note', expectedDeliveryDate: null, updatedAt: null, history: [] }
}
function vehicle(manual: ManualHoldDetail['state'], importedHold: boolean, staleConflict: boolean): InventoryVehicle {
  return { id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'SYNTHETIC-HOLD', year: 2026, make: 'Ford', model: 'Synthetic model', price: null, mileage: null,
    publicListing: { dataState: 'current', isListed: true }, dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: 'current', hasActiveHold: importedHold, conciseState: importedHold ? 'DealerMail hold' : 'No current DealerMail hold found' },
    location: { homeStore: { id: 'howell', name: 'Howell' } }, manualHold: detail(manual),
    inventoryDecision: { status: 'unconfirmed', comparison: staleConflict ? 'conflict' : 'agreement', reasons: staleConflict ? ['manual_hold_not_in_source'] : [], manualHold: manual, importedHold, label: 'Synthetic decision' } }
}
function open(record: InventoryVehicle, role: UserRole = 'sales') {
  render(<ManualHoldDialog vehicle={record} role={role} store="Howell" onClose={vi.fn()} onSaved={vi.fn()} returnFocusRef={createRef<HTMLElement>()} />)
}

describe('Manual hold freshest record and concurrent release recovery', () => {
  it('submits a salesperson request without activating a hold', async () => {
    vi.mocked(getManualHold).mockResolvedValue({ ...detail(null, 0), customerLabel: null, note: null })
    vi.mocked(updateManualHold).mockResolvedValue(detail('requested'))
    open(vehicle(null, false, false))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Customer initials or nickname' }), { target: { value: 'AB' } })
    expect(screen.queryByRole('button', { name: 'Place hold' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit hold request' }))
    await waitFor(() => expect(updateManualHold).toHaveBeenCalledWith('TESTDATAHWELL0001', {
      state: 'requested', expectedVersion: 0, customerLabel: 'AB', expectedDeliveryDate: '', note: '',
    }, 'sales', 'Howell'))
  })

  it('lets the manager approve a pending request while preserving its submitted details', async () => {
    const request = { ...detail('requested', 3), canApprove: true, customerLabel: 'AB', expectedDeliveryDate: '2026-09-04' }
    vi.mocked(getManualHold).mockResolvedValue(request)
    vi.mocked(updateManualHold).mockResolvedValue(detail('active', 4))
    open(vehicle('requested', false, false), 'manager')
    expect(await screen.findByRole('radio', { name: 'Approve hold' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('not a confirmed Inventory Flow hold')
    fireEvent.click(screen.getByRole('button', { name: 'Approve hold' }))
    await waitFor(() => expect(updateManualHold).toHaveBeenCalledWith('TESTDATAHWELL0001', {
      state: 'active', expectedVersion: 3, customerLabel: 'AB', expectedDeliveryDate: '2026-09-04', note: request.note,
    }, 'manager', 'Howell'))
  })

  it('allows a requester to cancel but does not expose manager decisions', async () => {
    vi.mocked(getManualHold).mockResolvedValue(detail('requested', 2))
    vi.mocked(updateManualHold).mockResolvedValue(detail('cancelled', 3))
    open(vehicle('requested', false, false))
    fireEvent.click(await screen.findByRole('radio', { name: 'Cancel request' }))
    expect(screen.queryByRole('radio', { name: 'Approve hold' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Decline request' })).not.toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Cancel request' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Cancellation reason' }), { target: { value: 'Customer selected another unit' } })
    fireEvent.click(save)
    await waitFor(() => expect(updateManualHold).toHaveBeenCalledWith('TESTDATAHWELL0001', {
      state: 'cancelled', expectedVersion: 2, note: 'Customer selected another unit',
    }, 'sales', 'Howell'))
  })

  it('keeps old-schema hold controls read-only until approval storage is ready', async () => {
    vi.mocked(getManualHold).mockResolvedValue({ ...detail(null, 0), canManage: false, approvalEnabled: false })
    open(vehicle(null, false, false))
    expect(await screen.findByText('Hold controls are not enabled yet. Ask Software Admin to finish the hold approval setup.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Submit hold request' })).not.toBeInTheDocument()
    expect(updateManualHold).not.toHaveBeenCalled()
  })
  it.each([
    ['active', false, true, 'released', false],
    ['released', false, false, 'active', true],
    ['active', true, false, 'released', true],
    ['released', true, true, 'active', false],
  ] as const)('compares loaded %s/%s evidence after bootstrap changes to %s/%s', (bootstrap, imported, staleConflict, latest, conflict) => {
    vi.mocked(getManualHold).mockResolvedValue(detail(latest, 2))
    open(vehicle(bootstrap, imported, staleConflict))
    return waitFor(() => {
      expect(screen.queryByText('Loading the latest record…')).not.toBeInTheDocument()
      if (conflict) expect(screen.getByText(warning)).toBeVisible()
      else expect(screen.queryByText(warning)).not.toBeInTheDocument()
    })
  })

  it('recovers a concurrent release into an explicit usable new-hold form with the latest version', async () => {
    vi.mocked(getManualHold).mockResolvedValueOnce(detail('active')).mockResolvedValueOnce(detail('released', 2))
    vi.mocked(updateManualHold).mockRejectedValueOnce(new ApiError('The record changed.', 409, 'MANUAL_HOLD_VERSION_CONFLICT')).mockResolvedValueOnce(detail('active', 3))
    open(vehicle('active', false, true))
    fireEvent.click(await screen.findByRole('radio', { name: 'Release hold' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Release reason' }), { target: { value: 'Synthetic concurrent release reason' } })
    fireEvent.click(screen.getByRole('button', { name: 'Release hold' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This hold was already released.')
    expect(screen.queryByRole('button', { name: 'Release hold' })).not.toBeInTheDocument()
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Customer initials or nickname' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Notes and details' })).toHaveValue('')
    fireEvent.change(screen.getByRole('textbox', { name: 'Customer initials or nickname' }), { target: { value: 'New synthetic customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit hold request' }))
    await waitFor(() => expect(updateManualHold).toHaveBeenLastCalledWith('TESTDATAHWELL0001', { state: 'requested', expectedVersion: 2, customerLabel: 'New synthetic customer', expectedDeliveryDate: '', note: '' }, 'sales', 'Howell'))
  })
  it('replaces a losing employee draft with the latest active hold before a deliberate save', async () => {
    const latest = { ...detail('active', 2), customerLabel:'Winning employee initials', expectedDeliveryDate:'2026-09-04', note:'Winning operational details' }
    vi.mocked(getManualHold).mockResolvedValueOnce(detail('active')).mockResolvedValueOnce(latest)
    vi.mocked(updateManualHold).mockRejectedValueOnce(new ApiError('The record changed.', 409, 'MANUAL_HOLD_VERSION_CONFLICT')).mockResolvedValueOnce({ ...latest, version:3 })
    open(vehicle('active', true, false))
    fireEvent.change(await screen.findByRole('textbox', { name:'Customer initials or nickname' }), { target:{ value:'Losing employee draft' } })
    fireEvent.change(screen.getByLabelText('Expected delivery (optional)'), { target:{ value:'2026-09-02' } })
    fireEvent.change(screen.getByRole('textbox', { name:'Notes and details' }), { target:{ value:'Losing operational details' } })
    fireEvent.click(screen.getByRole('button', { name:'Save hold changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The latest values are shown. Review them before saving again.')
    expect(screen.getByRole('textbox', { name:'Customer initials or nickname' })).toHaveValue(latest.customerLabel)
    expect(screen.getByLabelText('Expected delivery (optional)')).toHaveValue(latest.expectedDeliveryDate)
    expect(screen.getByRole('textbox', { name:'Notes and details' })).toHaveValue(latest.note)
    expect(updateManualHold).toHaveBeenCalledOnce()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name:'Cancel' }))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
    fireEvent.click(screen.getByRole('button', { name:'Save hold changes' }))
    await waitFor(() => expect(updateManualHold).toHaveBeenLastCalledWith('TESTDATAHWELL0001', { state:'active', expectedVersion:2, customerLabel:latest.customerLabel, expectedDeliveryDate:latest.expectedDeliveryDate, note:latest.note }, 'sales', 'Howell'))
  })

  it('retains the original version and draft when conflict reconciliation cannot load the latest record', async () => {
    vi.mocked(getManualHold).mockResolvedValueOnce(detail('active')).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(updateManualHold).mockRejectedValueOnce(new ApiError('The record changed.', 409, 'MANUAL_HOLD_VERSION_CONFLICT')).mockResolvedValueOnce(detail('active', 2))
    open(vehicle('active', true, false))
    fireEvent.change(await screen.findByRole('textbox', { name:'Customer initials or nickname' }), { target:{ value:'Retained draft' } })
    fireEvent.change(screen.getByLabelText('Expected delivery (optional)'), { target:{ value:'2026-09-03' } })
    fireEvent.change(screen.getByRole('textbox', { name:'Notes and details' }), { target:{ value:'Retained draft note' } })
    fireEvent.click(screen.getByRole('button', { name:'Save hold changes' }))
    await waitFor(() => expect(screen.getByRole('button', { name:'Save hold changes' })).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent('The record changed.')
    expect(screen.getByRole('textbox', { name:'Customer initials or nickname' })).toHaveValue('Retained draft')
    expect(screen.getByLabelText('Expected delivery (optional)')).toHaveValue('2026-09-03')
    expect(screen.getByRole('textbox', { name:'Notes and details' })).toHaveValue('Retained draft note')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name:'Cancel' }))
    expect(confirm).toHaveBeenCalledOnce()
    confirm.mockRestore()
    fireEvent.click(screen.getByRole('button', { name:'Save hold changes' }))
    await waitFor(() => expect(updateManualHold).toHaveBeenLastCalledWith('TESTDATAHWELL0001', { state:'active', expectedVersion:1, customerLabel:'Retained draft', expectedDeliveryDate:'2026-09-03', note:'Retained draft note' }, 'sales', 'Howell'))
  })

})
