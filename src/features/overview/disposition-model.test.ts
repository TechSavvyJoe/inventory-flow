import { describe, expect, it } from 'vitest'
import { allowedDispositions, defaultDispositionDate } from './disposition-model'

describe('disposition defaults', () => {
  it('uses the configured server timezone when UTC midnight falls on a different local date', () => {
    const now = new Date('2026-10-08T02:30:00.000Z')
    expect(defaultDispositionDate('VIN123', undefined, 'America/New_York', now)).toBe('2026-10-07')
    expect(defaultDispositionDate('VIN123', undefined, 'Asia/Tokyo', now)).toBe('2026-10-08')
  })

  it('keeps the synthetic report date and existing Other disposition choices', () => {
    expect(defaultDispositionDate('TESTDATAHWELL0001', '2026-09-25', 'Asia/Tokyo', new Date('2026-10-08T02:30:00Z'))).toBe('2026-09-25')
    expect(allowedDispositions(null)).toContain('other')
    expect(allowedDispositions('other')).toContain('other')
  })

  it('uses UTC instead of the device timezone if the configured timezone is invalid', () => {
    expect(defaultDispositionDate('VIN123', undefined, 'Not/A_Timezone', new Date('2026-10-08T02:30:00.000Z'))).toBe('2026-10-08')
  })
})
