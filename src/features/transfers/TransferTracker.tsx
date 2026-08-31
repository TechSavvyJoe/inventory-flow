import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  ExternalLink,
  MapPin,
  ShieldAlert,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import type { TransferActionKind, TransferDetail } from './types';
import {
  formatDateTime,
  humanizeStatusLabel,
  locationConfidenceLabel,
  primaryTransferActions,
  slaLabel,
  toneClass,
  transferActionLabels,
} from './presentation';
import { TransferEmptyState } from './TransferEmptyState';
import { TransferStatusLanes } from './TransferStatusLanes';
import { TransferTimeline } from './TransferTimeline';
import './transfers.css';
import './transfer-workspace-v3.css';

export interface TransferTrackerProps {
  transfer: TransferDetail | null;
  onAction?: (action: TransferActionKind, transfer: TransferDetail) => void;
  onClose?: () => void;
  onCreateRequest?: () => void;
  mode?: 'drawer' | 'page';
}

export function TransferTracker({
  transfer,
  onAction,
  onClose,
  onCreateRequest,
  mode = 'drawer',
}: TransferTrackerProps) {
  if (!transfer) {
    return (
      <div className={`mif-transfer-feature mif-transfer-tracker mif-transfer-tracker--${mode} transfer-tracker-v3`}>
        <TransferEmptyState
          actionLabel={onCreateRequest ? 'Create movement request' : undefined}
          onAction={onCreateRequest}
          variant="no-selection"
        />
      </div>
    );
  }

  const { vehicle } = transfer;
  const action = transfer.nextAction;
  const latestConditionIssue = transfer.timeline.find((event) => event.kind === 'condition_issue');
  const returnPlan = transfer.returnRequired === true
    ? transfer.returnDueAt
      ? formatDateTime(transfer.returnDueAt)
      : 'Required · date not set'
    : transfer.returnRequired === false
      ? 'Not required'
      : 'Not recorded';
  const handleAction = (kind: TransferActionKind) => onAction?.(kind, transfer);

  return (
    <article className={`mif-transfer-feature mif-transfer-tracker mif-transfer-tracker--${mode} transfer-tracker-v3`}>
      <div className="mif-tracker-overview-grid">
        <div className="mif-tracker-overview-primary">
          <header className="mif-tracker-header">
            <div className="mif-tracker-vehicle">
              {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" /> : null}
              <div>
                <span className="mif-tracker-stock">{vehicle.stock}</span>
                <h2>{vehicle.vehicleLabel}</h2>
                {vehicle.trimLabel ? <p>{vehicle.trimLabel}</p> : null}
                <small>{vehicle.vin} · Move {transfer.id}</small>
              </div>
            </div>
            {onClose ? (
              <button aria-label="Close movement detail" className="mif-icon-button" onClick={onClose} type="button">
                <X aria-hidden="true" size={20} strokeWidth={1.75} />
              </button>
            ) : null}
          </header>

          <section className="mif-tracker-request-summary" aria-label="Request and vehicle summary">
            <div><span>Route</span><strong>{vehicle.homeStore} → {transfer.destination ?? transfer.requestingStore ?? 'Not set'}</strong></div>
            <div><span>Requested by</span><strong>{transfer.requestedByLabel ?? 'Not provided'}</strong><small>{formatDateTime(transfer.requestedAt)}</small></div>
            <div><span>Needed by</span><strong>{formatDateTime(transfer.neededBy)}</strong></div>
            <div><span>Vehicle</span><strong>{vehicle.listedPriceLabel ?? 'Price not published'}</strong><small>{vehicle.mileageLabel ?? 'Mileage not published'}</small></div>
            <div className="mif-tracker-request-summary__reason"><span>Request reason / customer reference</span><strong>{transfer.requestReason ?? 'Not available in this access view'}</strong>{transfer.customerReference ? <small>{transfer.customerReference}</small> : null}</div>
          </section>
        </div>

        <section className="mif-tracker-accountability" aria-label="Location and accountability">
          <div>
            <span>Home Store</span>
            <strong>{vehicle.homeStore}</strong>
          </div>
          <div>
            <span>Current location</span>
            <strong><MapPin aria-hidden="true" size={15} strokeWidth={1.75} /> {vehicle.currentLocation.label}</strong>
            <small>{locationConfidenceLabel(vehicle.currentLocation.confidence)} · {formatDateTime(vehicle.currentLocation.confirmedAt)}</small>
          </div>
          <div>
            <span>Requesting store</span>
            <strong>{transfer.requestingStore ?? 'Not set'}</strong>
          </div>
          <div>
            <span>Approval owner</span>
            <strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {transfer.approvalOwnerLabel ?? 'Not recorded'}</strong>
          </div>
          <div>
            <span>Current action owner</span>
            <strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {action.ownerLabel ?? 'Not assigned'}</strong>
            {action.ownerRole ? <small>{action.ownerRole}</small> : null}
          </div>
          <div>
            <span>Custodian</span>
            <strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {transfer.custodianLabel ?? 'Not assigned'}</strong>
          </div>
          <div>
            <span>Assigned driver</span>
            <strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {transfer.transportAssigneeLabel ?? 'Not set up yet'}</strong>
          </div>
          <div>
            <span>Pickup / next target</span>
            <strong>{formatDateTime(action.dueAt)}</strong>
          </div>
          <div>
            <span>Return due</span>
            <strong>{returnPlan}</strong>
          </div>
        </section>
      </div>

      <section className="mif-outcome-separation" aria-label="Deal, delivery, movement, and return status">
        <header>
          <strong>Outcome and return are recorded separately</strong>
          <span>A pending deal is not a confirmed delivery.</span>
        </header>
        <div>
          <span>Customer / deal</span>
          <strong className={toneClass(transfer.status.deal.tone)}>{humanizeStatusLabel(transfer.status.deal.label)}</strong>
        </div>
        <div>
          <span>Delivery</span>
          <strong className={toneClass(transfer.status.delivery.tone)}>{humanizeStatusLabel(transfer.status.delivery.label)}</strong>
        </div>
        <div>
          <span>Movement / custody</span>
          <strong className={toneClass(transfer.status.movement.tone)}>{humanizeStatusLabel(transfer.status.movement.label)}</strong>
        </div>
        <div>
          <span>Return plan</span>
          <strong>{returnPlan}</strong>
        </div>
      </section>

      {transfer.exception ? (
        <div className={`mif-exception-banner is-${transfer.exception.severity}`} role="status">
          <AlertTriangle aria-hidden="true" size={18} strokeWidth={1.75} />
          <div>
            <strong>{transfer.exception.label}</strong>
            {transfer.exception.detail ? <span>{transfer.exception.detail}</span> : null}
          </div>
        </div>
      ) : null}

      {latestConditionIssue ? (
        <div className="mif-condition-banner" role="status">
          <Wrench aria-hidden="true" size={18} strokeWidth={1.75} />
          <div>
            <strong>Vehicle issue reported — Home Store review required</strong>
            <span>{latestConditionIssue.detail || 'Open the handoff history for the recorded condition details.'}</span>
            <small>Reported by {latestConditionIssue.actorLabel ?? 'staff'} · {formatDateTime(latestConditionIssue.occurredAt)}</small>
          </div>
        </div>
      ) : null}

      <div className={`mif-tracker-control-grid${transfer.allowedActions.length > 0 ? '' : ' is-actionless'}`}>
        <section className={`mif-next-action is-${action.sla}`}>
          <div>
            <span>Next action</span>
            <strong>{action.label}</strong>
            <small>{action.ownerLabel ?? 'Owner not assigned'}{action.ownerRole ? ` · ${action.ownerRole}` : ''}</small>
          </div>
          <div>
            <CalendarClock aria-hidden="true" size={17} strokeWidth={1.75} />
            <strong>{formatDateTime(action.dueAt)}</strong>
            <span>{slaLabel(action.sla)}</span>
          </div>
        </section>

        {transfer.allowedActions.length > 0 ? (
          <footer className="mif-tracker-actions mif-tracker-actions--prominent" aria-label="Available move actions">
            {transfer.allowedActions.map((kind) => (
              <button
                className={`mif-button ${primaryTransferActions.has(kind) ? 'mif-button--primary' : kind === 'report-condition' ? 'mif-button--condition' : 'mif-button--secondary'}`}
                key={kind}
                onClick={() => handleAction(kind)}
                type="button"
              >
                {kind === 'open-source' ? <ExternalLink aria-hidden="true" size={16} strokeWidth={1.75} /> : null}
                {kind === 'report-condition' ? <Wrench aria-hidden="true" size={16} strokeWidth={1.75} /> : null}
                {transferActionLabels[kind]}
              </button>
            ))}
          </footer>
        ) : null}
      </div>

      <div className="mif-tracker-lower-grid">
        <section className="mif-tracker-section">
          <h3><ArrowLeftRight aria-hidden="true" size={17} strokeWidth={1.75} /> Hold, deal, delivery, and move status</h3>
          <TransferStatusLanes status={transfer.status} kind="operational" />
          <details className="mif-technical-status-details">
            <summary>Website, inventory-feed, and CDK details</summary>
            <TransferStatusLanes status={transfer.status} kind="technical" compact />
          </details>
        </section>

        <section className="mif-tracker-section">
          <h3><ShieldAlert aria-hidden="true" size={17} strokeWidth={1.75} /> Location and handoff history</h3>
          <TransferTimeline events={transfer.timeline} />
        </section>
      </div>

    </article>
  );
}
