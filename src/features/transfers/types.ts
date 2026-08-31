export type StoreName =
  | 'Howell'
  | 'Fowlerville'
  | 'Ford Detroit'
  | 'Lincoln'
  | (string & {});

export type StatusTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'location';

export interface ExplicitStatus<TCode extends string = string> {
  code: TCode;
  label: string;
  detail?: string;
  tone?: StatusTone;
  observedAt?: string;
  stale?: boolean;
}

export type RequestStatusCode =
  | 'draft'
  | 'submitted'
  | 'manager-reviewed'
  | 'needs-information'
  | 'approved'
  | 'declined'
  | 'canceled'
  | 'expired'
  | 'closed';

export type MovementStatusCode =
  | 'at-home-verified'
  | 'release-approved'
  | 'pickup-scheduled'
  | 'released-to-custodian'
  | 'in-transit-outbound'
  | 'at-requesting-store-verified'
  | 'at-authorized-location'
  | 'return-required'
  | 'return-scheduled'
  | 'in-transit-return'
  | 'returned-awaiting-receipt'
  | 'returned-home-confirmed'
  | 'location-exception'
  | 'location-unknown'
  | 'movement-closed';

export type DealStatusCode =
  | 'no-outcome'
  | 'appointment-scheduled'
  | 'show-in-progress'
  | 'decision-pending'
  | 'shown-not-sold'
  | 'deal-in-progress'
  | 'sold-pending'
  | 'deal-canceled'
  | 'paperwork-complete';

export type DeliveryStatusCode =
  | 'not-confirmed'
  | 'confirmed'
  | 'canceled'
  | 'unknown';

export type DealerMailHoldCode =
  | 'not-observed'
  | 'primary'
  | 'backup'
  | 'multiple'
  | 'stale'
  | 'unknown';

export type PublicStatusCode =
  | 'listed'
  | 'not-found'
  | 'retained-stale'
  | 'source-incomplete'
  | 'status-not-provided';

export type CdkStatusCode =
  | 'not-checked'
  | 'open'
  | 'processing'
  | 'closed'
  | 'exception'
  | 'raw';

export type DealerOnFlagCode = 'yes' | 'no' | 'unknown' | 'not-published';

export type LocationConfidence =
  | 'verified'
  | 'reported'
  | 'stale'
  | 'conflicting'
  | 'unknown';

export type SlaState =
  | 'none'
  | 'on-track'
  | 'due-soon'
  | 'overdue'
  | 'breached';

export type TransferActionKind =
  | 'review-request'
  | 'approve'
  | 'decline'
  | 'edit-request'
  | 'request-driver'
  | 'assign-transport'
  | 'confirm-pickup'
  | 'confirm-arrival'
  | 'record-outcome'
  | 'schedule-return'
  | 'confirm-return'
  | 'mark-exception'
  | 'report-condition'
  | 'escalate'
  | 'open-source'
  | 'close';

export interface LocationSnapshot {
  label: string;
  type?: 'store' | 'service' | 'body-shop' | 'customer' | 'transit' | 'other';
  confidence: LocationConfidence;
  confirmedAt?: string;
  confirmedBy?: string;
  distanceLabel?: string;
}

export interface TransferStatusLanes {
  request: ExplicitStatus<RequestStatusCode>;
  movement: ExplicitStatus<MovementStatusCode>;
  deal: ExplicitStatus<DealStatusCode>;
  delivery: ExplicitStatus<DeliveryStatusCode>;
  dealerMail: ExplicitStatus<DealerMailHoldCode>;
  publicListing: ExplicitStatus<PublicStatusCode>;
  dealerOnInStock?: ExplicitStatus<DealerOnFlagCode>;
  dealerOnInTransit?: ExplicitStatus<DealerOnFlagCode>;
  dealerOnInProduction?: ExplicitStatus<DealerOnFlagCode>;
  cdk: ExplicitStatus<CdkStatusCode>;
}

export interface NextAction {
  label: string;
  ownerLabel?: string;
  ownerRole?: string;
  ownerId?: string;
  dueAt?: string;
  sla: SlaState;
}

export interface TransferException {
  kind: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  detail?: string;
}

export interface TransferTimelineEvent {
  id: string;
  kind: string;
  title: string;
  occurredAt: string;
  location?: string;
  actorLabel?: string;
  actorRole?: string;
  custodianLabel?: string;
  transportAssigneeLabel?: string;
  source?: 'app' | 'public' | 'dealermail' | 'cdk' | 'system' | (string & {});
  detail?: string;
  exception?: boolean;
}

export interface TransferVehicleSummary {
  vin: string;
  stock: string;
  vehicleLabel: string;
  trimLabel?: string;
  imageUrl?: string;
  homeStore: StoreName;
  currentLocation: LocationSnapshot;
  listedPriceLabel?: string;
  mileageLabel?: string;
  listingUrl?: string;
  status: Pick<TransferStatusLanes, 'dealerMail' | 'publicListing' | 'cdk'> &
    Partial<
      Pick<
        TransferStatusLanes,
        | 'request'
        | 'movement'
        | 'deal'
        | 'delivery'
        | 'dealerOnInStock'
        | 'dealerOnInTransit'
        | 'dealerOnInProduction'
      >
    >;
}

export interface TransferDetail {
  id: string;
  vehicle: TransferVehicleSummary;
  requestingStore?: StoreName;
  destination?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  requestedByLabel?: string;
  requestReason?: string;
  customerReference?: string;
  approvalOwnerLabel?: string;
  requestedAt?: string;
  neededBy?: string;
  custodianLabel?: string;
  transportAssigneeLabel?: string;
  returnRequired?: boolean;
  returnDueAt?: string;
  nextAction: NextAction;
  exception?: TransferException;
  status: TransferStatusLanes;
  timeline: TransferTimelineEvent[];
  /** Actions are authorization- and state-aware values supplied by the server. */
  allowedActions: TransferActionKind[];
}

export interface SelectOption {
  value: string;
  label: string;
  secondaryLabel?: string;
}

export type TransferReasonCode =
  | 'customer-need'
  | 'manager-request'
  | 'other';

export interface TransferRequestDraft {
  vin: string;
  requestingStore: string;
  requesterId: string;
  managerApproverId: string;
  neededBy: string;
  customerAppointmentAt?: string;
  customerReference?: string;
  reasonCode: TransferReasonCode;
  reasonDetail?: string;
  priority: 'normal' | 'high' | 'urgent';
  returnRequired: boolean;
  targetReturnAt?: string;
}

export interface TransferRequestResult {
  requestId?: string;
}
