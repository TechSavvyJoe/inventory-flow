// Shared dependency-free vehicle rules for the React app and the unbundled
// companion. Keep host-specific record adapters and UI copy in their wrappers.

export const WARRANTY_RULES_VERSION = '2026-09-25.1'

export const WARRANTY_TERMS = Object.freeze({
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
  'mercedes-benz': { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000], electrifiedNote: 'Battery-electric terms; plug-in hybrids carry a shorter 6 yr / 62,000 mi high-voltage battery term outside California-emission states.' },
  volvo: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  porsche: { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  tesla: { basic: [48, 50000], powertrain: null, electrified: [96, 100000], electrifiedNote: 'Model S/X and Long Range or Performance trims carry longer battery terms (8 yr / 120,000–150,000 mi).' },
  mitsubishi: { basic: [60, 60000], powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000], electrified: [120, 100000] },
  'land rover': { basic: [48, 50000], powertrain: [48, 50000], electrified: [96, 100000] },
  jaguar: { basic: [60, 60000], powertrain: [60, 60000], electrified: [96, 100000] },
  rivian: { basic: [48, 50000], powertrain: [96, 150000], electrified: [96, 150000] },
})

export const WARRANTY_TERM_REVISIONS = Object.freeze([
  { make: 'ram', fromYear: 2026, powertrain: [120, 100000], powertrainSubsequentOwner: [60, 60000] },
  { make: 'buick', toYear: 2019, basic: [48, 50000], powertrain: [72, 70000] },
  { make: 'volkswagen', toYear: 2019, basic: [72, 72000], powertrain: [72, 72000] },
  { make: 'toyota', toYear: 2019, battery: [96, 100000] },
  { make: 'lexus', toYear: 2019, battery: [96, 100000] },
])

export const WARRANTY_MAKE_ALIASES = Object.freeze({
  mercedes: 'mercedes-benz', 'mercedes benz': 'mercedes-benz', vw: 'volkswagen', chevy: 'chevrolet', landrover: 'land rover', 'land-rover': 'land rover',
})

export function warrantyMakeKey(make) {
  const key = String(make ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return WARRANTY_MAKE_ALIASES[key] ?? key
}

export function warrantyTermsFor(make, year) {
  const key = warrantyMakeKey(make)
  const base = WARRANTY_TERMS[key] ?? null
  if (!base) return null
  const modelYear = Number.parseInt(String(year ?? ''), 10)
  if (!Number.isFinite(modelYear)) return base
  let terms = base
  for (const revision of WARRANTY_TERM_REVISIONS) {
    if (revision.make !== key) continue
    if (revision.fromYear !== undefined && modelYear < revision.fromYear) continue
    if (revision.toYear !== undefined && modelYear > revision.toYear) continue
    const { make: _make, fromYear: _from, toYear: _to, ...patch } = revision
    terms = { ...terms, ...patch }
  }
  return terms
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

export function parseServiceDate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  let date = null
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

export function addMonthsUtc(date, months) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
  if (target.getUTCDate() !== date.getUTCDate()) target.setUTCDate(0)
  return target
}

export function wholeMonthsBetween(from, to) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0)
}

const isoDay = (date) => date.toISOString().slice(0, 10)
const isElectrified = (fuelType, engine) => /hybrid|electric|plug-?in|\bev\b|phev|bev/i.test(`${fuelType ?? ''} ${engine ?? ''}`)

function coverage(key, label, term, { inService, mileage, asOf, note }) {
  if (!term) return null
  const [termMonths, termMiles] = term
  const expiresOn = inService ? addMonthsUtc(inService, termMonths) : null
  const monthsRemaining = expiresOn ? Math.max(0, wholeMonthsBetween(asOf, expiresOn)) : null
  const timeExpired = expiresOn ? expiresOn.getTime() <= asOf.getTime() : null
  const milesRemaining = mileage === null ? null : Math.max(0, termMiles - mileage)
  const milesExpired = mileage === null ? null : mileage >= termMiles
  let status = 'unknown'
  if (timeExpired === true || milesExpired === true) status = 'expired'
  else if (timeExpired === false && milesExpired === false) status = 'active'
  else if (timeExpired === false || milesExpired === false) status = 'partial'
  const limitedBy = status === 'active'
    ? (monthsRemaining !== null && milesRemaining !== null ? (milesRemaining / termMiles <= monthsRemaining / termMonths ? 'miles' : 'time') : null)
    : status === 'expired' ? (milesExpired ? 'miles' : 'time') : null
  return { key, label, termMonths, termMiles, expiresOn: expiresOn ? isoDay(expiresOn) : null, monthsRemaining, milesRemaining, status, limitedBy, note: note ?? null }
}

export function factoryWarrantyOutlook(input, { now = Date.now() } = {}) {
  const asOf = new Date(now)
  const make = warrantyMakeKey(input.make)
  const terms = warrantyTermsFor(input.make, input.year)
  const raw = String(input.inService?.raw ?? '').trim() || null
  const inService = parseServiceDate(raw)
  const mileage = typeof input.mileage === 'number' && Number.isFinite(input.mileage) ? input.mileage : null
  const electrified = isElectrified(input.fuelType, input.engine)
  const context = { inService, mileage, asOf }
  const coverages = terms ? [
    coverage('basic', 'Bumper-to-bumper', terms.basic, context),
    coverage('powertrain', 'Powertrain', terms.powertrain, {
      ...context,
      note: terms.powertrainSubsequentOwner ? `Original owner only; later owners get ${terms.powertrainSubsequentOwner[0] / 12} yr / ${terms.powertrainSubsequentOwner[1].toLocaleString('en-US')} mi.` : null,
    }),
    electrified ? coverage('electrified', 'Hybrid / EV components', terms.electrified, { ...context, note: terms.electrifiedNote ?? null }) : null,
    electrified && terms.battery ? coverage('battery', 'Hybrid battery', terms.battery, context) : null,
  ].filter(Boolean) : []
  return {
    make,
    program: terms ? `${String(input.make ?? '').trim()} new-vehicle limited warranty` : null,
    termsKnown: Boolean(terms),
    inService: { date: inService ? isoDay(inService) : null, raw, source: input.inService?.source ?? null, estimated: input.inService?.estimated !== false },
    asOf: isoDay(asOf),
    mileage,
    electrified,
    coverages,
    stickerWarranty: Array.isArray(input.stickerWarranty) ? input.stickerWarranty.filter(Boolean) : [],
    verify: input.verify,
  }
}

export function warrantySummary(outlook) {
  const part = (item) => {
    if (!item) return null
    if (item.status === 'expired') return `${item.label} expired`
    if (item.status === 'unknown') return null
    const bits = [item.monthsRemaining !== null ? `${item.monthsRemaining} mo` : null, item.milesRemaining !== null ? `${item.milesRemaining.toLocaleString('en-US')} mi` : null].filter(Boolean)
    return `${item.label} ${bits.join(' / ')} left`
  }
  return [part(outlook.coverages.find((item) => item.key === 'basic')), part(outlook.coverages.find((item) => item.key === 'powertrain'))].filter(Boolean).join(' · ') || null
}

const MILES_PER_KILOMETRE = 0.621371
const MPG_PER_L_100KM = 235.214583
const KILOMETRE_UNIT = '(?:km|kms|kilometres?|kilometers?)'
const GROUP_SEPARATOR = '[,\\u0020\\u00a0\\u202f]'
const NUMBER = `\\d{1,3}(?:${GROUP_SEPARATOR}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`
const KILOMETRE_QUANTITY = new RegExp([
  `(?<consumption>${NUMBER})\\s*(?:L|l|litres?|liters?)\\s*\\/\\s*100\\s*${KILOMETRE_UNIT}\\b`,
  `(?<speed>${NUMBER})\\s*${KILOMETRE_UNIT}\\s*\\/\\s*h(?:r|our)?\\b`,
  `unlimited\\s+${KILOMETRE_UNIT}\\b`,
  `(?<distance>${NUMBER})\\s*${KILOMETRE_UNIT}\\b`,
].join('|'), 'gi')
const QUALIFIER_TAIL = ' in the source)'
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimalNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

function sourceAmount(value) {
  return Number(value.replace(/[,\u0020\u00a0\u202f]/g, ''))
}

/**
 * Show captured metric source prose in US units while retaining the original
 * figure as evidence. This is presentation only and is safe to apply twice.
 */
export function sourceDistanceText(value) {
  if (typeof value !== 'string') return ''
  if (value.includes(QUALIFIER_TAIL)) return value
  const sources = []
  const converted = value.replace(KILOMETRE_QUANTITY, (match, ...rest) => {
    const groups = rest[rest.length - 1]
    const remember = (source) => { if (!sources.includes(source)) sources.push(source) }
    if (groups.consumption !== undefined) {
      const litres = sourceAmount(groups.consumption)
      remember(`${decimalNumber.format(litres)} L/100 km`)
      return litres > 0 ? `${wholeNumber.format(MPG_PER_L_100KM / litres)} mpg` : match
    }
    if (groups.speed !== undefined) {
      const perHour = sourceAmount(groups.speed)
      remember(`${wholeNumber.format(perHour)} km/h`)
      return `${wholeNumber.format(perHour * MILES_PER_KILOMETRE)} mph`
    }
    if (groups.distance === undefined) {
      remember('unlimited km')
      return 'unlimited miles'
    }
    const kilometres = sourceAmount(groups.distance)
    remember(`${wholeNumber.format(kilometres)} km`)
    return `${wholeNumber.format(kilometres * MILES_PER_KILOMETRE)} mi`
  })
  return sources.length ? `${converted} (${sources.join(', ')}${QUALIFIER_TAIL}` : converted
}

export function statesKilometres(value) {
  return typeof value === 'string' && new RegExp(KILOMETRE_QUANTITY.source, 'i').test(value)
}

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ndash: '–', mdash: '—', bull: '•', reg: '®', trade: '™', copy: '©',
})

/** Decode one safe layer of captured prose for plain-text rendering only. */
export function sourceDisplayText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp|ndash|mdash|bull|reg|trade|copy);/gi, (entity, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    if (point < 32 || (point >= 127 && point <= 159) || (point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff) return entity
    return String.fromCodePoint(point)
  })
}
