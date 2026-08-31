// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createInventoryServer } from '../../server/api.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { findLatestCompletedManifest, loadLatestCompletedRelease } from '../../server/importer.mjs'
import { createInventoryService } from '../../server/service.mjs'

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const openResources: Array<{ server: ReturnType<typeof createInventoryServer>; database: ReturnType<typeof openInventoryDatabase> }> = []

afterEach(async () => {
  while (openResources.length) {
    const resource = openResources.pop()!
    await new Promise<void>((resolve) => resource.server.close(() => resolve()))
    resource.database.close()
  }
})

async function harness() {
  const { manifest } = findLatestCompletedManifest(workspaceRoot)
  const fixedNow = new Date(`${manifest.report_date}T18:00:00-04:00`)
  const release = loadLatestCompletedRelease({ workspaceRoot, now: fixedNow })
  const database = openInventoryDatabase()
  importRelease(database, release, { loadedAt: fixedNow.toISOString() })
  const service = createInventoryService({ database, now: () => fixedNow })
  const server = createInventoryServer({ service })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  openResources.push({ server, database })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  return { baseUrl: `http://127.0.0.1:${address.port}`, manifest, release, database }
}

function roleHeaders(role: string, store: string, user: string) {
  return {
    'content-type': 'application/json',
    'x-inventory-role': role,
    'x-inventory-store': store,
    'x-inventory-user': user,
  }
}

async function postEvent(
  baseUrl: string,
  transferId: string,
  context: { role: string; store: string; user: string },
  event: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}/api/transfers/${transferId}/events`, {
    method: 'POST',
    headers: roleHeaders(context.role, context.store, context.user),
    body: JSON.stringify({
      actor: context.user,
      actorRole: context.role,
      store: context.store,
      ...event,
    }),
  })
  return { response, body: await response.json() }
}

async function createSalesRequest(baseUrl: string, vehicle: { vin: string }, salesperson = 'Fowlerville Salesperson') {
  const response = await fetch(`${baseUrl}/api/transfers`, {
    method: 'POST',
    headers: roleHeaders('sales', 'Fowlerville', salesperson),
    body: JSON.stringify({
      vin: vehicle.vin,
      requestingStore: 'Fowlerville',
      requestedBy: salesperson,
      neededBy: '2026-08-30T14:00:00-04:00',
      reason: 'Internal cross-store customer showing request',
      customerReference: 'Private test reference',
      customerAppointment: true,
      returnRequired: true,
      returnDueAt: '2026-08-31T17:00:00-04:00',
      priority: 'high',
    }),
  })
  return { response, body: await response.json() }
}

async function advanceToArrival(baseUrl: string, vehicle: { vin: string }, suffix = '') {
  const requested = await createSalesRequest(baseUrl, vehicle, `Fowlerville Salesperson${suffix}`)
  expect(requested.response.status).toBe(201)
  const transferId = requested.body.id

  const review = await postEvent(
    baseUrl,
    transferId,
    { role: 'manager', store: 'Fowlerville', user: `Fowlerville Manager${suffix}` },
    { type: 'manager_reviewed', note: 'Request reviewed with the salesperson.' },
  )
  expect(review.response.status).toBe(201)

  const release = await postEvent(
    baseUrl,
    transferId,
    { role: 'manager', store: 'Howell', user: `Howell Used Manager${suffix}` },
    { type: 'approved', note: 'Vehicle located and explicitly released for the requesting store.' },
  )
  expect(release.response.status).toBe(201)

  const driverRequest = await postEvent(
    baseUrl,
    transferId,
    { role: 'sales', store: 'Fowlerville', user: `Fowlerville Salesperson${suffix}` },
    { type: 'driver_requested', note: 'Please coordinate transport.' },
  )
  expect(driverRequest.response.status).toBe(201)

  const assignment = await postEvent(
    baseUrl,
    transferId,
    { role: 'coordinator', store: 'Fowlerville', user: `Transport Coordinator${suffix}` },
    {
      type: 'transport_assigned',
      assignee: `Porter${suffix || ' One'}`,
      dueAt: '2026-08-30T13:30:00-04:00',
    },
  )
  expect(assignment.response.status).toBe(201)

  const porter = `Porter${suffix || ' One'}`
  const pickup = await postEvent(
    baseUrl,
    transferId,
    { role: 'porter', store: 'Fowlerville', user: porter },
    { type: 'picked_up', store: 'Howell', note: 'Keys and custody received at Home Store.' },
  )
  expect(pickup.response.status).toBe(201)

  const arrival = await postEvent(
    baseUrl,
    transferId,
    { role: 'porter', store: 'Fowlerville', user: porter },
    { type: 'arrived', note: 'Vehicle and keys delivered to requesting store.' },
  )
  expect(arrival.response.status).toBe(201)
  return { transferId, requested: requested.body, assignment: assignment.body, arrival: arrival.body }
}

describe('Inventory Flow API', () => {
  it('normalizes an omitted hold change status and passes through explicit source status', async () => {
    const { baseUrl, manifest, database } = await harness()
    expect(manifest.hold_change_status).toBeUndefined()

    const normalized = await fetch(`${baseUrl}/api/bootstrap?homeStore=Howell&role=sales`).then((response) => response.json())
    expect(normalized.meta.holdChangeStatus).toBe('not_provided')

    const explicitManifest = { ...manifest, hold_change_status: 'verified_change_set' }
    database
      .prepare("UPDATE app_state SET value = ? WHERE key = 'current_manifest_json'")
      .run(JSON.stringify(explicitManifest))

    const explicit = await fetch(`${baseUrl}/api/bootstrap?homeStore=Howell&role=sales`).then((response) => response.json())
    expect(explicit.meta.holdChangeStatus).toBe('verified_change_set')
  })

  it('exposes only allowlisted exact-VIN photo URLs stored by the verified extractor', async () => {
    const { baseUrl, database } = await harness()
    const snapshot = database
      .prepare('SELECT vin, payload_json FROM public_vehicle_snapshots ORDER BY vin LIMIT 1')
      .get()
    const payload = JSON.parse(snapshot.payload_json)
    const hosts: Record<string, string> = {
      Howell: 'www.bobmaxeyfordhowell.com',
      Fowlerville: 'www.bobmaxeyfordinfowlerville.com',
      'Ford Detroit': 'www.bobmaxeyford.com',
      Lincoln: 'www.bobmaxeylincoln.com',
    }
    const good = `https://${hosts[payload.store]}/inventoryphotos/verified/${snapshot.vin.toLowerCase()}/ip/1.jpg`
    payload.photo_urls = [
      `${good}?width=600`,
      good,
      `https://evil.example/inventoryphotos/verified/${snapshot.vin.toLowerCase()}/ip/2.jpg`,
      `https://${hosts[payload.store]}/inventoryphotos/verified/2lmpj8lr3hbl46607/ip/3.jpg`,
    ]
    payload.photo_preview_url = `https://${hosts[payload.store]}/inventoryphotos/verified/${snapshot.vin.toLowerCase()}/ip/thumbs/1.jpg`
    database
      .prepare('UPDATE public_vehicle_snapshots SET payload_json = ? WHERE vin = ?')
      .run(JSON.stringify(payload), snapshot.vin)

    const response = await fetch(`${baseUrl}/api/vehicles/${snapshot.vin}`, {
      headers: roleHeaders('sales', payload.store, 'Photo test'),
    })
    const vehicle = await response.json()
    expect(response.status).toBe(200)
    expect(vehicle.imageUrl).toBe(good)
    expect(vehicle.imageUrls).toEqual([good])
  })

  it('exposes and searches VIN-linked factory equipment for public and CRM-only vehicles', async () => {
    const { baseUrl, database } = await harness()
    const vin = '1GCUDEED9RZ144878'
    const crm = database.prepare('SELECT crm_store_id FROM crm_vehicle_snapshots WHERE vin = ?').get(vin)
    expect(crm).toBeTruthy()

    const detailResponse = await fetch(`${baseUrl}/api/vehicles/${vin}`, {
      headers: roleHeaders('sales', crm.crm_store_id, 'Factory-equipment test'),
    })
    const detail = await detailResponse.json()
    expect(detailResponse.status).toBe(200)
    expect(detail.factoryEquipment).toMatchObject({
      dataState: 'current',
      url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg',
      totalMsrp: 66360,
      isOriginalWindowSticker: false,
    })
    expect(detail.factoryEquipment.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'SAFETY PACKAGE', code: 'PQB' })]),
    )
    expect(detail.searchText).toContain('aerial view display system')
    expect(detail.searchText).toContain('not original monroney window sticker')

    const publicSearch = await fetch(
      `${baseUrl}/api/vehicles?q=${encodeURIComponent('RST ALL STAR PREMIUM PACKAGE')}&limit=10`,
      { headers: roleHeaders('sales', crm.crm_store_id, 'Factory-equipment search') },
    ).then((response) => response.json())
    expect(publicSearch.items.some((vehicle: { vin: string }) => vehicle.vin === vin)).toBe(true)

    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(vin)
    const crmOnlyResponse = await fetch(
      `${baseUrl}/api/vehicles?includeCrmOnly=true&q=${encodeURIComponent('Glacier Blue Metallic (GLT)')}&limit=10`,
      { headers: roleHeaders('sales', crm.crm_store_id, 'CRM-only resource search') },
    )
    const crmOnly = await crmOnlyResponse.json()
    expect(crmOnlyResponse.status).toBe(200)
    expect(crmOnly.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vin,
          publicListingState: 'Not publicly listed in verified release',
          factoryEquipment: expect.objectContaining({ totalMsrp: 66360 }),
        }),
      ]),
    )
  })

  it('serves current source data with full hold evidence for sales and redaction for transport-only roles', async () => {
    const { baseUrl, manifest, release } = await harness()
    const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap?homeStore=Howell&role=sales`)
    const bootstrap = await bootstrapResponse.json()
    expect(bootstrapResponse.status).toBe(200)
    expect(bootstrap.vehicles).toHaveLength(manifest.source_counts.public_unique_vins)
    expect(bootstrap.transfers).toHaveLength(0)
    expect(bootstrap.meta.publicFreshness).toBe('current')
    expect(bootstrap.meta.publicChangeCounts).toEqual({
      newArrival: manifest.public_change_counts.new_arrival,
      removed: manifest.public_change_counts.removed,
      priceChange: manifest.public_change_counts.price_change,
      mileageChange: manifest.public_change_counts.mileage_change,
      websiteStatusChange: manifest.public_change_counts.website_status_change,
      stockCorrection: manifest.public_change_counts.stock_correction,
      storeTransfer: manifest.public_change_counts.store_transfer,
    })
    expect(manifest.hold_change_status).toBeUndefined()
    expect(bootstrap.meta.holdChangeStatus).toBe('not_provided')
    expect(bootstrap.meta.publicChangeBaselineDate).toBe(release.sourceRuns.public.metadata.changeBaseline.reportDate)
    expect(bootstrap.holdSignals.reduce((total: number, row: { activeHoldVins: number }) => total + row.activeHoldVins, 0)).toBe(
      manifest.source_counts.active_held_vins,
    )
    expect(JSON.stringify(bootstrap.holdSignals)).not.toMatch(/customer|reason|salesperson|commentText|alertText/i)
    const howellMissingPrice = bootstrap.vehicles.filter(
      (vehicle: { publicStore: string; listingUrl?: string; listedPrice: number | null }) =>
        vehicle.publicStore === 'Howell' && vehicle.listingUrl && vehicle.listedPrice === null,
    ).length
    const howellMissingPriceAttention = bootstrap.attention.find(
      (item: { store?: string; type: string }) => item.store === 'Howell' && item.type === 'missing_price',
    )
    expect(howellMissingPriceAttention?.count ?? 0).toBe(howellMissingPrice)
    expect(
      bootstrap.attention.some((item: { store?: string; type: string }) => item.type === 'missing_price' && !item.store),
    ).toBe(false)

    const held = bootstrap.vehicles.find((vehicle: { hold: { state: string } }) =>
      ['primary', 'multiple'].includes(vehicle.hold.state),
    )
    const unheld = bootstrap.vehicles.find((vehicle: { hold: { state: string } }) =>
      vehicle.hold.state === 'none_observed',
    )
    expect(held).toBeTruthy()
    expect(unheld).toBeTruthy()
    expect(unheld.hold.canViewEvidence).toBe(true)
    expect(unheld.hold.canManage).toBe(true)

    const salesDetail = await fetch(`${baseUrl}/api/vehicles/${held.vin}`, {
      headers: { 'x-inventory-role': 'sales', 'x-inventory-store': held.publicStore },
    }).then((response) => response.json())
    const managerDetail = await fetch(`${baseUrl}/api/vehicles/${held.vin}`, {
      headers: { 'x-inventory-role': 'manager', 'x-inventory-store': held.publicStore },
    }).then((response) => response.json())
    const porterDetail = await fetch(`${baseUrl}/api/vehicles/${held.vin}`, {
      headers: { 'x-inventory-role': 'porter', 'x-inventory-store': held.publicStore },
    }).then((response) => response.json())
    expect(salesDetail.privateEvidence).toBeTruthy()
    expect(salesDetail.hold.reason).toBeTruthy()
    expect(salesDetail.hold.canManage).toBe(true)
    expect(salesDetail.privateEvidence.sourceLinks).toBeUndefined()
    expect(salesDetail.privateEvidence.comments.every((comment: Record<string, unknown>) => !('sourceUrl' in comment))).toBe(true)
    expect(salesDetail.privateEvidence.alerts.every((alert: Record<string, unknown>) => !('sourceUrl' in alert))).toBe(true)
    expect(salesDetail.privateEvidence.cdk?.sourceUrl).toBeUndefined()
    expect(managerDetail.privateEvidence).toBeTruthy()
    expect(managerDetail.hold.reason).toBeTruthy()
    expect(porterDetail.privateEvidence).toBeUndefined()
    expect(porterDetail.hold.canManage).toBe(false)
    expect(porterDetail.hold.canViewEvidence).toBe(false)
    expect(porterDetail.hold.reason).toBeUndefined()
    expect(porterDetail.hold.primarySalesperson).toBeUndefined()

    const managerBootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=${held.publicStore}&role=manager`).then(
      (response) => response.json(),
    )
    const managerListRow = managerBootstrap.vehicles.find((vehicle: { vin: string }) => vehicle.vin === held.vin)
    expect(managerListRow.privateEvidence).toBeUndefined()
    expect(managerListRow.searchText).toContain(managerDetail.hold.reason.toLowerCase())

    const rowWithBackup = managerBootstrap.vehicles.find(
      (vehicle: { hold: { backupCount: number } }) => vehicle.hold.backupCount > 0,
    )
    expect(rowWithBackup).toBeTruthy()
    const backupDetail = await fetch(`${baseUrl}/api/vehicles/${rowWithBackup.vin}`, {
      headers: { 'x-inventory-role': 'manager', 'x-inventory-store': rowWithBackup.publicStore },
    }).then((response) => response.json())
    const backupSalesperson = backupDetail.privateEvidence.backups.find(
      (backup: { salesperson?: string }) => Boolean(backup.salesperson),
    )?.salesperson
    expect(backupSalesperson).toBeTruthy()
    const backupListRow = managerBootstrap.vehicles.find(
      (vehicle: { vin: string }) => vehicle.vin === rowWithBackup.vin,
    )
    expect(backupListRow.searchText).toContain(backupSalesperson.toLowerCase())

    const porterBootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=${rowWithBackup.publicStore}&role=porter`).then(
      (response) => response.json(),
    )
    const porterBackupRow = porterBootstrap.vehicles.find(
      (vehicle: { vin: string }) => vehicle.vin === rowWithBackup.vin,
    )
    expect(porterBackupRow.hold.canManage).toBe(false)
    expect(porterBackupRow.searchText).not.toContain(backupSalesperson.toLowerCase())

    const privateSearch = await fetch(
      `${baseUrl}/api/vehicles?q=${encodeURIComponent(managerDetail.hold.reason)}&limit=10`,
      { headers: { 'x-inventory-role': 'sales', 'x-inventory-store': held.publicStore } },
    ).then((response) => response.json())
    expect(privateSearch.items.some((vehicle: { vin: string }) => vehicle.vin === held.vin)).toBe(true)
    expect(privateSearch.items[0].privateEvidence).toBeUndefined()
  })

  it('keeps CRM-only held VINs in the safe Today hold-signal totals', async () => {
    const { baseUrl, database } = await harness()
    const before = await fetch(`${baseUrl}/api/bootstrap?homeStore=Howell&role=sales`).then((response) => response.json())
    const held = database
      .prepare('SELECT vin, crm_store_id FROM hold_vehicle_snapshots WHERE active_hold_count > 0 ORDER BY vin LIMIT 1')
      .get()
    expect(held).toBeTruthy()
    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(held.vin)

    const after = await fetch(`${baseUrl}/api/bootstrap?homeStore=Howell&role=sales`).then((response) => response.json())
    expect(after.vehicles.some((vehicle: { vin: string }) => vehicle.vin === held.vin)).toBe(false)
    expect(after.holdSignals.find((row: { store: string }) => row.store === held.crm_store_id)).toEqual(
      before.holdSignals.find((row: { store: string }) => row.store === held.crm_store_id),
    )
  })

  it('enforces manager review, release evidence, driver coordination, and porter handoffs', async () => {
    const { baseUrl, database } = await harness()
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=Fowlerville&role=sales`).then((response) => response.json())
    const vehicle = bootstrap.vehicles.find((row: { publicStore: string }) => row.publicStore === 'Howell')

    const { response: createdResponse, body: created } = await createSalesRequest(baseUrl, vehicle)
    expect(createdResponse.status).toBe(201)
    expect(created.requestStatus).toBe('requested')
    expect(created.requestedBy).toBe('Fowlerville Salesperson')
    expect(created.events).toHaveLength(1)
    expect(created.allowedActions).not.toContain('review-request')

    const wrongStoreReview = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Ford Detroit', user: 'Detroit Manager' },
      { type: 'manager_reviewed' },
    )
    expect(wrongStoreReview.response.status).toBe(403)
    expect(wrongStoreReview.body.code).toBe('WRONG_STORE_ROLE')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(1)

    const review = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      { type: 'manager_reviewed', note: 'Requesting manager reviewed the customer need.' },
    )
    expect(review.response.status).toBe(201)
    expect(review.body.requestStatus).toBe('manager_reviewed')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(2)

    const missingReleaseNote = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { type: 'approved' },
    )
    expect(missingReleaseNote.response.status).toBe(422)
    expect(missingReleaseNote.body.code).toBe('VALIDATION_ERROR')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(2)

    const releaseNote = 'Vehicle physically located; Howell used manager confirms it may be released.'
    const release = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { type: 'approved', note: releaseNote },
    )
    expect(release.response.status).toBe(201)
    expect(release.body.requestStatus).toBe('approved')
    expect(release.body.events.find((event: { type: string }) => event.type === 'approved').note).toBe(releaseNote)

    const driverRequested = await postEvent(
      baseUrl,
      created.id,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson' },
      { type: 'driver_requested', note: 'Requesting a driver after confirmed release.' },
    )
    expect(driverRequested.response.status).toBe(201)
    expect(driverRequested.body.requestStatus).toBe('approved')
    expect(driverRequested.body.nextAction).toContain('assigns the driver')

    const missingAssignee = await postEvent(
      baseUrl,
      created.id,
      { role: 'coordinator', store: 'Fowlerville', user: 'Transport Coordinator' },
      { type: 'transport_assigned', dueAt: '2026-08-30T13:30:00-04:00' },
    )
    expect(missingAssignee.response.status).toBe(422)
    expect(missingAssignee.body.error).toContain('assignee is required')

    const missingDue = await postEvent(
      baseUrl,
      created.id,
      { role: 'coordinator', store: 'Fowlerville', user: 'Transport Coordinator' },
      { type: 'transport_assigned', assignee: 'Porter One' },
    )
    expect(missingDue.response.status).toBe(422)
    expect(missingDue.body.error).toContain('dueAt is required')

    const dueAt = '2026-08-30T13:30:00-04:00'
    const assigned = await postEvent(
      baseUrl,
      created.id,
      { role: 'coordinator', store: 'Fowlerville', user: 'Transport Coordinator' },
      { type: 'transport_assigned', assignee: 'Porter One', dueAt },
    )
    expect(assigned.response.status).toBe(201)
    expect(assigned.body.requestStatus).toBe('transport_assigned')
    expect(assigned.body.transportAssignee).toBe('Porter One')
    expect(assigned.body.dueAt).toBe(new Date(dueAt).toISOString())

    const vehicleWithMovement = await fetch(`${baseUrl}/api/vehicles/${vehicle.vin}`, {
      headers: roleHeaders('sales', 'Fowlerville', 'Fowlerville Salesperson'),
    }).then((response) => response.json())
    expect(vehicleWithMovement.movement.transportAssignee).toBe('Porter One')
    expect(vehicleWithMovement.movement.dueAt).toBe(new Date(dueAt).toISOString())

    const pickup = await postEvent(
      baseUrl,
      created.id,
      { role: 'porter', store: 'Fowlerville', user: 'Porter One' },
      { type: 'picked_up', store: 'Howell', note: 'Custody and keys received.' },
    )
    expect(pickup.response.status).toBe(201)
    expect(pickup.body.requestStatus).toBe('picked_up')
    expect(pickup.body.currentLocation).toBe('In transit')

    const arrival = await postEvent(
      baseUrl,
      created.id,
      { role: 'porter', store: 'Fowlerville', user: 'Porter One' },
      { type: 'arrived', note: 'Vehicle delivered to Fowlerville.' },
    )
    expect(arrival.response.status).toBe(201)
    expect(arrival.body.requestStatus).toBe('arrived')
    expect(arrival.body.currentLocation).toBe('Fowlerville')
    expect(arrival.body.movementStatus).toBe('at_requesting_store')
  })

  it('requires Home Store return confirmation and blocks sold-pending closure', async () => {
    const { baseUrl } = await harness()
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=Fowlerville&role=sales`).then((response) => response.json())
    const howellVehicles = bootstrap.vehicles.filter((row: { publicStore: string }) => row.publicStore === 'Howell')

    const returnFlow = await advanceToArrival(baseUrl, howellVehicles[0], ' Return')
    const notSold = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson Return' },
      { type: 'not_sold', note: 'Customer declined the vehicle.' },
    )
    expect(notSold.response.status).toBe(201)

    const conditionIssue = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson Return' },
      {
        type: 'condition_issue',
        note: 'Severity: needs-review; Safe to drive: yes; Home-store manager acknowledgment: pending; Issue: New curb rash on right-front wheel.',
      },
    )
    expect(conditionIssue.response.status).toBe(201)
    expect(conditionIssue.body.requestStatus).toBe('not_sold')

    const homeManagerView = await fetch(`${baseUrl}/api/transfers/${returnFlow.transferId}`, {
      headers: roleHeaders('manager', 'Howell', 'Howell Used Manager Return'),
    }).then((response) => response.json())
    const recordedCondition = homeManagerView.events.find((event: { type: string }) => event.type === 'condition_issue')
    expect(recordedCondition.label).toBe('Vehicle condition issue reported')
    expect(recordedCondition.note).toContain('Home-store manager acknowledgment: pending')
    expect(recordedCondition.note).toContain('New curb rash on right-front wheel')

    const returnRequested = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager Return' },
      { type: 'return_requested', dueAt: '2026-08-31T16:00:00-04:00' },
    )
    expect(returnRequested.response.status).toBe(201)

    const returnAssigned = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'coordinator', store: 'Fowlerville', user: 'Transport Coordinator Return' },
      {
        type: 'return_assigned',
        assignee: 'Return Porter',
        dueAt: '2026-08-31T15:30:00-04:00',
      },
    )
    expect(returnAssigned.response.status).toBe(201)

    const returning = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'porter', store: 'Fowlerville', user: 'Return Porter' },
      { type: 'return_in_transit', note: 'Vehicle departed for Howell.' },
    )
    expect(returning.response.status).toBe(201)

    const wrongStoreReceipt = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager Return' },
      { type: 'returned_home', note: 'Wrong store must not confirm this.' },
    )
    expect(wrongStoreReceipt.response.status).toBe(403)
    expect(wrongStoreReceipt.body.code).toBe('WRONG_STORE_ROLE')

    const homeReceipt = await postEvent(
      baseUrl,
      returnFlow.transferId,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager Return' },
      { type: 'returned_home', note: 'Howell manager confirms receipt and keys.' },
    )
    expect(homeReceipt.response.status).toBe(201)
    expect(homeReceipt.body.requestStatus).toBe('returned_home')
    expect(homeReceipt.body.currentLocation).toBe('Howell')

    const soldFlow = await advanceToArrival(baseUrl, howellVehicles[1], ' Sold')
    const soldPending = await postEvent(
      baseUrl,
      soldFlow.transferId,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson Sold' },
      { type: 'sale_outcome_pending', note: 'Paperwork pending; delivery not confirmed.' },
    )
    expect(soldPending.response.status).toBe(201)
    expect(soldPending.body.requestStatus).toBe('sale_outcome_pending')
    expect(soldPending.body.dealStatus).toBe('pending_confirmation')

    const prematureClose = await postEvent(
      baseUrl,
      soldFlow.transferId,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager Sold' },
      { type: 'closed', note: 'Must not close before confirmed sale and delivery.' },
    )
    expect(prematureClose.response.status).toBe(409)
    expect(prematureClose.body.code).toBe('INVALID_TRANSITION')
    expect(prematureClose.body.details.currentStatus).toBe('sale_outcome_pending')

    const unchanged = await fetch(`${baseUrl}/api/transfers/${soldFlow.transferId}`, {
      headers: roleHeaders('manager', 'Fowlerville', 'Fowlerville Manager Sold'),
    }).then((response) => response.json())
    expect(unchanged.requestStatus).toBe('sale_outcome_pending')
    expect(unchanged.deliveryStatus).toBe('not_confirmed')
    expect(unchanged.events.filter((event: { type: string }) => event.type === 'closed')).toHaveLength(0)
  })
})
