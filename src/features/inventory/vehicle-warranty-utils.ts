// Original in-service date and remaining factory coverage.
//
// A manufacturer warranty runs from the original in-service (first retail
// sale) date, not the model year. The app only holds AutoCheck's *estimate*
// of that date. The authoritative date is OASIS ("Warranty Start Date") for
// Ford and Lincoln VINs and the sale/registration history on the full
// AutoCheck report for other makes, so every outlook names its source and
// where to confirm it. AutoCheck's own report also has a warranty calculator
// at the bottom that takes current miles; this mirrors that reference, it
// does not replace an OASIS lookup.
//
// Keep this file in step with extension/sidepanel/lib/warranty.mjs.

import { sourceDistanceText } from "../../lib/source-distance"

export type WarrantyTerm = readonly [months: number, miles: number]

export interface MakeWarrantyTerms {
  basic: WarrantyTerm
  powertrain: WarrantyTerm | null
  /** Hybrid / EV unique-component coverage when the make sells such vehicles. */
  electrified?: WarrantyTerm
  /** Some makes cut the long powertrain term for anyone but the first owner. */
  powertrainSubsequentOwner?: WarrantyTerm
  /** A separate, longer high-voltage battery term where the make publishes one. */
  battery?: WarrantyTerm
  electrifiedNote?: string
}

export const WARRANTY_TERMS: Readonly<Record<string, MakeWarrantyTerms>> = Object.freeze({
  ford: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  lincoln: { basic: [48, 50000], powertrain: [72, 70000], electrified: [96, 100000] },
  chevrolet: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  gmc: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  buick: { basic: [36, 36000], powertrain: [60, 60000] },
  cadillac: { basic: [48, 50000], powertrain: [72, 70000], electrified: [96, 100000] },
  toyota: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000], battery: [120, 150000] },
  lexus: { basic: [48, 50000], powertrain: [72, 70000], electrified: [96, 100000], battery: [120, 150000] },
  honda: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  acura: { basic: [48, 50000], powertrain: [72, 70000], electrified: [96, 100000] },
  nissan: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  infiniti: { basic: [48, 60000], powertrain: [72, 70000] },
  hyundai: { basic: [60, 60000], powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000], electrified: [120, 100000] },
  kia: { basic: [60, 60000], powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000], electrified: [120, 100000] },
  genesis: { basic: [60, 60000], powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000], electrified: [120, 100000] },
  jeep: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  ram: { basic: [36, 36000], powertrain: [60, 60000] },
  dodge: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  chrysler: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  subaru: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  mazda: { basic: [36, 36000], powertrain: [60, 60000], electrified: [96, 100000] },
  volkswagen: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  audi: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  bmw: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  mini: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  "mercedes-benz": { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000], electrifiedNote: "Battery-electric terms; plug-in hybrids carry a shorter 6 yr / 62,000 mi high-voltage battery term outside California-emission states." },
  volvo: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  porsche: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  tesla: { basic: [48, 50000], powertrain: null, electrified: [96, 100000], electrifiedNote: "Model S/X and Long Range or Performance trims carry longer battery terms (8 yr / 120,000–150,000 mi)." },
  mitsubishi: { basic: [60, 60000], powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000], electrified: [120, 100000] },
  "land rover": { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  jaguar: { basic: [60, 60000], powertrain: [60, 60000], electrified: [96, 100000] },
  rivian: { basic: [48, 50000], powertrain: [96, 150000], electrified: [96, 150000] },
})

export interface WarrantyTermRevision extends Partial<MakeWarrantyTerms> {
  make: string
  fromYear?: number
  toYear?: number
}

/**
 * Terms that changed by model year. Each revision patches the make's current
 * terms for vehicles whose model year falls inside [fromYear, toYear].
 */
export const WARRANTY_TERM_REVISIONS: readonly WarrantyTermRevision[] = Object.freeze([
  { make: "ram", fromYear: 2026, powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000] },
  { make: "buick", toYear: 2019, basic: [48, 50000], powertrain: [72, 70000] },
  { make: "volkswagen", toYear: 2019, basic: [72, 72000], powertrain: [72, 72000] },
  { make: "toyota", toYear: 2019, battery: [96, 100000] },
  { make: "lexus", toYear: 2019, battery: [96, 100000] },
])

/** The make's terms as they applied to a given model year (current terms when the year is unknown). */
export function warrantyTermsFor(make: string | null | undefined, year: string | number | null | undefined): MakeWarrantyTerms | null {
  const key = warrantyMakeKey(make)
  const base = WARRANTY_TERMS[key] ?? null
  if (!base) return null
  const modelYear = Number.parseInt(String(year ?? ""), 10)
  if (!Number.isFinite(modelYear)) return base
  let terms: MakeWarrantyTerms = base
  for (const revision of WARRANTY_TERM_REVISIONS) {
    if (revision.make !== key) continue
    if (revision.fromYear !== undefined && modelYear < revision.fromYear) continue
    if (revision.toYear !== undefined && modelYear > revision.toYear) continue
    const { make: _make, fromYear: _from, toYear: _to, ...patch } = revision
    terms = { ...terms, ...patch }
  }
  return terms
}

const MAKE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  mercedes: "mercedes-benz", "mercedes benz": "mercedes-benz", vw: "volkswagen", chevy: "chevrolet", landrover: "land rover", "land-rover": "land rover",
})

export function warrantyMakeKey(make: string | null | undefined): string {
  const key = String(make ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  return MAKE_ALIASES[key] ?? key
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/** A date the source published as a day (no time) is a UTC calendar day. */
export function parseServiceDate(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  let date: Date | null = null
  const iso = raw.match(DATE_ONLY)
  const us = raw.match(US_DATE)
  if (iso) date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
  else if (us) date = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])))
  else {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) date = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
  }
  return date && !Number.isNaN(date.getTime()) ? date : null
}

export function addMonthsUtc(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
  // Jan 31 + 1 month is the last day of February, not March 3.
  if (target.getUTCDate() !== date.getUTCDate()) target.setUTCDate(0)
  return target
}

export function wholeMonthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0)
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

export type CoverageStatus = "active" | "partial" | "expired" | "unknown"

export interface CoverageOutlook {
  key: "basic" | "powertrain" | "electrified" | "battery"
  label: string
  termMonths: number
  termMiles: number
  expiresOn: string | null
  monthsRemaining: number | null
  milesRemaining: number | null
  status: CoverageStatus
  limitedBy: "time" | "miles" | null
  note: string | null
}

export interface WarrantyOutlook {
  make: string
  program: string | null
  termsKnown: boolean
  inService: { date: string | null; raw: string | null; source: string | null; estimated: true }
  asOf: string
  mileage: number | null
  electrified: boolean
  coverages: CoverageOutlook[]
  stickerWarranty: string[]
  verify: { source: "oasis" | "autocheck"; label: string; url: string | null }
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

const isElectrified = (fuelType?: string | null, engine?: string | null): boolean => /hybrid|electric|plug-?in|\bev\b|phev|bev/i.test(`${fuelType ?? ""} ${engine ?? ""}`)

function coverage(
  key: CoverageOutlook["key"],
  label: string,
  term: WarrantyTerm | null | undefined,
  context: { inService: Date | null; mileage: number | null; asOf: Date; note?: string | null },
): CoverageOutlook | null {
  if (!term) return null
  const [termMonths, termMiles] = term
  const { inService, mileage, asOf } = context
  const expiresOn = inService ? addMonthsUtc(inService, termMonths) : null
  const monthsRemaining = expiresOn ? Math.max(0, wholeMonthsBetween(asOf, expiresOn)) : null
  const timeExpired = expiresOn ? expiresOn.getTime() <= asOf.getTime() : null
  const milesRemaining = mileage === null ? null : Math.max(0, termMiles - mileage)
  const milesExpired = mileage === null ? null : mileage >= termMiles
  let status: CoverageStatus = "unknown"
  if (timeExpired === true || milesExpired === true) status = "expired"
  else if (timeExpired === false && milesExpired === false) status = "active"
  else if (timeExpired === false || milesExpired === false) status = "partial"
  const limitedBy: CoverageOutlook["limitedBy"] = status === "active"
    ? (monthsRemaining !== null && milesRemaining !== null ? (milesRemaining / termMiles <= monthsRemaining / termMonths ? "miles" : "time") : null)
    : status === "expired" ? (milesExpired ? "miles" : "time") : null
  return { key, label, termMonths, termMiles, expiresOn: expiresOn ? isoDay(expiresOn) : null, monthsRemaining, milesRemaining, status, limitedBy, note: context.note ?? null }
}

export function warrantyOutlook(input: WarrantyInput, { now = Date.now() }: { now?: number } = {}): WarrantyOutlook {
  const asOf = new Date(now)
  const make = warrantyMakeKey(input.make)
  const terms = warrantyTermsFor(input.make, input.year)
  const fordFamily = make === "ford" || make === "lincoln"
  const raw = input.inServiceDate?.trim() || null
  const inService = parseServiceDate(raw)
  const mileage = typeof input.mileage === "number" && Number.isFinite(input.mileage) ? input.mileage : null
  const electrified = isElectrified(input.fuelType, input.engine)
  const context = { inService, mileage, asOf }
  const coverages = terms
    ? ([
        coverage("basic", "Bumper-to-bumper", terms.basic, context),
        coverage("powertrain", "Powertrain", terms.powertrain, {
          ...context,
          note: terms.powertrainSubsequentOwner
            ? `Original owner only; later owners get ${terms.powertrainSubsequentOwner[0] / 12} yr / ${terms.powertrainSubsequentOwner[1].toLocaleString("en-US")} mi.`
            : null,
        }),
        electrified ? coverage("electrified", "Hybrid / EV components", terms.electrified, { ...context, note: terms.electrifiedNote ?? null }) : null,
        electrified && terms.battery ? coverage("battery", "Hybrid battery", terms.battery, context) : null,
      ].filter(Boolean) as CoverageOutlook[])
    : []
  const verify: WarrantyOutlook["verify"] = fordFamily
    ? { source: "oasis", label: "Confirm warranty start date on OASIS", url: input.oasisUrl ?? null }
    : { source: "autocheck", label: "Confirm sale and registration dates on the AutoCheck report", url: input.autoCheckUrl ?? null }
  return {
    make,
    program: terms ? `${String(input.make ?? "").trim()} new-vehicle limited warranty` : null,
    termsKnown: Boolean(terms),
    inService: { date: inService ? isoDay(inService) : null, raw, source: raw ? "AutoCheck estimate" : null, estimated: true },
    asOf: isoDay(asOf),
    mileage,
    electrified,
    coverages,
    // A Canadian sticker prints its terms in kilometres; staff read miles.
    stickerWarranty: (input.stickerWarranty ?? []).filter(Boolean).map(sourceDistanceText),
    verify,
  }
}

/** One line for a compact surface: "Bumper-to-bumper 6 mo / 23,550 mi left · Powertrain 30 mo / 47,550 mi left". */
export function warrantySummary(outlook: WarrantyOutlook): string | null {
  const part = (item: CoverageOutlook | undefined): string | null => {
    if (!item) return null
    if (item.status === "expired") return `${item.label} expired`
    if (item.status === "unknown") return null
    const bits = [item.monthsRemaining !== null ? `${item.monthsRemaining} mo` : null, item.milesRemaining !== null ? `${item.milesRemaining.toLocaleString("en-US")} mi` : null].filter(Boolean)
    return `${item.label} ${bits.join(" / ")} left`
  }
  return [part(outlook.coverages.find((item) => item.key === "basic")), part(outlook.coverages.find((item) => item.key === "powertrain"))].filter(Boolean).join(" · ") || null
}

export interface CertifiedTerms {
  name: string
  brand: "ford" | "lincoln"
  terms: string[]
  note: string
}

/**
 * What the dealership's certification adds. Bob Maxey is a Ford–Lincoln group:
 * the Ford stores certify under Ford Blue Advantage and the Lincoln store under
 * Lincoln Certified Pre-Owned. The feed only carries a boolean, so both tiers
 * are listed and the inspection sheet settles which one applies. Any factory
 * warranty still running on the vehicle is separate from this.
 */
export function certifiedTerms(homeStore: string | null | undefined): CertifiedTerms {
  if (String(homeStore ?? "").trim() === "Lincoln") {
    return {
      name: "Lincoln Certified Pre-Owned",
      brand: "lincoln",
      terms: [
        "Select: up to 7 model years / 80,000 mi, 139-point inspection, 12 mo / 12,000 mi comprehensive limited warranty from the certified purchase date",
        "Signature: up to 5 model years / 60,000 mi, 200-point inspection, 6 yr / 100,000 mi comprehensive limited warranty from the original warranty start date",
      ],
      note: "The feed only says certified; the inspection sheet shows the tier. Separate from any factory warranty still running on the vehicle — confirm the paperwork with the store.",
    }
  }
  return {
    name: "Ford Blue Advantage",
    brand: "ford",
    terms: [
      "Blue Certified: Ford and non-Ford vehicles up to 10 model years / 150,000 mi, 139-point inspection, 90 day / 4,000 mi comprehensive limited warranty",
      "Gold Certified: Ford vehicles up to 6 model years / 80,000 mi, 172-point inspection, 12 mo / 12,000 mi comprehensive plus 7 yr / 100,000 mi powertrain from the original warranty start date",
    ],
    note: "The feed only says certified; the inspection sheet shows the tier. Separate from any factory warranty still running on the vehicle — confirm the paperwork with the store.",
  }
}
