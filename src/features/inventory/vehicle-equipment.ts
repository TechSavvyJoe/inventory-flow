import type { InventoryVehicle } from "./types";
import { displaySourceMoney, stickerLineParts } from "./VehicleResourceCards";
import { formatStickerMoney } from "./inventory-utils";

export type EquipmentCategoryId =
  | "safety"
  | "towing"
  | "comfort"
  | "technology"
  | "packages"
  | "upgrades"
  | "other";

export type EquipmentEvidenceSource =
  | "inventory-feature"
  | "factory-option"
  | "factory-standard"
  | "equipment-group"
  | "vauto-package"
  | "vauto-informational";

export interface SourceEquipmentItem {
  text: string;
  category: EquipmentCategoryId;
  sources: EquipmentEvidenceSource[];
  sourceSections: string[];
  price?: number | null;
}

export interface EquipmentDisplayParts {
  label: string;
  sourceSection?: string;
}

export const EQUIPMENT_CATEGORIES: Array<{ id: EquipmentCategoryId; label: string }> = [
  { id: "packages", label: "Packages & special series" },
  { id: "safety", label: "Safety & driver assist" },
  { id: "comfort", label: "Comfort" },
  { id: "technology", label: "Technology" },
  { id: "towing", label: "Towing & utility" },
  { id: "upgrades", label: "Standout upgrades" },
  { id: "other", label: "Other published equipment" },
];

export const EQUIPMENT_SOURCE_LABELS: Record<EquipmentEvidenceSource, string> = {
  "inventory-feature": "Published vehicle listing",
  "factory-option": "Original window sticker · Option",
  "factory-standard": "Original window sticker · Standard",
  "equipment-group": "Original window sticker · Equipment group",
  "vauto-package": "VIN equipment profile · Package",
  "vauto-informational": "VIN equipment profile",
};

const EQUIPMENT_SOURCE_SECTIONS = new Map<string, string>([
  ["exterior", "Exterior"],
  ["interior", "Interior"],
  ["functional", "Functional"],
  ["safety/security", "Safety & security"],
  ["safety & security", "Safety & security"],
  ["mechanical", "Mechanical"],
  ["technology", "Technology"],
  ["comfort", "Comfort"],
  ["comfort & convenience", "Comfort & convenience"],
  ["powertrain", "Powertrain"],
  ["towing", "Towing"],
  ["other", "Other"],
]);

export function equipmentDisplayParts(text: string): EquipmentDisplayParts {
  const match = text.match(/^([^:]{2,32}):\s*(.+)$/);
  if (!match) return { label: text };
  const sourceSection = EQUIPMENT_SOURCE_SECTIONS.get(match[1].trim().toLocaleLowerCase());
  if (!sourceSection) return { label: text };
  return { label: match[2].trim(), sourceSection };
}

function equipmentCategory(text: string): EquipmentCategoryId {
  const value = text.toLowerCase();
  if (/package|equipment group|edition|special series|appearance|fx4|tremor|raptor|king ranch|platinum|lariat|off[- ]road/.test(value)) {
    return "packages";
  }
  if (/tow|trailer|hitch|payload|truck bed|bedliner|bed liner|tailgate|tonneau|cargo|boxlink|pro power|utility/.test(value)) {
    return "towing";
  }
  if (/blind|lane|collision|cruise|camera|park|brak|airbag|safety|co-pilot|copilot|pro\s*pilot|propilot|bluecruise|super\s+cruise|cross[- ](?:traffic|path)|surround\s+(?:view|vision)|driver\s+(?:alert|attention|monitoring)|drowsy|traffic\s+sign|intelli\s*beam|high[- ]beam|pedestrian|assist|pre-collision|honda sensing|toyota safety sense/.test(value)) {
    return "safety";
  }
  if (/heated|cooled|ventilated|leather|seat|climate|moonroof|sunroof|steering wheel|massage|memory|lumbar/.test(value)) {
    return "comfort";
  }
  if (/navigation|sync|bluetooth|audio|speaker|b&o|touchscreen|wireless|apple carplay|android auto|satellite|connected|remote start|keyless|usb|wi-fi|wifi/.test(value)) {
    return "technology";
  }
  if (/wheel|tire|running board|step bar|premium|performance|sport|engine|axle|suspension|exhaust|lighting|led/.test(value)) {
    return "upgrades";
  }
  return "other";
}

export function sourceConfirmedEquipment(vehicle: InventoryVehicle): SourceEquipmentItem[] {
  const byText = new Map<string, SourceEquipmentItem>();
  const add = (
    text: string | null | undefined,
    source: EquipmentEvidenceSource,
    metadata: {
      category?: EquipmentCategoryId;
      price?: number | null;
      sourceSection?: string | null;
    } = {},
  ) => {
    const clean = text?.trim();
    if (!clean) return;
    const key = clean.toLocaleLowerCase();
    const display = equipmentDisplayParts(clean);
    const sourceSection = metadata.sourceSection?.trim() || display.sourceSection;
    const existing = byText.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (sourceSection && !existing.sourceSections.includes(sourceSection)) existing.sourceSections.push(sourceSection);
      if (existing.price == null && metadata.price != null) existing.price = metadata.price;
      if (metadata.category) existing.category = metadata.category;
      return;
    }
    byText.set(key, {
      text: clean,
      category: metadata.category ?? equipmentCategory(clean),
      sources: [source],
      sourceSections: sourceSection ? [sourceSection] : [],
      price: metadata.price,
    });
  };

  vehicle.features?.forEach((item) => add(item, "inventory-feature"));
  add(vehicle.windowSticker?.equipmentGroup, "equipment-group", { category: "packages", price:vehicle.windowSticker?.equipmentGroupPrice });
  vehicle.windowSticker?.equipmentGroupContents?.forEach(item => add(item, "equipment-group"));
  vehicle.windowSticker?.options?.forEach((item) => add(item, "factory-option"));
  vehicle.windowSticker?.standardEquipment?.forEach((item) => add(item, "factory-standard"));
  vehicle.factoryEquipment?.packages?.forEach((item) => {
    add(
      [item.name, item.code ? `(${item.code})` : null].filter(Boolean).join(" "),
      "vauto-package",
      { category: "packages", price: item.price, sourceSection: "Packages" },
    );
    item.features?.forEach((feature) => add(feature, "vauto-informational", { sourceSection: item.name }));
  });
  vehicle.factoryEquipment?.sections?.forEach((section) => {
    section.items.forEach((item) => add(item.label, "vauto-informational", {
      price: item.price,
      sourceSection: section.name,
    }));
  });
  const sourcePriority = (item: SourceEquipmentItem) => {
    if (item.sources.some((source) => ["factory-option", "factory-standard", "equipment-group"].includes(source))) return 0;
    if (item.sources.some((source) => source.startsWith("vauto-"))) return 1;
    return 2;
  };
  return [...byText.values()].sort((left, right) =>
    sourcePriority(left) - sourcePriority(right) || left.text.localeCompare(right.text, "en-US", { numeric: true }),
  );
}

export type EquipmentFinderItem = SourceEquipmentItem & { display: ReturnType<typeof stickerLineParts>; searchText: string };
export function equipmentFinderItems(vehicle: InventoryVehicle): EquipmentFinderItem[] {
  const result: EquipmentFinderItem[] = [];
  for (const item of sourceConfirmedEquipment(vehicle)) {
    const display = stickerLineParts(equipmentDisplayParts(item.text).label);
    const knownPackage = vehicle.factoryEquipment?.packages?.find(pkg => pkg.code && item.text === `${pkg.name} (${pkg.code})`);
    if (knownPackage?.code) { display.label = knownPackage.name; display.code = knownPackage.code; }
    if (!display.price && typeof item.price === "number" && Number.isFinite(item.price)) display.price = item.sources.includes("equipment-group") && item.text === vehicle.windowSticker?.equipmentGroup
      ? formatStickerMoney(item.price, vehicle.windowSticker)
      : `Price ${new Intl.NumberFormat("en-US", {maximumFractionDigits:20}).format(item.price)}`;
    const key = display.label.toLocaleLowerCase().replace(/\s+/g, " ").trim();
    const existing = result.find(candidate => candidate.display.label.toLocaleLowerCase().replace(/\s+/g, " ").trim() === key
      && !(candidate.display.code && display.code && candidate.display.code !== display.code)
      && !(candidate.display.price && display.price && candidate.display.price !== display.price));
    if (existing) {
      existing.searchText += ` ${item.text}`.toLocaleLowerCase();
      existing.display.code ??= display.code;
      existing.display.price ??= display.price;
    } else result.push({...item, display, searchText: `${item.text} ${display.label} ${display.code ?? ""} ${display.price ? displaySourceMoney(display.price) : ""}`.toLocaleLowerCase()});
  }
  return result;
}
