// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryExperienceHarness } from '../../../tests/unit/inventory-experience-harness'
import { premiumStore, premiumVehicle } from '../../../tests/unit/premium-test-helpers'
import { clearCustomerShortlist } from './useCustomerShortlist'

const vehicle = premiumVehicle()
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
afterEach(() => {
  cleanup()
  clearCustomerShortlist()
  vi.restoreAllMocks()
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
  document.body.style.removeProperty('overflow')
  document.body.style.removeProperty('overscroll-behavior')
})

function app() {
  const rendered = render(<div id="root"><nav aria-label="App navigation"><button type="button">Open another workspace</button></nav>
    <InventoryExperienceHarness homeStore={premiumStore} vehicles={[vehicle]} searchPersistenceKey="synthetic-modal-isolation" />
  </div>)
  const navigation = screen.getByRole('navigation', { name: 'App navigation' })
  const root = navigation.parentElement!
  fireEvent.click(screen.getByRole('button', { name: `Save ${vehicle.stockNumber} to shortlist` }))
  const shortlist = screen.getByRole('region', { name: 'Customer shortlist launcher' })
  return { root, navigation, shortlist, rendered }
}

describe('inventory portal modal boundaries', () => {
  it('restores the app when navigation removes the workspace and its take-home sheet together', async () => {
    const { root, shortlist, rendered } = app()
    root.setAttribute('aria-hidden', 'false')
    fireEvent.click(within(shortlist).getByRole('button', { name: /^Saved vehicles:/ }))
    const popover = screen.getByRole('region', { name: 'Saved vehicles 1' })
    fireEvent.click(within(popover).getByRole('button', { name: /^Open shortlisted/ }))
    const workspace = screen.getByRole('dialog', { name: /vehicle workspace/ })
    fireEvent.click(within(workspace).getByRole('button', { name: 'Take-home page' }))
    expect(screen.getByRole('dialog', { name: /Take-home page/ })).toBeVisible()
    await waitFor(() => expect(root).toHaveAttribute('aria-hidden', 'true'))
    rendered.rerender(<div id="root"><nav aria-label="App navigation"><button type="button">Open another workspace</button></nav></div>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(root).not.toHaveAttribute('inert')
    expect(root).toHaveAttribute('aria-hidden', 'false')
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.overscrollBehavior).toBe('')
    screen.getByRole('button', { name:'Open another workspace' }).focus()
    expect(screen.getByRole('button', { name:'Open another workspace' })).toHaveFocus()
  })

  it('isolates navigation and shortlist through nested take-home, then returns to the exact shortlist opener', async () => {
    const { root, navigation, shortlist } = app()
    root.setAttribute('aria-hidden', 'false')
    fireEvent.click(within(shortlist).getByRole('button', { name: /^Saved vehicles:/ }))
    const popover = screen.getByRole('region', { name: 'Saved vehicles 1' })
    expect(root).not.toHaveAttribute('inert')
    const opener = within(popover).getByRole('button', { name: /^Open shortlisted/ })
    vi.spyOn(opener, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    opener.focus()
    fireEvent.click(opener)
    const workspace = screen.getByRole('dialog', { name: /vehicle workspace/ })
    await waitFor(() => expect(root).toHaveAttribute('aria-hidden', 'true'))
    expect(navigation.closest('[inert]')).toBe(root)
    expect(shortlist).toHaveAttribute('inert')
    expect(shortlist).toHaveAttribute('data-covered', 'true')
    expect(popover).toHaveAttribute('inert')
    expect(popover).toHaveAttribute('aria-hidden', 'true')
    expect(workspace.closest('[inert]')).toBeNull()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.click(within(workspace).getByRole('button', { name: 'Take-home page' }))
    const takeHome = screen.getByRole('dialog', { name: /Take-home page/ })
    expect(takeHome.closest('[inert]')).toBeNull()
    expect(root).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Take-home page/ })).not.toBeInTheDocument()
    expect(workspace).toBeInTheDocument()
    expect(root).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(root).not.toHaveAttribute('inert')
    expect(popover).not.toHaveAttribute('inert')
    expect(root).toHaveAttribute('aria-hidden', 'false')
    expect(document.body.style.overflow).toBe('')
  })

  it('isolates the same app background for the scanner and restores its trigger on dismissal', async () => {
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    const { root, navigation, shortlist } = app()
    const trigger = screen.getByRole('button', { name: 'Scan vehicle' })
    trigger.focus()
    fireEvent.click(trigger)
    const scanner = screen.getByRole('dialog', { name: 'Scan vehicle' })
    await waitFor(() => expect(root).toHaveAttribute('aria-hidden', 'true'))
    expect(navigation.closest('[inert]')).toBe(root)
    expect(shortlist).toHaveAttribute('inert')
    expect(shortlist).toHaveAttribute('data-covered', 'true')
    expect(shortlist).toHaveAttribute('aria-hidden', 'true')
    expect(scanner.closest('[inert]')).toBeNull()
    expect(getUserMedia).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(root).not.toHaveAttribute('inert')
    expect(root).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')
  })
})
