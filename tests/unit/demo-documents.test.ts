import { describe, expect, it } from 'vitest'
import { getDemoWindowSticker } from '../../src/lib/demo-documents'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

describe('isolated demo document resources', () => {
  it('requires an exact synthetic VIN and matching synthetic illustration', () => {
    expect(getDemoWindowSticker({vin:'TESTDATAHWELL0001'})).toBeNull()
    expect(getDemoWindowSticker({vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/escape.jpg'})).toBeNull()
    expect(getDemoWindowSticker({vin:'1FTFW1E50PFA12345',imageUrl:'/demo-vehicles/f150.jpg'})).toBeNull()
    expect(getDemoWindowSticker({vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/f150.jpg'})).toMatchObject({label:'Demo window sticker',url:'/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001'})
  })
  it('does not show an F-150 document thumbnail for another model', () => {
    expect(getDemoWindowSticker({vin:'TESTDATALNCN00001',imageUrl:'/demo-vehicles/nautilus.jpg'})?.previewUrl).toBe('/demo-documents/window-sticker-TESTDATALNCN00001.png')
  })
  it('ships distinct exact-vehicle sticker PNGs and reconciled synthetic pricing for all eight vehicles', () => {
    const samples = JSON.parse(readFileSync('public/demo-documents/samples.json','utf8'))
    expect(Object.keys(samples)).toHaveLength(8)
    expect(Object.keys(samples).every(vin=>vin.startsWith('TESTDATA'))).toBe(true)
    const photos = ['f150', 'bronco-sport', 'escape', 'maverick', 'explorer', 'silverado', 'nautilus', 'corsair']
    const hashes = new Set<string>()
    for (const [index, vin] of Object.keys(samples).entries()) {
      const sample = samples[vin]
      expect(sample.pricing.base + sample.pricing.options + sample.pricing.destination).toBe(sample.msrp)
      const resource = getDemoWindowSticker({ vin, imageUrl: `/demo-vehicles/${photos[index]}.jpg` })
      expect(resource?.previewUrl).toBe(`/demo-documents/window-sticker-${vin}.png`)
      const png = readFileSync(`public${resource!.previewUrl}`)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      hashes.add(createHash('sha256').update(png).digest('hex'))
    }
    expect(hashes.size).toBe(8)
    expect(readFileSync('public/demo-documents/window-sticker.js','utf8')).toContain('NOT AN OFFICIAL WINDOW STICKER')
  })
})
