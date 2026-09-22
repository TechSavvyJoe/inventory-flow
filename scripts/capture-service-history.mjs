// Deterministic, read-only Ford PTS Retail Service Repair History capture.
// The index is checked daily; unchanged repair-order details are reused from prior captures.
// No customer/owner name, complaint, technician, or free-form identity field is collected.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getOriginTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import {
  parseServiceHistoryDetails,
  parseServiceHistoryIndex,
  repairOrderFingerprint,
} from './lib/service-history-parser.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'

const ROOT = resolveWorkspaceRoot(import.meta.url)
const ORIGIN = 'https://www.fordtechservice.dealerconnection.com'
const HISTORY_URL = (vin) => `${ORIGIN}/VehicleService/Index?VIN=${vin}`
const DETAILS_URL = `${ORIGIN}/VehicleService/Details`
const FORD_MAKES = new Set(['FORD', 'LINC', 'LINCOLN'])
const RECENT_DETAIL_LIMIT = 5
const [, , cmd, reportDate, ...rest] = process.argv
if (cmd !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate || '')) {
  console.error('usage: capture-service-history.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N] [--refresh] [--vin VIN]')
  process.exit(2)
}
const num = (flag, fallback) => { const index = rest.indexOf(flag); return index >= 0 ? Number(rest[index + 1]) : fallback }
const value = (flag) => { const index = rest.indexOf(flag); return index >= 0 ? String(rest[index + 1] || '') : '' }
const max = num('--max', Infinity)
const budgetMs = num('--budget-ms', 1800000)
const refresh = rest.includes('--refresh')
const requestedVin = value('--vin').trim().toUpperCase()
if (requestedVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(requestedVin)) throw new Error('--vin must be a valid 17-character VIN')

const vehicles = loadDatedInventoryVehicles(ROOT, reportDate)
const fullWorklist = Object.entries(vehicles)
  .filter(([, vehicle]) => FORD_MAKES.has(String(vehicle.make || '').toUpperCase()))
  .map(([vin, vehicle]) => ({ vin: vin.toUpperCase(), stock: vehicle.stock || vehicle.stockNumber || '', make: String(vehicle.make || '').toUpperCase() }))
  .sort((a, b) => a.vin.localeCompare(b.vin))
let worklist = fullWorklist
if (requestedVin) {
  const selected = fullWorklist.find((item) => item.vin === requestedVin)
  if (!selected) throw new Error(`VIN ${requestedVin} is not a Ford/Lincoln vehicle in the ${reportDate} current inventory`)
  worklist = [selected]
}

const historyDir = path.join(ROOT, 'work', 'service-history')
mkdirSync(historyDir, { recursive: true })
const outPath = path.join(historyDir, `${reportDate}-service-history.json`)
const priorByVin = new Map()
for (const name of readdirSync(historyDir).filter((name) => /^\d{4}-\d{2}-\d{2}-service-history\.json$/.test(name)).sort()) {
  if (name === path.basename(outPath)) continue
  try {
    const capture = JSON.parse(readFileSync(path.join(historyDir, name), 'utf8'))
    for (const record of capture.records || []) if (record?.vin) priorByVin.set(record.vin, record)
  } catch {}
}
let out = {
  schema: 'bob-maxey-ford-service-history-v1',
  reportDate,
  capturedAtUtc: new Date().toISOString(),
  source: 'Ford PTS Retail Service Repair History, read-only capture from the authenticated Work PC Automation Browser',
  privacyNote: 'Only VIN-bound repair-order dates, odometer, parts, labor operations, and deterministic service summaries are retained. No customer or owner data is collected.',
  records: [],
}
// A targeted refresh replaces only that VIN. Retain every other completed
// same-day record so a one-VIN proof cannot erase the full daily capture.
if ((!refresh || requestedVin) && existsSync(outPath)) {
  try {
    const previous = JSON.parse(readFileSync(outPath, 'utf8'))
    if (Array.isArray(previous.records)) out.records = previous.records
  } catch {}
}
// A resumed same-day capture must follow the newest current inventory. If a VIN
// disappeared since an earlier partial pass, do not retain or refetch it.
const currentVins = new Set(fullWorklist.map((item) => item.vin))
const completeResults = new Set(['OK', 'NO_HISTORY'])
// A failed or incomplete same-day row is not completion. Drop it before a
// resumed pass so the VIN is retried and the file remains one-record-per-VIN.
out.records = out.records.filter((record) => currentVins.has(record?.vin) && completeResults.has(record?.result))
if (requestedVin && refresh) out.records = out.records.filter((record) => record.vin !== requestedVin)
const done = new Set(out.records.map((record) => record.vin))
const queue = worklist.filter((item) => !done.has(item.vin)).slice(0, max)
const save = () => writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')

function cachedDetails(vin, order) {
  const prior = priorByVin.get(vin)
  return (prior?.checkedRepairOrders || []).find((item) => item?.detailComplete === true && repairOrderFingerprint(item) === repairOrderFingerprint(order)) ?? null
}

function formBody(vin, repairOrderNumber) {
  return new URLSearchParams({ vin, detailsID: repairOrderNumber }).toString()
}

let context = null
let sessionStatus = 'not_started'
let stoppedReason = null
const tally = { OK: 0, NO_HISTORY: 0, INCOMPLETE: 0, ERROR: 0, DETAILS_FETCHED: 0, DETAILS_REUSED: 0 }
const startedAt = Date.now()
if (queue.length) {
  context = await getOriginTab(ORIGIN, HISTORY_URL(queue[0].vin), { settleMs: 60000 }).catch(() => null)
  const host = String(context?.state?.host || '')
  if (!context || host !== 'www.fordtechservice.dealerconnection.com') {
    sessionStatus = /microsoftonline|login|signin/i.test(host) ? 'session_expired' : 'unavailable'
    try { context?.page?.close() } catch {}
    console.log(JSON.stringify({ sessionStatus, captured: out.records.length, queued: queue.length, out: outPath }))
    process.exit(1)
  }
}

for (const item of queue) {
  if (Date.now() - startedAt > budgetMs) { stoppedReason = 'BUDGET_EXHAUSTED'; break }
  const checkedAt = new Date().toISOString()
  try {
    let response
    let index
    // Ford PTS occasionally serves the vehicle that was previously selected
    // in the shared session. The parser binds every page to the requested VIN;
    // retry a mismatch with a cache-buster instead of attaching it incorrectly.
    for (let attempt = 0; attempt < 3; attempt++) {
      const requestUrl = `${HISTORY_URL(item.vin)}&inventoryFlowRequest=${Date.now()}-${attempt}`
      response = await fetchInTab(context.page, requestUrl, { timeoutMs: 45000 })
      if (response.status === 0 || response.error || /login\.microsoftonline\.com/i.test(response.finalUrl || '')) break
      index = parseServiceHistoryIndex(response.text, item.vin)
      if (index.state !== 'vin_mismatch') break
      await sleep(250 * (attempt + 1))
    }
    if (response.status === 0 || response.error || /login\.microsoftonline\.com/i.test(response.finalUrl || '')) {
      sessionStatus = 'session_expired'; stoppedReason = 'SESSION_EXPIRED'; break
    }
    if (index.state === 'session_expired') { sessionStatus = 'session_expired'; stoppedReason = 'SESSION_EXPIRED'; break }
    if (index.state !== 'ok') {
      out.records.push({ vin: item.vin, checkedAt, result: 'ERROR', dataState: 'incomplete', historyCaptured: false, error: index.state })
      tally.ERROR++
      continue
    }
    if (!index.repairOrders.length) {
      out.records.push({
        vin: item.vin, checkedAt, result: 'NO_HISTORY', dataState: 'current', historyCaptured: true,
        repairOrderCount: 0, detailScanCount: 0, inspectionSearchStatus: 'not_identified', checkedRepairOrders: [],
      })
      sessionStatus = 'ok'; tally.NO_HISTORY++
      continue
    }

    const checkedRepairOrders = []
    let inspection = null
    let incomplete = false
    for (const order of index.repairOrders.slice(0, RECENT_DETAIL_LIMIT)) {
      let detailed = cachedDetails(item.vin, order)
      if (detailed) tally.DETAILS_REUSED++
      if (!detailed) {
        const detailResponse = await fetchInTab(context.page, DETAILS_URL, {
          method: 'POST',
          body: formBody(item.vin, order.repairOrderNumber),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          timeoutMs: 45000,
        })
        if (detailResponse.status === 0 || detailResponse.error || /login\.microsoftonline\.com/i.test(detailResponse.finalUrl || '')) {
          sessionStatus = 'session_expired'; stoppedReason = 'SESSION_EXPIRED'; break
        }
        const parsed = parseServiceHistoryDetails(detailResponse.text, order)
        if (parsed.state === 'session_expired') { sessionStatus = 'session_expired'; stoppedReason = 'SESSION_EXPIRED'; break }
        if (parsed.state !== 'ok') {
          checkedRepairOrders.push({ ...order, detailComplete: false })
          incomplete = true
          continue
        }
        detailed = parsed.repairOrder
        tally.DETAILS_FETCHED++
      }
      checkedRepairOrders.push(detailed)
      if (!inspection && detailed.inspection?.status === 'confirmed') inspection = detailed
      await sleep(60)
    }
    if (stoppedReason === 'SESSION_EXPIRED') break
    const latest = checkedRepairOrders.find((order) => repairOrderFingerprint(order) === repairOrderFingerprint(index.repairOrders[0])) ?? {
      ...index.repairOrders[0], detailComplete: false,
    }
    if (!latest.detailComplete) incomplete = true
    out.records.push({
      vin: item.vin,
      checkedAt,
      result: incomplete ? 'INCOMPLETE' : 'OK',
      dataState: incomplete ? 'incomplete' : 'current',
      historyCaptured: true,
      repairOrderCount: index.repairOrders.length,
      detailScanCount: checkedRepairOrders.length,
      inspectionSearchStatus: incomplete && !inspection ? 'incomplete' : inspection ? 'confirmed' : 'not_identified',
      latestRepairOrder: latest,
      recentInspection: inspection,
      checkedRepairOrders,
    })
    sessionStatus = 'ok'
    tally[incomplete ? 'INCOMPLETE' : 'OK']++
    if (out.records.length % 5 === 0) save()
  } catch (error) {
    out.records.push({ vin: item.vin, checkedAt, result: 'ERROR', dataState: 'incomplete', historyCaptured: false, error: String(error?.message || error).slice(0, 160) })
    tally.ERROR++
  }
  await sleep(80)
}

save()
try { context?.page?.close() } catch {}
const resultByVin = new Map(out.records.map((record) => [record.vin, record]))
const complete = worklist.every((item) => completeResults.has(resultByVin.get(item.vin)?.result)) && !stoppedReason
console.log(JSON.stringify({
  sessionStatus,
  complete,
  records: out.records.length,
  worklist: worklist.length,
  tally,
  stoppedReason,
  seconds: Math.round((Date.now() - startedAt) / 1000),
  out: outPath,
}))
process.exit(complete ? 0 : 1)
