import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInventoryServer } from './api.mjs'
import { getCurrentDataset, importRelease, openInventoryDatabase } from './database.mjs'
import { createIdentityResolver } from './identity.mjs'
import { loadLatestCompletedRelease } from './importer.mjs'
import { createInventoryService } from './service.mjs'
import { assertLocalLedgerWritable } from './local-cutover.mjs'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(serverDirectory, '..')
const defaultWorkspaceRoot = path.resolve(appDirectory, '..', '..')

function safeErrorMessage(error) {
  return String(error?.message || 'Unknown source refresh error').slice(0, 500)
}

export function startInventoryServer({
  workspaceRoot = defaultWorkspaceRoot,
  runtimeDir = path.join(appDirectory, 'runtime'),
  databasePath = path.join(runtimeDir, 'inventory-ops.sqlite'),
  distDir = path.join(appDirectory, 'dist'),
  serveDist = false,
  host = '127.0.0.1',
  port = 4174,
  refreshIntervalMs = 5 * 60 * 1000,
  now = () => new Date(),
  releaseLoader = loadLatestCompletedRelease,
  identityMode = process.env.INVENTORY_OPS_IDENTITY_MODE,
  environment = process.env.NODE_ENV || 'development',
  trustedProxySecret = process.env.INVENTORY_OPS_TRUSTED_PROXY_SECRET,
  adminDirectory,
} = {}) {
  assertLocalLedgerWritable({ databasePath, runtimeDir })
  // Resolve the trust boundary before opening data or binding a port so an
  // unsafe production configuration fails closed during startup.
  const identityResolver = createIdentityResolver({ mode: identityMode, environment, trustedProxySecret })
  const database = openInventoryDatabase({ databasePath, runtimeDir })
  const initialStatus = { lastAttemptAt: null, lastSuccessAt: null, error: null }
  const service = createInventoryService({ database, now, initialLoadStatus: initialStatus })

  function refresh() {
    const attemptedAt = now().toISOString()
    try {
      const release = releaseLoader({ workspaceRoot, now: now() })
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
      ? `source release ${refreshResult.reportDate}`
      : `retained release ${refreshResult.retainedReportDate || 'none'} (refresh failed)`
    console.log(`Maxey Inventory Flow server listening on http://${host}:${activePort} — ${sourceNote}`)
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

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const serveDist = process.argv.includes('--serve-dist')
  const port = Number.parseInt(process.env.INVENTORY_OPS_PORT || '4174', 10)
  const app = startInventoryServer({ serveDist, port: Number.isFinite(port) ? port : 4174 })
  let shuttingDown = false
  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await app.close()
      process.exitCode = 0
    } catch (error) {
      console.error(safeErrorMessage(error))
      process.exitCode = 1
    }
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
