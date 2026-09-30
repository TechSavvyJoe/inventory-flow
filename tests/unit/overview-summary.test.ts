// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
//
// The server-side Overview projection (OVERVIEW_SPEC §5, §7): one case per
// metric definition on hand-built synthetic views, then the same rules end to
// end through bootstrap() on the synthetic release with real move events.

import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { buildOverviewSummary, OVERVIEW_THRESHOLDS, overviewAccess } from '../../server/overview-summary.mjs'
import { createInventoryService } from '../../server/service.mjs'

const DAY = 86_400_000
const AS_OF = '2026-08-30'
const META = { timezone: 'America/New_York', reportDate: AS_OF }
const MANAGER = { role: 'manager', store: 'Howell', user: 'Synthetic Overview Manager' }

function vehicle(vin, overrides = {}) {
  return {
    vin,
    make: 'Ford',
    homeStore: 'Howell',
    publicStore: 'Howell',
    crmStore: 'Howell',
    sourceReportedLocation: 'Howell',
    publicListing: 'listed',
    daysListed: 10,
    inventoryDate: '2026-08-20',
    movement: { state: 'source_reported', currentLocation: 'Howell', locationConfidence: 'reported' },
    hold: { state: 'none_observed' },
    serviceReadiness: { status: 'needs_service', readinessBasis: 'unconfirmed', store: 'Howell', readinessEvidence: null },
    ...overrides,
  }
}

function ledger(movement) {
  return { state: 'at_requesting_store', locationConfidence: 'verified', ...movement }
}

function build(vehicles, input = {}) {
  return buildOverviewSummary({ context: MANAGER, meta: META, asOfDay: AS_OF, vehicles, ...input })
}

function facts(vehicles, input = {}) {
  return build(vehicles, input).vehicleFacts
}

function store(summary, name) {
  return summary.stores.find((entry) => entry.store === name)
}

describe('overview projection metric definitions (§5)', () => {
  it('publishes the thresholds and the role access it was built for', () => {
    const summary = build([])
    expect(summary).toMatchObject({ asOfDay: AS_OF, scopeStore: 'Howell', role: 'manager', access: 'full' })
    expect(summary.thresholds).toEqual({
      unaccountedAfterDays: 7, agedListingDays: [60, 90], serviceWaitingDays: [14, 30], listedAfterDeliveredDays: 3, recentReceiptDays: 7,
    })
    expect(summary.thresholds).toEqual(JSON.parse(JSON.stringify(OVERVIEW_THRESHOLDS)))
    expect(summary.stores.map((entry) => entry.store)).toEqual(['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'])
    expect(summary.group).not.toHaveProperty('store')
    expect(overviewAccess('group_manager')).toBe('full')
    expect(overviewAccess('manager')).toBe('full')
    expect(overviewAccess('sales')).toBe('read_only')
    for (const role of ['coordinator', 'porter', 'driver', 'unknown', '__proto__']) expect(overviewAccess(role)).toBeNull()
  })

  it('derives custody for all four values on both bases, and visiting from the other store', () => {
    const result = build([
      vehicle('VINONLOTSOURCE001'),
      vehicle('VINONLOTLEDGER001', { movement: ledger({ state: 'returned_home', currentLocation: 'Howell' }) }),
      vehicle('VINAWAYLEDGER0001', { movement: ledger({ currentLocation: 'Fowlerville' }) }),
      vehicle('VINAWAYSOURCE0001', { sourceReportedLocation: 'Lincoln', publicStore: 'Lincoln', crmStore: 'Lincoln', movement: { state: 'source_reported', currentLocation: 'Lincoln' } }),
      vehicle('VINTRANSIT0000001', { movement: ledger({ state: 'picked_up', currentLocation: 'In transit' }) }),
      vehicle('VINCONFLICT000001', { movement: { state: 'location_exception', currentLocation: 'Unknown', locationConfidence: 'conflicting' } }),
      vehicle('VINCONFLICT000002', { movement: ledger({ currentLocation: 'Howell', locationConfidence: 'conflicting' }) }),
    ])
    const view = result.vehicleFacts
    expect(view.VINONLOTSOURCE001).toMatchObject({ custody: 'on_lot', custodyBasis: 'source_reported', currentStore: 'Howell' })
    expect(view.VINONLOTLEDGER001).toMatchObject({ custody: 'on_lot', custodyBasis: 'ledger', currentStore: 'Howell' })
    expect(view.VINAWAYLEDGER0001).toMatchObject({ custody: 'away', custodyBasis: 'ledger', currentStore: 'Fowlerville' })
    expect(view.VINAWAYSOURCE0001).toMatchObject({ custody: 'away', custodyBasis: 'source_reported', currentStore: 'Lincoln' })
    expect(view.VINTRANSIT0000001).toMatchObject({ custody: 'in_transit', custodyBasis: 'ledger' })
    expect(view.VINTRANSIT0000001).not.toHaveProperty('currentStore')
    expect(view.VINCONFLICT000001).toMatchObject({ custody: 'conflict' })
    expect(view.VINCONFLICT000002).toMatchObject({ custody: 'conflict' })
    expect(store(result, 'Howell')).toMatchObject({ onLot: 2, onLotSourceReported: 1, away: 2, inTransit: 1, conflict: 2, visiting: 0 })
    expect(store(result, 'Fowlerville')).toMatchObject({ visiting: 1, away: 0, onLot: 0 })
    expect(store(result, 'Lincoln')).toMatchObject({ visiting: 1 })
    expect(result.group).toMatchObject({ onLot: 2, away: 2, visiting: 2, inTransit: 1, conflict: 2 })
  })

  it('marks the return leg only for a return_in_transit movement', () => {
    const view = facts([
      vehicle('VINRETURNLEG00001', { movement: ledger({ state: 'return_in_transit', currentLocation: 'In transit' }) }),
      vehicle('VINOUTBOUND000001', { movement: ledger({ state: 'picked_up', currentLocation: 'In transit' }) }),
    ])
    expect(view.VINRETURNLEG00001.returnLeg).toBe('return')
    expect(view.VINOUTBOUND000001).not.toHaveProperty('returnLeg')
  })

  it('counts days away from the recorded departure day, and leaves them unknown without one', () => {
    const view = facts([
      vehicle('VINDAYSAWAY000001', { movement: ledger({ currentLocation: 'Fowlerville', departedAt: '2026-08-21T14:00:00.000Z', lastConfirmedAt: '2026-08-29T14:00:00.000Z' }) }),
      // 01:30Z on the 22nd is still the 21st in New York.
      vehicle('VINDAYSAWAY000002', { movement: ledger({ currentLocation: 'Fowlerville', departedAt: '2026-08-22T01:30:00.000Z', lastConfirmedAt: '2026-08-29T14:00:00.000Z' }) }),
      vehicle('VINNODEPARTURE001', { movement: ledger({ currentLocation: 'Fowlerville', lastConfirmedAt: '2026-08-29T14:00:00.000Z' }) }),
      vehicle('VINHOMEDEPARTED01', { movement: ledger({ currentLocation: 'Howell', departedAt: '2026-08-21T14:00:00.000Z' }) }),
    ])
    expect(view.VINDAYSAWAY000001).toMatchObject({ daysAway: 9, departedAt: '2026-08-21T14:00:00.000Z' })
    expect(view.VINDAYSAWAY000002.daysAway).toBe(9)
    expect(view.VINNODEPARTURE001).toMatchObject({ daysAwayBasis: 'unknown' })
    expect(view.VINNODEPARTURE001).not.toHaveProperty('daysAway')
    expect(view.VINHOMEDEPARTED01).not.toHaveProperty('daysAway')
    expect(view.VINHOMEDEPARTED01).not.toHaveProperty('daysAwayBasis')
  })

  it('applies the unaccounted rules in precedence order with the 7-day boundary', () => {
    const away = (vin, lastConfirmedAt, extra = {}) => vehicle(vin, { movement: ledger({ currentLocation: 'Fowlerville', lastConfirmedAt }), ...extra })
    const view = facts([
      // Rule 1 wins over a website/DealerMail store disagreement.
      vehicle('VINUNACCOUNTED001', { crmStore: 'Lincoln', movement: { state: 'location_exception', currentLocation: 'Unknown', locationConfidence: 'conflicting' } }),
      // Rule 2 wins over a stale confirmation.
      away('VINUNACCOUNTED002', '2026-08-01T14:00:00.000Z', { crmStore: 'Lincoln' }),
      vehicle('VINUNACCOUNTED003', { sourceReportedLocation: 'Fowlerville', publicStore: 'Fowlerville', crmStore: 'Fowlerville' }),
      away('VINUNACCOUNTED004', '2026-08-23T14:00:00.000Z'),
      away('VINUNACCOUNTED005', '2026-08-24T14:00:00.000Z'),
      // Stale confirmation also covers a vehicle in transit.
      vehicle('VINUNACCOUNTED006', { movement: ledger({ state: 'picked_up', currentLocation: 'In transit', lastConfirmedAt: '2026-08-10T14:00:00.000Z' }) }),
      // Home with no ledger is not unaccounted: nothing contradicts it.
      vehicle('VINUNACCOUNTED007'),
    ])
    expect(view.VINUNACCOUNTED001.unaccounted).toEqual({ reason: 'location_conflict' })
    expect(view.VINUNACCOUNTED002.unaccounted).toEqual({ reason: 'source_conflict' })
    expect(view.VINUNACCOUNTED003.unaccounted).toEqual({ reason: 'no_app_record' })
    expect(view.VINUNACCOUNTED004.unaccounted).toEqual({ reason: 'stale_confirmation', days: 7 })
    expect(view.VINUNACCOUNTED005).not.toHaveProperty('unaccounted')
    expect(view.VINUNACCOUNTED006.unaccounted).toEqual({ reason: 'stale_confirmation', days: 20 })
    expect(view.VINUNACCOUNTED007).not.toHaveProperty('unaccounted')
  })

  it('falls back to the visible request time when a move was never confirmed', () => {
    const view = facts(
      [vehicle('VINREQUESTEDONLY1', { movement: ledger({ transferId: 'move-1', currentLocation: 'Fowlerville' }) })],
      { visibleTransferRows: [{ id: 'move-1', vin: 'VINREQUESTEDONLY1', requested_at: '2026-08-20T12:00:00.000Z', status: 'arrived', home_store_id: 'Howell', destination_store_id: 'Fowlerville', current_location_id: 'Fowlerville', movement_status: 'at_requesting_store', location_confidence: 'verified' }] },
    )
    expect(view.VINREQUESTEDONLY1.unaccounted).toEqual({ reason: 'stale_confirmation', days: 10 })
  })

  it('attributes return overdue to the home store per ledger row and emits recent receipts only', () => {
    const rows = [
      { id: 'overdue-1', vin: 'VINRETURNDUE00001', home_store_id: 'Howell', destination_store_id: 'Lincoln', current_location_id: 'Lincoln', status: 'arrived', movement_status: 'at_requesting_store', location_confidence: 'verified' },
      { id: 'received-1', vin: 'VINRECEIVED000001', home_store_id: 'Howell', destination_store_id: 'Fowlerville', current_location_id: 'Howell', status: 'closed', movement_status: 'returned_home', location_confidence: 'verified' },
      { id: 'received-2', vin: 'VINRECEIVED000002', home_store_id: 'Howell', destination_store_id: 'Fowlerville', current_location_id: 'Howell', status: 'closed', movement_status: 'returned_home', location_confidence: 'verified' },
    ]
    const events = new Map([
      ['received-1', [{ event_type: 'returned_home', occurred_at: '2026-08-10T15:00:00.000Z' }, { event_type: 'returned_home', occurred_at: '2026-08-23T15:00:00.000Z' }]],
      ['received-2', [{ event_type: 'returned_home', occurred_at: '2026-08-22T15:00:00.000Z' }]],
    ])
    const result = build([
      vehicle('VINRETURNDUE00001', { movement: ledger({ currentLocation: 'Lincoln', returnDueAt: '2026-08-28T21:00:00.000Z', lastConfirmedAt: '2026-08-29T12:00:00.000Z' }) }),
      vehicle('VINRECEIVED000001', { movement: ledger({ state: 'returned_home', currentLocation: 'Howell' }) }),
      vehicle('VINRECEIVED000002', { movement: ledger({ state: 'returned_home', currentLocation: 'Howell' }) }),
    ], { visibleTransferRows: rows, transferEventsById: events, returnOverdueTransferIds: new Set(['overdue-1']) })
    expect(result.vehicleFacts.VINRETURNDUE00001).toMatchObject({ returnDueAt: '2026-08-28T21:00:00.000Z', returnOverdue: true })
    expect(result.vehicleFacts.VINRECEIVED000001).toMatchObject({ receivedHomeAt: '2026-08-23' })
    expect(result.vehicleFacts.VINRECEIVED000001).not.toHaveProperty('returnOverdue')
    expect(result.vehicleFacts.VINRECEIVED000002).not.toHaveProperty('receivedHomeAt')
    expect(store(result, 'Howell').returnOverdue).toBe(1)
    expect(store(result, 'Lincoln').returnOverdue).toBe(0)
    expect(result.exceptions.find((entry) => entry.kind === 'return_overdue')).toEqual({
      kind: 'return_overdue', store: 'Howell', count: 1, vins: ['VINRETURNDUE00001'], transferIds: ['overdue-1'],
    })
  })

  it('emits receivedHomeAt only while the vehicle is still on lot, not after a later departure', () => {
    const rows = [
      { id: 'return-1', vin: 'VINRECEIVEDAWAY01', home_store_id: 'Howell', destination_store_id: 'Fowlerville', current_location_id: 'Howell', status: 'closed', movement_status: 'returned_home', location_confidence: 'verified' },
      { id: 'return-2', vin: 'VINRECEIVEDHOME01', home_store_id: 'Howell', destination_store_id: 'Fowlerville', current_location_id: 'Howell', status: 'closed', movement_status: 'returned_home', location_confidence: 'verified' },
    ]
    const events = new Map([
      ['return-1', [{ event_type: 'returned_home', occurred_at: '2026-08-24T15:00:00.000Z' }]],
      ['return-2', [{ event_type: 'returned_home', occurred_at: '2026-08-24T15:00:00.000Z' }]],
    ])
    const result = build([
      // Returned home, then departed again on a new direct move: custody is away.
      vehicle('VINRECEIVEDAWAY01', { movement: ledger({ state: 'picked_up', currentLocation: 'Fowlerville', departedAt: '2026-08-27T14:00:00.000Z' }) }),
      // Returned home with no later move: custody stays on_lot.
      vehicle('VINRECEIVEDHOME01', { movement: ledger({ state: 'returned_home', currentLocation: 'Howell' }) }),
    ], { visibleTransferRows: rows, transferEventsById: events })
    expect(result.vehicleFacts.VINRECEIVEDAWAY01).not.toHaveProperty('receivedHomeAt')
    expect(result.vehicleFacts.VINRECEIVEDHOME01).toMatchObject({ receivedHomeAt: '2026-08-24' })
  })

  it('counts holds from active hold rows only, equal to the hold signals, never from hold labels', () => {
    const holdRows = [
      { vin: 'VINHELDACTIVE0001', crm_store_id: 'Howell', active_hold_count: 1, expected_date: '2026-08-31' },
      { vin: 'VINHELDPAST000001', crm_store_id: 'Howell', active_hold_count: 2, expected_date: '2026-08-29' },
      { vin: 'VINHELDZERO000001', crm_store_id: 'Howell', active_hold_count: 0, expected_date: '2026-08-01' },
    ]
    const holdSignals = [{ store: 'Howell', activeHoldVins: 2, pastExpected: 1 }, { store: 'Lincoln', activeHoldVins: 0, pastExpected: 0 }]
    const result = build([
      vehicle('VINHELDACTIVE0001', { hold: { state: 'primary', label: 'Primary hold' } }),
      vehicle('VINHELDPAST000001', { hold: { state: 'multiple', label: 'Primary hold + 1 backup' } }),
      // A label that reads like a hold never makes one.
      vehicle('VINHELDZERO000001', { hold: { state: 'none_observed', label: 'Primary hold' } }),
    ], { holdRows, holdSignals })
    expect(result.vehicleFacts.VINHELDACTIVE0001).toMatchObject({ holdActive: true, holdState: 'primary' })
    expect(result.vehicleFacts.VINHELDACTIVE0001).not.toHaveProperty('holdPastExpected')
    expect(result.vehicleFacts.VINHELDPAST000001).toMatchObject({ holdActive: true, holdPastExpected: true })
    expect(result.vehicleFacts.VINHELDZERO000001).not.toHaveProperty('holdActive')
    expect(result.vehicleFacts.VINHELDZERO000001).toMatchObject({ holdState: 'none_observed' })
    expect(store(result, 'Howell')).toMatchObject({ holds: 2, holdsPastExpected: 1 })
    expect(result.exceptions.find((entry) => entry.kind === 'hold_past_expected')).toMatchObject({ store: 'Howell', count: 1, vins: ['VINHELDPAST000001'] })
    expect(JSON.stringify(result)).not.toContain('Primary hold')
  })

  it('excludes a past-expected hold row whose VIN is not in the caller-supplied vehicles', () => {
    const holdRows = [
      { vin: 'VINHELDPAST000001', crm_store_id: 'Howell', active_hold_count: 1, expected_date: '2026-08-29' },
      // No vehicle record for this VIN: the projection cannot show it, so it must not add to the exception.
      { vin: 'VINHELDNOVEHICLE1', crm_store_id: 'Howell', active_hold_count: 1, expected_date: '2026-08-29' },
    ]
    const result = build([
      vehicle('VINHELDPAST000001', { hold: { state: 'primary', label: 'Primary hold' } }),
    ], { holdRows })
    const exception = result.exceptions.find((entry) => entry.kind === 'hold_past_expected')
    expect(exception).toMatchObject({ store: 'Howell', count: 1, vins: ['VINHELDPAST000001'] })
    expect(exception.vins).not.toContain('VINHELDNOVEHICLE1')
  })

  it('derives arrival from the intake record or the listing date, and waiting days from it', () => {
    const intake = new Map([
      ['VINARRIVALINTAKE1', { first_arrival_date: '2026-08-18' }],
      ['VINARRIVALLATE001', { first_arrival_date: '2026-08-25' }],
    ])
    const view = facts([
      vehicle('VINARRIVALINTAKE1', { inventoryDate: '2026-08-20' }),
      vehicle('VINARRIVALLATE001', { inventoryDate: '2026-08-20' }),
      vehicle('VINARRIVALNONE001', { inventoryDate: undefined }),
    ], { serviceIntakeByVin: intake })
    expect(view.VINARRIVALINTAKE1.service).toMatchObject({ arrivalBasis: 'intake', arrivalDate: '2026-08-18', waitingDays: 12 })
    expect(view.VINARRIVALLATE001.service).toMatchObject({ arrivalBasis: 'listing_date', arrivalDate: '2026-08-20', waitingDays: 10 })
    expect(view.VINARRIVALNONE001.service).toEqual({ status: 'needs_service', basis: 'unconfirmed', store: 'Howell', arrivalBasis: 'unknown' })
  })

  it('gates service dates on status: a manager Waiting row never borrows inspection dates', () => {
    const evidence = { source: 'ford_service_history', inspectionDate: '2026-08-26', inServiceDate: '2026-08-25', readyDate: '2026-08-26', types: ['Certified Blue Oval Inspection'] }
    const rows = new Map([
      ['VINMANAGERWAIT001', { status: 'needs_service', service_entered_at: null, completed_at: null, updated_at: '2026-08-28T15:00:00.000Z' }],
      ['VINMANAGERDONE001', { status: 'serviced', service_entered_at: '2026-08-22', completed_at: '2026-08-27', updated_at: '2026-08-27T15:00:00.000Z' }],
    ])
    const view = facts([
      vehicle('VINMANAGERWAIT001', { serviceReadiness: { status: 'needs_service', readinessBasis: 'manager_updated', store: 'Howell', readinessEvidence: evidence, serviceEnteredAt: '2026-08-25', completedAt: '2026-08-26' } }),
      // manager_updated uses the row's dates only, never the evidence dates.
      vehicle('VINMANAGERDONE001', { serviceReadiness: { status: 'serviced', readinessBasis: 'manager_updated', store: 'Howell', readinessEvidence: evidence } }),
      vehicle('VINEVIDENCEDONE01', { serviceReadiness: { status: 'serviced', readinessBasis: 'ford_service_history_inspection', store: 'Howell', readinessEvidence: evidence } }),
      vehicle('VINAUTOCHECKDONE1', { make: 'Toyota', serviceReadiness: { status: 'serviced', readinessBasis: 'autocheck_post_intake_inspection', store: 'Howell', readinessEvidence: { source: 'autocheck', inspectionDate: '2026-08-24', types: ['Vehicle Inspected'] } } }),
      // A legacy review row carries no dates at all.
      vehicle('VINLEGACYREVIEW01', { serviceReadiness: { status: 'serviced', readinessBasis: 'legacy_review', store: 'Howell', serviceEnteredAt: '2026-08-21', completedAt: '2026-08-22' } }),
    ], { serviceRowByVin: rows })
    expect(view.VINMANAGERWAIT001.service).toEqual({
      status: 'needs_service', basis: 'manager_updated', store: 'Howell', arrivalBasis: 'listing_date', arrivalDate: '2026-08-20',
      waitingDays: 10, sinceServiceUpdateDays: 2,
    })
    expect(view.VINMANAGERDONE001.service).toMatchObject({ receiptToStartDays: 2, inServiceDays: 5, receiptToReadyDays: 7, sinceServiceUpdateDays: 3 })
    expect(view.VINEVIDENCEDONE01.service).toMatchObject({ receiptToStartDays: 5, inServiceDays: 1, receiptToReadyDays: 6 })
    expect(view.VINEVIDENCEDONE01.service).not.toHaveProperty('sinceServiceUpdateDays')
    expect(view.VINAUTOCHECKDONE1.service).toMatchObject({ receiptToReadyDays: 4 })
    expect(view.VINAUTOCHECKDONE1.service).not.toHaveProperty('receiptToStartDays')
    expect(view.VINAUTOCHECKDONE1.service).not.toHaveProperty('inServiceDays')
    for (const key of ['receiptToStartDays', 'inServiceDays', 'receiptToReadyDays', 'waitingDays']) {
      expect(view.VINLEGACYREVIEW01.service).not.toHaveProperty(key)
    }
  })

  it('counts time in service to the as-of day while in service', () => {
    const view = facts(
      [vehicle('VININSERVICE00001', { serviceReadiness: { status: 'in_service', readinessBasis: 'manager_updated', store: 'Howell' } })],
      { serviceRowByVin: new Map([['VININSERVICE00001', { status: 'in_service', service_entered_at: '2026-08-26', completed_at: null, updated_at: '2026-08-26T13:00:00.000Z' }]]) },
    )
    expect(view.VININSERVICE00001.service).toMatchObject({ status: 'in_service', receiptToStartDays: 6, inServiceDays: 4 })
    expect(view.VININSERVICE00001.service).not.toHaveProperty('waitingDays')
    expect(view.VININSERVICE00001.service).not.toHaveProperty('receiptToReadyDays')
  })

  it('flags a reversed date pair instead of reading it as zero days', () => {
    const result = build(
      [vehicle('VINDATEORDER00001', { serviceReadiness: { status: 'serviced', readinessBasis: 'manager_updated', store: 'Howell' } })],
      { serviceRowByVin: new Map([['VINDATEORDER00001', { status: 'serviced', service_entered_at: '2026-08-15', completed_at: '2026-08-12', updated_at: '2026-08-15T13:00:00.000Z' }]]) },
    )
    const service = result.vehicleFacts.VINDATEORDER00001.service
    expect(service.dateOrderIssue).toBe(true)
    for (const key of ['receiptToStartDays', 'inServiceDays', 'receiptToReadyDays']) expect(service).not.toHaveProperty(key)
    expect(result.exceptions.find((entry) => entry.kind === 'service_date_order')).toMatchObject({ store: 'Howell', count: 1, vins: ['VINDATEORDER00001'] })
  })

  it('reports medians with n for odd and even samples, skipping missing values, per store and group', () => {
    const serviced = (vin, enteredAt, completedAt, store = 'Howell') => [
      vehicle(vin, { homeStore: store, serviceReadiness: { status: 'serviced', readinessBasis: 'manager_updated', store } }),
      [vin, { status: 'serviced', service_entered_at: enteredAt, completed_at: completedAt, updated_at: `${completedAt}T15:00:00.000Z` }],
    ]
    const entries = [
      serviced('VINMEDIANHOWELL01', '2026-08-21', '2026-08-22'),
      serviced('VINMEDIANHOWELL02', '2026-08-22', '2026-08-25'),
      serviced('VINMEDIANHOWELL03', '2026-08-26', '2026-08-28'),
      serviced('VINMEDIANLINCOLN1', '2026-08-21', '2026-08-23', 'Lincoln'),
      serviced('VINMEDIANLINCOLN2', '2026-08-22', '2026-08-26', 'Lincoln'),
    ]
    const result = build([
      ...entries.map(([row]) => row),
      // No dates: counted as Ready, absent from every median.
      vehicle('VINMEDIANNODATE01', { serviceReadiness: { status: 'serviced', readinessBasis: 'legacy_review', store: 'Howell' } }),
    ], { serviceRowByVin: new Map(entries.map(([, row]) => row)) })
    const howell = result.service.perStore.find((entry) => entry.store === 'Howell')
    const lincoln = result.service.perStore.find((entry) => entry.store === 'Lincoln')
    expect(howell.counts).toEqual({ waitingForService: 0, inService: 0, ready: 4 })
    expect(howell.medians).toEqual({
      receiptToStartDays: { value: 2, n: 3 }, inServiceDays: { value: null, n: 0 }, receiptToReadyDays: { value: 5, n: 3 },
    })
    expect(lincoln.medians.receiptToStartDays).toEqual({ value: 1.5, n: 2 })
    expect(lincoln.medians.receiptToReadyDays).toEqual({ value: 4.5, n: 2 })
    expect(result.service.group.medians.receiptToStartDays).toEqual({ value: 2, n: 5 })
    expect(howell.basis).toMatchObject({ manager_updated: 3, legacy_review: 1 })
    expect(store(result, 'Howell').ready).toBe(4)
  })

  it('lists aged waiting vehicles longest first with the 14 and 30 day counts', () => {
    const result = build([
      vehicle('VINWAITING0000013', { inventoryDate: '2026-08-17' }),
      vehicle('VINWAITING0000014', { inventoryDate: '2026-08-16' }),
      vehicle('VINWAITING0000030', { homeStore: 'Lincoln', serviceReadiness: { status: 'needs_service', readinessBasis: 'new_arrival', store: 'Lincoln' } }),
    ], { serviceIntakeByVin: new Map([['VINWAITING0000030', { first_arrival_date: '2026-07-31' }]]) })
    expect(result.service.agedWaiting).toEqual([
      { vin: 'VINWAITING0000030', store: 'Lincoln', waitingDays: 30, arrivalBasis: 'intake' },
      { vin: 'VINWAITING0000014', store: 'Howell', waitingDays: 14, arrivalBasis: 'listing_date' },
    ])
    expect(result.service.group).toMatchObject({ agedWaiting14: 2, agedWaiting30: 1, arrivalBasis: { intake: 1, listing_date: 2, unknown: 0 } })
    expect(result.service.perStore.find((entry) => entry.store === 'Howell')).toMatchObject({ agedWaiting14: 1, agedWaiting30: 0 })
  })

  it('buckets listing age at 60 and 90 for listed vehicles only', () => {
    const result = build([
      vehicle('VINAGED0000000059', { daysListed: 59 }),
      vehicle('VINAGED0000000060', { daysListed: 60 }),
      vehicle('VINAGED0000000089', { daysListed: 89 }),
      vehicle('VINAGED0000000090', { daysListed: 90 }),
      vehicle('VINAGEDSTALE00120', { daysListed: 120, publicListing: 'stale' }),
      vehicle('VINAGEDCRMONLY120', { daysListed: 120, publicListing: 'pre_listing' }),
    ])
    const view = result.vehicleFacts
    expect(view.VINAGED0000000059).not.toHaveProperty('agedBucket')
    expect(view.VINAGED0000000060.agedBucket).toBe(60)
    expect(view.VINAGED0000000089.agedBucket).toBe(60)
    expect(view.VINAGED0000000090.agedBucket).toBe(90)
    expect(view.VINAGEDSTALE00120).not.toHaveProperty('agedBucket')
    expect(view.VINAGEDCRMONLY120).toMatchObject({ agedBasis: 'crm_age' })
    expect(view.VINAGEDCRMONLY120).not.toHaveProperty('agedBucket')
    expect(store(result, 'Howell')).toMatchObject({ aged60: 3, aged90: 1, listed: 4, preListing: 1 })
  })

  it('counts captured records against 5 for Ford and Lincoln and 3 otherwise', () => {
    const complete = {
      autoCheckReport: { dataState: 'current' }, windowSticker: { dataState: 'current' }, fordInvoice: { dataState: 'current' },
      fordOasis: { dataState: 'current', serviceHistory: { historyCaptured: true } },
    }
    const result = build([
      vehicle('VINRECORDSFORD001', complete),
      vehicle('VINRECORDSLINC001', { ...complete, make: 'Lincoln', fordOasis: { dataState: 'stale_unverified', serviceHistory: { historyCaptured: false } } }),
      vehicle('VINRECORDSOTHER01', { ...complete, make: 'Toyota', fordOasis: undefined }),
    ])
    const view = result.vehicleFacts
    expect(view.VINRECORDSFORD001).toMatchObject({ recordsCaptured: 5, recordsApplicable: 5 })
    expect(view.VINRECORDSLINC001).toMatchObject({
      records: { autoCheck: true, oasis: false, sticker: true, invoice: true, fordHistory: false }, recordsCaptured: 3, recordsApplicable: 5,
    })
    expect(view.VINRECORDSOTHER01).toMatchObject({ recordsCaptured: 3, recordsApplicable: 3 })
    expect(store(result, 'Howell').recordsIncomplete).toBe(1)
    expect(result.exceptions.find((entry) => entry.kind === 'records_incomplete')).toMatchObject({ count: 1, vins: ['VINRECORDSLINC001'] })
  })

  it('draws outbound, return and planned flows from visible active moves only', () => {
    const row = (id, vin, extra) => ({ id, vin, home_store_id: 'Howell', destination_store_id: 'Fowlerville', location_confidence: 'verified', ...extra })
    const result = build([], { visibleTransferRows: [
      row('out-1', 'VINFLOWOUTBOUND01', { status: 'arrived', movement_status: 'at_requesting_store', current_location_id: 'Fowlerville' }),
      row('out-2', 'VINFLOWOUTBOUND02', { status: 'picked_up', movement_status: 'picked_up', current_location_id: 'In transit' }),
      row('ret-1', 'VINFLOWRETURN0001', { status: 'return_in_transit', movement_status: 'return_in_transit', current_location_id: 'In transit' }),
      row('plan-1', 'VINFLOWPLANNED001', { status: 'approved', movement_status: 'at_home_store', current_location_id: 'Howell' }),
      row('req-1', 'VINFLOWREQUESTED1', { status: 'requested', movement_status: 'at_home_store', current_location_id: 'Howell' }),
      row('done-1', 'VINFLOWCLOSED0001', { status: 'closed', movement_status: 'returned_home', current_location_id: 'Howell' }),
      row('lost-1', 'VINFLOWCONFLICT01', { status: 'arrived', movement_status: 'at_requesting_store', current_location_id: 'Fowlerville', location_confidence: 'conflicting' }),
    ] })
    expect(result.board.flows).toEqual([
      { from: 'Howell', to: 'Fowlerville', kind: 'outbound', count: 2, vins: ['VINFLOWOUTBOUND01', 'VINFLOWOUTBOUND02'] },
      { from: 'Howell', to: 'Fowlerville', kind: 'planned', count: 1, vins: ['VINFLOWPLANNED001'] },
      { from: 'Fowlerville', to: 'Howell', kind: 'return', count: 1, vins: ['VINFLOWRETURN0001'] },
    ])
  })

  it('lists exceptions by kind and store, capping VINs at 50, and counts identity review only', () => {
    const vehicles = Array.from({ length: 55 }, (_, index) => vehicle(`VINEXCEPTION${String(index).padStart(5, '0')}`, {
      sourceReportedLocation: 'Fowlerville', publicStore: 'Fowlerville', crmStore: 'Fowlerville',
    }))
    const result = build(vehicles, {
      managerIdentityReviews: [{ sourceStore: 'Lincoln', vin: null }, { sourceStore: 'Lincoln', vin: 'VINIGNOREDFORREVW' }, { sourceStore: 'Not a store' }],
    })
    const noRecord = result.exceptions.find((entry) => entry.kind === 'no_app_record')
    expect(noRecord).toMatchObject({ store: 'Howell', count: 55 })
    expect(noRecord.vins).toHaveLength(50)
    expect(result.exceptions.find((entry) => entry.kind === 'identity_review')).toEqual({ kind: 'identity_review', store: 'Lincoln', count: 2, vins: [] })
    expect(result.exceptions.map((entry) => entry.kind)).toEqual(['no_app_record', 'identity_review', 'records_incomplete'])
    expect(store(result, 'Howell').unaccounted).toBe(55)
    expect(store(result, 'Fowlerville').visiting).toBe(55)
  })

  it('carries no free text: only codes, days, counts, stores and VINs', () => {
    const result = build([vehicle('VINFREETEXT000001', {
      vehicleName: 'ZQ free text name', dealerComments: 'ZQ free text comment',
      hold: { state: 'primary', label: 'ZQ free text label', primarySalesperson: 'ZQ salesperson' },
      movement: ledger({ currentLocation: 'Fowlerville', label: 'ZQ movement label', nextAction: 'ZQ next action', currentCustodian: 'ZQ custodian' }),
      serviceReadiness: { status: 'needs_service', readinessBasis: 'manager_updated', store: 'Howell', notes: 'ZQ service note', updatedBy: 'ZQ manager' },
    })], { serviceRowByVin: new Map([['VINFREETEXT000001', { status: 'needs_service', notes: 'ZQ row note', actor: 'ZQ actor', updated_at: '2026-08-29T12:00:00.000Z' }]]) })
    expect(JSON.stringify(result)).not.toContain('ZQ')
  })
})

describe('overview projection through bootstrap()', () => {
  const databases = []
  afterEach(() => { while (databases.length) databases.pop().close() })

  const groupManager = { role: 'group_manager', store: 'Howell', user: 'Synthetic group manager', userId: 'gm-1' }
  const fowlervilleManager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic Fowlerville manager', userId: 'm-f' }
  const lincolnManager = { role: 'manager', store: 'Lincoln', user: 'Synthetic Lincoln manager', userId: 'm-l' }
  const howellManager = { role: 'manager', store: 'Howell', user: 'Synthetic Howell manager', userId: 'm-h' }
  const detroitManager = { role: 'manager', store: 'Ford Detroit', user: 'Synthetic Detroit manager', userId: 'm-d' }
  const fowlervilleSales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic Fowlerville salesperson', userId: 's-f' }

  function harness(release = buildSyntheticRelease()) {
    const database = openInventoryDatabase()
    databases.push(database)
    importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
    let clock = new Date(SYNTHETIC_NOW)
    const service = createInventoryService({ database, now: () => clock })
    return { database, service, setClock: (value) => { clock = new Date(value) } }
  }

  function directMove(service, { vin, from, to, movedAt, returnDueAt, context, key }) {
    return service.createTransfer({
      vin, intent: 'direct', requestingStore: from, destinationStore: to, requestedBy: context.user,
      movedAt, returnRequired: true, returnDueAt, reason: 'Synthetic overview move', priority: 'normal',
    }, context, key).record
  }

  it('attaches the projection for managers and sales only, and never when disabled', () => {
    const { service } = harness()
    expect(service.bootstrap(groupManager).overview).toMatchObject({ role: 'group_manager', access: 'full' })
    expect(service.bootstrap(howellManager).overview).toMatchObject({ role: 'manager', access: 'full', scopeStore: 'Howell' })
    expect(service.bootstrap(fowlervilleSales).overview).toMatchObject({ role: 'sales', access: 'read_only', scopeStore: 'Fowlerville' })
    for (const role of ['coordinator', 'porter', 'driver']) {
      expect(service.bootstrap({ role, store: 'Howell', user: `Synthetic ${role}` })).not.toHaveProperty('overview')
    }
    for (const context of [groupManager, howellManager, fowlervilleSales]) {
      expect(service.bootstrap(context, { overview: false })).not.toHaveProperty('overview')
    }
    const summary = service.bootstrap(groupManager).overview
    expect(Object.keys(summary.vehicleFacts).sort()).toEqual(service.bootstrap(groupManager).vehicles.map((vehicle) => vehicle.vin).sort())
  })

  it('matches the bootstrap stores summary and hold signals it sits beside', () => {
    const { service, setClock } = harness()
    directMove(service, { vin: 'TESTDATAFWELL0002', from: 'Fowlerville', to: 'Ford Detroit', movedAt: new Date(SYNTHETIC_NOW.getTime() - 9 * DAY).toISOString(), returnDueAt: new Date(SYNTHETIC_NOW.getTime() - 2 * DAY).toISOString(), context: fowlervilleManager, key: 'overview-away' })
    setClock(SYNTHETIC_NOW)
    for (const context of [groupManager, fowlervilleManager, howellManager, fowlervilleSales]) {
      const data = service.bootstrap(context)
      for (const entry of data.stores) {
        const counts = data.overview.stores.find((row) => row.store === entry.store)
        expect(counts.returnOverdue, `${context.role}@${context.store} ${entry.store}`).toBe(entry.returnOverdue)
      }
      for (const signal of data.holdSignals) {
        expect(data.overview.stores.find((row) => row.store === signal.store)).toMatchObject({ holds: signal.activeHoldVins, holdsPastExpected: signal.pastExpected })
      }
    }
  })

  it('follows a direct move away: days away, overdue return, stale confirmation, visiting and the outbound arrow', () => {
    const { service } = harness()
    const move = directMove(service, { vin: 'TESTDATAFWELL0002', from: 'Fowlerville', to: 'Ford Detroit', movedAt: new Date(SYNTHETIC_NOW.getTime() - 9 * DAY).toISOString(), returnDueAt: new Date(SYNTHETIC_NOW.getTime() - 2 * DAY).toISOString(), context: fowlervilleManager, key: 'overview-direct' })
    const summary = service.bootstrap(fowlervilleManager).overview
    expect(summary.vehicleFacts.TESTDATAFWELL0002).toMatchObject({
      custody: 'away', custodyBasis: 'ledger', currentStore: 'Ford Detroit', daysAway: 9,
      returnOverdue: true, unaccounted: { reason: 'stale_confirmation', days: 9 },
    })
    expect(store(summary, 'Fowlerville')).toMatchObject({ away: 1, returnOverdue: 1, unaccounted: 1 })
    expect(store(summary, 'Ford Detroit').visiting).toBe(1)
    expect(summary.board.flows).toEqual([{ from: 'Fowlerville', to: 'Ford Detroit', kind: 'outbound', count: 1, vins: ['TESTDATAFWELL0002'] }])
    expect(summary.exceptions.find((entry) => entry.kind === 'return_overdue')).toEqual({
      kind: 'return_overdue', store: 'Fowlerville', count: 1, vins: ['TESTDATAFWELL0002'], transferIds: [move.id],
    })
    // Sales at another store still locate the vehicle, without the move's return date.
    const lincolnSales = service.bootstrap({ role: 'sales', store: 'Lincoln', user: 'Synthetic Lincoln salesperson' }).overview
    expect(lincolnSales.vehicleFacts.TESTDATAFWELL0002).toMatchObject({ custody: 'away', daysAway: 9 })
    expect(lincolnSales.vehicleFacts.TESTDATAFWELL0002).not.toHaveProperty('returnOverdue')
    expect(lincolnSales.board.flows).toEqual([])

    // A sold-pending vehicle's return clock is paused.
    service.appendTransferEvent(move.id, { type: 'sale_confirmed' }, detroitManager, 'overview-sale')
    const paused = service.bootstrap(fowlervilleManager).overview
    expect(paused.vehicleFacts.TESTDATAFWELL0002).not.toHaveProperty('returnOverdue')
    expect(store(paused, 'Fowlerville').returnOverdue).toBe(0)
  })

  it('shows a request as on the lot until it leaves, then a planned arrow once approved', () => {
    const { service } = harness()
    const request = service.createTransfer({
      vin: 'TESTDATAHWELL0002', requestingStore: 'Fowlerville', requestedBy: fowlervilleSales.user,
      neededBy: '2026-08-31T19:00:00Z', returnDueAt: '2026-09-01T19:00:00Z', reason: 'Synthetic showing', priority: 'normal', returnRequired: true,
    }, fowlervilleSales, 'overview-request').record
    const requested = service.bootstrap(howellManager).overview
    expect(requested.vehicleFacts.TESTDATAHWELL0002).toMatchObject({ custody: 'on_lot', custodyBasis: 'ledger' })
    expect(requested.vehicleFacts.TESTDATAHWELL0002).not.toHaveProperty('daysAway')
    expect(requested.board.flows).toEqual([])
    service.appendTransferEvent(request.id, { type: 'request_approved', availabilityConfirmed: true }, fowlervilleManager, 'overview-approve')
    const approved = service.bootstrap(howellManager).overview
    expect(approved.vehicleFacts.TESTDATAHWELL0002).toMatchObject({ custody: 'on_lot' })
    expect(approved.board.flows).toEqual([{ from: 'Howell', to: 'Fowlerville', kind: 'planned', count: 1, vins: ['TESTDATAHWELL0002'] }])
  })

  it('tracks the return leg and resets the departure clock on receipt home', () => {
    const { service, setClock } = harness()
    const move = directMove(service, { vin: 'TESTDATALNCN00001', from: 'Lincoln', to: 'Howell', movedAt: new Date(SYNTHETIC_NOW.getTime() - 3 * DAY).toISOString(), returnDueAt: new Date(SYNTHETIC_NOW.getTime() + 2 * DAY).toISOString(), context: lincolnManager, key: 'overview-return' })
    setClock(SYNTHETIC_NOW.getTime() - DAY)
    service.appendTransferEvent(move.id, { type: 'return_started' }, howellManager, 'overview-return-started')
    setClock(SYNTHETIC_NOW)
    const returning = service.bootstrap(lincolnManager).overview
    expect(returning.vehicleFacts.TESTDATALNCN00001).toMatchObject({ custody: 'in_transit', returnLeg: 'return', daysAway: 3 })
    expect(returning.board.flows).toEqual([{ from: 'Howell', to: 'Lincoln', kind: 'return', count: 1, vins: ['TESTDATALNCN00001'] }])
    expect(store(returning, 'Lincoln').inTransit).toBe(1)

    service.appendTransferEvent(move.id, { type: 'returned_home', toLocation: 'Lincoln' }, lincolnManager, 'overview-received')
    const home = service.bootstrap(lincolnManager).overview
    expect(home.vehicleFacts.TESTDATALNCN00001).toMatchObject({ custody: 'on_lot', custodyBasis: 'ledger', receivedHomeAt: '2026-08-30' })
    for (const key of ['daysAway', 'returnLeg', 'unaccounted', 'departedAt']) expect(home.vehicleFacts.TESTDATALNCN00001).not.toHaveProperty(key)
    expect(home.board.flows).toEqual([])

    setClock(SYNTHETIC_NOW.getTime() + 8 * DAY)
    expect(service.bootstrap(lincolnManager).overview.vehicleFacts.TESTDATALNCN00001).not.toHaveProperty('receivedHomeAt')
  })

  it('dates evidence-based Ready from the inspection and drops those dates behind a manager Waiting row', () => {
    const release = buildSyntheticRelease({ includeDemoChanges: true })
    const target = release.vehicles.find((row) => row.vin === 'TESTDATAFWELL0002')
    const order = target.resourceRecord.fordOasis.serviceHistory.recentRepairOrders[0]
    order.inspection = { status: 'confirmed', type: 'Certified Blue Oval Inspection' }
    const { service } = harness(release)
    const evidence = service.bootstrap(fowlervilleManager).overview
    expect(evidence.vehicleFacts.TESTDATAFWELL0002.service).toMatchObject({
      status: 'serviced', basis: 'ford_service_history_inspection', store: 'Fowlerville', receiptToStartDays: 60, inServiceDays: 1, receiptToReadyDays: 61,
    })
    expect(evidence.service.group.basis.ford_service_history_inspection).toBeGreaterThanOrEqual(1)

    service.updateServiceReadiness('TESTDATAFWELL0002', { status: 'needs_service', expectedVersion: 0 }, fowlervilleManager, 'overview-reopen')
    const reopened = service.bootstrap(fowlervilleManager).overview.vehicleFacts.TESTDATAFWELL0002.service
    expect(reopened).toMatchObject({ status: 'needs_service', basis: 'manager_updated', waitingDays: 65, sinceServiceUpdateDays: 0 })
    for (const key of ['receiptToStartDays', 'inServiceDays', 'receiptToReadyDays']) expect(reopened).not.toHaveProperty(key)
  })

  it('uses the verified intake date when it precedes the listing date', () => {
    const release = buildSyntheticRelease()
    const target = release.vehicles.find((row) => row.vin === 'TESTDATADETRT0001')
    release.publicChangeEvents = [{ type: 'new_arrival', vin: target.vin, reportDate: '2026-07-01' }]
    target.publicRecord.inventory_date = '2026-08-10'
    const { service } = harness(release)
    expect(service.bootstrap(detroitManager).overview.vehicleFacts.TESTDATADETRT0001.service).toMatchObject({
      arrivalBasis: 'intake', arrivalDate: '2026-07-01', waitingDays: 60,
    })
  })

  it('keeps the bootstrap byte-identical within a day and changes the as-of day across midnight', () => {
    const { service, setClock } = harness()
    directMove(service, { vin: 'TESTDATAFWELL0002', from: 'Fowlerville', to: 'Ford Detroit', movedAt: new Date(SYNTHETIC_NOW.getTime() - 9 * DAY).toISOString(), returnDueAt: new Date(SYNTHETIC_NOW.getTime() + 5 * DAY).toISOString(), context: fowlervilleManager, key: 'overview-etag' })
    for (const context of [groupManager, fowlervilleManager, fowlervilleSales]) {
      setClock(SYNTHETIC_NOW)
      const first = JSON.stringify(service.bootstrap(context))
      setClock(SYNTHETIC_NOW.getTime() + 5 * 60_000)
      expect(JSON.stringify(service.bootstrap(context)), `${context.role} five minutes later`).toBe(first)
    }
    setClock('2026-08-30T23:59:00-04:00')
    const before = service.bootstrap(fowlervilleManager).overview
    setClock('2026-08-31T00:01:00-04:00')
    const after = service.bootstrap(fowlervilleManager).overview
    expect(before.asOfDay).toBe('2026-08-30')
    expect(after.asOfDay).toBe('2026-08-31')
    expect(after.vehicleFacts.TESTDATAFWELL0002.daysAway).toBe(before.vehicleFacts.TESTDATAFWELL0002.daysAway + 1)
  })

  it('counts app dispositions under the owner store for every viewer, beside (never from) the manager log', () => {
    const { service } = harness()
    service.updateDisposition('TESTDATAFWELL0002', { disposition: 'sold_pending', effectiveDate: '2026-08-29', expectedVersion: 0 }, fowlervilleManager, 'overview-disposition-sold')
    service.updateDisposition('TESTDATADETRT0002', { disposition: 'wholesale', effectiveDate: '2026-08-28', expectedVersion: 0 }, groupManager, 'overview-disposition-wholesale')
    for (const context of [groupManager, howellManager, fowlervilleSales]) {
      const summary = service.bootstrap(context).overview
      expect(store(summary, 'Fowlerville').dispositions, `${context.role}@${context.store}`).toMatchObject({ sold_pending: 1, wholesale: 0 })
      expect(store(summary, 'Ford Detroit').dispositions).toMatchObject({ wholesale: 1 })
      expect(summary.group.dispositions).toMatchObject({ sold_pending: 1, wholesale: 1, keep: 0, delivered: 0, transfer_out: 0 })
      expect(summary.group.dispositions.none).toBe(Object.keys(summary.vehicleFacts).length - 2)
      expect(summary.vehicleFacts.TESTDATAFWELL0002.disposition).toBe('sold_pending')
      expect(summary.vehicleFacts.TESTDATAHWELL0002).not.toHaveProperty('disposition')
    }
  })

  it('prompts on a delivered disposition still listed after 3 days, and never hides the vehicle', () => {
    const { service } = harness()
    service.updateDisposition('TESTDATAFWELL0002', { disposition: 'delivered', effectiveDate: '2026-08-28', expectedVersion: 0 }, fowlervilleManager, 'overview-delivered-2')
    const twoDays = service.bootstrap(groupManager)
    expect(twoDays.vehicles.map((vehicle) => vehicle.vin)).toContain('TESTDATAFWELL0002')
    expect(twoDays.overview.exceptions.map((entry) => entry.kind)).not.toContain('listed_but_delivered')
    service.updateDisposition('TESTDATAFWELL0001', { disposition: 'delivered', effectiveDate: '2026-08-27', expectedVersion: 0 }, fowlervilleManager, 'overview-delivered-3')
    const threeDays = service.bootstrap(groupManager)
    expect(threeDays.vehicles.map((vehicle) => vehicle.vin)).toEqual(expect.arrayContaining(['TESTDATAFWELL0001', 'TESTDATAFWELL0002']))
    expect(threeDays.overview.exceptions.find((entry) => entry.kind === 'listed_but_delivered'))
      .toEqual({ kind: 'listed_but_delivered', store: 'Fowlerville', count: 1, vins: ['TESTDATAFWELL0001'] })
  })

  it('prompts managers, not sales, when a move records delivery with no delivered disposition, and never writes one', () => {
    const { service, database } = harness()
    const move = directMove(service, { vin: 'TESTDATAFWELL0002', from: 'Fowlerville', to: 'Ford Detroit', movedAt: new Date(SYNTHETIC_NOW.getTime() - 2 * DAY).toISOString(), returnDueAt: new Date(SYNTHETIC_NOW.getTime() + 2 * DAY).toISOString(), context: fowlervilleManager, key: 'overview-delivered-move' })
    service.appendTransferEvent(move.id, { type: 'sale_confirmed' }, detroitManager, 'overview-delivered-sale')
    service.appendTransferEvent(move.id, { type: 'delivery_confirmed' }, detroitManager, 'overview-delivered-delivery')
    // The move events are evidence only: no disposition row exists.
    expect(database.prepare('SELECT COUNT(*) AS n FROM vehicle_disposition_events').get().n).toBe(0)
    const prompt = { kind: 'delivered_move_no_disposition', store: 'Fowlerville', count: 1, vins: ['TESTDATAFWELL0002'], transferIds: [move.id] }
    expect(service.bootstrap(groupManager).overview.exceptions).toContainEqual(prompt)
    expect(service.bootstrap(fowlervilleManager).overview.exceptions).toContainEqual(prompt)
    expect(service.bootstrap(fowlervilleSales).overview.exceptions.map((entry) => entry.kind)).not.toContain('delivered_move_no_disposition')
    expect(service.bootstrap(groupManager).overview.vehicleFacts.TESTDATAFWELL0002).not.toHaveProperty('disposition')

    service.updateDisposition('TESTDATAFWELL0002', { disposition: 'delivered', effectiveDate: '2026-08-30', expectedVersion: 0 }, fowlervilleManager, 'overview-delivered-recorded')
    expect(service.bootstrap(groupManager).overview.exceptions.map((entry) => entry.kind)).not.toContain('delivered_move_no_disposition')
  })

  it('stays a small fixed part plus a bounded per-vehicle fact', () => {
    const { service } = harness()
    const data = service.bootstrap(groupManager)
    const { vehicleFacts, ...fixed } = data.overview
    expect(JSON.stringify(fixed).length).toBeLessThan(6_000)
    for (const [vin, value] of Object.entries(vehicleFacts)) expect(JSON.stringify(value).length, vin).toBeLessThan(500)
  })
})
