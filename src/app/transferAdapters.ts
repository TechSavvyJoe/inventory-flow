import type {
  CdkStatusCode,
  DealStatusCode,
  DealerMailHoldCode,
  DeliveryStatusCode,
  ExplicitStatus,
  MovementStatusCode,
  PublicStatusCode,
  RequestStatusCode,
  SlaState,
  StatusTone,
  TransferActionKind,
  TransferDetail,
  TransferStatusLanes,
  TransferVehicleSummary,
} from '../features/transfers'
import { formatCurrency, formatNumber } from '../lib/format'
import type { PublicListingCode, SourceMeta, TransferRecord, UserRole, VehicleRecord } from '../types'

function code(value: string): string {
  return value.toLowerCase().trim().replace(/[_\s/]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function explicit<T extends string>(
  statusCode: T,
  label: string,
  tone: StatusTone = 'neutral',
  detail?: string,
): ExplicitStatus<T> {
  return { code: statusCode, label, tone, detail }
}

function requestStatus(value: string): ExplicitStatus<RequestStatusCode> {
  const normalized = code(value)
  const mapped: RequestStatusCode =
    normalized === 'manager-reviewed'
      ? 'manager-reviewed'
      : normalized === 'needs-information'
      ? 'needs-information'
      : normalized === 'approved'
        ? 'approved'
        : normalized === 'declined'
          ? 'declined'
          : normalized === 'canceled'
            ? 'canceled'
            : normalized === 'expired'
              ? 'expired'
              : normalized === 'closed'
                ? 'closed'
                : normalized === 'draft'
                  ? 'draft'
                  : 'submitted'
  const label =
    mapped === 'submitted'
      ? 'Waiting on my manager'
      : mapped === 'manager-reviewed'
        ? 'Waiting on home-store used-car manager'
        : mapped === 'approved'
          ? 'Home-store release confirmed'
          : mapped === 'declined'
            ? 'Not available / declined'
            : value || 'Submitted'
  return explicit(mapped, label, mapped === 'approved' ? 'success' : mapped === 'declined' ? 'danger' : 'info')
}

function movementStatus(value: string): ExplicitStatus<MovementStatusCode> {
  const normalized = code(value)
  const mapped: MovementStatusCode =
    normalized.includes('return') && normalized.includes('transit')
      ? 'in-transit-return'
      : normalized.includes('returned') && normalized.includes('confirmed')
        ? 'returned-home-confirmed'
        : normalized.includes('returned')
          ? 'returned-awaiting-receipt'
          : normalized.includes('return') && normalized.includes('scheduled')
            ? 'return-scheduled'
            : normalized.includes('return')
              ? 'return-required'
              : normalized.includes('unknown')
                ? 'location-unknown'
                : normalized.includes('exception')
                  ? 'location-exception'
                  : normalized.includes('arriv') || normalized.includes('requesting-store')
                    ? 'at-requesting-store-verified'
                    : normalized.includes('transit')
                      ? 'in-transit-outbound'
                      : normalized.includes('pickup') && normalized.includes('scheduled')
                        ? 'pickup-scheduled'
                        : normalized.includes('pickup') || normalized.includes('released')
                          ? 'released-to-custodian'
                          : normalized.includes('approved')
                            ? 'release-approved'
                            : normalized.includes('closed')
                              ? 'movement-closed'
                              : 'at-home-verified'
  const tone: StatusTone = mapped.includes('exception') || mapped.includes('unknown') ? 'danger' : mapped.includes('transit') ? 'info' : 'location'
  return explicit(mapped, value || 'At home store — reported', tone)
}

// The server's deal_status column values (server/workflow.mjs). Anything else
// is an outcome the server never recorded, so it reads as no outcome.
const DEAL_STATUS_CODES: Readonly<Record<string, DealStatusCode>> = {
  not_confirmed: 'no-outcome',
  customer_showing: 'show-in-progress',
  pending_confirmation: 'decision-pending',
  sold_pending: 'sold-pending',
  not_sold: 'shown-not-sold',
}

function dealStatus(value: string): ExplicitStatus<DealStatusCode> {
  const mapped: DealStatusCode = Object.hasOwn(DEAL_STATUS_CODES, value) ? DEAL_STATUS_CODES[value] : 'no-outcome'
  const label = mapped === 'sold-pending' ? 'Sold pending — delivery not confirmed' : value || 'No customer outcome'
  return explicit(mapped, label, mapped === 'shown-not-sold' ? 'warning' : mapped === 'sold-pending' ? 'info' : 'neutral')
}

function deliveryStatus(value: string): ExplicitStatus<DeliveryStatusCode> {
  const normalized = code(value)
  const mapped: DeliveryStatusCode = normalized.includes('confirmed') && !normalized.includes('not') ? 'confirmed' : normalized.includes('cancel') ? 'canceled' : normalized.includes('unknown') ? 'unknown' : 'not-confirmed'
  return explicit(mapped, value || 'Delivery not confirmed', mapped === 'confirmed' ? 'success' : 'neutral')
}

function dealerMailStatus(value: string): ExplicitStatus<DealerMailHoldCode> {
  const normalized = code(value)
  const mapped: DealerMailHoldCode = normalized.includes('primary') ? 'primary' : normalized.includes('backup') ? 'backup' : normalized.includes('multiple') ? 'multiple' : normalized.includes('stale') ? 'stale' : normalized.includes('none') || normalized.includes('not-observed') ? 'not-observed' : 'unknown'
  return explicit(mapped, value || 'Unknown', mapped === 'primary' || mapped === 'backup' || mapped === 'multiple' ? 'warning' : 'neutral')
}

// Switches on the server's public-listing code; the label is display text only.
function publicStatus(
  listing: PublicListingCode | undefined,
  label: string,
  freshness: SourceMeta['publicFreshness'],
): ExplicitStatus<PublicStatusCode> {
  const mapped: PublicStatusCode =
    freshness === 'incomplete'
      ? 'source-incomplete'
      : freshness === 'stale_unverified' || listing === 'stale'
        ? 'retained-stale'
        : listing === 'listed'
          ? 'listed'
          : listing === 'pre_listing' || listing === 'not_in_release'
            ? 'not-found'
            : 'status-not-provided'
  return explicit(mapped, label || 'Website status not provided', mapped === 'listed' ? 'info' : mapped === 'source-incomplete' ? 'danger' : 'neutral')
}

function cdkStatus(value: string): ExplicitStatus<CdkStatusCode> {
  const normalized = code(value)
  const mapped: CdkStatusCode = normalized.includes('not-checked') || !normalized ? 'not-checked' : normalized.includes('processing') ? 'processing' : normalized.includes('closed') ? 'closed' : normalized.includes('open') ? 'open' : normalized.includes('exception') ? 'exception' : 'raw'
  return explicit(mapped, value || 'Not checked', mapped === 'exception' ? 'danger' : 'neutral', mapped === 'raw' ? 'Raw source value retained; business meaning not inferred.' : undefined)
}

function sla(dueAt?: string): SlaState {
  if (!dueAt) return 'none'
  const delta = new Date(dueAt).getTime() - Date.now()
  if (delta < -60 * 60 * 1000) return 'breached'
  if (delta < 0) return 'overdue'
  if (delta < 60 * 60 * 1000) return 'due-soon'
  return 'on-track'
}

export function toTransferVehicle(vehicle: VehicleRecord, meta: SourceMeta): TransferVehicleSummary {
  return {
    vin: vehicle.vin,
    stock: vehicle.stockNumber,
    vehicleLabel: vehicle.vehicleName,
    trimLabel: vehicle.trim,
    imageUrl: vehicle.imageUrl || vehicle.imageUrls?.[0] || undefined,
    imageUrls: vehicle.imageUrls ?? (vehicle.imageUrl ? [vehicle.imageUrl] : []),
    homeStore: vehicle.homeStore,
    currentLocation: {
      label: vehicle.movement.currentLocation || vehicle.sourceReportedLocation,
      type: 'store',
      confidence: vehicle.movement.locationConfidence,
      confirmedAt: vehicle.movement.lastConfirmedAt || meta.completedAt,
      confirmedBy: vehicle.movement.currentCustodian,
    },
    listedPriceLabel: formatCurrency(vehicle.listedPrice),
    mileageLabel: vehicle.mileage == null ? 'Mileage not published' : `${formatNumber(vehicle.mileage)} mi`,
    exteriorColor: vehicle.exteriorColor,
    engine: vehicle.engine,
    drivetrain: vehicle.drivetrain,
    daysListed: vehicle.daysListed,
    listingUrl: vehicle.listingUrl,
    serviceReadiness: vehicle.serviceReadiness,
    status: {
      dealerMail: dealerMailStatus(vehicle.hold.label),
      publicListing: publicStatus(vehicle.publicListing, vehicle.publicListingState, meta.publicFreshness),
      cdk: cdkStatus('Not checked'),
    },
  }
}

export function transferStatusLanes(transfer: TransferRecord, meta: SourceMeta): TransferStatusLanes {
  const request = requestStatus(transfer.requestStatus)
  if (transfer.workflowMode === 'simple' && request.code === 'approved') request.label = 'Approved for this move'
  return {
    request,
    movement: transfer.workflowMode === 'simple' && code(transfer.movementStatus) === 'returned-home'
      ? explicit('returned-home-confirmed', 'Back at home store', 'location')
      : movementStatus(transfer.movementStatus),
    deal: dealStatus(transfer.dealStatus),
    delivery: deliveryStatus(transfer.deliveryStatus),
    dealerMail: dealerMailStatus(transfer.dealerMailHoldState),
    publicListing: publicStatus(transfer.publicListing, transfer.publicListingState, meta.publicFreshness),
    cdk: cdkStatus(transfer.cdkStatus),
  }
}

const ACTION_KINDS = new Set<TransferActionKind>([
  'review-request',
  'approve',
  'decline',
  'edit-request',
  'request-driver',
  'assign-transport',
  'confirm-pickup',
  'confirm-arrival',
  'record-outcome',
  'schedule-return',
  'confirm-return',
  'mark-exception',
  'report-condition',
  'escalate',
  'open-source',
  'close',
])

function allowedActions(transfer: TransferRecord, role?: UserRole): TransferActionKind[] {
  if (transfer.allowedActions) {
    return transfer.allowedActions.filter((action): action is TransferActionKind => ACTION_KINDS.has(action as TransferActionKind))
  }
  const request = code(transfer.requestStatus)
  const manager = role === 'manager' || role === 'group_manager'
  const coordinator = role === 'coordinator'
  const transporter = role === 'porter' || role === 'driver'
  const appendOperational = (actions: TransferActionKind[]) =>
    request === 'closed' ? actions : [...actions, 'report-condition', 'mark-exception', 'escalate'] as TransferActionKind[]
  if (request === 'requested') return appendOperational(manager ? ['review-request', 'decline'] : [])
  if (request === 'manager-reviewed') return appendOperational(manager ? ['approve', 'decline'] : [])
  if (request === 'approved') return appendOperational(manager || coordinator ? ['assign-transport', 'request-driver'] : role === 'sales' ? ['request-driver'] : [])
  if (request === 'transport-assigned') return appendOperational(manager || transporter ? ['confirm-pickup'] : [])
  if (request === 'picked-up' || request === 'in-transit') return appendOperational(manager || transporter ? ['confirm-arrival'] : [])
  if (['arrived', 'customer-showing', 'sale-outcome-pending'].includes(request)) {
    return appendOperational(transporter || coordinator ? [] : ['record-outcome', 'schedule-return'])
  }
  if (request === 'sale-confirmed') return appendOperational(manager ? ['record-outcome'] : [])
  if (request === 'delivery-confirmed') return manager ? ['close', 'open-source'] : ['open-source']
  if (request === 'not-sold') return appendOperational(transporter || coordinator ? [] : ['schedule-return'])
  if (request === 'return-requested') return appendOperational(manager || coordinator ? ['assign-transport'] : [])
  if (request === 'return-assigned') return appendOperational(manager || transporter ? ['confirm-pickup'] : [])
  if (request === 'return-in-transit') return appendOperational(manager ? ['confirm-return'] : [])
  if (request === 'returned-home') return manager ? ['close', 'open-source'] : ['open-source']
  return ['open-source']
}

export function toTransferDetail(
  transfer: TransferRecord,
  vehicle: VehicleRecord | undefined,
  meta: SourceMeta,
  role?: UserRole,
): TransferDetail {
  const fallbackVehicle: TransferVehicleSummary = vehicle
    ? toTransferVehicle(vehicle, meta)
    : {
        vin: transfer.vin,
        stock: transfer.stockNumber,
        vehicleLabel: transfer.vehicleName,
        homeStore: transfer.homeStore,
        currentLocation: {
          label: transfer.currentLocation,
          confidence: transfer.locationConfidence,
          confirmedAt: transfer.lastConfirmedAt,
        },
        status: {
          dealerMail: dealerMailStatus(transfer.dealerMailHoldState),
          publicListing: publicStatus(transfer.publicListing, transfer.publicListingState, meta.publicFreshness),
          cdk: cdkStatus(transfer.cdkStatus),
        },
      }

  return {
    id: transfer.id,
    workflowMode: transfer.workflowMode,
    vehicle: {
      ...fallbackVehicle,
      currentLocation: {
        ...fallbackVehicle.currentLocation,
        label: transfer.currentLocation || fallbackVehicle.currentLocation.label,
        confidence: transfer.locationConfidence,
        confirmedAt: transfer.lastConfirmedAt || fallbackVehicle.currentLocation.confirmedAt,
      },
    },
    requestingStore: transfer.requestingStore,
    destination: transfer.destination,
    priority: transfer.priority === 'urgent' ? 'critical' : transfer.priority,
    requestedByLabel: transfer.requestedBy,
    requestReason: transfer.privateEvidence?.requestReason,
    customerReference: transfer.privateEvidence?.customerReference,
    approvalOwnerLabel: transfer.privateEvidence?.approvalOwner,
    requestedAt: transfer.requestedAt,
    neededBy: transfer.dueAt,
    custodianLabel: transfer.custodian,
    transportAssigneeLabel: transfer.transportAssignee,
    returnRequired: transfer.returnRequired,
    returnDueAt: transfer.returnDueAt,
    nextAction: {
      label: transfer.nextAction || 'Manager review',
      ownerLabel: transfer.nextActionOwner || 'Manager',
      dueAt: transfer.dueAt,
      sla: sla(transfer.dueAt),
    },
    exception:
      transfer.locationConfidence === 'conflicting' || transfer.locationConfidence === 'unknown'
        ? {
            kind: 'location',
            label: transfer.locationConfidence === 'unknown' ? 'Physical location unknown' : 'Location evidence conflicts',
            severity: 'critical',
            detail: 'Confirm the vehicle and custodian before another movement is approved.',
          }
        : undefined,
    status: transferStatusLanes(transfer, meta),
    timeline: transfer.events.map((event) => ({
      id: event.id,
      kind: event.type,
      title: event.label,
      occurredAt: event.occurredAt,
      location: event.toLocation || event.store,
      fromLocation: event.fromLocation,
      actorLabel: event.actor,
      actorRole: event.actorRole,
      source: 'app',
      detail: event.confirmedBy && event.confirmedBy !== event.actor
        ? `Home Store decision by ${event.confirmedBy}${event.note ? ` · ${event.note}` : ''}`
        : event.note,
      exception: event.type.includes('exception'),
    })),
    allowedActions: allowedActions(transfer, role),
  }
}
