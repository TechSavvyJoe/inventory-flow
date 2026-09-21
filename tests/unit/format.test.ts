import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from '../../src/lib/format'

describe('formatDate', () => {
  it.each(['03/14/2024', '03-14-2024', '14-Mar-2024', 'March 14, 2024', '2024-03-14'])('normalizes source calendar date %s without changing the day', (value) => {
    expect(formatDate(value)).toBe('03/14/2024')
    expect(formatDateTime(value)).toBe('03/14/2024')
  })

  it('preserves invalid calendar source values for review', () => {
    expect(formatDate('2026-02-30')).toBe('2026-02-30')
    expect(formatDate('02/30/2026')).toBe('02/30/2026')
    expect(formatDate('2024-02-29')).toBe('02/29/2024')
    expect(formatDate('Septober 19, 2026')).toBe('Septober 19, 2026')
    expect(formatDateTime('2026-02-30T12:00:00Z')).toBe('2026-02-30T12:00:00Z')
  })

  it('keeps a date-only report date on the same calendar day', () => {
    expect(formatDate('2026-08-29')).toBe('08/29/2026')
  })

  it('keeps invalid source text visible for review', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
