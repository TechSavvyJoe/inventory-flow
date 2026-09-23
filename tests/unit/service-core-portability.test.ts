// PRODUCT-RULE TEST
// @ts-nocheck -- service adapters intentionally use platform-neutral ESM contracts.
// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import * as sqliteRepository from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import { createInventoryServiceCore, serviceInternals } from '../../server/service-core.mjs'
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

  it('keeps a current DealerMail-only arrival visible without reviving an off-market manager-log vehicle', () => {
    const { database, portable } = harness()
    const crmOnlyVin = 'TESTDATAHWELL0002'
    const offMarketVin = '1FTFW1E50NFA00009'
    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(crmOnlyVin)
    const overlay = {
      records: [{
        stockNumber: 'OFFMARKET', vin: offMarketVin, vehicleName: null,
        soldManagerLog: true, deliveredManagerLog: false, deliveryDate: null,
        confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-08',
        matchMethod: 'vin', matchStatus: 'not_in_current_release', physicalStore: null,
        reviewRequired: true, soldLabel: 'Sold — manager log',
        deliveryLabel: 'Not marked delivered — manager log',
      }],
    }
    database.prepare('UPDATE app_state SET value = ?, updated_at = ? WHERE key = ?').run(
      JSON.stringify(overlay), SYNTHETIC_NOW.toISOString(), 'current_manager_disposition_overlay_json',
    )
    const context = { role: 'manager', store: 'Howell', user: 'Synthetic manager' }

    const bootstrap = portable.bootstrap(context)
    const crmOnly = bootstrap.vehicles.find((vehicle) => vehicle.vin === crmOnlyVin)
    expect(crmOnly).toMatchObject({
      dataStatus: 'Pre-listing — current DealerMail record; public website listing not yet observed',
      publicListingState: 'Pre-listing — current DealerMail record; public website listing not yet observed',
    })
    expect(crmOnly.listingUrl).toBeUndefined()
    expect(bootstrap.vehicles.some((vehicle) => vehicle.vin === offMarketVin)).toBe(false)
    expect(portable.listVehicles({ limit: 100 }, context).items.some((vehicle) => vehicle.vin === offMarketVin)).toBe(false)
    expect(() => portable.getVehicle(offMarketVin, context)).toThrowError(expect.objectContaining({ code: 'VEHICLE_NOT_FOUND' }))
    expect(bootstrap.managerDispositions).toEqual(expect.arrayContaining([
      expect.objectContaining({ vin: offMarketVin, matchStatus: 'not_in_current_release' }),
    ]))
  })

  it('emits one public-listing code from the public record and its freshness, never from DealerMail', () => {
    const { database, portable } = harness()
    const manager = { role: 'manager', store: 'Howell', user: 'Synthetic manager' }
    const sales = { role: 'sales', store: 'Fowlerville', user: 'Synthetic sales', userId: 'sales-1' }
    const listedVin = 'TESTDATAHWELL0001'
    const crmOnlyVin = 'TESTDATAHWELL0002'
    const goneVin = 'TESTDATADETRT0001'
    const move = portable.createTransfer({ vin: goneVin, neededBy: '2026-08-31T14:00:00-04:00', reason: 'Listing code test' }, sales, 'listing-code-move').record
    expect(move).toMatchObject({ publicListing: 'listed', publicListingState: 'Listed publicly; availability not confirmed' })

    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(crmOnlyVin)
    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(goneVin)
    database.prepare('DELETE FROM crm_vehicle_snapshots WHERE vin = ?').run(goneVin)
    const bootstrap = portable.bootstrap(manager)
    const row = (vin) => bootstrap.vehicles.find((vehicle) => vehicle.vin === vin)
    expect(row(listedVin)).toMatchObject({ publicListing: 'listed' })
    // The DealerMail-only record's wording mentions "listed"; the code does not.
    expect(row(crmOnlyVin)).toMatchObject({ publicListing: 'pre_listing', websiteStatus: 'Current DealerMail record — not publicly listed' })
    expect(portable.getVehicle(crmOnlyVin, manager).publicListing).toBe('pre_listing')
    expect(row(goneVin)).toBeUndefined()
    expect(portable.listTransfers({}, sales).items.find((item) => item.id === move.id)).toMatchObject({
      publicListing: 'not_in_release', publicListingState: 'Not in current public release',
    })

    // The day after the report date the retained public record is stale, not current.
    const nextDay = createInventoryServiceCore({ database, repository: sqliteRepository, now: () => new Date('2026-08-31T10:15:00-04:00') })
    expect(nextDay.bootstrap(manager).meta.publicFreshness).toBe('stale_unverified')
    expect(nextDay.getVehicle(listedVin, manager).publicListing).toBe('stale')
    expect(nextDay.getVehicle(crmOnlyVin, manager).publicListing).toBe('pre_listing')
  })

  it.each([
    ['group manager outside the route', { role: 'group_manager', store: 'Lincoln', user: 'Group Manager' }, true],
    ['home-store manager', { role: 'manager', store: 'Howell', user: 'Howell Manager' }, true],
    ['requesting-store manager', { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' }, true],
    ['unrelated manager', { role: 'manager', store: 'Ford Detroit', user: 'Detroit Manager' }, false],
    ['related salesperson', { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson' }, true],
    ['unrelated salesperson', { role: 'sales', store: 'Lincoln', user: 'Lincoln Salesperson' }, false],
    ['related coordinator', { role: 'coordinator', store: 'Fowlerville', user: 'Fowlerville Coordinator' }, true],
    ['unrelated coordinator', { role: 'coordinator', store: 'Ford Detroit', user: 'Detroit Coordinator' }, false],
    ['assigned porter', { role: 'porter', store: 'Howell', user: 'Assigned Runner', userId: 'runner-1' }, true],
    ['assigned driver after a display-name change', { role: 'driver', store: 'Fowlerville', user: 'Renamed Runner', userId: 'runner-1' }, true],
    ['same display name with a different ID', { role: 'driver', store: 'Fowlerville', user: 'Assigned Runner', userId: 'runner-2' }, false],
    ['unassigned porter at a related store', { role: 'porter', store: 'Howell', user: 'Other Runner', userId: 'runner-3' }, false],
    ['unassigned driver during active movement', { role: 'driver', store: 'Fowlerville', user: 'Other Runner', userId: 'runner-3' }, false],
    ['former custodian after reassignment', { role: 'driver', store: 'Fowlerville', user: 'Former Runner', userId: 'runner-4' }, false],
  ])('applies transfer object authorization for %s', (_label, context, expected) => {
    const row = {
      home_store_id: 'Howell',
      requesting_store_id: 'Fowlerville',
      destination_store_id: 'Fowlerville',
      transport_assignee: 'Assigned Runner',
      transport_assignee_user_id: 'runner-1',
      current_custodian: 'Former Runner',
      status: 'transport_assigned',
      movement_status: 'transport_assigned',
    }
    expect(serviceInternals.transferVisible(row, context)).toBe(expected)
    expect(serviceInternals.transferMutationAuthorized(row, context)).toBe(expected)
  })

  it.each(['at_requesting_store', 'return_requested', 'returned_home', 'closed'])(
    'revokes transport-role authorization when the persisted assignment is no longer active in %s',
    (movementStatus) => {
      const row = {
        home_store_id: 'Howell',
        requesting_store_id: 'Fowlerville',
        destination_store_id: 'Fowlerville',
        transport_assignee: 'Assigned Runner',
        transport_assignee_user_id: 'runner-1',
        status: movementStatus === 'closed' ? 'closed' : movementStatus,
        movement_status: movementStatus,
      }
      const context = { role: 'driver', store: 'Fowlerville', user: 'Assigned Runner', userId: 'runner-1' }
      expect(serviceInternals.transferVisible(row, context)).toBe(false)
      expect(serviceInternals.transferMutationAuthorized(row, context)).toBe(false)
    },
  )

  it('permits a legacy name-only assignment only when its authenticated identity boundary marked the name unique', () => {
    const row = {
      home_store_id: 'Howell', requesting_store_id: 'Fowlerville', destination_store_id: 'Fowlerville',
      transport_assignee: 'Legacy Runner', transport_assignee_user_id: null,
      status: 'transport_assigned', movement_status: 'transport_assigned',
    }
    const uniqueLegacy = {
      role: 'driver', store: 'Fowlerville', user: 'Legacy Runner', userId: 'legacy-1',
      allowLegacyTransportAssignmentByName: true,
    }
    const duplicateName = { ...uniqueLegacy, userId: 'legacy-2', allowLegacyTransportAssignmentByName: false }
    expect(serviceInternals.transferVisible(row, uniqueLegacy)).toBe(true)
    expect(serviceInternals.transferMutationAuthorized(row, uniqueLegacy)).toBe(true)
    expect(serviceInternals.transferVisible(row, duplicateName)).toBe(false)
    expect(serviceInternals.transferMutationAuthorized(row, duplicateName)).toBe(false)
    expect(serviceInternals.transferVisible(row, { ...uniqueLegacy, user: 'legacy runner' })).toBe(false)
    expect(serviceInternals.transferVisible({ ...row, transport_assignee: 'Émile' }, {
      ...uniqueLegacy, user: 'Émile', allowLegacyTransportAssignmentByName: true,
    })).toBe(false)
  })

  it('binds outbound and return transport reads and mutations to the immutable assigned user ID', () => {
    const { database, portable } = harness()
    const salesperson = { role: 'sales', store: 'Fowlerville', user: 'Synthetic Sales', userId: 'sales-1' }
    const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic Manager', userId: 'manager-1' }
    const coordinator = { role: 'coordinator', store: 'Fowlerville', user: 'Synthetic Coordinator', userId: 'coord-1' }
    const assigned = { role: 'driver', store: 'Fowlerville', user: 'Alex Driver', userId: 'driver-1' }
    const sameNameAttacker = { ...assigned, userId: 'driver-2' }
    const returning = { role: 'porter', store: 'Fowlerville', user: 'Alex Driver', userId: 'porter-9' }
    const input = {
      vin: 'TESTDATAHWELL0002', neededBy: '2026-08-31T14:00:00-04:00', reason: 'Stable identity test',
    }
    const created = portable.createTransfer(input, salesperson, 'stable-create')
    const id = created.record.id
    portable.appendTransferEvent(id, { type: 'manager_reviewed' }, manager, 'stable-review')
    portable.appendTransferEvent(id, { type: 'approved', homeStoreManager: 'Howell Manager' }, manager, 'stable-approve')
    portable.appendTransferEvent(id, {
      type: 'transport_assigned', assignee: 'Alex Driver', assigneeUserId: 'driver-1',
      dueAt: '2026-08-31T15:00:00-04:00',
    }, coordinator, 'stable-outbound-assignment')

    expect(database.prepare('SELECT transport_assignee_user_id AS id FROM transfer_requests WHERE id=?').get(id).id).toBe('driver-1')
    expect(database.prepare("SELECT driver_or_porter_user_id AS id FROM transfer_events WHERE transfer_request_id=? AND event_type='transport_assigned'").get(id).id).toBe('driver-1')
    expect(portable.listTransfers({}, sameNameAttacker).items).toHaveLength(0)
    expect(() => portable.getTransfer(id, sameNameAttacker)).toThrowError(expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }))
    const eventCount = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    expect(() => portable.appendTransferEvent(id, { type: 'picked_up' }, sameNameAttacker, 'stable-attacker')).toThrowError(
      expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }),
    )
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(eventCount)
    const assignedView = portable.getTransfer(id, assigned)
    expect(assignedView.transportAssignee).toBe('Alex Driver')
    expect(JSON.stringify(assignedView)).not.toContain('driver-1')
    const beforeForgedAudit = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    expect(() => portable.appendTransferEvent(
      id,
      { type: 'picked_up', assigneeUserId: 'forged-audit-id' },
      assigned,
      'stable-forged-non-assignment',
    )).toThrowError(expect.objectContaining({ code: 'ASSIGNEE_IDENTITY_CLIENT_CONTROLLED' }))
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(beforeForgedAudit)
    expect(portable.appendTransferEvent(id, { type: 'picked_up' }, assigned, 'stable-pickup').record.movementStatus).toBe('picked_up')
    expect(portable.appendTransferEvent(id, { type: 'in_transit' }, assigned, 'stable-transit').record.movementStatus).toBe('in_transit')
    const arrival = portable.appendTransferEvent(id, { type: 'arrived' }, assigned, 'stable-arrival')
    expect(arrival.created).toBe(true)
    const arrivalReplay = portable.appendTransferEvent(id, { type: 'arrived' }, assigned, 'stable-arrival')
    expect(arrivalReplay.created).toBe(false)
    expect(arrivalReplay.record).toMatchObject({
      id, requestStatus: 'arrived', movementStatus: 'at_requesting_store', replayed: true,
    })
    expect(arrivalReplay.record.nextAction).toBeUndefined()
    expect(database.prepare("SELECT actor_user_id AS id FROM transfer_events WHERE transfer_request_id=? AND event_type='arrived'").get(id).id).toBe('driver-1')
    expect(() => portable.appendTransferEvent(id, { type: 'picked_up' }, assigned, 'stable-pickup')).toThrowError(
      expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }),
    )
    expect(() => portable.appendTransferEvent(id, { type: 'arrived' }, sameNameAttacker, 'stable-arrival')).toThrowError(
      expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }),
    )
    portable.appendTransferEvent(id, { type: 'not_sold' }, salesperson, 'stable-not-sold')
    portable.appendTransferEvent(id, { type: 'return_requested' }, salesperson, 'stable-return-request')
    portable.appendTransferEvent(id, {
      type: 'return_assigned', assignee: 'Alex Driver', assigneeUserId: 'porter-9',
      dueAt: '2026-09-01T14:00:00-04:00',
    }, coordinator, 'stable-return-assignment')

    expect(portable.listTransfers({}, sameNameAttacker).items).toHaveLength(0)
    expect(portable.getTransfer(id, returning).movementStatus).toBe('return_assigned')
    expect(portable.appendTransferEvent(id, { type: 'return_in_transit' }, returning, 'stable-return-transit').record.movementStatus).toBe('return_in_transit')
    expect(database.prepare("SELECT driver_or_porter_user_id AS id FROM transfer_events WHERE transfer_request_id=? AND event_type='return_assigned'").get(id).id).toBe('porter-9')
  })

  it('revokes a stable transport assignment immediately when the transfer is canceled', () => {
    const { database, portable } = harness()
    const salesperson = { role: 'sales', store: 'Fowlerville', user: 'Synthetic Sales', userId: 'sales-cancel' }
    const manager = { role: 'manager', store: 'Fowlerville', user: 'Synthetic Manager', userId: 'manager-cancel' }
    const coordinator = { role: 'coordinator', store: 'Fowlerville', user: 'Synthetic Coordinator', userId: 'coord-cancel' }
    const assigned = { role: 'driver', store: 'Fowlerville', user: 'Assigned Driver', userId: 'driver-cancel' }
    const created = portable.createTransfer({
      vin: 'TESTDATAHWELL0002',
      neededBy: '2026-08-31T14:00:00-04:00',
      reason: 'Cancellation authorization test',
    }, salesperson, 'cancel-create')
    const id = created.record.id
    portable.appendTransferEvent(id, { type: 'manager_reviewed' }, manager, 'cancel-review')
    portable.appendTransferEvent(id, { type: 'approved', homeStoreManager: 'Howell Manager' }, manager, 'cancel-approve')
    portable.appendTransferEvent(id, {
      type: 'transport_assigned',
      assignee: 'Assigned Driver',
      assigneeUserId: 'driver-cancel',
      dueAt: '2026-08-31T15:00:00-04:00',
    }, coordinator, 'cancel-assignment')
    expect(portable.getTransfer(id, assigned).movementStatus).toBe('transport_assigned')

    portable.appendTransferEvent(id, { type: 'canceled', note: 'Request withdrawn before pickup.' }, manager, 'cancel-event')
    expect(portable.listTransfers({}, assigned).items).toHaveLength(0)
    expect(() => portable.getTransfer(id, assigned)).toThrowError(expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }))
    const count = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    expect(() => portable.appendTransferEvent(id, { type: 'note_added' }, assigned, 'cancel-driver-note')).toThrowError(
      expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }),
    )
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(count)
  })

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
