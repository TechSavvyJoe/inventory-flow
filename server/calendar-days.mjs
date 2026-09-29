/**
 * Calendar-day helpers shared by the service core and the Overview projection.
 * Every duration the app reports is a whole number of calendar days in the
 * release timezone, so nothing here depends on the minute of the clock.
 */

export function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** Whole days from start to end; clamps at 0 and returns null for non-YYYY-MM-DD input. */
export function daysBetween(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start ?? '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end ?? ''))) {
    return null
  }
  const startTime = Date.parse(`${start}T00:00:00Z`)
  const endTime = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
  return Math.max(0, Math.floor((endTime - startTime) / 86_400_000))
}

export function dateIsBeforeReport(value, reportDate) {
  if (!value || !reportDate) return false
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) && /^\d{4}-\d{2}-\d{2}$/.test(String(reportDate))) {
    return String(value) < String(reportDate)
  }
  const valueTime = Date.parse(String(value))
  const reportTime = Date.parse(`${reportDate}T00:00:00`)
  return Number.isFinite(valueTime) && Number.isFinite(reportTime) && valueTime < reportTime
}
