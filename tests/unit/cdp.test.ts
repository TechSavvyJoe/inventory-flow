// @ts-nocheck -- CDP helper is plain ESM.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PTS_REPAIR_ORDER_DETAILS_URL, READ_ONLY_POST_URLS, closeDuplicateTabs, connect, fetchInTab } from '../../scripts/lib/cdp.mjs'

describe('CDP request timeout boundary', () => {
  it('does not fail a completed capture when best-effort duplicate cleanup cannot reach CDP', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('CDP unavailable'))
    vi.stubGlobal('fetch', fetch)
    try {
      await expect(closeDuplicateTabs('https://example.invalid', { pathIncludes: '/read-only' })).resolves.toBe(0)
      expect(fetch).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('lets the in-page fetch timeout before the outer CDP command timeout', async () => {
    const page = { evalJs: vi.fn().mockResolvedValue({ status: 0, error: 'AbortError' }) }
    await fetchInTab(page, 'https://example.invalid/read-only', { timeoutMs: 45_000 })
    expect(page.evalJs).toHaveBeenCalledOnce()
    expect(page.evalJs.mock.calls[0][1]).toEqual({ timeoutMs: 50_000 })
  })

  it('sends a POST only to an exact allowlisted read URL', async () => {
    expect(READ_ONLY_POST_URLS).toEqual([PTS_REPAIR_ORDER_DETAILS_URL])
    const page = { evalJs: vi.fn().mockResolvedValue({ status: 200, text: '' }) }
    for (const url of [
      'https://www.dealermail.com/prospect_manager/V2_inventory_USED_hold_edit.asp',
      `${PTS_REPAIR_ORDER_DETAILS_URL}?vin=TESTDATAHWELL0001`,
      PTS_REPAIR_ORDER_DETAILS_URL.toLowerCase(),
    ]) {
      await expect(fetchInTab(page, url, { method: 'POST', body: 'x=1' })).rejects.toThrow('FETCH_POST_NOT_ALLOWLISTED')
    }
    await expect(fetchInTab(page, 'https://example.invalid/read-only', { method: 'DELETE' })).rejects.toThrow('UNSUPPORTED_FETCH_METHOD_DELETE')
    expect(page.evalJs).not.toHaveBeenCalled()
    await fetchInTab(page, PTS_REPAIR_ORDER_DETAILS_URL, { method: 'POST', body: 'x=1' })
    expect(page.evalJs).toHaveBeenCalledOnce()
    expect(page.evalJs.mock.calls[0][0]).toContain('"POST"')
  })

  it('closes the websocket when the initial Page.enable command times out', async () => {
    class SilentWebSocket extends EventTarget {
      static instance
      closed = false

      constructor() {
        super()
        SilentWebSocket.instance = this
        queueMicrotask(() => this.dispatchEvent(new Event('open')))
      }

      send() {}
      close() { this.closed = true }
    }
    vi.stubGlobal('WebSocket', SilentWebSocket)
    try {
      await expect(connect('ws://127.0.0.1/wedged', { timeoutMs: 5, connectTimeoutMs: 50 }))
        .rejects.toThrow('Page.enable: CDP_TIMEOUT')
      expect(SilentWebSocket.instance.closed).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
