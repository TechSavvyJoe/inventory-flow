// keep-dealermail-alive.mjs
// Durable DealerMail session keeper. Runs from a Windows Scheduled Task every
// 10 minutes. Talks to the automation Comet over the Chrome DevTools Protocol
// on 127.0.0.1:9222 (localhost only) and performs one credentialed fetch of the
// DealerMail grid INSIDE the existing authenticated tab. No cookies or
// credentials are read, stored, or transmitted by this script - the browser
// does the request with its own session. Survives Comet restarts because it
// does not depend on any in-page timer.
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const PORT = 9222
const GRID = 'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95'
const ROOT = path.resolve(import.meta.dirname, '../../..')
const DIR = path.join(ROOT, 'work', 'app-feed-status')
const OUT = path.join(DIR, 'dealermail-keeper.json')
const LOG = path.join(DIR, 'dealermail-keeper.log')

const openSocket = (url) => new Promise((res, rej) => {
  const s = new WebSocket(url)
  s.addEventListener('open', () => res(s), { once: true })
  s.addEventListener('error', () => rej(new Error('websocket connect failed')), { once: true })
})
const cdp = (sock, id, method, params) => new Promise((res, rej) => {
  const onMsg = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    if (m.id !== id) return
    sock.removeEventListener('message', onMsg)
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  }
  sock.addEventListener('message', onMsg)
  sock.send(JSON.stringify({ id, method, params }))
})

const status = { checkedAt: new Date().toISOString(), status: 'UNKNOWN' }
try {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  let tab = list.find(t => t.type === 'page' && /dealermail\.com\/prospect_manager/i.test(t.url || ''))
  if (!tab) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(GRID)}`, { method: 'PUT' })
    tab = await r.json()
    status.openedNewTab = true
    await new Promise(r => setTimeout(r, 7000))
  }
  const sock = await openSocket(tab.webSocketDebuggerUrl)
  const expression = `(async () => {
    const r = await fetch(${JSON.stringify(GRID)}, { credentials: 'include', cache: 'no-store' });
    const t = await r.text();
    return JSON.stringify({ httpStatus: r.status, authed: !/type=["']?password/i.test(t), bytes: t.length });
  })()`
  const res = await cdp(sock, 1, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  sock.close()
  const v = JSON.parse(res.result.value)
  Object.assign(status, v, { status: (v.httpStatus === 200 && v.authed) ? 'OK' : 'SESSION_EXPIRED', tab: (tab.url || '').slice(0, 100) })
} catch (e) {
  status.status = 'ERROR'
  status.error = String(e && e.message || e).slice(0, 200)
}
// vAuto session in the same browser: one cheap authenticated API call made from inside
// the vAuto tab (see vauto-factory-equipment.mjs ping). Keeps that session warm and
// surfaces an expired login here instead of in tomorrow's capture. Never touches the UI.
try {
  const out = execFileSync(process.execPath, [path.join(import.meta.dirname, 'vauto-factory-equipment.mjs'), 'ping'], { encoding: 'utf8', timeout: 120000, windowsHide: true })
  status.vauto = JSON.parse(out.trim().split('\n').pop())
} catch (e) {
  const last = e && e.stdout ? String(e.stdout).trim().split('\n').pop() : ''
  try { status.vauto = JSON.parse(last) } catch { status.vauto = { status: 'ERROR', error: String(e && e.message || e).slice(0, 200) } }
}
mkdirSync(DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(status, null, 2))
appendFileSync(LOG, `${status.checkedAt} dealermail=${status.status}${status.error ? ' ' + status.error : ''}${status.httpStatus ? ' http=' + status.httpStatus : ''} vauto=${status.vauto.status}${status.vauto.error ? ' ' + status.vauto.error : ''}\n`)
console.log(JSON.stringify(status))
process.exitCode = (status.status === 'OK' && status.vauto.status === 'OK') ? 0 : 1
