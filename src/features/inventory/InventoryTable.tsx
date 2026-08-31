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
import type {
  InventorySortKey,
  InventoryTableProps,
  InventoryVehicle,
} from "./types";
import "./InventoryTable.compact-v3.css";
import "./InventoryTable.production-v4.css";

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
  { label: "Photos", sortKey: "photoCount" },
  { label: "AutoCheck score", sortKey: "autoCheckScore" },
  { label: "Vehicle documents", sortKey: "documentAvailability" },
] satisfies SortOption[];

const STATUS_SORT_OPTIONS = [
  { label: "Hold", sortKey: "holdStatus" },
  { label: "Hold salesperson", sortKey: "salesperson" },
  { label: "Website", sortKey: "websiteStatus" },
] satisfies SortOption[];

const LOCATION_SORT_OPTIONS = [
  { label: "Current", sortKey: "currentLocation" },
  { label: "Home store", sortKey: "homeStore" },
  { label: "Movement", sortKey: "movementStatus" },
] satisfies SortOption[];

const CHANGE_SORT_OPTIONS = [
  { label: "Source update", sortKey: "recentActivity" },
  { label: "Last movement", sortKey: "lastMovement" },
] satisfies SortOption[];

interface SortControlProps extends SortOption {
  sorts: InventoryTableProps["sorts"];
  onSortChange: InventoryTableProps["onSortChange"];
}

function SortControl({ label, sortKey, sorts, onSortChange }: SortControlProps) {
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
      <span>{label}</span>
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
  group: "vehicle" | "identity" | "pricing" | "age" | "equipment" | "status" | "location" | "changes";
  options: SortOption[];
  sorts: InventoryTableProps["sorts"];
  onSortChange: InventoryTableProps["onSortChange"];
}

function SortHeader({ label, group, options, sorts, onSortChange }: SortHeaderProps) {
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
      <span className="inventory-sort-header-group__label">{label}</span>
      <span className="inventory-sort-header-group__controls">
        <SortControl
          {...displayedOption}
          sorts={sorts}
          onSortChange={onSortChange}
        />
        {overflowOptions.length ? (
          <details className="inventory-sort-header-group__more">
            <summary
              className="inventory-sort-header-group__more-trigger"
              aria-label={`More ${label} sort options`}
              title={`More ${label.toLocaleLowerCase()} sort options`}
            >
              <ListFilter size={13} strokeWidth={2} aria-hidden="true" />
            </summary>
            <span
              className="inventory-sort-header-group__menu"
              role="group"
              aria-label={`${label} sort options`}
            >
              {overflowOptions.map((option) => (
                <SortControl
                  key={option.sortKey}
                  {...option}
                  sorts={sorts}
                  onSortChange={onSortChange}
                />
              ))}
            </span>
          </details>
        ) : null}
      </span>
    </th>
  );
}

export function VehiclePhoto({ vehicle, className = "" }: { vehicle: InventoryVehicle; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = vehicle.imageUrl || vehicle.imageUrls?.[0];
  return src && !failed ? (
    <img
      className={className}
      src={src}
      alt={`${vehicleDisplayName(vehicle)} exterior`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
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
      detail: "Confirm before committing",
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
  ].slice(0, 2);
  const remaining = Math.max(0, published.length - equipment.length);
  const first = equipment[0];
  const second = equipment[1];
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const documentLinks = [
    {
      key: "autocheck",
      label: "AutoCheck",
      url: officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", listingUrl),
      icon: ShieldCheck,
      ariaLabel: `Open AutoCheck report for ${name} in a new tab`,
    },
    {
      key: "window-sticker",
      label: "Sticker",
      url: officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", listingUrl),
      icon: FileText,
      ariaLabel: `Open window sticker for ${name} in a new tab`,
    },
  ].filter((item): item is typeof item & { url: string } => Boolean(item.url));
  return (
    <span className="inventory-equipment-cell">
      {first ? <strong title={first.label}>{first.label}</strong> : <span className="is-quiet">No published highlights</span>}
      {second || remaining > 0 ? (
        <small title={second?.label}>
          {second?.label ?? "More equipment in details"}{remaining > 0 ? ` · +${remaining}` : ""}
        </small>
      ) : null}
      {documentLinks.length ? (
        <span className="inventory-equipment-docs" aria-label="Vehicle documents">
          {documentLinks.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.key}
                className={`inventory-equipment-doc inventory-equipment-doc--${item.key}`}
                data-row-action={item.key}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={item.ariaLabel}
                onClick={(event) => event.stopPropagation()}
              >
                <Icon size={11} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function ActivityCell({ vehicle }: { vehicle: InventoryVehicle }) {
  const change = primaryVehicleChangeSignal(vehicle.changeSummary);
  const autoCheckFacts = [
    typeof vehicle.autoCheckReport?.score === "number" ? `AutoCheck ${vehicle.autoCheckReport.score}` : null,
    typeof vehicle.autoCheckReport?.ownerCount === "number"
      ? `${vehicle.autoCheckReport.ownerCount} owner${vehicle.autoCheckReport.ownerCount === 1 ? "" : "s"}`
      : null,
    vehicle.autoCheckReport?.usage?.trim() || null,
  ].filter((fact): fact is string => Boolean(fact));
  if (change) {
    return (
      <span className={`inventory-change-summary inventory-change-summary--${change.kind}`}>
        <strong>{change.shortLabel}</strong>
        <small>{autoCheckFacts.length ? autoCheckFacts.slice(0, 2).join(" · ") : vehicle.changeSummary}</small>
      </span>
    );
  }
  if (autoCheckFacts.length) {
    return (
      <span className="inventory-activity-summary">
        <ShieldCheck size={14} strokeWidth={1.9} aria-hidden="true" />
        <strong>{autoCheckFacts[0]}</strong>
        {autoCheckFacts.length > 1 ? <small>{autoCheckFacts.slice(1).join(" · ")}</small> : null}
      </span>
    );
  }
  return <span className="inventory-activity-summary is-quiet">No recent source change</span>;
}

function PhotoCount({ vehicle }: { vehicle: InventoryVehicle }) {
  const count = vehicle.photoCount ?? vehicle.imageUrls?.length ?? (vehicle.imageUrl ? 1 : 0);
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
  const name = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl?.trim() || null;
  const factoryEquipmentUrl = vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url);
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
      factoryEquipmentUrl ||
      invoiceUrl ||
      oasisUrl ||
      (requestAllowed && onRequestVehicle) ||
      canTrackMovement,
  );

  return (
    <div
      className="inventory-row-actions inventory-row-actions--compact-v3"
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
        <details className="inventory-row-more" data-row-action="more">
          <summary
            className="inventory-row-more__trigger"
            aria-label={`More actions for ${name}`}
            title="More vehicle actions"
          >
            <Ellipsis size={13} strokeWidth={2} aria-hidden="true" />
            <span className="inventory-row-action-label inventory-row-more__label" aria-hidden="true">More</span>
            <span className="inventory-sr-only">More actions</span>
          </summary>
          <div
            className="inventory-row-more__menu"
            role="group"
            aria-label={`More actions for ${name}`}
          >
            {listingUrl ? (
              onOpenListing ? (
                <button
                  type="button"
                  className="inventory-row-more__item"
                  data-row-action="listing"
                  onClick={() => onOpenListing(vehicle)}
                >
                  <Globe2 size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Website listing</span>
                </button>
              ) : (
                <a
                  className="inventory-row-more__item"
                  data-row-action="listing"
                  href={listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open website listing for ${name} in a new tab`}
                >
                  <Globe2 size={16} strokeWidth={1.85} aria-hidden="true" />
                  <span>Website listing</span>
                  <ExternalLink size={12} strokeWidth={1.85} aria-hidden="true" />
                </a>
              )
            ) : null}
            {factoryEquipmentUrl ? (
              <a
                className="inventory-row-more__item inventory-row-more__item--vauto"
                data-row-action="vauto-equipment"
                href={factoryEquipmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                aria-label={`Open vAuto informational equipment profile for ${name} in a new tab`}
              >
                <FileText size={16} strokeWidth={1.85} aria-hidden="true" />
                <span>Equipment profile</span>
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
                onClick={() => onRequestVehicle(vehicle)}
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
                onClick={() => onTrackMovement?.(vehicle)}
              >
                <Truck size={16} strokeWidth={1.85} aria-hidden="true" />
                <span>Track movement</span>
              </button>
            ) : null}
          </div>
        </details>
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
    <div className="inventory-table-wrap inventory-table-wrap--compact-v3">
      <table className="inventory-table inventory-table--vehicle-first inventory-table--compact-v3">
        <caption className="inventory-sr-only">
          Dealership inventory with vehicle photos, stock and VIN, pricing, mileage and age, key equipment, hold state, location, and activity.
        </caption>
        <thead>
          <tr>
            <SortHeader
              label="Vehicle"
              group="vehicle"
              options={VEHICLE_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Stock / VIN"
              group="identity"
              options={STOCK_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Price / MSRP"
              group="pricing"
              options={PRICE_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Miles / age"
              group="age"
              options={AGE_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Key equipment"
              group="equipment"
              options={EQUIPMENT_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Hold"
              group="status"
              options={STATUS_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Location / move"
              group="location"
              options={LOCATION_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <SortHeader
              label="Activity"
              group="changes"
              options={CHANGE_SORT_OPTIONS}
              sorts={sorts}
              onSortChange={onSortChange}
            />
            <th scope="col"><span className="inventory-sr-only">Vehicle actions</span></th>
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
                tabIndex={0}
                onClick={() => onSelectVehicle(vehicle)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectVehicle(vehicle);
                  }
                }}
                aria-label={vehicleAccessibleSummary(vehicle)}
              >
                <td>
                  <span className="inventory-vehicle-cell">
                    <span className="inventory-vehicle-visual"><VehiclePhoto vehicle={vehicle} /><PhotoCount vehicle={vehicle} /></span>
                    <span className="inventory-vehicle-copy">
                      <span className="inventory-vehicle-copy__title">
                        <strong>{name}</strong>
                        {vehicle.certified ? <small className="inventory-certified-label">Certified</small> : null}
                      </span>
                      <small title={[vehicle.bodyType || vehicle.bodyStyle, vehicle.engine].filter(Boolean).join(" · ")}>
                        {[vehicle.bodyType || vehicle.bodyStyle, vehicle.engine].filter(Boolean).join(" · ") || "Vehicle specifications in details"}
                      </small>
                    </span>
                  </span>
                </td>
                <td>
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
                </td>
                <td>
                  <span className="inventory-price-mileage inventory-price-mileage--price">
                    <strong>{formatMoney(vehicle.price)}</strong>
                    {vehicle.msrp != null && vehicle.msrp > 0 && vehicle.msrp !== vehicle.price ? (
                      <small className="inventory-price-mileage__msrp">MSRP {formatMoney(vehicle.msrp)}</small>
                    ) : null}
                  </span>
                </td>
                <td>
                  <span className="inventory-price-mileage inventory-price-mileage--age">
                    <strong>{formatMileage(vehicle.mileage)}</strong>
                    <small>
                      {[
                        vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : null,
                        compactInventoryDate(vehicle.inventoryDate) ? `in ${compactInventoryDate(vehicle.inventoryDate)}` : null,
                      ].filter(Boolean).join(" · ") || "Age unavailable"}
                    </small>
                  </span>
                </td>
                <td><EquipmentCell vehicle={vehicle} /></td>
                <td>
                  <HoldActionCell
                    vehicle={vehicle}
                    onSelectVehicle={onSelectVehicle}
                    onOpenSourceRecord={onOpenSourceRecord}
                  />
                </td>
                <td><LocationCell vehicle={vehicle} /></td>
                <td><ActivityCell vehicle={vehicle} /></td>
                <td className="inventory-row-action">
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
  );
}

export function InventoryMobileList({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onOpenSourceRecord,
}: Pick<InventoryTableProps, "vehicles" | "selectedVehicleId" | "onSelectVehicle" | "onOpenSourceRecord">) {
  return (
    <div className="inventory-mobile-list inventory-mobile-list--vehicle-first" aria-label="Inventory results">
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
            className={`inventory-mobile-row inventory-mobile-row--compact-v3${vehicle.id === selectedVehicleId ? " is-selected" : ""}`}
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
                  {vehicle.certified ? <small className="inventory-certified-label">Certified</small> : null}
                </span>
                <small className="inventory-mobile-row__specification" title={specification}>{specification}</small>
                <span className="inventory-mobile-row__identity">
                  <span>{vehicle.stockNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span>{vehicle.vin}</span>
                </span>
              </span>
              <span className="inventory-mobile-row__valuation">
                <b>{formatMoney(vehicle.price)}</b>
                <span>{formatMileage(vehicle.mileage)}</span>
              </span>
              <ChevronRight className="inventory-mobile-row__chevron" size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="inventory-mobile-row__signals" aria-label="Operational vehicle signals">
                <span
                  className={`inventory-mobile-hold inventory-mobile-hold--${holdStatus.tone}`}
                  title={holdToolsAvailable ? `${holdStatus.detail}. DealerMail hold actions are available in vehicle details.` : holdStatus.detail}
                >
                  <HoldIcon size={12} strokeWidth={1.9} aria-hidden="true" />
                  <strong>{holdStatus.label}</strong>
                </span>
                <span className="inventory-mobile-location" title={currentLocation.detail}>
                  <MapPin size={12} strokeWidth={1.9} aria-hidden="true" />
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
              </span>
            </button>
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
