// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { createInventoryServer, prepareNodeTransferEventInput } from '../../server/api.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { findLatestCompletedManifest, loadLatestCompletedRelease } from '../../server/importer.mjs'
import { createInventoryService } from '../../server/service.mjs'

const openResources: Array<{ server: ReturnType<typeof createInventoryServer>; database: ReturnType<typeof openInventoryDatabase> }> = []
const openWorkspaces: Array<ReturnType<typeof createSyntheticWorkspace>> = []

afterEach(async () => {
  while (openResources.length) {
    const resource = openResources.pop()!
    await new Promise<void>((resolve) => resource.server.close(() => resolve()))
    resource.database.close()
  }
  while (openWorkspaces.length) openWorkspaces.pop()?.cleanup()
})

async function harness(mutateRelease?: (release: ReturnType<typeof loadLatestCompletedRelease>) => void) {
  const fixture = createSyntheticWorkspace()
  openWorkspaces.push(fixture)
  const { manifest } = findLatestCompletedManifest(fixture.workspaceRoot)
  const fixedNow = new Date(`${manifest.report_date}T18:00:00-04:00`)
  const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: fixedNow })
  mutateRelease?.(release)
  const database = openInventoryDatabase()
  importRelease(database, release, { loadedAt: fixedNow.toISOString() })
  // Keep the detailed legacy workflow's security and audit regression suite.
  // The simple default has dedicated coverage in simple-moves-workflow.test.ts.
  const service = createInventoryService({ database, now: () => fixedNow, workflowMode: 'advanced' })
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

async function postAttentionEvent(
  baseUrl: string,
  attentionId: string,
  context: { role: string; store: string; user: string },
  event: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}/api/attention/${encodeURIComponent(attentionId)}/events`, {
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
    { role: 'manager', store: 'Fowlerville', user: `Fowlerville Manager${suffix}` },
    {
      type: 'approved',
      homeStoreManager: `Howell Used Manager${suffix}`,
      note: 'Vehicle located and explicitly released for the requesting store.',
    },
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
    { type: 'picked_up', note: 'Keys and custody received at Home Store.' },
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
  it('fails closed when the standalone Node API cannot resolve a stable transport assignee identity', () => {
    const stableContext = {
      role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager', userId: 'manager-1',
    }
    expect(() => prepareNodeTransferEventInput({
      type: 'transport_assigned', assignee: 'Alex Driver', assigneeUserId: 'attacker-chosen-id',
    }, stableContext)).toThrowError(expect.objectContaining({ code: 'ASSIGNEE_IDENTITY_CLIENT_CONTROLLED' }))
    expect(() => prepareNodeTransferEventInput({
      type: 'transport_assigned', assignee: 'Alex Driver',
    }, stableContext)).toThrowError(expect.objectContaining({ code: 'ASSIGNEE_DIRECTORY_UNAVAILABLE' }))
    expect(prepareNodeTransferEventInput({ type: 'transport_assigned', assignee: 'Demo Porter' }, {
      role: 'manager', store: 'Fowlerville', user: 'Demo Manager', userId: null,
    })).toEqual({ type: 'transport_assigned', assignee: 'Demo Porter' })
    expect(() => prepareNodeTransferEventInput({
      type: 'note_added', note: 'No assignee identity belongs on this event.', assigneeUserId: 'forged-audit-id',
    }, stableContext)).toThrowError(expect.objectContaining({ code: 'ASSIGNEE_IDENTITY_CLIENT_CONTROLLED' }))
  })

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

  it('exposes normalized public scan audit fields on vehicle detail without bloating bootstrap rows', async () => {
    const { baseUrl, database } = await harness()
    const rows = database
      .prepare('SELECT vin, physical_store_id, payload_json FROM public_vehicle_snapshots ORDER BY vin LIMIT 2')
      .all()
    const auditedPayload = JSON.parse(rows[0].payload_json)
    auditedPayload.actual_location = 'Howell — verified DealerOn location'
    auditedPayload.location_city = 'Howell'
    auditedPayload.dealer_location_id = '21521'
    auditedPayload.dealer_name = 'Bob Maxey Ford of Howell'
    auditedPayload.vehicle_id = 987654
    auditedPayload.generic_color = 'Blue'
    auditedPayload.source_sites = ['Howell public inventory', 'Shared group inventory', '  ']
    auditedPayload.source_count = 2
    auditedPayload.first_seen = '2026-07-15'
    auditedPayload.last_seen = '2026-08-30'
    auditedPayload.data_status = 'Complete verified public scan'
    database
      .prepare('UPDATE public_vehicle_snapshots SET payload_json = ? WHERE vin = ?')
      .run(JSON.stringify(auditedPayload), rows[0].vin)

    const detailResponse = await fetch(`${baseUrl}/api/vehicles/${rows[0].vin}`, {
      headers: roleHeaders('sales', rows[0].physical_store_id, 'Public scan audit test'),
    })
    const detail = await detailResponse.json()
    expect(detailResponse.status).toBe(200)
    expect(detail.dataStatus).toBe('Complete verified public scan')
    expect(detail.publicScan).toEqual({
      actualLocation: 'Howell — verified DealerOn location',
      locationCity: 'Howell',
      dealerLocationId: 21521,
      dealerName: 'Bob Maxey Ford of Howell',
      vehicleId: 987654,
      genericColor: 'Blue',
      sourceSites: ['Howell public inventory', 'Shared group inventory'],
      sourceCount: 2,
      firstSeen: '2026-07-15',
      lastSeen: '2026-08-30',
    })

    const sentinelPayload = JSON.parse(rows[1].payload_json)
    sentinelPayload.vehicle_id = 0
    database
      .prepare('UPDATE public_vehicle_snapshots SET payload_json = ? WHERE vin = ?')
      .run(JSON.stringify(sentinelPayload), rows[1].vin)
    const sentinelDetail = await fetch(`${baseUrl}/api/vehicles/${rows[1].vin}`, {
      headers: roleHeaders('sales', rows[1].physical_store_id, 'Vehicle ID sentinel test'),
    }).then((response) => response.json())
    expect(sentinelDetail.publicScan.vehicleId).toBeNull()

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=Howell&role=sales`).then((response) => response.json())
    expect(bootstrap.vehicles.find((vehicle: { vin: string }) => vehicle.vin === rows[0].vin).publicScan).toBeUndefined()
  })

  it('reports merged vehicle resource coverage while retaining a numeric resources count', async () => {
    const { baseUrl, database } = await harness()
    const row = database
      .prepare("SELECT vin, physical_store_id, payload_json FROM public_vehicle_snapshots WHERE vin <> 'TESTDATAHWELL0001' ORDER BY vin LIMIT 1")
      .get()
    const payload = JSON.parse(row.payload_json)
    const hosts: Record<string, string> = {
      Howell: 'www.bobmaxeyfordhowell.com',
      Fowlerville: 'www.bobmaxeyfordinfowlerville.com',
      'Ford Detroit': 'www.bobmaxeyford.com',
      Lincoln: 'www.bobmaxeylincoln.com',
    }
    payload.photo_urls = [
      `https://${hosts[row.physical_store_id]}/inventoryphotos/verified/${row.vin.toLowerCase()}/ip/1.jpg`,
    ]
    payload.autoCheckReport = { dataState: 'current', sourceLabel: 'Synthetic AutoCheck report' }
    payload.windowSticker = { dataState: 'current', sourceLabel: 'Synthetic official window sticker' }
    database
      .prepare('UPDATE public_vehicle_snapshots SET payload_json = ? WHERE vin = ?')
      .run(JSON.stringify(payload), row.vin)

    const response = await fetch(`${baseUrl}/api/health`)
    const health = await response.json()
    expect(response.status).toBe(200)
    expect(health.counts.resources).toBe(2)
    expect(health.counts.resourceCoverage).toEqual({
      vehicles: 2,
      photos: 1,
      photoUrls: 1,
      autoCheck: 1,
      windowStickers: 1,
      factoryEquipment: 1,
      enrichmentRows: 1,
    })
    expect(health.sources.resources.rows).toBe(1)
  })

  it('exposes and searches VIN-linked factory equipment for public and CRM-only vehicles', async () => {
    const { baseUrl, database } = await harness()
    const vin = 'TESTDATAHWELL0001'
    const crm = database.prepare('SELECT crm_store_id FROM crm_vehicle_snapshots WHERE vin = ?').get(vin)
    expect(crm).toBeTruthy()

    const detailResponse = await fetch(`${baseUrl}/api/vehicles/${vin}`, {
      headers: roleHeaders('sales', crm.crm_store_id, 'Factory-equipment test'),
    })
    const detail = await detailResponse.json()
    expect(detailResponse.status).toBe(200)
    expect(detail.factoryEquipment).toMatchObject({
      dataState: 'current',
      url: 'https://assets.cai-media-management.com/window-stickers/00000000-0000-4000-8000-000000000001.jpg',
      totalMsrp: 68420,
      isOriginalWindowSticker: false,
    })
    expect(detail.factoryEquipment.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Synthetic Premium Technology Package', code: 'DEMO' })]),
    )
    expect(detail.searchText).toContain('360-degree camera')
    expect(detail.searchText).toContain('not original monroney window sticker')

    const publicSearch = await fetch(
      `${baseUrl}/api/vehicles?q=${encodeURIComponent('Synthetic Premium Technology Package')}&limit=10`,
      { headers: roleHeaders('sales', crm.crm_store_id, 'Factory-equipment search') },
    ).then((response) => response.json())
    expect(publicSearch.items.some((vehicle: { vin: string }) => vehicle.vin === vin)).toBe(true)

    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(vin)
    const crmOnlyResponse = await fetch(
      `${baseUrl}/api/vehicles?includeCrmOnly=true&q=${encodeURIComponent('Antimatter Blue Metallic')}&limit=10`,
      { headers: roleHeaders('sales', crm.crm_store_id, 'CRM-only resource search') },
    )
    const crmOnly = await crmOnlyResponse.json()
    expect(crmOnlyResponse.status).toBe(200)
    expect(crmOnly.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vin,
          publicListingState: 'Not publicly listed in verified release',
          factoryEquipment: expect.objectContaining({ totalMsrp: 68420 }),
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

  it('shows unheld vehicle alerts and released history only in authorized evidence and search', async () => {
    let vin = ''
    const { baseUrl, database } = await harness((release) => {
      const vehicle = release.vehicles.find((row) => row.crmRecord && row.publicRecord && !row.holdRecord)
      vin = vehicle.vin
      vehicle.crmRecord.comments = [{ rows: [{ commentTextRaw: 'Synthetic unheld inspection note', authorRaw: 'Synthetic reviewer', timestampRaw: '08/30/2026 09:15 AM' }] }]
      vehicle.crmRecord.alerts = [{ alertTextRaw: 'Synthetic unheld transport restriction', modifiedMetadataRaw: 'Modified by Synthetic manager on 08/30/2026 09:20 AM', spiffRaw: '$150 synthetic' }]
      release.releasedHoldHistory = [{ vin, stockNumber: vehicle.crmRecord.stockNumber, holdDetailRows: [
        { orderRaw: '1', lifecycleStatus: 'active', salespersonRaw: 'Historical salesperson', customerOrReasonRaw: 'Synthetic former hold reason', holdDateRaw: '08/20/2026', expectedDeliveryDateRaw: '08/22/2026' },
        { orderRaw: 'DELETED', lifecycleStatus: 'deleted_history', customerOrReasonRaw: 'Synthetic deleted former reason' },
      ] }]
    })
    const headers = roleHeaders('sales', 'Howell', 'Synthetic sales')
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, { headers }).then((response) => response.json())
    const row = bootstrap.vehicles.find((vehicle) => vehicle.vin === vin)
    expect(row.hold).toMatchObject({ state: 'none_observed', backupCount: 0, commentsCount: 1, alertsCount: 1 })
    expect(row.searchText).toContain('synthetic unheld transport restriction')
    expect(row.searchText).toContain('synthetic former hold reason')
    const alert = bootstrap.attention.find((item) => item.vin === vin && item.type === 'vehicle_alert')
    expect(alert).toMatchObject({ label: 'Vehicle alert needs review' })
    expect(JSON.stringify(alert)).not.toMatch(/Synthetic unheld|Synthetic former/)
    const detail = await fetch(`${baseUrl}/api/vehicles/${vin}`, { headers }).then((response) => response.json())
    expect(detail.privateEvidence.primary).toBeNull()
    expect(detail.privateEvidence.comments).toHaveLength(1)
    expect(detail.privateEvidence.alerts).toHaveLength(1)
    expect(detail.privateEvidence.alerts[0]).toMatchObject({ metadataRaw: 'Modified by Synthetic manager on 08/30/2026 09:20 AM', spiffRaw: '$150 synthetic' })
    expect(row.searchText).toContain('$150 synthetic')
    expect(detail.privateEvidence.history).toHaveLength(2)
    expect(detail.privateEvidence.history[0].statusLabel).toBe('Not in current live hold set; detail page retains order 1 — review')
    expect(database.prepare('SELECT count(*) AS n FROM hold_vehicle_snapshots WHERE vin = ?').get(vin).n).toBe(0)
    const search = await fetch(`${baseUrl}/api/vehicles?q=Synthetic%20former%20hold%20reason`, { headers }).then((response) => response.json())
    expect(search.items.some((vehicle) => vehicle.vin === vin)).toBe(true)
    const restricted = await fetch(`${baseUrl}/api/vehicles/${vin}`, { headers: roleHeaders('porter', 'Howell', 'Synthetic porter') }).then((response) => response.json())
    expect(restricted.privateEvidence).toBeUndefined()
    expect(restricted.searchText).not.toMatch(/synthetic unheld|synthetic former|historical salesperson/)
    database.prepare('DELETE FROM public_vehicle_snapshots WHERE vin = ?').run(vin)
    const crmOnly = await fetch(`${baseUrl}/api/bootstrap`, { headers }).then((response) => response.json())
    expect(crmOnly.attention.some((item) => item.vin === vin && item.type === 'vehicle_alert')).toBe(true)
  })

  it('scopes transfer reads and writes to related managers, group managers, and the assigned driver', async () => {
    const { baseUrl, database } = await harness()
    const seed = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: roleHeaders('sales', 'Fowlerville', 'Fowlerville Salesperson'),
    }).then((response) => response.json())
    const vehicle = seed.vehicles.find((row: { publicStore: string }) => row.publicStore === 'Howell')
    const requested = await createSalesRequest(baseUrl, vehicle, 'Fowlerville Salesperson')
    expect(requested.response.status).toBe(201)
    const transferId = requested.body.id

    const unrelatedManager = roleHeaders('manager', 'Ford Detroit', 'Detroit Manager')
    const unrelatedList = await fetch(`${baseUrl}/api/transfers`, { headers: unrelatedManager }).then((response) =>
      response.json(),
    )
    expect(unrelatedList.items.some((row: { id: string }) => row.id === transferId)).toBe(false)

    const unrelatedRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers: unrelatedManager })
    expect(unrelatedRead.status).toBe(404)
    expect((await unrelatedRead.json()).code).toBe('TRANSFER_NOT_FOUND')

    const unrelatedBootstrap = await fetch(`${baseUrl}/api/bootstrap`, { headers: unrelatedManager }).then((response) =>
      response.json(),
    )
    expect(unrelatedBootstrap.transfers.some((row: { id: string }) => row.id === transferId)).toBe(false)
    expect(unrelatedBootstrap.attention.some((item: { sourceId?: string }) => item.sourceId === transferId)).toBe(false)
    expect(unrelatedBootstrap.vehicles.find((row: { vin: string }) => row.vin === vehicle.vin).movement.transferId).toBeUndefined()

    const beforeUnrelatedWrite = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    const unrelatedWrite = await postEvent(
      baseUrl,
      transferId,
      { role: 'manager', store: 'Ford Detroit', user: 'Detroit Manager' },
      { type: 'note_added', note: 'This unrelated manager must not reach the transfer ledger.' },
    )
    expect(unrelatedWrite.response.status).toBe(404)
    expect(unrelatedWrite.body.code).toBe('TRANSFER_NOT_FOUND')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(beforeUnrelatedWrite)

    for (const context of [
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
    ]) {
      const list = await fetch(`${baseUrl}/api/transfers`, {
        headers: roleHeaders(context.role, context.store, context.user),
      }).then((response) => response.json())
      expect(list.items.some((row: { id: string }) => row.id === transferId)).toBe(true)
      const read = await fetch(`${baseUrl}/api/transfers/${transferId}`, {
        headers: roleHeaders(context.role, context.store, context.user),
      })
      expect(read.status).toBe(200)
      expect((await read.json()).privateEvidence.customerReference).toBe('Private test reference')
    }

    const groupManager = roleHeaders('group_manager', 'Lincoln', 'Group Manager')
    const groupList = await fetch(`${baseUrl}/api/transfers`, { headers: groupManager }).then((response) => response.json())
    expect(groupList.items.some((row: { id: string }) => row.id === transferId)).toBe(true)
    const groupRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers: groupManager })
    expect(groupRead.status).toBe(200)
    expect((await groupRead.json()).privateEvidence.customerReference).toBe('Private test reference')
    const groupNote = await postEvent(
      baseUrl,
      transferId,
      { role: 'group_manager', store: 'Lincoln', user: 'Group Manager' },
      { type: 'note_added', note: 'Authorized group-wide operational review.' },
    )
    expect(groupNote.response.status).toBe(201)

    const review = await postEvent(
      baseUrl,
      transferId,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      { type: 'manager_reviewed', note: 'Requesting-store manager reviewed the request.' },
    )
    expect(review.response.status).toBe(201)
    const approval = await postEvent(
      baseUrl,
      transferId,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      {
        type: 'approved',
        homeStoreManager: 'Howell Used Manager',
        note: 'Howell manager confirmed the vehicle may be released.',
      },
    )
    expect(approval.response.status).toBe(201)
    const driverRequest = await postEvent(
      baseUrl,
      transferId,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson' },
      { type: 'driver_requested' },
    )
    expect(driverRequest.response.status).toBe(201)
    const assignment = await postEvent(
      baseUrl,
      transferId,
      { role: 'coordinator', store: 'Fowlerville', user: 'Fowlerville Coordinator' },
      { type: 'transport_assigned', assignee: 'Assigned Driver', dueAt: '2026-08-30T13:30:00-04:00' },
    )
    expect(assignment.response.status).toBe(201)

    for (const role of ['porter', 'driver']) {
      const context = { role, store: 'Fowlerville', user: `Unassigned ${role}` }
      const headers = roleHeaders(context.role, context.store, context.user)
      const list = await fetch(`${baseUrl}/api/transfers`, { headers }).then((response) => response.json())
      expect(list.items.some((row: { id: string }) => row.id === transferId)).toBe(false)
      const read = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers })
      expect(read.status).toBe(404)
      const vehicleRead = await fetch(`${baseUrl}/api/vehicles/${vehicle.vin}`, { headers }).then((response) =>
        response.json(),
      )
      expect(vehicleRead.movement.transferId).toBeUndefined()
      const beforeWrite = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
      const write = await postEvent(baseUrl, transferId, context, {
        type: 'picked_up',
        note: 'An unassigned transport user must not record custody.',
      })
      expect(write.response.status).toBe(404)
      expect(write.body.code).toBe('TRANSFER_NOT_FOUND')
      expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(beforeWrite)
    }

    const assignedHeaders = roleHeaders('driver', 'Fowlerville', 'Assigned Driver')
    const assignedList = await fetch(`${baseUrl}/api/transfers`, { headers: assignedHeaders }).then((response) =>
      response.json(),
    )
    expect(assignedList.items.some((row: { id: string }) => row.id === transferId)).toBe(true)
    const assignedRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers: assignedHeaders })
    expect(assignedRead.status).toBe(200)
    const assignedRecord = await assignedRead.json()
    expect(assignedRecord.privateEvidence).toBeUndefined()
    expect(assignedRecord.allowedActions).toContain('confirm-pickup')
    const pickup = await postEvent(
      baseUrl,
      transferId,
      { role: 'driver', store: 'Fowlerville', user: 'Assigned Driver' },
      { type: 'picked_up', note: 'Assigned driver received the keys and custody.' },
    )
    expect(pickup.response.status).toBe(201)
    expect(pickup.body.movementStatus).toBe('picked_up')

    const arrival = await postEvent(
      baseUrl,
      transferId,
      { role: 'driver', store: 'Fowlerville', user: 'Assigned Driver' },
      { type: 'arrived', note: 'Assigned driver delivered the vehicle to the requesting store.' },
    )
    expect(arrival.response.status).toBe(201)
    const formerDriverAfterArrival = roleHeaders('driver', 'Fowlerville', 'Assigned Driver')
    const postArrivalList = await fetch(`${baseUrl}/api/transfers`, { headers: formerDriverAfterArrival }).then(
      (response) => response.json(),
    )
    expect(postArrivalList.items.some((row: { id: string }) => row.id === transferId)).toBe(false)
    const postArrivalRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers: formerDriverAfterArrival })
    expect(postArrivalRead.status).toBe(404)
    const beforePostArrivalWrite = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    const postArrivalWrite = await postEvent(
      baseUrl,
      transferId,
      { role: 'driver', store: 'Fowlerville', user: 'Assigned Driver' },
      { type: 'note_added', note: 'A completed outbound assignment no longer authorizes ledger access.' },
    )
    expect(postArrivalWrite.response.status).toBe(404)
    expect(postArrivalWrite.body.code).toBe('TRANSFER_NOT_FOUND')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(beforePostArrivalWrite)

    const notSold = await postEvent(
      baseUrl,
      transferId,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson' },
      { type: 'not_sold', note: 'Customer did not purchase; outcome does not imply availability.' },
    )
    expect(notSold.response.status).toBe(201)
    const returnRequest = await postEvent(
      baseUrl,
      transferId,
      { role: 'sales', store: 'Fowlerville', user: 'Fowlerville Salesperson' },
      { type: 'return_requested', dueAt: '2026-08-31T12:00:00-04:00' },
    )
    expect(returnRequest.response.status).toBe(201)
    const unassignedReturnRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, {
      headers: formerDriverAfterArrival,
    })
    expect(unassignedReturnRead.status).toBe(404)
    const returnAssignment = await postEvent(
      baseUrl,
      transferId,
      { role: 'coordinator', store: 'Fowlerville', user: 'Fowlerville Coordinator' },
      { type: 'return_assigned', assignee: 'Return Driver', dueAt: '2026-08-31T12:00:00-04:00' },
    )
    expect(returnAssignment.response.status).toBe(201)

    const beforeFormerDriverWrite = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    const formerDriverWrite = await postEvent(
      baseUrl,
      transferId,
      { role: 'driver', store: 'Fowlerville', user: 'Assigned Driver' },
      { type: 'return_in_transit', note: 'The former outbound driver is no longer assigned.' },
    )
    expect(formerDriverWrite.response.status).toBe(404)
    expect(formerDriverWrite.body.code).toBe('TRANSFER_NOT_FOUND')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(beforeFormerDriverWrite)

    const returnDriver = await postEvent(
      baseUrl,
      transferId,
      { role: 'driver', store: 'Fowlerville', user: 'Return Driver' },
      { type: 'return_in_transit', note: 'The currently assigned return driver received custody.' },
    )
    expect(returnDriver.response.status).toBe(201)
    expect(returnDriver.body.movementStatus).toBe('return_in_transit')

    const returnedHome = await postEvent(
      baseUrl,
      transferId,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { type: 'returned_home', note: 'Home Store manager confirmed physical receipt.' },
    )
    expect(returnedHome.response.status).toBe(201)
    const postReturnRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, {
      headers: roleHeaders('driver', 'Fowlerville', 'Return Driver'),
    })
    expect(postReturnRead.status).toBe(404)

    const closed = await postEvent(
      baseUrl,
      transferId,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { type: 'closed', note: 'Related Home Store manager closed the completed movement.' },
    )
    expect(closed.response.status).toBe(201)
    const returnDriverHeaders = roleHeaders('driver', 'Fowlerville', 'Return Driver')
    const postCloseList = await fetch(`${baseUrl}/api/transfers`, { headers: returnDriverHeaders }).then((response) =>
      response.json(),
    )
    expect(postCloseList.items.some((row: { id: string }) => row.id === transferId)).toBe(false)
    const postCloseRead = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers: returnDriverHeaders })
    expect(postCloseRead.status).toBe(404)
    const beforePostCloseWrite = database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count
    const postCloseWrite = await postEvent(
      baseUrl,
      transferId,
      { role: 'driver', store: 'Fowlerville', user: 'Return Driver' },
      { type: 'note_added', note: 'A completed return assignment cannot modify a closed workflow.' },
    )
    expect(postCloseWrite.response.status).toBe(404)
    expect(postCloseWrite.body.code).toBe('TRANSFER_NOT_FOUND')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(beforePostCloseWrite)

    const unrelatedAfterMovement = await fetch(`${baseUrl}/api/transfers/${transferId}`, { headers: unrelatedManager })
    expect(unrelatedAfterMovement.status).toBe(404)
  })

  it('enforces manager review, release evidence, driver coordination, and porter handoffs', async () => {
    const { baseUrl, database } = await harness()
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=Fowlerville&role=sales`).then((response) => response.json())
    const vehicle = bootstrap.vehicles.find((row: { publicStore: string }) => row.publicStore === 'Howell')

    const spoofedStore = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: roleHeaders('sales', 'Fowlerville', 'Fowlerville Salesperson'),
      body: JSON.stringify({
        vin: vehicle.vin,
        requestingStore: 'Ford Detroit',
        requestedBy: 'Fowlerville Salesperson',
        neededBy: '2026-08-30T14:00:00-04:00',
        reason: 'Attempted cross-store attribution override',
      }),
    })
    expect(spoofedStore.status).toBe(403)
    expect((await spoofedStore.json()).code).toBe('STORE_MISMATCH')

    const spoofedRequester = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: roleHeaders('sales', 'Fowlerville', 'Fowlerville Salesperson'),
      body: JSON.stringify({
        vin: vehicle.vin,
        requestingStore: 'Fowlerville',
        requestedBy: 'Another Salesperson',
        neededBy: '2026-08-30T14:00:00-04:00',
        reason: 'Attempted requester attribution override',
      }),
    })
    expect(spoofedRequester.status).toBe(403)
    expect((await spoofedRequester.json()).code).toBe('ACTOR_MISMATCH')

    const { response: createdResponse, body: created } = await createSalesRequest(baseUrl, vehicle)
    expect(createdResponse.status).toBe(201)
    expect(created.requestStatus).toBe('requested')
    expect(created.requestedBy).toBe('Fowlerville Salesperson')
    expect(created.nextAction).toBe('Requesting-store manager reviews and approves the request')
    expect(created.events).toHaveLength(1)
    expect(created.allowedActions).not.toContain('review-request')

    const wrongStoreReview = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Ford Detroit', user: 'Detroit Manager' },
      { type: 'manager_reviewed' },
    )
    expect(wrongStoreReview.response.status).toBe(404)
    expect(wrongStoreReview.body.code).toBe('TRANSFER_NOT_FOUND')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(1)

    const spoofedActor = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      { type: 'manager_reviewed', actor: 'Another Manager' },
    )
    expect(spoofedActor.response.status).toBe(403)
    expect(spoofedActor.body.code).toBe('ACTOR_MISMATCH')

    const spoofedEventStore = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      { type: 'manager_reviewed', store: 'Howell' },
    )
    expect(spoofedEventStore.response.status).toBe(403)
    expect(spoofedEventStore.body.code).toBe('STORE_MISMATCH')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(1)

    const prematureHomeStoreRelease = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      {
        type: 'approved',
        homeStoreManager: 'Howell Used Manager',
        note: 'Howell manager confirms the unit may be released.',
      },
    )
    expect(prematureHomeStoreRelease.response.status).toBe(409)
    expect(prematureHomeStoreRelease.body.code).toBe('INVALID_TRANSITION')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(1)

    const review = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      { type: 'manager_reviewed', note: 'Requesting manager reviewed the customer need.' },
    )
    expect(review.response.status).toBe(201)
    expect(review.body.requestStatus).toBe('manager_reviewed')
    expect(review.body.nextAction).toBe(
      'Requesting-store manager calls Howell used-car manager and records the release decision',
    )
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(2)

    const requestingManagerView = await fetch(`${baseUrl}/api/transfers/${created.id}`, {
      headers: roleHeaders('manager', 'Fowlerville', 'Fowlerville Manager'),
    }).then((response) => response.json())
    const homeStoreManagerView = await fetch(`${baseUrl}/api/transfers/${created.id}`, {
      headers: roleHeaders('manager', 'Howell', 'Howell Used Manager'),
    }).then((response) => response.json())
    expect(requestingManagerView.allowedActions).toContain('approve')
    expect(homeStoreManagerView.allowedActions).not.toContain('approve')

    const missingHomeStoreManager = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { type: 'approved' },
    )
    expect(missingHomeStoreManager.response.status).toBe(422)
    expect(missingHomeStoreManager.body.code).toBe('VALIDATION_ERROR')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(2)

    const directHomeStoreRelease = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Howell', user: 'Howell Used Manager' },
      { type: 'approved', homeStoreManager: 'Howell Used Manager', note: 'Attempted direct Home Store action.' },
    )
    expect(directHomeStoreRelease.response.status).toBe(403)
    expect(directHomeStoreRelease.body.code).toBe('WRONG_STORE_ROLE')
    expect(database.prepare('SELECT COUNT(*) AS count FROM transfer_events').get().count).toBe(2)

    const releaseNote = 'Vehicle physically located; Howell used manager confirms it may be released.'
    const release = await postEvent(
      baseUrl,
      created.id,
      { role: 'manager', store: 'Fowlerville', user: 'Fowlerville Manager' },
      { type: 'approved', homeStoreManager: 'Howell Used Manager', note: releaseNote },
    )
    expect(release.response.status).toBe(201)
    expect(release.body.requestStatus).toBe('approved')
    expect(release.body.events.find((event: { type: string }) => event.type === 'approved')).toMatchObject({
      confirmedBy: 'Howell Used Manager',
      note: releaseNote,
    })

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
      { type: 'picked_up', note: 'Custody and keys received.' },
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

  it('keeps operational attention actions auditable and separate from source and transfer truth', async () => {
    const { baseUrl, database } = await harness()
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap?homeStore=Fowlerville&role=sales`).then((response) => response.json())
    const howellVehicle = bootstrap.vehicles.find((row: { publicStore: string }) => row.publicStore === 'Howell')
    const created = await createSalesRequest(baseUrl, howellVehicle, 'Attention Test Salesperson')
    expect(created.response.status).toBe(201)

    const beforeTransfer = await fetch(`${baseUrl}/api/transfers/${created.body.id}`, {
      headers: roleHeaders('manager', 'Fowlerville', 'Attention Test Manager'),
    }).then((response) => response.json())
    const sourceCountsBefore = {
      public: database.prepare('SELECT COUNT(*) AS count FROM public_vehicle_snapshots').get().count,
      crm: database.prepare('SELECT COUNT(*) AS count FROM crm_vehicle_snapshots').get().count,
      holds: database.prepare('SELECT COUNT(*) AS count FROM hold_vehicle_snapshots').get().count,
    }

    const queueResponse = await fetch(`${baseUrl}/api/attention?store=Fowlerville`, {
      headers: roleHeaders('manager', 'Fowlerville', 'Attention Test Manager'),
    })
    const queue = await queueResponse.json()
    expect(queueResponse.status).toBe(200)
    const initial = queue.items.find((item: { sourceId: string }) => item.sourceId === created.body.id)
    const attentionId = initial.id
    expect(initial).toMatchObject({
      status: 'open',
      priority: 'high',
      sourceLabel: 'Inventory Flow transfer ledger',
      events: [],
    })
    expect(initial.allowedActions).toEqual(expect.arrayContaining(['acknowledge', 'assign', 'resolve']))

    const forbiddenAssignment = await postAttentionEvent(
      baseUrl,
      attentionId,
      { role: 'sales', store: 'Fowlerville', user: 'Attention Test Salesperson' },
      { type: 'assign', assignee: 'Someone Else' },
    )
    expect(forbiddenAssignment.response.status).toBe(403)
    expect(forbiddenAssignment.body.code).toBe('FORBIDDEN')

    const spoofedActor = await postAttentionEvent(
      baseUrl,
      attentionId,
      { role: 'manager', store: 'Fowlerville', user: 'Attention Test Manager' },
      { type: 'acknowledge', actor: 'Different Manager' },
    )
    expect(spoofedActor.response.status).toBe(403)
    expect(spoofedActor.body.code).toBe('ACTOR_MISMATCH')

    const acknowledged = await postAttentionEvent(
      baseUrl,
      attentionId,
      { role: 'manager', store: 'Fowlerville', user: 'Attention Test Manager' },
      { type: 'acknowledge', note: 'Manager accepted responsibility for the operational follow-up.' },
    )
    expect(acknowledged.response.status).toBe(201)
    expect(acknowledged.body.status).toBe('acknowledged')

    const assigned = await postAttentionEvent(
      baseUrl,
      attentionId,
      { role: 'manager', store: 'Fowlerville', user: 'Attention Test Manager' },
      { type: 'assign', assignee: 'Fowlerville Used Manager' },
    )
    expect(assigned.response.status).toBe(201)
    expect(assigned.body.assignedTo).toBe('Fowlerville Used Manager')

    const followUp = await postAttentionEvent(
      baseUrl,
      attentionId,
      { role: 'manager', store: 'Fowlerville', user: 'Attention Test Manager' },
      { type: 'set_follow_up', followUpAt: '2026-08-30T19:30:00.000Z' },
    )
    expect(followUp.response.status).toBe(201)
    expect(followUp.body.followUpAt).toBe('2026-08-30T19:30:00.000Z')

    const resolved = await postAttentionEvent(
      baseUrl,
      attentionId,
      { role: 'manager', store: 'Fowlerville', user: 'Attention Test Manager' },
      { type: 'resolve', resolutionCode: 'action_completed', note: 'Operational follow-up documented.' },
    )
    expect(resolved.response.status).toBe(201)
    expect(resolved.body).toMatchObject({ status: 'resolved', resolutionCode: 'action_completed' })
    expect(resolved.body.allowedActions).toEqual(expect.arrayContaining(['reopen', 'add_note']))
    expect(resolved.body.allowedActions).not.toContain('resolve')
    expect(resolved.body.events.map((event: { type: string }) => event.type)).toEqual([
      'acknowledge',
      'assign',
      'set_follow_up',
      'resolve',
    ])

    const afterTransfer = await fetch(`${baseUrl}/api/transfers/${created.body.id}`, {
      headers: roleHeaders('manager', 'Fowlerville', 'Attention Test Manager'),
    }).then((response) => response.json())
    expect(afterTransfer.requestStatus).toBe(beforeTransfer.requestStatus)
    expect(afterTransfer.movementStatus).toBe(beforeTransfer.movementStatus)
    expect(afterTransfer.dealerMailHoldState).toBe(beforeTransfer.dealerMailHoldState)
    expect(database.prepare('SELECT COUNT(*) AS count FROM public_vehicle_snapshots').get().count).toBe(sourceCountsBefore.public)
    expect(database.prepare('SELECT COUNT(*) AS count FROM crm_vehicle_snapshots').get().count).toBe(sourceCountsBefore.crm)
    expect(database.prepare('SELECT COUNT(*) AS count FROM hold_vehicle_snapshots').get().count).toBe(sourceCountsBefore.holds)

    const advanced = await postEvent(
      baseUrl,
      created.body.id,
      { role: 'manager', store: 'Fowlerville', user: 'Attention Test Manager' },
      { type: 'manager_reviewed', note: 'Request advanced to its next operational condition.' },
    )
    expect(advanced.response.status).toBe(201)
    const refreshedQueue = await fetch(`${baseUrl}/api/attention?store=Fowlerville`, {
      headers: roleHeaders('manager', 'Fowlerville', 'Attention Test Manager'),
    }).then((response) => response.json())
    const recurring = refreshedQueue.items.find((item: { sourceId: string }) => item.sourceId === created.body.id)
    expect(recurring.id).not.toBe(attentionId)
    expect(recurring).toMatchObject({ status: 'open', events: [] })
  })
})
