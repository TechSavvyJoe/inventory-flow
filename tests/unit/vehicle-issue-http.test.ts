// @ts-nocheck -- exercises both plain ESM HTTP adapters with synthetic identities.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticRelease } from '../../fixtures/synthetic-release.mjs'
import { createSyntheticMembershipAdmin } from '../../fixtures/synthetic-membership-admin.mjs'
import { startInventoryServer } from '../../server/index.mjs'
import { prepareIssuePhotos } from '../../server/issue-photos.mjs'
import { createCloudWorkerHarness } from './cloudWorkerHarness'

const VIN = 'TESTDATAHWELL0001'
const jpegData = readFileSync(new URL('../../public/demo-vehicles/f150.jpg', import.meta.url)).toString('base64')
const [preparedPhoto] = prepareIssuePhotos([{ data: jpegData }])
const updateJpegData = readFileSync(new URL('../../public/demo-vehicles/bronco-sport.jpg', import.meta.url)).toString('base64')
const [preparedUpdatePhoto] = prepareIssuePhotos([{ data: updateJpegData }])
const report = {
  category: 'cleaning', priority: 'urgent',
  description: 'SYNTHETIC mud on the driver door', photos: [{ data: jpegData }],
}
const people = {
  sales: { email: 'issue-sales@example.invalid', userId: 'issue-sales', name: 'Synthetic Howell Sales', role: 'sales', store: 'Howell' },
  manager: { email: 'issue-manager@example.invalid', userId: 'issue-manager', name: 'Synthetic Howell Manager', role: 'manager', store: 'Howell' },
  outside: { email: 'issue-outside@example.invalid', userId: 'issue-outside', name: 'Synthetic Lincoln Manager', role: 'manager', store: 'Lincoln' },
  group: { email: 'issue-group@example.invalid', userId: 'issue-group', name: 'Synthetic Group Manager', role: 'group_manager', store: 'Lincoln' },
}

const openApps = []
afterEach(async () => {
  while (openApps.length) await openApps.pop().close()
})

async function nodeApp() {
  const app = startInventoryServer({ port: 0, releaseLoader: () => buildSyntheticRelease(), adminDirectory: createSyntheticMembershipAdmin() })
  openApps.push(app)
  await new Promise(resolve => app.server.listening ? resolve(undefined) : app.server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`
  async function call(method, pathname, person, body, { key = crypto.randomUUID(), origin = baseUrl } = {}) {
    const write = method === 'POST'
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        'x-inventory-demo-role': person.role,
        'x-inventory-demo-store': person.store,
        'x-inventory-demo-user': person.name,
        ...(write ? { origin, 'content-type': 'application/json', 'idempotency-key': key } : {}),
      },
      ...(write ? { body: JSON.stringify(body) } : {}),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    let json = null
    try { json = JSON.parse(bytes.toString('utf8')) } catch { json = null }
    return { status: response.status, json, bytes, headers: response.headers }
  }
  return { app, call }
}

describe('vehicle issue HTTP workflow', () => {
  it('runs the manager-confirmed workflow and private photo round trip through the Node demo', async () => {
    const { app, call } = await nodeApp()
    expect((await call('GET', '/api/bootstrap', people.sales)).json.vehicleIssuesEnabled).toBe(true)

    const key = 'synthetic-node-report'
    const created = await call('POST', `/api/vehicles/${VIN}/issues`, people.sales, report, { key })
    expect(created).toMatchObject({ status: 201, json: {
      vin: VIN, status: 'open', version: 1, reportedBy: people.sales.name,
      reportedByUserId: `demo:Howell:${people.sales.name}`, photoCount: 1,
    } })
    const issueId = created.json.id
    const replay = await call('POST', `/api/vehicles/${VIN}/issues`, people.sales, report, { key })
    expect(replay).toMatchObject({ status: 200, json: { id: issueId, version: 1 } })
    expect(app.database.prepare('SELECT COUNT(*) AS count FROM vehicle_issues').get().count).toBe(1)
    expect((await call('POST', `/api/vehicles/${VIN}/issues`, people.sales, { ...report, description: 'SYNTHETIC changed report' }, { key })).status).toBe(409)

    const photo = await call('GET', `/api/vehicle-issues/${issueId}/photos/${created.json.photos[0].id}`, people.sales)
    expect(photo.status).toBe(200)
    expect(photo.headers.get('content-type')).toBe('image/jpeg')
    expect(photo.bytes).toEqual(preparedPhoto.bytes)

    expect((await call('POST', `/api/vehicle-issues/${issueId}/events`, people.outside, { type: 'add_note', expectedVersion: 1, note: 'SYNTHETIC outside update' })).status).toBe(403)
    const assigned = await call('POST', `/api/vehicle-issues/${issueId}/events`, people.manager, { type: 'assign', expectedVersion: 1, assignee: 'Detail team' })
    expect(assigned).toMatchObject({ status: 201, json: { version: 2, assignee: 'Detail team', status: 'open' } })
    const ready = await call('POST', `/api/vehicle-issues/${issueId}/events`, people.sales, { type: 'request_completion', expectedVersion: 2, note: 'SYNTHETIC work finished' })
    expect(ready).toMatchObject({ status: 201, json: { version: 3, status: 'awaiting_review' } })
    expect((await call('POST', `/api/vehicle-issues/${issueId}/events`, people.sales, { type: 'complete', expectedVersion: 3, note: 'SYNTHETIC self approval' })).status).toBe(403)
    const completed = await call('POST', `/api/vehicle-issues/${issueId}/events`, people.manager, { type: 'complete', expectedVersion: 3, note: 'SYNTHETIC manager inspected the vehicle' })
    expect(completed).toMatchObject({ status: 201, json: { version: 4, status: 'completed', completedBy: people.manager.name } })
  })

  it('requires the local same-origin boundary before parsing or saving issue writes', async () => {
    const { app, call } = await nodeApp()
    const denied = await call('POST', `/api/vehicles/${VIN}/issues`, people.sales, report, { origin: 'https://attacker.invalid' })
    expect(denied).toMatchObject({ status: 403, json: { code: 'SAME_ORIGIN_REQUIRED' } })
    expect(app.database.prepare('SELECT COUNT(*) AS count FROM vehicle_issues').get().count).toBe(0)
  })

  it('uses Access membership actors, encrypted private storage, retries, and manager confirmation in the Worker', async () => {
    const cloud = await createCloudWorkerHarness(Object.values(people))
    openApps.push(cloud)
    expect((await cloud.call('GET', '/api/bootstrap', people.sales.email)).json.vehicleIssuesEnabled).toBe(true)

    const key = 'synthetic-cloud-report'
    const created = await cloud.call('POST', `/api/vehicles/${VIN}/issues`, people.sales.email, report, { 'idempotency-key': key })
    expect(created).toMatchObject({ status: 201, json: {
      status: 'open', reportedBy: people.sales.name, reportedByUserId: people.sales.userId, photoCount: 1,
    } })
    const issueId = created.json.id
    const photoId = created.json.photos[0].id
    expect([...cloud.storedObjects.keys()]).toContain(`vehicle-issues/${VIN}/${photoId}.enc`)
    const photo = await cloud.call('GET', `/api/vehicle-issues/${issueId}/photos/${photoId}`, people.sales.email)
    expect(photo.status).toBe(200)
    expect(photo.bodyBytes).toEqual(preparedPhoto.bytes)

    const replay = await cloud.call('POST', `/api/vehicles/${VIN}/issues`, people.sales.email, report, { 'idempotency-key': key })
    expect(replay).toMatchObject({ status: 200, json: { id: issueId, version: 1 } })
    expect(cloud.count('vehicle_issues')).toBe(1)
    expect((await cloud.call('POST', `/api/vehicles/${VIN}/issues`, people.sales.email, { ...report, description: 'SYNTHETIC changed payload' }, { 'idempotency-key': key })).status).toBe(409)
    expect((await cloud.call('POST', `/api/vehicle-issues/${issueId}/events`, people.outside.email, { type: 'add_note', expectedVersion: 1, note: 'SYNTHETIC outside update' })).status).toBe(403)

    const assigned = await cloud.call('POST', `/api/vehicle-issues/${issueId}/events`, people.manager.email, { type: 'assign', expectedVersion: 1, assignee: 'Detail team' })
    expect(assigned).toMatchObject({ status: 201, json: { version: 2, assignee: 'Detail team' } })
    const ready = await cloud.call('POST', `/api/vehicle-issues/${issueId}/events`, people.sales.email, {
      type: 'request_completion', expectedVersion: 2, note: 'SYNTHETIC ready for review', photos: [{ data: updateJpegData }],
    })
    expect(ready).toMatchObject({ status: 201, json: { version: 3, status: 'awaiting_review', photoCount: 2 } })
    const updatePhoto = await cloud.call('GET', `/api/vehicle-issues/${issueId}/photos/${preparedUpdatePhoto.metadata.id}`, people.manager.email)
    expect(updatePhoto).toMatchObject({ status: 200 })
    expect(updatePhoto.bodyBytes).toEqual(preparedUpdatePhoto.bytes)
    expect((await cloud.call('POST', `/api/vehicle-issues/${issueId}/events`, people.sales.email, { type: 'complete', expectedVersion: 3, note: 'SYNTHETIC sales completion' })).status).toBe(403)
    const completed = await cloud.call('POST', `/api/vehicle-issues/${issueId}/events`, people.manager.email, { type: 'complete', expectedVersion: 3, note: 'SYNTHETIC manager confirmed repair' })
    expect(completed).toMatchObject({ status: 201, json: { version: 4, status: 'completed', completedBy: people.manager.name } })
    const reopened = await cloud.call('POST', `/api/vehicle-issues/${issueId}/events`, people.group.email, { type: 'reopen', expectedVersion: 4, note: 'SYNTHETIC concern returned' })
    expect(reopened).toMatchObject({ status: 201, json: { version: 5, status: 'open', completedAt: null, completedBy: null } })
  })

  it('does not commit a Worker report when private photo storage fails or membership is revoked during upload', async () => {
    const cloud = await createCloudWorkerHarness(Object.values(people))
    openApps.push(cloud)
    const originalPut = cloud.env.RELEASE_SNAPSHOTS.put
    cloud.env.RELEASE_SNAPSHOTS.put = async () => { throw new Error('synthetic private storage failure') }
    const failed = await cloud.call('POST', `/api/vehicles/${VIN}/issues`, people.sales.email, report)
    expect(failed).toMatchObject({ status: 500, json: { code: 'INTERNAL_ERROR' } })
    expect(cloud.count('vehicle_issues')).toBe(0)
    expect(cloud.count('vehicle_issue_events')).toBe(0)

    cloud.env.RELEASE_SNAPSHOTS.put = async (...args) => {
      await originalPut(...args)
      cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(people.sales.email)
    }
    const revoked = await cloud.call('POST', `/api/vehicles/${VIN}/issues`, people.sales.email, { ...report, description: 'SYNTHETIC revoke during photo upload' })
    // The first commit detects the changed membership; the conflict retry
    // re-resolves Access and returns the current authorization result.
    expect(revoked).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
    expect(cloud.count('vehicle_issues')).toBe(0)
    expect(cloud.count('vehicle_issue_events')).toBe(0)
  })

  it('keeps the Worker inventory readable and reports unavailable writes before migration 0011', async () => {
    const cloud = await createCloudWorkerHarness(Object.values(people))
    openApps.push(cloud)
    cloud.database.exec('DROP TABLE vehicle_issue_events; DROP TABLE vehicle_issues;')
    const bootstrap = await cloud.call('GET', '/api/bootstrap', people.manager.email)
    expect(bootstrap).toMatchObject({ status: 200, json: { vehicleIssuesEnabled: false, vehicleIssues: [] } })
    const write = await cloud.call('POST', `/api/vehicles/${VIN}/issues`, people.sales.email, { ...report, photos: [] })
    expect(write).toMatchObject({ status: 503, json: { code: 'MIGRATION_REQUIRED' } })
  })
})
