const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function formatMoney(value) { return finite(value) ? money.format(value) : '—' }
export function formatMileage(value) { return finite(value) ? `${integer.format(value)} mi` : '—' }
export function formatNumber(value) { return finite(value) ? integer.format(value) : '—' }
/** Equipment-label prices stay compact when the source does not name a currency. */
export function formatReferencePrice(value) {
  return finite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(value) : '—'
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
  const raw = String(value).trim()
  const iso = DATE_ONLY.exec(raw)
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw)
  const oasis = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})$/.exec(raw)
  const written = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw)
  if (iso || us || oasis || written) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    const monthName = (oasis?.[2] ?? written?.[1] ?? '').toLowerCase()
    const year = Number(iso?.[1] ?? us?.[3] ?? oasis?.[3] ?? written?.[3])
    const month = iso ? Number(iso[2]) : us ? Number(us[1]) : months.findIndex(name => monthName === name || monthName === name.slice(0, 3) || (name === 'september' && monthName === 'sept')) + 1
    const day = Number(iso?.[3] ?? us?.[2] ?? oasis?.[1] ?? written?.[2])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return { date, dateOnly: true }
  }
  const timestampDate = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(raw)
  if (timestampDate && !parseDate(timestampDate[1])) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false }
}

/** Display calendar dates consistently, including the full year. */
export function formatDate(value, now = Date.now()) {
  void now
  const parsed = parseDate(value)
  if (!parsed) return '—'
  return parsed.date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', ...(parsed.dateOnly ? { timeZone: 'UTC' } : {}) })
}

/** Preserve source qualifiers around a printed date, including unknown text. */
export function formatSourceDateText(value) {
  return String(value ?? '').replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3,9}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4})\b/g, token => {
    const formatted = formatDate(token)
    return formatted === '—' ? token : formatted
  })
}

export function formatDateTime(value) {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  if (parsed.dateOnly) return formatDate(value)
  return parsed.date.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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
  // Report dates are source calendar days, independent of browser timezone.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''))
  return match ? formatDate(match[1]) : '—'
}

/** Original document prices keep their own currency; they are never converted. */
export function formatStickerMoney(value, sticker = {}) {
  if (!finite(value)) return '—'
  const currency = String(sticker.pricingCurrency ?? '').trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code', minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(value)
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(value)
}

export function joinFacts(parts, separator = ' · ') {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '' && part !== '—').join(separator)
}
