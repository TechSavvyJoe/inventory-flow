import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InventoryPredictiveSearch } from '../../src/features/inventory/InventoryPredictiveSearch'
import { InventoryExperienceV2 } from '../../src/features/inventory/InventoryExperienceV2'
import { createMockVehicle } from './testHelpers'
import type { InventoryDecisionMetrics, InventoryStore } from '../../src/features/inventory/types'

describe('Challenger Layout & Accessibility Suite', () => {
  const mockHomeStore: InventoryStore = { id: 'howell', name: 'Howell' }
  const mockVehicles = [
    createMockVehicle({
      id: 'v1',
      vin: '1FTFW1E86HFA11111',
      stockNumber: 'STK101',
      year: 2024,
      make: 'Ford',
      model: 'F-150',
      price: 45000,
    }),
    createMockVehicle({
      id: 'v2',
      vin: '1FTFW1E86HFA22222',
      stockNumber: 'STK102',
      year: 2023,
      make: 'Ford',
      model: 'Explorer',
      price: 38000,
    }),
  ]

  const mockMetrics: InventoryDecisionMetrics = {
    publicUnits: 42,
    currentHolds: 7,
    awayFromHome: 3,
    returnOverdue: 1,
  }

  afterEach(() => {
    cleanup()
  })

  it('labels the search input with visually hidden text', () => {
    const { container } = render(
      <InventoryPredictiveSearch
        id="search-lbl-test"
        vehicles={mockVehicles}
        value=""
        onChange={vi.fn()}
        onSelectVehicle={vi.fn()}
        persistenceKey="test-search-lbl"
      />
    )

    const label = container.querySelector('label[for="search-lbl-test"]')
    expect(label).not.toBeNull()
    expect(label?.classList.contains('inventory-sr-only')).toBe(true)
    expect(label?.textContent).toBe('Search inventory')
  })

  it('renders shared predictive search, filters and sort controls', () => {
    render(<InventoryExperienceV2 homeStore={mockHomeStore} vehicles={mockVehicles} metrics={mockMetrics} />)
    expect(screen.getByRole('combobox', { name: 'Search inventory' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Inventory quick filters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^All: / })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Sort inventory/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument()
  })

  it('switching quick filters updates their accessible pressed states', () => {
    render(<InventoryExperienceV2 homeStore={mockHomeStore} vehicles={mockVehicles} metrics={mockMetrics} />)
    const held = screen.getByRole('button', { name: /^Held: / })
    expect(held).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(held)
    expect(held).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^All: / })).toHaveAttribute('aria-pressed', 'false')
  })
})
