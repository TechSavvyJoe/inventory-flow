/**
 * Production-shaped, repository-safe importer fixture.
 *
 * SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS: every value written by this
 * helper comes from the fabricated synthetic release fixture.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildSyntheticRelease,
  SYNTHETIC_REPORT_DATE,
} from './synthetic-release.mjs'

const PREVIOUS_REPORT_DATE = '2026-08-29'
const STORE_NAMES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln']
const GENERATED_AT = '2026-08-30T13:57:00.000Z'
const SYNTHETIC_FACTORY_EQUIPMENT_URL =
  'https://assets.cai-media-management.com/window-stickers/00000000-0000-4000-8000-000000000001.jpg'

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function publicSnapshot(release, reportDate) {
  const vehicles = Object.fromEntries(
    release.vehicles
      .filter((record) => record.publicRecord)
      .map((record) => [record.vin, record.publicRecord]),
  )

  return {
    fixture_marker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS',
    completed: true,
    report_date: reportDate,
    generated_at: GENERATED_AT,
    timezone: 'America/New_York',
    source_statuses: STORE_NAMES.map((source) => {
      const count = Object.values(vehicles).filter((vehicle) => vehicle.store === source).length
      return {
        source,
        status: 'OK',
        expected_count: count,
        rows_fetched: count,
        unique_vins: count,
      }
    }),
    vehicles,
  }
}

function dealerMailSnapshot(release) {
  const rows = release.vehicles.map((record) => record.crmRecord).filter(Boolean)
  const heldVehicles = release.vehicles.map((record) => record.holdRecord).filter(Boolean)
  const details = heldVehicles.flatMap((vehicle) => vehicle.holdDetailRows ?? [])
  const activeDetails = details.filter((row) => row.lifecycleStatus === 'active')
  const activePrimaries = activeDetails.filter(
    (row) => row.holdPosition === 'primary' || Number(row.holdOrderNumber) === 1,
  )
  const activeBackups = activeDetails.filter(
    (row) => row.holdPosition === 'backup' || Number(row.holdOrderNumber) > 1,
  )

  return {
    fixtureMarker: 'SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS',
    schemaVersion: 'dealermail-used-holds-and-complete-inventory-v2',
    reportDate: SYNTHETIC_REPORT_DATE,
    extractedAtUtc: GENERATED_AT,
    timezone: 'America/New_York',
    sourceStatus: {
      overall: 'complete_authenticated_read_only',
      loginRedirectEncountered: false,
      readOnly: true,
    },
    automationAccessAssessment: { persistentDailyAccess: 'guaranteed' },
    completeDealerMailUsedInventory: {
      readOnly: true,
      extractedAtUtc: GENERATED_AT,
      authenticationStatus: {
        authenticatedSessionStillWorks: true,
        loginFormDetected: false,
      },
      rows,
      summary: {
        totalRows: rows.length,
        uniqueVinCount: new Set(rows.map((row) => row.vin)).size,
        uniqueStockCount: new Set(rows.map((row) => row.stockNumber)).size,
      },
    },
    completeInventorySetValidation: {
      validation: {
        differenceVinEqualsFlaggedHolds: true,
        differenceStockEqualsFlaggedHolds: true,
        allSourceCellCounts22: true,
        allVinFormatValid: true,
        allStockNonblank: true,
        allStoreCodesExpected: true,
        setEquationValid: true,
      },
    },
    vehicles: heldVehicles,
    summary: {
      uniqueHeldVehicles: heldVehicles.length,
      totalHoldDetailRows: details.length,
      activeHoldDetailRows: activeDetails.length,
      activePrimaryHolds: activePrimaries.length,
      activeBackupHolds: activeBackups.length,
      deletedHistoricalHoldRows: details.length - activeDetails.length,
      detailEndpointsAttempted: heldVehicles.length,
      detailEndpointsSucceeded: heldVehicles.length,
    },
    cdkReadOnlyLookup: {
      records: release.vehicles
        .filter((record) => record.cdkRecord)
        .map((record) => ({ vin: record.vin, ...record.cdkRecord })),
    },
  }
}

function vinDocumentEnrichment(release) {
  const record = release.vehicles.find((vehicle) => vehicle.resourceRecord?.factoryEquipment)
  if (!record) throw new Error('Synthetic release is missing its factory-equipment record')

  return {
    schemaVersion: 'inventory-flow-vin-document-enrichment-v1',
    generatedAt: GENERATED_AT,
    recordsByVin: {
      [record.vin]: {
        vin: record.vin,
        factoryEquipment: {
          ...record.resourceRecord.factoryEquipment,
          url: SYNTHETIC_FACTORY_EQUIPMENT_URL,
        },
      },
    },
  }
}

export function createSyntheticWorkspace() {
  const release = buildSyntheticRelease()
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'inventory-ops-test-'))
  const currentPublicPath = path.join(
    workspaceRoot,
    'work',
    'inventory-history',
    'snapshots',
    `${SYNTHETIC_REPORT_DATE}.json`,
  )
  const previousPublicPath = path.join(
    workspaceRoot,
    'work',
    'inventory-history',
    'snapshots',
    `${PREVIOUS_REPORT_DATE}.json`,
  )
  const dealerMailPath = path.join(
    workspaceRoot,
    'work',
    'dealermail',
    `${SYNTHETIC_REPORT_DATE}.json`,
  )
  const enrichmentPath = path.join(
    workspaceRoot,
    'apps',
    'inventory-ops',
    'data',
    'vin-document-enrichment.json',
  )
  const manifestPath = path.join(
    workspaceRoot,
    'work',
    'run-status',
    `${SYNTHETIC_REPORT_DATE}.json`,
  )

  const { hold_change_status: _omittedHoldChangeStatus, ...manifestTemplate } = release.manifest
  const manifest = {
    ...manifestTemplate,
    public_snapshot_path: path.relative(workspaceRoot, currentPublicPath),
    dealermail_snapshot_path: path.relative(workspaceRoot, dealerMailPath),
  }

  writeJson(previousPublicPath, publicSnapshot(release, PREVIOUS_REPORT_DATE))
  writeJson(currentPublicPath, publicSnapshot(release, SYNTHETIC_REPORT_DATE))
  writeJson(dealerMailPath, dealerMailSnapshot(release))
  writeJson(enrichmentPath, vinDocumentEnrichment(release))
  writeJson(manifestPath, manifest)

  return {
    workspaceRoot,
    reportDate: SYNTHETIC_REPORT_DATE,
    cleanup() {
      rmSync(workspaceRoot, { recursive: true, force: true })
    },
  }
}
