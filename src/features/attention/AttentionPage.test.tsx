import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem, BootstrapData, ServiceReadinessStatus, StoreName, VehicleRecord } from '../../types'
import { AttentionPage } from './AttentionPage'
import { actionableItems, openStoreActionCount } from './action-center'

const mocked = vi.hoisted(() => ({ context: {} as Record<string, unknown>, action: vi.fn() }))
vi.mock('../../app/AppDataContext', () => ({ useAppData: () => mocked.context }))
afterEach(cleanup)
function task(type: string, store: StoreName = 'Howell'): AttentionItem {
  return { id: `synthetic-${type}-${store}`, type, store, severity: 'warning', status: 'open', priority: 'normal', label: `Synthetic ${type}`, vehicleName: `Synthetic ${store} hold`, stockNumber: 'SYN-H01', vin: 'TESTDATAHWELL0001', href: '/inventory?q=old-stock', allowedActions: [], events: [] }
}
function vehicle(status?: ServiceReadinessStatus, store: StoreName = 'Howell', suffix = '1'): VehicleRecord {
  return { vin: `SYNTHETIC-SERVICE-${suffix}`, stockNumber: `SYN-${suffix}`, vehicleName: `Synthetic Service ${suffix}`, homeStore: store,
    ...(status ? { serviceReadiness: { status, store } } : {}),
  } as VehicleRecord
}
function data(): BootstrapData {
  return { attention: [task('source_freshness'), task('past_expected_hold'), task('hold_alert', 'Lincoln')], vehicles: [vehicle(undefined), vehicle('unknown', 'Howell', '2'), vehicle('needs_service', 'Howell', '3'), vehicle('in_service', 'Howell', '4'), vehicle('serviced', 'Howell', '5'), vehicle('needs_service', 'Lincoln', '6')], meta: { reportDate: '2026-09-14', publicFreshness: 'current', dealerMailFreshness: 'current' } } as BootstrapData
}
beforeEach(() => { vi.clearAllMocks(); mocked.context = { data: data(), homeStore: 'Howell', role: 'manager', currentUser: 'Synthetic Manager', addAttentionEvent: mocked.action } })
function show() { return render(<MemoryRouter><AttentionPage/></MemoryRouter>) }

describe('Action center page and shared navigation count', () => {
  it('excludes source freshness and includes unconfirmed, legacy waiting, and in-service work', () => {
    const fixture = data()
    const items = actionableItems(fixture)
    expect(items.some(item => item.type === 'source_freshness')).toBe(false)
    expect(items.filter(item => item.type === 'service_pending').map(item => item.vin)).toEqual(['SYNTHETIC-SERVICE-1', 'SYNTHETIC-SERVICE-2', 'SYNTHETIC-SERVICE-3', 'SYNTHETIC-SERVICE-4', 'SYNTHETIC-SERVICE-6'])
    expect(openStoreActionCount(fixture, 'Howell')).toBe(5)
    expect(openStoreActionCount(null, 'Howell')).toBe(0)
    show()
    expect(screen.getAllByRole('listitem')).toHaveLength(openStoreActionCount(fixture, 'Howell'))
    expect(screen.getByRole('button', { name: /All tasks\s*5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Service\s*4/ })).toBeInTheDocument()
    expect(screen.queryByText('Synthetic source_freshness')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Service status/ })).toHaveTextContent('3 waiting for service · 1 in service')
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  it('keeps a service task visible to the vehicle home store while the service-store association is pending', () => {
    const fixture = data()
    fixture.vehicles.push({
      ...vehicle('needs_service', 'Howell', '7'),
      serviceReadiness: { status: 'needs_service', store: null },
    } as VehicleRecord)

    const pendingStoreTask = actionableItems(fixture).find(item => item.vin === 'SYNTHETIC-SERVICE-7')
    expect(pendingStoreTask).toMatchObject({
      type: 'service_pending',
      store: 'Howell',
      relatedStores: ['Howell'],
      owner: 'Howell manager',
    })
    expect(openStoreActionCount(fixture, 'Howell')).toBe(6)
  })

  it('uses an exact VIN link and keeps resolved tasks out of the open navigation count', () => {
    const fixture = data()
    fixture.attention[1].status = 'resolved'
    const exact = actionableItems(fixture).find(item => item.type === 'past_expected_hold')
    expect(exact?.href).toBe('/inventory?scope=group&vin=TESTDATAHWELL0001&tab=hold')
    expect(openStoreActionCount(fixture, 'Howell')).toBe(4)
    mocked.context.data = fixture
    show()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('communicates delayed sources without turning source health into an employee task', () => {
    const fixture = data(); fixture.meta.dealerMailFreshness = 'stale_unverified'; mocked.context.data = fixture
    show()
    expect(screen.queryByText(/source data|inventory details may be out of date/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic source_freshness')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All tasks\s*5/ })).toBeInTheDocument()
  })

  it('resets queue scope when the signed-in working store changes', () => {
    const view = show()
    fireEvent.click(screen.getByRole('button', { name: 'All stores' }))
    mocked.context = { ...mocked.context, homeStore: 'Lincoln' }
    view.rerender(<MemoryRouter><AttentionPage/></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Lincoln' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText('Synthetic Service 3')).not.toBeInTheDocument()
  })
})
