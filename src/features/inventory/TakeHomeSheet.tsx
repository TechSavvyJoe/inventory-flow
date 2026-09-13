import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, ImageOff, Printer, X } from "lucide-react";
import { STORE_BRANDING } from "../../app/storeBranding";
import type { StoreName } from "../../types";
import { useContainedFocus } from "../../lib/useContainedFocus";
import { formatMileage, formatMoney, vehicleDisplayName } from "./inventory-utils";
import { publishedEquipment, standoutEquipment } from "./vehicle-feature-utils";
import { certifiedTerms } from "./vehicle-warranty-utils";
import type { InventoryVehicle } from "./types";
import "./TakeHomeSheet.css";

const STORE_DISPLAY: Record<string, { name: string; site: string }> = {
  Howell: { name: "Bob Maxey Ford of Howell", site: "bobmaxeyfordhowell.com" },
  Fowlerville: { name: "Bob Maxey Ford in Fowlerville", site: "bobmaxeyfordinfowlerville.com" },
  "Ford Detroit": { name: "Bob Maxey Ford", site: "bobmaxeyford.com" },
  Lincoln: { name: "Bob Maxey Lincoln", site: "bobmaxeylincoln.com" },
};

const isHttps = (value: string | null | undefined): value is string => typeof value === "string" && /^https:\/\//i.test(value);

/**
 * Everything on the sheet is a published fact a customer could read on the
 * website: identity, price, mileage, specs, equipment, description and the
 * store's certification. Holds, custody, movement, manager-log, in-service
 * and warranty estimates never appear here.
 */
export function takeHomeModel(vehicle: InventoryVehicle) {
  const store = vehicle.location.homeStore.name;
  const branding = STORE_BRANDING[store as StoreName] ?? null;
  const display = STORE_DISPLAY[store] ?? { name: store, site: "" };
  const photos = [...new Set([...(vehicle.imageUrls ?? []), vehicle.imageUrl].filter(isHttps))].slice(0, 4);
  const equipment = publishedEquipment(vehicle).map((item) => item.label);
  const standout = standoutEquipment(vehicle, 8).map((item) => item.label);
  const price = vehicle.price ?? null;
  const msrp = vehicle.msrp ?? null;
  const savings = price !== null && msrp !== null && msrp > price ? msrp - price : null;
  const autoCheck = vehicle.autoCheckReport;
  const history = autoCheck
    ? [autoCheck.score != null ? `AutoCheck score ${autoCheck.score}` : null, autoCheck.ownerCount != null ? `${autoCheck.ownerCount} owner${autoCheck.ownerCount === 1 ? "" : "s"} reported` : null].filter(Boolean).join(" · ") || null
    : null;
  return {
    store,
    storeName: display.name,
    storeSite: display.site,
    logo: branding ? { src: branding.assetPath, alt: branding.altText, wide: branding.oemKey !== "lincoln" } : null,
    name: vehicleDisplayName(vehicle),
    descriptor: [vehicle.bodyStyle, vehicle.drivetrain, vehicle.engine, vehicle.exteriorColor].filter(Boolean).join(" · "),
    stockNumber: vehicle.stockNumber,
    vin: vehicle.vin,
    price,
    msrp,
    savings,
    mileage: vehicle.mileage ?? null,
    certified: vehicle.certified ? certifiedTerms(store) : null,
    photos,
    specs: ([
      ["Body", vehicle.bodyStyle], ["Drivetrain", vehicle.drivetrain], ["Engine", vehicle.engine], ["Transmission", vehicle.transmission], ["Fuel", vehicle.fuelType],
      ["Fuel economy", vehicle.mpgCity != null || vehicle.mpgHighway != null ? `${vehicle.mpgCity ?? "—"} city / ${vehicle.mpgHighway ?? "—"} hwy` : null],
      ["Exterior", vehicle.exteriorColor], ["Interior", vehicle.interiorColor],
    ] as Array<[string, string | null | undefined]>).filter((entry): entry is [string, string] => Boolean(entry[1])),
    highlights: standout.length ? standout : equipment.slice(0, 8),
    equipment,
    history,
    description: vehicle.dealerComments?.trim() || null,
    listingUrl: vehicle.publicListing.listingUrl,
  };
}

export type TakeHomeModel = ReturnType<typeof takeHomeModel>;

export function TakeHomeSheetContent({ model, now = new Date() }: { model: TakeHomeModel; now?: Date }) {
  const heroPhoto = model.photos[0] ?? null;
  const equipmentCap = model.description ? 27 : 36;
  const hidden = Math.max(0, model.equipment.length - equipmentCap);
  return (
    <article className="th">
      <header className="th-head">
        {model.logo ? (
          <img className={`th-logo${model.logo.wide ? "" : " is-square"}`} src={model.logo.src} alt={model.logo.alt} />
        ) : (
          <b className="th-logo-text">{model.storeName}</b>
        )}
        <div className="th-store">
          <b>{model.storeName}</b>
          {model.storeSite ? <span>{model.storeSite}</span> : null}
        </div>
      </header>
      <section className="th-title">
        <div>
          <h1>{model.name}</h1>
          {model.descriptor ? <p>{model.descriptor}</p> : null}
        </div>
        {model.certified ? (
          <span className="th-cert"><BadgeCheck size={14} strokeWidth={2} aria-hidden="true" />{model.certified.name}</span>
        ) : null}
      </section>
      <section className={`th-hero${heroPhoto ? "" : " is-empty"}`}>
        <div className="th-photos">
          {heroPhoto ? (
            <img className="th-photo" src={heroPhoto} alt={model.name} referrerPolicy="no-referrer" />
          ) : (
            <div className="th-photo th-photo-empty"><ImageOff size={22} strokeWidth={1.7} aria-hidden="true" /><span>Photos available at the store</span></div>
          )}
          {model.photos.length > 1 ? (
            <div className="th-thumbs">
              {model.photos.slice(1, 4).map((src) => <img key={src} src={src} alt="" referrerPolicy="no-referrer" />)}
            </div>
          ) : null}
        </div>
        <dl className="th-price">
          <div className="th-price-main"><dt>Price</dt><dd>{model.price !== null ? formatMoney(model.price) : "Call for price"}</dd></div>
          {model.msrp !== null ? <div><dt>MSRP</dt><dd>{formatMoney(model.msrp)}</dd></div> : null}
          {model.savings ? <div className="th-save"><dt>Under MSRP</dt><dd>{formatMoney(model.savings)}</dd></div> : null}
          {model.mileage !== null ? <div><dt>Mileage</dt><dd>{formatMileage(model.mileage)}</dd></div> : null}
          <div><dt>Stock</dt><dd className="th-mono">{model.stockNumber}</dd></div>
          <div><dt>VIN</dt><dd className="th-mono">{model.vin}</dd></div>
          {model.history ? <div><dt>History</dt><dd>{model.history}</dd></div> : null}
        </dl>
      </section>
      <section className="th-grid">
        <div className="th-block">
          <h2>Specifications</h2>
          <dl className="th-specs">
            {model.specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </div>
        <div className="th-block">
          <h2>Highlights</h2>
          {model.highlights.length ? (
            <ul className="th-chips">{model.highlights.map((label) => <li key={label}>{label}</li>)}</ul>
          ) : (
            <p className="th-muted">Ask us about the equipment on this vehicle.</p>
          )}
        </div>
      </section>
      {model.equipment.length ? (
        <section className="th-block">
          <h2>Equipment · {model.equipment.length}</h2>
          <ul className="th-equipment">
            {model.equipment.slice(0, equipmentCap).map((label) => <li key={label}>{label}</li>)}
            {hidden ? <li className="th-muted">+ {hidden} more on the listing</li> : null}
          </ul>
        </section>
      ) : null}
      {model.description ? (
        <section className="th-block"><h2>About this vehicle</h2><p className="th-desc">{model.description}</p></section>
      ) : null}
      {model.certified ? (
        <section className="th-block th-cert-block">
          <h2>{model.certified.name}</h2>
          <ul className="th-terms">{model.certified.terms.map((term) => <li key={term}>{term}</li>)}</ul>
        </section>
      ) : null}
      <footer className="th-foot">
        <span>Prepared {now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {model.storeName}{model.storeSite ? ` · ${model.storeSite}` : ""}</span>
        <span>Price excludes tax, title, license and dealer fees. Vehicle information is believed accurate but not guaranteed; confirm equipment, mileage and availability with the dealership before purchase.</span>
      </footer>
    </article>
  );
}

export function TakeHomeSheet({ vehicle, onClose, returnFocusRef }: { vehicle: InventoryVehicle; onClose: () => void; returnFocusRef?: React.RefObject<HTMLElement | null> }) {
  const model = useMemo(() => takeHomeModel(vehicle), [vehicle]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  useContainedFocus({ active: true, contain: true, containerRef: dialogRef, initialFocusRef: printRef, returnFocusRef, onEscape: onClose });
  useEffect(() => {
    document.body.classList.add("takehome-open");
    return () => document.body.classList.remove("takehome-open");
  }, []);
  return createPortal(
    <div className="takehome-portal">
      <div className="takehome-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="takehome-dialog" role="dialog" aria-modal="true" aria-labelledby="takehome-title" ref={dialogRef}>
        <div className="takehome-toolbar">
          <span id="takehome-title" className="takehome-toolbar__title">Take-home page · {model.stockNumber}</span>
          <span className="takehome-toolbar__actions">
            <button type="button" className="takehome-btn takehome-btn--primary" ref={printRef} onClick={() => window.print()}>
              <Printer size={16} strokeWidth={1.85} aria-hidden="true" /> Print / Save as PDF
            </button>
            <button type="button" className="takehome-btn" onClick={onClose}>
              <X size={16} strokeWidth={1.85} aria-hidden="true" /> Close
            </button>
          </span>
        </div>
        <div className="takehome-stage">
          <TakeHomeSheetContent model={model} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
