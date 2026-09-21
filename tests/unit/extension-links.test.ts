// @vitest-environment node
// @ts-nocheck -- dependency-free ESM link builders.
import { describe, expect, it } from 'vitest'
import { DEALERMAIL_INVENTORY_URL, autoCheckUrl, factoryEquipmentUrl, inventorySearchUrl, listingUrl, photoUrl, requestVehicleUrl, serviceStatusUrl, trackMovementUrl, windowStickerUrl, workspaceUrl } from '../../extension/sidepanel/lib/links.mjs'
import { bootstrapRequest, fetchBootstrap, fetchVehicle, PanelApiError, vehicleRequest } from '../../extension/sidepanel/lib/api.mjs'
import { WORKSPACES } from '../../extension/sidepanel/lib/config.mjs'
import { officialVehicleDocumentUrl } from '../../src/features/inventory/vehicle-document-utils'

const origin = 'https://inventory-ops.joegallant.me'

describe('deal desk links', () => {
  it('opens only the defined operational and update workspaces', () => {
    expect(workspaceUrl(origin, 'price')).toBe(`${origin}/updates?view=price`)
    expect(workspaceUrl(origin, 'new')).toBe(`${origin}/updates?view=new`)
    expect(workspaceUrl(origin, 'moves')).toBe(`${origin}/transfers`)
    expect(workspaceUrl(origin, 'attention')).toBe(`${origin}/attention`)
    expect(workspaceUrl(origin, 'service')).toBe(`${origin}/service`)
    expect(workspaceUrl(origin, 'https://example.com')).toBeNull()
    expect(workspaceUrl(origin, '__proto__')).toBeNull()
    expect(serviceStatusUrl(origin, 'TESTDATAHWELL0001')).toBe(`${origin}/service?vin=TESTDATAHWELL0001`)
  })

  it('deep-links into the app\'s own request, tracking and search screens', () => {
    expect(requestVehicleUrl(origin, 'TESTDATAHWELL0001')).toBe(`${origin}/transfers/new?vin=TESTDATAHWELL0001`)
    expect(requestVehicleUrl(origin, 'TESTDATAHWELL0001', 'direct')).toBe(`${origin}/transfers/new?vin=TESTDATAHWELL0001&intent=direct`)
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
    expect(windowStickerUrl('https://www.bobmaxeylincoln.com/api/vhcliaa/inventory/21521/window-sticker?sv=SYNTHETIC&make=Lincoln&vehicleType=Used')).toContain('window-sticker')
    expect(windowStickerUrl('https://www.bobmaxeylincoln.com/api/vhcliaa/inventory/abc/window-sticker')).toBeNull()
    expect(factoryEquipmentUrl('https://assets.cai-media-management.com/window-stickers/12345678-1234-1234-8abc-123456789abc.jpg')).toContain('cai-media-management')
    expect(factoryEquipmentUrl('https://assets.cai-media-management.com/window-stickers/../secret.jpg')).toBeNull()
    expect(DEALERMAIL_INVENTORY_URL).toMatch(/^https:\/\/www\.dealermail\.com\//)
  })

  it('keeps source photos on HTTPS names while rejecting local and literal-IP targets', () => {
    expect(photoUrl('https://images.example.test/vehicle.jpg')).toBe('https://images.example.test/vehicle.jpg')
    for (const unsafe of ['http://images.example.test/vehicle.jpg', 'https://localhost/vehicle.jpg', 'https://preview.localhost/vehicle.jpg', 'https://127.0.0.1/vehicle.jpg', 'https://192.168.1.10/vehicle.jpg', 'https://[::1]/vehicle.jpg']) {
      expect(photoUrl(unsafe)).toBeNull()
    }
  })

  const reportHost = 'https://www.bobmaxeyfordhowell.com'
  const syntheticListing = `${reportHost}/used-Synthetic-TESTDATAHWELL0001`
  const autoCheck = `${reportHost}/AutoCheck.aspx?sv=SYNTHETIC&ac=SYNTHETIC`
  const sticker = `${reportHost}/api/vhcliaa/inventory/21521/window-sticker?sv=SYNTHETIC&make=Ford&vehicleType=Used`

  it.each([
    ['autocheck', autoCheckUrl, autoCheck],
    ['autocheck', autoCheckUrl, `${reportHost}/autocheck.aspx?ac=SYNTHETIC%20REPORT&sv=SYNTHETIC`],
    ['window-sticker', windowStickerUrl, sticker],
    ['window-sticker', windowStickerUrl, `${sticker}&dealerCode=SYNTHETIC`],
  ])('preserves approved %s source shapes with or without a listing record', (kind, validate, source) => {
    expect(validate(source, syntheticListing)).toBe(source)
    expect(validate(source)).toBe(source)
    expect(validate(source, syntheticListing)).toBe(officialVehicleDocumentUrl(source, kind, syntheticListing))
  })

  it.each([
    ['autocheck', autoCheckUrl, autoCheck],
    ['window-sticker', windowStickerUrl, sticker],
  ])('binds %s to the vehicle listing host and rejects unsafe source URLs', (kind, validate, source) => {
    for (const listing of ['https://www.bobmaxeylincoln.com/used-Synthetic', 'http://www.bobmaxeyfordhowell.com/used-Synthetic', 'not a URL']) {
      expect(validate(source, listing)).toBeNull()
      expect(validate(source, listing)).toBe(officialVehicleDocumentUrl(source, kind, listing))
    }
    for (const unsafe of [
      `${source}#report`, `${source}&redirect=https://example.com`, `${source}&sv=OTHER`,
      source.replace('https:', 'http:'), source.replace(reportHost, `${reportHost}:8443`),
      source.replace('https://', 'https://user:password@'), source.replace('www.bobmaxeyfordhowell.com', 'www.bobmaxeyfordhowell.com.evil.example'),
    ]) {
      expect(validate(unsafe, syntheticListing)).toBeNull()
      expect(validate(unsafe, syntheticListing)).toBe(officialVehicleDocumentUrl(unsafe, kind, syntheticListing))
    }
  })

  it.each([
    '', '?sv=SYNTHETIC', '?sv=&ac=SYNTHETIC', '?sv=%20&ac=SYNTHETIC', '?sv=SYNTHETIC&ac=',
    '?sv=SYNTHETIC&ac=SYNTHETIC&ac=OTHER', '?sv=SYNTHETIC&ac=SYNTHETIC&extra=1', '?vin=SYNTHETIC&ac=SYNTHETIC',
  ])('rejects incomplete or ambiguous AutoCheck query %s', (query) => {
    const source = `${reportHost}/AutoCheck.aspx${query}`
    expect(autoCheckUrl(source)).toBeNull()
    expect(autoCheckUrl(source)).toBe(officialVehicleDocumentUrl(source, 'autocheck'))
  })

  it.each([
    '', '?vin=SYNTHETIC', '?sv=SYNTHETIC&make=Ford', '?sv=SYNTHETIC&make=Ford&vehicleType=',
    '?sv=SYNTHETIC&make=%20&vehicleType=Used', '?sv=SYNTHETIC&make=Ford&vehicleType=Used&make=Lincoln',
    '?sv=SYNTHETIC&make=Ford&vehicleType=Used&dealerCode=1&dealerCode=2',
    '?sv=SYNTHETIC&make=Ford&vehicleType=Used&download=1',
  ])('rejects incomplete or ambiguous sticker query %s', (query) => {
    const source = `${reportHost}/api/vhcliaa/inventory/21521/window-sticker${query}`
    expect(windowStickerUrl(source)).toBeNull()
    expect(windowStickerUrl(source)).toBe(officialVehicleDocumentUrl(source, 'window-sticker'))
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

  it('fetches the per-vehicle record the same way and reports a missing VIN distinctly', async () => {
    expect(vehicleRequest(WORKSPACES.production, settings, 'testdatahwell0001').url).toBe(`${origin}/api/vehicles/TESTDATAHWELL0001`)
    const record = { vin: 'TESTDATAHWELL0001', stockNumber: 'DEMO-H01', privateEvidence: { comments: [] } }
    const ok = await fetchVehicle(WORKSPACES.production, settings, 'TESTDATAHWELL0001', { fetchImpl: async () => new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } }) })
    expect(ok.privateEvidence).toEqual({ comments: [] })
    const missing = await fetchVehicle(WORKSPACES.production, settings, 'TESTDATAHWELL0009', { fetchImpl: async () => new Response(JSON.stringify({ error: 'x', code: 'VEHICLE_NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } }) }).catch((error) => error)
    expect(missing).toMatchObject({ kind: 'notfound', status: 404 })
    const wrongVin = await fetchVehicle(WORKSPACES.production, settings, 'TESTDATAHWELL0001', { fetchImpl: async () => new Response(JSON.stringify({ ...record, vin: 'OTHER' }), { headers: { 'content-type': 'application/json' } }) }).catch((error) => error)
    expect(wrongVin.kind).toBe('invalid')
  })

  it('accepts a real bootstrap document', async () => {
    const body = { meta: { reportDate: '2026-08-30' }, vehicles: [], transfers: [], stores: [] }
    const payload = await fetchBootstrap(WORKSPACES.production, settings, { fetchImpl: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8' } }) })
    expect(payload.meta.reportDate).toBe('2026-08-30')
  })
})
