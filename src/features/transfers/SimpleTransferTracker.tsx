import { AlertTriangle, ArrowRight, CarFront, Check, ChevronDown, MapPin, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TransferActionKind, TransferDetail } from './types';
import { formatDateTime, humanizeStatusLabel, locationConfidenceLabel, transferActionLabels } from './presentation';
import { awayFromHomeSummary } from './moveSummary';
import { TransferTimeline } from './TransferTimeline';
import { ServiceStatusLink } from '../inventory/ServiceStatusLink';
import { CopyableValue } from '../../components/CopyableValue';
import './transfer-simple.css';
import './transfer-vehicle-context.css';

const SIMPLE_ACTION_ORDER: TransferActionKind[] = ['approve', 'record-outcome', 'schedule-return', 'confirm-return', 'decline', 'close'];
const ADVANCED_ACTIONS = new Set<TransferActionKind>(['review-request', 'request-driver', 'assign-transport', 'edit-request', 'escalate']);
const RETIRED_SIMPLE_ACTIONS = new Set<TransferActionKind>(['confirm-pickup', 'confirm-arrival']);

export function simpleTransferActions(transfer: TransferDetail): TransferActionKind[] {
  return transfer.allowedActions.filter(action => !ADVANCED_ACTIONS.has(action) && !RETIRED_SIMPLE_ACTIONS.has(action));
}

/** Sold pending with no delivery yet: the vehicle waits at the destination for its customer, not for a trip home. */
export function awaitingCustomerDelivery(transfer: Pick<TransferDetail, 'status'>): boolean {
  return transfer.status.deal.code === 'sold-pending' && transfer.status.delivery.code !== 'confirmed';
}

export function simpleTransferActionLabel(action: TransferActionKind, transfer?: Pick<TransferDetail, 'status'>): string {
  if (action === 'approve') return 'Approve this move';
  if (action === 'confirm-pickup') return 'Mark vehicle collected';
  if (action === 'confirm-arrival') return 'Mark arrived';
  if (action === 'schedule-return') return 'Start return';
  if (action === 'confirm-return') return 'Confirm back home';
  if (action === 'record-outcome') return transfer && awaitingCustomerDelivery(transfer) ? 'Confirm delivery or update the outcome' : 'Update the showing outcome';
  if (action === 'mark-exception') return 'Report a location issue';
  return transferActionLabels[action];
}

function moveProgress(transfer: TransferDetail): number {
  const movement = transfer.status.movement.code;
  if (movement === 'returned-home-confirmed') return 2;
  if (['in-transit-return', 'return-required', 'return-scheduled', 'returned-awaiting-receipt'].includes(movement)) return 1;
  if (['at-requesting-store-verified', 'at-authorized-location', 'released-to-custodian', 'in-transit-outbound'].includes(movement)) return 1;
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
  const target = transfer.destination || transfer.requestingStore || 'Requesting store';
  const away = awayFromHomeSummary(vehicle.homeStore, vehicle.currentLocation.label, transfer.timeline, { destination: target });
  // Custody at the destination proves the vehicle is away; it is not a collection record.
  const awayEvidence = away.departedAt
    ? away.evidence === 'collected'
      ? `Collected ${formatDateTime(away.departedAt)}`
      : away.evidence === 'return-started'
        ? `Left ${target} ${formatDateTime(away.departedAt)}`
        : `At ${target} since ${formatDateTime(away.departedAt)}`
    : undefined;
  const allowed = simpleTransferActions(transfer);
  const primary = SIMPLE_ACTION_ORDER.find(action => allowed.includes(action));
  const additional = allowed.filter(action => action !== primary);
  const issue = transfer.timeline.find(event => event.kind === 'condition_issue');
  const directMoveEvent = [...transfer.timeline].reverse().find(event => event.kind === 'direct_move_recorded');
  const directMove = Boolean(directMoveEvent);
  const takeAction = (action: TransferActionKind) => onAction?.(action, transfer);
  const terminal = transfer.status.movement.code === 'returned-home-confirmed' || ['closed', 'declined', 'canceled', 'expired'].includes(transfer.status.request.code);
  const delivered = transfer.status.delivery.code === 'confirmed';
  const soldPending = !terminal && awaitingCustomerDelivery(transfer);
  // A sold vehicle's last step is the customer delivery, never a return home.
  const finalStep = soldPending || delivered ? 'Customer delivery' : 'Return home';
  const progress = delivered ? 2 : moveProgress(transfer);
  const returnDueLabel = transfer.returnRequired === false
    ? 'Return not required'
    : delivered
      ? 'Not required · delivered'
      : soldPending
        ? 'Paused while sold pending'
        : transfer.returnDueAt
          ? formatDateTime(transfer.returnDueAt)
          : 'Not set';
  return (
    <article className={`mif-transfer-feature simple-transfer-tracker simple-transfer-tracker--${mode}`}>
      <header className="simple-move-heading">
        {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" /> : <span className="simple-move-photo-placeholder" aria-hidden="true"><CarFront size={32} /></span>}
        <div className="simple-move-identity"><h2>{vehicle.vehicleLabel}</h2>
          <p className="move-vehicle-value">{[vehicle.listedPriceLabel, vehicle.mileageLabel].filter(Boolean).join(' · ')}</p>
          <p className="move-vehicle-specs">{[vehicle.engine, vehicle.drivetrain, vehicle.exteriorColor].filter(Boolean).join(' · ')}</p>
        </div>
        {onClose ? <button type="button" aria-label="Close move details" onClick={onClose}><X aria-hidden="true" size={20} /></button> : null}
        <div className="move-vehicle-context">
          <dl className="simple-move-identifiers">
            <div><dt>Stock</dt><dd><CopyableValue compact label="stock number" text={vehicle.stock} /></dd></div>
            <div><dt>VIN</dt><dd><CopyableValue compact label="VIN" text={vehicle.vin} /></dd></div>
          </dl>
          <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} />
        </div>
      </header>

      <div className="simple-move-route"><span>{vehicle.homeStore}<small>Home store</small></span><ArrowRight aria-hidden="true" size={20} /><span>{target}<small>{directMove ? 'Destination store' : 'Requesting store'}</small></span></div>

      {transfer.exception || issue ? (
        <section className="simple-move-issue" role="status">
          <AlertTriangle aria-hidden="true" size={18} />
          <div><strong>{transfer.exception?.label || 'Vehicle issue reported'}</strong><p>{transfer.exception?.detail || issue?.detail || 'Read the move history before moving the vehicle.'}</p></div>
        </section>
      ) : null}

      <section className="simple-move-next" aria-label="Next step">
        <div><span>{terminal ? 'Move status' : 'Next step'}</span><h3>{terminal ? transfer.status.movement.code === 'returned-home-confirmed' ? 'Back home · move complete' : delivered ? 'Delivered · move complete' : humanizeStatusLabel(transfer.status.request.label) : transfer.nextAction.label}</h3>{!terminal ? <p>{transfer.nextAction.ownerLabel || `${transfer.requestingStore || target} manager`}{transfer.nextAction.dueAt ? ` · Needed ${formatDateTime(transfer.nextAction.dueAt)}` : ''}</p> : null}</div>
        {allowed.length && onAction ? <div className="simple-move-actions" aria-label="Available move actions">
          {primary ? <button type="button" className="mif-button mif-button--primary" onClick={() => takeAction(primary)}>{simpleTransferActionLabel(primary, transfer)}</button> : null}
          {additional.length ? <details className="simple-move-more"><summary>Other options <ChevronDown aria-hidden="true" size={16} /></summary><div>{additional.map(action => <button type="button" key={action} onClick={() => takeAction(action)}>{simpleTransferActionLabel(action, transfer)}</button>)}</div></details> : null}
        </div> : !terminal ? <p className="simple-move-waiting">Waiting on {transfer.nextAction.ownerLabel || `${transfer.requestingStore || target} manager`}. Your available updates will appear here.</p> : null}
      </section>

      {vehicleLinks}

      {!terminal || transfer.status.movement.code === 'returned-home-confirmed' || delivered ? <ol className="simple-move-progress" aria-label="Vehicle move progress">
        {[directMove ? 'At destination' : 'Approval', finalStep].map((label, index) => <li key={label} className={index < progress ? 'is-complete' : index === progress ? 'is-current' : undefined} aria-current={index === progress ? 'step' : undefined}><span>{index < progress ? <Check aria-hidden="true" size={14} /> : index + 1}</span><strong>{label}</strong></li>)}
      </ol> : null}

      <section className="simple-move-location" aria-label="Vehicle location and time away">
        <div><span>Current location</span><strong><MapPin aria-hidden="true" size={16} />{vehicle.currentLocation.label}</strong><small>{locationConfidenceLabel(vehicle.currentLocation.confidence)}{vehicle.currentLocation.confirmedAt ? ` · ${formatDateTime(vehicle.currentLocation.confirmedAt)}` : ''}</small></div>
        <div><span>Time away from home</span><strong>{away.label}</strong>{awayEvidence ? <small>{awayEvidence}</small> : null}</div>
      </section>

      <section className="simple-move-details" aria-label="Request and vehicle summary">
        <h3>{directMove ? 'Move details' : 'Request details'}</h3>
        <dl>
          <div><dt>{directMove ? 'Recorded by' : 'Requested by'}</dt><dd>{transfer.requestedByLabel || 'Not recorded'}</dd>{!directMove ? <dd className="simple-move-secondary">{transfer.requestingStore || 'Store not recorded'} · {formatDateTime(transfer.requestedAt)}</dd> : null}</div>
          <div><dt>{directMove ? 'Destination' : 'Requested destination'}</dt><dd>{target}</dd></div>
          <div><dt>{directMove ? 'Moved at' : 'Needed by'}</dt><dd>{formatDateTime(directMoveEvent?.occurredAt || transfer.neededBy)}</dd></div>
          <div><dt>Return due</dt><dd>{returnDueLabel}</dd></div>
          {!directMove ? <div><dt>Requesting-store manager</dt><dd>{transfer.approvalOwnerLabel || `${transfer.requestingStore || target} manager`}</dd></div> : null}
          <div className="simple-move-reason"><dt>Reason</dt><dd>{transfer.requestReason || 'Not available in this access view'}</dd>{transfer.customerReference ? <dd className="simple-move-secondary">{transfer.customerReference}</dd> : null}</div>
        </dl>
      </section>

      <details className="simple-move-records">
        <summary>Hold and outcome details <ChevronDown aria-hidden="true" size={16} /></summary>
        <dl><div><dt>Hold</dt><dd>{humanizeStatusLabel(transfer.status.dealerMail.label)}</dd></div><div><dt>Customer outcome</dt><dd>{humanizeStatusLabel(transfer.status.deal.label)}</dd></div><div><dt>Customer delivery</dt><dd>{humanizeStatusLabel(transfer.status.delivery.label)}</dd></div><div><dt>Where it is</dt><dd>{humanizeStatusLabel(transfer.status.movement.label)}</dd></div></dl>
        <p>A request or movement does not change a hold or confirm a sale, customer delivery, or funding.</p>
      </details>
      <details className="simple-move-records">
        <summary>Move history <span>{transfer.timeline.length} updates</span><ChevronDown aria-hidden="true" size={16} /></summary>
        <TransferTimeline events={transfer.timeline} />
      </details>
    </article>
  );
}
