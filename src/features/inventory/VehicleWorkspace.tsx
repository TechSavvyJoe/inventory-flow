import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  Database,
  ExternalLink,
  FileText,
  FileSearch,
  Gauge,
  Globe2,
  History,
  ImageOff,
  MapPin,
  MessageSquare,
  Navigation,
  Printer,
  ShieldCheck,
  Store,
  Tag,
  Truck,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { CopyableValue } from "../../components/CopyableValue";
import { CapturedDealerMailMessages, DealerMailHandoff } from "./DealerMailHandoff";
import { FactoryStickerIcon } from "../../design-system/icons";
import {
  formatDate,
  formatDateTime,
  formatMileage,
  formatMoney,
  formatStickerMoney,
  isMoveRequestBlocked,
  resolveCurrentLocation,
  sameStore,
  vehicleDisplayName,
} from "./inventory-utils";
import { primaryVehicleChangeSignal } from "./change-utils";
import {
  autoCheckResultTone,
  fordInvoiceUrl,
  fordOasisUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from "./vehicle-document-utils";
import { standoutEquipment } from "./vehicle-feature-utils";
import { warrantySummary, warrantyOutlook } from "./vehicle-warranty-utils";
import { WarrantyOutlook } from "./WarrantyOutlook";
import { TakeHomeSheet } from "./TakeHomeSheet";
import { useContainedFocus } from "../../lib/useContainedFocus";
import type {
  DealerMailHoldEvidence,
  InventoryVehicle,
  SourceDataState,
  VehicleTimelineEvent,
  VehicleTimelineSource,
  VehicleWorkspaceProps,
} from "./types";
import "./VehicleWorkspace.compact-v3.css";
import "./VehicleWorkspace.v10.css";
import "./VehicleWorkspace.flow.css";

type WorkspaceSectionId =
  | "overview"
  | "hold"
  | "movement"
  | "equipment"
  | "timeline"
  | "data";

type WorkspacePageId = "overview" | "equipment" | "hold" | "data";

const WORKSPACE_SECTIONS: Array<{ id: WorkspacePageId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "equipment", label: "Equipment" },
  { id: "hold", label: "Holds & moves" },
  { id: "data", label: "Records" },
];

const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function workspacePage(section: WorkspaceSectionId): WorkspacePageId {
  if (section === "movement") return "hold";
  if (section === "timeline") return "data";
  return section;
}

function workspaceScrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
    ? "auto"
    : "smooth";
}

function oemThemeToken(make: string): "ford" | "lincoln" | "generic" {
  const normalized = make.trim().toLowerCase();
  if (normalized === "ford") return "ford";
  if (normalized === "lincoln") return "lincoln";
  return "generic";
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function dataStateLabel(state: SourceDataState): string {
  switch (state) {
    case "current":
      return "Current";
    case "stale":
      return "Update delayed";
    case "incomplete":
      return "Needs review";
    case "unavailable":
      return "Unavailable";
  }
}

function humanizeWorkflowValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/[_-]/.test(trimmed)) {
    return `${trimmed.charAt(0).toLocaleUpperCase()}${trimmed.slice(1)}`;
  }
  const spaced = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLocaleLowerCase();
  return `${spaced.charAt(0).toLocaleUpperCase()}${spaced.slice(1)}`;
}

function DataState({ state }: { state: SourceDataState }) {
  return (
    <span className={`inventory-data-state inventory-data-state--${state}`}>
      {state === "current" ? (
        <CheckCircle2 size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : state === "stale" || state === "incomplete" ? (
        <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <CircleHelp size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
      {dataStateLabel(state)}
    </span>
  );
}

function BooleanSignal({ value }: { value: boolean | null }) {
  if (value === true) {
    return (
      <span className="inventory-boolean inventory-boolean--yes">
        <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden="true" /> Yes
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inventory-boolean inventory-boolean--no">
        <XCircle size={15} strokeWidth={1.75} aria-hidden="true" /> No
      </span>
    );
  }
  return (
    <span className="inventory-boolean inventory-boolean--unknown">
      <CircleHelp size={15} strokeWidth={1.75} aria-hidden="true" /> Not reported
    </span>
  );
}

function Fact({
  label,
  children,
  emphasize = false,
  className,
}: {
  label: string;
  children: ReactNode;
  emphasize?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`inventory-workspace-fact${
        emphasize ? " inventory-workspace-fact--emphasized" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface OperationalSignalProps {
  id: string;
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: "default" | "clear" | "held" | "unverified" | "danger";
  section: WorkspaceSectionId;
  active: boolean;
  onActivate: (id: WorkspaceSectionId) => void;
  className?: string;
}

function OperationalSignal({
  id,
  label,
  value,
  detail,
  icon,
  tone = "default",
  section,
  active,
  onActivate,
  className = "",
}: OperationalSignalProps) {
  return (
    <button
      type="button"
      className={`inventory-workspace-signal inventory-workspace-signal--${id} inventory-workspace-signal--${tone}${
        className ? ` ${className}` : ""
      }`}
      aria-controls={`inventory-section-${section}`}
      onClick={() => onActivate(section)}
      data-signal={id}
      data-signal-state={tone}
    >
      <span className="inventory-workspace-signal__icon">{icon}</span>
      <span className="inventory-workspace-signal__copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
      <ChevronRight className="inventory-workspace-signal__chevron" size={17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function WorkspacePanel({
  id,
  label,
  active,
  children,
}: {
  id: WorkspaceSectionId;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <details
      id={`inventory-section-${id}`}
      className={`inventory-workspace-panel inventory-workspace-panel--${id}`}
      open={active}
      hidden={!active}
      data-panel={id}
    >
      <summary className="inventory-sr-only" tabIndex={-1}>
        {label}
      </summary>
      <div
        className="inventory-workspace-panel__body"
        id={`inventory-panel-${id}`}
        role="tabpanel"
        aria-labelledby={`inventory-tab-${id}`}
        tabIndex={0}
      >
        {children}
      </div>
    </details>
  );
}

function AutoCheckWordmark({
  compact = false,
  decorative = false,
}: {
  compact?: boolean;
  decorative?: boolean;
} = {}) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <span
      className={`inventory-document-wordmark inventory-document-wordmark--autocheck${compact ? " inventory-document-wordmark--compact" : ""}`}
      data-brand-asset={logoFailed ? "text-fallback" : "official-image"}
      aria-hidden={decorative ? "true" : undefined}
    >
      {logoFailed ? (
        <span
          role={decorative ? undefined : "img"}
          aria-label={decorative ? undefined : "AutoCheck by Experian"}
          className="inventory-document-wordmark__fallback"
        >
          <span aria-hidden="true" className="inventory-document-wordmark__line">
            <span>Auto</span><strong>Check</strong><sup>®</sup>
          </span>
          <small aria-hidden="true">by Experian</small>
        </span>
      ) : (
        <img
          src="https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg"
          alt={decorative ? "" : "AutoCheck by Experian"}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
        />
      )}
    </span>
  );
}

function WindowStickerWordmark({ make }: { make: string }) {
  const brand = make.trim() || "Factory";
  return (
    <span
      className={`inventory-document-wordmark inventory-document-wordmark--sticker inventory-document-wordmark--${oemThemeToken(make)}`}
      role="img"
      aria-label={`${brand} factory window sticker`}
    >
      <span aria-hidden="true" className="inventory-document-wordmark__line">
        {brand}
      </span>
      <small aria-hidden="true">Factory window sticker</small>
    </span>
  );
}

function VautoFactoryEquipmentWordmark() {
  return (
    <span
      className="inventory-document-wordmark inventory-document-wordmark--vauto"
      role="img"
      aria-label="vAuto Factory Equipment informational label"
    >
      <span aria-hidden="true" className="inventory-document-wordmark__line">
        <b>v</b>Auto
      </span>
      <small aria-hidden="true">Factory Equipment</small>
    </span>
  );
}

function FordOasisWordmark() {
  return (
    <span
      className="inventory-document-wordmark inventory-document-wordmark--oasis"
      role="img"
      aria-label="Ford OASIS vehicle report"
    >
      <span aria-hidden="true" className="inventory-document-wordmark__line">
        OASIS
      </span>
      <small aria-hidden="true">Ford vehicle report</small>
    </span>
  );
}

function VehicleGallery({ vehicle }: { vehicle: InventoryVehicle }) {
  const suppliedImages = useMemo(() => {
    const candidates = [...(vehicle.imageUrls ?? []), vehicle.imageUrl]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return [...new Set(candidates)];
  }, [vehicle.imageUrl, vehicle.imageUrls]);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const usableImages = suppliedImages.filter((url) => !failedImages.has(url));
  const activeImage = usableImages[activeIndex] ?? null;
  const displayName = vehicleDisplayName(vehicle);

  useEffect(() => {
    setFailedImages(new Set());
    setActiveIndex(0);
  }, [vehicle.id]);

  useEffect(() => {
    if (activeIndex >= usableImages.length) {
      setActiveIndex(Math.max(0, usableImages.length - 1));
    }
  }, [activeIndex, usableImages.length]);

  const moveGallery = (direction: -1 | 1) => {
    if (usableImages.length < 2) return;
    setActiveIndex(
      (current) =>
        (current + direction + usableImages.length) % usableImages.length,
    );
  };

  const handleGalleryKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveGallery(event.key === "ArrowLeft" ? -1 : 1);
  };

  const markImageFailed = (url: string) => {
    setFailedImages((current) => new Set(current).add(url));
  };

  if (!activeImage) {
    return (
      <section
        className="inventory-workspace-gallery inventory-workspace-gallery--cinematic inventory-workspace-gallery--empty"
        aria-label="Vehicle photos"
        data-photo-state="empty"
      >
        <div className="inventory-workspace-gallery__placeholder">
          <ImageOff size={34} strokeWidth={1.6} aria-hidden="true" />
          <strong>Photos are not available</strong>
          <span>
            {vehicle.photoCount
              ? `${vehicle.photoCount} photos reported by the inventory source`
              : "No photo URLs were supplied"}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="inventory-workspace-gallery inventory-workspace-gallery--cinematic"
      aria-label={`Photos of ${displayName}`}
      tabIndex={0}
      onKeyDown={handleGalleryKeyDown}
      data-photo-state="available"
      data-photo-count={usableImages.length}
    >
      <div className="inventory-workspace-gallery__stage">
        <img
          key={activeImage}
          src={activeImage}
          alt={`${displayName}, photo ${activeIndex + 1}`}
          onError={() => markImageFailed(activeImage)}
        />
        <span className="inventory-workspace-gallery__count" aria-live="polite">
          {activeIndex + 1} / {usableImages.length}
        </span>
        {usableImages.length > 1 ? (
          <>
            <button
              type="button"
              className="inventory-workspace-gallery__previous"
              onClick={() => moveGallery(-1)}
              aria-label="Show previous vehicle photo"
            >
              <ChevronLeft
                size={22}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="inventory-workspace-gallery__next"
              onClick={() => moveGallery(1)}
              aria-label="Show next vehicle photo"
            >
              <ChevronRight
                size={22}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
          </>
        ) : null}
      </div>
      {usableImages.length > 1 ? (
        <div
          className="inventory-workspace-gallery__thumbnails"
          aria-label="Choose a vehicle photo"
        >
          {usableImages.map((url, index) => (
            <button
              type="button"
              className={index === activeIndex ? "is-active" : undefined}
              aria-label={`Show vehicle photo ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => setActiveIndex(index)}
              key={url}
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                onError={() => markImageFailed(url)}
              />
            </button>
          ))}
        </div>
      ) : null}
      <span className="inventory-workspace-gallery__keyboard-hint">
        Use left and right arrow keys to browse photos
      </span>
    </section>
  );
}

function HoldEvidenceRecord({
  evidence,
  backupCount,
}: {
  evidence: DealerMailHoldEvidence;
  backupCount?: number;
}) {
  const isLastVerified = evidence.dataState === "stale" || evidence.lifecycleStatus === "last_verified_active";
  const fieldLabel = (label: string) => isLastVerified ? `Last verified ${label.toLowerCase()}` : label;
  const messages = [
    ...(evidence.alerts?.map((alert) => ({
      kind: "alert" as const,
      text: alert.text,
      author: alert.author,
      timestamp: alert.timestamp,
      metadataRaw: alert.metadataRaw,
      spiffRaw: alert.spiffRaw,
    })) ?? []),
    ...(evidence.comments?.map((comment) => ({
      kind: "comment" as const,
      text: comment.text,
      author: comment.author,
      timestamp: comment.timestamp,
      metadataRaw: null,
      spiffRaw: null,
    })) ?? []),
  ];

  return (
    <article className="inventory-hold-evidence" data-evidence-state={isLastVerified ? "last-verified" : "current"}>
      <header>
        <span>
          <strong>
            {evidence.position
              ? `${isLastVerified ? "Last verified " : ""}${evidence.position} hold`
              : isLastVerified ? "Last verified hold record" : "Hold record"}
          </strong>
          <small>
            {isLastVerified
              ? "Current state unverified — confirm in DealerMail"
              : evidence.lifecycleStatus || "Status not provided"}
          </small>
        </span>
        <span className="inventory-hold-evidence__position">
          {isLastVerified ? "last verified" : evidence.position || "unclassified"}
        </span>
      </header>
      {isLastVerified ? (
        <p className="inventory-hold-evidence__stale-note" role="note">
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Every value below is from the last verified DealerMail scan. It does not confirm a current hold, release, sale, delivery, or availability.</span>
        </p>
      ) : null}
      <dl className="inventory-fact-grid inventory-fact-grid--compact inventory-hold-evidence__facts">
        <Fact label={fieldLabel("Salesperson")} emphasize>
          {evidence.salesperson || "Not provided"}
        </Fact>
        <Fact label={fieldLabel("Customer / reason")} emphasize>
          {evidence.customerOrReason || "Not provided"}
        </Fact>
        <Fact label={fieldLabel("Held by")}>{evidence.heldBy || "Not provided"}</Fact>
        <Fact label={fieldLabel("Hold date")}>{formatDate(evidence.holdDate)}</Fact>
        <Fact label={fieldLabel("Expected date")}>
          {formatDate(evidence.expectedDeliveryDate)}
        </Fact>
        <Fact label={fieldLabel("Days held")}>
          {evidence.daysHeld ?? "Not provided"}
        </Fact>
        {evidence.position === "primary" && backupCount != null ? (
          <Fact label={fieldLabel("Backup count")}>{backupCount}</Fact>
        ) : null}
      </dl>
      <div
        className="inventory-hold-evidence__flags"
        aria-label="Hold communication flags"
      >
        <span className={evidence.commentFlag ? "is-present" : undefined}>
          <MessageSquare
            size={15}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {isLastVerified ? "Last verified: " : ""}{evidence.commentFlag ? "Comments present" : "No comment flag"}
        </span>
        <span className={evidence.alertFlag ? "is-present" : undefined}>
          <Bell size={15} strokeWidth={1.75} aria-hidden="true" />
          {isLastVerified ? "Last verified: " : ""}{evidence.alertFlag ? "Alerts present" : "No alert flag"}
        </span>
      </div>
      {messages.length ? (
        <details className="inventory-hold-evidence__messages">
          <summary>
            <span>{isLastVerified ? "Last verified comments & alerts" : "Comments & alerts"}</span>
            <small>{messages.length} record{messages.length === 1 ? "" : "s"}</small>
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <div className="inventory-evidence-messages">
            {messages.map((message, index) => (
              <article
                className={message.kind === "alert" ? "is-alert" : undefined}
                key={`${evidence.id}-${message.kind}-${index}`}
              >
                <span>{message.kind === "alert" ? <Bell size={14} aria-hidden="true" /> : <MessageSquare size={14} aria-hidden="true" />}</span>
                <strong>{message.text || `${message.kind === "alert" ? "Alert" : "Comment"} text not provided`}</strong>
                <small>
                  {[
                    message.author,
                    message.timestamp ? formatDateTime(message.timestamp) : null,
                    message.metadataRaw,
                    message.spiffRaw ? `Spiff: ${message.spiffRaw}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function VehicleDocuments({ vehicle }: { vehicle: InventoryVehicle }) {
  const autoCheck = vehicle.autoCheckReport;
  const sticker = vehicle.windowSticker;
  const factoryEquipment = vehicle.factoryEquipment;
  const fordOasis = vehicle.fordOasis;
  const warrantyCheck = vehicle.warrantyCheck ?? null;
  // Ford/Lincoln coverage comes from Ford's own OASIS record; AutoCheck is Experian's
  // estimate and is the only source for off-brand trades. When both exist the OASIS
  // table leads and the AutoCheck figures stay visible underneath for comparison.
  const warrantyPrimary = warrantyCheck?.fordOasis ?? warrantyCheck?.autoCheck ?? null;
  const warrantyPrimaryIsOasis = Boolean(warrantyCheck?.fordOasis);
  const warrantySecondary = warrantyPrimaryIsOasis ? warrantyCheck?.autoCheck ?? null : null;
  const warranty = warrantyOutlook({ make: vehicle.make, year: vehicle.year, fuelType: vehicle.fuelType, engine: vehicle.engine, mileage: vehicle.mileage, inServiceDate: autoCheck?.estimatedInServiceDate ?? null, stickerWarranty: sticker?.warranty ?? [] });
  // The generic outlook is a fallback for records that predate the captured warranty channel.
  // Never show both versions of the same estimate on one vehicle.
  const showWarranty = !warrantyCheck && Boolean(autoCheck || sticker || factoryEquipment) && (warranty.termsKnown || Boolean(warranty.inService.date));
  if (!autoCheck && !sticker && !factoryEquipment && !fordOasis && !warrantyCheck && !showWarranty) return null;
  const autoCheckUrl = officialVehicleDocumentUrl(autoCheck?.url, "autocheck", vehicle.publicListing.listingUrl);
  const stickerUrl = officialVehicleDocumentUrl(sticker?.url, "window-sticker", vehicle.publicListing.listingUrl);
  const factoryEquipmentUrl = vautoFactoryEquipmentUrl(factoryEquipment?.url);
  const oasisUrl = /^(ford|lincoln)$/i.test(vehicle.make.trim()) ? fordOasisUrl(vehicle.vin) : null;
  const openRecallCount = fordOasis?.openFieldServiceActions.length ?? 0;
  // OASIS dates are Ford's printed strings; they are shown exactly as captured.
  const fordOasisFacts = fordOasis
    ? [
        fordOasis.warrantyStartDate ? { label: "Warranty start", value: fordOasis.warrantyStartDate } : null,
        fordOasis.buildDate ? { label: "Build date", value: fordOasis.buildDate } : null,
        fordOasis.releaseDate ? { label: "Release date", value: fordOasis.releaseDate } : null,
        fordOasis.monthsInService != null
          ? { label: "Months in service", value: countLabel(fordOasis.monthsInService, "month") }
          : null,
        fordOasis.saleMileage != null ? { label: "Sale mileage", value: formatMileage(fordOasis.saleMileage) } : null,
      ].filter(Boolean) as Array<{ label: string; value: string }>
    : [];
  const autoCheckScoreRange =
    autoCheck?.scoreRangeLow != null && autoCheck.scoreRangeHigh != null
      ? `${autoCheck.scoreRangeLow}–${autoCheck.scoreRangeHigh}`
      : null;
  const autoCheckFacts = autoCheck
    ? [
        autoCheck.usage ? { label: "Vehicle use", value: autoCheck.usage } : null,
        autoCheck.ownerCount != null ? {
          label: "Owners reported",
          value: `${autoCheck.ownerCount} owner${autoCheck.ownerCount === 1 ? "" : "s"}`,
        } : null,
        autoCheck.lastReportedOdometer != null ? {
          label: "Last reported odometer",
          value: `${formatMileage(autoCheck.lastReportedOdometer)}${
            autoCheck.lastReportedOdometerDate
              ? ` · ${formatDate(autoCheck.lastReportedOdometerDate)}`
              : ""
          }`,
        } : null,
        autoCheck.vehicleClass ? { label: "Vehicle class", value: autoCheck.vehicleClass } : null,
        autoCheck.assemblyCountry ? { label: "Assembly country", value: autoCheck.assemblyCountry } : null,
        autoCheck.estimatedInServiceDate ? {
          label: "Estimated in-service date",
          value: formatDate(autoCheck.estimatedInServiceDate),
        } : null,
      ].filter(Boolean) as Array<{ label: string; value: string | number }>
    : [];
  const stickerFacts = sticker
    ? [
        sticker.equipmentGroup ? { label: "Equipment group", value: sticker.equipmentGroup } : null,
        sticker.exteriorColor ? { label: "Exterior", value: sticker.exteriorColor } : null,
        sticker.interiorColor ? { label: "Interior", value: sticker.interiorColor } : null,
        sticker.engine || sticker.transmission
          ? { label: "Powertrain", value: [sticker.engine, sticker.transmission].filter(Boolean).join(" · ") }
          : null,
      ].filter(Boolean) as Array<{ label: string; value: string }>
    : [];
  const factoryEquipmentFacts = factoryEquipment
    ? [
        factoryEquipment.exteriorColor ? { label: "Exterior", value: factoryEquipment.exteriorColor } : null,
        factoryEquipment.interiorColor ? { label: "Interior", value: factoryEquipment.interiorColor } : null,
        factoryEquipment.engine || factoryEquipment.transmission || factoryEquipment.drivetrain
          ? {
              label: "Powertrain",
              value: [
                factoryEquipment.engine,
                factoryEquipment.transmission,
                factoryEquipment.drivetrain,
              ].filter(Boolean).join(" · "),
            }
          : null,
      ].filter(Boolean) as Array<{ label: string; value: string }>
    : [];
  const readOnlyNoteId = "inventory-vehicle-documents-read-only";

  return (
    <section
      className="inventory-vehicle-documents inventory-workspace-records"
      aria-label="Vehicle documents"
      data-record-count={Number(Boolean(autoCheck)) + Number(Boolean(sticker)) + Number(Boolean(factoryEquipment)) + Number(Boolean(warrantyCheck)) + Number(Boolean(fordOasis)) + Number(showWarranty)}
    >
      <header className="inventory-vehicle-documents__header">
        <span className="inventory-vehicle-documents__mark">
          <FileText size={21} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>
          <strong id="inventory-vehicle-documents-title">Vehicle records</strong>
          <small>VIN-specific source links with captured facts shown exactly as published</small>
        </span>
      </header>

      <div className="inventory-vehicle-documents__grid">
        {autoCheck ? <article
          className="inventory-vehicle-document inventory-vehicle-document--autocheck"
          data-document-kind="autocheck"
          data-source-state={autoCheck.dataState}
          data-link-state={autoCheckUrl ? "available" : "unavailable"}
        >
          <header className="inventory-vehicle-document__heading">
            <AutoCheckWordmark />
            <span className="inventory-vehicle-document__title">
              <strong>AutoCheck vehicle history</strong>
              <small>
                {autoCheck.reportRunAt
                  ? `Report run ${formatDateTime(autoCheck.reportRunAt)}`
                  : "Report run time not captured"}
              </small>
            </span>
            <DataState state={autoCheck.dataState} />
          </header>

          {autoCheck.score != null || autoCheckScoreRange ? (
            <dl className="inventory-vehicle-document__metrics" aria-label="AutoCheck score details">
              {autoCheck.score != null ? (
                <Fact label="AutoCheck score" emphasize>{autoCheck.score}</Fact>
              ) : null}
              {autoCheckScoreRange ? (
                <Fact label="Comparison range">{autoCheckScoreRange}</Fact>
              ) : null}
            </dl>
          ) : null}

          {autoCheckFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {autoCheckFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}
          {autoCheck.checks?.length ? (
            <details className="inventory-vehicle-document__disclosure">
              <summary>
                <span>History checks</span>
                <small>{autoCheck.checks.length} captured result{autoCheck.checks.length === 1 ? "" : "s"}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <div className="inventory-vehicle-document__checks" aria-label="AutoCheck at-a-glance results">
                {autoCheck.checks.map((check, index) => {
                  const tone = autoCheckResultTone(check.status);
                  return (
                    <span
                      className={`inventory-vehicle-document__check inventory-vehicle-document__check--${tone}`}
                      key={`${check.label}-${index}`}
                      data-result-tone={tone}
                    >
                      {tone === "clear" ? (
                        <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
                      ) : tone === "review" ? (
                        <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
                      ) : (
                        <CircleHelp size={15} strokeWidth={1.8} aria-hidden="true" />
                      )}
                      <span>
                        <strong>{check.label}</strong>
                        <small>{[check.status, check.detail].filter(Boolean).join(" · ") || "No result published"}</small>
                      </span>
                    </span>
                  );
                })}
              </div>
            </details>
          ) : null}
          {!autoCheckFacts.length && !autoCheck.checks?.length && autoCheck.score == null && !autoCheckScoreRange ? (
            <p className="inventory-vehicle-document__empty">The official report link is available, but no summary facts were safely captured. Open the report for its current details.</p>
          ) : null}

          {autoCheckUrl ? (
            <a
              className="inventory-button inventory-button--primary inventory-vehicle-document__link"
              href={autoCheckUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label={`Open AutoCheck report for ${vehicleDisplayName(vehicle)} in a new tab`}
              aria-describedby={readOnlyNoteId}
              data-read-only="true"
            >
              <ShieldCheck size={18} strokeWidth={1.85} aria-hidden="true" />
              Open AutoCheck report
              <ExternalLink size={16} strokeWidth={1.85} aria-hidden="true" />
            </a>
          ) : (
            <span className="inventory-vehicle-document__unavailable" role="status" aria-label="AutoCheck report unavailable">
              <XCircle size={17} strokeWidth={1.8} aria-hidden="true" />
              AutoCheck report unavailable
            </span>
          )}
        </article> : null}

        {showWarranty ? <WarrantyOutlook vehicle={vehicle} /> : null}

        {sticker ? <article
          className="inventory-vehicle-document inventory-vehicle-document--sticker"
          data-document-kind="window-sticker"
          data-source-state={sticker.dataState}
          data-link-state={stickerUrl ? "available" : "unavailable"}
        >
          <header className="inventory-vehicle-document__heading">
            <WindowStickerWordmark make={vehicle.make} />
            <span className="inventory-vehicle-document__title">
              <strong>Factory window sticker</strong>
              <small>{sticker.vehicleDescription || "Vehicle description not captured"}</small>
            </span>
            <DataState state={sticker.dataState} />
          </header>

          {sticker.totalMsrp != null || sticker.basePrice != null || sticker.totalOptions != null || sticker.destinationCharge != null ? (
            <dl className="inventory-vehicle-document__metrics inventory-vehicle-document__metrics--sticker" aria-label="Window sticker pricing">
              {sticker.totalMsrp != null ? <Fact label="Sticker MSRP" emphasize>{formatStickerMoney(sticker.totalMsrp, sticker)}</Fact> : null}
              {sticker.basePrice != null ? <Fact label="Base price">{formatStickerMoney(sticker.basePrice, sticker)}</Fact> : null}
              {sticker.totalOptions != null ? <Fact label="Total options">{formatStickerMoney(sticker.totalOptions, sticker)}</Fact> : null}
              {sticker.destinationCharge != null ? <Fact label="Destination">{formatStickerMoney(sticker.destinationCharge, sticker)}</Fact> : null}
            </dl>
          ) : null}

          {sticker.originalMarket || sticker.pricingCurrencyEvidence ? (
            <p>{[sticker.originalMarket ? `Original market: ${sticker.originalMarket}.` : null, sticker.pricingCurrencyEvidence].filter(Boolean).join(" ")}</p>
          ) : null}

          {stickerFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {stickerFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}
          {sticker.options?.length ? (
            <details className="inventory-vehicle-document__disclosure inventory-vehicle-document__options">
              <summary>
                <span>Factory options</span>
                <small>{sticker.options.length} published item{sticker.options.length === 1 ? "" : "s"}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <ul aria-label="Factory options">
                {sticker.options.map((option, index) => (
                  <li key={`${option}-${index}`}>
                    <span>{option}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {sticker.standardEquipment?.length || sticker.warranty?.length ? (
            <details className="inventory-vehicle-document__more">
              <summary>
                <span>Full factory equipment &amp; warranty</span>
                <small>{countLabel((sticker.standardEquipment?.length ?? 0) + (sticker.warranty?.length ?? 0), "published item", "published items")}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <div>
                {sticker.standardEquipment?.length ? (
                  <section aria-label="Standard factory equipment">
                    <h4>Standard equipment</h4>
                    <ul>
                      {sticker.standardEquipment.map((item, index) => (
                        <li key={`${item}-${index}`}>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {sticker.warranty?.length ? (
                  <section aria-label="Factory warranty">
                    <h4>Factory warranty</h4>
                    <ul>{sticker.warranty.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
                  </section>
                ) : null}
              </div>
            </details>
          ) : null}
          {!stickerFacts.length && !sticker.options?.length && sticker.totalMsrp == null && sticker.basePrice == null && sticker.totalOptions == null && sticker.destinationCharge == null ? (
            <p className="inventory-vehicle-document__empty">The official sticker link is available, but no configuration facts were safely captured. Open the sticker for the complete factory document.</p>
          ) : null}

          {stickerUrl ? (
            <a
              className="inventory-button inventory-button--primary inventory-vehicle-document__link"
              href={stickerUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label={`Open window sticker for ${vehicleDisplayName(vehicle)} in a new tab`}
              aria-describedby={readOnlyNoteId}
              data-read-only="true"
            >
              <FileText size={18} strokeWidth={1.85} aria-hidden="true" />
              Open window sticker
              <ExternalLink size={16} strokeWidth={1.85} aria-hidden="true" />
            </a>
          ) : (
            <span className="inventory-vehicle-document__unavailable" role="status" aria-label="Window sticker unavailable">
              <XCircle size={17} strokeWidth={1.8} aria-hidden="true" />
              Window sticker unavailable
            </span>
          )}
        </article> : null}

        {factoryEquipment ? <article
          className="inventory-vehicle-document inventory-vehicle-document--vauto"
          data-document-kind="vauto-factory-equipment"
          data-source-state={factoryEquipment.dataState}
          data-link-state={factoryEquipmentUrl ? "available" : "unavailable"}
          data-original-window-sticker="false"
        >
          <header className="inventory-vehicle-document__heading">
            <VautoFactoryEquipmentWordmark />
            <span className="inventory-vehicle-document__title">
              <strong>vAuto factory-equipment profile</strong>
              <small>{factoryEquipment.vehicleDescription || "VIN-linked equipment reference"}</small>
            </span>
            <DataState state={factoryEquipment.dataState} />
          </header>

          <div className="inventory-vehicle-document__source-note">
            <AlertTriangle size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <strong>Informational equipment label—not an original window sticker.</strong>
              <small>Use this VIN-linked fallback when an online factory sticker is unavailable. Verify the actual vehicle before promising equipment.</small>
            </span>
          </div>

          {factoryEquipment.totalMsrp != null || factoryEquipment.basePrice != null || factoryEquipment.totalOptions != null || factoryEquipment.destinationCharge != null ? (
            <dl className="inventory-vehicle-document__metrics inventory-vehicle-document__metrics--sticker" aria-label="vAuto equipment-label pricing">
              {factoryEquipment.totalMsrp != null ? <Fact label="Reference MSRP" emphasize>{formatMoney(factoryEquipment.totalMsrp)}</Fact> : null}
              {factoryEquipment.basePrice != null ? <Fact label="Base price">{formatMoney(factoryEquipment.basePrice)}</Fact> : null}
              {factoryEquipment.totalOptions != null ? <Fact label="Total options">{formatMoney(factoryEquipment.totalOptions)}</Fact> : null}
              {factoryEquipment.destinationCharge != null ? <Fact label="Destination">{formatMoney(factoryEquipment.destinationCharge)}</Fact> : null}
            </dl>
          ) : null}

          {factoryEquipmentFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {factoryEquipmentFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}

          {factoryEquipment.packages?.length ? (
            <details className="inventory-vehicle-document__disclosure inventory-vehicle-document__vauto-packages">
              <summary>
                <span>Packages &amp; priced equipment</span>
                <small>{factoryEquipment.packages.length} VIN-linked item{factoryEquipment.packages.length === 1 ? "" : "s"}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <ul aria-label="vAuto package details">
                {factoryEquipment.packages.map((item, index) => {
                  const name = [item.name, item.code ? `(${item.code})` : null].filter(Boolean).join(" ");
                  return (
                    <li key={`${name}-${index}`}>
                      <span>
                        <strong>{name}</strong>
                        {item.price != null ? <b>{formatMoney(item.price)}</b> : null}
                      </span>
                      {item.features?.length ? <small>{item.features.join(" · ")}</small> : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}

          {factoryEquipment.sections?.length ? (
            <details className="inventory-vehicle-document__more inventory-vehicle-document__vauto-sections">
              <summary>
                <span>Full equipment breakdown</span>
                <small>{countLabel(factoryEquipment.sections.reduce((total, section) => total + section.items.length, 0), "captured line", "captured lines")}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <div>
                {factoryEquipment.sections.map((section) => (
                  <section aria-label={`${section.name} equipment`} key={section.name}>
                    <h4>{section.name}</h4>
                    <ul>
                      {section.items.map((item, index) => (
                        <li key={`${section.name}-${item.label}-${index}`}>
                          <span>{item.label}</span>
                          {item.price != null ? <b>{formatMoney(item.price)}</b> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </details>
          ) : null}

          {factoryEquipment.disclaimer ? (
            <details className="inventory-vehicle-document__disclosure inventory-vehicle-document__vauto-disclaimer">
              <summary>
                <span>Source disclosure</span>
                <small>Why this differs from a Monroney label</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <p>{factoryEquipment.disclaimer}</p>
            </details>
          ) : null}

          {factoryEquipmentUrl ? (
            <a
              className="inventory-button inventory-button--primary inventory-vehicle-document__link"
              href={factoryEquipmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label={`Open vAuto factory-equipment profile for ${vehicleDisplayName(vehicle)} in a new tab`}
              aria-describedby={readOnlyNoteId}
              data-read-only="true"
            >
              <FileSearch size={18} strokeWidth={1.85} aria-hidden="true" />
              Open equipment profile
              <ExternalLink size={16} strokeWidth={1.85} aria-hidden="true" />
            </a>
          ) : (
            <span className="inventory-vehicle-document__unavailable" role="status" aria-label="vAuto equipment profile unavailable">
              <XCircle size={17} strokeWidth={1.8} aria-hidden="true" />
              Equipment profile unavailable
            </span>
          )}
        </article> : null}

        {fordOasis ? <article
          className="inventory-vehicle-document inventory-vehicle-document--oasis"
          data-document-kind="ford-oasis"
          data-source-state={fordOasis.dataState}
          data-link-state={oasisUrl ? "available" : "unavailable"}
          data-open-recall-count={openRecallCount}
        >
          <header className="inventory-vehicle-document__heading">
            <FordOasisWordmark />
            <span className="inventory-vehicle-document__title">
              <strong>Ford OASIS vehicle report</strong>
              <small>
                {[fordOasis.vehicleDescription, fordOasis.versionSeries].filter(Boolean).join(" · ") ||
                  "VIN-specific OASIS facts"}
              </small>
            </span>
            <DataState state={fordOasis.dataState} />
          </header>

          <div
            className={`inventory-vehicle-document__recalls inventory-vehicle-document__recalls--${openRecallCount ? "open" : "clear"}`}
            role="status"
            aria-label="Open recalls and field service actions"
            data-open-recall-count={openRecallCount}
          >
            {openRecallCount ? (
              <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden="true" />
            )}
            <span>
              <strong>
                {openRecallCount
                  ? countLabel(openRecallCount, "open recall / field service action", "open recalls / field service actions")
                  : "No open recalls or field service actions listed"}
              </strong>
              <small>
                {fordOasis.capturedAt
                  ? `As listed by Ford OASIS ${formatDateTime(fordOasis.capturedAt)}.`
                  : "As listed by Ford OASIS."}
                {" "}Confirm in OASIS before scheduling or promising repairs.
              </small>
            </span>
          </div>

          {openRecallCount ? (
            <ul className="inventory-vehicle-document__recall-list" aria-label="Open field service action details">
              {fordOasis.openFieldServiceActions.map((action) => (
                <li key={action.code}>
                  <b>{action.code}</b>
                  <span>{action.description || "Description not captured"}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {fordOasisFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {fordOasisFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}

          {fordOasis.warrantyCoverages.length ? (
            <details className="inventory-vehicle-document__disclosure inventory-vehicle-document__vauto-packages inventory-vehicle-document__oasis-coverages">
              <summary>
                <span>Warranty coverages</span>
                <small>{countLabel(fordOasis.warrantyCoverages.length, "coverage type")}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <ul aria-label="Ford warranty coverages">
                {fordOasis.warrantyCoverages.map((coverage, index) => (
                  <li key={`${coverage.type}-${index}`}>
                    <span>
                      <strong>{coverage.type}</strong>
                    </span>
                    {coverage.description ? <small>{coverage.description}</small> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {fordOasis.extendedCoverageExpirations.length ? (
            <details className="inventory-vehicle-document__disclosure inventory-vehicle-document__vauto-packages inventory-vehicle-document__oasis-coverages">
              <summary>
                <span>Extended service plan expirations</span>
                <small>{countLabel(fordOasis.extendedCoverageExpirations.length, "expiration date")}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <ul aria-label="Extended service plan expirations">
                {fordOasis.extendedCoverageExpirations.map((expiration, index) => (
                  <li key={`${expiration}-${index}`}>
                    <span>
                      <strong>{expiration}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {!fordOasisFacts.length && !openRecallCount && !fordOasis.warrantyCoverages.length && !fordOasis.extendedCoverageExpirations.length ? (
            <p className="inventory-vehicle-document__empty">OASIS was captured for this VIN, but no warranty or build facts were safely captured. Open OASIS for the current report.</p>
          ) : null}

          {oasisUrl ? (
            <a
              className="inventory-button inventory-button--primary inventory-vehicle-document__link"
              href={oasisUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label={`Open Ford OASIS report for ${vehicleDisplayName(vehicle)} in a new tab`}
              aria-describedby={readOnlyNoteId}
              data-read-only="true"
            >
              <BadgeCheck size={18} strokeWidth={1.85} aria-hidden="true" />
              Open OASIS
              <ExternalLink size={16} strokeWidth={1.85} aria-hidden="true" />
            </a>
          ) : (
            <span className="inventory-vehicle-document__unavailable" role="status" aria-label="Ford OASIS link unavailable">
              <XCircle size={17} strokeWidth={1.8} aria-hidden="true" />
              OASIS link unavailable
            </span>
          )}
        </article> : null}

        {warrantyCheck && warrantyPrimary ? <article
          className="inventory-vehicle-document inventory-vehicle-document--warranty"
          data-document-kind="warranty-check"
          data-source-state={warrantyCheck.dataState}
          data-warranty-source={warrantyPrimaryIsOasis ? "ford-oasis" : "autocheck"}
        >
          <header className="inventory-vehicle-document__heading">
            <span className="inventory-vehicle-document__title">
              <strong>Remaining factory warranty</strong>
              <small>
                {warrantyPrimaryIsOasis
                  ? "Ford OASIS factory record"
                  : "Experian AutoCheck estimate"}
              </small>
            </span>
            <DataState state={warrantyCheck.dataState} />
          </header>

          <dl className="inventory-vehicle-document__facts">
            {warrantyPrimaryIsOasis && warrantyCheck.fordOasis ? (
              <Fact label="In service">{warrantyCheck.fordOasis.warrantyStartDate}</Fact>
            ) : warrantyCheck.autoCheck?.inServiceDate ? (
              <Fact label="In service (est.)">{warrantyCheck.autoCheck.inServiceDate}</Fact>
            ) : null}
            {warrantyPrimaryIsOasis && warrantyCheck.fordOasis ? (
              <Fact label="Months in service">{countLabel(warrantyCheck.fordOasis.monthsInService, "month")}</Fact>
            ) : warrantyCheck.autoCheck?.inServiceAgeMonths != null ? (
              <Fact label="Months in service">{countLabel(warrantyCheck.autoCheck.inServiceAgeMonths, "month")}</Fact>
            ) : null}
            <Fact label="Figured at">{formatMileage(warrantyCheck.mileageEntered)}</Fact>
          </dl>

          <table className="inventory-vehicle-document__warranty-table" aria-label="Remaining factory warranty by coverage">
            <thead>
              <tr>
                <th scope="col">Coverage</th>
                <th scope="col">Term</th>
                <th scope="col">Miles left</th>
                <th scope="col">Time left</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {warrantyPrimary.coverages.map((coverage, index) => (
                <tr key={`${coverage.type}-${index}`} data-status={coverage.status}>
                  <th scope="row">
                    {coverage.type}
                    {coverage.note ? <small>{coverage.note}</small> : null}
                  </th>
                  <td>{coverage.termText}</td>
                  <td>{coverage.remainingMilesText}</td>
                  <td>{coverage.remainingTimeText}</td>
                  <td>
                    <span
                      className={`inventory-warranty-pill inventory-warranty-pill--${coverage.status === "ACTIVE" ? "active" : coverage.status === "EXPIRED" ? "expired" : "unknown"}`}
                    >
                      {coverage.status === "ACTIVE" ? "Active" : coverage.status === "EXPIRED" ? "Expired" : "N/A"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {warrantySecondary ? (
            <details className="inventory-vehicle-document__disclosure inventory-vehicle-document__vauto-packages">
              <summary>
                <span>AutoCheck estimate</span>
                <small>{countLabel(warrantySecondary.coverages.length, "coverage type")}</small>
                <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <ul aria-label="AutoCheck warranty estimate">
                {warrantySecondary.coverages.map((coverage, index) => (
                  <li key={`${coverage.type}-${index}`}>
                    <span>
                      <strong>{coverage.type}</strong>
                    </span>
                    <small>
                      {coverage.termText} — {coverage.remainingMilesText} / {coverage.remainingTimeText}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <p className="inventory-vehicle-document__empty">
            {warrantyPrimaryIsOasis
              ? "Ford and Lincoln factory coverage follows the vehicle to the next owner at no cost. Remaining figures are calculated from Ford's printed term against this vehicle's listed odometer."
              : "Experian estimate calculated from the best available in-service date against this vehicle's listed odometer."}
            {" "}Verify with the store before quoting coverage to a customer.
          </p>
        </article> : null}
      </div>

      <div className="inventory-vehicle-documents__disclaimer" id={readOnlyNoteId}>
        <AlertTriangle size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <strong>Documents are reference sources—not availability signals.</strong> These links are read-only. AutoCheck history, original sticker data, vAuto informational equipment data, and Ford OASIS recall and warranty facts do not confirm current condition, a hold, custody, sale, delivery, price, retail readiness, or physical availability. Confirm live status, open recalls, and installed equipment with the store.
        </span>
      </div>
    </section>
  );
}

function VehicleDetails({ vehicle }: { vehicle: InventoryVehicle }) {
  const combinedBody = vehicle.bodyStyle || vehicle.bodyType;
  const mpg =
    vehicle.mpgCity || vehicle.mpgHighway
      ? `${vehicle.mpgCity ?? "—"} city / ${vehicle.mpgHighway ?? "—"} highway`
      : "Not published";
  return (
    <div className="inventory-workspace-detail-content">
      <dl className="inventory-fact-grid">
        <Fact label="MSRP">
          {formatMoney(vehicle.msrp)}
        </Fact>
        <Fact label="Body">{combinedBody || "Not published"}</Fact>
        <Fact label="Exterior color">{vehicle.exteriorColor || "Not published"}</Fact>
        <Fact label="Interior color">{vehicle.interiorColor || "Not published"}</Fact>
        <Fact label="Drivetrain">{vehicle.drivetrain || "Not published"}</Fact>
        <Fact label="Engine">{vehicle.engine || "Not published"}</Fact>
        <Fact label="Transmission">{vehicle.transmission || "Not published"}</Fact>
        <Fact label="Fuel">{vehicle.fuelType || "Not published"}</Fact>
        <Fact label="Fuel economy">{mpg}</Fact>
        <Fact label="Certified">
          {vehicle.certified === true
            ? "Yes"
            : vehicle.certified === false
              ? "No"
              : "Not reported"}
        </Fact>
        <Fact label="Inventory date">{formatDate(vehicle.inventoryDate)}</Fact>
        <Fact label="Photos">
          {vehicle.photoCount ??
            vehicle.imageUrls?.length ??
            "Not reported"}
        </Fact>
      </dl>
      {vehicle.dealerComments ? (
        <details className="inventory-workspace-comments inventory-workspace-comments--disclosure">
          <summary>
            <span>Dealer description</span>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <p>{vehicle.dealerComments}</p>
        </details>
      ) : null}
    </div>
  );
}

type EquipmentCategoryId =
  | "safety"
  | "towing"
  | "comfort"
  | "technology"
  | "packages"
  | "upgrades"
  | "other";

type EquipmentEvidenceSource =
  | "inventory-feature"
  | "factory-option"
  | "factory-standard"
  | "equipment-group"
  | "vauto-package"
  | "vauto-informational";

interface SourceEquipmentItem {
  text: string;
  category: EquipmentCategoryId;
  sources: EquipmentEvidenceSource[];
  sourceSections: string[];
  price?: number | null;
}

interface EquipmentDisplayParts {
  label: string;
  sourceSection?: string;
}

const EQUIPMENT_CATEGORIES: Array<{ id: EquipmentCategoryId; label: string }> = [
  { id: "packages", label: "Packages & special series" },
  { id: "safety", label: "Safety & driver assist" },
  { id: "comfort", label: "Comfort" },
  { id: "technology", label: "Technology" },
  { id: "towing", label: "Towing & utility" },
  { id: "upgrades", label: "Standout upgrades" },
  { id: "other", label: "Other published equipment" },
];

const EQUIPMENT_SOURCE_LABELS: Record<EquipmentEvidenceSource, string> = {
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

function equipmentDisplayParts(text: string): EquipmentDisplayParts {
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

function sourceConfirmedEquipment(vehicle: InventoryVehicle): SourceEquipmentItem[] {
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
  add(vehicle.windowSticker?.equipmentGroup, "equipment-group", { category: "packages" });
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
    sourcePriority(left) - sourcePriority(right) || left.text.localeCompare(right.text, undefined, { numeric: true }),
  );
}

function LegacySourceConfirmedEquipment({ vehicle }: { vehicle: InventoryVehicle }) {
  const items = sourceConfirmedEquipment(vehicle);
  const sticker = vehicle.windowSticker;
  const factoryEquipment = vehicle.factoryEquipment;
  const factoryDocumentedCount = items.filter((item) =>
    item.sources.some((source) => ["factory-option", "factory-standard", "equipment-group"].includes(source)),
  ).length;
  const vautoDocumentedCount = items.filter((item) =>
    item.sources.some((source) => source.startsWith("vauto-")),
  ).length;
  const listingCoverageCount = items.filter((item) =>
    item.sources.includes("inventory-feature"),
  ).length;
  const exactSourceCount = factoryDocumentedCount + vautoDocumentedCount;
  const evidenceLabel = (item: SourceEquipmentItem) => {
    return item.sources.map((source) => EQUIPMENT_SOURCE_LABELS[source]).join(" + ");
  };
  const factoryConfigurationFacts = [
    sticker?.vehicleDescription ? { label: "Sticker vehicle", value: sticker.vehicleDescription } : null,
    sticker?.equipmentGroup ? { label: "Sticker equipment group", value: sticker.equipmentGroup } : null,
    sticker?.engine || sticker?.transmission
      ? { label: "Sticker powertrain", value: [sticker.engine, sticker.transmission].filter(Boolean).join(" · ") }
      : null,
    sticker?.exteriorColor || sticker?.interiorColor
      ? { label: "Sticker colors", value: [sticker.exteriorColor, sticker.interiorColor].filter(Boolean).join(" · ") }
      : null,
    sticker?.totalMsrp != null ? { label: "Original sticker MSRP", value: formatStickerMoney(sticker.totalMsrp, sticker) } : null,
    factoryEquipment?.vehicleDescription ? { label: "VIN profile vehicle", value: factoryEquipment.vehicleDescription } : null,
    factoryEquipment?.engine || factoryEquipment?.transmission || factoryEquipment?.drivetrain
      ? {
          label: "VIN profile powertrain",
          value: [factoryEquipment.engine, factoryEquipment.transmission, factoryEquipment.drivetrain].filter(Boolean).join(" · "),
        }
      : null,
    factoryEquipment?.totalMsrp != null ? { label: "VIN profile reference MSRP", value: formatMoney(factoryEquipment.totalMsrp) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const hasStructuredVauto = Boolean(factoryEquipment?.packages?.length || factoryEquipment?.sections?.length);
  const configurationHeading = sticker && factoryEquipment
    ? "VIN-linked configuration sources"
    : sticker
      ? "Original-sticker configuration"
      : "VIN equipment profile";
  const categorizedItems = hasStructuredVauto
    ? items.filter((item) => !item.sources.some((source) => source.startsWith("vauto-")))
    : items;
  return (
    <section
      className="inventory-workspace-equipment-evidence"
      aria-labelledby="inventory-workspace-equipment-evidence-title"
      data-content-state={items.length ? "available" : "not-published"}
      data-evidence-scope="vin-linked-published-only"
    >
      <header className="inventory-workspace-equipment-evidence__header">
        <span>
          <ShieldCheck size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <strong id="inventory-workspace-equipment-evidence-title">Equipment &amp; packages</strong>
            <small>{items.length ? `${items.length} unique VIN-linked label${items.length === 1 ? "" : "s"}` : "No VIN-linked labels captured"}</small>
          </span>
        </span>
      </header>
      <div className="inventory-workspace-equipment-coverage" data-source-depth={exactSourceCount ? "detailed" : "listing-only"}>
        {exactSourceCount ? <ShieldCheck size={17} strokeWidth={1.85} aria-hidden="true" /> : <AlertTriangle size={17} strokeWidth={1.85} aria-hidden="true" />}
        <span>
          <strong>{exactSourceCount ? "VIN-specific source detail captured" : "Factory itemization has not been captured for this VIN"}</strong>
          <small>
            {exactSourceCount
              ? `${factoryDocumentedCount} factory source-backed label${factoryDocumentedCount === 1 ? "" : "s"}${vautoDocumentedCount ? ` · ${vautoDocumentedCount} informational VIN-profile label${vautoDocumentedCount === 1 ? "" : "s"}` : ""}${listingCoverageCount ? ` · ${listingCoverageCount} online-listing label${listingCoverageCount === 1 ? "" : "s"}` : ""}`
              : `${listingCoverageCount} exact online-listing label${listingCoverageCount === 1 ? "" : "s"} shown below. These are not presented as OEM-confirmed build equipment.`}
          </small>
        </span>
      </div>
      <details className="inventory-workspace-equipment-evidence__method">
        <summary>
          <CircleHelp size={14} strokeWidth={1.8} aria-hidden="true" /> Evidence details
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
        </summary>
        <p className="inventory-workspace-equipment-evidence__note">
          Only VIN-linked items from the inventory listing, an original factory sticker, or the captured vAuto informational equipment profile are shown. Nothing is inferred from year or trim. Listing and vAuto items must be physically verified; original-sticker items document original equipment, not current condition.
        </p>
        <div className="inventory-workspace-equipment-evidence__sources" aria-label="Equipment source status">
          <span>Listing · {dataStateLabel(vehicle.publicListing.dataState)}</span>
          <span>Sticker · {vehicle.windowSticker ? dataStateLabel(vehicle.windowSticker.dataState) : "Not published"}</span>
          {vehicle.factoryEquipment ? <span>vAuto · {dataStateLabel(vehicle.factoryEquipment.dataState)}</span> : null}
        </div>
      </details>
      {factoryConfigurationFacts.length ? (
        <section className="inventory-workspace-factory-configuration" aria-labelledby="inventory-factory-configuration-title">
          <header>
            <span>
              <h4 id="inventory-factory-configuration-title">{configurationHeading}</h4>
              <small>Source values stay separate from the current public listing</small>
            </span>
            {factoryEquipment ? (
              <span className="inventory-workspace-factory-provenance">
                <b>{factoryEquipment.sourceLabel || "vAuto informational equipment"}</b>
                {factoryEquipment.capturedAt ? <small>Captured {formatDateTime(factoryEquipment.capturedAt)}</small> : null}
              </span>
            ) : null}
          </header>
          <dl>
            {factoryConfigurationFacts.map((fact) => <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>)}
          </dl>
        </section>
      ) : null}
      {hasStructuredVauto ? (
        <div className="inventory-workspace-vauto-equipment" aria-label="VIN equipment profile details">
          {factoryEquipment?.packages?.length ? (
            <section
              className="inventory-workspace-equipment-group inventory-workspace-equipment-group--source inventory-workspace-equipment-group--packages"
              id="inventory-equipment-vauto-packages"
              tabIndex={-1}
            >
              <header>
                <span>
                  <h4>VIN equipment packages</h4>
                  <small>vAuto informational profile—not an original sticker</small>
                </span>
                <span aria-label={`${factoryEquipment.packages.length} packages`}>{factoryEquipment.packages.length}</span>
              </header>
              <div className="inventory-workspace-package-list">
                {factoryEquipment.packages.map((item, index) => (
                  <article key={`${item.name}-${item.code || index}`}>
                    <header>
                      <span>
                        <strong>{item.name}</strong>
                        {item.code ? <small>Code {item.code}</small> : null}
                      </span>
                      {item.price != null ? <b>{formatMoney(item.price)}</b> : null}
                    </header>
                    {item.features?.length ? (
                      <ul>
                        {item.features.map((feature) => <li key={feature}><CheckCircle2 size={14} strokeWidth={1.8} aria-hidden="true" /><span>{feature}</span></li>)}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {factoryEquipment?.sections?.map((section, sectionIndex) => (
            <section
              className="inventory-workspace-equipment-group inventory-workspace-equipment-group--source"
              id={`inventory-equipment-vauto-section-${sectionIndex}`}
              tabIndex={-1}
              key={`${section.name}-${sectionIndex}`}
            >
              <header>
                <span>
                  <h4>{section.name}</h4>
                  <small>Exact VIN-profile section</small>
                </span>
                <span aria-label={countLabel(section.items.length, "item", "items")}>{section.items.length}</span>
              </header>
              <ul>
                {section.items.map((item, itemIndex) => {
                  const display = equipmentDisplayParts(item.label);
                  return (
                    <li
                      key={`${item.label}-${itemIndex}`}
                      title={`Source: vAuto informational equipment${display.sourceSection ? ` · OEM section: ${display.sourceSection} · Exact published label: ${item.label}` : ""}`}
                    >
                      <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
                      <span>
                        <strong aria-hidden={display.sourceSection ? "true" : undefined}>{display.label}</strong>
                        {display.sourceSection ? <span className="inventory-sr-only">{item.label}</span> : null}
                        <small className="inventory-workspace-equipment-item-source">
                          VIN equipment profile
                          {display.sourceSection ? ` · ${display.sourceSection}` : ""}
                          {item.price != null ? ` · ${formatMoney(item.price)}` : ""}
                        </small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {items.length ? (
        <div className="inventory-workspace-equipment-evidence__groups">
          {EQUIPMENT_CATEGORIES.map((category) => {
            const grouped = categorizedItems.filter((item) => item.category === category.id);
            if (!grouped.length) return null;
            return (
              <section
                className={`inventory-workspace-equipment-group inventory-workspace-equipment-group--${category.id}`}
                id={`inventory-equipment-section-${category.id}`}
                aria-labelledby={`inventory-equipment-group-${category.id}`}
                data-equipment-category={category.id}
                tabIndex={-1}
                key={category.id}
              >
                <header>
                  <h4 id={`inventory-equipment-group-${category.id}`}>{category.label}</h4>
                  <span aria-label={countLabel(grouped.length, "published item", "published items")}>{grouped.length}</span>
                </header>
                <ul>
                  {grouped.map((item) => {
                    const factoryDocumented = item.sources.some((source) =>
                      ["factory-option", "factory-standard", "equipment-group"].includes(source),
                    );
                    const vautoDocumented = item.sources.some((source) => source.startsWith("vauto-"));
                    const sourceLabel = item.sources.map((source) => EQUIPMENT_SOURCE_LABELS[source]).join(" + ");
                    const display = equipmentDisplayParts(item.text);
                    return (
                      <li
                        key={`${category.id}-${item.text}`}
                        title={`Source: ${sourceLabel}${display.sourceSection ? ` · OEM section: ${display.sourceSection} · Exact published label: ${item.text}` : ""}`}
                        data-evidence-strength={factoryDocumented ? "factory-document" : vautoDocumented ? "vauto-informational" : "published-listing"}
                      >
                        <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
                        <span>
                          <strong aria-hidden={display.sourceSection ? "true" : undefined}>{display.label}</strong>
                          {display.sourceSection ? <span className="inventory-sr-only">{item.text}</span> : null}
                          <small className="inventory-workspace-equipment-item-source" title={sourceLabel}>
                            {evidenceLabel(item)}{display.sourceSection ? ` · ${display.sourceSection}` : ""}
                          </small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="inventory-workspace-equipment-evidence__empty" role="status">
          <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>Equipment not published for this VIN</strong>
            <small>No inventory feature list, original sticker line, or vAuto informational equipment line was captured.</small>
          </span>
        </div>
      )}
    </section>
  );
}

function LegacyEquipmentCategoryIndex({ vehicle }: { vehicle: InventoryVehicle }) {
  const items = sourceConfirmedEquipment(vehicle);
  const hasStructuredVauto = Boolean(
    vehicle.factoryEquipment?.packages?.length || vehicle.factoryEquipment?.sections?.length,
  );
  const categorizedItems = hasStructuredVauto
    ? items.filter((item) => !item.sources.some((source) => source.startsWith("vauto-")))
    : items;
  const entries = [
    ...(vehicle.factoryEquipment?.packages?.length
      ? [{ id: "inventory-equipment-vauto-packages", label: "VIN packages", count: vehicle.factoryEquipment.packages.length }]
      : []),
    ...(vehicle.factoryEquipment?.sections?.map((section, index) => ({
      id: `inventory-equipment-vauto-section-${index}`,
      label: section.name,
      count: section.items.length,
    })) ?? []),
    ...EQUIPMENT_CATEGORIES.map((category) => ({
      id: `inventory-equipment-section-${category.id}`,
      label: category.label,
      count: categorizedItems.filter((item) => item.category === category.id).length,
    })).filter((entry) => entry.count > 0),
  ];

  if (!entries.length) return null;

  return (
    <nav className="inventory-workspace-equipment-index" aria-label="Equipment sections on this vehicle">
      <header>
        <strong>On this vehicle</strong>
        <small>Jump directly to an equipment section</small>
      </header>
      <div>
        {entries.map((entry) => (
          <button
            type="button"
            aria-label={`Jump to ${entry.label}, ${entry.count} item${entry.count === 1 ? "" : "s"}`}
            onClick={() => {
              const target = document.getElementById(entry.id);
              if (!target) return;
              target.focus({ preventScroll: true });
              target.scrollIntoView?.({ behavior: workspaceScrollBehavior(), block: "start" });
            }}
            key={entry.id}
          >
            <span>{entry.label}</span>
            <b>{entry.count}</b>
          </button>
        ))}
      </div>
    </nav>
  );
}

function equipmentEvidenceLabel(item: SourceEquipmentItem): string {
  return [...new Set(item.sources.map((source) => EQUIPMENT_SOURCE_LABELS[source]))].join(" + ");
}

function equipmentCategoryIcon(category: EquipmentCategoryId): ReactNode {
  switch (category) {
    case "packages":
      return <BadgeCheck size={17} strokeWidth={1.8} aria-hidden="true" />;
    case "safety":
      return <ShieldCheck size={17} strokeWidth={1.8} aria-hidden="true" />;
    case "technology":
      return <Gauge size={17} strokeWidth={1.8} aria-hidden="true" />;
    case "comfort":
      return <CarFront size={17} strokeWidth={1.8} aria-hidden="true" />;
    case "towing":
      return <Truck size={17} strokeWidth={1.8} aria-hidden="true" />;
    case "upgrades":
      return <Tag size={17} strokeWidth={1.8} aria-hidden="true" />;
    default:
      return <FileText size={17} strokeWidth={1.8} aria-hidden="true" />;
  }
}

function EquipmentLedgerGroup({
  category,
  items,
  vehicleId,
}: {
  category: (typeof EQUIPMENT_CATEGORIES)[number];
  items: SourceEquipmentItem[];
  vehicleId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewCount = 5;
  const hasMore = items.length > previewCount;

  useEffect(() => setExpanded(false), [vehicleId, category.id]);

  return (
    <section
      className={`inventory-workspace-equipment-group inventory-workspace-equipment-group--${category.id}`}
      id={`inventory-equipment-section-${category.id}`}
      aria-labelledby={`inventory-equipment-group-${category.id}`}
      data-equipment-category={category.id}
      tabIndex={-1}
    >
      <header>
        <span className="inventory-workspace-equipment-group__title">
          {equipmentCategoryIcon(category.id)}
          <span>
            <h4 id={`inventory-equipment-group-${category.id}`}>{category.label}</h4>
            <small>{countLabel(items.length, "documented item", "documented items")}</small>
          </span>
        </span>
        <b aria-hidden="true">{items.length}</b>
      </header>
      <ul id={`inventory-equipment-list-${category.id}`}>
        {items.map((item, index) => {
          const display = equipmentDisplayParts(item.text);
          const sourceLabel = equipmentEvidenceLabel(item);
          const sourceSections = [...new Set([
            ...(display.sourceSection ? [display.sourceSection] : []),
            ...item.sourceSections,
          ])];
          const factoryDocumented = item.sources.some((source) =>
            ["factory-option", "factory-standard", "equipment-group"].includes(source),
          );
          const profileDocumented = item.sources.some((source) => source.startsWith("vauto-"));

          return (
            <li
              key={`${category.id}-${item.text}`}
              title={`Source: ${sourceLabel}${sourceSections.length ? ` · Section: ${sourceSections.join(" / ")}` : ""}${display.sourceSection ? ` · Exact published label: ${item.text}` : ""}`}
              data-evidence-strength={factoryDocumented ? "factory-document" : profileDocumented ? "vin-profile" : "published-listing"}
              hidden={!expanded && index >= previewCount}
            >
              <span className="inventory-workspace-equipment-item__copy">
                <strong aria-hidden={display.sourceSection ? "true" : undefined}>{display.label}</strong>
                {display.sourceSection ? <span className="inventory-sr-only">{item.text}</span> : null}
                <small className="inventory-workspace-equipment-item-source">
                  {sourceLabel}{sourceSections.length ? ` · ${sourceSections.join(" / ")}` : ""}
                </small>
              </span>
              <span className="inventory-workspace-equipment-item__value">
                {item.price != null ? formatMoney(item.price) : factoryDocumented ? "Included" : "Published"}
              </span>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <button
          type="button"
          className="inventory-workspace-equipment-group__toggle"
          aria-expanded={expanded}
          aria-controls={`inventory-equipment-list-${category.id}`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `Show all ${items.length} items`}
          <ChevronDown size={15} strokeWidth={1.9} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

function SourceConfirmedEquipment({ vehicle }: { vehicle: InventoryVehicle }) {
  const items = sourceConfirmedEquipment(vehicle);
  const sticker = vehicle.windowSticker;
  const profile = vehicle.factoryEquipment;
  const factoryDocumentedCount = items.filter((item) =>
    item.sources.some((source) => ["factory-option", "factory-standard", "equipment-group"].includes(source)),
  ).length;
  const profileDocumentedCount = items.filter((item) =>
    item.sources.some((source) => source.startsWith("vauto-")),
  ).length;
  const listingCoverageCount = items.filter((item) => item.sources.includes("inventory-feature")).length;
  const exactSourceCount = factoryDocumentedCount + profileDocumentedCount;
  const configurationHeading = sticker && profile
    ? "VIN-linked configuration sources"
    : sticker
      ? "Original-sticker configuration"
      : "VIN equipment profile";
  const configurationFacts = [
    sticker?.vehicleDescription
      ? { label: "Sticker vehicle", value: sticker.vehicleDescription, source: "Original window sticker" }
      : null,
    sticker?.equipmentGroup
      ? { label: "Equipment group", value: sticker.equipmentGroup, source: "Original window sticker" }
      : null,
    sticker?.engine || sticker?.transmission
      ? { label: "Sticker powertrain", value: [sticker.engine, sticker.transmission].filter(Boolean).join(" · "), source: "Original window sticker" }
      : null,
    sticker?.exteriorColor
      ? { label: "Exterior", value: sticker.exteriorColor, source: "Original window sticker" }
      : null,
    sticker?.interiorColor
      ? { label: "Interior", value: sticker.interiorColor, source: "Original window sticker" }
      : null,
    sticker?.totalMsrp != null
      ? { label: "Original MSRP", value: formatStickerMoney(sticker.totalMsrp, sticker), source: "Original window sticker" }
      : null,
    profile?.vehicleDescription
      ? { label: "Profile vehicle", value: profile.vehicleDescription, source: "VIN equipment profile" }
      : null,
    profile?.engine || profile?.transmission || profile?.drivetrain
      ? { label: "Profile powertrain", value: [profile.engine, profile.transmission, profile.drivetrain].filter(Boolean).join(" · "), source: "VIN equipment profile" }
      : null,
    profile?.exteriorColor
      ? { label: "Profile exterior", value: profile.exteriorColor, source: "VIN equipment profile" }
      : null,
    profile?.interiorColor
      ? { label: "Profile interior", value: profile.interiorColor, source: "VIN equipment profile" }
      : null,
    profile?.totalMsrp != null
      ? { label: "Reference MSRP", value: formatMoney(profile.totalMsrp), source: "VIN equipment profile" }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string; source: string }>;

  return (
    <section
      className="inventory-workspace-equipment-evidence inventory-workspace-equipment-evidence--v10"
      id="inventory-equipment-all"
      aria-labelledby="inventory-workspace-equipment-evidence-title"
      data-content-state={items.length ? "available" : "not-published"}
      data-evidence-scope="vin-linked-published-only"
    >
      <header className="inventory-workspace-equipment-evidence__header">
        <span>
          <ShieldCheck size={20} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <strong id="inventory-workspace-equipment-evidence-title">Equipment &amp; packages</strong>
            <small>{items.length ? `${items.length} VIN-linked items, organized for quick customer questions` : "No VIN-linked equipment captured"}</small>
          </span>
        </span>
      </header>

      <div className="inventory-workspace-equipment-source-summary" data-source-depth={exactSourceCount ? "detailed" : "listing-only"}>
        <span>
          <strong>{exactSourceCount ? "VIN-specific equipment detail is available" : "Factory itemization has not been captured"}</strong>
          <small>
            {exactSourceCount
              ? `${factoryDocumentedCount} original-sticker item${factoryDocumentedCount === 1 ? "" : "s"} · ${profileDocumentedCount} VIN-profile item${profileDocumentedCount === 1 ? "" : "s"} · ${listingCoverageCount} published-listing item${listingCoverageCount === 1 ? "" : "s"}`
              : `${listingCoverageCount} published-listing item${listingCoverageCount === 1 ? "" : "s"}; verify installed equipment on the vehicle.`}
          </small>
        </span>
      </div>

      {configurationFacts.length ? (
        <details
          className="inventory-workspace-factory-configuration inventory-workspace-factory-configuration--v10"
          id="inventory-equipment-configuration"
          aria-labelledby="inventory-build-details-label"
          tabIndex={-1}
          key={vehicle.id}
        >
          <summary>
            <span id="inventory-build-details-label">Original build details</span>
            <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <header>
            <span>
              <h4 id="inventory-factory-configuration-title">{configurationHeading}</h4>
              <small>Original source values are kept separate from the current vehicle listing.</small>
            </span>
          </header>
          <dl>
            {configurationFacts.map((fact, index) => (
              <div className="inventory-workspace-configuration-fact" key={`${fact.label}-${fact.value}-${index}`}>
                <dt>{fact.label}<small>{fact.source}</small></dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {items.length ? (
        <div className="inventory-workspace-equipment-evidence__groups" aria-label="Equipment organized by category">
          {EQUIPMENT_CATEGORIES.map((category) => {
            const grouped = items.filter((item) => item.category === category.id);
            if (!grouped.length) return null;
            return (
              <EquipmentLedgerGroup
                category={category}
                items={grouped}
                vehicleId={vehicle.id}
                key={`${vehicle.id}-${category.id}`}
              />
            );
          })}
        </div>
      ) : (
        <div className="inventory-workspace-equipment-evidence__empty" role="status">
          <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>Equipment not published for this VIN</strong>
            <small>No inventory feature list, original sticker item, or VIN equipment profile item was captured.</small>
          </span>
        </div>
      )}

      <details className="inventory-workspace-equipment-evidence__method">
        <summary>
          <CircleHelp size={15} strokeWidth={1.8} aria-hidden="true" />
          How this equipment was sourced
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        </summary>
        <p className="inventory-workspace-equipment-evidence__note">
          Only VIN-linked items from the published vehicle listing, an original factory window sticker, or a captured informational VIN equipment profile are shown. Nothing is inferred from year or trim. Published-listing and VIN-profile items must be physically verified; original-sticker items document original equipment, not current condition.
        </p>
        <div className="inventory-workspace-equipment-evidence__sources" aria-label="Equipment source status">
          <span>Published listing · {dataStateLabel(vehicle.publicListing.dataState)}</span>
          <span>Original sticker · {sticker ? dataStateLabel(sticker.dataState) : "Not published"}</span>
          {profile ? <span>VIN profile · {dataStateLabel(profile.dataState)}</span> : null}
        </div>
      </details>
    </section>
  );
}

function EquipmentCategoryIndex({ vehicle }: { vehicle: InventoryVehicle }) {
  const items = sourceConfirmedEquipment(vehicle);
  const hasConfiguration = Boolean(
    vehicle.windowSticker?.vehicleDescription ||
    vehicle.windowSticker?.equipmentGroup ||
    vehicle.windowSticker?.engine ||
    vehicle.windowSticker?.transmission ||
    vehicle.windowSticker?.exteriorColor ||
    vehicle.windowSticker?.interiorColor ||
    vehicle.windowSticker?.totalMsrp != null ||
    vehicle.factoryEquipment?.vehicleDescription ||
    vehicle.factoryEquipment?.engine ||
    vehicle.factoryEquipment?.transmission ||
    vehicle.factoryEquipment?.drivetrain ||
    vehicle.factoryEquipment?.exteriorColor ||
    vehicle.factoryEquipment?.interiorColor ||
    vehicle.factoryEquipment?.totalMsrp != null
  );
  const entries = [
    ...(hasConfiguration
      ? [{ id: "inventory-equipment-configuration", label: "Original build details", count: null }]
      : []),
    ...EQUIPMENT_CATEGORIES.map((category) => ({
      id: `inventory-equipment-section-${category.id}`,
      label: category.label,
      count: items.filter((item) => item.category === category.id).length,
    })).filter((entry) => entry.count > 0),
  ];

  if (!entries.length) return null;

  return (
    <nav className="inventory-workspace-equipment-index inventory-workspace-equipment-index--v10" aria-label="Equipment sections on this vehicle">
      <header>
        <strong>Browse equipment</strong>
        <small>{countLabel(items.length, "VIN-linked item", "VIN-linked items")}</small>
      </header>
      <div>
        {entries.map((entry) => (
          <button
            type="button"
            aria-label={`Jump to ${entry.label}${entry.count == null ? "" : `, ${entry.count} item${entry.count === 1 ? "" : "s"}`}`}
            onClick={() => {
              const target = document.getElementById(entry.id);
              if (!target) return;
              if (target instanceof HTMLDetailsElement) target.open = true;
              target.focus({ preventScroll: true });
              target.scrollIntoView?.({ behavior: workspaceScrollBehavior(), block: "start" });
            }}
            key={entry.id}
          >
            <span>{entry.label}</span>
            {entry.count != null ? <b>{entry.count}</b> : null}
          </button>
        ))}
      </div>
      <p>Original names are preserved. Verify installed equipment and current condition with the vehicle.</p>
    </nav>
  );
}

function VehicleIntelligence({ vehicle }: { vehicle: InventoryVehicle }) {
  const body = vehicle.bodyStyle || vehicle.bodyType;
  const photoCount = vehicle.photoCount ?? vehicle.imageUrls?.length;
  const fuelEconomy =
    vehicle.mpgCity != null || vehicle.mpgHighway != null
      ? `${vehicle.mpgCity ?? "—"} city / ${vehicle.mpgHighway ?? "—"} highway`
      : null;
  const facts = [
    vehicle.trim ? { label: "Trim", value: vehicle.trim, copyText: null } : null,
    body ? { label: "Body", value: body, copyText: null } : null,
    vehicle.modelCode ? { label: "Model code", value: vehicle.modelCode, copyText: vehicle.modelCode } : null,
    vehicle.drivetrain ? { label: "Drivetrain", value: vehicle.drivetrain, copyText: vehicle.drivetrain } : null,
    vehicle.exteriorColor ? { label: "Exterior", value: vehicle.exteriorColor, copyText: vehicle.exteriorColor } : null,
    vehicle.certified != null ? { label: "Certified", value: vehicle.certified ? "Yes" : "No", copyText: null } : null,
    vehicle.engine ? { label: "Engine", value: vehicle.engine, copyText: vehicle.engine } : null,
    vehicle.interiorColor ? { label: "Interior", value: vehicle.interiorColor, copyText: vehicle.interiorColor } : null,
    photoCount != null ? { label: "Photo count", value: photoCount, copyText: null } : null,
    vehicle.transmission ? { label: "Transmission", value: vehicle.transmission, copyText: vehicle.transmission } : null,
    fuelEconomy ? { label: "Fuel economy", value: fuelEconomy, copyText: null } : null,
    vehicle.fuelType ? { label: "Fuel", value: vehicle.fuelType, copyText: null } : null,
    vehicle.msrp != null ? { label: "MSRP", value: formatMoney(vehicle.msrp), copyText: String(vehicle.msrp) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string | number; copyText: string | null }>;

  return (
    <section
      className="inventory-workspace-intelligence"
      aria-labelledby="inventory-workspace-intelligence-title"
      data-content-state={facts.length ? "available" : "empty"}
    >
      <header className="inventory-workspace-section-heading">
        <Gauge size={18} strokeWidth={1.75} aria-hidden="true" />
        <h3 id="inventory-workspace-intelligence-title">Key specifications</h3>
      </header>
      {facts.length ? (
        <dl className="inventory-workspace-intelligence__facts">
          {facts.map((fact) => (
            <Fact label={fact.label} key={fact.label}>
              {fact.value}
            </Fact>
          ))}
        </dl>
      ) : (
        <p className="inventory-workspace-section-note">No additional specification facts were published.</p>
      )}
    </section>
  );
}


function OverviewDetails({
  vehicle,
  onOpenRecords,
  onOpenEquipment,
}: {
  vehicle: InventoryVehicle;
  onOpenRecords?: () => void;
  onOpenEquipment?: () => void;
}) {
  const description = vehicle.dealerComments || "No vehicle description was published.";
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const autoCheck = vehicle.autoCheckReport;
  const sticker = vehicle.windowSticker;
  const warrantyLine = warrantySummary(warrantyOutlook({ make: vehicle.make, year: vehicle.year, fuelType: vehicle.fuelType, engine: vehicle.engine, mileage: vehicle.mileage, inServiceDate: autoCheck?.estimatedInServiceDate ?? null }));
  const autoCheckScoreRange =
    autoCheck?.scoreRangeLow != null && autoCheck.scoreRangeHigh != null
      ? `${autoCheck.scoreRangeLow}–${autoCheck.scoreRangeHigh}`
      : null;
  const keyFacts = [
    autoCheck?.score != null ? {
      label: "AutoCheck score",
      value: `${autoCheck.score}${autoCheckScoreRange ? ` · range ${autoCheckScoreRange}` : ""}`,
    } : null,
    autoCheck?.ownerCount != null ? {
      label: "AutoCheck owners",
      value: `${autoCheck.ownerCount} reported`,
    } : null,
    autoCheck?.usage ? { label: "AutoCheck vehicle use", value: autoCheck.usage } : null,
    autoCheck?.lastReportedOdometer != null ? {
      label: "AutoCheck odometer",
      value: `${formatMileage(autoCheck.lastReportedOdometer)}${autoCheck.lastReportedOdometerDate ? ` · ${formatDate(autoCheck.lastReportedOdometerDate)}` : ""}`,
    } : null,
    sticker?.totalMsrp != null ? { label: "Sticker MSRP", value: formatStickerMoney(sticker.totalMsrp, sticker) } : null,
    sticker?.equipmentGroup ? { label: "Sticker equipment group", value: sticker.equipmentGroup } : null,
    sticker?.options?.length ? {
      label: "Sticker options",
      value: `${sticker.options.length} published`,
    } : null,
    sticker?.standardEquipment?.length ? {
      label: "Sticker standard equipment",
      value: `${sticker.standardEquipment.length} published`,
    } : null,
    autoCheck?.estimatedInServiceDate ? {
      label: "In service (AutoCheck est.)",
      value: formatDate(autoCheck.estimatedInServiceDate),
    } : null,
    warrantyLine ? { label: "Factory warranty left", value: warrantyLine } : null,
    autoCheck?.assemblyCountry ? { label: "AutoCheck assembly", value: autoCheck.assemblyCountry } : null,
  ].filter(Boolean).slice(0, 8) as Array<{ label: string; value: string }>;
  const standoutItems = standoutEquipment(vehicle, 8);
  const highlights = standoutItems.length
    ? standoutItems.map((item) => item.label)
    : vehicle.features?.slice(0, 8) ?? [];
  const descriptionCanExpand = description.length > 380;

  useEffect(() => setDescriptionExpanded(false), [vehicle.id]);

  return (
    <div className="inventory-workspace-overview-panel">
      <section className="inventory-workspace-overview-panel__description" aria-labelledby="inventory-overview-description-title">
        <h3 id="inventory-overview-description-title">Description</h3>
        <p
          id="inventory-overview-description-copy"
          className={descriptionCanExpand ? (descriptionExpanded ? "is-collapsible is-expanded" : "is-collapsible") : undefined}
        >
          {description}
        </p>
        {descriptionCanExpand ? (
          <button
            type="button"
            className="inventory-overview-description-toggle"
            aria-expanded={descriptionExpanded}
            aria-controls="inventory-overview-description-copy"
            onClick={() => setDescriptionExpanded((current) => !current)}
          >
            <span>{descriptionExpanded ? "Show less" : "Read full description"}</span>
            <ChevronDown size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
        <div className="inventory-availability-note inventory-availability-note--compact">
          <AlertTriangle size={17} strokeWidth={1.75} aria-hidden="true" />
          <span><strong>Confirm with the home store before promising availability.</strong></span>
        </div>
      </section>
      <section className="inventory-workspace-overview-panel__highlights" aria-labelledby="inventory-overview-highlights-title">
        <header className="inventory-workspace-overview-panel__facts-heading">
          <h3 id="inventory-overview-highlights-title">Equipment highlights</h3>
          {onOpenEquipment ? <button type="button" onClick={onOpenEquipment}>View all equipment <ChevronRight size={14} aria-hidden="true" /></button> : null}
        </header>
        {highlights.length ? (
          <ul>
            {highlights.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        ) : (
          <p>No feature highlights were published.</p>
        )}
      </section>
      <section className="inventory-workspace-overview-panel__facts" aria-labelledby="inventory-overview-facts-title">
        <header className="inventory-workspace-overview-panel__facts-heading">
          <span>
            <h3 id="inventory-overview-facts-title">Vehicle record snapshot</h3>
            <small>AutoCheck and factory-sticker values stay source-labeled</small>
          </span>
          {onOpenRecords ? (
            <button type="button" onClick={onOpenRecords}>
              Full records <ChevronRight size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : null}
        </header>
        {keyFacts.length ? (
          <dl>
            {keyFacts.map((fact) => <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>)}
          </dl>
        ) : (
          <p>No additional AutoCheck or factory-sticker facts were captured.</p>
        )}
      </section>
    </div>
  );
}

function VehicleRecordEvidence({ vehicle }: { vehicle: InventoryVehicle }) {
  const evidence = vehicle.dealerMailEvidence;
  if (!vehicle.dealerMail.canViewEvidence || !evidence) return null;
  const messages = vehicle.holdEvidence?.length ? [] : [
    ...evidence.alerts.map((message) => ({ ...message, kind: "Alert" })),
    ...evidence.comments.map((message) => ({ ...message, kind: "Comment" })),
  ];
  if (!messages.length && !evidence.history.length) return null;
  const stale = evidence.dataState !== "current";
  return (
    <section className="inventory-hold-evidence" aria-label="Vehicle notes and previous holds">
      {messages.length ? <>
        <header><strong>{stale ? "Last verified vehicle comments & alerts" : "Vehicle comments & alerts"}</strong></header>
        <div className="inventory-evidence-messages">
          {messages.map((message, index) => (
            <article className={message.kind === "Alert" ? "is-alert" : undefined} key={`${message.kind}-${index}`}>
              <span>{message.kind === "Alert" ? <Bell size={14} aria-hidden="true" /> : <MessageSquare size={14} aria-hidden="true" />}</span>
              <strong>{message.text}</strong>
              <small>{[message.kind, message.author, message.timestamp, message.metadataRaw, message.spiffRaw ? `Spiff: ${message.spiffRaw}` : null].filter(Boolean).join(" · ")}</small>
            </article>
          ))}
        </div>
      </> : null}
      {evidence.history.length ? (
        <details className="inventory-hold-evidence__messages">
          <summary><span>Previous hold records</span><small>{evidence.history.length} records · not current holds</small><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="inventory-evidence-messages">
            {evidence.history.map((record, index) => (
              <article key={`history-${index}`}>
                <span><History size={14} aria-hidden="true" /></span>
                <strong>{record.customerOrReason || "Reason not recorded"}</strong>
                <small>{[record.statusLabel, record.salesperson, record.holdDate && `Hold ${record.holdDate}`, record.expectedDate && `Expected ${record.expectedDate}`, record.orderRaw && `Raw order: ${record.orderRaw}`].filter(Boolean).join(" · ")}</small>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function HoldDetails({ vehicle }: { vehicle: InventoryVehicle }) {
  const hold = vehicle.dealerMail;
  const showingLastVerifiedEvidence = hold.dataState === "stale";
  if (!hold.canViewEvidence) {
    return (
      <div className="inventory-workspace-empty inventory-workspace-empty--compact">
        <FileSearch size={24} strokeWidth={1.75} aria-hidden="true" />
        <h3>Hold details are restricted</h3>
        <p>
          {hold.redactionReason ||
            "Your role does not include customer and hold details."}
        </p>
        <DataState state={hold.dataState} />
      </div>
    );
  }

  if (!vehicle.holdEvidence?.length) {
    const currentLocation = resolveCurrentLocation(vehicle);
    const publicListingValue =
      vehicle.publicListing.dataState !== "current"
        ? "Listing status unverified"
        : vehicle.publicListing.isListed === true
          ? "Listed online"
          : vehicle.publicListing.isListed === false
            ? "Not listed online"
            : "Listing state not provided";
    const publicListingDetail = [
      vehicle.publicListing.websiteStatus?.trim()
        ? `Website status: ${vehicle.publicListing.websiteStatus.trim()}`
        : null,
      dataStateLabel(vehicle.publicListing.dataState),
    ]
      .filter(Boolean)
      .join(" · ");
    const movementValue =
      humanizeWorkflowValue(vehicle.movement?.state) ||
      humanizeWorkflowValue(vehicle.movement?.requestStatus) ||
      "No movement record";
    const movementDetail = vehicle.movement
      ? vehicle.movement.nextAction?.trim()
        ? `Next: ${vehicle.movement.nextAction.trim()}`
        : vehicle.movement.lastEventLabel?.trim() ||
          (vehicle.movement.lastEventAt
            ? `Last event ${formatDateTime(vehicle.movement.lastEventAt)}`
            : "No next movement action is recorded")
      : "No transport workflow is attached";
    const noCurrentHold =
      hold.dataState === "current" && hold.hasActiveHold === false;

    return (
      <>
      <section
        className="inventory-workspace-no-hold"
        aria-labelledby="inventory-no-hold-title"
      >
        <header className="inventory-workspace-no-hold__header">
          <span className="inventory-workspace-no-hold__mark">
            <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="inventory-workspace-no-hold__heading">
            <h3 id="inventory-no-hold-title">
              {noCurrentHold
                ? "No current DealerMail hold found"
                : "Hold details were not supplied"}
            </h3>
            <p>DealerMail hold evidence is shown separately from availability.</p>
          </span>
          <DataState state={hold.dataState} />
        </header>
        <dl className="inventory-workspace-no-hold__facts">
          <Fact label="DealerMail hold check" emphasize>
            {noCurrentHold
              ? "No active hold row found"
              : "Current hold state not verified"}
          </Fact>
          <Fact label="Hold source checked">
            <span className="inventory-workspace-no-hold__fact-stack">
              <strong>{formatDateTime(hold.updatedAt)}</strong>
              <small>{dataStateLabel(hold.dataState)} DealerMail data</small>
            </span>
          </Fact>
          <Fact label="Home store">{vehicle.location.homeStore.name}</Fact>
          <Fact label="Current location">
            <span className="inventory-workspace-no-hold__fact-stack">
              <strong>{currentLocation.label}</strong>
              <small>{currentLocation.detail}</small>
            </span>
          </Fact>
          <Fact label="Online listing">
            <span className="inventory-workspace-no-hold__fact-stack">
              <strong>{publicListingValue}</strong>
              <small>{publicListingDetail}</small>
            </span>
          </Fact>
          <Fact label="Movement">
            <span className="inventory-workspace-no-hold__fact-stack">
              <strong>{movementValue}</strong>
              <small>{movementDetail}</small>
            </span>
          </Fact>
        </dl>
        <p
          className="inventory-workspace-no-hold__caveat"
          id="inventory-hold-availability-caveat"
        >
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>
            No current hold means only that no active DealerMail hold row was
            found. Confirm customer availability and physical custody with the
            home store.
          </span>
        </p>
      </section>
      <VehicleRecordEvidence vehicle={vehicle} />
      </>
    );
  }

  const heldLocation = resolveCurrentLocation(vehicle);
  const heldPublicListing =
    vehicle.publicListing.dataState !== "current"
      ? "Listing unverified"
      : vehicle.publicListing.isListed === true
        ? "Listed online"
        : vehicle.publicListing.isListed === false
          ? "Not listed online"
          : "Listing state not provided";
  const heldMovement =
    humanizeWorkflowValue(vehicle.movement?.state) ||
    humanizeWorkflowValue(vehicle.movement?.requestStatus) ||
    "No movement record";

  return (
    <div className="inventory-hold-evidence-list">
      <h3 className="inventory-workspace-mobile-section-title">Hold details</h3>
      <p
        className="inventory-workspace-section-note"
        id="inventory-hold-availability-caveat"
      >
        {showingLastVerifiedEvidence
          ? "Last-verified DealerMail evidence is preserved below because the current hold state is unverified. Confirm the exact live record before any availability decision."
          : "Hold position, operational reason, CDK status, paperwork, and delivery are separate. A hold alone does not mean sold or delivered."}
      </p>
      {vehicle.holdEvidence.map((evidence) => (
        <HoldEvidenceRecord
          evidence={evidence}
          backupCount={Math.max(0, vehicle.holdEvidence!.length - 1)}
          key={evidence.id}
        />
      ))}
      <VehicleRecordEvidence vehicle={vehicle} />
      <dl
        className="inventory-workspace-hold-context"
        aria-label="Related inventory and movement status"
      >
        <Fact label="Home store">{vehicle.location.homeStore.name}</Fact>
        <Fact label="Current location">{heldLocation.label}</Fact>
        <Fact label="Online listing">{heldPublicListing}</Fact>
        <Fact label="Movement">{heldMovement}</Fact>
      </dl>
    </div>
  );
}

function MovementDetails({ vehicle }: { vehicle: InventoryVehicle }) {
  const movement = vehicle.movement;
  const location = vehicle.location;
  const current = resolveCurrentLocation(vehicle);
  const withheld = movement?.withheld === true;
  const withheldText = "Withheld for your role or store";
  // The server says a new request would be refused, yet this role or store
  // sees no move to explain it: a request it may not see is open somewhere.
  const blockedUnseen = vehicle.moveRequestBlocked === true && !movement?.requestId;
  return (
    <div className="inventory-workspace-detail-content">
      {blockedUnseen ? (
        <div className="inventory-availability-note inventory-availability-note--compact">
          <Truck size={17} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>The app already has an open move request for this vehicle.</strong>{" "}
            A new request is not offered until it closes.
          </span>
        </div>
      ) : null}
      {withheld ? (
        <div className="inventory-availability-note inventory-availability-note--compact">
          <Navigation size={17} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>Move details are limited to the stores involved.</strong>{" "}
            The location and status shown are still the app&apos;s own record.
          </span>
        </div>
      ) : null}
      {location.conflict ? (
        <div className="inventory-availability-note inventory-availability-note--danger">
          <AlertTriangle size={17} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>Location information conflicts.</strong> A manager should
            confirm custody and current location.
          </span>
        </div>
      ) : null}
      <div className="inventory-current-location">
        {current.provenance === "app-confirmed" ? (
          <Navigation size={17} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <MapPin size={17} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span>
          <strong>{current.label}</strong>
          <small>{current.detail}</small>
        </span>
        {sameStore(current.store, location.homeStore) ? (
          <span className="inventory-location-badge">Home store</span>
        ) : null}
      </div>
      <dl className="inventory-fact-grid">
        <Fact label="Home store">{location.homeStore.name}</Fact>
        <Fact label="App-confirmed location">
          {location.conflict
            ? "Location needs checking"
            : location.appConfirmedLocation ||
              location.appConfirmedStore?.name ||
              "Not confirmed"}
        </Fact>
        <Fact label="Last confirmed">
          {formatDateTime(location.appConfirmedAt)}
        </Fact>
        <Fact label="Confirmed by">
          {location.appConfirmedBy || (withheld ? withheldText : "Not recorded")}
        </Fact>
        <Fact label="Custodian">
          {movement?.custodian || location.custodian || (withheld ? withheldText : "Not assigned")}
        </Fact>
        <Fact label="Driver">
          {movement?.transportAssignee ||
            location.transportAssignee ||
            (withheld ? withheldText : "Not set up")}
        </Fact>
      </dl>
      {movement ? (
        <>
          <dl className="inventory-fact-grid inventory-fact-grid--movement">
            <Fact label="Movement state" emphasize>
              {humanizeWorkflowValue(movement.state) || "Not provided"}
            </Fact>
            <Fact label="Request status">
              {humanizeWorkflowValue(movement.requestStatus) || "Not provided"}
            </Fact>
            <Fact label="Custody status">
              {humanizeWorkflowValue(movement.custodyStatus) || "Not provided"}
            </Fact>
            <Fact
              label="Next action"
              emphasize
              className="inventory-workspace-fact--wide-mobile"
            >
              {movement.nextAction || "Not assigned"}
            </Fact>
            <Fact label="Pickup / due">
              {movement.dueAt
                ? formatDateTime(movement.dueAt)
                : "Not scheduled"}
            </Fact>
            <Fact label="Last movement">
              {movement.lastEventLabel ||
                formatDateTime(movement.lastEventAt)}
            </Fact>
            <Fact label="Customer outcome">
              {humanizeWorkflowValue(movement.customerOutcome) || "Not confirmed"}
            </Fact>
            <Fact label="Delivery confirmation">
              {humanizeWorkflowValue(movement.deliveryConfirmation) || "Not confirmed"}
            </Fact>
            <Fact label="Movement ID" className="inventory-workspace-fact--wide-mobile">
              {movement.requestId || (withheld ? withheldText : "Not assigned")}
            </Fact>
          </dl>
          {movement.overdue ? (
            <div className="inventory-availability-note inventory-availability-note--danger">
              <Clock3 size={17} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <strong>Action overdue.</strong> Confirm custody and assign the
                next responsible person.
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="inventory-workspace-empty inventory-workspace-empty--compact">
          <ArrowLeftRight size={24} strokeWidth={1.75} aria-hidden="true" />
          <h3>No movement tracked in this app</h3>
          <p>
            This does not prove that the vehicle has not moved. Confirm with
            the home store when location matters.
          </p>
        </div>
      )}
    </div>
  );
}

function TimelineIcon({ source }: { source: VehicleTimelineSource }) {
  const props = {
    size: 16,
    strokeWidth: 1.75,
    "aria-hidden": true,
  } as const;
  switch (source) {
    case "public":
      return <Globe2 {...props} />;
    case "dealeron":
      return <CarFront {...props} />;
    case "dealermail":
      return <UserRound {...props} />;
    case "movement":
      return <Truck {...props} />;
    case "location":
      return <MapPin {...props} />;
    case "system":
      return <Clock3 {...props} />;
  }
}

function vehicleTimelineEvents(vehicle: InventoryVehicle): VehicleTimelineEvent[] {
  const primaryChange = primaryVehicleChangeSignal(vehicle.changeSummary);
  const allEvents = [...(vehicle.timeline ?? [])];
  if (
    primaryChange &&
    vehicle.publicListing.updatedAt &&
    !allEvents.some((event) => event.source === "public")
  ) {
    allEvents.push({
      id: `${vehicle.id}-latest-inventory-change`,
      occurredAt: vehicle.publicListing.updatedAt,
      title: primaryChange.label,
      detail: vehicle.changeSummary || null,
      locationLabel:
        vehicle.location.sourceReportedStore?.name ||
        vehicle.location.homeStore.name,
      source: "public",
    });
  }
  return allEvents.sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    return (
      (Number.isNaN(rightTime) ? 0 : rightTime) -
      (Number.isNaN(leftTime) ? 0 : leftTime)
    );
  });
}

function TimelineDetails({ vehicle }: { vehicle: InventoryVehicle }) {
  const events = useMemo(() => vehicleTimelineEvents(vehicle), [vehicle]);

  if (!events.length) {
    return (
      <div className="inventory-workspace-empty inventory-workspace-empty--compact">
        <Clock3 size={24} strokeWidth={1.75} aria-hidden="true" />
        <h3>No recent activity recorded</h3>
        <p>
          Inventory changes, hold activity, and tracked vehicle movements will
          appear here.
        </p>
      </div>
    );
  }

  return (
    <section className="inventory-workspace-history" aria-labelledby="inventory-workspace-history-title">
      <header className="inventory-workspace-history__header">
        <span>
          <h3 id="inventory-workspace-history-title">Recorded activity</h3>
          <p>
            Chronological inventory, hold, location, and movement events captured for this VIN.
          </p>
        </span>
        <strong>
          {events.length} recorded event{events.length === 1 ? "" : "s"}
        </strong>
      </header>
      <ol className="inventory-timeline">
        {events.map((event) => (
          <li key={event.id}>
            <span
              className={`inventory-timeline__icon inventory-timeline__icon--${event.source}`}
            >
              <TimelineIcon source={event.source} />
            </span>
            <div className="inventory-timeline__copy">
              <time dateTime={event.occurredAt}>
                {formatDateTime(event.occurredAt)}
              </time>
              <strong>{event.title}</strong>
              {event.detail ? <p>{event.detail}</p> : null}
              {event.locationLabel || event.actorLabel ? (
                <small>
                  {[event.locationLabel, event.actorLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DataDetails({
  vehicle,
  onOpenSourceRecord,
}: Pick<VehicleWorkspaceProps, "vehicle" | "onOpenSourceRecord">) {
  const publicScan = vehicle.publicScan;
  const publicScanSites = publicScan?.sourceSites?.filter(Boolean).join(", ") || "Not published";
  return (
    <div className="inventory-workspace-detail-content inventory-workspace-data-details">
      <p className="inventory-workspace-section-note">
        These record checks support the vehicle summary shown throughout the app.
        They do not prove that a vehicle is unsold, on the lot, retail-ready, or
        available for a customer.
      </p>
      <section className="inventory-source-card">
        <div className="inventory-source-card__title">
          <Globe2 size={18} strokeWidth={1.75} aria-hidden="true" />
          <h4>Online listing</h4>
          <DataState state={vehicle.publicListing.dataState} />
        </div>
        <dl className="inventory-inline-facts">
          <Fact label="Shown on website">
            <BooleanSignal value={vehicle.publicListing.isListed} />
          </Fact>
          <Fact label="Website wording">
            {vehicle.publicListing.websiteStatus || "Not provided"}
          </Fact>
          <Fact label="Last update">
            {formatDateTime(vehicle.publicListing.updatedAt)}
          </Fact>
        </dl>
      </section>
      <section className="inventory-source-card">
        <div className="inventory-source-card__title">
          <Database size={18} strokeWidth={1.75} aria-hidden="true" />
          <h4>Location signals</h4>
          <DataState state={vehicle.dealerOn.dataState} />
        </div>
        <dl className="inventory-inline-facts">
          <Fact label="In-stock flag">
            <BooleanSignal value={vehicle.dealerOn.inStock} />
          </Fact>
          <Fact label="In-transit flag">
            <BooleanSignal value={vehicle.dealerOn.inTransit} />
          </Fact>
          <Fact label="In-production flag">
            <BooleanSignal value={vehicle.dealerOn.inProduction} />
          </Fact>
          <Fact label="Last update">
            {formatDateTime(vehicle.dealerOn.updatedAt)}
          </Fact>
        </dl>
      </section>
      <section className="inventory-source-card">
        <div className="inventory-source-card__title">
          <UserRound size={18} strokeWidth={1.75} aria-hidden="true" />
          <h4>Hold record</h4>
          <DataState state={vehicle.dealerMail.dataState} />
        </div>
        <dl className="inventory-inline-facts">
          <Fact label="Active hold">
            <BooleanSignal value={vehicle.dealerMail.hasActiveHold} />
          </Fact>
          <Fact label="Position">
            {vehicle.dealerMail.position || "Not provided"}
          </Fact>
          <Fact label="Active records">
            {vehicle.dealerMail.activeRecordCount ?? "Not provided"}
          </Fact>
          <Fact label="Last update">
            {formatDateTime(vehicle.dealerMail.updatedAt)}
          </Fact>
        </dl>
      </section>
      <dl className="inventory-fact-grid inventory-fact-grid--technical">
        <Fact label="Home store">{vehicle.location.homeStore.name}</Fact>
        <Fact label="Reported store">
          {vehicle.location.sourceReportedStore?.name || "Not provided"}
        </Fact>
        <Fact label="Hold-record store">
          {vehicle.location.crmStore?.name || "Not provided"}
        </Fact>
        <Fact label="Model code">
          {vehicle.modelCode || "Not published"}
        </Fact>
        <Fact label="Record health">{vehicle.dataStatus || "Not provided"}</Fact>
      </dl>
      <details className="inventory-public-scan-record">
        <summary>
          <span>
            <strong>Additional record details</strong>
            <small>Reported location, first and last seen dates, and internal identifiers</small>
          </span>
          <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
        </summary>
        <div>
          <p>
            The customer-facing and operational fields from the 44-column public scan are shown throughout this vehicle record. These remaining source fields are preserved here for audit and do not prove current availability or physical custody.
          </p>
          <dl className="inventory-fact-grid inventory-fact-grid--technical" role="group" aria-label="Additional vehicle record details">
            <Fact label="Authoritative physical store">
              {vehicle.location.sourceReportedStore?.name || vehicle.location.homeStore.name}
            </Fact>
            <Fact label="Reported location">{publicScan?.actualLocation || "Not published"}</Fact>
            <Fact label="Reported city">{publicScan?.locationCity || "Not published"}</Fact>
            <Fact label="Dealer location ID">{publicScan?.dealerLocationId ?? "Not published"}</Fact>
            <Fact label="Source dealer name">{publicScan?.dealerName || "Not published"}</Fact>
            <Fact label="Generic color">{publicScan?.genericColor || "Not published"}</Fact>
            <Fact label="Source sites">{publicScanSites}</Fact>
            <Fact label="Source site count">{publicScan?.sourceCount ?? "Not published"}</Fact>
            <Fact label="First seen">{formatDate(publicScan?.firstSeen)}</Fact>
            <Fact label="Last seen">{formatDate(publicScan?.lastSeen)}</Fact>
            <Fact label="Vehicle ID">{publicScan?.vehicleId ?? "Not published"}</Fact>
            <Fact label="Data status">{vehicle.dataStatus || "Not provided"}</Fact>
          </dl>
        </div>
      </details>
      {onOpenSourceRecord ? (
        <button
          type="button"
          className="inventory-button inventory-button--quiet"
          onClick={() => onOpenSourceRecord(vehicle, "public")}
        >
          <FileSearch size={16} strokeWidth={1.75} aria-hidden="true" /> Open
          technical record
        </button>
      ) : null}
    </div>
  );
}

export function VehicleWorkspace({
  vehicle,
  canRequestVehicle = false,
  initialTab = "overview",
  returnFocusRef,
  onClose,
  onViewVehicle,
  onRequestVehicle,
  onTrackMovement,
  onOpenListing,
  onOpenSourceRecord,
}: VehicleWorkspaceProps) {
  const [activeTarget, setActiveTarget] = useState<WorkspaceSectionId>(initialTab);
  const activeSection = workspacePage(activeTarget);
  const [holdView, setHoldView] = useState<"holds" | "comments" | "alerts">("holds");
  const [takeHomeOpen, setTakeHomeOpen] = useState(false);
  const takeHomeButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const movementSectionRef = useRef<HTMLElement>(null);
  const historySectionRef = useRef<HTMLElement>(null);
  const dealerMailActionsRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const resourcesRef = useRef<HTMLDetailsElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigationTimerRef = useRef<number | null>(null);
  const displayName = vehicleDisplayName(vehicle);
  const oemTheme = oemThemeToken(vehicle.make);
  const listingUrl = vehicle.publicListing.listingUrl;
  const autoCheckUrl = officialVehicleDocumentUrl(vehicle.autoCheckReport?.url, "autocheck", listingUrl);
  const stickerUrl = officialVehicleDocumentUrl(vehicle.windowSticker?.url, "window-sticker", listingUrl);
  const factoryEquipmentUrl = vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url);
  const supportsFordDealerTools = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const invoiceUrl = supportsFordDealerTools ? fordInvoiceUrl(vehicle.vin) : null;
  const oasisUrl = supportsFordDealerTools ? fordOasisUrl(vehicle.vin) : null;
  const openRecallCount = vehicle.fordOasis?.openFieldServiceActions.length ?? 0;
  const currentLocation = resolveCurrentLocation(vehicle);
  const canViewHoldEvidence = vehicle.dealerMail.canViewEvidence === true;
  const canManageDealerMail = vehicle.dealerMail.canManageHold === true;
  const primaryHold = canViewHoldEvidence
    ? vehicle.holdEvidence?.find((evidence) => evidence.position === "primary") ?? vehicle.holdEvidence?.[0]
    : undefined;
  const holdCurrent = vehicle.dealerMail.dataState === "current";
  const holdCount = vehicle.dealerMail.activeRecordCount ??
    (canViewHoldEvidence ? vehicle.holdEvidence?.length : null) ?? 0;
  const hasMovement = Boolean(vehicle.movement && (
    vehicle.movement.state || vehicle.movement.requestStatus ||
    vehicle.movement.custodyStatus || vehicle.movement.requestId
  ));
  const holdLabel = !holdCurrent
    ? "Hold status unverified"
    : vehicle.dealerMail.hasActiveHold === true
      ? vehicle.dealerMail.position === "backup"
        ? "Backup hold"
        : vehicle.dealerMail.position === "multiple" || holdCount > 1
          ? String(holdCount) + " hold records"
          : "On hold"
      : vehicle.dealerMail.hasActiveHold === false
        ? "No current hold"
        : "Hold status not provided";
  const holdDetail = vehicle.dealerMail.hasActiveHold === true
    ? [primaryHold?.salesperson, primaryHold?.customerOrReason].filter(Boolean).join(" · ") ||
      vehicle.dealerMail.conciseState || "Open hold details"
    : holdCurrent
      ? "Confirm availability with the home store"
      : "A fresh hold update is needed";
  const holdTone = !holdCurrent ? "unverified" : vehicle.dealerMail.hasActiveHold === true ? "held" : "clear";
  const movementLabel = vehicle.movement?.overdue
    ? "Move needs action"
    : hasMovement
      ? humanizeWorkflowValue(vehicle.movement?.state) ||
        humanizeWorkflowValue(vehicle.movement?.requestStatus) || "Movement tracked"
      : "No tracked move";
  const movementDetail = hasMovement
    ? vehicle.movement?.nextAction || vehicle.movement?.lastEventLabel || "Review movement details"
    : "Request or review a vehicle move";
  const recordsNeedReview = [
    vehicle.publicListing.dataState,
    vehicle.dealerOn.dataState,
    vehicle.dealerMail.dataState,
  ].some((state) => state !== "current");

  const resetContentScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (typeof scroller.scrollTo === "function") scroller.scrollTo({ top: 0, behavior: "auto" });
    else scroller.scrollTop = 0;
  };

  const queueSectionFocus = (target: WorkspaceSectionId, handoff = false, focusTab = true) => {
    if (navigationTimerRef.current !== null) window.clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = null;
      resetContentScroll();
      if (handoff) {
        const panel = dealerMailActionsRef.current;
        panel?.scrollIntoView?.({ behavior: workspaceScrollBehavior(), block: "nearest" });
        panel?.querySelector<HTMLButtonElement>(".inventory-dealermail-handoff__launch")?.focus({ preventScroll: true });
        return;
      }
      if (target === "movement" || target === "timeline") {
        const anchor = workspaceRef.current?.querySelector<HTMLElement>("#inventory-section-" + target);
        anchor?.scrollIntoView?.({ behavior: workspaceScrollBehavior(), block: "start" });
        anchor?.focus({ preventScroll: true });
      } else if (focusTab) {
        tabListRef.current?.querySelector<HTMLButtonElement>("#inventory-tab-" + workspacePage(target))?.focus({ preventScroll: true });
      }
    }, 0);
  };

  useEffect(() => {
    setActiveTarget(initialTab);
    setHoldView("holds");
    // Compatibility entry points still land directly at movement or history.
    queueSectionFocus(initialTab, false, false);
    return () => {
      if (navigationTimerRef.current !== null) window.clearTimeout(navigationTimerRef.current);
    };
    // Only a different vehicle or externally requested entry point resets a page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, vehicle.id]);

  useContainedFocus({
    active: true,
    contain: true,
    containerRef: workspaceRef,
    initialFocusRef: initialTab === "movement" ? movementSectionRef : initialTab === "timeline" ? historySectionRef : closeButtonRef,
    returnFocusRef,
    onEscape: onClose,
  });

  const openAndFocusSection = (target: WorkspaceSectionId) => {
    if (resourcesRef.current) resourcesRef.current.open = false;
    setActiveTarget(target);
    queueSectionFocus(target);
  };
  const focusDealerMailActions = () => {
    setActiveTarget("hold");
    setHoldView("holds");
    queueSectionFocus("hold", true);
  };
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = WORKSPACE_SECTIONS.findIndex((section) => section.id === activeSection);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? WORKSPACE_SECTIONS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + WORKSPACE_SECTIONS.length) % WORKSPACE_SECTIONS.length;
    openAndFocusSection(WORKSPACE_SECTIONS[nextIndex].id);
  };

  return createPortal(
    <>
      <div className="inventory-workspace-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className={"inventory-workspace inventory-workspace--dense inventory-workspace--compact-v3 inventory-workspace--v10 inventory-workspace--flow inventory-workspace--oem-" + oemTheme}
        ref={workspaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={displayName + " vehicle workspace"}
        tabIndex={-1}
        data-oem={oemTheme}
        data-vehicle-make={vehicle.make}
        data-active-section={activeSection}
        data-active-target={activeTarget}
      >
        <div className="vdp-flow-topbar">
          <button type="button" className="vdp-flow-back" onClick={onClose}>
            <ChevronLeft size={17} strokeWidth={1.8} aria-hidden="true" /> Back to inventory
          </button>
          <button type="button" className="inventory-icon-button inventory-workspace-close"
            ref={closeButtonRef} onClick={onClose} aria-label="Close vehicle details">
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <header className="vdp-flow-header">
          <div className="vdp-flow-identity">
            <p className="vdp-flow-store">{vehicle.location.homeStore.name}</p>
            <h2 id="inventory-workspace-title">{displayName}</h2>
            <dl className="vdp-flow-identifiers">
              <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stockNumber} /></dd></div>
              <div><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin} /></dd></div>
            </dl>
          </div>
          <div className="vdp-flow-actions" role="toolbar" aria-label="Vehicle actions">
            <button type="button" className="vdp-flow-primary-action inv-btn inv-btn--primary"
              onClick={canManageDealerMail ? focusDealerMailActions : () => openAndFocusSection("hold")}
              aria-controls={canManageDealerMail ? "inventory-dealermail-actions" : "inventory-panel-hold"}
              data-action={canManageDealerMail ? "dealermail-tools" : "hold-details"}>
              <UserRound size={16} strokeWidth={1.8} aria-hidden="true" />
              {canManageDealerMail ? "DealerMail tools" : "View hold status"}
            </button>
            <details className="vdp-flow-resources" ref={resourcesRef} onKeyDown={(event) => {
              if (event.key !== "Escape" || !resourcesRef.current?.open) return;
              event.stopPropagation();
              event.preventDefault();
              resourcesRef.current.open = false;
              resourcesRef.current.querySelector<HTMLElement>("summary")?.focus();
            }}>
              <summary className="inv-btn inv-btn--secondary">More resources <ChevronDown className="inv-btn__chevron" size={16} strokeWidth={1.8} aria-hidden="true" /></summary>
              <div className="vdp-flow-resource-menu" role="group" aria-label="Vehicle resources">
                {listingUrl ? onOpenListing ? (
                  <button type="button" onClick={() => onOpenListing(vehicle)} data-action="open-listing">
                    <Globe2 size={17} aria-hidden="true" /> Open listing
                  </button>
                ) : (
                  <a href={listingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="open-listing" data-read-only="true">
                    <Globe2 size={17} aria-hidden="true" /> Open listing
                  </a>
                ) : null}
                {autoCheckUrl ? (
                  <a href={autoCheckUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                    aria-label={"Open AutoCheck report for " + displayName + " in a new tab"} data-action="autocheck" data-read-only="true">
                    <AutoCheckWordmark compact decorative /> AutoCheck report
                  </a>
                ) : null}
                {stickerUrl ? (
                  <a href={stickerUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                    aria-label={"Open factory window sticker for " + displayName + " in a new tab"} data-action="window-sticker" data-read-only="true">
                    <FactoryStickerIcon size={18} /> Window sticker
                  </a>
                ) : null}
                {factoryEquipmentUrl ? (
                  <a href={factoryEquipmentUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                    aria-label={"Open VIN equipment profile for " + displayName + " in a new tab"} data-action="factory-equipment" data-read-only="true">
                    <FileText size={17} aria-hidden="true" /> VIN equipment profile
                  </a>
                ) : null}
                {invoiceUrl ? <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="invoice" data-read-only="true"><FileSearch size={17} aria-hidden="true" /> Invoice</a> : null}
                {oasisUrl ? <a href={oasisUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="oasis" data-read-only="true"><BadgeCheck size={17} aria-hidden="true" /> OASIS</a> : null}
                <button type="button" onClick={() => setTakeHomeOpen(true)} data-action="take-home" ref={takeHomeButtonRef}><Printer size={17} aria-hidden="true" /> Take-home page</button>
                <button type="button" onClick={() => openAndFocusSection("data")} data-action="records"><FileSearch size={17} aria-hidden="true" /> Vehicle records</button>
                {onViewVehicle ? <button type="button" onClick={() => onViewVehicle(vehicle)} data-action="open-record"><CarFront size={17} aria-hidden="true" /> Full record</button> : null}
              </div>
            </details>
          </div>
        </header>
        <div className="inventory-workspace-navigation vdp-flow-navigation">
          <div className="inventory-workspace-tabs inventory-workspace-tabs--dense"
            role="tablist" aria-label="Vehicle workspace sections" ref={tabListRef} onKeyDown={handleTabKeyDown}>
            {WORKSPACE_SECTIONS.map((section) => (
              <button type="button" role="tab" id={"inventory-tab-" + section.id}
                aria-label={section.label} aria-selected={activeSection === section.id}
                aria-controls={"inventory-panel-" + section.id}
                tabIndex={activeSection === section.id ? 0 : -1}
                onClick={() => openAndFocusSection(section.id)}
                data-workspace-tab={section.id} key={section.id}>
                {section.label}
              </button>
            ))}
          </div>
        </div>
        <div className="inventory-workspace-scroll inventory-workspace-scroll--dense vdp-flow-content" ref={scrollRef}>
          <div className="inventory-workspace-tab-panels">
            <WorkspacePanel id="overview" label="Overview" active={activeSection === "overview"}>
              <div className="vdp-flow-overview-summary" data-hold-state={holdTone}>
                <VehicleGallery vehicle={vehicle} />
                <div className="vdp-flow-overview-facts">
                  <dl className="vdp-flow-metrics">
                    <Fact label="Listed price" emphasize>{formatMoney(vehicle.price)}</Fact>
                    <Fact label="Mileage" emphasize>{formatMileage(vehicle.mileage)}</Fact>
                    <Fact label="Days listed" emphasize>{vehicle.daysListed ?? "—"}</Fact>
                    <Fact label="Listed MSRP">{formatMoney(vehicle.msrp)}</Fact>
                  </dl>
                  <div className="vdp-flow-meta">
                    {vehicle.inventoryDate ? <span>Inventory date {formatDate(vehicle.inventoryDate)}</span> : null}
                    {vehicle.certified ? <span className="vdp-flow-certified"><BadgeCheck size={15} aria-hidden="true" /> Certified</span> : null}
                    {openRecallCount ? (
                      <button type="button" className="vdp-flow-recall-flag" onClick={() => openAndFocusSection("data")} data-action="open-recalls"
                        aria-label={`${countLabel(openRecallCount, "open Ford recall or field service action", "open Ford recalls or field service actions")}; review vehicle records`}>
                        <AlertTriangle size={15} aria-hidden="true" /> {countLabel(openRecallCount, "open recall")} <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <section className="inventory-workspace-primary-status vdp-flow-operational-strip" aria-label="Vehicle operational summary">
                    <OperationalSignal id="hold" label="Hold status" value={holdLabel} detail={holdDetail}
                      icon={<UserRound size={19} aria-hidden="true" />} tone={holdTone}
                      section="hold" active={false} onActivate={openAndFocusSection} />
                    <OperationalSignal id="location" label="Current location" value={currentLocation.label}
                      detail={vehicle.location.conflict ? "Location conflict — review needed" : currentLocation.detail}
                      icon={<MapPin size={19} aria-hidden="true" />} tone={vehicle.location.conflict ? "danger" : "default"}
                      section="movement" active={false} onActivate={openAndFocusSection} />
                    <OperationalSignal id="movement" label="Movement" value={movementLabel} detail={movementDetail}
                      icon={<Truck size={19} aria-hidden="true" />} tone={vehicle.movement?.overdue ? "danger" : "default"}
                      section="movement" active={false} onActivate={openAndFocusSection} />
                  </section>
                  {vehicle.managerDisposition ? (
                    <section className="vdp-flow-manager-disposition" data-state={vehicle.managerDisposition.dataState} aria-label="Manager disposition record">
                      <ClipboardCheck size={19} strokeWidth={1.9} aria-hidden="true" />
                      <div>
                        <small>Manager log</small>
                        <strong>{vehicle.managerDisposition.soldLabel}</strong>
                        <span>
                          {vehicle.managerDisposition.deliveryLabel}
                          {vehicle.managerDisposition.deliveryDate ? ` · ${formatDate(vehicle.managerDisposition.deliveryDate)}` : ""}
                        </span>
                      </div>
                      <em>Independent of listing, hold, CDK, and location</em>
                    </section>
                  ) : null}
                  {recordsNeedReview ? <button type="button" className="vdp-flow-warning vdp-flow-record-warning" onClick={() => openAndFocusSection("data")}>
                    <AlertTriangle size={17} aria-hidden="true" /><span>Some vehicle information needs a fresh check. Review records.</span><ChevronRight size={16} aria-hidden="true" />
                  </button> : null}
                </div>
              </div>
              <div className="vdp-flow-detail-grid">
                <OverviewDetails vehicle={vehicle} onOpenRecords={() => openAndFocusSection("data")} onOpenEquipment={() => openAndFocusSection("equipment")} />
                <VehicleIntelligence vehicle={vehicle} />
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="equipment" label="Equipment" active={activeSection === "equipment"}>
              <div className="inventory-workspace-equipment-layout">
                <SourceConfirmedEquipment vehicle={vehicle} />
                <aside className="inventory-workspace-equipment-specs" aria-label="Equipment section index">
                  <EquipmentCategoryIndex vehicle={vehicle} />
                </aside>
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="hold" label="Holds & moves" active={activeSection === "hold"}>
              <div className="vdp-flow-operations">
                <header className="vdp-flow-section-heading">
                  <div><h3>Holds &amp; notes</h3><p>Review saved information, then open DealerMail when you need to make a change.</p></div>
                </header>
                <div className="inventory-workspace-hold-center" data-hold-state={vehicle.holdEvidence?.length ? "held" : "no-evidence"}>
                  {canViewHoldEvidence ? <div className="inventory-hold-evidence-views" role="group" aria-label="Saved DealerMail information">
                    <button type="button" aria-pressed={holdView === "holds"} onClick={() => setHoldView("holds")}>Hold records</button>
                    <button type="button" aria-pressed={holdView === "comments"} onClick={() => setHoldView("comments")}>Saved comments</button>
                    <button type="button" aria-pressed={holdView === "alerts"} onClick={() => setHoldView("alerts")}>Saved alerts</button>
                  </div> : null}
                  {holdView === "holds" ? <HoldDetails vehicle={vehicle} /> : <CapturedDealerMailMessages vehicle={vehicle} kind={holdView} />}
                  {canManageDealerMail ? <DealerMailHandoff key={vehicle.id + "|" + vehicle.stockNumber + "|" + vehicle.vin} vehicle={vehicle} panelRef={dealerMailActionsRef} /> : null}
                </div>
                <section className="vdp-flow-movement" id="inventory-section-movement" ref={movementSectionRef} tabIndex={-1} aria-labelledby="inventory-movement-heading">
                  <header className="vdp-flow-section-heading">
                    <div><h3 id="inventory-movement-heading">Location &amp; movement</h3><p>See where the vehicle is reported and the next step for a move.</p></div>
                    {vehicle.movement?.requestId && onTrackMovement ? (
                      <button type="button" className="vdp-flow-primary-action" onClick={() => onTrackMovement(vehicle)} data-action="track-movement">
                        <Truck size={17} aria-hidden="true" /> Track movement
                      </button>
                    ) : !isMoveRequestBlocked(vehicle) && canRequestVehicle && onRequestVehicle ? (
                      <button type="button" className="vdp-flow-primary-action" onClick={() => onRequestVehicle(vehicle)} data-action="request-vehicle">
                        <ArrowLeftRight size={17} aria-hidden="true" /> Request vehicle
                      </button>
                    ) : null}
                  </header>
                  <div id="inventory-panel-movement"><MovementDetails vehicle={vehicle} /></div>
                </section>
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="data" label="Records" active={activeSection === "data"}>
              <div className="vdp-flow-records">
                <VehicleDocuments vehicle={vehicle} />
                <section className="vdp-flow-history" id="inventory-section-timeline" ref={historySectionRef} tabIndex={-1} aria-labelledby="inventory-history-heading">
                  <header className="vdp-flow-section-heading"><h3 id="inventory-history-heading">Vehicle history</h3></header>
                  <div id="inventory-panel-timeline"><TimelineDetails vehicle={vehicle} /></div>
                </section>
                <details className="vdp-flow-technical">
                  <summary><span>Technical &amp; source details</span><ChevronDown size={17} aria-hidden="true" /></summary>
                  <DataDetails vehicle={vehicle} onOpenSourceRecord={onOpenSourceRecord} />
                </details>
              </div>
            </WorkspacePanel>
          </div>
        </div>
      </aside>
      {takeHomeOpen ? <TakeHomeSheet vehicle={vehicle} onClose={() => setTakeHomeOpen(false)} returnFocusRef={takeHomeButtonRef} /> : null}
    </>,
    document.body,
  );
}
