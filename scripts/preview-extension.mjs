// Serves the side panel as a plain page for design review and screenshots:
//   pnpm dev:demo   (in another terminal)
//   pnpm extension:preview  ->  http://127.0.0.1:4177/sidepanel/index.html
// /api/* is proxied to the synthetic demo API so the page is same-origin and
// needs no extension APIs. Never point this at the production host.
import { createServer, request as httpRequest } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'extension')
const port = Number(process.env.EXTENSION_PREVIEW_PORT || 4177)
const demoApi = { host: '127.0.0.1', port: Number(process.env.INVENTORY_DEMO_API_PORT || 4174) }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' }

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (url.pathname.startsWith('/api/')) {
    const upstream = httpRequest({ ...demoApi, method: req.method, path: url.pathname + url.search, headers: { ...req.headers, host: `${demoApi.host}:${demoApi.port}` } }, (proxied) => {
      res.writeHead(proxied.statusCode ?? 502, proxied.headers)
      proxied.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'demo API unavailable', code: 'DEMO_OFFLINE' })) })
    req.pipe(upstream)
    return
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\\/])+/, '')
  const file = join(root, relative)
  if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403); res.end(); return }
  let stat
  try { stat = statSync(file) } catch { res.writeHead(404); res.end('not found'); return }
  if (stat.isDirectory()) { res.writeHead(302, { location: url.pathname.replace(/\/?$/, '/') + 'index.html' }); res.end(); return }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`Extension preview: http://127.0.0.1:${port}/sidepanel/index.html  (demo API expected on ${demoApi.port})`))
