import { useEffect, useId, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, FileText } from 'lucide-react';
import type { VehicleWorkspaceTab } from './types';
import { checkPriority, vehicleOverviewResources, vehicleResourceCatalog, type VehicleResource, type VehicleResourceSummaryRow, type VehicleResourceVehicle } from './vehicle-resource-catalog';
import { compactEquipmentScanLabel } from './vehicle-feature-utils';
import { autoCheckResultTone } from './vehicle-document-utils';
import { getDemoWindowSticker } from '../../lib/demo-documents';
import './VehicleResourceCards.css';

export type { VehicleResourceVehicle } from './vehicle-resource-catalog';
export interface VehicleResourceCardsProps {
  vehicle: VehicleResourceVehicle;
  variant: 'cards' | 'inline' | 'summary' | 'preview' | 'scan';
  /** A workspace has room for more source evidence than an inventory row. */
  summaryLimit?: 4 | 6;
  /** The workspace already displays its one authoritative date beside vehicle details. */
  hideInServiceDate?: boolean;
  /** Undefined uses local selection; null shows every captured source summary. */
  selectedResourceId?: string | null;
  onSelectResource?: (id: string | null) => void;
  /** Closes the containing inventory preview; unused by workspace summaries. */
  onClose?: () => void;
  /** Inventory can use its existing source shortcuts instead of repeating them. */
  hideSourceSelectors?: boolean;
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
    return displaySourceMoney(fact);
  }).join(' · ');
}

export function displaySourceMoney(value: string) {
  // A dollar sign is used only when the source explicitly identifies USD.
  return value.replace(/^USD\s*\$?(?=\d)/i, '$');
}

export function stickerLineParts(line: string) {
  // Only a price explicitly attached to this exact source line is separated.
  const priced = /^(.*?)\s+(?:[·|]\s*)?((?:USD|CAD)\s*\$?[\d,]+(?:\.\d{2})?|\$[\d,]+(?:\.\d{2})?|Price\s+[\d,]+(?:\.\d+)?|NO\s*CHARGE)$/i.exec(line);
  const child = /^(?:[•·.]|[-–—])(?:\s+|(?=[A-Za-z]))|^\.\d+(?:[./"'–—-]|\s)/.test(line);
  const sourceLabel = priced?.[1] ?? line;
  const cleanLabel = child ? sourceLabel.replace(/^[•·.\-–—]\s*/, '') : sourceLabel;
  // Split only explicit trailing source codes; ordinary words and qualifiers
  // (for example a 90-day trial) remain part of the equipment name.
  const coded = /^(.*?)\s+(?:[·|]\s*([A-Z0-9]{2,}(?:-[A-Z0-9]+)+|(?=[A-Z0-9]*\d)[A-Z0-9]{2,8})|\(([A-Z0-9]{2,}(?:-[A-Z0-9]+)+|(?=[A-Z0-9]*\d)[A-Z0-9]{2,8})\))$/.exec(cleanLabel);
  return { raw: line, label: coded?.[1] ?? cleanLabel, code: coded?.[2] ?? coded?.[3], price: priced?.[2], child };
}

type StickerLine = ReturnType<typeof stickerLineParts>;
function StickerLineContent({ line }: { line: StickerLine }) {
  return <div className="vehicle-resource-sticker__line">
    <span className="vehicle-resource-sticker__name"><span>{line.label}</span>{line.code ? <small>{line.code}</small> : null}</span>
    {line.price ? <span className="vehicle-resource-sticker__price">{displaySourceMoney(line.price)}</span> : null}
  </div>;
}

function StickerOptions({ lines }: { lines: string[] }) {
  const rows: { line: StickerLine; children: StickerLine[] }[] = [];
  for (const raw of lines) {
    const line = stickerLineParts(raw);
    const parent = rows[rows.length - 1];
    // Marked children belong to the immediately preceding source item. The
    // source order is never sorted or guessed from a package's name.
    if (line.child && parent && !parent.line.child) parent.children.push(line);
    else rows.push({ line, children: [] });
  }
  return <ol className="vehicle-resource-sticker__options">{rows.map(({ line, children }, index) => {
    const equipment = !line.price && !line.code && !line.child && !children.length;
    return <li key={index} className={`${equipment ? 'is-equipment' : 'is-option'}${line.child ? ' is-child' : ''}`} title={line.raw} aria-label={line.raw}>
      <StickerLineContent line={line}/>
      {children.length ? <ol className="vehicle-resource-sticker__children">{children.map((child, childIndex) =>
        <li key={childIndex} className="is-child" title={child.raw} aria-label={child.raw}><StickerLineContent line={child}/></li>
      )}</ol> : null}
    </li>;
  })}</ol>;
}

const HISTORY_LABELS: Record<string, string> = {
  'state title brand': 'Title', 'title brand': 'Title',
  'accident / damage': 'Accidents', 'accident / damage check': 'Accidents',
  'owners / use': 'Owners/use', 'last odometer': 'Odometer', 'odometer check': 'Odo. check',
  'auction brand / issues': 'Auction', 'open recall check': 'Recalls',
  'insurance loss / transfer': 'Insurance', 'certified pre-owned': 'CPO',
  'service / repair': 'Service', 'additional history': 'Other history',
};
function reportDisplayText(value: string, synthetic: boolean) {
  // Only known local synthetic documents omit repeated demo suffixes. The
  // panel keeps one explicit qualifier, while raw source records stay intact.
  return synthetic ? value.replace(/(?:\s*[·|]\s*)?Synthetic (?:report )?(?:result|example)\.?$/i, '').trim() : value;
}
function SummaryFields({ rows, resource, synthetic }: { rows: VehicleResourceSummaryRow[]; resource: VehicleResource; synthetic: boolean }) {
  return <dl className="vehicle-resource-summary__fields">{rows.map((row, index) => {
    const label = resource.id === 'autocheck' ? HISTORY_LABELS[row.label.toLowerCase()] ?? row.label : row.label;
    const section = resource.id === 'oasis' && /actions|coverage/i.test(row.label);
    const detail = row.detail ? reportDisplayText(row.detail, synthetic) : null;
    return <div key={`${row.label}-${index}`} className={`${row.label === 'Score' ? 'is-score' : ''}${section ? ' is-section' : ''}`}>
      <dt title={row.label} aria-label={row.label}>{label}</dt>
      <dd>{row.values.length > 1 ? <ul>{row.values.map((value, valueIndex) => <li key={valueIndex}>{reportDisplayText(value, synthetic)}</li>)}</ul> : <span>{reportDisplayText(row.values[0], synthetic)}</span>}{detail ? <small>{detail}</small> : null}</dd>
    </div>;
  })}</dl>;
}

function historyLabel(label: string) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function historyReviewLabels(vehicle: VehicleResourceVehicle) {
  const synthetic = Boolean(getDemoWindowSticker(vehicle));
  return new Set((vehicle.autoCheckReport?.checks ?? []).filter(check => {
    const status = check.status?.trim() ?? '';
    const detail = check.detail?.trim() ?? '';
    const serviceCount = /^\d+ service records?(?:\(s\))?(?: reported)?\.?$/i;
    // These are informational findings, not adverse history. Any additional
    // wording keeps the result eligible for review instead of being discarded.
    if (/service|repair/i.test(check.label) && serviceCount.test(detail || status)
      && (autoCheckResultTone(status) === 'clear' || /^records available$/i.test(status) || serviceCount.test(status))) return false;
    if (/^no cpo info available\.?$/i.test(status)
      && (!detail || synthetic && !reportDisplayText(detail, true))) return false;
    const unnegatedDetail = detail.replace(/\b(?:no|zero|0|without)\s+(?:(?:open|unrepaired|outstanding|insurance)\s+)?(?:recalls?|loss(?:es)?(?:\s+transfers?)?)(?:\s+(?:reported|found|indicated))?/gi, '');
    return autoCheckResultTone(status) !== 'clear' || checkPriority(check) <= 1
      || /\b(?:recalls?|loss(?:es)?|corrected title|events reported)\b/i.test(unnegatedDetail);
  }).map(check => historyLabel(check.label)));
}

function compactHistoryRows(rows: VehicleResourceSummaryRow[], reviewLabels: Set<string>) {
  return rows.filter(row => /^(score|owners \/ use|reported use|est\. in-service)$/i.test(row.label)
    || /title|accident|damage/i.test(row.label) || reviewLabels.has(historyLabel(row.label)));
}

function historyExceptionText(row: VehicleResourceSummaryRow, synthetic: boolean) {
  return row.detail && /^(?:no issues?|no problems?|clear|normal|events reported)$/i.test(row.values.join(' '))
    ? reportDisplayText(row.detail, synthetic)
    : [...row.values, ...(row.detail ? [row.detail] : [])].map(value => reportDisplayText(value, synthetic)).filter(Boolean).join(' · ');
}

function SnapshotFields({ rows, history = false, synthetic, emphasis = false }: {
  rows: VehicleResourceSummaryRow[]; history?: boolean; synthetic: boolean; emphasis?: boolean;
}) {
  return <dl className={`vehicle-resource-highlights__fields${emphasis ? ' is-emphasis' : ''}`}>{rows.map((row,index) => {
    const label = history ? HISTORY_LABELS[row.label.toLowerCase()] ?? row.label : row.label === 'Warranty start' ? 'In-service date' : row.label === 'In service' ? 'Months in service' : row.label;
    return <div key={`${row.label}-${index}`}>
      <dt title={row.label}>{label}</dt>
      <dd>{emphasis ? historyExceptionText(row, synthetic) : <>{row.values.map(value => reportDisplayText(value, synthetic)).join(' · ')}{row.detail && reportDisplayText(row.detail, synthetic) ? <small>{reportDisplayText(row.detail, synthetic)}</small> : null}</>}</dd>
    </div>;
  })}</dl>;
}

function ResourceSnapshot({ resource, vehicle, rows, facts, synthetic, detailed = false }: {
  resource: VehicleResource; vehicle: VehicleResourceVehicle; rows?: VehicleResourceSummaryRow[]; facts: string[]; synthetic: boolean; detailed?: boolean;
}) {
  const sticker = resource.stickerDetails;
  if (detailed && sticker) {
    const included = sticker.equipmentGroupContents ?? [];
    const parents = sticker.optionLines.map(stickerLineParts).filter(line => !line.child);
    const pricedParents = parents.filter(line => line.price);
    const upgrades = (pricedParents.length ? pricedParents : parents).slice(0,3);
    const remaining = sticker.optionLines.length - upgrades.length;
    return <div className="vehicle-resource-snapshot vehicle-resource-highlights vehicle-resource-highlights--equipment">
      <div className="vehicle-resource-highlights__intro">
      <p className="vehicle-resource-snapshot__equipment-line">{sticker.msrp ? <span><span>MSRP </span><strong>{displaySourceMoney(sticker.msrp)}</strong></span> : null}{sticker.equipmentGroup ? <span>{stickerLineParts(sticker.equipmentGroup).label}</span> : null}</p>
      <p className="vehicle-resource-snapshot__count">{[
        included.length ? `${included.length} included ${included.length === 1 ? 'feature' : 'features'}` : null,
        sticker.optionLines.length ? `${sticker.optionLines.length} ${sticker.equipmentGroupContents !== undefined ? 'optional' : 'captured'} ${sticker.optionLines.length === 1 ? 'entry' : 'entries'}` : null,
      ].filter(Boolean).join(' · ') || 'Equipment details not captured'}</p>
      </div>
      {included.length ? <>
        <h4 className="vehicle-resource-highlights__label">Included equipment</h4>
        <ul className="vehicle-resource-highlights__equipment" aria-label="Included equipment highlights">{included.slice(0,6).map((line,index) => <li key={index} title={line}><Check size={12} aria-hidden="true"/><span>{stickerLineParts(line).label}</span></li>)}</ul>
        {included.length > 6 ? <p className="vehicle-resource-highlights__more">{included.length - 6} more included features in the full report</p> : null}
      </> : null}
      {upgrades.length ? <>
        <h4 className="vehicle-resource-highlights__label">{sticker.equipmentGroupContents !== undefined ? 'Optional upgrades' : 'Captured equipment'}</h4>
        <ul className="vehicle-resource-highlights__upgrades" aria-label="Equipment upgrade highlights">{upgrades.map((line,index) => <li key={index} title={line.label}><StickerLineContent line={{...line,code:undefined}}/></li>)}</ul>
      </> : null}
      {remaining > 0 ? <p className="vehicle-resource-highlights__more">{remaining} more captured {remaining === 1 ? 'entry' : 'entries'} in the full report</p> : null}
    </div>;
  }
  if (sticker) return <div className="vehicle-resource-snapshot vehicle-resource-snapshot--equipment">
    <p className="vehicle-resource-snapshot__equipment-line">
      {sticker.msrp ? <span><span>MSRP </span><strong>{displaySourceMoney(sticker.msrp)}</strong></span> : null}
      {sticker.equipmentGroup ? <span>{stickerLineParts(sticker.equipmentGroup).label}</span> : null}
    </p>
    <p className="vehicle-resource-snapshot__count">{[
      sticker.equipmentGroupContents?.length ? `${sticker.equipmentGroupContents.length} included ${sticker.equipmentGroupContents.length === 1 ? 'feature' : 'features'}` : null,
      sticker.optionLines.length ? `${sticker.optionLines.length} ${sticker.equipmentGroupContents !== undefined ? 'optional' : 'captured'} ${sticker.optionLines.length === 1 ? 'entry' : 'entries'}` : null,
    ].filter(Boolean).join(' · ') || 'Equipment details not captured'}</p>
  </div>;
  if (resource.id === 'autocheck' && rows) {
    const reviewLabels = historyReviewLabels(vehicle);
    const selected = compactHistoryRows(rows, reviewLabels);
    const primary = selected.filter(row => /^(score|owners \/ use|reported use)$/i.test(row.label));
    const checks = selected.filter(row => !/^(score|owners \/ use|reported use|est\. in-service)$/i.test(row.label));
    const material = checks.filter(row => reviewLabels.has(historyLabel(row.label)));
    const ordinary = checks.filter(row => !material.includes(row));
    const date = selected.find(row => row.label === 'Est. in-service');
    if (detailed) {
      const keyChecks = rows.filter(row => /title|accident|damage|recall|odometer|service|repair/i.test(row.label) && !material.includes(row) && row.label !== 'Est. in-service');
      return <div className="vehicle-resource-snapshot vehicle-resource-highlights vehicle-resource-highlights--history">
        {primary.length ? <SnapshotFields rows={primary} history synthetic={synthetic}/> : null}
        {material.length ? <><h4 className="vehicle-resource-highlights__label">Items to review</h4><SnapshotFields rows={material} history synthetic={synthetic} emphasis/></> : null}
        {keyChecks.length ? <><h4 className="vehicle-resource-highlights__label">History checks</h4><SnapshotFields rows={keyChecks} history synthetic={synthetic}/></> : !material.length ? <p className="vehicle-resource-highlights__more">History checks not captured</p> : null}
        {date ? <SnapshotFields rows={[date]} history synthetic={synthetic}/> : null}
      </div>;
    }
    return <div className="vehicle-resource-snapshot vehicle-resource-snapshot--history">
      {primary.length ? <p className="vehicle-resource-snapshot__lead">{primary.map((row,index) => <span key={row.label}>{index ? ' · ' : ''}{row.label === 'Score' ? 'Score ' : ''}{row.values.join(' · ')}</span>)}</p> : null}
      {ordinary.length ? <p className="vehicle-resource-snapshot__checks">{ordinary.map((row,index) => <span key={`${row.label}-${index}`} title={row.label}>{index ? ' · ' : ''}<b>{HISTORY_LABELS[row.label.toLowerCase()] ?? row.label}:</b> {row.values.map(value => reportDisplayText(value, synthetic)).join(' · ')}</span>)}</p> : null}
      {material.map((row,index) => <p key={`${row.label}-${index}`} className="vehicle-resource-snapshot__exception" title={row.label}>{historyExceptionText(row, synthetic)}</p>)}
      {date ? <p>Est. in-service {date.values.join(' · ')}</p> : null}
      {!primary.length && !checks.length && !date ? <p>Captured history available</p> : null}
    </div>;
  }
  if (resource.id === 'oasis' && detailed) {
    const actions = rows?.find(row => /actions/i.test(row.label));
    const metadata = rows?.filter(row => ['Warranty start','Built','Released','In service','Mileage at sale'].includes(row.label)) ?? [];
    const coverage = rows?.filter(row => /coverage/i.test(row.label)) ?? [];
    return <div className="vehicle-resource-snapshot vehicle-resource-highlights vehicle-resource-highlights--oasis">
      <p className="vehicle-resource-highlights__status">{resource.scanFacts?.[0] === 'No open Ford actions' ? 'No open service actions' : resource.scanFacts?.[0] ?? 'Action status unconfirmed'}</p>
      {actions && actions.values.some(value => value !== 'No open Ford actions') ? <ul className="vehicle-resource-highlights__actions">{actions.values.map((value,index) => <li key={index}>{value}</li>)}</ul> : null}
      {metadata.length ? <SnapshotFields rows={metadata} synthetic={synthetic}/> : null}
      {coverage.map(row => <section key={row.label} className="vehicle-resource-highlights__coverage"><h4 className="vehicle-resource-highlights__label">{row.label}</h4><ul>{row.values.map((value,index) => <li key={index}>{value}</li>)}</ul></section>)}
    </div>;
  }
  if (resource.id === 'oasis') return <div className="vehicle-resource-snapshot vehicle-resource-snapshot--oasis">
    {(resource.scanFacts ?? []).filter(fact => !fact.startsWith('In-service ') || rows?.some(row => row.label === 'Warranty start')).map((fact,index) => <p key={index}>{fact === 'No open Ford actions' ? 'No open service actions' : fact}</p>)}
  </div>;
  return <ul className="vehicle-resource-summary__facts">{facts.slice(0,2).map((fact,index) => <li key={index}>{displaySourceMoney(fact)}</li>)}</ul>;
}

export function VehicleResourceCards({ vehicle, variant, summaryLimit = 4, hideInServiceDate = false, selectedResourceId, onSelectResource, onClose, hideSourceSelectors = false, onOpenSection }: VehicleResourceCardsProps) {
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  const [expandedResource, setExpandedResource] = useState<{ vin: string; id: string } | null>(null);
  const [desktopSummary, setDesktopSummary] = useState(() => variant === 'summary' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1100px)').matches);
  const disclosureId = useId();
  const syntheticPreview = Boolean(getDemoWindowSticker(vehicle));
  // A document preview is supplementary. If a static asset is unavailable in a
  // particular deployment, retain the card, its facts, and its source action
  // instead of leaving a conspicuous broken-image label in the workspace.
  useEffect(() => { setFailedPreviews(new Set()); setExpandedResource(null); }, [vehicle.vin]);
  useEffect(() => {
    if (variant !== 'summary' || typeof window.matchMedia !== 'function') {
      setDesktopSummary(false);
      return;
    }
    const media = window.matchMedia('(min-width: 1100px)');
    const update = () => setDesktopSummary(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, [variant]);
  const selectedId = selectedResourceId !== undefined ? selectedResourceId : expandedResource?.vin === vehicle.vin ? expandedResource.id : null;
  const selectResource = (id: string | null) => {
    if (selectedResourceId === undefined) setExpandedResource(id === null ? null : {vin:vehicle.vin,id});
    onSelectResource?.(id);
  };
  const resources = (variant === 'summary' || variant === 'preview' || variant === 'inline' || variant === 'scan' && onSelectResource ? vehicleOverviewResources(vehicle) : vehicleResourceCatalog(vehicle)).filter(resource => variant !== 'cards' || resource.id !== 'invoice');
  const usable = resources.filter(resource => resource.href || resource.hasCapturedData);
  if (!usable.length) return null;
  if (variant === 'scan') {
    const history = resources.find(resource => resource.id === 'autocheck');
    const oasis = resources.find(resource => resource.id === 'oasis');
    const equipment = onSelectResource ? resources.find(resource => ['window-sticker','vauto'].includes(resource.id)) : undefined;
    const sources = [equipment, history, oasis].filter((resource): resource is VehicleResource => Boolean(resource));
    return <div className={`vehicle-resources vehicle-resources--scan${onSelectResource ? ' is-interactive' : ''}`} aria-label="Captured source signals; complete reports in Records" onClick={event => event.stopPropagation()} onKeyDown={event => { if (onSelectResource && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation(); }}>
      {!history ? <p className="vehicle-resource-scan__missing">History not captured</p> : null}
      {sources.map(resource => {
        const qualification = resource.demo && resource.sourceNote === 'Synthetic sample · not an original' ? 'Demo'
          : resource.sourceNote?.split(' · ').filter(part => !/^(?:Captured|Report run) (?:[A-Z][a-z]{2} \d{1,2}, \d{4}|\d{2}\/\d{2}\/\d{4})$/.test(part)).join(' · ');
        const scanFacts = resource === equipment ? [] : [...(resource.scanFacts?.length ? resource.scanFacts : [resource.hasCapturedData ? 'Captured details in Records' : 'No captured report'])];
        if (resource.id === 'autocheck') {
          const reviewLabels = historyReviewLabels(vehicle);
          for (const row of resource.summaryRows ?? []) {
            if (!reviewLabels.has(historyLabel(row.label))) continue;
            const warning = historyExceptionText(row, syntheticPreview);
            if (warning && !scanFacts.some(fact => fact.includes(warning))) scanFacts.push(warning);
          }
        }
        const label = resource.id === 'autocheck' ? 'AutoCheck' : resource.id === 'oasis' ? 'OASIS' : resource.id === 'vauto' ? 'Equipment' : 'Sticker';
        return <div key={resource.id} data-resource-kind={resource.id} className="vehicle-resource-scan">
          {onSelectResource && resource.hasCapturedData ? <button type="button" className="vehicle-resource-scan__source" aria-label={`Show ${label === 'Sticker' ? 'sticker' : label === 'Equipment' ? 'equipment' : label} records`} aria-expanded={selectedId === resource.id} onClick={event => { event.currentTarget.focus({preventScroll:true}); selectResource(resource.id); }}>{label}<ChevronDown size={13} aria-hidden="true"/></button>
            : onSelectResource && resource.href ? <a className="vehicle-resource-scan__source" href={resource.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${label} source in a new tab`}>{label}<ArrowUpRight size={13} aria-hidden="true"/></a>
              : <strong>{label}</strong>}
          {scanFacts.map((fact,index) => {
            const date = /^(Est\. in-service|In-service) (\d{2}\/\d{2}\/\d{4})$/.exec(fact);
            return date ? <span key={index} className="vehicle-resource-scan__date"><span>{date[1]}</span>{' '}<span>{date[2]}</span></span>
              : <span key={index}>{resource.id === 'oasis' && fact === 'No open Ford actions' ? 'No open actions' : fact}</span>;
          })}
          {qualification ? <small className={qualification === 'Demo' && resource.demo ? 'is-demo' : undefined}>{qualification}</small> : null}
        </div>;
      })}
    </div>;
  }
  if (variant === 'summary' || variant === 'preview') {
    const preview = variant === 'preview';
    const expandAll = !preview && desktopSummary;
    const captured = usable.filter(resource => resource.hasCapturedData);
    const overview = preview && !captured.some(resource => resource.id === selectedId);
    const lookups = usable.filter(resource => !resource.hasCapturedData);
    const sourceAction = (resource: VehicleResource, compact = false) => {
      const label = resource.id === 'autocheck' ? 'Open AutoCheck history' : resource.id === 'vauto' ? 'Open vAuto equipment' : resource.action;
      const title = [resource.title, resource.subtitle, ...resource.facts].filter(Boolean).join(' · ');
      const content = <><ResourceBrand resource={resource}/><span>{compact && resource.demo ? 'Demo sticker' : resource.title === 'Sticker & equipment' ? resource.title : resource.id === 'autocheck' ? 'History' : resource.id === 'vauto' ? 'Equipment' : resource.demo ? 'Demo sticker' : resource.id === 'window-sticker' ? 'Window sticker' : resource.id === 'oasis' ? 'OASIS' : 'Invoice'}</span>{compact && syntheticPreview && ['autocheck', 'oasis'].includes(resource.id) ? <small className="vehicle-resource-heading-qualifier">Demo</small> : null}{resource.href ? <ArrowUpRight size={14} aria-hidden="true"/> : <ArrowRight size={14} aria-hidden="true"/>}</>;
      return resource.href ? <a className="vehicle-resource-summary__source" href={resource.href} data-resource={resource.id} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={title} aria-label={`${label} for VIN ${vehicle.vin} in a new tab`}>{content}</a>
        : onOpenSection ? <button type="button" className="vehicle-resource-summary__source" data-resource={resource.id} onClick={() => onOpenSection(resource.target)} title={title} aria-label={`${resource.dataAction} for VIN ${vehicle.vin}`}>{content}</button>
          : <span className="vehicle-resource-summary__source">{content}</span>;
    };
    const resourceToggle = (resource: VehicleResource) => {
      const expanded = selectedId === resource.id;
      const detailLabel = resource.id === 'autocheck' ? 'history' : resource.id === 'oasis' ? 'OASIS' : 'equipment';
      return <button key={resource.id} type="button" className="vehicle-resource-summary__toggle" aria-expanded={expanded} aria-controls={`${disclosureId}-${resource.id}`}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${detailLabel} details`}
        onClick={() => selectResource(expanded ? null : resource.id)}>
        <span>{preview ? resource.id === 'autocheck' ? 'AutoCheck' : resource.id === 'oasis' ? 'OASIS' : resource.id === 'vauto' ? 'Equipment' : 'Sticker' : expanded ? 'Less' : 'Details'}</span><ChevronDown size={14} aria-hidden="true"/>
      </button>;
    };
    const sourceLookups = lookups.length ? <div className="vehicle-resource-lookups" aria-label="Additional source lookups">{lookups.map(resource => <div key={resource.id} data-resource-kind={resource.id}>{sourceAction(resource)}</div>)}</div> : null;
    return <div className={`vehicle-resources vehicle-resources--${variant}${expandAll ? ' is-expanded-desktop' : ''}${overview ? ' is-overview' : ''}${hideSourceSelectors ? ' has-shared-source-controls' : ''}`} aria-label="Vehicle documents and resources" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      {preview ? <div className="vehicle-resource-preview-toolbar">
        {captured.length ? <div className="vehicle-resource-preview-selectors" role="group" aria-label="Choose a vehicle report"><button type="button" className="vehicle-resource-summary__toggle" aria-pressed={overview} onClick={() => selectResource(null)}>Overview</button>{!hideSourceSelectors ? captured.map(resourceToggle) : null}</div> : null}
        {sourceLookups}
        {onClose ? <button type="button" className="vehicle-resource-preview-close" aria-label="Close records" onClick={onClose}>Close</button> : null}
      </div> : null}
      {captured.length ? <div className="vehicle-resource-summaries">
        {captured.map(resource => {
          const candidates = [...(resource.score ? resource.facts.slice(0, 1) : []), ...(resource.summaryFacts ?? resource.compactFacts), ...resource.facts];
          const facts = candidates.filter((fact, index) => !candidates.slice(0, index).some(previous => previous === fact || previous.includes(fact))).slice(0, summaryLimit);
          const availableRows = resource.summaryRows?.filter(row => row.values.length && !(hideInServiceDate && ['Warranty start', 'Est. in-service'].includes(row.label)));
          const rows = resource.id === 'autocheck' || resource.id === 'oasis' ? availableRows : availableRows?.slice(0, summaryLimit);
          const sticker = resource.stickerDetails;
          const previewUrl = resource.previewUrl && !failedPreviews.has(resource.id) ? resource.previewUrl : undefined;
          const expanded = expandAll || selectedId === resource.id;
          const detailId = `${disclosureId}-${resource.id}`;
          const visibleSourceNote = expanded ? resource.sourceNote : resource.sourceNote?.split(' · ').filter(part => !/^(?:Captured|Report run) \d{2}\/\d{2}\/\d{4}$/.test(part)).join(' · ');
          return <section key={resource.id} className={`vehicle-resource-summary${facts.length <= 2 ? " vehicle-resource-summary--sparse" : ""}`} data-resource-kind={resource.id} aria-label={resource.title} hidden={preview && !overview && !expanded}>
            <div className="vehicle-resource-summary__heading">{sourceAction(resource, !expanded)}
            {!preview && !expandAll ? resourceToggle(resource) : null}
            </div>
            {resource.equipmentContext && (expanded || resource.id === 'vauto') ? <p className="vehicle-resource-source-kind">{resource.equipmentContext}</p> : expanded && syntheticPreview && ['autocheck', 'oasis'].includes(resource.id) ? <p className="vehicle-resource-source-kind">Synthetic source sample</p> : null}
            {!expanded && (!preview || overview) ? <div className={`vehicle-resource-summary__body is-compact${overview ? ' is-rich' : ''}${previewUrl ? " has-preview" : ""}`}>
              {previewUrl ? <img className="vehicle-resource-summary__preview" src={previewUrl} alt={resource.demo ? "Clearly marked synthetic demo window sticker" : "Window sticker preview"} loading="lazy" onError={() => setFailedPreviews(current => current.has(resource.id) ? current : new Set(current).add(resource.id))}/> : null}
              <ResourceSnapshot resource={resource} vehicle={vehicle} rows={rows} facts={facts} synthetic={syntheticPreview} detailed={overview}/>
            </div> : null}
            <div id={detailId} className="vehicle-resource-summary__disclosure" hidden={!expanded}>
              {expanded ? <>
            <div className={`vehicle-resource-summary__body${previewUrl ? " has-preview" : ""}${sticker ? " has-sticker" : rows?.length ? " has-fields" : ""}`}>
              {previewUrl ? <img className="vehicle-resource-summary__preview" src={previewUrl} alt={resource.demo ? "Clearly marked synthetic demo window sticker" : "Window sticker preview"} loading="lazy" onError={() => setFailedPreviews(current => current.has(resource.id) ? current : new Set(current).add(resource.id))}/> : null}
              {sticker ? <div className="vehicle-resource-sticker">
                <div className="vehicle-resource-sticker__meta">
                  {sticker.msrp ? <p><span>MSRP</span><strong>{displaySourceMoney(sticker.msrp)}</strong></p> : null}
                </div>
                {sticker.equipmentGroup || sticker.equipmentGroupContents?.length ? <section className="vehicle-resource-sticker__group" aria-label="Equipment group">
                  <p className="vehicle-resource-sticker__label">Equipment group</p>
                  {sticker.equipmentGroup ? <StickerLineContent line={{...stickerLineParts(sticker.equipmentGroup), price:sticker.equipmentGroupPrice ?? stickerLineParts(sticker.equipmentGroup).price}}/> : null}
                  {sticker.equipmentGroupContents?.length ? <ul className="vehicle-resource-sticker__included" aria-label="Included with equipment group">{sticker.equipmentGroupContents.map((line,index) => <li key={index} title={line} aria-label={line}><StickerLineContent line={stickerLineParts(line)}/></li>)}</ul> : null}
                </section> : null}
                <div className="vehicle-resource-sticker__optional">{sticker.optionLines.length ? <><p className="vehicle-resource-sticker__label">{sticker.optionLabel ?? 'Optional equipment & packages'}</p><StickerOptions lines={sticker.optionLines}/></> : <p className="vehicle-resource-sticker__missing">Optional equipment details not captured</p>}</div>
              </div> : rows !== undefined ? <SummaryFields rows={rows} resource={resource} synthetic={syntheticPreview}/> : <ul className="vehicle-resource-summary__facts">{facts.map((fact, index) => <li key={index}>{displaySourceMoney(fact)}</li>)}</ul>}
            </div>
              </> : null}
            </div>
            {resource.alternateSticker ? <a className="vehicle-resource-summary__source" href={resource.alternateSticker.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{resource.alternateSticker.label}<ArrowUpRight size={14} aria-hidden="true"/></a> : null}
            {!resource.demo && visibleSourceNote ? <p className="vehicle-resource-source-note">{visibleSourceNote}</p> : null}
          </section>;
        })}
      </div> : null}
      {!preview ? sourceLookups : null}
    </div>;
  }
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
        {resource.href && resource.hasCapturedData && onOpenSection ? <button className="vehicle-resource-open" type="button" onClick={openData} aria-label={`${resource.dataAction} for VIN ${vehicle.vin}`}>View details<ArrowRight aria-hidden="true" size={16}/></button> : null}
        {resource.href ? <a className="vehicle-resource-open" href={resource.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={accessibleName}>{resource.action}<ArrowUpRight aria-hidden="true" size={16}/></a>
          : onOpenSection ? <button className="vehicle-resource-open" type="button" onClick={openData} aria-label={accessibleName} title={resource.dataAction}>{resource.id === 'autocheck' ? 'View history' : resource.id === 'vauto' ? 'View equipment' : resource.dataAction}<ArrowRight aria-hidden="true" size={16}/></button>
            : <p className="vehicle-resource-unavailable">Open details in Records</p>}
        </div>
      </article>;
    })}
  </div>;
}
