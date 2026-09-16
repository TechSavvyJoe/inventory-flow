import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapData, PublicChangeCounts, PublicChangeEvent, VehicleRecord } from '../../types'
import { InventoryUpdatesPage } from './InventoryUpdatesPage'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown> }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
afterEach(cleanup)
function change(id: string, overrides: Partial<PublicChangeEvent> = {}): PublicChangeEvent {
  return { id, type: 'new_arrival', field: 'Public listing', valueType: 'text', reportDate: '2026-09-14', previousReportDate: '2026-09-13', vin: `SYNTHETIC-${id}`, stockNumber: `SYN-${id}`, vehicleName: `Synthetic ${id}`, store: 'Howell', beforeValue: null, afterValue: 'Listed', currentVehicle: true, ...overrides }
}
const counts: PublicChangeCounts = { newArrival: 2, priceChange: 3, removed: 1, mileageChange: 1, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 1 }
function fixture(): BootstrapData {
  const publicChanges = [
    change('new-home'), change('new-lincoln', { store: 'Lincoln' }),
    change('price-down', { type: 'price_change', field: 'Listed price', valueType: 'money', beforeValue: 54000, afterValue: 51000 }),
    change('price-up', { type: 'price_change', field: 'Listed price', valueType: 'money', beforeValue: 25000, afterValue: 26000 }),
    change('price-lincoln', { type: 'price_change', field: 'Listed price', valueType: 'money', beforeValue: 43000, afterValue: 41000, store: 'Lincoln' }),
    change('removed', { type: 'removed', field: 'Public listing', beforeValue: 'Listed', afterValue: 'Not listed', currentVehicle: false }),
    change('mileage', { type: 'mileage_change', field: 'Mileage', valueType: 'mileage', beforeValue: 12200, afterValue: 12400 }),
    change('store', { type: 'store_transfer', field: 'Source physical store', valueType: 'store', store: 'Fowlerville', beforeValue: 'Howell', afterValue: 'Fowlerville' }),
  ]
  const vehicles = publicChanges.map(event => ({ vin: event.vin, stockNumber: event.stockNumber, vehicleName: event.vehicleName, homeStore: event.store, listedPrice: 99000, mileage: 12400, engine: 'Synthetic engine', exteriorColor: 'Synthetic blue', serviceReadiness: { status: event.id === 'new-home' ? 'serviced' : 'unknown' } })) as VehicleRecord[]
  return { publicChanges, vehicles, attention: [], transfers: [], stores: [], meta: { reportDate: '2026-09-14', completedAt: '2026-09-14T10:00:00Z', timezone: 'America/New_York', publicCount: vehicles.length, crmCount: 0, heldVinCount: 0, holdChangeStatus: 'No synthetic hold changes', warnings: [], publicChangeBaselineDate: '2026-09-13', publicFreshness: 'current', dealerMailFreshness: 'current', publicChangeCounts: { ...counts } } }
}
function LocationProbe() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}{location.search}</output> }
function show(path = '/updates?view=new') { return render(<MemoryRouter initialEntries={[path]}><InventoryUpdatesPage/><LocationProbe/></MemoryRouter>) }
beforeEach(() => { mocked.context = { data: fixture(), homeStore: 'Howell' } })

describe('Inventory updates workspace', () => {
  it('opens new arrivals directly, starts at the employee store, and keeps all three category counts scoped', () => {
    show()
    expect(screen.getByRole('button', { name: /New arrivals\s*1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Price changes\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Other updates\s*3/ })).toBeInTheDocument()
    const results = screen.getByRole('list', { name: 'New arrivals results' })
    expect(within(results).getAllByRole('listitem')).toHaveLength(1)
    expect(within(results).getByText('Synthetic new-home')).toBeInTheDocument()
    expect(within(results).getByText('Ready')).toBeInTheDocument()
    expect(within(results).getByRole('link', { name: 'Vehicle details' })).toHaveAttribute('href', '/inventory?scope=group&vin=SYNTHETIC-new-home&returnTo=%2Fupdates%3Fview%3Dnew')
    expect(within(results).getByRole('link', { name: 'Records' })).toHaveAttribute('href', '/inventory?scope=group&vin=SYNTHETIC-new-home&tab=data&returnTo=%2Fupdates%3Fview%3Dnew')
    expect(results.querySelector('.workflow-resource-row')).toBeNull()
    expect(results).not.toHaveTextContent('Synthetic engine')
    expect(screen.queryByText('Synthetic new-lincoln')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(screen.getByRole('button', { name: /New arrivals\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Price changes\s*3/ })).toBeInTheDocument()
    expect(within(results).getAllByRole('listitem')).toHaveLength(2)
  })

  it('uses exact comparison prices, shows the signed change, and sorts reductions before increases', () => {
    show('/updates?view=price')
    expect(screen.getByRole('button', { name: /Price changes\s*2/ })).toHaveAttribute('aria-pressed', 'true')
    const rows = within(screen.getByRole('list', { name: 'Price changes results' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Synthetic price-down')
    expect(within(rows[0]).getByText('$54,000').tagName).toBe('DEL')
    expect(within(rows[0]).getByText('$51,000')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Down $3,000')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Up $1,000')
    expect(screen.queryByText('$99,000')).not.toBeInTheDocument()
    expect(within(rows[0]).queryByRole('link', { name: 'Service' })).not.toBeInTheDocument()
    expect(rows[0].querySelector('.updates-values')!.compareDocumentPosition(rows[0].querySelector('.updates-specs')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search inventory updates' }), { target: { value: 'price-up' } })
    expect(within(screen.getByRole('list', { name: 'Price changes results' })).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Price changes\s*2/ })).toBeInTheDocument()
  })

  it('updates the URL for each view and shows listing removal without an open-current-vehicle action', () => {
    show('/updates?view=price&source=companion')
    fireEvent.click(screen.getByRole('button', { name: /Other updates/ }))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/updates?view=other&source=companion')
    fireEvent.change(screen.getByLabelText('Other update type'), { target: { value: 'removed' } })
    const rows = within(screen.getByRole('list', { name: 'Other updates results' })).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Listing removed')
    expect(rows[0]).toHaveTextContent('Listed → Not listed')
    expect(rows[0]).toHaveTextContent('No current listing')
    expect(within(rows[0]).queryByRole('link', { name: 'Vehicle details' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /New arrivals/ }))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/updates?view=new&source=companion')
  })

  it('includes a store change for both affected stores without duplicating its event', () => {
    show('/updates?view=other')
    fireEvent.change(screen.getByLabelText('Other update type'), { target: { value: 'store_transfer' } })
    const results = screen.getByRole('list', { name: 'Other updates results' })
    expect(within(results).getAllByRole('listitem')).toHaveLength(1)
    expect(results).toHaveTextContent('Howell → Fowlerville')
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(within(results).getAllByRole('listitem')).toHaveLength(1)
  })

  it('falls back to honest group totals when vehicle detail does not reconcile', () => {
    const data = fixture(); data.meta.publicChangeCounts.newArrival += 1; mocked.context.data = data
    show()
    expect(screen.getByText(/Showing verified group totals/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Howell' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /New arrivals\s*3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Price changes\s*3/ })).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByText('Vehicle details are unavailable for this comparison')).toBeInTheDocument()
  })

  it('rejects detail whose category totals differ even when the overall event count matches', () => {
    const data = fixture(); data.meta.publicChangeCounts.newArrival += 1; data.meta.publicChangeCounts.priceChange -= 1; mocked.context.data = data
    show('/updates?view=price')
    expect(screen.getByText(/Showing verified group totals/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New arrivals\s*3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Price changes\s*2/ })).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('does not present an absent comparison as zero verified changes', () => {
    const data = fixture()
    data.publicChanges = []
    delete data.meta.publicChangeBaselineDate
    data.meta.publicChangeCounts = { newArrival: 0, priceChange: 0, removed: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 }
    mocked.context.data = data
    show()
    expect(screen.getByRole('button', { name: /^New arrivals\s*—$/ })).toBeInTheDocument()
    expect(screen.getByText('Waiting for the first inventory comparison')).toBeInTheDocument()
    expect(screen.queryByText(/Showing verified group totals/)).not.toBeInTheDocument()
  })

  it('shows a verified zero comparison as zero, and flags stale sources without inventing newer changes', () => {
    const data = fixture(); data.publicChanges = []; data.meta.publicChangeCounts = { newArrival: 0, priceChange: 0, removed: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 }; data.meta.publicFreshness = 'stale_unverified'; mocked.context.data = data
    show('/updates?view=price')
    expect(screen.getByRole('button', { name: /Price changes\s*0/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Howell' })).toBeEnabled()
    expect(screen.getByText('No price changes in this view')).toBeInTheDocument()
    expect(screen.getByText(/Some inventory changes need review/)).toBeInTheDocument()
    expect(screen.queryByText(/could not be reconciled/)).not.toBeInTheDocument()
  })
})
