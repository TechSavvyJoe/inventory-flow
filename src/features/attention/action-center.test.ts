import { describe, expect, it } from 'vitest'
import type { AttentionItem, BootstrapData, StoreName, VehicleIssue, VehicleRecord } from '../../types'
import {
  actionCenterItems, belongsToActionStore, groupByVehicle, isActionable, openStoreActionCount,
} from './action-center'

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: `synthetic-${overrides.type ?? 'hold_alert'}-${overrides.vin ?? overrides.store ?? 'store'}`,
    type: 'hold_alert', severity: 'warning', status: 'open', priority: 'high',
    label: 'Synthetic hold alert', store: 'Howell', vin: 'TESTDATAHWELL0001',
    allowedActions: [], events: [], ...overrides,
  }
}

function vehicle(vin: string, store: StoreName, canManage?: boolean): VehicleRecord {
  return {
    vin, stockNumber: `SYN-${vin.slice(-2)}`, vehicleName: `Synthetic ${store} unit`, homeStore: store,
    serviceReadiness: { status: 'needs_service', store, ...(canManage === undefined ? {} : { canManage }) },
  } as VehicleRecord
}

function data(overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    attention: [
      item({ actionability: 'actionable', informationalReason: null }),
      item({ type: 'past_expected_hold', priority: 'urgent', actionability: 'actionable', informationalReason: null }),
      item({ type: 'transfer_next_action', vin: 'TESTDATAHWELL0002', store: 'Fowlerville', relatedStores: ['Howell', 'Fowlerville'], actionStore: 'Fowlerville', actionability: 'informational', informationalReason: 'other_store' }),
      item({ type: 'source_freshness', vin: undefined, store: undefined, severity: 'critical', priority: 'urgent', actionability: 'informational', informationalReason: 'source_health' }),
    ],
    vehicles: [vehicle('TESTDATAHWELL0001', 'Howell'), vehicle('TESTDATAHWELL0003', 'Howell')],
    meta: { reportDate: '2026-09-14', publicFreshness: 'current', dealerMailFreshness: 'current' },
    ...overrides,
  } as BootstrapData
}

describe('Action center triage on the client', () => {
  it('routes pending hold requests to manager review without a generic approval or completion shortcut', () => {
    const pending = vehicle('TESTDATAHWELL0001', 'Howell', false)
    pending.manualHold = { vin: pending.vin, state: 'requested', version: 1, ownerStore: 'Howell', updatedAt: null,
      expectedDeliveryDate: null, enabled: true, approvalEnabled: true, canManage: true, canApprove: true }
    const fixture = data({ attention: [], vehicles: [pending] })
    const request = actionCenterItems(fixture, { store: 'Howell', role: 'manager' }).find(entry => entry.type === 'hold_request')!
    expect(request).toMatchObject({ actionability: 'actionable', owner: 'Howell manager', allowedActions: [],
      href: '/inventory?scope=group&vin=TESTDATAHWELL0001&tab=hold' })
    expect(request.whyItMatters).toContain('Manager approval has not been recorded')
    pending.manualHold.canApprove = false
    expect(actionCenterItems(fixture, { store: 'Howell', role: 'sales' }).find(entry => entry.type === 'hold_request'))
      .toMatchObject({ actionability: 'informational', informationalReason: 'role_scope', allowedActions: [] })
    pending.manualHold.state = 'active'
    expect(actionCenterItems(fixture, { store: 'Howell', role: 'manager' }).some(entry => entry.type === 'hold_request')).toBe(false)
  })
  it('retains issue tasks for vehicles absent from the feed, with no generic completion path', () => {
    const issue: VehicleIssue = { id: 'synthetic-issue', vin: 'TESTDATAHWELL0001', stockNumber: 'SYN-1', vehicleName: 'Synthetic vehicle', homeStore: 'Howell', reportStore: 'Howell', category: 'fuel', priority: 'urgent', description: 'Fuel required before lot drive', status: 'open', version: 1, assignee: null, reportedBy: 'Synthetic sales', reportedByUserId: 'synthetic-sales', reportedAt: '2026-09-25T12:00:00Z', updatedAt: '2026-09-25T12:00:00Z', completedAt: null, completedBy: null, photoCount: 0, allowedActions: ['add_note', 'request_completion'] }
    const fixture = data({ attention: [], vehicles: [], vehicleIssues: [issue] })
    const [entry] = actionCenterItems(fixture, { store: 'Howell', role: 'sales' })
    expect(entry).toMatchObject({ type: 'vehicle_issue', priority: 'urgent', actionability: 'actionable', href: '/attention?issue=synthetic-issue', allowedActions: [], events: [] })
    expect(openStoreActionCount(fixture, { store: 'Howell', role: 'sales' })).toBe(1)
    issue.status = 'awaiting_review'
    expect(openStoreActionCount(fixture, { store: 'Howell', role: 'sales' })).toBe(0)
    expect(openStoreActionCount(fixture, { store: 'Howell', role: 'manager' })).toBe(1)
    expect(openStoreActionCount(fixture, { store: 'Lincoln', role: 'group_manager' })).toBe(0)
    issue.status = 'completed'
    expect(openStoreActionCount(fixture, { store: 'Howell', role: 'manager' })).toBe(0)
    expect(actionCenterItems(fixture, { store: 'Howell', role: 'manager' })[0].status).toBe('resolved')
  })
  it('counts one row per vehicle and leaves everything else classified but uncounted', () => {
    const fixture = data()
    const viewer = { store: 'Howell' as StoreName, role: 'manager' as const }
    const items = actionCenterItems(fixture, viewer)

    // Two hold conditions plus a service task all describe TESTDATAHWELL0001.
    expect(items.filter(entry => entry.vin === 'TESTDATAHWELL0001')).toHaveLength(3)
    expect(openStoreActionCount(fixture, viewer)).toBe(2)
    expect(openStoreActionCount(null, viewer)).toBe(0)

    const informational = items.filter(entry => !isActionable(entry))
    expect(informational.map(entry => entry.informationalReason).sort()).toEqual(['other_store', 'source_health'])
  })

  it('collapses one vehicle’s conditions into a single row that names them', () => {
    const viewer = { store: 'Howell' as StoreName, role: 'manager' as const }
    const actionable = actionCenterItems(data(), viewer).filter(isActionable)
    const rows = groupByVehicle(actionable)

    const held = rows.find(row => row.lead.vin === 'TESTDATAHWELL0001')!
    expect(held.items).toHaveLength(3)
    expect(held.conditions).toEqual(['Review the hold alert', 'Follow up on the expected hold date', 'Arrange service'])
    expect(rows).toHaveLength(2)
  })

  it('treats a service status as work only for the store manager who may record it', () => {
    const fixture = data()
    expect(openStoreActionCount(fixture, { store: 'Howell', role: 'sales' })).toBe(1)
    const forSales = actionCenterItems(fixture, { store: 'Howell', role: 'sales' })
      .filter(entry => entry.type === 'service_pending')
    expect(forSales.every(entry => entry.informationalReason === 'role_scope')).toBe(true)

    // A server-supplied permission decides it when the payload carries one.
    const denied = data({ vehicles: [vehicle('TESTDATAHWELL0001', 'Howell', false)] })
    expect(actionCenterItems(denied, { store: 'Howell', role: 'manager' })
      .find(entry => entry.type === 'service_pending')).toMatchObject({ actionability: 'informational' })
  })

  it('keeps another store’s next step and a group-wide notice visible without counting them', () => {
    const fixture = data()
    const items = actionCenterItems(fixture, { store: 'Howell', role: 'manager' })
    const move = items.find(entry => entry.type === 'transfer_next_action')!
    const freshness = items.find(entry => entry.type === 'source_freshness')!

    expect(belongsToActionStore(move, 'Howell')).toBe(true)
    expect(isActionable(move)).toBe(false)
    // A notice that names no store belongs to every scope, not to none of them.
    expect(belongsToActionStore(freshness, 'Fowlerville')).toBe(true)
    expect(isActionable(freshness)).toBe(false)
  })

  it('falls back to its own rule for a payload published before triage shipped', () => {
    const legacy = data({
      attention: [
        item({ actionability: undefined, informationalReason: undefined }),
        item({ type: 'missing_price', vin: undefined, count: 3, actionability: undefined }),
        item({ type: 'transfer_next_action', vin: 'TESTDATAHWELL0002', store: 'Lincoln', relatedStores: ['Howell', 'Lincoln'], actionability: undefined }),
      ],
      vehicles: [],
    })
    const items = actionCenterItems(legacy, { store: 'Howell', role: 'manager' })
    expect(items.map(entry => [entry.type, entry.actionability, entry.informationalReason])).toEqual([
      ['hold_alert', 'actionable', null],
      ['missing_price', 'informational', 'public_listing'],
      ['transfer_next_action', 'informational', 'other_store'],
    ])
    expect(openStoreActionCount(legacy, { store: 'Howell', role: 'manager' })).toBe(1)
  })
})
