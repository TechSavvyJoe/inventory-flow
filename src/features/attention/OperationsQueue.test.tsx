import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem, VehicleRecord } from '../../types'
import { OperationsQueue } from './OperationsQueue'

afterEach(cleanup)
function task(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return { id: 'synthetic-hold', type: 'past_expected_hold', severity: 'warning', status: 'open', priority: 'normal',
    label: 'Synthetic hold check', vehicleName: 'Synthetic Ford H01', stockNumber: 'SYN-H01', vin: 'TESTDATAHWELL0001', store: 'Howell',
    owner: 'Howell manager', dueAt: '2026-09-13', whyItMatters: 'Confirm whether the appointment still needs the vehicle.', recommendedAction: 'Call the salesperson and confirm the next appointment.',
    href: '/inventory?scope=group&vin=TESTDATAHWELL0001', allowedActions: ['add_note', 'set_follow_up', 'resolve'], events: [], ...overrides }
}
function show(items = [task()], onAction = vi.fn().mockResolvedValue(task()), vehicles: VehicleRecord[] = []) {
  return { onAction, ...render(<MemoryRouter><OperationsQueue items={items} vehicles={vehicles} homeStore="Howell" role="manager" currentUser="Synthetic Manager" reportDate="2026-09-14" onAction={onAction}/></MemoryRouter>) }
}
function expandFollowUp() { fireEvent.click(screen.getByText('Follow-up & history')) }

describe('Action center store workflow', () => {
  it('shows useful current vehicle facts beside the task without turning reported location into confirmed custody', () => {
    const vehicle = { vin: 'TESTDATAHWELL0001', vehicleName: 'Synthetic Ford H01', stockNumber: 'SYN-H01', homeStore: 'Howell', listedPrice: 31900, mileage: 18920, daysListed: 27, exteriorColor: 'Synthetic gray', engine: '2.0L synthetic engine', drivetrain: '4WD', sourceReportedLocation: 'Howell', movement: { currentLocation: 'Howell', locationConfidence: 'reported' }, serviceReadiness: { status: 'needs_service' } } as VehicleRecord
    show([task()], vi.fn(), [vehicle])
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('$31,900 · 18,920 mi · 27 days listed')
    expect(row).toHaveTextContent('Synthetic gray · 2.0L synthetic engine · 4WD')
    expect(row).toHaveTextContent('Waiting for service · Reported at Howell')
    expect(row).not.toHaveTextContent('Confirmed at Howell')
    expect(screen.queryByRole('combobox', { name: 'Task status' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not invent a price, service state or specs for store-level tasks with no vehicle record', () => {
    show([task({ vin: undefined, vehicleName: undefined, stockNumber: undefined })])
    const row = screen.getByRole('listitem')
    expect(row.querySelector('.action-vehicle-value')).toBeNull()
    expect(row.querySelector('.action-vehicle-readiness')).toBeNull()
  })
  it('starts with home and related-store tasks, then deliberately expands to all stores with correct counts', () => {
    show([task(), task({ id: 'other', vehicleName: 'Synthetic Lincoln L01', store: 'Lincoln' }), task({ id: 'incoming', vehicleName: 'Synthetic incoming move', store: 'Fowlerville', relatedStores: ['Howell'], type: 'transfer_next_action', href: '/transfers?id=synthetic-move' })])
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /All tasks\s*2/ })).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Lincoln L01')).not.toBeInTheDocument()
    expect(screen.getByText('Synthetic incoming move')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /All tasks\s*3/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search work queue' }), { target: { value: 'Lincoln L01' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1 task')
  })

  it('offers the actual next destination and keeps old start/acknowledge buttons out of the workflow', () => {
    const move = task({ type: 'transfer_next_action', href: '/transfers?id=synthetic-move', allowedActions: ['acknowledge', 'start', 'resolve', 'add_note'] })
    show([move])
    expect(screen.getByRole('link', { name: 'Open move' })).toHaveAttribute('href', '/transfers?id=synthetic-move')
    expect(screen.queryByRole('button', { name: /Start|Acknowledge/i })).not.toBeInTheDocument()
    expandFollowUp()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Work note')).toBeInTheDocument()
  })

  it('saves trimmed work notes with the current employee identity and keeps the primary hold link available', async () => {
    const { onAction } = show()
    expect(screen.getByRole('link', { name: 'Review hold' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001')
    expandFollowUp()
    expect(screen.getByRole('button', { name: 'Save follow-up' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Work note'), { target: { value: '  Synthetic appointment confirmed.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('synthetic-hold', { type: 'add_note', actor: 'Synthetic Manager', actorRole: 'manager', store: 'Howell', note: 'Synthetic appointment confirmed.' }))
    expect(await screen.findByText('Follow-up saved.')).toBeInTheDocument()
    expect(screen.getByLabelText('Work note')).toHaveValue('')
  })

  it('preserves notes and follow-up date after a server rejection, allowing a deliberate retry', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('This store cannot update the task.')).mockResolvedValueOnce(task())
    show([task()], action)
    expandFollowUp()
    fireEvent.change(screen.getByLabelText('Work note'), { target: { value: 'Synthetic plan to verify tomorrow.' } })
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2026-09-15T09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This store cannot update the task.')
    expect(screen.getByLabelText('Work note')).toHaveValue('Synthetic plan to verify tomorrow.')
    expect(screen.getByLabelText('Follow up on')).toHaveValue('2026-09-15T09:30')
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenLastCalledWith('synthetic-hold', expect.objectContaining({ type: 'set_follow_up', followUpAt: new Date('2026-09-15T09:30').toISOString() }))
    fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
    expect(await screen.findByText('Follow-up saved.')).toBeInTheDocument()
    expect(action).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('honors server-denied actions even for a manager, while preserving history and the next link', () => {
    show([task({ allowedActions: [], events: [{ id: 'synthetic-event', type: 'add_note', label: 'Note added', actor: 'Synthetic Employee', actorRole: 'sales', occurredAt: '2026-09-13T14:00:00Z', note: 'Synthetic previous update.' }] })])
    expandFollowUp()
    expect(screen.queryByLabelText('Work note')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save follow-up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument()
    expect(screen.getByText('Synthetic previous update.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review hold' })).toBeInTheDocument()
  })

  it('keeps reviewed work separate and permits reopening only when the server allows it', async () => {
    const { onAction } = show([task({ status: 'resolved', allowedActions: ['reopen'] })])
    expect(screen.getByText('Your store is caught up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reviewed' }))
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Synthetic Ford H01')).toBeInTheDocument()
    expandFollowUp()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen review' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('synthetic-hold', expect.objectContaining({ type: 'reopen', actor: 'Synthetic Manager' })))
  })

  it('routes pending service directly to its record without offering generic review completion', () => {
    show([task({ type: 'service_pending', href: '/service?vin=TESTDATAHWELL0001', allowedActions: [] })])
    expect(screen.getByRole('link', { name: 'Update service' })).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001')
    expect(screen.queryByText('Follow-up & history')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument()
  })
})
