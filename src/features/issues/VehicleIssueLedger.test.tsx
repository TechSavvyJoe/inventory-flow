import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWorkspaceMemory } from '../../lib/workspace-memory'
import type { BootstrapData, VehicleIssue, VehicleRecord } from '../../types'
import { VehicleIssueLedger } from './VehicleIssueLedger'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
function issue(id: string, changes: Partial<VehicleIssue> = {}): VehicleIssue {
  return { id, vin: `TESTDATA${id.padStart(9, '0')}`, stockNumber: `DEMO-${id}`, vehicleName: `Synthetic vehicle ${id}`, homeStore: 'Howell', reportStore: 'Howell', category: 'cleaning', priority: 'normal', description: `Synthetic cleaning ${id}`, status: 'open', version: 1, assignee: null, reportedBy: 'Synthetic employee', reportedByUserId: 'demo-employee', reportedAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z', completedAt: null, completedBy: null, photoCount: 0, allowedActions: ['assign', 'complete', 'add_note'], ...changes }
}
const issues = [issue('1', { photoCount: 2, assignee: 'Synthetic detail team' }), issue('2', { category: 'mechanical', status: 'awaiting_review', priority: 'urgent' }), issue('3', { status: 'completed', completedBy: 'Synthetic manager', completedAt: '2026-09-30T13:00:00Z' }), issue('4', { reportStore: 'Lincoln', homeStore: 'Howell', category: 'fuel' })]
function fixture(): BootstrapData {
  return { vehicleIssues: issues, vehicleIssuesEnabled: false, vehicles: [{ vin: issues[0].vin, vehicleName: '2024 Ford F-150 Lariat', listedPrice: 45000, mileage: 9000, sourceReportedLocation: 'Lincoln', movement: { locationConfidence: 'reported' } } as VehicleRecord], access: { userId: 'employee-one' } } as BootstrapData
}
function show(data = fixture(), allStores = false) {
  return render(<MemoryRouter initialEntries={['/attention']}><VehicleIssueLedger data={data} homeStore="Howell" role="manager" currentUser="Synthetic employee" allStores={allStores} onChanged={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter>)
}
beforeEach(clearWorkspaceMemory)
afterEach(cleanup)

describe('vehicle issue ledger', () => {
  it('keeps all open work visible, prioritizes urgent review and shows vehicle data and photo evidence', () => {
    show()
    const rows = within(screen.getByRole('list', { name: 'Reported vehicle issues' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Mechanical')
    expect(rows[0]).toHaveTextContent('Awaiting manager review')
    expect(rows[1]).toHaveTextContent('2024 Ford F-150 Lariat')
    expect(rows[1]).toHaveTextContent('$45,000 · 9,000 mi')
    expect(rows[1]).toHaveTextContent('Reported at Lincoln')
    expect(rows[1]).toHaveTextContent('2 photos attached')
    expect(rows[1]).toHaveTextContent('Synthetic detail team')
    expect(screen.queryByRole('button', { name: 'Report issue' })).not.toBeInTheDocument()
  })

  it('scopes work by its reporting store and retains history for vehicles missing from the daily feed', () => {
    const page = show()
    expect(screen.queryByText('Synthetic cleaning 4')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }))
    expect(screen.getByText('Synthetic cleaning 3')).toBeInTheDocument()
    expect(screen.getByText('Not in current inventory')).toBeInTheDocument()
    expect(screen.getByText(/Confirmed by Synthetic manager/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Vehicle details' })).not.toBeInTheDocument()
    page.unmount()
    clearWorkspaceMemory()
    show(fixture(), true)
    expect(screen.getByText('Synthetic cleaning 4')).toBeInTheDocument()
  })

  it('filters independently by status, category and vehicle or employee search, with a clear recovery action', () => {
    show(fixture(), true)
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(screen.getByText('Synthetic cleaning 2')).toBeInTheDocument()
    expect(screen.queryByText('Synthetic cleaning 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^All\s/ }))
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cleaning' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vehicle issues' }), { target: { value: 'detail team' } })
    expect(within(screen.getByRole('list', { name: 'Reported vehicle issues' })).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vehicle issues' }), { target: { value: 'missing synthetic text' } })
    expect(screen.getByText('No issues match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear issue filters' }))
    expect(within(screen.getByRole('list', { name: 'Reported vehicle issues' })).getAllByRole('listitem')).toHaveLength(4)
  })

  it('opens manager review on the existing completion form without completing work automatically', () => {
    show({ ...fixture(), vehicleIssuesEnabled: true, vehicles: [] })
    expect(screen.getByRole('link', { name: 'Review work: Mechanical · DEMO-2' })).toHaveAttribute('href', '/attention?issue=2&action=complete')
    expect(screen.queryByRole('button', { name: 'Confirm completion' })).not.toBeInTheDocument()
  })

  it('bounds long issue lists and resets paging when a filter changes', () => {
    show({ ...fixture(), vehicles: [], vehicleIssues: Array.from({ length: 26 }, (_, i) => issue(String(i))) })
    const list = screen.getByRole('list', { name: 'Reported vehicle issues' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: 'Next issue page' }))
    expect(screen.getByText('13–24 of 26 issues · Howell')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vehicle issues' }), { target: { value: 'DEMO-25' } })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1–1 of 1 issue · Howell')).toBeInTheDocument()
  })

  it('does not retain another employee’s in-memory issue search even when their display names match', () => {
    const page = show()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search vehicle issues' }), { target: { value: 'private synthetic query' } })
    page.unmount()
    show({ ...fixture(), access: { ...fixture().access!, userId: 'employee-two' } })
    expect(screen.getByRole('searchbox', { name: 'Search vehicle issues' })).toHaveValue('')
  })
})
