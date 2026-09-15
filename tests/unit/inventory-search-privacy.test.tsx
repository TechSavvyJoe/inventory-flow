import { useLocation } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../../src/app/AppShell'
import { InventoryPage } from '../../src/features/inventory/InventoryPage'
import {
  createInventorySearchNavigation,
  inventorySearchAccessContext,
} from '../../src/features/inventory/inventory-navigation'
import type { BootstrapData, StoreName, UserRole } from '../../src/types'

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

vi.mock('../../src/app/AppDataContext', () => ({
  useAppData: () => ({
    data: bootstrapData,
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
  })

  it('keeps the duplicate shell search off the inventory route', () => {
    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <AppShell><LocationProbe /></AppShell>
      </MemoryRouter>,
    )

    expect(screen.queryByLabelText('Search inventory')).not.toBeInTheDocument()
  })

  it('submits AppShell search through router state without putting it in the URL', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/transfers']}>
        <AppShell><LocationProbe /></AppShell>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Search inventory'), 'Customer asks for evening call')
    await user.click(screen.getByRole('button', { name: 'Search my store inventory' }))

    const location = JSON.parse(screen.getByTestId('location').textContent || '{}') as {
      pathname: string
      search: string
      state: { inventorySearchRequest: { query: string } }
    }
    expect(`${location.pathname}${location.search}`).toBe('/inventory?scope=home')
    expect(location.search).not.toContain('Customer')
    expect(location.state.inventorySearchRequest.query).toBe('Customer asks for evening call')
    expect(screen.queryByLabelText('Search inventory')).not.toBeInTheDocument()
  })

  it.each([
    ['role', 'porter', 'Howell'],
    ['home store', 'manager', 'Lincoln'],
  ] as const)('clears an unsubmitted query when the %s changes', async (_label, nextRole, nextStore) => {
    const user = userEvent.setup()
    const view = render(
      <MemoryRouter initialEntries={['/transfers']}>
        <AppShell><LocationProbe /></AppShell>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Search inventory'), 'private comment text')
    expect(screen.getByLabelText('Search inventory')).toHaveValue('private comment text')

    mockState.role = nextRole
    mockState.homeStore = nextStore
    view.rerender(
      <MemoryRouter initialEntries={['/transfers']}>
        <AppShell><LocationProbe /></AppShell>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByLabelText('Search inventory')).toHaveValue(''))
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

  it('allows the global search form to submit by Enter', async () => {
    render(
        <MemoryRouter initialEntries={['/transfers']}>
        <AppShell><LocationProbe /></AppShell>
      </MemoryRouter>,
    )
    const input = screen.getByLabelText('Search inventory')
    fireEvent.change(input, { target: { value: 'stock W5863' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      const location = JSON.parse(screen.getByTestId('location').textContent || '{}') as {
        search: string
      }
      expect(location.search).toBe('?scope=home')
    })
  })
})
