// vauto-factory-equipment.mjs — vAuto "Factory Equipment" (CAI window-sticker label) over CDP (127.0.0.1:9222).
//   node scripts/vauto-factory-equipment.mjs probe <VIN>
//   node scripts/vauto-factory-equipment.mjs ping
//   node scripts/vauto-factory-equipment.mjs run <worklist.json> <out.json> [--max N] [--budget-ms N] [--ui]
//
// DEFAULT PATH = API (background, silent). No form, no clicks, no popup, nothing on screen.
//   From inside the already-authenticated vAuto tab the script calls the same endpoint the
//   Factory Equipment button calls:
//     GET https://slot1.bff.megazord.vauto.app.coxautoinc.com/api/factoryequipment/WindowStickers/{VIN}
//   with the three identity headers vAuto's own page sends. Their values are the tab's own
//   cookies (caPlatformUserId -> platformuserid, CurrentEntity -> currententityid + appraisalentityid);
//   the browser adds the session cookies itself. Response:
//     [{type:'JPG',resourceUrl:'https://assets.cai-media-management.com/window-stickers/<uuid>.jpg'},
//      {type:'PDF',resourceUrl:'https://assets.cai-media-management.com/window-stickers/<uuid>.pdf'}]
//   or [] when vAuto has no build data for that VIN (Euro/import makes, some older units).
//   ~0.2 s per VIN. No appraisal is ever created, opened, saved or finalized.
//   401 "Entity and/or User is Null." = vAuto session expired -> SESSION_EXPIRED, exit 1.
//
// LEGACY PATH (--ui) drives the appraisal form (kept only as a fallback if the API ever changes).
// ABSOLUTE RULES for that path: never save/finalize an appraisal. The only buttons it ever presses are
// Go (#vehicle-info-go), Factory Equipment (#window-sticker-container), "Ignore" on the Duplicate
// Appraisal modal, and Cancel (#cancel-appraisal-btn) + its "Yes".
//
// Output record shape is unchanged (build_vin_document_enrichment.py reads result/content.imgs[].src/startedAt).
import { readFileSync, writeFileSync } from 'node:fs'

const FORBIDDEN = ['qa-id-action-button-Save', 'finalize-modal-finalize-button', 'finalize-modal-create-inventory-button', 'save-appraisal-error-modal-try-again-btn']
const VAUTO_ORIGIN = 'https://provision.vauto.app.coxautoinc.com'
const APPRAISAL_URL = VAUTO_ORIGIN + '/Va/Appraisal/Default.aspx?new=true'
const STICKER_API = 'https://slot1.bff.megazord.vauto.app.coxautoinc.com/api/factoryequipment/WindowStickers/'
const PING_API = 'https://slot1.bff.megazord.vauto.app.coxautoinc.com/api/appraisal/default'
const CAI_RE = /^https:\/\/assets\.cai-media-management\.com\/window-stickers\/[0-9a-f-]{36}\.(jpg|pdf)$/i
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function targets() { return (await fetch('http://127.0.0.1:9222/json')).json() }
async function connect(wsUrl, { uiPath = false } = {}) {
  const ws = new WebSocket(wsUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', () => j(new Error('ws connect')), { once: true }) })
  let id = 0
  const call = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', h); rej(new Error(method + ': CDP_TIMEOUT')) }, 30000)
    const h = ev => { const m = JSON.parse(String(ev.data)); if (m.id !== my) return; clearTimeout(timer); ws.removeEventListener('message', h); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result) }
    ws.addEventListener('message', h); ws.send(JSON.stringify({ id: my, method, params }))
  })
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('page JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
  await call('Page.enable')
  // auto-accept beforeunload / confirm dialogs so a discarded appraisal never blocks us (legacy path)
  if (uiPath) ws.addEventListener('message', ev => { const m = JSON.parse(String(ev.data)); if (m.method === 'Page.javascriptDialogOpening') call('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}) })
  return { ws, call, evalJs, close: () => ws.close() }
}

// ───────────────────────────── API path ─────────────────────────────

// Any tab on the vAuto origin will do (cookies + CORS are per origin). If there is none, open the
// blank appraisal page in a NEW tab of the automation browser (which runs minimized / off-screen).
async function getVautoContext() {
  let tab = (await targets()).find(t => t.type === 'page' && (t.url || '').startsWith(VAUTO_ORIGIN + '/'))
  let opened = false
  if (!tab) {
    const r = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(APPRAISAL_URL)}`, { method: 'PUT' })
    tab = await r.json(); opened = true
  }
  const page = await connect(tab.webSocketDebuggerUrl)
  const t0 = Date.now(); let ids = null
  while (Date.now() - t0 < 90000) {
    const st = await page.evalJs(`(() => { const c = Object.fromEntries(document.cookie.split(';').map(s => s.trim()).filter(Boolean).map(s => [s.slice(0, s.indexOf('=')), decodeURIComponent(s.slice(s.indexOf('=') + 1))])); return { host: location.host, ready: document.readyState, user: c.caPlatformUserId || null, entity: c.CurrentEntity || null }; })()`).catch(() => null)
    if (st && st.host !== 'provision.vauto.app.coxautoinc.com') { page.close(); throw new Error('SESSION_EXPIRED: tab is on ' + st.host) }
    if (st && st.user && st.entity && (st.ready === 'complete' || !opened)) { ids = st; break }
    await sleep(1000)
  }
  if (!ids) { page.close(); throw new Error('SESSION_EXPIRED: vAuto identity cookies not present') }
  const headers = { platformuserid: ids.user, currententityid: ids.entity, appraisalentityid: ids.entity, accept: 'application/json' }
  return { page, tab, headers, opened }
}

async function apiFetch(page, headers, url) {
  return page.evalJs(`(async () => { try { const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', cache: 'no-store', headers: ${JSON.stringify(headers)} }); const txt = await r.text(); return { status: r.status, text: txt.slice(0, 4000) }; } catch (e) { return { status: 0, error: String(e).slice(0, 200) }; } })()`)
}

async function captureOneApi(ctx, vin) {
  const rec = { vin, startedAt: new Date().toISOString(), method: 'api' }
  const r = await apiFetch(ctx.page, ctx.headers, STICKER_API + vin)
  if (r.status === 401 || r.status === 403) throw new Error('SESSION_EXPIRED: ' + r.status + ' ' + (r.text || '').slice(0, 60))
  if (r.status !== 200) { rec.result = r.status ? 'HTTP_' + r.status : 'FETCH_ERROR'; rec.error = (r.error || r.text || '').slice(0, 120); return rec }
  let list
  try { list = JSON.parse(r.text) } catch { rec.result = 'BAD_JSON'; rec.error = r.text.slice(0, 120); return rec }
  if (!Array.isArray(list)) { rec.result = 'BAD_JSON'; return rec }
  rec.api = list.map(x => ({ type: String(x && x.type || ''), resourceUrl: String(x && x.resourceUrl || '').slice(0, 300) }))
  const jpg = rec.api.find(x => /^JPG$/i.test(x.type) && CAI_RE.test(x.resourceUrl) && /\.jpg$/i.test(x.resourceUrl))
  const pdf = rec.api.find(x => /^PDF$/i.test(x.type) && CAI_RE.test(x.resourceUrl) && /\.pdf$/i.test(x.resourceUrl))
  if (!jpg) { rec.result = list.length ? 'NO_CAI_IMAGE' : 'NO_BUILD_DATA'; return rec }
  rec.content = { title: 'factory-equipment-details', url: 'api', imgs: [{ src: jpg.resourceUrl }], pdf: pdf ? pdf.resourceUrl : null }
  rec.result = 'OK'
  return rec
}

// ───────────────────────────── legacy UI path ─────────────────────────────
// helpers that run INSIDE the page (shadow-DOM aware)
const SR = `(document.querySelector('profit-time-guided-appraisal')||{}).shadowRoot`
const pageHelpers = `
  const __sr = ${SR};
  const __q = (sel) => __sr ? __sr.querySelector(sel) : null;
  const __click = (el) => { el.scrollIntoView({block:'center'}); el.click(); return true; };
  const __onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden'; };
  const __btnByText = (txt) => { const all = [...(__sr ? __sr.querySelectorAll('button') : [])].filter(b => (b.textContent||'').trim() === txt && __onScreen(b)); return all[all.length - 1] || null; };
  const __vinInput = () => { const go = __q('#vehicle-info-go'); if (!go) return null; let box = go.parentElement; for (let k=0;k<4 && box;k++){ const fi = box.querySelector('vauto-appraisal-formatted-input'); if (fi && fi.shadowRoot) { const inp = fi.shadowRoot.querySelector('input'); if (inp) return inp; } box = box.parentElement; } return null; };
  const __setInput = (inp, val) => { const proto = Object.getPrototypeOf(inp); const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(inp, val); inp.dispatchEvent(new Event('input', {bubbles:true, composed:true})); inp.dispatchEvent(new Event('change', {bubbles:true, composed:true})); return inp.value; };
`

async function waitFor(page, condExpr, ms, every = 500) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await page.evalJs(`(() => { ${pageHelpers} return !!(${condExpr}); })()`)) return true; await sleep(every) }
  return false
}

// vAuto's buttons ignore element.click(); only a genuine pointer event reaches the handler.
async function realClick(page, finderJs) {
  const rect = await page.evalJs(`(() => { ${pageHelpers} const el = ${finderJs}; if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width }; })()`)
  if (!rect || !rect.w) return false
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  return true
}

async function getAppraisalPage() {
  const list = (await targets()).filter(t => t.type === 'page' && /Appraisal\/Default\.aspx/i.test(t.url))
  // prefer a tab whose form is already rendered; a tab stuck on "Loading..." never will be
  for (const tab of list) {
    const page = await connect(tab.webSocketDebuggerUrl, { uiPath: true })
    await page.call('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    if (await waitFor(page, `__q('#vehicle-info-go') && __vinInput()`, 2500, 500)) return { page, tab }
    page.close()
  }
  const r = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(APPRAISAL_URL)}`, { method: 'PUT' })
  const tab = await r.json()
  const page = await connect(tab.webSocketDebuggerUrl, { uiPath: true })
  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  const ok = await waitFor(page, `__q('#vehicle-info-go') && __vinInput()`, 90000, 1000)
  if (!ok) { page.close(); throw new Error('APPRAISAL_FORM_NOT_RENDERED') }
  return { page, tab }
}

async function discardCurrent(page) {
  // Fresh appraisal every time. Nothing is ever saved: we disarm the page's own
  // "unsaved changes" guard and navigate to ?new=true (the dialog handler in
  // connect() also auto-accepts, belt and braces). Then wait for an EMPTY form.
  const clean = await page.evalJs(`(() => { ${pageHelpers} const v = __vinInput(); return !!(v && v.value === '' && __q('#vehicle-info-go')); })()`).catch(() => false)
  if (clean) return
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.evalJs(`(() => { try { window.onbeforeunload = null; window.addEventListener('beforeunload', e => { e.stopImmediatePropagation(); }, true); } catch {} return true; })()`).catch(() => {})
    await page.call('Page.navigate', { url: APPRAISAL_URL + '&t=' + Date.now() })
    const ok = await waitFor(page, `__q('#vehicle-info-go') && __vinInput() && __vinInput().value === ''`, 150000, 1500)
    if (ok) return
  }
  throw new Error('APPRAISAL_FORM_NOT_RENDERED')
}

async function captureOneUi(page, vin) {
  const rec = { vin, startedAt: new Date().toISOString(), method: 'ui' }
  if (!(await waitFor(page, `__vinInput()`, 60000, 700))) { rec.result = 'FORM_NOT_READY'; return rec }
  const before = new Set((await targets()).map(t => t.id))
  await page.evalJs(`(() => { ${pageHelpers} const v = __vinInput(); v.focus(); v.select(); return true; })()`)
  await page.call('Input.insertText', { text: vin })
  await sleep(400)
  rec.vinAccepted = await page.evalJs(`(() => { ${pageHelpers} return __vinInput().value; })()`)
  await realClick(page, "__q('#vehicle-info-go')")
  // duplicate-appraisal modal -> Ignore (never Copy Information)
  const t0 = Date.now(); let decoded = false
  while (Date.now() - t0 < 25000) {
    await sleep(700)
    const st = await page.evalJs(`(() => { ${pageHelpers}
      const ig = __btnByText('Ignore'); if (ig) { return 'ignore'; }
      const fe = __q('#window-sticker-container');
      const modalUp = !!(__btnByText('Ignore') || __btnByText('Copy Information'));
      return (fe && !fe.disabled && !modalUp) ? 'ready' : 'wait'; })()`)
    if (st === 'ignore') { await realClick(page, "__btnByText('Ignore')"); rec.duplicateModal = 'ignored'; await sleep(900); continue }
    if (st === 'ready') { decoded = true; break }
  }
  if (!decoded) { rec.result = 'DECODE_TIMEOUT'; return rec }
  await sleep(1500)
  rec.buttonState = await page.evalJs(`(() => { ${pageHelpers} const b = __q('#window-sticker-container'); return { disabled: !!b.disabled, aria: b.getAttribute('aria-disabled'), title: b.title }; })()`)
  await realClick(page, "__q('#window-sticker-container')")
  let popup = null
  for (let i = 0; i < 20 && !popup; i++) { await sleep(700); popup = (await targets()).find(t => !before.has(t.id) && t.type === 'page') }
  if (!popup) { rec.result = 'NO_POPUP'; return rec }
  rec.popup = { title: popup.title, url: (popup.url || '').slice(0, 200) }
  const pp = await connect(popup.webSocketDebuggerUrl)
  await sleep(2500)
  rec.content = await pp.evalJs(`(() => ({
    title: document.title, url: location.href.slice(0,200), bodyChars: (document.body?.innerText||'').length,
    imgs: [...document.images].map(i => ({ src: (i.currentSrc||i.src||'').slice(0,300), w: i.naturalWidth, h: i.naturalHeight })).slice(0,10),
    text: (document.body?.innerText||'').slice(0, 1500)
  }))()`)
  await pp.call('Page.close').catch(() => {})
  pp.close()
  rec.result = 'OK'
  return rec
}

// ───────────────────────────── CLI ─────────────────────────────
const [,, cmd, a1, a2, ...rest] = process.argv
const flag = (name, dflt) => rest.includes(name) ? Number(rest[rest.indexOf(name) + 1]) : dflt
const UI = rest.includes('--ui')

if (cmd === 'probe') {
  if (UI) {
    const { page } = await getAppraisalPage(); await discardCurrent(page)
    const rec = await captureOneUi(page, a1); await discardCurrent(page); page.close()
    console.log(JSON.stringify(rec, null, 1))
  } else {
    const ctx = await getVautoContext()
    const rec = await captureOneApi(ctx, a1); ctx.page.close()
    console.log(JSON.stringify(rec, null, 1))
  }
} else if (cmd === 'ping') {
  // session health for the keeper: OK / SESSION_EXPIRED / ERROR (exit 0 only on OK)
  const out = { checkedAt: new Date().toISOString(), status: 'UNKNOWN' }
  try {
    const ctx = await getVautoContext()
    const r = await apiFetch(ctx.page, ctx.headers, PING_API)
    ctx.page.close()
    out.httpStatus = r.status; out.openedNewTab = ctx.opened; out.tab = (ctx.tab.url || '').slice(0, 100)
    out.status = r.status === 200 ? 'OK' : (r.status === 401 || r.status === 403) ? 'SESSION_EXPIRED' : 'ERROR'
  } catch (e) { out.status = /SESSION_EXPIRED/.test(String(e.message)) ? 'SESSION_EXPIRED' : 'ERROR'; out.error = String(e.message).slice(0, 200) }
  console.log(JSON.stringify(out))
  process.exit(out.status === 'OK' ? 0 : 1)
} else if (cmd === 'run') {
  const max = flag('--max', 999)
  const budgetMs = flag('--budget-ms', 600000)
  const work = JSON.parse(readFileSync(a1, 'utf8'))
  let out = { schema: 'vauto-factory-equipment-capture-v1', startedAt: new Date().toISOString(), records: [] }
  try { const prev = JSON.parse(readFileSync(a2, 'utf8')); if (Array.isArray(prev.records)) out = prev } catch {}
  const done = new Set(out.records.filter(r => r.result === 'OK').map(r => r.vin))
  out.records = out.records.filter(r => r.result === 'OK')          // retry anything that was not OK
  const queue = work.filter(w => !done.has(w.vin)).slice(0, max)
  out.method = UI ? 'ui' : 'api'
  out.sessionStatus = 'OK'
  delete out.stoppedReason; delete out.error; delete out.finishedAt
  console.log(JSON.stringify({ resume: done.size, queued: queue.length, method: out.method }))
  const t0 = Date.now()
  const save = () => writeFileSync(a2, JSON.stringify(out, null, 1))
  let exitCode = 0
  if (UI) {
    let page = null
    const fresh = async () => { try { page && page.close() } catch {} ; ({ page } = await getAppraisalPage()); await discardCurrent(page) }
    try { await fresh() } catch (e) { console.error('initial reset failed once: ' + e.message); await sleep(5000); await fresh() }
    for (const w of queue) {
      if (Date.now() - t0 > budgetMs) { out.stoppedReason = 'BUDGET_EXHAUSTED'; break }
      let rec
      try { rec = await captureOneUi(page, w.vin) }
      catch (e) { rec = { vin: w.vin, result: 'ERROR', error: String(e.message).slice(0, 200) } }
      out.records.push(rec); save()
      try { await discardCurrent(page) } catch (e) { try { await fresh() } catch (e2) { console.error('reconnect failed: ' + e2.message); break } }
    }
    try { page && page.close() } catch {}
  } else {
    let ctx = null
    try { ctx = await getVautoContext() } catch (e) {
      out.sessionStatus = /SESSION_EXPIRED/.test(String(e.message)) ? 'SESSION_EXPIRED' : 'ERROR'; out.error = String(e.message).slice(0, 200); save()
      console.log(JSON.stringify({ done: out.records.length, ok: done.size, sessionStatus: out.sessionStatus, error: out.error }))
      process.exit(1)
    }
    for (const w of queue) {
      if (Date.now() - t0 > budgetMs) { out.stoppedReason = 'BUDGET_EXHAUSTED'; break }
      let rec
      try { rec = await captureOneApi(ctx, w.vin) }
      catch (e) {
        if (/SESSION_EXPIRED/.test(String(e.message))) { out.sessionStatus = 'SESSION_EXPIRED'; out.error = String(e.message).slice(0, 200); exitCode = 1; break }
        rec = { vin: w.vin, startedAt: new Date().toISOString(), method: 'api', result: 'ERROR', error: String(e.message).slice(0, 200) }
        // one reconnect attempt on transport trouble (tab closed, socket dropped)
        try { ctx.page.close() } catch {}
        try { ctx = await getVautoContext() } catch (e2) { out.records.push(rec); save(); out.error = String(e2.message).slice(0, 200); exitCode = 1; break }
      }
      out.records.push(rec); save()
      await sleep(50)
    }
    try { ctx && ctx.page.close() } catch {}
  }
  out.finishedAt = new Date().toISOString(); save()
  const tally = {}
  for (const r of out.records) tally[r.result] = (tally[r.result] || 0) + 1
  console.log(JSON.stringify({ done: out.records.length, ok: out.records.filter(r => r.result === 'OK').length, tally, sessionStatus: out.sessionStatus, stoppedReason: out.stoppedReason || null, seconds: Math.round((Date.now() - t0) / 1000) }))
  process.exit(exitCode)
} else { console.error('usage: probe <VIN> [--ui] | ping | run <worklist.json> <out.json> [--max N] [--budget-ms N] [--ui]'); process.exit(2) }
