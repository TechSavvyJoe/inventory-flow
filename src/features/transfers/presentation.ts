import type {
  LocationConfidence,
  SlaState,
  StatusTone,
  TransferActionKind,
} from './types';

export const transferActionLabels: Record<TransferActionKind, string> = {
  'review-request': 'Approve request',
  approve: 'Record home-store release',
  decline: 'Decline request',
  'edit-request': 'Edit request',
  'request-driver': 'Request driver',
  'assign-transport': 'Assign driver',
  'confirm-pickup': 'Confirm pickup',
  'confirm-arrival': 'Confirm arrival',
  'record-outcome': 'Record outcome',
  'schedule-return': 'Schedule return',
  'confirm-return': 'Confirm home receipt',
  'mark-exception': 'Report exception',
  'report-condition': 'Report vehicle issue',
  escalate: 'Escalate',
  'open-source': 'Open original record',
  close: 'Close movement',
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

export function slaLabel(sla: SlaState): string {
  switch (sla) {
    case 'on-track':
      return 'On track';
    case 'due-soon':
      return 'Due soon';
    case 'overdue':
      return 'Overdue';
    case 'breached':
      return 'SLA breached';
    default:
      return 'No due time';
  }
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
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}
