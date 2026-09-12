// A faithful port of the app's inventory search (src/features/inventory/
// inventory-search.ts) over the panel's own vehicle view model, so a stock
// number, VIN fragment, "F150" for "F-150", "$51,800", or a slightly
// misspelled trim rank the same way here as in Inventory Flow. User input is
// never treated as a pattern.

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const JOINER_PUNCTUATION = /([a-z0-9])[-‐‑‒–—/_.',](?=[a-z0-9])/gi
const DIACRITICS = /[̀-ͯ]/g
const NON_ALPHANUMERIC = /[^a-z0-9]+/g

function literal(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLocaleLowerCase()
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fold(value) {
  let folded = literal(value).replace(/[$£€]/g, '')
  for (let pass = 0; pass < 2; pass += 1) folded = folded.replace(JOINER_PUNCTUATION, '$1')
  return folded.replace(NON_ALPHANUMERIC, ' ').trim()
}

const tokens = (folded) => [...new Set(folded.split(' ').filter(Boolean))]

function numberAliases(value, kind) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return []
  const whole = Math.round(value)
  const formatted = integer.format(whole)
  return kind === 'money'
    ? [String(whole), formatted, money.format(whole)]
    : [String(whole), formatted, `${formatted} mi`, `${formatted} miles`]
}

function field(target, label, value, priority = 0, options = {}) {
  if (value === null || value === undefined) return
  const raw = String(value).trim()
  if (!raw) return
  const lit = literal(raw), fld = fold(raw)
  if (!lit && !fld) return
  target.push({ label, literal: lit, folded: fld, tokens: tokens(fld), priority, identifier: options.identifier === true, displaySafe: options.displaySafe !== false })
}

/** Index one panel vehicle (see model.mjs) into weighted search fields. */
export function buildEntry(vehicle) {
  const fields = []
  field(fields, 'Stock', vehicle.stockNumber, 42, { identifier: true })
  field(fields, 'VIN', vehicle.vin, 44, { identifier: true })
  field(fields, 'Vehicle', vehicle.name, 34)
  field(fields, 'Year', vehicle.year, 22)
  field(fields, 'Make', vehicle.make, 30)
  field(fields, 'Model', vehicle.model, 32)
  field(fields, 'Trim', vehicle.trim, 28)
  field(fields, 'Exterior color', vehicle.exteriorColor, 18)
  field(fields, 'Interior color', vehicle.interiorColor, 16)
  field(fields, 'Body style', vehicle.bodyStyle, 20)
  field(fields, 'Drivetrain', vehicle.drivetrain, 18)
  field(fields, 'Engine', vehicle.engine, 18)
  field(fields, 'Transmission', vehicle.transmission, 16)
  field(fields, 'Fuel type', vehicle.fuelType, 14)
  field(fields, 'Home store', vehicle.homeStore, 24)
  field(fields, 'Reported store', vehicle.sourceReportedStore, 20)
  field(fields, 'CRM store', vehicle.crmStore, 20)
  field(fields, 'Current location', vehicle.location.label, 24)
  field(fields, 'Custodian', vehicle.location.custodian, 16)
  field(fields, 'Website status', vehicle.listing.websiteStatus, 12)
  field(fields, 'DealerMail hold', vehicle.hold.label, 22)
  field(fields, 'Hold position', vehicle.hold.position, 20)
  field(fields, 'Movement', vehicle.movement?.state, 20)
  field(fields, 'Movement', vehicle.movement?.requestStatus, 18)
  field(fields, 'Next action', vehicle.movement?.nextAction, 18)
  field(fields, 'Change', vehicle.changeSummary, 10)
  for (const alias of numberAliases(vehicle.price, 'money')) field(fields, 'Price', alias, 25)
  for (const alias of numberAliases(vehicle.msrp, 'money')) field(fields, 'MSRP', alias, 18)
  for (const alias of numberAliases(vehicle.mileage, 'mileage')) field(fields, 'Mileage', alias, 23)
  field(fields, 'Days listed', vehicle.daysListed, 12)
  for (const feature of vehicle.features) field(fields, 'Feature', feature, 16)
  // Server-reduced text authorized for this role: matching only, never shown.
  field(fields, 'Authorized details', vehicle.authorizedSearchText?.replace(/\s+\|\s+/g, ' '), 8, { displaySafe: false })
  for (const evidence of vehicle.hold.evidence) {
    field(fields, 'Salesperson', evidence.salesperson, 24)
    field(fields, 'Customer / reason', evidence.customerOrReason, 22)
    field(fields, 'Hold date', evidence.holdDate, 12)
    field(fields, 'Expected date', evidence.expectedDate, 12)
  }
  return { vehicle, fields, foldedText: fields.map((item) => item.folded).join('\n') }
}

export function buildIndex(vehicles) { return vehicles.map(buildEntry) }

function parseTerms(query) {
  return literal(query).split(/\s+/).filter(Boolean).map((raw) => {
    const folded = fold(raw)
    return { raw, folded, literalOnly: folded.length === 0 }
  })
}

function editDistance(left, right, maximum) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    let rowMinimum = row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      const value = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost)
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > maximum) return maximum + 1
    previous = current
  }
  return previous[right.length]
}

function fuzzyThreshold(term) {
  if (term.length < 4 || /\d/.test(term) || !/[a-z]/.test(term)) return 0
  return term.length >= 7 ? 2 : 1
}

function scoreTerm(item, term) {
  if (term.literalOnly) return item.literal.includes(term.raw) ? 98 + item.priority : -1
  if (item.literal === term.raw) return 176 + item.priority
  if (item.folded === term.folded) return 168 + item.priority
  if (item.identifier && item.folded.startsWith(term.folded)) return 158 + item.priority
  if (item.identifier && item.folded.includes(term.folded)) return 148 + item.priority
  if (item.tokens.includes(term.folded)) return 138 + item.priority
  if (item.folded.startsWith(term.folded)) return 126 + item.priority
  if (item.folded.includes(term.folded)) return 104 + item.priority
  if (item.literal.includes(term.raw)) return 96 + item.priority
  const threshold = fuzzyThreshold(term.folded)
  if (threshold === 0) return -1
  let best = threshold + 1
  for (const token of item.tokens) {
    if (Math.abs(token.length - term.folded.length) > threshold) continue
    best = Math.min(best, editDistance(token, term.folded, threshold))
    if (best === 1) break
  }
  return best <= threshold ? 70 - best * 12 + item.priority : -1
}

function scoreEntry(entry, query) {
  const terms = parseTerms(query)
  if (terms.length === 0) return { vehicle: entry.vehicle, score: 0, matchedLabels: [] }
  let score = 0
  const labels = new Set()
  for (const term of terms) {
    let bestScore = -1, bestField = null
    for (const item of entry.fields) {
      const next = scoreTerm(item, term)
      if (next > bestScore) { bestScore = next; bestField = item }
    }
    if (bestScore < 0 || !bestField) return null
    score += bestScore
    if (bestField.displaySafe) labels.add(bestField.label)
  }
  const phrase = fold(query)
  if (phrase && entry.foldedText.includes(phrase)) score += 52
  return { vehicle: entry.vehicle, score, matchedLabels: [...labels].slice(0, 3) }
}

/** Ranked matches for a query; an empty query returns every entry in order. */
export function rank(index, query) {
  if (!query.trim()) return index.map((entry) => ({ vehicle: entry.vehicle, score: 0, matchedLabels: [] }))
  const matches = []
  index.forEach((entry, order) => {
    const match = scoreEntry(entry, query)
    if (match) matches.push({ ...match, order })
  })
  matches.sort((left, right) =>
    right.score - left.score ||
    left.order - right.order ||
    left.vehicle.stockNumber.localeCompare(right.vehicle.stockNumber, undefined, { numeric: true }))
  return matches.map(({ order: _order, ...match }) => match)
}
