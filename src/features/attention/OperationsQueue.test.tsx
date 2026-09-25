import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem, VehicleRecord } from '../../types'
import { OperationsQueue } from './OperationsQueue'

afterEach(cleanup)

it('links each vehicle issue to its own history without generic review controls', () => {
  const issue = task({ id: 'issue-synthetic-1', type: 'vehicle_issue', label: 'Fuel issue', href: '/attention?issue=synthetic-1', allowedActions: [], events: [] })
  const second = task({ id: 'issue-synthetic-2', type: 'vehicle_issue', label: 'Cleaning issue', href: '/attention?issue=synthetic-2', allowedActions: [], events: [] })
  show([issue, second])
  fireEvent.click(screen.getByRole('button', { name: /Vehicle issues\s*1/ }))
  expect(screen.getByRole('link', { name: 'Open fuel issue' })).toHaveAttribute('href', '/attention?issue=synthetic-1&returnTo=%2F')
  expect(screen.getByRole('link', { name: 'Open cleaning issue' })).toHaveAttribute('href', '/attention?issue=synthetic-2&returnTo=%2F')
  expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument()
  expect(screen.queryByText('Follow-up & history')).not.toBeInTheDocument()
})
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
function tasks() { return within(screen.getByRole('list', { name: 'Attention items' })).getAllByRole('listitem') }

describe('Action center store workflow', () => {
  it('keeps hold follow-ups focused on owner and timing, with records one click away and no assumed custody', () => {
    const vehicle = { vin: 'TESTDATAHWELL0001', vehicleName: 'Synthetic Ford H01', stockNumber: 'SYN-H01', homeStore: 'Howell', listedPrice: 31900, mileage: 18920, daysListed: 27, exteriorColor: 'Synthetic gray', engine: '2.0L synthetic engine', drivetrain: '4WD', sourceReportedLocation: 'Howell', movement: { currentLocation: 'Howell', locationConfidence: 'reported' }, serviceReadiness: { status: 'needs_service' } } as VehicleRecord
    show([task()], vi.fn(), [vehicle])
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('$31,900')
    expect(row).not.toHaveTextContent('Synthetic engine')
    expect(row).toHaveTextContent('Howell managerDue 09/13/2026')
    expect(within(row).getByRole('button', { name: 'Copy VIN: TESTDATAHWELL0001' })).toBeVisible()
    expect(within(row).getByRole('button', { name: 'Copy stock number: SYN-H01' })).toBeVisible()
    expect(row).toHaveTextContent('18,920 mi')
    expect(row).toHaveTextContent('Waiting for service · Reported at Howell')
    expect(row).not.toHaveTextContent('Confirmed at Howell')
    expect(within(row).getByRole('link', { name: 'Vehicle details' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&returnTo=%2F')
    expect(within(row).getByRole('link', { name: 'Records' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2F')
    expect(row.querySelector('.workflow-resource-row')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Task status' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects relevant facts for a service task instead of repeating a sales specification sheet', () => {
    const vehicle = { vin: 'TESTDATAHWELL0001', vehicleName: 'Synthetic Ford H01', stockNumber: 'SYN-H01', homeStore: 'Howell', listedPrice: 31900, mileage: 18920, daysListed: 27, engine: 'Synthetic engine', serviceReadiness: { status: 'needs_service' } } as VehicleRecord
    show([task({ type: 'service_pending', href: '/service?vin=TESTDATAHWELL0001' })], vi.fn(), [vehicle])
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('18,920 mi · 27 days listed')
    expect(row).toHaveTextContent('$31,900')
    expect(row).not.toHaveTextContent('Synthetic engine')
    expect(within(row).getByRole('link', { name: 'Update service' })).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2F')
  })

  it('does not invent a price, service state or specs for store-level tasks with no vehicle record', () => {
    show([task({ vin: undefined, vehicleName: undefined, stockNumber: undefined })])
    const row = screen.getByRole('listitem')
    expect(row.querySelector('.action-vehicle-value')).toBeNull()
    expect(row.querySelector('.action-vehicle-readiness')).toBeNull()
  })
  it('starts with home and related-store tasks, then deliberately expands to all stores with correct counts', () => {
    show([task(), task({ id: 'other', vin: 'TESTDATALINCOLN01', vehicleName: 'Synthetic Lincoln L01', store: 'Lincoln' }), task({ id: 'incoming', vin: 'TESTDATAFOWLER001', vehicleName: 'Synthetic incoming move', store: 'Fowlerville', relatedStores: ['Howell'], type: 'transfer_next_action', href: '/transfers?id=synthetic-move' })])
    expect(tasks()).toHaveLength(2)
    expect(screen.getByRole('button', { name: /All tasks\s*2/ })).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Lincoln L01')).not.toBeInTheDocument()
    expect(screen.getByText('Synthetic incoming move')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(tasks()).toHaveLength(3)
    expect(screen.getByRole('button', { name: /All tasks\s*3/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search work queue' }), { target: { value: 'Lincoln L01' } })
    expect(tasks()).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1 task')
  })

  it('counts only actionable work and collapses the rest into one collapsed group', () => {
    show([
      task(),
      task({ id: 'away-move', vin: 'TESTDATAFOWLER001', vehicleName: 'Synthetic Fowlerville move', type: 'transfer_next_action', store: 'Fowlerville', actionStore: 'Fowlerville', relatedStores: ['Howell', 'Fowlerville'], href: '/transfers?id=synthetic-away', actionability: 'informational', informationalReason: 'other_store' }),
      task({ id: 'feeds', vin: undefined, vehicleName: undefined, store: undefined, type: 'source_freshness', href: '/attention', actionability: 'informational', informationalReason: 'source_health' }),
    ])
    expect(tasks()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /All tasks\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 task')

    const also = screen.getByRole('list', { name: 'Also worth knowing' })
    const entries = within(also).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent("Synthetic Fowlerville move · Fowlerville · Another store's next step")
    expect(entries[1]).toHaveTextContent('Source health')
    expect(within(entries[0]).getByRole('link', { name: 'Open move' })).toHaveAttribute('href', '/transfers?id=synthetic-away&returnTo=%2F')
  })

  it('describes informational-only search matches without calling them tasks', () => {
    show([
      task(),
      task({ id: 'away-move', vin: 'TESTDATAFOWLER001', vehicleName: 'Synthetic Fowlerville move', type: 'transfer_next_action', store: 'Fowlerville', actionStore: 'Fowlerville', relatedStores: ['Howell'], actionability: 'informational', informationalReason: 'other_store' }),
    ])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search work queue' }), { target: { value: 'Fowlerville move' } })
    expect(screen.getByRole('heading', { name: 'No actionable tasks match this view' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('0 tasks · 1 informational')
    expect(screen.getByRole('list', { name: 'Also worth knowing' })).toHaveTextContent('Synthetic Fowlerville move')
  })

  it('keeps separate work directly accessible from a compact grouped row', () => {
    show([task(), task({ id: 'also-alert', type: 'hold_alert', priority: 'low' }), task({ id: 'also-service', type: 'service_pending', priority: 'low', label: 'Arrange service', href: '/service?vin=TESTDATAHWELL0001' })])
    const row = within(screen.getByRole('list', { name: 'Attention items' })).getByRole('listitem')
    expect(row).toHaveTextContent('Follow up on the expected hold date')
    expect(within(row).getByRole('link', { name: 'Update service' })).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2F')
    expect(row).not.toHaveTextContent('Also on this vehicle:')
    expect(row).not.toHaveTextContent('Read the hold alert and confirm the next step with the salesperson.')
    // The row keeps the most urgent condition's own next step.
    expect(within(row).getByRole('link', { name: 'Review hold' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 task')
  })

  it('keeps a follow-up record for every condition on a grouped row, not only the one that leads it', async () => {
    const { onAction } = show([
      task({ id: 'move', type: 'transfer_next_action', priority: 'urgent', label: 'Confirm vehicle arrival', href: '/transfers?id=synthetic-move', allowedActions: ['add_note'] }),
      task({ id: 'hold', type: 'hold_alert', allowedActions: ['add_note', 'set_follow_up', 'resolve'] }),
      task({ id: 'service', type: 'service_pending', priority: 'low', label: 'Arrange service', href: '/service?vin=TESTDATAHWELL0001', allowedActions: [] }),
    ])
    const row = within(screen.getByRole('list', { name: 'Attention items' })).getByRole('listitem')
    const disclosures = row.querySelectorAll('details.action-follow-up')
    // Service status is recorded on the service page, so it gets no disclosure.
    expect(disclosures).toHaveLength(2)
    expect(disclosures[0]).toHaveTextContent('Follow-up & history · Confirm vehicle arrival')
    expect(disclosures[1]).toHaveTextContent('Follow-up & history · Review the hold alert')
    fireEvent.click(within(disclosures[1] as HTMLElement).getByText('Follow-up & history'))
    fireEvent.change(within(disclosures[1] as HTMLElement).getByLabelText('Work note'), { target: { value: 'Synthetic hold note.' } })
    fireEvent.click(within(disclosures[1] as HTMLElement).getByRole('button', { name: 'Mark reviewed' }))
    // The note lands on the hold's own record, not on the move that leads the row.
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('hold', expect.objectContaining({ type: 'resolve', note: 'Synthetic hold note.' })))
    expect(onAction).not.toHaveBeenCalledWith('move', expect.anything())
    // A single condition keeps the plain label.
    cleanup()
    show([task()])
    expect(screen.getByText('Follow-up & history')).not.toHaveTextContent('·')
  })

  it('lets the viewer record on an informational entry when the server allows it', async () => {
    const { onAction } = show([
      task(),
      task({ id: 'away-move', vin: 'TESTDATAFOWLER001', vehicleName: 'Synthetic Fowlerville move', type: 'transfer_next_action', store: 'Fowlerville', actionStore: 'Fowlerville', relatedStores: ['Howell', 'Fowlerville'], href: '/transfers?id=synthetic-away', actionability: 'informational', informationalReason: 'other_store', allowedActions: ['add_note'] }),
      task({ id: 'lincoln-hold', vin: 'TESTDATALINCOLN01', vehicleName: 'Synthetic Lincoln hold', store: 'Lincoln', relatedStores: ['Howell'], actionability: 'informational', informationalReason: 'other_store', allowedActions: [] }),
    ])
    const also = screen.getByRole('list', { name: 'Also worth knowing' })
    const [move, hold] = within(also).getAllByRole('listitem')
    expect(within(move).getByText('Follow-up & history')).toBeInTheDocument()
    expect(within(hold).queryByText('Follow-up & history')).not.toBeInTheDocument()
    fireEvent.click(within(move).getByText('Follow-up & history'))
    fireEvent.change(within(move).getByLabelText('Work note'), { target: { value: 'Synthetic driver arranged.' } })
    fireEvent.click(within(move).getByRole('button', { name: 'Save follow-up' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('away-move', expect.objectContaining({ type: 'add_note', note: 'Synthetic driver arranged.', store: 'Howell' })))
    // Recording on it does not make it this store's task.
    expect(screen.getByText('1 task')).toBeInTheDocument()
  })

  it('offers the actual next destination and keeps old start/acknowledge buttons out of the workflow', () => {
    const move = task({ type: 'transfer_next_action', href: '/transfers?id=synthetic-move', allowedActions: ['acknowledge', 'start', 'resolve', 'add_note'] })
    show([move])
    expect(screen.getByRole('link', { name: 'Open move' })).toHaveAttribute('href', '/transfers?id=synthetic-move&returnTo=%2F')
    expect(screen.queryByRole('button', { name: /Start|Acknowledge/i })).not.toBeInTheDocument()
    expandFollowUp()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Work note')).toBeInTheDocument()
  })

  it('saves trimmed work notes with the current employee identity and keeps the primary hold link available', async () => {
    const { onAction } = show()
    expect(screen.getByRole('link', { name: 'Review hold' })).toHaveAttribute('href', '/inventory?scope=group&vin=TESTDATAHWELL0001&returnTo=%2F')
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
    expect(screen.getByRole('link', { name: 'Update service' })).toHaveAttribute('href', '/service?vin=TESTDATAHWELL0001&returnTo=%2F')
    expect(screen.queryByText('Follow-up & history')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument()
  })
})
