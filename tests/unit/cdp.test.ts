// @ts-nocheck -- CDP helper is plain ESM.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { connect, fetchInTab } from '../../scripts/lib/cdp.mjs'

describe('CDP request timeout boundary', () => {
  it('lets the in-page fetch timeout before the outer CDP command timeout', async () => {
    const page = { evalJs: vi.fn().mockResolvedValue({ status: 0, error: 'AbortError' }) }
    await fetchInTab(page, 'https://example.invalid/read-only', { timeoutMs: 45_000 })
    expect(page.evalJs).toHaveBeenCalledOnce()
    expect(page.evalJs.mock.calls[0][1]).toEqual({ timeoutMs: 50_000 })
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
