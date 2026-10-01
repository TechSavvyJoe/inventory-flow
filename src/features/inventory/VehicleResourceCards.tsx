import { useEffect, useId, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, FileText } from 'lucide-react';
import type { VehicleWorkspaceTab } from './types';
import { checkPriority, vehicleOverviewResources, type VehicleResource, type VehicleResourceSummaryRow, type VehicleResourceVehicle } from './vehicle-resource-catalog';
import { autoCheckResultTone } from './vehicle-document-utils';
import { getDemoWindowSticker } from '../../lib/demo-documents';
import './VehicleResourceCards.css';

export type { VehicleResourceVehicle } from './vehicle-resource-catalog';
export interface VehicleResourceCardsProps {
  vehicle: VehicleResourceVehicle;
  variant: 'summary' | 'preview' | 'scan' | 'signals' | 'shortcuts';
  /** A workspace has room for more source evidence than an inventory row. */
  summaryLimit?: 4 | 6;
  /** The workspace already displays its one authoritative date beside vehicle details. */
  hideInServiceDate?: boolean;
  /** The Overview's shared control expands every captured summary together. */
  detailsExpanded?: boolean;
  /** Undefined uses local selection; null shows every captured source summary. */
  selectedResourceId?: string | null;
  onSelectResource?: (id: string | null) => void;
  /** Closes the containing inventory preview; unused by workspace summaries. */
  onClose?: () => void;
  /** Inventory can use its existing source shortcuts instead of repeating them. */
  hideSourceSelectors?: boolean;
  onOpenSection?: (target: VehicleWorkspaceTab) => void;
  /** Appends inventory actions to the provider shortcuts as one compact rail. */
  shortcutActions?: ReactNode;
}

function ResourceBrand({ resource }: { resource: VehicleResource }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="vehicle-resource-brand-fallback">{resource.brand === 'autocheck' ? 'AutoCheck' : resource.brand === 'vauto' ? 'vAuto' : 'Ford'}</span>;
  if (!resource.brand) return <FileText aria-hidden="true" className="vehicle-resource-symbol"/>;
  return <img className={`vehicle-resource-brand vehicle-resource-brand--${resource.brand}`} src={`/resource-brands/${resource.brand}.svg`} alt="" onError={() => setFailed(true)}/>;
}

export function displaySourceMoney(value: string) {
  // A dollar sign is used only when the source explicitly identifies USD.
  return value.replace(/^USD\s*\$?(?=\d)/i, '$');
}

function decisionSourceNote(note: string | null | undefined): string | null {
  // Routine run dates stay in Records' source details. Keep stale, incomplete,
  // missing and anomalous-date warnings where staff make the decision.
  return note?.split(' · ').filter(part => !/^(?:Captured|Report run|Saved) \d{2}\/\d{2}\/\d{4}$/.test(part)).join(' · ') || null;
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
    if (/\b(?:lien reported|corrected title)\b/i.test(`${check.label} ${status} ${detail}`)) return false;
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
  return rows.filter(row => !/\b(?:lien reported|corrected title)\b/i.test([row.label, ...row.values, row.detail].filter(Boolean).join(' '))
    && (/^(score|owners \/ use|reported use|est\. in-service)$/i.test(row.label)
      || /title|accident|damage/i.test(row.label) || reviewLabels.has(historyLabel(row.label))));
}

function historyExceptionText(row: VehicleResourceSummaryRow, synthetic: boolean) {
  return row.detail && /^(?:no issues?|no problems?|clear|normal|events reported)$/i.test(row.values.join(' '))
    ? reportDisplayText(row.detail, synthetic)
    : [...row.values, ...(row.detail ? [row.detail] : [])].map(value => reportDisplayText(value, synthetic)).filter(Boolean).join(' · ');
}

/** Inventory presentation reuses structured report fields; it does not derive source status. */
function scanRows(resource: VehicleResource, vehicle: VehicleResourceVehicle): VehicleResourceSummaryRow[] {
  const rows = resource.summaryRows ?? [];
  if (resource.id === 'autocheck') {
    const unique = (candidates: Array<VehicleResourceSummaryRow | undefined>) => {
      const seen = new Set<string>();
      return candidates.filter((row): row is VehicleResourceSummaryRow => {
        if (!row) return false;
        const key = historyLabel(HISTORY_LABELS[row.label.toLowerCase()] ?? row.label);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const ownership = rows.find(row => row.label === 'Owners / use' || row.label === 'Reported use');
    const title = rows.find(row => /title/i.test(row.label));
    const accidents = rows.find(row => /accident|damage/i.test(row.label));
    const odometer = rows.find(row => row.label === 'Last odometer');
    const reviewLabels = historyReviewLabels(vehicle);
    const primary = rows.find(row => reviewLabels.has(historyLabel(row.label))) ?? resource.primaryScanRow;
    return unique([rows.find(row => row.label === 'Score'), title, accidents, primary,
      ownership ? { ...ownership, label:ownership.label === 'Owners / use' ? 'Owners' : 'Use', detail:undefined } : undefined,
      odometer ? { ...odometer, values:odometer.values.slice(0, 1), detail:undefined } : undefined,
    ]);
  }
  if (resource.id === 'oasis') {
    const actionRow = rows.find(row => /actions/i.test(row.label));
    const firstAction = actionRow?.values.find(value => !/^no open ford actions$/i.test(value));
    return [
      { label:'Actions', values:[resource.scanFacts?.[0] === 'No open Ford actions' ? 'No open actions' : resource.scanFacts?.[0] ?? 'Action status unconfirmed'] },
      firstAction ? { label:'Service', values:[firstAction] } : undefined,
      rows.find(row => row.label === 'Warranty start'),
    ].filter((row): row is VehicleResourceSummaryRow => Boolean(row));
  }
  const sticker = resource.stickerDetails;
  if (sticker) {
    const group = sticker.equipmentGroup ? stickerLineParts(sticker.equipmentGroup).label : null;
    const seen = new Set(group ? [historyLabel(group)] : []);
    const options = sticker.optionLines.map(stickerLineParts).filter(line => !line.child).map(line => line.label).filter(label => {
      const key = historyLabel(label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const counts = [
      sticker.equipmentGroupContents?.length ? `${sticker.equipmentGroupContents.length} included` : null,
      options.length ? `${options.length} ${options.length === 1 ? 'option' : 'options'}` : null,
    ].filter((value): value is string => Boolean(value));
    return [
      group ? { label:'Group', values:[group] } : undefined,
      options[0] ? { label:resource.id === 'vauto' ? 'Package' : 'Highlight', values:[options[0]] } : undefined,
      counts.length ? { label:'Captured', values:[counts.join(' · ')] } : undefined,
    ].filter((row): row is VehicleResourceSummaryRow => Boolean(row));
  }
  return rows.slice(0, 3);
}

function ScanFields({ rows, resource, synthetic }: { rows: VehicleResourceSummaryRow[]; resource: VehicleResource; synthetic: boolean }) {
  return <dl className="vehicle-resource-scan__fields">{rows.map((row, index) => {
    const label = resource.id === 'autocheck' ? HISTORY_LABELS[row.label.toLowerCase()] ?? row.label : row.label === 'Warranty start' ? 'In service' : row.label;
    const specificHistoryResult = resource.id === 'autocheck' && row.detail && /^(?:no issues?|no problems?|clear|normal|events reported)$/i.test(row.values.join(' '));
    const exactValue = [...row.values, ...(row.detail && row.label !== 'Score' ? [row.detail] : [])].map(value => reportDisplayText(value, synthetic)).join(' · ');
    return <div key={`${row.label}-${index}`} data-field={label.toLowerCase()}>
      <dt>{label}</dt>
      <dd title={exactValue}>{specificHistoryResult ? <span>{reportDisplayText(row.detail!, synthetic)}</span> : <>{row.values.map((value, valueIndex) => <span key={valueIndex}>{reportDisplayText(value, synthetic)}</span>)}{row.detail && row.label !== 'Score' ? <span>{reportDisplayText(row.detail, synthetic)}</span> : null}</>}</dd>
    </div>;
  })}</dl>;
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

export function VehicleResourceCards({ vehicle, variant, summaryLimit = 4, hideInServiceDate = false, detailsExpanded, selectedResourceId, onSelectResource, onClose, hideSourceSelectors = false, onOpenSection, shortcutActions }: VehicleResourceCardsProps) {
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  const [expandedResource, setExpandedResource] = useState<{ vin: string; id: string } | null>(null);
  const disclosureId = useId();
  const syntheticPreview = Boolean(getDemoWindowSticker(vehicle));
  // A document preview is supplementary. If a static asset is unavailable in a
  // particular deployment, retain the card, its facts, and its source action
  // instead of leaving a conspicuous broken-image label in the workspace.
  useEffect(() => { setFailedPreviews(new Set()); setExpandedResource(null); }, [vehicle.vin]);
  const selectedId = selectedResourceId !== undefined ? selectedResourceId : expandedResource?.vin === vehicle.vin ? expandedResource.id : null;
  const selectResource = (id: string | null) => {
    if (selectedResourceId === undefined) setExpandedResource(id === null ? null : {vin:vehicle.vin,id});
    onSelectResource?.(id);
  };
  const resources = vehicleOverviewResources(vehicle);
  const usable = resources.filter(resource => resource.href || resource.hasCapturedData);
  if (!usable.length && !(variant === 'shortcuts' && shortcutActions !== undefined && shortcutActions !== null)) return null;
  if (variant === 'shortcuts') {
    const history = usable.find(resource => resource.id === 'autocheck');
    const historyFacts = history ? scanRows(history, vehicle).filter(row => ['Score', 'Owners', 'Use'].includes(row.label)) : [];
    const combinedRail = shortcutActions !== undefined && shortcutActions !== null;
    return <div className={`vehicle-resource-shortcuts${combinedRail ? ' is-action-rail' : ''}`} aria-label={combinedRail ? 'Vehicle report and row actions' : 'Vehicle report shortcuts'} onClick={event => event.stopPropagation()}>
      {usable.filter(resource => ['autocheck', 'window-sticker', 'vauto', 'oasis'].includes(resource.id)).map(resource => {
        const label = resource.id === 'autocheck' ? 'AutoCheck' : resource.id === 'oasis' ? 'OASIS' : resource.id === 'vauto' ? 'Equipment' : 'Sticker';
        const rows = scanRows(resource, vehicle);
        const sourceMsrp = resource.stickerDetails?.msrp;
        const shortcutFact = resource.id === 'autocheck'
          ? rows.filter(row => ['Score', 'Owners'].includes(row.label)).map(row => `${row.label === 'Score' ? 'Score ' : ''}${row.values[0]}`).join(' · ')
          : resource.id === 'oasis'
            ? rows.find(row => row.label === 'Actions')?.values[0]
            : sourceMsrp
              ? `${label} MSRP ${displaySourceMoney(sourceMsrp)}`
              : rows[0]?.values[0];
        const content = <><span className="vehicle-resource-shortcut__heading"><ResourceBrand resource={resource}/><span>{label}</span>{resource.href ? <ArrowUpRight size={14} aria-hidden="true"/> : <ArrowRight size={14} aria-hidden="true"/>}</span>{combinedRail && shortcutFact ? <span className="vehicle-resource-shortcut__fact">{shortcutFact}</span> : null}</>;
        return resource.href ? <a key={resource.id} className="vehicle-resource-shortcut" href={resource.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${label} source in a new tab`}>{content}</a>
          : onOpenSection ? <button key={resource.id} type="button" className="vehicle-resource-shortcut" onClick={() => onOpenSection(resource.target)} aria-label={`View captured ${label} records`}>{content}</button>
            : null;
      })}
      {!combinedRail && history && historyFacts.length ? <div className="vehicle-resource-shortcuts__facts" aria-label="AutoCheck captured summary">
        <span>AutoCheck{vehicle.autoCheckReport?.dataState !== 'current' ? ' (saved)' : ''}</span>
        {historyFacts.map(row => <span key={row.label}>{row.label === 'Score' ? 'Score ' : ''}<strong>{row.values.join(' · ')}</strong></span>)}
      </div> : null}
      {combinedRail ? shortcutActions : null}
    </div>;
  }
  if (variant === 'signals') {
    const review = historyReviewLabels(vehicle);
    const history = resources.find(resource => resource.id === 'autocheck');
    const findings = history?.summaryRows?.filter(row => review.has(historyLabel(row.label))) ?? [];
    const oasis = resources.find(resource => resource.id === 'oasis');
    const actions = vehicle.fordOasis?.openFieldServiceActions?.length ?? 0;
    if (!findings.length && !actions) return null;
    return <div className="vehicle-resource-signals" aria-label="Source findings to review">
      {findings.length ? <span title={findings.map(row => historyExceptionText(row, syntheticPreview)).join('; ')}>AutoCheck{vehicle.autoCheckReport?.dataState !== 'current' ? ' (saved)' : ''}: {findings.length === 1 ? historyExceptionText(findings[0], syntheticPreview) : `${findings.length} findings to review`}</span> : null}
      {actions ? <span>OASIS: {oasis?.scanFacts?.[0]}</span> : null}
    </div>;
  }
  if (variant === 'scan') {
    const history = resources.find(resource => resource.id === 'autocheck');
    const oasis = resources.find(resource => resource.id === 'oasis');
    const equipment = resources.find(resource => ['window-sticker','vauto'].includes(resource.id));
    const sources = [history, equipment, oasis].filter((resource): resource is VehicleResource => Boolean(resource));
    return <div className={`vehicle-resources vehicle-resources--scan${onSelectResource ? ' is-interactive' : ''}`} aria-label="Captured source signals; complete reports in Records" onClick={event => event.stopPropagation()} onKeyDown={event => { if (onSelectResource && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation(); }}>
      {!history ? <p className="vehicle-resource-scan__missing" data-missing="history">History not captured</p> : null}
      {!equipment ? <p className="vehicle-resource-scan__missing" data-missing="equipment">Equipment not captured</p> : null}
      {!oasis ? <p className="vehicle-resource-scan__missing" data-missing="oasis">{/^(ford|lincoln)$/i.test(vehicle.make?.trim() ?? '') ? 'OASIS not captured' : 'OASIS covers Ford and Lincoln only'}</p> : null}
      {sources.map(resource => {
        const rows = scanRows(resource, vehicle);
        const label = resource.id === 'autocheck' ? 'AutoCheck' : resource.id === 'oasis' ? 'OASIS' : resource.id === 'vauto' ? 'Equipment' : 'Sticker';
        // The synthetic demo sticker still represents the captured Ford-family
        // document slot; the adjacent warning keeps its demo status explicit.
        const scanBrandResource = resource.id === 'window-sticker' && !resource.brand && /^(ford|lincoln)$/i.test(vehicle.make?.trim() ?? '')
          ? { ...resource, brand:'ford' as const }
          : resource;
        const sourceContent = <><ResourceBrand resource={scanBrandResource}/><span className="vehicle-resource-scan__source-label">{label}</span>{onSelectResource ? <ChevronDown size={13} aria-hidden="true"/> : null}</>;
        return <div key={resource.id} data-resource-kind={resource.id} className="vehicle-resource-scan">
          {onSelectResource && resource.hasCapturedData ? <button type="button" className="vehicle-resource-scan__source" aria-label={`Show ${label === 'Sticker' ? 'sticker' : label === 'Equipment' ? 'equipment' : label} records`} aria-expanded={selectedId === resource.id} onClick={event => { event.currentTarget.focus({preventScroll:true}); selectResource(resource.id); }}>{sourceContent}</button>
            : resource.href ? <a className="vehicle-resource-scan__source" href={resource.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${resource.id === 'vauto' ? 'vAuto equipment' : label} source in a new tab`}><ResourceBrand resource={scanBrandResource}/><span className="vehicle-resource-scan__source-label">{label}</span><ArrowUpRight size={13} aria-hidden="true"/></a>
              : onOpenSection && resource.hasCapturedData ? <button type="button" className="vehicle-resource-scan__source" aria-label={`View captured ${label} records`} onClick={() => onOpenSection(resource.target)}>{sourceContent}<ArrowRight size={13} aria-hidden="true"/></button>
                : <strong className="vehicle-resource-scan__source vehicle-resource-scan__source--static">{sourceContent}</strong>}
          <div className="vehicle-resource-scan__findings">{rows.length ? <ScanFields rows={rows} resource={resource} synthetic={syntheticPreview}/> : <p className="vehicle-resource-scan__missing">{resource.hasCapturedData ? 'Captured details in Records' : resource.id === 'vauto' && resource.href ? 'VIN equipment profile available' : 'No captured report'}</p>}</div>
          {decisionSourceNote(resource.sourceNote) ? <p className="vehicle-resource-scan__caption">{decisionSourceNote(resource.sourceNote)}</p> : null}
        </div>;
      })}
    </div>;
  }
  const preview = variant === 'preview';
  const captured = usable.filter(resource => resource.hasCapturedData);
  const overview = preview && !captured.some(resource => resource.id === selectedId);
  const lookups = usable.filter(resource => !resource.hasCapturedData);
  const sourceAction = (resource: VehicleResource, compact = false) => {
    const label = resource.id === 'autocheck' ? 'Open AutoCheck history' : resource.id === 'vauto' ? 'Open vAuto equipment' : resource.action;
    const title = [resource.title, resource.subtitle, ...resource.facts].filter(Boolean).join(' · ');
    const content = <><ResourceBrand resource={resource}/><span>{compact && resource.demo ? 'Demo sticker' : ['Sticker & equipment', 'vAuto equipment'].includes(resource.title) ? resource.title : resource.id === 'autocheck' ? 'History' : resource.id === 'vauto' ? 'Equipment' : resource.demo ? 'Demo sticker' : resource.id === 'window-sticker' ? 'Window sticker' : resource.id === 'oasis' ? 'OASIS' : 'Invoice'}</span>{compact && syntheticPreview && ['autocheck', 'oasis'].includes(resource.id) ? <small className="vehicle-resource-heading-qualifier">Demo</small> : null}{resource.href ? <ArrowUpRight size={14} aria-hidden="true"/> : <ArrowRight size={14} aria-hidden="true"/>}</>;
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
  return <div className={`vehicle-resources vehicle-resources--${variant}${overview ? ' is-overview' : ''}${hideSourceSelectors ? ' has-shared-source-controls' : ''}`} aria-label="Vehicle documents and resources" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
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
        const stickerPricing = sticker ? ([
          sticker.msrp ? ['Original MSRP', sticker.msrp] : sticker.basePrice ? ['Base MSRP', sticker.basePrice] : null,
          sticker.totalOptions ? ['Options total', sticker.totalOptions] : null,
        ] as Array<[string, string] | null>).filter((entry): entry is [string, string] => Boolean(entry)) : [];
        const stickerVehicleFacts = sticker ? ([
          sticker.exteriorColor ? ['Exterior', sticker.exteriorColor] : null,
          sticker.interiorColor ? ['Interior', sticker.interiorColor] : null,
          sticker.engine ? ['Engine', sticker.engine] : null,
          sticker.transmission ? ['Transmission', sticker.transmission] : null,
        ] as Array<[string, string] | null>).filter((entry): entry is [string, string] => Boolean(entry)) : [];
        const previewUrl = resource.previewUrl && !failedPreviews.has(resource.id) ? resource.previewUrl : undefined;
        const expanded = !preview && detailsExpanded !== undefined ? detailsExpanded : selectedId === resource.id;
        const detailId = `${disclosureId}-${resource.id}`;
        const visibleSourceNote = decisionSourceNote(resource.sourceNote);
        return <section key={resource.id} className={`vehicle-resource-summary${facts.length <= 2 ? " vehicle-resource-summary--sparse" : ""}`} data-resource-kind={resource.id} aria-label={resource.title} hidden={preview && !overview && !expanded}>
          <div className="vehicle-resource-summary__heading">{sourceAction(resource, !expanded)}
          {!preview && detailsExpanded === undefined ? resourceToggle(resource) : null}
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
              {sticker.vehicleDescription ? <p className="vehicle-resource-sticker__vehicle">{sticker.vehicleDescription}</p> : null}
              {stickerPricing.length ? <dl className="vehicle-resource-sticker__pricing" aria-label="Window sticker pricing">{stickerPricing.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{displaySourceMoney(value)}</dd></div>)}</dl> : null}
              {stickerVehicleFacts.length ? <dl className="vehicle-resource-sticker__specs" aria-label="Window sticker vehicle details">{stickerVehicleFacts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
              {sticker.equipmentGroup || sticker.equipmentGroupContents?.length ? <section className="vehicle-resource-sticker__group" aria-label="Equipment group">
                <p className="vehicle-resource-sticker__label">Equipment group</p>
                {sticker.equipmentGroup ? <StickerLineContent line={{...stickerLineParts(sticker.equipmentGroup), price:sticker.equipmentGroupPrice ?? stickerLineParts(sticker.equipmentGroup).price}}/> : null}
                {sticker.equipmentGroupContents?.length ? <ul className="vehicle-resource-sticker__included" aria-label="Included with equipment group">{sticker.equipmentGroupContents.map((line,index) => <li key={index} title={line} aria-label={line}><StickerLineContent line={stickerLineParts(line)}/></li>)}</ul> : null}
              </section> : null}
              <div className="vehicle-resource-sticker__optional">{sticker.optionLines.length ? <><p className="vehicle-resource-sticker__label">{sticker.optionLabel ?? 'Optional equipment & packages'}</p><StickerOptions lines={sticker.optionLines}/></> : <p className="vehicle-resource-sticker__missing">Optional equipment details not captured</p>}</div>
              {sticker.standardEquipment?.length ? <section className="vehicle-resource-sticker__section" aria-label="Standard equipment"><p className="vehicle-resource-sticker__label">Standard equipment</p><ul>{sticker.standardEquipment.map((item,index) => <li key={index}>{item}</li>)}</ul></section> : null}
              {sticker.warranty?.length ? <section className="vehicle-resource-sticker__section" aria-label="Printed warranty"><p className="vehicle-resource-sticker__label">Printed warranty</p><ul>{sticker.warranty.map((item,index) => <li key={index}>{item}</li>)}</ul></section> : null}
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
