// @ts-nocheck -- exercises plain Node ESM server modules and synthetic data.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSyntheticRelease, SYNTHETIC_NOW } from '../../fixtures/synthetic-release.mjs'
import { SYNTHETIC_ADMIN_MEMBERS } from '../../fixtures/synthetic-admin-directory.mjs'
import { buildAdminOverview } from '../../server/admin-control-center.mjs'
import { createInventoryServer } from '../../server/api.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const openResources = []

afterEach(async () => {
  while (openResources.length) {
    const { server, database } = openResources.pop()
    await new Promise((resolve) => server.close(resolve))
    database.close()
  }
})

function identityHeaders(role = 'group_manager', store = 'Lincoln', user = 'Demo Group Manager') {
  return {
    'content-type': 'application/json',
    'x-inventory-role': role,
    'x-inventory-store': store,
    'x-inventory-user': user,
  }
}

async function harness(adminDirectory) {
  const database = openInventoryDatabase()
  importRelease(database, buildSyntheticRelease({ includeDemoChanges: true }), { loadedAt: SYNTHETIC_NOW.toISOString() })
  const service = createInventoryService({ database, now: () => SYNTHETIC_NOW })
  const server = createInventoryServer({ service, adminDirectory })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  openResources.push({ server, database })
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}`, database, service }
}

describe('Admin Control Center projection', () => {
  it('keeps disposition writer identity out of the audit projection', () => {
    const writer = 'SYNTHETIC_PRIVATE_DISPOSITION_WRITER'
    const overview = buildAdminOverview({
      generatedAt: '2026-09-15T14:00:00.000Z',
      dispositionEvents: [{ id: 'synthetic-disposition', vin: 'TESTDATAHWELL0001', store_id: 'Howell', disposition: 'sold_pending', actor: writer, updated_at: '2026-09-15T13:00:00.000Z' }],
    })
    expect(overview.audit).toEqual([expect.objectContaining({ id: 'disposition:synthetic-disposition', actor: null, scope: 'VIN TESTDATAHWELL0001 · Howell', result: 'recorded' })])
    expect(JSON.stringify(overview.audit)).not.toContain(writer)
  })

  it('returns the exact read-only contract without directory secrets or private event payloads', () => {
    const marker = 'SYNTHETIC_PRIVATE_VALUE_MUST_NOT_LEAK'
    const overview = buildAdminOverview({
      generatedAt: '2026-09-15T14:00:00.000Z',
      members: [{
        user_id: 'group-manager-1', name: 'Group Manager', role: 'group_manager',
        home_store: 'Lincoln', enabled: 1, email: marker, access_token: marker,
      }],
      meta: { publicFreshness: 'current', dealerMailFreshness: 'current' },
      sourceRuns: {
        public: { extracted_at: '2026-09-15T12:00:00.000Z', loaded_at: '2026-09-15T12:05:00.000Z' },
        dealerMail: { extracted_at: '2026-09-15T12:30:00.000Z', loaded_at: '2026-09-15T12:35:00.000Z' },
      },
      publicRows: [{ physical_store_id: 'Howell', payload_json: marker }],
      crmRows: [{ crm_store_id: 'Howell', payload_json: marker }],
      transferRows: [{ id: 'transfer-1', vin: 'TESTDATAHWELL0001' }],
      getTransferEvents: () => [
        {
          id: 'recorded-newer', event_type: 'note_added', actor: null, store_id: 'Howell',
          occurred_at: '1999-01-01T00:00:00.000Z', created_at: '2026-09-15T13:30:00.000Z', note: marker,
        },
        {
          id: 'business-future', event_type: 'eta_updated', actor: 'Group Manager', store_id: 'Howell',
          occurred_at: '2099-01-01T00:00:00.000Z', created_at: '2026-09-15T13:00:00.000Z', note: marker,
        },
        {
          id: null, event_type: 'escalated', actor: 'Group Manager', store_id: 'Howell',
          occurred_at: '2099-01-01T00:00:00.000Z', created_at: '2026-09-15T13:45:00.000Z', note: marker,
        },
      ],
    })

    expect(Object.keys(overview).sort()).toEqual(['audit', 'feeds', 'generatedAt', 'people', 'readOnly', 'summary'])
    expect(overview).toMatchObject({
      generatedAt: '2026-09-15T14:00:00.000Z',
      readOnly: true,
      summary: { activeUsers: 1, connectedStores: 1, feedsCurrent: 1, lastVerifiedAt: '2026-09-15T12:35:00.000Z' },
    })
    expect(overview.people).toEqual([{
      id: 'group-manager-1', name: 'Group Manager', role: 'group_manager',
      storeAccess: ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'], status: 'active', lastActiveAt: null,
    }])
    expect(overview.feeds).toHaveLength(4)
    expect(overview.feeds.find((feed) => feed.store === 'Howell')).toMatchObject({
      status: 'current', lastSuccessfulAt: '2026-09-15T12:35:00.000Z', vehicleCount: 1, issueSummary: null,
    })
    expect(overview.feeds.find((feed) => feed.store === 'Fowlerville')).toMatchObject({
      status: 'unknown', lastSuccessfulAt: null, vehicleCount: 0,
    })
    expect(overview.audit.map((entry) => entry.id)).toEqual(['transfer:recorded-newer', 'transfer:business-future'])
    expect(overview.audit[0]).toMatchObject({
      occurredAt: '2026-09-15T13:30:00.000Z', actor: null,
      activity: 'Move note added', scope: 'VIN TESTDATAHWELL0001 · Howell', result: 'recorded',
    })
    expect(JSON.stringify(overview)).not.toContain(marker)
  })

  it.each([
    { user_id: 'member-1', name: 'Invalid Member', role: 'owner', home_store: 'Howell', enabled: 1 },
    { user_id: ' member-1', name: 'Invalid Member', role: 'manager', home_store: 'Howell', enabled: 1 },
    { user_id: 'member-1', name: 'Invalid Member ', role: 'manager', home_store: 'Howell', enabled: 1 },
    { user_id: 'member-1', name: 'Invalid Member', role: 'manager ', home_store: 'Howell', enabled: 1 },
    { user_id: 'member-1', name: 'Invalid Member', role: 'manager', home_store: ' Howell', enabled: 1 },
    { user_id: 'member-1', name: 'Invalid Member', role: 'manager', home_store: 'Howell', enabled: '1' },
  ])('fails closed when a server-owned membership row is invalid: %j', (member) => {
    expect(() => buildAdminOverview({
      generatedAt: '2026-09-15T14:00:00.000Z',
      members: [member],
    })).toThrowError(expect.objectContaining({ code: 'ADMIN_DIRECTORY_INVALID', status: 503 }))
  })

  it('does not report a per-store feed current when either source has no store rows', () => {
    const overview = buildAdminOverview({
      generatedAt: '2026-09-15T14:00:00.000Z', members: [],
      meta: { publicFreshness: 'current', dealerMailFreshness: 'current' },
      sourceRuns: {
        public: { loaded_at: '2026-09-15T12:05:00.000Z' },
        dealerMail: { loaded_at: '2026-09-15T12:35:00.000Z' },
      },
      publicRows: [{ physical_store_id: 'Howell' }, { physical_store_id: 'Fowlerville' }],
      crmRows: [{ crm_store_id: 'Howell' }, { crm_store_id: 'Ford Detroit' }],
    })
    expect(overview.summary).toMatchObject({ connectedStores: 1, feedsCurrent: 1 })
    expect(overview.feeds.find((feed) => feed.store === 'Fowlerville')).toMatchObject({
      status: 'incomplete', lastSuccessfulAt: null, vehicleCount: 1,
      issueSummary: 'DealerMail records were not present for this store in the current release.',
    })
    expect(overview.feeds.find((feed) => feed.store === 'Ford Detroit')).toMatchObject({
      status: 'incomplete', lastSuccessfulAt: null, vehicleCount: 0,
      issueSummary: 'Public inventory records were not present for this store in the current release.',
    })
  })

  it('translates known audit codes and scopes into concise manager language', () => {
    const vin = 'TESTDATAHWELL0001'
    const overview = buildAdminOverview({
      generatedAt: '2026-09-15T14:00:00.000Z', members: [],
      transferRows: [{ id: 'transfer-1', vin }],
      getTransferEvents: () => [
        { id: 'move-requested', event_type: 'requested', actor: 'Salesperson', store_id: 'Howell', created_at: '2026-09-15T12:00:00.000Z' },
        { id: 'driver-requested', event_type: 'driver_requested', actor: 'Manager', store_id: 'Howell', created_at: '2026-09-15T12:05:00.000Z' },
      ],
      attentionRows: [{ attention_key: 'internal-hold-key', source_type: 'hold_alert', source_id: vin }],
      getAttentionEvents: () => [
        { id: 'work-started', event_type: 'start_work', actor: 'Manager', store_id: 'Howell', created_at: '2026-09-15T12:10:00.000Z' },
      ],
      serviceEvents: [
        { id: 'service-waiting', vin, status: 'needs_service', actor: 'Manager', store_id: 'Howell', updated_at: '2026-09-15T12:15:00.000Z' },
        { id: 'service-started', vin, status: 'in_service', actor: 'Manager', store_id: 'Howell', updated_at: '2026-09-15T12:20:00.000Z' },
        { id: 'service-ready', vin, status: 'serviced', actor: 'Manager', store_id: 'Howell', updated_at: '2026-09-15T12:25:00.000Z' },
      ],
    })
    const byId = Object.fromEntries(overview.audit.map((entry) => [entry.id, entry]))
    expect(byId['transfer:move-requested']).toMatchObject({ activity: 'Vehicle move requested', scope: `VIN ${vin} · Howell` })
    expect(byId['transfer:driver-requested']).toMatchObject({ activity: 'Driver requested', scope: `VIN ${vin} · Howell` })
    expect(byId['attention:work-started']).toMatchObject({ activity: 'Work started', scope: `VIN ${vin} · Howell` })
    expect(byId['service:service-waiting']).toMatchObject({ activity: 'Waiting for service', scope: `VIN ${vin} · Howell` })
    expect(byId['service:service-started']).toMatchObject({ activity: 'Service started', scope: `VIN ${vin} · Howell` })
    expect(byId['service:service-ready']).toMatchObject({ activity: 'Vehicle marked ready', scope: `VIN ${vin} · Howell` })
    expect(overview.audit.map((entry) => entry.scope).join(' ')).not.toMatch(/\b(?:vehicle|store|attention):/i)
  })

  it('orders and caps audit entries by server record time, never caller business time', () => {
    const ordinary = Array.from({ length: 49 }, (_, index) => ({
      id: `ordinary-${String(index).padStart(2, '0')}`,
      event_type: 'note_added', actor: 'Synthetic Manager', store_id: 'Howell',
      occurred_at: `2026-09-15T12:${String(index).padStart(2, '0')}:00.000Z`,
      created_at: `2026-09-15T12:${String(index).padStart(2, '0')}:00.000Z`,
    }))
    const overview = buildAdminOverview({
      generatedAt: '2026-09-15T14:00:00.000Z', members: [],
      meta: { publicFreshness: 'current', dealerMailFreshness: 'current' },
      transferRows: [{ id: 'transfer-1', vin: 'TESTDATAHWELL0001' }],
      getTransferEvents: () => [
        {
          id: 'future-business-time', event_type: 'eta_updated', actor: 'Synthetic Manager', store_id: 'Howell',
          occurred_at: '2099-01-01T00:00:00.000Z', created_at: '2026-09-15T11:00:00.000Z',
        },
        ...ordinary,
        {
          id: 'backdated-business-time', event_type: 'escalated', actor: 'Synthetic Manager', store_id: 'Howell',
          occurred_at: '1999-01-01T00:00:00.000Z', created_at: '2026-09-15T13:00:00.000Z',
        },
      ],
    })

    expect(overview.audit).toHaveLength(50)
    expect(overview.audit[0].id).toBe('transfer:backdated-business-time')
    expect(overview.audit.map((entry) => entry.id)).not.toContain('transfer:future-business-time')
  })
})

describe('Node Admin Control Center route', () => {
  it('uses a server-owned synthetic directory and ignores query-string scope', async () => {
    const listMembers = vi.fn(() => SYNTHETIC_ADMIN_MEMBERS.map((member) => ({ ...member, email: 'not-returned@example.invalid' })))
    const { baseUrl } = await harness({ listMembers })
    const response = await fetch(`${baseUrl}/api/admin/overview?role=sales&store=Howell&token=not-returned`, {
      headers: identityHeaders(),
    })
    expect(response.status).toBe(200)
    const overview = await response.json()
    expect(listMembers).toHaveBeenCalledOnce()
    expect(overview.generatedAt).toBe(SYNTHETIC_NOW.toISOString())
    expect(overview.readOnly).toBe(true)
    expect(Object.keys(overview.summary).sort()).toEqual(['activeUsers', 'connectedStores', 'feedsCurrent', 'lastVerifiedAt'])
    expect(overview.people).toHaveLength(SYNTHETIC_ADMIN_MEMBERS.length)
    expect(overview.people.find((person) => person.id === 'synthetic-group-manager').storeAccess).toEqual([
      'Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln',
    ])
    expect(overview.people.find((person) => person.id === 'synthetic-driver-disabled')).toMatchObject({
      status: 'disabled', lastActiveAt: null,
    })
    expect(overview.feeds).toHaveLength(4)
    expect(overview.summary.connectedStores).toBe(4)
    expect(JSON.stringify(overview)).not.toMatch(/not-returned|email|token/i)
  })

  it('authorizes before directory access and exposes no mutation or query-role route', async () => {
    const listMembers = vi.fn(() => SYNTHETIC_ADMIN_MEMBERS)
    const { baseUrl } = await harness({ listMembers })

    const manager = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: identityHeaders('manager', 'Howell', 'Demo Howell Manager'),
    })
    expect(manager.status).toBe(403)
    expect(await manager.json()).toMatchObject({ code: 'ADMIN_OVERVIEW_ACCESS_REQUIRED' })

    const queryOnly = await fetch(`${baseUrl}/api/admin/overview?role=group_manager&homeStore=Lincoln`, {
      headers: { 'x-inventory-user': 'Query role probe' },
    })
    expect(queryOnly.status).toBe(401)

    const post = await fetch(`${baseUrl}/api/admin/overview`, {
      method: 'POST', headers: identityHeaders(), body: JSON.stringify({ role: 'group_manager', members: SYNTHETIC_ADMIN_MEMBERS }),
    })
    expect(post.status).toBe(405)
    expect(await post.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    expect(listMembers).not.toHaveBeenCalled()
  })

  it('reports directory failures as a sanitized unavailable response', async () => {
    const { baseUrl } = await harness({ listMembers() { throw new Error('SYNTHETIC_PRIVATE_DATABASE_DETAIL') } })
    const response = await fetch(`${baseUrl}/api/admin/overview`, { headers: identityHeaders() })
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).toContain('ADMIN_DIRECTORY_UNAVAILABLE')
    expect(text).not.toContain('SYNTHETIC_PRIVATE_DATABASE_DETAIL')
  })
})
