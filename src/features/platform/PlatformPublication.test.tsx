import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformPublication } from './PlatformPublication'
import type { PlatformGroup } from './types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const group: PlatformGroup = {
  id: 'synthetic-north', name: 'Northside Motors', status: 'active', updatedAt: '2026-10-08T12:00:00Z',
  dealerships: [
    { id: 'north', groupId: 'synthetic-north', storeKey: 'northside', name: 'Northside Ford', website: '', enabled: true },
    { id: 'south', groupId: 'synthetic-north', storeKey: 'southside', name: 'Southside Motors', website: '', enabled: true },
    { id: 'foreign', groupId: 'synthetic-other', storeKey: 'foreign', name: 'Other group dealership', website: '', enabled: true },
  ],
  health: { status: 'current', message: 'Synthetic stored publication', connected: true, activeEmployees: 0, employees: 2,
    coverage: { basis: 'stored_publication', reportDate: '2026-10-08', publishedAt: '2026-10-08T12:00:00Z',
      counts: { publicRowCount: 12, activeInventoryCount: 11, dealerMailVinReviewCount: 0, warningCount: 2, fordOasisRecordCount: 7 },
      stores: [{ storeKey: 'northside', publicCount: 12, crmCount: 0, activeInventoryCount: 11 }, { storeKey: 'southside-alias', publicCount: 99 }, { storeKey: 'foreign', publicCount: 99 }],
    },
  },
}
afterEach(cleanup)
describe('Stored publication evidence', () => {
  it('shows actual totals, preserves zero, and matches dealership coverage only by its exact group store key', () => {
    render(<PlatformPublication group={group} busy={false} onConnections={vi.fn()}/> )
    const summary = screen.getByLabelText('Publication totals')
    expect(within(summary).getByText('Public inventory rows').parentElement).toHaveTextContent('12')
    expect(within(summary).getByText('App vehicle membership').parentElement).toHaveTextContent('11')
    expect(within(summary).getByText('DealerMail rows needing VIN review').parentElement).toHaveTextContent('0')
    expect(within(summary).getByText('Publication warnings').parentElement).toHaveTextContent('2')
    const totals = screen.getByRole('group', { name: 'Publication coverage at Northside Ford' })
    expect(within(totals).getByText('12')).toBeInTheDocument()
    expect(within(totals).getByText('0')).toBeInTheDocument()
    expect(within(totals).getByText('11')).toBeInTheDocument()
    const missing = screen.getByRole('group', { name: 'Publication coverage at Southside Motors' })
    expect(within(missing).getAllByText('Not reported')).toHaveLength(3)
    expect(screen.queryByText('99')).not.toBeInTheDocument()
    expect(screen.queryByText('Other group dealership')).not.toBeInTheDocument()
    expect(screen.getByText('0 / 2')).toBeInTheDocument()
    expect(screen.getByText('2026-10-08')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Captured records & reconciliation'))
    expect(screen.getByText('7')).toBeVisible()
    expect(screen.getByText(/It does not establish availability, physical location or sale status/)).toBeInTheDocument()
  })
  it('reports missing coverage as unreported and routes review to existing data connections without enabling collection', () => {
    const review = vi.fn()
    render(<PlatformPublication group={{...group, dealerships: [], health: {status: 'not_connected', message: 'No stored publication'}}} busy={false} onConnections={review}/> )
    expect(screen.getAllByText('Not reported').length).toBeGreaterThan(4)
    expect(screen.getByText('Not verified')).toBeInTheDocument()
    expect(screen.getByText('Register a dealership to review its publication coverage.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: 'Review data connections'}))
    expect(review).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', {name: /publish|activate|run/i})).not.toBeInTheDocument()
  })
})
