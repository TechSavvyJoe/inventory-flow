// @ts-nocheck -- real signed employee sessions with a disposable SQLite/R2 harness.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCloudWorkerHarness } from './cloudWorkerHarness'
import { loadD1Repository } from '../../cloudflare/src/repository.mjs'
import { createInventoryServiceCore } from '../../server/service-core.mjs'
import { prepareIssuePhotos } from '../../server/issue-photos.mjs'
import { storeIssuePhotos } from '../../cloudflare/src/issue-photo-storage.mjs'

const employee = { email: 'issue-sales@example.invalid', userId: 'synthetic-issue-sales', name: 'Synthetic issue reporter', role: 'sales', store: 'Howell' }
const porter = { email: 'issue-porter@example.invalid', userId: 'synthetic-issue-porter', name: 'Synthetic issue reader', role: 'porter', store: 'Howell' }
let cloud, issue, photoPath
beforeEach(async () => {
  cloud = await createCloudWorkerHarness([employee, porter])
  const originalGet = cloud.env.RELEASE_SNAPSHOTS.get
  const objects = new Map()
  cloud.env.RELEASE_SNAPSHOTS.put = async (key, bytes) => { objects.set(key, Buffer.from(bytes)); photoPath = key }
  cloud.env.RELEASE_SNAPSHOTS.get = async key => objects.has(key)
    ? { arrayBuffer: async () => { const bytes = objects.get(key); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }
    : originalGet(key)
  const photos = prepareIssuePhotos([{ data: readFileSync(new URL('../../public/demo-vehicles/f150.jpg', import.meta.url)).toString('base64') }])
  const repo = await loadD1Repository(cloud.env.INVENTORY_DB, cloud.bundle.release)
  const service = createInventoryServiceCore({ database: repo.database, repository: repo.repository })
  const context = { role: employee.role, store: employee.store, user: employee.name, userId: employee.userId, authenticatedRole: employee.role, authenticatedStore: employee.store }
  issue = service.createVehicleIssue('TESTDATAHWELL0001', { category: 'cleaning', description: 'SYNTHETIC mud on door', photos: photos.map(photo => photo.metadata) }, context, 'synthetic-photo-seed').record
  await storeIssuePhotos(cloud.env, issue.vin, photos)
  await repo.commit({ email: employee.email, context })
})
afterEach(() => cloud.close())

describe('employee issue and photo reads', () => {
  it('serves attached operational evidence to an active employee, without granting write actions to transport roles', async () => {
    const result = await cloud.call('GET', `/api/vehicle-issues/${issue.id}`, porter.email)
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ description: 'SYNTHETIC mud on door', allowedActions: [], photoCount: 1 })
    const photo = await cloud.call('GET', `/api/vehicle-issues/${issue.id}/photos/${issue.photos[0].id}`, porter.email)
    expect(photo.status).toBe(200)
    expect((await cloud.call('GET', `/api/vehicle-issues/${issue.id}/photos/${'0'.repeat(64)}`, porter.email)).status).toBe(404)
    expect((await cloud.call('GET', `/api/${photoPath}`, porter.email)).status).toBe(404)
  })

  it('blocks a disabled employee before either the issue or its photo is returned', async () => {
    cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(porter.email)
    for (const path of [`/api/vehicle-issues/${issue.id}`, `/api/vehicle-issues/${issue.id}/photos/${issue.photos[0].id}`]) {
      expect((await cloud.call('GET', path, porter.email)).status).toBe(403)
    }
  })

  it('withholds photo bytes when membership is revoked while private storage is being read', async () => {
    const get = cloud.env.RELEASE_SNAPSHOTS.get
    cloud.env.RELEASE_SNAPSHOTS.get = async key => {
      const result = await get(key)
      if (key === photoPath) cloud.database.prepare('UPDATE cloud_memberships SET enabled=0 WHERE email=?').run(porter.email)
      return result
    }
    const result = await cloud.call('GET', `/api/vehicle-issues/${issue.id}/photos/${issue.photos[0].id}`, porter.email)
    expect(result).toMatchObject({ status: 403, json: { code: 'EMPLOYEE_NOT_AUTHORIZED' } })
  })
})
