// capture-invoices.mjs - Ford factory invoice PDFs for every Ford/Lincoln unit on the feed.
//
// Read-only. Runs inside the automation browser's fordvisions tab over CDP (127.0.0.1:9222);
// every request is a GET and no credential is read, stored or sent.
//
//   node scripts/capture-invoices.mjs run 2026-09-14 [--max N] [--budget-ms N] [--refresh]
//
// Writes work/invoice-history/{date}/{VIN}.pdf and index.json (schema ford-invoice-index-v1),
// which work/extract_invoice_text.py then turns into {VIN}.txt for parse_ford_invoice.py.
//
// THE SSO HANDSHAKE IS THE WHOLE TRICK. fordvisions sits behind Entra/MSAL. A cold in-tab
// fetch just returns the msal-browser HTML shell (and the site root answers 403 even when you
// are signed in), so every previous run recorded "fordvisions unavailable" or a pile of
// "FETCH_ERROR TypeError: Failed to fetch" - 48 of them on 09/12/2026 - and the day lost its
// invoice data. NAVIGATING the tab once lets the MSAL javascript run and complete the silent
// SSO against the existing FMCDealer session (it lands on /FordEntraDealer/callback.html and
// then on the real document). After that handshake, in-tab fetches return the PDF bytes.
//
// ONE VIN NEVER STOPS THE REST. On 2026-09-29 a single VIN's thrown exception stopped 41
// queued invoices with 0 processed. A per-vehicle problem is recorded and the loop moves on;
// only a lost session, the time budget, or (in the main pass) a run of consecutive
// per-vehicle failures (which reads as a session that died mid-run without ever rendering
// the msal-browser shell) stops the whole capture. Failures left over after the main pass
// get one retry pass, which does NOT stop on a consecutive-failure streak - that queue is
// built entirely from VINs that already failed once, so failing again back-to-back there is
// expected, not a systemic signal. See scripts/lib/invoice-capture-outcome.mjs for the
// response decision and stop/continue policy - it is the pure, unit-tested half of this script.
import { copyFileSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { closeDuplicateTabs, closeOwnedTab, getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { reusableInvoices, savedInvoicePdf } from './lib/invoice-cache.mjs'
import {
  classifyCaptureException, classifyInvoiceResponse, computeExitCode, computeSessionStatus,
  isBudgetExhausted, nextCaptureStep,
} from './lib/invoice-capture-outcome.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const ROOT = resolveWorkspaceRoot(import.meta.url)
const ORIGIN = 'https://fordvisions.dealerconnection.com'
const INV_URL = vin => `${ORIGIN}/vinv/GetInvoice.aspx?v=${vin}&n=%2C&pa=00000&p=&ct=USA`
const FORD_MAKES = new Set(['FORD', 'LINC', 'LINCOLN'])

const [, , cmd, reportDate, ...rest] = process.argv
if (cmd !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || '')) {
  console.error('usage: capture-invoices.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--refresh]')
  process.exit(2)
}
const num = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? Number(rest[i + 1]) : d }
const max = num('--max', Infinity)
const budgetMs = num('--budget-ms', 1800000)
const refresh = rest.includes('--refresh')

const vehicles = loadDatedInventoryVehicles(ROOT, reportDate)
const vins = Object.entries(vehicles)
  .filter(([, v]) => FORD_MAKES.has(String(v.make || '').toUpperCase()))
  .map(([vin]) => vin).sort()

const folder = path.join(ROOT, 'work', 'invoice-history', reportDate)
mkdirSync(folder, { recursive: true })
let prior = []
const indexPath = path.join(folder, 'index.json')
if (!refresh && existsSync(indexPath)) {
  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (index.schema === 'ford-invoice-index-v1' && index.reportDate === reportDate) {
      prior = (index.results || []).filter(row => row.status === 'pdf' && vins.includes(row.vin) &&
        savedInvoicePdf(path.join(folder, `${row.vin}.pdf`), row.sha256))
    }
  } catch {}
}
const priorVins = new Set(prior.map(r => r.vin))
const reused = refresh ? new Map() : reusableInvoices(ROOT, reportDate, vins.filter(vin => !priorVins.has(vin)))
for (const [vin, item] of reused) {
  copyFileSync(item.file, path.join(folder, `${vin}.pdf`))
  prior.push({ vin, status: 'pdf', bytes: item.bytes, sha256: item.sha256,
    capturedAtUtc: item.capturedAtUtc, sourceReportDate: item.sourceReportDate })
  priorVins.add(vin)
}
const queue = vins.filter(v => !priorVins.has(v)).slice(0, max)

const t0 = Date.now()
let page = null
let context = null
if (queue.length) {
  context = await getOriginTab(ORIGIN, ORIGIN + '/', { settleMs: 45000 })
  await closeDuplicateTabs(ORIGIN, { pathIncludes: '/vinv/GetInvoice.aspx', keepTabId: context.tab?.id })
  if (!context.state || !context.state.host.includes('fordvisions')) {
    console.log(JSON.stringify({ sessionStatus: 'unavailable', detail: 'no fordvisions tab' }))
    await closeOwnedTab(context)
    process.exit(1)
  }
  page = context.page
}

// --- the SSO handshake (see header) -----------------------------------------
let authed = false
if (queue.length) {
  await page.call('Page.navigate', { url: INV_URL(queue[0]) })
  for (let i = 0; i < 30; i++) {
    await sleep(1200)
    const st = await page.evalJs(`({href: location.href, ready: document.readyState})`).catch(() => null)
    if (st && st.ready === 'complete' && /GetInvoice\.aspx/i.test(st.href) && !/callback\.html/i.test(st.href)) { authed = true; break }
  }
  if (!authed) {
    console.log(JSON.stringify({ sessionStatus: 'session_expired',
      detail: 'MSAL SSO did not complete - sign in to fordvisions.dealerconnection.com in the Work PC Automation Browser' }))
    await closeOwnedTab(context)
    process.exit(1)
  }
}

const results = [...prior]
const tally = { pdf: prior.length, unavailable: 0, failed: 0 }
// VINs whose most recent attempt was a per-vehicle failure (not a real pdf/unavailable
// answer). Cleared of a VIN as soon as it resolves; whatever is left after the main pass
// gets one retry. Never written to index.json - downstream extract/parse/merge scripts
// expect only pdf/unavailable rows there.
const failedVins = []
// Counts of the reason string for whichever VIN's most recent attempt is a failure, so
// the printed summary can say *why* (e.g. {"FETCH_ERROR":1,"UNEXPECTED_RESPONSE":1})
// instead of only how many. Keyed the same as outcome.reason from classifyInvoiceResponse
// / classifyCaptureException / the WRITE_ERROR case below.
const failureReasons = {}
let stopped = null

// One VIN's problem never stops the rest: every queued VIN gets an attempt, and a
// per-vehicle failure just moves on to the next one. Only a lost fordvisions session, the
// time budget, or (in the main pass only - see stopOnConsecutiveFailures) a run of
// CONSECUTIVE_FAILURE_LIMIT per-vehicle failures in a row (which looks like a dead session
// that never rendered the msal-browser shell) stops the pass.
async function capturePass(vins, { stopOnConsecutiveFailures = true } = {}) {
  let consecutiveFailures = 0
  for (const vin of vins) {
    if (isBudgetExhausted(Date.now() - t0, budgetMs)) { stopped = 'BUDGET_EXHAUSTED'; return }
    let outcome
    try {
      const r = await fetchInTab(page, INV_URL(vin), { binary: true, timeoutMs: 60000 })
      outcome = classifyInvoiceResponse(r)
    } catch {
      outcome = classifyCaptureException()
    }
    if (outcome.kind === 'pdf') {
      // Writing the PDF (antivirus locks, a stale damaged file being replaced) can fail on
      // its own even though the fetch succeeded. Keep that failure scoped to this VIN -
      // never let it escape and abort the whole pass - and never record a pdf result row
      // unless the write actually landed.
      try {
        writeFileSync(path.join(folder, `${vin}.pdf`), outcome.buf)
        results.push({ vin, status: 'pdf', bytes: outcome.buf.length,
          sha256: createHash('sha256').update(outcome.buf).digest('hex'), capturedAtUtc: new Date().toISOString() })
        tally.pdf++
      } catch {
        outcome = { kind: 'failure', reason: 'WRITE_ERROR' }
      }
    } else if (outcome.kind === 'unavailable') {
      results.push({ vin, status: 'unavailable', reason: outcome.reason })
      tally.unavailable++
    }
    if (outcome.kind === 'failure') {
      if (!failedVins.includes(vin)) failedVins.push(vin)
      failureReasons[outcome.reason] = (failureReasons[outcome.reason] || 0) + 1
    } else {
      const at = failedVins.indexOf(vin)
      if (at !== -1) failedVins.splice(at, 1)
    }
    const step = nextCaptureStep(consecutiveFailures, outcome, { stopOnConsecutiveFailures })
    consecutiveFailures = step.consecutiveFailures
    if (step.action === 'stop') { stopped = step.stoppedReason; return }
    await sleep(120)
  }
}

await capturePass(queue)
const retryQueue = stopped ? [] : failedVins.slice()
if (retryQueue.length) {
  await sleep(500)
  // A retry queue is built only from VINs that already failed once, so several of them
  // failing back-to-back here is expected, not a sign the fordvisions session died -
  // never let that streak abort the retry. Only a lost session or the time budget still can.
  await capturePass(retryQueue, { stopOnConsecutiveFailures: false })
}
const recovered = retryQueue.filter(vin => !failedVins.includes(vin)).length
tally.failed = failedVins.length

results.sort((a, b) => a.vin.localeCompare(b.vin))
writeFileSync(indexPath, JSON.stringify({
  schema: 'ford-invoice-index-v1', reportDate,
  capturedAtUtc: new Date().toISOString(), results }, null, 1))

console.log(JSON.stringify({
  sessionStatus: computeSessionStatus({ stoppedReason: stopped, anyVinStillFailed: failedVins.length > 0 }),
  fordLincolnVins: vins.length, attempted: queue.length, processed: results.length - prior.length,
  reused: reused.size, failed: tally.failed, retried: retryQueue.length, recovered, tally,
  failureReasons, stoppedReason: stopped, seconds: Math.round((Date.now() - t0) / 1000), folder
}))
if (context) {
  await closeDuplicateTabs(ORIGIN, { pathIncludes: '/vinv/GetInvoice.aspx', keepTabId: context.tab?.id })
  await closeOwnedTab(context)
}
process.exit(computeExitCode(stopped))
