// capture-warranty.mjs — remaining factory warranty per VIN, at the vehicle's ACTUAL listed mileage.
//   node scripts/capture-warranty.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--vin VIN] [--refresh]
//
// TWO SOURCES, both read-only:
//   (1) Ford OASIS  (Ford/Lincoln only) - authoritative. Fetched through the already-authenticated
//       FMCDealer tab in the automation browser (CDP 127.0.0.1:9222), parsed server-side. Gives the
//       real WARRANTY START DATE (= in-service date), MONTHS IN SERVICE, and each coverage's printed
//       term ("3 years / 36,000 Miles (whichever occurs first)").
//   (2) AutoCheck   (every make) - Experian estimate. The dealer report page carries the whole
//       "Warranty Check" table in its HTML: data-warranty-age (months in service),
//       data-default-mileage, and per row data-warranty-miles / data-warranty-months.
//       The "Enter Mileage -> Show My Coverage" button is PURE CLIENT-SIDE ARITHMETIC
//       (recalculateWarrantyTable() in autocheck.com/reportservice/report/fullReport/js/main.js).
//       So we reproduce that exact function here against the vehicle's real listed odometer -
//       identical output to typing the mileage in by hand, with no browser and no clicking.
//
// Remaining time/miles are necessarily COMPUTED (term minus age/odometer). Every printed value -
// the term text, the warranty start date, the months in service - is carried through verbatim.
// PRIVACY: OASIS extended-service-plan blocks can carry prior-owner details.
// This script ignores that entire block and publishes only closed-vocabulary
// factory warranty rows plus FSA codes.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeOwnedTab, getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { factoryTermText, isFactoryCoverageRow, isOasisDate } from '../server/oasis-coverage-grammar.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const OASIS_ORIGIN = 'https://www.fordtechservice.dealerconnection.com'
const OASIS_URL = vin => `${OASIS_ORIGIN}/oasis/Index?vin=${vin}`
const FORD_MAKES = new Set(['FORD', 'LINCOLN'])
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

// ── shared warranty maths ────────────────────────────────────────────────────
// Mirrors parseWarrantyLimitValue() in AutoCheck's main.js.
export function parseLimit(raw) {
  const s = String(raw ?? '').trim()
  if (!s || /^(na|n\/a|-)$/i.test(s)) return { kind: 'na' }
  if (/unlimited|lifetime/i.test(s)) return { kind: 'unlimited' }
  const n = Number(s.replace(/[, ]/g, ''))
  return Number.isFinite(n) ? { kind: 'number', value: n } : { kind: 'na' }
}
const fmtMiles = n => `${Math.max(Math.floor(n), 0).toLocaleString('en-US')} miles left`
const fmtMonths = n => `${n} ${n === 1 ? 'month' : 'months'}`

// Mirrors recalculateWarrantyTable() exactly: same expiry rules, same wording.
export function remainingFor({ milesLimit, monthsLimit, currentMileage, currentAgeMonths }) {
  const out = { status: 'N/A', remainingMilesText: 'N/A', remainingTimeText: 'N/A' }
  if (milesLimit.kind === 'na' && monthsLimit.kind === 'na') return out
  const hasMiles = milesLimit.kind === 'number'
  const hasAge = monthsLimit.kind === 'number' && currentAgeMonths != null
  const remainingMiles = hasMiles ? milesLimit.value - currentMileage : null
  const mileageExpired = hasMiles && remainingMiles <= 0
  const ageExpired = hasAge && currentAgeMonths >= monthsLimit.value

  if (milesLimit.kind === 'unlimited' && monthsLimit.kind === 'unlimited') {
    return { status: 'ACTIVE', remainingMilesText: 'Unlimited miles left', remainingTimeText: 'Lifetime' }
  }
  if (mileageExpired || ageExpired) {
    return { status: 'EXPIRED', remainingMilesText: '-', remainingTimeText: '-' }
  }
  const activeByMiles = !hasMiles || remainingMiles > 0
  const activeByAge = !hasAge || currentAgeMonths <= monthsLimit.value
  if (!(activeByMiles && activeByAge)) {
    return { status: 'EXPIRED', remainingMilesText: '-', remainingTimeText: '-' }
  }
  const remainingMonths = hasAge ? Math.max(Math.floor(monthsLimit.value - currentAgeMonths), 0) : null
  return {
    status: 'ACTIVE',
    remainingMiles: hasMiles ? Math.max(Math.floor(remainingMiles), 0) : undefined,
    remainingMonths: remainingMonths ?? undefined,
    remainingMilesText: milesLimit.kind === 'unlimited' ? 'Unlimited miles left' : hasMiles ? fmtMiles(remainingMiles) : 'N/A',
    remainingTimeText: monthsLimit.kind === 'unlimited' ? 'Lifetime' : hasAge ? fmtMonths(remainingMonths) : 'N/A',
  }
}

// ── AutoCheck: parse the Warranty Check table straight out of the report HTML ──
// Nothing is clicked. The table ships with the term limits as data attributes; the
// on-page button only re-runs the arithmetic we reproduce in remainingFor().
const COVERAGE_NOTE_MAX = 160
export function parseAutoCheckWarranty(html, currentMileage) {
  const tableMatch = html.match(/<table[^>]*id="warrantyDetail"[\s\S]*?<\/table>/i)
  if (!tableMatch) return null
  const table = tableMatch[0]
  const ageRaw = (table.match(/data-warranty-age="([^"]*)"/i) || [])[1]
  const defaultMileageRaw = (table.match(/data-default-mileage="([^"]*)"/i) || [])[1]
  const ageLimit = parseLimit(ageRaw)
  const currentAgeMonths = ageLimit.kind === 'number' ? ageLimit.value : null

  const body = (table.match(/<tbody[\s\S]*?<\/tbody>/i) || [table])[0]
  const rows = body.match(/<tr[\s\S]*?<\/tr>/gi) || []
  const coverages = []
  const seen = new Set()
  for (const row of rows) {
    const milesRaw = (row.match(/data-warranty-miles="([^"]*)"/i) || [])[1]
    const monthsRaw = (row.match(/data-warranty-months="([^"]*)"/i) || [])[1]
    if (milesRaw === undefined && monthsRaw === undefined) continue
    const type = stripTagsLocal(((row.match(/warranty-coverage-label[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '')).replace(/\s+/g, ' ').trim()
    if (!type) continue
    const key = type.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // NB: this markup closes tags as "</span >" (with a space), so the close pattern must allow it.
    const termText = stripTagsLocal(((row.match(/class="coverage-details"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span\s*>/i) || [])[1] || '')).trim()
    const note = stripTagsLocal(((row.match(/warranty-footnote-text"[^>]*>([\s\S]*?)<\/span\s*>/i) || [])[1] || '')).trim()
    const milesLimit = parseLimit(milesRaw)
    const monthsLimit = parseLimit(monthsRaw)
    const calc = remainingFor({ milesLimit, monthsLimit, currentMileage, currentAgeMonths })
    const entry = { type: type.slice(0, 60), termText: (termText || 'Contact a certified dealer to verify coverage').slice(0, 80), ...calc }
    if (milesLimit.kind === 'number') entry.termMiles = milesLimit.value
    if (monthsLimit.kind === 'number') entry.termMonths = monthsLimit.value
    if (milesLimit.kind === 'unlimited') entry.unlimitedMiles = true
    if (monthsLimit.kind === 'unlimited') entry.unlimitedMonths = true
    if (note) entry.note = note.slice(0, COVERAGE_NOTE_MAX)
    coverages.push(entry)
  }
  if (!coverages.length) return null
  const out = { coverages: coverages.slice(0, 12) }
  if (currentAgeMonths != null) out.inServiceAgeMonths = currentAgeMonths
  const dm = parseLimit(defaultMileageRaw)
  if (dm.kind === 'number') out.defaultMileage = dm.value
  return out
}

function stripTagsLocal(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#x25B4;/g, ' ').replace(/&times;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// The AutoCheck page also prints the estimated in-service date used for the age figure.
export function parseAutoCheckInServiceDate(html) {
  const text = stripTagsLocal(html)
  const m = text.match(/estimated in service(?: date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i)
  return m ? m[1].trim().slice(0, 40) : null
}

// ── Ford OASIS: warranty start date, months in service, printed coverage terms ──
// "3 years / 36,000 Miles (whichever occurs first)" -> 36 months / 36000 miles.
export function termFromOasisDescription(description) {
  const d = String(description || '')
  const out = {}
  const years = d.match(/(\d+)\s*years?/i)
  const months = d.match(/(\d+)\s*months?/i)
  if (years) out.termMonths = Number(years[1]) * 12
  else if (months) out.termMonths = Number(months[1])
  if (/unlimited\s*miles/i.test(d)) out.unlimitedMiles = true
  else {
    const miles = d.match(/([\d,]{3,})\s*miles/i)
    if (miles) out.termMiles = Number(miles[1].replace(/,/g, ''))
  }
  return out
}

function responseMentionsVin(text, expectedVin) {
  const vin = String(expectedVin || '').trim().toUpperCase()
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) && String(text || '').toUpperCase().includes(vin)
}

export function parseOasis(html, expectedVin) {
  const text = stripTagsLocal(html)
  if (!/OASIS RESULT/i.test(text) || !responseMentionsVin(text, expectedVin)) return null
  const warrantyStartDate = (text.match(/WARRANTY START DATE:\s*((?:0?[1-9]|[12]\d|3[01])-(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)-\d{4})/i) || [])[1] || ''
  const monthsRaw = (text.match(/MONTHS IN SERVICE:\s*(\d+)/i) || [])[1]
  const saleMileageRaw = (text.match(/SALE MILEAGE:\s*([\d,]+)/i) || [])[1]

  const coverages = []
  const seen = new Set()
  let coverageCandidates = 0
  const coverageStart = text.search(/WARRANTY COVERAGE/i)
  if (coverageStart < 0) return null
  const coverageTail = text.slice(coverageStart)
  const coverageBoundary = coverageTail.search(/\b(?:EXTENDED COVERAGES|WARRANTY REPAIR HISTORY|MARKETING MESSAGES)\b/i)
  // Stop before OASIS's separate extended-plan section. Searching one global
  // regex across the remainder of the page would otherwise allow a plan row
  // whose type and term happen to resemble a factory warranty row.
  const block = coverageBoundary >= 0 ? coverageTail.slice(0, coverageBoundary) : coverageTail
  const re = /COVERAGE TYPE:\s*([^:]*?)\s*COVERAGE DESCRIPTION:\s*([\s\S]*?)(?=\s*ADDITIONAL INFO:|\s*COVERAGE TYPE:|\s*MARKETING MESSAGES|\s*EXTENDED COVERAGES|\s*WARRANTY REPAIR HISTORY|$)/gi
  let m
  while ((m = re.exec(block)) && coverages.length < 12) {
    coverageCandidates += 1
    const type = m[1].trim()
    const description = m[2].trim()
    if (!isFactoryCoverageRow(type, description) || factoryTermText(description) !== description) continue
    const key = type.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    coverages.push({ type, description })
  }
  const fsa = []
  const fsaBlock = /OUTSTANDING FIELD SERVICE ACTIONS([\s\S]{0,2000}?)(?:NO WARNING MESSAGES|GENERAL WARRANTY INFORMATION|$)/i.exec(text)
  if (fsaBlock && !/NO CAMPAIGN MESSAGE\(S\) FOUND/i.test(fsaBlock[1])) {
    for (const c of (fsaBlock[1].match(/\b\d{2}[A-Z]\d{2,3}\b/g) || []).slice(0, 60)) if (!fsa.includes(c)) fsa.push(c)
  }
  return {
    warrantyStartDate,
    monthsInService: monthsRaw ? Number(monthsRaw) : null,
    saleMileage: saleMileageRaw ? Number(saleMileageRaw.replace(/,/g, '')) : null,
    coverages,
    coverageCandidates,
    openFieldServiceActionCodes: fsa,
  }
}

export function oasisWarrantyBlock(oasis, currentMileage) {
  if (!oasis || !isOasisDate(oasis.warrantyStartDate) || oasis.monthsInService == null) return null
  const age = oasis.monthsInService
  const coverages = []
  for (const c of oasis.coverages) {
    const t = termFromOasisDescription(c.description)
    const milesLimit = t.unlimitedMiles ? { kind: 'unlimited' } : t.termMiles != null ? { kind: 'number', value: t.termMiles } : { kind: 'na' }
    const monthsLimit = t.termMonths != null ? { kind: 'number', value: t.termMonths } : { kind: 'na' }
    const calc = remainingFor({ milesLimit, monthsLimit, currentMileage, currentAgeMonths: age })
    if (!isFactoryCoverageRow(c.type, c.description)) continue
    const entry = { type: c.type, termText: c.description, ...calc }
    if (t.termMiles != null) entry.termMiles = t.termMiles
    if (t.termMonths != null) entry.termMonths = t.termMonths
    if (t.unlimitedMiles) entry.unlimitedMiles = true
    coverages.push(entry)
  }
  if (!coverages.length) return null
  return { warrantyStartDate: oasis.warrantyStartDate.slice(0, 40), monthsInService: age, coverages: coverages.slice(0, 12) }
}

const OASIS_NO_RECORD = /(?:NO\s+(?:OASIS|VEHICLE|WARRANTY)\s+(?:INFORMATION|RECORD|DATA)(?:\s+(?:IS\s+)?AVAILABLE|\s+FOUND)?|VEHICLE\s+(?:WAS\s+)?NOT\s+FOUND|VIN\s+(?:WAS\s+)?NOT\s+FOUND|INVALID\s+VIN)/i

export function classifyOasisResponse(response, expectedVin) {
  if (!response || response.status === 0 || response.error) return { state: 'unreachable' }
  const text = String(response.text || '')
  if (/type=["']?password/i.test(text) || /login\.microsoftonline\.com/i.test(text)) return { state: 'session_expired' }
  if (response.status !== 200 || !text) return { state: 'unreachable' }
  const plain = stripTagsLocal(text)
  if (!responseMentionsVin(plain, expectedVin)) return { state: 'unparsed' }
  if (OASIS_NO_RECORD.test(plain)) return { state: 'no_record' }
  const oasis = parseOasis(text, expectedVin)
  if (!oasis || !isOasisDate(oasis.warrantyStartDate) || !Number.isSafeInteger(oasis.monthsInService)) return { state: 'unparsed' }
  if (oasis.coverageCandidates !== oasis.coverages.length) return { state: 'unparsed' }
  return { state: 'ok', oasis }
}

export function isCompleteWarrantyRecord(record) {
  if (!record || typeof record !== 'object') return false
  const make = String(record.make || '').toUpperCase()
  if (FORD_MAKES.has(make)) {
    return (record.result === 'OK' && Boolean(record.fordOasis)) || ['no_record', 'no_factory_coverage'].includes(record.oasisOutcome)
  }
  return record.result === 'OK' && Boolean(record.autoCheck)
}

// ── drivers ──────────────────────────────────────────────────────────────────
const SOURCE_LABEL = {
  both: 'Ford OASIS warranty record (authoritative) with Experian AutoCheck estimate; remaining figures computed at the listed odometer',
  oasis: 'Ford OASIS warranty record; remaining figures computed at the listed odometer',
  autocheck: 'Experian AutoCheck warranty estimate; remaining figures computed at the listed odometer',
  fordNoRecord: 'Ford OASIS returned no vehicle record; Experian AutoCheck estimate only, with remaining figures computed at the listed odometer',
}

export async function fetchAutoCheckHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error('HTTP_' + r.status)
  const ct = r.headers.get('content-type') || ''
  if (!/text\/html|xhtml/i.test(ct)) throw new Error('NOT_HTML')
  const text = await r.text()
  if (text.length > 4_000_000) throw new Error('TOO_LARGE')
  return text
}

function loadSnapshot(reportDate) {
  const p = path.join(ROOT, 'work', 'inventory-history', 'snapshots', `${reportDate}-public.json`)
  const snap = JSON.parse(readFileSync(p, 'utf8'))
  let vehicles = snap.vehicles || {}
  if (Array.isArray(vehicles)) vehicles = Object.fromEntries(vehicles.filter(v => v && v.vin).map(v => [String(v.vin).toUpperCase(), v]))
  return vehicles
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, dateArg, ...rest] = argv
  const flagNum = (name, dflt) => rest.includes(name) ? Number(rest[rest.indexOf(name) + 1]) : dflt
  const flagStr = (name, dflt) => rest.includes(name) ? String(rest[rest.indexOf(name) + 1]) : dflt
  if (cmd !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg || '')) {
    console.error('usage: capture-warranty.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--vin VIN] [--refresh]')
    return 2
  }
  const reportDate = dateArg
  const max = flagNum('--max', 9999)
  const budgetMs = flagNum('--budget-ms', 900000)
  const onlyVin = flagStr('--vin', null)?.toUpperCase() ?? null
  const refresh = rest.includes('--refresh')
  if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(budgetMs) || budgetMs < 1) throw new Error('INVALID_CAPTURE_LIMIT')
  const vehicles = loadSnapshot(reportDate)
  if (onlyVin && (!/^[A-HJ-NPR-Z0-9]{17}$/.test(onlyVin) || !Object.hasOwn(vehicles, onlyVin))) {
    throw new Error('REQUESTED_VIN_NOT_IN_DATED_PUBLIC_SNAPSHOT')
  }

  const outDir = path.join(ROOT, 'work', 'warranty-history')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${reportDate}-warranty.json`)
  let out = { schema: 'bob-maxey-warranty-capture-v1', reportDate, startedAt: new Date().toISOString(), records: [] }
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8'))
    if (prev.reportDate === reportDate && Array.isArray(prev.records)) out = { ...prev, startedAt: out.startedAt }
  } catch {}
  delete out.stoppedReason
  delete out.finishedAt
  delete out.tally
  delete out.fordWarrantyUnverified

  // Resume only records whose contents prove completion. A legacy Ford result
  // marked OK with AutoCheck alone is intentionally retried. --vin is an
  // upsert: remove that VIN's prior row before capturing its replacement.
  out.records = refresh ? [] : out.records.filter(isCompleteWarrantyRecord)
  if (onlyVin) out.records = out.records.filter((record) => record.vin !== onlyVin)
  const done = new Set(out.records.map((record) => record.vin))
  let queue = onlyVin ? [onlyVin] : Object.keys(vehicles).sort().filter((vin) => !done.has(vin))
  queue = queue.slice(0, max)

  let oasisCtx = null
  let oasisState = queue.some((vin) => FORD_MAKES.has(String(vehicles[vin]?.make || '').toUpperCase())) ? 'not_started' : 'not_needed'
  async function oasisFor(vin) {
    if (['session_expired', 'browser_unavailable'].includes(oasisState)) return { state: oasisState }
    if (!oasisCtx) {
      let ctx
      try {
        ctx = await getOriginTab(OASIS_ORIGIN, OASIS_URL(vin), { settleMs: 60000, connectTimeoutMs: 65000 })
      } catch {
        oasisState = 'browser_unavailable'
        return { state: oasisState }
      }
      if (!ctx.state || ctx.state.host !== 'www.fordtechservice.dealerconnection.com') {
        const host = String(ctx.state?.host || '')
        oasisState = /microsoftonline|login|signin|\bsso\b/i.test(host) ? 'session_expired' : 'browser_unavailable'
        await closeOwnedTab(ctx)
        return { state: oasisState }
      }
      oasisCtx = ctx
    }
    let response
    try {
      response = await fetchInTab(oasisCtx.page, OASIS_URL(vin), { timeoutMs: 45000 })
    } catch {
      oasisState = 'browser_unavailable'
      return { state: oasisState }
    }
    const outcome = classifyOasisResponse(response, vin)
    if (outcome.state === 'session_expired') oasisState = 'session_expired'
    else if (outcome.state === 'unreachable') oasisState = 'browser_unavailable'
    else oasisState = outcome.state
    return outcome
  }

  const t0 = Date.now()
  const save = () => {
    const temporary = `${outPath}.tmp`
    writeFileSync(temporary, JSON.stringify(out, null, 1))
    renameSync(temporary, outPath)
  }
  for (const vin of queue) {
    if (Date.now() - t0 > budgetMs) { out.stoppedReason = 'BUDGET_EXHAUSTED'; break }
    const v = vehicles[vin] || {}
    const make = String(v.make || '').toUpperCase()
    const mileage = Number(v.mileage)
    const rec = { vin, make: v.make || null, mileageEntered: Number.isFinite(mileage) ? Math.max(Math.round(mileage), 0) : null, capturedAt: new Date().toISOString() }
    if (rec.mileageEntered == null) {
      rec.result = 'NO_MILEAGE'
      out.records.push(rec)
      continue
    }

    if (FORD_MAKES.has(make)) {
      const outcome = await oasisFor(vin)
      rec.oasisOutcome = outcome.state
      if (outcome.state === 'ok') {
        const block = oasisWarrantyBlock(outcome.oasis, rec.mileageEntered)
        if (block) {
          rec.fordOasis = block
          if (outcome.oasis.openFieldServiceActionCodes?.length) rec.openFieldServiceActionCodes = outcome.oasis.openFieldServiceActionCodes
        } else if (outcome.oasis.coverageCandidates === 0) rec.oasisOutcome = 'no_factory_coverage'
        else rec.oasisOutcome = 'unparsed'
      }
    }

    const acUrl = v.autoCheckReport?.url
    if (acUrl) {
      try {
        const html = await fetchAutoCheckHtml(acUrl)
        if (!html.toUpperCase().includes(vin)) throw new Error('VIN_MISMATCH')
        const ac = parseAutoCheckWarranty(html, rec.mileageEntered)
        if (ac) {
          const isd = parseAutoCheckInServiceDate(html) || v.autoCheckReport?.estimatedInServiceDate || null
          if (isd) ac.inServiceDate = String(isd).slice(0, 40)
          rec.autoCheck = ac
        }
      } catch (error) {
        rec.autoCheckError = String(error?.message ?? error).slice(0, 120)
      }
    }

    if (FORD_MAKES.has(make)) {
      if (rec.fordOasis && rec.autoCheck) { rec.result = 'OK'; rec.sourceLabel = SOURCE_LABEL.both }
      else if (rec.fordOasis) { rec.result = 'OK'; rec.sourceLabel = SOURCE_LABEL.oasis }
      else if (rec.oasisOutcome === 'no_record' && rec.autoCheck) { rec.result = 'OK'; rec.sourceLabel = SOURCE_LABEL.fordNoRecord }
      else if (['no_record', 'no_factory_coverage'].includes(rec.oasisOutcome)) rec.result = 'NO_WARRANTY_SOURCE'
      else rec.result = 'OASIS_UNAVAILABLE'
    } else if (rec.autoCheck) {
      rec.result = 'OK'
      rec.sourceLabel = SOURCE_LABEL.autocheck
    } else rec.result = 'NO_WARRANTY_SOURCE'

    out.records.push(rec)
    if (out.records.length % 10 === 0) save()
    await sleep(60)
  }
  await closeOwnedTab(oasisCtx)
  out.finishedAt = new Date().toISOString()
  out.oasisSession = oasisState
  out.tally = {}
  for (const record of out.records) out.tally[record.result] = (out.tally[record.result] || 0) + 1
  out.fordOasisPending = out.records.filter((record) => record.result === 'OASIS_UNAVAILABLE').length
  save()
  console.log(JSON.stringify({ records: out.records.length, tally: out.tally, oasisSession: oasisState, fordOasisPending: out.fordOasisPending, stoppedReason: out.stoppedReason || null, seconds: Math.round((Date.now() - t0) / 1000), out: outPath }))
  return out.fordOasisPending > 0 ? 1 : 0
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  })
}
