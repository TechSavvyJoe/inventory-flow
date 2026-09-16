const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function formatMoney(value) { return finite(value) ? money.format(value) : '—' }
export function formatMileage(value) { return finite(value) ? `${integer.format(value)} mi` : '—' }
export function formatNumber(value) { return finite(value) ? integer.format(value) : '—' }
export function formatReferencePrice(value) {
  return finite(value) ? money.format(value) : '—'
}
export function formatDays(value) {
  if (!finite(value)) return null
  return value === 1 ? '1 day' : `${integer.format(value)} days`
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

// A calendar date ("2026-08-31" — hold expectations, delivery dates) has no
// time zone. Parsing it with `new Date` lands on UTC midnight, which every US
// zone renders as the day before; it is rendered in UTC instead so the day
// the source wrote is the day shown.
function parseDate(value) {
  if (!value) return null
  const dateOnly = DATE_ONLY.exec(String(value).trim())
  if (dateOnly) return { date: new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3])), dateOnly: true }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false }
}

/** "Aug 30" within the current year; "Mar 14, 2024" for any other year, so warranty and in-service dates are never ambiguous. */
export function formatDate(value, now = Date.now()) {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  const year = parsed.dateOnly ? parsed.date.getUTCFullYear() : parsed.date.getFullYear()
  const sameYear = year === new Date(now).getFullYear()
  return parsed.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...(parsed.dateOnly ? { timeZone: 'UTC' } : {}) })
}

export function formatDateTime(value) {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  if (parsed.dateOnly) return formatDate(value)
  return parsed.date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatRelative(value, now = Date.now()) {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  const date = parsed.date
  const seconds = Math.round((now - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return formatDate(date)
}

export function formatReportDate(value) {
  // Report dates are calendar days; render them in a fixed zone so "Aug 30"
  // never shifts to Aug 29 for a user west of the source.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  if (!match) return '—'
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Original document prices keep their own currency; they are never converted. */
export function formatStickerMoney(value, sticker = {}) {
  if (!finite(value)) return '—'
  const currency = String(sticker.pricingCurrency ?? '').trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(value)
  }
  return `${integer.format(value)} (original sticker currency; verify)`
}

export function joinFacts(parts, separator = ' · ') {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '' && part !== '—').join(separator)
}
