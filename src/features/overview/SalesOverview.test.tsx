import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { BootstrapData, OverviewSummary, StoreName, TransferRecord, VehicleIssue, VehicleRecord } from '../../types'
import type { ShortlistContextValue } from '../inventory/useCustomerShortlist'
import type { InventoryVehicle } from '../inventory/types'
import { SalesOverview } from './SalesOverview'
import { toInventoryVehicle } from '../../app/adapters'
import { vehicleMatchesOverviewView } from '../inventory/inventory-utils'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const { syncedListsMock } = vi.hoisted(() => ({ syncedListsMock: vi.fn() }))
vi.mock('../inventory/useSyncedCustomerLists', () => ({ useSyncedCustomerLists: syncedListsMock }))
vi.mock('../inventory/TakeHomeSheet', () => ({ TakeHomeSheet: ({ vehicles, listLabel, onClose, onRefresh, onEditList, refreshError }: { vehicles: InventoryVehicle[]; listLabel: string; onClose: () => void; onRefresh?: () => Promise<boolean>; onEditList?: () => void; refreshError?: string | null }) => <div role="dialog" aria-label="Customer sheet preview"><span>{listLabel}</span>{vehicles.map(vehicle => <span key={vehicle.vin}>{vehicle.vin} Price {vehicle.price}</span>)}<button onClick={onClose}>Close sheet</button>{onRefresh ? <button onClick={() => void onRefresh()}>Refresh comparison</button> : null}{onEditList ? <button onClick={onEditList}>Edit list</button> : null}{refreshError ? <p role="alert">{refreshError}</p> : null}</div> }))

const stores: StoreName[] = ['Howell']

function vehicle(vin: string, changes: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    vin,
    stockNumber: `SYN-${vin.slice(-2)}`,
    year: 2026,
    make: 'Ford',
    model: 'F-150',
    trim: 'XLT',
    vehicleName: `2026 Ford F-150 ${vin.slice(-2)}`,
    listedPrice: 42_500,
    mileage: 12_345,
    exteriorColor: 'Synthetic Blue',
    interiorColor: 'Synthetic Black',
    drivetrain: '4WD',
    engine: '3.5L V6',
    transmission: '10-Speed Automatic',
    fuelType: 'Gasoline',
    mpgCity: 18,
    mpgHighway: 24,
    features: '360-Degree Camera | Adaptive Cruise Control',
    publicStore: 'Howell',
    homeStore: 'Howell',
    homeStoreConfirmed: true,
    sourceReportedLocation: 'Howell',
    websiteStatus: 'Listed',
    publicListing: 'listed',
    publicListingState: 'Listed publicly; availability not confirmed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current DealerMail hold found', backupCount: 0 },
    movement: { state: 'source_reported', label: 'Source-reported', currentLocation: 'Howell', locationConfidence: 'reported' },
    serviceReadiness: { vin, status: 'serviced', version: 1, serviceEnteredAt: null, completedAt: '2026-09-29', updatedAt: '2026-09-29', updatedBy: 'Synthetic manager', updatedByRole: 'manager', updatedAtStore: 'Howell', store: 'Howell', canManage: false },
    ...changes,
  }
}

function overview(vehicles: VehicleRecord[]): OverviewSummary {
  return {
    asOfDay: '2026-09-30', scopeStore: 'Howell', role: 'sales', access: 'read_only',
    thresholds: { unaccountedAfterDays: 7, agedListingDays: [60, 90], serviceWaitingDays: [14, 30], listedAfterDeliveredDays: 3, recentReceiptDays: 7 },
    stores: [{ store: 'Howell', onLot: 2, onLotSourceReported: 2, away: 0, visiting: 0, inTransit: 0, conflict: 0, holds: 1, holdsPastExpected: 0, waitingForService: 1, inService: 0, ready: 1, aged60: 0, aged90: 0, unaccounted: 0, returnOverdue: 0, recordsIncomplete: 0, listed: 2, preListing: 0 }],
    group: { onLot: 2, onLotSourceReported: 2, away: 0, visiting: 0, inTransit: 0, conflict: 0, holds: 1, holdsPastExpected: 0, waitingForService: 1, inService: 0, ready: 1, aged60: 0, aged90: 0, unaccounted: 0, returnOverdue: 0, recordsIncomplete: 0, listed: 2, preListing: 0 },
    board: { flows: [] },
    vehicleFacts: Object.fromEntries(vehicles.map(item => [item.vin, { custody: 'on_lot', custodyBasis: 'source_reported', currentStore: 'Howell', records: { autoCheck: false, oasis: false, sticker: false, invoice: false, fordHistory: false }, recordsCaptured: 0, recordsApplicable: 5, service: { status: item.serviceReadiness?.status === 'needs_service' ? 'needs_service' : 'serviced', basis: 'manager_updated', store: 'Howell', arrivalBasis: 'intake' } }])),
    exceptions: [],
    service: { perStore: [], group: { counts: { waitingForService: 1, inService: 0, ready: 1 }, basis: { manager_updated: 2, ford_service_history_inspection: 0, autocheck_post_intake_inspection: 0, new_arrival: 0, unconfirmed: 0, legacy_review: 0 }, arrivalBasis: { intake: 2, listing_date: 0, unknown: 0 }, medians: { receiptToStartDays: { value: null, n: 0 }, inServiceDays: { value: null, n: 0 }, receiptToReadyDays: { value: null, n: 0 } }, agedWaiting14: 0, agedWaiting30: 0 }, agedWaiting: [] },
  }
}

function issue(id: string, vin: string, owner: string): VehicleIssue {
  return { id, vin, stockNumber: `SYN-${vin.slice(-2)}`, vehicleName: `2026 Ford F-150 ${vin.slice(-2)}`, homeStore: 'Howell', reportStore: 'Howell', category: 'cleaning', priority: 'normal', description: 'Synthetic issue', status: 'open', version: 1, assignee: null, reportedBy: 'Same Display Name', reportedByUserId: owner, reportedAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', completedAt: null, completedBy: null, photoCount: 0, allowedActions: [] }
}

function data(): BootstrapData {
  const current = vehicle('TESTDATASAVED0001', { imageUrl: '/demo-vehicles/synthetic.svg', hold: { state: 'primary', label: 'Primary hold', backupCount: 0, reason: 'PRIVATE CUSTOMER TEXT' }, serviceReadiness: { ...vehicle('X').serviceReadiness!, vin: 'TESTDATASAVED0001', status: 'needs_service', completedAt: null } })
  const ordinary = vehicle('TESTDATAOTHER0002')
  return {
    savedListsEnabled: true,
    meta: { reportDate: '2026-09-30', completedAt: '2026-09-30T12:00:00Z', timezone: 'America/Detroit', publicFreshness: 'current', dealerMailFreshness: 'current', publicCount: 2, crmCount: 2, heldVinCount: 1, publicChangeCounts: { newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 }, holdChangeStatus: 'current', warnings: [] },
    stores: [{ store: 'Howell', publicUnits: 2, currentHolds: 1, awayFromHome: 0, visiting: 0, returnOverdue: 0, locationExceptions: 0 }],
    vehicles: [ordinary, current], transfers: [], attention: [], vehicleIssues: [issue('mine', current.vin, 'employee-1'), issue('same-name', ordinary.vin, 'employee-2')], overview: overview([ordinary, current]),
  }
}

function shortlist(overrides: Partial<ShortlistContextValue> = {}): ShortlistContextValue {
  const management = {
    lists: [{ id: 'list-a', label: 'AB', count: 2 }, { id: 'list-b', label: 'CD', count: 1 }], activeListId: 'list-a', activeLabel: 'AB', loading: false, saving: false, error: null, lastConfirmedAt: Date.now(), pendingAction: false, accessRevoked: false, readyForWrites: true,
    selectList: vi.fn(), createList: vi.fn(), renameActiveList: vi.fn(), deleteActiveList: vi.fn(), retry: vi.fn(),
  }
  return {
    context: 'test',
    entries: [{ id: 'TESTDATASAVED0001', vin: 'TESTDATASAVED0001', stockNumber: 'SYN-01', displayName: '2026 Ford F-150 01', price: 42_500, imageUrl: null, exteriorColor: null, addedAt: 1, available: true }, { id: 'STALEVIN', vin: 'STALEVIN', stockNumber: 'Unavailable', displayName: 'Vehicle unavailable', price: null, imageUrl: null, exteriorColor: null, addedAt: 2, available: false }],
    ids: new Set(['TESTDATASAVED0001', 'STALEVIN']), count: 2, isShortlisted: vi.fn(), toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), clear: vi.fn(), management,
    ...overrides,
  }
}

function renderOverview(currentUserId: string | null = 'employee-1', source = data()) {
  return render(<MemoryRouter><SalesOverview data={source} stores={stores} homeStore="Howell" role="sales" currentUserId={currentUserId} /></MemoryRouter>)
}

describe('SalesOverview', () => {
  beforeEach(() => { syncedListsMock.mockReturnValue(shortlist()) })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('prepares fresh comparisons from Overview, retains marked failed previews, and links back to list editing', async () => {
    const source = data()
    const refreshVehicles = vi.fn()
    const first = { ...toInventoryVehicle(source.vehicles[1], source), price:41000 }
    const second = { ...toInventoryVehicle(source.vehicles[0], source), price:39000 }
    const prepareCustomerSheet = vi.fn()
      .mockResolvedValueOnce({ listId:'list-a', label:'AB current', vehicles:[first], refreshedAt:1, unavailableCount:1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ listId:'list-a', label:'AB revised', vehicles:[second], refreshedAt:2, unavailableCount:0 })
    syncedListsMock.mockReturnValue(shortlist({ management:{ ...shortlist().management!, prepareCustomerSheet } }))
    function Location() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}{location.search}</output> }
    render(<MemoryRouter><SalesOverview data={source} stores={stores} homeStore="Howell" role="sales" currentUserId="employee-1" refreshVehicles={refreshVehicles} /><Location /></MemoryRouter>)
    expect(syncedListsMock).toHaveBeenCalledWith(expect.objectContaining({ refreshVehicles }))
    fireEvent.click(screen.getByRole('button', { name:'Customer sheet' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('AB current')
    expect(screen.getByRole('dialog')).toHaveTextContent('Price 41000')
    fireEvent.click(screen.getByRole('button', { name:'Refresh comparison' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('last-loaded data')
    expect(screen.getByRole('dialog')).toHaveTextContent('Price 41000')
    fireEvent.click(screen.getByRole('button', { name:'Refresh comparison' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('AB revised'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Price 39000')
    expect(prepareCustomerSheet.mock.calls).toEqual([['list-a'], ['list-a'], ['list-a']])
    fireEvent.click(screen.getByRole('button', { name:'Edit list' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name:'Current route' })).toHaveTextContent('/inventory?scope=group')
  })

  it('does not open a late prepared comparison after the employee changes', async () => {
    const source = data()
    let finish!: (value: unknown) => void
    const prepareCustomerSheet = vi.fn(() => new Promise(resolve => { finish = resolve }))
    syncedListsMock.mockReturnValue(shortlist({ management:{ ...shortlist().management!, prepareCustomerSheet:prepareCustomerSheet as NonNullable<NonNullable<ShortlistContextValue['management']>['prepareCustomerSheet']> } }))
    const props = { data:source, stores, homeStore:'Howell' as const, role:'sales' as const }
    const view = render(<MemoryRouter><SalesOverview {...props} currentUserId="employee-1" /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name:'Customer sheet' }))
    view.rerender(<MemoryRouter><SalesOverview {...props} currentUserId="employee-2" /></MemoryRouter>)
    await act(async () => finish({ listId:'list-a', label:'Private old list', vehicles:[toInventoryVehicle(source.vehicles[1], source)], refreshedAt:1, unavailableCount:0 }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Private old list')).not.toBeInTheDocument()
  })

  it('binds saved lists to the stable employee context and renders only current authorized vehicles', () => {
    renderOverview()
    expect(syncedListsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, ownerId: 'employee-1', role: 'sales', store: 'Howell', context: JSON.stringify(['employee-1', 'sales', 'Howell', 'overview']) }))
    expect(syncedListsMock.mock.calls[0][0].authorizedVehicles).toHaveLength(2)
    const saved = screen.getByRole('region', { name: 'Customer saved lists' })
    expect(within(saved).getByText('2026 Ford F-150 01')).toBeVisible()
    const savedVehicle = within(saved).getByRole('listitem')
    expect(savedVehicle).toHaveTextContent('Stock SYN-01')
    expect(savedVehicle).toHaveTextContent('VIN TESTDATASAVED0001')
    expect(savedVehicle).toHaveTextContent('$42,500')
    expect(savedVehicle).toHaveTextContent('12,345 mi')
    expect(savedVehicle).toHaveTextContent('Engine / drive3.5L V6 · 4WD')
    expect(savedVehicle).toHaveTextContent('ExteriorSynthetic BlueInteriorSynthetic Black')
    expect(savedVehicle).toHaveTextContent('Transmission / fuel10-Speed Automatic · Gasoline · 18 city / 24 hwy MPG')
    expect(savedVehicle).toHaveTextContent('Standout equipment360-Degree Camera · Adaptive Cruise Control')
    expect(savedVehicle).toHaveTextContent('ListingPublic listing')
    expect(savedVehicle).toHaveTextContent('HoldPrimary hold')
    expect(savedVehicle).toHaveTextContent('LocationHowell')
    expect(savedVehicle).toHaveTextContent('ServiceWaiting for service')
    expect(saved).not.toHaveTextContent('STALEVIN')
    expect(saved).not.toHaveTextContent('Vehicle unavailable')
    expect(saved).not.toHaveTextContent('PRIVATE CUSTOMER TEXT')
    expect(within(saved).getByRole('link', { name: 'Open vehicle: 2026 Ford F-150 01' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATASAVED0001&returnTo=%2Foverview')
    fireEvent.click(within(saved).getByRole('button', { name: 'CD1' }))
    expect(syncedListsMock.mock.results[0].value.management.selectList).toHaveBeenCalledWith('list-b')
  })

  it('uses stable ownership for personal issues and omits personal claims without an identity', () => {
    const source = data()
    const view = renderOverview('employee-1', source)
    const personal = screen.getByRole('region', { name: 'My reported issues' })
    expect(personal).toHaveTextContent('1')
    expect(within(personal).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/attention?category=issues&issue=mine&scope=group')
    expect(within(personal).queryByRole('link', { name: 'Review', description: /same-name/ })).not.toBeInTheDocument()
    expect(within(personal).getAllByRole('link', { name: 'Review' })).toHaveLength(1)
    view.unmount()
    renderOverview(null, source)
    expect(screen.queryByRole('region', { name: 'My reported issues' })).not.toBeInTheDocument()
    expect(screen.getByText('Sign in with an employee identity to view customer saved lists.')).toBeVisible()
    expect(syncedListsMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, ownerId: null, context: JSON.stringify([null, 'sales', 'Howell', 'overview']) }))
  })

  it('opens a customer sheet directly for current saved vehicles and explains excluded entries', () => {
    renderOverview()
    const saved = screen.getByRole('region', { name: 'Customer saved lists' })
    expect(saved).toHaveTextContent('1 saved vehicle has no current authorized details.')
    expect(saved).toHaveTextContent('It stays in your list and is excluded from customer sheets.')
    fireEvent.click(within(saved).getByRole('button', { name: 'Customer sheet' }))
    const sheet = screen.getByRole('dialog', { name: 'Customer sheet preview' })
    expect(sheet).toHaveTextContent('AB')
    expect(sheet).toHaveTextContent('TESTDATASAVED0001')
    expect(sheet).not.toHaveTextContent('STALEVIN')
    expect(sheet).not.toHaveTextContent('TESTDATAOTHER0002')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close sheet' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes an open sheet when the employee changes and never revives the previous snapshot', () => {
    const props = { data: data(), stores, homeStore: 'Howell' as StoreName, role: 'sales' as const }
    const view = render(<MemoryRouter><SalesOverview {...props} currentUserId="employee-1" /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Customer sheet' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    view.rerender(<MemoryRouter><SalesOverview {...props} currentUserId="employee-2" /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<MemoryRouter><SalesOverview {...props} currentUserId="employee-1" /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes sheets on list selection changes, revocation, disabled lists or lost vehicle authorization', () => {
    const source = data()
    const props = { data: source, stores, homeStore: 'Howell' as StoreName, role: 'sales' as const, currentUserId: 'employee-1' }
    const view = render(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Customer sheet' }))
    open()
    syncedListsMock.mockReturnValue(shortlist({ management: { ...shortlist().management!, activeListId: 'list-b', activeLabel: 'CD' } }))
    view.rerender(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    open()
    syncedListsMock.mockReturnValue(shortlist({ management: { ...shortlist().management!, activeListId: 'list-b', accessRevoked: true } }))
    view.rerender(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Customer sheet' })).not.toBeInTheDocument()
    syncedListsMock.mockReturnValue(shortlist())
    view.rerender(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    open()
    view.rerender(<MemoryRouter><SalesOverview {...props} data={{ ...source, savedListsEnabled: false }} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    open()
    view.rerender(<MemoryRouter><SalesOverview {...props} data={{ ...source, vehicles: source.vehicles.filter(vehicle => vehicle.vin !== 'TESTDATASAVED0001') }} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('omits sheet actions for empty or entirely unavailable lists and printed snapshots', () => {
    syncedListsMock.mockReturnValue(shortlist({ entries: [{ ...shortlist().entries[1] }] }))
    const view = renderOverview()
    expect(screen.queryByRole('button', { name: 'Customer sheet' })).not.toBeInTheDocument()
    view.unmount()
    syncedListsMock.mockReturnValue(shortlist())
    render(<MemoryRouter><SalesOverview data={data()} stores={stores} homeStore="Howell" role="sales" currentUserId="employee-1" printing /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Customer sheet' })).not.toBeInTheDocument()
  })

  it('surfaces read errors with retry and gives revoked access its own state', () => {
    const retry = vi.fn()
    syncedListsMock.mockReturnValue(shortlist({ management: { ...shortlist().management!, error: 'Saved lists could not be read.', retry } }))
    const view = renderOverview()
    expect(screen.getByRole('alert')).toHaveTextContent('Saved lists could not be read.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
    view.unmount()
    syncedListsMock.mockReturnValue(shortlist({ entries: [], management: { ...shortlist().management!, accessRevoked: true, error: 'Your access changed.' } }))
    renderOverview()
    expect(screen.getByRole('alert')).toHaveTextContent('Your saved-list access changed. Reload or sign in again.')
    expect(screen.queryByText('Your access changed.')).not.toBeInTheDocument()
  })

  it('keeps operational facts separate and labels why vehicles appear without recommendation scoring', () => {
    renderOverview()
    const metrics = screen.getByRole('region', { name: 'Current store facts' })
    expect(within(metrics).getByRole('link', { name: 'On lot: 2' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=on-lot')
    expect(within(metrics).getByRole('link', { name: 'Hold signals: 1' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=holds')
    const relevant = screen.getByRole('region', { name: 'Other vehicles in scope' })
    expect(relevant).not.toHaveTextContent('2026 Ford F-150 01')
    expect(within(relevant).getAllByRole('listitem')).toHaveLength(1)
    expect(relevant).toHaveTextContent('Why shownreported issue')
    expect(relevant).toHaveTextContent('HoldNo current DealerMail hold found')
    expect(relevant).not.toHaveTextContent(/score|recommended/i)
    expect(screen.getByText(/does not confirm availability/)).toBeVisible()
  })

  it.each(['missing', 'unknown'] as const)('keeps %s service evidence in the review count without claiming a confirmed state', (state) => {
    const source = data()
    source.overview = undefined
    source.vehicleIssues = []
    const reviewVehicle = vehicle('TESTDATAREVIEW0003', {
      serviceReadiness: state === 'missing' ? undefined : { ...vehicle('review').serviceReadiness!, vin: 'TESTDATAREVIEW0003', status: 'unknown' },
    })
    source.vehicles = [source.vehicles[0], reviewVehicle, source.vehicles[1]]
    renderOverview('employee-1', source)

    const metrics = screen.getByRole('region', { name: 'Current store facts' })
    expect(within(metrics).getByRole('link', { name: 'Waiting for service: 2' })).toBeVisible()
    const relevant = screen.getByRole('region', { name: 'Other vehicles in scope' })
    const rows = within(relevant).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('2026 Ford F-150 03')
    expect(within(rows[0]).getByText('Service status not recorded')).toBeVisible()
    expect(within(rows[0]).getByText('service attention')).toBeVisible()
    expect(rows[1]).toHaveTextContent('2026 Ford F-150 02')
    expect(within(rows[0]).queryByText('Waiting for service')).not.toBeInTheDocument()
  })

  it('uses valid broad actions when the scope contains more than one store', () => {
    const source = data()
    render(<MemoryRouter><SalesOverview data={source} stores={['Howell', 'Lincoln']} homeStore="Howell" role="sales" currentUserId="employee-1" /></MemoryRouter>)
    const metrics = screen.getByRole('region', { name: 'Current store facts' })
    expect(within(metrics).getByRole('link', { name: 'Browse group inventory: 2' })).toHaveAttribute('href', '/inventory?scope=group')
    // Attention lists exceptions; this count includes ordinary active holds too.
    expect(within(metrics).getByRole('link', { name: 'Hold signals: 1' })).toHaveAttribute('href', '/inventory?scope=group&store=all&view=holds')
    expect(metrics.querySelector('a[href*="view=on-lot"]')).not.toBeInTheDocument()
  })

  it('attributes provider-only holds to home ownership and keeps counted VINs in the drilldown', () => {
    const source = data()
    const providerVehicle = (vin: string, changes: Partial<VehicleRecord> = {}) => vehicle(vin, {
      homeStore: 'Lincoln', sourceReportedLocation: 'Lincoln',
      movement: { state: 'source_reported', label: 'Source-reported', currentLocation: 'Lincoln', locationConfidence: 'reported' },
      ...changes,
      operationalEvidence: { records: [{ vin, provider: 'synthetic-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-10-10T12:00:00Z', dataState: 'current', readOnly: true, complete: true, holdState: 'held' }] },
    })
    const home = providerVehicle('TESTDATAHOLD00001', { homeStore: 'Howell', crmStore: 'Lincoln' })
    const visitor = providerVehicle('TESTDATAHOLD00002', { movement: { state: 'arrived', label: 'Visiting', currentLocation: 'Howell', locationConfidence: 'verified' } })
    const sourceLocated = providerVehicle('TESTDATAHOLD00003', { sourceReportedLocation: 'Howell' })
    const crmLocated = providerVehicle('TESTDATAHOLD00004', { crmStore: 'Howell' })
    const dealerMail = vehicle('TESTDATAHOLD00005', { homeStore: 'Lincoln', crmStore: 'Howell', hold: { state: 'primary', label: 'Primary hold', backupCount: 0 } })
    const both = providerVehicle('TESTDATAHOLD00006', { crmStore: 'Howell', hold: dealerMail.hold })
    home.operationalEvidence!.records.push({ ...home.operationalEvidence!.records[0], provider: 'synthetic-dms' })
    source.vehicles = [home, visitor, sourceLocated, crmLocated, dealerMail, both]
    source.overview = overview(source.vehicles)
    source.overview.stores[0].holds = 2
    source.overview.stores.push({ ...source.overview.stores[0], store: 'Lincoln', holds: 0 })
    source.overview.vehicleFacts[dealerMail.vin].holdActive = true
    source.overview.vehicleFacts[both.vin].holdActive = true
    const drilldownVins = (store: StoreName | 'all') => source.vehicles
      .filter(item => vehicleMatchesOverviewView(toInventoryVehicle(item, source), { view: 'holds', store }))
      .map(item => item.vin)
    const view = render(<MemoryRouter><SalesOverview data={source} stores={stores} homeStore="Howell" role="sales" currentUserId="employee-1" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Hold signals: 3' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=holds')
    expect(drilldownVins('Howell')).toEqual([home.vin, dealerMail.vin, both.vin])
    view.rerender(<MemoryRouter><SalesOverview data={source} stores={['Lincoln']} homeStore="Lincoln" role="sales" currentUserId="employee-1" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Hold signals: 3' })).toHaveAttribute('href', '/inventory?scope=group&store=Lincoln&view=holds')
    expect(drilldownVins('Lincoln')).toEqual([visitor.vin, sourceLocated.vin, crmLocated.vin])
    view.rerender(<MemoryRouter><SalesOverview data={source} stores={['Howell', 'Lincoln']} homeStore="Howell" role="sales" currentUserId="employee-1" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Hold signals: 6' })).toHaveAttribute('href', '/inventory?scope=group&store=all&view=holds')
    expect(drilldownVins('all')).toEqual(source.vehicles.map(item => item.vin))
    expect(screen.getByText(/does not confirm availability/)).toBeVisible()
  })

  it.each(['current', 'stale_unverified', 'incomplete'] as const)('counts %s provider positives exactly once with the held drilldown', (dataState) => {
    const source = data(), vin = 'TESTDATARETAIN001'
    source.vehicles = [vehicle(vin, { operationalEvidence: { records: [{ vin, provider: 'synthetic-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-10-10T12:00:00Z', dataState, readOnly: true, complete: dataState !== 'incomplete', holdState: 'held' }] } })]
    source.overview = overview(source.vehicles)
    source.overview.stores[0].holds = 0
    renderOverview('employee-1', source)
    expect(screen.getByRole('link', { name: 'Hold signals: 1' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=holds')
    expect(source.vehicles.filter(item => vehicleMatchesOverviewView(toInventoryVehicle(item, source), { view: 'holds', store: 'Howell' })).map(item => item.vin)).toEqual([vin])
  })

  it.each(['current', 'stale_unverified'] as const)('shows independent %s imported and manual hold signals beside the exact DealerMail fact', (dataState) => {
    const source = data(), vin = 'TESTDATAUIHOLD001'
    source.vehicles = [vehicle(vin, { operationalEvidence: { records: [{ vin, provider: 'synthetic-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-10-10T12:00:00Z', dataState, readOnly: true, complete: true, holdState: 'held' }] }, manualHold: { vin, state: 'requested', version: 1, expectedDeliveryDate: null, updatedAt: null, ownerStore: 'Howell', enabled: true, canManage: false, customerLabel: 'PRIVATE MANUAL CUSTOMER' } })]
    source.overview = overview(source.vehicles)
    const view = renderOverview('employee-1', source)
    const region = screen.getByRole('region', { name: 'Other vehicles in scope' })
    expect(region).toHaveTextContent('HoldNo current DealerMail hold found')
    expect(region).toHaveTextContent('Synthetic CRM')
    expect(region).toHaveTextContent(dataState === 'current' ? 'Hold observed' : 'Hold status not verified')
    expect(region).toHaveTextContent('Pending approval')
    expect(region).not.toHaveTextContent('PRIVATE MANUAL CUSTOMER')
    source.vehicles[0].manualHold!.state = 'active'
    view.rerender(<MemoryRouter><SalesOverview data={{ ...source }} stores={stores} homeStore="Howell" role="sales" currentUserId="employee-1" /></MemoryRouter>)
    expect(region).toHaveTextContent('Approved hold')
    expect(region).not.toHaveTextContent('Pending approval')
  })

  it('keeps negative, unknown and conflicting provider facts distinct and counts only positive VINs', () => {
    const source = data()
    source.vehicles = ['not_observed', 'unknown', 'held'].map((holdState, index) => {
      const vin = `TESTDATAUIFACT00${index + 1}`
      const records = [{ vin, provider: 'synthetic-crm', sourceLabel: 'Synthetic CRM', capturedAt: '2026-10-10T12:00:00Z', dataState: 'current' as const, readOnly: true as const, complete: true, holdState: holdState as 'not_observed' | 'unknown' | 'held' }]
      if (holdState === 'held') records.push({ ...records[0], provider: 'synthetic-dms', sourceLabel: 'Synthetic DMS', holdState: 'not_observed' })
      return vehicle(vin, { operationalEvidence: { records } })
    })
    source.overview = overview(source.vehicles)
    source.overview.stores[0].holds = 0
    renderOverview('employee-1', source)
    expect(screen.getByRole('link', { name: 'Hold signals: 1' })).toBeVisible()
    const rows = within(screen.getByRole('region', { name: 'Other vehicles in scope' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Synthetic CRMNo hold observed')
    expect(rows[1]).toHaveTextContent('Synthetic CRMHold status not verified')
    expect(rows[2]).toHaveTextContent('Synthetic CRMHold observed')
    expect(rows[2]).toHaveTextContent('Synthetic DMSNo hold observed')
    for (const row of rows) expect(row).toHaveTextContent('HoldNo current DealerMail hold found')
    expect(source.vehicles.filter(item => vehicleMatchesOverviewView(toInventoryVehicle(item, source), { view: 'holds', store: 'Howell' })).map(item => item.vin)).toEqual([source.vehicles[2].vin])
  })

  it('keeps broad inventory totals stable when selecting a different saved list', () => {
    const source = data()
    const props = { data: source, stores: ['Howell', 'Lincoln'] as StoreName[], homeStore: 'Howell' as StoreName, role: 'sales' as const, currentUserId: 'employee-1' }
    const view = render(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Browse inventory' })).toHaveAttribute('href', '/inventory?scope=group')
    expect(screen.getByRole('link', { name: 'Browse group inventory: 2' })).toBeVisible()
    syncedListsMock.mockReturnValue(shortlist({ entries: [] }))
    view.rerender(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Browse group inventory: 2' })).toBeVisible()
  })

  it('includes all scoped vehicles, personal issues and active moves in a printed snapshot', () => {
    const source = data()
    source.vehicles = Array.from({ length: 6 }, (_, index) => vehicle(`TESTDATAPRINT${String(index).padStart(4, '0')}`))
    source.vehicleIssues = source.vehicles.map((item, index) => issue(`print-${index}`, item.vin, 'employee-1'))
    source.transfers = source.vehicles.map((item, index): TransferRecord => ({
      id: `move-${index}`, vin: item.vin, stockNumber: item.stockNumber, vehicleName: item.vehicleName, homeStore: 'Howell', requestingStore: 'Lincoln', currentLocation: 'Howell', destination: 'Lincoln', requestStatus: 'requested', movementStatus: 'waiting', dealStatus: 'none', deliveryStatus: 'none', dealerMailHoldState: 'none_observed', publicListingState: 'Listed', cdkStatus: 'Not checked', priority: 'normal', requestedBy: 'Synthetic Employee', requestedAt: '2026-09-30T12:00:00Z', nextAction: 'Review request', nextActionOwner: 'Store manager', returnRequired: true, locationConfidence: 'reported', events: [],
    }))
    const props = { data: source, stores, homeStore: 'Howell' as StoreName, role: 'sales' as const, currentUserId: 'employee-1' }
    const view = render(<MemoryRouter><SalesOverview {...props} /></MemoryRouter>)
    expect(within(screen.getByRole('region', { name: 'Other vehicles in scope' })).getAllByRole('listitem')).toHaveLength(4)
    expect(within(screen.getByRole('region', { name: 'My reported issues' })).getAllByRole('listitem')).toHaveLength(4)
    expect(within(screen.getByRole('region', { name: 'Store moves' })).getAllByRole('listitem')).toHaveLength(3)
    view.rerender(<MemoryRouter><SalesOverview {...props} printing /></MemoryRouter>)
    for (const name of ['Other vehicles in scope', 'My reported issues', 'Store moves']) expect(within(screen.getByRole('region', { name })).getAllByRole('listitem')).toHaveLength(6)
  })
})
