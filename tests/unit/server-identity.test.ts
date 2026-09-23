// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease } from '../../fixtures/synthetic-release.mjs'
import { buildAttentionMutation } from '../../server/attention-workflow.mjs'
import { createIdentityResolver } from '../../server/identity.mjs'
import { startInventoryServer } from '../../server/index.mjs'
import { buildTransferEvent, WorkflowError } from '../../server/workflow.mjs'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

describe('Node server is synthetic-demo only', () => {
  it('refuses production identity whatever mode is requested', () => {
    // The Worker resolves production identity from Access + D1; the Node
    // server has no production identity mode to select.
    for (const options of [{ environment: 'production' }, { environment: 'production', mode: 'demo' }]) {
      expect(() => createIdentityResolver(options)).toThrowError(expect.objectContaining({ code: 'NODE_SERVER_DEMO_ONLY' }))
    }
    expect(createIdentityResolver({ environment: 'development' }).mode).toBe('demo')
    expect(createIdentityResolver({ environment: 'test' })).toBe(createIdentityResolver({ environment: 'development' }))
  })

  it('needs an explicit synthetic release loader and refuses a file-backed ledger before opening data', () => {
    expect(() => startInventoryServer({ port: 0 })).toThrowError(expect.objectContaining({ code: 'SYNTHETIC_RELEASE_LOADER_REQUIRED' }))
    const folder = mkdtempSync(path.join(tmpdir(), 'inventory-flow-demo-only-'))
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }))
    const databasePath = path.join(folder, 'inventory-ops.sqlite')
    expect(() => startInventoryServer({ port: 0, databasePath, releaseLoader: () => buildSyntheticRelease() }))
      .toThrowError(expect.objectContaining({ code: 'FILE_LEDGER_REFUSED' }))
    expect(existsSync(databasePath)).toBe(false)
    expect(() => startInventoryServer({ port: 0, environment: 'production', releaseLoader: () => buildSyntheticRelease() }))
      .toThrowError(expect.objectContaining({ code: 'NODE_SERVER_DEMO_ONLY' }))
  })

  it('serves the in-memory synthetic release through the demo identity', async () => {
    const app = startInventoryServer({ port: 0, releaseLoader: () => buildSyntheticRelease() })
    cleanups.push(() => app.close())
    await new Promise((resolve) => (app.server.listening ? resolve(undefined) : app.server.once('listening', resolve)))
    expect(app.refreshResult).toMatchObject({ ok: true })
    const { port } = app.server.address()
    const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, {
      headers: { 'x-inventory-demo-role': 'sales', 'x-inventory-demo-store': 'Howell', 'x-inventory-demo-user': 'Demo user' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).access).toMatchObject({ user: 'Demo user', role: 'sales', store: 'Howell' })
  })
})

// The only ROLE_MISMATCH coverage used to run through the retired trusted-proxy
// harness. These pin it on the shared functions the Worker itself runs.
describe('actor role must match the active role context', () => {
  const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic Fowlerville manager', userId: 'manager-1' }
  const current = {
    id: 'synthetic-transfer-1', status: 'requested', requesting_store_id: 'Fowlerville', home_store_id: 'Howell',
    destination_store_id: 'Fowlerville', current_location_id: 'Howell',
  }

  it.each([
    ['simple', { type: 'request_approved', availabilityConfirmed: true }],
    ['advanced', { type: 'manager_reviewed' }],
  ])('buildTransferEvent rejects a claimed group manager for a manager context (%s mode)', (workflowMode, event) => {
    const context = { ...manager, workflowMode }
    expect(buildTransferEvent({ current, input: event, context }).event.actorRole).toBe('manager')
    let error
    try {
      buildTransferEvent({ current, input: { ...event, actorRole: 'group_manager' }, context })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(WorkflowError)
    expect(error).toMatchObject({ status: 403, code: 'ROLE_MISMATCH' })
  })

  it('buildAttentionMutation rejects a claimed group manager for a manager context', () => {
    const sourceItem = { id: 'synthetic-attention-1', type: 'transfer_next_action', store: 'Fowlerville', severity: 'warning' }
    expect(buildAttentionMutation({ sourceItem, current: null, input: { type: 'acknowledge' }, context: manager }).event.actorRole).toBe('manager')
    let error
    try {
      buildAttentionMutation({ sourceItem, current: null, input: { type: 'acknowledge', actorRole: 'group_manager' }, context: manager })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(WorkflowError)
    expect(error).toMatchObject({ status: 403, code: 'ROLE_MISMATCH' })
  })
})
