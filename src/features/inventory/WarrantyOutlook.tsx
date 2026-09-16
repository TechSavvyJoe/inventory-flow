import { useEffect, useId, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleHelp, ExternalLink, ShieldCheck } from "lucide-react";
import { formatDate, formatMileage } from "./inventory-utils";
import { fordOasisUrl, officialVehicleDocumentUrl } from "./vehicle-document-utils";
import { warrantyOutlook, type CoverageOutlook } from "./vehicle-warranty-utils";
import type { InventoryVehicle } from "./types";
import "./WarrantyOutlook.css";

const STATUS_LABEL: Record<CoverageOutlook["status"], string> = {
  active: "In coverage",
  partial: "Partly known",
  expired: "Expired",
  unknown: "Needs date",
};

function remainingText(item: CoverageOutlook): string {
  if (item.status === "expired") {
    return item.limitedBy === "miles" ? `Passed ${item.termMiles.toLocaleString("en-US")} mi` : `Ended ${formatDate(item.expiresOn)}`;
  }
  const parts = [
    item.monthsRemaining !== null ? `${item.monthsRemaining} mo` : null,
    item.milesRemaining !== null ? `${item.milesRemaining.toLocaleString("en-US")} mi` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" / ")} left` : "Enter the in-service date and miles";
}

/**
 * Original in-service date plus the factory coverage that is likely left. The
 * in-service date is AutoCheck's estimate; OASIS holds the real warranty start
 * date for Ford and Lincoln VINs, so the card always links to the source that
 * settles it. Nothing here is written back anywhere.
 */
export function WarrantyOutlook({ vehicle }: { vehicle: InventoryVehicle }) {
  const autoCheck = vehicle.autoCheckReport;
  const fordFamily = /^(ford|lincoln)$/i.test(vehicle.make.trim());
  const [odometer, setOdometer] = useState<number | null>(vehicle.mileage ?? null);
  const inputId = useId();
  useEffect(() => setOdometer(vehicle.mileage ?? null), [vehicle.id, vehicle.mileage]);

  const outlook = warrantyOutlook({
    make: vehicle.make,
    year: vehicle.year,
    fuelType: vehicle.fuelType,
    engine: vehicle.engine,
    mileage: odometer,
    inServiceDate: autoCheck?.estimatedInServiceDate ?? null,
    autoCheckUrl: officialVehicleDocumentUrl(autoCheck?.url, "autocheck", vehicle.publicListing.listingUrl),
    oasisUrl: fordFamily ? fordOasisUrl(vehicle.vin) : null,
  });
  if (!outlook.termsKnown && !outlook.inService.date) return null;

  return (
    <article
      className="inventory-vehicle-document inventory-vehicle-document--warranty"
      data-document-kind="warranty"
      data-in-service={outlook.inService.date ? "estimated" : "missing"}
    >
      <header className="inventory-vehicle-document__heading">
        <span className="inventory-vehicle-document__icon">
          <ShieldCheck size={22} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="inventory-vehicle-document__title">
          <strong>Factory warranty outlook</strong>
          <small>{outlook.program ?? "Coverage terms for this make are not on file"}</small>
        </span>
      </header>

      <dl className="inventory-vehicle-document__metrics inventory-warranty__metrics" aria-label="In-service date">
        <div className="inventory-workspace-fact inventory-workspace-fact--emphasized">
          <dt>Original in-service</dt>
          <dd>
            {outlook.inService.date ? formatDate(outlook.inService.date) : "Not available"}
          </dd>
        </div>
        <div className="inventory-workspace-fact">
          <dt>
            <label htmlFor={inputId}>Odometer now</label>
          </dt>
          <dd>
            <input
              id={inputId}
              className="inventory-warranty__odometer"
              type="number"
              inputMode="numeric"
              min={0}
              step={100}
              value={odometer ?? ""}
              placeholder="miles"
              aria-describedby={`${inputId}-help`}
              onChange={(event) => setOdometer(event.target.value === "" ? null : Math.max(0, Math.floor(Number(event.target.value))))}
            />
            <small id={`${inputId}-help`}>Change the miles to recalculate, the way the AutoCheck calculator does.</small>
          </dd>
        </div>
      </dl>

      {outlook.coverages.length ? (
        <ul className="inventory-warranty__coverages" aria-label="Remaining factory coverage">
          {outlook.coverages.map((item) => (
            <li
              key={item.key}
              className={`inventory-vehicle-document__check inventory-vehicle-document__check--${item.status === "active" ? "clear" : item.status === "expired" ? "review" : "unknown"} inventory-warranty__coverage`}
              data-status={item.status}
            >
              {item.status === "active" ? (
                <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
              ) : item.status === "expired" ? (
                <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <CircleHelp size={15} strokeWidth={1.8} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {item.label} · {item.termMonths / 12} yr / {item.termMiles.toLocaleString("en-US")} mi
                </strong>
                <small>
                  {STATUS_LABEL[item.status]} · {remainingText(item)}
                  {item.status !== "expired" && item.expiresOn ? ` · ends ${formatDate(item.expiresOn)}` : ""}
                  {item.limitedBy === "miles" && item.status === "active" ? " · miles run out first" : ""}
                </small>
                {item.note ? <small>{item.note}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Sticker warranty lines already appear verbatim on the window-sticker card beside this one. */}
      <p className="inventory-warranty__note">
        <CalendarClock size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>
          Warranty runs from the first retail sale, not the model year.{" "}
          {outlook.verify.source === "oasis"
            ? "OASIS shows the exact warranty start date for Ford and Lincoln VINs; use it over this estimate."
            : "The full AutoCheck report shows sale and registration dates and its own remaining-warranty calculator."}
          {odometer === null ? " Add the current miles to see the mileage side." : ""}
        </span>
      </p>

      {outlook.verify.url ? (
        <a
          className="inventory-button inventory-vehicle-document__link"
          href={outlook.verify.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          data-read-only="true"
        >
          {outlook.verify.source === "oasis" ? "Open OASIS for this VIN" : "Open the AutoCheck report"}
          <ExternalLink size={16} strokeWidth={1.85} aria-hidden="true" />
        </a>
      ) : (
        <span className="inventory-vehicle-document__unavailable" role="status">
          {outlook.verify.source === "oasis" ? "OASIS link needs a valid 17-character VIN" : "AutoCheck report link not published"}
        </span>
      )}
    </article>
  );
}
