export const STORE_NAMES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'] as const
export type StoreName = (typeof STORE_NAMES)[number]
export type UserRole = 'sales' | 'manager' | 'coordinator' | 'porter' | 'driver' | 'group_manager'

export type SourceFreshness = 'current' | 'stale_unverified' | 'incomplete' | 'unknown'

/**
 * Server-owned public-listing code (server/service-core.mjs publicListingCode):
 * from the current public release record and its freshness only. Clients switch
 * on it and never parse the display labels beside it. Absent means unknown.
 */
export type PublicListingCode = 'listed' | 'pre_listing' | 'not_in_release' | 'stale'

export interface PublicChangeCounts {
  newArrival: number
  removed: number
  priceChange: number
  mileageChange: number
  websiteStatusChange: number
  stockCorrection: number
  storeTransfer: number
}

export interface SourceMeta {
  reportDate: string
  completedAt: string
  publicCapturedAt?: string
  dealerMailCapturedAt?: string
  timezone: string
  manifestPath?: string
  publicFreshness: SourceFreshness
  dealerMailFreshness: SourceFreshness
  /** Freshness of the independent resources channel (AutoCheck fallback, vAuto, Ford invoice/OASIS). */
  resourceFreshness?: SourceFreshness
  managerDispositionFreshness?: SourceFreshness
  managerDispositionCoverageStatus?: 'provided' | 'not_provided'
  managerDispositionCoveredSourceStores?: StoreName[]
  managerDispositionCoverageCaveat?: string
  publicCount: number
  crmCount: number
  heldVinCount: number
  managerDispositionCount?: number
  managerDeliveredCount?: number
  managerDispositionReviewCount?: number
  publicChangeBaselineDate?: string
  publicChangeCounts: PublicChangeCounts
  holdChangeStatus: string
  warnings: string[]
}

export interface DealerOnFlags {
  inStock: boolean | null
  inTransit: boolean | null
  inProduction: boolean | null
}

export interface ManagerDispositionRecord {
  stockNumber: string
  vin: string | null
  vehicleName: string | null
  soldManagerLog: true
  deliveredManagerLog: boolean
  deliveryDate: string | null
  confidence: 'high' | 'medium-high' | 'medium' | 'low'
  sourceStore: StoreName
  sourcePeriod: string
  matchMethod: 'vin' | 'unique_stock' | 'not_matched'
  matchStatus: 'matched' | 'matched_vin_stock_review' | 'not_in_current_release' | 'stock_not_in_current_release' | 'stock_ambiguous'
  physicalStore: StoreName | null
  reviewRequired: boolean
  soldLabel: 'Sold — manager log'
  deliveryLabel: 'Delivered — manager log' | 'Not marked delivered — manager log'
  dataState: SourceFreshness
}

export interface AutoCheckReportRecord {
  /** VIN-specific AutoCheck URL published by the dealership vehicle page. */
  url?: string | null
  dataState?: SourceFreshness
  accessMethod?: 'official_url' | 'vauto' | null
  sourceLabel?: string | null
  capturedAt?: string | null
  reportRunAt?: string | null
  score?: number | null
  scoreRangeLow?: number | null
  scoreRangeHigh?: number | null
  usage?: string | null
  ownerCount?: number | null
  lastReportedOdometer?: number | null
  lastReportedOdometerDate?: string | null
  vehicleClass?: string | null
  assemblyCountry?: string | null
  estimatedInServiceDate?: string | null
  /** Latest generic inspection event from the exact-VIN AutoCheck report. */
  recentInspection?: {
    date: string
    types: string[]
  } | null
  checks?: Array<{
    label: string
    status?: string | null
    detail?: string | null
  }>
}

export interface FordInvoiceRecord {
  dataState: SourceFreshness
  available: true
  capturedAt: string
  sourceLabel: string
}

export interface WindowStickerRecord {
  originalMarket?: string | null
  pricingCurrency?: string | null
  pricingCurrencyEvidence?: string | null
  failureReason?: string | null
  sourceMessage?: string | null
  /** VIN-specific window-sticker URL published by the dealership vehicle page. */
  url?: string | null
  dataState?: SourceFreshness
  vehicleDescription?: string | null
  equipmentGroup?: string | null
  /** Present only when equipment-group membership was explicitly captured. */
  equipmentGroupContents?: string[]
  equipmentGroupPrice?: number | null
  basePrice?: number | null
  totalOptions?: number | null
  destinationCharge?: number | null
  totalMsrp?: number | null
  exteriorColor?: string | null
  interiorColor?: string | null
  engine?: string | null
  transmission?: string | null
  options?: string[]
  standardEquipment?: string[]
  warranty?: string[]
}

export interface FactoryEquipmentPackageRecord {
  name: string
  code?: string | null
  price?: number | null
  features?: string[]
}

export interface FactoryEquipmentSectionItemRecord {
  label: string
  price?: number | null
}

export interface FactoryEquipmentSectionRecord {
  name: string
  items: FactoryEquipmentSectionItemRecord[]
}

/**
 * VIN-linked informational equipment label published through vAuto/CAI.
 * This is not an original Monroney window sticker.
 */
export interface FactoryEquipmentRecord {
  dataState?: SourceFreshness
  url?: string | null
  savedPdfSha256?: string | null
  sourceLabel?: string | null
  capturedAt?: string | null
  vehicleDescription?: string | null
  basePrice?: number | null
  totalOptions?: number | null
  destinationCharge?: number | null
  totalMsrp?: number | null
  exteriorColor?: string | null
  interiorColor?: string | null
  engine?: string | null
  transmission?: string | null
  drivetrain?: string | null
  packages?: FactoryEquipmentPackageRecord[]
  sections?: FactoryEquipmentSectionRecord[]
  disclaimer?: string | null
  isOriginalWindowSticker: false
}

export interface FordOasisFieldServiceActionRecord {
  /** Ford field service action / recall code, e.g. 24N08. */
  code: string
  description?: string | null
}

export interface FordOasisWarrantyCoverageRecord {
  type: string
  description?: string | null
}

export interface FordServiceHistoryInspectionRecord {
  status: 'confirmed' | 'not_identified'
  type?: string | null
}

export interface FordServiceHistoryPartRecord {
  description: string
  quantity?: number | null
  partNumber?: string | null
}

export interface FordServiceHistoryLaborRecord {
  code: string
  description: string
}

export interface FordServiceRepairOrderRecord {
  repairOrderNumber: string
  dealerCode: string
  openDate: string
  closeDate: string
  odometer?: number | null
  detailComplete: boolean
  inspection: FordServiceHistoryInspectionRecord
  parts: FordServiceHistoryPartRecord[]
  laborOperations: FordServiceHistoryLaborRecord[]
  services: string[]
  summary?: string | null
}

/**
 * A privacy-safe service visit from the Ford repair-history index. Unlike a
 * detailed repair order, this never carries dealer or repair-order IDs.
 */
export interface FordServiceHistoryVisitRecord {
  openDate: string
  closeDate: string
  odometer?: number | null
  /** Present only when Ford returned a verified vehicle-service summary. */
  services?: string[]
}

export interface FordServiceHistoryRecord {
  dataState: SourceFreshness
  checkedAt: string
  sourceLabel?: string | null
  historyCaptured: boolean
  repairOrderCount: number
  detailScanCount: number
  inspectionSearchStatus: 'confirmed' | 'not_identified' | 'incomplete'
  latestRepairOrder?: FordServiceRepairOrderRecord | null
  recentInspection?: FordServiceRepairOrderRecord | null
  /** Latest confirmed Certified Blue Oval inspection for the exact VIN. */
  certifiedInspection?: FordServiceRepairOrderRecord | null
  recentRepairOrders?: FordServiceRepairOrderRecord[]
  /** Every reported Ford dealer service visit, newest first. */
  repairOrderTimeline?: FordServiceHistoryVisitRecord[]
}

/**
 * Read-only Ford OASIS vehicle report facts for the exact VIN. Dates are the
 * strings OASIS printed and are never re-parsed. No owner data is carried.
 */
export interface FordOasisRecord {
  dataState?: SourceFreshness
  capturedAt?: string | null
  sourceLabel?: string | null
  vehicleDescription?: string | null
  versionSeries?: string | null
  bodyStyle?: string | null
  driveType?: string | null
  paintColor?: string | null
  paintCode?: string | null
  engine?: string | null
  engineCalibration?: string | null
  transmission?: string | null
  axleRatio?: string | null
  axleCode?: string | null
  grossVehicleWeight?: string | null
  wheelSize?: string | null
  tire?: string | null
  syncVersion?: string | null
  fuelType?: string | null
  buildDate?: string | null
  warrantyStartDate?: string | null
  releaseDate?: string | null
  monthsInService?: number | null
  saleMileage?: number | null
  openFieldServiceActions?: FordOasisFieldServiceActionRecord[]
  /** True only when the source explicitly supplied an action result. */
  openActionsCaptured?: boolean
  warrantyCoverages?: FordOasisWarrantyCoverageRecord[]
  extendedCoverageExpirations?: string[]
  serviceHistory?: FordServiceHistoryRecord | null
}

export type WarrantyCheckCoverageStatus = 'ACTIVE' | 'EXPIRED' | 'N/A'

/** One warranty coverage line. Term and remaining text stay exactly as the source printed them. */
export interface WarrantyCheckCoverageRecord {
  type: string
  termText: string
  termMonths?: number | null
  termMiles?: number | null
  unlimitedMiles?: boolean | null
  unlimitedMonths?: boolean | null
  remainingMiles?: number | null
  remainingMonths?: number | null
  remainingMilesText: string
  remainingTimeText: string
  status: WarrantyCheckCoverageStatus
  note?: string | null
}

/** AutoCheck (Experian) warranty estimate figured from the mileage entered. */
export interface WarrantyCheckAutoCheckRecord {
  inServiceDate?: string | null
  inServiceAgeMonths?: number | null
  defaultMileage?: number | null
  coverages?: WarrantyCheckCoverageRecord[]
}

/** CARFAX can report a coverage category/status without its term or balances. */
export interface WarrantyCheckCarfaxCoverageRecord extends Omit<WarrantyCheckCoverageRecord, 'termText' | 'remainingMilesText' | 'remainingTimeText'> {
  termText?: string | null
  remainingMilesText?: string | null
  remainingTimeText?: string | null
}

export interface WarrantyCheckCarfaxRecord extends Omit<WarrantyCheckAutoCheckRecord, 'coverages'> {
  coverages?: WarrantyCheckCarfaxCoverageRecord[]
}

/** Ford OASIS factory coverage for Ford/Lincoln VINs. Authoritative when present. */
export interface WarrantyCheckFordOasisRecord {
  warrantyStartDate: string
  monthsInService: number
  coverages?: WarrantyCheckCoverageRecord[]
}

/**
 * Read-only per-VIN warranty coverage check. At least one of autoCheck, carfax or
 * fordOasis is present. No owner data is carried.
 */
export interface WarrantyCheckRecord {
  dataState?: SourceFreshness
  capturedAt?: string | null
  sourceLabel?: string | null
  mileageEntered: number
  mileageSource?: string | null
  autoCheck?: WarrantyCheckAutoCheckRecord | null
  /** CARFAX report estimate, never confirmed OEM eligibility. */
  carfax?: WarrantyCheckCarfaxRecord | null
  fordOasis?: WarrantyCheckFordOasisRecord | null
}

export interface HoldSummary {
  /** A retained observation, never a claim of current hold status. */
  lastKnownActiveHold?: boolean
  lastKnownNoHold?: boolean
  state: 'primary' | 'backup' | 'multiple' | 'none_observed' | 'stale' | 'unknown'
  label: string
  canViewEvidence?: boolean
  canManage?: boolean
  primarySalesperson?: string
  backupCount: number
  expectedDate?: string
  reason?: string
  commentsCount?: number
  alertsCount?: number
  loaner?: {
    active: boolean
    program?: string | null
    label: string
    serviceDate?: string | null
    /** DealerMail alert text; the server sends it only to roles that may view private evidence. */
    rawAlert?: string | null
  } | null
}

export interface DealerMailEvidenceMessage {
  author?: string
  text?: string
  timestamp?: string
  metadataRaw?: string
  spiffRaw?: string
}

export interface DealerMailHistoryRecord {
  orderRaw?: string
  lifecycle?: string
  salesperson?: string
  customerOrReason?: string
  holdDate?: string
  expectedDate?: string
  statusLabel: string
}

export interface DealerMailPrivateEvidence {
  primary: {
    salesperson?: string
    customerOrReason?: string
    holdDate?: string
    expectedDate?: string
    heldBy?: string
  } | null
  backups: Array<{
    order?: number
    salesperson?: string
    customerOrReason?: string
    holdDate?: string
    expectedDate?: string
  }>
  comments: DealerMailEvidenceMessage[]
  alerts: DealerMailEvidenceMessage[]
  history?: DealerMailHistoryRecord[]
  cdk?: {
    result?: string
    status?: string
    fields?: Record<string, string>
  } | null
}

export interface MovementSummary {
  transferId?: string
  requestStatus?: string
  state: string
  label: string
  currentLocation: string
  currentCustodian?: string
  transportAssignee?: string
  destination?: string
  lastConfirmedAt?: string
  /** Actual departure evidence for the current trip; excludes approvals and later notes. */
  departedAt?: string
  locationConfidence: 'verified' | 'reported' | 'stale' | 'conflicting' | 'unknown'
  nextAction?: string
  nextActionOwner?: string
  /** Store that owns the next step (the Action center's actionability rule). */
  nextActionStore?: StoreName
  dueAt?: string
  returnRequired?: boolean
  returnDueAt?: string
  /**
   * The server's own decision on a new move request for this VIN: `true` when
   * createTransfer would currently refuse it with 409 ACTIVE_TRANSFER_EXISTS
   * because some ledger row — visible to this caller or not — still blocks
   * one; `false` when a well-formed cross-store request would be accepted.
   * It describes the whole ledger for the VIN, never the row whose facts
   * happen to be shown (a canceled trip's stale 'picked_up' shape can carry
   * `false`; a completed receipt can carry `true` when a store this caller
   * cannot see has requested the vehicle again). Present only in simple mode
   * for callers who may create transfers (sales, manager, group_manager);
   * absent for roles the server refuses with 403 first, in advanced mode,
   * and from older servers — treat absence as "the server did not say", not
   * as "allowed". It is one boolean with no request id, actor, store,
   * custodian, note or customer attached: the same single fact the 409
   * message already discloses to anyone who tries. Other validation (the
   * cross-store rule, role checks) can still refuse a POST before this rule
   * is evaluated; `false` is about the ledger, not a promise of acceptance.
   */
    newRequestBlocked?: boolean
    canDirectReroute?: boolean
}

export interface PublicScanAuditRecord {
  actualLocation: string | null
  locationCity: string | null
  dealerLocationId: number | null
  dealerName: string | null
  vehicleId: number | null
  genericColor: string | null
  sourceSites: string[]
  sourceCount: number | null
  firstSeen: string | null
  lastSeen: string | null
}

export type ServiceWorkflowStatus = 'needs_service' | 'in_service' | 'serviced'
/** `unknown` is accepted only when reading historical/cached records. */
export type ServiceReadinessStatus = ServiceWorkflowStatus | 'unknown'

export interface ServiceReadiness {
  vin: string
  status: ServiceReadinessStatus
  readinessBasis?: 'unconfirmed' | 'existing_inventory' | 'new_arrival' | 'manager_updated' | 'legacy_review' | 'autocheck_post_intake_inspection' | 'ford_service_history_inspection'
  version: number
  serviceEnteredAt: string | null
  completedAt: string | null
  updatedAt: string | null
  updatedBy: string | null
  updatedByRole: UserRole | null
  updatedAtStore: StoreName | null
  store: StoreName | null
  canManage: boolean
  /** Read-only source evidence; never creates a manager service event. */
  readinessEvidence?: ({
    source: 'autocheck'
    inspectionDate: string
    types: string[]
  } | {
    source: 'ford_service_history'
    inspectionDate: string
    types: string[]
    inServiceDate: string
    readyDate: string
  }) | null
  notes?: string | null
}

export interface ServiceReadinessDetail extends ServiceReadiness {
  history: ServiceReadiness[]
}

export interface ServiceReadinessInput {
  status: ServiceWorkflowStatus
  serviceDate?: string
  notes?: string
  expectedVersion: number
}

export type AppDispositionCode = 'keep' | 'sold_pending' | 'delivered' | 'wholesale' | 'transfer_out' | 'other'

/**
 * A manager's disposition recorded in Inventory Flow (server/vehicle-disposition.mjs).
 * It sits beside the imported manager log and never changes a source. The note
 * and writer's name arrive only in the detail read, for sales and managers.
 */
export interface AppDisposition {
  vin: string
  code: AppDispositionCode | null
  version: number
  effectiveDate: string | null
  destinationStore: StoreName | null
  updatedAt: string | null
  updatedByRole: 'manager' | 'group_manager' | null
  /** The writer's store. */
  store: StoreName | null
  /** The store whose manager may record this vehicle's disposition. */
  ownerStore: StoreName | null
  canManage: boolean
  updatedBy?: string | null
  note?: string | null
}

export interface AppDispositionDetail extends AppDisposition {
  otherEnabled?: boolean;
  history: AppDisposition[]
}

export interface AppDispositionInput {
  disposition: AppDispositionCode
  effectiveDate?: string
  destinationStore?: StoreName
  note?: string
  expectedVersion: number
}

export interface ManualHold {
  vin: string
  state: 'active' | 'released' | null
  version: number
  expectedDeliveryDate: string | null
  updatedAt: string | null
  ownerStore: StoreName | null
  canManage: boolean
  enabled: boolean
  customerLabel?: string | null
  note?: string | null
  updatedBy?: string | null
  ownedByCurrentUser?: boolean
}
export interface ManualHoldDetail extends ManualHold { history: ManualHold[] }
export interface ManualHoldInput {
  state: 'active' | 'released'
  expectedVersion: number
  customerLabel?: string
  expectedDeliveryDate?: string
  note?: string
}
/** Read-only provider observations; no customer or source-system writer fields. */
export interface OperationalProviderRecord {
  vin: string
  provider: string
  sourceLabel: string
  capturedAt: string
  dataState: SourceFreshness
  readOnly: true
  complete: boolean
  holdState: 'held' | 'not_observed' | 'unknown'
  reportedDisposition?: 'sold_pending' | 'delivered' | 'other' | 'not_observed' | 'unknown'
}
export interface OperationalEvidenceRecord { records: OperationalProviderRecord[] }
export interface ProviderServiceEntry {
  date: string
  odometer?: number | null
  odometerUnit?: 'mi' | 'km'
  services: string[]
}
export interface ProviderServiceReport {
  vin: string
  provider: 'oem' | 'autocheck' | 'carfax'
  sourceLabel: string
  capturedAt: string
  dataState: SourceFreshness
  historyStatus: 'reported' | 'not_reported' | 'unavailable'
  entries: ProviderServiceEntry[]
}
export interface ProviderServiceHistory { reports: ProviderServiceReport[] }
export interface InventoryDecisionEvidence extends Omit<OperationalProviderRecord, 'capturedAt'> {
  /** Absent only on the legacy DealerMail observation with no reliable timestamp. */
  capturedAt?: string
  effectiveHoldState: OperationalProviderRecord['holdState']
  comparison: 'agreement' | 'conflict' | 'source_only' | 'unverified'
  reasons: string[]
}

export interface InventoryDecision {
  status: AppDispositionCode | 'held' | 'unconfirmed'
  comparison: 'agreement' | 'conflict' | 'manual_only' | 'source_only' | 'unverified'
  reasons: string[]
  manualHold: ManualHold['state']
  importedHold: boolean | null
  label: string
  evidence?: InventoryDecisionEvidence[]
  reviewRequired?: boolean
}

export interface VehicleRecord {
  canReportIssue?: boolean
  vin: string
  stockNumber: string
  year?: number | string
  make: string
  model: string
  trim?: string
  vehicleName: string
  listedPrice?: number | null
  msrp?: number | null
  mileage?: number | null
  daysListed?: number | null
  exteriorColor?: string
  interiorColor?: string
  bodyStyle?: string
  bodyType?: string
  drivetrain?: string
  engine?: string
  transmission?: string
  fuelType?: string
  mpgCity?: number | null
  mpgHighway?: number | null
  certified?: boolean | null
  inventoryDate?: string
  dealerComments?: string
  modelCode?: string
  features?: string
  listingUrl?: string
  photoCount?: number
  imageUrl?: string | null
  imageUrls?: string[]
  publicStore: StoreName
  homeStore: StoreName
  homeStoreConfirmed: boolean
  crmStore?: StoreName
  sourceReportedLocation: StoreName
  websiteStatus: string
  publicListing?: PublicListingCode
  publicListingState: string
  dealerOn: DealerOnFlags
  managerDisposition?: ManagerDispositionRecord | null
  hold: HoldSummary
  privateEvidence?: DealerMailPrivateEvidence
  movement: MovementSummary
  serviceReadiness?: ServiceReadiness
  appDisposition?: AppDisposition | null
  manualHold?: ManualHold
  inventoryDecision?: InventoryDecision
  changeSummary?: string
  searchText?: string
  dataStatus?: string
  publicScan?: PublicScanAuditRecord
  autoCheckReport?: AutoCheckReportRecord
  windowSticker?: WindowStickerRecord
  factoryEquipment?: FactoryEquipmentRecord
  fordInvoice?: FordInvoiceRecord
  fordOasis?: FordOasisRecord
  warrantyCheck?: WarrantyCheckRecord
  operationalEvidence?: OperationalEvidenceRecord
  serviceHistory?: ProviderServiceHistory
}

export interface TransferEvent {
  id: string
  type: string
  label: string
  occurredAt: string
  actor?: string
  actorRole?: string
  store?: string
  fromLocation?: string
  toLocation?: string
  confirmedBy?: string
  note?: string
}

export interface TransferRecord {
  id: string
  workflowMode?: 'simple' | 'advanced'
  vin: string
  stockNumber: string
  vehicleName: string
  homeStore: StoreName
  requestingStore: StoreName
  currentLocation: string
  destination: string
  requestStatus: string
  movementStatus: string
  dealStatus: string
  deliveryStatus: string
  dealerMailHoldState: string
  publicListing?: PublicListingCode
  publicListingState: string
  cdkStatus: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  requestedBy: string
  requestedAt: string
  approvedBy?: string
  custodian?: string
  transportAssignee?: string
  nextAction: string
  nextActionOwner: string
  /** Store that owns the next step (the Action center's actionability rule). */
  nextActionStore?: StoreName
  dueAt?: string
  returnRequired: boolean
  returnDueAt?: string
  lastConfirmedAt?: string
  locationConfidence: 'verified' | 'reported' | 'stale' | 'conflicting' | 'unknown'
  events: TransferEvent[]
  privateEvidence?: {
    requestReason?: string
    customerReference?: string
    customerAppointment?: boolean
    approvalOwner?: string
  }
  /** Server-authorized UI actions for the active role. The server remains authoritative on every write. */
  allowedActions?: string[]
}

export interface StoreSummary {
  store: StoreName
  publicUnits: number
  currentHolds: number
  awayFromHome: number
  visiting: number
  returnOverdue: number
  locationExceptions: number
}

export type AttentionStatus = 'open' | 'acknowledged' | 'in_progress' | 'waiting' | 'resolved'
export type AttentionPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface AttentionEvent {
  id: string
  type: string
  label: string
  actor: string
  actorRole: string
  store?: StoreName
  occurredAt: string
  assignee?: string
  followUpAt?: string
  priority?: AttentionPriority
  resolutionCode?: string
  note?: string
}

/** Whether the signed-in store and role can take this item's next step today. */
export type AttentionActionability = 'actionable' | 'informational'

/** Why an item is only worth knowing about, used to group the collapsed list. */
export type AttentionInformationalReason =
  | 'source_health'
  | 'public_listing'
  | 'other_store'
  | 'role_scope'

export interface AttentionItem {
  id: string
  severity: 'info' | 'warning' | 'critical'
  type: string
  label: string
  count?: number
  vehicleName?: string
  stockNumber?: string
  store?: StoreName
  /** The store that owns the next step, when it differs from the listed store. */
  actionStore?: StoreName
  actionability?: AttentionActionability
  informationalReason?: AttentionInformationalReason | null
  owner?: string
  dueAt?: string
  href?: string
  vin?: string
  relatedStores?: StoreName[]
  sourceId?: string
  sourceLabel?: string
  whyItMatters?: string
  recommendedAction?: string
  status: AttentionStatus
  priority: AttentionPriority
  assignedTo?: string
  assignedRole?: string
  followUpAt?: string
  resolutionCode?: string
  resolutionNote?: string
  lastUpdatedAt?: string
  allowedActions: string[]
  events: AttentionEvent[]
}

export type PublicChangeType =
  | 'new_arrival'
  | 'removed'
  | 'price_change'
  | 'mileage_change'
  | 'website_status_change'
  | 'stock_correction'
  | 'store_transfer'

export interface PublicChangeEvent {
  id: string
  type: PublicChangeType
  field: string
  valueType: 'money' | 'mileage' | 'text' | 'store' | 'state'
  reportDate: string
  previousReportDate: string
  vin: string
  stockNumber: string
  vehicleName: string
  store: StoreName
  listingUrl?: string | null
  beforeValue: string | number | null
  afterValue: string | number | null
  currentVehicle: boolean
}

export interface HoldSignalSummary {
  store: StoreName
  activeHoldVins: number
  pastExpected: number
  withAlerts: number
  withComments: number
  reviewVins: number
  freshness: SourceFreshness
}

export type VehicleIssueCategory = 'cleaning' | 'fuel' | 'mechanical' | 'damage' | 'other'
export type VehicleIssueStatus = 'open' | 'in_progress' | 'awaiting_review' | 'completed'
export type VehicleIssueAction = 'assign' | 'start_work' | 'request_completion' | 'complete' | 'reopen' | 'add_note'

export interface VehicleIssue {
  id: string
  vin: string
  stockNumber: string
  vehicleName: string
  homeStore: StoreName
  reportStore: StoreName
  category: VehicleIssueCategory
  priority: 'normal' | 'urgent'
  description: string
  status: VehicleIssueStatus
  version: number
  assignee: string | null
  reportedBy: string
  reportedByUserId: string
  reportedAt: string
  updatedAt: string
  completedAt: string | null
  completedBy: string | null
  photoCount: number
  allowedActions: string[]
}

export interface VehicleIssuePhoto {
  id: string
  contentType: string
  bytes: number
  eventId: string
  createdAt: string
}

export interface VehicleIssueEvent {
  id: string
  type: string
  version: number
  note: string | null
  assignee: string | null
  status: VehicleIssueStatus
  actor: string
  actorUserId: string
  actorRole: UserRole
  store: StoreName
  createdAt: string
  photos: Array<Pick<VehicleIssuePhoto, 'id' | 'contentType' | 'bytes'>>
}

export interface VehicleIssueDetail extends VehicleIssue {
  photos: VehicleIssuePhoto[]
  events: VehicleIssueEvent[]
}

export interface VehicleIssueCreateInput {
  category: VehicleIssueCategory
  priority: 'normal' | 'urgent'
  description: string
  photos?: Array<{ data: string }>
}

export interface VehicleIssueEventInput {
  type: VehicleIssueAction
  expectedVersion: number
  assignee?: string | null
  note?: string
  photos?: Array<{ data: string }>
}

export interface BootstrapData {
  savedListsEnabled?: boolean
  access?: {
    user: string
    /** Stable server-owned membership identity; never a display-name cache key. */
    userId?: string | null
    role: UserRole
    store: StoreName
    authenticatedRole?: UserRole
    authenticatedStore?: StoreName
    canPreviewRoles?: boolean
    canPreviewStores?: boolean
    rolePreviewActive?: boolean
    storePreviewActive?: boolean
    /** Server supplied only after the signed-in user is verified as a software owner. */
    softwareAdminUrl?: string
    canViewPrivateEvidence: boolean
    canCreateTransfer: boolean
  }
  meta: SourceMeta
  stores: StoreSummary[]
  vehicles: VehicleRecord[]
  transfers: TransferRecord[]
  attention: AttentionItem[]
  holdSignals?: HoldSignalSummary[]
  managerDispositions?: ManagerDispositionRecord[]
  publicChanges?: PublicChangeEvent[]
  vehicleIssues?: VehicleIssue[]
  vehicleIssuesEnabled?: boolean
  /** False when the app's disposition table is not installed yet (D1 migration 0013). */
  dispositionsEnabled?: boolean
  manualHoldsEnabled?: boolean
  overview?: OverviewSummary
}

/** Overview thresholds published by the server (`OVERVIEW_THRESHOLDS`, server/overview-summary.mjs). */
export interface OverviewThresholds {
  unaccountedAfterDays: number
  agedListingDays: [number, number]
  serviceWaitingDays: [number, number]
  listedAfterDeliveredDays: number
  recentReceiptDays: number
}

/**
 * Per-store counts. Custody, aging, unaccounted and records counts are by the
 * vehicle's home store; `visiting` by the store it is at; service counts by
 * the service store; holds equal the Action center's `holdSignals`.
 */
export interface OverviewStoreCounts {
  store?: StoreName
  onLot: number
  /** Of `onLot`, the vehicles with no move ledger whose location is the website's store. */
  onLotSourceReported: number
  away: number
  visiting: number
  inTransit: number
  conflict: number
  /** Equal to `holdSignals[store].activeHoldVins` / `pastExpected`. */
  holds: number
  holdsPastExpected: number
  waitingForService: number
  inService: number
  ready: number
  /** Listed vehicles only. `aged60` counts 60+ days and so includes `aged90`. */
  aged60: number
  aged90: number
  unaccounted: number
  returnOverdue: number
  recordsIncomplete: number
  listed: number
  preListing: number
  /** App dispositions by the vehicle's owner store. */
  dispositions?: Record<AppDispositionCode | 'none', number>
}

export interface OverviewBoardFlow {
  from: StoreName
  to: StoreName
  kind: 'outbound' | 'return' | 'planned'
  count: number
  vins: string[]
}

export type OverviewServiceBasis =
  | 'manager_updated'
  | 'ford_service_history_inspection'
  | 'autocheck_post_intake_inspection'
  | 'new_arrival'
  | 'unconfirmed'
  | 'legacy_review'

export type OverviewArrivalBasis = 'intake' | 'listing_date' | 'unknown'

export interface OverviewVehicleService {
  status: ServiceWorkflowStatus
  basis: OverviewServiceBasis
  store: StoreName | null
  arrivalDate?: string
  arrivalBasis: OverviewArrivalBasis
  waitingDays?: number
  receiptToStartDays?: number
  inServiceDays?: number
  receiptToReadyDays?: number
  sinceServiceUpdateDays?: number
  dateOrderIssue?: true
}

export type OverviewUnaccountedReason = 'location_conflict' | 'source_conflict' | 'no_app_record' | 'stale_confirmation'

/** Day-level facts per VIN. Optional keys are omitted when they do not apply. */
export interface OverviewVehicleFacts {
  custody: 'on_lot' | 'away' | 'in_transit' | 'conflict'
  /** `source_reported` means the location is the website's store, not a recorded move. */
  custodyBasis: 'ledger' | 'source_reported'
  currentStore?: StoreName
  returnLeg?: 'return'
  daysAway?: number
  /** Away or in transit with no recorded departure: days away are unknown. */
  daysAwayBasis?: 'unknown'
  departedAt?: string
  lastConfirmedAt?: string
  returnDueAt?: string
  returnOverdue?: true
  /** ISO day of the latest recorded return home, only within `recentReceiptDays`. */
  receivedHomeAt?: string
  unaccounted?: { reason: OverviewUnaccountedReason; days?: number }
  /** From DealerMail hold rows with an active hold count above zero, never from hold label text. */
  holdActive?: true
  holdPastExpected?: true
  /** Listed vehicles only (`publicListing === 'listed'`). */
  agedBucket?: 60 | 90
  /** Pre-listing rows carry CRM age, not listing age, and have no bucket. */
  agedBasis?: 'crm_age'
  records: { autoCheck: boolean; oasis: boolean; sticker: boolean; invoice: boolean; fordHistory: boolean; factoryEquipment?: boolean }
  recordsCaptured: number
  recordsApplicable: 3 | 5
  service: OverviewVehicleService
  /** The app disposition's code; absent when none is recorded. */
  disposition?: AppDispositionCode
  holdState?: HoldSummary['state']
}

export interface OverviewMedian {
  value: number | null
  n: number
}

export interface OverviewServiceStoreMetrics {
  counts: { waitingForService: number; inService: number; ready: number }
  basis: Record<OverviewServiceBasis, number>
  arrivalBasis: Record<OverviewArrivalBasis, number>
  medians: { receiptToStartDays: OverviewMedian; inServiceDays: OverviewMedian; receiptToReadyDays: OverviewMedian }
  agedWaiting14: number
  agedWaiting30: number
}

export interface OverviewServiceMetrics {
  perStore: Array<OverviewServiceStoreMetrics & { store: StoreName }>
  group: OverviewServiceStoreMetrics
  /** Waiting at least `serviceWaitingDays[0]` days, longest first, at most 100. */
  agedWaiting: Array<{ vin: string; store: StoreName | null; waitingDays: number; arrivalBasis: OverviewArrivalBasis }>
}

export type OverviewExceptionKind =
  | 'location_conflict'
  | 'source_conflict'
  | 'no_app_record'
  | 'stale_confirmation'
  | 'return_overdue'
  | 'hold_past_expected'
  | 'identity_review'
  | 'records_incomplete'
  | 'service_date_order'
  | 'listed_but_delivered'
  | 'delivered_move_no_disposition'

export interface OverviewException {
  kind: OverviewExceptionKind
  store: StoreName
  count: number
  /** At most 50; `identity_review` is a count only. */
  vins: string[]
  transferIds?: string[]
}

/**
 * The server-computed Overview (server/overview-summary.mjs). Present for
 * managers and group managers (`access: 'full'`) and for sales
 * (`access: 'read_only'`); never for retired transport roles or the
 * integration API.
 */
export interface OverviewSummary {
  /** YYYY-MM-DD in `meta.timezone`. */
  asOfDay: string
  scopeStore: StoreName
  role: UserRole
  access: 'full' | 'read_only'
  thresholds: OverviewThresholds
  /** Always four entries, in store order. */
  stores: Array<OverviewStoreCounts & { store: StoreName }>
  group: OverviewStoreCounts
  board: { flows: OverviewBoardFlow[] }
  vehicleFacts: Record<string, OverviewVehicleFacts>
  service?: OverviewServiceMetrics
  exceptions: OverviewException[]
}

interface TransferRequestInputBase {
  vin: string
  requestingStore: StoreName
  requestedBy: string
  reason: string
  customerReference?: string
  customerAppointment: boolean
  returnRequired: boolean
  returnDueAt?: string
  priority: TransferRecord['priority']
  approvalOwner?: string
}

export type TransferRequestInput = TransferRequestInputBase & (
  | {
      intent?: 'request'
      destinationStore?: StoreName
      neededBy: string
      movedAt?: never
    }
  | {
      intent: 'direct'
      destinationStore: StoreName
      movedAt?: string
      neededBy?: never
    }
)

export interface TransferEventInput {
  type: string
  availabilityConfirmed?: boolean
  actor: string
  actorRole: UserRole
  store: StoreName
  occurredAt?: string
  homeStoreManager?: string
  note?: string
  fromLocation?: string
  toLocation?: string
  dueAt?: string
  assignee?: string
}

export interface AttentionEventInput {
  type: string
  actor: string
  actorRole: UserRole
  store: StoreName
  occurredAt?: string
  note?: string
  assignee?: string
  assignedRole?: UserRole
  followUpAt?: string
  priority?: AttentionPriority
  resolutionCode?: 'action_completed' | 'source_condition_cleared' | 'duplicate' | 'no_action_required' | 'other'
}
