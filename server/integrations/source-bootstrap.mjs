import { STORE_NAMES } from '../constants.mjs'
import { IntegrationReadError } from './read-service.mjs'

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const list = value => Array.isArray(value) ? value : []
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null
const text = value => typeof value === 'string' ? value : null
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null
const boolean = value => typeof value === 'boolean' ? value : null
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, scalar(value?.[key])]))
const strings = value => list(value).filter(item => typeof item === 'string')

function parsedAutoCheck(value) {
  if (!isObject(value)) return null
  const recentInspection = isObject(value.recentInspection) ? {
    date: text(value.recentInspection.date), types: strings(value.recentInspection.types).slice(0, 8),
  } : null
  return {
    ...pick(value, ['dataState', 'reportRunAt', 'score', 'scoreRangeLow', 'scoreRangeHigh', 'usage', 'ownerCount', 'lastReportedOdometer', 'lastReportedOdometerDate', 'vehicleClass', 'assemblyCountry', 'estimatedInServiceDate']),
    checks: list(value.checks).filter(isObject).map(check => pick(check, ['label', 'status', 'detail'])),
    ...(recentInspection?.date && recentInspection.types.length ? { recentInspection } : {}),
  }
}

function parsedSticker(value) {
  if (!isObject(value)) return null
  return {
    ...pick(value, ['dataState', 'originalMarket', 'pricingCurrency', 'pricingCurrencyEvidence', 'vehicleDescription', 'equipmentGroup', 'equipmentGroupPrice', 'basePrice', 'totalOptions', 'destinationCharge', 'totalMsrp', 'exteriorColor', 'interiorColor', 'engine', 'transmission']),
    ...(Array.isArray(value.equipmentGroupContents) ? { equipmentGroupContents: strings(value.equipmentGroupContents) } : {}),
    options: strings(value.options), standardEquipment: strings(value.standardEquipment), warranty: strings(value.warranty),
  }
}

function parsedFactoryEquipment(value) {
  if (!isObject(value)) return null
  return {
    ...pick(value, ['dataState', 'capturedAt', 'vehicleDescription', 'basePrice', 'totalOptions', 'destinationCharge', 'totalMsrp', 'exteriorColor', 'interiorColor', 'engine', 'transmission', 'drivetrain']),
    packages: list(value.packages).filter(isObject).map(item => ({ ...pick(item, ['name', 'code', 'price']), features: strings(item.features) })),
    sections: list(value.sections).filter(isObject).map(section => ({ name: text(section.name), items: list(section.items).filter(isObject).map(item => pick(item, ['label', 'price'])) })),
  }
}

function parsedFordOasis(value) {
  if (!isObject(value)) return null
  return {
    ...pick(value, ['dataState', 'capturedAt', 'vehicleDescription', 'versionSeries', 'buildDate', 'warrantyStartDate', 'releaseDate', 'monthsInService', 'saleMileage']),
    ...Object.fromEntries(['bodyStyle', 'driveType', 'paintColor', 'paintCode', 'engine', 'engineCalibration', 'transmission', 'axleRatio', 'axleCode', 'grossVehicleWeight', 'wheelSize', 'tire', 'syncVersion', 'fuelType'].map(key => [key, text(value[key])?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 160) ?? null])),
    openActionsCaptured: value.openActionsCaptured === true && Array.isArray(value.openFieldServiceActions),
    openFieldServiceActions: list(value.openFieldServiceActions).filter(isObject).map(item => pick(item, ['code', 'description'])),
    warrantyCoverages: list(value.warrantyCoverages).filter(isObject).map(item => pick(item, ['type', 'description'])),
    extendedCoverageExpirations: strings(value.extendedCoverageExpirations),
  }
}

function warrantyCoverage(value) {
  return pick(value, [
    'type', 'termText', 'termMonths', 'termMiles', 'unlimitedMiles', 'unlimitedMonths',
    'remainingMiles', 'remainingMonths', 'remainingMilesText', 'remainingTimeText', 'status',
  ])
}

function parsedWarrantyCheck(value) {
  if (!isObject(value)) return null
  const result = {
    ...pick(value, ['dataState', 'capturedAt', 'mileageEntered', 'mileageSource']),
  }
  if (isObject(value.autoCheck)) {
    result.autoCheck = {
      ...pick(value.autoCheck, ['inServiceDate', 'inServiceAgeMonths', 'defaultMileage']),
      coverages: list(value.autoCheck.coverages).filter(isObject).map(warrantyCoverage),
    }
  }
  if (isObject(value.fordOasis)) {
    result.fordOasis = {
      ...pick(value.fordOasis, ['warrantyStartDate', 'monthsInService']),
      coverages: list(value.fordOasis.coverages).filter(isObject).map(warrantyCoverage),
    }
  }
  return result
}

function managerDisposition(value) {
  if (!isObject(value)) return null
  return pick(value, [
    'stockNumber', 'vin', 'vehicleName', 'soldManagerLog', 'deliveredManagerLog',
    'deliveryDate', 'confidence', 'sourceStore', 'sourcePeriod', 'matchMethod',
    'matchStatus', 'physicalStore', 'reviewRequired',
  ])
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null
}

function daysListed(inventoryDate, reportDate) {
  const start = date(inventoryDate), end = date(reportDate)
  return start === null || end === null ? null : Math.max(0, Math.floor((end - start) / 86400000))
}

function publicScan(record) {
  const vehicleId = number(record.vehicle_id)
  return {
    locationCity: text(record.location_city), genericColor: text(record.generic_color),
    firstSeen: text(record.first_seen), lastSeen: text(record.last_seen),
    dealerLocationId: number(record.dealer_location_id), vehicleId: vehicleId === 0 ? null : vehicleId,
    sourceCount: number(record.source_count),
  }
}

function vehicle(view, record, meta) {
  // App views can contain useful CRM fallback values. Public data consumers must
  // receive only the corresponding public snapshot value, including nulls.
  return {
    vin: record.vin, stockNumber: text(record.stock_number), year: number(record.year),
    make: text(record.make), model: text(record.model), trim: text(record.trim), vehicleName: text(record.vehicle_name),
    listedPrice: number(record.listed_price), msrp: number(record.msrp), mileage: number(record.mileage),
    daysListed: daysListed(record.inventory_date, meta.reportDate),
    exteriorColor: text(record.exterior_color), interiorColor: text(record.interior_color), bodyStyle: text(record.body_style), bodyType: text(record.body_type),
    drivetrain: text(record.drivetrain), engine: text(record.engine), transmission: text(record.transmission), fuelType: text(record.fuel_type),
    mpgCity: number(record.mpg_city), mpgHighway: number(record.mpg_highway), certified: boolean(record.certified),
    inventoryDate: text(record.inventory_date), modelCode: text(record.model_code), features: text(record.features),
    listingUrl: text(record.listing_url), photoCount: number(record.photo_count),
    // Already canonicalized by the app's VIN-specific public-photo reader. The
    // integration read service applies its independent URL allowlist afterward.
    imageUrl: text(view.imageUrl), imageUrls: strings(view.imageUrls),
    publicStore: record.store, sourceReportedLocation: record.store,
    ...pick(view, ['homeStore', 'homeStoreConfirmed', 'crmStore']),
    websiteStatus: text(record.availability)?.trim() || 'Not provided',
    publicListingState: meta.publicFreshness === 'current' ? 'Listed publicly; availability not confirmed' : 'Last verified public listing — availability not confirmed',
    dealerOn: { inStock: boolean(record.in_stock), inTransit: boolean(record.in_transit), inProduction: boolean(record.in_production) },
    managerDisposition: managerDisposition(view.managerDisposition),
    hold: pick(view.hold, ['state', 'backupCount']),
    movement: pick(view.movement, ['currentLocation', 'destination', 'locationConfidence', 'lastConfirmedAt', 'departedAt', 'state']),
    publicScan: publicScan(record),
    autoCheckReport: parsedAutoCheck(view.autoCheckReport), windowSticker: parsedSticker(view.windowSticker), factoryEquipment: parsedFactoryEquipment(view.factoryEquipment),
    fordOasis: parsedFordOasis(view.fordOasis), warrantyCheck: parsedWarrantyCheck(view.warrantyCheck),
  }
}

/**
 * Prepare the existing scoped app view for external projection without CRM
 * fallbacks. This does not expand the bootstrap's VIN set or export raw records.
 * The final read service still enforces grant stores, scopes, types and bounds.
 */
export function integrationBootstrapFromSource(bootstrap, release) {
  if (!isObject(bootstrap) || !Array.isArray(bootstrap.vehicles) || !isObject(bootstrap.meta) || !Array.isArray(release?.vehicles)) {
    throw new IntegrationReadError('Verified source inventory is unavailable', { status: 503, code: 'SOURCE_DATA_UNAVAILABLE' })
  }
  const meta = {
    ...pick(bootstrap.meta, [
      'reportDate', 'completedAt', 'timezone', 'publicFreshness', 'dealerMailFreshness', 'resourceFreshness',
      'managerDispositionFreshness', 'managerDispositionCoverageStatus', 'publicCount', 'crmCount', 'heldVinCount',
      'managerDispositionCount', 'managerDeliveredCount', 'managerDispositionReviewCount', 'publicChangeBaselineDate', 'holdChangeStatus',
    ]),
    managerDispositionCoveredSourceStores: STORE_NAMES.filter(store => list(bootstrap.meta.managerDispositionCoveredSourceStores).includes(store)),
  }
  const byVin = new Map(), duplicateVins = new Set()
  for (const item of release.vehicles) {
    if (!isObject(item) || !VIN.test(item.vin ?? '')) continue
    if (byVin.has(item.vin)) duplicateVins.add(item.vin)
    byVin.set(item.vin, item.publicRecord)
  }
  const seen = new Set(), vehicles = []
  for (const view of bootstrap.vehicles) {
    if (!isObject(view) || !VIN.test(view.vin ?? '') || seen.has(view.vin) || duplicateVins.has(view.vin)) continue
    seen.add(view.vin)
    const record = byVin.get(view.vin)
    if (!isObject(record) || record.vin !== view.vin || !STORE_NAMES.includes(record.store)) continue
    vehicles.push(vehicle(view, record, meta))
  }
  const publicChanges = list(bootstrap.publicChanges).filter(isObject).map(change => pick(change, [
    'id', 'type', 'field', 'valueType', 'reportDate', 'previousReportDate', 'vin', 'stockNumber', 'vehicleName', 'store',
    'beforeValue', 'afterValue', 'currentVehicle', 'listingUrl',
  ]))
  const managerDispositions = list(bootstrap.managerDispositions).filter(isObject)
    .map(managerDisposition).filter(Boolean)
  return { meta, vehicles, publicChanges, managerDispositions }
}
