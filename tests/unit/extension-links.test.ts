// @vitest-environment node
// @ts-nocheck -- dependency-free ESM link builders.
import { describe, expect, it } from 'vitest'
import { DEALERMAIL_INVENTORY_URL, autoCheckUrl, factoryEquipmentUrl, inventorySearchUrl, listingUrl, requestVehicleUrl, trackMovementUrl, windowStickerUrl } from '../../extension/sidepanel/lib/links.mjs'
import { bootstrapRequest, fetchBootstrap, PanelApiError } from '../../extension/sidepanel/lib/api.mjs'
import { WORKSPACES } from '../../extension/sidepanel/lib/config.mjs'

const origin = 'https://inventory-ops.joegallant.me'

describe('deal desk links', () => {
  it('deep-links into the app\'s own request, tracking and search screens', () => {
    expect(requestVehicleUrl(origin, 'TESTDATAHWELL0001')).toBe(`${origin}/transfers/new?vin=TESTDATAHWELL0001`)
    expect(trackMovementUrl(origin, { transferId: 'abc 1', vin: 'X' })).toBe(`${origin}/transfers?id=abc+1`)
    expect(trackMovementUrl(origin, { vin: 'TESTDATAHWELL0001' })).toBe(`${origin}/transfers?vin=TESTDATAHWELL0001`)
    expect(inventorySearchUrl(origin, 'DEMO-H01')).toBe(`${origin}/inventory?q=DEMO-H01`)
  })

  it('opens only official dealer hosts for listings and documents', () => {
    expect(listingUrl('https://www.bobmaxeyfordhowell.com/used-Synthetic-TESTDATAHWELL0001')).toContain('bobmaxeyfordhowell.com')
    expect(listingUrl('https://www.bobmaxeyfordhowell.com:8443/x')).toBeNull()
    expect(listingUrl('https://user:pw@www.bobmaxeyfordhowell.com/x')).toBeNull()
    expect(listingUrl('http://www.bobmaxeyfordhowell.com/x')).toBeNull()
    expect(listingUrl('https://bobmaxeyfordhowell.com.evil.example/x')).toBeNull()
    expect(autoCheckUrl('https://www.bobmaxeyford.com/AutoCheck.aspx?sv=1&ac=2')).toBe('https://www.bobmaxeyford.com/AutoCheck.aspx?sv=1&ac=2')
    expect(autoCheckUrl('https://www.bobmaxeyford.com/other.aspx')).toBeNull()
    expect(windowStickerUrl('https://www.bobmaxeylincoln.com/api/vhcliaa/inventory/21521/window-sticker?vin=x')).toContain('window-sticker')
    expect(windowStickerUrl('https://www.bobmaxeylincoln.com/api/vhcliaa/inventory/abc/window-sticker')).toBeNull()
    expect(factoryEquipmentUrl('https://assets.cai-media-management.com/window-stickers/12345678-1234-1234-8abc-123456789abc.jpg')).toContain('cai-media-management')
    expect(factoryEquipmentUrl('https://assets.cai-media-management.com/window-stickers/../secret.jpg')).toBeNull()
    expect(DEALERMAIL_INVENTORY_URL).toMatch(/^https:\/\/www\.dealermail\.com\//)
  })
})

describe('deal desk bootstrap fetch', () => {
  const settings = { workspace: 'production', demoRole: 'sales', demoStore: 'Howell' }

  it('sends the browser session, never follows redirects, and never posts', () => {
    const { url, init } = bootstrapRequest(WORKSPACES.production, settings)
    expect(url).toBe(`${origin}/api/bootstrap`)
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'manual' })
    expect(init.headers).not.toHaveProperty('x-inventory-demo-role')
  })

  it('identifies itself to the synthetic demo only', () => {
    const { url, init } = bootstrapRequest(WORKSPACES.demo, settings)
    expect(new URL(url).searchParams.get('homeStore')).toBe('Howell')
    expect(init.headers['x-inventory-demo-role']).toBe('sales')
  })

  it('classifies an Access redirect, a missing membership, and an outage as distinct states', async () => {
    const attempt = (response) => fetchBootstrap(WORKSPACES.production, settings, { fetchImpl: async () => response }).catch((error) => error)
    const opaque = Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' })
    expect(await attempt(opaque)).toMatchObject({ kind: 'signin' })
    expect(await attempt(new Response(null, { status: 302, headers: { location: 'https://techsavvyjoe.cloudflareaccess.com/login' } }))).toMatchObject({ kind: 'signin' })
    expect(await attempt(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }))).toMatchObject({ kind: 'signin' })
    expect(await attempt(new Response(JSON.stringify({ error: 'x', code: 'MEMBERSHIP_REQUIRED' }), { status: 403, headers: { 'content-type': 'application/json' } }))).toMatchObject({ kind: 'forbidden', code: 'MEMBERSHIP_REQUIRED' })
    expect(await attempt(new Response('boom', { status: 503 }))).toMatchObject({ kind: 'server', status: 503 })
    const offline = await fetchBootstrap(WORKSPACES.production, settings, { fetchImpl: async () => { throw new TypeError('Failed to fetch') } }).catch((error) => error)
    expect(offline).toBeInstanceOf(PanelApiError)
    expect(offline.kind).toBe('offline')
  })

  it('accepts a real bootstrap document', async () => {
    const body = { meta: { reportDate: '2026-08-30' }, vehicles: [], transfers: [], stores: [] }
    const payload = await fetchBootstrap(WORKSPACES.production, settings, { fetchImpl: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8' } }) })
    expect(payload.meta.reportDate).toBe('2026-08-30')
  })
})
