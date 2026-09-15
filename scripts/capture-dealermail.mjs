// capture-dealermail.mjs - deterministic, resumable DealerMail deep capture.
//
// Replaces the hand-run javascript_tool capture that had to be re-done by hand every morning.
// Everything happens inside the automation browser's already-authenticated DealerMail tab over
// CDP (127.0.0.1:9222): no credential is ever read, stored or sent by this script, and every
// request is a GET. It never submits a form, never places or releases a hold, never adds a comment.
//
//   node scripts/capture-dealermail.mjs run 2026-09-14 [--budget-ms N]
//
// Writes five files into work/dealermail-history/snapshots/ that build_v2_snapshot.mjs consumes:
//   {date}-deep-capture-raw.json        {full, comments, alerts, cdk}
//   {date}-exclude-view-raw.json        [{stock, vin}]
//   {date}-hold-details-raw.json        parsed hold_edit tables
//   {date}-complete-list-raw-cells.json dual 22-cell arrays the cloud validator demands
//   {date}-complete-inventory-raw.json  flattened 19-column grid
//
// SESSION DETECTION IS THE POINT. DealerMail does not return a login form when the session dies -
// it returns HTTP 200 with a body reading "Session Ended - Please Refresh (F5)". Checking status or
// looking for a password field reports a dead session as healthy, which is how 09/13 and 09/14
// silently published nothing. Authenticated here means: no "Session Ended" text, showModels is a
// real function, and the loaded grid has >100 rows of exactly 22 cells.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const ROOT = resolveWorkspaceRoot(import.meta.url)
const ORIGIN = 'https://www.dealermail.com'
const PM = ORIGIN + '/prospect_manager/'
const GRID = PM + 'V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95'
const EXCLUDE = PM + 'V2_inventory_search_CRM_USED_NEW.asp?model=ALL&lotReadyOnly=&onHoldStatus=N&theStoreSelected=26,25,27,95'

const COLUMNS = ['stock','storeCode','rowClass','year','make','model','body','series','engine','vin',
                 'color','miles','price','age','cert','holdInfo','holdDays','comments','alert']
const CELL_INDEXES = [3,4,5,6,7,9,10,11,12,13,14,15,16,17,20,21]

const [, , cmd, reportDate, ...rest] = process.argv
if (cmd !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || '')) {
  console.error('usage: capture-dealermail.mjs run <YYYY-MM-DD> [--budget-ms N]')
  process.exit(2)
}
const budgetMs = (() => { const i = rest.indexOf('--budget-ms'); return i >= 0 ? Number(rest[i + 1]) : 900000 })()

const outDir = path.join(ROOT, 'work', 'dealermail-history', 'snapshots')
mkdirSync(outDir, { recursive: true })
const p = suffix => path.join(outDir, `${reportDate}-${suffix}`)

const fail = (status, detail) => {
  console.log(JSON.stringify({ sessionStatus: status, detail: detail || null, wrote: [] }))
  process.exit(status === 'ok' ? 0 : 1)
}

const t0 = Date.now()
const ctx = await getOriginTab(ORIGIN, GRID, { settleMs: 60000 })
if (!ctx.state || !ctx.state.host.includes('dealermail.com')) fail('unavailable', 'no dealermail tab')
const page = ctx.page

await page.call('Page.navigate', { url: GRID })
for (let i = 0; i < 60; i++) {
  await sleep(700)
  if ((await page.evalJs('document.readyState').catch(() => null)) === 'complete') break
}
await sleep(1500)

const pre = await page.evalJs(`({
  sessionEnded: /Session Ended/i.test(document.body ? document.body.innerText : ''),
  hasShowModels: typeof showModels === 'function'
})`)
if (pre.sessionEnded || !pre.hasShowModels) fail('session_expired', 'grid returned Session Ended / no showModels')

await page.evalJs(`showModels('ALL'); true`)
await sleep(9000)

// One pass over the DOM produces both the `full` records and the dual 22-cell arrays.
// cellValue() prefers a control's .value over innerText - that is what yields the ISO delivery
// dates and the order-button numbers rather than empty strings.
const grid = await page.evalJs(`(() => {
  const rows = [...document.querySelectorAll('tr[id^="TR"]')]
  const full = [], rawCells = []
  for (const r of rows) {
    const tds = [...r.querySelectorAll('td')]
    const cells = tds.map(td => td.innerText.trim())
    const controls = tds.map(td => [...td.querySelectorAll('input,select,textarea')].map(c => c.value))
    const btn = r.querySelector('input[type=button]')
    const cid = r.querySelector('input[id^="comment"]')
    full.push({
      rowId: r.id,
      stock: r.id.slice(2),
      rowClass: (r.className || '').trim(),
      storeCode: btn ? btn.value : '',
      cells,
      commentId: cid ? (cid.id.match(/\\d+/) || [''])[0] : '',
      commentsFlag: (cells[20] || '').trim(),
      alertsFlag: (cells[21] || '').trim()
    })
    rawCells.push({
      rowId: r.id,
      rowClass: (r.className || '').trim(),
      rawCellInnerText: tds.map(td => td.textContent),
      rawCellControlValues: controls
    })
  }
  return { full, rawCells }
})()`)

const full = grid.full
const rawCells = grid.rawCells
if (full.length < 100) fail('session_expired', `only ${full.length} rows after showModels`)
const badCells = rawCells.filter(r => r.rawCellInnerText.length !== 22 || r.rawCellControlValues.length !== 22)
if (badCells.length) fail('bad_capture', `${badCells.length} rows not 22 cells (validator would reject)`)

const held = full.filter(r => /onHold/i.test(r.rowClass))
const capturedAt = new Date().toISOString()

const get = async url => {
  const r = await fetchInTab(page, url, { timeoutMs: 45000 })
  return { status: r.status, text: r.text || '' }
}
const overBudget = () => Date.now() - t0 > budgetMs

// exclude view: every non-held unit, used to cross-check total - held
const ex = await get(EXCLUDE)
const excludeView = await page.evalJs(`(() => {
  const doc = new DOMParser().parseFromString(${JSON.stringify(ex.text)}, 'text/html')
  return [...doc.querySelectorAll('tr[id^="TR"]')].map(r => {
    const tds = [...r.querySelectorAll('td')]
    return { stock: r.id.slice(2), vin: (tds[10] ? tds[10].innerText : '').trim() }
  })
})()`)

const comments = [], alerts = [], cdk = [], holds = []

for (const r of held) {
  if (overBudget()) break
  const c = await get(`${PM}V2_CDK_lookup_one_vehicle_full.asp?s=${encodeURIComponent(r.stock)}`)
  cdk.push({ stock: r.stock, status: c.status, text: c.text })
  await sleep(120)
  const h = await get(`${PM}V2_inventory_USED_hold_edit.asp?s=${encodeURIComponent(r.stock)}`)
  const parsed = await page.evalJs(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(h.text)}, 'text/html')
    const val = td => { const c = td.querySelector('input,select,textarea'); return c ? c.value : td.innerText.trim() }
    const out = []
    for (const tr of doc.querySelectorAll('tr')) {
      const tds = [...tr.querySelectorAll('td')]
      if (tds.length < 8) continue
      const v = tds.map(val)
      if (!v[1] || /stock/i.test(v[1])) continue
      out.push({ order: v[0] || '', stockNo: v[1] || '', salesperson: v[2] || '', customer: v[3] || '',
                 holdDate: v[4] || '', heldBy: v[5] || '', deliveryDate: v[6] || '', daysHeld: v[7] || '' })
    }
    return out
  })()`)
  holds.push({ stock: r.stock, status: h.status, rows: parsed })
  await sleep(120)
}

for (const r of full.filter(x => x.commentsFlag === 'Y')) {
  if (overBudget()) break
  const c = await get(`${PM}V2_inventory_held_comments_USED.asp?id=${encodeURIComponent(r.commentId)}`)
  comments.push({ stock: r.stock, commentId: r.commentId, status: String(c.status), text: c.text })
  await sleep(120)
}

for (const r of full.filter(x => x.alertsFlag === 'Y')) {
  if (overBudget()) break
  const vin = (r.cells[10] || '').trim()
  const a = await get(`${PM}V2_inventory_alerts_USED.asp?vin=${encodeURIComponent(vin)}&stockNo=${encodeURIComponent(r.stock)}`)
  alerts.push({ stock: r.stock, vin, status: String(a.status), text: a.text })
  await sleep(120)
}

const inventoryRows = full.map(r => [r.stock, r.storeCode, r.rowClass,
  ...CELL_INDEXES.map(i => (r.cells[i] ?? '').trim())])

writeFileSync(p('deep-capture-raw.json'), JSON.stringify({ full, comments, alerts, cdk }, null, 1))
writeFileSync(p('exclude-view-raw.json'), JSON.stringify(excludeView, null, 1))
writeFileSync(p('hold-details-raw.json'), JSON.stringify({
  schema: 'dealermail-hold-details-raw-v1', reportDate, capturedAt, holds }, null, 1))
writeFileSync(p('complete-list-raw-cells.json'), JSON.stringify({
  capturedAtUtc: capturedAt, rowCount: rawCells.length, rows: rawCells }, null, 1))
writeFileSync(p('complete-inventory-raw.json'), JSON.stringify({
  schema: 'dealermail-complete-inventory-raw-v1', reportDate, capturedAt,
  rowCount: inventoryRows.length, columns: COLUMNS, rows: inventoryRows }, null, 1))

const reconciles = full.length - held.length === excludeView.length
console.log(JSON.stringify({
  sessionStatus: 'ok', rows: full.length, held: held.length, excludeView: excludeView.length,
  reconciles, comments: comments.length, alerts: alerts.length, cdk: cdk.length,
  holdsParsed: holds.reduce((n, h) => n + h.rows.length, 0),
  seconds: Math.round((Date.now() - t0) / 1000), outDir
}))
try { page.close() } catch {}
process.exit(0)
