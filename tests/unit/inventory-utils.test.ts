import { describe, expect, it } from 'vitest'
import { formatDate } from '../../src/features/inventory/inventory-utils'

describe('inventory date formatting', () => {
  it('keeps date-only source values on the published calendar day', () => {
    expect(formatDate('2026-05-23')).toBe('05/23/2026')
    expect(formatDate('2026-08-29')).toBe('08/29/2026')
  })

  it('retains invalid source text for review', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
