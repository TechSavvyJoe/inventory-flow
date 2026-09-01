import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSyntheticRelease,
  SYNTHETIC_NOW,
  SYNTHETIC_REPORT_DATE,
} from '../fixtures/synthetic-release.mjs'
import { startInventoryServer } from '../server/index.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(scriptDirectory, '..')
const port = Number.parseInt(process.env.INVENTORY_OPS_PORT || '4174', 10)

const fixedNow = () => new Date(SYNTHETIC_NOW)

const app = startInventoryServer({
  workspaceRoot: appDirectory,
  databasePath: ':memory:',
  distDir: path.join(appDirectory, 'dist'),
  serveDist: process.argv.includes('--serve-dist'),
  port: Number.isFinite(port) ? port : 4174,
  refreshIntervalMs: 0,
  now: fixedNow,
  releaseLoader: () => buildSyntheticRelease(),
})

function seedSyntheticWorkflow() {
  const approved = app.service.createTransfer(
    {
      vin: 'TESTDATAHWELL0001',
      requestingStore: 'Fowlerville',
      requestedBy: 'Demo Fowlerville Salesperson',
      neededBy: '2026-08-30T14:30:00-04:00',
      returnDueAt: '2026-08-31T17:00:00-04:00',
      reason: 'Synthetic customer demonstration — training data only',
      customerReference: 'Synthetic customer',
      customerAppointment: true,
      priority: 'high',
      approvalOwner: 'Demo Fowlerville Manager',
    },
    { role: 'sales', store: 'Fowlerville', user: 'Demo Fowlerville Salesperson' },
    'synthetic-demo-approved-request',
  )

  if (approved.created) {
    app.service.appendTransferEvent(
      approved.record.id,
      { type: 'manager_reviewed', note: 'Synthetic requesting-manager review.' },
      { role: 'manager', store: 'Fowlerville', user: 'Demo Fowlerville Manager' },
      'synthetic-demo-manager-reviewed',
    )
    app.service.appendTransferEvent(
      approved.record.id,
      {
        type: 'approved',
        homeStoreManager: 'Demo Howell Used Manager',
        note: 'Synthetic Home Store release confirmation for training only.',
      },
      { role: 'manager', store: 'Fowlerville', user: 'Demo Fowlerville Manager' },
      'synthetic-demo-approved',
    )
    app.service.appendTransferEvent(
      approved.record.id,
      { type: 'driver_requested', note: 'Synthetic driver request; no real transport was contacted.' },
      { role: 'sales', store: 'Fowlerville', user: 'Demo Fowlerville Salesperson' },
      'synthetic-demo-driver-requested',
    )
  }

  app.service.createTransfer(
    {
      vin: 'TESTDATALNCN00002',
      requestingStore: 'Ford Detroit',
      requestedBy: 'Demo Detroit Salesperson',
      neededBy: '2026-08-31T11:00:00-04:00',
      reason: 'Synthetic cross-store showing request — training data only',
      priority: 'normal',
      approvalOwner: 'Demo Detroit Manager',
    },
    { role: 'sales', store: 'Ford Detroit', user: 'Demo Detroit Salesperson' },
    'synthetic-demo-pending-request',
  )
}

try {
  seedSyntheticWorkflow()
  console.log(`Synthetic collaboration fixture loaded for ${SYNTHETIC_REPORT_DATE}; no dealership data was read.`)
} catch (error) {
  console.error(`Synthetic fixture seed failed: ${String(error?.message || error)}`)
  await app.close()
  process.exitCode = 1
}

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await app.close()
    process.exitCode = 0
  } catch (error) {
    console.error(String(error?.message || error))
    process.exitCode = 1
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
