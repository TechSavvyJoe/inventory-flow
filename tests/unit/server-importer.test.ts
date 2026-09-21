// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { cloudReleaseFrom } from '../../scripts/publish-cloud-release.mjs'
import { importRelease, openInventoryDatabase } from '../../server/database.mjs'
import { createInventoryService } from '../../server/service.mjs'
import {
  findLatestCompletedManifest,
  hasCompletedManifestEvidence,
  loadLatestCompletedRelease,
  mergeVerifiedPhotoCache,
  normalizeDealerMailSnapshotForImport,
  sha256Buffer,
  validateVinDocumentEnrichment,
  validateVinDocumentEnrichmentForPublish,
  validateDealerMailSnapshot,
  validatePublicSnapshot,
} from '../../server/importer.mjs'

function releasedHistoryFor(row) {
  return {
    vin: row.vin,
    stockNumber: row.stockNumber,
    store: { name: row.storeName, code: row.storeCode },
    sourceUrl: `https://www.dealermail.com/prospect_manager/V2_inventory_USED_hold_edit.asp?s=${encodeURIComponent(row.stockNumber)}`,
    observedAtUtc: '2026-08-30T14:00:00Z',
    currentLiveHold: false,
    holdDetailRows: [{
      stockNumber: row.stockNumber,
      sourceStockNumber: row.stockNumber,
      orderRaw: '1',
      holdOrderNumber: 1,
      holdPosition: 'primary',
      lifecycleStatus: 'active',
    }],
  }
}

const dealerMailStoreMap = {
  D: { storeId: '25', storeName: 'Ford Detroit' },
  H: { storeId: '26', storeName: 'Howell' },
  L: { storeId: '27', storeName: 'Lincoln' },
  F: { storeId: '95', storeName: 'Fowlerville' },
}

function crmStoreCounts(records) {
  return Object.fromEntries(
    Object.values(dealerMailStoreMap).map(({ storeName }) => [
      storeName,
      records.filter((row) => row.storeName === storeName).length,
    ]),
  )
}

function makeDealerMailSnapshotCloudReady(snapshot) {
  const included = snapshot.completeDealerMailUsedInventory.rows
  const heldVins = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
  for (const row of included) {
    row.rawCellInnerText = Array(22).fill('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS')
    row.rawCellControlValues = Array.from({ length: 22 }, () => [])
    row.holdStateFromRowClass = heldVins.has(row.vin) ? 'active_hold' : 'no_current_hold_found'
  }
  const excluded = included.filter((row) => !heldVins.has(row.vin))
  snapshot.excludeActiveHoldsValidationSet = {
    readOnly: true,
    rows: excluded,
    summary: {
      totalRows: excluded.length,
      uniqueVinCount: excluded.length,
      uniqueStockCount: excluded.length,
      byStore: crmStoreCounts(excluded),
    },
  }
  snapshot.completeInventorySetValidation.activeHoldDifferenceRows = included
    .filter((row) => heldVins.has(row.vin))
    .map(({ vin, stockNumber, storeName, storeCode }) => ({ vin, stockNumber, storeName, storeCode }))
  snapshot.crmInventoryControlValidation = {
    completeInventoryRowsIncludingHolds: included.length,
    inventoryRowsExcludingHolds: excluded.length,
    activeHoldVINsRemovedByExcludeFilter: heldVins.size,
    excludeFilterRemovedExactlyTheActiveHoldSet: true,
    includingHoldsByStore: crmStoreCounts(included),
    excludingHoldsByStore: crmStoreCounts(excluded),
    lotReadyOnlyRowsIncludingHolds: included.length,
    lotReadyOnlyVINSetEqualsAllVehiclesVINSet: true,
  }
  for (const held of snapshot.vehicles) {
    for (const detail of held.holdDetailRows) detail.orderRaw = String(detail.holdOrderNumber)
  }
  return snapshot
}

function quarantineUnheldCrmSourceRow(snapshot, sourceVin = 'TESTDATAQWELL0002') {
  const heldVins = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
  const cdkVins = new Set((snapshot.cdkReadOnlyLookup?.records ?? []).map((record) => record.vin))
  const row = snapshot.completeDealerMailUsedInventory.rows.find(
    (candidate) => !heldVins.has(candidate.vin) && !cdkVins.has(candidate.vin),
  )
  if (!row) throw new Error('Synthetic fixture has no unheld CRM row available for VIN quarantine')
  const originalVin = row.vin
  const stockNumber = row.stockNumber
  row.vin = sourceVin
  const excluded = snapshot.excludeActiveHoldsValidationSet?.rows?.find(
    (candidate) => candidate.stockNumber === stockNumber,
  )
  if (excluded) excluded.vin = sourceVin
  snapshot.completeInventorySetValidation.validation.allVinFormatValid = false
  return { originalVin, sourceVin, stockNumber }
}

describe('verified daily source importer', () => {
  it('preserves a bounded source-VIN exception while excluding it from normalized VIN workflows', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      makeDealerMailSnapshotCloudReady(snapshot)
      const exception = quarantineUnheldCrmSourceRow(snapshot)
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      const release = loadLatestCompletedRelease({
        workspaceRoot: fixture.workspaceRoot,
        now: new Date(`${fixture.reportDate}T15:00:00-04:00`),
      })

      expect(release.dealerMailSnapshot.completeDealerMailUsedInventory.rows).toHaveLength(8)
      expect(release.dealerMailSnapshot.completeDealerMailUsedInventory.rows).toContainEqual(
        expect.objectContaining({ vin: exception.sourceVin, stockNumber: exception.stockNumber }),
      )
      expect(release.sourceRuns.dealerMail).toMatchObject({
        rowCount: 8,
        metadata: {
          vinQuarantine: {
            count: 1,
            stocks: [exception.stockNumber],
            sourceRowCount: 8,
            vinReconciledRowCount: 7,
            excludedFromVinWorkflows: true,
          },
        },
      })
      expect(release.warnings.join(' ')).toContain(exception.stockNumber)
      expect(release.vehicles.some((vehicle) => vehicle.vin === exception.sourceVin)).toBe(false)
      expect(release.vehicles.find((vehicle) => vehicle.vin === exception.originalVin)?.crmRecord).toBeNull()
      expect(release.vehicles.every((vehicle) => /^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.vin))).toBe(true)

      const cloudCounts = validateReleaseBundle(cloudReleaseFrom(release))
      expect(cloudCounts).toMatchObject({
        dealerMailRowCount: 8,
        dealerMailVinReconciledCount: 7,
        dealerMailVinReviewCount: 1,
        dealerMailVinReviewStocks: [exception.stockNumber],
      })

      const database = openInventoryDatabase()
      try {
        importRelease(database, release, { loadedAt: `${fixture.reportDate}T19:00:00.000Z` })
        const service = createInventoryService({
          database,
          now: () => new Date(`${fixture.reportDate}T15:00:00-04:00`),
        })
        expect(service.health().counts.crm).toBe(8)
        expect(service.bootstrap({ role: 'sales', store: 'Howell', user: 'Synthetic Salesperson' }).meta.crmCount).toBe(8)
      } finally {
        database.close()
      }
    } finally { fixture.cleanup() }
  })

  it.each(['testdataqwell0002', 'SHORT', 'TEST-DATA-QWELL02'])('rejects a noncanonical CRM source VIN token: %s', (sourceVin) => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      makeDealerMailSnapshotCloudReady(snapshot)
      quarantineUnheldCrmSourceRow(snapshot, sourceVin)
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /invalid source VIN token/,
      )
    } finally { fixture.cleanup() }
  })

  it('requires the source allVinFormatValid flag to match the quarantine result', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      makeDealerMailSnapshotCloudReady(snapshot)
      quarantineUnheldCrmSourceRow(snapshot)
      snapshot.completeInventorySetValidation.validation.allVinFormatValid = true
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /VIN-format validation does not reconcile/,
      )
    } finally { fixture.cleanup() }
  })

  it('normalizes an exact legacy released-history store code without mutating its source file', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      makeDealerMailSnapshotCloudReady(snapshot)
      const heldVins = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
      const unheld = snapshot.completeDealerMailUsedInventory.rows.find((row) => !heldVins.has(row.vin))
      const history = releasedHistoryFor(unheld)
      history.store = unheld.storeCode
      snapshot.storeMap = dealerMailStoreMap
      snapshot.releasedHoldHistory = [history]
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      const sourceBeforeImport = readFileSync(dealerMailPath)

      const release = loadLatestCompletedRelease({
        workspaceRoot: fixture.workspaceRoot,
        now: new Date(`${fixture.reportDate}T15:00:00-04:00`),
      })

      expect(release.dealerMailSnapshot.releasedHoldHistory[0].store).toEqual({
        name: unheld.storeName,
        code: unheld.storeCode,
      })
      expect(release.releasedHoldHistory).toEqual(release.dealerMailSnapshot.releasedHoldHistory)
      expect(release.warnings).toContain(
        'Legacy released-hold store codes were normalized in memory; the certified source file, checksum, and byte count were not changed.',
      )
      expect(release.sourceRuns.dealerMail.metadata.compatibilityNormalization).toEqual({
        applied: true,
        field: 'releasedHoldHistory.store',
        mode: 'in_memory_non_mutating',
        originalSourceSha256: sha256Buffer(sourceBeforeImport),
        originalSourceBytes: sourceBeforeImport.byteLength,
      })
      const cloudBundle = cloudReleaseFrom(release)
      expect(cloudBundle.release.releasedHoldHistory).toEqual(
        cloudBundle.release.dealerMailSnapshot.releasedHoldHistory,
      )
      expect(validateReleaseBundle(cloudBundle)).toMatchObject({ reportDate: fixture.reportDate })
      expect(JSON.parse(readFileSync(dealerMailPath, 'utf8')).releasedHoldHistory[0].store).toBe(unheld.storeCode)
      expect(readFileSync(dealerMailPath).equals(sourceBeforeImport)).toBe(true)
    } finally { fixture.cleanup() }
  })

  it('normalizes a known legacy store code when the released VIN and stock are absent from current CRM', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const history = releasedHistoryFor({
        vin: 'TESTDATASYN000009',
        stockNumber: 'LEGACY1',
        storeName: 'Howell',
        storeCode: 'H',
      })
      history.store = 'H'
      snapshot.storeMap = dealerMailStoreMap
      snapshot.releasedHoldHistory = [history]
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })

      expect(release.dealerMailSnapshot.releasedHoldHistory[0].store).toEqual({ name: 'Howell', code: 'H' })
    } finally { fixture.cleanup() }
  })

  it('rejects absent released VIN history when its stock belongs to another current CRM VIN', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const current = snapshot.completeDealerMailUsedInventory.rows[0]
      const history = releasedHistoryFor({
        vin: 'TESTDATASYN000009',
        stockNumber: current.stockNumber,
        storeName: current.storeName,
        storeCode: current.storeCode,
      })
      history.store = current.storeCode
      snapshot.storeMap = dealerMailStoreMap
      snapshot.releasedHoldHistory = [history]
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /Legacy released hold history stock is currently assigned to a different CRM VIN/,
      )
    } finally { fixture.cleanup() }
  })

  it('rejects a legacy released-history wrapper for a VIN still in the live held set', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const held = snapshot.vehicles[0]
      const current = snapshot.completeDealerMailUsedInventory.rows.find((row) => row.vin === held.mainRow.vin)
      const history = releasedHistoryFor(current)
      history.store = current.storeCode
      snapshot.storeMap = dealerMailStoreMap
      snapshot.releasedHoldHistory = [history]
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /Legacy released hold history VIN is still in the live held set/,
      )
    } finally { fixture.cleanup() }
  })

  it.each([
    ['unknown code', () => 'X'],
    ['lowercase code', (row) => row.storeCode.toLowerCase()],
    ['whitespace-padded code', (row) => ` ${row.storeCode} `],
    ['code mismatched to the current CRM row', (row) => row.storeCode === 'D' ? 'H' : 'D'],
  ])('fails closed for a legacy released-history %s', (_label, legacyCode) => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const snapshot = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const heldVins = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
      const unheld = snapshot.completeDealerMailUsedInventory.rows.find((row) => !heldVins.has(row.vin))
      const history = releasedHistoryFor(unheld)
      history.store = legacyCode(unheld)
      snapshot.storeMap = dealerMailStoreMap
      snapshot.releasedHoldHistory = [history]
      writeFileSync(dealerMailPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /Legacy released hold history store code does not match current CRM and snapshot store-map evidence/,
      )
    } finally { fixture.cleanup() }
  })

  it('rejects a tampered snapshot store map and does not repair an invalid canonical store object', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const base = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const heldVins = new Set(base.vehicles.map((vehicle) => vehicle.mainRow.vin))
      const unheld = base.completeDealerMailUsedInventory.rows.find((row) => !heldVins.has(row.vin))

      const tamperedMap = structuredClone(base)
      const legacyHistory = releasedHistoryFor(unheld)
      legacyHistory.store = unheld.storeCode
      tamperedMap.storeMap = structuredClone(dealerMailStoreMap)
      tamperedMap.storeMap[unheld.storeCode].storeName = 'Lincoln'
      tamperedMap.releasedHoldHistory = [legacyHistory]
      writeFileSync(dealerMailPath, `${JSON.stringify(tamperedMap, null, 2)}\n`, 'utf8')
      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /Legacy released hold history store code does not match current CRM and snapshot store-map evidence/,
      )

      const invalidCanonical = structuredClone(base)
      const canonicalHistory = releasedHistoryFor(unheld)
      canonicalHistory.store = { name: unheld.storeName, code: unheld.storeCode === 'D' ? 'H' : 'D' }
      invalidCanonical.storeMap = dealerMailStoreMap
      invalidCanonical.releasedHoldHistory = [canonicalHistory]
      writeFileSync(dealerMailPath, `${JSON.stringify(invalidCanonical, null, 2)}\n`, 'utf8')
      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(
        /Released hold history CRM store\/code is invalid/,
      )
    } finally { fixture.cleanup() }
  })

  it('normalizes a mixed legacy snapshot atomically with no nested aliases to source evidence', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const dealerMailPath = path.join(
        fixture.workspaceRoot,
        'work',
        'dealermail',
        `${fixture.reportDate}.json`,
      )
      const source = JSON.parse(readFileSync(dealerMailPath, 'utf8'))
      const heldVins = new Set(source.vehicles.map((vehicle) => vehicle.mainRow.vin))
      const unheld = source.completeDealerMailUsedInventory.rows.find((row) => !heldVins.has(row.vin))
      const canonical = releasedHistoryFor(unheld)
      const legacy = releasedHistoryFor({
        vin: 'TESTDATASYN000009',
        stockNumber: 'LEGACY1',
        storeName: 'Howell',
        storeCode: 'H',
      })
      legacy.store = 'H'
      source.storeMap = dealerMailStoreMap
      source.releasedHoldHistory = [canonical, legacy]
      const sourceBefore = structuredClone(source)

      const normalized = normalizeDealerMailSnapshotForImport(source)

      expect(source).toEqual(sourceBefore)
      expect(normalized).not.toBe(source)
      expect(normalized.completeDealerMailUsedInventory).not.toBe(source.completeDealerMailUsedInventory)
      expect(normalized.completeDealerMailUsedInventory.rows[0]).not.toBe(source.completeDealerMailUsedInventory.rows[0])
      expect(normalized.releasedHoldHistory[0]).not.toBe(source.releasedHoldHistory[0])
      expect(normalized.releasedHoldHistory[1].holdDetailRows).not.toBe(source.releasedHoldHistory[1].holdDetailRows)
      expect(normalized.releasedHoldHistory[1].store).toEqual({ name: 'Howell', code: 'H' })

      const invalidMixed = structuredClone(source)
      invalidMixed.releasedHoldHistory[1].store = ' H '
      const invalidBefore = structuredClone(invalidMixed)
      expect(() => normalizeDealerMailSnapshotForImport(invalidMixed)).toThrow(/store code does not match/)
      expect(invalidMixed).toEqual(invalidBefore)
    } finally { fixture.cleanup() }
  })

  it('requires every flagged CRM message once complete-inventory evidence is supplied', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })
      const snapshot = structuredClone(release.dealerMailSnapshot)
      const held = new Map(snapshot.vehicles.map((vehicle) => [vehicle.mainRow.vin, vehicle]))
      for (const row of snapshot.completeDealerMailUsedInventory.rows) {
        row.comments = held.get(row.vin)?.comments ?? []
        row.alerts = held.get(row.vin)?.alerts ?? []
      }
      const unheld = snapshot.completeDealerMailUsedInventory.rows.find((row) => !held.has(row.vin))
      unheld.commentsFlag = 'Y'
      unheld.alertsFlag = 'Y'
      unheld.comments = [{ rows: [{ commentTextRaw: 'Synthetic unheld inspection note' }] }]
      unheld.alerts = [{ alertTextRaw: 'Synthetic unheld alert' }]
      snapshot.releasedHoldHistory = [releasedHistoryFor(unheld)]
      expect(validateDealerMailSnapshot(snapshot).heldVinCount).toBe(held.size)
      unheld.alerts = []
      expect(() => validateDealerMailSnapshot(snapshot)).toThrow(/inventory alert is missing/)
      unheld.alerts = [{ alertTextRaw: 'Synthetic unheld alert' }]
      snapshot.releasedHoldHistory[0].vin = snapshot.vehicles[0].mainRow.vin
      expect(() => validateDealerMailSnapshot(snapshot)).toThrow(/currently held/)
    } finally { fixture.cleanup() }
  })

  it('fails closed when complete-CRM flags or all message evidence arrays are stripped', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const validSnapshot = structuredClone(loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot }).dealerMailSnapshot)
      const missingFlags = structuredClone(validSnapshot)
      for (const row of missingFlags.completeDealerMailUsedInventory.rows) {
        delete row.commentsFlag
        delete row.alertsFlag
      }
      expect(() => validateDealerMailSnapshot(missingFlags)).toThrow(/commentsFlag must be Y or N/)

      const snapshot = structuredClone(validSnapshot)
      delete snapshot.currentComments
      delete snapshot.currentAlerts
      for (const row of snapshot.completeDealerMailUsedInventory.rows) {
        delete row.comments
        delete row.alerts
        delete row.commentsFlag
        delete row.alertsFlag
      }
      expect(() => validateDealerMailSnapshot(snapshot)).toThrow(/top-level current comment\/alert evidence arrays are missing/)
    } finally { fixture.cleanup() }
  })

  it.each([
    ['wrapper stock', (history) => { history.stockNumber = 'WRONG-STOCK' }],
    ['wrapper store', (history) => { history.store = { name: 'Lincoln', code: 'L' } }],
    ['nested detail stock', (history) => { history.holdDetailRows[0].stockNumber = 'WRONG-STOCK' }],
    ['nested source stock', (history) => { history.holdDetailRows[0].sourceStockNumber = 'WRONG-STOCK' }],
    ['source URL stock', (history) => { history.sourceUrl = 'https://www.dealermail.com/prospect_manager/V2_inventory_USED_hold_edit.asp?s=WRONG-STOCK' }],
  ])('rejects released history with a mismatched %s', (_label, mutate) => {
    const fixture = createSyntheticWorkspace()
    try {
      const snapshot = structuredClone(loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot }).dealerMailSnapshot)
      const held = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
      const unheld = snapshot.completeDealerMailUsedInventory.rows.find((row) => !held.has(row.vin))
      const history = releasedHistoryFor(unheld)
      mutate(history)
      snapshot.releasedHoldHistory = [history]
      expect(() => validateDealerMailSnapshot(snapshot)).toThrow(/released hold history/i)
    } finally { fixture.cleanup() }
  })

  it('requires HTTPS public listing URLs locally', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })
      const insecure = structuredClone(release.publicSnapshot)
      const row = Object.values(insecure.vehicles)[0]
      row.listing_url = row.listing_url.replace('https://', 'http://')
      expect(() => validatePublicSnapshot(insecure)).toThrow(/must use HTTPS/)
      row.listing_url = `javascript:${row.vin}`
      expect(() => validatePublicSnapshot(insecure)).toThrow(/must use HTTPS/)
    } finally { fixture.cleanup() }
  })

  it('fails release loading before bootstrap when an existing resource package or URL is malformed', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const enrichmentPath = path.join(fixture.workspaceRoot, 'apps', 'inventory-ops', 'data', 'vin-document-enrichment.json')
      const original = JSON.parse(readFileSync(enrichmentPath, 'utf8'))
      const vin = Object.keys(original.recordsByVin)[0]
      const malformedPackage = structuredClone(original)
      malformedPackage.recordsByVin[vin].factoryEquipment.packages = [{ name: 'Broken package', features: 'not-an-array' }]
      writeFileSync(enrichmentPath, JSON.stringify(malformedPackage))
      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(/package features.*bounded array/)

      const javascriptUrl = structuredClone(original)
      javascriptUrl.recordsByVin[vin].factoryEquipment.url = 'javascript:alert(1)'
      writeFileSync(enrichmentPath, JSON.stringify(javascriptUrl))
      expect(() => loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot })).toThrow(/approved vAuto\/CAI/)
    } finally { fixture.cleanup() }
  })

  it('retains the current completion_time manifest alias for cloud release ordering', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const { manifest } = findLatestCompletedManifest(fixture.workspaceRoot)
      const completion = `${manifest.report_date}T10:42:00-04:00`
      delete manifest.completed_at
      manifest.completion_time = completion
      writeFileSync(path.join(fixture.workspaceRoot, 'work', 'run-status', `${manifest.report_date}.json`), JSON.stringify(manifest))
      const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date(`${manifest.report_date}T18:00:00-04:00`) })
      expect(release.completedAt).toBe(completion)
    } finally { fixture.cleanup() }
  })
  it('accepts both legacy and authenticated read-only completion contracts without weakening validation', () => {
    expect(hasCompletedManifestEvidence({
      complete: true,
      public_inventory_status: 'complete',
      dealermail_status: 'complete',
      validation_results: { passed: true },
    })).toBe(true)

    const currentContract = {
      complete: true,
      public_inventory_status: 'complete',
      dealermail_status: 'complete_authenticated_read_only',
      validation_results: {
        public_sources_complete: true,
        dealermail_complete: true,
        workbook_validated: true,
        desktop_excel_opened_without_repair: true,
        formula_errors: 0,
        read_only_validation_hash_unchanged: true,
        macro_free: true,
      },
    }
    expect(hasCompletedManifestEvidence(currentContract)).toBe(true)
    expect(hasCompletedManifestEvidence({
      ...currentContract,
      validation_results: {
        ...currentContract.validation_results,
        desktop_excel_opened_without_repair: undefined,
        desktop_excel_opened_without_repair_prompt: true,
        read_only_validation_hash_unchanged: undefined,
        published_hash_unchanged_after_read_only_tests: true,
      },
    })).toBe(true)
    expect(hasCompletedManifestEvidence({
      ...currentContract,
      validation_results: { ...currentContract.validation_results, dealermail_complete: false },
    })).toBe(false)
  })

  it('merges only a photo cache bound to the exact release hash, VIN, and listing URL', () => {
    const vin = 'TESTDATASYN000005'
    const snapshotSha256 = 'A'.repeat(64)
    const listingUrl = `https://www.bobmaxeyfordhowell.com/used-Howell-test-${vin}`
    const photoUrl = `https://www.bobmaxeyfordhowell.com/inventoryphotos/11801/${vin.toLowerCase()}/ip/1.jpg`
    const recordsByVin = {
      [vin]: { vin, store: 'Howell', listing_url: listingUrl },
    }
    const cache = {
      schema_version: 'inventory-ops-photo-cache-v1',
      report_date: '2026-08-29',
      public_snapshot_sha256: snapshotSha256,
      generated_at: '2026-08-30T00:00:00Z',
      summary: { public_vehicles: 1, vehicles_with_photos: 1, photo_urls: 1 },
      vehicles: {
        [vin]: {
          vin,
          listing_url: listingUrl,
          photo_preview_url: null,
          photo_urls: [photoUrl],
        },
      },
    }

    const merged = mergeVerifiedPhotoCache({
      recordsByVin,
      cache,
      reportDate: '2026-08-29',
      publicSnapshotSha256: snapshotSha256,
    })
    expect(merged.recordsByVin[vin].photo_urls).toEqual([photoUrl])
    expect(merged.metadata).toMatchObject({ status: 'matched', vehiclesWithPhotos: 1, photoUrls: 1 })

    expect(() =>
      mergeVerifiedPhotoCache({
        recordsByVin,
        cache: { ...cache, public_snapshot_sha256: 'B'.repeat(64) },
        reportDate: '2026-08-29',
        publicSnapshotSha256: snapshotSha256,
      }),
    ).toThrow(/source hash/i)
    expect(() =>
      mergeVerifiedPhotoCache({
        recordsByVin,
        cache: {
          ...cache,
          vehicles: {
            [vin]: { ...cache.vehicles[vin], photo_urls: [photoUrl.replace('www.bobmaxeyfordhowell.com', 'evil.example')] },
          },
        },
        reportDate: '2026-08-29',
        publicSnapshotSha256: snapshotSha256,
      }),
    ).toThrow(/unsafe|mismatched/i)
  })

  it('merges VIN-validated AutoCheck and window-sticker facts from the v2 resource cache', () => {
    const vin = 'TESTDATASYN000005'
    const snapshotSha256 = 'C'.repeat(64)
    const listingUrl = `https://www.bobmaxeyfordhowell.com/used-Howell-test-${vin}`
    const cache = {
      schema_version: 'inventory-ops-vehicle-resource-cache-v2',
      report_date: '2026-08-30',
      public_snapshot_sha256: snapshotSha256,
      generated_at: '2026-08-30T13:00:00Z',
      summary: {
        public_vehicles: 1,
        vehicles_with_resources: 1,
        vehicles_with_photos: 0,
        vehicles_with_autocheck: 1,
        vehicles_with_window_sticker: 1,
        photo_urls: 0,
      },
      vehicles: {
        [vin]: {
          vin,
          listing_url: listingUrl,
          photo_preview_url: null,
          photo_urls: [],
          autoCheckReport: {
            url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token',
            dataState: 'current',
            validated_vin: vin,
            reportRunAt: '08/30/2026 09:00:00 EDT',
            score: 91,
            scoreRangeLow: 86,
            scoreRangeHigh: 92,
            usage: 'Personal',
            ownerCount: 2,
            recentInspection: { date: '2026-08-30', types: ['Vehicle Inspected'] },
            lastReportedOdometer: 12345,
            lastReportedOdometerDate: '2026-02-03',
            vehicleClass: 'CUV - Small',
            assemblyCountry: 'United States',
            estimatedInServiceDate: '2025-01-02',
            checks: [{ label: 'Accident / Damage', status: 'No Issue', detail: 'No accidents reported' }],
          },
          windowSticker: {
            url:
              'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U&dealerCode=',
            dataState: 'incomplete',
            validated_vin: vin,
            vehicleDescription: '2025 ESCAPE ST-LINE AWD',
            equipmentGroup: '300A',
            equipmentGroupContents: ['Synthetic included feature'], equipmentGroupPrice: 1250.75,
            basePrice: 32585,
            totalOptions: 995,
            destinationCharge: 1495,
            totalMsrp: 35075,
            originalMarket: 'Canada',
            pricingCurrency: 'CAD',
            pricingCurrencyEvidence: 'Canadian original sticker; amounts retained without conversion',
            exteriorColor: 'Carbonized Gray Metallic',
            interiorColor: 'Ebony ActiveX',
            engine: '1.5L EcoBoost',
            transmission: '8-Speed Automatic',
            options: ['Cold Weather Package — $995.00'],
            standardEquipment: ['Exterior: LED headlamps'],
            warranty: ['3YR/36,000 bumper-to-bumper'],
          },
        },
      },
    }

    const merged = mergeVerifiedPhotoCache({
      recordsByVin: { [vin]: { vin, store: 'Howell', listing_url: listingUrl } },
      cache,
      reportDate: '2026-08-30',
      publicSnapshotSha256: snapshotSha256,
    })

    expect(merged.recordsByVin[vin].windowSticker).toMatchObject({ equipmentGroupContents: ['Synthetic included feature'], equipmentGroupPrice: 1250.75 })
    expect(merged.recordsByVin[vin].autoCheckReport).toMatchObject({
      score: 91,
      ownerCount: 2,
      recentInspection: { date: '2026-08-30', types: ['Vehicle Inspected'] },
      dataState: 'current',
    })
    expect(merged.recordsByVin[vin].autoCheckReport.validated_vin).toBeUndefined()
    expect(merged.recordsByVin[vin].windowSticker).toMatchObject({
      equipmentGroup: '300A',
      totalMsrp: 35075,
      originalMarket: 'Canada',
      pricingCurrency: 'CAD',
      pricingCurrencyEvidence: 'Canadian original sticker; amounts retained without conversion',
      dataState: 'incomplete',
    })
    expect(merged.metadata).toMatchObject({
      status: 'matched',
      vehiclesWithResources: 1,
      vehiclesWithPhotos: 0,
      vehiclesWithAutoCheck: 1,
      vehiclesWithWindowSticker: 1,
    })

    expect(() =>
      mergeVerifiedPhotoCache({
        recordsByVin: { [vin]: { vin, store: 'Howell', listing_url: listingUrl } },
        cache: {
          ...cache,
          vehicles: {
            [vin]: {
              ...cache.vehicles[vin],
              autoCheckReport: { ...cache.vehicles[vin].autoCheckReport, validated_vin: 'TESTDATASYN000007' },
            },
          },
        },
        reportDate: '2026-08-30',
        publicSnapshotSha256: snapshotSha256,
      }),
    ).toThrow(/exact-VIN/i)
  })

  it('validates exact-VIN factory equipment independently from public listings', () => {
    const vin = 'TESTDATASYN000008'
    const enrichment = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1',
      generatedAt: '2026-08-30T14:00:00Z',
      recordsByVin: {
        [vin]: {
          vin,
          factoryEquipment: {
            dataState: 'current',
            url: 'https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg',
            sourceLabel: 'vAuto / CAI informational equipment label',
            capturedAt: '2026-08-30T09:30:00-04:00',
            vehicleDescription: '2024 Chevrolet Silverado 1500 RST Crew Cab Short Bed 1SP',
            basePrice: 54700,
            totalOptions: 9665,
            destinationCharge: 1995,
            totalMsrp: 66360,
            exteriorColor: 'Glacier Blue Metallic (GLT)',
            interiorColor: 'Jet Black (H0Y)',
            engine: '5.3L V8',
            transmission: '10-Speed Automatic',
            drivetrain: 'Four-Wheel Drive',
            packages: [{ name: 'SAFETY PACKAGE', code: 'PQB', features: ['Blind Spot Monitor'] }],
            sections: [{ name: 'Safety & Security', items: [{ label: 'Front Collision Warning' }] }],
            disclaimer: 'Provided for information purposes only, this is not the actual Monroney label.',
            isOriginalWindowSticker: false,
          },
        },
      },
    }

    const validated = validateVinDocumentEnrichment(enrichment)
    expect(validated.recordsByVin[vin].factoryEquipment).toMatchObject({
      dataState: 'current',
      totalMsrp: 66360,
      drivetrain: 'Four-Wheel Drive',
      isOriginalWindowSticker: false,
    })
    expect(validated.metadata).toMatchObject({
      recordCount: 1,
      factoryEquipmentCount: 1,
      externalAutoCheckCount: 0,
    })

    const unsafeHost = structuredClone(enrichment)
    unsafeHost.recordsByVin[vin].factoryEquipment.url =
      'https://evil.example/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.jpg'
    expect(() => validateVinDocumentEnrichment(unsafeHost)).toThrow(/approved vAuto\/CAI/i)

    const unsafeQuery = structuredClone(enrichment)
    unsafeQuery.recordsByVin[vin].factoryEquipment.url += '?download=1'
    expect(() => validateVinDocumentEnrichment(unsafeQuery)).toThrow(/approved vAuto\/CAI/i)

    const mislabeled = structuredClone(enrichment)
    mislabeled.recordsByVin[vin].factoryEquipment.isOriginalWindowSticker = true
    expect(() => validateVinDocumentEnrichment(mislabeled)).toThrow(/not an original window sticker/i)

    const mismatchedVin = structuredClone(enrichment)
    mismatchedVin.recordsByVin[vin].vin = 'TESTDATASYN000007'
    expect(() => validateVinDocumentEnrichment(mismatchedVin)).toThrow(/does not match/i)

    const unsupportedField = structuredClone(enrichment)
    unsupportedField.recordsByVin[vin].factoryEquipment.unverifiedClaim = 'clean history'
    expect(() => validateVinDocumentEnrichment(unsupportedField)).toThrow(/unsupported fields/i)

    const misplacedGroupPrice = structuredClone(enrichment)
    misplacedGroupPrice.recordsByVin[vin].factoryEquipment.equipmentGroupPrice = 1250
    expect(() => validateVinDocumentEnrichment(misplacedGroupPrice)).toThrow(/unsupported fields/i)
  })

  it('validates read-only Ford OASIS recall and warranty facts as an independent VIN resource', () => {
    const vin = 'TESTDATAHWELL0007'
    const enrichment = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1',
      generatedAt: '2026-09-12T15:00:00Z',
      recordsByVin: {
        [vin]: {
          vin,
          fordOasis: {
            dataState: 'current',
            capturedAt: '2026-09-01T00:00:00.000Z',
            sourceLabel: 'Ford OASIS vehicle report (FMCDealer read-only capture)',
            vehicleDescription: '2023 Synthetic SUV',
            versionSeries: 'SERIES 00',
            buildDate: '01-Jan-2023',
            warrantyStartDate: '01-Jan-2023',
            releaseDate: '01-Jan-2023',
            monthsInService: 36,
            saleMileage: 0,
            openActionsCaptured: true,
            openFieldServiceActions: [{ code: '00T01', description: 'Synthetic field service action' }],
            warrantyCoverages: [{ type: 'Bumper-to-Bumper' }, { type: 'Powertrain', description: '' }],
            extendedCoverageExpirations: ['01/01/2029'],
            serviceHistory: {
              dataState: 'current',
              checkedAt: '2026-09-12T16:00:00.000Z',
              sourceLabel: 'Ford PTS Retail Service Repair History (read-only; no customer data)',
              historyCaptured: true,
              repairOrderCount: 2,
              detailScanCount: 2,
              inspectionSearchStatus: 'confirmed',
              latestRepairOrder: {
                repairOrderNumber: '0000000000317147', dealerCode: '07317', openDate: '08/14/2026', closeDate: '09/11/2026', odometer: 121110,
                detailComplete: true, inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
                parts: [{ description: 'BLADE ASY - WIPER', quantity: 1, partNumber: 'FT4Z-17528-BA' }],
                laborOperations: [{ code: 'CPOUCI', description: 'UCI car inspection with Certified Blue Oval inspection' }],
                services: ['Certified Blue Oval inspection', 'Wiper blades'],
                summary: 'Certified Blue Oval inspection; Wiper blades.',
              },
              recentInspection: {
                repairOrderNumber: '0000000000317147', dealerCode: '07317', openDate: '08/14/2026', closeDate: '09/11/2026', odometer: 121110,
                detailComplete: true, inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
                parts: [], laborOperations: [], services: ['Certified Blue Oval inspection'],
              },
            },
          },
        },
      },
    }

    // A record carrying only OASIS facts is a usable resource on its own.
    const validated = validateVinDocumentEnrichment(enrichment)
    expect(validated.recordsByVin[vin]).toEqual({
      vin,
      fordOasis: {
        dataState: 'current',
        capturedAt: '2026-09-01T00:00:00.000Z',
        sourceLabel: 'Ford OASIS vehicle report (FMCDealer read-only capture)',
        vehicleDescription: '2023 Synthetic SUV',
        versionSeries: 'SERIES 00',
        buildDate: '01-Jan-2023',
        warrantyStartDate: '01-Jan-2023',
        releaseDate: '01-Jan-2023',
        monthsInService: 36,
        saleMileage: 0,
        openActionsCaptured: true,
        openFieldServiceActions: [{ code: '00T01', description: 'Synthetic field service action' }],
        warrantyCoverages: [{ type: 'Bumper-to-Bumper' }, { type: 'Powertrain' }],
        extendedCoverageExpirations: ['01/01/2029'],
        serviceHistory: enrichment.recordsByVin[vin].fordOasis.serviceHistory,
      },
    })
    expect(validated.metadata).toMatchObject({
      recordCount: 1,
      factoryEquipmentCount: 0,
      externalAutoCheckCount: 0,
      fordOasisCount: 1,
    })

    const nullNumbers = structuredClone(enrichment)
    nullNumbers.recordsByVin[vin].fordOasis.monthsInService = null
    nullNumbers.recordsByVin[vin].fordOasis.saleMileage = null
    const withoutNumbers = validateVinDocumentEnrichment(nullNumbers).recordsByVin[vin].fordOasis
    expect(withoutNumbers).not.toHaveProperty('monthsInService')
    expect(withoutNumbers).not.toHaveProperty('saleMileage')

    const missingActions = structuredClone(enrichment)
    delete missingActions.recordsByVin[vin].fordOasis.openActionsCaptured
    delete missingActions.recordsByVin[vin].fordOasis.openFieldServiceActions
    const unconfirmedActions = validateVinDocumentEnrichment(missingActions).recordsByVin[vin].fordOasis
    expect(unconfirmedActions).toMatchObject({ openFieldServiceActions: [], openActionsCaptured: false })
    missingActions.recordsByVin[vin].fordOasis = unconfirmedActions
    expect(validateVinDocumentEnrichment(missingActions).recordsByVin[vin].fordOasis.openActionsCaptured).toBe(false)
    const capturedEmpty = structuredClone(enrichment)
    capturedEmpty.recordsByVin[vin].fordOasis.openFieldServiceActions = []
    expect(validateVinDocumentEnrichment(capturedEmpty).recordsByVin[vin].fordOasis).toMatchObject({ openFieldServiceActions: [], openActionsCaptured: true })
    const legacyEmpty = structuredClone(capturedEmpty)
    delete legacyEmpty.recordsByVin[vin].fordOasis.openActionsCaptured
    expect(validateVinDocumentEnrichment(legacyEmpty).recordsByVin[vin].fordOasis).toMatchObject({ openFieldServiceActions: [], openActionsCaptured: false })
    const invalidCapture = structuredClone(enrichment)
    delete invalidCapture.recordsByVin[vin].fordOasis.openFieldServiceActions
    invalidCapture.recordsByVin[vin].fordOasis.openActionsCaptured = true
    expect(() => validateVinDocumentEnrichment(invalidCapture)).toThrow(/requires an explicit array/i)

    const technicalFields = {
      bodyStyle: 'CREW CAB', driveType: '4X4', paintColor: 'SYNTHETIC WHITE', paintCode: 'YZ',
      engine: '3.5L V6', engineCalibration: 'DEMO-CAL', transmission: '10 SPEED',
      axleRatio: '3.73', axleCode: 'EL', grossVehicleWeight: '7,400 LB', wheelSize: '20 IN',
      tire: '275/60R20', syncVersion: 'SYNC 4', fuelType: 'GASOLINE',
    }
    const technical = structuredClone(enrichment)
    Object.assign(technical.recordsByVin[vin].fordOasis, technicalFields)
    expect(validateVinDocumentEnrichment(technical).recordsByVin[vin].fordOasis).toMatchObject(technicalFields)
    expect(validateVinDocumentEnrichmentForPublish(technical).recordsByVin[vin].fordOasis).toMatchObject(technicalFields)
    for (const key of Object.keys(technicalFields)) {
      const overlong = structuredClone(technical)
      overlong.recordsByVin[vin].fordOasis[key] = 'x'.repeat(161)
      expect(() => validateVinDocumentEnrichment(overlong)).toThrow(/safe text limit/i)
      const badType = structuredClone(technical)
      badType.recordsByVin[vin].fordOasis[key] = { ownerName: 'Synthetic owner' }
      expect(() => validateVinDocumentEnrichment(badType)).toThrow(/must be text/i)
      const foreignText = structuredClone(technical)
      foreignText.recordsByVin[vin].fordOasis[key] = 'Owner name: Synthetic owner'
      expect(() => validateVinDocumentEnrichment(foreignText)).toThrow(/non-vehicle material/i)
    }
    const absentTechnical = structuredClone(technical)
    absentTechnical.recordsByVin[vin].fordOasis.engine = null
    absentTechnical.recordsByVin[vin].fordOasis.engineCalibration = ''
    const absentResult = validateVinDocumentEnrichment(absentTechnical).recordsByVin[vin].fordOasis
    expect(absentResult).not.toHaveProperty('engine')
    expect(absentResult).not.toHaveProperty('engineCalibration')

    const unsupportedField = structuredClone(enrichment)
    unsupportedField.recordsByVin[vin].fordOasis.rawReport = 'Unstructured source text'
    expect(() => validateVinDocumentEnrichment(unsupportedField)).toThrow(/unsupported fields/i)

    // Owner identity never enters the release, even when a capture leaks it.
    const ownerName = structuredClone(enrichment)
    ownerName.recordsByVin[vin].fordOasis.ownerName = 'Jane Example'
    expect(() => validateVinDocumentEnrichment(ownerName)).toThrow(/unsupported fields/i)
    const rejected = []
    const degraded = validateVinDocumentEnrichmentForPublish(ownerName, {
      onResourceRejected: (finding) => rejected.push(finding),
    })
    expect(degraded.recordsByVin).toEqual({})
    expect(rejected).toEqual([
      expect.objectContaining({ vin, channel: 'fordOasis', reason: expect.stringMatching(/unsupported fields/i) }),
    ])
    const coverageOwner = structuredClone(enrichment)
    coverageOwner.recordsByVin[vin].fordOasis.warrantyCoverages[0].customerName = 'Jane Example'
    expect(() => validateVinDocumentEnrichment(coverageOwner)).toThrow(/unsupported fields/i)
    const serviceOwner = structuredClone(enrichment)
    serviceOwner.recordsByVin[vin].fordOasis.serviceHistory.latestRepairOrder.customerName = 'Jane Example'
    expect(() => validateVinDocumentEnrichment(serviceOwner)).toThrow(/unsupported fields/i)
    const serviceLaborOwner = structuredClone(enrichment)
    serviceLaborOwner.recordsByVin[vin].fordOasis.serviceHistory.latestRepairOrder.laborOperations[0].description = 'Owner name: Jane Example'
    expect(() => validateVinDocumentEnrichment(serviceLaborOwner)).toThrow(/identity material|invalid/i)

    const badCode = structuredClone(enrichment)
    badCode.recordsByVin[vin].fordOasis.openFieldServiceActions = [{ code: 'RECALL-1', description: 'Not an FSA code' }]
    expect(() => validateVinDocumentEnrichment(badCode)).toThrow(/not a valid FSA code/i)
    const lowercaseCode = structuredClone(enrichment)
    lowercaseCode.recordsByVin[vin].fordOasis.openFieldServiceActions = [{ code: '00t01' }]
    expect(() => validateVinDocumentEnrichment(lowercaseCode)).toThrow(/not a valid FSA code/i)
    const duplicateCode = structuredClone(enrichment)
    duplicateCode.recordsByVin[vin].fordOasis.openFieldServiceActions = [{ code: '00T01' }, { code: '00T01' }]
    expect(() => validateVinDocumentEnrichment(duplicateCode)).toThrow(/duplicate code/i)

    const missingCapture = structuredClone(enrichment)
    delete missingCapture.recordsByVin[vin].fordOasis.capturedAt
    expect(() => validateVinDocumentEnrichment(missingCapture)).toThrow(/capturedAt is required/i)
    const badState = structuredClone(enrichment)
    badState.recordsByVin[vin].fordOasis.dataState = 'verified'
    expect(() => validateVinDocumentEnrichment(badState)).toThrow(/data state is invalid/i)
    const fractionalMonths = structuredClone(enrichment)
    fractionalMonths.recordsByVin[vin].fordOasis.monthsInService = 38.5
    expect(() => validateVinDocumentEnrichment(fractionalMonths)).toThrow(/monthsInService must be an integer/i)
    const stringMileage = structuredClone(enrichment)
    stringMileage.recordsByVin[vin].fordOasis.saleMileage = '00003'
    expect(() => validateVinDocumentEnrichment(stringMileage)).toThrow(/saleMileage must be an integer/i)
    const longDate = structuredClone(enrichment)
    longDate.recordsByVin[vin].fordOasis.warrantyStartDate = 'x'.repeat(41)
    expect(() => validateVinDocumentEnrichment(longDate)).toThrow(/safe text limit/i)
  })

  it('permits a separately VIN-validated official AutoCheck record but creates no default link', () => {
    const vin = 'TESTDATASYN000008'
    const record = {
      schemaVersion: 'inventory-flow-vin-document-enrichment-v1',
      recordsByVin: {
        [vin]: {
          vin,
          autoCheckReport: {
            validatedVin: vin,
            dataState: 'current',
            url: `https://www.autocheck.com/report/${vin}`,
            sourceLabel: 'AutoCheck',
            capturedAt: '2026-08-30T14:00:00Z',
            score: 92,
          },
        },
      },
    }

    expect(validateVinDocumentEnrichment(record).recordsByVin[vin].autoCheckReport).toMatchObject({
      url: `https://www.autocheck.com/report/${vin}`,
      score: 92,
    })
    const queryForm = structuredClone(record)
    queryForm.recordsByVin[vin].autoCheckReport.url = `https://www.autocheck.com/vehiclehistory?VIN=${vin}&source=inventory-flow`
    expect(validateVinDocumentEnrichment(queryForm).recordsByVin[vin].autoCheckReport.url).toContain(`VIN=${vin}`)
    const unsafe = structuredClone(record)
    unsafe.recordsByVin[vin].autoCheckReport.url = `https://evil.example/report/${vin}`
    expect(() => validateVinDocumentEnrichment(unsafe)).toThrow(/approved official host/i)
    const confused = structuredClone(record)
    confused.recordsByVin[vin].autoCheckReport.url = `https://www.autocheck.com/report?vin=TESTDATASYN000007&note=${vin}`
    expect(() => validateVinDocumentEnrichment(confused)).toThrow(/exact-VIN route/i)
    const mismatch = structuredClone(record)
    mismatch.recordsByVin[vin].autoCheckReport.validatedVin = 'TESTDATASYN000007'
    expect(() => validateVinDocumentEnrichment(mismatch)).toThrow(/exact-VIN/i)
  })

  it('follows the latest completed manifest and validates both exact snapshots', () => {
    const fixture = createSyntheticWorkspace()
    try {
      const { manifest } = findLatestCompletedManifest(fixture.workspaceRoot)
      const release = loadLatestCompletedRelease({
        workspaceRoot: fixture.workspaceRoot,
        now: new Date(`${manifest.report_date}T18:00:00-04:00`),
      })

      expect(release.reportDate).toBe(manifest.report_date)
      expect(release.sourceRuns.public.rowCount).toBe(manifest.source_counts.public_unique_vins)
      expect(release.sourceRuns.dealerMail.rowCount).toBe(manifest.source_counts.dealermail_used_rows)
      expect(release.sourceRuns.dealerMail.metadata.heldVinCount).toBe(manifest.source_counts.active_held_vins)
      expect(release.sourceRuns.public.sha256).toMatch(/^[A-F0-9]{64}$/)
      expect(release.sourceRuns.dealerMail.sha256).toMatch(/^[A-F0-9]{64}$/)
      expect(release.publicChangeEvents).toHaveLength(
        Object.values(manifest.public_change_counts).reduce((total: number, count: unknown) => total + Number(count), 0),
      )
      expect(release.sourceRuns.public.metadata.changeBaseline?.reportDate < release.reportDate).toBe(true)
      expect(release.vehicles.filter((vehicle: { publicRecord: unknown }) => vehicle.publicRecord)).toHaveLength(
        manifest.source_counts.public_unique_vins,
      )
      const enriched = release.vehicles.find((vehicle: { vin: string }) => vehicle.vin === 'TESTDATAHWELL0001')
      expect(enriched?.resourceRecord?.factoryEquipment).toMatchObject({
        sourceLabel: 'Synthetic factory-equipment fixture',
        totalMsrp: 68420,
        isOriginalWindowSticker: false,
      })
      expect(enriched?.resourceRecord?.autoCheckReport).toBeUndefined()
      expect(release.sourceRuns.resources).toMatchObject({
        type: 'vin_document_enrichment',
        rowCount: 1,
        schemaVersion: 'inventory-flow-vin-document-enrichment-v1',
        provenanceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    } finally {
      fixture.cleanup()
    }
  })
})
