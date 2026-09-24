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
import { copyFileSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { closeDuplicateTabs, closeOwnedTab, getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { reusableInvoices, savedInvoicePdf } from './lib/invoice-cache.mjs'
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
const tally = { pdf: prior.length, unavailable: 0, error: 0 }
let stopped = null

for (const vin of queue) {
  if (Date.now() - t0 > budgetMs) { stopped = 'BUDGET_EXHAUSTED'; break }
  try {
    const r = await fetchInTab(page, INV_URL(vin), { binary: true, timeoutMs: 60000 })
    if (r.status === 0 || r.error) {
      stopped = 'FETCH_ERROR'
      break
    }
    if (r.status !== 200) {
      stopped = `HTTP_${r.status}`
      break
    } else if (r.base64) {
      const buf = Buffer.from(r.base64, 'base64')
      if (buf.length >= 8 && buf.length <= 8 * 1024 * 1024 &&
          buf.subarray(0, 5).toString('latin1') === '%PDF-' &&
          buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1').includes('%%EOF')) {
        writeFileSync(path.join(folder, `${vin}.pdf`), buf)
        results.push({ vin, status: 'pdf', bytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'), capturedAtUtc: new Date().toISOString() }); tally.pdf++
      } else {
        results.push({ vin, status: 'unavailable', reason: 'response was not a PDF' }); tally.unavailable++
      }
    } else {
      const t = (r.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (/msal-browser/i.test(r.text || '')) {
        stopped = 'SESSION_EXPIRED'
        break
      }
      let reason = null
      if (/not retail/i.test(t)) reason = 'Document Type is not retail'
      else if (/not found in our system/i.test(t)) reason = 'The VIN entered was not found in our system.'
      if (!reason) {
        stopped = 'UNEXPECTED_RESPONSE'
        break
      }
      results.push({ vin, status: 'unavailable', reason }); tally.unavailable++
    }
  } catch (e) {
    tally.error++
    stopped = 'CAPTURE_ERROR'
    break
  }
  await sleep(120)
}

results.sort((a, b) => a.vin.localeCompare(b.vin))
writeFileSync(indexPath, JSON.stringify({
  schema: 'ford-invoice-index-v1', reportDate,
  capturedAtUtc: new Date().toISOString(), results }, null, 1))

console.log(JSON.stringify({
  sessionStatus: stopped === 'SESSION_EXPIRED' ? 'session_expired' : stopped ? 'incomplete' : 'ok',
  fordLincolnVins: vins.length, attempted: queue.length, processed: results.length - prior.length,
  reused: reused.size, tally, stoppedReason: stopped, seconds: Math.round((Date.now() - t0) / 1000), folder
}))
await closeDuplicateTabs(ORIGIN, { pathIncludes: '/vinv/GetInvoice.aspx', keepTabId: context?.tab?.id })
await closeOwnedTab(context)
process.exit(stopped ? 1 : 0)
