// Vehicle records (AutoCheck, OASIS, warranty, window sticker, vAuto
// equipment) and the DealerMail hold-evidence record, split from
// VehicleWorkspace.tsx, which stays the workspace's only export path. The
// sheets these classes use (VehicleWorkspace.focused.css and .records.css)
// stay imported by VehicleWorkspace.tsx so the cascade order is unchanged.

import { qualifyingAutoCheckInspection } from "../../lib/service-inspection-evidence";
import { sourceDisplayText } from "../../lib/source-text";
import { sourceDistanceText } from "../../lib/source-distance";
import { useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Info,
  MessageSquare,
} from "lucide-react";
import { formatSourceDateText, hasCapturedOasisActionResult, oasisActionLabel } from "./vehicle-resource-catalog";
import { resolveVehicleInService } from "./vehicle-in-service";
import { formatDate, formatDateTime, formatMileage, formatStickerMoney, vehicleDisplayName } from "./inventory-utils";
import {
  availableWindowStickerUrl,
  autoCheckResultTone,
  fordOasisUrl,
  fordServiceHistoryUrl,
  savedVautoEquipmentPdfUrl,
  officialVehicleDocumentUrl,
  vautoFactoryEquipmentUrl,
} from "./vehicle-document-utils";
import { warrantyOutlook } from "./vehicle-warranty-utils";
import { WarrantyOutlook } from "./WarrantyOutlook";
import type { DealerMailHoldEvidence, InventoryVehicle, SourceDataState, WarrantyCheckCoverage } from "./types";

export function compactSourcePrice(value: number | null | undefined, sticker?: InventoryVehicle["windowSticker"]): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return sticker?.pricingCurrency
    ? formatStickerMoney(value, sticker).replace(/^USD\s+/, '$')
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
    && (!reading[2] || Boolean(report?.lastReportedOdometerDate && formatDate(reading[2]) === formatDate(report.lastReportedOdometerDate)))) return sourceDistanceText(status) || "See odometer above";
  if (/no cpo info available|not reported|not available/i.test(status) && !detail) return "Not reported";
  if (!detail || detail.toLowerCase() === status.toLowerCase()) return sourceDistanceText(status) || "Not reported";
  if (/^no issue$/i.test(status) || /^records available$/i.test(status) && /^\d+ service records?(?:\(s\))?(?: reported)?\.?$/i.test(detail) || detail.toLowerCase().includes(status.toLowerCase())) return sourceDistanceText(detail);
  return sourceDistanceText([status, detail].filter(Boolean).join(" · "));
}

type HistoryCheck = NonNullable<NonNullable<InventoryVehicle["autoCheckReport"]>["checks"]>[number];

function historyCheckTone(check: HistoryCheck) {
  const odometerWarning = /odometer/i.test(check.label) && /discrepancy|rollback|not actual|exceeds mechanical|inconsistent/i.test(check.detail ?? "") && !/no (?:odometer )?(?:discrepancy|rollback|inconsistency)/i.test(check.detail ?? "");
  const serviceCountOnly = /service.*repair/i.test(check.label) && /^records available$/i.test(check.status ?? "") && /^\d+ service records?(?:\(s\))?(?: reported)?\.?$/i.test(check.detail ?? "");
  return odometerWarning ? "review" : serviceCountOnly ? "info" : /no cpo info available/i.test(check.status ?? "") ? "unknown" : autoCheckResultTone(check.status);
}

function isPrimaryAutoCheckFinding(check: HistoryCheck) {
  const label = check.label.trim();
  const result = [check.status, check.detail].filter(Boolean).join(" · ");
  if (/lien|corrected title/i.test(result)) return false;
  if (/state title brand|title brand/i.test(label)) {
    return historyCheckTone(check) === "clear" || /salvage|rebuilt|flood|lemon|buyback|structural|total loss/i.test(result);
  }
  return /accident|damage|service|repair|odometer|open recall/i.test(label) || historyCheckTone(check) === "review";
}

function AutoCheckFindings({ checks, report, label }: { checks: HistoryCheck[]; report: InventoryVehicle["autoCheckReport"]; label: string }) {
  return <div className="inventory-vehicle-document__checks" aria-label={label}>
    {checks.map((check, index) => {
      const tone = historyCheckTone(check);
      const Icon = tone === "clear" ? CheckCircle2 : tone === "review" ? AlertTriangle : tone === "info" ? Info : CircleHelp;
      return <span className={`inventory-vehicle-document__check inventory-vehicle-document__check--${tone}`} key={`${check.label}-${index}`} data-result-tone={tone}>
        <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
        <span><strong>{historyCheckLabel(check.label)}</strong><small>{historyCheckResult(check, report)}</small></span>
      </span>;
    })}
  </div>;
}

function focusWorkspaceSection(target: HTMLElement | null) {
  if (!target) return;
  const scroll = target.closest<HTMLElement>(".vdp-focus-scroll");
  if (scroll) scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 10;
  target.focus({ preventScroll: true });
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

export function DataState({ state }: { state: SourceDataState }) {
  // Source freshness remains available to administrators and the sync layer.
  // Store teams see plain-language review prompts only where a decision needs it.
  void state;
  return null;
}

export function Fact({
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

export function HoldEvidenceRecord({
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
      {/* Captured comments and alerts are listed below; a count without its
          text is the only case that still needs a pointer. */}
      {!messages.length && (evidence.commentFlag || evidence.alertFlag) ? (
        <p className="inventory-workspace-section-note">
          {[evidence.commentFlag ? "Comments" : null, evidence.alertFlag ? "Alerts" : null].filter(Boolean).join(" and ")} recorded in DealerMail.
        </p>
      ) : null}
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

// Call sites whose children are all conditional guard this themselves: an
// empty disclosure is a control that opens onto nothing.
function RecordSourceDetails({ children }: { children: ReactNode }) {
  return <details className="vdp-record-source-details"><summary>Source details<ChevronDown size={14} aria-hidden="true" /></summary><div>{children}</div></details>;
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
      <td data-label="Term">{sourceDistanceText(coverage.termText)}</td>
      <td data-label="Miles left">{sourceDistanceText(coverage.remainingMilesText)}</td>
      <td data-label="Time left">{coverage.remainingTimeText}</td>
      <td data-label="Status"><span className={`inventory-warranty-pill inventory-warranty-pill--${coverage.status === "ACTIVE" ? "active" : coverage.status === "EXPIRED" ? "expired" : "unknown"}`}>{coverage.status === "ACTIVE" ? "Active" : coverage.status === "EXPIRED" ? "Expired" : "N/A"}</span></td>
    </tr>)}</tbody>
  </table>;
}

export function VehicleDocuments({ vehicle }: { vehicle: InventoryVehicle }) {
  const recordsRef = useRef<HTMLElement>(null);
  const autoCheck = vehicle.autoCheckReport;
  const sticker = vehicle.windowSticker;
  const factoryEquipment = vehicle.factoryEquipment;
  const fordOasis = vehicle.fordOasis;
  const fordFamily = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const warrantyCheck = vehicle.warrantyCheck ?? null;
  const inService = resolveVehicleInService(vehicle);
  // Captured OASIS coverage takes precedence; estimates stay a fallback only.
  const warrantyPrimaryIsOasis = inService.source === "oasis";
  const warrantyPrimary = warrantyPrimaryIsOasis ? warrantyCheck?.fordOasis ?? null : warrantyCheck?.autoCheck ?? null;
  const warranty = warrantyOutlook({ make: vehicle.make, year: vehicle.year, fuelType: vehicle.fuelType, engine: vehicle.engine, mileage: vehicle.mileage, inServiceDate: inService.source === "autocheck" ? inService.date : null, stickerWarranty: sticker?.warranty ?? [] });
  // The generic outlook is a fallback for records that predate the captured warranty channel.
  // Never show both versions of the same estimate on one vehicle.
  const showWarranty = inService.source !== "oasis" && !warrantyCheck && Boolean(autoCheck || sticker || factoryEquipment) && (warranty.termsKnown || Boolean(warranty.inService.date));
  if (!autoCheck && !sticker && !factoryEquipment && !fordOasis && !warrantyCheck && !showWarranty) return null;
  const autoCheckUrl = officialVehicleDocumentUrl(autoCheck?.url, "autocheck", vehicle.publicListing.listingUrl);
  const autoCheckViaVauto = autoCheck?.accessMethod === "vauto";
  const stickerUrl = availableWindowStickerUrl(sticker, vehicle.publicListing.listingUrl);
  const factoryEquipmentSourceUrl = vautoFactoryEquipmentUrl(factoryEquipment?.url);
  const factoryEquipmentUrl = factoryEquipmentSourceUrl && factoryEquipment?.dataState === 'current' &&
    /^[a-f0-9]{64}$/.test(factoryEquipment?.savedPdfSha256 ?? '')
    ? savedVautoEquipmentPdfUrl(vehicle.vin) : factoryEquipmentSourceUrl;
  const fallbackEquipmentUrl = !stickerUrl && !["incomplete", "unavailable", "unknown"].includes(factoryEquipment?.dataState ?? "")
    ? factoryEquipmentUrl : null;
  const oasisUrl = fordFamily ? fordOasisUrl(vehicle.vin) : null;
  const serviceHistoryUrl = fordFamily ? fordServiceHistoryUrl(vehicle.vin) : null;
  const serviceHistory = fordOasis?.serviceHistory ?? null;
  const latestService = serviceHistory?.latestRepairOrder ?? null;
  const recentInspection = serviceHistory?.recentInspection ?? null;
  const recentServiceOrders = serviceHistory?.recentRepairOrders?.length
    ? serviceHistory.recentRepairOrders
    : latestService ? [latestService] : [];
  const documentedRecentServiceOrders = recentServiceOrders.filter((order) => order.services.length);
  const showServiceHistory = Boolean(serviceHistory && (latestService || !serviceHistory.historyCaptured));
  const openRecallCount = fordOasis?.openFieldServiceActions.length ?? 0;
  const hasCapturedRecallResult = hasCapturedOasisActionResult(fordOasis);
  // Format captured calendar dates consistently without deriving coverage eligibility.
  const fordOasisFacts = fordOasis
    ? [
        fordOasis.warrantyStartDate ? { label: "Warranty start", value: formatDate(fordOasis.warrantyStartDate) } : null,
        fordOasis.buildDate ? { label: "Build date", value: formatDate(fordOasis.buildDate) } : null,
        fordOasis.releaseDate ? { label: "Release date", value: formatDate(fordOasis.releaseDate) } : null,
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
  const autoCheckInspection = fordFamily ? null : qualifyingAutoCheckInspection(vehicle.serviceReadiness, autoCheck);
  const autoCheckHighlights = autoCheck?.checks?.filter(isPrimaryAutoCheckFinding) ?? [];
  const autoCheckOtherChecks = autoCheck?.checks?.filter(check => !autoCheckHighlights.includes(check)) ?? [];
  const autoCheckFacts = autoCheck
    ? [
        autoCheck.usage ? { label: "Vehicle use", value: sourceDistanceText(autoCheck.usage) } : null,
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
        autoCheckInspection ? {
          label: "Recent inspection",
          value: `${formatDate(autoCheckInspection.date)} · ${autoCheckInspection.types.map(sourceDistanceText).join(" · ")}`,
        } : null,
        autoCheck.vehicleClass ? { label: "Vehicle class", value: sourceDistanceText(autoCheck.vehicleClass) } : null,
        autoCheck.assemblyCountry ? { label: "Assembly country", value: autoCheck.assemblyCountry } : null,
        inService.source !== "oasis" && autoCheck.estimatedInServiceDate ? {
          label: "Estimated in-service date",
          value: formatDate(autoCheck.estimatedInServiceDate),
        } : null,
      ].filter(Boolean) as Array<{ label: string; value: string | number }>
    : [];
  const stickerFacts = sticker
    ? [
        sticker.equipmentGroup ? { label: "Equipment group", value: sticker.equipmentGroup } : null,
        sticker.equipmentGroupPrice != null ? { label: "Equipment group price", value: compactSourcePrice(sticker.equipmentGroupPrice, sticker) } : null,
        sticker.exteriorColor ? { label: "Exterior", value: sticker.exteriorColor } : null,
        sticker.interiorColor ? { label: "Interior", value: sticker.interiorColor } : null,
        sticker.engine || sticker.transmission
          ? { label: "Powertrain", value: sourceDistanceText([sticker.engine, sticker.transmission].filter(Boolean).join(" · ")) }
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
              value: sourceDistanceText([
                factoryEquipment.engine,
                factoryEquipment.transmission,
                factoryEquipment.drivetrain,
              ].filter(Boolean).join(" · ")),
            }
          : null,
      ].filter(Boolean) as Array<{ label: string; value: string }>
    : [];
  const readOnlyNoteId = "inventory-vehicle-documents-read-only";

  const sections = [
    { id: "autocheck", label: "AutoCheck", content: (autoCheck ? <article
          className="inventory-vehicle-document inventory-vehicle-document--autocheck"
          data-document-kind="autocheck"
          data-link-state={autoCheckUrl ? "available" : autoCheckViaVauto ? "captured" : "unavailable"}
        >
          <header className="inventory-vehicle-document__heading">
            <AutoCheckWordmark />
            <span className="inventory-vehicle-document__title">
              <strong>AutoCheck vehicle history</strong>
              <small>{autoCheckViaVauto ? "Captured through vAuto for this VIN" : "Dealership website report"}</small>
            </span>
            <DataState state={autoCheck.dataState} />
          </header>

          {autoCheckViaVauto && !autoCheckUrl ? <div className="vdp-record-source-action">
            <span className="inventory-vehicle-document__captured" role="status" aria-label="AutoCheck report facts captured through vAuto for this VIN"><CheckCircle2 size={16} aria-hidden="true" />Captured via vAuto</span>
          </div> : <RecordSourceAction href={autoCheckUrl} label="Open report" accessibleLabel={`Open AutoCheck report for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="AutoCheck report unavailable" />}

          <dl className="vdp-history-summary" aria-label="AutoCheck summary">
            {autoCheck.score != null || autoCheckScoreRange ? <Fact label="AutoCheck score" emphasize>{autoCheck.score ?? "Not reported"}{autoCheckScoreRange ? <small>Typical {autoCheckScoreRange}</small> : null}</Fact> : null}
            {autoCheck.ownerCount != null ? <Fact label="Owners">{autoCheck.ownerCount}</Fact> : null}
            {autoCheck.usage ? <Fact label="Vehicle use">{sourceDistanceText(autoCheck.usage)}</Fact> : null}
            {autoCheck.lastReportedOdometer != null ? <Fact label="Last odometer">{formatMileage(autoCheck.lastReportedOdometer)}{autoCheck.lastReportedOdometerDate ? <small>{formatDate(autoCheck.lastReportedOdometerDate)}</small> : null}</Fact> : null}
            {autoCheckInspection ? <Fact label="Recent inspection">{formatDate(autoCheckInspection.date)}<small>{autoCheckInspection.types.map(sourceDistanceText).join(" · ")}</small></Fact> : null}
          </dl>
          {autoCheckHighlights.length ? <AutoCheckFindings checks={autoCheckHighlights} report={autoCheck} label="AutoCheck at-a-glance results" /> : null}
          {autoCheckOtherChecks.length ? <details className="vdp-record-source-details vdp-history-more">
            <summary><span>More history checks <small>{autoCheckOtherChecks.length}</small></span><ChevronDown size={14} aria-hidden="true" /></summary>
            <AutoCheckFindings checks={autoCheckOtherChecks} report={autoCheck} label="Additional AutoCheck results" />
          </details> : null}
          <RecordSourceDetails>
            {autoCheck.sourceLabel ? <p>{autoCheck.sourceLabel}</p> : null}
            {autoCheck.capturedAt ? <p>Captured {formatDateTime(autoCheck.capturedAt)}</p> : null}
            <p>{autoCheck.reportRunAt ? `Report run ${formatDateTime(autoCheck.reportRunAt)}` : "Report run time not captured"}</p>
            <dl className="inventory-vehicle-document__facts">{autoCheckFacts.map(fact => <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>)}</dl>
            {autoCheck.checks?.length ? <ul aria-label="Original AutoCheck findings">{autoCheck.checks.map((check, index) => <li key={index}><strong>{check.label}</strong> · {sourceDistanceText([check.status, check.detail].filter(Boolean).map(sourceDisplayText).join(" · ")) || "Not reported"}</li>)}</ul> : null}
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
            aria-label="Open field service actions"
            data-open-recall-count={openRecallCount}
          >
            {openRecallCount ? (
              <AlertTriangle size={18} strokeWidth={1.9} aria-hidden="true" />
            ) : hasCapturedRecallResult ? (
              <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden="true" />
            ) : <CircleHelp size={18} strokeWidth={1.9} aria-hidden="true" />}
            <span>
              <strong>
                {oasisActionLabel(fordOasis)}
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
                  <span>{sourceDistanceText(sourceDisplayText(action.description)) || "Details unavailable"}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {serviceHistory && showServiceHistory ? (
            <CapturedRecordSection
              title="Ford service history"
              count={serviceHistory.repairOrderCount ? countLabel(serviceHistory.repairOrderCount, "repair order") : "No repair orders"}
            >
              {latestService ? <>
                <dl className="inventory-vehicle-document__facts vdp-service-history-facts">
                  <Fact label="In service">{formatDate(latestService.openDate)}</Fact>
                  <Fact label="Ready">{formatDate(latestService.closeDate)}</Fact>
                  {latestService.odometer != null ? <Fact label="Odometer">{formatMileage(latestService.odometer)}</Fact> : null}
                  <Fact label="Inspection">
                    {latestService.inspection.status === "confirmed"
                      ? latestService.inspection.type || "Inspection confirmed"
                      : serviceHistory.inspectionSearchStatus === "incomplete"
                        ? "Inspection check incomplete"
                        : `Not identified in ${countLabel(serviceHistory.detailScanCount, "recent repair order")} checked`}
                  </Fact>
                </dl>
                {latestService.services.length ? <ul aria-label="Latest Ford service work summary">
                  {latestService.services.map((service) => <li key={service}><span><strong>{sourceDistanceText(service)}</strong></span></li>)}
                </ul> : <p className="vdp-service-history-summary">Ford did not supply itemized work for this visit.</p>}
                {recentInspection && recentInspection.repairOrderNumber !== latestService.repairOrderNumber ? (
                  <p className="vdp-service-history-inspection">
                    <strong>{recentInspection.inspection.type || "Inspection confirmed"}</strong>
                    {` · ${formatDate(recentInspection.openDate)} to ${formatDate(recentInspection.closeDate)}`}
                  </p>
                ) : null}
                {documentedRecentServiceOrders.filter((order) => order.repairOrderNumber !== latestService.repairOrderNumber).length ? <section className="vdp-service-history-recent" aria-label="Other documented Ford service">
                  <h4>Other documented service</h4>
                  <ol>{documentedRecentServiceOrders.filter((order) => order.repairOrderNumber !== latestService.repairOrderNumber).map((order) => <li key={order.repairOrderNumber}>
                    <div><strong>{formatDate(order.openDate)} to {formatDate(order.closeDate)}</strong>{order.odometer != null ? <span>{formatMileage(order.odometer)}</span> : null}</div>
                    <p>{order.services.map(sourceDistanceText).join(" · ")}</p>
                  </li>)}</ol>
                </section> : null}
              </> : (
                <p className="inventory-vehicle-document__empty">Ford service visits are listed in Records.</p>
              )}
              <RecordSourceAction
                href={serviceHistoryUrl}
                label="Open Ford service history"
                accessibleLabel={`Open Ford retail service repair history for ${vehicleDisplayName(vehicle)} in a new tab`}
                unavailableLabel="Ford service history unavailable"
              />
            </CapturedRecordSection>
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
                    {coverage.description ? <small>{sourceDistanceText(sourceDisplayText(coverage.description))}</small> : null}
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
                      <strong>{sourceDistanceText(formatSourceDateText(expiration))}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </CapturedRecordSection>
          ) : null}

          {!fordOasisFacts.length && !openRecallCount && !fordOasis.warrantyCoverages.length && !fordOasis.extendedCoverageExpirations.length && !showServiceHistory ? (
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
              <Fact label="In service">{formatDate(warrantyCheck.fordOasis.warrantyStartDate)}</Fact>
            ) : warrantyCheck.autoCheck?.inServiceDate ? (
              <Fact label="In service (est.)">{formatDate(warrantyCheck.autoCheck.inServiceDate)}</Fact>
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

          {warrantyCheck.mileageSource ? <RecordSourceDetails><p>Mileage source: {warrantyCheck.mileageSource}</p></RecordSourceDetails> : null}

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
          data-link-state={stickerUrl ? "available" : fallbackEquipmentUrl ? "vauto-fallback" : "unavailable"}
        >
          <header className="inventory-vehicle-document__heading">
            <WindowStickerWordmark make={vehicle.make} />
            <span className="inventory-vehicle-document__title">
              <strong>Factory window sticker</strong>
              <small>{sticker.vehicleDescription || "Vehicle details"}</small>
            </span>
            <DataState state={sticker.dataState} />
          </header>

          <RecordSourceAction href={stickerUrl ?? fallbackEquipmentUrl} label={stickerUrl ? "Open sticker" : "Open vAuto equipment"} accessibleLabel={`${stickerUrl ? "Open window sticker" : "Open vAuto equipment"} for ${vehicleDisplayName(vehicle)} in a new tab`} unavailableLabel="Window sticker unavailable" />
          {!stickerUrl && fallbackEquipmentUrl ? <p className="inventory-vehicle-document__fallback">The original sticker is not available from the manufacturer. This VIN's vAuto equipment profile is available below.</p> : null}

          {sticker.totalMsrp != null || sticker.basePrice != null ? (
            <dl className="inventory-vehicle-document__metrics inventory-vehicle-document__metrics--sticker" aria-label="Window sticker pricing">
              <Fact label={sticker.totalMsrp != null ? "Original MSRP" : "Base MSRP"} emphasize>{compactSourcePrice(sticker.totalMsrp ?? sticker.basePrice, sticker)}</Fact>
            </dl>
          ) : null}

          {stickerFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {stickerFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}
          {sticker.equipmentGroupContents?.length ? <CapturedRecordSection title="Equipment group contents" count={countLabel(sticker.equipmentGroupContents.length, "included item")}>
            <ul aria-label="Equipment group contents">{sticker.equipmentGroupContents.map((item,index) => <li key={index}>{item}</li>)}</ul>
          </CapturedRecordSection> : null}
          {sticker.options?.length ? (
            <CapturedRecordSection title="Factory options" count={countLabel(sticker.options.length, "published item")}>
              <ul aria-label="Factory options">
                {sticker.options.map((option, index) => (
                  <li key={`${option}-${index}`}>
                    <span>{sourceDistanceText(option).replace(/\bUSD\s*\$?(?=\d)/gi, "$")}</span>
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
                          <span>{sourceDistanceText(item)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {sticker.warranty?.length ? (
                  <section aria-label="Factory warranty">
                    <h4>Factory warranty</h4>
                    <ul>{sticker.warranty.map((item, index) => <li key={`${item}-${index}`}>{sourceDistanceText(item)}</li>)}</ul>
                  </section>
                ) : null}
              </div>
            </CapturedRecordSection>
          ) : null}
          {!fallbackEquipmentUrl && !stickerFacts.length && !sticker.options?.length && !sticker.standardEquipment?.length && !sticker.warranty?.length && sticker.totalMsrp == null && sticker.basePrice == null && sticker.totalOptions == null && sticker.destinationCharge == null ? (
            <p className="inventory-vehicle-document__empty">The original window sticker is not available for this vehicle.</p>
          ) : null}
          {stickerUrl || stickerFacts.length || sticker.options?.length || sticker.standardEquipment?.length ? <RecordSourceDetails>
            {sticker.originalMarket ? <p>{sticker.originalMarket} window sticker</p> : null}
            <p>Original factory equipment does not confirm current condition or installed equipment.</p>
          </RecordSourceDetails> : null}
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
          {factoryEquipmentFacts.length || factoryEquipment.disclaimer ? <RecordSourceDetails>
          {factoryEquipmentFacts.length ? (
            <dl className="inventory-vehicle-document__facts">
              {factoryEquipmentFacts.map((fact) => (
                <Fact label={fact.label} key={fact.label}>{fact.value}</Fact>
              ))}
            </dl>
          ) : null}
          {factoryEquipment.disclaimer ? <p>{factoryEquipment.disclaimer}</p> : null}
          </RecordSourceDetails> : null}

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
