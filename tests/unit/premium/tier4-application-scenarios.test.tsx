import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { InventoryExperienceHarness } from '../inventory-experience-harness'
import { clearCustomerShortlist } from '../../../src/features/inventory/useCustomerShortlist'
import { premiumStore, premiumVehicle, showPremiumInventory, showPremiumVehicle } from '../premium-test-helpers'

beforeEach(() => { clearCustomerShortlist(); sessionStorage.clear() })
afterEach(() => { cleanup(); clearCustomerShortlist() })

describe('Premium dealership scenarios', () => {
  it('lets a manager record a direct move through the same authorized inventory action', () => {
    const vehicle = premiumVehicle()
    const move = vi.fn()
    showPremiumInventory([vehicle], { moveActionFor: () => ({ intent: 'direct', label: 'Move vehicle', shortLabel: 'Move' }), onMoveVehicle: move })
    const grid = within(screen.getByRole('region', { name: 'Inventory results table' }))
    fireEvent.click(grid.getByRole('button', { name: /^Move vehicle / }))
    expect(move).toHaveBeenCalledWith(vehicle, 'direct')
  })
  it('does not expose creation actions when the role cannot request or directly move', () => {
    showPremiumInventory([premiumVehicle()], { canRequestVehicle: () => false, moveActionFor: () => null })
    const grid = within(screen.getByRole('region', { name: 'Inventory results table' }))
    expect(grid.queryByRole('button', { name: /^Move vehicle / })).not.toBeInTheDocument()
    expect(grid.queryByRole('button', { name: /^Request vehicle / })).not.toBeInTheDocument()
    expect(grid.getByRole('button', { name: /Open vehicle records/ })).toBeInTheDocument()
  })
  it('clears customer interest when the same browser changes authenticated context', () => {
    const vehicle = premiumVehicle()
    const base = { vehicles: [vehicle], homeStore: premiumStore, initialSelectedVehicleId: vehicle.id }
    const page = render(<InventoryExperienceHarness {...base} searchPersistenceKey="manager:Howell:alice" />)
    fireEvent.click(screen.getByRole('button', { name: /Add SYNTHETIC-001 to shortlist/ }))
    page.rerender(<InventoryExperienceHarness {...base} searchPersistenceKey="sales:Lincoln:bob" />)
    expect(screen.getByRole('button', { name: /Add SYNTHETIC-001 to shortlist/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: 'Customer shortlist' })).not.toBeInTheDocument()
  })
  it('keeps a source-data warning separate from known vehicle identity during a detail outage', () => {
    showPremiumVehicle(premiumVehicle(), { detailState: 'failed', onRetryDetail: vi.fn() })
    expect(screen.getByRole('dialog')).toHaveTextContent('SYNTHETIC-001')
    expect(screen.getByRole('button', { name: /Retry full record/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Service:/ })).toBeInTheDocument()
  })
  it('uses actual movement identifiers instead of choosing another vehicle’s record', () => {
    const vehicle = premiumVehicle({ movement: { state: 'in_transit', requestId: 'synthetic-move' } })
    const track = vi.fn()
    showPremiumVehicle(vehicle, { onTrackMovement: track })
    fireEvent.click(screen.getByRole('button', { name: 'Track movement' }))
    expect(track).toHaveBeenCalledWith(vehicle)
  })
})
