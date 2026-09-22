// @ts-nocheck -- exercises the plain ESM daily merge helper.
import { describe, expect, it } from 'vitest'
import { mergeInvoiceMetadata } from '../../scripts/merge-invoice-metadata.mjs'
import { invoiceFiles, invoicePublicationEndpoint } from '../../scripts/publish-invoice-documents.mjs'

const vin = '1FTFW1E84RKF12345'
const chevyVin = '1GNEVGKW2PJ285653'

describe('saved Ford invoice metadata', () => {
  it('attaches only an exact-VIN Ford-family PDF and removes stale availability', () => {
    const enrichment = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1', generatedAt: '2026-09-20T10:00:00Z',
      recordsByVin: {
        [vin]: { vin, fordInvoice: { dataState: 'current', available: true, capturedAt: '2026-09-20T10:00:00Z', sourceLabel: 'Old' } },
        [chevyVin]: { vin: chevyVin, fordInvoice: { dataState: 'current', available: true, capturedAt: '2026-09-20T10:00:00Z', sourceLabel: 'Old' } },
      },
    }
    const parsed = {
      schema: 'ford-invoice-parsed-v1', reportDate: '2026-09-21', parsedAtUtc: '2026-09-21T20:45:00Z',
      results: [
        { vin, status: 'pdf', invoice: { vin } },
        { vin: chevyVin, status: 'pdf', invoice: { vin: chevyVin } },
        { vin: '5LMCJ1DA6RUL15774', status: 'pdf', invoice: { vin: 'WRONGVIN000000000' } },
      ],
    }
    const result = mergeInvoiceMetadata({
      enrichment, parsed,
      vehicles: { [vin]: { make: 'Ford' }, [chevyVin]: { make: 'Chevrolet' }, '5LMCJ1DA6RUL15774': { make: 'Lincoln' } },
      pdfAvailable: (candidate) => candidate === vin,
    })
    expect(result).toEqual({ attached: 1, removed: 2 })
    expect(enrichment.recordsByVin[vin].fordInvoice).toEqual({
      dataState: 'current', available: true, capturedAt: '2026-09-21T20:45:00Z', sourceLabel: 'Saved Ford factory invoice',
    })
    expect(enrichment.recordsByVin[chevyVin]).toBeUndefined()
    expect(enrichment.recordsByVin['5LMCJ1DA6RUL15774']).toBeUndefined()
  })

  it('rejects a parse file without a trustworthy capture timestamp', () => {
    expect(() => mergeInvoiceMetadata({
      enrichment: { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: {} },
      parsed: { schema: 'ford-invoice-parsed-v1', results: [] }, vehicles: {},
    })).toThrow('INVALID_FORD_INVOICE_CAPTURE_TIME')
  })

  it('publishes only parsed exact-VIN PDFs represented in the release metadata', () => {
    const folder = 'C:\\synthetic\\invoice-history'
    const parsed = { schema: 'ford-invoice-parsed-v1', results: [
      { vin, status: 'pdf', invoice: { vin } },
      { vin: chevyVin, status: 'pdf', invoice: { vin: chevyVin } },
    ] }
    const enrichment = { schemaVersion: 'inventory-flow-vin-document-enrichment-v1', recordsByVin: {
      [vin]: { vin, fordInvoice: { dataState: 'current', available: true } },
    } }
    const files = invoiceFiles({ parsed, enrichment, folder, fileExists: () => true })
    expect(files).toHaveLength(1)
    expect(files[0].vin).toBe(vin)
    expect(files[0].file.endsWith(`${vin}.pdf`)).toBe(true)
    expect(invoicePublicationEndpoint('https://inventory-ops.joegallant.me/', '2026-09-21', vin).href)
      .toBe(`https://inventory-ops.joegallant.me/internal/invoices/2026-09-21/${vin}`)
    expect(() => invoicePublicationEndpoint('https://other.example/', '2026-09-21', vin)).toThrow(/Cloud publish URL/)
  })
})
