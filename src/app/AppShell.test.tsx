import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { clearWorkspaceMemory, useWorkspaceScroll } from '../lib/workspace-memory'
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
    clearWorkspaceMemory()
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('overscroll-behavior')
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('keeps the product wordmark independent of the configured dealership account', () => {
    render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
    expect(screen.getAllByText('Inventory Flow', { exact: true }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Maxey', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Working location' })).toHaveValue('Howell')
  })

  it('shows a separate Software Admin link only while the verified URL is supplied', () => {
    const context = useAppDataMock()
    const withOwnerAccess = { ...context, data: { ...context.data, access: { softwareAdminUrl: 'https://inventory-admin.joegallant.me/platform' } } }
    useAppDataMock.mockReturnValue(withOwnerAccess)
    const { rerender } = render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Open account and app controls' }))

    const utility = screen.getByRole('dialog', { name: 'Account and app controls' })
    expect(within(utility).getByRole('link', { name: /Software Admin/ })).toHaveAttribute('href', 'https://inventory-admin.joegallant.me/platform')
    expect(within(utility).getByRole('link', { name: /Software Admin/ })).toHaveAttribute('target', '_blank')
    expect(within(utility).queryByRole('link', { name: /Control center/ })).not.toBeInTheDocument()

    useAppDataMock.mockReturnValue({ ...withOwnerAccess, data: { ...withOwnerAccess.data, access: {} } })
    rerender(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory updated</p></AppShell></MemoryRouter>)
    expect(within(screen.getByRole('dialog', { name: 'Account and app controls' })).queryByRole('link', { name: /Software Admin/ })).not.toBeInTheDocument()
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

  it('lets a verified group manager change working stores without waiting for a browser snapshot', () => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, data: { ...context.data, access: { role: 'group_manager', store: 'Howell', canPreviewStores: true } } })
    const original = Object.getOwnPropertyDescriptor(document, 'startViewTransition')
    const capture = vi.fn(() => ({finished:Promise.resolve()}))
    Object.defineProperty(document, 'startViewTransition', {configurable:true,value:capture})
    try {
      const { unmount } = render(<MemoryRouter initialEntries={['/inventory']}><AppShell><p>Inventory</p></AppShell></MemoryRouter>)
      const groupStore = screen.getByRole('combobox', { name: 'Working location' })
      expect(groupStore).toBeEnabled()
      fireEvent.change(groupStore, { target: { value: 'Ford Detroit' } })
      expect(context.setHomeStore).toHaveBeenCalledWith('Ford Detroit')
      expect(capture).not.toHaveBeenCalled()
      unmount()
    } finally {
      if (original) Object.defineProperty(document, 'startViewTransition', original)
      else Reflect.deleteProperty(document, 'startViewTransition')
    }
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
    // The last destination under More: Vehicle moves, now that Service sits in the rail.
    const lastLink = within(dialog).getByRole('link', { name: /Vehicle moves/i })
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
    expect(within(primary).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(mobile).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(mobile).getByRole('button', { name: 'More app controls' }))
    // Group operations is retired: /manager redirects to Overview, so the
    // account controls no longer carry a second management destination.
    expect(within(screen.getByRole('dialog', { name: 'Account and app controls' })).queryByRole('link', { name: /Group operations/ })).not.toBeInTheDocument()
  })

  it.each(['sales', 'manager', 'group_manager'] as const)('gives a %s the rail Overview · Inventory · Actions · Service · More, with Moves and the rest under More', (role) => {
    const context = useAppDataMock()
    const vehicles = [{ vin: 'TESTDATAHWELL0001', stockNumber: 'SYN-H01', vehicleName: 'Synthetic Ford H01', homeStore: 'Howell', serviceReadiness: { status: 'needs_service', store: 'Howell', canManage: true } }]
    const hold = { id: 'synthetic-hold', type: 'hold_alert', severity: 'warning', status: 'open', priority: 'high', label: 'Synthetic hold alert', vin: 'TESTDATAHWELL0001', store: 'Howell', actionability: 'actionable', allowedActions: [], events: [] }
    useAppDataMock.mockReturnValue({ ...context, role, data: { ...context.data, attention: [hold], vehicles } })
    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <AppShell><span>Inventory content</span></AppShell>
      </MemoryRouter>,
    )

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).getAllByRole('link').map((link) => link.textContent?.replace(/\d+$/, ''))).toEqual([
      'Overview', 'Inventory', 'Action center', 'Service status', 'Inventory updates', 'Vehicle moves',
      ...(role === 'group_manager' ? ['Control center'] : []),
    ])
    const mobile = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(mobile).getAllByRole('link').map((link) => link.querySelector('span')?.textContent)).toEqual(['Overview', 'Inventory', 'Actions', 'Service'])
    expect(within(mobile).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/overview')
    // Actions is in the rail, so its count stays on Actions and never doubles on More.
    const more = within(mobile).getByRole('button', { name: 'More app controls' })
    expect(within(more).queryByLabelText(/items need attention today/)).not.toBeInTheDocument()
    fireEvent.click(more)
    const utility = screen.getByRole('dialog', { name: 'Account and app controls' })
    expect(within(utility).getByRole('link', { name: /Inventory updates/ })).toHaveAttribute('href', '/updates')
    // Moving vehicles is occasional work, so Vehicle moves lives under More.
    expect(within(utility).getByRole('link', { name: /Vehicle moves/ })).toHaveAttribute('href', '/transfers')
    expect(within(utility).queryByRole('link', { name: /Service status/ })).not.toBeInTheDocument()
    expect(within(utility).queryByRole('link', { name: /Control center/ }) !== null).toBe(role === 'group_manager')
    expect(within(utility).queryByRole('link', { name: /^Overview/ })).not.toBeInTheDocument()
  })

  it.each(['/transfers', '/transfers/history', '/updates', '/admin'])('marks More current on mobile utility route %s', (route) => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, role: 'group_manager' })
    render(<MemoryRouter initialEntries={[route]}><AppShell><span>Utility route</span></AppShell></MemoryRouter>)
    const mobile = screen.getByRole('navigation', { name: 'Mobile primary' })
    expect(within(mobile).getByRole('button', { name: 'More app controls' })).toHaveAttribute('aria-current', 'page')
    expect(within(mobile).queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
  })

  it('keeps a retired transport role off the Overview', () => {
    const context = useAppDataMock()
    useAppDataMock.mockReturnValue({ ...context, role: 'driver' })
    render(
      <MemoryRouter initialEntries={['/transfers']}>
        <AppShell><span>Moves content</span></AppShell>
      </MemoryRouter>,
    )
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Mobile primary' })).queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument()
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
    // The rail keeps daily destinations reachable in one tap. Administration,
    // updates and vehicle moves, which are occasional, remain under More.
    expect(within(mobile).getByRole('link', { name: 'Service' })).toHaveAttribute('href', '/service')
    expect(within(mobile).queryByRole('link', { name: 'Control center' })).not.toBeInTheDocument()
    expect(within(mobile).queryByRole('link', { name: 'Moves' })).not.toBeInTheDocument()
    expect(within(mobile).queryByRole('link', { name: 'Updates' })).not.toBeInTheDocument()
    fireEvent.click(within(mobile).getByRole('button', { name: 'More app controls' }))
    const utility = screen.getByRole('dialog', { name: 'Account and app controls' })
    expect(within(utility).getByRole('link', { name: /Control center/ })).toHaveAttribute('href', '/admin')
    expect(within(utility).getByRole('link', { name: /Vehicle moves/ })).toHaveAttribute('href', '/transfers')
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
    expect(within(storeUtility).getByRole('link', { name: /Vehicle moves/ })).toHaveAttribute('href', '/transfers')
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

  it('starts a newly opened pathname at top without resetting same-page selection or explicit workflow returns', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    function Navigation() {
      const location = useLocation()
      return <>
        <Link to="/transfers?id=move-1">Open move</Link>
        <Link to="/transfers?id=move-2">Select another move</Link>
        <Link to="/inventory?vin=TESTDATA1&returnTo=%2Ftransfers%3Fid%3Dmove-2">Open vehicle</Link>
        <Link to={new URLSearchParams(location.search).get('returnTo') ?? '/transfers'}>Return to move</Link>
      </>
    }
    render(<MemoryRouter initialEntries={['/service']}><AppShell><Navigation /></AppShell></MemoryRouter>)
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Open move' }))
    expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
    scroll.mockClear()
    fireEvent.click(screen.getByRole('link', { name: 'Select another move' }))
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Open vehicle' }))
    expect(scroll).toHaveBeenCalledOnce()
    scroll.mockClear()
    fireEvent.click(screen.getByRole('link', { name: 'Return to move' }))
    expect(scroll).not.toHaveBeenCalled()
  })

  it.each(['/service', '/inventory?vin=TESTDATA1&returnTo=%2Fservice'])('prioritizes deliberate shell entry over same-path and return-target exemptions from %s', async initialUrl => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(<MemoryRouter initialEntries={[initialUrl]}><AppShell><span>Workspace</span></AppShell></MemoryRouter>)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Service status' }))
    await waitFor(() => expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' }))
  })

  it('opens shell destinations at top after saved workspace restoration and preserves Back and Forward offsets', () => {
    let y = 300
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y)
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation((options?: ScrollToOptions | number, top?: number) => {
      if (typeof options === 'object') y = options.top ?? y
      else if (top !== undefined) y = top
    })
    const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) })
    function Workspace() {
      const location = useLocation(), navigate = useNavigate()
      useWorkspaceScroll('employee:manager:Howell', location.pathname, { preserveRecordedPositionOnExit: true })
      return <><button onClick={() => navigate(-1)}>Browser Back</button><button onClick={() => navigate(1)}>Browser Forward</button></>
    }
    render(<MemoryRouter initialEntries={['/transfers']}><AppShell><Workspace /></AppShell></MemoryRouter>)
    flush()
    window.dispatchEvent(new Event('scroll'))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Service status' }))
    flush()
    expect(y).toBe(0)
    y = 423; window.dispatchEvent(new Event('scroll'))
    // Transfers already has a saved offset of 300. Shell entry must win.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Vehicle moves' }))
    flush()
    expect(y).toBe(0)
    expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
    y = 275; window.dispatchEvent(new Event('scroll'))
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }))
    flush()
    expect(y).toBe(423)
    fireEvent.click(screen.getByRole('button', { name: 'Browser Forward' }))
    flush()
    expect(y).toBe(275)
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
