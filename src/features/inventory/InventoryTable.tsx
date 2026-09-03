import { useState } from "react";
import {
  ArrowDown,
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

const AGE_SORT_OPTIONS = [
  { label: "Mileage", sortKey: "mileage" },
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

interface SortHeaderProps {
  label: string;
  /** Compact visible heading; the full label remains available to assistive technology. */
  displayLabel?: string;
  group: "vehicle-identity" | "financial-age" | "equipment" | "availability" | "evidence";
  options: SortOption[];
  sorts: InventoryTableProps["sorts"];
  onSortChange: InventoryTableProps["onSortChange"];
}

function SortHeader({ label, displayLabel, group, options, sorts, onSortChange }: SortHeaderProps) {
  const disclosure = useInventoryDisclosure(`inventory-${group}-sort-options`);
  const primarySort = sorts[0];
  const containsPrimarySort = options.some((option) => option.sortKey === primarySort?.key);
  const activeOption = [...options]
    .map((option) => ({ option, index: sorts.findIndex((sort) => sort.key === option.sortKey) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)[0]?.option;
  const displayedOption = activeOption ?? options[0];
  const overflowOptions = options.filter((option) => option.sortKey !== displayedOption.sortKey);
  const ariaSort = containsPrimarySort
    ? primarySort.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th scope="col" aria-sort={ariaSort} data-sort-group={group}>
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
              <ListFilter size={13} strokeWidth={2} aria-hidden="true" />
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

interface HoldActionCellProps {
  vehicle: InventoryVehicle;
  compact?: boolean;
  onSelectVehicle: InventoryTableProps["onSelectVehicle"];
  onOpenSourceRecord?: InventoryTableProps["onOpenSourceRecord"];
}

function HoldActionCell({
  vehicle,
  compact = false,
  onSelectVehicle,
  onOpenSourceRecord,
}: HoldActionCellProps) {
  const holdStatus = vehicleOperationalStatus(vehicle);
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
  const HoldIcon = holdStatus.icon;
  const openHold = () => {
    if (canOpenDealerMail) {
      onOpenSourceRecord?.(vehicle, "dealermail");
      return;
    }
    onSelectVehicle(vehicle);
  };

  return (
    <span className="inventory-status-stack inventory-status-stack--compact-v3">
      <button
        type="button"
        className={`inventory-hold-action inventory-hold-action--${holdStatus.tone}`}
        data-row-action={canOpenDealerMail ? "dealermail" : "hold-details"}
        onClick={(event) => {
          event.stopPropagation();
          openHold();
        }}
        aria-label={
          canOpenDealerMail
            ? `Open interactive DealerMail and copy stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}`
            : `Open hold details for ${vehicleDisplayName(vehicle)}`
        }
        title={canOpenDealerMail
          ? `Open interactive DealerMail and copy stock ${vehicle.stockNumber}. ${holdStatus.label}. ${holdDetail}`
          : `${holdStatus.label}. ${holdDetail}`}
      >
        <span className="inventory-hold-action__copy">
          <span className="inventory-hold-action__label">
            <HoldIcon size={compact ? 13 : 14} strokeWidth={1.9} aria-hidden="true" />
            <strong>{holdStatus.label}</strong>
          </span>
          {compact ? null : <small>{holdDetail}</small>}
        </span>
        <ChevronRight size={11} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}

function LocationCell({ vehicle, compact = false }: { vehicle: InventoryVehicle; compact?: boolean }) {
  const current = resolveCurrentLocation(vehicle);
  const movementStatus = vehicleMovementStatus(vehicle);
  const atHome = current.store
    ? current.store.id === vehicle.location.homeStore.id
    : current.label.toLowerCase() === vehicle.location.homeStore.name.toLowerCase();
  const Icon = current.provenance === "app-confirmed" ? Navigation : MapPin;
  const secondary = movementStatus
    ? movementStatus.label
    : vehicle.location.conflict
      ? "Location conflict"
      : atHome
        ? "Home store"
        : `Home ${vehicle.location.homeStore.name}`;
  return (
    <span
      className={`inventory-location-summary${vehicle.location.conflict ? " has-conflict" : ""}`}
      title={movementStatus?.detail ?? current.detail}
    >
      <span><Icon size={compact ? 14 : 16} strokeWidth={1.8} aria-hidden="true" /> <strong>{current.label}</strong></span>
      {compact ? null : (
        <small className={movementStatus ? `inventory-location-summary__movement inventory-location-summary__movement--${movementStatus.tone}` : undefined}>
          {movementStatus ? <Truck size={12} strokeWidth={1.9} aria-hidden="true" /> : null}
          {secondary}
        </small>
      )}
    </span>
  );
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

function EquipmentCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const published = publishedEquipment(vehicle);
  const standoutKeys = new Set(standoutEquipment(vehicle, 2).map((item) => `${item.source}:${item.label}`));
  const equipment = [
    ...published.filter((item) => standoutKeys.has(`${item.source}:${item.label}`)),
    ...published.filter((item) => !standoutKeys.has(`${item.source}:${item.label}`)),
  ].slice(0, 3);
  const remaining = Math.max(0, published.length - equipment.length);
  const first = equipment[0];
  const secondary = equipment.slice(1);
  return (
    <span className="inventory-equipment-cell">
      {first ? <strong title={first.label}>{first.label}</strong> : <span className="is-quiet">No published highlights</span>}
      {secondary.length ? (
        <span className="inventory-equipment-cell__secondary">
          {secondary.map((item) => <small key={`${item.source}:${item.label}`} title={item.label}>{item.label}</small>)}
        </span>
      ) : null}
      <span className="inventory-equipment-cell__meta">
        {vehicle.certified ? <small className="inventory-equipment-cell__certified">Certified</small> : null}
        {remaining > 0 ? <small className="inventory-equipment-cell__more">+{remaining} more</small> : null}
      </span>
    </span>
  );
}

function FinancialAgeCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const inventoryDate = compactInventoryDate(vehicle.inventoryDate);
  const age = vehicle.daysListed != null
    ? `${vehicle.daysListed} ${vehicle.daysListed === 1 ? "day" : "days"}`
    : "Age unavailable";
  return (
    <span className="inventory-financial-age-cell">
      <span className="inventory-financial-age-cell__price">
        <small>Listed price</small>
        <strong>{formatMoney(vehicle.price)}</strong>
        <span>{vehicle.msrp != null && vehicle.msrp > 0 ? `MSRP ${formatMoney(vehicle.msrp)}` : "MSRP not published"}</span>
      </span>
      <span className="inventory-financial-age-cell__usage">
        <small>Mileage</small>
        <strong>{formatMileage(vehicle.mileage)}</strong>
        <span title={inventoryDate ? `${age} listed; inventory date ${inventoryDate}` : `${age} listed`}>
          {inventoryDate ? `${age} · Inv ${inventoryDate}` : `${age} listed`}
        </span>
      </span>
    </span>
  );
}

function LocationActivityCell({ vehicle }: { vehicle: InventoryVehicle }) {
  return (
    <span className="inventory-location-activity-cell">
      <LocationCell vehicle={vehicle} />
      <ActivityCell vehicle={vehicle} />
    </span>
  );
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

function DocumentsCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const autoCheckUrl = officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", listingUrl);
  const windowStickerUrl = officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", listingUrl);
  const equipmentUrl = vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url);
  const photoCount = vehiclePhotoCount(vehicle);
  const documents = [
    autoCheckUrl ? {
      key: "autocheck",
      label: "AutoCheck",
      detail: autoCheckResourceDetail(vehicle),
      state: vehicle.autoCheckReport?.dataState,
      url: autoCheckUrl,
      icon: ShieldCheck,
      ariaLabel: `Open AutoCheck report for ${name} in a new tab`,
    } : null,
    windowStickerUrl ? {
      key: "window-sticker",
      label: "Window sticker",
      detail: windowStickerResourceDetail(vehicle),
      state: vehicle.windowSticker?.dataState,
      url: windowStickerUrl,
      icon: FileText,
      ariaLabel: `Open window sticker for ${name} in a new tab`,
    } : null,
    equipmentUrl ? {
      key: "vauto-equipment",
      label: "vAuto equipment",
      detail: factoryEquipmentResourceDetail(vehicle),
      state: vehicle.factoryEquipment?.dataState,
      url: equipmentUrl,
      icon: ClipboardCheck,
      ariaLabel: `Open vAuto informational equipment profile for ${name} in a new tab`,
    } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <span className="inventory-documents-cell" aria-label="Vehicle documents">
      {documents.length ? documents.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.key}
            className={`inventory-document-link${item.key === "autocheck" ? " inventory-document-link--autocheck" : ""}`}
            data-row-action={item.key}
            data-source-state={item.state ?? "unavailable"}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.ariaLabel}
            onClick={(event) => event.stopPropagation()}
          >
            {item.key === "autocheck"
              ? <AutoCheckCompactWordmark />
              : <Icon size={14} strokeWidth={1.9} aria-hidden="true" />}
            <span>
              <strong className={item.key === "autocheck" ? "inventory-sr-only" : undefined}>{item.label}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
            <ExternalLink size={11} strokeWidth={1.9} aria-hidden="true" />
          </a>
        );
      }) : <span className="inventory-documents-cell__empty">No linked resources</span>}
      <small className="inventory-documents-cell__photos">{photoCount ? `${photoCount} photos` : "No photos published"}</small>
    </span>
  );
}

function ActivityCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const change = primaryVehicleChangeSignal(vehicle.changeSummary);
  if (change) {
    return (
      <span className={`inventory-change-summary inventory-change-summary--${change.kind}`}>
        <strong>{change.shortLabel}</strong>
        <small>{vehicle.changeSummary}</small>
      </span>
    );
  }

  const sourceState = vehicle.publicListing.dataState;
  const sourceDetail = sourceState === "current"
    ? "Public inventory current"
    : sourceState === "stale"
      ? "Public inventory stale"
      : sourceState === "incomplete"
        ? "Public inventory incomplete"
        : "Public inventory unavailable";
  return (
    <span className={`inventory-activity-summary inventory-activity-summary--${sourceState} is-quiet`}>
      <strong>No recent change</strong>
      <small>{sourceDetail}</small>
    </span>
  );
}

function PhotoCount({ vehicle }: { vehicle: InventoryVehicle }) {
  const count = vehiclePhotoCount(vehicle);
  return count > 0 ? <span className="inventory-photo-count" aria-label={`${count} vehicle photos`}>{count}</span> : null;
}

interface VehicleRowActionsProps extends Pick<
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

function VehicleRowActions({
  vehicle,
  canRequestVehicle,
  onRequestVehicle,
  onTrackMovement,
  onOpenListing,
  onSelectVehicle,
  onOpenSourceRecord,
}: VehicleRowActionsProps) {
  const disclosure = useInventoryDisclosure("inventory-row-more-actions");
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const isFordFamily = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const invoiceUrl = isFordFamily ? fordInvoiceUrl(vehicle.vin) : null;
  const oasisUrl = isFordFamily ? fordOasisUrl(vehicle.vin) : null;
  const requestAllowed =
    typeof canRequestVehicle === "function"
      ? canRequestVehicle(vehicle)
      : canRequestVehicle === true;
  const canTrackMovement = Boolean(onTrackMovement && vehicleMovementStatus(vehicle));
  const canOpenDealerMail = vehicle.dealerMail.canManageHold === true && Boolean(onOpenSourceRecord);
  const hasOverflowActions = Boolean(
    listingUrl ||
      invoiceUrl ||
      oasisUrl ||
      (requestAllowed && onRequestVehicle) ||
      canTrackMovement,
  );

  return (
    <div
      className="inventory-row-actions inventory-row-actions--compact-v3 inventory-row-actions--production-v8"
      data-action-layout={hasOverflowActions ? "overflow" : "row-open"}
      data-has-dealermail={canOpenDealerMail ? "true" : "false"}
      data-has-overflow={hasOverflowActions ? "true" : "false"}
      data-responsive-labels="persistent"
      role="group"
      aria-label={`Actions for ${name}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="inventory-row-open"
        data-row-action="open-details"
        data-inventory-vehicle-trigger={vehicle.id}
        onClick={() => onSelectVehicle(vehicle)}
        aria-label={`Open vehicle details for ${name}`}
        title={`Open ${name}`}
      >
        <span className="inventory-row-action-label">Details</span>
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {canOpenDealerMail ? (
        <button
          type="button"
          className="inventory-row-dealermail"
          data-row-action="dealermail"
          onClick={() => onOpenSourceRecord?.(vehicle, "dealermail")}
          aria-label={`Open DealerMail for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}`}
          title="Open DealerMail vehicle tools"
        >
          <UserRound size={11} strokeWidth={1.9} aria-hidden="true" />
          <span className="inventory-row-action-label">DealerMail</span>
        </button>
      ) : null}
      {hasOverflowActions ? (
        <div
          ref={disclosure.containerRef}
          className="inventory-row-more"
          data-row-action="more"
          data-open={disclosure.open ? "true" : "false"}
        >
          <button
            ref={disclosure.triggerRef}
            type="button"
            className="inventory-row-more__trigger"
            aria-label={`More actions for ${name}`}
            aria-expanded={disclosure.open}
            aria-controls={disclosure.panelId}
            title="More vehicle actions"
            onClick={() => disclosure.setOpen((open) => !open)}
          >
            <Ellipsis size={13} strokeWidth={2} aria-hidden="true" />
            <span className="inventory-row-action-label inventory-row-more__label" aria-hidden="true">More</span>
            <span className="inventory-sr-only">More actions</span>
          </button>
          <div
            id={disclosure.panelId}
            className="inventory-row-more__menu"
            role="group"
            aria-label={`More actions for ${name}`}
            hidden={!disclosure.open}
          >
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
            {requestAllowed && onRequestVehicle ? (
              <button
                type="button"
                className="inventory-row-more__item"
                data-row-action="request-vehicle"
                onClick={() => {
                  disclosure.close();
                  onRequestVehicle(vehicle);
                }}
              >
                <CarFront size={16} strokeWidth={1.85} aria-hidden="true" />
                <span>Request vehicle</span>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileDocumentAvailability({ vehicle }: { vehicle: InventoryVehicle }) {
  const autoCheck = Boolean(officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", vehicle.publicListing.listingUrl));
  const sticker = Boolean(officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", vehicle.publicListing.listingUrl));
  if (!autoCheck && !sticker) return null;
  return (
    <span className="inventory-mobile-document-availability" aria-label="Documents available in vehicle details">
      {autoCheck ? <small data-document="autocheck"><ShieldCheck size={12} aria-hidden="true" /> AutoCheck</small> : null}
      {sticker ? <small data-document="sticker"><FileText size={12} aria-hidden="true" /> Sticker</small> : null}
    </span>
  );
}

function ChangeCell({ vehicle, compact = false }: { vehicle: InventoryVehicle; compact?: boolean }) {
  const change = primaryVehicleChangeSignal(vehicle.changeSummary);
  return change ? (
    <span className={`inventory-change-summary inventory-change-summary--${change.kind}`}>
      <strong>{change.shortLabel}</strong>
      {compact ? null : <small>{vehicle.changeSummary}</small>}
    </span>
  ) : (
    <span className="inventory-change-summary is-quiet">No recent change</span>
  );
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
    <section className="inventory-grid-shell inventory-grid-shell--production-v8 inventory-grid-shell--operational-v9" aria-label="Inventory data grid">
      <div
        className="inventory-table-wrap inventory-table-wrap--compact-v3"
        role="region"
        aria-label="Inventory results table"
        tabIndex={0}
      >
        <table className="inventory-table inventory-table--vehicle-first inventory-table--compact-v3 inventory-table--workbench-v5 inventory-table--production-v8 inventory-table--operational-v9">
        <caption className="inventory-sr-only">
          Dealership inventory workbench with vehicle identity, financial and inventory age, equipment highlights, availability and movement, evidence and resources, and actions.
        </caption>
        <colgroup>
          <col className="inventory-table__col inventory-table__col--vehicle-identity" />
          <col className="inventory-table__col inventory-table__col--financial-age" />
          <col className="inventory-table__col inventory-table__col--equipment-highlights" />
          <col className="inventory-table__col inventory-table__col--availability-movement" />
          <col className="inventory-table__col inventory-table__col--evidence-resources" />
          <col className="inventory-table__col inventory-table__col--operational-actions" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader
              label="Vehicle identity"
              group="vehicle-identity"
              options={[...VEHICLE_SORT_OPTIONS, ...STOCK_SORT_OPTIONS]}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Financial & age"
              group="financial-age"
              options={[...PRICE_SORT_OPTIONS, ...AGE_SORT_OPTIONS]}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Equipment highlights"
              group="equipment"
              options={EQUIPMENT_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Availability & movement"
              group="availability"
              options={[...STATUS_SORT_OPTIONS, ...LOCATION_SORT_OPTIONS, ...CHANGE_SORT_OPTIONS]}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Evidence & resources"
              group="evidence"
              options={EVIDENCE_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <th scope="col"><span className="inventory-table-actions-heading">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => {
            const selected = vehicle.id === selectedVehicleId;
            const name = vehicleDisplayName(vehicle);
            return (
              <tr
                key={vehicle.id}
                className={selected ? "is-selected" : undefined}
                data-stock-number={vehicle.stockNumber}
                data-inventory-vehicle-trigger={vehicle.id}
                data-hold-state={vehicle.dealerMail.hasActiveHold === true ? "held" : vehicle.dealerMail.hasActiveHold === false ? "clear" : "unknown"}
                data-has-movement={vehicleMovementStatus(vehicle) ? "true" : "false"}
                onClick={() => onSelectVehicle(vehicle)}
              >
                <td data-column="vehicle-identity">
                  <span className="inventory-vehicle-cell">
                    <span className="inventory-vehicle-visual"><VehiclePhoto vehicle={vehicle} /><PhotoCount vehicle={vehicle} /></span>
                    <span className="inventory-vehicle-copy">
                      <span className="inventory-vehicle-copy__title">
                        <strong>{name}</strong>
                      </span>
                      <small className="inventory-vehicle-copy__spec" title={[vehicle.bodyType || vehicle.bodyStyle, vehicle.drivetrain].filter(Boolean).join(" · ")}>
                        {[vehicle.bodyType || vehicle.bodyStyle, vehicle.drivetrain].filter(Boolean).join(" · ") || "Body and drivetrain in details"}
                      </small>
                      <small className="inventory-vehicle-copy__detail" title={[vehicle.exteriorColor, vehicle.engine].filter(Boolean).join(" · ")}>
                        {[vehicle.exteriorColor, vehicle.engine].filter(Boolean).join(" · ") || "Engine and color in details"}
                      </small>
                    </span>
                    <span className="inventory-identity-cell">
                      <strong>
                        <CopyableValue
                          compact
                          label="stock number"
                          text={vehicle.stockNumber}
                          className="inventory-table-copy-value inventory-table-copy-value--stock"
                        />
                      </strong>
                      <small className="inventory-vin">
                        <CopyableValue
                          compact
                          label="VIN"
                          text={vehicle.vin}
                          className="inventory-table-copy-value inventory-table-copy-value--vin"
                        />
                      </small>
                    </span>
                  </span>
                </td>
                <td data-column="financial-age"><FinancialAgeCell vehicle={vehicle} /></td>
                <td data-column="equipment-highlights"><EquipmentCell vehicle={vehicle} /></td>
                <td data-column="availability-movement">
                  <span className="inventory-availability-movement-cell">
                    <HoldActionCell
                      vehicle={vehicle}
                      onSelectVehicle={onSelectVehicle}
                      onOpenSourceRecord={onOpenSourceRecord}
                    />
                    <LocationActivityCell vehicle={vehicle} />
                  </span>
                </td>
                <td data-column="evidence-resources"><DocumentsCell vehicle={vehicle} /></td>
                <td className="inventory-row-action" data-column="actions">
                  <VehicleRowActions
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
    <div className="inventory-mobile-list inventory-mobile-list--vehicle-first inventory-mobile-list--production-v8" aria-label="Inventory results">
      {vehicles.map((vehicle) => {
        const name = vehicleDisplayName(vehicle);
        const recentChange = primaryVehicleChangeSignal(vehicle.changeSummary);
        const movementStatus = vehicleMovementStatus(vehicle);
        const primaryEquipment = standoutEquipment(vehicle, 1)[0]?.label;
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
            data-hold-state={vehicle.dealerMail.hasActiveHold === true ? "held" : vehicle.dealerMail.hasActiveHold === false ? "clear" : "unknown"}
          >
            <button
              type="button"
              className="inventory-mobile-row__open"
              data-inventory-vehicle-trigger={vehicle.id}
              onClick={() => onSelectVehicle(vehicle)}
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
                  onClick={() => {
                    if (holdToolsAvailable) {
                      onOpenSourceRecord?.(vehicle, "dealermail");
                      return;
                    }
                    onSelectVehicle(vehicle);
                  }}
                  aria-label={holdToolsAvailable
                    ? `Open DealerMail hold tools for stock ${vehicle.stockNumber}; verify VIN ${vehicle.vin}`
                    : `Open hold details for ${name}`}
                >
                  <HoldIcon size={14} strokeWidth={1.9} aria-hidden="true" />
                  <strong>{holdStatus.label}</strong>
                </button>
                <span className="inventory-mobile-location" title={currentLocation.detail}>
                  <MapPin size={14} strokeWidth={1.9} aria-hidden="true" />
                  <strong>{currentLocation.label}</strong>
                </span>
                <MobileDocumentAvailability vehicle={vehicle} />
                {primaryEquipment ? (
                  <span className="inventory-mobile-feature" title={primaryEquipment}>{primaryEquipment}</span>
                ) : null}
                {operationalUpdate ? (
                  <span className={`inventory-mobile-update${movementStatus ? " inventory-mobile-update--movement" : ""}`} title={movementStatus?.detail || vehicle.changeSummary || undefined}>
                    {operationalUpdate}
                  </span>
                ) : null}
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
