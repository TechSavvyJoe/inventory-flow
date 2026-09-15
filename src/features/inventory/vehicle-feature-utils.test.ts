import { describe, expect, it } from "vitest";
import type { InventoryVehicle } from "./types";
import { compactEquipmentScanLabel, equipmentByCategory, publishedEquipment, standoutEquipment } from "./vehicle-feature-utils";

function vehicle(overrides: Partial<InventoryVehicle> = {}): InventoryVehicle {
  return {
    id: "1FTFW1E84RKF12345",
    vin: "1FTFW1E84RKF12345",
    stockNumber: "H240512",
    year: 2024,
    make: "Ford",
    model: "F-150",
    features: [],
    publicListing: { dataState: "current", isListed: true },
    dealerOn: { dataState: "current", inStock: true, inTransit: false, inProduction: false },
    dealerMail: { dataState: "current", hasActiveHold: false },
    location: { homeStore: { id: "howell", name: "Howell" } },
    ...overrides,
  };
}

describe("published vehicle equipment", () => {
  it("groups exact per-VIN source strings without manufacturing trim equipment", () => {
    const record = vehicle({
      features: ["BLIS Blind Spot Information System", "Trailer Tow Package", "Heated Front Seats"],
      windowSticker: {
        dataState: "current",
        equipmentGroup: "Equipment Group 302A",
        options: ["Trailer Tow Package", "B&O Sound System"],
        standardEquipment: ["Pre-Collision Assist with Automatic Emergency Braking"],
      },
    });

    const items = publishedEquipment(record);
    expect(items.filter((item) => item.label === "Trailer Tow Package")).toHaveLength(1);
    expect(items.find((item) => item.label === "Trailer Tow Package")?.source).toBe("factory-option");
    expect(equipmentByCategory(record).find((group) => group.category === "driver-assistance")?.items).toHaveLength(2);
    expect(standoutEquipment(record).map((item) => item.label)).toContain("Equipment Group 302A");
    expect(items.some((item) => item.label.includes("Adaptive Cruise"))).toBe(false);
  });

  it("returns an empty evidence set when no source published equipment", () => {
    expect(publishedEquipment(vehicle())).toEqual([]);
  });

  it("turns a copied long factory option into a meaningful scan cue", () => {
    expect(compactEquipmentScanLabel("CLASS IV TRAILER TOW PACKAGE WITH PRO TRAILER BACKUP ASSIST AND INTEGRATED TRAILER BRAKE CONTROLLER"))
      .toBe("Class IV Trailer tow package");
    expect(compactEquipmentScanLabel("XLT Sport Appearance Package")).toBe("XLT Sport Appearance Package");
  });

  it("recognizes exact cross-OEM safety phrases without inventing missing equipment", () => {
    const record = vehicle({
      features: [
        "ProPILOT Assist with Navi-link",
        "HD Surround Vision",
        "Rear Cross Path Detection",
        "Driver Monitoring System",
        "IntelliBeam Auto High Beams",
      ],
    });

    const items = publishedEquipment(record);
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.category === "driver-assistance")).toBe(true);
    expect(items.every((item) => item.source === "published-listing-feature")).toBe(true);
    expect(items.some((item) => item.label.includes("Adaptive Cruise"))).toBe(false);
  });

  it("uses vAuto informational equipment as VIN-linked fallback evidence without calling it a factory sticker", () => {
    const record = vehicle({
      factoryEquipment: {
        dataState: "current",
        isOriginalWindowSticker: false,
        packages: [{
          name: "Safety Package",
          code: "PQB",
          features: ["Blind Spot Monitor", "Rear Cross-Traffic Alert"],
        }],
        sections: [{ name: "Technology", items: [{ label: "Aerial View Display System" }] }],
      },
    });

    const items = publishedEquipment(record);
    expect(items.find((item) => item.label === "Safety Package (PQB)")?.source).toBe("vauto-equipment-package");
    expect(items.find((item) => item.label === "Blind Spot Monitor")?.category).toBe("driver-assistance");
    expect(items.some((item) => item.source.startsWith("factory-"))).toBe(false);
  });
});
