// @ts-nocheck -- production Node ESM modules are tested against synthetic local evidence.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { normalizePublicChangeCounts } from '../../server/public-change-counts.mjs'
import { importerInternals, loadLatestCompletedRelease, sha256Buffer } from '../../server/importer.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'

const labelCounts = {
  'New Arrival': 0, Removed: 0, 'Price Change': 1, 'Mileage Change': 0,
  'Status Change': 0, 'Store Transfer': 0, 'VIN/Stock Correction': 0,
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function addPriorManifest(fixture, date, { complete = true, corruptHash = false, outsidePath = false } = {}) {
  const manifestPath = path.join(fixture.workspaceRoot, 'work', 'run-status', `${fixture.reportDate}.json`)
  const currentManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const currentPath = path.resolve(fixture.workspaceRoot, currentManifest.public_snapshot_path)
  const previous = JSON.parse(readFileSync(currentPath, 'utf8'))
  previous.report_date = date
  const vin = Object.keys(previous.vehicles)[0]
  previous.vehicles[vin].listed_price += 1000
  const snapshotPath = path.join(fixture.workspaceRoot, 'work', 'inventory-history', 'snapshots', `${date}-public-recovery-enriched.json`)
  writeJson(snapshotPath, previous)
  writeJson(path.join(fixture.workspaceRoot, 'work', 'run-status', `${date}.json`), {
    ...currentManifest,
    report_date: date,
    complete,
    public_snapshot_path: outsidePath ? path.resolve(fixture.workspaceRoot, '..', `${date}-outside.json`) : path.relative(fixture.workspaceRoot, snapshotPath),
    public_snapshot_sha256: corruptHash ? '0'.repeat(64) : sha256Buffer(readFileSync(snapshotPath)),
  })
  return { snapshotPath, vin }
}

function prepareCurrentManifest(fixture, counts = labelCounts) {
  const manifestPath = path.join(fixture.workspaceRoot, 'work', 'run-status', `${fixture.reportDate}.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.public_change_counts = { ...counts }
  writeJson(manifestPath, manifest)
  return { manifestPath, sourcePath: path.resolve(fixture.workspaceRoot, manifest.public_snapshot_path) }
}

function writeCurrentAudit(fixture, priorPath, overrides = {}) {
  const manifest = JSON.parse(readFileSync(path.join(fixture.workspaceRoot, 'work', 'run-status', `${fixture.reportDate}.json`), 'utf8'))
  const sourcePath = path.resolve(fixture.workspaceRoot, manifest.public_snapshot_path)
  const auditPath = path.join(fixture.workspaceRoot, 'work', 'inventory-history', 'snapshots', `${fixture.reportDate}-public-audit.json`)
  writeJson(auditPath, {
    report_date: fixture.reportDate,
    passed: true,
    snapshot: sourcePath,
    snapshot_sha256: sha256Buffer(readFileSync(sourcePath)),
    prior_snapshot: priorPath,
    prior_sha256: sha256Buffer(readFileSync(priorPath)),
    checks: { independent_change_reconciliation: true },
    ...overrides,
  })
  return auditPath
}

describe('certified public change counts', () => {
  it('reads report labels and legacy app keys as the same totals without modifying either input', () => {
    const snake = { new_arrival: 16, removed: 9, price_change: 17, mileage_change: 9, website_status_change: 7, stock_correction: 0, store_transfer: 0 }
    const labeled = { 'New Arrival': 16, Removed: 9, 'Price Change': 17, 'Mileage Change': 9, 'Status Change': 7, 'Stock Correction': 0, 'Store Transfer': 0, 'VIN/Stock Correction': 0 }
    const before = JSON.stringify(labeled)
    expect(normalizePublicChangeCounts(labeled)).toEqual({ counts: snake, issues: [], combinedCorrectionCount: 0 })
    expect(normalizePublicChangeCounts(snake).counts).toEqual(snake)
    expect(JSON.stringify(labeled)).toBe(before)
    expect(normalizePublicChangeCounts({ price_change: 3, 'Price Change': 3 }).counts.price_change).toBe(3)
  })

  it('flags conflicting aliases and invalid counts rather than selecting a convenient value', () => {
    const result = normalizePublicChangeCounts({ price_change: 3, 'Price Change': 4, removed: -1 })
    expect(result.counts.price_change).toBeNull()
    expect(result.counts.removed).toBeNull()
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/Conflicting.*price_change/), expect.stringMatching(/Invalid.*removed/),
    ]))
    expect(normalizePublicChangeCounts({ price_change: '3 units' }).counts.price_change).toBeNull()
  })

  it('preserves a combined correction total without inventing stock-only changes', () => {
    const result = normalizePublicChangeCounts({ 'VIN/Stock Correction': 3 })
    expect(result.combinedCorrectionCount).toBe(3)
    expect(result.counts.stock_correction).toBe(0)
    expect(result.issues).toContainEqual(expect.stringMatching(/requires separate event types/))
    expect(normalizePublicChangeCounts({ 'VIN/Stock Correction': 0, stock_correction: 1 }).issues)
      .toContainEqual(expect.stringMatching(/Conflicting public correction totals/))
    expect(normalizePublicChangeCounts({ 'VIN Correction': 2 }).issues)
      .toContainEqual(expect.stringMatching(/Unsupported public change category/))
  })
})

describe('manifest-bound public change baseline', () => {
  it('uses the explicit completed path through newer incomplete runs and returns labeled totals through the API', () => {
    const fixture = createSyntheticWorkspace()
    const database = openInventoryDatabase()
    try {
      const { manifestPath, sourcePath } = prepareCurrentManifest(fixture)
      const baseline = addPriorManifest(fixture, '2026-08-28')
      addPriorManifest(fixture, '2026-08-29', { complete: false })
      const originalBytes = [manifestPath, sourcePath, baseline.snapshotPath].map((file) => readFileSync(file))
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00-04:00') })
      expect(release.sourceRuns.public.metadata.changeBaseline).toMatchObject({ reportDate: '2026-08-28', snapshotPath: baseline.snapshotPath })
      expect(release.publicChangeEvents).toHaveLength(1)
      expect(release.publicChangeEvents[0]).toMatchObject({ type: 'price_change', vin: baseline.vin })
      expect(release.warnings.join(' ')).not.toMatch(/did not reconcile/)
      importRelease(database, release, { loadedAt: '2026-08-30T19:00:00.000Z' })
      const service = createInventoryService({ database, now: () => new Date('2026-08-30T15:00:00-04:00') })
      const meta = service.bootstrap({ role: 'sales', store: 'Howell', user: 'Synthetic Salesperson' }).meta
      expect(meta.publicChangeCounts.priceChange).toBe(1)
      expect(meta.publicChangeBaselineDate).toBe('2026-08-28')
      for (const [index, file] of [manifestPath, sourcePath, baseline.snapshotPath].entries()) {
        expect(readFileSync(file)).toEqual(originalBytes[index])
      }
    } finally {
      database.close()
      fixture.cleanup()
    }
  })

  it.each([{ corruptHash: true }, { outsidePath: true }])('rejects an altered or out-of-workspace prior reference: %j', (failure) => {
    const fixture = createSyntheticWorkspace()
    try {
      const older = addPriorManifest(fixture, '2026-08-28')
      addPriorManifest(fixture, '2026-08-29', failure)
      const found = importerInternals.findPreviousCompletedPublicSnapshot(fixture.workspaceRoot, fixture.reportDate)
      expect(found.snapshotPath).toBe(older.snapshotPath)
    } finally { fixture.cleanup() }
  })

  it('does not bypass existing incomplete manifests by selecting a loose completed snapshot', () => {
    const fixture = createSyntheticWorkspace()
    try {
      addPriorManifest(fixture, '2026-08-29', { complete: false })
      expect(importerInternals.findPreviousCompletedPublicSnapshot(fixture.workspaceRoot, fixture.reportDate)).toBeNull()
    } finally { fixture.cleanup() }
  })

  it('retains aggregate evidence but blocks detailed events when category aliases conflict', () => {
    const fixture = createSyntheticWorkspace()
    try {
      prepareCurrentManifest(fixture, { ...labelCounts, price_change: 2 })
      addPriorManifest(fixture, '2026-08-28')
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00-04:00') })
      expect(release.publicChangeEvents).toEqual([])
      expect(release.manifest.public_change_counts).toMatchObject({ 'Price Change': 1, price_change: 2 })
      expect(release.warnings).toContainEqual(expect.stringMatching(/Conflicting public change totals/))
    } finally { fixture.cleanup() }
  })

  it('binds to the exact audited prior hash even when another completed baseline has identical change counts', () => {
    const fixture = createSyntheticWorkspace()
    try {
      prepareCurrentManifest(fixture)
      const certified = addPriorManifest(fixture, '2026-08-28')
      addPriorManifest(fixture, '2026-08-29')
      writeCurrentAudit(fixture, certified.snapshotPath)
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00-04:00') })
      expect(release.publicChangeEvents).toHaveLength(1)
      expect(release.sourceRuns.public.metadata.changeBaseline).toMatchObject({
        reportDate: '2026-08-28', snapshotPath: certified.snapshotPath,
        audit: { expectedPriorSha256: sha256Buffer(readFileSync(certified.snapshotPath)) },
      })
    } finally { fixture.cleanup() }
  })

  it('can use a source-complete prior from a CRM-incomplete run when the current audit certifies those exact bytes', () => {
    const fixture = createSyntheticWorkspace()
    try {
      prepareCurrentManifest(fixture)
      addPriorManifest(fixture, '2026-08-28')
      const certified = addPriorManifest(fixture, '2026-08-29', { complete: false })
      // The historic latest pointer has advanced; resolve the hash in dated files.
      writeCurrentAudit(fixture, certified.snapshotPath, { prior_snapshot: path.join(fixture.workspaceRoot, 'work', 'inventory-history', 'latest.json') })
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00-04:00') })
      expect(release.sourceRuns.public.metadata.changeBaseline.reportDate).toBe('2026-08-29')
      expect(release.publicChangeEvents).toHaveLength(1)
    } finally { fixture.cleanup() }
  })

  it('withholds events when the audited prior is missing instead of substituting a count-coincident complete snapshot', () => {
    const fixture = createSyntheticWorkspace()
    try {
      prepareCurrentManifest(fixture)
      const certified = addPriorManifest(fixture, '2026-08-28')
      addPriorManifest(fixture, '2026-08-29')
      writeCurrentAudit(fixture, certified.snapshotPath)
      unlinkSync(certified.snapshotPath)
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00-04:00') })
      expect(release.publicChangeEvents).toEqual([])
      expect(release.sourceRuns.public.metadata.changeBaseline).toBeNull()
      expect(release.warnings).toContainEqual(expect.stringMatching(/exact prior public snapshot.*unavailable/))
    } finally { fixture.cleanup() }
  })

  it('rejects a same-date audit copied from different current snapshot bytes', () => {
    const fixture = createSyntheticWorkspace()
    try {
      prepareCurrentManifest(fixture)
      const certified = addPriorManifest(fixture, '2026-08-29')
      writeCurrentAudit(fixture, certified.snapshotPath, { snapshot_sha256: '0'.repeat(64) })
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00-04:00') })
      expect(release.publicChangeEvents).toEqual([])
      expect(release.warnings).toContainEqual(expect.stringMatching(/audit does not validate/))
    } finally { fixture.cleanup() }
  })
})
