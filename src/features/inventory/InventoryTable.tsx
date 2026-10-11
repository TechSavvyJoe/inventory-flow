import { importedHoldSummary, providerHoldState } from "./provider-evidence-utils";
import { DISPOSITION_LABELS } from '../overview/disposition-model';
import { equipmentFinderItems } from "./vehicle-equipment";
import { CertifiedBadge } from "../../components/CertifiedBadge";
import { WorkspaceLink } from "../../components/WorkspaceLink";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CarFront,
  ChevronRight,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Heart,
  Truck,
  UserRound,
} from "lucide-react";
import { CopyableValue } from "../../components/CopyableValue";
import { ServiceStatusLink } from "./ServiceStatusLink";
import { InventoryRecordsPanel } from "./InventoryRecordsPanel";
import { VehicleResourceCards, VehicleResourceScan } from "./VehicleResourceCards";
import { oasisActionLabel, vehicleOverviewResources } from "./vehicle-resource-catalog";
import {
  formatMileage,
  formatMoney,
  formatDate,
  resolveCurrentLocation,
  SORT_LABELS,
  vehicleDisplayName,
} from "./inventory-utils";
import { primaryVehicleChangeSignal } from "./change-utils";
import { factoryPriceLabel, factoryPricing, formatFactoryPrice } from "../../../extension/sidepanel/lib/factory-pricing.mjs";
import {
  availableWindowStickerUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from "./vehicle-document-utils";
import { compactEquipmentScanLabel, publishedEquipment, standoutEquipment } from "./vehicle-feature-utils";
import { useCustomerShortlist } from "./useCustomerShortlist";
import { slaLabel, slaState } from "../../lib/sla-label";
import { vehiclePhotoDisplaySources } from "../../lib/vehicle-photos";
import type {
  InventoryTableProps,
  InventoryVehicle,
} from "./types";
import "./InventoryTable.desk.css";
import "./InventoryMobile.scan.css";

export function VehiclePhoto({ vehicle, className = "", priority = true }: { vehicle: InventoryVehicle; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const sources = useMemo(() => vehiclePhotoDisplaySources(vehicle, { width: 240 }), [vehicle]);
  const sourceKey = sources.join("\u0000");
  const [sourceIndex, setSourceIndex] = useState(0);
  const src = sources[sourceIndex];

  const markSourceFailed = useCallback(() => {
    setLoaded(false);
    setSourceIndex((current) => {
      if (current < sources.length - 1) return current + 1;
      setFailed(true);
      return current;
    });
  }, [sources.length]);

  useEffect(() => {
    setSourceIndex(0);
    setFailed(false);
    setLoaded(false);
  }, [sourceKey]);

  useEffect(() => {
    const image = imageRef.current;
    if (!src || failed || !image?.complete) return;
    if (image.naturalWidth > 0) {
      setLoaded(true);
      return;
    }
    markSourceFailed();
  }, [src, failed, sourceKey, markSourceFailed]);

  return src && !failed ? (
    <>
      {loaded ? null : (
        <span
          className="inventory-vehicle-visual__placeholder inventory-vehicle-visual__placeholder--loading"
          aria-hidden="true"
        >
          <CarFront size={24} strokeWidth={1.6} aria-hidden="true" />
        </span>
      )}
      <img
        ref={imageRef}
        key={src}
        className={`${className}${loaded ? " is-loaded" : " is-loading"}`.trim()}
        src={src}
        alt={`${vehicleDisplayName(vehicle)} exterior`}
        // Start the visible rows immediately and let lower rows wait until the
        // browser is ready. The VDP reuses the same URL from cache.
        loading={priority ? "eager" : "lazy"}
        fetchPriority="low"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={markSourceFailed}
      />
    </>
  ) : (
    <span className={`inventory-vehicle-visual__placeholder ${className}`} aria-label="Vehicle photo unavailable">
      <CarFront size={26} strokeWidth={1.6} aria-hidden="true" />
    </span>
  );
}

type OperationalStatus = {
  label: string;
  detail: string;
  tone: "hold" | "clear" | "move" | "unknown" | "warning";
  icon: typeof UserRound;
};

export function vehicleOperationalStatus(vehicle: InventoryVehicle): OperationalStatus {
  if (vehicle.manualHold?.state === 'active') return { label: 'Held', detail: 'Confirmed in Inventory Flow. Review reported evidence separately.', tone: 'hold', icon: UserRound };
  if (vehicle.manualHold?.state === 'requested') return { label: 'Pending approval', detail: 'Awaiting manager approval. This request is not a confirmed hold.', tone: 'warning', icon: UserRound };
  if (vehicle.operationalEvidence) return { label: importedHoldSummary(vehicle), detail: 'Read-only provider observations. Confirm availability with the store.', tone: providerHoldState(vehicle) === true ? 'hold' : providerHoldState(vehicle) === false ? 'clear' : 'unknown', icon: UserRound };
  return importedHoldOperationalStatus(vehicle);
}

function importedHoldOperationalStatus(vehicle: InventoryVehicle): OperationalStatus {
  if (vehicle.dealerMail.dataState !== "current") {
    const evidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
    const previousPrimary = evidence?.find((record) => record.position === "primary") ?? evidence?.[0];
    const previousOwner = previousPrimary?.salesperson?.trim();
    return {
      label: vehicle.dealerMail.lastKnownActiveHold ? `Last verified hold${previousOwner ? ` · ${previousOwner}` : ""}` : "Hold status unverified",
      detail: vehicle.dealerMail.lastKnownActiveHold || vehicle.dealerMail.hasActiveHold === true
        ? `Previous hold${previousOwner ? ` · ${previousOwner}` : ""} retained; confirm current status with the store`
        : "Latest hold data unavailable; confirm current status with the store",
      tone: "unknown",
      icon: CircleHelp,
    };
  }

  if (vehicle.dealerMail.hasActiveHold === true) {
    const visibleEvidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
    const primary = visibleEvidence?.find((record) => record.position === "primary") ?? visibleEvidence?.[0];
    const backupCount = Math.max(0, (vehicle.dealerMail.activeRecordCount ?? 1) - 1);
    const owner = primary?.salesperson?.trim();
    // The salesperson owns the hold record; "Held by" is reserved for
    // DealerMail's own heldBy evidence, shown beside the hold detail.
    return {
      label: owner ? `Hold · ${owner}` : backupCount ? `Held · ${backupCount} backup${backupCount === 1 ? "" : "s"}` : "Held",
      detail: primary?.customerOrReason || vehicle.dealerMail.conciseState || "Current hold",
      tone: "hold",
      icon: UserRound,
    };
  }

  if (vehicle.dealerMail.hasActiveHold === false) {
    return {
      label: "No current hold",
      detail: "Availability still requires confirmation",
      tone: "clear",
      icon: UserRound,
    };
  }

  return {
    label: "Hold status unverified",
    detail: "Latest hold data unavailable",
    tone: "unknown",
    icon: CircleHelp,
  };
}

function dealerMailLoanerSummary(vehicle: InventoryVehicle): { label: string; detail: string } | null {
  const loaner = vehicle.dealerMail.loaner;
  if (!loaner?.active) return null;
  const serviceDate = loaner.serviceDate?.trim();
  const label = loaner.program ? `Loaner ${loaner.program}` : loaner.label || "Loaner";
  const current = vehicle.dealerMail.dataState === "current";
  const visibleAlert = vehicle.dealerMail.canViewEvidence === true ? loaner.rawAlert : null;
  return {
    label: `${current ? "" : "Saved "}${label}${serviceDate ? ` · ${serviceDate}` : ""}`,
    detail: current
      ? visibleAlert || "Current DealerMail loaner/service signal"
      : `Saved DealerMail loaner/service signal · current status unverified${visibleAlert ? ` · ${visibleAlert}` : ""}`,
  };
}

/**
 * The shared src/lib/sla-label wording, so the list, the vehicle page and
 * Moves read the same. Overdue is urgent (the warning tone) only when the
 * viewer's own store owns the next step; another store's overdue move stays
 * a plain fact naming who it is waiting on. A list row names only the owning
 * store ("Overdue · Fowlerville", as wide as the old "Move needs attention")
 * so it stays one line; the full wording is its hover detail, as on the
 * vehicle page and Moves.
 */
export function vehicleMovementStatus(vehicle: InventoryVehicle, viewerStore?: string | null): OperationalStatus | null {
  const movement = vehicle.movement;
  if (!movement || !(movement.state || movement.requestStatus || movement.requestId)) return null;
  const status = slaLabel({
    sla: slaState(movement.dueAt),
    nextActionStore: movement.nextActionStore,
    nextActionOwner: movement.nextActionOwner,
    viewerStore,
  });
  const waitingOnOtherStore = status.overdue && status.ownedByViewer === false && Boolean(movement.nextActionStore?.trim());
  return {
    label: waitingOnOtherStore ? `Overdue · ${movement.nextActionStore!.trim()}` : status.overdue ? status.label : movement.state || movement.requestStatus || "Being moved",
    detail: waitingOnOtherStore ? status.label : movement.nextAction || movement.lastEventLabel || "Movement in progress",
    tone: status.overdue ? (status.tone === "danger" ? "warning" : "move") : "move",
    icon: Truck,
  };
}

function compactInventoryDate(value: string | null | undefined): string | null {
  return value ? formatDate(value) : null;
}

function vehiclePhotoCount(vehicle: InventoryVehicle): number {
  return vehicle.photoCount ?? vehicle.imageUrls?.length ?? (vehicle.imageUrl ? 1 : 0);
}

function stopRowSelection(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

function humanizeStatusLabel(label: string): string {
  if (!/_/.test(label)) return label;
  const words = label.replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function DeskVehicleCell({ vehicle, onSelectVehicle, priority }: {
  priority?: boolean;
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
}) {
  const name = vehicleDisplayName(vehicle);
  const identity = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.vehicleName?.trim() || name;
  const series = [...new Set([vehicle.trim, vehicle.bodyType || vehicle.bodyStyle].filter((value): value is string => Boolean(value?.trim())))].join(" · ");
  return (
    <div className="inv-desk-vehicle">
      <button type="button" className="inv-desk-vehicle__photo" aria-label={`View photos and details for ${name}`} onClick={event => { stopRowSelection(event); onSelectVehicle(vehicle); }}>
        <VehiclePhoto vehicle={vehicle} className="inv-desk-vehicle__img" priority={priority} />
        <PhotoCount vehicle={vehicle} />
      </button>
      <div className="inv-desk-vehicle__body">
        <div className="inv-desk-vehicle__heading">
        <button type="button" className="inv-desk-vehicle__title" data-row-action="open-details" data-inventory-vehicle-trigger={vehicle.id} aria-label={`Open vehicle details for ${name}`} title={name} onClick={event => { stopRowSelection(event); onSelectVehicle(vehicle); }}>
          <strong>{identity}</strong>
          <span className="inv-desk-vehicle__series">{series ? <span>{series}</span> : null}<CertifiedBadge certified={vehicle.certified} homeStore={vehicle.location.homeStore.name}/><span className="inv-desk-vehicle__age">{vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : "Age unavailable"}</span></span>
        </button>
        <DeskPriceCell vehicle={vehicle}/>
        </div>
        <DeskConfigurationCell vehicle={vehicle} onSelectVehicle={onSelectVehicle}/>
        <VehicleChangeHistory vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
      </div>
      <DeskVehicleFacts vehicle={vehicle}/>
    </div>
  );
}

function DeskVehicleFacts({ vehicle }: { vehicle: InventoryVehicle }) {
  const name = vehicleDisplayName(vehicle);
  return <div className="inv-desk-vehicle-facts">
      <div className="inv-desk-vehicle__identifiers" role="group" aria-label={`Copy identifiers for ${name}`}>
        <dl className="inv-desk-vehicle__facts">
          <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stockNumber}>{vehicle.stockNumber}</CopyableValue></dd></div>
          <div><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin}>{vehicle.vin}</CopyableValue></dd></div>
        </dl>
      </div>
      <VehicleRegistrationFacts vehicle={vehicle} />
  </div>;
}

function VehicleChangeHistory({ vehicle, onSelectVehicle }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
}) {
  const signal = primaryVehicleChangeSignal(vehicle.changeSummary);
  const change = signal && signal.kind !== "other" ? signal : null;
  if (!change) return null;
  return <button type="button" className={`inv-desk-change inv-desk-change--${change.kind}`} data-row-action="history" data-inventory-vehicle-trigger={vehicle.id}
    aria-label={`View change history for ${vehicleDisplayName(vehicle)}: ${change.shortLabel}`} title={vehicle.changeSummary || change.label}
    onClick={event => { stopRowSelection(event); event.currentTarget.focus({ preventScroll: true }); onSelectVehicle(vehicle, "timeline"); }}>
    {change.shortLabel}
  </button>;
}

function VehicleRegistrationFacts({ vehicle }: { vehicle: InventoryVehicle }) {
  const pricing = factoryPricing(vehicle);
  const hasMileage = typeof vehicle.mileage === "number" && Number.isFinite(vehicle.mileage);
  if (pricing.base.value === null && !hasMileage) return null;
  return <dl className="inventory-registration-facts" aria-label="Registration calculator values">
    {pricing.base.value !== null ? <div><dt title={pricing.base.source === "vauto" ? "vAuto equipment" : "Window sticker"}>{factoryPriceLabel(pricing.base.source, true)}</dt><dd>
      <CopyableValue compact label={pricing.base.source === "vauto" ? "vAuto base MSRP" : "window sticker base MSRP"} text={String(pricing.base.value)}>{formatFactoryPrice(pricing.base.value, pricing.base.currency)}</CopyableValue>
    </dd></div> : null}
    {hasMileage ? <div><dt>Mileage</dt><dd><CopyableValue compact label="mileage" text={String(vehicle.mileage)}>{formatMileage(vehicle.mileage)}</CopyableValue></dd></div> : null}
  </dl>;
}

function openRecallCount(vehicle: InventoryVehicle): number {
  return vehicle.fordOasis?.openFieldServiceActions.length ?? 0;
}

function openRecallSummary(vehicle: InventoryVehicle): string | null {
  const count = openRecallCount(vehicle);
  return count ? oasisActionLabel(vehicle.fordOasis) : null;
}

function DeskPriceCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const hasPrice = typeof vehicle.price === "number" && Number.isFinite(vehicle.price);
  const pricing = factoryPricing(vehicle);
  const originalMsrp = pricing.original.value === null ? null : {
    label: factoryPriceLabel(pricing.original.source),
    value: formatFactoryPrice(pricing.original.value, pricing.original.currency),
    source: pricing.original.source === "vauto" ? "vAuto equipment" : "Window sticker",
  };
  return <div className={`inv-desk-price${hasPrice ? "" : " is-unavailable"}`}>
    <strong>{formatMoney(vehicle.price)}</strong>
    {originalMsrp ? <dl className="inv-desk-price__context">
      <div><dt title={originalMsrp.source}>{originalMsrp.label}</dt><dd>{originalMsrp.value}</dd></div>
    </dl> : null}
  </div>;
}

function capturedFuelEconomy(vehicle: InventoryVehicle): string | null {
  const city = typeof vehicle.mpgCity === "number" && Number.isFinite(vehicle.mpgCity) && vehicle.mpgCity > 0 ? vehicle.mpgCity : null;
  const highway = typeof vehicle.mpgHighway === "number" && Number.isFinite(vehicle.mpgHighway) && vehicle.mpgHighway > 0 ? vehicle.mpgHighway : null;
  if (city !== null && highway !== null) return `${city} city / ${highway} hwy MPG`;
  if (city !== null) return `${city} city MPG`;
  if (highway !== null) return `${highway} hwy MPG`;
  return null;
}

function DeskLocationCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const current = resolveCurrentLocation(vehicle);
  return <div className="inv-desk-location" title={current.detail}>
    <strong>{current.label}</strong>
    {current.store?.id !== vehicle.location.homeStore.id ? <small>Home: {vehicle.location.homeStore.name}</small> : null}
    {vehicle.location.conflict ? <small className="is-warning">Confirm location</small> : null}
  </div>;
}

function importedHoldDetail(vehicle: InventoryVehicle): string | null {
  const visibleEvidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
  const primaryEvidence = visibleEvidence?.find((record) => record.position === "primary") ?? visibleEvidence?.[0];
  const backupCount = Math.max(0, (vehicle.dealerMail.activeRecordCount ?? 0) - 1);
  const heldBy = primaryEvidence?.heldBy?.trim();
  const showHeldBy = heldBy && heldBy.toLocaleLowerCase() !== primaryEvidence?.salesperson?.trim().toLocaleLowerCase();
  return vehicle.dealerMail.lastKnownActiveHold || (vehicle.dealerMail.dataState === "current" && vehicle.dealerMail.hasActiveHold === true)
    ? [primaryEvidence?.expectedDeliveryDate ? `Expected ${compactInventoryDate(primaryEvidence.expectedDeliveryDate) ?? primaryEvidence.expectedDeliveryDate}` : null,
      backupCount ? `${backupCount} backup${backupCount === 1 ? "" : "s"}` : null,
      showHeldBy ? `Held by ${heldBy}` : null].filter(Boolean).join(" · ") || importedHoldOperationalStatus(vehicle).detail
    : null;
}

function DeskStatusCell({ vehicle, onSelectVehicle, onOpenSourceRecord, viewerStore }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
  onOpenSourceRecord?: InventoryTableProps["onOpenSourceRecord"];
  viewerStore?: string | null;
}) {
  const name = vehicleDisplayName(vehicle);
  const holdStatus = vehicleOperationalStatus(vehicle);
  const movement = vehicleMovementStatus(vehicle, viewerStore);
  const manualActive = vehicle.manualHold?.state === 'active' || vehicle.manualHold?.state === 'requested';
  const canOpenDealerMail = !vehicle.operationalEvidence && !manualActive && vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const importedStatus = importedHoldOperationalStatus(vehicle);
  const holdDetail = importedHoldDetail(vehicle);
  const loaner = dealerMailLoanerSummary(vehicle);
  const manualExpected = manualActive ? compactInventoryDate(vehicle.manualHold?.expectedDeliveryDate) : null;
  // Keep manual dates with the app record and source details with DealerMail.
  // Movement, service and disposition remain independent facts.
  return <dl className="inv-desk-status">
    <div className="inv-desk-status__row" data-fact="location"><dt>Location</dt><dd><DeskLocationCell vehicle={vehicle} /></dd></div>
    <div className="inv-desk-status__row" data-fact="hold"><dt>Hold</dt><dd>
      <div role={manualActive ? 'group' : undefined} aria-label={manualActive ? 'Inventory Flow hold' : undefined}>
      <button type="button" className={`inv-desk-hold inv-desk-hold--${holdStatus.tone}`} data-inventory-vehicle-trigger={vehicle.id}
        aria-label={canOpenDealerMail ? `Review DealerMail handoff for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}` : `Open hold details for ${name}`}
        title={holdStatus.detail} onClick={event => { stopRowSelection(event); event.currentTarget.focus({ preventScroll: true }); if (canOpenDealerMail) onOpenSourceRecord?.(vehicle, "dealermail"); else onSelectVehicle(vehicle, "hold"); }}>
        <span className="inv-desk-hold__dot" aria-hidden="true" /><span>{holdStatus.label}</span>
      </button>
      {manualActive && manualExpected ? <small className="inv-desk-status__detail">Expected {manualExpected}</small> : null}
      </div>
      {!manualActive && holdDetail ? <small className="inv-desk-status__detail">{holdDetail}</small> : null}
      {manualActive ? <div role="group" aria-label="Reported hold evidence">
        <small className="inv-desk-status__detail">{vehicle.operationalEvidence ? "Reports" : "DealerMail"}: {vehicle.operationalEvidence ? importedHoldSummary(vehicle) : importedStatus.label}</small>
        {holdDetail ? <small className="inv-desk-status__detail">{holdDetail}</small> : null}
      </div> : null}
      {loaner ? <small className="inv-desk-status__detail" data-fact="dealer-mail-loaner">DealerMail loaner/service: {loaner.label} · {loaner.detail}</small> : null}
    </dd></div>
    {movement ? <div className="inv-desk-status__row" data-fact="move"><dt>Move</dt><dd><span className={`inv-desk-move${movement.tone === "warning" ? " is-warning" : ""}`} title={movement.detail}>{humanizeStatusLabel(movement.label)}</span></dd></div> : null}
    <div className="inv-desk-status__row" data-fact="service"><dt>Service</dt><dd><ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} detailed /></dd></div>
    {vehicle.appDisposition?.code || vehicle.inventoryDecision?.comparison === 'conflict' ? <div className="inv-desk-status__row" data-fact="manual-decision"><dt>Decision</dt><dd><button type="button" className="inv-desk-hold inv-desk-decision" data-inventory-vehicle-trigger={vehicle.id} aria-label={`Review inventory decision for ${name}`} onClick={event => { stopRowSelection(event); event.currentTarget.focus({ preventScroll: true }); onSelectVehicle(vehicle, 'hold'); }}>{vehicle.appDisposition?.code ? `${DISPOSITION_LABELS[vehicle.appDisposition.code]}${vehicle.inventoryDecision?.comparison === 'conflict' ? ' · Records disagree' : ''}` : vehicle.inventoryDecision?.comparison === 'conflict' ? 'Records disagree' : vehicle.inventoryDecision?.label}</button></dd></div> : null}
    {vehicle.managerDisposition ? <div className="inv-desk-status__row" data-fact="sale"><dt>Sale</dt><dd><small className="inv-desk-disposition" data-state={vehicle.managerDisposition.dataState}>{vehicle.managerDisposition.soldLabel} · {vehicle.managerDisposition.deliveryLabel}</small></dd></div> : null}
  </dl>;
}

function DeskEquipmentCell({ vehicle, onSelectVehicle, limit = 3, previewOnly = false }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
  limit?: 1 | 2 | 3;
  previewOnly?: boolean;
}) {
  const published = publishedEquipment(vehicle);
  if (!published.length) return <span className="inv-desk-quiet">No published highlights</span>;
  const standout = standoutEquipment(vehicle, published.length);
  // The factory equipment group is the clearest short comparison cue. When
  // it is absent, prefer a naturally concise standout before falling back to
  // a summarized option. The full exact list remains in Records.
  const scanHeadline = published.find((item) => item.source === "factory-equipment-group")
    ?? standout.find((item) => compactEquipmentScanLabel(item.label).length <= 42)
    ?? published.find((item) => compactEquipmentScanLabel(item.label).length <= 42)
    ?? standout[0]
    ?? published[0];
  const seenLabels = new Set<string>();
  const chips = [scanHeadline, ...published.filter(item => /\bpackage\b/i.test(item.label)), ...standout, ...published]
    .filter(item => {
      // A package repeated by vAuto with its option code is the same scan cue.
      const label = compactEquipmentScanLabel(item.label).replace(/\s*\([A-Z0-9-]+\)$/, '').toLocaleLowerCase();
      if (seenLabels.has(label)) return false;
      seenLabels.add(label);
      return true;
    }).slice(0, limit);
  const equipmentCount = equipmentFinderItems(vehicle).length;
  const remaining = Math.max(0, equipmentCount - chips.length);
  const preview = published.slice(0, 6).map((item) => item.label).join(" · ");
  if (previewOnly) return <span className="inventory-mobile-row__equipment-preview" title={preview}>
    {chips.map((item, index) => <span key={`${item.source}:${item.label}`}>{index ? " · " : ""}{compactEquipmentScanLabel(item.label)}</span>)}
    {remaining ? <span className="inv-desk-equipment__more"> +{remaining} more</span> : null}
  </span>;
  return (
    <button
      type="button"
      className="inv-desk-equipment"
      data-row-action="equipment"
      data-inventory-vehicle-trigger={vehicle.id}
      aria-label={`View all ${equipmentCount} equipment items for ${vehicleDisplayName(vehicle)}`}
      title={equipmentCount > 6 ? `${preview} · +${equipmentCount - 6} more` : preview}
      onClick={(event) => {
        stopRowSelection(event);
        event.currentTarget.focus({ preventScroll: true });
        onSelectVehicle(vehicle, "equipment");
      }}
    >
      <small className="inv-desk-equipment__label">Equipment</small>
      <span className="inv-desk-equipment__values">
        {chips.map((item, index) => (
          <span className="inv-desk-equipment__item" key={`${item.source}:${item.label}`}>{compactEquipmentScanLabel(item.label)}{index < chips.length - 1 ? ", " : ""}</span>
        ))}
        {remaining > 0 ? <span className="inv-desk-equipment__more">+{remaining} more</span> : null}
      </span>
    </button>
  );
}

function DeskConfigurationCell({ vehicle, onSelectVehicle }: { vehicle: InventoryVehicle; onSelectVehicle: InventoryTableProps["onSelectVehicle"] }) {
  const configuration = [vehicle.bodyType || vehicle.bodyStyle, vehicle.drivetrain].filter(Boolean).join(" · ");
  const powertrain = [vehicle.engine, vehicle.drivetrain].filter(Boolean).join(" · ");
  const transmission = [vehicle.transmission?.replace(/\bautomatic\b/gi, "auto"), vehicle.fuelType].filter(Boolean).join(" · ");
  const fuelEconomy = capturedFuelEconomy(vehicle);
  return <div className="inv-desk-configuration">
    <div className="inv-desk-configuration__fact"><small>Engine</small><span title={[vehicle.bodyType || vehicle.bodyStyle, vehicle.transmission, vehicle.fuelType].filter(Boolean).join(" · ")}>{powertrain || configuration || "Specifications not published"}</span></div>
    {transmission ? <div className="inv-desk-configuration__fact"><small>Transmission</small><span title={[vehicle.transmission, vehicle.fuelType].filter(Boolean).join(" · ")}>{transmission}</span></div> : null}
    {fuelEconomy ? <div className="inv-desk-configuration__fact"><small>{/^\d+ city \/ \d+ hwy MPG$/.test(fuelEconomy) ? 'MPG city/hwy' : 'Economy'}</small><span className="inv-desk-configuration__economy" title={fuelEconomy}>{fuelEconomy.replace(/^(\d+) city \/ (\d+) hwy MPG$/, '$1 / $2')}</span></div> : null}
    <div className="inv-desk-vehicle__comparison">
      {vehicle.exteriorColor ? <span><small>Exterior</small>{vehicle.exteriorColor}</span> : null}
      {vehicle.interiorColor ? <span><small>Interior</small>{vehicle.interiorColor}</span> : null}
    </div>
    <DeskEquipmentCell vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
  </div>;
}

interface DeskRowActionsProps extends Pick<
  InventoryTableProps,
  | "canRequestVehicle"
  | "moveActionFor"
  | "onRequestVehicle"
  | "onMoveVehicle"
  | "onTrackMovement"
  | "onOpenListing"
  | "onSelectVehicle"
  | "onOpenSourceRecord"
> {
  vehicle: InventoryVehicle;
  variant?: "desktop" | "mobile";
  subset?: "valuation" | "movement";
  hideRecords?: boolean;
  hideListing?: boolean;
  /** Row-owned Records launcher; when supplied it renders beside Details so every row action lives in one group. */
  recordsAction?: ReactNode;
  /** Only for layouts without an Operations service signal of their own. */
  includeServiceLink?: boolean;
  recordsDisclosure?: { expanded: boolean; controls: string; onToggle: () => void };
}

// Hold status and service readiness are already labeled, clickable signals in
// the Operations column, so the action group deliberately does not repeat them.
// Every remaining action is directly visible (no overflow menu) at 44px.
export function DeskRowActions({
  vehicle, variant, canRequestVehicle, moveActionFor, onRequestVehicle, onMoveVehicle, onTrackMovement, onOpenListing, onSelectVehicle, subset, recordsAction, recordsDisclosure, hideRecords = false, hideListing = false, includeServiceLink = false,
}: DeskRowActionsProps) {
  const shortlist = useCustomerShortlist();
  const saved = shortlist.isShortlisted(vehicle);
  const shortlistWriteBlocked = Boolean(shortlist.management && (!shortlist.management.readyForWrites || shortlist.management.saving || shortlist.management.pendingAction || shortlist.management.accessRevoked));
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const requestAllowed = canRequestVehicle?.(vehicle) === true;
  const canTrack = Boolean(onTrackMovement && vehicle.movement?.requestId && vehicleMovementStatus(vehicle));
  const explicitMoveAction = moveActionFor?.(vehicle) ?? null;
  const moveAction = explicitMoveAction ?? (requestAllowed ? { intent: "request" as const, label: "Request vehicle", shortLabel: "Request" } : null);
  const canCreateMove = Boolean(moveAction && (onMoveVehicle || onRequestVehicle) && (!canTrack || explicitMoveAction));
  const movementActions = <>{subset !== "valuation" && canTrack ? <button type="button" className="inv-desk-action inv-desk-action--movement" data-row-action="track-movement"
        onClick={() => onTrackMovement?.(vehicle)} aria-label={`Track movement for ${name}`} title="Track movement"><Truck size={16} aria-hidden="true" />Track</button> : null}
      {subset !== "valuation" && canCreateMove ? <button type="button" className={`inv-desk-action${canTrack ? "" : " inv-desk-action--movement"}`}
        data-row-action={moveAction?.intent === "direct" ? "move-vehicle" : "request-vehicle"}
        onClick={() => {
          if (moveAction && onMoveVehicle) onMoveVehicle(vehicle, moveAction.intent);
          else onRequestVehicle?.(vehicle);
        }}
        aria-label={`${moveAction?.label} ${name}`}
        title={moveAction?.label}><Truck size={16} aria-hidden="true" />{moveAction?.shortLabel}</button> : null}</>;
  return (
    <div className="inv-desk-actions" data-action-layout={subset ?? "all"} role="group" aria-label={`${subset === "valuation" ? "Price actions" : subset === "movement" ? "Movement actions" : "Actions"} for ${name}`} onClick={stopRowSelection}>
      {!subset ? recordsAction : null}
      {!subset && !hideRecords && !recordsAction ? <button type="button" className={`inv-desk-action${recordsDisclosure ? " inv-desk-action--records" : ""}`} data-row-action="records"
        aria-expanded={recordsDisclosure?.expanded} aria-controls={recordsDisclosure?.controls}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (recordsDisclosure) recordsDisclosure.onToggle();
          else onSelectVehicle(vehicle, "data");
        }} aria-label={`Open vehicle records for ${name}`} title="Open vehicle records">
        <FileText size={16} aria-hidden="true" />Records{recordsDisclosure ? <ChevronDown size={14} aria-hidden="true" className={recordsDisclosure.expanded ? "is-expanded" : undefined}/> : null}
      </button> : null}
      {!subset && includeServiceLink ? <WorkspaceLink className="inv-desk-action" data-row-action="service" preserveOrigin to={`/service?vin=${encodeURIComponent(vehicle.vin)}`}
        aria-label={`Open service status for ${name}`} title="Open service status">
        Service
      </WorkspaceLink> : null}
      {variant !== "desktop" ? movementActions : null}
      {subset !== "movement" ? <button type="button" className="inv-desk-action inv-desk-action--save" data-row-action="shortlist"
        aria-label={saved ? `Remove ${vehicle.stockNumber} from shortlist` : `Save ${vehicle.stockNumber} to shortlist`}
        aria-pressed={saved} title={shortlistWriteBlocked ? "Saved lists are not ready" : saved ? "Remove from shortlist" : "Save to shortlist"} disabled={shortlistWriteBlocked} onClick={() => shortlist.toggle(vehicle)}>
        <Heart size={14} aria-hidden="true" fill={saved ? "currentColor" : "none"} />{!subset ? saved ? "Saved" : "Save" : null}
      </button> : null}
      {subset !== "movement" && listingUrl && !hideListing ? onOpenListing ? (
        <button type="button" className="inv-desk-action inv-desk-action--listing" data-row-action="listing"
          title="Open listing" aria-label={`Open listing for ${name}`} onClick={() => onOpenListing(vehicle)}>
          {!subset ? "Listing " : null}<ExternalLink size={13} aria-hidden="true" />
        </button>
      ) : <a className="inv-desk-action inv-desk-action--listing" data-row-action="listing" href={listingUrl}
        target="_blank" rel="noopener noreferrer" title="Open listing" aria-label={`Open listing for ${name} in a new tab`}>
        {!subset ? "Listing " : null}<ExternalLink size={13} aria-hidden="true" />
      </a> : null}
      {!subset && !listingUrl && !hideListing ? <button type="button" className="inv-desk-action inv-desk-action--listing" data-row-action="listing"
        disabled title="No captured public listing link" aria-label={`Listing unavailable for ${name}`}>
        Listing <ExternalLink size={13} aria-hidden="true" />
      </button> : null}
      {variant === "desktop" ? <>{canTrack || canCreateMove ? <span className="inv-desk-actions__divider" aria-hidden="true" /> : null}{movementActions}</> : null}
    </div>
  );
}

function mobileDocumentAvailability(vehicle: InventoryVehicle) {
  const autoCheck = vehicle.autoCheckReport;
  const hasCapturedAutoCheck = autoCheck?.accessMethod === "vauto" && Boolean(
    autoCheck.score != null
      || autoCheck.ownerCount != null
      || autoCheck.reportRunAt
      || autoCheck.recentInspection
      || autoCheck.checks?.length,
  );
  return {
    autoCheck: Boolean(officialVehicleDocumentUrl(autoCheck?.url, "autocheck", vehicle.publicListing.listingUrl) || hasCapturedAutoCheck),
    sticker: Boolean(availableWindowStickerUrl(vehicle.windowSticker, vehicle.publicListing.listingUrl)),
    factoryEquipment: Boolean(vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url)),
  };
}

function PhotoCount({ vehicle }: { vehicle: InventoryVehicle }) {
  const count = vehiclePhotoCount(vehicle);
  return count > 0 ? <span className="inventory-photo-count" aria-label={`${count} vehicle photos`}>{count}</span> : null;
}

export function vehicleAccessibleSummary(vehicle: InventoryVehicle, viewerStore?: string | null): string {
  const name = vehicleDisplayName(vehicle);
  const hold = vehicleOperationalStatus(vehicle);
  const movement = vehicleMovementStatus(vehicle, viewerStore);
  const location = resolveCurrentLocation(vehicle);
  const change = primaryVehicleChangeSignal(vehicle.changeSummary);
  return [
    `Open details for ${name}`,
    `stock ${vehicle.stockNumber}`,
    `VIN ${vehicle.vin}`,
    formatMoney(vehicle.price),
    formatMileage(vehicle.mileage),
    hold.label.startsWith("Hold") ? hold.label : `Hold: ${hold.label}`,
    `Current location: ${location.label}`,
    movement ? `Movement: ${movement.label}` : null,
    change ? `Recent change: ${change.shortLabel}` : null,
    mobileDocumentAvailability(vehicle).autoCheck ? "AutoCheck history available" : null,
    availableWindowStickerUrl(vehicle.windowSticker, vehicle.publicListing.listingUrl) ? "Window sticker available" : null,
    vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url) ? "vAuto informational equipment profile available" : null,
    openRecallSummary(vehicle),
  ].filter(Boolean).join(", ");
}

type RowActionHandlers = Pick<
  InventoryTableProps,
  | "onSelectVehicle"
  | "canRequestVehicle"
  | "moveActionFor"
  | "onRequestVehicle"
  | "onMoveVehicle"
  | "onTrackMovement"
  | "onOpenListing"
  | "onOpenSourceRecord"
>;

/**
 * Rows are memoized so a search keystroke or a selection change re-renders
 * only the rows whose own inputs changed. Parents recreate their callbacks on
 * every render, so the latest handlers live in a ref and rows receive one
 * delegating object. It is rebuilt only when a handler appears or disappears,
 * because presence decides whether an action renders at all.
 */
function useStableRowHandlers(handlers: RowActionHandlers): RowActionHandlers {
  const latest = useRef(handlers);
  latest.current = handlers;
  const shape = [
    Boolean(handlers.canRequestVehicle),
    Boolean(handlers.moveActionFor), Boolean(handlers.onRequestVehicle), Boolean(handlers.onMoveVehicle),
    Boolean(handlers.onTrackMovement), Boolean(handlers.onOpenListing), Boolean(handlers.onOpenSourceRecord),
  ].join();
  return useMemo<RowActionHandlers>(() => {
    const current = latest.current;
    // Forward the exact argument list: callers and tests distinguish
    // `onSelectVehicle(vehicle)` from `onSelectVehicle(vehicle, undefined)`.
    return {
      onSelectVehicle: (...args) => latest.current.onSelectVehicle(...args),
      canRequestVehicle: current.canRequestVehicle ? (...args) => latest.current.canRequestVehicle?.(...args) ?? false : undefined,
      moveActionFor: current.moveActionFor ? (...args) => latest.current.moveActionFor?.(...args) ?? null : undefined,
      onRequestVehicle: current.onRequestVehicle ? (...args) => latest.current.onRequestVehicle?.(...args) : undefined,
      onMoveVehicle: current.onMoveVehicle ? (...args) => latest.current.onMoveVehicle?.(...args) : undefined,
      onTrackMovement: current.onTrackMovement ? (...args) => latest.current.onTrackMovement?.(...args) : undefined,
      onOpenListing: current.onOpenListing ? (...args) => latest.current.onOpenListing?.(...args) : undefined,
      onOpenSourceRecord: current.onOpenSourceRecord ? (...args) => latest.current.onOpenSourceRecord?.(...args) : undefined,
    };
  // The ref always holds the latest handlers; only their presence is a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
}

type OpenRecords = (vehicle: InventoryVehicle, trigger: HTMLElement) => void;

function RecordsLauncher({ vehicle, expanded, onOpenRecords, className, chevron }: {
  vehicle: InventoryVehicle; expanded: boolean; onOpenRecords: OpenRecords; className: string; chevron: boolean;
}) {
  return <button type="button" className={className} data-row-action="records" data-inventory-vehicle-trigger={vehicle.id}
    aria-label={`Open vehicle records for ${vehicleDisplayName(vehicle)}`} aria-haspopup="dialog" aria-expanded={expanded} title="Open vehicle records"
    onClick={event => { event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); onOpenRecords(vehicle, event.currentTarget); }}>
    <FileText size={15} aria-hidden="true"/>Records{chevron ? <ChevronRight size={14} aria-hidden="true"/> : null}
  </button>;
}

interface VehicleRowProps {
  vehicle: InventoryVehicle;
  selected: boolean;
  priority: boolean;
  recordsExpanded: boolean;
  onOpenRecords: OpenRecords;
  handlers: RowActionHandlers;
  /** The viewer's working store, for owner-aware overdue-move coloring. */
  viewerStore?: string | null;
}

function InventorySourceBand({ vehicle, onSelectVehicle }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
}) {
  const resources = vehicleOverviewResources(vehicle);
  const equipment = resources.find(resource => ['window-sticker', 'vauto'].includes(resource.id));
  const history = resources.find(resource => resource.id === 'autocheck');
  const oasis = resources.find(resource => resource.id === 'oasis');
  const source = (resource: typeof equipment, label: string, missing: string) => <section className="inventory-source-band__source vehicle-resources vehicle-resources--scan" aria-label={`${label} source evidence for ${vehicleDisplayName(vehicle)}`} onClick={stopRowSelection}>
    {resource ? <VehicleResourceScan resource={resource} vehicle={vehicle} explicitDestination onOpenSection={target => onSelectVehicle(vehicle, target)}/> : <div className="inventory-source-band__missing"><strong>{label}</strong><p>{missing}</p></div>}
  </section>;
  return <div className="inventory-source-band" aria-label={`Source evidence for ${vehicleDisplayName(vehicle)}`}>
    {source(equipment, 'Factory equipment', 'Equipment not captured')}
    {source(history, 'History', 'History not captured')}
    {source(oasis, 'OASIS', /^(ford|lincoln)$/i.test(vehicle.make?.trim() ?? '') ? 'OASIS not captured' : 'OASIS covers Ford and Lincoln only')}
  </div>;
}

const DeskRow = memo(function DeskRow({ vehicle, selected, priority, recordsExpanded, onOpenRecords, handlers, viewerStore }: VehicleRowProps) {
  return <tbody className={`inv-desk-vehicle-rows${selected ? " is-selected" : ""}`} data-inventory-vehicle-rows={vehicle.id}>
    <tr className={`inv-desk-row${selected ? " is-selected" : ""}`} data-stock-number={vehicle.stockNumber} data-inventory-vehicle-trigger={vehicle.id}
      data-hold-state={vehicle.dealerMail.hasActiveHold === true ? "held" : vehicle.dealerMail.hasActiveHold === false ? "clear" : "unknown"}
      data-has-movement={vehicleMovementStatus(vehicle) ? "true" : "false"} onClick={() => handlers.onSelectVehicle(vehicle)}>
      <td className="inv-desk-td inv-desk-td--vehicle" data-column="vehicle"><DeskVehicleCell vehicle={vehicle} onSelectVehicle={handlers.onSelectVehicle} priority={priority}/></td>
      <td className="inv-desk-td" data-column="status"><DeskStatusCell vehicle={vehicle} onSelectVehicle={handlers.onSelectVehicle} onOpenSourceRecord={handlers.onOpenSourceRecord} viewerStore={viewerStore}/></td>
    </tr>
    <tr className="inv-desk-evidence"><td colSpan={2}><InventorySourceBand vehicle={vehicle} onSelectVehicle={handlers.onSelectVehicle}/></td></tr>
    <tr className="inv-desk-footer"><td colSpan={2}><DeskRowActions vehicle={vehicle} variant="desktop" {...handlers} recordsAction={<RecordsLauncher vehicle={vehicle} expanded={recordsExpanded} onOpenRecords={onOpenRecords} className="inv-desk-action inv-desk-action--records inventory-records-launch" chevron={false} />} /></td></tr>
  </tbody>;
});

function useRecordsPanel(vehicles: InventoryVehicle[]) {
  const [expandedVehicleId, setExpandedVehicleId] = useState<string | null>(null);
  const recordsTriggerRef = useRef<HTMLElement | null>(null);
  const recordsVehicle = vehicles.find(vehicle => vehicle.id === expandedVehicleId);
  const openRecords = useCallback<OpenRecords>((vehicle, trigger) => {
    recordsTriggerRef.current = trigger;
    setExpandedVehicleId(vehicle.id);
  }, []);
  const panel = recordsVehicle ? <InventoryRecordsPanel vehicle={recordsVehicle} vehicles={vehicles} onVehicleChange={setExpandedVehicleId} onClose={() => setExpandedVehicleId(null)} onOpenWorkspace={vehicle => {
    setExpandedVehicleId(null);
    window.requestAnimationFrame(() => {
      const launcher = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-row-action="records"]')).find(button => button.dataset.inventoryVehicleTrigger === vehicle.id && button.getClientRects().length > 0);
      launcher?.focus({preventScroll:true});
      openWorkspaceRef.current?.(vehicle, "data");
    });
  }} returnFocusRef={recordsTriggerRef}/> : null;
  const openWorkspaceRef = useRef<InventoryTableProps["onSelectVehicle"] | null>(null);
  return { expandedVehicleId, openRecords, panel, openWorkspaceRef };
}

export function InventoryTable({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  canRequestVehicle,
  moveActionFor,
  onRequestVehicle,
  onMoveVehicle,
  onTrackMovement,
  onOpenListing,
  onOpenSourceRecord,
  viewerStore,
}: InventoryTableProps) {
  const handlers = useStableRowHandlers({ onSelectVehicle, canRequestVehicle, moveActionFor, onRequestVehicle, onMoveVehicle, onTrackMovement, onOpenListing, onOpenSourceRecord });
  const records = useRecordsPanel(vehicles);
  records.openWorkspaceRef.current = onSelectVehicle;
  return (
    <section
      className="inventory-grid-shell--desk if-srp-grid"
      aria-label="Inventory data grid"
    >
      <div
        className="if-srp-table-wrap"
        role="region"
        aria-label="Inventory results table"
        tabIndex={0}
      >
        <table className="inv-desk-table">
          <caption className="inventory-sr-only">
            Compare vehicle configuration, price, mileage and age, hold and location status, and equipment.
            Each row has stock and VIN copy controls and an actions group.
          </caption>
          <colgroup><col /><col className="inv-desk-operations-column" /></colgroup>
          <thead className="inventory-sr-only"><tr><th scope="col">Vehicle</th><th scope="col">Operations</th></tr></thead>
          {vehicles.map((vehicle, index) => (
            <DeskRow
              key={vehicle.id}
              vehicle={vehicle}
              selected={vehicle.id === selectedVehicleId}
              priority={index < 4}
              recordsExpanded={records.expandedVehicleId === vehicle.id}
              onOpenRecords={records.openRecords}
              handlers={handlers}
              viewerStore={viewerStore}
            />
          ))}
        </table>
      </div>
      {records.panel}
    </section>
  );
}

const MobileRow = memo(function MobileRow({ vehicle, selected, priority, recordsExpanded, onOpenRecords, handlers, viewerStore }: VehicleRowProps) {
  const { onSelectVehicle, onOpenSourceRecord } = handlers;
  const name = vehicleDisplayName(vehicle);
  const recentChange = primaryVehicleChangeSignal(vehicle.changeSummary);
  const movementStatus = vehicleMovementStatus(vehicle, viewerStore);
  const holdStatus = vehicleOperationalStatus(vehicle);
  const currentLocation = resolveCurrentLocation(vehicle);
  const powertrain = [
    vehicle.engine,
    vehicle.drivetrain,
  ].filter(Boolean).join(" · ") || "Specifications in details";
  const transmissionAndFuel = [vehicle.transmission, vehicle.fuelType].filter(Boolean).join(" · ");
  const fuelEconomy = capturedFuelEconomy(vehicle);
  const compactFuelEconomy = fuelEconomy
    ?.replace(/^(\d+) city \/ (\d+) hwy MPG$/, "$1/$2 MPG")
    .replace(/^(\d+) (city|hwy) MPG$/, "$1 $2 MPG");
  const factoryPrice = factoryPricing(vehicle);
  const mobileOriginalMsrp = factoryPrice.original.value === null ? null : {
    label: factoryPriceLabel(factoryPrice.original.source),
    value: formatFactoryPrice(factoryPrice.original.value, factoryPrice.original.currency),
  };
  const operationalUpdate = movementStatus?.label || (recentChange?.kind !== "other" ? recentChange?.shortLabel : null);
  const manualActive = vehicle.manualHold?.state === 'active' || vehicle.manualHold?.state === 'requested';
  const holdToolsAvailable = !manualActive && vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const hasDocumentEvidence = Object.values(mobileDocumentAvailability(vehicle)).some(Boolean);
  // The holder is already role-redacted by vehicleOperationalStatus.
  // Keep that useful context on the compact SRP instead of making staff
  // open the vehicle just to see who owns the current hold.
  const compactHoldLabel = holdStatus.label;
  const manualExpected = manualActive ? compactInventoryDate(vehicle.manualHold?.expectedDeliveryDate) : null;
  const importedStatus = importedHoldOperationalStatus(vehicle);
  const importedDetail = manualActive ? importedHoldDetail(vehicle) : null;
  const loaner = dealerMailLoanerSummary(vehicle);
  return (
    <article
      className={`if-srp-mobile-row if-srp-mobile-row--scan${selected ? " is-selected" : ""}`}
      data-has-document-evidence={hasDocumentEvidence ? "true" : "false"}
      data-hold-state={vehicle.dealerMail.dataState !== "current" ? "unknown" : vehicle.dealerMail.hasActiveHold === true ? "held" : vehicle.dealerMail.hasActiveHold === false ? "clear" : "unknown"}
    >
      <button
        type="button"
        className="inventory-mobile-row__open"
        data-inventory-vehicle-trigger={vehicle.id}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onSelectVehicle(vehicle);
        }}
        aria-label={vehicleAccessibleSummary(vehicle, viewerStore)}
      >
        <span className="inventory-mobile-row__thumbnail"><span className="inventory-vehicle-visual"><VehiclePhoto vehicle={vehicle} priority={priority} /><PhotoCount vehicle={vehicle} /></span></span>
        <span className="inventory-mobile-row__main">
          <span className="inventory-mobile-row__title">
            <strong>{name}</strong><ChevronRight size={16} aria-hidden="true" />
          </span>
          <span className="inventory-mobile-row__valuation">
            <b>{formatMoney(vehicle.price)}</b>
            <span aria-label={`Mileage: ${formatMileage(vehicle.mileage)}`}>{formatMileage(vehicle.mileage)}</span>{vehicle.daysListed != null ? <span aria-label={`Age: ${vehicle.daysListed} days listed`}>{vehicle.daysListed} days</span> : null}
          </span>
          <small className="inventory-mobile-row__specification" title="Engine / drive"><span>Engine</span>{powertrain}</small>
          <span className="inventory-mobile-row__certification"><CertifiedBadge certified={vehicle.certified} homeStore={vehicle.location.homeStore.name}/></span>
        </span>
        <span className="inventory-mobile-row__equipment"><small>Equipment</small><DeskEquipmentCell vehicle={vehicle} onSelectVehicle={onSelectVehicle} limit={1} previewOnly /></span>
      </button>
      {mobileOriginalMsrp ? <dl className="inventory-mobile-row__factory-pricing" aria-label="Captured factory pricing">
        {mobileOriginalMsrp ? <div><dt>{mobileOriginalMsrp.label}</dt><dd>{mobileOriginalMsrp.value}</dd></div> : null}
      </dl> : null}
      <div className="inventory-mobile-row__copy-facts" role="group" aria-label={`Copy identifiers for ${name}`}>
        <dl className="inv-desk-vehicle__facts">
          <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stockNumber}>{vehicle.stockNumber}</CopyableValue></dd></div>
          <div><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin}>{vehicle.vin}</CopyableValue></dd></div>
        </dl>
      </div>
      <VehicleRegistrationFacts vehicle={vehicle} />
      <div className="inventory-mobile-row__signals" aria-label="Operational vehicle signals" data-has-decision={Boolean(vehicle.appDisposition?.code || vehicle.inventoryDecision?.comparison === "conflict")}>
        <div className="inventory-mobile-service"><ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} detailed compact /></div>
          <button
            type="button"
            className={`inventory-mobile-hold inventory-mobile-hold--${holdStatus.tone}`}
            title={[currentLocation.detail, holdStatus.label, holdStatus.detail, holdToolsAvailable ? "DealerMail hold actions are available in vehicle details." : null].filter(Boolean).join(" · ")}
            data-row-action={holdToolsAvailable ? "dealermail" : "hold-details"}
            data-inventory-vehicle-trigger={vehicle.id}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              if (holdToolsAvailable) {
                onOpenSourceRecord?.(vehicle, "dealermail");
                return;
              }
              onSelectVehicle(vehicle, "hold");
            }}
            aria-label={holdToolsAvailable
              ? `Open DealerMail hold tools for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}`
              : `Open hold details for ${name}`}
          >
            <strong>{currentLocation.label}</strong><span aria-hidden="true" className="inventory-mobile-hold__separator">·</span>
            <span>{compactHoldLabel}</span>
            {manualExpected ? <small>Expected {manualExpected}</small> : null}
          </button>
          {manualActive ? <dl className="inventory-mobile-imported-hold" aria-label="Reported hold evidence"><div><dt>{vehicle.operationalEvidence ? "Reports" : "DealerMail"}</dt><dd>
            <span>{vehicle.operationalEvidence ? importedHoldSummary(vehicle) : importedStatus.label}</span>{importedDetail ? <small>{importedDetail}</small> : null}
          </dd></div></dl> : null}
          {loaner ? <dl className="inventory-mobile-imported-hold" aria-label="DealerMail loaner and service evidence"><div><dt>Loaner/service</dt><dd><span>{loaner.label}</span><small>{loaner.detail}</small></dd></div></dl> : null}
          {vehicle.appDisposition?.code || vehicle.inventoryDecision?.comparison === 'conflict' ? <button type="button"
            className="inventory-mobile-decision" data-inventory-vehicle-trigger={vehicle.id} aria-label={`Review inventory decision for ${name}`}
            onClick={event => { event.currentTarget.focus({ preventScroll: true }); onSelectVehicle(vehicle, 'hold'); }}>
            <span><small>Disposition</small><strong>{vehicle.appDisposition?.code ? `${DISPOSITION_LABELS[vehicle.appDisposition.code]}${vehicle.inventoryDecision?.comparison === 'conflict' ? ' · Records disagree' : ''}` : vehicle.inventoryDecision?.comparison === 'conflict' ? 'Records disagree' : vehicle.inventoryDecision?.label}</strong></span>
          </button> : null}
          {vehicle.managerDisposition ? (
            <span className="inventory-mobile-manager-disposition" data-state={vehicle.managerDisposition.dataState}>
              <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden="true" />
              <span><strong>{vehicle.managerDisposition.soldLabel}</strong><small>{vehicle.managerDisposition.deliveryLabel}</small></span>
            </span>
          ) : null}
          {operationalUpdate ? <p
            className={`inventory-mobile-location inventory-mobile-update${movementStatus ? " inventory-mobile-update--movement" : ""}${movementStatus?.tone === "warning" ? " inventory-mobile-update--warning" : ""}`}
            title={[currentLocation.detail, movementStatus?.detail || vehicle.changeSummary].filter(Boolean).join(" · ")}
          >
            <Truck size={14} strokeWidth={1.9} aria-hidden="true" />
            <span>{humanizeStatusLabel(operationalUpdate)}</span>
          </p> : null}
      </div>
      <DeskRowActions vehicle={vehicle} variant="mobile" {...handlers} recordsAction={<RecordsLauncher vehicle={vehicle} expanded={recordsExpanded} onOpenRecords={onOpenRecords} className="inv-desk-action inv-desk-action--records inventory-records-launch" chevron />} />
      <VehicleResourceCards vehicle={vehicle} variant="signals" />
      <div className="inventory-mobile-row__supporting">
      <dl className="inventory-mobile-row__captured-facts" aria-label="Captured vehicle specifications">
        {transmissionAndFuel || compactFuelEconomy ? <div data-fact="transmission">
          {transmissionAndFuel ? <>
            <dt>{vehicle.transmission ? "Transmission" : "Fuel"}</dt>
            <dd title={transmissionAndFuel}>{transmissionAndFuel.replace(/(\d+)-Speed Automatic/gi, "$1-speed").replace(/\bGasoline\b/gi, "Gas")}</dd>
          </> : null}
          {compactFuelEconomy ? <>
            <dt className={transmissionAndFuel ? "inventory-sr-only" : undefined}>Fuel economy</dt>
            <dd className="inventory-mobile-row__economy" title={fuelEconomy ?? undefined}>{compactFuelEconomy}</dd>
          </> : null}
        </div> : null}
        {vehicle.exteriorColor || vehicle.interiorColor ? <div data-fact="colors">
          {vehicle.exteriorColor ? <><dt>Exterior</dt><dd aria-label={`Exterior ${vehicle.exteriorColor}`}>{vehicle.exteriorColor}</dd></> : null}
          {vehicle.interiorColor ? <><dt>Interior</dt><dd aria-label={`Interior ${vehicle.interiorColor}`}>{vehicle.interiorColor}</dd></> : null}
        </div> : null}
      </dl>
      </div>
      <InventorySourceBand vehicle={vehicle} onSelectVehicle={onSelectVehicle}/>
    </article>
  );
});

export function InventoryMobileList({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onOpenSourceRecord,
  canRequestVehicle,
  moveActionFor,
  onRequestVehicle,
  onMoveVehicle,
  onTrackMovement,
  onOpenListing,
  viewerStore,
}: Pick<InventoryTableProps, "vehicles" | "selectedVehicleId" | "onSelectVehicle" | "onOpenSourceRecord" | "canRequestVehicle" | "moveActionFor" | "onRequestVehicle" | "onMoveVehicle" | "onTrackMovement" | "onOpenListing" | "viewerStore">) {
  const handlers = useStableRowHandlers({ onSelectVehicle, canRequestVehicle, moveActionFor, onRequestVehicle, onMoveVehicle, onTrackMovement, onOpenListing, onOpenSourceRecord });
  const records = useRecordsPanel(vehicles);
  records.openWorkspaceRef.current = onSelectVehicle;
  return (
    <div className="if-srp-mobile-list" aria-label="Inventory results">
      {vehicles.map((vehicle, index) => (
        <MobileRow
          key={vehicle.id}
          vehicle={vehicle}
          selected={vehicle.id === selectedVehicleId}
          priority={index < 2}
          recordsExpanded={records.expandedVehicleId === vehicle.id}
          onOpenRecords={records.openRecords}
          handlers={handlers}
          viewerStore={viewerStore}
        />
      ))}
      {records.panel}
    </div>
  );
}


export function inventorySortSummary(sorts: InventoryTableProps["sorts"]): string {
  return sorts
    .map((sort, index) => `${index + 1}. ${SORT_LABELS[sort.key]} ${sort.direction === "asc" ? "ascending" : "descending"}`)
    .join(", ");
}
