// keep-dealermail-alive.mjs
// Durable session keeper for every login the daily pipeline depends on:
// DealerMail, vAuto, FMCDealer (OASIS) and fordvisions (Ford invoices).
//
// Runs from the Windows Scheduled Task BobMaxey-DealerMailKeeper every 10 minutes.
// Talks to the automation Comet over CDP on 127.0.0.1:9222 (localhost only) and makes one
// cheap credentialed request INSIDE each authenticated tab. Missing service tabs are opened in
// this isolated browser so a restart does not require Joe to rebuild the workspace by hand.
// No cookie or credential
// is ever read, stored or transmitted by this script - the browser makes the request with its
// own session. Survives Comet restarts because it depends on no in-page timer.
//
// EVERY SERVICE FAILS DIFFERENTLY, AND NONE OF THEM RETURNS A LOGIN FORM.
// Checking for a password field (which this script did until 09/14/2026) reports a dead
// session as healthy:
//   DealerMail   200 + body "Session Ended - Please Refresh (F5)", no password field
//   FMCDealer    redirects to login.microsoftonline.com; the cross-origin hop fails CORS so a
//                same-origin fetch THROWS ("Failed to fetch") instead of returning a body
//   fordvisions  Entra/MSAL - returns the msal-browser HTML shell; site root 403s even when
//                signed in, so only a real document or a legitimate Ford refusal means authed
//   vAuto        HTTP 401 "Entity and/or User is Null."
// Each check below tests that service's own signature.
//
// A keeper holds a live session open; it cannot revive a dead one. When a service reports
// SESSION_EXPIRED, only Joe signing in inside the Work PC Automation Browser fixes it.
import { writeFileSync, mkdirSync, appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { resolveWorkspaceRoot } from './lib/workspace-root.mjs'
import { sendSignInAlert } from './lib/signin-alert.mjs'

const PORT = 9222
const ROOT = resolveWorkspaceRoot(import.meta.url)
const DIR = path.join(ROOT, 'work', 'app-feed-status')
const OUT = path.join(DIR, 'dealermail-keeper.json')
const LOG = path.join(DIR, 'dealermail-keeper.log')
const BROWSER_STARTER = path.join(import.meta.dirname, 'start-automation-browser.ps1')
const POWERSHELL = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe'
const GRID = 'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95'
const OASIS = vin => `https://www.fordtechservice.dealerconnection.com/oasis/Index?vin=${vin}`
const INVOICE = vin => `https://fordvisions.dealerconnection.com/vinv/GetInvoice.aspx?v=${vin}&n=%2C&pa=00000&p=&ct=USA`

const openSocket = (url, timeoutMs = 10000) => new Promise((res, rej) => {
  const s = new WebSocket(url)
  let timer
  const cleanup = () => { clearTimeout(timer); s.removeEventListener('open', opened); s.removeEventListener('error', failed) }
  const opened = () => { cleanup(); res(s) }
  const failed = () => { cleanup(); rej(new Error('websocket connect failed')) }
  timer = setTimeout(() => { cleanup(); try { s.close() } catch {}; rej(new Error('websocket connect timeout')) }, timeoutMs)
  s.addEventListener('open', opened, { once: true })
  s.addEventListener('error', failed, { once: true })
})
const cdp = (sock, id, method, params, timeoutMs = 20000) => new Promise((res, rej) => {
  const timer = setTimeout(() => { sock.removeEventListener('message', onMsg); rej(new Error(method + ': CDP_TIMEOUT')) }, timeoutMs)
  const onMsg = ev => {
    let m
    try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()) } catch { return }
    if (m.id !== id) return
    clearTimeout(timer); sock.removeEventListener('message', onMsg)
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  }
  sock.addEventListener('message', onMsg)
  try { sock.send(JSON.stringify({ id, method, params })) }
  catch (error) { clearTimeout(timer); sock.removeEventListener('message', onMsg); rej(error) }
})

const targets = async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`could not list service tabs: HTTP ${response.status}`)
  return response.json()
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function ensureAutomationBrowser() {
  try {
    await targets()
    return { status: 'OK', restarted: false }
  } catch {}

  // The dedicated profile owns the existing authenticated sessions. Relaunching
  // it can restore normal unattended capture after a browser crash, without
  // reading credentials or attempting an interactive sign-in.
  try {
    execFileSync(POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BROWSER_STARTER,
    ], { encoding: 'utf8', timeout: 90000, windowsHide: true })
  } catch (error) {
    return { status: 'UNAVAILABLE', restarted: true, error: String(error?.message || error).slice(0, 160) }
  }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      await targets()
      return { status: 'RECOVERED', restarted: true }
    } catch {
      await pause(1000)
    }
  }
  return { status: 'UNAVAILABLE', restarted: true }
}

async function openServiceTab(url) {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`could not open service tab: HTTP ${response.status}`)
  const tab = await response.json()
  // Give Chromium enough time to establish the page origin. The service-specific
  // probe below remains the authority; opening a tab is never treated as healthy.
  await new Promise(resolve => setTimeout(resolve, 2500))
  return tab
}

async function closeServiceTab(tab) {
  if (!tab?.id) return
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${encodeURIComponent(tab.id)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    })
  } catch {}
}

async function evaluateTab(tab, expression, opened = false) {
  const sock = await openSocket(tab.webSocketDebuggerUrl)
  try {
    const result = await cdp(sock, 1, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return { value: JSON.parse(result.result.value), tab: (tab.url || '').slice(0, 100), target: tab, opened }
  } finally { try { sock.close() } catch {} }
}

// Runs `expression` inside a tab on that origin, opening the read-only probe URL if needed.
async function inTab(re, expression, openUrl) {
  const candidates = (await targets()).filter(tab => tab.type === 'page' && re.test(tab.url || '')).slice(0, 3)
  let lastError = null
  for (const tab of candidates) {
    try { return await evaluateTab(tab, expression) }
    catch (error) { lastError = error }
  }
  if (!openUrl) {
    if (lastError) throw lastError
    return { noTab: true }
  }
  const tab = await openServiceTab(openUrl)
  try {
    return await evaluateTab(tab, expression, true)
  } catch (error) {
    await closeServiceTab(tab)
    throw error
  }
}

// A Ford VIN to probe FMCDealer / fordvisions with. Taken from the newest OASIS worklist so
// the keeper never invents one.
function sampleFordVin() {
  try {
    const f = readdirSync(path.join(ROOT, 'work')).filter(n => /^oasis-vin-worklist-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().pop()
    if (!f) return null
    const list = JSON.parse(readFileSync(path.join(ROOT, 'work', f), 'utf8'))
    return Array.isArray(list) && list.length ? list[0].vin : null
  } catch { return null }
}

const status = { checkedAt: new Date().toISOString(), automationBrowser: await ensureAutomationBrowser() }

// ---- DealerMail: 200, no "Session Ended", and the grid's own function present -------------
try {
  const r = await inTab(/dealermail\.com\/prospect_manager/i, `(async () => {
    try {
      const r = await fetch(${JSON.stringify(GRID)}, { credentials: 'include', cache: 'no-store' });
      const t = await r.text();
      return JSON.stringify({ httpStatus: r.status, bytes: t.length,
        sessionEnded: /Session Ended/i.test(t), hasGrid: /showModels/.test(t) });
    } catch (e) { return JSON.stringify({ httpStatus: 0, error: String(e).slice(0,120) }); }
  })()`, GRID)
  if (r.noTab) status.dealermail = { status: 'NO_TAB' }
  else {
    const v = r.value
    status.dealermail = { ...v, tab: r.tab,
      status: (v.httpStatus === 200 && !v.sessionEnded && v.hasGrid) ? 'OK' : 'SESSION_EXPIRED' }
  }
} catch (e) { status.dealermail = { status: 'ERROR', error: String(e.message).slice(0, 160) } }

// ---- FMCDealer / OASIS: a thrown fetch is the SSO bounce ----------------------------------
const fordVin = sampleFordVin()
if (!fordVin) status.fmcdealer = { status: 'SKIPPED', reason: 'no OASIS worklist to sample a VIN from' }
else {
  try {
    const r = await inTab(/fordtechservice\.dealerconnection\.com/i, `(async () => {
      try {
        const r = await fetch(${JSON.stringify(OASIS(fordVin))}, { credentials: 'include', cache: 'no-store' });
        const t = await r.text();
        return JSON.stringify({ httpStatus: r.status, oasis: /OASIS RESULT/i.test(t),
          login: /login\\.microsoftonline\\.com/i.test(t) || /type=["']?password/i.test(t) });
      } catch (e) { return JSON.stringify({ httpStatus: 0, threw: String(e).slice(0,120) }); }
    })()`, OASIS(fordVin))
    if (r.noTab) status.fmcdealer = { status: 'NO_TAB' }
    else {
      const v = r.value
      status.fmcdealer = { ...v, tab: r.tab,
        status: (v.httpStatus === 200 && v.oasis && !v.login) ? 'OK' : 'SESSION_EXPIRED' }
    }
  } catch (e) { status.fmcdealer = { status: 'ERROR', error: String(e.message).slice(0, 160) } }
}

// ---- fordvisions: RENEW, don't just report ------------------------------------------------
// Its Entra/MSAL session is short-lived and a plain fetch cannot renew it - only NAVIGATING
// runs the msal-browser javascript that completes the silent SSO against the live FMCDealer
// session. So when the probe comes back as the msal shell, navigate once and re-probe. That
// is what makes this an actual keeper for fordvisions rather than a smoke alarm. If the
// underlying Entra session is genuinely gone, the navigation lands on a login page and the
// re-probe still reports SESSION_EXPIRED - it can never log anybody in.
if (!fordVin) status.fordvisions = { status: 'SKIPPED', reason: 'no Ford VIN to probe' }
else {
  try {
    const probeInvoice = `(async () => {
      try {
        const r = await fetch(${JSON.stringify(INVOICE(fordVin))}, { credentials: 'include', cache: 'no-store' });
        const ct = r.headers.get('content-type') || '';
        if (/pdf/i.test(ct)) return JSON.stringify({ httpStatus: r.status, pdf: true });
        const t = await r.text();
        return JSON.stringify({ httpStatus: r.status, pdf: false,
          msal: /msal-browser/i.test(t),
          fordRefusal: /not retail/i.test(t) || /not found in our system/i.test(t) });
      } catch (e) { return JSON.stringify({ httpStatus: 0, threw: String(e).slice(0,120) }); }
    })()`
    const r = await inTab(/fordvisions\.dealerconnection\.com/i, probeInvoice, INVOICE(fordVin))
    if (r.noTab) status.fordvisions = { status: 'NO_TAB' }
    else {
      let v = r.value
      if (!(v.pdf || v.fordRefusal)) {
        // Renew the exact tab that answered the probe. Re-selecting the first
        // matching target here can jump back to a separate wedged tab.
        const tab = r.target
        if (tab) {
          const sock = await openSocket(tab.webSocketDebuggerUrl)
          try {
            await cdp(sock, 1, 'Page.navigate', { url: INVOICE(fordVin) })
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 1200))
              const st = await cdp(sock, 100 + i, 'Runtime.evaluate',
                { expression: `JSON.stringify({href: location.href, ready: document.readyState})`, returnByValue: true })
              const o = JSON.parse(st.result.value)
              if (o.ready === 'complete' && /GetInvoice\.aspx/i.test(o.href) && !/callback\.html/i.test(o.href)) break
            }
          } finally { try { sock.close() } catch {} }
          for (let attempt = 0; attempt < 5; attempt++) {
            if (attempt) await pause(2000)
            const again = await evaluateTab(tab, probeInvoice, r.opened)
            if (!again.noTab) { v = again.value; v.renewed = true }
            if (v.pdf || v.fordRefusal) break
          }
        }
      }
      status.fordvisions = { ...v, tab: r.tab,
        status: (v.pdf || v.fordRefusal) ? 'OK' : 'SESSION_EXPIRED' }
    }
  } catch (e) { status.fordvisions = { status: 'ERROR', error: String(e.message).slice(0, 160) } }
}

// ---- vAuto: its own ping (HTTP 401 "Entity and/or User is Null." when expired) ------------
const pingVauto = () => {
  try {
    const out = execFileSync(process.execPath, [path.join(import.meta.dirname, 'vauto-factory-equipment.mjs'), 'ping'],
      { encoding: 'utf8', timeout: 70000, windowsHide: true })
    return JSON.parse(out.trim().split('\n').pop())
  } catch (e) {
    const last = e && e.stdout ? String(e.stdout).trim().split('\n').pop() : ''
    try { return JSON.parse(last) }
    catch { return { status: 'ERROR', error: String(e && e.message || e).slice(0, 200) } }
  }
}
status.vauto = pingVauto()
// The vAuto BFF occasionally returns a single status-0 fetch failure while the
// authenticated browser session remains healthy. Retry only that transient
// class; never mask a 401/403 or SESSION_EXPIRED result.
if (status.vauto.status === 'ERROR') {
  await new Promise(resolve => setTimeout(resolve, 1500))
  const retry = pingVauto()
  status.vauto = { ...retry, retried: true }
}

const services = ['dealermail', 'fmcdealer', 'fordvisions', 'vauto']
const healthy = s => ['OK', 'SKIPPED'].includes((status[s] || {}).status)
status.expired = services.filter(s => (status[s] || {}).status === 'SESSION_EXPIRED')
status.status = services.every(healthy) ? 'OK' : 'ATTENTION'
status.action = status.expired.length
  ? `sign in to ${status.expired.join(', ')} in the Work PC Automation Browser`
  : null

mkdirSync(DIR, { recursive: true })
// Tells Joe by iMessage when a site newly needs him (see lib/signin-alert.mjs).
status.alert = await sendSignInAlert({ status, statePath: path.join(DIR, 'signin-alert-state.json') })
  .catch(error => ({ status: 'error', error: String(error?.message || error).slice(0, 160) }))
writeFileSync(OUT, JSON.stringify(status, null, 2))
appendFileSync(LOG, `${status.checkedAt} ` +
  services.map(s => `${s}=${(status[s] || {}).status}`).join(' ') +
  (status.action ? ` :: ${status.action}` : '') +
  (['unchanged', 'not_configured'].includes(status.alert.status) ? '' : ` :: alert ${status.alert.status}`) + '\n')
console.log(JSON.stringify(status))
process.exitCode = status.status === 'OK' ? 0 : 1
