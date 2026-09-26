import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { BootstrapData, StoreName, VehicleRecord } from '../../types'
import { OverviewPage } from './OverviewPage'

const { useAppDataMock } = vi.hoisted(() => ({ useAppDataMock: vi.fn() }))

vi.mock('../../app/AppDataContext', () => ({ useAppData: () => useAppDataMock() }))

function vehicle(vin: string, homeStore: StoreName, currentLocation = homeStore): VehicleRecord {
  return {
    vin,
    stockNumber: `SYN-${homeStore.slice(0, 2).toUpperCase()}`,
    make: 'Ford',
    model: 'F-150',
    vehicleName: `2026 Ford F-150 ${homeStore}`,
    publicStore: homeStore,
    homeStore,
    homeStoreConfirmed: true,
    sourceReportedLocation: homeStore,
    websiteStatus: 'Listed',
    publicListing: 'listed',
    publicListingState: 'Listed publicly; availability not confirmed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current DealerMail hold found', backupCount: 0 },
    movement: currentLocation === homeStore
      ? { state: 'source_reported', label: 'Source-reported', currentLocation, locationConfidence: 'reported' }
      : { state: 'at_requesting_store', label: 'At requesting store', currentLocation, locationConfidence: 'verified', departedAt: '2026-09-20T12:00:00Z', transferId: 'move-1' },
  }
}

function bootstrap(): BootstrapData {
  const local = vehicle('TESTDATAHWELL0001', 'Howell')
  const away = vehicle('TESTDATAHWELL0002', 'Howell', 'Lincoln')
  away.managerDisposition = { stockNumber: away.stockNumber, vin: away.vin, vehicleName: away.vehicleName, soldManagerLog: true, deliveredManagerLog: false, deliveryDate: null, confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: null, reviewRequired: false, soldLabel: 'Sold — manager log', deliveryLabel: 'Not marked delivered — manager log', dataState: 'current' }
  return {
    meta: {
      reportDate: '2026-09-25', completedAt: '2026-09-25T13:00:00-04:00', timezone: 'America/Detroit', publicFreshness: 'current', dealerMailFreshness: 'current', managerDispositionFreshness: 'current', publicCount: 2, crmCount: 2, heldVinCount: 0, publicChangeCounts: { newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 }, holdChangeStatus: 'current', warnings: [],
    },
    stores: (['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'] as StoreName[]).map(store => ({ store, publicUnits: 0, currentHolds: 0, awayFromHome: 0, visiting: 0, returnOverdue: 0, locationExceptions: 0 })),
    vehicles: [local, away],
    transfers: [],
    attention: [{ id: 'attention-1', severity: 'warning', type: 'inventory', label: 'Synthetic manager review', store: 'Howell', status: 'open', priority: 'normal', allowedActions: [], events: [] }],
    vehicleIssuesEnabled: true,
    vehicleIssues: [{ id: 'issue-1', vin: local.vin, stockNumber: local.stockNumber, vehicleName: local.vehicleName, homeStore: 'Howell', reportStore: 'Howell', category: 'cleaning', priority: 'normal', description: 'Synthetic cleaning issue', status: 'open', version: 1, assignee: null, reportedBy: 'Synthetic sales', reportedByUserId: 'sales-1', reportedAt: '2026-09-25T12:00:00Z', updatedAt: '2026-09-25T12:00:00Z', completedAt: null, completedBy: null, photoCount: 0, allowedActions: [] }],
    managerDispositions: [away.managerDisposition],
  }
}

describe('OverviewPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppDataMock.mockReturnValue({ data: bootstrap(), homeStore: 'Howell', role: 'manager', currentUser: 'Synthetic Manager' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens a store manager on their store and reveals every selected metric population', () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Inventory overview' })).toBeVisible()
    const summaries = screen.getByRole('region', { name: 'Store inventory summaries' })
    expect(summaries).toHaveClass('ov-stores--single')
    expect(screen.getByRole('heading', { name: 'Howell', level: 2 })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Lincoln', level: 2 })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Howell: 0 holds' })).toHaveClass('is-zero')
    expect(screen.getByRole('button', { name: 'Howell: 1 open issues' })).toHaveClass('has-value', 'ov-tone-warning')

    fireEvent.click(screen.getByRole('button', { name: 'Howell: 1 away' }))
    const population = screen.getByRole('heading', { name: 'Howell · Away from home' }).closest('section')!
    expect(within(population).getByText('2026 Ford F-150 Howell')).toBeVisible()
    expect(within(population).getAllByText(/Inventory Flow move ledger/)).toHaveLength(1)
    expect(within(population).getByRole('link', { name: 'View vehicle' })).toHaveClass('ov-vehicle-action--primary')
    expect(within(population).getByRole('link', { name: 'Records 0/6' })).toHaveAttribute('href', expect.stringContaining('tab=data'))
    expect(within(population).getByRole('link', { name: /Move/ })).toHaveAttribute('href', expect.stringContaining('/transfers?id=move-1'))

    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(summaries).not.toHaveClass('ov-stores--single')
    expect(screen.getByRole('heading', { name: 'Lincoln', level: 2 })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 2 }).some(heading => heading.textContent === 'Fowlerville')).toBe(true)
  })

  it('keeps app-owned work and imported manager-log evidence visibly separate', () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>)

    const attention = screen.getByRole('heading', { name: 'Attention and vehicle issues' }).closest('section')!
    expect(within(attention).getByRole('link', { name: /1 open Action center item/ })).toHaveAttribute('href', '/attention')
    expect(within(attention).getByRole('link', { name: /1 open vehicle issue/ })).toHaveAttribute('href', '/attention')
    expect(within(attention).getByRole('link', { name: 'Review issue' })).toHaveAttribute('href', '/attention?issue=issue-1')

    const disposition = screen.getByRole('heading', { name: 'Manager-log dispositions' }).closest('section')!
    expect(within(disposition).getByRole('button', { name: /Sold — manager log/ })).toBeVisible()
    expect(disposition).toHaveTextContent('independent of public listing, DealerMail hold, service readiness, delivery confirmation, and physical location')
    expect(screen.queryByText('Available', { exact: true })).not.toBeInTheDocument()
  })

  it('defaults a group manager to all stores and exposes a print-friendly snapshot action', () => {
    useAppDataMock.mockReturnValue({ data: bootstrap(), homeStore: 'Howell', role: 'group_manager', currentUser: 'Synthetic Group Manager' })
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(<MemoryRouter><OverviewPage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Lincoln', level: 2 })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Print snapshot' }))
    expect(print).toHaveBeenCalledOnce()
    expect(screen.getByText(/Inventory Flow daily snapshot/)).toBeInTheDocument()
  })
})
