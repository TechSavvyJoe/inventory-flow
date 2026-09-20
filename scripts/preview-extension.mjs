// Serves the side panel as a plain page for design review and screenshots:
//   pnpm dev:demo   (in another terminal)
//   pnpm extension:preview  ->  http://127.0.0.1:4177/sidepanel/index.html
// "/" and "/index.html" 302-redirect to /sidepanel/index.html so the server
// root is never a bare directory listing or a 404.
// /api/* is proxied to the synthetic demo API so the page is same-origin and
// needs no extension APIs. Never point this at the production host.
import { createServer, request as httpRequest } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYNTHETIC_VEHICLE_PHOTOS } from '../extension/sidepanel/lib/synthetic-photos.mjs'

const root = resolve(import.meta.dirname, '..', 'extension')
const demoPhotoRoot = resolve(import.meta.dirname, '..', 'public', 'demo-vehicles')
const demoPhotoPaths = new Set(Object.values(SYNTHETIC_VEHICLE_PHOTOS))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' }

export function createExtensionPreviewServer({ demoApiPort = Number(process.env.INVENTORY_DEMO_API_PORT || 4174) } = {}) {
 const demoApi = { host: '127.0.0.1', port: demoApiPort }
 return createServer((req, res) => {
  let pathname
  let url
  try {
    pathname = decodeURIComponent((req.url ?? '/').split(/[?#]/, 1)[0])
    if (pathname.split(/[\\/]/).some((part) => part === '..')) { res.writeHead(403); res.end(); return }
    url = new URL(req.url, 'http://127.0.0.1')
  } catch { res.writeHead(400); res.end('invalid path'); return }
  if (url.pathname.startsWith('/api/')) {
    const upstream = httpRequest({ ...demoApi, method: req.method, path: url.pathname + url.search, headers: { ...req.headers, host: `${demoApi.host}:${demoApi.port}` } }, (proxied) => {
      res.writeHead(proxied.statusCode ?? 502, proxied.headers)
      proxied.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'demo API unavailable', code: 'DEMO_OFFLINE' })) })
    req.pipe(upstream)
    return
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
  if (pathname === '/' || pathname === '/index.html') { res.writeHead(302, { location: '/sidepanel/index.html' }); res.end(); return }
  let file
  if (pathname.startsWith('/demo-vehicles')) {
    // Fixed, reviewed synthetic assets only. Never expose public/, a parent
    // repository folder, or a path derived from an API image URL.
    if (!demoPhotoPaths.has(pathname)) { res.writeHead(404); res.end('not found'); return }
    file = join(demoPhotoRoot, pathname.slice('/demo-vehicles/'.length))
  } else {
    const relative = normalize(pathname).replace(/^(\.\.[\\/])+/, '')
    file = join(root, relative)
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403); res.end(); return }
  }
  let stat
  try { stat = statSync(file) } catch { res.writeHead(404); res.end('not found'); return }
  if (stat.isDirectory()) { res.writeHead(302, { location: url.pathname.replace(/\/?$/, '/') + 'index.html' }); res.end(); return }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
 })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.EXTENSION_PREVIEW_PORT || 4177)
  const demoApiPort = Number(process.env.INVENTORY_DEMO_API_PORT || 4174)
  createExtensionPreviewServer({ demoApiPort }).listen(port, '127.0.0.1', () => console.log(`Extension preview: http://127.0.0.1:${port}/sidepanel/index.html  (demo API expected on ${demoApiPort})`))
}
