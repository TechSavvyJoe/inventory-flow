interface MoveEvidenceEvent {
  kind?: string;
  type?: string;
  occurredAt: string;
}

export interface AwayFromHomeSummary {
  isAway: boolean;
  label: string;
  departedAt?: string;
  elapsedHours?: number;
}

/** Notes, approvals and sale outcomes are not departure evidence. */
export function awayFromHomeSummary(
  homeStore: string,
  currentLocation: string,
  events: MoveEvidenceEvent[],
  now = Date.now(),
): AwayFromHomeSummary {
  const current = currentLocation.trim().toLowerCase();
  if (current === homeStore.trim().toLowerCase()) return { isAway: false, label: 'At home store' };
  if (!current || /unknown|not recorded|not provided|unverified/.test(current)) {
    return { isAway: false, label: 'Location needs checking' };
  }
  let departedAt: string | undefined;
  for (const event of [...events].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))) {
    const timestamp = Date.parse(event.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp > now) continue;
    const kind = (event.kind ?? event.type ?? '').replace(/-/g, '_');
    if (kind === 'returned_home') departedAt = undefined;
    else if (!departedAt && ['vehicle_departed', 'picked_up', 'in_transit'].includes(kind)) departedAt = event.occurredAt;
  }
  if (!departedAt) return { isAway: true, label: 'Departure not recorded' };
  const elapsedHours = Math.max(0, Math.floor((now - Date.parse(departedAt)) / 3_600_000));
  const days = Math.floor(elapsedHours / 24);
  const label = days > 0
    ? `${days} ${days === 1 ? 'day' : 'days'} away`
    : elapsedHours > 0
      ? `${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'} away`
      : 'Less than 1 hour away';
  return { isAway: true, label, departedAt, elapsedHours };
}
