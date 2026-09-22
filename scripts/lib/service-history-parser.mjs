import { stripTags } from './cdp.mjs'
import { containsForeignOasisText } from '../../server/oasis-coverage-grammar.mjs'

const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/i
const DATE_PATTERN = /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4}$/

function decodeHtml(value) {
  return stripTags(String(value || ''))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

function rowsFrom(tableHtml) {
  return [...String(tableHtml || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeHtml(cell[1])),
  )
}

function tablesFrom(html) {
  return [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => match[0])
}

function integer(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '')
  if (!digits) return null
  const number = Number(digits)
  return Number.isSafeInteger(number) && number >= 0 && number <= 20_000_000 ? number : null
}

function bounded(value, max) {
  const text = decodeHtml(value)
  return text ? text.slice(0, max) : null
}

function normalizedDate(value) {
  const text = bounded(value, 20)
  return text && DATE_PATTERN.test(text) ? text : null
}

function dateValue(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? Number(`${match[3]}${match[1].padStart(2, '0')}${match[2].padStart(2, '0')}`) : 0
}

function normalizedRepairOrder(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits && digits.length <= 24 ? digits : null
}

function containsPrivateServiceText(value) {
  return containsForeignOasisText(value) || /\b(?:customer|owner|contact|phone|email|single thread|do not contact|claim number|policy number)\b/i.test(String(value || ''))
}

export function repairOrderFingerprint(order) {
  return [order?.repairOrderNumber, order?.openDate, order?.closeDate, order?.odometer ?? ''].join('|')
}

export function parseServiceHistoryIndex(html, expectedVin) {
  const source = String(html || '')
  if (/login\.microsoftonline\.com|type=["']?password/i.test(source)) return { state: 'session_expired' }
  const printedVin = source.match(VIN_PATTERN)?.[0]?.toUpperCase() ?? null
  // Ford's genuine empty-state page says "No data found" but omits the VIN
  // from the response body. The caller still binds the request/final URL to the
  // expected VIN; a page containing any different VIN remains a hard mismatch.
  if (!printedVin && /Retail Service Repair History/i.test(source) && /No data found/i.test(source)) {
    return { state: 'ok', repairOrders: [] }
  }
  if (!printedVin || printedVin !== String(expectedVin || '').toUpperCase()) return { state: 'vin_mismatch' }

  const table = tablesFrom(source).find((candidate) =>
    /Repair Order Number/i.test(candidate) && /Repair Order Open Date/i.test(candidate) && /Odometer/i.test(candidate),
  )
  if (!table) return { state: /Retail Service Repair History/i.test(source) ? 'ok' : 'unparsed', repairOrders: [] }
  const rows = rowsFrom(table)
  const header = rows.find((row) => row.some((cell) => /Repair Order Number/i.test(cell))) ?? []
  const column = (pattern) => header.findIndex((cell) => pattern.test(cell))
  const dealerIndex = column(/^Dealer Code$/i)
  const numberIndex = column(/^Repair Order Number$/i)
  const openIndex = column(/^Repair Order Open Date$/i)
  const closeIndex = column(/^Repair Order Close Date$/i)
  const odometerIndex = column(/^Odometer$/i)
  if ([dealerIndex, numberIndex, openIndex, closeIndex, odometerIndex].some((index) => index < 0)) {
    return { state: 'unparsed', repairOrders: [] }
  }
  const seen = new Set()
  const repairOrders = rows.flatMap((row) => {
    const repairOrderNumber = normalizedRepairOrder(row[numberIndex])
    const openDate = normalizedDate(row[openIndex])
    const closeDate = normalizedDate(row[closeIndex])
    const dealerCode = bounded(row[dealerIndex], 12)
    if (!repairOrderNumber || !openDate || !closeDate || !dealerCode || seen.has(repairOrderNumber)) return []
    seen.add(repairOrderNumber)
    return [{
      repairOrderNumber,
      dealerCode,
      openDate,
      closeDate,
      odometer: integer(row[odometerIndex]),
    }]
  }).sort((a, b) => dateValue(b.closeDate) - dateValue(a.closeDate) || dateValue(b.openDate) - dateValue(a.openDate))
  return { state: 'ok', repairOrders }
}

function tableWithHeader(html, pattern) {
  const table = tablesFrom(html).find((candidate) => pattern.test(decodeHtml(candidate)))
  if (!table) return { header: [], rows: [] }
  const rows = rowsFrom(table)
  return { header: rows[0] ?? [], rows: rows.slice(1) }
}

function inspectionFrom(laborOperations) {
  const text = laborOperations.map((item) => `${item.code} ${item.description}`).join(' ').toUpperCase()
  if (/\bCPOUCI\b|CERTIFIED BLUE OVAL/.test(text)) return { status: 'confirmed', type: 'Certified Blue Oval inspection' }
  if (/USED[ -]CAR INSPECTION|\bUCI CAR INSPECTION\b|\bUCC\b/.test(text)) return { status: 'confirmed', type: 'Used-car inspection' }
  if (/MULTI[ -]?POINT INSPECTION|\bMPI\b/.test(text)) return { status: 'confirmed', type: 'Multi-point inspection' }
  return { status: 'not_identified' }
}

export function serviceCategories({ parts, laborOperations, inspection }) {
  const safeParts = Array.isArray(parts) ? parts : []
  const safeLaborOperations = Array.isArray(laborOperations) ? laborOperations : []
  const text = [...safeParts.map((item) => item.description), ...safeLaborOperations.map((item) => item.description)].join(' ').toUpperCase()
  const services = []
  if (inspection?.status === 'confirmed' && inspection.type) services.push(inspection.type)
  if (/\bOIL\s*(?:FILTER|CHANGE|SERVICE)\b|\bFILTER\s+ASY\s*-\s*OIL\b|\b(?:MOTORCRAFT|SAE)\s+(?:0W|5W|10W)[- ]?\d+\b|\bENGINE OIL\b/.test(text)) services.push('Oil and filter service')
  if (/AIR CLEANER|ENGINE AIR FILTER/.test(text)) services.push('Engine air filter')
  if (/ODOUR|ODOR|CABIN|PARTICLES/.test(text)) services.push('Cabin air filter')
  if (/WIPER|WASHER BLADE/.test(text)) services.push('Wiper blades')
  if (/BRAKE/.test(text)) services.push('Brake inspection/service')
  if (/TIRE/.test(text)) services.push('Tire inspection/service')
  if (/BATTERY/.test(text)) services.push('Battery service')
  if (/ALIGNMENT/.test(text)) services.push('Wheel alignment')
  if (/WHEEL\s+(?:HUB|BEARING)|HUB\s+(?:ASY|ASSY)|\bAXLE\b|CV JOINT/.test(text)) services.push('Wheel hub / axle repair')
  if (/SHOCK|STRUT|CONTROL ARM|BALL JOINT|SWAY BAR|SUSPENSION/.test(text)) services.push('Suspension service')
  if (/STARTER|ALTERNATOR/.test(text)) services.push('Starting / charging system repair')
  if (/CAM(?:SHAFT)?|TIMING (?:CHAIN|BELT)|VALVE|CRANK(?:SHAFT)?|PISTON|CYLINDER|INTAKE MANIFOLD|OIL PAN|ENGINE REPAIR|LONG BLOCK|SHORT BLOCK/.test(text)) services.push('Engine repair')
  if (/WATER PUMP|COOLANT|RADIATOR|THERMOSTAT|ANTI[- ]?FREEZE/.test(text)) services.push('Cooling system service')
  if (/TRANSMISSION|TRANSAXLE/.test(text)) services.push('Transmission service')
  if (/FUEL PUMP|FUEL INJECTOR|INJECTOR ASY|FUEL SYSTEM/.test(text)) services.push('Fuel system service')
  if (/SPARK PLUG|IGNITION COIL/.test(text)) services.push('Ignition system service')
  if (/CATALYTIC|EXHAUST/.test(text)) services.push('Exhaust system service')
  if (/AIR CONDITION|A\/C|HVAC|EVAPORATOR|CONDENSER/.test(text)) services.push('Climate-control service')
  if (/\bIDS\b|SELF TEST|DIAGNOSTIC|DTC|CODE/.test(text)) services.push('Diagnostic self-test')
  if (/COOLANT|TRANSMISSION FLUID|BRAKE FLUID|POWER STEERING FLUID/.test(text)) services.push('Fluid service')
  return [...new Set(services)].slice(0, 20)
}

export function summarizeRepairOrder(order) {
  const services = serviceCategories(order)
  if (services.length) return `${services.join('; ')}.`
  if (order.laborOperations.length) return `${order.laborOperations.slice(0, 3).map((item) => item.description).join('; ')}.`
  if (order.parts.length) return `Parts recorded: ${order.parts.slice(0, 4).map((item) => item.description).join(', ')}.`
  return 'Ford reported this visit without itemized work.'
}

// PTS detail rows can occasionally contain customer-labelled free text. Keep
// the immutable source capture out of the release path by dropping only those
// unsafe part/labor descriptions, then deriving every downstream field from
// the remaining allow-listed vehicle-service facts. This also sanitizes cached
// detail rows from an earlier run before they are reused.
export function sanitizeServiceHistoryRepairOrder(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return order
  const parts = Array.isArray(order.parts)
    ? order.parts.flatMap((part) => {
        const description = bounded(part?.description, 300)
        if (!description || /^prefix$/i.test(description) || containsPrivateServiceText(description)) return []
        const quantity = Number.isSafeInteger(part?.quantity) ? part.quantity : null
        const partNumber = bounded(part?.partNumber, 120)
        return [{ description, ...(quantity != null ? { quantity } : {}), ...(partNumber ? { partNumber } : {}) }]
      }).slice(0, 80)
    : []
  const laborOperations = Array.isArray(order.laborOperations)
    ? order.laborOperations.flatMap((operation) => {
        const code = bounded(operation?.code, 40)
        const description = bounded(operation?.description, 500)
        if (!code || !description || containsPrivateServiceText(description)) return []
        return [{ code, description }]
      }).slice(0, 80)
    : []
  const sanitized = { ...order, parts, laborOperations }
  sanitized.inspection = inspectionFrom(laborOperations)
  sanitized.services = serviceCategories(sanitized)
  sanitized.summary = summarizeRepairOrder(sanitized)
  return sanitized
}

export function parseServiceHistoryDetails(html, expectedOrder) {
  const source = String(html || '')
  if (/login\.microsoftonline\.com|type=["']?password/i.test(source)) return { state: 'session_expired' }
  const repairOrderNumber = normalizedRepairOrder(source.match(/Repair Order:\s*<[^>]*>?\s*([0-9]+)/i)?.[1]
    ?? decodeHtml(source).match(/Repair Order:\s*([0-9]+)/i)?.[1])
  if (!repairOrderNumber || repairOrderNumber !== expectedOrder.repairOrderNumber) return { state: 'order_mismatch' }

  const plain = decodeHtml(source)
  const openDate = normalizedDate(plain.match(/Repair Order Open Date:\s*([^\s]+)/i)?.[1])
  const closeDate = normalizedDate(plain.match(/Repair Order Close Date:\s*([^\s]+)/i)?.[1])
  if (openDate !== expectedOrder.openDate || closeDate !== expectedOrder.closeDate) return { state: 'order_mismatch' }

  const partTable = tableWithHeader(source, /Part Description/i)
  const partColumns = Object.fromEntries(partTable.header.map((cell, index) => [cell.toLowerCase(), index]))
  const parts = partTable.rows.flatMap((row) => {
    const description = bounded(row[partColumns['part description']], 300)
    if (!description || /no (?:parts|records)/i.test(description)) return []
    const quantity = integer(row[partColumns.quantity])
    const partNumber = ['prefix', 'base', 'suffix'].map((key) => bounded(row[partColumns[key]], 40)).filter(Boolean).join('-') || null
    return [{ description, ...(quantity != null ? { quantity } : {}), ...(partNumber ? { partNumber } : {}) }]
  }).slice(0, 80)

  const laborTable = tableWithHeader(source, /Labor Operation Code Description/i)
  const laborColumns = Object.fromEntries(laborTable.header.map((cell, index) => [cell.toLowerCase(), index]))
  const laborOperations = laborTable.rows.flatMap((row) => {
    const code = bounded(row[laborColumns['labor operation code']], 40)
    const description = bounded(row[laborColumns['labor operation code description']], 500)
    return code && description ? [{ code, description }] : []
  }).slice(0, 80)

  const result = sanitizeServiceHistoryRepairOrder({
    ...expectedOrder,
    parts,
    laborOperations,
    detailComplete: true,
  })
  return { state: 'ok', repairOrder: result }
}
