// @ts-nocheck -- exercises plain ESM Worker response helpers.
// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { equipmentDocumentStatus, savedEquipmentResponse, uploadEquipmentDocument } from '../../cloudflare/src/worker.mjs'

const vin = '1FTFW1E84RKF12345'
const sourceUrl = 'https://assets.cai-media-management.com/window-stickers/123e4567-e89b-42d3-a456-426614174000.jpg'
const pdf = Buffer.from('%PDF-1.4\nsynthetic test document\n%%EOF\n')
const sha256 = createHash('sha256').update(pdf).digest('hex')
const object = { size: pdf.length, body: pdf, httpMetadata: { contentType: 'application/pdf' }, customMetadata: { vin, sha256, sourceUrl } }
const release = { vehicles: [{ vin, resourceRecord: { factoryEquipment: {
  dataState: 'current', isOriginalWindowSticker: false, url: sourceUrl, savedPdfSha256: sha256,
} } }] }

describe('Cloudflare saved vAuto equipment PDFs', () => {
  it('serves only the exact released VIN, source URL and digest', async () => {
    const get = vi.fn(async () => object)
    const response = await savedEquipmentResponse({ RELEASE_SNAPSHOTS: { get } }, release, vin)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(`${vin}-vauto-equipment.pdf`)
    expect(get).toHaveBeenCalledWith(`documents/vauto-equipment/${vin}/${sha256}.pdf`)
    await expect(savedEquipmentResponse({ RELEASE_SNAPSHOTS: { get: async () => ({ ...object,
      customMetadata: { ...object.customMetadata, sourceUrl: sourceUrl.replace('.jpg', '.pdf') } }) } }, release, vin))
      .rejects.toMatchObject({ code: 'EQUIPMENT_PDF_UNAVAILABLE', status: 503 })
  })

  it('stores immutable content once and rejects a mismatched source URL', async () => {
    const head = vi.fn(async () => null)
    const put = vi.fn(async () => undefined)
    const env = { RELEASE_SNAPSHOTS: { head, put } }
    const request = new Request('https://inventory-ops.joegallant.me/internal/equipment', {
      method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Inventory-Source-Url': sourceUrl }, body: pdf,
    })
    const response = await uploadEquipmentDocument(request, env, vin, sha256)
    expect((await response.json()).status).toBe('stored')
    expect(put).toHaveBeenCalledWith(`documents/vauto-equipment/${vin}/${sha256}.pdf`, expect.any(Uint8Array),
      expect.objectContaining({ customMetadata: { vin, sha256, sourceUrl } }))
    expect((await equipmentDocumentStatus({ RELEASE_SNAPSHOTS: { head: async () => object } }, vin, sha256, sourceUrl)).status).toBe(200)
    await expect(uploadEquipmentDocument(new Request(request.url, { method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-Inventory-Source-Url': 'https://evil.example/doc.pdf' }, body: pdf,
    }), env, vin, sha256)).rejects.toMatchObject({ code: 'INVALID_EQUIPMENT_DOCUMENT' })
  })
})
