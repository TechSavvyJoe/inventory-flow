import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CarFront,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Ellipsis,
  ExternalLink,
  FileText,
  Globe2,
  ListFilter,
  MapPin,
  Navigation,
  PanelRightOpen,
  ShieldCheck,
  Truck,
  UserRound,
} from "lucide-react";
import { CopyableValue } from "../../components/CopyableValue";
import {
  formatMileage,
  formatMoney,
  formatStickerMoney,
  resolveCurrentLocation,
  SORT_LABELS,
  updateMultiSort,
  vehicleDisplayName,
} from "./inventory-utils";
import { primaryVehicleChangeSignal } from "./change-utils";
import {
  fordInvoiceUrl,
  fordOasisUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from "./vehicle-document-utils";
import { publishedEquipment, standoutEquipment } from "./vehicle-feature-utils";
import { useInventoryDisclosure } from "./useInventoryDisclosure";
import type {
  InventorySortKey,
  InventoryTableProps,
  InventoryVehicle,
} from "./types";
import "./InventoryTable.compact-v3.css";
import "./InventoryTable.production-v4.css";
import "./InventoryTable.operational-v9.css";
import "./InventoryTable.production-v10.css";
import "./InventoryTable.flow.css";
import "./InventoryMobile.flow.css";
import "./InventoryTable.desk.css";

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

type DeskColumn = "vehicle" | "price" | "mileage" | "days" | "status" | "equipment" | "actions";

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

export function VehiclePhoto({ vehicle, className = "" }: { vehicle: InventoryVehicle; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = vehicle.imageUrl || vehicle.imageUrls?.[0];
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
        className={`${className}${loaded ? " is-loaded" : " is-loading"}`.trim()}
        src={src}
        alt={`${vehicleDisplayName(vehicle)} exterior`}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
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

  if (vehicle.dealerMail.hasActiveHold === true) {
    const visibleEvidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
    const primary = visibleEvidence?.find((record) => record.position === "primary") ?? visibleEvidence?.[0];
    const backupCount = Math.max(0, (vehicle.dealerMail.activeRecordCount ?? 1) - 1);
    const owner = primary?.salesperson?.trim();
    return {
      label: owner ? `Held · ${owner}` : backupCount ? `Held · ${backupCount} backup${backupCount === 1 ? "" : "s"}` : "Held",
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
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      new Date(Number(year), Number(month) - 1, Number(day)),
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}

function vehiclePhotoCount(vehicle: InventoryVehicle): number {
  return vehicle.photoCount ?? vehicle.imageUrls?.length ?? (vehicle.imageUrl ? 1 : 0);
}

function autoCheckResourceDetail(vehicle: InventoryVehicle): string {
  const facts = [
    vehicle.autoCheckReport?.score != null ? `Score ${vehicle.autoCheckReport.score}` : null,
    vehicle.autoCheckReport?.ownerCount != null
      ? `${vehicle.autoCheckReport.ownerCount} ${vehicle.autoCheckReport.ownerCount === 1 ? "owner" : "owners"}`
      : null,
  ].filter(Boolean);
  return facts.join(" · ") || "Vehicle history report";
}

function windowStickerResourceDetail(vehicle: InventoryVehicle): string {
  const optionCount = vehicle.windowSticker?.options?.length ?? 0;
  const buildFacts = [
    vehicle.windowSticker?.equipmentGroup?.trim() || null,
    optionCount ? `${optionCount} ${optionCount === 1 ? "option" : "options"}` : null,
  ].filter(Boolean);
  if (buildFacts.length) return buildFacts.join(" · ");
  return vehicle.windowSticker?.totalMsrp != null && vehicle.windowSticker.totalMsrp > 0
    ? `Sticker MSRP ${formatStickerMoney(vehicle.windowSticker.totalMsrp, vehicle.windowSticker)}`
    : "Original build label";
}

function factoryEquipmentResourceDetail(vehicle: InventoryVehicle): string {
  const packageCount = vehicle.factoryEquipment?.packages?.length ?? 0;
  const sectionCount = vehicle.factoryEquipment?.sections?.length ?? 0;
  const coverage = [
    packageCount ? `${packageCount} ${packageCount === 1 ? "package" : "packages"}` : null,
    sectionCount ? `${sectionCount} ${sectionCount === 1 ? "section" : "sections"}` : null,
  ].filter(Boolean);
  return coverage.join(" · ") || "Informational equipment profile";
}

export function AutoCheckCompactWordmark() {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <span
      className="inventory-document-wordmark inventory-document-wordmark--autocheck inventory-document-wordmark--table"
      data-brand-asset={logoFailed ? "text-fallback" : "official-image"}
      aria-hidden="true"
    >
      {logoFailed ? (
        <span className="inventory-document-wordmark__fallback">
          <strong>AutoCheck</strong>
          <small>Experian</small>
        </span>
      ) : (
        <img
          src="https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg"
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
        />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop comparison row (one compact <tr> per vehicle)               */
/* ------------------------------------------------------------------ */

function stopRowSelection(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

/** Ledger states can arrive as snake_case tokens; a pill reads them as words. */
function humanizeStatusLabel(label: string): string {
  if (!/_/.test(label)) return label;
  const words = label.replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function DeskVehicleCell({ vehicle, onSelectVehicle }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
}) {
  const name = vehicleDisplayName(vehicle);
  const suppliedName = vehicle.vehicleName?.trim();
  // Year / make / model stays on one line; trim leads the specification line.
  const title = suppliedName || [vehicle.year, vehicle.make, vehicle.model]
    .filter((part) => part !== null && part !== undefined && `${part}`.trim())
    .join(" ");
  const specification = [
    suppliedName ? null : vehicle.trim,
    vehicle.bodyType || vehicle.bodyStyle,
    vehicle.drivetrain,
    vehicle.exteriorColor,
    vehicle.engine,
  ].filter(Boolean).join(" · ");
  // A generic "updated" note is not a decision signal; only a specific change
  // (price, arrival, mileage, status, stock, store) earns a marker in the row.
  const signal = primaryVehicleChangeSignal(vehicle.changeSummary);
  const change = signal && signal.kind !== "other" ? signal : null;
  const vinTail = vehicle.vin.slice(-4);

  return (
    <div className="inv-desk-vehicle">
      <span className="inv-desk-vehicle__photo">
        <VehiclePhoto vehicle={vehicle} className="inv-desk-vehicle__img" />
      </span>
      <span className="inv-desk-vehicle__body">
        <span className="inv-desk-vehicle__title">
          <strong title={name}>{title}</strong>
          {change ? (
            <button
              type="button"
              className={`inv-desk-change inv-desk-change--${change.kind}`}
              data-row-action="history"
              data-inventory-vehicle-trigger={vehicle.id}
              aria-label={`View change history for ${name}: ${change.shortLabel}`}
              title={vehicle.changeSummary || change.label}
              onClick={(event) => {
                stopRowSelection(event);
                event.currentTarget.focus({ preventScroll: true });
                onSelectVehicle(vehicle, "timeline");
              }}
            >
              <span className="inv-desk-change__dot" aria-hidden="true" />
              <span>{change.shortLabel}</span>
            </button>
          ) : null}
        </span>
        <small className="inv-desk-vehicle__spec" title={specification}>
          {vehicle.certified ? (
            <span className="inv-desk-certified" title="Certified pre-owned">
              <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
              Certified
            </span>
          ) : null}
          <span>{specification || "Specifications in details"}</span>
        </small>
        <span className="inv-desk-vehicle__ids">
          <span className="inv-desk-id">
            <span className="inv-desk-id__label">Stock</span>
            <CopyableValue compact label="stock number" text={vehicle.stockNumber} className="inv-desk-copy" />
          </span>
          <span className="inv-desk-id">
            <span className="inv-desk-id__label">VIN</span>
            <CopyableValue compact label="VIN" text={vehicle.vin} className="inv-desk-copy">
              <span className="inventory-sr-only">{vehicle.vin}</span>
              <span aria-hidden="true" title={vehicle.vin}>…{vinTail}</span>
            </CopyableValue>
          </span>
        </span>
      </span>
    </div>
  );
}

function openRecallCount(vehicle: InventoryVehicle): number {
  return vehicle.fordOasis?.openFieldServiceActions.length ?? 0;
}

function openRecallSummary(vehicle: InventoryVehicle): string | null {
  const count = openRecallCount(vehicle);
  return count ? `${count} open Ford recall${count === 1 ? "" : "s"} or field service action${count === 1 ? "" : "s"}` : null;
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
      title={actions.map((action) => [action.code, action.description].filter(Boolean).join(" — ")).join("; ")}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onSelectVehicle(vehicle, "data");
      }}
    >
      <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
      <strong>Recalls: {count}</strong>
    </button>
  );
}

function DeskPriceCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const hasPrice = typeof vehicle.price === "number" && Number.isFinite(vehicle.price);
  const hasMsrp = typeof vehicle.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0;
  const under = hasPrice && hasMsrp && vehicle.msrp! > vehicle.price! ? vehicle.msrp! - vehicle.price! : null;
  return (
    <div className={`inv-desk-price${hasPrice ? "" : " is-unavailable"}`}>
      <strong>{formatMoney(vehicle.price)}</strong>
      <small>{hasMsrp ? `MSRP ${formatMoney(vehicle.msrp)}` : "MSRP not published"}</small>
      {under ? <small className="inv-desk-price__under">{formatMoney(under)} under</small> : null}
    </div>
  );
}

function DeskMileageCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const hasMileage = typeof vehicle.mileage === "number" && Number.isFinite(vehicle.mileage);
  return (
    <div className={`inv-desk-metric${hasMileage ? "" : " is-unavailable"}`}>
      <strong>{formatMileage(vehicle.mileage)}</strong>
    </div>
  );
}

function DeskDaysCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const inventoryDate = compactInventoryDate(vehicle.inventoryDate);
  const hasDays = vehicle.daysListed != null;
  const daysLabel = hasDays ? `${vehicle.daysListed} ${vehicle.daysListed === 1 ? "day" : "days"} listed` : "Age unavailable";
  return (
    <div
      className={`inv-desk-metric${hasDays ? "" : " is-unavailable"}`}
      title={inventoryDate ? `${daysLabel} · inventory date ${inventoryDate}` : daysLabel}
    >
      <strong>
        {hasDays ? vehicle.daysListed : "—"}
        <span className="inventory-sr-only"> {hasDays ? "days listed" : "days listed unavailable"}</span>
      </strong>
      <small>{inventoryDate ? `Since ${inventoryDate}` : "Date not published"}</small>
    </div>
  );
}

function DeskStatusCell({ vehicle, onSelectVehicle, onOpenSourceRecord }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
  onOpenSourceRecord?: InventoryTableProps["onOpenSourceRecord"];
}) {
  const name = vehicleDisplayName(vehicle);
  const holdStatus = vehicleOperationalStatus(vehicle);
  const HoldIcon = holdStatus.icon;
  const canOpenDealerMail = vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const visibleEvidence = vehicle.dealerMail.canViewEvidence === true ? vehicle.holdEvidence : undefined;
  const primaryEvidence = visibleEvidence?.find((record) => record.position === "primary") ?? visibleEvidence?.[0];
  const backupCount = Math.max(0, (vehicle.dealerMail.activeRecordCount ?? 0) - 1);
  const holdDetail = vehicle.dealerMail.hasActiveHold === true
    ? [
        primaryEvidence?.expectedDeliveryDate
          ? `Expected ${compactInventoryDate(primaryEvidence.expectedDeliveryDate) ?? primaryEvidence.expectedDeliveryDate}`
          : null,
        backupCount ? `${backupCount} backup${backupCount === 1 ? "" : "s"}` : null,
      ].filter(Boolean).join(" · ") || holdStatus.detail
    : holdStatus.detail;

  const movementStatus = vehicleMovementStatus(vehicle);
  const current = resolveCurrentLocation(vehicle);
  const atHome = current.store
    ? current.store.id === vehicle.location.homeStore.id
    : current.label.toLowerCase() === vehicle.location.homeStore.name.toLowerCase();
  const LocationIcon = current.provenance === "app-confirmed" ? Navigation : MapPin;
  const locationTone = vehicle.location.conflict ? "conflict" : atHome ? "home" : "away";
  const locationTitle = [
    current.detail,
    vehicle.location.conflict
      ? "Location conflict — review needed"
      : atHome
        ? "At its home store"
        : `Home store ${vehicle.location.homeStore.name}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="inv-desk-status">
      <span className="inv-desk-status__row">
        <button
          type="button"
          className={`inv-desk-pill inv-desk-pill--${holdStatus.tone} inv-desk-pill--action`}
          data-inventory-vehicle-trigger={vehicle.id}
          data-row-action={canOpenDealerMail ? "dealermail" : "hold-details"}
          onClick={(event) => {
            stopRowSelection(event);
            event.currentTarget.focus({ preventScroll: true });
            if (canOpenDealerMail) {
              onOpenSourceRecord?.(vehicle, "dealermail");
              return;
            }
            onSelectVehicle(vehicle, "hold");
          }}
          aria-label={
            canOpenDealerMail
              ? `Review DealerMail handoff for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}`
              : `Open hold details for ${name}`
          }
          title={canOpenDealerMail
            ? `${holdStatus.label}. ${holdDetail}. Review hold information and DealerMail instructions for stock ${vehicle.stockNumber}.`
            : `${holdStatus.label}. ${holdDetail}`}
        >
          <HoldIcon size={13} strokeWidth={2} aria-hidden="true" />
          <span className="inv-desk-pill__label">{holdStatus.label}</span>
        </button>
        {vehicle.managerDisposition ? (
          <span
            className="inv-desk-pill inv-desk-pill--sold"
            data-state={vehicle.managerDisposition.dataState}
            title={`${vehicle.managerDisposition.soldLabel} · ${vehicle.managerDisposition.deliveryLabel}`}
          >
            <ClipboardCheck size={13} strokeWidth={2} aria-hidden="true" />
            <span className="inv-desk-pill__label">{vehicle.managerDisposition.soldLabel}</span>
          </span>
        ) : null}
      </span>
      <span className="inv-desk-status__row">
        <span className={`inv-desk-pill inv-desk-pill--${locationTone}`} title={locationTitle}>
          <LocationIcon size={13} strokeWidth={2} aria-hidden="true" />
          <span className="inv-desk-pill__label">{current.label}</span>
        </span>
        {movementStatus ? (
          <span className={`inv-desk-pill inv-desk-pill--${movementStatus.tone}`} title={movementStatus.detail}>
            <Truck size={13} strokeWidth={2} aria-hidden="true" />
            <span className="inv-desk-pill__label">{humanizeStatusLabel(movementStatus.label)}</span>
          </span>
        ) : null}
        <RecallChip vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
      </span>
    </div>
  );
}

function DeskEquipmentCell({ vehicle, onSelectVehicle }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
}) {
  const published = publishedEquipment(vehicle);
  if (!published.length) return <span className="inv-desk-quiet">No published highlights</span>;
  const standoutKeys = new Set(standoutEquipment(vehicle, 2).map((item) => `${item.source}:${item.label}`));
  const chips = [
    ...published.filter((item) => standoutKeys.has(`${item.source}:${item.label}`)),
    ...published.filter((item) => !standoutKeys.has(`${item.source}:${item.label}`)),
  ].slice(0, 2);
  const remaining = published.length - chips.length;
  const preview = published.slice(0, 6).map((item) => item.label).join(" · ");
  return (
    <button
      type="button"
      className="inv-desk-equipment"
      data-row-action="equipment"
      data-inventory-vehicle-trigger={vehicle.id}
      aria-label={`View all ${published.length} equipment items for ${vehicleDisplayName(vehicle)}`}
      title={published.length > 6 ? `${preview} · +${published.length - 6} more` : preview}
      onClick={(event) => {
        stopRowSelection(event);
        event.currentTarget.focus({ preventScroll: true });
        onSelectVehicle(vehicle, "equipment");
      }}
    >
      {chips.map((item) => (
        <span className="inv-desk-chip" key={`${item.source}:${item.label}`}>{item.label}</span>
      ))}
      {remaining > 0 ? <span className="inv-desk-chip inv-desk-chip--more">+{remaining}</span> : null}
    </button>
  );
}

interface DeskRowActionsProps extends Pick<
  InventoryTableProps,
  | "canRequestVehicle"
  | "onRequestVehicle"
  | "onTrackMovement"
  | "onOpenListing"
  | "onSelectVehicle"
  | "onOpenSourceRecord"
> {
  vehicle: InventoryVehicle;
}

function DeskRowActions({
  vehicle,
  canRequestVehicle,
  onRequestVehicle,
  onTrackMovement,
  onOpenListing,
  onSelectVehicle,
  onOpenSourceRecord,
}: DeskRowActionsProps) {
  const disclosure = useInventoryDisclosure("inventory-row-more-actions");
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const [floatingMenuPosition, setFloatingMenuPosition] = useState<{
    left: number;
    placement: "above" | "below";
    top: number;
  } | null>(null);
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const isFordFamily = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const invoiceUrl = isFordFamily ? fordInvoiceUrl(vehicle.vin) : null;
  const oasisUrl = isFordFamily ? fordOasisUrl(vehicle.vin) : null;
  const autoCheckUrl = officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", listingUrl);
  const windowStickerUrl = officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", listingUrl);
  const equipmentUrl = vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url);
  const photoCount = vehiclePhotoCount(vehicle);
  const requestAllowed =
    typeof canRequestVehicle === "function"
      ? canRequestVehicle(vehicle)
      : canRequestVehicle === true;
  const canRequest = requestAllowed && Boolean(onRequestVehicle);
  // A withheld move has custody facts but no transfer this caller may open;
  // the row still shows the move pill, it just offers nothing to track.
  const canTrackMovement = Boolean(onTrackMovement && vehicle.movement?.requestId && vehicleMovementStatus(vehicle));
  const canOpenDealerMail = vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const hasOverflowActions = Boolean(
    canOpenDealerMail || listingUrl || autoCheckUrl || windowStickerUrl || equipmentUrl ||
      invoiceUrl || oasisUrl || canRequest || canTrackMovement,
  );

  useLayoutEffect(() => {
    if (!disclosure.open) return;

    let animationFrame = 0;
    const positionMenu = () => {
      const trigger = disclosure.triggerRef.current;
      const menu = floatingMenuRef.current;
      if (!trigger || !menu) return;

      const viewportInset = 8;
      const triggerGap = 6;
      const triggerBounds = trigger.getBoundingClientRect();
      const menuWidth = menu.offsetWidth || 232;
      const menuHeight = Math.min(
        menu.scrollHeight || menu.offsetHeight,
        window.innerHeight - viewportInset * 2,
      );
      const availableBelow = window.innerHeight - triggerBounds.bottom - triggerGap - viewportInset;
      const availableAbove = triggerBounds.top - triggerGap - viewportInset;
      const placement = availableBelow >= Math.min(menuHeight, 240) || availableBelow >= availableAbove
        ? "below"
        : "above";
      const idealTop = placement === "below"
        ? triggerBounds.bottom + triggerGap
        : triggerBounds.top - triggerGap - menuHeight;
      const top = Math.max(
        viewportInset,
        Math.min(idealTop, window.innerHeight - menuHeight - viewportInset),
      );
      const left = Math.max(
        viewportInset,
        Math.min(triggerBounds.right - menuWidth, window.innerWidth - menuWidth - viewportInset),
      );

      setFloatingMenuPosition((current) => (
        current?.left === left && current.top === top && current.placement === placement
          ? current
          : { left, placement, top }
      ));
    };
    const schedulePosition = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(positionMenu);
    };

    positionMenu();
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
    };
  }, [disclosure.open, disclosure.triggerRef]);

  const moveAction = canTrackMovement
    ? {
        key: "track-movement",
        icon: Truck,
        title: "Track movement",
        ariaLabel: `Track movement for ${name}`,
        run: () => onTrackMovement?.(vehicle),
      }
    : canRequest
      ? {
          key: "request-vehicle",
          icon: ArrowRightLeft,
          title: "Request vehicle",
          ariaLabel: `Request vehicle ${name}`,
          run: () => onRequestVehicle?.(vehicle),
        }
      : null;

  return (
    <div
      className="inv-desk-actions"
      data-has-dealermail={canOpenDealerMail ? "true" : "false"}
      data-has-overflow={hasOverflowActions ? "true" : "false"}
      role="group"
      aria-label={`Actions for ${name}`}
      onClick={stopRowSelection}
    >
      <button
        type="button"
        className="inv-btn inv-btn--icon"
        data-row-action="open-details"
        data-inventory-vehicle-trigger={vehicle.id}
        onClick={() => onSelectVehicle(vehicle)}
        aria-label={`Open vehicle details for ${name}`}
        title="Open vehicle"
      >
        <PanelRightOpen size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {moveAction ? (
        <button
          type="button"
          className="inv-btn inv-btn--icon"
          data-row-action={moveAction.key}
          onClick={moveAction.run}
          aria-label={moveAction.ariaLabel}
          title={moveAction.title}
        >
          <moveAction.icon size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
      {listingUrl ? (
        onOpenListing ? (
          <button
            type="button"
            className="inv-btn inv-btn--icon"
            data-row-action="listing"
            data-slot="listing"
            onClick={() => onOpenListing(vehicle)}
            aria-label={`Open listing for ${name}`}
            title="Open listing"
          >
            <Globe2 size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : (
          <a
            className="inv-btn inv-btn--icon"
            data-row-action="listing"
            data-slot="listing"
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open listing for ${name} in a new tab`}
            title="Open listing"
          >
            <Globe2 size={16} strokeWidth={1.8} aria-hidden="true" />
          </a>
        )
      ) : null}
      {hasOverflowActions ? (
        <div
          ref={disclosure.containerRef}
          className="inv-desk-more"
          data-row-action="more"
          data-open={disclosure.open ? "true" : "false"}
        >
          <button
            ref={disclosure.triggerRef}
            type="button"
            className="inv-btn inv-btn--icon"
            aria-label={`More actions for ${name}`}
            aria-expanded={disclosure.open}
            aria-controls={disclosure.panelId}
            title="More actions"
            onClick={() => {
              if (!disclosure.open) setFloatingMenuPosition(null);
              disclosure.setOpen((open) => !open);
            }}
          >
            <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          {disclosure.open && typeof document !== "undefined" ? createPortal((
            <div
              ref={floatingMenuRef}
              id={disclosure.panelId}
              className="inventory-row-more__menu inventory-row-more__menu--floating-v10 inv-desk-menu"
              role="group"
              aria-label={`More actions for ${name}`}
              data-placement={floatingMenuPosition?.placement ?? "pending"}
              data-positioned={floatingMenuPosition ? "true" : "false"}
              style={floatingMenuPosition ? {
                left: floatingMenuPosition.left,
                top: floatingMenuPosition.top,
              } as CSSProperties : undefined}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {canOpenDealerMail ? (
                <button
                  type="button"
                  className="inventory-row-more__item"
                  data-row-action="dealermail"
                  onClick={() => {
                    disclosure.close();
                    onOpenSourceRecord?.(vehicle, "dealermail");
                  }}
                  aria-label={`Open DealerMail for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}`}
                >
                  <UserRound size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>DealerMail tools</span>
                </button>
              ) : null}
              {canTrackMovement ? (
                <button
                  type="button"
                  className="inventory-row-more__item"
                  data-row-action="track-movement"
                  onClick={() => {
                    disclosure.close();
                    onTrackMovement?.(vehicle);
                  }}
                >
                  <Truck size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Track movement</span>
                </button>
              ) : null}
              {canRequest ? (
                <button
                  type="button"
                  className="inventory-row-more__item"
                  data-row-action="request-vehicle"
                  onClick={() => {
                    disclosure.close();
                    onRequestVehicle?.(vehicle);
                  }}
                >
                  <ArrowRightLeft size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Request vehicle</span>
                </button>
              ) : null}
              {listingUrl ? (
                onOpenListing ? (
                  <button
                    type="button"
                    className="inventory-row-more__item"
                    data-row-action="listing"
                    onClick={() => {
                      disclosure.close();
                      onOpenListing(vehicle);
                    }}
                  >
                    <Globe2 size={16} strokeWidth={1.85} aria-hidden="true" />
                    <span>Open listing</span>
                  </button>
                ) : (
                  <a
                    className="inventory-row-more__item"
                    data-row-action="listing"
                    href={listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open listing for ${name} in a new tab`}
                    onClick={() => disclosure.close()}
                  >
                    <Globe2 size={16} strokeWidth={1.85} aria-hidden="true" />
                    <span>Open listing</span>
                    <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                  </a>
                )
              ) : null}
              {(autoCheckUrl || windowStickerUrl || equipmentUrl || invoiceUrl || oasisUrl) ? (
                <span className="inv-desk-menu__label" aria-hidden="true">
                  Records{photoCount ? ` · ${photoCount} photos` : ""}
                </span>
              ) : null}
              {autoCheckUrl ? (
                <a
                  className="inventory-row-more__item"
                  data-row-action="autocheck"
                  data-source-state={vehicle.autoCheckReport?.dataState ?? "unavailable"}
                  href={autoCheckUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open AutoCheck report for ${name} in a new tab`}
                  title={autoCheckResourceDetail(vehicle)}
                  onClick={() => disclosure.close()}
                >
                  <ShieldCheck size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>AutoCheck report</span>
                  <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                </a>
              ) : null}
              {windowStickerUrl ? (
                <a
                  className="inventory-row-more__item"
                  data-row-action="window-sticker"
                  data-source-state={vehicle.windowSticker?.dataState ?? "unavailable"}
                  href={windowStickerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open window sticker for ${name} in a new tab`}
                  title={windowStickerResourceDetail(vehicle)}
                  onClick={() => disclosure.close()}
                >
                  <FileText size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Window sticker</span>
                  <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                </a>
              ) : null}
              {equipmentUrl ? (
                <a
                  className="inventory-row-more__item"
                  data-row-action="factory-equipment"
                  data-source-state={vehicle.factoryEquipment?.dataState ?? "unavailable"}
                  href={equipmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open factory equipment profile for ${name} in a new tab`}
                  title={factoryEquipmentResourceDetail(vehicle)}
                  onClick={() => disclosure.close()}
                >
                  <ClipboardCheck size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Factory equipment</span>
                  <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                </a>
              ) : null}
              {invoiceUrl ? (
                <a
                  className="inventory-row-more__item"
                  data-row-action="ford-invoice"
                  href={invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open Ford invoice lookup for ${name} in a new tab; authorized Ford sign-in may be required`}
                  onClick={() => disclosure.close()}
                >
                  <FileText size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Ford invoice</span>
                  <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                </a>
              ) : null}
              {oasisUrl ? (
                <a
                  className="inventory-row-more__item"
                  data-row-action="ford-oasis"
                  href={oasisUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open Ford OASIS for ${name} in a new tab; authorized Ford sign-in may be required`}
                  onClick={() => disclosure.close()}
                >
                  <ClipboardCheck size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Ford OASIS</span>
                  <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ), document.body) : null}
        </div>
      ) : null}
    </div>
  );
}

function MobileDocumentAvailability({ vehicle, onSelectVehicle }: {
  vehicle: InventoryVehicle;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
}) {
  const autoCheck = Boolean(officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", vehicle.publicListing.listingUrl));
  const sticker = Boolean(officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", vehicle.publicListing.listingUrl));
  const factoryEquipment = Boolean(vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url));
  const recalls = openRecallCount(vehicle);
  const documents = [autoCheck && "AutoCheck", sticker && "Sticker", factoryEquipment && "Factory equipment", recalls ? `Recalls: ${recalls}` : null].filter(Boolean);
  const evidence = [
    recalls ? { label: "Recalls", detail: `${recalls} open` } : null,
    autoCheck ? {
      label: vehicle.autoCheckReport?.dataState === "current" ? "AutoCheck" : "Earlier AutoCheck",
      detail: autoCheckResourceDetail(vehicle),
    } : null,
    sticker ? {
      label: vehicle.windowSticker?.dataState === "current" ? "Sticker" : "Earlier sticker",
      detail: windowStickerResourceDetail(vehicle),
    } : factoryEquipment ? {
      label: vehicle.factoryEquipment?.dataState === "current" ? "Equipment profile" : "Earlier equipment profile",
      detail: factoryEquipmentResourceDetail(vehicle),
    } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <button
      type="button"
      className="inventory-mobile-records"
      data-inventory-vehicle-trigger={vehicle.id}
      aria-label={`Open vehicle records for ${vehicleDisplayName(vehicle)}${documents.length ? `: ${documents.join(", ")}` : ""}`}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        onSelectVehicle(vehicle, "data");
      }}
    >
      <span className="inventory-mobile-records__facts">
        {evidence.length ? evidence.map((item) => (
          <span key={item.label}><strong>{item.label}</strong><span> · {item.detail}</span></span>
        )) : <strong>Records</strong>}
      </span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  );
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
    formatMoney(vehicle.price),
    formatMileage(vehicle.mileage),
    `Hold: ${hold.label}`,
    `Current location: ${location.label}`,
    movement ? `Movement: ${movement.label}` : null,
    change ? `Recent change: ${change.shortLabel}` : null,
    officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", vehicle.publicListing.listingUrl) ? "AutoCheck report available" : null,
    officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", vehicle.publicListing.listingUrl) ? "Window sticker available" : null,
    vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url) ? "vAuto informational equipment profile available" : null,
    openRecallSummary(vehicle),
  ].filter(Boolean).join(", ");
}

export function InventoryTable({
  vehicles,
  selectedVehicleId,
  sorts,
  onSortChange,
  onSelectVehicle,
  canRequestVehicle,
  onRequestVehicle,
  onTrackMovement,
  onOpenListing,
  onOpenSourceRecord,
}: InventoryTableProps) {
  return (
    <section
      className="inventory-grid-shell inventory-grid-shell--production-v10 inventory-grid-shell--flow inventory-grid-shell--desk"
      aria-label="Inventory data grid"
    >
      <div
        className="inventory-table-wrap inventory-table-wrap--compact-v3 inventory-table-wrap--desk"
        role="region"
        aria-label="Inventory results table"
        tabIndex={0}
      >
        <table className="inv-desk-table">
          <caption className="inventory-sr-only">
            Compare vehicles, price, mileage, days on lot, hold and location status, and equipment.
            Each row has stock and VIN copy controls and an actions group.
          </caption>
          <thead>
            <tr>
              <SortHeader label="Vehicle" column="vehicle"
                options={[...VEHICLE_SORT_OPTIONS, ...STOCK_SORT_OPTIONS, ...EVIDENCE_SORT_OPTIONS]}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Price" column="price" numeric
                options={PRICE_SORT_OPTIONS}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Mileage" column="mileage" numeric
                options={MILEAGE_SORT_OPTIONS}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Days on lot" column="days" numeric
                options={AGE_SORT_OPTIONS}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Status" column="status"
                options={[...STATUS_SORT_OPTIONS, ...LOCATION_SORT_OPTIONS, ...CHANGE_SORT_OPTIONS]}
                sorts={sorts} onSortChange={onSortChange} />
              <SortHeader label="Equipment" column="equipment"
                options={EQUIPMENT_SORT_OPTIONS}
                sorts={sorts} onSortChange={onSortChange} />
              <th scope="col" className="inv-desk-th inv-desk-th--actions" data-column="actions">
                <span className="inv-desk-th__label">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => {
              const selected = vehicle.id === selectedVehicleId;
              return (
                <tr
                  key={vehicle.id}
                  className={`inv-desk-row${selected ? " is-selected" : ""}`}
                  data-stock-number={vehicle.stockNumber}
                  data-inventory-vehicle-trigger={vehicle.id}
                  data-hold-state={vehicle.dealerMail.hasActiveHold === true ? "held" : vehicle.dealerMail.hasActiveHold === false ? "clear" : "unknown"}
                  data-has-movement={vehicleMovementStatus(vehicle) ? "true" : "false"}
                  onClick={() => onSelectVehicle(vehicle)}
                >
                  <td className="inv-desk-td inv-desk-td--vehicle" data-column="vehicle">
                    <DeskVehicleCell vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
                  </td>
                  <td className="inv-desk-td inv-desk-td--num" data-column="price">
                    <DeskPriceCell vehicle={vehicle} />
                  </td>
                  <td className="inv-desk-td inv-desk-td--num" data-column="mileage">
                    <DeskMileageCell vehicle={vehicle} />
                  </td>
                  <td className="inv-desk-td inv-desk-td--num" data-column="days">
                    <DeskDaysCell vehicle={vehicle} />
                  </td>
                  <td className="inv-desk-td" data-column="status">
                    <DeskStatusCell vehicle={vehicle} onSelectVehicle={onSelectVehicle} onOpenSourceRecord={onOpenSourceRecord} />
                  </td>
                  <td className="inv-desk-td" data-column="equipment">
                    <DeskEquipmentCell vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
                  </td>
                  <td className="inv-desk-td inv-desk-td--actions" data-column="actions">
                    <DeskRowActions
                      vehicle={vehicle}
                      onSelectVehicle={onSelectVehicle}
                      canRequestVehicle={canRequestVehicle}
                      onRequestVehicle={onRequestVehicle}
                      onTrackMovement={onTrackMovement}
                      onOpenListing={onOpenListing}
                      onOpenSourceRecord={onOpenSourceRecord}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function InventoryMobileList({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onOpenSourceRecord,
}: Pick<InventoryTableProps, "vehicles" | "selectedVehicleId" | "onSelectVehicle" | "onOpenSourceRecord">) {
  return (
    <div className="inventory-mobile-list inventory-mobile-list--vehicle-first inventory-mobile-list--production-v8 inventory-mobile-list--flow" aria-label="Inventory results">
      {vehicles.map((vehicle) => {
        const name = vehicleDisplayName(vehicle);
        const recentChange = primaryVehicleChangeSignal(vehicle.changeSummary);
        const movementStatus = vehicleMovementStatus(vehicle);
        const equipment = publishedEquipment(vehicle);
        const equipmentHighlights = equipment.slice(0, 3);
        const holdStatus = vehicleOperationalStatus(vehicle);
        const currentLocation = resolveCurrentLocation(vehicle);
        const specification = [
          vehicle.bodyType || vehicle.bodyStyle,
          vehicle.drivetrain,
          vehicle.engine,
        ].filter(Boolean).join(" · ") || "Specifications in details";
        const operationalUpdate = movementStatus?.label || recentChange?.shortLabel;
        const HoldIcon = holdStatus.icon;
        const holdToolsAvailable = vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
        return (
          <article
            className={`inventory-mobile-row inventory-mobile-row--compact-v3 inventory-mobile-row--production-v8${vehicle.id === selectedVehicleId ? " is-selected" : ""}`}
            key={vehicle.id}
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
              <span className="inventory-vehicle-visual"><VehiclePhoto vehicle={vehicle} /><PhotoCount vehicle={vehicle} /></span>
              <span className="inventory-mobile-row__main">
                <span className="inventory-mobile-row__title">
                  <strong>{name}</strong>
                </span>
                <small className="inventory-mobile-row__specification" title={specification}>{specification}</small>
              </span>
              <span className="inventory-mobile-row__valuation">
                <b>{formatMoney(vehicle.price)}</b>
                <span>{formatMileage(vehicle.mileage)}</span>
                {vehicle.certified ? <small className="inventory-certified-label">Certified</small> : null}
              </span>
              <span className="inventory-mobile-row__identity">
                <span>{vehicle.stockNumber}</span>
                <span aria-hidden="true">·</span>
                <span>{vehicle.vin}</span>
              </span>
              <ChevronRight className="inventory-mobile-row__chevron" size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <div className="inventory-mobile-row__signals" aria-label="Operational vehicle signals">
                <button
                  type="button"
                  className={`inventory-mobile-hold inventory-mobile-hold--${holdStatus.tone}`}
                  title={holdToolsAvailable ? `${holdStatus.detail}. DealerMail hold actions are available in vehicle details.` : holdStatus.detail}
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
                  <HoldIcon size={14} strokeWidth={1.9} aria-hidden="true" />
                  <strong>{holdStatus.label}</strong>
                </button>
                {vehicle.managerDisposition ? (
                  <span className="inventory-mobile-manager-disposition" data-state={vehicle.managerDisposition.dataState}>
                    <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden="true" />
                    <span><strong>{vehicle.managerDisposition.soldLabel}</strong><small>{vehicle.managerDisposition.deliveryLabel}</small></span>
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`inventory-mobile-location inventory-mobile-update${movementStatus ? " inventory-mobile-update--movement" : ""}`}
                  title={[currentLocation.detail, movementStatus?.detail || vehicle.changeSummary].filter(Boolean).join(" · ")}
                  data-inventory-vehicle-trigger={vehicle.id}
                  aria-label={operationalUpdate
                    ? `View ${movementStatus ? "movement" : "change history"} for ${name}: ${operationalUpdate}`
                    : `View location and movement for ${name}: ${currentLocation.label}`}
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    onSelectVehicle(vehicle, !movementStatus && recentChange ? "timeline" : "movement");
                  }}
                >
                  <MapPin size={14} strokeWidth={1.9} aria-hidden="true" />
                  <span><strong>{currentLocation.label}</strong>{operationalUpdate ? <small>{operationalUpdate}</small> : null}</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
                {equipmentHighlights.length ? (
                  <button
                    type="button"
                    className="inventory-mobile-feature"
                    data-inventory-vehicle-trigger={vehicle.id}
                    aria-label={`View all ${equipment.length} equipment items for ${name}`}
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      onSelectVehicle(vehicle, "equipment");
                    }}
                  >
                    <span className="inventory-mobile-feature__items">
                      {equipmentHighlights.map((item, index) => (
                        <span key={item.label}>{index ? <span aria-hidden="true"> · </span> : null}{item.label}</span>
                      ))}
                      {equipment.length > equipmentHighlights.length
                        ? <span className="inventory-mobile-feature__remaining"> · +{equipment.length - equipmentHighlights.length} more</span>
                        : null}
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                ) : null}
                <MobileDocumentAvailability vehicle={vehicle} onSelectVehicle={onSelectVehicle} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function inventorySortSummary(sorts: InventoryTableProps["sorts"]): string {
  return sorts
    .map((sort, index) => `${index + 1}. ${SORT_LABELS[sort.key]} ${sort.direction === "asc" ? "ascending" : "descending"}`)
    .join(", ");
}
