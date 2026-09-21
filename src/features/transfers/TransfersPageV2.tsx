import { TransfersPage } from './TransfersPage'

/** Premium routes retain the complete manager-led move workflow. */
export function TransfersPageV2() {
  return <TransfersPage />
}

interface CountdownResult {
  label: string;
  isOverdue: boolean;
  isDueSoon: boolean;
}

export function calculateCountdown(
  dueAt?: string | null,
  sla?: string,
  overdueFlag?: boolean,
): CountdownResult {
  const isFlaggedOverdue = overdueFlag || sla === 'breached' || sla === 'overdue';

  if (!dueAt) {
    if (isFlaggedOverdue) {
      return { label: 'Action Overdue', isOverdue: true, isDueSoon: false };
    }
    return { label: 'No deadline', isOverdue: false, isDueSoon: false };
  }

  const target = new Date(dueAt).getTime();
  if (Number.isNaN(target)) {
    if (isFlaggedOverdue) {
      return { label: 'Action Overdue', isOverdue: true, isDueSoon: false };
    }
    return { label: 'No deadline', isOverdue: false, isDueSoon: false };
  }

  const now = Date.now();
  const diffMs = target - now;

  if (isFlaggedOverdue || diffMs <= 0) {
    const overdueMs = Math.abs(diffMs);
    const hours = Math.floor(overdueMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const mins = Math.floor((overdueMs % (1000 * 60 * 60)) / (1000 * 60));
    const timeStr = days > 0 ? `${days}d ${remHours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    return { label: `Overdue by ${timeStr}`, isOverdue: true, isDueSoon: false };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const timeStr = days > 0 ? `${days}d ${remHours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const isDueSoon = diffMs <= 4 * 60 * 60 * 1000 || sla === 'due-soon';

  return { label: `Due in ${timeStr}`, isOverdue: false, isDueSoon };
}
