const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function formatMoney(value) { return finite(value) ? money.format(value) : '—' }
export function formatMileage(value) { return finite(value) ? `${integer.format(value)} mi` : '—' }
export function formatNumber(value) { return finite(value) ? integer.format(value) : '—' }
export function formatDays(value) {
  if (!finite(value)) return null
  return value === 1 ? '1 day' : `${integer.format(value)} days`
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value) {
  const date = parseDate(value)
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
}

export function formatDateTime(value) {
  const date = parseDate(value)
  return date ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
}

export function formatRelative(value, now = Date.now()) {
  const date = parseDate(value)
  if (!date) return '—'
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

export function joinFacts(parts, separator = ' · ') {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '' && part !== '—').join(separator)
}
