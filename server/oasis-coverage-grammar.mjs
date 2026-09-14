// Portable, fail-closed grammar for the small subset of Ford OASIS text that
// Inventory Flow is allowed to publish. Keep this module free of Node-only
// dependencies: the Cloudflare Worker imports the same rules as the importer.

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
const DASH_DATE = new RegExp(`^(0?[1-9]|[12]\\d|3[01])-(${MONTH})-(\\d{4})$`, 'i')
const SLASH_DATE = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4})$/
const MONTH_NUMBER = Object.freeze({ jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 })

const FACTORY_COVERAGE_TYPES = new Set([
  'bumper-to-bumper',
  'corrosion perforation',
  'diesel engine',
  'electric vehicle component',
  'emissions',
  'hybrid - unique components',
  'powertrain',
  'safety restraint',
])

// These tokens identify plan/owner material, not factory-warranty terms. Bare
// "customer" is deliberately absent because an FSA can legitimately be named
// "Customer Satisfaction Program".
const FOREIGN_PLAN_OR_IDENTITY = /(?:\b(?:ford\s+protect|premiumcare|extracare|basecare|powertraincare|extended\s+service\s+plan|service\s+contract|deductible)\b|\besp\b|\b(?:owner(?:'s)?|customer|purchaser|contract\s+holder|holder|sold\s+to)\s*(?:name)?\s*[:#]\s*\S)/i

const FACTORY_TERM = /^(?:[1-9]\d{0,2}\s+(?:years?|months?)\s*\/\s*(?:unlimited\s+(?:miles|kilometres|kilometers)|[1-9]\d{0,2}(?:,\d{3})*\s+(?:miles|kilometres|kilometers))(?:\s+\(whichever\s+occurs\s+first\))?|varies\s+by\s+vehicle\s+and\s+state)$/i

export function isOasisDate(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  const dash = DASH_DATE.exec(value)
  const slash = SLASH_DATE.exec(value)
  const day = Number(dash?.[1] ?? slash?.[2])
  const month = dash ? MONTH_NUMBER[dash[2].toLowerCase()] : Number(slash?.[1])
  const year = Number(dash?.[3] ?? slash?.[3])
  if (!day || !month || !year) return false
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function containsForeignOasisText(value) {
  return typeof value === 'string' && FOREIGN_PLAN_OR_IDENTITY.test(value)
}

export function factoryCoverageType(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= 60 && FACTORY_COVERAGE_TYPES.has(text.toLowerCase()) && !containsForeignOasisText(text)
    ? text
    : null
}

// Return the source text unchanged only when it is a complete factory-term
// sentence. Callers compare the return value to the input so hidden leading or
// trailing text cannot be silently normalized into an accepted value.
export function factoryTermText(value) {
  if (typeof value !== 'string' || value.length > 120 || value !== value.trim()) return null
  return value && FACTORY_TERM.test(value) && !containsForeignOasisText(value) ? value : null
}

export function isFactoryCoverageRow(type, termText) {
  return factoryCoverageType(type) !== null && factoryTermText(termText) !== null
}
