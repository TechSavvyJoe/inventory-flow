import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInventoryServer } from './api.mjs'
import { getCurrentDataset, importRelease, openInventoryDatabase } from './database.mjs'
import { createIdentityResolver } from './identity.mjs'
import { createInventoryService } from './service.mjs'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(serverDirectory, '..')

export class DemoServerConfigurationError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'DemoServerConfigurationError'
    this.code = code
  }
}

function safeErrorMessage(error) {
  return String(error?.message || 'Unknown source refresh error').slice(0, 500)
}

// The Node server hosts only the synthetic demo (scripts/start-synthetic-demo.mjs).
// It never loads a dealership release on its own and never opens a file-backed
// ledger: live saved activity runs on the Cloudflare Worker.
export function startInventoryServer({
  releaseLoader,
  databasePath = ':memory:',
  distDir = path.join(appDirectory, 'dist'),
  serveDist = false,
  host = '127.0.0.1',
  port = 4174,
  refreshIntervalMs = 0,
  now = () => new Date(),
  environment = process.env.NODE_ENV || 'development',
  adminDirectory,
} = {}) {
  if (typeof releaseLoader !== 'function') {
    throw new DemoServerConfigurationError(
      'The Node server needs an explicit synthetic releaseLoader; it never loads a dealership release.',
      'SYNTHETIC_RELEASE_LOADER_REQUIRED',
    )
  }
  if (databasePath !== ':memory:') {
    throw new DemoServerConfigurationError(
      'The Node server keeps its demo ledger in memory and refuses a file-backed database. Live saved activity is at https://inventory-ops.joegallant.me; use pnpm dev:demo for synthetic development.',
      'FILE_LEDGER_REFUSED',
    )
  }
  // Resolve the trust boundary before opening data or binding a port so a
  // production configuration fails closed during startup.
  const identityResolver = createIdentityResolver({ environment })
  const database = openInventoryDatabase({ databasePath })
  const initialStatus = { lastAttemptAt: null, lastSuccessAt: null, error: null }
  const service = createInventoryService({ database, now, initialLoadStatus: initialStatus })

  function refresh() {
    const attemptedAt = now().toISOString()
    try {
      const release = releaseLoader({ now: now() })
      importRelease(database, release, { loadedAt: attemptedAt })
      service.setLoadStatus({ lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, error: null })
      return { ok: true, reportDate: release.reportDate }
    } catch (error) {
      const message = safeErrorMessage(error)
      service.setLoadStatus({ lastAttemptAt: attemptedAt, error: message })
      const retained = getCurrentDataset(database)
      return { ok: false, retainedReportDate: retained.state.current_report_date || null, error: message }
    }
  }

  const refreshResult = refresh()
  const server = createInventoryServer({ service, serveDist, distDir, identityResolver, adminDirectory })
  const timer = refreshIntervalMs > 0 ? setInterval(refresh, refreshIntervalMs) : null
  timer?.unref()

  // A busy port is the most common local start failure. Left unhandled, the
  // server's 'error' event prints a bare stack trace and exits; this states
  // the cause and the fix instead.
  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} on ${host} is already in use. Stop the other Inventory Flow server, ` +
          `or start this one with INVENTORY_OPS_PORT=<free port>.`,
      )
    } else if (error?.code === 'EACCES') {
      console.error(`Permission denied binding ${host}:${port}. Choose a port above 1024.`)
    } else {
      console.error(`Inventory Flow server failed to start: ${safeErrorMessage(error)}`)
    }
    process.exitCode = 1
    try {
      database.close()
    } catch {
      // Shutdown path: the database may already be closed.
    }
  })

  server.listen(port, host, () => {
    const address = server.address()
    const activePort = typeof address === 'object' && address ? address.port : port
    const sourceNote = refreshResult.ok
      ? `synthetic release ${refreshResult.reportDate}`
      : `retained release ${refreshResult.retainedReportDate || 'none'} (refresh failed)`
    console.log(`Maxey Inventory Flow demo server listening on http://${host}:${activePort} — ${sourceNote}`)
  })

  function close() {
    if (timer) clearInterval(timer)
    return new Promise((resolve, reject) => {
      server.close((error) => {
        try {
          database.close()
        } catch {
          // The database may already be closed during process shutdown.
        }
        if (error) reject(error)
        else resolve()
      })
    })
  }

  return { server, service, database, refresh, close, refreshResult }
}
