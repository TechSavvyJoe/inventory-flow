import { CertifiedBadge } from "../../components/CertifiedBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Printer, Share2, X } from "lucide-react";
import { useContainedFocus } from "../../lib/useContainedFocus";
import { formatDate, formatMileage, formatMoney } from "./inventory-utils";
import type { InventoryVehicle } from "./types";
import { takeHomeModel, type TakeHomeModel } from '../sales/customer-summary';
export { takeHomeModel } from '../sales/customer-summary';
export type { TakeHomeModel } from '../sales/customer-summary';
import "./TakeHomeSheet.css";

import { downloadTakeHomePdf, shareTakeHomePdf } from '../../../extension/sidepanel/lib/takehome-export.mjs';

export function TakeHomeSheetContent({ model, now = new Date() }: { model: TakeHomeModel; now?: Date }) {
  const heroPhoto = model.photos[0] ?? null;
  const equipmentCap = heroPhoto ? 18 : model.description ? 24 : 30;
  const additionalEquipment = model.equipment.filter((label) => !model.highlights.includes(label));
  const hidden = Math.max(0, additionalEquipment.length - equipmentCap);
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
      </section>
      <section className={`th-hero${heroPhoto ? " has-photo" : ""}`}>
        {heroPhoto ? <div className="th-photos">
          <img className="th-photo" src={heroPhoto} alt={model.name} referrerPolicy="no-referrer" />
          {model.photos.length > 1 ? <div className="th-thumbs">{model.photos.slice(1,4).map((photo,index) => <img key={photo} src={photo} alt={`${model.name} view ${index + 2}`} referrerPolicy="no-referrer" />)}</div> : null}
        </div> : null}
        <dl className="th-price">
          <div className="th-price-main"><dt>Price</dt><dd>{model.price !== null ? formatMoney(model.price) : "Call for price"}</dd></div>
          {model.msrp !== null ? <div><dt>MSRP</dt><dd>{formatMoney(model.msrp)}</dd></div> : null}
          {model.savings ? <div className="th-save"><dt>Under MSRP</dt><dd>{formatMoney(model.savings)}</dd></div> : null}
        </dl>
      </section>
      <dl className="th-identity">
          {model.mileage !== null ? <div><dt>Mileage</dt><dd>{formatMileage(model.mileage)}</dd></div> : null}
          <div><dt>Stock</dt><dd className="th-mono">{model.stockNumber}</dd></div>
          <div><dt>VIN</dt><dd className="th-mono">{model.vin}</dd></div>
          {model.history ? <div><dt>History</dt><dd>{model.history}</dd></div> : null}
      </dl>
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
            <ul className="th-chips">{model.highlights.map((label) => <li key={label}><Check size={14} strokeWidth={2.5} aria-hidden="true" /><span>{label}</span></li>)}</ul>
          ) : (
            <p className="th-muted">Ask us about the equipment on this vehicle.</p>
          )}
        </div>
      </section>
      {additionalEquipment.length ? (
        <section className="th-block">
          <h2>Additional equipment</h2>
          <ul className="th-equipment">
            {additionalEquipment.slice(0, equipmentCap).map((label) => <li key={label}>{label}</li>)}
            {hidden ? <li className="th-muted">{hidden} additional items; ask the store for the complete equipment list.</li> : null}
          </ul>
        </section>
      ) : null}
      {model.description || model.certified ? (
        <section className={`th-bottom-grid${model.description && model.certified ? "" : " is-single"}`}>
          {model.description ? (
            <div className="th-block"><h2>About this vehicle</h2><p className="th-desc">{model.description}</p></div>
          ) : null}
          {model.certified ? (
            <div className="th-block th-cert-block">
              <span className="th-cert th-cert--logo"><CertifiedBadge certified homeStore={model.store} /></span>
              <div>
              <h2>{model.certified.name}</h2>
              <ul className="th-terms">{model.certified.terms.map((term) => <li key={term}>{term}</li>)}</ul>
              <p className="th-cert-note">{model.certified.note}</p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      <footer className="th-foot">
        {model.listingUrl ? <a className="th-listing-link" href={model.listingUrl} target="_blank" rel="noopener noreferrer">View full vehicle listing</a> : null}
        <span>{model.publishedAt ? `Inventory snapshot ${formatDate(model.publishedAt)} · ` : ""}Prepared {formatDate(now.toISOString())} · {model.storeName}{model.storeSite ? ` · ${model.storeSite}` : ""}</span>
        <span>Price excludes tax, title, license and dealer fees. Vehicle information is believed accurate but not guaranteed; confirm equipment, mileage and availability with the dealership before purchase.</span>
      </footer>
    </article>
  );
}

export function TakeHomeSheet({ vehicle, vehicles, listLabel, onClose, returnFocusRef }: { vehicle?: InventoryVehicle; vehicles?: InventoryVehicle[]; listLabel?: string; onClose: () => void; returnFocusRef?: React.RefObject<HTMLElement | null> }) {
  const models = useMemo(() => {
    const selected = vehicles?.length ? vehicles : vehicle ? [vehicle] : [];
    return [...new Map(selected.map((item) => [item.vin, item])).values()].map(takeHomeModel);
  }, [vehicle, vehicles]);
  const title = listLabel?.trim() || (models.length === 1 ? `${models[0].name} · ${models[0].stockNumber}` : `Customer vehicle list · ${models.length} vehicles`);
  const dialogRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [preparedPdf, setPreparedPdf] = useState<{ models:TakeHomeModel[]; title:string; document:Blob } | null>(null);
  const pdf = preparedPdf?.models === models && preparedPdf.title === title ? preparedPdf.document : null;
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfAttempt, setPdfAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setPreparedPdf(null); setPdfError(null); setActionStatus(null);
    void import('../../../extension/sidepanel/lib/takehome-pdf.mjs').then(({ createTakeHomePdf }) => createTakeHomePdf(models, title)).then(document => {
      if (active) setPreparedPdf({ models, title, document });
    }).catch(error => { if (active) setPdfError(error instanceof Error ? error.message : 'The PDF could not be prepared. Try again.'); });
    return () => { active = false; };
  }, [models, title, pdfAttempt]);
  useContainedFocus({ active: true, contain: true, containerRef: dialogRef, initialFocusRef: printRef, returnFocusRef, onEscape: onClose });
  useEffect(() => {
    document.body.classList.add("takehome-open");
    return () => document.body.classList.remove("takehome-open");
  }, []);
  if (!models.length) return null;
  return createPortal(
    <div className="takehome-portal">
      <div className="takehome-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="takehome-dialog" role="dialog" aria-modal="true" aria-labelledby="takehome-title" ref={dialogRef}>
        <div className="takehome-toolbar">
          <span id="takehome-title" className="takehome-toolbar__title">Take-home page · {title}</span>
          <span className="takehome-toolbar__actions">
            <button type="button" className="takehome-btn takehome-btn--primary" ref={printRef} onClick={() => window.print()}>
              <Printer size={16} strokeWidth={1.85} aria-hidden="true" /> Print / Save as PDF
            </button>
            <button type="button" className="takehome-btn" disabled={!pdf} onClick={() => { if (pdf) { downloadTakeHomePdf(pdf, title); setActionStatus('Saved PDF document'); } }}>
              <Download size={16} strokeWidth={1.85} aria-hidden="true" /> Save PDF
            </button>
            <button type="button" className="takehome-btn" disabled={!pdf} onClick={() => { if (pdf) void shareTakeHomePdf({ pdf, title }).then(status => setActionStatus(status === 'saved' ? 'PDF saved. Share that file with your customer.' : status === 'shared' ? 'Shared PDF document' : null)).catch(() => setActionStatus('The PDF could not be shared. Use Save PDF and share the saved file.')); }}>
              <Share2 size={16} strokeWidth={1.85} aria-hidden="true" /> Share
            </button>
            <button type="button" className="takehome-btn" onClick={onClose}>
              <X size={16} strokeWidth={1.85} aria-hidden="true" /> Close
            </button>
          </span>
          {pdfError ? <span className="takehome-toolbar__status" role="alert">PDF could not be prepared: {pdfError} <button type="button" className="takehome-btn" onClick={() => setPdfAttempt(value => value + 1)}>Retry PDF</button></span> : <span className="takehome-toolbar__status" role="status">{actionStatus ?? (!pdf ? 'Preparing PDF…' : '')}</span>}
        </div>
        <div className="takehome-stage">
          {listLabel && models.length > 1 ? <h1 className="takehome-list-title">{listLabel}</h1> : null}
          {models.map((model) => <TakeHomeSheetContent key={model.vin} model={model} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
