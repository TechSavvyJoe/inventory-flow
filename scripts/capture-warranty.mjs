// capture-warranty.mjs — remaining factory warranty per VIN, at the vehicle's ACTUAL listed mileage.
//   node scripts/capture-warranty.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--vin VIN]
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
// PRIVACY: OASIS extended-coverage blocks carry the PRIOR OWNER'S NAME. This script captures
// coverage category and expiration date only, and no owner/customer field is ever read.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const OASIS_ORIGIN = 'https://www.fordtechservice.dealerconnection.com'
const OASIS_URL = vin => `${OASIS_ORIGIN}/oasis/Index?vin=${vin}`
const FORD_MAKES = new Set(['FORD', 'LINCOLN'])
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

// ── shared warranty maths ────────────────────────────────────────────────────
// Mirrors parseWarrantyLimitValue() in AutoCheck's main.js.
function parseLimit(raw) {
  const s = String(raw ?? '').trim()
  if (!s || /^(na|n\/a|-)$/i.test(s)) return { kind: 'na' }
  if (/unlimited|lifetime/i.test(s)) return { kind: 'unlimited' }
  const n = Number(s.replace(/[, ]/g, ''))
  return Number.isFinite(n) ? { kind: 'number', value: n } : { kind: 'na' }
}
const fmtMiles = n => `${Math.max(Math.floor(n), 0).toLocaleString('en-US')} miles left`
const fmtMonths = n => `${n} ${n === 1 ? 'month' : 'months'}`

// Mirrors recalculateWarrantyTable() exactly: same expiry rules, same wording.
function remainingFor({ milesLimit, monthsLimit, currentMileage, currentAgeMonths }) {
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
function parseAutoCheckWarranty(html, currentMileage) {
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
function parseAutoCheckInServiceDate(html) {
  const text = stripTagsLocal(html)
  const m = text.match(/estimated in service(?: date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i)
  return m ? m[1].trim().slice(0, 40) : null
}

// ── Ford OASIS: warranty start date, months in service, printed coverage terms ──
// "3 years / 36,000 Miles (whichever occurs first)" -> 36 months / 36000 miles.
function termFromOasisDescription(description) {
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

function parseOasis(html) {
  const text = stripTagsLocal(html)
  if (!/OASIS RESULT/i.test(text)) return null
  const field = (label) => {
    const m = text.match(new RegExp(label + '\\s*:\\s*([^:]*?)(?=\\s+[A-Z][A-Z &/]{3,}\\s*:|\\s*$)', 'i'))
    return m ? m[1].trim() : ''
  }
  const warrantyStartDate = (text.match(/WARRANTY START DATE:\s*([0-9]{1,2}-[A-Za-z]+-[0-9]{4})/i) || [])[1] || ''
  const monthsRaw = (text.match(/MONTHS IN SERVICE:\s*(\d+)/i) || [])[1]
  const saleMileageRaw = (text.match(/SALE MILEAGE:\s*([\d,]+)/i) || [])[1]

  const coverages = []
  const seen = new Set()
  const block = text.slice(Math.max(0, text.search(/WARRANTY COVERAGE/i)))
  const re = /COVERAGE TYPE:\s*([^:]*?)\s*COVERAGE DESCRIPTION:\s*([\s\S]*?)(?=\s*ADDITIONAL INFO:|\s*COVERAGE TYPE:|\s*MARKETING MESSAGES|\s*EXTENDED COVERAGES|$)/gi
  let m
  while ((m = re.exec(block)) && coverages.length < 12) {
    const type = m[1].trim().slice(0, 60)
    const description = m[2].trim()
    if (!type) continue
    const key = type.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    coverages.push({ type, description: description.slice(0, 120) })
  }
  // extended coverage CATEGORIES and expirations only - never an owner name
  const extended = []
  const extBlock = /EXTENDED COVERAGES([\s\S]{0,1200}?)(?:WARRANTY REPAIR HISTORY|End of OASIS report|$)/i.exec(text)
  if (extBlock && !/NO ESP INFORMATION AVAILABLE/i.test(extBlock[1])) {
    for (const d of (extBlock[1].match(/\d{1,2}-[A-Za-z]{3,}-\d{4}/g) || []).slice(0, 10)) extended.push(d)
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
    extendedCoverageExpirations: extended,
    openFieldServiceActionCodes: fsa,
  }
}

function oasisWarrantyBlock(oasis, currentMileage) {
  if (!oasis || !oasis.warrantyStartDate || oasis.monthsInService == null) return null
  const age = oasis.monthsInService
  const coverages = []
  for (const c of oasis.coverages) {
    const t = termFromOasisDescription(c.description)
    const milesLimit = t.unlimitedMiles ? { kind: 'unlimited' } : t.termMiles != null ? { kind: 'number', value: t.termMiles } : { kind: 'na' }
    const monthsLimit = t.termMonths != null ? { kind: 'number', value: t.termMonths } : { kind: 'na' }
    const calc = remainingFor({ milesLimit, monthsLimit, currentMileage, currentAgeMonths: age })
    const entry = { type: c.type, termText: (c.description || 'Varies').slice(0, 120), ...calc }
    if (t.termMiles != null) entry.termMiles = t.termMiles
    if (t.termMonths != null) entry.termMonths = t.termMonths
    if (t.unlimitedMiles) entry.unlimitedMiles = true
    coverages.push(entry)
  }
  if (!coverages.length) return null
  return { warrantyStartDate: oasis.warrantyStartDate.slice(0, 40), monthsInService: age, coverages: coverages.slice(0, 12) }
}

// ── drivers ──────────────────────────────────────────────────────────────────
const SOURCE_LABEL = {
  both: 'Ford OASIS warranty record (authoritative) with Experian AutoCheck estimate; remaining figures computed at the listed odometer',
  oasis: 'Ford OASIS warranty record; remaining figures computed at the listed odometer',
  autocheck: 'Experian AutoCheck warranty estimate; remaining figures computed at the listed odometer',
  fordUnverified: 'UNVERIFIED - Experian AutoCheck estimate only, Ford OASIS was unavailable. AutoCheck prints generic terms (60-month bumper-to-bumper where Ford is 36). DO NOT QUOTE TO A CUSTOMER - sign in to FMCDealer in the Work PC Automation Browser and re-run the capture.',
}

async function fetchAutoCheckHtml(url) {
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

const [, , cmd, dateArg, ...rest] = process.argv
const flagNum = (name, dflt) => rest.includes(name) ? Number(rest[rest.indexOf(name) + 1]) : dflt
const flagStr = (name, dflt) => rest.includes(name) ? String(rest[rest.indexOf(name) + 1]) : dflt

if (cmd !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg || '')) {
  console.error('usage: capture-warranty.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--vin VIN]')
  process.exit(2)
}
const reportDate = dateArg
const max = flagNum('--max', 9999)
const budgetMs = flagNum('--budget-ms', 900000)
const onlyVin = flagStr('--vin', null)

const vehicles = loadSnapshot(reportDate)
const outDir = path.join(ROOT, 'work', 'warranty-history')
mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `${reportDate}-warranty.json`)

let out = { schema: 'bob-maxey-warranty-capture-v1', reportDate, startedAt: new Date().toISOString(), records: [] }
try { const prev = JSON.parse(readFileSync(outPath, 'utf8')); if (Array.isArray(prev.records)) out = { ...prev, startedAt: out.startedAt } } catch {}
delete out.stoppedReason; delete out.finishedAt; delete out.tally
// Each day gets its own file, so a fresh day is always a full run. Within a day the
// capture resumes: VINs already captured are kept and skipped, so a run that hit its
// budget can be finished by simply running it again. --refresh recomputes everything
// (use it if the odometer feed moved materially during the day).
const refresh = rest.includes('--refresh')
const done = new Set(refresh ? [] : out.records.filter(r => r.result === 'OK').map(r => r.vin))
out.records = refresh ? [] : out.records.filter(r => r.result === 'OK')

let queue = Object.keys(vehicles).sort().filter(v => !done.has(v))
if (onlyVin) queue = [onlyVin.toUpperCase()]
queue = queue.slice(0, max)

// One shared FMCDealer tab for every OASIS fetch; opened only if a Ford/Lincoln VIN needs it.
let oasisCtx = null
let oasisState = 'not_needed'
async function oasisFor(vin) {
  if (oasisState === 'unavailable') return null
  if (!oasisCtx) {
    const ctx = await getOriginTab(OASIS_ORIGIN, OASIS_URL(vin), { settleMs: 60000 })
    if (!ctx.state || ctx.state.host !== 'www.fordtechservice.dealerconnection.com') {
      const host = String((ctx.state && ctx.state.host) || '')
      oasisState = /microsoftonline|login|signin|\bsso\b/i.test(host) ? 'session_expired' : 'unavailable'
      try { ctx.page.close() } catch {}
      return null
    }
    oasisCtx = ctx
  }
  const r = await fetchInTab(oasisCtx.page, OASIS_URL(vin), { timeoutMs: 45000 })
  // A same-origin fetch that comes back status 0 / "Failed to fetch" is the signature of
  // FMCDealer bouncing to login.microsoftonline.com: the cross-origin SSO hop fails CORS,
  // so there is never a body to sniff for a password field. Before 09/14/2026 this path
  // returned null WITHOUT setting a state, so an expired session was reported as the
  // reassuring 'not_needed' and every Ford/Lincoln unit silently fell through to
  // AutoCheck's generic terms. A hard network failure looks identical from here; both
  // want the same human action, which is to check the FMCDealer sign-in.
  if (r.status === 0 || r.error) { oasisState = 'session_expired'; return null }
  if (r.status !== 200 || !r.text) { oasisState = `http_${r.status}`; return null }
  if (/type=["']?password/i.test(r.text) || /login\.microsoftonline\.com/i.test(r.text)) { oasisState = 'session_expired'; return null }
  if (!/OASIS RESULT/i.test(r.text)) { oasisState = 'no_oasis_result'; return null }
  oasisState = 'ok'
  return parseOasis(r.text)
}

const t0 = Date.now()
const save = () => writeFileSync(outPath, JSON.stringify(out, null, 1))
const tally = {}
for (const vin of queue) {
  if (Date.now() - t0 > budgetMs) { out.stoppedReason = 'BUDGET_EXHAUSTED'; break }
  const v = vehicles[vin] || {}
  const make = String(v.make || '').toUpperCase()
  const mileage = Number(v.mileage)
  const rec = { vin, make: v.make || null, mileageEntered: Number.isFinite(mileage) ? Math.max(Math.round(mileage), 0) : null, capturedAt: new Date().toISOString() }
  if (rec.mileageEntered == null) { rec.result = 'NO_MILEAGE'; out.records.push(rec); tally[rec.result] = (tally[rec.result] || 0) + 1; continue }

  // (1) Ford OASIS for Ford/Lincoln
  if (FORD_MAKES.has(make)) {
    try {
      const oasis = await oasisFor(vin)
      if (oasis) {
        const block = oasisWarrantyBlock(oasis, rec.mileageEntered)
        if (block) rec.fordOasis = block
        if (oasis.extendedCoverageExpirations?.length) rec.extendedCoverageExpirations = oasis.extendedCoverageExpirations
        if (oasis.openFieldServiceActionCodes?.length) rec.openFieldServiceActionCodes = oasis.openFieldServiceActionCodes
      }
    } catch (e) { rec.oasisError = String(e.message).slice(0, 120) }
  }

  // (2) AutoCheck for everything that has a report link
  const acUrl = v.autoCheckReport?.url
  if (acUrl) {
    try {
      const html = await fetchAutoCheckHtml(acUrl)
      if (!html.includes(vin)) throw new Error('VIN_MISMATCH')
      const ac = parseAutoCheckWarranty(html, rec.mileageEntered)
      if (ac) {
        const isd = parseAutoCheckInServiceDate(html) || v.autoCheckReport?.estimatedInServiceDate || null
        if (isd) ac.inServiceDate = String(isd).slice(0, 40)
        rec.autoCheck = ac
      }
    } catch (e) { rec.autoCheckError = String(e.message).slice(0, 120) }
  }

  if (rec.fordOasis && rec.autoCheck) { rec.result = 'OK'; rec.sourceLabel = SOURCE_LABEL.both }
  else if (rec.fordOasis) { rec.result = 'OK'; rec.sourceLabel = SOURCE_LABEL.oasis }
  else if (rec.autoCheck) {
    rec.result = 'OK'
    if (FORD_MAKES.has(make)) { rec.sourceLabel = SOURCE_LABEL.fordUnverified; rec.fordWarrantyUnverified = true }
    else { rec.sourceLabel = SOURCE_LABEL.autocheck }
  }
  else rec.result = 'NO_WARRANTY_SOURCE'
  tally[rec.result] = (tally[rec.result] || 0) + 1
  out.records.push(rec)
  if (out.records.length % 10 === 0) save()
  await sleep(60)
}
try { oasisCtx && oasisCtx.page.close() } catch {}
out.finishedAt = new Date().toISOString()
out.oasisSession = oasisState
out.tally = tally
save()
out.fordWarrantyUnverified = out.records.filter(r => r.fordWarrantyUnverified).length
console.log(JSON.stringify({ records: out.records.length, tally, oasisSession: oasisState, fordWarrantyUnverified: out.fordWarrantyUnverified, stoppedReason: out.stoppedReason || null, seconds: Math.round((Date.now() - t0) / 1000), out: outPath }))
