// @ts-nocheck -- Cross-surface parity includes the browser-native companion ESM.
import { describe, expect, it } from 'vitest'
import * as app from '../../src/features/inventory/vehicle-warranty-utils'
import * as companion from '../../extension/sidepanel/lib/warranty.mjs'

const NOW = Date.UTC(2026, 8, 14)

describe('shared warranty rules', () => {
  it('uses one versioned terms, alias, and revision artifact on both surfaces', () => {
    expect(app.WARRANTY_RULES_VERSION).toBe(companion.WARRANTY_RULES_VERSION)
    expect(app.WARRANTY_TERMS).toBe(companion.WARRANTY_TERMS)
    expect(app.WARRANTY_TERM_REVISIONS).toBe(companion.WARRANTY_TERM_REVISIONS)
    expect(app.WARRANTY_MAKE_ALIASES).toBe(companion.WARRANTY_MAKE_ALIASES)
    for (const [make, year] of [['Chevy', 2024], ['VW', 2019], ['Ram', 2026], ['Land-Rover', 2025]]) {
      expect(app.warrantyTermsFor(make, year)).toEqual(companion.warrantyTermsFor(make, year))
    }
  })

  it('produces the same coverage and compact formatting for equivalent records', () => {
    const appOutlook = app.warrantyOutlook({
      make: 'Toyota', year: 2019, fuelType: 'Hybrid', mileage: 12_450,
      inServiceDate: '2024-03-14', autoCheckUrl: 'https://example.invalid/autocheck',
      stickerWarranty: ['5 years / 100,000 km'],
    }, { now: NOW })
    const companionOutlook = companion.warrantyOutlook({
      make: 'Toyota', year: 2019, fuelType: 'Hybrid', mileage: 12_450,
      documents: { autoCheck: { inServiceDate: '2024-03-14', url: 'https://example.invalid/autocheck' }, windowSticker: { warranty: ['5 years / 100,000 km'] } },
      links: { oasis: null },
    }, { now: NOW })
    expect(companionOutlook).toEqual(appOutlook)
    expect(companion.warrantySummary(companionOutlook)).toBe(app.warrantySummary(appOutlook))
  })
})
