import { describe, expect, it } from 'vitest'
import {
  actionCenterHref,
  boardFlowHref,
  dispositionView,
  exceptionHref,
  inventoryViewHref,
  inventoryVinsHref,
  locationHref,
  OVERVIEW_INVENTORY_VIEWS,
  readBoardRoute,
  readOverviewInventoryRequest,
  recordsHref,
  returnOverdueHref,
  serviceStatusHref,
  serviceVehicleHref,
  transferMatchesBoardRoute,
  withoutOverviewInventoryParams,
} from './overview-links'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
describe('Overview link contract (OVERVIEW_SPEC §8.4)', () => {
  it('builds every store-card Inventory view across the group', () => {
    for (const view of OVERVIEW_INVENTORY_VIEWS) {
      expect(inventoryViewHref('Ford Detroit', view)).toBe(`/inventory?scope=group&store=Ford+Detroit&view=${view}`)
    }
  })

  it('links service counts, return overdue and the Action center category', () => {
    expect(serviceStatusHref('needs_service', 'Howell')).toBe('/service?status=needs_service&store=Howell')
    expect(serviceStatusHref('in_service', 'Lincoln')).toBe('/service?status=in_service&store=Lincoln')
    expect(serviceStatusHref('serviced')).toBe('/service?status=serviced')
    expect(returnOverdueHref('Fowlerville')).toBe('/transfers?view=return-overdue&store=Fowlerville')
    expect(actionCenterHref('inventory')).toBe('/attention?category=inventory')
  })

  it('opens Records, the move, the vehicle location, or Service with a way back to the Overview', () => {
    expect(recordsHref('TESTDATAHWELL0001')).toBe('/inventory?scope=group&vin=TESTDATAHWELL0001&tab=data&returnTo=%2Foverview')
    expect(locationHref('TESTDATAHWELL0001', 'move-1')).toBe('/transfers?id=move-1&returnTo=%2Foverview')
    expect(locationHref('TESTDATAHWELL0001', null)).toBe('/inventory?scope=group&vin=TESTDATAHWELL0001&tab=movement&returnTo=%2Foverview')
    expect(serviceVehicleHref('TESTDATAHWELL0001')).toBe('/service?vin=TESTDATAHWELL0001&returnTo=%2Foverview')
  })

  it('sends each exception to its drill-down and caps a VIN list at 50', () => {
    const vins = Array.from({ length: 60 }, (_, index) => `TESTDATAVIN${String(index).padStart(6, '0')}`)
    expect(exceptionHref({ kind: 'location_conflict', store: 'Howell', vins: [] })).toBe('/inventory?scope=group&store=Howell&view=conflict')
    expect(exceptionHref({ kind: 'no_app_record', store: 'Howell', vins: [] })).toBe('/inventory?scope=group&store=Howell&view=unaccounted')
    expect(exceptionHref({ kind: 'stale_confirmation', store: 'Howell', vins: [] })).toBe('/inventory?scope=group&store=Howell&view=unaccounted')
    expect(exceptionHref({ kind: 'return_overdue', store: 'Lincoln', vins: [] })).toBe('/transfers?view=return-overdue&store=Lincoln')
    expect(exceptionHref({ kind: 'hold_past_expected', store: 'Howell', vins: [] })).toBe('/inventory?scope=group&store=Howell&view=holds-past-expected')
    expect(exceptionHref({ kind: 'identity_review', store: 'Howell', vins: [] })).toBe('/attention?category=inventory')
    expect(exceptionHref({ kind: 'records_incomplete', store: 'Howell', vins: [] })).toBe('/inventory?scope=group&store=Howell&view=records-incomplete')
    expect(exceptionHref({ kind: 'source_conflict', store: 'Howell', vins: ['TESTDATAHWELL0001', 'TESTDATAHWELL0002'] })).toBe('/inventory?scope=group&vins=TESTDATAHWELL0001%2CTESTDATAHWELL0002')
    const capped = new URLSearchParams(inventoryVinsHref(vins).split('?')[1]).get('vins')!.split(',')
    expect(capped).toHaveLength(50)
    // The two disposition prompts: the delivered view, and the one move that recorded delivery.
    expect(exceptionHref({ kind: 'listed_but_delivered', store: 'Fowlerville', vins: ['TESTDATAFWELL0002'] })).toBe('/inventory?scope=group&store=Fowlerville&view=disposition-delivered')
    expect(exceptionHref({ kind: 'delivered_move_no_disposition', store: 'Howell', vins: ['TESTDATAHWELL0001'], transferIds: ['move-1'] })).toBe('/transfers?id=move-1&returnTo=%2Foverview')
    expect(exceptionHref({ kind: 'delivered_move_no_disposition', store: 'Howell', vins: ['TESTDATAHWELL0001', 'TESTDATAHWELL0002'], transferIds: ['a', 'b'] })).toBe('/inventory?scope=group&vins=TESTDATAHWELL0001%2CTESTDATAHWELL0002')
  })

  it('names one Inventory view per disposition code and none recorded', () => {
    expect(['keep', 'sold_pending', 'delivered', 'wholesale', 'transfer_out', 'none'].map((code) => dispositionView(code as 'keep')))
      .toEqual(['disposition-keep', 'disposition-sold-pending', 'disposition-delivered', 'disposition-wholesale', 'disposition-transfer-out', 'disposition-none'])
    expect(readOverviewInventoryRequest(new URLSearchParams('store=Howell&view=disposition-sold-pending'))).toEqual({ overviewView: { view: 'disposition-sold-pending', store: 'Howell' } })
  })

  it('links a board arrow to exactly its leg, and reads only a complete, valid route', () => {
    expect(boardFlowHref({ from: 'Howell', to: 'Ford Detroit', kind: 'outbound' })).toBe('/transfers?from=Howell&to=Ford+Detroit&leg=outbound')
    expect(readBoardRoute(new URLSearchParams('from=Howell&to=Ford+Detroit&leg=outbound'))).toEqual({ from: 'Howell', to: 'Ford Detroit', leg: 'outbound' })
    for (const bad of ['from=Howell&to=Howell&leg=outbound', 'from=Howell&to=Nowhere&leg=planned', 'from=Howell&to=Lincoln&leg=sideways', 'from=Howell&to=Lincoln']) {
      expect(readBoardRoute(new URLSearchParams(bad)), bad).toBeNull()
    }
    const move = { homeStore: 'Howell', destination: 'Ford Detroit', currentLocation: 'Ford Detroit', requestStatus: 'arrived', movementStatus: 'at_requesting_store', locationConfidence: 'verified' }
    const outbound = { from: 'Howell', to: 'Ford Detroit', leg: 'outbound' } as const
    expect(transferMatchesBoardRoute(move, outbound)).toBe(true)
    expect(transferMatchesBoardRoute({ ...move, currentLocation: 'In transit', movementStatus: 'in_transit' }, outbound)).toBe(true)
    expect(transferMatchesBoardRoute({ ...move, currentLocation: 'Howell', requestStatus: 'approved' }, outbound)).toBe(false)
    expect(transferMatchesBoardRoute({ ...move, currentLocation: 'Howell', requestStatus: 'approved' }, { ...outbound, leg: 'planned' })).toBe(true)
    expect(transferMatchesBoardRoute({ ...move, locationConfidence: 'conflicting' }, outbound)).toBe(false)
    expect(transferMatchesBoardRoute({ ...move, requestStatus: 'delivery_confirmed' }, outbound)).toBe(false)
    const returning = { ...move, currentLocation: 'In transit', movementStatus: 'return_in_transit', requestStatus: 'return_in_transit' }
    expect(transferMatchesBoardRoute(returning, { from: 'Ford Detroit', to: 'Howell', leg: 'return' })).toBe(true)
    expect(transferMatchesBoardRoute(returning, outbound)).toBe(false)
  })

  it('reads Inventory entry parameters, ignoring unknown values, and strips them', () => {
    expect(readOverviewInventoryRequest(new URLSearchParams('scope=group&store=Howell&view=away'))).toEqual({ overviewView: { view: 'away', store: 'Howell' } })
    expect(readOverviewInventoryRequest(new URLSearchParams('store=Lincoln&service=in_service'))).toEqual({ store: 'Lincoln', serviceReadiness: 'in_service' })
    expect(readOverviewInventoryRequest(new URLSearchParams('vins=testdatahwell0001,,bad value,TESTDATAHWELL0001'))).toEqual({ vins: ['TESTDATAHWELL0001'] })
    expect(readOverviewInventoryRequest(new URLSearchParams('store=Nowhere&view=everything&service=sold'))).toBeNull()
    expect(withoutOverviewInventoryParams('?scope=group&store=Howell&view=away&service=serviced&vins=A&vin=X')).toBe('?scope=group&vin=X')
    expect(withoutOverviewInventoryParams('?store=Howell')).toBe('')
  })
})
