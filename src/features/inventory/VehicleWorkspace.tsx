import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
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
  Database,
  ExternalLink,
  FileText,
  FileSearch,
  Gauge,
  Globe2,
  History,
  ImageOff,
  MapPin,
  Mail,
  MessageSquare,
  Ellipsis,
  Navigation,
  PencilLine,
  ShieldCheck,
  Store,
  Tag,
  Truck,
  Trash2,
  UserPlus,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { CopyableValue, copyExactText } from "../../components/CopyableValue";
import { FactoryStickerIcon } from "../../design-system/icons";
import {
  formatDate,
  formatDateTime,
  formatMileage,
  formatMoney,
  formatStickerMoney,
  resolveCurrentLocation,
  sameStore,
  vehicleDisplayName,
} from "./inventory-utils";
import { primaryVehicleChangeSignal } from "./change-utils";
import {
  autoCheckResultTone,
  dealerMailInteractiveVehicleUrl,
  fordInvoiceUrl,
  fordOasisUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from "./vehicle-document-utils";
import { standoutEquipment } from "./vehicle-feature-utils";
import { useContainedFocus } from "../../lib/useContainedFocus";
import type {
  DealerMailHoldEvidence,
  InventoryVehicle,
  SourceDataState,
  VehicleTimelineEvent,
  VehicleTimelineSource,
  VehicleWorkspaceProps,
  VehicleWorkspaceTab,
} from "./types";
import "./VehicleWorkspace.compact-v3.css";
import "./VehicleWorkspace.v10.css";

type WorkspaceSectionId =
  | "overview"
  | "hold"
  | "movement"
  | "equipment"
  | "timeline"
  | "data";

const WORKSPACE_SECTIONS: Array<{
  id: WorkspaceSectionId;
  label: string;
  mobileLabel: string;
  mobileOverflow?: boolean;
}> = [
  { id: "overview", label: "Overview", mobileLabel: "Overview" },
  { id: "hold", label: "Hold and availability", mobileLabel: "Hold" },
  { id: "movement", label: "Location and movement", mobileLabel: "Movement" },
  { id: "equipment", label: "Equipment", mobileLabel: "Equipment" },
  { id: "timeline", label: "History", mobileLabel: "History", mobileOverflow: true },
  { id: "data", label: "Record details", mobileLabel: "Record", mobileOverflow: true },
];

const MOBILE_PRIMARY_SECTIONS = WORKSPACE_SECTIONS.filter(
  (section) => !section.mobileOverflow,
);

const COMPACT_WORKSPACE_MEDIA_QUERY = "(max-width: 768px)";
const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function usesCompactMobileWorkspace(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(COMPACT_WORKSPACE_MEDIA_QUERY).matches
  );
}

function workspaceScrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
    ? "auto"
    : "smooth";
}

interface DealerMailLaunchFeedback {
  kind: "opened" | "blocked";
  message: string;
}

type DealerMailIntent =
  | "view-inventory"
  | "place-hold"
  | "add-backup"
  | "comments"
  | "alerts"
  | "review-change"
  | "review-remove";

interface DealerMailActionDefinition {
  intent: DealerMailIntent;
  label: string;
  displayLabel?: string;
  description: string;
  shortDescription: string;
  tone: "primary" | "hold" | "message" | "danger";
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

const DEALERMAIL_ACTIONS: Record<DealerMailIntent, DealerMailActionDefinition> = {
  "view-inventory": {
    intent: "view-inventory",
    label: "Find Vehicle in DealerMail",
    displayLabel: "Find vehicle",
    description: "Search DealerMail by this exact stock, then verify the VIN and use its native vehicle tools.",
    shortDescription: "Open the exact stock record",
    tone: "primary",
  },
  "place-hold": {
    intent: "place-hold",
    label: "Place Hold in DealerMail",
    displayLabel: "Place primary hold",
    description: "Confirm the vehicle and availability before placing a hold.",
    shortDescription: "Start a verified primary hold",
    tone: "hold",
  },
  "add-backup": {
    intent: "add-backup",
    label: "Add Backup in DealerMail",
    displayLabel: "Add backup hold",
    description: "Review the primary hold before adding a separate backup.",
    shortDescription: "Add a separate backup position",
    tone: "hold",
  },
  comments: {
    intent: "comments",
    label: "Comments in DealerMail",
    displayLabel: "Vehicle comments",
    description: "Review the vehicle record before reading or adding comments.",
    shortDescription: "Review or add vehicle notes",
    tone: "message",
  },
  alerts: {
    intent: "alerts",
    label: "Alerts in DealerMail",
    displayLabel: "Vehicle alerts",
    description: "Review the vehicle record before reading or adding alerts.",
    shortDescription: "Review or add an inventory alert",
    tone: "message",
  },
  "review-change": {
    intent: "review-change",
    label: "Review / Change Hold in DealerMail",
    displayLabel: "Review or change hold",
    description: "Inspect the live hold record before making an authorized change.",
    shortDescription: "Verify the live record before editing",
    tone: "hold",
  },
  "review-remove": {
    intent: "review-remove",
    label: "Review / Remove Hold in DealerMail",
    displayLabel: "Review or remove hold",
    description: "Inspect the live record; nothing is removed from this app.",
    shortDescription: "Verify authorization before removal",
    tone: "danger",
  },
};

function dealerMailIntentInstruction(intent: DealerMailIntent): string {
  switch (intent) {
    case "view-inventory":
      return "review the complete vehicle record";
    case "place-hold":
      return "confirm availability and place the hold only if appropriate";
    case "add-backup":
      return "review the primary hold and add a backup only if appropriate";
    case "comments":
      return "review or add comments inside DealerMail";
    case "alerts":
      return "review or add alerts inside DealerMail";
    case "review-change":
      return "review the current hold before making any authorized change";
    case "review-remove":
      return "review the current hold and remove it only if authorized and appropriate";
  }
}

function DealerMailActionIcon({ intent }: { intent: DealerMailIntent }) {
  switch (intent) {
    case "view-inventory":
      return <FileSearch size={21} strokeWidth={1.8} aria-hidden="true" />;
    case "place-hold":
    case "add-backup":
      return <UserPlus size={21} strokeWidth={1.8} aria-hidden="true" />;
    case "review-change":
      return <PencilLine size={21} strokeWidth={1.8} aria-hidden="true" />;
    case "comments":
      return <MessageSquare size={21} strokeWidth={1.8} aria-hidden="true" />;
    case "alerts":
      return <Bell size={21} strokeWidth={1.8} aria-hidden="true" />;
    case "review-remove":
      return <Trash2 size={21} strokeWidth={1.8} aria-hidden="true" />;
  }
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
      aria-expanded={active}
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

function DealerMailHoldGuide({
  vehicle,
  onOpen,
  panelRef,
}: {
  vehicle: InventoryVehicle;
  onOpen: (intent: DealerMailIntent) => void;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const holdCurrent = vehicle.dealerMail.dataState === "current";
  const confirmedHeld =
    holdCurrent && vehicle.dealerMail.hasActiveHold === true;
  const confirmedNoHold =
    holdCurrent && vehicle.dealerMail.hasActiveHold === false;
  const verificationOnly = !confirmedHeld && !confirmedNoHold;
  const actions: DealerMailActionDefinition[] = [
    DEALERMAIL_ACTIONS["view-inventory"],
    ...(confirmedNoHold ? [DEALERMAIL_ACTIONS["place-hold"]] : []),
    ...(confirmedHeld ? [DEALERMAIL_ACTIONS["add-backup"]] : []),
    DEALERMAIL_ACTIONS.comments,
    DEALERMAIL_ACTIONS.alerts,
    ...(confirmedHeld
      ? [
          DEALERMAIL_ACTIONS["review-change"],
          DEALERMAIL_ACTIONS["review-remove"],
        ]
      : []),
  ];
  const primaryActions = actions.filter((action) =>
    ["view-inventory", "place-hold", "add-backup", "comments", "alerts"].includes(action.intent),
  );
  const secondaryActions = actions.filter((action) =>
    ["review-change", "review-remove"].includes(action.intent),
  );
  const actionButton = (action: DealerMailActionDefinition) => {
    const descriptionId = `inventory-dealermail-action-${action.intent}-description`;
    return (
      <button
        type="button"
        className={`inventory-dealermail-action inventory-dealermail-action--compact inventory-dealermail-action--${action.tone}`}
        key={action.intent}
        onClick={() => onOpen(action.intent)}
        aria-label={action.label}
        aria-describedby={`inventory-dealermail-preflight${vehicle.dealerMail.canViewEvidence ? " inventory-hold-availability-caveat" : ""} ${descriptionId}`}
        data-dealermail-intent={action.intent}
        data-action-tone={action.tone}
      >
        <span className="inventory-dealermail-action__icon">
          <DealerMailActionIcon intent={action.intent} />
        </span>
        <span className="inventory-dealermail-action__copy">
          <strong>{action.displayLabel ?? action.label}</strong>
          <small aria-hidden="true">{action.shortDescription}</small>
          <span className="inventory-sr-only" id={descriptionId}>{action.description}</span>
        </span>
        <ExternalLink
          className="inventory-dealermail-action__external"
          size={17}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>
    );
  };

  return (
    <section
      id="inventory-dealermail-actions"
      className="inventory-dealermail-actions inventory-dealermail-actions--full-width inventory-dealermail-actions--dense inventory-workspace-dealermail-rail"
      aria-labelledby="inventory-dealermail-actions-title"
      aria-describedby={vehicle.dealerMail.canViewEvidence ? "inventory-hold-availability-caveat" : undefined}
      ref={panelRef}
      tabIndex={-1}
      data-action-group="dealermail"
      data-action-count={actions.length}
      data-hold-verification={verificationOnly ? "required" : "current"}
    >
      <header className="inventory-dealermail-actions__header">
        <span className="inventory-dealermail-actions__mark">
          <UserRound size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>
          <strong id="inventory-dealermail-actions-title">
            DealerMail vehicle tools
          </strong>
          <small>
            Opens DealerMail’s complete interactive inventory screen. Verify
            stock and VIN before any change.
          </small>
        </span>
      </header>
      <p
        className="inventory-dealermail-actions__preflight"
        id="inventory-dealermail-preflight"
      >
        <strong>Verify first</strong>
        <span>LAST8 / STOCK</span>
        <CopyableValue compact label="DealerMail stock number" text={vehicle.stockNumber}>
          <b>{vehicle.stockNumber}</b>
        </CopyableValue>
        <span>Full VIN</span>
        <CopyableValue compact label="DealerMail VIN" text={vehicle.vin}>
          <b>{vehicle.vin}</b>
        </CopyableValue>
      </p>
      {verificationOnly ? (
        <div
          className="inventory-dealermail-actions__warning"
          role="note"
        >
          <AlertTriangle size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <strong>Hold status is not confirmed.</strong> Only inventory,
            comments, and alerts are available here until the DealerMail record
            is verified.
          </span>
        </div>
      ) : null}
      <div className="inventory-dealermail-actions__grid">
        {primaryActions.map(actionButton)}
      </div>
      {secondaryActions.length ? (
        <details className="inventory-dealermail-actions__more">
          <summary>
            More hold actions
            <small>{secondaryActions.length}</small>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </summary>
          <div className="inventory-dealermail-actions__grid inventory-dealermail-actions__grid--secondary">
            {secondaryActions.map(actionButton)}
          </div>
        </details>
      ) : null}
      <p className="inventory-dealermail-actions__safety">
        <ShieldCheck size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>No CRM action happens here. Complete authorized work only in the verified live DealerMail record.</span>
      </p>
    </section>
  );
}

function VehicleDocuments({ vehicle }: { vehicle: InventoryVehicle }) {
  const autoCheck = vehicle.autoCheckReport;
  const sticker = vehicle.windowSticker;
  const factoryEquipment = vehicle.factoryEquipment;
  if (!autoCheck && !sticker && !factoryEquipment) return null;
  const autoCheckUrl = officialVehicleDocumentUrl(autoCheck?.url, "autocheck", vehicle.publicListing.listingUrl);
  const stickerUrl = officialVehicleDocumentUrl(sticker?.url, "window-sticker", vehicle.publicListing.listingUrl);
  const factoryEquipmentUrl = vautoFactoryEquipmentUrl(factoryEquipment?.url);
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
      data-record-count={Number(Boolean(autoCheck)) + Number(Boolean(sticker)) + Number(Boolean(factoryEquipment))}
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
      </div>

      <div className="inventory-vehicle-documents__disclaimer" id={readOnlyNoteId}>
        <AlertTriangle size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <strong>Documents are reference sources—not availability signals.</strong> These links are read-only. AutoCheck history, original sticker data, and vAuto informational equipment data do not confirm current condition, a hold, custody, sale, delivery, price, retail readiness, or physical availability. Confirm live status and installed equipment with the store.
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
        <section
          className="inventory-workspace-factory-configuration inventory-workspace-factory-configuration--v10"
          id="inventory-equipment-configuration"
          aria-labelledby="inventory-factory-configuration-title"
          tabIndex={-1}
        >
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
        </section>
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
      ? [{ id: "inventory-equipment-configuration", label: "Configuration", count: null }]
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
  const standoutItems = standoutEquipment(vehicle, 4);
  const selectedFeatures = standoutItems.length
    ? standoutItems.map((item) => item.label)
    : vehicle.features?.slice(0, 4) ?? [];

  return (
    <section
      className="inventory-workspace-intelligence"
      aria-labelledby="inventory-workspace-intelligence-title"
      data-content-state={facts.length ? "available" : "empty"}
    >
      <header className="inventory-workspace-section-heading">
        <Gauge size={18} strokeWidth={1.75} aria-hidden="true" />
        <h3 id="inventory-workspace-intelligence-title">Vehicle intelligence</h3>
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
      {selectedFeatures.length ? (
        <div className="inventory-workspace-intelligence__features" aria-label="Selected published features">
          {selectedFeatures.map((feature) => <span key={feature}>{feature}</span>)}
        </div>
      ) : null}
    </section>
  );
}

function RecentChanges({ vehicle }: { vehicle: InventoryVehicle }) {
  const events = useMemo(() => vehicleTimelineEvents(vehicle).slice(0, 4), [vehicle]);
  return (
    <section
      className="inventory-workspace-recent-changes"
      aria-labelledby="inventory-workspace-recent-changes-title"
      data-content-state={events.length ? "available" : "empty"}
    >
      <header className="inventory-workspace-section-heading">
        <Clock3 size={18} strokeWidth={1.75} aria-hidden="true" />
        <h3 id="inventory-workspace-recent-changes-title">Recent changes</h3>
      </header>
      {events.length ? (
        <ol className="inventory-workspace-recent-changes__list">
          {events.map((event) => (
            <li key={event.id} data-event-source={event.source}>
              <span className={`inventory-timeline__icon inventory-timeline__icon--${event.source}`}>
                <TimelineIcon source={event.source} />
              </span>
              <span>
                <strong>{event.title}</strong>
                {event.detail ? <small>{event.detail}</small> : null}
                <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="inventory-workspace-section-note">No dated change events were supplied.</p>
      )}
    </section>
  );
}

function OverviewDetails({
  vehicle,
  onOpenRecords,
}: {
  vehicle: InventoryVehicle;
  onOpenRecords?: () => void;
}) {
  const description = vehicle.dealerComments || "No vehicle description was published.";
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const autoCheck = vehicle.autoCheckReport;
  const sticker = vehicle.windowSticker;
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
      label: "AutoCheck in service",
      value: formatDate(autoCheck.estimatedInServiceDate),
    } : null,
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
          className={descriptionExpanded ? "is-expanded" : undefined}
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
        <h3 id="inventory-overview-highlights-title">Published highlights</h3>
        {highlights.length ? (
          <ul>
            {highlights.map((feature) => (
              <li key={feature}><CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" /> {feature}</li>
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
  return (
    <div className="inventory-workspace-detail-content">
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
          {location.appConfirmedLocation ||
            location.appConfirmedStore?.name ||
            "Not confirmed"}
        </Fact>
        <Fact label="Last confirmed">
          {formatDateTime(location.appConfirmedAt)}
        </Fact>
        <Fact label="Confirmed by">
          {location.appConfirmedBy || "Not recorded"}
        </Fact>
        <Fact label="Custodian">
          {movement?.custodian || location.custodian || "Not assigned"}
        </Fact>
        <Fact label="Driver">
          {movement?.transportAssignee ||
            location.transportAssignee ||
            "Not set up"}
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
              {movement.requestId || "Not assigned"}
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

function initialSection(tab: VehicleWorkspaceTab): WorkspaceSectionId {
  return tab;
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
  const [activeSection, setActiveSection] = useState<WorkspaceSectionId>(() =>
    initialSection(initialTab),
  );
  const [compactMobileWorkspace, setCompactMobileWorkspace] = useState(
    usesCompactMobileWorkspace,
  );
  const workspaceRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dealerMailActionsRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const mobileSectionMoreRef = useRef<HTMLDetailsElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayName = vehicleDisplayName(vehicle);
  const oemTheme = oemThemeToken(vehicle.make);
  const listingUrl = vehicle.publicListing.listingUrl;
  const dealerMailUrl = dealerMailInteractiveVehicleUrl(vehicle.stockNumber);
  const autoCheckUrl = officialVehicleDocumentUrl(
    vehicle.autoCheckReport?.url,
    "autocheck",
    listingUrl,
  );
  const hasVehicleRecords = Boolean(
    vehicle.autoCheckReport || vehicle.windowSticker || vehicle.factoryEquipment,
  );
  const stickerUrl = officialVehicleDocumentUrl(
    vehicle.windowSticker?.url,
    "window-sticker",
    listingUrl,
  );
  const factoryEquipmentUrl = vautoFactoryEquipmentUrl(vehicle.factoryEquipment?.url);
  const supportsFordDealerTools = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const invoiceUrl = supportsFordDealerTools ? fordInvoiceUrl(vehicle.vin) : null;
  const oasisUrl = supportsFordDealerTools ? fordOasisUrl(vehicle.vin) : null;
  const currentLocation = resolveCurrentLocation(vehicle);
  const canViewHoldEvidence = vehicle.dealerMail.canViewEvidence === true;
  const primaryHold = canViewHoldEvidence
    ? vehicle.holdEvidence?.find((evidence) => evidence.position === "primary") ??
      vehicle.holdEvidence?.[0]
    : undefined;
  const holdCurrent = vehicle.dealerMail.dataState === "current";
  const holdCount =
    vehicle.dealerMail.activeRecordCount ??
    (canViewHoldEvidence ? vehicle.holdEvidence?.length : null) ??
    0;
  const hasMovement = Boolean(
    vehicle.movement &&
      (vehicle.movement.state ||
        vehicle.movement.requestStatus ||
        vehicle.movement.custodyStatus ||
        vehicle.movement.requestId),
  );
  const recentChange = primaryVehicleChangeSignal(vehicle.changeSummary);
  const [dealerMailFeedback, setDealerMailFeedback] = useState<DealerMailLaunchFeedback | null>(null);
  const vehicleLaunchKey = `${vehicle.id}|${vehicle.vin}|${vehicle.stockNumber}`;
  const currentVehicleLaunchKeyRef = useRef(vehicleLaunchKey);
  currentVehicleLaunchKeyRef.current = vehicleLaunchKey;

  useEffect(() => {
    setActiveSection(initialSection(initialTab));
    setDealerMailFeedback(null);
  }, [initialTab, vehicle.id]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const compactWorkspaceQuery = window.matchMedia(COMPACT_WORKSPACE_MEDIA_QUERY);
    const syncCompactWorkspace = () => setCompactMobileWorkspace(compactWorkspaceQuery.matches);
    syncCompactWorkspace();
    compactWorkspaceQuery.addEventListener?.("change", syncCompactWorkspace);
    return () => compactWorkspaceQuery.removeEventListener?.("change", syncCompactWorkspace);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top: 0, behavior: "auto" });
      } else {
        scroller.scrollTop = 0;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSection, vehicle.id]);

  const openDealerMailIntent = (intent: DealerMailIntent) => {
    const action = DEALERMAIL_ACTIONS[intent];
    const nextStep = dealerMailIntentInstruction(intent);
    const noActionPerformed =
      intent === "review-remove"
        ? " Nothing was removed here."
        : " No hold, backup, comment, alert, change, or removal was performed here.";
    if (!dealerMailUrl) {
      setDealerMailFeedback({
        kind: "blocked",
        message: `DealerMail did not open because this record has no usable stock number. “${action.label}” was not performed.${noActionPerformed}`,
      });
      return;
    }

    const dealerMailTab = window.open(
      dealerMailUrl,
      "_blank",
      "noopener,noreferrer",
    );
    if (!dealerMailTab) {
      setDealerMailFeedback({
        kind: "blocked",
        message: `DealerMail search did not open, so “${action.label}” was not performed. Use the manual search link for stock ${vehicle.stockNumber}, verify the full VIN ${vehicle.vin}, then ${nextStep}.${noActionPerformed}`,
      });
      return;
    }

    try {
      dealerMailTab.opener = null;
    } catch {
      // The authenticated DealerMail tab can still be used if the browser prevents changing opener.
    }

    const dealerMailStock = vehicle.stockNumber.trim().replace(/\W/g, "");
    const launchedVehicleKey = vehicleLaunchKey;
    const baseMessage = `DealerMail opened its complete four-store inventory page and this app is attempting to copy stock ${dealerMailStock}. If the browser blocks copying, enter it manually in LAST8 / STOCK. Verify the displayed full VIN is ${vehicle.vin}, then ${nextStep}. The requested action was not performed automatically in this app.${noActionPerformed}`;
    setDealerMailFeedback({
      kind: "opened",
      message: baseMessage,
    });
    void copyExactText(dealerMailStock).then((copied) => {
        if (currentVehicleLaunchKeyRef.current !== launchedVehicleKey) return;
        if (copied) {
        setDealerMailFeedback({
          kind: "opened",
          message: `DealerMail opened its complete four-store inventory page and stock ${dealerMailStock} was copied. To complete “${action.label}”, paste it into LAST8 / STOCK, verify the displayed full VIN is ${vehicle.vin}, open DealerMail’s own vehicle tools, then ${nextStep}. The requested action was not performed automatically in this app.${noActionPerformed}`,
        });
          return;
        }
        setDealerMailFeedback({
          kind: "opened",
          message: `DealerMail opened its complete four-store inventory page, but the browser could not copy stock ${dealerMailStock}. To complete “${action.label}”, enter stock ${dealerMailStock} manually in LAST8 / STOCK, verify the displayed full VIN is ${vehicle.vin}, then ${nextStep}. The requested action was not performed automatically in this app.${noActionPerformed}`,
        });
      }).catch(() => {
        if (currentVehicleLaunchKeyRef.current !== launchedVehicleKey) return;
        setDealerMailFeedback({
          kind: "opened",
          message: `DealerMail opened its complete four-store inventory page, but the stock copy attempt failed. To complete “${action.label}”, enter stock ${dealerMailStock} manually in LAST8 / STOCK, verify the displayed full VIN is ${vehicle.vin}, then ${nextStep}. The requested action was not performed automatically in this app.${noActionPerformed}`,
        });
      });
  };

  const focusDealerMailActions = () => {
    setActiveSection("hold");
    window.setTimeout(() => {
      const panel = dealerMailActionsRef.current;
      if (!panel) return;
      panel.scrollIntoView?.({ behavior: workspaceScrollBehavior(), block: "nearest" });
      panel
        .querySelector<HTMLButtonElement>(".inventory-dealermail-action")
        ?.focus({ preventScroll: true });
    }, 0);
  };

  useContainedFocus({
    active: true,
    contain: true,
    containerRef: workspaceRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef,
    onEscape: onClose,
  });

  const openAndFocusSection = (id: WorkspaceSectionId) => {
    setActiveSection(id);
    window.setTimeout(() => {
      const mobileOverflow =
        compactMobileWorkspace &&
        WORKSPACE_SECTIONS.some(
          (section) => section.id === id && section.mobileOverflow,
        );
      if (mobileOverflow) {
        const summary = mobileSectionMoreRef.current?.querySelector<HTMLElement>(
          "summary",
        );
        summary?.focus({ preventScroll: true });
        return;
      }
      const tab = tabListRef.current?.querySelector<HTMLButtonElement>(
        `#inventory-tab-${id}`,
      );
      tab?.scrollIntoView?.({
        behavior: workspaceScrollBehavior(),
        block: "nearest",
        inline: "nearest",
      });
      tab?.focus({ preventScroll: true });
    }, 0);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const navigableSections = compactMobileWorkspace
      ? MOBILE_PRIMARY_SECTIONS
      : WORKSPACE_SECTIONS;
    const currentIndex = navigableSections.findIndex(
      (section) => section.id === activeSection,
    );
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? navigableSections.length - 1
        : (Math.max(0, currentIndex) +
            (event.key === "ArrowRight" ? 1 : -1) +
            navigableSections.length) %
          navigableSections.length;
    openAndFocusSection(navigableSections[nextIndex].id);
  };

  const holdLabel = !holdCurrent
    ? "Hold status unverified"
    : vehicle.dealerMail.hasActiveHold === true
      ? vehicle.dealerMail.position === "backup"
        ? "Backup hold"
        : vehicle.dealerMail.position === "multiple" || holdCount > 1
          ? `${holdCount} hold records`
          : "On hold"
      : vehicle.dealerMail.hasActiveHold === false
        ? "No current hold"
        : "Hold status not provided";
  const holdDetail =
    vehicle.dealerMail.hasActiveHold === true
      ? [primaryHold?.salesperson, primaryHold?.customerOrReason]
          .filter(Boolean)
          .join(" · ") ||
        vehicle.dealerMail.conciseState ||
        "Open hold details"
      : holdCurrent
        ? "Confirm with the home store before customer commitment"
        : "The hold source needs a fresh update";
  const holdTone = !holdCurrent
    ? "unverified"
    : vehicle.dealerMail.hasActiveHold === true
      ? "held"
      : "clear";

  const movementLabel = vehicle.movement?.overdue
    ? "Move needs action"
    : hasMovement
      ? humanizeWorkflowValue(vehicle.movement?.state) ||
        humanizeWorkflowValue(vehicle.movement?.requestStatus) ||
        "Movement tracked"
      : "No tracked move";
  const movementDetail = hasMovement
    ? vehicle.movement?.nextAction ||
      vehicle.movement?.lastEventLabel ||
      "Open location and movement details"
    : "No movement record in this app";
  const publicListingLabel = vehicle.publicListing.dataState !== "current"
    ? "Online status unverified"
    : vehicle.publicListing.isListed === true
      ? "Shown online"
      : vehicle.publicListing.isListed === false
        ? "Not shown online"
        : "Online status not reported";
  const publicListingDetail = vehicle.publicListing.websiteStatus ||
    (vehicle.publicListing.updatedAt
      ? `Updated ${formatDateTime(vehicle.publicListing.updatedAt)}`
      : `${dataStateLabel(vehicle.publicListing.dataState)} source`);
  const publicListingTone = vehicle.publicListing.dataState !== "current"
    ? "unverified"
    : vehicle.publicListing.isListed === true
      ? "clear"
      : "default";
  const sourceStates = [
    vehicle.publicListing.dataState,
    vehicle.dealerOn.dataState,
    vehicle.dealerMail.dataState,
  ];
  const currentSourceCount = sourceStates.filter((state) => state === "current").length;
  const sourceFreshnessLabel = `${currentSourceCount} of ${sourceStates.length} checks current`;
  const sourceFreshnessDetail = sourceStates.some((state) => state === "stale")
    ? "At least one vehicle record update is delayed"
    : sourceStates.some((state) => state === "incomplete" || state === "unavailable")
      ? "At least one vehicle record needs review"
      : "Vehicle records are current";
  const canManageDealerMail = vehicle.dealerMail.canManageHold === true;
  const mobileContextImageUrl = [
    ...(vehicle.imageUrls ?? []),
    vehicle.imageUrl,
  ].find((value): value is string => Boolean(value?.trim()));
  const activeMobileOverflowSection = compactMobileWorkspace
    ? WORKSPACE_SECTIONS.find(
        (section) => section.id === activeSection && section.mobileOverflow,
      )
    : undefined;
  const mobileOverflowLabel = activeMobileOverflowSection?.mobileLabel ?? "More";
  const visibleWorkspaceSections = compactMobileWorkspace
    ? MOBILE_PRIMARY_SECTIONS
    : WORKSPACE_SECTIONS;
  return createPortal(
    <>
      <div
        className="inventory-workspace-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`inventory-workspace inventory-workspace--gallery-first inventory-workspace--dense inventory-workspace--compact-v3 inventory-workspace--v10 inventory-workspace--oem-${oemTheme}`}
        ref={workspaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} vehicle workspace`}
        tabIndex={-1}
        data-oem={oemTheme}
        data-vehicle-make={vehicle.make}
        data-active-section={activeSection}
        data-feedback-state={dealerMailFeedback?.kind ?? "idle"}
      >
        <header className="inventory-workspace-topbar">
          <span>Vehicle workspace <b>· Stock {vehicle.stockNumber}</b></span>
          <button
            type="button"
            className="inventory-icon-button inventory-workspace-close"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close vehicle details"
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div
          className="inventory-workspace-scroll inventory-workspace-scroll--dense"
          ref={scrollRef}
        >
          <section
            className="inventory-workspace-mobile-context"
            aria-label={`${displayName} vehicle summary`}
          >
            <div className="inventory-workspace-mobile-context__media">
              {mobileContextImageUrl ? (
                <img src={mobileContextImageUrl} alt={`${displayName}, inventory photo`} />
              ) : (
                <CarFront size={28} strokeWidth={1.55} aria-hidden="true" />
              )}
            </div>
            <div className="inventory-workspace-mobile-context__copy">
              <h2>{displayName}</h2>
              <div className="inventory-workspace-mobile-context__metrics">
                <strong>{formatMoney(vehicle.price)}</strong>
                <span aria-hidden="true" />
                {vehicle.mileage != null ? (
                  <CopyableValue
                    compact
                    className="inventory-workspace-mileage-copy"
                    label="mileage"
                    text={String(vehicle.mileage)}
                  >
                    <strong>{formatMileage(vehicle.mileage)}</strong>
                  </CopyableValue>
                ) : (
                  <strong>{formatMileage(vehicle.mileage)}</strong>
                )}
              </div>
              <div className="inventory-workspace-mobile-context__identifiers">
                <span>
                  Stock <CopyableValue compact label="stock number" text={vehicle.stockNumber} />
                </span>
                <span>
                  VIN <CopyableValue compact label="VIN" text={vehicle.vin} />
                </span>
              </div>
            </div>
          </section>
          <section
            className="inventory-workspace-hero inventory-workspace-hero--cinematic"
            data-oem={oemTheme}
            data-vehicle-make={vehicle.make}
            data-hold-state={holdTone}
            data-public-state={vehicle.publicListing.dataState}
            data-location-conflict={vehicle.location.conflict ? "true" : "false"}
          >
            <VehicleGallery vehicle={vehicle} />

            <div className="inventory-workspace-hero__summary">
              <section className="inventory-workspace-identity">
                <div className="inventory-workspace-identity__title">
                  <p>{vehicle.location.homeStore.name}</p>
                  <h2 id="inventory-workspace-title">{displayName}</h2>
                  <span className="inventory-workspace-identity__copy-values">
                    <span className="inventory-workspace-identity__copy-token">
                      <span className="inventory-workspace-identity__copy-label">Stock</span>
                      <CopyableValue compact label="stock number" text={vehicle.stockNumber} />
                    </span>
                    <span className="inventory-workspace-identity__copy-token">
                      <span className="inventory-workspace-identity__copy-label">VIN</span>
                      <CopyableValue compact label="VIN" text={vehicle.vin} />
                    </span>
                  </span>
                  {vehicle.inventoryDate ? (
                    <small className="inventory-workspace-identity__listed-date">
                      Inventory date {formatDate(vehicle.inventoryDate)}
                    </small>
                  ) : null}
                </div>
                {vehicle.certified ? (
                  <span className="inventory-workspace-certified">
                    <BadgeCheck size={16} strokeWidth={1.75} aria-hidden="true" /> Certified
                  </span>
                ) : null}
                <dl className="inventory-workspace-identity__numbers">
                  <Fact label="Price" emphasize>
                    {formatMoney(vehicle.price)}
                  </Fact>
                  <Fact label="Mileage" emphasize>
                    {vehicle.mileage != null ? (
                      <CopyableValue
                        compact
                        className="inventory-workspace-mileage-copy"
                        label="mileage"
                        text={String(vehicle.mileage)}
                      >
                        {formatMileage(vehicle.mileage)}
                      </CopyableValue>
                    ) : formatMileage(vehicle.mileage)}
                  </Fact>
                  <Fact label="Days listed" emphasize>{vehicle.daysListed ?? "—"}</Fact>
                  {vehicle.msrp != null ? (
                    <Fact label="MSRP">{formatMoney(vehicle.msrp)}</Fact>
                  ) : null}
                </dl>
              </section>

              <div className="inventory-workspace-hero__operations">
                <section className="inventory-workspace-signal-grid inventory-workspace-signal-grid--primary" aria-label="Primary operational status">
                  <OperationalSignal
                    id="hold"
                    label="Hold status"
                    value={holdLabel}
                    detail={holdDetail}
                    icon={<UserRound size={21} strokeWidth={1.8} aria-hidden="true" />}
                    tone={holdTone}
                    section="hold"
                    active={activeSection === "hold"}
                    onActivate={openAndFocusSection}
                  />
                  <OperationalSignal
                    id="location"
                    label="Current location"
                    value={currentLocation.label}
                    detail={vehicle.location.conflict ? "Location conflict — review needed" : currentLocation.detail}
                    icon={currentLocation.provenance === "app-confirmed"
                      ? <Navigation size={21} strokeWidth={1.8} aria-hidden="true" />
                      : <MapPin size={21} strokeWidth={1.8} aria-hidden="true" />}
                    tone={vehicle.location.conflict ? "danger" : "default"}
                    section="movement"
                    active={activeSection === "movement"}
                    onActivate={openAndFocusSection}
                  />
                  <OperationalSignal
                    id="movement"
                    label="Movement"
                    value={movementLabel}
                    detail={movementDetail}
                    icon={<Truck size={21} strokeWidth={1.8} aria-hidden="true" />}
                    tone={vehicle.movement?.overdue ? "danger" : "default"}
                    section="movement"
                    active={activeSection === "movement"}
                    onActivate={openAndFocusSection}
                  />
                </section>

                <div
                  className="inventory-workspace-v3-toolbar"
                  role="toolbar"
                  aria-label="Vehicle actions"
                  data-oem={oemTheme}
                >
                  {listingUrl ? (
                    onOpenListing ? (
                      <button type="button" className="inventory-button inventory-button--primary" onClick={() => onOpenListing(vehicle)} data-action="open-listing">
                        <Globe2 size={16} strokeWidth={1.75} aria-hidden="true" /> Open listing
                      </button>
                    ) : (
                      <a className="inventory-button inventory-button--primary" href={listingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="open-listing" data-read-only="true">
                        <Globe2 size={16} strokeWidth={1.75} aria-hidden="true" /> Open listing
                      </a>
                    )
                  ) : null}
                  {canManageDealerMail ? (
                    <button
                      type="button"
                      className="inventory-button"
                      onClick={focusDealerMailActions}
                      aria-controls="inventory-dealermail-actions"
                      data-action="dealermail-tools"
                    >
                      <UserRound size={16} strokeWidth={1.8} aria-hidden="true" /> DealerMail tools
                    </button>
                  ) : null}
                  {autoCheckUrl ? (
                    <a
                      className="inventory-button inventory-button--resource"
                      href={autoCheckUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      aria-label={`Open AutoCheck report for ${displayName} in a new tab`}
                      data-action="autocheck"
                      data-read-only="true"
                    >
                      <AutoCheckWordmark compact decorative />
                      <span>AutoCheck report</span>
                    </a>
                  ) : null}
                  {stickerUrl || factoryEquipmentUrl ? (
                    <a
                      className="inventory-button inventory-button--resource"
                      href={stickerUrl || factoryEquipmentUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      aria-label={`${stickerUrl ? "Open factory window sticker" : "Open VIN equipment profile"} for ${displayName} in a new tab`}
                      data-action={stickerUrl ? "window-sticker" : "factory-equipment"}
                      data-read-only="true"
                    >
                      <span className="inventory-resource-action-mark" aria-hidden="true">
                        <FactoryStickerIcon size={19} />
                      </span>
                      <span>{stickerUrl ? "Window sticker" : "VIN equipment"}</span>
                    </a>
                  ) : (
                    <button type="button" className="inventory-button" onClick={() => openAndFocusSection("equipment")} data-action="equipment">
                      <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> Equipment
                    </button>
                  )}
                  {invoiceUrl || oasisUrl || hasVehicleRecords || (canRequestVehicle && onRequestVehicle) || (vehicle.movement && onTrackMovement) || onViewVehicle ? (
                    <details className="inventory-workspace-v3-more">
                      <summary>
                        More <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                      </summary>
                      <div className="inventory-workspace-v3-more__actions" role="group" aria-label="More vehicle actions">
                        {invoiceUrl ? (
                          <a className="inventory-button" href={invoiceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="invoice" data-read-only="true">
                            <FileSearch size={16} strokeWidth={1.75} aria-hidden="true" /> Invoice
                          </a>
                        ) : null}
                        {oasisUrl ? (
                          <a className="inventory-button" href={oasisUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="oasis" data-read-only="true">
                            <BadgeCheck size={16} strokeWidth={1.75} aria-hidden="true" /> OASIS
                          </a>
                        ) : null}
                        {hasVehicleRecords ? (
                          <button type="button" className="inventory-button" onClick={() => openAndFocusSection("data")} data-action="records">
                            <FileSearch size={16} strokeWidth={1.75} aria-hidden="true" /> Records
                          </button>
                        ) : null}
                        {canRequestVehicle && onRequestVehicle ? (
                          <button type="button" className="inventory-button" onClick={() => onRequestVehicle(vehicle)} data-action="request-vehicle">
                            <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden="true" /> Request vehicle
                          </button>
                        ) : null}
                        {vehicle.movement && onTrackMovement ? (
                          <button type="button" className="inventory-button" onClick={() => onTrackMovement(vehicle)} data-action="track-movement">
                            <Truck size={16} strokeWidth={1.75} aria-hidden="true" /> Track movement
                          </button>
                        ) : null}
                        {onViewVehicle ? (
                          <button type="button" className="inventory-button" onClick={() => onViewVehicle(vehicle)} data-action="open-record">
                            <CarFront size={16} strokeWidth={1.75} aria-hidden="true" /> Full record
                          </button>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section
            className="inventory-workspace-mobile-status"
            aria-label="Current hold and location summary"
            data-has-active-hold={vehicle.dealerMail.hasActiveHold === true ? "true" : "false"}
          >
            <button
              type="button"
              className={`inventory-workspace-mobile-status__hold inventory-workspace-mobile-status__hold--${holdTone}`}
              onClick={() => openAndFocusSection("hold")}
            >
              <UserRound size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="inventory-workspace-mobile-status__copy">
                <span className="inventory-workspace-mobile-status__label">Hold status</span>
                <strong>{holdLabel}</strong>
              </span>
            </button>
            {canViewHoldEvidence && vehicle.dealerMail.hasActiveHold === true ? (
              <span
                title={primaryHold?.salesperson || "Not provided"}
                aria-label={`Salesperson ${primaryHold?.salesperson || "not provided"}`}
              >
                <span className="inventory-workspace-mobile-status__copy">
                  <span className="inventory-workspace-mobile-status__label">Salesperson</span>
                  <strong>{primaryHold?.salesperson || "—"}</strong>
                </span>
              </span>
            ) : vehicle.dealerMail.hasActiveHold === true ? (
              <span>
                <span className="inventory-workspace-mobile-status__copy">
                  <span className="inventory-workspace-mobile-status__label">Hold details</span>
                  <strong>Restricted</strong>
                </span>
              </span>
            ) : null}
            {vehicle.dealerMail.hasActiveHold === true ? (
              <span aria-label={`Expected date ${formatDate(primaryHold?.expectedDeliveryDate)}`}>
                <span className="inventory-workspace-mobile-status__copy">
                  <span className="inventory-workspace-mobile-status__label">Expected date</span>
                  <strong>{formatDate(primaryHold?.expectedDeliveryDate)}</strong>
                </span>
              </span>
            ) : null}
            <button
              type="button"
              className="inventory-workspace-mobile-status__location"
              onClick={() => openAndFocusSection("movement")}
            >
              <span className="inventory-workspace-mobile-status__copy">
                <span className="inventory-workspace-mobile-status__label">Location</span>
                <strong>{currentLocation.label}</strong>
              </span>
            </button>
          </section>

          <div
            className="inventory-workspace-mobile-actions"
            role="toolbar"
            aria-label="Mobile vehicle actions"
          >
            {listingUrl ? (
              onOpenListing ? (
                <button type="button" onClick={() => onOpenListing(vehicle)} data-mobile-action="open-listing">
                  <Tag size={22} strokeWidth={1.7} aria-hidden="true" />
                  <span>Open listing</span>
                </button>
              ) : (
                <a href={listingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-mobile-action="open-listing" data-read-only="true">
                  <Tag size={22} strokeWidth={1.7} aria-hidden="true" />
                  <span>Open listing</span>
                </a>
              )
            ) : (
              <button type="button" onClick={() => openAndFocusSection("data")} data-mobile-action="record-details">
                <FileSearch size={22} strokeWidth={1.7} aria-hidden="true" />
                <span>Record details</span>
              </button>
            )}
            {canManageDealerMail ? (
              <button
                type="button"
                onClick={() => openAndFocusSection("hold")}
                aria-label="Review hold evidence before DealerMail tools"
                aria-describedby={canViewHoldEvidence ? "inventory-hold-availability-caveat" : undefined}
                data-mobile-action="dealermail"
              >
                <Mail size={23} strokeWidth={1.7} aria-hidden="true" />
                <span>DealerMail</span>
              </button>
            ) : (
              <button type="button" onClick={() => openAndFocusSection("hold")} data-mobile-action="hold-details">
                <UserRound size={22} strokeWidth={1.7} aria-hidden="true" />
                <span>Hold details</span>
              </button>
            )}
            <details className="inventory-workspace-mobile-actions__more">
              <summary aria-label="More actions">
                <Ellipsis size={24} strokeWidth={1.8} aria-hidden="true" />
                <span className="inventory-workspace-mobile-more-label" aria-hidden="true">
                  <span>Mo</span><span>re</span>
                </span>
              </summary>
              <div role="group" aria-label="Additional vehicle actions">
                {autoCheckUrl ? (
                  <a
                    href={autoCheckUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    aria-label={`Open AutoCheck report for ${displayName} in a new tab`}
                    data-read-only="true"
                  >
                    AutoCheck report
                  </a>
                ) : null}
                {stickerUrl || factoryEquipmentUrl ? (
                  <a
                    href={stickerUrl || factoryEquipmentUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    aria-label={`${stickerUrl ? "Open factory window sticker" : "Open VIN equipment profile"} for ${displayName} in a new tab`}
                    data-read-only="true"
                  >
                    {stickerUrl ? "Factory window sticker" : "VIN equipment profile"}
                  </a>
                ) : (
                  <button type="button" onClick={() => openAndFocusSection("equipment")}>Equipment</button>
                )}
                {invoiceUrl ? <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-read-only="true">Invoice</a> : null}
                {oasisUrl ? <a href={oasisUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-read-only="true">OASIS</a> : null}
                {hasVehicleRecords ? <button type="button" aria-label="Open mobile vehicle records" onClick={() => openAndFocusSection("data")}>Vehicle records</button> : null}
                {canRequestVehicle && onRequestVehicle ? <button type="button" aria-label="Request this vehicle" onClick={() => onRequestVehicle(vehicle)}>Request vehicle</button> : null}
                {vehicle.movement && onTrackMovement ? <button type="button" aria-label="Track this vehicle movement" onClick={() => onTrackMovement(vehicle)}>Track movement</button> : null}
                {onViewVehicle ? <button type="button" aria-label="Open full mobile vehicle record" onClick={() => onViewVehicle(vehicle)}>Full record</button> : null}
              </div>
            </details>
          </div>

          <div className="inventory-workspace-navigation">
            <div
              className="inventory-workspace-tabs inventory-workspace-tabs--dense"
              role="tablist"
              aria-label="Vehicle workspace sections"
              ref={tabListRef}
              onKeyDown={handleTabKeyDown}
            >
              {visibleWorkspaceSections.map((section) => (
                <button
                  type="button"
                  role="tab"
                  id={`inventory-tab-${section.id}`}
                  aria-label={section.label}
                  aria-selected={activeSection === section.id}
                  aria-controls={`inventory-panel-${section.id}`}
                  tabIndex={activeSection === section.id ? 0 : -1}
                  onClick={() => setActiveSection(section.id)}
                  data-workspace-tab={section.id}
                  data-mobile-overflow={section.mobileOverflow ? "true" : undefined}
                  key={section.id}
                >
                  <span className="inventory-workspace-tab-label--desktop">{section.label}</span>
                  <span className="inventory-workspace-tab-label--mobile" aria-hidden="true">{section.mobileLabel}</span>
                </button>
              ))}
            </div>
            <details
              className="inventory-workspace-mobile-section-more"
              ref={mobileSectionMoreRef}
              data-active-overflow={activeMobileOverflowSection ? "true" : "false"}
            >
              <summary
                id={activeMobileOverflowSection ? `inventory-tab-${activeMobileOverflowSection.id}` : undefined}
                aria-label={activeMobileOverflowSection
                  ? `${activeMobileOverflowSection.label} section selected; show more vehicle sections`
                  : "More vehicle sections"}
                aria-current={activeMobileOverflowSection ? "page" : undefined}
              >
                <span className="inventory-workspace-mobile-more-label" aria-hidden="true">
                  {mobileOverflowLabel === "More" ? (
                    <><span>Mo</span><span>re</span></>
                  ) : mobileOverflowLabel}
                </span>
                <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <ul aria-label="Additional vehicle sections">
                {WORKSPACE_SECTIONS.filter((section) => section.mobileOverflow).map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      aria-current={activeSection === section.id ? "page" : undefined}
                      aria-controls={`inventory-panel-${section.id}`}
                      onClick={() => {
                        if (mobileSectionMoreRef.current) mobileSectionMoreRef.current.open = false;
                        openAndFocusSection(section.id);
                      }}
                    >
                      {section.mobileLabel}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div className="inventory-workspace-tab-panels">
            <WorkspacePanel id="overview" label="Overview" active={activeSection === "overview"}>
              <div className="inventory-workspace-v3-overview">
                <div className="inventory-workspace-v3-overview__main">
                  <OverviewDetails
                    vehicle={vehicle}
                    onOpenRecords={hasVehicleRecords ? () => openAndFocusSection("data") : undefined}
                  />
                  <VehicleIntelligence vehicle={vehicle} />
                </div>
                <aside className="inventory-workspace-v3-overview__aside" aria-label="Availability, value, and source summary">
                  <section className="inventory-workspace-v3-summary" aria-labelledby="inventory-workspace-v3-summary-title">
                    <header className="inventory-workspace-section-heading">
                      <Gauge size={18} strokeWidth={1.75} aria-hidden="true" />
                      <h3 id="inventory-workspace-v3-summary-title">Availability &amp; value</h3>
                    </header>
                    <dl>
                      <Fact label="Hold status">
                        <button type="button" onClick={() => openAndFocusSection("hold")}>{holdLabel}</button>
                        <small>{holdDetail}</small>
                      </Fact>
                      <Fact label="Sale price">{formatMoney(vehicle.price)}</Fact>
                      <Fact label="MSRP">{formatMoney(vehicle.msrp)}</Fact>
                      <Fact label="Current location">
                        <button type="button" onClick={() => openAndFocusSection("movement")}>{currentLocation.label}</button>
                        <small>{vehicle.location.conflict ? "Location conflict — review needed" : currentLocation.detail}</small>
                      </Fact>
                      <Fact label="Days listed">{vehicle.daysListed ?? "—"}</Fact>
                      {recentChange ? (
                        <Fact label="Recent change">
                          <button type="button" onClick={() => openAndFocusSection("timeline")}>{recentChange.label}</button>
                          {vehicle.changeSummary ? <small>{vehicle.changeSummary}</small> : null}
                        </Fact>
                      ) : null}
                    </dl>
                  </section>

                  <RecentChanges vehicle={vehicle} />

                  <section
                    className="inventory-workspace-source-strip inventory-workspace-v3-source-status"
                    aria-label="Vehicle record status"
                  >
                    <OperationalSignal
                      id="public-listing"
                      label="Online status"
                      value={publicListingLabel}
                      detail={publicListingDetail}
                      icon={<Globe2 size={18} strokeWidth={1.8} aria-hidden="true" />}
                      tone={publicListingTone}
                      section="data"
                      active={activeSection === "data"}
                      onActivate={openAndFocusSection}
                    />
                    <OperationalSignal
                      id="source-freshness"
                      label="Record checks"
                      value={sourceFreshnessLabel}
                      detail={sourceFreshnessDetail}
                      icon={<Clock3 size={18} strokeWidth={1.8} aria-hidden="true" />}
                      tone={currentSourceCount === sourceStates.length ? "clear" : "unverified"}
                      section="data"
                      active={activeSection === "data"}
                      onActivate={openAndFocusSection}
                    />
                    {recentChange ? (
                      <OperationalSignal
                        id="recent-change"
                        label="Latest change"
                        value={recentChange.label}
                        detail={vehicle.changeSummary || "Open the full change history"}
                        icon={<Clock3 size={18} strokeWidth={1.8} aria-hidden="true" />}
                        section="timeline"
                        active={activeSection === "timeline"}
                        onActivate={openAndFocusSection}
                      />
                    ) : null}
                  </section>
                </aside>
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="hold" label="Hold and availability" active={activeSection === "hold"}>
              <div
                className="inventory-workspace-hold-center"
                data-hold-state={vehicle.holdEvidence?.length ? "held" : "no-evidence"}
              >
                <HoldDetails vehicle={vehicle} />
                {canManageDealerMail ? (
                  <DealerMailHoldGuide
                    vehicle={vehicle}
                    onOpen={openDealerMailIntent}
                    panelRef={dealerMailActionsRef}
                  />
                ) : null}
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="movement" label="Location and movement" active={activeSection === "movement"}>
              <MovementDetails vehicle={vehicle} />
            </WorkspacePanel>
            <WorkspacePanel id="equipment" label="Equipment" active={activeSection === "equipment"}>
              <div className="inventory-workspace-equipment-layout">
                <SourceConfirmedEquipment vehicle={vehicle} />
                <aside className="inventory-workspace-equipment-specs" aria-label="Equipment section index">
                  <EquipmentCategoryIndex vehicle={vehicle} />
                </aside>
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="timeline" label="History" active={activeSection === "timeline"}>
              <TimelineDetails vehicle={vehicle} />
            </WorkspacePanel>
            <WorkspacePanel id="data" label="Record details" active={activeSection === "data"}>
              <VehicleDocuments vehicle={vehicle} />
              <DataDetails vehicle={vehicle} onOpenSourceRecord={onOpenSourceRecord} />
            </WorkspacePanel>
          </div>
        </div>

        {dealerMailFeedback ? (
          <div
            className={`inventory-workspace-toast inventory-workspace-toast--${dealerMailFeedback.kind}`}
            role={dealerMailFeedback.kind === "blocked" ? "alert" : "status"}
            aria-live={dealerMailFeedback.kind === "blocked" ? "assertive" : "polite"}
            data-action-feedback={dealerMailFeedback.kind}
          >
            {dealerMailFeedback.kind === "blocked" ? (
              <AlertTriangle size={16} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span>
              {dealerMailFeedback.message}
              {dealerMailFeedback.kind === "blocked" && dealerMailUrl ? (
                <> <a href={dealerMailUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-read-only="true">Open DealerMail inventory</a>.</>
              ) : null}
            </span>
            <button type="button" onClick={() => setDealerMailFeedback(null)} aria-label="Dismiss DealerMail instruction"><X size={15} aria-hidden="true" /></button>
          </div>
        ) : null}

      </aside>
    </>,
    document.body,
  );
}
