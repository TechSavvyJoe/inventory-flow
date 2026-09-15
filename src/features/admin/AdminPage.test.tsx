import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminOverview } from './types'
import { AdminPage } from './AdminPage'

const { getAdminOverviewMock, useAppDataMock } = vi.hoisted(() => ({
  getAdminOverviewMock: vi.fn(),
  useAppDataMock: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  getAdminOverview: getAdminOverviewMock,
}))

vi.mock('../../app/AppDataContext', () => ({
  useAppData: () => useAppDataMock(),
}))

const overview: AdminOverview = {
  generatedAt: '2026-08-30T14:05:00.000Z',
  readOnly: true,
  summary: {
    activeUsers: 2,
    connectedStores: 2,
    feedsCurrent: 1,
    lastVerifiedAt: '2026-08-30T14:04:00.000Z',
  },
  people: [
    {
      id: 'joe-gallant',
      name: 'Joe Gallant',
      role: 'group_manager',
      storeAccess: ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'],
      status: 'active',
      lastActiveAt: null,
    },
    {
      id: 'howell-manager',
      name: 'Howell Manager',
      role: 'manager',
      storeAccess: ['Howell'],
      status: 'disabled',
      lastActiveAt: null,
    },
  ],
  feeds: [
    {
      store: 'Howell',
      status: 'current',
      lastSuccessfulAt: '2026-08-30T14:04:00.000Z',
      vehicleCount: 248,
      issueSummary: null,
    },
    {
      store: 'Lincoln',
      status: 'unknown',
      lastSuccessfulAt: null,
      vehicleCount: 0,
      issueSummary: null,
    },
  ],
  audit: [
    {
      id: 'service-1',
      occurredAt: '2026-08-30T14:02:00.000Z',
      actor: null,
      activity: 'Service started',
      scope: 'VIN TESTDATAHWELL0002 · Howell',
      result: 'recorded',
    },
  ],
}

function appData(role = 'group_manager') {
  return {
    role,
    homeStore: 'Howell',
  }
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/attention" element={<h1>Action center</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminPage read-only overview', () => {
  beforeEach(() => {
    useAppDataMock.mockReturnValue(appData())
    getAdminOverviewMock.mockResolvedValue(overview)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('loads the exact overview contract and renders accessible section anchors and honest null states', async () => {
    let resolveOverview: (value: AdminOverview) => void = () => undefined
    getAdminOverviewMock.mockReturnValueOnce(new Promise<AdminOverview>((resolve) => {
      resolveOverview = resolve
    }))

    renderAdmin()

    expect(screen.getByRole('status')).toHaveTextContent('Loading control center')
    resolveOverview(overview)

    expect(await screen.findByRole('heading', { level: 1, name: 'Control center' })).toBeInTheDocument()
    expect(getAdminOverviewMock).toHaveBeenCalledWith('group_manager', 'Howell', expect.any(AbortSignal))
    expect(screen.getByLabelText('2 active users')).toBeInTheDocument()
    expect(screen.getByLabelText('2 connected stores')).toBeInTheDocument()
    expect(screen.getByLabelText('1 of 2 connected feeds current')).toBeInTheDocument()

    const tabs = screen.getByRole('navigation', { name: 'Control center sections' })
    expect(within(tabs).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '#admin-overview')
    expect(within(tabs).getByRole('link', { name: /People/ })).toHaveAttribute('href', '#admin-people')
    expect(within(tabs).getByRole('link', { name: /Feeds?/ })).toHaveAttribute('href', '#admin-feeds')
    expect(within(tabs).getByRole('link', { name: /Audit/ })).toHaveAttribute('href', '#admin-audit')

    const peopleTable = screen.getByRole('table', { name: 'People with Inventory Flow access' })
    expect(within(peopleTable).getByText('All stores')).toBeInTheDocument()
    expect(within(peopleTable).getByText('Group manager')).toBeInTheDocument()
    expect(within(peopleTable).getAllByText('Not recorded')).not.toHaveLength(0)
    expect(within(peopleTable).getByRole('link', { name: 'Link to Joe Gallant' })).toHaveAttribute('href', '#admin-person-joe-gallant')

    const feedTable = screen.getByRole('table', { name: 'Inventory feed health by store' })
    expect(within(feedTable).getByText('No issues')).toBeInTheDocument()
    expect(within(feedTable).getByText('No issue detail reported')).toBeInTheDocument()
    expect(within(feedTable).getByText('248')).toBeInTheDocument()

    const auditTable = screen.getByRole('table', { name: 'Recent read-only audit activity' })
    expect(within(auditTable).getByText('Service started')).toBeInTheDocument()
    expect(within(auditTable).getByText('Not recorded')).toBeInTheDocument()
    expect(screen.getByText(/Changes are not available in this phase/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add|create|delete|disable|edit|save/i })).not.toBeInTheDocument()
  })

  it('shows section-specific empty states without manufacturing records', async () => {
    getAdminOverviewMock.mockResolvedValueOnce({
      ...overview,
      generatedAt: null,
      summary: { activeUsers: 0, connectedStores: 0, feedsCurrent: 0, lastVerifiedAt: null },
      people: [],
      feeds: [],
      audit: [],
    })

    renderAdmin()

    expect(await screen.findByLabelText('0 active users')).toBeInTheDocument()
    expect(screen.getByLabelText('0 connected stores')).toBeInTheDocument()
    expect(screen.getByLabelText('0 of 0 connected feeds current')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'People with Inventory Flow access' })).getByText('No people are available in this read-only view.')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Inventory feed health by store' })).getByText('No store feed records are available yet.')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Recent read-only audit activity' })).getByText('No audit activity has been recorded yet.')).toBeInTheDocument()
    expect(screen.getByText(/Overview generated at an unrecorded time/)).toBeInTheDocument()
  })

  it('limits phone scan rows by default and exposes accessible show-all controls without limiting desktop tables', async () => {
    const people = Array.from({ length: 6 }, (_, index) => ({
      ...overview.people[0],
      id: `person-${index + 1}`,
      name: `Demo Person ${index + 1}`,
    }))
    const audit = Array.from({ length: 5 }, (_, index) => ({
      ...overview.audit[0],
      id: `audit-${index + 1}`,
      activity: `Recorded activity ${index + 1}`,
    }))
    getAdminOverviewMock.mockResolvedValueOnce({ ...overview, people, audit })

    const rendered = renderAdmin()
    await screen.findByRole('heading', { level: 1, name: 'Control center' })

    const peopleTable = screen.getByRole('table', { name: 'People with Inventory Flow access' })
    const auditTable = screen.getByRole('table', { name: 'Recent read-only audit activity' })
    expect(within(peopleTable).getAllByRole('row')).toHaveLength(7)
    expect(within(auditTable).getAllByRole('row')).toHaveLength(6)

    const peopleList = rendered.container.querySelector<HTMLElement>('#admin-mobile-people-list')!
    const auditList = rendered.container.querySelector<HTMLElement>('#admin-mobile-audit-list')!
    expect(within(peopleList).getAllByRole('listitem')).toHaveLength(4)
    expect(within(auditList).getAllByRole('listitem')).toHaveLength(3)

    const showAllPeople = screen.getByRole('button', { name: 'Show all 6 people' })
    const showAllEvents = screen.getByRole('button', { name: 'Show all 5 events' })
    expect(showAllPeople).toHaveAttribute('aria-controls', 'admin-mobile-people-list')
    expect(showAllPeople).toHaveAttribute('aria-expanded', 'false')
    expect(showAllEvents).toHaveAttribute('aria-controls', 'admin-mobile-audit-list')
    expect(showAllEvents).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(showAllPeople)
    expect(within(peopleList).getAllByRole('listitem')).toHaveLength(6)
    const showFewerPeople = screen.getByRole('button', { name: 'Show fewer people' })
    expect(showFewerPeople).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(showFewerPeople)
    expect(within(peopleList).getAllByRole('listitem')).toHaveLength(4)

    fireEvent.click(showAllEvents)
    expect(within(auditList).getAllByRole('listitem')).toHaveLength(5)
    const showFewerEvents = screen.getByRole('button', { name: 'Show fewer events' })
    expect(showFewerEvents).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(showFewerEvents)
    expect(within(auditList).getAllByRole('listitem')).toHaveLength(3)
  })

  it('surfaces a failed read and retries the same protected overview', async () => {
    getAdminOverviewMock
      .mockRejectedValueOnce(new Error('The overview service is temporarily unavailable.'))
      .mockResolvedValueOnce(overview)

    renderAdmin()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Control center unavailable')
    expect(alert).toHaveTextContent('The overview service is temporarily unavailable.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Control center' })).toBeInTheDocument()
    expect(getAdminOverviewMock).toHaveBeenCalledTimes(2)
  })

  it('redirects every non-group-manager role without starting an admin request', async () => {
    useAppDataMock.mockReturnValue(appData('manager'))

    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'Action center' })).toBeInTheDocument()
    expect(getAdminOverviewMock).not.toHaveBeenCalled()
  })

  it('aborts an in-flight admin read when the route unmounts', async () => {
    getAdminOverviewMock.mockReturnValueOnce(new Promise(() => undefined))
    const rendered = renderAdmin()

    await waitFor(() => expect(getAdminOverviewMock).toHaveBeenCalledOnce())
    const signal = getAdminOverviewMock.mock.calls[0][2] as AbortSignal
    expect(signal.aborted).toBe(false)

    rendered.unmount()
    expect(signal.aborted).toBe(true)
  })
})
