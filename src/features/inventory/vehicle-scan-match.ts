import type { InventoryVehicle } from './types'

export interface ScannedVehicleMatch {
  vehicle: InventoryVehicle
  matchKind: 'vin' | 'stock'
  /** OCR substitutions are suggestions only; the user must confirm the tag. */
  needsReview: boolean
}

/** Normalize printed identifier separators, without correcting any character. */
export function normalizeScanIdentifier(value: string): string {
  return value.trim().replace(/^#\s*/, '').toUpperCase().replace(/[\s._/-]+/g, '')
}

export function isValidScannedVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeScanIdentifier(value))
}

interface Candidate {
  identifier: string
  standalone: boolean
  stockLabelled: boolean
}

const STOCK_LABEL = /(?:^|[^A-Z0-9])(?:STOCK(?:\s*(?:NO\.?|NUMBER|#))?|STK(?:\s*#)?|UNIT(?:\s*(?:NO\.?|NUMBER|#))?)\s*[:#]?\s*$/
const OCR_GROUPS = ['1IL', '0OQ', '5S', '8B', '2Z', '6G']
const MAX_IDENTIFIER_LENGTH = 24

function scanCandidates(text: string): Candidate[] {
  const upper = text.toUpperCase()
  // Punctuation inside a token belongs to that whole identifier. In
  // particular, never extract a short stock from a larger hyphenated tag.
  const tokens = [...upper.matchAll(/[A-Z0-9]+(?:[._/-][A-Z0-9]+)*/g)]
  const standalone = normalizeScanIdentifier(text)
  const candidates = new Map<string, Candidate>()
  for (let start = 0; start < tokens.length; start++) {
    let identifier = ''
    for (let end = start; end < Math.min(start + 4, tokens.length); end++) {
      if (end > start) {
        const previous = tokens[end - 1]
        const gap = upper.slice(previous.index! + previous[0].length, tokens[end].index!)
        // Spaces can split a printed tag (H24681 P); punctuation or a new
        // line separates observations and is not silently joined.
        if (!/^[ \t]+$/.test(gap)) break
      }
      identifier += normalizeScanIdentifier(tokens[end][0])
      if (identifier.length > MAX_IDENTIFIER_LENGTH) break
      if (identifier.length < 3) continue
      const existing = candidates.get(identifier)
      candidates.set(identifier, {
        identifier,
        standalone: existing?.standalone === true || identifier === standalone,
        stockLabelled: existing?.stockLabelled === true || STOCK_LABEL.test(upper.slice(0, tokens[start].index)),
      })
    }
  }
  return [...candidates.values()]
}

function safeStockCandidate(identifier: string, candidate: Candidate): boolean {
  if (!/^[A-Z0-9]{3,24}$/.test(identifier) || !/\d/.test(identifier)) return false
  // A phone-number fragment, price, odometer or model year is not a stock
  // observation. Short and numeric tags need clear stock context.
  return (identifier.length >= 5 && /[A-Z]/.test(identifier)) || candidate.standalone || candidate.stockLabelled
}

function oneCharacterAlternatives(identifier: string): string[] {
  const alternatives: string[] = []
  for (let index = 0; index < identifier.length; index++) {
    const group = OCR_GROUPS.find(value => value.includes(identifier[index]))
    if (!group) continue
    for (const replacement of group) {
      if (replacement !== identifier[index]) alternatives.push(identifier.slice(0, index) + replacement + identifier.slice(index + 1))
    }
  }
  return alternatives
}

function rank(match: ScannedVehicleMatch): number {
  return (match.needsReview ? 2 : 0) + (match.matchKind === 'vin' ? 0 : 1)
}

/** Local lookup only: results can contain only the supplied authorized vehicles. */
export function matchScannedVehicles(text: string, vehicles: readonly InventoryVehicle[]): ScannedVehicleMatch[] {
  const vins = new Map<string, InventoryVehicle[]>()
  const stocks = new Map<string, InventoryVehicle[]>()
  for (const vehicle of vehicles) {
    for (const [index, value] of [[vins, vehicle.vin], [stocks, vehicle.stockNumber]] as const) {
      const identifier = normalizeScanIdentifier(value)
      if (!identifier) continue
      const existing = index.get(identifier) ?? []
      existing.push(vehicle)
      index.set(identifier, existing)
    }
  }
  const matches = new Map<string, ScannedVehicleMatch>()
  function add(records: InventoryVehicle[] | undefined, matchKind: ScannedVehicleMatch['matchKind'], needsReview: boolean) {
    for (const vehicle of records ?? []) {
      const key = normalizeScanIdentifier(vehicle.vin) || vehicle.id
      const next = { vehicle, matchKind, needsReview }
      const existing = matches.get(key)
      if (!existing || rank(next) < rank(existing)) matches.set(key, next)
    }
  }
  for (const candidate of scanCandidates(text)) {
    // An exact source identifier is usable even for synthetic/legacy VINs
    // that do not meet the standard VIN grammar. Never invent another record.
    add(vins.get(candidate.identifier), 'vin', false)
    if (safeStockCandidate(candidate.identifier, candidate)) add(stocks.get(candidate.identifier), 'stock', false)
    if (candidate.identifier.length < 5) continue
    for (const alternative of oneCharacterAlternatives(candidate.identifier)) {
      if (isValidScannedVin(alternative)) add(vins.get(alternative), 'vin', true)
      if (safeStockCandidate(alternative, candidate)) add(stocks.get(alternative), 'stock', true)
    }
  }
  return [...matches.values()].sort((left, right) => rank(left) - rank(right))
}
