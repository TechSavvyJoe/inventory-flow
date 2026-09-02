import { existsSync } from 'node:fs'
import path from 'node:path'

// A deliberate, host-local marker prevents a retired SQLite ledger becoming a
// second writable source of truth. It never affects the in-memory demo.
export function assertLocalLedgerWritable({ databasePath, runtimeDir }) {
  if (databasePath !== ':memory:' && existsSync(path.join(runtimeDir, 'cloud-cutover.json'))) {
    throw new Error('Live saved activity has moved to https://inventory-ops.joegallant.me. Use that app for dealership work, or pnpm dev:demo for synthetic development. The retired local ledger is preserved and cannot be reopened for writes.')
  }
}
