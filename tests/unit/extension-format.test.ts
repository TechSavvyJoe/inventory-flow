// @vitest-environment node
// @ts-nocheck -- dependency-free ESM formatters.
import { describe, expect, it } from 'vitest'
import { formatDate, formatSourceDateText, formatReportDate, formatDateTime, formatRelative, formatStickerMoney } from '../../extension/sidepanel/lib/format.mjs'

describe('numeric date display', () => {
  it('formats current and historical calendar dates, preserving invalid-source qualifiers', () => {
    expect(formatReportDate('2026-08-30')).toBe('08/30/2026')
    expect(formatDate('14-MAR-2024')).toBe('03/14/2024')
    expect(formatDateTime('14-MAR-2024')).toBe('03/14/2024')
    expect(formatDate('31-FEB-2024')).toBe('—')
    expect(formatDate('March 14, 2024')).toBe('03/14/2024')
    expect(formatDate('2026-02-30')).toBe('—')
    expect(formatDateTime('2026-02-30T12:00:00Z')).toBe('—')
    expect(formatDate('12-Septober-2026')).toBe('—')
    expect(formatReportDate('2026-02-30')).toBe('—')
    expect(formatSourceDateText('Coverage ends 14-Mar-2027; verify 160,000 km')).toBe('Coverage ends 03/14/2027; verify 160,000 km')
    expect(formatSourceDateText('Expiration not captured')).toBe('Expiration not captured')
  })
})

describe('deal desk formatting', () => {
  it('renders a calendar date on the day the source wrote, in any time zone', () => {
    // A hold expected on the 31st must never print as the 30th for a US user.
    expect(formatDate('2026-08-31')).toBe('08/31/2026')
    expect(formatDateTime('2026-08-31')).toBe('08/31/2026')
    expect(formatDate('2026-12-01')).toBe('12/01/2026')
  })

  it('still renders timestamps in local time and tolerates junk', () => {
    expect(formatDateTime('2026-08-30T14:15:00.000Z')).toMatch(/08\/30\/2026, \d{1,2}:\d{2} (AM|PM)/)
    expect(formatDate('not a date')).toBe('—')
    expect(formatDate(null)).toBe('—')
    expect(formatRelative('2026-08-30T14:15:00.000Z', Date.parse('2026-08-30T14:16:00.000Z'))).toBe('1 min ago')
  })

  it('keeps an original sticker total in its own currency and never converts it', () => {
    // Intl separates the code from the amount with a non-breaking space.
    const plain = (value) => value.replace(/\u00a0/g, ' ')
    expect(plain(formatStickerMoney(54000, { pricingCurrency: 'CAD' }))).toBe('CAD 54,000')
    expect(plain(formatStickerMoney(54000, { pricingCurrency: 'usd' }))).toBe('$54,000')
    expect(formatStickerMoney(54000, {})).toBe('54,000')
    expect(formatStickerMoney(null, { pricingCurrency: 'CAD' })).toBe('—')
    expect(formatStickerMoney(1250.75, { pricingCurrency: 'USD' })).toBe('$1,250.75')
    expect(formatStickerMoney(0, { pricingCurrency: 'USD' })).toBe('$0')
    expect(plain(formatStickerMoney(1250.75, { pricingCurrency: 'CAD' }))).toBe('CAD 1,250.75')
    expect(formatStickerMoney(1250.75, {})).toBe('1,250.75')
    expect(formatStickerMoney(0, {})).toBe('0')
  })
})

describe('dates outside the current year', () => {
  it('carries the year so in-service and warranty dates are unambiguous', () => {
    const now = Date.UTC(2026, 8, 12)
    expect(formatDate('2024-03-14', now)).toBe('03/14/2024')
    expect(formatDate('2027-03-14', now)).toBe('03/14/2027')
    expect(formatDate('2026-08-30', now)).toBe('08/30/2026')
  })
})
