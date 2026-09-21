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

function serviceHarness(options = {}) {
  const release = buildSyntheticRelease(options)
  const database = openInventoryDatabase()
  openDatabases.push(database)
  importRelease(database, release, { loadedAt: SYNTHETIC_NOW.toISOString() })
  const service = createInventoryService({ database, now: () => new Date(SYNTHETIC_NOW) })
  return { release, database, service }
}

describe('repository-safe synthetic collaboration fixture', () => {
  it('keeps rich demonstration source coverage opt-in', () => {
    const release = buildSyntheticRelease()
    expect(release.vehicles.filter((record) => record.resourceRecord)).toHaveLength(1)
    expect(release.vehicles[0].resourceRecord).not.toHaveProperty('fordOasis')
    expect(release.vehicles[0].resourceRecord).not.toHaveProperty('windowSticker')
    expect(buildSyntheticRelease()).toEqual(release)
  })

  it('keeps fabricated coverage checks opt-in and tied to each demo mileage', () => {
    expect(buildSyntheticRelease().vehicles.every(record => !record.resourceRecord?.warrantyCheck)).toBe(true)
    const { release, service } = serviceHarness({ includeDemoChanges: true })
    for (const [vin, status] of [['TESTDATAHWELL0001', 'ACTIVE'], ['TESTDATAHWELL0002', 'EXPIRED']]) {
      const record = release.vehicles.find(record => record.vin === vin)
      const detail = service.getVehicle(vin, { role: 'manager', store: 'Howell', user: 'Synthetic Manager' })
      expect(detail.warrantyCheck.mileageEntered).toBe(record.publicRecord.mileage)
      expect(detail.fordOasis.engineCalibration).toContain('DEMO-CAL')
      expect(detail.fordOasis.tire).toContain('Synthetic')
      expect(detail.warrantyCheck.sourceLabel).toContain('fabricated')
      expect(detail.warrantyCheck.fordOasis.coverages[0].status).toBe(status)
      expect(detail.warrantyCheck.fordOasis.coverages.every(row => row.note.includes('Synthetic example'))).toBe(true)
    }
  })

  it('delivers matching fabricated source facts for every demo vehicle through the service', () => {
    const { release, service } = serviceHarness({ includeDemoChanges: true })
    expect(service.health().counts.resources).toBe(8)
    const bootstrap = service.bootstrap({ role: 'manager', store: 'Howell', user: 'Synthetic Manager' })
    for (const record of release.vehicles) {
      const source = record.publicRecord
      const detail = service.getVehicle(record.vin, { role: 'manager', store: source.store, user: 'Synthetic Manager' })
      expect(detail.autoCheckReport.lastReportedOdometer).toBe(source.mileage)
      expect(detail.autoCheckReport.estimatedInServiceDate).toBe(`${source.year}-03-14`)
      expect(detail.autoCheckReport.usage).toContain('Synthetic')
      expect(detail.windowSticker.totalMsrp).toBe(source.msrp)
      expect(detail.windowSticker.engine).toBe(source.engine)
      expect(detail.windowSticker.exteriorColor).toBe(source.exterior_color)
      expect(detail.windowSticker.sourceMessage).toContain('fabricated')
      expect(detail.factoryEquipment.totalMsrp).toBe(source.msrp)
      expect(detail.factoryEquipment.vehicleDescription).toBe(source.vehicle_name)
      expect(detail.factoryEquipment.disclaimer).toContain('fabricated')
      const inventoryVehicle = bootstrap.vehicles.find((vehicle) => vehicle.vin === record.vin)
      expect(inventoryVehicle.autoCheckReport).toEqual(detail.autoCheckReport)
      expect(inventoryVehicle.factoryEquipment).toEqual(detail.factoryEquipment)
      expect(inventoryVehicle.windowSticker).toEqual(detail.windowSticker)
      expect(inventoryVehicle.fordOasis).toEqual(detail.fordOasis)
      const equipment = [
        ...detail.factoryEquipment.packages.map((item) => item.name),
        ...detail.factoryEquipment.sections.flatMap((section) => section.items.map((item) => item.label)),
      ]
      expect(equipment.sort()).toEqual(source.features.split(' | ').sort())
      expect(detail.windowSticker.equipmentGroupContents).toEqual(source.features.split(' | '))
      expect(detail.windowSticker).not.toHaveProperty('equipmentGroupPrice')
      expect(detail.windowSticker.options.length).toBeGreaterThan(6)
      expect(detail.windowSticker.options.every((option) => option.startsWith('.') || option.includes('DEMO-'))).toBe(true)
      expect(detail.windowSticker.options.some((option) => option.endsWith('NO CHARGE'))).toBe(true)
      const optionPrices = detail.windowSticker.options.flatMap((option) => {
        const match = option.match(/USD ([\d,]+\.\d{2})$/)
        return match ? [Number(match[1].replaceAll(',', ''))] : []
      })
      expect(optionPrices.reduce((total, amount) => total + amount, 0)).toBe(detail.windowSticker.totalOptions)
      expect(detail.windowSticker.standardEquipment.length).toBeGreaterThan(0)
      expect(detail.autoCheckReport.checks).toHaveLength(9)
      expect(detail.autoCheckReport.checks.at(-1).detail).toContain('Corrected title')
      for (const evidence of Object.values(record.resourceRecord)) expect(evidence.url).toBeUndefined()
      expect(record.publicRecord.windowSticker.url).toBeUndefined()
      if (['Ford', 'Lincoln'].includes(source.make)) {
        expect(detail.fordOasis.sourceLabel).toContain('fabricated')
        expect(detail.fordOasis.warrantyStartDate).toBe(`${source.year}-03-14`)
        expect(detail.fordOasis.openActionsCaptured).toBe(true)
        expect(detail.fordOasis.openFieldServiceActions).toHaveLength(source.stock_number === 'DEMO-H02' ? 1 : 0)
      } else {
        expect(detail.fordOasis).toBeUndefined()
      }
    }
    const campaign = release.vehicles.find((record) => record.publicRecord.stock_number === 'DEMO-H02').resourceRecord.fordOasis.openFieldServiceActions[0]
    expect(campaign.code).toBe('26N99')
    expect(campaign.description).toContain('Synthetic non-recall service campaign')
  })

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
