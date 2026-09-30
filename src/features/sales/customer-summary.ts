import { STORE_BRANDING } from '../../app/storeBranding'
import type { StoreName } from '../../types'
import { publishedEquipment } from '../inventory/vehicle-feature-utils'
import { certifiedTerms } from '../inventory/vehicle-warranty-utils'
import { formatDate, formatMileage, formatMoney, vehicleDisplayName } from '../inventory/inventory-utils'
import type { InventoryVehicle } from '../inventory/types'

const STORE_DISPLAY: Record<string, { name: string; site: string }> = {
  Howell: { name: "Bob Maxey Ford of Howell", site: "bobmaxeyfordhowell.com" },
  Fowlerville: { name: "Bob Maxey Ford in Fowlerville", site: "bobmaxeyfordinfowlerville.com" },
  "Ford Detroit": { name: "Bob Maxey Ford", site: "bobmaxeyford.com" },
  Lincoln: { name: "Bob Maxey Lincoln", site: "bobmaxeylincoln.com" },
};

const isHttps = (value: string | null | undefined): value is string => typeof value === "string" && /^https:\/\//i.test(value);
// The synthetic demo uses reviewed bundled illustrations, never local report paths.
const isCustomerPhoto = (value: string | null | undefined): value is string => isHttps(value)
  || typeof value === 'string' && /^\/demo-vehicles\/[a-z0-9-]+\.(?:jpg|png|webp)$/i.test(value);
const customerEquipmentLabel = (value: string): string => value
  .replace(/^[·|.]\s*/, "")
  .replace(/\s+[·|]\s*(?:USD|CAD)\s*\$?[\d,]+(?:\.\d{2})?$/i, "")
  .replace(/\s+[·|]\s*NO\s*CHARGE$/i, "")
  .replace(/\s+[·|]\s*[A-Z]{2,}-[A-Z0-9-]+$/, "")
  .replace(/\s+\([A-Z0-9]{2,}(?:-[A-Z0-9]+)+\)$/, "")
  .trim();

/**
 * The sheet projects customer-safe facts from the inventory snapshot: identity, price, mileage, specs, equipment, description and the
 * store's certification. Holds, custody, movement, manager-log, in-service
 * and warranty estimates never appear here.
 */
export function takeHomeModel(vehicle: InventoryVehicle) {
  const store = vehicle.location.homeStore.name;
  const branding = STORE_BRANDING[store as StoreName] ?? null;
  const display = STORE_DISPLAY[store] ?? { name: store, site: "" };
  const photos = [...new Set([...(vehicle.imageUrls ?? []), vehicle.imageUrl].filter(isCustomerPhoto))].slice(0, 4);
  const usable = (state?: string) => state === 'current' || state === 'stale';
  const published = publishedEquipment({
    ...vehicle,
    windowSticker: usable(vehicle.windowSticker?.dataState) ? vehicle.windowSticker : null,
    factoryEquipment: usable(vehicle.factoryEquipment?.dataState) ? vehicle.factoryEquipment : null,
  });
  const equipment = [...new Set(published.map((item) => customerEquipmentLabel(item.label)).filter(Boolean))];
  const standout = [...new Set(published.filter((item) => item.standout).map((item) => customerEquipmentLabel(item.label)).filter(Boolean))].slice(0, 8);
  const price = vehicle.price ?? null;
  const msrp = vehicle.msrp ?? null;
  const savings = price !== null && msrp !== null && msrp > price ? msrp - price : null;
  const autoCheck = vehicle.autoCheckReport;
  const history = autoCheck && ['current', 'stale'].includes(autoCheck.dataState)
    ? [autoCheck.score != null ? `AutoCheck score ${autoCheck.score}` : null, autoCheck.ownerCount != null ? `${autoCheck.ownerCount} owner${autoCheck.ownerCount === 1 ? "" : "s"} reported` : null].filter(Boolean).join(" · ") || null
    : null;
  return {
    store,
    storeName: display.name,
    storeSite: display.site,
    logo: branding ? { src: branding.assetPath, alt: branding.altText, wide: branding.oemKey !== "lincoln" } : null,
    name: vehicleDisplayName(vehicle),
    descriptor: [vehicle.bodyStyle, vehicle.drivetrain, vehicle.engine, vehicle.exteriorColor].filter(Boolean).join(" · "),
    stockNumber: vehicle.stockNumber,
    vin: vehicle.vin,
    price,
    publishedAt: vehicle.publicListing.updatedAt ?? null,
    historyCapturedAt: autoCheck?.capturedAt || autoCheck?.reportRunAt || null,
    msrp,
    savings,
    mileage: vehicle.mileage ?? null,
    certified: vehicle.certified ? certifiedTerms(store) : null,
    photos,
    specs: ([
      ["Body", vehicle.bodyStyle], ["Drivetrain", vehicle.drivetrain], ["Engine", vehicle.engine], ["Transmission", vehicle.transmission], ["Fuel", vehicle.fuelType],
      ["Fuel economy", vehicle.mpgCity != null || vehicle.mpgHighway != null ? `${vehicle.mpgCity ?? "—"} city / ${vehicle.mpgHighway ?? "—"} hwy` : null],
      ["Exterior", vehicle.exteriorColor], ["Interior", vehicle.interiorColor],
    ] as Array<[string, string | null | undefined]>).filter((entry): entry is [string, string] => Boolean(entry[1])),
    highlights: [...new Set([...standout, ...equipment])].slice(0, 8),
    equipment,
    history,
    description: vehicle.dealerComments?.trim() || null,
    listingUrl: isHttps(vehicle.publicListing.listingUrl) ? vehicle.publicListing.listingUrl : null,
  };
}

export type TakeHomeModel = ReturnType<typeof takeHomeModel>;

/** Deliberately projects customer-safe inventory facts only; never hold/customer/CRM text. */
export function customerSummaryText(model: TakeHomeModel): string {
  return [
    model.name,
    `Stock ${model.stockNumber} · VIN ${model.vin}`,
    `Recorded price: ${model.price !== null ? formatMoney(model.price) : 'Ask the store'} · Mileage: ${model.mileage !== null ? formatMileage(model.mileage) : 'Not published'}`,
    model.publishedAt ? `Inventory snapshot: ${formatDate(model.publishedAt)}` : 'Inventory snapshot date not provided',
    ...model.specs.map(([label, value]) => `${label}: ${value}`),
    model.highlights.length ? `Equipment highlights: ${model.highlights.join('; ')}` : 'Confirm installed equipment with the store.',
    model.history ? `Reported history: ${model.history}${model.historyCapturedAt ? ` (report ${formatDate(model.historyCapturedAt)})` : ''}` : null,
    model.storeName,
    model.listingUrl,
    'Confirm current availability, price, mileage and installed equipment with the dealership. Price excludes tax, title, license and dealer fees.',
  ].filter(Boolean).join('\n')
}
