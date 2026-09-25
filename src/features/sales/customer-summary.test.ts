import { describe, expect, it } from 'vitest'
import { customerSummaryText, takeHomeModel } from './customer-summary'
import type { InventoryVehicle } from '../inventory/types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const vehicle: InventoryVehicle = {
  id: 'TESTDATAHWELL0001', vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', year: 2024, make: 'Ford', model: 'F-150',
  price: 42000, mileage: 18000, features: ['Heated seats'],
  publicListing: { dataState: 'stale', isListed: true, updatedAt: '2026-08-30T12:00:00Z', listingUrl: 'https://example.com/synthetic-truck' },
  dealerOn: { dataState: 'stale', inStock: null, inTransit: null, inProduction: null },
  dealerMail: { dataState: 'stale', hasActiveHold: null, conciseState: 'PRIVATE_HOLD_MARKER', lastKnownActiveHold: true },
  holdEvidence: [{ id: 'private', dataState: 'stale', position: 'primary', lifecycleStatus: 'last_verified_active', salesperson: 'PRIVATE_OWNER_MARKER', customerOrReason: 'PRIVATE_CUSTOMER_MARKER' }],
  authorizedSearchText: 'PRIVATE_SEARCH_MARKER', location: { homeStore: { id: 'howell', name: 'Howell' }, custodian: 'PRIVATE_CUSTODIAN_MARKER' },
}

describe('customer-safe inventory summary', () => {
  it('contains useful dated facts and a listing without operational or customer evidence', () => {
    const text = customerSummaryText(takeHomeModel(vehicle))
    expect(text).toContain('Recorded price: $42,000')
    expect(text).toContain('18,000 mi')
    expect(text).toContain('Heated seats')
    expect(text).toContain('08/30/2026')
    expect(text).toContain('https://example.com/synthetic-truck')
    expect(text).toContain('Confirm current availability')
    expect(text).not.toContain('PRIVATE_')
    expect(JSON.stringify(takeHomeModel(vehicle))).not.toContain('PRIVATE_')
  })
  it('does not call CRM-only prices listed prices or invent a listing link', () => {
    const text = customerSummaryText(takeHomeModel({ ...vehicle, publicListing: { dataState: 'current', isListed: false } }))
    expect(text).toContain('Recorded price: $42,000')
    expect(text).not.toContain('Listed price')
    expect(text).not.toContain('https://')
    expect(text).toContain('date not provided')
  })
  it.each(['incomplete', 'unavailable'] as const)('excludes %s equipment and history claims while retaining listing features', state => {
    const model = takeHomeModel({ ...vehicle,
      autoCheckReport: { dataState: state, score: 99, ownerCount: 1 },
      windowSticker: { dataState: state, options: ['INCOMPLETE_OPTION_MARKER'] },
      factoryEquipment: { dataState: state, isOriginalWindowSticker: false, packages: [{ name: 'INCOMPLETE_PACKAGE_MARKER' }] },
    })
    expect(model.history).toBeNull()
    expect(model.equipment).toContain('Heated seats')
    expect(JSON.stringify(model)).not.toContain('INCOMPLETE_')
  })
  it('keeps dated saved history and excludes unsafe listing URLs', () => {
    const model = takeHomeModel({ ...vehicle, publicListing: { ...vehicle.publicListing, listingUrl: 'javascript:alert(1)' }, autoCheckReport: { dataState: 'stale', ownerCount: 2, capturedAt: '2026-08-29T12:00:00Z' } })
    expect(customerSummaryText(model)).toContain('2 owners reported (report 08/29/2026)')
    expect(model.listingUrl).toBeNull()
  })
})
