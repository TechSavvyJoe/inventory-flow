import type { RefObject } from "react";
import type { DealerMailEvidenceMessage, DealerMailHistoryRecord } from "../../types";

export type InventoryScope = "home" | "group";

export type SourceDataState = "current" | "stale" | "incomplete" | "unavailable";

export type HoldPosition = "primary" | "backup" | "multiple" | null;

export type InventoryMetricKey =
  | "publicUnits"
  | "currentHolds"
  | "awayFromHome"
  | "returnOverdue";

export interface InventoryStore {
  id: string;
  name: string;
}

export interface InventoryDecisionMetrics {
  publicUnits: number | null;
  currentHolds: number | null;
  awayFromHome: number | null;
  returnOverdue: number | null;
}

export interface InventoryGroupStore extends InventoryStore {
  distanceMiles?: number | null;
  distanceLabel?: string | null;
}

export interface PublicListingSignal {
  dataState: SourceDataState;
  isListed: boolean | null;
  websiteStatus?: string | null;
  listingUrl?: string | null;
  updatedAt?: string | null;
}

export interface DealerOnSignal {
  dataState: SourceDataState;
  inStock: boolean | null;
  inTransit: boolean | null;
  inProduction: boolean | null;
  updatedAt?: string | null;
}

export interface ManagerDispositionSignal {
  dataState: SourceDataState;
  sold: true;
  delivered: boolean;
  deliveryDate?: string | null;
  sourceStore: InventoryStore;
  sourcePeriod: string;
  confidence: "high" | "medium-high" | "medium" | "low";
  soldLabel: "Sold — manager log";
  deliveryLabel: "Delivered — manager log" | "Not marked delivered — manager log";
}

export interface AutoCheckResource {
  dataState: SourceDataState;
  url?: string | null;
  reportRunAt?: string | null;
  score?: number | null;
  scoreRangeLow?: number | null;
  scoreRangeHigh?: number | null;
  usage?: string | null;
  ownerCount?: number | null;
  lastReportedOdometer?: number | null;
  lastReportedOdometerDate?: string | null;
  vehicleClass?: string | null;
  assemblyCountry?: string | null;
  estimatedInServiceDate?: string | null;
  checks?: Array<{
    label: string;
    status?: string | null;
    detail?: string | null;
  }>;
}

export interface WindowStickerResource {
  originalMarket?: string | null;
  pricingCurrency?: string | null;
  pricingCurrencyEvidence?: string | null;
  failureReason?: string | null;
  sourceMessage?: string | null;
  dataState: SourceDataState;
  url?: string | null;
  vehicleDescription?: string | null;
  equipmentGroup?: string | null;
  basePrice?: number | null;
  totalOptions?: number | null;
  destinationCharge?: number | null;
  totalMsrp?: number | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  engine?: string | null;
  transmission?: string | null;
  options?: string[];
  standardEquipment?: string[];
  warranty?: string[];
}

export interface FactoryEquipmentPackage {
  name: string;
  code?: string | null;
  price?: number | null;
  features?: string[];
}

export interface FactoryEquipmentSectionItem {
  label: string;
  price?: number | null;
}

export interface FactoryEquipmentSection {
  name: string;
  items: FactoryEquipmentSectionItem[];
}

/**
 * Read-only vAuto/CAI informational equipment label. It describes source
 * equipment data and must not be presented as an original window sticker.
 */
export interface FactoryEquipmentResource {
  dataState: SourceDataState;
  url?: string | null;
  sourceLabel?: string | null;
  capturedAt?: string | null;
  vehicleDescription?: string | null;
  basePrice?: number | null;
  totalOptions?: number | null;
  destinationCharge?: number | null;
  totalMsrp?: number | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  engine?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  packages?: FactoryEquipmentPackage[];
  sections?: FactoryEquipmentSection[];
  disclaimer?: string | null;
  isOriginalWindowSticker: false;
}

export interface FordOasisFieldServiceAction {
  /** Ford field service action / recall code, e.g. 24N08. */
  code: string;
  description?: string | null;
}

export interface FordOasisWarrantyCoverage {
  type: string;
  description?: string | null;
}

/**
 * Read-only Ford OASIS vehicle report facts. Dates are shown exactly as OASIS
 * printed them. Open field service actions are reference evidence and never a
 * condition, hold, or availability signal.
 */
export interface FordOasisResource {
  dataState: SourceDataState;
  capturedAt?: string | null;
  sourceLabel?: string | null;
  vehicleDescription?: string | null;
  versionSeries?: string | null;
  buildDate?: string | null;
  warrantyStartDate?: string | null;
  releaseDate?: string | null;
  monthsInService?: number | null;
  saleMileage?: number | null;
  openFieldServiceActions: FordOasisFieldServiceAction[];
  warrantyCoverages: FordOasisWarrantyCoverage[];
  extendedCoverageExpirations: string[];
}

export type WarrantyCheckCoverageStatus = "ACTIVE" | "EXPIRED" | "N/A";

/** One warranty coverage line. Term and remaining text are shown exactly as the source printed them. */
export interface WarrantyCheckCoverage {
  type: string;
  termText: string;
  termMonths?: number | null;
  termMiles?: number | null;
  unlimitedMiles?: boolean | null;
  unlimitedMonths?: boolean | null;
  remainingMiles?: number | null;
  remainingMonths?: number | null;
  remainingMilesText: string;
  remainingTimeText: string;
  status: WarrantyCheckCoverageStatus;
  note?: string | null;
}

/** AutoCheck (Experian) warranty estimate figured from the mileage entered. */
export interface WarrantyCheckAutoCheckBlock {
  inServiceDate?: string | null;
  inServiceAgeMonths?: number | null;
  defaultMileage?: number | null;
  coverages: WarrantyCheckCoverage[];
}

/** Ford OASIS factory coverage for Ford/Lincoln VINs. Authoritative when present. */
export interface WarrantyCheckFordOasisBlock {
  warrantyStartDate: string;
  monthsInService: number;
  coverages: WarrantyCheckCoverage[];
}

/**
 * Read-only per-VIN warranty coverage check. Remaining coverage is reference
 * evidence and never a condition, hold, or availability signal.
 */
export interface WarrantyCheckResource {
  dataState: SourceDataState;
  capturedAt?: string | null;
  sourceLabel?: string | null;
  mileageEntered: number;
  mileageSource?: string | null;
  autoCheck: WarrantyCheckAutoCheckBlock | null;
  fordOasis: WarrantyCheckFordOasisBlock | null;
}

export interface DealerMailHoldSignal {
  dataState: SourceDataState;
  hasActiveHold: boolean | null;
  position?: HoldPosition;
  activeRecordCount?: number | null;
  conciseState?: string | null;
  canViewEvidence?: boolean;
  canManageHold?: boolean;
  redactionReason?: string | null;
  updatedAt?: string | null;
}

export interface VehicleLocationSignal {
  homeStore: InventoryStore;
  sourceReportedStore?: InventoryStore | null;
  crmStore?: InventoryStore | null;
  appConfirmedLocation?: string | null;
  appConfirmedStore?: InventoryStore | null;
  appConfirmedAt?: string | null;
  appConfirmedBy?: string | null;
  custodian?: string | null;
  transportAssignee?: string | null;
  distanceFromHomeMiles?: number | null;
  conflict?: boolean;
}

export interface VehicleMovementSignal {
  state?: string | null;
  requestStatus?: string | null;
  custodyStatus?: string | null;
  customerOutcome?: string | null;
  deliveryConfirmation?: string | null;
  requestId?: string | null;
  lastEventAt?: string | null;
  lastEventLabel?: string | null;
  nextAction?: string | null;
  dueAt?: string | null;
  overdue?: boolean;
  custodian?: string | null;
  transportAssignee?: string | null;
}

export type VehicleTimelineSource =
  | "public"
  | "dealeron"
  | "dealermail"
  | "movement"
  | "location"
  | "system";

export interface VehicleTimelineEvent {
  id: string;
  occurredAt: string;
  title: string;
  detail?: string | null;
  actorLabel?: string | null;
  locationLabel?: string | null;
  source: VehicleTimelineSource;
}

export interface DealerMailHoldEvidence {
  id: string;
  dataState?: SourceDataState;
  position?: HoldPosition;
  lifecycleStatus?: string | null;
  salesperson?: string | null;
  customerOrReason?: string | null;
  holdDate?: string | null;
  expectedDeliveryDate?: string | null;
  daysHeld?: number | null;
  commentFlag?: boolean;
  alertFlag?: boolean;
  cdkState?: string | null;
  heldBy?: string | null;
  comments?: Array<{ author?: string | null; text?: string | null; timestamp?: string | null }>;
  alerts?: Array<{ author?: string | null; text?: string | null; timestamp?: string | null; metadataRaw?: string | null; spiffRaw?: string | null }>;
}

export interface DealerMailVehicleEvidence {
  dataState: SourceDataState;
  comments: DealerMailEvidenceMessage[];
  alerts: DealerMailEvidenceMessage[];
  history: DealerMailHistoryRecord[];
}

export interface PublicScanAudit {
  actualLocation?: string | null;
  locationCity?: string | null;
  dealerLocationId?: string | number | null;
  dealerName?: string | null;
  vehicleId?: string | number | null;
  genericColor?: string | null;
  sourceSites?: string[];
  sourceCount?: number | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface InventoryVehicle {
  id: string;
  vin: string;
  stockNumber: string;
  year: number | string;
  make: string;
  model: string;
  trim?: string | null;
  vehicleName?: string | null;
  price?: number | null;
  msrp?: number | null;
  mileage?: number | null;
  daysListed?: number | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  bodyStyle?: string | null;
  bodyType?: string | null;
  drivetrain?: string | null;
  engine?: string | null;
  transmission?: string | null;
  fuelType?: string | null;
  mpgCity?: number | null;
  mpgHighway?: number | null;
  certified?: boolean | null;
  inventoryDate?: string | null;
  dealerComments?: string | null;
  modelCode?: string | null;
  photoCount?: number | null;
  features?: string[];
  imageUrl?: string | null;
  imageUrls?: string[];
  changeSummary?: string | null;
  dataStatus?: string | null;
  publicScan?: PublicScanAudit | null;
  /** Matching-only text already reduced by the server for the active role. Never render it. */
  authorizedSearchText?: string | null;
  autoCheckReport?: AutoCheckResource | null;
  windowSticker?: WindowStickerResource | null;
  factoryEquipment?: FactoryEquipmentResource | null;
  fordOasis?: FordOasisResource | null;
  warrantyCheck?: WarrantyCheckResource | null;
  publicListing: PublicListingSignal;
  dealerOn: DealerOnSignal;
  managerDisposition?: ManagerDispositionSignal | null;
  dealerMail: DealerMailHoldSignal;
  location: VehicleLocationSignal;
  movement?: VehicleMovementSignal | null;
  holdEvidence?: DealerMailHoldEvidence[];
  dealerMailEvidence?: DealerMailVehicleEvidence;
  timeline?: VehicleTimelineEvent[];
}

export type InventoryPublicFilter = "all" | "listed" | "not-listed" | "unknown";
export type InventoryDealerOnFilter =
  | "all"
  | "in-stock"
  | "in-transit"
  | "in-production"
  | "not-reported";
export type InventoryDealerMailFilter = "all" | "held" | "not-held" | "unverified";
export type InventoryMovementFilter = "all" | "active" | "overdue" | "none";

export interface InventoryFilters {
  storeId: "all" | string;
  publicListing: InventoryPublicFilter;
  dealerOn: InventoryDealerOnFilter;
  dealerMail: InventoryDealerMailFilter;
  movement: InventoryMovementFilter;
  minimumPrice?: number;
  maximumPrice?: number;
  maximumMileage?: number;
}

export type InventorySortKey =
  | "vehicle"
  | "year"
  | "makeModel"
  | "trim"
  | "bodyStyle"
  | "exteriorColor"
  | "engine"
  | "transmission"
  | "fuelType"
  | "stock"
  | "vin"
  | "homeStore"
  | "price"
  | "msrp"
  | "mileage"
  | "daysListed"
  | "inventoryDate"
  | "holdStatus"
  | "websiteStatus"
  | "movementStatus"
  | "recentActivity"
  | "photoCount"
  | "autoCheckScore"
  | "documentAvailability"
  | "salesperson"
  | "certified"
  | "currentLocation"
  | "lastMovement";

export interface InventorySort {
  key: InventorySortKey;
  direction: "asc" | "desc";
}

export interface InventoryViewState {
  scope: InventoryScope;
  query: string;
  filters: InventoryFilters;
  sorts: InventorySort[];
}

export type VehicleWorkspaceTab = "overview" | "equipment" | "movement" | "hold" | "timeline" | "data";

export type InventorySourceRecord = "public" | "dealeron" | "dealermail" | "movement";

export interface InventoryExperienceProps {
  homeStore: InventoryStore;
  vehicles: InventoryVehicle[];
  metrics: InventoryDecisionMetrics;
  groupStores?: InventoryGroupStore[];
  title?: string;
  initialScope?: InventoryScope;
  scope?: InventoryScope;
  initialQuery?: string;
  /** Separates session-only recent searches by the current signed-in/preview context. */
  searchPersistenceKey?: string;
  initialFilters?: Partial<InventoryFilters>;
  initialSorts?: InventorySort[];
  selectedVehicleId?: string | null;
  defaultSelectedVehicleId?: string | null;
  pageSize?: number;
  canRequestVehicle?: boolean | ((vehicle: InventoryVehicle) => boolean);
  onScopeChange?: (scope: InventoryScope) => void;
  onViewStateChange?: (state: InventoryViewState) => void;
  onSelectedVehicleChange?: (vehicleId: string | null) => void;
  onMetricSelect?: (metric: InventoryMetricKey) => void;
  onGroupStoreSelect?: (store: InventoryStore) => void;
  onViewVehicle?: (vehicle: InventoryVehicle) => void;
  onRequestVehicle?: (vehicle: InventoryVehicle) => void;
  onTrackMovement?: (vehicle: InventoryVehicle) => void;
  onOpenListing?: (vehicle: InventoryVehicle) => void;
  onOpenSourceRecord?: (
    vehicle: InventoryVehicle,
    source: InventorySourceRecord,
  ) => void;
  className?: string;
  "aria-label"?: string;
}

export interface InventoryDecisionRailProps {
  metrics: InventoryDecisionMetrics;
  onSelect?: (metric: InventoryMetricKey) => void;
}

export interface InventoryTableProps {
  vehicles: InventoryVehicle[];
  selectedVehicleId?: string | null;
  sorts: InventorySort[];
  onSortChange: (sorts: InventorySort[]) => void;
  onSelectVehicle: (vehicle: InventoryVehicle, section?: VehicleWorkspaceTab) => void;
  canRequestVehicle?: boolean | ((vehicle: InventoryVehicle) => boolean);
  onRequestVehicle?: (vehicle: InventoryVehicle) => void;
  onTrackMovement?: (vehicle: InventoryVehicle) => void;
  onOpenListing?: (vehicle: InventoryVehicle) => void;
  onOpenSourceRecord?: (
    vehicle: InventoryVehicle,
    source: InventorySourceRecord,
  ) => void;
}

export interface VehicleWorkspaceProps {
  vehicle: InventoryVehicle;
  homeStore: InventoryStore;
  canRequestVehicle?: boolean;
  initialTab?: VehicleWorkspaceTab;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onViewVehicle?: (vehicle: InventoryVehicle) => void;
  onRequestVehicle?: (vehicle: InventoryVehicle) => void;
  onTrackMovement?: (vehicle: InventoryVehicle) => void;
  onOpenListing?: (vehicle: InventoryVehicle) => void;
  onOpenSourceRecord?: (
    vehicle: InventoryVehicle,
    source: InventorySourceRecord,
  ) => void;
}
