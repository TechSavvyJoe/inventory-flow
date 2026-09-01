// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { createInventoryServer } from '../../server/api.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import {
  createIdentityResolver,
  IdentityConfigurationError,
} from '../../server/identity.mjs'
import { findLatestCompletedManifest, loadLatestCompletedRelease } from '../../server/importer.mjs'
import { createInventoryService } from '../../server/service.mjs'

const resources: Array<{
  server: ReturnType<typeof createInventoryServer>
  database: ReturnType<typeof openInventoryDatabase>
  cleanup: () => void
}> = []

afterEach(async () => {
  while (resources.length) {
    const resource = resources.pop()!
    await new Promise<void>((resolve) => resource.server.close(() => resolve()))
    resource.database.close()
    resource.cleanup()
  }
})

async function trustedHarness() {
  const fixture = createSyntheticWorkspace()
  const { manifest } = findLatestCompletedManifest(fixture.workspaceRoot)
  const now = new Date(`${manifest.report_date}T18:00:00-04:00`)
  const database = openInventoryDatabase()
  importRelease(database, loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now }), {
    loadedAt: now.toISOString(),
  })
  const service = createInventoryService({ database, now: () => now })
  const secret = 'test-only-trusted-proxy-secret-000000000000'
  const identityResolver = createIdentityResolver({
    mode: 'trusted_proxy',
    environment: 'production',
    trustedProxySecret: secret,
  })
  const server = createInventoryServer({ service, identityResolver })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  resources.push({ server, database, cleanup: fixture.cleanup })
  return { baseUrl: `http://127.0.0.1:${address.port}`, secret }
}

function trustedHeaders(secret: string, overrides: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    'x-inventory-proxy-secret': secret,
    'x-inventory-authenticated-user': 'Fowlerville Salesperson',
    'x-inventory-authenticated-role': 'sales',
    'x-inventory-authenticated-store': 'Fowlerville',
    ...overrides,
  }
}

describe('server-owned identity boundary', () => {
  it('fails closed when production identity is absent, demo, or incomplete', () => {
    expect(() => createIdentityResolver({ environment: 'production' })).toThrowError(
      expect.objectContaining<Partial<IdentityConfigurationError>>({ code: 'IDENTITY_MODE_REQUIRED' }),
    )
    expect(() => createIdentityResolver({ environment: 'production', mode: 'demo' })).toThrowError(
      expect.objectContaining<Partial<IdentityConfigurationError>>({ code: 'INSECURE_IDENTITY_MODE' }),
    )
    expect(() =>
      createIdentityResolver({ environment: 'production', mode: 'trusted_proxy', trustedProxySecret: 'short' }),
    ).toThrowError(expect.objectContaining<Partial<IdentityConfigurationError>>({ code: 'TRUSTED_PROXY_SECRET_REQUIRED' }))
  })

  it('ignores browser role/store claims and accepts only authenticated upstream identity', async () => {
    const { baseUrl, secret } = await trustedHarness()
    const unauthenticated = await fetch(`${baseUrl}/api/bootstrap?role=group_manager&homeStore=Lincoln`, {
      headers: {
        'x-inventory-role': 'group_manager',
        'x-inventory-store': 'Lincoln',
        'x-inventory-user': 'Spoofed Browser User',
      },
    })
    expect(unauthenticated.status).toBe(401)
    expect(await unauthenticated.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })

    const authenticated = await fetch(`${baseUrl}/api/bootstrap?role=group_manager&homeStore=Lincoln`, {
      headers: trustedHeaders(secret, {
        'x-inventory-role': 'group_manager',
        'x-inventory-store': 'Lincoln',
        'x-inventory-user': 'Spoofed Browser User',
      }),
    })
    expect(authenticated.status).toBe(200)
    const bootstrap = await authenticated.json()
    expect(bootstrap.access).toEqual({
      user: 'Fowlerville Salesperson',
      role: 'sales',
      store: 'Fowlerville',
      canViewPrivateEvidence: true,
      canCreateTransfer: true,
    })
  })

  it('uses upstream identity for persisted actors and rejects identity fields in a spoofed payload', async () => {
    const { baseUrl, secret } = await trustedHarness()
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, { headers: trustedHeaders(secret) }).then((response) =>
      response.json(),
    )
    const vehicle = bootstrap.vehicles.find((row: { publicStore: string }) => row.publicStore === 'Howell')
    expect(vehicle).toBeTruthy()

    const spoofed = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: trustedHeaders(secret),
      body: JSON.stringify({
        vin: vehicle.vin,
        requestingStore: 'Lincoln',
        requestedBy: 'Spoofed Browser User',
        neededBy: '2026-08-31T14:00:00-04:00',
        reason: 'Identity boundary test',
        customerAppointment: true,
        returnRequired: true,
        priority: 'normal',
      }),
    })
    expect(spoofed.status).toBe(403)
    expect(await spoofed.json()).toMatchObject({ code: 'STORE_MISMATCH' })

    const createdResponse = await fetch(`${baseUrl}/api/transfers`, {
      method: 'POST',
      headers: trustedHeaders(secret),
      body: JSON.stringify({
        vin: vehicle.vin,
        neededBy: '2026-08-31T14:00:00-04:00',
        reason: 'Identity boundary test',
        customerAppointment: true,
        returnRequired: true,
        priority: 'normal',
      }),
    })
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json()
    expect(created.requestedBy).toBe('Fowlerville Salesperson')
    expect(created.requestingStore).toBe('Fowlerville')

    const spoofedEvent = await fetch(`${baseUrl}/api/transfers/${created.id}/events`, {
      method: 'POST',
      headers: trustedHeaders(secret, {
        'x-inventory-authenticated-user': 'Fowlerville Manager',
        'x-inventory-authenticated-role': 'manager',
      }),
      body: JSON.stringify({
        type: 'manager_reviewed',
        actor: 'Spoofed Browser User',
        actorRole: 'group_manager',
        store: 'Lincoln',
      }),
    })
    expect(spoofedEvent.status).toBe(403)
    expect(await spoofedEvent.json()).toMatchObject({ code: 'ROLE_MISMATCH' })
  })
})
