// @vitest-environment jsdom
// @ts-nocheck -- The unpacked extension module is JavaScript and is exercised at runtime.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dealerMailTabId,
  checkLiveDealerMailHold,
  inspectDealerMailHoldPage,
  isDealerMailInventoryTab,
  withLiveDealerMailHold,
} from '../../extension/sidepanel/lib/live-dealermail-hold.mjs'

const row = (order: string, stock: string) => `<tr><td><input value="${order}"></td><td>${stock}</td><td>Salesperson</td><td>Customer</td><td>Date</td><td></td><td>Date</td><td></td></tr>`
const page = (...rows: string[]) => `<table><tr><td>HOLD ORDER</td><td>STOCKNO</td></tr>${rows.join('')}</table>`
const response = (html: string) => ({ ok: true, url: `${location.origin}/prospect_manager/V2_inventory_USED_hold_edit.asp`, text: async () => html })

afterEach(() => vi.unstubAllGlobals())

describe('live DealerMail hold check', () => {
  it('treats a deleted truck hold as inactive without borrowing the Jeep hold', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(page(row('DELETED', 'HT1345U')))))
    expect(await inspectDealerMailHoldPage('HT1345U')).toMatchObject({ status: 'verified', stock: 'HT1345U', activeCount: 0 })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('s=HT1345U'), expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
  })

  it('keeps both active Jeep holds on the Jeep', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(page(row('1', 'H13579P'), row('2', 'H13579P')))))
    expect(await inspectDealerMailHoldPage('H13579P')).toMatchObject({ status: 'verified', activeCount: 2 })
  })

  it('fails closed on a different stock, missing source table, or expired session', async () => {
    const mock = vi.fn(async () => response(page(row('1', 'H13579P'))))
    vi.stubGlobal('fetch', mock)
    expect(await inspectDealerMailHoldPage('HT1345U')).toEqual({ status: 'unavailable' })
    mock.mockResolvedValueOnce(response('<html><body>Session Ended - Please Refresh (F5)</body></html>'))
    expect(await inspectDealerMailHoldPage('HT1345U')).toEqual({ status: 'unavailable' })
    mock.mockResolvedValueOnce(response('<html><body>Login</body></html>'))
    expect(await inspectDealerMailHoldPage('HT1345U')).toEqual({ status: 'unavailable' })
  })

  it('uses an open DealerMail inventory tab and validates the injected result', async () => {
    expect(isDealerMailInventoryTab('https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp')).toBe(true)
    expect(isDealerMailInventoryTab('https://example.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp')).toBe(false)
    const tabs = { query: vi.fn(async () => [
      { id: 6, active: true, url: 'https://inventory-ops.joegallant.me/' },
      { id: 7, active: false, url: 'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp' },
    ]) }
    expect(await dealerMailTabId({ tabs })).toBe(7)
    expect(tabs.query).toHaveBeenCalledWith({ currentWindow: true })
    const scripting = { executeScript: vi.fn(async () => [{ result: { status: 'verified', stock: 'HT1345U', activeCount: 0, checkedAt: '2026-09-23T15:30:00Z' } }]) }
    expect(await checkLiveDealerMailHold(7, 'HT1345U', { scripting })).toMatchObject({ status: 'verified', activeCount: 0 })
    scripting.executeScript.mockResolvedValueOnce([{ result: { status: 'verified', stock: 'H13579P', activeCount: 0 } }])
    expect(await checkLiveDealerMailHold(7, 'HT1345U', { scripting })).toEqual({ status: 'unavailable' })
  })

  it('removes stale names and reasons from a live result or failed check', () => {
    const vehicle = { hold: { state: 'primary', tone: 'held', canViewEvidence: true, evidence: [{ salesperson: 'Old name', customerOrReason: 'Old reason' }], comments: [{ text: 'Old note' }], commentsCount: 1 } }
    const released = withLiveDealerMailHold(vehicle, { status: 'verified', activeCount: 0, checkedAt: '2026-09-23T15:30:00Z' }).hold
    expect(released).toMatchObject({ state: 'none_observed', tone: 'clear', hasActiveHold: false, evidence: [], comments: [] })
    const uncertain = withLiveDealerMailHold(vehicle, { status: 'unavailable' }).hold
    expect(uncertain).toMatchObject({ state: 'unknown', tone: 'unverified', hasActiveHold: null, evidence: [] })
  })
})
