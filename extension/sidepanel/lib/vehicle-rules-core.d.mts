export type WarrantyTerm = readonly [months: number, miles: number]
export interface MakeWarrantyTerms {
  basic: WarrantyTerm
  powertrain: WarrantyTerm | null
  electrified?: WarrantyTerm
  powertrainSubsequentOwner?: WarrantyTerm
  battery?: WarrantyTerm
  electrifiedNote?: string
}
export interface WarrantyTermRevision extends Partial<MakeWarrantyTerms> { make: string; fromYear?: number; toYear?: number }
export type CoverageStatus = 'active' | 'partial' | 'expired' | 'unknown'
export interface CoverageOutlook {
  key: 'basic' | 'powertrain' | 'electrified' | 'battery'
  label: string
  termMonths: number
  termMiles: number
  expiresOn: string | null
  monthsRemaining: number | null
  milesRemaining: number | null
  status: CoverageStatus
  limitedBy: 'time' | 'miles' | null
  note: string | null
}
export interface WarrantyCoreInput {
  make?: string | null
  year?: string | number | null
  fuelType?: string | null
  engine?: string | null
  mileage?: number | null
  inService?: { raw?: string | null; source?: string | null; estimated?: boolean }
  stickerWarranty?: string[] | null
  verify: { source: 'oasis' | 'autocheck'; label: string; url: string | null }
}
export interface WarrantyOutlook {
  make: string
  program: string | null
  termsKnown: boolean
  inService: { date: string | null; raw: string | null; source: string | null; estimated: boolean }
  asOf: string
  mileage: number | null
  electrified: boolean
  coverages: CoverageOutlook[]
  stickerWarranty: string[]
  verify: WarrantyCoreInput['verify']
}
export const WARRANTY_RULES_VERSION: string
export const WARRANTY_TERMS: Readonly<Record<string, MakeWarrantyTerms>>
export const WARRANTY_TERM_REVISIONS: readonly WarrantyTermRevision[]
export const WARRANTY_MAKE_ALIASES: Readonly<Record<string, string>>
export function warrantyMakeKey(make: string | null | undefined): string
export function warrantyTermsFor(make: string | null | undefined, year: string | number | null | undefined): MakeWarrantyTerms | null
export function parseServiceDate(value: string | null | undefined): Date | null
export function addMonthsUtc(date: Date, months: number): Date
export function wholeMonthsBetween(from: Date, to: Date): number
export function factoryWarrantyOutlook(input: WarrantyCoreInput, options?: { now?: number }): WarrantyOutlook
export function warrantySummary(outlook: WarrantyOutlook): string | null
export function sourceDistanceText(value?: string | null): string
export function statesKilometres(value?: string | null): boolean
export function sourceDisplayText(value?: string | null): string
