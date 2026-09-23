import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { clearCustomerShortlist } from '../../../src/features/inventory/useCustomerShortlist'
import { premiumVehicle, showPremiumInventory, showPremiumVehicle } from '../premium-test-helpers'

beforeEach(() => { clearCustomerShortlist(); sessionStorage.clear() })
afterEach(() => { cleanup(); clearCustomerShortlist() })

describe('Premium primary-screen feature coverage', () => {
  it('uses the complete inventory grid with filter, sort and page-size controls', () => {
    const { container } = showPremiumInventory()
    expect(container.querySelector('.inv-desk-table')).toBeInTheDocument()
    expect(container.querySelector('.inventory-table-v2')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Filters/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Search inventory' })).toBeInTheDocument()
  })
  it('keeps records and service actions beside each inventory vehicle', () => {
    showPremiumInventory()
    const grid = within(screen.getByRole('region', { name: 'Inventory results table' }))
    expect(grid.getByRole('button', { name: /Open vehicle records/ })).toBeInTheDocument()
    expect(grid.getAllByRole('link', { name: /Open service status/ })[0]).toHaveAttribute('href', expect.stringContaining('TESTDATAHWELL0001'))
  })
  it('opens vehicle details from the same primary inventory action', () => {
    showPremiumInventory()
    const grid = within(screen.getByRole('region', { name: 'Inventory results table' }))
    fireEvent.click(grid.getByRole('button', { name: /Open vehicle details/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('SYNTHETIC-001')
    expect(screen.getByRole('button', { name: /Add SYNTHETIC-001 to shortlist/ })).toBeInTheDocument()
  })
  it('presents inventory facts separately from source documents and operational evidence', () => {
    showPremiumVehicle()
    expect(screen.getByRole('region', { name: 'Vehicle specifications' })).toHaveTextContent('3.5L V6 EcoBoost')
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' })
    expect(operations).toHaveTextContent('Location')
    expect(operations).toHaveTextContent('Howell')
    expect(operations).toHaveTextContent('Hold status')
    expect(operations).toHaveTextContent('Service')
    expect(operations).not.toHaveTextContent('Confirm with the home store')
    expect(operations).not.toHaveTextContent('Available')
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveTextContent('AutoCheck')
  })
  it('preserves keyboard-operable tab navigation', () => {
    showPremiumVehicle()
    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Equipment' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Equipment' })).toBeInTheDocument()
  })
  it('uses external service confirmation links without declaring a local completion', () => {
    showPremiumVehicle()
    expect(screen.getByRole('link', { name: 'Mark Ready' })).toHaveAttribute('href', expect.stringContaining('action=serviced'))
    expect(screen.queryByText('Ready for delivery')).not.toBeInTheDocument()
  })
  it('keeps actual activity accessible in its section', () => {
    showPremiumVehicle(premiumVehicle({ timeline: [{ id: 'event', title: 'Synthetic observed change', occurredAt: '2026-08-15T09:00:00Z', source: 'public', detail: 'Synthetic source evidence' }] }))
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByRole('tabpanel', { name: 'Activity' })).toHaveTextContent('Synthetic observed change')
  })
})
