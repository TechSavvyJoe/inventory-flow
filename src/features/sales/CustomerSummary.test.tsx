// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerSummary } from './CustomerSummary'
import type { InventoryVehicle } from '../inventory/types'

const vehicle: InventoryVehicle = {
  id: 'TESTDATASUMMARY001', vin: 'TESTDATASUMMARY001', stockNumber: 'DEMO-S01', year: 2025, make: 'Ford', model: 'Synthetic vehicle',
  price: 20000, mileage: 10000, publicListing: { dataState: 'current', isListed: true, updatedAt: '2026-09-25T12:00:00Z' },
  dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
  dealerMail: { dataState: 'current', hasActiveHold: false }, location: { homeStore: { id: 'howell', name: 'Howell' } },
}
const noop = () => {}
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>
function summary(record = vehicle) { return <CustomerSummary vehicle={record} onRecords={noop} onTakeHome={noop} /> }
function openSummary() { fireEvent.click(screen.getByText('Customer summary')) }
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(() => {
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('customer summary copy feedback follows the reviewed facts', () => {
  it('clears copied feedback after a price refresh and copies the newly displayed facts on request', async () => {
    const view = render(summary())
    openSummary()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer summary' }))
    await screen.findByRole('button', { name: 'Copied customer summary' })
    expect(writeText.mock.calls[0][0]).toContain('$20,000')

    view.rerender(summary({ ...vehicle, price: 25000 }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('$25,000')
    expect(screen.getByRole('button', { name: 'Copy customer summary' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is sent to a customer')
    expect(writeText).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer summary' }))
    await screen.findByRole('button', { name: 'Copied customer summary' })
    expect(writeText.mock.calls[1][0]).toContain('$25,000')
  })

  it.each(['success', 'failure'] as const)('ignores late clipboard %s after the summary projection changes', async outcome => {
    const pending = deferred()
    writeText.mockReturnValueOnce(pending.promise)
    const view = render(summary())
    openSummary()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer summary' }))
    view.rerender(summary({ ...vehicle, price: 25000 }))
    await act(async () => {
      if (outcome === 'success') pending.resolve()
      else pending.reject(new Error('Synthetic clipboard failure'))
      await pending.promise.catch(noop)
    })
    expect(screen.getByRole('button', { name: 'Copy customer summary' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is sent to a customer')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('$25,000')
  })

  it('does not restore old feedback after an unmount and a new summary opens', async () => {
    const pending = deferred()
    writeText.mockReturnValueOnce(pending.promise)
    const view = render(summary())
    openSummary()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer summary' }))
    view.unmount()
    render(summary({ ...vehicle, price: 25000 }))
    openSummary()
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.getByRole('button', { name: 'Copy customer summary' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is sent to a customer')
  })

  it('serializes clipboard writes so an earlier snapshot cannot overwrite a newer copy', async () => {
    const pending = deferred()
    writeText.mockReturnValueOnce(pending.promise)
    const view = render(summary())
    openSummary()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer summary' }))
    view.rerender(summary({ ...vehicle, price: 25000 }))
    const copy = screen.getByRole('button', { name: 'Copy customer summary' })
    expect(copy).toBeDisabled()
    expect(copy).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(); await pending.promise })
    expect(copy).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is sent to a customer')
    fireEvent.click(copy)
    await screen.findByRole('button', { name: 'Copied customer summary' })
    expect(writeText.mock.calls.map(([text]) => text)).toEqual([
      expect.stringContaining('$20,000'), expect.stringContaining('$25,000'),
    ])
  })

  it('offers manual copying when the current clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('Synthetic clipboard permission denial'))
    render(summary())
    openSummary()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer summary' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Select the summary above and copy it manually'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('$20,000')
  })
})
