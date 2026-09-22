import { getDemoWindowSticker } from '../../lib/demo-documents';
import { sourceDisplayText } from '../../lib/source-text';
import { sourceDistanceText } from '../../lib/source-distance';
import type { AutoCheckResource, FactoryEquipmentResource, FordOasisResource, WindowStickerResource, VehicleWorkspaceTab } from './types';
import { formatDate, formatNumber, formatStickerMoney } from './inventory-utils';
import { fordInvoiceUrl, fordOasisUrl, officialVehicleDocumentUrl, vautoFactoryEquipmentUrl } from './vehicle-document-utils';
import { resolveVehicleInService, type VehicleInServiceInput } from './vehicle-in-service';

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
  engine?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  listingUrl?: string | null;
  publicListing?: { listingUrl?: string | null };
  autoCheckReport?: SourceRecord<AutoCheckResource> | null;
  windowSticker?: SourceRecord<WindowStickerResource> | null;
  factoryEquipment?: SourceRecord<FactoryEquipmentResource> | null;
  fordOasis?: SourceRecord<Partial<FordOasisResource>> | null;
  warrantyCheck?: VehicleInServiceInput['warrantyCheck'];
}

export interface VehicleResourceSummaryRow {
  label: string;
  values: string[];
  detail?: string;
}

export interface VehicleResource {
  id: 'window-sticker' | 'autocheck' | 'vauto' | 'oasis' | 'invoice';
  title: string;
  subtitle: string;
  brand: 'autocheck' | 'vauto' | 'ford' | null;
  facts: string[];
  /** Concise primary-card facts; full evidence remains in facts and Records. */
  summaryFacts?: string[];
  /** Structured overview fields; complete evidence remains in facts/Records. */
  summaryRows?: VehicleResourceSummaryRow[];
  /** Ordered sticker lines retain package contents and source price wording. */
  stickerDetails?: {
    vehicleDescription?: string;
    basePrice?: string;
    totalOptions?: string;
    destinationCharge?: string;
    msrp?: string;
    equipmentGroup?: string;
    equipmentGroupContents?: string[];
    equipmentGroupPrice?: string;
    optionLines: string[];
    optionLabel?: string;
    exteriorColor?: string;
    interiorColor?: string;
    engine?: string;
    transmission?: string;
    standardEquipment?: string[];
    warranty?: string[];
  };
  equipmentContext?: string;
  alternateSticker?: { href: string; label: string };
  /** Two high-value, source-backed summaries for inventory results. */
  compactFacts: string[];
  /** Short inventory scan signals; full reports remain in the workspace. */
  scanFacts?: string[];
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

/** Format explicit date tokens without changing the source's surrounding qualification. */
export function formatSourceDateText(value: string): string {
  return value.replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-/](?:[A-Za-z]{3,9}|\d{1,2})[-/]\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/g, date => formatDate(date));
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

function recordRows(rows: Array<{ label: string; values: Array<string | null | undefined>; detail?: string | null }>): VehicleResourceSummaryRow[] {
  return rows.map(row => ({ label: row.label, values: present(row.values), detail: text(row.detail) ?? undefined }))
    .filter(row => row.values.length > 0);
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

export function oasisActionLabel(oasis?: VehicleResourceVehicle['fordOasis']): string {
  const count = oasis?.openFieldServiceActions?.length ?? 0;
  const complete = hasCapturedOasisActionResult(oasis);
  if (!count) return complete ? 'No open service actions listed' : 'Service action result not captured';
  return `${complete ? '' : 'At least '}${count} open service ${count === 1 ? 'action' : 'actions'}${complete ? '' : ' · result incomplete'}`;
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

export function checkPriority(check: HistoryCheck): number {
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
      row: historyCheckRow(check, history, true),
    })).sort((a, b) => a.priority - b.priority || a.index - b.index);
}

function historyCheckSummary(check: HistoryCheck, history?: VehicleResourceVehicle['autoCheckReport']): string {
  const row = historyCheckRow(check, history);
  const value = join([...row.values, row.detail]);
  return value ? `${row.label}: ${value}` : '';
}

function historyCheckRow(check: HistoryCheck, history?: VehicleResourceVehicle['autoCheckReport'], keepStatus = false): VehicleResourceSummaryRow {
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
  const value = !keepStatus && genericStatus && detail ? detail : status ?? detail;
  return { label, values: present([factText(value)]), detail: (keepStatus || !genericStatus) && status && detail ? factText(detail) ?? undefined : undefined };
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
  const inService = resolveVehicleInService(vehicle);
  const sticker = vehicle.windowSticker;
  const demoSticker = getDemoWindowSticker(vehicle);
  const stickerHref = demoSticker?.url ?? officialVehicleDocumentUrl(sticker?.url, 'window-sticker', listing);
  const groupContents = Array.isArray(sticker?.equipmentGroupContents) ? sticker.equipmentGroupContents.map(item => factText(item)).filter((item): item is string => Boolean(item)) : undefined;
  const stickerOptions = [...(groupContents ?? []), ...stickerSummaryOptions(sticker)];
  const stickerOptionLines = (sticker?.options ?? []).map(option => factText(option)).filter((option): option is string => Boolean(option));
  const capturedStickerFacts = present([
    numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null,
    sticker?.equipmentGroup,
    ...(groupContents ?? []),
    ...importantItems(sticker?.options ?? []).slice(0, 2),
    join([factText(sticker?.engine), factText(sticker?.transmission)]),
    ...importantItems(sticker?.options ?? []).slice(2, 3),
    join([sticker?.exteriorColor ? `Exterior ${sticker.exteriorColor}` : null, sticker?.interiorColor ? `Interior ${sticker.interiorColor}` : null]),
    ...importantItems(sticker?.standardEquipment ?? []).slice(0, 2),
    sticker?.warranty?.[0] ? `Printed warranty: ${factText(sticker.warranty[0])}` : null,
  ]);
  // A demo document link is presentation metadata, not a substitute for
  // captured equipment and pricing evidence on the same vehicle.
  const stickerFacts = capturedStickerFacts.length ? capturedStickerFacts : demoSticker ? present([
    [vehicle.model, vehicle.trim].filter(Boolean).join(' ') || vehicle.vehicleName,
    numeric(vehicle.msrp) ? `${formatStickerMoney(vehicle.msrp, { pricingCurrency: 'USD' })} MSRP` : null,
  ]) : [];
  const stickerSummary = !capturedStickerFacts.length ? stickerFacts : present([
    join([numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null, sticker?.equipmentGroup]),
    ...stickerOptions.slice(0, 3), join([sticker?.engine, sticker?.transmission]),
  ]);
  const stickerCompact = !capturedStickerFacts.length ? stickerFacts.slice(0, 2) : present([
    join([numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} MSRP` : null, sticker?.equipmentGroup]),
    join(stickerOptions.slice(0, 2)) ?? join([sticker?.engine, sticker?.transmission]) ?? sticker?.standardEquipment?.[0],
    ...stickerSummary,
  ], 2);
  if (stickerHref || stickerFacts.length || sticker) result.push({
    id: 'window-sticker', title: demoSticker?.label ?? 'Window sticker', subtitle: demoSticker ? 'Synthetic sample · not an original' : 'Original MSRP & equipment',
    brand: demoSticker ? null : fordFamily ? 'ford' : null,
    facts: stickerFacts, compactFacts: stickerCompact,
    summaryFacts: stickerSummary,
    stickerDetails: capturedStickerFacts.length ? {
      vehicleDescription: text(sticker?.vehicleDescription) ?? undefined,
      basePrice: numeric(sticker?.basePrice) ? formatStickerMoney(sticker.basePrice, sticker!) : undefined,
      totalOptions: numeric(sticker?.totalOptions) ? formatStickerMoney(sticker.totalOptions, sticker!) : undefined,
      destinationCharge: numeric(sticker?.destinationCharge) ? formatStickerMoney(sticker.destinationCharge, sticker!) : undefined,
      msrp: numeric(sticker?.totalMsrp) ? formatStickerMoney(sticker.totalMsrp, sticker!) : undefined,
      equipmentGroup: text(sticker?.equipmentGroup) ?? undefined,
      equipmentGroupContents: groupContents,
      equipmentGroupPrice: numeric(sticker?.equipmentGroupPrice) ? formatStickerMoney(sticker.equipmentGroupPrice, sticker!) : undefined,
      optionLines: stickerOptionLines,
      optionLabel: groupContents !== undefined ? "Optional equipment" : "Captured equipment",
      exteriorColor: text(sticker?.exteriorColor) ?? undefined,
      interiorColor: text(sticker?.interiorColor) ?? undefined,
      engine: factText(sticker?.engine) ?? undefined,
      transmission: factText(sticker?.transmission) ?? undefined,
      standardEquipment: present((sticker?.standardEquipment ?? []).map(item => factText(item))),
      warranty: present((sticker?.warranty ?? []).map(item => factText(item))),
    } : undefined,
    scanFacts: present([
      join([
        numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker!)} original MSRP` : null,
        sticker?.equipmentGroup ? `Group ${sticker.equipmentGroup}` : null,
      ]),
      importantItems(sticker?.options ?? [])[0] ?? join([factText(sticker?.engine), factText(sticker?.transmission)]),
    ], 2),
    sourceNote: demoSticker ? 'Synthetic sample · not an original' : join([sourceNote(sticker?.dataState, stickerFacts.length > 0), sticker?.sourceMessage, sticker?.failureReason]),
    href: stickerHref, target: 'data', action: demoSticker ? 'Open demo sticker' : 'Open sticker', dataAction: 'View sticker data', hasCapturedData: stickerFacts.length > 0,
    previewUrl: demoSticker?.previewUrl, demo: Boolean(demoSticker),
  });

  const history = vehicle.autoCheckReport;
  const historyHref = officialVehicleDocumentUrl(history?.url, 'autocheck', listing);
  const checks = historyCheckFacts(history);
  const quickChecks = checks.filter(check => !/\b(?:lien reported|corrected title)\b/i.test(check.full));
  const scanCheck = quickChecks.find(check => /accident|damage/i.test(check.row.label))
    ?? quickChecks.find(check => /odometer|service|repair|recall/i.test(check.row.label))
    ?? quickChecks.find(check => /salvage|rebuilt|flood|lemon|buyback|rollback|structural|total loss/i.test(check.full));
  const scanCheckText = scanCheck && /^(?:events reported|no issues?|no problems?|clear|normal)$/i.test(scanCheck.row.values[0] ?? '') && scanCheck.row.detail
    ? scanCheck.row.detail : scanCheck?.summary;
  const scoreRange = numeric(history?.scoreRangeLow) && numeric(history?.scoreRangeHigh) && history.scoreRangeLow <= history.scoreRangeHigh ? `${history.scoreRangeLow}–${history.scoreRangeHigh}` : undefined;
  const historyScore = numeric(history?.score) ? `Score ${formatNumber(history.score)}${scoreRange ? ` · ${scoreRange} range` : ''}` : null;
  const ownership = join([numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : null, factText(history?.usage)]);
  const odometer = numeric(history?.lastReportedOdometer) ? `Last reported ${formatNumber(history.lastReportedOdometer)} mi${text(history.lastReportedOdometerDate) ? ` · ${formatDate(history.lastReportedOdometerDate)}` : ''}` : null;
  // Ford and Lincoln readiness comes from the Ford service-history channel.
  // Keep their ordinary AutoCheck report, but do not present a competing
  // AutoCheck inspection signal beside the authoritative Ford dates.
  const inspectionDate = fordFamily ? null : text(history?.recentInspection?.date);
  const inspectionTypes = fordFamily ? [] : present(history?.recentInspection?.types ?? [], 4);
  const inspection = inspectionDate && inspectionTypes.length ? `AutoCheck inspection ${formatDate(inspectionDate)} · ${inspectionTypes.join(' · ')}` : null;
  const historyFacts = present([
    historyScore,
    ...checks.filter(check => check.priority <= 1).map(check => check.full),
    inspection, ownership, odometer,
    ...checks.filter(check => check.priority > 1).map(check => check.full),
    history?.estimatedInServiceDate ? `Estimated warranty start ${formatDate(history.estimatedInServiceDate)}` : null,
  ]);
  const historyCompact = present([
    ...quickChecks.filter(check => check.priority <= 1).map(check => check.compact),
    join([numeric(history?.score) ? `Score ${formatNumber(history.score)}` : null, ownership]),
    quickChecks.find(check => check.priority > 1)?.compact,
    odometer,
  ], 2);
  if (historyHref || historyFacts.length || history) result.push({
    id: 'autocheck', title: 'AutoCheck', subtitle: 'Vehicle history · Experian', brand: 'autocheck', facts: historyFacts,
    summaryFacts: present([
      ...quickChecks.filter(check => check.priority <= 1).map(check => check.summary),
      ...quickChecks.filter(check => check.priority > 1 && /title|accident|damage/i.test(check.summary)).map(check => check.summary),
      inspection,
      ownership,
      ...quickChecks.filter(check => /service/i.test(check.summary) && check.priority > 1).map(check => check.summary),
      ...quickChecks.filter(check => /odometer/i.test(check.summary) && check.priority > 1).map(check => check.summary),
      odometer,
      ...quickChecks.filter(check => check.priority > 1 && !/title|accident|damage|service|odometer/i.test(check.summary)).map(check => check.summary),
    ]),
    summaryRows: [
      ...recordRows([{ label: 'Score', values: [numeric(history?.score) ? formatNumber(history.score) : null], detail: scoreRange ? `${scoreRange} typical range` : null }]),
      ...checks.filter(check => check.priority <= 1 || /title|accident|damage/i.test(check.row.label)).map(check => check.row),
      ...recordRows([
        { label: 'Owners / use', values: [numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : null], detail: factText(history?.usage) },
        { label: 'Last odometer', values: [numeric(history?.lastReportedOdometer) ? `${formatNumber(history.lastReportedOdometer)} mi` : null], detail: text(history?.lastReportedOdometerDate) ? formatDate(history!.lastReportedOdometerDate!) : null },
        { label: 'Recent inspection', values: [inspectionDate ? formatDate(inspectionDate) : null], detail: inspectionTypes.join(' · ') },
        { label: 'Est. in-service', values: [inService.source === 'autocheck' && inService.date ? formatDate(inService.date) : null] },
      ]),
      ...checks.filter(check => check.priority > 1 && !/title|accident|damage/i.test(check.row.label)).map(check => check.row),
      ...(!numeric(history?.ownerCount) ? recordRows([{ label: 'Reported use', values: [factText(history?.usage)] }]) : []),
    ],
    compactFacts: historyCompact.slice(0, 2), sourceNote: sourceNote(history?.dataState, true, history?.reportRunAt, 'Report run'),
    scanFacts: present([
      join([numeric(history?.score) ? `Score ${formatNumber(history.score)}` : null, numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : null]),
      demoSticker ? scanCheckText?.replace(/\s*·\s*Synthetic (?:example|result)$/i, '') : scanCheckText,
      inspectionDate ? `Inspected ${formatDate(inspectionDate)}` : null,
      odometer,
    ]),
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
  const distinctPowertrain = [
    [equipment?.engine, vehicle.engine],
    [equipment?.transmission, vehicle.transmission],
    [equipment?.drivetrain, vehicle.drivetrain],
  ].flatMap(([source, displayed]) => {
    const value = factText(source);
    return value && value.toLocaleLowerCase() !== factText(displayed)?.toLocaleLowerCase() ? [value] : [];
  });
  const equipmentFacts = present([
    ...packages.slice(0, 2), ...equipmentItems.slice(0, 4), powertrain,
    numeric(equipment?.totalMsrp) ? `${formatNumber(equipment.totalMsrp)} MSRP` : null,
  ]);
  const hasEquipment = equipmentFacts.length > 0;
  if (equipmentHref || hasEquipment || equipment) result.push({
    id: 'vauto', title: 'vAuto equipment', subtitle: 'Informational equipment label', brand: 'vauto', facts: equipmentFacts,
    summaryFacts: present([packages[0], equipmentItems.find(item => !packages.some(pkg => equipmentIdentity(pkg) === equipmentIdentity(item))) ?? powertrain]),
    summaryRows: recordRows([
      { label: 'Packages', values: packages.slice(0, 2) },
      { label: 'Key features', values: equipmentItems.filter(item => !packages.some(pkg => equipmentIdentity(pkg) === equipmentIdentity(item))).slice(0, 4) },
      { label: 'Powertrain', values: distinctPowertrain },
      { label: 'MSRP', values: [numeric(equipment?.totalMsrp) && equipment.totalMsrp !== sticker?.totalMsrp ? formatNumber(equipment.totalMsrp) : null] },
    ]),
    compactFacts: present([packages[0], equipmentItems.find(item => !packages.some(pkg => equipmentIdentity(pkg) === equipmentIdentity(item))) ?? powertrain], 2),
    scanFacts: present([
      packages[0] ?? equipmentItems[0],
      equipmentItems.find(item => item !== equipmentItems[0] && !packages.some(pkg => equipmentIdentity(pkg) === equipmentIdentity(item))) ?? powertrain,
    ], 2),
    sourceNote: sourceNote(equipment?.dataState, true, equipment?.capturedAt),
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
    const partialActions = actions.length > 0 && !hasCapturedOasisActionResult(oasis);
    const oasisInService = inService.source === 'oasis' ? inService.date : null;
    const warrantyStart = oasisInService ? `Warranty start ${formatDate(oasisInService)}` : null;
    const buildDate = text(oasis?.buildDate) ? `Built ${formatDate(oasis!.buildDate)}` : null;
    const releaseDate = text(oasis?.releaseDate) ? `Released ${formatDate(oasis!.releaseDate)}` : null;
    const oasisFacts = present([
      ...actions.map(action => `Open FSA ${action}`),
      warrantyStart, buildDate, releaseDate,
      ...coverages.map(coverage => `Coverage: ${coverage}`),
      capturedEmptyActions ? 'No open Ford actions' : null,
      ...(oasis?.extendedCoverageExpirations ?? []).map(expiration => `Extended coverage: ${factText(formatSourceDateText(expiration))}`),
      numeric(oasis?.monthsInService) ? `${formatNumber(oasis.monthsInService)} months in service` : null,
      numeric(oasis?.saleMileage) ? `${formatNumber(oasis.saleMileage)} mi at sale` : null,
    ]);
    const hasOasis = oasisFacts.length > 0;
    if (oasisHref || hasOasis) result.push({
      id: 'oasis', title: 'Ford OASIS', subtitle: hasOasis ? 'Warranty & service actions' : 'Exact-VIN dealer lookup', brand: 'ford',
      facts: oasisFacts,
      summaryFacts: present([actions[0] ? `Open FSA ${actions[0]}` : null, warrantyStart, coverages[0] ? `Coverage: ${coverages[0]}` : null, capturedEmptyActions ? 'No open Ford actions' : null]),
      summaryRows: recordRows([
        { label: partialActions ? 'Captured actions (incomplete)' : 'Open actions', values: actions.length ? actions : capturedEmptyActions ? ['No open Ford actions'] : [] },
        { label: 'Warranty start', values: [oasisInService ? formatDate(oasisInService) : null] },
        { label: 'Coverage', values: coverages },
        { label: 'Built', values: [text(oasis?.buildDate) ? formatDate(oasis!.buildDate) : null] },
        { label: 'Released', values: [text(oasis?.releaseDate) ? formatDate(oasis!.releaseDate) : null] },
        { label: 'In service', values: [numeric(oasis?.monthsInService) ? `${formatNumber(oasis.monthsInService)} months` : null] },
        { label: 'Mileage at sale', values: [numeric(oasis?.saleMileage) ? `${formatNumber(oasis.saleMileage)} mi` : null] },
        { label: 'Extended coverage', values: (oasis?.extendedCoverageExpirations ?? []).map(expiration => factText(formatSourceDateText(expiration))) },
      ]),
      compactFacts: present([actions[0] ? `Open FSA ${actions[0]}` : null, warrantyStart, coverages[0] ? `Coverage: ${coverages[0]}` : null, capturedEmptyActions ? 'No open Ford actions' : null, buildDate, ...oasisFacts], 2),
      scanFacts: present([actions.length ? `${partialActions ? 'At least ' : ''}${actions.length} ${partialActions ? 'captured' : 'open'} service ${actions.length === 1 ? 'action' : 'actions'}${partialActions ? ' · result incomplete' : ''}` : capturedEmptyActions ? 'No open Ford actions' : 'Action status unconfirmed', oasisInService ? `In-service ${formatDate(oasisInService)}` : null]),
      sourceNote: sourceNote(oasis?.dataState, true, oasis?.capturedAt),
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

/** One equipment destination in overview/list surfaces; both raw records remain available. */
export function vehicleOverviewResources(vehicle: VehicleResourceVehicle): VehicleResource[] {
  const resources = vehicleResourceCatalog(vehicle);
  const sticker = resources.find(resource => resource.id === 'window-sticker');
  const factory = resources.find(resource => resource.id === 'vauto');
  const stickerUsable = sticker && vehicle.windowSticker?.dataState !== 'unavailable'
    && Boolean(sticker.stickerDetails?.optionLines.length || sticker.stickerDetails?.equipmentGroup || sticker.stickerDetails?.equipmentGroupContents?.length);
  const factoryUsable = factory?.hasCapturedData && vehicle.factoryEquipment?.dataState !== 'unavailable';
  const preferred = stickerUsable ? sticker : factoryUsable ? factory : sticker ?? factory;
  if (!preferred) return resources;
  let selected: VehicleResource = { ...preferred, title: 'Sticker & equipment' };
  if (preferred.id === 'vauto') {
    const equipment = vehicle.factoryEquipment;
    const exactPrice = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(value);
    const packageLines = (equipment?.packages ?? []).flatMap(pkg => [
      join([pkg.name, pkg.code, numeric(pkg.price) ? `Price ${exactPrice(pkg.price)}` : null]),
      ...(pkg.features ?? []).map(feature => `. ${feature}`),
    ]);
    // Repeated children belong to their respective packages; never deduplicate
    // this ordered source list or round a captured price to whole dollars.
    const optionLines = [...packageLines, ...(equipment?.sections ?? []).flatMap(section => section.items.map(item => join([item.label, numeric(item.price) ? `Price ${exactPrice(item.price)}` : null])))].filter((line): line is string => Boolean(line?.trim()));
    selected = { ...selected, equipmentContext: 'vAuto equipment label · not an original window sticker · currency not captured',
      stickerDetails: { msrp: numeric(equipment?.totalMsrp) ? exactPrice(equipment.totalMsrp) : undefined, optionLines, optionLabel: 'Packages & captured equipment' },
      alternateSticker: sticker?.href && vehicle.windowSticker?.dataState !== 'unavailable' ? { href: sticker.href, label: sticker.demo ? 'Demo sticker' : 'Window sticker' } : undefined,
    };
  } else selected.equipmentContext = selected.demo ? 'Synthetic sample · not an original' : 'Original window sticker';
  const remaining = resources.filter(resource => resource.id !== 'window-sticker' && resource.id !== 'vauto');
  return [selected, ...remaining];
}
