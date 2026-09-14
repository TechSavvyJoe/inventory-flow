// vAuto Factory Equipment capture over the read-only JSON endpoint used by
// vAuto's own page. No appraisal form is driven, edited, saved, or finalized.
//
//   node scripts/vauto-factory-equipment.mjs probe <VIN>
//   node scripts/vauto-factory-equipment.mjs ping
//   node scripts/vauto-factory-equipment.mjs run <worklist.json> <out.json> [--max N] [--budget-ms N]
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeOwnedTab, fetchInTab, getOriginTab, sleep } from './lib/cdp.mjs'

const VAUTO_ORIGIN = 'https://provision.vauto.app.coxautoinc.com'
const LANDING_URL = `${VAUTO_ORIGIN}/Va/Appraisal/Default.aspx?new=true`
const STICKER_API = 'https://slot1.bff.megazord.vauto.app.coxautoinc.com/api/factoryequipment/WindowStickers/'
const PING_API = 'https://slot1.bff.megazord.vauto.app.coxautoinc.com/api/appraisal/default'
const CAI_RE = /^https:\/\/assets\.cai-media-management\.com\/window-stickers\/[0-9a-f-]{36}\.(jpg|pdf)$/i
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

const VAUTO_IDENTITY_EXPRESSION = `(() => {
  const pairs = document.cookie.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const split = item.indexOf('=');
    return split < 0 ? [item, ''] : [item.slice(0, split), decodeURIComponent(item.slice(split + 1))];
  });
  const cookies = Object.fromEntries(pairs);
  return { host: location.host, ready: document.readyState, user: cookies.caPlatformUserId || null, entity: cookies.CurrentEntity || null };
})()`

export function isVautoVin(value) {
  return typeof value === 'string' && VIN_RE.test(value)
}

export async function getVautoContext() {
  const context = await getOriginTab(VAUTO_ORIGIN, LANDING_URL, {
    settleMs: 90000,
    connectTimeoutMs: 10000,
    commandTimeoutMs: 65000,
  })
  let identity = null
  const started = Date.now()
  while (Date.now() - started < 90000) {
    const state = await context.page.evalJs(VAUTO_IDENTITY_EXPRESSION, { timeoutMs: 10000 }).catch(() => null)
    if (state && state.host !== 'provision.vauto.app.coxautoinc.com') {
      await closeOwnedTab(context)
      throw new Error(`SESSION_EXPIRED: tab is on ${state.host}`)
    }
    if (state?.user && state?.entity && (state.ready === 'complete' || !context.opened)) {
      identity = state
      break
    }
    await sleep(1000)
  }
  if (!identity) {
    await closeOwnedTab(context)
    throw new Error('SESSION_EXPIRED: vAuto identity cookies not present')
  }
  return {
    ...context,
    headers: {
      platformuserid: identity.user,
      currententityid: identity.entity,
      appraisalentityid: identity.entity,
      accept: 'application/json',
    },
  }
}

async function apiFetch(context, url) {
  return fetchInTab(context.page, url, { headers: context.headers, timeoutMs: 55000 })
}

export async function captureOneApi(context, vin) {
  if (!isVautoVin(vin)) throw new Error('INVALID_VIN')
  const record = { vin, startedAt: new Date().toISOString(), method: 'api' }
  const response = await apiFetch(context, STICKER_API + vin)
  if (response.status === 401 || response.status === 403) throw new Error(`SESSION_EXPIRED: ${response.status}`)
  if (response.status !== 200) {
    record.result = response.status ? `HTTP_${response.status}` : 'FETCH_ERROR'
    record.error = String(response.error || response.text || '').slice(0, 120)
    return record
  }
  if (typeof response.text !== 'string' || response.text.length > 20_000) {
    record.result = 'BAD_JSON'
    return record
  }
  let list
  try { list = JSON.parse(response.text) }
  catch { record.result = 'BAD_JSON'; record.error = response.text.slice(0, 120); return record }
  if (!Array.isArray(list)) { record.result = 'BAD_JSON'; return record }
  record.api = list.map((item) => ({
    type: String(item?.type || ''),
    resourceUrl: String(item?.resourceUrl || '').slice(0, 300),
  }))
  const jpg = record.api.find((item) => /^JPG$/i.test(item.type) && CAI_RE.test(item.resourceUrl) && /\.jpg$/i.test(item.resourceUrl))
  const pdf = record.api.find((item) => /^PDF$/i.test(item.type) && CAI_RE.test(item.resourceUrl) && /\.pdf$/i.test(item.resourceUrl))
  if (!jpg) { record.result = list.length ? 'NO_CAI_IMAGE' : 'NO_BUILD_DATA'; return record }
  record.content = { title: 'factory-equipment-details', url: 'api', imgs: [{ src: jpg.resourceUrl }], pdf: pdf?.resourceUrl ?? null }
  record.result = 'OK'
  return record
}

function numberFlag(rest, name, fallback) {
  if (!rest.includes(name)) return fallback
  return Number(rest[rest.indexOf(name) + 1])
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, first, second, ...rest] = argv
  if (rest.includes('--ui') || first === '--ui' || second === '--ui') {
    console.error('The appraisal-form UI capture path was removed; only the read-only vAuto API is supported.')
    return 2
  }
  if (cmd === 'probe') {
    if (!isVautoVin(String(first || '').toUpperCase())) { console.error('usage: probe <VIN>'); return 2 }
    const context = await getVautoContext()
    try { console.log(JSON.stringify(await captureOneApi(context, first.toUpperCase()), null, 1)) }
    finally { await closeOwnedTab(context) }
    return 0
  }
  if (cmd === 'ping') {
    const output = { checkedAt: new Date().toISOString(), status: 'UNKNOWN' }
    let context
    try {
      context = await getVautoContext()
      const response = await apiFetch(context, PING_API)
      output.httpStatus = response.status
      output.openedNewTab = context.opened
      output.tab = String(context.tab?.url || '').slice(0, 100)
      output.status = response.status === 200 ? 'OK' : [401, 403].includes(response.status) ? 'SESSION_EXPIRED' : 'ERROR'
    } catch (error) {
      output.status = /SESSION_EXPIRED/.test(String(error?.message)) ? 'SESSION_EXPIRED' : 'ERROR'
      output.error = String(error?.message ?? error).slice(0, 200)
    } finally { await closeOwnedTab(context) }
    console.log(JSON.stringify(output))
    return output.status === 'OK' ? 0 : 1
  }
  if (cmd !== 'run' || !first || !second) {
    console.error('usage: probe <VIN> | ping | run <worklist.json> <out.json> [--max N] [--budget-ms N]')
    return 2
  }

  const max = numberFlag(rest, '--max', 999)
  const budgetMs = numberFlag(rest, '--budget-ms', 600000)
  if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(budgetMs) || budgetMs < 1) throw new Error('INVALID_VAUTO_LIMIT')
  const work = JSON.parse(readFileSync(first, 'utf8'))
  if (!Array.isArray(work) || work.some((item) => !isVautoVin(item?.vin))) throw new Error('INVALID_VAUTO_WORKLIST')
  if (new Set(work.map((item) => item.vin)).size !== work.length) throw new Error('DUPLICATE_VAUTO_WORKLIST_VIN')
  let output = { schema: 'vauto-factory-equipment-capture-v1', startedAt: new Date().toISOString(), records: [] }
  try {
    const previous = JSON.parse(readFileSync(second, 'utf8'))
    if (Array.isArray(previous.records)) output = { ...previous, startedAt: output.startedAt }
  } catch {}
  const done = new Set(output.records.filter((record) => record.result === 'OK').map((record) => record.vin))
  output.records = output.records.filter((record) => record.result === 'OK')
  const queue = work.filter((item) => !done.has(item.vin)).slice(0, max)
  output.method = 'api'
  output.sessionStatus = 'OK'
  delete output.stoppedReason
  delete output.error
  delete output.finishedAt
  console.log(JSON.stringify({ resume: done.size, queued: queue.length, method: output.method }))
  const save = () => {
    const temporary = `${second}.tmp`
    writeFileSync(temporary, JSON.stringify(output, null, 1))
    renameSync(temporary, second)
  }
  const started = Date.now()
  let exitCode = 0
  let context
  try {
    if (queue.length) context = await getVautoContext()
    for (const item of queue) {
      if (Date.now() - started > budgetMs) { output.stoppedReason = 'BUDGET_EXHAUSTED'; break }
      let record
      try { record = await captureOneApi(context, item.vin) }
      catch (error) {
        if (/SESSION_EXPIRED/.test(String(error?.message))) {
          output.sessionStatus = 'SESSION_EXPIRED'
          output.error = String(error.message).slice(0, 200)
          exitCode = 1
          break
        }
        await closeOwnedTab(context)
        context = null
        try {
          context = await getVautoContext()
          record = await captureOneApi(context, item.vin)
        } catch (retryError) {
          if (/SESSION_EXPIRED/.test(String(retryError?.message))) {
            output.sessionStatus = 'SESSION_EXPIRED'
            output.error = String(retryError.message).slice(0, 200)
            exitCode = 1
            break
          }
          record = { vin: item.vin, startedAt: new Date().toISOString(), method: 'api', result: 'ERROR', error: String(retryError?.message ?? retryError).slice(0, 200) }
        }
      }
      output.records.push(record)
      save()
      await sleep(50)
    }
  } catch (error) {
    output.sessionStatus = /SESSION_EXPIRED/.test(String(error?.message)) ? 'SESSION_EXPIRED' : 'ERROR'
    output.error = String(error?.message ?? error).slice(0, 200)
    exitCode = 1
  } finally { await closeOwnedTab(context) }
  output.finishedAt = new Date().toISOString()
  save()
  const tally = {}
  for (const record of output.records) tally[record.result] = (tally[record.result] || 0) + 1
  console.log(JSON.stringify({ done: output.records.length, ok: output.records.filter((record) => record.result === 'OK').length, tally, sessionStatus: output.sessionStatus, stoppedReason: output.stoppedReason || null, seconds: Math.round((Date.now() - started) / 1000) }))
  return exitCode
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code }).catch((error) => {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  })
}
