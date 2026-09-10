// Temporary live diagnostics are reduced in memory to runtime outcomes only.
// Request URLs, headers, exception messages and payloads are never printed/saved.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const child = spawn(process.execPath, [bin, 'tail', 'inventory-flow-integrations', '--format', 'json'], { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
let pending = '', count = 0
child.stdout.on('data', chunk => {
  pending += chunk.toString()
  if (pending.length > 1048576) { pending = ''; return }
  for (;;) {
    const begin = pending.indexOf('{')
    if (begin < 0) { pending = ''; break }
    let quoted = false, escaped = false, depth = 0, end = -1
    for (let i = begin; i < pending.length; i++) {
      const char = pending[i]
      if (escaped) { escaped = false; continue }
      if (quoted && char === '\\') { escaped = true; continue }
      if (char === '"') { quoted = !quoted; continue }
      if (quoted) continue
      if (char === '{') depth++
      else if (char === '}' && --depth === 0) { end = i + 1; break }
    }
    if (end < 0) { pending = pending.slice(begin); break }
    const raw = pending.slice(begin, end)
    pending = pending.slice(end)
    try {
      const event = JSON.parse(raw)
      const outcome = typeof event.outcome === 'string' && /^[a-zA-Z_]{1,50}$/.test(event.outcome) ? event.outcome : null
      if (outcome) { count++; console.log(JSON.stringify({ outcome, cpuTime: typeof event.cpuTime === 'number' ? event.cpuTime : null, wallTime: typeof event.wallTime === 'number' ? event.wallTime : null, exceptionCount: event.exceptions?.length ?? 0 })) }
    } catch { /* Ignore non-event transport text. */ }
  }
})
child.stderr.resume()
setTimeout(() => { child.kill(); console.log(JSON.stringify({ diagnosticCompleted: true, eventCount: count })) }, 25000)
