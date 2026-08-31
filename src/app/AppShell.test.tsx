import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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
      refresh: vi.fn().mockResolvedValue(undefined),
      loading: false,
    })
  })

  afterEach(() => {
    cleanup()
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('overscroll-behavior')
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
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Account and app controls' })
    expect(dialog.parentElement).toBe(document.body)
    expect(shell).toHaveAttribute('inert', '')
    expect(shell).toHaveAttribute('aria-hidden', 'true')
    expect(dialog).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close app controls' })).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: 'Account and app controls' })).not.toBeInTheDocument()
    expect(shell).not.toHaveAttribute('inert')
    expect(shell).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')
  })
})
