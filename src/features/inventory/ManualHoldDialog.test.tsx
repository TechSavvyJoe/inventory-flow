// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getManualHold, updateManualHold } from '../../lib/api'
import type { ManualHoldDetail } from '../../types'
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
  return { vin: 'TESTDATAHWELL0001', state, version, ownerStore: 'Howell', canManage: true, enabled: true,
    customerLabel: 'Synthetic customer', note: 'Synthetic operational note', expectedDeliveryDate: null, updatedAt: null, history: [] }
}
function vehicle(manual: ManualHoldDetail['state'], importedHold: boolean, staleConflict: boolean): InventoryVehicle {
  return { id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'SYNTHETIC-HOLD', year: 2026, make: 'Ford', model: 'Synthetic model', price: null, mileage: null,
    publicListing: { dataState: 'current', isListed: true }, dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: 'current', hasActiveHold: importedHold, conciseState: importedHold ? 'DealerMail hold' : 'No current DealerMail hold found' },
    location: { homeStore: { id: 'howell', name: 'Howell' } }, manualHold: detail(manual),
    inventoryDecision: { status: 'unconfirmed', comparison: staleConflict ? 'conflict' : 'agreement', reasons: staleConflict ? ['manual_hold_not_in_source'] : [], manualHold: manual, importedHold, label: 'Synthetic decision' } }
}
function open(record: InventoryVehicle) {
  render(<ManualHoldDialog vehicle={record} role="sales" store="Howell" onClose={vi.fn()} onSaved={vi.fn()} returnFocusRef={createRef<HTMLElement>()} />)
}

describe('Manual hold freshest record and concurrent release recovery', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Release manual hold' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This manual hold was already released.')
    expect(screen.queryByRole('button', { name: 'Release manual hold' })).not.toBeInTheDocument()
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Customer initials or nickname' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Notes and details' })).toHaveValue('')
    fireEvent.change(screen.getByRole('textbox', { name: 'Customer initials or nickname' }), { target: { value: 'New synthetic customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place manual hold' }))
    await waitFor(() => expect(updateManualHold).toHaveBeenLastCalledWith('TESTDATAHWELL0001', { state: 'active', expectedVersion: 2, customerLabel: 'New synthetic customer', expectedDeliveryDate: '', note: '' }, 'sales', 'Howell'))
  })
})
