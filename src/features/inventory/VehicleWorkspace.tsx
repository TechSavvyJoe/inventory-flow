import { FlowLedgerHeading, flowButtonClassName } from "../../design-system";
import { ProviderEvidence, importedHoldSummary } from "./ProviderEvidence";
import { ManualHoldDialog } from './ManualHoldDialog';
import { holdActionLabel, holdStateLabel } from './hold-presentation';
import { CustomerSummary } from '../sales/CustomerSummary';
import { VehicleIssues, VehicleIssuesSummary } from '../issues/VehicleIssues';
import { IssueReportDialog } from '../issues/IssueReportDialog';
import { canReportVehicleIssue } from '../issues/issue-model';
import { confirmUnsavedWork } from '../../lib/useUnsavedChanges';
import { DispositionDialog } from '../overview/DispositionDialog';
import { defaultDispositionDate, DISPOSITION_QUALIFIER, dispositionSummary } from '../overview/disposition-model';
import type { VehicleIssueDetail } from '../../types';
import { EQUIPMENT_CATEGORIES, equipmentFinderItems, type EquipmentCategoryId, type EquipmentFinderItem } from "./vehicle-equipment";
import { CertifiedBadge } from "../../components/CertifiedBadge";
import { ServiceStatusLink } from "./ServiceStatusLink";
import { WorkspaceLink } from "../../components/WorkspaceLink";
import { VehicleDetailStatus } from "../../components/VehicleDetailStatus";
import { serviceWorkflowStatus } from "../../lib/service-readiness";
import { slaLabel, slaState, type SlaStatus } from "../../lib/sla-label";
import { VehicleGallery } from "./VehicleGallery";
import {
  useEffect,
  useId,
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  FileText,
  FileSearch,
  Gauge,
  Globe2,
  Heart,
  History,
  MapPin,
  MessageSquare,
  Navigation,
  Printer,
  ShieldCheck,
  Tag,
  Truck,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { formatNumber } from "../../lib/format";
import { CopyableValue } from "../../components/CopyableValue";
import { DealerMailHandoff } from "./DealerMailHandoff";
import { VehicleResourceCards, displaySourceMoney } from "./VehicleResourceCards";
import { oasisActionLabel, vehicleOverviewResources } from "./vehicle-resource-catalog";
import { resolveVehicleInService } from "./vehicle-in-service";
import {
  formatDate,
  formatDateTime,
  formatMileage,
  formatMoney,
  isMoveRequestBlocked,
  resolveCurrentLocation,
  sameStore,
  vehicleDisplayName,
} from "./inventory-utils";
import { primaryVehicleChangeSignal } from "./change-utils";
import { fordInvoiceUrl, fordOasisUrl, savedFordInvoiceUrl } from "./vehicle-document-utils";
import { publishedEquipment, standoutEquipment } from "./vehicle-feature-utils";
import { EquipmentKnowledge } from "./EquipmentKnowledge";
import { TakeHomeSheet } from "./TakeHomeSheet";
import { useCustomerShortlist } from "./useCustomerShortlist";
import { DataState, Fact, HoldEvidenceRecord, VehicleDocuments } from "./VehicleDocuments";
import { factoryPricing, factoryPriceLabel, formatFactoryPrice } from '../../../extension/sidepanel/lib/factory-pricing.mjs';
import { useContainedFocus } from "../../lib/useContainedFocus";
import type {
  InventoryVehicle,
  VehicleTimelineEvent,
  VehicleTimelineSource,
  VehicleWorkspaceProps,
} from "./types";
import "./VehicleWorkspace.focused.css";
import "./VehicleWorkspace.records.css";

type WorkspaceSectionId =
  | "overview"
  | "hold"
  | "movement"
  | "equipment"
  | "timeline"
  | "data"
  | "issues";

type WorkspacePageId = "overview" | "equipment" | "hold" | "data" | "timeline" | "issues";

const WORKSPACE_SECTIONS: Array<{ id: WorkspacePageId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "equipment", label: "Equipment" },
  { id: "data", label: "Records" },
  { id: "hold", label: "Holds & moves" },
  { id: "timeline", label: "Activity" },
  { id: "issues", label: "Issues" },
];

function workspacePage(section: WorkspaceSectionId): WorkspacePageId {
  if (section === "movement") return "hold";
  return section;
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

const EQUIPMENT_FINDER_LABELS: Record<EquipmentCategoryId, string> = {
  packages: "Packages", safety: "Safety & assist", comfort: "Comfort", technology: "Technology",
  towing: "Towing & utility", upgrades: "Upgrades", other: "Other equipment",
};
function EquipmentLedgerGroup({ category, items, vehicleId, showAll = false }: {
  category: (typeof EQUIPMENT_CATEGORIES)[number]; items: EquipmentFinderItem[]; vehicleId: string; showAll?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewCount = 5;
  const hasMore = items.length > previewCount && !showAll;
  const isPackage = category.id === "packages";
  useEffect(() => setExpanded(false), [vehicleId, category.id, showAll]);
  return <section className={`inventory-workspace-equipment-group inventory-workspace-equipment-group--${category.id}`}
    id={`inventory-equipment-section-${category.id}`} aria-labelledby={`inventory-equipment-group-${category.id}`}
    data-equipment-category={category.id} tabIndex={-1}>
    <header>
      <span className="inventory-workspace-equipment-group__icon">{equipmentCategoryIcon(category.id)}</span>
      <h4 id={`inventory-equipment-group-${category.id}`}>{EQUIPMENT_FINDER_LABELS[category.id]}</h4>
      <b aria-label={`${items.length} items`}>{items.length}</b>
    </header>
    <ul id={`inventory-equipment-list-${category.id}`}>
      {items.map((item,index) => <li key={item.text} className={item.display.price ? "has-price" : undefined} hidden={!expanded && !showAll && index >= previewCount}>
        {!isPackage ? <Check size={14} strokeWidth={1.8} className="inventory-workspace-equipment-item__mark" aria-hidden="true" /> : null}
        <span className="inventory-workspace-equipment-item__copy"><strong>{item.display.label}</strong>{item.display.code ? <small className="inventory-workspace-equipment-item-code">Code {item.display.code}</small> : null}</span>
        {item.display.price ? <span className="inventory-workspace-equipment-item__value">{displaySourceMoney(item.display.price)}</span> : null}
      </li>)}
    </ul>
    {hasMore ? <button type="button" className="inventory-workspace-equipment-group__toggle" aria-expanded={expanded}
      aria-controls={`inventory-equipment-list-${category.id}`} onClick={() => setExpanded(current => !current)}>
      {expanded ? "Show fewer" : `Show all ${items.length} items`}<ChevronDown size={15} aria-hidden="true"/>
    </button> : null}
  </section>;
}

function ReferenceFact({ label, source, children }: { label: string; source?: string | null; children: ReactNode }) {
  return <div className="inventory-workspace-fact"><dt><span>{label}</span>{source ? <small>{source}</small> : null}</dt><dd>{children}</dd></div>;
}

function SourceConfirmedEquipment({ vehicle }: { vehicle: InventoryVehicle }) {
  const items = useMemo(() => equipmentFinderItems(vehicle), [vehicle]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<EquipmentCategoryId | "all">("all");
  useEffect(() => { setQuery(""); setCategoryFilter("all"); }, [vehicle.id]);
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = items.filter(item => (categoryFilter === "all" || item.category === categoryFilter) && tokens.every(token => item.searchText.includes(token)));
  const active = Boolean(tokens.length || categoryFilter !== "all");
  const clear = () => { setQuery(""); setCategoryFilter("all"); };
  return <section className="inventory-workspace-equipment-evidence inventory-workspace-equipment-evidence--v10"
    id="inventory-equipment-all" aria-labelledby="inventory-workspace-equipment-evidence-title"
    data-content-state={items.length ? "available" : "not-published"} data-evidence-scope="vin-linked-published-only">
    <header className="inventory-workspace-equipment-evidence__header">
      <h3 id="inventory-workspace-equipment-evidence-title">Equipment &amp; packages</h3>
      {items.length ? <p className="inventory-equipment-finder__count" role="status" aria-live="polite">{active ? `${filtered.length} of ${items.length}` : items.length} equipment items</p> : null}
    </header>
    {items.length ? <>
      <div className="inventory-equipment-finder">
        <label className="inventory-equipment-finder__search"><FileSearch size={18} strokeWidth={1.8} aria-hidden="true"/><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search equipment, packages, or codes" placeholder="Search equipment, packages, or codes"/></label>
        {active ? <button type="button" onClick={clear}>Clear</button> : null}
      </div>
      <div className="inventory-equipment-layout">
        <EquipmentCategoryIndex items={items} selectedCategory={categoryFilter} onSelectCategory={setCategoryFilter} />
        <div className="inventory-equipment-results" id="inventory-equipment-results">
          {filtered.length ? <div className="inventory-workspace-equipment-evidence__groups" aria-label="Equipment organized by category">
            {EQUIPMENT_CATEGORIES.map(category => { const grouped = filtered.filter(item => item.category === category.id); return grouped.length ? <EquipmentLedgerGroup category={category} items={grouped} vehicleId={vehicle.id} showAll={active} key={category.id}/> : null; })}
          </div> : <div className="inventory-equipment-finder__empty"><FileSearch size={24} strokeWidth={1.6} aria-hidden="true"/><strong>No matching equipment</strong><p>Try another feature, package name, or source code.</p><button type="button" onClick={clear}>Show all equipment</button></div>}
        </div>
      </div>
    </> : <p className="inventory-workspace-equipment-evidence__empty" role="status">No equipment details are available for this vehicle.</p>}
  </section>;
}

function EquipmentCategoryIndex({ items, selectedCategory, onSelectCategory }: {
  items: EquipmentFinderItem[];
  selectedCategory: EquipmentCategoryId | "all";
  onSelectCategory: (category: EquipmentCategoryId | "all") => void;
}) {
  return <nav className="inventory-equipment-category-index" aria-label="Equipment categories">
    <button type="button" aria-label={`All equipment, ${items.length} ${items.length === 1 ? "item" : "items"}`} aria-pressed={selectedCategory === "all"} aria-controls="inventory-equipment-results" onClick={() => onSelectCategory("all")}>
      <FileText size={17} strokeWidth={1.8} aria-hidden="true"/><span>All equipment</span><b>{items.length}</b>
    </button>
    {EQUIPMENT_CATEGORIES.map(category => {
      const count = items.filter(item => item.category === category.id).length;
      return count ? <button type="button" aria-label={`${EQUIPMENT_FINDER_LABELS[category.id]}, ${count} ${count === 1 ? "item" : "items"}`} aria-pressed={selectedCategory === category.id} aria-controls="inventory-equipment-results"
        onClick={() => onSelectCategory(category.id)} key={category.id}>
        {equipmentCategoryIcon(category.id)}<span>{EQUIPMENT_FINDER_LABELS[category.id]}</span><b>{count}</b>
      </button> : null;
    })}
  </nav>;
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
            ? "Not publicly listed"
            : "Listing state not provided";
    const movementValue =
      humanizeWorkflowValue(vehicle.movement?.state) ||
      humanizeWorkflowValue(vehicle.movement?.requestStatus) ||
      null;
    const noCurrentHold =
      hold.dataState === "current" && hold.hasActiveHold === false;
    const distinguishSourceHold = Boolean(vehicle.operationalEvidence || vehicle.manualHold?.state === "active" || vehicle.manualHold?.state === "requested");

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
              {distinguishSourceHold
                ? "DealerMail hold evidence"
                : noCurrentHold ? "No active hold" : "Hold status needs review"}
            </h3>
            <p>Check availability with the home store before promising this vehicle.</p>
          </span>
        </header>
        <dl className="inventory-workspace-no-hold__facts">
          <Fact label="Hold status" emphasize>
            {noCurrentHold
              ? distinguishSourceHold ? "No current DealerMail hold found" : "No active hold recorded"
              : "Hold status not verified"}
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
          ? "Not publicly listed"
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
      <div className="vdp-focus-hold-records">
        {vehicle.holdEvidence.map((evidence) => (
          <div className={`vdp-focus-hold-record vdp-focus-hold-record--${evidence.position || "other"}`} key={evidence.id}>
            <HoldEvidenceRecord
              evidence={evidence}
              backupCount={Math.max(0, vehicle.holdEvidence!.length - 1)}
            />
          </div>
        ))}
      </div>
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

function movementStatus(vehicle: InventoryVehicle, viewerStore: string): SlaStatus | null {
  const movement = vehicle.movement;
  if (!movement) return null;
  return slaLabel({
    sla: slaState(movement.dueAt),
    nextActionStore: movement.nextActionStore,
    nextActionOwner: movement.nextActionOwner,
    viewerStore,
  });
}

function MovementDetails({ vehicle, status }: { vehicle: InventoryVehicle; status: SlaStatus | null }) {
  const movement = vehicle.movement;
  const location = vehicle.location;
  const current = resolveCurrentLocation(vehicle);
  const withheld = movement?.withheld === true;
  // The server says a new request would be refused, yet this role or store
  // sees no move to explain it: a request it may not see is open somewhere.
  const blockedUnseen = vehicle.moveRequestBlocked === true && !movement?.requestId;
  return (
    <div className="inventory-workspace-detail-content">
      {blockedUnseen ? (
        <div className="inventory-availability-note inventory-availability-note--compact">
          <Truck size={17} strokeWidth={1.75} aria-hidden="true" />
          <span>
            <strong>This vehicle already has an open move request.</strong>{" "}
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
          {status?.overdue ? (
            status.tone === "danger" ? (
              <div className="inventory-availability-note inventory-availability-note--danger">
                <Clock3 size={17} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  <strong>{status.label}.</strong> Confirm custody and assign the
                  next responsible person.
                </span>
              </div>
            ) : (
              // Another store owns this step: a plain fact, not a warning.
              <p className="inventory-workspace-section-note">{status.label}</p>
            )
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

export function VehicleWorkspace({
  vehicle, homeStore, canRequestVehicle = false, moveAction, initialTab = "overview", returnFocusRef, returnLabel = "Back to inventory", detailState, onRetryDetail,
  issueContext, dispositionContext,
  onClose, onRequestVehicle, onMoveVehicle, onTrackMovement, onOpenListing,
}: VehicleWorkspaceProps) {
  // Inherits the inventory list's signed-in shortlist; a standalone workspace
  // keeps its own session-only one.
  const shortlist = useCustomerShortlist();
  const shortlisted = shortlist.isShortlisted(vehicle);
  const shortlistWriteBlocked = Boolean(shortlist.management && (!shortlist.management.readyForWrites || shortlist.management.saving || shortlist.management.pendingAction || shortlist.management.accessRevoked));
  const [activeTarget, setActiveTarget] = useState<WorkspaceSectionId>(initialTab);
  const [takeHomeOpen, setTakeHomeOpen] = useState(false);
  const [issueReportOpen, setIssueReportOpen] = useState(false);
  const [manualHoldOpen, setManualHoldOpen] = useState(false);
  const manualHoldOpenerRef = useRef<HTMLButtonElement>(null);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [dispositionStatus, setDispositionStatus] = useState("");
  const dispositionOpenerRef = useRef<HTMLButtonElement>(null);
  const appDisposition = vehicle.appDisposition ?? null;
  const dispositionStorageMissing = dispositionContext?.enabled === false;
  const dispositionAction = !dispositionContext || !appDisposition || dispositionStorageMissing ? null
    : appDisposition.canManage ? appDisposition.code ? "Change disposition" : "Record disposition"
    : appDisposition.code ? "View disposition" : null;
  const [createdIssueId, setCreatedIssueId] = useState<string>();
  const [issueUpdates, setIssueUpdates] = useState<{ context: string; items: VehicleIssueDetail[] }>({ context: '', items: [] });
  const closeWorkspace = () => { if (confirmUnsavedWork()) onClose(); };
  const issueOpenerRef = useRef<HTMLElement | null>(null);
  const issueAccessKey = `${issueContext?.currentUser}:${issueContext?.role}:${issueContext?.homeStore}:${vehicle.vin}`;
  const vehicleIssues = useMemo(() => {
    const rows = new Map((issueContext?.issues ?? []).filter(issue => issue.vin === vehicle.vin).map(issue => [issue.id, issue]));
    if (issueUpdates.context === issueAccessKey) for (const issue of issueUpdates.items) {
      if (!rows.has(issue.id) || rows.get(issue.id)!.version <= issue.version) rows.set(issue.id, issue);
    }
    return [...rows.values()];
  }, [issueContext?.issues, issueUpdates, issueAccessKey, vehicle.vin]);
  const canReportIssue = Boolean(issueContext && canReportVehicleIssue(vehicle, issueContext));
  const workspaceSections = WORKSPACE_SECTIONS.filter(section => section.id !== 'issues' || issueContext);
  const reportIssue = (button: HTMLButtonElement) => {
    if (!confirmUnsavedWork()) return;
    issueOpenerRef.current = button;
    setIssueReportOpen(true);
  };
  function issueSaved(issue: VehicleIssueDetail) {
    setIssueUpdates(previous => ({ context: issueAccessKey, items: [...(previous.context === issueAccessKey ? previous.items.filter(row => row.id !== issue.id) : []), issue] }));
    void issueContext?.onChanged();
  }
  const [expandedDocumentsVin, setExpandedDocumentsVin] = useState<string | null>(null);
  const documentsId = useId();
  const documentsExpanded = expandedDocumentsVin === vehicle.vin;
  const hasCapturedDocuments = useMemo(() => vehicleOverviewResources(vehicle).some(resource => resource.hasCapturedData), [vehicle]);
  const takeHomeButtonRef = useRef<HTMLButtonElement>(null);
  const takeHomeOpenerRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"tab" | null>(null);
  const activePage = workspacePage(activeTarget);
  const displayName = vehicleDisplayName(vehicle);
  const listingUrl = vehicle.publicListing.listingUrl;
  const supportsFordDealerTools = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const invoiceUrl = supportsFordDealerTools
    ? vehicle.fordInvoice?.available ? savedFordInvoiceUrl(vehicle.vin) : fordInvoiceUrl(vehicle.vin)
    : null;
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
  const loanerLabel = vehicle.dealerMail.loaner?.active
    ? vehicle.dealerMail.loaner.serviceDate
      ? `${vehicle.dealerMail.loaner.program ? `Loaner ${vehicle.dealerMail.loaner.program}` : vehicle.dealerMail.loaner.label || "Loaner"} · ${formatDate(vehicle.dealerMail.loaner.serviceDate)}`
      : vehicle.dealerMail.loaner.program ? `Loaner ${vehicle.dealerMail.loaner.program}` : vehicle.dealerMail.loaner.label || "Loaner"
    : null;
  const appHoldOpen = vehicle.manualHold?.state === "active" || vehicle.manualHold?.state === "requested";
  const holdLabel = appHoldOpen ? holdStateLabel(vehicle.manualHold?.state ?? null) : vehicle.operationalEvidence ? importedHoldSummary(vehicle) : !holdCurrent ? (vehicle.dealerMail.lastKnownActiveHold ? "Last verified hold" : "Hold status unverified")
    : loanerLabel
      ? loanerLabel
    : vehicle.dealerMail.hasActiveHold === true
      ? "On hold"
      : vehicle.dealerMail.hasActiveHold === false ? "No current hold" : "Hold status not provided";
  const unifiedHoldLabel = appHoldOpen ? holdStateLabel(vehicle.manualHold?.state ?? null)
    : vehicle.inventoryDecision?.status === "held" || (holdCurrent && vehicle.dealerMail.hasActiveHold === true) ? "Held · Reported"
    : loanerLabel || holdLabel;
  const reportedHoldLabel = vehicle.operationalEvidence ? importedHoldSummary(vehicle)
    : loanerLabel || (holdCurrent && vehicle.dealerMail.hasActiveHold ? "Held" : vehicle.dealerMail.conciseState || "Hold status not verified");
  const showReportedHoldHeadline = Boolean(vehicle.manualHold?.state) || reportedHoldLabel !== unifiedHoldLabel;
  const hasReportedHoldContext = Boolean(vehicle.dealerMail.loaner?.rawAlert && loanerLabel || primaryHold?.salesperson || primaryHold?.expectedDeliveryDate || holdCount > 1);
  const hasMovement = Boolean(vehicle.movement?.requestId || vehicle.movement?.state);
  const nextStepStatus = movementStatus(vehicle, homeStore.name);
  const movementLabel = nextStepStatus?.overdue ? nextStepStatus.label
    : humanizeWorkflowValue(vehicle.movement?.state) || humanizeWorkflowValue(vehicle.movement?.requestStatus) || "No tracked move";
  const serviceStatus = serviceWorkflowStatus(vehicle.serviceReadiness);
  const serviceHref = `/service?vin=${encodeURIComponent(vehicle.vin)}`;
  const { date: warrantyInServiceDate, label: warrantyInServiceLabel, source: warrantyInServiceSource } = resolveVehicleInService(vehicle);
  const mpgCity = typeof vehicle.mpgCity === "number" && Number.isFinite(vehicle.mpgCity) && vehicle.mpgCity > 0 ? vehicle.mpgCity : null;
  const mpgHighway = typeof vehicle.mpgHighway === "number" && Number.isFinite(vehicle.mpgHighway) && vehicle.mpgHighway > 0 ? vehicle.mpgHighway : null;
  const fuelEconomy = mpgCity != null && mpgHighway != null
    ? `${mpgCity} city / ${mpgHighway} hwy MPG`
    : mpgCity != null ? `${mpgCity} city MPG`
      : mpgHighway != null ? `${mpgHighway} hwy MPG` : null;
  const factoryPrices = factoryPricing(vehicle);
  const baseMsrpLabel = factoryPriceLabel(factoryPrices.base.source, true);
  const baseMsrpDisplay = factoryPrices.base.value === null ? "—" : formatFactoryPrice(factoryPrices.base.value, factoryPrices.base.currency);
  const baseMsrpSource = factoryPrices.base.source === "window-sticker" ? "Window sticker" : factoryPrices.base.source === "vauto" ? "vAuto equipment" : null;
  const factoryEquipmentGroup = vehicle.factoryEquipment?.packages?.find(item => /equipment\s+group/i.test(item.name))?.name.trim() || null;
  const equipmentGroup = vehicle.windowSticker?.equipmentGroup?.trim()
    ? { value: vehicle.windowSticker.equipmentGroup.trim(), source: "Window sticker" }
    : factoryEquipmentGroup
      ? { value: factoryEquipmentGroup, source: "vAuto equipment" }
      : null;
  const historyCheck = (pattern: RegExp) => vehicle.autoCheckReport?.checks?.find(check => pattern.test(check.label))?.status?.trim() || null;
  const vehicleHistoryFacts = vehicle.autoCheckReport && ["current", "stale"].includes(vehicle.autoCheckReport.dataState ?? "current") ? [
    ["Score", Number.isFinite(vehicle.autoCheckReport.score) ? String(vehicle.autoCheckReport.score) : null],
    ["Owners", Number.isFinite(vehicle.autoCheckReport.ownerCount) ? `${vehicle.autoCheckReport.ownerCount} reported` : null],
    ["Title", historyCheck(/(?:^|\b)(?:state )?title\b/i)],
    ["Accidents", historyCheck(/accident|damage/i)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1])) : [];
  const coverageSource = vehicle.warrantyCheck?.fordOasis?.coverages?.length
    ? { rows:vehicle.warrantyCheck.fordOasis.coverages, label:"OASIS" }
    : vehicle.warrantyCheck?.autoCheck?.coverages?.length
      ? { rows:vehicle.warrantyCheck.autoCheck.coverages, label:"AutoCheck estimate" }
      : vehicle.warrantyCheck?.carfax?.coverages.length
        ? { rows:vehicle.warrantyCheck.carfax.coverages, label:"CARFAX estimate" }
        : null;
  const coverage = coverageSource?.rows.find(row => row.status === "ACTIVE") ?? coverageSource?.rows[0] ?? null;
  const coverageSummary = coverage ? [coverage.type, coverage.remainingTimeText, coverage.remainingMilesText?.replace(/^(\d+)(\s+miles?)$/i, (_match, miles, unit) => `${formatNumber(Number(miles))}${unit}`)].filter(Boolean).join(" · ") : null;
  const recordsNeedReview = [vehicle.publicListing.dataState, vehicle.dealerOn.dataState, vehicle.dealerMail.dataState]
    .some((state) => state !== "current");
  const equipmentLabels = new Set<string>();
  const keyEquipment = [...standoutEquipment(vehicle, 12), ...publishedEquipment(vehicle)].flatMap(item => {
    // Keep scan labels concise; exact prices, source codes and child markers
    // remain on their original sticker/Records lines.
    let label = item.label.replace(/\s+(?:[·|]\s*)?((?:USD|CAD)\s*\$?[\d,]+(?:\.\d{2})?|\$[\d,]+(?:\.\d{2})?|NO\s*CHARGE)$/i, '')
      .replace(/\s*\([A-Z0-9-]+\)$/, '')
      .replace(/\s*[·|]\s*[A-Z]{2,}-[A-Z0-9-]+$/, '');
    if (/^(?:[•·.]|[-–—])(?:\s+|(?=[A-Za-z]))|^\.\d+(?:[./"'–—-]|\s)/.test(label)) label = label.slice(1).trimStart();
    const identity = label.toLocaleLowerCase();
    if (!label || equipmentLabels.has(identity)) return [];
    equipmentLabels.add(identity);
    return [{ ...item, label }];
  }).slice(0, 12);
  const specifications = [
    ["Mileage", formatMileage(vehicle.mileage)],
    ["Days listed", vehicle.daysListed != null ? `${vehicle.daysListed} days` : null],
    ["Engine", vehicle.engine], ["Drivetrain", vehicle.drivetrain],
    ["Transmission", vehicle.transmission], ["Body style", vehicle.bodyStyle || vehicle.bodyType],
    ["Exterior", vehicle.exteriorColor], ["Interior", vehicle.interiorColor],
    ["Fuel", vehicle.fuelType], ["Fuel economy", fuelEconomy],
  ].filter((fact) => Boolean(fact[1]));
  const equipmentSpecifications = [
    ["Mileage", formatMileage(vehicle.mileage)],
    ["Age", vehicle.daysListed != null ? `${vehicle.daysListed} days` : null],
    ["Engine", vehicle.engine],
    ["Drive", vehicle.drivetrain],
    ["Transmission", vehicle.transmission],
    ["Body", vehicle.bodyStyle || vehicle.bodyType],
    ["Trim", vehicle.trim],
    ["Exterior", vehicle.exteriorColor],
    ["Interior", vehicle.interiorColor],
    ["Fuel", vehicle.fuelType],
    [factoryPriceLabel(factoryPrices.original.source), factoryPrices.original.value === null ? null : formatFactoryPrice(factoryPrices.original.value, factoryPrices.original.currency)],
    [baseMsrpLabel, factoryPrices.base.value === null ? null : baseMsrpDisplay],
    ["Model code", vehicle.modelCode],
    ["MPG city / hwy", vehicle.mpgCity != null || vehicle.mpgHighway != null ? `${vehicle.mpgCity ?? "—"} / ${vehicle.mpgHighway ?? "—"}` : null],
  ].filter((fact) => Boolean(fact[1]));
  // `moveAction` is the role-aware server-backed path. Keep the legacy
  // boolean prop as a compatibility fallback, but never let it overrule the
  // server's explicit active-move/blocking decision.
  const resolvedMoveAction = moveAction ?? (!isMoveRequestBlocked(vehicle) && canRequestVehicle
    ? { intent: "request" as const, label: "Request vehicle", shortLabel: "Request" }
    : null);
  const canTrackMovement = Boolean(vehicle.movement?.requestId && onTrackMovement);
  const canCreateMovement = Boolean(resolvedMoveAction && (onMoveVehicle || onRequestVehicle) && (!canTrackMovement || moveAction));
  const movementAction = <>
    {canTrackMovement ? <button className={flowButtonClassName({ variant: serviceStatus === "serviced" ? "primary" : "secondary" })} type="button" onClick={() => onTrackMovement?.(vehicle)} data-action="track-movement"><Truck size={18} aria-hidden="true" />Track movement</button> : null}
    {canCreateMovement && resolvedMoveAction ? <button className={flowButtonClassName({ variant: serviceStatus === "serviced" && !canTrackMovement ? "primary" : "secondary" })} type="button" onClick={() => onMoveVehicle ? onMoveVehicle(vehicle, resolvedMoveAction.intent) : onRequestVehicle?.(vehicle)} aria-label={resolvedMoveAction.label} title={resolvedMoveAction.label} data-action={resolvedMoveAction.intent === "direct" ? "move-vehicle" : "request-vehicle"}><ArrowLeftRight size={18} aria-hidden="true" />{resolvedMoveAction.shortLabel}</button> : null}
  </>;

  function openAndFocusSection(target: WorkspaceSectionId) {
    if (target !== activeTarget && !confirmUnsavedWork()) return;
    pendingFocus.current = "tab";
    setActiveTarget(target);
    // Reselecting the current section also returns to its beginning.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (target === activeTarget) activeTabRef.current?.focus({ preventScroll: true });
  }
  function onSectionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % workspaceSections.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + workspaceSections.length) % workspaceSections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = workspaceSections.length - 1;
    else return;
    event.preventDefault();
    openAndFocusSection(workspaceSections[next].id);
  }
  useLayoutEffect(() => {
    setActiveTarget(initialTab);
    setTakeHomeOpen(false);
    setIssueReportOpen(false);
    setDispositionOpen(false);
    setDispositionStatus("");
    setCreatedIssueId(undefined);
    setExpandedDocumentsVin(null);
    pendingFocus.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [initialTab, vehicle.id, vehicle.vin]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (pendingFocus.current === "tab") activeTabRef.current?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [activeTarget, vehicle.id]);
  useContainedFocus({
    // Stays active while the Take-home sheet is open: the hook yields Escape and
    // Tab to the nested aria-modal sheet, and toggling it off re-ran the initial
    // focus on close, stealing focus from the Take-home button.
    active: true, contain: true, containerRef: workspaceRef, initialFocusRef: activeTabRef,
    returnFocusRef, onEscape: closeWorkspace,
  });

  return createPortal(
    <>
      <div className={`inventory-workspace-backdrop vdp-focus-backdrop${takeHomeOpen ? " is-take-home-open" : ""}`} onClick={closeWorkspace} aria-hidden="true" />
      <aside id="inventory-vehicle-workspace" className={`inventory-workspace inventory-workspace--focused${takeHomeOpen ? " is-take-home-open" : ""}`}
        ref={workspaceRef} role="dialog" aria-modal="true" aria-label={displayName + " vehicle workspace"} tabIndex={-1}
        data-active-section={activePage} data-active-target={activeTarget} data-has-issues={Boolean(issueContext)}>
        <header className="vdp-focus-header">
          <button type="button" className={flowButtonClassName({ variant: "quiet", className: "vdp-focus-back" })} onClick={closeWorkspace} aria-label={returnLabel}><ChevronLeft size={20} aria-hidden="true" /><span>{returnLabel}</span></button>
          <div className="vdp-focus-primary">
            <div className="vdp-focus-identity"><h2 id="inventory-workspace-title"><CarFront size={20} aria-hidden="true"/><span>{displayName}</span></h2><span className="vdp-focus-mobile-stock">Stock {vehicle.stockNumber}</span></div>
            <div className="vdp-focus-subline">
              <dl className="vdp-focus-identifiers">
                <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stockNumber} /></dd></div>
                <div><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin} /></dd></div>
              </dl>
              <div className="vdp-focus-glance" role="group" aria-label="Quick vehicle status">
                <span aria-label={`Location: ${currentLocation.label}`}><strong>{currentLocation.label}</strong></span>
                <span aria-label={`Hold status: ${holdLabel}`}><strong>{holdLabel}</strong></span>
                <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} labelPrefix="Service" detailed compact />
              </div>
            </div>
          </div>
          <div className="vdp-focus-price"><span>Published price</span><strong>{formatMoney(vehicle.price)}</strong></div>
          <button type="button" className={flowButtonClassName({ variant: "quiet", className: "vdp-focus-close" })} onClick={closeWorkspace} aria-label="Close vehicle details"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="vdp-focus-navigation">
          <div className="vdp-focus-tabs" role="tablist" aria-label="Vehicle workspace sections">
            {workspaceSections.map((section, index) => <button type="button" role="tab" id={"inventory-tab-" + section.id}
              aria-controls={"inventory-section-" + section.id} aria-selected={activePage === section.id}
              tabIndex={activePage === section.id ? 0 : -1} ref={activePage === section.id ? activeTabRef : undefined}
              onKeyDown={event => onSectionKeyDown(event, index)}
              onClick={() => openAndFocusSection(section.id)} key={section.id}>{section.label}</button>)}
          </div>
        </div>
        {/* Firefox includes scroll containers in Tab order. Explicit focus keeps
            this region in the dialog's contained order across all browsers. */}
        <div className="vdp-focus-scroll" ref={scrollRef} role="region" aria-label="Vehicle workspace content" tabIndex={0}>
          <VehicleDetailStatus state={detailState} onRetry={onRetryDetail} />
          <WorkspacePanel id="overview" label="Overview" active={activePage === "overview"}>
            <div className="vdp-focus-overview">
                <div className="vdp-focus-gallery-column">
                  <div className="vdp-focus-photo"><VehicleGallery vehicle={vehicle} /></div>
                  <dl className="vdp-focus-mobile-valuation" role="group" aria-label="Vehicle mileage and age">
                    <Fact label="Mileage">{vehicle.mileage != null ? <CopyableValue compact label="mileage" text={String(vehicle.mileage)}>{formatMileage(vehicle.mileage)}</CopyableValue> : formatMileage(vehicle.mileage)}</Fact>
                    {vehicle.daysListed != null ? <Fact label="Days listed">{vehicle.daysListed} days</Fact> : null}
                  </dl>
                </div>
              <section className="vdp-focus-operations" aria-label="Vehicle operational summary">
                <dl>
                  <Fact label="Location"><strong>{currentLocation.label}</strong>{vehicle.location.conflict ? <small>Location conflict — review needed</small> : null}</Fact>
                  <Fact label="Hold" className="vdp-focus-source-hold-fact">
                    <strong>{unifiedHoldLabel}</strong>
                    {vehicle.manualHold?.state ? <div role="group" aria-label="Inventory Flow hold">
                      <small>Inventory Flow: {holdStateLabel(vehicle.manualHold.state)}</small>
                      {appHoldOpen && canViewHoldEvidence && (vehicle.manualHold.customerLabel || vehicle.manualHold.expectedDeliveryDate) ? <small className="vdp-focus-hold-context">{[vehicle.manualHold.customerLabel, vehicle.manualHold.expectedDeliveryDate ? `Expected ${formatDate(vehicle.manualHold.expectedDeliveryDate)}` : null].filter(Boolean).join(" · ")}</small> : null}
                    </div> : null}
                    {showReportedHoldHeadline || hasReportedHoldContext ? <div role="group" aria-label="Reported hold evidence">
                      {showReportedHoldHeadline ? <small>Reported evidence: {reportedHoldLabel}</small> : null}
                      {vehicle.dealerMail.loaner?.rawAlert && loanerLabel ? <small>{vehicle.dealerMail.loaner.rawAlert}</small> : null}
                      {primaryHold?.salesperson || primaryHold?.expectedDeliveryDate || holdCount > 1 ? <small className="vdp-focus-hold-context">{[primaryHold?.salesperson, primaryHold?.expectedDeliveryDate ? `Expected ${formatDate(primaryHold.expectedDeliveryDate)}` : null, holdCount > 1 ? `${holdCount - 1} backup ${holdCount === 2 ? "hold" : "holds"}` : null].filter(Boolean).join(" · ")}</small> : null}
                    </div> : null}
                    {vehicle.operationalEvidence && loanerLabel ? <div role="group" aria-label="DealerMail operational evidence">
                      <small>DealerMail: {loanerLabel}</small>
                    </div> : null}
                  </Fact>
                  <Fact label="Service" className="vdp-focus-service-fact"><ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} compact /></Fact>
                  {appDisposition ? <Fact label="Disposition" className="vdp-focus-disposition-fact">{dispositionStorageMissing
                    ? <><strong>Not available</strong><small>Disposition storage is not enabled yet.</small></>
                    : <strong>{dispositionSummary(appDisposition)}</strong>}</Fact> : null}
                </dl>
                <div className="vdp-focus-actions" role="group" aria-label="Vehicle operations">
                  {serviceStatus === "needs_service" ? <WorkspaceLink className={flowButtonClassName({ variant: "primary" })} to={serviceHref + "&action=in_service"} preserveOrigin><Wrench size={18} aria-hidden="true" />Start service</WorkspaceLink> : null}
                  {movementAction}
                  <button className={flowButtonClassName({ variant: "secondary" })} type="button" onClick={() => openAndFocusSection("hold")} data-action="hold-details"><MessageSquare size={18} aria-hidden="true" />Hold status</button>
                  {serviceStatus !== "serviced" ? <WorkspaceLink className={flowButtonClassName({ variant: serviceStatus === "needs_service" ? "secondary" : "primary" })} to={serviceHref + "&action=serviced"} preserveOrigin><Check size={18} aria-hidden="true" />Mark Ready</WorkspaceLink> : null}
                  {serviceStatus === "serviced" ? <WorkspaceLink className={flowButtonClassName({ variant: "secondary" })} to={serviceHref} preserveOrigin>Service history</WorkspaceLink> : null}
                  {dispositionContext && vehicle.manualHold?.enabled ? <button className={flowButtonClassName({ variant: "secondary" })} type="button" ref={manualHoldOpenerRef} onClick={() => setManualHoldOpen(true)}><Tag size={18} aria-hidden="true" />{holdActionLabel(vehicle.manualHold, dispositionContext.role)}</button> : null}
                  {dispositionAction ? <button className={flowButtonClassName({ variant: "secondary" })} type="button" ref={dispositionOpenerRef} onClick={() => { setDispositionStatus(""); setDispositionOpen(true); }} data-action="disposition"><ClipboardCheck size={18} aria-hidden="true" />{dispositionAction}</button> : null}
                </div>
                {dispositionStatus ? <p className="vdp-focus-next-action" role="status">{dispositionStatus}</p> : null}
                {vehicle.inventoryDecision?.comparison === 'conflict' ? <p className="vdp-focus-next-action" role="status"><strong>Records disagree</strong> · Review Inventory Flow and reported hold / disposition evidence.</p> : null}
                {hasMovement ? <div className="vdp-focus-next-action"><strong className={nextStepStatus?.tone === "danger" ? "vdp-focus-next-action__overdue" : undefined}>{movementLabel}</strong><p>{vehicle.movement?.nextAction || vehicle.movement?.lastEventLabel || "Review the movement details."}</p></div> : null}
              </section>
              <div className="vdp-focus-vehicle-context">
                <div className="vdp-focus-vehicle-intelligence">
                  <section className="vdp-focus-specs" aria-label="Vehicle specifications">
                    <FlowLedgerHeading level={3} variant="plain" className="vdp-focus-ledger-heading" title={<><Gauge size={20} aria-hidden="true" />Vehicle details</>} />
                    <dl className="vdp-focus-desktop-specs">
                      {specifications.map(([label, value]) => <Fact key={label} label={label!} className={label === "Mileage" ? "vdp-focus-copy-fact vdp-focus-selling-fact" : label === "Days listed" ? "vdp-focus-selling-fact" : undefined}>{label === "Mileage" && vehicle.mileage != null ? <CopyableValue compact label="mileage" text={String(vehicle.mileage)}>{value}</CopyableValue> : value}</Fact>)}
                    </dl>
                    <p className="vdp-focus-listing">{vehicle.location.homeStore.name} · {vehicle.publicListing.dataState !== "current" ? "Listing unverified" : vehicle.publicListing.isListed === true ? "Listed online" : vehicle.publicListing.isListed === false ? "Not publicly listed" : "Listing state not provided"}{vehicle.certified ? <> · <CertifiedBadge certified homeStore={vehicle.location.homeStore.name} /></> : null}</p>
                  </section>
                  {vehicleHistoryFacts.length ? <section className="vdp-focus-history-facts" aria-label="AutoCheck history">
                    <FlowLedgerHeading level={3} className="vdp-focus-ledger-heading vdp-focus-history-heading" title={<><History size={20} aria-hidden="true" />History</>} actions={<img src="/resource-brands/autocheck.svg" alt="AutoCheck" />} />
                    <dl>{vehicleHistoryFacts.map(([label, value]) => <Fact key={label} label={label} className={label === "Score" ? "vdp-focus-history-score" : undefined}>{value}</Fact>)}</dl>
                    {vehicle.autoCheckReport?.dataState === "stale" ? <p className="vdp-focus-history-source">Saved report · review current history</p> : null}
                  </section> : null}
                </div>
                <section className="vdp-focus-highlights" aria-label="Key equipment">
                  <FlowLedgerHeading level={3} className="vdp-focus-ledger-heading" title={<><Check size={20} aria-hidden="true" />Key equipment</>} actions={<button className={flowButtonClassName({ variant: "quiet" })} type="button" onClick={() => openAndFocusSection("equipment")}>View all equipment <ChevronRight size={16} aria-hidden="true" /></button>} />
                  {keyEquipment.length ? <ul>{keyEquipment.map(item => <li key={item.label}><Check size={16} aria-hidden="true" /><span>{item.label}</span></li>)}</ul> : <p>No equipment highlights are available.</p>}
                </section>
                {factoryPrices.original.value !== null || factoryPrices.base.value !== null ? <dl className="vdp-focus-pricing-facts" aria-label="Original vehicle pricing">
                  {factoryPrices.original.value !== null ? <Fact label={factoryPriceLabel(factoryPrices.original.source)}><span className="vdp-focus-reference-value">{formatFactoryPrice(factoryPrices.original.value, factoryPrices.original.currency)}</span><small>{factoryPrices.original.source === "window-sticker" ? "Window sticker" : "vAuto equipment"}</small></Fact> : null}
                  {factoryPrices.base.value !== null ? <Fact label={baseMsrpLabel}><CopyableValue compact label="base MSRP" text={String(factoryPrices.base.value)}>{baseMsrpDisplay}</CopyableValue>{baseMsrpSource ? <small>{baseMsrpSource} · Before options &amp; destination</small> : null}</Fact> : null}
                </dl> : null}
                <section className="vdp-focus-document-shortcuts" aria-label="Document shortcuts">
                  <VehicleResourceCards vehicle={vehicle} variant="shortcuts" hiddenShortcutFactLabels={vehicleHistoryFacts.filter(([label]) => label === "Score" || label === "Owners").map(([label]) => label)} onOpenSection={openAndFocusSection} />
                </section>
                <section className="vdp-focus-keyfacts" aria-label="Frequently used vehicle facts">
                  <FlowLedgerHeading level={3} className="vdp-focus-ledger-heading" title={<><ShieldCheck size={20} aria-hidden="true" />Reference facts</>} />
                  <dl>
                    <ReferenceFact label={warrantyInServiceSource && warrantyInServiceSource !== "oasis" ? "Est. in-service" : "In-service"} source={warrantyInServiceSource ? warrantyInServiceSource === "oasis" ? "OASIS" : warrantyInServiceSource === "carfax" ? "CARFAX estimate" : "AutoCheck estimate" : null}><span className="vdp-focus-reference-date">{warrantyInServiceDate ? formatDate(warrantyInServiceDate) : "—"}</span></ReferenceFact>
                    {vehicle.serviceHistory?.reports.length ? <ReferenceFact label="Service records" source={vehicle.serviceHistory.reports.map(report => report.sourceLabel).join(" · ")}><button type="button" className="vdp-focus-reference-action" onClick={() => openAndFocusSection("data")}>{vehicle.serviceHistory.reports.reduce((sum,report) => sum+report.entries.length,0)} reported events</button></ReferenceFact> : null}
                    {coverageSummary ? <ReferenceFact label="Coverage" source={coverageSource?.label}><span>{coverageSummary}</span></ReferenceFact> : null}
                    {equipmentGroup ? <ReferenceFact label="Equipment group" source={equipmentGroup.source}><span>{equipmentGroup.value}</span></ReferenceFact> : null}
                  </dl>
                </section>
                <div className="vdp-focus-mobile-vin"><span>VIN</span><CopyableValue compact label="VIN" text={vehicle.vin} /></div>
              </div>
              {primaryHold?.salesperson || primaryHold?.expectedDeliveryDate || holdCount > 1 || appDisposition || issueContext ? <section className="vdp-focus-operational-details" aria-label="Operational details">
                <FlowLedgerHeading level={3} variant="plain" className="vdp-focus-ledger-heading" title={<><ClipboardCheck size={20} aria-hidden="true" />Operational details</>} />
                {primaryHold?.salesperson || primaryHold?.expectedDeliveryDate || holdCount > 1 || appDisposition ? <dl>
                  {primaryHold?.salesperson ? <Fact label="Salesperson">{primaryHold.salesperson}</Fact> : null}
                  {primaryHold?.expectedDeliveryDate ? <Fact label="Expected">{formatDate(primaryHold.expectedDeliveryDate)}</Fact> : null}
                  {holdCount > 1 ? <Fact label="Backup holds">{holdCount - 1}</Fact> : null}
                  {appDisposition ? <Fact label="Disposition">{dispositionStorageMissing
                    ? <><strong>Not available</strong><small>Disposition storage is not enabled yet.</small></>
                    : <><strong>{dispositionSummary(appDisposition)}</strong><small>{appDisposition.effectiveDate ? `${formatDate(appDisposition.effectiveDate)} · ` : ""}{DISPOSITION_QUALIFIER}</small></>}</Fact> : null}
                </dl> : null}
                {issueContext ? <VehicleIssuesSummary issues={vehicleIssues} canReport={canReportIssue} enabled={issueContext.enabled} onOpen={() => openAndFocusSection('issues')} onReport={reportIssue} /> : null}
              </section> : null}
              <section className="vdp-focus-resources" aria-label="Documents and vehicle records">
                <FlowLedgerHeading level={3} className="vdp-focus-ledger-heading" title={<><FileText size={20} aria-hidden="true" />Documents & vehicle records</>} actions={<div className="vdp-document-actions">
                    {hasCapturedDocuments ? <button className={flowButtonClassName({ variant: "quiet" })} type="button" aria-expanded={documentsExpanded} aria-controls={documentsId}
                      onClick={() => setExpandedDocumentsVin(documentsExpanded ? null : vehicle.vin)}>
                      {documentsExpanded ? "Hide details" : "Show details"}<ChevronDown size={16} aria-hidden="true" />
                    </button> : null}
                    <button className={flowButtonClassName({ variant: "quiet" })} type="button" onClick={() => openAndFocusSection("data")}>Full records <ChevronRight size={16} aria-hidden="true" /></button>
                  </div>} />
                <div id={documentsId}>
                  <VehicleResourceCards vehicle={vehicle} variant="summary" summaryLimit={6} hideInServiceDate detailsExpanded={documentsExpanded} onOpenSection={openAndFocusSection} />
                </div>
              </section>
              {vehicle.managerDisposition ? <p className="vdp-focus-warning"><ClipboardCheck size={16} aria-hidden="true" /><strong>Manager log: {vehicle.managerDisposition.soldLabel}</strong> · {vehicle.managerDisposition.deliveryLabel}{vehicle.managerDisposition.deliveryDate ? ` · ${formatDate(vehicle.managerDisposition.deliveryDate)}` : ""}<small>Independent of listing, hold, CDK, and location.</small></p> : null}
              {openRecallCount ? <button type="button" className="vdp-focus-warning" onClick={() => openAndFocusSection("data")}
                aria-label={`${oasisActionLabel(vehicle.fordOasis)}; review vehicle records`}><AlertTriangle size={16} aria-hidden="true" />{oasisActionLabel(vehicle.fordOasis)} · Review vehicle records</button> : null}
              {recordsNeedReview ? <button type="button" className="vdp-focus-warning" onClick={() => openAndFocusSection("data")}><AlertTriangle size={16} aria-hidden="true" />Some vehicle information needs review.</button> : null}
              <CustomerSummary key={vehicle.id} vehicle={vehicle} onRecords={() => openAndFocusSection("data")} onTakeHome={(button) => { takeHomeOpenerRef.current = button; setTakeHomeOpen(true); }} />
            </div>
          </WorkspacePanel>
          <WorkspacePanel id="equipment" label="Equipment" active={activePage === "equipment"}>
            <SourceConfirmedEquipment vehicle={vehicle} />
            <EquipmentKnowledge vehicle={vehicle} />
            <details className="vdp-equipment-specifications" aria-label="Complete vehicle specifications">
              <summary><Gauge size={17} strokeWidth={1.8} aria-hidden="true"/><span>Specifications</span><ChevronDown size={16} aria-hidden="true"/></summary>
              <dl className="vdp-focus-extra-specs">{equipmentSpecifications.map(([label, value]) => <Fact key={label} label={label!} className={label === "Model code" ? "vdp-spec-model-code" : undefined}>{value}</Fact>)}</dl>
            </details>
            <details className="vdp-equipment-description" aria-label="Vehicle description">
              <summary><FileText size={17} strokeWidth={1.8} aria-hidden="true"/><span>Description</span><ChevronDown size={16} aria-hidden="true"/></summary>
              <p>{vehicle.dealerComments || "No vehicle description was published."}</p>
            </details>
          </WorkspacePanel>
          <WorkspacePanel id="data" label="Records" active={activePage === "data"}>
            <dl className="vdp-records-summary"><Fact label={baseMsrpLabel}>{factoryPrices.base.value !== null ? <CopyableValue compact label="base MSRP" text={String(factoryPrices.base.value)}>{baseMsrpDisplay}</CopyableValue> : baseMsrpDisplay}</Fact><Fact label={warrantyInServiceLabel}>{warrantyInServiceDate ? formatDate(warrantyInServiceDate) : "—"}</Fact></dl>
            <VehicleDocuments vehicle={vehicle} />
            {!vehicle.autoCheckReport && !vehicle.windowSticker && !vehicle.factoryEquipment && !vehicle.fordOasis && !vehicle.warrantyCheck && !vehicle.serviceHistory?.reports.length ? <div className="vdp-focus-empty"><h3>Vehicle records</h3><p>No vehicle records are available.</p></div> : null}
            {openRecallCount && oasisUrl ? <a className="vdp-focus-warning" href={oasisUrl} target="_blank" rel="noopener noreferrer">{oasisActionLabel(vehicle.fordOasis)} · Review OASIS</a> : null}
          </WorkspacePanel>
          <WorkspacePanel id="hold" label="Holds & moves" active={activePage === "hold"}>
            <FlowLedgerHeading level={3} variant="plain" className="vdp-focus-ledger-heading" title="Holds & moves" actions={<div className="vdp-focus-actions">{movementAction}</div>} />
            {vehicle.manualHold ? <section className="vdp-focus-manual-summary" aria-label="Hold and disposition controls"><div><strong>{unifiedHoldLabel}</strong><span>Inventory Flow: <span>{holdStateLabel(vehicle.manualHold.state)}</span> · {dispositionSummary(appDisposition)}</span></div><div className="vdp-focus-actions">{dispositionContext && vehicle.manualHold.enabled ? <button className={flowButtonClassName({ variant: "secondary" })} type="button" onClick={event => { manualHoldOpenerRef.current = event.currentTarget; setManualHoldOpen(true); }}>{holdActionLabel(vehicle.manualHold, dispositionContext.role)}</button> : null}{dispositionAction ? <button className={flowButtonClassName({ variant: "secondary" })} type="button" onClick={event => { dispositionOpenerRef.current = event.currentTarget; setDispositionOpen(true); }}>{dispositionAction}</button> : null}</div></section> : null}
            <ProviderEvidence vehicle={vehicle} />
            <div className="vdp-focus-hold-grid inventory-workspace-hold-center" data-hold-state={vehicle.holdEvidence?.length ? "held" : "no-evidence"}>
              <div className="vdp-focus-hold-evidence"><HoldDetails vehicle={vehicle} /></div>
              <div className="vdp-focus-movement-panel">
                <section id="inventory-section-movement" tabIndex={-1} aria-labelledby="inventory-movement-heading" className="vdp-focus-movement"><h3 id="inventory-movement-heading">Location &amp; movement</h3><MovementDetails vehicle={vehicle} status={nextStepStatus} /></section>
              </div>
              {/* Custody and full evidence precede this secondary, read-only handoff. */}
              {canManageDealerMail ? <div className="vdp-focus-handoff vdp-focus-handoff-panel"><DealerMailHandoff key={vehicle.id + "|" + vehicle.stockNumber + "|" + vehicle.vin} vehicle={vehicle} /></div> : null}
            </div>
          </WorkspacePanel>
          <WorkspacePanel id="timeline" label="Activity" active={activePage === "timeline"}><TimelineDetails vehicle={vehicle} /></WorkspacePanel>
          {issueContext ? <WorkspacePanel id="issues" label="Issues" active={activePage === 'issues'}><VehicleIssues key={issueAccessKey} issues={vehicleIssues} context={issueContext} canReport={canReportIssue} onReport={reportIssue} onSaved={issueSaved} initialIssueId={createdIssueId} /></WorkspacePanel> : null}
        </div>
        <footer className="vdp-focus-footer">
          <span>Inventory Flow</span>
          <div role="toolbar" aria-label="Vehicle actions">
            {listingUrl ? onOpenListing ? <button className={flowButtonClassName({ variant: "secondary" })} type="button" onClick={() => onOpenListing(vehicle)} data-action="open-listing"><Globe2 size={18} aria-hidden="true" />Listing</button>
              : <a className={flowButtonClassName({ variant: "secondary" })} href={listingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="open-listing" data-read-only="true"><Globe2 size={18} aria-hidden="true" />Listing</a> : null}
            {invoiceUrl ? <a className={flowButtonClassName({ variant: "secondary" })} href={invoiceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-action="invoice" data-read-only="true"><FileText size={18} aria-hidden="true" />Invoice</a> : null}
            <button className={flowButtonClassName({ variant: "secondary" })} type="button" onClick={(event) => { takeHomeOpenerRef.current = event.currentTarget; setTakeHomeOpen(true); }} data-action="take-home" ref={takeHomeButtonRef} aria-label="Take-home page"><Printer size={18} aria-hidden="true" /><span>Take-home</span></button>
            <div className="vdp-focus-utilities">
              <button className={flowButtonClassName({ variant: "secondary" })} type="button" aria-pressed={shortlisted}
                aria-label={`${shortlisted ? "Remove" : "Add"} ${vehicle.stockNumber} ${shortlisted ? "from" : "to"} shortlist`}
                disabled={shortlistWriteBlocked}
                onClick={() => shortlist.toggle(vehicle)}>
                <Heart size={18} aria-hidden="true" fill={shortlisted ? "currentColor" : "none"} />
                {shortlisted ? "Shortlisted" : "Add to shortlist"}
              </button>
            </div>
          </div>
        </footer>
      </aside>
      {takeHomeOpen ? <TakeHomeSheet vehicle={vehicle} onClose={() => setTakeHomeOpen(false)} returnFocusRef={takeHomeOpenerRef} /> : null}
      {manualHoldOpen && dispositionContext ? <ManualHoldDialog
        key={`${dispositionContext.role}:${dispositionContext.homeStore}:${issueContext?.currentUser}:${vehicle.vin}`}
        vehicle={vehicle} role={dispositionContext.role} store={dispositionContext.homeStore}
        returnFocusRef={manualHoldOpenerRef} onClose={() => setManualHoldOpen(false)}
        onSaved={async saved => { setManualHoldOpen(false); setDispositionStatus(`${holdStateLabel(saved.state)}.`); await dispositionContext.onChanged(); }} /> : null}
      {dispositionOpen && dispositionContext ? <DispositionDialog
        key={`${dispositionContext.role}:${dispositionContext.homeStore}:${vehicle.vin}`}
        vehicle={{ vin: vehicle.vin, name: displayName, stockNumber: vehicle.stockNumber }}
        disposition={appDisposition}
        evidence={vehicle.managerDisposition ? { ...vehicle.managerDisposition, sourceStore: vehicle.managerDisposition.sourceStore.name } : null}
        role={dispositionContext.role}
        store={dispositionContext.homeStore}
        defaultDate={defaultDispositionDate(vehicle.vin, dispositionContext.reportDate, dispositionContext.timeZone)}
        returnFocusRef={dispositionOpenerRef}
        onClose={() => setDispositionOpen(false)}
        onSaved={async (saved) => {
          setDispositionOpen(false);
          setDispositionStatus(`${dispositionSummary(saved)} recorded for #${vehicle.stockNumber}.`);
          await dispositionContext.onChanged();
        }}
      /> : null}
      {issueReportOpen && issueContext ? <IssueReportDialog key={issueAccessKey} vehicle={vehicle} context={issueContext} returnFocusRef={issueOpenerRef} onClose={() => setIssueReportOpen(false)} onSaved={issue => { issueSaved(issue); setIssueReportOpen(false); setCreatedIssueId(issue.id); openAndFocusSection('issues'); }} /> : null}
    </>, document.body,
  );
}
