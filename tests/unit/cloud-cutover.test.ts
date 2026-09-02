// @ts-nocheck -- Node-only ESM test, outside the browser declaration bundle.
// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertLocalLedgerWritable } from '../../server/local-cutover.mjs'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
it('prevents split writable ledgers after explicit cloud cutover without affecting the synthetic demo', () => {
  const runtimeDir = mkdtempSync(path.join(tmpdir(), 'inventory-flow-cutover-'))
  folders.push(runtimeDir)
  const databasePath = path.join(runtimeDir, 'inventory-ops.sqlite')
  expect(() => assertLocalLedgerWritable({ databasePath, runtimeDir })).not.toThrow()
  writeFileSync(path.join(runtimeDir, 'cloud-cutover.json'), '{"fixture":"SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS"}')
  expect(() => assertLocalLedgerWritable({ databasePath, runtimeDir })).toThrow('Live saved activity has moved')
  expect(() => assertLocalLedgerWritable({ databasePath: ':memory:', runtimeDir })).not.toThrow()
})
