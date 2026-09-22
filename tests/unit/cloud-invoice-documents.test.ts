// @ts-nocheck -- exercises plain ESM Worker response helpers.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { savedInvoiceResponse } from '../../cloudflare/src/worker.mjs'

const vin = '1FTFW1E84RKF12345'
const capturedAt = '2026-09-21T20:45:00Z'
const release = {
  reportDate: '2026-09-21',
  vehicles: [{
    vin, publicRecord: { make: 'Ford' },
    resourceRecord: { fordInvoice: { dataState: 'current', available: true, capturedAt, sourceLabel: 'Saved Ford factory invoice' } },
  }],
}

function environment(overrides = {}) {
  return {
    RELEASE_SNAPSHOTS: {
      get: vi.fn(async () => ({
        size: 18, body: new Uint8Array([37, 80, 68, 70, 45]), httpMetadata: { contentType: 'application/pdf' },
        customMetadata: { vin, reportDate: release.reportDate, capturedAt, sha256: 'a'.repeat(64) },
      })),
    },
    ...overrides,
  }
}

describe('private saved invoice response', () => {
  it('serves the exact current invoice only to an invoice-capable employee role', async () => {
    const env = environment()
    const response = await savedInvoiceResponse(env, release, vin, { role: 'manager', authenticatedRole: 'manager' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(`${vin}-factory-invoice.pdf`)
    expect(response.headers.get('x-inventory-captured-at')).toBe(capturedAt)
    expect(env.RELEASE_SNAPSHOTS.get).toHaveBeenCalledWith(`documents/invoices/${release.reportDate}/${vin}.pdf`)
  })

  it('uses the authenticated role rather than a broader preview role', async () => {
    await expect(savedInvoiceResponse(environment(), release, vin, { role: 'manager', authenticatedRole: 'porter' }))
      .rejects.toMatchObject({ code: 'INVOICE_ACCESS_REQUIRED', status: 403 })
  })

  it('fails closed when current release metadata exists but its PDF is missing', async () => {
    const env = environment({ RELEASE_SNAPSHOTS: { get: vi.fn(async () => null) } })
    await expect(savedInvoiceResponse(env, release, vin, { role: 'sales' }))
      .rejects.toMatchObject({ code: 'INVOICE_ARTIFACT_UNAVAILABLE', status: 503 })
  })
})
