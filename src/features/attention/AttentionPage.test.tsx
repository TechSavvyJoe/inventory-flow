import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem, BootstrapData, ServiceReadinessStatus, StoreName, VehicleIssueDetail, VehicleRecord } from '../../types'
import { clearWorkspaceMemory } from '../../lib/workspace-memory'
import { AttentionPage } from './AttentionPage'
import { actionCenterItems, isActionable, openStoreActionCount } from './action-center'
import { appendVehicleIssueEvent, getVehicleIssue } from '../../lib/api'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, action: vi.fn() }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
vi.mock('../../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/api')>(), getVehicleIssue: vi.fn(), appendVehicleIssueEvent: vi.fn() }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function task(type: string, store: StoreName = 'Howell'): AttentionItem {
  return { id: `synthetic-${type}-${store}`, type, store, severity: 'warning', status: 'open', priority: 'normal', label: `Synthetic ${type}`, vehicleName: `Synthetic ${store} hold`, stockNumber: 'SYN-H01', vin: 'TESTDATAHWELL0001', href: '/inventory?q=old-stock', allowedActions: [], events: [] }
}
function vehicle(status?: ServiceReadinessStatus, store: StoreName = 'Howell', suffix = '1'): VehicleRecord {
  return { vin: `SYNTHETIC-SERVICE-${suffix}`, stockNumber: `SYN-${suffix}`, vehicleName: `Synthetic Service ${suffix}`, homeStore: store,
    ...(status ? { serviceReadiness: { status, store } } : {}),
  } as VehicleRecord
}
function data(): BootstrapData {
  return { attention: [{ ...task('source_freshness'), store: undefined, vin: undefined }, task('past_expected_hold'), task('hold_alert', 'Lincoln')], vehicles: [vehicle(undefined), vehicle('unknown', 'Howell', '2'), vehicle('needs_service', 'Howell', '3'), vehicle('in_service', 'Howell', '4'), vehicle('serviced', 'Howell', '5'), vehicle('needs_service', 'Lincoln', '6')], meta: { reportDate: '2026-09-14', publicFreshness: 'current', dealerMailFreshness: 'current' } } as BootstrapData
}
const howellManager = { store: 'Howell' as StoreName, role: 'manager' as const }
beforeEach(() => { clearWorkspaceMemory(); vi.clearAllMocks(); mocked.context = { data: data(), homeStore: 'Howell', role: 'manager', currentUser: 'Synthetic Manager', addAttentionEvent: mocked.action } })
function LocationProbe() { const location = useLocation(); return <output aria-label="Current URL">{`${location.pathname}${location.search}${location.hash}`}</output> }
function show(path = '/') { return render(<MemoryRouter initialEntries={[path]}><AttentionPage/><LocationProbe/></MemoryRouter>) }
function tasks() { return within(screen.getByRole('list', { name: 'Attention items' })).getAllByRole('listitem') }

describe('Action center page and shared navigation count', () => {
  it('keeps the top Vehicle issues option available when no reports exist', () => {
    show()
    const category = screen.getByRole('group', { name: 'Task category' })
    fireEvent.click(within(category).getByRole('button', { name: 'Vehicle issues 0' }))
    expect(screen.getByRole('region', { name: 'Vehicle issue log' })).toBeInTheDocument()
    expect(screen.getByText('No open vehicle issues')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }))
    expect(screen.getByText('No completed issues yet')).toBeInTheDocument()
  })
  it('opens the requested allowed issue action without submitting it and safely defaults invalid actions', async () => {
    const detail = { id: 'synthetic-issue', vin: 'SYNTHETIC-ISSUE-1', stockNumber: 'SYN-I1', vehicleName: 'Synthetic vehicle', category: 'cleaning', description: 'Synthetic work', priority: 'normal', status: 'awaiting_review', version: 1, assignee: 'Synthetic team', homeStore: 'Howell', reportStore: 'Howell', reportedBy: 'Synthetic employee', reportedByUserId: 'synthetic-user', reportedAt: '2026-09-14T10:00:00Z', updatedAt: '2026-09-14T10:00:00Z', completedAt: null, completedBy: null, photoCount: 0, photos: [], events: [], allowedActions: ['complete', 'add_note'] } as VehicleIssueDetail
    vi.mocked(getVehicleIssue).mockResolvedValue(detail)
    vi.mocked(appendVehicleIssueEvent).mockResolvedValue(detail)
    mocked.context.data = { ...data(), vehicleIssuesEnabled: true }
    show('/attention?issue=synthetic-issue&action=complete')
    expect(await screen.findByRole('heading', { name: 'Cleaning issue' })).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Action' })).toHaveValue('complete')
    expect(appendVehicleIssueEvent).not.toHaveBeenCalled()
    cleanup()
    show('/attention?issue=synthetic-issue&action=not-real')
    expect(await screen.findByRole('heading', { name: 'Cleaning issue' })).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Action' })).toHaveValue('add_note')
    expect(appendVehicleIssueEvent).not.toHaveBeenCalled()
  })
  it('counts only work this store and role can take, and groups the rest', () => {
    const fixture = data()
    const items = actionCenterItems(fixture, howellManager)
    expect(items.filter(item => item.type === 'service_pending').map(item => item.vin)).toEqual(['SYNTHETIC-SERVICE-1', 'SYNTHETIC-SERVICE-2', 'SYNTHETIC-SERVICE-3', 'SYNTHETIC-SERVICE-4', 'SYNTHETIC-SERVICE-6'])
    // Source health is still published, but it is never a store's task.
    expect(items.find(item => item.type === 'source_freshness')).toMatchObject({ actionability: 'informational', informationalReason: 'source_health' })
    expect(openStoreActionCount(fixture, howellManager)).toBe(5)
    expect(openStoreActionCount(null, howellManager)).toBe(0)
    show()
    expect(tasks()).toHaveLength(openStoreActionCount(fixture, howellManager))
    expect(screen.getByRole('button', { name: /All tasks\s*5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Service\s*4/ })).toBeInTheDocument()
    expect(screen.queryByText('Synthetic source_freshness')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Service status/ })).toHaveTextContent('3 waiting for service · 1 in service')
    // Source health is the page notice's job, so it never pads the group either.
    expect(screen.queryByRole('list', { name: 'Also worth knowing' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(tasks()).toHaveLength(5)
    const also = screen.getByRole('list', { name: 'Also worth knowing' })
    expect(within(also).getAllByRole('listitem')).toHaveLength(2)
    expect(also).not.toHaveTextContent('Check source health before promising a vehicle')
  })

  it('keeps a service task visible to the vehicle home store while the service-store association is pending', () => {
    const fixture = data()
    fixture.vehicles.push({
      ...vehicle('needs_service', 'Howell', '7'),
      serviceReadiness: { status: 'needs_service', store: null },
    } as VehicleRecord)

    const pendingStoreTask = actionCenterItems(fixture, howellManager).find(item => item.vin === 'SYNTHETIC-SERVICE-7')
    expect(pendingStoreTask).toMatchObject({
      type: 'service_pending',
      store: 'Howell',
      relatedStores: ['Howell'],
      owner: 'Howell manager',
      actionability: 'actionable',
    })
    expect(openStoreActionCount(fixture, howellManager)).toBe(6)
  })

  it('leaves the service queue to the manager who can record it', () => {
    const fixture = data()
    const salesViewer = { store: 'Howell' as StoreName, role: 'sales' as const }
    expect(openStoreActionCount(fixture, salesViewer)).toBe(1)
    expect(actionCenterItems(fixture, salesViewer).filter(item => item.type === 'service_pending').some(isActionable)).toBe(false)
    mocked.context = { ...mocked.context, role: 'sales' }
    show()
    expect(tasks()).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Also worth knowing' })).toHaveTextContent('Arrange service')
  })

  it('collapses several conditions on one vehicle into a single row', () => {
    const fixture = data()
    fixture.attention.push({ ...task('hold_alert'), id: 'synthetic-second-condition' })
    fixture.vehicles.push({ ...vehicle('needs_service', 'Howell', '8'), vin: 'TESTDATAHWELL0001' } as VehicleRecord)
    mocked.context.data = fixture
    expect(openStoreActionCount(fixture, howellManager)).toBe(5)
    show()
    const held = tasks().find(row => within(row).queryByText('Follow up on the expected hold date'))!
    expect(within(held).getByRole('link', { name: 'Update service' })).toHaveAttribute('href', expect.stringContaining('/service?vin=TESTDATAHWELL0001'))
    expect(held).not.toHaveTextContent('Also on this vehicle:')
  })

  it('uses an exact VIN link and keeps resolved tasks out of the open navigation count', () => {
    const fixture = data()
    fixture.attention[1].status = 'resolved'
    const exact = actionCenterItems(fixture, howellManager).find(item => item.type === 'past_expected_hold')
    expect(exact?.href).toBe('/inventory?scope=group&vin=TESTDATAHWELL0001&tab=hold')
    expect(openStoreActionCount(fixture, howellManager)).toBe(4)
    mocked.context.data = fixture
    show()
    expect(tasks()).toHaveLength(4)
  })

  it('communicates delayed sources once, as the page notice, never as an employee task', () => {
    const fixture = data(); fixture.meta.dealerMailFreshness = 'stale_unverified'; mocked.context.data = fixture
    show()
    expect(screen.getByText(/Some inventory details need review/)).toHaveClass('workflow-notice')
    expect(screen.queryByText(/source data|inventory details may be out of date/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic source_freshness')).not.toBeInTheDocument()
    expect(screen.queryByText('Check source health before promising a vehicle')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All tasks\s*5/ })).toBeInTheDocument()
  })

  it('resets queue scope when the signed-in working store changes', () => {
    const view = show()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    mocked.context = { ...mocked.context, homeStore: 'Lincoln' }
    view.rerender(<MemoryRouter><AttentionPage/></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Lincoln' })).toHaveAttribute('aria-pressed', 'true')
    expect(tasks()).toHaveLength(2)
    expect(screen.queryByText('Synthetic Service 3')).not.toBeInTheDocument()
  })

  it.each([
    { savedScope: 'group', requestedScope: 'home', selectedScope: 'home' },
    { savedScope: 'home', requestedScope: 'group', selectedScope: 'group' },
    { savedScope: 'group', requestedScope: 'invalid', selectedScope: 'group' },
  ] as const)('applies a scope-only link over saved $savedScope scope and consumes it safely', ({ savedScope, requestedScope, selectedScope }) => {
    show()
    if (savedScope === 'group') fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(screen.getByRole('button', { name: savedScope === 'home' ? 'Howell' : 'All stores' })).toHaveAttribute('aria-pressed', 'true')

    cleanup()
    show(`/attention?scope=${requestedScope}&keep=1#kept`)

    expect(screen.getByRole('button', { name: 'Howell' })).toHaveAttribute('aria-pressed', String(selectedScope === 'home'))
    expect(screen.getByRole('button', { name: 'All stores' })).toHaveAttribute('aria-pressed', String(selectedScope === 'group'))
    expect(screen.getByLabelText('Current URL')).toHaveTextContent(/^\/attention\?keep=1#kept$/)
  })

  it('protects an unfinished follow-up when a filter would remove its row', () => {
    const fixture = data()
    fixture.attention = [{ ...task('past_expected_hold'), allowedActions: ['add_note'] }]
    fixture.vehicles = []
    mocked.context.data = fixture
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    show()
    fireEvent.click(screen.getByText('Follow-up & history'))
    fireEvent.change(screen.getByLabelText('Work note'), { target: { value: 'Unfinished handoff note' } })
    const serviceFilter = screen.getByRole('button', { name: /^Service\s*0$/ })
    fireEvent.click(serviceFilter)
    expect(serviceFilter).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Work note')).toHaveValue('Unfinished handoff note')
    fireEvent.change(screen.getByLabelText('Search work queue'), { target: { value: 'No match' } })
    expect(screen.getByLabelText('Search work queue')).toHaveValue('')
    expect(mocked.action).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(serviceFilter)
    expect(serviceFilter).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('Work note')).not.toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(3)
  })

})
