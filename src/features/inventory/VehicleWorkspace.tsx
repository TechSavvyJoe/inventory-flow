import { serviceStatusLabel, serviceWorkflowStatus } from "../../lib/service-readiness";
import { sourceDisplayText } from "../../lib/source-text";
import { vehiclePhotoFullSources } from "../../lib/vehicle-photos";
import {
  useEffect,
  useLayoutEffect,
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
  Info,
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
import { DealerMailHandoff } from "./DealerMailHandoff";
import { VehicleResourceCards } from "./VehicleResourceCards";
import { hasCapturedOasisActionResult } from "./vehicle-resource-catalog";
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
  WarrantyCheckCoverage,
} from "./types";
import "./VehicleWorkspace.focused.css";
import "./VehicleWorkspace.records.css";

type WorkspaceSectionId =
  | "overview"
  | "hold"
  | "movement"
  | "equipment"
  | "timeline"
  | "data";

type WorkspacePageId = "overview" | "equipment" | "hold" | "data" | "timeline";

const WORKSPACE_SECTIONS: Array<{ id: WorkspacePageId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "equipment", label: "Equipment" },
  { id: "data", label: "Records" },
  { id: "hold", label: "Holds & moves" },
  { id: "timeline", label: "Activity" },
];

const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function formatReferencePrice(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} · currency not captured`;
}

function compactSourcePrice(value: number | null | undefined, sticker?: InventoryVehicle["windowSticker"]): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return sticker?.pricingCurrency
    ? formatStickerMoney(value, sticker)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function historyCheckLabel(label: string): string {
  const labels: Record<string, string> = {
    "state title brand": "Title", "auction brand / issues": "Auction",
    "accident / damage": "Accident / damage", "open recall check": "Recalls",
    "insurance loss / transfer": "Insurance", "odometer check": "Odometer",
    "certified pre-owned": "CPO", "service / repair": "Service", "additional history": "Other history",
  };
  return labels[label.trim().toLowerCase()] ?? label;
}

function historyCheckResult(check: NonNullable<NonNullable<InventoryVehicle["autoCheckReport"]>["checks"]>[number], report?: InventoryVehicle["autoCheckReport"]): string {
  const status = sourceDisplayText(check.status).trim();
  const detail = sourceDisplayText(check.detail).trim();
  const reading = detail.match(/^Last reported odometer:\s*([\d,]+)(?:\s*(?:mi|miles))?(?:\s*\(([^)]+)\))?\.?$/i);
  if (/odometer/i.test(check.label) && reading && Number(reading[1].replaceAll(",", "")) === report?.lastReportedOdometer
    && (!reading[2] || Boolean(report?.lastReportedOdometerDate && formatDate(reading[2]) === formatDate(report.lastReportedOdometerDate)))) return status || "See odometer above";
  if (/no cpo info available|not reported|not available/i.test(status) && !detail) return "Not reported";
  if (!detail || detail.toLowerCase() === status.toLowerCase()) return status || "Not reported";
  if (/^no issue$/i.test(status) || /^records available$/i.test(status) && /^\d+ service records?(?:\(s\))?(?: reported)?\.?$/i.test(detail) || detail.toLowerCase().includes(status.toLowerCase())) return detail;
  return [status, detail].filter(Boolean).join(" · ");
}

function serviceRecordSummary(report: NonNullable<InventoryVehicle["autoCheckReport"]>): string | null {
  const check = report.checks?.find(item => /service.*repair/i.test(item.label));
  if (!check) return null;
  const result = historyCheckResult(check);
  const count = result.match(/\b(\d+)\s+service\s+record/i);
  return count ? `${count[1]} record${Number(count[1]) === 1 ? "" : "s"} reported` : result;
}

function focusWorkspaceSection(target: HTMLElement | null) {
  if (!target) return;
  const scroll = target.closest<HTMLElement>(".vdp-focus-scroll");
  if (scroll) scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 10;
  target.focus({ preventScroll: true });
}

function workspacePage(section: WorkspaceSectionId): WorkspacePageId {
  if (section === "movement") return "hold";
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
  // Source freshness remains available to administrators and the sync layer.
  // Store teams see plain-language review prompts only where a decision needs it.
  void state;
  return null;
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
  if (!active) return null;
  return (
    <section
      id={`inventory-section-${id}`}
      className={`inventory-workspace-panel inventory-workspace-panel--${id}`}
      data-panel={id}
      data-active={active}
      role="tabpanel"
      aria-label={label}
      aria-labelledby={`inventory-tab-${id}`}
      tabIndex={-1}
    >
      <div
        className="inventory-workspace-panel__body"
        id={`inventory-panel-${id}`}
      >
        {children}
      </div>
    </section>
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
          src="/resource-brands/autocheck.svg"
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
      {brand.toLowerCase() === "ford" ? <img src="/resource-brands/ford.svg" alt="" /> : <span aria-hidden="true">{brand}</span>}
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
      <img src="/resource-brands/vauto.svg" alt="" />
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
      <img src="/resource-brands/ford.svg" alt="" />
    </span>
  );
}

function VehicleGallery({ vehicle }: { vehicle: InventoryVehicle }) {
  const suppliedImages = useMemo(() => {
    return vehiclePhotoFullSources(vehicle);
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
        className="inventory-workspace-gallery inventory-workspace-gallery--empty"
        aria-label="Vehicle photos"
        data-photo-state="empty"
      >
        <div className="inventory-workspace-gallery__placeholder">
          <ImageOff size={24} strokeWidth={1.6} aria-hidden="true" />
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
      className="inventory-workspace-gallery"
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
          alt={activeImage.startsWith('/demo-vehicles/') ? `${displayName}, AI-generated demo illustration` : `${displayName}, photo ${activeIndex + 1}`}
          referrerPolicy="no-referrer"
          onError={() => markImageFailed(activeImage)}
        />
        {activeImage.startsWith('/demo-vehicles/') && <span className="vdp-demo-photo"><span className="vdp-demo-photo-full">Demo illustration</span><span className="vdp-demo-photo-short">Demo</span></span>}
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
                referrerPolicy="no-referrer"
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
              ? `${evidence.position} hold`
              : "Hold"}
          </strong>
          <small>
            {isLastVerified
              ? "Review before updating"
              : evidence.lifecycleStatus || "Active"}
          </small>
        </span>
        <span className="inventory-hold-evidence__position">
          {evidence.position || "Active"}
        </span>
      </header>
      {isLastVerified ? (
        <p className="inventory-hold-evidence__stale-note" role="note">
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Review this hold before updating availability or delivery.</span>
        </p>
      ) : null}
      <dl className="inventory-fact-grid inventory-fact-grid--compact inventory-hold-evidence__facts">
        {evidence.salesperson ? <Fact label="Salesperson" emphasize>{evidence.salesperson}</Fact> : null}
        {evidence.customerOrReason ? <Fact label="Customer / reason" emphasize>{evidence.customerOrReason}</Fact> : null}
        {evidence.heldBy ? <Fact label="Held by">{evidence.heldBy}</Fact> : null}
        {evidence.holdDate ? <Fact label="Hold date">{formatDate(evidence.holdDate)}</Fact> : null}
        {evidence.expectedDeliveryDate ? <Fact label="Expected date">{formatDate(evidence.expectedDeliveryDate)}</Fact> : null}
        {evidence.daysHeld != null ? <Fact label="Days held">{evidence.daysHeld}</Fact> : null}
        {evidence.position === "primary" && backupCount != null ? (
          <Fact label="Backup holds">{backupCount}</Fact>
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
          {evidence.commentFlag ? "Comments present" : "No comments"}
        </span>
        <span className={evidence.alertFlag ? "is-present" : undefined}>
          <Bell size={15} strokeWidth={1.75} aria-hidden="true" />
          {evidence.alertFlag ? "Alerts present" : "No alerts"}
        </span>
      </div>
      {messages.length ? (
        <details className="inventory-hold-evidence__messages" open>
          <summary>
            <span>Comments & alerts</span>
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
                <strong>{message.text || `${message.kind === "alert" ? "Alert" : "Comment"}`}</strong>
                <small>
                  {[
                    message.author,
                    message.timestamp ? formatDateTime(message.timestamp) : null,
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

function CapturedRecordSection({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return <section className="vdp-record-section" aria-label={title}>
    <header><h4>{title}</h4>{count ? <small>{count}</small> : null}</header>
    {children}
  </section>;
}

function RecordSourceDetails({ children }: { children: ReactNode }) {
  // Preserve the record for audit/admin use without exposing feed mechanics.
  void children;
  return null;
}

function RecordSourceAction({ href, label, accessibleLabel, unavailableLabel }: { href: string | null; label: string; accessibleLabel: string; unavailableLabel: string }) {
  return <div className="vdp-record-source-action">
    {href ? <a className="inventory-vehicle-document__link" href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={accessibleLabel} aria-describedby="inventory-vehicle-documents-read-only" data-read-only="true">
      {label}<ExternalLink size={16} aria-hidden="true" />
    </a> : <span className="inventory-vehicle-document__unavailable" role="status" aria-label={unavailableLabel}>Document unavailable</span>}
  </div>;
}

function CapturedWarrantyTable({ coverages, label }: { coverages: WarrantyCheckCoverage[]; label: string }) {
  return <table className="inventory-vehicle-document__warranty-table" aria-label={label} role="table">
    <thead><tr><th scope="col">Coverage</th><th scope="col">Term</th><th scope="col">Miles left</th><th scope="col">Time left</th><th scope="col">Status</th></tr></thead>
    <tbody>{coverages.map((coverage, index) => <tr key={`${coverage.type}-${index}`} data-status={coverage.status}>
      <th scope="row">{coverage.type}</th>
      <td data-label="Term">{coverage.termText}</td>
      <td data-label="Miles left">{coverage.remainingMilesText}</td>
      <td data-label="Time left">{coverage.remainingTimeText}</td>
      <td data-label="Status"><span className={`inventory-warranty-pill inventory-warranty-pill--${coverage.status === "ACTIVE" ? "active" : coverage.status === "EXPIRED" ? "expired" : "unknown"}`}>{coverage.status === "ACTIVE" ? "Active" : coverage.status === "EXPIRED" ? "Expired" : "N/A"}</span></td>
    </tr>)}</tbody>
  </table>;
}

function VehicleDocuments({ vehicle }: { vehicle: InventoryVehicle }) {
  const recordsRef = useRef<HTMLElement>(null);
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
  const hasCapturedRecallResult = hasCapturedOasisActionResult(fordOasis);
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
        autoCheck.lastReportedOdometer == null && autoCheck.lastReportedOdometerDate ? {
          label: "Last odometer report date", value: formatDate(autoCheck.lastReportedOdometerDate),
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


  const sections = [
    { id: "autocheck", label: "AutoCheck", content: (autoCheck ? <article
          className="inventory-vehicle-document inventory-vehicle-document--autocheck"
          data-document-kind="autocheck"
          data-link-state={autoCheckUrl ? "available" : "unavailable"}
        >
          <header className="inventory-vehicle-document__heading">
            <AutoCheckWordmark />
            <span className="inventory-vehicle-document__title">
              <strong>AutoCheck vehicle history</strong>
            </span>
            <DataState state={autoCheck.dataState} />
          </header>

          <RecordSourceAction href={autoCheckUrl} label="Open report" accessibleLabel={`Open AutoCheck report for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="AutoCheck report unavailable" />

          <dl className="vdp-history-summary" aria-label="AutoCheck summary">
            {autoCheck.score != null || autoCheckScoreRange ? <Fact label="AutoCheck score" emphasize>{autoCheck.score ?? "Not reported"}{autoCheckScoreRange ? <small>Typical {autoCheckScoreRange}</small> : null}</Fact> : null}
            {autoCheck.ownerCount != null ? <Fact label="Owners">{autoCheck.ownerCount}</Fact> : null}
            {autoCheck.usage ? <Fact label="Vehicle use">{autoCheck.usage}</Fact> : null}
            {serviceRecordSummary(autoCheck) ? <Fact label="Service records">{serviceRecordSummary(autoCheck)}</Fact> : null}
            {autoCheck.lastReportedOdometer != null ? <Fact label="Last odometer">{formatMileage(autoCheck.lastReportedOdometer)}{autoCheck.lastReportedOdometerDate ? <small>{formatDate(autoCheck.lastReportedOdometerDate)}</small> : null}</Fact> : null}
          </dl>
          {autoCheck.checks?.length ? (
            <CapturedRecordSection title="History checks" count={countLabel(autoCheck.checks.length, "check")}>
              <div className="inventory-vehicle-document__checks" aria-label="AutoCheck at-a-glance results">
                {autoCheck.checks.map((check, index) => {
                  const odometerWarning = /odometer/i.test(check.label) && /discrepancy|rollback|not actual|exceeds mechanical|inconsistent/i.test(check.detail ?? "") && !/no (?:odometer )?(?:discrepancy|rollback|inconsistency)/i.test(check.detail ?? "");
                  const serviceCountOnly = /service.*repair/i.test(check.label) && /^records available$/i.test(check.status ?? "") && /^\d+ service records?(?:\(s\))?(?: reported)?\.?$/i.test(check.detail ?? "");
                  const tone = odometerWarning ? "review" : serviceCountOnly ? "info" : /no cpo info available/i.test(check.status ?? "") ? "unknown" : autoCheckResultTone(check.status);
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
                      ) : tone === "info" ? (
                        <Info size={15} strokeWidth={1.8} aria-hidden="true" />
                      ) : (
                        <CircleHelp size={15} strokeWidth={1.8} aria-hidden="true" />
                      )}
                      <span>
                        <strong>{historyCheckLabel(check.label)}</strong>
                        <small>{historyCheckResult(check, autoCheck)}</small>
                      </span>
                    </span>
                  );
                })}
              </div>
            </CapturedRecordSection>
          ) : null}
          <RecordSourceDetails>
            <p>{autoCheck.reportRunAt ? `Report run ${formatDateTime(autoCheck.reportRunAt)}` : "Report run time not captured"}</p>
            <dl className="inventory-vehicle-document__facts">{autoCheckFacts.map(fact => <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>)}</dl>
            {autoCheck.checks?.length ? <ul aria-label="Original AutoCheck findings">{autoCheck.checks.map((check, index) => <li key={index}><strong>{check.label}</strong> · {[check.status, check.detail].filter(Boolean).map(sourceDisplayText).join(" · ") || "Not reported"}</li>)}</ul> : null}
          </RecordSourceDetails>
          {!autoCheckFacts.length && !autoCheck.checks?.length && autoCheck.score == null && !autoCheckScoreRange ? (
            <p className="inventory-vehicle-document__empty">No AutoCheck history details are available.{autoCheckUrl ? " Open the report for details." : ""}</p>
          ) : null}
        </article> : null) },
    { id: "oasis", label: "OASIS", content: (fordOasis ? <article
          className="inventory-vehicle-document inventory-vehicle-document--oasis"
          data-document-kind="ford-oasis"
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

          <RecordSourceAction href={oasisUrl} label="Open OASIS" accessibleLabel={`Open Ford OASIS lookup for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="Ford OASIS lookup unavailable" />

          <div
            className={`inventory-vehicle-document__recalls inventory-vehicle-document__recalls--${openRecallCount ? "open" : hasCapturedRecallResult ? "clear" : "unknown"}`}
            role="status"
            aria-label="Open recalls and field service actions"
            data-open-recall-count={openRecallCount}
          >
            {openRecallCount ? (
              <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
            ) : hasCapturedRecallResult ? (
              <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden="true" />
            ) : <CircleHelp size={18} strokeWidth={1.9} aria-hidden="true" />}
            <span>
              <strong>
                {openRecallCount
                  ? countLabel(openRecallCount, "open recall / field service action", "open recalls / field service actions")
                  : hasCapturedRecallResult ? "No open recalls or field service actions listed" : "No recall or field service action details are available"}
              </strong>
              <small>
                Confirm current action status in OASIS before scheduling repairs.
              </small>
            </span>
          </div>

          {openRecallCount ? (
            <ul className="inventory-vehicle-document__recall-list" aria-label="Open field service action details">
              {fordOasis.openFieldServiceActions.map((action) => (
                <li key={action.code}>
                  <b>{action.code}</b>
                  <span>{sourceDisplayText(action.description) || "Details unavailable"}</span>
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
            <CapturedRecordSection title="Warranty coverages" count={countLabel(fordOasis.warrantyCoverages.length, "coverage type")}>
              <ul aria-label="Ford warranty coverages">
                {fordOasis.warrantyCoverages.map((coverage, index) => (
                  <li key={`${coverage.type}-${index}`}>
                    <span>
                      <strong>{coverage.type}</strong>
                    </span>
                    {coverage.description ? <small>{sourceDisplayText(coverage.description)}</small> : null}
                  </li>
                ))}
              </ul>
            </CapturedRecordSection>
          ) : null}

          {fordOasis.extendedCoverageExpirations.length ? (
            <CapturedRecordSection title="Extended service plan expirations" count={countLabel(fordOasis.extendedCoverageExpirations.length, "expiration date")}>
              <ul aria-label="Extended service plan expirations">
                {fordOasis.extendedCoverageExpirations.map((expiration, index) => (
                  <li key={`${expiration}-${index}`}>
                    <span>
                      <strong>{expiration}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </CapturedRecordSection>
          ) : null}

          {!fordOasisFacts.length && !openRecallCount && !fordOasis.warrantyCoverages.length && !fordOasis.extendedCoverageExpirations.length ? (
            <p className="inventory-vehicle-document__empty">No OASIS details are available. Open OASIS for the current report.</p>
          ) : null}
          <RecordSourceDetails><p>{fordOasis.capturedAt ? `Captured ${formatDateTime(fordOasis.capturedAt)}. ` : ""}Dealer login may be required. The lookup opens OASIS for this VIN; it is not a saved copy of the report.</p></RecordSourceDetails>
        </article> : null) },
    { id: "warranty", label: "Warranty", content: (warrantyCheck && warrantyPrimary ? <article
          className="inventory-vehicle-document inventory-vehicle-document--warranty"
          data-document-kind="warranty-check"
        >
          <header className="inventory-vehicle-document__heading">
            <span className="inventory-vehicle-document__title">
              <strong>Remaining factory warranty</strong>
              <small>
                Factory warranty coverage
              </small>
            </span>
            <DataState state={warrantyCheck.dataState} />
          </header>
          {warrantyPrimaryIsOasis
            ? <RecordSourceAction href={oasisUrl} label="Open OASIS coverage lookup" accessibleLabel={`Open OASIS coverage lookup for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="Ford OASIS lookup unavailable" />
            : autoCheckUrl ? <RecordSourceAction href={autoCheckUrl} label="Open AutoCheck report" accessibleLabel={`Open AutoCheck warranty report for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="AutoCheck report unavailable" /> : null}

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
            {!warrantyPrimaryIsOasis && warrantyCheck.autoCheck?.defaultMileage != null ? <Fact label="AutoCheck default mileage">{formatMileage(warrantyCheck.autoCheck.defaultMileage)}</Fact> : null}
          </dl>

          <CapturedWarrantyTable coverages={warrantyPrimary.coverages} label="Remaining factory warranty by coverage" />

          <RecordSourceDetails>
          {warrantyCheck.mileageSource ? <p>Mileage source: {warrantyCheck.mileageSource}</p> : null}
          {warrantySecondary ? (
            <CapturedRecordSection title="AutoCheck estimate" count={countLabel(warrantySecondary.coverages.length, "coverage type")}>
              <p>Experian estimate for comparison; the Ford OASIS factory record above takes precedence.</p>
              <dl className="inventory-vehicle-document__facts">
                {warrantySecondary.inServiceDate ? <Fact label="In service (est.)">{warrantySecondary.inServiceDate}</Fact> : null}
                {warrantySecondary.inServiceAgeMonths != null ? <Fact label="Months in service (est.)">{countLabel(warrantySecondary.inServiceAgeMonths, "month")}</Fact> : null}
                {warrantySecondary.defaultMileage != null ? <Fact label="AutoCheck default mileage">{formatMileage(warrantySecondary.defaultMileage)}</Fact> : null}
              </dl>
              <CapturedWarrantyTable coverages={warrantySecondary.coverages} label="AutoCheck warranty estimate" />
            </CapturedRecordSection>
          ) : null}
          </RecordSourceDetails>

          <p className="inventory-vehicle-document__empty">
            {warrantyPrimaryIsOasis
              ? "Ford and Lincoln factory coverage follows the vehicle to the next owner at no cost. Remaining figures are calculated from Ford's printed term against this vehicle's listed odometer."
              : "Experian estimate calculated from the best available in-service date against this vehicle's listed odometer."}
            {" "}Verify with the store before quoting coverage to a customer.
          </p>
        </article> : null) },
    { id: "outlook", label: "Warranty estimate", content: (showWarranty ? <WarrantyOutlook vehicle={vehicle} /> : null) },
    { id: "sticker", label: "Window sticker", content: (sticker ? <article
          className="inventory-vehicle-document inventory-vehicle-document--sticker"
          data-document-kind="window-sticker"
          data-link-state={stickerUrl ? "available" : "unavailable"}
        >
          <header className="inventory-vehicle-document__heading">
            <WindowStickerWordmark make={vehicle.make} />
            <span className="inventory-vehicle-document__title">
              <strong>Factory window sticker</strong>
              <small>{sticker.vehicleDescription || "Vehicle details"}</small>
            </span>
            <DataState state={sticker.dataState} />
          </header>

          <RecordSourceAction href={stickerUrl} label="Open sticker" accessibleLabel={`Open window sticker for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="Window sticker unavailable" />

          {sticker.totalMsrp != null || sticker.basePrice != null || sticker.totalOptions != null || sticker.destinationCharge != null ? (
            <dl className="inventory-vehicle-document__metrics inventory-vehicle-document__metrics--sticker" aria-label="Window sticker pricing">
              {sticker.totalMsrp != null ? <Fact label="Sticker MSRP" emphasize>{compactSourcePrice(sticker.totalMsrp, sticker)}</Fact> : null}
              {sticker.basePrice != null ? <Fact label="Base MSRP · lookup">{compactSourcePrice(sticker.basePrice, sticker)}</Fact> : null}
              {sticker.totalOptions != null ? <Fact label="Total options">{compactSourcePrice(sticker.totalOptions, sticker)}</Fact> : null}
              {sticker.destinationCharge != null ? <Fact label="Destination">{compactSourcePrice(sticker.destinationCharge, sticker)}</Fact> : null}
            </dl>
          ) : null}

          {stickerFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {stickerFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}
          {sticker.options?.length ? (
            <CapturedRecordSection title="Factory options" count={countLabel(sticker.options.length, "published item")}>
              <ul aria-label="Factory options">
                {sticker.options.map((option, index) => (
                  <li key={`${option}-${index}`}>
                    <span>{option}</span>
                  </li>
                ))}
              </ul>
            </CapturedRecordSection>
          ) : null}
          {sticker.standardEquipment?.length || sticker.warranty?.length ? (
            <CapturedRecordSection title="Full factory equipment & warranty" count={countLabel((sticker.standardEquipment?.length ?? 0) + (sticker.warranty?.length ?? 0), "published item")}>
              <div className="vdp-record-equipment-groups">
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
            </CapturedRecordSection>
          ) : null}
          {!stickerFacts.length && !sticker.options?.length && !sticker.standardEquipment?.length && !sticker.warranty?.length && sticker.totalMsrp == null && sticker.basePrice == null && sticker.totalOptions == null && sticker.destinationCharge == null ? (
            <p className="inventory-vehicle-document__empty">No window-sticker details are available for this vehicle.</p>
          ) : null}
          <RecordSourceDetails>
            {sticker.originalMarket || sticker.pricingCurrencyEvidence ? <p>{[sticker.originalMarket ? `Original market: ${sticker.originalMarket}.` : null, sticker.pricingCurrencyEvidence].filter(Boolean).join(" ")}</p> : null}
            {sticker.sourceMessage ? <p>{sticker.sourceMessage}</p> : null}
            <p>Original factory equipment does not confirm current condition or installed equipment.</p>
          </RecordSourceDetails>
        </article> : null) },
    { id: "equipment", label: "Equipment", content: (factoryEquipment ? <article
          className="inventory-vehicle-document inventory-vehicle-document--vauto"
          data-document-kind="vauto-factory-equipment"
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

          <RecordSourceAction href={factoryEquipmentUrl} label="Open equipment" accessibleLabel={`Open equipment details for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="Equipment details unavailable" />
          {factoryEquipment.basePrice != null ? (
            <dl className="inventory-vehicle-document__metrics inventory-vehicle-document__metrics--sticker" aria-label="Base MSRP">
              <Fact label="Base MSRP" emphasize>{compactSourcePrice(factoryEquipment.basePrice)}</Fact>
            </dl>
          ) : null}
          <RecordSourceDetails>
          {factoryEquipmentFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {factoryEquipmentFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}
          {factoryEquipment.disclaimer ? <p>{factoryEquipment.disclaimer}</p> : null}
          </RecordSourceDetails>

          {factoryEquipment.packages?.length ? (
            <CapturedRecordSection title="Packages & priced equipment" count={countLabel(factoryEquipment.packages.length, "VIN-linked item")}>
              <ul aria-label="vAuto package details">
                {factoryEquipment.packages.map((item, index) => {
                  const name = [item.name, item.code ? `(${item.code})` : null].filter(Boolean).join(" ");
                  return (
                    <li key={`${name}-${index}`}>
                      <span>
                        <strong>{name}</strong>
                        {item.price != null ? <b>{compactSourcePrice(item.price)}</b> : null}
                      </span>
                      {item.features?.length ? <small>{item.features.join(" · ")}</small> : null}
                    </li>
                  );
                })}
              </ul>
            </CapturedRecordSection>
          ) : null}

          {factoryEquipment.sections?.length ? (
            <CapturedRecordSection title="Full equipment breakdown" count={countLabel(factoryEquipment.sections.reduce((total, section) => total + section.items.length, 0), "item")}>
              <div className="vdp-record-equipment-groups">
                {factoryEquipment.sections.map((section) => (
                  <section aria-label={`${section.name} equipment`} key={section.name}>
                    <h4>{section.name}</h4>
                    <ul>
                      {section.items.map((item, index) => (
                        <li key={`${section.name}-${item.label}-${index}`}>
                          <span>{item.label}</span>
                          {item.price != null ? <b>{compactSourcePrice(item.price)}</b> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </CapturedRecordSection>
          ) : null}

        </article> : null) },
  ].filter(section => section.content !== null);

  return (
    <section ref={recordsRef}
      className="inventory-vehicle-documents vdp-records"
      aria-label="Vehicle documents"
      data-record-count={Number(Boolean(autoCheck)) + Number(Boolean(sticker)) + Number(Boolean(factoryEquipment)) + Number(Boolean(warrantyCheck)) + Number(Boolean(fordOasis)) + Number(showWarranty)}
    >


      <nav className="vdp-record-jumps" aria-label="Record sections">
        {sections.map(section => <button type="button" key={section.id} onClick={() => {
          const target = recordsRef.current?.querySelector<HTMLElement>(`[data-record-section="${section.id}"]`);
          focusWorkspaceSection(target ?? null);
        }}>{section.label}<ChevronDown size={14} aria-hidden="true" /></button>)}
      </nav>
      <div className="inventory-vehicle-documents__grid">
        {sections.map(section => <section key={section.id} data-record-section={section.id} tabIndex={-1} aria-label={section.label}>{section.content}</section>)}
      </div>

      <div className="inventory-vehicle-documents__disclaimer" id={readOnlyNoteId}>
        <AlertTriangle size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <strong>Records don’t confirm availability.</strong> Confirm current holds, location, service readiness, recalls, and installed equipment with the store.
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
    factoryEquipment?.totalMsrp != null ? { label: "VIN profile reference MSRP", value: formatReferencePrice(factoryEquipment.totalMsrp) } : null,
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
          <strong>{exactSourceCount ? "Vehicle equipment details" : "No factory equipment details are available"}</strong>
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
                      {item.price != null ? <b>{formatReferencePrice(item.price)}</b> : null}
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
                          {item.price != null ? ` · ${formatReferencePrice(item.price)}` : ""}
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
                {item.price != null ? formatReferencePrice(item.price) : factoryDocumented ? "Included" : "Published"}
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
  const configurationHeading = "Vehicle configuration";
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
      ? { label: "Reference MSRP", value: formatReferencePrice(profile.totalMsrp), source: "VIN equipment profile" }
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
            <small>{items.length ? `${items.length} equipment items, organized for quick customer questions` : "No equipment details available"}</small>
          </span>
        </span>
      </header>

      <div className="inventory-workspace-equipment-source-summary" data-source-depth={exactSourceCount ? "detailed" : "listing-only"}>
        <span>
          <strong>{exactSourceCount ? "Vehicle equipment details are available" : "Equipment details are limited"}</strong>
          <small>
            {exactSourceCount
              ? `${items.length} details organized below.`
              : `${listingCoverageCount} listed item${listingCoverageCount === 1 ? "" : "s"}; verify installed equipment on the vehicle.`}
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
            <span id="inventory-build-details-label">Vehicle configuration</span>
            <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <header>
            <span>
              <h4 id="inventory-factory-configuration-title">{configurationHeading}</h4>
              <small>Configuration details for this vehicle.</small>
            </span>
          </header>
          <dl>
            {configurationFacts.map((fact, index) => (
              <div className="inventory-workspace-configuration-fact" key={`${fact.label}-${fact.value}-${index}`}>
                <dt>{fact.label}</dt>
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
            <small>No equipment details are available for this vehicle.</small>
          </span>
        </div>
      )}

      <details className="inventory-workspace-equipment-evidence__method">
        <summary>
          <CircleHelp size={15} strokeWidth={1.8} aria-hidden="true" />
          Equipment notes
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        </summary>
        <p className="inventory-workspace-equipment-evidence__note">
          Confirm installed equipment and current condition on the vehicle before making commitments to a customer.
        </p>
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
              focusWorkspaceSection(target);
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
            <small>Key history and equipment details</small>
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
  const holdMessageKeys = new Set(vehicle.holdEvidence?.flatMap(hold => [
    ...(hold.alerts ?? []).map(message => `Alert|${message.text}|${message.author ?? ""}|${message.timestamp ?? ""}`),
    ...(hold.comments ?? []).map(message => `Comment|${message.text}|${message.author ?? ""}|${message.timestamp ?? ""}`),
  ]) ?? []);
  const messages = [
    ...evidence.alerts.map((message) => ({ ...message, kind: "Alert" })),
    ...evidence.comments.map((message) => ({ ...message, kind: "Comment" })),
  ].filter(message => !holdMessageKeys.has(`${message.kind}|${message.text}|${message.author ?? ""}|${message.timestamp ?? ""}`));
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
              <small>{[message.kind, message.author].filter(Boolean).join(" · ")}</small>
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
                <small>{[record.statusLabel, record.salesperson, record.holdDate && `Hold ${record.holdDate}`, record.expectedDate && `Expected ${record.expectedDate}`].filter(Boolean).join(" · ")}</small>
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
    const movementValue =
      humanizeWorkflowValue(vehicle.movement?.state) ||
      humanizeWorkflowValue(vehicle.movement?.requestStatus) ||
      null;
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
                ? "No active hold"
                : "Hold status needs review"}
            </h3>
            <p>Check availability with the home store before promising this vehicle.</p>
          </span>
        </header>
        <dl className="inventory-workspace-no-hold__facts">
          <Fact label="Hold status" emphasize>
            {noCurrentHold
              ? "No active hold recorded"
              : "Needs review"}
          </Fact>
          <Fact label="Home store">{vehicle.location.homeStore.name}</Fact>
          <Fact label="Location">{currentLocation.label}</Fact>
          <Fact label="Online listing">{publicListingValue}</Fact>
          {movementValue ? <Fact label="Move">{movementValue}</Fact> : null}
        </dl>
        <p
          className="inventory-workspace-no-hold__caveat"
          id="inventory-hold-availability-caveat"
        >
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>
            Confirm availability and physical custody with the home store.
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
          <small>Vehicle location</small>
        </span>
        {sameStore(current.store, location.homeStore) ? (
          <span className="inventory-location-badge">Home store</span>
        ) : null}
      </div>
      <dl className="inventory-fact-grid">
        <Fact label="Home store">{location.homeStore.name}</Fact>
        <Fact label="Current location">{location.conflict ? "Needs confirmation" : current.label}</Fact>
        {movement?.custodian || location.custodian ? <Fact label="Custodian">{movement?.custodian || location.custodian}</Fact> : null}
        {movement?.transportAssignee || location.transportAssignee ? <Fact label="Driver">{movement?.transportAssignee || location.transportAssignee}</Fact> : null}
      </dl>
      {movement ? (
        <>
          <dl className="inventory-fact-grid inventory-fact-grid--movement">
            <Fact label="Move status" emphasize>
              {humanizeWorkflowValue(movement.state) || humanizeWorkflowValue(movement.requestStatus) || "Needs review"}
            </Fact>
            <Fact
              label="Next action"
              emphasize
              className="inventory-workspace-fact--wide-mobile"
            >
              {movement.nextAction || "Review move"}
            </Fact>
            {movement.dueAt ? <Fact label="Due">
              {movement.dueAt
                ? formatDateTime(movement.dueAt)
                : ""}
            </Fact> : null}
            {movement.customerOutcome ? <Fact label="Customer outcome">{humanizeWorkflowValue(movement.customerOutcome)}</Fact> : null}
            {movement.deliveryConfirmation ? <Fact label="Delivery">{humanizeWorkflowValue(movement.deliveryConfirmation)}</Fact> : null}
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
          <h3>No active vehicle move</h3>
          <p>
            Start a move only when another store needs this vehicle.
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
            Recent inventory, hold, location, and movement activity for this vehicle.
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
  vehicle, canRequestVehicle = false, moveAction, initialTab = "overview", returnFocusRef,
  onClose, onViewVehicle, onRequestVehicle, onMoveVehicle, onTrackMovement, onOpenListing, onOpenSourceRecord,
}: VehicleWorkspaceProps) {
  const [activeTarget, setActiveTarget] = useState<WorkspaceSectionId>(initialTab);
  const [takeHomeOpen, setTakeHomeOpen] = useState(false);
  const takeHomeButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const dealerMailActionsRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"tab" | "dealermail" | null>(null);
  const activePage = workspacePage(activeTarget);
  const displayName = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl;
  const supportsFordDealerTools = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const invoiceUrl = supportsFordDealerTools ? fordInvoiceUrl(vehicle.vin) : null;
  const oasisUrl = supportsFordDealerTools ? fordOasisUrl(vehicle.vin) : null;
  const openRecallCount = vehicle.fordOasis?.openFieldServiceActions?.length ?? 0;
  const currentLocation = resolveCurrentLocation(vehicle);
  const canViewHoldEvidence = vehicle.dealerMail.canViewEvidence === true;
  const canManageDealerMail = vehicle.dealerMail.canManageHold === true;
  const primaryHold = canViewHoldEvidence
    ? vehicle.holdEvidence?.find((evidence) => evidence.position === "primary") ?? vehicle.holdEvidence?.[0]
    : undefined;
  const holdCurrent = vehicle.dealerMail.dataState === "current";
  const holdCount = vehicle.dealerMail.activeRecordCount ??
    (canViewHoldEvidence ? vehicle.holdEvidence?.length : null) ?? 0;
  const holdLabel = !holdCurrent ? "Hold status unverified"
    : vehicle.dealerMail.hasActiveHold === true
      ? "On hold"
      : vehicle.dealerMail.hasActiveHold === false ? "No current hold" : "Hold status not provided";
  const hasMovement = Boolean(vehicle.movement?.requestId || vehicle.movement?.state);
  const movementLabel = vehicle.movement?.overdue ? "Move needs action"
    : humanizeWorkflowValue(vehicle.movement?.state) || humanizeWorkflowValue(vehicle.movement?.requestStatus) || "No tracked move";
  const serviceStatus = serviceWorkflowStatus(vehicle.serviceReadiness);
  const serviceHref = `/service?vin=${encodeURIComponent(vehicle.vin)}`;
  const oasisInServiceDate = vehicle.fordOasis?.warrantyStartDate
    || vehicle.warrantyCheck?.fordOasis?.warrantyStartDate;
  const warrantyInServiceDate = oasisInServiceDate
    || vehicle.autoCheckReport?.estimatedInServiceDate
    || vehicle.warrantyCheck?.autoCheck?.inServiceDate
    || null;
  const warrantyInServiceLabel = "Warranty in-service";
  const hasStickerBase = vehicle.windowSticker?.basePrice != null;
  const baseMsrpLabel = "Weight fee lookup · Base MSRP";
  const baseMsrpDisplay = hasStickerBase
    ? compactSourcePrice(vehicle.windowSticker!.basePrice, vehicle.windowSticker!)
    : vehicle.factoryEquipment?.basePrice != null ? compactSourcePrice(vehicle.factoryEquipment.basePrice) : "—";
  const baseMsrpQualifier = null;
  const recordsNeedReview = [vehicle.publicListing.dataState, vehicle.dealerOn.dataState, vehicle.dealerMail.dataState]
    .some((state) => state !== "current");
  const keyEquipment = standoutEquipment(vehicle, 5);
  const specifications = [
    ["Mileage", formatMileage(vehicle.mileage)],
    ["Days listed", vehicle.daysListed != null ? `${vehicle.daysListed} days` : null],
    ["Engine", vehicle.engine], ["Drivetrain", vehicle.drivetrain],
    ["Transmission", vehicle.transmission], ["Body style", vehicle.bodyStyle || vehicle.bodyType],
    ["Exterior / interior", [vehicle.exteriorColor, vehicle.interiorColor].filter(Boolean).join(" / ")],
  ].filter((fact) => Boolean(fact[1]));
  const mobileSpecificationLines = [
    [formatMileage(vehicle.mileage), vehicle.daysListed != null ? `${vehicle.daysListed} days` : null].filter(Boolean).join(" · "),
    [vehicle.engine, vehicle.drivetrain].filter(Boolean).join(" · "),
    [vehicle.exteriorColor, vehicle.interiorColor].filter(Boolean).join(" / "),
  ].filter(Boolean);
  // `moveAction` is the role-aware server-backed path. Keep the legacy
  // boolean prop as a compatibility fallback, but never let it overrule the
  // server's explicit active-move/blocking decision.
  const resolvedMoveAction = moveAction ?? (!isMoveRequestBlocked(vehicle) && canRequestVehicle
    ? { intent: "request" as const, label: "Request vehicle", shortLabel: "Request" }
    : null);
  const canTrackMovement = Boolean(vehicle.movement?.requestId && onTrackMovement);
  const canCreateMovement = Boolean(resolvedMoveAction && (onMoveVehicle || onRequestVehicle) && (!canTrackMovement || moveAction));
  const movementAction = <>
    {canTrackMovement ? <button type="button" onClick={() => onTrackMovement?.(vehicle)} data-action="track-movement"><Truck size={18} aria-hidden="true" />Track movement</button> : null}
    {canCreateMovement && resolvedMoveAction ? <button type="button" onClick={() => onMoveVehicle ? onMoveVehicle(vehicle, resolvedMoveAction.intent) : onRequestVehicle?.(vehicle)} data-action={resolvedMoveAction.intent === "direct" ? "move-vehicle" : "request-vehicle"}><ArrowLeftRight size={18} aria-hidden="true" />{resolvedMoveAction.label}</button> : null}
  </>;

  function openAndFocusSection(target: WorkspaceSectionId) {
    pendingFocus.current = "tab";
    setActiveTarget(target);
    // Reselecting the current section also returns to its beginning.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (target === activeTarget) activeTabRef.current?.focus({ preventScroll: true });
  }
  function focusDealerMailActions() {
    pendingFocus.current = "dealermail";
    setActiveTarget("hold");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (activeTarget === "hold") dealerMailActionsRef.current
      ?.querySelector<HTMLButtonElement>(".inventory-dealermail-handoff__launch")?.focus({ preventScroll: true });
  }
  function onSectionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % WORKSPACE_SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + WORKSPACE_SECTIONS.length) % WORKSPACE_SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = WORKSPACE_SECTIONS.length - 1;
    else return;
    event.preventDefault();
    openAndFocusSection(WORKSPACE_SECTIONS[next].id);
  }
  useLayoutEffect(() => {
    setActiveTarget(initialTab);
    setTakeHomeOpen(false);
    pendingFocus.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [initialTab, vehicle.id]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (pendingFocus.current === "dealermail") {
      dealerMailActionsRef.current?.querySelector<HTMLButtonElement>(".inventory-dealermail-handoff__launch")?.focus({ preventScroll: true });
    } else if (pendingFocus.current === "tab") {
      activeTabRef.current?.focus({ preventScroll: true });
    }
    pendingFocus.current = null;
  }, [activeTarget, vehicle.id]);
  useContainedFocus({
    active: !takeHomeOpen, contain: true, containerRef: workspaceRef, initialFocusRef: activeTabRef,
    returnFocusRef, onEscape: onClose,
  });

  return createPortal(
    <>
      <div className={`inventory-workspace-backdrop vdp-focus-backdrop${takeHomeOpen ? " is-take-home-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside id="inventory-vehicle-workspace" className={`inventory-workspace inventory-workspace--focused${takeHomeOpen ? " is-take-home-open" : ""}`}
        ref={workspaceRef} role="dialog" aria-modal="true" aria-label={displayName + " vehicle workspace"} tabIndex={-1}
        data-active-section={activePage} data-active-target={activeTarget}>
        <header className="vdp-focus-header">
          <button type="button" className="vdp-focus-back" onClick={onClose} aria-label="Back to inventory"><ChevronLeft size={20} aria-hidden="true" /><span>Back to inventory</span></button>
          <div className="vdp-focus-identity"><h2 id="inventory-workspace-title">{displayName}</h2><strong>{formatMoney(vehicle.price)}</strong></div>
          <dl className="vdp-focus-identifiers">
            <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stockNumber} /></dd></div>
            <div><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin} /></dd></div>
          </dl>
          <button type="button" className="vdp-focus-close" onClick={onClose} aria-label="Close vehicle details"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="vdp-focus-navigation">
          <div className="vdp-focus-tabs" role="tablist" aria-label="Vehicle workspace sections">
            {WORKSPACE_SECTIONS.map((section, index) => <button type="button" role="tab" id={"inventory-tab-" + section.id}
              aria-controls={"inventory-section-" + section.id} aria-selected={activePage === section.id}
              tabIndex={activePage === section.id ? 0 : -1} ref={activePage === section.id ? activeTabRef : undefined}
              onKeyDown={event => onSectionKeyDown(event, index)}
              onClick={() => openAndFocusSection(section.id)} key={section.id}>{section.label}</button>)}
          </div>
          <a className={"vdp-focus-service vdp-focus-service--" + serviceStatus} href={serviceHref}>Service: {serviceStatusLabel(vehicle.serviceReadiness)}</a>
        </div>
        <div className="vdp-focus-scroll" ref={scrollRef}>
          <WorkspacePanel id="overview" label="Overview" active={activePage === "overview"}>
            <div className="vdp-focus-overview">
              <div className="vdp-focus-photo"><VehicleGallery vehicle={vehicle} /></div>
              <section className="vdp-focus-specs" aria-label="Vehicle specifications">
                <h3>Vehicle details</h3>
                <dl className="vdp-focus-desktop-specs">{specifications.map(([label, value]) => <Fact key={label} label={label!}>{value}</Fact>)}</dl>
                <div className="vdp-focus-mobile-specs">{mobileSpecificationLines.map((line, index) => <p key={index}>{line}</p>)}</div>
                <p className="vdp-focus-listing">{vehicle.location.homeStore.name} · {vehicle.publicListing.dataState !== "current" ? "Listing unverified" : vehicle.publicListing.isListed ? "Listed online" : "Not listed online"}{vehicle.certified ? " · Certified" : ""}</p>
              </section>
              <section className="vdp-focus-operations" aria-label="Vehicle operational summary">
                <h3>Operations</h3>
                <dl>
                  <Fact label="Location"><strong>{currentLocation.label}</strong>{vehicle.location.conflict ? <small>Location conflict — review needed</small> : null}</Fact>
                  <Fact label="Hold status"><strong>{holdCurrent && vehicle.dealerMail.hasActiveHold && primaryHold?.salesperson ? `Held · ${primaryHold.salesperson}` : holdLabel}</strong>{holdCount > 1 ? <small className="vdp-focus-mobile-backup">{holdCount - 1} backup {holdCount === 2 ? "hold" : "holds"}</small> : null}</Fact>
                  {!holdCurrent && primaryHold?.salesperson ? <Fact label="Salesperson">{primaryHold.salesperson}</Fact> : null}
                  {primaryHold?.expectedDeliveryDate ? <Fact label="Expected">{formatDate(primaryHold.expectedDeliveryDate)}</Fact> : null}
                  {holdCount > 1 ? <Fact label="Backup holds" className="vdp-focus-desktop-field">{holdCount - 1}</Fact> : null}
                  <Fact label="Service status" className="vdp-focus-desktop-field"><span className={"vdp-focus-service-text--" + serviceStatus}>{serviceStatusLabel(vehicle.serviceReadiness)}</span></Fact>
                </dl>
                <div className="vdp-focus-actions">
                  {movementAction}
                  <button type="button" onClick={canManageDealerMail ? focusDealerMailActions : () => openAndFocusSection("hold")}
                    data-action={canManageDealerMail ? "dealermail-tools" : "hold-details"}><MessageSquare size={18} aria-hidden="true" />{canManageDealerMail ? "DealerMail tools" : "View hold status"}</button>
                  {serviceStatus === "needs_service" ? <a href={serviceHref + "&action=in_service"}>Start service</a> : null}
                  {serviceStatus !== "serviced" ? <a href={serviceHref + "&action=serviced"}>Mark Ready</a> : <a href={serviceHref}>Service history</a>}
                </div>
                <p className="vdp-focus-note">Confirm with the home store before promising availability.</p>
              </section>
            </div>
            <section className="vdp-focus-keyfacts" aria-label="Frequently used vehicle facts">
              <Fact label={warrantyInServiceLabel}>{warrantyInServiceDate ? formatDate(warrantyInServiceDate) : "—"}</Fact>
              <Fact label={baseMsrpLabel}>{baseMsrpDisplay}{baseMsrpQualifier ? <small>{baseMsrpQualifier}</small> : null}</Fact>
              <Fact label="Inventory date">{vehicle.inventoryDate ? formatDate(vehicle.inventoryDate) : "—"}</Fact>
            </section>
            <div className="vdp-focus-highlights">
              <section aria-label="Key equipment"><div className="vdp-focus-section-heading"><h3>Key equipment</h3><button type="button" onClick={() => openAndFocusSection("equipment")}>View all equipment <ChevronRight size={16} aria-hidden="true" /></button></div>
                {keyEquipment.length ? <ul>{keyEquipment.map(item => <li key={item.label}><Check size={16} aria-hidden="true" /><span>{item.label}</span></li>)}</ul> : <p>No equipment highlights are available.</p>}
              </section>
              <section aria-label="Hold and move summary"><div className="vdp-focus-section-heading"><h3>Hold &amp; move summary</h3><button type="button" onClick={() => openAndFocusSection("hold")}>View details <ChevronRight size={16} aria-hidden="true" /></button></div>
                <p><strong>{hasMovement ? movementLabel : holdLabel}</strong></p>
                <p>{vehicle.movement?.nextAction || vehicle.movement?.lastEventLabel || "Confirm the hold and vehicle location with the home store."}</p>
              </section>
            </div>
            <section className="vdp-focus-resources" aria-label="Documents and vehicle records">
              <h3>Documents &amp; vehicle records</h3>
              <VehicleResourceCards vehicle={vehicle} variant="cards" onOpenSection={openAndFocusSection} />
            </section>
            {vehicle.managerDisposition ? <p className="vdp-focus-warning"><ClipboardCheck size={16} aria-hidden="true" /><strong>Manager log: {vehicle.managerDisposition.soldLabel}</strong> · {vehicle.managerDisposition.deliveryLabel}{vehicle.managerDisposition.deliveryDate ? ` · ${formatDate(vehicle.managerDisposition.deliveryDate)}` : ""}<small>Independent of listing, hold, CDK, and location.</small></p> : null}
            {openRecallCount ? <button type="button" className="vdp-focus-warning" onClick={() => openAndFocusSection("data")}
              aria-label={`${countLabel(openRecallCount, "open Ford recall or field service action", "open Ford recalls or field service actions")}; review vehicle records`}><AlertTriangle size={16} aria-hidden="true" />{countLabel(openRecallCount, "open recall")} · Review vehicle records</button> : null}
            {recordsNeedReview ? <button type="button" className="vdp-focus-warning" onClick={() => openAndFocusSection("data")}><AlertTriangle size={16} aria-hidden="true" />Some vehicle information needs review.</button> : null}
          </WorkspacePanel>
          <WorkspacePanel id="equipment" label="Equipment" active={activePage === "equipment"}>
            <EquipmentCategoryIndex vehicle={vehicle} />
            <SourceConfirmedEquipment vehicle={vehicle} />
            <section className="vdp-focus-description" aria-label="Vehicle description"><h3>Description</h3><p>{vehicle.dealerComments || "No vehicle description was published."}</p></section>
            <section aria-label="Complete vehicle specifications"><h3>Specifications</h3><dl className="vdp-focus-extra-specs">{specifications.map(([label, value]) => <Fact key={label} label={label!}>{value}</Fact>)}<Fact label="Fuel">{vehicle.fuelType || "Not published"}</Fact><Fact label="Listed MSRP">{vehicle.msrp != null ? formatMoney(vehicle.msrp) : "Not published"}</Fact><Fact label="Inventory date">{vehicle.inventoryDate ? formatDate(vehicle.inventoryDate) : "Not published"}</Fact></dl></section>
          </WorkspacePanel>
          <WorkspacePanel id="data" label="Records" active={activePage === "data"}>
            <dl className="vdp-records-summary"><Fact label={baseMsrpLabel}>{baseMsrpDisplay}{baseMsrpQualifier ? <small>{baseMsrpQualifier}</small> : null}</Fact><Fact label={warrantyInServiceLabel}>{warrantyInServiceDate ? formatDate(warrantyInServiceDate) : "—"}</Fact></dl>
            <VehicleDocuments vehicle={vehicle} />
            {!vehicle.autoCheckReport && !vehicle.windowSticker && !vehicle.factoryEquipment && !vehicle.fordOasis && !vehicle.warrantyCheck ? <div className="vdp-focus-empty"><h3>Vehicle records</h3><p>No vehicle records are available.</p></div> : null}
            {openRecallCount ? <a className="vdp-focus-warning" href={oasisUrl ?? undefined} target="_blank" rel="noopener noreferrer">{countLabel(openRecallCount, "open Ford recall or field service action", "open Ford recalls or field service actions")} · Review OASIS</a> : null}
          </WorkspacePanel>
          <WorkspacePanel id="hold" label="Holds & moves" active={activePage === "hold"}>
            <div className="vdp-focus-section-heading"><h3>Holds &amp; moves</h3><div className="vdp-focus-actions">{movementAction}</div></div>
            <div className="vdp-focus-hold-grid inventory-workspace-hold-center" data-hold-state={vehicle.holdEvidence?.length ? "held" : "no-evidence"}>
              <div><HoldDetails vehicle={vehicle} /></div>
              <div>{canManageDealerMail ? <DealerMailHandoff key={vehicle.id + "|" + vehicle.stockNumber + "|" + vehicle.vin} vehicle={vehicle} panelRef={dealerMailActionsRef} /> : null}
                <section id="inventory-section-movement" tabIndex={-1} aria-labelledby="inventory-movement-heading" className="vdp-focus-movement"><h3 id="inventory-movement-heading">Location &amp; movement</h3><MovementDetails vehicle={vehicle} /></section>
              </div>
            </div>
          </WorkspacePanel>
          <WorkspacePanel id="timeline" label="Activity" active={activePage === "timeline"}><TimelineDetails vehicle={vehicle} /></WorkspacePanel>
        </div>
        <footer className="vdp-focus-footer">
          <span>Inventory Flow <strong>MAXEY</strong></span>
          <div role="toolbar" aria-label="Vehicle actions">
            {listingUrl ? onOpenListing ? <button type="button" onClick={() => onOpenListing(vehicle)} data-action="open-listing"><Globe2 size={18} aria-hidden="true" />Listing</button>
              : <a href={listingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="open-listing" data-read-only="true"><Globe2 size={18} aria-hidden="true" />Listing</a> : null}
            {invoiceUrl ? <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="invoice" data-read-only="true"><FileText size={18} aria-hidden="true" />Invoice</a> : null}
            <button type="button" onClick={() => setTakeHomeOpen(true)} data-action="take-home" ref={takeHomeButtonRef}><Printer size={18} aria-hidden="true" />Take-home page</button>
            {onViewVehicle ? <button type="button" onClick={() => onViewVehicle(vehicle)} data-action="open-record">Full record</button> : null}
          </div>
        </footer>
      </aside>
      {takeHomeOpen ? <TakeHomeSheet vehicle={vehicle} onClose={() => setTakeHomeOpen(false)} returnFocusRef={takeHomeButtonRef} /> : null}
    </>, document.body,
  );
}
