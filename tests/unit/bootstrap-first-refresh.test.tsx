// PRODUCT-RULE TEST
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
// The provider, the real API client and a stubbed fetch: proves the first
// refresh after load already revalidates with If-None-Match and that a 304
// keeps the same bootstrap object, so nothing downstream re-runs.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDataProvider, useAppData } from '../../src/app/AppDataContext'

const fetchMock = vi.fn<typeof fetch>()
let context: ReturnType<typeof useAppData>

function bootstrapBody(reportDate: string) {
  return {
    access: { user: 'Synthetic Manager', role: 'manager', store: 'Howell', canViewPrivateEvidence: true, canCreateTransfer: true },
    meta: {
      reportDate, completedAt: `${reportDate}T13:00:00.000Z`, timezone: 'America/New_York',
      publicFreshness: 'current', dealerMailFreshness: 'current', publicCount: 0, crmCount: 0, heldVinCount: 0,
      publicChangeCounts: { newArrival: 0, removed: 0, priceChange: 0, mileageChange: 0, websiteStatusChange: 0, stockCorrection: 0, storeTransfer: 0 },
      holdChangeStatus: 'baseline', warnings: [],
    },
    stores: [], vehicles: [], transfers: [], attention: [], publicChanges: [],
  }
}

const okResponse = (etag: string, reportDate = '2026-09-22') => new Response(JSON.stringify(bootstrapBody(reportDate)), {
  status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: etag },
})
const headerAt = (index: number, name: string) => new Headers(fetchMock.mock.calls[index]?.[1]?.headers).get(name)

function Probe() {
  context = useAppData()
  return <output data-testid="report">{context.data?.meta.reportDate ?? 'none'}</output>
}

describe('first bootstrap refresh after load', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('sends If-None-Match on the very first refresh and keeps the same data object on 304', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('"first"'))
    render(<AppDataProvider><Probe /></AppDataProvider>)
    await waitFor(() => expect(screen.getByTestId('report')).toHaveTextContent('2026-09-22'))
    const loaded = context.data
    expect(loaded).not.toBeNull()
    expect(headerAt(0, 'If-None-Match')).toBeNull()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"first"' } }))
    await act(async () => { await context.refresh() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(headerAt(1, 'If-None-Match')).toBe('"first"')
    expect(context.data).toBe(loaded)
    expect(context.error).toBeNull()
  })

  it('takes a changed document as new data and revalidates with the new validator afterwards', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('"first"'))
    render(<AppDataProvider><Probe /></AppDataProvider>)
    await waitFor(() => expect(screen.getByTestId('report')).toHaveTextContent('2026-09-22'))
    const loaded = context.data

    fetchMock.mockResolvedValueOnce(okResponse('"second"', '2026-09-23'))
    await act(async () => { await context.refresh() })
    await waitFor(() => expect(screen.getByTestId('report')).toHaveTextContent('2026-09-23'))
    expect(context.data).not.toBe(loaded)

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }))
    await act(async () => { await context.refresh() })
    expect(headerAt(2, 'If-None-Match')).toBe('"second"')
  })
})
