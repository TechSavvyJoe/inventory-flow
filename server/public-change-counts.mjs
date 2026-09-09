const CATEGORY_ALIASES = Object.freeze({
  new_arrival: ['new_arrival', 'New Arrival'],
  removed: ['removed', 'Removed'],
  price_change: ['price_change', 'Price Change'],
  mileage_change: ['mileage_change', 'Mileage Change'],
  website_status_change: ['website_status_change', 'Status Change', 'Website Status Change'],
  stock_correction: ['stock_correction', 'Stock Correction'],
  store_transfer: ['store_transfer', 'Store Transfer'],
})

function countValue(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value.trim())
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Read both certified report labels and the older app category keys without
 * changing the source manifest. Conflicting or ambiguous totals must never
 * authorize VIN-level conclusions.
 */
export function normalizePublicChangeCounts(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const counts = {}
  const issues = []
  const knownKeys = new Set(['VIN/Stock Correction'])
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    aliases.forEach((key) => knownKeys.add(key))
    const present = aliases.filter((key) => Object.prototype.hasOwnProperty.call(raw, key))
    const values = present.map((key) => countValue(raw[key]))
    const valid = values.every((item) => item !== null)
    const agree = new Set(values).size <= 1
    counts[category] = valid && agree ? (values[0] ?? 0) : null
    if (!valid) issues.push(`Invalid public change total for ${category}.`)
    else if (!agree) issues.push(`Conflicting public change totals for ${category}; category aliases disagree.`)
  }
  let combinedCorrectionCount = null
  if (Object.prototype.hasOwnProperty.call(raw, 'VIN/Stock Correction')) {
    combinedCorrectionCount = countValue(raw['VIN/Stock Correction'])
    if (combinedCorrectionCount === null) {
      issues.push('Invalid combined VIN/stock correction total.')
    } else if (combinedCorrectionCount > 0) {
      issues.push(`The combined VIN/stock correction total (${combinedCorrectionCount}) requires separate event types; stock-only changes were not inferred.`)
    } else if ((counts.stock_correction ?? 0) > 0) {
      issues.push('Conflicting public correction totals: the combined total is zero but stock corrections are positive.')
    }
  }
  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key) && countValue(raw[key]) !== 0) {
      issues.push(`Unsupported public change category: ${key}.`)
    }
  }
  return { counts, issues, combinedCorrectionCount }
}
