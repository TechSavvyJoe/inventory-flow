// lib/cdp.mjs — shared Chrome DevTools Protocol helpers for the background capture scripts.
// Talks only to the automation browser on 127.0.0.1:9222. Every fetch runs INSIDE an
// existing authenticated tab (credentials: 'include'), so no cookie or credential is ever
// read, stored or transmitted by these scripts; the browser does the request itself.
export const PORT = 9222
export const sleep = ms => new Promise(r => setTimeout(r, ms))

// Source systems are read-only evidence. fetchInTab sends a POST only to an
// exact URL listed here, each one a read that the source exposes as a form POST.
// Ford PTS returns a repair order's detail only to this XHR form POST.
export const PTS_REPAIR_ORDER_DETAILS_URL = 'https://www.fordtechservice.dealerconnection.com/VehicleService/Details'
export const READ_ONLY_POST_URLS = Object.freeze([PTS_REPAIR_ORDER_DETAILS_URL])

export async function targets({ timeoutMs = 10000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`CDP_TARGETS_HTTP_${response.status}`)
  return response.json()
}

export async function connect(wsUrl, { timeoutMs = 30000, connectTimeoutMs = 10000 } = {}) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeEventListener('open', opened)
      ws.removeEventListener('error', failed)
    }
    const opened = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(new Error('CDP_WS_CONNECT_FAILED')) }
    timer = setTimeout(() => {
      cleanup()
      try { ws.close() } catch {}
      reject(new Error('CDP_WS_CONNECT_TIMEOUT'))
    }, connectTimeoutMs)
    ws.addEventListener('open', opened, { once: true })
    ws.addEventListener('error', failed, { once: true })
  })
  let id = 0
  const call = (method, params = {}, { timeoutMs: callTimeoutMs = timeoutMs } = {}) => new Promise((res, rej) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', h); rej(new Error(method + ': CDP_TIMEOUT')) }, callTimeoutMs)
    const h = ev => {
      let m
      try { m = JSON.parse(String(ev.data)) } catch { return }
      if (m.id !== my) return
      clearTimeout(timer)
      ws.removeEventListener('message', h)
      m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)
    }
    ws.addEventListener('message', h)
    try { ws.send(JSON.stringify({ id: my, method, params })) }
    catch (error) { clearTimeout(timer); ws.removeEventListener('message', h); rej(error) }
  })
  const evalJs = async (expression, options = {}) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, options)
    if (r.exceptionDetails) throw new Error('page JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
  try {
    await call('Page.enable')
  } catch (error) {
    // connect() has not returned a page handle yet, so its caller cannot close
    // this socket when the first CDP command times out. Close it here or every
    // wedged candidate tab leaves a live handle that keeps unattended Node
    // captures running after they have printed their final result.
    try { ws.close() } catch {}
    throw error
  }
  return { ws, call, evalJs, close: () => { try { ws.close() } catch {} } }
}

// Find a tab already on `origin` (https://host). If none, reuse an idle new-tab page or open
// one, navigate it to `landingUrl`, and wait for the document to settle. The automation
// browser runs minimized / off-screen, so nothing is shown to the user either way.
export async function getOriginTab(origin, landingUrl, {
  settleMs = 60000,
  connectTimeoutMs = 10000,
  commandTimeoutMs = 30000,
} = {}) {
  const list = await targets()
  const probeExpression = `({ host: location.host, href: location.href.slice(0, 200), ready: document.readyState, title: document.title.slice(0, 120) })`
  for (const candidate of list.filter(t => t.type === 'page' && (t.url || '').startsWith(origin + '/'))) {
    let candidatePage
    try {
      candidatePage = await connect(candidate.webSocketDebuggerUrl, {
        timeoutMs: Math.min(commandTimeoutMs, 10000),
        connectTimeoutMs,
      })
      const state = await candidatePage.evalJs(probeExpression, { timeoutMs: 5000 })
      if (state?.href?.startsWith(origin)) return { page: candidatePage, tab: candidate, opened: false, state }
    } catch {}
    try { candidatePage?.close() } catch {}
  }

  let tab = null
  let opened = false
  let navigated = false
  const idle = list.find(t => t.type === 'page' && /^(chrome|comet):\/\/newtab\/?$|^about:blank$/i.test(t.url || ''))
  if (idle) {
    const p = await connect(idle.webSocketDebuggerUrl, { timeoutMs: commandTimeoutMs, connectTimeoutMs })
    try { await p.call('Page.navigate', { url: landingUrl }) }
    finally { p.close() }
    tab = idle
    navigated = true
  } else {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(landingUrl)}`, { method: 'PUT', signal: AbortSignal.timeout(connectTimeoutMs) })
    if (!r.ok) throw new Error(`CDP_NEW_TAB_HTTP_${r.status}`)
    // Ownership begins at the successful creation response, before parsing
    // its body. Never mistake a pre-existing tab for one this script owns.
    opened = true
    navigated = true
    tab = await r.json()
  }
  let page
  try { page = await connect(tab.webSocketDebuggerUrl, { timeoutMs: commandTimeoutMs, connectTimeoutMs }) }
  catch (error) {
    if (opened && tab?.id) {
      try { await fetch(`http://127.0.0.1:${PORT}/json/close/${encodeURIComponent(tab.id)}`, { method: 'POST', signal: AbortSignal.timeout(5000) }) } catch {}
    }
    throw error
  }
  const probe = () => page.evalJs(probeExpression).catch(() => null)
  const t0 = Date.now()
  let st = null
  while (Date.now() - t0 < settleMs) {
    st = await probe()
    if (st && st.ready === 'complete' && (st.href.startsWith(origin) || !navigated)) break
    await sleep(1000)
  }
  return { page, tab, opened, state: st || await probe() }
}

export async function closeOwnedTab(context) {
  if (!context) return
  if (context.opened) {
    try { await context.page?.call('Page.close', {}, { timeoutMs: 5000 }) } catch {}
  }
  try { context.page?.close() } catch {}
}

// Credentialed fetch performed by the page itself. Text responses come back as text; binary
// responses (PDF) come back base64. Never logs the body.
export async function fetchInTab(page, url, {
  binary = false,
  headers = {},
  timeoutMs = 60000,
  method = 'GET',
  body = null,
} = {}) {
  const requestMethod = String(method || 'GET').toUpperCase()
  if (!['GET', 'POST'].includes(requestMethod)) throw new Error(`UNSUPPORTED_FETCH_METHOD_${requestMethod}`)
  if (requestMethod === 'POST' && !READ_ONLY_POST_URLS.includes(url)) throw new Error('FETCH_POST_NOT_ALLOWLISTED')
  const expr = `(async () => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ${timeoutMs});
    try {
      const r = await fetch(${JSON.stringify(url)}, {
        credentials: 'include', cache: 'no-store', redirect: 'follow', signal: ctl.signal,
        method: ${JSON.stringify(requestMethod)}, headers: ${JSON.stringify(headers)},
        body: ${body == null ? 'undefined' : JSON.stringify(String(body))}
      });
      const ct = r.headers.get('content-type') || '';
      const finalUrl = r.url;
      if (${binary ? 'true' : 'false'} && r.ok && !/text\\/html/i.test(ct)) {
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = ''; const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
        return { status: r.status, contentType: ct, finalUrl, base64: btoa(bin), bytes: buf.length };
      }
      const text = await r.text();
      return { status: r.status, contentType: ct, finalUrl, text, bytes: text.length };
    } catch (e) { return { status: 0, error: String(e).slice(0, 200) }; }
    finally { clearTimeout(timer); }
  })()`
  // The outer CDP command must outlive the in-page AbortController or a slow
  // request is mislabeled as a websocket failure before fetch can report it.
  return page.evalJs(expr, { timeoutMs: timeoutMs + 5000 })
}

// Very small HTML helper for server-rendered pages (no DOM library in Node).
export const stripTags = s => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim()
