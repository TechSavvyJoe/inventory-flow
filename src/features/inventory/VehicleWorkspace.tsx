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
  Copy,
  Database,
  ExternalLink,
  FileText,
  FileSearch,
  Gauge,
  Globe2,
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
import {
  formatDate,
  formatDateTime,
  formatMileage,
  formatMoney,
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
  { id: "data", label: "Source details", mobileLabel: "Sources", mobileOverflow: true },
];

const MOBILE_PRIMARY_SECTIONS = WORKSPACE_SECTIONS.filter(
  (section) => !section.mobileOverflow,
);

function usesCompactMobileWorkspace(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 620px)").matches
  );
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
  description: string;
  tone: "primary" | "hold" | "message" | "danger";
}

function oemThemeToken(make: string): "ford" | "lincoln" | "generic" {
  const normalized = make.trim().toLowerCase();
  if (normalized === "ford") return "ford";
  if (normalized === "lincoln") return "lincoln";
  return "generic";
}

const DEALERMAIL_ACTIONS: Record<DealerMailIntent, DealerMailActionDefinition> = {
  "view-inventory": {
    intent: "view-inventory",
    label: "Find Vehicle in DealerMail",
    description: "Search DealerMail by this exact stock, then verify the VIN and use its native vehicle tools.",
    tone: "primary",
  },
  "place-hold": {
    intent: "place-hold",
    label: "Place Hold in DealerMail",
    description: "Confirm the vehicle and availability before placing a hold.",
    tone: "hold",
  },
  "add-backup": {
    intent: "add-backup",
    label: "Add Backup in DealerMail",
    description: "Review the primary hold before adding a separate backup.",
    tone: "hold",
  },
  comments: {
    intent: "comments",
    label: "Comments in DealerMail",
    description: "Review the vehicle record before reading or adding comments.",
    tone: "message",
  },
  alerts: {
    intent: "alerts",
    label: "Alerts in DealerMail",
    description: "Review the vehicle record before reading or adding alerts.",
    tone: "message",
  },
  "review-change": {
    intent: "review-change",
    label: "Review / Change Hold in DealerMail",
    description: "Inspect the live hold record before making an authorized change.",
    tone: "hold",
  },
  "review-remove": {
    intent: "review-remove",
    label: "Review / Remove Hold in DealerMail",
    description: "Inspect the live record; nothing is removed from this app.",
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
}: {
  label: string;
  children: ReactNode;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`inventory-workspace-fact${
        emphasize ? " inventory-workspace-fact--emphasized" : ""
      }`}
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

function AutoCheckWordmark() {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <span
      className="inventory-document-wordmark inventory-document-wordmark--autocheck"
      data-brand-asset={logoFailed ? "text-fallback" : "official-image"}
    >
      {logoFailed ? (
        <span role="img" aria-label="AutoCheck by Experian" className="inventory-document-wordmark__fallback">
          <span aria-hidden="true" className="inventory-document-wordmark__line">
            <span>Auto</span><strong>Check</strong><sup>®</sup>
          </span>
          <small aria-hidden="true">by Experian</small>
        </span>
      ) : (
        <img
          src="https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg"
          alt="AutoCheck by Experian"
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
  const messages = [
    ...(evidence.alerts?.map((alert) => ({
      kind: "alert" as const,
      text: alert.text,
      author: alert.author,
      timestamp: alert.timestamp,
    })) ?? []),
    ...(evidence.comments?.map((comment) => ({
      kind: "comment" as const,
      text: comment.text,
      author: comment.author,
      timestamp: comment.timestamp,
    })) ?? []),
  ];

  return (
    <article className="inventory-hold-evidence">
      <header>
        <span>
          <strong>
            {evidence.position ? `${evidence.position} hold` : "Hold record"}
          </strong>
          <small>{evidence.lifecycleStatus || "Status not provided"}</small>
        </span>
        <span className="inventory-hold-evidence__position">
          {evidence.position || "unclassified"}
        </span>
      </header>
      <dl className="inventory-fact-grid inventory-fact-grid--compact inventory-hold-evidence__facts">
        <Fact label="Salesperson" emphasize>
          {evidence.salesperson || "Not provided"}
        </Fact>
        <Fact label="Customer / reason" emphasize>
          {evidence.customerOrReason || "Not provided"}
        </Fact>
        <Fact label="Held by">{evidence.heldBy || "Not provided"}</Fact>
        <Fact label="Hold date">{formatDate(evidence.holdDate)}</Fact>
        <Fact label="Expected date">
          {formatDate(evidence.expectedDeliveryDate)}
        </Fact>
        <Fact label="Days held">
          {evidence.daysHeld ?? "Not provided"}
        </Fact>
        {evidence.position === "primary" && backupCount != null ? (
          <Fact label="Backup count">{backupCount}</Fact>
        ) : null}
        <Fact label="CDK status">{evidence.cdkState || "Not provided"}</Fact>
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
          {evidence.commentFlag ? "Comments present" : "No comment flag"}
        </span>
        <span className={evidence.alertFlag ? "is-present" : undefined}>
          <Bell size={15} strokeWidth={1.75} aria-hidden="true" />
          {evidence.alertFlag ? "Alerts present" : "No alert flag"}
        </span>
      </div>
      {messages.length ? (
        <details className="inventory-hold-evidence__messages">
          <summary>
            <span>Comments &amp; alerts</span>
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
  const actionButton = (action: DealerMailActionDefinition) => (
    <button
      type="button"
      className={`inventory-dealermail-action inventory-dealermail-action--compact inventory-dealermail-action--${action.tone}`}
      key={action.intent}
      onClick={() => onOpen(action.intent)}
      aria-label={action.label}
      aria-describedby="inventory-dealermail-preflight"
      data-dealermail-intent={action.intent}
      data-action-tone={action.tone}
    >
      <span className="inventory-dealermail-action__icon">
        <DealerMailActionIcon intent={action.intent} />
      </span>
      <span className="inventory-dealermail-action__copy">
        <strong>{action.label}</strong>
        <small aria-hidden="true">Open interactive record</small>
        <span className="inventory-sr-only">{action.description}</span>
      </span>
      <ExternalLink
        className="inventory-dealermail-action__external"
        size={17}
        strokeWidth={1.8}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <section
      id="inventory-dealermail-actions"
      className="inventory-dealermail-actions inventory-dealermail-actions--full-width inventory-dealermail-actions--dense inventory-workspace-dealermail-rail"
      aria-labelledby="inventory-dealermail-actions-title"
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
              {sticker.totalMsrp != null ? <Fact label="Sticker MSRP" emphasize>{formatMoney(sticker.totalMsrp)}</Fact> : null}
              {sticker.basePrice != null ? <Fact label="Base price">{formatMoney(sticker.basePrice)}</Fact> : null}
              {sticker.totalOptions != null ? <Fact label="Total options">{formatMoney(sticker.totalOptions)}</Fact> : null}
              {sticker.destinationCharge != null ? <Fact label="Destination">{formatMoney(sticker.destinationCharge)}</Fact> : null}
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
                <small>{(sticker.standardEquipment?.length ?? 0) + (sticker.warranty?.length ?? 0)} published items</small>
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
                <small>{factoryEquipment.sections.reduce((total, section) => total + section.items.length, 0)} captured lines</small>
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
}

const EQUIPMENT_CATEGORIES: Array<{ id: EquipmentCategoryId; label: string }> = [
  { id: "packages", label: "Packages & special series" },
  { id: "safety", label: "Safety & driver assist" },
  { id: "technology", label: "Technology" },
  { id: "comfort", label: "Comfort" },
  { id: "towing", label: "Towing & utility" },
  { id: "upgrades", label: "Standout upgrades" },
  { id: "other", label: "Other published equipment" },
];

const EQUIPMENT_SOURCE_LABELS: Record<EquipmentEvidenceSource, string> = {
  "inventory-feature": "Inventory listing",
  "factory-option": "Factory option",
  "factory-standard": "Factory standard",
  "equipment-group": "Factory equipment group",
  "vauto-package": "vAuto equipment package",
  "vauto-informational": "vAuto informational equipment",
};

function equipmentCategory(text: string): EquipmentCategoryId {
  const value = text.toLowerCase();
  if (/tow|trailer|hitch|payload|truck bed|bedliner|bed liner|tailgate|tonneau|cargo|boxlink|pro power|utility/.test(value)) {
    return "towing";
  }
  if (/blind|lane|collision|cruise|camera|park|brak|airbag|safety|co-pilot|copilot|pro\s*pilot|propilot|bluecruise|super\s+cruise|cross[- ](?:traffic|path)|surround\s+(?:view|vision)|driver\s+(?:alert|attention|monitoring)|drowsy|traffic\s+sign|intelli\s*beam|high[- ]beam|pedestrian|assist|pre-collision|honda sensing|toyota safety sense/.test(value)) {
    return "safety";
  }
  if (/package|equipment group|edition|special series|appearance|fx4|tremor|raptor|king ranch|platinum|lariat|off[- ]road/.test(value)) {
    return "packages";
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
  const add = (text: string | null | undefined, source: EquipmentEvidenceSource) => {
    const clean = text?.trim();
    if (!clean) return;
    const key = clean.toLocaleLowerCase();
    const existing = byText.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    byText.set(key, { text: clean, category: equipmentCategory(clean), sources: [source] });
  };

  vehicle.features?.forEach((item) => add(item, "inventory-feature"));
  add(vehicle.windowSticker?.equipmentGroup, "equipment-group");
  vehicle.windowSticker?.options?.forEach((item) => add(item, "factory-option"));
  vehicle.windowSticker?.standardEquipment?.forEach((item) => add(item, "factory-standard"));
  vehicle.factoryEquipment?.packages?.forEach((item) => {
    add([item.name, item.code ? `(${item.code})` : null].filter(Boolean).join(" "), "vauto-package");
    item.features?.forEach((feature) => add(feature, "vauto-informational"));
  });
  vehicle.factoryEquipment?.sections?.forEach((section) => {
    section.items.forEach((item) => add(item.label, "vauto-informational"));
  });
  return [...byText.values()];
}

type EquipmentCopyState = "idle" | "copied" | "failed";

function CopyAllEquipment({ items }: { items: SourceEquipmentItem[] }) {
  const [copyState, setCopyState] = useState<EquipmentCopyState>("idle");
  const copyText = EQUIPMENT_CATEGORIES.flatMap((category) => {
    const categoryItems = items.filter((item) => item.category === category.id);
    return categoryItems.length
      ? [category.label, ...categoryItems.map((item) => `- ${item.text}`), ""]
      : [];
  }).join("\n").trim();

  useEffect(() => setCopyState("idle"), [copyText]);

  const handleCopy = async () => {
    setCopyState(await copyExactText(copyText) ? "copied" : "failed");
  };

  return (
    <span className="inventory-equipment-copy-all-wrap">
      <button
        type="button"
        className="inventory-equipment-copy-all"
        data-copy-state={copyState}
        aria-label="Copy all published equipment"
        title="Copy every published equipment item, organized by category"
        onClick={handleCopy}
      >
        {copyState === "copied" ? (
          <Check size={14} strokeWidth={2.1} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.9} aria-hidden="true" />
        )}
        <span>{copyState === "copied" ? "Equipment copied" : "Copy all"}</span>
      </button>
      {copyState === "failed" ? (
        <span className="inventory-equipment-copy-all__feedback" role="status" aria-live="polite">
          Clipboard blocked. Select the visible equipment text and copy it manually.
        </span>
      ) : null}
    </span>
  );
}

function SourceConfirmedEquipment({ vehicle }: { vehicle: InventoryVehicle }) {
  const items = sourceConfirmedEquipment(vehicle);
  const standoutLabels = standoutEquipment(vehicle, 6).map((item) => item.label);
  const commonRequestCategories = new Set<EquipmentCategoryId>([
    "safety",
    "technology",
    "comfort",
    "towing",
  ]);
  const customerRequestedHighlights = [
    ...standoutLabels,
    ...items
      .filter((item) => commonRequestCategories.has(item.category))
      .map((item) => item.text),
  ]
    .filter(
      (item, index, collection) =>
        collection.findIndex(
          (candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase(),
        ) === index,
    )
    .slice(0, 6);
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
          <strong id="inventory-workspace-equipment-evidence-title">Equipment &amp; packages</strong>
        </span>
        {items.length ? <CopyAllEquipment items={items} /> : null}
      </header>
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
      {customerRequestedHighlights.length ? (
        <section
          className="inventory-workspace-equipment-highlights"
          aria-labelledby="inventory-workspace-equipment-highlights-title"
        >
          <h4 id="inventory-workspace-equipment-highlights-title">
            Common customer-requested features
          </h4>
          <ul>
            {customerRequestedHighlights.map((item) => (
              <li key={item}>
                <Check size={15} strokeWidth={2} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {items.length ? (
        <div className="inventory-workspace-equipment-evidence__groups">
          {EQUIPMENT_CATEGORIES.map((category) => {
            const grouped = items.filter((item) => item.category === category.id);
            if (!grouped.length) return null;
            return (
              <section
                className={`inventory-workspace-equipment-group inventory-workspace-equipment-group--${category.id}`}
                aria-labelledby={`inventory-equipment-group-${category.id}`}
                data-equipment-category={category.id}
                key={category.id}
              >
                <header>
                  <h4 id={`inventory-equipment-group-${category.id}`}>{category.label}</h4>
                  <span aria-label={`${grouped.length} published items`}>{grouped.length}</span>
                </header>
                <ul>
                  {grouped.map((item) => {
                    const factoryDocumented = item.sources.some((source) =>
                      ["factory-option", "factory-standard", "equipment-group"].includes(source),
                    );
                    const vautoDocumented = item.sources.some((source) => source.startsWith("vauto-"));
                    const sourceLabel = item.sources.map((source) => EQUIPMENT_SOURCE_LABELS[source]).join(" + ");
                    return (
                      <li
                        key={`${category.id}-${item.text}`}
                        title={`Source: ${sourceLabel}`}
                        data-evidence-strength={factoryDocumented ? "factory-document" : vautoDocumented ? "vauto-informational" : "published-listing"}
                      >
                        <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
                        <span>
                          <strong>{item.text}</strong>
                          <small className="inventory-sr-only">{sourceLabel}</small>
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
              {fact.copyText ? (
                <CopyableValue label={fact.label.toLocaleLowerCase()} text={fact.copyText}>{fact.value}</CopyableValue>
              ) : fact.value}
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

function OverviewDetails({ vehicle }: { vehicle: InventoryVehicle }) {
  const autoCheck = vehicle.autoCheckReport;
  const sticker = vehicle.windowSticker;
  const keyFacts = [
    autoCheck?.ownerCount != null ? {
      label: "Owners reported",
      value: `${autoCheck.ownerCount}`,
    } : null,
    autoCheck?.usage ? { label: "Vehicle use", value: autoCheck.usage } : null,
    autoCheck?.lastReportedOdometer != null ? {
      label: "History odometer",
      value: formatMileage(autoCheck.lastReportedOdometer),
    } : null,
    autoCheck?.assemblyCountry ? { label: "Assembly country", value: autoCheck.assemblyCountry } : null,
    autoCheck?.estimatedInServiceDate ? {
      label: "Estimated in service",
      value: formatDate(autoCheck.estimatedInServiceDate),
    } : null,
    sticker?.equipmentGroup ? { label: "Equipment group", value: sticker.equipmentGroup } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const standoutItems = standoutEquipment(vehicle, 8);
  const highlights = standoutItems.length
    ? standoutItems.map((item) => item.label)
    : vehicle.features?.slice(0, 8) ?? [];

  return (
    <div className="inventory-workspace-overview-panel">
      <section className="inventory-workspace-overview-panel__description" aria-labelledby="inventory-overview-description-title">
        <h3 id="inventory-overview-description-title">Description</h3>
        <p>{vehicle.dealerComments || "No vehicle description was published."}</p>
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
        <h3 id="inventory-overview-facts-title">Source-backed facts</h3>
        {keyFacts.length ? (
          <dl>
            {keyFacts.map((fact) => <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>)}
          </dl>
        ) : (
          <p>No additional AutoCheck or sticker facts were captured.</p>
        )}
      </section>
    </div>
  );
}

function HoldDetails({ vehicle }: { vehicle: InventoryVehicle }) {
  const hold = vehicle.dealerMail;
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
      vehicle.movement?.state?.trim() ||
      vehicle.movement?.requestStatus?.trim() ||
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
        <p className="inventory-workspace-no-hold__caveat">
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>
            No current hold means only that no active DealerMail hold row was
            found. Confirm customer availability and physical custody with the
            home store.
          </span>
        </p>
      </section>
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
    vehicle.movement?.state?.trim() ||
    vehicle.movement?.requestStatus?.trim() ||
    "No movement record";

  return (
    <div className="inventory-hold-evidence-list">
      <h3 className="inventory-workspace-mobile-section-title">Hold details</h3>
      <p className="inventory-workspace-section-note">
        Hold position, operational reason, CDK status, paperwork, and delivery
        are separate. A hold alone does not mean sold or delivered.
      </p>
      {vehicle.holdEvidence.map((evidence) => (
        <HoldEvidenceRecord
          evidence={evidence}
          backupCount={Math.max(0, vehicle.holdEvidence!.length - 1)}
          key={evidence.id}
        />
      ))}
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
              {movement.state || "Not provided"}
            </Fact>
            <Fact label="Request status">
              {movement.requestStatus || "Not provided"}
            </Fact>
            <Fact label="Custody status">
              {movement.custodyStatus || "Not provided"}
            </Fact>
            <Fact label="Next action" emphasize>
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
              {movement.customerOutcome || "Not confirmed"}
            </Fact>
            <Fact label="Delivery confirmation">
              {movement.deliveryConfirmation || "Not confirmed"}
            </Fact>
            <Fact label="Movement ID">
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
    <ol className="inventory-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <span
            className={`inventory-timeline__icon inventory-timeline__icon--${event.source}`}
          >
            <TimelineIcon source={event.source} />
          </span>
          <div>
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
  );
}

function DataDetails({
  vehicle,
  onOpenSourceRecord,
}: Pick<VehicleWorkspaceProps, "vehicle" | "onOpenSourceRecord">) {
  return (
    <div className="inventory-workspace-detail-content inventory-workspace-data-details">
      <p className="inventory-workspace-section-note">
        These system signals are kept separate for auditing. They are not proof
        that a vehicle is unsold, on the lot, retail-ready, or available for a
        customer.
      </p>
      <section className="inventory-source-card">
        <div className="inventory-source-card__title">
          <Globe2 size={18} strokeWidth={1.75} aria-hidden="true" />
          <h4>Dealership website</h4>
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
          <h4>Inventory feed</h4>
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
          <h4>Hold system</h4>
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
        <Fact label="Inventory-reported store">
          {vehicle.location.sourceReportedStore?.name || "Not provided"}
        </Fact>
        <Fact label="CRM store">
          {vehicle.location.crmStore?.name || "Not provided"}
        </Fact>
        <Fact label="Model code">
          {vehicle.modelCode || "Not published"}
        </Fact>
      </dl>
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
    if (!usesCompactMobileWorkspace()) return;
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

    const dealerMailTab = window.open(dealerMailUrl, "_blank");
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
      panel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
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
        usesCompactMobileWorkspace() &&
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
      tab?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "nearest" });
      tab?.focus({ preventScroll: true });
    }, 0);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const navigableSections = usesCompactMobileWorkspace()
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
      ? vehicle.movement?.state ||
        vehicle.movement?.requestStatus ||
        "Movement tracked"
      : "No tracked move";
  const movementDetail = hasMovement
    ? vehicle.movement?.nextAction ||
      vehicle.movement?.lastEventLabel ||
      "Open location and movement details"
    : "No movement record in this app";
  const rawCdkStates = canViewHoldEvidence
    ? [...new Set((vehicle.holdEvidence ?? [])
        .map((evidence) => evidence.cdkState?.trim())
        .filter((value): value is string => Boolean(value)))]
    : [];
  const rawCdkLabel = !canViewHoldEvidence
    ? "Restricted"
    : rawCdkStates.length
      ? rawCdkStates.join(" / ")
      : "Not reported";
  const rawCdkDetail = !canViewHoldEvidence
    ? "Hold evidence is not visible for this role"
    : rawCdkStates.length
      ? "Raw DealerMail evidence; business mapping is not validated"
      : "No raw CDK status was supplied";
  const publicListingLabel = vehicle.publicListing.dataState !== "current"
    ? "Listing unverified"
    : vehicle.publicListing.isListed === true
      ? "Listed on website"
      : vehicle.publicListing.isListed === false
        ? "Not listed on website"
        : "Listing not reported";
  const publicListingDetail = vehicle.publicListing.websiteStatus ||
    (vehicle.publicListing.updatedAt
      ? `Updated ${formatDateTime(vehicle.publicListing.updatedAt)}`
      : `${dataStateLabel(vehicle.publicListing.dataState)} source`);
  const publicListingTone = vehicle.publicListing.dataState !== "current"
    ? "unverified"
    : vehicle.publicListing.isListed === true
      ? "clear"
      : "default";
  const inventoryFeedLabel = vehicle.dealerOn.dataState !== "current"
    ? "Feed status unverified"
    : vehicle.dealerOn.inStock === true
      ? "In-stock flag: Yes"
      : vehicle.dealerOn.inTransit === true
        ? "In-transit flag: Yes"
        : vehicle.dealerOn.inProduction === true
          ? "In-production flag: Yes"
          : vehicle.dealerOn.inStock === false
            ? "In-stock flag: No"
            : "Feed status not reported";
  const inventoryFeedDetail = vehicle.dealerOn.updatedAt
    ? `Updated ${formatDateTime(vehicle.dealerOn.updatedAt)}`
    : `${dataStateLabel(vehicle.dealerOn.dataState)} source`;
  const sourceStates = [
    vehicle.publicListing.dataState,
    vehicle.dealerOn.dataState,
    vehicle.dealerMail.dataState,
  ];
  const currentSourceCount = sourceStates.filter((state) => state === "current").length;
  const sourceFreshnessLabel = `${currentSourceCount} of ${sourceStates.length} current`;
  const sourceFreshnessDetail = sourceStates.some((state) => state === "stale")
    ? "At least one source update is delayed"
    : sourceStates.some((state) => state === "incomplete" || state === "unavailable")
      ? "At least one source needs review"
      : "Website, feed, and hold sources report current";
  const canManageDealerMail = vehicle.dealerMail.canManageHold === true;
  const mobileContextImageUrl = [
    ...(vehicle.imageUrls ?? []),
    vehicle.imageUrl,
  ].find((value): value is string => Boolean(value?.trim()));
  const mobileOverflowLabel = activeSection === "timeline"
    ? "History"
    : activeSection === "data"
      ? "Sources"
      : "More";
  return createPortal(
    <>
      <button
        type="button"
        className="inventory-workspace-backdrop"
        onClick={onClose}
        aria-label="Close vehicle details"
        tabIndex={-1}
      />
      <aside
        className={`inventory-workspace inventory-workspace--gallery-first inventory-workspace--dense inventory-workspace--compact-v3 inventory-workspace--oem-${oemTheme}`}
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
                <strong>{formatMileage(vehicle.mileage)}</strong>
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
                    Stock{" "}
                    <CopyableValue compact label="stock number" text={vehicle.stockNumber} />
                    <span aria-hidden="true"> · </span>
                    VIN{" "}
                    <CopyableValue compact label="VIN" text={vehicle.vin} />
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
                    {vehicle.price != null ? (
                      <CopyableValue compact label="price" text={String(vehicle.price)}>{formatMoney(vehicle.price)}</CopyableValue>
                    ) : formatMoney(vehicle.price)}
                  </Fact>
                  <Fact label="Mileage" emphasize>
                    {vehicle.mileage != null ? (
                      <CopyableValue compact label="mileage" text={String(vehicle.mileage)}>{formatMileage(vehicle.mileage)}</CopyableValue>
                    ) : formatMileage(vehicle.mileage)}
                  </Fact>
                  <Fact label="Days listed" emphasize>{vehicle.daysListed ?? "—"}</Fact>
                  {vehicle.msrp != null ? (
                    <Fact label="MSRP">
                      <CopyableValue compact label="MSRP" text={String(vehicle.msrp)}>{formatMoney(vehicle.msrp)}</CopyableValue>
                    </Fact>
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
                      className="inventory-button"
                      href={autoCheckUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      data-action="autocheck"
                      data-read-only="true"
                    >
                      <ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" /> AutoCheck
                    </a>
                  ) : null}
                  {stickerUrl || factoryEquipmentUrl ? (
                    <a
                      className="inventory-button"
                      href={stickerUrl || factoryEquipmentUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      data-action={stickerUrl ? "window-sticker" : "factory-equipment"}
                      data-read-only="true"
                    >
                      <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> {stickerUrl ? "Sticker" : "Equipment"}
                    </a>
                  ) : (
                    <button type="button" className="inventory-button" onClick={() => openAndFocusSection("equipment")} data-action="equipment">
                      <FileText size={16} strokeWidth={1.75} aria-hidden="true" /> Equipment
                    </button>
                  )}
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
                  {hasVehicleRecords || (canRequestVehicle && onRequestVehicle) || (vehicle.movement && onTrackMovement) || onViewVehicle ? (
                    <details className="inventory-workspace-v3-more">
                      <summary>
                        More <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                      </summary>
                      <div className="inventory-workspace-v3-more__actions" role="group" aria-label="More vehicle actions">
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
          >
            <button
              type="button"
              className={`inventory-workspace-mobile-status__hold inventory-workspace-mobile-status__hold--${holdTone}`}
              onClick={() => openAndFocusSection("hold")}
            >
              <UserRound size={18} strokeWidth={1.8} aria-hidden="true" />
              <strong>{holdLabel}</strong>
            </button>
            {canViewHoldEvidence ? (
              <span
                title={primaryHold?.salesperson || "Not provided"}
                aria-label={`Salesperson ${primaryHold?.salesperson || "not provided"}`}
              >
                <span className="inventory-workspace-mobile-status__label">Salesperson:</span>
                <strong>{primaryHold?.salesperson || "—"}</strong>
              </span>
            ) : (
              <span><strong>Hold details restricted</strong></span>
            )}
            <span aria-label={`Expected date ${formatDate(primaryHold?.expectedDeliveryDate)}`}>
              <span className="inventory-workspace-mobile-status__label">Expected:</span>
              <strong>{formatDate(primaryHold?.expectedDeliveryDate)}</strong>
            </span>
            <button
              type="button"
              className="inventory-workspace-mobile-status__location"
              onClick={() => openAndFocusSection("movement")}
            >
              {currentLocation.label}
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
              <button type="button" onClick={() => openAndFocusSection("data")} data-mobile-action="source-details">
                <FileSearch size={22} strokeWidth={1.7} aria-hidden="true" />
                <span>Source details</span>
              </button>
            )}
            {canManageDealerMail ? (
              <button type="button" onClick={focusDealerMailActions} data-mobile-action="dealermail">
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
                  <a href={autoCheckUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-read-only="true">AutoCheck</a>
                ) : null}
                {stickerUrl || factoryEquipmentUrl ? (
                  <a href={stickerUrl || factoryEquipmentUrl || undefined} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-read-only="true">
                    {stickerUrl ? "Window sticker" : "Equipment profile"}
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
              {WORKSPACE_SECTIONS.map((section) => (
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
              data-active-overflow={activeSection === "timeline" || activeSection === "data" ? "true" : "false"}
            >
              <summary aria-label="More vehicle sections">
                <span className="inventory-workspace-mobile-more-label" aria-hidden="true">
                  {mobileOverflowLabel === "More" ? (
                    <><span>Mo</span><span>re</span></>
                  ) : mobileOverflowLabel}
                </span>
                <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
              </summary>
              <div role="menu" aria-label="More vehicle sections">
                {WORKSPACE_SECTIONS.filter((section) => section.mobileOverflow).map((section) => (
                  <button
                    type="button"
                    role="menuitem"
                    aria-current={activeSection === section.id ? "page" : undefined}
                    onClick={() => {
                      if (mobileSectionMoreRef.current) mobileSectionMoreRef.current.open = false;
                      openAndFocusSection(section.id);
                    }}
                    key={section.id}
                  >
                    {section.mobileLabel}
                  </button>
                ))}
              </div>
            </details>
          </div>

          <div className="inventory-workspace-tab-panels">
            <WorkspacePanel id="overview" label="Overview" active={activeSection === "overview"}>
              <div className="inventory-workspace-v3-overview">
                <main className="inventory-workspace-v3-overview__main">
                  <OverviewDetails vehicle={vehicle} />
                  <VehicleIntelligence vehicle={vehicle} />
                </main>
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
                    aria-label="Source and system status"
                  >
                    <OperationalSignal
                      id="public-listing"
                      label="Public listing"
                      value={publicListingLabel}
                      detail={publicListingDetail}
                      icon={<Globe2 size={18} strokeWidth={1.8} aria-hidden="true" />}
                      tone={publicListingTone}
                      section="data"
                      active={activeSection === "data"}
                      onActivate={openAndFocusSection}
                    />
                    <OperationalSignal
                      id="dealeron"
                      label="Inventory feed"
                      value={inventoryFeedLabel}
                      detail={inventoryFeedDetail}
                      icon={<Database size={18} strokeWidth={1.8} aria-hidden="true" />}
                      tone={vehicle.dealerOn.dataState === "current" ? "default" : "unverified"}
                      section="data"
                      active={activeSection === "data"}
                      onActivate={openAndFocusSection}
                    />
                    <OperationalSignal
                      id="cdk"
                      label="Raw CDK evidence"
                      value={rawCdkLabel}
                      detail={rawCdkDetail}
                      icon={<FileSearch size={18} strokeWidth={1.8} aria-hidden="true" />}
                      tone={!canViewHoldEvidence ? "unverified" : "default"}
                      section="hold"
                      active={activeSection === "hold"}
                      onActivate={openAndFocusSection}
                    />
                    <OperationalSignal
                      id="source-freshness"
                      label="Source freshness"
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
                <aside className="inventory-workspace-equipment-specs" aria-label="Vehicle specifications">
                  <VehicleDetails vehicle={vehicle} />
                </aside>
              </div>
            </WorkspacePanel>
            <WorkspacePanel id="timeline" label="History" active={activeSection === "timeline"}>
              <TimelineDetails vehicle={vehicle} />
            </WorkspacePanel>
            <WorkspacePanel id="data" label="Source details" active={activeSection === "data"}>
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
