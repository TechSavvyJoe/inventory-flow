// @vitest-environment node
// @ts-nocheck -- production modules are plain ESM; every fixture is synthetic.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  // The source log is Howell's, and the no-VIN stock fallback only matches
  // vehicles the reporting store itself lists.
  const current = bundle.release.vehicles.filter(vehicle => vehicle.publicRecord?.store === 'Howell').slice(0, 2)
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

  it('scopes the no-VIN stock fallback to vehicles the reporting store lists', () => {
    const { bundle, source } = fixtures()
    const elsewhere = bundle.release.vehicles.find(vehicle => vehicle.publicRecord && vehicle.publicRecord.store !== 'Howell')
    source.records = [{ stock_number: elsewhere.publicRecord.stock_number, vin: null, vehicle: 'another store stock number', sold_manager_log: true, delivered_manager_log: true, delivery_date: bundle.reportDate, confidence: 'high' }]
    source.summary = { sold_records: 1, delivered_records: 1, sold_not_marked_delivered: 0 }
    const overlay = sanitizeManagerDispositionDocuments({ documents: [{ expectedStore: 'Howell', data: source }], reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })
    // Another store's stock number is never this store's vehicle: no VIN, no
    // physical store, and review required instead of a delivered match.
    expect(overlay.records[0]).toMatchObject({ vin: null, vehicleName: null, matchMethod: 'not_matched', matchStatus: 'stock_not_in_current_release', physicalStore: null, reviewRequired: true })
    expect(validateSanitizedManagerDispositionOverlay(overlay, { reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })).toEqual(overlay.summary)
    // A forged cross-store match fails validation against current public evidence.
    const forged = structuredClone(overlay)
    Object.assign(forged.records[0], { vin: elsewhere.vin, vehicleName: elsewhere.publicRecord.vehicle_name, matchMethod: 'unique_stock', matchStatus: 'matched', physicalStore: elsewhere.publicRecord.store, reviewRequired: false })
    forged.summary = { ...forged.summary, matchedRecordCount: 1, unmatchedRecordCount: 0, reviewRecordCount: 0 }
    expect(() => validateSanitizedManagerDispositionOverlay(forged, { reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })).toThrow(/stock fallback is not unique|differs from current public evidence/)
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

  it('loads a content-addressed manager snapshot stored with its release', () => {
    const { bundle, source } = fixtures()
    const root = mkdtempSync(path.join(os.tmpdir(), 'manager-release-snapshot-')); directories.push(root)
    const raw = Buffer.from(JSON.stringify(source))
    const sha256 = createHash('sha256').update(raw).digest('hex').toUpperCase()
    const directory = path.join(root, 'work', 'releases', bundle.reportDate); mkdirSync(directory, { recursive: true })
    const sourcePath = path.join(directory, `manager-disposition-source-${sha256.toLowerCase()}.json`)
    writeFileSync(sourcePath, raw)
    const binding = { status: 'complete', classification: 'operational-redacted', source_type: 'manager-log', path: sourcePath, sha256, source_store: 'Howell', source_period: bundle.reportDate.slice(0, 7), sold_records: 3, delivered_records: 1, sold_not_marked_delivered: 2, matched_current_public_vins: 2, unmatched_records: 1, conflicting_records: 0, review_records: 1, cloud_upload_allowed: true }
    const loaded = loadManagerDispositionOverlay({ workspaceRoot: root, reportDate: bundle.reportDate, vehicles: bundle.release.vehicles, manifestBinding: binding })
    expect(loaded.sourceRun.snapshotPath).toBe(sourcePath)
    expect(loaded.sourceRun.metadata.boundSourceSha256).toBe(sha256)
  })

  it('accepts a workspace reached through a symlinked ancestor but rejects any symlink inside it', () => {
    // macOS resolves its default temp directory through /var -> /private/var,
    // and a deployment can mount the workspace behind a symlink too. Neither
    // is a redirect *within* the workspace, which is what the guard exists to
    // catch: a symlinked source directory or file that escapes the workspace.
    const { bundle, source } = fixtures()
    const real = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'manager-overlay-real-'))); directories.push(real)
    const alias = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), 'manager-overlay-alias-'))), 'workspace'); directories.push(path.dirname(alias))
    symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const period = bundle.reportDate.slice(0, 7)
    const write = (root) => {
      const directory = path.join(root, 'work', 'manager-supplied', 'sold-logs'); mkdirSync(directory, { recursive: true })
      const filePath = path.join(directory, `${period}-howell-operational.json`)
      const raw = Buffer.from(JSON.stringify(source)); writeFileSync(filePath, raw)
      return { filePath, sha256: createHash('sha256').update(raw).digest('hex').toUpperCase() }
    }
    const binding = (filePath, sha256) => ({ status: 'complete', classification: 'operational-redacted', source_type: 'manager-log', path: filePath, sha256, source_store: 'Howell', source_period: period, sold_records: 3, delivered_records: 1, sold_not_marked_delivered: 2, matched_current_public_vins: 2, unmatched_records: 1, conflicting_records: 0, review_records: 1, cloud_upload_allowed: true })
    const load = (workspaceRoot, filePath, sha256) => loadManagerDispositionOverlay({ workspaceRoot, reportDate: bundle.reportDate, vehicles: bundle.release.vehicles, manifestBinding: binding(filePath, sha256) })

    // The workspace addressed through the symlinked ancestor loads.
    const viaReal = write(real)
    const viaAlias = { filePath: path.join(alias, path.relative(real, viaReal.filePath)), sha256: viaReal.sha256 }
    expect(load(alias, viaAlias.filePath, viaAlias.sha256).sourceRun.metadata.boundSourceSha256).toBe(viaAlias.sha256)

    // A source directory that is itself a symlink out of the workspace does not.
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'manager-overlay-outside-'))); directories.push(outside)
    const escaped = write(outside)
    const trapped = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'manager-overlay-trap-'))); directories.push(trapped)
    mkdirSync(path.join(trapped, 'work', 'manager-supplied'), { recursive: true })
    symlinkSync(path.join(outside, 'work', 'manager-supplied', 'sold-logs'), path.join(trapped, 'work', 'manager-supplied', 'sold-logs'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => load(trapped, path.join(trapped, 'work', 'manager-supplied', 'sold-logs', `${period}-howell-operational.json`), escaped.sha256)).toThrow(/must not redirect/)

    // And a symlinked file is refused before its content is read.
    if (process.platform !== 'win32') {
      const linked = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'manager-overlay-link-'))); directories.push(linked)
      const linkedDirectory = path.join(linked, 'work', 'manager-supplied', 'sold-logs'); mkdirSync(linkedDirectory, { recursive: true })
      symlinkSync(escaped.filePath, path.join(linkedDirectory, `${period}-howell-operational.json`), 'file')
      expect(() => load(linked, path.join(linkedDirectory, `${period}-howell-operational.json`), escaped.sha256)).toThrow(/regular file/)
    }
  })

  function bindOverlay(bundle, source) {
    const overlay = sanitizeManagerDispositionDocuments({ documents: [{ expectedStore: 'Howell', data: source }], reportDate: bundle.reportDate, vehicles: bundle.release.vehicles })
    const rawHash = 'b'.repeat(64)
    bundle.release.managerDispositionOverlay = overlay
    bundle.release.sourceRuns.managerDisposition = {
      type: 'manager_disposition_overlay', reportDate: bundle.reportDate, extractedAt: null,
      sha256: managerDispositionSha256(overlay), bytes: new TextEncoder().encode(canonicalManagerDispositionJson(overlay)).byteLength,
      schemaVersion: MANAGER_DISPOSITION_SCHEMA, status: 'current', staleReason: null, rowCount: overlay.summary.recordCount,
      metadata: { classification: 'operational-redacted', cloudUploadAllowed: true, sourceCount: 1, sourceStores: ['Howell'], soldRecordCount: overlay.summary.soldRecordCount, deliveredRecordCount: overlay.summary.deliveredRecordCount, reviewRecordCount: overlay.summary.reviewRecordCount, strippedFieldCount: overlay.sources[0].strippedFieldCount, sanitizer: 'strict_allowlist_v1', boundSourceSha256: rawHash },
    }
    bundle.release.manifest.manager_disposition_overlay = { status: 'complete', classification: 'operational-redacted', source_type: 'manager-log', path: `local-file:${bundle.reportDate.slice(0, 7)}-howell-operational.json`, sha256: rawHash, source_store: 'Howell', source_period: bundle.reportDate.slice(0, 7), sold_records: overlay.summary.soldRecordCount, delivered_records: overlay.summary.deliveredRecordCount, sold_not_marked_delivered: overlay.summary.soldNotMarkedDeliveredCount, matched_current_public_vins: overlay.summary.matchedRecordCount, unmatched_records: overlay.summary.unmatchedRecordCount, conflicting_records: overlay.summary.conflictingRecordCount, review_records: overlay.summary.reviewRecordCount, cloud_upload_allowed: true }
    return overlay
  }

  it('binds the sanitized projection and all four counts into cloud validation', () => {
    const { bundle, source } = fixtures()
    source.records.push({
      stock_number: 'OFFMARKET-1', vin: '1FTFW1E50NFA00009', vehicle: 'off-market source text discarded',
      sold_manager_log: true, delivered_manager_log: false, delivery_date: null, confidence: 'high',
    })
    source.summary = { sold_records: 4, delivered_records: 1, sold_not_marked_delivered: 3 }
    bindOverlay(bundle, source)
    const validated = validateReleaseBundle(bundle)
    expect(validated).toMatchObject({
      managerDispositionRecordCount: 4,
      managerSoldRecordCount: 4,
      managerDeliveredRecordCount: 1,
      managerDispositionReviewCount: 2,
      managerDeliveredExclusionCount: 1,
      // The exact-VIN delivered row's vehicle is still in the public feed.
      managerDeliveredListedExclusionCount: 1,
      managerPendingCarryoverCount: 0,
      managerPendingIdentityReviewCount: 1,
    })
    expect(validated.activeInventoryCount).toBe(validated.publicRowCount - 1)
    const tampered = structuredClone(bundle); tampered.release.managerDispositionOverlay.records[0].deliveryLabel = PRIVATE
    expect(() => validateReleaseBundle(tampered)).toThrow(/sanitized labels/)
    expect(JSON.stringify(bundle.release.managerDispositionOverlay)).not.toContain(PRIVATE)
  })

  it('keeps a delivered stock-number-only match in active inventory for identity review', () => {
    const { bundle, current, source } = fixtures()
    source.records = [{ stock_number: current[1].publicRecord.stock_number, vin: null, vehicle: 'stock-only delivered row', sold_manager_log: true, delivered_manager_log: true, delivery_date: bundle.reportDate, confidence: 'high' }]
    source.summary = { sold_records: 1, delivered_records: 1, sold_not_marked_delivered: 0 }
    const overlay = bindOverlay(bundle, source)
    expect(overlay.records[0]).toMatchObject({ vin: current[1].vin, matchMethod: 'unique_stock', matchStatus: 'matched' })
    const validated = validateReleaseBundle(bundle)
    // Only a row that named the exact VIN may hide a vehicle.
    expect(validated).toMatchObject({ managerDeliveredExclusionCount: 0, managerDeliveredListedExclusionCount: 0 })
    expect(validated.activeInventoryCount).toBe(validated.publicRowCount)
  })
})
