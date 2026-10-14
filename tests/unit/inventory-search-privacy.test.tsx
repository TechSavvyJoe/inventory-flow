// PRODUCT-RULE TEST
import { useLocation } from 'react-router-dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttentionPage } from '../../src/features/attention/AttentionPage'
import { InventoryPage } from '../../src/features/inventory/InventoryPage'
import { ServicePage } from '../../src/features/service/ServicePage'
import { TransfersPage } from '../../src/features/transfers/TransfersPage'
import {
  createInventorySearchNavigation,
  inventorySearchAccessContext,
} from '../../src/lib/inventory-navigation'
import type { BootstrapData, StoreName, TransferRecord, UserRole, VehicleRecord } from '../../src/types'

const mockState = vi.hoisted(() => ({
  role: 'manager' as UserRole,
  homeStore: 'Howell' as StoreName,
}))

const bootstrapData: BootstrapData = {
  meta: {
    reportDate: '2026-08-29',
    completedAt: '2026-08-29T13:00:00.000Z',
    timezone: 'America/New_York',
    publicFreshness: 'current',
    dealerMailFreshness: 'current',
    publicCount: 0,
    crmCount: 0,
    heldVinCount: 0,
    publicChangeCounts: {
      newArrival: 0,
      removed: 0,
      priceChange: 0,
      mileageChange: 0,
      websiteStatusChange: 0,
      stockCorrection: 0,
      storeTransfer: 0,
    },
    holdChangeStatus: 'baseline',
    warnings: [],
  },
  stores: [],
  vehicles: [],
  transfers: [],
  attention: [],
}

// Each workflow page lists one synthetic row, so its own search box renders.
const pageVehicle = {
  vin: 'TESTDATAHWELL0002', stockNumber: 'SYNTHETIC-002', vehicleName: 'Synthetic Ford 002', homeStore: 'Howell', publicStore: 'Howell',
  serviceReadiness: { vin: 'TESTDATAHWELL0002', status: 'needs_service', version: 0, serviceEnteredAt: null, completedAt: null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: true },
} as VehicleRecord

const pageTransfer: TransferRecord = {
  id: 'synthetic-move-1',
  vin: 'TESTDATAHWELL0003',
  stockNumber: 'SYNTHETIC-003',
  vehicleName: 'Synthetic Ford 003',
  homeStore: 'Howell',
  requestingStore: 'Fowlerville',
  currentLocation: 'Howell',
  destination: 'Fowlerville',
  requestStatus: 'approved',
  movementStatus: 'release approved',
  dealStatus: 'decision pending',
  deliveryStatus: 'not confirmed',
  dealerMailHoldState: 'none',
  publicListingState: 'listed',
  cdkStatus: 'unknown',
  priority: 'normal',
  requestedBy: 'Synthetic salesperson',
  requestedAt: '2026-08-29T14:00:00.000Z',
  custodian: 'Synthetic custodian',
  transportAssignee: 'Synthetic driver',
  nextAction: 'Assign a driver',
  nextActionOwner: 'Synthetic manager',
  dueAt: '2026-09-01T15:00:00.000Z',
  returnRequired: true,
  returnDueAt: '2026-09-02T15:00:00.000Z',
  lastConfirmedAt: '2026-08-29T15:00:00.000Z',
  locationConfidence: 'verified',
  allowedActions: [],
  events: [],
}

const pageData: BootstrapData = {
  ...bootstrapData,
  vehicles: [pageVehicle],
  transfers: [pageTransfer],
}

const dataState = vi.hoisted(() => ({ usePageData: false }))

vi.mock('../../src/app/AppDataContext', () => ({
  useAppData: () => ({
    data: dataState.usePageData ? pageData : bootstrapData,
    loading: false,
    error: null,
    role: mockState.role,
    homeStore: mockState.homeStore,
    setRole: vi.fn(),
    setHomeStore: vi.fn(),
    refresh: vi.fn(async () => undefined),
    submitTransfer: vi.fn(),
    addTransferEvent: vi.fn(),
  }),
}))

vi.mock('../../src/features/inventory/InventoryExperience', () => ({
  InventoryExperience: ({ initialQuery }: { initialQuery?: string }) => (
    <output data-testid="inventory-query">{initialQuery}</output>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}
    </output>
  )
}

describe('inventory search privacy flow', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    mockState.role = 'manager'
    mockState.homeStore = 'Howell'
    dataState.usePageData = false
  })

  it('consumes and then clears the transient query state', async () => {
    const navigation = createInventorySearchNavigation(
      'private alert phrase',
      inventorySearchAccessContext('manager', 'Howell'),
    )

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: navigation.pathname,
            search: navigation.search,
            state: navigation.state,
          },
        ]}
      >
        <Routes>
          <Route path="/inventory" element={<><InventoryPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('inventory-query')).toHaveTextContent('private alert phrase')
    await waitFor(() => {
      const location = JSON.parse(screen.getByTestId('location').textContent || '{}') as {
        search: string
        state: unknown
      }
      expect(location.search).toBe('?scope=home')
      expect(location.state).toBeNull()
    })
    expect(screen.getByTestId('inventory-query')).toHaveTextContent('private alert phrase')
  })

  it('preserves a legacy public deep-link query in memory while removing q from the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/inventory?q=F-150&scope=group']}>
        <Routes>
          <Route path="/inventory" element={<><InventoryPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('inventory-query')).toHaveTextContent('F-150')
    await waitFor(() => {
      const location = JSON.parse(screen.getByTestId('location').textContent || '{}') as {
        search: string
      }
      expect(location.search).toBe('?scope=group')
    })
    expect(screen.getByTestId('inventory-query')).toHaveTextContent('F-150')
  })

  it('drops an already-consumed query immediately when access context changes', async () => {
    const navigation = createInventorySearchNavigation(
      'customer surname',
      inventorySearchAccessContext('manager', 'Howell'),
    )
    const view = render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: navigation.pathname,
            search: navigation.search,
            state: navigation.state,
          },
        ]}
      >
        <Routes>
          <Route path="/inventory" element={<InventoryPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('inventory-query')).toHaveTextContent('customer surname'))
    mockState.role = 'porter'
    await act(async () => {
      view.rerender(
        <MemoryRouter initialEntries={['/inventory?scope=group']}>
          <Routes>
            <Route path="/inventory" element={<InventoryPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    expect(screen.getByTestId('inventory-query')).toHaveTextContent('')
  })

  it.each([
    ['/transfers', 'combobox', 'Search vehicle moves', TransfersPage],
    ['/service', 'combobox', 'Search service vehicles', ServicePage],
    ['/attention', 'combobox', 'Search work queue', AttentionPage],
  ] as const)('keeps a typed %s page search in memory and out of the URL', async (route, searchRole, searchName, Page) => {
    dataState.usePageData = true
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={route} element={<><Page /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )

    const search = screen.getByRole(searchRole, { name: searchName })
    await user.type(search, 'Customer asks for evening call')
    expect(search).toHaveValue('Customer asks for evening call')

    const location = JSON.parse(screen.getByTestId('location').textContent || '{}') as {
      pathname: string
      search: string
      state: unknown
    }
    expect(location.pathname).toBe(route)
    expect(`${location.search}${JSON.stringify(location.state)}`).not.toMatch(/Customer|evening/i)
    expect(window.location.href).not.toMatch(/Customer|evening/i)
  })

})
