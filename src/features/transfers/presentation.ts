import { displayDate } from '../../lib/date-display';
import { slaLabel as slaStatus } from '../../lib/sla-label';
import type {
  LocationConfidence,
  SlaState,
  StatusTone,
  TransferActionKind,
} from './types';

export const transferActionLabels: Record<TransferActionKind, string> = {
  'review-request': 'Approve request',
  approve: 'Record the home store’s release',
  decline: 'Decline request',
  'edit-request': 'Edit request',
  'request-driver': 'Request driver',
  'assign-transport': 'Assign driver',
  'confirm-pickup': 'Mark vehicle collected',
  'confirm-arrival': 'Confirm arrival',
  'record-outcome': 'Record outcome',
  'schedule-return': 'Schedule return',
  'confirm-return': 'Confirm back home',
  'mark-exception': 'Report a location issue',
  'report-condition': 'Report a vehicle issue',
  escalate: 'Escalate',
  'open-source': 'Open original record',
  close: 'Close the move',
};

export const primaryTransferActions = new Set<TransferActionKind>([
  'review-request',
  'approve',
  'request-driver',
  'assign-transport',
  'confirm-pickup',
  'confirm-arrival',
  'record-outcome',
  'schedule-return',
  'confirm-return',
]);

export function toneClass(tone: StatusTone | undefined): string {
  return `mif-tone-${tone ?? 'neutral'}`;
}

export function humanizeStatusLabel(label: string): string {
  if (!label.includes('_')) return label;
  const words = label.trim().replace(/_+/g, ' ').toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : label;
}

/**
 * Group operations (src/features/manager) still imports this through the
 * transfers barrel. It is the shared src/lib/sla-label wording, not a second
 * vocabulary; delete it when that page is retired.
 */
export function slaLabel(sla: SlaState): string {
  return slaStatus({ sla }).label;
}

export function locationConfidenceLabel(confidence: LocationConfidence): string {
  switch (confidence) {
    case 'verified':
      return 'Verified';
    case 'reported':
      return 'Reported';
    case 'stale':
      return 'Stale';
    case 'conflicting':
      return 'Conflicting';
    default:
      return 'Unknown';
  }
}

export function formatDateTime(value?: string): string {
  return value ? displayDate(value, { time: true, timeZone: 'America/New_York' }) : 'Not set';
}
