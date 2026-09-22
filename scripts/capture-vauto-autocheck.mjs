// Exact-VIN AutoCheck fallback captured from vAuto's own read-only report API.
// The dealership website remains the first source; this script only queues
// current vehicles without a website AutoCheck link and never saves an appraisal.
//
//   node scripts/capture-vauto-autocheck.mjs probe <VIN>
//   node scripts/capture-vauto-autocheck.mjs run <YYYY-MM-DD> [--max N] [--budget-ms N]
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { closeOwnedTab, fetchInTab, sleep } from './lib/cdp.mjs'
import { loadDatedInventoryVehicles } from './lib/inventory-worklist.mjs'
import { isMainModule } from './lib/is-main.mjs'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'
import { getVautoContext, isVautoVin } from './vauto-factory-equipment.mjs'

let resolvedRoot
function workspaceRoot() {
  resolvedRoot ??= resolveWorkspaceRoot(import.meta.url)
  return resolvedRoot
}
const BFF_ORIGIN_RE = /^https:\/\/slot\d+\.bff\.megazord\.vauto\.app\.coxautoinc\.com$/i
const REPORT_PATH = '/api/autocheck/getReport'
const MAX_REPORT_BYTES = 2 * 1024 * 1024
const INSPECTION_TYPES = [
  [/\bvehicle\s+serviced\s+or\s+inspected\b/i, 'Vehicle Serviced or Inspected'],
  [/\bmultiple\s+point\s+vehicle\s+inspection\b/i, 'Multiple Point Vehicle Inspection'],
  [/\bmulti[-\s]?point\s+vehicle\s+inspection\b/i, 'Multi-Point Vehicle Inspection'],
  [/\bcertified\s+pre[-\s]?owned\s+inspection\b/i, 'Certified Pre-Owned Inspection'],
  [/\bpre[-\s]?purchase\s+inspection\b/i, 'Pre-Purchase Inspection'],
  [/\bsafety\s+inspection\b/i, 'Safety Inspection'],
  [/\bvehicle\s+inspected\b/i, 'Vehicle Inspected'],
]

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function text(node) {
  return clean(node?.textContent)
}

function boundedText(value, max) {
  const result = clean(value)
  return result ? result.slice(0, max) : null
}

function integer(value) {
  const match = clean(value).match(/[0-9][0-9,]*/)
  if (!match) return null
  const result = Number(match[0].replaceAll(',', ''))
  return Number.isSafeInteger(result) ? result : null
}

function sourceDate(value) {
  const input = clean(value).replace(/^\(|\)$/g, '')
  const us = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const result = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
    if (new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) === result) return result
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input) && new Date(`${input}T12:00:00Z`).toISOString().slice(0, 10) === input) return input
  return input || null
}

function recentInspection(document) {
  let latest = null
  for (const table of document.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('th')].map((cell) => text(cell).toLowerCase())
    const dateIndex = headers.indexOf('event date')
    const detailsIndex = headers.indexOf('details')
    if (dateIndex < 0 || detailsIndex < 0) continue
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.querySelectorAll(':scope > td')].map(text)
      if (cells.length <= Math.max(dateIndex, detailsIndex)) continue
      const date = sourceDate(cells[dateIndex])
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const types = INSPECTION_TYPES.filter(([pattern]) => pattern.test(cells[detailsIndex])).map(([, label]) => label)
      if (!types.length) continue
      if (!latest || date > latest.date) latest = { date, types }
      else if (date === latest.date) {
        for (const type of types) if (!latest.types.includes(type)) latest.types.push(type)
      }
    }
  }
  return latest
}

/** Parse only bounded, allow-listed report facts after exact-VIN validation. */
export function parseVautoAutoCheckHtml(html, vin) {
  if (!isVautoVin(vin) || typeof html !== 'string' || !html.trim() || Buffer.byteLength(html, 'utf8') > MAX_REPORT_BYTES) return null
  let document
  try { document = new JSDOM(html).window.document } catch { return null }
  const normalizedText = text(document.body).replace(/\s+/g, '').toUpperCase()
  if (!normalizedText.includes(vin.toUpperCase())) return null

  const decoded = new Map()
  for (const row of document.querySelectorAll('.decode-box-row')) {
    const value = text(row)
    const split = value.indexOf(':')
    if (split > 0) decoded.set(clean(value.slice(0, split)).toLowerCase(), clean(value.slice(split + 1)))
  }

  let reportRunAt = null
  for (const node of [...document.querySelectorAll('body *')].reverse()) {
    const value = text(node)
    const match = value.match(/Report\s+run:\s*([^\n]{1,80})$/i)
    if (match) { reportRunAt = boundedText(match[1], 80); break }
  }

  let usage = null
  for (const node of document.querySelectorAll('.owner')) {
    const value = text(node)
    if (!/Vehicle\s+Usage/i.test(value)) continue
    usage = boundedText(value.replace(/^.*?Vehicle\s+Usage\s*/i, ''), 80)
    if (usage) break
  }

  const owners = [...document.querySelectorAll('.owner-header')]
    .flatMap((node) => [...text(node).matchAll(/Owner\s+(\d+)/gi)].map((match) => Number(match[1])))
    .filter(Number.isSafeInteger)

  const checks = []
  for (const card of document.querySelectorAll('#at-glance .card')) {
    const label = boundedText(text(card.querySelector('.large-title')), 160)
    if (!label) continue
    const status = boundedText(text(card.querySelector('.card-footer-text-adjustment')), 200)
    const detail = boundedText(text(card.querySelector('.subtitle')), 500)
    checks.push({ label, ...(status ? { status } : {}), ...(detail && detail !== status ? { detail } : {}) })
    if (checks.length >= 20) break
  }

  const odometerText = decoded.get('last reported odometer') ?? ''
  const odometerDate = odometerText.match(/\((\d{1,2}\/\d{1,2}\/\d{4})\)/)?.[1]
  const result = {
    ...(integer(text(document.querySelector('.mainScore'))) !== null ? { score: integer(text(document.querySelector('.mainScore'))) } : {}),
    ...(integer(text(document.querySelector('.low-score'))) !== null ? { scoreRangeLow: integer(text(document.querySelector('.low-score'))) } : {}),
    ...(integer(text(document.querySelector('.high-score'))) !== null ? { scoreRangeHigh: integer(text(document.querySelector('.high-score'))) } : {}),
    ...(usage ? { usage } : {}),
    ...(owners.length ? { ownerCount: Math.max(...owners) } : {}),
    ...(integer(odometerText) !== null ? { lastReportedOdometer: integer(odometerText) } : {}),
    ...(odometerDate ? { lastReportedOdometerDate: sourceDate(odometerDate) } : {}),
    ...(boundedText(decoded.get('class'), 160) ? { vehicleClass: boundedText(decoded.get('class'), 160) } : {}),
    ...(boundedText(decoded.get('country of assembly'), 120) ? { assemblyCountry: boundedText(decoded.get('country of assembly'), 120) } : {}),
    ...(sourceDate(decoded.get('estimated in service')) ? { estimatedInServiceDate: sourceDate(decoded.get('estimated in service')) } : {}),
    ...(reportRunAt ? { reportRunAt } : {}),
    ...(checks.length ? { checks } : {}),
  }
  const inspection = recentInspection(document)
  if (inspection) result.recentInspection = inspection
  return result
}

async function bffOrigins(context) {
  const values = await context.page.evalJs(`(() => [...new Set(performance.getEntriesByType('resource').map((entry) => {
    try { const value = new URL(entry.name); return /\\.bff\\.megazord\\.vauto\\.app\\.coxautoinc\\.com$/i.test(value.hostname) ? value.origin : null } catch { return null }
  }).filter(Boolean))])()`, { timeoutMs: 10000 }).catch(() => [])
  const candidates = [
    ...(Array.isArray(values) ? values : []),
    'https://slot1.bff.megazord.vauto.app.coxautoinc.com',
    'https://slot2.bff.megazord.vauto.app.coxautoinc.com',
  ]
  return [...new Set(candidates)].filter((origin) => BFF_ORIGIN_RE.test(origin))
}

export async function captureVautoAutoCheck(context, vin) {
  if (!isVautoVin(vin)) throw new Error('INVALID_VIN')
  const startedAt = new Date().toISOString()
  let last = null
  for (const origin of await bffOrigins(context)) {
    const url = new URL(REPORT_PATH, origin)
    url.searchParams.set('vin', vin)
    const response = await fetchInTab(context.page, url.href, {
      headers: { ...context.headers, accept: 'text/html,application/xhtml+xml' },
      timeoutMs: 60000,
    })
    last = response
    if (response.status === 401 || response.status === 403) throw new Error(`SESSION_EXPIRED: ${response.status}`)
    if (response.status !== 200 || typeof response.text !== 'string') continue
    if (!/^text\/html\b/i.test(response.contentType ?? response.headers?.['content-type'] ?? '') && !/<html[\s>]/i.test(response.text)) continue
    const parsed = parseVautoAutoCheckHtml(response.text, vin)
    if (!parsed) return { vin, startedAt, result: 'VIN_MISMATCH_OR_UNPARSEABLE' }
    return {
      vin,
      startedAt,
      result: 'OK',
      autoCheckReport: {
        validatedVin: vin,
        dataState: 'current',
        accessMethod: 'vauto',
        sourceLabel: 'Experian AutoCheck report captured through vAuto for this VIN',
        capturedAt: startedAt,
        ...parsed,
      },
    }
  }
  return { vin, startedAt, result: last?.status ? `HTTP_${last.status}` : 'FETCH_ERROR', error: boundedText(last?.error ?? last?.text, 120) ?? undefined }
}

function numberFlag(rest, name, fallback) {
  const index = rest.indexOf(name)
  return index < 0 ? fallback : Number(rest[index + 1])
}

function websiteHasAutoCheck(vehicle) {
  return typeof vehicle?.autoCheckReport?.url === 'string' && vehicle.autoCheckReport.url.trim().length > 0
}

function saveAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`)
  renameSync(temporary, file)
}

export async function main(argv = process.argv.slice(2)) {
  const [command, first, ...rest] = argv
  if (command === 'probe') {
    const vin = String(first ?? '').trim().toUpperCase()
    if (!isVautoVin(vin)) { console.error('usage: probe <VIN>'); return 2 }
    const context = await getVautoContext()
    try { console.log(JSON.stringify(await captureVautoAutoCheck(context, vin), null, 1)) }
    finally { await closeOwnedTab(context) }
    return 0
  }
  if (command !== 'run' || !/^\d{4}-\d{2}-\d{2}$/.test(first ?? '')) {
    console.error('usage: probe <VIN> | run <YYYY-MM-DD> [--max N] [--budget-ms N]')
    return 2
  }
  const reportDate = first
  const max = numberFlag(rest, '--max', 999)
  const budgetMs = numberFlag(rest, '--budget-ms', 600000)
  if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(budgetMs) || budgetMs < 1) throw new Error('INVALID_VAUTO_LIMIT')
  const root = workspaceRoot()
  const vehicles = loadDatedInventoryVehicles(root, reportDate)
  const eligible = Object.values(vehicles).filter((vehicle) => !websiteHasAutoCheck(vehicle)).sort((a, b) => a.vin.localeCompare(b.vin))
  const eligibleVins = new Set(eligible.map((vehicle) => vehicle.vin))
  const outputPath = path.join(root, 'work', 'vauto-history', `${reportDate}-autocheck.json`)
  let output = { schema: 'vauto-autocheck-capture-v1', reportDate, startedAt: new Date().toISOString(), records: [] }
  try {
    const previous = JSON.parse(readFileSync(outputPath, 'utf8'))
    if (previous?.schema === output.schema && previous.reportDate === reportDate && Array.isArray(previous.records)) output = { ...previous, startedAt: output.startedAt }
  } catch {}
  output.records = output.records.filter((record) => record?.result === 'OK' && eligibleVins.has(record.vin))
  const done = new Set(output.records.map((record) => record.vin))
  const queue = eligible.filter((vehicle) => !done.has(vehicle.vin)).slice(0, max)
  output.sessionStatus = 'OK'
  delete output.error
  delete output.stoppedReason
  delete output.finishedAt
  saveAtomic(outputPath, output)
  console.log(JSON.stringify({ websiteFirst: true, active: Object.keys(vehicles).length, websiteReports: Object.values(vehicles).filter(websiteHasAutoCheck).length, resume: done.size, queued: queue.length }))
  const started = Date.now()
  let exitCode = 0
  let context
  try {
    if (queue.length) context = await getVautoContext()
    for (const vehicle of queue) {
      if (Date.now() - started > budgetMs) { output.stoppedReason = 'BUDGET_EXHAUSTED'; break }
      try {
        output.records.push(await captureVautoAutoCheck(context, vehicle.vin))
      } catch (error) {
        if (/SESSION_EXPIRED/.test(String(error?.message))) {
          output.sessionStatus = 'SESSION_EXPIRED'
          output.error = boundedText(error.message, 200)
          exitCode = 1
          break
        }
        output.records.push({ vin: vehicle.vin, startedAt: new Date().toISOString(), result: 'ERROR', error: boundedText(error?.message ?? error, 200) })
      }
      saveAtomic(outputPath, output)
      await sleep(50)
    }
  } catch (error) {
    output.sessionStatus = /SESSION_EXPIRED/.test(String(error?.message)) ? 'SESSION_EXPIRED' : 'ERROR'
    output.error = boundedText(error?.message ?? error, 200)
    exitCode = 1
  } finally { await closeOwnedTab(context) }
  output.finishedAt = new Date().toISOString()
  saveAtomic(outputPath, output)
  const tally = Object.groupBy(output.records, (record) => record.result)
  console.log(JSON.stringify({ outputPath, done: output.records.length, ok: tally.OK?.length ?? 0, sessionStatus: output.sessionStatus, stoppedReason: output.stoppedReason ?? null }))
  return exitCode
}

if (isMainModule(import.meta.url)) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  })
}
