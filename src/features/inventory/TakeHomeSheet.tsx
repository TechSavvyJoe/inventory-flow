import { CertifiedBadge } from "../../components/CertifiedBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Pencil, Printer, RotateCw, Share2, X } from "lucide-react";
import { useContainedFocus } from "../../lib/useContainedFocus";
import { useModalBackgroundIsolation } from "../../lib/useModalBackgroundIsolation";
import { formatDate, formatMileage, formatMoney } from "./inventory-utils";
import type { InventoryVehicle } from "./types";
import { takeHomeModel, type TakeHomeModel } from '../sales/customer-summary';
import type { ComparisonPlan } from '../../../extension/sidepanel/lib/takehome-comparison.mjs';
import { TakeHomeComparisonContent } from './TakeHomeComparisonContent';
export { takeHomeModel } from '../sales/customer-summary';
export type { TakeHomeModel } from '../sales/customer-summary';
import "./TakeHomeSheet.css";

import { downloadTakeHomePdf, shareTakeHomePdf } from '../../../extension/sidepanel/lib/takehome-export.mjs';

export function TakeHomeSheetContent({ model, now = new Date() }: { model: TakeHomeModel; now?: Date }) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const markImageFailed = (url: string) => setFailedImages(current => current.has(url) ? current : new Set([...current, url]));
  const documentPhotos = [...new Set(model.photos)].slice(0, 3).filter(url => !failedImages.has(url));
  const heroPhoto = documentPhotos[0] ?? null;
  const supportingPhotos = documentPhotos.slice(1);
  const railHighlights = supportingPhotos.length ? [] : model.highlights.slice(0, 4);
  const remainingHighlights = model.highlights.slice(railHighlights.length);
  const equipmentCap = heroPhoto ? 24 : model.description ? 30 : 36;
  const additionalEquipment = model.equipment.filter((label) => !model.highlights.includes(label));
  const hidden = Math.max(0, additionalEquipment.length - equipmentCap);
  return (
    <article className="th">
      <header className="th-head">
        {model.logo && !failedImages.has(model.logo.src) ? (
          <img className={`th-logo${model.logo.wide ? "" : " is-square"}`} src={model.logo.src} alt={model.logo.alt} onError={() => markImageFailed(model.logo!.src)} />
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
        {model.certified ? <span className="th-title-cert"><Check size={14} strokeWidth={2.4} aria-hidden="true" />{model.certified.name}</span> : null}
      </section>
      <section className="th-hero">
        <div className="th-photos">
          {heroPhoto ? <img className="th-photo" src={heroPhoto} alt={model.name} referrerPolicy="no-referrer" onError={() => markImageFailed(heroPhoto)} /> : <div className="th-photo th-photo-empty"><span>Current photos are available from the store.</span></div>}
        </div>
        <div className="th-hero-rail">
          <dl className="th-price">
            <div className="th-price-main"><dt>Price</dt><dd>{model.price !== null ? formatMoney(model.price) : "Call for price"}</dd></div>
            {model.mileage !== null ? <div><dt>Mileage</dt><dd>{formatMileage(model.mileage)}</dd></div> : null}
            <div><dt>Stock</dt><dd className="th-mono">{model.stockNumber}</dd></div>
          </dl>
          {supportingPhotos.length ? <div className={`th-thumbs${supportingPhotos.length === 1 ? " is-single" : ""}`}>{supportingPhotos.map((photo,index) => <img key={photo} src={photo} alt={`${model.name} view ${index + 2}`} referrerPolicy="no-referrer" onError={() => markImageFailed(photo)} />)}</div> : railHighlights.length ? <div className="th-quick"><b>Standout features</b><ul>{railHighlights.map((label) => <li key={label}>{label}</li>)}</ul></div> : null}
        </div>
      </section>
      <dl className="th-identity">
          <div><dt>VIN</dt><dd className="th-mono">{model.vin}</dd></div>
          {model.history ? <div><dt>Vehicle history</dt><dd>{model.history}</dd></div> : null}
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
          {remainingHighlights.length ? (
            <ul className="th-chips">{remainingHighlights.map((label) => <li key={label}><Check size={14} strokeWidth={2.5} aria-hidden="true" /><span>{label}</span></li>)}</ul>
          ) : (
            <p className="th-muted">Ask us about the equipment on this vehicle.</p>
          )}
        </div>
      </section>
      {additionalEquipment.length ? (
        <section className="th-block">
          <h2>Additional equipment · {additionalEquipment.length}</h2>
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
        <span>Prepared {formatDate(now.toISOString())} · {model.storeName}{model.storeSite ? ` · ${model.storeSite}` : ""}</span>
        <span>Price excludes tax, title, license and dealer fees. Vehicle information is believed accurate but not guaranteed; confirm equipment, mileage and availability with the dealership before purchase.</span>
      </footer>
    </article>
  );
}

export function TakeHomeSheet({ vehicle, vehicles, listLabel, onClose, returnFocusRef, onRefresh, onEditList, refreshing = false, refreshError, refreshedAt, unavailableCount = 0 }: { vehicle?: InventoryVehicle; vehicles?: InventoryVehicle[]; listLabel?: string; onClose: () => void; returnFocusRef?: React.RefObject<HTMLElement | null>; onRefresh?: () => Promise<boolean>; onEditList?: () => void; refreshing?: boolean; refreshError?: string | null; refreshedAt?: number; unavailableCount?: number }) {
  const models = useMemo(() => {
    const selected = vehicles?.length ? vehicles : vehicle ? [vehicle] : [];
    return [...new Map(selected.map((item) => [item.vin, item])).values()].map(takeHomeModel);
  }, [vehicle, vehicles]);
  const title = listLabel?.trim() || (models.length === 1 ? `${models[0].name} · ${models[0].stockNumber}` : `Customer vehicle list · ${models.length} vehicles`);
  const dialogRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  const backgroundRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.getElementById('root'));
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [layout, setLayout] = useState<'detailed' | 'comparison'>('detailed');
  const exportTitle = layout === 'comparison' ? 'Inventory Flow vehicle comparison' : title;
  const [preparedPdf, setPreparedPdf] = useState<{ models:TakeHomeModel[]; title:string; layout:string; document:Blob; comparison:ComparisonPlan | null } | null>(null);
  const prepared = preparedPdf?.models === models && preparedPdf.title === exportTitle && preparedPdf.layout === layout ? preparedPdf : null;
  const pdf = prepared?.document ?? null;
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfAttempt, setPdfAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let comparison:ComparisonPlan | null = null;
    setPreparedPdf(null); setPdfError(null); setActionStatus(null);
    void import('../../../extension/sidepanel/lib/takehome-pdf.mjs').then(({ createTakeHomePdf }) => createTakeHomePdf(models, exportTitle, { layout, comparisonObserver:plan => { comparison = plan; } })).then(document => {
      if (active) setPreparedPdf({ models, title:exportTitle, layout, document, comparison });
    }).catch(error => { if (active) setPdfError(error instanceof Error ? error.message : 'The PDF could not be prepared. Try again.'); });
    return () => { active = false; };
  }, [models, exportTitle, layout, pdfAttempt]);
  useContainedFocus({ active: true, contain: true, containerRef: dialogRef, initialFocusRef: printRef, returnFocusRef, onEscape: onClose });
  useModalBackgroundIsolation({ active: true, backgroundRef });
  useEffect(() => {
    document.body.classList.add("takehome-open");
    return () => document.body.classList.remove("takehome-open");
  }, []);
  if (!models.length) return null;
  return createPortal(
    <div className="takehome-portal" data-refresh-blocked={refreshing || Boolean(refreshError) || undefined}>
      <div className="takehome-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="takehome-dialog" role="dialog" aria-modal="true" aria-labelledby="takehome-title" ref={dialogRef}>
        <div className="takehome-toolbar">
          <span id="takehome-title" className="takehome-toolbar__title">Take-home page · {title}</span>
          <label className="takehome-format">Format<select value={layout} onChange={event => setLayout(event.target.value as 'detailed' | 'comparison')}><option value="detailed">Detailed vehicle sheets</option><option value="comparison">Vehicle comparison</option></select></label>
          <span className="takehome-toolbar__actions">
            {onEditList ? <button type="button" className="takehome-btn" onClick={onEditList}><Pencil size={16} aria-hidden="true" />Edit list</button> : null}
            {onRefresh ? <button type="button" className="takehome-btn" disabled={refreshing} onClick={() => { void onRefresh() }}><RotateCw size={16} aria-hidden="true" />{refreshing ? 'Refreshing…' : 'Refresh comparison'}</button> : null}
            <button type="button" className="takehome-btn takehome-btn--primary" ref={printRef} disabled={refreshing || Boolean(refreshError) || layout === 'comparison' && !prepared?.comparison} onClick={() => window.print()}>
              <Printer size={16} strokeWidth={1.85} aria-hidden="true" /> Print / Save as PDF
            </button>
            <button type="button" className="takehome-btn" disabled={refreshing || Boolean(refreshError) || !pdf} onClick={() => { if (pdf) { downloadTakeHomePdf(pdf, exportTitle); setActionStatus('Saved PDF document'); } }}>
              <Download size={16} strokeWidth={1.85} aria-hidden="true" /> Save PDF
            </button>
            <button type="button" className="takehome-btn" disabled={refreshing || Boolean(refreshError) || !pdf} onClick={() => { if (pdf) void shareTakeHomePdf({ pdf, title:exportTitle }).then(status => setActionStatus(status === 'saved' ? 'PDF saved. Share that file with your customer.' : status === 'shared' ? 'Shared PDF document' : null)).catch(() => setActionStatus('The PDF could not be shared. Use Save PDF and share the saved file.')); }}>
              <Share2 size={16} strokeWidth={1.85} aria-hidden="true" /> Share
            </button>
            <button type="button" className="takehome-btn" onClick={onClose}>
              <X size={16} strokeWidth={1.85} aria-hidden="true" /> Close
            </button>
          </span>
          {refreshError ? <span className="takehome-toolbar__status" role="alert">{refreshError}</span> : refreshedAt ? <span className="takehome-toolbar__status">Inventory checked {new Date(refreshedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}{unavailableCount ? ` · ${unavailableCount} unavailable ${unavailableCount === 1 ? 'vehicle remains' : 'vehicles remain'} saved in the list and ${unavailableCount === 1 ? 'is' : 'are'} excluded from this sheet` : ''}</span> : null}
          {pdfError ? <span className="takehome-toolbar__status" role="alert">PDF could not be prepared: {pdfError} <button type="button" className="takehome-btn" onClick={() => setPdfAttempt(value => value + 1)}>Retry PDF</button></span> : <span className="takehome-toolbar__status" role="status">{refreshing ? 'Refreshing saved list and inventory…' : refreshError ? 'Last-loaded preview. Refresh successfully before exporting.' : actionStatus ?? (!pdf ? 'Preparing PDF…' : prepared?.comparison ? `Ready · ${prepared.comparison.pages.length} ${prepared.comparison.pages.length === 1 ? 'page' : 'pages'} · ${models.length} ${models.length === 1 ? 'vehicle' : 'vehicles'}` : '')}</span>}
        </div>
        {refreshing || refreshError ? <p className="takehome-print-blocked">Customer sheet refresh required. Return to Inventory Flow and refresh this comparison successfully before printing or sharing.</p> : null}
        <div className="takehome-stage">
          {layout === 'comparison' ? prepared?.comparison ? <TakeHomeComparisonContent plan={prepared.comparison} /> : <p role="status">Preparing comparison sheet…</p> : <>
            {listLabel && models.length > 1 ? <h1 className="takehome-list-title">{listLabel}</h1> : null}
            {models.map((model) => <TakeHomeSheetContent key={model.vin} model={model} />)}
          </>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
