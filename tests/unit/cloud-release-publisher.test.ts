// @ts-nocheck -- Node ESM publisher and portable Worker validation share runtime tests.
// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { describe, expect, it, vi } from 'vitest'
import { createDecipheriv } from 'node:crypto'
import { createSyntheticWorkspace } from '../../fixtures/synthetic-workspace.mjs'
import { loadLatestCompletedRelease } from '../../server/importer.mjs'
import { resourceProvenanceSha256 } from '../../server/resource-validation.mjs'
import { validateReleaseBundle } from '../../cloudflare/src/release-validation.mjs'
import { datasetFromRelease } from '../../cloudflare/src/repository.mjs'
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

function releasedHistoryFor(row) {
  return {
    vin: row.vin,
    stockNumber: row.stockNumber,
    store: { name: row.storeName, code: row.storeCode },
    sourceUrl: `https://www.dealermail.com/prospect_manager/V2_inventory_USED_hold_edit.asp?s=${encodeURIComponent(row.stockNumber)}`,
    observedAtUtc: '2026-08-30T14:00:00Z',
    currentLiveHold: false,
    interpretation: 'Synthetic former hold; outcome remains unknown.',
    holdDetailRows: [{
      stockNumber: row.stockNumber,
      sourceStockNumber: row.stockNumber,
      orderRaw: '1',
      holdOrderNumber: 1,
      holdPosition: 'primary',
      lifecycleStatus: 'active',
      customerOrReasonRaw: 'Synthetic former hold',
    }],
  }
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

function quarantineUnheldCrmSourceRow(bundle, sourceVin = 'TESTDATAQWELL0002') {
  const snapshot = bundle.release.dealerMailSnapshot
  const heldVins = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
  const cdkVins = new Set((snapshot.cdkReadOnlyLookup?.records ?? []).map((record) => record.vin))
  const row = snapshot.completeDealerMailUsedInventory.rows.find(
    (candidate) => !heldVins.has(candidate.vin) && !cdkVins.has(candidate.vin),
  )
  if (!row) throw new Error('Synthetic fixture has no unheld CRM row available for VIN quarantine')
  const originalVin = row.vin
  const stockNumber = row.stockNumber
  row.vin = sourceVin
  const excluded = snapshot.excludeActiveHoldsValidationSet.rows.find(
    (candidate) => candidate.stockNumber === stockNumber,
  )
  if (!excluded) throw new Error('Synthetic source exception row is absent from the exclude-holds control')
  excluded.vin = sourceVin
  snapshot.completeInventorySetValidation.validation.allVinFormatValid = false

  const normalized = bundle.release.vehicles.find((vehicle) => vehicle.vin === originalVin)
  if (!normalized) throw new Error('Synthetic source exception row has no normalized vehicle')
  normalized.crmRecord = null
  bundle.release.sourceRuns.dealerMail.metadata.vinQuarantine = {
    count: 1,
    stocks: [stockNumber],
    sourceRowCount: snapshot.completeDealerMailUsedInventory.rows.length,
    vinReconciledRowCount: snapshot.completeDealerMailUsedInventory.rows.length - 1,
    excludedFromVinWorkflows: true,
  }
  bundle.release.warnings.push(
    `DealerMail VIN-format review: 1 source row was excluded from VIN workflows. Review stock ${stockNumber}.`,
  )
  return { originalVin, sourceVin, stockNumber }
}

function addExternalAutoCheck(bundle, url) {
  const vehicle = bundle.release.vehicles.find((record) => record.resourceRecord)
  vehicle.resourceRecord.autoCheckReport = {
    dataState: 'current',
    url,
    sourceLabel: 'Synthetic AutoCheck evidence',
  }
  const run = bundle.release.sourceRuns.resources
  run.metadata.externalAutoCheckCount = 1
  run.provenanceSha256 = resourceProvenanceSha256(run, bundle.release.vehicles)
  return vehicle
}

function addFordInvoice(bundle) {
  const vehicle = bundle.release.vehicles.find((record) => record.resourceRecord)
  vehicle.resourceRecord.fordInvoice = {
    dataState: 'current', available: true, capturedAt: '2026-08-30T14:30:00Z', sourceLabel: 'Saved Ford factory invoice',
  }
  const run = bundle.release.sourceRuns.resources
  run.metadata.fordInvoiceCount = 1
  run.provenanceSha256 = resourceProvenanceSha256(run, bundle.release.vehicles)
  return vehicle
}

function fordOasisFixture() {
  return {
    dataState: 'current',
    capturedAt: '2026-09-12T15:00:00.000Z',
    sourceLabel: 'Ford OASIS vehicle report (FMCDealer read-only capture)',
    vehicleDescription: '2023 Synthetic SUV',
    versionSeries: 'SERIES 00',
    buildDate: '01-Jan-2023',
    warrantyStartDate: '01-Jan-2023',
    releaseDate: '01-Jan-2023',
    monthsInService: 36,
    saleMileage: 0,
    openFieldServiceActions: [{ code: '00T01', description: 'Synthetic field service action' }],
    warrantyCoverages: [{ type: 'Bumper-to-Bumper' }, { type: 'Powertrain' }],
    extendedCoverageExpirations: ['01/01/2029'],
    serviceHistory: {
      dataState: 'current', checkedAt: '2026-09-12T16:00:00.000Z', historyCaptured: true,
      repairOrderCount: 1, detailScanCount: 1, inspectionSearchStatus: 'confirmed',
      latestRepairOrder: {
        repairOrderNumber: '0000000000317147', dealerCode: '07317', openDate: '08/14/2026', closeDate: '09/11/2026', odometer: 121110,
        detailComplete: true, inspection: { status: 'confirmed', type: 'Certified Blue Oval inspection' },
        parts: [{ description: 'BLADE ASY - WIPER', quantity: 1, partNumber: 'FT4Z-17528-BA' }],
        laborOperations: [{ code: 'CPOUCI', description: 'UCI car inspection with Certified Blue Oval inspection' }],
        services: ['Certified Blue Oval inspection', 'Wiper blades'],
        summary: 'Certified Blue Oval inspection; Wiper blades.',
      },
      repairOrderTimeline: [{
        openDate: '08/14/2026', closeDate: '09/11/2026', odometer: 121110,
        services: ['Certified Blue Oval inspection', 'Wiper blades'],
      }],
    },
  }
}

function addFordOasis(bundle, { replaceFactoryEquipment = false } = {}) {
  const vehicle = bundle.release.vehicles.find((record) => record.resourceRecord)
  if (replaceFactoryEquipment) delete vehicle.resourceRecord.factoryEquipment
  vehicle.resourceRecord.fordOasis = fordOasisFixture()
  const run = bundle.release.sourceRuns.resources
  run.metadata.fordOasisCount = 1
  run.provenanceSha256 = resourceProvenanceSha256(run, bundle.release.vehicles)
  return vehicle
}

function warrantyCheckFixture() {
  return {
    dataState: 'current',
    capturedAt: '2026-09-12T21:02:11.004Z',
    sourceLabel: 'Ford OASIS warranty record; remaining figures computed at the listed odometer',
    mileageEntered: 9554,
    mileageSource: 'dealer listing odometer',
    fordOasis: {
      warrantyStartDate: '07-June-2025',
      monthsInService: 14,
      coverages: [
        {
          type: 'Bumper-to-Bumper',
          termText: '3 years / 36,000 Miles (whichever occurs first)',
          termMonths: 36,
          termMiles: 36000,
          remainingMiles: 26446,
          remainingMonths: 22,
          remainingMilesText: '26,446 miles left',
          remainingTimeText: '22 months',
          status: 'ACTIVE',
        },
        {
          type: 'Corrosion Perforation',
          termText: '5 years / Unlimited miles',
          termMonths: 60,
          unlimitedMiles: true,
          remainingMonths: 46,
          remainingMilesText: 'Unlimited miles left',
          remainingTimeText: '46 months',
          status: 'ACTIVE',
        },
      ],
    },
    autoCheck: {
      inServiceDate: '06/02/2025',
      inServiceAgeMonths: 15,
      defaultMileage: 11105,
      coverages: [
        {
          type: 'Basic',
          termText: '60 months / 36000 miles',
          termMonths: 60,
          termMiles: 36000,
          remainingMiles: 26446,
          remainingMonths: 45,
          remainingMilesText: '26,446 miles left',
          remainingTimeText: '45 months',
          status: 'ACTIVE',
        },
      ],
    },
  }
}

function addWarrantyCheck(bundle, { replaceFactoryEquipment = false, mutate = null } = {}) {
  const vehicle = bundle.release.vehicles.find((record) => record.resourceRecord)
  if (replaceFactoryEquipment) delete vehicle.resourceRecord.factoryEquipment
  const warranty = warrantyCheckFixture()
  if (mutate) mutate(warranty)
  vehicle.resourceRecord.warrantyCheck = warranty
  const run = bundle.release.sourceRuns.resources
  run.metadata.warrantyCheckCount = 1
  run.provenanceSha256 = resourceProvenanceSha256(run, bundle.release.vehicles)
  return vehicle
}

describe('portable cloud release validation', () => {
  it('binds saved invoice availability to the resource source provenance', () => {
    const bundle = completeBundle()
    addFordInvoice(bundle)
    expect(validateReleaseBundle(bundle)).toMatchObject({ resourceRecordCount: 1, fordInvoiceRecordCount: 1 })
    const missingTime = structuredClone(bundle)
    delete missingTime.release.vehicles.find((record) => record.resourceRecord).resourceRecord.fordInvoice.capturedAt
    expect(() => validateReleaseBundle(missingTime)).toThrow(/capture time is required/i)
    const undeclared = structuredClone(bundle)
    undeclared.release.sourceRuns.resources.metadata.fordInvoiceCount = 0
    expect(() => validateReleaseBundle(undeclared)).toThrow(/attached resource type counts exceed/i)
  })

  it('binds remaining factory warranty figured at the vehicle odometer', () => {
    const bundle = completeBundle()
    addWarrantyCheck(bundle)
    expect(validateReleaseBundle(bundle)).toMatchObject({ resourceRecordCount: 1, warrantyCheckRecordCount: 1 })
  })

  it('accepts a record whose only resource is the warranty check, and a release with no warranty count', () => {
    const only = completeBundle()
    addWarrantyCheck(only, { replaceFactoryEquipment: true })
    const vehicle = only.release.vehicles.find((record) => record.resourceRecord)
    expect(Object.keys(vehicle.resourceRecord).sort()).toEqual(['vin', 'warrantyCheck'])
    expect(validateReleaseBundle(only)).toMatchObject({ resourceRecordCount: 1, warrantyCheckRecordCount: 1 })

    // A release predating the warranty channel omits the count entirely and still validates.
    const legacy = completeBundle()
    expect(legacy.release.sourceRuns.resources.metadata).not.toHaveProperty('warrantyCheckCount')
    expect(validateReleaseBundle(legacy)).toMatchObject({ resourceRecordCount: 1, warrantyCheckRecordCount: 0 })
  })

  it.each([
    ['an unknown key', (w) => { w.spare = 'no' }],
    ['an unknown coverage key', (w) => { w.fordOasis.coverages[0].dealerNote = 'no' }],
    ['an invalid status', (w) => { w.fordOasis.coverages[0].status = 'MAYBE' }],
    ['a duplicate coverage type', (w) => { w.fordOasis.coverages[1].type = 'Bumper-to-Bumper' }],
    ['a missing remaining text', (w) => { delete w.fordOasis.coverages[0].remainingMilesText }],
    ['no warranty source at all', (w) => { delete w.fordOasis; delete w.autoCheck }],
    ['an explicitly unverified source label', (w) => { w.sourceLabel = 'UNVERIFIED - Ford OASIS was unavailable. DO NOT QUOTE.' }],
  ])('rejects a warranty check carrying %s', (_label, mutate) => {
    const bundle = completeBundle()
    addWarrantyCheck(bundle, { mutate })
    expect(() => validateReleaseBundle(bundle)).toThrow()
  })

  it('rejects attached warranty records that exceed the declared source count', () => {
    const bundle = completeBundle()
    addWarrantyCheck(bundle)
    bundle.release.sourceRuns.resources.metadata.warrantyCheckCount = 0
    expect(() => validateReleaseBundle(bundle)).toThrow(/attached resource type counts exceed validated source evidence/)
  })

  it('retains quarantined CRM source evidence but excludes it from normalized vehicles and action data', () => {
    const bundle = completeBundle()
    const exception = quarantineUnheldCrmSourceRow(bundle)

    expect(validateReleaseBundle(bundle)).toMatchObject({
      dealerMailRowCount: 8,
      dealerMailVinReconciledCount: 7,
      dealerMailVinReviewCount: 1,
      dealerMailVinReviewStocks: [exception.stockNumber],
      vehicleCount: 8,
    })
    expect(bundle.release.dealerMailSnapshot.completeDealerMailUsedInventory.rows).toContainEqual(
      expect.objectContaining({ vin: exception.sourceVin, stockNumber: exception.stockNumber }),
    )
    expect(bundle.release.vehicles.some((vehicle) => vehicle.vin === exception.sourceVin)).toBe(false)
    expect(bundle.release.vehicles.find((vehicle) => vehicle.vin === exception.originalVin)?.crmRecord).toBeNull()

    const dataset = datasetFromRelease(bundle.release)
    expect(dataset.sourceRuns.dealerMail.row_count).toBe(8)
    expect(dataset.crmRows).toHaveLength(7)
    expect(dataset.crmRows.some((row) => row.vin === exception.sourceVin)).toBe(false)
  })

  it('rejects quarantine metadata tampering', () => {
    const bundle = completeBundle()
    quarantineUnheldCrmSourceRow(bundle)
    bundle.release.sourceRuns.dealerMail.metadata.vinQuarantine.stocks = ['WRONG-STOCK']
    expect(() => validateReleaseBundle(bundle)).toThrow(/VIN-quarantine metadata does not reconcile/)
  })

  it('rejects an invalid source VIN reintroduced into normalized actions', () => {
    const injected = completeBundle()
    const injectedException = quarantineUnheldCrmSourceRow(injected)
    const source = injected.release.dealerMailSnapshot.completeDealerMailUsedInventory.rows.find(
      (row) => row.stockNumber === injectedException.stockNumber,
    )
    injected.release.vehicles.push({
      vin: injectedException.sourceVin,
      publicRecord: null,
      crmRecord: source,
      holdRecord: null,
      cdkRecord: null,
      resourceRecord: null,
    })
    expect(() => validateReleaseBundle(injected)).toThrow(/invalid VIN/)
  })

  it('keeps raw public document evidence in the encrypted snapshot while validating its app projection', () => {
    const bundle = completeBundle()
    const vehicle = bundle.release.vehicles.find((record) => record.publicRecord)
    const source = bundle.release.publicSnapshot.vehicles[vehicle.vin]
    const resourceUrl = `${source.listing_url.split('/used-')[0]}/api/vhcliaa/inventory/21521/window-sticker?sv=synthetic-token&make=Ford&vehicleType=U`
    source.windowSticker = {
      validated_vin: vehicle.vin,
      url: resourceUrl,
      dataState: 'incomplete',
      sourceMessage: 'Synthetic sticker source message',
      observedAt: '2026-08-30T11:00:00-04:00',
      extractionMethod: 'Synthetic official PDF text extraction',
      originalSourceText: 'Synthetic raw document text retained only in publicSnapshot',
    }
    vehicle.publicRecord.windowSticker = {
      url: resourceUrl,
      dataState: 'incomplete',
      sourceMessage: 'Synthetic sticker source message',
    }

    expect(validateReleaseBundle(bundle)).toMatchObject({ publicRowCount: 8 })
    expect(bundle.release.publicSnapshot.vehicles[vehicle.vin].windowSticker.originalSourceText).toContain('raw document text')
    expect(vehicle.publicRecord.windowSticker).not.toHaveProperty('originalSourceText')

    vehicle.publicRecord.windowSticker.sourceMessage = 'Changed normalized message'
    expect(() => validateReleaseBundle(bundle)).toThrow(/publicRecord normalized data differs from its source/)
  })

  it('preserves unheld CRM messages and released raw order-1 history without adding a current hold', () => {
    const bundle = completeBundle()
    const snapshot = bundle.release.dealerMailSnapshot
    const heldByVin = new Map(snapshot.vehicles.map((vehicle) => [vehicle.mainRow.vin, vehicle]))
    for (const row of snapshot.completeDealerMailUsedInventory.rows) {
      row.comments = heldByVin.get(row.vin)?.comments ?? []
      row.alerts = heldByVin.get(row.vin)?.alerts ?? []
      bundle.release.vehicles.find((vehicle) => vehicle.vin === row.vin).crmRecord = row
    }
    const unheld = snapshot.completeDealerMailUsedInventory.rows.find((row) => !heldByVin.has(row.vin))
    unheld.commentsFlag = 'Y'
    unheld.alertsFlag = 'Y'
    unheld.comments = [{ rows: [{ commentTextRaw: 'Synthetic unheld inspection note' }] }]
    unheld.alerts = [{ alertTextRaw: 'Synthetic unheld transport restriction' }]
    snapshot.currentComments = unheld.comments
    snapshot.currentAlerts = unheld.alerts
    snapshot.releasedHoldHistory = [releasedHistoryFor(unheld)]
    bundle.release.releasedHoldHistory = snapshot.releasedHoldHistory
    expect(validateReleaseBundle(bundle)).toMatchObject({ heldVinCount: 2, activeHoldRecordCount: 3 })
    const dataset = datasetFromRelease(bundle.release)
    expect(dataset.crmRows.find((row) => row.vin === unheld.vin).payload.alerts).toHaveLength(1)
    expect(dataset.holdRows.some((row) => row.vin === unheld.vin)).toBe(false)
    expect(JSON.parse(dataset.state.current_released_hold_history_json)).toEqual(snapshot.releasedHoldHistory)
    unheld.alerts = []
    expect(() => validateReleaseBundle(bundle)).toThrow(/flagged complete CRM alert/)
    unheld.alerts = [{ alertTextRaw: 'Synthetic unheld transport restriction' }]
    unheld.comments = []
    expect(() => validateReleaseBundle(bundle)).toThrow(/flagged complete CRM comments/)
  })

  it('fails closed when complete-CRM flags or every message evidence array is stripped', () => {
    const validBundle = completeBundle()
    const missingFlags = structuredClone(validBundle)
    for (const row of missingFlags.release.dealerMailSnapshot.completeDealerMailUsedInventory.rows) {
      delete row.commentsFlag
      delete row.alertsFlag
    }
    expect(() => validateReleaseBundle(missingFlags)).toThrow(/commentsFlag must be Y or N/)

    const bundle = structuredClone(validBundle)
    const snapshot = bundle.release.dealerMailSnapshot
    delete snapshot.currentComments
    delete snapshot.currentAlerts
    for (const row of snapshot.completeDealerMailUsedInventory.rows) {
      delete row.comments
      delete row.alerts
      delete row.commentsFlag
      delete row.alertsFlag
    }
    expect(() => validateReleaseBundle(bundle)).toThrow(/top-level current comment\/alert evidence arrays are missing/)
  })

  it.each([
    ['wrapper stock', (history) => { history.stockNumber = 'WRONG-STOCK' }],
    ['wrapper CRM store', (history) => { history.store = { name: 'Lincoln', code: 'L' } }],
    ['nested detail stock', (history) => { history.holdDetailRows[0].stockNumber = 'WRONG-STOCK' }],
    ['nested source provenance', (history) => { history.holdDetailRows[0].sourceStockNumber = 'WRONG-STOCK' }],
    ['DealerMail source route', (history) => { history.sourceUrl = `https://www.dealermail.com/prospect_manager/V2_inventory_USED_hold_edit.asp?s=WRONG-STOCK` }],
  ])('rejects released-hold history with mismatched %s', (_label, mutate) => {
    const bundle = completeBundle()
    const snapshot = bundle.release.dealerMailSnapshot
    const heldVins = new Set(snapshot.vehicles.map((vehicle) => vehicle.mainRow.vin))
    const unheld = snapshot.completeDealerMailUsedInventory.rows.find((row) => !heldVins.has(row.vin))
    const history = releasedHistoryFor(unheld)
    mutate(history)
    snapshot.releasedHoldHistory = [history]
    bundle.release.releasedHoldHistory = snapshot.releasedHoldHistory
    expect(() => validateReleaseBundle(bundle)).toThrow(/released hold history/i)
  })

  it('strictly binds each cloud resource record to a validated run, exact VIN, shapes, bounds, and approved HTTPS URLs', () => {
    const original = completeBundle()
    expect(validateReleaseBundle(original)).toMatchObject({ resourceRecordCount: 1 })
    expect(original.release.sourceRuns.resources.provenanceSha256).toMatch(/^[a-f0-9]{64}$/)
    const resourceVehicle = original.release.vehicles.find((vehicle) => vehicle.resourceRecord)

    const noRun = structuredClone(original)
    noRun.release.sourceRuns.resources = null
    expect(() => validateReleaseBundle(noRun)).toThrow(/without a validated resources source run/)

    const wrongVin = structuredClone(original)
    wrongVin.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.vin = 'TESTDATAFOWL00001'
    expect(() => validateReleaseBundle(wrongVin)).toThrow(/resource record VIN/)

    const malformedPackages = structuredClone(original)
    malformedPackages.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.factoryEquipment.packages = [{ name: 'Broken package', features: 'not-an-array' }]
    expect(() => validateReleaseBundle(malformedPackages)).toThrow(/package features.*bounded array/)

    const javascriptUrl = structuredClone(original)
    javascriptUrl.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.factoryEquipment.url = 'javascript:alert(1)'
    expect(() => validateReleaseBundle(javascriptUrl)).toThrow(/approved HTTPS/)

    const badRun = structuredClone(original)
    badRun.release.sourceRuns.resources.rowCount += 1
    expect(() => validateReleaseBundle(badRun)).toThrow(/resources source row count/)

    const wrongRunShape = structuredClone(original)
    wrongRunShape.release.sourceRuns.resources.metadata.recordCount = '1'
    expect(() => validateReleaseBundle(wrongRunShape)).toThrow(/numeric integer/)

    const metadataCountTampering = structuredClone(original)
    metadataCountTampering.release.sourceRuns.resources.metadata.externalAutoCheckCount = 1
    expect(() => validateReleaseBundle(metadataCountTampering)).toThrow(/source provenance/)

    const metadataPathTampering = structuredClone(original)
    metadataPathTampering.release.sourceRuns.resources.metadata.path = 'local-file:forged-resource-source.json'
    expect(() => validateReleaseBundle(metadataPathTampering)).toThrow(/source provenance/)

    const recordTampering = structuredClone(original)
    recordTampering.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.factoryEquipment.sourceLabel = 'Schema-valid but unbound replacement evidence'
    expect(() => validateReleaseBundle(recordTampering)).toThrow(/source provenance/)
  })

  it('binds read-only Ford OASIS recall and warranty facts to the validated resource run', () => {
    const bundle = completeBundle()
    const resourceVehicle = addFordOasis(bundle)
    expect(validateReleaseBundle(bundle)).toMatchObject({ resourceRecordCount: 1, fordOasisRecordCount: 1 })

    const unsupported = structuredClone(bundle)
    unsupported.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.fordOasis.engineCalibration = 'PCTCCRNA'
    expect(() => validateReleaseBundle(unsupported)).toThrow(/Ford OASIS record contains unsupported fields/)

    const ownerName = structuredClone(bundle)
    ownerName.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.fordOasis.ownerName = 'Jane Example'
    expect(() => validateReleaseBundle(ownerName)).toThrow(/Ford OASIS record contains unsupported fields/)

    const serviceOwnerName = structuredClone(bundle)
    serviceOwnerName.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.fordOasis.serviceHistory.latestRepairOrder.customerName = 'Jane Example'
    expect(() => validateReleaseBundle(serviceOwnerName)).toThrow(/Latest Ford repair order contains unsupported fields/)

    const badCode = structuredClone(bundle)
    badCode.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.fordOasis.openFieldServiceActions = [{ code: 'RECALL-1' }]
    expect(() => validateReleaseBundle(badCode)).toThrow(/not a valid FSA code/)

    const stringMonths = structuredClone(bundle)
    stringMonths.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.fordOasis.monthsInService = '36'
    expect(() => validateReleaseBundle(stringMonths)).toThrow(/monthsInService must be an integer/)

    const unclaimed = structuredClone(bundle)
    unclaimed.release.sourceRuns.resources.metadata.fordOasisCount = 0
    expect(() => validateReleaseBundle(unclaimed)).toThrow(/attached resource type counts exceed validated source evidence/)

    const recordTampering = structuredClone(bundle)
    recordTampering.release.vehicles.find((vehicle) => vehicle.vin === resourceVehicle.vin).resourceRecord.fordOasis.openFieldServiceActions = []
    expect(() => validateReleaseBundle(recordTampering)).toThrow(/source provenance/)
  })

  it('accepts a resource record that carries only Ford OASIS facts and still accepts releases without an OASIS count', () => {
    const oasisOnly = completeBundle()
    addFordOasis(oasisOnly, { replaceFactoryEquipment: true })
    const resourceVehicle = oasisOnly.release.vehicles.find((vehicle) => vehicle.resourceRecord)
    expect(Object.keys(resourceVehicle.resourceRecord).sort()).toEqual(['fordOasis', 'vin'])
    expect(validateReleaseBundle(oasisOnly)).toMatchObject({ resourceRecordCount: 1, fordOasisRecordCount: 1 })

    // A release with no OASIS records omits fordOasisCount entirely, keeping the
    // bundle byte-compatible with a Worker whose metadata allow-list predates the
    // field (the deployed Worker before the OASIS channel is turned on).
    const legacy = completeBundle()
    expect(legacy.release.sourceRuns.resources.metadata).not.toHaveProperty('fordOasisCount')
    expect(validateReleaseBundle(legacy)).toMatchObject({ resourceRecordCount: 1, fordOasisRecordCount: 0 })

    // An OASIS-aware release may still carry an explicit zero; the validator accepts either form.
    const explicitZero = completeBundle()
    explicitZero.release.sourceRuns.resources.metadata.fordOasisCount = 0
    explicitZero.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(explicitZero.release.sourceRuns.resources, explicitZero.release.vehicles)
    expect(validateReleaseBundle(explicitZero)).toMatchObject({ resourceRecordCount: 1, fordOasisRecordCount: 0 })
  })

  it.each([
    ['report path', (vin) => `https://www.autocheck.com/report/${vin}`],
    ['vehicle-history path', (vin) => `https://autocheck.com/vehiclehistory/${vin.toLowerCase()}/`],
    ['report VIN query', (vin) => `https://www.autocheck.com/report?vin=${vin}&source=inventory-flow`],
    ['vehicle-history VIN query', (vin) => `https://www.autocheck.com/vehiclehistory?VIN=${vin}`],
  ])('accepts the approved exact-VIN AutoCheck %s form', (_label, urlForVin) => {
    const bundle = completeBundle()
    const resourceVehicle = bundle.release.vehicles.find((vehicle) => vehicle.resourceRecord)
    addExternalAutoCheck(bundle, urlForVin(resourceVehicle.vin))
    expect(validateReleaseBundle(bundle)).toMatchObject({ resourceRecordCount: 1 })
  })

  it.each([
    ['unrelated note parameter', (vin) => `https://www.autocheck.com/report?vin=TESTDATAFOWL00001&note=${vin}`],
    ['conflicting path and VIN parameter', (vin) => `https://www.autocheck.com/report/${vin}?vin=TESTDATAFOWL00001`],
    ['duplicate VIN parameters', (vin) => `https://www.autocheck.com/report?vin=TESTDATAFOWL00001&VIN=${vin}`],
    ['ambiguous repeated path separator', (vin) => `https://www.autocheck.com/report//${vin}`],
  ])('rejects AutoCheck VIN confusion through %s', (_label, urlForVin) => {
    const bundle = completeBundle()
    const resourceVehicle = bundle.release.vehicles.find((vehicle) => vehicle.resourceRecord)
    addExternalAutoCheck(bundle, urlForVin(resourceVehicle.vin))
    expect(() => validateReleaseBundle(bundle)).toThrow(/approved exact-VIN HTTPS resource/)
  })

  it('accepts a source-labeled vAuto AutoCheck capture without inventing a report URL', () => {
    const bundle = completeBundle()
    const resourceVehicle = bundle.release.vehicles.find((vehicle) => vehicle.resourceRecord)
    addExternalAutoCheck(bundle, `https://www.autocheck.com/report/${resourceVehicle.vin}`)
    delete resourceVehicle.resourceRecord.autoCheckReport.url
    Object.assign(resourceVehicle.resourceRecord.autoCheckReport, {
      accessMethod: 'vauto',
      capturedAt: '2026-09-21T20:45:00.000Z',
      sourceLabel: 'Experian AutoCheck report captured through vAuto for this VIN',
    })
    bundle.release.sourceRuns.resources.provenanceSha256 = resourceProvenanceSha256(bundle.release.sourceRuns.resources, bundle.release.vehicles)
    expect(validateReleaseBundle(bundle)).toMatchObject({ resourceRecordCount: 1 })

    const missingCapture = structuredClone(bundle)
    delete missingCapture.release.vehicles.find((vehicle) => vehicle.resourceRecord).resourceRecord.autoCheckReport.capturedAt
    expect(() => validateReleaseBundle(missingCapture)).toThrow(/requires its source label and capture time/i)
    const unsafeUrl = structuredClone(bundle)
    unsafeUrl.release.vehicles.find((vehicle) => vehicle.resourceRecord).resourceRecord.autoCheckReport.url = `https://www.autocheck.com/report/${resourceVehicle.vin}`
    expect(() => validateReleaseBundle(unsafeUrl)).toThrow(/must not carry a document URL/i)
  })

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
    ['insecure public listing scheme', (b) => { const row = Object.values(b.release.publicSnapshot.vehicles)[0]; row.listing_url = row.listing_url.replace('https://', 'http://') }],
    ['javascript public listing scheme', (b) => { const row = Object.values(b.release.publicSnapshot.vehicles)[0]; row.listing_url = `javascript:${row.vin}` }],
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

  it.each([
    ['a macOS realpath under /private', '/private/var/folders/x1/synthetic-tmp/report.json'],
    ['a macOS temporary realpath', '/private/tmp/synthetic-scan/report.json'],
    ['an external volume', '/Volumes/DealerScans/synthetic/report.json'],
    ['an /opt install', '/opt/inventory-flow/synthetic/report.json'],
    ['a Linux mount', '/mnt/dealer-share/synthetic/report.json'],
    ['a Linux service directory', '/srv/inventory/synthetic/report.json'],
    ['a relative path under the working tree', './runtime/synthetic/report.json'],
    ['a home-relative path', '~/work/synthetic/report.json'],
  ])('does not publish %s from source metadata', (_label, value) => {
    // Node resolves macOS temp paths to /private/..., external drives mount
    // under /Volumes, and services run from /opt, /srv or /mnt — none of
    // which the allowlist covered, so those source-local file paths went
    // into the published release metadata verbatim. The API guide lists
    // source-local file paths as deliberately excluded.
    const metadata = { changeBaseline: { snapshotPath: value }, photoCache: { paths: [value] }, listing: { sourcePath: 'https://example.test/inventory/report.json' } }
    expect(portableMetadata(metadata)).toEqual({ changeBaseline: { snapshotPath: 'local-file:report.json' }, photoCache: { paths: ['local-file:report.json'] }, listing: { sourcePath: 'https://example.test/inventory/report.json' } })
    // Idempotent: a value that was already made portable stays as it is.
    expect(portableMetadata(portableMetadata(metadata))).toEqual(portableMetadata(metadata))
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
