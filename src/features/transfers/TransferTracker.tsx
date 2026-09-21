import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
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
import { TransferTimeline } from './TransferTimeline';
import { SimpleTransferTracker } from './SimpleTransferTracker';
import { ServiceStatusLink } from '../inventory/ServiceStatusLink';
import './transfers.css';
import './transfer-workspace-v3.css';

export interface TransferTrackerProps {
  transfer: TransferDetail | null;
  onAction?: (action: TransferActionKind, transfer: TransferDetail) => void;
  onClose?: () => void;
  onCreateRequest?: () => void;
  mode?: 'drawer' | 'page';
  vehicleLinks?: ReactNode;
}

const WORKFLOW_PHASES = [
  'Request',
  'Requesting manager',
  'Home-store contact & release',
  'Driver & move',
  'Outcome / return',
] as const;

function normalizedStatus(status: string): string {
  return status.toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function workflowStep(transfer: TransferDetail): number {
  const request = normalizedStatus(transfer.status.request.code);
  const movement = normalizedStatus(transfer.status.movement.code);
  const deal = normalizedStatus(transfer.status.deal.code);
  if (/shown|sold|return|delivery/.test(`${deal} ${movement}`)) return 5;
  if (!['at-home-verified', 'release-approved', 'location-unknown', 'location-exception'].includes(movement)) return 4;
  if (request === 'draft') return 1;
  if (['submitted', 'requested'].includes(request)) return 2;
  if (['manager-reviewed', 'needs-information', 'declined'].includes(request)) return 3;
  return 4;
}

function TransferProgress({ transfer }: { transfer: TransferDetail }) {
  const current = workflowStep(transfer);
  return (
    <ol className="mif-move-progress" aria-label="Inter-store request approval and movement progress">
      {WORKFLOW_PHASES.map((label, index) => {
        const stage = index + 1;
        const complete = stage < current;
        return (
          <li key={label} className={stage === current ? 'is-current' : complete ? 'is-complete' : undefined} aria-current={stage === current ? 'step' : undefined}>
            <span>{complete ? <CheckCircle2 aria-hidden="true" /> : stage}</span>
            <strong>{label}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function actionHint(kind: TransferActionKind) {
  switch (kind) {
    case 'report-condition': return 'Record condition or damage for the home-store manager to review';
    case 'mark-exception': return 'Record a location, timing, or custody problem';
    case 'open-source': return 'Open the original dealership record in a new tab';
    case 'schedule-return': return 'Set the return plan · this does not change the sale or delivery';
    case 'confirm-return': return 'Confirm the home store has it · this does not change the sale or delivery';
    default: return undefined;
  }
}

// Keep these in step with compactNextAction in TransfersPage: the same stored
// sentence must read the same in the tracker and in the queue.
function compactActionLabel(value: string, { homeStore, destination }: { homeStore?: string; destination?: string } = {}): string {
  if (/requesting manager confirms availability and release/i.test(value)) return 'Approve, then call the home store';
  if (/(?:contact|calls?) .*used-car manager/i.test(value)) return 'Call the home store, record the answer';
  if (/home-store.*availability.*release/i.test(value)) return 'Record the home store’s answer';
  if (/confirm.*returned home|confirm home receipt|home manager confirms receipt/i.test(value)) return homeStore ? `Confirm the vehicle is back at ${homeStore}` : 'Confirm the vehicle is back home';
  if (/record call for a driver|request.*driver|calls stacey for a driver|asks its manager or coordinator for a driver/i.test(value)) return 'Ask for a driver';
  if (/work the vehicle or start its return/i.test(value)) return 'Show the vehicle, then start its return';
  if (/confirm arrival at requesting store/i.test(value)) return destination ? `Confirm the vehicle arrived at ${destination}` : 'Confirm the vehicle arrived';
  if (/record customer showing or vehicle outcome|record an outcome or return the vehicle/i.test(value)) return 'Record the showing outcome';
  if (/assigned driver picks up vehicle/i.test(value)) return 'Collect the vehicle and confirm you have it';
  if (/close movement workflow/i.test(value)) return 'Close the move';
  if (/request return to home store|record when the vehicle starts its return/i.test(value)) return 'Start the return';
  return value;
}

export function TransferTracker({
  transfer,
  onAction,
  onClose,
  onCreateRequest,
  vehicleLinks,
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

  if (transfer.workflowMode === 'simple') return <SimpleTransferTracker transfer={transfer} onAction={onAction} onClose={onClose} mode={mode} vehicleLinks={vehicleLinks} />;

  const { vehicle } = transfer;
  const action = transfer.nextAction;
  const latestConditionIssue = transfer.timeline.find((event) => event.kind === 'condition_issue');
  const directMoveEvent = [...transfer.timeline].reverse().find((event) => event.kind === 'direct_move_recorded');
  const directMove = Boolean(directMoveEvent);
  const returnPlan = transfer.status.delivery.code === 'confirmed'
    ? 'Not required · delivered'
    : transfer.status.deal.code === 'sold-pending'
      ? 'Paused while sold pending'
      : transfer.returnRequired === true
        ? transfer.returnDueAt
          ? formatDateTime(transfer.returnDueAt)
          : 'Required · date not set'
        : transfer.returnRequired === false
          ? 'Not required'
          : 'Not recorded';
  const handleAction = (kind: TransferActionKind) => onAction?.(kind, transfer);
  const nextActionText = action.label.toLowerCase();
  const contextualPrimary = ([
    [/return.*home|home.*receipt/, 'confirm-return'],
    [/schedule.*return|return plan/, 'schedule-return'],
    [/request.*driver|call.*driver/, 'request-driver'],
    [/assign.*driver|assign.*transport/, 'assign-transport'],
    [/confirm.*pickup/, 'confirm-pickup'],
    [/confirm.*arrival/, 'confirm-arrival'],
    [/record.*outcome|sell or return/, 'record-outcome'],
    [/home-store.*release|confirm.*release/, 'approve'],
    [/manager.*review|review.*request/, 'review-request'],
  ] as Array<[RegExp, TransferActionKind]>).find(([pattern, kind]) => pattern.test(nextActionText) && transfer.allowedActions.includes(kind))?.[1];
  const primaryAction = contextualPrimary ?? transfer.allowedActions.find((kind) => primaryTransferActions.has(kind));
  const issueAction = transfer.allowedActions.includes('report-condition') && primaryAction !== 'report-condition'
    ? 'report-condition' as const
    : undefined;
  const secondaryActions = transfer.allowedActions.filter((kind) => kind !== primaryAction && kind !== issueAction);

  return (
    <article className={`mif-transfer-feature mif-transfer-tracker mif-transfer-tracker--${mode} transfer-tracker-v3 transfer-tracker-v4`}>
      <header className="mif-tracker-header">
        <div className="mif-tracker-vehicle">
          {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" /> : null}
          <div>
            <span className="mif-tracker-stock">Stock {vehicle.stock}</span>
            <h2>{vehicle.vehicleLabel}</h2>
            {vehicle.trimLabel ? <p>{vehicle.trimLabel}</p> : null}
            <small>{vehicle.vin}</small>
          </div>
        </div>
        {onClose ? (
          <button aria-label="Close move details" className="mif-icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>
      <div className="move-route-readiness" aria-label="Move route and service status">
        <strong>{vehicle.homeStore} → {transfer.destination ?? transfer.requestingStore ?? 'Destination not set'}</strong>
        <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} />
      </div>

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
            <strong>Vehicle issue reported · home store review required</strong>
            <span>{latestConditionIssue.detail || 'Open the handoff history for the recorded condition details.'}</span>
            <small>Reported by {latestConditionIssue.actorLabel ?? 'staff'} · {formatDateTime(latestConditionIssue.occurredAt)}</small>
          </div>
        </div>
      ) : null}

      <section className={`mif-action-console is-${action.sla}`} aria-label="Next step">
        <div className="mif-action-console__copy">
          <span>Next step</span>
          <strong title={action.label}>{compactActionLabel(action.label, { homeStore: vehicle.homeStore, destination: transfer.destination ?? transfer.requestingStore })}</strong>
          <small>Owner: {action.ownerLabel ?? 'Not assigned'}{action.ownerRole ? ` · ${action.ownerRole}` : ''}</small>
        </div>
        <div className="mif-action-console__due">
          <CalendarClock aria-hidden="true" size={18} strokeWidth={1.75} />
          <span><strong>{formatDateTime(action.dueAt)}</strong><small>{slaLabel(action.sla)}</small></span>
        </div>

        {transfer.allowedActions.length > 0 ? (
          <footer className="mif-tracker-actions mif-tracker-actions--prominent" aria-label="Available move actions">
            {primaryAction ? (
              <button className="mif-button mif-button--primary" onClick={() => handleAction(primaryAction)} title={actionHint(primaryAction)} type="button">
                {transferActionLabels[primaryAction]}
              </button>
            ) : null}
            {issueAction ? (
              <button className="mif-button mif-button--condition" onClick={() => handleAction(issueAction)} title={actionHint(issueAction)} type="button">
                <Wrench aria-hidden="true" size={16} strokeWidth={1.75} />
                {transferActionLabels[issueAction]}
              </button>
            ) : null}
            {secondaryActions.length > 0 ? (
              <details className="mif-more-actions">
                <summary>More actions <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} /></summary>
                <div>
                  {secondaryActions.map((kind) => (
                    <button className="mif-more-action" key={kind} onClick={() => handleAction(kind)} title={actionHint(kind)} type="button">
                      {kind === 'open-source' ? <ExternalLink aria-hidden="true" size={16} strokeWidth={1.75} /> : null}
                      {kind === 'report-condition' ? <Wrench aria-hidden="true" size={16} strokeWidth={1.75} /> : null}
                      <span>{transferActionLabels[kind]}</span>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </footer>
        ) : null}
      </section>

      {vehicleLinks}
      {!directMove ? <TransferProgress transfer={transfer} /> : null}

      <div className="mif-tracker-overview-grid">
        <section className="mif-detail-block" aria-label={directMove ? 'Move and vehicle summary' : 'Request and vehicle summary'}>
          <h3>{directMove ? 'Move details' : 'Request details'}</h3>
          <div className="mif-tracker-request-summary">
            <div><span>Route</span><strong>{vehicle.homeStore} → {transfer.destination ?? transfer.requestingStore ?? 'Not set'}</strong></div>
            <div><span>{directMove ? 'Recorded by' : 'Requested by'}</span><strong>{transfer.requestedByLabel ?? 'Not provided'}</strong>{!directMove ? <small>{formatDateTime(transfer.requestedAt)}</small> : null}</div>
            <div><span>{directMove ? 'Moved at' : 'Needed by'}</span><strong>{formatDateTime(directMoveEvent?.occurredAt || transfer.neededBy)}</strong></div>
            <div><span>Vehicle</span><strong>{vehicle.listedPriceLabel ?? 'Price not published'}</strong><small>{vehicle.mileageLabel ?? 'Mileage not published'}</small></div>
            <div className="mif-tracker-request-summary__reason"><span>Reason / customer reference</span><strong>{transfer.requestReason ?? 'Not available in this access view'}</strong>{transfer.customerReference ? <small>{transfer.customerReference}</small> : null}</div>
          </div>
        </section>

        <section className="mif-detail-block" aria-label="Location and accountability">
          <h3>Location & responsibility</h3>
          <div className="mif-tracker-accountability">
            <div><span>Home store</span><strong>{vehicle.homeStore}</strong></div>
            <div><span>Current location</span><strong><MapPin aria-hidden="true" size={15} strokeWidth={1.75} /> {vehicle.currentLocation.label}</strong><small>{locationConfidenceLabel(vehicle.currentLocation.confidence)} · {formatDateTime(vehicle.currentLocation.confirmedAt)}</small></div>
            <div><span>{directMove ? 'Destination store' : 'Requesting store'}</span><strong>{transfer.destination ?? transfer.requestingStore ?? 'Not set'}</strong></div>
            {!directMove ? <div><span>Requesting-store approval owner</span><strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {transfer.approvalOwnerLabel ?? 'Not recorded'}</strong></div> : null}
            {!directMove ? <div><span>Home-store release authority</span><strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {vehicle.homeStore} used-car manager</strong><small>Availability is not inferred.</small></div> : null}
            <div><span>Current action owner</span><strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {action.ownerLabel ?? 'Not assigned'}</strong>{action.ownerRole ? <small>{action.ownerRole}</small> : null}</div>
            <div><span>Custodian</span><strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {transfer.custodianLabel ?? 'Not assigned'}</strong></div>
            <div><span>Driver</span><strong><UserRound aria-hidden="true" size={15} strokeWidth={1.75} /> {transfer.transportAssigneeLabel ?? 'Not set'}</strong></div>
            {!directMove ? <div><span>Pickup / next target</span><strong>{formatDateTime(action.dueAt)}</strong></div> : null}
            <div><span>Return due</span><strong>{returnPlan}</strong></div>
          </div>
        </section>
      </div>

      <section className="mif-outcome-separation" aria-label="Deal, delivery, movement, and return status">
        <header><strong>Current status</strong><span>Deal, delivery, movement, and return stay separate.</span></header>
        <div><span>Customer / deal</span><strong className={toneClass(transfer.status.deal.tone)}>{humanizeStatusLabel(transfer.status.deal.label)}</strong></div>
        <div><span>Delivery</span><strong className={toneClass(transfer.status.delivery.tone)}>{humanizeStatusLabel(transfer.status.delivery.label)}</strong></div>
        <div><span>Movement / custody</span><strong className={toneClass(transfer.status.movement.tone)}>{humanizeStatusLabel(transfer.status.movement.label)}</strong></div>
        <div><span>Return plan</span><strong>{returnPlan}</strong></div>
        <div><span>Hold</span><strong className={toneClass(transfer.status.dealerMail.tone)}>{humanizeStatusLabel(transfer.status.dealerMail.label)}</strong></div>
      </section>

      <section className="mif-tracker-section mif-tracker-history">
        <h3><ShieldAlert aria-hidden="true" size={17} strokeWidth={1.75} /> Activity & handoff history</h3>
        <TransferTimeline events={transfer.timeline} />
      </section>
    </article>
  );
}
