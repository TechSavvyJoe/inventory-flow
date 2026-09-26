import { describe, expect, it } from 'vitest'
import type { BootstrapData, StoreName, VehicleRecord } from '../../types'
import {
  buildOverviewModel,
  buildOverviewVehicleFact,
  overviewMedian,
  overviewRecordCoverage,
} from './overview-model'

const meta: BootstrapData['meta'] = {
  reportDate: '2026-09-25',
  completedAt: '2026-09-25T13:00:00-04:00',
  timezone: 'America/Detroit',
  publicFreshness: 'current',
  dealerMailFreshness: 'current',
  publicCount: 4,
  crmCount: 4,
  heldVinCount: 0,
  publicChangeCounts: { newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 },
  holdChangeStatus: 'current',
  warnings: [],
}

function vehicle(vin: string, overrides: Partial<VehicleRecord> = {}): VehicleRecord {
  const home = overrides.homeStore ?? 'Howell'
  return {
    vin,
    stockNumber: `SYN-${vin.at(-1)}`,
    make: 'Ford',
    model: 'F-150',
    vehicleName: '2026 Ford F-150 Synthetic',
    publicStore: home,
    homeStore: home,
    homeStoreConfirmed: true,
    sourceReportedLocation: home,
    websiteStatus: 'Listed',
    publicListing: 'listed',
    publicListingState: 'Listed publicly; availability not confirmed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', label: 'No current DealerMail hold found', backupCount: 0 },
    movement: { state: 'source_reported', label: 'Source-reported location', currentLocation: home, locationConfidence: 'reported' },
    ...overrides,
  }
}

function data(vehicles: VehicleRecord[]): BootstrapData {
  return {
    meta,
    vehicles,
    transfers: [],
    attention: [],
    stores: (['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'] as StoreName[]).map(store => ({ store, publicUnits: 0, currentHolds: 0, awayFromHome: 0, visiting: 0, returnOverdue: 0, locationExceptions: 0 })),
  }
}

describe('overview model', () => {
  it('separates source-reported location from verified custody and starts time away only on departure evidence', () => {
    const sourceReported = buildOverviewVehicleFact(vehicle('TESTDATA000000001'), { meta })
    expect(sourceReported).toMatchObject({ onLot: true, away: false, awayDays: null, locationBasis: 'source_reported' })

    const departed = buildOverviewVehicleFact(vehicle('TESTDATA000000002', {
      movement: { state: 'at_requesting_store', label: 'At requesting store', currentLocation: 'Lincoln', locationConfidence: 'verified', departedAt: '2026-09-20T18:00:00Z' },
    }), { meta })
    expect(departed).toMatchObject({ onLot: false, away: true, awayDays: 5, currentStore: 'Lincoln', locationBasis: 'move_ledger' })

    const approvedOnly = buildOverviewVehicleFact(vehicle('TESTDATA000000003', {
      movement: { state: 'request_approved', label: 'Approved', currentLocation: 'Howell', locationConfidence: 'reported' },
    }), { meta })
    expect(approvedOnly).toMatchObject({ away: false, awayDays: null })

    const conflict = buildOverviewVehicleFact(vehicle('TESTDATA000000004', {
      movement: { state: 'location_exception', label: 'Location needs checking', currentLocation: 'Unknown', locationConfidence: 'conflicting' },
    }), { meta })
    expect(conflict).toMatchObject({ onLot: false, away: false, locationNeedsReview: true, locationBasis: 'conflict' })
  })

  it('uses explicit service dates for duration and labels listing age only as a waiting-unit fallback', () => {
    const inService = buildOverviewVehicleFact(vehicle('TESTDATA000000001', {
      serviceReadiness: { vin: 'TESTDATA000000001', status: 'in_service', version: 1, serviceEnteredAt: '2026-09-21', completedAt: null, updatedAt: '2026-09-21T12:00:00Z', updatedBy: 'Synthetic manager', updatedByRole: 'manager', updatedAtStore: 'Howell', store: 'Howell', canManage: true },
    }), { meta })
    expect(inService).toMatchObject({ serviceStatus: 'in_service', serviceDays: 4, waitingListingDays: null })

    const ready = buildOverviewVehicleFact(vehicle('TESTDATA000000002', {
      serviceReadiness: { vin: 'TESTDATA000000002', status: 'serviced', version: 1, serviceEnteredAt: '2026-09-18', completedAt: '2026-09-20', updatedAt: '2026-09-20T12:00:00Z', updatedBy: 'Synthetic manager', updatedByRole: 'manager', updatedAtStore: 'Howell', store: 'Howell', canManage: true },
    }), { meta })
    expect(ready).toMatchObject({ serviceStatus: 'serviced', serviceDays: 2, waitingListingDays: null })

    const waiting = buildOverviewVehicleFact(vehicle('TESTDATA000000003', { daysListed: 31 }), { meta })
    expect(waiting).toMatchObject({ serviceStatus: 'needs_service', serviceDays: null, waitingListingDays: 31 })
  })

  it('counts only current captured records and applies Ford-family sources separately', () => {
    const ford = vehicle('TESTDATA000000001', {
      autoCheckReport: { dataState: 'current' },
      windowSticker: { dataState: 'current' },
      factoryEquipment: { dataState: 'current', isOriginalWindowSticker: false },
      fordInvoice: { dataState: 'current', available: true, capturedAt: '2026-09-25', sourceLabel: 'Synthetic' },
      fordOasis: { dataState: 'current', serviceHistory: { dataState: 'current', checkedAt: '2026-09-25', historyCaptured: true, repairOrderCount: 1, detailScanCount: 1, inspectionSearchStatus: 'confirmed' } },
    })
    expect(overviewRecordCoverage(ford)).toEqual({ captured: 6, applicable: 6, missing: [] })

    const nonFord = vehicle('TESTDATA000000002', { make: 'Chevrolet', autoCheckReport: { dataState: 'stale_unverified' } })
    expect(overviewRecordCoverage(nonFord)).toEqual({ captured: 0, applicable: 3, missing: ['AutoCheck', 'Window sticker', 'Factory equipment'] })
  })

  it('builds store populations without treating holds, listings, or manager logs as location or availability', () => {
    const homeHeld = vehicle('TESTDATA000000001', {
      hold: { state: 'stale', label: 'Last verified hold', backupCount: 0, lastKnownActiveHold: true, expectedDate: '2026-09-22' },
      managerDisposition: { stockNumber: 'SYN-1', vin: 'TESTDATA000000001', vehicleName: 'Synthetic', soldManagerLog: true, deliveredManagerLog: false, deliveryDate: null, confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin', matchStatus: 'matched', physicalStore: null, reviewRequired: false, soldLabel: 'Sold — manager log', deliveryLabel: 'Not marked delivered — manager log', dataState: 'current' },
    })
    const away = vehicle('TESTDATA000000002', {
      movement: { state: 'at_requesting_store', label: 'At requesting store', currentLocation: 'Lincoln', locationConfidence: 'verified', departedAt: '2026-09-20T16:00:00Z', returnDueAt: '2026-09-24' },
    })
    const fixture = data([homeHeld, away])
    fixture.vehicleIssues = [{ id: 'issue-1', vin: homeHeld.vin, stockNumber: homeHeld.stockNumber, vehicleName: homeHeld.vehicleName, homeStore: 'Howell', reportStore: 'Howell', category: 'cleaning', priority: 'normal', description: 'Synthetic issue', status: 'open', version: 1, assignee: null, reportedBy: 'Synthetic sales', reportedByUserId: 'sales-1', reportedAt: '2026-09-25T12:00:00Z', updatedAt: '2026-09-25T12:00:00Z', completedAt: null, completedBy: null, photoCount: 0, allowedActions: [] }]
    fixture.attention = [{ id: 'attention-1', severity: 'warning', type: 'hold', label: 'Review hold', store: 'Howell', status: 'open', priority: 'normal', allowedActions: [], events: [] }]

    const overview = buildOverviewModel(fixture)
    const howell = overview.stores.find(summary => summary.store === 'Howell')!
    const lincoln = overview.stores.find(summary => summary.store === 'Lincoln')!
    expect(howell.populations.inventory).toHaveLength(2)
    expect(howell.populations.holds.map(fact => fact.vehicle.vin)).toEqual([homeHeld.vin])
    expect(howell.populations.away.map(fact => fact.vehicle.vin)).toEqual([away.vin])
    expect(howell.populations.return_overdue.map(fact => fact.vehicle.vin)).toEqual([away.vin])
    expect(howell.populations.manager_log_sold.map(fact => fact.vehicle.vin)).toEqual([homeHeld.vin])
    expect(howell.populations.open_issues.map(fact => fact.vehicle.vin)).toEqual([homeHeld.vin])
    expect(lincoln.populations.visiting.map(fact => fact.vehicle.vin)).toEqual([away.vin])
    expect(howell.attention).toHaveLength(1)
    expect(homeHeld.managerDisposition?.soldManagerLog).toBe(true)
    expect(howell.populations.on_lot.map(fact => fact.vehicle.vin)).toContain(homeHeld.vin)
  })

  it('calculates medians without filling unknown durations with zero', () => {
    expect(overviewMedian([null, 9, 3, 7])).toBe(7)
    expect(overviewMedian([2, 8])).toBe(5)
    expect(overviewMedian([null])).toBeNull()
  })
})
