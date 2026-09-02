// @ts-nocheck -- server modules intentionally use the Node ESM runtime without a frontend declaration bundle.
// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import {
  findLatestCompletedManifest,
  hasCompletedManifestEvidence,
  loadLatestCompletedRelease,
  mergeVerifiedPhotoCache,
  validateVinDocumentEnrichment,
} from '../../server/importer.mjs'

describe('verified daily source importer', () => {
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
    const vin = '1FMCU0GD6JUC18203'
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
    const vin = '1FMCU0GD6JUC18203'
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
            basePrice: 32585,
            totalOptions: 995,
            destinationCharge: 1495,
            totalMsrp: 35075,
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

    expect(merged.recordsByVin[vin].autoCheckReport).toMatchObject({
      score: 91,
      ownerCount: 2,
      dataState: 'current',
    })
    expect(merged.recordsByVin[vin].autoCheckReport.validated_vin).toBeUndefined()
    expect(merged.recordsByVin[vin].windowSticker).toMatchObject({
      equipmentGroup: '300A',
      totalMsrp: 35075,
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
              autoCheckReport: { ...cache.vehicles[vin].autoCheckReport, validated_vin: '2LMPJ8LR3HBL46607' },
            },
          },
        },
        reportDate: '2026-08-30',
        publicSnapshotSha256: snapshotSha256,
      }),
    ).toThrow(/exact-VIN/i)
  })

  it('validates exact-VIN factory equipment independently from public listings', () => {
    const vin = '1GCUDEED9RZ144878'
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
    mismatchedVin.recordsByVin[vin].vin = '2LMPJ8LR3HBL46607'
    expect(() => validateVinDocumentEnrichment(mismatchedVin)).toThrow(/does not match/i)

    const unsupportedField = structuredClone(enrichment)
    unsupportedField.recordsByVin[vin].factoryEquipment.unverifiedClaim = 'clean history'
    expect(() => validateVinDocumentEnrichment(unsupportedField)).toThrow(/unsupported fields/i)
  })

  it('permits a separately VIN-validated official AutoCheck record but creates no default link', () => {
    const vin = '1GCUDEED9RZ144878'
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
    const unsafe = structuredClone(record)
    unsafe.recordsByVin[vin].autoCheckReport.url = `https://evil.example/report/${vin}`
    expect(() => validateVinDocumentEnrichment(unsafe)).toThrow(/approved official host/i)
    const mismatch = structuredClone(record)
    mismatch.recordsByVin[vin].autoCheckReport.validatedVin = '2LMPJ8LR3HBL46607'
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
      })
    } finally {
      fixture.cleanup()
    }
  })
})
