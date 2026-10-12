// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import {
  filterPanelHoldValue, filterPanelMovementValue, inventoryInLocationScope, matchesInventoryQuickView,
  selectHoldFilter, selectMovementFilter, selectQuickView, type InventoryViewState,
} from './inventory-quick-views'
import { vehicleMatchesFilters, DEFAULT_INVENTORY_FILTERS } from './inventory-utils'
import type { InventoryScope, InventoryVehicle } from './types'

const howell = { id: 'howell', name: 'Howell' }
const fowlerville = { id: 'fowlerville', name: 'Fowlerville' }
const lincoln = { id: 'lincoln', name: 'Lincoln' }
function vehicle(overrides: Partial<InventoryVehicle> = {}): InventoryVehicle {
  return {
    id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'SYNTHETIC-QUICK-VIEW',
    year: 2026, make: 'Ford', model: 'Synthetic model', price: null, mileage: null,
    publicListing: { dataState: 'current', isListed: true },
    dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: 'current', hasActiveHold: false },
    location: { homeStore: howell, sourceReportedStore: howell },
    ...overrides,
  }
}
function matches(record: InventoryVehicle, view: Parameters<typeof matchesInventoryQuickView>[1], scope: InventoryScope = 'home') {
  return matchesInventoryQuickView(record, view, { scope, homeStore: howell })
}

describe('inventory quick views use independent hold and location evidence', () => {
  it('includes manual holds in Held while keeping imported no-hold evidence separate', () => {
    const held = vehicle({ manualHold:{ vin:'TESTDATAHWELL0001', state:'active', version:1, ownerStore:'Howell', canManage:true, enabled:true, expectedDeliveryDate:null, updatedAt:null } })
    expect(matches(held, 'held')).toBe(true)
    expect(matches(held, 'no-hold')).toBe(false)
    expect(held.dealerMail.hasActiveHold).toBe(false)
  })
  it('filters app decisions and conflicts without changing the imported source status', () => {
    const record = vehicle({ appDisposition:{ vin:'TESTDATAHWELL0001', code:'other', version:1, ownerStore:'Howell', canManage:true, effectiveDate:null, destinationStore:null, updatedAt:null, updatedByRole:'manager', store:'Howell' } })
    expect(vehicleMatchesFilters(record, { ...DEFAULT_INVENTORY_FILTERS, disposition:'other' })).toBe(true)
    expect(vehicleMatchesFilters(record, { ...DEFAULT_INVENTORY_FILTERS, disposition:'sold_pending' })).toBe(false)
    expect(matches(record, 'no-hold')).toBe(true)
    expect(record.publicListing.isListed).toBe(true)
  })
  it.each(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'other'] as const)('keeps %s independently visible in No hold and its decision filter', code => {
    const record = vehicle({ appDisposition: { vin: 'TESTDATAHWELL0001', code, version: 1, ownerStore: 'Howell', canManage: true, effectiveDate: null, destinationStore: null, updatedAt: null, updatedByRole: 'manager', store: 'Howell' } })
    expect(matches(record, 'no-hold')).toBe(true)
    expect(vehicleMatchesFilters(record, { ...DEFAULT_INVENTORY_FILTERS, disposition: code })).toBe(true)
    expect(record.dealerMail.hasActiveHold).toBe(false)
  })
  it('includes owned units and known visitors in home scope, including held visitors', () => {
    const ownedElsewhere = vehicle({ location: { homeStore: howell, sourceReportedStore: fowlerville } })
    const visitor = vehicle({ location: { homeStore: lincoln, sourceReportedStore: howell } })
    const elsewhere = vehicle({ location: { homeStore: lincoln, sourceReportedStore: fowlerville } })
    expect(inventoryInLocationScope(ownedElsewhere, 'home', howell)).toBe(true)
    expect(inventoryInLocationScope(visitor, 'home', howell)).toBe(true)
    expect(inventoryInLocationScope(elsewhere, 'home', howell)).toBe(false)
    expect(inventoryInLocationScope(elsewhere, 'group', howell)).toBe(true)
    expect(matches(visitor, 'no-hold')).toBe(true)
    expect(matches({ ...visitor, dealerMail: { dataState: 'current', hasActiveHold: true } }, 'held')).toBe(true)
    // The caller combines scope with the view; All adds no second scope filter.
    expect(matches(elsewhere, 'all')).toBe(true)
    expect(matches(elsewhere, 'all', 'group')).toBe(true)
  })

  it('uses app-confirmed location before an older source-reported store', () => {
    const record = vehicle({ location: { homeStore: howell, sourceReportedStore: howell, appConfirmedLocation: 'Fowlerville', appConfirmedStore: fowlerville } })
    expect(matches(record, 'no-hold')).toBe(false)
    expect(matches(record, 'offsite')).toBe(true)
    const departedVisitor = { ...record, location: { ...record.location, homeStore: lincoln } }
    expect(inventoryInLocationScope(departedVisitor, 'home', howell)).toBe(false)
  })

  it('shows group no-hold units at any known group store, not only the selected location', () => {
    const elsewhere = vehicle({ location: { homeStore: lincoln, sourceReportedStore: lincoln } })
    expect(matches(elsewhere, 'no-hold')).toBe(false)
    expect(matches(elsewhere, 'no-hold', 'group')).toBe(true)
    const vendor = vehicle({ location: { homeStore: howell, appConfirmedLocation: 'External service vendor', appConfirmedAt: '2026-08-30T12:00:00Z' } })
    expect(matches(vendor, 'no-hold', 'group')).toBe(false)
    expect(matches(vendor, 'offsite')).toBe(false)
  })

  it('keeps hold and offsite categories independent', () => {
    const heldAway = vehicle({ dealerMail: { dataState: 'current', hasActiveHold: true }, location: { homeStore: howell, sourceReportedStore: fowlerville } })
    expect(matches(heldAway, 'held')).toBe(true)
    expect(matches(heldAway, 'offsite')).toBe(true)
    expect(matches(heldAway, 'no-hold')).toBe(false)
    const visitor = { ...heldAway, location: { homeStore: fowlerville, sourceReportedStore: howell } }
    expect(matches(visitor, 'offsite')).toBe(false)
    expect(matches(visitor, 'offsite', 'group')).toBe(true)
  })

  it('does not fabricate a current location from ownership, CRM store or a request', () => {
    const unknown = vehicle({ location: { homeStore: howell, crmStore: howell }, movement: { requestId: 'synthetic-request', requestStatus: 'requested' } })
    expect(matches(unknown, 'all')).toBe(true)
    expect(matches(unknown, 'no-hold')).toBe(false)
    expect(matches(unknown, 'offsite')).toBe(false)
    expect(matches(unknown, 'moving')).toBe(true)
  })

  it.each(['requested', 'approved', 'transport_assigned', 'return_requested', 'return_assigned'])('does not mistake %s for physical departure', requestStatus => {
    const record = vehicle({ movement: { state: 'at_home', requestStatus, requestId: 'synthetic-request' } })
    expect(matches(record, 'no-hold')).toBe(true)
    expect(matches(record, 'offsite')).toBe(false)
    expect(matches(record, 'moving')).toBe(true)
  })

  it.each(['in_transit', 'picked_up', 'return_in_transit', 'returning'])('excludes explicit %s from no-hold at the store and includes it offsite', state => {
    const record = vehicle({ movement: { state, requestId: 'synthetic-request' }, location: { homeStore: howell, sourceReportedStore: howell, appConfirmedLocation: 'In transit', appConfirmedAt: '2026-08-30T12:00:00Z' } })
    for (const scope of ['home', 'group'] as const) {
      expect(matches(record, 'no-hold', scope)).toBe(false)
      expect(matches(record, 'offsite', scope)).toBe(true)
    }
  })

  it('does not turn conflicting location records into either at-store or offsite evidence', () => {
    const conflict = vehicle({ location: { homeStore: howell, sourceReportedStore: fowlerville, appConfirmedLocation: 'In transit', conflict: true }, movement: { state: 'in_transit' } })
    expect(matches(conflict, 'all')).toBe(true)
    expect(matches(conflict, 'no-hold')).toBe(false)
    expect(matches(conflict, 'offsite')).toBe(false)
  })

  it.each(['Unknown', 'Location not confirmed', 'Location needs checking'])('excludes the %s sentinel rather than falling back to a public store', appConfirmedLocation => {
    const record = vehicle({ location: { homeStore: howell, sourceReportedStore: howell, appConfirmedLocation, appConfirmedAt: '2026-08-30T12:00:00Z' } })
    expect(matches(record, 'no-hold')).toBe(false)
    expect(matches(record, 'offsite')).toBe(false)
  })

  it('recognizes returned-home custody after the move has closed', () => {
    const returned = vehicle({ movement: null, location: { homeStore: howell, sourceReportedStore: fowlerville, appConfirmedLocation: 'Howell', appConfirmedStore: howell, appConfirmedAt: '2026-08-30T12:00:00Z' } })
    expect(matches(returned, 'no-hold')).toBe(true)
    expect(matches(returned, 'offsite')).toBe(false)
    expect(matches(returned, 'moving')).toBe(false)
  })

  it('retains an explicitly published no-hold observation without treating missing hold data as no-hold', () => {
    const stale = vehicle({ dealerMail: { dataState: 'stale', hasActiveHold: null, lastKnownNoHold: true } })
    expect(matches(stale, 'no-hold')).toBe(true)
    for (const dealerMail of [
      { dataState: 'stale' as const, hasActiveHold: false },
      { dataState: 'current' as const, hasActiveHold: null },
      { dataState: 'unavailable' as const, hasActiveHold: null },
      { dataState: 'incomplete' as const, hasActiveHold: null, lastKnownNoHold: true },
      { dataState: 'current' as const, hasActiveHold: true, lastKnownNoHold: true },
      { dataState: 'stale' as const, hasActiveHold: null, lastKnownNoHold: true, lastKnownActiveHold: true },
    ]) expect(matches(vehicle({ dealerMail }), 'no-hold')).toBe(false)
    expect(matches(vehicle({ dealerMail: { dataState: 'stale', hasActiveHold: null, lastKnownActiveHold: true } }), 'held')).toBe(true)
  })

  it('excludes loaners and manager-recorded sales from the no-hold working view', () => {
    const loaner = vehicle({ dealerMail: { dataState: 'current', hasActiveHold: false, loaner: { active: true, label: 'Synthetic service loaner' } } })
    const sold = vehicle({ managerDisposition: { dataState: 'current', sold: true, delivered: false, sourceStore: howell, sourcePeriod: '2026-08', confidence: 'high', soldLabel: 'Sold — manager log', deliveryLabel: 'Not marked delivered — manager log' } })
    for (const record of [loaner, sold]) {
      expect(matches(record, 'all')).toBe(true)
      expect(matches(record, 'no-hold')).toBe(false)
    }
  })

  it('preserves secondary movement and daily change views', () => {
    expect(matches(vehicle({ movement: { state: 'at_home', requestId: 'synthetic-request' } }), 'moving')).toBe(true)
    expect(matches(vehicle({ changeSummary: 'New arrival · price changed' }), 'new')).toBe(true)
    expect(matches(vehicle({ changeSummary: 'New today' }), 'new')).toBe(true)
    expect(matches(vehicle({ changeSummary: 'New arrival · price changed' }), 'price')).toBe(true)
    expect(matches(vehicle(), 'new')).toBe(false)
    expect(matches(vehicle(), 'price')).toBe(false)
  })
})

describe('quick-view chips and Filters-panel facets', () => {
  const start = (quickView: InventoryViewState['quickView'] = 'all', filters: Partial<InventoryViewState['filters']> = {}): InventoryViewState =>
    ({ quickView, filters: { ...DEFAULT_INVENTORY_FILTERS, ...filters } })

  it('selects Held without conflating it with the quick-view state', () => {
    const fromSelect = selectHoldFilter(start(), 'held')
    expect(fromSelect.quickView).toBe('all')
    expect(fromSelect.filters.dealerMail).toBe('held')
    expect(filterPanelHoldValue(fromSelect)).toBe('held')
    const fromChip = selectQuickView(start(), 'held')
    expect(fromChip).toEqual(fromSelect)
    expect(selectHoldFilter(fromChip, 'all')).toEqual(start())
  })

  it('stores movement independently and keeps the narrower overdue refinement', () => {
    const fromSelect = selectMovementFilter(start(), 'active')
    expect(fromSelect).toEqual(selectQuickView(start(), 'moving'))
    expect(filterPanelMovementValue(fromSelect)).toBe('active')
    const overdue = selectMovementFilter(fromSelect, 'overdue')
    expect(overdue.quickView).toBe('all')
    expect(filterPanelMovementValue(overdue)).toBe('overdue')
    expect(selectMovementFilter(fromSelect, 'none').quickView).toBe('all')
  })

  it('clears only the changed facet and preserves the other family', () => {
    expect(selectHoldFilter(start('held'), 'not-held')).toEqual(start('all', { dealerMail: 'not-held' }))
    expect(selectHoldFilter(start('no-hold'), 'unverified')).toEqual(start('all', { dealerMail: 'unverified' }))
    expect(selectHoldFilter(start('no-hold'), 'not-held').quickView).toBe('no-hold')
    expect(selectHoldFilter(start('offsite'), 'unverified').quickView).toBe('offsite')
    expect(selectQuickView(start('all', { dealerMail: 'unverified' }), 'no-hold').filters.dealerMail).toBe('all')
    expect(selectQuickView(start('all', { dealerMail: 'not-held' }), 'offsite').filters.dealerMail).toBe('not-held')
    expect(selectQuickView(start('all', { movement: 'none' }), 'moving').filters.movement).toBe('active')
    const combined = selectQuickView(selectQuickView(start(), 'held'), 'moving')
    expect(combined.filters).toMatchObject({ dealerMail: 'held', movement: 'active' })
    expect(selectQuickView(combined, 'held').filters).toMatchObject({ dealerMail: 'held', movement: 'active' })
    expect(selectQuickView(combined, 'moving').filters).toMatchObject({ dealerMail: 'held', movement: 'active' })
    expect(selectQuickView(combined, 'all').filters).toMatchObject({ dealerMail: 'all', movement: 'active' })
    expect(selectHoldFilter(combined, 'all').filters).toMatchObject({ dealerMail: 'all', movement: 'active' })
    expect(selectMovementFilter(combined, 'none').filters).toMatchObject({ dealerMail: 'held', movement: 'none' })
  })
})
