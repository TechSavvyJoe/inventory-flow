import { fireEvent, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AttentionItem } from '../../types'
import { OperationsQueue } from './OperationsQueue'

const transferItem: AttentionItem = {
  id: 'transfer-demo',
  severity: 'warning',
  priority: 'high',
  status: 'open',
  type: 'transfer_next_action',
  label: 'Requesting manager confirms release with the Home Store manager',
  vehicleName: '2024 Ford F-150 XLT',
  stockNumber: 'DEMO123',
  vin: 'TESTDATAHWELL0001',
  store: 'Fowlerville',
  relatedStores: ['Howell', 'Fowlerville'],
  sourceLabel: 'Inventory Flow transfer ledger',
  whyItMatters: 'The request is waiting for a release decision.',
  recommendedAction: 'Confirm availability and record the decision.',
  href: '/transfers?id=demo',
  allowedActions: ['acknowledge', 'assign', 'start_work', 'set_follow_up', 'add_note', 'resolve'],
  events: [],
}

const resolvedItem: AttentionItem = {
  ...transferItem,
  id: 'resolved-demo',
  label: 'Prior location exception',
  status: 'resolved',
  priority: 'normal',
  allowedActions: ['reopen', 'add_note'],
}

describe('OperationsQueue', () => {
  it('keeps the queue compact, filterable, and focused on the next action', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue({ ...transferItem, status: 'acknowledged' })
    const { container } = render(
      <MemoryRouter>
        <OperationsQueue
          items={[transferItem, resolvedItem]}
          homeStore="Fowlerville"
          role="manager"
          reportDate="2026-08-30"
          onAction={onAction}
        />
      </MemoryRouter>,
    )

    const queue = within(container)
    expect(queue.getByRole('heading', { name: 'Work queue' })).toBeInTheDocument()
    const homeScope = queue.getByRole('button', { name: 'Fowlerville' })
    const groupScope = queue.getByRole('button', { name: 'All stores' })
    expect(homeScope).toHaveAttribute('aria-pressed', 'true')
    expect(groupScope).toHaveAttribute('aria-pressed', 'false')
    expect(within(homeScope).getByText('Fowlerville')).toBeVisible()
    expect(queue.getByText(/updates Inventory Flow only/i)).toBeInTheDocument()
    expect(queue.getByText('Confirm availability and record the decision.')).toBeInTheDocument()
    expect(queue.getAllByText('Vehicle move').length).toBeGreaterThan(0)
    expect(queue.getByRole('link', { name: /Open vehicle move/i })).toBeInTheDocument()
    expect(queue.getByRole('link', { name: /View vehicle/i })).toBeInTheDocument()
    expect(queue.getAllByRole('listitem')).toHaveLength(1)

    await user.click(groupScope)
    expect(homeScope).toHaveAttribute('aria-pressed', 'false')
    expect(groupScope).toHaveAttribute('aria-pressed', 'true')
    await user.click(homeScope)

    await user.click(queue.getByRole('button', { name: 'Acknowledge' }))
    expect(onAction).toHaveBeenCalledWith(
      'transfer-demo',
      expect.objectContaining({
        type: 'acknowledge',
        actorRole: 'manager',
        store: 'Fowlerville',
      }),
    )

    await user.click(queue.getByRole('button', { name: 'Resolved: 1' }))
    expect(queue.getAllByText('Prior location exception')).toHaveLength(2)
    expect(queue.getByRole('button', { name: /Reopen/i })).toBeInTheDocument()
  })

  it('dismisses mobile detail with Escape and restores focus to the selected queue item', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })
    const user = userEvent.setup()
    const onAction = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <OperationsQueue items={[transferItem]} homeStore="Fowlerville" role="manager" reportDate="2026-08-30" onAction={onAction} />
      </MemoryRouter>,
    )

    const queue = within(container)
    const row = queue.getByRole('button', { name: `Open ${transferItem.label}` })
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(queue.getByRole('complementary', { name: `${transferItem.label} details` })).toHaveAttribute('id', 'ops-selected-detail')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'false'))
    await waitFor(() => expect(row).toHaveFocus())
  })

  it('keeps empty-filter recovery and the secondary action editor keyboard operable', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <OperationsQueue
          items={[transferItem]}
          homeStore="Fowlerville"
          role="manager"
          reportDate="2026-08-30"
          onAction={vi.fn()}
        />
      </MemoryRouter>,
    )

    const queue = within(container)
    await user.click(queue.getByRole('button', { name: 'Resolved: 0' }))
    expect(queue.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    expect(queue.getByText('No work matches this view')).toBeInTheDocument()

    await user.click(queue.getByRole('button', { name: 'Clear filters' }))
    expect(queue.getByRole('button', { name: `Open ${transferItem.label}` })).toBeInTheDocument()

    const summary = queue.getByText('Update owner, follow-up or resolution')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    await user.click(summary)
    expect(details).toHaveAttribute('open')

    const evidenceSummary = queue.getByText(/Evidence and activity/)
    expect(evidenceSummary.closest('details')).not.toHaveAttribute('open')
  })
})
