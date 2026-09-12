import type {
  DealerMailHoldEvidence,
  FactoryEquipmentResource,
  FordOasisResource,
  InventoryDecisionMetrics,
  InventoryGroupStore,
  InventoryStore,
  InventoryVehicle,
  SourceDataState,
  VehicleTimelineEvent,
} from '../features/inventory/types'
import { vautoFactoryEquipmentUrl } from '../features/inventory/vehicle-document-utils'
import type {
  BootstrapData,
  PublicChangeEvent,
  SourceFreshness,
  StoreName,
  TransferRecord,
  VehicleRecord,
} from '../types'

export function inventoryStore(name: StoreName | string): InventoryStore {
  return { id: String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: String(name) }
}

function dataState(freshness: SourceFreshness): SourceDataState {
  if (freshness === 'current') return 'current'
  if (freshness === 'stale_unverified') return 'stale'
  if (freshness === 'incomplete') return 'incomplete'
  return 'unavailable'
}

function resourceDataState(freshness: SourceFreshness | undefined, fallback: SourceDataState): SourceDataState {
  return freshness ? dataState(freshness) : fallback
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const cleaned = value?.trim()
  return cleaned || null
}

function cleanOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cleanTextList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function factoryEquipmentResource(
  factoryEquipment: VehicleRecord['factoryEquipment'],
  fallbackState: SourceDataState,
): FactoryEquipmentResource | null {
  if (!factoryEquipment) return null

  const packages = (factoryEquipment.packages ?? []).flatMap((item) => {
    const name = cleanOptionalText(item?.name)
    if (!name) return []
    return [{
      name,
      code: cleanOptionalText(item.code),
      price: cleanOptionalNumber(item.price),
      features: cleanTextList(item.features),
    }]
  })
  const sections = (factoryEquipment.sections ?? []).flatMap((section) => {
    const name = cleanOptionalText(section?.name)
    if (!name) return []
    const items = (section.items ?? []).flatMap((item) => {
      const label = cleanOptionalText(item?.label)
      return label ? [{ label, price: cleanOptionalNumber(item.price) }] : []
    })
    return items.length ? [{ name, items }] : []
  })

  return {
    dataState: resourceDataState(factoryEquipment.dataState, fallbackState),
    url: vautoFactoryEquipmentUrl(factoryEquipment.url),
    sourceLabel: cleanOptionalText(factoryEquipment.sourceLabel),
    capturedAt: cleanOptionalText(factoryEquipment.capturedAt),
    vehicleDescription: cleanOptionalText(factoryEquipment.vehicleDescription),
    basePrice: cleanOptionalNumber(factoryEquipment.basePrice),
    totalOptions: cleanOptionalNumber(factoryEquipment.totalOptions),
    destinationCharge: cleanOptionalNumber(factoryEquipment.destinationCharge),
    totalMsrp: cleanOptionalNumber(factoryEquipment.totalMsrp),
    exteriorColor: cleanOptionalText(factoryEquipment.exteriorColor),
    interiorColor: cleanOptionalText(factoryEquipment.interiorColor),
    engine: cleanOptionalText(factoryEquipment.engine),
    transmission: cleanOptionalText(factoryEquipment.transmission),
    drivetrain: cleanOptionalText(factoryEquipment.drivetrain),
    packages,
    sections,
    disclaimer: cleanOptionalText(factoryEquipment.disclaimer),
    isOriginalWindowSticker: false,
  }
}

function fordOasisResource(
  fordOasis: VehicleRecord['fordOasis'],
  fallbackState: SourceDataState,
): FordOasisResource | null {
  if (!fordOasis) return null

  const openFieldServiceActions = (fordOasis.openFieldServiceActions ?? []).flatMap((action) => {
    const code = cleanOptionalText(action?.code)
    return code ? [{ code, description: cleanOptionalText(action.description) }] : []
  })
  const warrantyCoverages = (fordOasis.warrantyCoverages ?? []).flatMap((coverage) => {
    const type = cleanOptionalText(coverage?.type)
    return type ? [{ type, description: cleanOptionalText(coverage.description) }] : []
  })

  return {
    dataState: resourceDataState(fordOasis.dataState, fallbackState),
    capturedAt: cleanOptionalText(fordOasis.capturedAt),
    sourceLabel: cleanOptionalText(fordOasis.sourceLabel),
    vehicleDescription: cleanOptionalText(fordOasis.vehicleDescription),
    versionSeries: cleanOptionalText(fordOasis.versionSeries),
    // Dates stay exactly as OASIS printed them; they are not reformatted.
    buildDate: cleanOptionalText(fordOasis.buildDate),
    warrantyStartDate: cleanOptionalText(fordOasis.warrantyStartDate),
    releaseDate: cleanOptionalText(fordOasis.releaseDate),
    monthsInService: cleanOptionalNumber(fordOasis.monthsInService),
    saleMileage: cleanOptionalNumber(fordOasis.saleMileage),
    openFieldServiceActions,
    warrantyCoverages,
    extendedCoverageExpirations: cleanTextList(fordOasis.extendedCoverageExpirations),
  }
}

function officialDocumentSearchText(
  vehicle: VehicleRecord,
  factoryEquipment: FactoryEquipmentResource | null,
  fordOasis: FordOasisResource | null,
): string {
  const autoCheck = vehicle.autoCheckReport
  const sticker = vehicle.windowSticker
  return [
    autoCheck?.score != null ? `AutoCheck score ${autoCheck.score}` : null,
    autoCheck?.scoreRangeLow != null && autoCheck?.scoreRangeHigh != null
      ? `AutoCheck score range ${autoCheck.scoreRangeLow} ${autoCheck.scoreRangeHigh}`
      : null,
    autoCheck?.usage,
    autoCheck?.ownerCount != null ? `${autoCheck.ownerCount} owners` : null,
    autoCheck?.lastReportedOdometer,
    autoCheck?.lastReportedOdometerDate,
    autoCheck?.vehicleClass,
    autoCheck?.assemblyCountry,
    autoCheck?.estimatedInServiceDate,
    ...(autoCheck?.checks ?? []).flatMap((check) => [check.label, check.status, check.detail]),
    sticker?.vehicleDescription,
    sticker?.equipmentGroup,
    sticker?.originalMarket,
    sticker?.pricingCurrency,
    sticker?.pricingCurrencyEvidence,
    sticker?.basePrice,
    sticker?.totalOptions,
    sticker?.destinationCharge,
    sticker?.totalMsrp,
    sticker?.exteriorColor,
    sticker?.interiorColor,
    sticker?.engine,
    sticker?.transmission,
    ...(sticker?.options ?? []),
    ...(sticker?.standardEquipment ?? []),
    ...(sticker?.warranty ?? []),
    factoryEquipment?.dataState,
    factoryEquipment?.url,
    factoryEquipment?.sourceLabel,
    factoryEquipment?.capturedAt,
    factoryEquipment?.vehicleDescription,
    factoryEquipment?.basePrice,
    factoryEquipment?.totalOptions,
    factoryEquipment?.destinationCharge,
    factoryEquipment?.totalMsrp,
    factoryEquipment?.exteriorColor,
    factoryEquipment?.interiorColor,
    factoryEquipment?.engine,
    factoryEquipment?.transmission,
    factoryEquipment?.drivetrain,
    ...(factoryEquipment?.packages ?? []).flatMap((item) => [
      item.name,
      item.code,
      item.price,
      ...(item.features ?? []),
    ]),
    ...(factoryEquipment?.sections ?? []).flatMap((section) => [
      section.name,
      ...section.items.flatMap((item) => [item.label, item.price]),
    ]),
    factoryEquipment?.disclaimer,
    factoryEquipment ? 'vAuto informational equipment label not original window sticker' : null,
    fordOasis?.vehicleDescription,
    fordOasis?.versionSeries,
    fordOasis?.buildDate,
    fordOasis?.warrantyStartDate,
    fordOasis?.releaseDate,
    fordOasis?.monthsInService != null ? `${fordOasis.monthsInService} months in service` : null,
    fordOasis?.saleMileage,
    ...(fordOasis?.openFieldServiceActions ?? []).flatMap((action) => [action.code, action.description]),
    ...(fordOasis?.warrantyCoverages ?? []).flatMap((coverage) => [coverage.type, coverage.description]),
    ...(fordOasis?.extendedCoverageExpirations ?? []),
    fordOasis ? 'Ford OASIS' : null,
    fordOasis?.openFieldServiceActions.length ? `${fordOasis.openFieldServiceActions.length} open recalls field service actions` : null,
  ].filter((value) => value !== null && value !== undefined && String(value).trim() !== '').join(' | ')
}

function isListed(vehicle: VehicleRecord): boolean | null {
  const state = `${vehicle.publicListingState} ${vehicle.websiteStatus}`.toLowerCase()
  if (state.includes('not found') || state.includes('removed') || state.includes('not listed')) return false
  if (state.includes('listed') || state.includes('available')) return true
  return vehicle.listingUrl ? true : null
}

function holdActive(state: VehicleRecord['hold']['state'], dealerMailState: SourceDataState): boolean | null {
  if (dealerMailState !== 'current') return null
  if (state === 'primary' || state === 'backup' || state === 'multiple') return true
  if (state === 'none_observed') return false
  return null
}

function timelineFromTransfer(transfer?: TransferRecord): VehicleTimelineEvent[] {
  if (!transfer) return []
  return transfer.events.map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    title: event.label,
    detail: event.note || null,
    actorLabel: event.actor || null,
    locationLabel: event.toLocation || event.store || null,
    source: 'movement',
  }))
}

function publicChangeValue(event: PublicChangeEvent, value: string | number | null): string {
  if (value === null || value === '') return 'Not published'
  if (event.valueType === 'money' && typeof value === 'number') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  }
  if (event.valueType === 'mileage' && typeof value === 'number') {
    return `${new Intl.NumberFormat('en-US').format(value)} miles`
  }
  return String(value)
}

function publicChangeTitle(type: PublicChangeEvent['type']): string {
  const labels: Record<PublicChangeEvent['type'], string> = {
    new_arrival: 'New public-inventory arrival',
    removed: 'Removed from public release',
    price_change: 'Listed price changed',
    mileage_change: 'Published mileage changed',
    website_status_change: 'Website Status changed',
    stock_correction: 'Stock number corrected',
    store_transfer: 'Source physical store changed',
  }
  return labels[type]
}

function timelineFromPublicChanges(data: BootstrapData, vin: string): VehicleTimelineEvent[] {
  return (data.publicChanges ?? [])
    .filter((event) => event.vin === vin)
    .map((event) => ({
      id: event.id,
      occurredAt: `${event.reportDate}T12:00:00`,
      title: publicChangeTitle(event.type),
      detail: `${event.field}: ${publicChangeValue(event, event.beforeValue)} → ${publicChangeValue(event, event.afterValue)}`,
      locationLabel: event.store,
      source: 'public',
    }))
}

function holdEvidence(vehicle: VehicleRecord, dataState: SourceDataState): DealerMailHoldEvidence[] {
  if (vehicle.hold.state === 'none_observed' || vehicle.hold.state === 'unknown') {
    return []
  }
  const privateEvidence = vehicle.privateEvidence
  const primary = privateEvidence?.primary
  const backups = privateEvidence?.backups ?? []
  const isLastVerified = vehicle.hold.state === 'stale' || dataState === 'stale'
  if (isLastVerified && !primary && backups.length === 0) return []
  const records: DealerMailHoldEvidence[] = [
    {
      id: `${vehicle.vin}-primary`,
      dataState,
      position: 'primary',
      lifecycleStatus: isLastVerified ? 'last_verified_active' : 'active',
      salesperson: primary?.salesperson || vehicle.hold.primarySalesperson || null,
      customerOrReason: primary?.customerOrReason || vehicle.hold.reason || null,
      holdDate: primary?.holdDate || null,
      expectedDeliveryDate: primary?.expectedDate || vehicle.hold.expectedDate || null,
      heldBy: primary?.heldBy || null,
      commentFlag: Boolean(vehicle.hold.commentsCount || privateEvidence?.comments?.length),
      alertFlag: Boolean(vehicle.hold.alertsCount || privateEvidence?.alerts?.length),
      comments: privateEvidence?.comments ?? [],
      alerts: privateEvidence?.alerts ?? [],
      cdkState: privateEvidence?.cdk?.status || privateEvidence?.cdk?.result || null,
    },
  ]
  for (const [index, backup] of backups.entries()) {
    records.push({
      id: `${vehicle.vin}-backup-${backup.order ?? index + 2}`,
      dataState,
      position: 'backup',
      lifecycleStatus: isLastVerified ? 'last_verified_active' : 'active',
      salesperson: backup.salesperson || null,
      customerOrReason: backup.customerOrReason || null,
      holdDate: backup.holdDate || null,
      expectedDeliveryDate: backup.expectedDate || null,
    })
  }
  return records
}

export function toInventoryVehicle(
  vehicle: VehicleRecord,
  data: BootstrapData,
  transfer?: TransferRecord,
): InventoryVehicle {
  const publicState = dataState(data.meta.publicFreshness)
  const dealerMailState = dataState(data.meta.dealerMailFreshness)
  const managerDispositionState = dataState(data.meta.managerDispositionFreshness ?? 'unknown')
  const home = inventoryStore(vehicle.homeStore)
  const sourceStore = inventoryStore(vehicle.sourceReportedLocation || vehicle.publicStore)
  const crmStore = vehicle.crmStore ? inventoryStore(vehicle.crmStore) : null
  const movement = transfer ?? (vehicle.movement.transferId ? data.transfers.find((item) => item.id === vehicle.movement.transferId) : undefined)
  const hasAppCustodyRecord = Boolean(movement || vehicle.movement.transferId)
  // vAuto/CAI equipment is sourced from the CRM-side inventory record. Its
  // freshness remains independent from public-listing freshness, including
  // for CRM-only vehicles that have no current public listing.
  const factoryEquipment = factoryEquipmentResource(vehicle.factoryEquipment, dealerMailState)
  // Ford OASIS arrives through the same independent resources channel.
  const fordOasis = fordOasisResource(vehicle.fordOasis, dealerMailState)
  const documentSearchText = officialDocumentSearchText(vehicle, factoryEquipment, fordOasis)

  return {
    id: vehicle.vin,
    vin: vehicle.vin,
    stockNumber: vehicle.stockNumber,
    year: vehicle.year ?? '',
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim || null,
    vehicleName: vehicle.vehicleName,
    price: vehicle.listedPrice,
    msrp: vehicle.msrp,
    mileage: vehicle.mileage,
    daysListed: vehicle.daysListed,
    exteriorColor: vehicle.exteriorColor || null,
    interiorColor: vehicle.interiorColor || null,
    bodyStyle: vehicle.bodyStyle || null,
    bodyType: vehicle.bodyType || null,
    drivetrain: vehicle.drivetrain || null,
    engine: vehicle.engine || null,
    transmission: vehicle.transmission || null,
    fuelType: vehicle.fuelType || null,
    mpgCity: vehicle.mpgCity ?? null,
    mpgHighway: vehicle.mpgHighway ?? null,
    certified: vehicle.certified ?? null,
    inventoryDate: vehicle.inventoryDate || null,
    dealerComments: vehicle.dealerComments || null,
    modelCode: vehicle.modelCode || null,
    photoCount: vehicle.photoCount ?? null,
    features: vehicle.features ? vehicle.features.split(/\s*\|\s*|\s*,\s*/).filter(Boolean) : [],
    imageUrl: vehicle.imageUrl || null,
    imageUrls: vehicle.imageUrls ?? (vehicle.imageUrl ? [vehicle.imageUrl] : []),
    changeSummary: vehicle.changeSummary || null,
    dataStatus: vehicle.dataStatus || null,
    publicScan: vehicle.publicScan || null,
    // This is generated by the server from fields authorized for the current
    // role. The predictive search indexes it, but the UI never renders it.
    authorizedSearchText: [vehicle.searchText, documentSearchText].filter(Boolean).join(' | ') || null,
    autoCheckReport: vehicle.autoCheckReport
      ? {
          ...vehicle.autoCheckReport,
          dataState: resourceDataState(vehicle.autoCheckReport.dataState, publicState),
          checks: (vehicle.autoCheckReport.checks ?? []).filter((check) => Boolean(check.label?.trim())),
        }
      : null,
    windowSticker: vehicle.windowSticker
      ? {
          ...vehicle.windowSticker,
          dataState: resourceDataState(vehicle.windowSticker.dataState, publicState),
          options: (vehicle.windowSticker.options ?? []).filter(Boolean),
          standardEquipment: (vehicle.windowSticker.standardEquipment ?? []).filter(Boolean),
          warranty: (vehicle.windowSticker.warranty ?? []).filter(Boolean),
        }
      : null,
    factoryEquipment,
    fordOasis,
    publicListing: {
      dataState: publicState,
      isListed: isListed(vehicle),
      websiteStatus: vehicle.websiteStatus,
      listingUrl: vehicle.listingUrl || null,
      updatedAt: data.meta.completedAt,
    },
    dealerOn: {
      dataState: publicState,
      inStock: vehicle.dealerOn.inStock,
      inTransit: vehicle.dealerOn.inTransit,
      inProduction: vehicle.dealerOn.inProduction,
      updatedAt: data.meta.completedAt,
    },
    managerDisposition: vehicle.managerDisposition
      ? {
          dataState: managerDispositionState,
          sold: true,
          delivered: vehicle.managerDisposition.deliveredManagerLog,
          deliveryDate: vehicle.managerDisposition.deliveryDate,
          sourceStore: inventoryStore(vehicle.managerDisposition.sourceStore),
          sourcePeriod: vehicle.managerDisposition.sourcePeriod,
          confidence: vehicle.managerDisposition.confidence,
          soldLabel: vehicle.managerDisposition.soldLabel,
          deliveryLabel: vehicle.managerDisposition.deliveryLabel,
        }
      : null,
    dealerMail: {
      dataState: dealerMailState,
      hasActiveHold: holdActive(vehicle.hold.state, dealerMailState),
      position:
        vehicle.hold.state === 'primary' || vehicle.hold.state === 'backup' || vehicle.hold.state === 'multiple'
          ? vehicle.hold.state
          : null,
      activeRecordCount:
        vehicle.hold.state === 'primary' || vehicle.hold.state === 'multiple'
          ? 1 + vehicle.hold.backupCount
          : vehicle.hold.state === 'backup'
            ? 1
            : 0,
      conciseState: vehicle.hold.label,
      canViewEvidence: vehicle.hold.canViewEvidence === true,
      canManageHold: vehicle.hold.canManage === true,
      redactionReason: vehicle.hold.canViewEvidence === true ? null : 'Exact DealerMail evidence is restricted for this role.',
      updatedAt: data.meta.completedAt,
    },
    location: {
      homeStore: home,
      sourceReportedStore: sourceStore,
      crmStore,
      appConfirmedLocation: hasAppCustodyRecord ? vehicle.movement.currentLocation || movement?.currentLocation || null : null,
      appConfirmedStore:
        hasAppCustodyRecord &&
        (vehicle.movement.currentLocation || movement?.currentLocation) &&
        ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'].includes(
          vehicle.movement.currentLocation || movement?.currentLocation || '',
        )
          ? inventoryStore(vehicle.movement.currentLocation || movement?.currentLocation || '')
          : null,
      appConfirmedAt: hasAppCustodyRecord ? vehicle.movement.lastConfirmedAt || movement?.lastConfirmedAt || null : null,
      appConfirmedBy: hasAppCustodyRecord ? movement?.custodian || vehicle.movement.currentCustodian || null : null,
      custodian: hasAppCustodyRecord ? vehicle.movement.currentCustodian || movement?.custodian || null : null,
      conflict: vehicle.movement.locationConfidence === 'conflicting',
    },
    movement: hasAppCustodyRecord
      ? {
          state: movement?.movementStatus || vehicle.movement.state,
          requestStatus: vehicle.movement.requestStatus || movement?.requestStatus || null,
          custodyStatus: movement?.movementStatus || vehicle.movement.state,
          customerOutcome: movement?.dealStatus || null,
          deliveryConfirmation: movement?.deliveryStatus || null,
          requestId: movement?.id || vehicle.movement.transferId || null,
          lastEventAt: vehicle.movement.lastConfirmedAt || movement?.lastConfirmedAt || null,
          lastEventLabel: movement?.events.at(-1)?.label || null,
          nextAction: vehicle.movement.nextAction || movement?.nextAction || null,
          dueAt: vehicle.movement.dueAt || movement?.dueAt || null,
          overdue:
            Boolean(vehicle.movement.dueAt && new Date(vehicle.movement.dueAt).getTime() < Date.now()) ||
            Boolean(movement?.dueAt && new Date(movement.dueAt).getTime() < Date.now()),
          custodian: vehicle.movement.currentCustodian || movement?.custodian || null,
          transportAssignee: vehicle.movement.transportAssignee || movement?.transportAssignee || null,
        }
      : null,
    holdEvidence: holdEvidence(vehicle, dealerMailState),
    dealerMailEvidence: vehicle.hold.canViewEvidence === true && vehicle.privateEvidence
      ? {
          dataState: dealerMailState,
          comments: vehicle.privateEvidence.comments ?? [],
          alerts: vehicle.privateEvidence.alerts ?? [],
          history: vehicle.privateEvidence.history ?? [],
        }
      : undefined,
    timeline: [
      ...timelineFromPublicChanges(data, vehicle.vin),
      ...(hasAppCustodyRecord ? timelineFromTransfer(movement) : []),
    ],
  }
}

export function inventoryMetrics(data: BootstrapData, store: StoreName): InventoryDecisionMetrics {
  const summary = data.stores.find((item) => item.store === store)
  return {
    publicUnits: summary?.publicUnits ?? 0,
    currentHolds: summary?.currentHolds ?? 0,
    awayFromHome: summary?.awayFromHome ?? 0,
    returnOverdue: summary?.returnOverdue ?? 0,
  }
}

export function groupStores(data: BootstrapData, homeStore: StoreName): InventoryGroupStore[] {
  return data.stores
    .filter((item) => item.store !== homeStore)
    .map((item) => ({ ...inventoryStore(item.store) }))
}
