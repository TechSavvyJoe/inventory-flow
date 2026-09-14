// @ts-nocheck -- CDP helper is plain ESM.
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fetchInTab } from '../../scripts/lib/cdp.mjs'

describe('CDP request timeout boundary', () => {
  it('lets the in-page fetch timeout before the outer CDP command timeout', async () => {
    const page = { evalJs: vi.fn().mockResolvedValue({ status: 0, error: 'AbortError' }) }
    await fetchInTab(page, 'https://example.invalid/read-only', { timeoutMs: 45_000 })
    expect(page.evalJs).toHaveBeenCalledOnce()
    expect(page.evalJs.mock.calls[0][1]).toEqual({ timeoutMs: 50_000 })
  })
})
