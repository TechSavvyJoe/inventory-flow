import { stripTags } from './cdp.mjs'

/** Missing or incomplete action evidence must never become an observed zero. */
export function parseOasisActions(text) {
  const result = { openFieldServiceActions: [], openActionsCaptured: false, openFieldServiceActionCount: null }
  const heading = /OUTSTANDING FIELD SERVICE ACTIONS\s*:?/i.exec(text)
  if (!heading) return result
  const remainder = text.slice(heading.index + heading[0].length)
  const boundary = /NO WARNING MESSAGES|GENERAL WARRANTY INFORMATION|WARRANTY COVERAGE|End of OASIS report/i.exec(remainder)
  const block = remainder.slice(0, boundary ? boundary.index : remainder.length).trim()
  if (/^NO CAMPAIGN MESSAGE\(S\) FOUND[.!]?$/i.test(block)) {
    return { ...result, openActionsCaptured: true, openFieldServiceActionCount: 0 }
  }
  const codes = [...block.matchAll(/\b\d{2}[A-Z]\d{2,3}\b/g)]
  let complete = Boolean(boundary) && block.length <= 20000 && codes.length > 0 && codes.length <= 60
  const prefix = block.slice(0, codes[0]?.index ?? block.length).trim()
  if (prefix && !/^(?:FSA|CAMPAIGN)\s+(?:NUMBER|CODE)\s+(?:DESCRIPTION|TITLE)$/i.test(prefix)) complete = false
  const seen = new Set()
  for (let index = 0; index < codes.length && index < 60; index++) {
    const code = codes[index][0]
    const description = block.slice(codes[index].index + code.length, codes[index + 1]?.index ?? block.length).replace(/\s+/g, ' ').trim()
    if (seen.has(code) || !description || description.length > 300 || /\b\d{2}[A-Z][A-Z0-9?]{2,}(?=\s|$)/.test(description)) complete = false
    if (seen.has(code)) continue
    seen.add(code)
    result.openFieldServiceActions.push({ code, description: description.slice(0, 300) })
  }
  result.openActionsCaptured = complete
  result.openFieldServiceActionCount = complete ? result.openFieldServiceActions.length : null
  return result
}

export function parseOasisFull(html) {
  const text = stripTags(html)
  if (!/OASIS RESULT/i.test(text)) return null
  // Once tags are stripped, a value runs straight into the next label
  // ("...SERIES 10 PAINT COLOR: ..."). A lookahead for "next ALL-CAPS run + colon"
  // does NOT work: the caps class has to allow spaces, so it bridges across the
  // value and matches a colon much further on, truncating "2022 F-SUPER DUTY" to
  // "2022". Instead scan for the known labels, then take each value as the text
  // between its own colon and the start of the next label. Deterministic, and it
  // also avoids the "AXLE CODE:8L" artifact seen in earlier hand-run captures.
  const LABELS = [
    'VEHICLE DESCRIPTION', 'VERSION/SERIES', 'PAINT COLOR', 'PAINT CODE', 'BODY STYLE',
    'DRIVE TYPE', 'ENGINE CALIBRATION', 'ENGINE', 'AXLE RATIO', 'AXLE CODE',
    'GROSS VEHICLE WEIGHT', 'RADIO', 'TRANSMISSION', 'WHEEL SIZE', 'SYNC VERSION',
    'FUEL TYPE', 'TIRE', 'VHR ACTIVATED', 'MODEM', 'MONTHS IN SERVICE',
    'WARRANTY START DATE', 'BUILD DATE', 'RELEASE DATE', 'SALE MILEAGE',
    'WARRANTY COVERAGE', 'COVERAGE TYPE', 'COVERAGE DESCRIPTION', 'ADDITIONAL INFO',
    'EXTENDED COVERAGES', 'MARKETING MESSAGES', 'OUTSTANDING FIELD SERVICE ACTIONS',
    'GENERAL WARRANTY INFORMATION', 'WARRANTY REPAIR HISTORY', 'VEHICLE STATUS',
    'ODOMETER', 'FUEL LEVEL', 'OASIS RESULT', 'OASIS RESULTS', 'VIN',
  ]
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // longest first so ENGINE CALIBRATION wins over ENGINE
  const alt = [...LABELS].sort((a, b) => b.length - a.length).map(esc).join('|')
  const scanner = new RegExp('\\b(' + alt + ')\\s*:', 'gi')
  const marks = []
  let sm
  while ((sm = scanner.exec(text))) marks.push({ label: sm[1].toUpperCase(), start: sm.index, end: sm.index + sm[0].length })

  const field = label => {
    const want = label.toUpperCase()
    const i = marks.findIndex(m => m.label === want)
    if (i < 0) return ''
    const from = marks[i].end
    const to = i + 1 < marks.length ? marks[i + 1].start : text.length
    // Short uppercase values can be actual paint/axle/calibration codes. The
    // known-label boundaries already distinguish an absent value from a code.
    const v = text.slice(from, to).replace(/\s+/g, ' ').trim()
    return v.slice(0, 160)
  }
  const dated = label => {
    const v = field(label)
    const m = v.match(/([0-9]{1,2}-[A-Za-z]+-[0-9]{4})/)
    return m ? m[1] : ''
  }

  const coverages = []
  const seen = new Set()
  const block = text.slice(Math.max(0, text.search(/WARRANTY COVERAGE/i)))
  const re = /COVERAGE TYPE:\s*([^:]*?)\s*COVERAGE DESCRIPTION:\s*([\s\S]*?)(?=\s*ADDITIONAL INFO:|\s*COVERAGE TYPE:|\s*MARKETING MESSAGES|\s*EXTENDED COVERAGES|$)/gi
  let m
  while ((m = re.exec(block)) && coverages.length < 20) {
    const type = m[1].trim().slice(0, 120)
    if (!type) continue
    const key = type.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    coverages.push({ type, description: m[2].trim().slice(0, 300) })
  }

  // EXTENDED COVERAGES: categories + expiration dates ONLY. Never an owner name.
  const categories = [], expirations = []
  const ext = /EXTENDED COVERAGES([\s\S]{0,1500}?)(?:WARRANTY REPAIR HISTORY|End of OASIS report|$)/i.exec(text)
  if (ext && !/NO ESP INFORMATION AVAILABLE/i.test(ext[1])) {
    for (const d of (ext[1].match(/\d{1,2}-[A-Za-z]{3,}-\d{4}/g) || []).slice(0, 10)) expirations.push(d)
    for (const c of (ext[1].match(/\b(?:ESP|EXTRA CARE|PREMIUM CARE|BASE CARE|POWERTRAIN CARE|MAINTENANCE)\b[A-Z ]{0,30}/gi) || []).slice(0, 10)) {
      const v = c.trim().slice(0, 120)
      if (v && !categories.includes(v)) categories.push(v)
    }
  }

  const actionResult = parseOasisActions(text)

  const monthsRaw = (text.match(/MONTHS IN SERVICE:\s*(\d+)/i) || [])[1]
  const saleRaw = (text.match(/SALE MILEAGE:\s*([\d,]+)/i) || [])[1]

  return {
    vehicleDescription: field('VEHICLE DESCRIPTION'),
    versionSeries: field('VERSION/SERIES'),
    bodyStyle: field('BODY STYLE'),
    driveType: field('DRIVE TYPE'),
    paintColor: field('PAINT COLOR'),
    paintCode: field('PAINT CODE'),
    engine: field('ENGINE'),
    engineCalibration: field('ENGINE CALIBRATION'),
    transmission: field('TRANSMISSION'),
    axleRatio: field('AXLE RATIO'),
    axleCode: field('AXLE CODE'),
    grossVehicleWeight: field('GROSS VEHICLE WEIGHT'),
    wheelSize: field('WHEEL SIZE'),
    tire: field('TIRE'),
    syncVersion: field('SYNC VERSION'),
    fuelType: field('FUEL TYPE'),
    monthsInService: monthsRaw || '',
    warrantyStartDate: dated('WARRANTY START DATE'),
    buildDate: dated('BUILD DATE'),
    releaseDate: dated('RELEASE DATE'),
    saleMileage: saleRaw ? saleRaw.replace(/,/g, '') : '',
    ...actionResult,
    warrantyCoverages: coverages,
    extendedCoverageCategories: categories,
    extendedCoverageExpirations: expirations,
  }
}
