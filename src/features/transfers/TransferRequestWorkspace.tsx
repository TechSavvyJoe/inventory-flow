import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { useWorkspaceLifetime } from '../../lib/useWorkspaceLifetime';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
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
import { ServiceStatusLink } from '../inventory/ServiceStatusLink';
import './transfers.css';
import './transfer-vehicle-context.css';

export interface RouteSummary {
  originLabel: string;
  destinationLabel: string;
  distanceLabel?: string;
  estimatedDriveTimeLabel?: string;
}

export interface TransferRequestWorkspaceProps {
  workflowMode?: 'simple' | 'advanced';
  intent?: 'request' | 'direct';
  vehicle: TransferVehicleSummary | null;
  stores: SelectOption[];
  requesters: SelectOption[];
  managerApprovers: SelectOption[];
  defaultRequestingStore?: string;
  defaultDestinationStore?: string;
  defaultRequesterId?: string;
  defaultManagerApproverId?: string;
  routeSummary?: RouteSummary;
  onSubmit: (
    draft: TransferRequestDraft,
  ) => TransferRequestResult | void | Promise<TransferRequestResult | void>;
  onDraftChange?: (draft: TransferRequestDraft) => void;
  onCancel?: () => void;
  onViewRequest?: (requestId: string) => void;
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
    'intent' | 'defaultRequestingStore' | 'defaultDestinationStore' | 'defaultRequesterId' | 'defaultManagerApproverId'
  >,
): TransferRequestDraft {
  return {
    vin: vehicle?.vin ?? '',
    intent: props.intent ?? 'request',
    requestingStore: props.defaultRequestingStore ?? '',
    destinationStore: props.defaultDestinationStore ?? '',
    requesterId: props.defaultRequesterId ?? '',
    managerApproverId: props.defaultManagerApproverId ?? '',
    neededBy: '',
    movedAt: props.intent === 'direct' ? initialMovedAt(vehicle) : '',
    customerAppointmentAt: '',
    customerReference: '',
    reasonCode: 'customer-need',
    reasonDetail: '',
    priority: 'normal',
    returnRequired: true,
    targetReturnAt: '',
  };
}

function localDateTimeValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function confirmedLocationFloor(vehicle: TransferVehicleSummary | null): number | null {
  const confirmedAt = vehicle?.currentLocation.confirmedAt;
  if (!confirmedAt) return null;
  const parsed = new Date(confirmedAt).getTime();
  return Number.isFinite(parsed) ? parsed + 1_000 : null;
}

function initialMovedAt(vehicle: TransferVehicleSummary | null): string {
  const confirmedFloor = confirmedLocationFloor(vehicle) ?? Number.NEGATIVE_INFINITY;
  // datetime-local omits milliseconds. Round up so the rendered second stays
  // strictly later than the latest physical event, even within the same minute.
  const timestamp = Math.ceil(Math.max(Date.now(), confirmedFloor) / 1_000) * 1_000;
  return localDateTimeValue(new Date(timestamp));
}

function validateDraft(draft: TransferRequestDraft, vehicle: TransferVehicleSummary | null): Partial<Record<keyof TransferRequestDraft, string>> {
  const errors: Partial<Record<keyof TransferRequestDraft, string>> = {};
  const direct = draft.intent === 'direct';
  if (!direct && !draft.requestingStore) errors.requestingStore = 'Choose the store requesting the vehicle.';
  if (direct && !draft.destinationStore) errors.destinationStore = 'Choose where the vehicle is going.';
  if (!draft.requesterId) errors.requesterId = 'Choose the accountable requester.';
  if (!direct && !draft.managerApproverId) errors.managerApproverId = 'Choose the manager who will review this request.';
  if (direct && !draft.movedAt) errors.movedAt = 'Set when the vehicle moved.';
  const confirmedFloor = confirmedLocationFloor(vehicle);
  if (direct && draft.movedAt && confirmedFloor !== null) {
    const movedAt = new Date(draft.movedAt).getTime();
    if (Number.isFinite(movedAt) && movedAt < confirmedFloor) errors.movedAt = 'Moved at must be after the latest confirmed location update.';
  }
  if (!direct && !draft.neededBy) errors.neededBy = 'Set when the vehicle is needed.';
  if (!draft.reasonDetail?.trim()) errors.reasonDetail = direct ? 'Briefly record why this vehicle moved.' : 'Briefly tell your manager what is needed.';
  const movementStart = direct ? draft.movedAt : draft.neededBy;
  if (draft.targetReturnAt && movementStart) {
    const returnTime = new Date(draft.targetReturnAt).getTime();
    const startTime = new Date(movementStart).getTime();
    if (Number.isFinite(returnTime) && Number.isFinite(startTime) && returnTime <= startTime) {
      errors.targetReturnAt = direct
        ? 'Preferred return must be after the vehicle moved.'
        : 'Preferred return must be after the vehicle is needed.';
    }
  }
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
    onViewRequest,
    disabled = false,
    workflowMode = 'advanced',
    intent = 'request',
  } = props;
  const simple = workflowMode === 'simple';
  const direct = intent === 'direct';
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<TransferRequestDraft>(() => createInitialDraft(vehicle, props));
  const [errors, setErrors] = useState<Partial<Record<keyof TransferRequestDraft, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [edited, setEdited] = useState(false);
  const captureWorkspace = useWorkspaceLifetime(JSON.stringify([vehicle?.vin, intent, props.defaultRequestingStore, props.defaultDestinationStore, props.defaultRequesterId, props.defaultManagerApproverId]));
  const { confirmDiscard, markSaved } = useUnsavedChanges(edited && !submitted, { saving: submitting });
  const cancel = () => { if (confirmDiscard()) onCancel?.(); };
  const [submittedRequestId, setSubmittedRequestId] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | undefined>();
  const selectedRequester = requesters.find((option) => option.value === draft.requesterId);
  const selectedManager = managerApprovers.find((option) => option.value === draft.managerApproverId);
  const selectedStore = stores.find((option) => option.value === draft.requestingStore);
  const selectedDestination = stores.find((option) => option.value === draft.destinationStore);

  useEffect(() => {
    setDraft(createInitialDraft(vehicle, props));
    setEdited(false);
    setErrors({});
    setSubmitted(false);
    setSubmitting(false);
    setSubmittedRequestId(undefined);
    setSubmitError(undefined);
  }, [
    vehicle?.vin,
    props.defaultRequestingStore,
    props.defaultDestinationStore,
    props.defaultRequesterId,
    props.defaultManagerApproverId,
    props.intent,
  ]);

  function updateDraft(patch: Partial<TransferRequestDraft>) {
    setEdited(true);
    setDraft((current) => {
      const next = { ...current, ...patch, vin: vehicle?.vin ?? current.vin };
      onDraftChange?.(next);
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => delete next[key as keyof TransferRequestDraft]);
      if ('movedAt' in patch || 'neededBy' in patch) delete next.targetReturnAt;
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle || disabled || submitting) return;
    const nextDraft = { ...draft, vin: vehicle.vin };
    const nextErrors = validateDraft(nextDraft, vehicle);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      window.setTimeout(() => {
        const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        (firstInvalid ?? errorSummaryRef.current)?.focus();
      }, 0);
      return;
    }

    setSubmitting(true);
    setSubmitError(undefined);
    const isCurrentWorkspace = captureWorkspace();
    try {
      const result = await onSubmit(nextDraft);
      if (!isCurrentWorkspace()) return;
      setSubmittedRequestId(result?.requestId);
      markSaved();
      setSubmitted(true);
    } catch (error) {
      if (!isCurrentWorkspace()) return;
      setSubmitError(error instanceof Error ? error.message : 'The request could not be submitted.');
    } finally {
      if (isCurrentWorkspace()) setSubmitting(false);
    }
  }

  if (!vehicle) {
    return (
      <section className="mif-transfer-feature mif-request-workspace mif-request-workspace--empty">
        <Route aria-hidden="true" size={28} strokeWidth={1.75} />
        <h1>Select a vehicle to move</h1>
        <p>Choose the stock number or VIN, then record where the vehicle is going.</p>
        {onCancel ? (
          <button className="mif-button mif-button--primary" onClick={cancel} type="button">
            Choose vehicle in Inventory
          </button>
        ) : null}
      </section>
    );
  }

  if (submitted) {
    return (
      <section className="mif-transfer-feature mif-request-confirmation" aria-live="polite">
        <CheckCircle2 aria-hidden="true" size={34} strokeWidth={1.75} />
        <h1>{direct ? 'Vehicle move recorded' : simple ? 'Request sent to your manager' : 'Movement request submitted'}</h1>
        <p>
          {direct
            ? `${vehicle.vehicleLabel} is now tracked from ${vehicle.currentLocation.label || vehicle.homeStore} to ${draft.destinationStore}. Record the customer outcome or start its return when the store is finished with it.`
            : simple
              ? `Your request is with the ${draft.requestingStore} manager. They will check with ${vehicle.homeStore} and approve it when available. Nothing is reserved until that confirmation.`
              : `No availability or release is confirmed. Your requesting-store manager must approve the request and contact the ${vehicle.homeStore} manager.`}
        </p>
        {submittedRequestId && onViewRequest ? <button className="mif-button mif-button--primary" onClick={() => onViewRequest(submittedRequestId)} type="button">View this move <ArrowRight aria-hidden="true" size={18} /></button> : onCancel ? (
          <button className="mif-button mif-button--primary" onClick={cancel} type="button">
            Done
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`mif-transfer-feature mif-request-workspace${simple ? ' move-request-simple' : ''}`} aria-labelledby={`${formId}-title`}>
      <header className="mif-request-header">
        <div className="mif-vehicle-heading">
          {vehicle.imageUrl ? <img alt="" src={vehicle.imageUrl} /> : null}
          <div>
            <h1 id={`${formId}-title`}>{vehicle.vehicleLabel}</h1>
            {vehicle.trimLabel && !vehicle.vehicleLabel.includes(vehicle.trimLabel) ? <p>{vehicle.trimLabel}</p> : null}
            <span>{vehicle.stock} · {vehicle.vin}</span>
          </div>
          <div className="move-vehicle-context">
            <p className="move-vehicle-value">{[vehicle.listedPriceLabel, vehicle.mileageLabel, vehicle.daysListed != null ? `${vehicle.daysListed} days listed` : null].filter(value => value && !/not published/i.test(value)).join(' · ')}</p>
            <p className="move-vehicle-specs">{[vehicle.exteriorColor, vehicle.engine, vehicle.drivetrain].filter(Boolean).join(' · ')}</p>
            <ServiceStatusLink vin={vehicle.vin} service={vehicle.serviceReadiness} />
          </div>
        </div>
        {onCancel ? (
          <button aria-label="Close request workspace" className="mif-icon-button" onClick={cancel} type="button">
            <X aria-hidden="true" size={20} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {simple && !direct ? <p className="move-request-current-location"><MapPin aria-hidden="true" size={16}/><strong>{vehicle.currentLocation.label}</strong><span>{locationConfidenceLabel(vehicle.currentLocation.confidence)}</span></p> : null}

      {simple ? <div className="move-request-route"><span><small>From</small><strong>{direct ? vehicle.currentLocation.label || vehicle.homeStore : vehicle.homeStore}</strong>{direct ? <small>{locationConfidenceLabel(vehicle.currentLocation.confidence)}</small> : null}</span><ArrowRight aria-hidden="true" size={20} /><span><small>{direct ? 'To' : 'To your store'}</small><strong>{direct ? selectedDestination?.label || draft.destinationStore || 'Choose destination' : selectedStore?.label || draft.requestingStore}</strong></span><p>{direct ? `Recorded by ${selectedRequester?.label || 'you'}` : `Requested by ${selectedRequester?.label || 'you'} · Reviewed by ${selectedManager?.label || `${draft.requestingStore} manager`}`}</p></div> : <div className="mif-request-source-strip">
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
      </div>}

      <form ref={formRef} className="mif-request-layout" onSubmit={handleSubmit} noValidate>
        <div className="mif-request-fields">
          <div className="mif-request-fields__heading">
            <div>
              <h3>{direct ? 'Move vehicle' : 'Request vehicle'}</h3>
              <p>{direct ? 'Choose the destination and record when the vehicle moved. This updates its operational location immediately.' : simple ? 'Tell your manager what you need and when. They check with the vehicle’s home store, then approve.' : 'Tell your manager what is needed and when. They approve first, then contact the Home Store.'}</p>
            </div>
          </div>

          {Object.keys(errors).length ? (
            <div ref={errorSummaryRef} className="mif-submit-error mif-form-error-summary" role="alert" tabIndex={-1}>
              <CircleAlert aria-hidden="true" size={17} strokeWidth={1.75} />
              <span><strong>Complete the highlighted request details.</strong><small>{Object.values(errors).join(' ')}</small></span>
            </div>
          ) : null}

          <div className="mif-form-grid">
            {direct ? <label className="mif-field mif-field--wide">
              <span>Destination store</span>
              <select
                aria-describedby={errors.destinationStore ? `${formId}-destination-error` : undefined}
                aria-invalid={Boolean(errors.destinationStore)}
                disabled={disabled || submitting}
                onChange={(event) => updateDraft({ destinationStore: event.target.value })}
                value={draft.destinationStore || ''}
              >
                <option value="">Choose a store</option>
                {stores.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {errors.destinationStore ? <small id={`${formId}-destination-error`} className="mif-field-error">{errors.destinationStore}</small> : null}
            </label> : null}

            {!simple ? <><div className="mif-field">
              <span>Your store</span>
              <span className="mif-readonly-field">
                {selectedStore?.label || draft.requestingStore || 'Not set'}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              {errors.requestingStore ? <small className="mif-field-error">{errors.requestingStore}</small> : null}
            </div>

            <div className="mif-field">
              <span>Home Store</span>
              <span className="mif-readonly-field">
                {vehicle.homeStore}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
            </div>

            <div className="mif-field">
              <span>Submitted by</span>
              <span className="mif-readonly-field">
                {selectedRequester?.label || 'Signed-in salesperson'}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              {errors.requesterId ? <small className="mif-field-error">{errors.requesterId}</small> : null}
            </div>

            <div className="mif-field">
              <span>Requesting-store manager</span>
              <span className="mif-readonly-field">
                {selectedManager?.label || `${draft.requestingStore || 'Your store'} manager`}
                <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.75} />
              </span>
              <small>{simple ? `Checks with ${vehicle.homeStore}, then approves this request.` : `Approves the request first, then contacts the ${vehicle.homeStore} manager.`}</small>
              {errors.managerApproverId ? <small className="mif-field-error">{errors.managerApproverId}</small> : null}
            </div></> : null}

            <label className="mif-field">
              <span>{direct ? 'Moved at' : 'Needed by'}</span>
              <input
                aria-describedby={direct ? errors.movedAt ? `${formId}-moved-at-error` : undefined : errors.neededBy ? `${formId}-needed-by-error` : undefined}
                aria-invalid={direct ? Boolean(errors.movedAt) : Boolean(errors.neededBy)}
                disabled={disabled || submitting}
                onChange={(event) => updateDraft(direct ? { movedAt: event.target.value } : { neededBy: event.target.value })}
                min={direct && confirmedLocationFloor(vehicle) !== null ? localDateTimeValue(new Date(confirmedLocationFloor(vehicle)!)) : undefined}
                step={direct ? 1 : 60}
                type="datetime-local"
                value={direct ? draft.movedAt || '' : draft.neededBy}
              />
              {direct && errors.movedAt ? <small id={`${formId}-moved-at-error`} className="mif-field-error">{errors.movedAt}</small> : null}
              {!direct && errors.neededBy ? <small id={`${formId}-needed-by-error`} className="mif-field-error">{errors.neededBy}</small> : null}
            </label>

            <label className="mif-field">
              <span>Reason</span>
              <select
                disabled={disabled || submitting}
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
                disabled={disabled || submitting}
                onChange={(event) => updateDraft({ priority: event.target.checked ? 'urgent' : 'normal' })}
                type="checkbox"
              />
              <span><strong>Customer is waiting now</strong><small>Flags the request for immediate manager attention.</small></span>
            </label>

            <label className="mif-field mif-field--wide">
              <span>{direct ? 'Why is it moving?' : 'What do you need?'}</span>
              <textarea
                aria-describedby={errors.reasonDetail ? `${formId}-reason-detail-error` : undefined}
                aria-invalid={Boolean(errors.reasonDetail)}
                disabled={disabled || submitting}
                onChange={(event) => updateDraft({ reasonDetail: event.target.value })}
                placeholder={direct ? 'Example: Detroit picked it up for a customer showing' : 'A short note for your manager'}
                rows={3}
                value={draft.reasonDetail}
              />
              {errors.reasonDetail ? <small id={`${formId}-reason-detail-error`} className="mif-field-error">{errors.reasonDetail}</small> : null}
            </label>

            <details className="mif-more-details mif-field--wide">
              <summary>{simple ? 'Optional details: return timing and customer reference' : 'Customer reference and preferred return timing'}</summary>
              <label className="mif-field">
                <span>Customer or CRM reference <small>Optional · manager access only</small></span>
                <input
                  disabled={disabled || submitting}
                  onChange={(event) => updateDraft({ customerReference: event.target.value })}
                  placeholder="CRM number or short reference"
                  type="text"
                  value={draft.customerReference}
                />
              </label>
              <label className="mif-field">
                <span>Preferred return by <small>Optional · if the vehicle does not sell</small></span>
                <input
                  aria-describedby={errors.targetReturnAt ? `${formId}-return-error` : undefined}
                  aria-invalid={Boolean(errors.targetReturnAt)}
                  disabled={disabled || submitting}
                  min={(direct ? draft.movedAt : draft.neededBy) || undefined}
                  onChange={(event) => updateDraft({ targetReturnAt: event.target.value })}
                  type="datetime-local"
                  value={draft.targetReturnAt}
                />
                {errors.targetReturnAt ? <small id={`${formId}-return-error`} className="mif-field-error">{errors.targetReturnAt}</small> : null}
              </label>
            </details>

            <div className="mif-auto-return-rule mif-field--wide">
              <strong>If the vehicle does not sell, it returns to its Home Store.</strong>
              <span>{direct ? 'The destination store records the outcome or starts the return; the home store confirms it is back.' : simple ? 'Record when it starts back and when the home store receives it.' : 'The app creates and tracks the return; the salesperson does not need to configure this.'}</span>
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
            <h3><ShieldCheck aria-hidden="true" size={17} strokeWidth={1.75} /> {direct ? 'What happens next' : simple ? 'What happens next' : 'Approval path'}</h3>
            <ol className="mif-accountability-list">
              {direct ? <>
                <li><span>1</span><b>Record the destination</b><small>The vehicle is immediately shown at {draft.destinationStore || 'the destination store'}.</small></li>
                <li><span>2</span><b>Work the vehicle</b><small>The destination store can record the showing or sale outcome.</small></li>
                <li><span>3</span><b>Sell or return</b><small>If it does not sell, start the return and confirm it back at {vehicle.homeStore}.</small></li>
              </> : simple ? <>
                <li><span>1</span><b>Send the request</b><small>Your {draft.requestingStore || 'store'} manager gets the vehicle and timing.</small></li>
                <li><span>2</span><b>Your manager checks and approves</b><small>They confirm availability with {vehicle.homeStore} and approve this move.</small></li>
                <li><span>3</span><b>Record the outcome or start the return</b><small>When the appointment is done, record the result or start the return. The home store confirms it is back.</small></li>
              </> : <>
              <li><span>1</span><b>Salesperson submits the request</b><small>{draft.requestingStore || 'Requesting store'} asks for the vehicle.</small></li>
              <li><span>2</span><b>Requesting-store manager approves</b><small>{selectedManager?.label || `${draft.requestingStore || 'Your store'} manager`} reviews the request first.</small></li>
              <li><span>3</span><b>Manager contacts Home Store and records its decision</b><small>The {vehicle.homeStore} manager grants or declines release; availability is not inferred.</small></li>
              <li><span>4</span><b>Only after release: assign a driver</b><small>Pickup and movement cannot begin before a recorded grant.</small></li>
              <li><span>5</span><b>Record sale outcome or return</b><small>Custody stays tracked until the vehicle is sold or received back home.</small></li>
              </>}
            </ol>
          </section>

          <div className="mif-safety-note">
            <CircleAlert aria-hidden="true" size={17} strokeWidth={1.75} />
            <p>
              {direct
                ? 'This records the manager-authorized move and changes the operational location. It does not mark the vehicle sold or delivered.'
                : 'Submitting creates a request only. It does not reserve the vehicle, confirm availability, or authorize pickup.'}
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
            <button className="mif-button mif-button--secondary" disabled={submitting} onClick={cancel} type="button">
              Cancel
            </button>
          ) : null}
          <button className="mif-button mif-button--primary" disabled={disabled || submitting} type="submit">
            {submitting ? <Clock3 aria-hidden="true" size={17} strokeWidth={1.75} /> : <CalendarClock aria-hidden="true" size={17} strokeWidth={1.75} />}
            {submitting ? (direct ? 'Recording…' : 'Sending…') : direct ? `Move to ${selectedDestination?.label || 'selected store'}` : 'Ask my manager'}
          </button>
        </footer>
      </form>
    </section>
  );
}
