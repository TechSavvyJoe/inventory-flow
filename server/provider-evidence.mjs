// Portable, allow-listed read-only observations. No source connection or write path.
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const STATES = new Set(['current', 'stale_unverified', 'incomplete', 'unknown'])
const CONTROL = /[\x00-\x1f\x7f]/
// Public service descriptions use complete mechanical phrases, never arbitrary
// prose with a blacklist. A recognized fact followed by attribution still fails.
// The synthetic prefix is accepted only with the same complete phrase grammar.
const SERVICE_COMPONENT = '(?:(?:front|rear)\\s+)?(?:brakes?|brake\\s+(?:pads?|rotors?|discs?|calipers?|lines?|fluid)|tires?|wheels?|transmission(?:\\s+(?:fluid|filter))?|engine\\s+mounts?|(?:engine|motor)\\s+oil|(?:cabin\\s+air|air|fuel|oil)\\s+filters?|battery|spark\\s+plugs?|(?:timing|drive|serpentine)\\s+belt|water\\s+pump|alternator|coolant|differential(?:\\s+fluid)?|fuel\\s+system|cooling\\s+system|steering|suspension|exhaust)'
const SERVICE_MECHANICAL = [
  `${SERVICE_COMPONENT}\\s+(?:replaced|changed|serviced|inspected|checked|tested|adjusted|flushed|repaired|installed|cleaned|lubricated)`,
  '(?:oil|engine\\s+oil)\\s*(?:(?:and|&|/)\\s*(?:oil\\s+)?filter)\\s+(?:changed|service|serviced)',
  '(?:vehicle\\s+)?(?:serviced(?:\\s+or\\s+inspected)?|inspected|road\\s+tested)',
  '(?:(?:multiple\\s+point|multi[ -]point)\\s+(?:vehicle\\s+)?|certified\\s+pre[ -]owned\\s+|pre[ -]purchase\\s+|used[ -]car\\s+|safety\\s+|maintenance\\s+|brake\\s+|tire\\s+|emissions\\s+)?inspection(?:/service|\\s+(?:performed|completed))?',
  'tires?\\s+(?:rotated|balanced|rotation)',
  '(?:wheel\\s+)?alignment\\s+(?:performed|checked|adjusted)',
  'pickup\\s+truck\\s+fuel\\s+filter\\s+replaced',
  '(?:manufacturer\\s+recommended\\s+)?maintenance\\s+(?:performed|service)',
  '\\d{1,3}(?:,\\d{3})?[ -]mile\\s+service\\s+performed',
  '(?:0|5|10|15|20)W-(?:20|30|40|50|60)\\s+engine\\s+oil\\s+installed',
].map(phrase => new RegExp(`^(?:synthetic\\s+)?(?:${phrase})$`, 'i'))
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
  ensure(SERVICE_MECHANICAL.some(pattern => pattern.test(result)), 'service must describe mechanical work without customer, contact, collection, or address narratives')
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
      ensure(Array.isArray(entry.services) && entry.services.length >= 1 && entry.services.length <= 12, 'services must contain 1 to 12 mechanical descriptions')
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
