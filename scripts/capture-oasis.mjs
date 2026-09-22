// capture-oasis.mjs - deterministic Ford OASIS capture for every Ford/Lincoln unit on the feed.
//
// Was hand-run through javascript_tool every morning, like the DealerMail capture was, which is
// why 09/13 and 09/14/2026 have no OASIS file at all. Everything happens inside the automation
// browser's already-authenticated FMCDealer tab over CDP (127.0.0.1:9222). Every request is a
// GET; no credential is read, stored or sent.
//
//   node scripts/capture-oasis.mjs run 2026-09-14 [--max N] [--budget-ms N] [--refresh]
//
// Writes work/oasis-history/{date}-oasis.json (schema bob-maxey-oasis-capture-v1) and the
// worklist work/oasis-vin-worklist-{date}.json that add_oasis_sheet.py reads.
//
// PRIVACY - REQUIRED: OASIS extended-coverage blocks carry the PRIOR OWNER'S NAME. This captures
// coverage CATEGORY and EXPIRATION DATE only. No owner name is ever parsed, stored or emitted.
//
// SESSION: an expired FMCDealer session redirects to login.microsoftonline.com. That cross-origin
// hop fails CORS, so the in-tab fetch throws (status 0) rather than returning a login page - the
// same trap that made capture-warranty report a dead session as 'not_needed'. Every failure path
// here sets a real state.
//
// CDP_TIMEOUT: a wedged renderer on an existing tab makes Page.enable hang forever. Observed
// 09/14/2026 (it also killed that morning's vAuto step). closeOriginTabs() drops the origin's
// tabs so getOriginTab opens a clean one, and the run retries once.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { getOriginTab, fetchInTab, sleep, targets, PORT } from './lib/cdp.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { parseOasisFull } from './lib/oasis-parser.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const ROOT = resolveWorkspaceRoot(import.meta.url)
const ORIGIN = 'https://www.fordtechservice.dealerconnection.com'
const OASIS_URL = vin => `${ORIGIN}/oasis/Index?vin=${vin}`
const FORD_MAKES = new Set(['FORD', 'LINC', 'LINCOLN'])

const [, , cmd, reportDate, ...rest] = process.argv
if (cmd !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || '')) {
  console.error('usage: capture-oasis.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--refresh]')
  process.exit(2)
}
const num = (flag, dflt) => { const i = rest.indexOf(flag); return i >= 0 ? Number(rest[i + 1]) : dflt }
const max = num('--max', Infinity)
const budgetMs = num('--budget-ms', 1800000)
const refresh = rest.includes('--refresh')

// ---------------------------------------------------------------- worklist
const vehicles = loadDatedInventoryVehicles(ROOT, reportDate)

const worklist = Object.entries(vehicles)
  .filter(([, v]) => FORD_MAKES.has(String(v.make || '').toUpperCase()))
  .map(([vin, v]) => ({ vin, stock: v.stock || v.stockNumber || '', store: v.storeCode || v.store || '',
                        year: String(v.year || ''), make: String(v.make || '').toUpperCase(), model: String(v.model || '') }))
  .sort((a, b) => a.vin.localeCompare(b.vin))

mkdirSync(path.join(ROOT, 'work', 'oasis-history'), { recursive: true })
writeFileSync(path.join(ROOT, 'work', `oasis-vin-worklist-${reportDate}.json`), JSON.stringify(worklist, null, 1))

const outPath = path.join(ROOT, 'work', 'oasis-history', `${reportDate}-oasis.json`)
let out = { schema: 'bob-maxey-oasis-capture-v1', reportDate, capturedAtUtc: new Date().toISOString(),
            source: 'FMCDealer OASIS vehicle report, read-only capture from the authenticated automation browser tab',
            privacyNote: 'Extended coverage is captured as category and expiration date only. No prior-owner name is ever parsed or stored.',
            vehicleCount: 0, records: [] }
if (!refresh && existsSync(outPath)) {
  try { const prev = JSON.parse(readFileSync(outPath, 'utf8')); if (Array.isArray(prev.records)) out.records = prev.records } catch {}
}
const done = new Set(out.records.map(r => r.vin))
const queue = worklist.map(w => w.vin).filter(v => !done.has(v)).slice(0, max)

// ---------------------------------------------------------------- capture
async function closeOriginTabs() {
  for (const t of await targets()) {
    if (t.type === 'page' && (t.url || '').startsWith(ORIGIN)) {
      try { await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`) } catch {}
    }
  }
  await sleep(1500)
}

let state = 'not_started'
let ctx = null
async function attach(seedVin) {
  const c = await getOriginTab(ORIGIN, OASIS_URL(seedVin), { settleMs: 60000 })
  if (!c.state || c.state.host !== 'www.fordtechservice.dealerconnection.com') {
    const host = String((c.state && c.state.host) || '')
    state = /microsoftonline|login|signin/i.test(host) ? 'session_expired' : 'unavailable'
    try { c.page.close() } catch {}
    return null
  }
  return c
}

const t0 = Date.now()
const save = () => { out.vehicleCount = out.records.length; writeFileSync(outPath, JSON.stringify(out, null, 1)) }

if (queue.length) {
  try { ctx = await attach(queue[0]) } catch (e) {
    if (/CDP_TIMEOUT/.test(String(e.message))) { await closeOriginTabs(); ctx = await attach(queue[0]).catch(() => null) }
    else throw e
  }
}
if (queue.length && !ctx) {
  console.log(JSON.stringify({ sessionStatus: state, captured: out.records.length, queued: queue.length, out: outPath }))
  process.exit(1)
}

const tally = { OK: 0, NO_OASIS: 0, ERROR: 0 }

let stopped = null
for (const vin of queue) {
  if (Date.now() - t0 > budgetMs) { stopped = 'BUDGET_EXHAUSTED'; break }
  try {
    const r = await fetchInTab(ctx.page, OASIS_URL(vin), { timeoutMs: 45000 })
    if (r.status === 0 || r.error) { state = 'session_expired'; stopped = 'SESSION_EXPIRED'; break }
    if (r.status !== 200 || !r.text) { tally.ERROR++; continue }
    if (/type=["']?password/i.test(r.text) || /login\.microsoftonline\.com/i.test(r.text)) {
      state = 'session_expired'; stopped = 'SESSION_EXPIRED'; break
    }
    const parsed = parseOasisFull(r.text)
    if (!parsed) { tally.NO_OASIS++; continue }
    state = 'ok'
    out.records.push({ vin, ...parsed, capturedAt: new Date().toISOString() })
    tally.OK++
    if (out.records.length % 10 === 0) save()
  } catch (e) { tally.ERROR++ }
  await sleep(80)
}

save()
try { ctx && ctx.page.close() } catch {}
console.log(JSON.stringify({
  sessionStatus: state, records: out.records.length, worklist: worklist.length,
  tally, stoppedReason: stopped, seconds: Math.round((Date.now() - t0) / 1000), out: outPath
}))
process.exit(stopped === 'SESSION_EXPIRED' ? 1 : 0)
