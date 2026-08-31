// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildPublicChangeEvents,
  summarizePublicChangeEvents,
} from '../../server/public-change-events.mjs'

function vehicle(vin: string, overrides: Record<string, unknown> = {}) {
  return {
    vin,
    stock_number: `S-${vin.slice(-4)}`,
    vehicle_name: '2024 Ford Explorer XLT',
    store: 'Howell',
    listing_url: `https://example.test/${vin}`,
    listed_price: 32000,
    mileage: 12000,
    availability: 'Not provided',
    ...overrides,
  }
}

describe('public inventory change events', () => {
  it('emits arrivals, removals, price/status corrections, and a single store-transfer event', () => {
    const unchangedVin = '1FMEE0RR5RLA48819'
    const changedVin = '1FMSK8KH2PGA07081'
    const transferVin = '1FMUK8DHXTGB76992'
    const removedVin = '2FMPK4J91RBB19499'
    const arrivalVin = '1FMSK8DH8RGA57726'
    const previousSnapshot = {
      report_date: '2026-08-28',
      vehicles: {
        [unchangedVin]: vehicle(unchangedVin),
        [changedVin]: vehicle(changedVin),
        [transferVin]: vehicle(transferVin, { store: 'Fowlerville' }),
        [removedVin]: vehicle(removedVin),
      },
    }
    const currentSnapshot = {
      report_date: '2026-08-29',
      vehicles: {
        [unchangedVin]: vehicle(unchangedVin),
        [changedVin]: vehicle(changedVin, {
          listed_price: 30790,
          availability: 'available',
        }),
        [transferVin]: vehicle(transferVin, { store: 'Howell' }),
        [arrivalVin]: vehicle(arrivalVin),
      },
    }

    const events = buildPublicChangeEvents({ previousSnapshot, currentSnapshot })
    expect(summarizePublicChangeEvents(events)).toEqual({
      new_arrival: 1,
      removed: 1,
      price_change: 1,
      mileage_change: 0,
      website_status_change: 1,
      stock_correction: 0,
      store_transfer: 1,
    })
    expect(events.filter((event) => event.vin === transferVin).map((event) => event.type)).toEqual([
      'store_transfer',
    ])
    expect(events.find((event) => event.type === 'price_change')).toMatchObject({
      vin: changedVin,
      beforeValue: 32000,
      afterValue: 30790,
      currentVehicle: true,
    })
    expect(events.find((event) => event.type === 'removed')).toMatchObject({
      vin: removedVin,
      store: 'Howell',
      currentVehicle: false,
      afterValue: 'Not in current public release',
    })
  })

  it('treats missing numeric sentinels as missing and does not manufacture a change', () => {
    const vin = '1FMEE0RR5RLA48819'
    const events = buildPublicChangeEvents({
      previousSnapshot: {
        report_date: '2026-08-28',
        vehicles: { [vin]: vehicle(vin, { listed_price: null, mileage: '' }) },
      },
      currentSnapshot: {
        report_date: '2026-08-29',
        vehicles: { [vin]: vehicle(vin, { listed_price: '', mileage: null }) },
      },
    })

    expect(events).toEqual([])
  })
})
