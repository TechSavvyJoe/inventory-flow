// @vitest-environment node
// @ts-nocheck -- production modules are plain ESM; every fixture is synthetic.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSyntheticCloudBundle } from '../../fixtures/synthetic-cloud-bundle.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import {
  MANAGER_DISPOSITION_AUTHORITY,
  MANAGER_DISPOSITION_INDEPENDENCE,
  MANAGER_DISPOSITION_SCHEMA,
  canonicalManagerDispositionJson,
  managerDispositionSha256,
  sanitizeManagerDispositionDocuments,
  validateSanitizedManagerDispositionOverlay,
} from '../../server/manager-disposition-schema.mjs'
import { loadManagerDispositionOverlay } from '../../server/manager-disposition-overlay.mjs'

const PRIVATE = 'SYNTHETIC_CUSTOMER_NAME_MUST_NEVER_LEAVE_SOURCE'
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function sourceFor(bundle, records) {
  return {
    schema_version: '1.0', classification: 'operational-redacted', cloud_upload_allowed: true,
    source_store: 'Howell', source_period: bundle.reportDate.slice(0, 7), source_type: 'manager-log',
    status_authority: MANAGER_DISPOSITION_AUTHORITY, status_independence: MANAGER_DISPOSITION_INDEPENDENCE,
    records,
    summary: {
      sold_records: records.filter(record => record.sold_manager_log).length,
      delivered_records: records.filter(record => record.delivered_manager_log).length,
      sold_not_marked_delivered: records.filter(record => record.sold_manager_log && !record.delivered_manager_log).length,
    },
  }
}

function fixtures() {
  const bundle = buildSyntheticCloudBundle()
  const current = bundle.release.vehicles.filter(vehicle => vehicle.publicRecord).slice(0, 2)
  const records = [
    { stock_number: current[0].publicRecord.stock_number, vin: current[0].vin, vehicle: 'source-controlled text discarded', sold_manager_log: true, delivered_manager_log: true, delivery_date: bundle.reportDate, confidence: 'high', source_store_note: PRIVATE },
    { stock_number: current[1].publicRecord.stock_number, vin: null, vehicle: 'also discarded', sold_manager_log: true, delivered_manager_log: false, delivery_date: null, confidence: 'medium-high' },
    { stock_number: 'MISSING-1', vin: null, vehicle: 'unmatched text discarded', sold_manager_log: true, delivered_manager_log: false, delivery_date: null, confidence: 'medium' },
  ]
  return { bundle, current, source: sourceFor(bundle, records) }
}

describe('strict manager disposition overlay', () => {
  it('publishes only re-derived identity and status fields, with VIN-first and unique-stock fallback', () => {
    const { bundle, current, source } = fixtures()
    const overlay = sanitizeManagerDispositionDocuments({ documents: [{ expectedStore: 'Howell', data: source }], reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })
    expect(overlay.summary).toMatchObject({ recordCount: 3, soldRecordCount: 3, deliveredRecordCount: 1, matchedRecordCount: 2, unmatchedRecordCount: 1, conflictingRecordCount: 0, reviewRecordCount: 1 })
    expect(overlay.records[0]).toMatchObject({ vin: current[0].vin, vehicleName: current[0].publicRecord.vehicle_name, matchMethod: 'vin', matchStatus: 'matched' })
    expect(overlay.records[1]).toMatchObject({ vin: current[1].vin, vehicleName: current[1].publicRecord.vehicle_name, matchMethod: 'unique_stock', matchStatus: 'matched' })
    expect(overlay.records[2]).toMatchObject({ vin: null, vehicleName: null, matchMethod: 'not_matched', matchStatus: 'stock_not_in_current_release', reviewRequired: true })
    expect(JSON.stringify(overlay)).not.toContain(PRIVATE)
    expect(JSON.stringify(overlay)).not.toContain('source-controlled text')
    expect(overlay.sources[0].strippedFieldCount).toBe(1)
    expect(validateSanitizedManagerDispositionOverlay(overlay, { reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })).toEqual(overlay.summary)
  })

  it('fails closed for unknown/private fields, future delivery, altered matches, or impossible stripping claims', () => {
    const { bundle, source } = fixtures()
    const attempt = data => sanitizeManagerDispositionDocuments({ documents: [{ expectedStore: 'Howell', data }], reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })
    const privateField = structuredClone(source); privateField.records[0].customer_name = PRIVATE
    expect(() => attempt(privateField)).toThrow(/unsupported fields/)
    const future = structuredClone(source); future.records[0].delivery_date = '2099-01-01'
    expect(() => attempt(future)).toThrow(/after the release report date/)
    const overlay = attempt(source)
    const wrongStock = structuredClone(overlay); wrongStock.records[0].stockNumber = 'OTHER'
    expect(() => validateSanitizedManagerDispositionOverlay(wrongStock, { reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })).toThrow(/differs from current public evidence/)
    const impossible = structuredClone(overlay); impossible.sources[0].strippedFieldCount = 999
    expect(() => validateSanitizedManagerDispositionOverlay(impossible, { reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })).toThrow(/exceeds/)
  })

  it('loads only the exact manifest-bound operational file and verifies its raw hash', () => {
    const { bundle, source } = fixtures()
    const root = mkdtempSync(path.join(os.tmpdir(), 'manager-overlay-')); directories.push(root)
    const directory = path.join(root, 'work', 'manager-supplied', 'sold-logs'); mkdirSync(directory, { recursive: true })
    const sourcePath = path.join(directory, `${bundle.reportDate.slice(0, 7)}-howell-operational.json`)
    const raw = Buffer.from(JSON.stringify(source)); writeFileSync(sourcePath, raw)
    // A neighboring, differently classified filename is never selected.
    writeFileSync(path.join(directory, `${bundle.reportDate.slice(0, 7)}-howell-other.json`), '{not json')
    const sha256 = createHash('sha256').update(raw).digest('hex').toUpperCase()
    const binding = { status: 'complete', classification: 'operational-redacted', source_type: 'manager-log', path: sourcePath, sha256, source_store: 'Howell', source_period: bundle.reportDate.slice(0, 7), sold_records: 3, delivered_records: 1, sold_not_marked_delivered: 2, matched_current_public_vins: 2, unmatched_records: 1, conflicting_records: 0, review_records: 1, cloud_upload_allowed: true }
    const loaded = loadManagerDispositionOverlay({ workspaceRoot: root, reportDate: bundle.reportDate, vehicles: bundle.release.vehicles, manifestBinding: binding })
    expect(loaded.sourceRun.metadata).toMatchObject({ boundSourceSha256: sha256, sanitizer: 'strict_allowlist_v1', strippedFieldCount: 1 })
    expect(loaded.sourceRun.sha256).toBe(managerDispositionSha256(loaded.overlay).toUpperCase())
    expect(loaded.sourceRun.bytes).toBe(new TextEncoder().encode(canonicalManagerDispositionJson(loaded.overlay)).byteLength)
    expect(() => loadManagerDispositionOverlay({ workspaceRoot: root, reportDate: bundle.reportDate, vehicles: bundle.release.vehicles, manifestBinding: { ...binding, sha256: '0'.repeat(64) } })).toThrow(/checksum differs/)
  })

  it('binds the sanitized projection and all four counts into cloud validation', () => {
    const { bundle, source } = fixtures()
    const overlay = sanitizeManagerDispositionDocuments({ documents: [{ expectedStore: 'Howell', data: source }], reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })
    const rawHash = 'b'.repeat(64)
    bundle.release.managerDispositionOverlay = overlay
    bundle.release.sourceRuns.managerDisposition = {
      type: 'manager_disposition_overlay', reportDate: bundle.reportDate, extractedAt: null,
      sha256: managerDispositionSha256(overlay), bytes: new TextEncoder().encode(canonicalManagerDispositionJson(overlay)).byteLength,
      schemaVersion: MANAGER_DISPOSITION_SCHEMA, status: 'current', staleReason: null, rowCount: overlay.summary.recordCount,
      metadata: { classification: 'operational-redacted', cloudUploadAllowed: true, sourceCount: 1, sourceStores: ['Howell'], soldRecordCount: 3, deliveredRecordCount: 1, reviewRecordCount: 1, strippedFieldCount: 1, sanitizer: 'strict_allowlist_v1', boundSourceSha256: rawHash },
    }
    bundle.release.manifest.manager_disposition_overlay = { status: 'complete', classification: 'operational-redacted', source_type: 'manager-log', path: `local-file:${bundle.reportDate.slice(0, 7)}-howell-operational.json`, sha256: rawHash, source_store: 'Howell', source_period: bundle.reportDate.slice(0, 7), sold_records: 3, delivered_records: 1, sold_not_marked_delivered: 2, matched_current_public_vins: 2, unmatched_records: 1, conflicting_records: 0, review_records: 1, cloud_upload_allowed: true }
    const validated = validateReleaseBundle(bundle)
    expect(validated).toMatchObject({
      managerDispositionRecordCount: 3,
      managerSoldRecordCount: 3,
      managerDeliveredRecordCount: 1,
      managerDispositionReviewCount: 1,
      managerDeliveredExclusionCount: 1,
      managerPendingCarryoverCount: 0,
      managerPendingIdentityReviewCount: 1,
    })
    expect(validated.activeInventoryCount).toBe(validated.publicRowCount - 1)
    const tampered = structuredClone(bundle); tampered.release.managerDispositionOverlay.records[0].deliveryLabel = PRIVATE
    expect(() => validateReleaseBundle(tampered)).toThrow(/sanitized labels/)
    expect(JSON.stringify(bundle.release.managerDispositionOverlay)).not.toContain(PRIVATE)
  })
})
