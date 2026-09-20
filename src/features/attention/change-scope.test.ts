import { describe, expect, it } from 'vitest'
import type { PublicChangeEvent } from '../../types'
import { publicChangeMatchesStore, scopePublicChanges } from './change-scope'

function event(overrides: Partial<PublicChangeEvent> = {}): PublicChangeEvent {
  return {
    id: '2026-08-29:price_change:TESTDATASYN000004',
    type: 'price_change',
    field: 'Listed price',
    valueType: 'money',
    reportDate: '2026-08-29',
    previousReportDate: '2026-08-28',
    vin: 'TESTDATASYN000004',
    stockNumber: 'H1234',
    vehicleName: '2024 Ford Bronco Raptor',
    store: 'Howell',
    beforeValue: 70000,
    afterValue: 69000,
    currentVehicle: true,
    ...overrides,
  }
}

describe('Today inventory-change store scope', () => {
  it('shows a store transfer to both the prior and current physical stores', () => {
    const transfer = event({
      id: '2026-08-29:store_transfer:TESTDATASYN000004',
      type: 'store_transfer',
      field: 'Source physical store',
      valueType: 'store',
      store: 'Howell',
      beforeValue: 'Fowlerville',
      afterValue: 'Howell',
    })

    expect(publicChangeMatchesStore(transfer, 'Fowlerville')).toBe(true)
    expect(publicChangeMatchesStore(transfer, 'Howell')).toBe(true)
    expect(publicChangeMatchesStore(transfer, 'Ford Detroit')).toBe(false)
  })

  it('does not broaden ordinary changes beyond their physical store', () => {
    const priceChange = event()

    expect(publicChangeMatchesStore(priceChange, 'Howell')).toBe(true)
    expect(publicChangeMatchesStore(priceChange, 'Fowlerville')).toBe(false)
  })

  it('keeps one event in group scope while each affected home store can see it', () => {
    const transfer = event({
      id: '2026-08-29:store_transfer:TESTDATASYN000004',
      type: 'store_transfer',
      field: 'Source physical store',
      valueType: 'store',
      store: 'Howell',
      beforeValue: 'Fowlerville',
      afterValue: 'Howell',
    })
    const changes = [transfer]

    expect(scopePublicChanges(changes, 'home', 'Fowlerville')).toEqual([transfer])
    expect(scopePublicChanges(changes, 'home', 'Howell')).toEqual([transfer])
    expect(scopePublicChanges(changes, 'group', 'Howell')).toBe(changes)
    expect(scopePublicChanges(changes, 'group', 'Howell')).toHaveLength(1)
  })
})
