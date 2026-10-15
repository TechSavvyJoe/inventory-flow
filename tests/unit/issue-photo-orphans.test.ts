import { describe, expect, it } from 'vitest'
import { findIssuePhotoOrphans, issuePhotoObjectKey, referencedIssuePhotoKeys } from '../../scripts/lib/issue-photo-orphans.mjs'
import { loadLedgerRows, reportIssuePhotoOrphans } from '../../scripts/cleanup-issue-photo-orphans.mjs'

const photoA = 'a'.repeat(64)
const photoB = 'b'.repeat(64)
const photoC = 'c'.repeat(64)

describe('issue photo orphan detection', () => {
  it('builds content-addressed keys from ledger photo rows', () => {
    const keys = referencedIssuePhotoKeys([
      { vin: 'TESTDATAHWELL0001', photos_json: JSON.stringify([{ id: photoA, contentType: 'image/jpeg', bytes: 12 }]) },
      { vin: 'TESTDATAHWELL0001', photos: [{ id: photoB, contentType: 'image/jpeg', bytes: 14 }] },
    ])
    expect([...keys].sort()).toEqual([
      issuePhotoObjectKey('TESTDATAHWELL0001', photoA),
      issuePhotoObjectKey('TESTDATAHWELL0001', photoB),
    ].sort())
  })

  it('never marks a referenced object as an orphan', () => {
    const referenced = new Set([issuePhotoObjectKey('TESTDATAHWELL0001', photoA)])
    const report = findIssuePhotoOrphans([
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoA), uploadedAt: '2026-01-01T00:00:00.000Z' },
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoC), uploadedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'releases/other.bin' },
    ], referenced, { now: new Date('2026-10-14T12:00:00.000Z'), graceMs: 0 })

    expect(report.retained).toEqual([{ key: issuePhotoObjectKey('TESTDATAHWELL0001', photoA), reason: 'referenced_by_ledger' }])
    expect(report.orphans).toEqual([{
      key: issuePhotoObjectKey('TESTDATAHWELL0001', photoC),
      reason: 'unreferenced',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    }])
    expect(report.ignored).toEqual([{ key: 'releases/other.bin', reason: 'not_issue_photo_object' }])
  })

  it('skips unreferenced objects still inside the in-flight grace window', () => {
    const report = findIssuePhotoOrphans([
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoC), uploadedAt: '2026-10-14T11:30:00.000Z' },
    ], new Set(), { now: new Date('2026-10-14T12:00:00.000Z'), graceMs: 60 * 60 * 1000 })

    expect(report.orphans).toEqual([])
    expect(report.skippedRecent).toEqual([{
      key: issuePhotoObjectKey('TESTDATAHWELL0001', photoC),
      reason: 'inside_grace_window',
      uploadedAt: '2026-10-14T11:30:00.000Z',
    }])
  })

  it('reports dry-run orphans from ledger and object snapshots', () => {
    const report = reportIssuePhotoOrphans({
      ledgerRows: [{ vin: 'TESTDATAHWELL0001', photos_json: JSON.stringify([{ id: photoA }]) }],
      objects: [
        { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoA), uploadedAt: '2026-01-01T00:00:00.000Z' },
        { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoB), uploadedAt: '2026-01-01T00:00:00.000Z' },
      ],
      graceHours: 0,
      now: new Date('2026-10-14T12:00:00.000Z'),
    })
    expect(report.orphans.map((row) => row.key)).toEqual([issuePhotoObjectKey('TESTDATAHWELL0001', photoB)])
  })

  it('keeps objects without a valid upload time out of deletion candidates', () => {
    const report = findIssuePhotoOrphans([
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoC) },
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoB), uploadedAt: 'not-a-date' },
    ], new Set(), { now: new Date('2026-10-14T12:00:00.000Z'), graceMs: 0 })

    expect(report.orphans).toEqual([])
    expect(report.needsReview).toEqual([
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoC), reason: 'missing_or_invalid_uploaded_at' },
      { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoB), reason: 'missing_or_invalid_uploaded_at' },
    ])
  })

  it('unwraps a Wrangler d1 --json ledger envelope before scanning references', () => {
    const key = issuePhotoObjectKey('TESTDATAHWELL0001', photoA)
    const rows = loadLedgerRows('photos.json', JSON.stringify([{
      success: true,
      results: [{ vin: 'TESTDATAHWELL0001', photos_json: JSON.stringify([{ id: photoA }]) }],
    }]))
    const report = reportIssuePhotoOrphans({
      ledgerRows: rows,
      objects: [
        { key, uploadedAt: '2026-01-01T00:00:00.000Z' },
        { key: issuePhotoObjectKey('TESTDATAHWELL0001', photoB), uploadedAt: '2026-01-01T00:00:00.000Z' },
      ],
      graceHours: 0,
      now: new Date('2026-10-14T12:00:00.000Z'),
    })
    expect(report.retained.map((row) => row.key)).toEqual([key])
    expect(report.orphans.map((row) => row.key)).toEqual([issuePhotoObjectKey('TESTDATAHWELL0001', photoB)])
  })

  it('rejects a malformed Wrangler ledger envelope instead of treating it as zero references', () => {
    expect(() => loadLedgerRows('photos.json', JSON.stringify([{ success: false, results: [] }]))).toThrow(/successful Wrangler result set/)
    expect(() => loadLedgerRows('photos.json', JSON.stringify([
      { success: true, results: [] },
      { success: true, results: [] },
    ]))).toThrow(/exactly one result set/)
  })
})
