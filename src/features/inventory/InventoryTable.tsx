import { equipmentFinderItems } from "./vehicle-equipment";
import { CertifiedBadge } from "../../components/CertifiedBadge";
import { WorkspaceLink } from "../../components/WorkspaceLink";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CarFront,
  ChevronRight,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  ExternalLink,
  FileText,
  ListFilter,
  Truck,
  UserRound,
} from "lucide-react";
import { CopyableValue } from "../../components/CopyableValue";
import { ServiceStatusLink } from "./ServiceStatusLink";
import { InventoryRecordsPanel } from "./InventoryRecordsPanel";
import { VehicleResourceCards } from "./VehicleResourceCards";
import { oasisActionLabel, vehicleResourceCatalog } from "./vehicle-resource-catalog";
import {
  formatMileage,
  formatMoney,
  formatDate,
  resolveCurrentLocation,
  SORT_LABELS,
  updateMultiSort,
  vehicleDisplayName,
} from "./inventory-utils";
import { primaryVehicleChangeSignal } from "./change-utils";
import {
  availableWindowStickerUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from "./vehicle-document-utils";
import { compactEquipmentScanLabel, publishedEquipment, standoutEquipment } from "./vehicle-feature-utils";
import { useInventoryDisclosure } from "./useInventoryDisclosure";
import { sourceDistanceText } from "../../lib/source-distance";
import { vehiclePhotoDisplaySources } from "../../lib/vehicle-photos";
import type {
  InventorySortKey,
  InventoryTableProps,
  InventoryVehicle,
} from "./types";
import "./InventoryTable.desk.css";
import "./InventoryMobile.scan.css";

interface SortOption {
  label: string;
  sortKey: InventorySortKey;
}

const VEHICLE_SORT_OPTIONS = [
  { label: "Vehicle", sortKey: "vehicle" },
  { label: "Make / model", sortKey: "makeModel" },
  { label: "Year", sortKey: "year" },
  { label: "Trim / series", sortKey: "trim" },
  { label: "Body style", sortKey: "bodyStyle" },
  { label: "Exterior color", sortKey: "exteriorColor" },
  { label: "Engine", sortKey: "engine" },
  { label: "Transmission", sortKey: "transmission" },
  { label: "Fuel type", sortKey: "fuelType" },
] satisfies SortOption[];

const STOCK_SORT_OPTIONS = [
  { label: "Stock", sortKey: "stock" },
  { label: "VIN", sortKey: "vin" },
] satisfies SortOption[];

const PRICE_SORT_OPTIONS = [
  { label: "Price", sortKey: "price" },
  { label: "MSRP", sortKey: "msrp" },
] satisfies SortOption[];

const MILEAGE_SORT_OPTIONS = [
  { label: "Mileage", sortKey: "mileage" },
] satisfies SortOption[];

const AGE_SORT_OPTIONS = [
  { label: "Days", sortKey: "daysListed" },
  { label: "Inventory date", sortKey: "inventoryDate" },
] satisfies SortOption[];

const EQUIPMENT_SORT_OPTIONS = [
  { label: "Certified", sortKey: "certified" },
] satisfies SortOption[];

const EVIDENCE_SORT_OPTIONS = [
  { label: "Photos", sortKey: "photoCount" },
  { label: "AutoCheck score", sortKey: "autoCheckScore" },
  { label: "Vehicle documents", sortKey: "documentAvailability" },
  { label: "Website", sortKey: "websiteStatus" },
  { label: "Source update", sortKey: "recentActivity" },
] satisfies SortOption[];

const STATUS_SORT_OPTIONS = [
  { label: "Hold", sortKey: "holdStatus" },
  { label: "Hold salesperson", sortKey: "salesperson" },
] satisfies SortOption[];

const LOCATION_SORT_OPTIONS = [
  { label: "Current", sortKey: "currentLocation" },
  { label: "Home store", sortKey: "homeStore" },
  { label: "Movement", sortKey: "movementStatus" },
] satisfies SortOption[];

const CHANGE_SORT_OPTIONS = [
  { label: "Last movement", sortKey: "lastMovement" },
] satisfies SortOption[];

interface SortControlProps extends SortOption {
  /** Short visual group label. The exact field label remains in the accessible name. */
  displayLabel?: string;
  sorts: InventoryTableProps["sorts"];
  onSortChange: InventoryTableProps["onSortChange"];
}

function SortControl({ label, displayLabel, sortKey, sorts, onSortChange }: SortControlProps) {
  const index = sorts.findIndex((sort) => sort.key === sortKey);
  const activeSort = index >= 0 ? sorts[index] : undefined;
  const directionLabel = activeSort?.direction === "asc" ? "ascending" : "descending";
  const nextDirectionLabel = activeSort?.direction === "asc" ? "descending" : "ascending";

  return (
    <button
      type="button"
      className={`inventory-sort-header${activeSort ? " is-active" : ""}`}
      data-sort-key={sortKey}
      data-sort-direction={activeSort?.direction ?? "none"}
      aria-pressed={Boolean(activeSort)}
      aria-label={
        activeSort
          ? `${label}, ${directionLabel}${index === 0 ? ", primary sort" : `, sort priority ${index + 1}`}. Activate to sort ${nextDirectionLabel}. Hold Shift to keep other sorts.`
          : `Sort by ${label} ascending. Hold Shift to add it to the current sorts.`
      }
      onClick={(event) => onSortChange(updateMultiSort(sorts, sortKey, event.shiftKey))}
      title={
        activeSort
          ? `${label}: ${directionLabel}. Select for ${nextDirectionLabel}; hold Shift to keep other sorts.`
          : `Sort by ${label}. Hold Shift to add another sort.`
      }
    >
      <span>{displayLabel ?? label}</span>
      {activeSort ? (
        <span className="inventory-sort-header__state" aria-hidden="true">
          {activeSort.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          <small className="inventory-sort-header__direction">
            {activeSort.direction === "asc" ? "Asc" : "Desc"}
          </small>
          {sorts.length > 1 ? (
            <small className="inventory-sort-header__priority">#{index + 1}</small>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

type DeskColumn = "vehicle" | "price" | "configuration" | "location" | "status" | "actions";

interface SortHeaderProps {
  label: string;
  /** Compact visible heading; the full label remains available to assistive technology. */
  displayLabel?: string;
  column: Exclude<DeskColumn, "actions">;
  numeric?: boolean;
  options: SortOption[];
  sorts: InventoryTableProps["sorts"];
  onSortChange: InventoryTableProps["onSortChange"];
}

function SortHeader({ label, displayLabel, column, numeric = false, options, sorts, onSortChange }: SortHeaderProps) {
  const disclosure = useInventoryDisclosure(`inventory-${column}-sort-options`);
  const primarySort = sorts[0];
  // The visible column never changes its click target when another field is sorted.
  const displayedOption = options[0];
  const overflowOptions = options.filter((option) => option.sortKey !== displayedOption.sortKey);
  const primaryOption = options.find((option) => option.sortKey === primarySort?.key);
  const ariaSort = primaryOption
    ? primarySort.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      scope="col"
      className={`inv-desk-th inv-desk-th--${column}${numeric ? " inv-desk-th--num" : ""}`}
      aria-label={label}
      aria-sort={ariaSort}
      aria-description={primaryOption ? `Sorted by ${primaryOption.label}, ${ariaSort}` : undefined}
      data-sort-group={column}
      data-column={column}
    >
      <span className="inventory-sort-header-group__controls">
        <SortControl
          {...displayedOption}
          displayLabel={displayLabel ?? label}
          sorts={sorts}
          onSortChange={onSortChange}
        />
        {overflowOptions.length ? (
          <div
            ref={disclosure.containerRef}
            className="inventory-sort-header-group__more"
            data-open={disclosure.open ? "true" : "false"}
          >
            <button
              ref={disclosure.triggerRef}
              type="button"
              className="inventory-sort-header-group__more-trigger"
              aria-label={`More ${label} sort options`}
              aria-expanded={disclosure.open}
              aria-controls={disclosure.panelId}
              title={`More ${label.toLocaleLowerCase()} sort options`}
              onClick={() => disclosure.setOpen((open) => !open)}
            >
              <ListFilter size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <span
              id={disclosure.panelId}
              className="inventory-sort-header-group__menu"
              role="group"
              aria-label={`${label} sort options`}
              hidden={!disclosure.open}
            >
              {overflowOptions.map((option) => (
                <SortControl
                  key={option.sortKey}
                  {...option}
                  sorts={sorts}
                  onSortChange={(nextSorts) => {
                    disclosure.close(true);
                    onSortChange(nextSorts);
                  }}
                />
              ))}
            </span>
          </div>
        ) : null}
      </span>
    </th>
  );
}

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
  if (vehicle.dealerMail.dataState !== "current") {
    const evidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
    const previousPrimary = evidence?.find((record) => record.position === "primary") ?? evidence?.[0];
    const previousOwner = previousPrimary?.salesperson?.trim();
    return {
      label: "Hold status unverified",
      detail: vehicle.dealerMail.hasActiveHold === true
        ? `Previous hold${previousOwner ? ` · ${previousOwner}` : ""} retained; confirm current status with the store`
        : "Latest hold data unavailable; confirm current status with the store",
      tone: "unknown",
      icon: CircleHelp,
    };
  }

  if (vehicle.dealerMail.loaner?.active) {
    const serviceDate = vehicle.dealerMail.loaner.serviceDate?.trim();
    const loanerLabel = vehicle.dealerMail.loaner.program
      ? `Loaner ${vehicle.dealerMail.loaner.program}`
      : vehicle.dealerMail.loaner.label || "Loaner";
    return {
      label: serviceDate ? `${loanerLabel} · ${serviceDate}` : loanerLabel,
      detail: vehicle.dealerMail.loaner.rawAlert || "Current loaner/service status from DealerMail alert",
      tone: "move",
      icon: CircleHelp,
    };
  }

  if (vehicle.dealerMail.hasActiveHold === true) {
    const visibleEvidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
    const primary = visibleEvidence?.find((record) => record.position === "primary") ?? visibleEvidence?.[0];
    const backupCount = Math.max(0, (vehicle.dealerMail.activeRecordCount ?? 1) - 1);
    const owner = primary?.salesperson?.trim();
    return {
      label: owner ? `Held by ${owner}` : backupCount ? `Held · ${backupCount} backup${backupCount === 1 ? "" : "s"}` : "Held",
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

export function vehicleMovementStatus(vehicle: InventoryVehicle): OperationalStatus | null {
  const movement = vehicle.movement;
  if (!movement || !(movement.state || movement.requestStatus || movement.requestId)) return null;
  return {
    label: movement.overdue ? "Move needs attention" : movement.state || movement.requestStatus || "Being moved",
    detail: movement.nextAction || movement.lastEventLabel || "Movement in progress",
    tone: movement.overdue ? "warning" : "move",
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
  const title = vehicle.vehicleName?.trim() || name;
  const signal = primaryVehicleChangeSignal(vehicle.changeSummary);
  const change = signal && signal.kind !== "other" ? signal : null;
  return (
    <div className="inv-desk-vehicle">
      <span className="inv-desk-vehicle__photo">
        <VehiclePhoto vehicle={vehicle} className="inv-desk-vehicle__img" priority={priority} />
        <PhotoCount vehicle={vehicle} />
      </span>
      <div className="inv-desk-vehicle__body">
        <span className="inv-desk-vehicle__title"><strong title={name}>{title}</strong></span>
        <div className="inv-desk-vehicle__links"><CertifiedBadge certified={vehicle.certified} homeStore={vehicle.location.homeStore.name} /></div>
        {change ? <button type="button" className={`inv-desk-change inv-desk-change--${change.kind}`} data-row-action="history" data-inventory-vehicle-trigger={vehicle.id}
          aria-label={`View change history for ${name}: ${change.shortLabel}`} title={vehicle.changeSummary || change.label}
          onClick={(event) => { stopRowSelection(event); event.currentTarget.focus({ preventScroll: true }); onSelectVehicle(vehicle, "timeline"); }}>
          {change.shortLabel}
        </button> : null}
      </div>
      <dl className="inv-desk-vehicle__facts">
        <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stockNumber} className="inv-desk-copy" /></dd></div>
        <div><dt>Mileage</dt><dd>{typeof vehicle.mileage === "number" && Number.isFinite(vehicle.mileage)
          ? <CopyableValue compact label="mileage" text={String(vehicle.mileage)} className="inv-desk-copy">{formatMileage(vehicle.mileage)}</CopyableValue>
          : formatMileage(vehicle.mileage)}</dd></div>
        <div className="inv-desk-vehicle__vin"><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin} className="inv-desk-copy" /></dd></div>
      </dl>
    </div>
  );
}

function openRecallCount(vehicle: InventoryVehicle): number {
  return vehicle.fordOasis?.openFieldServiceActions.length ?? 0;
}

function openRecallSummary(vehicle: InventoryVehicle): string | null {
  const count = openRecallCount(vehicle);
  return count ? oasisActionLabel(vehicle.fordOasis) : null;
}

/** Ford OASIS open field service actions. Reference evidence only; never an availability signal. */
function RecallChip({ vehicle, onSelectVehicle }: { vehicle: InventoryVehicle; onSelectVehicle: InventoryTableProps["onSelectVehicle"] }) {
  const count = openRecallCount(vehicle);
  if (!count) return null;
  const actions = vehicle.fordOasis?.openFieldServiceActions ?? [];
  return (
    <button type="button"
      className="inventory-recall-chip"
      data-row-action="recalls"
      data-inventory-vehicle-trigger={vehicle.id}
      data-open-recall-count={count}
      aria-label={`${openRecallSummary(vehicle)} for ${vehicleDisplayName(vehicle)}; open vehicle records`}
      title={sourceDistanceText(actions.map((action) => [action.code, action.description].filter(Boolean).join(" — ")).join("; "))}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onSelectVehicle(vehicle, "data");
      }}
    >
      <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
      <strong>Captured actions: {count}</strong>
    </button>
  );
}

function DeskPriceCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const hasPrice = typeof vehicle.price === "number" && Number.isFinite(vehicle.price);
  const hasMsrp = typeof vehicle.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0;
  const under = hasPrice && hasMsrp && vehicle.msrp! > vehicle.price! ? vehicle.msrp! - vehicle.price! : null;
  const inventoryDate = compactInventoryDate(vehicle.inventoryDate);
  return <div className={`inv-desk-price${hasPrice ? "" : " is-unavailable"}`}>
    <strong>{formatMoney(vehicle.price)}</strong>
    <span title={inventoryDate ? `Inventory date ${inventoryDate}` : undefined}>{vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : "Age unavailable"}</span>
    {hasMsrp ? <small title={under ? `${formatMoney(under)} under MSRP` : undefined}>MSRP {formatMoney(vehicle.msrp)}</small> : null}
  </div>;
}

function DeskLocationCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const current = resolveCurrentLocation(vehicle);
  const movement = vehicleMovementStatus(vehicle);
  return <div className="inv-desk-location" title={current.detail}>
    <strong>{current.label}</strong>
    {movement ? <span className={movement.tone === "warning" ? "is-warning" : undefined} title={movement.detail}>{humanizeStatusLabel(movement.label)}</span> : null}
    {current.store?.id !== vehicle.location.homeStore.id ? <small>Home: {vehicle.location.homeStore.name}</small> : null}
    {vehicle.location.conflict ? <small className="is-warning">Confirm location</small> : null}
  </div>;
}

function DeskStatusCell({ vehicle, onSelectVehicle, onOpenSourceRecord }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
  onOpenSourceRecord?: InventoryTableProps["onOpenSourceRecord"];
}) {
  const name = vehicleDisplayName(vehicle);
  const holdStatus = vehicleOperationalStatus(vehicle);
  const canOpenDealerMail = vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const visibleEvidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
  const primaryEvidence = visibleEvidence?.find((record) => record.position === "primary") ?? visibleEvidence?.[0];
  const backupCount = Math.max(0, (vehicle.dealerMail.activeRecordCount ?? 0) - 1);
  const holdDetail = vehicle.dealerMail.dataState === "current" && vehicle.dealerMail.hasActiveHold === true
    ? [primaryEvidence?.expectedDeliveryDate ? `Expected ${compactInventoryDate(primaryEvidence.expectedDeliveryDate) ?? primaryEvidence.expectedDeliveryDate}` : null,
      backupCount ? `${backupCount} backup${backupCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || holdStatus.detail
    : null;
  return <div className="inv-desk-status">
    <DeskLocationCell vehicle={vehicle} />
    <button type="button" className={`inv-desk-hold inv-desk-hold--${holdStatus.tone}`} data-inventory-vehicle-trigger={vehicle.id}
      aria-label={canOpenDealerMail ? `Review DealerMail handoff for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}` : `Open hold details for ${name}`}
      title={holdStatus.detail} onClick={event => { stopRowSelection(event); event.currentTarget.focus({ preventScroll: true }); if (canOpenDealerMail) onOpenSourceRecord?.(vehicle, "dealermail"); else onSelectVehicle(vehicle, "hold"); }}>
      <span className="inv-desk-hold__dot" aria-hidden="true" /><span>{holdStatus.label}</span>
    </button>
    <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} detailed />
    {holdDetail ? <small className="inv-desk-status__detail">{holdDetail}</small> : null}
    {vehicle.managerDisposition ? <small className="inv-desk-disposition" data-state={vehicle.managerDisposition.dataState}>{vehicle.managerDisposition.soldLabel} · {vehicle.managerDisposition.deliveryLabel}</small> : null}
    <RecallChip vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
  </div>;
}

function DeskEquipmentCell({ vehicle, onSelectVehicle }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
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
    }).slice(0, 3);
  const equipmentCount = equipmentFinderItems(vehicle).length;
  const remaining = Math.max(0, equipmentCount - chips.length);
  const preview = published.slice(0, 6).map((item) => item.label).join(" · ");
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
      {chips.map((item) => (
        <span className="inv-desk-equipment__item" key={`${item.source}:${item.label}`}>{compactEquipmentScanLabel(item.label)}</span>
      ))}
      {remaining > 0 ? <span className="inv-desk-equipment__more">+{remaining} more</span> : null}
    </button>
  );
}

function DeskConfigurationCell({ vehicle, onSelectVehicle }: { vehicle: InventoryVehicle; onSelectVehicle: InventoryTableProps["onSelectVehicle"] }) {
  const configuration = [vehicle.bodyType || vehicle.bodyStyle, vehicle.drivetrain].filter(Boolean).join(" · ");
  const powertrain = [vehicle.engine, vehicle.drivetrain].filter(Boolean).join(" · ");
  const colors = [vehicle.exteriorColor, vehicle.interiorColor ? `${vehicle.interiorColor} interior` : null].filter(Boolean).join(" / ");
  return <div className="inv-desk-configuration">
    <span title={[vehicle.bodyType || vehicle.bodyStyle, vehicle.transmission, vehicle.fuelType].filter(Boolean).join(" · ")}>{powertrain || configuration || "Specifications not published"}</span>
    {colors ? <span>{colors}</span> : null}
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
  hideRecords?: boolean;
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
  vehicle, canRequestVehicle, moveActionFor, onRequestVehicle, onMoveVehicle, onTrackMovement, onOpenListing, onSelectVehicle, variant = "desktop", recordsAction, recordsDisclosure, hideRecords = false, includeServiceLink = false,
}: DeskRowActionsProps) {
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const requestAllowed = canRequestVehicle?.(vehicle) === true;
  const canTrack = Boolean(onTrackMovement && vehicle.movement?.requestId && vehicleMovementStatus(vehicle));
  const explicitMoveAction = moveActionFor?.(vehicle) ?? null;
  const moveAction = explicitMoveAction ?? (requestAllowed ? { intent: "request" as const, label: "Request vehicle", shortLabel: "Request" } : null);
  const canCreateMove = Boolean(moveAction && (onMoveVehicle || onRequestVehicle) && (!canTrack || explicitMoveAction));
  return (
    <div className="inv-desk-actions" role="group" aria-label={`Actions for ${name}`} onClick={stopRowSelection}>
      {variant === "desktop" ? <button type="button" className="inv-desk-action inv-desk-action--primary"
        data-row-action="open-details" data-inventory-vehicle-trigger={vehicle.id}
        onClick={() => onSelectVehicle(vehicle)} aria-label={`Open vehicle details for ${name}`} title="Open vehicle">
        Details
      </button> : null}
      {recordsAction}
      {!hideRecords && !recordsAction ? <button type="button" className={`inv-desk-action${recordsDisclosure ? " inv-desk-action--records" : ""}`} data-row-action="records"
        aria-expanded={recordsDisclosure?.expanded} aria-controls={recordsDisclosure?.controls}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (recordsDisclosure) recordsDisclosure.onToggle();
          else onSelectVehicle(vehicle, "data");
        }} aria-label={`Open vehicle records for ${name}`} title="Open vehicle records">
        Records{recordsDisclosure ? <ChevronDown size={14} aria-hidden="true" className={recordsDisclosure.expanded ? "is-expanded" : undefined}/> : null}
      </button> : null}
      {includeServiceLink ? <WorkspaceLink className="inv-desk-action" data-row-action="service" preserveOrigin to={`/service?vin=${encodeURIComponent(vehicle.vin)}`}
        aria-label={`Open service status for ${name}`} title="Open service status">
        Service
      </WorkspaceLink> : null}
      {canTrack ? <button type="button" className="inv-desk-action" data-row-action="track-movement"
        onClick={() => onTrackMovement?.(vehicle)} aria-label={`Track movement for ${name}`} title="Track movement">Track</button> : null}
      {canCreateMove ? <button type="button" className="inv-desk-action"
        data-row-action={moveAction?.intent === "direct" ? "move-vehicle" : "request-vehicle"}
        onClick={() => {
          if (moveAction && onMoveVehicle) onMoveVehicle(vehicle, moveAction.intent);
          else onRequestVehicle?.(vehicle);
        }}
        aria-label={`${moveAction?.label} ${name}`}
        title={moveAction?.label}>{moveAction?.shortLabel}</button> : null}
      {listingUrl ? onOpenListing ? (
        <button type="button" className="inv-desk-action inv-desk-action--quiet" data-row-action="listing"
          title="Open listing" aria-label={`Open listing for ${name}`} onClick={() => onOpenListing(vehicle)}>
          Listing <ExternalLink size={13} aria-hidden="true" />
        </button>
      ) : <a className="inv-desk-action inv-desk-action--quiet" data-row-action="listing" href={listingUrl}
        target="_blank" rel="noopener noreferrer" title="Open listing" aria-label={`Open listing for ${name} in a new tab`}>
        Listing <ExternalLink size={13} aria-hidden="true" />
      </a> : null}
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

export function vehicleAccessibleSummary(vehicle: InventoryVehicle): string {
  const name = vehicleDisplayName(vehicle);
  const hold = vehicleOperationalStatus(vehicle);
  const movement = vehicleMovementStatus(vehicle);
  const location = resolveCurrentLocation(vehicle);
  const change = primaryVehicleChangeSignal(vehicle.changeSummary);
  return [
    `Open details for ${name}`,
    `stock ${vehicle.stockNumber}`,
    `VIN ${vehicle.vin}`,
    formatMoney(vehicle.price),
    formatMileage(vehicle.mileage),
    `Hold: ${hold.label}`,
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
}

const DeskRow = memo(function DeskRow({ vehicle, selected, priority, recordsExpanded, onOpenRecords, handlers }: VehicleRowProps) {
  const hasResources = vehicleResourceCatalog(vehicle).some((resource) => resource.href || resource.hasCapturedData);
  // One tbody per vehicle keeps its main row and source-signal row together, so
  // striping, hover and selection are one rule and a filtered list never
  // re-renders untouched rows just to flip their stripe.
  return (
    <tbody className={`inv-desk-vehicle-rows${selected ? " is-selected" : ""}`} data-inventory-vehicle-rows={vehicle.id}>
      <tr
        className={`inv-desk-row${selected ? " is-selected" : ""}`}
        data-has-resources={hasResources ? "true" : "false"}
        data-stock-number={vehicle.stockNumber}
        data-inventory-vehicle-trigger={vehicle.id}
        data-hold-state={vehicle.dealerMail.hasActiveHold === true ? "held" : vehicle.dealerMail.hasActiveHold === false ? "clear" : "unknown"}
        data-has-movement={vehicleMovementStatus(vehicle) ? "true" : "false"}
        onClick={() => handlers.onSelectVehicle(vehicle)}
      >
        <td className="inv-desk-td inv-desk-td--vehicle" data-column="vehicle">
          <DeskVehicleCell vehicle={vehicle} onSelectVehicle={handlers.onSelectVehicle} priority={priority} />
        </td>
        <td className="inv-desk-td inv-desk-td--num" data-column="price">
          <DeskPriceCell vehicle={vehicle} />
        </td>
        <td className="inv-desk-td" data-column="configuration">
          <DeskConfigurationCell vehicle={vehicle} onSelectVehicle={handlers.onSelectVehicle} />
        </td>
        <td className="inv-desk-td" data-column="status">
          <DeskStatusCell vehicle={vehicle} onSelectVehicle={handlers.onSelectVehicle} onOpenSourceRecord={handlers.onOpenSourceRecord} />
        </td>
        <td className="inv-desk-td inv-desk-td--actions" data-column="actions">
          <DeskRowActions
            vehicle={vehicle}
            {...handlers}
            recordsAction={<RecordsLauncher vehicle={vehicle} expanded={recordsExpanded} onOpenRecords={onOpenRecords} className="inv-desk-action inv-desk-action--records inventory-records-launch" chevron={false} />}
          />
        </td>
      </tr>
      {hasResources ? <tr className={`inv-desk-scan-row${selected ? " is-selected" : ""}`}>
        <td colSpan={5}>
          <VehicleResourceCards vehicle={vehicle} variant="scan" />
        </td>
      </tr> : null}
    </tbody>
  );
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
  sorts,
  onSortChange,
  onSelectVehicle,
  canRequestVehicle,
  moveActionFor,
  onRequestVehicle,
  onMoveVehicle,
  onTrackMovement,
  onOpenListing,
  onOpenSourceRecord,
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
          <thead>
            <tr>
              <SortHeader label="Vehicle" column="vehicle"
                options={[...VEHICLE_SORT_OPTIONS, ...STOCK_SORT_OPTIONS, ...MILEAGE_SORT_OPTIONS, ...EVIDENCE_SORT_OPTIONS]}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Price & age" column="price"
                options={[...PRICE_SORT_OPTIONS, ...AGE_SORT_OPTIONS]}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Configuration" column="configuration"
                options={EQUIPMENT_SORT_OPTIONS}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Operations" column="status"
                options={[...LOCATION_SORT_OPTIONS, ...STATUS_SORT_OPTIONS, ...CHANGE_SORT_OPTIONS]}
                sorts={sorts} onSortChange={onSortChange} />
              <th scope="col" className="inv-desk-th inv-desk-th--actions" data-column="actions">
                <span className="inv-desk-th__label">Actions</span>
              </th>
            </tr>
          </thead>
          {vehicles.map((vehicle, index) => (
            <DeskRow
              key={vehicle.id}
              vehicle={vehicle}
              selected={vehicle.id === selectedVehicleId}
              priority={index < 4}
              recordsExpanded={records.expandedVehicleId === vehicle.id}
              onOpenRecords={records.openRecords}
              handlers={handlers}
            />
          ))}
        </table>
      </div>
      {records.panel}
    </section>
  );
}

const MobileRow = memo(function MobileRow({ vehicle, selected, priority, recordsExpanded, onOpenRecords, handlers }: VehicleRowProps) {
  const { onSelectVehicle, onOpenSourceRecord } = handlers;
  const name = vehicleDisplayName(vehicle);
  const recentChange = primaryVehicleChangeSignal(vehicle.changeSummary);
  const movementStatus = vehicleMovementStatus(vehicle);
  const holdStatus = vehicleOperationalStatus(vehicle);
  const currentLocation = resolveCurrentLocation(vehicle);
  const specification = [
    vehicle.engine,
    vehicle.drivetrain,
  ].filter(Boolean).join(" · ") || "Specifications in details";
  const operationalUpdate = movementStatus?.label || (recentChange?.kind !== "other" ? recentChange?.shortLabel : null);
  const holdToolsAvailable = vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const hasDocumentEvidence = Object.values(mobileDocumentAvailability(vehicle)).some(Boolean);
  // The holder is already role-redacted by vehicleOperationalStatus.
  // Keep that useful context on the compact SRP instead of making staff
  // open the vehicle just to see who owns the current hold.
  const compactHoldLabel = holdStatus.label;
  const equipmentCues = [...new Set(standoutEquipment(vehicle, 6).filter(item => item.source !== "factory-equipment-group").map(item => compactEquipmentScanLabel(item.label)))].slice(0, 3);
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
        aria-label={vehicleAccessibleSummary(vehicle)}
      >
        <span className="inventory-vehicle-visual"><VehiclePhoto vehicle={vehicle} priority={priority} /><PhotoCount vehicle={vehicle} /></span>
        <span className="inventory-mobile-row__main">
          <span className="inventory-mobile-row__title">
            <strong>{name}</strong>
            <ChevronRight className="inventory-mobile-open-indicator" size={16} aria-hidden="true" />
          </span>
          <span className="inventory-mobile-row__valuation">
            <b>{formatMoney(vehicle.price)}</b>
            <span>{formatMileage(vehicle.mileage)}</span>
          </span>
          <small className="inventory-mobile-row__specification" title={specification}>{specification}</small>
        </span>
      </button>
      <div className="inventory-mobile-row__identity">
        <span title={`Stock ${vehicle.stockNumber}`}>{vehicle.stockNumber}</span>
        <CertifiedBadge certified={vehicle.certified} homeStore={vehicle.location.homeStore.name}/>
        <RecordsLauncher vehicle={vehicle} expanded={recordsExpanded} onOpenRecords={onOpenRecords} className="inventory-records-launch" chevron />
      </div>
      <div className="inventory-mobile-row__signals" aria-label="Operational vehicle signals">
        <div className="inventory-mobile-service"><span aria-hidden="true">Service</span><ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} detailed /></div>
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
          </button>
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
      {equipmentCues.length ? <div className="inventory-mobile-row__equipment"><span>Equipment</span><p>{equipmentCues.join(" · ")}</p></div> : null}
      <div className="inventory-mobile-row__footer">
      <div className="inventory-mobile-row__actions">
      <DeskRowActions vehicle={vehicle} variant="mobile" {...handlers} hideRecords />
      </div>
      <div className="inventory-mobile-row__resources">
        <VehicleResourceCards vehicle={vehicle} variant="scan" />
      </div>

      </div>
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
}: Pick<InventoryTableProps, "vehicles" | "selectedVehicleId" | "onSelectVehicle" | "onOpenSourceRecord" | "canRequestVehicle" | "moveActionFor" | "onRequestVehicle" | "onMoveVehicle" | "onTrackMovement" | "onOpenListing">) {
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
