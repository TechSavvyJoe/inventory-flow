import { describe, expect, it } from 'vitest'
import { formatDate } from '../../src/lib/format'

describe('formatDate', () => {
  it('keeps a date-only report date on the same calendar day', () => {
    expect(formatDate('2026-08-29')).toBe('Aug 29, 2026')
  })

  it('keeps invalid source text visible for review', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
