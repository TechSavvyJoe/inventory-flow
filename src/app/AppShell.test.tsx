import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter } from 'react-router-dom'
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
    expect(shell).toHaveAttribute('aria-hidden', 'true')
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
    const managerLink = within(dialog).getByRole('link', { name: /Manager overview/i })
    await waitFor(() => expect(close).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(managerLink).toHaveFocus()
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
    expect(screen.getByRole('link', { name: 'Needs attention' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-controls', 'application-navigation')
  })

  it('moves focus to the main content after client-side route changes without moving focus on initial load', async () => {
    render(
      <MemoryRouter initialEntries={['/manager']}>
        <AppShell><Link to="/transfers?id=move-1">Open transfer record</Link></AppShell>
      </MemoryRouter>,
    )

    const main = screen.getByRole('main')
    const routeLink = screen.getByRole('link', { name: 'Open transfer record' })
    expect(main).not.toHaveFocus()

    routeLink.focus()
    fireEvent.click(routeLink)

    await waitFor(() => expect(main).toHaveFocus())
  })

  it('does not take focus from an active modal when the location changes', async () => {
    render(
      <MemoryRouter initialEntries={['/manager']}>
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
