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
import { closeDuplicateTabs, closeOwnedTab, closeUnresponsiveOriginTabs, getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { assessOasisCapture, diagnoseOasisActions, parseOasisFull, validateSavedOasisRecords } from './lib/oasis-parser.mjs'
import { oasisCaptureCompletion, readOasisWithRecovery } from './lib/oasis-capture-outcome.mjs'
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
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8'))
    if (Array.isArray(prev?.records)) {
      const validated = validateSavedOasisRecords(prev.records)
      if (validated.skipped) {
        process.stderr.write(`Warning: skipped ${validated.skipped} malformed saved OASIS record(s)\n`)
      }
      out.records = validated.records
    } else {
      process.stderr.write('Warning: saved OASIS data has no records array; starting with an empty capture\n')
    }
  } catch {
    process.stderr.write('Warning: saved OASIS data is unreadable; starting with an empty capture\n')
  }
}
const done = new Set(out.records.filter(r => r.openActionsCaptured === true ||
  r.actionResultLimit === 'canadian_service_info_warning').map(r => r.vin))
const queue = worklist.map(w => w.vin).filter(v => !done.has(v)).slice(0, max)

// ---------------------------------------------------------------- capture
let state = 'not_started'
let ctx = null
async function attach(seedVin) {
  const c = await getOriginTab(ORIGIN, OASIS_URL(seedVin), { settleMs: 60000 })
  await closeDuplicateTabs(ORIGIN, { pathIncludes: '/oasis/Index', keepTabId: c.tab?.id })
  if (!c.state || c.state.host !== 'www.fordtechservice.dealerconnection.com') {
    const host = String((c.state && c.state.host) || '')
    state = /microsoftonline|login|signin/i.test(host) ? 'session_expired' : 'unavailable'
    await closeOwnedTab(c)
    return null
  }
  return c
}

const t0 = Date.now()
const save = () => { out.vehicleCount = out.records.length; writeFileSync(outPath, JSON.stringify(out, null, 1)) }

if (queue.length) {
  try { ctx = await attach(queue[0]) } catch (e) {
    if (/CDP_TIMEOUT/.test(String(e.message))) { await closeUnresponsiveOriginTabs(ORIGIN); ctx = await attach(queue[0]).catch(() => null) }
    else throw e
  }
}
if (queue.length && !ctx) {
  console.log(JSON.stringify({ sessionStatus: state, captured: out.records.length, queued: queue.length, out: outPath }))
  process.exit(1)
}

const tally = { OK: 0, NO_OASIS: 0, ERROR: 0 }
// Why each vehicle is still unconfirmed after its last attempt (local review only).
const issues = new Map()
const isConfirmed = vin => out.records.some(record => record.vin === vin &&
  (record.openActionsCaptured === true || record.actionResultLimit === 'canadian_service_info_warning'))

let stopped = null
let lastResolvedVin = null
// One vehicle never stops the run: fetch every queued VIN, then give each one
// that failed or stayed unconfirmed one more try at the end, while the session
// and budget last. A persistent transport failure with no fresh response from
// another queued VIN is systemic and also ends the capture early.
async function capturePass(vins) {
  for (const vin of vins) {
    if (Date.now() - t0 > budgetMs) { stopped = 'BUDGET_EXHAUSTED'; return }
    try {
      const recovery = await readOasisWithRecovery(vin, {
        read: requestedVin => fetchInTab(ctx.page, OASIS_URL(requestedVin), { timeoutMs: 45000 }),
        alternateVin: lastResolvedVin && lastResolvedVin !== vin ? lastResolvedVin : queue.find(otherVin => otherVin !== vin),
        wait: sleep,
        budgetExhausted: () => Date.now() - t0 > budgetMs,
      })
      tally.ERROR += recovery.transportFailures
      if (recovery.transportFailures) {
        issues.set(vin, { reason: 'network_unavailable', excerpt: '' })
      }
      if (recovery.stoppedReason) { stopped = recovery.stoppedReason; return }
      const r = recovery.response
      if (!r) continue
      lastResolvedVin = vin
      if (r.status !== 200 || !r.text) { tally.ERROR++; issues.set(vin, { reason: `http_${r.status}`, excerpt: '' }); continue }
      const parsed = parseOasisFull(r.text, vin)
      if (!parsed) { tally.NO_OASIS++; issues.set(vin, { reason: 'no_oasis_report', excerpt: '' }); continue }
      const { sourceVinStatus, ...record } = parsed
      if (sourceVinStatus !== 'matched') {
        tally.NO_OASIS++
        issues.set(vin, { reason: sourceVinStatus === 'mismatch' ? 'requested_vin_mismatch' : 'requested_vin_unverified', excerpt: '' })
        continue
      }
      state = 'ok'
      out.records = out.records.filter(previous => previous.vin !== vin)
      out.records.push({ vin, ...record, capturedAt: new Date().toISOString() })
      tally.OK++
      if (isConfirmed(vin)) issues.delete(vin)
      else issues.set(vin, diagnoseOasisActions(r.text))
      if (out.records.length % 10 === 0) save()
    } catch (e) { tally.ERROR++; issues.set(vin, { reason: 'fetch_error', excerpt: '' }) }
    await sleep(80)
  }
}

await capturePass(queue)
const retryQueue = stopped ? [] : queue.filter(vin => !isConfirmed(vin))
if (retryQueue.length) {
  await sleep(2000)
  await capturePass(retryQueue)
}
const recovered = retryQueue.filter(vin => isConfirmed(vin)).length

save()
await closeDuplicateTabs(ORIGIN, { pathIncludes: '/oasis/Index', keepTabId: ctx?.tab?.id })
await closeOwnedTab(ctx)
const quality = assessOasisCapture(worklist, out.records)
// Vehicles still missing or unconfirmed go to a local review list with a reason,
// so the parser can be fixed; it is never published and never blocks the run.
const recordsByVin = new Map(out.records.map(record => [record.vin, record]))
const needsReview = worklist.map(({ vin }) => vin).filter(vin => {
  const record = recordsByVin.get(vin)
  return !record || (record.openActionsCaptured !== true && record.actionResultLimit !== 'canadian_service_info_warning')
}).map(vin => ({ vin, ...(issues.get(vin) ?? { reason: recordsByVin.has(vin) ? 'carried_unconfirmed' : 'not_captured', excerpt: '' }) }))
const reviewPath = path.join(ROOT, 'work', 'oasis-history', `${reportDate}-needs-review.json`)
writeFileSync(reviewPath, JSON.stringify({ reportDate, checkedAt: new Date().toISOString(), vehicles: needsReview }, null, 1))
const completion = oasisCaptureCompletion(state, stopped)
console.log(JSON.stringify({
  sessionStatus: completion.sessionStatus, records: out.records.length, worklist: worklist.length,
  tally, ...quality, retried: retryQueue.length, recovered, needsReview: needsReview.length,
  stoppedReason: completion.stoppedReason, seconds: Math.round((Date.now() - t0) / 1000), out: outPath, review: reviewPath,
}))
// Per-vehicle gaps are not a failure; systemic transport/session/budget stops are.
process.exit(completion.exitCode)
