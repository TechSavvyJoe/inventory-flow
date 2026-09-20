import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferRecord } from '../../types'
import { TransferActionDialog } from './TransferActionDialog'
import type { TransferActionKind, TransferDetail } from './types'

const mocks = vi.hoisted(() => ({
  addTransferEvent: vi.fn(),
  useAppData: vi.fn(),
}))

vi.mock('../../app/AppDataContext', () => ({ useAppData: mocks.useAppData }))

const record: TransferRecord = {
  id: 'transfer-accessibility',
  vin: '1FTFW1E80RFA00001',
  stockNumber: 'MOVE1',
  vehicleName: '2025 Ford F-150 Lariat',
  homeStore: 'Howell',
  requestingStore: 'Ford Detroit',
  currentLocation: 'Howell',
  destination: 'Ford Detroit',
  requestStatus: 'requested',
  movementStatus: 'awaiting approval',
  dealStatus: 'decision pending',
  deliveryStatus: 'not confirmed',
  dealerMailHoldState: 'primary',
  publicListingState: 'listed',
  cdkStatus: 'processing',
  priority: 'high',
  requestedBy: 'Salesperson One',
  requestedAt: '2026-08-29T14:00:00.000Z',
  nextAction: 'Home-store manager review',
  nextActionOwner: 'Howell manager',
  returnRequired: true,
  locationConfidence: 'verified',
  events: [],
}

const detail = {
  id: record.id,
  vehicle: {
    vin: record.vin,
    stock: record.stockNumber,
    vehicleLabel: record.vehicleName,
    trimLabel: 'Lariat 4x4',
    homeStore: record.homeStore,
    currentLocation: {
      label: record.currentLocation,
      confidence: 'verified',
      confirmedAt: '2026-08-30T12:00:00.000Z',
    },
    status: {
      dealerMail: { code: 'primary', label: 'Primary hold', tone: 'warning' },
      publicListing: { code: 'listed', label: 'Listed', tone: 'info' },
      cdk: { code: 'processing', label: 'Processing', tone: 'neutral' },
    },
  },
  nextAction: { label: record.nextAction, ownerLabel: record.nextActionOwner, sla: 'on-track' },
  status: {
    request: { code: 'requested', label: 'Awaiting review', tone: 'warning' },
    movement: { code: 'at-home', label: 'At home', tone: 'neutral' },
    deal: { code: 'pending', label: 'Decision pending', tone: 'neutral' },
    delivery: { code: 'not-confirmed', label: 'Not confirmed', tone: 'neutral' },
    dealerMail: { code: 'primary', label: 'Primary hold', tone: 'warning' },
    publicListing: { code: 'listed', label: 'Listed', tone: 'info' },
    cdk: { code: 'processing', label: 'Processing', tone: 'neutral' },
  },
  timeline: [],
  allowedActions: ['approve'],
} as unknown as TransferDetail

function DialogHarness({ action = 'approve', workflowMode }: { action?: TransferActionKind; workflowMode?: TransferRecord['workflowMode'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-testid="app-background">
      <button type="button" onClick={() => setOpen(true)}>Open movement action</button>
      {open ? (
        <TransferActionDialog
          action={action}
          record={{ ...record, workflowMode }}
          detail={detail}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

describe('TransferActionDialog modal accessibility', () => {
  beforeEach(() => {
    mocks.addTransferEvent.mockReset()
    mocks.useAppData.mockReturnValue({
      addTransferEvent: mocks.addTransferEvent,
      homeStore: 'Howell',
      role: 'manager',
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 120,
      height: 44,
      top: 0,
      right: 120,
      bottom: 44,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('overscroll-behavior')
  })

  it('lets only a manager record that a confirmed sale fell through', () => {
    const sold = { ...record, requestStatus: 'sale_confirmed', dealStatus: 'sold_pending', workflowMode: 'simple' as const }
    const { unmount } = render(<TransferActionDialog action="record-outcome" record={sold} detail={detail} onClose={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Delivered — customer has the vehicle/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Deal fell through — not sold/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Shown — not sold/ })).not.toBeInTheDocument()
    unmount()

    mocks.useAppData.mockReturnValue({ addTransferEvent: mocks.addTransferEvent, homeStore: 'Howell', role: 'sales' })
    render(<TransferActionDialog action="record-outcome" record={sold} detail={detail} onClose={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Delivered — customer has the vehicle/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Deal fell through/ })).not.toBeInTheDocument()
  })

  it('opens as a named modal, isolates the app background, and places focus reliably', async () => {
    document.body.style.setProperty('overflow', 'auto')
    const { container } = render(<DialogHarness />)
    const opener = screen.getByRole('button', { name: 'Open movement action' })
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Record the home store’s release' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(record.vehicleName)
    expect(container).toHaveAttribute('inert')
    expect(container).toHaveAttribute('aria-hidden', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.overscrollBehavior).toBe('none')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close this update' })).toHaveFocus())
  })

  it('contains forward and reverse Tab navigation inside the dialog', async () => {
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open movement action' }))
    const dialog = screen.getByRole('dialog')
    const first = within(dialog).getByRole('button', { name: 'Close this update' })
    const last = within(dialog).getByRole('button', { name: 'Record the release' })

    await waitFor(() => expect(first).toHaveFocus())
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('labels the requesting-manager review step and confirmation accurately', async () => {
    render(<DialogHarness action="review-request" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open movement action' }))

    const dialog = screen.getByRole('dialog', { name: 'Approve at requesting store' })
    expect(dialog).toHaveTextContent('Step 2 · Requesting-store approval')
    expect(dialog).toHaveTextContent('This does not confirm availability or release')
    expect(dialog).toHaveTextContent('Ford Detroit manager must contact the Howell used-car manager')
    expect(within(dialog).getByRole('button', { name: 'Approve request' })).toBeEnabled()
  })

  it('requires the contacted home-store manager evidence before recording release', async () => {
    mocks.addTransferEvent.mockResolvedValue(record)
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open movement action' }))

    const dialog = screen.getByRole('dialog', { name: 'Record the home store’s release' })
    expect(dialog).toHaveTextContent('Step 3 · Call the home store, record the answer')
    expect(dialog).toHaveTextContent('You can assign a driver only after the release is recorded')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record the release' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the Howell manager who gave the release decision')

    fireEvent.change(within(dialog).getByLabelText(/Home-store manager contacted/i), {
      target: { value: 'Howell used-car manager' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Release conditions or pickup note/i), {
      target: { value: 'Release confirmed; keys at desk.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record the release' }))

    await waitFor(() => expect(mocks.addTransferEvent).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({
        type: 'approved',
        homeStoreManager: 'Howell used-car manager',
        note: 'Release confirmed; keys at desk.',
      }),
    ))
  })

  it('closes on Escape, restores the background, and returns focus to the opener', async () => {
    document.body.style.setProperty('overflow', 'clip', 'important')
    document.body.style.setProperty('overscroll-behavior', 'contain')
    const { container } = render(<DialogHarness />)
    const opener = screen.getByRole('button', { name: 'Open movement action' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container).not.toHaveAttribute('inert')
    expect(container).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('clip')
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important')
    expect(document.body.style.overscrollBehavior).toBe('contain')
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('requires a direct availability check for the single simple manager approval', async () => {
    mocks.addTransferEvent.mockResolvedValue(record)
    mocks.useAppData.mockReturnValue({ addTransferEvent: mocks.addTransferEvent, homeStore: 'Ford Detroit', role: 'manager', currentUser: 'Demo Manager' })
    render(<DialogHarness workflowMode="simple" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open movement action' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve this move' })
    expect(within(dialog).queryByLabelText(/Home-store manager contacted/)).not.toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('Stage 3')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve this move' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirm you checked')
    expect(mocks.addTransferEvent).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve this move' }))
    await waitFor(() => expect(mocks.addTransferEvent).toHaveBeenCalledWith(record.id, expect.objectContaining({ type: 'request_approved', availabilityConfirmed: true, actor: 'Demo Manager', store: 'Ford Detroit' })))
  })

  it.each([
    ['confirm-pickup', 'Mark collected', 'vehicle_departed'],
    ['schedule-return', 'Start return', 'return_started'],
  ] as const)('records simple %s without a driver assignment', async (action, button, eventType) => {
    mocks.addTransferEvent.mockResolvedValue(record)
    render(<DialogHarness action={action} workflowMode="simple" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open movement action' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText('Assigned driver')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: button }))
    await waitFor(() => expect(mocks.addTransferEvent).toHaveBeenCalledWith(record.id, expect.objectContaining({ type: eventType })))
  })

  it('requires a reason for a simple decline without introducing another-store approval', async () => {
    mocks.addTransferEvent.mockResolvedValue(record)
    render(<DialogHarness action="decline" workflowMode="simple" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open movement action' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Say briefly why')
    expect(mocks.addTransferEvent).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText(/Decision reason/), { target: { value: 'Vehicle needed at its home store.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline request' }))
    await waitFor(() => expect(mocks.addTransferEvent).toHaveBeenCalledWith(record.id, expect.objectContaining({ type: 'request_declined', note: 'Vehicle needed at its home store.' })))
  })
})
