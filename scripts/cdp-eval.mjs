// cdp-eval.mjs <url-regex> <js-expression>  — evaluate JS in the main world of the first matching page target
const [,, pattern, expression] = process.argv
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const tab = list.find(t => t.type === 'page' && new RegExp(pattern, 'i').test(t.url))
if (!tab) { console.error('NO_TAB'); process.exit(2) }
const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', () => j(new Error('ws')), { once: true }) })
const call = (id, method, params) => new Promise((res, rej) => {
  const h = ev => { const m = JSON.parse(String(ev.data)); if (m.id !== id) return; ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) }
  ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params }))
})
const r = await call(1, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.exceptionDetails ? { error: r.exceptionDetails.text, ...r.exceptionDetails } : r.result.value))
ws.close()
