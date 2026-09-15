import { getDemoWindowSticker } from '../../lib/demo-documents';
import type { AutoCheckResource, FactoryEquipmentResource, FordOasisResource, WindowStickerResource, VehicleWorkspaceTab } from './types';
import { formatDate, formatNumber, formatStickerMoney } from './inventory-utils';
import { fordInvoiceUrl, fordOasisUrl, officialVehicleDocumentUrl, vautoFactoryEquipmentUrl } from './vehicle-document-utils';

type SourceRecord<T> = Omit<T, 'dataState'> & { dataState?: string };

/** Common, read-only source fields accepted by both inventory adapters and API records. */
export interface VehicleResourceVehicle {
  vin: string;
  make?: string | null;
  model?: string | null;
  year?: string | number;
  trim?: string | null;
  vehicleName?: string | null;
  stockNumber?: string | null;
  msrp?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  listingUrl?: string | null;
  publicListing?: { listingUrl?: string | null };
  autoCheckReport?: SourceRecord<AutoCheckResource> | null;
  windowSticker?: SourceRecord<WindowStickerResource> | null;
  factoryEquipment?: SourceRecord<FactoryEquipmentResource> | null;
  fordOasis?: SourceRecord<Partial<FordOasisResource>> | null;
}

export interface VehicleResource {
  id: 'window-sticker' | 'autocheck' | 'vauto' | 'oasis' | 'invoice';
  title: string;
  subtitle: string;
  brand: 'autocheck' | 'vauto' | 'ford' | null;
  facts: string[];
  /** Two high-value, source-backed summaries for inventory results. */
  compactFacts: string[];
  /** Provenance and availability, deliberately separate from vehicle facts. */
  sourceNote: string | null;
  href: string | null;
  target: VehicleWorkspaceTab;
  action: string;
  dataAction: string;
  hasCapturedData: boolean;
  previewUrl?: string;
  demo?: boolean;
  score?: { value: number; range?: string };
}

function text(value?: string | null): string | null {
  return value?.trim().replace(/\s+/g, ' ') || null;
}

function present(values: Array<string | null | undefined>, limit = Infinity): string[] {
  const seen = new Set<string>();
  return values.map(text).filter((value): value is string => {
    if (!value || seen.has(value.toLowerCase())) return false;
    seen.add(value.toLowerCase());
    return true;
  }).slice(0, limit);
}

function join(values: Array<string | null | undefined>): string | null {
  return present(values).join(' · ') || null;
}

function numeric(value?: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function capturedByNow(date?: string | null): boolean {
  const timestamp = text(date) ? Date.parse(date!) : NaN;
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function sourceNote(state: string | undefined, hasFacts: boolean, date?: string | null, dateLabel = 'Captured', missing = 'No report details captured'): string | null {
  return join([
    state === 'stale' || state === 'stale_unverified' ? 'Saved report · refresh at source'
      : state === 'incomplete' ? 'Partial captured record'
        : state === 'unavailable' ? 'Source currently unavailable'
          : state === 'unknown' ? 'Source status unknown' : null,
    !hasFacts ? missing : null,
    text(date) ? capturedByNow(date) ? `${dateLabel} ${formatDate(date)}` : Number.isFinite(Date.parse(date!)) ? `Future source date: ${formatDate(date)}` : `Unrecognized source date: ${date}` : null,
  ]);
}

type HistoryCheck = NonNullable<AutoCheckResource['checks']>[number];

function checkPriority(check: HistoryCheck): number {
  // Ranking changes order only. Display the captured wording; never turn a
  // keyword match or a missing check into a clean/unsafe vehicle assertion.
  const result = join([check.status, check.detail]) ?? '';
  const unnegated = result.replace(/\b(?:no|zero|0|without|not)\s+(?:(?:reported|recorded|known|major|structural)\s+)?(?:accidents?|damages?|issues?|problems?|records?|title brands?|salvage|flood|odometer discrepancies|rollback)(?:\s+(?:reported|recorded|found|detected))?/gi, '');
  if (/\b(?:warning|review|alert|issue|problem|damage|accident|salvage|rebuilt|flood|rollback|discrepanc\w*|not actual|theft|stolen|lemon|buyback|branded|lien)\b/i.test(unnegated)) return 0;
  if (/accident|damage|title|odometer/i.test(check.label) && /\b(?:[1-9]\d*\s+records?|brand|reported|found)\b/i.test(unnegated)) return 0;
  if (/\b(?:unknown|unavailable|not reported|not checked|unable|incomplete)\b/i.test(result)) return 1;
  if (/accident|damage|title|odometer/i.test(check.label)) return 2;
  return 3;
}

function historyCheckFacts(history?: VehicleResourceVehicle['autoCheckReport']) {
  return (history?.checks ?? []).filter(check => text(check.label) && (text(check.status) || text(check.detail)))
    .map((check, index) => ({
      priority: checkPriority(check), index,
      compact: `${text(check.label)}: ${join([check.status, !text(check.status) || checkPriority({ label: check.label, status: check.detail }) === 0 ? check.detail : null])}`,
      full: `${text(check.label)}: ${join([check.status, check.detail])}`,
    })).sort((a, b) => a.priority - b.priority || a.index - b.index);
}

function importantItems(values: string[]): string[] {
  const items = present(values);
  const important = /360|camera|adaptive cruise|blind spot|blis\b|heated|ventilated|cooled|leather|tow|trailer|moonroof|sunroof|panoramic|power liftgate|navigation|remote start/i;
  return [...items.filter(item => important.test(item)), ...items.filter(item => !important.test(item))];
}

/** Provider identity comes from each source record, never from an interchangeable report label. */
export function vehicleResourceCatalog(vehicle: VehicleResourceVehicle): VehicleResource[] {
  const result: VehicleResource[] = [];
  const listing = vehicle.publicListing?.listingUrl ?? vehicle.listingUrl;
  const fordFamily = /^(ford|lincoln)$/i.test(vehicle.make?.trim() ?? '');
  const sticker = vehicle.windowSticker;
  const demoSticker = getDemoWindowSticker(vehicle);
  const stickerHref = demoSticker?.url ?? officialVehicleDocumentUrl(sticker?.url, 'window-sticker', listing);
  const stickerFacts = demoSticker ? present([
    [vehicle.model, vehicle.trim].filter(Boolean).join(' ') || vehicle.vehicleName,
    numeric(vehicle.msrp) ? `${formatStickerMoney(vehicle.msrp, { pricingCurrency: 'USD' })} MSRP` : null,
  ]) : present([
    numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null,
    sticker?.equipmentGroup,
    ...importantItems(sticker?.options ?? []).slice(0, 2),
    join([sticker?.engine, sticker?.transmission]),
    ...importantItems(sticker?.options ?? []).slice(2, 3),
    join([sticker?.exteriorColor ? `Exterior ${sticker.exteriorColor}` : null, sticker?.interiorColor ? `Interior ${sticker.interiorColor}` : null]),
    ...importantItems(sticker?.standardEquipment ?? []).slice(0, 2),
    sticker?.warranty?.[0] ? `Printed warranty: ${sticker.warranty[0]}` : null,
  ]);
  const stickerCompact = demoSticker ? stickerFacts.slice(0, 2) : present([
    join([numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null, sticker?.equipmentGroup]),
    join(importantItems(sticker?.options ?? []).slice(0, 2)) ?? join([sticker?.engine, sticker?.transmission]) ?? sticker?.standardEquipment?.[0],
    ...stickerFacts,
  ], 2);
  if (stickerHref || stickerFacts.length || sticker) result.push({
    id: 'window-sticker', title: demoSticker?.label ?? 'Window sticker', subtitle: demoSticker ? 'Synthetic sample · not an original' : 'Original MSRP & equipment',
    brand: demoSticker ? null : fordFamily ? 'ford' : null,
    facts: stickerFacts, compactFacts: stickerCompact,
    sourceNote: demoSticker ? 'Synthetic sample · not an original' : join([sourceNote(sticker?.dataState, stickerFacts.length > 0), sticker?.sourceMessage, sticker?.failureReason]),
    href: stickerHref, target: 'data', action: demoSticker ? 'Open demo sticker' : 'Open sticker', dataAction: 'View sticker data', hasCapturedData: stickerFacts.length > 0,
    previewUrl: demoSticker?.previewUrl, demo: Boolean(demoSticker),
  });

  const history = vehicle.autoCheckReport;
  const historyHref = officialVehicleDocumentUrl(history?.url, 'autocheck', listing);
  const checks = historyCheckFacts(history);
  const scoreRange = numeric(history?.scoreRangeLow) && numeric(history?.scoreRangeHigh) && history.scoreRangeLow <= history.scoreRangeHigh ? `${history.scoreRangeLow}–${history.scoreRangeHigh}` : undefined;
  const historyScore = numeric(history?.score) ? `Score ${formatNumber(history.score)}${scoreRange ? ` · ${scoreRange} range` : ''}` : null;
  const ownership = join([numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : null, history?.usage]);
  const odometer = numeric(history?.lastReportedOdometer) ? `Last reported ${formatNumber(history.lastReportedOdometer)} mi${text(history.lastReportedOdometerDate) ? ` · ${formatDate(history.lastReportedOdometerDate)}` : ''}` : null;
  const historyFacts = present([
    historyScore,
    ...checks.filter(check => check.priority <= 1).map(check => check.full),
    ownership, odometer,
    ...checks.filter(check => check.priority > 1).map(check => check.full),
    history?.estimatedInServiceDate ? `Estimated warranty start ${formatDate(history.estimatedInServiceDate)}` : null,
  ]);
  const historyCompact = present([
    ...checks.filter(check => check.priority <= 1).map(check => check.compact),
    join([numeric(history?.score) ? `Score ${formatNumber(history.score)}` : null, numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : history?.usage]),
    checks.find(check => check.priority > 1)?.compact,
    odometer,
  ], 2);
  if (historyHref || historyFacts.length || history) result.push({
    id: 'autocheck', title: 'AutoCheck', subtitle: 'Vehicle history · Experian', brand: 'autocheck', facts: historyFacts,
    compactFacts: historyCompact, sourceNote: sourceNote(history?.dataState, historyFacts.length > 0, history?.reportRunAt, 'Report run'),
    href: historyHref, target: 'data', action: 'Open history', dataAction: 'View AutoCheck data', hasCapturedData: historyFacts.length > 0,
    score: numeric(history?.score) ? { value: history.score, range: scoreRange } : undefined,
  });

  const equipment = vehicle.factoryEquipment;
  const equipmentHref = vautoFactoryEquipmentUrl(equipment?.url);
  const packages = present((equipment?.packages ?? []).map(pkg => join([pkg.name, pkg.code])));
  const equipmentItems = importantItems([
    ...(equipment?.sections ?? []).flatMap(section => section.items.map(item => item.label)),
    ...(equipment?.packages ?? []).flatMap(pkg => pkg.features ?? []),
  ]);
  const powertrain = join([equipment?.engine, equipment?.transmission, equipment?.drivetrain]);
  const equipmentFacts = present([
    ...packages.slice(0, 2), ...equipmentItems.slice(0, 4), powertrain,
    numeric(equipment?.totalMsrp) ? `${formatNumber(equipment.totalMsrp)} reference MSRP · currency not captured` : null,
  ]);
  const hasEquipment = equipmentFacts.length > 0;
  if (equipmentHref || hasEquipment || equipment) result.push({
    id: 'vauto', title: 'vAuto equipment', subtitle: 'Informational equipment label', brand: 'vauto', facts: equipmentFacts,
    compactFacts: present([join(packages.slice(0, 2)), join(equipmentItems.slice(0, 2)) ?? powertrain, powertrain], 2),
    sourceNote: join(['Informational · not an original sticker', sourceNote(equipment?.dataState, hasEquipment, equipment?.capturedAt)]),
    href: equipmentHref, target: 'equipment', action: 'Open equipment', dataAction: 'View equipment data', hasCapturedData: hasEquipment,
  });

  if (fordFamily) {
    const oasis = vehicle.fordOasis;
    const oasisHref = fordOasisUrl(vehicle.vin);
    const actions = present((oasis?.openFieldServiceActions ?? []).map(action => join([action.code, action.description])));
    const coverages = present((oasis?.warrantyCoverages ?? []).map(coverage => join([coverage.type, coverage.description])));
    // Adapters can supply default empty arrays. A dated, complete source capture
    // is required before an empty action list can be described as a zero result.
    const capturedEmptyActions = Array.isArray(oasis?.openFieldServiceActions) && oasis.openFieldServiceActions.length === 0
      && capturedByNow(oasis.capturedAt) && ['current', 'stale', 'stale_unverified'].includes(oasis.dataState ?? '');
    const warrantyStart = text(oasis?.warrantyStartDate) ? `Warranty start ${oasis!.warrantyStartDate}` : null;
    const buildDate = text(oasis?.buildDate) ? `Built ${oasis!.buildDate}` : null;
    const oasisFacts = present([
      ...actions.map(action => `Open FSA ${action}`),
      warrantyStart, buildDate,
      ...coverages.map(coverage => `Recorded coverage: ${coverage}`),
      capturedEmptyActions ? '0 open Ford actions in captured report' : null,
      ...(oasis?.extendedCoverageExpirations ?? []).map(expiration => `Extended coverage: ${expiration}`),
      numeric(oasis?.monthsInService) ? `${formatNumber(oasis.monthsInService)} months in service at capture` : null,
      numeric(oasis?.saleMileage) ? `${formatNumber(oasis.saleMileage)} mi at sale` : null,
    ]);
    const hasOasis = oasisFacts.length > 0;
    if (oasisHref || hasOasis) result.push({
      id: 'oasis', title: 'Ford OASIS', subtitle: hasOasis ? 'Warranty & service actions' : 'Exact-VIN dealer lookup', brand: 'ford',
      facts: oasisFacts,
      compactFacts: present([actions[0] ? `Open FSA ${actions[0]}` : null, warrantyStart, coverages[0] ? `Recorded coverage: ${coverages[0]}` : null, capturedEmptyActions ? '0 open Ford actions in captured report' : null, buildDate, !hasOasis ? 'DealerConnection sign-in' : null], 2),
      sourceNote: join([sourceNote(oasis?.dataState, hasOasis, oasis?.capturedAt, 'Captured', 'No OASIS report details captured'), hasOasis && !actions.length && !capturedEmptyActions ? 'Open-action result not captured' : null]),
      href: oasisHref, target: 'data', action: 'Open OASIS', dataAction: 'View OASIS data', hasCapturedData: hasOasis,
    });
    const invoiceHref = fordInvoiceUrl(vehicle.vin);
    if (invoiceHref) result.push({
      id: 'invoice', title: 'Ford invoice', subtitle: 'Exact-VIN dealer lookup', brand: 'ford', facts: [], compactFacts: ['DealerConnection sign-in'], sourceNote: 'Invoice details are not captured',
      href: invoiceHref, target: 'data', action: 'Open invoice', dataAction: 'View invoice data', hasCapturedData: false,
    });
  }
  return result;
}
