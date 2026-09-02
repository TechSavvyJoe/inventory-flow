// @ts-nocheck -- Portable plain ESM Worker module.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it } from 'vitest'
import { assertReleaseOrdering, releaseCompletionTime } from '../../cloudflare/src/worker.mjs'

const reportDate = '2026-09-02'
const current = (completedAt) => ({ report_date: reportDate, metadata_json: JSON.stringify({ completedAt }) })

describe('private release completion ordering', () => {
  it('rejects an earlier UTC completion even when its text sorts after an Eastern timestamp', () => {
    // 14:30 Eastern is 18:30 UTC, so 16:00 UTC is older despite its string order.
    expect(() => assertReleaseOrdering(current('2026-09-02T14:30:00-04:00'), reportDate, '2026-09-02T16:00:00Z')).toThrow(/OLDER_RELEASE_REJECTED/)
  })

  it('accepts a newer Eastern completion even when its text sorts before the UTC timestamp', () => {
    expect(() => assertReleaseOrdering(current('2026-09-02T16:00:00Z'), reportDate, '2026-09-02T14:30:00-04:00')).not.toThrow()
  })

  it('accepts equivalent instants expressed with different offsets', () => {
    expect(() => assertReleaseOrdering(current('2026-09-02T18:30:00Z'), reportDate, '2026-09-02T14:30:00-04:00')).not.toThrow()
  })

  it.each([null, undefined, '', 'not-a-date', 1788372000000])('rejects new missing or invalid completion %s', (value) => {
    expect(() => assertReleaseOrdering(null, reportDate, value)).toThrow(/INVALID_RELEASE_COMPLETION_TIME/)
    expect(() => releaseCompletionTime(value)).toThrow(/INVALID_RELEASE_COMPLETION_TIME/)
  })

  it('allows valid completion to repair legacy null metadata', () => {
    expect(() => assertReleaseOrdering(current(null), reportDate, '2026-09-02T18:30:00Z')).not.toThrow()
    expect(() => assertReleaseOrdering(current(null), reportDate, null)).toThrow(/INVALID_RELEASE_COMPLETION_TIME/)
  })

  it('does not bypass report-date rollback protection for legacy metadata', () => {
    expect(() => assertReleaseOrdering(current(null), '2026-09-01', '2026-09-01T18:30:00Z')).toThrow(/OLDER_RELEASE_REJECTED/)
  })

  it('rejects corrupt existing completion metadata without replacing it', () => {
    expect(() => assertReleaseOrdering(current('bad-date'), reportDate, '2026-09-02T18:30:00Z')).toThrow(/CURRENT_RELEASE_METADATA_INVALID/)
    expect(() => assertReleaseOrdering({ report_date: reportDate, metadata_json: 'not-json' }, reportDate, '2026-09-02T18:30:00Z')).toThrow(/CURRENT_RELEASE_METADATA_INVALID/)
  })
})
