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
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
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

const snapPath = path.join(ROOT, 'work', 'inventory-history', 'snapshots', `${reportDate}-public.json`)
if (!existsSync(snapPath)) { console.log(JSON.stringify({ error: `snapshot not found: ${snapPath}` })); process.exit(1) }
const raw = JSON.parse(readFileSync(snapPath, 'utf8')).vehicles || {}
const vehicles = Array.isArray(raw)
  ? Object.fromEntries(raw.filter(v => v && v.vin).map(v => [String(v.vin).toUpperCase(), v]))
  : raw
const vins = Object.entries(vehicles)
  .filter(([, v]) => FORD_MAKES.has(String(v.make || '').toUpperCase()))
  .map(([vin]) => vin).sort()

const folder = path.join(ROOT, 'work', 'invoice-history', reportDate)
mkdirSync(folder, { recursive: true })
const have = new Set(refresh ? [] : readdirSync(folder).filter(f => f.endsWith('.pdf')).map(f => f.replace(/\.pdf$/i, '')))

let prior = []
const indexPath = path.join(folder, 'index.json')
if (!refresh && existsSync(indexPath)) {
  try { prior = (JSON.parse(readFileSync(indexPath, 'utf8')).results || []).filter(r => r.status === 'pdf' && have.has(r.vin)) } catch {}
}
const priorVins = new Set(prior.map(r => r.vin))
const queue = vins.filter(v => !priorVins.has(v)).slice(0, max)

const t0 = Date.now()
const ctx = await getOriginTab(ORIGIN, ORIGIN + '/', { settleMs: 45000 })
if (!ctx.state || !ctx.state.host.includes('fordvisions')) {
  console.log(JSON.stringify({ sessionStatus: 'unavailable', detail: 'no fordvisions tab' })); process.exit(1)
}
const page = ctx.page

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
      results.push({ vin, status: 'unavailable', reason: `FETCH_ERROR ${r.error || 'status 0'}` }); tally.unavailable++
    } else if (r.base64) {
      const buf = Buffer.from(r.base64, 'base64')
      if (buf.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
        writeFileSync(path.join(folder, `${vin}.pdf`), buf)
        results.push({ vin, status: 'pdf', bytes: buf.length }); tally.pdf++
      } else {
        results.push({ vin, status: 'unavailable', reason: 'response was not a PDF' }); tally.unavailable++
      }
    } else {
      const t = (r.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      let reason = 'no PDF returned'
      if (/not retail/i.test(t)) reason = 'Document Type is not retail'
      else if (/not found in our system/i.test(t)) reason = 'The VIN entered was not found in our system.'
      else if (/msal-browser/i.test(r.text || '')) reason = 'SSO lapsed mid-run'
      results.push({ vin, status: 'unavailable', reason }); tally.unavailable++
    }
  } catch (e) {
    results.push({ vin, status: 'unavailable', reason: `ERROR ${String(e.message).slice(0, 100)}` }); tally.error++
  }
  await sleep(120)
}

results.sort((a, b) => a.vin.localeCompare(b.vin))
writeFileSync(indexPath, JSON.stringify({
  schema: 'ford-invoice-index-v1', reportDate,
  capturedAtUtc: new Date().toISOString(), results }, null, 1))

console.log(JSON.stringify({
  sessionStatus: 'ok', fordLincolnVins: vins.length, attempted: queue.length,
  tally, stoppedReason: stopped, seconds: Math.round((Date.now() - t0) / 1000), folder
}))
try { page.close() } catch {}
process.exit(0)
