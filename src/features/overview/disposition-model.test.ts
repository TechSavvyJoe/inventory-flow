import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultDispositionDate } from './disposition-model'

afterEach(() => vi.useRealTimers())

describe('disposition calendar date', () => {
  it.each([
    ['2026-10-02T00:15:00Z', 'America/Detroit', '2026-10-01'],
    ['2026-01-02T04:30:00Z', 'America/Detroit', '2026-01-01'],
    ['2026-10-02T05:15:00Z', 'America/Los_Angeles', '2026-10-01'],
  ])('uses the release timezone at %s rather than the device calendar', (instant, timezone, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(instant))
    expect(defaultDispositionDate('SYNTHETIC-REAL-SOURCE', undefined, timezone)).toBe(expected)
  })

  it('retains the deterministic synthetic report date', () => {
    expect(defaultDispositionDate('TESTDATAHWELL0001', '2026-08-30', 'America/Detroit')).toBe('2026-08-30')
  })
})
