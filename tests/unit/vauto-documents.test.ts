// @ts-nocheck -- exercises plain ESM publishing helpers.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { approvedEquipmentSource, equipmentFiles, equipmentPublicationEndpoint, stageEquipmentFile } from '../../scripts/publish-vauto-documents.mjs'

const vin = '1FTFW1E84RKF12345'
const sourceUrl = 'https://assets.cai-media-management.com/window-stickers/123e4567-e89b-42d3-a456-426614174000.jpg'
const pdf = Buffer.from('%PDF-1.4\nsynthetic test document\n%%EOF\n')
const sha256 = createHash('sha256').update(pdf).digest('hex')
const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

describe('vAuto private PDF staging', () => {
  it('selects only current VIN-bound, cached PDFs from approved sources', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'vauto-pdf-'))
    folders.push(folder)
    mkdirSync(path.join(folder, 'objects'))
    const file = path.join(folder, 'objects', `${sha256}.pdf`)
    writeFileSync(file, pdf)
    const index = { schema: 'vauto-equipment-pdf-cache-v1', byVin: {
      [vin]: { sha256, sourceUrl, vinVerification: 'vauto_exact_vin_image_only' },
      '1FTFW1E84RKF54321': { sha256, sourceUrl: 'https://evil.example/image.jpg', vinVerification: 'printed_vin' },
    } }
    expect(equipmentFiles({ index, folder, vehicles: { [vin]: {}, '1FTFW1E84RKF54321': {} } })).toEqual([{ vin, sha256, sourceUrl, file }])
    expect(approvedEquipmentSource(sourceUrl.replace('.jpg', '.pdf'))).toBe(true)
    expect(approvedEquipmentSource('https://evil.example/window-stickers/123e4567-e89b-42d3-a456-426614174000.pdf')).toBe(false)
    expect(equipmentPublicationEndpoint('https://inventory-ops.joegallant.me/', vin, sha256).pathname).toContain(`/internal/equipment/${vin}/`)
  })

  it('skips a stored hash and uploads a new hash only after a status check', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'vauto-pdf-'))
    folders.push(folder)
    const file = path.join(folder, `${sha256}.pdf`)
    writeFileSync(file, pdf)
    const environment = { INVENTORY_OPS_CLOUD_URL: 'https://inventory-ops.joegallant.me/',
      INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN: 'test', CF_ACCESS_CLIENT_ID: 'test', CF_ACCESS_CLIENT_SECRET: 'test' }
    const storedFetch = vi.fn(async () => new Response(JSON.stringify({ status: 'stored', vin, sha256 }), { status: 200 }))
    expect(await stageEquipmentFile({ vin, sha256, sourceUrl, file, environment, fetchImpl: storedFetch })).toBe('already_stored')
    expect(storedFetch).toHaveBeenCalledTimes(1)
    const missingFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'missing', vin, sha256 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'stored', vin, sha256 }), { status: 201 }))
    expect(await stageEquipmentFile({ vin, sha256, sourceUrl, file, environment, fetchImpl: missingFetch })).toBe('stored')
    expect(missingFetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST'])
    expect(missingFetch.mock.calls[1][1].body).toEqual(pdf)
  })
})
