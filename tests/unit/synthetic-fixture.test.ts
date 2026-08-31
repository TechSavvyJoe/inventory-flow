// @ts-nocheck -- repository fixtures and server modules intentionally use Node ESM.
// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSyntheticRelease,
  SYNTHETIC_FIXTURE_MARKER,
  SYNTHETIC_NOW,
  syntheticFixtureInternals,
} from '../../fixtures/synthetic-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const openDatabases: Array<ReturnType<typeof openInventoryDatabase>> = []

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close()
})

function serviceHarness() {
  const release = buildSyntheticRelease()
  const database = openInventoryDatabase()
  openDatabases.push(database)
  importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  const service = createInventoryService({ database, now: () => new Date(SYNTHETIC_NOW) })
  return { release, database, service }
}

describe('repository-safe synthetic collaboration fixture', () => {
  it('is explicit, deterministic, and contains only fabricated identifiers', () => {
    const release = buildSyntheticRelease()
    const serialized = JSON.stringify(release)

    expect(release.manifest.fixture_marker).toBe(SYNTHETIC_FIXTURE_MARKER)
    expect(release.warnings.join(' ')).toContain(SYNTHETIC_FIXTURE_MARKER)
    expect(release.vehicles).toHaveLength(8)
    expect(release.vehicles.every((record) => record.vin.startsWith('TESTDATA'))).toBe(true)
    expect(new Set(release.vehicles.map((record) => record.vin)).size).toBe(release.vehicles.length)
    expect(release.vehicles.every((record) => /^[A-HJ-NPR-Z0-9]{17}$/.test(record.vin))).toBe(true)
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)
    expect(serialized).not.toMatch(/\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/)
    expect(serialized).not.toMatch(/C:\\Users\\/i)
    expect(syntheticFixtureInternals.heldVins.size).toBe(2)
  })

  it('exercises inventory, hold privacy, document detail, search, and transfer creation without live data', () => {
    const { service } = serviceHarness()
    const health = service.health()
    expect(health).toMatchObject({
      ready: true,
      counts: { public: 8, crm: 8, heldVins: 2, resources: 1, transfers: 0 },
    })

    const managerBootstrap = service.bootstrap({ role: 'manager', store: 'Howell', user: 'Synthetic Manager' })
    expect(managerBootstrap.meta.warnings.join(' ')).toContain(SYNTHETIC_FIXTURE_MARKER)
    const held = managerBootstrap.vehicles.find((vehicle) => vehicle.vin === 'TESTDATAHWELL0001')
    expect(held.hold).toMatchObject({ state: 'multiple', backupCount: 1 })

    const managerDetail = service.getVehicle('TESTDATAHWELL0001', {
      role: 'manager',
      store: 'Howell',
      user: 'Synthetic Manager',
    })
    expect(managerDetail.privateEvidence.primary.customerOrReason).toContain('Synthetic')
    expect(managerDetail.factoryEquipment.packages[0].name).toContain('Synthetic')
    expect(managerDetail.autoCheckReport.score).toBe(91)

    const porterDetail = service.getVehicle('TESTDATAHWELL0001', {
      role: 'porter',
      store: 'Howell',
      user: 'Synthetic Porter',
    })
    expect(porterDetail.privateEvidence).toBeUndefined()
    expect(porterDetail.hold.reason).toBeUndefined()

    const equipmentSearch = service.listVehicles(
      { q: 'Synthetic Premium Technology Package', limit: 20 },
      { role: 'sales', store: 'Howell', user: 'Synthetic Salesperson' },
    )
    expect(equipmentSearch.items.map((vehicle) => vehicle.vin)).toContain('TESTDATAHWELL0001')

    const transfer = service.createTransfer(
      {
        vin: 'TESTDATAHWELL0002',
        requestingStore: 'Fowlerville',
        neededBy: '2026-08-31T14:00:00-04:00',
        reason: 'Synthetic cross-store request for test coverage',
      },
      { role: 'sales', store: 'Fowlerville', user: 'Synthetic Salesperson' },
      'synthetic-fixture-test-transfer',
    )
    expect(transfer).toMatchObject({ created: true, record: { requestStatus: 'requested' } })
    expect(service.health().counts.transfers).toBe(1)
  })
})
