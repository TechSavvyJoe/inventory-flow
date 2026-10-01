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

  it("excludes incomplete document equipment while retaining published and last verified evidence", () => {
    const record = vehicle({
      features: ["Published heated seats"],
      windowSticker: { dataState: "incomplete", options: ["Unverified BlueCruise"] },
      factoryEquipment: { dataState: "stale", isOriginalWindowSticker:false, packages: [{ name: "Retained tow package", features: [] }] },
    });
    expect(publishedEquipment(record).map(item => item.label)).toEqual(expect.arrayContaining(["Published heated seats", "Retained tow package"]));
    expect(publishedEquipment(record).some(item => item.label.includes("BlueCruise"))).toBe(false);
  });

  it("turns a copied long factory option into a meaningful scan cue", () => {
    expect(compactEquipmentScanLabel("CLASS IV TRAILER TOW PACKAGE WITH PRO TRAILER BACKUP ASSIST AND INTEGRATED TRAILER BRAKE CONTROLLER"))
      .toBe("Class IV Trailer tow package");
    expect(compactEquipmentScanLabel("XLT Sport Appearance Package")).toBe("XLT Sport Appearance Package");
    expect(compactEquipmentScanLabel("360-Degree Camera")).toBe("360° camera");
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

  it("recognizes captured Lincoln differentiators while preserving every source label", () => {
    const labels = [
      "Revel Ultima 3D Audio System",
      "Perfect Position Front Seats",
      "Multi-Contour Seats with Active Motion Massage",
      "Lincoln ActiveGlide",
      "Lincoln BlueCruise",
      "Black Label Special Edition Package",
      "Jet Appearance Package",
      "Monochromatic Appearance Package",
    ];
    const items = publishedEquipment(vehicle({ make:"Lincoln", model:"Nautilus", features:labels }));

    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(labels));
    expect(items.filter((item) => labels.includes(item.label)).every((item) => item.standout)).toBe(true);
    expect(items.find((item) => item.label === "Revel Ultima 3D Audio System")?.category).toBe("technology");
    expect(items.find((item) => item.label === "Perfect Position Front Seats")?.category).toBe("comfort");
    expect(items.find((item) => item.label === "Multi-Contour Seats with Active Motion Massage")?.category).toBe("comfort");
    expect(items.find((item) => item.label === "Lincoln ActiveGlide")?.category).toBe("driver-assistance");
    expect(items.find((item) => item.label === "Lincoln BlueCruise")?.category).toBe("driver-assistance");
    expect(items.filter((item) => /(?:Black Label|Appearance Package)/.test(item.label)).every((item) => item.category === "packages")).toBe(true);
    expect(items.some((item) => /speaker count|subscription|seat count/i.test(item.label))).toBe(false);
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

  it("shows a metric equipment label in US miles and keeps the source figure", () => {
    const record = vehicle({
      windowSticker: {
        dataState: "current",
        originalMarket: "Canada",
        standardEquipment: ["Combined fuel economy 9.8 L/100 km"],
        options: ["Extended range tank — 900 km"],
      },
    });

    const items = publishedEquipment(record);
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "Combined fuel economy 24 mpg (9.8 L/100 km in the source)",
        "Extended range tank — 559 mi (900 km in the source)",
      ]),
    );
  });
});
