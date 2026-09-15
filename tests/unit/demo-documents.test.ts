import { describe, expect, it } from 'vitest'
import { getDemoWindowSticker } from '../../src/lib/demo-documents'
import { readFileSync } from 'node:fs'

describe('isolated demo document resources', () => {
  it('requires an exact synthetic VIN and matching synthetic illustration', () => {
    expect(getDemoWindowSticker({vin:'TESTDATAHWELL0001'})).toBeNull()
    expect(getDemoWindowSticker({vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/escape.png'})).toBeNull()
    expect(getDemoWindowSticker({vin:'1FTFW1E50PFA12345',imageUrl:'/demo-vehicles/f150.png'})).toBeNull()
    expect(getDemoWindowSticker({vin:'TESTDATAHWELL0001',imageUrl:'/demo-vehicles/f150.png'})).toMatchObject({label:'Demo window sticker',url:'/demo-documents/window-sticker.html?vehicle=TESTDATAHWELL0001'})
  })
  it('does not show an F-150 document thumbnail for another model', () => {
    expect(getDemoWindowSticker({vin:'TESTDATALNCN00001',imageUrl:'/demo-vehicles/nautilus.png'})?.previewUrl).toBeUndefined()
  })
  it('ships only fixture samples with reconciled F-150 example pricing', () => {
    const samples = JSON.parse(readFileSync('public/demo-documents/samples.json','utf8'))
    expect(Object.keys(samples)).toHaveLength(8)
    expect(Object.keys(samples).every(vin=>vin.startsWith('TESTDATA'))).toBe(true)
    const sample = samples.TESTDATAHWELL0001
    expect(sample.pricing.base + sample.pricing.options + sample.pricing.destination).toBe(sample.msrp)
    expect(readFileSync('public/demo-documents/window-sticker.js','utf8')).toContain('NOT AN OFFICIAL WINDOW STICKER')
  })
})
