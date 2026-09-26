// Companion adapter over the warranty rules shared with the React app.
// Source-record mapping remains here because the unbundled panel has its own
// deliberately small view model and no framework dependency.

import {
  WARRANTY_MAKE_ALIASES,
  WARRANTY_RULES_VERSION,
  WARRANTY_TERMS,
  WARRANTY_TERM_REVISIONS,
  addMonthsUtc,
  factoryWarrantyOutlook,
  parseServiceDate,
  sourceDistanceText,
  warrantyMakeKey,
  warrantySummary,
  warrantyTermsFor,
  wholeMonthsBetween,
} from './vehicle-rules-core.mjs'

export {
  WARRANTY_MAKE_ALIASES,
  WARRANTY_RULES_VERSION,
  WARRANTY_TERMS,
  WARRANTY_TERM_REVISIONS,
  addMonthsUtc,
  parseServiceDate,
  warrantyMakeKey,
  warrantySummary,
  warrantyTermsFor,
  wholeMonthsBetween,
}

export function vehicleInServiceSource(vehicle) {
  const docs = vehicle.documents ?? {}
  const firstDate = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim()
  const oasis = firstDate(docs.fordOasis?.warrantyStartDate, docs.warrantyCheck?.fordOasis?.warrantyStartDate)
  const estimate = firstDate(docs.autoCheck?.inServiceDate, docs.warrantyCheck?.autoCheck?.inServiceDate)
  const raw = oasis || estimate || null
  return { raw, source: oasis ? 'OASIS' : estimate ? 'AutoCheck estimate' : null, estimated: !oasis }
}

/**
 * @param vehicle { make, fuelType, engine, mileage, vin, certified, links: { oasis }, documents: { autoCheck: { url, inServiceDate }, windowSticker: { warranty } } }
 */
export function warrantyOutlook(vehicle, { now = Date.now() } = {}) {
  const make = warrantyMakeKey(vehicle.make)
  return factoryWarrantyOutlook({
    make: vehicle.make,
    year: vehicle.year,
    fuelType: vehicle.fuelType,
    engine: vehicle.engine,
    mileage: vehicle.mileage,
    inService: vehicleInServiceSource(vehicle),
    stickerWarranty: (vehicle.documents?.windowSticker?.warranty ?? []).filter(Boolean).map(sourceDistanceText),
    verify: make === 'ford' || make === 'lincoln'
      ? { source: 'oasis', label: 'Confirm warranty start date on OASIS', url: vehicle.links?.oasis ?? null }
      : { source: 'autocheck', label: 'Confirm sale and registration dates on the AutoCheck report', url: vehicle.documents?.autoCheck?.url ?? null },
  }, { now })
}

/** Certification stays separate from the factory-warranty estimate. */
export function certifiedTerms(store) {
  if (String(store ?? '').trim() === 'Lincoln') {
    return {
      name: 'Lincoln Certified Pre-Owned',
      short: 'Lincoln Certified',
      brand: 'lincoln',
      terms: [
        'Select: up to 7 model years / 80,000 mi, 139-point inspection, 12 mo / 12,000 mi comprehensive limited warranty from the certified purchase date',
        'Signature: up to 5 model years / 60,000 mi, 200-point inspection, 6 yr / 100,000 mi comprehensive limited warranty from the original warranty start date',
      ],
      note: 'The feed only says certified; the inspection sheet shows the tier. Separate from any factory warranty still running on the vehicle — confirm the paperwork with the store.',
    }
  }
  if (!['Howell', 'Fowlerville', 'Ford Detroit'].includes(String(store ?? '').trim())) {
    return { name: 'Certified', short: 'Certified', brand: null, terms: [], note: 'Confirm the certification program and coverage with the store.' }
  }
  return {
    name: 'Ford Blue Certified',
    short: 'Blue Certified',
    brand: 'ford',
    terms: [
      'Blue Certified: Ford and non-Ford vehicles up to 10 model years / 150,000 mi, 139-point inspection, 90 day / 4,000 mi comprehensive limited warranty',
    ],
    note: 'Dealer-confirmed Blue Certified program. Separate from any factory warranty still running on the vehicle — confirm the paperwork with the store.',
  }
}
