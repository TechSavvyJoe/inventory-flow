// @ts-nocheck -- Node ESM publisher and portable Worker validation share runtime tests.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it, vi } from 'vitest'
import { createDecipheriv } from 'node:crypto'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { loadLatestCompletedRelease } from '../../server/importer.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { accessHeaders, base64Key, cloudReleaseFrom, encryptBundle, portableMetadata, publicationEndpoint, publishEnvelope } from '../../scripts/publish-cloud-release.mjs'

const storeNames = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const encryptionKey = Buffer.alloc(32, 7)
const environment = {
  INVENTORY_OPS_CLOUD_URL: 'https://inventory-ops.joegallant.me',
  INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN: 'synthetic-publisher-credential',
  CF_ACCESS_CLIENT_ID: 'synthetic-service-id',
  CF_ACCESS_CLIENT_SECRET: 'synthetic-service-credential',
}

function counts(records) {
  return Object.fromEntries(storeNames.map((store) => [store, records.filter((row) => row.storeName === store).length]))
}

function completeBundle() {
  const fixture = createSyntheticWorkspace()
  try {
    const release = loadLatestCompletedRelease({ workspaceRoot: fixture.workspaceRoot, now: new Date('2026-08-30T15:00:00Z') })
    const snapshot = release.dealerMailSnapshot
    const included = snapshot.completeDealerMailUsedInventory.rows
    const heldVins = new Set(snapshot.vehicles.map((row) => row.mainRow.vin))
    for (const row of included) {
      row.rawCellInnerText = Array(22).fill('SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS')
      row.rawCellControlValues = Array.from({ length: 22 }, () => [])
      row.holdStateFromRowClass = heldVins.has(row.vin) ? 'active_hold' : 'no_current_hold_found'
    }
    const excluded = included.filter((row) => !heldVins.has(row.vin))
    snapshot.excludeActiveHoldsValidationSet = {
      readOnly: true,
      rows: excluded,
      summary: { totalRows: excluded.length, uniqueVinCount: excluded.length, uniqueStockCount: excluded.length, byStore: counts(excluded) },
    }
    snapshot.completeInventorySetValidation.activeHoldDifferenceRows = included.filter((row) => heldVins.has(row.vin)).map(({ vin, stockNumber, storeName, storeCode }) => ({ vin, stockNumber, storeName, storeCode }))
    snapshot.crmInventoryControlValidation = {
      completeInventoryRowsIncludingHolds: included.length,
      inventoryRowsExcludingHolds: excluded.length,
      activeHoldVINsRemovedByExcludeFilter: heldVins.size,
      excludeFilterRemovedExactlyTheActiveHoldSet: true,
      includingHoldsByStore: counts(included),
      excludingHoldsByStore: counts(excluded),
      lotReadyOnlyRowsIncludingHolds: included.length,
      lotReadyOnlyVINSetEqualsAllVehiclesVINSet: true,
    }
    for (const held of snapshot.vehicles) {
      for (const detail of held.holdDetailRows) detail.orderRaw = String(detail.holdOrderNumber)
    }
    snapshot.vehicles[0].holdDetailRows.push({ lifecycleStatus: 'deleted_history', holdPosition: 'deleted', orderRaw: 'DELETED', customerOrReasonRaw: 'Synthetic deleted history' })
    snapshot.summary.totalHoldDetailRows += 1
    snapshot.summary.deletedHistoricalHoldRows += 1
    // Detach shared fixture references so tests can detect changes only to a
    // normalized record without silently changing its source at the same time.
    return JSON.parse(JSON.stringify(cloudReleaseFrom(release)))
  } finally {
    fixture.cleanup()
  }
}

describe('portable cloud release validation', () => {
  it('independently derives counts while retaining primary, backup, deleted and full evidence records', () => {
    const bundle = completeBundle()
    expect(validateReleaseBundle(bundle)).toMatchObject({ publicRowCount: 8, dealerMailRowCount: 8, heldVinCount: 2, activeHoldRecordCount: 3, backupCount: 1, deletedHoldRecordCount: 1, vehicleCount: 8 })
    expect(bundle.release.manifest.public_change_counts.price_change).toBe(0)
    expect(bundle.release.manifest.validation_results).toEqual({ passed: true })
    expect(bundle.release.sourceRuns.public.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ['source source-count disagreement', (b) => { b.release.sourceRuns.public.rowCount = 9 }],
    ['missing raw control cells', (b) => { b.release.dealerMailSnapshot.completeDealerMailUsedInventory.rows[0].rawCellControlValues.pop() }],
    ['missing exclude-holds set', (b) => { delete b.release.dealerMailSnapshot.excludeActiveHoldsValidationSet }],
    ['false include/exclude equation despite claimed success', (b) => { b.release.dealerMailSnapshot.excludeActiveHoldsValidationSet.rows.pop(); b.release.dealerMailSnapshot.excludeActiveHoldsValidationSet.summary.totalRows -= 1 }],
    ['wrong public listing store', (b) => { const row = Object.values(b.release.publicSnapshot.vehicles)[0]; row.listing_url = row.listing_url.replace('www.bobmaxeyfordhowell.com', 'www.bobmaxeyford.com') }],
    ['normalized data changed independently from source', (b) => { b.release.vehicles[0].crmRecord.priceNumber += 1 }],
    ['normalized VIN omitted', (b) => { b.release.vehicles.pop() }],
    ['duplicated active primary order', (b) => { b.release.dealerMailSnapshot.vehicles[0].holdDetailRows[1].holdOrderNumber = 1 }],
    ['deleted record mislabeled as history', (b) => { b.release.dealerMailSnapshot.vehicles[0].holdDetailRows.at(-1).orderRaw = '3' }],
    ['flagged comment not captured', (b) => { b.release.dealerMailSnapshot.vehicles[0].mainRow.commentsFlag = 'Y'; b.release.dealerMailSnapshot.vehicles[0].comments = [] }],
    ['flagged alert not captured', (b) => { b.release.dealerMailSnapshot.vehicles[0].mainRow.alertsFlag = 'Y'; b.release.dealerMailSnapshot.vehicles[0].alerts = [] }],
    ['invalid calendar date', (b) => { b.reportDate = '2026-02-30' }],
    ['incomplete manifest', (b) => { b.release.manifest.complete = false }],
  ])('rejects %s', (_label, mutate) => {
    const bundle = completeBundle()
    mutate(bundle)
    expect(() => validateReleaseBundle(bundle)).toThrow()
  })
})

describe('private release publisher', () => {
  it('uses stable canonical content hashes with fresh encryption nonces', () => {
    const bundle = completeBundle()
    const first = encryptBundle(bundle, encryptionKey)
    const reordered = Object.fromEntries(Object.entries(bundle).reverse())
    const second = encryptBundle(reordered, encryptionKey)
    expect(first.bundleSha256).toBe(second.bundleSha256)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    const encrypted = Buffer.from(first.ciphertext, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(first.iv, 'base64url'))
    decipher.setAAD(Buffer.from(`${first.version}:${first.reportDate}:${first.bundleSha256}`))
    decipher.setAuthTag(encrypted.subarray(-16))
    const recovered = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString())
    expect(recovered.release.dealerMailSnapshot).toEqual(bundle.release.dealerMailSnapshot)
    expect(recovered.release.vehicles).toEqual(bundle.release.vehicles)
  })

  it('removes nested machine path prefixes but retains metadata, changes, and exact note text', () => {
    const metadata = { changeBaseline: { snapshotPath: 'C:\\Users\\Synthetic\\work\\2026-08-29.json', sha256: 'A'.repeat(64) }, photoCache: { path: '/Users/synthetic/cache.json' }, sourceUrl: 'https://example.test/data', note: 'Exact note C:\\docs\\keep.txt' }
    expect(portableMetadata(metadata)).toEqual({ changeBaseline: { snapshotPath: 'local-file:2026-08-29.json', sha256: 'A'.repeat(64) }, photoCache: { path: 'local-file:cache.json' }, sourceUrl: 'https://example.test/data', note: metadata.note })
    expect(metadata.changeBaseline.snapshotPath).toContain('Synthetic')
  })

  it('accepts only canonical 32-byte encryption keys', () => {
    expect(base64Key(encryptionKey.toString('base64'))).toEqual(encryptionKey)
    expect(base64Key(encryptionKey.toString('base64url'))).toEqual(encryptionKey)
    expect(() => base64Key(`${encryptionKey.toString('base64')}!`)).toThrow()
    expect(() => base64Key(Buffer.alloc(31).toString('base64'))).toThrow()
    expect(() => base64Key(encryptionKey.toString('base64').replace(/=$/, '=='))).toThrow()
  })

  it.each(['http://inventory-ops.joegallant.me', 'https://example.test', 'https://inventory-ops.joegallant.me.evil.test', 'https://inventory-ops.joegallant.me:8443', 'https://user:secret@inventory-ops.joegallant.me', 'https://inventory-ops.joegallant.me/?forward=elsewhere'])('refuses an unintended publish target %s', (url) => {
    expect(() => publicationEndpoint(url)).toThrow()
  })

  it('requires both service credentials before contacting the cloud', async () => {
    expect(() => accessHeaders({})).toThrow(/CF_ACCESS_CLIENT_ID/)
    expect(() => accessHeaders({ CF_ACCESS_CLIENT_ID: 'synthetic' })).toThrow(/CF_ACCESS_CLIENT_SECRET/)
    const fetchImpl = vi.fn()
    await expect(publishEnvelope({ reportDate: '2026-08-30' }, { environment: { ...environment, CF_ACCESS_CLIENT_SECRET: '' }, fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('blocks redirects, applies a deadline, and verifies the returned date/status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'published', reportDate: '2026-08-30' }), { status: 201 }))
    await expect(publishEnvelope({ reportDate: '2026-08-30' }, { environment, fetchImpl })).resolves.toEqual({ status: 'published', reportDate: '2026-08-30' })
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' })
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ status: 'published', reportDate: '2026-08-29' })))
    await expect(publishEnvelope({ reportDate: '2026-08-30' }, { environment, fetchImpl })).rejects.toThrow(/did not confirm/)
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ status: 'okay', reportDate: '2026-08-30' })))
    await expect(publishEnvelope({ reportDate: '2026-08-30' }, { environment, fetchImpl })).rejects.toThrow(/did not confirm/)
  })
})
