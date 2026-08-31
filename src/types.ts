export const STORE_NAMES = ['Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln'] as const
export type StoreName = (typeof STORE_NAMES)[number]
export type UserRole = 'sales' | 'manager' | 'coordinator' | 'porter' | 'driver' | 'group_manager'

export type SourceFreshness = 'current' | 'stale_unverified' | 'incomplete' | 'unknown'

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
  timezone: string
  manifestPath?: string
  publicFreshness: SourceFreshness
  dealerMailFreshness: SourceFreshness
  publicCount: number
  crmCount: number
  heldVinCount: number
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

export interface AutoCheckReportRecord {
  /** VIN-specific AutoCheck URL published by the dealership vehicle page. */
  url?: string | null
  dataState?: SourceFreshness
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
  checks?: Array<{
    label: string
    status?: string | null
    detail?: string | null
  }>
}

export interface WindowStickerRecord {
  /** VIN-specific window-sticker URL published by the dealership vehicle page. */
  url?: string | null
  dataState?: SourceFreshness
  vehicleDescription?: string | null
  equipmentGroup?: string | null
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

export interface HoldSummary {
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
}

export interface DealerMailEvidenceMessage {
  author?: string
  text?: string
  timestamp?: string
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
  locationConfidence: 'verified' | 'reported' | 'stale' | 'conflicting' | 'unknown'
  nextAction?: string
  nextActionOwner?: string
  dueAt?: string
  returnRequired?: boolean
  returnDueAt?: string
}

export interface VehicleRecord {
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
  publicListingState: string
  dealerOn: DealerOnFlags
  hold: HoldSummary
  privateEvidence?: DealerMailPrivateEvidence
  movement: MovementSummary
  changeSummary?: string
  searchText?: string
  dataStatus?: string
  autoCheckReport?: AutoCheckReportRecord
  windowSticker?: WindowStickerRecord
  factoryEquipment?: FactoryEquipmentRecord
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
  note?: string
}

export interface TransferRecord {
  id: string
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

export interface AttentionItem {
  id: string
  severity: 'info' | 'warning' | 'critical'
  type: string
  label: string
  count?: number
  vehicleName?: string
  stockNumber?: string
  store?: StoreName
  owner?: string
  dueAt?: string
  href?: string
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

export interface BootstrapData {
  meta: SourceMeta
  stores: StoreSummary[]
  vehicles: VehicleRecord[]
  transfers: TransferRecord[]
  attention: AttentionItem[]
  holdSignals?: HoldSignalSummary[]
  publicChanges?: PublicChangeEvent[]
}

export interface TransferRequestInput {
  vin: string
  requestingStore: StoreName
  requestedBy: string
  neededBy: string
  reason: string
  customerReference?: string
  customerAppointment: boolean
  returnRequired: boolean
  returnDueAt?: string
  priority: TransferRecord['priority']
  approvalOwner?: string
}

export interface TransferEventInput {
  type: string
  actor: string
  actorRole: UserRole
  store: StoreName
  occurredAt?: string
  note?: string
  fromLocation?: string
  toLocation?: string
  dueAt?: string
  assignee?: string
}
