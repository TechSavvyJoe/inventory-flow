import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AppDisposition, AppDispositionDetail } from '../../types'
import { DispositionDialog } from './DispositionDialog'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const api = vi.hoisted(() => ({ getDisposition: vi.fn(), updateDisposition: vi.fn() }))
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api')>()), ...api }))
const { ApiError } = await import('../../lib/api')

const VIN = 'TESTDATAFWELL0002'
function disposition(overrides: Partial<AppDisposition> = {}): AppDisposition {
  return { vin: VIN, code: null, version: 0, effectiveDate: null, destinationStore: null, updatedAt: null, updatedByRole: null, store: null, ownerStore: 'Fowlerville', canManage: true, ...overrides }
}
function detail(overrides: Partial<AppDispositionDetail> = {}): AppDispositionDetail {
  return { ...disposition(), history: [], ...overrides }
}

function Harness({ current = disposition(), onSaved = vi.fn(), evidence = null as null | { soldLabel: string; deliveryLabel: string; sourceStore: string; sourcePeriod: string } }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <MemoryRouter>
      <div id="root">
        <button type="button" ref={opener} onClick={() => setOpen(true)}>Open disposition</button>
      </div>
      {open ? (
        <DispositionDialog
          vehicle={{ vin: VIN, name: '2022 Ford Maverick Lariat', stockNumber: 'DEMO-F02' }}
          disposition={current}
          evidence={evidence}
          role="manager"
          store="Fowlerville"
          defaultDate="2026-08-30"
          returnFocusRef={opener}
          onClose={() => setOpen(false)}
          onSaved={async (saved) => { await onSaved(saved); setOpen(false) }}
        />
      ) : null}
    </MemoryRouter>
  )
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Open disposition' }))
  const dialog = await screen.findByRole('dialog', { name: 'Disposition · 2022 Ford Maverick Lariat' })
  await waitFor(() => expect(within(dialog).queryByText(/Loading the latest disposition/)).not.toBeInTheDocument())
  return dialog
}

describe('DispositionDialog', () => {
  beforeEach(() => {
    api.getDisposition.mockReset()
    api.updateDisposition.mockReset()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    document.body.style.removeProperty('overflow')
  })

  it('is a modal that locks background scroll, closes with Escape and returns focus to its opener', async () => {
    // jsdom has no layout; give controls a box so the focus trap can see them.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 120, 44))
    api.getDisposition.mockResolvedValue(detail())
    render(<Harness />)
    const dialog = await openDialog()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.getElementById('root')).toHaveAttribute('inert')
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus())

    // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
    const close = within(dialog).getByRole('button', { name: 'Close disposition' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open disposition' })).toHaveFocus())
    expect(document.body.style.overflow).toBe('')
  })

  it('offers only the allowed transitions and shows the manager log beside the app record', async () => {
    api.getDisposition.mockResolvedValue(detail({ code: 'sold_pending', version: 1, effectiveDate: '2026-08-29', updatedBy: 'Synthetic Fowlerville Manager', updatedByRole: 'manager', note: 'Deposit taken' }))
    render(<Harness current={disposition({ code: 'sold_pending', version: 1 })} evidence={{ soldLabel: 'Sold — manager log', deliveryLabel: 'Not marked delivered — manager log', sourceStore: 'Fowlerville', sourcePeriod: '2026-08' }} />)
    const dialog = await openDialog()
    const choices = within(dialog).getByRole('group', { name: 'Change to' })
    expect(within(choices).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(['Delivered', 'Keep', 'Wholesale', 'Transfer out', 'Other'])
    expect(dialog).toHaveTextContent('Disposition · recorded in Inventory Flow')
    expect(dialog).toHaveTextContent('Sold — manager log · Not marked delivered — manager log · Fowlerville · 2026-08')
    expect(dialog).toHaveTextContent('Deposit taken')
    expect(within(dialog).getByRole('button', { name: 'Save disposition' })).toBeDisabled()
  })

  it('requires a date for delivered, a destination for a transfer out, and a note to correct a closed unit', async () => {
    api.getDisposition.mockResolvedValue(detail())
    render(<Harness />)
    let dialog = await openDialog()
    const save = () => within(dialog).getByRole('button', { name: 'Save disposition' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Delivered' }))
    fireEvent.change(within(dialog).getByLabelText('Effective date'), { target: { value: '' } })
    expect(save()).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Effective date'), { target: { value: '2026-08-29' } })
    expect(save()).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Transfer out' }))
    const destination = within(dialog).getByRole('combobox', { name: 'Destination store' })
    // The owner store is never a destination.
    expect(within(destination).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a store', 'Howell', 'Ford Detroit', 'Lincoln'])
    expect(save()).toBeDisabled()
    fireEvent.change(destination, { target: { value: 'Lincoln' } })
    expect(save()).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    api.getDisposition.mockResolvedValue(detail({ code: 'delivered', version: 2, effectiveDate: '2026-08-26' }))
    dialog = await openDialog()
    expect(within(within(dialog).getByRole('group', { name: 'Change to' })).getAllByRole('radio')).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Keep' }))
    expect(within(dialog).getByLabelText(/Note \(required for a correction\)/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Deal unwound after delivery' } })
    expect(save()).toBeEnabled()
  })

  it('requires operational details for Other and hides it when storage has not been migrated', async () => {
    api.getDisposition.mockResolvedValue(detail({ otherEnabled: true }))
    render(<Harness />)
    let dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Other' }))
    expect(within(dialog).getByRole('button', { name: 'Save disposition' })).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note (required)' }), { target: { value: 'Reserved for showroom display' } })
    expect(within(dialog).getByRole('button', { name: 'Save disposition' })).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    api.getDisposition.mockResolvedValue(detail({ otherEnabled: false }))
    dialog = await openDialog()
    expect(within(dialog).queryByRole('radio', { name: 'Other' })).not.toBeInTheDocument()
  })

  it('saves the draft with the loaded version and reports the saved record', async () => {
    const saved = detail({ code: 'sold_pending', version: 1, effectiveDate: '2026-08-30' })
    api.getDisposition.mockResolvedValue(detail())
    api.updateDisposition.mockResolvedValue(saved)
    const onSaved = vi.fn()
    render(<Harness onSaved={onSaved} />)
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sold pending' }))
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  Deposit taken; delivery Friday  ' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save disposition' })) })
    expect(api.updateDisposition).toHaveBeenCalledWith(VIN, { disposition: 'sold_pending', expectedVersion: 0, effectiveDate: '2026-08-30', note: 'Deposit taken; delivery Friday' }, 'manager', 'Fowlerville')
    expect(onSaved).toHaveBeenCalledWith(saved)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the draft and loads the latest record on a version conflict', async () => {
    api.getDisposition
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ code: 'keep', version: 1, updatedBy: 'Another manager', updatedByRole: 'manager' }))
    api.updateDisposition.mockRejectedValue(new ApiError('Another manager updated this vehicle’s disposition.', 409, 'DISPOSITION_VERSION_CONFLICT'))
    render(<Harness />)
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sold pending' }))
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Deposit taken' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save disposition' })) })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Another manager updated this vehicle. Review and save again.')
    expect(api.getDisposition).toHaveBeenCalledTimes(2)
    expect(within(dialog).getByRole('textbox')).toHaveValue('Deposit taken')
    // Still allowed after Keep, so the choice survives the reload.
    expect(within(dialog).getByRole('radio', { name: 'Sold pending' })).toBeChecked()
    expect(dialog).toHaveTextContent('Another manager')
  })

  it('shows the hold-evidence refusal under the note and keeps the note', async () => {
    api.getDisposition.mockResolvedValue(detail())
    api.updateDisposition.mockRejectedValue(new ApiError('Notes cannot repeat names or reasons from the DealerMail hold.', 422, 'DISPOSITION_NOTE_CONTAINS_HOLD_EVIDENCE'))
    render(<Harness />)
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Keep' }))
    const note = within(dialog).getByRole('textbox')
    fireEvent.change(note, { target: { value: 'Synthetic name' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save disposition' })) })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Notes cannot repeat names or reasons from the DealerMail hold.')
    expect(note).toHaveAttribute('aria-invalid', 'true')
    expect(note).toHaveValue('Synthetic name')
    expect(note.getAttribute('aria-describedby')).toContain(within(dialog).getByRole('alert').id)
  })

  it('is read-only for a viewer who cannot record, with the note and history visible', async () => {
    api.getDisposition.mockResolvedValue(detail({
      code: 'wholesale', version: 1, effectiveDate: '2026-08-28', canManage: false, updatedBy: 'Synthetic Group Manager', updatedByRole: 'group_manager', note: 'Auction Tuesday',
      history: [{ ...disposition({ code: 'wholesale', version: 1, canManage: false }), updatedBy: 'Synthetic Group Manager', note: 'Auction Tuesday' }],
    }))
    render(<Harness current={disposition({ code: 'wholesale', version: 1, canManage: false })} />)
    const dialog = await openDialog()
    expect(within(dialog).queryByRole('group', { name: /Change to|Record as/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Save disposition' })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('A Fowlerville manager or a group manager records this vehicle’s disposition.')
    expect(within(dialog).getByRole('heading', { name: 'History' })).toBeVisible()
    expect(within(dialog).getAllByText('Auction Tuesday').length).toBeGreaterThan(0)
  })
})
