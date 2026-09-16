import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, FileText } from 'lucide-react';
import type { VehicleWorkspaceTab } from './types';
import { vehicleResourceCatalog, type VehicleResource, type VehicleResourceVehicle } from './vehicle-resource-catalog';
import { compactEquipmentScanLabel } from './vehicle-feature-utils';
import './VehicleResourceCards.css';

export type { VehicleResourceVehicle } from './vehicle-resource-catalog';
export interface VehicleResourceCardsProps {
  vehicle: VehicleResourceVehicle;
  variant: 'cards' | 'inline';
  onOpenSection?: (target: VehicleWorkspaceTab) => void;
}

function ResourceBrand({ resource }: { resource: VehicleResource }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="vehicle-resource-brand-fallback">{resource.brand === 'autocheck' ? 'AutoCheck' : resource.brand === 'vauto' ? 'vAuto' : 'Ford'}</span>;
  if (!resource.brand) return <FileText aria-hidden="true" className="vehicle-resource-symbol"/>;
  return <img className={`vehicle-resource-brand vehicle-resource-brand--${resource.brand}`} src={`/resource-brands/${resource.brand}.svg`} alt="" onError={() => setFailed(true)}/>;
}

function inlineResourceFacts(resource: VehicleResource): string {
  return resource.compactFacts.map(fact => {
    // Preserve history warnings and other non-equipment evidence verbatim. A
    // long factory option, however, belongs in the detailed record; the SRP
    // scan gets a semantic package cue plus the clear source/Records actions.
    if (['window-sticker', 'vauto'].includes(resource.id) && fact.length > 64 && /\b(package|equipment|trailer|tow|camera|cruise|blind\s+(?:spot|zone)|seats?)\b/i.test(fact)) {
      return compactEquipmentScanLabel(fact);
    }
    return fact;
  }).join(' · ');
}

export function VehicleResourceCards({ vehicle, variant, onOpenSection }: VehicleResourceCardsProps) {
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  // A document preview is supplementary. If a static asset is unavailable in a
  // particular deployment, retain the card, its facts, and its source action
  // instead of leaving a conspicuous broken-image label in the workspace.
  useEffect(() => setFailedPreviews(new Set()), [vehicle.vin]);
  const resources = vehicleResourceCatalog(vehicle).filter(resource => variant !== 'cards' || resource.id !== 'invoice');
  const usable = resources.filter(resource => resource.href || resource.hasCapturedData);
  if (!usable.length) return null;
  return <div className={`vehicle-resources vehicle-resources--${variant}`} aria-label="Vehicle documents and resources" onClick={event => event.stopPropagation()} onKeyDown={event => { if (variant === 'inline' && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation(); }}>
    {usable.map(resource => {
      const previewUrl = resource.previewUrl && !failedPreviews.has(resource.id) ? resource.previewUrl : undefined;
      const accessibleName = `${resource.href ? resource.id === 'autocheck' ? 'Open AutoCheck history' : resource.id === 'vauto' ? 'Open vAuto equipment' : resource.action : resource.dataAction} for VIN ${vehicle.vin}${resource.href ? ' in a new tab' : ''}`;
      const title = [resource.title, resource.subtitle, ...resource.facts].filter(Boolean).join(' · ');
      const openData = () => onOpenSection?.(resource.target);
      const inlineLabel = resource.id === 'autocheck' ? null : resource.id === 'vauto' ? 'Equipment' : resource.id === 'window-sticker' ? resource.demo ? 'Demo sticker' : 'Sticker' : resource.id === 'oasis' ? 'OASIS' : 'Invoice';
      const sourceKind = resource.demo ? 'Demo document' : null;
      const primaryFacts = resource.summaryFacts ?? (resource.score ? resource.facts.slice(1) : resource.facts);
      const resourceContent = <><span className="vehicle-resource-inline-heading"><ResourceBrand resource={resource}/>{inlineLabel ? <span className="vehicle-resource-inline-label">{inlineLabel}</span> : null}{resource.href ? <ArrowUpRight size={15} aria-hidden="true"/> : <ArrowRight size={15} aria-hidden="true"/>}</span></>;
      if (variant === 'inline') return <div key={resource.id} className={`vehicle-resource-inline-item${!resource.hasCapturedData ? ' vehicle-resource-inline-item--lookup' : ''}`} data-resource-kind={resource.id}>
        {resource.href ? <a className="vehicle-resource-inline" data-resource={resource.id} href={resource.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={title} aria-label={accessibleName}>{resourceContent}{sourceKind ? <span className="vehicle-resource-source-kind">{sourceKind}</span> : null}</a>
          : onOpenSection ? <button className="vehicle-resource-inline" data-resource={resource.id} type="button" onClick={openData} title={title} aria-label={accessibleName}>{resourceContent}{sourceKind ? <span className="vehicle-resource-source-kind">{sourceKind}</span> : null}</button> : <span className="vehicle-resource-inline">{resourceContent}{sourceKind ? <span className="vehicle-resource-source-kind">{sourceKind}</span> : null}</span>}
        {resource.hasCapturedData && resource.compactFacts.length ? <p className="vehicle-resource-inline-facts" aria-label={resource.compactFacts.slice(0, 1).join('; ')}>{inlineResourceFacts({ ...resource, compactFacts: resource.compactFacts.slice(0, 1) })}</p> : null}
      </div>;
      return <article className="vehicle-resource-card" data-resource={resource.id} key={resource.id}>
        <div className="vehicle-resource-heading"><ResourceBrand resource={resource}/><div><h3>{resource.id === 'autocheck' ? 'History' : resource.id === 'vauto' ? 'Equipment' : resource.demo ? 'Demo sticker' : resource.title}</h3>{sourceKind ? <p className="vehicle-resource-source-kind">{sourceKind}</p> : null}</div></div>
        <div className={`vehicle-resource-body${previewUrl ? ' has-preview' : ''}`}>
          {previewUrl ? <img className="vehicle-resource-preview" src={previewUrl} alt="Clearly marked synthetic demo window sticker" loading="lazy" onError={() => setFailedPreviews(current => current.has(resource.id) ? current : new Set(current).add(resource.id))}/> : null}
          {resource.score ? <div className="vehicle-resource-score"><strong>{resource.score.value}</strong><span>Score{resource.score.range ? <small>{resource.score.range} typical</small> : null}</span></div> : null}
          {primaryFacts.length ? <ul>{primaryFacts.slice(0, 6).map((fact, index) => <li key={`${resource.id}-${index}`}>{fact}</li>)}</ul> : previewUrl || sourceKind ? null : <p>{resource.subtitle}</p>}
        </div>
        <div className="vehicle-resource-actions">
        {resource.href && resource.hasCapturedData && !resource.demo && onOpenSection ? <button className="vehicle-resource-open" type="button" onClick={openData} aria-label={`${resource.dataAction} for VIN ${vehicle.vin}`}>View details<ArrowRight aria-hidden="true" size={16}/></button> : null}
        {resource.href ? <a className="vehicle-resource-open" href={resource.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={accessibleName}>{resource.action}<ArrowUpRight aria-hidden="true" size={16}/></a>
          : onOpenSection ? <button className="vehicle-resource-open" type="button" onClick={openData} aria-label={accessibleName} title={resource.dataAction}>{resource.id === 'autocheck' ? 'View history' : resource.id === 'vauto' ? 'View equipment' : resource.dataAction}<ArrowRight aria-hidden="true" size={16}/></button>
            : <p className="vehicle-resource-unavailable">Open details in Records</p>}
        </div>
      </article>;
    })}
  </div>;
}
