// PRODUCT-RULE TEST
// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node
//
// Role-matrix canary. Every private DealerMail, CDK and move field in a
// synthetic release is seeded with a unique marker. Porters, drivers and
// coordinators must never receive any marker from bootstrap, vehicle list,
// search or detail, moves, or the action center, and the integration Worker's
// projection must never carry one for any role. A positive control proves each
// marker reaches an evidence role, so a seed that no longer lands anywhere fails
// here instead of passing vacuously. Add fields; never drop one to make it pass.

import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { createInventoryServer } from '../../server/api.mjs'
import { STORE_NAMES } from '../../server/constants.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { findLatestCompletedManifest, loadLatestCompletedRelease } from '../../server/importer.mjs'
import { createIntegrationReadService } from '../../server/integrations/read-service.mjs'
import { integrationBootstrapFromSource } from '../../server/integrations/source-bootstrap.mjs'
import { createInventoryService } from '../../server/service.mjs'

const MARK = 'zqcanary'
const TRANSPORT_ROLES = ['porter', 'driver', 'coordinator']

const openResources = []
const openWorkspaces = []
afterEach(async () => {
  while (openResources.length) {
    const resource = openResources.pop()
    await new Promise((resolve) => resource.server.close(() => resolve()))
    resource.database.close()
  }
  while (openWorkspaces.length) openWorkspaces.pop()?.cleanup()
})

function marker(seeded, field) {
  const value = `ZQCANARY ${field}`
  seeded.add(value.toLowerCase())
  return value
}

/** Seeds every private field the release can carry; returns the marker set. */
function seedPrivateFields(release) {
  const seeded = new Set()
  const vehicles = release.vehicles.filter((vehicle) => vehicle.crmRecord)
  for (const vehicle of vehicles) {
    vehicle.crmRecord.comments = [{ rows: [{
      commentTextRaw: marker(seeded, 'comment text'),
      authorRaw: marker(seeded, 'comment author'),
      timestampRaw: '08/29/2026 09:00 AM',
    }] }]
    vehicle.crmRecord.alerts = [{
      // The loaner keyword makes this the loaner badge's source as well.
      alertTextRaw: `LCTP loaner out 8/28 ${marker(seeded, 'loaner alert text')}`,
      authorRaw: marker(seeded, 'alert author'),
      modifiedMetadataRaw: marker(seeded, 'alert metadata'),
      spiffRaw: marker(seeded, 'alert spiff'),
      timestampRaw: '08/29/2026 09:05 AM',
    }]
  }
  for (const vehicle of release.vehicles.filter((row) => row.holdRecord)) {
    for (const row of vehicle.holdRecord.holdDetailRows) {
      const position = row.holdPosition === 'backup' ? 'backup' : 'primary'
      row.salespersonRaw = marker(seeded, `${position} salesperson`)
      row.customerOrReasonRaw = marker(seeded, `${position} customer or reason`)
      // Only the primary row's held-by reaches the API (backups omit it).
      if (position === 'primary') row.heldByRaw = marker(seeded, 'primary held by')
    }
    vehicle.holdRecord.holdDetailRows.push({
      orderRaw: 'DELETED', lifecycleStatus: 'deleted_history',
      salespersonRaw: marker(seeded, 'deleted history salesperson'),
      customerOrReasonRaw: marker(seeded, 'deleted history reason'),
    })
    if (vehicle.cdkRecord) vehicle.cdkRecord.result = marker(seeded, 'cdk result')
  }
  // Older releases carried messages on the held record only; the fallback path
  // must be redacted the same way.
  const legacyHeld = release.vehicles.find((row) => row.holdRecord && row.crmRecord && row.publicRecord?.store === 'Lincoln')
  delete legacyHeld.crmRecord.comments
  delete legacyHeld.crmRecord.alerts
  legacyHeld.holdRecord.comments = [{ rows: [{ commentTextRaw: marker(seeded, 'held-record comment text'), authorRaw: marker(seeded, 'held-record comment author') }] }]
  legacyHeld.holdRecord.alerts = [{ alertTextRaw: `FCTP ${marker(seeded, 'held-record alert text')}`, authorRaw: marker(seeded, 'held-record alert author') }]

  const released = release.vehicles.find((row) => row.crmRecord && !row.holdRecord && row.publicRecord?.store === 'Howell')
  release.releasedHoldHistory = [{ vin: released.vin, stockNumber: released.crmRecord.stockNumber, holdDetailRows: [{
    orderRaw: '1', lifecycleStatus: 'active',
    salespersonRaw: marker(seeded, 'released history salesperson'),
    customerOrReasonRaw: marker(seeded, 'released history reason'),
    holdDateRaw: '08/20/2026', expectedDeliveryDateRaw: '08/22/2026',
  }] }]
  return seeded
}

async function harness(workflowMode) {
  const fixture = createSyntheticWorkspace()
  openWorkspaces.push(fixture)
  const { manifest } = findLatestCompletedManifest(fixture.workspaceRoot)
  const fixedNow = new Date(`${manifest.report_date}T18:00:00-04:00`)
  const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: fixedNow })
  const seeded = seedPrivateFields(release)
  const database = openInventoryDatabase()
  importRelease(database, release, { loadedAt: fixedNow.toISOString() })
  const service = createInventoryService({ database, now: () => fixedNow, workflowMode })
  const server = createInventoryServer({ service })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  openResources.push({ server, database })
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}`, release, service, seeded }
}

function headers(context) {
  return {
    'content-type': 'application/json',
    'x-inventory-role': context.role,
    'x-inventory-store': context.store,
    'x-inventory-user': context.user,
  }
}

async function get(baseUrl, context, path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: headers(context) })
  expect(response.status, `${context.role} GET ${path}`).toBe(200)
  return response.json()
}

async function post(baseUrl, context, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(context), body: JSON.stringify(body) })
  const json = await response.json()
  expect(response.status, `${context.role} POST ${path}: ${JSON.stringify(json)}`).toBeLessThan(300)
  return json
}

const sales = { role: 'sales', store: 'Fowlerville', user: 'Canary Salesperson' }
const manager = { role: 'manager', store: 'Fowlerville', user: 'Canary Manager' }
const homeManager = { role: 'manager', store: 'Howell', user: 'Canary Home Manager' }
const coordinator = { role: 'coordinator', store: 'Fowlerville', user: 'Canary Coordinator' }
const porter = { role: 'porter', store: 'Fowlerville', user: 'Canary Porter' }
const driver = { role: 'driver', store: 'Fowlerville', user: 'Canary Driver' }
const groupManager = { role: 'group_manager', store: 'Howell', user: 'Canary Group Manager' }

async function requestMove(baseUrl, seeded, vin, label) {
  return post(baseUrl, sales, '/api/transfers', {
    vin, requestingStore: 'Fowlerville', requestedBy: sales.user,
    neededBy: '2026-08-31T14:00:00-04:00', returnDueAt: '2026-09-01T17:00:00-04:00',
    reason: marker(seeded, `${label} request reason`),
    customerReference: marker(seeded, `${label} customer reference`),
    customerAppointment: true, returnRequired: true, priority: 'high',
  })
}

/** Advanced mode: two moves, one handed to the porter and one to the driver. */
async function seedAdvancedMoves(baseUrl, seeded, vins) {
  for (const [index, assignee] of [porter, driver].entries()) {
    const label = `${assignee.role} move`
    const move = await requestMove(baseUrl, seeded, vins[index], label)
    const events = `/api/transfers/${move.id}/events`
    await post(baseUrl, manager, events, { type: 'manager_reviewed', note: marker(seeded, `${label} review note`) })
    await post(baseUrl, manager, events, { type: 'approved', homeStoreManager: homeManager.user, note: marker(seeded, `${label} release note`) })
    await post(baseUrl, sales, events, { type: 'driver_requested', note: marker(seeded, `${label} driver request note`) })
    await post(baseUrl, coordinator, events, { type: 'transport_assigned', assignee: assignee.user, dueAt: '2026-08-31T13:30:00-04:00' })
  }
}

/** Simple mode: moves are manager-led; the related coordinator can read them. */
async function seedSimpleMoves(baseUrl, seeded, vins) {
  const move = await requestMove(baseUrl, seeded, vins[0], 'simple move')
  await post(baseUrl, manager, `/api/transfers/${move.id}/events`, {
    type: 'request_approved', availabilityConfirmed: true, note: marker(seeded, 'simple move approval note'),
  })
}

/** Every read a role can make, including each vehicle, move and action item. */
async function readEverything(baseUrl, context) {
  const bootstrap = await get(baseUrl, context, '/api/bootstrap')
  const reads = [
    ['bootstrap', bootstrap],
    ['vehicle list', await get(baseUrl, context, '/api/vehicles?limit=100')],
    ['vehicle search', await get(baseUrl, context, `/api/vehicles?q=${MARK}&limit=100`)],
  ]
  for (const vehicle of bootstrap.vehicles) {
    reads.push([`vehicle ${vehicle.vin}`, await get(baseUrl, context, `/api/vehicles/${vehicle.vin}`)])
  }
  const transfers = await get(baseUrl, context, '/api/transfers')
  reads.push(['transfers', transfers])
  for (const transfer of transfers.items) {
    reads.push([`transfer ${transfer.id}`, await get(baseUrl, context, `/api/transfers/${transfer.id}`)])
  }
  const attention = await get(baseUrl, context, '/api/attention')
  reads.push(['attention', attention])
  for (const item of attention.items) {
    reads.push([`attention ${item.id}`, await get(baseUrl, context, `/api/attention/${encodeURIComponent(item.id)}`)])
  }
  return reads
}

function expectNoMarker(where, body) {
  const text = JSON.stringify(body).toLowerCase()
  const index = text.indexOf(MARK)
  expect(index, `${where} leaked: …${text.slice(Math.max(0, index - 60), index + 80)}…`).toBe(-1)
}

describe.each(['simple', 'advanced'])('role-matrix canary (%s moves)', (workflowMode) => {
  it('never hands a seeded private field to porters, drivers or coordinators', async () => {
    const { baseUrl, service, seeded } = await harness(workflowMode)
    const howell = (await get(baseUrl, groupManager, '/api/bootstrap')).vehicles
      .filter((vehicle) => vehicle.publicStore === 'Howell')
      .map((vehicle) => vehicle.vin)
    if (workflowMode === 'advanced') await seedAdvancedMoves(baseUrl, seeded, howell)
    else await seedSimpleMoves(baseUrl, seeded, howell)

    // A manager touching hold-review items must not persist the DealerMail
    // salesperson into the shared action-center row, and the manager's own
    // notes and resolution note are private evidence too.
    const reviews = (await get(baseUrl, homeManager, '/api/attention')).items
      .filter((item) => ['hold_alert', 'past_expected_hold', 'vehicle_alert'].includes(item.type) && item.store === 'Howell')
    expect(reviews.length, 'two Howell hold-review items').toBeGreaterThanOrEqual(2)
    const [noted, resolved] = reviews
    const attentionEvents = (item) => `/api/attention/${encodeURIComponent(item.id)}/events`
    await post(baseUrl, homeManager, attentionEvents(noted), { type: 'acknowledge' })
    await post(baseUrl, homeManager, attentionEvents(noted), { type: 'assign', assignee: marker(seeded, 'attention hold assignee') })
    await post(baseUrl, homeManager, attentionEvents(noted), { type: 'add_note', note: marker(seeded, 'attention note') })
    await post(baseUrl, homeManager, attentionEvents(resolved), { type: 'resolve', resolutionCode: 'other', note: marker(seeded, 'attention resolution note') })

    // Positive control: an evidence role receives every seeded marker.
    const evidence = JSON.stringify([
      ...(await readEverything(baseUrl, groupManager)),
      ...(await readEverything(baseUrl, sales)),
    ]).toLowerCase()
    const unreached = [...seeded].filter((value) => !evidence.includes(value))
    expect(unreached, 'seeded fields that no evidence-role read returned').toEqual([])

    for (const context of [porter, driver, coordinator, { ...porter, store: 'Howell' }, { ...driver, store: 'Howell' }, { ...coordinator, store: 'Howell' }]) {
      expect(TRANSPORT_ROLES).toContain(context.role)
      const reads = await readEverything(baseUrl, context)
      for (const [where, body] of reads) expectNoMarker(`${context.role}@${context.store} ${where}`, body)
      const search = reads.find(([where]) => where === 'vehicle search')[1]
      expect(search.items, `${context.role} private-text search`).toEqual([])
      if (workflowMode === 'advanced' && context.store === 'Fowlerville' && context.role !== 'coordinator') {
        // The assigned transport role does see its own move, just not the evidence.
        expect(reads.find(([where]) => where === 'transfers')[1].items, `${context.role} assigned move`).toHaveLength(1)
      }
      if (context.role === 'coordinator' && context.store === 'Fowlerville') {
        expect(reads.find(([where]) => where === 'transfers')[1].items.length, 'coordinator related moves').toBeGreaterThan(0)
      }
    }
    // The loaner badge itself still reaches transport roles.
    const porterRows = (await get(baseUrl, porter, '/api/bootstrap')).vehicles
    expect(porterRows.some((vehicle) => vehicle.hold.loaner?.label === 'Current loaner LCTP')).toBe(true)
    expect(service).toBeTruthy()
  })
})

describe('role-matrix canary (integration Worker projection)', () => {
  it('never carries a seeded private field into the integration bootstrap or resources for any role', async () => {
    const { release, service, seeded } = await harness('simple')
    const scopes = ['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read']
    for (const role of ['group_manager', 'manager', 'sales']) {
      const principal = {
        clientId: 'a'.repeat(32), userId: `canary-${role}`, role, store: 'Howell', user: `Canary integration ${role}`,
        stores: [...STORE_NAMES], scopes,
      }
      // The same pipeline as cloudflare/src/integration-worker.mjs
      // loadIntegrationReadService: app bootstrap for the principal, then the
      // public-source projection, then the read service.
      const appBootstrap = service.bootstrap(principal)
      expect(JSON.stringify(appBootstrap).toLowerCase(), `${role} app bootstrap carries evidence`).toContain(MARK)
      const projected = integrationBootstrapFromSource(appBootstrap, release)
      expectNoMarker(`${role} integration bootstrap`, projected)
      const read = createIntegrationReadService({
        bootstrap: projected, principal, bundleSha256: 'c'.repeat(64),
        cursorSecret: 'synthetic-canary-cursor-secret-0123456789abcdef',
      })
      const results = [
        ['inventory', read.inventory({ limit: '100' })],
        ['inventory search', read.inventory({ q: MARK })],
        ['operational inventory', read.operationalInventory({ limit: '100' })],
        ['operational search', read.operationalInventory({ q: MARK })],
        ['changes', read.changes({})],
        ['hold summary', read.holdSummary({})],
        ['manager dispositions', read.managerDispositions({})],
        ['health', read.health()],
        ['daily operations', read.dailyOperations()],
        ['data quality', read.dataQuality()],
        ['reconciliation', read.reconciliation()],
        ['capabilities', read.capabilities],
      ]
      for (const vehicle of projected.vehicles) {
        results.push([`vehicle ${vehicle.vin}`, read.vehicle(vehicle.vin)])
        results.push([`resources ${vehicle.vin}`, read.vehicleResources(vehicle.vin)])
      }
      expect(projected.vehicles.length).toBeGreaterThan(0)
      for (const [where, body] of results) expectNoMarker(`${role} integration ${where}`, body)
      expect(results[1][1].data, `${role} integration private-text search`).toEqual([])
      expect(results[3][1].data, `${role} integration operational private-text search`).toEqual([])
    }
    expect(seeded.size).toBeGreaterThan(10)
  })
})
