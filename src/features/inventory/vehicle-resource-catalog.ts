import { getDemoWindowSticker } from '../../lib/demo-documents';
import { sourceDisplayText } from '../../lib/source-text';
import { sourceDistanceText } from '../../lib/source-distance';
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
  /** Concise primary-card facts; full evidence remains in facts and Records. */
  summaryFacts?: string[];
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

/**
 * Source prose that can state a distance. Canadian stickers, OASIS factory
 * terms and AutoCheck detail text may print kilometres; staff read miles, so
 * the US figure leads and the source figure follows it. Applied once, where
 * the raw field enters a fact, so a converted string is never re-converted.
 */
function factText(value?: string | null): string | null {
  const normalized = text(value);
  return normalized === null ? null : sourceDistanceText(normalized);
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

function captureTimestamp(date?: string | null): number | null {
  const timestamp = text(date) ? Date.parse(date!) : NaN;
  const calendar = date ? /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(date) : null;
  if (calendar) {
    const parsed = new Date(Date.UTC(+calendar[1], +calendar[2] - 1, +calendar[3]));
    if (parsed.getUTCFullYear() !== +calendar[1] || parsed.getUTCMonth() !== +calendar[2] - 1 || parsed.getUTCDate() !== +calendar[3]) return null;
  }
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Legacy arrays may have been defaulted by an importer, so the capture flag is required. */
export function hasCapturedOasisActionResult(oasis?: VehicleResourceVehicle['fordOasis']): boolean {
  const timestamp = captureTimestamp(oasis?.capturedAt);
  return oasis?.openActionsCaptured === true && Array.isArray(oasis.openFieldServiceActions)
    && timestamp !== null && timestamp <= Date.now() && ['current', 'stale', 'stale_unverified'].includes(oasis.dataState ?? '');
}

function sourceNote(state: string | undefined, hasFacts: boolean, date?: string | null, dateLabel = 'Captured', missing = 'No report details captured'): string | null {
  const timestamp = captureTimestamp(date);
  return join([
    state === 'stale' || state === 'stale_unverified' ? 'Saved report · refresh at source'
      : state === 'incomplete' ? 'Partial captured record'
        : state === 'unavailable' ? 'Source currently unavailable'
          : state === 'unknown' ? 'Source status unknown' : null,
    !hasFacts ? missing : null,
    text(date) ? timestamp === null ? `Unrecognized source date: ${date}` : timestamp <= Date.now() ? `${dateLabel} ${formatDate(date)}` : `Future source date: ${formatDate(date)}` : null,
  ]);
}

type HistoryCheck = NonNullable<AutoCheckResource['checks']>[number];

function checkPriority(check: HistoryCheck): number {
  // Ranking changes order only. Display the captured wording; never turn a
  // keyword match or a missing check into a clean/unsafe vehicle assertion.
  const result = join([check.status, check.detail]) ?? '';
  const unnegated = result.replace(/\blast reported odometer:\s*[\d,]+(?:\s*(?:mi|miles))?(?:\s*\([^)]*\))?/gi, '')
    .replace(/\bno\s+accidents?\s*(?:or|\/|&)\s*damage(?:\s+reported)?/gi, '')
    .replace(/\b(?:no|zero|0|without|not)\s+(?:(?:reported|recorded|known|major|structural)\s+)?(?:accidents?|damages?|issues?|problems?|records?|title brands?|salvage|flood|odometer discrepancies|rollback)(?:\s+(?:reported|recorded|found|detected))?/gi, '');
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
      compact: historyCheckSummary(check, history),
      full: factText(`${text(check.label)}: ${join([check.status, check.detail])}`) ?? '',
      summary: historyCheckSummary(check, history),
    })).sort((a, b) => a.priority - b.priority || a.index - b.index);
}

function historyCheckSummary(check: HistoryCheck, history?: VehicleResourceVehicle['autoCheckReport']): string {
  const label = text(check.label) ?? '';
  let detail = text(check.detail);
  // Only remove the same captured reading, never an unrelated historical
  // reading or a discrepancy warning. The dedicated odometer fact keeps it.
  if (/odometer/i.test(label) && numeric(history?.lastReportedOdometer) && detail) {
    detail = text(detail.replace(/\bLast reported odometer:\s*([\d,]+)(?:\s*(?:mi|miles))?(?:\s*\(([^)]*)\))?/gi, (original, amount: string, date?: string) => {
      const detailDate = captureTimestamp(date), recordedDate = captureTimestamp(history.lastReportedOdometerDate);
      const sameDate = !date || (detailDate !== null && recordedDate !== null && new Date(detailDate).toISOString().slice(0, 10) === new Date(recordedDate).toISOString().slice(0, 10));
      return sameDate && Number(amount.replace(/,/g, '')) === history.lastReportedOdometer ? '' : original;
    }).replace(/^[\s·;|,-]+|[\s·;|,-]+$/g, ''));
  }
  const status = text(check.status);
  const genericStatus = /^(?:no issues?|no problems?|clear|normal)$/i.test(status ?? '');
  const value = join([genericStatus && detail ? null : status, detail]);
  return value ? factText(`${label}: ${value}`) ?? '' : '';
}

function equipmentIdentity(value?: string | null): string {
  return (text(value) ?? '').toLowerCase().replace(/\bequipment\s+group\b/g, '')
    .replace(/\b(?:usd|cad)\s*/g, '').replace(/\$?[\d,]+\.\d{2}/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function stickerSummaryOptions(sticker?: VehicleResourceVehicle['windowSticker']): string[] {
  const group = equipmentIdentity(sticker?.equipmentGroup);
  return importantItems(sticker?.options ?? []).filter(option => !group || equipmentIdentity(option) !== group);
}

function importantItems(values: string[]): string[] {
  const items = present(values).map(item => sourceDistanceText(item));
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
  const stickerOptions = stickerSummaryOptions(sticker);
  const stickerFacts = demoSticker ? present([
    [vehicle.model, vehicle.trim].filter(Boolean).join(' ') || vehicle.vehicleName,
    numeric(vehicle.msrp) ? `${formatStickerMoney(vehicle.msrp, { pricingCurrency: 'USD' })} MSRP` : null,
  ]) : present([
    numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null,
    sticker?.equipmentGroup,
    ...importantItems(sticker?.options ?? []).slice(0, 2),
    join([factText(sticker?.engine), factText(sticker?.transmission)]),
    ...importantItems(sticker?.options ?? []).slice(2, 3),
    join([sticker?.exteriorColor ? `Exterior ${sticker.exteriorColor}` : null, sticker?.interiorColor ? `Interior ${sticker.interiorColor}` : null]),
    ...importantItems(sticker?.standardEquipment ?? []).slice(0, 2),
    sticker?.warranty?.[0] ? `Printed warranty: ${factText(sticker.warranty[0])}` : null,
  ]);
  const stickerSummary = demoSticker ? stickerFacts : present([
    join([numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null, sticker?.equipmentGroup]),
    ...stickerOptions.slice(0, 3), join([sticker?.engine, sticker?.transmission]),
  ]);
  const stickerCompact = demoSticker ? stickerFacts.slice(0, 2) : present([
    join([numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null, sticker?.equipmentGroup]),
    join(stickerOptions.slice(0, 2)) ?? join([sticker?.engine, sticker?.transmission]) ?? sticker?.standardEquipment?.[0],
    ...stickerSummary,
  ], 2);
  if (stickerHref || stickerFacts.length || sticker) result.push({
    id: 'window-sticker', title: demoSticker?.label ?? 'Window sticker', subtitle: demoSticker ? 'Synthetic sample · not an original' : 'Original MSRP & equipment',
    brand: demoSticker ? null : fordFamily ? 'ford' : null,
    facts: stickerFacts, compactFacts: stickerCompact,
    summaryFacts: stickerSummary,
    sourceNote: demoSticker ? 'Synthetic sample · not an original' : join([sourceNote(sticker?.dataState, stickerFacts.length > 0), sticker?.sourceMessage, sticker?.failureReason]),
    href: stickerHref, target: 'data', action: demoSticker ? 'Open demo sticker' : 'Open sticker', dataAction: 'View sticker data', hasCapturedData: stickerFacts.length > 0,
    previewUrl: demoSticker?.previewUrl, demo: Boolean(demoSticker),
  });

  const history = vehicle.autoCheckReport;
  const historyHref = officialVehicleDocumentUrl(history?.url, 'autocheck', listing);
  const checks = historyCheckFacts(history);
  const scoreRange = numeric(history?.scoreRangeLow) && numeric(history?.scoreRangeHigh) && history.scoreRangeLow <= history.scoreRangeHigh ? `${history.scoreRangeLow}–${history.scoreRangeHigh}` : undefined;
  const historyScore = numeric(history?.score) ? `Score ${formatNumber(history.score)}${scoreRange ? ` · ${scoreRange} range` : ''}` : null;
  const ownership = join([numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : null, factText(history?.usage)]);
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
    join([numeric(history?.score) ? `Score ${formatNumber(history.score)}` : null, ownership]),
    checks.find(check => check.priority > 1)?.compact,
    odometer,
  ], 2);
  if (historyHref || historyFacts.length || history) result.push({
    id: 'autocheck', title: 'AutoCheck', subtitle: 'Vehicle history · Experian', brand: 'autocheck', facts: historyFacts,
    summaryFacts: present([
      ...checks.filter(check => check.priority <= 1).map(check => check.summary),
      ...checks.filter(check => check.priority > 1 && /title|accident|damage/i.test(check.summary)).map(check => check.summary),
      ownership,
      ...checks.filter(check => /service/i.test(check.summary) && check.priority > 1).map(check => check.summary),
      ...checks.filter(check => /odometer/i.test(check.summary) && check.priority > 1).map(check => check.summary),
      odometer,
      ...checks.filter(check => check.priority > 1 && !/title|accident|damage|service|odometer/i.test(check.summary)).map(check => check.summary),
    ]),
    compactFacts: historyCompact.slice(0, 2), sourceNote: null,
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
  const powertrain = join([factText(equipment?.engine), factText(equipment?.transmission), equipment?.drivetrain]);
  const equipmentFacts = present([
    ...packages.slice(0, 2), ...equipmentItems.slice(0, 4), powertrain,
    numeric(equipment?.totalMsrp) ? `${formatNumber(equipment.totalMsrp)} MSRP` : null,
  ]);
  const hasEquipment = equipmentFacts.length > 0;
  if (equipmentHref || hasEquipment || equipment) result.push({
    id: 'vauto', title: 'vAuto equipment', subtitle: 'Informational equipment label', brand: 'vauto', facts: equipmentFacts,
    summaryFacts: present([packages[0], equipmentItems.find(item => !packages.some(pkg => equipmentIdentity(pkg) === equipmentIdentity(item))) ?? powertrain]),
    compactFacts: present([packages[0], equipmentItems[0] ?? powertrain], 1),
    sourceNote: null,
    href: equipmentHref, target: 'equipment', action: 'Open equipment', dataAction: 'View equipment data', hasCapturedData: hasEquipment,
  });

  if (fordFamily) {
    const oasis = vehicle.fordOasis;
    const oasisHref = fordOasisUrl(vehicle.vin);
    const actions = present((oasis?.openFieldServiceActions ?? []).map(action => join([action.code, factText(sourceDisplayText(action.description))])));
    const coverages = present((oasis?.warrantyCoverages ?? []).map(coverage => join([coverage.type, factText(sourceDisplayText(coverage.description))])));
    // Adapters can supply default empty arrays. A dated, complete source capture
    // is required before an empty action list can be described as a zero result.
    const capturedEmptyActions = hasCapturedOasisActionResult(oasis) && oasis?.openFieldServiceActions?.length === 0;
    const warrantyStart = text(oasis?.warrantyStartDate) ? `Warranty start ${oasis!.warrantyStartDate}` : null;
    const buildDate = text(oasis?.buildDate) ? `Built ${oasis!.buildDate}` : null;
    const oasisFacts = present([
      ...actions.map(action => `Open FSA ${action}`),
      warrantyStart, buildDate,
      ...coverages.map(coverage => `Coverage: ${coverage}`),
      capturedEmptyActions ? 'No open Ford actions' : null,
      ...(oasis?.extendedCoverageExpirations ?? []).map(expiration => `Extended coverage: ${factText(expiration)}`),
      numeric(oasis?.monthsInService) ? `${formatNumber(oasis.monthsInService)} months in service` : null,
      numeric(oasis?.saleMileage) ? `${formatNumber(oasis.saleMileage)} mi at sale` : null,
    ]);
    const hasOasis = oasisFacts.length > 0;
    if (oasisHref || hasOasis) result.push({
      id: 'oasis', title: 'Ford OASIS', subtitle: hasOasis ? 'Warranty & service actions' : 'Exact-VIN dealer lookup', brand: 'ford',
      facts: oasisFacts,
      summaryFacts: present([actions[0] ? `Open FSA ${actions[0]}` : null, warrantyStart, coverages[0] ? `Coverage: ${coverages[0]}` : null, capturedEmptyActions ? 'No open Ford actions' : null]),
      compactFacts: present([actions[0] ? `Open FSA ${actions[0]}` : null, warrantyStart, coverages[0] ? `Coverage: ${coverages[0]}` : null, capturedEmptyActions ? 'No open Ford actions' : null], 1),
      sourceNote: null,
      href: oasisHref, target: 'data', action: 'Open OASIS', dataAction: 'View OASIS data', hasCapturedData: hasOasis,
    });
    const invoiceHref = fordInvoiceUrl(vehicle.vin);
    if (invoiceHref) result.push({
      id: 'invoice', title: 'Ford invoice', subtitle: 'Vehicle invoice', brand: 'ford', facts: [], compactFacts: [], sourceNote: null,
      href: invoiceHref, target: 'data', action: 'Open invoice', dataAction: 'View invoice data', hasCapturedData: false,
    });
  }
  return result;
}
