import { addSearchField, foldSearchText, parseSearchTerms, scoreSearchTerm, type SearchField, type SearchFieldInput } from "../../lib/search";
import type { InventoryVehicle } from "./types";

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SYNTHETIC_PIPE_SEPARATOR = /\s+\|\s+/g;

export interface InventorySearchIndexEntry {
  vehicle: InventoryVehicle;
  fields: SearchField[];
  literalText: string;
  foldedText: string;
}

export interface InventorySearchMatch {
  vehicle: InventoryVehicle;
  score: number;
  matchedLabels: string[];
}

export interface InventorySearchIndexes {
  /** Fields staff can recognize on a vehicle card or row. */
  direct: InventorySearchIndexEntry[];
  /** Direct fields plus role-authorized background search text. */
  authorized: InventorySearchIndexEntry[];
}

function numberAliases(value: number | null | undefined, kind: "money" | "mileage"): string[] {
  if (typeof value !== "number" || !Number.isFinite(value)) return [];
  const integer = Math.round(value);
  const formatted = integerFormatter.format(integer);
  return kind === "money"
    ? [String(integer), formatted, moneyFormatter.format(integer)]
    : [String(integer), formatted, `${formatted} mi`, `${formatted} miles`];
}

function booleanSignal(label: string, value: boolean | null): string | null {
  if (value === null) return null;
  return `${label} ${value ? "yes" : "no"}`;
}

function vehicleName(vehicle: InventoryVehicle): string {
  return vehicle.vehicleName?.trim() ||
    [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
      .filter((part) => part !== null && part !== undefined && String(part).trim())
      .join(" ");
}

function addFields(target: SearchField[], inputs: SearchFieldInput[]): void {
  for (const input of inputs) addSearchField(target, input);
}

export function buildInventorySearchEntry(
  vehicle: InventoryVehicle,
  options: { includeAuthorizedDetails?: boolean } = {},
): InventorySearchIndexEntry {
  const fields: SearchField[] = [];
  const includeAuthorizedDetails = options.includeAuthorizedDetails !== false;

  addFields(fields, [
    { label: "Stock", value: vehicle.stockNumber, priority: 42, identifier: true },
    { label: "VIN", value: vehicle.vin, priority: 44, identifier: true },
    { label: "Vehicle", value: vehicleName(vehicle), priority: 34 },
    { label: "Year", value: vehicle.year, priority: 22 },
    { label: "Make", value: vehicle.make, priority: 30 },
    { label: "Model", value: vehicle.model, priority: 32 },
    { label: "Trim", value: vehicle.trim, priority: 28 },
    { label: "Exterior color", value: vehicle.exteriorColor, priority: 18 },
    { label: "Interior color", value: vehicle.interiorColor, priority: 16 },
    { label: "Body style", value: vehicle.bodyStyle, priority: 20 },
    { label: "Drivetrain", value: vehicle.drivetrain, priority: 18 },
    { label: "Engine", value: vehicle.engine, priority: 18 },
    { label: "Transmission", value: vehicle.transmission, priority: 16 },
    { label: "Fuel type", value: vehicle.fuelType, priority: 14 },
    { label: "Home store", value: vehicle.location.homeStore.name, priority: 24 },
    { label: "Reported store", value: vehicle.location.sourceReportedStore?.name, priority: 20 },
    { label: "CRM store", value: vehicle.location.crmStore?.name, priority: 20 },
    { label: "Current location", value: vehicle.location.appConfirmedLocation, priority: 24 },
    { label: "Current location", value: vehicle.location.appConfirmedStore?.name, priority: 24 },
    { label: "Custodian", value: vehicle.location.custodian, priority: 16 },
    { label: "Transport assignee", value: vehicle.location.transportAssignee, priority: 16 },
    { label: "Website status", value: vehicle.publicListing.websiteStatus, priority: 12 },
    { label: "DealerMail hold", value: vehicle.dealerMail.conciseState, priority: 22 },
    { label: "DealerMail loaner", value: vehicle.dealerMail.loaner?.label, priority: 23 },
    { label: "DealerMail loaner", value: vehicle.dealerMail.loaner?.serviceDate, priority: 21 },
    { label: "DealerMail loaner", value: vehicle.dealerMail.loaner?.rawAlert, priority: 21 },
    { label: "Hold position", value: vehicle.dealerMail.position, priority: 20 },
    { label: "Movement", value: vehicle.movement?.state, priority: 20 },
    { label: "Movement", value: vehicle.movement?.requestStatus, priority: 18 },
    { label: "Movement", value: vehicle.movement?.custodyStatus, priority: 18 },
    { label: "Movement", value: vehicle.movement?.customerOutcome, priority: 16 },
    { label: "Movement", value: vehicle.movement?.deliveryConfirmation, priority: 16 },
    { label: "Next action", value: vehicle.movement?.nextAction, priority: 18 },
    { label: "Change", value: vehicle.changeSummary, priority: 10 },
    { label: "DealerOn", value: booleanSignal("DealerOn in stock", vehicle.dealerOn.inStock), priority: 10 },
    { label: "DealerOn", value: booleanSignal("DealerOn in transit", vehicle.dealerOn.inTransit), priority: 10 },
    { label: "DealerOn", value: booleanSignal("DealerOn in production", vehicle.dealerOn.inProduction), priority: 10 },
  ]);

  for (const value of numberAliases(vehicle.price, "money")) {
    addSearchField(fields, { label: "Price", value, priority: 25 });
  }
  for (const value of numberAliases(vehicle.msrp, "money")) {
    addSearchField(fields, { label: "MSRP", value, priority: 18 });
  }
  for (const value of numberAliases(vehicle.mileage, "mileage")) {
    addSearchField(fields, { label: "Mileage", value, priority: 23 });
  }
  addSearchField(fields, { label: "Days listed", value: vehicle.daysListed, priority: 12 });

  for (const feature of vehicle.features ?? []) {
    addSearchField(fields, { label: "Feature", value: feature, priority: 16 });
  }

  // The server constructs this from fields already authorized for the active
  // role. It is deliberately matching-only: hidden text never becomes a
  // suggestion excerpt or matched-field label.
  if (includeAuthorizedDetails && vehicle.authorizedSearchText) {
    addSearchField(fields, {
      label: "Authorized details",
      value: vehicle.authorizedSearchText.replace(SYNTHETIC_PIPE_SEPARATOR, " "),
      priority: 8,
      displaySafe: false,
    });
  }

  if (includeAuthorizedDetails) {
    for (const evidence of vehicle.holdEvidence ?? []) {
      addFields(fields, [
        { label: "Salesperson", value: evidence.salesperson, priority: 24 },
        { label: "Customer / reason", value: evidence.customerOrReason, priority: 22 },
        { label: "Held by", value: evidence.heldBy, priority: 18 },
        { label: "Hold date", value: evidence.holdDate, priority: 12 },
        { label: "Expected date", value: evidence.expectedDeliveryDate, priority: 12 },
        { label: "CDK status", value: evidence.cdkState, priority: 18 },
      ]);
      for (const comment of evidence.comments ?? []) {
        addFields(fields, [
          { label: "Comment", value: comment.text, priority: 14 },
          { label: "Comment author", value: comment.author, priority: 12 },
          { label: "Comment date", value: comment.timestamp, priority: 8 },
        ]);
      }
      for (const alert of evidence.alerts ?? []) {
        addFields(fields, [
          { label: "Alert", value: alert.text, priority: 18 },
          { label: "Alert author", value: alert.author, priority: 12 },
          { label: "Alert date", value: alert.timestamp, priority: 8 },
          { label: "Alert modification", value: alert.metadataRaw, priority: 8 },
          { label: "Spiff", value: alert.spiffRaw, priority: 8 },
        ]);
      }
    }

    if (vehicle.dealerMail.canViewEvidence && vehicle.dealerMailEvidence) {
      const evidence = vehicle.dealerMailEvidence;
      for (const [label, messages] of [["Comment", evidence.comments], ["Alert", evidence.alerts]] as const) {
        for (const message of messages) addFields(fields, [
          { label, value: message.text, priority: 14 },
          { label: `${label} author`, value: message.author, priority: 12 },
          { label: `${label} date`, value: message.timestamp, priority: 8 },
          { label: `${label} modification`, value: message.metadataRaw, priority: 8 },
          { label: "Spiff", value: message.spiffRaw, priority: 8 },
        ]);
      }
      for (const row of evidence.history) addFields(fields, [
        { label: "Previous hold", value: row.statusLabel, priority: 10 },
        { label: "Previous hold salesperson", value: row.salesperson, priority: 12 },
        { label: "Previous customer / reason", value: row.customerOrReason, priority: 12 },
        { label: "Previous hold date", value: row.holdDate, priority: 8 },
        { label: "Previous expected date", value: row.expectedDate, priority: 8 },
        { label: "Previous raw hold order", value: row.orderRaw, priority: 8 },
        { label: "Previous raw lifecycle", value: row.lifecycle, priority: 8 },
      ]);
    }
  }

  return {
    vehicle,
    fields,
    literalText: fields.map((field) => field.literal).join("\n"),
    foldedText: fields.map((field) => field.folded).join("\n"),
  };
}

export function buildInventorySearchIndex(
  vehicles: InventoryVehicle[],
  options?: { includeAuthorizedDetails?: boolean },
): InventorySearchIndexEntry[] {
  return vehicles.map((vehicle) => buildInventorySearchEntry(vehicle, options));
}

export function buildInventorySearchIndexes(vehicles: InventoryVehicle[]): InventorySearchIndexes {
  return {
    direct: buildInventorySearchIndex(vehicles, { includeAuthorizedDetails: false }),
    authorized: buildInventorySearchIndex(vehicles),
  };
}

function scoreEntry(entry: InventorySearchIndexEntry, query: string): InventorySearchMatch | null {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) return { vehicle: entry.vehicle, score: 0, matchedLabels: [] };

  let score = 0;
  const labels = new Set<string>();
  for (const term of terms) {
    let bestScore = -1;
    let bestField: SearchField | null = null;
    for (const field of entry.fields) {
      const nextScore = scoreSearchTerm(field, term);
      if (nextScore > bestScore) {
        bestScore = nextScore;
        bestField = field;
      }
    }
    if (bestScore < 0 || !bestField) return null;
    score += bestScore;
    if (bestField.displaySafe) labels.add(bestField.label);
  }

  const foldedPhrase = foldSearchText(query);
  if (foldedPhrase && entry.foldedText.includes(foldedPhrase)) score += 52;
  return { vehicle: entry.vehicle, score, matchedLabels: [...labels].slice(0, 3) };
}

export function rankInventorySearch(
  index: InventorySearchIndexEntry[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): InventorySearchMatch[] {
  if (!query.trim()) return [];
  const matches: Array<InventorySearchMatch & { order: number }> = [];
  index.forEach((entry, order) => {
    const match = scoreEntry(entry, query);
    if (match) matches.push({ ...match, order });
  });
  matches.sort((left, right) =>
    right.score - left.score ||
    left.order - right.order ||
    left.vehicle.stockNumber.localeCompare(right.vehicle.stockNumber, "en-US", { numeric: true }),
  );
  return matches.slice(0, Math.max(0, limit)).map(({ order: _order, ...match }) => match);
}

/**
 * Prefer a match from fields a user can see on the inventory surface. Role-
 * authorized background text remains useful for a salesperson, hold, or
 * comment lookup, but cannot make an otherwise precise vehicle search appear
 * to match the entire inventory.
 */
export function rankInventorySearchWithAuthorizedFallback(
  indexes: InventorySearchIndexes,
  query: string,
  limit = Number.POSITIVE_INFINITY,
): InventorySearchMatch[] {
  const directMatches = rankInventorySearch(indexes.direct, query);
  const matches = directMatches.length ? directMatches : rankInventorySearch(indexes.authorized, query);
  return matches.slice(0, Math.max(0, limit));
}

/** Recent-search persistence: only keep queries that match public inventory
 *  fields. Authorized-only hits (salesperson, customer/reason, comments) stay
 *  searchable but must not linger in sessionStorage. */
export function isPersistableInventorySearchQuery(
  indexes: InventorySearchIndexes,
  query: string,
): boolean {
  return rankInventorySearch(indexes.direct, query, 1).length > 0;
}

const entryCache = new WeakMap<InventoryVehicle, InventorySearchIndexEntry>();

export function inventoryVehicleMatchesSearch(vehicle: InventoryVehicle, query: string): boolean {
  if (!query.trim()) return true;
  let entry = entryCache.get(vehicle);
  if (!entry) {
    entry = buildInventorySearchEntry(vehicle);
    entryCache.set(vehicle, entry);
  }
  return scoreEntry(entry, query) !== null;
}
