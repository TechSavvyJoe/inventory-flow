import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type {
  AppDisposition,
  BootstrapData,
  OverviewServiceStoreMetrics,
  OverviewStoreCounts,
  OverviewSummary,
  OverviewVehicleFacts,
  StoreName,
  UserRole,
  VehicleRecord,
} from '../../types'
import { OverviewPage } from './OverviewPage'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const { useAppDataMock } = vi.hoisted(() => ({ useAppDataMock: vi.fn() }))

vi.mock('../../app/AppDataContext', () => ({ useAppData: () => useAppDataMock() }))
const api = vi.hoisted(() => ({ getDisposition: vi.fn(), updateDisposition: vi.fn() }))
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), ...api }))

const STORES: StoreName[] = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']

function vehicle(vin: string, homeStore: StoreName, overrides: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    vin,
    stockNumber: `SYN-${vin.slice(-3)}`,
    make: 'Ford',
    model: 'F-150',
    vehicleName: `2026 Ford F-150 ${vin.slice(-3)}`,
    publicStore: homeStore,
    homeStore,
    homeStoreConfirmed: true,
    sourceReportedLocation: homeStore,
    websiteStatus: 'Listed',
    publicListing: 'listed',
    publicListingState: 'Listed publicly; availability not confirmed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current DealerMail hold found', backupCount: 0 },
    movement: { state: 'source_reported', label: 'Source-reported', currentLocation: homeStore, locationConfidence: 'reported' },
    ...overrides,
  }
}

function counts(overrides: Partial<OverviewStoreCounts> = {}): OverviewStoreCounts {
  return {
    onLot: 0, onLotSourceReported: 0, away: 0, visiting: 0, inTransit: 0, conflict: 0,
    holds: 0, holdsPastExpected: 0, waitingForService: 0, inService: 0, ready: 0,
    aged60: 0, aged90: 0, unaccounted: 0, returnOverdue: 0, recordsIncomplete: 0, listed: 0, preListing: 0,
    ...overrides,
  }
}

function serviceMetrics(overrides: Partial<OverviewServiceStoreMetrics> = {}): OverviewServiceStoreMetrics {
  return {
    counts: { waitingForService: 0, inService: 0, ready: 0 },
    basis: { manager_updated: 0, ford_service_history_inspection: 0, autocheck_post_intake_inspection: 0, new_arrival: 0, unconfirmed: 0, legacy_review: 0 },
    arrivalBasis: { intake: 0, listing_date: 0, unknown: 0 },
    medians: { receiptToStartDays: { value: null, n: 0 }, inServiceDays: { value: null, n: 0 }, receiptToReadyDays: { value: null, n: 0 } },
    agedWaiting14: 0,
    agedWaiting30: 0,
    ...overrides,
  }
}

const baseFacts = (overrides: Partial<OverviewVehicleFacts> = {}): OverviewVehicleFacts => ({
  custody: 'on_lot',
  custodyBasis: 'source_reported',
  currentStore: 'Howell',
  records: { autoCheck: true, oasis: false, sticker: true, invoice: false, fordHistory: false },
  recordsCaptured: 2,
  recordsApplicable: 5,
  service: { status: 'needs_service', basis: 'unconfirmed', store: 'Howell', arrivalBasis: 'listing_date', arrivalDate: '2026-09-01', waitingDays: 24 },
  ...overrides,
})

function bootstrap(role: UserRole = 'manager'): BootstrapData {
  const local = vehicle('TESTDATAHWELL0001', 'Howell', { crmStore: 'Howell', hold: { state: 'primary', label: 'Primary hold', backupCount: 0 } })
  const away = vehicle('TESTDATAHWELL0002', 'Howell', {
    movement: { state: 'at_requesting_store', label: 'At requesting store', currentLocation: 'Lincoln', locationConfidence: 'verified', departedAt: '2026-09-22T12:00:00Z', transferId: 'move-1' },
  })
  const returning = vehicle('TESTDATAHWELL0003', 'Howell', {
    movement: { state: 'return_in_transit', label: 'Returning', currentLocation: 'In transit', locationConfidence: 'verified', departedAt: '2026-09-20T12:00:00Z', transferId: 'move-2' },
  })
  const lincoln = vehicle('TESTDATALNCN00001', 'Lincoln')
  const overview: OverviewSummary = {
    asOfDay: '2026-09-25',
    scopeStore: 'Howell',
    role,
    access: role === 'sales' ? 'read_only' : 'full',
    thresholds: { unaccountedAfterDays: 7, agedListingDays: [60, 90], serviceWaitingDays: [14, 30], listedAfterDeliveredDays: 3, recentReceiptDays: 7 },
    stores: STORES.map((store) => store === 'Howell'
      ? { store, ...counts({ onLot: 1, onLotSourceReported: 1, away: 1, inTransit: 1, holds: 1, holdsPastExpected: 1, waitingForService: 3, returnOverdue: 1, unaccounted: 1, recordsIncomplete: 3, listed: 3 }) }
      : { store, ...counts(store === 'Lincoln' ? { onLot: 1, onLotSourceReported: 1, visiting: 1, waitingForService: 1 } : {}) }),
    group: counts({ onLot: 2, away: 1, inTransit: 1, holds: 1, waitingForService: 4 }),
    board: { flows: [] },
    vehicleFacts: {
      [local.vin]: baseFacts({ holdActive: true, holdPastExpected: true, holdState: 'primary' }),
      [away.vin]: baseFacts({ custody: 'away', custodyBasis: 'ledger', currentStore: 'Lincoln', daysAway: 3, departedAt: '2026-09-22T12:00:00Z', returnDueAt: '2026-09-24T12:00:00Z', returnOverdue: true, unaccounted: { reason: 'stale_confirmation', days: 8 } }),
      [returning.vin]: baseFacts({ custody: 'in_transit', custodyBasis: 'ledger', currentStore: undefined, returnLeg: 'return', daysAway: 5, departedAt: '2026-09-20T12:00:00Z' }),
      [lincoln.vin]: baseFacts({ currentStore: 'Lincoln', service: { status: 'needs_service', basis: 'unconfirmed', store: 'Lincoln', arrivalBasis: 'unknown' } }),
    },
    service: {
      perStore: STORES.map((store) => ({ store, ...serviceMetrics(store === 'Howell' ? { counts: { waitingForService: 3, inService: 0, ready: 0 }, agedWaiting14: 3, medians: { receiptToStartDays: { value: 4, n: 2 }, inServiceDays: { value: null, n: 0 }, receiptToReadyDays: { value: 6.5, n: 2 } } } : {}) })),
      group: serviceMetrics({ counts: { waitingForService: 4, inService: 0, ready: 0 } }),
      agedWaiting: [{ vin: local.vin, store: 'Howell', waitingDays: 24, arrivalBasis: 'listing_date' }],
    },
    exceptions: [
      { kind: 'stale_confirmation', store: 'Howell', count: 1, vins: [away.vin] },
      { kind: 'return_overdue', store: 'Howell', count: 1, vins: [away.vin], transferIds: ['move-1'] },
      { kind: 'hold_past_expected', store: 'Howell', count: 1, vins: [local.vin] },
      { kind: 'service_date_order', store: 'Howell', count: 1, vins: [local.vin] },
    ],
  }
  return {
    meta: {
      reportDate: '2026-09-25', completedAt: '2026-09-25T13:00:00-04:00', timezone: 'America/New_York', publicFreshness: 'current', dealerMailFreshness: 'current', resourceFreshness: 'current', publicCount: 4, crmCount: 4, heldVinCount: 1,
      publicChangeCounts: { newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 }, holdChangeStatus: 'current', warnings: [],
    },
    stores: STORES.map((store) => ({ store, publicUnits: 0, currentHolds: 0, awayFromHome: 0, visiting: 0, returnOverdue: 0, locationExceptions: 0 })),
    vehicles: [local, away, returning, lincoln],
    transfers: [],
    attention: [],
    overview,
  }
}

function renderAs(role: UserRole, data = bootstrap(role)) {
  useAppDataMock.mockReturnValue({ data, homeStore: 'Howell', role, currentUser: `Synthetic ${role}`, refresh: vi.fn().mockResolvedValue(undefined) })
  return render(<MemoryRouter><OverviewPage /></MemoryRouter>)
}

describe('OverviewPage (server projection)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens a store manager on their store with every count a link to the list behind it', () => {
    renderAs('manager')

    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
    expect(screen.getByRole('button', { name: 'My store · Howell' })).toHaveAttribute('aria-pressed', 'true')
    const summary = screen.getByRole('region', { name: 'Store summary' })
    expect(within(summary).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Howell'])
    expect(within(summary).getByRole('link', { name: 'Howell: 1 vehicle away from home' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=away')
    expect(within(summary).getByRole('link', { name: 'Howell: 1 vehicle on lot' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=on-lot')
    expect(within(summary).getByText('1 source-reported')).toBeVisible()
    expect(within(summary).getByRole('link', { name: 'Howell: 3 vehicles waiting for service' })).toHaveAttribute('href', '/service?status=needs_service&store=Howell')
    expect(within(summary).getByRole('link', { name: 'Howell: 1 vehicle with a return overdue' })).toHaveAttribute('href', '/transfers?view=return-overdue&store=Howell')
    // A zero is shown, never hidden, and is not a link.
    expect(within(summary).queryByRole('link', { name: /Howell: 0/ })).not.toBeInTheDocument()
    expect(within(summary).getAllByText('0').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(within(summary).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'])
    const lincoln = within(summary).getByRole('heading', { name: 'Lincoln' }).closest('section')!
    expect(within(lincoln).getByText('Moves as visible to you')).toBeVisible()
    expect(within(lincoln).getByRole('link', { name: 'Lincoln: 1 vehicle visiting from other stores' })).toHaveAttribute('href', '/inventory?scope=group&store=Lincoln&view=visiting')
  })

  it('lists where the inventory is with days away, the basis word, and a Records link on every row', () => {
    renderAs('manager')

    const where = screen.getByRole('region', { name: 'Where is my inventory' })
    expect(within(where).getByRole('status')).toHaveTextContent('2 vehicles · Away from home')
    const rows = within(where).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const awayRow = rows[0]
    expect(awayRow).toHaveTextContent('Away · at Lincoln')
    expect(awayRow).toHaveTextContent('3 days away · since 09/22/2026')
    expect(awayRow).toHaveTextContent('Return due 09/24/2026 · Overdue')
    expect(awayRow).toHaveTextContent('Unaccounted · not confirmed for 8 days')
    // A ledger-confirmed location carries no tag; only an unconfirmed one does.
    expect(within(awayRow).queryByText('source-reported')).not.toBeInTheDocument()
    expect(within(awayRow).getByRole('link', { name: /Move for 2026 Ford F-150 002/ })).toHaveAttribute('href', '/transfers?id=move-1&returnTo=%2Foverview')
    expect(rows[1]).toHaveTextContent('In transit · returning home')
    for (const row of rows) {
      expect(within(row).getByRole('link', { name: /^Records 2\/5 for / })).toHaveAttribute('href', expect.stringContaining('tab=data'))
    }

    fireEvent.click(within(where).getByRole('button', { name: /Holds/ }))
    const held = within(where).getAllByRole('listitem')
    expect(held).toHaveLength(1)
    expect(held[0]).toHaveTextContent('Primary hold · past expected')
    expect(within(held[0]).getByText('source-reported')).toBeVisible()

    fireEvent.click(within(where).getByRole('button', { name: /Waiting for service/ }))
    expect(within(where).getAllByRole('listitem')[0]).toHaveTextContent('Waiting 24 days · arrived 09/01/2026 (listing date)')
  })

  it('shows return-home verification with a manager action, and exceptions with fixed copy and drill-downs', () => {
    renderAs('manager')

    const howell = screen.getByRole('heading', { name: 'Howell', level: 3 }).closest('section')!
    expect(within(howell).getByRole('heading', { name: 'Return-home verification' })).toBeVisible()
    expect(within(howell).getByRole('link', { name: 'Confirm 2026 Ford F-150 003 back home' })).toHaveAttribute('href', '/transfers?id=move-2&returnTo=%2Foverview')

    const exceptions = screen.getByRole('region', { name: 'Exceptions' })
    expect(within(exceptions).getByText('Not confirmed for 7+ days')).toBeVisible()
    expect(within(exceptions).getByText('Away from home with no custody confirmation for 7+ days.')).toBeVisible()
    expect(within(exceptions).getByRole('link', { name: 'Howell: 1 vehicle · Return overdue' })).toHaveAttribute('href', '/transfers?view=return-overdue&store=Howell')
    expect(within(exceptions).getByRole('link', { name: 'Howell: 1 vehicle · Hold past expected date' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=holds-past-expected')
    expect(within(exceptions).getByRole('link', { name: 'Open in Action center' })).toHaveAttribute('href', '/attention?category=holds')
    expect(within(exceptions).getByRole('link', { name: 'Howell: 1 vehicle · Service dates before arrival' })).toHaveAttribute('href', '/inventory?scope=group&vins=TESTDATAHWELL0001')
  })

  it('groups exceptions by type: one heading and one explanation, then a count per store, most urgent first', () => {
    const data = bootstrap('group_manager')
    data.overview!.exceptions = [
      ...STORES.map((store) => ({ kind: 'records_incomplete' as const, store, count: 2, vins: [] })),
      { kind: 'hold_past_expected', store: 'Lincoln', count: 3, vins: [] },
      { kind: 'return_overdue', store: 'Howell', count: 1, vins: [], transferIds: ['move-1'] },
    ]
    renderAs('group_manager', data)
    const exceptions = screen.getByRole('region', { name: 'Exceptions' })
    const types = within(exceptions).getAllByRole('heading', { level: 3 })
    expect(types.map((heading) => heading.textContent)).toEqual(['Return overdue', 'Hold past expected date', 'Records not all captured'])
    // The explanation reads for any count and appears once for the type, not once per store.
    expect(within(exceptions).getAllByText('Vehicles missing one or more of AutoCheck, OASIS, sticker, invoice or Ford service history.')).toHaveLength(1)
    expect(exceptions).not.toHaveTextContent('for this unit')
    for (const store of STORES) {
      expect(within(exceptions).getByRole('link', { name: `${store}: 2 vehicles · Records not all captured` })).toHaveAttribute('href', expect.stringMatching(/^\/inventory\?scope=group&store=.+&view=records-incomplete$/))
    }
    // The hold explanation stays exact, and the Action center link appears once, with its type.
    expect(within(exceptions).getByText('The DealerMail expected date has passed; a review signal, not proof of sale or release.')).toBeVisible()
    expect(within(exceptions).getAllByRole('link', { name: 'Open in Action center' })).toHaveLength(1)
    expect(within(exceptions).getByRole('link', { name: 'Lincoln: 3 vehicles · Hold past expected date' })).toHaveTextContent('3')
  })

  it('leads with service workload and oldest waits, with timing available on demand and in print', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(within(screen.getByRole('region', { name: 'Service' })).getByRole('table', { name: 'Service timing & evidence' })).toBeVisible()
    })
    renderAs('manager')

    const service = screen.getByRole('region', { name: 'Service' })
    const table = within(service).getByRole('table', { name: 'Service workload' })
    const howellRow = within(table).getByRole('rowheader', { name: 'Howell' }).closest('tr')!
    expect(within(howellRow).getByRole('link', { name: 'Howell: 3 vehicles waiting for service' })).toHaveAttribute('href', '/service?status=needs_service&store=Howell')
    expect(within(table).getByRole('columnheader', { name: 'Waiting 14+ days' })).toBeVisible()
    expect(within(table).getByRole('columnheader', { name: 'Waiting 30+ days' })).toBeVisible()
    expect(within(howellRow).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['3', '0', '0', '3', '0'])
    expect(within(service).queryByRole('table', { name: 'Service timing & evidence' })).not.toBeInTheDocument()
    const aged = within(service).getByRole('list')
    expect(within(aged).getByRole('link', { name: 'Records 2/5 for 2026 Ford F-150 001' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Foverview')
    expect(within(aged).getByRole('link', { name: 'Update service for 2026 Ford F-150 001' })).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2Foverview')
    expect(within(aged).getByText('From listing date; arrival unconfirmed')).toBeVisible()

    fireEvent.click(within(service).getByRole('button', { name: 'Service timing & evidence' }))
    const timing = within(service).getByRole('table', { name: 'Service timing & evidence' })
    const timingHowell = within(timing).getByRole('rowheader', { name: 'Howell' }).closest('tr')!
    expect(timingHowell).toHaveTextContent('4 days · 2 vehicles')
    expect(timingHowell).toHaveTextContent('6.5 days · 2 vehicles')
    expect(within(service).getByText(/listing dates can lag physical receipt/)).toBeVisible()
    fireEvent.click(within(service).getByRole('button', { name: 'Service timing & evidence' }))

    fireEvent.click(within(service).getByRole('button', { name: 'Open report' }))
    expect(print).toHaveBeenCalledOnce()
  })

  it('opens a group manager on all stores and prints the daily snapshot', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderAs('group_manager')

    expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Moves as visible to you')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Service workload' })).getByRole('rowheader', { name: 'All stores' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Print daily snapshot' }))
    expect(print).toHaveBeenCalledOnce()
    expect(screen.getByText(/Inventory Flow · Daily snapshot · All stores · As of 09\/25\/2026/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing here asserts availability/)).toBeInTheDocument()
  })

  it('prints the first 15 away rows and says how many more were left off', () => {
    const data = bootstrap('manager')
    const overview = data.overview!
    for (let index = 0; index < 18; index += 1) {
      const vin = `TESTDATAHWAWY${String(index).padStart(4, '0')}`
      data.vehicles.push(vehicle(vin, 'Howell', {
        movement: { state: 'at_requesting_store', label: 'At requesting store', currentLocation: 'Lincoln', locationConfidence: 'verified', transferId: `move-extra-${index}` },
      }))
      overview.vehicleFacts[vin] = baseFacts({ custody: 'away', custodyBasis: 'ledger', currentStore: 'Lincoln', daysAway: 1 })
    }
    renderAs('manager', data)
    const where = screen.getByRole('region', { name: 'Where is my inventory' })
    expect(within(where).getByRole('status')).toHaveTextContent('20 vehicles · Away from home')
    expect(within(where).getAllByRole('listitem')).toHaveLength(5)
    expect(within(where).queryByText(/and 5 more vehicles away from home/)).toBeInTheDocument()

    let printedRows = 0
    vi.spyOn(window, 'print').mockImplementation(() => {
      printedRows = within(where).getAllByRole('listitem').length
      expect(within(where).getByText('and 5 more vehicles away from home')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Print daily snapshot' }))
    // All 20 reach the DOM while printing; the print stylesheet shows the first 15.
    expect(printedRows).toBe(20)
    expect(within(where).getAllByRole('listitem')).toHaveLength(5)
  })

  it('folds the secondary store counts behind More counts on a phone', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 880px)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(screen.queryByText('More counts')).not.toBeInTheDocument()
    })
    renderAs('manager')
    const summary = screen.getByRole('region', { name: 'Store summary' })
    const more = within(summary).getByText('More counts').closest('details')!
    expect(more).not.toHaveAttribute('open')
    expect(within(summary).getByRole('link', { name: 'Howell: 1 vehicle away from home' })).toBeVisible()
    expect(within(more).getByRole('link', { name: 'Howell: 3 vehicles with records incomplete' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Print daily snapshot' }))
    expect(print).toHaveBeenCalledOnce()
  })

  it('gives sales the same picture read-only, with no manager actions', () => {
    renderAs('sales')
    expect(screen.getByRole('button', { name: 'Sales workspace' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: 'Store summary' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Store operations' }))

    expect(screen.getByText('Read-only')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Howell: 1 vehicle away from home' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Service' })).toBeVisible()
    expect(screen.queryByRole('link', { name: /^Update service/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /back home$/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /^Records / }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(screen.getAllByText('Moves as visible to you').length).toBeGreaterThan(0)
  })

  it('resets presentation for a different employee even when display names match', () => {
    const data = bootstrap('manager')
    const identity = { data, homeStore: 'Howell', role: 'manager', currentUser: 'Synthetic Employee', currentUserId: 'employee-1', refresh: vi.fn() }
    useAppDataMock.mockReturnValue(identity)
    const view = render(<MemoryRouter><OverviewPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Store operations' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Sales workspace' }))
    useAppDataMock.mockReturnValue({ ...identity, currentUserId: 'employee-2' })
    view.rerender(<MemoryRouter><OverviewPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Store operations' })).toHaveAttribute('aria-pressed', 'true')
    useAppDataMock.mockReturnValue({ ...identity, data: bootstrap('sales'), role: 'sales', currentUserId: 'employee-3' })
    view.rerender(<MemoryRouter><OverviewPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Sales workspace' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: 'Store summary' })).not.toBeInTheDocument()
  })

  it('never renders an availability claim or the no-hold string, and labels unverified holds', () => {
    const data = bootstrap('manager')
    data.meta.dealerMailFreshness = 'stale_unverified'
    renderAs('manager', data)

    expect(screen.queryByText(/Available/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No current DealerMail hold found/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Store summary' })).getByText('last verified')).toBeVisible()
  })

  it('explains when the bootstrap carries no Overview', () => {
    const data = bootstrap('manager')
    delete data.overview
    renderAs('manager', data)
    expect(screen.getByText('The Overview is not available for this account.')).toBeVisible()
  })
})

function disposition(vin: string, ownerStore: StoreName, code: AppDisposition['code'], canManage: boolean): AppDisposition {
  return { vin, code, version: code ? 1 : 0, effectiveDate: code ? '2026-09-20' : null, destinationStore: null, updatedAt: code ? '2026-09-20T15:00:00Z' : null, updatedByRole: code ? 'manager' : null, store: code ? ownerStore : null, ownerStore, canManage }
}

/** Recorded dispositions, one manager-log sale and the two disposition prompts. */
function withDispositions(role: UserRole): BootstrapData {
  const data = bootstrap(role)
  const manages = (store: StoreName) => role === 'group_manager' || (role === 'manager' && store === 'Howell')
  const [local, away, returning, lincoln] = data.vehicles
  local.appDisposition = disposition(local.vin, 'Howell', 'sold_pending', manages('Howell'))
  away.appDisposition = disposition(away.vin, 'Howell', null, manages('Howell'))
  returning.appDisposition = disposition(returning.vin, 'Howell', null, manages('Howell'))
  returning.managerDisposition = {
    stockNumber: returning.stockNumber, vin: returning.vin, vehicleName: returning.vehicleName, soldManagerLog: true, deliveredManagerLog: false, deliveryDate: null,
    confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false,
    soldLabel: 'Sold — manager log', deliveryLabel: 'Not marked delivered — manager log', dataState: 'current',
  }
  lincoln.vehicleName = '2026 Lincoln Nautilus Reserve'
  lincoln.appDisposition = disposition(lincoln.vin, 'Lincoln', 'wholesale', manages('Lincoln'))
  const overview = data.overview!
  for (const entry of overview.stores) {
    entry.dispositions = { keep: 0, sold_pending: entry.store === 'Howell' ? 1 : 0, delivered: 0, wholesale: entry.store === 'Lincoln' ? 1 : 0, transfer_out: 0, other: 0, none: entry.store === 'Howell' ? 2 : 0 }
  }
  overview.vehicleFacts[local.vin].disposition = 'sold_pending'
  overview.vehicleFacts[lincoln.vin].disposition = 'wholesale'
  overview.exceptions.push(
    { kind: 'listed_but_delivered', store: 'Howell', count: 1, vins: [local.vin] },
    ...(role === 'sales' ? [] : [{ kind: 'delivered_move_no_disposition' as const, store: 'Howell' as StoreName, count: 1, vins: [away.vin], transferIds: ['move-1'] }]),
  )
  return data
}

function withWorkQueue(role: UserRole): BootstrapData {
  const data = withDispositions(role)
  data.vehicleIssuesEnabled = true
  data.vehicles[0].listedPrice = 42_500
  data.vehicles[0].mileage = 12_345
  data.vehicles[0].imageUrl = '/demo-vehicles/synthetic-f150.svg'
  data.vehicleIssues = [{
    id: 'issue-1', vin: data.vehicles[0].vin, stockNumber: data.vehicles[0].stockNumber, vehicleName: data.vehicles[0].vehicleName,
    homeStore: 'Howell', reportStore: 'Howell', category: 'cleaning', priority: 'urgent', description: 'Synthetic detail needs attention.',
    status: 'awaiting_review', version: 2, assignee: 'Synthetic Detail Team', reportedBy: 'Synthetic Salesperson', reportedByUserId: 'synthetic-sales',
    reportedAt: '2026-09-24T12:00:00Z', updatedAt: '2026-09-25T12:00:00Z', completedAt: null, completedBy: null, photoCount: 2,
    allowedActions: role === 'sales' ? [] : ['complete', 'add_note'],
  }]
  return data
}

describe('Overview work queue and dispositions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    api.getDisposition.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('replaces the store board with vehicle-level work that opens the exact existing action', () => {
    renderAs('group_manager', withWorkQueue('group_manager'))
    expect(screen.queryByRole('region', { name: 'Store board' })).not.toBeInTheDocument()
    const queue = screen.getByRole('region', { name: 'Work queue' })
    expect(within(queue).getByRole('button', { name: 'Vehicle issues 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(queue).getByRole('link', { name: 'Vehicle issue log' })).toHaveAttribute('href', '/attention?category=issues&scope=group')
    expect(queue).toHaveTextContent('2026 Ford F-150 001')
    expect(queue).toHaveTextContent('$42,500 · 12,345 mi')
    expect(queue).toHaveTextContent('Cleaning · Urgent')
    expect(queue).toHaveTextContent('Synthetic Detail Team')
    expect(within(queue).getByRole('link', { name: /Review work/ })).toHaveAttribute('href', '/attention?category=issues&issue=issue-1&action=complete&scope=group')

    fireEvent.click(within(queue).getByRole('button', { name: 'Location & moves 1' }))
    expect(within(queue).getByRole('link', { name: /Open move/ })).toHaveAttribute('href', '/transfers?id=move-1&returnTo=%2Foverview')
    expect(queue).toHaveTextContent('Not confirmed recently')

    fireEvent.click(within(queue).getByRole('button', { name: 'Hold evidence 1' }))
    expect(within(queue).getByRole('link', { name: /Open hold evidence/ })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=hold&returnTo=%2Foverview')
    expect(queue).toHaveTextContent('confirm with the home store')

    fireEvent.click(within(queue).getByRole('button', { name: 'Exceptions 6' }))
    expect(within(queue).getAllByRole('link', { name: 'Review 1 vehicle' }).find((link) => link.getAttribute('href')?.includes('view=unaccounted'))).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=unaccounted')

    fireEvent.click(within(queue).getByRole('button', { name: 'Dispositions 4' }))
    expect(within(queue).getAllByRole('button', { name: 'Change disposition' }).length).toBeGreaterThan(0)
  })

  it('lets a group manager record or change any disposition, beside the manager log, with no note on the page', () => {
    renderAs('group_manager', withDispositions('group_manager'))
    const section = screen.getByRole('region', { name: 'Dispositions' })
    expect(within(section).getByRole('link', { name: 'Howell: 1 vehicle with the disposition sold pending' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=disposition-sold-pending')
    expect(within(section).getByRole('link', { name: 'Lincoln: 1 vehicle with the disposition wholesale' })).toHaveAttribute('href', '/inventory?scope=group&store=Lincoln&view=disposition-wholesale')
    expect(within(section).getByRole('link', { name: 'Howell: 2 vehicles with no disposition recorded' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=disposition-none')
    expect(within(section).getByRole('button', { name: 'Change disposition for 2026 Lincoln Nautilus Reserve' })).toBeEnabled()
    expect(within(section).getByRole('button', { name: 'Change disposition for 2026 Ford F-150 001' }).closest('li')).toHaveTextContent('Sold pending')
    // The manager-log sale is a prompt beside the app record, never a recorded disposition.
    const logRow = within(section).getByRole('button', { name: 'Record disposition for 2026 Ford F-150 003' }).closest('li')!
    expect(logRow).toHaveTextContent('No disposition recorded')
    expect(logRow).toHaveTextContent('Sold — manager log · Not marked delivered — manager log · Howell · 2026-09')
    // A move that recorded delivery prompts; it does not record anything.
    expect(within(section).getByRole('button', { name: 'Record disposition for 2026 Ford F-150 002' }).closest('li')).toHaveTextContent('A move records customer delivery')
    const summary = screen.getByRole('region', { name: 'Store summary' })
    expect(within(summary).getByRole('link', { name: 'Howell: 1 vehicle with the disposition sold pending' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=disposition-sold-pending')
    expect(screen.queryByText(/Deposit|customer name/i)).not.toBeInTheDocument()
  })

  it.each([
    ['honors explicit server permission for a cross-store manager action', 'manager' as const, 'Lincoln' as const, true, true],
    ['honors explicit server refusal for a same-store manager action', 'manager' as const, 'Howell' as const, false, false],
    ['allows a legacy same-store manager row without a server flag', 'manager' as const, 'Howell' as const, undefined, true],
    ['blocks a legacy cross-store manager row without a server flag', 'manager' as const, 'Lincoln' as const, undefined, false],
    ['allows a legacy group-manager row without a server flag', 'group_manager' as const, 'Lincoln' as const, undefined, true],
  ])('%s', (_case, role, ownerStore, canManage, expected) => {
    const data = bootstrap(role)
    const target = data.vehicles[0]
    target.movement = { ...target.movement, currentLocation: ownerStore, locationConfidence: 'verified' }
    if (canManage !== undefined) {
      target.serviceReadiness = {
        vin: target.vin, status: 'needs_service', version: 0, serviceEnteredAt: null, completedAt: null,
        updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: ownerStore, canManage,
      }
    }
    data.overview!.service!.agedWaiting = [{ vin: target.vin, store: ownerStore, waitingDays: 24, arrivalBasis: 'listing_date' }]
    renderAs(role, data)
    if (role === 'manager' && ownerStore !== 'Howell') fireEvent.click(screen.getByRole('button', { name: 'All stores' }))

    const section = screen.getByRole('region', { name: 'Service' })
    const update = within(section).queryByRole('link', { name: 'Update service for 2026 Ford F-150 001' })
    expect(update !== null).toBe(expected)
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  })

  it('shows the two disposition prompts with fixed copy, never as inferences', () => {
    renderAs('manager', withDispositions('manager'))
    const exceptions = screen.getByRole('region', { name: 'Exceptions' })
    expect(within(exceptions).getByRole('link', { name: 'Howell: 1 vehicle · Recorded delivered · still listed' })).toHaveAttribute('href', '/inventory?scope=group&store=Howell&view=disposition-delivered')
    expect(exceptions).toHaveTextContent('Delivered in Inventory Flow 3+ days ago and still listed on the website. Confirm with the store; the listing is not changed here.')
    expect(within(exceptions).getByRole('link', { name: 'Howell: 1 vehicle · Move says delivered · no disposition' })).toHaveAttribute('href', '/transfers?id=move-1&returnTo=%2Foverview')
    expect(exceptions).toHaveTextContent('A move records customer delivery; no disposition has been recorded.')
  })

  it('lets a store manager record only for their own store and view another store read-only', () => {
    renderAs('manager', withDispositions('manager'))
    let section = screen.getByRole('region', { name: 'Dispositions' })
    expect(within(section).getByRole('button', { name: 'Change disposition for 2026 Ford F-150 001' })).toBeVisible()
    // My store scope lists only Howell-owned rows.
    expect(within(section).queryByText('2026 Lincoln Nautilus Reserve')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    section = screen.getByRole('region', { name: 'Dispositions' })
    expect(within(section).getByRole('button', { name: 'View disposition for 2026 Lincoln Nautilus Reserve' })).toBeVisible()
    expect(within(section).queryByRole('button', { name: /^(Change|Record) disposition for 2026 Lincoln Nautilus Reserve/ })).not.toBeInTheDocument()
  })

  it('gives sales dispositions read-only, with the note in the detail', async () => {
    api.getDisposition.mockResolvedValue({ ...disposition('TESTDATAHWELL0001', 'Howell', 'sold_pending', false), updatedBy: 'Synthetic Howell Manager', note: 'Delivery Friday', history: [] })
    renderAs('sales', withDispositions('sales'))
    fireEvent.click(screen.getByRole('button', { name: 'Store operations' }))
    const section = screen.getByRole('region', { name: 'Dispositions' })
    expect(within(section).queryByRole('button', { name: /^(Change|Record) disposition/ })).not.toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'View disposition for 2026 Ford F-150 001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disposition · 2026 Ford F-150 001' })
    await waitFor(() => expect(dialog).toHaveTextContent('Delivery Friday'))
    expect(within(dialog).queryByRole('button', { name: 'Save disposition' })).not.toBeInTheDocument()
    expect(api.getDisposition).toHaveBeenCalledWith('TESTDATAHWELL0001', 'sales', 'Howell')
  })

  it('returns focus to the exact row button that opened the dialog', async () => {
    api.getDisposition.mockResolvedValue({ ...disposition('TESTDATALNCN00001', 'Lincoln', 'wholesale', true), history: [] })
    renderAs('group_manager', withDispositions('group_manager'))
    const section = screen.getByRole('region', { name: 'Dispositions' })
    const opener = within(section).getByRole('button', { name: 'Change disposition for 2026 Lincoln Nautilus Reserve' })
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Disposition · 2026 Lincoln Nautilus Reserve' })
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    expect(within(section).getByRole('button', { name: 'Change disposition for 2026 Lincoln Nautilus Reserve' })).toBe(opener)
  })

  it('says disposition storage is not enabled instead of showing zeros or a way to record', () => {
    const data = withDispositions('group_manager')
    data.dispositionsEnabled = false
    for (const vehicle of data.vehicles) if (vehicle.appDisposition) vehicle.appDisposition = { ...vehicle.appDisposition, code: null, version: 0, canManage: false }
    renderAs('group_manager', data)
    const section = screen.getByRole('region', { name: 'Dispositions' })
    expect(within(section).getByRole('status')).toHaveTextContent('Disposition storage is not enabled yet.')
    expect(within(section).queryByRole('table')).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /disposition for/ })).not.toBeInTheDocument()
    // The manager-log evidence stays visible.
    expect(section).toHaveTextContent('Sold — manager log')
    const summary = screen.getByRole('region', { name: 'Store summary' })
    expect(within(summary).getAllByText('Disposition storage is not enabled yet.')).toHaveLength(4)
    expect(within(summary).queryByRole('link', { name: /with the disposition/ })).not.toBeInTheDocument()
  })

  it('keeps the work queue interactive on a phone without restoring the store board', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 880px)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
    renderAs('manager', withWorkQueue('manager'))
    const queue = screen.getByRole('region', { name: 'Work queue' })
    fireEvent.click(within(queue).getByRole('button', { name: 'Service 3' }))
    expect(within(queue).getAllByRole('link', { name: 'Update service' })[0]).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2Foverview')
    expect(screen.queryByRole('region', { name: 'Store board' })).not.toBeInTheDocument()
  })

  it('keeps a cross-store manager read-only in the work queue without an affirmative server decision', () => {
    const data = bootstrap('manager')
    const target = data.vehicles[0]
    target.movement = { ...target.movement, currentLocation: 'Lincoln', locationConfidence: 'verified' }
    data.overview!.service!.agedWaiting = [{ vin: target.vin, store: 'Lincoln', waitingDays: 24, arrivalBasis: 'listing_date' }]
    renderAs('manager', data)
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    const queue = screen.getByRole('region', { name: 'Work queue' })
    fireEvent.click(within(queue).getByRole('button', { name: 'Service 4' }))
    const targetLink = within(queue).getAllByRole('link', { name: 'View service' }).find((link) => link.getAttribute('href')?.includes('TESTDATAHWELL0001'))
    expect(targetLink).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2Foverview')
    expect(within(queue).getAllByRole('link', { name: 'Update service' }).some((link) => link.getAttribute('href')?.includes('TESTDATAHWELL0001'))).toBe(false)
  })

  it('keeps the dense decision ledgers in a stable reading order below the work queue', () => {
    renderAs('group_manager', withDispositions('group_manager'))
    const sections = () => ['Work queue', 'Where is my inventory', 'Exceptions', 'Dispositions'].map((name) => screen.getByRole('region', { name }))
    const inOrder = (...elements: HTMLElement[]) => elements.every((element, index) => index === 0 || Boolean(elements[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
    const [queue, where, exceptions, dispositions] = sections()
    expect(exceptions.parentElement).toBe(where.parentElement)
    expect(dispositions.parentElement).not.toBe(where.parentElement)
    expect(inOrder(queue, where, exceptions, dispositions)).toBe(true)
  })
})
