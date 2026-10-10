import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVENTORY_FILTERS,
  activeFilterCount,
  formatMoney,
  formatStickerMoney,
  resolveCurrentLocation,
  sortVehicles,
  vehicleMoveAction,
  vehicleMatchesFilters,
} from "./inventory-utils";
import { inventoryVehicleMatchesSearch } from "./inventory-search";
import type { InventoryVehicle } from "./types";

function vehicle(overrides: Partial<InventoryVehicle> = {}): InventoryVehicle {
  return {
    id: "1FTFW1E84RKF12345",
    vin: "1FTFW1E84RKF12345",
    stockNumber: "H240512",
    year: 2024,
    make: "Ford",
    model: "F-150",
    trim: "XLT",
    price: 46995,
    mileage: 8642,
    features: ["SuperCrew", "4x4"],
    publicListing: {
      dataState: "current",
      isListed: true,
      websiteStatus: "available",
    },
    dealerOn: {
      dataState: "current",
      inStock: true,
      inTransit: false,
      inProduction: false,
    },
    dealerMail: {
      dataState: "current",
      hasActiveHold: false,
      position: null,
    },
    location: {
      homeStore: { id: "howell", name: "Howell" },
      sourceReportedStore: { id: "fowlerville", name: "Fowlerville" },
    },
    ...overrides,
  };
}

describe("inventory source-safe selectors", () => {
  it("sorts MSRP by usable original-document amounts instead of the listing discount anchor", () => {
    const records = [
      vehicle({ id: "sticker", msrp: 1, windowSticker: { dataState: "current", totalMsrp: 60000 } }),
      vehicle({ id: "fallback", msrp: 99000, factoryEquipment: { dataState: "current", totalMsrp: 40000, isOriginalWindowSticker: false } }),
      vehicle({ id: "missing", msrp: 10, windowSticker: { dataState: "incomplete", totalMsrp: 20000 } }),
    ];
    expect(sortVehicles(records, [{ key: "msrp", direction: "asc" }]).map(({ id }) => id)).toEqual(["fallback", "sticker", "missing"]);
  });

  it("chooses request versus direct move from role and vehicle ownership", () => {
    const howell = { id: "howell", name: "Howell" };
    const own = vehicle();
    const other = vehicle({ location: { ...own.location, homeStore: { id: "lincoln", name: "Lincoln" } } });

    expect(vehicleMoveAction(own, "manager", howell)).toMatchObject({ intent: "direct", label: "Move to another store" });
    expect(vehicleMoveAction(other, "manager", howell)).toMatchObject({ intent: "request", label: "Request to Howell" });
    expect(vehicleMoveAction(own, "sales", howell)).toBeNull();
    expect(vehicleMoveAction(other, "sales", howell)).toMatchObject({ intent: "request", label: "Request to Howell" });
    expect(vehicleMoveAction(own, "group_manager", howell)).toMatchObject({ intent: "direct" });
    expect(vehicleMoveAction(other, "group_manager", howell)).toMatchObject({ intent: "direct" });
    expect(vehicleMoveAction(vehicle({ moveRequestBlocked: true }), "group_manager", howell)).toBeNull();
    const reroutable = vehicle({
      moveRequestBlocked: true,
      movement: { state: 'arrived', requestId: 'direct-move-1', canDirectReroute: true },
    });
    expect(vehicleMoveAction(reroutable, "group_manager", howell)).toMatchObject({ intent: "direct", label: "Move again" });
    expect(vehicleMoveAction(reroutable, "manager", howell)).toMatchObject({ intent: "direct", label: "Move again" });
    expect(vehicleMoveAction(reroutable, "sales", howell)).toBeNull();
    expect(vehicleMoveAction({ ...reroutable, location: { ...reroutable.location, homeStore: { id: 'lincoln', name: 'Lincoln' } } }, "manager", howell)).toBeNull();
  });

  it("keeps existing inventory and legacy unknown records waiting until Ready is explicit", () => {
    const base = vehicle();
    expect(vehicleMatchesFilters(base, { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "serviced" })).toBe(false);
    expect(vehicleMatchesFilters(base, { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "unknown" })).toBe(true);
    const serviced = vehicle({ serviceReadiness: { vin: base.vin, status: "serviced", version: 1, serviceEnteredAt: null, completedAt: "2026-09-14", updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: "Howell", canManage: false } });
    expect(vehicleMatchesFilters(serviced, { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "serviced" })).toBe(true);
    expect(vehicleMatchesFilters(serviced, { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "serviced", dealerMail: "held" })).toBe(false);
    expect(activeFilterCount({ ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "serviced" })).toBe(1);
    const legacy = vehicle({ serviceReadiness: { ...serviced.serviceReadiness!, status: "unknown" } });
    expect(vehicleMatchesFilters(legacy, { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "needs_service" })).toBe(true);
    expect(vehicleMatchesFilters(legacy, { ...DEFAULT_INVENTORY_FILTERS, serviceReadiness: "serviced" })).toBe(false);
  });

  it("keeps service filtering when expanding a search to another store", () => {
    const base = vehicle();
    const inService = vehicle({ serviceReadiness: { vin: base.vin, status: "in_service", version: 1, serviceEnteredAt: "2026-09-14", completedAt: null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: "Howell", canManage: false } });
    expect(vehicleMatchesFilters(inService, { ...DEFAULT_INVENTORY_FILTERS, storeId: "lincoln", serviceReadiness: "in_service" }, { ignoreStore: true })).toBe(true);
    expect(vehicleMatchesFilters(inService, { ...DEFAULT_INVENTORY_FILTERS, storeId: "lincoln", serviceReadiness: "serviced" }, { ignoreStore: true })).toBe(false);
  });
  it("keeps original sticker amounts compact without converting or changing public listing prices", () => {
    expect(formatStickerMoney(56650, { pricingCurrency: "CAD", originalMarket: "Canada" })).toMatch(/CAD\s56,650/);
    expect(formatStickerMoney(49924, {})).toBe("49,924");
    expect(formatStickerMoney(1250.75, { pricingCurrency: "USD" })).toBe("$1,250.75");
    expect(formatStickerMoney(0, { pricingCurrency: "USD" })).toBe("$0");
    expect(formatStickerMoney(1250.75, { pricingCurrency: "CAD" })).toMatch(/CAD\s1,250.75/);
    expect(formatStickerMoney(1250.75, {})).toBe("1,250.75");
    expect(formatStickerMoney(0, {})).toBe("0");
    expect(formatStickerMoney(49480, { pricingCurrency: "USD" })).toBe("$49,480");
    expect(formatMoney(21999)).toBe("$21,999");
  });

  it("finds partial VINs and folded model punctuation", () => {
    const record = vehicle();
    expect(inventoryVehicleMatchesSearch(record, "RKF123")).toBe(true);
    expect(inventoryVehicleMatchesSearch(record, "f150 supercrew")).toBe(true);
  });

  it("does not treat a stale negative hold result as verified no-hold", () => {
    const stale = vehicle({
      dealerMail: { dataState: "stale", hasActiveHold: false, position: null },
    });
    expect(
      vehicleMatchesFilters(stale, {
        ...DEFAULT_INVENTORY_FILTERS,
        dealerMail: "not-held",
      }),
    ).toBe(false);
    expect(
      vehicleMatchesFilters(stale, {
        ...DEFAULT_INVENTORY_FILTERS,
        dealerMail: "unverified",
      }),
    ).toBe(true);
  });

  it("prefers an explicit app-confirmed location without discarding source location", () => {
    const record = vehicle({
      location: {
        homeStore: { id: "howell", name: "Howell" },
        sourceReportedStore: { id: "fowlerville", name: "Fowlerville" },
        appConfirmedLocation: "Howell detail bay",
        appConfirmedAt: "2026-08-29T14:00:00-04:00",
      },
    });
    expect(resolveCurrentLocation(record)).toMatchObject({
      label: "Howell detail bay",
      provenance: "app-confirmed",
    });
    expect(record.location.sourceReportedStore?.name).toBe("Fowlerville");
  });

  it("applies visible multi-sort priority", () => {
    const records = [
      vehicle({ id: "a", stockNumber: "A", price: 35000, mileage: 10000 }),
      vehicle({ id: "b", stockNumber: "B", price: 35000, mileage: 5000 }),
      vehicle({ id: "c", stockNumber: "C", price: 25000, mileage: 20000 }),
    ];
    expect(
      sortVehicles(records, [
        { key: "price", direction: "desc" },
        { key: "mileage", direction: "asc" },
      ]).map((record) => record.id),
    ).toEqual(["b", "a", "c"]);
  });

  it("sorts operational vehicle signals without treating unknown values as facts", () => {
    const records = [
      vehicle({ id: "no-hold", dealerMail: { dataState: "current", hasActiveHold: false } }),
      vehicle({ id: "unknown", dealerMail: { dataState: "stale", hasActiveHold: false } }),
      vehicle({ id: "held", dealerMail: { dataState: "current", hasActiveHold: true } }),
    ];

    expect(sortVehicles(records, [{ key: "holdStatus", direction: "asc" }]).map(({ id }) => id)).toEqual([
      "held",
      "no-hold",
      "unknown",
    ]);
  });

  it("sorts uncertain provider evidence as unknown despite a current DealerMail no-hold", () => {
    const observation = { vin: "TESTDATAHOLD00001", provider: "synthetic-crm", sourceLabel: "Synthetic CRM", capturedAt: "2026-10-10T12:00:00Z", dataState: "current" as const, readOnly: true as const, complete: true, holdState: "not_observed" as const };
    const records = [
      vehicle({ id: "retained", operationalEvidence: { records: [{ ...observation, dataState: "stale_unverified", holdState: "held" }] } }),
      vehicle({ id: "incomplete", operationalEvidence: { records: [{ ...observation, complete: false }] } }),
      vehicle({ id: "conflict", operationalEvidence: { records: [observation, { ...observation, provider: "synthetic-dms", holdState: "unknown" }] } }),
      vehicle({ id: "no-hold", operationalEvidence: { records: [observation] } }),
      vehicle({ id: "held", operationalEvidence: { records: [{ ...observation, holdState: "held" }] } }),
      vehicle({ id: "dealer-mail-held", dealerMail: { dataState: "current", hasActiveHold: true } }),
      vehicle({ id: "dealer-mail-held-with-uncertain-provider", dealerMail: { dataState: "current", hasActiveHold: true }, operationalEvidence: { records: [{ ...observation, complete: false }] } }),
    ];
    expect(sortVehicles(records, [{ key: "holdStatus", direction: "asc" }]).map(({ id }) => id)).toEqual([
      "held", "dealer-mail-held", "dealer-mail-held-with-uncertain-provider", "no-hold", "retained", "incomplete", "conflict",
    ]);
    expect(sortVehicles(records, [{ key: "holdStatus", direction: "desc" }]).map(({ id }) => id)).toEqual([
      "retained", "incomplete", "conflict", "no-hold", "held", "dealer-mail-held", "dealer-mail-held-with-uncertain-provider",
    ]);
    const manual = { vin: observation.vin, state: "active" as const, version: 1, expectedDeliveryDate: null, updatedAt: null, ownerStore: "Howell" as const, canManage: true, enabled: true };
    expect(sortVehicles([records[3], { ...records[0], id: "manual-held", manualHold: manual }], [{ key: "holdStatus", direction: "asc" }]).map(({ id }) => id)).toEqual(["manual-held", "no-hold"]);
  });

  it("sorts recent activity from the latest source-backed timestamp", () => {
    const records = [
      vehicle({ id: "older", publicListing: { dataState: "current", isListed: true, updatedAt: "2026-08-20T12:00:00-04:00" } }),
      vehicle({ id: "newer", dealerMail: { dataState: "current", hasActiveHold: true, updatedAt: "2026-08-29T12:00:00-04:00" } }),
      vehicle({ id: "missing", publicListing: { dataState: "current", isListed: true } }),
    ];

    expect(sortVehicles(records, [{ key: "recentActivity", direction: "desc" }]).map(({ id }) => id)).toEqual([
      "newer",
      "older",
      "missing",
    ]);
  });
});

describe("Overview views in Inventory (OVERVIEW_SPEC §8.1)", () => {
  const records = { autoCheck: true, oasis: true, sticker: true, invoice: true, fordHistory: true };
  const service = { status: "needs_service" as const, basis: "unconfirmed" as const, store: "Howell" as const, arrivalBasis: "unknown" as const };
  const facts = (overrides: Partial<NonNullable<InventoryVehicle["overview"]>> = {}): NonNullable<InventoryVehicle["overview"]> => ({
    custody: "on_lot", custodyBasis: "source_reported", currentStore: "Howell", records, recordsCaptured: 5, recordsApplicable: 5, service, ...overrides,
  });
  const matches = (candidate: InventoryVehicle, view: NonNullable<Parameters<typeof vehicleMatchesFilters>[1]["overviewView"]>["view"], store: "Howell" | "Lincoln" = "Howell") =>
    vehicleMatchesFilters(candidate, { ...DEFAULT_INVENTORY_FILTERS, overviewView: { view, store } }, { ignoreStore: true });

  it("reads custody by the home store name, and Visiting by the store the vehicle is at", () => {
    const away = vehicle({ overview: facts({ custody: "away", custodyBasis: "ledger", currentStore: "Lincoln" }) });
    expect(matches(away, "away")).toBe(true);
    expect(matches(away, "on-lot")).toBe(false);
    expect(matches(away, "visiting", "Lincoln")).toBe(true);
    expect(matches(away, "visiting", "Howell")).toBe(false);
    expect(matches(away, "away", "Lincoln")).toBe(false);
    expect(matches(vehicle({ overview: facts({ custody: "in_transit", currentStore: undefined }) }), "in-transit")).toBe(true);
    expect(matches(vehicle({ overview: facts({ custody: "conflict" }) }), "conflict")).toBe(true);
    // A vehicle without facts matches only On lot at its home store.
    expect(matches(vehicle(), "on-lot")).toBe(true);
    expect(matches(vehicle(), "away")).toBe(false);
  });

  it("uses the server facts for aging, unaccounted, returns, records and holds, never a label", () => {
    expect(matches(vehicle({ overview: facts({ agedBucket: 90 }) }), "aged-60")).toBe(true);
    expect(matches(vehicle({ overview: facts({ agedBucket: 60 }) }), "aged-90")).toBe(false);
    expect(matches(vehicle({ overview: facts({ agedBasis: "crm_age" }) }), "aged-60")).toBe(false);
    expect(matches(vehicle({ overview: facts({ unaccounted: { reason: "no_app_record" } }) }), "unaccounted")).toBe(true);
    expect(matches(vehicle({ overview: facts({ returnOverdue: true }) }), "return-overdue")).toBe(true);
    expect(matches(vehicle({ overview: facts({ recordsCaptured: 4 }) }), "records-incomplete")).toBe(true);
    expect(matches(vehicle({ overview: facts() }), "records-incomplete")).toBe(false);
    const labelledOnly = vehicle({ overview: facts(), dealerMail: { dataState: "current", hasActiveHold: true, position: "primary" } });
    expect(matches(labelledOnly, "holds")).toBe(false);
    const held = vehicle({ overview: facts({ holdActive: true, holdPastExpected: true }), location: { homeStore: { id: "howell", name: "Howell" }, crmStore: { id: "lincoln", name: "Lincoln" } } });
    expect(matches(held, "holds", "Lincoln")).toBe(true);
    expect(matches(held, "holds-past-expected", "Lincoln")).toBe(true);
    expect(matches(held, "holds", "Howell")).toBe(false);
  });

  it("keeps the imported Overview hold drilldown consistent with its counted source facts", () => {
    const manual = { vin: "TESTDATAHWELL0001", state: "active" as const, version: 1, expectedDeliveryDate: null, updatedAt: null, ownerStore: "Howell" as const, canManage: true, enabled: true };
    const manualOnly = vehicle({ manualHold: manual, overview: facts() });
    expect(matches(manualOnly, "holds")).toBe(false);
    expect(vehicleMatchesFilters(manualOnly, { ...DEFAULT_INVENTORY_FILTERS, overviewView: { view: "holds", store: "all" } })).toBe(false);
    const both = vehicle({ manualHold: manual, overview: facts({ holdActive: true }), location: { homeStore: { id: "howell", name: "Howell" }, crmStore: { id: "lincoln", name: "Lincoln" } } });
    expect(matches(both, "holds", "Lincoln")).toBe(true);
    expect(matches(both, "holds", "Howell")).toBe(false);
  });

  it("narrows to an exact VIN list and counts both as active filters", () => {
    const base = vehicle();
    expect(vehicleMatchesFilters(base, { ...DEFAULT_INVENTORY_FILTERS, vins: [base.vin] })).toBe(true);
    expect(vehicleMatchesFilters(base, { ...DEFAULT_INVENTORY_FILTERS, vins: ["TESTDATAHWELL0009"] })).toBe(false);
    expect(activeFilterCount({ ...DEFAULT_INVENTORY_FILTERS, vins: [base.vin], overviewView: { view: "away", store: "Howell" } })).toBe(2);
  });

  it("includes ordinary active holds from every store without inferring them from a label", () => {
    const filters = { ...DEFAULT_INVENTORY_FILTERS, overviewView: { view: "holds", store: "all" } as const };
    for (const store of ["Howell", "Lincoln"]) {
      const held = vehicle({ overview: facts({ holdActive: true }), location: { homeStore: { id: store.toLowerCase(), name: store } } });
      expect(vehicleMatchesFilters(held, filters)).toBe(true);
      expect(vehicleMatchesFilters({ ...held, overview: facts() }, filters)).toBe(false);
    }
    const labelledOnly = vehicle({ overview: facts(), dealerMail: { dataState: "current", hasActiveHold: true, position: "primary" } });
    expect(vehicleMatchesFilters(labelledOnly, filters)).toBe(false);
    expect(vehicleMatchesFilters(vehicle(), filters)).toBe(false);
  });

  it("matches disposition views by the recorded code and the server's owner store, never the manager log", () => {
    const disposition = { vin: "TESTDATAHWELL0001", code: "sold_pending" as const, version: 1, effectiveDate: "2026-08-29", destinationStore: null, updatedAt: "2026-08-30T12:00:00Z", updatedByRole: "manager" as const, store: "Howell" as const, ownerStore: "Lincoln" as const, canManage: false };
    const recorded = vehicle({ overview: facts(), appDisposition: disposition });
    expect(matches(recorded, "disposition-sold-pending", "Lincoln")).toBe(true);
    // Owner store, not the view's home store, decides.
    expect(matches(recorded, "disposition-sold-pending", "Howell")).toBe(false);
    expect(matches(recorded, "disposition-none", "Lincoln")).toBe(false);
    const none = vehicle({ overview: facts(), appDisposition: { ...disposition, code: null, version: 0, ownerStore: "Howell" } });
    expect(matches(none, "disposition-none")).toBe(true);
    // A manager-log sale alone is not a recorded disposition.
    const logOnly = vehicle({ overview: facts(), managerDisposition: { dataState: "current", sold: true, delivered: true, sourceStore: { id: "howell", name: "Howell" }, sourcePeriod: "2026-08", confidence: "high", soldLabel: "Sold — manager log", deliveryLabel: "Delivered — manager log" } });
    expect(matches(logOnly, "disposition-delivered")).toBe(false);
    expect(matches(logOnly, "disposition-none")).toBe(true);
  });
});
