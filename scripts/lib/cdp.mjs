// lib/cdp.mjs — shared Chrome DevTools Protocol helpers for the background capture scripts.
// Talks only to the automation browser on 127.0.0.1:9222. Every fetch runs INSIDE an
// existing authenticated tab (credentials: 'include'), so no cookie or credential is ever
// read, stored or transmitted by these scripts; the browser does the request itself.
export const PORT = 9222
export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function targets() { return (await fetch(`http://127.0.0.1:${PORT}/json`)).json() }

export async function connect(wsUrl, { timeoutMs = 30000 } = {}) {
  const ws = new WebSocket(wsUrl)
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', () => j(new Error('CDP_WS_CONNECT_FAILED')), { once: true }) })
  let id = 0
  const call = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', h); rej(new Error(method + ': CDP_TIMEOUT')) }, timeoutMs)
    const h = ev => { const m = JSON.parse(String(ev.data)); if (m.id !== my) return; clearTimeout(timer); ws.removeEventListener('message', h); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result) }
    ws.addEventListener('message', h); ws.send(JSON.stringify({ id: my, method, params }))
  })
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('page JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
  await call('Page.enable')
  return { ws, call, evalJs, close: () => { try { ws.close() } catch {} } }
}

// Find a tab already on `origin` (https://host). If none, reuse an idle new-tab page or open
// one, navigate it to `landingUrl`, and wait for the document to settle. The automation
// browser runs minimized / off-screen, so nothing is shown to the user either way.
export async function getOriginTab(origin, landingUrl, { settleMs = 60000 } = {}) {
  const list = await targets()
  let tab = list.find(t => t.type === 'page' && (t.url || '').startsWith(origin + '/'))
  let opened = false
  if (!tab) {
    const idle = list.find(t => t.type === 'page' && /^(chrome|comet):\/\/newtab\/?$|^about:blank$/i.test(t.url || ''))
    if (idle) {
      const p = await connect(idle.webSocketDebuggerUrl)
      await p.call('Page.navigate', { url: landingUrl }); p.close()
      tab = idle
    } else {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(landingUrl)}`, { method: 'PUT' })
      tab = await r.json()
    }
    opened = true
  }
  const page = await connect(tab.webSocketDebuggerUrl)
  const probe = () => page.evalJs(`({ host: location.host, href: location.href.slice(0, 200), ready: document.readyState, title: document.title.slice(0, 120) })`).catch(() => null)
  const t0 = Date.now()
  let st = null
  while (Date.now() - t0 < settleMs) {
    st = await probe()
    if (st && st.ready === 'complete' && (st.href.startsWith(origin) || !opened)) break
    await sleep(1000)
  }
  return { page, tab, opened, state: st || await probe() }
}

// Credentialed fetch performed by the page itself. Text responses come back as text; binary
// responses (PDF) come back base64. Never logs the body.
export async function fetchInTab(page, url, { binary = false, headers = {}, timeoutMs = 60000 } = {}) {
  const expr = `(async () => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ${timeoutMs});
    try {
      const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', cache: 'no-store', redirect: 'follow', signal: ctl.signal, headers: ${JSON.stringify(headers)} });
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
  return page.evalJs(expr)
}

// Very small HTML helper for server-rendered pages (no DOM library in Node).
export const stripTags = s => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim()
