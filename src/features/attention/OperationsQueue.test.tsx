import { render, screen } from '@testing-library/react'
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
  it('keeps the queue compact, filterable, and explicit about source-system boundaries', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue({ ...transferItem, status: 'acknowledged' })
    render(
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

    expect(screen.getByRole('heading', { name: 'Fowlerville operations queue' })).toBeInTheDocument()
    expect(screen.getByText('Work state is separate from source truth')).toBeInTheDocument()
    expect(screen.getByText(/does not release a hold/i)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))
    expect(onAction).toHaveBeenCalledWith(
      'transfer-demo',
      expect.objectContaining({
        type: 'acknowledge',
        actorRole: 'manager',
        store: 'Fowlerville',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Resolved: 1' }))
    expect(screen.getAllByText('Prior location exception')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Reopen/i })).toBeInTheDocument()
  })
})
