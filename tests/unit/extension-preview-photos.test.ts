// @vitest-environment node
// @ts-nocheck -- repository-safe synthetic preview; no extension or live APIs.
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createExtensionPreviewServer } from '../../scripts/preview-extension.mjs'
import { SYNTHETIC_VEHICLE_PHOTOS, syntheticPreviewPhotos, syntheticVehiclePhotoPath } from '../../extension/sidepanel/lib/synthetic-photos.mjs'
import { withSyntheticVehicleIllustration } from '../../fixtures/synthetic-photos.mjs'
import { photoUrl } from '../../extension/sidepanel/lib/links.mjs'

const options = { host: 'preview', workspace: { demo: true, origin: 'http://127.0.0.1:4177' } }
const vehicle = { vin: 'TESTDATAHWELL0001', photos: [] }

describe('shared synthetic preview photo allowlist', () => {
  it('uses the same exact eight image mappings as the app fixture', () => {
    expect(Object.keys(SYNTHETIC_VEHICLE_PHOTOS)).toHaveLength(8)
    for (const [vin, path] of Object.entries(SYNTHETIC_VEHICLE_PHOTOS)) {
      expect(syntheticVehiclePhotoPath(vin)).toBe(path)
      expect(withSyntheticVehicleIllustration({ vin })).toMatchObject({ imageUrl: path, imageUrls: [path], photoCount: 1 })
      expect(syntheticPreviewPhotos({ vin }, options)).toEqual([`http://127.0.0.1:4177${path}`])
      const bytes = readFileSync(resolve(__dirname, '../../public', path.slice(1)))
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1536, 1024])
    }
  })

  it('cannot substitute a photo for a non-fixture VIN or derive paths from API data', () => {
    for (const vin of ['NOT-A-FIXTURE', 'TESTDATAHWELL0001/../secret', '__proto__', 'constructor', undefined]) {
      expect(syntheticVehiclePhotoPath(vin)).toBeNull()
      expect(syntheticPreviewPhotos({ vin, imageUrl: '/runtime/secret.png' }, options)).toEqual([])
    }
    expect(syntheticPreviewPhotos({ ...vehicle, imageUrl: 'https://evil.example/image.png' }, options)).toEqual(['http://127.0.0.1:4177/demo-vehicles/f150.png'])
  })

  it('is excluded from the actual extension and production workspace', () => {
    for (const host of ['extension', 'node', undefined]) expect(syntheticPreviewPhotos(vehicle, { ...options, host })).toEqual([])
    for (const demo of [false, undefined, 'true']) expect(syntheticPreviewPhotos(vehicle, { ...options, workspace: { ...options.workspace, demo } })).toEqual([])
    expect(syntheticPreviewPhotos(vehicle)).toEqual([])
    expect(photoUrl('/demo-vehicles/f150.png')).toBeNull()
    expect(photoUrl('http://127.0.0.1:4177/demo-vehicles/f150.png')).toBeNull()
  })

  it('resolves only a clean HTTP(S) preview origin, including a protected remote preview', () => {
    expect(syntheticPreviewPhotos(vehicle, { ...options, workspace: { demo: true, origin: 'https://synthetic-preview.example.test' } })).toEqual(['https://synthetic-preview.example.test/demo-vehicles/f150.png'])
    for (const origin of ['file:///private/', 'javascript:alert(1)', 'chrome-extension://example', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?redirect=1', 'not a URL', undefined]) {
      expect(syntheticPreviewPhotos(vehicle, { ...options, workspace: { demo: true, origin } })).toEqual([])
    }
  })
})

describe('synthetic extension preview image server', () => {
  let server
  let port
  beforeAll(async () => {
    server = createExtensionPreviewServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port
  })
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)) })
  const get = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })

  it('serves the existing full-resolution PNG with correct MIME without a live API', async () => {
    const response = await get('/demo-vehicles/f150.png')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['cache-control']).toBe('no-store')
    expect([response.body.readUInt32BE(16), response.body.readUInt32BE(20)]).toEqual([1536, 1024])
    expect(response.body.equals(readFileSync(resolve(__dirname, '../../public/demo-vehicles/f150.png')))).toBe(true)
    const head = await get('/demo-vehicles/f150.png', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
  })

  it('does not expose unlisted public assets, directory contents, or arbitrary files', async () => {
    for (const path of ['/demo-vehicles/', '/demo-vehicles/README.md', '/demo-vehicles/not-allowed.png', '/demo-vehicles/f150.png/extra', '/public/demo-vehicles/f150.png', '/demo-vehicles-f150.png']) expect((await get(path)).status).toBe(404)
    expect((await get('/demo-vehicles/f150.png', 'POST')).status).toBe(405)
  })

  it('rejects literal/encoded traversal and malformed escaping before URL normalization', async () => {
    for (const path of ['/demo-vehicles/../README.md', '/demo-vehicles/%2e%2e/README.md', '/demo-vehicles/..%5cREADME.md', '/%2e%2e/CLAUDE.md']) expect((await get(path)).status).toBe(403)
    expect((await get('/demo-vehicles/%E0%A4%A')).status).toBe(400)
  })

  it('retains the extension page and module routes', async () => {
    const page = await get('/sidepanel/index.html')
    expect(page.status).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    const module = await get('/sidepanel/lib/synthetic-photos.mjs')
    expect(module.status).toBe(200)
    expect(module.headers['content-type']).toContain('text/javascript')
    expect(module.body.toString()).toContain('syntheticPreviewPhotos')
  })

  it('redirects the bare root and /index.html to the side panel instead of 404ing', async () => {
    for (const path of ['/', '/index.html']) {
      const response = await get(path)
      expect(response.status).toBe(302)
      expect(response.headers.location).toBe('/sidepanel/index.html')
    }
  })
})
