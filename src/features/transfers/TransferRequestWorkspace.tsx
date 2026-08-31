import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LockKeyhole,
  MapPin,
  Route,
  ShieldCheck,
  Store,
  UserRound,
  X,
} from 'lucide-react';
import type {
  SelectOption,
  TransferReasonCode,
  TransferRequestDraft,
  TransferRequestResult,
  TransferVehicleSummary,
} from './types';
import { locationConfidenceLabel } from './presentation';
import './transfers.css';

export interface RouteSummary {
  originLabel: string;
  destinationLabel: string;
  distanceLabel?: string;
  estimatedDriveTimeLabel?: string;
}

export interface TransferRequestWorkspaceProps {
  vehicle: TransferVehicleSummary | null;
  stores: SelectOption[];
  requesters: SelectOption[];
  managerApprovers: SelectOption[];
  defaultRequestingStore?: string;
  defaultRequesterId?: string;
  defaultManagerApproverId?: string;
  routeSummary?: RouteSummary;
  onSubmit: (
    draft: TransferRequestDraft,
  ) => TransferRequestResult | void | Promise<TransferRequestResult | void>;
  onDraftChange?: (draft: TransferRequestDraft) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

const reasonOptions: Array<{ value: TransferReasonCode; label: string }> = [
  { value: 'customer-need', label: 'Customer needs this vehicle' },
  { value: 'manager-request', label: 'Manager / store need' },
  { value: 'other', label: 'Other reason' },
];

function createInitialDraft(
  vehicle: TransferVehicleSummary | null,
  props: Pick<
    TransferRequestWorkspaceProps,
    'defaultRequestingStore' | 'defaultRequesterId' | 'defaultManagerApproverId'
  >,
): TransferRequestDraft {
  return {
    vin: vehicle?.vin ?? '',
    requestingStore: props.defaultRequestingStore ?? '',
    requesterId: props.defaultRequesterId ?? '',
    managerApproverId: props.defaultManagerApproverId ?? '',
    neededBy: '',
    customerAppointmentAt: '',
    customerReference: '',
    reasonCode: 'customer-need',
    reasonDetail: '',
    priority: 'normal',
    returnRequired: true,
    targetReturnAt: '',
  };
}

function validateDraft(draft: TransferRequestDraft): Partial<Record<keyof TransferRequestDraft, string>> {
  const errors: Partial<Record<keyof TransferRequestDraft, string>> = {};
  if (!draft.requestingStore) errors.requestingStore = 'Choose the store requesting the vehicle.';
  if (!draft.requesterId) errors.requesterId = 'Choose the accountable requester.';
  if (!draft.managerApproverId) errors.managerApproverId = 'Choose the manager who will review this request.';
  if (!draft.neededBy) errors.neededBy = 'Set when the vehicle is needed.';
  if (!draft.reasonDetail?.trim()) errors.reasonDetail = 'Briefly tell your manager what is needed.';
  return errors;
}

export function TransferRequestWorkspace(props: TransferRequestWorkspaceProps) {
  const {
    vehicle,
    stores,
    requesters,
    managerApprovers,
    routeSummary,
    onSubmit,
    onDraftChange,
    onCancel,
    disabled = false,
  } = props;
  const formId = useId();
  const [draft, setDraft] = useState<TransferRequestDraft>(() => createInitialDraft(vehicle, props));
  const [errors, setErrors] = useState<Partial<Record<keyof TransferRequestDraft, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedRequestId, setSubmittedRequestId] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | undefined>();
  const selectedRequester = requesters.find((option) => option.value === draft.requesterId);
  const selectedManager = managerApprovers.find((option) => option.value === draft.managerApproverId);
  const selectedStore = stores.find((option) => option.value === draft.requestingStore);

  useEffect(() => {
    setDraft(createInitialDraft(vehicle, props));
    setErrors({});
    setSubmitted(false);
    setSubmittedRequestId(undefined);
    setSubmitError(undefined);
  }, [
    vehicle?.vin,
    props.defaultRequestingStore,
    props.defaultRequesterId,
    props.defaultManagerApproverId,
  ]);

  function updateDraft(patch: Partial<TransferRequestDraft>) {
    setDraft((current) => {
      const next = { ...current, ...patch, vin: vehicle?.vin ?? current.vin };
      onDraftChange?.(next);
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[key as keyof TransferRequestDraft]);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle || disabled) return;
    const nextDraft = { ...draft, vin: vehicle.vin };
    const nextErrors = validateDraft(nextDraft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const result = await onSubmit(nextDraft);
      setSubmittedRequestId(result?.requestId);
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The request could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!vehicle) {
    return (
      <section className="mif-transfer-feature mif-request-workspace mif-request-workspace--empty">
        <Route aria-hidden="true" size={28} strokeWidth={1.75} />
        <h2>Select a vehicle to request</h2>
        <p>The request will preserve the vehicle’s Home Store and create an internal movement record only.</p>
      </section>
    );
  }

  if (submitted) {
    return (
      <section className="mif-transfer-feature mif-request-confirmation" aria-live="polite">
        <CheckCircle2 aria-hidden="true" size={34} strokeWidth={1.75} />
        <h2>Movement request submitted</h2>
        <p>
          The vehicle has not been marked available, sold, delivered, or changed in DealerMail or CDK.
          Your manager must confirm availability and release with the home-store used-car manager.
        </p>
        {submittedRequestId ? <strong>Request {submittedRequestId}</strong> : null}
        {onCancel ? (
          <button className="mif-button mif-button--primary" onClick={onCancel} type="button">
            Done
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mif-transfer-feature mif-request-workspace" aria-labelledby={`${formId}-title`}>
      <header className="mif-request-header">
        <div className="mif-vehicle-heading">
          {vehicle.imageUrl ? <img alt="" src={vehicle.imageUrl} /> : null}
          <div>
            <h2 id={`${formId}-title`}>{vehicle.vehicleLabel}</h2>
            {vehicle.trimLabel ? <p>{vehicle.trimLabel}</p> : null}
            <span>{vehicle.stock} · {vehicle.vin}</span>
          </div>
        </div>
        {onCancel ? (
          <button aria-label="Close request workspace" className="mif-icon-button" onClick={onCancel} type="button">
            <X aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      <div className="mif-request-source-strip">
        <div>
          <Store aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>Home Store</span>
          <strong>{vehicle.homeStore}</strong>
        </div>
        <div>
          <MapPin aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>Current location</span>
          <strong>{vehicle.currentLocation.label}</strong>
          <small>{locationConfidenceLabel(vehicle.currentLocation.confidence)}</small>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>Availability</span>
          <strong>Confirm with home store</strong>
          <small>Availability not confirmed</small>
        </div>
      </div>

      <form className="mif-request-layout" onSubmit={handleSubmit}>
        <div className="mif-request-fields">
          <div className="mif-request-fields__heading">
            <div>
              <h3>Request vehicle</h3>
              <p>Tell your manager what is needed and when. The return rule is automatic.</p>
            </div>
          </div>

          <div className="mif-form-grid">
            <label className="mif-field">
              <span>Your store</span>
              <span className="mif-readonly-field">
                {selectedStore?.label || draft.requestingStore || 'Not set'}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              {errors.requestingStore ? <small className="mif-field-error">{errors.requestingStore}</small> : null}
            </label>

            <label className="mif-field">
              <span>Home Store</span>
              <span className="mif-readonly-field">
                {vehicle.homeStore}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
            </label>

            <label className="mif-field">
              <span>Submitted by</span>
              <span className="mif-readonly-field">
                {selectedRequester?.label || 'Signed-in salesperson'}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              {errors.requesterId ? <small className="mif-field-error">{errors.requesterId}</small> : null}
            </label>

            <label className="mif-field">
              <span>Goes first to</span>
              <span className="mif-readonly-field">
                {selectedManager?.label || `${draft.requestingStore || 'Your store'} manager`}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              {errors.managerApproverId ? <small className="mif-field-error">{errors.managerApproverId}</small> : null}
            </label>

            <label className="mif-field">
              <span>Needed by</span>
              <input
                aria-invalid={Boolean(errors.neededBy)}
                disabled={disabled}
                onChange={(event) => updateDraft({ neededBy: event.target.value })}
                type="datetime-local"
                value={draft.neededBy}
              />
              {errors.neededBy ? <small className="mif-field-error">{errors.neededBy}</small> : null}
            </label>

            <label className="mif-field">
              <span>Reason</span>
              <select
                disabled={disabled}
                onChange={(event) => updateDraft({ reasonCode: event.target.value as TransferReasonCode })}
                value={draft.reasonCode}
              >
                {reasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="mif-check-field">
              <input
                checked={draft.priority === 'urgent'}
                disabled={disabled}
                onChange={(event) => updateDraft({ priority: event.target.checked ? 'urgent' : 'normal' })}
                type="checkbox"
              />
              <span><strong>Customer is waiting now</strong><small>Flags the request for immediate manager attention.</small></span>
            </label>

            <label className="mif-field mif-field--wide">
              <span>What do you need?</span>
              <textarea
                aria-invalid={Boolean(errors.reasonDetail)}
                disabled={disabled}
                onChange={(event) => updateDraft({ reasonDetail: event.target.value })}
                placeholder="A short note for your manager"
                rows={3}
                value={draft.reasonDetail}
              />
              {errors.reasonDetail ? <small className="mif-field-error">{errors.reasonDetail}</small> : null}
            </label>

            <details className="mif-more-details mif-field--wide">
              <summary>More details</summary>
              <label className="mif-field">
                <span>Customer or CRM reference <small>Optional · manager access only</small></span>
                <input
                  disabled={disabled}
                  onChange={(event) => updateDraft({ customerReference: event.target.value })}
                  placeholder="CRM number or short reference"
                  type="text"
                  value={draft.customerReference}
                />
              </label>
            </details>

            <div className="mif-auto-return-rule mif-field--wide">
              <strong>If the vehicle does not sell, it returns to its Home Store.</strong>
              <span>The app creates and tracks the return; the salesperson does not need to configure this.</span>
            </div>
          </div>
        </div>

        <aside className="mif-request-review" aria-label="Request accountability preview">
          {routeSummary ? (
            <section>
              <h3><Route aria-hidden="true" size={17} strokeWidth={1.75} /> Route summary</h3>
              <strong className="mif-route-line">
                {routeSummary.originLabel}
                <ArrowRight aria-hidden="true" size={16} strokeWidth={1.75} />
                {routeSummary.destinationLabel}
              </strong>
              {routeSummary.distanceLabel ? <span>Distance <b>{routeSummary.distanceLabel}</b></span> : null}
              {routeSummary.estimatedDriveTimeLabel ? <span>Drive time <b>{routeSummary.estimatedDriveTimeLabel}</b></span> : null}
            </section>
          ) : null}

          <section>
            <h3><ShieldCheck aria-hidden="true" size={17} strokeWidth={1.75} /> Accountability preview</h3>
            <ol className="mif-accountability-list">
              <li><span>1</span><b>Ask your manager</b><small>{selectedManager?.label || `${draft.requestingStore || 'Your store'} manager`}</small></li>
              <li><span>2</span><b>Confirm with home store</b><small>{vehicle.homeStore} used-car manager</small></li>
               <li><span>3</span><b>Call for a driver</b><small>{draft.requestingStore === 'Howell' ? 'Salesperson usually calls Stacey' : `${draft.requestingStore || 'Requesting store'} manager or coordinator`}</small></li>
              <li><span>4</span><b>Receive and show</b><small>{draft.requestingStore || 'Requesting store'}</small></li>
              <li><span>5</span><b>Sell or return</b><small>Outcome and return are recorded separately</small></li>
            </ol>
          </section>

          <div className="mif-safety-note">
            <CircleAlert aria-hidden="true" size={17} strokeWidth={1.75} />
            <p>
              Submitting creates an internal movement request. It does not change DealerMail or CDK,
              reserve the vehicle, or prove a sale or delivery.
            </p>
          </div>
        </aside>

        {submitError ? (
          <div className="mif-submit-error" role="alert">
            <CircleAlert aria-hidden="true" size={17} strokeWidth={1.75} />
            {submitError}
          </div>
        ) : null}

        <footer className="mif-request-actions">
          {onCancel ? (
            <button className="mif-button mif-button--secondary" disabled={submitting} onClick={onCancel} type="button">
              Cancel
            </button>
          ) : null}
          <button className="mif-button mif-button--primary" disabled={disabled || submitting} type="submit">
            {submitting ? <Clock3 aria-hidden="true" size={17} strokeWidth={1.75} /> : <CalendarClock aria-hidden="true" size={17} strokeWidth={1.75} />}
            {submitting ? 'Sending…' : 'Ask my manager'}
          </button>
        </footer>
      </form>
    </section>
  );
}
