import { describe, expect, it } from "vitest";
import {
  buildInventorySearchIndex,
  foldInventorySearchText,
  rankInventorySearch,
  searchFieldsMatch,
} from "./inventory-search";
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
    vehicleName: "2024 Ford F-150 XLT",
    price: 42810,
    msrp: 48995,
    mileage: 2052,
    exteriorColor: "Oxford White",
    interiorColor: "Black",
    bodyStyle: "SuperCrew pickup",
    drivetrain: "4x4",
    engine: "2.7L EcoBoost V6",
    transmission: "10-speed automatic",
    features: ["Trailer Tow Package", "SYNC 4"],
    publicListing: { dataState: "current", isListed: true, websiteStatus: "Available" },
    dealerOn: { dataState: "current", inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: "current", hasActiveHold: false, position: null },
    location: { homeStore: { id: "howell", name: "Howell" } },
    ...overrides,
  };
}

describe("predictive inventory search", () => {
  it("reuses token and typo matching across explicit view fields", () => {
    expect(searchFieldsMatch("ford howel", ["2024 Ford Explorer", "Howell"])).toBe(true);
    expect(searchFieldsMatch("ford lincoln", ["2024 Ford Explorer", "Howell"])).toBe(false);
  });

  it("folds model punctuation and formatted numeric values", () => {
    const index = buildInventorySearchIndex([vehicle()]);
    expect(foldInventorySearchText("F-150")).toBe("f150");
    for (const query of ["f150", "$42,810", "42810", "2,052", "2052"]) {
      expect(rankInventorySearch(index, query)).toHaveLength(1);
    }
  });

  it("uses multi-token AND matching across identity, specs, feature, and store", () => {
    const index = buildInventorySearchIndex([vehicle()]);
    expect(rankInventorySearch(index, "ford white ecoboost howell")).toHaveLength(1);
    expect(rankInventorySearch(index, "ford white diesel howell")).toHaveLength(0);
  });

  it("prioritizes exact identifiers and supports partial VIN and stock", () => {
    const records = [
      vehicle({ id: "exact", stockNumber: "H240512" }),
      vehicle({ id: "substring", stockNumber: "XXH240512YY", vin: "2FMPK4J91NBA99999" }),
    ];
    const index = buildInventorySearchIndex(records);
    expect(rankInventorySearch(index, "H240512")[0]?.vehicle.id).toBe("exact");
    expect(rankInventorySearch(index, "RKF123")[0]?.vehicle.id).toBe("exact");
  });

  it("finds a nearby spelling but keeps the exact model first", () => {
    const records = [
      vehicle({ id: "explorer", model: "Explorer", vehicleName: "2023 Ford Explorer Limited" }),
      vehicle({ id: "expedition", model: "Expedition", vehicleName: "2023 Ford Expedition XLT" }),
    ];
    const index = buildInventorySearchIndex(records);
    expect(rankInventorySearch(index, "explorrer")[0]?.vehicle.id).toBe("explorer");
    expect(rankInventorySearch(index, "explorer")[0]?.vehicle.id).toBe("explorer");
  });

  it("matches server-authorized private text without returning a private excerpt", () => {
    const salesRecord = vehicle({
      authorizedSearchText: "RICK BURCZYK | SCOTT MAXEY | IN BODY SHOP",
    });
    const salesMatch = rankInventorySearch(buildInventorySearchIndex([salesRecord]), "Scott Maxey")[0];
    expect(salesMatch?.vehicle.id).toBe(salesRecord.id);
    expect(salesMatch?.matchedLabels).toEqual([]);

    const transportRoleRecord = vehicle({ authorizedSearchText: null, holdEvidence: [] });
    expect(rankInventorySearch(buildInventorySearchIndex([transportRoleRecord]), "Scott Maxey"))
      .toHaveLength(0);
  });

  it("indexes structured authorized hold details when they are present", () => {
    const record = vehicle({
      holdEvidence: [{
        id: "hold-1",
        salesperson: "Damon Rickel",
        customerOrReason: "Customer appointment",
        cdkState: "Pending processing",
        comments: [{ text: "Waiting for title", author: "Manager" }],
        alerts: [{ text: "Do not move", author: "Used car manager" }],
      }],
    });
    const index = buildInventorySearchIndex([record]);
    for (const query of ["Damon", "customer appointment", "pending processing", "waiting title", "do not move"]) {
      expect(rankInventorySearch(index, query)).toHaveLength(1);
    }
  });

  it("treats special characters as literals rather than wildcard instructions", () => {
    const withLiteral = vehicle({ id: "literal", features: ["Tow * Tech"] });
    const ordinary = vehicle({ id: "ordinary", stockNumber: "OTHER", vin: "2FMPK4J91NBA99999" });
    const index = buildInventorySearchIndex([withLiteral, ordinary]);
    expect(rankInventorySearch(index, "*").map((match) => match.vehicle.id)).toEqual(["literal"]);
    expect(rankInventorySearch(index, "?")).toHaveLength(0);
    expect(rankInventorySearch(index, "|")).toHaveLength(0);
  });
});
