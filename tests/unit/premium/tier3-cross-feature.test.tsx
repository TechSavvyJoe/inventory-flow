import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { clearCustomerShortlist } from '../../../src/features/inventory/useCustomerShortlist'
import { premiumVehicle, showPremiumInventory } from '../premium-test-helpers'

beforeEach(() => { clearCustomerShortlist(); sessionStorage.clear() })
afterEach(() => { cleanup(); clearCustomerShortlist() })
const first = premiumVehicle({ model: 'Focus', movement: null })
const second = premiumVehicle({ id: 'TESTDATAHWELL0002', vin: 'TESTDATAHWELL0002', stockNumber: 'SYNTHETIC-002', model: 'Explorer', movement: null })
function rows() { return within(screen.getByRole('region', { name: 'Inventory results table' })) }

describe('Inventory and vehicle context continuity', () => {
  it('keeps the default list free of empty shortlist controls', () => {
    showPremiumInventory([first, second])
    expect(screen.queryByRole('button', { name: /Shortlist \(0\)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Customer shortlist' })).not.toBeInTheDocument()
  })
  it('retains the inventory search after opening and closing the vehicle', () => {
    showPremiumInventory([first, second])
    fireEvent.change(screen.getByRole('combobox', { name: 'Search inventory' }), { target: { value: 'Explorer' } })
    fireEvent.click(rows().getByRole('button', { name: /Open vehicle details/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to inventory' }))
    expect(screen.getByRole('combobox', { name: 'Search inventory' })).toHaveValue('Explorer')
    expect(rows().queryByText('SYNTHETIC-001')).not.toBeInTheDocument()
    expect(rows().getByText('SYNTHETIC-002')).toBeInTheDocument()
  })
  it('collects a shortlist from details and narrows the same full inventory view', () => {
    showPremiumInventory([first, second])
    fireEvent.click(rows().getAllByRole('button', { name: /Open vehicle details/ })[0])
    const add = screen.getByRole('button', { name: /Add .* to shortlist/ })
    fireEvent.click(add)
    fireEvent.click(screen.getByRole('button', { name: 'Back to inventory' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shortlist (1) — Saved only' }))
    expect(rows().getAllByRole('button', { name: /Open vehicle details/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Shortlist (1) — Saved only' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('opens the records inspector from the table without losing stock or list context', () => {
    showPremiumInventory([first])
    fireEvent.click(rows().getByRole('button', { name: /Open vehicle records/ }))
    const inspector = screen.getByRole('dialog', { name: /records$/i })
    expect(inspector).toHaveAttribute('aria-modal', 'false')
    expect(within(inspector).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')
    expect(inspector).toHaveTextContent('SYNTHETIC-001')
    expect(rows().getByText('SYNTHETIC-001')).toBeVisible()
    fireEvent.click(within(inspector).getByRole('button', { name: 'Close records' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(rows().getByText('SYNTHETIC-001')).toBeVisible()
  })
  it('retains page-size control and pagination on the upgraded route', () => {
    const vehicles = Array.from({ length: 26 }, (_, index) => premiumVehicle({ id: `v-${index}`, stockNumber: `SYNTHETIC-${index}`, vin: `TESTDATAHWELL${String(index).padStart(4, '0')}` }))
    showPremiumInventory(vehicles, { pageSize: 10 })
    expect(rows().getAllByRole('button', { name: /Open vehicle details/ })).toHaveLength(10)
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '25' } })
    expect(rows().getAllByRole('button', { name: /Open vehicle details/ })).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: 'Next inventory page' }))
    expect(rows().getAllByRole('button', { name: /Open vehicle details/ })).toHaveLength(1)
  })
})
