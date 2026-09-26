// React-app adapter over the warranty rules shared with the companion.
// The common artifact owns terms, make aliases, date math, coverage math, and
// summary formatting; this file maps the app's typed record shape into it.

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
  warrantySummary as sharedWarrantySummary,
  warrantyTermsFor,
  wholeMonthsBetween,
  type CoverageOutlook,
  type CoverageStatus,
  type MakeWarrantyTerms,
  type WarrantyOutlook as SharedWarrantyOutlook,
  type WarrantyTerm,
  type WarrantyTermRevision,
} from '../../../extension/sidepanel/lib/vehicle-rules-core.mjs'

export {
  WARRANTY_MAKE_ALIASES,
  WARRANTY_RULES_VERSION,
  WARRANTY_TERMS,
  WARRANTY_TERM_REVISIONS,
  addMonthsUtc,
  parseServiceDate,
  warrantyMakeKey,
  warrantyTermsFor,
  wholeMonthsBetween,
}
export type { CoverageOutlook, CoverageStatus, MakeWarrantyTerms, WarrantyTerm, WarrantyTermRevision }

export interface WarrantyOutlook extends Omit<SharedWarrantyOutlook, 'inService'> {
  inService: { date: string | null; raw: string | null; source: string | null; estimated: true }
}

export interface WarrantyInput {
  make: string | null | undefined
  /** Model year, used only to pick the terms that applied when the vehicle was new. */
  year?: string | number | null
  fuelType?: string | null
  engine?: string | null
  mileage?: number | null
  inServiceDate?: string | null
  autoCheckUrl?: string | null
  oasisUrl?: string | null
  stickerWarranty?: string[] | null
}

export function warrantyOutlook(input: WarrantyInput, { now = Date.now() }: { now?: number } = {}): WarrantyOutlook {
  const make = warrantyMakeKey(input.make)
  return factoryWarrantyOutlook({
    make: input.make,
    year: input.year,
    fuelType: input.fuelType,
    engine: input.engine,
    mileage: input.mileage,
    inService: {
      raw: input.inServiceDate?.trim() || null,
      source: input.inServiceDate?.trim() ? 'AutoCheck estimate' : null,
      estimated: true,
    },
    stickerWarranty: (input.stickerWarranty ?? []).filter(Boolean).map(sourceDistanceText),
    verify: make === 'ford' || make === 'lincoln'
      ? { source: 'oasis', label: 'Confirm warranty start date on OASIS', url: input.oasisUrl ?? null }
      : { source: 'autocheck', label: 'Confirm sale and registration dates on the AutoCheck report', url: input.autoCheckUrl ?? null },
  }, { now }) as WarrantyOutlook
}

/** One compact decision line shared verbatim with the companion. */
export function warrantySummary(outlook: WarrantyOutlook): string | null {
  return sharedWarrantySummary(outlook)
}

export interface CertifiedTerms {
  name: string
  brand: 'ford' | 'lincoln' | 'generic'
  terms: string[]
  note: string
}

/** Dealer-confirmed certification policy, separate from factory warranty. */
export function certifiedTerms(homeStore: string | null | undefined): CertifiedTerms {
  if (String(homeStore ?? '').trim() === 'Lincoln') {
    return {
      name: 'Lincoln Certified Pre-Owned',
      brand: 'lincoln',
      terms: [
        'Select: up to 7 model years / 80,000 mi, 139-point inspection, 12 mo / 12,000 mi comprehensive limited warranty from the certified purchase date',
        'Signature: up to 5 model years / 60,000 mi, 200-point inspection, 6 yr / 100,000 mi comprehensive limited warranty from the original warranty start date',
      ],
      note: 'The feed only says certified; the inspection sheet shows the tier. Separate from any factory warranty still running on the vehicle — confirm the paperwork with the store.',
    }
  }
  if (!['Howell', 'Fowlerville', 'Ford Detroit'].includes(String(homeStore ?? '').trim())) {
    return { name: 'Certified pre-owned', brand: 'generic', terms: [], note: 'Confirm certification coverage with the selling store.' }
  }
  return {
    name: 'Ford Blue Certified',
    brand: 'ford',
    terms: [
      'Blue Certified: Ford and non-Ford vehicles up to 10 model years / 150,000 mi, 139-point inspection, 90 day / 4,000 mi comprehensive limited warranty',
    ],
    note: 'Separate from any factory warranty still running on the vehicle. Confirm the certified purchase date and coverage paperwork with the store.',
  }
}
