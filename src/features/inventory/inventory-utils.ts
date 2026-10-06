import { displayDate } from "../../lib/date-display";
import type { TransferRecord } from "../../types";
import { serviceWorkflowStatus } from "../../lib/service-readiness";
import { availableWindowStickerUrl } from "./vehicle-document-utils";
import { factoryPricing } from "../../../extension/sidepanel/lib/factory-pricing.mjs";
import type {
  DealerMailHoldSignal,
  InventoryFilters,
  InventorySort,
  InventorySortKey,
  InventoryStore,
  InventoryMoveAction,
  InventoryVehicle,
  WindowStickerResource,
} from "./types";

export const DEFAULT_INVENTORY_FILTERS: InventoryFilters = {
  storeId: "all",
  publicListing: "all",
  dealerOn: "all",
  dealerMail: "all",
  movement: "all",
  serviceReadiness: "all",
  disposition: "all",
};

export const DEFAULT_INVENTORY_SORTS: InventorySort[] = [
  { key: "lastMovement", direction: "desc" },
  { key: "vehicle", direction: "asc" },
];

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function formatMoney(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? moneyFormatter.format(value)
    : "Not published";
}

/** Original document prices retain an explicit source currency when one is available. */
export function formatStickerMoney(value: number | null | undefined, sticker: Pick<WindowStickerResource, "pricingCurrency" | "originalMarket">): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not published";
  const currency = sticker.pricingCurrency?.trim().toUpperCase();
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: currency === "USD" ? "symbol" : "code", minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 }).format(value);
}

export function formatMileage(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${integerFormatter.format(value)} mi`
    : "Not published";
}

export function formatNumber(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? integerFormatter.format(value)
    : "—";
}

export function formatDate(value?: string | null): string {
  return value ? displayDate(value) : "Not recorded";
}

export function formatDateTime(value?: string | null): string {
  return value ? displayDate(value, { time: true }) : "Not recorded";
}

export function vehicleDisplayName(vehicle: Partial<Pick<InventoryVehicle, "vehicleName" | "year" | "make" | "model" | "trim">>): string {
  const supplied = vehicle.vehicleName?.trim();
  if (supplied) return supplied;
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((part) => part !== null && part !== undefined && `${part}`.trim())
    .join(" ");
}

export function sameStore(
  left?: InventoryStore | null,
  right?: InventoryStore | null,
): boolean {
  if (!left || !right) return false;
  return left.id === right.id || left.name.toLowerCase() === right.name.toLowerCase();
}

export interface ResolvedLocation {
  label: string;
  provenance: "app-confirmed" | "source-reported" | "unknown";
  detail: string;
  store?: InventoryStore;
}

export function resolveCurrentLocation(vehicle: InventoryVehicle): ResolvedLocation {
  const location = vehicle.location;
  if (location.conflict) {
    // The app's own records disagree about where the vehicle is. Never fall
    // back to a store name here: the server reports 'Unknown' with
    // 'conflicting' confidence and labels it "Location needs checking".
    return {
      label: "Location needs checking",
      provenance: "app-confirmed",
      detail: "Conflicting location records",
    };
  }
  if (location.appConfirmedLocation?.trim() || location.appConfirmedStore) {
    const label =
      location.appConfirmedLocation?.trim() || location.appConfirmedStore?.name || "Confirmed location";
    return {
      label,
      provenance: "app-confirmed",
      detail: location.appConfirmedAt
        ? `App confirmed ${formatDateTime(location.appConfirmedAt)}`
        : "App confirmed location",
      store: location.appConfirmedStore ?? undefined,
    };
  }

  if (location.sourceReportedStore) {
    return {
      label: location.sourceReportedStore.name,
      provenance: "source-reported",
      detail: "Source-reported store",
      store: location.sourceReportedStore,
    };
  }

  return {
    label: "Location not confirmed",
    provenance: "unknown",
    detail: "No current location evidence",
  };
}

/**
 * Where "Track movement" may navigate. The adapter leaves `requestId` null when
 * the server withheld the transfer link: custody is real, but the moves page
 * never received that record for this role or store, so there is nowhere to go.
 */
export function movementTrackingPath(vehicle: InventoryVehicle): string | null {
  const requestId = vehicle.movement?.requestId?.trim();
  return requestId ? `/transfers?id=${encodeURIComponent(requestId)}` : null;
}

/**
 * The server's word on whether a new move request would be refused
 * (movement.newRequestBlocked, mapped to `moveRequestBlocked`). Only when the
 * server did not publish a decision — an older deployment, or the advanced
 * engine — does the client fall back to its own guess that an open move
 * blocks one. Absence never means "allowed".
 */
export function isMoveRequestBlocked(vehicle: InventoryVehicle): boolean {
  return vehicle.moveRequestBlocked ?? Boolean(vehicle.movement);
}

/**
 * Whether this user may start a move request for the vehicle. Role and home
 * store are the client's rules; whether the ledger blocks a new request is the
 * server's. It decides over every row for the VIN, so a completed receipt and
 * a canceled-after-departure trip both publish "not blocked" while a request
 * from a store this user cannot see publishes "blocked" — neither of which
 * the movement signal alone could tell apart.
 */
export function canRequestVehicleMove(
  vehicle: InventoryVehicle,
  role: string,
  homeStoreId: string,
): boolean {
  return (
    ["sales", "manager", "group_manager"].includes(role) &&
    vehicle.location.homeStore.id !== homeStoreId &&
    !isMoveRequestBlocked(vehicle)
  );
}

/**
 * Resolve the single creation action that belongs on the SRP and VDP.
 * Salespeople request another store's vehicle. Store managers may also send
 * their own inventory directly, while group managers may directly move any
 * vehicle. An open ledger entry remains a Track action and is handled by the
 * caller before this resolver is used.
 */
export function vehicleMoveAction(
  vehicle: InventoryVehicle,
  role: string,
  workingStore: InventoryStore,
): InventoryMoveAction | null {
  const belongsToWorkingStore = sameStore(vehicle.location.homeStore, workingStore);

  if (isMoveRequestBlocked(vehicle)) {
    // A blocking direct move is not a dead end for the people who own its
    // location decision. The server still verifies that the active row is a
    // direct move and atomically supersedes it; this flag only makes that
    // authorized path reachable without taking Track away.
    if (vehicle.movement?.canDirectReroute === true && (role === "group_manager" || (role === "manager" && belongsToWorkingStore))) {
      return { intent: "direct", label: "Move again", shortLabel: "Move again" };
    }
    return null;
  }

  if (role === "group_manager") {
    return { intent: "direct", label: "Move vehicle", shortLabel: "Move" };
  }
  if (role === "manager" && belongsToWorkingStore) {
    return { intent: "direct", label: "Move to another store", shortLabel: "Move" };
  }
  if (["sales", "manager"].includes(role) && !belongsToWorkingStore) {
    return {
      intent: "request",
      label: `Request to ${workingStore.name}`,
      shortLabel: "Request",
    };
  }
  return null;
}

export function publicListingLabel(vehicle: InventoryVehicle): string {
  const signal = vehicle.publicListing;
  if (signal.dataState !== "current" && signal.isListed !== true) {
    return "Public status not verified";
  }
  if (signal.isListed === true) return "Public listing";
  if (signal.isListed === false) return "Not publicly listed";
  return "Public listing unknown";
}

export function dealerMailHoldLabel(signal: DealerMailHoldSignal): string {
  if (signal.dataState !== "current") return signal.lastKnownActiveHold ? "Last verified hold — confirm in DealerMail" : "Hold status not verified";
  if (signal.loaner?.active) {
    return signal.loaner.serviceDate ? `${signal.loaner.label} · ${signal.loaner.serviceDate}` : signal.loaner.label;
  }
  if (signal.hasActiveHold === true) {
    if (signal.conciseState?.trim()) return signal.conciseState;
    if (signal.position === "backup") return "DealerMail backup hold";
    if (signal.position === "multiple") return "DealerMail holds";
    return "DealerMail hold";
  }
  if (signal.hasActiveHold === false) return "No current DealerMail hold found";
  return "DealerMail hold not provided";
}

/**
 * An Overview view, judged only from the server's day-level
 * facts (never a label). Custody, aging, unaccounted, return and records views
 * are by home store; Visiting by the store the vehicle is at; holds by the
 * DealerMail store, with an all-store view for active hold signals.
 */
export function vehicleMatchesOverviewView(
  vehicle: InventoryVehicle,
  { view, store }: NonNullable<InventoryFilters["overviewView"]>,
): boolean {
  if (view.startsWith("disposition-")) {
    // By the role-independent owner store the server counted it under.
    const owner = vehicle.appDisposition?.ownerStore ?? vehicle.location.homeStore.name;
    const code = vehicle.appDisposition?.code ?? "none";
    return owner === store && view === `disposition-${code.replaceAll("_", "-")}`;
  }
  const facts = vehicle.overview;
  const home = vehicle.location.homeStore.name === store;
  if (!facts) return view === "on-lot" && home;
  switch (view) {
    case "on-lot": return home && facts.custody === "on_lot";
    case "away": return home && facts.custody === "away";
    case "visiting": return !home && facts.custody === "away" && facts.currentStore === store;
    case "in-transit": return home && facts.custody === "in_transit";
    case "conflict": return home && facts.custody === "conflict";
    case "unaccounted": return home && Boolean(facts.unaccounted);
    case "return-overdue": return home && facts.returnOverdue === true;
    case "aged-60": return home && Boolean(facts.agedBucket);
    case "aged-90": return home && facts.agedBucket === 90;
    case "records-incomplete": return home && facts.recordsCaptured < facts.recordsApplicable;
    case "holds":
    case "holds-past-expected": {
      const holdStore = vehicle.location.crmStore?.name ?? vehicle.location.homeStore.name;
      return (store === "all" || holdStore === store) && facts.holdActive === true && (view === "holds" || facts.holdPastExpected === true);
    }
    default: return false;
  }
}

export function vehicleMatchesFilters(
  vehicle: InventoryVehicle,
  filters: InventoryFilters,
  options: { ignoreStore?: boolean } = {},
): boolean {
  if (
    !options.ignoreStore &&
    filters.storeId !== "all" &&
    vehicle.location.homeStore.id !== filters.storeId
  ) {
    return false;
  }

  if (filters.disposition && filters.disposition !== "all") {
    if (filters.disposition === "conflict") {
      if (vehicle.inventoryDecision?.comparison !== "conflict") return false;
    } else if ((vehicle.appDisposition?.code ?? "none") !== filters.disposition) return false;
  }
  const listed = vehicle.publicListing.isListed;
  if (filters.publicListing === "listed" && listed !== true) return false;
  if (filters.publicListing === "not-listed" && listed !== false) return false;
  if (filters.publicListing === "unknown" && listed !== null) return false;

  const dealerOn = vehicle.dealerOn;
  if (filters.dealerOn === "in-stock" && dealerOn.inStock !== true) return false;
  if (filters.dealerOn === "in-transit" && dealerOn.inTransit !== true) return false;
  if (filters.dealerOn === "in-production" && dealerOn.inProduction !== true) return false;
  if (
    filters.dealerOn === "not-reported" &&
    !(dealerOn.inStock === null && dealerOn.inTransit === null && dealerOn.inProduction === null)
  ) {
    return false;
  }

  const dealerMail = vehicle.dealerMail;
  if (filters.dealerMail === "held" && vehicle.manualHold?.state !== "active" && dealerMail.hasActiveHold !== true && !dealerMail.lastKnownActiveHold) return false;
  if (
    filters.dealerMail === "not-held" &&
    !(vehicle.manualHold?.state !== "active" && dealerMail.dataState === "current" && dealerMail.hasActiveHold === false)
  ) {
    return false;
  }
  if (
    filters.dealerMail === "unverified" &&
    dealerMail.dataState === "current" &&
    dealerMail.hasActiveHold !== null
  ) {
    return false;
  }

  const movement = vehicle.movement;
  const hasMovement = Boolean(
    movement &&
      (movement.state || movement.requestStatus || movement.custodyStatus || movement.requestId),
  );
  if (filters.movement === "active" && !hasMovement) return false;
  if (filters.movement === "none" && hasMovement) return false;
  if (filters.movement === "overdue" && movement?.overdue !== true) return false;

  if (filters.overviewView && !vehicleMatchesOverviewView(vehicle, filters.overviewView)) return false;
  if (filters.vins && !filters.vins.includes(vehicle.vin)) return false;

  // Only an explicit manager service record establishes completion. Website
  // status, a hold, physical location, or a warranty date cannot imply service.
  if (filters.serviceReadiness && filters.serviceReadiness !== "all" &&
    serviceWorkflowStatus(vehicle.serviceReadiness) !== (filters.serviceReadiness === "unknown" ? "needs_service" : filters.serviceReadiness)) return false;

  if (
    typeof filters.minimumPrice === "number" &&
    (typeof vehicle.price !== "number" || vehicle.price < filters.minimumPrice)
  ) {
    return false;
  }
  if (
    typeof filters.maximumPrice === "number" &&
    (typeof vehicle.price !== "number" || vehicle.price > filters.maximumPrice)
  ) {
    return false;
  }
  if (
    typeof filters.maximumMileage === "number" &&
    (typeof vehicle.mileage !== "number" || vehicle.mileage > filters.maximumMileage)
  ) {
    return false;
  }

  return true;
}

function sortableDate(value?: string | null): string | number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value.toLocaleLowerCase() : parsed;
}

function hasActiveMovement(vehicle: InventoryVehicle): boolean {
  const movement = vehicle.movement;
  return Boolean(
    movement &&
      (movement.state || movement.requestStatus || movement.custodyStatus || movement.requestId),
  );
}

function mostRecentActivity(vehicle: InventoryVehicle): string | number | null {
  const dates = [
    vehicle.publicListing.updatedAt,
    vehicle.dealerOn.updatedAt,
    vehicle.dealerMail.updatedAt,
    vehicle.movement?.lastEventAt,
    ...(vehicle.timeline ?? []).map((event) => event.occurredAt),
  ]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : null;
}

function sortValue(vehicle: InventoryVehicle, key: InventorySortKey): string | number | null {
  switch (key) {
    case "vehicle":
      return vehicleDisplayName(vehicle).toLocaleLowerCase();
    case "year": {
      const numericYear = Number(vehicle.year);
      return Number.isFinite(numericYear) ? numericYear : String(vehicle.year).toLocaleLowerCase();
    }
    case "makeModel":
      return [vehicle.make, vehicle.model, vehicle.trim]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
    case "trim":
      return vehicle.trim?.trim().toLocaleLowerCase() || null;
    case "bodyStyle":
      return (vehicle.bodyStyle || vehicle.bodyType)?.trim().toLocaleLowerCase() || null;
    case "exteriorColor":
      return vehicle.exteriorColor?.trim().toLocaleLowerCase() || null;
    case "engine":
      return vehicle.engine?.trim().toLocaleLowerCase() || null;
    case "transmission":
      return vehicle.transmission?.trim().toLocaleLowerCase() || null;
    case "fuelType":
      return vehicle.fuelType?.trim().toLocaleLowerCase() || null;
    case "stock":
      return vehicle.stockNumber.toLocaleLowerCase();
    case "vin":
      return vehicle.vin.toLocaleLowerCase();
    case "homeStore":
      return vehicle.location.homeStore.name.toLocaleLowerCase();
    case "price":
      return vehicle.price ?? null;
    case "msrp":
      return factoryPricing(vehicle).original.value;
    case "mileage":
      return vehicle.mileage ?? null;
    case "daysListed":
      return vehicle.daysListed ?? null;
    case "inventoryDate":
      return sortableDate(vehicle.inventoryDate);
    case "holdStatus":
      if (vehicle.manualHold?.state === "active") return 0;
      if (vehicle.dealerMail.dataState !== "current" || vehicle.dealerMail.hasActiveHold === null) return 2;
      return vehicle.dealerMail.hasActiveHold ? 0 : 1;
    case "websiteStatus":
      return (
        vehicle.publicListing.websiteStatus?.trim() ||
        (vehicle.publicListing.isListed === true
          ? "listed"
          : vehicle.publicListing.isListed === false
            ? "not listed"
            : "unknown")
      ).toLocaleLowerCase();
    case "movementStatus":
      if (vehicle.movement?.overdue) return 0;
      return hasActiveMovement(vehicle) ? 1 : 2;
    case "recentActivity":
      return mostRecentActivity(vehicle);
    case "photoCount":
      return vehicle.photoCount ?? null;
    case "autoCheckScore":
      return vehicle.autoCheckReport?.score ?? null;
    case "documentAvailability":
      return [
        vehicle.autoCheckReport?.url,
        availableWindowStickerUrl(vehicle.windowSticker, vehicle.publicListing.listingUrl),
        vehicle.factoryEquipment?.url,
      ].filter(Boolean).length;
    case "salesperson":
      if (vehicle.dealerMail.canViewEvidence !== true) return null;
      return vehicle.holdEvidence
        ?.find((record) => record.position === "primary" || record.position === "multiple")
        ?.salesperson?.trim().toLocaleLowerCase() || null;
    case "certified":
      return vehicle.certified === null || vehicle.certified === undefined
        ? null
        : vehicle.certified
          ? 1
          : 0;
    case "currentLocation":
      return resolveCurrentLocation(vehicle).label.toLocaleLowerCase();
    case "lastMovement":
      return sortableDate(vehicle.movement?.lastEventAt);
  }
}

export function sortVehicles(
  vehicles: InventoryVehicle[],
  sorts: InventorySort[],
): InventoryVehicle[] {
  const indexed = vehicles.map((vehicle, index) => ({ vehicle, index }));
  indexed.sort((left, right) => {
    for (const sort of sorts) {
      const leftValue = sortValue(left.vehicle, sort.key);
      const rightValue = sortValue(right.vehicle, sort.key);
      if (leftValue === rightValue) continue;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "en-US", {
              numeric: true,
              sensitivity: "base",
            });
      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    }
    return left.index - right.index;
  });
  return indexed.map(({ vehicle }) => vehicle);
}

export function updateMultiSort(
  current: InventorySort[],
  key: InventorySortKey,
  additive: boolean,
): InventorySort[] {
  const existing = current.find((sort) => sort.key === key);
  const next: InventorySort = {
    key,
    direction: existing?.direction === "asc" ? "desc" : "asc",
  };

  if (!additive) return [next];
  const without = current.filter((sort) => sort.key !== key);
  return [...without, next].slice(0, 5);
}

export function activeFilterCount(filters: InventoryFilters): number {
  return [
    Boolean(filters.overviewView),
    Boolean(filters.vins),
    filters.storeId !== "all",
    filters.publicListing !== "all",
    filters.dealerOn !== "all",
    filters.dealerMail !== "all",
    filters.movement !== "all",
    Boolean(filters.serviceReadiness && filters.serviceReadiness !== "all"),
    Boolean(filters.disposition && filters.disposition !== "all"),
    typeof filters.minimumPrice === "number",
    typeof filters.maximumPrice === "number",
    typeof filters.maximumMileage === "number",
  ].filter(Boolean).length;
}

export const SORT_LABELS: Record<InventorySortKey, string> = {
  vehicle: "Vehicle",
  year: "Year",
  makeModel: "Make, model & trim",
  trim: "Trim / series",
  bodyStyle: "Body style",
  exteriorColor: "Exterior color",
  engine: "Engine",
  transmission: "Transmission",
  fuelType: "Fuel type",
  stock: "Stock",
  vin: "VIN",
  homeStore: "Home location",
  price: "Price",
  msrp: "Original MSRP",
  mileage: "Mileage",
  daysListed: "Days listed",
  inventoryDate: "Inventory date",
  holdStatus: "Hold status",
  websiteStatus: "Website status",
  movementStatus: "Movement attention",
  recentActivity: "Latest source update",
  photoCount: "Photo count",
  autoCheckScore: "AutoCheck score",
  documentAvailability: "Vehicle documents",
  salesperson: "Hold salesperson",
  certified: "Certified",
  currentLocation: "Current location",
  lastMovement: "Last movement",
};

const CLOSED_REQUEST_STATES = new Set(["declined", "canceled", "closed", "returned_home"]);

/**
 * One transfer per VIN to join with its vehicle. bootstrap.transfers is listed
 * newest-first, so a plain Map kept the OLDEST row; when a party store sees a
 * closed trip and a newer open request for the same VIN, the open one must
 * win. Closed rows are still handed over when nothing is open — the adapter
 * uses them as timeline history only. Mirrors the extension's join.
 */
export function transferByVin(transfers: TransferRecord[]): Map<string, TransferRecord> {
  const byVin = new Map<string, TransferRecord>()
  for (const transfer of transfers) {
    const current = byVin.get(transfer.vin)
    if (!current) { byVin.set(transfer.vin, transfer); continue }
    const currentOpen = !CLOSED_REQUEST_STATES.has(current.requestStatus)
    const candidateOpen = !CLOSED_REQUEST_STATES.has(transfer.requestStatus)
    // Newest-first listing: keep the first open row seen; replace a closed row with an open one.
    if (!currentOpen && candidateOpen) byVin.set(transfer.vin, transfer)
  }
  return byVin
}
