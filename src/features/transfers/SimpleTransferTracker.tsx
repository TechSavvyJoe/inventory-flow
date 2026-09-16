import { AlertTriangle, ArrowRight, CarFront, Check, ChevronDown, MapPin, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TransferActionKind, TransferDetail } from './types';
import { formatDateTime, humanizeStatusLabel, locationConfidenceLabel, transferActionLabels } from './presentation';
import { awayFromHomeSummary } from './moveSummary';
import { TransferTimeline } from './TransferTimeline';
import { ServiceStatusLink } from '../inventory/ServiceStatusLink';
import './transfer-simple.css';
import './transfer-vehicle-context.css';

const SIMPLE_ACTION_ORDER: TransferActionKind[] = ['approve', 'confirm-pickup', 'confirm-arrival', 'confirm-return', 'record-outcome', 'schedule-return', 'decline', 'close'];
const ADVANCED_ACTIONS = new Set<TransferActionKind>(['review-request', 'request-driver', 'assign-transport', 'edit-request', 'escalate']);

export function simpleTransferActions(transfer: TransferDetail): TransferActionKind[] {
  return transfer.allowedActions.filter(action => !ADVANCED_ACTIONS.has(action));
}

export function simpleTransferActionLabel(action: TransferActionKind): string {
  if (action === 'approve') return 'Approve this move';
  if (action === 'confirm-pickup') return 'Mark vehicle collected';
  if (action === 'confirm-arrival') return 'Mark arrived';
  if (action === 'schedule-return') return 'Start return';
  if (action === 'confirm-return') return 'Confirm back home';
  if (action === 'record-outcome') return 'Update showing / outcome';
  if (action === 'mark-exception') return 'Report a location or timing issue';
  return transferActionLabels[action];
}

function moveProgress(transfer: TransferDetail): number {
  const movement = transfer.status.movement.code;
  if (movement === 'returned-home-confirmed') return 4;
  if (['in-transit-return', 'return-required', 'return-scheduled', 'returned-awaiting-receipt'].includes(movement)) return 3;
  if (['at-requesting-store-verified', 'at-authorized-location'].includes(movement)) return 3;
  if (['released-to-custodian', 'in-transit-outbound'].includes(movement)) return 2;
  if (transfer.status.request.code === 'approved' || ['release-approved', 'pickup-scheduled'].includes(movement)) return 1;
  return 0;
}

export function SimpleTransferTracker({ transfer, onAction, onClose, vehicleLinks, mode = 'page' }: {
  transfer: TransferDetail;
  onAction?: (action: TransferActionKind, transfer: TransferDetail) => void;
  onClose?: () => void;
  mode?: 'drawer' | 'page';
  vehicleLinks?: ReactNode;
}) {
  const { vehicle } = transfer;
  const away = awayFromHomeSummary(vehicle.homeStore, vehicle.currentLocation.label, transfer.timeline);
  const allowed = simpleTransferActions(transfer);
  const primary = SIMPLE_ACTION_ORDER.find(action => allowed.includes(action));
  const additional = allowed.filter(action => action !== primary);
  const issue = transfer.timeline.find(event => event.kind === 'condition_issue');
  const takeAction = (action: TransferActionKind) => onAction?.(action, transfer);
  const target = transfer.destination || transfer.requestingStore || 'Requesting store';
  const terminal = transfer.status.movement.code === 'returned-home-confirmed' || ['closed', 'declined', 'canceled', 'expired'].includes(transfer.status.request.code);
  const progress = moveProgress(transfer);
  return (
    <article className={`mif-transfer-feature simple-transfer-tracker simple-transfer-tracker--${mode}`}>
      <header className="simple-move-heading">
        {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" /> : <span className="simple-move-photo-placeholder" aria-hidden="true"><CarFront size={32} /></span>}
        <div><span>Stock {vehicle.stock}</span><h2>{vehicle.vehicleLabel}</h2><small>{vehicle.vin}</small></div>
        {onClose ? <button type="button" aria-label="Close movement detail" onClick={onClose}><X aria-hidden="true" size={20} /></button> : null}
        <div className="move-vehicle-context">
          <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} />
        </div>
      </header>

      <div className="simple-move-route"><span>{vehicle.homeStore}<small>Home store</small></span><ArrowRight aria-hidden="true" size={20} /><span>{target}<small>Requesting store</small></span></div>

      {transfer.exception || issue ? (
        <section className="simple-move-issue" role="status">
          <AlertTriangle aria-hidden="true" size={18} />
          <div><strong>{transfer.exception?.label || 'Vehicle issue reported'}</strong><p>{transfer.exception?.detail || issue?.detail || 'Review the activity record before moving the vehicle.'}</p></div>
        </section>
      ) : null}

      <section className="simple-move-next" aria-label="Next move action">
        <div><span>{terminal ? 'Request status' : 'Next step'}</span><h3>{terminal ? transfer.status.movement.code === 'returned-home-confirmed' ? 'Back home · move complete' : humanizeStatusLabel(transfer.status.request.label) : transfer.nextAction.label}</h3>{!terminal ? <p>{transfer.nextAction.ownerLabel || `${transfer.requestingStore || target} manager`}{transfer.nextAction.dueAt ? ` · Needed ${formatDateTime(transfer.nextAction.dueAt)}` : ''}</p> : null}</div>
        {allowed.length && onAction ? <div className="simple-move-actions" aria-label="Available move actions">
          {primary ? <button type="button" className="mif-button mif-button--primary" onClick={() => takeAction(primary)}>{simpleTransferActionLabel(primary)}</button> : null}
          {additional.length ? <details className="simple-move-more"><summary>Other options <ChevronDown aria-hidden="true" size={16} /></summary><div>{additional.map(action => <button type="button" key={action} onClick={() => takeAction(action)}>{simpleTransferActionLabel(action)}</button>)}</div></details> : null}
        </div> : !terminal ? <p className="simple-move-waiting">Waiting on {transfer.nextAction.ownerLabel || `${transfer.requestingStore || target} manager`}. Your available updates will appear here.</p> : null}
      </section>

      {vehicleLinks}

      {!terminal || transfer.status.movement.code === 'returned-home-confirmed' ? <ol className="simple-move-progress" aria-label="Vehicle move progress">
        {['Approval', 'Collect', 'Arrive', 'Return'].map((label, index) => <li key={label} className={index < progress ? 'is-complete' : index === progress ? 'is-current' : undefined} aria-current={index === progress ? 'step' : undefined}><span>{index < progress ? <Check aria-hidden="true" size={14} /> : index + 1}</span><strong>{label}</strong></li>)}
      </ol> : null}

      <section className="simple-move-location" aria-label="Vehicle location and time away">
        <div><span>Current location</span><strong><MapPin aria-hidden="true" size={16} />{vehicle.currentLocation.label}</strong><small>{locationConfidenceLabel(vehicle.currentLocation.confidence)}{vehicle.currentLocation.confirmedAt ? ` · ${formatDateTime(vehicle.currentLocation.confirmedAt)}` : ''}</small></div>
        <div><span>Time away from home</span><strong>{away.label}</strong>{away.departedAt ? <small>Collected {formatDateTime(away.departedAt)}</small> : null}</div>
      </section>

      <section className="simple-move-details" aria-label="Request and vehicle summary">
        <h3>Request details</h3>
        <dl>
          <div><dt>Requested by</dt><dd>{transfer.requestedByLabel || 'Not recorded'}</dd><dd className="simple-move-secondary">{transfer.requestingStore || 'Store not recorded'} · {formatDateTime(transfer.requestedAt)}</dd></div>
          <div><dt>Requested destination</dt><dd>{target}</dd></div>
          <div><dt>Needed by</dt><dd>{formatDateTime(transfer.neededBy)}</dd></div>
          <div><dt>Return due</dt><dd>{transfer.returnRequired === false ? 'Return not required' : transfer.returnDueAt ? formatDateTime(transfer.returnDueAt) : 'Not set'}</dd></div>
          <div><dt>Requesting-store manager</dt><dd>{transfer.approvalOwnerLabel || `${transfer.requestingStore || target} manager`}</dd></div>
          <div className="simple-move-reason"><dt>Reason</dt><dd>{transfer.requestReason || 'Not available in this access view'}</dd>{transfer.customerReference ? <dd className="simple-move-secondary">{transfer.customerReference}</dd> : null}</div>
        </dl>
      </section>

      <details className="simple-move-records">
        <summary>Hold and outcome details <ChevronDown aria-hidden="true" size={16} /></summary>
        <dl><div><dt>Hold</dt><dd>{humanizeStatusLabel(transfer.status.dealerMail.label)}</dd></div><div><dt>Customer outcome</dt><dd>{humanizeStatusLabel(transfer.status.deal.label)}</dd></div><div><dt>Customer delivery</dt><dd>{humanizeStatusLabel(transfer.status.delivery.label)}</dd></div><div><dt>Movement</dt><dd>{humanizeStatusLabel(transfer.status.movement.label)}</dd></div></dl>
        <p>A request or movement does not change a hold or confirm a sale, customer delivery, or funding.</p>
      </details>
      <details className="simple-move-records">
        <summary>Activity history <span>{transfer.timeline.length} updates</span><ChevronDown aria-hidden="true" size={16} /></summary>
        <TransferTimeline events={transfer.timeline} />
      </details>
    </article>
  );
}
