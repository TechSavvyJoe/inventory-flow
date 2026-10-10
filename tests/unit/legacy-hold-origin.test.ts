// @ts-nocheck -- portable backend modules use plain ESM without declaration files.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { inventoryDecision } from '../../server/manual-holds.mjs'

describe('derived DealerMail hold origin', () => {
  it.each(['crm-one', 'dealermail'])('keeps the derived observation reserved when the supplied provider is %s', provider => {
    const vin = 'TESTDATAHWELL0002'
    const vehicle = {
      vin, hold: { state: 'primary', reason: 'Synthetic private hold detail' },
      operationalEvidence: { records: [{ vin, provider, sourceLabel: 'Synthetic provider', capturedAt: '2026-08-30T14:00:00Z', dataState: 'current', readOnly: true, complete: true, holdState: 'held' }] },
    }
    const decision = inventoryDecision(vehicle)
    expect(decision.evidence).toEqual([
      expect.objectContaining({ provider: 'legacy-dealermail', sourceLabel: 'DealerMail', effectiveHoldState: 'held' }),
      expect.objectContaining({ provider, sourceLabel: 'Synthetic provider', effectiveHoldState: 'held' }),
    ])
    expect(decision.evidence.filter(record => record.provider !== 'legacy-dealermail')).toHaveLength(1)
    expect(JSON.stringify(decision.evidence)).not.toContain('Synthetic private hold detail')
  })
})
