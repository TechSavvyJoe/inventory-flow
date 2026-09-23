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

let loadingHistory: boolean[] = []

function Probe() {
  context = useAppData()
  loadingHistory.push(context.loading)
  return <output data-testid="report">{context.data?.meta.reportDate ?? 'none'}</output>
}

describe('first bootstrap refresh after load', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.clear()
    loadingHistory = []
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
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

  it('never flips loading to true on an unattended foreground timer poll once data is loaded', async () => {
    // The interval that drives the poll is created at mount, so fake timers
    // must be installed before render — switching to them afterward would
    // leave that interval bound to the real clock.
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fetchMock.mockResolvedValueOnce(okResponse('"a"'))
    render(<AppDataProvider><Probe /></AppDataProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByTestId('report')).toHaveTextContent('2026-09-22')
    const loaded = context.data
    expect(context.loading).toBe(false)

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"a"' } }))
    const historyBeforePoll = loadingHistory.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(headerAt(1, 'If-None-Match')).toBe('"a"')
    // Every render since the timer fired kept loading false — the button
    // never spins and no "Loading the full vehicle record…" flash occurs.
    expect(loadingHistory.slice(historyBeforePoll)).not.toContain(true)
    expect(context.data).toBe(loaded)
    expect(context.loading).toBe(false)
    expect(context.lastCheckedAt).not.toBeNull()
    visibility.mockRestore()
  })

  it('shows loading when a manual refresh click joins an in-flight background timer poll', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fetchMock.mockResolvedValueOnce(okResponse('"a"'))
    render(<AppDataProvider><Probe /></AppDataProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByTestId('report')).toHaveTextContent('2026-09-22')
    expect(context.loading).toBe(false)

    let unblock!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { unblock = resolve }))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    // The background poll is now in flight and did not show loading.
    expect(context.loading).toBe(false)

    let clicked!: Promise<void>
    act(() => { clicked = context.refresh() })
    // A foreground ask joining that same in-flight read must spin the button.
    expect(context.loading).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      unblock(new Response(null, { status: 304, headers: { ETag: '"a"' } }))
      await clicked
    })
    expect(context.loading).toBe(false)
    visibility.mockRestore()
  })
})
