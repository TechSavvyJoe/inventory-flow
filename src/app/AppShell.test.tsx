import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './AppShell'

const { useAppDataMock } = vi.hoisted(() => ({ useAppDataMock: vi.fn() }))

vi.mock('./AppDataContext', () => ({
  useAppData: () => useAppDataMock(),
}))

describe('AppShell account and update controls', () => {
  beforeEach(() => {
    useAppDataMock.mockReturnValue({
      data: {
        attention: [],
        meta: {
          completedAt: '2026-08-30T15:47:00.000Z',
          dealerMailFreshness: 'current',
          publicFreshness: 'current',
          warnings: [],
        },
      },
      homeStore: 'Howell',
      setHomeStore: vi.fn(),
      role: 'sales',
      setRole: vi.fn(),
      currentUser: 'Joe Gallant',
      refresh: vi.fn().mockResolvedValue(undefined),
      loading: false,
    })
  })

  afterEach(() => {
    cleanup()
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('overscroll-behavior')
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('counts only the work this store and role can take in the Action center badge', () => {
    const context = useAppDataMock()
    const hold = { id: 'synthetic-hold', type: 'hold_alert', severity: 'warning', status: 'open', priority: 'high', label: 'Synthetic hold alert', vin: 'TESTDATAHWELL0001', store: 'Howell', actionability: 'actionable', allowedActions: [], events: [] }
    const awayMove = { ...hold, id: 'synthetic-move', type: 'transfer_next_action', vin: 'TESTDATAFOWLER001', store: 'Fowlerville', actionStore: 'Fowlerville', relatedStores: ['Howell', 'Fowlerville'], actionability: 'informational', informationalReason: 'other_store' }
    const feeds = { ...hold, id: 'synthetic-feeds', type: 'source_freshness', vin: undefined, store: undefined, actionability: 'informational', informationalReason: 'source_health' }
    // The same vehicle carries a hold and an unrecorded service status: one row.
    const vehicles = [{ vin: 'TESTDATAHWELL0001', stockNumber: 'SYN-H01', vehicleName: 'Synthetic Ford H01', homeStore: 'Howell', serviceReadiness: { status: 'needs_service', store: 'Howell', canManage: true } }]
    useAppDataMock.mockReturnValue({ ...context, role: 'manager', data: { ...context.data, attention: [hold, awayMove, feeds], vehicles } })

    render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
    expect(screen.getAllByLabelText('1 items need attention today').length).toBeGreaterThan(0)
  })

  it('hides the Action center badge when nothing is this store and role to do', () => {
    const context = useAppDataMock()
    const feeds = { id: 'synthetic-feeds', type: 'source_freshness', severity: 'critical', status: 'open', priority: 'urgent', label: 'Synthetic feed health', actionability: 'informational', informationalReason: 'source_health', allowedActions: [], events: [] }
    // A salesperson cannot record a service status, so it is never their badge.
    const vehicles = [{ vin: 'TESTDATAHWELL0001', stockNumber: 'SYN-H01', vehicleName: 'Synthetic Ford H01', homeStore: 'Howell', serviceReadiness: { status: 'needs_service', store: 'Howell', canManage: false } }]
    useAppDataMock.mockReturnValue({ ...context, role: 'sales', data: { ...context.data, attention: [feeds], vehicles } })

    render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
    expect(screen.queryByLabelText(/items need attention today/)).not.toBeInTheDocument()
  })

  it('shows the effective test role and a direct return to the authenticated Group manager role', () => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, data: { ...context.data, access: { role: 'sales', authenticatedRole: 'group_manager', canPreviewRoles: true, rolePreviewActive: true } } })
    render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
    expect(screen.getByText('Testing Salesperson · Live records')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Return to Group manager' }))
    expect(context.setRole).toHaveBeenCalledWith('group_manager')
    fireEvent.click(screen.getByRole('button', { name: 'Open account and app controls' }))
    const preview = screen.getByLabelText('Preview role')
    expect(preview).toHaveValue('sales')
    expect(within(preview).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Salesperson', 'Store manager', 'Group manager',
    ])
  })

  it('lets a verified group manager change working stores', () => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, data: { ...context.data, access: { role: 'group_manager', store: 'Howell', canPreviewStores: true } } })
    const { unmount } = render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
    const groupStore = screen.getByRole('combobox', { name: 'Working location' })
    expect(groupStore).toBeEnabled()
    fireEvent.change(groupStore, { target: { value: 'Ford Detroit' } })
    expect(context.setHomeStore).toHaveBeenCalledWith('Ford Detroit')
    unmount()
  })

  it('portals the modal outside the app shell, isolates the page, and restores opener focus', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/inventory']}>
        <AppShell><button type="button">Page action</button></AppShell>
      </MemoryRouter>,
    )
    const shell = container.querySelector<HTMLElement>('.app-shell')!
    const opener = screen.getByRole('button', { name: 'Open account and app controls' })
    const freshnessControl = screen.getByRole('button', { name: 'Current. Open update details' })
    expect(freshnessControl).toHaveAttribute('aria-haspopup', 'dialog')
    expect(freshnessControl).toHaveAttribute('aria-expanded', 'false')
    expect(freshnessControl).toHaveAttribute('aria-controls', 'app-utility-dialog')
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Account and app controls' })
    const updateStatus = within(dialog).getByRole('status')
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog).toHaveAttribute('id', 'app-utility-dialog')
    expect(updateStatus).toHaveAttribute('aria-live', 'polite')
    expect(updateStatus).toHaveAttribute('aria-atomic', 'true')
    expect(updateStatus).toHaveAttribute('aria-busy', 'false')
    expect(shell).toHaveAttribute('inert', '')
    await waitFor(() => expect(shell).toHaveAttribute('aria-hidden', 'true'))
    expect(dialog).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(dialog).getAllByRole('button', { name: 'Close app controls' })).toHaveLength(1)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close app controls' })).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: 'Account and app controls' })).not.toBeInTheDocument()
    expect(shell).not.toHaveAttribute('inert')
    expect(shell).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps keyboard focus inside the modal and restores pre-existing page state', async () => {
    const baseContext = useAppDataMock()
    useAppDataMock.mockReturnValue({
      ...baseContext,
      role: 'manager',
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 44,
      left: 0,
      width: 100,
      height: 44,
      toJSON: () => ({}),
    })
    document.body.style.setProperty('overflow', 'clip', 'important')
    document.body.style.setProperty('overscroll-behavior', 'contain')
    const { container } = render(
      <MemoryRouter initialEntries={['/attention']}>
        <AppShell><button type="button">Page action</button></AppShell>
      </MemoryRouter>,
    )
    const shell = container.querySelector<HTMLElement>('.app-shell')!
    shell.setAttribute('aria-hidden', 'false')
    const opener = screen.getByRole('button', { name: 'Open account and app controls' })
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Account and app controls' })
    const close = within(dialog).getByRole('button', { name: 'Close app controls' })
    const lastLink = within(dialog).getByRole('link', { name: /Service status/i })
    await waitFor(() => expect(close).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(lastLink).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.click(close)

    await waitFor(() => expect(opener).toHaveFocus())
    expect(shell).not.toHaveAttribute('inert')
    expect(shell).toHaveAttribute('aria-hidden', 'false')
    expect(document.body.style.overflow).toBe('clip')
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important')
    expect(document.body.style.overscrollBehavior).toBe('contain')
  })

  it('uses clear navigation labels for the two operational work queues', () => {
    render(
      <MemoryRouter initialEntries={['/attention']}>
        <AppShell><span>Page content</span></AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Vehicle moves' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Action center' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Inventory updates' })).toHaveAttribute('href', '/updates')
    expect(screen.getByRole('link', { name: 'Service status' })).toHaveAttribute('href', '/service')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-controls', 'application-navigation')
  })

  it('adds the management overview without replacing transfer operations', () => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, role: 'manager' })
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <AppShell><span>Overview content</span></AppShell>
      </MemoryRouter>,
    )

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    const mobile = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(primary).getByRole('link', { name: 'Inventory overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(mobile).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(mobile).getByRole('button', { name: 'More app controls' }))
    // Group operations is retired: /manager redirects to Overview, so the
    // account controls no longer carry a second management destination.
    expect(within(screen.getByRole('dialog', { name: 'Account and app controls' })).queryByRole('link', { name: /Group operations/ })).not.toBeInTheDocument()
  })

  it.each(['/transfers', '/service', '/attention', '/inventory'])('leaves %s with only its own page search in the shell header', (route) => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, role: 'manager' })
    render(
      <MemoryRouter initialEntries={[route]}>
        <AppShell><span>Page content</span></AppShell>
      </MemoryRouter>,
    )

    const header = screen.getByRole('banner')
    expect(within(header).queryByRole('search')).not.toBeInTheDocument()
    expect(within(header).queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search inventory' })).not.toBeInTheDocument()
  })

  it('exposes Control center navigation only to group managers', () => {
    const baseContext = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...baseContext, role: 'group_manager' })
    const { unmount } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppShell><span>Admin content</span></AppShell>
      </MemoryRouter>,
    )

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    const mobile = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(primary).getByRole('link', { name: 'Control center' })).toHaveAttribute('aria-current', 'page')
    expect(within(mobile).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/overview')
    expect(within(mobile).getByRole('link', { name: 'Actions' })).toHaveAttribute('href', '/attention')
    // The rail keeps daily management destinations reachable in one tap. Less
    // frequent administration, service, and update routes remain under More.
    expect(within(mobile).queryByRole('link', { name: 'Control center' })).not.toBeInTheDocument()
    expect(within(mobile).queryByRole('link', { name: 'Service' })).not.toBeInTheDocument()
    expect(within(mobile).queryByRole('link', { name: 'Updates' })).not.toBeInTheDocument()
    fireEvent.click(within(mobile).getByRole('button', { name: 'More app controls' }))
    const utility = screen.getByRole('dialog', { name: 'Account and app controls' })
    expect(within(utility).getByRole('link', { name: /Control center/ })).toHaveAttribute('href', '/admin')
    expect(within(utility).getByRole('link', { name: /Service status/ })).toHaveAttribute('href', '/service')
    expect(within(utility).getByRole('link', { name: /Inventory updates/ })).toHaveAttribute('href', '/updates')
    unmount()

    useAppDataMock.mockReturnValue(baseContext)
    render(
      <MemoryRouter initialEntries={['/attention']}>
        <AppShell><span>Store content</span></AppShell>
      </MemoryRouter>,
    )

    expect(within(screen.getByRole('navigation', { name: 'Primary' })).queryByRole('link', { name: 'Control center' })).not.toBeInTheDocument()
    const storeMobile = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(storeMobile).queryByRole('link', { name: 'Control center' })).not.toBeInTheDocument()
    fireEvent.click(within(storeMobile).getByRole('button', { name: 'More app controls' }))
    const storeUtility = screen.getByRole('dialog', { name: 'Account and app controls' })
    expect(within(storeUtility).getByRole('link', { name: /Service status/ })).toHaveAttribute('href', '/service')
    expect(within(storeUtility).queryByRole('link', { name: /Action center/ })).not.toBeInTheDocument()
  })

  it.each([
    ['/overview', '/transfers?id=move-1'],
    ['/transfers?id=move-1', '/transfers?id=move-2'],
    ['/transfers?id=move-1', '/transfers?id=move-1#history'],
  ])('moves focus after the URL changes from %s to %s without moving focus on initial load', async (initialUrl, nextUrl) => {
    render(
      <MemoryRouter initialEntries={[initialUrl]}>
        <AppShell><Link to={nextUrl}>Open transfer record</Link></AppShell>
      </MemoryRouter>,
    )

    const main = screen.getByRole('main')
    const routeLink = screen.getByRole('link', { name: 'Open transfer record' })
    expect(main).not.toHaveFocus()

    routeLink.focus()
    fireEvent.click(routeLink)

    await waitFor(() => expect(main).toHaveFocus())
  })

  it('keeps an edited input focused while a search request is consumed with a same-URL state replacement', async () => {
    function SearchRequestWorkspace() {
      const location = useLocation()
      const navigate = useNavigate()
      return <>
        <input aria-label="Inventory query" defaultValue="DEMO-H01" />
        <button type="button" onClick={() => navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null })}>Consume search request</button>
        <output aria-label="Search request state">{location.state === null ? 'Consumed' : 'Pending'}</output>
      </>
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/inventory', search: '?scope=home', hash: '#results', state: { inventorySearchRequest: { query: 'DEMO-H01' } } }]}>
        <AppShell><SearchRequestWorkspace /></AppShell>
      </MemoryRouter>,
    )
    const input = screen.getByRole('textbox', { name: 'Inventory query' })
    input.focus()
    fireEvent.change(input, { target: { value: 'DEMO-H02' } })
    // Dispatch only the cleanup action, preserving the focus a user owns
    // while InventoryPage consumes transient navigation state.
    fireEvent.click(screen.getByRole('button', { name: 'Consume search request' }))
    await waitFor(() => expect(screen.getByLabelText('Search request state')).toHaveTextContent('Consumed'))
    expect(input).toHaveFocus()
    expect(input).toHaveValue('DEMO-H02')
    expect(screen.getByRole('main')).not.toHaveFocus()
  })

  it('does not take focus from an active modal when the location changes', async () => {
    render(
      <MemoryRouter initialEntries={['/overview']}>
        <AppShell>
          <div role="dialog" aria-modal="true" aria-label="Active workflow">
            <Link to="/transfers?id=move-1">Open transfer record</Link>
          </div>
        </AppShell>
      </MemoryRouter>,
    )

    const main = screen.getByRole('main')
    const routeLink = screen.getByRole('link', { name: 'Open transfer record' })
    routeLink.focus()
    fireEvent.click(routeLink)

    await waitFor(() => expect(routeLink).toHaveFocus())
    expect(main).not.toHaveFocus()
  })
})
