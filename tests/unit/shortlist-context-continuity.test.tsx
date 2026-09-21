import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { clearWorkspaceMemory } from '../../src/lib/workspace-memory'
import { clearCustomerShortlist } from '../../src/features/inventory/useCustomerShortlist'
import { premiumVehicle, showPremiumInventory } from './premium-test-helpers'

const first = premiumVehicle({ model: 'Focus' })
const second = premiumVehicle({ id: 'TESTDATAHWELL0002', vin: 'TESTDATAHWELL0002', stockNumber: 'SYNTHETIC-002', model: 'Explorer' })
const vehicles = [first, second]
const context = 'manager:Howell:shortlist-continuity'
const rows = () => within(screen.getByRole('region', { name: 'Inventory results table' }))

beforeEach(() => { clearWorkspaceMemory(); clearCustomerShortlist(); sessionStorage.clear() })
afterEach(() => { cleanup(); clearWorkspaceMemory(); clearCustomerShortlist() })

function shortlistFirstVehicle() {
  fireEvent.click(rows().getAllByRole('button', { name: /Open vehicle details/ })[0])
  fireEvent.click(screen.getByRole('button', { name: /Add .* to shortlist/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to inventory' }))
  fireEvent.click(screen.getByRole('button', { name: 'Shortlist (1)' }))
}

describe('Shortlist working context', () => {
  it('restores shortlist-only after leaving and remounting the same authorized inventory', () => {
    const page = showPremiumInventory(vehicles, { searchPersistenceKey: context })
    shortlistFirstVehicle()
    page.unmount()
    showPremiumInventory(vehicles, { searchPersistenceKey: context })
    expect(screen.getByRole('button', { name: 'Shortlist (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(rows().getAllByRole('button', { name: /Open vehicle details/ })).toHaveLength(1)
  })

  it('does not carry shortlist-only into a different access context', () => {
    const page = showPremiumInventory(vehicles, { searchPersistenceKey: context })
    shortlistFirstVehicle()
    page.unmount()
    showPremiumInventory(vehicles, { searchPersistenceKey: 'sales:Detroit:another-user' })
    expect(screen.queryByRole('button', { name: /Shortlist \(/ })).not.toBeInTheDocument()
    expect(rows().getAllByRole('button', { name: /Open vehicle details/ })).toHaveLength(2)
  })

  it('keeps the current authorized vehicle open when removed from a shortlist-only list', () => {
    const selected = vi.fn()
    showPremiumInventory(vehicles, { searchPersistenceKey: context, onSelectedVehicleChange: selected })
    shortlistFirstVehicle()
    fireEvent.click(rows().getByRole('button', { name: /Open vehicle details/ }))
    const selectedId = selected.mock.lastCall?.[0]
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Remove .* from shortlist/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add .* to shortlist/ })).toBeInTheDocument()
    expect(selected).toHaveBeenLastCalledWith(selectedId)
    fireEvent.click(screen.getByRole('button', { name: 'Back to inventory' }))
    expect(selected).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: 'Shortlist (0)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
