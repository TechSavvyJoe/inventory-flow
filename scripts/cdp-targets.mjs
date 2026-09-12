// cdp-targets.mjs — list every DevTools target (pages, iframes, workers) on 127.0.0.1:9222
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json()
const ws = new WebSocket(ver.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', () => j(new Error('ws')), { once: true }) })
const call = (id, method, params) => new Promise((res, rej) => {
  const h = ev => { const m = JSON.parse(String(ev.data)); if (m.id !== id) return; ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) }
  ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params }))
})
const { targetInfos } = await call(1, 'Target.getTargets', {})
const filt = process.argv[2] ? new RegExp(process.argv[2], 'i') : null
for (const t of targetInfos) {
  if (filt && !filt.test(t.url + ' ' + t.title)) continue
  console.log(`${t.type.padEnd(9)} ${t.targetId}  ${(t.url || '').slice(0, 110)}  [${(t.title || '').slice(0, 40)}]`)
}
ws.close()
