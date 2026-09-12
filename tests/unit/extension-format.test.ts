// @vitest-environment node
// @ts-nocheck -- dependency-free ESM formatters.
import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatRelative, formatStickerMoney } from '../../extension/sidepanel/lib/format.mjs'

describe('deal desk formatting', () => {
  it('renders a calendar date on the day the source wrote, in any time zone', () => {
    // A hold expected on the 31st must never print as the 30th for a US user.
    expect(formatDate('2026-08-31')).toBe('Aug 31')
    expect(formatDateTime('2026-08-31')).toBe('Aug 31')
    expect(formatDate('2026-12-01')).toBe('Dec 1')
  })

  it('still renders timestamps in local time and tolerates junk', () => {
    expect(formatDateTime('2026-08-30T14:15:00.000Z')).toMatch(/Aug 30, \d{1,2}:\d{2} (AM|PM)/)
    expect(formatDate('not a date')).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatRelative('2026-08-30T14:15:00.000Z', Date.parse('2026-08-30T14:16:00.000Z'))).toBe('1 min ago')
  })

  it('keeps an original sticker total in its own currency and never converts it', () => {
    // Intl separates the code from the amount with a non-breaking space.
    const plain = (value) => value.replace(/\u00a0/g, ' ')
    expect(plain(formatStickerMoney(54000, { pricingCurrency: 'CAD' }))).toBe('CAD 54,000')
    expect(plain(formatStickerMoney(54000, { pricingCurrency: 'usd' }))).toBe('USD 54,000')
    expect(formatStickerMoney(54000, {})).toBe('54,000 (original sticker currency; verify)')
    expect(formatStickerMoney(null, { pricingCurrency: 'CAD' })).toBe('—')
  })
})
