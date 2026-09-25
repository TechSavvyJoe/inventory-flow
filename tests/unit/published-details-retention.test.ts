// @ts-nocheck -- shared ESM contracts, synthetic data only.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import * as sqlite from '../../server/database.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { loadD1Repository } from '../../cloudflare/src/repository.mjs'
import { applySyntheticSchema, sqliteD1 } from '../../scripts/run-recovery-drill.mjs'
import { toInventoryVehicle } from '../../src/app/adapters'
import { vehicleMatchesFilters, dealerMailHoldLabel } from '../../src/features/inventory/inventory-utils'
import { toPanelVehicle } from '../../extension/sidepanel/lib/model.mjs'
import { withLiveDealerMailHold } from '../../extension/sidepanel/lib/live-dealermail-hold.mjs'
import { matchesInventoryView } from '../../extension/sidepanel/lib/scope.mjs'

const databases = []
afterEach(() => { while (databases.length) databases.pop().close() })
const manager = { role: 'manager', store: 'Howell', user: 'Synthetic Manager' }
const vin = 'TESTDATAHWELL0001'
function release() {
  const result = buildSyntheticRelease()
  const row = result.vehicles.find(v => v.vin === vin)
  row.publicRecord.make = 'Toyota'
  row.publicRecord.inventory_date = '2026-08-01'
  row.publicRecord.autoCheckReport = { dataState: 'current', recentInspection: { date: '2026-08-29', types: ['Vehicle Serviced or Inspected'] } }
  return result
}
async function harness(kind, data) {
  let clock = SYNTHETIC_NOW
  let commit = async () => {}
  const db = kind === 'Node' ? sqlite.openInventoryDatabase() : new DatabaseSync(':memory:')
  databases.push(db)
  if (kind === 'Worker') applySyntheticSchema(db)
  async function load(next) {
    if (kind === 'Node') {
      sqlite.importRelease(db, next)
      return createInventoryServiceCore({ database: db, repository: sqlite, now: () => clock })
    }
    const repo = await loadD1Repository(sqliteD1(db), next)
    commit = () => repo.commit()
    return createInventoryServiceCore({ ...repo, now: () => clock })
  }
  return { service: await load(data), load, commit: () => commit(), nextDay: () => { clock = new Date('2026-08-31T10:00:00-04:00') } }
}

describe.each(['Node', 'Worker'])('%s retains the selected published snapshot', kind => {
  it('keeps hold details, held filters and completed service across midnight and a failed refresh, then replaces them', async () => {
    const h = await harness(kind, release())
    const before = h.service.getVehicle(vin, manager)
    expect(before.serviceReadiness.status).toBe('serviced')
    h.nextDay()
    for (const failed of [false, true]) {
      if (failed) h.service.setLoadStatus({ error: 'Synthetic upload failure' })
      const data = h.service.bootstrap(manager)
      const record = h.service.getVehicle(vin, manager)
      expect(data.meta.dealerMailFreshness).toBe('stale_unverified')
      expect(data.meta.reportDate).toBe('2026-08-30')
      expect(record.hold).toMatchObject({ state: 'stale', lastKnownActiveHold: true, primarySalesperson: before.hold.primarySalesperson, expectedDate: before.hold.expectedDate })
      expect(record.serviceReadiness).toEqual(before.serviceReadiness)
      const app = toInventoryVehicle(record, data)
      expect(app.dealerMail.hasActiveHold).toBeNull()
      expect(dealerMailHoldLabel(app.dealerMail)).toContain('Last verified hold')
      expect(app.holdEvidence[0].salesperson).toBeTruthy()
      expect(vehicleMatchesFilters(app, { storeId: 'all', dealerMail: 'held', search: '' })).toBe(true)
      const panel = toPanelVehicle(record, data)
      expect(panel.hold.evidence[0].salesperson).toBeTruthy()
      expect(panel.hold.label).toContain('Last verified hold')
      expect(matchesInventoryView(panel, 'held')).toBe(true)
      const checked = withLiveDealerMailHold(panel, { status: 'verified', activeCount: 0, checkedAt: '2026-08-31T14:00:00Z' })
      expect(matchesInventoryView(checked, 'held')).toBe(false)
      expect(checked.hold.evidence).toEqual([])
      for (const role of ['driver', 'porter', 'coordinator']) {
        const restricted = h.service.getVehicle(vin, { ...manager, role })
        expect(restricted.hold.primarySalesperson).toBeUndefined()
        expect(restricted.hold.reason).toBeUndefined()
        expect(restricted.privateEvidence).toBeUndefined()
      }
    }
    const next = release()
    next.reportDate = '2026-08-31'
    for (const source of Object.values(next.sourceRuns)) { source.reportDate = next.reportDate; source.sha256 = 'D'.repeat(64) }
    const row = next.vehicles.find(v => v.vin === vin)
    row.holdRecord = null
    row.publicRecord.autoCheckReport = null
    const updated = (await h.load(next)).getVehicle(vin, manager)
    expect(updated.hold.state).toBe('none_observed')
    expect(updated.hold.lastKnownActiveHold).toBeUndefined()
    expect(updated.serviceReadiness.status).toBe('needs_service')
  })

  it('retains an observed absence of holds separately from current status and replaces it on refresh', async () => {
    const source = release()
    source.vehicles.find(vehicle => vehicle.vin === vin).holdRecord = null
    const h = await harness(kind, source)
    expect(h.service.getVehicle(vin, manager).hold.state).toBe('none_observed')
    h.nextDay()
    for (const failed of [false, true]) {
      if (failed) h.service.setLoadStatus({ error: 'Synthetic failed refresh' })
      const data = h.service.bootstrap(manager)
      const record = h.service.getVehicle(vin, manager)
      expect(record.hold).toMatchObject({ state: 'stale', lastKnownNoHold: true, lastKnownActiveHold: false })
      expect(toInventoryVehicle(record, data).dealerMail).toMatchObject({ hasActiveHold: null, lastKnownNoHold: true })
    }
    const held = release()
    held.reportDate = '2026-08-31'
    for (const sourceRun of Object.values(held.sourceRuns)) { sourceRun.reportDate = held.reportDate; sourceRun.sha256 = 'F'.repeat(64) }
    const replacement = (await h.load(held)).getVehicle(vin, manager)
    expect(replacement.hold.state).toBe('multiple')
    expect(replacement.hold.lastKnownNoHold).toBeUndefined()
  })

  it.each(['missing CRM', 'incomplete source'])('never promotes %s into retained no-hold evidence', async condition => {
    const source = release()
    const row = source.vehicles.find(vehicle => vehicle.vin === vin)
    row.holdRecord = null
    if (condition === 'missing CRM') row.crmRecord = null
    else source.sourceRuns.dealerMail.status = 'incomplete'
    const h = await harness(kind, source)
    h.nextDay()
    expect(h.service.getVehicle(vin, manager).hold.lastKnownNoHold).not.toBe(true)
  })

  it('retains a captured Ford inspection without promoting stale captured evidence', async () => {
    const data = release()
    const row = data.vehicles.find(v => v.vin === vin)
    row.publicRecord.make = 'Ford'
    row.resourceRecord = { ...row.resourceRecord, fordOasis: { serviceHistory: {
      dataState: 'current', historyCaptured: true,
      certifiedInspection: { openDate: '08/15/2026', closeDate: '08/29/2026', inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' } },
    } } }
    const h = await harness(kind, data)
    h.nextDay()
    expect(h.service.getVehicle(vin, manager).serviceReadiness).toMatchObject({ status: 'serviced', completedAt: '2026-08-29' })
    row.resourceRecord.fordOasis.serviceHistory.dataState = 'stale'
    data.sourceRuns.resources.sha256 = 'E'.repeat(64)
    expect((await h.load(data)).getVehicle(vin, manager).serviceReadiness.status).toBe('needs_service')
  })

  it('does not promote an incomplete inspection into retained readiness', async () => {
    const data = release()
    data.vehicles.find(v => v.vin === vin).publicRecord.autoCheckReport.dataState = 'incomplete'
    const h = await harness(kind, data)
    h.nextDay()
    expect(h.service.getVehicle(vin, manager).serviceReadiness.status).toBe('needs_service')
  })

  it.each(['Ford', 'Toyota'])('retains separate source dates and authoritative manager dates for reopened %s work after midnight and refresh failure', async (make) => {
    const data = release()
    const row = data.vehicles.find(vehicle => vehicle.vin === vin)
    row.publicRecord.make = make
    if (make === 'Ford') row.resourceRecord = { ...row.resourceRecord, fordOasis: { serviceHistory: {
      dataState: 'current', historyCaptured: true,
      certifiedInspection: { openDate: '08/15/2026', closeDate: '08/29/2026', inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' } },
    } } }
    const h = await harness(kind, data)
    const originalEvidence = h.service.getServiceReadiness(vin, manager).readinessEvidence
    expect(originalEvidence.inspectionDate).toBe('2026-08-29')
    h.service.updateServiceReadiness(vin, { status: 'serviced', expectedVersion: 0, serviceDate: '2026-08-30' }, manager, `synthetic-${make}-ready`)
    h.nextDay()
    h.service.updateServiceReadiness(vin, { status: 'in_service', expectedVersion: 1, serviceDate: '2026-08-31' }, manager, `synthetic-${make}-reopen`)
    await h.commit()

    // A new Worker/Node service instance reads the saved manager decision.
    const restored = await h.load(data)
    for (const failed of [false, true]) {
      if (failed) restored.setLoadStatus({ error: 'Synthetic refresh failure' })
      const record = restored.getServiceReadiness(vin, manager)
      expect(record).toMatchObject({
        status: 'in_service', readinessBasis: 'manager_updated', version: 2,
        serviceEnteredAt: '2026-08-31', completedAt: null,
        readinessEvidence: originalEvidence,
      })
      expect(record.history[1]).toMatchObject({ status: 'serviced', serviceEnteredAt: null, completedAt: '2026-08-30' })
      expect(restored.bootstrap(manager).meta).toMatchObject({ reportDate: '2026-08-30', publicFreshness: 'stale_unverified' })
    }
  })
})
