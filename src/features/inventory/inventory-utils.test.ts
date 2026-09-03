import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVENTORY_FILTERS,
  formatMoney,
  formatStickerMoney,
  resolveCurrentLocation,
  sortVehicles,
  vehicleMatchesFilters,
  vehicleMatchesQuery,
} from "./inventory-utils";
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
  it("labels original sticker currency without converting or changing public listing prices", () => {
    expect(formatStickerMoney(56650, { pricingCurrency: "CAD", originalMarket: "Canada" })).toMatch(/CAD\s56,650/);
    expect(formatStickerMoney(49924, {})).toBe("49,924 (original sticker currency; verify)");
    expect(formatStickerMoney(49480, { pricingCurrency: "USD" })).toMatch(/USD\s49,480/);
    expect(formatMoney(21999)).toBe("$21,999");
  });

  it("finds partial VINs and folded model punctuation", () => {
    const record = vehicle();
    expect(vehicleMatchesQuery(record, "RKF123")).toBe(true);
    expect(vehicleMatchesQuery(record, "f150 supercrew")).toBe(true);
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
