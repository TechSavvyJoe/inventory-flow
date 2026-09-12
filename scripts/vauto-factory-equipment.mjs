// vauto-factory-equipment.mjs — drive vAuto Provision "Factory Equipment" over CDP (127.0.0.1:9222).
//   node scripts/vauto-factory-equipment.mjs probe <VIN>
//   node scripts/vauto-factory-equipment.mjs run <worklist.json> <out.json> [--max N]
// ABSOLUTE RULES: never save/finalize an appraisal. The only buttons this script
// ever presses are: Go (#vehicle-info-go), Factory Equipment (#window-sticker-container),
// "Ignore" on the Duplicate Appraisal modal, and Cancel (#cancel-appraisal-btn) + its "Yes".
import { readFileSync, writeFileSync } from 'node:fs'

const FORBIDDEN = ['qa-id-action-button-Save', 'finalize-modal-finalize-button', 'finalize-modal-create-inventory-button', 'save-appraisal-error-modal-try-again-btn']
const APPRAISAL_URL = 'https://provision.vauto.app.coxautoinc.com/Va/Appraisal/Default.aspx?new=true'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function targets() { return (await fetch('http://127.0.0.1:9222/json')).json() }
async function connect(wsUrl) {
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
  // auto-accept beforeunload / confirm dialogs so a discarded appraisal never blocks us
  await call('Page.enable')
  ws.addEventListener('message', ev => { const m = JSON.parse(String(ev.data)); if (m.method === 'Page.javascriptDialogOpening') call('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}) })
  return { ws, call, evalJs, close: () => ws.close() }
}

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
    const page = await connect(tab.webSocketDebuggerUrl)
    await page.call('Page.bringToFront').catch(() => {})
    if (await waitFor(page, `__q('#vehicle-info-go') && __vinInput()`, 2500, 500)) return { page, tab }
    page.close()
  }
  const r = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(APPRAISAL_URL)}`, { method: 'PUT' })
  const tab = await r.json()
  const page = await connect(tab.webSocketDebuggerUrl)
  await page.call('Page.bringToFront').catch(() => {})
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

async function captureOne(page, vin) {
  const rec = { vin, startedAt: new Date().toISOString() }
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
      const na = fe && /not available/i.test((fe.closest('div')||fe).textContent||'');
      const modalUp = !!(__btnByText('Ignore') || __btnByText('Copy Information'));
      return (fe && !fe.disabled && !modalUp) ? 'ready' : 'wait'; })()`)
    if (st === 'ignore') { await realClick(page, "__btnByText('Ignore')"); rec.duplicateModal = 'ignored'; await sleep(900); continue }
    if (st === 'ready') { decoded = true; break }
  }
  if (!decoded) {
    rec.result = 'DECODE_TIMEOUT'
    rec.state = await page.evalJs(`(() => { ${pageHelpers} const fe = __q('#window-sticker-container');
      return { vin: __vinInput() && __vinInput().value, feExists: !!fe, feDisabled: fe && fe.disabled, feAria: fe && fe.getAttribute('aria-disabled'),
        visibleButtons: [...__sr.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => (b.textContent||'').trim().slice(0,20)).filter(Boolean).slice(0,20),
        selects: [...__sr.querySelectorAll('select')].slice(0,5).map(s => (s.selectedOptions[0]||{}).textContent) }; })()`)
    return rec
  }
  await sleep(1500)
  // tooltip "Build data not available for YYYY Make" shows on hover; test it by reading the button's own attributes/title
  const fe = await page.evalJs(`(() => { ${pageHelpers} const b = __q('#window-sticker-container'); return { disabled: !!b.disabled, aria: b.getAttribute('aria-disabled'), title: b.title, cls: String(b.className).slice(0,80) }; })()`)
  rec.buttonState = fe
  await realClick(page, "__q('#window-sticker-container')")
  // wait for a new target (popup)
  let popup = null
  for (let i = 0; i < 20 && !popup; i++) { await sleep(700); popup = (await targets()).find(t => !before.has(t.id) && t.type === 'page') }
  if (!popup) {
    // no popup: read the tooltip text if the page rendered one
    rec.result = 'NO_POPUP'
    rec.tooltip = await page.evalJs(`(() => { const tips=[...document.querySelectorAll('ids-tooltip, [role=tooltip]')].map(t=>(t.shadowRoot?t.shadowRoot.textContent:t.textContent)||'').map(s=>s.trim()).filter(Boolean); return tips.slice(0,3); })()`)
    return rec
  }
  rec.popup = { title: popup.title, url: (popup.url || '').slice(0, 200) }
  const pp = await connect(popup.webSocketDebuggerUrl)
  await sleep(2500)
  rec.content = await pp.evalJs(`(() => ({
    title: document.title, url: location.href.slice(0,200), bodyChars: (document.body?.innerText||'').length,
    imgs: [...document.images].map(i => ({ src: (i.currentSrc||i.src||'').slice(0,300), w: i.naturalWidth, h: i.naturalHeight })).slice(0,10),
    frames: [...document.querySelectorAll('iframe,embed,object')].map(f => ({ tag: f.tagName, src: (f.src||f.data||'').slice(0,300) })).slice(0,10),
    links: [...document.links].map(a => a.href.slice(0,200)).slice(0,10),
    text: (document.body?.innerText||'').slice(0, 1500)
  }))()`)
  await pp.call('Page.close').catch(() => {})
  pp.close()
  rec.result = 'OK'
  return rec
}

const [,, cmd, a1, a2, ...rest] = process.argv
if (cmd === 'probe') {
  const { page } = await getAppraisalPage()
  await discardCurrent(page)
  const rec = await captureOne(page, a1)
  await discardCurrent(page)
  page.close()
  console.log(JSON.stringify(rec, null, 1))
} else if (cmd === 'run') {
  const max = rest.includes('--max') ? Number(rest[rest.indexOf('--max') + 1]) : 999
  const work = JSON.parse(readFileSync(a1, 'utf8'))
  let out = { schema: 'vauto-factory-equipment-capture-v1', startedAt: new Date().toISOString(), records: [] }
  try { const prev = JSON.parse(readFileSync(a2, 'utf8')); if (Array.isArray(prev.records)) out = prev } catch {}
  const done = new Set(out.records.filter(r => r.result === 'OK').map(r => r.vin))
  out.records = out.records.filter(r => r.result === 'OK')          // retry anything that was not OK
  const queue = work.filter(w => !done.has(w.vin)).slice(0, max)
  console.log(JSON.stringify({ resume: done.size, queued: queue.length }))
  let page = null
  const fresh = async () => { try { page && page.close() } catch {} ; ({ page } = await getAppraisalPage()); await discardCurrent(page) }
  try { await fresh() } catch (e) { console.error('initial reset failed once: ' + e.message); await sleep(5000); await fresh() }
  for (const w of queue) {
    let rec
    try { rec = await captureOne(page, w.vin) }
    catch (e) { rec = { vin: w.vin, result: 'ERROR', error: String(e.message).slice(0, 200) } }
    out.records.push(rec)
    writeFileSync(a2, JSON.stringify(out, null, 1))
    try { await discardCurrent(page) } catch (e) { try { await fresh() } catch (e2) { console.error('reconnect failed: ' + e2.message); break } }
  }
  try { page && page.close() } catch {}
  console.log(JSON.stringify({ done: out.records.length, ok: out.records.filter(r => r.result === 'OK').length }))
} else { console.error('usage: probe <VIN> | run <worklist.json> <out.json> [--max N]'); process.exit(2) }
