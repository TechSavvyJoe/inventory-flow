// @ts-nocheck -- service adapters intentionally use platform-neutral ESM contracts.
// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import * as sqliteRepository from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { STORE_NAMES } from '../../server/constants.mjs'
import { STORE_NAMES as importedStoreNames } from '../../server/importer.mjs'

const databases = []
afterEach(() => {
  while (databases.length) databases.pop().close()
})

function harness() {
  const database = sqliteRepository.openInventoryDatabase()
  databases.push(database)
  sqliteRepository.importRelease(database, buildSyntheticRelease(), { loadedAt: SYNTHETIC_NOW.toISOString() })
  const options = { database, now: () => new Date(SYNTHETIC_NOW) }
  return {
    database,
    local: createInventoryService(options),
    portable: createInventoryServiceCore({ ...options, repository: sqliteRepository }),
  }
}

describe('portable inventory service core', () => {
  it('keeps the importer store export backward compatible', () => {
    expect(importedStoreNames).toBe(STORE_NAMES)
  })

  it.each(['sales', 'manager', 'group_manager', 'coordinator', 'porter', 'driver'])(
    'preserves complete read responses and redaction for %s', (role) => {
      const { local, portable } = harness()
      const context = { role, store: 'Howell', user: `Synthetic ${role}` }
      expect(portable.health()).toEqual(local.health())
      expect(portable.bootstrap(context)).toEqual(local.bootstrap(context))
      expect(portable.listVehicles({ limit: 50 }, context)).toEqual(local.listVehicles({ limit: 50 }, context))
      expect(portable.listAttention({}, context)).toEqual(local.listAttention({}, context))
      expect(portable.listTransfers({}, context)).toEqual(local.listTransfers({}, context))
      expect(portable.getVehicle('TESTDATAHWELL0001', context)).toEqual(local.getVehicle('TESTDATAHWELL0001', context))
      if (['coordinator', 'porter', 'driver'].includes(role)) {
        expect(portable.getVehicle('TESTDATAHWELL0001', context).privateEvidence).toBeUndefined()
      }
    },
  )

  it('routes mutations through the adapter with unchanged workflow and idempotency behavior', () => {
    const { database, local } = harness()
    const insertTransferRequest = vi.fn((handle, ...args) => {
      expect(handle).toBe(database)
      return sqliteRepository.insertTransferRequest(handle, ...args)
    })
    const portable = createInventoryServiceCore({
      database,
      repository: { ...sqliteRepository, insertTransferRequest },
      now: () => new Date(SYNTHETIC_NOW),
    })
    const context = { role: 'sales', store: 'Fowlerville', user: 'Synthetic Salesperson' }
    const request = {
      vin: 'TESTDATAHWELL0002', requestingStore: 'Fowlerville',
      neededBy: '2026-08-31T14:00:00-04:00', reason: 'Synthetic adapter test request',
    }
    const created = portable.createTransfer(request, context, 'synthetic-portable-transfer')
    expect(created.created).toBe(true)
    expect(insertTransferRequest).toHaveBeenCalledOnce()
    expect(local.getTransfer(created.record.id, context)).toEqual(created.record)
    const replay = local.createTransfer(request, context, 'synthetic-portable-transfer')
    expect(replay.created).toBe(false)
    expect(replay.record).toEqual(created.record)
  })

  it('rejects a missing repository and asynchronous adapters before they can masquerade as sync data', () => {
    expect(() => createInventoryServiceCore({ database: {} })).toThrow('required synchronous storage method')
    const { database } = harness()
    const portable = createInventoryServiceCore({
      database,
      repository: { ...sqliteRepository, getCurrentDataset: async () => ({}) },
    })
    expect(() => portable.health()).toThrow('must be synchronous')
  })

  it('keeps free-form attention notes out of transport-role responses', () => {
    const { database, portable } = harness()
    const manager = { role: 'manager', store: 'Howell', user: 'Synthetic manager' }
    const item = portable.listAttention({}, manager).items.find((candidate) => candidate.allowedActions.includes('acknowledge'))
    expect(item).toBeTruthy()
    const marker = 'SYNTHETIC PRIVATE CUSTOMER NOTE'
    portable.appendAttentionEvent(item.id, { type: 'acknowledge', note: marker }, manager, 'synthetic-private-note')
    database.prepare('UPDATE attention_work_items SET resolution_note=? WHERE attention_key=?').run(marker, item.id)
    expect(JSON.stringify(portable.getAttention(item.id, manager))).toContain(marker)
    for (const role of ['driver', 'porter', 'coordinator']) {
      const context = { role, store: 'Howell', user: `Synthetic ${role}` }
      expect(JSON.stringify(portable.bootstrap(context))).not.toContain(marker)
      expect(JSON.stringify(portable.listAttention({}, context))).not.toContain(marker)
    }
  })

  it('does not transitively import Node filesystem, paths, or SQLite into the portable core', () => {
    const visited = new Set()
    const visit = (url) => {
      if (visited.has(url.href)) return
      visited.add(url.href)
      const source = readFileSync(fileURLToPath(url), 'utf8')
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (specifier.startsWith('.')) visit(new URL(specifier, url))
        else expect(specifier, `${url.pathname} platform dependency`).toBe('node:crypto')
      }
    }
    visit(new URL('../../server/service-core.mjs', import.meta.url))
    expect(visited.size).toBeGreaterThan(3)
    expect([...visited].some((url) => url.endsWith('/database.mjs') || url.endsWith('/importer.mjs'))).toBe(false)
  })
})
