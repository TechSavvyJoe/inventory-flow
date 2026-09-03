import type {
  DealerMailHoldSignal,
  InventoryFilters,
  InventorySort,
  InventorySortKey,
  InventoryStore,
  InventoryVehicle,
  SourceDataState,
  WindowStickerResource,
} from "./types";
import {
  buildInventorySearchEntry,
  inventoryVehicleMatchesSearch,
} from "./inventory-search";

export const DEFAULT_INVENTORY_FILTERS: InventoryFilters = {
  storeId: "all",
  publicListing: "all",
  dealerOn: "all",
  dealerMail: "all",
  movement: "all",
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

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatMoney(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? moneyFormatter.format(value)
    : "Not published";
}

/** Original document prices retain their currency; they are never converted to the listing currency. */
export function formatStickerMoney(value: number | null | undefined, sticker: Pick<WindowStickerResource, "pricingCurrency" | "originalMarket">): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not published";
  const currency = sticker.pricingCurrency?.trim().toUpperCase();
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 0 }).format(value);
  }
  return `${integerFormatter.format(value)} (original sticker currency; verify)`;
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
  if (!value) return "Not recorded";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormatter.format(parsed);
}

export function vehicleDisplayName(vehicle: InventoryVehicle): string {
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

export function sourceStateLabel(state: SourceDataState): string {
  switch (state) {
    case "current":
      return "Current source";
    case "stale":
      return "Stale source";
    case "incomplete":
      return "Incomplete source";
    case "unavailable":
      return "Source unavailable";
  }
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
  if (signal.dataState !== "current") return "Hold status not verified";
  if (signal.hasActiveHold === true) {
    if (signal.conciseState?.trim()) return signal.conciseState;
    if (signal.position === "backup") return "DealerMail backup hold";
    if (signal.position === "multiple") return "DealerMail holds";
    return "DealerMail hold";
  }
  if (signal.hasActiveHold === false) return "No current DealerMail hold found";
  return "DealerMail hold not provided";
}

export function vehicleSearchText(vehicle: InventoryVehicle): string {
  return buildInventorySearchEntry(vehicle).foldedText;
}

export function vehicleMatchesQuery(vehicle: InventoryVehicle, query: string): boolean {
  return inventoryVehicleMatchesSearch(vehicle, query);
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
  if (filters.dealerMail === "held" && dealerMail.hasActiveHold !== true) return false;
  if (
    filters.dealerMail === "not-held" &&
    !(dealerMail.dataState === "current" && dealerMail.hasActiveHold === false)
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
      return vehicle.msrp ?? null;
    case "mileage":
      return vehicle.mileage ?? null;
    case "daysListed":
      return vehicle.daysListed ?? null;
    case "inventoryDate":
      return sortableDate(vehicle.inventoryDate);
    case "holdStatus":
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
        vehicle.windowSticker?.url,
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
          : String(leftValue).localeCompare(String(rightValue), undefined, {
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
    filters.storeId !== "all",
    filters.publicListing !== "all",
    filters.dealerOn !== "all",
    filters.dealerMail !== "all",
    filters.movement !== "all",
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
  msrp: "MSRP",
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
