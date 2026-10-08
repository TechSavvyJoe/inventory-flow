// Portable, allow-listed read-only observations. No source connection or write path.
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const STATES = new Set(['current', 'stale_unverified', 'incomplete', 'unknown'])
const CONTROL = /[\x00-\x1f\x7f]/
// These exclusions catch recognizable private narratives; they are not a universal name detector.
const SERVICE_PRIVATE_NARRATIVE = /\b(?:customer|owner|salesperson|contact|client|buyer|seller)\b|\b(?:vehicle|car|unit)\s+(?:was\s+)?(?:collected|delivered|picked\s+up)\b|\b(?:pick[ -]?up|collection|delivery)\s+(?:at|to|from|by|arranged|requested)\b|\b(?:collected|delivered)\s+(?:at|to|from|by)\b/i
const SERVICE_ADDRESS = /\b\d{1,6}[a-z]?\s+(?:[a-z][a-z.'-]*\s+){1,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|terrace|ter|highway|hwy)\b/i
const CONTACT = /@|https?:\/\/|www\.|\b(?:owner|customer)\s*(?:name|id|:)|(?:\+?\d[\s().-]*){7,}/i
function ensure(condition, message) { if (!condition) throw new Error(`Invalid provider evidence: ${message}`) }
function keys(value, allowed, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be an object`)
  ensure(Object.keys(value).every(key => allowed.includes(key)), `${label} contains unsupported fields`)
}
function text(value, max, label) {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROL.test(value) && !CONTACT.test(value), `${label} must be bounded public text`)
  return value.trim()
}
function serviceText(value) {
  const result = text(value, 240, 'service')
  ensure(!SERVICE_PRIVATE_NARRATIVE.test(result) && !SERVICE_ADDRESS.test(result), 'service must describe mechanical work without customer, contact, collection, or address narratives')
  return result
}
function timestamp(value) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10), 'capturedAt must be a strict ISO timestamp')
  return value
}

function common(value, vin) {
  ensure(typeof vin === 'string' && VIN.test(vin) && value.vin === vin, 'record VIN must exactly match its canonical parent VIN')
  ensure(STATES.has(value.dataState), 'dataState is invalid')
  return { vin, provider: value.provider, sourceLabel: text(value.sourceLabel, 100, 'sourceLabel'), capturedAt: timestamp(value.capturedAt), dataState: value.dataState }
}
export function validateOperationalEvidence(value, vin) {
  keys(value, ['records'], 'operationalEvidence')
  ensure(Array.isArray(value.records) && value.records.length <= 12, 'records must be a bounded array')
  const providers = new Set()
  return { records: value.records.map(record => {
    keys(record, ['vin', 'provider', 'sourceLabel', 'capturedAt', 'dataState', 'readOnly', 'complete', 'holdState', 'reportedDisposition'], 'operational record')
    ensure(typeof record.provider === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(record.provider) && record.provider.length <= 40, 'provider must be a bounded slug')
    ensure(record.provider !== 'legacy-dealermail', 'legacy-dealermail is reserved for internal legacy evidence')
    ensure(!providers.has(record.provider), 'operational providers must be unique'); providers.add(record.provider)
    const result = common(record, vin)
    ensure(record.readOnly === true && typeof record.complete === 'boolean', 'observation must be read-only with explicit completeness')
    ensure(['held', 'not_observed', 'unknown'].includes(record.holdState), 'holdState is invalid')
    ensure(record.holdState !== 'not_observed' || (record.complete && record.dataState === 'current'), 'not_observed requires a current complete observation')
    if (record.reportedDisposition !== undefined) {
      ensure(['sold_pending', 'delivered', 'other', 'not_observed', 'unknown'].includes(record.reportedDisposition), 'reportedDisposition is invalid')
      ensure(record.reportedDisposition !== 'not_observed' || (record.complete && record.dataState === 'current'), 'disposition not_observed requires a current complete observation')
      result.reportedDisposition = record.reportedDisposition
    }
    return { ...result, readOnly: true, complete: record.complete, holdState: record.holdState }
  }) }
}
export function validateServiceHistoryEvidence(value, vin) {
  keys(value, ['reports'], 'serviceHistory')
  ensure(Array.isArray(value.reports) && value.reports.length <= 12, 'reports must be a bounded array')
  const reports = new Set()
  return { reports: value.reports.map(report => {
    keys(report, ['vin', 'provider', 'sourceLabel', 'capturedAt', 'dataState', 'historyStatus', 'entries'], 'service report')
    ensure(['oem', 'autocheck', 'carfax'].includes(report.provider), 'service provider is invalid')
    const result = common(report, vin)
    const identity = `${result.provider}:${result.sourceLabel.toLowerCase()}`
    ensure(!reports.has(identity), 'service reports must be unique'); reports.add(identity)
    ensure(['reported', 'not_reported', 'unavailable'].includes(report.historyStatus), 'historyStatus is invalid')
    ensure(Array.isArray(report.entries) && report.entries.length <= 250 && (report.historyStatus === 'reported' ? report.entries.length > 0 : report.entries.length === 0), 'service entries contradict historyStatus or exceed the limit')
    return { ...result, historyStatus: report.historyStatus, entries: report.entries.map(entry => {
      keys(entry, ['date', 'odometer', 'odometerUnit', 'services'], 'service entry')
      ensure(typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(Date.parse(`${entry.date}T00:00:00Z`)) && new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) === entry.date, 'service date is invalid')
      ensure(Array.isArray(entry.services) && entry.services.length <= 12, 'services must be a bounded array')
      const out = { date: entry.date, services: entry.services.map(serviceText) }
      if (entry.odometer !== undefined) {
        ensure(entry.odometer === null || (Number.isSafeInteger(entry.odometer) && entry.odometer >= 0 && entry.odometer <= 20_000_000), 'odometer is invalid')
        out.odometer = entry.odometer
      }
      if (entry.odometerUnit !== undefined) { ensure(['mi', 'km'].includes(entry.odometerUnit), 'odometerUnit is invalid'); out.odometerUnit = entry.odometerUnit }
      return out
    }) }
  }) }
}
