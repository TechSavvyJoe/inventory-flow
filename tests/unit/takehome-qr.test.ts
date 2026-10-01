// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { getListingQr } from '../../extension/sidepanel/lib/takehome-qr.mjs'

describe('printed vehicle listing QR', () => {
  it.each([
    'https://example.com/used/Ford/F-150/vehicle-details',
    `https://example.com/listing/${'qualified-package-'.repeat(24)}?view=photos`,
    'https://example.com/vehicle/caf%C3%A9',
  ])('decodes locally to the exact public target %s', target => {
    const qr = getListingQr(target)!
    const scale = 4, width = qr.size * scale
    const luminance = new Uint8ClampedArray(width * width)
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) luminance[y * width + x] = qr.modules[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255
    const decoded = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, width, width))))
    expect(decoded.getText()).toBe(target)
    expect(qr.modules.slice(0,4).flat().some(Boolean)).toBe(false)
    expect(qr.modules.slice(-4).flat().some(Boolean)).toBe(false)
    expect(qr.dataUrl).toMatch(/^data:image\/svg\+xml,/)
  })

  it.each(['javascript:alert(1)', 'http://example.com/', 'https://user:password@example.com/', 'https://example.com/\nprivate', '', null])('omits unsafe or unusable targets', target => {
    expect(getListingQr(target)).toBeNull()
  })
})
